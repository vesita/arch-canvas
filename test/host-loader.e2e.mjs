// 验证「薄壳能正确加载磁盘上的宿主逻辑」。
//
// 这一层很容易悄悄坏掉：引导层 eval 失败、路径写错、dist/host.js 没构建时
// 表现都是「插件看着加载成功，但一个工具都没注册」—— 光看 Package 状态看不出来。
// 所以这里用与 host.e2e.mjs 相同的方式（vm + 桩服务）把引导层真跑一遍。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

let pass = 0
let fail = 0
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')) }
}
const eq = (name, got, want) => ok(name, got === want, { got, want })

const HOST_FILE = fileURLToPath(new URL('../dist/host.js', import.meta.url))
// 读构建产物而不是源码：Package 加载的是 dist/bootstrap-host.js，
// 源码已改成 .ts，而且真正要守的门是「产物能不能把真身加载起来」
const loaderCode = readFileSync(new URL('../dist/bootstrap-host.js', import.meta.url), 'utf8')

// ---------- 桩服务：fs 只认真实的 dist/host.js ----------
const files = new Map([[HOST_FILE, readFileSync(HOST_FILE, 'utf8')]])
const fsSvc = {
  resolve: async (p) => ({ targetKey: p, displayPath: p }),
  stat: async (t) => (files.has(t.targetKey) ? { version: 'v1', type: 'file', size: files.get(t.targetKey).length } : undefined),
  readText: async (t) => {
    if (!files.has(t.targetKey)) throw new Error('ENOENT ' + t.targetKey)
    return files.get(t.targetKey)
  },
  writeText: async (t, c) => { files.set(t.targetKey, c); return { operation: 'create', version: 'v1', before: null, after: c } },
}

const handlers = new Map()
const tools = []
const prompts = []
const routes = []
const harness = {
  handle: (name, fn) => { handlers.set(name, fn); return () => handlers.delete(name) },
  defineTool: (def) => def,
  registerTool: (_ctx, def) => { tools.push(def) },
}
const logs = []
const sandboxConsole = { log: (m) => logs.push(String(m)), error: (m) => logs.push('ERR ' + String(m)), warn: (m) => logs.push('WARN ' + String(m)) }

const disposers = []
// 宿主逻辑会 ctx.inject(['timer'], …) 注册周期扫描，所以桩要给 inject ——
// 真形态里那是 cordis 上下文自带的（webServer 也是这么 inject 进来的）。
const intervals = []
const timerStub = {
  effect: (fn) => { const d = fn(); if (typeof d === 'function') disposers.push(d); return d },
  interval: (fn, ms) => { intervals.push({ fn, ms }); return () => {} },
}
const ctx = {
  get: (k) => ({ fs: fsSvc, webServer: { register: (r) => { routes.push(r); return () => {} } }, systemPrompt: { context: (c) => { prompts.push(c); return () => {} } } })[k],
  effect: (fn) => { const d = fn(); if (typeof d === 'function') disposers.push(d); return d },
  on: () => () => {},
  inject: (names, cb) => { cb(timerStub) },
}

// ---------- 跑引导层 ----------
const sandbox = vm.createContext({ harness, console: sandboxConsole })
const plugin = await vm.runInContext(`(async () => {\n${loaderCode}\n})()`, sandbox, { filename: 'host-loader-sim.js' })

console.log('【引导层本身】')
ok('返回了 { apply } 形状的插件', plugin && typeof plugin.apply === 'function', plugin === null ? 'null' : typeof plugin)
ok('薄壳里没有宿主逻辑（不含真身的 RPC）', loaderCode.indexOf("harness.handle('doc:get'") < 0)

plugin.apply(ctx)

// 加载是异步的：轮询等待，而不是盲等一个固定时长
for (let i = 0; i < 100 && handlers.size === 0; i++) await new Promise((r) => setTimeout(r, 10))

console.log('【通过引导层加载后的注册结果】')
// 这个插件对 console 一字不吐（正常操作噪音一律不出，故障走 throw）——
// 引导层与宿主逻辑都在 vm 里跑，它们的 console 就是上面那个收集器，所以这里能兜住。
ok('挂载过程不往 console 写任何东西', logs.length === 0, logs)
eq('注册了 15 个 RPC 处理器', handlers.size, 15)
eq('注册了 4 个工具', tools.length, 4)
eq('工具名对得上', tools.map((t) => t.name).sort().join(','), 'arch_edit,arch_read,arch_switch,arch_write')
eq('注册了 1 条提示词上下文', prompts.length, 1)
eq('注册了 2 条静态路由', routes.length, 2)
ok('注册了周期扫描定时器（自动扫描 .arch-canvas）', intervals.length === 1 && intervals[0].ms > 0, intervals.map((i) => i.ms))
ok('提示词上下文每步动态求值（是函数）', typeof prompts[0].text === 'function')

console.log('【功能确实可用，不只是形状对】')
const g = await handlers.get('doc:get')({})
ok('doc:get 返回 ok', g && g.ok === true, g && g.error)
eq('种子节点数', g.nodeCount, 5)
ok('带 lastChange 字段', 'lastChange' in g)

// 没有写图闸门：arch_edit 直接生效（安全性改由检查点兜底，见 src/host/history.ts）
const e = await tools.find((t) => t.name === 'arch_edit').execute({
  ops: [{ op: 'add_node', id: 'probe', label: '引导层探针' }],
}, {})
eq('arch_edit 生效 1 个 op', e.appliedCount, 1)
ok('lastChange 由内层代码记录（说明状态是同一份）', e.lastChange.by === 'ai' && e.lastChange.nodes.indexOf('probe') >= 0, e.lastChange)

console.log('【路径不对时要吵，不能静默】')
handlers.clear(); tools.length = 0; prompts.length = 0; routes.length = 0
logs.length = 0
const badCode = loaderCode.replace(/var PROJECT = '[^']*'/, "var PROJECT = '/nope'")
ok('探针确实改掉了 PROJECT（否则这条测试会假通过）', badCode !== loaderCode && badCode.includes("'/nope'"))
const plugin2 = await vm.runInContext(
  `(async () => {\n${badCode}\n})()`,
  sandbox, { filename: 'host-loader-badpath.js' })
// 引导层不再自己 console.error，而是让加载 Promise 拒绝 —— 宿主（cordis / Node）会把它报出来。
// 所以这里等的是 unhandledRejection，不是日志行。
const rejections = []
const onRejection = (e) => rejections.push(e)
process.on('unhandledRejection', onRejection)
plugin2.apply(ctx)
for (let i = 0; i < 100 && rejections.length === 0; i++) await new Promise((r) => setTimeout(r, 10))
process.off('unhandledRejection', onRejection)
ok('路径不存在时以拒绝收场，而不是静默', rejections.length === 1, rejections.map(String))
ok('报错内容指出该去 build', rejections.some((e) => String(e && e.message).includes('npm run build')), rejections.map((e) => e && e.message))
eq('失败时确实没注册任何工具', tools.length, 0)
eq('失败时也没往 console 写东西', logs.length, 0)

console.log('')
console.log(fail === 0 ? `全部通过：${pass} / ${pass}` : `通过 ${pass}，失败 ${fail}`)
process.exit(fail === 0 ? 0 : 1)
