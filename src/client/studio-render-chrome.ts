// 画布之外的界面零件：警告横幅、保鲜横幅、源码/预览页、留言与检查点清单、检查器、底部面板。
// 从 studio.ts 的 ArchStudio 组件体里原样搬出来的顶层函数 —— 行为不变。
// 分片共享同一段作用域、不能 import，所以靠参数 S（本帧的 state / setter / ref 集合）通信。
function studioChromeFns(S) {
  var currentDiagramRef = S.currentDiagramRef, descDraft = S.descDraft, dockH = S.dockH, dockOpen = S.dockOpen, dockRef = S.dockRef, draft = S.draft
  var driftOpen = S.driftOpen, driftRef = S.driftRef, edgeDraft = S.edgeDraft, external = S.external, fileStatusRef = S.fileStatusRef
  var filesDraft = S.filesDraft, groupNewName = S.groupNewName, groupPick = S.groupPick, hist = S.hist, hlRef = S.hlRef, inputActions = S.inputActions
  var labelDraft = S.labelDraft, libKey = S.libKey, liveDraft = S.liveDraft, model = S.model, noteDoneDraft = S.noteDoneDraft, noteDraft = S.noteDraft
  var notesOpen = S.notesOpen, patchHist = S.patchHist, renderError = S.renderError, saveFail = S.saveFail, sel = S.sel, setDescDraft = S.setDescDraft
  var setDockOpen = S.setDockOpen, setDraft = S.setDraft, setDriftOpen = S.setDriftOpen, setEdgeDraft = S.setEdgeDraft, setFilesDraft = S.setFilesDraft, setGroupNewName = S.setGroupNewName
  var setGroupPick = S.setGroupPick, setLabelDraft = S.setLabelDraft, setNoteDraft = S.setNoteDraft, setNotesOpen = S.setNotesOpen, setSel = S.setSel, setStatus = S.setStatus
  var setTagsDraft = S.setTagsDraft, svg = S.svg, taRef = S.taRef, tagsDraft = S.tagsDraft, textWrapRef = S.textWrapRef, warnings = S.warnings
  function applyGroup(...args) { return S.applyGroup.apply(null, args) }
  function commitEdgeLabel(...args) { return S.commitEdgeLabel.apply(null, args) }
  function commitFiles(...args) { return S.commitFiles.apply(null, args) }
  function commitLabel(...args) { return S.commitLabel.apply(null, args) }
  function commitNewGroup(...args) { return S.commitNewGroup.apply(null, args) }
  function commitNote(...args) { return S.commitNote.apply(null, args) }
  function commitTags(...args) { return S.commitTags.apply(null, args) }
  function deleteSel(...args) { return S.deleteSel.apply(null, args) }
  function focusNode(...args) { return S.focusNode.apply(null, args) }
  function loadHistory(...args) { return S.loadHistory.apply(null, args) }
  function markNote(...args) { return S.markNote.apply(null, args) }
  function onSashDown(...args) { return S.onSashDown.apply(null, args) }
  function rollbackTo(...args) { return S.rollbackTo.apply(null, args) }
  function setArrow(...args) { return S.setArrow.apply(null, args) }
  function setDockHeight(...args) { return S.setDockHeight.apply(null, args) }
  function setShape(...args) { return S.setShape.apply(null, args) }
  var nodeSel = null
  if (sel && sel.kind === 'node' && model) {
    for (var si = 0; si < model.nodes.length; si++) if (model.nodes[si].id === sel.id) nodeSel = model.nodes[si]
  }
  var edgeSel = null
  if (sel && sel.kind === 'edge' && model) {
    for (var sei = 0; sei < model.edges.length; sei++) {
      if (model.edges[sei].from === sel.from && model.edges[sei].to === sel.to) {
        edgeSel = model.edges[sei]
        break
      }
    }
  }


  // 解析警告：宿主每条响应都带着 warnings，但从前界面一处都没读 ——
  // 「图悄悄少了一块」这件事，人和 AI 都看不见。这里列出来，最多 12 条，其余提示看日志。
  var warnBox = warnings.length > 0 ? React.createElement('div', { className: 'ac-warn' },
    React.createElement('div', { className: 'ac-warn-h' }, '⚠ 解析警告 ' + warnings.length + ' 条 —— 图可能少了一块'),
    warnings.slice(0, 12).map(function (w, wi) {
      return React.createElement('div', { key: 'w' + wi, className: 'ac-warn-i' }, String(w))
    }),
    warnings.length > 12 ? React.createElement('div', { className: 'ac-warn-i' }, '…还有 ' + (warnings.length - 12) + ' 条，全部在日志里') : null,
  ) : null

  // 锚点保鲜横幅：图还在，但代码先动了 —— 这是「这张图可能不准了」的**唯一**显式出口。
  // 刻意不塞进上面那个「解析警告」框：那条说的是「图坏了」，这条说的是「图还活着，但可能过期了」，
  // 两种话混在一起，用户就一条都不看了。只在非空时渲染。
  // **默认只占一行**：这条信号常驻的明细（最多 5 条锚点 + 目录清单 + 一整句建议）会把画布挤掉一大块，
  // 而「是哪个方块过期了」在画布上已经有琥珀角标指着 —— 明细与建议点开（`driftOpen`）再看。
  var driftBox = (function () {
    var dr = driftRef.current
    if (!dr) return null
    var staleN = dr.stale ? dr.stale.length : 0
    var unN = dr.uncovered ? dr.uncovered.length : 0
    if (staleN === 0 && unN === 0) return null
    // 两档语气，**不许一律喊「过期」**：
    //   有 stale → 琥珀（代码先动了，这张图现在可能说的是错的）
    //   只有 uncovered → 更淡的 hint（只是「这几处你还没画」，不是「图上错了」）
    // 一律用警告色，用户三天就会学会无视它 —— 那这条信号就白做了。
    var hasStale = staleN > 0
    var body = []
    if (driftOpen) {
      for (var di = 0; di < staleN && di < 5; di++) {
        body.push(React.createElement('div', { key: 'ds' + di, className: 'ac-drift-i' },
          '▤ ' + dr.stale[di].node + ' · ' + dr.stale[di].ref + ' —— 文件在图之后改过'))
      }
      if (staleN > 5) body.push(React.createElement('div', { key: 'ds-more', className: 'ac-drift-i' }, '…还有 ' + (staleN - 5) + ' 条'))
      if (unN > 0) {
        var names = []
        for (var ui = 0; ui < unN && ui < 6; ui++) names.push(dr.uncovered[ui].dir + '（' + dr.uncovered[ui].files + ' 个源文件）')
        body.push(React.createElement('div', { key: 'du', className: 'ac-drift-i' },
          '没有锚点指向的目录：' + names.join('、') + (unN > 6 ? ' 等' : '')))
      }
      body.push(React.createElement('div', { key: 'dg', className: 'ac-drift-i' },
        hasStale
          ? '在对应的方块上写留言说清楚哪里变了，或者重新标一遍锚点 —— AI 那边也会看到这条。'
          : '这不是说图上错了：要画就给它补个锚点，不画就忽略这一条。'))
    }
    function toggleDrift() { setDriftOpen(!driftOpen) }
    return React.createElement('div', { className: 'ac-drift' + (hasStale ? '' : ' hint') + (driftOpen ? ' open' : '') },
      React.createElement('div', {
        className: 'ac-drift-h', role: 'button', tabIndex: 0,
        'aria-expanded': driftOpen ? 'true' : 'false',
        title: driftOpen ? '收起明细' : '展开明细：哪些锚点的文件改过',
        onClick: toggleDrift,
        onKeyDown: function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleDrift() }
        },
      },
        hasStale ? ('▤ 这张图可能已经过期：' + staleN + ' 条锚点的文件在图之后改过') : ('▤ 有源码没画到：' + unN + ' 个目录'),
        React.createElement('span', { className: 'ac-drift-tgl' }, driftOpen ? '　收起 ▴' : '　明细 ▾')),
      body,
    )
  })()

  // 「这一笔没存下去」：宿主拒绝写盘并把内存回滚了（见 sendModel），回执把原因放在 warnings 里。
  // 它**只在画布页**挂着，而且是独立的一块 —— 与「解析警告」（图坏了）、「锚点保鲜」（图可能过期）
  // 是三件不同的事，混成一条用户就一条都不看了。复用警告色（这是坏消息，不是提示）。
  var saveFailBox = saveFail ? React.createElement('div', { className: 'ac-warn ac-savefail' },
    React.createElement('div', { className: 'ac-warn-h' }, '⚠ 没有存下去：本次改动已回滚'),
    React.createElement('div', { className: 'ac-warn-i' }, String(saveFail)),
  ) : null

  // 源码页：两层都不滚动，滚动口是 .ac-textwrap（见 runtime.ts 的 STUDIO_CSS）。
  // 从前这里挂着一个 onScroll 把 textarea 的 scrollTop 灌给 <pre> —— 两个滚动口互相同步，
  // 注定会错位，而错位的观感就是「文字变白 / 一片空白」。现在不需要同步，也就没有可错位的东西。
  var hlLines = String(draft == null ? '' : draft).split('\n').map(function (ln, li) {
    var toks = tokenizeMermaidLine(ln)
    var kids = []
    for (var ti = 0; ti < toks.length; ti++) {
      var tk = toks[ti]
      kids.push(tk.k ? React.createElement('span', { key: 'k' + ti, className: 'ac-hl-' + tk.k }, tk.s) : tk.s)
    }
    return React.createElement('div', { key: 'L' + li }, kids.length ? kids : '\u00a0')
  })

  var textPane = React.createElement('div', { className: 'ac-textwrap', ref: textWrapRef },
    React.createElement('div', { className: 'ac-hint' }, '这段 Mermaid 就是 AI 看到的全部内容。可以直接改，然后点「应用回画布」。%% @pos 行是坐标注释，删掉只会让节点重新自动布局。'),
    renderError ? React.createElement('div', { className: 'ac-err' }, '源码解析报错：\n' + renderError) : null,
    warnBox,
    React.createElement('div', { className: 'ac-editwrap' },
      React.createElement('pre', { className: 'ac-hl', ref: hlRef, 'aria-hidden': 'true' }, hlLines),
      React.createElement('textarea', {
        className: 'ac-area ac-area-hl', ref: taRef, value: draft, spellCheck: false,
        onChange: function (e) { setDraft(e.target.value) },
      }),
    ),
  )

  var previewPane = React.createElement('div', { className: 'ac-previewwrap' },
    renderError ? React.createElement('div', { className: 'ac-err' }, 'Mermaid 渲染报错（画布本身仍可用）：\n' + renderError) : null,
    React.createElement('div', { className: 'ac-preview', dangerouslySetInnerHTML: { __html: svg || '<div style="color:#666;font-family:system-ui">正在加载 Mermaid 渲染器…</div>' } }),
  )

  // ---------- 节点留言清单（待递在前，历史在后） ----------
  // 派生值必须在这里算完：下面的 return 是一个整体表达式，声明晚一步就是 undefined
  // （面板渲染崩溃的老坑，见 AGENTS.md「stage 这类 JSX 在 return 之前就构造好了」）。
  var noteListOpen = []
  var noteListDone = []
  if (model && model.nodes) {
    for (var nq = 0; nq < model.nodes.length; nq++) {
      var nnode = model.nodes[nq]
      if (!nnode.note) continue
      if (nnode.noteDone) noteListDone.push(nnode); else noteListOpen.push(nnode)
    }
  }
  // 总量（含历史）：按钮上那个数字以前只有待递数，读起来像「统计漏了历史里的」。
  var noteTotal = noteListOpen.length + noteListDone.length
  var noteBatch = function () {
    var diagName = (external ? externalBaseName(external) : (libKey || currentDiagramRef.current)) || 'architecture'
    var lines = [
      '关于画布「' + diagName + '」上的 ' + noteListOpen.length + ' 条留言，请逐条回应（点名节点 id）：',
      '',
    ]
    for (var bi = 0; bi < noteListOpen.length; bi++) {
      var bn = noteListOpen[bi]
      var bsp = splitLabel(bn.label)
      var btitle = bsp.title || bn.id
      var bnote = String(bn.note || '').replace(/\r?\n/g, ' / ')
      lines.push((bi + 1) + '. `' + bn.id + '`（' + btitle + '）：' + bnote)
    }
    return lines.join('\n')
  }
  // 有 submit 才是「一个动作交出去」，没有就退回「只放进输入框」——旧宿主上按钮不该消失。
  var canSubmitNote = !!(inputActions && typeof inputActions.submit === 'function')

  /**
   * 把这一批待递的留言**交给 AI**，用户一个字都不用打。
   *
   * 为什么不能只是「放进输入框让用户回车」：DSH 的输入框对**空草稿**是拒绝的 —— Enter 那条路
   * 明确判了 `!empty`，而 `inputActions.submit()` 落到同一台状态机上，空草稿＋无附件是 no-op。
   * 所以「输入框空着也能发送」只能由我们补一句话达成：空着就替用户把这一批写成一条消息，
   * 已经打了字就**原样发他打的那句**（那是他要说的话，别顶掉；留言本来就每一步都在上下文里）。
   */
  function sendNotes() {
    if (!canSubmitNote) return
    if (String(liveDraft == null ? '' : liveDraft).trim()) {
      inputActions.submit()
      setStatus('已发送')
      return
    }
    if (typeof inputActions.setDraft !== 'function') return
    inputActions.setDraft(noteBatch())
    // 隔一拍再提交：setDraft 与 submit 读的是同一份编辑器投影，不必赌它的更新时机
    ctxTimeout(function () { inputActions.submit() }, 0)
    setStatus('已把 ' + noteListOpen.length + ' 条留言交给 AI')
  }
  function noteRow(nd, isDone) {
    return React.createElement('div', { key: (isDone ? 'd' : 'o') + nd.id, className: 'ac-lib-row' },
      React.createElement('button', {
        className: 'ac-lib-item' + (isDone ? ' done' : ''),
        title: '定位到这个节点',
        onClick: function () { focusNode(nd.id) },
      }, (isDone ? '✓ ' : '✎ ') + nd.id + '　' + String(nd.label || '').replace(/\n/g, ' ')
        + '　·　' + String(nd.note).replace(/\n/g, ' ')),
      React.createElement('button', {
        className: 'ac-btn',
        onClick: function () { markNote(!isDone, nd.id) },
      }, isDone ? '再送一次' : '不发了'),
    )
  }
  var notePanel = notesOpen ? React.createElement('div', { className: 'ac-lib ac-notes' },
    React.createElement('div', { className: 'ac-lib-head' },
      React.createElement('span', { className: 'grow' },
        '节点留言：共 ' + noteTotal + ' 条 —— ' + noteListOpen.length + ' 条待递'
        + (noteListDone.length ? '，历史 ' + noteListDone.length + ' 条' : '')
        + '　·　待递的会被 AI 读一次就消失；历史里的不会再送（最多留 6 条）'),
      (inputActions && typeof inputActions.setDraft === 'function' && noteListOpen.length > 0)
        ? React.createElement('button', {
            className: 'ac-btn primary',
            title: canSubmitNote
              ? '把这一批待递的留言交给 AI —— 输入框空着也行（它会替你把这一批写成一条消息发出去）'
              : '把所有未完成留言打包填入聊天输入框',
            onClick: canSubmitNote
              ? sendNotes
              : function () {
                  inputActions.setDraft(noteBatch())
                  setStatus('已把 ' + noteListOpen.length + ' 条留言填入聊天输入框，回车发送')
                },
          }, canSubmitNote
            ? '交给 AI (' + noteListOpen.length + ')'
            : '放入输入框 (' + noteListOpen.length + ')')
        : null,
      React.createElement('button', { className: 'ac-btn', onClick: function () { setNotesOpen(false) } }, '收起'),
    ),
    noteListOpen.length === 0
      ? React.createElement('div', { className: 'ac-hint' }, '没有待递的留言。点一个节点，在下方检查器里就能写。')
      : null,
    noteListOpen.map(function (nd) { return noteRow(nd, false) }),
    noteListDone.length > 0
      ? React.createElement('div', { className: 'ac-hint' }, '历史（已投递，最多留 6 条）：')
      : null,
    noteListDone.map(function (nd) { return noteRow(nd, true) }),
  ) : null

  // ---------- 检查点清单（每次落盘一份，点一下退回） ----------
  // 与留言清单同一套 .ac-lib 外壳；区别是这里的数据来自 doc:history（宿主内存里的快照），
  // 不是从模型派生的 —— 所以有 busy / 拉取失败这两个状态要如实显示。
  var histByLabel = { ai: 'AI', user: '用户', open: '打开', switch: '切换', init: '初始' }
  function histTime(at) {
    try {
      var d = new Date(at)
      var p = function (n) { return (n < 10 ? '0' : '') + n }
      return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds())
    } catch (e) { return '' }
  }
  var histPanel = hist.open ? React.createElement('div', { className: 'ac-lib ac-hist' },
    React.createElement('div', { className: 'ac-lib-head' },
      React.createElement('span', { className: 'grow' },
        '检查点：' + hist.entries.length + ' 份'
        + '　·　每次落盘留一份（标明谁改的），点「退回」把图恢复成那一刻。只在内存里，重启 dsh 会清空'),
      React.createElement('button', { className: 'ac-btn', onClick: function () { loadHistory() } }, '刷新'),
      React.createElement('button', { className: 'ac-btn', onClick: function () { patchHist({ open: false }) } }, '收起'),
    ),
    hist.busy ? React.createElement('div', { className: 'ac-hint' }, '正在读检查点…') : null,
    !hist.busy && hist.entries.length === 0
      ? React.createElement('div', { className: 'ac-hint' }, '还没有检查点。你和 AI 每改一次图都会留下一个。')
      : null,
    hist.entries.map(function (e) {
      var who = histByLabel[e.by] || e.by
      var meta = '修订 ' + e.rev + '　' + e.nodeCount + ' 节点 / ' + e.edgeCount + ' 连线　' + histTime(e.at)
      return React.createElement('div', { key: 'h' + e.seq, className: 'ac-lib-row' },
        React.createElement('span', {
          className: 'ac-hist-item' + (e.current ? ' on' : '') + (e.by === 'ai' ? ' ai' : ''),
          title: (e.site ? e.site + '　' : '') + (e.changed && e.changed.length ? '涉及：' + e.changed.join('、') : ''),
        }, (e.current ? '● ' : '') + who + '　' + meta
          + (e.changed && e.changed.length ? '　·　' + e.changed.slice(0, 4).join('、') + (e.changed.length > 4 ? ' 等' : '') : '')),
        e.current
          ? React.createElement('span', { className: 'ac-hist-cur' }, '当前')
          : (hist.confirmSeq === e.seq
            ? [
                React.createElement('button', { key: 'yes', className: 'ac-btn primary', onClick: function () { rollbackTo(e.seq) } }, '确认退回'),
                React.createElement('button', { key: 'no', className: 'ac-btn', onClick: function () { patchHist({ confirmSeq: 0 }) } }, '取消'),
              ]
            : React.createElement('button', {
                className: 'ac-btn',
                onClick: function () { patchHist({ confirmSeq: e.seq }) },
              }, '退回')),
      )
    }),
  ) : null

  // ---------- 底部检查器（点选后才展开，拖动中不弹） ----------
  // 分组下拉框要用到三样东西：现有组（带成员数）、节点当前指着的那个组、以及
  // 「这个组 id 其实已经不在 groups 里了」这种情况（文件手改过 / 组被删过）。
  // 最后那种必须也在下拉框里有名字 —— 否则 select 找不到匹配项会退回显示第一个选项，界面就在说谎。
  var groupCounts = {}
  var groupIdSet = {}
  var allGroups = (model && model.groups) || []
  for (var gq = 0; gq < allGroups.length; gq++) if (allGroups[gq]) groupIdSet[allGroups[gq].id] = true
  if (model && model.nodes) {
    for (var nq = 0; nq < model.nodes.length; nq++) {
      var gqn = model.nodes[nq].group
      if (gqn) groupCounts[gqn] = (groupCounts[gqn] || 0) + 1
    }
  }
  var orphanGroup = (groupPick && groupPick !== GROUP_NEW && !groupIdSet[groupPick]) ? groupPick : null

  // 详情面板分三态：展开 / 收起成一条细条 / 没有选中。
  // 内容（`dockBody`）与外壳（标题栏 + 分隔条 + 滚动体）分开构造 —— 外壳是给两种内容共用的。
  var dockBody = null
  if (nodeSel && dockOpen) {
    dockBody = React.createElement('div', { className: 'ac-grid' },
        React.createElement('div', { className: 'ac-field full' },
          React.createElement('label', null, '标题（回车生效）'),
          React.createElement('input', {
            className: 'ac-input', value: labelDraft, placeholder: '这个元素是什么',
            onChange: function (e) { setLabelDraft(e.target.value) },
            onBlur: commitLabel,
            onKeyDown: function (e) { if (e.key === 'Enter' && !isComposingEv(e)) { e.preventDefault(); commitLabel() } },
          }),
        ),
        React.createElement('div', { className: 'ac-field full' },
          React.createElement('label', null, '描述（回车生效，Shift+回车换行）'),
          React.createElement('textarea', {
            className: 'ac-input', style: { height: 54, resize: 'vertical', fontFamily: 'inherit' },
            placeholder: '意图：想达成什么　/　原理：为什么这么设计',
            value: descDraft,
            onChange: function (e) { setDescDraft(e.target.value) },
            onBlur: commitLabel,
            onKeyDown: function (e) { if (e.key === 'Enter' && !e.shiftKey && !isComposingEv(e)) { e.preventDefault(); commitLabel() } },
          }),
        ),
        React.createElement('div', { className: 'ac-field' },
          React.createElement('label', null, '形状'),
          React.createElement('select', { className: 'ac-select', value: nodeSel.shape, onChange: function (e) { setShape(e.target.value) } },
            choiceList(SHAPE_CHOICES, nodeSel.shape).map(function (k) {
              return React.createElement('option', { key: k, value: k }, shapeChoiceText(k))
            }),
          ),
        ),
        React.createElement('div', { className: 'ac-field' },
          React.createElement('label', null, '分组'),
          React.createElement('select', {
            className: 'ac-select', value: groupPick,
            onChange: function (e) {
              var v = e.target.value
              setGroupPick(v)
              setGroupNewName('')
              if (v === GROUP_NEW) return
              applyGroup(v ? v : null, null)
            },
          },
            React.createElement('option', { value: '' }, '不属于任何组'),
            orphanGroup
              ? React.createElement('option', { key: 'orphan', value: orphanGroup }, orphanGroup + '（组已不存在）')
              : null,
            allGroups.map(function (g) {
              if (!g) return null
              var cnt = groupCounts[g.id] || 0
              return React.createElement('option', { key: g.id, value: g.id },
                String(g.label || g.id) + (cnt ? '（' + cnt + '）' : '（空）'))
            }),
            React.createElement('option', { value: GROUP_NEW }, '＋ 新建组…'),
          ),
        ),
        React.createElement('div', { className: 'ac-field full' },
          React.createElement('label', null, '概念标签（以空格分隔，如：AI端 接入层）'),
          React.createElement('input', {
            className: 'ac-input', value: tagsDraft, placeholder: '贴上概念标签，支持多维聚类与相似性排布',
            onChange: function (e) { setTagsDraft(e.target.value) },
            onBlur: commitTags,
            onKeyDown: function (e) { if (e.key === 'Enter' && !isComposingEv(e)) { e.preventDefault(); commitTags() } },
          }),
        ),
        groupPick === GROUP_NEW ? React.createElement('div', { className: 'ac-field full' },
          React.createElement('label', null, '新组名字（回车生效）'),
          React.createElement('input', {
            className: 'ac-input', value: groupNewName, placeholder: '例如：AI 端', autoFocus: true,
            onChange: function (e) { setGroupNewName(e.target.value) },
            onBlur: commitNewGroup,
            onKeyDown: function (e) { if (e.key === 'Enter' && !isComposingEv(e)) { e.preventDefault(); commitNewGroup() } },
          }),
        ) : null,
        React.createElement('div', { className: 'ac-field full' },
          React.createElement('label', null, noteDraft
            ? (noteDoneDraft ? '留言（已投递，在历史里 —— 不会再进上下文）' : '留言（AI 读一次就消失）')
            : '留言（写给 AI：这里的疑问 / 要求 / 背景）'),
          React.createElement('textarea', {
            className: 'ac-input', style: { height: 54, resize: 'vertical', fontFamily: 'inherit' },
            placeholder: '例如：这里为什么不用队列？　/　这条链路还没定，先别改',
            value: noteDraft,
            onChange: function (e) { setNoteDraft(e.target.value) },
            onBlur: commitNote,
            onKeyDown: function (e) { if (e.key === 'Enter' && !e.shiftKey && !isComposingEv(e)) { e.preventDefault(); commitNote() } },
          }),
          noteDraft
            ? React.createElement('div', { className: 'ac-note-actions' },
                React.createElement('button', {
                  className: 'ac-btn' + (noteDoneDraft ? '' : ' primary'),
                  title: noteDoneDraft ? '再送一次：放回待递，AI 会再读一次' : '不发了：挪进历史，不再投递',
                  onClick: function () { markNote(!noteDoneDraft) },
                }, noteDoneDraft ? '再送一次' : '不发了'),
                (inputActions && typeof inputActions.setDraft === 'function')
                  ? React.createElement('button', {
                      className: 'ac-btn',
                      title: '把这条留言连同节点信息填入聊天输入框；框里已经有字就接在你那句后面，不顶掉你打的字',
                      disabled: !String(noteDraft || '').trim(),
                      onClick: function () {
                        var text = formatNodeForModel(Object.assign({}, nodeSel, {
                          label: labelDraft,
                          note: String(noteDraft || '').trim(),
                          noteDone: noteDoneDraft === true,
                          files: (function () {
                            var raw = String(filesDraft || '').split('\n')
                            var arr = []
                            for (var fi = 0; fi < raw.length; fi++) {
                              var line = raw[fi].trim()
                              if (line) arr.push(line)
                            }
                            return arr
                          })(),
                        }))
                        // **框里有字就不顶**：与清单头部「交给 AI (N)」同一条规矩（sendNotes
                        // 先读 liveDraft，非空就原样发）。setDraft 是**整段替换** —— 从前这里
                        // 无条件写进去，用户在聊天框里打了一半的话被整段顶掉，而且一点提示都没有。
                        // 用户的话是他的东西：接在前面，节点信息跟在后面（追加不会丢任何字）。
                        var cur = String(liveDraft == null ? '' : liveDraft)
                        var has = !!cur.trim()
                        inputActions.setDraft(has ? cur.replace(/\s+$/, '') + '\n\n' + text : text)
                        setStatus(has
                          ? '已把节点信息接在你那句话后面（没有顶掉你打的字），回车发送'
                          : '已填入聊天输入框，回车发送')
                      },
                    }, '发送给 AI')
                  : null,
              )
            : null,
        ),
        React.createElement('div', { className: 'ac-field full' },
          React.createElement('label', null, '代码锚点（每行一个：路径 或 路径#符号）'),
          React.createElement('textarea', {
            className: 'ac-input', style: { height: 54, resize: 'vertical', fontFamily: 'inherit' },
            placeholder: '例如：src/host/mermaid.ts　/　src/client/runtime.ts#cloneModel',
            value: filesDraft,
            onChange: function (e) { setFilesDraft(e.target.value) },
            onBlur: commitFiles,
            onKeyDown: function (e) { if (e.key === 'Enter' && !e.shiftKey && !isComposingEv(e)) { e.preventDefault(); commitFiles() } },
          }),
          filesDraft
            ? (function () {
                var rawLines = filesDraft.split('\n')
                var rows = []
                var nodeStatus = (fileStatusRef.current && fileStatusRef.current[nodeSel.id]) || {}
                for (var fi = 0; fi < rawLines.length; fi++) {
                  var ref = rawLines[fi].trim()
                  if (!ref) continue
                  var st = nodeStatus[ref] || 'unknown'
                  var drStale = !!staleRefSet(driftRef.current)[ref]
                  var isOk = st === 'ok' && !drStale
                  var reason = isOk ? ''
                    : (drStale ? '文件在图之后改过 —— 内容可能已经不是图上说的那个了'
                      : (st === 'missing' ? '文件不在' : (st === 'symbol-missing' ? '符号不在' : '无法判定')))
                  rows.push(React.createElement('div', {
                    key: 'ref-' + fi + '-' + ref,
                    className: isOk ? undefined : (st === 'ok' ? 'ac-ref-stale' : 'ac-ref-bad'),
                  }, (isOk ? '✓ ' : '⚠ ') + ref + (reason ? ' (' + reason + ')' : '')))
                }
                return rows.length > 0 ? React.createElement('div', { className: 'ac-ref-status' }, rows) : null
              })()
            : null,
        ),
        React.createElement('div', { className: 'ac-field full' },
          React.createElement('button', { className: 'ac-btn danger', onClick: deleteSel }, '删除这个节点'),
        ),
    )
  } else if (edgeSel && dockOpen) {
    dockBody = React.createElement('div', { className: 'ac-grid' },
        React.createElement('div', { className: 'ac-field full' },
          React.createElement('label', null, '标签（回车生效）'),
          React.createElement('input', { className: 'ac-input', value: edgeDraft, onChange: function (e) { setEdgeDraft(e.target.value) }, onBlur: commitEdgeLabel, onKeyDown: function (e) { if (e.key === 'Enter' && !isComposingEv(e)) commitEdgeLabel() } }),
        ),
        React.createElement('div', { className: 'ac-field' },
          React.createElement('label', null, '样式'),
          React.createElement('select', { className: 'ac-select', value: edgeSel.arrow, onChange: function (e) { setArrow(e.target.value) } },
            choiceList(ARROW_CHOICES, edgeSel.arrow).map(function (k) {
              return React.createElement('option', { key: k, value: k }, arrowChoiceText(k))
            }),
          ),
        ),
        React.createElement('div', { className: 'ac-field' },
          React.createElement('button', { className: 'ac-btn danger', onClick: deleteSel }, '删除这条连线'),
        ),
    )
  }

  // 外壳：一条随时可见的标题栏（收起 / 关闭都在上面）+ 可拖的分隔条 + 只有内容滚动的面板体。
  // 标题栏**不滚**：面板内容再长，那两个按钮也一直够得着（VS Code 的面板标题栏同理）。
  var dockTitle = nodeSel ? ('节点 ' + nodeSel.id) : (edgeSel ? ('连线 ' + edgeSel.from + ' → ' + edgeSel.to) : '')
  var dock = null
  if (dockBody) {
    dock = React.createElement('div', {
      className: 'ac-dock', ref: dockRef, role: 'region', 'aria-label': '元素详情',
      style: dockH ? { height: dockH + 'px' } : undefined,
    },
      React.createElement('div', {
        className: 'ac-sash', role: 'separator', 'aria-orientation': 'horizontal',
        'aria-label': '拖动调整详情面板高度（双击复位）',
        title: '拖动调整高度，双击复位',
        onPointerDown: onSashDown, onDoubleClick: function () { setDockHeight(null) },
      }),
      React.createElement('div', { className: 'ac-dock-bar' },
        React.createElement('span', { className: 'ac-dock-title', title: '点画布上同一个元素可以再点一下收起' }, dockTitle),
        React.createElement('button', {
          className: 'ac-dock-btn', title: '收起详情（保留选中，画布长回来；Esc 同效）',
          onClick: function () { setDockOpen(false) },
        }, '▾ 收起'),
        React.createElement('button', {
          className: 'ac-dock-btn', title: '关闭详情并取消选中', 'aria-label': '关闭详情',
          onClick: function () { setSel(null); setDockOpen(false) },
        }, '×'),
      ),
      React.createElement('div', { className: 'ac-dock-body' }, dockBody),
    )
  } else if (nodeSel || edgeSel) {
    // 收起态：一条细条留在原地。它在说三件事 —— 现在的选中是谁、点这里能展开、
    // 以及选中**还在**（画布上的高亮、方向键微调都还生效）。
    dock = React.createElement('div', { className: 'ac-peek' },
      React.createElement('button', {
        className: 'ac-peek-btn', 'aria-expanded': false,
        title: '展开详情面板',
        onClick: function () { setDockOpen(true) },
      }, '▴ 详情：' + dockTitle),
      React.createElement('button', {
        className: 'ac-dock-btn', title: '取消选中', 'aria-label': '取消选中',
        onClick: function () { setSel(null) },
      }, '×'),
    )
  }

  S.allGroups = allGroups
  S.canSubmitNote = canSubmitNote
  S.dock = dock
  S.dockBody = dockBody
  S.dockTitle = dockTitle
  S.driftBox = driftBox
  S.edgeSel = edgeSel
  S.groupCounts = groupCounts
  S.groupIdSet = groupIdSet
  S.histByLabel = histByLabel
  S.histPanel = histPanel
  S.histTime = histTime
  S.hlLines = hlLines
  S.nodeSel = nodeSel
  S.noteBatch = noteBatch
  S.noteListDone = noteListDone
  S.noteListOpen = noteListOpen
  S.notePanel = notePanel
  S.noteRow = noteRow
  S.noteTotal = noteTotal
  S.orphanGroup = orphanGroup
  S.previewPane = previewPane
  S.saveFailBox = saveFailBox
  S.sendNotes = sendNotes
  S.textPane = textPane
  S.warnBox = warnBox
}
