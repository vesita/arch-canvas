#!/usr/bin/env node
/**
 * 构建产物：
 *
 *   dist/host.js            真正的宿主逻辑（可从项目里热加载）
 *   dist/ui.js              真正的浏览器界面（同上）
 *   dist/bootstrap-host.js  Package 的 code.host —— 薄引导层，从磁盘加载 dist/host.js
 *   dist/bootstrap-client.js Package 的 code.client —— 薄引导层，让浏览器加载 dist/ui.js
 *   dist/payload.json       一次 cordis_define 调用所需的完整参数
 *
 * 以及「装成真插件」形态所需的 lib/：
 *   lib/index.js       宿主半边（来自 src/package/host.js）
 *   lib/host-logic.js  宿主逻辑本体（由 src/host/* 生成，导出工厂）
 *   lib/client.js      浏览器半边（来自 src/package/client.js）
 *   lib/ui.js          界面本体（= dist/ui.js，由 host 从 /arch-canvas/ui.js 现读现发）
 *
 * 为什么两边都要引导层：
 *   动态 Package 一旦定义就不可变，改一行都要重新 define + 授权，而我手上没有
 *   把文件直接喂给 cordis_define 的通道（只能整段重发）。把易变的代码放到磁盘上、
 *   Package 里只留不怎么会变的引导层，改动的循环就从「重发上千行」变成
 *   「npm run build（+ 有时刷新页面）」。
 *
 * 两半的加载方式不同，原因在沙箱能力：
 *   client —— 没有 import，但有 document，所以用 <script src> 加载，依赖走全局递进；
 *   host   —— 没有 import，但有 eval，所以把源码包成工厂函数再调用
 *             （宿主逻辑顶层带 return，不能直接 eval）。
 *
 * 为什么源码要「拼」：dist/host.js 与 dist/ui.js 都是整体求值的，没有模块系统。
 * 所以按语义分文件写、构建期拼，别写 import。
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, existsSync, readdirSync, lstatSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')
const TSC = join(ROOT, 'node_modules', '.bin', 'tsc')
const DSH_HOME = process.env.DSH_HOME || join(process.env.HOME ?? '', '.dsh')

/**
 * 构建期守门断言的**稳定 id** 清单：每一条都有自己的 id，构建成功时整串打出来。
 * 为什么要 id 而不是只报条数：从前「结构性断言 17 条」只是个印象 —— 里面**哪几条**有负向对照
 * 没人查得出来。`test/build-guards.mjs` 现在解析这串 id，逐个核对「这个 id 有一组真实违规对照」，
 * 对照表缺了谁就红。id 是语义名，改名 / 重排 / 增删别的断言都不该让它变。
 */
const structuralGuardIds = []

/**
 * 编译一侧的 TS 程序，返回「按相对路径读取编译产物」的函数。
 * 不用 tsc 的 --outFile 拼接：TS 7 移除了 module:"none"，而 outFile 只支持 amd/system。
 * 所以让 tsc 各文件单独产出（无 import/export 的文件仍是 global script），再由本脚本按序拼接。
 */
function compile(project) {
  const outDir = join(ROOT, 'dist', '.tmp', project)
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  try {
    execFileSync(TSC, ['-p', `tsconfig.${project}.json`, '--outDir', outDir, '--rootDir', '.'], {
      cwd: ROOT, stdio: 'inherit',
    })
  } catch (error) {
    console.error(`✗ tsc 编译 ${project} 失败`)
    process.exit(1)
  }
  return (rel) => readFileSync(join(outDir, rel), 'utf8')
}

const hostOut = compile('host')
const clientOut = compile('client')

// 拼接顺序就是这里写的顺序 —— 文件不再带编号前缀：顺序由构建显式声明，
// 比写进文件名更不容易骗人（改顺序只改这一处，不用重命名文件）。
const HOST_PARTS = [
  'src/host/mermaid.js',
  'src/host/log.js',
  'src/host/document.js',
  'src/host/notes.js',
  // drift 排在 notes 之后：它复用 notes 的旁路表写入口（writeSidecarJson），
  // 又调 document 的 splitFileRef / fileRefRoot（函数声明提升，跨分片共享同一段作用域）。
  'src/host/drift.js',
  // history 排在 document 之后：它读 doc / lastChange / serializeDoc，同属这一段作用域。
  'src/host/history.js',
  'src/host/plugin.js',
]
const UI_PARTS = [
  'src/client/runtime.js',
  'src/client/studio.js',
  'src/client/register.js',
]

/** `src/**` 下的 .ts 源文件（递归）——守门人要看见**将来**加的文件，不能只数今天的清单。 */
function walkTs(dir) {
  const out = []
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = dir + '/' + entry.name
    if (entry.isDirectory()) out.push(...walkTs(rel))
    else if (entry.name.endsWith('.ts')) out.push(rel)
  }
  return out
}

/**
 * 源码的「只剩代码」形态 —— 守门人只该看**代码**，两件事一起做：
 *
 *   1. **去掉注释**（行注释 / 块注释）。注释里提到 `console` / `__dirname` / `function ArchStudio`
 *      都不算违规。从前不剥注释，于是负向对照只要注入一句注释就能「证明」守门人有牙 ——
 *      实际证明的是「它会匹配注释文本」；反过来真代码变体（双引号）却能绕过。
 *   2. **把字符串定界符统一成单引号**：`onRpc("doc:get", …)` 与 `onRpc('doc:get', …)` 是同一件事，
 *      只认单引号形式等于留一个后门。字符串**内容**原样保留（`'a " b'` 不会被拆坏）；
 *      转义序列整对跳过；模板字面量里的 `${}` 按内容对待（这一层够用 —— 守的是
 *      「host 分片里写了 Node 调用」「引导层里塞了宿主逻辑」这类真实代码，不是对抗性混淆）。
 */
function codeOnly(code) {
  let out = ''
  let quote = ''
  for (let i = 0; i < code.length; i++) {
    const c = code[i]
    const n = code[i + 1]
    if (quote) {
      if (c === '\\') { out += c + (n ?? ''); i++; continue }
      if (c === quote) { quote = ''; out += "'"; continue }
      out += c
      continue
    }
    if (c === '/' && n === '/') { while (i < code.length && code[i] !== '\n') i++; out += '\n'; continue }
    if (c === '/' && n === '*') { i += 2; while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) i++; i++; continue }
    if (c === "'" || c === '"' || c === '`') { quote = c; out += "'"; continue }
    out += c
  }
  return out
}

// 分片清单必须与源码集合**相等**：清单是手写的，而 tsconfig 的 include 是 `src/**/*.ts`。
// 从前新加一个文件却忘了进清单 ⇒ 构建 exit 0、产物里根本没有它（连 console 守门都绕过）。
// 这两条必须排在拼接之前：清单里多写一个不存在的文件时，先给一句说得清的拒绝，而不是 ENOENT。
function expectPartsCover(id, label, dir, parts) {
  const declared = parts.map((p) => p.slice(dir.length + 1)).sort()
  const source = walkTs(dir).map((p) => p.slice(dir.length + 1).replace(/\.ts$/, '.js')).sort()
  expect(id, declared.join(',') === source.join(','),
    `${label} 与 ${dir} 下的 .ts 文件集合不相等（新文件不加进分片清单就不会参与构建）\n` +
    `        清单：${declared.join(', ') || '（空）'}\n        实际：${source.join(', ') || '（空）'}`)
}
expectPartsCover('parts-cover-host', 'HOST_PARTS', 'src/host', HOST_PARTS)
expectPartsCover('parts-cover-client', 'UI_PARTS', 'src/client', UI_PARTS)

// 拼接顺序承诺：分片间靠函数声明提升共享同一段作用域，所以调用方向决定了谁必须在谁之后。
// 从前这只是一句注释（交换顺序照样 exit 0），这里把它变成真断言。
const after = (later, earlier) => HOST_PARTS.indexOf(later) > HOST_PARTS.indexOf(earlier)
expect('parts-order-drift', after('src/host/drift.js', 'src/host/notes.js'),
  'HOST_PARTS 顺序破了：drift 必须在 notes 之后（它复用 notes 的 writeSidecarJson）')
expect('parts-order-history', after('src/host/history.js', 'src/host/document.js'),
  'HOST_PARTS 顺序破了：history 必须在 document 之后（它读 doc / lastChange / serializeDoc）')

/** 插件身份：cordis_define 用的元信息。 */
const PLUGIN = {
  name: '架构画布 Arch Canvas',
  purpose:
    '人与 AI 共用同一张 Mermaid 架构图：用户在右侧栏画布上直接拖拽/连线/改属性，AI 通过 arch_read / arch_write / arch_edit 读写同一份文本，' +
    '每一步都能在上下文里看到当前图，AI 改过的节点还会在画布上高亮。坐标以 %% @pos 注释保存，所以文件仍是可移植的纯 Mermaid。' +
    '浏览器界面与宿主逻辑都在项目里，Package 只是两段引导层。',
  idPrefix: 'archc',
  /** 复用已定义的 pluginId 时填这里（优先于 idPrefix）。 */
  existingPluginId: 'archcv-1',
}

/** 宿主逻辑：分片是 apply(ctx) 的函数体，这里套出插件对象。 */
const hostLogic = ['return {', '  apply: function (ctx) {', ...HOST_PARTS.map(hostOut), '  },', '}', ''].join('\n')

/** 界面本体：普通脚本，末了把 install 挂到全局。 */
const ui = [
  '// arch-canvas 浏览器界面 —— 由 host 从 <项目>/dist/ui.js 现读现发。',
  '// 依赖由 Package 的引导层经 globalThis.__archCanvasDeps 递进来（<script> 标签没法传参）。',
  '(function () {',
  'var __deps = globalThis.__archCanvasDeps || {}',
  'var React = __deps.React',
  'var host = __deps.host',
  'var styles = __deps.styles',
  'var __rpc = __deps.rpc',
  ...UI_PARTS.map(clientOut),
  'globalThis.__archCanvas = {',
  '  install: function (ctx) {',
  "    if (!React || !styles) throw new Error('arch-canvas ui: 缺少依赖 React/styles')",
  '    if (typeof __rpc === \'function\') RPC = __rpc',
  '    return registerAll(ctx)',
  '  },',
  '}',
  '})()',
  '',
].join('\n')

// 源码结尾是 `var __plugin = {...}` —— 那个 return 在这里补（片段不能有顶层 return）
// 开发形态的引导层把项目路径写死成源码里的本机字面量（见 AGENTS「包内资源与数据目录都不要写死本机路径」）。
// 在 worktree / 克隆里那个字面量不是**本次构建的根**：引导层会去读另一个目录的 dist/host.js，
// 于是 host-loader.e2e.mjs 直接红（桩 fs 只认本次构建的产物）、动态形态加载的也是别人的代码。
// 构建期把 PROJECT 对齐到本次构建的根；主仓库里这一句是 no-op（字面量本来就等于根）。
// 引号沿用源码里的单引号形式（host-loader.e2e.mjs 的负向对照靠 `var PROJECT = '…'` 这个形状改坏路径）。
const quoteSingle = (s) => "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"
const bootstrapHost = hostOut('src/bootstrap/host.js')
  .replace(/var PROJECT = '[^']*'/, 'var PROJECT = ' + quoteSingle(ROOT)) + '\nreturn __plugin\n'
const bootstrapClient = clientOut('src/bootstrap/client.js') + '\nreturn __plugin\n'

/** Package 的两半都是「返回插件的函数体」，检查方式与 runner 的求值方式一致。 */
function checkBody(label, code) {
  try {
    new vm.Script(`(async () => {\n${code}\n})()`, { filename: `cordis-dyn-${label}.js` })
  } catch (error) {
    console.error(`✗ ${label} 语法错误：${error.message}`)
    process.exit(1)
  }
}

/** 宿主逻辑是被引导层 eval 的 —— 检查时同样按工厂函数体验证，而不是当脚本。 */
function checkHostLogic(code) {
  try {
    new vm.Script(`(function (ctx, harness, hostEnv) {\n${code}\n})`, { filename: 'arch-canvas-host.js' })
  } catch (error) {
    console.error(`✗ dist/host.js 语法错误：${error.message}`)
    process.exit(1)
  }
}

function checkScript(label, code) {
  try {
    new vm.Script(code, { filename: label })
  } catch (error) {
    console.error(`✗ ${label} 语法错误：${error.message}`)
    process.exit(1)
  }
}

function expect(id, cond, message) {
  structuralGuardIds.push(id)
  if (!cond) {
    console.error('✗ [' + id + '] ' + message)
    process.exit(1)
  }
}

checkHostLogic(hostLogic)
checkScript('ui.js', ui)
checkBody('bootstrap-host', bootstrapHost)
checkBody('bootstrap-client', bootstrapClient)

// 结构性断言：防止把该放磁盘的代码又搬回 Package，或两边接错。
//
// 判据一律在 `codeOnly(...)`（去注释 + 归一引号）之后用**精确形态**匹配：
//   从前 `ui.includes('function registerAll')` 这类子串匹配，把 `registerAll` 改名成
//   `registerAllRenamed` 照样通过（构建 exit 0），而面板一加载就 `ReferenceError: registerAll is not defined`；
//   `globalThis.__archCanvas` 也会被旁边的 `__archCanvasDeps` 顺带满足。
// 每条都有稳定 id，负向对照在 test/build-guards.mjs（按 id 登记，缺一条就红）。
const uiCode = codeOnly(ui)
const bootstrapHostCode = codeOnly(bootstrapHost)
const bootstrapClientCode = codeOnly(bootstrapClient)
const hostLogicCode = codeOnly(hostLogic)

expect('ui-registerAll', /\bfunction\s+registerAll\s*\(/.test(uiCode),
  'ui.js 里没有 registerAll —— 检查 src/client/register.js')
expect('ui-export', /globalThis\.__archCanvas\s*=\s*\{/.test(uiCode), 'ui.js 没有导出 __archCanvas')
expect('shell-client-no-ui-code', !/\bfunction\s+ArchStudio\s*\(/.test(bootstrapClientCode), 'bootstrap-client 里混进了界面代码')
expect('shell-host-no-ui-code', !/\bfunction\s+ArchStudio\s*\(/.test(bootstrapHostCode), 'bootstrap-host 里混进了界面代码')
// 判据取「只有真宿主逻辑里才有的东西」：引导层也会转发 harness.defineTool，那不是实现。
expect('shell-host-no-host-logic', !/\bonRpc\s*\(\s*'doc:get'/.test(bootstrapHostCode), 'bootstrap-host 里混进了宿主逻辑')
expect('host-rpc-ui-info', /\bonRpc\s*\(\s*'ui:info'/.test(hostLogicCode), 'dist/host.js 里没有 ui:info RPC')
expect('host-route-ui', /\bonRoute\s*\(\s*'\/arch-canvas\/ui\.js'/.test(hostLogicCode), 'dist/host.js 没有登记 ui.js 路由')
expect('host-route-mermaid', /\bonRoute\s*\(\s*'\/arch-canvas\/mermaid\.min\.js'/.test(hostLogicCode), 'dist/host.js 没有登记 mermaid 路由')
expect('host-no-webserver-snapshot', !/\bctx\.get\s*\(\s*'webServer'/.test(hostLogicCode), 'dist/host.js 又去给 webServer 取快照了 —— 那是个不报错的哑故障')
expect('shell-host-points-dist', /\/dist\/host\.js/.test(bootstrapHostCode), 'bootstrap-host 没有指向 dist/host.js')
expect('package-host-inject', /inject\s*:\s*\[\s*'fs'\s*,\s*'tools'\s*,\s*'systemPrompt'\s*\]/.test(codeOnly(hostOut('src/package/host.js'))),
  'lib/index.js 少了 inject 声明')

// 这个插件对 console **一字不吐**：挂载播报、加载成功之类全是正常操作噪音
// （hmr 每次 `npm run build` 都会重新挂一遍，一行变一屏），故障一律抛错让宿主去报。
// 扫 `src/**/*.ts` 全部源码而不是几个分片：分片清单漏掉的文件从前能整个绕过这条守门。
//
// 判据按**标识符**判，不要求后面跟着 `.`：`console['log']('noise')` 与 `console.log(...)` 是同一件事，
// 只认字面 `.` 就是留一个后门（实测 `console['log']` 能过）。`\b` 让 `consoleX` 这类名字不算。
// 扫的是 codeOnly：注释里写「本插件对 console 一字不吐」不算违规。
const CONSOLE_IDENT = /\bconsole\b/
const noisy = walkTs('src').filter((rel) => CONSOLE_IDENT.test(codeOnly(read(rel))))
expect('no-console', noisy.length === 0,
  '这些文件里出现了 console 调用（本插件不许往 console 写东西，改用 throw）：' + noisy.join(', '))

// Node 专属全局只属于 `src/package/host.ts`（真 Node 半边）：`types/sandbox.d.ts` 的声明与
// `src/host/**` 同处一个 tsc 程序，所以在 `src/host/*` 里写 `process.env` / `require(...)` 也能过类型检查。
// 动态 Package 形态的 host 沙箱里没有它们（见 AGENTS「沙箱里没有的东西」），用了就是装机形态才活。
//
// 同样按标识符判：`process['env']` 与 `process.env` 是同一件事（实测前者能过）。
// `src/host/**` 现状：这些词只出现在注释里（plugin.ts 那句 __dirname），codeOnly 之后一个都不剩。
const NODE_ONLY = /\brequire\b|\bprocess\b|\bBuffer\b|__dirname/
const leaked = walkTs('src/host').filter((rel) => NODE_ONLY.test(codeOnly(read(rel))))
expect('host-no-node-globals', leaked.length === 0,
  'src/host/* 里出现了 Node 专属全局（动态形态的沙箱没有 process / require / Buffer / __dirname）：' + leaked.join(', '))

mkdirSync(join(ROOT, 'dist'), { recursive: true })
writeFileSync(join(ROOT, 'dist/host.js'), hostLogic)
writeFileSync(join(ROOT, 'dist/ui.js'), ui)
// 解析器单独出一份：test/mermaid.test.cjs 要跑**当前构建**的解析器，
// 而不是 /tmp 下一份会腐烂的手工快照。
writeFileSync(join(ROOT, 'dist/mermaid.js'), hostOut('src/host/mermaid.js'))
// 客户端那半的**纯函数**也单独出一份：test/layout.test.cjs 要跑当前构建的自动布局，
// 而 lib/ui.js 里那些函数活在闭包里（它只把 install 挂出去），测试够不着。
writeFileSync(join(ROOT, 'dist/client-runtime.js'), clientOut('src/client/runtime.js'))
writeFileSync(join(ROOT, 'dist/bootstrap-host.js'), bootstrapHost)
writeFileSync(join(ROOT, 'dist/bootstrap-client.js'), bootstrapClient)

const payload = {
  name: PLUGIN.name,
  purpose: PLUGIN.purpose,
  plugin: PLUGIN.existingPluginId
    ? { kind: 'existing', pluginId: PLUGIN.existingPluginId }
    : { kind: 'new', idPrefix: PLUGIN.idPrefix },
  code: { host: bootstrapHost, client: bootstrapClient },
}
writeFileSync(join(ROOT, 'dist/payload.json'), JSON.stringify(payload, null, 2) + '\n')

// ---------- 真插件形态：lib/ ----------
// 宿主逻辑本体导出「工厂」：把 harness 适配器递进去，拿回 Cordis 插件对象。
// 于是同一份 src/host/* 既能被动态 Package 用（外层套 return/apply），
// 也能被真插件 require（lib/index.js 传 harness 进去）。
const libHostLogic = [
  "'use strict'",
  '// 由 tools/build.mjs 从 src/host/*.js 生成 —— 不要手改这个文件。',
  '// 导出工厂：module.exports(harness, hostEnv) → Cordis 插件对象。',
  'module.exports = function (harness, hostEnv) {',
  hostLogic,
  '}',
  '',
].join('\n')

checkScript('lib/host-logic.js', libHostLogic)
checkScript('lib/index.js', hostOut('src/package/host.js'))
checkScript('lib/client.js', clientOut('src/package/client.js'))

mkdirSync(join(ROOT, 'lib'), { recursive: true })
writeFileSync(join(ROOT, 'lib/host-logic.js'), libHostLogic)
writeFileSync(join(ROOT, 'lib/index.js'), hostOut('src/package/host.js'))
writeFileSync(join(ROOT, 'lib/client.js'), clientOut('src/package/client.js'))
copyFileSync(join(ROOT, 'dist/ui.js'), join(ROOT, 'lib/ui.js'))

// ---------- 随包资源：mermaid ----------
// mermaid 是运行时必需的（3.5 MB 单个 UMD 文件）。与其作为 npm 依赖再解析路径，不如构建期
// 拷进包里：装机即有，不依赖缓存或安装期网络。来源依次为 node_modules、早期缓存、已提交的那份。
const MERMAID_DEST = join(ROOT, 'assets', 'mermaid.min.js')
const MERMAID_SOURCES = [
  join(ROOT, 'node_modules', 'mermaid', 'dist', 'mermaid.min.js'),
  join(DSH_HOME, '.cache', 'arch-canvas', 'mermaid.min.js'),
  MERMAID_DEST,
]
const mermaidSrc = MERMAID_SOURCES.find((p) => p && existsSync(p))
if (mermaidSrc === undefined) {
  console.error('✗ 找不到 mermaid.min.js：npm i -D mermaid，或确认 $DSH_HOME（缺省 ~/.dsh）/.cache/arch-canvas/mermaid.min.js')
  process.exit(1)
}
mkdirSync(join(ROOT, 'assets'), { recursive: true })
if (mermaidSrc !== MERMAID_DEST) copyFileSync(mermaidSrc, MERMAID_DEST)

const kb = (s) => (Buffer.byteLength(s, 'utf8') / 1024).toFixed(1).padStart(6) + ' KB'
const lines = (s) => String(s.split('\n').length).padStart(5)
console.log(`   磁盘上的真身（改这些，不用重新 define）`)
console.log(`     dist/host.js            ${lines(hostLogic)} 行 ${kb(hostLogic)}`)
console.log(`     dist/ui.js              ${lines(ui)} 行 ${kb(ui)}`)
console.log(`   Package 的两半（基本不变）`)
console.log(`     dist/bootstrap-host.js  ${lines(bootstrapHost)} 行 ${kb(bootstrapHost)}   ← code.host`)
console.log(`     dist/bootstrap-client.js ${lines(bootstrapClient)} 行 ${kb(bootstrapClient)}   ← code.client`)
console.log(`   dist/payload.json 已生成（可直接作为 cordis_define 的参数）`)
console.log('  真插件形态（dsh plugin --profile web add 用这个）')
console.log(`     lib/index.js            ${lines(read('lib/index.js'))} 行 ${kb(read('lib/index.js'))}`)
console.log(`     lib/host-logic.js       ${lines(libHostLogic)} 行 ${kb(libHostLogic)}`)
console.log(`     lib/client.js           ${lines(read('lib/client.js'))} 行 ${kb(read('lib/client.js'))}`)
console.log(`     lib/ui.js               ${lines(ui)} 行 ${kb(ui)}`)
console.log(`     assets/mermaid.min.js   ${kb(readFileSync(join(ROOT, 'assets', 'mermaid.min.js'), 'utf8'))}   ← 随包分发（来源 ${mermaidSrc}）`)
console.log(`   构建期守门：结构性断言 ${structuralGuardIds.length} 条全部通过（ids: ${structuralGuardIds.join(', ')}）`)

/**
 * 本次构建的改动**怎么生效** —— 取决于本机 profile 装的是链接还是快照。
 * 实测踩过：快照（`file:...tgz` → 真目录）下 hmr 重挂的是**快照里**的 lib/index.js，
 * 日志里照样多一条 `plugin.mount`，代码却还是旧的。所以这行提示必须看部署形态给。
 */
function deploymentAdvice() {
  const profileDir = join(DSH_HOME, 'profiles', 'web')
  let spec = ''
  try {
    const pkg = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
    spec = (pkg.dependencies && pkg.dependencies['arch-canvas']) ||
      (pkg.devDependencies && pkg.devDependencies['arch-canvas']) || ''
  } catch (error) {
    return `读不到 ${profileDir}/package.json —— 这份构建还没被本机 profile 引用：client 刷新页面、host 重装并重启 dsh。`
  }
  if (!spec) return `本机 profile 没引用 arch-canvas：部署它之后，host 改动要重装包并重启 dsh。`
  let linked = false
  try { linked = lstatSync(join(profileDir, 'node_modules', 'arch-canvas')).isSymbolicLink() } catch (error) {}
  if (linked || spec.startsWith('link:')) {
    return `部署形态：链接（${spec}）—— host 改动 build 后由 hmr 重挂、client 改动 build 后刷新页面；` +
      '验活要打一次真 RPC，`plugin.mount` 不算证据。'
  }
  return `部署形态：快照（${spec}）—— host 改动要 build → 拷 lib/*.js 进安装目录（或重装 tgz）→ **重启 dsh**；` +
    'client 改动拷 lib/ui.js 后刷新页面。日志里的 `plugin.mount` 只是把旧快照又挂了一遍，不能当生效证据。'
}
console.log('   ' + deploymentAdvice())
