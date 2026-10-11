// 宿主回执的唯一落地口 applyServer（组件里仍过 React.useCallback，依赖数组不变）。
// 从 studio.ts 的 ArchStudio 组件体里原样搬出来的顶层函数 —— 行为不变。
// 分片共享同一段作用域、不能 import，所以靠参数 S（本帧的 state / setter / ref 集合）通信。
function makeApplyServer(S) {
  var committedRef = S.committedRef, currentDiagramRef = S.currentDiagramRef, diagKeyRef = S.diagKeyRef, dockForRef = S.dockForRef, driftRef = S.driftRef, fileStatusRef = S.fileStatusRef
  var fittedRef = S.fittedRef, histRef = S.histRef, libRevRef = S.libRevRef, memoKeyRef = S.memoKeyRef, nudgeRef = S.nudgeRef, revRef = S.revRef
  var selRef = S.selRef, setDockOpen = S.setDockOpen, setDraft = S.setDraft, setDragHint = S.setDragHint, setDriftTick = S.setDriftTick, setExternal = S.setExternal
  var setFilePath = S.setFilePath, setFileStatusTick = S.setFileStatusTick, setHistTick = S.setHistTick, setHistoryCount = S.setHistoryCount, setLibDir = S.setLibDir, setLibKey = S.setLibKey
  var setLinkPt = S.setLinkPt, setMermaidText = S.setMermaidText, setRevision = S.setRevision, setSel = S.setSel, setStatus = S.setStatus, setUpdatedBy = S.setUpdatedBy
  var setView = S.setView, setWarnings = S.setWarnings, sidRef = S.sidRef, viewRef = S.viewRef
  function flash(...args) { return S.flash.apply(null, args) }
  function remember(...args) { return S.remember.apply(null, args) }
  function setLocal(...args) { return S.setLocal.apply(null, args) }
  function applyServer(r, origin) {
    if (!r || !r.ok) return
    // 这一份文档的身份。图库里的图有 key/diagram，**外部文件只有 file** 认得出来 ——
    // 记忆里带着撤销栈，把 A 的历史还到 B 头上就是拿 A 的内容覆盖 B，所以身份必须认准。
    var diagKey = String(r.key || r.diagram || r.file || '')
    // 版本校验：慢响应乱序返回时，拒绝低于当前已知修订号的过期响应 —— **只在同一份文档里成立**。
    // 修订号是 **per 项目槽** 的（document.ts：新槽 revision: 0、activateSlot 命中别的槽不 bump
    // 只换指针），所以拿 A 的 rev 5 去比 B 的 rev 1，会把一整份**别的文档**的最新回执丢掉：
    // 画布停在旧图上、openDiagram 照样喊「已切到「B」」，之后每次编辑都把旧文档的模型发出去
    // （doc:set 只带 where ⇒ 写进新图）。身份认不出来时（回执里没有 key/diagram/file）退回旧口径。
    var sameDoc = diagKey === '' || diagKey === currentDiagramRef.current
    // 失败回执（宿主 restoreModel 把版本三件套一起还原，saved:false）是**权威的回滚后状态**：
    // 它的修订号会比当前小 —— 拿「修订号更小」把它挡掉就永远自我纠正不了（见 sendModel）。
    var rolledBack = r.saved === false
    if (!rolledBack && typeof r.revision === 'number' && sameDoc && r.revision < revRef.current) return

    var m = r.model
    if (needsLayout(m)) m = autoLayout(m)
    var prev = committedRef.current
    var diagChanged = currentDiagramRef.current !== '' && diagKey !== '' && currentDiagramRef.current !== diagKey
    var isSwitch = (r.lastChange && r.lastChange.by === 'switch') || diagChanged

    if (prev === null || isSwitch) {
      // 刚挂载（prev 为空）时先问一句：是不是「从这个会话的这一页离开、又回来了」？
      // 是的话把视角 / 撤销栈还回去。**内容不吃记忆** —— 上面那份 m 才是真相。
      // 判据只看「会话 + 这一份文档」对不对得上：`lastChange.by` 在没改过图的会话里
      // 会一直停在 'switch'，拿它当「换了图」会把这辈子都挡掉。
      //
      // 记忆里**只有用户自己动过的东西**（他缩放过、他编辑过），所以「什么都没动过」
      // 的那次挂载与从前完全一样：撤销栈是空的、视角按默认自动适应窗口。
      var memoKey = studioMemoKey(sidRef.current, diagKey)
      var memo = (diagKey && !isSwitch) ? studioMemo[memoKey] : null
      memoKeyRef.current = memoKey
      // 撤销栈还回去，但**不还 committedRef**：它必须等于刚从宿主拿回来的这一份，
      // 否则回来后的第一次编辑会把「离开之前的旧状态」记成历史（一撤销就吃掉期间 AI 的改动）。
      if (memo && memo.hist) histRef.current = memo.hist
      if (memo && memo.view) {
        viewRef.current = memo.view
        setView(memo.view)
        // 还回来的视角本来就是「适应过窗口」的，别再自动 fit 一次把它冲掉。
        fittedRef.current = true
      } else if (!memo) {
        // 只在**真的没有记忆**时才复位。从前这里是 `else`（= 没有 memo **或** memo 里没有 view），
        // 而 hist 与 view 是**独立**写的：只编辑、不动视角的人，memo 里天然只有 hist ——
        // 于是刚还回来的撤销栈被当场清空，而 `histRef.current` 正指向 memo 里那个对象，
        // 连记忆里那份也一起毁掉（切一次页就永久回不来）。
        histRef.current.past.length = 0
        histRef.current.future.length = 0
        setSel(null)
        setDockOpen(false)
      }
      setHistTick(function (n) { return n + 1 })
    } else if (origin === 'ai' || origin === 'local') {
      // AI 改图、从源码重建，同样进历史：Ctrl+Z 能把 AI 的改动退回去
      remember(cloneModel(prev))
    }
    if (diagKey) { currentDiagramRef.current = diagKey; diagKeyRef.current = diagKey }
    // 微调还没落盘就来了新模型（AI / 别的会话同时改了这张图）：本地那几个像素会被下面这份
    // 新状态盖掉。**不能静默吞掉** —— 明说一句，用户再按一下就是了。
    var droppedNudge = false
    if (nudgeRef.current.id) {
      if (nudgeRef.current.timer) { try { nudgeRef.current.timer() } catch (e) {} }
      nudgeRef.current.timer = null
      nudgeRef.current.id = ''
      droppedNudge = true
    }
    syncLiveNodes(m, sidRef.current)
    setLocal(m)
    if (droppedNudge) setStatus('刚才是方向键的未提交微调，已被这一份新状态覆盖（再按一下即可）')
    // **换掉模型之后复核选中还在不在**：元素被宿主（AI / 另一个会话）删掉时，客户端这边的
    // `selRef` / `dockForRef` / `dockOpen` 谁都不会动。后果三条：(a) 撤销把它带回来再点它，
    // 第一下变成「收起」（详情打不开）；(b) 第一下 Esc 被一块**看不见的**面板吞掉；
    // (c) 在这份已不存在的选中上按 Delete → 发一次什么都没删的 doc:set + 一条假历史 +
    // 状态栏谎报「已删除节点」。所以模型一换就复核一次。
    var sNow = selRef.current
    if (sNow) {
      var alive = false
      if (sNow.kind === 'node') {
        for (var ai = 0; ai < m.nodes.length; ai++) { if (m.nodes[ai].id === sNow.id) { alive = true; break } }
      } else if (sNow.kind === 'edge') {
        for (var aj = 0; m.edges && aj < m.edges.length; aj++) {
          if (m.edges[aj].from === sNow.from && m.edges[aj].to === sNow.to) { alive = true; break }
        }
      }
      if (!alive) {
        selRef.current = null
        setSel(null)
        setDockOpen(false)
        dockForRef.current = null
        setLinkPt(null)
        setDragHint(null)
      }
    }
    committedRef.current = cloneModel(m)
    revRef.current = r.revision
    setRevision(r.revision)
    setUpdatedBy(r.updatedBy)
    setFilePath(r.file)
    setLibKey(r.key || r.diagram || '')
    setLibDir(r.dir || '')
    setExternal(r.external || null)
    fileStatusRef.current = r.fileStatus || {}
    setFileStatusTick(function (n) { return n + 1 })
    driftRef.current = r.drift || null
    setDriftTick(function (n) { return n + 1 })
    // 检查点条数：顶栏「历史 N」显示它。清单本身打开面板时才拉（可能刚好有新的一次 AI 改动）。
    if (typeof r.historyCount === 'number') setHistoryCount(r.historyCount)
    if (typeof r.libraryRev === 'number') libRevRef.current = r.libraryRev
    setWarnings(Array.isArray(r.warnings) ? r.warnings : [])
    setMermaidText(r.mermaid)
    setDraft(r.mermaid)
    var lc = r.lastChange
    if (lc && lc.by === 'ai' && lc.nodes && lc.nodes.length > 0) {
      // 同一次 AI 改动只闪一次。`lastChange` 是宿主侧的模块状态：之后没人改图的话，
      // `doc:get` 每次都原样带回来 —— 于是**重新挂载**（切页回来、刷新页面）会把同一次
      // 改动再脉动 5.2 秒、顶栏再喊一遍「AI 刚更新了这张图」。那是旧消息，不是新消息。
      var hlKey = String(r.revision == null ? '' : r.revision)
      var memoForHl = studioMemoFor(memoKeyRef.current || studioMemoKey(sidRef.current, diagKeyRef.current), true)
      if (memoForHl.hlKey !== hlKey) {
        memoForHl.hlKey = hlKey
        flash(lc.nodes)
        setStatus('AI 改动了 ' + lc.nodes.length + ' 个节点（已高亮）')
      }
    }
  }

  S.applyServer = applyServer
}
