// 可读性闸门的守门断言：**节点标题超宽会不会被拦住**。
//
// 这道闸门解决的是一个具体的用户抱怨：「AI 画出来的初始图可读性很差」。
// 机制是两处相撞：`nodeSize()` 的宽度有 300px 天花板（`w = min(300, max(104, widest*8.2+36))`），
// 而画布渲染只画标题、不换行、不截断 —— 超过约 16 个汉字的标题会画出方块、压住邻居。
//
// 三条必须成立的判据（缺一条这道闸门就是摆设）：
//   1. **算得对**：视觉宽度口径必须与 client 的 `visualLen()` 逐字一致（中文 2 / 其余 1）。
//      两边各有一份实现（host 与 client 是两个独立的 tsc 程序，够不着对方），所以这里**对拍**。
//   2. **拦得住**：超宽标题必须出现在 `readability` 里，且**不进 `problems`**
//      （`problems` 的语义是「这个 op 没生效」，超宽标题的 op 是生效了的 —— 混进去会让
//      「problems 为空 = 全部成功」失真，也会撞坏既有断言）。
//   3. **说得清**：回执的 render 必须把提示**渲染出来**。只把字段放进返回值而没人读，等于没做。
//
// 另有一条负向对照：**干净的图必须一个字节都不多报** —— 否则每张图都挂一条警告，
// 用户三天就学会无视它（与 drift 的「没有基线就不猜」同一条取向）。
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
let pass = 0
let fail = 0
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name) }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')) }
}
const eq = (name, got, want) => ok(name, got === want, { got, want })

// ---------- 装载被测的两份实现 ----------
// host 侧：dist/host-readability.js 是构建期单独出的一份（与 mermaid.js / client-runtime.js 同一理由）——
// dist/host.js 整体被包在 `return { apply }` 里，函数全在闭包内，从外面够不着。
// 这里跑的是**当前构建**的真身，不是手抄副本。
const HOST_FILE = join(ROOT, 'dist', 'host-readability.js')
if (!existsSync(HOST_FILE)) {
  console.error('缺少 ' + HOST_FILE + ' —— 先跑 npm run build')
  process.exit(1)
}
const hostSrc = readFileSync(HOST_FILE, 'utf8')
const hostApi = new Function(
  hostSrc + '\n;return { checkReadability: checkReadability, readabilityText: readabilityText,'
  + ' readableWidth: readableWidth, readableTitle: readableTitle,'
  + ' READABLE_TITLE_UNITS: READABLE_TITLE_UNITS };')()
const { checkReadability, readabilityText, readableWidth, readableTitle, READABLE_TITLE_UNITS } = hostApi

// client 侧：visualLen 住在 dist/client-runtime.js（tools/build.mjs 单独出的那份）。
// 拿它来**对拍** host 侧那份实现 —— 两份口径必须给出同一个数。
const CLIENT_FILE = join(ROOT, 'dist', 'client-runtime.js')
if (!existsSync(CLIENT_FILE)) {
  console.error('缺少 ' + CLIENT_FILE + ' —— 先跑 npm run build')
  process.exit(1)
}
const clientSrc = readFileSync(CLIENT_FILE, 'utf8')
const clientApi = new Function(clientSrc + '\n;return { visualLen: visualLen, nodeSize: nodeSize };')()
const { visualLen, nodeSize } = clientApi

console.log('【[1] 视觉宽度口径：host 与 client 必须逐字一致】')
{
  const samples = [
    '缓存层',
    'MoE 前馈（SwiGLU, clamp 10）',
    'AuthGuard',
    '层1',
    'a',
    '',
    '中英混排 mixed 文本 123',
    '任务卡注册表｜意图：代词 / 情绪 / 发言归属 / 词义关系各持一张，共享同一基座',
    'emoji 🎯 与代理对',
  ]
  let mismatches = []
  for (const s of samples) {
    const a = readableWidth(s)
    const b = visualLen(s)
    if (a !== b) mismatches.push({ s, host: a, client: b })
  }
  ok('9 个样本上 host 与 client 的宽度口径完全一致', mismatches.length === 0, mismatches)

  // 具体口径钉死（防止两边"一起改错"）
  eq('纯中文 3 字 = 6 单位', readableWidth('缓存层'), 6)
  eq('纯英文 9 字符 = 9 单位', readableWidth('AuthGuard'), 9)
  eq('空串 = 0 单位', readableWidth(''), 0)
  eq('中英混排按各自宽度累加', readableWidth('中a'), 3)
}

console.log('【[2] 阈值不是拍的：从渲染公式反解出来】')
{
  // nodeSize: w = min(300, max(104, widest*8.2 + 36))
  // 不溢出 <=> widest*8.2 + 36 <= 300
  const physicalMax = (300 - 36) / 8.2
  ok('阈值 ' + READABLE_TITLE_UNITS + ' 单位不超过渲染公式的物理上限 ' + physicalMax.toFixed(2),
    READABLE_TITLE_UNITS <= physicalMax, { limit: READABLE_TITLE_UNITS, physicalMax })
  ok('阈值不是过分保守（至少能装下 14 个汉字 = 28 单位）', READABLE_TITLE_UNITS >= 28, READABLE_TITLE_UNITS)

  // 用**真实渲染函数**验证：刚好在阈值上的标题，盒子宽度不该被 300 顶住
  const atLimit = '中'.repeat(Math.floor(READABLE_TITLE_UNITS / 2))
  const szAt = nodeSize(atLimit, 0)
  const needAt = visualLen(atLimit) * 8.2 + 36
  ok('阈值内的标题不会被 300px 天花板截断', needAt <= 300.0001, { needAt, boxW: szAt.w })

  // 越过阈值一个单位，就真的开始溢出
  const overLimit = '中'.repeat(Math.floor(READABLE_TITLE_UNITS / 2) + 1)
  const needOver = visualLen(overLimit) * 8.2 + 36
  const szOver = nodeSize(overLimit, 0)
  ok('越过阈值的标题确实溢出盒子（文字会画出方块）', needOver > szOver.w, { needOver, boxW: szOver.w })
}

console.log('【[3] 拦得住：超宽标题进 readability，不进 problems】')
{
  const nodes = [
    { id: 'ok1', label: '缓存层' },
    { id: 'bad1', label: '任务卡注册表｜意图：代词 / 情绪 / 发言归属 / 词义关系各持一张，共享同一基座' },
    { id: 'ok2', label: 'AuthGuard' },
    { id: 'bad2', label: '层1\n意图：这一行很长但它不是标题，所以不算超宽'.repeat(3) },
  ]
  const found = checkReadability(nodes)
  eq('只报 1 个超宽节点（bad2 的超长内容在描述行，不算）', found.length, 1)
  eq('报的是 bad1', found[0] && found[0].id, 'bad1')
  ok('报里带 units 与 limit（AI 要知道超了多少）',
    typeof found[0].units === 'number' && found[0].limit === READABLE_TITLE_UNITS, found[0])
  ok('报里带标题原文（AI 才知道要改哪个）', typeof found[0].title === 'string' && found[0].title.length > 0)

  // 负向对照：干净的图一个都不许报
  const clean = [{ id: 'a', label: '缓存层' }, { id: 'b', label: 'AuthGuard' }, { id: 'c', label: '' }]
  eq('干净的图不报任何问题', checkReadability(clean).length, 0)
  eq('空图不报问题', checkReadability([]).length, 0)
  eq('传 null 不炸', checkReadability(null).length, 0)
}

console.log('【[4] 只看标题，不看描述行】')
{
  // 这是闸门最容易做错的地方：如果把整份 label 拿去量，那 skill 鼓励的
  // 「意图：… / 原理：…」描述段会让每个节点都被误报，闸门立刻变成噪音源。
  const withDesc = { id: 'n', label: '缓存层\n意图：' + '这一行非常长'.repeat(20) + '\n原理：' + '又一行很长'.repeat(20) }
  eq('描述段再长也不报（只量标题行）', checkReadability([withDesc]).length, 0)
  eq('readableTitle 取第一行', readableTitle('缓存层\n意图：x'), '缓存层')
  eq('readableTitle 对无换行的 label 返回整串', readableTitle('缓存层'), '缓存层')
}

console.log('【[5] 说得清：回执必须把提示渲染出来】')
{
  const bad = checkReadability([{ id: 'bad1', label: '任务卡注册表｜意图：代词 / 情绪 / 发言归属 / 词义关系各持一张' }])
  const txt = readabilityText(bad)
  ok('提示里点名节点 id', txt.indexOf('bad1') >= 0, txt)
  ok('提示里说明会画出方块（后果）', txt.indexOf('画出方块') >= 0, txt)
  ok('提示里给出改法（标题改短、细节移到意图/原理）', txt.indexOf('意图') >= 0, txt)
  ok('提示里给出口径（多少单位 ≈ 多少汉字）', txt.indexOf(String(READABLE_TITLE_UNITS)) >= 0, txt)

  // 负向对照：没有问题时返回空串（不能凭空造一句）
  eq('没有问题时 readabilityText 返回空串', readabilityText([]), '')
  eq('传 null 返回空串', readabilityText(null), '')

  // 报告本身不能变成小作文：节点多时要截断
  const many = []
  for (let i = 0; i < 20; i++) many.push({ id: 'n' + i, label: '很长的标题'.repeat(10) })
  const manyTxt = readabilityText(many)
  ok('20 个超宽节点时提示仍然很短（< 400 字）', manyTxt.length < 400, manyTxt.length)
  ok('提示里说明还有多少个没列出来', manyTxt.indexOf('另有') >= 0, manyTxt)
}

console.log('【[6] 真实图上的效果（回归基线）】')
{
  // 用仓库里真实存在过的图验一遍：这些数字是从 10 张真实图上量出来的，
  // 改阈值时它们会变 —— 变了就说明阈值被动了，得重新想清楚为什么。
  const realLong = '任务卡注册表｜意图：代词 / 情绪 / 发言归属 / 词义关系各持一张，共享同一基座'
  const found = checkReadability([{ id: 'task_cards', label: realLong }])
  eq('真实超长标题被拦下', found.length, 1)
  ok('它确实远超阈值（> 2 倍）', found[0].units > READABLE_TITLE_UNITS * 2, found[0].units)

  const realShort = '共享基座 (NanoDocEncoder)'
  eq('真实的中等标题不误报', checkReadability([{ id: 'doc_encoder', label: realShort }]).length, 0)
}

console.log('')
console.log('结果: ' + pass + ' 通过 / ' + fail + ' 失败')
if (fail > 0) process.exit(1)
