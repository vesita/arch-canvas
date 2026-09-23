// 对外接口面：给 AI 的提示词上下文、mermaid 静态路由、Client↔Host RPC、四个 AI 工具。
// 这一节末尾 return 出 Cordis 插件对象 —— 构建脚本会在最外层再套 return/apply。
// ==================== 注册与现场记录 ====================
// 注册口统一包一层：一是顺手把现场写进日志文件（这个插件对 console 一字不吐），
// 二是让「到底注册上了几个」有据可查 —— 不用再靠人去数。
var registeredTools: string[] = []
var registeredRoutes: string[] = []

/** 注册一条私有 RPC。handler 抛错先留一行现场，再把错抛给外层。 */
function onRpc(name, fn) {
  return harness.handle(name, async function (args) {
    var t0 = Date.now()
    try {
      return await fn(args)
    } catch (e) {
      logEvent('error', 'rpc.fail', { method: name, error: msgOf(e), ms: Date.now() - t0 })
      throw e
    }
  })
}

function onRoute(path, handler) {
  registeredRoutes.push(path)
  harness.route(path, handler)
}

function onTool(def) {
  registeredTools.push(def && def.name)
  harness.registerTool(ctx, def)
}

/** 工具入参不合格时的统一回执。日志里留一行 —— 「它说改了、图上却没变」先查这里。 */
function toolReject(tool, reason, t0) {
  logEvent('warn', 'tool.reject', { tool: tool, reason: reason, ms: Date.now() - t0 })
  return { ok: false, error: reason }
}

// ==================== AI 侧提示词上下文 ====================
// 只取标签第一段（标题）。host 与 client 是两个独立作用域，不能共用 client 的 splitLabel，
// 所以就地取一份 —— 规则只有一条：第一个 `\n` 之前是标题。
// 多行 label 直接插进清单会把一个条目撑成三行，把清单读成散文。
function labelTitle(label) {
  var s = String(label == null ? '' : label)
  var i = s.indexOf('\n')
  return i < 0 ? s : s.slice(0, i)
}

var lastForeignCanvasLogged = ''

/**
 * 把 `{{` 拆开 —— **提示词注入的最后一道关，必须走完所有 return**。
 *
 * DSH 的 `systemPrompt.context` 会把这段文本当 `{{变量}}` 模板渲染，而这条通道**没有关掉插值的
 * 开关**（见 AGENTS.md「提示词模板注入」）。源文本里合法地出现 `{{` 时（Mermaid 的 hexagon
 * 形状就是 `id{{"标签"}}`），变量名不匹配就直接抛错 —— 整条注入失败、插件当场崩、会话起不来。
 *
 * 2026-09-24 审计第 2 条：从前只有**最后一个** return 做了这件事，空画布的提前 return 与
 * `foreignCanvasText` 两条路都没做（后者里还带着别的项目的图名，名字里有 `{{` 就炸）。
 * 所以收口成一个函数，三个出口都必须过它；而且 `{{{{` 用单次 replace 是拆不干净的
 * （替换文本自己又挨在一起），要**循环到不动为止**。
 */
function promptSafe(s: string): string {
  var out = String(s == null ? '' : s)
  for (var i = 0; i < 8 && out.indexOf('{{') >= 0; i++) out = out.split('{{').join('{ {')
  return out
}

/**
 * 「画布停在别的项目上」时这一步只注入这一段 —— 不含任何别人的图内容、锚点、留言。
 * 内容与留言都可能涉及另一个会话正在进行的工作，而且留言是**一次性投递**：投给错的会话
 * 就等于丢了（2026-09-23 真的这样丢过 3 条）。所以这里只说清状态和下一步该干什么。
 */
function foreignCanvasText(sessWhere: string) {
  // 只说「停在哪个项目」——**不报对方那张图的名字**：名字也是别人的内容，而且它是用户可控文本，
  // 曾经是 `{{` 漏网的入口（审计第 14 条）。
  var parkedWhere = doc.external
    ? ('项目文件 ' + doc.external)
    : ((lib.scope === 'project' ? '项目图库 ' : '全局图库 ') + lib.dir)
  var sig = sessWhere + '|' + lib.dir
  if (sig !== lastForeignCanvasLogged) {
    lastForeignCanvasLogged = sig
    logEvent('info', 'prompt.foreign-canvas', { parkedDir: lib.dir, session: sessWhere })
  }
  return [
    '## 逻辑框架画布（arch-canvas）',
    '**画布现在停在别的项目上**（' + parkedWhere + '）。你这个会话的项目是 `' + sessWhere + '`。',
    '提示词这一侧**不会**把别的项目的图读给你，也不会替它消费留言（留言是「读一次即送达」，投给错的会话就没了）——' +
      '所以这一轮你看不到任何画布内容，别对上面那张图做任何操作。',
    '要看你这个项目的图：调一次 `arch_read`（工具会按你的工作目录把画布切过来；那个项目还没有图库的话它会说是空的）。' +
      '`arch_edit` / `arch_write` 同样会先切到你的项目，但**改之前先读一次**，别凭想象改。',
  ].join('\n')
}

/**
 * 每一步注入给模型的画布状态。
 *
 * `asctx` 是 DSH 传进来的装配上下文（`{ agent, scope, signal }`，见 dsh-agent 的
 * `assembleContextFor`）—— **提示词注入是唯一必须知道「这一步是谁在跑」的地方**。
 * 2026-09-23 的事故：宿主只有一份内存文档，而这里从前忽略入参、直接读全局 doc ——
 * 另一个会话（另一个项目）把画布切到它自己那边之后，本会话每一步都读到那张图，
 * 连留在那上面的留言都被当自己的「读一次即送达」消费掉了（用户写的东西就这么没了）。
 *
 * 现在的规矩：**画布属于项目，不属于进程**。这一步的会话在自己项目里 → 正常注入；
 * 不在 → 只给一句说明，绝不把别人项目的图、锚点、留言读给这一步，也绝不消费那些留言。
 */
function promptText(asctx?) {
  var sessWhere = whereOfExec({ agent: asctx && asctx.agent })
  if (typeof sessWhere === 'string' && sessWhere) {
    if (!docBelongsTo(sessWhere)) {
      // 先试着**同步**把自己项目那一份换进来（命中内存槽就不用等下一次）；命中不了才给说明。
      // 这里**不排异步加载**：提示词注入是每一步都会跑的读路径，在这里发起的加载会与
      // 别的会话的切库抢同一个「当前文档」（宿主只有一份活动指针），实测会把一份**空文档**
      // 当成某个项目的槽存下来。要自己的画布，走 `arch_read` —— 那条路带着会话 cwd，
      // 目标明确、也不会把中间态写进别人的槽。
      if (!syncWorkspaceFor(sessWhere)) return promptSafe(foreignCanvasText(sessWhere))
    }
  }
  var curKey = doc.external || keyOf(doc.name)
  var where = doc.external ? '项目里的文件 ' : (lib.scope === 'project' ? '项目图库 ' : '全局图库 ')
  var loc = doc.external ? doc.external : lib.dir
  // 「最后改的人 + 动了哪几个节点」是这条「上下文自动同步」通道里最该同步的东西：
  // 只写 updatedBy 的话，AI 知道有人改过，却不知道改的是什么。
  // lastChange 是 document.ts 的模块级变量（不是 doc 的属性）：只有 rev 与当前修订一致时，
  // 它才描述「这一次修订改了什么」。对不上就当没有 —— history.ts 用的是同一条判据。
  var lc0 = lastChange && lastChange.rev === doc.revision ? lastChange : null
  var touched = (lc0 && lc0.nodes && lc0.nodes.length) ? lc0.nodes.slice(0, 6) : []
  var byWho = doc.updatedBy === 'ai' ? 'AI' : (doc.updatedBy === 'user' ? '用户' : String(doc.updatedBy || '未知'))
  var touchedTxt = touched.length
    ? ('，动的节点：' + touched.map(function (x) { return '`' + String(x) + '`' }).join('、'))
    : ''
  // 这一节只回答两件事：**当前状态是什么**、**用户要什么**。
  // 「工具怎么用、图库怎么组织、`%%` 各字段什么意思」是 skill（skills/arch-canvas/SKILL.md）的职责 ——
  // 抄在这里等于每一步都重复一遍教材，而且会与 SKILL.md 形成两份各自漂移的真相。
  // 只留真正属于「读这份数据」的注意事项：图不保证与代码一致、共享画布的边界、元数据不要讨论。
  var head = [
    '## 逻辑框架画布（arch-canvas）',
    '当前：`' + curKey + '` · ' + where + loc + ' · 修订 ' + doc.revision + ' · 最后改的人是' + byWho + touchedTxt + '。',
    '这张图是**讨论中的逻辑框架**，不保证与代码一致（别拿代码去「纠正」它，也别因为图上没画就断定漏了）；' +
      '它同时是你和用户的共享画布 —— 你改完用户立刻看得见，用户手动改的下一步你也看得见。',
  ]
  if (doc.external) {
    head.push('它是按路径打开的项目文件（不属于任何图库），你的改动落盘写回它本身。')
  }
  // 一句话总结：这是「读这张图之前先知道它讲的是什么」的那一行，作用与 skill 的描述行一样 ——
  // 所以紧跟定位行，且不截断（它本身有 500 字上限）。
  if (doc.summary) head.push('', '**这张图讲的是**：' + doc.summary)
  var others = []
  for (var i = 0; i < libraryCache.length; i++) {
    var it = libraryCache[i]
    if (it.deleted || it.key === curKey) continue
    var itSum = typeof it.summary === 'string' && it.summary ? it.summary : ''
    if (itSum.length > 60) itSum = itSum.slice(0, 60) + '…'
    others.push('「' + it.key + '」' + (itSum ? '：' + itSum : '') + '(' + it.nodes + ' 节点' + (it.links ? '、' + it.links + ' 处下钻' : '') + ')')
  }
  if (others.length > 0) {
    head.push('', '同图库还有：' + others.join('、') + '。切过去用 `arch_switch`（用户画布会跟着切），只看不改用 `arch_read` 带 `diagram`。')
  }
  // 用户注释：只有**未解决**的那些进上下文。已解决的留在文件里可追溯，但不注入 ——
  // 注释会单调累积，全都灌进来的话，AI 会开始重新讨论早就定下来的事（那是负的表达力）。
  var openNotes = []
  for (var ni = 0; ni < doc.nodes.length; ni++) {
    var nn = doc.nodes[ni]
    if (nn.note && !nn.noteDone) openNotes.push(nn)
  }
  var nc = noteCounts()
  if (openNotes.length > 0) {
    head.push('', '**用户在这些元素上留了留言**——它们是待处理的疑问或要求，逐条回应，点名节点 id。')
    // 2026-09-21：留言改成**一次性消耗**。读到这儿就算送达，随即在内存里标成已办（见下面那个
    // 循环）—— 于是它不会再出现在后续任何一步的上下文里，也不会再回到这段清单当僵尸。
    // 这是一条**读路径上的内存变更**：落盘照旧由 persist() 统一做（它读 doc.nodes 的 noteDone）。
    // 取舍说清楚：送达之后如果一直没人写盘，notes.json 里它仍是「未送达」—— 重启 dsh 会再送一次。
    // 宁可多送一次，也不丢用户写的东西（和「检查点：安全靠退得回去」同一个取向）。
    head.push('**这几条本轮之后就会从你的上下文里消失**（读一次即送达，历史只留最近 '
      + NOTE_HISTORY_MAX + ' 条）。所以**本轮一次处理完**：没处理完的当场说清楚，别指望下一轮还看得到。')
    var listed = openNotes.length > 20 ? 20 : openNotes.length
    for (var on = 0; on < listed; on++) {
      var ot = String(openNotes[on].note)
      if (ot.length > 400) ot = ot.slice(0, 400) + '…（已截断，完整内容见文件）'
      head.push('- `' + openNotes[on].id + '`（' + labelTitle(openNotes[on].label) + '）：' + ot.replace(/\r?\n/g, ' / '))
    }
    if (openNotes.length > listed) {
      head.push('- …还有 ' + (openNotes.length - listed) + ' 条未处理的留言：**它们会在下一步继续投递**，这一轮先处理上面这些。')
    }
    // **送达的只是「列出来的这些」。** 从前这里把 openNotes 全标成已办，而清单只列了 20 条 ——
    // 第 21 条起既不进上下文、又永远不会再投递，用户写的东西就这么静默消失
    // （2026-09-24 审计第 8 条）。一次投递 20 条是刻意的上下文预算，那就只送 20 条。
    for (var dn = 0; dn < listed; dn++) openNotes[dn].noteDone = true
  }
  if (nc.done > 0) {
    head.push('- 另有 ' + nc.done + ' 条留言已经投递过（在历史里）：**没有列出来，也不要据此行动**；需要回看用 `arch_read`。')
  }
  // 代码锚点：用户给节点标的源码文件。价值在于「中文标签 ↔ 英文路径」这个映射 grep 不出来，
  // 所以能省掉一次定位；但它会腐烂 —— 失效的必须显式标出来，并且明说别照着用。
  // 状态取 doc.fileStatus 这份缓存（加载/切库、doc:get、doc:set 之后会重算）。
  //
  // 除了「文件/符号还在不在」，还要看**保鲜**（drift.ts）：文件还在、符号还在，但内容在图上
  // 一次落盘之后改过 —— 那是最常见的那种腐烂（函数还在，只是已经不是图上说的那个东西了）。
  var staleRefs: Record<string, number> = {}
  var drift = doc.drift || null
  if (drift && Array.isArray(drift.stale)) {
    for (var ds = 0; ds < drift.stale.length; ds++) staleRefs[drift.stale[ds].ref] = 1
  }
  var refLines = []
  for (var ri = 0; ri < doc.nodes.length; ri++) {
    var rn = doc.nodes[ri]
    var rfs = rn.files || []
    if (!rfs.length) continue
    var rst = (doc.fileStatus && doc.fileStatus[rn.id]) || {}
    var good = []
    var bad = []
    for (var rj = 0; rj < rfs.length; rj++) {
      var rsc = rst[rfs[rj]]
      if (rsc === 'ok' && !staleRefs[rfs[rj]]) good.push('`' + rfs[rj] + '`')
      else if (rsc === 'ok') bad.push('`' + rfs[rj] + '`（文件在图之后改过）')
      else bad.push('`' + rfs[rj] + '`（' + (rsc === 'missing' ? '文件不在' : rsc === 'symbol-missing' ? '符号不在' : '未能校验') + '）')
    }
    refLines.push('- `' + rn.id + '`（' + labelTitle(rn.label) + '）：' + (good.length ? good.join('、') : '') +
      (bad.length ? (good.length ? '；' : '') + '⚠ ' + bad.join('、') : ''))
  }
  if (refLines.length > 0) {
    head.push('', '**图元素上标的代码锚点**（文件里写作 `%% @file`）：用户给的「这个节点对应哪些源码文件」，' +
      '可以先按它去读，省掉一次 grep 定位。动手前先确认文件在；标了 ⚠ 的**要么已经失效、要么在图之后被改过，' +
      '都不要照着用** —— 重新定位后告诉用户锚点该改成什么。')
    for (var rk2 = 0; rk2 < refLines.length && rk2 < 20; rk2++) head.push(refLines[rk2])
    if (refLines.length > 20) head.push('- …还有 ' + (refLines.length - 20) + ' 个节点带锚点，完整内容见文件。')
    head.push('- 锚点是**部分**节点的指路牌，不代表图与代码一致 —— 别据此认为图漏了或多了什么。')
  }
  // 保鲜报告本身只写「状态」，并且**只有非空才注入** —— 一张新鲜的图不该为它多付一行 token。
  if (drift && (drift.stale.length > 0 || drift.uncovered.length > 0)) {
    // 两件事分开说，**不许一律喊「过期」**：
    //   stale     —— 代码先动了，这些锚点现在可能指向「已经不是图上说的那个东西」；
    //   uncovered —— 只是「这几处还没画」，不是图上写错了。
    // 混成一句「这张图过期了」，AI 会去重画一张没坏的图。
    var dlines = ['', '**图的保鲜状态**（`drift`，宿主比对出来的，不是猜测）：']
    if (drift.stale.length > 0) {
      var top = []
      for (var dt = 0; dt < drift.stale.length && dt < 5; dt++) top.push('`' + drift.stale[dt].ref + '`')
      dlines.push('- 这条图上一次写进文件之后，这些锚点的文件改过了：' + top.join('、') +
        (drift.stale.length > top.length ? ' 等' : '') + ' —— 它们可能已经不是图上说的那个东西。')
    }
    if (drift.uncovered.length > 0) {
      var udirs = []
      for (var du = 0; du < drift.uncovered.length && du < 6; du++) {
        udirs.push('`' + drift.uncovered[du].dir + '`（' + drift.uncovered[du].files + ' 个源文件）')
      }
      dlines.push('- 另有这些目录里有源码、却没有任何锚点指向：' + udirs.join('、') +
        (drift.truncated ? '（走目录的预算用完了，只看了前 ' + DRIFT_WALK_MAX_DIRS + ' 个目录）' : '') +
        '。这只是「还没画」，**不是**图上写错了。')
    }
    if (drift.stale.length > 0) {
      dlines.push('对着代码核对时**别照着上面这些锚点走**；要动图，先问用户这张图还准不准，或者重新定位一遍。')
    }
    for (var dl = 0; dl < dlines.length; dl++) head.push(dlines[dl])
  }
  if (doc.nodes.length === 0) {
    head.push('', '画布目前是空的。可以用 `arch_write` 画一版初稿，或用 `arch_edit` 逐块搭建。')
    return promptSafe(head.join('\n'))
  }
  var src = serializeDoc(doc).replace(/\n+$/, '')
  // 「注入用的视图」与文件不逐字相同，为的都是别把噪音灌给 AI（文件里一切都在，要看原文用 `arch_read`）：
  // 1. 头部 `%%!` 格式说明 —— 每张图逐字相同，而且里面有 `<节点id>` 这类模板；
  // 2. `%% @pos` 坐标 —— 纯布局数据，AI 不消费它（改坐标走 move_node，整体重画按 id 继承旧坐标），
  //    而它是每节点一行：17 个节点的图里占了源码块近三分之一。
  // 过滤 @done 主要是给老文件兜底：老文件中可能仍带有行首 %% @done
  src = src.split('\n').filter(function (l) {
    return l.indexOf('%% @done ') !== 0 && l.slice(0, 3) !== '%%!' && l.indexOf('%% @pos ') !== 0
  }).join('\n')
  var out = head.concat([
    '',
    '下面是**源文本**（这份图文件的全文；已滤掉 `@pos` 坐标行、`%%!` 格式说明，要看原文用 `arch_read`）。' +
      '`%%` 开头的行是元数据，原样保留、不要当成图的内容来讨论。',
    '```mermaid', src, '```',
    '',
    '工具用法与图库规则见 `arch-canvas` skill（用 `skill` 工具加载）。',
  ]).join('\n')
  // 最后一道关：把 `{{` 拆开（唯一一处必须改动用户文本的地方，实现与理由见 promptSafe）。
  return promptSafe(out)
}

// ==================== 静态资源路由 ====================
// 只是「把包里的文件发给浏览器」。register 由外层在 webServer 就绪后做。
var mermaidSource = null
var mermaidAssetUrl = null

// mermaid 优先包内 assets/（随包分发，装机即有），退回早期手工下载的缓存。
// 两个路径都由外层递进来（真插件按 __dirname，动态形态按项目目录），这里不留本机路径。
var MERMAID_PKG_FILE = (typeof hostEnv === 'object' && hostEnv && typeof hostEnv.mermaidFile === 'string' && hostEnv.mermaidFile)
  ? hostEnv.mermaidFile
  : ''
var mermaidCandidates = [MERMAID_PKG_FILE, MERMAID_CACHE].filter(function (p) { return !!p })

async function readFirstFile(paths) {
  for (var i = 0; i < paths.length; i++) {
    try {
      var t = await fs.resolve(paths[i])
      var info = await fs.stat(t)
      if (!info) continue
      var text = await fs.readText(t)
      if (text) return text
    } catch (e) { /* 换下一个候选 */ }
  }
  return ''
}

// 界面脚本每次请求现读现发，所以构建完刷新页面即可。路径由外层递：真插件是 <包>/lib/ui.js，
// 动态形态是 <项目>/dist/ui.js —— 宿主逻辑不猜自己装在哪儿。
var UI_FILE = (typeof hostEnv === 'object' && hostEnv && typeof hostEnv.uiFile === 'string' && hostEnv.uiFile)
  ? hostEnv.uiFile
  : ''
var uiAssetUrl = null

if (fs) {
  onRoute('/arch-canvas/mermaid.min.js', async function (req, res) {
    if (mermaidSource === null) mermaidSource = await readFirstFile(mermaidCandidates)
    if (!mermaidSource) {
      res.statusCode = 404
      res.end('mermaid bundle not found: ' + mermaidCandidates.join(' | '))
      return
    }
    res.setHeader('content-type', 'text/javascript; charset=utf-8')
    res.setHeader('cache-control', 'public, max-age=86400')
    res.end(mermaidSource)
  })
  mermaidAssetUrl = '/arch-canvas/mermaid.min.js'

  onRoute('/arch-canvas/ui.js', async function (req, res) {
    var body = ''
    try {
      var t = await fs.resolve(UI_FILE)
      var info = await fs.stat(t)
      body = info ? await fs.readText(t) : ''
    } catch (e) { body = '' }
    if (!body) {
      res.statusCode = 404
      res.end('界面脚本不存在：' + (UI_FILE || '(hostEnv.uiFile 没给)') + '（在项目里跑 npm run build）')
      return
    }
    res.setHeader('content-type', 'text/javascript; charset=utf-8')
    res.setHeader('cache-control', 'no-store, no-cache, must-revalidate')
    res.end(body)
  })
  uiAssetUrl = '/arch-canvas/ui.js'
}

function summaryOf(): Record<string, any> {
  return {
    ok: true,
    revision: doc.revision,
    updatedBy: doc.updatedBy,
    updatedAt: doc.updatedAt,
    file: doc.file,
    diagram: doc.name,
    // 外部文件的「引用名」就是它的路径：图库那套 key 对它不成立
    key: doc.external ? doc.external : keyOf(doc.name),
    external: doc.external || null,
    project: projectRel(),
    dir: lib.dir,
    scope: lib.scope,
    workspace: lib.workspace,
    tombstoned: doc.tombstoned,
    nodeCount: doc.nodes.length,
    edgeCount: doc.edges.length,
    groupCount: doc.groups.length,
    // 整张图的一句话总结：界面拿它作图库清单的副标题，提示词拿它当「这张图讲的是什么」那一行。
    summary: doc.summary,
    libraryRev: libraryRev,
    warnings: doc.warnings.slice(),
    notes: doc.notes.slice(),
    noteCount: noteCounts().open,
    resolvedNoteCount: noteCounts().done,
    // 代码锚点的校验结果（派生数据，不落盘）：放在 summaryOf 里，所有 RPC 一起带上 ——
    // 界面靠它标失效的引用，只有 fullOf 有的话 doc:get/doc:set 这两条主路径就收不到。
    fileStatus: doc.fileStatus || {},
    // 锚点保鲜（派生数据，见 drift.ts）：界面拿它标「文件在图之后改过」的角标，
    // 提示词拿它说「别照着这些锚点走」。
    drift: doc.drift || null,
    // 检查点条数：面板顶栏那个「历史 N」显示它（清单本身走 doc:history）
    historyCount: historyOf(doc.file).length,
    lastChange: lastChange,
  }
}

function fullOf() {
  var out = summaryOf()
  out.model = modelOf()
  out.mermaid = serializeDoc(doc)
  return out
}

// 载入完成后的统一收尾：标记来源、bump、刷新清单缓存。
// 界面靠「修订号变了 + lastChange.by === 'switch'」发现图库或图换了，并重新适应视图。
async function afterSwitch() {
  loadedFor = lib.dir
  bump('switch')
  lastChange = { by: 'switch', rev: doc.revision, nodes: [] }
  // 强制扫：这是「刚换了一张图」的收尾 —— 清单里必须立刻有它（新建的图更要立刻出现）。
  // 走 TTL 的话，回执与紧随其后的 doc:list 会拿着最长 15 秒前的旧清单。
  await refreshLibrary(true)
  await verifyFileRefs()
  logEvent('info', 'doc.switch', {
    diagram: doc.name, key: keyOf(doc.name), dir: lib.dir, scope: lib.scope,
    nodes: doc.nodes.length, edges: doc.edges.length,
  })
  return fullOf()
}

ctx.effect(function () {
  return onRpc('doc:get', async function (args) {
    // `where` 出现但类型不对（`{where:42}`）从前会静默退回「当前文档」—— 调用方以为自己读的是
    // 那个项目，实际读的是别人/上一次留下的那张图。缺凭据不许退化成默认值。
    // 注意：`where: ''` 是**有效输入**（= 全局图库，没有项目根），不能一起拒掉。
    if (args && args.where !== undefined && typeof args.where !== 'string') {
      return { ok: false, error: 'where 必须是字符串（项目目录路径）' }
    }
    await ensureLoaded(args && args.where, args && args.session)
    var ticket = docTicket()
    await verifyFileRefs()
    if (!ticketHolds(ticket)) {
      // **复核。** verifyFileRefs 是异步的（要走目录算指纹），别的会话的切库可能在这中间把
      // 全局指针换走 —— 那样这次读返回的就是**别人的图**（2026-09-24 审计第 1 条的读泄漏）。
      // 换回来重算一次；指针切换现在排在加载队列里，所以这条窗口很窄，但窄不等于没有。
      await ensureLoaded(args && args.where, args && args.session)
      await verifyFileRefs()
    }
    var out = summaryOf()
    out.model = modelOf()
    out.mermaid = serializeDoc(doc)
    doc.notes = []
    return out
  })
})

ctx.effect(function () {
  return onRpc('doc:rev', async function (args) {
    // 顺手按 TTL 重扫一次图库（只走目录 + 比指纹，很便宜）：别人新加的图要能自己冒出来。
    // 界面轮询这个 RPC，所以「自动扫描」在面板开着时就有人驱动；面板关着时由定时器兜住。
    await ensureLoaded(args && args.where, args && args.session)
    var ticket = docTicket()
    await refreshLibrary()
    if (!ticketHolds(ticket)) {
      await ensureLoaded(args && args.where, args && args.session)
      await refreshLibrary()
    }
    return {
      revision: doc.revision, updatedBy: doc.updatedBy, diagram: doc.name, dir: lib.dir,
      libraryRev: libraryRev, external: doc.external || null,
    }
  })
})

ctx.effect(function () {
  return onRpc('doc:set', async function (args) {
    await ensureLoaded(args && args.where, args && args.session)
    var model = args && args.model
    // **形状闸门**：闸门从前只判 `typeof model !== 'object'`，而**数组也是 object** ——
    // `{model:[]}` 会走 adoptModel → normalizeModel 把非数组的 nodes 当空 → 静默清空整张图并落盘，
    // 回执还是 `ok:true, saved:true`、修订号前进。`{model:{}}` / `{model:{nodes:'x'}}` 同样清。
    // 界面从来只发 `{nodes:[…], edges:[…], …}` 这个形状，所以这不误伤「用户把节点全删了」。
    if (!model || typeof model !== 'object' || Array.isArray(model)) {
      return { ok: false, error: '需要 model（一个对象）' }
    }
    if (!Array.isArray(model.nodes) || !Array.isArray(model.edges)) {
      return { ok: false, error: 'model.nodes 与 model.edges 必须是数组（要清空整张图就显式传空数组）' }
    }
    // 认下这一份文档：落盘时指针若已被别的会话换走，persist 会拒写而不是把这次改动
    // 灌进别人的项目文件（审计第 1 条）。
    var expectFile = doc.file
    var saved = snapshotModel()
    adoptModel(model)
    if (args && typeof args.note === 'string' && args.note) doc.notes = [args.note]
    bump('user')
    noteUserChange()
    var policy = policyOfSessionId(args && args.session)
    var saveError = await persistOrRollback(saved, 'doc:set', policy, expectFile)
    await verifyFileRefs()
    var out = summaryOf()
    out.mermaid = serializeDoc(doc)
    out.model = modelOf()
    out.saved = !saveError
    return out
  })
})

ctx.effect(function () {
  return onRpc('doc:applyText', async function (args) {
    await ensureLoaded(args && args.where, args && args.session)
    // 缺 text 与「显式清空整张图」从前不可区分：不带参调用就把当前图写成空图并落盘
    // （`ok:true, saved:true`，零警告 —— 审计第 5 条）。要清空必须显式传空串。
    if (!args || typeof args.text !== 'string') return { ok: false, error: '需要 text（要清空整张图就显式传空串）' }
    var text = args.text
    var expectFile = doc.file
    var parsed = inheritPositions(parseMermaid(text))
    // **清空只认显式空串。** 从前判据是 `text.trim() !== ''`，于是纯空白串 `"   "` trim 后为空
    // ⇒ 跳过拒绝 ⇒ 整张图被清空并落盘（回执 ok:true, saved:true，零警告）。
    if (parsed.nodes.length === 0 && text !== '') {
      return { ok: false, error: '没能从这段文本里解析出任何节点（要清空整张图就传空串）', mermaid: serializeDoc(doc) }
    }
    var saved = snapshotModel()
    adopt(parsed)
    adoptModel(modelOf())
    bump('user')
    noteUserChange()
    var policy = policyOfSessionId(args && args.session)
    var saveError = await persistOrRollback(saved, 'doc:applyText', policy, expectFile)
    await verifyFileRefs()
    var out = summaryOf()
    out.mermaid = serializeDoc(doc)
    out.model = modelOf()
    out.saved = !saveError
    return out
  })
})

ctx.effect(function () {
  return onRpc('mermaid:info', async function () {
    return { url: mermaidAssetUrl }
  })
})

ctx.effect(function () {
  return onRpc('ui:info', async function () {
    return { url: uiAssetUrl, file: UI_FILE }
  })
})

ctx.effect(function () {
  return onRpc('doc:file', async function (args) {
    await ensureLoaded(args && args.where, args && args.session)
    // `save` 出现就必须是布尔：从前 `if (args && args.save)` 会把字符串 `"no"` 当真值照落盘。
    if (args && args.save !== undefined && typeof args.save !== 'boolean') {
      return { ok: false, error: 'save 必须是布尔' }
    }
    if (args && args.save === true) {
      // 认下这一份文档 + 站点：从前连 site 都没传，日志里被记成 site:'unknown'（出问题查不到是谁写的）。
      var expectFile = doc.file
      var err = await persist(policyOfSessionId(args && args.session), 'doc:file', expectFile)
      var out = summaryOf()
      out.saved = !err
      if (err) out.error = err
      return out
    }
    return summaryOf()
  })
})

// ---- 图库管理：清单 / 打开 / 新建 / 改名 / 软删除 / 恢复 / 按路径打开外部文件 ----
ctx.effect(function () {
  return onRpc('doc:list', async function (args) {
    await ensureLoaded(args && args.where, args && args.session)
    var ticket = docTicket()
    // rescan 为真时忽略 TTL 立刻重扫（选择器上的「重新扫描」按钮走这条路）
    var items = await refreshLibrary(!!(args && args.rescan))
    if (!ticketHolds(ticket)) {
      // 同 doc:get：扫描是异步的，别的会话的切库可能在这中间把指针换走 ——
      // 那样返回的清单与 dir 就是**别人的图库**。换回来重扫一次。
      await ensureLoaded(args && args.where, args && args.session)
      items = await refreshLibrary(!!(args && args.rescan))
    }
    return {
      ok: true, dir: lib.dir, scope: lib.scope, workspace: lib.workspace,
      current: doc.name, external: doc.external || null,
      items: items,
      // 项目里散落的 mermaid 文件（同一次扫描的副产物）：按路径打开
      files: libraryFiles,
      libraryRev: libraryRev,
    }
  })
})

ctx.effect(function () {
  return onRpc('doc:openPath', async function (args) {
    await ensureLoaded(args && args.where, args && args.session)
    var path = resolveDiagramPath(args && args.path)
    if (!path) return { ok: false, error: '需要一个文件路径：绝对路径，或相对项目根的路径' }
    return openExternal(path, !!(args && args.create), policyOfSessionId(args && args.session))
  })
})

ctx.effect(function () {
  return onRpc('doc:open', async function (args) {
    await ensureLoaded(args && args.where, args && args.session)
    var raw = args && typeof args.key === 'string' ? args.key
      : (args && typeof args.name === 'string' ? args.name : '')
    if (!raw.trim()) return { ok: false, error: '需要 key（图名，或 `子项目/图名`）' }
    var k = resolveKey(raw)
    if (!k) return { ok: false, error: '当前没有项目根，无法引用子项目的图' }
    // 打开子项目的图 = 把「当前层」切过去：此后坐标、落盘、AI 上下文都落在那一层
    if (k.dir !== lib.dir) {
      lib = { dir: k.dir, scope: k.scope, workspace: k.workspace }
      loadedFor = null
    }
    var r = await loadDiagramAt(k, k.name, !!(args && args.create), policyOfSessionId(args && args.session))
    if (!r.ok) {
      await refreshLibrary()
      return { ok: false, error: r.error, items: libraryCache, dir: lib.dir }
    }
    return afterSwitch()
  })
})

ctx.effect(function () {
  return onRpc('doc:rename', async function (args) {
    await ensureLoaded(args && args.where, args && args.session)
    if (!fs) return { ok: false, error: 'fs 服务不可用' }
    // **缺凭据不许退化成默认值。** `resolveKey(undefined)` 的 name 会兜成默认图名
    // （`splitKey('')` → `architecture`）：一句 `{"method":"doc:rename","args":{"to":"zzz"}}`
    // 就把用户的主图软删了、还建出一张 zzz.mmd，回执却是 ok:true。照 doc:delete 抄校验。
    var fromRaw = args && args.from
    var toRaw = args && args.to
    if (typeof fromRaw !== 'string' || fromRaw.trim() === '' ||
        typeof toRaw !== 'string' || toRaw.trim() === '') {
      return { ok: false, error: '需要 from 与 to（图名，或 `子项目/图名`）' }
    }
    var a = resolveKey(fromRaw)
    var b = resolveKey(toRaw)
    if (!a || !b) return { ok: false, error: '当前没有项目根，无法引用子项目的图' }
    if (a.project !== b.project) {
      return { ok: false, error: '改名不能跨图库（' + (a.project || '根') + ' → ' + (b.project || '根') + '）；跨库请手工移动文件' }
    }
    if (a.name === b.name) return { ok: false, error: '新名字和旧名字一样' }
    // 目标已存在就不动 —— 改名不该悄悄吞掉另一张图
    try {
      var probe = await fs.resolve(fileAt(b.dir, b.name))
      if (await fs.stat(probe)) return { ok: false, error: '已经有叫「' + args.to + '」的图了' }
    } catch (e) {}
    var text
    try {
      text = await fs.readText(await fs.resolve(fileAt(a.dir, a.name)))
    } catch (e) {
      return { ok: false, error: '读不到「' + args.from + '」：' + msgOf(e) }
    }
    try {
      var renamePolicy = policyOfSessionId(args && args.session)
      await fs.writeText(await fs.resolve(fileAt(b.dir, b.name)), text, undefined, undefined, renamePolicy)
      // 旧文件只能软删（fs 没有 unlink），于是「改名」= 新建 + 把旧的标成已删除
      await fs.writeText(await fs.resolve(fileAt(a.dir, a.name)), TOMBSTONE + '\n' + text, undefined, undefined, renamePolicy)
      // 留言表也得跟着搬：它以**文件名**为键，不搬就等于新名字那张图一条留言都没有
      var noteMoveErr = await renameNoteStoreFor(fileAt(a.dir, a.name), fileAt(b.dir, b.name), renamePolicy)
      if (noteMoveErr) logEvent('warn', 'notes.rename.fail', { from: a.name, to: b.name, error: noteMoveErr })
    } catch (e) {
      return { ok: false, error: '改名失败：' + msgOf(e) }
    }
    if (doc.name === a.name && lib.dir === a.dir) {
      doc.name = b.name
      doc.file = fileAt(b.dir, b.name)
      doc.tombstoned = hasTombstone(text)
    }
    // 强制扫：改名后的回执与紧随的 doc:list 必须立刻看到新名字（TTL 会拿着旧清单最长 15 秒）。
    await refreshLibrary(true)
    return fullOf()
  })
})

ctx.effect(function () {
  return onRpc('doc:delete', async function (args) {
    await ensureLoaded(args && args.where, args && args.session)
    if (!fs) return { ok: false, error: 'fs 服务不可用' }
    // 缺 key 从前会**退化成默认图名**（`splitKey('')` → name 兜成 architecture），一句不带 key 的
    // `{"method":"doc:delete"}` 就把默认图软删了（审计第 4 条）。缺凭据一律拒绝。
    // 下面 `if (!dk)` 那条**不是**死代码：全局图库里 `resolveKey('子/图')` 会因没有项目根返回 null。
    var dkRaw = args && (args.key || args.name)
    if (typeof dkRaw !== 'string' || dkRaw.trim() === '') return { ok: false, error: '需要 key（图名，或 `子项目/图名`）' }
    var dk = resolveKey(dkRaw)
    if (!dk) return { ok: false, error: '需要 key（图名，或 `子项目/图名`）' }
    var name = dk.name
    var text
    try {
      text = await fs.readText(await fs.resolve(fileAt(dk.dir, dk.name)))
    } catch (e) {
      return { ok: false, error: '读不到「' + (args && (args.key || args.name)) + '」：' + msgOf(e) }
    }
    if (!hasTombstone(text)) {
      try {
        await fs.writeText(await fs.resolve(fileAt(dk.dir, dk.name)), TOMBSTONE + '\n' + text, undefined, undefined, policyOfSessionId(args && args.session))
      } catch (e) {
        return { ok: false, error: '删除失败：' + msgOf(e) }
      }
    }
    // 删的正好是当前这张 → **别让画布停在刚打上墓碑的那份内容上**。
    // 从前这里是 `doc.name = DEFAULT_DIAGRAM; loadedFor = null; ensureLoaded()` —— 于是 loadInto
    // 又把那份带 `%% @deleted` 的文件读回来：画布照旧显示它的节点、`tombstoned:true`，还能继续编辑，
    // 而清单里它已经 `deleted:true`（与这句注释说的正好相反）。
    if (doc.name === name && lib.dir === dk.dir) {
      var target = { dir: dk.dir, scope: dk.scope, workspace: dk.workspace }
      if (lib.dir !== target.dir) { lib = target; loadedFor = null }
      // 同一图库里还有活着的图就切过去（用户的画布落在真内容上）；一张都不剩才清空成空文档。
      var lives = []
      try {
        var all = await listDiagrams(dk.dir)
        for (var dl = 0; dl < all.length; dl++) if (!all[dl].deleted) lives.push(all[dl].name)
      } catch (eLives) { lives = [] }
      if (lives.length > 0) {
        var rl = await loadDiagramAt(target, lives[0], false, policyOfSessionId(args && args.session))
        if (rl && rl.ok) {
          var outSw = await afterSwitch()
          outSw.items = libraryCache
          return outSw
        }
      }
      // 一张活图都不剩：画布清成一份**空文档**（不 adopt 墓碑内容、不落盘）。
      // doc.file 仍写着默认图名，但它此刻带墓碑 —— 写路径的墓碑守卫会拒绝把它当活图改写，
      // 用户的软删除不会被一次无关保存抹掉；要拿回来走 doc:restore。
      adopt(emptyDoc())
      doc.name = DEFAULT_DIAGRAM
      doc.file = fileAt(dk.dir, DEFAULT_DIAGRAM)
      doc.external = null
      doc.workspace = projectKeyOfTarget(target)
      doc.tombstoned = false
      doc.absent = true
      doc.warnings = []
      doc.notes = []
      doc.fileStatus = {}
      doc.drift = null
      // loadedFor 设上，这条空画布才「粘得住」：下一次 doc:get 不会又把墓碑文件读回来。
      loadedFor = lib.dir
      lastChange = { by: 'user', rev: doc.revision, nodes: [] }
      await refreshLibrary(true)
      var outDel = fullOf()
      outDel.items = libraryCache
      return outDel
    }
    await refreshLibrary(true)
    var outDel2 = fullOf()
    outDel2.items = libraryCache
    return outDel2
  })
})

ctx.effect(function () {
  return onRpc('doc:restore', async function (args) {
    await ensureLoaded(args && args.where, args && args.session)
    if (!fs) return { ok: false, error: 'fs 服务不可用' }
    var rkRaw = args && (args.key || args.name)
    if (typeof rkRaw !== 'string' || rkRaw.trim() === '') return { ok: false, error: '需要 key（图名，或 `子项目/图名`）' }
    var rk = resolveKey(rkRaw)
    if (!rk) return { ok: false, error: '需要 key（图名，或 `子项目/图名`）' }
    var text
    try {
      text = await fs.readText(await fs.resolve(fileAt(rk.dir, rk.name)))
    } catch (e) {
      return { ok: false, error: '读不到「' + (args && (args.key || args.name)) + '」：' + msgOf(e) }
    }
    if (hasTombstone(text)) {
      try {
        await fs.writeText(await fs.resolve(fileAt(rk.dir, rk.name)), text.replace(/^\s*%%\s*@deleted[^\n]*\n?/, ''), undefined, undefined, policyOfSessionId(args && args.session))
      } catch (e) {
        return { ok: false, error: '恢复失败：' + msgOf(e) }
      }
      // **内存里那个墓碑也要摘掉。** 只改盘不清内存的话，恢复之后的下一次保存又会把
      // `%% @deleted` 写回去 —— 用户点了「恢复」，看起来成功了，过一会儿它自己又变回已删除
      // （审计第 6 条）。
      if (doc.name === rk.name && lib.dir === rk.dir) {
        doc.tombstoned = false
        // 画布可能刚被「删掉当前图」清空过（doc.absent）——那就把它重新读回来，
        // 否则用户点了「恢复」，清单里它活了、画布却还空着。
        if (doc.absent) {
          loadedFor = null
          await ensureLoaded(undefined, args && args.session)
        }
      }
    }
    // 强制扫：刚「恢复」的图必须立刻回到清单里（走 TTL 的话回执 items 里它还写着 deleted:true，
    // 而界面默认 rescan:false，最长 15 秒都看不到它回来）。
    await refreshLibrary(true)
    return { ok: true, dir: lib.dir, scope: lib.scope, workspace: lib.workspace, current: doc.name, items: libraryCache }
  })
})

// ==================== 检查点（快照）的 RPC ====================
// 这是取代「AI 写图开关」的那条安全路径：不拦 AI，但每一步都能退回去。
// 历史**只在内存里**，键是当前文件的路径 —— 所以这两条都先 ensureLoaded，拿到的是「用户正看着的这张」。
ctx.effect(function () {
  return onRpc('doc:history', async function (args) {
    await ensureLoaded(args && args.where, args && args.session)
    return { ok: true, file: doc.file, diagram: doc.name, limit: HISTORY_LIMIT, entries: historyList() }
  })
})

ctx.effect(function () {
  return onRpc('doc:rollback', async function (args) {
    await ensureLoaded(args && args.where, args && args.session)
    // **必须是有限整数。** 从前是 `Number(args.seq)`：`"1"` / `true` / `[2]` 全被强转成合法编号
    // 并能真的把图退回去 —— 一个类型错的入参不该产生一次真实的回滚。
    var rawSeq = args && args.seq
    if (typeof rawSeq !== 'number' || !isFinite(rawSeq) || Math.floor(rawSeq) !== rawSeq || rawSeq <= 0) {
      return { ok: false, error: '需要 seq（检查点编号，见 doc:history）' }
    }
    var seq = rawSeq
    var r = await applyRollback(seq, policyOfSessionId(args && args.session))
    if (!r.ok) return r
    await verifyFileRefs()
    await refreshLibrary()
    var out = fullOf()
    out.rolledBackTo = seq
    return out
  })
})

// ==================== 给 AI 的动态工具 ====================
var OUT_SCHEMA = { type: 'object', additionalProperties: true }

var readTool = harness.defineTool({
  name: 'arch_read',
  description: '读取一张逻辑框架图的 Mermaid 源码。默认读当前与用户共享的这张；给 diagram 可以只读同一个图库里的另一张（不会切换用户看到的图）。注意：当前这张图通常已经自动出现在你的上下文里，只有怀疑它过期、或要看别的图时才需要调用。',
  parameters: {
    type: 'object',
    properties: {
      diagram: { type: 'string', description: '要读的图名；省略则读当前这张' },
    },
  },
  output: {
    schema: OUT_SCHEMA,
    render: function (args, value) {
      try {
        var v = value || {}
        if (v.ok === false) return [{ type: 'text', text: 'arch_read 失败：' + String(v.error || '') }]
        return [{ type: 'text', text: '【' + String(v.diagram || '?') + '】\n' + String(v.mermaid || '(空)') }]
      } catch (e) {
        return [{ type: 'text', text: '(读取失败)' }]
      }
    },
  },
  execute: async function (args, exec) {
    await ensureLoaded(whereOfExec(exec), sessionIdOfExec(exec))
    // `diagram` 出现就必须是非空字符串：`{diagram:42}` 从前静默读了**当前这张**还回 ok:true，
    // 而 `arch_switch {key:42}` 是拒绝的 —— 同一族入参两套口径，AI 会以为它读了别的图。
    if (args && args.diagram !== undefined) {
      if (typeof args.diagram !== 'string' || args.diagram.trim() === '') {
        return { ok: false, error: '需要 diagram（要读的图名，非空字符串；省略则读当前这张）', diagram: doc.name }
      }
    }
    var want = args && typeof args.diagram === 'string' ? args.diagram.trim() : ''
    var wantParts = want ? splitKey(want) : null
    var wantKey = wantParts ? keyOf(wantParts.name, wantParts.project) : ''
    if (want && wantKey !== keyOf(doc.name)) {
      // 只读不切：读盘、解析、序列化后原样返回，一点不碰当前文档 ——
      // 用户正看着 A，AI 不该因为「读了一眼 B」就把画面切走。
      var rk = resolveKey(want)
      if (!rk) return { ok: false, error: '当前没有项目根，无法引用子项目的图', diagram: doc.name }
      var text = ''
      try {
        text = await fs.readText(await fs.resolve(fileAt(rk.dir, rk.name)))
      } catch (e) {
        return { ok: false, error: '读不到「' + want + '」：' + msgOf(e), diagram: doc.name }
      }
      var parsed = parseMermaid(text)
      return {
        ok: true, diagram: rk.name, key: wantKey, dir: rk.dir, scope: rk.scope,
        nodeCount: parsed.nodes.length, edgeCount: parsed.edges.length,
        mermaid: serializeDoc(parsed),
      }
    }
    await verifyFileRefs()
    var out = summaryOf()
    out.mermaid = serializeDoc(doc)
    return out
  },
})
onTool(readTool)

var switchTool = harness.defineTool({
  name: 'arch_switch',
  description: '切换用户正在看的逻辑框架图（同一个图库里的另一张），用户的画布会跟着切过去。要新建一张就带 create: true。这会改变用户眼前的画面，所以除非确实要一起看另一张，否则只用 arch_read 读。',
  parameters: {
    type: 'object',
    properties: {
      key: { type: 'string', description: '图的引用名：根图库写图名，子项目写 `子项目/图名`（不含 .mmd）' },
      create: { type: 'boolean', description: '图不存在时是否新建；默认 false，不存在会报错并列出可选图名' },
    },
    required: ['key'],
  },
  output: {
    schema: OUT_SCHEMA,
    render: function (args, value) {
      try {
        var v = value || {}
        if (!v.ok) return [{ type: 'text', text: 'arch_switch 未生效：' + String(v.error || '') }]
        return [{ type: 'text', text: '已切到「' + v.diagram + '」（' + v.nodeCount + ' 个节点、' + v.edgeCount + ' 条连线）。用户画布已同步。' }]
      } catch (e) {
        return [{ type: 'text', text: 'arch_switch 已完成' }]
      }
    },
  },
  execute: async function (args, exec) {
    await ensureLoaded(whereOfExec(exec), sessionIdOfExec(exec))
    var raw = args && typeof args.key === 'string' ? args.key
      : (args && typeof args.name === 'string' ? args.name : '')
    if (!raw.trim()) return { ok: false, error: '需要 key' }
    // `create` 出现就必须是布尔：`create:"false"` 是真值，从前会**真的把图建出来**
    // （实测 新图.mmd 存在）—— 模型给字符串布尔是常态，不能把 "false" 当成「要新建」。
    if (args && args.create !== undefined && typeof args.create !== 'boolean') {
      return { ok: false, error: 'create 必须是布尔（true 才新建）' }
    }
    var k = resolveKey(raw)
    if (!k) return { ok: false, error: '当前没有项目根，无法引用子项目的图' }
    if (k.dir !== lib.dir) {
      lib = { dir: k.dir, scope: k.scope, workspace: k.workspace }
      loadedFor = null
    }
    var r = await loadDiagramAt(k, k.name, !!(args && args.create), policyOfAgent(exec && exec.agent))
    if (!r.ok) {
      var items = await refreshLibrary()
      var names = items.filter(function (x) { return !x.deleted }).map(function (x) { return x.key })
      return {
        ok: false,
        error: r.error + '。可用的图有：' + (names.length ? names.join('、') : '(还没有别的图)') + '；要新建请带 create: true',
      }
    }
    return afterSwitch()
  },
})
onTool(switchTool)

var writeTool = harness.defineTool({
  name: 'arch_write',
  description: '用一份完整的 Mermaid flowchart 源码整体替换当前这张逻辑框架图。适合画初稿或结构性重画。只改局部时请改用 `arch_edit`：arch_write 会丢掉未被重新声明节点的画布坐标，用户手动摆好的布局会散掉。',
  parameters: {
    type: 'object',
    properties: {
      mermaid: { type: 'string', description: '完整的 Mermaid flowchart 源码。用 flowchart TD 或 flowchart LR 开头，例如：flowchart TD\\n  a["入口"] --> b["核心"]。可以在头部写一行 `%% @summary <一句话>` 说明这张图讲的是什么；不写就沿用原来那句。' },
      note: { type: 'string', description: '给用户看的一句话说明，会显示在画布状态栏' },
    },
    required: ['mermaid'],
  },
  output: {
    schema: OUT_SCHEMA,
    render: function (args, value) {
      try {
        var v = value || {}
        if (!v.ok) return [{ type: 'text', text: 'arch_write 未生效: ' + String(v.error || v.problems || '') }]
        var kept = v.keptNotes ? '（保留了用户在该图元素上的 ' + v.keptNotes + ' 条留言）' : ''
        return [{ type: 'text', text: '已更新「' + String(v.diagram || '') + '」（修订 ' + v.revision + '）：' + v.nodeCount + ' 个节点、' + v.edgeCount + ' 条连线。用户现在看到的图形已同步。' + kept }]
      } catch (e) {
        return [{ type: 'text', text: 'arch_write 已完成' }]
      }
    },
  },
  execute: async function (args, exec) {
    var t0 = Date.now()
    await ensureLoaded(whereOfExec(exec), sessionIdOfExec(exec))
    if (doc.absent && !doc.external) {
      logEvent('warn', 'doc.absent', { tool: 'arch_write', dir: lib.dir })
      return { ok: false, error: '这个项目还没有图库（' + lib.dir + ' 还不存在）。图库不会自动创建——要建先征得用户同意，再用 arch_switch { create: true } 建一张。' }
    }
    var text = args && typeof args.mermaid === 'string' ? args.mermaid : ''
    if (!text.trim()) return toolReject('arch_write', 'mermaid 不能为空', t0)
    var parsed = inheritPositions(parseMermaid(text))
    // 用户留的东西（注释 + 代码锚点）是**用户**的：AI 整体重画时继承下来，别让它悄悄抹掉。
    // doc:applyText（用户自己改源码）刻意不走这条 —— 那边删掉一行就是真的要删（见 inheritUserMarks）。
    var keptNotes = inheritUserMarks(parsed)
    if (parsed.nodes.length === 0) {
      return toolReject('arch_write', '解析不出任何节点（首行应是 flowchart TD 或 graph LR）', t0)
    }
    var before = snapshotNodes()
    var saved = snapshotModel()
    var expectFile = doc.file
    adopt(parsed)
    adoptModel(modelOf())
    bump('ai')
    noteAiChange(before)
    if (args && typeof args.note === 'string' && args.note) doc.notes = [args.note]
    var policy = policyOfAgent(exec && exec.agent)
    var saveError = await persistOrRollback(saved, 'arch_write', policy, expectFile)
    var out = summaryOf()
    out.mermaid = serializeDoc(doc)
    out.keptNotes = keptNotes
    // 写盘失败时内存已经回滚了 —— 那就**不能说「已更新」**：回执必须让 AI 知道自己白改了。
    // （历史里也不会多一份检查点：那一版从来没落到盘上，见 history.ts。）
    out.saved = !saveError
    if (saveError) { out.ok = false; out.error = '保存失败，本次改动已回滚：' + saveError }
    logEvent(saveError ? 'error' : 'info', 'tool.arch_write', {
      diagram: doc.name, key: keyOf(doc.name), file: doc.file,
      nodes: doc.nodes.length, edges: doc.edges.length, revision: doc.revision,
      keptNotes: keptNotes,
      saved: !saveError, rollback: !!saveError, warnings: (parsed.warnings || []).slice(0, 5), ms: Date.now() - t0,
    })
    return out
  },
})
onTool(writeTool)

var editTool = harness.defineTool({
  name: 'arch_edit',
  description: '对当前这张逻辑框架图做增量修改（推荐方式）。一次传多个 op，按顺序执行，只影响你指定的部分，用户已经拖好的节点位置完全不受影响。若 op 里出现尚未存在的节点 id，会返回 problems 告诉你原因。',
  parameters: {
    type: 'object',
    properties: {
      ops: {
        type: 'array',
        description: '要执行的操作列表，按顺序应用',
        items: {
          type: 'object',
          additionalProperties: true,
          properties: {
            op: {
              type: 'string',
              enum: ['add_node', 'set_label', 'set_shape', 'set_link', 'move_node', 'remove_node', 'add_edge', 'remove_edge', 'set_edge_label', 'add_group', 'set_group', 'remove_group', 'set_direction', 'set_files', 'set_summary', 'mark_note'],
              description: '操作类型',
            },
            id: { type: 'string', description: '节点 id（add_node/set_label/set_shape/set_link/move_node/remove_node/set_group/mark_note 用）' },
            done: { type: 'boolean', description: 'mark_note 用：省略或 true = 把该节点的留言标成已办；false = 重新打开。已办的留言不再进入你的上下文' },
            label: { type: 'string', description: '节点或连线的显示文本；add_group 时作为分组标题；set_summary 时是这张图的一句话总结（传空串清掉）' },
            shape: { type: 'string', description: '节点形状：rect 矩形 / round 圆角 / stadium 胶囊 / circle 圆 / diamond 判定 / cyl 数据库 / hex 六边形 / sub 子流程 / asym 旗形' },
            link: { type: 'string', description: 'set_link / add_node 用：把这个节点下钻到另一张图（图名，不含 .mmd）；传空串取消' },
            from: { type: 'string', description: '连线的起点节点 id' },
            to: { type: 'string', description: '连线的终点节点 id' },
            group: { type: 'string', description: '分组 id；set_group 时传空串表示移出分组' },
            arrow: { type: 'string', description: '连线样式：--> 实线箭头 / --- 无箭头 / -.-> 虚线 / ==> 粗线' },
            x: { type: 'number', description: '画布横坐标（move_node / add_node 用）' },
            y: { type: 'number', description: '画布纵坐标（move_node / add_node 用）' },
            value: { type: 'string', description: 'set_direction 时用：TD / BT / LR / RL' },
            files: {
              type: 'array',
              items: { type: 'string' },
              description: 'set_files 用：这个节点对应的源码文件（项目相对路径，可带 `#符号` 指到具体函数/类）。整组替换；传空数组表示清掉',
            },
          },
          required: ['op'],
        },
      },
      note: { type: 'string', description: '给用户看的一句话说明' },
    },
    required: ['ops'],
  },
  output: {
    schema: OUT_SCHEMA,
    render: function (args, value) {
      try {
        var v = value || {}
        var lines = ['已应用 ' + v.appliedCount + ' 个操作，当前「' + String(v.diagram || '') + '」有 ' + v.nodeCount + ' 个节点、' + v.edgeCount + ' 条连线（修订 ' + v.revision + '）。']
        if (v.done && v.done.length) lines.push('完成：' + v.done.join('；'))
        if (v.problems && v.problems.length) lines.push('未生效：' + v.problems.join('；'))
        if (v.appliedCount > 0) lines.push('（改动过的节点已在用户画布上高亮）')
        return [{ type: 'text', text: lines.join('\n') }]
      } catch (e) {
        return [{ type: 'text', text: 'arch_edit 已完成' }]
      }
    },
  },
  execute: async function (args, exec) {
    var t0 = Date.now()
    await ensureLoaded(whereOfExec(exec), sessionIdOfExec(exec))
    if (doc.absent && !doc.external) {
      logEvent('warn', 'doc.absent', { tool: 'arch_edit', dir: lib.dir })
      return { ok: false, error: '这个项目还没有图库（' + lib.dir + ' 还不存在）。图库不会自动创建——要建先征得用户同意，再用 arch_switch { create: true } 建一张。' }
    }
    var ops = args && Array.isArray(args.ops) ? args.ops : []
    if (ops.length === 0) return toolReject('arch_edit', 'ops 不能为空', t0)
    var expectFile = doc.file
    var before = snapshotNodes()
    var saved = snapshotModel()
    var result = applyOps(ops)
    // **一个 op 都没生效时不写盘、不推修订号**（上面那轮已经修对），但 `doc.notes` 从前照设 ——
    // 面板状态栏于是显示「AI 说：…」，而盘上什么都没变：AI 的说明与事实相反。
    // 所以它必须跟「至少一个 op 生效」绑在一起。
    var saveError = null
    if (result.done.length > 0) {
      if (args && typeof args.note === 'string' && args.note) doc.notes = [args.note]
      bump('ai')
      noteAiChange(before)
      var policy = policyOfAgent(exec && exec.agent)
      saveError = await persistOrRollback(saved, 'arch_edit', policy, expectFile)
    } else {
      // 一个 op 都没生效：不写盘、不推修订号，但**要把上一次的高亮清掉** ——
      // 留着 lastChange.nodes 会让界面继续脉动「AI 刚改了这几个节点」，而这一轮 AI 什么都没改成。
      lastChange = { by: 'ai', rev: doc.revision, nodes: [] }
    }
    // 改完锚点要立刻重算校验状态：`summaryOf()` 会把 doc.fileStatus 一起带回去，
    // 少了这一行，AI 下一步读到的还是**旧锚点字符串**对应的那份缓存 ——
    // 新锚点在缓存里没有条目，于是全部显示「未能校验」，而界面走 doc:get 重算后是 ok。
    // 同一个锚点在人和 AI 两边显示成两种状态，是最难查的那种不一致。
    await verifyFileRefs()
    var out = summaryOf()
    out.mermaid = serializeDoc(doc)
    out.appliedCount = result.done.length
    out.done = result.done
    out.problems = result.problems
    // 同上：落盘失败 ⇒ ok:false，并把原因塞进 problems（AI 先看 problems 再汇报）。
    out.saved = !saveError
    if (saveError) {
      out.ok = false
      out.error = '保存失败，本次改动已回滚：' + saveError
      out.problems = result.problems.concat(['保存失败，本次改动已回滚：' + saveError])
    }
    // AI 每次改图留一行：改的是哪张图、几个 op 没生效、有没有回滚 —— 图不对时先看这里。
    logEvent(saveError || result.problems.length ? 'warn' : 'info', 'tool.arch_edit', {
      diagram: doc.name, key: keyOf(doc.name), file: doc.file,
      ops: ops.length, applied: result.done.length, problems: result.problems.slice(0, 5),
      revision: doc.revision, saved: !saveError, rollback: !!saveError, ms: Date.now() - t0,
    })
    return out
  },
})
onTool(editTool)

// ==================== 每步注入给模型的上下文 ====================
if (systemPromptSvc) {
  try {
    ctx.effect(function () {
      return systemPromptSvc.context({ name: 'arch-canvas', order: 137, text: promptText })
    })
  } catch (e) {
    doc.warnings.push('注册提示词上下文失败: ' + msgOf(e))
    logEvent('error', 'prompt.fail', { error: msgOf(e) })
  }
}

// 挂载现场：这个插件对 console 一字不吐，「挂上了没」以前只能靠人去数注册结果，
// 现在落一行到日志文件里，顺带留下日志目录与形态。
//
// **同进程内同内容只落一行**（0.9.x，治噪音）：hmr 每次构建都会把这份模块重新求值一遍，
// 实测同一次事件里 26 毫秒内连发 4 行、单日 46 行、**逐字节相同**（只有 t 不同）。那种重复
// 对「挂上了没」这个问题没有任何新信息，只会把日志撑成噪音。
// 判据用 `globalThis` 上的一个标记，而**不是**模块级变量：模块被清缓存重载后模块级变量会归零，
// 那正是 4 连发的成因之一。挂载形状（工具/路由/图库/形态）一变，判据就变，于是照旧落一行。
var MOUNT_MARK_KEY = '__archCanvasMountMark'
// **路由数必须反映真实注册数。** RPC 路由（`/arch-canvas/rpc`）是外壳直接推给 webServer 的，
// 不经过宿主逻辑的 `onRoute` —— 只数 `registeredRoutes` 会恒为 2，而实际注册了 3 条：
// AGENTS 把「4 工具 / 3 路由 / 1 提示词上下文」当挂载自检判据，唯一的机器可读记录却永远对不上。
// 外壳实现了 `describeRoutes` 就把它报的也算进来（动态形态没这条路由，自然还是 2）。
var mountRoutePaths = registeredRoutes.slice()
try {
  if (harness && typeof (harness as any).describeRoutes === 'function') {
    var extraRoutes = (harness as any).describeRoutes() || []
    for (var mr = 0; mr < extraRoutes.length; mr++) {
      if (mountRoutePaths.indexOf(extraRoutes[mr]) < 0) mountRoutePaths.push(extraRoutes[mr])
    }
  }
} catch (eMountRoutes) { /* 外壳没提供就退回 registeredRoutes，不影响挂载 */ }
var mountShape = registeredTools.join(',') + '|' + mountRoutePaths.join(',') + '|' + lib.dir + '|' + lib.scope
var mountMark = null
try { mountMark = (globalThis as any)[MOUNT_MARK_KEY] || null } catch (e) { mountMark = null }
if (!mountMark || mountMark.shape !== mountShape) {
  logEvent('info', 'plugin.mount', {
    tools: registeredTools.join(','), toolCount: registeredTools.length,
    routes: mountRoutePaths.join(','), routeCount: mountRoutePaths.length,
    dir: lib.dir, scope: lib.scope, logDir: logDir(), logBackend: logBackend ? 'file' : 'none',
    mounts: (mountMark && mountMark.shape === mountShape && mountMark.n ? mountMark.n : 0) + 1,
  })
  try { (globalThis as any)[MOUNT_MARK_KEY] = { shape: mountShape, n: 1 } } catch (e) { /* 标记写不进去只是少一条去重，不影响挂载 */ }
} else {
  mountMark.n = (mountMark.n || 1) + 1
}

// ==================== 自动扫描：周期重扫图库 ====================
// 面板开着时是 doc:rev 的轮询在驱动重扫；面板关掉后没人驱动了，所以再挂一个慢速定时器 ——
// 别人（git pull、手写、另一个会话）新加的图与散落文件照样会被发现，AI 的上下文也跟着新鲜。
// timer 是可选服务：缺席时插件照常工作，自动扫描退化成「界面在轮询时才扫」。
ctx.inject(['timer'], function (timerCtx) {
  timerCtx.effect(function () {
    return timerCtx.interval(function () {
      // 强制扫：TTL 是给「2.5s 一次的高频轮询」节流的；这个慢速定时器是「没人看的时候」的
      // 兜底扫描器，被 TTL 挡住就等于自动扫描失效。
      refreshLibrary(true).catch(function (e) {
        logEvent('error', 'library.scan.fail', { error: msgOf(e) })
      })
    }, SCAN_INTERVAL_MS)
  })
})

void ensureLoaded()
