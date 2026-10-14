// 界面渲染共享脚手架：DOM/React 装载、桩 RPC、lib/ui.js 装载与槽位捕获、mount 侧公共 helper。
// 它自己不跑断言、不打印汇总行 —— 分节断言与条数在 ui.render.s1..s6 六个套件里（判据见 docs.baseline.mjs 的 HELPERS）。
// 注意加载顺序：DOM 必须在 react-dom 之前就位，所以 React 走动态 import。
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
const EMPTY_MODEL = { nodes: [], edges: [], direction: 'TD', extras: [] }
function fullDoc(extra) {
  return Object.assign({
    ok: true, revision: 1, updatedBy: 'switch',
    model: EMPTY_MODEL, mermaid: 'flowchart TD\n',
    file: UI + '/.arch-canvas/architecture.mmd', diagram: 'architecture', key: 'architecture',
    external: null, project: '', dir: UI + '/.arch-canvas', scope: 'project', workspace: UI,
    tombstoned: false, nodeCount: 0, edgeCount: 0, libraryRev: 1, historyCount: 1,
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
const dispose = globalThis.__archCanvas.install(ctx)

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

// ---------- 共享作用域：分片用裸名字引用这些（一个事实一个家，不各抄一份） ----------
globalThis.__archCanvasDispose = dispose
globalThis.dom = dom
globalThis.React = React
globalThis.act = act
globalThis.createRoot = createRoot
globalThis.UI = UI
globalThis.rpcCalls = rpcCalls
globalThis.EMPTY_MODEL = EMPTY_MODEL
globalThis.fullDoc = fullDoc
globalThis.LIB_ITEMS = LIB_ITEMS
globalThis.LIB_FILES = LIB_FILES
globalThis.captured = captured
globalThis.capturedDef = capturedDef
globalThis.slots = slots
globalThis.ctx = ctx
globalThis.container = container
globalThis.root = root
globalThis.dispose = dispose
globalThis.flush = flush
globalThis.clickEl = clickEl
globalThis.ok = ok
globalThis.eq = eq
// 会被分节重新赋值的几个必须走访问器：`deps.rpc` / registerSource / styles.insert 闭包读的是这里的模块变量，
// 直接挂值的话分节的赋值只会改全局副本、闭包还看旧的那个。
Object.defineProperty(globalThis, 'respond', {
  get: () => respond, set: (v) => { respond = v }, configurable: true,
})
Object.defineProperty(globalThis, 'insertedCss', { get: () => insertedCss, configurable: true })
Object.defineProperty(globalThis, 'capturedSource', { get: () => capturedSource, configurable: true })

// ---------- 汇总出口 ----------
export function endPhase() {
  console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败\n')
  process.exit(fail === 0 ? 0 : 1)
}
