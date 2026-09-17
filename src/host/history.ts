// ==================== 检查点（快照） ====================
// 这里换掉的是早先那道「AI 写图开关」。那条路的问题是**机制本身不可用**：
// 开关状态要落盘到 `<dataDir>/settings.json`（在会话工作区之外），而那次写入没带沙箱策略
// —— 在真机上 `setting:set` 永远抛 file access denied，用户点了也打不开（见 AGENTS.md）。
// 与其修一条「拦人」的路，不如换一条「兜底」的路：
//
//   **不拦 AI 改图，但每一次改动都留一份快照，并标明是谁改的 —— 改坏了点一下退回去。**
//
// 三条设计取舍：
// 1. **只在内存里。** 真相源始终是那个 `.mmd` 文件本身，历史只在「刚刚改坏了、撤回去」这个
//    窗口里有用；写盘要再挂一条沙箱策略路径（正是上面那个坑），代价与收益不成比例。
//    代价是重启后历史清空 —— 界面上写着这句话，别让它看起来像个持久化的版本库。
// 2. **按文件分开存。** 切图/切项目时历史不该串味：`doc.file` 就是键（外部文件按路径打开也适用）。
// 3. **只在新状态**（写盘成功之后）留一份，标签取 `doc.updatedBy` 与 `lastChange.nodes`。
//    于是「回到某一点」= 把那一份文本重新装回文档，而不是「撤销一步」——
//    撤销是界面的事（它有 60 步内存历史），这里是**跨会话、跨工具**的落点。
var HISTORY_LIMIT = 50

/** { [file]: [ { seq, rev, by, at, site, text, nodeCount, edgeCount, changed } ] }，新的在后面。 */
var historyByFile = {}
var historySeq = 0

function historyKey() {
  return doc.file || ''
}

function historyOf(file) {
  var key = String(file == null ? '' : file)
  if (!historyByFile[key]) historyByFile[key] = []
  return historyByFile[key]
}

/**
 * 记一份检查点。`text` 是这一刻的完整文件正文（落盘写什么，这里就存什么）。
 * 连续两次正文逐字节相同就不记（切图、重复保存、hmr 重新加载都会走到这里）；
 * 同一份内容只在历史里出现一次，列表才是「改动」而不是「操作」。
 * `byOverride` 给「打开」这种**不是改动**的入口用：那时 doc.updatedBy 还是上一份文档留下的。
 */
function pushHistory(text, site, byOverride?) {
  var body = String(text == null ? '' : text)
  if (!body || !doc.file) return null
  var list = historyOf(historyKey())
  if (list.length > 0 && list[list.length - 1].text === body) return list[list.length - 1]
  var lc = lastChange && lastChange.rev === doc.revision ? lastChange : null
  var entry = {
    seq: ++historySeq,
    rev: doc.revision,
    by: byOverride || doc.updatedBy || 'init',
    at: Date.now(),
    site: String(site == null ? '' : site),
    text: body,
    nodeCount: doc.nodes.length,
    edgeCount: doc.edges.length,
    changed: lc && lc.nodes ? lc.nodes.slice(0, 12) : [],
  }
  list.push(entry)
  while (list.length > HISTORY_LIMIT) list.shift()
  return entry
}

/** 给界面看的清单：不带正文（正文是整份文件，列表不需要）。 */
function historyList() {
  var list = historyOf(historyKey())
  var out = []
  for (var i = list.length - 1; i >= 0; i--) {
    var e = list[i]
    out.push({
      seq: e.seq, rev: e.rev, by: e.by, at: e.at, site: e.site,
      nodeCount: e.nodeCount, edgeCount: e.edgeCount, changed: e.changed.slice(),
      current: i === list.length - 1,
    })
  }
  return out
}

function findHistory(seq) {
  var list = historyOf(historyKey())
  for (var i = 0; i < list.length; i++) if (list[i].seq === seq) return list[i]
  return null
}

/** 「AI 的改动（修订 12）」这种给人看的一句话 —— 回执与检查点说明里都用它。 */
var HISTORY_BY_LABEL = { ai: 'AI', user: '用户', open: '打开', switch: '切换', init: '初始' }
function historyByLabel(by) { return HISTORY_BY_LABEL[by] || String(by || '') }
function historyLabelOf(e) {
  return historyByLabel(e.by) + '的改动（修订 ' + e.rev + '）'
}

/** 当前文档落成正文时的样子 —— 与 persist 写出去的那份逐字节一致。 */
function currentText() {
  var body = serializeDoc(doc)
  if (doc.tombstoned) body = TOMBSTONE + '\n' + body
  return body
}
