// 装机形态（lib/index.js）此前没有任何测试，而它正是与开发形态行为不同的那一半：
//   沙箱 harness.defineTool 会替「裸属性表」补 type:'object'（所以开发时看着通），
//   装机这半走 ctx.tools.register **原样**注册 —— 那次 Antigravity 400 就出在这里。
// 这里守住两件事：
//   1. 挂载确实注册了 4 个工具 / 3 条路由 / 1 条提示词上下文；
//   2. 整个挂载过程对 console **一字不吐**（hmr 每次 `npm run build` 都会重新挂一遍，
//      任何一行播报都会从一行变成一屏）。
import { createRequire } from 'node:module'

let pass = 0
let fail = 0
// 断言输出绕开 console 补丁：本测试要把整段挂载过程的 console 输出都抓走。
const say = console.log.bind(console)
const out = (...a) => say(...a)
function ok(name, cond, extra) {
  if (cond) { pass++; out('  ✓ ' + name) }
  else { fail++; out('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')) }
}
const eq = (name, got, want) => ok(name, got === want, { got, want })

const require = createRequire(import.meta.url)
const ENTRY = require.resolve('../lib/index.js')

// ---------- 桩服务：全部照成功方向实现，免得异步加载抛出无主 rejection 把测试带跑 ----------
const registered = []
const routes = []
const prompts = []

// host-logic 在工厂期就 ctx.get('fs') / ctx.get('systemPrompt')，所以 get 必须在 apply 之前就能给
const fsSvc = {
  resolve: async (p) => ({ targetKey: String(p), displayPath: String(p) }),
  stat: async (t) => ({ version: 'v1', type: 'file', size: 0, _t: t }),
  readText: async () => 'flowchart TD\n  a["桩"]\n',
  listDir: async () => [],
  writeText: async () => ({ operation: 'update', version: 'v1' }),
}
const toolsSvc = { register: (def) => { registered.push(def); return () => {} } }
const sysSvc = { context: (c) => { prompts.push(c); return () => {} } }
const webSvc = { register: (r) => { routes.push(r); return () => {} } }

const timers = []
const ctx = {
  // 真 cordis 上下文的服务既是 ctx.get('x') 也是 ctx.x —— 外壳的 registerTool 就是用 c.tools.register
  fs: fsSvc,
  tools: toolsSvc,
  systemPrompt: sysSvc,
  get: (k) => ({ fs: fsSvc, tools: toolsSvc, systemPrompt: sysSvc })[k],
  effect: (fn) => { fn() },
  on: () => () => {},
  // 外壳只给 webServer 做一次 inject；宿主逻辑自己再 inject 一次 timer 挂周期扫描。
  inject: (names, cb) => {
    cb({
      effect: (fn) => { fn() },
      interval: (fn, ms) => { timers.push({ fn, ms }); return () => {} },
      webServer: webSvc,
    })
  },
}

const rejections = []
const onRejection = (e) => rejections.push(e)
process.on('unhandledRejection', onRejection)

// ---------- 抓 console：捕获必须覆盖整段挂载过程 ----------
const said = []
for (const level of ['log', 'error', 'warn', 'info', 'debug']) {
  console[level] = (...a) => { said.push(level + ': ' + a.map(String).join(' ')) }
}

function mount() {
  delete require.cache[ENTRY]      // 模拟 hmr 重新 import
  const plugin = require(ENTRY)
  plugin.apply(ctx)
}

out('【首次挂载：注册结果】')
mount()
await new Promise((r) => setTimeout(r, 20))
eq('注册了 4 个工具', registered.length, 4)
eq('工具名对得上', registered.map((d) => d.name).sort().join(','), 'arch_edit,arch_read,arch_switch,arch_write')
eq('注册了 3 条路由（1 RPC + 2 静态）', routes.length, 3)
eq('注册了 1 条提示词上下文', prompts.length, 1)
eq('注册了周期扫描定时器（自动扫描 .arch-canvas）', timers.length, 1)
eq('挂载过程一行 console 输出都没有', said.length, 0)

out('【再次挂载（hmr 场景）：还是一行都不出】')
// 桩不做卸载，所以每次挂载前清一遍 —— 数的是「这一次挂载注册了多少」
for (let i = 0; i < 3; i++) {
  registered.length = 0; routes.length = 0; prompts.length = 0
  mount()
}
await new Promise((r) => setTimeout(r, 20))
eq('重挂后仍然注册了 4 个工具', registered.length, 4)
eq('重挂后仍然注册了 3 条路由', routes.length, 3)

console.log = say; console.error = say; console.warn = say; console.info = say; console.debug = say
out('【异步加载不许留下无主 rejection】')
eq('没有 unhandledRejection', rejections.length, 0)
eq('四次挂载累计仍然一行 console 输出都没有', said.length, 0)
process.off('unhandledRejection', onRejection)

console.log('')
console.log(fail === 0 ? `全部通过：${pass} / ${pass}` : `通过 ${pass}，失败 ${fail}`)
process.exit(fail === 0 ? 0 : 1)
