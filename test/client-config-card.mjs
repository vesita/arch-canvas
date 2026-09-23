// lib/client.js（装机形态的浏览器半边）的结构、inject 面与设置卡注册。
//
// 这一半此前没有任何测试：ui.render.mjs 跑的是 lib/ui.js（界面本体），而
// lib/client.js 是**包那半边**——它决定 inject 面、把 React/styles/rpc 递给界面本体，
// 以及把设置卡挂到「插件」页上。三件事都只在装机形态成立，界面本体的测试看不到。
//
// 两条必须同时成立的规矩：
//  1. **inject 只列硬依赖（slots）。** dsh 客户端 runner 对 inject 里缺席的服务是 **park**
//     （`dsh-cordis-client-runner/lib/client.js` 的 waitingFor），不是给 undefined ——
//     把可选服务（configForms / timer / uiWorkspace）列进去，缺它的部署整个浏览器半边永不 apply，
//     连画布一起没，而且不报错。可选服务一律走 `ctx.get`，拿不到就降级。
//  2. **设置卡靠 `plugins.bundle.config` 槽 + 包名 key。** 页面按包名找这张卡，
//     0.1.7 之后「设置面板看不见」正是这一类静默失败。
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

let pass = 0
let fail = 0
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')) }
}
const eq = (name, got, want) => ok(name, got === want, { got, want })
const sleep = () => new Promise((resolve) => setImmediate(resolve))

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

/**
 * 起一个客户端半边实例，模拟一个**具体部署**：`provided` 就是这台部署里真正就绪的服务。
 * 返回的对象里 `parked` 由 `deploy()` 按 runner 语义算出来。
 */
function bootClient(code, provided) {
  const registrations = []
  const injections = []
  const loadedScripts = []
  const installed = []
  const box = { namespace: null }
  let uiWorkspace = undefined

  /** 官方设置表单服务的桩：只有部署里真有它时才存在（configForms 缺省缺席）。 */
  const configForms = {
    get: (ns) => {
      box.namespace = ns
      return {
        subscribe: () => () => {},
        getSnapshot: () => ({ status: 'ready', value: {}, base: {}, user: {} }),
        mutate: async () => true,
      }
    },
  }
  const services = provided.includes('configForms') ? { configForms } : {}

  const ctx = {
    effect: (fn) => { fn(); return () => {} },
    // 可选取用的服务走 ctx.get：缺席就给 undefined（runner 对未 inject 的服务也是这个结果）。
    get: (name) => (name === 'uiWorkspace' ? uiWorkspace : services[name]),
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
      head: {
        appendChild: (el) => {
          if (el.tagName === 'SCRIPT' || el.src) {
            loadedScripts.push(el.src)
            // 真浏览器里 <script> 加载完才触发 onload；这里排进微任务队列，让界面本体的 install 有机会跑。
            if (typeof el.onload === 'function') queueMicrotask(el.onload)
          }
        },
      },
    },
    window: {
      __ModuleLoader__: { load: (def) => { sandbox.__def = def } },
      __archCanvas: {
        // 界面本体（lib/ui.js）的入口。真实实现由 ui.render.mjs 真渲染守着；
        // 这里守的是「包这半边在交接之前有没有 park / 早退」。
        install: (c) => {
          installed.push(c)
          c.slots.inject('conversation.view', () => {})
          return () => {}
        },
      },
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

  vm.runInNewContext(code, sandbox)
  const plugin = sandbox.__def.factory(sandbox.require)
  return {
    moduleId: sandbox.__def.id,
    plugin, ctx, registrations, injections, loadedScripts, installed, box,
    setUiWorkspace: (value) => { uiWorkspace = value },
  }
}

/**
 * 按 dsh 客户端 runner 的语义「部署」一次：inject 里有服务没就绪 → **park**
 * （不 apply、不报错，等它上线再说）。这就是可选服务绝不能进 inject 的原因。
 */
function deploy(code, provided) {
  const inst = bootClient(code, provided)
  const missing = (inst.plugin.inject || []).filter((name) => !provided.includes(name))
  if (missing.length === 0) inst.plugin.apply(inst.ctx)
  return Object.assign(inst, { parked: missing.length > 0, missing, provided })
}

// ==================== inject 面 ====================
const full = deploy(src, ['slots', 'configForms'])
const inject = [...(full.plugin.inject || [])]
ok('inject 里有 slots（注册主窗口子页是硬依赖）', inject.includes('slots'), inject)
ok('inject 里只有 slots（多一个可选服务就多一种整半 park 的部署）',
  JSON.stringify(inject) === JSON.stringify(['slots']), inject)
ok('inject 里没有 configForms（改走 ctx.get，缺席只少一张卡）', !inject.includes('configForms'), inject)
ok('inject 里没有 timer（没有它界面靠原生定时器回退）', !inject.includes('timer'), inject)
ok('inject 里没有 uiWorkspace（可选服务，走 ctx.get 降级）', !inject.includes('uiWorkspace'), inject)

// ==================== 抽掉可选服务：画布照常 ====================
{
  const noForms = deploy(src, ['slots'])
  await sleep()
  ok('抽掉 configForms：不 park', noForms.parked === false, noForms.missing)
  eq('抽掉 configForms：界面本体照常 install（子页注册走它）', noForms.installed.length, 1)
  ok('抽掉 configForms：install 拿到的是同一个 ctx', noForms.installed[0] === noForms.ctx)
  ok('抽掉 configForms：conversation.view 已交给界面本体去注册',
    noForms.injections.includes('conversation.view'), noForms.injections)
  ok('抽掉 configForms：没有配置卡注册（只少一张卡，别无损失）',
    noForms.registrations.length === 0, noForms.registrations.map((r) => r.options.name))

  const noWorkspace = deploy(src, ['slots'])
  await sleep()
  ok('抽掉 uiWorkspace（目录选择器）：不 park、界面照常', noWorkspace.parked === false && noWorkspace.installed.length === 1)
}

// ==================== 负向对照：硬依赖缺席必须 park ====================
{
  const noSlots = deploy(src, ['configForms'])
  ok('抽掉 slots：必须 park（inject 里的服务缺席就不 apply —— 这就是断言有牙的地方）',
    noSlots.parked === true && noSlots.missing.includes('slots'), noSlots.missing)
  eq('park 时不 apply：界面本体一次都没被 install', noSlots.installed.length, 0)

  // 把 inject 改回修复前的形状（configForms 进 inject），证明上面那条「抽掉 configForms 不 park」
  // 不是空测试：同一个部署在旧形状下**会** park。
  const regressed = src.replace("exports.inject = ['slots']", "exports.inject = ['slots', 'configForms']")
  ok('负向对照：探针确实改掉了 inject（否则下面两条会假通过）',
    regressed !== src && regressed.includes("['slots', 'configForms']"))
  const old = deploy(regressed, ['slots'])
  ok('负向对照：旧形状（configForms 进 inject）在缺它的部署上 park',
    old.parked === true && old.missing.includes('configForms'), old.missing)
  eq('负向对照：旧形状下整个浏览器半边都不 apply（画布一起没）', old.installed.length, 0)
  const oldFull = deploy(regressed, ['slots', 'configForms'])
  await sleep()
  ok('负向对照的另一半：服务齐了旧形状也照常（park 只由缺席决定）',
    oldFull.parked === false && oldFull.installed.length === 1)
}

// ==================== 设置卡注册（服务齐了的部署） ====================
ok('client.js 走 __ModuleLoader__.load 注册', full.moduleId === 'arch-canvas', full.moduleId)
ok('导出了 apply', typeof full.plugin.apply === 'function')
ok('注册进了 plugins.bundle.config', full.injections.includes('plugins.bundle.config'), full.injections)
const card = full.registrations.find((r) => r.options.name === 'plugins.bundle.config')
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
  eq('表单命名空间是条目 id', full.box.namespace, 'arch-canvas')

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
  full.setUiWorkspace({ pickDirectory: () => Promise.resolve('/tmp/arch-data') })
  await collect(renderCard((field, text) => { edits.push([field, text]) }), 'button')[0].props.onClick()
  ok('选中系统目录后只填进暂存草稿（仍要点保存才写入）',
    JSON.stringify(edits) === JSON.stringify([['dataDir', '/tmp/arch-data']]), edits)

  edits.length = 0
  full.setUiWorkspace({ pickDirectory: () => Promise.resolve(null) })
  await collect(renderCard((field, text) => { edits.push([field, text]) }), 'button')[0].props.onClick()
  ok('取消（返回 null）什么都不写', edits.length === 0, edits)

  edits.length = 0
  full.setUiWorkspace({ pickDirectory: () => Promise.reject(new Error('needs the native capability; serves "browse"')) })
  await collect(renderCard((field, text) => { edits.push([field, text]) }), 'button')[0].props.onClick()
  ok('服务拒绝时既不写草稿、也不把异常抛出去', edits.length === 0, edits)
  ok('拒绝后如实说明，并指回手填',
    texts(renderCard(), 'p').some((text) => typeof text === 'string' && text.includes('打不开系统目录选择器')),
    texts(renderCard(), 'p'))

  full.setUiWorkspace(undefined)
  await clickChoose()
  ok('没有 uiWorkspace 时说清楚这个部署没有系统选择器',
    texts(renderCard(), 'p').some((text) => typeof text === 'string' && text.includes('没有系统目录选择器')),
    texts(renderCard(), 'p'))
}

// ---------- 界面本体仍然要加载 ----------
ok('仍然把界面本体（/arch-canvas/ui.js）挂上去', full.loadedScripts.some((s) => s === '/arch-canvas/ui.js'), full.loadedScripts)

console.log('')
console.log(fail === 0 ? '全部通过：' + pass + ' / ' + (pass + fail) : '有失败：' + fail + ' / ' + (pass + fail))
process.exit(fail === 0 ? 0 : 1)
