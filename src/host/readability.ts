// 可读性闸门：AI 画出来的图，节点标题会不会在画布上**溢出方块**。
//
// 为什么需要它：`nodeSize()`（client/runtime.ts）的宽度公式有 300px 天花板 ——
// `w = min(300, max(104, widest * 8.2 + 36))`，而画布渲染（studio-render-canvas.ts）
// **只画标题、不换行、不截断**。两者一相撞，超过约 16 个汉字的标题就会画出盒子外，
// 压在邻居与连线上 —— 2026-10 实测：flowme/architecture 有节点溢出 1351px（盒宽的 4.5 倍），
// 全库 22% 的节点会撞线。用户对这件事的原话是「AI 画出来的初始图可读性很差」。
//
// 闸门形态：**软闸门** —— 不拒写（硬拒会连用户手拖的节点一起拦，而且拒绝保存比丢字段更糟），
// 而是把问题作为独立字段 `readability` 回给 AI，让它自己决定改不改。
// **不进 `problems`**：`problems` 的语义是「这个 op 没生效」，而可读性问题的 op 是生效了的；
// 混进去会让「problems 为空 = 全部成功」这条判断失真，也会撞坏既有测试的断言。
//
// 阈值不是拍的，是从渲染公式反解出来的：`widest * 8.2 + 36 <= 300` ⇒ `widest <= 32.2`。
// 这里取 32 留一点余量（盒子还有圆角与内边距）。视觉宽度按 `visualLen` 同一口径算
// （中文 2、其余 1），所以「约 16 个汉字」与「约 32 个英文字符」是同一个阈值。

/** 盒子装得下的视觉宽度（单位与 client 的 `visualLen` 一致：CJK 记 2，其余记 1）。 */
var READABLE_TITLE_UNITS = 32

/** 一次最多报几个节点：清单本身会进上下文，不该因为一张烂图把它挤爆。 */
var READABLE_MAX_REPORTS = 8

/**
 * 与 client `visualLen()` **逐字同口径**的实现。
 *
 * 不能引 client 那份：host 与 client 是两个独立的 tsc 程序、两段独立作用域，
 * host 侧够不着 client 的函数。所以这里是**第二份**实现 —— 这是有意的重复，
 * 判据是两边必须给出同一个数（守门断言里对拍，见 test/readability.test.mjs）。
 * 口径：`charCodeAt(i) > 0x2e7f` 记 2，否则记 1。
 */
function readableWidth(s) {
  var n = 0
  var str = String(s == null ? '' : s)
  for (var i = 0; i < str.length; i++) n += str.charCodeAt(i) > 0x2e7f ? 2 : 1
  return n
}

/** 标题 = label 的第一行（与 client 的 `splitLabel().title` 同一口径）。 */
function readableTitle(label) {
  var s = String(label == null ? '' : label)
  var i = s.indexOf('\n')
  return i < 0 ? s : s.slice(0, i)
}

/**
 * 扫一遍整张图，返回可读性问题清单（**空数组 = 没问题**）。
 *
 * 只查「会不会溢出」这一条：它是有物理上限、可判定的。像「标题该不该写意图/原理」
 * 这类风格问题不在这里查 —— 那属于 skill 的职责，机器判不了「写得好不好」。
 */
function checkReadability(nodes) {
  var out = []
  var list = Array.isArray(nodes) ? nodes : []
  for (var i = 0; i < list.length; i++) {
    var n = list[i]
    if (!n) continue
    var title = readableTitle(n.label)
    var units = readableWidth(title)
    if (units <= READABLE_TITLE_UNITS) continue
    out.push({
      id: String(n.id == null ? '' : n.id),
      title: title,
      units: units,
      limit: READABLE_TITLE_UNITS,
    })
  }
  return out
}

/** 把清单写成给 AI 看的一行（`problems` 之外的独立字段用）。 */
function readabilityText(list) {
  var items = Array.isArray(list) ? list : []
  if (items.length === 0) return ''
  var shown = []
  for (var i = 0; i < items.length && i < READABLE_MAX_REPORTS; i++) {
    var it = items[i] || {}
    // 标题本身可能很长 —— 报告里截断，否则这份提示自己就成了「长篇堆砌」。
    // `String()` 兜住非字符串：这个函数只做展示，不该因为一条脏数据把整条回执炸掉。
    var title = String(it.title == null ? '' : it.title)
    var t = title.length > 24 ? title.slice(0, 24) + '…' : title
    shown.push('`' + String(it.id == null ? '' : it.id) + '`「' + t + '」' + it.units + ' 单位')
  }
  var more = items.length > shown.length ? ('，另有 ' + (items.length - shown.length) + ' 个') : ''
  return '节点标题超出画布宽度上限（' + READABLE_TITLE_UNITS + ' 单位 ≈ 16 个汉字）：' + shown.join('、') + more +
    '。这些标题在画布上会画出方块、压住邻居。把**标题**改短（≤16 汉字），把细节移到 `意图：` / `原理：` 那几行（它们不画在画布上）。'
}
