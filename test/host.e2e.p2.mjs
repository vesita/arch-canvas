// 宿主端到端分片（共享脚手架见 host.e2e.shared.mjs：桩服务、vm 装载、回放与汇总出口）。
// 跑本片时先按序回放更早的阶段（不计分），再跑下面这些分节；条的合计与拆分前逐字相同。
import { beginPhase, endPhase } from './host.e2e.shared.mjs'
await beginPhase(2)

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
    capModel.nodes.push({ id: 'cap' + i, label: 'C' + i, shape: 'rect', x: i * 10, y: 0, note: '历史' + i, noteDone: false })
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

  // 端到端断言：arch_read 支持可选 notes: true，回看历史已办留言
  const rDefault = await tool('arch_read').execute({}, {})
  const renderDef = tool('arch_read').output.render({}, rDefault)
  eq('默认不传 notes 时 execute 不附带 notesText', rDefault.notesText, undefined)
  ok('默认不传 notes 时 render 逐字一致（不含留言清单）',
    renderDef[0].text === '【' + String(rDefault.diagram || '?') + '】\n' + String(rDefault.mermaid || '(空)'), renderDef[0].text)

  const rWithNotes = await tool('arch_read').execute({ notes: true }, {})
  const renderNotes = tool('arch_read').output.render({ notes: true }, rWithNotes)
  ok('notes:true 时附带留言清单（含历史已办条目）', Array.isArray(rWithNotes.notes) && rWithNotes.notes.length >= 6)
  ok('notes:true 标出了已办留言 (done: true)', rWithNotes.notes.some((n) => n.id === 'cap8' && n.done === true))
  ok('notes:true 按 at 排序', rWithNotes.notes.every((n, idx, arr) => idx === 0 || (n.at || 0) >= (arr[idx - 1].at || 0)))
  ok('notes:true 的 render 文本包含留言清单', renderNotes[0].text.indexOf('【留言清单】') >= 0)
  ok('notes:true 的 render 文本列出全部已办留言', renderNotes[0].text.indexOf('cap8') >= 0 && renderNotes[0].text.indexOf('done: true') >= 0)

  // 加上一条未办留言验证 done: false 亦正确标出
  const mUnfinished = JSON.parse(JSON.stringify((await call('doc:get', { where: dirNote })).model))
  const mnTarget = mUnfinished.nodes.find((n) => n.id === 'mn1')
  mnTarget.note = '新未办留言'
  mnTarget.noteDone = false
  await call('doc:set', { model: mUnfinished, where: dirNote })
  const rMixed = await tool('arch_read').execute({ notes: true }, {})
  ok('notes:true 标出了未办留言 (done: false)', rMixed.notes.some((n) => n.id === 'mn1' && n.done === false))

  // 负向对照：notes 传非布尔被拒
  const rBadNotes = await tool('arch_read').execute({ notes: 'yes' }, {})
  eq('notes 非布尔时被拒 (ok === false)', rBadNotes.ok, false)
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
mRef2.nodes.find((n) => n.id === 'r1').tags = ['core', 'parser']
await call('doc:set', { model: mRef2, where: dirRef })
const wRef = await tool('arch_write').execute({
  mermaid: 'flowchart TD\n  r1["解析器重画"] --> r3["新下游"]\n',
}, {})
ok('arch_write 成功', wRef && wRef.ok !== false)
const getWRef = await call('doc:get', { where: dirRef })
eq('arch_write 后同 id 节点继承了锚点',
  JSON.stringify(getWRef.model.nodes.find((n) => n.id === 'r1').files), JSON.stringify(['src/host/mermaid.ts#parseMermaid']))
eq('arch_write 后同 id 节点继承了标签',
  JSON.stringify(getWRef.model.nodes.find((n) => n.id === 'r1').tags), JSON.stringify(['core', 'parser']))
ok('继承的锚点也写回了文件（# 原样）', files.get(refFile).indexOf('%% @file r1 "src/host/mermaid.ts#parseMermaid"') >= 0)

const aRef = await call('doc:applyText', { text: 'flowchart TD\n  r1["手改"] --> r3["新下游"]\n', where: dirRef })
ok('doc:applyText 成功', aRef && aRef.ok !== false)
eq('doc:applyText 不继承锚点（删了那行就是真的删）',
  (await call('doc:get', { where: dirRef })).model.nodes.find((n) => n.id === 'r1').files.length, 0)
eq('doc:applyText 不继承标签',
  (await call('doc:get', { where: dirRef })).model.nodes.find((n) => n.id === 'r1').tags.length, 0)
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
  mNS.nodes.push({ id: 'a1', label: '架构图新节点', shape: 'rect', x: 0, y: 0, note: '架构图这条必须写进去', noteDone: false })
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
  mTpl1.nodes.push({ id: 'tpl1', label: '{{{{a}}}}', shape: 'rect', x: 0, y: 0 })
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

endPhase()
