// 宿主端到端分片（共享脚手架见 host.e2e.shared.mjs：桩服务、vm 装载、回放与汇总出口）。
// 跑本片时先按序回放更早的阶段（不计分），再跑下面这些分节；条的合计与拆分前逐字相同。
import { beginPhase, endPhase } from './host.e2e.shared.mjs'
await beginPhase(3)

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
    '  f1["甲"]',
    '  f2["乙"]',
    '  f1 --> f2',
    '%% @pos f1 10 20',
    '%% @link f1 "别的图"',
    '%% @file f1 "src/a.ts"',
    '',
  ].join('\n'))
  const docOps0 = await call('doc:get', { where: dirOps })
  const opsF1 = docOps0.model.nodes.find((n) => n.id === 'f1')
  ok('F：夹具就位（f1 带坐标 / 下钻 / 锚点）',
    !!opsF1 && opsF1.x === 10 && opsF1.y === 20 && opsF1.link === '别的图' &&
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

  await batch('set_tags tags:42', { op: 'set_tags', id: 'f1', tags: 42 }, 'tags')
  await batch('set_tags tags:[42]', { op: 'set_tags', id: 'f1', tags: [42] }, '字符串')

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

  const fOkMove = await tool('arch_edit').execute({ ops: [{ op: 'move_node', id: 'f1', x: 111, y: 222 }] }, {})
  eq('F：负向对照 move_node 传有限数字 → 无 problems', fOkMove.problems.length, 0)
  ok('F：坐标真的改了', files.get(opsFile).indexOf('%% @pos f1 111 222') >= 0, files.get(opsFile))

  const fOkLabel = await tool('arch_edit').execute({ ops: [{ op: 'set_edge_label', from: 'f1', to: 'f2', label: '标注' }] }, {})
  eq('F：负向对照 set_edge_label 对已有的边 → 无 problems', fOkLabel.problems.length, 0)
  eq('F：连线标签真的改了', (await call('doc:get', { where: dirOps })).model.edges.find((e) => e.from === 'f1' && e.to === 'f2').label, '标注')

  const fOkDel = await tool('arch_edit').execute({ ops: [{ op: 'remove_edge', from: 'f1', to: 'f2' }] }, {})
  eq('F：负向对照 remove_edge 对已有的边 → 无 problems', fOkDel.problems.length, 0)
  eq('F：连线真的删了', (await call('doc:get', { where: dirOps })).model.edges.length, 0)

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

console.log('【I. 新项目显式建默认图是干净空图且不覆盖已有内容】')
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
  eq('I：新项目建默认图是空图（0 节点，不从全局复制）', swInh && swInh.nodeCount, 0)
  ok('I：盘上文件存在且为空图文本（没有节点声明）',
    files.has(inhFile) && (files.get(inhFile) || '').indexOf('["') < 0,
    files.get(inhFile))

  // 负向对照：新建另一张新图也是干净空图
  const swFresh = await tool('arch_switch').execute({ key: 'fresh-i', create: true }, { agent: agentInh })
  ok('I：负向对照 —— 新建另一张新图成功', swFresh && swFresh.ok !== false, swFresh && swFresh.error)
  eq('I：负向对照 —— 那也是一张空图（0 节点）', swFresh && swFresh.nodeCount, 0)
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
console.log('【宿主审计 A：add_node】')
const dirAud = '/tmp/test-arch-audit'
agentMap.set('sess-aud', { session: { id: 'sess-aud', cwd: dirAud } })
const audOpen = await call('doc:open', { key: 'ag', create: true, where: dirAud, session: 'sess-aud' })
ok('审计用例：新建一张图', audOpen && audOpen.ok !== false, audOpen && audOpen.error)
const agAdd = await tool('arch_edit').execute({
  ops: [
    { op: 'add_node', id: 'gn1', label: '节点一' },
    { op: 'add_node', id: 'gn2', label: '散节点' },
  ],
}, {})
ok('add_node 生效', agAdd && agAdd.appliedCount === 2, agAdd && agAdd.appliedCount)
const audBack = await call('doc:open', { key: 'ag', where: dirAud, session: 'sess-aud' })

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

endPhase()
