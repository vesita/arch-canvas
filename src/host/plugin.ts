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
function foreignCanvasText(sessWhere: string, sameProject?: boolean) {
  // 只说「停在哪个项目」——**不报对方那张图的名字**：名字也是别人的内容，而且它是用户可控文本，
  // 曾经是 `{{` 漏网的入口（审计第 14 条）。
  var parkedGlobal = !doc.external && lib.scope !== 'project'
  var parkedWhere = doc.external
    ? ('项目文件 ' + doc.external)
    : ((lib.scope === 'project' ? '项目图库 ' : '全局兜底图库 ') + lib.dir)
  var sig = sessWhere + '|' + lib.dir
  if (sig !== lastForeignCanvasLogged) {
    lastForeignCanvasLogged = sig
    logEvent('info', 'prompt.foreign-canvas', { parkedDir: lib.dir, session: sessWhere })
  }
  // 同一个项目里的**另一层**（别的会话刚下钻到 B 子图库）：这不是「别的项目」，
  // 报成「别的项目」会让模型以为自己没有画布。分开说，下一步的动作也不同。
  if (sameProject) {
    return [
      '## 逻辑框架画布（arch-canvas）',
      '**画布现在停在同一个项目里的另一张图上**（' + parkedWhere + '）—— 那是别的会话刚切过去的层。',
      '这一轮你看不到画布内容（读给你的会是别人那张图）。要看自己的图：调一次 `arch_read`，' +
        '它会按你的工作目录、以及你这个会话选过的那一层，把画布切回来。',
    ].join('\n')
  }
  // 兜底图库**不属于任何项目**：把它报成「别的项目」方向正好反了。2026-10-11 现场：重启后
  // cwd 在项目里的会话读到「停在别的项目上（全局图库 …）」，而它自己只是还没建过图库 ——
  // 模型据此以为「我有画布、只是被别人占了」，其实它连图库都还没有。
  if (parkedGlobal) {
    var wantLib = resolveLibCanonical(sessWhere)
    return [
      '## 逻辑框架画布（arch-canvas）',
      '**画布现在停在全局兜底图库**（`' + lib.dir + '`）——它不属于任何项目。你这个会话的项目是 `' + sessWhere + '`。',
      '这个项目的图库是 `' + wantLib.dir + '`：这一步**没有明确的画布需求就默认不需要画布**，别追问、别提议，忽略这一段即可。' +
        '用户明确要画 / 要看时：还没有图库就先征得他同意再用 `arch_switch { create: true }` 建，已经有就调一次 `arch_read` 切过来。',
      '提示词这一侧**不会**把兜底图库或别的项目的图读给你，也不会替它消费留言 —— 所以这一轮你看不到任何画布内容，别对上面那张图做任何操作。',
    ].join('\n')
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
  var sessId = sessionIdOfExec({ agent: asctx && asctx.agent })
  if (typeof sessWhere === 'string' && sessWhere) {
    if (!docBelongsTo(sessWhere, sessId)) {
      // 先试着**同步**把自己项目那一份换进来（命中内存槽就不用等下一次）；命中不了才给说明。
      // 这里**不排异步加载**：提示词注入是每一步都会跑的读路径，在这里发起的加载会与
      // 别的会话的切库抢同一个「当前文档」（宿主只有一份活动指针），实测会把一份**空文档**
      // 当成某个项目的槽存下来。要自己的画布，走 `arch_read` —— 那条路带着会话 cwd，
      // 目标明确、也不会把中间态写进别人的槽。
      if (!syncWorkspaceFor(sessWhere, sessId)) {
        return promptSafe(foreignCanvasText(sessWhere, sameProjectAsCurrent(sessWhere, sessId)))
      }
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
  // **检测范围要说清**：图库跟着项目走，而「项目」是**会话目录**这一棵 —— 自动扫描只列
  // 会话目录及其子目录里的 `.arch-canvas`。图库根可以在上层（会话坐在项目子目录里），
  // 但兄弟目录、容器目录下的别的项目一律不进这张清单。
  // 锚点取**这一步的会话目录**（`sessWhere`），不读 `root.scanFrom`：槽是按图库目录共享的，
  // 而两个会话可能分别坐在项目根与它的子目录里（同一个槽、两个锚点）—— 读那个字段就会
  // 把**上一个请求**留下的锚点说成这一步的范围（实测：cwd=`my/laya` 的会话被告知范围是
  // `my/laya/src`）。拿不到会话信息（工具/测试桩/headless）时才退回记住的那个锚点。
  var relAnchor = ''
  if (lib.scope === 'project' && root.workspace) {
    var rootW = String(root.workspace).replace(/\/+$/, '')
    var anchor = rootW
    if (typeof sessWhere === 'string' && sessWhere) {
      var sessDir0 = sessWhere.replace(/\/+$/, '')
      // 只认「在图库根里面」的会话目录；判不出来就用图库根，不编一个范围
      if (sessDir0 === rootW || sessDir0.indexOf(rootW + '/') === 0) anchor = sessDir0
    } else {
      anchor = String(root.scanFrom || rootW).replace(/\/+$/, '')
    }
    relAnchor = anchor
    head.push('检测范围：**' + anchor + ' 及其子目录**' +
      (anchor === rootW ? '' : '（图库根在上一层：`' + rootW + '`，key 以它为基准）') +
      '；不在这个范围里的目录不会被列进来。')
  }
  if (doc.external) {
    head.push('它是按路径打开的项目文件（不属于任何图库），你的改动落盘写回它本身。')
  }
  // 一句话总结：这是「读这张图之前先知道它讲的是什么」的那一行，作用与 skill 的描述行一样 ——
  // 所以紧跟定位行，且不截断（它本身有 500 字上限）。
  if (doc.summary) head.push('', '**这张图讲的是**：' + doc.summary)
  // 目录关系按**这一步的锚点**重算（清单缓存是共享的，锚点会随请求变）
  var relItems = withRel(libraryCache, relAnchor)
  var others = []
  for (var i = 0; i < relItems.length; i++) {
    var it = relItems[i]
    if (it.deleted || it.key === curKey) continue
    var itSum = typeof it.summary === 'string' && it.summary ? it.summary : ''
    if (itSum.length > 60) itSum = itSum.slice(0, 60) + '…'
    // 方括号里是它**相对会话目录**的位置。只在「不在会话目录自己那一格图库」时才加：
    // 自家图库那一格是默认情形（检测范围那行已经写明），加了纯噪音；而子目录里的另一层、
    // 以及图库根在会话目录**之上**的那些（相对位置给的是绝对路径），恰恰是必须点出来的。
    var itRel = it.relOutside ? '[' + it.rel + ']' : ''
    others.push('「' + it.key + '」' + itRel + (itSum ? '：' + itSum : '') + '(' + it.nodes + ' 节点' + (it.links ? '、' + it.links + ' 处下钻' : '') + ')')
  }
  if (others.length > 0) {
    head.push('', '同图库还有（方括号里是它相对会话目录的位置）：' + others.join('、') + '。切过去用 `arch_switch`（用户画布会跟着切），只看不改用 `arch_read` 带 `diagram`。')
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
    var listed = openNotes.length > MAX_LIST_ITEMS ? MAX_LIST_ITEMS : openNotes.length
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
    head.push('- 另有 ' + nc.done + ' 条留言已经投递过（在历史里）：**没有列出来，也不要据此行动**；要回看历史留言用 `arch_read` 的 `notes: true`。')
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
    for (var rk2 = 0; rk2 < refLines.length && rk2 < MAX_LIST_ITEMS; rk2++) head.push(refLines[rk2])
    if (refLines.length > MAX_LIST_ITEMS) head.push('- …还有 ' + (refLines.length - MAX_LIST_ITEMS) + ' 个节点带锚点，完整内容见文件。')
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
    var out = fullOf()
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
    var out = fullOf()
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
    var out = fullOf()
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
      var out = fullOf()
      out.saved = !err
      if (err) out.error = err
      return out
    }
    return fullOf()
  })
})

