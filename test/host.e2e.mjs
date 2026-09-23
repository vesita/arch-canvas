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
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')) }
}
function eq(name, got, want) {
  ok(name, got === want, { got, want })
}

// ---------- 桩服务 ----------
const DOC = TEST_DATA_DIR + '/architecture.mmd'
const CACHE = '/home/vesita/.dsh/.cache/arch-canvas/mermaid.min.js'
const files = new Map()
files.set(CACHE, '/* fake mermaid bundle */')
// 界面路由要真能发出 dist/ui.js，所以拿构建产物喂给桩 fs
files.set(
  '/home/vesita/coding/my/arch-canvas/dist/ui.js',
  readFileSync(new URL('../dist/ui.js', import.meta.url), 'utf8'),
)

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
    return ({ fs: fsSvc, webServer: webSvc, systemPrompt: sysSvc, sandboxPolicy: sandboxPolicySvc, agents: agentsSvc })[k]
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
  uiFile: '/home/vesita/coding/my/arch-canvas/dist/ui.js',
  mermaidFile: CACHE,
}

// ---------- 执行 host 半边 ----------
const code = readFileSync(new URL('../dist/host.js', import.meta.url), 'utf8')
const sandbox = vm.createContext({ harness, console, hostEnv })
const plugin = await vm.runInContext(`(async () => {\n${code}\n})()`, sandbox, { filename: 'host-sim.js' })

console.log('【插件对象】')
ok('返回了 { apply } 形状的插件', plugin && typeof plugin.apply === 'function', plugin === null ? 'null' : typeof plugin)
// 守门：测试的数据目录必须是一次性临时目录。写死本机路径的话，日志后端一旦换成真的
// node:fs（装机形态那半就是），测试事件会直接灌进生产日志 —— 实测被刷出 44 条假
// notes.load.fail + 35 条假 plugin.mount，还让人误以为线上有 bug。
ok('数据目录是一次性临时目录，不是生产目录', TEST_DATA_DIR !== '/home/vesita/.dsh/arch-canvas' && TEST_DATA_DIR.startsWith(tmpdir()), TEST_DATA_DIR)
plugin.apply(ctx)
ok('注册了 15 个 RPC 处理器', handlers.size === 15, [...handlers.keys()])
ok('注册了检查点的两条 RPC（取代了早先的 AI 写图开关）',
  handlers.has('doc:history') && handlers.has('doc:rollback'), [...handlers.keys()])
ok('不再有 setting:get / setting:set（那条闸门已移除）',
  !handlers.has('setting:get') && !handlers.has('setting:set'), [...handlers.keys()])
ok('注册了 4 个工具', tools.length === 4, tools.map((t) => t.name))
ok('工具名单里有 arch_switch', tools.some((t) => t.name === 'arch_switch'))
ok('注册了 1 条提示词上下文', prompts.length === 1, prompts.map((p) => p.name))
ok('注册了 3 条路由（1 RPC + 2 静态；RPC 由外壳直接推，见 src/package/host.ts）',
  routes.length === 3, routes.map((r) => r.path))
ok('外壳那条 RPC 路由的路径就是 /arch-canvas/rpc', routes.some((r) => r.path === '/arch-canvas/rpc'),
  routes.map((r) => r.path))
ok('mermaid 路由是 exact 且路径正确', routes.some((r) => r.kind === 'exact' && r.path === '/arch-canvas/mermaid.min.js'))
ok('界面路由是 exact 且路径正确', routes.some((r) => r.kind === 'exact' && r.path === '/arch-canvas/ui.js'))
ok('没有给 webServer 取快照（那会让装机后路由静默不注册）', !askedServices.includes('webServer'), askedServices)

const call = (name, args) => {
  if (name === 'doc:list' && args && args.rescan === undefined) {
    return handlers.get(name)({ rescan: true, ...args })
  }
  return handlers.get(name)(args)
}
const tool = (name) => tools.find((t) => t.name === name)

console.log('【首次加载 / 种子】')
const g1 = await call('doc:get')
ok('doc:get 返回 ok', g1 && g1.ok === true)
eq('种子节点数', g1.nodeCount, 5)
eq('种子连线数', g1.edgeCount, 6)
eq('初始修订号', g1.revision, 0)
ok('种子写盘成功', files.has(DOC))
ok('返回的 file 是路径字符串', g1.file === DOC, g1.file)
ok('返回了 model 与 mermaid', !!g1.model && typeof g1.mermaid === 'string')
ok('doc:get 带 lastChange 字段', 'lastChange' in g1)
eq('未识别项目时用全局图库', g1.scope, 'global')
eq('全局图库目录', g1.dir, TEST_DATA_DIR)
eq('默认图名', g1.diagram, 'architecture')
ok('mermaid 里含 flowchart TD', g1.mermaid.indexOf('flowchart TD') >= 0)
ok('mermaid 里含 @pos 坐标注释', g1.mermaid.indexOf('%% @pos n1 0 0') >= 0)
ok('mermaid 里含中文标签', g1.mermaid.indexOf('用户界面 (Web GUI)') >= 0)
ok('种子 doc 里的 warnings 为空（首次加载不该报错）', g1.warnings.length === 0, g1.warnings)

console.log('【@pos 往返：解析出的坐标是数字】')
const n1 = g1.model.nodes.find((n) => n.id === 'n1')
ok('n1 坐标为 (0,0)', n1 && n1.x === 0 && n1.y === 0, n1)
const n3 = g1.model.nodes.find((n) => n.id === 'n3')
ok('n3 坐标为 (300,140)', n3 && n3.x === 300 && n3.y === 140, n3)
ok('n3 形状是 cyl（数据库）', n3 && n3.shape === 'cyl', n3 && n3.shape)
const n4 = g1.model.nodes.find((n) => n.id === 'n4')
ok('n4 形状是 diamond', n4 && n4.shape === 'diamond', n4 && n4.shape)
ok('连线标签被解析出来', g1.model.edges.some((e) => e.label === '输入 / 操作'))
ok('虚线样式被解析出来', g1.model.edges.some((e) => e.arrow === '-.->'))

console.log('【提示词上下文】')
const ctxText = prompts[0].text
ok('text 是函数（每步动态求值）', typeof ctxText === 'function')
const t1 = ctxText()
ok('提示词里含当前 mermaid 源码', t1.indexOf('flowchart TD') >= 0)
ok('提示词里含修订号', t1.indexOf('修订 0') >= 0)
ok('提示词是 string', typeof t1 === 'string')
eq('提示词 order', prompts[0].order, 137)

console.log('【arch_read】')
const r1 = await tool('arch_read').execute({}, {})
ok('arch_read 返回 mermaid', typeof r1.mermaid === 'string' && r1.mermaid.indexOf('flowchart TD') >= 0)
const rendered = tool('arch_read').output.render({}, r1)
ok('render 返回内容块数组', Array.isArray(rendered) && rendered[0].type === 'text' && typeof rendered[0].text === 'string', rendered)

console.log('【用户改图：doc:set 保留布局】')
const moved = JSON.parse(JSON.stringify(g1.model))
moved.nodes.find((n) => n.id === 'n2').x = 777
moved.nodes.find((n) => n.id === 'n2').y = 888
const s1 = await call('doc:set', { model: moved, note: '用户移动了节点' })
eq('doc:set 后修订号 = 1', s1.revision, 1)
eq('updatedBy = user', s1.updatedBy, 'user')
ok('doc:set 后 mermaid 含新坐标', s1.mermaid.indexOf('%% @pos n2 777 888') >= 0)
ok('doc:set 落盘', files.get(DOC).indexOf('%% @pos n2 777 888') >= 0)
ok('用户改动标成 user（界面据此不高亮）', s1.lastChange && s1.lastChange.by === 'user', s1.lastChange)
ok('用户改动不点名任何节点', s1.lastChange.nodes.length === 0)

console.log('【AI 增量改图：arch_edit】')
const e1 = await tool('arch_edit').execute({
  ops: [
    { op: 'add_node', id: 'cache', label: '缓存层', shape: 'cyl' },
    { op: 'add_edge', from: 'n2', to: 'cache', label: '命中查询' },
    { op: 'set_label', id: 'n5', label: '同步执行（改名后）' },
    { op: 'move_node', id: 'cache', x: 500, y: 300 },
    { op: 'add_group', group: 'infra', label: '基础设施' },
    { op: 'set_group', id: 'cache', group: 'infra' },
    { op: 'add_node', id: 'n5' },
    { op: 'add_edge', from: 'ghost', to: 'cache' },
    { op: 'remove_edge', from: 'n2', to: 'n4' },
    { op: 'set_direction', value: 'LR' },
  ],
}, {})
eq('生效操作数', e1.appliedCount, 8)
eq('问题数', e1.problems.length, 2)
ok('重复 id 被拒且提示改用 set_label', e1.problems[0].indexOf('已存在') >= 0 && e1.problems[0].indexOf('set_label') >= 0, e1.problems[0])
ok('不存在的 from 被拒', e1.problems[1].indexOf('from 节点不存在') >= 0, e1.problems[1])
ok('新节点进来了', e1.nodeCount === 6, e1.nodeCount)
eq('方向改为 LR', e1.mermaid.indexOf('flowchart LR') >= 0, true)
ok('用户摆的 n2 坐标没被 arch_edit 冲掉', e1.mermaid.indexOf('%% @pos n2 777 888') >= 0)
ok('新节点带坐标', e1.mermaid.indexOf('%% @pos cache 500 300') >= 0)
ok('改名生效', e1.mermaid.indexOf('同步执行（改名后）') >= 0)
ok('删连线生效', e1.mermaid.indexOf('n2 --> n4') < 0)
ok('分组写成了 subgraph', e1.mermaid.indexOf('subgraph infra') >= 0)
const re1 = tool('arch_edit').output.render({}, e1)
ok('arch_edit render 有内容', typeof re1[0].text === 'string' && re1[0].text.indexOf('未生效') >= 0)
ok('arch_edit 回执说明已高亮', re1[0].text.indexOf('高亮') >= 0)

console.log('【改动来源：界面靠它高亮 AI 刚动过的地方】')
ok('arch_edit 后 lastChange.by = ai', e1.lastChange && e1.lastChange.by === 'ai', e1.lastChange)
ok('arch_edit 后 lastChange.rev = 当前修订', e1.lastChange.rev === e1.revision)
ok('lastChange 点名了新增的 cache', e1.lastChange.nodes.indexOf('cache') >= 0, e1.lastChange.nodes)
ok('lastChange 点名了改名的 n5', e1.lastChange.nodes.indexOf('n5') >= 0, e1.lastChange.nodes)
ok('lastChange 点名了被移动的 cache（同一次）', e1.lastChange.nodes.filter((x) => x === 'cache').length === 1)
ok('没被碰过的节点不在里面', e1.lastChange.nodes.indexOf('n3') < 0, e1.lastChange.nodes)

const e2 = await tool('arch_edit').execute({ ops: [{ op: 'set_label', id: '不存在', label: 'x' }] }, {})
ok('全部 op 失败时 appliedCount = 0', e2.appliedCount === 0)
ok('全部 op 失败时 lastChange.nodes 为空（不该乱闪）', e2.lastChange.nodes.length === 0, e2.lastChange)

console.log('【arch_write：整图替换 + 继承旧坐标】')
const w1 = await tool('arch_write').execute({
  mermaid: 'flowchart TD\n  n1["新入口"]\n  n9["全新节点"]\n  n1 --> n9\n',
  note: 'AI 重画',
}, {})
ok('arch_write ok', w1.ok === true, w1)
eq('替换后节点数', w1.nodeCount, 2)
ok('同 id 继承旧坐标', w1.mermaid.indexOf('%% @pos n1 0 0') >= 0, w1.mermaid)
ok('新 id 没有坐标（留给客户端自动布局）', w1.mermaid.indexOf('@pos n9') < 0)
ok('旧节点被移除', w1.mermaid.indexOf('用户界面') < 0)
eq('updatedBy = ai', w1.updatedBy, 'ai')
ok('arch_write 后 lastChange.by = ai', w1.lastChange && w1.lastChange.by === 'ai', w1.lastChange)
ok('整图替换的点名含改标签的 n1', w1.lastChange.nodes.indexOf('n1') >= 0, w1.lastChange.nodes)
ok('整图替换的点名含全新的 n9', w1.lastChange.nodes.indexOf('n9') >= 0, w1.lastChange.nodes)

console.log('【arch_write 拒绝垃圾输入】')
const w2 = await tool('arch_write').execute({ mermaid: '@@@ ###\n=== ???' }, {})
ok('解析不出节点时 ok=false', w2.ok === false)
ok('报错有解释', typeof w2.error === 'string' && w2.error.length > 0, w2.error)
ok('拒绝后未破坏原图', files.get(DOC).indexOf('新入口') >= 0)

console.log('【用户手改源码：doc:applyText】')
const a1 = await call('doc:applyText', { text: 'flowchart TD\n  n1["新入口"]\n  n9["全新节点"]\n  n1 --> n9\n' })
ok('applyText ok', a1.ok === true, a1)
ok('applyText 继承了 n1 旧坐标', a1.mermaid.indexOf('%% @pos n1 0 0') >= 0, a1.mermaid)
const a2 = await call('doc:applyText', { text: '@@@ ###' })
ok('applyText 垃圾输入 ok=false', a2.ok === false)
ok('applyText 垃圾输入时回传现图', typeof a2.mermaid === 'string' && a2.mermaid.indexOf('新入口') >= 0)

console.log('【轮询与资源】')
const rev1 = await call('doc:rev')
eq('doc:rev 与当前修订号一致', rev1.revision, (await call('doc:get')).revision)
const mi = await call('mermaid:info')
eq('mermaid:info 给出本地路由', mi.url, '/arch-canvas/mermaid.min.js')
const ui = await call('ui:info')
eq('ui:info 给出界面路由', ui.url, '/arch-canvas/ui.js')
eq('ui:info 指出界面文件在项目里', ui.file, '/home/vesita/coding/my/arch-canvas/dist/ui.js')
const res2 = { statusCode: 200, headers: {}, body: null, end(b) { this.body = b }, setHeader(k, v) { this.headers[k] = v } }
await routes.find((r) => r.path === '/arch-canvas/ui.js').handler({}, res2)
eq('界面路由回 200', res2.statusCode, 200)
ok('界面路由不缓存（构建完刷新就能拿到新代码）', String(res2.headers['cache-control']).includes('no-store'), res2.headers['cache-control'])
ok('界面路由返回了 ui.js 内容', typeof res2.body === 'string' && res2.body.includes('__archCanvas'))

const res = { statusCode: 200, headers: {}, body: null, end(b) { this.body = b }, setHeader(k, v) { this.headers[k] = v } }
await routes.find((r) => r.path.endsWith('mermaid.min.js')).handler({}, res)
eq('路由回 200', res.statusCode, 200)
eq('路由 content-type 是 js', res.headers['content-type'], 'text/javascript; charset=utf-8')
ok('路由返回了 bundle 内容', res.body === '/* fake mermaid bundle */')

console.log('【图库跟着项目走】')
const P = await call('doc:get', { where: '/proj-a' })
eq('带 where 时切到项目图库', P.dir, '/proj-a/.arch-canvas')
eq('标记为项目图库', P.scope, 'project')
eq('文件落在 <项目>/.arch-canvas/', P.file, '/proj-a/.arch-canvas/architecture.mmd')
eq('未建库时读到的是空文档', P.nodeCount, 0, P.nodeCount)
ok('未建库时不生成说明', P.notes.length === 0, P.notes)
ok('切库标记为 switch（界面据此重新适应视图）', P.lastChange && P.lastChange.by === 'switch', P.lastChange)
ok('换文档时修订号单调递增（不复位，防止界面漏掉变化）', P.revision > g1.revision, { before: g1.revision, after: P.revision })

const L1 = await call('doc:list', { where: '/proj-a' })
eq('清单里有 0 张活图', L1.items.length, 0)
eq('清单标出当前图', L1.current, 'architecture')

const N = await call('doc:open', { where: '/proj-a', name: '支付流程', create: true })
ok('新建中文名的图', N.ok === true && N.diagram === '支付流程', N)
await tool('arch_write').execute({ mermaid: 'flowchart TD\n  a["下单"] --> b["扣款"]\n' }, {})
const L2 = await call('doc:list', { where: '/proj-a' })
eq('清单里有 2 张', L2.items.length, 2, L2.items.map((x) => x.name))

const R = await call('doc:rename', { where: '/proj-a', from: '支付流程', to: '支付主流程' })
ok('改名后当前图名跟着变', R.diagram === '支付主流程', R.diagram)
const L3 = await call('doc:list', { where: '/proj-a' })
ok('改名 = 新建 + 旧名软删（fs 没有 unlink）', L3.items.some((x) => x.name === '支付流程' && x.deleted === true), L3.items)
ok('新名是活的', L3.items.some((x) => x.name === '支付主流程' && !x.deleted))
ok('改名不会覆盖同名图',
  (await call('doc:rename', { where: '/proj-a', from: '支付主流程', to: '支付主流程' })).ok === false)

await call('doc:delete', { where: '/proj-a', name: '支付主流程' })
const L4 = await call('doc:list', { where: '/proj-a' })
ok('删除是软删：文件仍在磁盘上', files.has('/proj-a/.arch-canvas/支付主流程.mmd'))
ok('删除是软删：内容原样保留', files.get('/proj-a/.arch-canvas/支付主流程.mmd').indexOf('下单') >= 0)
ok('删除后从活图里消失', L4.items.some((x) => x.name === '支付主流程' && x.deleted === true))
await call('doc:restore', { where: '/proj-a', name: '支付主流程' })
const L5 = await call('doc:list', { where: '/proj-a' })
ok('恢复后回到活图', L5.items.some((x) => x.name === '支付主流程' && !x.deleted))

const bk = await call('doc:open', { where: '/proj-a', name: '支付主流程' })
ok('切回那张图并带回内容', bk.diagram === '支付主流程' && bk.nodeCount === 2, { diagram: bk.diagram, nodeCount: bk.nodeCount })
ok('切回来的是那张图自己的内容（不是默认图）', bk.model.nodes.some((n) => n.id === 'a'), bk.model.nodes.map((n) => n.id))

console.log('【首次进项目图库：写盘时建目录 + 一次性继承】')
ok('写盘后文件写出，目录因此存在',
  [...files.keys()].some((k) => k.indexOf('/proj-a/.arch-canvas/') === 0), [...files.keys()].filter((k) => k.indexOf('/proj-a/') === 0))
ok('全局图库的图在首次写盘时被继承了过来',
  files.has('/proj-a/.arch-canvas/architecture.mmd'), [...files.keys()].filter((k) => k.indexOf('/proj-a/') === 0))
// 「只做一次」不再靠标记文件，而是靠「目标图库里已经有图了」这个事实本身：
// 往全局图库**新加**一张，再在同一个项目里建图 —— 它不该被继承过来。
// （不动全局那份 architecture.mmd：它是后面几个用例的公共夹具。）
files.set(TEST_DATA_DIR + '/占位新图.mmd', 'flowchart TD\n  g9["全局后来加的"]\n')
await call('doc:open', { where: '/proj-a', name: '另一张', create: true })
ok('第二次进同一个项目图库：不再重新继承', !files.has('/proj-a/.arch-canvas/占位新图.mmd'),
  [...files.keys()].filter((k) => k.indexOf('/proj-a/.arch-canvas/') === 0))
files.delete(TEST_DATA_DIR + '/占位新图.mmd')
const P2 = await call('doc:get', { where: '/proj-b' })
ok('读路径未建占位文件', !files.has('/proj-b/.arch-canvas/.gitkeep'))
eq('第二个项目读路径也是干净空图', P2.nodeCount, 0)
// 注意：探 /proj-b 会把图库切走，而「换库回到默认图」是设计行为 ——
// 所以后面要继续测支付图，必须显式切回来。这一步也顺便验证了那条设计。
const backA = await call('doc:open', { where: '/proj-a', name: '支付主流程' })
ok('切回 /proj-a 并重新打开支付主流程', backA.diagram === '支付主流程', backA.diagram)

// ---------- 回归：建新图绝不许覆盖目标图库里已有的图（2026-09-21 实测事故）----------
// 事故现场：本仓库的 .arch-canvas/architecture.mmd（23 节点）在 arch_switch { create: true }
// 里被全局兜底那张老图整份盖掉，日志里一条都没留。根因是 inheritGlobalOnce 用「全局目录下的
// .inherited 标记」判「做过一次」，而且复制时同名直接覆盖。
console.log('【回归：建新图不许覆盖已有的图】')
{
  const dirKeep = '/tmp/proj-keep'
  const keepFile = dirKeep + '/.arch-canvas/architecture.mmd'
  files.set(keepFile, 'flowchart TD\n  keep1["我自己的图"]\n')
  const keepBefore = files.get(keepFile)
  const keepOpen = await call('doc:open', { where: dirKeep, name: '第二张', create: true })
  ok('已有图的项目里建新图仍然成功', keepOpen && keepOpen.ok !== false, keepOpen && keepOpen.error)
  eq('已有的同名图一个字节都没被动', files.get(keepFile), keepBefore)
  ok('全局图库没有盖过来（还是我自己的内容）', files.get(keepFile).indexOf('我自己的图') >= 0, files.get(keepFile))
  ok('新图确实建出来了', files.has(dirKeep + '/.arch-canvas/第二张.mmd'))

  // 护栏 2 单独验：目标图库里只有一张**已删除**的图时，护栏 1 不拦（没有活着的图），
  // 但同名文件必须仍然不许被盖。
  const dirTomb = '/tmp/proj-tomb'
  const tombFile = dirTomb + '/.arch-canvas/architecture.mmd'
  files.set(tombFile, '%% @deleted\nflowchart TD\n  t1["已经删掉了，但内容还在文件里"]\n')
  const tombBefore = files.get(tombFile)
  const tombOpen = await call('doc:open', { where: dirTomb, name: '新图', create: true })
  ok('墓碑图库里的 create 也成功', tombOpen && tombOpen.ok !== false, tombOpen && tombOpen.error)
  eq('已删除的图（内容还在文件里）也不会被覆盖', files.get(tombFile), tombBefore)
  ok('同一层里有别的图时，全局里同名的那张不会被复制进来',
    files.get(tombFile).indexOf('全局') < 0, files.get(tombFile))

  // 这两段探过别的图库，必须切回来 —— 否则后面的用例会拿着别的项目的图跑（踩过一次）。
  const backKeep = await call('doc:open', { where: '/proj-a', name: '支付主流程' })
  ok('回归段结束时切回 /proj-a', backKeep && backKeep.diagram === '支付主流程', backKeep && backKeep.diagram)
}

console.log('【下钻链接：%% @link】')
const beforeLk = await call('doc:get', { where: '/proj-a' })
ok('做 set_link 之前当前图里有节点 a', beforeLk.model.nodes.some((n) => n.id === 'a'), beforeLk.model.nodes.map((n) => n.id))
const lk = await tool('arch_edit').execute({ ops: [{ op: 'set_link', id: 'a', link: 'architecture' }] }, {})
ok('set_link 生效', lk.appliedCount === 1 && lk.done[0].indexOf('下钻') >= 0,
  { appliedCount: lk.appliedCount, done: lk.done, problems: lk.problems })
ok('序列化出 @link 行', lk.mermaid.indexOf('%% @link a "architecture"') >= 0, lk.mermaid.split('\n').filter((l) => l.indexOf('@link') >= 0))
const rt = await call('doc:applyText', { where: '/proj-a', text: lk.mermaid })
ok('@link 往返：解析回 link 字段', rt.model.nodes.filter((n) => n.id === 'a')[0].link === 'architecture', rt.model.nodes.filter((n) => n.id === 'a')[0])
ok('带链接的节点会被清单统计', (await call('doc:list', { where: '/proj-a' })).items.some((x) => x.name === '支付主流程' && x.links === 1))

console.log('【AI 侧：只读别的图 / 切图】')
const ro = await tool('arch_read').execute({ diagram: 'architecture' }, {})
ok('arch_read 指定图名读到另一张', ro.ok === true && ro.diagram === 'architecture')
ok('只读不切：当前图没变', (await call('doc:get', { where: '/proj-a' })).diagram === '支付主流程')
const roBad = await tool('arch_read').execute({ diagram: '不存在的' }, {})
ok('读不存在的图返回 ok:false', roBad.ok === false)
const sw = await tool('arch_switch').execute({ name: 'architecture' }, {})
ok('arch_switch 切过去', sw.ok === true && sw.diagram === 'architecture', sw.error)
const swBad = await tool('arch_switch').execute({ name: '也 不 存在' }, {})
ok('切不存在的图报错', swBad.ok === false)
ok('报错里列出可选图名并提示 create', String(swBad.error).indexOf('支付主流程') >= 0 && String(swBad.error).indexOf('create') >= 0, swBad.error)

console.log('【子目录图库：从根往下看（存储平铺，嵌套只在视图里）】')
files.set('/proj-a/子项目/.arch-canvas/细节图.mmd', 'flowchart TD\n  x["细节"] --> y["更多细节"]\n')
files.set('/proj-a/node_modules/.arch-canvas/不该出现.mmd', 'flowchart TD\n  z["no"]\n')
const deep = await call('doc:list', { where: '/proj-a' })
ok('子目录里的图出现在清单里', deep.items.some((x) => x.key === '子项目/细节图'), deep.items.map((x) => x.key))
ok('带上了它所属的子项目', deep.items.some((x) => x.key === '子项目/细节图' && x.project === '子项目'))
ok('跳过 node_modules（否则容器根下会扫爆）', !deep.items.some((x) => String(x.key).indexOf('node_modules') >= 0), deep.items.map((x) => x.key))
ok('根图库的 key 就是图名', deep.items.some((x) => x.key === 'architecture'))

const nested = await call('doc:open', { where: '/proj-a', key: '子项目/细节图' })
eq('打开子项目的图：当前层切了过去', nested.dir, '/proj-a/子项目/.arch-canvas')
eq('当前图的引用名是完整 key', nested.key, '子项目/细节图')
eq('读到的是那张图的内容', nested.nodeCount, 2)
ok('切层标记为 switch', nested.lastChange && nested.lastChange.by === 'switch')

const lkCross = await tool('arch_edit').execute({ ops: [{ op: 'set_link', id: 'x', link: 'architecture' }] }, {})
ok('跨图库链接（指回根图库）', lkCross.mermaid.indexOf('%% @link x "architecture"') >= 0,
  lkCross.mermaid.split('\n').filter((l) => l.indexOf('@link') >= 0))
const lkPath = await tool('arch_edit').execute({ ops: [{ op: 'set_link', id: 'y', link: '子项目/细节图' }] }, {})
ok('链接可以写子项目路径', lkPath.mermaid.indexOf('%% @link y "子项目/细节图"') >= 0,
  lkPath.mermaid.split('\n').filter((l) => l.indexOf('@link') >= 0))
const lkBack = await call('doc:applyText', { where: '/proj-a', text: lkPath.mermaid })
ok('带路径的链接往返', lkBack.model.nodes.filter((n) => n.id === 'y')[0].link === '子项目/细节图',
  lkBack.model.nodes.filter((n) => n.id === 'y')[0])

ok('改名不能跨图库',
  (await call('doc:rename', { where: '/proj-a', from: '子项目/细节图', to: '别的图' })).ok === false)
ok('arch_read 能只读子项目的图而不切换',
  (await tool('arch_read').execute({ diagram: '子项目/细节图' }, {})).key === '子项目/细节图')
const swBack = await tool('arch_switch').execute({ key: 'architecture' }, {})
ok('arch_switch 用根 key 切回来', swBack.ok === true && swBack.key === 'architecture', swBack.error)

console.log('【doc:file 只负责落盘（路径由图库决定）】')
const f1 = await call('doc:file', { where: '/proj-a', save: true })
ok('落盘 ok', f1.saved === true, f1)
ok('落的是当前图库里的当前图', files.has(f1.file) && f1.file.indexOf('/proj-a/.arch-canvas/') === 0, f1.file)

console.log('【副作用可逆】')
ok('收集到 disposer（effect 有返回）', disposers.length >= 6, disposers.length)

// 等待日志异步队列写入完毕
await new Promise((r) => setTimeout(r, 60))

console.log('【T1 日志真的落地 + 3 天保留】')
const nowDay = (() => {
  const d = new Date()
  const m = d.getMonth() + 1
  const day = d.getDate()
  return d.getFullYear() + '-' + (m < 10 ? '0' + m : '' + m) + '-' + (day < 10 ? '0' + day : '' + day)
})()
const todayLogKey = LOG_DIR + '/arch-canvas-' + nowDay + '.log'
for (const f of oldLogFiles) {
  ok('旧日志文件已清理: ' + f, !logStorage.has(LOG_DIR + '/' + f))
}
ok('当天日志文件存在', logStorage.has(todayLogKey))
const todayLogLines = (logStorage.get(todayLogKey) || '').trim().split('\n').map((l) => {
  try { return JSON.parse(l) } catch (e) { return null }
}).filter(Boolean)
const mountLog = todayLogLines.find((row) => row.ev === 'plugin.mount')
ok('当天日志包含合法 plugin.mount 行且 toolCount === 4', !!mountLog && mountLog.toolCount === 4, mountLog)
// 挂载自检判据是「4 工具 / 3 路由 / 1 提示词上下文」，而 routeCount 从前只数了宿主逻辑自己的
// onRoute（2 条静态），RPC 那条是外壳直接推的 —— 唯一的机器可读记录永远对不上。
ok('plugin.mount 的 routeCount 反映真实注册数（1 RPC + 2 静态 = 3）',
  !!mountLog && mountLog.routeCount === 3, mountLog && { routeCount: mountLog.routeCount, routes: mountLog.routes })
eq('mount 的 routeCount 等于 webServer 真实收到的路由数（日志不许自己编一个数）',
  mountLog && mountLog.routeCount, routes.length)
ok('mount 的路由清单与真实注册逐一对应（含外壳那条 RPC）',
  !!mountLog && String(mountLog.routes).split(',').sort().join('|') === routes.map((r) => r.path).sort().join('|'),
  mountLog && { logged: mountLog.routes, real: routes.map((r) => r.path) })
ok('负向对照：外壳那条 RPC 路由确实被注册了（少一条上面两条就红）',
  routes.some((r) => r.path === '/arch-canvas/rpc'), routes.map((r) => r.path))
const editLog = todayLogLines.find((row) => row.ev === 'tool.arch_edit')
ok('当天日志包含 tool.arch_edit 且含 ops 字段', !!editLog && typeof editLog.ops === 'number', editLog)
const retentionLog = todayLogLines.find((row) => row.ev === 'log.retention')
ok('当天日志包含 log.retention 说明清理确实发生', !!retentionLog && retentionLog.removed === 4, retentionLog)

console.log('【T2 落盘失败 → 内存回滚】')
const beforeT2 = await call('doc:get')
const t2Node = beforeT2.model.nodes.find((n) => n.id === 'n1')
const t2OldLabel = t2Node.label
const docTargetKey = (await fsSvc.resolve(beforeT2.file)).targetKey
const beforeMmdDisk = files.get(docTargetKey)

failWritePaths.add(docTargetKey)
const t2FailedEdit = await tool('arch_edit').execute({
  ops: [{ op: 'set_label', id: 'n1', label: '尝试修改标签导致失败' }],
}, {})
failWritePaths.delete(docTargetKey)

ok('落盘失败时 lastChange.nodes 不包含该节点', !t2FailedEdit.lastChange || !t2FailedEdit.lastChange.nodes.includes('n1'), t2FailedEdit.lastChange)
const afterRollbackDoc = await call('doc:get')
const rolledNode = afterRollbackDoc.model.nodes.find((n) => n.id === 'n1')
eq('回滚后模型里该节点标签仍是旧值', rolledNode && rolledNode.label, t2OldLabel)
ok('warnings 里出现「回滚」', afterRollbackDoc.warnings.some((w) => w.includes('回滚')), afterRollbackDoc.warnings)
eq('磁盘上 .mmd 内容与改动前一致', files.get(docTargetKey), beforeMmdDisk)

const t2SuccessEdit = await tool('arch_edit').execute({
  ops: [{ op: 'set_label', id: 'n1', label: '恢复正常后成功改名' }],
}, {})
const afterSuccessDoc = await call('doc:get')
const successNode = afterSuccessDoc.model.nodes.find((n) => n.id === 'n1')
eq('关掉失败开关后再次调用真的改了', successNode && successNode.label, '恢复正常后成功改名')

console.log('【T3 畸形 op 不会误伤同名节点】')
await tool('arch_write').execute({
  mermaid: 'flowchart TD\n  n["普通节点"]\n',
  note: '准备测试畸形 op 的图',
}, {})
const t3Edit = await tool('arch_edit').execute({
  ops: [{ op: 'remove_node' }],
}, {})
ok('remove_node 缺少 id 时 problems 里出现「缺少 id」', t3Edit.problems.some((p) => p.includes('缺少 id')), t3Edit.problems)
const t3After = await call('doc:get')
ok('缺少 id 的 remove_node 未误伤节点 n', t3After.model.nodes.some((n) => n.id === 'n'), t3After.model.nodes)

console.log('【T4 自环与缺字段被拒】')
const t4Edit1 = await tool('arch_edit').execute({
  ops: [{ op: 'set_edge_label', from: 'n', to: 'n', label: '自环' }],
}, {})
ok('set_edge_label 自环时 problems 里有「自环」', t4Edit1.problems.some((p) => p.includes('自环')), t4Edit1.problems)
const t4After1 = await call('doc:get')
ok('模型里没有自环边', !t4After1.model.edges.some((e) => e.from === e.to), t4After1.model.edges)

const edgeCountBefore = t4After1.model.edges.length
const t4Edit2 = await tool('arch_edit').execute({
  ops: [{ op: 'remove_edge' }],
}, {})
ok('remove_edge 缺少 from/to 时 problems 里出现「缺少 from」', t4Edit2.problems.some((p) => p.includes('缺少 from')), t4Edit2.problems)
const t4After2 = await call('doc:get')
eq('缺少字段被拒后模型里的边数量不变', t4After2.model.edges.length, edgeCountBefore)

console.log('【T5 并发切库不互相覆盖】')
const dirA = '/tmp/arch-canvas-test-A'
const dirB = '/tmp/arch-canvas-test-B'
const fileA = dirA + '/.arch-canvas/architecture.mmd'
const fileB = dirB + '/.arch-canvas/architecture.mmd'
const contentA = 'flowchart TD\n  A1["节点 A1"]\n'
const contentB = 'flowchart TD\n  B1["节点 B1"]\n'
files.set(fileA, contentA)
files.set(fileB, contentB)

const [pA, pB] = [
  call('doc:get', { where: dirA }),
  call('doc:get', { where: dirB }),
]
const [resA, resB] = await Promise.all([pA, pB])

ok('B 的返回含 B1 且不含 A1', resB.mermaid.includes('B1') && !resB.mermaid.includes('A1'), resB.mermaid)
ok('A 文件内容保持原样不含 B1', files.get(fileA).includes('A1') && !files.get(fileA).includes('B1'), files.get(fileA))
ok('B 文件内容保持原样不含 A1', files.get(fileB).includes('B1') && !files.get(fileB).includes('A1'), files.get(fileB))

console.log('【R1 doc:rename】')
const dirR = '/proj-r'
const fileRArch = dirR + '/.arch-canvas/architecture.mmd'
const fileROld = dirR + '/.arch-canvas/旧名.mmd'
const fileRNew = dirR + '/.arch-canvas/新名.mmd'
const fileROther = dirR + '/.arch-canvas/副图.mmd'
const contentArch = 'flowchart TD\n  arch["架构图主节点"]\n'
const contentOld = 'flowchart TD\n  old["旧图业务节点"]\n'
const contentOther = 'flowchart TD\n  other["副图节点"]\n'

files.set(fileRArch, contentArch)
files.set(fileROld, contentOld)
files.set(fileROther, contentOther)

const gArch = await call('doc:get', { where: dirR })
eq('首次进 dirR 拿到 architecture', gArch.diagram, 'architecture')

const openOld = await call('doc:open', { where: dirR, name: '旧名' })
ok('打开旧名成功', openOld && openOld.ok === true && openOld.diagram === '旧名')

const renRes = await call('doc:rename', { where: dirR, from: '旧名', to: '新名' })
ok('doc:rename 返回 ok', renRes && renRes.ok === true)
eq('新文件内容与旧文件一致', files.get(fileRNew), contentOld)
ok('旧文件仍在磁盘上', files.has(fileROld))
ok('旧文件带墓碑（以 %% @deleted 开头）', files.get(fileROld).indexOf('%% @deleted') === 0)

const listR1 = await call('doc:list', { where: dirR })
ok('doc:list 出现新名', listR1.items.some((x) => x.name === '新名' && !x.deleted))
ok('doc:list 活图里不再列出旧名', !listR1.items.some((x) => x.name === '旧名' && !x.deleted))
ok('doc:list 中旧名标记为已软删除', listR1.items.some((x) => x.name === '旧名' && x.deleted === true))

const renCross = await call('doc:rename', { where: dirR, from: '新名', to: '子项目/新名' })
eq('跨图库改名返回 ok:false', renCross.ok, false)
ok('错误信息指明改名不能跨图库', typeof renCross.error === 'string' && renCross.error.includes('改名不能跨图库'), renCross.error)

const renDup = await call('doc:rename', { where: dirR, from: '新名', to: 'architecture' })
eq('目标已存在时不覆盖返回 ok:false', renDup.ok, false)
ok('错误信息提示已存在同名图', typeof renDup.error === 'string' && renDup.error.includes('已经有叫「architecture」的图了'), renDup.error)
eq('目标图内容未被覆盖', files.get(fileRArch), contentArch)

const curAfterRename = await call('doc:get', { where: dirR })
eq('改当前图后 doc:get 的 diagram 跟着变成新名字', curAfterRename.diagram, '新名')
eq('改当前图后 doc:get 的 key 跟着变成新名字', curAfterRename.key, '新名')

console.log('【R2 doc:delete（软删除）】')
const delOther = await call('doc:delete', { where: dirR, key: '副图' })
ok('doc:delete 非当前图返回 ok', delOther && delOther.ok === true)
ok('副图文件内容变成墓碑开头', files.get(fileROther).indexOf('%% @deleted') === 0)
const listAfterDel = await call('doc:list', { where: dirR })
ok('doc:list 里该项 deleted === true', listAfterDel.items.some((x) => x.name === '副图' && x.deleted === true))
ok('副图文件没有被删掉（还在 fs 桩里）', files.has(fileROther))

const delCur = await call('doc:delete', { where: dirR, key: '新名' })
ok('doc:delete 当前图返回 ok', delCur && delCur.ok === true)
ok('回执里带着文档且换回默认图 architecture', delCur.diagram === 'architecture' && !!delCur.model)
const curAfterDel = await call('doc:get', { where: dirR })
eq('doc:get 之后 diagram === architecture', curAfterDel.diagram, 'architecture')

console.log('【R3 doc:restore】')
const restoreOther = await call('doc:restore', { where: dirR, key: '副图' })
ok('doc:restore 返回 ok', restoreOther && restoreOther.ok === true)
ok('文件里的墓碑行被去掉', !files.get(fileROther).includes('%% @deleted'))
eq('文件内容恢复为原始内容', files.get(fileROther), contentOther)
const listAfterRestore = await call('doc:list', { where: dirR })
const restoredItem = listAfterRestore.items.find((x) => x.name === '副图')
ok('doc:list 里 deleted === false', !!restoredItem && restoredItem.deleted === false)
eq('节点数恢复为 1', restoredItem && restoredItem.nodes, 1)

const restoreArch = await call('doc:restore', { where: dirR, key: 'architecture' })
ok('对没被删的图调 doc:restore 不报错', restoreArch && restoreArch.ok === true)
eq('未删除的图内容不变（幂等）', files.get(fileRArch), contentArch)

console.log('【R4 数据目录是外层的硬依赖】')
const hostEnvNoData = {
  logBackend,
  uiFile: '/home/vesita/coding/my/arch-canvas/dist/ui.js',
  mermaidFile: CACHE,
}
const sandboxNoData = vm.createContext({ harness, console, hostEnv: hostEnvNoData })
const pluginNoData = await vm.runInContext(`(async () => {\n${code}\n})()`, sandboxNoData, { filename: 'host-no-data.js' })
let applyErr = null
try {
  pluginNoData.apply(ctx)
} catch (e) {
  applyErr = e
}
ok('hostEnv 缺少 dataDir 时 plugin.apply 抛错', !!applyErr)
ok('错误信息里提到 dataDir', applyErr && typeof applyErr.message === 'string' && applyErr.message.includes('dataDir'), applyErr && applyErr.message)

console.log('【S1 扫描 .arch-canvas（含子项目与更深一层）】')
const dirS = '/tmp/proj-scan'
files.set(dirS + '/.arch-canvas/a.mmd', 'flowchart TD\n  a1["A1"]\n')
files.set(dirS + '/sub/.arch-canvas/b.mmd', 'flowchart TD\n  b1["B1"]\n')
files.set(dirS + '/x/y/.arch-canvas/c.mmd', 'flowchart TD\n  c1["C1"]\n')
files.set(dirS + '/node_modules/pkg/.arch-canvas/zzz.mmd', 'flowchart TD\n  z1["Z1"]\n')

const listS1 = await call('doc:list', { where: dirS, rescan: true })
// 如果当前默认图 architecture.mmd 被自动生成，清除它以完全符合 S1「假 fs 里只有 a、b、c」
if (files.has(dirS + '/.arch-canvas/architecture.mmd')) files.delete(dirS + '/.arch-canvas/architecture.mmd')
const itemsS1 = (await call('doc:list', { where: dirS, rescan: true })).items.filter((it) => !it.deleted)
eq('items 恰好含 3 个图库里的图', itemsS1.length, 3)
eq('第一个图 key 是 a', itemsS1[0] && itemsS1[0].key, 'a')
eq('第二个图 key 是 sub/b', itemsS1[1] && itemsS1[1].key, 'sub/b')
eq('第三个图 key 是 x/y/c', itemsS1[2] && itemsS1[2].key, 'x/y/c')
ok('zzz 不在该项目的图库列表里', !itemsS1.some((it) => it.key.includes('zzz') || it.name === 'zzz'))

console.log('【S2 散落的 mermaid 文件（files）】')
files.set(dirS + '/docs/flow.mmd', 'flowchart TD\n  f1["流程"]\n')
files.set(dirS + '/docs/other.mermaid', 'flowchart TD\n  o1["其他流程"]\n')
files.set(dirS + '/docs/readme.md', '# Readme\n```mermaid\nflowchart TD\n  m1["文档内代码块"]\n```\n')
files.set(dirS + '/node_modules/x/y.mmd', 'flowchart TD\n  ny["依赖中的图"]\n')

const listS2 = await call('doc:list', { where: dirS, rescan: true })
const relFilesS2 = listS2.files.map((f) => f.rel)
ok('files 里含 docs/flow.mmd', relFilesS2.includes('docs/flow.mmd'), relFilesS2)
ok('files 里含 docs/other.mermaid', relFilesS2.includes('docs/other.mermaid'), relFilesS2)
ok('files 里不含 .md 文件', !relFilesS2.some((p) => p.endsWith('.md')), relFilesS2)
ok('files 里不含 node_modules 里的文件', !relFilesS2.some((p) => p.includes('node_modules')), relFilesS2)
ok('files 里不含 .arch-canvas 里的图库文件', !relFilesS2.some((p) => p.includes('.arch-canvas')), relFilesS2)

console.log('【S3 自动扫描（手动驱动定时回调，不 sleep）】')
ok('注册了至少一个定时器', intervals.length >= 1)
const scanInterval = intervals.find((i) => typeof i.fn === 'function' && typeof i.ms === 'number' && i.ms > 0)
ok('定时回调确实注册且间隔是正数', !!scanInterval && scanInterval.ms > 0, scanInterval ? scanInterval.ms : null)

const revBeforeS3 = (await call('doc:rev')).libraryRev
files.set(dirS + '/.arch-canvas/new.mmd', 'flowchart TD\n  nw["新建图库图"]\n')
files.set(dirS + '/docs/new.mmd', 'flowchart TD\n  nd["新建散落文件"]\n')

scanInterval.fn()
for (let i = 0; i < 200; i++) {
  const checkList = await handlers.get('doc:list')({ where: dirS })
  if (checkList.items.some((it) => it.key === 'new')) break
  await Promise.resolve()
}

const listS3 = await handlers.get('doc:list')({ where: dirS })
ok('doc:list items 能看到新图库图', listS3.items.some((it) => it.key === 'new'), listS3.items.map((it) => it.key))
ok('doc:list files 能看到新散落文件', listS3.files.some((f) => f.rel === 'docs/new.mmd'), listS3.files.map((f) => f.rel))
ok('libraryRev 比之前大', listS3.libraryRev > revBeforeS3, { before: revBeforeS3, after: listS3.libraryRev })

console.log('【S4 手动重扫】')
files.set(dirS + '/docs/manual.mmd', 'flowchart TD\n  man["手动重扫"]\n')
const listS4 = await handlers.get('doc:list')({ where: dirS, rescan: true })
ok('doc:list {rescan:true} 立刻看到新散落文件', listS4.files.some((f) => f.rel === 'docs/manual.mmd'), listS4.files.map((f) => f.rel))

console.log('【S5 doc:openPath】')
const openRel = await call('doc:openPath', { path: 'docs/flow.mmd', where: dirS })
ok('相对路径打开成功', openRel && openRel.ok === true)
eq('相对路径 external 为绝对路径', openRel.external, dirS + '/docs/flow.mmd')
eq('相对路径 file 为同一路径', openRel.file, dirS + '/docs/flow.mmd')
eq('相对路径 diagram 为 flow', openRel.diagram, 'flow')

const openAbs = await call('doc:openPath', { path: dirS + '/docs/other.mermaid', where: dirS })
ok('绝对路径打开成功', openAbs && openAbs.ok === true)
eq('绝对路径 external 为该文件', openAbs.external, dirS + '/docs/other.mermaid')
eq('绝对路径 file 为同一路径', openAbs.file, dirS + '/docs/other.mermaid')
eq('绝对路径 diagram 为 other', openAbs.diagram, 'other')

// 切回 docs/flow.mmd 并做增量编辑
await call('doc:openPath', { path: 'docs/flow.mmd', where: dirS })
const editExt = await tool('arch_edit').execute({
  ops: [{ op: 'add_node', id: 'extNode', label: '外部文件新节点' }],
}, {})
ok('外部文件编辑成功', editExt && editExt.appliedCount === 1)
const docGetExt = await call('doc:get', { where: dirS })
ok('doc:get 模型包含新节点', docGetExt.model.nodes.some((n) => n.id === 'extNode'))
ok('假 fs 里外部文件内容已变', files.get(dirS + '/docs/flow.mmd').includes('extNode'), files.get(dirS + '/docs/flow.mmd'))
eq('图库里的 a.mmd 内容没有被改动', files.get(dirS + '/.arch-canvas/a.mmd'), 'flowchart TD\n  a1["A1"]\n')

const badExt = await call('doc:openPath', { path: 'docs/readme.md', where: dirS })
ok('扩展名非法被拒', badExt && badExt.ok === false)
ok('错误信息指明只支持 .mmd/.mermaid', typeof badExt.error === 'string' && (badExt.error.includes('.mmd') || badExt.error.includes('.mermaid')), badExt.error)

const notExist = await call('doc:openPath', { path: 'docs/nope.mmd', where: dirS })
ok('文件不存在且不带 create 被拒', notExist && notExist.ok === false)
const createExt = await call('doc:openPath', { path: 'docs/nope.mmd', where: dirS, create: true })
ok('带 create:true 打开不存在文件成功', createExt && createExt.ok === true)
ok('假 fs 里出现新文件', files.has(dirS + '/docs/nope.mmd'))

console.log('【S6 外部文件不被图库加载冲掉】')
// 确保当前打开的是外部文件
await call('doc:openPath', { path: 'docs/flow.mmd', where: dirS })
const curExtNodeCount = (await call('doc:get', { where: dirS })).nodeCount

// 连续两次 doc:get {where: dirS}（模拟界面轮询）
const poll1 = await call('doc:get', { where: dirS })
const poll2 = await call('doc:get', { where: dirS })
eq('轮询 1 仍是外部文件', poll1.external, dirS + '/docs/flow.mmd')
eq('轮询 1 节点数不变', poll1.nodeCount, curExtNodeCount)
eq('轮询 2 仍是外部文件', poll2.external, dirS + '/docs/flow.mmd')
eq('轮询 2 节点数不变', poll2.nodeCount, curExtNodeCount)

// 打开图库里的图 a
const openA = await call('doc:open', { key: 'a', where: dirS })
ok('打开图库图 a 成功', openA && openA.ok === true)
eq('打开图库图后 external 为 null', openA.external, null)
eq('diagram 变成 a', openA.diagram, 'a')

// 换个项目根
const dirOther = '/tmp/proj-other'
files.set(dirOther + '/.arch-canvas/architecture.mmd', 'flowchart TD\n  otherMain["其他项目主图"]\n')
// 先打开外部文件
await call('doc:openPath', { path: 'docs/flow.mmd', where: dirS })
ok('准备切换项目前确认是外部文件', (await call('doc:get', { where: dirS })).external === dirS + '/docs/flow.mmd')

const getOther = await call('doc:get', { where: dirOther })
eq('换项目根后 external 被清空', getOther.external, null)
eq('换项目根后切到默认图 architecture', getOther.diagram, 'architecture')
ok('内容是该项目的默认图', getOther.mermaid.includes('其他项目主图'), getOther.mermaid)

console.log('【元素留言旁路表存储 notes.json】')
const dirNote = '/tmp/proj-note'
files.set(dirNote + '/.arch-canvas/architecture.mmd', 'flowchart TD\n  n1["入口"] --> n2["核心"]\n')
const docN0 = await call('doc:get', { where: dirNote })
ok('进入测试图库成功', docN0 && docN0.ok === true)
eq('初始 noteCount = 0', docN0.noteCount, 0)
eq('初始 resolvedNoteCount = 0', docN0.resolvedNoteCount, 0)

// 1. 写一条留言
const mNote1 = JSON.parse(JSON.stringify(docN0.model))
const node1_1 = mNote1.nodes.find((n) => n.id === 'n1')
node1_1.note = '请确认重试逻辑 "retry" & 校验'
node1_1.noteDone = false
const setNote1 = await call('doc:set', { model: mNote1, where: dirNote })
ok('写留言后 doc:set 成功', setNote1 && setNote1.ok !== false)
const fileContent1 = files.get(dirNote + '/.arch-canvas/architecture.mmd')
ok('.mmd 落盘文件里没有 %% @note n1', fileContent1.indexOf('@note') < 0, fileContent1)
const notesJson1Raw = files.get(dirNote + '/.arch-canvas/notes.json')
ok('同目录生成了 notes.json', !!notesJson1Raw, notesJson1Raw)
const notesJson1 = JSON.parse(notesJson1Raw || '{}')
const n1Stored1 = notesJson1['architecture.mmd'] && notesJson1['architecture.mmd']['n1']
ok('notes.json 里存有 n1 留言', !!n1Stored1 && n1Stored1.text === '请确认重试逻辑 "retry" & 校验' && n1Stored1.done === false, n1Stored1)

const getNote1 = await call('doc:get', { where: dirNote })
eq('写留言后 noteCount = 1', getNote1.noteCount, 1)
eq('写留言后 resolvedNoteCount = 0', getNote1.resolvedNoteCount, 0)
const gn1_1 = getNote1.model.nodes.find((n) => n.id === 'n1')
eq('model 里 note 正确且反转义还原', gn1_1 && gn1_1.note, '请确认重试逻辑 "retry" & 校验')
eq('model 里 noteDone 为 false', gn1_1 && gn1_1.noteDone, false)

// 2. 标记已完成（改成 noteDone:true 再 doc:set）
const mNote2 = JSON.parse(JSON.stringify(getNote1.model))
mNote2.nodes.find((n) => n.id === 'n1').noteDone = true
const setNote2 = await call('doc:set', { model: mNote2, where: dirNote })
ok('标记已完成后 doc:set 成功', setNote2 && setNote2.ok !== false)
const fileContent2 = files.get(dirNote + '/.arch-canvas/architecture.mmd')
ok('.mmd 文件里依然不写 @done', fileContent2.indexOf('@done') < 0 && fileContent2.indexOf('@note') < 0, fileContent2)
const notesJson2 = JSON.parse(files.get(dirNote + '/.arch-canvas/notes.json') || '{}')
const n1Stored2 = notesJson2['architecture.mmd'] && notesJson2['architecture.mmd']['n1']
ok('notes.json 里 n1.done 变为 true', !!n1Stored2 && n1Stored2.done === true, n1Stored2)

const getNote2 = await call('doc:get', { where: dirNote })
eq('标记已解决后 noteCount 变 0', getNote2.noteCount, 0)
eq('标记已解决后 resolvedNoteCount 变 1', getNote2.resolvedNoteCount, 1)
const gn1_2 = getNote2.model.nodes.find((n) => n.id === 'n1')
eq('model 里 noteDone 为 true', gn1_2 && gn1_2.noteDone, true)

// 3. 清空 note（''）
const mNote3 = JSON.parse(JSON.stringify(getNote2.model))
const node1_3 = mNote3.nodes.find((n) => n.id === 'n1')
node1_3.note = ''
node1_3.noteDone = false
const setNote3 = await call('doc:set', { model: mNote3, where: dirNote })
ok('清空留言后 doc:set 成功', setNote3 && setNote3.ok !== false)
const notesJson3 = JSON.parse(files.get(dirNote + '/.arch-canvas/notes.json') || '{}')
ok('notes.json 里 n1 条目被删除', !(notesJson3['architecture.mmd'] && notesJson3['architecture.mmd']['n1']), notesJson3)

const getNote3 = await call('doc:get', { where: dirNote })
eq('清空后 noteCount 为 0', getNote3.noteCount, 0)
eq('清空后 resolvedNoteCount 为 0', getNote3.resolvedNoteCount, 0)
const gn1_3 = getNote3.model.nodes.find((n) => n.id === 'n1')
eq('model 里 note 为空串', gn1_3 && gn1_3.note, '')
eq('model 里 noteDone 为 false', gn1_3 && gn1_3.noteDone, false)

// 4. 提示词注入
const mPrompt = JSON.parse(JSON.stringify(getNote3.model))
const pn1 = mPrompt.nodes.find((n) => n.id === 'n1')
pn1.note = '未解决：检查鉴权'
pn1.noteDone = false
const pn2 = mPrompt.nodes.find((n) => n.id === 'n2')
pn2.note = '已解决：已经测试通过'
pn2.noteDone = true
await call('doc:set', { model: mPrompt, where: dirNote })

const promptFn = prompts[0] && prompts[0].text
ok('测试桩捕获到了 systemPrompt.context 注册的 text 函数', typeof promptFn === 'function')
if (typeof promptFn === 'function') {
  const pText = promptFn()
  ok('未解决的出现在 text 列表里', pText.indexOf('- `n1`（' + (pn1.label || '') + '）：未解决：检查鉴权') >= 0, pText)
  ok('提示词含「另有 1 条留言已经投递过」', pText.indexOf('另有 1 条留言已经投递过') >= 0, pText)
  // 僵尸驻守的修法：责任从「提醒用户去点」翻成「AI 干完自己标」
  ok('提示词说明了「读一次即送达」（一次性消耗）', pText.indexOf('读一次即送达') >= 0, pText)
  ok('提示词要求本轮一次处理完', pText.indexOf('本轮一次处理完') >= 0, pText)
  ok('提示词报出历史条数上限', pText.indexOf('历史只留最近 6 条') >= 0, pText)
  ok('负向对照：旧的「自己标掉 / 没做的不许标」已经不在了',
    pText.indexOf('处理完就自己标掉') < 0 && pText.indexOf('没做的不许标') < 0, pText)
  // **这条断言就是「僵尸没了」本身**：同一批留言再问一次提示词，它必须不再出现。
  ok('送达之后同一条不再出现在提示词里（一次性消耗）',
    promptFn().indexOf('未解决：检查鉴权') < 0, promptFn().slice(0, 400))
  ok('源文本里不含 %% @done', pText.indexOf('%% @done n2') < 0, pText)
  ok('源文本里也不含 %% @note', pText.indexOf('%% @note n1') < 0, pText)
}

// 5. arch_write 继承 vs doc:applyText 手改纯源码（表内留言依然由 applyNoteStore 投影）
const writeRes = await tool('arch_write').execute({
  mermaid: 'flowchart TD\n  n1["入口重画"] --> n3["新下游"]\n',
}, {})
ok('arch_write 成功', writeRes && writeRes.ok !== false)
ok('arch_write 返回 keptNotes >= 1', writeRes && writeRes.keptNotes >= 1, writeRes && writeRes.keptNotes)

const getAfterWrite = await call('doc:get', { where: dirNote })
const n1AfterWrite = getAfterWrite.model.nodes.find((n) => n.id === 'n1')
eq('arch_write 后同 id 节点 n1 继承了留言文本', n1AfterWrite && n1AfterWrite.note, '未解决：检查鉴权')
eq('arch_write 后 n1 继承了 noteDone 状态', n1AfterWrite && n1AfterWrite.noteDone, false)
const notesAfterWrite = JSON.parse(files.get(dirNote + '/.arch-canvas/notes.json') || '{}')
ok('notes.json 里 n1 留言还在', notesAfterWrite['architecture.mmd'] && notesAfterWrite['architecture.mmd']['n1'])

const applyRes = await call('doc:applyText', {
  text: 'flowchart TD\n  n1["入口手改"] --> n3["新下游"]\n',
  where: dirNote,
})
ok('doc:applyText 成功', applyRes && applyRes.ok !== false)

const getAfterApply = await call('doc:get', { where: dirNote })
const n1AfterApply = getAfterApply.model.nodes.find((n) => n.id === 'n1')
eq('doc:applyText 后同 id 节点通过 applyNoteStore 保留留言', n1AfterApply && n1AfterApply.note, '未解决：检查鉴权')
eq('doc:applyText 后 noteDone 为 false', n1AfterApply && n1AfterApply.noteDone, false)
const notesAfterApply = JSON.parse(files.get(dirNote + '/.arch-canvas/notes.json') || '{}')
ok('notes.json 里 n1 留言依然存在', !!(notesAfterApply['architecture.mmd'] && notesAfterApply['architecture.mmd']['n1']), notesAfterApply)
eq('doc:applyText 后 noteCount 依然为 1', getAfterApply.noteCount, 1)
eq('doc:applyText 后 resolvedNoteCount 为 0', getAfterApply.resolvedNoteCount, 0)

// 6. 删节点：remove_node 掉带留言的节点（孤儿留在表里）
const mDel = JSON.parse(JSON.stringify(getAfterApply.model))
const n3Node = mDel.nodes.find((n) => n.id === 'n3')
n3Node.note = 'n3 待处理'
n3Node.noteDone = false
await call('doc:set', { model: mDel, where: dirNote })
const notesBeforeDel = JSON.parse(files.get(dirNote + '/.arch-canvas/notes.json') || '{}')
ok('删节点前表里存在 n3 留言', !!(notesBeforeDel['architecture.mmd'] && notesBeforeDel['architecture.mmd']['n3']))

const delRes = await tool('arch_edit').execute({
  ops: [
    { op: 'remove_node', id: 'n3' },
  ],
}, {})
ok('remove_node 成功执行', delRes && delRes.appliedCount === 1)
eq('remove_node 无 problems', delRes && delRes.problems.length, 0)

const notesAfterDel = JSON.parse(files.get(dirNote + '/.arch-canvas/notes.json') || '{}')
// 孤儿规则反转：删节点不碰孤儿，n3 仍可留在表里
ok('删节点后孤儿留言仍可保留在 notes.json 中', !!(notesAfterDel['architecture.mmd'] && notesAfterDel['architecture.mmd']['n3']), notesAfterDel)

const getAfterDel = await call('doc:get', { where: dirNote })
ok('模型中已无节点 n3', !getAfterDel.model.nodes.some((n) => n.id === 'n3'))
eq('删节点后当前图 noteCount 为 1（仅剩 n1，n3 已成孤儿）', getAfterDel.noteCount, 1)

// 8. AI 自己标记已办（mark_note）—— 从前没有这个 op，AI 只能干看着
//    这一段自包含：新加一个节点、给它写条留言，不依赖上面留下的状态。
console.log('【AI 标记留言已办 mark_note】')
const mnAdd = await tool('arch_edit').execute({ ops: [{ op: 'add_node', id: 'mn1', label: '待标记' }] }, {})
ok('备好一个节点', mnAdd && mnAdd.problems && mnAdd.problems.length === 0, mnAdd && mnAdd.problems)
const mnGet = await call('doc:get', { where: dirNote })
const mnModel = JSON.parse(JSON.stringify(mnGet.model))
mnModel.nodes.find((n) => n.id === 'mn1').note = '这条留言交给 AI 自己标已办'
mnModel.nodes.find((n) => n.id === 'mn1').noteDone = false
await call('doc:set', { model: mnModel, where: dirNote })

const mnDone = await tool('arch_edit').execute({ ops: [{ op: 'mark_note', id: 'mn1', done: true }] }, {})
ok('mark_note 标已办没有 problems', mnDone && mnDone.problems && mnDone.problems.length === 0, mnDone && mnDone.problems)
const mnAfter = await call('doc:get', { where: dirNote })
const mnNode = mnAfter.model.nodes.find((n) => n.id === 'mn1')
eq('mark_note 之后 noteDone = true', mnNode && mnNode.noteDone, true)
ok('mark_note 之后已办计数 ≥ 1', mnAfter.resolvedNoteCount >= 1, mnAfter.resolvedNoteCount)
// **这条断言就是「僵尸没了」本身**：标掉之后，那一条不再出现在注入的清单里。
// 空断言风险：如果 promptText 压根不注入留言，下面两条会一起「通过」——
// 所以先要求它出现过（上一段【4. 提示词注入】已经保证了这一点），再要求它消失。
if (prompts[0] && typeof prompts[0].text === 'function') {
  ok('标掉之后这一条不再进提示词（僵尸没了）',
    prompts[0].text().indexOf('这条留言交给 AI 自己标已办') < 0, prompts[0].text())
}

// 负向对照一：重新打开（done:false）
const mnReopen = await tool('arch_edit').execute({ ops: [{ op: 'mark_note', id: 'mn1', done: false }] }, {})
ok('mark_note done:false 能重新打开', mnReopen && mnReopen.problems && mnReopen.problems.length === 0, mnReopen && mnReopen.problems)
const mnRe = await call('doc:get', { where: dirNote })
eq('重新打开后 noteDone = false', mnRe.model.nodes.find((n) => n.id === 'mn1').noteDone, false)
// 配对的另一半：重新打开之后它必须**回到**注入里 —— 否则上面那条「消失」可能只是注入坏了
if (prompts[0] && typeof prompts[0].text === 'function') {
  ok('重新打开后又回到提示词里（配对的负向对照）',
    prompts[0].text().indexOf('这条留言交给 AI 自己标已办') >= 0, prompts[0].text())
}

// 负向对照二：没有留言的节点不许标记（别产生「有状态没正文」的半截形态）
// 基准要在**紧邻这次调用之前**取：上面的 prompts[0].text() 会把重新打开的那条又送达一次，
// 已办计数本来就会 +1 —— 那是送达，不是这两次被拒的调用干的。
const mnBeforeReject = (await call('doc:get', { where: dirNote })).resolvedNoteCount
const mnEmpty = await tool('arch_edit').execute({ ops: [{ op: 'add_node', id: 'mn2', label: '无留言' }, { op: 'mark_note', id: 'mn2' }] }, {})
ok('对没有留言的节点 mark_note 被拒', mnEmpty.problems && mnEmpty.problems.some((p) => p.indexOf('没有留言') >= 0), mnEmpty.problems)
// 负向对照三：节点不存在
const mnGhost = await tool('arch_edit').execute({ ops: [{ op: 'mark_note', id: '查无此节点' }] }, {})
ok('对不存在的节点 mark_note 被拒', mnGhost.problems && mnGhost.problems.some((p) => p.indexOf('找不到节点') >= 0), mnGhost.problems)
const mnAfter2 = await call('doc:get', { where: dirNote })
eq('被拒的两次都没有改动已办计数', mnAfter2.resolvedNoteCount, mnBeforeReject)

console.log('【留言历史封顶 6 条】')
{
  // 用户要的是「历史最多存 6 条」。封顶发生在落盘那一刻（harvestNoteStore），
  // 排序按 `at`＝**进入历史的时刻**；那个时刻是落盘时盖的，所以这里必须分两批存，
  // 让两批的 at 真的不同（同一批内的 at 相等，谁被丢是任意的）。
  const capNotes = dirNote + '/.arch-canvas/notes.json'
  const capModel = JSON.parse(JSON.stringify((await call('doc:get', { where: dirNote })).model))
  for (let i = 0; i < 9; i++) {
    capModel.nodes.push({ id: 'cap' + i, label: 'C' + i, shape: 'rect', group: null, x: i * 10, y: 0, note: '历史' + i, noteDone: false })
  }
  await call('doc:set', { model: capModel, where: dirNote })
  // 第一批 3 条标已办（存一次 → 它们拿到较早的 at）
  let capNow = JSON.parse(JSON.stringify((await call('doc:get', { where: dirNote })).model))
  for (let i = 0; i < 3; i++) capNow.nodes.find((n) => n.id === 'cap' + i).noteDone = true
  await call('doc:set', { model: capNow, where: dirNote })
  await new Promise((r) => setTimeout(r, 3))
  // 第二批 6 条标已办（再存一次 → at 更大）
  capNow = JSON.parse(JSON.stringify((await call('doc:get', { where: dirNote })).model))
  for (let i = 3; i < 9; i++) capNow.nodes.find((n) => n.id === 'cap' + i).noteDone = true
  await call('doc:set', { model: capNow, where: dirNote })

  const capStore = (JSON.parse(files.get(capNotes) || '{}'))['architecture.mmd'] || {}
  const capDone = Object.keys(capStore).filter((k) => capStore[k] && capStore[k].done === true)
  eq('历史最多留 6 条', capDone.length, 6)
  ok('留下的是最新的那 6 条（第二批全在）',
    [3, 4, 5, 6, 7, 8].every((i) => capDone.indexOf('cap' + i) >= 0), capDone)
  ok('更早的那批被丢掉（负向对照：不然「封顶」等于没做）',
    capDone.filter((k) => ['cap0', 'cap1', 'cap2'].indexOf(k) >= 0).length === 0, capDone)
  // 内存里也要跟着裁 —— 否则界面还列着一条盘上已经不存在的历史，刷新后它自己消失。
  // 实测踩到过：盘上 6 条、内存 8 条。
  const capDoc = await call('doc:get', { where: dirNote })
  eq('内存里的历史条数与盘上一致（都是 6）', capDoc.resolvedNoteCount, capDone.length)
}
eq('删节点后 resolvedNoteCount 为 0', getAfterDel.resolvedNoteCount, 0)
// 把 warnings 的内容带出来：这条断言从前只说"多了几条"，多出来的是什么看不到
ok('删节点后 warnings 为空（不报错）', getAfterDel.warnings.length === 0, getAfterDel.warnings)

// 6. notes.json 写入两道闸保险与加载日志测试
console.log('【notes.json 写入保险与 load 日志】')
const dirSafe = '/tmp/proj-safe'
const mmdSafe = dirSafe + '/.arch-canvas/architecture.mmd'
const notesSafe = dirSafe + '/.arch-canvas/notes.json'
files.set(mmdSafe, 'flowchart TD\n  s1["安全测试节点"]\n')

// (a) 正常写入：不存在时能正常写入
const docSafe0 = await call('doc:get', { where: dirSafe })
ok('安全测试库加载成功', docSafe0 && docSafe0.ok === true)
const mSafe1 = JSON.parse(JSON.stringify(docSafe0.model))
mSafe1.nodes[0].note = '正常留言'
const setSafe1 = await call('doc:set', { model: mSafe1, where: dirSafe })
ok('正常情况仍然能写', setSafe1 && setSafe1.ok !== false)
ok('notes.json 已成功创建并写入', files.has(notesSafe) && files.get(notesSafe).indexOf('正常留言') >= 0)

// (b) 闸门 2：现有 notes.json 不是合法 JSON 时拒绝写、内容原样保留
const foreignContent = 'flowchart TD\n  foreign["这是被误写进来的流程图内容而非JSON"]\n'
files.set(notesSafe, foreignContent)
// 清除内存缓存，触发从磁盘加载非 JSON 内容
const docSafeForeign = await call('doc:get', { where: dirSafe + '-foreign' }) // 切换触发缓存清理或直接测 loadNoteStoreFor
// 直接测试带非法内容的图库
const dirCorrupt = '/tmp/proj-corrupt'
files.set(dirCorrupt + '/.arch-canvas/architecture.mmd', 'flowchart TD\n  c1["损坏测试"]\n')
files.set(dirCorrupt + '/.arch-canvas/notes.json', foreignContent)

const docCorrupt = await call('doc:get', { where: dirCorrupt })
ok('读取含有非法 JSON 的 notes.json 不崩溃', docCorrupt && docCorrupt.ok === true)
// 验证 loadNoteStoreFor 记了日志且带有 head 字段
await new Promise((r) => setTimeout(r, 10))
const logsAfterLoad = (logStorage.get(todayLogKey) || '').trim().split('\n').map((l) => {
  try { return JSON.parse(l) } catch (e) { return null }
}).filter(Boolean)
const corruptLoadLog = logsAfterLoad.reverse().find((row) => row.ev === 'notes.load.fail' && row.path?.includes('proj-corrupt'))
ok('loadNoteStoreFor 失败日志带有 head 字段', !!corruptLoadLog && typeof corruptLoadLog.head === 'string' && corruptLoadLog.head.startsWith('flowchart TD'), corruptLoadLog)

// 尝试在损坏的 notes.json 存在时保存新留言
const mCorrupt = JSON.parse(JSON.stringify(docCorrupt.model))
mCorrupt.nodes[0].note = '尝试覆盖'
const setCorrupt = await call('doc:set', { model: mCorrupt, where: dirCorrupt })
ok('现有 notes.json 不是合法 JSON 时拒绝写并记录警告', setCorrupt && setCorrupt.warnings.some((w) => w.includes('已拒绝覆盖')), setCorrupt.warnings)
eq('现有 notes.json 不是合法 JSON 时内容原样保留', files.get(dirCorrupt + '/.arch-canvas/notes.json'), foreignContent)

// 验证记了 notes.save.refused 日志，且 reason 为 foreign-content
const logsAfterSaveRefused = (logStorage.get(todayLogKey) || '').trim().split('\n').map((l) => {
  try { return JSON.parse(l) } catch (e) { return null }
}).filter(Boolean)
const foreignSaveRefusedLog = logsAfterSaveRefused.reverse().find((row) => row.ev === 'notes.save.refused' && row.path?.includes('proj-corrupt'))
ok('记了 foreign-content 拒绝写入日志', !!foreignSaveRefusedLog && foreignSaveRefusedLog.reason === 'foreign-content', foreignSaveRefusedLog)

// (c) 闸门 1：目标是别的路径时拒绝写、不产生写入
const dirMismatch = '/tmp/proj-mismatch'
files.set(dirMismatch + '/.arch-canvas/architecture.mmd', 'flowchart TD\n  m1["路径不匹配测试"]\n')
// 临时 hook fsSvc.resolve，让 notes.json 解析到别的 targetKey
const origResolve = fsSvc.resolve
fsSvc.resolve = async (p) => {
  if (p === dirMismatch + '/.arch-canvas/notes.json') {
    return { targetKey: '/tmp/hijacked/other.json', displayPath: '/tmp/hijacked/other.json' }
  }
  return origResolve(p)
}
const docMismatch = await call('doc:get', { where: dirMismatch })
const mMismatch = JSON.parse(JSON.stringify(docMismatch.model))
mMismatch.nodes[0].note = '尝试写入劫持路径'
const setMismatch = await call('doc:set', { model: mMismatch, where: dirMismatch })
fsSvc.resolve = origResolve // 恢复

ok('目标是别的路径时拒绝写并记录警告', setMismatch && setMismatch.warnings.some((w) => w.includes('目标路径不一致')), setMismatch.warnings)
ok('目标是别的路径时不产生写入', !files.has('/tmp/hijacked/other.json'))

const logsAfterMismatch = (logStorage.get(todayLogKey) || '').trim().split('\n').map((l) => {
  try { return JSON.parse(l) } catch (e) { return null }
}).filter(Boolean)
const mismatchLog = logsAfterMismatch.reverse().find((row) => row.ev === 'notes.save.refused' && row.reason === 'path-mismatch')
ok('记了 path-mismatch 拒绝写入日志', !!mismatchLog && mismatchLog.reason === 'path-mismatch' && mismatchLog.actual === '/tmp/hijacked/other.json', mismatchLog)

// ---------- [16] 代码锚点 %% @file ----------
console.log('【代码锚点 %% @file】')
const dirRef = '/tmp/proj-ref'
const refFile = dirRef + '/.arch-canvas/architecture.mmd'
files.set(refFile, 'flowchart TD\n  r1["解析器 / 序列化"] --> r2["面板"]\n')
// 锚点校验要真去 stat / read：桩 fs 里放一个真文件 + 一个真符号
files.set(dirRef + '/src/host/mermaid.ts', 'function parseMermaid(text) { return text }\n')
const docR0 = await call('doc:get', { where: dirRef })
ok('进入锚点测试图库成功', docR0 && docR0.ok === true)
eq('没有锚点时 fileStatus 是空对象', Object.keys(docR0.fileStatus || {}).length, 0, docR0.fileStatus)

// 1. 写三条锚点：一条好、一条符号不在、一条文件不在
const refsWant = ['src/host/mermaid.ts#parseMermaid', 'src/host/mermaid.ts#这个符号不存在', 'src/host/不存在.ts']
const mRef = JSON.parse(JSON.stringify(docR0.model))
mRef.nodes.find((n) => n.id === 'r1').files = refsWant.slice()
const setRef = await call('doc:set', { model: mRef, where: dirRef })
ok('写锚点后 doc:set 成功', setRef && setRef.ok !== false)
const refContent = files.get(refFile)
ok('落盘文件里出现三条 %% @file r1',
  refContent.split('\n').filter((l) => l.indexOf('%% @file r1 ') === 0).length === 3, refContent)
// `%% @file` 的值在一行注释里，Mermaid 根本不看 —— 所以它**不套**标签那套实体转义：
// 从前这里写的是 `#35;parseMermaid`，只在源码页里坑人（人看到的就该是 `#parseMermaid`）。
// 读回那条路没变（unquote 仍然认 #35;），所以老文件解析照旧，只是下一次落盘会被规整。
ok('锚点按原样写出路径里的 #（不再写成 #35;）',
  refContent.indexOf('%% @file r1 "src/host/mermaid.ts#parseMermaid"') >= 0, refContent)
ok('负向对照：文件里确实没有 #35; 这种实体写法',
  refContent.indexOf('#35;') < 0, refContent)

const getRef = await call('doc:get', { where: dirRef })
const refStatus = getRef.fileStatus.r1 || {}
eq('符号在文件里 → ok', refStatus['src/host/mermaid.ts#parseMermaid'], 'ok')
eq('符号不在 → symbol-missing', refStatus['src/host/mermaid.ts#这个符号不存在'], 'symbol-missing')
eq('文件不在 → missing', refStatus['src/host/不存在.ts'], 'missing')
ok('fileStatus 在 doc:get 这条主路径上就有（不是只在 arch_read 里）',
  Object.keys(getRef.fileStatus || {}).length === 1, getRef.fileStatus)
eq('model 里的锚点原样回来（含 #符号）',
  JSON.stringify(getRef.model.nodes.find((n) => n.id === 'r1').files), JSON.stringify(refsWant))

// 2. 锚点进提示词：好的可用、坏的带 ⚠ 且明说别照着用
const pRef = promptFn()
ok('提示词里有代码锚点清单', pRef.indexOf('图元素上标的代码锚点') >= 0)
ok('提示词点名节点与路径', pRef.indexOf('`r1`') >= 0 && pRef.indexOf('`src/host/mermaid.ts#parseMermaid`') >= 0)
ok('失效锚点带 ⚠ 与原因', pRef.indexOf('⚠') >= 0 && pRef.indexOf('文件不在') >= 0 && pRef.indexOf('符号不在') >= 0)
ok('明说了失效的不要照着用', pRef.indexOf('不要照着用') >= 0)

// 3. set_files：整组替换 / 空数组清掉
const sfRes = await tool('arch_edit').execute({
  ops: [{ op: 'set_files', id: 'r1', files: ['src/host/mermaid.ts'] }],
}, {})
eq('set_files 应用成功', sfRes && sfRes.appliedCount, 1)
const getSf = await call('doc:get', { where: dirRef })
eq('set_files 是整组替换（剩一条）', getSf.model.nodes.find((n) => n.id === 'r1').files.length, 1)
eq('替换后那条校验为 ok', (getSf.fileStatus.r1 || {})['src/host/mermaid.ts'], 'ok')
const clrRes = await tool('arch_edit').execute({ ops: [{ op: 'set_files', id: 'r1', files: [] }] }, {})
eq('空数组清锚点不留 problem', clrRes && clrRes.problems.length, 0)
const getClr = await call('doc:get', { where: dirRef })
eq('清掉后 model 里是空数组', getClr.model.nodes.find((n) => n.id === 'r1').files.length, 0)
ok('清掉后文件里没有 %% @file 行', files.get(refFile).indexOf('%% @file ') < 0, files.get(refFile).split('\n').slice(0, 10))

// 4. AI 重画继承锚点；用户手改源码不继承（与元素注释同一条边界）
const mRef2 = JSON.parse(JSON.stringify(getClr.model))
mRef2.nodes.find((n) => n.id === 'r1').files = ['src/host/mermaid.ts#parseMermaid']
await call('doc:set', { model: mRef2, where: dirRef })
const wRef = await tool('arch_write').execute({
  mermaid: 'flowchart TD\n  r1["解析器重画"] --> r3["新下游"]\n',
}, {})
ok('arch_write 成功', wRef && wRef.ok !== false)
const getWRef = await call('doc:get', { where: dirRef })
eq('arch_write 后同 id 节点继承了锚点',
  JSON.stringify(getWRef.model.nodes.find((n) => n.id === 'r1').files), JSON.stringify(['src/host/mermaid.ts#parseMermaid']))
ok('继承的锚点也写回了文件（# 原样）', files.get(refFile).indexOf('%% @file r1 "src/host/mermaid.ts#parseMermaid"') >= 0)

const aRef = await call('doc:applyText', { text: 'flowchart TD\n  r1["手改"] --> r3["新下游"]\n', where: dirRef })
ok('doc:applyText 成功', aRef && aRef.ok !== false)
eq('doc:applyText 不继承锚点（删了那行就是真的删）',
  (await call('doc:get', { where: dirRef })).model.nodes.find((n) => n.id === 'r1').files.length, 0)
ok('文件里也没有锚点了', files.get(refFile).indexOf('%% @file ') < 0)

// 5. 幽灵锚点：节点不在了就丢弃 + 记 warning + 绝不凭注释复活节点
const ghostRef = await call('doc:applyText', {
  text: 'flowchart TD\n  r1["只剩它"]\n%% @file ghostNode "src/x.ts"\n',
  where: dirRef,
})
ok('幽灵锚点不会复活节点', (ghostRef.mermaid || '').indexOf('ghostNode') < 0, ghostRef.mermaid)
ok('幽灵锚点记了一条 warning',
  (ghostRef.warnings || []).some((w) => w.indexOf('代码锚点 @file') >= 0 && w.indexOf('已丢弃') >= 0), ghostRef.warnings)

// 6. 判不了根时不许假装没问题：全局图库没有项目根 → unknown
await call('doc:get', { where: '' })
const gEdit = await tool('arch_edit').execute({
  ops: [
    { op: 'add_node', id: 'gAnchor', label: '全局图里的节点' },
    { op: 'set_files', id: 'gAnchor', files: ['src/x.ts'] },
  ],
}, {})
ok('全局图库里也能标锚点', gEdit && gEdit.ok !== false, gEdit && gEdit.error)
const gGet = await call('doc:get', { where: '' })
eq('没有项目根可参照时状态是 unknown（不假装 ok）', (gGet.fileStatus.gAnchor || {})['src/x.ts'], 'unknown')

// ---------- [17b] 锚点保鲜 drift ----------
console.log('【锚点保鲜 drift：文件在图之后改过 / 有源码却没画到】')
{
  const dirDr = '/tmp/proj-drift'
  const drFile = dirDr + '/.arch-canvas/architecture.mmd'
  const drStore = dirDr + '/.arch-canvas/anchors.json'
  const srcHost = dirDr + '/src/host/mermaid.ts'
  // 锚点**一开始就在文件里**：这样「有锚点、还没有基线」这个场景才真的被走了一遍。
  // （第一版是加载之后才用 doc:set 加锚点，于是「没有基线就不猜」那条断言是空转的 ——
  //  负向对照把它照出来了：把守卫拆掉，那两条照样绿。）
  files.set(drFile, 'flowchart TD\n  d1["编解码器"] --> d2["面板"]\n%% @file d1 "src/host/mermaid.ts#parseMermaid"\n')
  files.set(srcHost, 'function parseMermaid(t) { return t }\n')
  files.set(dirDr + '/src/client/studio.ts', 'function draw() {}\n')   // 有源码、没锚点
  files.set(dirDr + '/tools/build.mjs', 'export const PARTS = []\n')   // 同上（构建脚本也是源码）
  files.set(dirDr + '/test/x.test.ts', 'it("x", () => {})\n')          // 测试：图本来就不画它
  files.set(dirDr + '/node_modules/left-pad/index.js', 'module.exports = 1\n')
  // 两条**拿本仓库自己试出来的**假阳性：与 src 同级的 lib/ 是编译产物；.d.ts 只是声明。
  files.set(dirDr + '/lib/bundle.js', 'module.exports = {}\n')
  files.set(dirDr + '/types/env.d.ts', 'declare const x: number\n')

  // 1. 还没有基线：**不许把「未知」说成「过期」**
  const dr0 = await call('doc:get', { where: dirDr })
  ok('进入 drift 测试图库', dr0 && dr0.ok === true, dr0 && dr0.error)
  eq('锚点确实已经在了（否则下面那条是空断言）', Object.keys(dr0.fileStatus.d1 || {}).length, 1, dr0.fileStatus)
  ok('没有基线时如实说 baseline=false', !!(dr0.drift && dr0.drift.baseline === false), dr0.drift)
  eq('没有基线就不报 stale（宁可不猜，也不许吓人）', (dr0.drift && dr0.drift.stale.length) || 0, 0)
  ok('读路径不建旁路表', !files.has(drStore))

  // 2. 落一次盘 → 记下基线（锚点本来就在，不需要改模型）
  const mDr = JSON.parse(JSON.stringify(dr0.model))
  const setDr = await call('doc:set', { model: mDr, where: dirDr })
  ok('写锚点后 doc:set 成功', setDr && setDr.ok !== false)
  ok('落盘顺手记了锚点指纹表 anchors.json', files.has(drStore))
  const storeObj = JSON.parse(files.get(drStore))
  ok('指纹表是合法 JSON 且按图文件名分格', !!storeObj['architecture.mmd'] && !!storeObj['architecture.mmd'].refs)
  ok('指纹表里记的是那条引用的内容指纹',
    typeof storeObj['architecture.mmd'].refs['src/host/mermaid.ts#parseMermaid'] === 'string' &&
    storeObj['architecture.mmd'].refs['src/host/mermaid.ts#parseMermaid'].length > 0)
  eq('刚落完基线 → 一条 stale 都没有', (setDr.drift && setDr.drift.stale.length) || 0, 0)
  ok('落完盘 baseline 为真', !!(setDr.drift && setDr.drift.baseline), setDr.drift)

  // 3. 只读一次、内容没变：不许报 stale（否则这条信号每天都会喊）
  const drSame = await call('doc:get', { where: dirDr })
  eq('内容没变 → 不报 stale', drSame.drift.stale.length, 0, drSame.drift.stale)

  // 4. 代码动了、符号还在：fileStatus 仍是 ok，但 drift 必须报出来
  files.set(srcHost, 'function parseMermaid(t) { return t }\n// 重构过：这已经不是图上说的那个东西了\n')
  const dr1 = await call('doc:get', { where: dirDr })
  eq('文件内容变过 → 报一条 stale', dr1.drift.stale.length, 1, dr1.drift.stale)
  eq('并且指到「哪个节点 · 哪条引用」', dr1.drift.stale[0].node + '|' + dr1.drift.stale[0].ref,
    'd1|src/host/mermaid.ts#parseMermaid')
  eq('负向对照：fileStatus 还是 ok —— 这正是 drift 要多看的那一层',
    (dr1.fileStatus.d1 || {})['src/host/mermaid.ts#parseMermaid'], 'ok')

  // 5. 漏画：有源码却没锚点的目录要报；测试与 node_modules 不许混进来
  const unc = (dr1.drift.uncovered || []).map((x) => x.dir)
  ok('报出没被画到的目录（tools / src/client）', unc.indexOf('tools') >= 0 && unc.indexOf('src/client') >= 0, unc)
  ok('被锚点覆盖的目录不算漏画', unc.indexOf('src/host') < 0, unc)
  ok('测试目录不算漏画（图本来就不画测试）', unc.indexOf('test') < 0, unc)
  ok('node_modules 不算漏画', unc.indexOf('node_modules') < 0, unc)
  ok('与 src 同级的 lib/ 是编译产物，不算漏画', unc.indexOf('lib') < 0, unc)
  ok('目录本身就叫 types 的，也不该因为里面的 .d.ts 被算成漏画', unc.indexOf('types') < 0, unc)
  const toolsRow = (dr1.drift.uncovered || []).find((x) => x.dir === 'tools')
  eq('漏画的目录带上文件数', toolsRow && toolsRow.files, 1)

  // 6. 提示词：过期时说清楚「别照着这些锚点走」，并且逐条标出是哪条
  const tp = prompts[0].text()
  ok('提示词里点出保鲜状态', tp.indexOf('图的保鲜状态') >= 0)
  ok('提示词里逐条标明哪条锚点的文件在图之后改过',
    tp.indexOf('这些锚点的文件改过了') >= 0 && tp.indexOf('src/host/mermaid.ts#parseMermaid') >= 0)
  ok('提示词里给出「别照着走」的处置', tp.indexOf('别照着上面这些锚点走') >= 0,
    tp.slice(tp.indexOf('图的保鲜状态'), tp.indexOf('图的保鲜状态') + 400))
  ok('提示词把「还没画」和「图上错了」分开说（不是一律喊过期）',
    tp.indexOf('这只是「还没画」，**不是**图上写错了') >= 0)

  // 7. 代码再没动过 + 图自己落一次盘 → 过期就该消失（基线是「图上一次动过」那一版）
  const again = await call('doc:set', { model: JSON.parse(JSON.stringify(mDr)), where: dirDr })
  eq('再落一次盘 = 重新确认 → stale 清空', (again.drift && again.drift.stale.length) || 0, 0, again.drift)
  const tp2 = prompts[0].text()
  ok('重新确认之后，「文件改过了」这条从提示词里消失',
    tp2.indexOf('这些锚点的文件改过了') < 0 && tp2.indexOf('别照着上面这些锚点走') < 0)
  // 但**漏画**是属性不是过期：没画就是没画，重新落盘不会让它消失 —— 这条一起钉住，
  // 免得以后有人把「过期」和「没画到」揉成一件事。
  ok('漏画那条仍然留在提示词里（它不是「过期」，是「还缺」）',
    tp2.indexOf('没有任何锚点指向') >= 0 && tp2.indexOf('tools') >= 0,
    tp2.slice(tp2.indexOf('图的保鲜状态'), tp2.indexOf('图的保鲜状态') + 300))

  // 8. 落盘失败不记基线：这张图根本没写进文件，就不能声称「图描述的就是这一版代码」
  files.set(srcHost, 'function parseMermaid(t) { return t }\n// 又改了一次\n')
  files.delete(drStore)
  const wasFailing = failWritePaths.has(drFile)
  failWritePaths.add(drFile)
  const failedSet = await call('doc:set', { model: JSON.parse(JSON.stringify(mDr)), where: dirDr })
  failWritePaths.delete(drFile)
  if (wasFailing) failWritePaths.add(drFile)
  ok('落盘失败如实回报', failedSet && failedSet.saved === false, failedSet && failedSet.saved)
  ok('落盘失败 → 不记基线（没写进文件就别声称描述了这一版）', !files.has(drStore))

  // 9. 旁路表坏了不许崩：**换一个没被缓存过的图库**（旁路表按路径缓存，同一个路径读不到第二遍）
  const dirBad = '/tmp/proj-drift-bad'
  const badFile = dirBad + '/.arch-canvas/architecture.mmd'
  const badStore = dirBad + '/.arch-canvas/anchors.json'
  files.set(badFile, 'flowchart TD\n  b1["甲"]\n')
  files.set(dirBad + '/src/host/mermaid.ts', 'function f() {}\n')
  files.set(badStore, '这不是 JSON')
  const drBad = await call('doc:get', { where: dirBad })
  ok('指纹表坏掉时当作没有基线（不崩、不误报）', !!(drBad.drift && drBad.drift.baseline === false), drBad.drift)
  eq('坏表也不报 stale', (drBad.drift && drBad.drift.stale.length) || 0, 0)
  // 而且**不许盖上别人的东西**：与留言表共用同一套闸门，坏表要拒写（并记一条能指路的日志）。
  const mBad = JSON.parse(JSON.stringify(drBad.model))
  mBad.nodes.find((n) => n.id === 'b1').files = ['src/host/mermaid.ts#f']
  const badSet = await call('doc:set', { model: mBad, where: dirBad })
  ok('坏表之下 doc:set 本身仍然成功（图照旧能存）', badSet && badSet.ok !== false)
  eq('但坏表没有被覆盖（拒绝写别人的东西）', files.get(badStore), '这不是 JSON')
  const refusedLog = (logStorage.get(todayLogKey) || '').trim().split('\n')
    .map((l) => { try { return JSON.parse(l) } catch (e) { return null } })
    .reverse().find((row) => row && row.ev === 'drift.save.refused')
  ok('并且记了一条 drift.save.refused（不静默）', !!refusedLog && refusedLog.reason === 'foreign-content', refusedLog)
}

// ---------- [17] 整张图的一句话总结 %% @summary ----------
console.log('【一句话总结 %% @summary】')
const dirSum = '/tmp/proj-sum'
const sumFile = dirSum + '/.arch-canvas/architecture.mmd'
files.set(sumFile, 'flowchart TD\n  s1["入口"] --> s2["核心"]\n')
const docS0 = await call('doc:get', { where: dirSum })
eq('初始 summary 是空串（不是 undefined）', docS0.summary, '')
eq('model 里也有 summary 字段', docS0.model.summary, '')

// 1. 经 doc:set 写一句 → 落成头部一行
const sumWant = '支付对账的讨论稿 "v2" & 还没定'
const mSum = JSON.parse(JSON.stringify(docS0.model))
mSum.summary = sumWant
const setSum = await call('doc:set', { model: mSum, where: dirSum })
ok('写 summary 后 doc:set 成功', setSum && setSum.ok !== false)
const sumContent = files.get(sumFile)
ok('落盘文件里出现 %% @summary 一行', sumContent.indexOf('%% @summary "支付对账的讨论稿 #quot;v2#quot; &amp; 还没定"') >= 0,
  sumContent.split('\n').slice(0, 8))
ok('summary 行在 @pos 之前（头部就是它的位置）',
  sumContent.indexOf('%% @summary ') < sumContent.indexOf('%% @pos ') || sumContent.indexOf('%% @pos ') < 0, sumContent)
const getSum = await call('doc:get', { where: dirSum })
eq('summary 往返（含转义还原）', getSum.summary, sumWant)
eq('doc:get 的 model.summary 同步', getSum.model.summary, sumWant)

// 2. 旧界面（模型里根本没有 summary 字段）不该把它抹掉
const staleModel = JSON.parse(JSON.stringify(getSum.model))
delete staleModel.summary
const staleSet = await call('doc:set', { model: staleModel, where: dirSum })
ok('旧界面的 doc:set 成功', staleSet && staleSet.ok !== false)
eq('字段整个缺席时保留现状（不当作要清空）', (await call('doc:get', { where: dirSum })).summary, sumWant)
// 显式空串才是清空
const mClearSum = JSON.parse(JSON.stringify(getSum.model))
mClearSum.summary = ''
await call('doc:set', { model: mClearSum, where: dirSum })
eq('显式空串 = 清空', (await call('doc:get', { where: dirSum })).summary, '')
await call('doc:set', { model: JSON.parse(JSON.stringify(getSum.model)), where: dirSum })

// 3. 进提示词：图级那一行 + 别的图的总结（图库清单里）
files.set(dirSum + '/.arch-canvas/other.mmd', '%% @summary 另一张图：对账时序\nflowchart TD\n  o1["对账"]\n')
const listS = await call('doc:list', { where: dirSum })
const itemArch = (listS.items || []).find((it) => it.name === 'architecture')
const itemOther = (listS.items || []).find((it) => it.name === 'other')
eq('doc:list 把每张图的 summary 一起回给界面（选择器要显示它）', itemOther && itemOther.summary, '另一张图：对账时序')
eq('当前这张图的 summary 也在清单里', itemArch && itemArch.summary, sumWant)

const pSum = promptFn()
ok('提示词里有「这张图讲的是」那一行', pSum.indexOf('**这张图讲的是**') >= 0)
ok('提示词里带上了那句话', pSum.indexOf(sumWant) >= 0)
// 提示词不再逐一解释 `@pos` / `@link` / `@summary`（那是 skill 的活），
// 但必须交代「`%%` 行是元数据、不要当图的内容讨论」—— 这是防 AI 拿元数据当内容的关键一句。
// 断言跟着改成检查这句：覆盖所有 `%%` 行，比原来只点名 @summary 更宽。
ok('提示词里交代了 %% 行是元数据、不要讨论', pSum.indexOf('`%%` 开头的行是元数据') >= 0)
ok('同一图库里别的图的总结也顺带告知', pSum.indexOf('「other」：另一张图：对账时序') >= 0,
  pSum.split('\n').filter((l) => l.indexOf('同一图库里还有') >= 0))
ok('注入的源码里保留 %% @summary 行', pSum.indexOf('%% @summary ') >= 0)
ok('注入的源码里滤掉了 %%! 格式说明行', pSum.indexOf('\n%%!') < 0,
  pSum.split('\n').filter((l) => l.slice(0, 3) === '%%!'))

// 4. set_summary 走 arch_edit（label 传文本）
const ssRes = await tool('arch_edit').execute({ ops: [{ op: 'set_summary', label: '用 op 写的一句话' }] }, {})
eq('set_summary 应用成功', ssRes && ssRes.appliedCount, 1)
eq('set_summary 生效', (await call('doc:get', { where: dirSum })).summary, '用 op 写的一句话')
ok('set_summary 落盘', files.get(sumFile).indexOf('%% @summary "用 op 写的一句话"') >= 0)
const ssClear = await tool('arch_edit').execute({ ops: [{ op: 'set_summary', label: '' }] }, {})
eq('set_summary 传空串 = 清掉且不留 problem', ssClear && ssClear.problems.length, 0)
eq('清掉后 summary 为空串', (await call('doc:get', { where: dirSum })).summary, '')

// 5. arch_write：新文本自带就用新的，没带就继承；doc:applyText 一律以新文本为准
await call('doc:set', { model: JSON.parse(JSON.stringify(getSum.model)), where: dirSum })
const wNoSum = await tool('arch_write').execute({
  mermaid: 'flowchart TD\n  s1["入口重画"] --> s3["新下游"]\n',
}, {})
ok('arch_write 成功', wNoSum && wNoSum.ok !== false)
eq('新文本没写 @summary ⇒ 继承旧的那句', wNoSum && wNoSum.summary, sumWant)
ok('继承的那句仍写在文件里', files.get(sumFile).indexOf('%% @summary ') >= 0)

const wWithSum = await tool('arch_write').execute({
  mermaid: '%% @summary 重画之后的一句话\nflowchart TD\n  s1["入口重画"] --> s3["新下游"]\n',
}, {})
eq('新文本自带 @summary ⇒ 以它为准', wWithSum && wWithSum.summary, '重画之后的一句话')
ok('新的那句落了盘', files.get(sumFile).indexOf('%% @summary "重画之后的一句话"') >= 0)

const aSum = await call('doc:applyText', {
  text: 'flowchart TD\n  s1["手改"] --> s3["新下游"]\n%% @pos s1 10 20\n',
  where: dirSum,
})
ok('doc:applyText 成功', aSum && aSum.ok !== false)
eq('用户手改源码时不继承：删掉那行就是真的删掉', aSum && aSum.summary, '')
ok('文件里也没有 @summary 了', files.get(sumFile).indexOf('%% @summary ') < 0)

// 6. 落盘失败要回滚（总结不能「只活在内存里」）
await call('doc:set', { model: (() => { const m = JSON.parse(JSON.stringify(getSum.model)); m.summary = '回滚前的旧句子'; return m })(), where: dirSum })
eq('回滚前 summary 已就位', (await call('doc:get', { where: dirSum })).summary, '回滚前的旧句子')
failWritePaths.add(sumFile)
const failSum = await call('doc:set', {
  model: (() => { const m = JSON.parse(JSON.stringify(getSum.model)); m.summary = '这句不该留下'; return m })(),
  where: dirSum,
})
ok('写盘失败时 doc:set 报 saved:false', failSum && failSum.saved === false, failSum && failSum.saved)
eq('写盘失败后 summary 回滚到旧值', (await call('doc:get', { where: dirSum })).summary, '回滚前的旧句子')
failWritePaths.delete(sumFile)

// ---------- [18] 检查点（快照）：谁改的、能不能退回去 ----------
console.log('【检查点（快照）】')
const dirHist = '/tmp/proj-hist'
const histFile = dirHist + '/.arch-canvas/architecture.mmd'
files.set(histFile, 'flowchart TD\n  h1["入口"] --> h2["核心"]\n')
const docH0 = await call('doc:get', { where: dirHist })
ok('进入检查点测试库成功', docH0 && docH0.ok === true)
eq('打开本身就算一个检查点', docH0.historyCount, 1)
const hist0 = await call('doc:history', { where: dirHist })
eq('doc:history 能列出清单', hist0 && hist0.ok, true)
eq('打开那一刻 by=open', hist0.entries.length === 1 && hist0.entries[0].by, 'open')
ok('只有一份时它标记为当前', hist0.entries[0].current === true)
eq('清单不带正文（省带宽）', hist0.entries[0].text, undefined)

// 1. AI 改一次 → 多一份 by=ai 的检查点，且记下了动了哪些节点
const histAi = await tool('arch_edit').execute({
  ops: [{ op: 'add_node', id: 'hCache', label: '缓存层' }],
}, {})
eq('AI 改图生效', histAi && histAi.appliedCount, 1)
const hist1 = await call('doc:history', { where: dirHist })
eq('AI 改完变成 2 份', hist1.entries.length, 2)
eq('最新那份 by=ai', hist1.entries[0].by, 'ai')
ok('最新那份记下了改动涉及哪些节点', hist1.entries[0].changed.indexOf('hCache') >= 0, hist1.entries[0].changed)
eq('只有最新那份是当前', hist1.entries.filter((e) => e.current).length, 1)
eq('AI 那一条的来源是 arch_edit', hist1.entries[0].site, 'arch_edit')

// 2. 用户改一次 → 再多一份 by=user（两种来源在同一个时间线上分得清）
const mHistUser = JSON.parse(JSON.stringify((await call('doc:get', { where: dirHist })).model))
mHistUser.nodes.find((n) => n.id === 'h2').label = '核心（用户改）'
await call('doc:set', { model: mHistUser, where: dirHist })
const hist2 = await call('doc:history', { where: dirHist })
eq('用户改完变成 3 份', hist2.entries.length, 3)
eq('最新那份 by=user', hist2.entries[0].by, 'user')

// 3. 同样的内容再存一次：不重复记（历史是「改动」列表，不是「操作」日志）
const mSame = JSON.parse(JSON.stringify((await call('doc:get', { where: dirHist })).model))
mSame.nodes.find((n) => n.id === 'h2').label = '核心（用户改）'
await call('doc:set', { model: mSame, where: dirHist })
eq('内容没变就不新增检查点', (await call('doc:history', { where: dirHist })).entries.length, 3)

// 4. 退回 AI 那一份：节点回到 AI 改完的样子，用户那次改动被退掉
const seqAi = hist1.entries[0].seq
const back = await call('doc:rollback', { seq: seqAi, where: dirHist })
ok('doc:rollback 成功', back && back.ok !== false, back && back.error)
eq('回执里说明退到了哪一份', back.rolledBackTo, seqAi)
const afterBack = await call('doc:get', { where: dirHist })
ok('节点回到了 AI 改完的状态（hCache 在）', afterBack.model.nodes.some((n) => n.id === 'hCache'))
eq('用户那次改动被退掉了', afterBack.model.nodes.find((n) => n.id === 'h2').label, '核心')
ok('退回本身也记了一份检查点（时间线只增不减）', afterBack.historyCount >= 4)
const hist3 = await call('doc:history', { where: dirHist })
eq('退回后最新那份仍是 user（这是用户的操作）', hist3.entries[0].by, 'user')
ok('退回那条的来源写着 rollback:<seq>', String(hist3.entries[0].site).indexOf('rollback:') === 0, hist3.entries[0].site)
ok('被退掉的那份检查点还在 —— 能再往前走', hist3.entries.some((e) => e.seq === seqAi))

// 5. 再退到更晚的那一份：把用户改动拿回来（证明「退回」不是单向的）
const seqUser = hist2.entries[0].seq
const forward = await call('doc:rollback', { seq: seqUser, where: dirHist })
ok('可以再退到更晚的那一份（等价于「前进」）', forward && forward.ok !== false, forward && forward.error)
eq('用户那次改动回来了', (await call('doc:get', { where: dirHist })).model.nodes.find((n) => n.id === 'h2').label, '核心（用户改）')

// 6. 边界：编号不存在 / 退到当前状态，都要有话说，且一个字节都不改
const beforeBad = await call('doc:get', { where: dirHist })
const badSeq = await call('doc:rollback', { seq: 999999, where: dirHist })
eq('不存在的编号被拒', badSeq.ok, false)
ok('拒绝理由说明历史只在内存里', String(badSeq.error).indexOf('重启') >= 0, badSeq.error)
const curSeq = (await call('doc:history', { where: dirHist })).entries.find((e) => e.current).seq
const sameSeq = await call('doc:rollback', { seq: curSeq, where: dirHist })
eq('退到当前状态被拒（不做无意义的写盘）', sameSeq.ok, false)
const noSeq = await call('doc:rollback', { where: dirHist })
eq('不给 seq 被拒', noSeq.ok, false)
eq('三次被拒都没改图', (await call('doc:get', { where: dirHist })).revision, beforeBad.revision)

// 7. 写盘失败的那一次不留检查点（历史里不能有「从来没写进去过」的状态）
failWritePaths.add(histFile)
const failEdit = await tool('arch_edit').execute({ ops: [{ op: 'add_node', id: 'hGhost', label: '不该留下' }] }, {})
ok('写盘失败的回执是 ok:false', failEdit && failEdit.ok === false, failEdit && failEdit.error)
failWritePaths.delete(histFile)
const histAfterFail = await call('doc:history', { where: dirHist })
ok('失败的改动没有进历史',
  !histAfterFail.entries.some((e) => (e.changed || []).indexOf('hGhost') >= 0),
  histAfterFail.entries.map((e) => e.changed))

// 8. 历史按文件分开：换一张图不会串味
files.set(dirHist + '/.arch-canvas/other.mmd', 'flowchart TD\n  o1["另一张"]\n')
const docOther = await call('doc:open', { key: 'other', where: dirHist })
ok('打开同库里的另一张图', docOther && docOther.ok !== false, docOther && docOther.error)
eq('另一张图的历史从「打开」开始，不带上一张的条目', docOther.historyCount, 1)
const histOther = await call('doc:history', { where: dirHist })
eq('它的清单里只有自己那一份', histOther.entries.length, 1)
eq('文件名也跟着换', histOther.file, dirHist + '/.arch-canvas/other.mmd')
const backArch = await call('doc:open', { key: 'architecture', where: dirHist })
ok('切回来历史还在（内存里按文件存着）', backArch && backArch.historyCount >= 5, backArch && backArch.historyCount)

// 9. 上限：环形缓冲不涨破
for (let i = 0; i < 60; i++) {
  await tool('arch_edit').execute({ ops: [{ op: 'set_label', id: 'h1', label: '第 ' + i + ' 次' }] }, {})
}
const capped = await call('doc:history', { where: dirHist })
eq('历史被上限截住（50 份）', capped.entries.length, 50)
eq('留下的是新的那些（最新一份是当前）', capped.entries[0].current, true)

// ---------- [19] 沙箱执行策略与会话透传 ----------
console.log('【沙箱执行策略透传】')
agentMap.set('sess-proj-x', { session: { id: 'sess-proj-x', cwd: '/tmp/proj-x' } })
sandboxResolveCalls = []
lastWriteArgs = null

const mPolicy = JSON.parse(JSON.stringify(getAfterDel.model))
const setWithSession = await call('doc:set', {
  model: mPolicy,
  where: dirNote,
  session: 'sess-proj-x',
})
ok('带 session 的 doc:set 成功', setWithSession && setWithSession.ok !== false)
ok('fs.writeText 收到了第 5 个参数 sandboxPolicy', !!(lastWriteArgs && lastWriteArgs.sandboxPolicy))
eq('sandboxPolicy.mode 是 workspace-write', lastWriteArgs && lastWriteArgs.sandboxPolicy && lastWriteArgs.sandboxPolicy.mode, 'workspace-write')
eq('sandboxPolicy.workspaceRoot 等于会话 cwd', lastWriteArgs && lastWriteArgs.sandboxPolicy && lastWriteArgs.sandboxPolicy.workspaceRoot, '/tmp/proj-x')

ok('sandboxPolicy.resolve 被调用过', sandboxResolveCalls.length > 0)
const lastResolveCall = sandboxResolveCalls[sandboxResolveCalls.length - 1]
eq('没有传 mode 给 resolve（不放大权限）', lastResolveCall && lastResolveCall.mode, undefined)
ok('传给 resolve 的对象带 session', !!(lastResolveCall && lastResolveCall.session))
eq('传给 resolve 的 session.cwd 正确', lastResolveCall && lastResolveCall.session && lastResolveCall.session.cwd, '/tmp/proj-x')

// agents 桩返回 undefined 时退回行为
lastWriteArgs = null
const setWithoutAgent = await call('doc:set', {
  model: mPolicy,
  where: dirNote,
  session: 'non-existent-sess',
})
ok('未知 session 的 doc:set 不抛错且成功', setWithoutAgent && setWithoutAgent.ok !== false)
ok('fs.writeText 仍然发生', !!lastWriteArgs)
eq('未找到 agent 时 sandboxPolicy 参数退回 undefined', lastWriteArgs && lastWriteArgs.sandboxPolicy, undefined)

// 缺策略的写入**必须留下能指路的现场**。2026-09 的生产日志里躺着 6 条
// `sandbox.policy.missing / no-session`，只说了"没策略"，谁在写、写哪个文件一概看不到 ——
// 按本项目自己的规矩，那等于匿名。现在 persist() 按 site 去重补一条 persist.no-policy。
await new Promise((r) => setTimeout(r, 60))
const noPolicyLines = (logStorage.get(todayLogKey) || '').trim().split('\n').map((l) => {
  try { return JSON.parse(l) } catch (e) { return null }
}).filter(Boolean)
const noPolicyRows = noPolicyLines.filter((row) => row.ev === 'persist.no-policy')
ok('缺策略的落盘记了 persist.no-policy（不再是匿名警告）', noPolicyRows.length >= 1, noPolicyRows.length)
ok('那条日志带着 site 与 file，能一眼指出是哪条入口丢了会话',
  !!noPolicyRows[0] && typeof noPolicyRows[0].site === 'string' && typeof noPolicyRows[0].file === 'string',
  noPolicyRows[0])

// doc:rev 会话化与 where 解析测试
const dirProjB = '/tmp/test-arch-proj-b'
const revB = await call('doc:rev', { where: dirProjB, session: 'sess-proj-x' })
eq('doc:rev 响应 where 指定的项目图库目录', revB && revB.dir, dirProjB + '/.arch-canvas')
eq('doc:rev 响应 diagram 名', revB && revB.diagram, 'architecture')

// 每一处落盘都要带策略。这条是被**活体探针**抓出来的：doc:set 修好了，但
// 「新建一张图」那条路（doc:open create）漏了，于是新建的图落不了盘、刷新就没了。
// 只断言最后一次写入不够 —— 必须断言「所有写入」。
console.log('【每一处落盘都带策略】')
const dirW = '/tmp/proj-writes'
agentMap.set('sess-w', { session: { id: 'sess-w', cwd: dirW } })
allWriteArgs.length = 0
await call('doc:list', { where: dirW, session: 'sess-w' })
const openNew = await call('doc:open', { key: 'newbie', create: true, where: dirW, session: 'sess-w' })
ok('新建一张图成功', openNew && openNew.ok !== false, openNew && openNew.error)
await call('doc:rename', { from: 'newbie', to: 'renamed', where: dirW, session: 'sess-w' })
await call('doc:delete', { key: 'renamed', where: dirW, session: 'sess-w' })
await call('doc:restore', { key: 'renamed', where: dirW, session: 'sess-w' })

ok('这一步确实发生了写入（否则下面那条是空测试）', allWriteArgs.length >= 3, allWriteArgs.length)
const noPolicy = allWriteArgs.filter((w) => !w.policy)
eq('所有写入都带了 sandboxPolicy（漏一个就是静默失败）', noPolicy.length, 0)
ok('写入的路径都在测试图库里', allWriteArgs.every((w) => String(w.targetKey).indexOf(dirW) === 0), allWriteArgs.map((w) => w.targetKey))

// ---------- 任务 1 守门断言：未建库项目读路径绝不创建，写路径与显式创建正常 ----------
console.log('【任务 1 守门断言：读路径不建库，写路径防隐式创建】')
const dirFresh = '/tmp/proj-fresh-' + Date.now()
const filesBefore = new Set([...files.keys()])

// 1. doc:get 返回空图
const freshGet = await call('doc:get', { where: dirFresh })
ok('全新项目 doc:get 返回 ok', freshGet && freshGet.ok === true)
eq('全新项目 doc:get 节点数为 0', freshGet.nodeCount, 0)
eq('全新项目 doc:get 连线数为 0', freshGet.edgeCount, 0)

// 2. 桩 files Map 里没有新增任何该目录下的文件
const filesAfter = [...files.keys()]
const freshNewFiles = filesAfter.filter((k) => !filesBefore.has(k) && k.startsWith(dirFresh))
eq('桩 files Map 里没有新增该目录下的任何文件', freshNewFiles.length, 0, freshNewFiles)

// 3. arch_write / arch_edit 被拒，且 error 指明「还没有图库」
const writeBlocked = await tool('arch_write').execute({
  mermaid: 'flowchart TD\n  x["A"] --> y["B"]\n',
}, {})
eq('未建库项目 arch_write 被拒 (ok === false)', writeBlocked.ok, false)
ok('arch_write 错误信息指出还没有图库', String(writeBlocked.error).indexOf('还没有图库') >= 0, writeBlocked.error)

const editBlocked = await tool('arch_edit').execute({
  ops: [{ op: 'add_node', id: 'n1', label: '试加节点' }],
}, {})
eq('未建库项目 arch_edit 被拒 (ok === false)', editBlocked.ok, false)
ok('arch_edit 错误信息指出还没有图库', String(editBlocked.error).indexOf('还没有图库') >= 0, editBlocked.error)

// 4. doc:open { create: true } 随后能建出来，absent 标记已清掉
const createFresh = await call('doc:open', { where: dirFresh, name: 'architecture', create: true })
ok('doc:open { create: true } 能成功建出图', createFresh && createFresh.ok === true)
const freshFilesCreated = [...files.keys()].filter((k) => k.startsWith(dirFresh + '/.arch-canvas/'))
ok('图库目录与文件已建出', freshFilesCreated.length > 0, freshFilesCreated)

// 建出后 arch_write 恢复可用
const writeAllowed = await tool('arch_write').execute({
  mermaid: 'flowchart TD\n  x["入口"] --> y["出口"]\n',
}, {})
eq('建库后 arch_write 成功 (ok !== false)', writeAllowed && writeAllowed.ok !== false, true)

// ============================================================================
// 宿主修复守门断言（2026-09-24 审计 A~K）
// 全部放在【提示词模板注入防护】之前：那一节会真的加一个 hex 节点再删掉、推进修订号，
// 夹在它后面会撞坏前面所有「修订号 == N」的断言。每条都配了负向对照 —— 只有正例的断言
// 证明不了它不是空转。
// ============================================================================

console.log('【A. notes.json 不被空表整库覆盖（数据丢失）】')
{
  const dirNS = '/tmp/proj-notes-survive'
  const nsOther = dirNS + '/.arch-canvas/other.mmd'
  const nsNotes = dirNS + '/.arch-canvas/notes.json'
  // 盘上：另一张图活着（这样不会触发全局继承），而**当前那张 architecture.mmd 不存在**；
  // notes.json 里躺着**两张图**的留言。从前 loadInto 的 absent 分支不读留言表，于是任意一次
  // 无关的 doc:set 都会把这半张空表写回去 = 整个图库所有图的留言被静默清空。
  files.set(nsOther, 'flowchart TD\n  z9["另一张图的节点"]\n')
  files.set(nsNotes, JSON.stringify({
    'architecture.mmd': { a9: { text: '上一轮留的架构留言', done: false, at: 222 } },
    'other.mmd': { z9: { text: 'other 这张图的留言，绝不能丢', done: false, at: 111 } },
  }, null, 2))
  const docNS0 = await call('doc:get', { where: dirNS })
  eq('A：当前图不存在（走的正是 absent 那条分支）', docNS0.nodeCount, 0, docNS0.nodeCount)
  const mNS = JSON.parse(JSON.stringify(docNS0.model))
  mNS.nodes.push({ id: 'a1', label: '架构图新节点', shape: 'rect', group: null, x: 0, y: 0, note: '架构图这条必须写进去', noteDone: false })
  const setNS = await call('doc:set', { model: mNS, where: dirNS })
  ok('A：doc:set 成功', setNS && setNS.ok !== false, setNS && setNS.error)
  const storeNS = JSON.parse(files.get(nsNotes) || '{}')
  ok('A：other.mmd 那条留言正文逐字未变（这就是从前被整表清掉的那一格）',
    !!(storeNS['other.mmd'] && storeNS['other.mmd'].z9) &&
    storeNS['other.mmd'].z9.text === 'other 这张图的留言，绝不能丢' &&
    storeNS['other.mmd'].z9.done === false &&
    storeNS['other.mmd'].z9.at === 111,
    storeNS['other.mmd'])
  // 负向对照：当前图那条确实被写进去了 —— 证明「表被读到了、写路径确实跑了」，
  // 而不是「整个写入被跳过」（后者会让上面那条断言变成空转）。
  ok('A：负向对照 —— 当前图（architecture.mmd）这条留言确实写进去了',
    !!(storeNS['architecture.mmd'] && storeNS['architecture.mmd'].a1) &&
    storeNS['architecture.mmd'].a1.text === '架构图这条必须写进去',
    storeNS['architecture.mmd'])
}

console.log('【B. {{ 守卫必须走完所有出口】')
{
  const dirTpl = '/tmp/proj-tpl-inject'
  const tplFile = dirTpl + '/.arch-canvas/architecture.mmd'
  // B1. 空画布的提前 return：@summary 里含 {{hexname}}
  const docTpl0 = await call('doc:get', { where: dirTpl })
  const mTpl0 = JSON.parse(JSON.stringify(docTpl0.model))
  mTpl0.summary = '注入探针 {{hexname}} 结束'
  const setTpl0 = await call('doc:set', { model: mTpl0, where: dirTpl })
  ok('B1：空画布 + 含 {{ 的总结 落盘成功', setTpl0 && setTpl0.ok !== false, setTpl0 && setTpl0.error)
  eq('B1：前提 —— 这张图真的一个节点都没有（否则踩不到那条提前 return）', setTpl0.nodeCount, 0)
  const b1Text = promptFn()
  ok('B1：提示词里不含 {{', b1Text.indexOf('{{') < 0,
    (b1Text.match(/\{\{/g) || []).length + ' 处 {{')
  // 负向对照：那句话确实进了提示词，而且能看出被拆成了 { { —— 证明「不含 {{」不是「整段没注入」
  ok('B1：总结那句确实在提示词里，且被拆成了 { {',
    b1Text.indexOf('注入探针') >= 0 && b1Text.indexOf('结束') >= 0 && b1Text.indexOf('{ {hexname}') >= 0,
    b1Text.split('\n').filter((l) => l.indexOf('这张图讲的是') >= 0))

  // B2. 连续四个 {{{{：单次 replace 拆不干净（替换文本自己又挨在一起）
  const mTpl1 = JSON.parse(JSON.stringify(mTpl0))
  mTpl1.summary = '模板探针'
  mTpl1.nodes.push({ id: 'tpl1', label: '{{{{a}}}}', shape: 'rect', group: null, x: 0, y: 0 })
  const setTpl1 = await call('doc:set', { model: mTpl1, where: dirTpl })
  ok('B2：带 {{{{ 标签的节点落盘成功', setTpl1 && setTpl1.ok !== false, setTpl1 && setTpl1.error)
  eq('B2：前提 —— 节点确实在（否则走的是空画布那条 return，测不到标签这条路）', setTpl1.nodeCount, 1)
  ok('B2：前提 —— 文件里真的写着四个花括号', files.get(tplFile).indexOf('{{{{a}}}}') >= 0,
    files.get(tplFile).split('\n').filter((l) => l.indexOf('tpl1') >= 0))
  const b2Text = promptFn()
  ok('B2：提示词里不含 {{（单次 replace 会剩下 "{{"）', b2Text.indexOf('{{') < 0,
    (b2Text.match(/\{\{/g) || []).length + ' 处 {{')
  ok('B2：负向对照 —— 拆到了不动为止（四个 { 全被拆开，标签还在上下文里）',
    b2Text.indexOf('{ { { {a}}}}') >= 0, b2Text.split('\n').filter((l) => l.indexOf('tpl1') >= 0))

  // B3. foreign 出口：对方的图名里含 {{，而且新行为干脆不再报那个图名
  const dirTplX = '/tmp/proj-tpl-x'
  const dirTplY = '/tmp/proj-tpl-y'
  const tplXFile = dirTplX + '/.arch-canvas/含{{漏点}}.mmd'
  files.set(tplXFile, 'flowchart TD\n  hx["X 的图"]\n')
  const agentTplX = { session: { id: 'sess-tpl-x', cwd: dirTplX } }
  const agentTplY = { session: { id: 'sess-tpl-y', cwd: dirTplY } }
  const parkX = await call('doc:open', { where: dirTplX, key: '含{{漏点}}', session: 'sess-tpl-x' })
  ok('B3：X 把画布停在图名含 {{ 的那张图上', parkX && parkX.ok !== false, parkX && parkX.error)
  eq('B3：停的确实是那张图', parkX && parkX.diagram, '含{{漏点}}')
  // 负向对照：X 自己那一步看得到这个图名（拆开后的样子）——证明这个名字里真的有 {{，
  // 下面「Y 看不到」才有意义（否则可能只是那个名字压根不存在）。
  const b3X = promptFn({ agent: agentTplX })
  ok('B3：负向对照 —— X 自己那一步看得到自己的图名（拆开成 { {）',
    b3X.indexOf('含{ {漏点}}') >= 0, b3X.slice(0, 200))
  ok('B3：X 自己那一步同样不含 {{', b3X.indexOf('{{') < 0)
  const b3Y = promptFn({ agent: agentTplY })
  ok('B3：Y 那一步不含 {{（foreignCanvasText 从前带着对方的图名，那就是漏点）',
    b3Y.indexOf('{{') < 0, (b3Y.match(/\{\{/g) || []).length + ' 处 {{')
  ok('B3：Y 那一步不含那张图的名字', b3Y.indexOf('漏点') < 0, b3Y.slice(0, 300))
  ok('B3：前提 —— Y 那一步走的确实是 foreign 出口（不是空文本碰巧不含 {{）',
    b3Y.indexOf('画布现在停在别的项目上') >= 0, b3Y.slice(0, 200))
  ok('B3：Y 那一步也没拿到 X 的图内容', b3Y.indexOf('X 的图') < 0 && b3Y.indexOf('```mermaid') < 0)
}

console.log('【C. 缺凭据的破坏性默认】')
{
  const dirCred = '/tmp/proj-cred'
  const credArch = dirCred + '/.arch-canvas/architecture.mmd'
  const credFile = dirCred + '/.arch-canvas/cred.mmd'
  const blankFile = dirCred + '/.arch-canvas/blank.mmd'
  files.set(credArch, 'flowchart TD\n  ca["凭据测试主图"]\n')
  files.set(credFile, 'flowchart TD\n  cc["待删除的图"]\n')
  files.set(blankFile, 'flowchart TD\n  cb["待清空的图"]\n')
  await call('doc:get', { where: dirCred })

  // C1. doc:delete 不带 key：从前 splitKey('') 兜成 architecture，一句无凭据调用就把默认图软删了
  const delNoKey = await call('doc:delete', { where: dirCred })
  eq('C1：doc:delete 不带 key 被拒（ok:false）', delNoKey.ok, false)
  ok('C1：错误信息说明需要 key', String(delNoKey.error).indexOf('需要 key') >= 0, delNoKey.error)
  eq('C1：默认图正文里没有墓碑', files.get(credArch).indexOf('%% @deleted'), -1)

  // C2. doc:applyText 不带 text：从前会把整张图写成空图并回 ok:true, saved:true
  const beforeC2 = files.get(credArch)
  const applyNoText = await call('doc:applyText', { where: dirCred })
  eq('C2：doc:applyText 不带 text 被拒（ok:false）', applyNoText.ok, false)
  ok('C2：错误信息说明需要 text', String(applyNoText.error).indexOf('需要 text') >= 0, applyNoText.error)
  eq('C2：盘上那张图逐字节未变', files.get(credArch), beforeC2)
  ok('C2：没有变成空图（节点正文还在）', files.get(credArch).indexOf('凭据测试主图') >= 0, files.get(credArch))

  // C3. 负向对照：拒绝的是「缺字段」，不是「这个功能被关掉了」
  const delOk = await call('doc:delete', { key: 'cred', where: dirCred })
  ok('C3：带正确 key 的 doc:delete 仍然能删', delOk && delOk.ok === true, delOk && delOk.error)
  eq('C3：墓碑真的写上了', files.get(credFile).indexOf('%% @deleted'), 0)
  const restOk = await call('doc:restore', { key: 'cred', where: dirCred })
  ok('C3：恢复回去', restOk && restOk.ok === true, restOk && restOk.error)
  await call('doc:open', { key: 'blank', where: dirCred })
  const clearBlank = await call('doc:applyText', { text: '', where: dirCred })
  ok('C3：显式传 text:"" 仍然能清空整张图', clearBlank && clearBlank.ok !== false, clearBlank && clearBlank.error)
  ok('C3：清空真的生效了（负向对照：不是「applyText 整体被关掉」）',
    files.get(blankFile).indexOf('待清空的图') < 0, files.get(blankFile))
}

console.log('【D. doc:restore 要把内存里的墓碑也摘掉】')
{
  const dirTombR = '/tmp/proj-tomb-restore'
  const tombRFile = dirTombR + '/.arch-canvas/architecture.mmd'
  files.set(tombRFile, 'flowchart TD\n  tb1["恢复测试节点"]\n')
  await call('doc:get', { where: dirTombR })

  // 负向对照：删了不恢复 → 保存时墓碑必须还在（否则下面那条「不再写回墓碑」没有意义）
  const delKeep = await call('doc:delete', { key: 'architecture', where: dirTombR })
  ok('D：负向对照的删除成功', delKeep && delKeep.ok !== false, delKeep && delKeep.error)
  const mKeep = JSON.parse(JSON.stringify((await call('doc:get', { where: dirTombR })).model))
  const setKeep = await call('doc:set', { model: mKeep, where: dirTombR })
  ok('D：负向对照的保存成功', setKeep && setKeep.ok !== false, setKeep && setKeep.error)
  eq('D：没恢复就保存 → 墓碑仍在（负向对照）',
    files.get(tombRFile).indexOf('%% @deleted'), 0)

  // 正例：删除 → 恢复 → 下一次保存不许把墓碑写回去
  const delR = await call('doc:delete', { key: 'architecture', where: dirTombR })
  ok('D：再次删除成功', delR && delR.ok !== false, delR && delR.error)
  const restR = await call('doc:restore', { key: 'architecture', where: dirTombR })
  ok('D：恢复成功', restR && restR.ok === true, restR && restR.error)
  const mRestR = JSON.parse(JSON.stringify((await call('doc:get', { where: dirTombR })).model))
  mRestR.nodes.push({ id: 'tb2', label: '恢复后新增', shape: 'rect', group: null, x: 10, y: 10 })
  const setRestR = await call('doc:set', { model: mRestR, where: dirTombR })
  ok('D：恢复后的保存成功', setRestR && setRestR.ok !== false, setRestR && setRestR.error)
  eq('D：恢复之后的下一次保存不再写回墓碑（用户的「恢复」不许无声作废）',
    files.get(tombRFile).indexOf('%% @deleted'), -1)
  ok('D：负向对照 —— 恢复后的内容确实落了盘（不是整个写入被跳过）',
    files.get(tombRFile).indexOf('恢复后新增') >= 0, files.get(tombRFile))
}

console.log('【E. 未办留言超过 20 条时只送列出来的那些】')
{
  const dirE25 = '/tmp/proj-note-25'
  files.set(dirE25 + '/.arch-canvas/other.mmd', 'flowchart TD\n  eo["占位图，避免触发全局继承"]\n')
  const docE250 = await call('doc:get', { where: dirE25 })
  const mE25 = JSON.parse(JSON.stringify(docE250.model))
  for (let i = 0; i < 25; i++) {
    mE25.nodes.push({ id: 'e' + i, label: 'E' + i, shape: 'rect', group: null, x: i * 10, y: 0, note: '待办条目 ' + i, noteDone: false })
  }
  const setE25 = await call('doc:set', { model: mE25, where: dirE25 })
  ok('E：造出 25 条未办留言', setE25 && setE25.ok !== false, setE25 && setE25.error)
  eq('E：前提 —— 25 条都在（否则下面全是空断言）', setE25.noteCount, 25)

  // 第一步：列出 20 条，并说明剩下 5 条下一步继续投递
  const e1Text = promptFn()
  eq('E：第一步只列 20 条', (e1Text.match(/待办条目 /g) || []).length, 20)
  ok('E：明说还有 5 条、下一步继续投递',
    e1Text.indexOf('还有 5 条') >= 0 && e1Text.indexOf('会在下一步继续投递') >= 0,
    e1Text.split('\n').filter((l) => l.indexOf('还有') >= 0))
  ok('E：截断点就在第 20 条（下标 19 在、下标 20 不在）',
    e1Text.indexOf('待办条目 19') >= 0 && e1Text.indexOf('待办条目 20') < 0)

  // 第二步：第 21 条起必须仍然能投递到（从前它们被标成已办、永远消失）
  const e2Text = promptFn()
  eq('E：第二步投递剩下那 5 条', (e2Text.match(/待办条目 /g) || []).length, 5)
  ok('E：剩下的是第 21~25 条',
    [20, 21, 22, 23, 24].every((i) => e2Text.indexOf('待办条目 ' + i) >= 0),
    e2Text.split('\n').filter((l) => l.indexOf('待办条目') >= 0))
  ok('E：负向对照 —— 前 20 条不重送（它们确实已送达）',
    e2Text.indexOf('待办条目 0') < 0 && e2Text.indexOf('待办条目 19') < 0)

  // 第三步：一条都没有了
  const e3Text = promptFn()
  eq('E：第三步一条都没有了', (e3Text.match(/待办条目 /g) || []).length, 0)
}

console.log('【F. op 传错类型不再静默清空字段】')
{
  const dirOps = '/tmp/proj-optypes'
  const opsFile = dirOps + '/.arch-canvas/architecture.mmd'
  files.set(opsFile, [
    'flowchart TD',
    '  subgraph g1["分组一"]',
    '    f1["甲"]',
    '  end',
    '  f2["乙"]',
    '  f1 --> f2',
    '%% @pos f1 10 20',
    '%% @link f1 "别的图"',
    '%% @file f1 "src/a.ts"',
    '',
  ].join('\n'))
  const docOps0 = await call('doc:get', { where: dirOps })
  const opsF1 = docOps0.model.nodes.find((n) => n.id === 'f1')
  ok('F：夹具就位（f1 带分组 / 坐标 / 下钻 / 锚点）',
    !!opsF1 && opsF1.group === 'g1' && opsF1.x === 10 && opsF1.y === 20 && opsF1.link === '别的图' &&
    JSON.stringify(opsF1.files) === JSON.stringify(['src/a.ts']),
    opsF1)

  // 每条非法 op 都配一个合法的 set_summary：这样批次一定落盘，
  // 「字段在文件里没变」才是真的断言（否则「一个 op 都没生效 → 不写盘」会让它空转）。
  const batch = async (title, op, marker) => {
    const res = await tool('arch_edit').execute({ ops: [op, { op: 'set_summary', label: '类型校验：' + title }] }, {})
    ok('F：' + title + ' → problems 非空', !!(res && res.problems && res.problems.length > 0), res && res.problems)
    ok('F：' + title + ' → 问题说了原因', !!(res && res.problems.some((p) => p.indexOf(marker) >= 0)), res && res.problems)
    eq('F：' + title + ' → 同一批里那条合法 op 照常生效（证明批次真的执行、真的落盘）',
      res && res.appliedCount, 1)
    return res
  }

  await batch('set_link link:42', { op: 'set_link', id: 'f1', link: 42 }, 'link')
  ok('F：原有 %% @link 仍在文件里（没有静默清空下钻）',
    files.get(opsFile).indexOf('%% @link f1 "别的图"') >= 0, files.get(opsFile))

  await batch('set_files files:"src/b.ts"', { op: 'set_files', id: 'f1', files: 'src/b.ts' }, 'files')
  ok('F：原有 %% @file 仍在文件里（没有静默清空锚点）',
    files.get(opsFile).indexOf('%% @file f1 "src/a.ts"') >= 0, files.get(opsFile))

  await batch('set_group group:99', { op: 'set_group', id: 'f1', group: 99 }, 'group')
  {
    const afterG = await call('doc:get', { where: dirOps })
    eq('F：group 未变（没有被「移出分组」）', afterG.model.nodes.find((n) => n.id === 'f1').group, 'g1')
    ok('F：文件里 f1 仍在 subgraph g1 里', files.get(opsFile).indexOf('subgraph g1') >= 0, files.get(opsFile))
  }

  await batch('move_node x:"abc"', { op: 'move_node', id: 'f1', x: 'abc' }, '有限数字')
  ok('F：坐标没被改掉（%% @pos 仍在文件里）',
    files.get(opsFile).indexOf('%% @pos f1 10 20') >= 0, files.get(opsFile))

  // 只传错 x、y 合法：从前 x 被静默忽略、y 照样生效（半截改动），现在整个 op 拒绝。
  await batch('move_node x:"abc" 但 y 合法', { op: 'move_node', id: 'f1', x: 'abc', y: 999 }, '有限数字')
  ok('F：x 类型错时 y 也不许单独生效（整个 op 一起拒绝）',
    files.get(opsFile).indexOf('%% @pos f1 10 20') >= 0, files.get(opsFile))

  // `1e999` 在 JSON 里合法、解析出来就是 Infinity —— 从前它会写进模型，而 serializeDoc 因
  // isFinite 为假不写 @pos，坐标直接从盘上消失且往返检查判一致。
  ok('F：1e999 是 JSON 合法数字且解析为 Infinity（这条 op 的来源）', JSON.parse('1e999') === Infinity)
  await batch('move_node x:1e999（Infinity）', { op: 'move_node', id: 'f1', x: 1e999 }, '有限数字')
  ok('F：Infinity 没有把坐标从盘上抹掉',
    files.get(opsFile).indexOf('%% @pos f1 10 20') >= 0, files.get(opsFile))

  await batch('remove_edge 不存在的那对点', { op: 'remove_edge', from: 'f2', to: 'f1' }, '没有连线')
  {
    const afterE = await call('doc:get', { where: dirOps })
    eq('F：原来的那条边还在', afterE.model.edges.length, 1)
    eq('F：方向没被反转', afterE.model.edges[0].from + '->' + afterE.model.edges[0].to, 'f1->f2')
  }

  await batch('remove_group 不存在', { op: 'remove_group', group: 'nope' }, '找不到分组')
  ok('F：分组 g1 还在', (await call('doc:get', { where: dirOps })).model.groups.some((g) => g.id === 'g1'))

  await batch('set_edge_label 没有这条边', { op: 'set_edge_label', from: 'f2', to: 'f1' }, '没有连线')
  {
    const afterL = await call('doc:get', { where: dirOps })
    eq('F：没有凭空多出一条连线', afterL.model.edges.length, 1)
    ok('F：文件里也没有 f2 --> f1', files.get(opsFile).indexOf('f2 --> f1') < 0, files.get(opsFile))
  }

  await batch('add_node shape:"bogus"', { op: 'add_node', id: 'zzz', shape: 'bogus' }, '未知形状')
  {
    const afterA = await call('doc:get', { where: dirOps })
    ok('F：节点没有被建出来', !afterA.model.nodes.some((n) => n.id === 'zzz'), afterA.model.nodes.map((n) => n.id))
    ok('F：文件里也没有 zzz', files.get(opsFile).indexOf('zzz') < 0, files.get(opsFile))
  }

  // 负向对照：同样的 op 传对类型，problems 全空、字段真的变了
  const fOkLink = await tool('arch_edit').execute({ ops: [{ op: 'set_link', id: 'f1', link: '新目标' }] }, {})
  eq('F：负向对照 set_link 传字符串 → appliedCount 1', fOkLink.appliedCount, 1)
  eq('F：负向对照 set_link 传字符串 → 无 problems', fOkLink.problems.length, 0)
  ok('F：链接真的写进了文件', files.get(opsFile).indexOf('%% @link f1 "新目标"') >= 0, files.get(opsFile))

  const fOkFiles = await tool('arch_edit').execute({ ops: [{ op: 'set_files', id: 'f1', files: ['src/b.ts'] }] }, {})
  eq('F：负向对照 set_files 传数组 → 无 problems', fOkFiles.problems.length, 0)
  ok('F：锚点真的换了', files.get(opsFile).indexOf('%% @file f1 "src/b.ts"') >= 0, files.get(opsFile))

  const fOkGroup = await tool('arch_edit').execute({ ops: [{ op: 'set_group', id: 'f1', group: 'g2' }] }, {})
  eq('F：负向对照 set_group 传字符串 → 无 problems', fOkGroup.problems.length, 0)
  eq('F：分组真的换了', (await call('doc:get', { where: dirOps })).model.nodes.find((n) => n.id === 'f1').group, 'g2')

  const fOkMove = await tool('arch_edit').execute({ ops: [{ op: 'move_node', id: 'f1', x: 111, y: 222 }] }, {})
  eq('F：负向对照 move_node 传有限数字 → 无 problems', fOkMove.problems.length, 0)
  ok('F：坐标真的改了', files.get(opsFile).indexOf('%% @pos f1 111 222') >= 0, files.get(opsFile))

  const fOkLabel = await tool('arch_edit').execute({ ops: [{ op: 'set_edge_label', from: 'f1', to: 'f2', label: '标注' }] }, {})
  eq('F：负向对照 set_edge_label 对已有的边 → 无 problems', fOkLabel.problems.length, 0)
  eq('F：连线标签真的改了', (await call('doc:get', { where: dirOps })).model.edges.find((e) => e.from === 'f1' && e.to === 'f2').label, '标注')

  const fOkDel = await tool('arch_edit').execute({ ops: [{ op: 'remove_edge', from: 'f1', to: 'f2' }] }, {})
  eq('F：负向对照 remove_edge 对已有的边 → 无 problems', fOkDel.problems.length, 0)
  eq('F：连线真的删了', (await call('doc:get', { where: dirOps })).model.edges.length, 0)

  const fOkRg = await tool('arch_edit').execute({ ops: [{ op: 'remove_group', group: 'g1' }] }, {})
  eq('F：负向对照 remove_group 对已有的组 → 无 problems', fOkRg.problems.length, 0)
  ok('F：分组真的删了', !(await call('doc:get', { where: dirOps })).model.groups.some((g) => g.id === 'g1'))

  const fOkAdd = await tool('arch_edit').execute({ ops: [{ op: 'add_node', id: 'zzz', shape: 'hex' }] }, {})
  eq('F：负向对照 add_node 传合法形状 → 无 problems', fOkAdd.problems.length, 0)
  eq('F：节点真的建出来了，形状也对',
    (await call('doc:get', { where: dirOps })).model.nodes.find((n) => n.id === 'zzz').shape, 'hex')
}

console.log('【G. 零生效的 arch_edit 不写盘、不推修订号】')
{
  const dirOpsG = '/tmp/proj-optypes'
  const beforeG = await call('doc:get', { where: dirOpsG })
  const writesBeforeG = allWriteArgs.length
  const gRes = await tool('arch_edit').execute({
    ops: [
      { op: 'set_label', id: '查无此节点', label: 'x' },
      { op: 'remove_node' },
      { op: 'set_edge_label', from: 'f1', to: '不存在的点' },
    ],
  }, {})
  ok('G：全部非法 → appliedCount = 0', gRes && gRes.appliedCount === 0, gRes && gRes.appliedCount)
  ok('G：problems 非空（不是静默什么都没做）', gRes && gRes.problems.length >= 3, gRes && gRes.problems)
  eq('G：回执里的修订号一点没动', gRes && gRes.revision, beforeG.revision)
  eq('G：零生效 → 一次写盘都没发生', allWriteArgs.length - writesBeforeG, 0)
  ok('G：lastChange.nodes 为空（界面不该继续脉动上一次的改动）',
    !!(gRes && gRes.lastChange) && gRes.lastChange.nodes.length === 0, gRes && gRes.lastChange)
  eq('G：再读一次，修订号仍然没动', (await call('doc:get', { where: dirOpsG })).revision, beforeG.revision)

  // 负向对照：同一张图上一个合法 op 仍然生效、仍然推进修订号、仍然写盘
  const gOk = await tool('arch_edit').execute({ ops: [{ op: 'set_summary', label: '合法一次' }] }, {})
  eq('G：负向对照 —— 合法 op 生效且无 problems', gOk && gOk.appliedCount, 1)
  eq('G：负向对照 —— 合法 op 无 problems', gOk && gOk.problems.length, 0)
  ok('G：负向对照 —— 合法 op 推进了修订号', gOk.revision > beforeG.revision, { before: beforeG.revision, after: gOk.revision })
  ok('G：负向对照 —— 合法 op 确实写了盘', allWriteArgs.length > writesBeforeG, allWriteArgs.length - writesBeforeG)
}

console.log('【H. drift：一张锚点都没有的图也要报「漏画」】')
{
  const dirDr0 = '/tmp/proj-drift-zero'
  const dr0File = dirDr0 + '/.arch-canvas/xxx.mmd'
  const dr0Store = dirDr0 + '/.arch-canvas/anchors.json'
  files.set(dr0File, 'flowchart TD\n  z0["零锚点的图"]\n')
  files.set(dirDr0 + '/src/a.ts', 'export const a = 1\n')
  const openDr0 = await call('doc:open', { key: 'xxx', where: dirDr0 })
  ok('H：打开零锚点的那张图', openDr0 && openDr0.ok !== false, openDr0 && openDr0.error)
  const preDr0 = await call('doc:get', { where: dirDr0 })
  ok('H：前提 —— 还没落盘时没有基线（否则下面那条是空断言）',
    !!(preDr0.drift && preDr0.drift.baseline === false), preDr0.drift)
  eq('H：前提 —— 这张图一条锚点都没有', Object.keys(preDr0.fileStatus || {}).length, 0)

  const mDr0 = JSON.parse(JSON.stringify(preDr0.model))
  const setDr0 = await call('doc:set', { model: mDr0, where: dirDr0 })
  ok('H：落盘成功', setDr0 && setDr0.ok !== false, setDr0 && setDr0.error)
  ok('H：零锚点也记了基线（从前 `if (!refs.length) return null` 让它永远没有基线）',
    files.has(dr0Store), [...files.keys()].filter((k) => k.indexOf(dirDr0) === 0))

  const afterDr0 = await call('doc:get', { where: dirDr0 })
  ok('H：这张零锚点的图现在有基线了', !!(afterDr0.drift && afterDr0.drift.baseline === true), afterDr0.drift)
  ok('H：漏画非空（有源码却没有任何锚点指向）',
    !!(afterDr0.drift && afterDr0.drift.uncovered && afterDr0.drift.uncovered.length > 0),
    afterDr0.drift && afterDr0.drift.uncovered)
  ok('H：漏画点在 src 目录上',
    !!(afterDr0.drift && (afterDr0.drift.uncovered || []).find((x) => x.dir === 'src')),
    afterDr0.drift && afterDr0.drift.uncovered)
  eq('H：负向对照 —— stale 仍必须为空（没基线也不许猜「过期」，这条不许破）',
    (afterDr0.drift && afterDr0.drift.stale.length) || 0, 0)
}

console.log('【I. 继承全局图库不再把同名新图清空】')
{
  const dirInh = '/tmp/proj-inherit-fix'
  const inhFile = dirInh + '/.arch-canvas/architecture.mmd'
  const freshFile = dirInh + '/.arch-canvas/fresh-i.mmd'
  const globalArch = TEST_DATA_DIR + '/architecture.mmd'
  const agentInh = { session: { id: 'sess-inh', cwd: dirInh } }
  ok('I：前提 —— 全局图库那张同名图是有内容的',
    /[A-Za-z0-9_\u00C0-\uFFFF]+\["/.test(files.get(globalArch) || ''), files.get(globalArch))
  ok('I：前提 —— 这个全新项目里一个 .mmd 都没有',
    ![...files.keys()].some((k) => k.indexOf(dirInh + '/') === 0),
    [...files.keys()].filter((k) => k.indexOf(dirInh) === 0))

  const swInh = await tool('arch_switch').execute({ key: 'architecture', create: true }, { agent: agentInh })
  ok('I：建图成功', swInh && swInh.ok !== false, swInh && swInh.error)
  ok('I：继承来的内容被保住了（节点数 > 0）', !!(swInh && swInh.nodeCount > 0), swInh && swInh.nodeCount)
  eq('I：新项目里那份与全局那份逐字节相同（不是被一份空文档当场盖掉）',
    files.get(inhFile), files.get(globalArch))

  // 负向对照：全局没有同名的新图仍然是一张空图 —— 证明「保住内容」不是「永远不建空图」
  const swFresh = await tool('arch_switch').execute({ key: 'fresh-i', create: true }, { agent: agentInh })
  ok('I：负向对照 —— 新建一张全局没有同名的图成功', swFresh && swFresh.ok !== false, swFresh && swFresh.error)
  eq('I：负向对照 —— 那是一张空图（0 节点）', swFresh && swFresh.nodeCount, 0)
  ok('I：负向对照 —— 盘上那份也是空的（没有任何节点声明）',
    files.has(freshFile) && (files.get(freshFile) || '').indexOf('["') < 0,
    files.get(freshFile))
}

console.log('【J. saved:false 的回执形状】')
{
  const dirJ = '/tmp/proj-receipt'
  const fileJ = dirJ + '/.arch-canvas/architecture.mmd'
  files.set(fileJ, 'flowchart TD\n  j1["回执契约节点"]\n')
  const beforeJ = await call('doc:get', { where: dirJ })
  const mJ = JSON.parse(JSON.stringify(beforeJ.model))
  mJ.nodes.find((n) => n.id === 'j1').label = '这次不该生效'
  failWritePaths.add(fileJ)
  const jFail = await call('doc:set', { model: mJ, where: dirJ })
  failWritePaths.delete(fileJ)

  eq('J：saved === false', jFail && jFail.saved, false)
  ok('J：回执里带 mermaid（客户端靠它重画）', !!(jFail && typeof jFail.mermaid === 'string' && jFail.mermaid.length > 0))
  eq('J：回执里的 mermaid 就是改动前那一份', jFail && jFail.mermaid, beforeJ.mermaid)
  ok('J：回执里带 model（回滚后的那一份）', !!(jFail && jFail.model))
  eq('J：回执里的 model 等于改动前那一份', JSON.stringify(jFail && jFail.model), JSON.stringify(beforeJ.model))
  ok('J：warnings 里含「回滚」', !!(jFail && jFail.warnings.some((w) => w.indexOf('回滚') >= 0)), jFail && jFail.warnings)
  eq('J：revision 没有前进', jFail && jFail.revision, beforeJ.revision)

  // 负向对照：成功那次 saved === true 且 model 是新的
  const jOk = await call('doc:set', { model: mJ, where: dirJ })
  eq('J：负向对照 —— 成功那次 saved === true', jOk && jOk.saved, true)
  eq('J：负向对照 —— 成功那次的 model 是新标签',
    jOk.model.nodes.find((n) => n.id === 'j1').label, '这次不该生效')
  ok('J：负向对照 —— 成功那次 revision 前进了', jOk.revision > beforeJ.revision,
    { before: beforeJ.revision, after: jOk.revision })
}

console.log('【K. 落盘失败那条警告在成功之后要消失】')
{
  const dirK = '/tmp/proj-warn-clear'
  const fileK = dirK + '/.arch-canvas/architecture.mmd'
  files.set(fileK, 'flowchart TD\n  k1["警告清空节点"]\n')
  const docK0 = await call('doc:get', { where: dirK })
  const mK = JSON.parse(JSON.stringify(docK0.model))
  mK.nodes.find((n) => n.id === 'k1').label = '失败的那次'
  failWritePaths.add(fileK)
  const kFail = await call('doc:set', { model: mK, where: dirK })
  failWritePaths.delete(fileK)
  ok('K：失败那次 warnings 里出现「保存失败，本次改动已回滚…」',
    !!(kFail && kFail.warnings.some((w) => w.indexOf('保存失败，本次改动已回滚') >= 0)), kFail && kFail.warnings)

  const kOk = await call('doc:set', { model: mK, where: dirK })
  ok('K：随后一次成功保存', !!(kOk && kOk.saved !== false), kOk && kOk.saved)
  ok('K：成功之后那条警告不再挂在回执的 warnings 上',
    !!(kOk && !kOk.warnings.some((w) => w.indexOf('保存失败，本次改动已回滚') >= 0)), kOk && kOk.warnings)
  const kGet = await call('doc:get', { where: dirK })
  ok('K：doc:get 回给界面的 warnings 里也没有它（画布页的横幅不再装一个早就不成立的状态）',
    !kGet.warnings.some((w) => w.indexOf('保存失败，本次改动已回滚') >= 0), kGet.warnings)
}

// ---------- 提示词模板注入防护 ----------
// 放在**最后**：这一节要真的往图里加一个 hex 节点再删掉，会推进修订号与节点数，
// 夹在中间会污染后续所有「doc:set 后修订号 == N」这类断言（第一次就是这么撞的）。
// Mermaid 的 hexagon 形状是 `id{{"标签"}}`，而 DSH 的 systemPrompt.context 会把 `{{...}}` 当变量引用，
// 名字不匹配 `/^[a-z][a-z0-9_]*$/` 就直接抛错 —— 整条提示词注入失败、插件当场崩
// （2026-09-20 实测：图上加了一个 hex 节点，会话就起不来了）。promptText 的最后一行的拆解就是那次事故的修复。
console.log('【宿主审计 A：add_node 带组必须把组也建出来，否则往返丢组】')
// normalizeModel / set_group / add_group 三处都会补建缺失的组，唯独 add_node 漏了：
// serializeDoc 只为 doc.groups 里的组写 subgraph，落到 loose 的节点下次解析回来 group 就是 null。
const dirAud = '/tmp/test-arch-audit'
agentMap.set('sess-aud', { session: { id: 'sess-aud', cwd: dirAud } })
const audOpen = await call('doc:open', { key: 'ag', create: true, where: dirAud, session: 'sess-aud' })
ok('审计用例：新建一张图', audOpen && audOpen.ok !== false, audOpen && audOpen.error)
const agAdd = await tool('arch_edit').execute({
  ops: [
    { op: 'add_node', id: 'gn1', label: '带组节点', group: '新组 名' },
    { op: 'add_node', id: 'gn2', label: '散节点' },
  ],
}, {})
ok('add_node 生效', agAdd && agAdd.appliedCount === 2, agAdd && agAdd.appliedCount)
ok('带组的节点立刻写成了 subgraph（组被建出来了）',
  String(agAdd.mermaid).indexOf('subgraph') >= 0, agAdd.mermaid)
const audBack = await call('doc:open', { key: 'ag', where: dirAud, session: 'sess-aud' })
const gn1 = audBack && audBack.model && audBack.model.nodes.find((n) => n.id === 'gn1')
// 这一条是**往返**断言：从磁盘重新读回来，组名必须还在（从前这里是 null —— 静默丢）
eq('从磁盘读回来组名还在（往返不丢）', gn1 && gn1.group, '新组_名')
ok('组也回到了 groups 里', !!(audBack.model.groups || []).find((g) => g.id === '新组_名'),
  audBack.model.groups)

console.log('【宿主审计 B：改名必须把留言表里的那一格一起搬过去】')
// 留言表以**图文件名**为键；doc:rename 只搬了 .mmd 正文和墓碑，于是新名字那张图一条留言都没有
const audModel = JSON.parse(JSON.stringify(audBack.model))
audModel.nodes.find((n) => n.id === 'gn1').note = '这条留言必须跟着改名走'
const audNote = await call('doc:set', { model: audModel, where: dirAud, session: 'sess-aud' })
ok('写留言成功', audNote && audNote.saved !== false, audNote && audNote.error)
const audRen = await call('doc:rename', { from: 'ag', to: 'ag2', where: dirAud, session: 'sess-aud' })
ok('改名成功', audRen && audRen.ok !== false, audRen && audRen.error)
const audAfter = await call('doc:open', { key: 'ag2', where: dirAud, session: 'sess-aud' })
const movedNote = audAfter && audAfter.model && audAfter.model.nodes.find((n) => n.note)
eq('改名之后留言跟着过来了（不再是「留言自己没了」）', movedNote && movedNote.note, '这条留言必须跟着改名走')
const audStoreTxt = files.get(dirAud + '/.arch-canvas/notes.json') || ''
ok('留言表里旧键已经搬走（不留孤儿）', audStoreTxt.indexOf('"ag.mmd"') < 0, audStoreTxt.slice(0, 160))
ok('留言表里新键拿到了那一格', audStoreTxt.indexOf('"ag2.mmd"') >= 0, audStoreTxt.slice(0, 160))

console.log('【宿主审计 C：落盘失败不许推进修订号、也不许换作者】')
const beforeRev = (await call('doc:get', { where: dirAud, session: 'sess-aud' }))
const revWas = beforeRev.revision
const byWas = beforeRev.updatedBy
const audFileNow = beforeRev.file
const failModel = JSON.parse(JSON.stringify(beforeRev.model))
failModel.nodes[0].label = '这次不该生效'
failWritePaths.add(audFileNow)
const audFail = await call('doc:set', { model: failModel, where: dirAud, session: 'sess-aud' })
failWritePaths.delete(audFileNow)
ok('写盘失败如实回报 saved:false', audFail && audFail.saved === false, audFail && audFail.saved)
const afterFail = await call('doc:get', { where: dirAud, session: 'sess-aud' })
// 失败的那次在 persist 之前已经 bump 过了；不还原的话修订号会白涨一格、作者记成它 ——
// 客户端看到修订号变了就以为改动生效了。
eq('落盘失败后修订号没有被推进', afterFail.revision, revWas)
eq('落盘失败后作者没有被改写', afterFail.updatedBy, byWas)
ok('落盘失败后标签也没变（内存已回滚）', afterFail.model.nodes[0].label !== '这次不该生效',
  afterFail.model.nodes[0].label)

// ============================================================================
// 宿主缺陷修复守门（2026-09-24 第二批：并发归属 / 类型闸门 / 清单指纹 / 墓碑 / 留言搬家）
// 放在【会话隔离】之前：每节都在**独立项目目录**上跑，不碰前面那些「修订号 == N」的断言；
// 每条都配了负向对照 —— 只有正例的断言证明不了它不是空转。
// ============================================================================

console.log('【L. persist：认下的文件 + 快照的正文，await 之后被换指针也不串台】')
{
  // 变体一：目标项目 absent（第一次写盘）。从前 body 在 await 之后才取，
  // 于是把 B 的图写进了 A 的 .mmd、A 用户自己的编辑一个字没落盘，回执还是 saved:true。
  const dirLA = '/tmp/proj-steal-absent'
  const dirLB = '/tmp/proj-steal-b'
  const fileLA = dirLA + '/.arch-canvas/architecture.mmd'
  files.set(dirLB + '/.arch-canvas/architecture.mmd', 'flowchart TD\n  b1["B 的图"]\n')
  agentMap.set('sess-steal', { session: { id: 'sess-steal', cwd: dirLA } })
  await call('doc:get', { where: dirLB, session: 'sess-steal' })
  const laAbsent = await call('doc:get', { where: dirLA, session: 'sess-steal' })
  eq('L1：前提 —— A 是 absent 空图（踩的正是「第一次写盘」那条分支）', laAbsent.nodeCount, 0)
  let stealL1 = 0
  const stealToB = async (key) => {
    if (stealL1 || String(key).indexOf(dirLA + '/') !== 0) return
    stealL1++
    await call('doc:get', { where: dirLB, session: 'sess-steal' })
  }
  readHooks.push(stealToB)
  writeHooks.push(stealToB)
  const l1Set = await call('doc:set', {
    where: dirLA, session: 'sess-steal',
    model: { nodes: [{ id: 'mine', label: 'A 用户刚画的节点' }], edges: [], groups: [], direction: 'TD' },
  })
  readHooks.length = 0
  writeHooks.length = 0
  ok('L1：负向对照 —— 钩子确实把指针换走过（否则这一节是空转）', stealL1 > 0, stealL1)
  ok('L1：doc:set 回执说保存了', l1Set && l1Set.saved === true, l1Set && l1Set.saved)
  ok('L1：★ A 自己的节点落盘了（正文取自认下的快照，不是当下的 doc）',
    String(files.get(fileLA)).indexOf('A 用户刚画的节点') >= 0, String(files.get(fileLA)).slice(-140))
  ok('L1：★ A 的 .mmd 里没有 B 的节点', String(files.get(fileLA)).indexOf('B 的图') < 0)
  ok('L1：记了一条 persist.doc-stolen（不是静默跳过）',
    (logStorage.get(todayLogKey) || '').indexOf('persist.doc-stolen') >= 0)

  // 变体二：旁路表读盘期间的 await —— 从前 A 的正文被推进 **B 的文件名**下的检查点，
  // B 一「退回」自己的检查点就把 B 的 .mmd 换成 A 的内容。
  const dirLC = '/tmp/proj-steal-c'
  const dirLD = '/tmp/proj-steal-d'
  const fileLC = dirLC + '/.arch-canvas/architecture.mmd'
  const fileLD = dirLD + '/.arch-canvas/architecture.mmd'
  files.set(fileLC, 'flowchart TD\n  c1["C 的图"]\n')
  files.set(fileLD, 'flowchart TD\n  d1["D 的图"]\n')
  agentMap.set('sess-steal2', { session: { id: 'sess-steal2', cwd: dirLC } })
  await call('doc:get', { where: dirLC, session: 'sess-steal2' })
  await call('doc:get', { where: dirLD, session: 'sess-steal2' })
  await call('doc:get', { where: dirLC, session: 'sess-steal2' })
  let stealL2 = 0
  const stealOnNotes = async (key) => {
    if (stealL2 || String(key).indexOf('/.arch-canvas/notes.json') < 0) return
    stealL2++
    await call('doc:get', { where: dirLD, session: 'sess-steal2' })
  }
  readHooks.push(stealOnNotes)
  writeHooks.push(stealOnNotes)
  const l2Set = await call('doc:set', {
    where: dirLC, session: 'sess-steal2',
    model: { nodes: [{ id: 'c1', label: 'C 改过的标签' }], edges: [], groups: [], direction: 'TD' },
  })
  readHooks.length = 0
  writeHooks.length = 0
  ok('L2：负向对照 —— 钩子确实在旁路表那条 await 上换过指针', stealL2 > 0, stealL2)
  ok('L2：C 的 .mmd 写的是 C 的新正文', String(files.get(fileLC)).indexOf('C 改过的标签') >= 0)
  const histD = await call('doc:history', { where: dirLD, session: 'sess-steal2' })
  ok('L2：★ D 的检查点里没有 site:doc:set（A 的正文没被推进别人的历史）',
    !histD.entries.some((e) => e.site === 'doc:set'), histD.entries.map((e) => e.site))
  // 退回**最新**那个检查点：修好之后它就是 D 自己的「打开」那份，退回不会带进 C 的正文；
  // 从前它是 A 那次 doc:set 的快照，一退就把 C 的正文写进 D 的 .mmd。
  const newest = histD.entries[0]
  const rbD = await call('doc:rollback', { where: dirLD, session: 'sess-steal2', seq: newest.seq })
  ok('L2：退回 D 自己的最新检查点成功', rbD && rbD.ok === true, rbD && rbD.error)
  ok('L2：★ 退回之后 D 的 .mmd 仍是 D 的内容（没被 C 的正文覆盖）',
    String(files.get(fileLD)).indexOf('C 改过的标签') < 0 && String(files.get(fileLD)).indexOf('D 的图') >= 0,
    String(files.get(fileLD)).slice(-140))
  ok('L2：★ 退回的回执里也没有 C 的正文',
    String(rbD.mermaid || '').indexOf('C 改过的标签') < 0)
  ok('L2：负向对照 —— C 的那次改动确实落了盘', l2Set && l2Set.saved === true, l2Set && l2Set.saved)

  // 变体三：回滚 + 写盘失败 + 那一刻指针被换走 —— applyRollback 从前不传 expectFile，
  // 于是 persistOrRollback 的「指针被换走不许回滚」闸门不可达：restoreModel(E 的快照) 会灌进
  // 当下（F 的）文档，F 的槽被就地改写、下一次编辑写到 E 的文件上。
  const dirLE = '/tmp/proj-steal-e'
  const dirLF = '/tmp/proj-steal-f'
  const fileLE = dirLE + '/.arch-canvas/architecture.mmd'
  const fileLF = dirLF + '/.arch-canvas/architecture.mmd'
  files.set(fileLE, 'flowchart TD\n  e1["E 的图"]\n')
  files.set(fileLF, 'flowchart TD\n  f1["F 的图"]\n')
  agentMap.set('sess-steal3', { session: { id: 'sess-steal3', cwd: dirLE } })
  await call('doc:get', { where: dirLE, session: 'sess-steal3' })
  await call('doc:set', {
    where: dirLE, session: 'sess-steal3',
    model: { nodes: [{ id: 'e1', label: 'E 改过一版' }], edges: [], groups: [], direction: 'TD' },
  })
  const histE = await call('doc:history', { where: dirLE, session: 'sess-steal3' })
  const openSeqE = histE.entries[histE.entries.length - 1].seq
  await call('doc:get', { where: dirLF, session: 'sess-steal3' })
  await call('doc:get', { where: dirLE, session: 'sess-steal3' })
  failWritePaths.add(fileLE)
  let stealL3 = 0
  const stealOnWriteE = async (key) => {
    if (stealL3 || String(key) !== fileLE) return
    stealL3++
    await call('doc:get', { where: dirLF, session: 'sess-steal3' })
  }
  writeHooks.push(stealOnWriteE)
  const rbE = await call('doc:rollback', { where: dirLE, session: 'sess-steal3', seq: openSeqE })
  writeHooks.length = 0
  failWritePaths.delete(fileLE)
  ok('L3：负向对照 —— 写盘时指针确实被换走过（否则这一节是空转）', stealL3 > 0, stealL3)
  ok('L3：回滚如实回报失败', rbE && rbE.ok === false, rbE && rbE.error)
  ok('L3：★ 记了一条 persist.rollback.skipped（persistOrRollback 的闸门真的可达了）',
    (logStorage.get(todayLogKey) || '').indexOf('persist.rollback.skipped') >= 0)
  const fNow = await call('doc:get', { where: dirLF, session: 'sess-steal3' })
  ok('L3：★ F 的画布没被灌进 E 的快照',
    fNow.model.nodes.length === 1 && fNow.model.nodes[0].id === 'f1',
    fNow.model.nodes.map((n) => n.id + ':' + n.label))
  ok('L3：★ F 的文件完好', String(files.get(fileLF)).indexOf('F 的图') >= 0)
  const fEdit = await call('doc:set', {
    where: dirLF, session: 'sess-steal3',
    model: { nodes: [{ id: 'f2', label: 'F 再编辑' }], edges: [], groups: [], direction: 'TD' },
  })
  ok('L3：F 再编辑一次照常落盘到自己的文件',
    fEdit && fEdit.saved === true && String(files.get(fileLF)).indexOf('F 再编辑') >= 0, fEdit && fEdit.error)
  ok('L3：★ E 的文件没有被 F 的编辑覆盖', String(files.get(fileLE)).indexOf('F 再编辑') < 0)
}

console.log('【M. doc:openPath：读盘期间指针被换走就不 adopt】')
{
  const dirM = '/tmp/proj-openpath-steal'
  const dirMB = '/tmp/proj-openpath-b'
  const extFile = dirM + '/docs/one.mmd'
  const mbFile = dirMB + '/.arch-canvas/architecture.mmd'
  files.set(dirM + '/.arch-canvas/architecture.mmd', 'flowchart TD\n  homeM["M 的主图"]\n')
  files.set(extFile, 'flowchart TD\n  fromOne["按路径打开的文件"]\n')
  files.set(dirM + '/docs/notes.json', '{}\n')
  files.set(mbFile, 'flowchart TD\n  homeB["B 的主图"]\n')
  agentMap.set('sess-open', { session: { id: 'sess-open', cwd: dirM } })
  await call('doc:get', { where: dirM, session: 'sess-open' })
  await call('doc:get', { where: dirMB, session: 'sess-open' })
  await call('doc:get', { where: dirM, session: 'sess-open' })
  let stealM = 0
  const stealOnExtNotes = async (key) => {
    if (stealM || String(key) !== dirM + '/docs/notes.json') return
    stealM++
    await call('doc:get', { where: dirMB, session: 'sess-open' })
  }
  readHooks.push(stealOnExtNotes)
  writeHooks.push(stealOnExtNotes)
  const openM = await call('doc:openPath', { path: extFile, where: dirM, session: 'sess-open' })
  readHooks.length = 0
  writeHooks.length = 0
  ok('M：负向对照 —— 钩子确实在打开外部文件的 await 里换过指针', stealM > 0, stealM)
  ok('M：★ 被抢走就拒绝这次打开（不 adopt）', openM && openM.ok === false, openM && openM.error)
  const mB = await call('doc:get', { where: dirMB, session: 'sess-open' })
  ok('M：★ B 的画布仍然是 B 自己的图（没被灌进 A 打开的文件）',
    mB.model.nodes.some((n) => n.id === 'homeB'), mB.model.nodes.map((n) => n.id))
  const mBModel = JSON.parse(JSON.stringify(mB.model))
  mBModel.nodes[0].x = 10
  mBModel.nodes[0].y = 10
  await call('doc:set', { where: dirMB, session: 'sess-open', model: mBModel })
  ok('M：★ B 拖一下保存之后盘上仍是 B 的图（没被外部文件顶掉）',
    String(files.get(mbFile)).indexOf('B 的主图') >= 0 && String(files.get(mbFile)).indexOf('按路径打开的文件') < 0,
    String(files.get(mbFile)).slice(-120))
  const openOk = await call('doc:openPath', { path: extFile, where: dirM, session: 'sess-open' })
  ok('M：负向对照 —— 没人抢指针时同一条路照旧能打开那个外部文件',
    openOk && openOk.ok === true && openOk.external === extFile, openOk && openOk.error)
}

console.log('【N. doc:delete 当前图之后，画布不许停在墓碑内容上】')
{
  const dirN = '/tmp/proj-delete-current'
  const fileN = dirN + '/.arch-canvas/architecture.mmd'
  files.set(fileN, 'flowchart TD\n  n1["唯一的图"]\n')
  const n0 = await call('doc:get', { where: dirN })
  eq('N：前提 —— 当前就是这张唯一的默认图', n0.diagram, 'architecture')
  const nDel = await call('doc:delete', { key: 'architecture', where: dirN })
  ok('N：删除成功', nDel && nDel.ok === true, nDel && nDel.error)
  const n1 = await call('doc:get', { where: dirN })
  eq('N：★ 画布不再停在墓碑内容上（nodeCount 0）', n1.nodeCount, 0)
  eq('N：★ tombstoned 为 false（不是「停在一张已删除的图上」）', n1.tombstoned, false)
  ok('N：盘上那份文件保持墓碑、正文一字未动',
    String(files.get(fileN)).indexOf('%% @deleted') === 0 && String(files.get(fileN)).indexOf('唯一的图') >= 0,
    String(files.get(fileN)).slice(0, 70))
  const nEdit = await call('doc:set', { where: dirN, model: { nodes: [{ id: 'x', label: '删掉之后又改的' }], edges: [] } })
  eq('N：★ 对墓碑文件的编辑不再落盘（saved:false）', nEdit && nEdit.saved, false)
  ok('N：★ 墓碑文件没有被这次编辑改写', String(files.get(fileN)).indexOf('%% @deleted') === 0,
    String(files.get(fileN)).slice(0, 70))
  await new Promise((r) => setTimeout(r, 60))
  ok('N：负向对照 —— 拒绝在日志里留了现场（persist.tombstone-guard），不是静默跳过',
    (logStorage.get(todayLogKey) || '').indexOf('persist.tombstone-guard') >= 0)
  const nRestore = await call('doc:restore', { key: 'architecture', where: dirN })
  ok('N：doc:restore 仍然能把它弄回来', nRestore && nRestore.ok === true, nRestore && nRestore.error)
  const nBack = await call('doc:get', { where: dirN })
  ok('N：恢复之后画布上又是那张图的内容（不是空画布）', nBack.nodeCount === 1, nBack.nodeCount)
  const n2Model = JSON.parse(JSON.stringify(nBack.model))
  n2Model.nodes.push({ id: 'n2', label: '恢复后新增', shape: 'rect', group: null, x: 0, y: 0 })
  const nSet2 = await call('doc:set', { where: dirN, model: n2Model })
  ok('N：恢复之后编辑照常落盘', nSet2 && nSet2.saved === true, nSet2 && nSet2.error)
  ok('N：恢复之后文件里不再有墓碑、且新节点在里面',
    String(files.get(fileN)).indexOf('%% @deleted') < 0 && String(files.get(fileN)).indexOf('恢复后新增') >= 0,
    String(files.get(fileN)).slice(-120))
}

console.log('【O. doc:rename：缺 from / to 不许退化成默认图名】')
{
  const dirO = '/tmp/proj-rename-guard'
  const libO = dirO + '/.arch-canvas'
  const fileO = libO + '/architecture.mmd'
  const seedO = 'flowchart TD\n  o1["用户的主图"]\n'
  files.set(fileO, seedO)
  files.set(libO + '/third.mmd', 'flowchart TD\n  t1["第三张"]\n')
  await call('doc:get', { where: dirO })
  const oBad = await call('doc:rename', { where: dirO, to: 'zzz' })
  ok('O：缺 from 被拒', oBad && oBad.ok === false, oBad && oBad.error)
  const oBad2 = await call('doc:rename', { where: dirO, from: '', to: 'zzz' })
  ok('O：from 是空串也被拒', oBad2 && oBad2.ok === false, oBad2 && oBad2.error)
  const oBad3 = await call('doc:rename', { where: dirO, from: 'third', to: 42 })
  ok('O：to 类型错被拒', oBad3 && oBad3.ok === false, oBad3 && oBad3.error)
  eq('O：★ 主图没有被软删（文件仍是原内容）', files.get(fileO), seedO)
  ok('O：★ 没有凭空空建出 zzz.mmd', !files.has(libO + '/zzz.mmd'))
  const oGood = await call('doc:rename', { where: dirO, from: 'third', to: 'third2' })
  ok('O：负向对照 —— 带 from/to 的改名照旧可用', oGood && oGood.ok !== false, oGood && oGood.error)
  ok('O：负向对照 —— 新名字的文件真的建出来了', files.has(libO + '/third2.mmd'))
}

console.log('【P. 改名搬留言：目标键已有孤儿条目时按节点 id 合并，一条都不许丢】')
{
  const dirP = '/tmp/proj-rename-notes-merge'
  const libP = dirP + '/.arch-canvas'
  const storeP = libP + '/notes.json'
  files.set(libP + '/draft.mmd', 'flowchart TD\n  d1["草稿"]\n  d2["草稿二"]\n')
  files.set(storeP, JSON.stringify({
    'draft.mmd': { d1: { text: '用户写给草稿的留言', done: false, at: 0 } },
    'old.mmd': { o1: { text: '老图的孤儿留言', done: false, at: 0 } },
  }, null, 2) + '\n')
  await call('doc:get', { where: dirP })
  await call('doc:open', { key: 'draft', where: dirP })
  const pRen = await call('doc:rename', { where: dirP, from: 'draft', to: 'old' })
  ok('P：改名成功', pRen && pRen.ok !== false, pRen && pRen.error)
  const pStore = JSON.parse(files.get(storeP) || '{}')
  ok('P：★ 用户写给源图的留言还在（按 id 合并进目标键）',
    !!(pStore['old.mmd'] && pStore['old.mmd'].d1 && pStore['old.mmd'].d1.text === '用户写给草稿的留言'),
    pStore['old.mmd'])
  ok('P：★ 目标键原有的孤儿条目也没丢',
    !!(pStore['old.mmd'] && pStore['old.mmd'].o1 && pStore['old.mmd'].o1.text === '老图的孤儿留言'),
    pStore['old.mmd'])
  ok('P：负向对照 —— 旧键已经搬走（不留孤儿）', !pStore['draft.mmd'], Object.keys(pStore))
  const pOpen = await call('doc:open', { key: 'old', where: dirP })
  const pNote = (pOpen.model.nodes.find((n) => n.note) || {}).note
  eq('P：负向对照 —— 改名后的图真的能读到那条留言', pNote, '用户写给草稿的留言')
}

console.log('【Q. doc:set / doc:applyText 的形状闸门：错类型不许清空整张图】')
{
  const dirQ = '/tmp/proj-model-gate'
  const fileQ = dirQ + '/.arch-canvas/architecture.mmd'
  const seedQ = 'flowchart TD\n  a["甲"]\n  b["乙"]\n  a --> b\n'
  files.set(fileQ, seedQ)
  await call('doc:get', { where: dirQ })
  for (const m of [[], {}, { nodes: 'x', edges: [] }, { nodes: [], edges: 'x' }, null]) {
    const r = await call('doc:set', { where: dirQ, model: m })
    ok('Q：doc:set model=' + JSON.stringify(m) + ' 被拒', r && r.ok === false, r && (r.error || r.ok))
  }
  eq('Q：★ 这几次拒绝之后盘上文件一字未动', files.get(fileQ), seedQ)
  const qNow = await call('doc:get', { where: dirQ })
  eq('Q：★ 画布也还是原来那两个节点', qNow.nodeCount, 2)
  const qClear = await call('doc:set', {
    where: dirQ,
    model: { nodes: [], edges: [], groups: [], direction: 'TD', summary: '' },
  })
  ok('Q：负向对照 —— 显式空数组照旧能清空（闸门不误伤「用户把节点全删了」）',
    qClear && qClear.saved === true, qClear && qClear.error)
  eq('Q：清空确实落了盘', (await call('doc:get', { where: dirQ })).nodeCount, 0)
  files.set(fileQ, seedQ)
  await call('doc:open', { key: 'architecture', where: dirQ })
  const qBlank = await call('doc:applyText', { where: dirQ, text: '   ' })
  ok('Q：★ doc:applyText("   ") 被拒（清空只认显式空串）', qBlank && qBlank.ok === false, qBlank && qBlank.error)
  eq('Q：★ 纯空白串之后盘上文件一字未动', files.get(fileQ), seedQ)
  const qEmpty = await call('doc:applyText', { where: dirQ, text: '' })
  ok('Q：负向对照 —— 显式空串照旧能清空整张图', qEmpty && qEmpty.saved === true, qEmpty && qEmpty.error)
  eq('Q：显式空串确实清空了', (await call('doc:get', { where: dirQ })).nodeCount, 0)
}

console.log('【R. 入参类型闸门：同一族口径统一（错类型一律拒绝）】')
{
  const dirR2 = '/tmp/proj-type-gate'
  const fileR2 = dirR2 + '/.arch-canvas/architecture.mmd'
  files.set(fileR2, 'flowchart TD\n  r1["甲"]\n')
  await call('doc:get', { where: dirR2 })
  const rBase = await call('doc:set', {
    where: dirR2,
    model: { nodes: [{ id: 'z', label: 'Z', note: '要保留的留言', noteDone: false }], edges: [], groups: [], direction: 'TD' },
  })
  ok('R：前提 —— 留言写进去了', rBase && rBase.saved === true, rBase && rBase.error)
  for (const bad of [0, 'no', 'false', 1, null]) {
    const r = await tool('arch_edit').execute({ ops: [{ op: 'mark_note', id: 'z', done: bad }] }, {})
    ok('R1：mark_note done=' + JSON.stringify(bad) + ' 进 problems 且不改状态',
      r && r.appliedCount === 0 && (r.problems || []).some((p) => p.indexOf('done 必须是布尔') >= 0),
      r && { applied: r.appliedCount, problems: r.problems })
  }
  const rAfter = await call('doc:get', { where: dirR2 })
  eq('R1：★ 错类型的 done 之后留言仍是未办（没被静默标掉）',
    rAfter.model.nodes.find((n) => n.id === 'z').noteDone, false)
  const rTrue = await tool('arch_edit').execute({ ops: [{ op: 'mark_note', id: 'z' }] }, {})
  ok('R1：负向对照 —— 省略 done 照旧标成已办', rTrue && rTrue.appliedCount === 1, rTrue && rTrue.problems)
  const rFalse = await tool('arch_edit').execute({ ops: [{ op: 'mark_note', id: 'z', done: false }] }, {})
  ok('R1：负向对照 —— done:false 照旧重新打开',
    rFalse && rFalse.appliedCount === 1 && (rFalse.done || []).some((d) => d.indexOf('重新打开') >= 0), rFalse && rFalse.done)

  const rHist = await call('doc:history', { where: dirR2 })
  const rSeq = rHist.entries[rHist.entries.length - 1].seq
  for (const bad of ['1', true, [2], 1.5, 0, -1]) {
    const r = await call('doc:rollback', { where: dirR2, seq: bad })
    ok('R2：doc:rollback seq=' + JSON.stringify(bad) + ' 被拒', r && r.ok === false, r && (r.error || r.ok))
  }
  const rGood = await call('doc:rollback', { where: dirR2, seq: rSeq })
  ok('R2：负向对照 —— 正确的整数 seq 照旧能退回', rGood && rGood.ok === true, rGood && rGood.error)

  ok('R3：doc:get where=42 被拒（不再静默读当前图）', (await call('doc:get', { where: 42 })).ok === false)
  ok('R3：负向对照 —— where:""（全局图库）这条有效输入没被误拒',
    (await call('doc:get', { where: '' })).ok === true)

  const rRead = await tool('arch_read').execute({ diagram: 42 }, {})
  ok('R4：arch_read diagram=42 被拒（不再静默读当前图）', rRead && rRead.ok === false, rRead)
  ok('R4：负向对照 —— arch_read 省略 diagram 照旧读当前图',
    (await tool('arch_read').execute({}, {})).ok === true)
  const rSwitchBad = await tool('arch_switch').execute({ key: '新图X', create: 'false' }, {})
  ok('R4：arch_switch create:"false" 被拒（字符串布尔不许当成「要新建」）', rSwitchBad && rSwitchBad.ok === false, rSwitchBad)
  ok('R4：★ 而且没有把图真的建出来', !files.has(dirR2 + '/.arch-canvas/新图X.mmd'))
  ok('R4：负向对照 —— 切到不存在的图（不带 create）照旧被拒并列出可用的图',
    (await tool('arch_switch').execute({ key: '不存在的图' }, {})).ok === false)

  const rFileBad = await call('doc:file', { where: dirR2, save: 'no' })
  ok('R5：doc:file save:"no" 被拒（不再把字符串当真值照落盘）', rFileBad && rFileBad.ok === false, rFileBad)
  ok('R5：负向对照 —— save:true 照旧落盘', (await call('doc:file', { where: dirR2, save: true })).saved === true)
}

console.log('【S. anchors.json：没读过的表不许整表覆盖（同图库其他图的 drift 基线）】')
{
  const dirS9 = '/tmp/proj-drift-cold'
  const libS9 = dirS9 + '/.arch-canvas'
  const anchorsS9 = libS9 + '/anchors.json'
  files.set(libS9 + '/architecture.mmd', 'flowchart TD\n  a1["主图"]\n')
  files.set(libS9 + '/other.mmd', 'flowchart TD\n  o1["别的图"]\n')
  files.set(libS9 + '/notes.json', JSON.stringify({
    'other.mmd': { o1: { text: '另一张图上的留言', done: false, at: 0 } },
  }, null, 2) + '\n')
  files.set(anchorsS9, JSON.stringify({
    'architecture.mmd': { refs: { 'src/x.ts': '10:abc' }, at: 1 },
    'other.mmd': { refs: { 'src/y.ts': '20:def' }, at: 2 },
  }, null, 2) + '\n')
  // **冷启动**：这一节的第一个动作就是写盘（没有 doc:get 先把表读进缓存）。
  // 从前 saveDriftStampsFor 用 `driftStoreCache[storePath] || {}` 起手，整表被覆盖成只剩当前这一格。
  const setS9 = await call('doc:set', {
    where: dirS9,
    model: { nodes: [{ id: 'a1', label: '主图改过' }], edges: [], groups: [], direction: 'TD' },
  })
  ok('S：冷启动第一次写盘成功', setS9 && setS9.saved === true, setS9 && setS9.error)
  const afterS9 = files.get(anchorsS9) || ''
  ok('S：★ other.mmd 的基线还在（没被整表覆盖成只剩当前这一格）',
    afterS9.indexOf('other.mmd') >= 0 && afterS9.indexOf('"20:def"') >= 0, afterS9.replace(/\s+/g, ' '))
  ok('S：负向对照 —— 当前这张图的基线确实写进去了（不是整个写入被跳过）',
    afterS9.indexOf('architecture.mmd') >= 0, afterS9.replace(/\s+/g, ' '))
  ok('S：同目录的留言表也没被清（notes.ts 那条闸一直在）',
    String(files.get(libS9 + '/notes.json')).indexOf('另一张图上的留言') >= 0)
  await call('doc:open', { key: 'other', where: dirS9 })
  const gS9 = await call('doc:get', { where: dirS9 })
  eq('S：别的图之后打开仍然有基线（stale 才有得可比）', gS9.drift && gS9.drift.baseline, true)
}

console.log('【T. 图库清单：同字节数的内容变化要看得见；写路径收尾不许被 TTL 吞掉】')
{
  const dirT = '/tmp/proj-lib-fp'
  const libT = dirT + '/.arch-canvas'
  const fileGT = libT + '/g.mmd'
  const origT = 'flowchart TD\n  a["第一个节点"]\n  b["第二个节点"]\n  c["第三个节点"]\n'
  const baseT = 'flowchart TD\n  a["只剩一个节点了"]\n'
  const shrunkT = baseT + '\n'.repeat(origT.length - baseT.length)
  files.set(fileGT, origT)
  files.set(libT + '/architecture.mmd', 'flowchart TD\n  home["主图"]\n')
  await call('doc:get', { where: dirT })
  const listT1 = await call('doc:list', { where: dirT, rescan: true })
  eq('T：前提 —— g 一开始是 3 个节点', (listT1.items.find((i) => i.name === 'g') || {}).nodes, 3)
  files.set(fileGT, shrunkT)
  eq('T：负向对照的前提 —— 改写后字节数一模一样', shrunkT.length, origT.length)
  const listT2 = await call('doc:list', { where: dirT, rescan: true })
  eq('T：★「重新扫描」看得见同字节数的内容变化（3 → 1 节点）',
    (listT2.items.find((i) => i.name === 'g') || {}).nodes, 1)
  ok('T：★ libraryRev 涨了（界面据此自动刷新）', listT2.libraryRev > listT1.libraryRev,
    { before: listT1.libraryRev, after: listT2.libraryRev })
  const tpT = prompts[0].text()
  ok('T：★ 提示词里的节点数也不再是旧的 3 个（同图库那行已经更新）',
    tpT.indexOf('「g」(1 节点)') >= 0, tpT.split('\n').find((l) => l.indexOf('同图库还有') >= 0))

  // 「2.5s 轮询只走目录 + 比指纹」这条性质不许破坏：TTL 之内非 rescan 的 doc:list 一个字节都不读。
  // 注意：测试的 call('doc:list', …) 会给不带 rescan 的调用补上 rescan:true（历史上是为了让
  // 断言看到最新清单），所以这里必须直接调 handler —— 界面 2.5s 轮询走的就是这条**非 force** 的路。
  let gReads = 0
  const gReadKeys = []
  const countG = (k) => { gReadKeys.push(String(k)); if (String(k) === fileGT) gReads++ }
  readHooks.push(countG)
  await handlers.get('doc:list')({ where: dirT })
  const readsAfterFirst = gReads
  await handlers.get('doc:list')({ where: dirT })
  readHooks.pop()
  eq('T：★ 2.5s 轮询那次（非 rescan、TTL 之内）一次都没读 g.mmd', gReads, 0)
  eq('T：负向对照的前提 —— 连续两次非 force 轮询都没读（证明走的确实是 TTL 那条缓存路）', readsAfterFirst, 0)

  // 写路径收尾的强制扫：删掉一张非当前图，回执与紧随的 doc:list 都要立刻看到。
  const delT = await call('doc:delete', { key: 'g', where: dirT })
  ok('T：★ 删除回执里 g 已经是「已删」（写路径收尾没被 TTL 吞掉）',
    !!delT && Array.isArray(delT.items) && delT.items.some((i) => i.name === 'g' && i.deleted === true),
    delT && delT.items && delT.items.map((i) => i.name + (i.deleted ? '(已删)' : '')))
  const listT4 = await call('doc:list', { where: dirT })
  ok('T：★ 紧接着的 doc:list（界面默认就是它）也立刻看到 g 已删',
    listT4.items.some((i) => i.name === 'g' && i.deleted === true),
    listT4.items.map((i) => i.name + (i.deleted ? '(已删)' : '')))
  const resT = await call('doc:restore', { key: 'g', where: dirT })
  ok('T：★ 恢复回执里 g 立刻活了',
    !!resT && Array.isArray(resT.items) && resT.items.some((i) => i.name === 'g' && i.deleted === false),
    resT && resT.items && resT.items.map((i) => i.name + (i.deleted ? '(已删)' : '')))
  const listT5 = await call('doc:list', { where: dirT })
  ok('T：★ 紧接着的 doc:list 也立刻看到它活了',
    listT5.items.some((i) => i.name === 'g' && i.deleted === false),
    listT5.items.map((i) => i.name + (i.deleted ? '(已删)' : '')))
}

console.log('【U. arch_edit：一个 op 都没生效时不许设 doc.notes】')
{
  const dirU = '/tmp/proj-notes-truth'
  files.set(dirU + '/.arch-canvas/architecture.mmd', 'flowchart TD\n  u1["节点"]\n')
  await call('doc:get', { where: dirU })
  const uBad = await tool('arch_edit').execute({ ops: [{ op: 'nope' }], note: '这句会显示在状态栏吗' }, {})
  eq('U：零生效的 arch_edit appliedCount === 0', uBad && uBad.appliedCount, 0)
  ok('U：★ 零生效时 doc.notes 为空（状态栏不显示与事实相反的说明）',
    Array.isArray(uBad.notes) && uBad.notes.length === 0, uBad && uBad.notes)
  const uOk = await tool('arch_edit').execute({ ops: [{ op: 'add_node', id: 'u2', label: '新节点' }], note: '这次真的改了' }, {})
  eq('U：负向对照 —— 有 op 生效时 appliedCount === 1', uOk && uOk.appliedCount, 1)
  ok('U：负向对照 —— 那句说明确实进了 notes',
    Array.isArray(uOk.notes) && uOk.notes.indexOf('这次真的改了') >= 0, uOk && uOk.notes)
}

console.log('【会话隔离：画布属于项目、不属于进程（2026-09-23 跨项目丢留言事故）】')
{
  // 事故现场：另一个会话（另一个项目）把共享画布切到它自己那边之后，本会话每一步的提示词注入
  // 都读到了那张图，还把留在那上面的 3 条留言当自己的「读一次即送达」消费掉了。
  // 根因：宿主只有**一份**内存文档，而 promptText 是同步求值、拿不到会话。
  // 这一节钉三件事：①别把别的项目的图/留言读给这一步；②别消费不属于本项目的留言；
  // ③每个项目各留一份内存画布（换回来只是换指针，不重新读盘、不额外推进修订号）。
  const dirIX = '/tmp/proj-iso-x'
  const dirIY = '/tmp/proj-iso-y'
  const fileIX = dirIX + '/.arch-canvas/architecture.mmd'
  files.set(fileIX, 'flowchart TD\n  x1["X 项目的节点"]\n')
  files.set(dirIY + '/.arch-canvas/architecture.mmd', 'flowchart TD\n  y1["Y 项目的节点"]\n')
  files.set(dirIX + '/子项目/.arch-canvas/细节图.mmd', 'flowchart TD\n  sx1["X 子项目的节点"]\n')
  const agentX = { session: { id: 'sess-x', cwd: dirIX } }
  const agentY = { session: { id: 'sess-y', cwd: dirIY } }
  const promptOf = (agent) => promptFn(agent ? { agent: agent } : undefined)

  // 1) X 打开自己的画布，并在节点上留一条**待递**留言
  const gX = await call('doc:get', { where: dirIX, session: 'sess-x' })
  eq('X 打开自己的画布', gX.diagram, 'architecture')
  ok('X 的图里是 X 的节点', gX.mermaid.indexOf('X 项目的节点') >= 0)
  const mX = JSON.parse(JSON.stringify(gX.model))
  const nx1 = mX.nodes.find((n) => n.id === 'x1')
  nx1.note = 'X 的待办：这条只能给 X 看'
  nx1.noteDone = false
  const setX = await call('doc:set', { where: dirIX, session: 'sess-x', model: mX })
  ok('留言写进 X 的画布', setX && setX.ok !== false)

  // 2) 另一个项目的会话走一步 —— 事故就发生在这里
  const pY = promptOf(agentY)
  ok('Y 那一步读不到 X 的图（负向对照：这就是事故发生的位置）', pY.indexOf('X 项目的节点') < 0, pY.slice(0, 200))
  ok('Y 那一步读不到 X 的留言', pY.indexOf('X 的待办：这条只能给 X 看') < 0)
  ok('Y 那一步明确说明「画布停在别的项目上」', pY.indexOf('画布现在停在别的项目上') >= 0, pY.slice(0, 200))
  ok('Y 那一步不含别的项目的源文本块', pY.indexOf('```mermaid') < 0)
  const notesXAfterY = JSON.parse(files.get(dirIX + '/.arch-canvas/notes.json') || '{}')
  eq('X 的留言在盘上仍是未办（Y 那一步没动它）',
    notesXAfterY['architecture.mmd'] && notesXAfterY['architecture.mmd'].x1 && notesXAfterY['architecture.mmd'].x1.done, false)

  // 3) X 自己那一步：图与留言都在 —— 这是「留言没被投错人」的判决性证据
  const pX1 = promptOf(agentX)
  ok('X 那一步能看到自己的图', pX1.indexOf('X 项目的节点') >= 0)
  ok('X 那一步能拿到自己那条留言（Y 没把它吃掉）', pX1.indexOf('X 的待办：这条只能给 X 看') >= 0)
  ok('正常路径里不出现「停在别的项目上」那句说明', pX1.indexOf('画布现在停在别的项目上') < 0)
  // 4) 一次性投递的语义不变：同一条只进一次
  ok('第二次走 X 的提示词里，这条留言已经不在（读一次即送达）',
    promptOf(agentX).indexOf('X 的待办：这条只能给 X 看') < 0)

  // 5) Y 调一次工具（工具带着自己的 cwd）→ 画布切到 Y 自己的项目
  const readY = await tool('arch_read').execute({}, { agent: agentY })
  ok('Y 的 arch_read 读到的是 Y 自己的图',
    !!readY && typeof readY.mermaid === 'string' && readY.mermaid.indexOf('Y 项目的节点') >= 0,
    readY && { diagram: readY.diagram, file: readY.file, ok: readY.ok, mermaid: String(readY.mermaid).slice(-80) })
  const pY2 = promptOf(agentY)
  ok('Y 的提示词随工具调用切回自己的画布（不再是那句说明）',
    pY2.indexOf('Y 项目的节点') >= 0 && pY2.indexOf('画布现在停在别的项目上') < 0)

  // 6) 每个项目一份内存画布：换回来只是换指针
  const revX0 = (await call('doc:get', { where: dirIX, session: 'sess-x' })).revision
  await call('doc:get', { where: dirIY, session: 'sess-y' })
  const gXBack = await call('doc:get', { where: dirIX, session: 'sess-x' })
  eq('回到 X：修订号一点没动（没有重新加载）', gXBack.revision, revX0)
  ok('回到 X：lastChange 不是 switch（负向对照：真换了库就会标 switch）',
    !(gXBack.lastChange && gXBack.lastChange.by === 'switch'), gXBack.lastChange)
  const gZ = await call('doc:get', { where: '/tmp/proj-iso-z', session: 'sess-z' })
  ok('负向对照：第一次进一个新项目确实会标 switch', gZ.lastChange && gZ.lastChange.by === 'switch', gZ.lastChange)

  // 7) 下钻到子图库时，归属仍按**项目根**算 —— 否则用户一下钻，自己的提示词就被判成别人的
  const swSub = await tool('arch_switch').execute({ name: '子项目/细节图' }, { agent: agentX })
  ok('X 切到自己的子图库成功', swSub && swSub.ok === true, swSub)
  const pXsub = promptOf(agentX)
  ok('子图库仍是 X 自己的画布（不是那句「停在别的项目上」）',
    pXsub.indexOf('X 子项目的节点') >= 0 && pXsub.indexOf('画布现在停在别的项目上') < 0, pXsub.slice(0, 200))

  // 8) 没有会话信息时保持旧行为（工具/测试桩/headless 都走这条）
  const pNoAgent = promptOf(undefined)
  ok('没有会话上下文时照旧注入当前画布（不被这句说明顶掉）',
    pNoAgent.indexOf('停在别的项目上') < 0 && pNoAgent.indexOf('```mermaid') >= 0)
}

console.log('【P0 连接符唯一真相：ARROWS 里每一个都要经 doc:set 原样落盘】')
{
  // 事故形态：`ARROWS`（mermaid.ts）有 28 种，而 document.ts 的 `ARROW_SET` 从前只手抄了 8 种，
  // `normalizeModel` / `add_edge` 用 `ARROW_SET[e.arrow] ? e.arrow : '-->'` —— `--o` / `o==>` 等
  // 20 种被**静默退成 `-->`**。归一发生在 adoptModel 里、**早于** persist() 的往返检查，
  // 所以那条检查也看不见（P0：丢数据 / 静默改写用户文件）。
  // 守门断言必须走**生产路径**：纯函数层 `parseMermaid(serializeDoc(doc))` 那条直连路径
  // 在生产里没有调用点，正是这个 bug 潜伏至今的原因。
  //
  // ARROWS 从构建产物里取（`lib/host-logic.js` 就是被测试执行的那份真身）：
  // 拿产物的表去驱动产物的路径，加一种新连接符而忘了同步，这条断言立刻红。
  // ARROWS 从**正在被执行的那份产物**（dist/host.js 的原文 `code`）里取：
  // 拿产物的表去驱动产物的路径，加一种新连接符而忘了同步，这条断言立刻红。
  const arrowsSrc = /var ARROWS = \[([\s\S]*?)\];/.exec(code)
  ok('能从宿主构建产物里取出 ARROWS 表', !!arrowsSrc && !!arrowsSrc[1])
  // 逐项取单引号字面量：数组字面量末尾有逗号（JSON.parse 不接受），而且箭头里不含逗号。
  const ARROW_LIST = (arrowsSrc ? arrowsSrc[1] : '')
    .replace(/\/\/[^\n]*/g, '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^'[^']*'$/.test(s))
    .map((s) => s.slice(1, -1))
  ok('ARROWS 至少 28 种（条数不对说明抽取坏了）', ARROW_LIST.length >= 28, ARROW_LIST.length)
  const arrowFile = TEST_DATA_DIR + '/arrow-probe.mmd'
  files.set(arrowFile, 'flowchart TD\n  A["A"]\n  B["B"]\n')
  await call('doc:openPath', { path: arrowFile })
  for (const arrow of ARROW_LIST) {
    const model = {
      direction: 'TD', summary: '', extras: [], groups: [],
      nodes: [
        { id: 'A', label: 'A', shape: 'rect', group: null, x: 0, y: 0, link: null, files: [] },
        { id: 'B', label: 'B', shape: 'rect', group: null, x: 0, y: 0, link: null, files: [] },
      ],
      edges: [{ id: 'e1', from: 'A', to: 'B', label: '', arrow: arrow }],
    }
    const r = await call('doc:set', { model })
    const body = files.get(arrowFile) || ''
    const edgeLines = body.split('\n').filter((l) => l.trim().indexOf('A ') === 0)
    ok('连接符 ' + arrow + '：盘上就是它自己（不许被退成 -->）',
      edgeLines.length === 1 && edgeLines[0].trim() === 'A ' + arrow + ' B',
      { edgeLines, warn: r && r.warnings })
    // 内存/回执里的箭头也必须还是它（回读一遍文件才行 —— `r.model` 是归一后的内存态）
    const reopened = await call('doc:openPath', { path: arrowFile })
    ok('连接符 ' + arrow + '：重新打开文件后箭头仍是它',
      !!reopened && reopened.model.edges.length === 1 && reopened.model.edges[0].arrow === arrow,
      reopened && reopened.model.edges)
  }
  // 负向对照：这份表驱动的断言不是空转 —— 手工把某个箭头改成 `-->` 必须让上面的形状对不上
  await call('doc:set', {
    model: {
      direction: 'TD', summary: '', extras: [], groups: [],
      nodes: [
        { id: 'A', label: 'A', shape: 'rect', group: null, x: 0, y: 0, link: null, files: [] },
        { id: 'B', label: 'B', shape: 'rect', group: null, x: 0, y: 0, link: null, files: [] },
      ],
      edges: [{ id: 'e1', from: 'A', to: 'B', label: '', arrow: 'o--' }],
    },
  })
  const badArrow = (files.get(arrowFile) || '').split('\n').filter((l) => l.trim().indexOf('A ') === 0)
  ok('负向对照：非法连接符 o-- 会被挡回 -->（说明上面那条真的在比对箭头本体）',
    badArrow.length === 1 && badArrow[0].trim() === 'A --> B', badArrow)
}

console.log('【P1 指令闸门：link中 经「打开→保存」4 轮不再无界增长】')
{
  // 事故形态：指令闸门用 `\b`（`k` 是 \w、`中` 不是 → 词边界成立），`link中["L"]` 被当指令塞进
  // extras：节点只能靠别处的边活下来、label 退化成 id；重开时 `%% @pos link中` / `%% @file link中`
  // 被当「指向不存在节点」丢掉；而 extras 那行每「打开→保存」一轮就多写一遍 —— 实测 4 轮
  // 3 行 / 350B → 6 行 / 401B。文件整份进提示词，越长越贵。
  const growFile = TEST_DATA_DIR + '/grow-probe.mmd'
  const growText = ['flowchart TD', '  subgraph A["组"]', '    link中["L"]', '  end', '  B --- link中'].join('\n') + '\n'
  files.set(growFile, growText)
  const sizes = []
  for (let cycle = 1; cycle <= 4; cycle++) {
    const r = await call('doc:openPath', { path: growFile })
    ok('第 ' + cycle + ' 轮：link中 是节点 n_link中（不是 extras、label 不退化、没有「节点丢了」的警告）',
      !!r && r.model.nodes.some((n) => n.id === 'n_link中' && n.label === 'L') &&
      r.model.extras.length === 0 &&
      !r.warnings.some((w) => w.indexOf('指向图里不存在的节点') >= 0 || w.indexOf('原样保留') >= 0),
      r && { n: r.model.nodes.map((n) => [n.id, n.label]), e: r.model.extras, w: r.warnings })
    const e = await tool('arch_edit').execute({ ops: [{ op: 'move_node', id: 'B', x: cycle * 10, y: 0 }] }, {})
    ok('第 ' + cycle + ' 轮：保存成功', e && e.ok !== false, e && e.problems)
    const body = files.get(growFile)
    sizes.push({ lines: body.split('\n').length, bytes: body.length })
    ok('第 ' + cycle + ' 轮：link中 的声明行只有一行',
      body.split('\n').filter((l) => l.indexOf('n_link中[') >= 0).length === 1, body)
  }
  ok('4 轮之后行数与字节数都不再涨（第 1 轮与第 4 轮完全相同）',
    sizes[0].lines === sizes[3].lines && sizes[0].bytes === sizes[3].bytes, sizes)
  ok('负向对照：这一节真的在改坐标（否则上面是空转）',
    (files.get(growFile) || '').indexOf('@pos B 40 0') >= 0, (files.get(growFile) || '').split('\n').filter((l) => l.indexOf('@pos') >= 0))
}

// ---------- 真 Mermaid 校验脚手架（下面两节要用）----------
// host.e2e 其余断言都跑在桩 fs 上，只有「落盘产物真 Mermaid 认不认」非真解析器不可。
let realMermaid = null
async function realAccepts(text) {
  if (!realMermaid) return { ok: false, err: 'mermaid 未加载' }
  try { await realMermaid.parse(text); return { ok: true } } catch (e) { return { ok: false, err: String((e && e.message) || e).split('\n')[0] } }
}
try {
  const { JSDOM } = await import('jsdom')
  const dom = new JSDOM('<!doctype html><html><body></body></html>')
  global.window = dom.window
  global.document = dom.window.document
  // Node 21+ 的 globalThis.navigator 是只读 getter：ESM 严格模式下直接赋值会抛，必须 defineProperty
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
  const mod = await import(new URL('../node_modules/mermaid/dist/mermaid.esm.mjs', import.meta.url).href)
  realMermaid = mod.default
  realMermaid.initialize({ startOnLoad: false, securityLevel: 'loose' })
} catch (e) {
  // 加载不了必须**报失败**，不许静默跳过 —— 跳过就是一个空测试。
  ok('真 Mermaid 校验脚手架（jsdom + mermaid）能加载', false, String((e && e.message) || e))
}

console.log('【P1 emoji id：宿主落盘后真 mermaid.parse 必须通过】')
{
  // 事故形态：`cleanId` 的字符类按 UTF-16 码元判，`😀` 的两个码元都 ≥ \u00C0 → 被当合法 CJK 放行，
  // 盘上写出 `🚀["发布"]`，真 Mermaid 直接 Lexical error，而我们零警告。
  const emojiFile = TEST_DATA_DIR + '/emoji-probe.mmd'
  files.set(emojiFile, 'flowchart TD\n  A["a"]\n')
  await call('doc:openPath', { path: emojiFile })
  const e = await tool('arch_edit').execute({
    ops: [
      { op: 'add_node', id: '🚀', label: '发布' },
      { op: 'add_node', id: 'a😀', label: '第二个 emoji id' },
    ],
  }, {})
  ok('emoji id 的 add_node 生效', e && e.ok !== false, e && e.problems)
  const body = files.get(emojiFile)
  ok('盘上不再有 emoji 当 id 的行', body.indexOf('🚀[') < 0 && body.indexOf('a😀[') < 0,
    body.split('\n').filter((l) => /[\uD800-\uDFFF]/.test(l) && l.indexOf('[') >= 0))
  ok('盘上的产物真 mermaid.parse 通过', (await realAccepts(body)).ok, { err: (await realAccepts(body)).err, body })
  ok('label 里的中文没丢（发布 / 第二个 emoji id 都在）',
    body.indexOf('发布') >= 0 && body.indexOf('第二个 emoji id') >= 0, body)
  // label 里的 emoji 必须继续合法（第 [23] 节钉着的那条，这里从宿主路径再验一次）
  const e2 = await tool('arch_edit').execute({ ops: [{ op: 'set_label', id: 'A', label: '😀 emoji 标题' }] }, {})
  ok('label 里的 emoji 设置成功', e2 && e2.ok !== false, e2 && e2.problems)
  const body2 = files.get(emojiFile)
  ok('label 里的 emoji 落盘后真 mermaid.parse 通过', (await realAccepts(body2)).ok, { err: (await realAccepts(body2)).err, body2 })
  // 负向对照：原样把 emoji 当 id 写出去，真 Mermaid 确实拒收（上面那条不是空测试）
  const bad = await realAccepts('flowchart TD\n  🚀["发布"]')
  ok('负向对照：emoji 原样当 id 确实被真 Mermaid 拒收', !bad.ok, bad)
}

console.log('【P1 重复组 id：一次 move_node 后成员行与 %% @pos 各只出现一次】')
{
  // 事故形态：模型里有两个同 id 的组时一致（重解析还是会合并），roundTripDiff 判不出 →
  // 零警告；加载路径（openPath → adopt(parseMermaid(text))）从前不做组去重，
  // serializeDoc 每个组各写一遍成员行 / `%% @pos` / `%% @link` / `%% @file`。
  const dupFile = TEST_DATA_DIR + '/dup-group-probe.mmd'
  files.set(dupFile, [
    'flowchart TD',
    '  subgraph g1["A 组"]',
    '    n1["一"]',
    '  end',
    '  subgraph g1["B 组"]',
    '    n2["二"]',
    '  end',
  ].join('\n') + '\n')
  const opened = await call('doc:openPath', { path: dupFile })
  ok('打开时重复的组 id 只留一个（保留第一次的组名）',
    opened.model.groups.length === 1 && opened.model.groups[0].label === 'A 组', opened.model.groups)
  ok('两个成员都还在、都挂在这个组上',
    opened.model.nodes.length === 2 && opened.model.nodes.every((n) => n.group === 'g1'), opened.model.nodes)
  const mv = await tool('arch_edit').execute({ ops: [{ op: 'move_node', id: 'n1', x: 1, y: 2 }] }, {})
  ok('重复组文件上 move_node 成功', mv && mv.ok !== false, mv && mv.problems)
  const body = files.get(dupFile)
  ok('落盘后 subgraph 只有一块', body.split('\n').filter((l) => l.indexOf('subgraph ') >= 0).length === 1, body)
  ok('落盘后 n1 的成员行只有一次', body.split('\n').filter((l) => l.indexOf('n1[') >= 0).length === 1, body)
  ok('落盘后 n2 的成员行只有一次', body.split('\n').filter((l) => l.indexOf('n2[') >= 0).length === 1, body)
  ok('落盘后 @pos n1 只有一次', body.split('\n').filter((l) => l.indexOf('@pos n1') >= 0).length === 1, body)
  ok('落盘后产物真 Mermaid 合法', (await realAccepts(body)).ok, { err: (await realAccepts(body)).err, body })
}

console.log('【P1 归一撞名：doc:set 送进来的两个写法也必须都活下来】')
{
  // 界面/模型边界（normalizeModel）从前是 `if (seen[id]) continue` —— 静默丢掉一个用户写下的节点。
  // 与解析器那条同一个口径：后来者加稳定后缀 + 出声；边的两端按**原始写法**认回被改名的那个。
  const collideFile = TEST_DATA_DIR + '/collide-probe.mmd'
  files.set(collideFile, 'flowchart TD\n  A["a"]\n')
  await call('doc:openPath', { path: collideFile })
  const r = await call('doc:set', {
    model: {
      direction: 'TD', summary: '', extras: [], groups: [],
      nodes: [
        { id: 'a-b', label: '甲', shape: 'rect', group: null, x: 1, y: 2, link: null, files: [] },
        { id: 'a.b', label: '乙', shape: 'rect', group: null, x: 3, y: 4, link: null, files: [] },
      ],
      edges: [{ id: 'e1', from: 'a.b', to: 'a-b', label: '', arrow: '-->' }],
    },
  })
  ok('两个写法都活成节点', r.model.nodes.length === 2 &&
    r.model.nodes.map((n) => n.id).join(',') === 'a_b,a_b_2', r.model.nodes.map((n) => [n.id, n.label]))
  ok('label 不互相覆盖', r.model.nodes.map((n) => n.label).join(',') === '甲,乙', r.model.nodes.map((n) => n.label))
  ok('撞名出声了', (r.warnings || []).some((w) => w.indexOf('撞名') >= 0), r.warnings)
  ok('边按原始写法认回了被改名的那个节点（a.b → a_b_2 是 from）',
    r.model.edges.length === 1 && r.model.edges[0].from === 'a_b_2' && r.model.edges[0].to === 'a_b', r.model.edges)
  const body = files.get(collideFile)
  ok('落盘产物真 Mermaid 合法', (await realAccepts(body)).ok, { err: (await realAccepts(body)).err, body })
  // 同一个原始写法重复出现仍旧只留一个节点（normalizeModel 的既有口径：保留第一条），
  // 而且**不算撞名** —— 它不是「两个不同写法归一到一个」那种情况。
  const dupRaw = await call('doc:set', {
    model: {
      direction: 'TD', summary: '', extras: [], groups: [],
      nodes: [
        { id: 'z1', label: '先', shape: 'rect', group: null, x: 0, y: 0, link: null, files: [] },
        { id: 'z1', label: '后', shape: 'rect', group: null, x: 0, y: 0, link: null, files: [] },
      ],
      edges: [],
    },
  })
  ok('同一个原始写法重复送进来仍旧只留一个节点（保留第一条）',
    dupRaw.model.nodes.length === 1 && dupRaw.model.nodes[0].id === 'z1' && dupRaw.model.nodes[0].label === '先',
    dupRaw.model.nodes)
  ok('同一个原始写法不会多出带回后缀的节点', !dupRaw.model.nodes.some((n) => n.id.indexOf('z1_') === 0),
    dupRaw.model.nodes.map((n) => n.id))
}

console.log('【写盘前的往返守恒检查：整套测试跑下来一次都不该报】')
// 这条检查会跟着**每一次落盘**跑（上面几百次保存全经历过）。它一旦报，
// 说明「写出去再读回来对不上」—— 也就是有一类字段写不进文件（用户下次打开就少东西，
// 而且不报错）。这条断言的价值在于：它是**反向**的 —— 检查本身万一误报，
// 这里会立刻红灯，而不是等它在真实使用里刷屏。
await new Promise((r) => setTimeout(r, 60))
const rtLines = (logStorage.get(todayLogKey) || '').trim().split('\n').map((l) => {
  try { return JSON.parse(l) } catch (e) { return null }
}).filter(Boolean)
const rtBad = rtLines.filter((row) => row.ev === 'serialize.not-idempotent' || row.ev === 'serialize.check.fail')
ok('整套测试（几百次落盘）里往返检查一次都没报', rtBad.length === 0, rtBad.slice(0, 3))
ok('负向对照：这条日志确实会被写出来（否则上面那条是空测试）',
  rtLines.length > 0 && rtLines.some((row) => row.ev === 'doc.load'), rtLines.length)

console.log('【提示词模板注入防护】')
{
  const hexAdd = await tool('arch_edit').execute({ ops: [{ op: 'add_node', id: 'hexprobe', label: '探针', shape: 'hex', x: 0, y: 0 }] }, {})
  ok('hex 探针节点加上了', hexAdd && hexAdd.ok !== false, hexAdd && hexAdd.problems)
  const tHex = prompts[0].text()
  ok('源文本里的 {{ 被拆开（否则模板注入会抛错）', tHex.indexOf('{{') < 0,
    ((tHex.match(/\{\{/g) || []).length) + ' 处 {{')
  ok('拆开后那个 hex 节点仍在上下文里', tHex.indexOf('hexprobe') >= 0)
  const hexDel = await tool('arch_edit').execute({ ops: [{ op: 'remove_node', id: 'hexprobe' }] }, {})
  ok('探针节点已清掉', hexDel && hexDel.ok !== false)
}

console.log('')
console.log(fail === 0 ? `全部通过：${pass} / ${pass}` : `通过 ${pass}，失败 ${fail}`)
process.exit(fail === 0 ? 0 : 1)
