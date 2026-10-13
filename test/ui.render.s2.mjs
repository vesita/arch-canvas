// 界面渲染分片（共享脚手架见 ui.render.shared.mjs；DOM/React/桩 RPC/槽位捕获都由它装载）。
import { endPhase } from './ui.render.shared.mjs'

console.log('\n[4c] 元素注释：带注释渲染、角标、清单已解决切换与检查器操作')
{
  const NOTE_MODEL = {
    nodes: [
      { id: 'n0', label: '无注释节点', shape: 'rect', group: null, x: 0, y: 0, note: '', noteDone: false },
      { id: 'n1', label: '节点甲', shape: 'rect', group: null, x: 100, y: 100, note: '这里为什么不用队列？', noteDone: false },
      { id: 'n2', label: '节点乙', shape: 'rect', group: null, x: 200, y: 100, note: '这里需要限流', noteDone: false },
      { id: 'n3', label: '节点丙', shape: 'rect', group: null, x: 300, y: 100, note: '已确认链路', noteDone: true },
    ],
    edges: [],
    groups: [],
    direction: 'TD',
    extras: [],
  }

  const prevRespond = respond
  let currentModel = JSON.parse(JSON.stringify(NOTE_MODEL))
  respond = function (method, args) {
    if (method === 'doc:get') {
      return fullDoc({
        external: '/tmp/project/docs/my-diag.mmd',
        diagram: 'my-diag',
        key: '/tmp/project/docs/my-diag.mmd',
        file: '/tmp/project/docs/my-diag.mmd',
        model: currentModel,
        nodeCount: currentModel.nodes.length,
      })
    }
    if (method === 'doc:set') {
      currentModel = args.model
      const nodes = args && args.model && args.model.nodes ? args.model.nodes : []
      return fullDoc({ model: args.model, nodeCount: nodes.length, revision: 2, updatedBy: 'user' })
    }
    return prevRespond(method, args)
  }

  let draftText = ''
  let submitCount = 0
  const mockInputActions = {
    setDraft: (text) => { draftText = text },
    submit: () => { submitCount++ },
  }

  const noteHost = document.createElement('div')
  document.body.appendChild(noteHost)
  const noteRoot = createRoot(noteHost)
  await act(async () => {
    noteRoot.render(React.createElement(captured['conversation.view'], {
      cwd: UI, sessionId: 's1', useSessions: () => UI, inputActions: mockInputActions,
    }))
  })
  await flush()

  // 1. 工具条找得到「留言」按钮，且带未解决数量
  const toolBtns = () => Array.from(noteHost.querySelectorAll('.ac-tools button'))
  const noteToolBtn = () => toolBtns().find((b) => b.textContent.startsWith('留言'))
  ok('工具条：找得到留言按钮，且文案同时给出待办数与总量（「留言 2 · 共 3」）', !!noteToolBtn() && noteToolBtn().textContent.trim() === '留言 2 · 共 3', noteToolBtn()?.textContent)

  // 2. 画布节点角标
  const nodeEls = () => Array.from(noteHost.querySelectorAll('g.ac-node'))
  const findNodeEl = (lbl) => nodeEls().find((el) => el.querySelector('.ac-lbl')?.textContent.trim() === lbl)
  const n0El = findNodeEl('无注释节点')
  const n1El = findNodeEl('节点甲')
  const n3El = findNodeEl('节点丙')

  ok('无注释节点不画角标', !!n0El && !n0El.querySelector('.ac-note-badge'))
  const badge1 = n1El?.querySelector('.ac-note-badge')
  ok('未解决节点角标：class 为 ac-note-badge 且文字为 ✎', !!badge1 && badge1.getAttribute('class') === 'ac-note-badge' && badge1.querySelector('text')?.textContent.trim() === '✎')
  const badge3 = n3El?.querySelector('.ac-note-badge')
  ok('已解决节点角标：class 为 ac-note-badge done 且文字为 ✓', !!badge3 && badge3.getAttribute('class') === 'ac-note-badge done' && badge3.querySelector('text')?.textContent.trim() === '✓')

  // 3. 展开 .ac-notes 面板
  await act(async () => { noteToolBtn().click() })
  await flush()

  const notesPanel = () => noteHost.querySelector('.ac-notes')
  ok('点击工具条按钮展开 .ac-notes 面板', !!notesPanel())

  const headText = notesPanel()?.querySelector('.ac-lib-head')?.textContent || ''
  ok('面板头部文案含总量、待递与历史三条数', headText.indexOf('节点留言：共 3 条') >= 0 && headText.indexOf('2 条待递') >= 0 && headText.indexOf('历史 1 条') >= 0, headText)

  // 3b. 头部批量按钮：**一个动作把这一批交出去**（不是「填进输入框等你回车」）
  const batchSendBtn = () => Array.from(notesPanel()?.querySelectorAll('.ac-lib-head button') || []).find((b) => b.textContent.includes('交给 AI'))
  ok('存在「交给 AI (2)」按钮', !!batchSendBtn() && batchSendBtn().textContent.trim() === '交给 AI (2)',
    batchSendBtn() && batchSendBtn().textContent)

  // a. 输入框空着：AC 替用户把这一批写成一条消息，然后**直接发出去**
  draftText = ''
  submitCount = 0
  await act(async () => { batchSendBtn()?.click() })
  await flush()
  ok('空输入框也能发：调了 setDraft 写进这一批',
    draftText.indexOf('`n1`（节点甲）：这里为什么不用队列？') >= 0 &&
    draftText.indexOf('`n2`（节点乙）：这里需要限流') >= 0 &&
    draftText.indexOf('关于画布「my-diag.mmd」') >= 0 &&
    draftText.indexOf('3 条留言') < 0 &&
    draftText.indexOf('2 条留言') >= 0,
    draftText)
  // 提交是隔一拍做的（setDraft 与 submit 读同一份投影），所以这里要真的等一拍
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  await flush()
  eq('并且真的提交了（不是只填进输入框）', submitCount, 1)

  // b. **负向对照**：用户自己打了字 → 不许顶掉他的字，直接发他那句。
  //    这一格要单独挂一次：上面那个 mount 没给 `useInput`，草稿永远是空串，走不到这条分支。
  {
    let mySubmit = 0
    let myDraft = null
    let myDraftCalls = 0
    const h = document.createElement('div')
    document.body.appendChild(h)
    const r = createRoot(h)
    await act(async () => {
      r.render(React.createElement(captured['conversation.view'], {
        cwd: UI, sessionId: 's1', useSessions: () => UI,
        inputActions: { setDraft: (t) => { myDraft = t; myDraftCalls++ }, submit: () => { mySubmit++ } },
        useInput: (sel) => sel({ draft: '我自己的话' }),
      }))
    })
    await flush()
    const noteToolBtn = Array.from(h.querySelectorAll('.ac-tools button')).find((b) => b.textContent.indexOf('留言') === 0)
    await act(async () => { noteToolBtn.click() })
    await flush()
    const btn = Array.from(h.querySelectorAll('.ac-lib-head button')).find((b) => b.textContent.includes('交给 AI'))
    ok('第二次挂载里也有那个按钮（否则下面两条是空断言）', !!btn)
    // 注意：自动补引用的 effect（见 [4n]）**已经**调过 setDraft 把 @n1 @n2 补进来了 ——
    // 那是另一件事。这里只看「点这个按钮有没有再多写一次」，所以取点击前后的差值。
    const callsBefore = myDraftCalls
    await act(async () => { btn.click() })
    await flush()
    eq('已经打了字就不动它（这个按钮一次 setDraft 都没加）', myDraftCalls - callsBefore, 0)
    eq('但照样提交', mySubmit, 1)
    await act(async () => { r.unmount() })
    h.remove()
  }

  const rows = () => Array.from(notesPanel()?.querySelectorAll('.ac-lib-row') || [])
  const n1Row = () => rows().find((r) => r.textContent.indexOf('n1') >= 0)
  const n3Row = () => rows().find((r) => r.textContent.indexOf('n3') >= 0)

  const n1ItemBtn = () => n1Row()?.querySelector('button.ac-lib-item')
  ok('未解决行：含 ✎、节点 id、label 与注释文本', !!n1ItemBtn() && n1ItemBtn().textContent.indexOf('✎ n1') >= 0 && n1ItemBtn().textContent.indexOf('节点甲') >= 0 && n1ItemBtn().textContent.indexOf('这里为什么不用队列？') >= 0, n1ItemBtn()?.textContent)
  const n1ResolveBtn = () => n1Row()?.querySelector('button.ac-btn')
  eq('待递行操作按钮为「不发了」', n1ResolveBtn()?.textContent.trim(), '不发了')

  const n3ItemBtn = () => n3Row()?.querySelector('button.ac-lib-item')
  ok('已解决行：class 含 done 且文案以 ✓ 开头', !!n3ItemBtn() && n3ItemBtn().classList.contains('done') && n3ItemBtn().textContent.indexOf('✓ n3') >= 0, n3ItemBtn()?.className)
  const n3ReopenBtn = () => n3Row()?.querySelector('button.ac-btn')
  eq('历史行操作按钮为「再送一次」', n3ReopenBtn()?.textContent.trim(), '再送一次')

  // 4. 在 .ac-notes 里点击「已解决」
  rpcCalls.length = 0
  await act(async () => { n1ResolveBtn().click() })
  await flush()

  const setCall1 = rpcCalls.find((c) => c.method === 'doc:set')
  ok('清单里点「已解决」发出 doc:set', !!setCall1)
  const setNode1 = setCall1?.args?.model?.nodes?.find((n) => n.id === 'n1')
  ok('doc:set 提交的模型里 n1.noteDone 为 true', setNode1 && setNode1.noteDone === true, setNode1)

  const n1ItemAfter = rows().find((r) => r.textContent.indexOf('n1') >= 0)?.querySelector('button.ac-lib-item')
  ok('行变为已解决状态（class 含 done，文案以 ✓ 开头）', !!n1ItemAfter && n1ItemAfter.classList.contains('done') && n1ItemAfter.textContent.indexOf('✓ n1') >= 0)
  eq('工具条待办数更新为 1，总量仍是 3', noteToolBtn()?.textContent.trim(), '留言 1 · 共 3')

  // 5. 选中节点乙（未解决）
  const n2El = findNodeEl('节点乙')
  await act(async () => {
    clickEl(n2El)
  })
  await flush()

  const dock = () => noteHost.querySelector('.ac-dock')
  ok('选中节点后底部检查器出现', !!dock() && dock().textContent.indexOf('节点 n2') >= 0)

  const noteArea = () => dock()?.querySelector('textarea[placeholder*="这里为什么不用队列"]')
  ok('检查器内出现注释 textarea 且 placeholder 符合预期', !!noteArea())
  eq('注释 textarea 内容为当前节点注释', noteArea()?.value, '这里需要限流')

  const markBtn = () => dock()?.querySelector('.ac-note-actions button')
  eq('有待递留言时按钮文案为「不发了」', markBtn()?.textContent.trim(), '不发了')

  const sendAiBtn = () => Array.from(dock()?.querySelectorAll('.ac-note-actions button') || []).find((b) => b.textContent.trim() === '发送给 AI')
  ok('检查器内出现「发送给 AI」按钮', !!sendAiBtn())
  ok('有留言时「发送给 AI」按钮可用', sendAiBtn() && !sendAiBtn().disabled)

  draftText = ''
  await act(async () => { sendAiBtn().click() })
  await flush()
  ok('点击「发送给 AI」调了 setDraft 且包含节点标题与留言', draftText.indexOf('节点乙') >= 0 && draftText.indexOf('这里需要限流') >= 0, draftText)

  rpcCalls.length = 0
  await act(async () => { markBtn().click() })
  await flush()

  const setCall2 = rpcCalls.find((c) => c.method === 'doc:set')
  ok('检查器点「不发了」发出 doc:set', !!setCall2)
  const setNode2 = setCall2?.args?.model?.nodes?.find((n) => n.id === 'n2')
  ok('doc:set 提交的模型里 n2.noteDone 为 true', setNode2 && setNode2.noteDone === true, setNode2)
  eq('收起之后检查器按钮文案变为「再送一次」', markBtn()?.textContent.trim(), '再送一次')

  // 6. 全部解决后的工具条与提示文案
  //    旧契约是「全部解决后变回『留言』」—— 那正是用户报的「总量统计漏了已解决的」：
  //    按钮上不再有数字，看起来像一条留言都没有。现在待办数归零，但**总量还在**。
  eq('全部解决后：待办数归零，总量仍报出来', noteToolBtn()?.textContent.trim(), '留言 · 共 3')
  ok('全部解决后按钮不再高亮（未解决时才是 primary）',
    !noteToolBtn()?.classList.contains('primary'), noteToolBtn()?.className)
  ok('提示里说清「共几条、其中几条待办」',
    (noteToolBtn()?.getAttribute('title') || '').indexOf('共 3 条，其中 0 条待递') >= 0,
    noteToolBtn()?.getAttribute('title'))
  ok('没有待递留言时面板提示「没有待递的留言」', notesPanel()?.textContent.indexOf('没有待递的留言') >= 0)

  // 7. 检查器点「重新打开」
  rpcCalls.length = 0
  await act(async () => { markBtn().click() })
  await flush()
  const setCall3 = rpcCalls.find((c) => c.method === 'doc:set')
  ok('检查器点「再送一次」发出 doc:set', !!setCall3)
  const setNode3 = setCall3?.args?.model?.nodes?.find((n) => n.id === 'n2')
  ok('doc:set 提交的模型里 n2.noteDone 为 false', setNode3 && setNode3.noteDone === false, setNode3)
  eq('放回待递后检查器按钮文案变回「不发了」', markBtn()?.textContent.trim(), '不发了')
  eq('重新打开后工具条待办数恢复为 1', noteToolBtn()?.textContent.trim(), '留言 1 · 共 3')

  // 8. 改一条**已解决**留言的正文 → 自动重新打开（用户报的「留言区被编辑后应该自动重新打开」）。
  //    不改的话，用户改过的话仍然躺在「已解决」里、不进 AI 的上下文 —— 界面看不出任何异常。
  const n3ElSel = findNodeEl('节点丙')
  await act(async () => {
    clickEl(n3ElSel)
  })
  await flush()
  eq('选中一条历史里的留言，检查器按钮为「再送一次」', markBtn()?.textContent.trim(), '再送一次')

  rpcCalls.length = 0
  const n3Area = () => dock()?.querySelector('textarea[placeholder*="这里为什么不用队列"]')
  const setAreaValue3 = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set
  await act(async () => {
    setAreaValue3.call(n3Area(), '已确认链路，但我又改了一下')
    n3Area().dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
  await flush()
  await act(async () => {
    n3Area().dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })
  await flush()

  const setCall4 = rpcCalls.find((c) => c.method === 'doc:set')
  ok('改已解决留言的正文发出 doc:set', !!setCall4, rpcCalls.map((c) => c.method))
  const setNode4 = setCall4?.args?.model?.nodes?.find((n) => n.id === 'n3')
  eq('改过正文后 n3.note 是新文本', setNode4?.note, '已确认链路，但我又改了一下')
  ok('改过正文后 n3.noteDone 自动变回 false（重新打开）', setNode4 && setNode4.noteDone === false, setNode4)
  eq('检查器按钮随之变回「不发了」', markBtn()?.textContent.trim(), '不发了')
  eq('工具条待办数把它算回来了', noteToolBtn()?.textContent.trim(), '留言 2 · 共 3')

  // 负向对照：只点「标记已解决」、不动正文时**不许**被自动重开
  // （否则「标记已解决」这个按钮自己会把自己掀回来，功能就废了）。
  rpcCalls.length = 0
  await act(async () => { markBtn().click() })
  await flush()
  const setCall5 = rpcCalls.find((c) => c.method === 'doc:set')
  const setNode5 = setCall5?.args?.model?.nodes?.find((n) => n.id === 'n3')
  ok('负向对照：只改状态、不改正文 → 仍是已解决', setNode5 && setNode5.noteDone === true, setNode5)
  eq('负向对照：按钮变回「再送一次」', markBtn()?.textContent.trim(), '再送一次')

  await act(async () => { noteRoot.unmount() })
  noteHost.remove()
  respond = prevRespond
}

console.log('\n[4d] 代码锚点与一句话总结：角标 / 失效可见 / 锚点编辑 / 清单里的总结')
{
  const REF_MODEL = {
    nodes: [
      { id: 'r0', label: '无锚点', shape: 'rect', group: null, x: 0, y: 0, note: '', noteDone: false, files: [] },
      { id: 'r1', label: '解析器', shape: 'rect', group: null, x: 140, y: 0, note: '', noteDone: false, files: ['src/host/mermaid.ts#parseMermaid'] },
      { id: 'r2', label: '坏锚点', shape: 'rect', group: null, x: 280, y: 0, note: '', noteDone: false, files: ['src/host/没了.ts'] },
    ],
    edges: [], groups: [], direction: 'TD', extras: [],
    summary: '这张图的一句话总结',
  }
  const REF_STATUS = {
    r1: { 'src/host/mermaid.ts#parseMermaid': 'ok' },
    r2: { 'src/host/没了.ts': 'missing' },
  }
  const REF_ITEMS = [
    { name: 'architecture', deleted: false, nodes: 3, edges: 0, links: 0, bytes: 300, project: '', key: 'architecture', dir: UI + '/.arch-canvas', rel: '.arch-canvas', relOutside: false, summary: '这张图的一句话总结' },
    { name: 'other', deleted: false, nodes: 2, edges: 1, links: 0, bytes: 120, project: '', key: 'other', dir: UI + '/.arch-canvas', rel: '.arch-canvas', relOutside: false, summary: '另一张图的总结' },
    // 子目录里的另一层：不在会话目录自己那一格图库里 → 界面要把它**在哪**摆出来
    { name: 'detail', deleted: false, nodes: 2, edges: 0, links: 0, bytes: 90, project: 'sub', key: 'sub/detail', dir: UI + '/sub/.arch-canvas', rel: 'sub/.arch-canvas', relOutside: true, summary: '子目录里的图' },
  ]

  const prevRespond = respond
  let currentModel = JSON.parse(JSON.stringify(REF_MODEL))
  let lastSetArgs = null
  let emptyMode = false
  respond = function (method, args) {
    if (emptyMode && method === 'doc:get') {
      return fullDoc({ model: EMPTY_MODEL, mermaid: 'flowchart TD\n', nodeCount: 0, summary: '这张图的一句话总结', fileStatus: {} })
    }
    if (method === 'doc:get') {
      return fullDoc({ model: currentModel, nodeCount: currentModel.nodes.length, summary: currentModel.summary, fileStatus: REF_STATUS })
    }
    if (method === 'doc:set') {
      lastSetArgs = args
      currentModel = args.model
      return fullDoc({ model: args.model, nodeCount: args.model.nodes.length, summary: args.model.summary, fileStatus: REF_STATUS, revision: 2, updatedBy: 'user' })
    }
    if (method === 'doc:list') {
      return {
        ok: true, dir: UI + '/.arch-canvas', scope: 'project', workspace: UI, current: 'architecture',
        external: null, items: REF_ITEMS, files: [], libraryRev: 2,
      }
    }
    return prevRespond(method, args)
  }

  const refHost = document.createElement('div')
  document.body.appendChild(refHost)
  const refRoot = createRoot(refHost)
  await act(async () => {
    refRoot.render(React.createElement(captured['conversation.view'], {
      cwd: UI, sessionId: 's1', useSessions: () => UI,
    }))
  })
  await flush()

  // 1. 角标：有锚点的节点右下角画 ▤，失效的变红（class broken）
  const refNodeEls = () => Array.from(refHost.querySelectorAll('g.ac-node'))
  const findRefNode = (lbl) => refNodeEls().find((el) => el.querySelector('.ac-lbl')?.textContent.trim() === lbl)
  ok('无锚点的节点不画锚点角标', !!findRefNode('无锚点') && !findRefNode('无锚点').querySelector('.ac-file-badge'))
  const okBadge = findRefNode('解析器')?.querySelector('.ac-file-badge')
  ok('有效锚点：class 为 ac-file-badge 且文字为 ▤',
    !!okBadge && okBadge.getAttribute('class') === 'ac-file-badge' && okBadge.querySelector('text')?.textContent.trim() === '▤')
  const badBadge = findRefNode('坏锚点')?.querySelector('.ac-file-badge')
  ok('失效锚点：class 为 ac-file-badge broken（画布上直接看得出来）',
    !!badBadge && badBadge.getAttribute('class') === 'ac-file-badge broken', badBadge?.getAttribute('class'))

  // 2. 检查器里的锚点输入框与逐条校验状态
  const selectRefNode = async (lbl) => {
    await act(async () => {
      clickEl(findRefNode(lbl))
    })
    await flush()
  }
  const refDock = () => refHost.querySelector('.ac-dock')
  const refArea = () => refDock()?.querySelector('textarea[placeholder^="例如：src/host/mermaid.ts"]')

  await selectRefNode('解析器')
  ok('检查器里有代码锚点 textarea', !!refArea())
  eq('textarea 内容是该节点的锚点', refArea()?.value, 'src/host/mermaid.ts#parseMermaid')
  eq('校验为 ok 的行带 ✓',
    refDock()?.querySelector('.ac-ref-status')?.textContent.indexOf('✓ src/host/mermaid.ts#parseMermaid') >= 0, true)

  await selectRefNode('坏锚点')
  eq('失效锚点的 textarea 内容', refArea()?.value, 'src/host/没了.ts')
  const badRow = refDock()?.querySelector('.ac-ref-status .ac-ref-bad')
  ok('失效锚点在检查器里标红并写明原因',
    !!badRow && badRow.textContent.indexOf('⚠') >= 0 && badRow.textContent.indexOf('文件不在') >= 0, badRow?.textContent)

  // 3. 改锚点：回车提交 → doc:set 带上新的 files
  rpcCalls.length = 0
  const setAreaValue = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set
  await act(async () => {
    setAreaValue.call(refArea(), 'src/host/mermaid.ts\n\n  src/client/runtime.ts#cloneModel  ')
    refArea().dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
  await flush()
  await act(async () => {
    refArea().dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })
  await flush()

  const refSet = rpcCalls.find((c) => c.method === 'doc:set')
  ok('回车提交锚点发出 doc:set', !!refSet, rpcCalls.map((c) => c.method))
  const refNodeAfter = refSet?.args?.model?.nodes?.find((n) => n.id === 'r2')
  ok('提交的模型里锚点按行切分、trim、丢掉空行',
    JSON.stringify(refNodeAfter?.files) === JSON.stringify(['src/host/mermaid.ts', 'src/client/runtime.ts#cloneModel']),
    refNodeAfter?.files)
  ok('提交的模型里带上了一句话总结（图级字段不能被界面弄丢）',
    refSet?.args?.model?.summary === '这张图的一句话总结', refSet?.args?.model?.summary)

  // 4. 图库选择器里每张图带上它的一句话总结
  const openToolBtn = Array.from(refHost.querySelectorAll('.ac-tools button')).find((b) => b.getAttribute('title')?.startsWith('打开项目里的'))
  await act(async () => { openToolBtn.click() })
  await flush()
  const libItemTexts = Array.from(refHost.querySelectorAll('.ac-lib-item')).map((b) => b.textContent)
  ok('选择器里当前这张图带上了 summary',
    libItemTexts.some((t) => t.indexOf('architecture') >= 0 && t.indexOf('这张图的一句话总结') >= 0), libItemTexts)
  ok('选择器里别的图也带上了 summary',
    libItemTexts.some((t) => t.indexOf('other') >= 0 && t.indexOf('另一张图的总结') >= 0), libItemTexts)
  ok('选择器里不在会话目录自己图库的那张标出了位置（目录关系）',
    libItemTexts.some((t) => t.indexOf('sub/detail') >= 0 && t.indexOf('在 sub/.arch-canvas') >= 0), libItemTexts)

  // 5. 起始页（空图）里也用总结说明「这个项目里有什么图」
  emptyMode = true
  const startHost = document.createElement('div')
  document.body.appendChild(startHost)
  const startRoot = createRoot(startHost)
  await act(async () => {
    startRoot.render(React.createElement(captured['conversation.view'], {
      cwd: UI, sessionId: 's2', useSessions: () => UI,
    }))
  })
  await flush()
  const startSums = Array.from(startHost.querySelectorAll('.ac-start-sum')).map((el) => el.textContent)
  ok('起始页的图列表里显示别的图的 summary', startSums.indexOf('另一张图的总结') >= 0, startSums)
  ok('起始页里不在会话目录自己图库的那张也标出了位置',
    startHost.textContent.indexOf('在 sub/.arch-canvas') >= 0, startHost.textContent.slice(0, 300))
  emptyMode = false

  await act(async () => { startRoot.unmount() })
  await act(async () => { refRoot.unmount() })
  startHost.remove()
  refHost.remove()
  respond = prevRespond
}

console.log('\n[4e] 检查点清单：谁改的、点「退回」真发 RPC')
{
  const HIST_MODEL = {
    nodes: [
      { id: 'h1', label: '入口', shape: 'rect', group: null, x: 0, y: 0, note: '', noteDone: false, files: [] },
      { id: 'h2', label: '核心（用户改）', shape: 'rect', group: null, x: 140, y: 0, note: '', noteDone: false, files: [] },
    ],
    edges: [], groups: [], direction: 'TD', extras: [], summary: '',
  }
  const AI_MODEL = {
    nodes: [
      { id: 'h1', label: '入口', shape: 'rect', group: null, x: 0, y: 0, note: '', noteDone: false, files: [] },
      { id: 'h2', label: '核心', shape: 'rect', group: null, x: 140, y: 0, note: '', noteDone: false, files: [] },
      { id: 'hCache', label: '缓存层', shape: 'rect', group: null, x: 280, y: 0, note: '', noteDone: false, files: [] },
    ],
    edges: [], groups: [], direction: 'TD', extras: [], summary: '',
  }
  const T0 = Date.now()
  let HIST_ENTRIES = [
    { seq: 3, rev: 3, by: 'user', at: T0, site: 'doc:set', nodeCount: 2, edgeCount: 0, changed: ['h2'], current: true },
    { seq: 2, rev: 2, by: 'ai', at: T0 - 60000, site: 'arch_edit', nodeCount: 3, edgeCount: 0, changed: ['hCache'], current: false },
    { seq: 1, rev: 0, by: 'open', at: T0 - 120000, site: 'open', nodeCount: 2, edgeCount: 0, changed: [], current: false },
  ]

  const prevRespond = respond
  let curModel = JSON.parse(JSON.stringify(HIST_MODEL))
  let rollbackArgs = null
  respond = function (method, args) {
    if (method === 'doc:get') {
      return fullDoc({ model: curModel, nodeCount: curModel.nodes.length, historyCount: HIST_ENTRIES.length })
    }
    if (method === 'doc:history') {
      return { ok: true, file: UI + '/.arch-canvas/architecture.mmd', diagram: 'architecture', limit: 50, entries: HIST_ENTRIES }
    }
    if (method === 'doc:rollback') {
      rollbackArgs = args
      // 宿主会把「退回到的那一份」装回文档，并在末尾追加一条 by=user 的检查点
      curModel = JSON.parse(JSON.stringify(AI_MODEL))
      HIST_ENTRIES = [
        { seq: 4, rev: 4, by: 'user', at: Date.now(), site: 'rollback:' + args.seq, nodeCount: 3, edgeCount: 0, changed: [], current: true },
        ...HIST_ENTRIES,
      ]
      return fullDoc({ model: curModel, nodeCount: curModel.nodes.length, historyCount: HIST_ENTRIES.length, revision: 4, updatedBy: 'user' })
    }
    return prevRespond(method, args)
  }

  const histHost = document.createElement('div')
  document.body.appendChild(histHost)
  const histRoot = createRoot(histHost)
  await act(async () => {
    histRoot.render(React.createElement(captured['conversation.view'], {
      cwd: UI, sessionId: 's1', useSessions: () => UI,
    }))
  })
  await flush()

  const histBtns = () => Array.from(histHost.querySelectorAll('.ac-bar button'))
  const histBtn = () => histBtns().find((b) => b.textContent.indexOf('历史') === 0)
  ok('顶栏「历史」按钮带条数', !!histBtn() && histBtn().textContent.trim() === '历史 3', histBtns().map((b) => b.textContent))

  rpcCalls.length = 0
  await act(async () => { histBtn().click() })
  await flush()

  const panel = () => histHost.querySelector('.ac-hist')
  ok('点开后出现检查点面板', !!panel())
  const histCall = rpcCalls.find((c) => c.method === 'doc:history')
  ok('打开面板时拉清单，并带上会话上下文', !!histCall && histCall.args.where === UI && histCall.args.session === 's1', histCall && histCall.args)
  ok('面板头部说明「只在内存里，重启会清空」', (panel()?.querySelector('.ac-lib-head')?.textContent || '').indexOf('重启 dsh 会清空') >= 0,
    panel()?.querySelector('.ac-lib-head')?.textContent)

  const rows = () => Array.from(panel()?.querySelectorAll('.ac-lib-row') || [])
  eq('三份检查点都列出来了', rows().length, 3)
  const aiRow = rows().find((r) => r.textContent.indexOf('AI') === 0)
  const userRow = rows().find((r) => r.textContent.indexOf('● 用户') === 0)
  ok('AI 那一行标出作者与改动节点', !!aiRow && aiRow.textContent.indexOf('hCache') >= 0, aiRow?.textContent)
  ok('AI 那一行带 ai 样式（左侧蓝条）', !!aiRow && aiRow.querySelector('.ac-hist-item')?.classList.contains('ai'), aiRow?.querySelector('.ac-hist-item')?.className)
  ok('当前那一行标「当前」且没有退回按钮',
    !!userRow && userRow.textContent.indexOf('当前') >= 0 && !userRow.querySelector('button'), userRow?.textContent)

  // 点「退回」先要确认（与删除图同一种谨慎）
  const backBtn = () => aiRow.querySelector('button')
  eq('非当前行的按钮是「退回」', backBtn()?.textContent.trim(), '退回')
  await act(async () => { backBtn().click() })
  await flush()
  const yes = () => Array.from(aiRow.querySelectorAll('button')).find((b) => b.textContent.trim() === '确认退回')
  ok('点一下先变成确认（不直接退回）', !!yes(), Array.from(aiRow.querySelectorAll('button')).map((b) => b.textContent))

  rpcCalls.length = 0
  await act(async () => { yes().click() })
  await flush()

  ok('确认后发出 doc:rollback', !!rollbackArgs, rpcCalls.map((c) => c.method))
  eq('带上要退回的 seq', rollbackArgs && rollbackArgs.seq, 2)
  eq('带上 where（历史按文件存，宿主得落到同一个图库）', rollbackArgs && rollbackArgs.where, UI)
  const labelsAfter = Array.from(histHost.querySelectorAll('g.ac-node .ac-lbl')).map((el) => el.textContent.trim())
  ok('退回后画布换成那份快照的内容', labelsAfter.indexOf('缓存层') >= 0, labelsAfter)
  const histBtnAfter = histBtns().find((b) => b.textContent.indexOf('历史') === 0)
  ok('退回本身也留了一份（条数从 3 变 4）', !!histBtnAfter && histBtnAfter.textContent.trim() === '历史 4', histBtnAfter?.textContent)

  await act(async () => { histRoot.unmount() })
  histHost.remove()
  respond = prevRespond
}

console.log('\n[4f] 节点卡片分段与源码页解析警告')
{
  const CARD_MODEL = {
    nodes: [
      {
        id: 'c1',
        label: '核心服务\n意图：处理高并发请求\n原理：基于事件循环与非阻塞IO\n补充说明行',
        shape: 'rect', group: null, x: 100, y: 100,
        note: '', noteDone: false,
        files: ['src/server/core.ts#startServer'],
      },
      {
        id: 'c0',
        label: '单行无锚点',
        shape: 'rect', group: null, x: 300, y: 100,
        note: '', noteDone: false,
        files: [],
      },
    ],
    edges: [], groups: [], direction: 'TD', extras: [], summary: '',
  }
  const SAMPLE_WARNS = ['第 3 行没能解析', '注释 @note n9 指向不存在的节点']

  const prevRespond = respond
  let currentModel = JSON.parse(JSON.stringify(CARD_MODEL))
  let currentWarnings = SAMPLE_WARNS
  respond = function (method, args) {
    if (method === 'doc:get') {
      return fullDoc({
        model: currentModel,
        nodeCount: currentModel.nodes.length,
        warnings: currentWarnings,
      })
    }
    return prevRespond(method, args)
  }

  const cardHost = document.createElement('div')
  document.body.appendChild(cardHost)
  const cardRoot = createRoot(cardHost)
  await act(async () => {
    cardRoot.render(React.createElement(captured['conversation.view'], {
      cwd: UI, sessionId: 's1', useSessions: () => UI,
    }))
  })
  await flush()

  // 1. 节点卡片分段渲染
  const cardNodes = () => Array.from(cardHost.querySelectorAll('g.ac-node'))
  const findCardNode = (firstLine) => cardNodes().find((el) => el.querySelector('.ac-lbl')?.textContent.trim() === firstLine)
  const c1El = findCardNode('核心服务')
  const c0El = findCardNode('单行无锚点')

  // a. 多行 label 的节点：.ac-lbl 的 textContent 恰好等于第一段
  eq('多行节点的 .ac-lbl textContent 恰好等于第一段标题', c1El?.querySelector('.ac-lbl')?.textContent, '核心服务')

  // a2. 默认（未选中）**只画标题**：描述与引用行都不渲染 —— 这是刻意的空间节省，
  //     所以必须是负向断言（元素不存在），而不是"有但看不见"。
  ok('未选中时节点不画 .ac-desc', !c1El?.querySelector('.ac-desc'))
  ok('未选中时节点不画 .ac-ref', !c1El?.querySelector('.ac-ref'))
  // 记下**未选中时**的方块高度 —— 下面要证明"选中不改变几何"
  const c1HeightIdle = c1El?.querySelector('rect:not(.ac-pulse)')?.getAttribute('height')

  // a3. 点一下节点 = 选中 = 展开：描述与引用行这时才出现。
  await act(async () => {
    clickEl(c1El)
  })
  await flush()
  // a3. 选中**不再展开**（2026-09 用户要求取消就地展开，具体信息一律去检查器里看）。
  //     所以这里是负向契约：点开之后画布上依然只有标题。
  const c1Open = findCardNode('核心服务')
  ok('选中后画布节点依然不画 .ac-desc（不再就地展开）', !c1Open?.querySelector('.ac-desc'))
  ok('选中后画布节点依然不画 .ac-ref', !c1Open?.querySelector('.ac-ref'))
  eq('选中后 .ac-lbl 仍然只是标题那一段', c1Open?.querySelector('.ac-lbl')?.textContent, '核心服务')

  // a4. 取消展开带来的一条硬性质：**选中不改变节点几何**。
  //     尺寸要是还跟着 sel 走，点一下方块就会让它长大一圈 —— 连在它上面的线全都要重画，
  //     看上去就是"点一下就抖"。所以直接量方块高度，选中前后必须一样。
  eq('节点高度不随选中变化（几何稳定，连线不会因为点一下而重画）',
    c1Open?.querySelector('rect:not(.ac-pulse)')?.getAttribute('height'), c1HeightIdle)

  // a5. 描述与引用没有丢 —— 它们现在只在检查器里（那一侧由 [4d] 节守着）。
  //     这里钉的是画布这一侧：一个都不画。
  ok('选中后画布上不再出现完整 label（只剩标题，没有「意图/原理」那些行）',
    (c1Open?.querySelector('.ac-lbl')?.textContent || '').indexOf('意图') < 0,
    c1Open?.querySelector('.ac-lbl')?.textContent)
  // d. 锚点行也只在检查器里 —— 画布上不再有 .ac-ref（见上面 a3 的负向契约）。

  // e. 负向对照：不带 files 的节点**即使展开**也没有 .ac-ref。
  //    必须展开后再断言 —— 不展开的话"没有 .ac-ref"是必然的，断言会恒真、抓不到任何回归。
  await act(async () => {
    clickEl(c0El)
  })
  await flush()
  const c0Open = findCardNode('单行无锚点')
  ok('不带 files 的节点没有 .ac-ref', !c0Open?.querySelector('.ac-ref'))

  // f. 负向对照：单行 label 的节点展开后仍没有 .ac-desc（它本来就没有描述段）
  ok('单行 label 的节点没有 .ac-desc', !c0Open?.querySelector('.ac-desc'))

  // 2. 源码页解析警告
  // g. warnings 非空时切到源码页，.ac-warn 存在、.ac-warn-h 含条数、.ac-warn-i 条数与 warnings 数一致
  const tabs = Array.from(cardHost.querySelectorAll('.ac-tabs button'))
  const textTab = tabs.find((b) => b.textContent.trim() === '源码')
  ok('找到「源码」标签按钮', !!textTab)
  await act(async () => { textTab.click() })
  await flush()

  const warnBox = cardHost.querySelector('.ac-warn')
  ok('warnings 非空时源码页显示 .ac-warn', !!warnBox)
  const warnH = warnBox?.querySelector('.ac-warn-h')
  ok('.ac-warn-h 文案包含条数与警告标记', (warnH?.textContent || '').indexOf('2') >= 0 && (warnH?.textContent || '').indexOf('⚠ 解析警告') >= 0, warnH?.textContent)
  const warnItems = Array.from(warnBox?.querySelectorAll('.ac-warn-i') || [])
  eq('.ac-warn-i 条数与 warnings 数量一致', warnItems.length, SAMPLE_WARNS.length)
  ok('第 1 条 warning 文本匹配', warnItems[0]?.textContent === SAMPLE_WARNS[0], warnItems[0]?.textContent)
  ok('第 2 条 warning 文本匹配', warnItems[1]?.textContent === SAMPLE_WARNS[1], warnItems[1]?.textContent)

  await act(async () => { cardRoot.unmount() })
  cardHost.remove()

  // h. 负向对照：warnings 为空时没有 .ac-warn
  currentWarnings = []
  const cleanHost = document.createElement('div')
  document.body.appendChild(cleanHost)
  const cleanRoot = createRoot(cleanHost)
  await act(async () => {
    cleanRoot.render(React.createElement(captured['conversation.view'], {
      cwd: UI, sessionId: 's1', useSessions: () => UI,
    }))
  })
  await flush()

  const cleanTabs = Array.from(cleanHost.querySelectorAll('.ac-tabs button'))
  const cleanTextTab = cleanTabs.find((b) => b.textContent.trim() === '源码')
  await act(async () => { cleanTextTab.click() })
  await flush()

  ok('warnings 为空时源码页没有 .ac-warn', !cleanHost.querySelector('.ac-warn'))

  await act(async () => { cleanRoot.unmount() })
  cleanHost.remove()
  respond = prevRespond
}

console.log('\n[4g] 源码页语法高亮')
{
  const HL_MERMAID = [
    '%%! @note 格式说明模板',
    '%% @pos n1 0 0',
    '%% @note n1 这里是注释',
    'flowchart TD',
    '  n1["标签"] --> n2 --o n3 o==> n9["a < b & c"]',
  ].join('\n')

  const prevRespond = respond
  respond = function (method, args) {
    if (method === 'doc:get') {
      return fullDoc({
        mermaid: HL_MERMAID,
      })
    }
    return prevRespond(method, args)
  }

  const hlHost = document.createElement('div')
  document.body.appendChild(hlHost)
  const hlRoot = createRoot(hlHost)
  await act(async () => {
    hlRoot.render(React.createElement(captured['conversation.view'], {
      cwd: UI, sessionId: 's1', useSessions: () => UI,
    }))
  })
  await flush()

  // 切到源码页
  const tabs = Array.from(hlHost.querySelectorAll('.ac-tabs button'))
  const textTab = tabs.find((b) => b.textContent.trim() === '源码')
  ok('找到「源码」标签按钮', !!textTab)
  await act(async () => { textTab.click() })
  await flush()

  // a. 切到源码页后，.ac-hl 与 textarea.ac-area 同时存在
  const hlPre = hlHost.querySelector('pre.ac-hl')
  const area = hlHost.querySelector('textarea.ac-area')
  ok('源码页内存在 pre.ac-hl 高亮底层', !!hlPre)
  ok('源码页内存在 textarea.ac-area 编辑层', !!area)
  ok('.ac-editwrap 容器内包裹 pre.ac-hl 与 textarea', !!hlHost.querySelector('.ac-editwrap pre.ac-hl') && !!hlHost.querySelector('.ac-editwrap textarea.ac-area'))

  // ---- 用户报的源码页两个 bug（文本逐渐变白 / 滚轮滑不动）----
  // 两个症状都出在这一层 CSS 上，所以这里直接量规则文本，不靠"看着像"。
  const cssRule = (sel) => {
    const i = insertedCss.indexOf(sel + '{')
    return i < 0 ? '' : insertedCss.slice(i + sel.length + 1, insertedCss.indexOf('}', i))
  }
  const pulseRule = cssRule('.ac-pulse')
  const hlRule = cssRule('.ac-hl')
  const areaHlRule = cssRule('.ac-area-hl')
  const wrapRule = cssRule('.ac-textwrap')
  // 「文本逐渐变白」的根因：脉动环（SVG <rect>）与代码高亮层（DOM <pre>）从前共用 .ac-hl，
  // 于是 `animation:acPulse ... forwards` 被一起焊在代码层上 —— 终帧 opacity:0，2.6 秒后整层透明。
  ok('脉动环有自己的类 .ac-pulse，动画挂在它身上', pulseRule.indexOf('acPulse') >= 0, pulseRule)
  ok('负向对照：代码高亮层 .ac-hl 上不再有 animation / acPulse',
    hlRule.indexOf('animation') < 0 && hlRule.indexOf('acPulse') < 0, hlRule)
  ok('关键帧 acPulse 的终帧确实是 opacity:0（所以上面那条负向断言不是空转）',
    /@keyframes acPulse\{[^@]*100%\{opacity:0\}\}/.test(insertedCss))
  ok('脉动环用的还是同一个动画名（换类名没有把环本身弄坏）',
    insertedCss.indexOf('@keyframes acPulse') >= 0 && pulseRule.indexOf('animation:acPulse') >= 0, pulseRule)
  // 「滚轮滑不动」：两个滚动口互相同步注定错位；现在两层都不滚动，页级 .ac-textwrap 是唯一的口。
  ok('代码高亮层不再自己滚动（没有 overflow:auto）', hlRule.indexOf('overflow:auto') < 0, hlRule)
  ok('编辑层也不再自己滚动（overflow:hidden，高度跟着 <pre> 走）', areaHlRule.indexOf('overflow:hidden') >= 0, areaHlRule)
  ok('唯一滚动口 .ac-textwrap 是 overflow:auto', wrapRule.indexOf('overflow:auto') >= 0, wrapRule)
  ok('滚动口里的子项一律不压缩（否则列向 flex 把它们挤扁，永远超不出去）',
    cssRule('.ac-textwrap > *').indexOf('flex:0 0 auto') >= 0, cssRule('.ac-textwrap > *'))
  ok('源码区直接挂在滚动口下', !!hlHost.querySelector('.ac-textwrap > .ac-editwrap'))
  ok('编辑层是绝对定位铺满 <pre> 撑出的高度', areaHlRule.indexOf('position:absolute') >= 0, areaHlRule)
  ok('<pre> 回到正常流（由它决定滚动高度）', hlRule.indexOf('position:relative') >= 0, hlRule)
  // 两层必须逐项对齐，差一项光标就与文字错位 —— tab-size 从前只有 <pre> 有（textarea 默认 8）
  ok('两层的 tab-size 一致', hlRule.indexOf('tab-size:2') >= 0 && areaHlRule.indexOf('tab-size:2') >= 0, hlRule + ' || ' + areaHlRule)

  // 行容器：.ac-hl 内每行一个 <div>
  const lineDivs = Array.from(hlPre?.querySelectorAll('div') || [])
  eq('高亮行数与文本行数一致（每行一个 div）', lineDivs.length, HL_MERMAID.split('\n').length)

  // 辅助函数：在一行内找到某个 class 的 token span
  const findTokenInLine = (lineIdx, cls) => lineDivs[lineIdx]?.querySelector('span.' + cls)
  const allTokensInLine = (lineIdx) => Array.from(lineDivs[lineIdx]?.querySelectorAll('span') || [])

  // c. %%! 开头的说明行归 ac-hl-c（第 0 行）
  const cToken = findTokenInLine(0, 'ac-hl-c')
  ok('%%! 说明行归 ac-hl-c', !!cToken && cToken.textContent.indexOf('%%! @note') >= 0, cToken?.textContent)

  // d. %% @pos n1 0 0 归 ac-hl-m（第 1 行）
  const mToken = findTokenInLine(1, 'ac-hl-m')
  ok('%% @pos 元数据行归 ac-hl-m', !!mToken && mToken.textContent.indexOf('%% @pos') >= 0, mToken?.textContent)

  // b. 桩文本里的 %% @note n1 xxx 这一行渲染出的 token class 含 ac-hl-u（第 2 行）
  const uToken = findTokenInLine(2, 'ac-hl-u')
  ok('%% @note 用户数据行归 ac-hl-u', !!uToken && uToken.textContent.indexOf('%% @note') >= 0, uToken?.textContent)

  // e. flowchart 是 ac-hl-k（第 3 行）
  const kToken = findTokenInLine(3, 'ac-hl-k')
  ok('flowchart 关键字归 ac-hl-k', !!kToken && kToken.textContent.trim() === 'flowchart', kToken?.textContent)

  // f. n1["标签"] 里的 "标签" 是 ac-hl-s（第 4 行）
  const sTokens = Array.from(lineDivs[4]?.querySelectorAll('span.ac-hl-s') || [])
  const labelStrToken = sTokens.find((s) => s.textContent === '"标签"')
  ok('"标签" 字符串字面量归 ac-hl-s', !!labelStrToken, sTokens.map((s) => s.textContent))

  // g. 连线箭头归 ac-hl-a（第 4 行，覆盖标准箭头 --> 与扩展连接符 --o / o==>）
  const aTokens = Array.from(lineDivs[4]?.querySelectorAll('span.ac-hl-a') || []).map((s) => s.textContent.trim())
  ok('--> 连线箭头归 ac-hl-a', aTokens.includes('-->') && aTokens.includes('--o') && aTokens.includes('o==>'), aTokens)

  // h. 负向对照（安全）：桩文本里含 < 和 &（"a < b & c"），内部没有真的 <b> 等 HTML 元素被创建
  ok('.ac-hl 内部没有真的 <b> 元素生成', !hlPre?.querySelector('b'))
  // 且字符串里的 < 和 & 作为纯文本渲染，没被二次实体转义成 &amp; 字符展示
  const htmlRaw = hlPre?.innerHTML || ''
  ok('pre 内没有未闭合或误解析的 HTML 标签结构', htmlRaw.indexOf('<b ') === -1 && htmlRaw.indexOf('<b>') === -1)
  const escapedStrToken = sTokens.find((s) => s.textContent === '"a < b & c"')
  ok('"a < b & c" 作为文本原样保留在 span 中', !!escapedStrToken && escapedStrToken.textContent === '"a < b & c"', escapedStrToken?.textContent)

  await act(async () => { hlRoot.unmount() })
  hlHost.remove()
  respond = prevRespond
}

console.log('\n[4h] 组折叠')
{
  const FOLD_MODEL = {
    nodes: [
      { id: 'f1', label: '服务A', shape: 'rect', group: 'g1', x: 100, y: 100, note: '', noteDone: false, files: [] },
      { id: 'f2', label: '服务B', shape: 'rect', group: 'g1', x: 100, y: 220, note: '', noteDone: false, files: [] },
      { id: 'f3', label: '外部网关', shape: 'rect', group: null, x: 300, y: 160, note: '', noteDone: false, files: [] },
    ],
    edges: [
      { from: 'f3', to: 'f1', arrow: '-->', label: '' },
    ],
    groups: [
      { id: 'g1', label: '核心组' },
    ],
    direction: 'TD', extras: [], summary: '',
  }

  const prevRespond = respond
  let currentModel = JSON.parse(JSON.stringify(FOLD_MODEL))
  respond = function (method, args) {
    if (method === 'doc:get') {
      return fullDoc({
        model: currentModel,
        nodeCount: currentModel.nodes.length,
        edgeCount: currentModel.edges.length,
        groupCount: currentModel.groups.length,
      })
    }
    return prevRespond(method, args)
  }

  const foldHost = document.createElement('div')
  document.body.appendChild(foldHost)
  const foldRoot = createRoot(foldHost)
  await act(async () => {
    foldRoot.render(React.createElement(captured['conversation.view'], {
      cwd: UI, sessionId: 's1', useSessions: () => UI,
    }))
  })
  await flush()

  // a. 默认（未折叠）存在 .ac-group-box 与 .ac-group-lbl；标签是**纯组名**，箭头在独立按钮上
  const groupBox = foldHost.querySelector('rect.ac-group-box')
  const groupLbl = foldHost.querySelector('text.ac-group-lbl')
  ok('默认存在 .ac-group-box 组大框', !!groupBox)
  ok('默认存在 .ac-group-lbl 组标签', !!groupLbl)
  eq('组标签是纯组名（箭头已挪到按钮上）', groupLbl?.textContent, '核心组')
  const groupBtn = foldHost.querySelector('g.ac-group-btn')
  ok('默认存在收起按钮 .ac-group-btn', !!groupBtn)
  eq('收起按钮的文字是 ▾', groupBtn?.querySelector('text')?.textContent, '▾')

  // b. 负向对照：默认不存在 .ac-fold
  ok('默认不存在 .ac-fold 折叠块', !foldHost.querySelector('.ac-fold'))

  const edgesBefore = Array.from(foldHost.querySelectorAll('path.ac-edge'))
  eq('默认跨组边渲染且条数为 1', edgesBefore.length, 1)
  const edgeD1 = edgesBefore[0]?.getAttribute('d')

  // c1. **负向对照**：点组名、点组框都**不**折叠 —— 收起/展开只认按钮。
  //     这是刻意的：组块长得像个节点，点它多半是想选中或拖它，顺手把它弹开是最烦的误触。
  const clickGroup = async (el) => {
    await act(async () => {
      clickEl(el)
    })
    await flush()
  }
  await clickGroup(groupLbl)
  ok('点组名不会折叠', !foldHost.querySelector('.ac-fold'))
  await clickGroup(groupBox)
  ok('点组框不会折叠', !foldHost.querySelector('.ac-fold'))

  // c2. 点那个按钮才会折叠
  await clickGroup(groupBtn)

  const foldEl = foldHost.querySelector('.ac-fold')
  ok('点收起按钮后出现 .ac-fold 折叠块', !!foldEl)
  ok('点收起按钮后 .ac-group-box 消失', !foldHost.querySelector('rect.ac-group-box'))

  // d. .ac-fold-lbl 的文字是「组名（N）」—— 箭头同样在独立按钮上
  const foldLbl = foldHost.querySelector('text.ac-fold-lbl')
  const memberCount = FOLD_MODEL.nodes.filter((n) => n.group === 'g1').length
  eq('.ac-fold-lbl 文字为 组名（N）且 N 等于成员数', foldLbl?.textContent, `核心组（${memberCount}）`)
  eq('展开按钮的文字是 ▸', foldHost.querySelector('g.ac-fold-btn text')?.textContent, '▸')

  // e. 负向对照：折叠后，该组内的成员节点不再出现在 g.ac-node 列表中
  const nodeLabelsAfterFold = Array.from(foldHost.querySelectorAll('g.ac-node .ac-lbl')).map((el) => el.textContent.trim())
  ok('折叠后组内成员节点不再出现在 g.ac-node 中', !nodeLabelsAfterFold.includes('服务A') && !nodeLabelsAfterFold.includes('服务B'))
  ok('外部节点仍然在 g.ac-node 中渲染', nodeLabelsAfterFold.includes('外部网关'))

  // g. 跨组边仍保留：折叠后 path.ac-edge 的条数与折叠前相同（边改接到折叠块，不是被删掉）
  const edgesAfterFold = Array.from(foldHost.querySelectorAll('path.ac-edge'))
  eq('跨组边仍保留：折叠后 path.ac-edge 条数与折叠前相同', edgesAfterFold.length, edgesBefore.length)
  const edgeD2 = edgesAfterFold[0]?.getAttribute('d')
  ok('跨组边端点改接至折叠块（连线路径重新计算）', !!edgeD1 && !!edgeD2 && edgeD1 !== edgeD2)

  // f. 负向对照：点折叠块本体不展开；点它的按钮才复原
  await clickGroup(foldHost.querySelector('rect.ac-fold-box'))
  ok('点折叠块本体不会展开', !!foldHost.querySelector('.ac-fold'))
  await clickGroup(foldHost.querySelector('g.ac-fold-btn'))

  ok('点展开按钮后 .ac-group-box 回来', !!foldHost.querySelector('rect.ac-group-box'))
  ok('点展开按钮后 .ac-fold 消失', !foldHost.querySelector('.ac-fold'))
  const restoredNodeLabels = Array.from(foldHost.querySelectorAll('g.ac-node .ac-lbl')).map((el) => el.textContent.trim())
  ok('复原后成员节点全部回到 g.ac-node', restoredNodeLabels.includes('服务A') && restoredNodeLabels.includes('服务B'))

  await act(async () => { foldRoot.unmount() })
  foldHost.remove()

  // h. 组内边不渲染：桩模型里放一条两端同组的边，折叠后 path.ac-edge 条数比折叠前少 1
  const INTRA_MODEL = {
    nodes: [
      { id: 'm1', label: '组内A', shape: 'rect', group: 'g2', x: 100, y: 100, note: '', noteDone: false, files: [] },
      { id: 'm2', label: '组内B', shape: 'rect', group: 'g2', x: 100, y: 220, note: '', noteDone: false, files: [] },
      { id: 'm3', label: '外部C', shape: 'rect', group: null, x: 300, y: 160, note: '', noteDone: false, files: [] },
    ],
    edges: [
      { from: 'm1', to: 'm2', arrow: '-->', label: '' }, // 组内边（两端同组）
      { from: 'm3', to: 'm1', arrow: '-->', label: '' }, // 跨组边
    ],
    groups: [
      { id: 'g2', label: '数据组' },
    ],
    direction: 'TD', extras: [], summary: '',
  }

  currentModel = JSON.parse(JSON.stringify(INTRA_MODEL))

  const intraHost = document.createElement('div')
  document.body.appendChild(intraHost)
  const intraRoot = createRoot(intraHost)
  await act(async () => {
    intraRoot.render(React.createElement(captured['conversation.view'], {
      cwd: UI, sessionId: 's1', useSessions: () => UI,
    }))
  })
  await flush()

  const intraEdgesBefore = Array.from(intraHost.querySelectorAll('path.ac-edge'))
  eq('折叠前共有 2 条边（1 跨组 + 1 组内）', intraEdgesBefore.length, 2)

  await act(async () => {
    intraHost.querySelector('g.ac-group-btn').dispatchEvent(new dom.window.PointerEvent('pointerdown', { bubbles: true, button: 0 }))
  })
  await flush()

  const intraEdgesAfter = Array.from(intraHost.querySelectorAll('path.ac-edge'))
  eq('组内边不渲染：折叠后 path.ac-edge 条数比折叠前少 1', intraEdgesAfter.length, intraEdgesBefore.length - 1)

  await act(async () => { intraRoot.unmount() })
  intraHost.remove()

  respond = prevRespond
}

endPhase()
