// 在 vm 里真实执行 host 半边，用桩服务端到端跑一遍：
// 种子加载 / 四个 RPC / 三个工具 / 提示词上下文 / 静态资源路由
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import vm from 'node:vm'

// 数据目录必须是一次性临时目录。这里曾经写死本机路径 '/home/vesita/.dsh/arch-canvas' ——
// AGENTS.md 明写「宿主逻辑里出现任何 /home/<某人> 都是 bug」，测试里同理：
// 写死它等于把「测试到底有没有碰生产数据目录」这件事交给运气。
const TEST_DATA_DIR = mkdtempSync(join(tmpdir(), 'arch-canvas-host-'))

let pass = 0
let fail = 0
function ok(name, cond, extra) {
  if (CURRENT !== ENTRY) return
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')) }
}
function eq(name, got, want) {
  ok(name, got === want, { got, want })
}

// ---------- 桩服务 ----------
const DOC = TEST_DATA_DIR + '/architecture.mmd'
// 界面路由要真能发出 dist/ui.js，所以按本文件位置派生，不写死本机路径
const UI_FILE = new URL('../dist/ui.js', import.meta.url).pathname
// CACHE 只是桩 fs 里那把键（内容是假的），跟着一次性临时目录走，别指向真实缓存
const CACHE = TEST_DATA_DIR + '/mermaid.min.js'
const files = new Map()
files.set(CACHE, '/* fake mermaid bundle */')
// 界面路由要真能发出 dist/ui.js，所以拿构建产物喂给桩 fs
files.set(UI_FILE, readFileSync(new URL('../dist/ui.js', import.meta.url), 'utf8'))

const failWritePaths = new Set()
let lastWriteArgs = null
// 每一次写入都记下来：只记「最后一次」会漏掉「某个写盘点没带策略」这种静默失败
const allWriteArgs = []
let sandboxResolveCalls = []
const sandboxPolicySvc = {
  resolve: (req) => {
    sandboxResolveCalls.push(req)
    return {
      mode: 'workspace-write',
      workspaceRoot: req && req.session && req.session.cwd,
      sessionId: req && req.session && req.session.id,
    }
  },
}
let agentMap = new Map()
const agentsSvc = {
  get: (id) => agentMap.get(id),
}
// 随包 skill 的注册出口。**可选服务**：宿主逻辑走 ctx.get（不进 inject），
// 拿不到就静默跳过 —— 这里给一个，才能断言「真的注册了」。
const registeredSkills = []
const skillsSvc = {
  register: (def) => {
    registeredSkills.push(def)
    return () => { const i = registeredSkills.indexOf(def); if (i >= 0) registeredSkills.splice(i, 1) }
  },
}
const FAKE_SKILL_TEXT = '---\nname: arch-canvas\ndescription: 与用户共用一张 Mermaid 逻辑框架图\nwhenToUse: 用户提到「画布」时\n---\n\n# 架构画布\n\n工具怎么用…\n'
// 故障注入钩子：readText / writeText 之前可以 await 任意动作，用来模拟
// 「另一个会话在这次 await 期间把全局指针换走了」。默认空数组 = 零行为变化。
const readHooks = []
const writeHooks = []
let hookRunning = false
async function runHooks(list, key) {
  if (hookRunning) return
  for (const h of list) {
    hookRunning = true
    try { await h(key) } finally { hookRunning = false }
  }
}
const fsSvc = {
  resolve: async (p) => ({ targetKey: p, displayPath: p }),
  processPath: (t) => (t && t.targetKey) || String(t),
  stat: async (t) => {
    if (files.has(t.targetKey)) return { version: 'v1', type: 'file', size: files.get(t.targetKey).length }
    // 目录：只要有文件住在它下面就算存在。真 fs 会给 type:'directory'，
    // 桩也必须给 —— 否则 listDiagrams 永远认为目录不存在，测试会假绿。
    const prefix = String(t.targetKey).replace(/\/+$/, '') + '/'
    for (const path of files.keys()) if (path.startsWith(prefix)) return { version: 'v1', type: 'directory' }
    return undefined
  },
  readText: async (t) => {
    await runHooks(readHooks, t.targetKey)
    if (!files.has(t.targetKey)) throw new Error('ENOENT ' + t.targetKey)
    return files.get(t.targetKey)
  },
  listDir: async (t) => {
    // 直接子项，文件和目录都要报 —— 目录不报的话「从根往下扫子图库」就永远扫不到东西
    const prefix = String(t.targetKey).replace(/\/+$/, '') + '/'
    const out = []
    const dirs = new Set()
    for (const [path, content] of files) {
      if (!path.startsWith(prefix)) continue
      const rest = path.slice(prefix.length)
      if (rest === '') continue
      const slash = rest.indexOf('/')
      if (slash < 0) {
        out.push({ name: rest, type: 'file', target: { targetKey: path, displayPath: path }, size: content.length })
      } else {
        dirs.add(rest.slice(0, slash))
      }
    }
    for (const d of dirs) {
      out.push({ name: d, type: 'directory', target: { targetKey: prefix + d, displayPath: prefix + d } })
    }
    out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    return out
  },
  writeText: async (t, content, expected, signal, sandboxPolicy) => {
    await runHooks(writeHooks, t.targetKey)
    lastWriteArgs = { target: t, content, expected, signal, sandboxPolicy }
    allWriteArgs.push({ targetKey: t.targetKey, policy: sandboxPolicy })
    if (failWritePaths.has(t.targetKey)) {
      throw new Error('EIO simulated write failure on ' + t.targetKey)
    }
    const before = files.has(t.targetKey) ? files.get(t.targetKey) : null
    files.set(t.targetKey, content)
    return { operation: before === null ? 'create' : 'update', version: 'v1', before, after: content }
  },
}

const routes = []
const webSvc = { register: (r) => { routes.push(r); return () => { const i = routes.indexOf(r); if (i >= 0) routes.splice(i, 1) } } }
const prompts = []
const sysSvc = { context: (c) => { prompts.push(c); return () => { const i = prompts.indexOf(c); if (i >= 0) prompts.splice(i, 1) } } }

const handlers = new Map()
const tools = []
const RPC_PATH_TEST = '/arch-canvas/rpc'
const harness = {
  handle: (name, fn) => { handlers.set(name, fn); return () => handlers.delete(name) },
  // 宿主逻辑只**登记**路由，真正 register 由外层在 webServer 就绪后做（见 src/package/host.js）。
  route: (path, handler) => { routes.push({ kind: 'exact', path, handler }) },
  // 与真插件外壳（src/package/host.ts）同构：外壳自己也会往 webServer 上推一条 RPC 路由。
  // 宿主逻辑靠 describeRoutes() 才能数到它 —— 挂载自检判据是「4 工具 / 3 路由 / 1 提示词上下文」。
  describeRoutes: () => routes.map((r) => r.path),
  defineTool: (def) => def,
  registerTool: (_ctx, def) => { tools.push(def) },
}
routes.push({ kind: 'exact', path: RPC_PATH_TEST, handler: async () => {} })

const disposers = []
// 记下宿主逻辑问了哪些服务：'webServer' 出现在这里就是回退到「取快照」了 ——
// 那正是装机后拿到 undefined、工具与路由统统不注册的那个哑故障。
const askedServices = []
const intervals = []
const ctx = {
  get: (k) => {
    askedServices.push(k)
    return ({ fs: fsSvc, webServer: webSvc, systemPrompt: sysSvc, sandboxPolicy: sandboxPolicySvc, agents: agentsSvc, skills: skillsSvc })[k]
  },
  effect: (fn) => { const d = fn(); if (typeof d === 'function') disposers.push(d); return d },
  on: () => () => {},
  inject: (names, cb) => {
    cb({
      effect: (fn) => { const d = fn(); if (typeof d === 'function') disposers.push(d); return d },
      interval: (fn, ms) => { intervals.push({ fn, ms }); return () => {} },
    })
  },
}

// ---------- 日志后端桩 ----------
const LOG_DIR = TEST_DATA_DIR + '/logs'
const logStorage = new Map()
const oldLogFiles = [
  'arch-canvas-2020-01-01.log',
  'arch-canvas-2020-01-02.log',
  'arch-canvas-2020-01-03.log',
  'arch-canvas-2020-01-04.log',
]
for (const f of oldLogFiles) {
  logStorage.set(LOG_DIR + '/' + f, 'old log content\n')
}
const logBackend = {
  append: async (dir, file, text) => {
    const key = dir + '/' + file
    const cur = logStorage.get(key) || ''
    logStorage.set(key, cur + text)
  },
  list: async (dir) => {
    const prefix = dir + '/'
    const out = []
    for (const k of logStorage.keys()) {
      if (k.startsWith(prefix)) {
        const rest = k.slice(prefix.length)
        if (!rest.includes('/')) out.push(rest)
      }
    }
    return out
  },
  remove: async (dir, file) => {
    logStorage.delete(dir + '/' + file)
  },
  ensureDir: async (_dir) => {},
  size: async (dir, file) => {
    const cur = logStorage.get(dir + '/' + file)
    return cur ? cur.length : 0
  },
}
// 外层必须递的三样：界面/资源路径、数据目录、日志后端（真插件那半由 lib/index.js 算）。
const hostEnv = {
  logBackend,
  dataDir: TEST_DATA_DIR,
  uiFile: UI_FILE,
  mermaidFile: CACHE,
  skillFile: '/tmp/fake-skill/SKILL.md',
  skillText: FAKE_SKILL_TEXT,
}

// ---------- 执行 host 半边 ----------
const code = readFileSync(new URL('../dist/host.js', import.meta.url), 'utf8')
const sandbox = vm.createContext({ harness, console, hostEnv })
const plugin = await vm.runInContext(`(async () => {\n${code}\n})()`, sandbox, { filename: 'host-sim.js' })

// ==================== 分片共享脚手架（一个事实一个家） ====================
// 分片只 import 这一个文件：桩服务 + vm 装载 + 断言计数器在这里，各分片不再各抄一份。
// 分片是**顺序阶段**：跑第 N 片时先把第 1..N-1 片按序执行一遍（回放），这样分片能独立跑、
// 又拿得到前面阶段攒下的全部状态。回放期间 ok() 不计分、console.log 不打印 —— 条数只算本片自己的。
const PHASES = ['host.e2e.p1.mjs', 'host.e2e.p2.mjs', 'host.e2e.p3.mjs', 'host.e2e.p4.mjs']
const ENTRY = PHASES.findIndex((f) => String(process.argv[1] || '').endsWith(f)) + 1
let CURRENT = 0
let silenced = false
const realLog = console.log
function setSilenced(v) {
  if (v === silenced) return
  silenced = v
  console.log = v ? () => {} : realLog
}
export async function beginPhase(n) {
  for (let i = 0; i < n - 1; i++) await import(new URL(PHASES[i], import.meta.url).href)
  CURRENT = n
  setSilenced(n !== ENTRY)
}
export function endPhase() {
  if (CURRENT !== ENTRY) return
  console.log(fail === 0 ? `全部通过：${pass} / ${pass}` : `通过 ${pass}，失败 ${fail}`)
  process.exit(fail === 0 ? 0 : 1)
}

// ---------- 共享作用域：分片用裸名字引用这些 ----------
globalThis.TEST_DATA_DIR = TEST_DATA_DIR
globalThis.pass = pass
globalThis.fail = fail
globalThis.ok = ok
globalThis.eq = eq
globalThis.DOC = DOC
globalThis.CACHE = CACHE
globalThis.UI_FILE = UI_FILE
globalThis.files = files
globalThis.failWritePaths = failWritePaths
globalThis.allWriteArgs = allWriteArgs
globalThis.sandboxPolicySvc = sandboxPolicySvc
globalThis.agentMap = agentMap
globalThis.agentsSvc = agentsSvc
globalThis.registeredSkills = registeredSkills
globalThis.skillsSvc = skillsSvc
globalThis.FAKE_SKILL_TEXT = FAKE_SKILL_TEXT
globalThis.readHooks = readHooks
globalThis.writeHooks = writeHooks
globalThis.hookRunning = hookRunning
globalThis.runHooks = runHooks
globalThis.fsSvc = fsSvc
globalThis.routes = routes
globalThis.webSvc = webSvc
globalThis.prompts = prompts
globalThis.sysSvc = sysSvc
globalThis.handlers = handlers
globalThis.tools = tools
globalThis.RPC_PATH_TEST = RPC_PATH_TEST
globalThis.harness = harness
globalThis.disposers = disposers
globalThis.askedServices = askedServices
globalThis.intervals = intervals
globalThis.ctx = ctx
globalThis.LOG_DIR = LOG_DIR
globalThis.logStorage = logStorage
globalThis.oldLogFiles = oldLogFiles
globalThis.logBackend = logBackend
globalThis.hostEnv = hostEnv
globalThis.code = code
globalThis.sandbox = sandbox
globalThis.plugin = plugin
globalThis.mkdtempSync = mkdtempSync
globalThis.readFileSync = readFileSync
globalThis.tmpdir = tmpdir
globalThis.join = join
globalThis.vm = vm
Object.defineProperty(globalThis, 'lastWriteArgs', { get: () => lastWriteArgs, set: (v) => { lastWriteArgs = v }, configurable: true })
Object.defineProperty(globalThis, 'sandboxResolveCalls', { get: () => sandboxResolveCalls, set: (v) => { sandboxResolveCalls = v }, configurable: true })
