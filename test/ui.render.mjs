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
const ARCHIVE = { id: 't1', kind: 'arch' }

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
const slots = {
  inject: (_name, cb) => { cb(); return () => {} },
  register: (def, comp) => { captured[def.name] = comp; return () => {} },
}
const sidebarRight = {
  expanded: false, activeTab: null, log: [],
  openTab(kind) { this.log.push('openTab(' + kind + ')'); this.expanded = true; this.activeTab = { id: ARCHIVE.id, kind } },
  close(id) { this.log.push('close(' + id + ')'); if (this.activeTab && this.activeTab.id === id) this.activeTab = null },
  isExpanded() { return this.expanded },
  active() { return this.activeTab },
  toggleExpanded() { this.log.push('toggleExpanded()'); this.expanded = !this.expanded },
}
const ctx = {
  get: (k) => ({ slots, sidebarRightTabs: { register: () => () => {} }, sidebarRight })[k],
  effect: (fn) => { const d = fn(); return typeof d === 'function' ? d : () => {} },
  inject: () => () => {},
  on: () => () => {},
  interval: () => () => {},
  timeout: () => () => {},
}

console.log('\n[1] 注册面')
const dispose = globalThis.__archCanvas.install(ctx)
ok('注册了侧栏底部入口', typeof captured['sidebar.footer.action'] === 'function')
ok('注册了右键栏标签体', typeof captured['sidebar.right.pane.tab'] === 'function')
ok('样式里有起始页与选择器的样式', insertedCss.indexOf('.ac-start') >= 0 && insertedCss.indexOf('.ac-lib') >= 0)

// ---------- 渲染标签体 ----------
const container = document.getElementById('app')
const root = createRoot(container)
async function flush() { await act(async () => { await Promise.resolve() }) }

console.log('\n[2] 首次渲染：工具条与空画布都得有出路')
await act(async () => {
  root.render(React.createElement(captured['sidebar.right.pane.tab'], {
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

  const noteHost = document.createElement('div')
  document.body.appendChild(noteHost)
  const noteRoot = createRoot(noteHost)
  await act(async () => {
    noteRoot.render(React.createElement(captured['sidebar.right.pane.tab'], {
      cwd: UI, sessionId: 's1', useSessions: () => UI,
    }))
  })
  await flush()

  // 1. 工具条找得到「注释」按钮，且带未解决数量
  const toolBtns = () => Array.from(noteHost.querySelectorAll('.ac-tools button'))
  const noteToolBtn = () => toolBtns().find((b) => b.textContent.startsWith('注释'))
  ok('工具条：找得到注释按钮且文案为「注释 2」', !!noteToolBtn() && noteToolBtn().textContent.trim() === '注释 2')

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
  ok('面板头部文案含未解决与已解决条数', headText.indexOf('元素注释：2 条未解决') >= 0 && headText.indexOf('1 条已解决') >= 0, headText)

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
  eq('工具条未解决条数更新为 1', noteToolBtn()?.textContent.trim(), '注释 1')

  // 5. 选中节点乙（未解决）
  const n2El = findNodeEl('节点乙')
  await act(async () => {
    n2El.dispatchEvent(new dom.window.PointerEvent('pointerdown', { bubbles: true, button: 0 }))
  })
  await flush()

  const dock = () => noteHost.querySelector('.ac-dock')
  ok('选中节点后底部检查器出现', !!dock() && dock().textContent.indexOf('节点 n2') >= 0)

  const noteArea = () => dock()?.querySelector('textarea[placeholder*="这里为什么不用队列"]')
  ok('检查器内出现注释 textarea 且 placeholder 符合预期', !!noteArea())
  eq('注释 textarea 内容为当前节点注释', noteArea()?.value, '这里需要限流')

  const markBtn = () => dock()?.querySelector('.ac-note-actions button')
  eq('有未解决注释时按钮文案为「标记已解决」', markBtn()?.textContent.trim(), '标记已解决')

  rpcCalls.length = 0
  await act(async () => { markBtn().click() })
  await flush()

  const setCall2 = rpcCalls.find((c) => c.method === 'doc:set')
  ok('检查器点「标记已解决」发出 doc:set', !!setCall2)
  const setNode2 = setCall2?.args?.model?.nodes?.find((n) => n.id === 'n2')
  ok('doc:set 提交的模型里 n2.noteDone 为 true', setNode2 && setNode2.noteDone === true, setNode2)
  eq('标记已解决后检查器按钮文案变为「重新打开」', markBtn()?.textContent.trim(), '重新打开')

  // 6. 全部解决后的工具条与提示文案
  eq('全部解决后工具条文案变回「注释」', noteToolBtn()?.textContent.trim(), '注释')
  ok('没有未解决注释时面板提示「没有未解决的注释」', notesPanel()?.textContent.indexOf('没有未解决的注释') >= 0)

  // 7. 检查器点「重新打开」
  rpcCalls.length = 0
  await act(async () => { markBtn().click() })
  await flush()
  const setCall3 = rpcCalls.find((c) => c.method === 'doc:set')
  ok('检查器点「重新打开」发出 doc:set', !!setCall3)
  const setNode3 = setCall3?.args?.model?.nodes?.find((n) => n.id === 'n2')
  ok('doc:set 提交的模型里 n2.noteDone 为 false', setNode3 && setNode3.noteDone === false, setNode3)
  eq('重新打开后检查器按钮文案变回「标记已解决」', markBtn()?.textContent.trim(), '标记已解决')
  eq('重新打开后工具条未解决条数恢复为 1', noteToolBtn()?.textContent.trim(), '注释 1')

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
    refRoot.render(React.createElement(captured['sidebar.right.pane.tab'], {
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
      findRefNode(lbl).dispatchEvent(new dom.window.PointerEvent('pointerdown', { bubbles: true, button: 0 }))
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
    startRoot.render(React.createElement(captured['sidebar.right.pane.tab'], {
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
    histRoot.render(React.createElement(captured['sidebar.right.pane.tab'], {
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

console.log('\n[5] 左下角入口：点一下打开、再点一下连画布一起收回')
const footHost = document.createElement('div')
document.body.appendChild(footHost)
const footRoot = createRoot(footHost)
await act(async () => { footRoot.render(React.createElement(captured['sidebar.footer.action'], { wide: true })) })
const footBtn = footHost.querySelector('button')
ok('底部入口渲染成按钮', !!footBtn, footHost.innerHTML.slice(0, 120))
sidebarRight.log.length = 0
await act(async () => { footBtn.click() })
eq('第一次点击 → openTab(arch)', sidebarRight.log.join(' → '), 'openTab(arch)')
await act(async () => { footBtn.click() })
eq('第二次点击 → 关标签 + 收侧栏', sidebarRight.log.join(' → '), 'openTab(arch) → close(t1) → toggleExpanded()')

console.log('\n[6] 装机形态：ctx 没 inject timer（直接读属性会抛）也不能崩')
// 复刻真插件形态的 Cordis 上下文：**未 inject 的服务直接读属性是抛错**，而不是给 undefined。
// 这正是「打开画布一片空白」的根因：`typeof ctx.interval === 'function'` 那一读就抛。
const strictGet = (k) => ({ slots, sidebarRightTabs: { register: () => () => {} }, sidebarRight })[k]
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
    strictRoot.render(React.createElement(captured['sidebar.right.pane.tab'], { cwd: UI, sessionId: 's1', useSessions: () => UI }))
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

console.log('\n[7] 卸载不留尾')
await act(async () => { root.unmount(); footRoot.unmount() })
dispose()
ok('卸载没抛错', true)

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败\n')
process.exit(fail === 0 ? 0 : 1)
