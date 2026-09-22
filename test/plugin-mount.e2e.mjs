// 装机形态（lib/index.js）此前没有任何测试，而它正是与开发形态行为不同的那一半：
//   沙箱 harness.defineTool 会替「裸属性表」补 type:'object'（所以开发时看着通），
//   装机这半走 ctx.tools.register **原样**注册 —— 那次 Antigravity 400 就出在这里。
// 这里守住两件事：
//   1. 挂载确实注册了 4 个工具 / 3 条路由 / 1 条提示词上下文；
//   2. 整个挂载过程对 console **一字不吐**（hmr 每次 `npm run build` 都会重新挂一遍，
//      任何一行播报都会从一行变成一屏）。
import { createRequire } from 'node:module'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// ---------- 数据目录隔离（2026-09-20） ----------
// 这个测试加载的是**装机形态**的 lib/index.js：它的 dataDir 由 $DSH_HOME 推出（缺省 ~/.dsh），
// 而日志后端是**真的 node:fs**。两者一叠加，测试事件就会直接灌进生产日志
// ~/.dsh/arch-canvas/logs/ —— 实测刷出 44 条假 notes.load.fail + 35 条假 plugin.mount
// （假内容正是下面那个桩 fs 的 'flowchart TD\n  a["桩"]\n'），还让人误以为线上有 bug、白追一轮。
// 把 DSH_HOME 指到一次性临时目录即可彻底隔离。**必须在 require(ENTRY) 之前设** ——
// lib/index.js 在模块求值期就把 dataDir 算出来了。
const TEST_HOME = mkdtempSync(join(tmpdir(), 'arch-canvas-mount-'))
process.env.DSH_HOME = TEST_HOME
const TEST_LOG_DIR = join(TEST_HOME, 'arch-canvas', 'logs')

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

// 守门：日志必须落在那个一次性临时目录里。这是**正面证据** —— 只断言"生产目录没变"
// 会跟此刻正在运行的活插件打架（它本来就在往那个目录写），必然 flaky。
let waitedLog = 0
while (!existsSync(TEST_LOG_DIR) && waitedLog < 1000) {
  await new Promise((r) => setTimeout(r, 20))
  waitedLog += 20
}
ok('日志写进一次性临时目录（没碰生产目录 ~/.dsh/arch-canvas）', existsSync(TEST_LOG_DIR), TEST_LOG_DIR)

out('【设置面：Config 必须能被 dsh 的设置服务认出来】')
// 「插件」页只为**条目上带 config** 的包渲染配置区，而设置服务要的是**真的 schema**
// （`schema(entry)` 要求它有 toJSON）。只导出一个普通对象，页面那张卡就永远不出现 ——
// 而且不报错（这正是 0.1.7 之后「设置面板看不见」的一半原因）。
const mountedPlugin = require(ENTRY)
ok('导出了 Config', mountedPlugin.Config !== undefined)
ok('Config 是真 schema（有 toJSON）', mountedPlugin.Config && typeof mountedPlugin.Config.toJSON === 'function')
ok('dataDir 声明为 volatile（不进设置表单的字段等于没有）',
  !!(mountedPlugin.Config.dict && mountedPlugin.Config.dict.dataDir
    && mountedPlugin.Config.dict.dataDir.meta.volatile))

out('【数据目录：设置优先，否则按 $DSH_HOME 算】')
// 这一条守的是 AGENTS.md「包内资源与数据目录都不要写死本机路径」：设置里给了就用它。
const customDir = join(TEST_HOME, 'custom-canvas-data')
registered.length = 0; routes.length = 0; prompts.length = 0; timers.length = 0
delete require.cache[ENTRY]
// 用一个 volatile 引用喂进去，与设置页写回的形状一致（`{ get() }`）
require(ENTRY).apply(ctx, { dataDir: { get: () => customDir } })
await new Promise((r) => setTimeout(r, 20))
eq('自定义数据目录下照样注册 4 个工具', registered.length, 4)
ok('自定义数据目录的日志落在自定义位置（不是 $DSH_HOME 下的默认值）',
  existsSync(join(customDir, 'logs')) || existsSync(join(customDir, 'arch-canvas')),
  customDir)

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
