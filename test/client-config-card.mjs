// lib/client.js（装机形态的浏览器半边）的结构与设置卡注册。
//
// 这一半此前没有任何测试：ui.render.mjs 跑的是 lib/ui.js（界面本体），而
// lib/client.js 是**包那半边**——它决定 inject 面、把 React/styles/rpc 递给界面本体，
// 以及把设置卡挂到「插件」页上。三件事都只在装机形态成立，界面本体的测试看不到。
//
// 为什么值得守：设置卡要出现在侧边栏「插件」页里，靠的是**两个必须同时成立的事实**——
//  1. 注册进 `plugins.bundle.config` 槽，且 key 是**包名**（页面按包名找这张卡）；
//  2. 插件 inject 里声明 `configForms`（少一个，卡片永远不会被渲染，而且不报错）。
// 0.1.7 之后「设置面板看不见」正是这一类静默失败。
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

let pass = 0
let fail = 0
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')) }
}
const eq = (name, got, want) => ok(name, got === want, { got, want })

const src = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

/** 假的原语：形状与 `@deepseek-ai/dsh-client-ui-primitives` 一致，够卡片挂上即可。 */
const primitives = {
  SettingsForm: 'SettingsForm',
  SettingsValueField: 'SettingsValueField',
  SettingsFormModel: class {
    constructor(scope, specs) { this.scope = scope; this.specs = specs }
    bind(project) { return { getSnapshot: () => project() } }
    shell() { return { available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false } }
    field(name) { return { text: '', overridden: false, invalid: false } }
    actions() {
      return { edit() {}, resetField() {}, save() {}, discard() {} }
    }
    dispose() {}
  },
  settingsTextField: (field) => ({ field, format: (v) => (typeof v === 'string' ? v : ''), parse: () => ({ kind: 'clear' }) }),
}

/**
 * 假 React：`createElement` 保留 children 数组，另外给一个**够真的 hook 存储**——
 * `useState` 的值存在 `hookSlots` 里，重渲染（再调一次组件）就能看到上一次 setState 的结果。
 * 设置卡要靠它验证「选择器失败后如实说明」。
 */
const hookSlots = []
let hookIndex = 0
const React = {
  createElement(type, props, ...children) { return { type, props, children } },
  useState(initial) {
    const index = hookIndex++
    if (!(index in hookSlots)) hookSlots[index] = typeof initial === 'function' ? initial() : initial
    return [hookSlots[index], (next) => { hookSlots[index] = typeof next === 'function' ? next(hookSlots[index]) : next }]
  },
  useEffect() {},
  useRef(initial) {
    const index = hookIndex++
    if (!(index in hookSlots)) hookSlots[index] = { current: initial }
    return hookSlots[index]
  },
}

/** 抓下这次注册：槽名、key、inject 面、组件。 */
const registrations = []
const injections = []
const loadedScripts = []

/** 系统目录选择器服务：每个用例自己换成 stub（undefined = 这个部署没有它）。 */
let uiWorkspace = undefined

const ctx = {
  configForms: { get: (ns) => { ctx._ns = ns; return { subscribe: () => () => {}, getSnapshot: () => ({ status: 'ready', value: {}, base: {}, user: {} }), mutate: async () => true } } },
  effect: (fn) => { fn(); return () => {} },
  // 可选取用的服务走 ctx.get（列进 inject 而缺席会让整个浏览器半边 park）。
  get: (name) => (name === 'uiWorkspace' ? uiWorkspace : undefined),
  slots: {
    inject(key, cb) { injections.push(key); cb() },
    register(options, component) { registrations.push({ options, component }); return () => {} },
  },
}

const sandbox = {
  console,
  Promise,
  Symbol,
  Object,
  JSON,
  document: {
    createElement: () => ({ setAttribute() {}, remove() {}, style: {} }),
    head: { appendChild: (el) => { if (el.tagName === 'SCRIPT' || el.src) loadedScripts.push(el.src) } },
  },
  window: {
    __ModuleLoader__: { load: (def) => { sandbox.__def = def } },
  },
  fetch: () => Promise.resolve({ json: () => Promise.resolve({ ok: true, value: {} }) }),
  require: (id) => {
    if (id === 'react') return React
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitives
    throw new Error('unexpected require: ' + id)
  },
}
sandbox.globalThis = sandbox
sandbox.window.document = sandbox.document

vm.runInNewContext(src, sandbox)

ok('client.js 走 __ModuleLoader__.load 注册', !!sandbox.__def && sandbox.__def.id === 'arch-canvas')
const exportsObj = sandbox.__def.factory(sandbox.require)
ok('导出了 apply', typeof exportsObj.apply === 'function')

// ---------- inject 面 ----------
const inject = [...(exportsObj.inject || [])]
ok('inject 里有 slots', inject.includes('slots'))
// 少了它设置卡永远不渲染，且不报错 —— 正是「设置面板看不见」的那类静默失败。
ok('inject 里有 configForms（少了这张卡永远不出现，也不报错）', inject.includes('configForms'), inject)
// 列了而部署里没有 timer，插件会永远 park；界面本来就有原生定时器回退。
ok('inject 里没有 timer（没有它界面靠原生定时器回退）', !inject.includes('timer'), inject)

// ---------- 设置卡注册 ----------
exportsObj.apply(ctx)
ok('注册进了 plugins.bundle.config', injections.includes('plugins.bundle.config'), injections)
const card = registrations.find((r) => r.options.name === 'plugins.bundle.config')
ok('找到了设置卡', !!card)
if (card) {
  // 页面按**包名**找这张卡；写成插件 id 或别的名字就永远匹配不上。
  eq('卡的 key 是包名', card.options.key, 'arch-canvas')
  ok('卡有组件', typeof card.component === 'function')
  const face = card.options.inject()
  for (const action of ['edit', 'resetField', 'save', 'discard']) {
    ok('注入面有 ' + action + '（官方表单靠这四个动作）', typeof face[action] === 'function')
  }
  ok('注入面带 hooks.archConfig', !!(face.hooks && face.hooks.archConfig))
  // 表单命名空间必须是 profile 里的条目 id，否则 configForms.get 拿不到那份配置。
  eq('表单命名空间是条目 id', ctx._ns, 'arch-canvas')

  // ---------- 数据目录：系统目录选择器 ----------
  // 官方没有「一键挑目录」的跨组合入口：`uiWorkspace.pickDirectory()` 只在 native 组合成立
  // （browse 组合会 reject），桌面 App 则走 preload 桥。所以这张卡永远保留文本输入，
  // 选择器只是加速器 —— 下面把四条路径都钉住（成功 / 取消 / 拒绝 / 服务缺席）。
  const collect = (node, type, out = []) => {
    if (node == null || typeof node !== 'object') return out
    if (Array.isArray(node)) { for (const child of node) collect(child, type, out); return out }
    if (node.type === type) out.push(node)
    collect(node.children, type, out)
    return out
  }
  const texts = (tree, type) => collect(tree, type).map((node) => node.children && node.children[0])
  const renderCard = (onEdit) => {
    hookIndex = 0
    const state = {
      shell: { available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false },
      dataDir: { text: '', overridden: false, invalid: false },
    }
    return card.component({
      useArchConfig: (selector) => selector(state),
      edit: onEdit || (() => {}),
      resetField: () => {},
      save: () => {},
      discard: () => {},
    })
  }
  const clickChoose = () => collect(renderCard(), 'button')[0].props.onClick()

  ok('保留了官方文本框（browse 组合 / 无桌面端下只能手填路径）',
    collect(renderCard(), 'SettingsValueField').length === 1)
  ok('多了一个「选择目录…」按钮', texts(renderCard(), 'button')[0] === '选择目录…', texts(renderCard(), 'button'))

  const edits = []
  uiWorkspace = { pickDirectory: () => Promise.resolve('/tmp/arch-data') }
  await collect(renderCard((field, text) => { edits.push([field, text]) }), 'button')[0].props.onClick()
  ok('选中系统目录后只填进暂存草稿（仍要点保存才写入）',
    JSON.stringify(edits) === JSON.stringify([['dataDir', '/tmp/arch-data']]), edits)

  edits.length = 0
  uiWorkspace = { pickDirectory: () => Promise.resolve(null) }
  await collect(renderCard((field, text) => { edits.push([field, text]) }), 'button')[0].props.onClick()
  ok('取消（返回 null）什么都不写', edits.length === 0, edits)

  edits.length = 0
  uiWorkspace = { pickDirectory: () => Promise.reject(new Error('needs the native capability; serves "browse"')) }
  await collect(renderCard((field, text) => { edits.push([field, text]) }), 'button')[0].props.onClick()
  ok('服务拒绝时既不写草稿、也不把异常抛出去', edits.length === 0, edits)
  ok('拒绝后如实说明，并指回手填',
    texts(renderCard(), 'p').some((text) => typeof text === 'string' && text.includes('打不开系统目录选择器')),
    texts(renderCard(), 'p'))

  uiWorkspace = undefined
  await clickChoose()
  ok('没有 uiWorkspace 时说清楚这个部署没有系统选择器',
    texts(renderCard(), 'p').some((text) => typeof text === 'string' && text.includes('没有系统目录选择器')),
    texts(renderCard(), 'p'))
}

// ---------- 界面本体仍然要加载 ----------
ok('仍然把界面本体（/arch-canvas/ui.js）挂上去', loadedScripts.some((s) => s === '/arch-canvas/ui.js'), loadedScripts)

console.log('')
console.log(fail === 0 ? '全部通过：' + pass + ' / ' + (pass + fail) : '有失败：' + fail + ' / ' + (pass + fail))
process.exit(fail === 0 ? 0 : 1)
