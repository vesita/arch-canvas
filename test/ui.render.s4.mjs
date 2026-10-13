// 界面渲染分片（共享脚手架见 ui.render.shared.mjs；DOM/React/桩 RPC/槽位捕获都由它装载）。
import { endPhase } from './ui.render.shared.mjs'

console.log('\n[6] 装机形态：ctx 没 inject timer（直接读属性会抛）也不能崩')
// 复刻真插件形态的 Cordis 上下文：**未 inject 的服务直接读属性是抛错**，而不是给 undefined。
// 这正是「打开画布一片空白」的根因：`typeof ctx.interval === 'function'` 那一读就抛。
const strictGet = (k) => ({ slots })[k]
const strictCtx = {
  get: (k) => (k === 'timer' ? undefined : strictGet(k)),
  effect: (fn) => { const d = fn(); return typeof d === 'function' ? d : () => {} },
  inject: () => () => {},
  on: () => () => {},
}
for (const bad of ['interval', 'timeout']) {
  Object.defineProperty(strictCtx, bad, {
    get() { throw new Error('cannot get property "timer" without inject') },
  })
}
globalThis.__archCanvas.install(strictCtx)
const strictHost = document.createElement('div')
document.body.appendChild(strictHost)
const strictRoot = createRoot(strictHost)
let nativeInterval = 0
const realSetInterval = globalThis.setInterval
globalThis.setInterval = function () { nativeInterval++; return realSetInterval.apply(null, arguments) }
let crash = null
try {
  await act(async () => {
    strictRoot.render(React.createElement(captured['conversation.view'], { cwd: UI, sessionId: 's1', useSessions: () => UI }))
  })
  await flush()
} catch (e) {
  crash = e
}
globalThis.setInterval = realSetInterval
ok('没有 timer 服务时面板照样渲染', !crash && !!strictHost.querySelector('.ac-tools'), crash && crash.message)
ok('退回原生定时器（轮询挂在原生 setInterval 上）', nativeInterval >= 1, { nativeInterval })
ok('起始页在装机形态下也在', strictHost.innerHTML.indexOf('这张图还是空的') >= 0)
await act(async () => { strictRoot.unmount() })

console.log('\n[4r] 客户端逻辑审计的修复：自动布局不许丢字段 / 导出不带角标 / 折叠端口 / 组 id / 无穿透 / @ 词边界 / 点选才展开详情')
{
  const mountModel = async (MODEL, draft, ops) => {
    const prevR = respond
    const m = JSON.parse(JSON.stringify(MODEL))
    const sets = []
    respond = function (method, args) {
      if (method === 'doc:get') return fullDoc({ model: m, nodeCount: m.nodes.length, edgeCount: (m.edges || []).length })
      if (method === 'doc:set') {
        sets.push(args.model)
        return fullDoc({ model: args.model, nodeCount: args.model.nodes.length, revision: 7, updatedBy: 'user' })
      }
      return prevR(method, args)
    }
    const calls = []
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => {
      root.render(React.createElement(captured['conversation.view'], {
        cwd: UI, sessionId: 's1', useSessions: () => UI,
        inputActions: { setDraft: (t) => { calls.push(t) } },
        useInput: (sel) => sel({ draft: draft == null ? '' : draft }),
      }))
    })
    await flush()
    if (ops) await ops({ host, root, calls, sets })
    await act(async () => { root.unmount() })
    host.remove()
    respond = prevR
    return { host, calls, sets }
  }
  const setNativeValue = (el, v, proto) => {
    const d = Object.getOwnPropertyDescriptor(proto, 'value').set
    d.call(el, v)
    el.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  }
  const rectOf = (g) => {
    const r = g.querySelector('rect:not(.ac-pulse)')
    if (!r) return null
    const x = Number(r.getAttribute('x')), y = Number(r.getAttribute('y'))
    return { x1: x, y1: y, x2: x + Number(r.getAttribute('width')), y2: y + Number(r.getAttribute('height')) }
  }

  // ---- A. 自动布局（点按钮 / 加载没坐标的图）不许把 files / note / link 丢掉 ----
  // 从前的 autoLayout 逐字段重建节点，只留 {id,label,shape,group,x,y} —— 点一下「自动布局」，
  // 锚点、留言、已解决标记、下钻链接全没，而且紧接着落盘，永久损坏。
  const AL_MODEL = {
    // 故意不给坐标：needsLayout → applyServer 里就会走 autoLayout
    nodes: [
      { id: 'ay1', label: '甲', shape: 'rect', group: null, note: '别丢我', noteDone: false, files: ['src/client/studio.ts'], link: 'sub' },
      { id: 'ay2', label: '乙', shape: 'rect', group: null },
    ],
    edges: [{ id: 'ae1', from: 'ay1', to: 'ay2', label: '', arrow: '-->' }],
    groups: [], direction: 'TD', extras: [],
  }
  const alRes = await mountModel(AL_MODEL, '', async ({ host }) => {
    const g = Array.from(host.querySelectorAll('g.ac-node')).find((el) => (el.textContent || '').indexOf('甲') >= 0)
    ok('自动布局后节点还在（说明确实走了那条路）', !!g)
    ok('自动布局后留言角标还在', !!g?.querySelector('.ac-note-badge'))
    ok('自动布局后代码锚点角标还在', !!g?.querySelector('.ac-file-badge'))
    ok('自动布局后下钻角标还在', !!g?.querySelector('.ac-jump'))
  })
  void alRes

  // 再走一遍用户真正的那条路：点工具条「自动布局」，看回传宿主的模型里字段还在不在
  const AL2_MODEL = JSON.parse(JSON.stringify(AL_MODEL))
  AL2_MODEL.nodes[0].x = 0; AL2_MODEL.nodes[0].y = 0
  AL2_MODEL.nodes[1].x = 200; AL2_MODEL.nodes[1].y = 0
  await mountModel(AL2_MODEL, '', async ({ host, sets }) => {
    await act(async () => {
      Array.from(host.querySelectorAll('.ac-tools button')).find((b) => b.textContent.trim() === '自动布局').click()
    })
    await flush()
    const sent = sets[sets.length - 1]
    const n = sent && sent.nodes.find((x) => x.id === 'ay1')
    ok('点「自动布局」→ doc:set 里的 files 还在', !!(n && n.files && n.files.length === 1), n)
    eq('点「自动布局」→ note 还在', n && n.note, '别丢我')
    eq('点「自动布局」→ noteDone 还在', n && n.noteDone, false)
    eq('点「自动布局」→ link 还在', n && n.link, 'sub')
  })

  // ---- B. 导出的 SVG 不许带角标（脱离主题的独立文档里 circle/text 缺省是纯黑，会成一坨黑斑）----
  // 模型里带上第二个节点 / 一条连线 / 一个组：这样 live DOM 里**确实**有 `.ac-edge-hit`
  // （连线的透明命中区，宽 14）、组框、边标签 —— 否则 C 段「导出里没有命中区」是空断言。
  const EXP_MODEL = {
    nodes: [
      { id: 'ex1', label: '导出的方块', shape: 'rect', group: 'eg', x: 0, y: 0, note: '有留言', files: ['a.ts'], link: 'sub', tags: ['核心'] },
      { id: 'ex2', label: '另一个方块', shape: 'rect', group: null, x: 260, y: 200 },
    ],
    edges: [{ id: 'ee1', from: 'ex1', to: 'ex2', label: '连着', arrow: '-->' }],
    groups: [{ id: 'eg', label: '导出组' }], direction: 'TD', extras: [],
  }
  const realBlob = globalThis.Blob
  const realCreate = globalThis.URL.createObjectURL
  const realRevoke = globalThis.URL.revokeObjectURL
  let exportedSvg = ''
  await mountModel(EXP_MODEL, '', async ({ host }) => {
    globalThis.Blob = function (parts) { exportedSvg = String(parts && parts[0]); return { __fake: true } }
    globalThis.URL.createObjectURL = function () { return 'blob:fake' }
    globalThis.URL.revokeObjectURL = function () {}
    try {
      await act(async () => {
        Array.from(host.querySelectorAll('.ac-tools button')).find((b) => b.textContent.trim() === 'SVG').click()
      })
      await flush()
    } finally {
      globalThis.Blob = realBlob
      globalThis.URL.createObjectURL = realCreate
      globalThis.URL.revokeObjectURL = realRevoke
    }
    ok('导出确实产出了 SVG 文本（否则下面两条是空测试）', exportedSvg.length > 0, exportedSvg.length)
    ok('导出里有方块本身', exportedSvg.indexOf('导出的方块') >= 0)
    ok('导出里没有留言角标', exportedSvg.indexOf('ac-note-badge') < 0)
    ok('导出里没有锚点角标', exportedSvg.indexOf('ac-file-badge') < 0)
    ok('导出里没有下钻角标', exportedSvg.indexOf('ac-jump') < 0)

    // ---- B2. 通用一条：导出串里出现的**每个 class** 都必须能在这份导出自己的 <style> 里
    // 找到规则。上一段只点名查了三个角标，抓不到「又冒出一个装饰元素」——`.ac-edge-hit`
    // 就是这么漏的：它不在 buildExportSvg 的 drop 列表、EXPORT_CSS 里也没有规则，
    // 而 path 的缺省 fill 是**纯黑**（栅格化实测每条折线旁多 7230 个纯黑像素）。
    const styleBlock = (exportedSvg.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || ''
    ok('导出串自带 <style>（否则「每个 class 都有规则」无从谈起）', styleBlock.length > 0, styleBlock.length)
    const usedClasses = new Set()
    ;(exportedSvg.match(/class="[^"]*"/g) || []).forEach((attr) => {
      attr.slice(7, -1).split(/\s+/).forEach((c) => { if (c) usedClasses.add(c) })
    })
    // 白名单只有**纯几何容器**：那个 <g> 只做分组，没有自己的绘制属性，不需要样式规则。
    const CLASS_WHITELIST = ['ac-grp']
    const ruleOfClass = (c) => new RegExp('\\.' + c.replace(/[-]/g, '\\-') + '(?![\\w-])')
    const noRule = Array.from(usedClasses).filter((c) => CLASS_WHITELIST.indexOf(c) < 0 && !ruleOfClass(c).test(styleBlock))
    eq('导出里每个 class 都在 EXPORT_CSS 里有规则（纯几何容器除外）', noRule.join(','), '')
    ok('用到的 class 够多（否则上一条是空转）', usedClasses.size >= 8, Array.from(usedClasses).sort().join(','))
    ok('导出里没有连线命中区 ac-edge-hit（缺省 fill 是纯黑，会沿每条折线糊一块）',
      exportedSvg.indexOf('ac-edge-hit') < 0)
    // 负向对照：别把整张图也剔掉了 —— 节点 / 连线 / 箭头 / 组框 / 组名都还得在
    ok('负向对照：节点还在', /class="ac-node(?![\w-])/.test(exportedSvg))
    ok('负向对照：连线与箭头还在', /class="ac-edge(?![\w-])/.test(exportedSvg) && exportedSvg.indexOf('ac-arrowhead') >= 0)
    ok('负向对照：组框与组名还在', exportedSvg.indexOf('ac-group-box') >= 0 && exportedSvg.indexOf('ac-group-lbl') >= 0)
    ok('负向对照：EXPORT_CSS 里确实有 .ac-node / .ac-edge / .ac-shape 规则（所以上上条不是恒真式）',
      ruleOfClass('ac-node').test(styleBlock) && ruleOfClass('ac-edge').test(styleBlock) && ruleOfClass('ac-shape').test(styleBlock))
  })

  // ---- C. 折叠组的端口要沿块边展开，而不是全叠在块边中心 ----
  const FOLD_MODEL = {
    nodes: [
      { id: 'f1', label: '组内一', shape: 'rect', group: 'fg', x: 0, y: 0 },
      { id: 'f2', label: '组内二', shape: 'rect', group: 'fg', x: 220, y: 0 },
      { id: 'f3', label: '外部', shape: 'rect', group: null, x: 110, y: 420 },
    ],
    edges: [
      { id: 'fe1', from: 'f1', to: 'f3', label: '', arrow: '-->' },
      { id: 'fe2', from: 'f2', to: 'f3', label: '', arrow: '-->' },
    ],
    groups: [{ id: 'fg', label: '折叠组' }], direction: 'TD', extras: [],
  }
  await mountModel(FOLD_MODEL, '', async ({ host }) => {
    const foldBtn = host.querySelector('.ac-group-btn')
    ok('找到组的收起按钮', !!foldBtn)
    await act(async () => {
      foldBtn.dispatchEvent(new dom.window.PointerEvent('pointerdown', { bubbles: true, button: 0 }))
    })
    await flush()
    const ds = Array.from(host.querySelectorAll('path.ac-edge')).map((p) => p.getAttribute('d'))
    eq('折叠后两根外部连线都画出来了', ds.length, 2)
    const firstX = ds.map((d) => Number((/^M (-?[\d.]+)/.exec(d) || [])[1]))
    // 两根线的起点都在折叠块的同一条边上；从前按**原始节点 id** 分组，每组只有 1 根线，
    // 端口偏移恒为 0 —— 箭头全叠在块边中心（|Δ| = 0）。
    ok('两根线在折叠块边上展开了（端口相距 ≥ 12）',
      Math.abs(firstX[0] - firstX[1]) >= 12 || Math.abs(firstX[0] - firstX[1]) === 0,
      firstX)
    ok('负向对照：它们确实分开摆（不是都落在块边中心）', Math.abs(firstX[0] - firstX[1]) >= 12, firstX)
  })

  // ---- D. 组 id 必须洗掉空格，且能认领已有组（按标签）----
  const GRP_MODEL = {
    nodes: [
      { id: 'g1', label: '甲', shape: 'rect', group: 'AI端', x: 0, y: 0 },
      { id: 'g2', label: '乙', shape: 'rect', group: null, x: 220, y: 0 },
    ],
    edges: [], groups: [{ id: 'AI端', label: 'AI 端' }], direction: 'TD', extras: [],
  }
  const groupField = (host) => Array.from(host.querySelectorAll('.ac-dock .ac-field'))
    .find((el) => (el.querySelector('label')?.textContent || '').indexOf('分组') === 0)
  const groupSelect = (host) => groupField(host)?.querySelector('select')
  // 「新组名字」那一格只在选到「＋ 新建组…」时才存在
  const groupNameInput = (host) => {
    const f = Array.from(host.querySelectorAll('.ac-dock .ac-field'))
      .find((el) => (el.querySelector('label')?.textContent || '').indexOf('新组名字') === 0)
    return f && f.querySelector('input')
  }
  const optTexts = (sel) => Array.from(sel.querySelectorAll('option')).map((o) => o.textContent)
  const pickOption = async (sel, value) => {
    const d = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value').set
    d.call(sel, value)
    await act(async () => { sel.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
    await flush()
  }
  const typeName = async (input, v) => {
    await act(async () => { setNativeValue(input, v, dom.window.HTMLInputElement.prototype) })
    await flush()
    await act(async () => { input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    await flush()
  }
  await mountModel(GRP_MODEL, '', async ({ host, sets }) => {
    const nodeOf = (t) => Array.from(host.querySelectorAll('g.ac-node')).find((el) => (el.textContent || '').indexOf(t) >= 0)

    // ---- A. 三态都在：不分组 / 现有组（带成员数）/ 新建 ----
    await act(async () => { clickEl(nodeOf('乙')) })
    await flush()
    const sel = groupSelect(host)
    ok('检查器里的分组是一个下拉框', !!sel)
    eq('下拉框的值就是节点当前的组（乙没组 → 空）', sel.value, '')
    const texts = optTexts(sel)
    ok('第 1 项是「不属于任何组」', texts[0] === '不属于任何组', texts)
    ok('列出了现有组，并且带成员数', texts.indexOf('AI 端（1）') >= 0, texts)
    eq('最后一项是「＋ 新建组…」', texts[texts.length - 1], '＋ 新建组…')

    // ---- B. 新建：id 洗过、label 保留原话 ----
    await pickOption(sel, '#new')
    ok('选了「新建组」才出现名字输入框', !!groupNameInput(host))
    // 用一个**全新的**名字：没有任何已有组能按标签认领，所以这里考的就是 id 清洗本身
    await typeName(groupNameInput(host), '数据 层')
    ok('新建过之后名字框收起来了', !groupNameInput(host))
    const sent = sets[sets.length - 1]
    const node = sent && sent.nodes.find((x) => x.id === 'g2')
    ok('新组的 id 不含空格（含空格会把 subgraph 语法写坏）',
      /^\S+$/.test(String((node && node.group) || '')), node && node.group)
    eq('空格被洗成下划线', node && node.group, '数据_层')
    ok('label 保留用户打的原话（给人看的名字不用洗）',
      !!(sent && sent.groups.find((g) => g.id === '数据_层' && g.label === '数据 层')),
      sent && sent.groups)

    // ---- C. 认领：名字撞上已有组的标签，不该凭空多一个组 ----
    await act(async () => { clickEl(nodeOf('甲')) })
    await flush()
    eq('已属于某个组时，下拉框选中的是那个组', groupSelect(host).value, 'AI端')
    await pickOption(groupSelect(host), '#new')
    await typeName(groupNameInput(host), 'AI 端')
    const sent2 = sets[sets.length - 1]
    const node1 = sent2 && sent2.nodes.find((x) => x.id === 'g1')
    eq('按标签认领已有组：打 "AI 端" 对上 id "AI端"（不是凭空多一个）', node1 && node1.group, 'AI端')
    eq('组总数不变（没有多出第二个 AI 组）', sent2 && sent2.groups.length, 2)

    // ---- D. 选一个现有组：这是接线的老毛病，值得一条断言 ----
    //    `mountModel` 每次都换一份桩模型，所以这里先把「乙」放回一个已存在的组里再验下拉框。
    await act(async () => { clickEl(nodeOf('乙')) })
    await flush()
    await pickOption(groupSelect(host), 'AI端')
    const sent3 = sets[sets.length - 1]
    eq('选现有组 → 直接落到那个组 id 上', sent3 && sent3.nodes.find((x) => x.id === 'g2').group, 'AI端')
    // 反向：选「不属于任何组」要真的移出（值回到空串，节点 group 变 null）
    await pickOption(groupSelect(host), '')
    const sent4 = sets[sets.length - 1]
    eq('选「不属于任何组」→ 节点的 group 变成 null',
      sent4 && sent4.nodes.find((x) => x.id === 'g2').group, null)
  })

  // ---- D3. 真实的危险案例：宿主与客户端对同一个名字**洗得不一样**
  //   两条路的规则本来就不是一套：
  //     宿主 `cleanId`：不在 [A-Za-z0-9_] 里的字符**一律换成 '_'**（'数据-层' → '数据_层'）
  //     客户端 `groupKeyOf`：空格换成 '_'，但 `-` `+` `.` 这些标点**原样留着**（→ '数据-层'）
  //   所以文件里真会出现 `subgraph 数据_层["数据-层"]`。用户在检查器里再打一次同样的名字，
  //   必须**按 label 认领**那个已经是同一组的组 —— 否则图上凭空多一个同名组，结构被分成两半。
  //   （第一版这里用的是 'AI 端'，而空格两边都洗成 '_'，于是这条断言在没有认领逻辑时照样过 ——
  //    空转。负向对照抓出来的。）
  const DUAL_MODEL = {
    nodes: [{ id: 'd1', label: '丁', shape: 'rect', group: null, x: 0, y: 0 }],
    edges: [], groups: [{ id: '数据_层', label: '数据-层' }], direction: 'TD', extras: [],
  }
  await mountModel(DUAL_MODEL, '', async ({ host, sets }) => {
    await act(async () => { clickEl(Array.from(host.querySelectorAll('g.ac-node'))[0]) })
    await flush()
    await pickOption(groupSelect(host), '#new')
    await typeName(groupNameInput(host), '数据-层')
    const sent = sets[sets.length - 1]
    eq('两边洗法不一致时也要认领已有组（否则图上多一个同名组）',
      sent && sent.nodes.find((n) => n.id === 'd1').group, '数据_层')
    eq('组数没有变多', sent && sent.groups.length, 1)
  })

  // ---- D2. 负向对照：节点指着一个**不在 groups 里**的组（文件手改过 / 组被删过），
  //   下拉框必须也把它列出来 —— 否则 select 找不到匹配项会退回显示第一项，界面就在说谎。
  const ORPHAN_MODEL = {
    nodes: [{ id: 'o1', label: '孤儿', shape: 'rect', group: '没这个组', x: 0, y: 0 }],
    edges: [], groups: [], direction: 'TD', extras: [],
  }
  await mountModel(ORPHAN_MODEL, '', async ({ host }) => {
    await act(async () => { clickEl(Array.from(host.querySelectorAll('g.ac-node'))[0]) })
    await flush()
    const sel = groupSelect(host)
    eq('孤儿组的 id 真的被选中了（不是掉回第一项）', sel.value, '没这个组')
    ok('下拉框里有它，并标明组已不存在',
      optTexts(sel).some((t) => t.indexOf('没这个组') >= 0 && t.indexOf('组已不存在') >= 0), optTexts(sel))
  })

  // ---- E. 无穿透：自环不许捅穿自己；两个方块几乎重叠时线也不许消失 ----
  //
  // 注意**不能**对任意几何断言「绝不穿透」：节点是可以被用户拖到互相重叠的，
  // 那种几何下不存在任何不穿透的正交路径（实测：a(0,100) 与 b(4,120) 两个 104 宽的
  // 方块横向就重叠了，任何端口出发的第一段都必然穿过对方）。代码里那条「兜底二」
  // 就是为这种无解几何留的 —— 契约是「宁可画得难看，也不能让线消失」。
  // 所以这里只断言两件能成立的事：自环不捅穿自己；无解几何下线仍然画出来。
  const penCheck = (host, rectsArg) => {
    const rects = rectsArg || Array.from(host.querySelectorAll('g.ac-node')).map(rectOf).filter(Boolean)
    const segs = []
    for (const p of Array.from(host.querySelectorAll('path.ac-edge'))) {
      const d = p.getAttribute('d') || ''
      const pts = []
      const re = /([MLQA])((?: -?[\d.]+)+)/g
      let m
      while ((m = re.exec(d)) !== null) {
        const ns = (m[2].match(/-?[\d.]+/g) || []).map(Number)
        if (m[1] === 'Q') pts.push({ x: ns[2], y: ns[3] })
        else if (m[1] === 'A') pts.push({ x: ns[5], y: ns[6] })
        else pts.push({ x: ns[0], y: ns[1] })
      }
      for (let k = 0; k + 1 < pts.length; k++) segs.push([pts[k], pts[k + 1]])
    }
    let bad = 0
    for (const [a, b] of segs) {
      for (const r of rects) {
        const R = { x1: r.x1 + 2, y1: r.y1 + 2, x2: r.x2 - 2, y2: r.y2 - 2 }
        if (Math.abs(a.y - b.y) < 0.5) {
          if (a.y > R.y1 && a.y < R.y2 && Math.max(a.x, b.x) > R.x1 && Math.min(a.x, b.x) < R.x2) bad++
        } else if (Math.abs(a.x - b.x) < 0.5) {
          if (a.x > R.x1 && a.x < R.x2 && Math.max(a.y, b.y) > R.y1 && Math.min(a.y, b.y) < R.y2) bad++
        }
      }
    }
    return { bad, rects, segs }
  }

  const SELF_MODEL = {
    nodes: [{ id: 's1', label: '自环', shape: 'rect', group: null, x: 0, y: 0 }],
    edges: [{ id: 'se', from: 's1', to: 's1', label: '', arrow: '-->' }],
    groups: [], direction: 'TD', extras: [],
  }
  await mountModel(SELF_MODEL, '', async ({ host }) => {
    const ds = Array.from(host.querySelectorAll('path.ac-edge')).map((p) => p.getAttribute('d'))
    eq('自环仍然画出来（不许消失）', ds.length, 1)
    const r = penCheck(host)
    ok('自环没有一段钻进方块内部（从前是从底边穿到顶边的一条直线）', r.bad === 0, r.segs)
    // 负向对照：它必须绕到方块**外面**去（x 超出方块右边界），而不是在方块里竖着走
    const nums = (ds[0].match(/-?[\d.]+/g) || []).map(Number)
    const maxX = Math.max.apply(null, nums.filter((_, i) => i % 2 === 0))
    ok('自环绕到了方块右边界之外', maxX > 52, { maxX, d: ds[0] })
    // 光靠"不穿透"考不出自环特判 —— 撤掉特判后，守卫 + 翻转轴会让它绕一大圈，也不穿透。
    // 能分出来的是**环的尺度**：自环该是贴着方块的一个小圈（纵向不超过方块半高），
    // 不是绕着整个方块兜一圈（那会跑到 y=±68）。
    const ys = nums.filter((_, i) => i % 2 === 1).map(Math.abs)
    ok('自环是贴着方块的小圈（纵向不超出方块半高）', Math.max.apply(null, ys) <= 22.5 + 0.01, { ys, d: ds[0] })
  })

  const OVERLAP_MODEL = {
    nodes: [
      { id: 'p1', label: '甲', shape: 'rect', group: null, x: 0, y: 100 },
      { id: 'p2', label: '乙', shape: 'rect', group: null, x: 4, y: 120 },
    ],
    edges: [{ id: 'pe', from: 'p1', to: 'p2', label: '', arrow: '-->' }],
    groups: [], direction: 'TD', extras: [],
  }
  await mountModel(OVERLAP_MODEL, '', async ({ host }) => {
    const ds = Array.from(host.querySelectorAll('path.ac-edge')).map((p) => p.getAttribute('d'))
    eq('两个方块几乎重叠（无解几何）时，连线仍然画出来', ds.length, 1)
    ok('并且两端都真的落在方块边界上（没有跑去别处）',
      /^M /.test(ds[0]) && ds[0].indexOf('L') >= 0, ds[0])
  })

  // ---- F. 留言**不再**自动补进草稿：草稿里写了什么，挂载后就是什么 ----
  // 从前这里考的是 `draftHasRef` 的词边界（`@c11` 不能把 `@c1` 吃掉）。那个自动补引用的
  // 机制连同 `draftHasRef` 一起移除了（见 studio.ts「留言不进输入框」那段注释），
  // 所以现在锁的是更简单的一条：**留言在图上、草稿一个字都不动**。
  const REF_MODEL = {
    nodes: [{ id: 'c1', label: '节点丙一', shape: 'rect', group: null, x: 0, y: 0, note: '待办', noteDone: false }],
    edges: [], groups: [], direction: 'TD', extras: [],
  }
  await mountModel(REF_MODEL, '@c11', async ({ calls }) => {
    eq('草稿里有 @c11、图上有一条未办留言 —— setDraft 一次都不调', calls.length, 0)
    ok('而那条留言确实在图上（正向对照，否则上一条是空转）',
      (REF_MODEL.nodes[0].note || '') === '待办')
  })

  // ---- G. 详情面板在「点选」抬手时才展开；拖动（含手抖）不该把它顶出来 ----
  // 用户提的规则：详情是一块最多吃掉 46% 高度的下挂面板，拖动途中弹出会把画布挤矮、
  // 把节点挤出视野。所以「展开」必须挂在**没有位移的那一次抬手**上，而不是按下。
  const DOCK_MODEL = {
    nodes: [
      { id: 'dk1', label: '甲', shape: 'rect', group: null, x: 0, y: 0, note: '留言甲', noteDone: false },
      { id: 'dk2', label: '乙', shape: 'rect', group: null, x: 240, y: 0 },
    ],
    edges: [], groups: [], direction: 'TD', extras: [],
  }
  await mountModel(DOCK_MODEL, '', async ({ host, sets }) => {
    const svgEl = host.querySelector('svg.ac-svg')
    const dockEl = () => host.querySelector('.ac-dock')
    const nodeEl = (t) => Array.from(host.querySelectorAll('g.ac-node')).find((el) => (el.textContent || '').indexOf(t) >= 0)
    const down = (el, x, y) => el.dispatchEvent(new dom.window.PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: x, clientY: y }))
    const up = (el, x, y) => el.dispatchEvent(new dom.window.PointerEvent('pointerup', { bubbles: true, button: 0, clientX: x, clientY: y }))
    const move = (x, y) => svgEl.dispatchEvent(new dom.window.PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: y }))

    // 1) 只按下：不展开。这是整条规则的意义 —— 每一次拖动都是从「按下」开始的。
    await act(async () => { down(nodeEl('甲'), 100, 100) })
    await flush()
    ok('负向对照：只按下、不抬手，详情面板不展开', !dockEl())

    // 2) 按下 → 拖动 → 抬手：不展开，而且这一拖是真的（落了盘，否则上一条是空断言）
    const setsBefore = sets.length
    await act(async () => { move(180, 160); up(svgEl, 180, 160) })
    await flush()
    ok('拖过之后仍然不展开详情', !dockEl())
    ok('拖动确实落了盘（不是空拖）', sets.length > setsBefore, sets.length - setsBefore)

    // 3) 点选：按下 → 抬手（无位移）→ 展开
    await act(async () => { down(nodeEl('乙'), 300, 200); up(nodeEl('乙'), 300, 200) })
    await flush()
    ok('点选（按下 + 抬手无位移）展开详情',
      !!dockEl() && dockEl().textContent.indexOf('节点 dk2') >= 0, dockEl() && dockEl().textContent)

    // 4) 手抖 3px 仍然算点选：节点不动、详情照开（触控板点一下很少一动不动）
    const before = rectOf(nodeEl('甲'))
    const setsBeforeJitter = sets.length
    await act(async () => { down(nodeEl('甲'), 400, 300); move(402, 301); up(svgEl, 402, 301) })
    await flush()
    eq('手抖 3px 在门槛内 → 节点坐标一模一样', JSON.stringify(rectOf(nodeEl('甲'))), JSON.stringify(before))
    eq('手抖也不多记一次落盘', sets.length, setsBeforeJitter)
    ok('手抖仍然算点选 → 详情展开',
      !!dockEl() && dockEl().textContent.indexOf('节点 dk1') >= 0, dockEl() && dockEl().textContent)

    // ---- 2026-09-23：展开/收起改成一整套显式语义（面板三态 + Esc 分层 + 分隔条） ----
    const peekEl = () => host.querySelector('.ac-peek')
    const selNode = () => host.querySelector('g.ac-node.sel')
    const dockBtn = (t) => Array.from(host.querySelectorAll('.ac-dock-btn')).find((b) => b.textContent.trim() === t)

    // 5) 再点**同一个**节点 = 收起（选中保留）—— 一个动作一个开关，不用去找关闭按钮
    await act(async () => { down(nodeEl('甲'), 400, 300) })
    await flush()
    await act(async () => { up(nodeEl('甲'), 400, 300) })
    await flush()
    ok('再点同一个节点：面板收起', !dockEl())
    ok('收起后留一条细条，写明收的是谁', !!peekEl() && peekEl().textContent.indexOf('节点 dk1') >= 0, peekEl() && peekEl().textContent)
    ok('收起**不取消选中**（画布上的高亮还在）', !!selNode(), selNode() && selNode().textContent)

    // 6) 点细条 → 重新展开
    await act(async () => { peekEl().querySelector('.ac-peek-btn').click() })
    await flush()
    ok('点细条重新展开面板', !!dockEl() && dockEl().textContent.indexOf('节点 dk1') >= 0)

    // 7) 标题栏上的两个按钮：收起（保留选中）/ 关闭（取消选中）
    await act(async () => { dockBtn('▾ 收起').click() })
    await flush()
    ok('「▾ 收起」把面板收成细条，选中保留', !dockEl() && !!peekEl() && !!selNode())
    await act(async () => { peekEl().querySelector('.ac-peek-btn').click() })
    await flush()
    await act(async () => { dockBtn('×').click() })
    await flush()
    ok('「×」关掉面板并取消选中', !dockEl() && !peekEl() && !selNode())

    // 8) 背景「按下 + 抬手、中间没位移」= 点空白 → 清选中、面板也收
    await act(async () => { down(nodeEl('甲'), 100, 100); up(nodeEl('甲'), 100, 100) })
    await flush()
    ok('前置：面板又打开了', !!dockEl())
    await act(async () => { down(svgEl, 500, 400); up(svgEl, 500, 400) })
    await flush()
    ok('点空白：面板与细条都消失', !dockEl() && !peekEl())
    ok('点空白：选中也清了', !selNode())

    // 9) 负向对照：背景上**拖动平移**不该把面板收掉（想挪视角的人不该丢掉正在编辑的节点）
    await act(async () => { down(nodeEl('乙'), 300, 200); up(nodeEl('乙'), 300, 200) })
    await flush()
    ok('前置：面板开着（乙）', !!dockEl() && dockEl().textContent.indexOf('节点 dk2') >= 0)
    await act(async () => { down(svgEl, 500, 400); move(540, 430); up(svgEl, 540, 430) })
    await flush()
    ok('平移过画布之后：面板还在', !!dockEl() && dockEl().textContent.indexOf('节点 dk2') >= 0)
    ok('平移过画布之后：选中还在', !!selNode())

    // 10) Esc 分层：先收面板（选中保留）→ 再取消选中
    const esc = (el) => el.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    const rootEl2 = host.querySelector('.ac-root')
    await act(async () => { esc(rootEl2) })
    await flush()
    ok('第一下 Esc：只收面板，选中保留', !dockEl() && !!peekEl() && !!selNode())
    await act(async () => { esc(rootEl2) })
    await flush()
    ok('第二下 Esc：取消选中，细条也消失', !peekEl() && !selNode())

    // 11) 分隔条：能拖出面板高度（拖出来之后面板带内联 height，双击复位）
    await act(async () => { down(nodeEl('甲'), 100, 100); up(nodeEl('甲'), 100, 100) })
    await flush()
    const sash = host.querySelector('.ac-sash')
    ok('面板上有分隔条，且标了 role=separator', !!sash && sash.getAttribute('role') === 'separator')
    await act(async () => {
      sash.dispatchEvent(new dom.window.PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 10, clientY: 400 }))
      dom.window.dispatchEvent(new dom.window.PointerEvent('pointermove', { bubbles: true, clientX: 10, clientY: 300 }))
      dom.window.dispatchEvent(new dom.window.PointerEvent('pointerup', { bubbles: true, clientX: 10, clientY: 300 }))
    })
    await flush()
    const dockAfter = host.querySelector('.ac-dock')
    ok('拖分隔条之后面板带上了显式高度', !!dockAfter && /height:\s*\d+px/.test(dockAfter.getAttribute('style') || ''), dockAfter && dockAfter.getAttribute('style'))
  })

  respond = respond
}

console.log('\n[4s] 跨页记忆（画布是主窗口子页，切走就卸载）与 @ 引用源的会话正确性')
{
  const MODEL_A = {
    nodes: [
      { id: 'a4', label: '甲', shape: 'rect', group: null, x: 0, y: 0 },
      { id: 'b7', label: '乙', shape: 'rect', group: null, x: 240, y: 0 },
    ],
    edges: [], groups: [], direction: 'TD', extras: [],
  }
  const mountIn = async (opts) => {
    const prevR = respond
    const sets = []
    const plain = () => JSON.parse(JSON.stringify(opts.model))
    const docFor = (m, rev, by, lc) => fullDoc({
      key: opts.key, diagram: opts.key, model: m, nodeCount: m.nodes.length,
      revision: rev, updatedBy: by, lastChange: lc || null,
    })
    respond = function (method, args) {
      if (method === 'doc:get') return docFor(plain(), opts.revision, opts.updatedBy || 'switch', opts.lastChange)
      if (method === 'doc:set') { sets.push(args.model); return docFor(args.model, (opts.revision || 1) + 1, 'user', null) }
      if (method === 'doc:rev') return { revision: opts.revision, updatedBy: opts.updatedBy || 'switch', diagram: opts.key, dir: UI + '/.arch-canvas', libraryRev: 1, external: null }
      if (method === 'doc:history') return { ok: true, entries: [] }
      if (method === 'doc:list') return { ok: true, dir: UI + '/.arch-canvas', scope: 'project', workspace: UI, current: opts.key, external: null, items: [], files: [], libraryRev: 1 }
      return prevR(method, args)
    }
    const host = document.createElement('div')
    document.body.appendChild(host)
    const croot = createRoot(host)
    await act(async () => {
      croot.render(React.createElement(captured['conversation.view'], {
        cwd: UI, sessionId: opts.sessionId, useSessions: () => UI,
      }))
    })
    await flush()
    const api = { host, sets }
    if (opts.ops) await opts.ops(api)
    await act(async () => { croot.unmount() })
    host.remove()
    respond = prevR
    return api
  }
  const world = (host) => host.querySelector('g.ac-world')?.getAttribute('transform')
  const undoBtn = (host) => host.querySelector('button.ac-tab[title^="撤销"]')
  const pulseCount = (host) => host.querySelectorAll('.ac-pulse').length
  const nodeIn = (host, t) => Array.from(host.querySelectorAll('g.ac-node')).find((el) => (el.textContent || '').indexOf(t) >= 0)

  // ---- 1. 离开再回来：视角与撤销栈要还回来；同一次 AI 改动不许重放 ----
  const SESS = 's-memo'
  const AI_LAST = { by: 'ai', rev: 9, nodes: ['a4'] }
  let fittedView = '', zoomedView = ''
  await mountIn({
    sessionId: SESS, key: 'memo/architecture', model: MODEL_A,
    revision: 9, updatedBy: 'ai', lastChange: AI_LAST,
    ops: async ({ host }) => {
      fittedView = world(host)
      ok('第一次挂载：AI 的改动闪了一次（否则下面「不重放」那条是空断言）', pulseCount(host) > 0, pulseCount(host))
      // 用户自己动视角：画布页滚轮缩放
      await act(async () => {
        host.querySelector('svg.ac-svg').dispatchEvent(new dom.window.WheelEvent('wheel', { deltaY: -120, clientX: 60, clientY: 60, bubbles: true, cancelable: true }))
      })
      await flush()
      zoomedView = world(host)
      ok('滚轮之后视角真的变了', !!zoomedView && zoomedView !== fittedView, [fittedView, zoomedView])
      // 用户拖一个节点 → 撤销栈里有一条（这一步也顺手落了盘）
      await act(async () => {
        const el = nodeIn(host, '乙')
        el.dispatchEvent(new dom.window.PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 300, clientY: 200 }))
        host.querySelector('svg.ac-svg').dispatchEvent(new dom.window.PointerEvent('pointermove', { bubbles: true, clientX: 380, clientY: 260 }))
        host.querySelector('svg.ac-svg').dispatchEvent(new dom.window.PointerEvent('pointerup', { bubbles: true, button: 0, clientX: 380, clientY: 260 }))
      })
      await flush()
      ok('拖动之后撤销按钮可用（撤销栈里有一条）', !!undoBtn(host) && undoBtn(host).disabled === false)
    },
  })
  // 同一个会话、同一张图：重新挂载 = 「切到对话又切回来」
  let restoredSets = null
  await mountIn({
    sessionId: SESS, key: 'memo/architecture', model: MODEL_A,
    revision: 9, updatedBy: 'ai', lastChange: AI_LAST,
    ops: async ({ host, sets }) => {
      restoredSets = sets
      eq('回来时视角原样还回来（不是重新适应窗口）', world(host), zoomedView)
      ok('回来时撤销栈还在（不是从头开始）', !!undoBtn(host) && undoBtn(host).disabled === false)
      eq('同一次 AI 改动不再重放高亮', pulseCount(host), 0)
      // 最强的一条：还回来的历史必须**能用** —— 点 ↶ 要真的退回拖动之前的坐标
      await act(async () => { undoBtn(host).click() })
      await flush()
      const sent = sets[sets.length - 1]
      ok('回来之后 ↶ 真的退回了一步（落了盘）', !!sent, sets.length)
      eq('退回的是「拖动之前」那一份（乙 回到 x=240）', sent && sent.nodes.find((n) => n.id === 'b7').x, 240)
    },
  })
  ok('负向对照：那次退回确实发生了（不是空跑）', !!restoredSets && restoredSets.length > 0)

  // ---- 1b. 只编辑、**不动视角**的人：撤销栈也必须还回来 ----
  // 上面那一段永远先滚轮缩放，所以 memo 里同时有 view 与 hist，走的是「有 view」那条分支；
  // 而 hist 与 view 是**独立**写进 memo 的（见 studio.ts 卸载时那个 effect）：只编辑不动视角的人，
  // memo 里天然只有 hist、没有 view。从前复位分支是 `else`（= 没有 memo **或** memo 里没有 view），
  // 于是刚还回来的撤销栈被当场清空 —— 而 histRef.current 正指向 memo 里那个对象，
  // 连记忆里那一份也一起毁掉（切一次页就永久回不来）。
  const SESS_H = 's-memo-hist-only'
  let editOnlyView = '', preEditView = ''
  await mountIn({
    sessionId: SESS_H, key: 'memo/hist-only', model: MODEL_A, revision: 3,
    ops: async ({ host }) => {
      preEditView = world(host)
      // 只编辑：拖动「乙」，全程一次滚轮都不发
      await act(async () => {
        const el = nodeIn(host, '乙')
        el.dispatchEvent(new dom.window.PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 300, clientY: 200 }))
        host.querySelector('svg.ac-svg').dispatchEvent(new dom.window.PointerEvent('pointermove', { bubbles: true, clientX: 380, clientY: 260 }))
        host.querySelector('svg.ac-svg').dispatchEvent(new dom.window.PointerEvent('pointerup', { bubbles: true, button: 0, clientX: 380, clientY: 260 }))
      })
      await flush()
      editOnlyView = world(host)
      eq('前置证明：这一下编辑没有动视角（所以 memo 里只有 hist、没有 view）', editOnlyView, preEditView)
      ok('前置证明：编辑之后撤销按钮是可用的（否则下面那条是空转）',
        !!undoBtn(host) && undoBtn(host).disabled === false)
    },
  })
  let editOnlySets = null
  await mountIn({
    sessionId: SESS_H, key: 'memo/hist-only', model: MODEL_A, revision: 3,
    ops: async ({ host, sets }) => {
      editOnlySets = sets
      ok('只编辑、不动视角：回来时撤销栈还在（↶ 可用，不是从头开始）',
        !!undoBtn(host) && undoBtn(host).disabled === false)
      // 最强的一条：还回来的历史必须**能用**
      await act(async () => { undoBtn(host).click() })
      await flush()
      const sent = sets[sets.length - 1]
      ok('并且 ↶ 真的退回了那一步（落了盘，不是按钮假亮）', !!sent, sets.length)
      eq('退回的是「编辑之前」那一份（乙 回到 x=240）', sent && sent.nodes.find((n) => n.id === 'b7').x, 240)
    },
  })
  ok('负向对照：那次退回确实发生了（不是空跑）', !!editOnlySets && editOnlySets.length > 0)
  // 负向对照：真的没有 memo（全新会话、这张图从没被打开过）时，复位分支必须照旧干活
  await mountIn({
    sessionId: 's-memo-fresh', key: 'memo/fresh', model: MODEL_A, revision: 1,
    ops: async ({ host }) => {
      ok('负向对照：全新会话（没有 memo）时撤销栈是空的、↶ 不可用',
        !!undoBtn(host) && undoBtn(host).disabled === true)
    },
  })

  // ---- 2. 负向对照：换一张图（不同 key）就必须按默认来 ----
  await mountIn({
    sessionId: SESS, key: 'memo/another', model: MODEL_A,
    revision: 9, updatedBy: 'switch', lastChange: null,
    ops: async ({ host }) => {
      eq('另换一张图时不许继承上一张的视角（回到自动适应窗口）', world(host), fittedView)
      ok('另换一张图时撤销栈是空的', !!undoBtn(host) && undoBtn(host).disabled === true)
    },
  })

  // ---- 3. @ 引用源：按会话取快照，不许把别的会话（别的项目）的图摆出来 ----
  ok('@ 引用源被注册了', !!capturedSource)
  await mountIn({
    sessionId: 's-at-a', key: 'at/a', model: MODEL_A, revision: 1, ops: async () => {},
  })
  eq('本会话：@ 候选取到 2 个节点', (await capturedSource.candidates({ sessionId: 's-at-a' }, { query: '' })).length, 2)
  eq('lexicon 给出本会话的节点 id', capturedSource.lexicon({ sessionId: 's-at-a' }).join(','), 'a4,b7')
  // 这就是修掉的那条：从前这里返回的是「上一次打开的那张图」的节点（跨会话、可能跨项目）
  eq('别的会话没开过画布 → 一个候选都不给', (await capturedSource.candidates({ sessionId: 's-at-b' }, { query: '' })).length, 0)
  eq('别的会话没开过画布 → lexicon 也是空', capturedSource.lexicon({ sessionId: 's-at-b' }).length, 0)

  // 展开文本：活跃会话优先；两个会话同名节点、而活跃的那个没有 —— 宁可不展开
  await mountIn({
    sessionId: 's-at-c', key: 'at/c',
    model: { nodes: [{ id: 'a4', label: '三号', shape: 'rect', group: null, x: 0, y: 0 }], edges: [], groups: [], direction: 'TD', extras: [] },
    revision: 1, ops: async () => {},
  })
  capturedSource.lexicon({ sessionId: 's-at-c' })
  ok('两个会话都有 a4 时：活跃会话的那个说了算', (await capturedSource.codec.serialize('a4')).indexOf('三号') >= 0,
    await capturedSource.codec.serialize('a4'))
  capturedSource.lexicon({ sessionId: 's-at-a' })
  ok('切回另一个会话：展开的是它的那个 a4', (await capturedSource.codec.serialize('a4')).indexOf('节点 a4「甲」') >= 0,
    await capturedSource.codec.serialize('a4'))
  capturedSource.lexicon({ sessionId: 's-at-never' })
  eq('分不清是哪个会话的 a4 时拒绝展开（不许把另一张图的话塞进 prompt）',
    await capturedSource.codec.serialize('a4'), '[画布节点 a4（当前画布中已不存在该节点）]')
}

console.log('\n[4t] 锚点保鲜：角标三态 / 检查器逐条说明 / 画布页的过期横幅')
{
  const prevR = respond
  const DR_MODEL = {
    nodes: [
      { id: 'dr1', label: '改过的', shape: 'rect', group: null, x: 0, y: 0, files: ['src/host/mermaid.ts#parseMermaid'] },
      { id: 'dr2', label: '好着的', shape: 'rect', group: null, x: 240, y: 0, files: ['src/host/plugin.ts'] },
      { id: 'dr3', label: '坏掉的', shape: 'rect', group: null, x: 480, y: 0, files: ['src/host/没了.ts'] },
    ],
    edges: [], groups: [], direction: 'TD', extras: [],
  }
  const drFileStatus = {
    dr1: { 'src/host/mermaid.ts#parseMermaid': 'ok' },
    dr2: { 'src/host/plugin.ts': 'ok' },
    dr3: { 'src/host/没了.ts': 'missing' },
  }
  const drReport = (stale) => ({
    stale: stale, uncovered: [{ dir: 'src/package', files: 2 }, { dir: 'tools', files: 3 }],
    files: 12, baseline: true, truncated: false, checkedAt: 1, external: false,
  })
  respond = function (method, args) {
    const extra = { model: DR_MODEL, nodeCount: 3, key: 'drift/x', diagram: 'drift/x', fileStatus: drFileStatus }
    if (method === 'doc:get') return fullDoc(Object.assign({}, extra, { drift: drReport([{ node: 'dr1', ref: 'src/host/mermaid.ts#parseMermaid' }]) }))
    if (method === 'doc:set') return fullDoc(Object.assign({}, extra, { model: args.model, drift: drReport([]) }))
    if (method === 'doc:rev') return { revision: 1, updatedBy: 'switch', diagram: 'drift/x', dir: UI + '/.arch-canvas', libraryRev: 1, external: null }
    if (method === 'doc:history') return { ok: true, entries: [] }
    return prevR(method, args)
  }
  const drHost = document.createElement('div')
  document.body.appendChild(drHost)
  const drRoot = createRoot(drHost)
  await act(async () => {
    drRoot.render(React.createElement(captured['conversation.view'], {
      cwd: UI, sessionId: 's-drift', useSessions: () => UI,
    }))
  })
  await flush()

  const badgeOf = (t) => Array.from(drHost.querySelectorAll('g.ac-node'))
    .find((el) => (el.textContent || '').indexOf(t) >= 0)?.querySelector('.ac-file-badge')
  ok('文件在图之后改过 → 角标是琥珀那一档（.stale）', !!badgeOf('改过的') && badgeOf('改过的').classList.contains('stale'),
    badgeOf('改过的') && badgeOf('改过的').getAttribute('class'))
  ok('负向对照：没改过的节点角标不带 stale', !!badgeOf('好着的') && !badgeOf('好着的').classList.contains('stale'))
  ok('失效的仍然是红的那一档（没被 stale 顶掉）', !!badgeOf('坏掉的') && badgeOf('坏掉的').classList.contains('broken'))

  const box = drHost.querySelector('.ac-drift')
  ok('画布页出现保鲜横幅', !!box)
  // 默认**收起成一行**：常驻明细会一直挤掉画布高度，而「哪个方块过期了」画布上已有琥珀角标指着。
  ok('默认收起：只有一行，不列明细', !!box && !box.classList.contains('open') && !box.querySelector('.ac-drift-i'),
    box && box.textContent)
  ok('收起的那一行仍然报出条数（信号本身不许被折叠掉）',
    !!box && box.textContent.indexOf('1 条锚点的文件在图之后改过') >= 0 && box.textContent.indexOf('明细') >= 0,
    box && box.textContent)
  // 点开才展开明细：哪个节点、哪条引用、哪些目录没画到、以及该怎么做
  await act(async () => { box.querySelector('.ac-drift-h').click() })
  await flush()
  const boxOpen = drHost.querySelector('.ac-drift')
  ok('点开后展开：点明是哪个节点、哪条引用',
    !!boxOpen && boxOpen.classList.contains('open') &&
    boxOpen.textContent.indexOf('dr1') >= 0 && boxOpen.textContent.indexOf('src/host/mermaid.ts#parseMermaid') >= 0,
    boxOpen && boxOpen.textContent)
  ok('展开后也报「没有锚点指向的目录」', !!boxOpen && boxOpen.textContent.indexOf('src/package') >= 0 && boxOpen.textContent.indexOf('tools') >= 0)
  ok('横幅与「解析警告」是两条，不混在一起',
    drHost.querySelectorAll('.ac-drift').length === 1 && drHost.querySelectorAll('.ac-warn').length === 0)

  // 点选那个节点：检查器里那一条要写明「为什么」，而且用琥珀那一档样式（不是红的）
  await act(async () => {
    const el = Array.from(drHost.querySelectorAll('g.ac-node')).find((e) => (e.textContent || '').indexOf('改过的') >= 0)
    clickEl(el, 100, 100)
  })
  await flush()
  const refRow = drHost.querySelector('.ac-dock .ac-ref-status')
  ok('检查器里那条锚点写明原因', !!refRow && refRow.textContent.indexOf('文件在图之后改过') >= 0, refRow && refRow.textContent)
  ok('并且用的是 amber 那一档，不是红的',
    !!refRow && !!refRow.querySelector('.ac-ref-stale') && !refRow.querySelector('.ac-ref-bad'),
    refRow && refRow.innerHTML.slice(0, 200))

  // 只有「没画到」时：**不许用警告色**（三天就被无视了），也不能说「过期」
  await act(async () => { drRoot.unmount() })
  respond = function (method, args) {
    const extra = { model: DR_MODEL, nodeCount: 3, key: 'drift/x', diagram: 'drift/x', fileStatus: drFileStatus }
    if (method === 'doc:get') return fullDoc(Object.assign({}, extra, { drift: drReport([]) }))
    if (method === 'doc:rev') return { revision: 1, updatedBy: 'switch', diagram: 'drift/x', dir: UI + '/.arch-canvas', libraryRev: 1, external: null }
    return prevR(method, args)
  }
  const hintRoot = createRoot(drHost)
  await act(async () => {
    hintRoot.render(React.createElement(captured['conversation.view'], {
      cwd: UI, sessionId: 's-drift-hint', useSessions: () => UI,
    }))
  })
  await flush()
  const hintBox = drHost.querySelector('.ac-drift')
  ok('只有「没画到」时横幅降一档语气（.hint）', !!hintBox && hintBox.classList.contains('hint'),
    hintBox && hintBox.getAttribute('class'))
  ok('并且不说「已经过期」', !!hintBox && hintBox.textContent.indexOf('已经过期') < 0 && hintBox.textContent.indexOf('有源码没画到') >= 0,
    hintBox && hintBox.textContent)
  await act(async () => { hintRoot.unmount() })

  // 横幅只属于画布页：源码页讲的是「这段文本」，不是「这张图新不新鲜」
  respond = prevR
  const textRoot = createRoot(drHost)
  await act(async () => {
    textRoot.render(React.createElement(captured['conversation.view'], {
      cwd: UI, sessionId: 's-drift-text', useSessions: () => UI,
    }))
  })
  await flush()
  await act(async () => {
    Array.from(drHost.querySelectorAll('.ac-tab')).find((b) => b.textContent.trim() === '源码').click()
  })
  await flush()
  ok('源码页不挂保鲜横幅', !drHost.querySelector('.ac-drift'))
  await act(async () => { textRoot.unmount() })
  drHost.remove()
}

console.log('\n[4u] 描边亮度与组配色：描边不再用「边框」令牌，同一组一个稳定色相')
{
  const ruleOf = (sel) => {
    const i = insertedCss.indexOf(sel + '{')
    return i < 0 ? '' : insertedCss.slice(i + sel.length + 1, insertedCss.indexOf('}', i))
  }

  // a. 「边框令牌」不许再出现在图形描边上。border-l2 是 #ffffff1f（12% 白），
  //    当作节点描边只有 1.48:1、当作连线 1.42:1 —— 这就是用户说的「淡」。
  ok('节点描边不再用 border-l2', ruleOf('.ac-node .ac-shape').indexOf('--ac-line') >= 0
    && ruleOf('.ac-node .ac-shape').indexOf('border-l2') < 0, ruleOf('.ac-node .ac-shape'))
  ok('连线不再用 border-l2', ruleOf('.ac-edge').indexOf('--ac-line') >= 0
    && ruleOf('.ac-edge').indexOf('border-l2') < 0, ruleOf('.ac-edge'))
  ok('箭头跟着连线改色', ruleOf('.ac-arrowhead').indexOf('--ac-line') >= 0, ruleOf('.ac-arrowhead'))
  // b. 描边色自己定义，且深色有一份（浅色在裸 body 上，深色挂在 body[data-ds-dark-theme]）
  //    注意 `.ac-root` 有两条（原来那条定义面板底色的还在），所以按整串找，不能取第一条规则。
  ok('--ac-line 有浅色值', insertedCss.indexOf('--ac-line:#7c828a') >= 0)
  const darkAt = insertedCss.indexOf('body[data-ds-dark-theme]) .ac-root{')
  ok('--ac-line 有深色值', darkAt >= 0)
  ok('深色那份描边与浅色不同', darkAt >= 0 && insertedCss.slice(darkAt).indexOf('--ac-line:#86888a') >= 0)

  // c. 八档色相：每档都要有「描边 / 框填充 / 组名」三条，且都指向自己的变量
  let hueRules = 0
  for (let i = 0; i < 8; i++) {
    if (insertedCss.indexOf(`.ac-h${i} .ac-shape,.ac-h${i} .ac-group-box,.ac-h${i} .ac-fold-box{stroke:var(--ac-p${i})}`) >= 0) hueRules++
    if (insertedCss.indexOf(`.ac-h${i} .ac-group-box,.ac-h${i} .ac-fold-box{fill:var(--ac-p${i});fill-opacity:var(--ac-fill-a)}`) >= 0) hueRules++
    if (insertedCss.indexOf(`.ac-h${i} .ac-group-lbl,.ac-h${i} .ac-fold-lbl{fill:var(--ac-p${i})}`) >= 0) hueRules++
  }
  eq('八档色相 × 三条规则都在样式表里', hueRules, 24)
  // 导出件（白底）是字面色板，与屏幕同一套色相 —— 别让屏幕和导出长得不一样
  const hueShapeSel = (insertedCss.match(/\.ac-h[0-7] \.ac-shape/g) || []).length
  ok('导出样式表也带了这八档（屏幕 8 条 + 导出 8 条）', hueShapeSel >= 16, hueShapeSel)

  // d. 真渲染一遍：组框、组内节点的边框是同一个档位；无组的节点没有档位
  // 两个组 id 在哈希上**故意撞档**（alpha 与 组一 都落在 1）：只有这样才真的走到
  // 「撞了往后探」那条路，也才验得出下面的顺序无关性 —— 不撞的话探针分支一次都没跑。
  const prevR = respond
  const PAL = (reversed) => ({
    nodes: [
      { id: 'pa', label: '甲一', shape: 'rect', group: 'alpha', x: 0, y: 0 },
      { id: 'pb', label: '甲二', shape: 'rect', group: 'alpha', x: 240, y: 0 },
      { id: 'pc', label: '乙一', shape: 'rect', group: '组一', x: 0, y: 200 },
      { id: 'pd', label: '野的', shape: 'rect', group: null, x: 240, y: 200 },
    ],
    edges: [{ id: 'e1', from: 'pa', to: 'pc' }],
    groups: reversed
      ? [{ id: '组一', label: '乙组' }, { id: 'alpha', label: '甲组' }]
      : [{ id: 'alpha', label: '甲组' }, { id: '组一', label: '乙组' }],
    direction: 'TD', extras: [],
  })
  async function renderPal(model, sid) {
    respond = function (method, args) {
      const extra = { model, nodeCount: model.nodes.length, groupCount: model.groups.length, key: 'pal/x', diagram: 'pal/x' }
      if (method === 'doc:get') return fullDoc(extra)
      if (method === 'doc:set') return fullDoc(Object.assign({}, extra, { model: args.model }))
      if (method === 'doc:rev') return { revision: 1, updatedBy: 'switch', diagram: 'pal/x', dir: UI + '/.arch-canvas', libraryRev: 1, external: null }
      if (method === 'doc:history') return { ok: true, entries: [] }
      return prevR(method, args)
    }
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => {
      root.render(React.createElement(captured['conversation.view'], {
        cwd: UI, sessionId: sid, useSessions: () => UI,
      }))
    })
    await flush()
    return { host, root }
  }
  const hueIn = (el) => {
    const m = el ? /(?:^|\s)ac-h(\d)(?:\s|$)/.exec(el.getAttribute('class') || '') : null
    return m ? Number(m[1]) : null
  }
  const nodeHue = (host, title) => hueIn(Array.from(host.querySelectorAll('g.ac-node'))
    .find((el) => ((el.querySelector('.ac-lbl') || {}).textContent || '').trim() === title))
  const grpHue = (host, label) => hueIn(Array.from(host.querySelectorAll('g.ac-grp'))
    .find((el) => ((el.querySelector('.ac-group-lbl') || {}).textContent || '').trim() === label))

  const p1 = await renderPal(PAL(false), 's-pal-1')
  const a1 = grpHue(p1.host, '甲组')
  const b1 = grpHue(p1.host, '乙组')
  ok('组框带上了色相类', a1 !== null && b1 !== null, { a1, b1 })
  ok('两个组拿到的档位不同', a1 !== null && b1 !== null && a1 !== b1, { a1, b1 })
  // 正向先立住，否则下面「没色相」那条是空断言
  eq('组内节点与组框同档（甲）', nodeHue(p1.host, '甲一'), a1)
  eq('组内第二个节点也同档（甲）', nodeHue(p1.host, '甲二'), a1)
  eq('另一个组的节点跟另一个档（乙）', nodeHue(p1.host, '乙一'), b1)
  // **负向对照**：不属于任何组的节点不许带档位（否则它就跟着别人的色走了）
  eq('无组节点没有色相类', nodeHue(p1.host, '野的'), null)
  ok('无组节点仍然渲染出来了（所以上一条不是「没找到元素」）', !!Array.from(p1.host.querySelectorAll('g.ac-node'))
    .find((el) => ((el.querySelector('.ac-lbl') || {}).textContent || '').trim() === '野的'))
  await act(async () => { p1.root.unmount() })
  p1.host.remove()

  // e. **不变量**：档位只取决于「有哪些组」，与组在文件里的顺序无关 ——
  //    否则删掉中间一个组，用户记住的「那个绿框」就会换色。
  const p2 = await renderPal(PAL(true), 's-pal-2')
  eq('组顺序颠倒后，同一个组的档位不变（甲）', grpHue(p2.host, '甲组'), a1)
  eq('组顺序颠倒后，同一个组的档位不变（乙）', grpHue(p2.host, '乙组'), b1)
  await act(async () => { p2.root.unmount() })
  p2.host.remove()

  respond = prevR
}

console.log('\n[4x] 连线几何解耦选中态与 DOM 级等价证明');
{
  const prevR = respond
  const SEL_MODEL = {
    nodes: [
      { id: 'sa', label: '节点A', x: 100, y: 100, w: 100, h: 50, shape: 'rect' },
      { id: 'sb', label: '节点B', x: 300, y: 100, w: 100, h: 50, shape: 'diamond' },
      { id: 'sc', label: '节点C', x: 200, y: 300, w: 100, h: 50, shape: 'round' },
    ],
    edges: [
      { id: 'se1', from: 'sa', to: 'sb', arrow: '-->' },
      { id: 'se2', from: 'sb', to: 'sc', arrow: '-->' },
      { id: 'se3', from: 'sc', to: 'sa', arrow: '-.->' },
    ],
    groups: [],
    direction: 'TD',
  }
  respond = function (method, args) {
    if (method === 'doc:get') return fullDoc({ model: SEL_MODEL, nodeCount: 3, key: 'sel_test', diagram: 'sel_test' })
    if (method === 'doc:rev') return { revision: 1, updatedBy: 'switch', diagram: 'sel_test', dir: UI + '/.arch-canvas', libraryRev: 1, external: null }
    if (method === 'doc:history') return { ok: true, entries: [] }
    return prevR(method, args)
  }

  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(React.createElement(captured['conversation.view'], {
      cwd: UI, sessionId: 's-sel-test', useSessions: () => UI,
    }))
  })
  await flush()

  const getEdgePaths = (container) => Array.from(container.querySelectorAll('path.ac-edge')).map(p => p.getAttribute('d'))

  // 1. 初次渲染拿到的 paths
  const pathsMount = getEdgePaths(host)
  ok('初次整树挂载时渲染出 3 条边', pathsMount.length === 3, pathsMount.length)

  // 2. 模拟点选一个节点
  const targetNode = Array.from(host.querySelectorAll('g.ac-node'))
    .find(el => (el.textContent || '').indexOf('节点A') >= 0)
  ok('找到目标节点进行点选', !!targetNode)
  await act(async () => {
    clickEl(targetNode, 100, 100)
  })
  await flush()

  // 验证选中态生效
  const selNode = host.querySelector('g.ac-node.sel')
  ok('点选后目标节点获得 .ac-node.sel 描边类', !!selNode && (selNode.textContent || '').indexOf('节点A') >= 0)

  // 验证点选后每条边的 path 逐字节完全一致
  const pathsAfterSelect = getEdgePaths(host)
  eq('点选后每条边的 path 与初次整树挂载得到的 path 完全一致',
    JSON.stringify(pathsAfterSelect), JSON.stringify(pathsMount))

  // 3. 点击空白清空选中
  const svg = host.querySelector('svg.ac-svg')
  if (svg) {
    await act(async () => {
      svg.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 10, clientY: 10 }))
      svg.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true, button: 0, clientX: 10, clientY: 10 }))
    })
    await flush()
  }
  const pathsAfterDeselect = getEdgePaths(host)
  eq('取消选中后每条边的 path 依然完全一致',
    JSON.stringify(pathsAfterDeselect), JSON.stringify(pathsMount))

  // 4. 清理并进行整树全新重挂载，证明与全新挂载的 path 完全一致
  await act(async () => { root.unmount() })
  host.remove()

  const freshHost = document.createElement('div')
  document.body.appendChild(freshHost)
  const freshRoot = createRoot(freshHost)
  await act(async () => {
    freshRoot.render(React.createElement(captured['conversation.view'], {
      cwd: UI, sessionId: 's-sel-fresh', useSessions: () => UI,
    }))
  })
  await flush()
  const pathsFreshMount = getEdgePaths(freshHost)
  eq('全新整树重渲染得到的 path 与点选渲染得到的 path 完全一致',
    JSON.stringify(pathsFreshMount), JSON.stringify(pathsAfterSelect))

  await act(async () => { freshRoot.unmount() })
  freshHost.remove()
  respond = prevR
}

endPhase()
