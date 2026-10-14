// 宿主端到端分片（共享脚手架见 host.e2e.shared.mjs：桩服务、vm 装载、回放与汇总出口）。
// 跑本片时先按序回放更早的阶段（不计分），再跑下面这些分节；条的合计与拆分前逐字相同。
import { beginPhase, endPhase } from './host.e2e.shared.mjs'
await beginPhase(4)

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

  // 9) 画布停在**全局兜底图库**时不许说成「别的项目」——兜底图库不属于任何项目。
  //    现场：重启后 cwd 在项目里的会话读到「画布现在停在别的项目上（全局图库 ~/.dsh/arch-canvas）」，
  //    而它自己的项目根本没建过图库；那句话把「兜底」误报成「别人的项目」，方向正好反了。
  await call('doc:get', { where: '', session: 'sess-global' })
  const agentNoLib = { session: { id: 'sess-nolib', cwd: '/tmp/proj-iso-nolib' } }
  const pNoLib = promptOf(agentNoLib)
  ok('停在全局兜底图库时不说「别的项目」', pNoLib.indexOf('画布现在停在别的项目上') < 0, pNoLib.slice(0, 240))
  ok('说清那是全局兜底图库（不属于任何项目）', pNoLib.indexOf('全局兜底图库') >= 0, pNoLib.slice(0, 240))
  ok('给出本项目图库的落点', pNoLib.indexOf('/tmp/proj-iso-nolib/.arch-canvas') >= 0, pNoLib.slice(0, 240))
  ok('这一轮仍不读画布内容（也不含源文本块）', pNoLib.indexOf('```mermaid') < 0)
}

console.log('【会话目录自动检测 + 检测范围收口（2026-10-08 目录污染）】')
{
  // 探针实测的现场：cwd=`/home/vesita/coding/my/laya` 的会话解析出的图库是
  // `/home/vesita/coding/my/.arch-canvas`（一个只有旁路表的**空壳**），清单里列着 8 个
  // **兄弟项目**的图；同时 cwd=`/home/vesita/coding/my` 的会话被注入的是全局图库里的
  // `laya-architecture` / `phone-ssh-ca` —— 两张别的项目目录的图。
  // 两条根因各钉一条：
  //   ① `whereOfExec` 读的三个字段（`agent.cwd` / `agent.session.cwd` / `agent.header.cwd`）
  //      **都不存在**，DSH 的真实形状是 `agent.session.header.cwd` ⇒ 提示词与四个工具
  //      都拿不到会话目录，检测等于没有；
  //   ② 图库根只按「`.arch-canvas` 目录在不在」往上找，一个空壳就能吞掉整棵子树。
  const dirS = '/tmp/proj-scope-a'
  files.set(dirS + '/.arch-canvas/architecture.mmd', 'flowchart TD\n  s1["S 项目的节点"]\n')
  const agentReal = { session: { id: 'scope-real', header: { cwd: dirS } } }
  const agentLegacy = { session: { id: 'scope-legacy', cwd: dirS } }

  const readReal = await tool('arch_read').execute({}, { agent: agentReal })
  ok('★ agent.session.header.cwd 能被取到：工具落进会话目录的图库',
    !!readReal && String(readReal.file).indexOf(dirS + '/.arch-canvas/') === 0,
    readReal && { file: readReal.file, dir: readReal.dir, error: readReal.error })
  ok('★ 真形状的提示词读到的是自己项目的图',
    promptFn({ agent: agentReal }).indexOf('S 项目的节点') >= 0)
  const editReal = await tool('arch_edit').execute(
    { ops: [{ op: 'add_node', id: 'scope_new', label: '真形状写进来的' }] }, { agent: agentReal })
  ok('★ 真形状的写也落在会话目录的图库里',
    !!editReal && editReal.ok !== false && String(files.get(dirS + '/.arch-canvas/architecture.mmd')).indexOf('scope_new') >= 0,
    editReal && editReal.problems)

  // 旧形状（测试桩写了多年的那个）继续认：字段改名不该变成「静默退回全局」
  const readLegacy = await tool('arch_read').execute({}, { agent: agentLegacy })
  ok('旧形状 agent.session.cwd 仍被接受（降级而不是失效）',
    !!readLegacy && String(readLegacy.file).indexOf(dirS + '/.arch-canvas/') === 0,
    readLegacy && readLegacy.file)

  // ② 空壳图库不许吞子树
  const C = '/tmp/proj-scope-container'
  files.set(C + '/.arch-canvas/anchors.json', '{}')          // 只有旁路表：空壳
  files.set(C + '/p1/.arch-canvas/architecture.mmd', 'flowchart TD\n  p1a["P1 的节点"]\n')
  files.set(C + '/p2/.arch-canvas/architecture.mmd', 'flowchart TD\n  p2a["P2 的节点"]\n')

  const l1 = await call('doc:list', { where: C + '/p1', session: 'scope-p1' })
  eq('★ 空壳图库不算数：p1 的会话落在 p1 自己的图库', l1.dir, C + '/p1/.arch-canvas')
  ok('★ 检测范围 = 会话目录及其子目录：兄弟项目 p2 一条都不进清单',
    !l1.items.some((x) => String(x.key).indexOf('p2') >= 0), l1.items.map((x) => x.key))
  ok('★ 清单里只有 p1 自己的那一张',
    l1.items.filter((x) => !x.deleted).map((x) => x.key).join(',') === 'architecture',
    l1.items.map((x) => x.key))
  eq('★ 目录关系：会话目录如实回报', l1.sessionDir, C + '/p1')
  eq('★ 目录关系：每张图带上相对会话目录的位置',
    (l1.items.find((x) => x.name === 'architecture') || {}).rel, '.arch-canvas')

  // ★ 写路径：上层空壳不许把会话的图库顶掉 —— 顶掉了，画布就会被写进**容器目录**
  const writeP1 = await tool('arch_edit').execute(
    { ops: [{ op: 'add_node', id: 'p1_new', label: 'P1 加的' }] },
    { agent: { session: { id: 'scope-p1w', header: { cwd: C + '/p1' } } } })
  ok('★ 真形状的写落在 p1 自己的图库',
    !!writeP1 && writeP1.ok !== false && String(files.get(C + '/p1/.arch-canvas/architecture.mmd')).indexOf('p1_new') >= 0,
    writeP1 && writeP1.problems)
  ok('★ 负向对照：容器目录里没有被种出 .arch-canvas/architecture.mmd',
    !files.has(C + '/.arch-canvas/architecture.mmd'),
    [...files.keys()].filter((k) => k.indexOf(C) === 0))

  // 会话坐在项目子目录里：范围仍只有会话目录这一棵 + 项目根图库，兄弟目录不许进来
  files.set(C + '/p1/src/.arch-canvas/细节.mmd', 'flowchart TD\n  d1["P1 子目录的图"]\n')
  const l2 = await call('doc:list', { where: C + '/p1/src', session: 'scope-p1src' })
  eq('key 基准仍取最外层真图库（p1）', l2.dir, C + '/p1/.arch-canvas')
  eq('检测锚点 = 会话目录', l2.scanFrom, C + '/p1/src')
  ok('★ 兄弟项目仍不进清单', !l2.items.some((x) => String(x.key).indexOf('p2') >= 0), l2.items.map((x) => x.key))
  ok('项目根图库那张仍列在里面（它是会话的项目级画布）', l2.items.some((x) => x.key === 'architecture'))
  ok('会话目录下的子图库用项目级 key + 相对位置',
    l2.items.some((x) => x.key === 'src/细节' && x.rel === '.arch-canvas'),
    l2.items.map((x) => [x.key, x.rel]))
  ok('★ 提示词写明检测范围（会话目录及其子目录）',
    promptFn({ agent: { session: { id: 'scope-p1src', header: { cwd: C + '/p1/src' } } } }).indexOf('检测范围') >= 0)
  // 槽是按图库目录共享的（p1 与 p1/src 同一个槽），锚点必须跟**这一步的会话目录**走 ——
  // 读那个共享字段的话，cwd=p1 的会话会被告知范围是上一个请求留下的 p1/src
  const pRoot = promptFn({ agent: { session: { id: 'scope-p1root', header: { cwd: C + '/p1' } } } })
  ok('★ 检测范围跟这一步的会话目录走（不跟着上一个请求留下的锚点漂）',
    pRoot.indexOf('检测范围：**' + C + '/p1 及其子目录**') >= 0,
    pRoot.split('\n').find((l) => l.indexOf('检测范围') === 0))
  ok('★ 目录关系也按这一步的锚点重算（不沿用别的会话留下的锚点）',
    pRoot.indexOf('[src/.arch-canvas]') >= 0 && pRoot.indexOf('[' + C + '/p1/.arch-canvas]') < 0,
    pRoot.split('\n').find((l) => l.indexOf('同图库还有') === 0))

  // 负向对照：把空壳换成**真图库**，key 基准就变回容器 —— 证明「空壳不算数」这条判据真的在起作用。
  // 换个没被缓存过的 cwd（缓存按 cwd 存，同一个 cwd 不允许两次答案不同）。
  files.set(C + '/.arch-canvas/architecture.mmd', 'flowchart TD\n  ca["容器的根图"]\n')
  files.set(C + '/p3/.arch-canvas/architecture.mmd', 'flowchart TD\n  p3a["P3 的节点"]\n')
  const l3 = await call('doc:list', { where: C + '/p3', session: 'scope-p3' })
  eq('负向对照：容器有真图库时 key 基准回到容器', l3.dir, C + '/.arch-canvas')
  ok('★ 但兄弟项目 p2 仍然不进清单（范围只由会话目录决定）',
    !l3.items.some((x) => String(x.key).indexOf('p2') >= 0), l3.items.map((x) => x.key))
  ok('p3 自己的图用项目级 key', l3.items.some((x) => x.key === 'p3/architecture'), l3.items.map((x) => x.key))
  ok('容器根图库那张也在（它是会话的项目级画布）', l3.items.some((x) => x.key === 'architecture'))

  // ★ 换层（doc:open / arch_switch）不许把检测锚点放宽到图库根：请求里就带着会话目录。
  // 漏传第三参 ⇒ resetToWorkspace 退回图库根 ⇒ 紧随其后的 afterSwitch() 强制扫整棵，
  // 别的子项目的图库跟着进「同图库」清单（独立复核 2026-10-08 逮到的缺口）。
  // 用一棵全新的容器目录：所有图库在第一次查询之前就位，key 基准（最外层真图库 = 容器）稳定。
  const S = '/tmp/proj-scope-switch'
  files.set(S + '/.arch-canvas/architecture.mmd', 'flowchart TD\n  sw_root["容器的根图"]\n')
  files.set(S + '/p1/.arch-canvas/architecture.mmd', 'flowchart TD\n  sw_p1["P1 的节点"]\n')
  files.set(S + '/p2/.arch-canvas/architecture.mmd', 'flowchart TD\n  sw_p2["P2 的节点"]\n')
  const sidSw = 'scope-sw'
  // 先在 p1 锚点下把「默认根图库」那一槽建起来（此后它会以 p1 的锚点被存进槽里）
  await call('doc:list', { where: S + '/p1', session: 'scope-sw-warm' })
  const oSw = await call('doc:open', { where: S + '/p1', key: 'p2/architecture', session: sidSw })
  eq('前提：从 p1 换到 p2 那一层', oSw.dir, S + '/p2/.arch-canvas')
  const lSw = await call('doc:list', { where: S + '/p1', session: sidSw, rescan: false })
  ok('★ 换层那一趟的清单仍只覆盖会话目录这一棵',
    !lSw.items.some((x) => x.key === 'p2/architecture'), lSw.items.map((x) => x.key))
  // ★ 切槽回来：槽里那份 root 的 scanFrom 是**上一个用它的会话**留下的（p1），要按这一步重钉（p2）
  const lSlot = await call('doc:list', { where: S + '/p2', session: 'scope-slot-other' })
  eq('★ 切槽回来的检测锚点仍是这一步的会话目录', lSlot.scanFrom, S + '/p2')
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
      direction: 'TD', summary: '', extras: [],
      nodes: [
        { id: 'A', label: 'A', shape: 'rect', x: 0, y: 0, link: null, files: [] },
        { id: 'B', label: 'B', shape: 'rect', x: 0, y: 0, link: null, files: [] },
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
      direction: 'TD', summary: '', extras: [],
      nodes: [
        { id: 'A', label: 'A', shape: 'rect', x: 0, y: 0, link: null, files: [] },
        { id: 'B', label: 'B', shape: 'rect', x: 0, y: 0, link: null, files: [] },
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

console.log('【P1 归一撞名：doc:set 送进来的两个写法也必须都活下来】')
{
  // 界面/模型边界（normalizeModel）从前是 `if (seen[id]) continue` —— 静默丢掉一个用户写下的节点。
  // 与解析器那条同一个口径：后来者加稳定后缀 + 出声；边的两端按**原始写法**认回被改名的那个。
  const collideFile = TEST_DATA_DIR + '/collide-probe.mmd'
  files.set(collideFile, 'flowchart TD\n  A["a"]\n')
  await call('doc:openPath', { path: collideFile })
  const r = await call('doc:set', {
    model: {
      direction: 'TD', summary: '', extras: [],
      nodes: [
        { id: 'a-b', label: '甲', shape: 'rect', x: 1, y: 2, link: null, files: [] },
        { id: 'a.b', label: '乙', shape: 'rect', x: 3, y: 4, link: null, files: [] },
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
      direction: 'TD', summary: '', extras: [],
      nodes: [
        { id: 'z1', label: '先', shape: 'rect', x: 0, y: 0, link: null, files: [] },
        { id: 'z1', label: '后', shape: 'rect', x: 0, y: 0, link: null, files: [] },
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

console.log('【子图库交叉污染：写盘要认下自己那一层】')
{
  // 2026-09-27 实测的事故：同一个项目根下两个会话分别打开子图库 A、B，后来者把全局 `lib` 改掉，
  // 前一个会话的下一次 `arch_edit` 就写进了**别人那张图**（探针实测：B 的 .mmd 变了、A 一字未动）。
  // 两层根因：① `lib` 是全进程唯一的活动指针，而请求里只有 cwd —— 没有任何东西代表「这个会话选了哪一层」；
  // ② 槽的键从前是**原始 cwd**，同一份 .mmd 会有两个身份、各持一份 doc，各自整份落盘 = 静默互相覆盖。
  // 现在：槽按**图库目录**定身份，会话在 doc:open / arch_switch 成功时记住自己那一层；
  // cwd 先规范化成**项目根**（向上找最外层带 .arch-canvas 的祖先），key 不再随 cwd 漂。
  const P = '/tmp/proj-sub-iso'
  const A = P + '/A'
  const B = P + '/B'
  const fileA = A + '/.arch-canvas/architecture.mmd'
  const fileB = B + '/.arch-canvas/architecture.mmd'
  files.set(P + '/.arch-canvas/architecture.mmd', 'flowchart TD\n  root1["根的节点"]\n')
  files.set(fileA, 'flowchart TD\n  a1["A 的节点"]\n')
  files.set(fileB, 'flowchart TD\n  b1["B 的节点"]\n')
  const agentSA = { session: { id: 'sub-sess-a', cwd: P } }
  const agentSB = { session: { id: 'sub-sess-b', cwd: P } }

  const oA = await call('doc:open', { where: P, key: 'A/architecture', session: 'sub-sess-a' })
  eq('会话1 打开子图库 A', oA.dir, A + '/.arch-canvas')
  const oB = await call('doc:open', { where: P, key: 'B/architecture', session: 'sub-sess-b' })
  eq('会话2 打开子图库 B', oB.dir, B + '/.arch-canvas')

  const beforeB = files.get(fileB)
  const editA = await tool('arch_edit').execute(
    { ops: [{ op: 'add_node', id: 'sessA_new', label: '会话1 加的节点' }] }, { agent: agentSA })
  ok('会话1 的 arch_edit 成功', !!editA && editA.ok !== false, editA && editA.error)
  ok('会话1 的编辑落在自己那张图（A）', String(files.get(fileA)).indexOf('sessA_new') >= 0)
  ok('负向对照：B 的 .mmd 一个字节都没动 —— 这就是污染现场', files.get(fileB) === beforeB)

  const editB = await tool('arch_edit').execute(
    { ops: [{ op: 'add_node', id: 'sessB_new', label: '会话2 加的节点' }] }, { agent: agentSB })
  ok('会话2 的 arch_edit 仍落在 B', !!editB && editB.ok !== false && String(files.get(fileB)).indexOf('sessB_new') >= 0)
  ok('两个会话的改动各在各自文件里，互不覆盖',
    String(files.get(fileA)).indexOf('sessA_new') >= 0 && String(files.get(fileB)).indexOf('sessB_new') >= 0)

  // cwd 落在子目录：算出的项目根必须是**外层**那个（否则同一份 .mmd 的 key 随 cwd 漂）
  const gA2 = await call('doc:get', { where: A, session: 'sub-sess-a2' })
  eq('cwd=子目录时项目根不漂', gA2.dir, P + '/.arch-canvas')
  const lA2 = await call('doc:list', { where: A, session: 'sub-sess-a2' })
  ok('子目录会话的清单里，A 的图还是同一个 key',
    (lA2.items || []).some((x) => x.key === 'A/architecture'), (lA2.items || []).map((x) => x.key))
  const oA2 = await call('doc:open', { where: A, key: 'A/architecture', session: 'sub-sess-a2' })
  eq('从子目录会话打开 `A/architecture` 落到同一层（不再多套一层 A/A）', oA2.dir, A + '/.arch-canvas')
  ok('而且读到的就是会话1 刚改过的那一份（同一个槽，不是两份内存 doc）',
    String(oA2.mermaid).indexOf('sessA_new') >= 0, String(oA2.mermaid).slice(0, 100))

  // cwd 落在**没有 .arch-canvas 的源码子目录**里：不许算出幽灵图库
  const srcDir = A + '/src'
  const gSrc = await call('doc:get', { where: srcDir, session: 'sub-sess-src' })
  eq('cwd=源码子目录时解析到项目根那一层（不是 <cwd>/.arch-canvas）', gSrc.dir, P + '/.arch-canvas')
  const pSrc = promptFn({ agent: { session: { id: 'sub-sess-src', cwd: srcDir } } })
  ok('而且不报「停在别的项目上」（它就是同一个项目）', pSrc.indexOf('停在别的项目上') < 0, pSrc.slice(0, 160))
  const oPhantom = await call('doc:open', { where: srcDir, key: 'A/architecture', session: 'sub-sess-src' })
  eq('从源码子目录按项目级 key 打开，落点不再多套一层', oPhantom.dir, A + '/.arch-canvas')
  await call('doc:set', { where: srcDir, session: 'sub-sess-src', model: oPhantom.model })
  ok('写一次也不会在源码目录里种出幽灵图库',
    ![...files.keys()].some((k) => k.indexOf(srcDir + '/.arch-canvas') === 0),
    [...files.keys()].filter((k) => k.indexOf(srcDir) === 0))
}

console.log('【AI 编辑工具的格式容错：手写的换行别变成图里的垃圾】')
{
  // AI 爱照抄文件里看到的 `<br/>`，还常写成 `<br>` / `<\br>` / `</br>` / `<BR/>`。
  // 这些从前原样进模型，`q()` 再把 `<` 转义成 `#60;` —— 用户方块里就是那串字面垃圾。
  // 归一点在**模型入口**（normalizeModel + op），所以内存里始终是真实换行、文件里始终是 `<br/>`。
  const dirF = '/tmp/proj-fmt'
  const fileF = dirF + '/.arch-canvas/architecture.mmd'
  files.set(fileF, 'flowchart TD\n  f1["原标签"]\n')
  const agentF = { session: { id: 'sess-fmt', cwd: dirF } }
  await call('doc:get', { where: dirF, session: 'sess-fmt' })
  const variants = [['<br>', '一<br>二'], ['<\\br>', '一<\\br>二'], ['</br>', '一</br>二'], ['<BR/>', '一<BR/>二']]
  for (const [name, spelling] of variants) {
    const r = await tool('arch_edit').execute({ ops: [{ op: 'set_label', id: 'f1', label: spelling }] }, { agent: agentF })
    ok('set_label 接受手写的 ' + name, !!r && r.ok !== false, r && r.problems)
    const onDisk = String(files.get(fileF))
    ok('  落盘是规范换行（有 <br/>、没有 #60; 字面垃圾）',
      onDisk.indexOf('<br/>') >= 0 && onDisk.indexOf('#60;') < 0, onDisk.slice(0, 140))
    const g = await call('doc:get', { where: dirF, session: 'sess-fmt' })
    ok('  读回来是真实换行', g.model.nodes[0].label === '一\n二', JSON.stringify(g.model.nodes[0].label))
  }
  // 负向对照：正当的小于号照旧转义 —— 这条归一不许误伤
  await tool('arch_edit').execute({ ops: [{ op: 'set_label', id: 'f1', label: 'x < y' }] }, { agent: agentF })
  const gx = await call('doc:get', { where: dirF, session: 'sess-fmt' })
  ok('负向对照：普通的小于号照旧按实体转义，读回仍是 x < y',
    gx.model.nodes[0].label === 'x < y' && String(files.get(fileF)).indexOf('#60;') >= 0,
    [gx.model.nodes[0].label, String(files.get(fileF)).slice(0, 120)])
}

console.log('【子图库交叉污染 · 槽淘汰 / 天花板 / 建库后的同步路径 / @file 往返】')
{
  // 这一节钉的是 2026-10-01 独立复核报的四类缺口（现有断言一条都没覆盖）：
  //   ① 槽被淘汰之后「root 被打成会话记住的子层」⇒ 裸 key 落进子图库；
  //   ② 项目根的规范化**没有天花板** ⇒ 公共父目录上的 .arch-canvas 吞掉整棵子树；
  //   ③ 建库把项目根缓存**整表清空** ⇒ 同步路径（promptText）退回原始 cwd、对模型说谎；
  //   ④ `@file` 的值过了读侧归一、没过写侧 ⇒ 每次保存都报 serialize.not-idempotent。
  const P = '/tmp/proj-evict'
  const LAYERS = 14
  files.set(P + '/.arch-canvas/architecture.mmd', 'flowchart TD\n  root1["根"]\n')
  for (let i = 1; i <= LAYERS; i++) {
    files.set(P + '/A' + i + '/.arch-canvas/architecture.mmd', 'flowchart TD\n  a' + i + '["A' + i + '"]\n')
  }
  const oX = await call('doc:open', { where: P, key: 'A1/architecture', session: 'evict-x' })
  eq('前提：会话 X 停在子图库 A1', oX.dir, P + '/A1/.arch-canvas')
  // 别的会话把槽填满（DOC_SLOT_MAX = 12），顺带把 A1 那一格挤出去
  for (let i = 2; i <= LAYERS; i++) {
    await call('doc:open', { where: P, key: 'A' + i + '/architecture', session: 'evict-o' + i })
  }
  const bare = await call('doc:open', { where: P, key: 'architecture', session: 'evict-x' })
  eq('★ 槽淘汰之后，裸 key 仍落在**项目根**（不是会话记住的那个子图库）', bare.dir, P + '/.arch-canvas')
  ok('★ 根图库没有被写进子图库的内容',
    String(files.get(P + '/.arch-canvas/architecture.mmd')).indexOf('a1') < 0,
    String(files.get(P + '/.arch-canvas/architecture.mmd')).slice(0, 90))

  // ② 天花板：测试里数据目录在 /tmp 下 ⇒ 天花板就是 /tmp。生产里对应 $HOME。
  files.set('/tmp/.arch-canvas/stray.mmd', 'flowchart TD\n  stray["公共父目录的库"]\n')
  try {
    const gCeil = await call('doc:get', { where: '/tmp/ceil-proj/src', session: 'ceil-1' })
    eq('★ 公共父目录上的 .arch-canvas 不会把下面的项目收成同一个项目',
      gCeil.dir, '/tmp/ceil-proj/src/.arch-canvas')
  } finally {
    files.delete('/tmp/.arch-canvas/stray.mmd')
  }

  // ③ 会话 cwd 是项目**子目录**时，另一处建库不许让同步路径（提示词）失忆
  const BP = '/tmp/b-proj'
  files.set(BP + '/.arch-canvas/architecture.mmd', 'flowchart TD\n  bp1["B 项目的节点"]\n')
  const agentB = { session: { id: 'b-sess', cwd: BP + '/src' } }
  const gB0 = await call('doc:get', { where: BP + '/src', session: 'b-sess' })
  eq('前提：cwd=项目子目录也解析到项目根', gB0.dir, BP + '/.arch-canvas')
  ok('前提：提示词读得到自己的图', promptFn({ agent: agentB }).indexOf('B 项目的节点') >= 0)
  const madeOther = await call('doc:open', { where: BP, key: 'A/别的图', create: true, session: 'b-other' })
  ok('前提：另一个会话在别处建出了子图库', !!madeOther && madeOther.ok !== false, madeOther && madeOther.error)
  const pAfter = promptFn({ agent: agentB })
  ok('★ 建库之后同步路径仍认得自己的项目（整表清缓存会让它退回原始 cwd 并说「停在别的项目上」）',
    pAfter.indexOf('停在别的项目上') < 0 && pAfter.indexOf('B 项目的节点') >= 0, pAfter.slice(0, 170))

  // ④ `@file` 的值走 qRef/unquoteRef（读侧归一 br 变体），写侧必须过同一道
  const FP = '/tmp/proj-file-br'
  files.set(FP + '/.arch-canvas/architecture.mmd', 'flowchart TD\n  g1["节点"]\n  g2["另一个"]\n')
  const agentF2 = { session: { id: 'file-sess', cwd: FP } }
  await call('doc:get', { where: FP, session: 'file-sess' })
  const rf = await tool('arch_edit').execute(
    { ops: [{ op: 'set_files', id: 'g1', files: ['src/a</br>b.ts'] }] }, { agent: agentF2 })
  ok('set_files 成功', !!rf && rf.ok !== false, rf && rf.problems)
  const gf = await call('doc:get', { where: FP, session: 'file-sess' })
  ok('★ @file 的换行变体按同一道归一进模型',
    gf.model.nodes.find((n) => n.id === 'g1').files[0].indexOf('\n') >= 0,
    gf.model.nodes.find((n) => n.id === 'g1').files)
  ok('★ 因此往返检查不报「写出去再读回来对不上」',
    !(gf.warnings || []).some((w) => String(w).indexOf('往返检查') >= 0), gf.warnings)
  const re = await tool('arch_edit').execute(
    { ops: [{ op: 'add_edge', from: 'g1', to: 'g2', label: '一<br>二' }] }, { agent: agentF2 })
  ok('add_edge 的标签也过归一（与 set_edge_label 同口径）',
    !!re && re.ok !== false && String(files.get(FP + '/.arch-canvas/architecture.mmd')).indexOf('<br/>') >= 0,
    re && re.problems)

  // 收尾：把活动文档留在**存在**的库上 —— 下面【提示词模板注入防护】拿不到 agent，
  // 靠的就是「沿用当前那一份」，落在 absent 的空库上会让它直接拒绝写。
  await call('doc:get', { where: FP, session: 'file-sess' })
}

console.log('【随包 skill：负向对照（缺 name / 没有服务都不注册、也不抛）】')
{
  // 用**独立**的 harness / ctx：这两次挂载会各写一条 plugin.mount 日志，
  // 放在文件靠后处，免得把前面那些「routeCount 必须等于真实注册数」的断言带偏。
  const harness2 = {
    handle: () => () => {}, route: () => {}, describeRoutes: () => [],
    defineTool: (d) => d, registerTool: () => {},
  }
  const noSkill = []
  const mkCtx2 = (skills) => ({
    get: (k) => (k === 'skills' ? skills : undefined),
    effect: (fn) => { const d = fn(); if (typeof d === 'function') d(); return () => {} },
    on: () => () => {},
    inject: (_n, cb) => cb({ effect: (fn) => { fn(); return () => {} }, interval: () => () => {} }),
  })
  const mkEnv = (skillText) => ({
    logBackend, dataDir: TEST_DATA_DIR,
    uiFile: UI_FILE, mermaidFile: CACHE,
    skillFile: '/tmp/fake-skill/SKILL.md', skillText,
  })
  const mount = async (env, ctx2, name) => {
    const box = vm.createContext({ harness: harness2, console, hostEnv: env })
    const plug = await vm.runInContext(`(async () => {\n${code}\n})()`, box, { filename: name })
    plug.apply(ctx2)
  }
  await mount(mkEnv('---\ndescription: 没有名字\n---\n\n正文\n'),
    mkCtx2({ register: (def) => { noSkill.push(def); return () => {} } }), 'host-skill-noname.js')
  eq('负向对照：frontmatter 缺 name 时不注册', noSkill.length, 0)
  let boom = null
  try {
    await mount(mkEnv(FAKE_SKILL_TEXT), mkCtx2(undefined), 'host-skill-noservice.js')
  } catch (e) { boom = e }
  ok('负向对照：没有 skills 服务时不注册、也不抛（附加能力不阻断挂载）',
    boom === null && noSkill.length === 0, boom && boom.message)
}

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
endPhase()
