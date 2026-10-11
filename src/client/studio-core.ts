// 画布模块级的常量与纯函数（从 studio.ts 头部原样搬来）。
// 这些声明原来是 studio.ts 的全局头部，原样搬来（分片共享同一段作用域，不能 import）。
var PLUGIN_CTX = null
var TAB_ID = 'arch-canvas'

/**
 * 按下之后多远才算「拖动」而不是「点了一下」（client 像素，曼哈顿距离）。
 * 定这条门槛是为了让「点选」这个动作在触控板上也可靠：人的手点一下很少一动不动，
 * 没有门槛就会把「手抖了一像素」当成拖动 —— 既挪了节点、又记一条假历史、还不开详情。
 */
var DRAG_SLOP = 4

/**
 * 方向键微调的「静默窗口」（ms）：最后一下 keydown 之后过这么久就落一次盘。
 * 按住方向键 ≈2 秒有 60 次自动重复；每一跳都 `doc:set` 的话，60 步撤销栈被整条 shift 掉、
 * 宿主 50 份检查点缓冲也被冲掉 —— 用户再也退不回自己真正的编辑（改名 / 拖拽）。
 * 所以一次手势（一连串 keydown + 一次 keyup）只落**一条**历史、只发**一次** doc:set（见 nudgeSel）。
 */
var NUDGE_IDLE_MS = 450

/**
 * 底部检查器（详情面板）的高度（px）—— 用户在面板上边缘拖出来的结果。
 * **只活在模块里**：切走子页、换会话都还在，重启 dsh 就复位。与「视角、撤销栈」同一条
 * 记忆规则（见 studioMemo 那段注释）：这些是用户**自己调过**的东西，重开面板该还在；
 * 而面板里的草稿、选中、开合状态都不记 —— 那些是「正在做的事」。
 */
var STUDIO_DOCK_H = null

// 当前画布的实时节点快照，供 register.ts 里的 @ 引用 trigger source 消费。
// **按会话分开存**：画布现在住在主窗口子页里（`conversation.view`），切到「对话」页就是卸载，
// 而快照是模块级的、卸载不会清。从前只有一个数组，于是在另一个会话（另一个项目）里打 @，
// 列出来的是**上一次打开的那张图**的节点，插进草稿的展开文本也是旧的 —— 静默给错数据。
// 快照归谁，就只给谁用；拿不到就是空，空比别人的图好。
var studioSnapshots = {}
var studioActiveSession = ''   // 最近一次被 @ 引用源问到的会话（candidates / lexicon）
var STUDIO_SNAP_MAX = 8

function syncLiveNodes(m, sessionId) {
  var sid = String(sessionId == null ? '' : sessionId)
  if (!sid) return
  studioSnapshots[sid] = {
    nodes: (m && m.nodes && Array.isArray(m.nodes)) ? m.nodes.slice() : [],
    at: Date.now(),
  }
  studioActiveSession = sid
  var keys = Object.keys(studioSnapshots)
  if (keys.length > STUDIO_SNAP_MAX) {
    var oldest = '', touched = Infinity
    for (var i = 0; i < keys.length; i++) {
      var t = studioSnapshots[keys[i]].at || 0
      if (t < touched) { touched = t; oldest = keys[i] }
    }
    if (oldest && oldest !== sid) delete studioSnapshots[oldest]
  }
}

/**
 * 某个会话当前那份快照的节点。`lexicon` 与 `candidates` 都只有会话 id（见 register.ts），
 * 拿不到就是空列表 —— 契约要求 lexicon **同步、无副作用**，所以这里不做任何补取。
 */
function liveNodesOf(sessionId) {
  var sid = String(sessionId == null ? '' : sessionId)
  if (sid) studioActiveSession = sid
  var e = sid ? studioSnapshots[sid] : null
  return (e && e.nodes) ? e.nodes : []
}

/**
 * `codec.serialize(ref, signal)` 的解析。契约里它**拿不到会话**，所以按「最近一次被问到的
 * 会话」优先；两个会话都有同名节点、而活跃的那个没有时，宁可不展开也不许把另一张图的话
 * 塞进 prompt —— 这条路上错一次，AI 就会拿着别人图上的描述去改代码。
 */
function resolveLiveNode(ref) {
  var hit = null, hits = 0
  var keys = Object.keys(studioSnapshots)
  for (var i = 0; i < keys.length; i++) {
    var nodes = studioSnapshots[keys[i]].nodes || []
    for (var j = 0; j < nodes.length; j++) {
      if (nodes[j] && nodes[j].id === ref) {
        hits++
        if (keys[i] === studioActiveSession) return nodes[j]
        if (hit === null) hit = nodes[j]
        break
      }
    }
  }
  return hits <= 1 ? hit : null
}

/**
 * drift.stale 里那一串 { node, ref } 摊平成 `{ 引用: 1 }`。
 * 角标与检查器都要按**引用**判，而宿主的报告是按**节点**列的 —— 在这里摊一次，别在渲染里摊 N 次。
 */
function staleRefSet(drift) {
  var out = {}
  if (!drift || !drift.stale || !drift.stale.length) return out
  for (var i = 0; i < drift.stale.length; i++) {
    var r = drift.stale[i] && drift.stale[i].ref
    if (r) out[r] = 1
  }
  return out
}

/**
 * 「这一下 keydown 是输入法组字过程中的那一下吗」。
 *
 * 中文/日文输入法在候选框里按 Enter 是「确认选词」，浏览器照样派发 keydown，只是带
 * `isComposing`；Esc 同理（那一下是「取消这次组字」）。不判它的话：组字时按 Enter 会把
 * 半成品直接提交并落盘，组字时按 Esc 会把焦点踢出输入框。
 *
 * **必须读 `e.nativeEvent.isComposing`**：React 的合成事件上根本没有 `isComposing` 这个字段
 * （2026-09 实测：合成事件读到的永远是 undefined），只有原生事件上才有。`keyCode === 229`
 * 是最后一道兜底 —— 少数浏览器/输入法只给这个老字段。
 */
function isComposingEv(e) {
  if (!e) return false
  var ne = e.nativeEvent || e
  if (ne && ne.isComposing) return true
  var kc = typeof e.keyCode === 'number' ? e.keyCode : (ne ? ne.keyCode : 0)
  return kc === 229
}

/**
 * 输入框 keydown 的统一守卫：**Enter 与 Esc 都要过它**，组字中的一律不算。
 *
 * 中文/日文输入法在候选框里按 Enter 是「确认选词」、按 Esc 是「取消这次组字」，浏览器照样派发
 * keydown。不挡的话：在新图名字框里组字按 Enter 会**真的建一个文件**、在改名框里按 Enter 会真的改名、
 * 按 Esc 会把正在打的名字整行收掉。检查器那 6 个框从前各写各的 `!isComposingEv(e)`，图库这三条漏了 ——
 * 以后新增输入框一律走这里，别再各写各的。
 *
 * `Shift+Enter` 一律不算提交（多行框里那是换行）。
 */
function fieldKey(e, onEnter?, onEscape?) {
  if (isComposingEv(e)) return
  if (e.key === 'Enter') {
    if (e.shiftKey) return
    if (typeof onEnter === 'function') { e.preventDefault(); onEnter() }
    return
  }
  if (e.key === 'Escape' && typeof onEscape === 'function') onEscape()
}

/**
 * 下拉框的选项表。客户端的枚举**照抄宿主**（两个分片不能 import，只能各写一份）：
 * `ARROWS`（src/host/mermaid.ts）28 种连接符、`SHAPE_WRAP` 9 种形状。
 *
 * 从前只列了其中一小撮：图里出现别的值时 `<select>` 的 value 不在选项里 → 显示成空，
 * 用户随手选一下就把它**覆盖**了（值本身没被读过，是「打开下拉」这个动作把值弄丢的）。
 * 所以渲染时一律过 `choiceList()`：**当前值一定在选项里**（不在表里就补一条并标「当前」）。
 */
var ARROW_CHOICES = [
  '-->', '---', '-.->', '==>', '~~~', '===',
  '--o', '--x', '==o', '==x',
  'o---', 'x---', 'o-->', 'x-->',
  'o--o', 'x--x', 'o--x', 'x--o',
  'o==o', 'x==x', 'o==>', 'x==>',
  'o---o', 'x---x', 'o---x', 'x---o',
  '<-->', '<==>',
]
var ARROW_TEXT = {
  '-->': '--> 实线箭头', '---': '--- 实线无箭头', '-.->': '-.-> 虚线箭头', '==>': '==> 粗线箭头',
  '~~~': '~~~ 隐线', '===': '=== 粗线',
  '--o': '--o 圆点端', '--x': '--x 叉端', '==o': '==o 粗线圆点端', '==x': '==x 粗线叉端',
}
var SHAPE_CHOICES = ['rect', 'round', 'stadium', 'circle', 'diamond', 'hex', 'cyl', 'sub', 'asym']

/** 选项 = 全表 +（不在表里的）当前值。保证**打开下拉不丢值**。 */
function choiceList(all, cur) {
  var out = all.slice()
  var v = String(cur == null ? '' : cur)
  if (v && out.indexOf(v) < 0) out.push(v)
  return out
}

/** 选项文字：常用值给中文解释，其余用原样符号；表里没有的那个（旧文件/新宿主）标「当前」。 */
function arrowChoiceText(k) {
  if (ARROW_TEXT[k]) return ARROW_TEXT[k]
  return ARROW_CHOICES.indexOf(k) < 0 ? k + '（当前值）' : k
}
function shapeChoiceText(k) {
  return SHAPE_CHOICES.indexOf(k) < 0 ? k + '（当前值）' : k
}

/**
 * 「你摆到哪儿了」的跨页记忆。画布是主窗口的一个子页，而那个槽**一次只渲染一个**：
 * 切到「对话」等于卸载整个 ArchStudio，组件里的一切随之归零 —— 缩放/平移、当前子页、
 * 甚至内存里那 60 步撤销历史。于是「看一眼 AI 说了什么 → 回画布接着摆」这个来回，
 * 每一趟都要重新适应窗口、撤销历史从头开始。
 *
 * 这里只记**视图状态**，不记图内容 —— 内容永远以宿主那份（doc:get）为准，
 * 多存一份内容就又多了一份会各自漂移的真相。只在内存里，按 `<会话>|<图>` 分开。
 */
var studioMemo = {}
var STUDIO_MEMO_MAX = 6

function studioMemoKey(sessionId, diagKey) {
  return String(sessionId == null ? '' : sessionId) + '|' + String(diagKey == null ? '' : diagKey)
}

function studioMemoFor(key, create) {
  var m = studioMemo[key]
  if (!m && create) {
    var keys = Object.keys(studioMemo)
    if (keys.length >= STUDIO_MEMO_MAX) {
      var oldest = keys[0], at = Infinity
      for (var i = 0; i < keys.length; i++) {
        var t = studioMemo[keys[i]].at || 0
        if (t < at) { at = t; oldest = keys[i] }
      }
      delete studioMemo[oldest]
    }
    m = studioMemo[key] = { at: Date.now() }
  }
  if (m) m.at = Date.now()
  return m
}

// 原来声明在组件体里、但被多个分片共用的小常量（提到模块级，保持「一个事实只有一个家」）：
/**
 * 分组下拉框里「新建组」那一项的哨兵值。挑 '#' 是因为 groupKeyOf 会把 '#' 剥掉，
 * 所以**任何真实组 id 都不可能是它** —— 哨兵与真 id 不可能撞。
 */
var GROUP_NEW = '#new'

