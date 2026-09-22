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
var ARROW_SET = { '-->': 1, '---': 1, '-.->': 1, '==>': 1, '===': 1, '~~~': 1, '<-->': 1, '<==>': 1 }
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
var root = { dir: GLOBAL_DIR, scope: 'global', workspace: '' }
var lib = { dir: GLOBAL_DIR, scope: 'global', workspace: '' }
var loadedFor = null      // 内存里这份文档来自哪个 dir
var everLoaded = false    // 是否已经载入过 —— 首次载入不 bump 修订号（「刚载入」就是 0）
var loadQueue: Promise<any> = Promise.resolve()  // 载入/切库的串行队列
// 提示词上下文是同步求值的，不能 await，所以清单走缓存；周期扫描让它自己保持新鲜。
var libraryCache = []
var libraryCacheAt = 0        // 上次**扫描**的时刻（TTL 门）：扫描只走目录，所以可以几秒一次
var libraryFiles = []         // 项目里散落的 .mmd / .mermaid（自动扫描的副产物，按路径打开用）
var libraryFingerprint = ''   // 上次扫描的指纹：变了才去读文件内容算节点数
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
    // 这份文档属于哪个工作区（会话的项目目录；全局兜底库是 ''）。
    // 2026-09-23 加：宿主只有一份内存文档，而**提示词注入没有会话信息** —— 另一个会话把画布切到
    // 它自己的项目之后，本会话的每一步都会读到那张图，连留在那上面的留言都会被当自己的消费掉
    // （留言是「读一次即送达」）。所以文档要记住自己是谁的，注入前先对一下工作区。
    workspace: '',
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
 */
async function persist(policy?, site?) {
  if (!fs) return 'fs 服务不可用'
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
  try {
    if (doc.absent) {
      var targetDir = doc.file.slice(0, doc.file.lastIndexOf('/'))
      if (lib.scope === 'project') {
        var inherited = await inheritGlobalOnce({ dir: targetDir }, policy)
        if (inherited) doc.notes.push(inherited)
      }
      await ensureDir(targetDir, policy)
    }
    var body = serializeDoc(doc)
    // **写盘前的运行时不变式**（见 mermaid.ts 的 roundTripDetail）：`parse(serialize(doc))`
    // 必须与 doc 在所有会被持久化的字段上一致。它**只报告、不改行为** —— 拒绝保存比丢字段更糟：
    // 用户当下的编辑一个字都存不下去，而字段在文本里表达不出来就是表达不出来
    // （检查点回滚也救不了，快照存的就是同一份文本）。所以照旧写盘，但把现场喊出来。
    try {
      var rt = roundTripDetail(doc)
      if (rt) {
        logEvent('error', 'serialize.not-idempotent', {
          site: site || '', file: doc.file, fields: rt.fields, detail: rt.detail,
        })
        var rtWhere = rt.detail ? Object.keys(rt.detail).map(function (k) { return k + '[' + rt.detail[k].join(' ') + ']' }).join(' ') : ''
        var rtMsg = RT_WARN_PREFIX + '（' + rt.fields.join('、') + '）'
          + (rtWhere ? ' ' + rtWhere : '') + ' —— 详见日志 serialize.not-idempotent'
        // 只留一条：这条说的是「当前状态写不出去」，不是历史流水；每保存一次追加一条会刷屏
        doc.warnings = doc.warnings.filter(function (w) { return String(w).indexOf(RT_WARN_PREFIX) !== 0 })
        doc.warnings.push(rtMsg)
      }
    } catch (e) {
      logEvent('error', 'serialize.check.fail', { site: site || '', file: doc.file, error: msgOf(e) })
    }
    // 软删除过的图再落盘时要把墓碑保住，否则一次无关的写就把「已删除」抹掉了
    if (doc.tombstoned) body = TOMBSTONE + '\n' + body
    await fs.writeText(await fs.resolve(doc.file), body, undefined, undefined, policy)
    doc.absent = false
    harvestNoteStore(doc.file, doc.nodes)
    var noteErr = await saveNoteStoreFor(doc.file, policy)
    if (noteErr) {
      logEvent('warn', 'notes.persist.fail', { file: doc.file, error: noteErr })
      doc.warnings.push('留言表保存失败: ' + noteErr)
    }
    // 锚点指纹基线（见 drift.ts）：**只在这一条写路径上记** —— 图刚落盘，此刻的代码就是
    // 这张图所描述的那份代码。读路径一个字节都不写（那是这个项目的硬规矩）。
    //
    // 失败**只记日志、不挂警告**：它只是这一轮没记上基线（drift 会如实说 baseline=false），
    // 图本身完好、也没有用户能采取的动作 —— 把它塞进「解析警告」那条横幅只会稀释真正的坏消息。
    var driftErr = await saveDriftStampsFor(doc, policy)
    if (driftErr) logEvent('warn', 'drift.persist.fail', { file: doc.file, error: driftErr })
    pushHistory(body, site)
    return null
  } catch (e) {
    return msgOf(e)
  }
}

/** where 为字符串时解析成图库；空串表示显式用全局图库。undefined 表示「不改」。 */
function resolveLib(where) {
  var w = typeof where === 'string' ? where.trim() : ''
  if (w === '') return { dir: GLOBAL_DIR, scope: 'global', workspace: '' }
  w = w.replace(/\/+$/, '')
  return { dir: w + '/' + PROJECT_SUBDIR, scope: 'project', workspace: w }
}

/**
 * 从工具执行上下文里取项目路径。
 * ToolExecutionInput.agent 是「这次调用代表谁」，Agent 上带着会话的 cwd ——
 * 所以 AI 侧的调用不会跑错图库。字段名按 DSH 的会话元数据取值，取不到就算了。
 */
function whereOfExec(exec) {
  try {
    var a = exec && exec.agent
    if (!a) return undefined
    var cands = [a.cwd, a.session && a.session.cwd, a.header && a.header.cwd]
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
    return true
  } catch (e) {}
  try {
    var dp = ctx.get('directoryPickerController')
    if (dp && typeof dp.createDirectory === 'function') {
      await dp.createDirectory(path.replace(/\/[^/]+$/, ''), path.replace(/^.*\//, ''))
      return true
    }
  } catch (e) {}
  return false
}

/**
 * 第一次进入某个项目图库、且那个目录还不存在时，把全局图库里的图复制过来。
 * 为什么要有这一步：图库从「全局」改成「跟项目走」之后，用户已有的图如果不搬，
 * 一打开项目就会看到空画布 —— 看起来像丢了。用全局目录里的标记文件保证只发生一次
 * （之后新建的项目从干净的图库开始）。
 */
async function inheritGlobalOnce(target, policy?) {
  if (!fs) return ''
  try {
    // 护栏 1：目标图库里**已经有活着的图** → 什么都不做。
    // 「已经继承过」和「本来就有图」在文件系统上长得一样，而后者恰恰是最不该被动的情况。
    //
    // 从前这里查的是**全局图库**里的 `.inherited` 标记 —— 那个标记与「目标是谁」无关：
    // 第一个项目继承过之后，标记一落，别的项目就再也不继承了；而一个从没走到这一步的项目，
    // 每建一张新图就把全局图库往它身上盖一遍。2026-09-21 实测事故：本仓库的
    // `.arch-canvas/architecture.mmd`（23 节点）就是这样被全局兜底那张老图覆盖掉的 ——
    // 覆盖发生在 arch_switch { create: true } 里，日志里一条都不留。
    var existing = await listDiagrams(target.dir)
    var liveExisting = 0
    for (var e0 = 0; e0 < (existing || []).length; e0++) {
      if (!existing[e0].deleted) liveExisting += 1
    }
    if (liveExisting > 0) return ''
    // 护栏 2：逐张复制时**同名一律跳过**。就算护栏 1 因为并发或误判没拦住，
    // 也绝不许把用户已经有的东西盖掉 —— 继承是「给你一个起点」，不是「替你决定」。
    var items = await listDiagrams(GLOBAL_DIR)
    var live = items.filter(function (x) { return !x.deleted })
    var copied = 0
    for (var i = 0; i < live.length; i++) {
      var dest = fileAt(target.dir, live[i].name)
      var destAbs: any = null
      try { destAbs = await fs.resolve(dest) } catch (e0) { continue }
      var there = null
      try { there = await fs.stat(destAbs) } catch (e1) { there = null }
      if (there) continue
      var text = await fs.readText(await fs.resolve(GLOBAL_DIR + '/' + live[i].name + '.mmd'))
      await fs.writeText(destAbs, text, undefined, undefined, policy)
      copied += 1
    }
    // 不再写任何标记文件：护栏 1 就是标记，而且它写在**目标图库自己的内容**里 ——
    // 不需要往会话工作区之外写东西（旧实现那个全局标记文件正是被沙箱挡掉的那一步的产物）。
    return copied > 0 ? '已把全局图库里的 ' + copied + ' 张图复制到 ' + target.dir : ''
  } catch (e) {
    doc.warnings.push('继承全局图库失败: ' + msgOf(e))
    return ''
  }
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
  doc.external = path
  doc.name = baseNameOf(path)
  doc.file = path
  doc.tombstoned = false
  doc.absent = false
  doc.warnings = []
  doc.notes = []
  await loadNoteStoreFor(doc.file)
  if (text !== null) {
    adopt(parseMermaid(text))
  } else {
    adopt(emptyDoc())
    var err = await persist(policy, 'doc:openPath')
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
}

// 往下扫的时候要跳过的目录：不跳的话在 my/ 这种容器根下会扫进 node_modules 和 target
var SKIP_DIRS = {
  node_modules: 1, '.git': 1, dist: 1, build: 1, target: 1, coverage: 1,
  '.venv': 1, venv: 1, __pycache__: 1, '.next': 1, '.cache': 1, '.turbo': 1,
}
// 图库嵌在子项目里（<子项目>/.arch-canvas），所以往下找 .arch-canvas。
// 深度与条数都封顶：这是一次「走目录」的扫描，不能在大仓库里变成遍历全树。
var SCAN_MAX_DEPTH = 5
var SCAN_MAX_LIBS = 200
var SCAN_MAX_FILES = 200
var MAX_ITEMS = 300
// 自动扫描的节奏与边界。走目录很便宜（不读文件内容），但项目一大就不便宜了 ——
// 实测一个 596 个目录的项目（深度 ≤5、跳过常规目录）走一遍是几百次 fs 调用，
// 所以：① TTL 让 2.5s 一轮的界面轮询最多每 15s 触发一次；② 目录预算封顶，
// 走不完就记 truncated（宁可少扫，不可让轮询把宿主拖慢）。
var SCAN_TTL_MS = 15000
var SCAN_INTERVAL_MS = 20000
var SCAN_MAX_DIRS = 800
// 项目里散落的 mermaid 文件只认这两种扩展名：「打开就是编辑这个文件」只对
// 「整份文件就是一张图」成立，.md 里的 ```mermaid 代码块不在其中。
var DIAGRAM_EXT_RE = /\.(mmd|mermaid)$/i

interface ProjectScan {
  dirs: { dir: string; project: string; files: { name: string; bytes: number }[] }[]
  files: { path: string; rel: string; name: string; bytes: number }[]
  visited: number
  truncated: boolean
}

/** 一次项目扫描：找出所有 .arch-canvas 图库目录 + 散落的 mermaid 文件。只走目录，不读内容。 */
async function scanProject(): Promise<ProjectScan> {
  var out: ProjectScan = { dirs: [], files: [], visited: 0, truncated: false }
  if (!fs) return out
  if (root.scope !== 'project' || !root.workspace) return out
  await walkProject(String(root.workspace).replace(/\/+$/, ''), '', 0, out)
  return out
}

async function walkProject(absDir, rel, depth, out) {
  out.visited += 1
  if (out.visited > SCAN_MAX_DIRS) { out.truncated = true; return }
  // 1) 这个目录自己是不是一个图库（<dir>/.arch-canvas）
  var libDir = absDir + '/' + PROJECT_SUBDIR
  var entries = []
  try { entries = await fs.listDir(await fs.resolve(libDir)) } catch (e) { entries = [] }
  var files = []
  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i]
    if (entry.type !== 'file') continue
    // 图库里的图固定是 .mmd：改名/删除/落盘都靠「key + .mmd」定位文件，不能有第二种扩展名
    if (entry.name.slice(-4) !== '.mmd') continue
    files.push({ name: entry.name, bytes: entry.size || 0 })
  }
  if (files.length > 0 && out.dirs.length < SCAN_MAX_LIBS) {
    out.dirs.push({ dir: libDir, project: rel, files: files })
  }
  // 2) 继续往下找子项目里的图库，顺手收下散落的 mermaid 文件
  if (depth >= SCAN_MAX_DEPTH) return
  var kids = []
  try { kids = await fs.listDir(await fs.resolve(absDir)) } catch (e) { return }
  for (var j = 0; j < kids.length; j++) {
    var kid = kids[j]
    if (kid.name.charAt(0) === '.') continue  // 含 .arch-canvas 自己：它的图已经按图库收在上面了
    if (SKIP_DIRS[kid.name]) continue
    var childAbs = absDir + '/' + kid.name
    var childRel = rel ? rel + '/' + kid.name : kid.name
    if (kid.type === 'directory') {
      await walkProject(childAbs, childRel, depth + 1, out)
      continue
    }
    if (kid.type !== 'file') continue
    if (!DIAGRAM_EXT_RE.test(kid.name)) continue
    if (out.files.length >= SCAN_MAX_FILES) continue
    out.files.push({ path: childAbs, rel: childRel, name: kid.name, bytes: kid.size || 0 })
  }
}

/** 扫描结果的指纹：谁加了/删了/改了图，指纹就变。 */
function scanFingerprint(scan: ProjectScan) {
  var parts = []
  for (var i = 0; i < scan.dirs.length; i++) {
    for (var j = 0; j < scan.dirs[i].files.length; j++) {
      parts.push(scan.dirs[i].project + '/' + scan.dirs[i].files[j].name + ':' + scan.dirs[i].files[j].bytes)
    }
  }
  for (var k = 0; k < scan.files.length; k++) parts.push(scan.files[k].rel + ':' + scan.files[k].bytes)
  return parts.join('|')
}

/** 把扫描到的图库目录变成列表项：这一步要读文件内容算节点数，所以只在指纹变了才跑。 */
async function buildLibraryItems(scan: ProjectScan) {
  var items = []
  for (var i = 0; i < scan.dirs.length && items.length < MAX_ITEMS; i++) {
    var info = scan.dirs[i]
    for (var j = 0; j < info.files.length && items.length < MAX_ITEMS; j++) {
      var f = info.files[j]
      var text = ''
      try {
        text = await fs.readText(await fs.resolve(info.dir + '/' + f.name))
      } catch (e) {
        continue
      }
      var parsed = parseMermaid(text)
      var name = f.name.slice(0, -4)
      items.push({
        name: name,
        deleted: hasTombstone(text),
        nodes: parsed.nodes.length,
        edges: parsed.edges.length,
        links: parsed.nodes.filter(function (n) { return !!n.link }).length,
        bytes: f.bytes || text.length,
        project: info.project,
        key: info.project ? info.project + '/' + name : name,
        dir: info.dir,
        summary: cleanSummary(parsed.summary),
      })
    }
  }
  items.sort(function (a, b) {
    if (a.deleted !== b.deleted) return a.deleted ? 1 : -1
    if (a.project !== b.project) return a.project < b.project ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return items
}

/**
 * 刷新图库清单 —— 这就是「自动扫描 .arch-canvas」。
 * 周期性调用（界面轮询 + 定时器）时只走目录 + 比指纹；指纹没变就直接返回，
 * 于是「没人看图时也不会漏掉新加的图」，代价却只是一次目录遍历。
 * 指纹变了才 ++libraryRev：界面靠它自动刷新选择器，不用人去重新打开。
 */
async function refreshLibrary(force?: boolean) {
  var now = Date.now()
  if (!force && libraryCacheAt && now - libraryCacheAt < SCAN_TTL_MS) return libraryCache
  libraryCacheAt = now

  if (root.scope !== 'project' || !root.workspace) {
    // 没有项目根：全局图库是平铺的，既没有子项目图库也没有「散落文件」
    var flat = await listDiagrams(root.dir)
    for (var i = 0; i < flat.length; i++) {
      flat[i].project = ''
      flat[i].key = flat[i].name
      flat[i].dir = root.dir
    }
    libraryCache = flat
    libraryFiles = []
    var fpFlat = flat.map(function (x) { return x.name + ':' + x.bytes + ':' + (x.deleted ? 1 : 0) }).join('|')
    if (fpFlat !== libraryFingerprint) {
      libraryFingerprint = fpFlat
      libraryRev += 1
    }
    return libraryCache
  }

  var scan = await scanProject()
  var fp = scanFingerprint(scan)
  if (fp !== libraryFingerprint) {
    libraryCache = await buildLibraryItems(scan)
    libraryFingerprint = fp
    libraryRev += 1
    // 高频成功的巡检降为 debug：指纹没变就不读文件、不解析，这条记录的诊断价值只在于
    // "清单确实变了"。默认门槛（info）下不落盘；把 ARCH_CANVAS_LOG_LEVEL=debug 打开就能看到。
    logEvent('debug', 'library.scan', {
      libs: scan.dirs.length, files: scan.files.length, items: libraryCache.length,
      revision: libraryRev, visited: scan.visited, truncated: scan.truncated,
    })
  }
  libraryFiles = scan.files
  return libraryCache
}

/** 载入一张图。create 为真时不存在就建；默认图总是允许隐式创建。
 *  target 是这一趟的图库：加载期间的 await 点上 lib 可能已经被别的请求切走，
 *  路径必须从这里取，不能看全局 lib —— 否则 A 库的内容会落到 B 库的文件里。 */
async function loadInto(name, create, target, policy?) {
  var clean = cleanName(name)
  if (fs && !create && clean !== DEFAULT_DIAGRAM) {
    try {
      var probe = await fs.resolve(fileAt(target.dir, clean))
      var info0 = await fs.stat(probe)
      if (!info0) {
        logEvent('warn', 'doc.load.missing', { file: fileAt(target.dir, clean) })
        return { ok: false, error: '这个图库里没有叫「' + clean + '」的图' }
      }
    } catch (e) {}
  }
  doc.name = clean
  doc.file = fileAt(target.dir, clean)
  doc.external = null      // 从图库载入：之前打开的外部文件就此让位
  doc.workspace = projectKeyOfTarget(target)   // 这份文档属于哪个项目（提示词注入据此判归属）
  doc.tombstoned = false
  doc.warnings = []
  var text = null
  if (fs) {
    try {
      var t = await fs.resolve(doc.file)
      var info = await fs.stat(t)
      if (info) text = await fs.readText(t)
    } catch (e) {
      doc.warnings.push('读取 ' + doc.file + ' 失败: ' + msgOf(e))
    }
  }
  if (text !== null) {
    doc.absent = false
    doc.tombstoned = hasTombstone(text)
    await loadNoteStoreFor(doc.file)
    adopt(parseMermaid(text))
    // 打开也是一个检查点：这是「AI 第一次动手之前」那个状态，最常被退回到的就是它。
    pushHistory(text, 'open', 'open')
  } else {
    // 读路径（loadInto）绝不创建任何东西：不 ensureDir、不 inheritGlobalOnce、不播种默认图。
    // 项目图库目录或文件不存在时，把 doc 置成空文档，doc.file 仍指向本该写入的路径，标记 absent = true。
    // 只有显式 create（例如 doc:open { create: true } / arch_switch { create: true }）或全局图库才允许创建。
    if (create) {
      if (target.scope === 'project') {
        var inherited = await inheritGlobalOnce(target, policy)
        if (inherited) doc.notes.push(inherited)
        await ensureDir(target.dir, policy)
      }
      await loadNoteStoreFor(doc.file)
      adopt(emptyDoc())
      doc.absent = false
      var err = await persist(policy, 'doc:new')
      if (err) doc.warnings.push('写入失败: ' + err)
    } else if (target.scope === 'global' && clean === DEFAULT_DIAGRAM) {
      var items = await listDiagrams(target.dir)
      var seed = items.length === 0
      await loadNoteStoreFor(doc.file)
      adopt(seed ? seedDoc() : emptyDoc())
      doc.absent = false
      var errG = await persist(policy, 'seed')
      if (errG) doc.warnings.push('写入失败: ' + errG)
    } else {
      adopt(emptyDoc())
      doc.absent = true
    }
  }
  doc.notes = []
  // 同一份内容不重复落行（治噪音）：hmr 每次构建都会重新 loadInto 一遍，实测单日 50 行 doc.load，
  // 其中绝大多数内容**逐字节相同**（同一份图被反复读进来）。换了一张图、或文本真的变了才再落一行 ——
  // 「打开了哪张图」这个现场一点没丢，丢掉的只是重复。
  var loadKey = doc.file + '|' + (text === null ? '#new#' + doc.nodes.length : text)
  if (loadKey !== lastDocLoadKey) {
    lastDocLoadKey = loadKey
    logEvent('info', 'doc.load', {
      file: doc.file, diagram: doc.name, scope: target.scope,
      nodes: doc.nodes.length, edges: doc.edges.length, groups: doc.groups.length,
      tombstoned: doc.tombstoned, warnings: doc.warnings.slice(0, 10),
    })
  }
  return { ok: true }
}

/**
 * 一个工作区（会话的项目目录）在内存里存一份画布。
 *
 * 2026-09-23 事故的根因：宿主只有**一份**内存文档，而 `promptText` 是同步求值、拿不到会话 ——
 * 另一个会话把画布切到它自己的项目之后，本会话的每一步都读到那张图，还把留在那上面的留言
 * 当自己的「读一次即送达」消费掉了（跨会话丢用户写的东西）。
 *
 * 修法：内存文档按工作区各存一份（槽里放的是**同一批对象引用**，切换只是换指针，不复制内容），
 * 并且 `promptText` 先对一下「这份文档是不是你这个项目的」，不是就换指针、换不到就给一句说明
 * 而**不消费任何留言**。
 */
var docSlots = {}
var DOC_SLOT_MAX = 6
function slotKeyOfLib(target) { return (target && target.scope === 'project') ? String(target.workspace || '') : '' }
function activeSlotKey() { return slotKeyOfLib(root) }

/**
 * 这次加载的目标属于**哪个项目**（槽与归属都用项目根，不用子图库那一层）。
 * `libOf('子项目')` 给的 workspace 是 `.../项目/子项目` —— 直接拿它当归属，
 * 用户下钻一次子图库，自己的提示词就会被判成「别人的画布」。
 */
function projectKeyOfTarget(target) {
  var key = slotKeyOfLib(target)
  var rk = String((root && root.workspace) || '')
  if (key && rk && (key === rk || key.indexOf(rk + '/') === 0)) return rk
  return key
}

/**
 * 把当前这一份存进它自己的工作区槽（切换前调用；同一批对象引用，不深拷贝）。
 * **只存「已经载入过」的状态**：换项目时会先重置成一份空白文档再去加载，
 * 那个中间态（`loadedFor === null`）存进去就是一颗雷 —— 下次「命中」它等于命中一张空图。
 */
function saveActiveSlot() {
  if (!loadedFor) return
  docSlots[activeSlotKey()] = {
    at: Date.now(),
    root: root, lib: lib, loadedFor: loadedFor, everLoaded: everLoaded,
    doc: doc, lastChange: lastChange,
    libraryCache: libraryCache, libraryFiles: libraryFiles, libraryCacheAt: libraryCacheAt,
    libraryFingerprint: libraryFingerprint, libraryRev: libraryRev,
  }
  var keys = Object.keys(docSlots)
  if (keys.length > DOC_SLOT_MAX) {
    var oldest = keys[0], at = Infinity
    for (var i = 0; i < keys.length; i++) {
      var t = docSlots[keys[i]].at || 0
      if (t < at) { at = t; oldest = keys[i] }
    }
    if (oldest !== activeSlotKey()) delete docSlots[oldest]
  }
}

/** 换到这个工作区存过的那一份（同步，只走内存）。命中返回 true。 */
function activateSlot(key) {
  var s = docSlots[key]
  if (!s) return false
  // 没载入过的槽不算命中（换项目时会留下这种中间态）：让它走「重置 + 加载」那条路
  if (!s.loadedFor) { delete docSlots[key]; return false }
  if (activeSlotKey() !== key) saveActiveSlot()
  root = s.root
  lib = s.lib
  loadedFor = s.loadedFor
  everLoaded = s.everLoaded
  doc = s.doc
  lastChange = s.lastChange
  libraryCache = s.libraryCache
  libraryFiles = s.libraryFiles
  libraryCacheAt = s.libraryCacheAt
  libraryFingerprint = s.libraryFingerprint
  libraryRev = s.libraryRev
  s.at = Date.now()
  return true
}

/** 内存状态清成「准备重新加载目标工作区」的样子（槽里没存过时才走这条）。 */
function resetToWorkspace(next, key) {
  root = next
  lib = next
  loadedFor = null
  libraryCache = []
  libraryFiles = []
  libraryCacheAt = 0
  libraryFingerprint = ''
  // **换新对象**：旧那份还挂在它自己的工作区槽里，原地改会把别人的图改掉
  doc = newDocState()
  doc.workspace = key
  lastChange = null
}

/**
 * 让内存里的文档变成 `where` 那个工作区的 —— **同步**，只走缓存。
 * 提示词注入是同步求值的（不能 await），所以它只认这一条路；真正的加载留给 ensureLoaded。
 */
function syncWorkspaceFor(where: string) {
  var key = slotKeyOfLib(resolveLib(where))
  if (key === activeSlotKey()) return true
  return activateSlot(key)
}

/** 这份内存文档是不是属于 `where` 那个工作区（提示词注入据此决定读不读给这一步）。 */
function docBelongsTo(where: string) {
  var key = slotKeyOfLib(resolveLib(where))
  if (key === activeSlotKey()) return true
  // 外部文件：按「文件落在不在这个工作区里」判（它是用户明确打开的文件，不属于图库）
  if (doc.external) {
    var w = String(where).replace(/\/+$/, '')
    var p = String(doc.external)
    return p === w || p.indexOf(w + '/') === 0
  }
  return false
}

/**
 * 保证内存里的文档来自 where 指定的图库。
 * where 为 undefined 时保持现状（工具或界面没提供信息就沿用上次识别出的项目）。
 * 换库会 bump 修订号并标 by:'switch'，这样界面轮询能发现并重新适应视图。
 *
 * 加载**串行排队**：切库是异步的，而 lib 是模块级可变状态。两个请求同时进来
 * （界面报会话 cwd、AI 工具报另一个项目的 cwd）时，并发的加载会让「内存里这份文档来自
 * 哪个库」与 lib 对不上，后续落盘就把 A 的图写进了 B 的图库。排队之后，每个任务在轮到自己
 * 时才定目标库，谁也不覆盖谁。
 */
function ensureLoaded(where?: string, sessionId?: string) {
  var policy = policyOfSessionId(sessionId)
  if (typeof where === 'string') {
    var next = resolveLib(where)
    var nextKey = slotKeyOfLib(next)
    if (nextKey !== activeSlotKey()) {
      // 换了**项目**：先把这一份存进它自己的槽，再看目标项目有没有存过。
      // 存过就只是换指针（不读盘、不 bump 修订号、把上一步投递过的留言状态原样留着）；
      // 没存过才重置并重新加载。
      saveActiveSlot()
      if (activateSlot(nextKey)) return Promise.resolve({ ok: true })
      resetToWorkspace(next, nextKey)
    } else if (next.dir !== root.dir) {
      // 同一个项目里换层（下钻的子图库 / 回到根）：沿用旧行为 —— 比的是 root 而不是 lib，
      // 否则界面每次报会话 cwd 都会把刚下钻的层拽回来。
      resetToWorkspace(next, nextKey)
    }
  }
  // 打开的是项目里的外部文件：别被「图库加载」冲掉（界面每次请求都带 where）
  if (doc.external) return Promise.resolve({ ok: true })
  if (loadedFor === lib.dir) return Promise.resolve({ ok: true })
  return enqueueLoad(function () {
    // 排到自己时才看 lib：这时它是最新一次切库的结果
    if (loadedFor === lib.dir) return { ok: true }
    return loadDiagram(lib, policy)
  })
}

/** 所有加载都排这一条队列 —— 并发进两个库时，内存里的文档与 lib 不会各说各话。 */
function enqueueLoad(task) {
  loadQueue = loadQueue.catch(function () {}).then(task)
  return loadQueue
}

/**
 * 按 key 打开/新建一张图（doc:open、arch_switch 走这里）。
 * 也排队：这两个入口是直接改 lib 再加载的，不排队就仍与 ensureLoaded 有交叉窗口。
 */
function loadDiagramAt(target, name, create, policy?) {
  return enqueueLoad(async function () {
    // 显式新建（create === true）时才创建目录；读路径绝不建目录
    if (create && target.scope === 'project') await ensureDir(target.dir, policy)
    var r = await loadInto(name, create, target, policy)
    // 只有目标仍是当前层时才认这一趟；否则下次 ensureLoaded 会重新加载
    if (r && r.ok && lib.dir === target.dir) loadedFor = target.dir
    return r
  })
}

async function loadDiagram(target, policy?) {
  // 读路径绝不创建任何东西：不 ensureDir、不 inheritGlobalOnce、不播种默认图
  var result = await loadInto(doc.name || DEFAULT_DIAGRAM, false, target, policy)
  loadedFor = target.dir
  // 只有「真的换了」才 bump —— 界面靠修订号变化发现图库变了并重新适应视图
  if (everLoaded) {
    bump('switch')
    lastChange = { by: 'switch', rev: doc.revision, nodes: [] }
    logEvent('info', 'library.switch', { dir: target.dir, scope: target.scope, diagram: doc.name })
  }
  everLoaded = true
  await refreshLibrary()
  return result
}

function normalizeModel(model) {
  var nodes = []
  var seen = {}
  var rawNodes = Array.isArray(model.nodes) ? model.nodes : []
  for (var i = 0; i < rawNodes.length; i++) {
    var n = rawNodes[i]
    if (!n || typeof n !== 'object') continue
    var id = cleanId(n.id)
    if (seen[id]) continue
    seen[id] = true
    // 用户注释：从界面/文件进来的自由文本，长度要设闸门 —— 它会被原样注入每一步的提示词，
    // 一条超长注释能把上下文挤爆。空注释一律归一成「不存在」：没有正文时 noteDone 没有意义。
    var noteText = typeof n.note === 'string' ? n.note : ''
    if (noteText.length > 2000) noteText = noteText.slice(0, 2000)
    // 代码锚点：数组，逐条 trim / 去重 / 设闸门 —— 它同样会进提示词，而且会被拿去 stat。
    var fileList = []
    var rawFiles = Array.isArray(n.files) ? n.files : []
    for (var fi = 0; fi < rawFiles.length && fileList.length < 20; fi++) {
      if (typeof rawFiles[fi] !== 'string') continue
      var fv = rawFiles[fi].trim()
      if (!fv || fv.length > 300) continue
      if (fileList.indexOf(fv) < 0) fileList.push(fv)
    }
    nodes.push({
      id: id,
      // 空标签在**回读**时会变成节点 id（解析器对 `n1[""]` 就是这么归的）。两边必须一致，
      // 否则写盘前那条往返检查每次保存都会报警 —— 而它报的其实是真话：这份模型写出去再读回来
      // 就变样了。所以在模型边界上就归一到「没有标题 = 用 id」。
      label: typeof n.label === 'string' && n.label ? n.label : id,
      shape: SHAPE_WRAP[n.shape] ? n.shape : 'rect',
      group: typeof n.group === 'string' && n.group ? cleanId(n.group) : null,
      x: typeof n.x === 'number' && isFinite(n.x) ? n.x : null,
      y: typeof n.y === 'number' && isFinite(n.y) ? n.y : null,
      link: normLink(n.link),
      note: noteText,
      noteDone: noteText !== '' && n.noteDone === true,
      files: fileList,
    })
  }
  var edges = []
  var rawEdges = Array.isArray(model.edges) ? model.edges : []
  for (var j = 0; j < rawEdges.length; j++) {
    var e = rawEdges[j]
    if (!e || typeof e !== 'object') continue
    var from = cleanId(e.from)
    var to = cleanId(e.to)
    if (!seen[from] || !seen[to]) continue
    if (from === to) continue
    edges.push({
      id: 'e' + (edges.length + 1), from: from, to: to,
      label: typeof e.label === 'string' ? e.label : '',
      arrow: ARROW_SET[e.arrow] ? e.arrow : '-->',
    })
  }
  var groups = []
  var known = {}
  for (var a = 0; a < nodes.length; a++) if (nodes[a].group) known[nodes[a].group] = true
  var rawGroups = Array.isArray(model.groups) ? model.groups : []
  for (var k = 0; k < rawGroups.length; k++) {
    var g = rawGroups[k]
    if (!g || typeof g !== 'object') continue
    var gid = cleanId(g.id)
    groups.push({ id: gid, label: typeof g.label === 'string' && g.label ? g.label : gid })
    known[gid] = true
  }
  for (var key in known) {
    var found = false
    for (var m = 0; m < groups.length; m++) if (groups[m].id === key) { found = true; break }
    if (!found) groups.push({ id: key, label: key })
  }
  var dir = DIR_SET[model.direction] ? model.direction : 'TD'
  if (dir === 'TB') dir = 'TD'
  var extras = []
  var rawExtras = Array.isArray(model.extras) ? model.extras : []
  for (var x = 0; x < rawExtras.length; x++) {
    if (typeof rawExtras[x] === 'string') extras.push(rawExtras[x])
  }
  return {
    nodes: nodes, edges: edges, groups: groups, direction: dir, extras: extras,
    // 图级的一句话总结：白名单里必须带上它 —— normalizeModel 是逐字段重建，
    // 漏了就是「用户每保存一次，总结被静默清空一次」（与元素注释同一个坑）。
    // 唯一的例外是**字段整个缺席**：那是旧界面（换宿主前就打开的页面）发来的模型，
    // 它根本不知道有 summary 这回事 —— 这时保留现状，而不是把它当成「要清空」。
    // 显式清空走 summary: ''（新界面/工具一直是这么发的）。
    summary: typeof model.summary === 'string' ? cleanSummary(model.summary) : cleanSummary(doc.summary),
  }
}

function adoptModel(model) {
  var norm = normalizeModel(model)
  doc.nodes = norm.nodes
  doc.edges = norm.edges
  doc.groups = norm.groups
  doc.direction = norm.direction
  doc.extras = norm.extras
  doc.summary = norm.summary
}

function modelOf() {
  return {
    nodes: doc.nodes, edges: doc.edges, groups: doc.groups,
    direction: doc.direction, extras: doc.extras,
    summary: doc.summary,
  }
}

/** 未解决 / 已解决的元素注释条数。已解决的不进提示词（见 plugin.ts promptText），所以两处都要用。 */
function noteCounts() {
  var open = 0
  var done = 0
  for (var i = 0; i < doc.nodes.length; i++) {
    if (!doc.nodes[i].note) continue
    if (doc.nodes[i].noteDone) done += 1; else open += 1
  }
  return { open: open, done: done }
}

// 把当前所有节点的关键字段压成一个可比较的快照。
// 用「改完求差」而不是「在 applyOps 里逐个记录」：这样 arch_edit / arch_write /
// 用户回写 三条路都自动覆盖，也不会漏掉某个 op 分支。
function nodeKey(n) {
  return n.label + '\u0000' + n.shape + '\u0000' + n.group + '\u0000' + n.x + '\u0000' + n.y +
    '\u0000' + n.link + '\u0000' + (n.note || '') + '\u0000' + (n.noteDone === true ? '1' : '0') +
    '\u0000' + (n.files || []).join('\u0001')
}

function snapshotNodes() {
  var out = {}
  for (var i = 0; i < doc.nodes.length; i++) out[doc.nodes[i].id] = nodeKey(doc.nodes[i])
  return out
}

// 新增的、以及任何一个字段变了的节点 id。已删除的节点不返回（画布上没东西可高亮）。
function changedNodes(before) {
  var out = []
  for (var i = 0; i < doc.nodes.length; i++) {
    if (before[doc.nodes[i].id] !== nodeKey(doc.nodes[i])) out.push(doc.nodes[i].id)
  }
  return out
}

// 用户自己的改动不高亮（他知道自己做了什么），但也要记下来，
// 好让界面能区分「这次变更不是我引起的」。
function noteUserChange() {
  lastChange = { by: 'user', rev: doc.revision, nodes: [] }
}

function noteAiChange(before) {
  lastChange = { by: 'ai', rev: doc.revision, nodes: changedNodes(before) }
}

function findNode(id) {
  var key = cleanId(id)
  for (var i = 0; i < doc.nodes.length; i++) if (doc.nodes[i].id === key) return doc.nodes[i]
  return null
}

function nextNodeId() {
  var i = doc.nodes.length + 1
  while (findNode('n' + i)) i += 1
  return 'n' + i
}

function removeNode(id) {
  var key = cleanId(id)
  doc.nodes = doc.nodes.filter(function (n) { return n.id !== key })
  doc.edges = doc.edges.filter(function (e) { return e.from !== key && e.to !== key })
}

function removeEdge(from, to) {
  var a = cleanId(from)
  var b = cleanId(to)
  doc.edges = doc.edges.filter(function (e) { return !(e.from === a && e.to === b) })
}

function setEdgeLabel(from, to, label) {
  var a = cleanId(from)
  var b = cleanId(to)
  var hit = null
  for (var i = 0; i < doc.edges.length; i++) {
    if (doc.edges[i].from === a && doc.edges[i].to === b) { hit = doc.edges[i]; break }
  }
  if (!hit) { hit = { id: 'e' + (doc.edges.length + 1), from: a, to: b, label: '', arrow: '-->' }; doc.edges.push(hit) }
  hit.label = typeof label === 'string' ? label : ''
  return hit
}

/** 落盘前的模型快照。写盘失败时用它把内存恢复回去，别让内存与磁盘各说各话。 */
function snapshotModel() {
  // 版本三件套（revision / updatedBy / updatedAt）**必须一起快照**：落盘失败时会 restoreModel，
  // 而失败的那次操作在此之前已经 bump 过了 —— 不还原的话，一次**没写进去**的改动照样把
  // 修订号推进一格、把作者记成它，客户端看到修订号变了就以为改动生效了。
  // （2026-09-20 宿主审计第 14 条。）
  return JSON.stringify({
    name: doc.name, file: doc.file, tombstoned: doc.tombstoned, absent: doc.absent === true,
    nodes: doc.nodes, edges: doc.edges, groups: doc.groups,
    direction: doc.direction, extras: doc.extras, notes: doc.notes, fileStatus: doc.fileStatus,
    summary: doc.summary,
    revision: doc.revision, updatedBy: doc.updatedBy, updatedAt: doc.updatedAt,
  })
}

function restoreModel(saved) {
  var m = JSON.parse(saved)
  doc.name = m.name
  doc.file = m.file
  doc.tombstoned = m.tombstoned
  doc.absent = m.absent === true
  doc.nodes = m.nodes
  doc.edges = m.edges
  doc.groups = m.groups
  doc.direction = m.direction
  doc.extras = m.extras
  doc.notes = m.notes
  doc.fileStatus = m.fileStatus || {}
  doc.summary = cleanSummary(m.summary)
  // 旧快照里没有这三个字段（回滚到更早的代码路径时），有才还原，别把修订号写成 undefined
  if (typeof m.revision === 'number') doc.revision = m.revision
  if (typeof m.updatedBy === 'string') doc.updatedBy = m.updatedBy
  if (typeof m.updatedAt === 'number') doc.updatedAt = m.updatedAt
}

/**
 * 落盘；失败就把内存恢复回改动前，并把原因记进日志。
 * 不恢复的后果：这一版改动只活在内存里，而后续任何一次落盘又会把它写出去 ——
 * 用户看到的是「明明改了，重启之后没了 / 时有时无」。
 */
async function persistOrRollback(saved, site, policy?) {
  var err = await persist(policy, site)
  if (!err) return null
  restoreModel(saved)
  if (lastChange) lastChange = { by: lastChange.by, rev: doc.revision, nodes: [] }
  doc.warnings.push('保存失败，本次改动已回滚: ' + err)
  logEvent('error', 'persist.fail', { site: site, file: doc.file, error: err })
  return err
}

/**
 * 回到某个检查点。
 *
 * **这不是「撤销一步」**：把那一份正文重新装进文档、落盘，然后在历史末尾追加一条
 * 「用户 · 回到检查点」。时间线只增不减 —— 于是退回之后还能再往前走（更晚的那些检查点还在），
 * 而不是「一退就再也回不来」。界面上的 60 步撤销是另一层（只在内存、只管这一次会话的手动编辑）。
 *
 * 为什么用 `inheritPositions`：老快照里某些节点可能没有坐标（用户摆过、后来才写进文件），
 * 继承当前位置比让它们跳回去更符合直觉 —— 与 arch_write 同一条规则。
 */
async function applyRollback(seq, policy?) {
  var entry = findHistory(seq)
  if (!entry) return { ok: false, error: '这个检查点不在历史里了（历史只在内存里，重启 dsh 会清空）' }
  if (entry.text === currentText()) return { ok: false, error: '这就是当前状态，不用退回' }
  var parsed = inheritPositions(parseMermaid(entry.text))
  if (parsed.nodes.length === 0 && parsed.extras.length === 0) {
    return { ok: false, error: '那份快照里没有节点也没有内容行，已放弃（图没有变）' }
  }
  var saved = snapshotModel()
  adopt(parsed)
  adoptModel(modelOf())
  doc.tombstoned = hasTombstone(entry.text)
  bump('user')
  noteUserChange()
  doc.notes = ['回到检查点：' + historyLabelOf(entry)]
  var err = await persistOrRollback(saved, 'rollback:' + seq, policy)
  if (err) {
    logEvent('error', 'history.rollback.fail', { seq: seq, file: doc.file, error: err })
    return { ok: false, error: err }
  }
  logEvent('info', 'history.rollback', {
    seq: seq, file: doc.file, fromRev: entry.rev, nodes: doc.nodes.length, edges: doc.edges.length,
  })
  return { ok: true }
}

/**
 * 取 op 里的节点 / 分组引用。
 * 缺字段时 cleanId('') 会得到 'n' —— 图里恰好有节点 'n' 的话，一个畸形 op 就会静默删掉它。
 * 所以这里显式拒绝，并把原因交给 problems 回给 AI。
 */
function opRef(value, field, tag, problems) {
  if (typeof value !== 'string' || value.trim() === '') {
    problems.push(tag + ': 缺少 ' + field)
    return null
  }
  return cleanId(value)
}

function applyOps(ops) {
  var problems = []
  var done = []
  for (var i = 0; i < ops.length; i++) {
    var op = ops[i] && typeof ops[i] === 'object' ? ops[i] : {}
    var kind = op.op
    var tag = '第 ' + (i + 1) + ' 个 op(' + String(kind) + ')'
    // mark_note：把一条留言标成已办（或重新打开）。留言的存在形态是旁路表，
    // 但模型上就是节点上的 `note` / `noteDone` 两个字段 —— 这里改的正是它们，
    // 落盘时由 persist() 收进 notes.json。没有留言的节点直接拒，别产生半截状态。
    if (kind === 'mark_note') {
      var mnId = op.id ? cleanId(String(op.id)) : ''
      var mnNode = mnId ? findNode(mnId) : null
      if (!mnNode) { problems.push(tag + ': 找不到节点 ' + (mnId || '(空)') + '，mark_note 需要有效的 id'); continue }
      if (!mnNode.note) { problems.push(tag + ': 节点 ' + mnId + ' 上没有留言，无需标记'); continue }
      mnNode.noteDone = op.done === false ? false : true
      done.push(mnNode.noteDone ? ('把 ' + mnId + ' 的留言标成已办') : ('重新打开 ' + mnId + ' 的留言'))
      continue
    }
    if (kind === 'add_node') {
      var nid = op.id ? cleanId(op.id) : nextNodeId()
      if (findNode(nid)) { problems.push(tag + ': 节点 ' + nid + ' 已存在，改用 set_label'); continue }
      // 挂到一个**还不存在的组**上时，必须把组也建出来：serializeDoc 只为 doc.groups 里的组
      // 写 subgraph，落到 loose 里的节点下次解析回来 `group` 就是 null —— 分组被**静默吞掉**。
      // normalizeModel / set_group / add_group 三处都会补，唯独 add_node 从前漏了。
      var ngid = typeof op.group === 'string' && op.group ? cleanId(op.group) : null
      if (ngid) {
        var ngHave = false
        for (var ngi = 0; ngi < doc.groups.length; ngi++) if (doc.groups[ngi].id === ngid) { ngHave = true; break }
        if (!ngHave) doc.groups.push({ id: ngid, label: String(op.group) })
      }
      doc.nodes.push({
        id: nid,
        label: typeof op.label === 'string' && op.label !== '' ? op.label : nid,
        shape: SHAPE_WRAP[op.shape] ? op.shape : 'rect',
        group: ngid,
        x: typeof op.x === 'number' ? op.x : null,
        y: typeof op.y === 'number' ? op.y : null,
        link: normLink(op.link),
        note: '',
        noteDone: false,
        files: [],
      })
      done.push('新增节点 ' + nid)
    } else if (kind === 'set_label') {
      var lid = opRef(op.id, 'id', tag, problems)
      if (lid === null) continue
      var ln = findNode(lid)
      if (!ln) { problems.push(tag + ': 找不到节点 ' + String(op.id)); continue }
      ln.label = typeof op.label === 'string' ? op.label : ln.label
      done.push('改标签 ' + ln.id)
    } else if (kind === 'set_shape') {
      var sid = opRef(op.id, 'id', tag, problems)
      if (sid === null) continue
      var sn = findNode(sid)
      if (!sn) { problems.push(tag + ': 找不到节点 ' + String(op.id)); continue }
      if (!SHAPE_WRAP[op.shape]) { problems.push(tag + ': 未知形状 ' + String(op.shape)); continue }
      sn.shape = op.shape
      done.push('改形状 ' + sn.id)
    } else if (kind === 'set_link') {
      var kid = opRef(op.id, 'id', tag, problems)
      if (kid === null) continue
      var kn = findNode(kid)
      if (!kn) { problems.push(tag + ': 找不到节点 ' + String(op.id)); continue }
      kn.link = normLink(op.link)
      done.push(kn.link ? '把 ' + kn.id + ' 下钻到「' + kn.link + '」' : '取消 ' + kn.id + ' 的下钻链接')
    } else if (kind === 'move_node') {
      var mid = opRef(op.id, 'id', tag, problems)
      if (mid === null) continue
      var mn = findNode(mid)
      if (!mn) { problems.push(tag + ': 找不到节点 ' + String(op.id)); continue }
      if (typeof op.x === 'number') mn.x = op.x
      if (typeof op.y === 'number') mn.y = op.y
      done.push('移动 ' + mn.id)
    } else if (kind === 'remove_node') {
      var rid = opRef(op.id, 'id', tag, problems)
      if (rid === null) continue
      if (!findNode(rid)) { problems.push(tag + ': 找不到节点 ' + String(op.id)); continue }
      removeNode(rid)
      done.push('删除节点 ' + rid)
    } else if (kind === 'add_edge') {
      var af = opRef(op.from, 'from', tag, problems)
      var at = opRef(op.to, 'to', tag, problems)
      if (af === null || at === null) continue
      var f = findNode(af)
      var t = findNode(at)
      if (!f) { problems.push(tag + ': from 节点不存在 ' + String(op.from)); continue }
      if (!t) { problems.push(tag + ': to 节点不存在 ' + String(op.to)); continue }
      if (f.id === t.id) { problems.push(tag + ': 不允许自环'); continue }
      var arrow = ARROW_SET[op.arrow] ? op.arrow : '-->'
      var dup = false
      for (var d = 0; d < doc.edges.length; d++) {
        if (doc.edges[d].from === f.id && doc.edges[d].to === t.id) { dup = true; break }
      }
      if (dup) { problems.push(tag + ': ' + f.id + ' -> ' + t.id + ' 已存在，改用 set_edge_label'); continue }
      doc.edges.push({ id: 'e' + (doc.edges.length + 1), from: f.id, to: t.id, label: typeof op.label === 'string' ? op.label : '', arrow: arrow })
      done.push('连线 ' + f.id + ' -> ' + t.id)
    } else if (kind === 'remove_edge') {
      var xf = opRef(op.from, 'from', tag, problems)
      var xt = opRef(op.to, 'to', tag, problems)
      if (xf === null || xt === null) continue
      removeEdge(xf, xt)
      done.push('删除连线 ' + xf + ' -> ' + xt)
    } else if (kind === 'set_edge_label') {
      var lf = opRef(op.from, 'from', tag, problems)
      var lt = opRef(op.to, 'to', tag, problems)
      if (lf === null || lt === null) continue
      if (!findNode(lf) || !findNode(lt)) { problems.push(tag + ': from/to 节点不存在'); continue }
      if (lf === lt) { problems.push(tag + ': 不允许自环'); continue }
      setEdgeLabel(lf, lt, typeof op.label === 'string' ? op.label : '')
      done.push('改连线标签 ' + lf + ' -> ' + lt)
    } else if (kind === 'set_group') {
      var gid0 = opRef(op.id, 'id', tag, problems)
      if (gid0 === null) continue
      var gn = findNode(gid0)
      if (!gn) { problems.push(tag + ': 找不到节点 ' + String(op.id)); continue }
      var want = typeof op.group === 'string' && op.group ? cleanId(op.group) : null
      gn.group = want
      if (want) {
        var exists = false
        for (var q = 0; q < doc.groups.length; q++) if (doc.groups[q].id === want) { exists = true; break }
        if (!exists) doc.groups.push({ id: want, label: typeof op.label === 'string' && op.label ? op.label : want })
      }
      done.push('设置分组 ' + gn.id + ' -> ' + String(want))
    } else if (kind === 'add_group') {
      var gid = op.group ? cleanId(op.group) : (op.id ? cleanId(op.id) : 'g' + (doc.groups.length + 1))
      var have = false
      for (var w = 0; w < doc.groups.length; w++) if (doc.groups[w].id === gid) { have = true; break }
      if (have) { problems.push(tag + ': 分组 ' + gid + ' 已存在'); continue }
      doc.groups.push({ id: gid, label: typeof op.label === 'string' && op.label ? op.label : gid })
      done.push('新增分组 ' + gid)
    } else if (kind === 'remove_group') {
      var rgRaw = typeof op.group === 'string' && op.group !== '' ? op.group : op.id
      var rgid = opRef(rgRaw, 'group', tag, problems)
      if (rgid === null) continue
      doc.groups = doc.groups.filter(function (g) { return g.id !== rgid })
      for (var z = 0; z < doc.nodes.length; z++) if (doc.nodes[z].group === rgid) doc.nodes[z].group = null
      done.push('删除分组 ' + rgid)
    } else if (kind === 'set_direction') {
      var dv = String(op.value || op.label || '').toUpperCase()
      if (!DIR_SET[dv]) { problems.push(tag + ': 方向只能是 TD/BT/LR/RL'); continue }
      doc.direction = dv === 'TB' ? 'TD' : dv
      done.push('方向 -> ' + doc.direction)
    } else if (kind === 'set_summary') {
      // 整张图的一句话总结（图级，不挂节点）：传空串 = 清掉。用 label 传文本，
      // 与其它 op 一致（工具 schema 里 label 的描述写明了这一条）。
      var sumNext = cleanSummary(typeof op.label === 'string' ? op.label : '')
      doc.summary = sumNext
      done.push(sumNext ? '这张图的一句话总结已更新' : '清掉了这张图的一句话总结')
    } else if (kind === 'set_files') {
      // 代码锚点：整组替换（不是增删单条）—— 「这个节点对应哪几个文件」是一个整体判断，
      // 增量改容易改出半截状态。传空数组 = 清掉。
      var ffid = opRef(op.id, 'id', tag, problems)
      if (ffid === null) continue
      var ffn = findNode(ffid)
      if (!ffn) { problems.push(tag + ': 找不到节点 ' + String(op.id)); continue }
      var nextFiles = []
      var rawFs = Array.isArray(op.files) ? op.files : []
      for (var fk = 0; fk < rawFs.length && nextFiles.length < 20; fk++) {
        if (typeof rawFs[fk] !== 'string') continue
        var fsv = rawFs[fk].trim()
        if (!fsv || fsv.length > 300) continue
        if (nextFiles.indexOf(fsv) < 0) nextFiles.push(fsv)
      }
      ffn.files = nextFiles
      done.push(nextFiles.length
        ? ('给 ' + ffn.id + ' 标了 ' + nextFiles.length + ' 个代码锚点')
        : ('清掉 ' + ffn.id + ' 的代码锚点'))
    } else {
      problems.push(tag + ': 未知操作类型')
    }
  }
  return { problems: problems, done: done }
}

function inheritPositions(parsed) {
  var old = {}
  for (var i = 0; i < doc.nodes.length; i++) {
    var n = doc.nodes[i]
    if (typeof n.x === 'number' && typeof n.y === 'number') old[n.id] = { x: n.x, y: n.y }
  }
  for (var j = 0; j < parsed.nodes.length; j++) {
    var p = parsed.nodes[j]
    if ((p.x === null || p.x === undefined) && old[p.id]) { p.x = old[p.id].x; p.y = old[p.id].y }
  }
  return parsed
}

/**
 * 把「用户在元素上留的东西」（注释 + 代码锚点）继承到一份新文本解析出来的模型上，返回继承了几处。
 *
 * 为什么只给 arch_write 用、不给 doc:applyText 用 —— 这条边界是刻意的：
 * 注释与锚点都是**用户**的东西，AI 整体重画时不该把它悄悄抹掉；但用户自己在「源码」页删掉那一行，
 * 就是真的要删，这时还去继承，它们就成了删不掉的幽灵
 * （和 `@pos` 那条「注释不许让节点复活」是同一个坑，只是方向相反）。
 *
 * 图级的一句话总结（`%% @summary`）走同一条边界：新文本自己写了就用新的，
 * 没写就继承 —— 重画时把它悄悄清掉，等于把「这张图讲的是什么」也一起丢了。
 */
function inheritUserMarks(parsed) {
  var old = {}
  for (var i = 0; i < doc.nodes.length; i++) {
    var n = doc.nodes[i]
    if (n.note || (n.files && n.files.length)) {
      old[n.id] = { note: n.note || '', done: n.noteDone === true, files: (n.files || []).slice() }
    }
  }
  var kept = 0
  for (var j = 0; j < parsed.nodes.length; j++) {
    var p = parsed.nodes[j]
    if (p.note) continue        // 新文本自己带了注释，以它为准
    if (!old[p.id]) continue    // 节点没重画出来，注释与锚点跟着它一起走
    p.note = old[p.id].note
    p.noteDone = old[p.id].done
    // 代码锚点同理：AI 重画时不该把用户标的文件引用抹掉（新文本自己写了就用新的）
    if (!(p.files && p.files.length)) p.files = old[p.id].files.slice()
    kept += 1
  }
  if (!cleanSummary(parsed.summary)) parsed.summary = cleanSummary(doc.summary)
  return kept
}

// ==================== 代码锚点的失效校验 ====================
// 为什么必须校验：文件会改名、会移动，而注释不会自己更新 —— **一条过期锚点比没有锚点更坏**，
// 它会把 AI 自信地送到错的文件。所以加载/保存后 stat 一遍（带 #符号的再查一次符号），
// 把结论显式摆到界面与提示词里 —— 让腐烂可见，这是这个功能能不能帮上忙的分水岭。
var FILE_REF_LIMIT = 40     // 一次最多校验多少条：有人塞一千条也不能把加载拖死

/** `路径#符号` → { path, symbol }；没有 `#` 时 symbol 为空串。 */
function splitFileRef(ref) {
  var s = String(ref == null ? '' : ref)
  var i = s.indexOf('#')
  if (i < 0) return { path: s, symbol: '' }
  return { path: s.slice(0, i), symbol: s.slice(i + 1) }
}

/** 锚点相对谁解析：项目图库相对项目根；外部文件相对它自己所在的目录；其余判不了。 */
function fileRefRoot() {
  if (lib.scope === 'project' && lib.workspace) return lib.workspace.replace(/\/+$/, '')
  if (doc.external) return doc.external.replace(/\/[^/]*$/, '')
  return ''
}

async function checkFileRef(ref, root) {
  var parts = splitFileRef(ref)
  if (!parts.path) return 'missing'
  var abs = /^\//.test(parts.path) ? parts.path : (root ? root + '/' + parts.path : '')
  if (!abs) return 'unknown'
  try {
    var t = await fs.resolve(abs)
    var info = await fs.stat(t)
    if (!info) return 'missing'
    if (!parts.symbol) return 'ok'
    var text = await fs.readText(t)
    return text.indexOf(parts.symbol) >= 0 ? 'ok' : 'symbol-missing'
  } catch (e) {
    // 读不出来就当它坏了 —— 宁可说「这条不能用」，也不假装没问题
    return 'missing'
  }
}

/**
 * 重算每个节点上代码锚点的状态，写进 doc.fileStatus（派生数据，不进文件）。
 * 调用方：加载/切库之后、doc:get、doc:set 之后、arch_read —— 这几处覆盖了界面与提示词两条消费路径。
 */
async function verifyFileRefs() {
  var status = {}
  if (!fs) { doc.fileStatus = status; doc.drift = null; return status }
  var root = fileRefRoot()
  var budget = FILE_REF_LIMIT
  for (var i = 0; i < doc.nodes.length; i++) {
    var n = doc.nodes[i]
    var refs = n.files || []
    if (!refs.length) continue
    var per = {}
    for (var j = 0; j < refs.length; j++) {
      if (budget <= 0) { per[refs[j]] = 'unknown'; continue }
      budget -= 1
      per[refs[j]] = await checkFileRef(refs[j], root)
    }
    status[n.id] = per
  }
  doc.fileStatus = status
  // 顺手算一次保鲜（drift.ts）：它读旁路表里的指纹基线，跟「现在」比 —— 只读不写。
  // 放在这里而不是每个调用点：界面与提示词两条消费路径都经过 verifyFileRefs。
  try {
    doc.drift = await computeDrift()
  } catch (e) {
    doc.drift = null
    logEvent('warn', 'drift.compute.fail', { file: doc.file, error: msgOf(e) })
  }
  return status
}
