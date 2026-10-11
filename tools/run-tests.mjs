#!/usr/bin/env node
// tools/run-tests.mjs
//
// 一条命令跑完**全套真测试**。
//
// 为什么需要它：`npm run check` 只有 `tsc` + 两次 build + `docs.baseline` + `tools.schema`，
// 而真正守解析器往返守恒、宿主会话隔离、画布渲染、连线不变量的那批文件
// （mermaid / edges / layout / prerender / ui.render / host.e2e / host-loader / plugin-mount /
// build-guards / client-config-card）**没有任何命令会跑它们**，仓库也没有 CI。
// 于是「守门断言在、闸门没接电」：改坏协议层可以一路静默通过。这里把闸门接上。
//
// 拆分后这三个大文件各由若干分片组成（`*.shared.*` 是它们共用的装载脚手架，不是套件、不进这里）：
//   mermaid.parser / mermaid.real · host.e2e.p1..p4 · ui.render.s1..s6
//
// 判据就是退出码：任何一个文件非 0 即整体非 0。
//
// 用法：node tools/run-tests.mjs [--no-build]
//   --no-build  跳过前置构建（只有在你确信 dist/ 与源码一致时才用）

import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 固定清单，顺序即执行顺序。
 *
 * `build-guards` 与 `docs.baseline` 会自己构建「干净副本」来做负向对照，所以它们必须排在
 * 其它文件之后 —— 它们跑得最久，失败时也不该耽误前面的快测。
 */
const FILES = [
  'test/mermaid.parser.test.cjs',
  'test/mermaid.real.test.cjs',
  'test/edges.test.cjs',
  'test/layout.test.cjs',
  'test/prerender.test.mjs',
  'test/ui.render.s1.mjs',
  'test/ui.render.s2.mjs',
  'test/ui.render.s3.mjs',
  'test/ui.render.s4.mjs',
  'test/ui.render.s5.mjs',
  'test/ui.render.s6.mjs',
  'test/host.e2e.p1.mjs',
  'test/host.e2e.p2.mjs',
  'test/host.e2e.p3.mjs',
  'test/host.e2e.p4.mjs',
  'test/host-loader.e2e.mjs',
  'test/plugin-mount.e2e.mjs',
  'test/client-config-card.mjs',
  'test/build-guards.mjs',
  'test/docs.baseline.mjs',
  'test/tools.schema.mjs'
]

const skipBuild = process.argv.includes('--no-build')

if (!skipBuild) {
  // 测试读的是构建产物（`dist/mermaid.js` 等），不先构建就是在测上一次的旧代码 ——
  // 这正是「改了源码、测试还是绿的」那种假绿的来源。
  const build = spawnSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' })
  if (build.status !== 0) {
    console.error('\n✗ 前置构建失败：测试读的是构建产物，构建不过就没有可信的测试结果')
    process.exit(1)
  }
}

const failed = []
for (const file of FILES) {
  process.stdout.write(`\n▶ ${file}\n`)
  const run = spawnSync(process.execPath, [file], { cwd: ROOT, stdio: 'inherit' })
  if (run.status !== 0) failed.push({ file, status: run.status })
}

console.log('\n──────── 全套测试结果 ────────')
for (const file of FILES) {
  const bad = failed.find(entry => entry.file === file)
  console.log(`${bad ? '✗' : '✓'} ${file}${bad ? `  (exit ${bad.status})` : ''}`)
}
if (failed.length > 0) {
  console.log(`\n✗ ${failed.length}/${FILES.length} 个测试文件失败`)
  process.exit(1)
}
console.log(`\n✓ ${FILES.length} 个测试文件全部通过`)
