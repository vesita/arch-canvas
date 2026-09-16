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
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')
const TSC = join(ROOT, 'node_modules', '.bin', 'tsc')

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
  'src/host/plugin.js',
]
const UI_PARTS = [
  'src/client/runtime.js',
  'src/client/studio.js',
  'src/client/register.js',
]

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
const bootstrapHost = hostOut('src/bootstrap/host.js') + '\nreturn __plugin\n'
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

function expect(cond, message) {
  if (!cond) {
    console.error('✗ ' + message)
    process.exit(1)
  }
}

checkHostLogic(hostLogic)
checkScript('ui.js', ui)
checkBody('bootstrap-host', bootstrapHost)
checkBody('bootstrap-client', bootstrapClient)

// 结构性断言：防止把该放磁盘的代码又搬回 Package，或两边接错
expect(ui.includes('function registerAll'), 'ui.js 里没有 registerAll —— 检查 src/client/register.js')
expect(ui.includes('globalThis.__archCanvas'), 'ui.js 没有导出 __archCanvas')
expect(!bootstrapClient.includes('function ArchStudio'), 'bootstrap-client 里混进了界面代码')
expect(!bootstrapHost.includes('function ArchStudio'), 'bootstrap-host 里混进了界面代码')
// 判据取「只有真宿主逻辑里才有的东西」：引导层现在也会转发 harness.defineTool，那不是实现。
expect(!bootstrapHost.includes("onRpc('doc:get'"), 'bootstrap-host 里混进了宿主逻辑')
expect(hostLogic.includes("onRpc('ui:info'"), 'dist/host.js 里没有 ui:info RPC')
expect(hostLogic.includes("onRoute('/arch-canvas/ui.js'"), 'dist/host.js 没有登记 ui.js 路由')
expect(hostLogic.includes("onRoute('/arch-canvas/mermaid.min.js'"), 'dist/host.js 没有登记 mermaid 路由')
expect(!hostLogic.includes("ctx.get('webServer')"), 'dist/host.js 又去给 webServer 取快照了 —— 那是个不报错的哑故障')
expect(bootstrapHost.includes('/dist/host.js'), 'bootstrap-host 没有指向 dist/host.js')
expect(hostOut('src/package/host.js').includes("inject: ['fs', 'tools', 'systemPrompt']"), 'lib/index.js 少了 inject 声明')

// 这个插件对 console **一字不吐**：挂载播报、加载成功之类全是正常操作噪音
// （hmr 每次 `npm run build` 都会重新挂一遍，一行变一屏），故障一律抛错让宿主去报。
// 放在构建期守，比等到测试早一步，也覆盖两个半边 + 两种形态。
const NOISY_CALL = /\bconsole\s*\.\s*(log|error|warn|info|debug|trace)\s*\(/
const noisy = []
for (const rel of HOST_PARTS) if (NOISY_CALL.test(hostOut(rel))) noisy.push(rel)
for (const rel of UI_PARTS) if (NOISY_CALL.test(clientOut(rel))) noisy.push(rel)
for (const rel of ['src/bootstrap/host.js', 'src/package/host.js']) if (NOISY_CALL.test(hostOut(rel))) noisy.push(rel)
for (const rel of ['src/bootstrap/client.js', 'src/package/client.js']) if (NOISY_CALL.test(clientOut(rel))) noisy.push(rel)
expect(noisy.length === 0, '这些文件里出现了 console 调用（本插件不许往 console 写东西，改用 throw）：' + noisy.join(', '))

mkdirSync(join(ROOT, 'dist'), { recursive: true })
writeFileSync(join(ROOT, 'dist/host.js'), hostLogic)
writeFileSync(join(ROOT, 'dist/ui.js'), ui)
// 解析器单独出一份：test/mermaid.test.cjs 要跑**当前构建**的解析器，
// 而不是 /tmp 下一份会腐烂的手工快照。
writeFileSync(join(ROOT, 'dist/mermaid.js'), hostOut('src/host/mermaid.js'))
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
  join(process.env.HOME ?? '', '.dsh', '.cache', 'arch-canvas', 'mermaid.min.js'),
  MERMAID_DEST,
]
const mermaidSrc = MERMAID_SOURCES.find((p) => p && existsSync(p))
if (mermaidSrc === undefined) {
  console.error('✗ 找不到 mermaid.min.js：npm i -D mermaid，或确认 ~/.dsh/.cache/arch-canvas/mermaid.min.js')
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
