// ArchStudio：自绘 SVG 画布 + 源码视图 + 官方渲染预览。
// 编辑历史的关键：committedRef 存「已提交」快照，拖拽期间逐帧的 model 不进去。
// ==================== 主面板 ====================
function ArchStudio(props) {
  var cwd = props && props.cwd
  var cwdRef = React.useRef(cwd)
  cwdRef.current = cwd

  var sessionId = props && props.sessionId
  var sidRef = React.useRef(sessionId)
  sidRef.current = sessionId

  var inputActions = props && props.inputActions
  // 草稿当前内容。写完留言要**自动**把 `@节点id` 追加进去（它会被装饰成上下文块），
  // 而 setDraft 是**整段替换** —— 不先读出来就会把用户正在打的字顶掉。
  // 这里的判断条件（props.useInput 在不在）在会话内是稳定的，不影响 hook 顺序。
  var useInputHook = (props && typeof props.useInput === 'function') ? props.useInput : null
  var liveDraft = ''
  if (useInputHook) {
    var draftSel = useInputHook(function (s) { return (s && typeof s.draft === 'string') ? s.draft : '' })
    if (typeof draftSel === 'string') liveDraft = draftSel
  }

  var modelState = React.useState(null)
  var model = modelState[0]
  var setModel = modelState[1]

  var revState = React.useState(-1)
  var revision = revState[0]
  var setRevision = revState[1]

  var byState = React.useState('')
  var updatedBy = byState[0]
  var setUpdatedBy = byState[1]

  var fileState = React.useState('')
  var filePath = fileState[0]
  var setFilePath = fileState[1]

  // 当前图在本项目图库里的 key 与目录：选择器要显示自己站在哪一层
  var keyState = React.useState('')
  var libKey = keyState[0]
  var setLibKey = keyState[1]
  var dirState = React.useState('')
  var libDir = dirState[0]
  var setLibDir = dirState[1]
  // 打开的是项目里某个文件（按路径打开的）时，这里是它的绝对路径；图库里的图是 null
  var extState = React.useState(null)
  var external = extState[0]
  var setExternal = extState[1]
  // 上次见到的图库清单修订号：主人那边扫描发现变化时，选择器自己刷新
  var libRevRef = React.useRef(-1)

  // 图库选择器（列图 / 切图 / 新建 / 按路径打开）：人这一侧换图的唯一入口
  var pickerState = React.useState({
    open: false, items: [], files: [], busy: false,
    draft: '', pathDraft: '', focusPath: false, renameKey: '', renameDraft: '', confirmKey: '',
  })
  var picker = pickerState[0]
  var setPicker = pickerState[1]
  // 轮询回调只建一次，要读到「选择器是不是开着」就得走 ref
  var pickerRef = React.useRef(picker)
  pickerRef.current = picker
  // 起始页（空画布）直接用最近一次扫描到的清单，它由 mount、轮询与「图库」按钮共同维护。
  // 位置必须在这里：stage 是在 return 之前就构造好的，声明放到文件后半段会被 var 提升成 undefined。
  var libItems = picker.items || []
  var libFiles = picker.files || []

  var textState = React.useState('')
  var mermaidText = textState[0]
  var setMermaidText = textState[1]

  var draftState = React.useState('')
  var draft = draftState[0]
  var setDraft = draftState[1]

  var tabState = React.useState('canvas')
  var tab = tabState[0]
  var setTab = tabState[1]

  var selState = React.useState(null)
  var sel = selState[0]
  var setSel = selState[1]

  // 下挂的检查器（节点/连线的详情）是**点开**的，不是**按下**就开的 —— 见 onPointerUp。
  // 从前面板在 pointerdown 就 setSel，于是「想拖一个节点」的那一下也把详情顶出来：
  // 它最多吃掉画布 46% 的高度，拖动途中画布变矮，节点被挤到看不见的地方，手感就坏了。
  // 选中的高亮仍然在按下时给（描边不改变布局，是拖动时该有的即时反馈），详情等抬手。
  //
  // 三态（2026-09-23）：展开 / 收起成**一条细条**（选中保留）/ 无选中。
  // 「收起」与「关闭」必须分开：收起只把面板收掉、保留选中（还能继续用方向键微调、看高亮），
  // 关闭才取消选中。从前只有布尔开关，收面板的唯一办法是清选中 —— 想「先看看整张图再回来改」
  // 就做不到。VS Code 的 Panel、Blender 的 N 面板都是这个语义。
  var dockState = React.useState(false)
  var dockOpen = dockState[0]
  var setDockOpen = dockState[1]
  var dockHState = React.useState(STUDIO_DOCK_H)
  var dockH = dockHState[0]
  var setDockH = dockHState[1]
  // 面板当前展示的是哪个元素 + 面板是不是开着：这两个都走 ref，因为
  // 「点同一个元素 = 收起」要在**没有重渲染夹在中间**时也成立（测试里 down/up 就是同一个 act）。
  var dockForRef = React.useRef(null)
  var dockOpenRef = React.useRef(false)
  dockOpenRef.current = dockOpen
  var dockRef = React.useRef(null)
  var sashCleanupRef = React.useRef(null)

  var viewState = React.useState({ x: 0, y: 0, k: 1 })
  var view = viewState[0]
  var setView = viewState[1]

  var statusState = React.useState('正在加载…')
  var status = statusState[0]
  var setStatus = statusState[1]

  var svgState = React.useState('')
  var svg = svgState[0]
  var setSvg = svgState[1]

  // 检查点面板（宿主侧的历史在内存里，见 src/host/history.ts）。
  // 这里只放「打开没打开 / 清单 / 正在退回哪一条」——清单每次打开都重新拉，不吃缓存：
  // AI 可能刚好在你打开面板的这一刻改了一次图。
  var histState = React.useState({ open: false, entries: [], busy: false, confirmSeq: 0 })
  var hist = histState[0]
  var setHist = histState[1]
  function patchHist(p) { setHist(function (h) { return Object.assign({}, h, p) }) }
  var historyCountState = React.useState(0)
  var historyCount = historyCountState[0]
  var setHistoryCount = historyCountState[1]

  var errState = React.useState('')
  var renderError = errState[0]
  var setRenderError = errState[1]

  // 解析警告：宿主一直把 warnings 随每个响应带回来，但界面从前一处都没读 ——
  // 「图悄悄少了一块」这件事，人和 AI 都看不见。这里把它接住，源码页渲染成诊断列表。
  var warnState = React.useState([])
  var warnings = warnState[0]
  var setWarnings = warnState[1]

  var labState = React.useState('')
  var labelDraft = labState[0]
  var setLabelDraft = labState[1]

  // 描述单独一个草稿：检查器把「标题 / 描述」拆成两个框，提交时用 composeLabel 合成完整 label。
  // 这两个草稿必须**成对**读写 —— 切节点时只更新其中一个，另一个就会把上个节点的文字串过去。
  var descState = React.useState('')
  var descDraft = descState[0]
  var setDescDraft = descState[1]

  // 组折叠：**视图状态，不落盘**。它只改变「怎么画」，不动模型、不进文件 ——
  // 所以重开面板就复原，也不需要动解析器与 normalizeModel 的白名单。
  // 将来若要落盘，得走 `%% @collapsed` 那条完整的链（解析 / 白名单 / 快照 / 提示词），一处都不能漏。
  var collState = React.useState({})
  var collapsed = collState[0]
  var setCollapsed = collState[1]

  // 拖拽时的吸附参考线：{ gx, gy }，null = 没有吸上任何一条线。
  // 它只是**反馈**，不进模型、不进文件 —— 松手即消失。
  var hintState = React.useState(null)
  var dragHint = hintState[0]
  var setDragHint = hintState[1]

  // 「现在正按着鼠标拖」——只为了让光标说实话：可拖的东西是 `cursor:move`，
  // 按下去之后应该是 `grabbing`，而不是继续骗人说「点一下试试」。纯视图状态，不落盘。
  var dragCursorState = React.useState(false)
  var dragging = dragCursorState[0]
  var setDragging = dragCursorState[1]

  // 写盘被拒（宿主已把内存回滚）时的说明。**只在画布页**挂着 —— 它说的是「你刚才那一笔没存下去」，
  // 和「源码这段解析不了」是两件事，所以是新的一块，不并进解析警告。
  var saveFailState = React.useState(null)
  var saveFail = saveFailState[0]
  var setSaveFail = saveFailState[1]

  // 隐藏手势与快捷键的静态清单（顶栏那个 `?`）。硬编码就够 —— 这不是帮助系统。
  var helpState = React.useState(false)
  var helpOpen = helpState[0]
  var setHelpOpen = helpState[1]

  // 分组：下拉框选「不属于任何组 / 某个已有组 / ＋ 新建组…」，只在选到「新建」时才用得上那个名字框。
  // 用 '#new' 当哨兵：'#' 是 groupKeyOf 唯一会剥掉、而组 id 里**绝不可能出现**的字符，撞不上真 id。
  var grpState = React.useState('')
  var groupPick = grpState[0]
  var setGroupPick = grpState[1]
  var grpNewState = React.useState('')
  var groupNewName = grpNewState[0]
  var setGroupNewName = grpNewState[1]

  var elabState = React.useState('')
  var edgeDraft = elabState[0]
  var setEdgeDraft = elabState[1]

  // 节点留言：草稿与「已投递」标记分开存。留言不走拖拽路径，不需要 committedRef 那一套。
  var noteState = React.useState('')
  var noteDraft = noteState[0]
  var setNoteDraft = noteState[1]
  var noteDoneState = React.useState(false)
  var noteDoneDraft = noteDoneState[0]
  var setNoteDoneDraft = noteDoneState[1]
  var notesOpenState = React.useState(false)
  var notesOpen = notesOpenState[0]
  var setNotesOpen = notesOpenState[1]

  // 代码锚点草稿（textarea 绑定的文本，每行一个文件引用）
  var filesState = React.useState('')
  var filesDraft = filesState[0]
  var setFilesDraft = filesState[1]

  // 概念标签草稿
  var tagsState = React.useState('')
  var tagsDraft = tagsState[0]
  var setTagsDraft = tagsState[1]

  // 服务端返回的代码锚点校验状态映射：{ [nodeId]: { [ref]: 'ok' | 'missing' | 'symbol-missing' | 'unknown' } }
  var fileStatusRef = React.useRef({})
  var fileStatusTickState = React.useState(0)
  var setFileStatusTick = fileStatusTickState[1]
  // 锚点保鲜报告（宿主算，见 drift.ts）：stale = 文件在图之后改过；uncovered = 有源码却没画到的目录。
  // 它和 fileStatus 一样是**派生数据**，随每条响应回来，界面只读。
  var driftRef = React.useRef(null)
  var driftTickState = React.useState(0)
  var setDriftTick = driftTickState[1]
  // 保鲜横幅默认**收起成一行**：常驻的明细会把画布挤掉一大块，而「哪个方块过期了」
  // 画布上已经有琥珀角标指着 —— 明细与建议点开再看。
  var driftOpenState = React.useState(false)
  var driftOpen = driftOpenState[0]
  var setDriftOpen = driftOpenState[1]

  var linkPtState = React.useState(null)
  var linkPt = linkPtState[0]
  var setLinkPt = linkPtState[1]

  // AI 刚改过哪些节点（用于脉动高亮）
  var hlState = React.useState(null)
  var highlight = hlState[0]
  var setHighlight = hlState[1]

  var hostRef = React.useRef(null)
  var svgRef = React.useRef(null)
  var dragRef = React.useRef(null)
  var modelRef = React.useRef(null)
  var viewRef = React.useRef(view)
  var revRef = React.useRef(-1)
  // 方向键微调的手势缓冲（见 nudgeSel / nudgeFlush）：{ id: 正在微调的节点, timer: 静默窗口 }
  var nudgeRef = React.useRef({ id: '', timer: null })
  var currentDiagramRef = React.useRef('')
  var selRef = React.useRef(null)
  var geomRef = React.useRef({})
  var fittedRef = React.useRef(false)
  var rootRef = React.useRef(null)
  var hlTimerRef = React.useRef(null)
  // 编辑历史：past/future 存「已提交」的完整模型快照。
  // 关键：不能用当前 model 当「拖之前的状态」—— 拖拽期间每个 pointermove 都在 setLocal,
  // 所以另存一份 committedRef，只在提交点更新它。
  var histRef = React.useRef({ past: [], future: [] })
  var committedRef = React.useRef(null)
  var hotRef = React.useRef(false)
  var tabRef = React.useRef('canvas')
  // 源码页高亮：底层 <pre> 画彩色 token、顶层 textarea 文字透明（只留光标与选区）。
  // 两层必须字体、行高、padding、border 逐项一致，差一点光标与文字就错位。
  var hlRef = React.useRef(null)
  var taRef = React.useRef(null)
  // 源码页整页只有一个滚动口，就是它（见 runtime.ts 的 .ac-textwrap）。
  var textWrapRef = React.useRef(null)
  var histState = React.useState(0)
  var setHistTick = histState[1]

  // 跨页记忆的两个 Key（见 studioMemo）：当前这一份图的身份、以及它对应的记忆条目。
  // 身份取「图库 key / 图名 / 文件绝对路径」三者之一 —— 外部文件只有 file 这条路认得出来。
  var memoKeyRef = React.useRef('')
  var diagKeyRef = React.useRef('')
  // 用户**自己动过视角**没有（滚轮缩放 / 平移 / 点「适应窗口」/ 从清单定位）。
  // 只有动过才值得记进跨页记忆：自动适应窗口算出来的那个视角，下次挂载一样能算出来。
  var userViewRef = React.useRef(false)
  // 注意：选中与详情面板**不进记忆**。详情里那一堆输入框（标题/描述/留言/锚点草稿）
  // 是「正在改的东西」，只把「面板开着」还回来而草稿是空的，等于把上一次的正文摆在
  // 回车就生效的输入框里 —— 那是数据损坏的路，不是便利。

  viewRef.current = view
  selRef.current = sel
  tabRef.current = tab

  var gstate = React.useMemo(function () {
    var out = {}
    if (model && model.nodes) {
      for (var i = 0; i < model.nodes.length; i++) {
        var n = model.nodes[i]
        // 节点**永远只画标题**，具体信息一律去检查器里看（2026-09 用户要求取消就地展开）。
        // 好处不只是省地方：尺寸不再与选中有关，于是选中一个方块**不会改变它的几何** ——
        // 连在它上面的线就不会因为你点一下而全部重画。
        // `shape` 要跟着几何一起给连线用：锚点得投到这个形状的**可见轮廓**上，
        // 而 edgeGeometry 只拿到几何 —— 少了它，菱形/椭圆上的箭头会悬在包围盒外面。
        var s = nodeSize(splitLabel(n.label).title, 0)
        out[n.id] = { x: n.x == null ? 0 : n.x, y: n.y == null ? 0 : n.y, w: s.w, h: s.h, shape: n.shape || 'rect' }
      }
    }
    geomRef.current = out
    return out
  }, [model, sel])

  // 折叠后每个节点落在哪个「可见单元」上：普通节点是它自己，被收起来的组内节点合到组块上。
  // 边只有经过这张映射，才会从「连到节点」正确改接到「连到折叠块」。
  var foldMap = React.useMemo(function () {
    var m = {}
    if (!model || !model.groups) return m
    for (var i = 0; i < model.groups.length; i++) {
      var g = model.groups[i]
      if (!collapsed[g.id]) continue
      for (var j = 0; j < model.nodes.length; j++) {
        if (model.nodes[j].group === g.id) m[model.nodes[j].id] = g.id
      }
    }
    return m
  }, [model, collapsed])

  // 折叠块自身的几何：位置取该组原本的包围盒中心 —— **成员节点的坐标一个字节都不动**，
  // 展开时原样回来。折叠是渲染视图，不是「删掉再放回」。尺寸与节点共用 nodeSize。
  var foldGeom = React.useMemo(function () {
    var out = {}
    if (!model || !model.groups) return out
    for (var i = 0; i < model.groups.length; i++) {
      var g = model.groups[i]
      if (!collapsed[g.id]) continue
      var members = 0
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (var j = 0; j < model.nodes.length; j++) {
        var n = model.nodes[j]
        if (n.group !== g.id) continue
        var gm = gstate[n.id]
        if (!gm) continue
        members++
        minX = Math.min(minX, gm.x - gm.w / 2); maxX = Math.max(maxX, gm.x + gm.w / 2)
        minY = Math.min(minY, gm.y - gm.h / 2); maxY = Math.max(maxY, gm.y + gm.h / 2)
      }
      if (!members || !isFinite(minX)) continue
      var lbl = String(g.label == null ? g.id : g.label) + '（' + members + '）'
      var s = nodeSize(lbl, 0)
      out[g.id] = {
        x: Math.round((minX + maxX) / 2), y: Math.round((minY + maxY) / 2),
        w: s.w, h: s.h, label: lbl, members: members,
      }
    }
    return out
  }, [model, gstate, collapsed])

  // 给边用的几何：折叠组内的节点，一律换成它所属的那个折叠块。
  var visGeom = function (id) {
    var fid = foldMap[id]
    if (fid && foldGeom[fid]) return foldGeom[fid]
    return gstate[id]
  }

  // 组 → 色相档位。只取决于「有哪些组」，与它们在文件里的顺序无关（见 runtime.ts 的 groupHueIndex）。
  var hueOfGroup = React.useMemo(function () {
    return groupHueIndex(model && model.groups ? model.groups : [])
  }, [model])

  var groups = React.useMemo(function () {
    if (!model || !model.groups) return []
    var res = []
    for (var i = 0; i < model.groups.length; i++) {
      var g = model.groups[i]
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (var j = 0; j < model.nodes.length; j++) {
        var n = model.nodes[j]
        if (n.group !== g.id) continue
        var gm = gstate[n.id]
        if (!gm) continue
        minX = Math.min(minX, gm.x - gm.w / 2); maxX = Math.max(maxX, gm.x + gm.w / 2)
        minY = Math.min(minY, gm.y - gm.h / 2); maxY = Math.max(maxY, gm.y + gm.h / 2)
      }
      if (!isFinite(minX)) continue
      res.push({ id: g.id, label: g.label, x: minX - 20, y: minY - 34, w: maxX - minX + 40, h: maxY - minY + 54 })
    }
    return res
  }, [model, gstate])
  // 本帧的运行时对象：把 state / setter / ref / 跨片函数收在一个可变对象上，交给顶层
  // 工厂函数（分片不能 import，见 AGENTS）。每个渲染重建一次，所以工厂里解构到的
  // state 值永远是这个渲染的那一份；ref 传的是同一个对象，语义与在组件里一样。
  // 类型标成 any：工厂把函数也挂在 S 上，字面量的推断类型里没有它们。
  var S: any = {
    committedRef, currentDiagramRef, cwd, cwdRef, descDraft, diagKeyRef,
    dockForRef, dockH, dockOpen, dockOpenRef, dockRef, draft,
    dragHint, dragRef, dragging, driftOpen, driftRef, edgeDraft,
    external, filePath, fileStatusRef, filesDraft, fittedRef, foldGeom,
    foldMap, geomRef, groupNewName, groupPick, groups, gstate,
    helpOpen, highlight, hist, histRef, historyCount, hlRef,
    hlTimerRef, hostRef, hueOfGroup, inputActions, labelDraft, libDir,
    libFiles, libItems, libKey, libRevRef, linkPt, liveDraft,
    memoKeyRef, mermaidText, model, modelRef, noteDoneDraft, noteDraft,
    notesOpen, nudgeRef, patchHist, picker, renderError, revRef,
    revision, rootRef, sashCleanupRef, saveFail, sel, selRef,
    sessionId, setCollapsed, setDescDraft, setDockH, setDockOpen, setDraft,
    setDragHint, setDragging, setDriftOpen, setDriftTick, setEdgeDraft, setExternal,
    setFilePath, setFileStatusTick, setFilesDraft, setGroupNewName, setGroupPick, setHelpOpen,
    setHighlight, setHistTick, setHistoryCount, setLabelDraft, setLibDir, setLibKey,
    setLinkPt, setMermaidText, setModel, setNoteDoneDraft, setNoteDraft, setNotesOpen,
    setPicker, setRenderError, setRevision, setSaveFail, setSel, setStatus,
    setTab, setTagsDraft, setUpdatedBy, setView, setWarnings, sidRef,
    status, svg, svgRef, taRef, tab, tabRef,
    tagsDraft, textWrapRef, updatedBy, userViewRef, view, viewRef,
    visGeom, warnings,
  }
  makeApplyServer(S)
  studioEditFns(S)
  studioDragFns(S)
  studioCanvasFns(S)
  studioChromeFns(S)
  var applyServer = React.useCallback(S.applyServer, [])
  function abortDrag(...args) { return S.abortDrag.apply(null, args) }
  function fitView(...args) { return S.fitView.apply(null, args) }
  function keepSelInView(...args) { return S.keepSelInView.apply(null, args) }
  function loadLibrary(...args) { return S.loadLibrary.apply(null, args) }
  function nudgeFlush(...args) { return S.nudgeFlush.apply(null, args) }
  function redo(...args) { return S.redo.apply(null, args) }
  function refreshLibraryItems(...args) { return S.refreshLibraryItems.apply(null, args) }
  function undo(...args) { return S.undo.apply(null, args) }

  // ==================== 源码页：滚轮兜底 ====================
  // 真凶已经在上面的滚轮缩放 effect 里修掉了（那条监听器泄漏到这个节点上、无条件
  // preventDefault）。这里再挂一道**原生** wheel 兜底：自己把 deltaY 加到 scrollTop 上，
  // 滚动了就 preventDefault，保证**只滚一次** —— 只要还有第二个想吃掉滚轮的东西，
  // 源码页就还能滑。将来真要删，先确认 [4q] 那两条探针还在守着。
  //
  // 必须用 addEventListener({ passive: false }) —— React 的 onWheel 在根上是 passive 的，
  // 里面调 preventDefault() 无效，会和浏览器自己的滚动叠加成双倍速。
  React.useEffect(function () {
    if (tab !== 'text') return
    var el = textWrapRef.current
    if (!el || typeof el.addEventListener !== 'function') return
    var onWheel = function (ev) {
      var dy = (typeof ev.deltaY === 'number' && isFinite(ev.deltaY)) ? ev.deltaY : 0
      // deltaMode：0=像素，1=行（Firefox），2=页。不换算的话行模式下每格只挪 3px，像没动。
      if (ev.deltaMode === 1) dy *= 16
      else if (ev.deltaMode === 2) dy *= Math.max(1, el.clientHeight)
      var before = el.scrollTop
      el.scrollTop = before + dy
      // 只有真的滚动了才拦：已经到底时再拦会把滚轮整个吞掉，页面看起来是"卡住"
      if (el.scrollTop !== before) {
        if (typeof ev.preventDefault === 'function') ev.preventDefault()
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return function () { el.removeEventListener('wheel', onWheel) }
  }, [tab])

  // ==================== 留言**不**进输入框（2026-09-21 移除） ====================
  // 这里从前有一个 effect：把当前所有未办留言按 `@id` 自动补进聊天草稿，用户按回车就发出去了。
  // 它被移除的原因是**它和提示词注入在送同一件事**：`promptText()` 每一步都把未办留言连正文
  // 一起注入（`src/host/plugin.ts`），所以那串 `@id` 是第二遍搬运。代价却是实的：
  //   ① 你正要打自己的话，框里先多出一串 `@n1 @n2`；
  //   ② 它得靠「签名 + 词边界」两套小机制才不至于重复加、不至于把 `@c11` 认成 `@c1`；
  //   ③ 最要紧的是它让「输入框是空的」这个状态根本不存在 —— 于是「空框也能发」永远测不出来。
  // 现在只有一条路：清单头部那个「交给 AI (N)」按钮，点一下替你把这一批写成一条消息并发出。
  // 手动的 `@` 引用源（register.ts 的 inputTriggers）不动 —— 那是用户主动选的，不是自动塞的。

  // 卸载与清理：组件卸载时取消待执行的高亮定时器
  React.useEffect(function () {
    return function () {
      if (hlTimerRef.current) {
        try { hlTimerRef.current() } catch (e) {}
        hlTimerRef.current = null
      }
    }
  }, [])

  // 离开这一页时把「你摆到哪儿了」记下来（见 studioMemo）。**只记用户自己动过的**：
  // 他缩放过/平移过，才记视角；撤销栈里有东西，才记撤销栈。什么都没动过就不留记忆 ——
  // 这样「第一次打开这张图」与从前一模一样（撤销栈空、视角自动适应窗口）。
  // 图内容一个字都不记 —— 那是宿主的真相。
  //
  // 只在卸载时写：这个 effect 依赖为空，闭包里读到的是 state 的初始值，
  // 所以一律从 ref 里拿（viewRef / histRef 每次渲染都同步，见上面几行）。
  React.useEffect(function () {
    return function () {
      var key = memoKeyRef.current
      if (!key) return
      var view = userViewRef.current ? viewRef.current : null
      var hist = histRef.current.past.length > 0 ? histRef.current : null
      if (!view && !hist) return
      var memo = studioMemoFor(key, true)
      memo.diagKey = diagKeyRef.current
      if (view) memo.view = view
      if (hist) memo.hist = hist
    }
  }, [])


  // 拉取与切换图：cwd 变化（从不就绪变就绪、或切会话）时重新拉取并重置视图
  React.useEffect(function () {
    var alive = true
    setStatus('正在加载…')
    fittedRef.current = false
    rpc('doc:get', { where: cwd, session: sessionId }).then(function (r) {
      if (!alive || !r || !r.ok) { if (alive) setStatus('加载失败'); return }
      if (r.model) syncLiveNodes(r.model, sidRef.current)
      applyServer(r, 'init')
      setStatus(needsLayout(r.model) ? '已按依赖关系自动布局' : '已就绪')
      // 起始页要列出项目里已有的图，所以清单不等用户点「图库」就先读一次
      if (alive) refreshLibraryItems(false, true)
    }).catch(function (e) { if (alive) setStatus('加载失败：' + msgOf(e)) })
    return function () { alive = false }
  }, [cwd, sessionId, applyServer])

  // AI 改了图就拉回来（只在修订号变化时才真正取数据）；
  // 顺带盯图库清单修订号 —— 宿主在自动扫描里发现新图/新文件时，选择器开着就自己刷新。
  React.useEffect(function () {
    var alive = true
    var stopInterval = ctxInterval(function () {
      if (!alive) return
      rpc('doc:rev', { where: cwdRef.current, session: sidRef.current }).then(function (r) {
        if (!alive || !r) return null
        if (typeof r.libraryRev === 'number' && r.libraryRev !== libRevRef.current) {
          libRevRef.current = r.libraryRev
          // 选择器开着就整条刷新；没开也要更新清单 —— 起始页正是靠它列出现有图
          if (pickerRef.current.open) loadLibrary(false)
          else refreshLibraryItems(false, true)
        }
        if (r.revision === revRef.current) return null
        return rpc('doc:get', { where: cwdRef.current, session: sidRef.current }).then(function (full) {
          if (!alive || !full || !full.ok) return
          applyServer(full, full.updatedBy === 'ai' ? 'ai' : 'sync')
          setStatus(full.updatedBy === 'ai' ? 'AI 刚更新了这张图' : '已从画布同步')
        })
      }).catch(function () {})
    }, 2500)
    return function () {
      alive = false
      if (typeof stopInterval === 'function') {
        try { stopInterval() } catch (e) {}
      }
    }
  }, [applyServer])

  // 只有「刚在面板里点过」才接管 Ctrl/Cmd+Z；点回输入框或对话区就交还给浏览器
  React.useEffect(function () {
    function onDown(e) {
      var root = rootRef.current
      hotRef.current = !!(root && e.target && root.contains(e.target))
    }
    window.addEventListener('pointerdown', onDown, true)
    return function () { window.removeEventListener('pointerdown', onDown, true) }
  }, [])

  React.useEffect(function () {
    function onKey(e) {
      var el = document.activeElement
      var tag = el && el.tagName ? String(el.tagName).toLowerCase() : ''
      // 焦点在输入框里时，快捷键一律不管：你打的是字，不是命令。
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || (el && (el as any).isContentEditable)) return
      var k = String(e.key).toLowerCase()
      if (!(e.metaKey || e.ctrlKey)) {
        // `F` = 适应窗口。**必须有「这一下属于这个面板」这道守卫**：监听器挂在 window 上，
        // 而聊天输入框就在同一页 —— 在那边打一个 f 不该把画布重新适应一遍。
        // 两种「属于」都认：焦点/事件目标在面板里，或者最后一次 pointerdown 落在面板里。
        // 后者是必需的 —— 点方块时 onNodeDown 会 stopPropagation，面板根拿不到焦点，
        // 真浏览器里焦点会掉到 body 上（那时候只看 e.target 就永远不成立）。
        if (k !== 'f') return
        var root = rootRef.current
        var inside = !!(root && e.target && root.contains(e.target)) || hotRef.current
        if (!inside) return
        e.preventDefault()
        fitView(true)
        return
      }
      if (k !== 'z' && k !== 'y' && k !== '0') return
      // 只有「刚在面板里点过」才接管 Ctrl/Cmd + 键；点回输入框或对话区就交还给浏览器。
      // 这条对 Ctrl+0（也可能是浏览器的重置缩放）同样成立。
      if (!hotRef.current) return
      e.preventDefault()
      if (k === '0') { fitView(true); return }
      if (k === 'y' || e.shiftKey) redo()
      else undo()
    }
    window.addEventListener('keydown', onKey)
    return function () { window.removeEventListener('keydown', onKey) }
  }, [])


  React.useEffect(function () {
    if (!model || fittedRef.current) return
    if (fitView(false)) fittedRef.current = true
  }, [model])

  // 侧栏从折叠恢复（宽度从 0 变正常）时补一次适应窗口。
  // 依赖 tab：三个 tab 的根元素是同一个 div，React 复用 DOM 节点 —— 挂了 [] 就一辈子
  // 盯着那个节点（切到源码页后它已经是 .ac-textwrap 了），只在画布页才该观测。
  React.useEffect(function () {
    if (tab !== 'canvas') return
    var el = hostRef.current
    if (!el || typeof ResizeObserver !== 'function') return
    var ro = new ResizeObserver(function () {
      // 还没适应过窗口 → 补一次适应；已经摆好了 → 只在选中元素被挤出视野时把它带回来。
      // 从前这里 `if (fittedRef.current) return` 什么都不做，于是「详情面板一展开、
      // 贴着底边的那个节点就被盖住」是一个没人管的洞。
      if (!fittedRef.current && fitView(false)) { fittedRef.current = true; return }
      if (fittedRef.current) keepSelInView()
    })
    ro.observe(el)
    return function () { ro.disconnect() }
  }, [tab])

  // 面板开合 → 画布高度变了 → 把选中的东西带回视野（最小平移，不重新适应窗口）。
  React.useEffect(function () {
    if (!dockOpen) return
    keepSelInView()
  }, [dockOpen])

  // 卸载 / 切页 / 浏览器取消手势 —— 三条路归**同一类收口**（见 abortDrag）。
  // 卸载：画布住在子页里，切到「对话」就是卸载，而 rAF 回调里握着的还是旧组件的作用域 ——
  // 让它跑完只是白算一次，还会往已经没人看的状态里写。
  React.useEffect(function () {
    return function () {
      // 攒着的那一段方向键微调先落定（一条历史 + 一次 doc:set）—— 不能因为组件要没了
      // 就让用户按过的方向键消失。rpc 是模块级的，卸载之后照样发得出去。
      nudgeFlush()
      abortDrag()
      if (typeof sashCleanupRef.current === 'function') sashCleanupRef.current()
    }
  }, [])

  // 切走画布页（源码页 / 卸载前的那一步）：拖动中的手势必须**当场收口**。
  // 从前这里只取消了 rAF —— 本地模型留着拖动中途的浮点坐标、`.dragging` 与 `.ac-snapline`
  // 还挂在 DOM 上；切回来之后一次「面板按下、画布松开」会把这次**没完成的**位移当成正常抬手
  // 提交（状态栏说「已同步给 AI」+ 一条检查点 + 一条撤销记录）。
  React.useEffect(function () {
    if (tab === 'canvas') return
    abortDrag()
    nudgeFlush()
  }, [tab])

  React.useEffect(function () {
    // **只在画布页挂滚轮缩放。** 这条 `if` 修的是一桩真 bug（用户报了两遍）：
    // 三个 tab 的根元素都是同一个 `div`，React 复用 DOM 节点，于是画布页挂上去的监听器
    // 切到源码页之后**还挂在那个节点上**（它现在的类名已经变成 .ac-textwrap 了），
    // 每次滚轮都无条件 preventDefault() —— 源码页的滚动被整条掐掉，
    // 表现就是「进了源码页，滚轮怎么滚都不动」。找了两轮 CSS 都没找到，因为它根本不在 CSS 里。
    if (tab !== 'canvas') return
    var el = hostRef.current
    if (!el) return
    function onWheel(e) {
      e.preventDefault()
      var rect = el.getBoundingClientRect()
      var sx = e.clientX - rect.left
      var sy = e.clientY - rect.top
      var v = viewRef.current
      // **纯增量**：普通滚轮与 Ctrl/Cmd+滚轮都还是缩放，公式与手感逐字不变
      // （改手感不在这一轮的范围内）；只多一条 Shift+滚轮 = 横向平移。
      if (e.shiftKey && !e.ctrlKey && !e.metaKey) {
        // 横向滚轮（触控板/某些鼠标）给的是 deltaX，纵向滚轮给的是 deltaY —— 两个都认。
        var dx = e.deltaY !== 0 ? e.deltaY : e.deltaX
        var pv = { k: v.k, x: v.x - dx, y: v.y }
        viewRef.current = pv
        userViewRef.current = true
        setView(pv)
        return
      }
      var k2 = Math.min(2.6, Math.max(0.1, v.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12)))
      var nv = { k: k2, x: sx - (sx - v.x) * (k2 / v.k), y: sy - (sy - v.y) * (k2 / v.k) }
      viewRef.current = nv
      userViewRef.current = true
      setView(nv)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return function () { el.removeEventListener('wheel', onWheel) }
  }, [tab])


  React.useEffect(function () {
    if (tab !== 'preview') return
    var cancelled = false
    ;(async function () {
      try {
        var api = await ensureMermaid()
        if (cancelled) return
        if (!mermaidInited) {
          api.initialize({ startOnLoad: false, securityLevel: 'loose', theme: 'neutral', suppressErrorRendering: true })
          mermaidInited = true
        }
        var id = 'acmmd' + Math.floor(Math.random() * 1e9).toString(36)
        var src = (mermaidText || '').trim() || 'flowchart TD\n  empty["（画布为空）"]'
        var res = await api.render(id, src)
        if (cancelled) return
        setSvg(res && res.svg ? res.svg : '')
        setRenderError('')
      } catch (e) {
        if (cancelled) return
        setRenderError(msgOf(e))
      }
    })()
    return function () { cancelled = true }
  }, [tab, mermaidText])


  return studioRootFns(S)
}

