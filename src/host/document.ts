// 文档状态：图库定位（跟项目走）、加载/落盘、模型规范化、增量 op 应用、坐标继承。
// 只依赖 apply(ctx) 闭包里的 ctx / harness，不引任何模块。
// ==================== 文档状态 ====================
// 数据目录（全局图库与日志写在哪）由外层注入：真插件按 $DSH_HOME / ~/.dsh 算，
// 动态开发形态递它自己那份本机路径。宿主逻辑里不写死用户目录 —— 写死了包就只能在
// 本机用：tarball 装到别处，全局图库与日志会指向一个不存在的家目录。
var DATA_DIR = (typeof hostEnv === 'object' && hostEnv && typeof hostEnv.dataDir === 'string' && hostEnv.dataDir) ? hostEnv.dataDir : ''
if (!DATA_DIR) throw new Error('hostEnv.dataDir 没给：外层必须告诉插件数据目录（全局图库与日志的落点）')
var DSH_ROOT = DATA_DIR.replace(/\/[^/]+$/, '')
// 图库跟着项目走：<项目>/.arch-canvas/*.mmd —— 你在哪个项目里讨论，就打开那个项目的图库。
// 但图的内容不与代码绑死：它表达的是**讨论中的逻辑框架**，可以刻意与代码不一致。
// 识别不出项目时（没绑工作区、或界面还没回报）回退到全局图库。
var GLOBAL_DIR = DATA_DIR
var PROJECT_SUBDIR = '.arch-canvas'
var DEFAULT_DIAGRAM = 'architecture'
/** 上一次真正落过 doc.load 的内容键：用来把「同一份图被反复读进来」的重复行压掉。 */
var lastDocLoadKey = ''
// 软删除：文件里出现这行即视为已删除，列表里隐藏但内容原样保留。
// fs 服务没有 unlink/rename，而我不愿意为了删两个文件给插件开 bash 权限；
// 软删除反而更契合「记录思路」——删错了能捞回来，彻底删由你自己 rm。
var TOMBSTONE = '%% @deleted'
// mermaid 的第一来源是包内 assets/（由外层递 mermaidFile），这里是早期手工下载的缓存。
var MERMAID_CACHE = DSH_ROOT + '/.cache/arch-canvas/mermaid.min.js'
// 合法连接符集合。**从 ARROWS 派生，绝不手抄第二份**：从前这里只有 8 种，而 ARROWS 有 28 种，
// 于是 `--o` / `o==>` 等 20 种在 normalizeModel / add_edge 里被静默退成 `-->` —— 用户画的是圆头，
// 落盘成了实线箭头，零警告。归一发生在 adoptModel 里、**早于** persist() 的往返检查，
// 所以那条检查也看不见。ARROWS（mermaid.ts）与这里在同一段作用域里拼接，是唯一一张表。
var ARROW_SET = {}
for (var arrowSetIdx = 0; arrowSetIdx < ARROWS.length; arrowSetIdx++) ARROW_SET[ARROWS[arrowSetIdx]] = 1
var DIR_SET = { TD: 1, TB: 1, BT: 1, LR: 1, RL: 1 }

var fs = ctx.get('fs')
var systemPromptSvc = ctx.get('systemPrompt')
var sandboxPolicySvc = ctx.get('sandboxPolicy')
var agentsSvc = ctx.get('agents')

// webServer 不在这里取快照（服务何时可用由 Cordis 定，行顺序不承载加载语义）：
// 快照一次的后果是路由静默 404。路由交给 harness.route 登记，由外层在就绪后注册。

// root：会话所在项目对应的图库（「根」）。lib：当前打开的那一层，可能是根，也可能是某个子项目。
// 图引用一律用「相对根的 key」：`架构` 是根的图，`支付/对账` 是子项目「支付」的图库里的图。
// 只此一条规则 —— 没有 ./ 也没有 ../，这样列表、AI、链接三处写法完全一致。
// `scanFrom` / `scanRel` 是**检测锚点**：会话目录，以及它相对图库根的子路径。
// 自动扫描只走会话目录这一棵（图库根可能在上层），这样检测范围永远 = 会话目录及其子目录。
var root = { dir: GLOBAL_DIR, scope: 'global', workspace: '', scanFrom: '', scanRel: '' }
var lib = { dir: GLOBAL_DIR, scope: 'global', workspace: '' }
var loadedFor = null      // 内存里这份文档来自哪个 dir
var everLoaded = false    // 是否已经载入过 —— 首次载入不 bump 修订号（「刚载入」就是 0）
var loadQueue: Promise<any> = Promise.resolve()  // 载入/切库的串行队列
// 提示词上下文是同步求值的，不能 await，所以清单走缓存；周期扫描让它自己保持新鲜。
var libraryCache = []
var libraryCacheAt = 0        // 上次**扫描**的时刻（TTL 门）：扫描只走目录，所以可以几秒一次
var libraryFiles = []         // 项目里散落的 .mmd / .mermaid（自动扫描的副产物，按路径打开用）
var libraryFingerprint = ''   // 上次扫描的**便宜**指纹（目录 + 文件名 + 字节数）
// 上次**真读了文件**那一趟算出来的内容指纹（节点/边/下钻/总结）。同字节数的改写
// （改一个词、删两个节点再补个空格）在 `name:bytes` 上看不出来，只有它看得见。
var libraryItemsFingerprint = ''
var libraryRev = 0            // 图库清单修订号：界面靠它发现「有新图了」并自动刷新

/**
 * 一份**全新的**空白文档状态。换项目时必须用它造新对象，而不是在原地改旧的 ——
 * 内存槽里存的是文档对象**引用**，原地改会把上一个项目那份一起改掉
 * （2026-09-23 实测：X 的槽会变成 Y 的内容，回到 X 就等于丢了 X 的图）。
 */
function newDocState() {
  return {
    name: DEFAULT_DIAGRAM,
    nodes: [], edges: [], groups: [], extras: [],
    direction: 'TD', revision: 0, updatedBy: 'init', updatedAt: Date.now(),
    file: '', warnings: [], notes: [], tombstoned: false,
    // 整张图的一句话总结（`%% @summary`）：图级字段，不挂节点。进提示词的头部，
    // 也随图库清单回给界面 —— 它回答的是「这张图讲的是什么」，不必读完整个文件。
    summary: '',
    absent: false,
    // 代码锚点的失效校验结果（派生数据，不落盘）：{ 节点id: { 引用: 'ok'|'missing'|'symbol-missing'|'unknown' } }
    fileStatus: {},
    // 锚点保鲜报告（派生数据，不落盘；见 drift.ts）：{ stale:[{node,ref}], uncovered:[{dir,files}], baseline, … }
    // fileStatus 只说「文件/符号还在不在」，它答不了「函数还在但已经不是图上说的那个东西了」——
    // 那个要靠和落盘时记下的**内容指纹**比对，就是 drift.stale。
    drift: null as any,
    // 打开的是项目里某个 .mmd / .mermaid 文件时，这里放它的绝对路径（图库里的图是 null）。
    // 有它就意味着「别被图库加载冲掉」+ 提示词里要写明这张图的真相源是哪个文件。
    external: null,
  }
}
var doc = newDocState()
// 最近一次改动的来源与涉及节点。界面拿它把 AI 刚动过的地方高亮出来 ——
// 「图变了」和「变在哪」是两件事，后者才是沟通。
var lastChange = null

function msgOf(e) {
  if (e && typeof e === 'object' && typeof e.message === 'string') return e.message
  return String(e)
}

function cleanName(raw) {
  var s = String(raw == null ? '' : raw).replace(/[\/\\:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim()
  if (s === '' || s === '.' || s === '..') return DEFAULT_DIAGRAM
  return s.slice(0, 60)
}

function hasTombstone(text) { return /^\s*%%\s*@deleted/.test(text) }

function bump(by) {
  doc.revision += 1
  doc.updatedBy = by
  doc.updatedAt = Date.now()
}

function adopt(parsed) {
  doc.nodes = parsed.nodes
  doc.edges = parsed.edges
  doc.groups = parsed.groups
  doc.extras = parsed.extras || []
  doc.direction = parsed.direction || 'TD'
  // 一句话总结是图级的，解析器直接给出来；解析结果里没有就归零（删掉那一行 = 真的删掉）。
  doc.summary = cleanSummary(parsed.summary)
  // 解析器发现的异常行、指向不存在节点的注释 —— 这些是「图悄悄少了一块」的唯一线索，
  // 收进 warnings 供 RPC / 日志带出去，别让它烂在解析结果里。
  var parsedWarnings = parsed.warnings || []
  for (var i = 0; i < parsedWarnings.length; i++) {
    if (doc.warnings.length < 50) doc.warnings.push(parsedWarnings[i])
  }
  applyNoteStore(doc.file, doc.nodes, parsed.legacyNotes)
}

function emptyDoc() {
  return { nodes: [], edges: [], groups: [], extras: [], direction: 'TD', warnings: [] }
}

function seedDoc() {
  return parseMermaid([
    'flowchart TD',
    '  n1["用户界面 (Web GUI)"]',
    '  n2["会话与工具编排"]',
    '  n3[("持久化状态")]',
    '  n4{"是否需要用户确认?"}',
    '  n5["同步执行"]',
    '  n1 -->|"输入 / 操作"| n2',
    '  n2 -->|"读写"| n3',
    '  n2 --> n4',
    '  n4 -->|"否"| n5',
    '  n4 -->|"是"| n1',
    '  n5 -.->|"事件流"| n1',
    '',
    '%% @pos n1 0 0',
    '%% @pos n2 0 140',
    '%% @pos n3 300 140',
    '%% @pos n4 0 300',
    '%% @pos n5 -190 460',
  ].join('\n'))
}

// 记录沙箱策略缺失原因，同原因只报一次，防止高频刷屏
var reportedSandboxMissingReasons = {}
// 落盘时没有沙箱策略的入口（按 site 去重）。见 persist() 里的说明：缺策略的写入从前是匿名的。
var reportedNoPolicySites = {}
// 往返检查那条告警的前缀（置顶只留一条用）
var RT_WARN_PREFIX = '往返检查：写出去再读回来对不上'
// 「保存失败已回滚」那条警告的前缀。它描述的是一个**瞬时**状态，所以成功落盘时要把它清掉 ——
// doc.warnings 只在加载时清空，留着的话画布页会一直挂着一条「图可能少了一块」，
// 里面装的却是一条早就不成立的落盘失败（2026-09-24 客户端审计附带发现）。
var SAVE_FAIL_PREFIX = '保存失败，本次改动已回滚'

/**
 * 获取会话对应的沙箱执行策略。
 * 必须传会话：fs 服务的写入受按调用沙箱策略约束，若不传会退回后端默认（部署工作区根，而非当前项目）。
 * 绝不自己声明 mode：传 mode 会被视为「一次已批准的显式模式」从而覆盖会话自身的模式（权限放大）。
 * 只传 { session }，由策略归属方 sandboxPolicy 决定真实的 mode 与 workspaceRoot。
 */
function policyOfSession(sess) {
  if (!sess) {
    if (!reportedSandboxMissingReasons['no-session']) {
      reportedSandboxMissingReasons['no-session'] = true
      logEvent('warn', 'sandbox.policy.missing', { reason: 'no-session' })
    }
    return undefined
  }
  if (!sandboxPolicySvc || typeof sandboxPolicySvc.resolve !== 'function') {
    if (!reportedSandboxMissingReasons['no-service']) {
      reportedSandboxMissingReasons['no-service'] = true
      logEvent('warn', 'sandbox.policy.missing', { reason: 'no-service' })
    }
    return undefined
  }
  try {
    return sandboxPolicySvc.resolve({ session: sess })
  } catch (e) {
    var r = 'resolve-failed:' + msgOf(e)
    if (!reportedSandboxMissingReasons[r]) {
      reportedSandboxMissingReasons[r] = true
      logEvent('warn', 'sandbox.policy.missing', { reason: r })
    }
    return undefined
  }
}

function policyOfAgent(agent) {
  return policyOfSession(agent && agent.session)
}

function policyOfSessionId(id) {
  if (!id) return undefined
  if (!agentsSvc || typeof agentsSvc.get !== 'function') {
    if (!reportedSandboxMissingReasons['no-agents-service']) {
      reportedSandboxMissingReasons['no-agents-service'] = true
      logEvent('warn', 'sandbox.policy.missing', { reason: 'no-agents-service' })
    }
    return undefined
  }
  try {
    var agent = agentsSvc.get(id)
    return policyOfAgent(agent)
  } catch (e) {
    var r = 'agents-get-failed:' + msgOf(e)
    if (!reportedSandboxMissingReasons[r]) {
      reportedSandboxMissingReasons[r] = true
      logEvent('warn', 'sandbox.policy.missing', { reason: r })
    }
    return undefined
  }
}

/**
 * 落盘。`site` 只是记进检查点标签（谁在哪儿改的），不影响写什么。
 * 写成功之后在这里记一份检查点 —— 这是唯一的收口：所有写入路径都经过 persist，
 * 于是「AI 改的」「用户改的」自动都留档，不需要每个调用点各自记得。
 *
 * `expectFile` 是**这次写入认下的那份文档**（调用方在 `await ensureLoaded()` 之后立刻取
 * `doc.file`）。为什么要有它：`doc`/`lib`/`root` 是模块级全局，而一次请求里只要出现 await，
 * 别的会话的切库就可能把指针换走 —— 那时这一版改动会写进**别人的项目文件**
 * （2026-09-24 宿主审计第 1 条，实测 A 会话的 arch_edit 改掉了 B 项目的图）。
 * 指针切换现在已经排进加载队列（见 ensureLoaded），这里再兜一道：认下的文件变了就拒写。
 */
async function persist(policy?, site?, expectFile?) {
  if (!fs) return 'fs 服务不可用'
  if (typeof expectFile === 'string' && expectFile && doc.file !== expectFile) {
    logEvent('error', 'persist.stale-doc', { site: site || '', expected: expectFile, actual: doc.file })
    return '文档已被别的会话切换（认下的是 ' + expectFile + '，现在是 ' + doc.file + '），本次改动未写入'
  }
  // `policy` 缺席意味着这次写是 **agentless call** —— 它会掉到部署默认的可写根，
  // 而不是这个会话的工作区。这正是当初「面板上每一次保存都被拒、日志却照写不误」的形态。
  //
  // 从前它只在上游 policyOfSessionId 里记一条不带现场的警告（而且 `!id` 那条路连警告都没有），
  // 于是 2026-09 的日志里躺着 6 条 `sandbox.policy.missing / no-session`，谁在写、写哪个文件
  // 一概看不到 —— 按这个项目自己的规矩，那就等于匿名。这里按 site 去重记一条能指路的。
  if (!policy) {
    var pk = String(site || 'unknown')
    if (!reportedNoPolicySites[pk]) {
      reportedNoPolicySites[pk] = true
      logEvent('warn', 'persist.no-policy', { site: pk, file: doc.file, scope: lib.scope })
    }
  }
  // **入口检查一过，立刻把「要写什么」固定成本地快照。** 这之后的每一个 await 都是一个窗口：
  // 别的会话的切库能把 doc / lib / root 一起换掉。从前的写法在这些 await 之后才取
  // `var body = serializeDoc(doc)`、`doc.nodes`、`doc.file`，于是：
  //   · A 项目 absent 时第一次写盘 → 把**B 的图**写进了 A 的 .mmd，A 的编辑一个字没落盘（回执还是 saved:true）；
  //   · A 的正文被推进 **B 的文件名**下的检查点，B 一退回就把自己的 .mmd 换成 A 的内容。
  // 快照之后，这一版写入只认它自己那一份；旁路表 / 基线表 / 检查点这些**旁的状态**
  // 每次落之前还要再复核一次归属，被抢走就记 persist.doc-stolen 并什么都不写。
  var fileNow = doc.file
  var absentNow = doc.absent
  var nodesNow = doc.nodes
  var body = serializeDoc(doc)
  // **写盘前的运行时不变式**（见 mermaid.ts 的 roundTripDetail）：`parse(serialize(doc))`
  // 必须与 doc 在所有会被持久化的字段上一致。它**只报告、不改行为** —— 拒绝保存比丢字段更糟：
  // 用户当下的编辑一个字都存不下去，而字段在文本里表达不出来就是表达不出来
  // （检查点回滚也救不了，快照存的就是同一份文本）。所以照旧写盘，但把现场喊出来。
  try {
    var rt = roundTripDetail(doc)
    if (rt) {
      logEvent('error', 'serialize.not-idempotent', {
        site: site || '', file: fileNow, fields: rt.fields, detail: rt.detail,
      })
      var rtWhere = rt.detail ? Object.keys(rt.detail).map(function (k) { return k + '[' + rt.detail[k].join(' ') + ']' }).join(' ') : ''
      var rtMsg = RT_WARN_PREFIX + '（' + rt.fields.join('、') + '）'
        + (rtWhere ? ' ' + rtWhere : '') + ' —— 详见日志 serialize.not-idempotent'
      // 只留一条：这条说的是「当前状态写不出去」，不是历史流水；每保存一次追加一条会刷屏
      doc.warnings = doc.warnings.filter(function (w) { return String(w).indexOf(RT_WARN_PREFIX) !== 0 })
      doc.warnings.push(rtMsg)
    }
  } catch (e) {
    logEvent('error', 'serialize.check.fail', { site: site || '', file: fileNow, error: msgOf(e) })
  }
  // 软删除过的图再落盘时要把墓碑保住，否则一次无关的写就把「已删除」抹掉了
  if (doc.tombstoned) body = TOMBSTONE + '\n' + body
  try {
    // **墓碑守卫。** 认下的文件此刻已经带着 `%% @deleted`，而内存这份文档并不认为自己是墓碑
    // （典型：`doc:delete` 把画布从刚打上墓碑的那份内容上撤走之后）—— 再写一次就等于
    // 把用户的「已删除」静默抹掉。「恢复」是 `doc:restore` 的活，不是一次无关保存的副作用。
    if (!doc.tombstoned) {
      try {
        var guardInfo = await fs.stat(await fs.resolve(fileNow))
        if (guardInfo) {
          var guardText = await fs.readText(await fs.resolve(fileNow))
          if (hasTombstone(guardText)) {
            logEvent('error', 'persist.tombstone-guard', { site: site || '', file: fileNow })
            return '目标文件已被软删除（%% @deleted），本次改动未写入；要恢复请先 doc:restore'
          }
        }
      } catch (eGuard) { /* 读不到就不拦：让真正的写入去报那个错 */ }
    }
    if (absentNow) {
      var targetDir = fileNow.slice(0, fileNow.lastIndexOf('/'))
      await ensureDir(targetDir, policy)
    }
    // 写 .mmd 用**认下的那个路径与那份正文**（不是当下的 doc.file / doc）—— 落盘过程中
    // 指针被换走时，这一版改动仍然只落在它自己的文件里。
    await fs.writeText(await fs.resolve(fileNow), body, undefined, undefined, policy)
    if (doc.file !== fileNow) {
      // 指针在落盘期间被别的会话换走了。.mmd 已经写对（用的是认下的路径），但**旁路表与检查点都要跳过**：
      // 它们的键与字段从前取自**当下**的 doc，而那已经是别人的了 ——
      // 记一条检查点就是把 A 的改动写进 B 的历史（实测：B 的 doc:history 里多一条 site:'doc:set'，
      // 退回它能把 A 的节点写进 B 的文件）。少一份历史，好过污染别人的历史。
      logEvent('error', 'persist.doc-stolen', { site: site || '', expected: fileNow, actual: doc.file })
      return null
    }
    doc.absent = false
    // **先读表再收表。** 没读过的表在缓存里是空的，收完一写就把整个图库所有图的留言
    // 覆盖成空（见 notes.ts 的两道闸）。读失败/坏表时 loadNoteStoreFor 会记日志，
    // 随后 writeSidecarJson 的第二道闸会拒绝覆盖。
    await loadNoteStoreFor(fileNow)
    if (doc.file !== fileNow) {
      logEvent('error', 'persist.doc-stolen', { site: site || '', expected: fileNow, actual: doc.file })
      return null
    }
    // 收表用的是**认下的那份节点**：用当下的 doc.nodes 会把 B 的留言收进 A 的表。
    harvestNoteStore(fileNow, nodesNow)
    var noteErr = await saveNoteStoreFor(fileNow, policy)
    if (noteErr) {
      logEvent('warn', 'notes.persist.fail', { file: fileNow, error: noteErr })
      if (doc.file === fileNow) doc.warnings.push('留言表保存失败: ' + noteErr)
    }
    // 锚点指纹基线（见 drift.ts）：**只在这一条写路径上记** —— 图刚落盘，此刻的代码就是
    // 这张图所描述的那份代码。读路径一个字节都不写（那是这个项目的硬规矩）。
    //
    // 失败**只记日志、不挂警告**：它只是这一轮没记上基线（drift 会如实说 baseline=false），
    // 图本身完好、也没有用户能采取的动作 —— 把它塞进「解析警告」那条横幅只会稀释真正的坏消息。
    var driftErr = await saveDriftStampsFor({ file: fileNow, nodes: nodesNow }, policy)
    if (driftErr) logEvent('warn', 'drift.persist.fail', { file: fileNow, error: driftErr })
    if (doc.file !== fileNow) {
      logEvent('error', 'persist.doc-stolen', { site: site || '', expected: fileNow, actual: doc.file })
      return null
    }
    // 这一次成功落盘了 ⇒ 上一次那条「保存失败，本次改动已回滚」不再成立，别让它继续挂在横幅上。
    doc.warnings = doc.warnings.filter(function (w) { return String(w).indexOf(SAVE_FAIL_PREFIX) !== 0 })
    // 走到这里归属已经复核过 ⇒ historyKey() 就是 fileNow（history.ts 不在本次可改范围内，
    // 「认下自己的文件」这一条由上面三道复核保证）。
    pushHistory(body, site)
    return null
  } catch (e) {
    return msgOf(e)
  }
}

/**
 * 会话目录串 → 规范化的检测锚点（空串 = 没有会话信息，退回图库根）。
 * RPC 侧拿 `args.where`（面板每个请求都带 where=会话 cwd），工具侧拿 `whereOfExec(exec)`。
 */
function cleanSessionDir(v) {
  return (typeof v === 'string') ? v.trim().replace(/\/+$/, '') : ''
}
function sessDirOf(args) { return cleanSessionDir(args && args.where) }

/**
 * 从工具执行上下文里取**会话目录**（DSH 的 cwd）。`ToolExecutionInput.agent` 是「这次调用代表谁」，
 * 会话目录挂在 `agent.session.header.cwd` 上 —— 这是 DSH 全仓的读法
 * （`dsh-agent-instructions/lib/index.js:1122`、`dsh-agent-loop/lib/index.js:1566` 都走这一条），
 * 也是「AI 侧的调用不会跑错图库」唯一依据。
 *
 * 2026-10-08 修复：从前这里读 `a.cwd` / `a.session.cwd` / `a.header.cwd` —— **三个字段都不存在**，
 * 于是每一次都取到 undefined，两个后果一起发生：
 *   ① 提示词那侧跳过整个「画布属于项目」的判断（`promptText` 只在 sessWhere 非空时才判归属），
 *      把进程全局那份画布注入给这一步 —— 挂载时是全局图库，之后是**别的会话刚切过去的项目**；
 *   ② 四个 AI 工具丢掉 where，沿用当前指针（`ensureLoaded(undefined)` 保持现状）。
 * 现场：cwd=`/home/vesita/coding/my` 的会话被注入 `~/.dsh/arch-canvas` 里的
 * `laya-architecture` / `phone-ssh-ca` —— 两张**别的项目目录**的图。会话目录检测等于没有。
 *
 * 旧名字仍留在候选表里：测试桩与将来的形状变化都不该让这里静默退回 undefined。
 */
function whereOfExec(exec) {
  try {
    var a = exec && exec.agent
    if (!a) return undefined
    var sess = a.session
    var cands = [
      sess && sess.header && sess.header.cwd,
      a.cwd,
      sess && sess.cwd,
      a.header && a.header.cwd,
    ]
    for (var i = 0; i < cands.length; i++) {
      if (typeof cands[i] === 'string' && cands[i]) return cands[i]
    }
  } catch (e) {}
  return undefined
}

/**
 * 从工具执行上下文里取会话 id —— 落盘要用它换一份沙箱策略（见 policyOfSessionId）。
 * 取不到就返回 undefined：那一路退回「不传策略」的旧行为，而不是伪造一把更宽的围栏。
 */
function sessionIdOfExec(exec) {
  try {
    var a = exec && exec.agent
    if (!a) return undefined
    if (a.session && a.session.id) return a.session.id
    if (a.id) return a.id
  } catch (e) {}
  return undefined
}

async function listDiagrams(dir) {
  var items = []
  if (!fs) return items
  var entries = []
  try {
    var t = await fs.resolve(dir)
    var info = await fs.stat(t)
    if (info) entries = await fs.listDir(t)
  } catch (e) {
    return items
  }
  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i]
    if (entry.type !== 'file') continue
    if (entry.name.slice(-4) !== '.mmd') continue
    var text = ''
    try {
      text = await fs.readText(entry.target)
    } catch (e) {
      continue
    }
    var parsed = parseMermaid(text)
    items.push({
      name: entry.name.slice(0, -4),
      deleted: hasTombstone(text),
      nodes: parsed.nodes.length,
      edges: parsed.edges.length,
      links: parsed.nodes.filter(function (n) { return !!n.link }).length,
      bytes: entry.size || text.length,
      summary: cleanSummary(parsed.summary),
    })
  }
  items.sort(function (a, b) {
    if (a.deleted !== b.deleted) return a.deleted ? 1 : -1
    return a.name.localeCompare(b.name)
  })
  return items
}

/**
 * 保证目录存在。fs 服务没有 mkdir，所以先试「写一个占位文件」——
 * 多数后端在写文件时会顺手建父目录；不行再问 directoryPickerController。
 * 占位文件用 .gitkeep，顺便让这个目录容易被纳入版本管理。
 */
async function ensureDir(path, policy?) {
  if (!fs) return false
  try {
    var t = await fs.resolve(path)
    if (await fs.stat(t)) return true
  } catch (e) {}
  try {
    await fs.writeText(await fs.resolve(path + '/.gitkeep'), '', undefined, undefined, policy)
    forgetProjectRootsUnder(String(path).replace(/\/\.arch-canvas$/, ''))
    return true
  } catch (e) {}
  try {
    var dp = ctx.get('directoryPickerController')
    if (dp && typeof dp.createDirectory === 'function') {
      await dp.createDirectory(path.replace(/\/[^/]+$/, ''), path.replace(/^.*\//, ''))
      forgetProjectRootsUnder(String(path).replace(/\/\.arch-canvas$/, ''))
      return true
    }
  } catch (e) {}
  return false
}

function cleanSeg(raw) {
  return String(raw == null ? '' : raw).replace(/[\/\\:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim()
}

/** key → { project, name }。project 为空表示根图库。 */
function splitKey(key: string): { project: string; name: string } {
  var raw = String(key == null ? '' : key).replace(/\\/g, '/').trim()
  var segs = raw.split('/')
  var name = cleanName(segs.pop() || '')
  var proj = []
  for (var i = 0; i < segs.length; i++) {
    var seg = segs[i].trim()
    if (seg === '' || seg === '.') continue
    if (seg === '..') { proj.pop(); continue }
    proj.push(cleanSeg(seg))
  }
  return { project: proj.join('/'), name: name }
}

function libOf(project: string): { dir: string; scope: string; workspace: string } | null {
  if (!project) return { dir: root.dir, scope: root.scope, workspace: root.workspace }
  var base = String(root.workspace || '').replace(/\/+$/, '')
  if (!base) return null // 没有项目可言，就没法引用子图库
  var ws = base + '/' + project
  return { dir: ws + '/' + PROJECT_SUBDIR, scope: 'project', workspace: ws }
}

/** 一张图在图库里的完整定位：key 的两段 + 它落在哪个目录/哪一层。 */
interface DiagramKey {
  project: string
  name: string
  dir: string
  scope: string
  workspace: string
}

function resolveKey(key: string): DiagramKey | null {
  var k = splitKey(key)
  var target = libOf(k.project)
  if (!target) return null
  // 返回新对象而不是往 k 上挂字段 —— 后者 TS 推不出来，而且会悄悄改变 splitKey 的返回形状
  return {
    project: k.project, name: k.name,
    dir: target.dir, scope: target.scope, workspace: target.workspace,
  }
}

/** 当前这一层相对根的子路径（根层为空串）。 */
function projectRel() {
  if (root.scope !== 'project' || !root.workspace || !lib.workspace) return ''
  if (lib.workspace === root.workspace) return ''
  if (lib.workspace.indexOf(root.workspace + '/') !== 0) return ''
  return lib.workspace.slice(root.workspace.length + 1)
}

function keyOf(name: string, project?: string) {
  var p = project === undefined ? projectRel() : project
  return p ? p + '/' + name : name
}

function fileAt(dir, name) { return dir + '/' + name + '.mmd' }

/** 节点的下钻链接统一按 key 存（允许 `子项目/图名`）；空串表示没有链接。 */
function normLink(v) {
  var t = typeof v === 'string' ? v.trim() : ''
  if (t === '') return null
  var k = splitKey(t)
  return keyOf(k.name, k.project)
}

/** 能直接打开的 mermaid 文件：整份文件就是一张图。 */
function isDiagramPath(p) {
  return DIAGRAM_EXT_RE.test(String(p == null ? '' : p))
}

/**
 * 把用户给的路径弄成绝对路径：绝对路径照用，相对路径按项目根（没有项目根就按当前图库）。
 * 不限制「必须在自己的项目里」—— 路径是用户自己敲的，fs 服务那边自有它的边界，越界会明确报错。
 */
function resolveDiagramPath(raw) {
  var p = String(raw == null ? '' : raw).trim().replace(/\\/g, '/')
  if (p === '') return ''
  p = p.replace(/^\.\//, '').replace(/\/{2,}/g, '/')
  if (p.charAt(0) === '/') return p
  var base = String((root && root.workspace) || (lib && lib.dir) || '').replace(/\/+$/, '')
  if (!base) return ''
  return base + '/' + p
}

function baseNameOf(path) {
  var s = String(path == null ? '' : path).replace(/\\/g, '/')
  var i = s.lastIndexOf('/')
  return cleanName(s.slice(i + 1).replace(DIAGRAM_EXT_RE, ''))
}

/**
 * 打开项目里任意位置的一个 mermaid 文件：此后画布编辑的就是这个文件本身（落盘写回原路径）。
 * 它不属于任何图库，所以不参与改名/软删除那一套 —— 这张图的「key」就是路径。
 */
async function openExternal(path, create, policy?) {
  if (!fs) return { ok: false, error: 'fs 服务不可用' }
  if (!isDiagramPath(path)) return { ok: false, error: '只支持 .mmd / .mermaid 文件：' + path }
  // **认下这一趟的归属。** 打开外部文件同样是「换当前文档」：读盘期间别的会话把指针换走之后，
  // 从前的写法照样 `doc.external = path; adopt(...)` —— 于是 A 打开的外部文件被灌进 **B 的槽**：
  // B 的画布上出现 A 的文件、B 自己的图消失，用户拖一下保存就把 B 的 .mmd 顶掉了。
  // 所以：await 之前先拿 ticket，await 之后复核；抢走了就**不 adopt**（记日志）。
  var ticket = docTicket()
  var text = null
  try {
    var t = await fs.resolve(path)
    var info = await fs.stat(t)
    if (info) text = await fs.readText(t)
  } catch (e) {
    return { ok: false, error: '读不到 ' + path + '：' + msgOf(e) }
  }
  if (text === null && !create) {
    return { ok: false, error: '文件不存在：' + path + '（要新建就带上 create）' }
  }
  // 留言表按**外部文件自己的路径**定位，与当前指针无关 —— 在这里先读进缓存，
  // 队列里那一段就不再有文件读（也就不会把别的请求的 await 卡在队列上）。
  await loadNoteStoreFor(path)
  // 与 loadDiagramAt 同一条规矩：改「当前文档」这件事排进加载队列，不与别的加载交叉。
  return enqueueLoad(async function () {
    if (!ticketHolds(ticket)) {
      logEvent('error', 'doc.openPath.stolen', { path: path, expected: ticket.file, actual: doc.file })
      return { ok: false, error: '画布已被别的会话切走，本次打开未生效' }
    }
    doc.external = path
    doc.name = baseNameOf(path)
    doc.file = path
    doc.tombstoned = false
    doc.absent = false
    doc.warnings = []
    doc.notes = []
    if (text !== null) {
      adopt(parseMermaid(text))
    } else {
      adopt(emptyDoc())
      var err = await persist(policy, 'doc:openPath', path)
      if (doc.file !== path) {
        logEvent('error', 'doc.openPath.stolen', { path: path, expected: path, actual: doc.file })
        return { ok: false, error: '画布已被别的会话切走，本次打开未生效' }
      }
      if (err) doc.warnings.push('写入失败: ' + err)
    }
    bump('switch')
    lastChange = { by: 'switch', rev: doc.revision, nodes: [] }
    // 外部文件不改变「内存里这份文档来自哪个图库」：切回图库里的图仍按 loadedFor 判断
    loadedFor = lib.dir
    logEvent('info', 'doc.openPath', {
      path: path, created: text === null, nodes: doc.nodes.length, edges: doc.edges.length,
    })
    return fullOf()
  })
}

