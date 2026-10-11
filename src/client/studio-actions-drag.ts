// 手势类动作：视角与命中、拖动合帧、吸附、键盘微调。
// 从 studio.ts 的 ArchStudio 组件体里原样搬出来的顶层函数 —— 行为不变。
// 分片共享同一段作用域、不能 import，所以靠参数 S（本帧的 state / setter / ref 集合）通信。
function studioDragFns(S) {
  var committedRef = S.committedRef, dockForRef = S.dockForRef, dockOpen = S.dockOpen, dockOpenRef = S.dockOpenRef, dockRef = S.dockRef, dragRef = S.dragRef
  var geomRef = S.geomRef, groupPick = S.groupPick, hostRef = S.hostRef, modelRef = S.modelRef, nudgeRef = S.nudgeRef, rootRef = S.rootRef
  var sashCleanupRef = S.sashCleanupRef, selRef = S.selRef, setDescDraft = S.setDescDraft, setDockH = S.setDockH, setDockOpen = S.setDockOpen, setDragHint = S.setDragHint
  var setDragging = S.setDragging, setEdgeDraft = S.setEdgeDraft, setFilesDraft = S.setFilesDraft, setGroupNewName = S.setGroupNewName, setGroupPick = S.setGroupPick, setLabelDraft = S.setLabelDraft
  var setLinkPt = S.setLinkPt, setNoteDoneDraft = S.setNoteDoneDraft, setNoteDraft = S.setNoteDraft, setSel = S.setSel, setStatus = S.setStatus, setTagsDraft = S.setTagsDraft
  var setView = S.setView, svgRef = S.svgRef, userViewRef = S.userViewRef, viewRef = S.viewRef
  function commitEdgeLabel(...args) { return S.commitEdgeLabel.apply(null, args) }
  function commitFiles(...args) { return S.commitFiles.apply(null, args) }
  function commitLabel(...args) { return S.commitLabel.apply(null, args) }
  function commitNewGroup(...args) { return S.commitNewGroup.apply(null, args) }
  function commitNote(...args) { return S.commitNote.apply(null, args) }
  function deleteSel(...args) { return S.deleteSel.apply(null, args) }
  function push(...args) { return S.push.apply(null, args) }
  function setLocal(...args) { return S.setLocal.apply(null, args) }
  function fitView(force) {
    var el = hostRef.current
    var cur = modelRef.current
    if (!el || !cur || cur.nodes.length === 0) return false
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (var i = 0; i < cur.nodes.length; i++) {
      var g = geomRef.current[cur.nodes[i].id]
      if (!g) continue
      minX = Math.min(minX, g.x - g.w / 2); maxX = Math.max(maxX, g.x + g.w / 2)
      minY = Math.min(minY, g.y - g.h / 2); maxY = Math.max(maxY, g.y + g.h / 2)
    }
    var rect = el.getBoundingClientRect()
    if (!isFinite(minX) || rect.width < 60 || rect.height < 60) return false
    var k = Math.min(1.4, Math.max(0.12, Math.min((rect.width - 48) / Math.max(1, maxX - minX), (rect.height - 48) / Math.max(1, maxY - minY))))
    var nv = { k: k, x: rect.width / 2 - ((minX + maxX) / 2) * k, y: rect.height / 2 - ((minY + maxY) / 2) * k }
    viewRef.current = nv
    setView(nv)
    if (force) { userViewRef.current = true; setStatus('已适应窗口') }
    return true
  }

  // 每个 pointermove 都 getBoundingClientRect 会强制一次布局计算（写后读）。
  // 拖动期间画布矩形的尺寸/位置不会变（变的是面板开合，而那发生在抬手），所以按下时量一次、
  // 整段拖动复用；没有缓存时才现量。
  function stageRect() {
    var el = hostRef.current
    return el ? el.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 }
  }
  function toModelPt(e, rect = null) {
    var el = hostRef.current
    if (!el) return { x: 0, y: 0 }
    var r = rect || el.getBoundingClientRect()
    var v = viewRef.current
    return { x: (e.clientX - r.left - v.x) / v.k, y: (e.clientY - r.top - v.y) / v.k }
  }

  function sameSel(x, y) {
    if (!x || !y || x.kind !== y.kind) return false
    if (x.kind === 'node') return x.id === y.id
    return x.from === y.from && x.to === y.to
  }

  /**
   * 点了一个元素之后，详情面板该怎么办：
   *   同一个元素 + 面板开着  → **收起**（选中保留，画布立刻长回来）
   *   别的元素 / 面板收着    → 展开并换成这个元素
   * 于是「点一下 = 打开，再点一下 = 收起」——一个动作一个开关，不需要去找关闭按钮。
   */
  function toggleDockFor(next) {
    if (dockOpenRef.current && sameSel(dockForRef.current, next)) { setDockOpen(false); return }
    dockForRef.current = next
    setDockOpen(true)
  }

  function setDockHeight(h) {
    STUDIO_DOCK_H = h == null ? null : Math.round(h)
    setDockH(STUDIO_DOCK_H)
  }

  /**
   * 拖面板上边缘调整高度（分隔条）。
   * 用 window 上的 pointermove/up 而不是元素自己的：拖动中指针经常跑到分隔条外面，
   * 挂在元素上会中途断掉。双击复位成默认高度。
   */
  function onSashDown(e) {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    if (typeof window === 'undefined') return
    var el = dockRef.current, root = rootRef.current
    if (!el) return
    var h0 = el.getBoundingClientRect().height || 200
    var rootH = root ? (root.getBoundingClientRect().height || 600) : 600
    var y0 = e.clientY
    function onMove(ev) {
      var h = h0 + (y0 - ev.clientY)
      // 上限同时受两件事约束：不超过 60% 的根高，也不把画布压到低于它的最小高度
      // （.ac-stage 有 min-height:140px，加上标题栏/工具条/状态栏，再往上顶就会溢出被裁掉）。
      var cap = Math.max(140, Math.min(rootH * 0.6, rootH - 250))
      h = Math.max(120, Math.min(cap, h))
      setDockHeight(h)
    }
    function onUp() {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      sashCleanupRef.current = null
    }
    // pointercancel 也要摘（触屏上拖分隔条很容易被判成滚动手势）；
    // 另外把清理挂到 ref 上，组件卸载时（切到「对话」子页）也要摘掉 ——
    // 不摘的话监听器会留在 window 上，之后**不按键**移动指针也会改面板高度。
    sashCleanupRef.current = onUp
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  /**
   * 面板开合会改变 .ac-stage 的高度：选中元素如果因此跑出视野（最典型的是贴着底边的节点，
   * 面板一展开就被盖住），就把视角**最小地**平移一下把它带回来。
   * 刻意不重新 fitView：用户自己摆的视角是一次开面板不该冲掉的东西。
   */
  function keepSelInView() {
    var el = hostRef.current
    var s = selRef.current
    if (!el || !s || s.kind !== 'node') return
    var g = geomRef.current[s.id]
    if (!g) return
    var rect = el.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    var v = viewRef.current
    var pad = 26
    var x0 = v.x + g.x * v.k - (g.w * v.k) / 2
    var x1 = v.x + g.x * v.k + (g.w * v.k) / 2
    var y0 = v.y + g.y * v.k - (g.h * v.k) / 2
    var y1 = v.y + g.y * v.k + (g.h * v.k) / 2
    var dx = 0, dy = 0
    if (x0 < pad) dx = pad - x0
    else if (x1 > rect.width - pad) dx = (rect.width - pad) - x1
    if (y0 < pad) dy = pad - y0
    else if (y1 > rect.height - pad) dy = (rect.height - pad) - y1
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return
    var nv = { k: v.k, x: v.x + dx, y: v.y + dy }
    viewRef.current = nv
    setView(nv)
  }

  function nodeAt(pt, pad) {
    var p = typeof pad === 'number' ? pad : 0
    var cur = modelRef.current
    if (!cur) return null
    for (var i = cur.nodes.length - 1; i >= 0; i--) {
      var g = geomRef.current[cur.nodes[i].id]
      if (!g) continue
      if (Math.abs(pt.x - g.x) <= g.w / 2 + p && Math.abs(pt.y - g.y) <= g.h / 2 + p) return cur.nodes[i]
    }
    return null
  }

  function capture(e) {
    try { if (svgRef.current) svgRef.current.setPointerCapture(e.pointerId) } catch (err) {}
  }
  function release(e) {
    try { if (svgRef.current) svgRef.current.releasePointerCapture(e.pointerId) } catch (err) {}
  }

  /**
   * 把当前选中元素**还没提交的草稿**先落下去，然后才允许接下来的动作改选中 / 清选中。
   *
   * 为什么必须有这一条：唯一的自动提交路径是各输入框的 `onBlur`，而换元素时浏览器给的顺序是
   * `pointerdown`（我们的处理器**同步**重渲染，输入框的值此刻已经换成新元素的草稿）
   * → `mousedown` 的默认动作才移走焦点 → 这才触发 `blur`。于是 blur 读到的可能已经是
   * **新元素**的草稿，把 B 的标题写进 A 里去 —— 比「丢掉」更坏。所以提交必须在**改选中之前**做：
   * 此刻 `selRef.current` 还是旧元素，闭包里的草稿也还是旧的，两边对得上。
   *
   * 各 `commitXxx` 自己就是幂等的（值没变就 return），所以「一个字都没改」时它一次 RPC 都不发、
   * 也不进撤销栈。
   */
  function flushDrafts() {
    var s = selRef.current
    if (!s) return
    if (s.kind === 'node') {
      commitLabel()
      // 「＋ 新建组…」那条路的名字框也是草稿；上面那个 select 是选完即时生效的，不用管。
      if (groupPick === GROUP_NEW) commitNewGroup()
      commitNote()
      commitFiles()
    } else if (s.kind === 'edge') {
      commitEdgeLabel()
    }
  }

  /**
   * 一次只允许一个手势。第二个 pointerdown（触屏第二根手指 / 第二个指针设备）落在同一个
   * `dragRef` 上时，**不能再开一次 drag** —— 那会把第一次还挂在 rAF 里的 pending 位移静默
   * 丢掉（新 drag 的 `moved=false`），抬手时于是走 `toggleDockFor` 当成点选：用户拖了一下、
   * 节点没动、详情反而被收起/展开一次。忽略它，第一次的 pending 照旧由它自己的 rAF / 抬手
   * flush 处理（`applyMove` 里那道 `cur !== mine` 的检查也是为此）。
   *
   * 注意顺序：**先把草稿落下去**（flushDrafts）再判这条。按住一个节点、改到一半、又去按
   * 别处 —— 「按下就提交草稿」是用户看得见的契约，它跟这次按下能不能开新拖动是两码事。
   */
  function gestureBusy() {
    return !!dragRef.current
  }

  function onBackgroundDown(e) {
    // 中键也是平移（见下面）：它和左键一样会移走焦点，所以同样先落草稿。
    if (e.button !== 0 && e.button !== 1) return
    flushDrafts()
    if (gestureBusy()) return
    // 中键在部分浏览器上会触发「自动滚动」；我们拿它当平移，就得把默认动作拦掉。
    if (e.button === 1 && typeof e.preventDefault === 'function') e.preventDefault()
    setDragging(true)
    // 清选中 / 收面板**不在这里做**：按下只是「一次可能的平移」的开始。真要清，得等抬手时
    // 仍然没有位移（见 onPointerUp）—— 否则「想把视角挪一下」的那一下一定先把详情面板收掉，
    // 而那正是用户正在看的东西。
    capture(e)
    var v = viewRef.current
    dragRef.current = {
      kind: 'pan', ox: e.clientX - v.x, oy: e.clientY - v.y,
      moved: false, mid: e.button === 1, sx: e.clientX, sy: e.clientY, rect: stageRect(),
    }
  }

  function onNodeDown(e, node) {
    if (e.button !== 0) return
    e.stopPropagation()
    // **先落草稿，再改选中**（见 flushDrafts）：晚一步就会把 A 的草稿写进 B。
    flushDrafts()
    // 选中与草稿面板永远跟着「最后按下的那个元素」走 —— 这是纯 UI 的事，与手势无关。
    setSel({ kind: 'node', id: node.id })
    var sp0 = splitLabel(node.label)
    setLabelDraft(sp0.title)
    setDescDraft(sp0.desc)
    setGroupPick(node.group || '')
    setGroupNewName('')
    setNoteDraft(node.note || '')
    setNoteDoneDraft(node.noteDone === true)
    setFilesDraft((node.files || []).join('\n'))
    setTagsDraft((node.tags || []).join(' '))
    // 但**手势**一次只允许一个（见 gestureBusy）：第二根手指按下时不能重开一次 drag ——
    // 那会把第一次还挂在 rAF 里的 pending 位移静默丢掉（新 drag 的 moved=false），
    // 抬手时于是走 toggleDockFor 当成点选：用户拖了一下、节点没动、详情反而被收起/展开一次。
    if (gestureBusy()) return
    // 光标从这里开始说「抓着」——放在真正开始记录拖动之前，免得早退时把 grabbing 留在屏幕上。
    setDragging(true)
    capture(e)
    var g = geomRef.current[node.id]
    if (!g) return
    var rect0 = stageRect()
    var pt0 = toModelPt(e, rect0)
    dragRef.current = {
      kind: 'node', id: node.id, dx: g.x - pt0.x, dy: g.y - pt0.y,
      moved: false, sx: e.clientX, sy: e.clientY, rect: rect0,
      start: { x: g.x, y: g.y },          // 取消（pointercancel）时回滚到这里
      snap: { gx: null, gy: null },       // 吸附迟滞要记住上一步吸在哪条线上
      pending: null, raf: 0,
    }
  }

  /**
   * 拖折叠起来的组。组**没有自己的坐标** —— 它就是成员节点的包围盒，
   * 所以「把组拖到哪」唯一真实的含义是「把它里面的人一起挪到哪」。
   * 这里只记起点与成员的初始坐标；位移在 move 里用**起点差值**算，避免逐帧累加磨偏坐标。
   */
  function onGroupDown(e, gid) {
    if (e.button !== 0) return
    e.stopPropagation()
    // 拖整组也会移走焦点：先把草稿落下去（见 flushDrafts）。
    flushDrafts()
    if (gestureBusy()) return
    var cur = modelRef.current
    if (!cur) return
    var members = []
    for (var i = 0; i < cur.nodes.length; i++) {
      var n = cur.nodes[i]
      if (n.group !== gid) continue
      members.push({ id: n.id, x: n.x == null ? 0 : n.x, y: n.y == null ? 0 : n.y })
    }
    if (!members.length) return
    setDragging(true)
    capture(e)
    dragRef.current = {
      kind: 'group', gid: gid, start: toModelPt(e), members: members,
      moved: false, sx: e.clientX, sy: e.clientY, rect: stageRect(),
      snap: { gx: null, gy: null }, pending: null, raf: 0,
    }
  }

  function onHandleDown(e, node) {
    if (e.button !== 0) return
    if (gestureBusy()) return
    e.stopPropagation()
    capture(e)
    setLinkPt(toModelPt(e))
    dragRef.current = { kind: 'link', from: node.id, rect: stageRect() }
  }

  function onEdgeDown(e, from, to) {
    if (e.button !== 0) return
    e.stopPropagation()
    // 与点节点同一类问题：这里也要换选中，草稿必须先落（见 flushDrafts）。
    flushDrafts()
    setSel({ kind: 'edge', from: from, to: to })
    // 连线没有拖动语义，按下就是点 —— 与节点同一条开关语义（再点一次收起详情）。
    toggleDockFor({ kind: 'edge', from: from, to: to })
    var cur = modelRef.current
    var ed = null
    if (cur && cur.edges) {
      for (var i = 0; i < cur.edges.length; i++) {
        if (cur.edges[i].from === from && cur.edges[i].to === to) {
          ed = cur.edges[i]
          break
        }
      }
    }
    setEdgeDraft(ed && ed.label ? ed.label : '')
  }

  /**
   * 把一次 pointermove 交给 rAF 合帧：一帧最多一次状态更新。
   * 每次更新都是一次整树重渲染 + 全图重新布线；鼠标 pointermove 在 Chrome 上本来就与帧对齐，
   * 但触屏/高刷设备会给得更密，中间那些点对「跟手」没有任何贡献。
   * **抬手前必须 flush**（见 flushMove / onPointerUp），否则最后一段位移会丢。
   */
  function scheduleMove(e) {
    var d = dragRef.current
    if (!d) return
    d.pending = { x: e.clientX, y: e.clientY, alt: e.altKey === true }
    if (d.raf) return
    var mine = d
    d.raf = rafFrame(function () {
      var cur = dragRef.current
      if (!cur || cur !== mine) return
      mine.raf = 0
      var p = mine.pending
      mine.pending = null
      if (p) applyMove(p)
    })
  }

  function flushMove() {
    var d = dragRef.current
    if (!d) return
    if (d.raf) { rafCancel(d.raf); d.raf = 0 }
    var p = d.pending
    d.pending = null
    if (p) applyMove(p)
  }

  /** 一次拖动的实际计算：入参是光标位置（不是事件对象），因此 rAF 合帧与直接调用走同一条路。 */
  function applyMove(p) {
    var d = dragRef.current
    if (!d) return
    var pt = toModelPt({ clientX: p.x, clientY: p.y }, d.rect)
    if (d.kind === 'node') {
      var cur = modelRef.current
      if (!cur) return
      // 抖动门槛：按下之后的一两像素移动**不算拖动**（触控板点一下很少一动不动）。
      // 过了门槛才认成拖动，也才可能进历史 —— 于是「按下就没动」的那一次干净地留给
      // onPointerUp 去开详情，而不是既开详情又记一条「用户移动了节点」的假历史。
      if (!d.moved && Math.abs(p.x - d.sx) + Math.abs(p.y - d.sy) < DRAG_SLOP) return
      d.moved = true
      // 拖动期保持**浮点**坐标：每帧 Math.round 会把它变成 k 像素的台阶（放大时肉眼可见）。
      // 落盘的坐标由宿主自己取整（`mermaid.ts` 与 normalizeModel），提交时这里也再取整一次，
      // 所以「跟手」不会换来「文件里出现小数」。
      var tx = pt.x + d.dx
      var ty = pt.y + d.dy
      // 吸附：阈值按屏幕像素折算（与缩放无关），带迟滞；按住 Alt 临时关掉。
      var sn = p.alt
        ? { x: tx, y: ty, gx: null, gy: null }
        : snapToPeers(cur.nodes, [d.id], tx, ty, viewRef.current.k, d.snap)
      d.snap = { gx: sn.gx, gy: sn.gy }
      setDragHint(sn.gx == null && sn.gy == null ? null : sn)
      var nodes = []
      for (var i = 0; i < cur.nodes.length; i++) {
        var n = cur.nodes[i]
        // 用 Object.assign 保留**所有**字段：原先显式列 {id,label,shape,group,x,y} 会把
        // note / noteDone / files / link 悄悄丢掉 —— 拖一下，留言和锚点就没了（而且不报错）。
        nodes.push(n.id === d.id ? Object.assign({}, n, { x: sn.x, y: sn.y }) : n)
      }
      setLocal({ nodes: nodes, edges: cur.edges, groups: cur.groups, direction: cur.direction, extras: cur.extras })
      return
    }
    if (d.kind === 'group') {
      var curG = modelRef.current
      if (!curG) return
      // 与节点拖动同一条门槛：折叠块「点一下」不该把整组挪走，也不该记一条历史。
      if (!d.moved && Math.abs(p.x - d.sx) + Math.abs(p.y - d.sy) < DRAG_SLOP) return
      d.moved = true
      // 组**没有自己的坐标** —— 它就是成员节点的包围盒。所以「拖动组」唯一真实的含义
      // 是把成员一起挪。位移用**起点差值**而不是逐帧累加，免得浮点误差把坐标磨偏。
      var gdx = pt.x - d.start.x
      var gdy = pt.y - d.start.y
      // 分组拖动也要吸附（从前只有节点吸）—— 同一个动作两种手感，本身就是「不自然」的来源。
      // 吸附参考取整组的圈心，于是整组一起贴到别的节点/组的中心线上。
      var startPos = {}
      for (var mk = 0; mk < d.members.length; mk++) startPos[d.members[mk].id] = d.members[mk]
      var ids = []
      var cxs = 0, cys = 0
      for (var mj = 0; mj < d.members.length; mj++) {
        ids.push(d.members[mj].id)
        cxs += d.members[mj].x
        cys += d.members[mj].y
      }
      var n0 = Math.max(1, d.members.length)
      var gsn = p.alt
        ? { x: 0, y: 0, gx: null, gy: null }
        : snapToPeers(curG.nodes, ids, cxs / n0 + gdx, cys / n0 + gdy, viewRef.current.k, d.snap)
      if (gsn.gx != null) gdx += gsn.gx - (cxs / n0 + gdx)
      if (gsn.gy != null) gdy += gsn.gy - (cys / n0 + gdy)
      d.snap = { gx: gsn.gx, gy: gsn.gy }
      setDragHint(gsn.gx == null && gsn.gy == null ? null : gsn)
      var gNodes = []
      for (var gk = 0; gk < curG.nodes.length; gk++) {
        var gn = curG.nodes[gk]
        var base = startPos[gn.id]
        gNodes.push(base ? Object.assign({}, gn, { x: base.x + gdx, y: base.y + gdy }) : gn)
      }
      setLocal({ nodes: gNodes, edges: curG.edges, groups: curG.groups, direction: curG.direction, extras: curG.extras })
      return
    }
    if (d.kind === 'pan') {
      if (!d.moved && Math.abs(p.x - d.sx) + Math.abs(p.y - d.sy) < DRAG_SLOP) return
      d.moved = true
      var nv = { k: viewRef.current.k, x: p.x - d.ox, y: p.y - d.oy }
      viewRef.current = nv
      userViewRef.current = true
      setView(nv)
      return
    }
    if (d.kind === 'link') setLinkPt(pt)
  }

  function onPointerMove(e) {
    var d = dragRef.current
    if (!d) return
    scheduleMove(e)
  }

  /**
   * 提交一次拖动：**取整只在这里做一次**，然后落历史、发盘。
   * 拖动期间模型里是浮点，所以这里必须重建一份。
   */
  function commitDrag(d, note) {
    var cur = modelRef.current
    if (!cur) return
    var move = {}
    if (d.kind === 'node') move[d.id] = true
    else for (var mi = 0; mi < d.members.length; mi++) move[d.members[mi].id] = true
    var nodes = []
    for (var i = 0; i < cur.nodes.length; i++) {
      var n = cur.nodes[i]
      nodes.push(move[n.id]
        ? Object.assign({}, n, { x: Math.round(n.x == null ? 0 : n.x), y: Math.round(n.y == null ? 0 : n.y) })
        : n)
    }
    push({ nodes: nodes, edges: cur.edges, groups: cur.groups, direction: cur.direction, extras: cur.extras }, note)
  }

  /** 把被拖的东西放回按下时的位置（浏览器把这次手势取消时用，不进历史、不写盘）。 */
  function restoreDrag(d) {
    var cur = modelRef.current
    if (!cur) return
    var back = {}
    if (d.kind === 'node') back[d.id] = d.start
    else for (var mi = 0; mi < d.members.length; mi++) back[d.members[mi].id] = d.members[mi]
    var nodes = []
    for (var i = 0; i < cur.nodes.length; i++) {
      var n = cur.nodes[i]
      var b = back[n.id]
      nodes.push(b ? Object.assign({}, n, { x: b.x, y: b.y }) : n)
    }
    setLocal({ nodes: nodes, edges: cur.edges, groups: cur.groups, direction: cur.direction, extras: cur.extras })
  }

  /**
   * 「这次手势不算数」的统一收口 —— 切页 / 卸载 / 浏览器取消手势三条路都走它。
   *
   * 为什么必须是一条路：切页与卸载从前只取消 rAF，本地模型留着拖动中途的浮点坐标、
   * 屏幕上还挂着 `.dragging` / `.ac-snapline`；之后一次「面板按下、画布松开」会把这次
   * **没完成的**位移当成正常抬手提交（状态栏说「已同步给 AI」+ 一条检查点 + 一条撤销记录）。
   * 只回滚不清理、或只清理不回滚，都会各留一半。
   *
   * 没位移过就不碰模型（restoreDrag 对「没动过」来说是空转，白白多一次整树重渲染）。
   */
  function abortDrag() {
    var d = dragRef.current
    dragRef.current = null
    if (d && d.raf) rafCancel(d.raf)
    if (d && d.moved && (d.kind === 'node' || d.kind === 'group')) restoreDrag(d)
    setDragging(false)
    setDragHint(null)
    setLinkPt(null)
  }

  function onPointerUp(e) {
    var d = dragRef.current
    // **平移也要 flush**：它同样走 rAF 合帧，而「这次到底是点空白还是平移」正是由
    // 最终位移决定的 —— 不 flush 就会把一次平移误判成点空白，把选中和面板一起清掉。
    if (d) flushMove()
    dragRef.current = null
    setDragging(false)
    release(e)
    setDragHint(null)
    if (!d) return
    if (d.kind === 'pan') {
      // 背景上「按下 → 抬手、中间没有真实位移」= 一次点空白：清选中、收面板。
      // 平移过就不算 —— 挪视角不该把正在编辑的节点丢掉。
      // **中键不算**：中键从来就是「我要挪视角」，不该顺手把你正在看的东西清掉。
      if (!d.moved && !d.mid) { setSel(null); setDockOpen(false) }
      return
    }
    if (d.kind === 'node' && d.moved) {
      commitDrag(d, '用户移动了节点')
      setStatus('已移动节点并同步')
      return
    }
    if (d.kind === 'node' && !d.moved) {
      // 按下与抬手之间没有真实位移 = 一次「点选」。
      // 详情下挂着一块能吃掉半个画布高度的面板，所以拖动途中不展开（见下面的 toggleDockFor）。
      toggleDockFor({ kind: 'node', id: d.id })
      return
    }
    if (d.kind === 'group' && d.moved) {
      commitDrag(d, '用户移动了分组')
      setStatus('已移动分组里的 ' + d.members.length + ' 个节点')
      return
    }
    if (d.kind === 'link') {
      var pt = toModelPt(e, d.rect)
      // 磁吸判定：借鉴主流图编辑器实践，提供 14px 判定容差，避免鼠标在边缘微偏导致连线丢失
      var target = nodeAt(pt, 14)
      setLinkPt(null)
      if (!target || target.id === d.from) return
      var cur = modelRef.current
      for (var i = 0; i < cur.edges.length; i++) {
        if (cur.edges[i].from === d.from && cur.edges[i].to === target.id) { setStatus('这条连线已经存在（可在连线上修改标签）'); return }
      }
      var next = cloneModel(cur)
      next.edges.push({ id: 'e' + (next.edges.length + 1), from: d.from, to: target.id, label: '', arrow: '-->' })
      push(next, '用户新增了一条连线')
      setStatus('已连线 ' + d.from + ' → ' + target.id)
    }
  }

  /**
   * 浏览器把这次手势取消掉了（判成滚动/缩放/系统手势，或指针被抢走）。
   * **不能当成一次正常抬手**：那会把一次用户根本没完成的拖动写进历史、还发盘。
   * 把被拖的东西放回原位、并把 `.dragging` / `.ac-snapline` 一起清掉 —— 与切页 / 卸载同一条
   * 收口（abortDrag），一个字节都不写。
   */
  function onPointerCancel(e) {
    abortDrag()
    try { release(e) } catch (err) {}
  }

  /**
   * 指针捕获在拖动**中途**丢了（窗口失焦、设备被拔掉、浏览器收回捕获）。
   * 这时静默丢掉已经发生的位移是最坏的选择 —— 用户看到方块在屏幕上动过，
   * 松手后却回到原位，而且没有任何提示。当作一次正常抬手提交（能退回，见检查点）。
   */
  function onLostPointerCapture(e) {
    var d = dragRef.current
    if (!d) { setLinkPt(null); return }
    onPointerUp(e)
  }

  function onKeyDown(e) {
    var tag = e.target && e.target.tagName ? String(e.target.tagName).toLowerCase() : ''
    var inField = tag === 'input' || tag === 'textarea' || tag === 'select'
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (inField) return
      e.preventDefault()
      deleteSel()
      return
    }
    if (e.key === 'Escape') {
      // 两段式：焦点在输入框里时，第一下只把焦点**拿出来**（不关编辑页、也不动你写的内容），
      // 再按一下（此时焦点已不在输入框）才关。
      // 为什么不直接关：中文输入法组字过程中按 Esc 是"取消这次组字"，
      // 顺手把编辑页关掉会连带丢掉刚写的东西；所以组字进行中连焦点都不动。
      if (inField) {
        if (isComposingEv(e)) return
        // 注意：这里**不能**用 blur()。Esc 的处理器挂在面板容器（.ac-root）上，
        // 一旦焦点 blur 到 body，第二下 Esc 就再也到不了这个函数 —— 实测过：
        // 那样只会"丢焦点"，编辑页永远关不掉。面板根本来就 tabIndex=0，
        // 把焦点移进去既是"离开了输入框"，又让第二下仍然落在面板里。
        if (rootRef.current && typeof rootRef.current.focus === 'function') rootRef.current.focus()
        else if (e.target && typeof e.target.blur === 'function') e.target.blur()
        return
      }
      // 分层（2026-09-23 改成三段）：先收面板（**保留选中**）→ 再取消选中 → 再退焦点。
      // 与 VS Code / DevTools 的 drawer 一致：Esc 先收抽屉，选中留到下一下。
      // 于是「收起来接着摆布局」不需要先丢掉正在改的那个节点。
      if (dockOpen) { setDockOpen(false); return }
      // 取消选中，连带收掉还没落下的连线预览
      setSel(null)
      setLinkPt(null)
      setDragHint(null)
      return
    }
    // 方向键微调选中节点：1px；按住 Shift 是 10px。
    // 「改优先」里这是最省力的一条 —— 手摆的坐标是用户的劳动成果，
    // 用键盘能一次对准到像素，不必靠鼠标抖。
    var step = e.key === 'ArrowLeft' ? [-1, 0] : e.key === 'ArrowRight' ? [1, 0]
      : e.key === 'ArrowUp' ? [0, -1] : e.key === 'ArrowDown' ? [0, 1] : null
    if (!step || inField) return
    var s = selRef.current
    if (!s || s.kind !== 'node') return
    e.preventDefault()
    var k = e.shiftKey ? 10 : 1
    nudgeSel(step[0] * k, step[1] * k)
  }

  /**
   * 把选中节点平移 (dx, dy)：方向键走这里，拖拽吸附落定后也走这里。
   *
   * **一次手势一条历史**：按住方向键 ≈2 秒会来 60 次自动重复，每一跳都 `push` 的话，
   * 60 步撤销栈被整条 shift 掉、宿主 50 份检查点缓冲也被冲掉 —— 用户再也退不回自己真正的
   * 编辑（改名 / 拖拽），而且界面上没有任何提示。所以这里只动**本地**模型（跟手、不写盘、
   * 不进历史），把落盘攒到 `nudgeFlush`：keyup 那一刻、静默窗口到了、或别的动作要先落盘时。
   */
  function nudgeSel(dx, dy) {
    var s = selRef.current
    var cur = modelRef.current
    if (!s || s.kind !== 'node' || !cur) return
    var n = nudgeRef.current
    if (n.id && n.id !== s.id) nudgeFlush()   // 换了节点：上一段手势先收掉，别并成一条
    if (n.timer) { try { n.timer() } catch (e) {} n.timer = null }
    n.id = s.id
    var next = cloneModel(cur)
    for (var i = 0; i < next.nodes.length; i++) {
      if (next.nodes[i].id !== s.id) continue
      next.nodes[i].x = (next.nodes[i].x == null ? 0 : next.nodes[i].x) + dx
      next.nodes[i].y = (next.nodes[i].y == null ? 0 : next.nodes[i].y) + dy
      break
    }
    setLocal(next)
    n.timer = ctxTimeout(nudgeFlush, NUDGE_IDLE_MS)
  }

  /**
   * 把攒着的那一段方向键微调落成**一笔**：一条历史 + 一次 doc:set。
   * 先清 `n.id` 再 `push` —— push 里也会调 nudgeFlush，不清就是死循环。
   */
  function nudgeFlush() {
    var n = nudgeRef.current
    if (n.timer) { try { n.timer() } catch (e) {} n.timer = null }
    var id = n.id
    n.id = ''
    if (!id) return
    var cur = modelRef.current
    var base = committedRef.current
    if (!cur || !base) return
    var a = null
    var b = null
    for (var i = 0; i < cur.nodes.length; i++) { if (cur.nodes[i].id === id) { a = cur.nodes[i]; break } }
    for (var j = 0; j < base.nodes.length; j++) { if (base.nodes[j].id === id) { b = base.nodes[j]; break } }
    if (!a || !b) return
    // 没真的动过就不写盘（按了方向键但节点已被别处挪回去的边角情况）
    if (a.x === b.x && a.y === b.y) return
    push(cloneModel(cur), '用户微调了节点位置')
  }

  /** 松手（keyup）就把这一段微调落定 —— 不必等静默窗口，测试与真机都更可预期。 */
  function onKeyUp(e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    if (nudgeRef.current.id) nudgeFlush()
  }

  S.abortDrag = abortDrag
  S.applyMove = applyMove
  S.capture = capture
  S.commitDrag = commitDrag
  S.fitView = fitView
  S.flushDrafts = flushDrafts
  S.flushMove = flushMove
  S.gestureBusy = gestureBusy
  S.keepSelInView = keepSelInView
  S.nodeAt = nodeAt
  S.nudgeFlush = nudgeFlush
  S.nudgeSel = nudgeSel
  S.onBackgroundDown = onBackgroundDown
  S.onEdgeDown = onEdgeDown
  S.onGroupDown = onGroupDown
  S.onHandleDown = onHandleDown
  S.onKeyDown = onKeyDown
  S.onKeyUp = onKeyUp
  S.onLostPointerCapture = onLostPointerCapture
  S.onNodeDown = onNodeDown
  S.onPointerCancel = onPointerCancel
  S.onPointerMove = onPointerMove
  S.onPointerUp = onPointerUp
  S.onSashDown = onSashDown
  S.release = release
  S.restoreDrag = restoreDrag
  S.sameSel = sameSel
  S.scheduleMove = scheduleMove
  S.setDockHeight = setDockHeight
  S.stageRect = stageRect
  S.toModelPt = toModelPt
  S.toggleDockFor = toggleDockFor
}
