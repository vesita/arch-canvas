// 元素留言旁路表存储（notes.json）
// 每个 .mmd 文件同目录下存放一个 notes.json。
// 结构：{ "<图文件名，例如 architecture.mmd>": { "<节点id>": { "text": "...", "done": false } } }
// 严禁 import / export，与宿主其他分片共享 apply(ctx) 作用域。

var noteStoreCache: Record<string, any> = {}
var noteStoreLoading: Record<string, Promise<any>> = {}

function noteStorePathFor(file: string): string {
  var s = String(file == null ? '' : file).replace(/\\/g, '/')
  var i = s.lastIndexOf('/')
  var dir = i >= 0 ? s.slice(0, i) : '.'
  return dir + '/notes.json'
}

function noteKeyFor(file: string): string {
  var s = String(file == null ? '' : file).replace(/\\/g, '/')
  var i = s.lastIndexOf('/')
  return i >= 0 ? s.slice(i + 1) : s
}

async function loadNoteStoreFor(file: string): Promise<any> {
  var storePath = noteStorePathFor(file)
  if (noteStoreCache[storePath]) return noteStoreCache[storePath]
  if (noteStoreLoading[storePath]) return noteStoreLoading[storePath]

  noteStoreLoading[storePath] = (async function () {
    var data = {}
    if (fs) {
      var text = ''
      try {
        var t = await fs.resolve(storePath)
        var info = await fs.stat(t)
        if (info) {
          text = await fs.readText(t)
        }
      } catch (e) {
        data = {}
        logEvent('warn', 'notes.load.fail', { path: storePath, error: msgOf(e) })
      }
      if (text && text.trim()) {
        try {
          var parsed = JSON.parse(text)
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            data = parsed
          } else {
            data = {}
          }
        } catch (e) {
          data = {}
          logEvent('warn', 'notes.load.fail', {
            path: storePath,
            error: msgOf(e),
            head: text.slice(0, 80),
          })
        }
      }
    }
    noteStoreCache[storePath] = data
    delete noteStoreLoading[storePath]
    return data
  })()

  return noteStoreLoading[storePath]
}

function applyNoteStore(file: string, nodes: any[], legacyNotes?: Record<string, { text: string; done: boolean }>) {
  if (!file || !Array.isArray(nodes)) return
  var storePath = noteStorePathFor(file)
  var store = noteStoreCache[storePath] || {}
  var diagramKey = noteKeyFor(file)
  var diagramNotes = store[diagramKey] || {}

  for (var i = 0; i < nodes.length; i++) {
    var node = nodes[i]
    if (!node || !node.id) continue
    var entry = diagramNotes[node.id]
    if (entry && typeof entry.text === 'string') {
      node.note = entry.text
      node.noteDone = entry.done === true
    } else if (legacyNotes && legacyNotes[node.id] && typeof legacyNotes[node.id].text === 'string') {
      // 迁移期兜底：表优先，正文兜底
      node.note = legacyNotes[node.id].text
      node.noteDone = legacyNotes[node.id].done === true
    }
  }
}

// 历史（done）最多留几条：再多就是垃圾 —— 用户要的是「刚才说了什么」能回看，不是一本档案。
// 超出的按**进入历史的时刻**从旧到新丢。见 harvestNoteStore 里对 `at` 的处理。
var NOTE_HISTORY_MAX = 6

function harvestNoteStore(file: string, nodes: any[]) {
  if (!file || !Array.isArray(nodes)) return
  var storePath = noteStorePathFor(file)
  if (!noteStoreCache[storePath]) noteStoreCache[storePath] = {}
  var store = noteStoreCache[storePath]
  var diagramKey = noteKeyFor(file)
  if (!store[diagramKey]) store[diagramKey] = {}
  var diagramNotes = store[diagramKey]

  for (var i = 0; i < nodes.length; i++) {
    var node = nodes[i]
    if (!node || !node.id) continue
    var text = typeof node.note === 'string' ? node.note : ''
    if (text) {
      var prev = diagramNotes[node.id]
      var done = node.noteDone === true
      // `at` = **进入历史的时刻**，在落盘这一刻才盖 —— 模型上没有这个字段，
      // 所以不用去动 normalizeModel 的白名单与快照（少碰三处就少三个静默丢字段的机会）。
      // 已经记过就沿用：否则每存一次盘，历史顺序都会被翻新一遍。
      diagramNotes[node.id] = {
        text: text,
        done: done,
        at: done ? ((prev && typeof prev.at === 'number' && prev.at > 0) ? prev.at : Date.now()) : 0,
      }
    } else {
      // note 为空 => 删掉该节点在表里的条目。只动当前 nodes 里出现的 id，别碰孤儿。
      delete diagramNotes[node.id]
    }
  }

  // 历史封顶：丢最旧的几条。
  var doneKeys = []
  for (var k in diagramNotes) {
    if (diagramNotes[k] && diagramNotes[k].done === true) doneKeys.push(k)
  }
  if (doneKeys.length > NOTE_HISTORY_MAX) {
    // 老记录没有 `at`（上限是后加的），它们的 at 一律是 0 —— 靠 `sort` 的**稳定性**兜底：
    // doneKeys 是按插入顺序收集的，而插入顺序 ≈ 时间顺序，相等时保留原序，丢的仍是最早那几条。
    //（ES2019 起 sort 保证稳定；实测第一次封顶丢掉的正是最早写进去的两条。）
    doneKeys.sort(function (a, b) { return (diagramNotes[a].at || 0) - (diagramNotes[b].at || 0) })
    var drop = doneKeys.length - NOTE_HISTORY_MAX
    for (var d = 0; d < drop; d++) {
      var goneId = doneKeys[d]
      delete diagramNotes[goneId]
      // **内存里也要跟着清。** 只删表、不清内存的话，界面还会列着一条盘上已经不存在的历史，
      // 而刷新之后它自己就没了 —— 那是界面在说谎（用户会以为「刚才那条怎么不见了」）。
      // 实测踩到过：盘上 6 条、内存 8 条，`resolvedNoteCount` 与 notes.json 对不上。
      for (var ni = 0; ni < nodes.length; ni++) {
        if (nodes[ni] && nodes[ni].id === goneId) { nodes[ni].note = ''; nodes[ni].noteDone = false }
      }
    }
  }
}

/**
 * 旁路表（与图同目录的派生数据文件）的统一写入口，两道闸门都在这里：
 *   闸门 1 **路径一致**：`fs.processPath` 解出来的必须严格等于预期路径 ——
 *     防的是「解析规则一歪，派生数据写到别的文件上、把用户的东西覆盖掉」。
 *   闸门 2 **内容可辨认**：文件不存在、或能 JSON.parse 成对象才允许写 ——
 *     防的是「这个路径上恰好有别人的东西，我们一把盖过去」。
 * 任一条不过：拒绝写入 + 记一条能指路的日志（**不许静默**）。
 *
 * `tag` 只用来拼事件名（notes / drift），两种旁路表共用同一份实现 ——
 * 这类闸门复制第二份，早晚会有一份忘了改。
 */
async function writeSidecarJson(storePath: string, store: any, policy?: any, tag?: string): Promise<string | null> {
  var name = tag || 'sidecar'
  var resolved: any = null
  try {
    resolved = await fs.resolve(storePath)
  } catch (e) {
    var resolveErr = msgOf(e)
    logEvent('error', name + '.save.fail', { path: storePath, error: resolveErr })
    return resolveErr
  }

  var actualPath = typeof fs.processPath === 'function'
    ? fs.processPath(resolved)
    : (resolved && (resolved.targetKey || resolved.displayPath || resolved))
  var expectedNormalized = storePath.replace(/\\/g, '/')
  var actualNormalized = String(actualPath || '').replace(/\\/g, '/')
  if (actualNormalized !== expectedNormalized) {
    logEvent('error', name + '.save.refused', {
      reason: 'path-mismatch',
      expected: storePath,
      actual: actualPath,
    })
    return '目标路径不一致，已拒绝写入'
  }

  try {
    var info = await fs.stat(resolved)
    if (info) {
      var existingText = await fs.readText(resolved)
      if (existingText && existingText.trim()) {
        try {
          var parsedExisting = JSON.parse(existingText)
          if (!parsedExisting || typeof parsedExisting !== 'object' || Array.isArray(parsedExisting)) {
            logEvent('error', name + '.save.refused', { reason: 'foreign-content', path: storePath })
            return '现有文件不是有效的对象，已拒绝覆盖'
          }
        } catch (e2) {
          logEvent('error', name + '.save.refused', { reason: 'foreign-content', path: storePath })
          return '现有文件内容非 JSON 格式，已拒绝覆盖'
        }
      }
    }
  } catch (e3) {
    var statOrReadErr = msgOf(e3)
    logEvent('error', name + '.save.fail', { path: storePath, error: statOrReadErr })
    return statOrReadErr
  }

  var body = JSON.stringify(store, null, 2) + '\n'
  try {
    await fs.writeText(resolved, body, undefined, undefined, policy)
    return null
  } catch (e4) {
    var err = msgOf(e4)
    logEvent('error', name + '.save.fail', { path: storePath, error: err })
    return err
  }
}

async function saveNoteStoreFor(file: string, policy?: any): Promise<string | null> {
  if (!file) return null
  if (!fs) return 'fs 服务不可用'
  var storePath = noteStorePathFor(file)
  var store = noteStoreCache[storePath] || {}
  var err = await writeSidecarJson(storePath, store, policy, 'notes')
  return err
}

/**
 * 改名时把留言表里那一格**搬过去**。
 *
 * 表以「图文件名」为键（`{ "architecture.mmd": { <节点id>: … } }`）。`doc:rename` 只搬了
 * `.mmd` 正文和墓碑，没动这张表 —— 于是旧键变成孤儿、新名字那张图一条留言都没有：
 * 用户改名后再打开，看到的是「留言自己没了」，而数据其实还躺在文件里。
 * （2026-09-20 宿主审计第 13 条。）
 */
async function renameNoteStoreFor(fromFile: string, toFile: string, policy?: any): Promise<string | null> {
  var fromKey = noteKeyFor(fromFile)
  var toKey = noteKeyFor(toFile)
  if (!fromKey || fromKey === toKey) return null
  var store
  try {
    store = await loadNoteStoreFor(fromFile)
  } catch (e) {
    return msgOf(e)
  }
  if (!store || typeof store !== 'object') return null
  if (!store[fromKey]) return null  // 这张图本来就没留言 —— 不写盘，别凭空造一个空表出来
  if (!store[toKey]) store[toKey] = store[fromKey]
  delete store[fromKey]
  return saveNoteStoreFor(toFile, policy)
}
