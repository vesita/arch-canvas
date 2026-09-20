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

  var resolved: any = null
  try {
    resolved = await fs.resolve(storePath)
  } catch (e) {
    var resolveErr = msgOf(e)
    logEvent('error', 'notes.save.fail', { path: storePath, error: resolveErr })
    return resolveErr
  }

  // 闸门 1：路径一致。拿到 fs.processPath(target) 或重新 resolve 比对，确认解析出来的 target 确实就是 noteStorePathFor(file) 这个路径
  var actualPath = typeof fs.processPath === 'function'
    ? fs.processPath(resolved)
    : (resolved && (resolved.targetKey || resolved.displayPath || resolved))
  var expectedNormalized = storePath.replace(/\\/g, '/')
  var actualNormalized = String(actualPath || '').replace(/\\/g, '/')
  var pathMatch = actualNormalized === expectedNormalized
  if (!pathMatch) {
    logEvent('error', 'notes.save.refused', {
      reason: 'path-mismatch',
      expected: storePath,
      actual: actualPath,
    })
    return '目标路径不一致，已拒绝写入'
  }

  // 闸门 2：内容可辨认。先读现有文件；文件不存在或能 JSON.parse 成对象才允许写。如果存在但解析不了，拒绝写
  try {
    var info = await fs.stat(resolved)
    if (info) {
      var existingText = await fs.readText(resolved)
      if (existingText && existingText.trim()) {
        try {
          var parsedExisting = JSON.parse(existingText)
          if (!parsedExisting || typeof parsedExisting !== 'object' || Array.isArray(parsedExisting)) {
            logEvent('error', 'notes.save.refused', { reason: 'foreign-content', path: storePath })
            return '现有文件不是有效的留言表对象，已拒绝覆盖'
          }
        } catch (e) {
          logEvent('error', 'notes.save.refused', { reason: 'foreign-content', path: storePath })
          return '现有文件内容非 JSON 格式，已拒绝覆盖'
        }
      }
    }
  } catch (e) {
    // 读取现有文件状态报错（非 ENOENT）
    var statOrReadErr = msgOf(e)
    logEvent('error', 'notes.save.fail', { path: storePath, error: statOrReadErr })
    return statOrReadErr
  }

  var store = noteStoreCache[storePath] || {}
  var body = JSON.stringify(store, null, 2) + '\n'
  try {
    await fs.writeText(resolved, body, undefined, undefined, policy)
    return null
  } catch (e) {
    var err = msgOf(e)
    logEvent('error', 'notes.save.fail', { path: storePath, error: err })
    return err
  }
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
