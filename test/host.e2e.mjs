// 在 vm 里真实执行 host 半边，用桩服务端到端跑一遍：
// 种子加载 / 四个 RPC / 三个工具 / 提示词上下文 / 静态资源路由
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

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
const DOC = '/home/vesita/.dsh/arch-canvas/architecture.mmd'
const CACHE = '/home/vesita/.dsh/.cache/arch-canvas/mermaid.min.js'
const files = new Map()
files.set(CACHE, '/* fake mermaid bundle */')
// 界面路由要真能发出 dist/ui.js，所以拿构建产物喂给桩 fs
files.set(
  '/home/vesita/coding/my/arch-canvas/dist/ui.js',
  readFileSync(new URL('../dist/ui.js', import.meta.url), 'utf8'),
)

const failWritePaths = new Set()
const fsSvc = {
  resolve: async (p) => ({ targetKey: p, displayPath: p }),
  stat: async (t) => {
    if (files.has(t.targetKey)) return { version: 'v1', type: 'file', size: files.get(t.targetKey).length }
    // 目录：只要有文件住在它下面就算存在。真 fs 会给 type:'directory'，
    // 桩也必须给 —— 否则 listDiagrams 永远认为目录不存在，测试会假绿。
    const prefix = String(t.targetKey).replace(/\/+$/, '') + '/'
    for (const path of files.keys()) if (path.startsWith(prefix)) return { version: 'v1', type: 'directory' }
    return undefined
  },
  readText: async (t) => {
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
  writeText: async (t, content) => {
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
const harness = {
  handle: (name, fn) => { handlers.set(name, fn); return () => handlers.delete(name) },
  // 宿主逻辑只**登记**路由，真正 register 由外层在 webServer 就绪后做（见 src/package/host.js）。
  route: (path, handler) => { routes.push({ kind: 'exact', path, handler }) },
  defineTool: (def) => def,
  registerTool: (_ctx, def) => { tools.push(def) },
}

const disposers = []
// 记下宿主逻辑问了哪些服务：'webServer' 出现在这里就是回退到「取快照」了 ——
// 那正是装机后拿到 undefined、工具与路由统统不注册的那个哑故障。
const askedServices = []
const intervals = []
const ctx = {
  get: (k) => {
    askedServices.push(k)
    return ({ fs: fsSvc, webServer: webSvc, systemPrompt: sysSvc })[k]
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
const LOG_DIR = '/home/vesita/.dsh/arch-canvas/logs'
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
  dataDir: '/home/vesita/.dsh/arch-canvas',
  uiFile: '/home/vesita/coding/my/arch-canvas/dist/ui.js',
  mermaidFile: CACHE,
}

// ---------- 执行 host 半边 ----------
const code = readFileSync(new URL('../dist/host.js', import.meta.url), 'utf8')
const sandbox = vm.createContext({ harness, console, hostEnv })
const plugin = await vm.runInContext(`(async () => {\n${code}\n})()`, sandbox, { filename: 'host-sim.js' })

console.log('【插件对象】')
ok('返回了 { apply } 形状的插件', plugin && typeof plugin.apply === 'function', plugin === null ? 'null' : typeof plugin)
plugin.apply(ctx)
ok('注册了 15 个 RPC 处理器', handlers.size === 15, [...handlers.keys()])
ok('注册了 AI 写图开关的两条 RPC',
  handlers.has('setting:get') && handlers.has('setting:set'), [...handlers.keys()])
ok('注册了 4 个工具', tools.length === 4, tools.map((t) => t.name))
ok('工具名单里有 arch_switch', tools.some((t) => t.name === 'arch_switch'))
ok('注册了 1 条提示词上下文', prompts.length === 1, prompts.map((p) => p.name))
ok('注册了 2 条静态路由', routes.length === 2, routes.map((r) => r.path))
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
eq('全局图库目录', g1.dir, '/home/vesita/.dsh/arch-canvas')
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

// ---------- AI 写图开关（默认关）----------
// 闸门在工具执行处，不是界面上的一句提示：关着时 arch_write / arch_edit 一个字节都不许改。
console.log('【AI 写图开关：默认关（硬闸门）】')
const SETTINGS = '/home/vesita/.dsh/arch-canvas/settings.json'
{
  const get0 = await call('setting:get', {})
  ok('默认是关的（文件不存在 ⇒ 关）', get0 && get0.aiWrite === false, get0)

  const before = await call('doc:get')
  const blockedEdit = await tool('arch_edit').execute({
    ops: [{ op: 'add_node', id: 'secret', label: '不该出现' }],
  }, {})
  ok('开关关着：arch_edit 被拒', blockedEdit && blockedEdit.ok === false, blockedEdit)
  ok('拒绝理由说清是「关闭」并要求用户打开开关',
    String(blockedEdit && blockedEdit.error).indexOf('关闭') >= 0 && String(blockedEdit.error).indexOf('AI 只读') >= 0,
    blockedEdit && blockedEdit.error)
  const blockedWrite = await tool('arch_write').execute({ mermaid: 'flowchart TD\n  x["不该出现"]' }, {})
  ok('开关关着：arch_write 同样被拒', blockedWrite && blockedWrite.ok === false, blockedWrite)

  const after = await call('doc:get')
  eq('被拒的两次都没改图（节点数不变）', after.nodeCount, before.nodeCount)
  eq('被拒的两次都没改图（修订号不变）', after.revision, before.revision)
  ok('被拒的两次都没落盘', files.get(DOC).indexOf('不该出现') < 0)
  await new Promise((r) => setTimeout(r, 30)) // 日志是异步队列，等它落盘再断言
  ok('拒绝留下了现场（aiwrite.blocked）',
    [...logStorage.values()].join('\n').indexOf('"ev":"aiwrite.blocked"') >= 0)

  // 用户在面板顶栏点开关 ⇒ 界面的那条 RPC。
  const on = await call('setting:set', { aiWrite: true })
  ok('打开开关：RPC 返回 ok 且状态是开', on && on.ok === true && on.aiWrite === true, on)
  ok('开关落盘到 settings.json', files.has(SETTINGS), [...files.keys()].filter((k) => k.indexOf('settings') >= 0))
  ok('落盘内容只认显式 true', JSON.parse(files.get(SETTINGS)).aiWrite === true, files.get(SETTINGS))
  const get1 = await call('setting:get', {})
  ok('再读是开着的', get1 && get1.aiWrite === true, get1)

  // 负向对照：文件被写坏 ⇒ 回到"关"（fail-closed，绝不放宽）。
  files.set(SETTINGS, '{ 这不是 JSON')
  const getBad = await call('setting:get', {})
  ok('settings.json 损坏 ⇒ 退回关（fail-closed）', getBad && getBad.aiWrite === false, getBad)
  const blockedAgain = await tool('arch_edit').execute({ ops: [{ op: 'add_node', id: 'nope2' }] }, {})
  ok('损坏后写入再次被拒', blockedAgain && blockedAgain.ok === false, blockedAgain)
  await call('setting:set', { aiWrite: true })
}

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
eq('项目图库继承了全局那张图（换库不丢图）', P.nodeCount, 2, P.nodeCount)
ok('并留下了说明', P.notes.some((n) => n.indexOf('全局图库') >= 0), P.notes)
ok('切库标记为 switch（界面据此重新适应视图）', P.lastChange && P.lastChange.by === 'switch', P.lastChange)
ok('换文档时修订号单调递增（不复位，防止界面漏掉变化）', P.revision > g1.revision, { before: g1.revision, after: P.revision })

const L1 = await call('doc:list', { where: '/proj-a' })
eq('清单里有 1 张', L1.items.length, 1)
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
  (await call('doc:rename', { where: '/proj-a', from: '支付主流程', to: 'architecture' })).ok === false)

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

console.log('【首次进项目图库：建目录 + 一次性继承】')
ok('继承时直接写出了文件，目录因此存在',
  [...files.keys()].some((k) => k.indexOf('/proj-a/.arch-canvas/') === 0), [...files.keys()].filter((k) => k.indexOf('/proj-a/') === 0))
ok('有东西可继承时不写占位文件（写它只是为了建目录）', !files.has('/proj-a/.arch-canvas/.gitkeep'))
ok('全局图库的图被继承了过来（否则用户会以为图丢了）',
  files.has('/proj-a/.arch-canvas/architecture.mmd'), [...files.keys()].filter((k) => k.indexOf('/proj-a/') === 0))
ok('继承有标记文件，只做一次', files.has('/home/vesita/.dsh/arch-canvas/.inherited'))
const P2 = await call('doc:get', { where: '/proj-b' })
ok('空图库靠写占位文件把目录建出来（fs 没有 mkdir）', files.has('/proj-b/.arch-canvas/.gitkeep'))
ok('第二个项目不再重复继承（拿到的是空白默认图，不是复制来的内容）',
  files.get('/proj-b/.arch-canvas/architecture.mmd').indexOf('新入口') < 0,
  files.get('/proj-b/.arch-canvas/architecture.mmd'))
eq('第二个项目从干净图库开始', P2.nodeCount, 0)
// 注意：探 /proj-b 会把图库切走，而「换库回到默认图」是设计行为 ——
// 所以后面要继续测支付图，必须显式切回来。这一步也顺便验证了那条设计。
const backA = await call('doc:open', { where: '/proj-a', name: '支付主流程' })
ok('切回 /proj-a 并重新打开支付主流程', backA.diagram === '支付主流程', backA.diagram)

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

console.log('')
console.log(fail === 0 ? `全部通过：${pass} / ${pass}` : `通过 ${pass}，失败 ${fail}`)
process.exit(fail === 0 ? 0 : 1)
