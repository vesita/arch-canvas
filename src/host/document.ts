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

var doc = {
  name: DEFAULT_DIAGRAM,
  nodes: [], edges: [], groups: [], extras: [],
  direction: 'TD', revision: 0, updatedBy: 'init', updatedAt: Date.now(),
  file: '', warnings: [], notes: [], tombstoned: false,
  // 打开的是项目里某个 .mmd / .mermaid 文件时，这里放它的绝对路径（图库里的图是 null）。
  // 有它就意味着「别被图库加载冲掉」+ 提示词里要写明这张图的真相源是哪个文件。
  external: null,
}
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
  // 解析器发现的异常行、指向不存在节点的注释 —— 这些是「图悄悄少了一块」的唯一线索，
  // 收进 warnings 供 RPC / 日志带出去，别让它烂在解析结果里。
  var parsedWarnings = parsed.warnings || []
  for (var i = 0; i < parsedWarnings.length; i++) {
    if (doc.warnings.length < 50) doc.warnings.push(parsedWarnings[i])
  }
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

async function persist() {
  if (!fs) return 'fs 服务不可用'
  try {
    var body = serializeDoc(doc)
    // 软删除过的图再落盘时要把墓碑保住，否则一次无关的写就把「已删除」抹掉了
    if (doc.tombstoned) body = TOMBSTONE + '\n' + body
    await fs.writeText(await fs.resolve(doc.file), body)
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
async function ensureDir(path) {
  if (!fs) return false
  try {
    var t = await fs.resolve(path)
    if (await fs.stat(t)) return true
  } catch (e) {}
  try {
    await fs.writeText(await fs.resolve(path + '/.gitkeep'), '')
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
async function inheritGlobalOnce(target) {
  if (!fs) return ''
  try {
    var marker = await fs.resolve(GLOBAL_DIR + '/.inherited')
    if (await fs.stat(marker)) return ''
    var items = await listDiagrams(GLOBAL_DIR)
    var live = items.filter(function (x) { return !x.deleted })
    for (var i = 0; i < live.length; i++) {
      var text = await fs.readText(await fs.resolve(GLOBAL_DIR + '/' + live[i].name + '.mmd'))
      await fs.writeText(await fs.resolve(fileAt(target.dir, live[i].name)), text)
    }
    await fs.writeText(marker, '首次进入项目图库时做过一次继承：' + new Date().toISOString() + '\n')
    return live.length > 0 ? '已把全局图库里的 ' + live.length + ' 张图复制到 ' + target.dir : ''
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
async function openExternal(path, create) {
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
  doc.warnings = []
  doc.notes = []
  if (text !== null) {
    adopt(parseMermaid(text))
  } else {
    adopt(emptyDoc())
    var err = await persist()
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
    logEvent('info', 'library.scan', {
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
async function loadInto(name, create, target) {
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
    doc.tombstoned = hasTombstone(text)
    adopt(parseMermaid(text))
  } else {
    // 种子示例只出现在「全局图库还完全空着」时；项目图库里新图从空白开始 ——
    // 用户要画的是自己的框架，不是我的示例。
    var seed = false
    if (target.scope === 'global' && clean === DEFAULT_DIAGRAM) {
      var items = await listDiagrams(target.dir)
      seed = items.length === 0
    }
    adopt(seed ? seedDoc() : emptyDoc())
    var err = await persist()
    if (err) doc.warnings.push('写入失败: ' + err)
  }
  doc.notes = []
  logEvent('info', 'doc.load', {
    file: doc.file, diagram: doc.name, scope: target.scope,
    nodes: doc.nodes.length, edges: doc.edges.length, groups: doc.groups.length,
    tombstoned: doc.tombstoned, warnings: doc.warnings.slice(0, 10),
  })
  return { ok: true }
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
function ensureLoaded(where?: string) {
  if (typeof where === 'string') {
    var next = resolveLib(where)
    if (next.dir !== root.dir) {
      // 换了项目：根和当前层都回到新根。注意这里比的是 root 而不是 lib ——
      // 界面每次都会报会话 cwd，如果拿它跟 lib 比，用户刚下钻到子图库就会被拽回来。
      root = next
      lib = next
      loadedFor = null
      libraryCache = []
      libraryCacheAt = 0
      libraryFingerprint = ''
      doc.external = null
      doc.name = DEFAULT_DIAGRAM
    }
  }
  // 打开的是项目里的外部文件：别被「图库加载」冲掉（界面每次请求都带 where）
  if (doc.external) return Promise.resolve({ ok: true })
  if (loadedFor === lib.dir) return Promise.resolve({ ok: true })
  return enqueueLoad(function () {
    // 排到自己时才看 lib：这时它是最新一次切库的结果
    if (loadedFor === lib.dir) return { ok: true }
    return loadDiagram(lib)
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
function loadDiagramAt(target, name, create) {
  return enqueueLoad(async function () {
    // 新建 `子项目/图名` 时那个图库可能还不存在：先把目录弄出来，否则第一次落盘会失败
    if (target.scope === 'project') await ensureDir(target.dir)
    var r = await loadInto(name, create, target)
    // 只有目标仍是当前层时才认这一趟；否则下次 ensureLoaded 会重新加载
    if (r && r.ok && lib.dir === target.dir) loadedFor = target.dir
    return r
  })
}

async function loadDiagram(target) {
  var inherited = ''
  if (target.scope === 'project') {
    // 顺序要紧：先判断「这个图库本来就不存在」再继承，最后才建目录。
    // 反过来的话目录已被建出来，「不存在才继承」就永远为假 —— 继承变死代码。
    var dirInfo = null
    try { dirInfo = await fs.stat(await fs.resolve(target.dir)) } catch (e) {}
    if (!dirInfo) inherited = await inheritGlobalOnce(target)
    await ensureDir(target.dir)
  }
  var result = await loadInto(doc.name || DEFAULT_DIAGRAM, target.scope === 'project', target)
  // loadInto 会清空 notes，所以继承的提示要在这之后补
  if (inherited) doc.notes.push(inherited)
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
    nodes.push({
      id: id,
      label: typeof n.label === 'string' ? n.label : id,
      shape: SHAPE_WRAP[n.shape] ? n.shape : 'rect',
      group: typeof n.group === 'string' && n.group ? cleanId(n.group) : null,
      x: typeof n.x === 'number' && isFinite(n.x) ? n.x : null,
      y: typeof n.y === 'number' && isFinite(n.y) ? n.y : null,
      link: normLink(n.link),
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
  return { nodes: nodes, edges: edges, groups: groups, direction: dir, extras: extras }
}

function adoptModel(model) {
  var norm = normalizeModel(model)
  doc.nodes = norm.nodes
  doc.edges = norm.edges
  doc.groups = norm.groups
  doc.direction = norm.direction
  doc.extras = norm.extras
}

function modelOf() {
  return {
    nodes: doc.nodes, edges: doc.edges, groups: doc.groups,
    direction: doc.direction, extras: doc.extras,
  }
}

// 把当前所有节点的关键字段压成一个可比较的快照。
// 用「改完求差」而不是「在 applyOps 里逐个记录」：这样 arch_edit / arch_write /
// 用户回写 三条路都自动覆盖，也不会漏掉某个 op 分支。
function nodeKey(n) {
  return n.label + '\u0000' + n.shape + '\u0000' + n.group + '\u0000' + n.x + '\u0000' + n.y + '\u0000' + n.link
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
  return JSON.stringify({
    name: doc.name, file: doc.file, tombstoned: doc.tombstoned,
    nodes: doc.nodes, edges: doc.edges, groups: doc.groups,
    direction: doc.direction, extras: doc.extras, notes: doc.notes,
  })
}

function restoreModel(saved) {
  var m = JSON.parse(saved)
  doc.name = m.name
  doc.file = m.file
  doc.tombstoned = m.tombstoned
  doc.nodes = m.nodes
  doc.edges = m.edges
  doc.groups = m.groups
  doc.direction = m.direction
  doc.extras = m.extras
  doc.notes = m.notes
}

/**
 * 落盘；失败就把内存恢复回改动前，并把原因记进日志。
 * 不恢复的后果：这一版改动只活在内存里，而后续任何一次落盘又会把它写出去 ——
 * 用户看到的是「明明改了，重启之后没了 / 时有时无」。
 */
async function persistOrRollback(saved, site) {
  var err = await persist()
  if (!err) return null
  restoreModel(saved)
  if (lastChange) lastChange = { by: lastChange.by, rev: doc.revision, nodes: [] }
  doc.warnings.push('保存失败，本次改动已回滚: ' + err)
  logEvent('error', 'persist.fail', { site: site, file: doc.file, error: err })
  return err
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
    if (kind === 'add_node') {
      var nid = op.id ? cleanId(op.id) : nextNodeId()
      if (findNode(nid)) { problems.push(tag + ': 节点 ' + nid + ' 已存在，改用 set_label'); continue }
      doc.nodes.push({
        id: nid,
        label: typeof op.label === 'string' && op.label !== '' ? op.label : nid,
        shape: SHAPE_WRAP[op.shape] ? op.shape : 'rect',
        group: typeof op.group === 'string' && op.group ? cleanId(op.group) : null,
        x: typeof op.x === 'number' ? op.x : null,
        y: typeof op.y === 'number' ? op.y : null,
        link: normLink(op.link),
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
