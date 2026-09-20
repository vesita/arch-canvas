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
      try {
        var t = await fs.resolve(storePath)
        var info = await fs.stat(t)
        if (info) {
          var text = await fs.readText(t)
          if (text && text.trim()) {
            data = JSON.parse(text)
            if (!data || typeof data !== 'object' || Array.isArray(data)) data = {}
          }
        }
      } catch (e) {
        data = {}
        logEvent('warn', 'notes.load.fail', { path: storePath, error: msgOf(e) })
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
      diagramNotes[node.id] = { text: text, done: node.noteDone === true }
    } else {
      // note 为空 => 删掉该节点在表里的条目。只动当前 nodes 里出现的 id，别碰孤儿。
      delete diagramNotes[node.id]
    }
  }
}

async function saveNoteStoreFor(file: string, policy?: any): Promise<string | null> {
  if (!file) return null
  if (!fs) return 'fs 服务不可用'
  var storePath = noteStorePathFor(file)
  var store = noteStoreCache[storePath] || {}
  var body = JSON.stringify(store, null, 2) + '\n'
  try {
    var resolved = await fs.resolve(storePath)
    await fs.writeText(resolved, body, undefined, undefined, policy)
    return null
  } catch (e) {
    var err = msgOf(e)
    logEvent('error', 'notes.save.fail', { path: storePath, error: err })
    return err
  }
}
