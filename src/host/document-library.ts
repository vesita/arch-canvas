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

/** 把 `<dir>/.arch-canvas` 里所有 `.mmd` 收成一条图库记录（目录本身是不是图库，看这一条有没有）。 */
async function collectLibrary(libDir, rel, out) {
  var entries = []
  try { entries = await fs.listDir(await fs.resolve(libDir)) } catch (e) { entries = [] }
  var files = []
  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i]
    if (entry.type !== 'file') continue
    // 图库里的图固定是 .mmd：改名/删除/落盘都靠「key + .mmd」定位文件，不能有第二种扩展名
    if (entry.name.slice(-LIB_EXT.length) !== LIB_EXT) continue
    files.push({ name: entry.name, bytes: entry.size || 0 })
  }
  if (files.length > 0 && out.dirs.length < SCAN_MAX_LIBS) {
    out.dirs.push({ dir: libDir, project: rel, files: files })
  }
}

/**
 * 一次项目扫描：找出所有 `.arch-canvas` 图库目录 + 散落的 mermaid 文件。只走目录，不读内容。
 *
 * **检测范围 = 会话目录及其子目录**（`root.scanFrom` 起、往下 ≤`SCAN_MAX_DEPTH` 层）。
 * 从前这里从 `root.workspace` 起走，而 workspace 是「往上找最外层图库」算出来的 ——
 * 一个会话坐在子目录里就会把上层的兄弟项目全扫进来（2026-10-08 的目录污染）。
 * 图库根在会话目录之上时（会话坐在项目子目录里），**根图库自己**额外补一条：
 * 它是这个会话的默认画布，虽然不落在会话目录这棵树下。
 */
async function scanProject(): Promise<ProjectScan> {
  var out: ProjectScan = { dirs: [], files: [], visited: 0, truncated: false }
  if (!fs) return out
  if (root.scope !== 'project' || !root.workspace) return out
  var anchor = cleanSessionDir(root.scanFrom || root.workspace)
  var rel = String(root.scanRel || '')
  if (rel) await collectLibrary(cleanSessionDir(root.workspace) + '/' + PROJECT_SUBDIR, '', out)
  await walkProject(anchor, rel, 0, out)
  return out
}

async function walkProject(absDir, rel, depth, out) {
  out.visited += 1
  if (out.visited > SCAN_MAX_DIRS) { out.truncated = true; return }
  // 1) 这个目录自己是不是一个图库（<dir>/.arch-canvas）
  await collectLibrary(absDir + '/' + PROJECT_SUBDIR, rel, out)
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

/** 扫描结果的**便宜**指纹（只走目录，不读文件）：谁加了/删了图，指纹就变。 */
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

/**
 * 清单的**内容**指纹：从真读出来的那一份 items 上算。
 * 它要回答的是「同字节数的改写」——`name:bytes` 判不出内容变过，于是清单里一直写着
 * 「同图库还有「g」(3 节点)」，而盘上只剩 1 个；连「重新扫描」按钮都因为「便宜指纹相同」直接返回旧 cache。
 * 只在**真读了文件**的那一趟算，所以「2.5s 轮询只走目录 + 比指纹」这条性质一点没动。
 */
function itemsFingerprint(items) {
  var parts = []
  for (var i = 0; i < items.length; i++) {
    var it = items[i] || {}
    parts.push(String(it.key) + ':' + it.nodes + ':' + it.edges + ':' + it.links + ':' +
      (it.deleted ? 1 : 0) + ':' + String(it.summary || ''))
  }
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
    // 没有项目根：全局图库是平铺的，既没有子项目图库也没有「散落文件」。
    // listDiagrams 本来就要读全文，所以这一条路天然看得见同字节数的内容变化 ——
    // 指纹要算**内容**（节点/边/下钻/总结），只算字节数的话 libraryRev 不涨、界面不刷新。
    var flat = await listDiagrams(root.dir)
    for (var i = 0; i < flat.length; i++) {
      flat[i].project = ''
      flat[i].key = flat[i].name
      flat[i].dir = root.dir
    }
    libraryCache = flat
    libraryFiles = []
    var fpFlat = itemsFingerprint(flat)
    if (fpFlat !== libraryItemsFingerprint) {
      libraryItemsFingerprint = fpFlat
      libraryRev += 1
    }
    libraryFingerprint = fpFlat
    return libraryCache
  }

  var scan = await scanProject()
  // 指纹里带上**检测锚点**：同一个图库根下，会话目录变了（项目根 ↔ 它的子目录）就是另一次
  // 扫描范围，不能因为「目录内容没变」而拿旧清单糊弄过去。
  var fp = String(root.scanFrom || root.workspace || '') + '|' + scanFingerprint(scan)
  // **force = 真读一遍内容**（「重新扫描」按钮与慢速定时器走这条）：便宜指纹相同**不代表**
  // 内容没变 —— 同字节数的改写只有真读才看得见。非 force（2.5s 轮询那条路）仍然只走目录 +
  // 比便宜指纹，指纹没变一个字节都不读、不解析。
  if (force || fp !== libraryFingerprint) {
    var nextItems = await buildLibraryItems(scan)
    var cfp = itemsFingerprint(nextItems)
    var changed = cfp !== libraryItemsFingerprint
    libraryCache = nextItems
    libraryItemsFingerprint = cfp
    libraryFingerprint = fp
    if (changed) {
      libraryRev += 1
      // 高频成功的巡检降为 debug：指纹没变就不读文件、不解析，这条记录的诊断价值只在于
      // "清单确实变了"。默认门槛（info）下不落盘；把 ARCH_CANVAS_LOG_LEVEL=debug 打开就能看到。
      logEvent('debug', 'library.scan', {
        libs: scan.dirs.length, files: scan.files.length, items: libraryCache.length,
        revision: libraryRev, visited: scan.visited, truncated: scan.truncated,
      })
    }
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
    // 读路径（loadInto）绝不创建任何东西：不 ensureDir、不播种默认图。
    // 项目图库目录或文件不存在时，把 doc 置成空文档，doc.file 仍指向本该写入的路径，标记 absent = true。
    // 只有显式 create（例如 doc:open { create: true } / arch_switch { create: true }）或全局图库才允许创建。
    if (create) {
      if (target.scope === 'project') {
        await ensureDir(target.dir, policy)
      }
      await loadNoteStoreFor(doc.file)
      // 「新建一张图」绝不许覆盖目标路径上已有的内容。
      // 目标文件已存在且有内容时，必须保留原有内容（读入并 adopt），不许用空文档当场盖掉。
      var existingText: string | null = null
      if (fs) {
        try {
          var t2 = await fs.resolve(doc.file)
          var i2 = await fs.stat(t2)
          if (i2) existingText = await fs.readText(t2)
        } catch (e2) { existingText = null }
      }
      if (existingText !== null && existingText !== '') {
        doc.absent = false
        doc.tombstoned = hasTombstone(existingText)
        adopt(parseMermaid(existingText))
        pushHistory(existingText, 'open', 'open')
      } else {
        adopt(emptyDoc())
        doc.absent = false
        var err = await persist(policy, 'doc:new', doc.file)
        if (err) doc.warnings.push('写入失败: ' + err)
      }
    } else if (target.scope === 'global' && clean === DEFAULT_DIAGRAM) {
      var items = await listDiagrams(target.dir)
      var seed = items.length === 0
      await loadNoteStoreFor(doc.file)
      adopt(seed ? seedDoc() : emptyDoc())
      doc.absent = false
      var errG = await persist(policy, 'seed', doc.file)
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
var DOC_SLOT_MAX = 12

/**
 * 一层的身份 = **它自己的图库目录**。
 *
 * 从前这里是 `target.workspace`，也就是**原始会话 cwd**。于是同一份 `.mmd` 会有两个身份：
 * cwd=项目根、下钻 key 打开 `A/x`；cwd=子目录，打开自己的 `x` —— 两者指向同一个目录，
 * 却各占一个内存槽、各持一份 doc，各自整份落盘 = **静默互相覆盖**（2026-09-27 实测）。
 * 身份按目录算之后，「同一个文件」在内存里也只有一个。
 */
function slotKeyOfLib(target) { return String((target && target.dir) || '') }
function activeSlotKey() { return slotKeyOfLib(lib) }

/** 归属（这一份内容给不给这一步、算不算「我的画布」）按**项目根**算，不按子图库那一层。 */
function projectKeyOfTarget(target) {
  return (target && target.scope === 'project') ? String(target.workspace || '') : ''
}

/**
 * 会话 cwd → **图库根**。
 *
 * cwd 常是项目里的任意一层子目录，甚至是没有 `.arch-canvas` 的源码目录（`项目/A/src`）。
 * 直接把它当项目根，会算出 `项目/A/src/.arch-canvas` 这个并不存在的图库：读起来是空画布，
 * 一旦有写（`doc:set` / `arch_switch {create:true}`）就在源码树里种出一个幽灵图库，
 * 反手被上层扫描列成新的子图库；同一个项目的 key 也会随 cwd 漂（`A/x` ↔ `x`）。
 *
 * 两条规矩：
 *   ① **key 的基准取最外层那个算数的图库** —— 同一个项目树里，不同 cwd 的会话算出同一个根、
 *      同一套 key（`P/A/x` 不随你坐在 `P` 还是 `P/A` 漂）。这一条没变。
 *   ② **算数**：只有真装了至少一张 `.mmd` 的 `.arch-canvas` 才算图库（`isRealLibrary`）。
 *      空壳目录（`ensureDir` 只写了 `.gitkeep`）不是项目 —— 2026-10-08 的现场就是
 *      `/home/vesita/coding/my/.arch-canvas`（只有 `.gitkeep` + 两行旁路表）这个空壳
 *      把它下面 8 个各有图库的项目全吞成一个项目。空壳不算数之后，`my/laya` 的会话
 *      算出的根是 `laya`（而不是 `my`），下面那些兄弟目录再也进不来。
 *
 * **检测范围不在这里定**：那是 `setScanAnchor` 的事 —— 扫描锚点永远是**会话目录**，
 * 图库根可以在它上层，但检测范围不许越过会话目录（见 scanProject）。
 *
 * 走不上去（都没有）就按原值 —— 此时会话目录**就是**它的项目，`.arch-canvas` 会在
 * 显式 `create` 时建在这里，不会自己长出来（读路径一个字节都不创建）。
 * 结果按原样缓存：sync 的调用方（`promptText`）只认缓存，命中不了退回原值。
 */
var projectRootCache = {}
var PROJECT_ROOT_WALK_MAX = 16
// 规范化的**天花板**：DSH 数据目录的上两级（= 用户 HOME）。
// 没有它的话，任何放在公共父目录上的 `.arch-canvas`（最典型是 `$HOME/.arch-canvas`，
// 插件自己就能造出来：在没有任何图库的目录里 `doc:open {create:true}`）
// 会把下面**所有**项目收成同一个项目 —— 各自的图库完全不被打开、互相覆盖、留言投错会话。
var PROJECT_ROOT_CEILING = (function () {
  var d = cleanSessionDir(DATA_DIR)
  if (!d) return ''
  var up1 = d.replace(/\/[^/]+$/, '')
  var up2 = up1.replace(/\/[^/]+$/, '')
  // 段数太少（数据目录直接挂在根下面，例如测试里的 /tmp/xxx）时别算出空串：退一级
  var segs = function (p) { return String(p).split('/').filter(function (x) { return x !== '' }).length }
  if (segs(up2) >= 2) return up2
  return segs(up1) >= 1 ? up1 : ''
})()
/**
 * **算数**的图库：`<dir>/.arch-canvas` 里至少有一张 `.mmd`。
 *
 * 光看目录在不在不够：`ensureDir` 建库时先写 `.gitkeep`，别的工具/手滑也会留下空目录。
 * 空壳一旦被当成图库，就成了「上层空壳吞掉所有项目」那条路（见上面 ①）。
 */
async function isRealLibrary(libDir) {
  if (!fs) return false
  var entries = []
  try {
    entries = await fs.listDir(await fs.resolve(libDir))
  } catch (e) { return false }
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i]
    if (e && e.type === 'file' && e.name.slice(-LIB_EXT.length) === LIB_EXT) return true
  }
  return false
}
/**
 * 图库目录刚被建出来：**它下面**那些 cwd 的规范化结果要作废。
 * 整表清空是错的 —— 别的会话（cwd 在别处）会因此失去缓存，而同步路径（`promptText`）
 * 没缓存就只能按原始 cwd 算，于是对模型说「画布停在别的项目上」，而事实是同一个项目。
 */
function forgetProjectRootsUnder(projectDir) {
  var base = cleanSessionDir(projectDir)
  if (!base) { projectRootCache = {}; return }
  var keys = Object.keys(projectRootCache)
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i]
    if (k === base || k.indexOf(base + '/') === 0) delete projectRootCache[k]
  }
}
async function canonicalProjectRoot(raw) {
  var w = cleanSessionDir(raw)
  if (w === '') return ''
  if (projectRootCache[w] !== undefined) return projectRootCache[w]
  var top = ''
  var cur = w
  var hitCeiling = false
  var i = 0
  for (i = 0; i < PROJECT_ROOT_WALK_MAX; i++) {
    // 天花板之上不认 —— 项目根不能是用户的 HOME 或它上面
    if (PROJECT_ROOT_CEILING && cur === PROJECT_ROOT_CEILING) { hitCeiling = true; break }
    // **最外层**那个**算数的**图库：命中继续往上找，最后落定的就是它
    if (await isRealLibrary(cur + '/' + PROJECT_SUBDIR)) top = cur
    var up = cur.replace(/\/[^/]+$/, '')
    if (!up || up === cur) break
    cur = up
  }
  // 走完上限（既没到天花板、也没找到）也要出声：静默退回原值就等于「幽灵图库」那条老路
  if (!top && !hitCeiling && i >= PROJECT_ROOT_WALK_MAX) {
    logEvent('warn', 'project.root.unresolved', { cwd: w, max: PROJECT_ROOT_WALK_MAX })
  }
  // **否定结果不进缓存**：`.arch-canvas` 可能在插件进程之外出现（用户手工建库、从别处搬来），
  // 缓存一个「这里没有图库」会让它一直不被承认 —— 而承认与否决定 key 基准与检测范围。
  // 肯定结果（找到真图库）照旧缓存；没找到时 sync 调用方退回味原始 cwd，也就是「这里没有图库」
  // 时的正确答案（`w/.arch-canvas`），不会因此说错。
  if (top) projectRootCache[w] = top
  else delete projectRootCache[w]
  return top || w
}

/**
 * 路径关系（两个绝对目录之间），用来把「这张图落在哪」如实摆出来。
 * `target` 在 `base` 里面 → 相对路径；就是它 → `.`；不在里面 → 原样给绝对路径
 * （**不编 `../`**：图库根可能在上层，编出来的相对路径没人看得懂）。
 */
function relFromTo(base, target) {
  var b = cleanSessionDir(base)
  var t = cleanSessionDir(target)
  if (!b || !t) return t
  if (t === b) return '.'
  if (t.indexOf(b + '/') === 0) return t.slice(b.length + 1)
  return t
}

/** 会话目录相对图库根的子路径（图库根自己、或在根之外时为空串）。由 relFromTo 派生。 */
function relUnder(base, target) {
  var r = relFromTo(base, target)
  var t = cleanSessionDir(target)
  return (!r || r === '.' || r === t) ? '' : r
}

/**
 * 把这一步的会话目录钉成**检测锚点** —— 只在它确实落在当前图库根里时才钉。
 * 每一次「这一步要看哪一层」的判定之后都要调它（含**换层之后**：槽里那份 `root` 的
 * `scanFrom` 是上一个用它的会话留下的，不重钉就会沿用别人的检测范围）。
 */
function applyScanAnchor(sessDir, canon?) {
  if (!sessDir || !canon || canon.scope !== 'project') return
  if (root.scope !== 'project' || canon.workspace !== root.workspace) return
  setScanAnchor(sessDir)
}

/**
 * 给清单项补上「它相对**这一步的**会话目录在哪」（`rel` / `relOutside`）。
 *
 * **消费时算，不烘进缓存**：缓存（`libraryCache`）是按图库目录共享的，两个会话分别坐在
 * 项目根与它的子目录里时锚点不同；烘进缓存就会把**上一个请求**的锚点当成这一步的
 * （实测：cwd=`my/laya` 的提示词把 `my/laya/.arch-canvas` 里的图标成绝对路径）。
 * 全局兜底没有会话目录可对齐 → `rel` 如实给绝对路径，`relOutside` 一律 false。
 */
function withRel(items, anchor) {
  var base = cleanSessionDir(anchor)
  var out = []
  for (var i = 0; i < items.length; i++) {
    var it = items[i] || {}
    var d = String(it.dir || '')
    var rel = (base && d) ? relFromTo(base, d) : d
    out.push(Object.assign({}, it, { rel: rel, relOutside: !!base && rel !== PROJECT_SUBDIR }))
  }
  return out
}

/**
 * 设定这一步的**检测锚点**：会话目录（不是图库根）。
 *
 * 图库根可能在上层（`项目/A/src` 的会话用 `项目/A` 的图库），但往下扫只能扫会话目录这一棵：
 * 检测范围 = **会话目录及其子目录**。少了它，一个坐在子目录里的会话会把上层的兄弟项目
 * 一起列进「同图库」（2026-10-08 的污染就是这一条）。
 */
function setScanAnchor(sessionDir) {
  var sd = cleanSessionDir(sessionDir)
  root.scanFrom = sd || cleanSessionDir(root.workspace)
  root.scanRel = relUnder(root.workspace, root.scanFrom)
}

/** 同步版：只认已经缓存过的规范化结果，没缓存过就按原值算。 */
function resolveLibCanonical(where) {
  var w = cleanSessionDir(where)
  if (w === '') return { dir: GLOBAL_DIR, scope: 'global', workspace: '' }
  var cached = projectRootCache[w]
  var base = (typeof cached === 'string' && cached) ? cached : w
  return { dir: base + '/' + PROJECT_SUBDIR, scope: 'project', workspace: base }
}

/**
 * 每个会话**自己选中的那一层**（`doc:open` / `arch_switch` 成功时记下）。
 *
 * 没有它的话「当前层」就是全进程唯一的一份 `lib`：同一个项目根下的两个会话分别打开
 * 子图库 A、B 时，后来者把 `lib` 改掉，前一个会话的下一次 `arch_edit` 就落进了**别人那张图**
 * —— 2026-09-27 实测：会话1 停在 A，会话2 打开 B，会话1 的 arch_edit 让 B 的 `.mmd` 变了、
 * A 一字未动。写盘认下的必须是自己这一层。
 */
var sessionLayer = {}
var SESSION_LAYER_MAX = 32
/**
 * `projectRoot` 必须传**会话规范化后的项目根**（不是这一层自己的 workspace）：
 * `libOf('A')` 给的 workspace 是 `项目/A`，拿它当归属键就与 `where` 算出来的项目根对不上，
 * 会话记忆会整个失效（实测：编辑跑去了项目的根图库）。
 */
function rememberLayer(sessionId, target, projectRoot) {
  var id = typeof sessionId === 'string' ? sessionId : ''
  if (!id || !target || !target.dir) return
  var ws = String(projectRoot || target.workspace || '')
  if (sessionLayer[id]) delete sessionLayer[id]   // 重新插入 = 续租，淘汰最旧的
  sessionLayer[id] = { dir: target.dir, scope: target.scope, workspace: ws }
  var keys = Object.keys(sessionLayer)
  if (keys.length > SESSION_LAYER_MAX) delete sessionLayer[keys[0]]
}

/**
 * 这次请求该看哪一层。三档，从具体到宽泛：
 *   ① 会话**自己选过**的那一层（`doc:open` / `arch_switch` 记的），且还在同一个项目根里；
 *   ② 当前**已经停着的**那一层 —— 前提是同项目、且它比项目根更深。
 *      `where` 只说明「是哪个项目」（会话 cwd），不说明「要看哪一层」。没有这一档，
 *      一次不带会话信息的 `where=项目根` 请求（工具、测试桩、无会话调用）会把刚下钻的层
 *      拽回根，并且拿当前层的内容去覆盖根图库 —— 实测把根图库写成了子图库的正文。
 *   ③ 都没有：项目根那一层。
 */
function layerForSession(where, sessionId) {
  var want = resolveLibCanonical(where)
  var id = typeof sessionId === 'string' ? sessionId : ''
  var rec = id ? sessionLayer[id] : null
  if (rec && want.scope === 'project' && rec.workspace === want.workspace) return rec
  // 只在**完全没有会话信息**时用这一档：会话 id 在、但没记过层，说明它是个新会话 ——
  // 那时按项目根给（确定、不会捡到别的会话私有的层）。
  if (id === '' && want.scope === 'project' && lib.dir && lib.dir !== want.dir &&
      root.scope === 'project' && root.workspace === want.workspace) {
    return { dir: lib.dir, scope: lib.scope, workspace: want.workspace }
  }
  return want
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
    libraryFingerprint: libraryFingerprint, libraryItemsFingerprint: libraryItemsFingerprint,
    libraryRev: libraryRev,
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
  libraryItemsFingerprint = s.libraryItemsFingerprint || ''
  libraryRev = s.libraryRev
  s.at = Date.now()
  return true
}

/**
 * 内存状态清成「准备重新加载」的样子（槽里没存过时才走这条）。
 *
 * **两个目标必须分开传**：`rootTarget` 永远是**项目根**那一层，`libTarget` 才是这次要用的那一层。
 * 从前把两者设成同一个对象，于是「会话记住的子图库」被当成了项目根 —— `libOf('')`（界面给根图
 * 发的就是**裸 key**）跟着落进那个子图库：用户点项目根的同名图，打开的是子图库里的同名文件，
 * 而且粘住不放（2026-10-01 独立复核实测：槽淘汰之后必现）。
 */
function resetToWorkspace(rootTarget, libTarget, sessionDir?) {
  root = rootTarget
  lib = libTarget
  // 检测锚点 = **会话目录**（不是图库根）：图库根可能在上层（会话坐在项目子目录里），
  // 但往下扫只扫会话目录这一棵。缺省退回图库根（调用方拿不到会话目录时）。
  setScanAnchor(sessionDir && String(sessionDir).trim() !== '' ? sessionDir : rootTarget && rootTarget.workspace)
  loadedFor = null
  libraryCache = []
  libraryFiles = []
  libraryCacheAt = 0
  libraryFingerprint = ''
  libraryItemsFingerprint = ''
  // **换新对象**：旧那份还挂在它自己的工作区槽里，原地改会把别人的图改掉
  doc = newDocState()
  lastChange = null
}

/**
 * 让内存里的文档变成「这一步该看的那一层」—— **同步**，只走内存槽。
 * 提示词注入是同步求值的（不能 await），所以它只认这一条路；真正的加载留给 ensureLoaded。
 * 「该看哪一层」由 `layerForSession` 决定（会话自己选过的那层优先）。
 */
function syncWorkspaceFor(where: string, sessionId?: string) {
  var want = layerForSession(where, sessionId)
  if (want.dir === lib.dir) return true
  return activateSlot(slotKeyOfLib(want))
}

/** 这份内存文档是不是「这一步该看的那一层」（提示词注入据此决定读不读给这一步）。 */
function docBelongsTo(where: string, sessionId?: string) {
  var want = layerForSession(where, sessionId)
  if (want.dir === lib.dir) return true
  // 外部文件：按「文件落在不在这个工作区里」判（它是用户明确打开的文件，不属于图库）
  if (doc.external) {
    var w = cleanSessionDir(want.workspace || where)
    var p = String(doc.external)
    return p === w || p.indexOf(w + '/') === 0
  }
  return false
}

/**
 * 这一步要的那一层，与「画布现在停的那一层」是不是**同一个项目** ——
 * 只用来决定提示词里那句说明怎么说：同一个项目里换层（A ↔ B）不能报「停在别的项目上」，
 * 那会让模型以为自己没有画布。
 */
function sameProjectAsCurrent(where: string, sessionId?: string) {
  var want = layerForSession(where, sessionId)
  return want.scope === 'project' && want.workspace === projectKeyOfTarget(root)
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
async function ensureLoaded(where?: string, sessionId?: string) {
  var policy = policyOfSessionId(sessionId)
  // 注意：`where: ''` 是**有效输入**（= 全局图库，没有项目根），不能与「没传 where」混为一谈。
  var hasWhere = typeof where === 'string'
  var raw = hasWhere ? where : ''
  // **会话目录**：规范化之前的原值。检测范围（自动扫描）以它为准 —— 图库根可以往上找，
  // 但检测范围不许越过会话目录（见 setScanAnchor / canonicalProjectRoot）。
  var sessDir = cleanSessionDir(raw)
  // cwd → 图库根：会话可能坐在项目里任意一层子目录（见 canonicalProjectRoot 的说明）。
  if (hasWhere && raw.trim() !== '') raw = await canonicalProjectRoot(raw)
  // 两个**不同**的东西：
  //   `canon` = 项目根那一层（`root` 永远是它，裸 key 与归属都按它算）；
  //   `next`  = 这次要写的那一层（会话自己选过的优先，见 layerForSession）。
  var canon = hasWhere ? resolveLibCanonical(raw) : null
  var next = hasWhere ? layerForSession(raw, sessionId) : null
  var nextKey = hasWhere ? slotKeyOfLib(next) : ''
  // 同一个图库根、不同的会话目录（两个会话分别坐在项目根与它的子目录里，共用同一个槽）：
  // 检测锚点跟**这一次的会话目录**走 —— 检测范围永远以这一步的会话目录为准。
  applyScanAnchor(sessDir, canon)
  // 快路：这一次要的就是当前这份、不用换层 —— 界面 2.5s 轮询走的就是这条，别为它排队。
  // 判据必须包含「内存里这份文档**真的**落在这一层里」：只信 `loadedFor` 的话，
  // 并发/错配期间 `doc` 可能已是别人那一层的，却仍被当成这一层返回（回执说谎）。
  if (hasWhere) {
    if (next.dir === lib.dir && (doc.external || (loadedFor === lib.dir && docInLayer(lib.dir)))) return { ok: true }
  } else if (doc.external || (loadedFor === lib.dir && docInLayer(lib.dir))) {
    return { ok: true }
  }
  return enqueueLoad(function () {
    // **指针切换必须排进队列。** 它全是同步改全局（doc / lib / root），从前放在队列外面：
    // 别的请求正在 await 自己的加载时，这一次调用已经把全局换成了自己的目标 ——
    // 于是那个请求醒来读到的全是别人的 doc/lib，落盘就把 A 的图写进了 B 的图库。
    // （2026-09-24 宿主审计第 1 条：实测 A 会话的 arch_edit 改掉了 B 项目的 .mmd。）
    if (hasWhere && next.dir !== lib.dir) {
      // 换层（同项目里下钻 / 回根，或换项目）：先把这一份存进它自己的槽，再看目标层存过没有。
      // 存过就只是换指针（不读盘、不 bump 修订号、把上一步投递过的留言状态原样留着）；
      // 没存过才重置并重新加载。
      saveActiveSlot()
      // 槽里那份 `root` 带着**上一个用它的会话**留下的 `scanFrom`：命中槽之后必须按这一步的
      // 会话目录重钉一次，否则切回来的第一次请求会沿用别人的检测范围（清单也可能因此带着
      // 别人锚点扫出来的条目）。
      if (activateSlot(nextKey)) {
        applyScanAnchor(sessDir, canon)
        return { ok: true }
      }
      resetToWorkspace(canon, next, sessDir)
    }
    // 打开的是项目里的外部文件：别被「图库加载」冲掉（界面每次请求都带 where）
    if (doc.external) return { ok: true }
    if (loadedFor === lib.dir) return { ok: true }
    return loadDiagram(lib, policy)
  })
}

/** 内存里这份文档是不是**真的**来自这一层（`doc.file` 落在这一层里）。 */
function docInLayer(dir) {
  var d = cleanSessionDir(dir)
  var f = String(doc.file || '')
  return !!d && f.indexOf(d + '/') === 0
}

/**
 * 这次请求**认下的那份文档**。`doc`/`lib`/`root` 是模块级全局，而一次请求里只要出现 await，
 * 别的会话的切库就可能把指针换走（切换现在排进队列了，但队列之外的 await 仍然存在）。
 * 于是：读路径在 await 之后拿它复核一遍，写路径把它交给 persist 当拒写依据。
 */
function docTicket() {
  return { slot: activeSlotKey(), dir: lib.dir, file: doc.file, rev: doc.revision }
}

function ticketHolds(t) {
  return activeSlotKey() === t.slot && lib.dir === t.dir && doc.file === t.file
}

/** 所有加载都排这一条队列 —— 并发进两个库时，内存里的文档与 lib 不会各说各话。 */
function enqueueLoad(task) {
  loadQueue = loadQueue.catch(function () {}).then(task)
  return loadQueue
}

/**
 * 记「内存里这份文档来自哪一层」—— 判据是 `doc.file` **真的**落在这一层里。
 *
 * 从前这里无条件写 `loadedFor = target.dir`（或只看 `lib.dir === target.dir`）：而 `loadInto`
 * 是**原地**改同一个 doc 对象，并发/错位时 `loadedFor` 会落后于 `doc`，快路于是把别人那一层的
 * 内容当成这一层返回 —— 回执里 `dir` 说 A、`file` 却在 B，还报 `saved:true`（2026-10-01 复核实测）。
 */
function noteLoaded(target) {
  var d = String((target && target.dir) || '')
  if (docInLayer(d)) loadedFor = d
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
    if (r && r.ok && lib.dir === target.dir) noteLoaded(target)
    return r
  })
}

async function loadDiagram(target, policy?) {
  // 读路径绝不创建任何东西：不 ensureDir、不播种默认图
  var result = await loadInto(doc.name || DEFAULT_DIAGRAM, false, target, policy)
  noteLoaded(target)
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

