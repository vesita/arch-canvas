// ==================== 锚点保鲜（drift）：这张图是不是已经过期了 ====================
// `doc.fileStatus`（document.ts）只回答「文件/符号还在不在」。它答不了最常发生的那种腐烂：
// **函数还在，但它已经不是图上说的那个东西了** —— 改名、职责搬走、参数换掉，锚点照样是 ok，
// 而 AI 会照着它自信地读错东西。所以这里给每条锚点存一个**内容指纹**：
//   · 图上一次落盘时记一遍 —— 那一刻的代码，就是这张图所描述的那份代码；
//   · 之后每次加载比对，对不上就是「图还没动、代码先动了」，正是该提醒用户的时刻。
// 第二个信号是**漏画**：项目里哪些目录有源码、却一条锚点都没有。
//
// 指纹存在与图同目录的旁路表 `anchors.json` —— 与留言表 `notes.json` 同一套理由与闸门：
// 它是**派生数据**，不进 .mmd、不改文件格式，也**不进往返守恒检查**
// （见 mermaid.ts 的 RUNTIME_ONLY_FIELDS：漏一个就会每次保存都误报）。
//
// 三条边界，写死在这里：
// 1. **没有基线就不猜**。第一次（还没落过盘）只报「这次落盘会记上」，绝不把「未知」说成「过期」。
// 2. **算不出指纹就不猜**。文件读不到、超过 DRIFT_MAX_BYTES → 空串，当它没算过。
// 3. **读路径不写盘**。指纹只在 `persist()` 里记（写路径）；加载只读、只比。

var DRIFT_FILE = 'anchors.json'
var DRIFT_MAX_REFS = 60            // 一次最多给多少条锚点算指纹：有人塞一千条也不能把加载拖死
var DRIFT_MAX_BYTES = 1024 * 1024  // 超过 1MB 的文件不算指纹 —— 读它只为比对，不值当
var DRIFT_WALK_TTL_MS = 20000      // 源码目录清点缓存：doc:get 每 2.5s 一次，不能每次都走目录
var DRIFT_WALK_MAX_DIRS = 400
var DRIFT_WALK_MAX_FILES = 4000
var DRIFT_MAX_DIRS_SHOWN = 12

// 清点「漏画」时要跳过的目录：与图库扫描共用 SKIP_DIRS（node_modules/.git/dist/…），
// 再补上测试与生成物 —— 图本来就不画测试，把它们算成「漏画」只会把这条信号淹掉。
var DRIFT_SKIP_DIRS: Record<string, number> = {
  test: 1, tests: 1, __tests__: 1, spec: 1, specs: 1, e2e: 1,
  fixtures: 1, __mocks__: 1, __snapshots__: 1, migrations: 1,
  vendor: 1, third_party: 1, generated: 1, gen: 1, proto: 1,
  storybook: 1, '.storybook': 1,
  assets: 1, static: 1, public: 1, docs: 1, doc: 1, examples: 1,
}
var DRIFT_SOURCE_RE = /\.(ts|tsx|mts|cts|js|mjs|cjs|jsx|vue|svelte|py|rs|go|java|kt|kts|cs|rb|php|swift|dart|c|h|cc|cpp|hpp)$/i
// `lib` / `es` / `cjs` 与 `src` 同级时几乎一定是**编译产物**（TS 编到 lib/、打包到 es/）。
// 这一条是拿本仓库自己试出来的：第一次跑 drift，`lib/` 里 4 个产物文件被报成「有源码没画到」。
// 只在同级真有 `src` 时才跳过 —— 别的项目把真源码放 `lib/` 的情况不能一起枪毙。
var DRIFT_BUILD_DIRS: Record<string, number> = { lib: 1, es: 1, cjs: 1, esm: 1, umd: 1 }

var driftStoreCache: Record<string, any> = {}
var driftStoreLoading: Record<string, Promise<any>> = {}
var driftWalkCache: any = { root: '', at: 0, dirs: {}, files: 0, truncated: false }

function driftStorePathFor(file: string): string {
  var s = String(file == null ? '' : file).replace(/\\/g, '/')
  var i = s.lastIndexOf('/')
  var dir = i >= 0 ? s.slice(0, i) : '.'
  return dir + '/' + DRIFT_FILE
}

function driftKeyFor(file: string): string {
  var s = String(file == null ? '' : file).replace(/\\/g, '/')
  var i = s.lastIndexOf('/')
  return i >= 0 ? s.slice(i + 1) : s
}

async function loadDriftStoreFor(file: string): Promise<any> {
  var storePath = driftStorePathFor(file)
  if (driftStoreCache[storePath]) return driftStoreCache[storePath]
  if (driftStoreLoading[storePath]) return driftStoreLoading[storePath]

  driftStoreLoading[storePath] = (async function () {
    var data = {}
    if (fs) {
      var text = ''
      try {
        var t = await fs.resolve(storePath)
        var info = await fs.stat(t)
        if (info) text = await fs.readText(t)
      } catch (e) {
        data = {}
      }
      if (text && text.trim()) {
        try {
          var parsed = JSON.parse(text)
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed
          else data = {}
        } catch (e2) {
          data = {}
          logEvent('warn', 'drift.load.fail', { path: storePath, error: msgOf(e2), head: text.slice(0, 80) })
        }
      }
    }
    driftStoreCache[storePath] = data
    delete driftStoreLoading[storePath]
    return data
  })()

  return driftStoreLoading[storePath]
}

/** 内容指纹：只需要回答「变没变」，不要密码学强度。djb2 32 位，配上长度够用。 */
function fpOfText(text: string): string {
  var s = String(text == null ? '' : text)
  var h = 5381
  for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return s.length + ':' + (h >>> 0).toString(36)
}

/** 一条锚点当前的内容指纹。读不到 / 太大 / 判不了根 → ''（宁可不报，也不许假装没变）。 */
async function fpOfRef(ref: string, root: string): Promise<string> {
  if (!fs) return ''
  var parts = splitFileRef(ref)
  if (!parts.path) return ''
  var abs = /^\//.test(parts.path) ? parts.path : (root ? root + '/' + parts.path : '')
  if (!abs) return ''
  try {
    var t = await fs.resolve(abs)
    var info = await fs.stat(t)
    if (!info) return ''
    if (typeof info.size === 'number' && info.size > DRIFT_MAX_BYTES) return ''
    var text = await fs.readText(t)
    return fpOfText(text)
  } catch (e) {
    return ''
  }
}

/** 文档上所有锚点引用，去重保序，封顶。 */
function anchoredRefs(docArg: any): string[] {
  var seen: Record<string, number> = {}
  var out: string[] = []
  var nodes = (docArg && docArg.nodes) || []
  for (var i = 0; i < nodes.length && out.length < DRIFT_MAX_REFS; i++) {
    var refs = nodes[i].files || []
    for (var j = 0; j < refs.length && out.length < DRIFT_MAX_REFS; j++) {
      var r = String(refs[j] == null ? '' : refs[j]).trim()
      if (!r || seen[r]) continue
      seen[r] = 1
      out.push(r)
    }
  }
  return out
}

/**
 * 把当前所有锚点的指纹记进旁路表。**只在 persist()（写路径）里调用**。
 * 记的是「图上一次动过的那一刻，那些文件长什么样」—— 这就是以后比对用的基线。
 */
async function saveDriftStampsFor(docArg: any, policy?: any): Promise<string | null> {
  if (!fs || !docArg || !docArg.file) return null
  var root = fileRefRoot()
  var refs = anchoredRefs(docArg)
  if (!refs.length) return null
  var stamps: Record<string, string> = {}
  for (var i = 0; i < refs.length; i++) {
    var fp = await fpOfRef(refs[i], root)
    if (fp) stamps[refs[i]] = fp
  }
  var storePath = driftStorePathFor(docArg.file)
  var store = driftStoreCache[storePath] || {}
  if (!store || typeof store !== 'object' || Array.isArray(store)) store = {}
  store[driftKeyFor(docArg.file)] = { refs: stamps, at: Date.now() }
  var err = await writeSidecarJson(storePath, store, policy, 'drift')
  if (err) return err
  driftStoreCache[storePath] = store
  return null
}

/** 某个目录下有多少源码文件、有没有被锚点覆盖。走目录本身很便宜，但一秒钟几次也不行 —— 带 TTL。 */
async function sourceDirsOf(root: string): Promise<any> {
  var now = Date.now()
  if (driftWalkCache.root === root && now - driftWalkCache.at < DRIFT_WALK_TTL_MS) return driftWalkCache
  var out: any = { root: root, at: now, dirs: {}, files: 0, truncated: false }
  var budget = { dirs: 0, files: 0 }
  async function walk(absDir: string, rel: string) {
    if (out.truncated) return
    budget.dirs += 1
    if (budget.dirs > DRIFT_WALK_MAX_DIRS) { out.truncated = true; return }
    var kids = []
    try { kids = await fs.listDir(await fs.resolve(absDir)) } catch (e) { return }
    var hasSrc = false
    for (var hs = 0; hs < kids.length; hs++) {
      if (kids[hs].type === 'directory' && kids[hs].name === 'src') { hasSrc = true; break }
    }
    for (var i = 0; i < kids.length; i++) {
      var kid = kids[i]
      if (kid.name.charAt(0) === '.') continue
      var childRel = rel ? rel + '/' + kid.name : kid.name
      if (kid.type === 'directory') {
        if (SKIP_DIRS[kid.name] || DRIFT_SKIP_DIRS[kid.name]) continue
        if (hasSrc && DRIFT_BUILD_DIRS[kid.name]) continue
        await walk(absDir + '/' + kid.name, childRel)
        if (out.truncated) return
        continue
      }
      if (kid.type !== 'file') continue
      if (!DRIFT_SOURCE_RE.test(kid.name)) continue
      // 类型声明不是「要画进框架图的源码」：`.d.ts` 只是声明，画它没有意义。
      if (/\.d\.[cm]?ts$/i.test(kid.name)) continue
      if (/\.min\./i.test(kid.name)) continue
      if (budget.files >= DRIFT_WALK_MAX_FILES) { out.truncated = true; return }
      budget.files += 1
      out.files += 1
      var key = rel || '.'
      out.dirs[key] = (out.dirs[key] || 0) + 1
    }
  }
  await walk(root, '')
  driftWalkCache = out
  return out
}

/** 目录深度（`a/b/c` → 3），用来只报「最浅的那个没被画到的目录」。 */
function depthOfDir(d: string): number {
  if (!d || d === '.') return 0
  return d.split('/').length
}

/**
 * 算一次保鲜报告。**只读**：不写盘、不建目录。
 * 返回 { stale, uncovered, files, baseline, truncated, checkedAt }：
 *   stale   —— 锚点还能解析、但文件内容在图上一次落盘之后变过：{ node, ref }
 *   uncovered —— 有源码却没被任何锚点覆盖的目录（只报最浅的那一层）：{ dir, files }
 *   baseline —— 是否已经有基线（没有就别把它当成「过期」）
 */
async function computeDrift(): Promise<any> {
  var out: any = {
    stale: [], uncovered: [], files: 0, baseline: false,
    truncated: false, checkedAt: Date.now(), external: !!(doc && doc.external),
  }
  if (!fs || !doc || !doc.file) return out

  var store = await loadDriftStoreFor(doc.file)
  var mine = store[driftKeyFor(doc.file)] || null
  var base = (mine && mine.refs && typeof mine.refs === 'object') ? mine.refs : null
  out.baseline = !!base
  if (!base) return out

  var root = fileRefRoot()
  var refs = anchoredRefs(doc)
  var now: Record<string, string> = {}
  for (var i = 0; i < refs.length; i++) now[refs[i]] = await fpOfRef(refs[i], root)
  for (var n = 0; n < doc.nodes.length; n++) {
    var node = doc.nodes[n]
    var list = node.files || []
    var status = (doc.fileStatus && doc.fileStatus[node.id]) || {}
    for (var j = 0; j < list.length; j++) {
      var ref = String(list[j] == null ? '' : list[j]).trim()
      if (!ref) continue
      if (status[ref] && status[ref] !== 'ok') continue   // 坏掉的由 fileStatus 报，不重复
      var was = base[ref]
      var is = now[ref]
      if (!was || !is) continue                            // 没基线、或这次算不出来 → 不猜
      if (was !== is) out.stale.push({ node: node.id, ref: ref })
    }
  }

  // 漏画：有源码、却没被任何锚点覆盖的目录。只报最浅的那一层，并把子目录折进去。
  if (!out.external && root) {
    var walked = await sourceDirsOf(root)
    out.files = walked.files
    out.truncated = !!walked.truncated
    var coveredDirs: Record<string, number> = {}
    for (var c = 0; c < refs.length; c++) {
      var p = splitFileRef(refs[c]).path.replace(/\\/g, '/')
      var cut = p.lastIndexOf('/')
      if (cut > 0) coveredDirs[p.slice(0, cut)] = 1
    }
    var dirs = Object.keys(walked.dirs || {})
    dirs.sort(function (a, b) { return depthOfDir(a) - depthOfDir(b) })
    var shown: string[] = []
    for (var d = 0; d < dirs.length; d++) {
      var dir = dirs[d]
      if (dir === '.') continue
      var isCovered = false
      for (var cd in coveredDirs) {
        if (cd === dir || cd.indexOf(dir + '/') === 0) { isCovered = true; break }
      }
      if (isCovered) continue
      // 父目录已经报过就不再报它（报「最浅的那一层」才有用）
      var underShown = false
      for (var s = 0; s < shown.length; s++) {
        if (dir.indexOf(shown[s] + '/') === 0) { underShown = true; break }
      }
      if (underShown) continue
      shown.push(dir)
      if (shown.length > DRIFT_MAX_DIRS_SHOWN) break
    }
    for (var k = 0; k < shown.length; k++) {
      var count = 0
      for (var kk in walked.dirs) {
        if (kk === shown[k] || kk.indexOf(shown[k] + '/') === 0) count += walked.dirs[kk]
      }
      out.uncovered.push({ dir: shown[k], files: count })
    }
  }
  return out
}
