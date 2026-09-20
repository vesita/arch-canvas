// 界面渲染冒烟：这一半以前没有任何自动化，而「打开面板是一片空白」「按钮点不动」这类问题
// 只有真渲染才看得出来。这里用 jsdom + React 把 lib/ui.js 完整跑一遍：
//   注册 → 渲染标签体 → 点按钮 → 断言 DOM 与 RPC 调用。
// 注意：它跑的是**构建产物**（lib/ui.js），所以先跑 npm run build（npm test 已经这样串了）。
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'

let pass = 0
let fail = 0
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name) }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')) }
}
const eq = (name, got, want) => ok(name, got === want, { got, want })

// ---------- 最小 DOM ----------
// 顺序要紧：react-dom 在**模块求值期**就用 window/document 探测能力（canUseDOM / isInputEventSupported）。
// DOM 晚一步就位，它会以为环境不支持 input 事件，于是改走 IE 时代的 propertychange 分支 ——
// 症状是 onChange 永远不触发、focusin 直接抛 attachEvent 不存在。所以 React 用动态 import。
const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { pretendToBeVisual: true })
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const ReactModule = await import('react')
const React = ReactModule.default
const act = ReactModule.act
const { createRoot } = await import('react-dom/client')

const UI = '/tmp/uiproj'

// ---------- 打桩的 RPC：形状照着宿主真实的回执 ----------
const rpcCalls = []
const EMPTY_MODEL = { nodes: [], edges: [], groups: [], direction: 'TD', extras: [] }
function fullDoc(extra) {
  return Object.assign({
    ok: true, revision: 1, updatedBy: 'switch',
    model: EMPTY_MODEL, mermaid: 'flowchart TD\n',
    file: UI + '/.arch-canvas/architecture.mmd', diagram: 'architecture', key: 'architecture',
    external: null, project: '', dir: UI + '/.arch-canvas', scope: 'project', workspace: UI,
    tombstoned: false, nodeCount: 0, edgeCount: 0, groupCount: 0, libraryRev: 1, historyCount: 1,
    warnings: [], notes: [], lastChange: null,
  }, extra || {})
}
const LIB_ITEMS = [
  { name: 'architecture', deleted: false, nodes: 0, edges: 0, links: 0, bytes: 254, project: '', key: 'architecture', dir: UI + '/.arch-canvas' },
  { name: 'architecture', deleted: false, nodes: 17, edges: 19, links: 4, bytes: 940, project: 'arch-canvas', key: 'arch-canvas/architecture', dir: UI + '/arch-canvas/.arch-canvas' },
]
const LIB_FILES = [{ path: UI + '/docs/design.mmd', rel: 'docs/design.mmd', name: 'design.mmd', bytes: 120 }]
function respond(method, args) {
  if (method === 'doc:get') return fullDoc()
  if (method === 'doc:rev') return { revision: 1, updatedBy: 'switch', diagram: 'architecture', dir: UI + '/.arch-canvas', libraryRev: 1, external: null }
  if (method === 'doc:list') return { ok: true, dir: UI + '/.arch-canvas', scope: 'project', workspace: UI, current: 'architecture', external: null, items: LIB_ITEMS, files: LIB_FILES, libraryRev: 1 }
  if (method === 'doc:openPath') return fullDoc({ diagram: 'design', key: args.path, external: args.path, file: args.path })
  if (method === 'doc:open') return fullDoc({ diagram: args.key, key: args.key })
  if (method === 'doc:set') {
    const nodes = args && args.model && args.model.nodes ? args.model.nodes : []
    return fullDoc({ model: args.model, nodeCount: nodes.length, revision: 2, updatedBy: 'user' })
  }
  if (method === 'mermaid:info') return { url: '/arch-canvas/mermaid.min.js' }
  if (method === 'ui:info') return { url: '/arch-canvas/ui.js', file: '/dev/null' }
  return { ok: false, error: '没打桩的方法 ' + method }
}

// ---------- 载入界面本体（就是 host 发给浏览器的那份） ----------
let insertedCss = ''
const deps = {
  React,
  styles: { insert: (css) => { insertedCss += css; return () => {} } },
  rpc: (method, args) => { rpcCalls.push({ method, args }); return Promise.resolve(respond(method, args)) },
}
globalThis.__archCanvasDeps = deps
const src = readFileSync(new URL('../lib/ui.js', import.meta.url), 'utf8')
new Function(src)()
ok('ui.js 挂出了 __archCanvas.install', !!(globalThis.__archCanvas && typeof globalThis.__archCanvas.install === 'function'))

// ---------- 注册：捕获槽位组件 ----------
const captured = {}
const capturedDef = {}
// @ 引用源也捕获下来：它现在是**按会话**取快照的（见 studio.ts 的 studioSnapshots），
// 这条规则只能在「两个会话各有一张图」的场景里验，所以必须拿到那个 source 对象本身。
let capturedSource = null
const slots = {
  inject: (_name, cb) => { cb(); return () => {} },
  register: (def, comp) => { captured[def.name] = comp; capturedDef[def.name] = def; return () => {} },
}
const ctx = {
  get: (k) => ({ slots, inputTriggers: { registerSource: (src) => { capturedSource = src; return () => {} } } })[k],
  effect: (fn) => { const d = fn(); return typeof d === 'function' ? d : () => {} },
  inject: () => () => {},
  on: () => () => {},
  interval: () => () => {},
  timeout: () => () => {},
}

console.log('\n[1] 注册面')
const dispose = globalThis.__archCanvas.install(ctx)
ok('注册了主窗口子页标签体', typeof captured['conversation.view'] === 'function')
eq('子页 id 是 arch-canvas', capturedDef['conversation.view'].id, 'arch-canvas')
eq('子页排在「对话」「轨迹」之后', capturedDef['conversation.view'].order, 30)
eq('子页标题', capturedDef['conversation.view'].label, '架构画布')
ok('注册了 @ 引用源（按会话取节点的那条）', !!capturedSource && capturedSource.trigger === '@' && capturedSource.name === 'arch-canvas')
ok('样式里有起始页与选择器的样式', insertedCss.indexOf('.ac-start') >= 0 && insertedCss.indexOf('.ac-lib') >= 0)

// ---------- 渲染标签体 ----------
const container = document.getElementById('app')
const root = createRoot(container)
async function flush() { await act(async () => { await Promise.resolve() }) }

// 「点选一个元素」= 按下与抬手之间**没有位移**。底部详情（.ac-dock）只在抬手那一刻展开：
// 它是一块最多吃掉 46% 高度的下挂面板，拖动途中弹出会把画布挤矮、把节点挤出视野。
// 所以只派发 pointerdown 已经不算「点选」了，测试必须把整点击补全 —— 否则测的是旧契约。
function clickEl(el, x, y) {
  const opts = { bubbles: true, button: 0, clientX: x == null ? 0 : x, clientY: y == null ? 0 : y }
  el.dispatchEvent(new dom.window.PointerEvent('pointerdown', opts))
  el.dispatchEvent(new dom.window.PointerEvent('pointerup', opts))
}

console.log('\n[2] 首次渲染：工具条与空画布都得有出路')
await act(async () => {
  root.render(React.createElement(captured['conversation.view'], {
    cwd: UI, sessionId: 's1', useSessions: () => UI,
  }))
})
await flush()
const html = () => container.innerHTML
const buttons = () => Array.from(container.querySelectorAll('button'))
const byText = (t) => buttons().find((b) => b.textContent.trim() === t)

ok('工具条：＋ 节点', !!byText('＋ 节点'))
ok('工具条：自动布局', !!byText('自动布局'))
ok('工具条：适应窗口', !!byText('适应窗口'))
ok('工具条：删除', !!byText('删除'))
ok('工具条：导出 SVG / PNG / 复制源码', !!byText('SVG') && !!byText('PNG') && !!byText('复制源码'))
ok('工具条：图库入口', !!buttons().find((b) => b.textContent.indexOf('图库') === 0), buttons().map((b) => b.textContent))
ok('工具条：常驻「打开」按钮', !!byText('打开'), buttons().map((b) => b.textContent))
ok('起始页：标题', html().indexOf('这张图还是空的') >= 0)
ok('起始页：三个动作按钮', !!byText('＋ 加一个节点') && !!byText('打开文件…') && !!byText('图库…'), buttons().map((b) => b.textContent))
ok('起始页：列出这个项目里已有的图', html().indexOf('这个项目里的图') >= 0 && html().indexOf('arch-canvas/architecture') >= 0)
ok('起始页：列出项目里的 mermaid 文件', html().indexOf('项目里的 mermaid 文件') >= 0 && html().indexOf('docs/design.mmd') >= 0)

console.log('\n[1b] 检查点：没有「AI 只读」开关了，改成随时可退回的历史')
{
  // 顶栏不该再有那个开关（真机上它永远打不开：写 settings.json 那次没带沙箱策略）
  ok('顶栏不再有「AI 只读」按钮', !byText('AI 只读') && !byText('AI 可改图'), buttons().map((b) => b.textContent))
  ok('面板加载时不再去读 setting:get', !rpcCalls.some((c) => c.method === 'setting:get'), rpcCalls.map((c) => c.method))
  const histBtn = buttons().find((b) => b.textContent.indexOf('历史') === 0)
  ok('顶栏有「历史」按钮（带条数）', !!histBtn, buttons().map((b) => b.textContent))
  eq('条数来自宿主的 historyCount', histBtn && histBtn.textContent.trim(), '历史 1')
}

console.log('\n[2b] 起始页里直接点开一张已有的图')
rpcCalls.length = 0
const startOpen = Array.from(container.querySelectorAll('.ac-start-row button')).find((b) => b.textContent.trim() === '打开' && b.closest('.ac-start-row').textContent.indexOf('arch-canvas/architecture') >= 0)
ok('起始页那一行有「打开」', !!startOpen, Array.from(container.querySelectorAll('.ac-start-row')).map((r) => r.textContent))
await act(async () => { startOpen.click() })
await flush()
const openDiagramCall = rpcCalls.find((c) => c.method === 'doc:open')
ok('调了 doc:open', !!openDiagramCall, rpcCalls.map((c) => c.method))
eq('带上了 key', openDiagramCall && openDiagramCall.args.key, 'arch-canvas/architecture')
eq('带上了 where', openDiagramCall && openDiagramCall.args.where, UI)

console.log('\n[3] 点工具条「打开」：展开选择器并读图库清单')
rpcCalls.length = 0
const toolOpen = container.querySelector('.ac-tools button[title^="打开项目里的"]')
ok('工具条那个「打开」找得到', !!toolOpen)
await act(async () => { toolOpen.click() })
await flush()
ok('调了 doc:list', rpcCalls.some((c) => c.method === 'doc:list'), rpcCalls.map((c) => c.method))
ok('选择器里有「重新扫描」', html().indexOf('重新扫描') >= 0)
ok('选择器里列出图库里的图（含子项目的）', html().indexOf('arch-canvas/architecture') >= 0)
ok('选择器里列出项目里的 mermaid 文件', html().indexOf('docs/design.mmd') >= 0)
const pathInput = container.querySelector('input[placeholder^="按路径打开"]')
ok('选择器里有「按路径打开」输入框', !!pathInput)

console.log('\n[4] 填路径并点「打开」→ 走 doc:openPath')
rpcCalls.length = 0
const setValue = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set
await act(async () => {
  // 先 focus：真实用户也是先点进输入框再打字
  pathInput.focus()
  setValue.call(pathInput, 'docs/design.mmd')
  pathInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
})
const openBtn = container.querySelector('.ac-lib-open button')
ok('选择器那一行有自己的「打开」', !!openBtn && openBtn.textContent.trim() === '打开', openBtn && openBtn.textContent)
ok('输入后按钮变为可用（onChange 确实进了 state）', !!openBtn && !openBtn.disabled, { disabled: openBtn && openBtn.disabled, value: pathInput.value })
await act(async () => { openBtn.click() })
await flush()
const openCall = rpcCalls.find((c) => c.method === 'doc:openPath')
ok('调了 doc:openPath', !!openCall)
eq('带上了 where（会话 cwd）', openCall && openCall.args.where, UI)
eq('带上了路径', openCall && openCall.args.path, 'docs/design.mmd')
// 判「收起」要看结构：起始页的提示文案里也含有「按路径打开」这几个字
ok('选择器随后收起（面板不再挂载）', !container.querySelector('.ac-lib'))

console.log('\n[4b] 空画布起手：「＋ 加一个节点」直接把图带到非空')
rpcCalls.length = 0
const addBtn = container.querySelector('.ac-start-actions button')
eq('起始页第一个动作是「＋ 加一个节点」', addBtn && addBtn.textContent.trim(), '＋ 加一个节点')
await act(async () => { addBtn.click() })
await flush()
const setCall = rpcCalls.find((c) => c.method === 'doc:set')
ok('调了 doc:set（加节点即落盘）', !!setCall, rpcCalls.map((c) => c.method))
eq('提交的模型里确实多了一个节点', setCall && setCall.args.model.nodes.length, 1)
ok('起始页消失（图不再为空）', !container.querySelector('.ac-start'))
ok('画布上出现了一个节点', !!container.querySelector('g.ac-node'))

console.log('\n[4c] 元素注释：带注释渲染、角标、清单已解决切换与检查器操作')
{
  const NOTE_MODEL = {
    nodes: [
      { id: 'n0', label: '无注释节点', shape: 'rect', group: null, x: 0, y: 0, note: '', noteDone: false },
      { id: 'n1', label: '节点甲', shape: 'rect', group: null, x: 100, y: 100, note: '这里为什么不用队列？', noteDone: false },
      { id: 'n2', label: '节点乙', shape: 'rect', group: null, x: 200, y: 100, note: '这里需要限流', noteDone: false },
      { id: 'n3', label: '节点丙', shape: 'rect', group: null, x: 300, y: 100, note: '已确认链路', noteDone: true },
    ],
    edges: [],
    groups: [],
    direction: 'TD',
    extras: [],
  }

  const prevRespond = respond
  let currentModel = JSON.parse(JSON.stringify(NOTE_MODEL))
  respond = function (method, args) {
    if (method === 'doc:get') {
      return fullDoc({ model: currentModel, nodeCount: currentModel.nodes.length })
    }
    if (method === 'doc:set') {
      currentModel = args.model
      const nodes = args && args.model && args.model.nodes ? args.model.nodes : []
      return fullDoc({ model: args.model, nodeCount: nodes.length, revision: 2, updatedBy: 'user' })
    }
    return prevRespond(method, args)
  }

  let draftText = ''
  const mockInputActions = {
    setDraft: (text) => { draftText = text },
  }

  const noteHost = document.createElement('div')
  document.body.appendChild(noteHost)
  const noteRoot = createRoot(noteHost)
  await act(async () => {
    noteRoot.render(React.createElement(captured['conversation.view'], {
      cwd: UI, sessionId: 's1', useSessions: () => UI, inputActions: mockInputActions,
    }))
  })
  await flush()

  // 1. 工具条找得到「留言」按钮，且带未解决数量
  const toolBtns = () => Array.from(noteHost.querySelectorAll('.ac-tools button'))
  const noteToolBtn = () => toolBtns().find((b) => b.textContent.startsWith('留言'))
  ok('工具条：找得到留言按钮，且文案同时给出待办数与总量（「留言 2 · 共 3」）', !!noteToolBtn() && noteToolBtn().textContent.trim() === '留言 2 · 共 3', noteToolBtn()?.textContent)

  // 2. 画布节点角标
  const nodeEls = () => Array.from(noteHost.querySelectorAll('g.ac-node'))
  const findNodeEl = (lbl) => nodeEls().find((el) => el.querySelector('.ac-lbl')?.textContent.trim() === lbl)
  const n0El = findNodeEl('无注释节点')
  const n1El = findNodeEl('节点甲')
  const n3El = findNodeEl('节点丙')

  ok('无注释节点不画角标', !!n0El && !n0El.querySelector('.ac-note-badge'))
  const badge1 = n1El?.querySelector('.ac-note-badge')
  ok('未解决节点角标：class 为 ac-note-badge 且文字为 ✎', !!badge1 && badge1.getAttribute('class') === 'ac-note-badge' && badge1.querySelector('text')?.textContent.trim() === '✎')
  const badge3 = n3El?.querySelector('.ac-note-badge')
  ok('已解决节点角标：class 为 ac-note-badge done 且文字为 ✓', !!badge3 && badge3.getAttribute('class') === 'ac-note-badge done' && badge3.querySelector('text')?.textContent.trim() === '✓')

  // 3. 展开 .ac-notes 面板
  await act(async () => { noteToolBtn().click() })
  await flush()

  const notesPanel = () => noteHost.querySelector('.ac-notes')
  ok('点击工具条按钮展开 .ac-notes 面板', !!notesPanel())

  const headText = notesPanel()?.querySelector('.ac-lib-head')?.textContent || ''
  ok('面板头部文案含总量、未解决与已解决三条数', headText.indexOf('节点留言：共 3 条') >= 0 && headText.indexOf('2 条待办') >= 0 && headText.indexOf('1 条已解决') >= 0, headText)

  // 3b. 头部批量「发送这一轮留言 (N)」按钮正面断言
  const batchSendBtn = () => Array.from(notesPanel()?.querySelectorAll('.ac-lib-head button') || []).find((b) => b.textContent.includes('发送这一轮留言'))
  ok('存在「发送这一轮留言 (2)」按钮', !!batchSendBtn() && batchSendBtn().textContent.trim() === '发送这一轮留言 (2)')

  draftText = ''
  await act(async () => { batchSendBtn().click() })
  await flush()

  ok('批量发送调了 setDraft 且同时包含两条留言的节点 id 与正文',
    draftText.indexOf('`n1`（节点甲）：这里为什么不用队列？') >= 0 &&
    draftText.indexOf('`n2`（节点乙）：这里需要限流') >= 0 &&
    draftText.indexOf('关于画布「') >= 0 &&
    draftText.indexOf('3 条留言') < 0 &&
    draftText.indexOf('2 条留言') >= 0,
    draftText)

  const rows = () => Array.from(notesPanel()?.querySelectorAll('.ac-lib-row') || [])
  const n1Row = () => rows().find((r) => r.textContent.indexOf('n1') >= 0)
  const n3Row = () => rows().find((r) => r.textContent.indexOf('n3') >= 0)

  const n1ItemBtn = () => n1Row()?.querySelector('button.ac-lib-item')
  ok('未解决行：含 ✎、节点 id、label 与注释文本', !!n1ItemBtn() && n1ItemBtn().textContent.indexOf('✎ n1') >= 0 && n1ItemBtn().textContent.indexOf('节点甲') >= 0 && n1ItemBtn().textContent.indexOf('这里为什么不用队列？') >= 0, n1ItemBtn()?.textContent)
  const n1ResolveBtn = () => n1Row()?.querySelector('button.ac-btn')
  eq('未解决行操作按钮为「已解决」', n1ResolveBtn()?.textContent.trim(), '已解决')

  const n3ItemBtn = () => n3Row()?.querySelector('button.ac-lib-item')
  ok('已解决行：class 含 done 且文案以 ✓ 开头', !!n3ItemBtn() && n3ItemBtn().classList.contains('done') && n3ItemBtn().textContent.indexOf('✓ n3') >= 0, n3ItemBtn()?.className)
  const n3ReopenBtn = () => n3Row()?.querySelector('button.ac-btn')
  eq('已解决行操作按钮为「重开」', n3ReopenBtn()?.textContent.trim(), '重开')

  // 4. 在 .ac-notes 里点击「已解决」
  rpcCalls.length = 0
  await act(async () => { n1ResolveBtn().click() })
  await flush()

  const setCall1 = rpcCalls.find((c) => c.method === 'doc:set')
  ok('清单里点「已解决」发出 doc:set', !!setCall1)
  const setNode1 = setCall1?.args?.model?.nodes?.find((n) => n.id === 'n1')
  ok('doc:set 提交的模型里 n1.noteDone 为 true', setNode1 && setNode1.noteDone === true, setNode1)

  const n1ItemAfter = rows().find((r) => r.textContent.indexOf('n1') >= 0)?.querySelector('button.ac-lib-item')
  ok('行变为已解决状态（class 含 done，文案以 ✓ 开头）', !!n1ItemAfter && n1ItemAfter.classList.contains('done') && n1ItemAfter.textContent.indexOf('✓ n1') >= 0)
  eq('工具条待办数更新为 1，总量仍是 3', noteToolBtn()?.textContent.trim(), '留言 1 · 共 3')

  // 5. 选中节点乙（未解决）
  const n2El = findNodeEl('节点乙')
  await act(async () => {
    clickEl(n2El)
  })
  await flush()

  const dock = () => noteHost.querySelector('.ac-dock')
  ok('选中节点后底部检查器出现', !!dock() && dock().textContent.indexOf('节点 n2') >= 0)

  const noteArea = () => dock()?.querySelector('textarea[placeholder*="这里为什么不用队列"]')
  ok('检查器内出现注释 textarea 且 placeholder 符合预期', !!noteArea())
  eq('注释 textarea 内容为当前节点注释', noteArea()?.value, '这里需要限流')

  const markBtn = () => dock()?.querySelector('.ac-note-actions button')
  eq('有未解决注释时按钮文案为「标记已解决」', markBtn()?.textContent.trim(), '标记已解决')

  const sendAiBtn = () => Array.from(dock()?.querySelectorAll('.ac-note-actions button') || []).find((b) => b.textContent.trim() === '发送给 AI')
  ok('检查器内出现「发送给 AI」按钮', !!sendAiBtn())
  ok('有留言时「发送给 AI」按钮可用', sendAiBtn() && !sendAiBtn().disabled)

  draftText = ''
  await act(async () => { sendAiBtn().click() })
  await flush()
  ok('点击「发送给 AI」调了 setDraft 且包含节点标题与留言', draftText.indexOf('节点乙') >= 0 && draftText.indexOf('这里需要限流') >= 0, draftText)

  rpcCalls.length = 0
  await act(async () => { markBtn().click() })
  await flush()

  const setCall2 = rpcCalls.find((c) => c.method === 'doc:set')
  ok('检查器点「标记已解决」发出 doc:set', !!setCall2)
  const setNode2 = setCall2?.args?.model?.nodes?.find((n) => n.id === 'n2')
  ok('doc:set 提交的模型里 n2.noteDone 为 true', setNode2 && setNode2.noteDone === true, setNode2)
  eq('标记已解决后检查器按钮文案变为「重新打开」', markBtn()?.textContent.trim(), '重新打开')

  // 6. 全部解决后的工具条与提示文案
  //    旧契约是「全部解决后变回『留言』」—— 那正是用户报的「总量统计漏了已解决的」：
  //    按钮上不再有数字，看起来像一条留言都没有。现在待办数归零，但**总量还在**。
  eq('全部解决后：待办数归零，总量仍报出来', noteToolBtn()?.textContent.trim(), '留言 · 共 3')
  ok('全部解决后按钮不再高亮（未解决时才是 primary）',
    !noteToolBtn()?.classList.contains('primary'), noteToolBtn()?.className)
  ok('提示里说清「共几条、其中几条待办」',
    (noteToolBtn()?.getAttribute('title') || '').indexOf('共 3 条，其中 0 条待办') >= 0,
    noteToolBtn()?.getAttribute('title'))
  ok('没有未解决注释时面板提示「没有未解决的留言」', notesPanel()?.textContent.indexOf('没有未解决的留言') >= 0)

  // 7. 检查器点「重新打开」
  rpcCalls.length = 0
  await act(async () => { markBtn().click() })
  await flush()
  const setCall3 = rpcCalls.find((c) => c.method === 'doc:set')
  ok('检查器点「重新打开」发出 doc:set', !!setCall3)
  const setNode3 = setCall3?.args?.model?.nodes?.find((n) => n.id === 'n2')
  ok('doc:set 提交的模型里 n2.noteDone 为 false', setNode3 && setNode3.noteDone === false, setNode3)
  eq('重新打开后检查器按钮文案变回「标记已解决」', markBtn()?.textContent.trim(), '标记已解决')
  eq('重新打开后工具条待办数恢复为 1', noteToolBtn()?.textContent.trim(), '留言 1 · 共 3')

  // 8. 改一条**已解决**留言的正文 → 自动重新打开（用户报的「留言区被编辑后应该自动重新打开」）。
  //    不改的话，用户改过的话仍然躺在「已解决」里、不进 AI 的上下文 —— 界面看不出任何异常。
  const n3ElSel = findNodeEl('节点丙')
  await act(async () => {
    clickEl(n3ElSel)
  })
  await flush()
  eq('选中本来就是「已解决」的节点丙，检查器按钮为「重新打开」', markBtn()?.textContent.trim(), '重新打开')

  rpcCalls.length = 0
  const n3Area = () => dock()?.querySelector('textarea[placeholder*="这里为什么不用队列"]')
  const setAreaValue3 = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set
  await act(async () => {
    setAreaValue3.call(n3Area(), '已确认链路，但我又改了一下')
    n3Area().dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
  await flush()
  await act(async () => {
    n3Area().dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })
  await flush()

  const setCall4 = rpcCalls.find((c) => c.method === 'doc:set')
  ok('改已解决留言的正文发出 doc:set', !!setCall4, rpcCalls.map((c) => c.method))
  const setNode4 = setCall4?.args?.model?.nodes?.find((n) => n.id === 'n3')
  eq('改过正文后 n3.note 是新文本', setNode4?.note, '已确认链路，但我又改了一下')
  ok('改过正文后 n3.noteDone 自动变回 false（重新打开）', setNode4 && setNode4.noteDone === false, setNode4)
  eq('检查器按钮随之变回「标记已解决」', markBtn()?.textContent.trim(), '标记已解决')
  eq('工具条待办数把它算回来了', noteToolBtn()?.textContent.trim(), '留言 2 · 共 3')

  // 负向对照：只点「标记已解决」、不动正文时**不许**被自动重开
  // （否则「标记已解决」这个按钮自己会把自己掀回来，功能就废了）。
  rpcCalls.length = 0
  await act(async () => { markBtn().click() })
  await flush()
  const setCall5 = rpcCalls.find((c) => c.method === 'doc:set')
  const setNode5 = setCall5?.args?.model?.nodes?.find((n) => n.id === 'n3')
  ok('负向对照：只改状态、不改正文 → 仍是已解决', setNode5 && setNode5.noteDone === true, setNode5)
  eq('负向对照：按钮变回「重新打开」', markBtn()?.textContent.trim(), '重新打开')

  await act(async () => { noteRoot.unmount() })
  noteHost.remove()
  respond = prevRespond
}

console.log('\n[4d] 代码锚点与一句话总结：角标 / 失效可见 / 锚点编辑 / 清单里的总结')
{
  const REF_MODEL = {
    nodes: [
      { id: 'r0', label: '无锚点', shape: 'rect', group: null, x: 0, y: 0, note: '', noteDone: false, files: [] },
      { id: 'r1', label: '解析器', shape: 'rect', group: null, x: 140, y: 0, note: '', noteDone: false, files: ['src/host/mermaid.ts#parseMermaid'] },
      { id: 'r2', label: '坏锚点', shape: 'rect', group: null, x: 280, y: 0, note: '', noteDone: false, files: ['src/host/没了.ts'] },
    ],
    edges: [], groups: [], direction: 'TD', extras: [],
    summary: '这张图的一句话总结',
  }
  const REF_STATUS = {
    r1: { 'src/host/mermaid.ts#parseMermaid': 'ok' },
    r2: { 'src/host/没了.ts': 'missing' },
  }
  const REF_ITEMS = [
    { name: 'architecture', deleted: false, nodes: 3, edges: 0, links: 0, bytes: 300, project: '', key: 'architecture', dir: UI + '/.arch-canvas', summary: '这张图的一句话总结' },
    { name: 'other', deleted: false, nodes: 2, edges: 1, links: 0, bytes: 120, project: '', key: 'other', dir: UI + '/.arch-canvas', summary: '另一张图的总结' },
  ]

  const prevRespond = respond
  let currentModel = JSON.parse(JSON.stringify(REF_MODEL))
  let lastSetArgs = null
  let emptyMode = false
  respond = function (method, args) {
    if (emptyMode && method === 'doc:get') {
      return fullDoc({ model: EMPTY_MODEL, mermaid: 'flowchart TD\n', nodeCount: 0, summary: '这张图的一句话总结', fileStatus: {} })
    }
    if (method === 'doc:get') {
      return fullDoc({ model: currentModel, nodeCount: currentModel.nodes.length, summary: currentModel.summary, fileStatus: REF_STATUS })
    }
    if (method === 'doc:set') {
      lastSetArgs = args
      currentModel = args.model
      return fullDoc({ model: args.model, nodeCount: args.model.nodes.length, summary: args.model.summary, fileStatus: REF_STATUS, revision: 2, updatedBy: 'user' })
    }
    if (method === 'doc:list') {
      return {
        ok: true, dir: UI + '/.arch-canvas', scope: 'project', workspace: UI, current: 'architecture',
        external: null, items: REF_ITEMS, files: [], libraryRev: 2,
      }
    }
    return prevRespond(method, args)
  }

  const refHost = document.createElement('div')
  document.body.appendChild(refHost)
  const refRoot = createRoot(refHost)
  await act(async () => {
    refRoot.render(React.createElement(captured['conversation.view'], {
      cwd: UI, sessionId: 's1', useSessions: () => UI,
    }))
  })
  await flush()

  // 1. 角标：有锚点的节点右下角画 ▤，失效的变红（class broken）
  const refNodeEls = () => Array.from(refHost.querySelectorAll('g.ac-node'))
  const findRefNode = (lbl) => refNodeEls().find((el) => el.querySelector('.ac-lbl')?.textContent.trim() === lbl)
  ok('无锚点的节点不画锚点角标', !!findRefNode('无锚点') && !findRefNode('无锚点').querySelector('.ac-file-badge'))
  const okBadge = findRefNode('解析器')?.querySelector('.ac-file-badge')
  ok('有效锚点：class 为 ac-file-badge 且文字为 ▤',
    !!okBadge && okBadge.getAttribute('class') === 'ac-file-badge' && okBadge.querySelector('text')?.textContent.trim() === '▤')
  const badBadge = findRefNode('坏锚点')?.querySelector('.ac-file-badge')
  ok('失效锚点：class 为 ac-file-badge broken（画布上直接看得出来）',
    !!badBadge && badBadge.getAttribute('class') === 'ac-file-badge broken', badBadge?.getAttribute('class'))

  // 2. 检查器里的锚点输入框与逐条校验状态
  const selectRefNode = async (lbl) => {
    await act(async () => {
      clickEl(findRefNode(lbl))
    })
    await flush()
  }
  const refDock = () => refHost.querySelector('.ac-dock')
  const refArea = () => refDock()?.querySelector('textarea[placeholder^="例如：src/host/mermaid.ts"]')

  await selectRefNode('解析器')
  ok('检查器里有代码锚点 textarea', !!refArea())
  eq('textarea 内容是该节点的锚点', refArea()?.value, 'src/host/mermaid.ts#parseMermaid')
  eq('校验为 ok 的行带 ✓',
    refDock()?.querySelector('.ac-ref-status')?.textContent.indexOf('✓ src/host/mermaid.ts#parseMermaid') >= 0, true)

  await selectRefNode('坏锚点')
  eq('失效锚点的 textarea 内容', refArea()?.value, 'src/host/没了.ts')
  const badRow = refDock()?.querySelector('.ac-ref-status .ac-ref-bad')
  ok('失效锚点在检查器里标红并写明原因',
    !!badRow && badRow.textContent.indexOf('⚠') >= 0 && badRow.textContent.indexOf('文件不在') >= 0, badRow?.textContent)

  // 3. 改锚点：回车提交 → doc:set 带上新的 files
  rpcCalls.length = 0
  const setAreaValue = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set
  await act(async () => {
    setAreaValue.call(refArea(), 'src/host/mermaid.ts\n\n  src/client/runtime.ts#cloneModel  ')
    refArea().dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
  await flush()
  await act(async () => {
    refArea().dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })
  await flush()

  const refSet = rpcCalls.find((c) => c.method === 'doc:set')
  ok('回车提交锚点发出 doc:set', !!refSet, rpcCalls.map((c) => c.method))
  const refNodeAfter = refSet?.args?.model?.nodes?.find((n) => n.id === 'r2')
  ok('提交的模型里锚点按行切分、trim、丢掉空行',
    JSON.stringify(refNodeAfter?.files) === JSON.stringify(['src/host/mermaid.ts', 'src/client/runtime.ts#cloneModel']),
    refNodeAfter?.files)
  ok('提交的模型里带上了一句话总结（图级字段不能被界面弄丢）',
    refSet?.args?.model?.summary === '这张图的一句话总结', refSet?.args?.model?.summary)

  // 4. 图库选择器里每张图带上它的一句话总结
  const openToolBtn = Array.from(refHost.querySelectorAll('.ac-tools button')).find((b) => b.getAttribute('title')?.startsWith('打开项目里的'))
  await act(async () => { openToolBtn.click() })
  await flush()
  const libItemTexts = Array.from(refHost.querySelectorAll('.ac-lib-item')).map((b) => b.textContent)
  ok('选择器里当前这张图带上了 summary',
    libItemTexts.some((t) => t.indexOf('architecture') >= 0 && t.indexOf('这张图的一句话总结') >= 0), libItemTexts)
  ok('选择器里别的图也带上了 summary',
    libItemTexts.some((t) => t.indexOf('other') >= 0 && t.indexOf('另一张图的总结') >= 0), libItemTexts)

  // 5. 起始页（空图）里也用总结说明「这个项目里有什么图」
  emptyMode = true
  const startHost = document.createElement('div')
  document.body.appendChild(startHost)
  const startRoot = createRoot(startHost)
  await act(async () => {
    startRoot.render(React.createElement(captured['conversation.view'], {
      cwd: UI, sessionId: 's2', useSessions: () => UI,
    }))
  })
  await flush()
  const startSums = Array.from(startHost.querySelectorAll('.ac-start-sum')).map((el) => el.textContent)
  ok('起始页的图列表里显示别的图的 summary', startSums.indexOf('另一张图的总结') >= 0, startSums)
  emptyMode = false

  await act(async () => { startRoot.unmount() })
  await act(async () => { refRoot.unmount() })
  startHost.remove()
  refHost.remove()
  respond = prevRespond
}

console.log('\n[4e] 检查点清单：谁改的、点「退回」真发 RPC')
{
  const HIST_MODEL = {
    nodes: [
      { id: 'h1', label: '入口', shape: 'rect', group: null, x: 0, y: 0, note: '', noteDone: false, files: [] },
      { id: 'h2', label: '核心（用户改）', shape: 'rect', group: null, x: 140, y: 0, note: '', noteDone: false, files: [] },
    ],
    edges: [], groups: [], direction: 'TD', extras: [], summary: '',
  }
  const AI_MODEL = {
    nodes: [
      { id: 'h1', label: '入口', shape: 'rect', group: null, x: 0, y: 0, note: '', noteDone: false, files: [] },
      { id: 'h2', label: '核心', shape: 'rect', group: null, x: 140, y: 0, note: '', noteDone: false, files: [] },
      { id: 'hCache', label: '缓存层', shape: 'rect', group: null, x: 280, y: 0, note: '', noteDone: false, files: [] },
    ],
    edges: [], groups: [], direction: 'TD', extras: [], summary: '',
  }
  const T0 = Date.now()
  let HIST_ENTRIES = [
    { seq: 3, rev: 3, by: 'user', at: T0, site: 'doc:set', nodeCount: 2, edgeCount: 0, changed: ['h2'], current: true },
    { seq: 2, rev: 2, by: 'ai', at: T0 - 60000, site: 'arch_edit', nodeCount: 3, edgeCount: 0, changed: ['hCache'], current: false },
    { seq: 1, rev: 0, by: 'open', at: T0 - 120000, site: 'open', nodeCount: 2, edgeCount: 0, changed: [], current: false },
  ]

  const prevRespond = respond
  let curModel = JSON.parse(JSON.stringify(HIST_MODEL))
  let rollbackArgs = null
  respond = function (method, args) {
    if (method === 'doc:get') {
      return fullDoc({ model: curModel, nodeCount: curModel.nodes.length, historyCount: HIST_ENTRIES.length })
    }
    if (method === 'doc:history') {
      return { ok: true, file: UI + '/.arch-canvas/architecture.mmd', diagram: 'architecture', limit: 50, entries: HIST_ENTRIES }
    }
    if (method === 'doc:rollback') {
      rollbackArgs = args
      // 宿主会把「退回到的那一份」装回文档，并在末尾追加一条 by=user 的检查点
      curModel = JSON.parse(JSON.stringify(AI_MODEL))
      HIST_ENTRIES = [
        { seq: 4, rev: 4, by: 'user', at: Date.now(), site: 'rollback:' + args.seq, nodeCount: 3, edgeCount: 0, changed: [], current: true },
        ...HIST_ENTRIES,
      ]
      return fullDoc({ model: curModel, nodeCount: curModel.nodes.length, historyCount: HIST_ENTRIES.length, revision: 4, updatedBy: 'user' })
    }
    return prevRespond(method, args)
  }

  const histHost = document.createElement('div')
  document.body.appendChild(histHost)
  const histRoot = createRoot(histHost)
  await act(async () => {
    histRoot.render(React.createElement(captured['conversation.view'], {
      cwd: UI, sessionId: 's1', useSessions: () => UI,
    }))
  })
  await flush()

  const histBtns = () => Array.from(histHost.querySelectorAll('.ac-bar button'))
  const histBtn = () => histBtns().find((b) => b.textContent.indexOf('历史') === 0)
  ok('顶栏「历史」按钮带条数', !!histBtn() && histBtn().textContent.trim() === '历史 3', histBtns().map((b) => b.textContent))

  rpcCalls.length = 0
  await act(async () => { histBtn().click() })
  await flush()

  const panel = () => histHost.querySelector('.ac-hist')
  ok('点开后出现检查点面板', !!panel())
  const histCall = rpcCalls.find((c) => c.method === 'doc:history')
  ok('打开面板时拉清单，并带上会话上下文', !!histCall && histCall.args.where === UI && histCall.args.session === 's1', histCall && histCall.args)
  ok('面板头部说明「只在内存里，重启会清空」', (panel()?.querySelector('.ac-lib-head')?.textContent || '').indexOf('重启 dsh 会清空') >= 0,
    panel()?.querySelector('.ac-lib-head')?.textContent)

  const rows = () => Array.from(panel()?.querySelectorAll('.ac-lib-row') || [])
  eq('三份检查点都列出来了', rows().length, 3)
  const aiRow = rows().find((r) => r.textContent.indexOf('AI') === 0)
  const userRow = rows().find((r) => r.textContent.indexOf('● 用户') === 0)
  ok('AI 那一行标出作者与改动节点', !!aiRow && aiRow.textContent.indexOf('hCache') >= 0, aiRow?.textContent)
  ok('AI 那一行带 ai 样式（左侧蓝条）', !!aiRow && aiRow.querySelector('.ac-hist-item')?.classList.contains('ai'), aiRow?.querySelector('.ac-hist-item')?.className)
  ok('当前那一行标「当前」且没有退回按钮',
    !!userRow && userRow.textContent.indexOf('当前') >= 0 && !userRow.querySelector('button'), userRow?.textContent)

  // 点「退回」先要确认（与删除图同一种谨慎）
  const backBtn = () => aiRow.querySelector('button')
  eq('非当前行的按钮是「退回」', backBtn()?.textContent.trim(), '退回')
  await act(async () => { backBtn().click() })
  await flush()
  const yes = () => Array.from(aiRow.querySelectorAll('button')).find((b) => b.textContent.trim() === '确认退回')
  ok('点一下先变成确认（不直接退回）', !!yes(), Array.from(aiRow.querySelectorAll('button')).map((b) => b.textContent))

  rpcCalls.length = 0
  await act(async () => { yes().click() })
  await flush()

  ok('确认后发出 doc:rollback', !!rollbackArgs, rpcCalls.map((c) => c.method))
  eq('带上要退回的 seq', rollbackArgs && rollbackArgs.seq, 2)
  eq('带上 where（历史按文件存，宿主得落到同一个图库）', rollbackArgs && rollbackArgs.where, UI)
  const labelsAfter = Array.from(histHost.querySelectorAll('g.ac-node .ac-lbl')).map((el) => el.textContent.trim())
  ok('退回后画布换成那份快照的内容', labelsAfter.indexOf('缓存层') >= 0, labelsAfter)
  const histBtnAfter = histBtns().find((b) => b.textContent.indexOf('历史') === 0)
  ok('退回本身也留了一份（条数从 3 变 4）', !!histBtnAfter && histBtnAfter.textContent.trim() === '历史 4', histBtnAfter?.textContent)

  await act(async () => { histRoot.unmount() })
  histHost.remove()
  respond = prevRespond
}

console.log('\n[4f] 节点卡片分段与源码页解析警告')
{
  const CARD_MODEL = {
    nodes: [
      {
        id: 'c1',
        label: '核心服务\n意图：处理高并发请求\n原理：基于事件循环与非阻塞IO\n补充说明行',
        shape: 'rect', group: null, x: 100, y: 100,
        note: '', noteDone: false,
        files: ['src/server/core.ts#startServer'],
      },
      {
        id: 'c0',
        label: '单行无锚点',
        shape: 'rect', group: null, x: 300, y: 100,
        note: '', noteDone: false,
        files: [],
      },
    ],
    edges: [], groups: [], direction: 'TD', extras: [], summary: '',
  }
  const SAMPLE_WARNS = ['第 3 行没能解析', '注释 @note n9 指向不存在的节点']

  const prevRespond = respond
  let currentModel = JSON.parse(JSON.stringify(CARD_MODEL))
  let currentWarnings = SAMPLE_WARNS
  respond = function (method, args) {
    if (method === 'doc:get') {
      return fullDoc({
        model: currentModel,
        nodeCount: currentModel.nodes.length,
        warnings: currentWarnings,
      })
    }
    return prevRespond(method, args)
  }

  const cardHost = document.createElement('div')
  document.body.appendChild(cardHost)
  const cardRoot = createRoot(cardHost)
  await act(async () => {
    cardRoot.render(React.createElement(captured['conversation.view'], {
      cwd: UI, sessionId: 's1', useSessions: () => UI,
    }))
  })
  await flush()

  // 1. 节点卡片分段渲染
  const cardNodes = () => Array.from(cardHost.querySelectorAll('g.ac-node'))
  const findCardNode = (firstLine) => cardNodes().find((el) => el.querySelector('.ac-lbl')?.textContent.trim() === firstLine)
  const c1El = findCardNode('核心服务')
  const c0El = findCardNode('单行无锚点')

  // a. 多行 label 的节点：.ac-lbl 的 textContent 恰好等于第一段
  eq('多行节点的 .ac-lbl textContent 恰好等于第一段标题', c1El?.querySelector('.ac-lbl')?.textContent, '核心服务')

  // a2. 默认（未选中）**只画标题**：描述与引用行都不渲染 —— 这是刻意的空间节省，
  //     所以必须是负向断言（元素不存在），而不是"有但看不见"。
  ok('未选中时节点不画 .ac-desc', !c1El?.querySelector('.ac-desc'))
  ok('未选中时节点不画 .ac-ref', !c1El?.querySelector('.ac-ref'))
  // 记下**未选中时**的方块高度 —— 下面要证明"选中不改变几何"
  const c1HeightIdle = c1El?.querySelector('rect:not(.ac-pulse)')?.getAttribute('height')

  // a3. 点一下节点 = 选中 = 展开：描述与引用行这时才出现。
  await act(async () => {
    clickEl(c1El)
  })
  await flush()
  // a3. 选中**不再展开**（2026-09 用户要求取消就地展开，具体信息一律去检查器里看）。
  //     所以这里是负向契约：点开之后画布上依然只有标题。
  const c1Open = findCardNode('核心服务')
  ok('选中后画布节点依然不画 .ac-desc（不再就地展开）', !c1Open?.querySelector('.ac-desc'))
  ok('选中后画布节点依然不画 .ac-ref', !c1Open?.querySelector('.ac-ref'))
  eq('选中后 .ac-lbl 仍然只是标题那一段', c1Open?.querySelector('.ac-lbl')?.textContent, '核心服务')

  // a4. 取消展开带来的一条硬性质：**选中不改变节点几何**。
  //     尺寸要是还跟着 sel 走，点一下方块就会让它长大一圈 —— 连在它上面的线全都要重画，
  //     看上去就是"点一下就抖"。所以直接量方块高度，选中前后必须一样。
  eq('节点高度不随选中变化（几何稳定，连线不会因为点一下而重画）',
    c1Open?.querySelector('rect:not(.ac-pulse)')?.getAttribute('height'), c1HeightIdle)

  // a5. 描述与引用没有丢 —— 它们现在只在检查器里（那一侧由 [4d] 节守着）。
  //     这里钉的是画布这一侧：一个都不画。
  ok('选中后画布上不再出现完整 label（只剩标题，没有「意图/原理」那些行）',
    (c1Open?.querySelector('.ac-lbl')?.textContent || '').indexOf('意图') < 0,
    c1Open?.querySelector('.ac-lbl')?.textContent)
  // d. 锚点行也只在检查器里 —— 画布上不再有 .ac-ref（见上面 a3 的负向契约）。

  // e. 负向对照：不带 files 的节点**即使展开**也没有 .ac-ref。
  //    必须展开后再断言 —— 不展开的话"没有 .ac-ref"是必然的，断言会恒真、抓不到任何回归。
  await act(async () => {
    clickEl(c0El)
  })
  await flush()
  const c0Open = findCardNode('单行无锚点')
  ok('不带 files 的节点没有 .ac-ref', !c0Open?.querySelector('.ac-ref'))

  // f. 负向对照：单行 label 的节点展开后仍没有 .ac-desc（它本来就没有描述段）
  ok('单行 label 的节点没有 .ac-desc', !c0Open?.querySelector('.ac-desc'))

  // 2. 源码页解析警告
  // g. warnings 非空时切到源码页，.ac-warn 存在、.ac-warn-h 含条数、.ac-warn-i 条数与 warnings 数一致
  const tabs = Array.from(cardHost.querySelectorAll('.ac-tabs button'))
  const textTab = tabs.find((b) => b.textContent.trim() === '源码')
  ok('找到「源码」标签按钮', !!textTab)
  await act(async () => { textTab.click() })
  await flush()

  const warnBox = cardHost.querySelector('.ac-warn')
  ok('warnings 非空时源码页显示 .ac-warn', !!warnBox)
  const warnH = warnBox?.querySelector('.ac-warn-h')
  ok('.ac-warn-h 文案包含条数与警告标记', (warnH?.textContent || '').indexOf('2') >= 0 && (warnH?.textContent || '').indexOf('⚠ 解析警告') >= 0, warnH?.textContent)
  const warnItems = Array.from(warnBox?.querySelectorAll('.ac-warn-i') || [])
  eq('.ac-warn-i 条数与 warnings 数量一致', warnItems.length, SAMPLE_WARNS.length)
  ok('第 1 条 warning 文本匹配', warnItems[0]?.textContent === SAMPLE_WARNS[0], warnItems[0]?.textContent)
  ok('第 2 条 warning 文本匹配', warnItems[1]?.textContent === SAMPLE_WARNS[1], warnItems[1]?.textContent)

  await act(async () => { cardRoot.unmount() })
  cardHost.remove()

  // h. 负向对照：warnings 为空时没有 .ac-warn
  currentWarnings = []
  const cleanHost = document.createElement('div')
  document.body.appendChild(cleanHost)
  const cleanRoot = createRoot(cleanHost)
  await act(async () => {
    cleanRoot.render(React.createElement(captured['conversation.view'], {
      cwd: UI, sessionId: 's1', useSessions: () => UI,
    }))
  })
  await flush()

  const cleanTabs = Array.from(cleanHost.querySelectorAll('.ac-tabs button'))
  const cleanTextTab = cleanTabs.find((b) => b.textContent.trim() === '源码')
  await act(async () => { cleanTextTab.click() })
  await flush()

  ok('warnings 为空时源码页没有 .ac-warn', !cleanHost.querySelector('.ac-warn'))

  await act(async () => { cleanRoot.unmount() })
  cleanHost.remove()
  respond = prevRespond
}

console.log('\n[4g] 源码页语法高亮')
{
  const HL_MERMAID = [
    '%%! @note 格式说明模板',
    '%% @pos n1 0 0',
    '%% @note n1 这里是注释',
    'flowchart TD',
    '  n1["标签"] --> n9["a < b & c"]',
  ].join('\n')

  const prevRespond = respond
  respond = function (method, args) {
    if (method === 'doc:get') {
      return fullDoc({
        mermaid: HL_MERMAID,
      })
    }
    return prevRespond(method, args)
  }

  const hlHost = document.createElement('div')
  document.body.appendChild(hlHost)
  const hlRoot = createRoot(hlHost)
  await act(async () => {
    hlRoot.render(React.createElement(captured['conversation.view'], {
      cwd: UI, sessionId: 's1', useSessions: () => UI,
    }))
  })
  await flush()

  // 切到源码页
  const tabs = Array.from(hlHost.querySelectorAll('.ac-tabs button'))
  const textTab = tabs.find((b) => b.textContent.trim() === '源码')
  ok('找到「源码」标签按钮', !!textTab)
  await act(async () => { textTab.click() })
  await flush()

  // a. 切到源码页后，.ac-hl 与 textarea.ac-area 同时存在
  const hlPre = hlHost.querySelector('pre.ac-hl')
  const area = hlHost.querySelector('textarea.ac-area')
  ok('源码页内存在 pre.ac-hl 高亮底层', !!hlPre)
  ok('源码页内存在 textarea.ac-area 编辑层', !!area)
  ok('.ac-editwrap 容器内包裹 pre.ac-hl 与 textarea', !!hlHost.querySelector('.ac-editwrap pre.ac-hl') && !!hlHost.querySelector('.ac-editwrap textarea.ac-area'))

  // ---- 用户报的源码页两个 bug（文本逐渐变白 / 滚轮滑不动）----
  // 两个症状都出在这一层 CSS 上，所以这里直接量规则文本，不靠"看着像"。
  const cssRule = (sel) => {
    const i = insertedCss.indexOf(sel + '{')
    return i < 0 ? '' : insertedCss.slice(i + sel.length + 1, insertedCss.indexOf('}', i))
  }
  const pulseRule = cssRule('.ac-pulse')
  const hlRule = cssRule('.ac-hl')
  const areaHlRule = cssRule('.ac-area-hl')
  const wrapRule = cssRule('.ac-textwrap')
  // 「文本逐渐变白」的根因：脉动环（SVG <rect>）与代码高亮层（DOM <pre>）从前共用 .ac-hl，
  // 于是 `animation:acPulse ... forwards` 被一起焊在代码层上 —— 终帧 opacity:0，2.6 秒后整层透明。
  ok('脉动环有自己的类 .ac-pulse，动画挂在它身上', pulseRule.indexOf('acPulse') >= 0, pulseRule)
  ok('负向对照：代码高亮层 .ac-hl 上不再有 animation / acPulse',
    hlRule.indexOf('animation') < 0 && hlRule.indexOf('acPulse') < 0, hlRule)
  ok('关键帧 acPulse 的终帧确实是 opacity:0（所以上面那条负向断言不是空转）',
    /@keyframes acPulse\{[^@]*100%\{opacity:0\}\}/.test(insertedCss))
  ok('脉动环用的还是同一个动画名（换类名没有把环本身弄坏）',
    insertedCss.indexOf('@keyframes acPulse') >= 0 && pulseRule.indexOf('animation:acPulse') >= 0, pulseRule)
  // 「滚轮滑不动」：两个滚动口互相同步注定错位；现在两层都不滚动，页级 .ac-textwrap 是唯一的口。
  ok('代码高亮层不再自己滚动（没有 overflow:auto）', hlRule.indexOf('overflow:auto') < 0, hlRule)
  ok('编辑层也不再自己滚动（overflow:hidden，高度跟着 <pre> 走）', areaHlRule.indexOf('overflow:hidden') >= 0, areaHlRule)
  ok('唯一滚动口 .ac-textwrap 是 overflow:auto', wrapRule.indexOf('overflow:auto') >= 0, wrapRule)
  ok('滚动口里的子项一律不压缩（否则列向 flex 把它们挤扁，永远超不出去）',
    cssRule('.ac-textwrap > *').indexOf('flex:0 0 auto') >= 0, cssRule('.ac-textwrap > *'))
  ok('源码区直接挂在滚动口下', !!hlHost.querySelector('.ac-textwrap > .ac-editwrap'))
  ok('编辑层是绝对定位铺满 <pre> 撑出的高度', areaHlRule.indexOf('position:absolute') >= 0, areaHlRule)
  ok('<pre> 回到正常流（由它决定滚动高度）', hlRule.indexOf('position:relative') >= 0, hlRule)
  // 两层必须逐项对齐，差一项光标就与文字错位 —— tab-size 从前只有 <pre> 有（textarea 默认 8）
  ok('两层的 tab-size 一致', hlRule.indexOf('tab-size:2') >= 0 && areaHlRule.indexOf('tab-size:2') >= 0, hlRule + ' || ' + areaHlRule)

  // 行容器：.ac-hl 内每行一个 <div>
  const lineDivs = Array.from(hlPre?.querySelectorAll('div') || [])
  eq('高亮行数与文本行数一致（每行一个 div）', lineDivs.length, HL_MERMAID.split('\n').length)

  // 辅助函数：在一行内找到某个 class 的 token span
  const findTokenInLine = (lineIdx, cls) => lineDivs[lineIdx]?.querySelector('span.' + cls)
  const allTokensInLine = (lineIdx) => Array.from(lineDivs[lineIdx]?.querySelectorAll('span') || [])

  // c. %%! 开头的说明行归 ac-hl-c（第 0 行）
  const cToken = findTokenInLine(0, 'ac-hl-c')
  ok('%%! 说明行归 ac-hl-c', !!cToken && cToken.textContent.indexOf('%%! @note') >= 0, cToken?.textContent)

  // d. %% @pos n1 0 0 归 ac-hl-m（第 1 行）
  const mToken = findTokenInLine(1, 'ac-hl-m')
  ok('%% @pos 元数据行归 ac-hl-m', !!mToken && mToken.textContent.indexOf('%% @pos') >= 0, mToken?.textContent)

  // b. 桩文本里的 %% @note n1 xxx 这一行渲染出的 token class 含 ac-hl-u（第 2 行）
  const uToken = findTokenInLine(2, 'ac-hl-u')
  ok('%% @note 用户数据行归 ac-hl-u', !!uToken && uToken.textContent.indexOf('%% @note') >= 0, uToken?.textContent)

  // e. flowchart 是 ac-hl-k（第 3 行）
  const kToken = findTokenInLine(3, 'ac-hl-k')
  ok('flowchart 关键字归 ac-hl-k', !!kToken && kToken.textContent.trim() === 'flowchart', kToken?.textContent)

  // f. n1["标签"] 里的 "标签" 是 ac-hl-s（第 4 行）
  const sTokens = Array.from(lineDivs[4]?.querySelectorAll('span.ac-hl-s') || [])
  const labelStrToken = sTokens.find((s) => s.textContent === '"标签"')
  ok('"标签" 字符串字面量归 ac-hl-s', !!labelStrToken, sTokens.map((s) => s.textContent))

  // g. --> 是 ac-hl-a（第 4 行）
  const aToken = findTokenInLine(4, 'ac-hl-a')
  ok('--> 连线箭头归 ac-hl-a', !!aToken && aToken.textContent.trim() === '-->', aToken?.textContent)

  // h. 负向对照（安全）：桩文本里含 < 和 &（"a < b & c"），内部没有真的 <b> 等 HTML 元素被创建
  ok('.ac-hl 内部没有真的 <b> 元素生成', !hlPre?.querySelector('b'))
  // 且字符串里的 < 和 & 作为纯文本渲染，没被二次实体转义成 &amp; 字符展示
  const htmlRaw = hlPre?.innerHTML || ''
  ok('pre 内没有未闭合或误解析的 HTML 标签结构', htmlRaw.indexOf('<b ') === -1 && htmlRaw.indexOf('<b>') === -1)
  const escapedStrToken = sTokens.find((s) => s.textContent === '"a < b & c"')
  ok('"a < b & c" 作为文本原样保留在 span 中', !!escapedStrToken && escapedStrToken.textContent === '"a < b & c"', escapedStrToken?.textContent)

  await act(async () => { hlRoot.unmount() })
  hlHost.remove()
  respond = prevRespond
}

console.log('\n[4h] 组折叠')
{
  const FOLD_MODEL = {
    nodes: [
      { id: 'f1', label: '服务A', shape: 'rect', group: 'g1', x: 100, y: 100, note: '', noteDone: false, files: [] },
      { id: 'f2', label: '服务B', shape: 'rect', group: 'g1', x: 100, y: 220, note: '', noteDone: false, files: [] },
      { id: 'f3', label: '外部网关', shape: 'rect', group: null, x: 300, y: 160, note: '', noteDone: false, files: [] },
    ],
    edges: [
      { from: 'f3', to: 'f1', arrow: '-->', label: '' },
    ],
    groups: [
      { id: 'g1', label: '核心组' },
    ],
    direction: 'TD', extras: [], summary: '',
  }

  const prevRespond = respond
  let currentModel = JSON.parse(JSON.stringify(FOLD_MODEL))
  respond = function (method, args) {
    if (method === 'doc:get') {
      return fullDoc({
        model: currentModel,
        nodeCount: currentModel.nodes.length,
        edgeCount: currentModel.edges.length,
        groupCount: currentModel.groups.length,
      })
    }
    return prevRespond(method, args)
  }

  const foldHost = document.createElement('div')
  document.body.appendChild(foldHost)
  const foldRoot = createRoot(foldHost)
  await act(async () => {
    foldRoot.render(React.createElement(captured['conversation.view'], {
      cwd: UI, sessionId: 's1', useSessions: () => UI,
    }))
  })
  await flush()

  // a. 默认（未折叠）存在 .ac-group-box 与 .ac-group-lbl；标签是**纯组名**，箭头在独立按钮上
  const groupBox = foldHost.querySelector('rect.ac-group-box')
  const groupLbl = foldHost.querySelector('text.ac-group-lbl')
  ok('默认存在 .ac-group-box 组大框', !!groupBox)
  ok('默认存在 .ac-group-lbl 组标签', !!groupLbl)
  eq('组标签是纯组名（箭头已挪到按钮上）', groupLbl?.textContent, '核心组')
  const groupBtn = foldHost.querySelector('g.ac-group-btn')
  ok('默认存在收起按钮 .ac-group-btn', !!groupBtn)
  eq('收起按钮的文字是 ▾', groupBtn?.querySelector('text')?.textContent, '▾')

  // b. 负向对照：默认不存在 .ac-fold
  ok('默认不存在 .ac-fold 折叠块', !foldHost.querySelector('.ac-fold'))

  const edgesBefore = Array.from(foldHost.querySelectorAll('path.ac-edge'))
  eq('默认跨组边渲染且条数为 1', edgesBefore.length, 1)
  const edgeD1 = edgesBefore[0]?.getAttribute('d')

  // c1. **负向对照**：点组名、点组框都**不**折叠 —— 收起/展开只认按钮。
  //     这是刻意的：组块长得像个节点，点它多半是想选中或拖它，顺手把它弹开是最烦的误触。
  const clickGroup = async (el) => {
    await act(async () => {
      clickEl(el)
    })
    await flush()
  }
  await clickGroup(groupLbl)
  ok('点组名不会折叠', !foldHost.querySelector('.ac-fold'))
  await clickGroup(groupBox)
  ok('点组框不会折叠', !foldHost.querySelector('.ac-fold'))

  // c2. 点那个按钮才会折叠
  await clickGroup(groupBtn)

  const foldEl = foldHost.querySelector('.ac-fold')
  ok('点收起按钮后出现 .ac-fold 折叠块', !!foldEl)
  ok('点收起按钮后 .ac-group-box 消失', !foldHost.querySelector('rect.ac-group-box'))

  // d. .ac-fold-lbl 的文字是「组名（N）」—— 箭头同样在独立按钮上
  const foldLbl = foldHost.querySelector('text.ac-fold-lbl')
  const memberCount = FOLD_MODEL.nodes.filter((n) => n.group === 'g1').length
  eq('.ac-fold-lbl 文字为 组名（N）且 N 等于成员数', foldLbl?.textContent, `核心组（${memberCount}）`)
  eq('展开按钮的文字是 ▸', foldHost.querySelector('g.ac-fold-btn text')?.textContent, '▸')

  // e. 负向对照：折叠后，该组内的成员节点不再出现在 g.ac-node 列表中
  const nodeLabelsAfterFold = Array.from(foldHost.querySelectorAll('g.ac-node .ac-lbl')).map((el) => el.textContent.trim())
  ok('折叠后组内成员节点不再出现在 g.ac-node 中', !nodeLabelsAfterFold.includes('服务A') && !nodeLabelsAfterFold.includes('服务B'))
  ok('外部节点仍然在 g.ac-node 中渲染', nodeLabelsAfterFold.includes('外部网关'))

  // g. 跨组边仍保留：折叠后 path.ac-edge 的条数与折叠前相同（边改接到折叠块，不是被删掉）
  const edgesAfterFold = Array.from(foldHost.querySelectorAll('path.ac-edge'))
  eq('跨组边仍保留：折叠后 path.ac-edge 条数与折叠前相同', edgesAfterFold.length, edgesBefore.length)
  const edgeD2 = edgesAfterFold[0]?.getAttribute('d')
  ok('跨组边端点改接至折叠块（连线路径重新计算）', !!edgeD1 && !!edgeD2 && edgeD1 !== edgeD2)

  // f. 负向对照：点折叠块本体不展开；点它的按钮才复原
  await clickGroup(foldHost.querySelector('rect.ac-fold-box'))
  ok('点折叠块本体不会展开', !!foldHost.querySelector('.ac-fold'))
  await clickGroup(foldHost.querySelector('g.ac-fold-btn'))

  ok('点展开按钮后 .ac-group-box 回来', !!foldHost.querySelector('rect.ac-group-box'))
  ok('点展开按钮后 .ac-fold 消失', !foldHost.querySelector('.ac-fold'))
  const restoredNodeLabels = Array.from(foldHost.querySelectorAll('g.ac-node .ac-lbl')).map((el) => el.textContent.trim())
  ok('复原后成员节点全部回到 g.ac-node', restoredNodeLabels.includes('服务A') && restoredNodeLabels.includes('服务B'))

  await act(async () => { foldRoot.unmount() })
  foldHost.remove()

  // h. 组内边不渲染：桩模型里放一条两端同组的边，折叠后 path.ac-edge 条数比折叠前少 1
  const INTRA_MODEL = {
    nodes: [
      { id: 'm1', label: '组内A', shape: 'rect', group: 'g2', x: 100, y: 100, note: '', noteDone: false, files: [] },
      { id: 'm2', label: '组内B', shape: 'rect', group: 'g2', x: 100, y: 220, note: '', noteDone: false, files: [] },
      { id: 'm3', label: '外部C', shape: 'rect', group: null, x: 300, y: 160, note: '', noteDone: false, files: [] },
    ],
    edges: [
      { from: 'm1', to: 'm2', arrow: '-->', label: '' }, // 组内边（两端同组）
      { from: 'm3', to: 'm1', arrow: '-->', label: '' }, // 跨组边
    ],
    groups: [
      { id: 'g2', label: '数据组' },
    ],
    direction: 'TD', extras: [], summary: '',
  }

  currentModel = JSON.parse(JSON.stringify(INTRA_MODEL))

  const intraHost = document.createElement('div')
  document.body.appendChild(intraHost)
  const intraRoot = createRoot(intraHost)
  await act(async () => {
    intraRoot.render(React.createElement(captured['conversation.view'], {
      cwd: UI, sessionId: 's1', useSessions: () => UI,
    }))
  })
  await flush()

  const intraEdgesBefore = Array.from(intraHost.querySelectorAll('path.ac-edge'))
  eq('折叠前共有 2 条边（1 跨组 + 1 组内）', intraEdgesBefore.length, 2)

  await act(async () => {
    intraHost.querySelector('g.ac-group-btn').dispatchEvent(new dom.window.PointerEvent('pointerdown', { bubbles: true, button: 0 }))
  })
  await flush()

  const intraEdgesAfter = Array.from(intraHost.querySelectorAll('path.ac-edge'))
  eq('组内边不渲染：折叠后 path.ac-edge 条数比折叠前少 1', intraEdgesAfter.length, intraEdgesBefore.length - 1)

  await act(async () => { intraRoot.unmount() })
  intraHost.remove()

  respond = prevRespond
}

console.log('\n[4i] 组拖动与拖拽不丢字段')
{
  const TEST_MODEL = {
    nodes: [
      { id: 'g_n1', label: '组内节点1', shape: 'rect', group: 'g1', x: 100, y: 100, note: '', noteDone: false, files: [] },
      { id: 'g_n2', label: '组内节点2', shape: 'rect', group: 'g1', x: 200, y: 120, note: '', noteDone: false, files: [] },
      { id: 'n_field', label: '带字段节点', shape: 'rect', group: null, x: 400, y: 300, note: '待办事项', noteDone: false, files: ['src/core.ts'] },
    ],
    edges: [],
    groups: [
      { id: 'g1', label: '拖拽组' },
    ],
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
        groupCount: currentModel.groups.length,
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

  // 先折叠组 g1
  const groupBtn = dragHost.querySelector('g.ac-group-btn')
  ok('存在收起按钮 g.ac-group-btn', !!groupBtn)
  await act(async () => {
    groupBtn.dispatchEvent(new dom.window.PointerEvent('pointerdown', { bubbles: true, button: 0 }))
  })
  await flush()

  const foldEl = dragHost.querySelector('g.ac-fold')
  ok('折叠后存在 g.ac-fold', !!foldEl)
  const foldBox = dragHost.querySelector('rect.ac-fold-box')
  ok('折叠后存在 rect.ac-fold-box', !!foldBox)
  const initialFoldX = foldBox?.getAttribute('x')

  // c. 负向对照：只按下不移动，什么都不变 —— pointerdown 后直接 pointerup（中途没有位移），
  //    断言折叠块位置不变、且仍是折叠态。
  await act(async () => {
    foldEl.dispatchEvent(new dom.window.PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 150, clientY: 110 }))
    svgEl.dispatchEvent(new dom.window.PointerEvent('pointerup', { bubbles: true, button: 0, clientX: 150, clientY: 110 }))
  })
  await flush()
  eq('负向对照：只按下不移动，折叠块位置不变', dragHost.querySelector('rect.ac-fold-box')?.getAttribute('x'), initialFoldX)
  ok('负向对照：只按下不移动，仍是折叠态（.ac-fold 仍存在）', !!dragHost.querySelector('g.ac-fold'))

  // a. 拖折叠块会带走整个组：先折叠一个组，记下 rect.ac-fold-box 的 x；
  //    对 g.ac-fold 派发 pointerdown，再对 svg.ac-svg 派发 pointermove（带位移），最后 pointerup；
  //    断言 rect.ac-fold-box 的 x 变了（成员被一起挪了，块才跟着动）。
  const foldElBeforeDrag = dragHost.querySelector('g.ac-fold')
  await act(async () => {
    foldElBeforeDrag.dispatchEvent(new dom.window.PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 150, clientY: 110 }))
    svgEl.dispatchEvent(new dom.window.PointerEvent('pointermove', { bubbles: true, clientX: 210, clientY: 170 }))
    svgEl.dispatchEvent(new dom.window.PointerEvent('pointerup', { bubbles: true, button: 0, clientX: 210, clientY: 170 }))
  })
  await flush()

  const movedFoldBox = dragHost.querySelector('rect.ac-fold-box')
  const movedFoldX = movedFoldBox?.getAttribute('x')
  ok('拖折叠块会带走整个组（rect.ac-fold-box 的 x 改变）', !!movedFoldX && movedFoldX !== initialFoldX, { initialFoldX, movedFoldX })

  // b. 负向对照：拖动不会误展开 —— 上面那串操作之后，.ac-fold 仍然存在。
  ok('负向对照：拖动不会误展开（.ac-fold 仍然存在）', !!dragHost.querySelector('g.ac-fold'))

  // d. 拖拽不丢字段：构造一个带 note（未解决）与 files 的节点，对它派发
  //    pointerdown → pointermove（带位移）→ pointerup，断言它的 .ac-note-badge 与 .ac-file-badge
  //    都还在（旧实现下这两个角标会在拖动后消失）。
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

console.log('\n[4j] 连线布线：正交折线 + 避让中间的方块')
{
  // 甲 → 中间障碍 → 乙 三者同列：直接连过去必然压过障碍。
  // 这是本次改动的**核心断言** —— 线必须绕开它，而不是穿过去。
  const ROUTE_MODEL = {
    nodes: [
      { id: 'ra', label: '甲', shape: 'rect', group: null, x: 0, y: 0 },
      { id: 'rc', label: '中间障碍', shape: 'rect', group: null, x: 0, y: 220 },
      { id: 'rb', label: '乙', shape: 'rect', group: null, x: 0, y: 440 },
    ],
    edges: [{ id: 're1', from: 'ra', to: 'rb', label: '', arrow: '-->' }],
    groups: [],
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
      { id: 'f1', label: '源一', shape: 'rect', group: null, x: -220, y: 0 },
      { id: 'f2', label: '源二', shape: 'rect', group: null, x: 0, y: 0 },
      { id: 'f3', label: '源三', shape: 'rect', group: null, x: 220, y: 0 },
      { id: 'ft', label: '汇总节点', shape: 'rect', group: null, x: 0, y: 340 },
    ],
    edges: [
      { id: 'fe1', from: 'f1', to: 'ft', label: '', arrow: '-->' },
      { id: 'fe2', from: 'f2', to: 'ft', label: '', arrow: '-->' },
      { id: 'fe3', from: 'f3', to: 'ft', label: '', arrow: '-->' },
    ],
    groups: [],
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
console.log('\n[4l] 写完留言自动把上下文块放进输入框（无需点按钮）')
{
  const AUTO_MODEL = {
    nodes: [
      // 故意带一条已有留言：textarea 的 placeholder 就是它，选择器和 [4c] 一致
      { id: 'a1', label: '节点甲', shape: 'rect', group: null, x: 0, y: 0, note: '这里为什么不用队列？', noteDone: false },
    ],
    edges: [], groups: [], direction: 'TD', extras: [],
  }
  const prevRespondAuto = respond
  const autoModel = JSON.parse(JSON.stringify(AUTO_MODEL))
  respond = function (method, args) {
    if (method === 'doc:get') return fullDoc({ model: autoModel, nodeCount: autoModel.nodes.length })
    return prevRespondAuto(method, args)
  }
  let autoDraft = null
  const USER_TEXT = '我本来打了一半的话'
  const aHost = document.createElement('div')
  document.body.appendChild(aHost)
  const aRoot = createRoot(aHost)
  await act(async () => {
    aRoot.render(React.createElement(captured['conversation.view'], {
      cwd: UI, sessionId: 's1', useSessions: () => UI,
      inputActions: { setDraft: (t) => { autoDraft = t } },
      // 草稿里已经有用户打的字 —— 自动追加必须**保住**它们
      useInput: (sel) => sel({ draft: USER_TEXT }),
    }))
  })
  await flush()

  const aNodeEl = Array.from(aHost.querySelectorAll('g.ac-node'))
    .find((g) => (g.textContent || '').indexOf('节点甲') >= 0)
  ok('画布上找得到那个节点', !!aNodeEl)
  await act(async () => {
    clickEl(aNodeEl)
  })
  await flush()

  const aArea = aHost.querySelector('textarea[placeholder*="这里为什么不用队列"]')
  ok('检查器里出现留言输入框', !!aArea)
  if (aArea) {
    const setAreaValueAuto = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set
    await act(async () => {
      setAreaValueAuto.call(aArea, '这条留言应该自动变成上下文块')
      aArea.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    await flush()
    await act(async () => {
      aArea.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    await flush()
  }
  ok('写完留言**自动**调用了 setDraft（没点任何按钮）', autoDraft !== null, autoDraft)
  // 分隔符是**空格**不是换行：这些 `@id` 在草稿里是行内文本节点，用 `\n` 就会
  // 每写一条留言多占一行（用户报的「多个留言引用会自己换行」）。
  eq('草稿 = 用户原本打的字 + 空格 + 一个 @节点id', autoDraft, USER_TEXT + ' @a1')
  ok('负向对照：自动追加里一个换行都没有', String(autoDraft || '').indexOf('\n') < 0, autoDraft)
  ok('用户原本打的字还在最前面（追加而非替换）', String(autoDraft || '').indexOf(USER_TEXT) === 0, autoDraft)

  await act(async () => { aRoot.unmount() })
  respond = prevRespondAuto
}

console.log('\n[4m] 端口的硬约束：绝不许越过方块边界（悬空连接的回归断言）')
{
  // 用户报的现场：节点**不展开**时，左侧的连线悬空。原因是我先前的端口分配在
  // "装不下就按最小间距 12 摆、允许溢出到角外"—— 而折叠（只有标题）的节点很矮，
  // 一侧挤进 4 条线时整串就溢出了方块，线头挂在框外。
  const SHORT_MODEL = {
    nodes: [
      { id: 's1', label: '源一', shape: 'rect', group: null, x: -320, y: 0 },
      { id: 's2', label: '源二', shape: 'rect', group: null, x: -320, y: 90 },
      { id: 's3', label: '源三', shape: 'rect', group: null, x: -320, y: 180 },
      { id: 's4', label: '源四', shape: 'rect', group: null, x: -320, y: 270 },
      { id: 's5', label: '源五', shape: 'rect', group: null, x: -320, y: 360 },
      { id: 's6', label: '源六', shape: 'rect', group: null, x: -320, y: 450 },
      { id: 'st', label: '目标', shape: 'rect', group: null, x: 0, y: 135 },
    ],
    edges: [
      { id: 'se1', from: 's1', to: 'st', label: '', arrow: '-->' },
      { id: 'se2', from: 's2', to: 'st', label: '', arrow: '-->' },
      { id: 'se3', from: 's3', to: 'st', label: '', arrow: '-->' },
      { id: 'se4', from: 's4', to: 'st', label: '', arrow: '-->' },
      { id: 'se5', from: 's5', to: 'st', label: '', arrow: '-->' },
      { id: 'se6', from: 's6', to: 'st', label: '', arrow: '-->' },
    ],
    groups: [], direction: 'TD', extras: [],
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

console.log('\n[4n] 未办留言自动进输入框：一次补全、不重复、删了不追着加、已解决的不进')
{
  // 这批断言盯的是 studio.ts 里那条「待办集合变了就自动补引用」的 effect。
  // 用户要的是：不再有按钮，未办留言**自己**就是输入框里的上下文块。
  const AUTO_NOTE_MODEL = {
    nodes: [
      { id: 'x1', label: '甲', shape: 'rect', group: null, x: 0, y: 0, note: '未办一', noteDone: false },
      { id: 'x2', label: '乙', shape: 'rect', group: null, x: 160, y: 0, note: '已办的', noteDone: true },
      { id: 'x3', label: '丙', shape: 'rect', group: null, x: 320, y: 0, note: '未办二', noteDone: false },
    ],
    edges: [], groups: [], direction: 'TD', extras: [],
  }
  const prevRespondAutoNote = respond
  const autoNoteModel = JSON.parse(JSON.stringify(AUTO_NOTE_MODEL))
  respond = function (method, args) {
    if (method === 'doc:get') return fullDoc({ model: autoNoteModel, nodeCount: autoNoteModel.nodes.length })
    return prevRespondAutoNote(method, args)
  }

  const USER_TYPED = '我本来打了一半的话'
  const mount = async (draftSeed) => {
    const calls = []
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => {
      root.render(React.createElement(captured['conversation.view'], {
        cwd: UI, sessionId: 's1', useSessions: () => UI,
        inputActions: { setDraft: (t) => { calls.push(t) } },
        useInput: (sel) => sel({ draft: draftSeed }),
      }))
    })
    await flush()
    return { host, root, calls }
  }

  // a. 挂载即自动补：两条未办一次性补进去，已解决的不进
  const first = await mount(USER_TYPED)
  eq('挂载就把未办留言补进草稿（一次调用）', first.calls.length, 1)
  const filled = first.calls[0] || ''
  ok('用户原本打的字原样留在最前面', filled.indexOf(USER_TYPED) === 0, filled)
  ok('两条未办都补进来了', filled.indexOf('@x1') >= 0 && filled.indexOf('@x3') >= 0, filled)
  ok('已解决的那条不进草稿', filled.indexOf('@x2') < 0, filled)
  eq('引用之间是空格，不换行（同一行里排开）',
    filled.split('\n').filter((ln) => ln.indexOf('@') >= 0).length, 1)
  await act(async () => { first.root.unmount() })
  first.host.remove()

  // b. 负向对照：草稿里**已经**有这两条时，一个字符都不动 —— 否则每次重挂都会追加一遍
  const already = await mount(USER_TYPED + ' @x1 @x3')
  eq('全都在草稿里时不再调用 setDraft', already.calls.length, 0)
  await act(async () => { already.root.unmount() })
  already.host.remove()

  // c. 负向对照：用户手动删掉一个引用后，同一批待办**不会**被追着加回来。
  //    否则「删掉」这个动作在界面上等于没发生 —— 那不是自动，那是按键精灵。
  //    做法：先让 effect 按「x1 单独一条」这一批跑过一次，再让这一批的两条都出现。
  const SIG_MODEL = JSON.parse(JSON.stringify(AUTO_NOTE_MODEL))
  SIG_MODEL.nodes[2].note = ''      // 先把 x3 的留言摘掉 → 这一批只有 x1
  autoNoteModel.nodes = SIG_MODEL.nodes
  const partial = await mount('我打的字')
  eq('第一批（只有 x1）补了一次', partial.calls.length, 1)
  await act(async () => { partial.root.unmount() })
  partial.host.remove()
  // 再把 x3 的留言放回来，但草稿里已经被用户删得只剩 x1
  autoNoteModel.nodes[2].note = '未办二'
  const afterDelete = await mount('我打的字 @x1')
  eq('换了一批之后只补缺的那一条（@x3）', afterDelete.calls.length, 1)
  eq('补的是缺的那一条，不重复 @x1', afterDelete.calls[0], '我打的字 @x1 @x3')
  await act(async () => { afterDelete.root.unmount() })
  afterDelete.host.remove()

  // d. 回归：待办被清空之后，**同一个实例 / 同一个节点**上再写一条留言，照样要自动进输入框。
  //
  //    注意这条**必须在同一个已挂载的实例里**走完「写 → 清 → 再写」：autoFilledRef 是 useRef，
  //    每次重新挂载都是新的空签名，卸载重挂是复现不出来的（第一版就是这么写成了空转断言 ——
  //    把修复撤掉它照样通过，白测了）。所以这里用检查器真写三条留言，让 model 状态自己变。
  const CYCLE_MODEL = {
    nodes: [{ id: 'z1', label: '节点子', shape: 'rect', group: null, x: 0, y: 0, note: '', noteDone: false }],
    edges: [], groups: [], direction: 'TD', extras: [],
  }
  const prevRespondCycle = respond
  const cycleModel = JSON.parse(JSON.stringify(CYCLE_MODEL))
  respond = function (method, args) {
    if (method === 'doc:get') return fullDoc({ model: cycleModel, nodeCount: cycleModel.nodes.length })
    if (method === 'doc:set') { cycleModel.nodes = args.model.nodes; return fullDoc({ model: args.model, revision: 9, updatedBy: 'user' }) }
    return prevRespondCycle(method, args)
  }
  const cycCalls = []
  const cycHost = document.createElement('div')
  document.body.appendChild(cycHost)
  const cycRoot = createRoot(cycHost)
  await act(async () => {
    cycRoot.render(React.createElement(captured['conversation.view'], {
      cwd: UI, sessionId: 's1', useSessions: () => UI,
      inputActions: { setDraft: (t) => { cycCalls.push(t) } },
      useInput: (sel) => sel({ draft: '我打的字' }),
    }))
  })
  await flush()
  eq('开局没有留言 → 一个引用也不补', cycCalls.length, 0)

  const cycNodeEl = Array.from(cycHost.querySelectorAll('g.ac-node'))
    .find((g) => (g.textContent || '').indexOf('节点子') >= 0)
  await act(async () => {
    clickEl(cycNodeEl)
  })
  await flush()
  const cycArea = () => cycHost.querySelector('.ac-dock textarea[placeholder*="这里为什么不用队列"]')
  ok('检查器里出现留言输入框', !!cycArea())
  const setCycValue = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set
  const writeNote = async (text) => {
    await act(async () => {
      setCycValue.call(cycArea(), text)
      cycArea().dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    await flush()
    await act(async () => {
      cycArea().dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    await flush()
  }

  await writeNote('第一条留言')
  eq('写完第一条 → 自动补一次', cycCalls.length, 1)
  eq('补的是那一条', cycCalls[0], '我打的字 @z1')

  await writeNote('')          // 清空：待办集合变空
  eq('清空留言时不再补引用', cycCalls.length, 1)

  await writeNote('第二条留言') // 同一个实例、同一个节点，再写一条
  eq('同一个节点上重新写留言 → 仍然要自动补进输入框', cycCalls.length, 2)
  eq('补的是重新写的那一条', cycCalls[1], '我打的字 @z1')

  await act(async () => { cycRoot.unmount() })
  cycHost.remove()
  respond = prevRespondCycle

  respond = prevRespondAutoNote
}
console.log('\n[4o] Esc 两段式：第一下只拿焦点，第二下才关编辑页')
{
  const ESC_MODEL = {
    nodes: [
      { id: 'e1', label: '节点甲', shape: 'rect', group: null, x: 0, y: 0, note: '这里为什么不用队列？', noteDone: false },
    ],
    edges: [], groups: [], direction: 'TD', extras: [],
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
  // 两条都是「往右下」的竖线，中位线**算出来是同一个 y**（下面两条负向对照会证明这点），
  // 横向跨度 [0,200] 与 [100,300] 相交。没有间隔算法时它们会画成同一条线。
  const PARALLEL_MODEL = {
    nodes: [
      { id: 'pa', label: '甲', shape: 'rect', group: null, x: 0, y: 0 },
      { id: 'pb', label: '乙', shape: 'rect', group: null, x: 200, y: 400 },
      { id: 'pc', label: '丙', shape: 'rect', group: null, x: 300, y: 0 },
      { id: 'pd', label: '丁', shape: 'rect', group: null, x: 100, y: 400 },
    ],
    edges: [
      { id: 'pe1', from: 'pa', to: 'pb', label: '', arrow: '-->' },
      { id: 'pe2', from: 'pc', to: 'pd', label: '', arrow: '-->' },
    ],
    groups: [], direction: 'TD', extras: [],
  }
  const pds = await renderEdges(PARALLEL_MODEL)
  eq('两条平行线都画出来了', pds.length, 2)
  const lane1 = laneY(pds[0]), lane2 = laneY(pds[1])
  const mid0Of = (d) => {
    const p = ptsOf(d)
    return (p[0].y + p[p.length - 1].y) / 2
  }
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
      { id: 'xa', label: '甲', shape: 'rect', group: null, x: 0, y: 0 },
      { id: 'xb', label: '乙', shape: 'rect', group: null, x: 0, y: 300 },
      { id: 'xc', label: '丙', shape: 'rect', group: null, x: -300, y: 150 },
      { id: 'xd', label: '丁', shape: 'rect', group: null, x: 300, y: 150 },
    ],
    edges: [
      { id: 'xe1', from: 'xa', to: 'xb', label: '', arrow: '-->' },
      { id: 'xe2', from: 'xc', to: 'xd', label: '', arrow: '-->' },
    ],
    groups: [], direction: 'TD', extras: [],
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
      return fullDoc({ model: { nodes: [], edges: [], groups: [], direction: 'TD', extras: [] }, mermaid: HL_MERMAID2 })
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
  const EXP_MODEL = {
    nodes: [{ id: 'ex1', label: '导出的方块', shape: 'rect', group: null, x: 0, y: 0, note: '有留言', files: ['a.ts'], link: 'sub' }],
    edges: [], groups: [], direction: 'TD', extras: [],
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
  const groupInput = (host) => {
    const fields = Array.from(host.querySelectorAll('.ac-dock .ac-field'))
    const f = fields.find((el) => (el.querySelector('label')?.textContent || '').indexOf('分组') === 0)
    return f && f.querySelector('input')
  }
  await mountModel(GRP_MODEL, '', async ({ host, sets }) => {
    // 选中第二个节点，把它的分组写成带空格的 "AI 端"
    const g2 = Array.from(host.querySelectorAll('g.ac-node')).find((el) => (el.textContent || '').indexOf('乙') >= 0)
    await act(async () => {
      clickEl(g2)
    })
    await flush()
    const input = groupInput(host)
    ok('检查器里有分组输入框', !!input)
    // 用一个**全新的**名字：没有任何已有组能按标签认领，所以这里考的就是 id 清洗本身
    // （第一版用 'AI 端'，而"按标签认领已有组"那条分支单独就能过 —— 考不到清洗，白测了）
    await act(async () => { setNativeValue(input, '数据 层', dom.window.HTMLInputElement.prototype) })
    await flush()
    await act(async () => {
      input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    await flush()
    const sent = sets[sets.length - 1]
    const node = sent && sent.nodes.find((x) => x.id === 'g2')
    ok('新组的 id 不含空格（含空格会把 subgraph 语法写坏）',
      /^\S+$/.test(String((node && node.group) || '')), node && node.group)
    eq('空格被洗成下划线', node && node.group, '数据_层')
    ok('label 保留用户打的原话（给人看的名字不用洗）',
      !!(sent && sent.groups.find((g) => g.id === '数据_层' && g.label === '数据 层')),
      sent && sent.groups)
    // 再走一遍"认领已有组"：把它写成已有的 'AI 端'，应当对上已有组的 id 'AI端'，不该凭空多一个
    const g1 = Array.from(host.querySelectorAll('g.ac-node')).find((el) => (el.textContent || '').indexOf('甲') >= 0)
    await act(async () => {
      clickEl(g1)
    })
    await flush()
    const input2 = groupInput(host)
    await act(async () => { setNativeValue(input2, 'AI 端', dom.window.HTMLInputElement.prototype) })
    await flush()
    await act(async () => {
      input2.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    await flush()
    const sent2 = sets[sets.length - 1]
    const node1 = sent2 && sent2.nodes.find((x) => x.id === 'g1')
    eq('按标签认领已有组：打 "AI 端" 对上 id "AI端"（不是凭空多一个）', node1 && node1.group, 'AI端')
    eq('组总数不变（没有多出第二个 AI 组）', sent2 && sent2.groups.length, 2)
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

  // ---- F. @ 引用按词边界匹配：草稿里有 @c11 不能把 @c1 吃掉 ----
  const REF_MODEL = {
    nodes: [{ id: 'c1', label: '节点丙一', shape: 'rect', group: null, x: 0, y: 0, note: '待办', noteDone: false }],
    edges: [], groups: [], direction: 'TD', extras: [],
  }
  await mountModel(REF_MODEL, '@c11', async ({ calls }) => {
    eq('草稿里的 @c11 不该把 @c1 吃掉 → 仍然补了一次', calls.length, 1)
    ok('补进去的是带词边界的 @c1', calls[0] === '@c11 @c1', calls[0])
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
  ok('横幅里点明是哪个节点、哪条引用',
    !!box && box.textContent.indexOf('dr1') >= 0 && box.textContent.indexOf('src/host/mermaid.ts#parseMermaid') >= 0,
    box && box.textContent)
  ok('横幅里也报「没有锚点指向的目录」', !!box && box.textContent.indexOf('src/package') >= 0 && box.textContent.indexOf('tools') >= 0)
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

console.log('\n[7] 卸载不留尾')
await act(async () => { root.unmount() })
dispose()
ok('卸载没抛错', true)

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败\n')
process.exit(fail === 0 ? 0 : 1)
