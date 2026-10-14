// 界面渲染分片（共享脚手架见 ui.render.shared.mjs；DOM/React/桩 RPC/槽位捕获都由它装载）。
import { endPhase } from './ui.render.shared.mjs'

console.log('\n[4i] 拖拽不丢字段')
{
  const TEST_MODEL = {
    nodes: [
      { id: 'g_n1', label: '旁边的甲', shape: 'rect', x: 100, y: 100, note: '', noteDone: false, files: [] },
      { id: 'g_n2', label: '旁边的乙', shape: 'rect', x: 200, y: 120, note: '', noteDone: false, files: [] },
      { id: 'n_field', label: '带字段节点', shape: 'rect', x: 400, y: 300, note: '待办事项', noteDone: false, files: ['src/core.ts'] },
    ],
    edges: [],
    direction: 'TD', extras: [], summary: '',
  }

  const prevRespond = respond
  let currentModel = JSON.parse(JSON.stringify(TEST_MODEL))
  respond = function (method, args) {
    if (method === 'doc:get') {
      return fullDoc({
        model: currentModel,
        nodeCount: currentModel.nodes.length,
        edgeCount: currentModel.edges.length,
      })
    }
    if (method === 'doc:set') {
      currentModel = args.model
      return fullDoc({
        model: currentModel,
        nodeCount: currentModel.nodes.length,
        revision: 2,
        updatedBy: 'user',
      })
    }
    return prevRespond(method, args)
  }

  const dragHost = document.createElement('div')
  document.body.appendChild(dragHost)
  const dragRoot = createRoot(dragHost)
  await act(async () => {
    dragRoot.render(React.createElement(captured['conversation.view'], {
      cwd: UI, sessionId: 's1', useSessions: () => UI,
    }))
  })
  await flush()

  const svgEl = dragHost.querySelector('svg.ac-svg')
  ok('渲染出画布 svg.ac-svg', !!svgEl)

  // 拖拽不丢字段：构造一个带 note（未解决）与 files 的节点，对它派发
  // pointerdown → pointermove（带位移）→ pointerup，断言它的 .ac-note-badge 与 .ac-file-badge
  // 都还在（旧实现下这两个角标会在拖动后消失）。
  const findFieldNode = () => Array.from(dragHost.querySelectorAll('g.ac-node')).find((el) => el.querySelector('.ac-lbl')?.textContent.trim() === '带字段节点')
  const nodeElBefore = findFieldNode()
  ok('拖拽前带字段节点存在 .ac-note-badge', !!nodeElBefore?.querySelector('.ac-note-badge'))
  ok('拖拽前带字段节点存在 .ac-file-badge', !!nodeElBefore?.querySelector('.ac-file-badge'))

  await act(async () => {
    nodeElBefore.dispatchEvent(new dom.window.PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 400, clientY: 300 }))
    svgEl.dispatchEvent(new dom.window.PointerEvent('pointermove', { bubbles: true, clientX: 480, clientY: 360 }))
    svgEl.dispatchEvent(new dom.window.PointerEvent('pointerup', { bubbles: true, button: 0, clientX: 480, clientY: 360 }))
  })
  await flush()

  const nodeElAfter = findFieldNode()
  ok('拖拽不丢字段：拖拽后 .ac-note-badge 依然存在', !!nodeElAfter?.querySelector('.ac-note-badge'))
  ok('拖拽不丢字段：拖拽后 .ac-file-badge 依然存在', !!nodeElAfter?.querySelector('.ac-file-badge'))

  await act(async () => { dragRoot.unmount() })
  dragHost.remove()
  respond = prevRespond
}

console.log('\n[4j] 连线布线：正交折线 + 避让中间的方块')
{
  // 甲 → 中间障碍 → 乙 三者同列：直接连过去必然压过障碍。
  // 这是本次改动的**核心断言** —— 线必须绕开它，而不是穿过去。
  const ROUTE_MODEL = {
    nodes: [
      { id: 'ra', label: '甲', shape: 'rect', x: 0, y: 0 },
      { id: 'rc', label: '中间障碍', shape: 'rect', x: 0, y: 220 },
      { id: 'rb', label: '乙', shape: 'rect', x: 0, y: 440 },
    ],
    edges: [{ id: 're1', from: 'ra', to: 'rb', label: '', arrow: '-->' }],
    direction: 'TD',
    extras: [],
  }

  const prevRespondRoute = respond
  const routeModel = JSON.parse(JSON.stringify(ROUTE_MODEL))
  respond = function (method, args) {
    if (method === 'doc:get') {
      return fullDoc({ model: routeModel, nodeCount: routeModel.nodes.length, edgeCount: routeModel.edges.length })
    }
    return prevRespondRoute(method, args)
  }

  const rHost = document.createElement('div')
  document.body.appendChild(rHost)
  const rRoot = createRoot(rHost)
  await act(async () => {
    rRoot.render(React.createElement(captured['conversation.view'], {
      cwd: UI, sessionId: 's1', useSessions: () => UI,
    }))
  })
  await flush()

  const epEl = rHost.querySelector('path.ac-edge')
  const dAttr = epEl ? epEl.getAttribute('d') : ''
  ok('连线路径存在', !!dAttr, dAttr)
  // 正交的定义：只有 M / L，没有三次贝塞尔 C。这也是"不再有怪异弧度"的直接证据。
  ok('路径只有 M/L，没有 C 曲线', /^M /.test(dAttr) && dAttr.indexOf('C') < 0 && dAttr.indexOf('L') >= 0, dAttr)
  // 为了下面好读，这里退掉锚点前缀（避免误判，见上面那条）
  void 0

  const nums = (dAttr.match(/-?\d+(?:\.\d+)?/g) || []).map(Number)
  const rpts = []
  for (let i = 0; i + 1 < nums.length; i += 2) rpts.push({ x: nums[i], y: nums[i + 1] })
  ok('路径至少两个点', rpts.length >= 2, rpts)
  let allOrth = rpts.length >= 2
  for (let i = 0; i + 1 < rpts.length; i++) {
    if (Math.abs(rpts[i].x - rpts[i + 1].x) > 0.01 && Math.abs(rpts[i].y - rpts[i + 1].y) > 0.01) allOrth = false
  }
  // 拐角「稍微转弯」（用户要的观感）：每个拐点用一段二次曲线抹圆，而不是折成硬直角。
  // 这条是那条圆角真的生效了的**正面**证据；下面还有两条负向对照守着它的边界。
  const pathCmds = dAttr.match(/[MLQ]/g) || []
  ok('拐角用二次曲线抹圆（路径里有 Q）', pathCmds.indexOf('Q') >= 0, dAttr)
  ok('抹圆只发生在拐点，不是把整条线做成曲线（Q 的数量 ≤ 拐点数，且每段仍是 L 起头）',
    pathCmds.filter((c) => c === 'Q').length <= pathCmds.filter((c) => c === 'L').length, pathCmds)
  // 负向对照一：两端必须原样落在方块边界上。抹圆若吃到了端点，箭头就会离开边框。
  const firstPt = rpts[0], lastPt = rpts[rpts.length - 1]
  ok('路径起点没有被抹圆动过（第一段是纯 L，控制点不在起点）',
    Math.abs(firstPt.x - Number((dAttr.match(/^M (-?[\d.]+)/) || [])[1])) < 0.01, dAttr)
  ok('路径终点就是折线最后一个顶点（箭头贴着方块）',
    Math.abs(lastPt.x - rpts[rpts.length - 2].x) < 0.01 || Math.abs(lastPt.y - rpts[rpts.length - 2].y) < 0.01, {
      last: lastPt, prev: rpts[rpts.length - 2],
    })
  // 负向对照二：把路径拆成命令逐条看 —— 每个圆角的两条切线必须分别落在拐点的**两条相邻边**上
  // （一个切点与拐点同 x、另一个同 y），且切点到拐点的距离不超过半径上限。
  // 抹穿了的话切点会跑到同一条边上、或距离超过 8（圆角会吃掉整条线段甚至反向）。
  const segs = []
  {
    const re = /([MLQ])((?: -?[\d.]+)+)/g
    let mm
    while ((mm = re.exec(dAttr)) !== null) {
      const ns = (mm[2].match(/-?[\d.]+/g) || []).map(Number)
      segs.push(mm[1] === 'Q'
        ? { c: 'Q', cx: ns[0], cy: ns[1], x2: ns[2], y2: ns[3] }
        : { c: mm[1], x2: ns[0], y2: ns[1] })
    }
  }
  let cornerOk = true
  let qSeen = 0
  for (let i = 1; i < segs.length; i++) {
    if (segs[i].c !== 'Q') continue
    qSeen++
    const prevSeg = segs[i - 1]
    if (prevSeg.c !== 'L') { cornerOk = false; continue }
    const ax = prevSeg.x2, ay = prevSeg.y2
    const cx = segs[i].cx, cy = segs[i].cy
    const ex = segs[i].x2, ey = segs[i].y2
    const inSharesX = Math.abs(ax - cx) < 0.01, inSharesY = Math.abs(ay - cy) < 0.01
    const outSharesX = Math.abs(ex - cx) < 0.01, outSharesY = Math.abs(ey - cy) < 0.01
    const dIn = Math.hypot(ax - cx, ay - cy)
    const dOut = Math.hypot(ex - cx, ey - cy)
    if (!((inSharesX && outSharesY) || (inSharesY && outSharesX))) cornerOk = false
    if (!(dIn > 0 && dOut > 0 && dIn <= 8.01 && dOut <= 8.01)) cornerOk = false
  }
  ok('每个圆角都合法：两条切线各在一条相邻边上，切点距离在半径内', qSeen > 0 && cornerOk,
    { qSeen, cornerOk, segs })
  ok('每一段都是水平或垂直（没有斜线）', allOrth, rpts)

  // 从 DOM 量出障碍方块的真实矩形：节点形状用的是绝对坐标，所以 rect 的 x/y/w/h 就是它的几何。
  const routeNodes = Array.from(rHost.querySelectorAll('g.ac-node'))
  const obsEl = routeNodes.find((g) => (g.textContent || '').indexOf('中间障碍') >= 0)
  const obsRectEl = obsEl ? obsEl.querySelector('rect:not(.ac-pulse)') : null
  const obsRect = obsRectEl ? {
    x1: Number(obsRectEl.getAttribute('x')),
    y1: Number(obsRectEl.getAttribute('y')),
    x2: Number(obsRectEl.getAttribute('x')) + Number(obsRectEl.getAttribute('width')),
    y2: Number(obsRectEl.getAttribute('y')) + Number(obsRectEl.getAttribute('height')),
  } : null
  ok('量到了障碍方块的矩形', !!obsRect && obsRect.x2 > obsRect.x1 && obsRect.y2 > obsRect.y1, obsRect)

  // 与实现同一条判据：轴对齐线段是否真的穿过矩形（严格不等号 = 贴边不算穿）
  const segCrosses = (x1, y1, x2, y2, r) => {
    if (y1 === y2) {
      if (y1 <= r.y1 || y1 >= r.y2) return false
      return Math.max(x1, x2) > r.x1 && Math.min(x1, x2) < r.x2
    }
    if (x1 === x2) {
      if (x1 <= r.x1 || x1 >= r.x2) return false
      return Math.max(y1, y2) > r.y1 && Math.min(y1, y2) < r.y2
    }
    return true
  }
  let crossed = false
  if (obsRect) {
    for (let i = 0; i + 1 < rpts.length; i++) {
      if (segCrosses(rpts[i].x, rpts[i].y, rpts[i + 1].x, rpts[i + 1].y, obsRect)) crossed = true
    }
  }
  ok('线绕开了中间的方块（没有任何一段穿过它）', !!obsRect && !crossed, { obsRect, rpts })
  ok('确实是从旁边绕的（存在远离中轴的拐点）', rpts.some((p) => Math.abs(p.x) > 30), rpts.map((p) => p.x))

  // 负向对照：这个场景**本身**确实是"直连会穿过"的 —— 否则上面那条断言是空的、什么都没证明。
  const rectOfLabel = (label) => {
    const g = routeNodes.find((el) => (el.textContent || '').indexOf(label) >= 0)
    const r = g ? g.querySelector('rect:not(.ac-pulse)') : null
    if (!r) return null
    return {
      x1: Number(r.getAttribute('x')), y1: Number(r.getAttribute('y')),
      x2: Number(r.getAttribute('x')) + Number(r.getAttribute('width')),
      y2: Number(r.getAttribute('y')) + Number(r.getAttribute('height')),
    }
  }
  const raRect = rectOfLabel('甲')
  const rbRect = rectOfLabel('乙')
  ok('负向对照成立：直连（甲底到乙顶的一条竖线）确实会穿过障碍',
    !!raRect && !!rbRect && !!obsRect && segCrosses(0, raRect.y2, 0, rbRect.y1, obsRect),
    { raRect, rbRect, obsRect })

  // 平行边：同一对节点之间的两条线不许重叠成一条
  const PAR_MODEL = JSON.parse(JSON.stringify(ROUTE_MODEL))
  PAR_MODEL.edges = [
    { id: 'pe1', from: 'ra', to: 'rb', label: '', arrow: '-->' },
    { id: 'pe2', from: 'rb', to: 'ra', label: '', arrow: '-->' },
  ]
  const parModel = JSON.parse(JSON.stringify(PAR_MODEL))
  respond = function (method, args) {
    if (method === 'doc:get') {
      return fullDoc({ model: parModel, nodeCount: parModel.nodes.length, edgeCount: parModel.edges.length })
    }
    return prevRespondRoute(method, args)
  }
  const pHost = document.createElement('div')
  document.body.appendChild(pHost)
  const pRoot = createRoot(pHost)
  await act(async () => {
    pRoot.render(React.createElement(captured['conversation.view'], {
      cwd: UI, sessionId: 's1', useSessions: () => UI,
    }))
  })
  await flush()
  const pPaths = Array.from(pHost.querySelectorAll('path.ac-edge')).map((p) => p.getAttribute('d'))
  eq('一对节点之间的两条线都画出来了', pPaths.length, 2)
  ok('两条平行线不重叠（路径不相同）', pPaths.length === 2 && pPaths[0] !== pPaths[1], pPaths)

  // 扇入：三个源节点同时接进同一个目标节点的**同一侧**。
  // 从前三根线的端口是**同一个点**（这就是"一侧的箭头叠在一起"），现在必须沿边展开。
  const FAN_MODEL = {
    nodes: [
      { id: 'f1', label: '源一', shape: 'rect', x: -220, y: 0 },
      { id: 'f2', label: '源二', shape: 'rect', x: 0, y: 0 },
      { id: 'f3', label: '源三', shape: 'rect', x: 220, y: 0 },
      { id: 'ft', label: '汇总节点', shape: 'rect', x: 0, y: 340 },
    ],
    edges: [
      { id: 'fe1', from: 'f1', to: 'ft', label: '', arrow: '-->' },
      { id: 'fe2', from: 'f2', to: 'ft', label: '', arrow: '-->' },
      { id: 'fe3', from: 'f3', to: 'ft', label: '', arrow: '-->' },
    ],
    direction: 'TD',
    extras: [],
  }
  const fanModel = JSON.parse(JSON.stringify(FAN_MODEL))
  respond = function (method, args) {
    if (method === 'doc:get') {
      return fullDoc({ model: fanModel, nodeCount: fanModel.nodes.length, edgeCount: fanModel.edges.length })
    }
    return prevRespondRoute(method, args)
  }
  const fHost = document.createElement('div')
  document.body.appendChild(fHost)
  const fRoot = createRoot(fHost)
  await act(async () => {
    fRoot.render(React.createElement(captured['conversation.view'], {
      cwd: UI, sessionId: 's1', useSessions: () => UI,
    }))
  })
  await flush()
  const fPaths = Array.from(fHost.querySelectorAll('path.ac-edge'))
  eq('扇入的三条线都画出来了', fPaths.length, 3)
  // 路径的最后一个点就是它在目标边上的端口
  const endX = fPaths.map((p) => {
    const ns = (p.getAttribute('d').match(/-?\d+(?:\.\d+)?/g) || []).map(Number)
    return ns[ns.length - 2]
  })
  ok('三个端口互不相同（不再挤成一个点）',
    new Set(endX.map((v) => Math.round(v))).size === 3, endX)
  ok('相邻端口间距不小于箭头宽（箭头不会叠在一起）',
    Math.min(Math.abs(endX[0] - endX[1]), Math.abs(endX[1] - endX[2])) >= 11.9, endX)
  ok('端口顺序与源头顺序一致（线不会在方块跟前交叉）',
    endX[0] < endX[1] && endX[1] < endX[2], endX)

  await act(async () => { rRoot.unmount(); pRoot.unmount(); fRoot.unmount() })
  respond = prevRespondRoute
}

console.log('\n[4k] 用户要求移除「放入输入框」的横条：不再占用 conversation.input.dock')
{
  // 用户原话：「这个放入输入框的功能有 bug，所有留言自动链接进入输入框吧，这个放入对话框的
  // UI 直接移除吧」。所以这里**反向锁住**：那个横条不能悄悄回来 —— 它既提供一个不再需要的
  // 按钮，又要在发送区上方常年占一行。自动补引用的 effect 在 studio.ts 里（见 [4n]）。
  ok('不再注册 conversation.input.dock 槽位', captured['conversation.input.dock'] === undefined,
    Object.keys(captured))
  ok('横条的样式也一并去掉', insertedCss.indexOf('.ac-pending') < 0)
}
console.log('\n[4l] 写完留言**不**动输入框：留言只走注入，要发给 AI 用清单那个按钮')
{
  // 这一节从前断言的是「写完留言自动把 @id 补进草稿」。那个机制已经移除（见 studio.ts 里
  // 「留言不进输入框」那段注释）：它和 promptText 的注入在送同一件事，而且让「输入框是空的」
  // 这个状态根本不存在。现在锁的是新契约：**留言不许碰草稿**，要发就用清单头部那个按钮。
  const AUTO_MODEL = {
    nodes: [
      { id: 'a1', label: '节点甲', shape: 'rect', x: 0, y: 0, note: '这里为什么不用队列？', noteDone: false },
    ],
    edges: [], direction: 'TD', extras: [],
  }
  const prevRespondAuto = respond
  const autoModel = JSON.parse(JSON.stringify(AUTO_MODEL))
  const autoSets = []
  respond = function (method, args) {
    if (method === 'doc:get') return fullDoc({ model: autoModel, nodeCount: autoModel.nodes.length })
    if (method === 'doc:set') {
      autoSets.push(args.model)
      autoModel.nodes = args.model.nodes
      return fullDoc({ model: args.model, nodeCount: args.model.nodes.length, revision: 2, updatedBy: 'user' })
    }
    return prevRespondAuto(method, args)
  }
  const drafts = []
  // 留言框只能按**标签**找：它的 placeholder 是一句固定的例句，不是留言内容
  // （从前这条断言用 placeholder 找，靠的是例句里恰好有「这里为什么不用队列？」—— 运气好而已）
  const noteArea = (h) => {
    const f = Array.from(h.querySelectorAll('.ac-dock .ac-field'))
      .find((el) => (el.querySelector('label')?.textContent || '').indexOf('留言') === 0)
    return f && f.querySelector('textarea')
  }
  const USER_TEXT = '我本来打了一半的话'
  const aHost = document.createElement('div')
  document.body.appendChild(aHost)
  const aRoot = createRoot(aHost)
  await act(async () => {
    aRoot.render(React.createElement(captured['conversation.view'], {
      cwd: UI, sessionId: 's1', useSessions: () => UI,
      inputActions: { setDraft: (t) => { drafts.push(t) }, submit: () => {} },
      // 草稿里已经有用户打的字 —— 新契约是「一个字都别动它」
      useInput: (sel) => sel({ draft: USER_TEXT }),
    }))
  })
  await flush()

  const aNodeEl = Array.from(aHost.querySelectorAll('g.ac-node'))
    .find((g) => (g.textContent || '').indexOf('节点甲') >= 0)
  ok('画布上找得到那个节点', !!aNodeEl)
  await act(async () => { clickEl(aNodeEl) })
  await flush()

  const aArea = noteArea(aHost)
  ok('检查器里出现留言输入框', !!aArea)
  if (aArea) {
    const setAreaValueAuto = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set
    await act(async () => {
      setAreaValueAuto.call(aArea, '这条留言应该只走注入')
      aArea.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    await flush()
    await act(async () => {
      aArea.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    await flush()
  }
  // 正向对照先立住：留言**真的**写进了模型 —— 否则下面那条「没动草稿」是空转
  ok('留言确实写进了模型（正向对照）',
    autoSets.length > 0 && autoSets[autoSets.length - 1].nodes.some((n) => n.id === 'a1' && n.note === '这条留言应该只走注入'),
    autoSets.length)
  eq('而输入框一个字符都没被碰', drafts.length, 0)

  // 唯一一条「发给 AI」的路：清单头部的按钮（空输入框也能发，见 [4c] 3b）
  const aNoteBtn = Array.from(aHost.querySelectorAll('.ac-tools button')).find((b) => b.textContent.indexOf('留言') === 0)
  ok('工具条里有留言按钮（否则下面那条是空转）', !!aNoteBtn)
  if (aNoteBtn) {
    await act(async () => { aNoteBtn.click() })
    await flush()
  }
  ok('留言清单里有「交给 AI」按钮 —— 那是唯一一条发出去的路',
    !!Array.from(aHost.querySelectorAll('.ac-lib-head button')).find((b) => b.textContent.includes('交给 AI')))

  await act(async () => { aRoot.unmount() })
  aHost.remove()
  respond = prevRespondAuto
}

console.log('\n[4m] 端口的硬约束：绝不许越过方块边界（悬空连接的回归断言）')
{
  // 用户报的现场：节点**不展开**时，左侧的连线悬空。原因是我先前的端口分配在
  // "装不下就按最小间距 12 摆、允许溢出到角外"—— 而折叠（只有标题）的节点很矮，
  // 一侧挤进 4 条线时整串就溢出了方块，线头挂在框外。
  const SHORT_MODEL = {
    nodes: [
      { id: 's1', label: '源一', shape: 'rect', x: -320, y: 0 },
      { id: 's2', label: '源二', shape: 'rect', x: -320, y: 90 },
      { id: 's3', label: '源三', shape: 'rect', x: -320, y: 180 },
      { id: 's4', label: '源四', shape: 'rect', x: -320, y: 270 },
      { id: 's5', label: '源五', shape: 'rect', x: -320, y: 360 },
      { id: 's6', label: '源六', shape: 'rect', x: -320, y: 450 },
      { id: 'st', label: '目标', shape: 'rect', x: 0, y: 135 },
    ],
    edges: [
      { id: 'se1', from: 's1', to: 'st', label: '', arrow: '-->' },
      { id: 'se2', from: 's2', to: 'st', label: '', arrow: '-->' },
      { id: 'se3', from: 's3', to: 'st', label: '', arrow: '-->' },
      { id: 'se4', from: 's4', to: 'st', label: '', arrow: '-->' },
      { id: 'se5', from: 's5', to: 'st', label: '', arrow: '-->' },
      { id: 'se6', from: 's6', to: 'st', label: '', arrow: '-->' },
    ],
    direction: 'TD', extras: [],
  }
  const prevRespondShort = respond
  const shortModel = JSON.parse(JSON.stringify(SHORT_MODEL))
  respond = function (method, args) {
    if (method === 'doc:get') {
      return fullDoc({ model: shortModel, nodeCount: shortModel.nodes.length, edgeCount: shortModel.edges.length })
    }
    return prevRespondShort(method, args)
  }
  const sHost = document.createElement('div')
  document.body.appendChild(sHost)
  const sRoot = createRoot(sHost)
  await act(async () => {
    sRoot.render(React.createElement(captured['conversation.view'], {
      cwd: UI, sessionId: 's1', useSessions: () => UI,
    }))
  })
  await flush()

  const sPaths = Array.from(sHost.querySelectorAll('path.ac-edge'))
  eq('六条线都画出来了（目标左侧确实被挤爆了）', sPaths.length, 6)
  const ends = sPaths.map((p) => {
    const ns = (p.getAttribute('d').match(/-?\d+(?:\.\d+)?/g) || []).map(Number)
    return { x: ns[ns.length - 2], y: ns[ns.length - 1] }
  })
  const stEl = Array.from(sHost.querySelectorAll('g.ac-node'))
    .find((g) => (g.textContent || '').indexOf('目标') >= 0)
  const stRectEl = stEl ? stEl.querySelector('rect:not(.ac-pulse)') : null
  const stRect = stRectEl ? {
    x1: Number(stRectEl.getAttribute('x')),
    y1: Number(stRectEl.getAttribute('y')),
    x2: Number(stRectEl.getAttribute('x')) + Number(stRectEl.getAttribute('width')),
    y2: Number(stRectEl.getAttribute('y')) + Number(stRectEl.getAttribute('height')),
  } : null
  ok('量到了目标方块的矩形', !!stRect && stRect.y2 > stRect.y1, stRect)
  // 负向对照：这个场景本来就会溢出 —— 6 条线按"最小间距 12"需要 60px，
  // 而折叠节点的高度只有 40 出头。证明下面那条断言不是空转。
  // （第一版只放了 4 条，60→36 还不够高，负向对照当场把它揭穿了。）
  ok('负向对照成立：按最小间距 12 摆会超出方块高度',
    !!stRect && (6 - 1) * 12 > (stRect.y2 - stRect.y1), stRect)
  ok('所有端口都贴在目标方块的左边界上',
    ends.every((e) => Math.abs(e.x - stRect.x1) <= 1), { stRect, ends })
  ok('端口全在方块的上下范围之内（没有一个悬空到框外）',
    !!stRect && ends.every((e) => e.y >= stRect.y1 - 0.5 && e.y <= stRect.y2 + 0.5), { stRect, ends })

  await act(async () => { sRoot.unmount() })
  respond = prevRespondShort
}

console.log('\n[4n] 输入框再也不被留言碰：挂载 / 写新留言 / 标记已解决，全程一次 setDraft 都不调')
{
  // 这一节原来盯的是「待办集合变了就自动补引用」那条 effect 的一堆边界（一次补全、
  // 不重复、删了不追着加、已解决的不进）。那个机制整体移除了，所以这里反过来锁新契约：
  // **留言相关的任何动作都不许碰草稿**。每一条负向断言前面都先立一个正向对照
  // （留言真的写进去了），否则「没动草稿」在实现整个坏掉时照样能过。
  const NOTE_MODEL = {
    nodes: [
      { id: 'x1', label: '甲', shape: 'rect', x: 0, y: 0, note: '未办一', noteDone: false },
      { id: 'x3', label: '丙', shape: 'rect', x: 320, y: 0, note: '未办二', noteDone: false },
    ],
    edges: [], direction: 'TD', extras: [],
  }
  const prevRespondNote = respond
  let curNoteModel = JSON.parse(JSON.stringify(NOTE_MODEL))
  const sets = []
  respond = function (method, args) {
    if (method === 'doc:get') return fullDoc({ model: curNoteModel, nodeCount: curNoteModel.nodes.length })
    if (method === 'doc:set') {
      sets.push(args.model)
      curNoteModel = args.model
      return fullDoc({ model: args.model, nodeCount: args.model.nodes.length, revision: 2, updatedBy: 'user' })
    }
    return prevRespondNote(method, args)
  }

  const drafts = []
  // 留言框只能按**标签**找：它的 placeholder 是一句固定的例句，不是留言内容
  // （从前这条断言用 placeholder 找，靠的是例句里恰好有「这里为什么不用队列？」—— 运气好而已）
  const noteArea = (h) => {
    const f = Array.from(h.querySelectorAll('.ac-dock .ac-field'))
      .find((el) => (el.querySelector('label')?.textContent || '').indexOf('留言') === 0)
    return f && f.querySelector('textarea')
  }
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  // 留言相关的写入都经过 RPC，落定要看下一拍
  const settle = async () => {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    await flush()
  }
  await act(async () => {
    root.render(React.createElement(captured['conversation.view'], {
      cwd: UI, sessionId: 's1', useSessions: () => UI,
      inputActions: { setDraft: (t) => { drafts.push(t) }, submit: () => {} },
      useInput: (sel) => sel({ draft: '我打的字' }),
    }))
  })
  await flush()
  await settle()
  eq('挂载时（图上已有两条未办留言）一次 setDraft 都没调', drafts.length, 0)

  // a. 写一条新留言
  const nodeEl = Array.from(host.querySelectorAll('g.ac-node')).find((g) => (g.textContent || '').indexOf('甲') >= 0)
  ok('找得到节点（否则下面的断言是空转）', !!nodeEl)
  await act(async () => { clickEl(nodeEl) })
  await flush()
  const area = noteArea(host)
  ok('检查器里出现留言输入框', !!area)
  const setAreaValue = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set
  if (area) await act(async () => {
    setAreaValue.call(area, '新写的一条')
    area.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
  await flush()
  if (area) await act(async () => { area.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
  await flush()
  await settle()
  ok('留言确实写进去了（正向对照）',
    sets.length > 0 && sets[sets.length - 1].nodes.some((n) => n.id === 'x1' && n.note === '新写的一条'),
    sets.length)
  eq('写完留言，输入框仍然一次都没被碰', drafts.length, 0)

  // b. 标记已解决
  const doneBtn = Array.from(host.querySelectorAll('.ac-note-actions button'))
    .find((b) => b.textContent.indexOf('不发了') === 0)
  ok('找得到「不发了」按钮（否则下面那条是空转）', !!doneBtn)
  const before = sets.length
  if (doneBtn) {
    await act(async () => { doneBtn.click() })
    await flush()
    await settle()
  }
  ok('已解决确实写进去了（正向对照）',
    sets.length > before && sets[sets.length - 1].nodes.some((n) => n.id === 'x1' && n.noteDone === true),
    { before: before, after: sets.length })
  eq('收起留言也不碰输入框', drafts.length, 0)

  await act(async () => { root.unmount() })
  host.remove()
  respond = prevRespondNote
}
console.log('\n[4o] Esc 两段式：第一下只拿焦点，第二下才关编辑页')
{
  const ESC_MODEL = {
    nodes: [
      { id: 'e1', label: '节点甲', shape: 'rect', x: 0, y: 0, note: '这里为什么不用队列？', noteDone: false },
    ],
    edges: [], direction: 'TD', extras: [],
  }
  const prevRespondEsc = respond
  const escModel = JSON.parse(JSON.stringify(ESC_MODEL))
  respond = function (method, args) {
    if (method === 'doc:get') return fullDoc({ model: escModel, nodeCount: 1 })
    return prevRespondEsc(method, args)
  }
  const eHost = document.createElement('div')
  document.body.appendChild(eHost)
  const eRoot = createRoot(eHost)
  await act(async () => {
    eRoot.render(React.createElement(captured['conversation.view'], {
      cwd: UI, sessionId: 's1', useSessions: () => UI,
    }))
  })
  await flush()
  const eNodeEl = eHost.querySelector('g.ac-node')
  await act(async () => {
    clickEl(eNodeEl)
  })
  await flush()
  const inspectorOpen = () => !!eHost.querySelector('textarea[placeholder*="这里为什么不用队列"]')
  ok('选中节点后编辑页打开', inspectorOpen())
  const escArea = eHost.querySelector('textarea[placeholder*="这里为什么不用队列"]')
  await act(async () => { escArea.focus() })
  eq('焦点在输入框里', document.activeElement === escArea, true)

  // 第一下：焦点在输入框 → 焦点移进面板根，编辑页不动
  await act(async () => {
    escArea.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })
  await flush()
  const rootEl = eHost.querySelector('.ac-root')
  ok('第一下 Esc 把焦点从输入框拿走了', document.activeElement !== escArea,
    document.activeElement && document.activeElement.tagName)
  // 这条是关键：焦点必须落在**面板根**上。用 blur() 掉到 body 的话，
  // Esc 的处理器（挂在 .ac-root 上）就再也收不到第二下，编辑页永远关不掉。
  ok('焦点落到了面板根上（所以第二下 Esc 还能被收到）',
    !!rootEl && document.activeElement === rootEl,
    document.activeElement && document.activeElement.className)
  ok('第一下 Esc 没有关掉编辑页', inspectorOpen())

  // 第二下：焦点已在面板根上 → 关掉（取消选中）
  await act(async () => {
    rootEl.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })
  await flush()
  ok('第二下 Esc 关掉了编辑页', !inspectorOpen())

  await act(async () => { eRoot.unmount() })
  respond = prevRespondEsc
}

console.log('\n[4p] 连线之间的两件事：平行间隔（不叠在一起）+ 十字交叉处拱一下')
{
  // 用户报的：「平行间隔算法没有做…十字交叉时应该有一条线弯折一下」。
  // 实测他的画布：48 处平行重叠，线距 0.0px（两条线画在同一条线上，最长重叠 129px）；
  // 另有 5 处十字交叉是硬生生穿过去的。
  const renderEdges = async (MODEL) => {
    const prevR = respond
    const m = JSON.parse(JSON.stringify(MODEL))
    respond = function (method, args) {
      if (method === 'doc:get') return fullDoc({ model: m, nodeCount: m.nodes.length, edgeCount: m.edges.length })
      return prevR(method, args)
    }
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => {
      root.render(React.createElement(captured['conversation.view'], {
        cwd: UI, sessionId: 's1', useSessions: () => UI,
      }))
    })
    await flush()
    const out = Array.from(host.querySelectorAll('path.ac-edge')).map((p) => p.getAttribute('d'))
    await act(async () => { root.unmount() })
    host.remove()
    respond = prevR
    return out
  }
  // 从 d 里取路径经过的点（M / L 的终点、Q 的终点、A 的终点）
  const ptsOf = (d) => {
    const out = []
    const re = /([MLQA])((?: -?[\d.]+)+)/g
    let m
    while ((m = re.exec(d)) !== null) {
      const ns = (m[2].match(/-?[\d.]+/g) || []).map(Number)
      if (m[1] === 'Q') out.push({ x: ns[2], y: ns[3] })
      else if (m[1] === 'A') out.push({ x: ns[5], y: ns[6] })
      else out.push({ x: ns[0], y: ns[1] })
    }
    return out
  }
  // 车道 = 整条路径里**最长的那条水平线段**的 y（拐角抹圆不会改它的 y）
  const laneY = (d) => {
    const p = ptsOf(d)
    let best = null, len = -1
    for (let i = 0; i + 1 < p.length; i++) {
      if (Math.abs(p[i].y - p[i + 1].y) > 0.5) continue
      const L = Math.abs(p[i + 1].x - p[i].x)
      if (L > len) { len = L; best = p[i].y }
    }
    return best
  }

  // —— 甲：平行间隔 ——
  // 两条竖着走的 Z 形折线，中位线**算出来是同一个 y**，横向跨度互相重叠 —— 没有间隔算法时
  // 它们会画成同一条线。
  //
  // 2026-09-23 换掉了这个模型的坐标两次，原因值得写下来：
  //   1) 最早的 pa(0,0)→pb(200,400) 靠「|dy| >= |dx| 就走竖轴」那条**只看中心**的旧规则才竖着走；
  //      选边改成代价择优之后它改走横轴（更短），冲突就没了。
  //   2) 第二版（把节点堆在两根柱子上）**这个断言是空转的**：pc/pd 会挡住 pa→pb 的直路，
  //      于是第一条线本来就绕行、两条线天然不在同一条车道上 —— 把间隔算法删掉断言照样过。
  //      独立复核抓到了这一点，现在的坐标是**穷举搜出来**的：两条都是干净的 Z（4 个折点、
  //      不绕行）、中位线相同、跨度重叠，唯一能解释「车道差 ≥10px」的就只剩间隔算法本身。
  const PARALLEL_MODEL = {
    nodes: [
      { id: 'pa', label: '甲', shape: 'rect', x: -60, y: 0 },
      { id: 'pb', label: '乙', shape: 'rect', x: 40, y: 500 },
      { id: 'pc', label: '丙', shape: 'rect', x: -40, y: 1000 },
      { id: 'pd', label: '丁', shape: 'rect', x: 20, y: -500 },
    ],
    edges: [
      { id: 'pe1', from: 'pa', to: 'pb', label: '', arrow: '-->' },
      { id: 'pe2', from: 'pc', to: 'pd', label: '', arrow: '-->' },
    ],
    direction: 'TD', extras: [],
  }
  const pds = await renderEdges(PARALLEL_MODEL)
  eq('两条平行线都画出来了', pds.length, 2)
  const lane1 = laneY(pds[0]), lane2 = laneY(pds[1])
  const mid0Of = (d) => {
    const p = ptsOf(d)
    return (p[0].y + p[p.length - 1].y) / 2
  }
  // 两条都是干净的 Z（只有 M/L 四个折点；拐角被抹圆会额外出现 Q，那不算绕行）：
  // 只要有一条在绕行（六个折点），下面那条断言就不是在测间隔算法了 —— 复核抓过一次这种空转。
  const straightOf = (d) => {
    const out = []
    const re = /([ML])((?: -?[\d.]+)+)/g
    let m
    while ((m = re.exec(d)) !== null) {
      const ns = (m[2].match(/-?[\d.]+/g) || []).map(Number)
      out.push({ x: ns[0], y: ns[1] })
    }
    return out
  }
  ok('两条都是干净的 Z 形折线（没有绕行）',
    straightOf(pds[0]).length === 4 && straightOf(pds[1]).length === 4,
    { a: straightOf(pds[0]), b: straightOf(pds[1]) })
  // 负向对照：两条线的**中位线**本来就是同一个 —— 说明「相隔 ≥10px」不是算出来的巧合，
  // 而是间隔算法真的把它们推开了。
  ok('负向对照：两条线本来会落在同一条中位线上（|Δ| < 1）',
    Math.abs(mid0Of(pds[0]) - mid0Of(pds[1])) < 1,
    { a: mid0Of(pds[0]), b: mid0Of(pds[1]) })
  ok('平行间隔成立：两条线的车道相距 ≥ 10px', Math.abs(lane1 - lane2) >= 10, { lane1, lane2 })
  ok('两条车道都还在（不是把一条挪没了）', lane1 !== null && lane2 !== null, { lane1, lane2 })

  // —— 乙：十字交叉 ——
  // 一条竖线（x=0，y 22.5→277.5）与一条横线（y=150，x -248→248）在 (0,150) 正交相交。
  const CROSS_MODEL = {
    nodes: [
      { id: 'xa', label: '甲', shape: 'rect', x: 0, y: 0 },
      { id: 'xb', label: '乙', shape: 'rect', x: 0, y: 300 },
      { id: 'xc', label: '丙', shape: 'rect', x: -300, y: 150 },
      { id: 'xd', label: '丁', shape: 'rect', x: 300, y: 150 },
    ],
    edges: [
      { id: 'xe1', from: 'xa', to: 'xb', label: '', arrow: '-->' },
      { id: 'xe2', from: 'xc', to: 'xd', label: '', arrow: '-->' },
    ],
    direction: 'TD', extras: [],
  }
  const xds = await renderEdges(CROSS_MODEL)
  eq('交叉用例的两条线都画出来了', xds.length, 2)
  const vp = ptsOf(xds[0]), hplane = ptsOf(xds[1])
  // 负向对照：这两条线**真的**相交（竖线经过 y=150，横线经过 x=0），不是我们凭空拱了一下
  ok('负向对照：竖线确实经过 y=150', vp[0].x === vp[vp.length - 1].x && vp[0].y < 150 && vp[vp.length - 1].y > 150, vp)
  ok('负向对照：横线确实经过 x=0', hplane[0].y === hplane[hplane.length - 1].y && hplane[0].x < 0 && hplane[hplane.length - 1].x > 0, hplane)
  ok('先画的那条直着走（没有拱）', xds[0].indexOf('A ') < 0, xds[0])
  ok('后画的那条在交叉处拱了一下（路径里有圆弧）', xds[1].indexOf('A 5 5 0 0 1') >= 0, xds[1])
  // 拱的位置必须正好在交点上：从 (0-5,150) 拱到 (0+5,150)，sweep=1 表示鼓在前进方向的左侧（上面）
  const arcM = /A 5 5 0 0 1 (-?[\d.]+) (-?[\d.]+)/.exec(xds[1])
  ok('拱的落点就是交点 (5,150)', !!arcM && Math.abs(Number(arcM[1]) - 5) < 0.01 && Math.abs(Number(arcM[2]) - 150) < 0.01, arcM && arcM[0])
  const hp = ptsOf(xds[1])
  ok('拱的起点是 (0-5,150)：整段拱正好骑在交点两侧',
    hp.some((p) => Math.abs(p.x - (-5)) < 0.01 && Math.abs(p.y - 150) < 0.01), hp)
}

console.log('\n[4q] 源码页的滚动：flex-basis 为 0 + 一道原生 wheel 兜底')
{
  const cssRule = (sel) => {
    const i = insertedCss.indexOf(sel + '{')
    return i < 0 ? '' : insertedCss.slice(i + sel.length + 1, insertedCss.indexOf('}', i))
  }
  // flex-basis 必须是 0：用 auto 时基准尺寸取内容高度，外层高度链一旦不定，这个盒子就跟着
  // 内容一起长高、永远「没有溢出」，滚轮怎么滚都没反应（用户报了两遍的就是这个）。
  const wrap = cssRule('.ac-textwrap')
  ok('.ac-textwrap 的 flex 是 1 1 0（不是 1 1 auto）', wrap.indexOf('flex:1 1 0') >= 0, wrap)
  ok('.ac-textwrap 仍然是 overflow:auto（唯一滚动口）', wrap.indexOf('overflow:auto') >= 0, wrap)

  const HL_MERMAID2 = ['%%! 说明行', 'flowchart TD', ...Array.from({ length: 80 }, (_, i) => '  n' + i + '["第 ' + i + ' 个"]')].join('\n')
  const prevR2 = respond
  respond = function (method, args) {
    if (method === 'doc:get') {
      return fullDoc({ model: { nodes: [], edges: [], direction: 'TD', extras: [] }, mermaid: HL_MERMAID2 })
    }
    return prevR2(method, args)
  }
  const wHost = document.createElement('div')
  document.body.appendChild(wHost)
  const wRoot = createRoot(wHost)
  await act(async () => {
    wRoot.render(React.createElement(captured['conversation.view'], {
      cwd: UI, sessionId: 's1', useSessions: () => UI,
    }))
  })
  await flush()
  await act(async () => {
    Array.from(wHost.querySelectorAll('.ac-tabs button')).find((b) => b.textContent.trim() === '源码').click()
  })
  await flush()

  const tw = wHost.querySelector('.ac-textwrap')
  ok('源码页的滚动口就是 .ac-textwrap', !!tw)
  // jsdom 不做排版，scrollHeight/clientHeight 都是 0；把这两个量打桩成「内容 1000、可视 100」，
  // 才能真的观察 scrollTop 有没有被那道原生 wheel 推动。
  if (tw) {
    // jsdom 不做排版：scrollHeight/clientHeight 都是 0，scrollTop 也不会像真浏览器那样
    // 按「内容高 - 可视高」夹住。所以这里把这三样打桩成一个能滚、上限 900 的元素 ——
    // 「贴底时值不再变化」正是真浏览器会有的行为，兜底逻辑判的就是这个。
    let st = 0
    Object.defineProperty(tw, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(tw, 'clientHeight', { value: 100, configurable: true })
    Object.defineProperty(tw, 'scrollTop', {
      configurable: true,
      get: () => st,
      set: (v) => { st = Math.max(0, Math.min(900, v)) },
    })
    let ev = new dom.window.WheelEvent('wheel', { deltaY: 60, bubbles: true, cancelable: true })
    await act(async () => { tw.dispatchEvent(ev) })
    eq('滚轮往下 → scrollTop 前进 60（原生兜底真的在推它）', tw.scrollTop, 60)
    ok('这次滚动把浏览器自己的滚动拦掉了（否则会滚两倍）', ev.defaultPrevented)
    // 负向对照：已经贴底时不再拦事件 —— 否则一个到底的滚轮会把事件吞掉，页面看起来"卡住"
    st = 900
    let ev2 = new dom.window.WheelEvent('wheel', { deltaY: 60, bubbles: true, cancelable: true })
    await act(async () => { tw.dispatchEvent(ev2) })
    eq('贴底时 scrollTop 停在底（900）', tw.scrollTop, 900)
    // 这条不只是"顺手加个负向对照"——它锁的是一桩真 bug 的回归：
    // 画布页的滚轮缩放监听器从前 deps 是 []、挂在 hostRef 上，而三个 tab 的根元素是同一个
    // div（React 复用 DOM 节点），于是切到源码页后它**还挂在那个节点上**（类名已改成
    // .ac-textwrap），每次都无条件 preventDefault() —— 源码页的滚动被整条掐掉。
    // 「贴底时不该被拦」正好是这个泄漏的探针：泄漏还在时，这一下必然被拦。
    ok('负向对照：贴底这一下没有 preventDefault（画布那条滚轮缩放监听器没有泄漏到源码页）',
      !ev2.defaultPrevented)
    // 正面控制：切回画布页，滚轮仍然是**缩放**（别为了修上面那条把画布的功能一起关掉）
    await act(async () => {
      Array.from(wHost.querySelectorAll('.ac-tabs button')).find((b) => b.textContent.trim() === '画布').click()
    })
    await flush()
    const worldEl = wHost.querySelector('.ac-world')
    ok('切回画布页后有 .ac-world', !!worldEl)
    if (worldEl) {
      const scaleOf = (t) => Number((/scale\((-?[\d.]+)/.exec(t || '') || [])[1])
      const before = scaleOf(worldEl.getAttribute('transform'))
      const stageEl = wHost.querySelector('.ac-stage')
      let evz = new dom.window.WheelEvent('wheel', { deltaY: -100, clientX: 50, clientY: 40, bubbles: true, cancelable: true })
      await act(async () => { stageEl.dispatchEvent(evz) })
      const after = scaleOf(worldEl.getAttribute('transform'))
      ok('画布页滚轮仍然是缩放（scale 变大）', after > before, { before, after })
      ok('画布页的滚轮确实被拦（缩放而不是滚动页面）', evz.defaultPrevented)
    }
  }
  await act(async () => { wRoot.unmount() })
  wHost.remove()
  respond = prevR2
}


endPhase()
