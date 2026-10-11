// 界面渲染分片（共享脚手架见 ui.render.shared.mjs；DOM/React/桩 RPC/槽位捕获都由它装载）。
import { endPhase } from './ui.render.shared.mjs'

console.log('\n[4v] 展开态的组框整块可拖：拖背景带走整组，拖按钮不带走')
{
  // 用户的原话：「我希望展开的时候，节点组的背景也能被捕捉并移动」。
  // 折叠态那个块早就能拖，展开态从前只能平移画布 —— 同一个东西一个能拖一个不能。
  const GMODEL = {
    nodes: [
      { id: 'm1', label: '组内一', shape: 'rect', group: 'g1', x: 100, y: 100 },
      { id: 'm2', label: '组内二', shape: 'rect', group: 'g1', x: 260, y: 100 },
      { id: 'out1', label: '组外', shape: 'rect', group: null, x: 560, y: 320 },
    ],
    edges: [], groups: [{ id: 'g1', label: '一组' }], direction: 'TD', extras: [],
  }
  const prevRespondV = respond
  let curV = JSON.parse(JSON.stringify(GMODEL))
  let vSets = 0
  respond = function (method, args) {
    if (method === 'doc:get') return fullDoc({ model: curV, nodeCount: curV.nodes.length, groupCount: curV.groups.length })
    if (method === 'doc:set') { vSets++; curV = args.model; return fullDoc({ model: curV, nodeCount: curV.nodes.length, revision: 2, updatedBy: 'user' }) }
    return prevRespondV(method, args)
  }
  const vHost = document.createElement('div')
  document.body.appendChild(vHost)
  const vRoot = createRoot(vHost)
  await act(async () => {
    vRoot.render(React.createElement(captured['conversation.view'], {
      cwd: UI, sessionId: 's1', useSessions: () => UI,
    }))
  })
  await flush()
  const vSvg = vHost.querySelector('svg.ac-svg')
  const groupBox = vHost.querySelector('rect.ac-group-box')
  ok('展开态下组框存在（前置条件，否则下面全是空转）', !!groupBox && !!vSvg)

  // a. 拖组框背景 → 组内两个节点移动**同一个位移**，组外的节点一个像素都不动
  const before = JSON.parse(JSON.stringify(curV))
  const setsBefore = vSets
  await act(async () => {
    groupBox.dispatchEvent(new dom.window.PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 150, clientY: 110 }))
    vSvg.dispatchEvent(new dom.window.PointerEvent('pointermove', { bubbles: true, clientX: 260, clientY: 200 }))
    vSvg.dispatchEvent(new dom.window.PointerEvent('pointerup', { bubbles: true, button: 0, clientX: 260, clientY: 200 }))
  })
  await flush()
  const nodeOfV = (m, id) => m.nodes.find((n) => n.id === id)
  const d1 = { x: nodeOfV(curV, 'm1').x - nodeOfV(before, 'm1').x, y: nodeOfV(curV, 'm1').y - nodeOfV(before, 'm1').y }
  const d2 = { x: nodeOfV(curV, 'm2').x - nodeOfV(before, 'm2').x, y: nodeOfV(curV, 'm2').y - nodeOfV(before, 'm2').y }
  ok('拖组框真的写盘了（否则下面全是空转）', vSets > setsBefore)
  ok('组内两个节点都被带走了', (d1.x !== 0 || d1.y !== 0) && (d2.x !== 0 || d2.y !== 0), { d1, d2 })
  eq('而且位移完全一致（整组平移，不是各走各的）—— x', d1.x, d2.x)
  eq('而且位移完全一致 —— y', d1.y, d2.y)
  eq('组外的节点 x 一个像素都不动（负向对照）', nodeOfV(curV, 'out1').x, nodeOfV(before, 'out1').x)
  eq('组外的节点 y 一个像素都不动（负向对照）', nodeOfV(curV, 'out1').y, nodeOfV(before, 'out1').y)
  ok('负向对照：拖动**不**折叠（组框还在）', !!vHost.querySelector('rect.ac-group-box'))

  // b. 拖那个收起按钮 → 不许把整组拖走（openFold 有 stopPropagation），只换折叠态
  const before2 = JSON.parse(JSON.stringify(curV))
  const setsBefore2 = vSets
  const vBtn = vHost.querySelector('g.ac-group-btn')
  ok('收起按钮还在（否则下面那条是空转）', !!vBtn)
  await act(async () => {
    vBtn.dispatchEvent(new dom.window.PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 150, clientY: 110 }))
    vSvg.dispatchEvent(new dom.window.PointerEvent('pointermove', { bubbles: true, clientX: 300, clientY: 240 }))
    vSvg.dispatchEvent(new dom.window.PointerEvent('pointerup', { bubbles: true, button: 0, clientX: 300, clientY: 240 }))
  })
  await flush()
  eq('拖收起按钮不会写盘（没把组拖走）', vSets, setsBefore2)
  eq('组内节点 x 一点没变', nodeOfV(curV, 'm1').x, nodeOfV(before2, 'm1').x)
  eq('组内节点 y 一点没变', nodeOfV(curV, 'm1').y, nodeOfV(before2, 'm1').y)
  ok('而它确实折叠了（说明按钮本身还是工作的）', !!vHost.querySelector('g.ac-fold'))

  // c. 样式表里那两条 cursor —— jsdom 不算层叠样式，只能断言规则本身
  ok('组框与组名都是 cursor:move（不是那个骗人的 pointer）',
    insertedCss.indexOf('.ac-group-box{') >= 0 && /\.ac-group-box\{[^}]*cursor:move/.test(insertedCss)
    && /\.ac-group-lbl\{[^}]*cursor:move/.test(insertedCss))

  await act(async () => { vRoot.unmount() })
  vHost.remove()
  respond = prevRespondV
}

console.log('\n[4w] 拖动：rAF 合帧不丢位移 / 吸附按屏幕像素 + 迟滞 + Alt / 取消要回滚')
{
  // 这一节量的是「手感」里可断言的那部分：
  //   1) 一帧最多一次状态更新（rAF 合帧），但抬手前必须 flush —— 否则最后一段位移会丢；
  //   2) 吸附阈值按**屏幕像素**折算（与缩放无关），带迟滞（吸上 8px、脱开 14px），Alt 临时关掉；
  //   3) pointercancel（浏览器把手势判成滚动/缩放）= 回滚，不写盘也不进历史；
  //      lostpointercapture（捕获中途丢了）= 提交，绝不静默丢掉用户已经拖出来的位移。
  const DRAG_MODEL = {
    nodes: [
      { id: 'd1', label: '甲', shape: 'rect', group: null, x: 0, y: 0 },
      { id: 'd2', label: '乙', shape: 'rect', group: null, x: 200, y: 0 },
    ],
    edges: [], groups: [], direction: 'TD', extras: [],
  }
  const prevR = respond
  const sets = []
  const m = JSON.parse(JSON.stringify(DRAG_MODEL))
  respond = function (method, args) {
    if (method === 'doc:get') return fullDoc({ model: m, nodeCount: m.nodes.length })
    if (method === 'doc:set') { sets.push(args.model); return fullDoc({ model: args.model, nodeCount: args.model.nodes.length, revision: 7, updatedBy: 'user' }) }
    return prevR(method, args)
  }
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(React.createElement(captured['conversation.view'], { cwd: UI, sessionId: 's-drag', useSessions: () => UI }))
  })
  await flush()

  const svgEl = host.querySelector('svg.ac-svg')
  const stageEl = host.querySelector('.ac-stage')
  const nodeEl = () => Array.from(host.querySelectorAll('g.ac-node')).find((el) => (el.textContent || '').indexOf('甲') >= 0)
  const rectX = () => Number(nodeEl().querySelector('rect:not(.ac-pulse)').getAttribute('x'))
  const down = (x, y, extra) => nodeEl().dispatchEvent(new dom.window.PointerEvent('pointerdown', Object.assign({ bubbles: true, button: 0, clientX: x, clientY: y }, extra || {})))
  const move = (x, y, extra) => svgEl.dispatchEvent(new dom.window.PointerEvent('pointermove', Object.assign({ bubbles: true, clientX: x, clientY: y }, extra || {})))
  const up = (x, y) => svgEl.dispatchEvent(new dom.window.PointerEvent('pointerup', { bubbles: true, button: 0, clientX: x, clientY: y }))
  const frame = async () => { await act(async () => { await new Promise((r) => dom.window.requestAnimationFrame(() => r())) }) }
  const curX = () => { const s = sets[sets.length - 1]; return s ? s.nodes.find((n) => n.id === 'd1').x : 0 }
  let k = 1   // 当前缩放：client 位移 = 模型位移 × k
  // 每次拖动都从「节点当前所在的位置」出发（拖动会累积，不是每次都从 0 开始）
  const dragTo = async (target, extra) => {
    const from = curX()
    await act(async () => { down(0, 0) })
    await flush()
    await act(async () => { move((target - from) * k, 0, extra) })
    await frame()
  }
  const endDrag = async () => { await act(async () => { up(0, 0) }); await flush() }
  // 一次「按下 → 若干次移动 → 抬手」。**必须一次按下走完**，因为吸附的迟滞状态
  // （上一步吸在哪条线上）挂在这一次拖动里；每次移动都要等一帧，rAF 是 latest-wins。
  const dragSeq = async (targets) => {
    let from = curX()
    await act(async () => { down(0, 0) })
    await flush()
    for (const t of targets) {
      const d = (t - from) * k
      await act(async () => { move(d, 0) })
      await frame()
      from = t
    }
    await endDrag()
  }

  // ---- 1) rAF 合帧：只发一个 pointermove（不抬手），下一帧位置也要生效 ----
  await act(async () => { down(0, 0) })
  await flush()
  await act(async () => { move(100, 0) })
  await frame()
  ok('只发 pointermove、不抬手：下一帧节点就跟着走了（rAF 那条路真的在跑）',
    Math.abs(rectX() - (-52 + 100)) < 1, rectX())
  await act(async () => { up(100, 0) })
  await flush()
  eq('抬手时提交的是最后那段位移（flush 没丢）', curX(), 100)

  // ---- 2) 吸附：k=1 时阈值 8px，206 距对端中心 6px → 吸到 200 ----
  await dragTo(206)
  ok('吸附命中时画布上出现参考线（.ac-snapline）', !!host.querySelector('.ac-snapline'))
  await endDrag()
  eq('k=1：偏离 6px 吸到对端中心线上', curX(), 200)

  // ---- 3) 迟滞：吸上之后要走到 14px 之外才脱开（必须在**同一次**拖动里） ----
  // 先挪到一个离吸附线远的地方（230），这样后面每次移动都能按「节点中心的目标值」直接算
  await dragSeq([230])
  await act(async () => { down(0, 0) })
  await flush()
  await act(async () => { move((204 - 230) * k, 0) })   // 中心 204：距 200 是 4px → 吸上
  await frame()
  ok('先吸上（中心 204 距 200 只有 4px）', Math.abs(rectX() - (-52 + 200)) < 1, rectX())
  await act(async () => { move((210 - 230) * k, 0) })   // 中心 210：距 200 是 10px，> 进入阈值 8、< 脱开阈值 14
  await frame()
  ok('吸上之后 10px 之内仍然吸着（迟滞）', Math.abs(rectX() - (-52 + 200)) < 1, rectX())
  await act(async () => { move((216 - 230) * k, 0) })   // 中心 216：16px > 14 → 脱开
  await frame()
  await act(async () => { up(0, 0) })
  await flush()
  eq('走出脱开阈值之后不再吸（回到跟手）', curX(), 216)

  // ---- 4) Alt 临时关掉吸附 ----
  await dragTo(206, { altKey: true })
  await endDrag()
  eq('按住 Alt：同一个位置不吸，落在 206', curX(), 206)

  // ---- 5) 阈值按屏幕像素折算：放大到 1.4 倍之后，6px 就不该再吸 ----
  await act(async () => {
    for (let i = 0; i < 3; i++) stageEl.dispatchEvent(new dom.window.WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -1, clientX: 0, clientY: 0 }))
  })
  await flush()
  // 缩放从**画布真实渲染出来的 transform** 读，而不是把滚轮步长（1.12）抄进测试 ——
  // 抄进来的话，改一次滚轮灵敏度这条测试就悄悄测错了东西。
  const worldScale = () => {
    const t = host.querySelector('g.ac-world').getAttribute('transform') || ''
    const m = /scale\(([\d.]+)\)/.exec(t)
    return m ? Number(m[1]) : 1
  }
  k = worldScale()
  ok('前置：滚轮确实把画布放大了（从 transform 读到的 k=' + k.toFixed(3) + '）', k > 1.3)
  // 这一条是**旧规则的判据**，不是恒真式：阈值缩到 8/k 之后，6px 的偏移已经落在阈值外，
  // 而同一批操作在 k=1 时是吸上的（第 2 步断言过「k=1：偏离 6px 吸到对端中心线上」）。
  ok('负向对照：按旧规则（模型单位 8px）这个偏移会吸上，而按屏幕阈值 8/k=' + (8 / k).toFixed(2) + 'px 不该吸',
    6 > 8 / k && 6 < 8)
  // 注意：拖动本身有个 4px（client）的抖动门槛，所以「位移」要够大才算拖动。
  // 放大之后 4 个模型像素 = 5.6 个 client 像素，够过门槛；而两次移动的距离也要够。
  await dragSeq([216])
  eq('放大后 16px 的偏移不吸（离得远）', curX(), 216)
  await dragSeq([204])   // 216 → 204：位移 12 模型像素（够过门槛），终点距 200 是 4px < 8/k
  eq('放大后 4px 的偏移仍然吸上（不是「放大之后吸附整体失效」）', curX(), 200)
  await dragSeq([206])   // 200 → 206：终点距 200 是 6px > 8/k ≈ 5.7px
  eq('放大后 6px 的偏移不再吸（阈值按屏幕像素折算）', curX(), 206)

  // ---- 6) pointercancel：回滚，不写盘 ----
  const setsBeforeCancel = sets.length
  const atCancel = curX()
  await dragTo(atCancel + 300)
  ok('前置：取消之前节点确实跟着走了', rectX() > 100, rectX())
  await act(async () => { svgEl.dispatchEvent(new dom.window.PointerEvent('pointercancel', { bubbles: true, clientX: 300 * k, clientY: 0 })) })
  await flush()
  eq('pointercancel 之后节点回到按下时的坐标', curX(), atCancel)
  eq('pointercancel 不写盘（不进历史）', sets.length, setsBeforeCancel)

  // ---- 7) lostpointercapture：提交，不静默丢位移 ----
  const setsBeforeLost = sets.length
  const target7 = curX() + 160
  await dragTo(target7)
  await act(async () => { svgEl.dispatchEvent(new dom.window.PointerEvent('lostpointercapture', { bubbles: true, clientX: 160 * k, clientY: 0 })) })
  await flush()
  ok('捕获中途丢了：位移被提交而不是丢掉', sets.length > setsBeforeLost, sets.length - setsBeforeLost)
  eq('提交的正是拖动到的位置', curX(), target7)

  await act(async () => { root.unmount() })
  host.remove()
  respond = prevR

  // ---- 8) 分组拖动也吸附（从前只有节点吸，同一个动作两种手感） ----
  const GRP_MODEL = {
    nodes: [
      { id: 'm1', label: '甲', shape: 'rect', group: 'g1', x: 0, y: 0 },
      { id: 'm2', label: '乙', shape: 'rect', group: 'g1', x: 100, y: 0 },
      { id: 'p1', label: '丙', shape: 'rect', group: null, x: 450, y: 0 },
    ],
    edges: [], groups: [{ id: 'g1', label: '组一' }], direction: 'TD', extras: [],
  }
  const gSets = []
  const gm0 = JSON.parse(JSON.stringify(GRP_MODEL))
  respond = function (method, args) {
    if (method === 'doc:get') return fullDoc({ model: gm0, nodeCount: gm0.nodes.length })
    if (method === 'doc:set') { gSets.push(args.model); return fullDoc({ model: args.model, nodeCount: args.model.nodes.length, revision: 7, updatedBy: 'user' }) }
    return prevR(method, args)
  }
  const gHost = document.createElement('div')
  document.body.appendChild(gHost)
  const gRoot = createRoot(gHost)
  await act(async () => {
    // 换个会话：视角记忆按「会话|文档」存，上一个挂载把画布放大过
    gRoot.render(React.createElement(captured['conversation.view'], { cwd: UI, sessionId: 's-drag-grp', useSessions: () => UI }))
  })
  await flush()
  const gBox = gHost.querySelector('rect.ac-group-box')
  const gSvg = gHost.querySelector('svg.ac-svg')
  ok('前置：组框在（展开态）', !!gBox)
  // 组成员中心 = (0+100)/2 = 50；拖 396 → 圈心到 446，距 p1 的中心 450 差 4px → 吸上 → 位移变 400
  await act(async () => { gBox.dispatchEvent(new dom.window.PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 0, clientY: 0 })) })
  await flush()
  await act(async () => { gSvg.dispatchEvent(new dom.window.PointerEvent('pointermove', { bubbles: true, clientX: 396, clientY: 0 })) })
  await act(async () => { await new Promise((r) => dom.window.requestAnimationFrame(() => r())) })
  await act(async () => { gSvg.dispatchEvent(new dom.window.PointerEvent('pointerup', { bubbles: true, button: 0, clientX: 396, clientY: 0 })) })
  await flush()
  const gm = gSets[gSets.length - 1]
  eq('分组拖动也吸附：圈心吸到对端中心线（396 → 400）', gm && gm.nodes.find((n) => n.id === 'm1').x, 400)
  await act(async () => { gRoot.unmount() })
  gHost.remove()
  respond = prevR
}

console.log('\n[4x] 交互修复 A：未提交的草稿 / 中文输入法 / 写盘被拒后的画布')
{
  // 这三条都是「会弄丢用户写的东西」那一档，所以先做：
  //   1) 改到一半点了别的元素（或点空白、跳留言清单）→ 草稿必须**先提交再换选中**；
  //   2) 输入法组字过程中的 Enter / Esc 既不是「提交」也不是「退出」；
  //   3) 宿主拒绝写盘（saved:false）之后，画布必须跟着回滚到真相，而不是继续显示没存下去的东西。
  const X_MODEL = {
    nodes: [
      { id: 'x1', label: '甲', shape: 'rect', group: null, x: 0, y: 0, note: '旧留言' },
      { id: 'x2', label: '乙', shape: 'rect', group: null, x: 260, y: 0 },
    ],
    edges: [], groups: [], direction: 'TD', extras: [],
  }
  const X_MERMAID = 'flowchart TD\n  x1["甲"]\n  x2["乙"]\n'
  const prevR = respond
  let sets = []
  const m = JSON.parse(JSON.stringify(X_MODEL))
  respond = function (method, args) {
    if (method === 'doc:get') return fullDoc({ model: m, nodeCount: 2, mermaid: X_MERMAID })
    if (method === 'doc:set') {
      sets.push(JSON.parse(JSON.stringify(args.model)))
      return fullDoc({ model: args.model, nodeCount: args.model.nodes.length, mermaid: X_MERMAID, revision: 9, updatedBy: 'user' })
    }
    return prevR(method, args)
  }
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(React.createElement(captured['conversation.view'], { cwd: UI, sessionId: 's-fix-a', useSessions: () => UI }))
  })
  await flush()

  const nodeEl = (t) => Array.from(host.querySelectorAll('g.ac-node')).find((el) => (el.textContent || '').indexOf(t) >= 0)
  const titleInput = () => host.querySelector('input[placeholder="这个元素是什么"]')
  const noteArea = () => host.querySelector('textarea[placeholder^="例如：这里为什么不用队列"]')
  const undoBtn = () => Array.from(host.querySelectorAll('.ac-bar button')).find((b) => b.textContent.trim() === '↶')
  const valueSetter = (el) => {
    const proto = el.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype
    return Object.getOwnPropertyDescriptor(proto, 'value').set
  }
  const setField = async (el, v) => {
    await act(async () => {
      valueSetter(el).call(el, v)
      el.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
  }
  /**
   * 「在旧输入框里改到一半，然后去点别的元素」= 真浏览器里的这一步：
   *   pointerdown（我们的处理器同步重渲染，输入框的值已经换成新元素的草稿）
   *   → mousedown 的默认动作才把焦点移走 → blur。
   *
   * **`blur()` 这一下不能省**：jsdom 不实现「点非可聚焦元素时聚焦最近的可聚焦祖先」，
   * 所以不手动 blur 就永远走不到 onBlur —— 而线上唯一的自动提交路径正是 onBlur。
   * 两次 act 也必须分开：必须在 blur 之前让重渲染真的发生，否则测的是「还没来得及换草稿」的世界。
   */
  const downThenBlur = async (el, oldField) => {
    await act(async () => {
      el.dispatchEvent(new dom.window.PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 0, clientY: 0 }))
    })
    await flush()
    if (oldField) await act(async () => { oldField.blur() })
    await flush()
  }

  // ---- 1b) 负向对照：一个字都没改时点别的元素 ⇒ 一次 doc:set 都不发、撤销栈不动 ----
  await act(async () => { clickEl(nodeEl('甲'), 0, 0) })
  await flush()
  ok('前置：选中 x1 后检查器打开', !!titleInput())
  const undoBefore = !!undoBtn().disabled
  sets = []
  await downThenBlur(nodeEl('乙'), null)
  eq('没改任何东西 → 点别的元素不发 doc:set', sets.length, 0)
  eq('负向对照：撤销栈也没动（↶ 仍然禁用）', !!undoBtn().disabled, undoBefore)
  eq('负向对照：↶ 在什么都没改时确实是禁用的（不是恒真式）', undoBefore, true)

  // ---- 1a) 改到一半切元素：草稿必须先提交，再换选中 ----
  // 先点「乙」再点「甲」：点同一个元素两次是「收起」（面板一收，下面的断言就没得测了）。
  await act(async () => { clickEl(nodeEl('乙'), 0, 0) })
  await flush()
  await act(async () => { clickEl(nodeEl('甲'), 0, 0) })
  await flush()
  const ti = titleInput(), na = noteArea()
  ok('前置：标题框与留言框都在', !!ti && !!na)
  await setField(ti, '甲改过的标题')
  await setField(na, '这条留言是新写的')
  sets = []
  await downThenBlur(nodeEl('乙'), ti)
  ok('切元素时把未提交的草稿发出去了（doc:set ≥ 1）', sets.length >= 1, sets.length)
  const last = sets[sets.length - 1] || { nodes: [] }
  const x1 = last.nodes.find((n) => n.id === 'x1') || {}
  eq('提交的 model 里 x1 的标题是新值', x1.label, '甲改过的标题')
  eq('提交的 model 里 x1 的留言也是新值', x1.note, '这条留言是新写的')
  const x2 = last.nodes.find((n) => n.id === 'x2') || {}
  eq('负向对照：x2 一个字都没被改（没有把 B 的草稿写进 A 或反过来）', x2.label, '乙')
  eq('提交之后撤销栈真的动了（↶ 可用）—— 所以上面那条「仍然禁用」不是空转', !!undoBtn().disabled, false)

  // 变体：**不**手动 blur。提交不许依赖「浏览器恰好会 blur」这件事。
  await setField(titleInput(), '又改了一次')
  sets = []
  await act(async () => {
    nodeEl('甲').dispatchEvent(new dom.window.PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 0, clientY: 0 }))
  })
  await flush()
  ok('不手动 blur 也一样提交（flushDrafts 自己就够了）', sets.length >= 1, sets.length)

  // ---- 2) 中文输入法：组字过程中的 Enter / Esc 都不是「提交」/「退出」 ----
  // 上一条结束时选中已经是「甲」、面板也开着，这里再按一下同一个节点只是把草稿重置成
  // 模型里的值。**不能**用 clickEl 补一次「完整点选」：同一个元素再点一次 = 收起面板，
  // 一收，下面要用的那几个输入框就都没了。
  await act(async () => {
    nodeEl('甲').dispatchEvent(new dom.window.PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 0, clientY: 0 }))
  })
  await flush()
  await act(async () => { titleInput().focus() })
  const ti2 = titleInput()
  eq('前置：焦点在标题框里', document.activeElement === ti2, true)
  await setField(ti2, '组字中的标题')
  sets = []
  await act(async () => {
    ti2.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }))
  })
  await flush()
  eq('组字时按 Enter 不提交（doc:set 0 次）', sets.length, 0)
  eq('组字时按 Enter 连值都不动', ti2.value, '组字中的标题')
  // 负向对照：普通 Enter 与今天完全一样 —— 提交一次，带的是新值
  await act(async () => {
    ti2.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })
  await flush()
  eq('负向对照：普通 Enter 仍然提交一次', sets.length, 1)
  eq('提交的是刚打的值', (sets[0].nodes.find((n) => n.id === 'x1') || {}).label, '组字中的标题')

  // Esc：组字中那一下是「取消这次组字」，焦点不许被踢出输入框
  await act(async () => { titleInput().focus() })
  eq('前置：焦点又回到标题框里', document.activeElement === titleInput(), true)
  await act(async () => {
    titleInput().dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true }))
  })
  await flush()
  ok('组字时按 Esc：焦点仍然留在输入框里（没有被踢出去）', document.activeElement === titleInput(),
    document.activeElement && document.activeElement.tagName)
  // 负向对照：普通 Esc 仍然只把焦点移进面板根（[4o] 的行为逐字不变）
  await act(async () => {
    titleInput().dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })
  await flush()
  ok('负向对照：普通 Esc 仍然把焦点移出输入框（移进面板根）', document.activeElement !== titleInput(),
    document.activeElement && document.activeElement.className)
  ok('而且焦点落在面板根上（第二下 Esc 还收得到）',
    document.activeElement === host.querySelector('.ac-root'),
    document.activeElement && document.activeElement.className)

  await act(async () => { root.unmount() })
  host.remove()

  // ---- 3) 宿主拒绝写盘（saved:false）：画布必须跟着回滚 ----
  const ROLLED = {
    nodes: [{ id: 'r1', label: '回滚后的', shape: 'rect', group: null, x: 0, y: 0 }],
    edges: [], groups: [], direction: 'TD', extras: [],
  }
  const ROLL_MERMAID = 'flowchart TD\n  r1["回滚后的"]\n'
  let savedFlag = false
  let rollSets = 0
  let rollSent = null
  respond = function (method, args) {
    if (method === 'doc:get') return fullDoc({ model: JSON.parse(JSON.stringify(ROLLED)), nodeCount: 1, mermaid: ROLL_MERMAID })
    if (method === 'doc:set') {
      rollSets++
      rollSent = JSON.parse(JSON.stringify(args.model))
      if (savedFlag) {
        // 成功那一档刻意回一份**不同**的模型：客户端要是照它重画，画布上就会冒出这个幽灵节点。
        // 「saved:true 不重画」这条负向对照因此有牙 —— 不是靠自己跟自己比。
        const ghost = args.model.nodes.concat([{ id: 'ghost', label: '幽灵节点', shape: 'rect', group: null, x: 0, y: 400 }])
        return fullDoc({ model: { nodes: ghost, edges: [], groups: [], direction: 'TD', extras: [] }, nodeCount: ghost.length, mermaid: ROLL_MERMAID, revision: 2, updatedBy: 'user' })
      }
      // 失败那一档照着宿主的真实回执来：model 是**回滚后**的那一份，warnings 里带原因，
      // revision **没有前进**（宿主 restoreModel 把版本三件套一起还原了）。
      return fullDoc({
        model: JSON.parse(JSON.stringify(ROLLED)), nodeCount: 1, mermaid: ROLL_MERMAID,
        revision: 1, updatedBy: 'switch', saved: false,
        warnings: ['保存失败，本次改动已回滚: cannot write /x/y.mmd: file access denied under workspace-write mode'],
      })
    }
    return prevR(method, args)
  }
  const rHost = document.createElement('div')
  document.body.appendChild(rHost)
  const rRoot = createRoot(rHost)
  await act(async () => {
    rRoot.render(React.createElement(captured['conversation.view'], { cwd: UI, sessionId: 's-fix-roll', useSessions: () => UI }))
  })
  await flush()
  const rTitle = () => rHost.querySelector('input[placeholder="这个元素是什么"]')
  const canvasLabels = () => Array.from(rHost.querySelectorAll('g.ac-node .ac-lbl')).map((t) => t.textContent)

  await act(async () => { clickEl(Array.from(rHost.querySelectorAll('g.ac-node'))[0], 0, 0) })
  await flush()
  const shapeSel = () => rHost.querySelector('.ac-dock select.ac-select')
  const shapeTag = () => {
    const el = rHost.querySelector('g.ac-node .ac-shape')
    return el ? el.tagName.toLowerCase() : ''
  }
  ok('前置：检查器开着（形状下拉框在）', !!shapeSel())
  eq('前置：现在是 rect', shapeSel() && shapeSel().value, 'rect')
  const setSelect = async (el, v) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value').set.call(el, v)
      el.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
    })
  }
  rollSets = 0
  await setSelect(shapeSel(), 'diamond')
  await flush()
  eq('前置：确实发了一次 doc:set', rollSets, 1)
  eq('前置：客户端把 shape=diamond 发出去了（「回到 rect」才是真回滚，不是空转）',
    rollSent && rollSent.nodes[0] && rollSent.nodes[0].shape, 'diamond')
  eq('画布跟着宿主回执重画（下拉框回到回滚后的值）', shapeSel() && shapeSel().value, 'rect')
  eq('画布上的方块也回到矩形（真的按回执重画了）', shapeTag(), 'rect')
  const failBox = rHost.querySelector('.ac-warn.ac-savefail')
  ok('画布页出现「没有存下去 / 已回滚」横幅', !!failBox)
  ok('横幅里写着回滚的原因', !!failBox && failBox.textContent.indexOf('已回滚') >= 0 && failBox.textContent.indexOf('file access denied') >= 0,
    failBox && failBox.textContent)
  ok('状态栏明说「没有存下去」', rHost.querySelector('.ac-statusbar').textContent.indexOf('没有存下去') >= 0,
    rHost.querySelector('.ac-statusbar').textContent)
  // 修订号没前进 = 2.5s 轮询判定「没变化」⇒ 永远不会自我纠正。这正是修复必须落在客户端的原因。
  ok('失败那次没有推进修订号（所以轮询救不了，只能在这里纠正）',
    rHost.querySelector('.ac-statusbar').textContent.indexOf('r1') >= 0,
    rHost.querySelector('.ac-statusbar').textContent)
  // 源码页与画布页不能互相矛盾
  await act(async () => {
    Array.from(rHost.querySelectorAll('.ac-tabs button')).find((b) => b.textContent.trim() === '源码').click()
  })
  await flush()
  const srcArea = rHost.querySelector('textarea.ac-area')
  eq('源码页也是回滚后的文本（两页不再互相矛盾）', srcArea && srcArea.value, ROLL_MERMAID)
  await act(async () => {
    Array.from(rHost.querySelectorAll('.ac-tabs button')).find((b) => b.textContent.trim() === '画布').click()
  })
  await flush()

  // ---- 3b) 负向对照：saved:true ⇒ 不重画、不出横幅、修订号照常前进 ----
  await act(async () => { rRoot.unmount() })
  savedFlag = true
  const okRoot = createRoot(rHost)
  await act(async () => {
    okRoot.render(React.createElement(captured['conversation.view'], { cwd: UI, sessionId: 's-fix-ok', useSessions: () => UI }))
  })
  await flush()
  await act(async () => { clickEl(Array.from(rHost.querySelectorAll('g.ac-node'))[0], 0, 0) })
  await flush()
  await setField(rTitle(), '这一笔存下去了')
  await act(async () => {
    rTitle().dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })
  await flush()
  eq('负向对照：写盘成功时不出「已回滚」横幅', rHost.querySelectorAll('.ac-warn.ac-savefail').length, 0)
  ok('负向对照：写盘成功时不拿宿主的模型重画（幽灵节点没有出现）', canvasLabels().indexOf('幽灵节点') < 0, canvasLabels())
  eq('负向对照：客户端保留自己那份（刚打的值）', rTitle() && rTitle().value, '这一笔存下去了')
  ok('负向对照：状态栏仍然是「已同步给 AI」', rHost.querySelector('.ac-statusbar').textContent.indexOf('已同步给 AI') >= 0,
    rHost.querySelector('.ac-statusbar').textContent)
  await act(async () => { okRoot.unmount() })
  rHost.remove()
  respond = prevR
}

console.log('\n[4y] 交互修复 B：连线提示 / 光标 / 滚轮语义 / 解析警告上画布 / 帮助浮层')
{
  const prevR = respond
  const Y_MODEL = {
    nodes: [
      { id: 'y1', label: '一', shape: 'rect', group: null, x: 0, y: 0 },
      { id: 'y2', label: '二', shape: 'rect', group: null, x: 400, y: 0 },
    ],
    edges: [], groups: [], direction: 'TD', extras: [],
  }
  const yStub = function (method, args) {
    if (method === 'doc:get') return fullDoc({ model: JSON.parse(JSON.stringify(Y_MODEL)), nodeCount: 2, mermaid: 'flowchart TD\n  y1["一"]\n  y2["二"]\n' })
    return prevR(method, args)
  }
  // 先来一版**空画布**：起始页的提示文案（「怎么建一条边」）在这一节里验。
  respond = function (method, args) {
    if (method === 'doc:get') return fullDoc({ model: { nodes: [], edges: [], groups: [], direction: 'TD', extras: [] } })
    return prevR(method, args)
  }
  const eHost = document.createElement('div')
  document.body.appendChild(eHost)
  const eRoot = createRoot(eHost)
  await act(async () => {
    eRoot.render(React.createElement(captured['conversation.view'], { cwd: UI, sessionId: 's-fix-y0', useSessions: () => UI }))
  })
  await flush()
  const startHints = Array.from(eHost.querySelectorAll('.ac-start .ac-hint')).map((d) => d.textContent)
  ok('起始页（还没选中任何东西）就说清了怎么建一条边',
    startHints.some((t) => t.indexOf('连线') >= 0 && t.indexOf('圆点') >= 0), startHints)
  await act(async () => { eRoot.unmount() })
  eHost.remove()
  respond = yStub

  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(React.createElement(captured['conversation.view'], { cwd: UI, sessionId: 's-fix-y', useSessions: () => UI }))
  })
  await flush()

  const svgEl = host.querySelector('svg.ac-svg')
  const stageEl = host.querySelector('.ac-stage')
  const nodes = () => Array.from(host.querySelectorAll('g.ac-node'))
  // jsdom 不做排版：getBoundingClientRect 全是 0，而 fitView 有 `rect.width < 60 就不干` 的守卫，
  // 不把尺寸打桩，「适应窗口」在这个环境里永远不会生效（测的就是一条死路）。
  Object.defineProperty(stageEl, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0 }),
  })

  // ---- 4) 「怎么建一条边」必须说出来 ----
  // 负向对照：有节点、但**什么都没选中**时不许画手柄（2266 行那个 isSel 条件）
  eq('负向对照：没选中任何东西时画布上不画手柄', host.querySelectorAll('.ac-handle').length, 0)
  await act(async () => { clickEl(nodes()[0], 0, 0) })
  await flush()
  const handle = host.querySelector('.ac-handle')
  ok('选中之后画布上出现连线手柄', !!handle)
  const handleTitle = handle && handle.querySelector('title')
  ok('手柄上挂了说明（不再是「一个没人解释的小圆点」）', !!handleTitle && handleTitle.textContent.length > 0,
    handleTitle && handleTitle.textContent)
  ok('手柄说明里点名了「连线」', !!handleTitle && handleTitle.textContent.indexOf('连线') >= 0,
    handleTitle && handleTitle.textContent)

  // ---- 5) 光标与悬停反馈 ----
  const ruleOf = (sel) => {
    const i = insertedCss.indexOf(sel + '{')
    return i < 0 ? '' : insertedCss.slice(i + sel.length + 1, insertedCss.indexOf('}', i))
  }
  ok('可拖的节点给的是 move（不是骗人的 pointer 手型）', ruleOf('.ac-node').indexOf('cursor:move') >= 0, ruleOf('.ac-node'))
  ok('细线命中区有悬停反馈（平时透明，扫过才现形）',
    ruleOf('.ac-edge-hit:hover').indexOf('stroke-opacity:.35') >= 0, ruleOf('.ac-edge-hit:hover'))
  // 负向对照：命中区宽度**不许动**（实测 14px 是「细线点得中」的全部依据）
  ok('负向对照：.ac-edge-hit 的 stroke-width:14 一个字都没动',
    ruleOf('.ac-edge-hit').indexOf('stroke-width:14') >= 0 && ruleOf('.ac-edge-hit:hover').indexOf('stroke-width') < 0,
    { base: ruleOf('.ac-edge-hit'), hover: ruleOf('.ac-edge-hit:hover') })
  ok('拖动期间的光标有地方落（.ac-svg.dragging）', ruleOf('.ac-svg.dragging').indexOf('cursor:grabbing') >= 0,
    ruleOf('.ac-svg.dragging'))
  // 注意用**第二个**节点做这件事：点第一个节点会走「同一个元素再点一次 = 收起」，
  // 面板一收，后面那几条要用标题框的断言就没得测了。
  await act(async () => {
    nodes()[1].dispatchEvent(new dom.window.PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 0, clientY: 0 }))
  })
  await flush()
  ok('按下去的那一刻画布挂上 .dragging（光标这才变成「抓着」）', svgEl.classList.contains('dragging'), svgEl.getAttribute('class'))
  await act(async () => {
    svgEl.dispatchEvent(new dom.window.PointerEvent('pointerup', { bubbles: true, button: 0, clientX: 0, clientY: 0 }))
  })
  await flush()
  ok('抬手之后 .dragging 摘掉', !svgEl.classList.contains('dragging'), svgEl.getAttribute('class'))

  // ---- 6) 滚轮语义的**纯增量**补齐 ----
  const worldT = () => {
    const w = host.querySelector('g.ac-world')
    return w ? w.getAttribute('transform') : ''
  }
  const tNum = (i) => Number((/translate\((-?[\d.]+),(-?[\d.]+)\)/.exec(worldT()) || [])[i])
  const tK = () => Number((/scale\(([\d.]+)\)/.exec(worldT()) || [])[1])
  const zoomText = () => (host.querySelector('.ac-zoom') || {}).textContent
  const wheel = async (extra) => {
    await act(async () => {
      stageEl.dispatchEvent(new dom.window.WheelEvent('wheel', Object.assign({ bubbles: true, cancelable: true, clientX: 0, clientY: 0, deltaY: 0 }, extra)))
    })
    await flush()
  }
  const k0 = tK()
  ok('状态栏有缩放比例（形如 100%）', /^\d+%$/.test(String(zoomText())), zoomText())
  const zoom0 = zoomText()
  await wheel({ deltaY: -100 })
  ok('负向对照（今天的行为逐字不变）：普通滚轮仍然是缩放', tK() > k0, { before: k0, after: tK() })
  ok('缩放比例跟着更新', zoomText() !== zoom0, { before: zoom0, after: zoomText() })
  const kPlain = tK()
  await wheel({ deltaY: -100, ctrlKey: true })
  ok('Ctrl+滚轮走缩放（与普通滚轮同一条公式）', tK() > kPlain, { before: kPlain, after: tK() })
  const kBeforeShift = tK(), xBeforeShift = tNum(1), yBeforeShift = tNum(2)
  await wheel({ deltaY: 50, shiftKey: true })
  eq('Shift+滚轮：缩放不变', tK(), kBeforeShift)
  eq('Shift+滚轮：view.x 按 deltaY 横移', tNum(1), xBeforeShift - 50)
  eq('Shift+滚轮：view.y 不动', tNum(2), yBeforeShift)
  // 中键拖动 = 平移（k 不变、x/y 跟着鼠标）
  const mk = tK(), mx = tNum(1), my = tNum(2)
  await act(async () => {
    svgEl.dispatchEvent(new dom.window.PointerEvent('pointerdown', { bubbles: true, button: 1, clientX: 100, clientY: 60 }))
  })
  await flush()
  await act(async () => {
    svgEl.dispatchEvent(new dom.window.PointerEvent('pointermove', { bubbles: true, clientX: 140, clientY: 90 }))
  })
  await act(async () => { await new Promise((r) => dom.window.requestAnimationFrame(() => r())) })
  await act(async () => {
    svgEl.dispatchEvent(new dom.window.PointerEvent('pointerup', { bubbles: true, button: 1, clientX: 140, clientY: 90 }))
  })
  await flush()
  eq('中键拖动：k 不变', tK(), mk)
  eq('中键拖动：view.x 跟着鼠标走', tNum(1), mx + 40)
  eq('中键拖动：view.y 跟着鼠标走', tNum(2), my + 30)
  // 中键「点一下」不该顺手清掉你在看的东西（它从来就是「我要挪视角」）
  await act(async () => {
    svgEl.dispatchEvent(new dom.window.PointerEvent('pointerdown', { bubbles: true, button: 1, clientX: 300, clientY: 200 }))
  })
  await flush()
  await act(async () => {
    svgEl.dispatchEvent(new dom.window.PointerEvent('pointerup', { bubbles: true, button: 1, clientX: 300, clientY: 200 }))
  })
  await flush()
  ok('中键点一下不清选中（没有位移也不是左键那一下「点空白」）', !!host.querySelector('g.ac-node.sel'))

  // ---- 8) F / Ctrl+0 = 适应窗口 ----
  const rootEl = host.querySelector('.ac-root')
  for (let i = 0; i < 3; i++) await wheel({ deltaY: 100 })   // 先缩出去，免得撞上 fit 出来的 1.4
  const kZoom = tK()
  await act(async () => {
    rootEl.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'f', bubbles: true }))
  })
  await flush()
  ok('按 F 就把视角改了（适应窗口）', tK() !== kZoom, { before: kZoom, after: tK() })
  ok('状态栏如实说「已适应窗口」', host.querySelector('.ac-statusbar').textContent.indexOf('已适应窗口') >= 0,
    host.querySelector('.ac-statusbar').textContent)
  // 负向对照：在输入框里打一个 f 不该重新适应窗口（它就只是字母 f）
  await act(async () => { host.querySelector('input[placeholder="这个元素是什么"]').focus() })
  const kInField = tK()
  await wheel({ deltaY: -100 })
  const kInField2 = tK()
  await act(async () => {
    host.querySelector('input[placeholder="这个元素是什么"]').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'f', bubbles: true }))
  })
  await flush()
  eq('负向对照：焦点在输入框里时 F 不生效（k 一点没变）', tK(), kInField2)
  ok('前置：为了这条对照确实先改了 k（不是恒真式）', kInField2 !== kInField)
  // Ctrl+0 也走同一条「适应窗口」；它和 Ctrl+Z 一样要求「刚在面板里点过」
  await act(async () => { clickEl(nodes()[0], 0, 0) })
  await flush()
  // jsdom 不实现 mousedown 的默认动作（把焦点从输入框移走），所以上一步 `.focus()` 过的
  // 输入框还占着 activeElement，而「焦点在输入框里就什么快捷键都不管」这条守卫会把它挡掉。
  // 真浏览器里点一下画布焦点就离开输入框了 —— 这一句是在补上那一步，不是绕开守卫。
  await act(async () => {
    const ae = document.activeElement
    if (ae && typeof ae.blur === 'function') ae.blur()
  })
  for (let i = 0; i < 3; i++) await wheel({ deltaY: 100 })
  const kZoom2 = tK()
  await act(async () => {
    rootEl.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: '0', ctrlKey: true, bubbles: true }))
  })
  await flush()
  ok('Ctrl+0 也是适应窗口', tK() !== kZoom2, { before: kZoom2, after: tK() })

  // ---- 8b) 「?」静态清单：隐藏手势从前一个都没告知 ----
  eq('负向对照：没点之前浮层不在 DOM 里', host.querySelectorAll('.ac-help').length, 0)
  await act(async () => { host.querySelector('button.ac-helpbtn').click() })
  await flush()
  const help = host.querySelector('.ac-help')
  ok('点 ? 弹出快捷键清单', !!help)
  const helpText = help ? help.textContent : ''
  ok('清单里有「Alt」（临时关吸附）', helpText.indexOf('Alt') >= 0, helpText)
  ok('清单里有「Shift+方向键」（10px 微调）', helpText.indexOf('Shift+方向键') >= 0, helpText)
  ok('清单里有「Ctrl/Cmd+Z」', helpText.indexOf('Ctrl/Cmd+Z') >= 0, helpText)
  ok('清单里点明了「Ctrl+Z 要先在面板里点过」这条容易当成 bug 的规矩',
    helpText.indexOf('pointerdown') >= 0 && helpText.indexOf('面板') >= 0, helpText)
  await act(async () => { host.querySelector('button.ac-helpbtn').click() })
  await flush()
  eq('再点一下收起', host.querySelectorAll('.ac-help').length, 0)

  await act(async () => { root.unmount() })
  host.remove()

  // ---- 7) 解析警告不再只住在源码页 ----
  const prevR3 = respond
  const wHost = document.createElement('div')
  document.body.appendChild(wHost)
  const wRoot = createRoot(wHost)
  respond = function (method, args) {
    if (method === 'doc:get') {
      return fullDoc({
        model: JSON.parse(JSON.stringify(Y_MODEL)), nodeCount: 2,
        mermaid: 'flowchart TD\n  y1["一"]\n',
        warnings: ['第 3 行：没认出来的写法，已跳过'],
      })
    }
    return prevR3(method, args)
  }
  await act(async () => {
    wRoot.render(React.createElement(captured['conversation.view'], { cwd: UI, sessionId: 's-fix-warn', useSessions: () => UI }))
  })
  await flush()
  const wBox = wHost.querySelector('.ac-warn')
  const wHead = wHost.querySelector('.ac-warn .ac-warn-h')
  ok('画布页出现了「解析警告」那一块（从前它只在源码页）', !!wBox && !!wHead, wHost.querySelector('.ac-warn-h') && wHost.querySelector('.ac-warn-h').textContent)
  ok('标题写着条数', !!wHead && wHead.textContent.indexOf('解析警告 1 条') >= 0, wHead && wHead.textContent)
  ok('警告正文也在', !!wBox && wBox.textContent.indexOf('没认出来的写法') >= 0, wBox && wBox.textContent)
  await act(async () => { wRoot.unmount() })

  // 负向对照：没有解析警告时画布页不出这一块，而且保鲜横幅（另一码事）不受影响
  respond = function (method, args) {
    if (method === 'doc:get') {
      return fullDoc({
        model: JSON.parse(JSON.stringify(Y_MODEL)), nodeCount: 2, key: 'warn/x', diagram: 'warn/x',
        mermaid: 'flowchart TD\n', warnings: [],
        drift: { stale: [{ node: 'y1', ref: 'src/a.ts' }], uncovered: [], files: 3, baseline: true, truncated: false, checkedAt: 1, external: false },
      })
    }
    return prevR3(method, args)
  }
  const wRoot2 = createRoot(wHost)
  await act(async () => {
    wRoot2.render(React.createElement(captured['conversation.view'], { cwd: UI, sessionId: 's-fix-warn2', useSessions: () => UI }))
  })
  await flush()
  eq('负向对照：warnings 为空时画布页不出现「解析警告」', wHost.querySelectorAll('.ac-warn').length, 0)
  ok('负向对照：保鲜横幅照旧（两件事不互相顶掉）', !!wHost.querySelector('.ac-drift') && !wHost.querySelector('.ac-drift.hint'),
    wHost.querySelector('.ac-drift') && wHost.querySelector('.ac-drift').getAttribute('class'))
  await act(async () => { wRoot2.unmount() })
  wHost.remove()
  respond = prevR
}

endPhase()
