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
/** AI 写图开关的假宿主状态：默认关（与 src/host/settings.ts 的默认值一致）。 */
const SETTING = { aiWrite: false }
const EMPTY_MODEL = { nodes: [], edges: [], groups: [], direction: 'TD', extras: [] }
function fullDoc(extra) {
  return Object.assign({
    ok: true, revision: 1, updatedBy: 'switch',
    model: EMPTY_MODEL, mermaid: 'flowchart TD\n',
    file: UI + '/.arch-canvas/architecture.mmd', diagram: 'architecture', key: 'architecture',
    external: null, project: '', dir: UI + '/.arch-canvas', scope: 'project', workspace: UI,
    tombstoned: false, nodeCount: 0, edgeCount: 0, groupCount: 0, libraryRev: 1,
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
  if (method === 'setting:get') return { ok: true, aiWrite: !!SETTING.aiWrite, file: '/tmp/uiproj/settings.json' }
  if (method === 'setting:set') { SETTING.aiWrite = !!(args && args.aiWrite); return { ok: true, aiWrite: SETTING.aiWrite } }
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

console.log('\n[1b] AI 写图开关：默认「AI 只读」，点一下才允许 AI 改图')
{
  const toggle = byText('AI 只读')
  ok('顶栏有开关，且默认显示「AI 只读」', !!toggle, buttons().map((b) => b.textContent))
  ok('面板加载时读了宿主状态', rpcCalls.some((c) => c.method === 'setting:get'), rpcCalls.map((c) => c.method))
  rpcCalls.length = 0
  if (toggle) {
    await act(async () => { toggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
    await flush()
  }
  const setCall = rpcCalls.find((c) => c.method === 'setting:set')
  ok('点击写了宿主（setting:set aiWrite:true）', !!setCall && setCall.args.aiWrite === true, setCall)
  ok('宿主确认后按钮变成「AI 可改图」', !!byText('AI 可改图'), buttons().map((b) => b.textContent))
  ok('关掉时不再显示旧文案', !byText('AI 只读'))
  // 再点一下回到只读
  const on = byText('AI 可改图')
  if (on) {
    await act(async () => { on.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
    await flush()
  }
  ok('再点一下回到「AI 只读」', !!byText('AI 只读'), buttons().map((b) => b.textContent))
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
