// 构建守门人的**负向对照**：`tools/build.mjs` 里每一条结构性断言，都要能被一处真实违规触发。
//
// 做法：把这次构建需要的东西拷进一个临时目录（`node_modules` 软链回本仓库），
// 在副本里注入一处违规、跑 `node tools/build.mjs`，断言 **退出码非 0** 且打出了**那一条**守门消息。
// 光断言「exit≠0」不够：tsc 报错也会 exit≠0，那证明不了守门人本身有牙。
//
// 三件事机器可查：
//   1. **id 清单一一对应。** 构建成功时打 `结构性断言 N 条全部通过（ids: …）`；下面 CONTROLS 按 id 登记。
//      构建里有、表里没有 → 红（这条断言没有负向对照）；表里有、构建里没有 → 红（改名/删了没同步）。
//      从前只报「17 条」—— 哪几条有对照没人查得出来，实测有 8 条根本没有。
//   2. **注入的是真代码。** 注释型文本不算违规（见文末「误伤对照」）—— 从前三条 bootstrap 对照注入的
//      都是注释，证明的只是「守门人会匹配注释文本」；真代码（`onRpc("doc:get", …)` 双引号）反而绕过。
//   3. **判据归一引号、去注释**：`"doc:get"` / `'doc:get'`、`process['env']` / `process.env` 是同一件事。
import { cpSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

let pass = 0
let fail = 0
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')) }
}

/** 构建需要的最小副本：源码、构建脚本、类型、两个 tsc 程序；依赖软链回本仓库。 */
function sandboxCopy(mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'arch-build-guard-'))
  for (const entry of ['src', 'tools', 'types', 'tsconfig.host.json', 'tsconfig.client.json']) {
    cpSync(join(ROOT, entry), join(dir, entry), { recursive: true })
  }
  symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'), 'dir')
  if (mutate) mutate(dir)
  return dir
}

function buildIn(dir) {
  const res = spawnSync(process.execPath, ['tools/build.mjs'], { cwd: dir, encoding: 'utf8' })
  return { status: res.status, out: (res.stdout || '') + (res.stderr || '') }
}

/** 跑一个「必须失败」的用例，并核对失败原因确实是那一条守门消息（含它自己的 id）。 */
function expectBlocked(name, mutate, needle) {
  const dir = sandboxCopy(mutate)
  try {
    const { status, out } = buildIn(dir)
    const hit = out.includes(needle)
    ok(name + ' → 构建被拦下', status !== 0 && hit,
      status === 0 ? 'exit 0（守门人没拦住）' : (hit ? undefined : 'exit ' + status + '，但原因不是这条：' + out.split('\n').slice(-6).join(' / ')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** 跑一个「必须通过」的对照，确认守门人不会对着合法代码误报。 */
function expectPasses(name, mutate) {
  const dir = sandboxCopy(mutate)
  try {
    const { status, out } = buildIn(dir)
    ok(name + ' → 构建通过', status === 0, status === 0 ? undefined : out.split('\n').slice(-6).join(' / '))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** 读源码、就地做一次字符串替换后写回 —— 注入的都是**真代码**。 */
const edit = (dir, rel, from, to) => {
  const p = join(dir, rel)
  const code = readFileSync(p, 'utf8')
  if (!code.includes(from)) throw new Error('对照失效：' + rel + ' 里找不到 ' + JSON.stringify(from))
  writeFileSync(p, code.replace(from, to))
}
const append = (dir, rel, code) => appendFileSync(join(dir, rel), code)

// ---------------------------------------------------------------------------
// 对照表：id → [[用例名, 注入真违规, 必须出现的守门消息], …]
// 每个 id 至少一条；id 与 tools/build.mjs 里 expect(id, …) 的第一个参数逐字相同。
// ---------------------------------------------------------------------------
const CONTROLS = {
  'parts-cover-host': [
    ['src/host 新文件不进 HOST_PARTS（含 console.log + export default）',
      (dir) => writeFileSync(join(dir, 'src/host/rogue.ts'),
        "// 守门人负向对照探针\nexport default true\nconsole.log('rogue')\n"),
      'HOST_PARTS 与 src/host'],
    ['src/host 新文件不含 console 也不进 HOST_PARTS',
      (dir) => writeFileSync(join(dir, 'src/host/quiet.ts'), 'var quiet = 1\n'),
      'HOST_PARTS 与 src/host'],
    ['分片清单里多写一个不存在的文件',
      (dir) => edit(dir, 'tools/build.mjs', "'src/host/mermaid.js',", "'src/host/mermaid.js',\n  'src/host/ghost.js',"),
      'HOST_PARTS 与 src/host'],
  ],
  'parts-cover-client': [
    ['src/client 新文件不进 UI_PARTS',
      (dir) => writeFileSync(join(dir, 'src/client/rogue.ts'), 'var rogue = 1\n'),
      'UI_PARTS 与 src/client'],
  ],
  'parts-order-drift': [
    ['HOST_PARTS 里 drift 挪到 notes 之前',
      (dir) => {
        const p = join(dir, 'tools/build.mjs')
        const code = readFileSync(p, 'utf8')
        writeFileSync(p, code
          .replace("'src/host/drift.js'", "'src/host/__swap__.js'")
          .replace("'src/host/notes.js'", "'src/host/drift.js'")
          .replace("'src/host/__swap__.js'", "'src/host/notes.js'"))
      },
      'HOST_PARTS 顺序破了'],
  ],
  'parts-order-history': [
    ['HOST_PARTS 里 history 挪到 document 之前',
      (dir) => {
        const p = join(dir, 'tools/build.mjs')
        const code = readFileSync(p, 'utf8')
        writeFileSync(p, code
          .replace("'src/host/history.js'", "'src/host/__swap__.js'")
          .replace("'src/host/document.js'", "'src/host/history.js'")
          .replace("'src/host/__swap__.js'", "'src/host/document.js'"))
      },
      'HOST_PARTS 顺序破了'],
  ],
  // 实测的洞：旧判据是 `ui.includes('function registerAll')`，改名成 registerAllRenamed 照样 exit 0，
  // 而 ui.render.mjs 一加载就 ReferenceError: registerAll is not defined（整个面板不可用）。
  'ui-registerAll': [
    ['registerAll 改名成 registerAllRenamed（子串匹配时代能绕过）',
      (dir) => edit(dir, 'src/client/register.ts', 'function registerAll(', 'function registerAllRenamed('),
      '没有 registerAll'],
  ],
  // 实测的洞：旧判据 `includes('globalThis.__archCanvas')` 会被同文件里的 `__archCanvasDeps` 满足。
  'ui-export': [
    ['导出改名成 globalThis.__archCanvasX',
      (dir) => edit(dir, 'tools/build.mjs', 'globalThis.__archCanvas = {', 'globalThis.__archCanvasX = {'),
      '没有导出 __archCanvas'],
  ],
  'shell-client-no-ui-code': [
    ['bootstrap-client 注入真函数体 function ArchStudio() {}',
      (dir) => append(dir, 'src/bootstrap/client.ts', '\nfunction __probeShellClient() { function ArchStudio() {} }\n'),
      'bootstrap-client 里混进了界面代码'],
  ],
  'shell-host-no-ui-code': [
    ['bootstrap-host 注入真函数体 function ArchStudio() {}',
      (dir) => append(dir, 'src/bootstrap/host.ts', '\nfunction ArchStudio() {}\n'),
      'bootstrap-host 里混进了界面代码'],
  ],
  // 实测的洞：真代码 `onRpc("doc:get", …)`（双引号）能绕过单引号字面量判据。
  'shell-host-no-host-logic': [
    ['bootstrap-host 注入真代码 onRpc("doc:get", …)（双引号）',
      (dir) => append(dir, 'src/bootstrap/host.ts', '\nonRpc("doc:get", function () { return 1 })\n'),
      'bootstrap-host 里混进了宿主逻辑'],
  ],
  'host-rpc-ui-info': [
    ['ui:info RPC 改名',
      (dir) => edit(dir, 'src/host/plugin.ts', "onRpc('ui:info'", "onRpc('ui:info-x'"),
      '没有 ui:info RPC'],
  ],
  'host-route-ui': [
    ['ui.js 路由没登记',
      (dir) => edit(dir, 'src/host/plugin.ts', "onRoute('/arch-canvas/ui.js'", "onRoute('/arch-canvas/ui-x.js'"),
      '没有登记 ui.js 路由'],
  ],
  'host-route-mermaid': [
    ['mermaid 路由没登记',
      (dir) => edit(dir, 'src/host/plugin.ts', "onRoute('/arch-canvas/mermaid.min.js'", "onRoute('/arch-canvas/mermaid-x.min.js'"),
      '没有登记 mermaid 路由'],
  ],
  // 实测的洞：旧判据只认 `ctx.get('webServer')` 单引号形态，双引号变体绕过。
  'host-no-webserver-snapshot': [
    ['宿主逻辑里出现 ctx.get("webServer")（双引号）',
      (dir) => append(dir, 'src/host/plugin.ts', 'var __wsProbe = ctx.get("webServer")\n'),
      'webServer 取快照'],
  ],
  'shell-host-points-dist': [
    ['bootstrap-host 不再指向 dist/host.js',
      (dir) => edit(dir, 'src/bootstrap/host.ts', "'/dist/host.js'", "'/dist/host-x.js'"),
      '没有指向 dist/host.js'],
  ],
  'package-host-inject': [
    ['lib/index.js 的 inject 声明少了 systemPrompt',
      (dir) => edit(dir, 'src/package/host.ts', "inject: ['fs', 'tools', 'systemPrompt']", "inject: ['fs', 'tools']"),
      '少了 inject 声明'],
  ],
  'no-console': [
    ['已列进清单的分片里出现 console.log',
      (dir) => append(dir, 'src/host/log.ts', "console.log('noise')\n"),
      '出现了 console 调用'],
    // 实测的洞：旧判据要求字面 `.`，`console['log']` 完全绕过。
    ['console[\'log\'] 计算属性调用（要求字面 `.` 的时代能绕过）',
      (dir) => append(dir, 'src/host/mermaid.ts', "console['log']('noise')\n"),
      '出现了 console 调用'],
    ['新文件补进清单后，console 守在源码层而不是只守产物',
      (dir) => {
        writeFileSync(join(dir, 'src/host/rogue.ts'), "console.error('rogue')\n")
        edit(dir, 'tools/build.mjs', "'src/host/plugin.js',", "'src/host/plugin.js',\n  'src/host/rogue.js',")
      },
      '出现了 console 调用'],
  ],
  'host-no-node-globals': [
    ['src/host/document.ts 里写 process.env',
      (dir) => append(dir, 'src/host/document.ts', 'var probeHome = process.env.HOME\n'),
      'Node 专属全局'],
    // 实测的洞：旧判据 `\bprocess\s*\.` 只认点号，计算属性绕过。
    ['process[\'env\'] 计算属性访问（要求点号的时代能绕过）',
      (dir) => append(dir, 'src/host/document.ts', "var probeEnv = process['env'].HOME\n"),
      'Node 专属全局'],
    ['src/host/document.ts 里写 require(...)',
      (dir) => append(dir, 'src/host/document.ts', "var probeFs = require('node:fs')\n"),
      'Node 专属全局'],
    ['src/host/document.ts 里写 Buffer',
      (dir) => append(dir, 'src/host/document.ts', "var probeBuf = Buffer.from('x')\n"),
      'Node 专属全局'],
    ['src/host/document.ts 里写 __dirname',
      (dir) => append(dir, 'src/host/document.ts', 'var probeDir = __dirname\n'),
      'Node 专属全局'],
  ],
}

// ---------------------------------------------------------------------------
// 正对照：干净副本构建通过，并解析出 id 清单
// ---------------------------------------------------------------------------
console.log('【正对照：干净副本】')
let builtIds = []
{
  const dir = sandboxCopy(null)
  try {
    const { status, out } = buildIn(dir)
    ok('正对照：干净副本构建通过', status === 0, status === 0 ? undefined : out.split('\n').slice(-6).join(' / '))
    const line = out.split('\n').find((l) => l.includes('结构性断言') && l.includes('ids:'))
    ok('正对照：构建输出打印了结构性断言的 id 清单', Boolean(line), out.split('\n').filter((l) => l.includes('结构性断言')))
    const m = line && line.match(/ids:\s*([^）]*)/)
    builtIds = m ? m[1].split(',').map((s) => s.trim()).filter(Boolean) : []
    ok('正对照：id 解析出 ' + builtIds.length + ' 条且互不重复',
      builtIds.length > 0 && new Set(builtIds).size === builtIds.length, builtIds)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
// 对照表与 id 清单必须一一对应
// ---------------------------------------------------------------------------
console.log('\n【每个结构性断言 id 都要有负向对照（机器可查）】')
const missingControls = builtIds.filter((id) => !CONTROLS[id])
ok('构建里的每个 id 都在对照表里登记了', missingControls.length === 0,
  missingControls.length ? '没有负向对照的 id：' + missingControls.join(', ') : undefined)
const unknownIds = Object.keys(CONTROLS).filter((id) => !builtIds.includes(id))
ok('对照表里没有构建里不存在的 id（改名/删断言要同步）', unknownIds.length === 0,
  unknownIds.length ? '多余的对照：' + unknownIds.join(', ') : undefined)

// ---------------------------------------------------------------------------
// 逐 id 跑负向对照
// ---------------------------------------------------------------------------
for (const id of builtIds) {
  const cases = CONTROLS[id]
  if (!cases) continue
  console.log(`\n【${id}】`)
  for (const [name, mutate, needle] of cases) expectBlocked(name, mutate, needle)
}

// ---------------------------------------------------------------------------
// 误伤对照：这些词出现在**注释**里是合法的（判据先 codeOnly 去注释再匹配）。
// ---------------------------------------------------------------------------
console.log('\n【误伤对照：注释里出现同样的词不算违规】')
expectPasses('Node 全局只出现在注释里（src/host/plugin.ts 现状就是）',
  (dir) => append(dir, 'src/host/document.ts',
    '// probe: 这里提到 __dirname / process.env / Buffer / require(x) 都不算违规\n'))
expectPasses('console 只出现在注释里',
  (dir) => append(dir, 'src/host/log.ts',
    "// probe: 这里提到 console.log / console['log'] 都不算违规\n"))
expectPasses('bootstrap-host 注释里提到 onRpc(\'doc:get\')（旧判据会在这里误报）',
  (dir) => append(dir, 'src/bootstrap/host.ts', "// 引导层不实现 onRpc('doc:get')\n"))
expectPasses('bootstrap-host 注释里提到 function ArchStudio() {}',
  (dir) => append(dir, 'src/bootstrap/host.ts', '// probe: function ArchStudio() {}\n'))
expectPasses('bootstrap-client 注释里提到 function ArchStudio() {}',
  (dir) => append(dir, 'src/bootstrap/client.ts', '// probe: function ArchStudio() {}\n'))

console.log('')
console.log(`结构性断言 id：${builtIds.length} 个，全部有负向对照`)
console.log('结果: ' + pass + ' 通过 / ' + fail + ' 失败')
process.exit(fail === 0 ? 0 : 1)
