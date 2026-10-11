function normalizeModel(model) {
  var nodes = []
  var seen = {}
  // 归一撞名（`a-b` 与 `a.b` → `a_b`，`1` 与 `n1` → `n1`）时给后来者加稳定后缀，两条都活下来。
  // 从前这里是 `if (seen[id]) continue` —— 静默丢掉一个用户写下的节点。
  // `idOwners` / `idOfRaw` 由 claimNodeId 与下面那行一起维护：边的两端也必须按
  // **原始写法**认回被改名的那个（否则 `a.b --> X` 会被挂到 `a-b` 那个节点上）。
  // 无原型对象：id 来自模型，可能是 `__proto__`（`map['__proto__']` 会拿到 Object.prototype）。
  var idOwners = Object.create(null)
  var idOfRaw = Object.create(null)
  function warnNorm(message) {
    if (doc.warnings.length < 50) doc.warnings.push(message)
  }
  var rawNodes = Array.isArray(model.nodes) ? model.nodes : []
  for (var i = 0; i < rawNodes.length; i++) {
    var n = rawNodes[i]
    if (!n || typeof n !== 'object') continue
    var rawId = String(n.id == null ? '' : n.id)
    var id = claimNodeId(idOwners, rawId, warnNorm)
    if (idOfRaw[rawId] === undefined) idOfRaw[rawId] = id
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
      // `@file` 的值走 `qRef()`/`unquoteRef()`（不套标签实体转义），读侧会把 br 变体解成换行 ——
      // 写侧不过同一道归一，往返检查每次保存都会报 serialize.not-idempotent。
      var fv = normalizeBreaks(rawFiles[fi]).trim()
      if (!fv || fv.length > 300) continue
      if (fileList.indexOf(fv) < 0) fileList.push(fv)
    }
    var tagList = []
    var rawTags = Array.isArray(n.tags) ? n.tags : []
    for (var ti = 0; ti < rawTags.length && tagList.length < 20; ti++) {
      if (typeof rawTags[ti] !== 'string') continue
      var tv = rawTags[ti].trim()
      if (tv && tagList.indexOf(tv) < 0) tagList.push(tv)
    }
    nodes.push({
      id: id,
      label: typeof n.label === 'string' && n.label ? normalizeBreaks(n.label) : id,
      shape: SHAPE_WRAP[n.shape] ? n.shape : 'rect',
      tags: tagList,
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
    // 两端按**原始写法**认节点：归一撞名时 `a.b` 已经被改叫 `a_b_2`，
    // 直接 cleanId 会把它接到 `a_b`（另一个节点）上 —— 那是把用户的边悄悄挪到错的节点。
    var rawFrom = String(e.from == null ? '' : e.from)
    var rawTo = String(e.to == null ? '' : e.to)
    var from = idOfRaw[rawFrom] !== undefined ? idOfRaw[rawFrom] : cleanId(e.from)
    var to = idOfRaw[rawTo] !== undefined ? idOfRaw[rawTo] : cleanId(e.to)
    if (!seen[from] || !seen[to]) continue
    if (from === to) continue
    edges.push({
      id: 'e' + (edges.length + 1), from: from, to: to,
      label: normalizeBreaks(typeof e.label === 'string' ? e.label : ''),
      arrow: ARROW_SET[e.arrow] ? e.arrow : '-->',
    })
  }
  var groups = []
  var known = {}
  for (var a = 0; a < nodes.length; a++) if (nodes[a].group) known[nodes[a].group] = true
  var rawGroups = Array.isArray(model.groups) ? model.groups : []
  var seenGroupIds = {}
  for (var k = 0; k < rawGroups.length; k++) {
    var g = rawGroups[k]
    if (!g || typeof g !== 'object') continue
    var gid = cleanId(g.id)
    // 组 id 要去重：重复的组会让同一个节点在文件里出现两遍、`groupCount` 虚高，而往返检查
    // 因为「parse 回来的也是两个组」判不出异常（2026-09-24 宿主审计第 11 条）。保留第一条。
    // 注意用**单独的** seen 集合：`known` 里还装着「节点引用了、但还没登记标签的组」，
    // 拿它去重会把那一组的 label 丢掉、退化成组 id。
    if (seenGroupIds[gid]) continue
    seenGroupIds[gid] = true
    groups.push({ id: gid, label: typeof g.label === 'string' && g.label ? normalizeBreaks(g.label) : gid })
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

/** 这两点之间有没有连线（按 cleanId 归一后比）。改标签/删连线要先问它 —— 见 applyOps 里的说明。 */
function hasEdge(from, to) {
  var a = cleanId(from)
  var b = cleanId(to)
  for (var i = 0; i < doc.edges.length; i++) {
    if (doc.edges[i].from === a && doc.edges[i].to === b) return true
  }
  return false
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

/**
 * 合并全图同向平行连线：
 * 当两点之间存在多条同起点、同终点的边时，将其标签合并用 " / " 分隔，
 * 保留第一条边的线型与属性并删除冗余平行线，降低画布缠绕度。
 */
function consolidateParallelEdges(targetDoc) {
  var d = targetDoc || doc
  if (!d || !Array.isArray(d.edges) || d.edges.length <= 1) return 0
  var edgeMap = {}
  var newEdges = []
  var mergedCount = 0
  for (var i = 0; i < d.edges.length; i++) {
    var e = d.edges[i]
    var key = e.from + '->' + e.to
    if (!edgeMap[key]) {
      edgeMap[key] = {
        id: e.id,
        from: e.from,
        to: e.to,
        labels: e.label ? [e.label] : [],
        arrow: e.arrow || '-->'
      }
      newEdges.push(edgeMap[key])
    } else {
      mergedCount++
      if (e.label && edgeMap[key].labels.indexOf(e.label) < 0) {
        edgeMap[key].labels.push(e.label)
      }
    }
  }
  if (mergedCount > 0) {
    for (var j = 0; j < newEdges.length; j++) {
      var item = newEdges[j]
      item.label = item.labels.join(' / ')
      delete item.labels
    }
    d.edges = newEdges
  }
  return mergedCount
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
async function persistOrRollback(saved, site, policy?, expectFile?) {
  var err = await persist(policy, site, expectFile)
  if (!err) return null
  // **指针被换走时不许回滚。** `restoreModel(saved)` 是把 A 的快照灌回**当下**那份文档 ——
  // 而它已经是 B 的了，那比「这一次没写成」坏得多（等于拿 A 的状态覆盖 B 的图）。
  if (typeof expectFile === 'string' && expectFile && doc.file !== expectFile) {
    logEvent('error', 'persist.rollback.skipped', { site: site || '', expected: expectFile, actual: doc.file })
    return err
  }
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
  // **认下这一份文档再用快照覆盖它。** `persistOrRollback` 的闸门要靠 expectFile 才可达：
  // 从前没传，于是「写盘失败 + 那一刻指针被换走」时 `restoreModel(saved)` 会把 A 的快照灌进
  // **当下（B 的）文档** —— B 的槽被就地改写，下一次编辑直接写到 A 的文件上，
  // 而 `persist.rollback.skipped` 一次都不出现。
  var expectFile = doc.file
  adopt(parsed)
  adoptModel(modelOf())
  doc.tombstoned = hasTombstone(entry.text)
  bump('user')
  noteUserChange()
  doc.notes = ['回到检查点：' + historyLabelOf(entry)]
  var err = await persistOrRollback(saved, 'rollback:' + seq, policy, expectFile)
  if (err) {
    logEvent('error', 'history.rollback.fail', { seq: seq, file: doc.file, error: err })
    return { ok: false, error: err }
  }
  logEvent('info', 'history.rollback', {
    seq: seq, file: doc.file, fromRev: entry.rev, nodes: doc.nodes.length, edges: doc.edges.length,
  })
  return { ok: true }
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
    var hasPos = typeof n.x === 'number' && isFinite(n.x) && typeof n.y === 'number' && isFinite(n.y)
    if (n.note || (n.files && n.files.length) || hasPos) {
      old[n.id] = {
        note: n.note || '',
        done: n.noteDone === true,
        files: (n.files || []).slice(),
        pos: hasPos ? { x: n.x, y: n.y } : null
      }
    }
  }
  var kept = 0
  for (var j = 0; j < parsed.nodes.length; j++) {
    var p = parsed.nodes[j]
    if (!old[p.id]) continue    // 节点没重画出来，注释与锚点跟着它一起走
    // 坐标继承：新文本没有自己指定坐标且旧图有坐标时，继承旧图坐标，避免重画导致排版打散
    if (old[p.id].pos && (p.x == null || !isFinite(p.x))) {
      p.x = old[p.id].pos.x
      p.y = old[p.id].pos.y
    }
    if (!p.note && old[p.id].note) {
      p.note = old[p.id].note
      p.noteDone = old[p.id].done
    }
    // 代码锚点同理：AI 重画时不该把用户标的文件引用抹掉（新文本自己写了就用新的）
    if (!(p.files && p.files.length) && old[p.id].files.length) {
      p.files = old[p.id].files.slice()
    }
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
