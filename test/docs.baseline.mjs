// 测试基线：README / PROJECT_STATE 里的断言数 **由测试自己报**，不手抄。
//
// 这个文件是 `npm test` 的入口，做四件事：
//   1. **覆盖断言**：`test/` 下实际存在的测试文件 == SUITES ∪ GATES ∪ 本文件。清单是手写的，
//      从前新加一个 `test/xxx.mjs` 永远不会被跑到（放一个必然失败的进去，`npm test` 照样 EXIT=0）。
//   2. 按顺序跑各个测试、收集每个文件结尾自己打印的通过条数（`结果: N 通过 / M 失败` 或
//      `全部通过：N / N`），再断言两份文档里的基线行 == 实测。
//   3. 跑**门禁**（`tools.schema.mjs`）：它按退出码判定成败、不进条数合计，但必须真被跑到 ——
//      从前它不在 `npm test` 里，输出尾行却硬编码着「工具 schema 全通过」，那句话当时无人验证。
//   4. 基线行核对：**每份文档恰好一行**（从前用 `find()` 只看第一条，追加第二条假基线也照样绿）。
//      「改了测试忘了改文档」和「两份文档各说各话」都当场变红 —— 红的时候直接把该贴的那一行打出来。
//
// 为什么不让测试文件自己写 `@@ASSERTIONS`：那些文件分属别的改动面，这里只做「采集」，
// 不往它们里面加东西；它们的汇总行本来就是机器可读的，采集比复制一份真相更稳。
import { readFileSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** 顺序就是打印顺序；`label` 是两份文档里必须逐字出现的套件名。 */
const SUITES = [
  { label: '解析器', file: 'test/mermaid.test.cjs' },
  { label: '布局', file: 'test/layout.test.cjs' },
  { label: '连线几何', file: 'test/edges.test.cjs' },
  { label: '宿主', file: 'test/host.e2e.mjs' },
  { label: '引导层', file: 'test/host-loader.e2e.mjs' },
  { label: '插件挂载', file: 'test/plugin-mount.e2e.mjs' },
  { label: '配置卡', file: 'test/client-config-card.mjs' },
  { label: '构建守门人', file: 'test/build-guards.mjs' },
  { label: '界面渲染', file: 'test/ui.render.mjs' },
]

/**
 * 门禁：**不进**「断言条数」的合计（它按退出码判定成败），但必须真被跑到、失败必须让这里红。
 * `npm run check` 第三段还会单独跑一次 `test:schema` —— 重复跑没关系（它很快，不 build）。
 */
const GATES = [
  { label: '工具 schema', file: 'test/tools.schema.mjs' },
]

/** 本文件自己：它跑自己会递归，所以从覆盖断言里排除，但仍在清单里登记。 */
const SELF = 'test/docs.baseline.mjs'

/**
 * 覆盖断言（与 `tools/build.mjs` 的 `expectPartsCover` 同形）：`test/` 下所有 `.mjs` / `.cjs`
 * 必须正好等于「SUITES 的 file ∪ GATES 的 file ∪ 本文件」。多一个少一个都报错，并把该补的清单打出来。
 * `fixtures/` 之类纯数据目录跳过（里面不会有测试）；真要有辅助 `.mjs`，就显式登记进 SUITES/GATES，
 * 别让它靠目录名豁免 —— 豁免名单一旦存在，绕过就是加个目录的事。
 */
const SKIP_TEST_DIRS = new Set(['fixtures', 'node_modules'])
function walkTestFiles(dir) {
  const out = []
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = dir + '/' + entry.name
    if (entry.isDirectory()) {
      if (!SKIP_TEST_DIRS.has(entry.name)) out.push(...walkTestFiles(rel))
    } else if (/\.(mjs|cjs)$/.test(entry.name)) out.push(rel)
  }
  return out
}

{
  const declared = [...SUITES.map((s) => s.file), ...GATES.map((g) => g.file), SELF].sort()
  const actual = walkTestFiles('test').sort()
  if (declared.join('\n') !== actual.join('\n')) {
    const missing = actual.filter((f) => !declared.includes(f))
    const ghost = declared.filter((f) => !actual.includes(f))
    console.error('✗ test/ 下的测试文件与清单不相等 —— 新增的测试文件必须进 SUITES 或 GATES，否则永远不会被跑到')
    if (missing.length) console.error('  漏在清单外（该加进 SUITES）：' + missing.join(', '))
    if (ghost.length) console.error('  清单里有、实际不存在（该删）：' + ghost.join(', '))
    process.exit(1)
  }
}

/** 从测试输出里取**最后一个**汇总行 —— 前面的行可能是子测试自己的小计。 */
function reportedCount(file, out) {
  const all = [...out.matchAll(/结果:\s*(\d+)\s*通过/g), ...out.matchAll(/全部通过：(\d+)\s*\//g)]
  if (all.length === 0) return null
  return Number(all[all.length - 1][1])
}

const counts = []
for (const suite of SUITES) {
  const res = spawnSync(process.execPath, [suite.file], { cwd: ROOT, encoding: 'utf8' })
  const out = (res.stdout || '') + (res.stderr || '')
  process.stdout.write(out.endsWith('\n') ? out : out + '\n')
  if (res.status !== 0) {
    console.error(`\n✗ ${suite.file} 退出码 ${res.status} —— 基线采集不了，先把这个测试修绿`)
    process.exit(1)
  }
  const count = reportedCount(suite.file, out)
  if (!count) {
    console.error(`\n✗ ${suite.file} 没有打印可解析的断言条数（期望结尾是「结果: N 通过」或「全部通过：N / N」）`)
    process.exit(1)
  }
  counts.push({ ...suite, count })
}

// 门禁：跑，且**只**认退出码 0。文档里那句「工具 schema 全通过」必须由这次真实执行背书。
for (const gate of GATES) {
  const res = spawnSync(process.execPath, [gate.file], { cwd: ROOT, encoding: 'utf8' })
  const out = (res.stdout || '') + (res.stderr || '')
  process.stdout.write(out.endsWith('\n') ? out : out + '\n')
  if (res.status !== 0) {
    console.error(`\n✗ ${gate.file} 退出码 ${res.status} —— 门禁没过；文档声明的「${gate.label} 全通过」不成立，基线核对不进行`)
    process.exit(1)
  }
}

const total = counts.reduce((sum, s) => sum + s.count, 0)
const canonical = counts.map((s) => `${s.label} ${s.count}`).join(' · ') +
  ` · 工具 schema 全通过 = ${total} 条断言，EXIT=0`

console.log('【测试基线：各测试自报的断言数】')
for (const s of counts) console.log(`  ${s.label.padEnd(6, '　')} ${String(s.count).padStart(4)}   ${s.file}`)
console.log(`  合计         ${String(total).padStart(4)}`)

// ---------- 文档核对：两份文档互相一致，且与实测一致 ----------
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const docs = ['README.md', 'PROJECT_STATE.md']
const problems = []

for (const rel of docs) {
  const text = readFileSync(join(ROOT, rel), 'utf8')
  // 收集**所有**基线行，不只第一条：约定就是「每份文档一行」——
  // 0 条 = 基线没了；多于 1 条 = 有人追加了一条不会被核对的假基线（从前 find() 只看第一条，第二条起永远不查）。
  const lines = text.split('\n').filter((l) => l.includes('条断言') && l.includes('EXIT=0'))
  if (lines.length === 0) {
    problems.push(`${rel}：找不到基线行（要有「条断言」与「EXIT=0」）`)
    continue
  }
  if (lines.length > 1) {
    problems.push(`${rel}：找到 ${lines.length} 条基线行 —— 每份文档只许一行（多出来的那几条不会被核对）`)
    lines.forEach((l, i) => problems.push(`    第 ${i + 1} 条：${l.trim().slice(0, 90)}`))
    continue
  }
  for (const line of lines) {
    for (const s of counts) {
      const m = line.match(new RegExp(escapeRe(s.label) + '[`*\\s:：]*?(\\d+)'))
      if (!m) problems.push(`${rel}：基线行里没有「${s.label} <条数>」（缺了套件）`)
      else if (Number(m[1]) !== s.count) problems.push(`${rel}：${s.label} 写的是 ${m[1]}，实测 ${s.count}`)
    }
    const t = line.match(/=\s*\**\s*(\d+)\s*条断言/)
    if (!t) problems.push(`${rel}：基线行里没有「= <总数> 条断言」`)
    else if (Number(t[1]) !== total) problems.push(`${rel}：总数写的是 ${t[1]}，实测 ${total}`)
  }
}

if (problems.length === 0) {
  console.log('\n文档基线核对：README.md / PROJECT_STATE.md 均与实测一致')
  console.log('基线：' + canonical)
} else {
  console.error('\n✗ 文档基线对不上（改了测试就要一起改这两份文档）：')
  for (const p of problems) console.error('  - ' + p)
  console.error('\n该贴的基线行（两份文档共用这一串数字）：')
  console.error('  ' + canonical)
  process.exit(1)
}
