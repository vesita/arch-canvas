// 根元素与顶栏、工具条、图库选择器、帮助面板、状态栏。
// 从 studio.ts 的 ArchStudio 组件体里原样搬出来的顶层函数 —— 行为不变。
// 分片共享同一段作用域、不能 import，所以靠参数 S（本帧的 state / setter / ref 集合）通信。
function studioRootFns(S) {
  var dock = S.dock, driftBox = S.driftBox, external = S.external, helpOpen = S.helpOpen, hist = S.hist, histPanel = S.histPanel
  var histRef = S.histRef, historyCount = S.historyCount, libDir = S.libDir, libKey = S.libKey, mermaidText = S.mermaidText, model = S.model
  var noteListOpen = S.noteListOpen, notePanel = S.notePanel, noteTotal = S.noteTotal, notesOpen = S.notesOpen, patchHist = S.patchHist, picker = S.picker
  var previewPane = S.previewPane, revision = S.revision, rootRef = S.rootRef, saveFailBox = S.saveFailBox, sel = S.sel, setDraft = S.setDraft
  var setHelpOpen = S.setHelpOpen, setNotesOpen = S.setNotesOpen, setTab = S.setTab, stage = S.stage, status = S.status, tab = S.tab
  var textPane = S.textPane, updatedBy = S.updatedBy, view = S.view, warnBox = S.warnBox
  function addNode(...args) { return S.addNode.apply(null, args) }
  function applyDraft(...args) { return S.applyDraft.apply(null, args) }
  function closeLibrary(...args) { return S.closeLibrary.apply(null, args) }
  function consolidateEdgesAction(...args) { return S.consolidateEdgesAction.apply(null, args) }
  function copySource(...args) { return S.copySource.apply(null, args) }
  function deleteDiagram(...args) { return S.deleteDiagram.apply(null, args) }
  function deleteSel(...args) { return S.deleteSel.apply(null, args) }
  function exportPng(...args) { return S.exportPng.apply(null, args) }
  function exportSvg(...args) { return S.exportSvg.apply(null, args) }
  function fitView(...args) { return S.fitView.apply(null, args) }
  function loadHistory(...args) { return S.loadHistory.apply(null, args) }
  function loadLibrary(...args) { return S.loadLibrary.apply(null, args) }
  function onKeyDown(...args) { return S.onKeyDown.apply(null, args) }
  function onKeyUp(...args) { return S.onKeyUp.apply(null, args) }
  function openDiagram(...args) { return S.openDiagram.apply(null, args) }
  function openFilePicker(...args) { return S.openFilePicker.apply(null, args) }
  function openPath(...args) { return S.openPath.apply(null, args) }
  function patchPicker(...args) { return S.patchPicker.apply(null, args) }
  function redo(...args) { return S.redo.apply(null, args) }
  function relayout(...args) { return S.relayout.apply(null, args) }
  function renameDiagram(...args) { return S.renameDiagram.apply(null, args) }
  function restoreDiagram(...args) { return S.restoreDiagram.apply(null, args) }
  function undo(...args) { return S.undo.apply(null, args) }
  var tabs = [['canvas', '画布'], ['text', '源码'], ['preview', '预览']]
  var busy = status.indexOf('加载') === 0 || status.indexOf('失败') >= 0
  var externalName = external ? String(external).replace(/\\/g, '/').split('/').pop() : ''

  // 隐藏手势与快捷键的**静态**清单。硬编码就够 —— 这不是帮助系统，只是把「界面上一个字的
  // 提示都没有」这件事补上（Alt 关吸附、Shift+方向键、双击分隔条、Esc 三段、F/Ctrl+0，
  // 以及「Ctrl+Z 要求最后一次 pointerdown 落在面板里」这条容易当成 bug 的规矩）。
  var helpRows = [
    '拖动方块：按住左键拖。默认吸附到别的方块的中心线，按住 Alt 临时关掉吸附。',
    '微调选中节点：方向键 1px，Shift+方向键 10px。',
    '连线：先点一个方块选中它，把它右侧那个小圆点拖到另一个方块上。',
    '视角：滚轮缩放，Shift+滚轮左右平移，中键拖动平移；F 或 Ctrl/Cmd+0 = 适应窗口。',
    '撤销 / 重做：Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z。要求最后一次 pointerdown 落在面板里（点回聊天输入框就交还给浏览器）。',
    '详情面板：点同一个元素再点一次 = 收起（选中保留）；Esc 逐层退 —— 先退出输入框，再收面板，最后才取消选中。',
    '面板高度：拖它上边缘的分隔条，双击复位。',
    '整组移动：拖动组的标题条，组里的节点一起走。',
    '删除：选中后按 Delete / Backspace，或用工具条上的「删除」。',
  ]
  var helpPanel = helpOpen ? React.createElement('div', { className: 'ac-lib ac-help' },
    React.createElement('div', { className: 'ac-lib-head' },
      React.createElement('span', { className: 'grow' }, '快捷键与隐藏手势'),
      React.createElement('button', { className: 'ac-btn', onClick: function () { setHelpOpen(false) } }, '收起'),
    ),
    helpRows.map(function (t, hi) {
      return React.createElement('div', { key: 'h' + hi, className: 'ac-help-row' }, t)
    }),
  ) : null

  return React.createElement('div', {
    ref: rootRef,
    className: 'ac-root',
    tabIndex: 0,
    onKeyDown: onKeyDown,
    onKeyUp: onKeyUp,
    onPointerDown: function () { try { if (rootRef.current) rootRef.current.focus() } catch (e) {} },
  },
    React.createElement('div', { className: 'ac-bar' },
      React.createElement('span', { className: 'ac-title' }, '架构画布'),
      React.createElement('div', { className: 'ac-tabs' },
        tabs.map(function (t) {
          return React.createElement('button', { key: t[0], className: 'ac-tab' + (tab === t[0] ? ' on' : ''), onClick: function () { setTab(t[0]) } }, t[1])
        }),
      ),
      React.createElement('button', {
        className: 'ac-tab', title: '撤销 (Ctrl/Cmd+Z)', onClick: undo,
        disabled: histRef.current.past.length === 0,
      }, '↶'),
      React.createElement('button', {
        className: 'ac-tab', title: '重做 (Ctrl/Cmd+Shift+Z)', onClick: redo,
        disabled: histRef.current.future.length === 0,
      }, '↷'),
      // 检查点：**不再有「AI 只读」开关**。安全靠「随时退回去」而不是拦人 ——
      // 每次落盘（AI 改的 / 用户改的）都留一份快照，点这里就能退回任意一份（见 src/host/history.ts）。
      React.createElement('button', {
        className: 'ac-tab ac-histbtn' + (hist.open ? ' on' : ''),
        title: '检查点：每次改动都留了一份快照（标明是 AI 改的还是用户改的），可以退回任意一份。历史只在内存里，重启 dsh 会清空。',
        onClick: function () {
          if (hist.open) { patchHist({ open: false }); return }
          patchHist({ open: true })
          loadHistory()
        },
      }, '历史' + (historyCount > 0 ? ' ' + historyCount : '')),
      React.createElement('button', {
        className: 'ac-tab ac-helpbtn' + (helpOpen ? ' on' : ''),
        title: '快捷键与隐藏手势（Alt 关吸附 / Shift+方向键 10px / 双击分隔条复位 / Esc 三段 / F 适应窗口）',
        onClick: function () { setHelpOpen(!helpOpen) },
      }, '?'),
    ),
    React.createElement('div', { className: 'ac-tools' },
      tab === 'canvas' ? React.createElement('button', { className: 'ac-btn', onClick: addNode }, '＋ 节点') : null,
      tab === 'canvas' ? React.createElement('button', { className: 'ac-btn', onClick: relayout }, '自动布局') : null,
      tab === 'canvas' ? React.createElement('button', { className: 'ac-btn', onClick: consolidateEdgesAction, title: '将相同两点间的同向多条平行线合并为复合连线' }, '整理连线') : null,
      tab === 'canvas' ? React.createElement('button', { className: 'ac-btn', onClick: function () { fitView(true) } }, '适应窗口') : null,
      tab === 'canvas' ? React.createElement('button', { className: 'ac-btn danger', onClick: deleteSel, disabled: !sel }, '删除') : null,
      tab === 'canvas' ? React.createElement('button', { className: 'ac-btn', onClick: exportSvg, title: '导出白底 SVG，可直接贴进文档' }, 'SVG') : null,
      tab === 'canvas' ? React.createElement('button', { className: 'ac-btn', onClick: exportPng, title: '导出 PNG（2 倍图）' }, 'PNG') : null,
      tab === 'canvas' ? React.createElement('button', { className: 'ac-btn', onClick: copySource, title: '复制当前 Mermaid 源码' }, '复制源码') : null,
      tab === 'canvas' ? React.createElement('button', {
        className: 'ac-btn', title: '打开项目里的一个 .mmd / .mermaid 文件（此后编辑的就是它本身）',
        onClick: openFilePicker,
      }, '打开') : null,
      tab === 'canvas' ? React.createElement('button', {
        className: 'ac-btn' + (external ? ' primary' : ''),
        title: external ? '当前打开的是项目里的文件：' + external : '列图 / 切图 / 新建 / 按路径打开 —— 图库跟着项目走',
        onClick: function () { if (picker.open) closeLibrary(); else loadLibrary(false) },
      }, external ? '文件 ' + externalName : '图库 ' + (libKey || '')) : null,
      tab === 'canvas' ? React.createElement('button', {
        className: 'ac-btn' + (noteListOpen.length ? ' primary' : ''),
        // 这个数字从前只数**待递**的，于是把一个「留言」按钮读成了「留言总量」的人会
        // 觉得统计有 bug —— 画布上一共 7 条留言（含 4 条已投递），按钮却写着「留言 3」。
        // 现在两个都给：左边是待递数（会被投递一次），右边是总量。没有待递时只报总量。
        title: '节点留言清单：待递的会被 AI 读一次（读后就消失，历史最多留 6 条）'
          + '（共 ' + noteTotal + ' 条，其中 ' + noteListOpen.length + ' 条待递）',
        onClick: function () { setNotesOpen(!notesOpen) },
      }, noteTotal === 0 ? '留言'
        : (noteListOpen.length ? '留言 ' + noteListOpen.length + ' · 共 ' + noteTotal : '留言 · 共 ' + noteTotal)) : null,
      tab === 'text' ? React.createElement('button', { className: 'ac-btn primary', onClick: applyDraft }, '应用回画布') : null,
      tab === 'text' ? React.createElement('button', { className: 'ac-btn', onClick: function () { setDraft(mermaidText) } }, '还原') : null,
    ),
    picker.open ? React.createElement('div', { className: 'ac-lib' },
      React.createElement('div', { className: 'ac-lib-head' },
        React.createElement('span', { className: 'grow' },
          (external ? '当前打开：' + external : '当前：图库 ' + (libKey || '—'))
          + '　·　图库目录：' + (libDir || '(还没定位到)')),
        React.createElement('button', { className: 'ac-btn', title: '立刻重扫 .arch-canvas 与项目里的 mermaid 文件', onClick: function () { loadLibrary(true) } }, '重新扫描'),
        React.createElement('button', { className: 'ac-btn', onClick: closeLibrary }, '收起'),
      ),
      picker.busy ? React.createElement('div', { className: 'ac-hint' }, '正在读图库…') : null,
      picker.items.filter(function (it) { return !it.deleted }).map(function (it) {
        var on = it.key === libKey
        if (picker.renameKey === it.key) {
          return React.createElement('div', { key: it.key, className: 'ac-lib-row' },
            React.createElement('input', {
              className: 'ac-input', value: picker.renameDraft, spellCheck: false, autoFocus: true,
              placeholder: '新名字',
              onChange: function (e) { patchPicker({ renameDraft: e.target.value }) },
              // 组字中的 Enter / Esc 一律不算（见 fieldKey）：不挡的话组字按 Enter 会**真的改名**、
              // 按 Esc 会把正在打的名字整行收掉。
              onKeyDown: function (e) {
                fieldKey(e, function () { renameDiagram(it.key) }, function () { patchPicker({ renameKey: '', renameDraft: '' }) })
              },
            }),
            React.createElement('button', { className: 'ac-btn primary', onClick: function () { renameDiagram(it.key) } }, '改名'),
            React.createElement('button', { className: 'ac-btn', onClick: function () { patchPicker({ renameKey: '', renameDraft: '' }) } }, '取消'),
          )
        }
        return React.createElement('div', { key: it.key, className: 'ac-lib-row' },
          React.createElement('button', {
            className: 'ac-lib-item' + (on ? ' on' : ''), title: it.summary ? (it.summary + '\n' + it.dir) : it.dir,
            onClick: function () { if (!on) openDiagram(it.key, false) },
          }, (on ? '● ' : '') + it.key + '　' + it.nodes + ' 节点 / ' + it.edges + ' 连线'
            + (it.rel && it.relOutside ? '　·　在 ' + it.rel : '')
            + (it.summary ? '　·　' + it.summary : '')),
          picker.confirmKey === it.key
            ? [
                React.createElement('button', { key: 'yes', className: 'ac-btn danger', onClick: function () { deleteDiagram(it.key) } }, '确认删除'),
                React.createElement('button', { key: 'no', className: 'ac-btn', onClick: function () { patchPicker({ confirmKey: '' }) } }, '取消'),
              ]
            : [
                React.createElement('button', { key: 'rn', className: 'ac-btn', onClick: function () { patchPicker({ renameKey: it.key, renameDraft: it.key, confirmKey: '' }) } }, '改名'),
                React.createElement('button', { key: 'del', className: 'ac-btn danger', onClick: function () { patchPicker({ confirmKey: it.key, renameKey: '' }) } }, '删除'),
              ],
        )
      }),
      !picker.busy && picker.items.filter(function (it) { return !it.deleted }).length === 0
        ? React.createElement('div', { className: 'ac-hint' }, '这个图库还没有别的图。在下面起个名字就能新建一张。')
        : null,
      React.createElement('div', { className: 'ac-lib-new' },
        React.createElement('input', {
          className: 'ac-input', value: picker.draft, spellCheck: false,
          placeholder: '新图的名字（可以是 子项目/图名）',
          onChange: function (e) { patchPicker({ draft: e.target.value }) },
          onKeyDown: function (e) { fieldKey(e, function () { openDiagram(picker.draft, true) }) },
        }),
        React.createElement('button', {
          className: 'ac-btn primary', disabled: !String(picker.draft || '').trim(),
          onClick: function () { openDiagram(picker.draft, true) },
        }, '新建并打开'),
      ),
      picker.items.filter(function (it) { return it.deleted }).length > 0
        ? React.createElement('div', { className: 'ac-lib-deleted' },
            React.createElement('div', { className: 'ac-hint' }, '已删除（内容还在文件里，可恢复）：'),
            picker.items.filter(function (it) { return it.deleted }).map(function (it) {
              return React.createElement('div', { key: it.key, className: 'ac-lib-row' },
                React.createElement('span', { className: 'ac-lib-gone' }, it.key + '　' + it.nodes + ' 节点'),
                React.createElement('button', { className: 'ac-btn', onClick: function () { restoreDiagram(it.key) } }, '恢复'),
              )
            }),
          )
        : null,
      picker.files.length > 0
        ? React.createElement('div', { className: 'ac-lib-deleted' },
            React.createElement('div', { className: 'ac-hint' }, '项目里的 mermaid 文件（自动扫描出来的，点开就是编辑这个文件本身）：'),
            picker.files.map(function (f) {
              return React.createElement('div', { key: f.path, className: 'ac-lib-row' },
                React.createElement('button', {
                  className: 'ac-btn ac-lib-file', title: f.path,
                  onClick: function () { openPath(f.path, false) },
                }, f.rel + '　' + Math.max(1, Math.round((f.bytes || 0) / 1024)) + ' KB'),
              )
            }),
          )
        : null,
      React.createElement('div', { className: 'ac-lib-open' },
        React.createElement('input', {
          className: 'ac-input', value: picker.pathDraft, spellCheck: false,
          autoFocus: !!picker.focusPath,
          placeholder: '按路径打开：绝对路径，或相对项目根（.mmd / .mermaid）',
          onChange: function (e) { patchPicker({ pathDraft: e.target.value }) },
          onKeyDown: function (e) { fieldKey(e, function () { openPath(picker.pathDraft, false) }) },
        }),
        React.createElement('button', {
          className: 'ac-btn primary', disabled: !String(picker.pathDraft || '').trim(),
          onClick: function () { openPath(picker.pathDraft, false) },
        }, '打开'),
      ),
    ) : null,
    notePanel,
    histPanel,
    helpPanel,
    // 画布页的横幅一共三条，各说各的事，**并列不合并**（语气不同，混起来就成了一条谁也不看的噪音）：
    //   1) 解析警告 .ac-warn —— 「图可能少了一块」，宿主解析时丢掉了东西；
    //   2) 没存下去 .ac-warn.ac-savefail —— 「你刚才那一笔被回滚了」；
    //   3) 锚点保鲜 .ac-drift —— 「图还活着，但可能过期了」（两档语气，见 driftBox）。
    // 从前 1 只在源码页，而用户 90% 的时间在画布页 —— 最该看到它的地方反而看不到。
    tab === 'canvas'
      ? React.createElement(React.Fragment, null, warnBox, saveFailBox, driftBox)
      : null,
    React.createElement('div', { className: 'ac-body' },
      tab === 'canvas' ? stage : tab === 'text' ? textPane : previewPane,
    ),
    dock,
    React.createElement('div', { className: 'ac-statusbar' },
      React.createElement('span', { className: 'ac-dot' + (busy ? ' busy' : '') }),
      React.createElement('span', { className: 'grow' }, status),
      // 缩放比例：滚轮改了 k，但界面上从前没有任何地方说现在是几倍 —— 缩到 12% 还找不到
      // 「图去哪了」的时候，这个数字是唯一的线索。
      React.createElement('span', { className: 'ac-zoom', title: '当前缩放（滚轮 / Shift+滚轮横移 / 中键拖动平移 / F 适应窗口）' },
        Math.round(view.k * 100) + '%'),
      model ? React.createElement('span', null, model.nodes.length + ' 节点 · ' + model.edges.length + ' 连线 · r' + revision + ' · ' + (updatedBy === 'ai' ? 'AI' : updatedBy === 'user' ? '你' : updatedBy)) : null,
    ),
  )
}
