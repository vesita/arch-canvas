// 编辑类动作：历史栈 / 发送模型 / 提交草稿 / 增删改 / 导入导出 / 图库与文件 RPC。
// 从 studio.ts 的 ArchStudio 组件体里原样搬出来的顶层函数 —— 行为不变。
// 分片共享同一段作用域、不能 import，所以靠参数 S（本帧的 state / setter / ref 集合）通信。
function studioEditFns(S) {
  var applyServer = S.applyServer, committedRef = S.committedRef, cwd = S.cwd, cwdRef = S.cwdRef, descDraft = S.descDraft, dockForRef = S.dockForRef
  var draft = S.draft, driftRef = S.driftRef, edgeDraft = S.edgeDraft, filePath = S.filePath, fileStatusRef = S.fileStatusRef, filesDraft = S.filesDraft
  var fittedRef = S.fittedRef, geomRef = S.geomRef, groupNewName = S.groupNewName, groupPick = S.groupPick, groups = S.groups, histRef = S.histRef
  var hlTimerRef = S.hlTimerRef, hostRef = S.hostRef, labelDraft = S.labelDraft, libRevRef = S.libRevRef, mermaidText = S.mermaidText, modelRef = S.modelRef
  var noteDoneDraft = S.noteDoneDraft, noteDraft = S.noteDraft, nudgeRef = S.nudgeRef, patchHist = S.patchHist, picker = S.picker, revRef = S.revRef
  var selRef = S.selRef, sessionId = S.sessionId, setCollapsed = S.setCollapsed, setDescDraft = S.setDescDraft, setDockOpen = S.setDockOpen, setDraft = S.setDraft
  var setDriftTick = S.setDriftTick, setFileStatusTick = S.setFileStatusTick, setFilesDraft = S.setFilesDraft, setGroupNewName = S.setGroupNewName, setGroupPick = S.setGroupPick, setHighlight = S.setHighlight
  var setHistTick = S.setHistTick, setLabelDraft = S.setLabelDraft, setLibDir = S.setLibDir, setMermaidText = S.setMermaidText, setModel = S.setModel, setNoteDoneDraft = S.setNoteDoneDraft
  var setNoteDraft = S.setNoteDraft, setNotesOpen = S.setNotesOpen, setPicker = S.setPicker, setRenderError = S.setRenderError, setRevision = S.setRevision, setSaveFail = S.setSaveFail
  var setSel = S.setSel, setStatus = S.setStatus, setTab = S.setTab, setTagsDraft = S.setTagsDraft, setUpdatedBy = S.setUpdatedBy, setView = S.setView
  var sidRef = S.sidRef, svg = S.svg, svgRef = S.svgRef, tabRef = S.tabRef, tagsDraft = S.tagsDraft, userViewRef = S.userViewRef
  var viewRef = S.viewRef
  function fitView(...args) { return S.fitView.apply(null, args) }
  function flushDrafts(...args) { return S.flushDrafts.apply(null, args) }
  function nudgeFlush(...args) { return S.nudgeFlush.apply(null, args) }

  // 组折叠的开关（视图状态）。整份重建而不是原地改：React 要看到新对象才会重渲染。
  function toggleGroup(gid) {
    setCollapsed(function (m) {
      var next = {}
      for (var k in m) if (m[k]) next[k] = true
      if (next[gid]) delete next[gid]; else next[gid] = true
      return next
    })
  }

  function setLocal(next) {
    modelRef.current = next
    syncLiveNodes(next, sidRef.current)
    setModel(next)
  }

  // ---------- 编辑历史 ----------
  function remember(snapshot) {
    var h = histRef.current
    h.past.push(snapshot)
    if (h.past.length > 60) h.past.shift()
    h.future.length = 0
    setHistTick(function (n) { return n + 1 })
  }

  /**
   * 回执里的 warnings 挑出「为什么没存下去」。宿主 `persistOrRollback` 会把原因 push 成
   * 「保存失败，本次改动已回滚: <err>」，所以优先找带「回滚」的那条，找不到就退回第一条。
   */
  function rollbackWhy(list) {
    if (!list || !list.length) return ''
    for (var i = 0; i < list.length; i++) {
      if (String(list[i]).indexOf('回滚') >= 0) return String(list[i])
    }
    return String(list[0])
  }

  // 只负责发送，不碰历史
  function sendModel(next, note) {
    setLocal(next)
    committedRef.current = cloneModel(next)
    setSaveFail(null)
    rpc('doc:set', { model: next, note: note || '', where: cwdRef.current, session: sidRef.current }).then(function (r) {
      if (r && r.ok) {
        // 宿主**拒绝了这次写盘**，并且已经把这批改动从内存里回滚掉了（persistOrRollback）。
        // 回执里的 model / mermaid 就是回滚后的真相，必须用它重画 —— 从前这里照样把 revRef
        // 推成新修订号、界面留着那份没落盘的内容：源码页是回滚后的文本、画布页是新的（两页
        // 互相矛盾），而且修订号没变，2.5s 轮询判定「没变化」⇒ **永远不会自我纠正**。
        if (r.saved === false) {
          applyServer(r, 'sync')
          var why = rollbackWhy(r.warnings)
          setSaveFail(why || '写盘被拒（原因见日志）。')
          setStatus('没有存下去：本次改动已回滚' + (why ? '　·　' + why : ''))
          return
        }
        revRef.current = r.revision
        setRevision(r.revision)
        setUpdatedBy('user')
        setMermaidText(r.mermaid)
        setDraft(r.mermaid)
        if (r.fileStatus) {
          fileStatusRef.current = r.fileStatus || {}
          setFileStatusTick(function (n) { return n + 1 })
        }
        // 自己刚改完图 = 刚记了一次基线，drift 该是干净的；清掉旧的那份，
        // 免得角标继续挂着「文件改过」而其实是你自己刚确认过的状态。
        driftRef.current = r.drift || null
        setDriftTick(function (n) { return n + 1 })
        setStatus('已同步给 AI')
      } else {
        setStatus('同步被拒绝：' + String(r && r.error))
      }
    }).catch(function (e) { setStatus('同步失败：' + msgOf(e)) })
  }

  // 用户提交一个新状态：把「上一次已提交的状态」压进历史。
  // committedRef 而不是 modelRef —— 后者在拖拽中被逐帧改过了。
  function push(next, note) {
    // 别的东西要落盘了：先把还没提交的方向键微调收掉（见 nudgeFlush），
    // 否则这一笔会**连带上**刚才那几像素，撤销一次退不干净。
    // nudgeFlush 会先清掉自己的 id 再回调 push，所以这里不会递归。
    if (nudgeRef.current.id) nudgeFlush()
    remember(cloneModel(committedRef.current || modelRef.current))
    sendModel(next, note)
  }

  function undo() {
    var h = histRef.current
    if (nudgeRef.current.id) nudgeFlush()
    if (h.past.length === 0) { setStatus('没有可撤销的操作'); return }
    var prev = h.past.pop()
    h.future.push(cloneModel(modelRef.current))
    setHistTick(function (n) { return n + 1 })
    if (tabRef.current !== 'canvas') setTab('canvas')
    sendModel(prev, '用户撤销了上一步')
    setStatus('已撤销')
  }

  function redo() {
    var h = histRef.current
    if (h.future.length === 0) { setStatus('没有可重做的操作'); return }
    var next = h.future.pop()
    h.past.push(cloneModel(modelRef.current))
    setHistTick(function (n) { return n + 1 })
    if (tabRef.current !== 'canvas') setTab('canvas')
    sendModel(next, '用户重做了上一步')
    setStatus('已重做')
  }

  // 把 AI 刚动过的节点在图上闪一下。
  // 高亮的清除走定时器（有 timer 服务就用它，否则退回原生 —— 见 runtime.ts 的 ctxTimeout）。
  function flash(ids) {
    if (hlTimerRef.current) {
      try { hlTimerRef.current() } catch (e) {}
      hlTimerRef.current = null
    }
    setHighlight({ nodes: ids, key: Date.now() })
    hlTimerRef.current = ctxTimeout(function () {
      hlTimerRef.current = null
      setHighlight(null)
    }, 5200)
  }


  /** 拉检查点清单。cwd 是必须的：历史按文件存，宿主得先落到同一个图库上。 */
  function loadHistory() {
    patchHist({ busy: true })
    rpc('doc:history', { where: cwd, session: sessionId }).then(function (r) {
      if (r && r.ok) patchHist({ busy: false, entries: r.entries || [], confirmSeq: 0 })
      else patchHist({ busy: false, entries: [] })
    }).catch(function () { patchHist({ busy: false, entries: [] }) })
  }

  /**
   * 退回某个检查点。**以宿主的返回值为准**：成功后整份文档都以回执为准重画
   * （与 doc:get 走同一条 applyServer），失败就原样显示错误 —— 不本地假装成功。
   */
  function rollbackTo(seq) {
    setStatus('正在退回检查点…')
    rpc('doc:rollback', { seq: seq, where: cwd, session: sessionId }).then(function (r) {
      if (!r || r.ok === false) { setStatus('退回失败：' + String((r && r.error) || '未知原因')); loadHistory(); return }
      applyServer(r, 'rollback')
      setStatus('已退回到检查点 #' + seq + '（这一步本身也记了一次检查点，可以再往前走）')
      loadHistory()
    }).catch(function (e) { setStatus('退回失败：' + msgOf(e)); loadHistory() })
  }

  function deleteSel() {
    var s = selRef.current
    var cur = modelRef.current
    if (!s || !cur) return
    // 删掉之后选中就没了：面板与「面板当前展示的是谁」都要一起复位。
    // 不复位的话，dockOpen 会一直是 true（第一下 Esc 被吞），而 dockForRef 还记着已经删掉的那个元素 ——
    // 撤销回来再点它，第一下会变成「收起」（复核第 4 条）。
    dockForRef.current = null
    setDockOpen(false)
    var next = cloneModel(cur)
    if (s.kind === 'node') {
      next.nodes = next.nodes.filter(function (n) { return n.id !== s.id })
      next.edges = next.edges.filter(function (e) { return e.from !== s.id && e.to !== s.id })
      setSel(null)
      push(next, '用户删除了节点')
      setStatus('已删除节点')
    } else {
      var found = false
      var filtered = []
      for (var i = 0; i < next.edges.length; i++) {
        var ed = next.edges[i]
        if (!found && ed.from === s.from && ed.to === s.to) {
          found = true
          continue
        }
        filtered.push(ed)
      }
      setSel(null)
      if (found) {
        next.edges = filtered
        push(next, '用户删除了一条连线')
        setStatus('已删除连线')
      }
    }
  }

  function addNode() {
    var cur = modelRef.current
    if (!cur) return
    // 新节点会顶掉面板里的草稿，所以先把旧的那份落下去（见 flushDrafts）。
    flushDrafts()
    var used = {}
    for (var i = 0; i < cur.nodes.length; i++) used[cur.nodes[i].id] = true
    var k = cur.nodes.length + 1
    while (used['n' + k]) k += 1
    var id = 'n' + k
    var v = viewRef.current
    var el = hostRef.current
    var rect = el ? el.getBoundingClientRect() : { width: 320, height: 300 }
    var x = Math.round((rect.width / 2 - v.x) / v.k)
    var y = Math.round((rect.height / 2 - v.y) / v.k)
    var next = cloneModel(cur)
    next.nodes.push({ id: id, label: '新节点', shape: 'rect', group: null, x: x, y: y })
    push(next, '用户新增了节点')
    setSel({ kind: 'node', id: id })
    // 新增的节点要**直接展开**详情（用户下一步一定是给它起名字），
    // 所以这里不是 toggle，但要把「面板现在展示的是谁」记上，后续点它才能收起。
    dockForRef.current = { kind: 'node', id: id }
    setDockOpen(true)
    setLabelDraft('新节点')
    setDescDraft('')
    setGroupPick('')
    setGroupNewName('')
    setNoteDraft('')
    setNoteDoneDraft(false)
    setFilesDraft('')
    setStatus('已新增节点，可在下方改名字')
  }

  function relayout() {
    var cur = modelRef.current
    if (!cur) return
    var cleaned = consolidateEdgesModel(cur)
    push(autoLayout(cleaned), '用户点了自动布局')
    setStatus('已整理连线并自动布局')
    fittedRef.current = false
    if (fitView(false)) fittedRef.current = true
  }

  function consolidateEdgesAction() {
    var cur = modelRef.current
    if (!cur) return
    var cleaned = consolidateEdgesModel(cur)
    push(cleaned, '用户点了整理连线')
    setStatus('已合并同向平行边')
  }

  function commitLabel() {
    var s = selRef.current
    var cur = modelRef.current
    if (!s || s.kind !== 'node' || !cur) return
    var node = null
    for (var i = 0; i < cur.nodes.length; i++) if (cur.nodes[i].id === s.id) node = cur.nodes[i]
    // 标题与描述是两个框，合成之后才是真正的 label —— 比较也用合成值，
    // 否则「只改了描述」会被误判成没变而悄悄丢掉。
    var want = composeLabel(labelDraft, descDraft)
    if (!node || node.label === want) return
    var next = cloneModel(cur)
    for (var j = 0; j < next.nodes.length; j++) if (next.nodes[j].id === s.id) next.nodes[j].label = want
    push(next, '用户改了节点名称')
    setStatus('已改名')
    fittedRef.current = false
  }



  /**
   * 组 id 不能含空格：`scanNodeRef` 的 ID_RE 遇到空格就停，`subgraph AI 端["AI 端"]`
   * 会被解析成 id=`AI` + 标签=`端["AI 端"]`，下次加载组结构就分裂、往返严重漂移。
   * 宿主侧 `set_group` 会过一遍 `cleanId`，但**检查器这条路是客户端直接改模型** ——
   * 从前这里没洗，用户在分组框里打一个空格就能把源文本写坏（审计第 3 条）。
   */
  function groupKeyOf(name) {
    return String(name == null ? '' : name).replace(/\s+/g, '_').replace(/[\u005b\u005d{}()"#;|&<>]/g, '')
  }

  function commitGroup() {
    // 下拉框的三态：'' = 移出，'#new' = 交给下面那个名字框，其余 = 现有组的 id。
    // 选「新建」时先一步什么都不做 —— 名字还没打呢。
    if (groupPick === GROUP_NEW) return
    applyGroup(groupPick ? groupPick : null, null)
  }

  /**
   * 把当前选中的节点放进 `want` 这个组（`want` = null 表示移出）。
   *
   * 从前这条路是「一个自由文本框」，于是有三个坑（2026-09-21 按体验反馈改成下拉框）：
   * ① 用户得**记得**组名，打错一个字就凭空多一个组、图被分成两半；
   * ② 看不出图上一共有哪些组，也不知道自己现在在哪一个；
   * ③ 空、已有、新建三种意图挤在同一个输入框里，回车之前分不出来。
   */
  function applyGroup(want, newLabel) {
    var s = selRef.current
    var cur = modelRef.current
    if (!s || s.kind !== 'node' || !cur) return
    var next = cloneModel(cur)
    var prev = undefined
    var found = false
    for (var i = 0; i < next.nodes.length; i++) {
      if (next.nodes[i].id !== s.id) continue
      prev = next.nodes[i].group || null
      next.nodes[i].group = want
      found = true
    }
    if (!found) return
    if (prev === want) return
    if (want) {
      var exists = false
      for (var g = 0; g < next.groups.length; g++) if (next.groups[g].id === want) exists = true
      // label 保留用户打的原话（可以是 "AI 端"），id 用洗干净的那个
      if (!exists) next.groups.push({ id: want, label: newLabel == null ? want : newLabel })
    }
    push(next, '用户改了分组')
    setStatus('已更新分组')
  }

  /** 「＋ 新建组…」那条路：把名字洗干净当 id，名字已经存在就直接认领那个组。 */
  function commitNewGroup() {
    var raw = String(groupNewName || '').trim()
    if (!raw) return
    var pick = groupKeyOf(raw)
    if (!pick) return
    // 先按现有组的 id 或标签认领：用户打的是给人看的名字（"AI 端"），而 id 早已被洗成 "AI端"。
    // 不认领就会凭空多出一个同名组、图被分成两半 —— 这条与旧实现一致，别删。
    var cur = modelRef.current
    var groups = (cur && cur.groups) || []
    var want = pick
    for (var g = 0; g < groups.length; g++) {
      var gg = groups[g]
      if (gg && (gg.id === pick || gg.label === raw || groupKeyOf(gg.label) === pick)) { want = gg.id; break }
    }
    applyGroup(want, raw)
    setGroupPick(want)
    setGroupNewName('')
  }

  /**
   * 提交节点留言。空文本 = 删除留言（文件里那一行也不再写出）。
   * 留言只存在节点上、经 `doc:set` 整份回传落盘，所以不需要新的 RPC。
   */
  function commitNote() {
    var s = selRef.current
    var cur = modelRef.current
    if (!s || s.kind !== 'node' || !cur) return
    var text = String(noteDraft == null ? '' : noteDraft).trim()
    var next = cloneModel(cur)
    var node = null
    for (var i = 0; i < next.nodes.length; i++) if (next.nodes[i].id === s.id) node = next.nodes[i]
    if (!node) return
    // 没有正文时「已投递」不成立（宿主侧也这么归一），别把半截状态写进文件
    var changed = (node.note || '') !== text
    var done = text !== '' && noteDoneDraft === true
    // 改过正文 = 这条留言重新变成**待递**：用户花力气改了它，就是为了让我重新看到它。
    // 不改的话，一条已投递的留言被编辑后仍然不进上下文 —— 用户改的话 AI 永远读不到，
    // 而界面上它躺在历史里，看不出任何异常（用户报的「编辑后应该自动重新打开」）。
    var reopened = changed && done
    if (reopened) done = false
    if ((node.note || '') === text && (node.noteDone === true) === done) return
    node.note = text
    node.noteDone = done
    if (text === '' || reopened) setNoteDoneDraft(false)
    push(next, text === '' ? '用户清除了节点留言' : (reopened ? '用户改了留言，已自动重新打开' : '用户写了节点留言'))
    setStatus(text === ''
      ? '已清除留言'
      : (reopened
        ? '留言已改动，自动放回待递（会再送一次）'
        : (done ? '留言已保存（已投递，在历史里）' : '留言已保存，AI 读一次就消失')))
    // 两处都写就会互相打架（一个用签名去重、一个用 `@id` 去重，删了又被另一个加回来）。
  }

  /**
   * 提交代码锚点引用。按行切分、trim、丢掉空行；与旧值相同时直接 return。
   * 空数组 = 清掉该节点的所有引用（宿主序列化时就不写出 %% @file 行）。
   */
  function commitFiles() {
    var s = selRef.current
    var cur = modelRef.current
    if (!s || s.kind !== 'node' || !cur) return
    var raw = String(filesDraft == null ? '' : filesDraft)
    var lines = raw.split('\n')
    var list = []
    for (var i = 0; i < lines.length; i++) {
      var item = lines[i].trim()
      if (item) list.push(item)
    }
    var next = cloneModel(cur)
    var node = null
    for (var j = 0; j < next.nodes.length; j++) if (next.nodes[j].id === s.id) node = next.nodes[j]
    if (!node) return
    var oldList = node.files || []
    if (oldList.length === list.length) {
      var same = true
      for (var k = 0; k < list.length; k++) {
        if (oldList[k] !== list[k]) { same = false; break }
      }
      if (same) return
    }
    node.files = list
    push(next, '用户改了代码锚点')
    setStatus(list.length === 0 ? '已清除代码锚点' : '已保存代码锚点 (' + list.length + ' 个引用)')
  }

  function commitTags() {
    var s = selRef.current
    var cur = modelRef.current
    if (!s || s.kind !== 'node' || !cur) return
    var parts = String(tagsDraft || '').split(/[\s,，]+/).map(function (x) { return x.trim().replace(/^#/, '') }).filter(Boolean)
    var next = cloneModel(cur)
    var node = null
    for (var j = 0; j < next.nodes.length; j++) if (next.nodes[j].id === s.id) node = next.nodes[j]
    if (!node) return
    if (JSON.stringify(node.tags || []) === JSON.stringify(parts)) return
    node.tags = parts
    push(next, '用户改了概念标签')
    setStatus(parts.length === 0 ? '已清除概念标签' : '已保存概念标签 (#' + parts.join(' #') + ')')
  }

  /** 收起（挪进历史）/ 再送一次（放回待递）。`id` 省略时作用于当前选中的节点（留言清单里按 id 调用）。 */
  function markNote(done, id?) {
    var cur = modelRef.current
    if (!cur) return
    var target = id || (selRef.current && selRef.current.kind === 'node' ? selRef.current.id : '')
    if (!target) return
    var next = cloneModel(cur)
    var found = null
    for (var i = 0; i < next.nodes.length; i++) if (next.nodes[i].id === target) found = next.nodes[i]
    if (!found || !found.note) return
    found.noteDone = done === true
    if (!id) setNoteDoneDraft(done === true)
    push(next, done ? '用户收起了留言（挪进历史）' : '用户把留言放回待递')
    setStatus(done ? '已挪进历史，不会再投递' : '已放回待递，会再送一次')
  }

  /** 从留言清单跳到某个节点：选中它（检查器随之出现），并把它挪到视口中央。 */
  function focusNode(id) {
    var cur = modelRef.current
    if (!cur) return
    var node = null
    for (var i = 0; i < cur.nodes.length; i++) if (cur.nodes[i].id === id) node = cur.nodes[i]
    if (!node) return
    // 「跳到另一个节点」也会把草稿刷掉：先落下去，再换选中（见 flushDrafts）。
    flushDrafts()
    setSel({ kind: 'node', id: id })
    // 「跳到这个节点」= 明确要看它的详情，所以是展开而不是 toggle；但要记上面板展示的是谁。
    dockForRef.current = { kind: 'node', id: id }
    setDockOpen(true)
    var sp1 = splitLabel(node.label)
    setLabelDraft(sp1.title)
    setDescDraft(sp1.desc)
    setGroupPick(node.group || '')
    setGroupNewName('')
    setNoteDraft(node.note || '')
    setNoteDoneDraft(node.noteDone === true)
    setFilesDraft((node.files || []).join('\n'))
    setTagsDraft((node.tags || []).join(' '))
    setNotesOpen(false)
    var g = geomRef.current[id]
    var svg = svgRef.current
    if (g && svg && typeof svg.getBoundingClientRect === 'function') {
      var box = svg.getBoundingClientRect()
      var v = viewRef.current
      var nv = { k: v.k, x: box.width / 2 - g.x * v.k, y: box.height / 2 - g.y * v.k }
      viewRef.current = nv
      userViewRef.current = true
      setView(nv)
    }
    setStatus('已定位到节点 ' + id)
  }

  function setShape(shape) {
    var s = selRef.current
    var cur = modelRef.current
    if (!s || s.kind !== 'node' || !cur) return
    var next = cloneModel(cur)
    for (var i = 0; i < next.nodes.length; i++) if (next.nodes[i].id === s.id) next.nodes[i].shape = shape
    push(next, '用户改了节点形状')
  }

  function commitEdgeLabel() {
    var s = selRef.current
    var cur = modelRef.current
    if (!s || s.kind !== 'edge' || !cur) return
    var next = cloneModel(cur)
    var targetEdge = null
    for (var i = 0; i < next.edges.length; i++) {
      if (next.edges[i].from === s.from && next.edges[i].to === s.to) {
        targetEdge = next.edges[i]
        break
      }
    }
    if (!targetEdge) { setSel(null); return }
    if (targetEdge.label === edgeDraft) return
    targetEdge.label = edgeDraft
    push(next, '用户改了连线标签')
    setStatus('已更新连线标签')
  }

  function setArrow(arrow) {
    var s = selRef.current
    var cur = modelRef.current
    if (!s || s.kind !== 'edge' || !cur) return
    var next = cloneModel(cur)
    var targetEdge = null
    for (var i = 0; i < next.edges.length; i++) {
      if (next.edges[i].from === s.from && next.edges[i].to === s.to) {
        targetEdge = next.edges[i]
        break
      }
    }
    if (!targetEdge) { setSel(null); return }
    targetEdge.arrow = arrow
    push(next, '用户改了连线样式')
  }

  // 内容包围盒（含分组框），导出与适应窗口共用同一套算法
  function contentBox() {
    var cur = modelRef.current
    if (!cur || cur.nodes.length === 0) return null
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (var i = 0; i < cur.nodes.length; i++) {
      var g = geomRef.current[cur.nodes[i].id]
      if (!g) continue
      minX = Math.min(minX, g.x - g.w / 2); maxX = Math.max(maxX, g.x + g.w / 2)
      minY = Math.min(minY, g.y - g.h / 2); maxY = Math.max(maxY, g.y + g.h / 2)
    }
    for (var j = 0; j < groups.length; j++) {
      minX = Math.min(minX, groups[j].x); maxX = Math.max(maxX, groups[j].x + groups[j].w)
      minY = Math.min(minY, groups[j].y); maxY = Math.max(maxY, groups[j].y + groups[j].h)
    }
    if (!isFinite(minX)) return null
    var pad = 26
    return {
      x: Math.round(minX - pad), y: Math.round(minY - pad),
      w: Math.ceil(maxX - minX + pad * 2), h: Math.ceil(maxY - minY + pad * 2),
    }
  }

  function exportSvg() {
    try {
      var box = contentBox()
      var world = svgRef.current && svgRef.current.querySelector('.ac-world')
      if (!box) { setStatus('画布是空的，没什么可导出'); return }
      if (!world) { setStatus('导出失败：找不到画布内容'); return }
      downloadBlob('architecture.svg', new Blob([buildExportSvg(world, box)], { type: 'image/svg+xml;charset=utf-8' }))
      setStatus('已导出 SVG（' + box.w + '×' + box.h + '）')
    } catch (e) {
      setStatus('导出 SVG 失败：' + msgOf(e))
    }
  }

  function exportPng() {
    try {
      var box = contentBox()
      var world = svgRef.current && svgRef.current.querySelector('.ac-world')
      if (!box) { setStatus('画布是空的，没什么可导出'); return }
      if (!world) { setStatus('导出失败：找不到画布内容'); return }
      setStatus('正在生成 PNG…')
      svgToPngBlob(buildExportSvg(world, box), box.w, box.h, 2).then(function (blob) {
        downloadBlob('architecture.png', blob)
        setStatus('已导出 PNG（' + box.w * 2 + '×' + box.h * 2 + '）')
      }).catch(function (e) { setStatus('导出 PNG 失败：' + msgOf(e)) })
    } catch (e) {
      setStatus('导出 PNG 失败：' + msgOf(e))
    }
  }

  function copySource() {
    var text = mermaidText || ''
    if (!text) { setStatus('还没有内容可复制'); return }
    function fallback() {
      setTab('text')
      setStatus('自动复制被拒，已切到「源码」标签，手动全选复制即可')
    }
    try {
      if (!navigator.clipboard) { fallback(); return }
      navigator.clipboard.writeText(text).then(function () {
        setStatus('已复制 Mermaid 源码（' + text.split('\n').length + ' 行）')
      }, fallback)
    } catch (e) {
      fallback()
    }
  }

  // ---------- 图库选择器：列图 / 切图 / 新建 / 改名 / 软删除 / 恢复 ----------
  // 图库跟着项目走（<项目>/.arch-canvas/），所以每个 RPC 都带 where=会话 cwd，
  // 界面与 AI 工具才会落在同一个项目图库上。
  function patchPicker(patch) {
    setPicker(function (prev) { return Object.assign({}, prev, patch) })
  }

  function closeLibrary() {
    patchPicker({ open: false, draft: '', pathDraft: '', focusPath: false, renameKey: '', renameDraft: '', confirmKey: '' })
  }

  // rescan 为真时让宿主忽略扫描间隔，立刻重扫（「重新扫描」按钮走这条）
  /**
   * 读一次图库清单（只更新数据，不打开面板）。
   * 起始页要在「用户还没点图库」的时候就列出项目里已有的图，所以这条路必须独立存在。
   * quiet 用于自动触发的场景：读不到就别去污染状态栏。
   */
  function refreshLibraryItems(rescan?: boolean, quiet?: boolean) {
    return rpc('doc:list', { where: cwdRef.current, session: sidRef.current, rescan: !!rescan }).then(function (r) {
      if (!r || !r.ok) {
        if (!quiet) setStatus('读图库失败：' + String(r && r.error))
        patchPicker({ busy: false })
        return false
      }
      patchPicker({ items: r.items || [], files: r.files || [], busy: false })
      setLibDir(r.dir || '')
      if (typeof r.libraryRev === 'number') libRevRef.current = r.libraryRev
      return true
    }).catch(function (e) {
      if (!quiet) setStatus('读图库失败：' + msgOf(e))
      patchPicker({ busy: false })
      return false
    })
  }

  function loadLibrary(rescan?: boolean) {
    patchPicker({ open: true, busy: true, draft: '' })
    refreshLibraryItems(rescan)
  }

  // 工具条上的「打开」：展开选择器并把光标放进路径输入框。
  // 入口只在选择器里的话，新用户根本找不到 —— 起始页上也会给同一个按钮。
  function openFilePicker() {
    patchPicker({ focusPath: true })
    loadLibrary(false)
  }

  // 按路径打开项目里的一个 mermaid 文件：此后画布编辑的就是这个文件本身
  function openPath(path, create) {
    var want = String(path == null ? '' : path).trim()
    if (!want) { setStatus('请填一个文件路径（绝对路径，或相对项目根）'); return }
    rpc('doc:openPath', { path: want, create: !!create, where: cwdRef.current, session: sidRef.current }).then(function (r) {
      if (!r || !r.ok) { setStatus('打开失败：' + String(r && r.error)); return }
      closeLibrary()
      applyServer(r, 'sync')
      fittedRef.current = false
      setStatus((create ? '已新建并打开 ' : '已打开 ') + want)
    }).catch(function (e) { setStatus('打开失败：' + msgOf(e)) })
  }

  function openDiagram(key, create) {
    var want = String(key == null ? '' : key).trim()
    if (!want) { setStatus('先给新图起个名字'); return }
    rpc('doc:open', { key: want, create: !!create, where: cwdRef.current, session: sidRef.current }).then(function (r) {
      if (!r || !r.ok) { setStatus('切图失败：' + String(r && r.error)); return }
      closeLibrary()
      applyServer(r, 'sync')  // 换的是文档，不是编辑：历史由 applyServer 按切图清掉
      fittedRef.current = false
      setStatus('已切到「' + want + '」')
    }).catch(function (e) { setStatus('切图失败：' + msgOf(e)) })
  }

  function renameDiagram(key) {
    var to = String(picker.renameDraft == null ? '' : picker.renameDraft).trim()
    if (!to) { setStatus('新名字不能为空'); return }
    rpc('doc:rename', { from: key, to: to, where: cwdRef.current, session: sidRef.current }).then(function (r) {
      if (!r || !r.ok) { setStatus('改名失败：' + String(r && r.error)); return }
      patchPicker({ renameKey: '', renameDraft: '' })
      if (r.model) applyServer(r, 'sync')
      loadLibrary()
      setStatus('已把「' + key + '」改名为「' + to + '」')
    }).catch(function (e) { setStatus('改名失败：' + msgOf(e)) })
  }

  function deleteDiagram(key) {
    rpc('doc:delete', { key: key, where: cwdRef.current, session: sidRef.current }).then(function (r) {
      if (!r || !r.ok) { setStatus('删除失败：' + String(r && r.error)); return }
      patchPicker({ confirmKey: '' })
      // 删的正好是当前这张时宿主已经换回默认图，回执里带着新文档
      if (r.model) applyServer(r, 'sync')
      loadLibrary()
      setStatus('已删除「' + key + '」（软删除：内容还在文件里，能恢复）')
    }).catch(function (e) { setStatus('删除失败：' + msgOf(e)) })
  }

  function restoreDiagram(key) {
    rpc('doc:restore', { key: key, where: cwdRef.current, session: sidRef.current }).then(function (r) {
      if (!r || !r.ok) { setStatus('恢复失败：' + String(r && r.error)); return }
      loadLibrary()
      setStatus('已恢复「' + key + '」')
    }).catch(function (e) { setStatus('恢复失败：' + msgOf(e)) })
  }

  // 下钻角标：节点带 @link 时点它跳到那张图 —— 「一个节点展开成一张图」的入口
  function onJumpDown(e, key) {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    openDiagram(key, false)
  }

  function applyDraft() {
    rpc('doc:applyText', { text: draft, where: cwdRef.current, session: sidRef.current }).then(function (r) {
      if (!r || !r.ok) { setRenderError(String(r && r.error)); setStatus('源码未能解析: ' + String(r && r.error)); return }
      setRenderError('')
      applyServer(r, 'local')
      fittedRef.current = false
      setStatus('已从源码重建画布')
    }).catch(function (e) {
      var err = msgOf(e)
      setRenderError(err)
      setStatus('应用失败：' + err)
    })
  }

  function saveToFile() {
    rpc('doc:file', { path: filePath, save: true, where: cwdRef.current, session: sidRef.current }).then(function (r) {
      if (r && r.saved) setStatus('已写入 ' + filePath)
      else setStatus('写盘失败：' + String(r && r.error))
    }).catch(function (e) { setStatus('写盘失败：' + msgOf(e)) })
  }
  S.addNode = addNode
  S.applyDraft = applyDraft
  S.applyGroup = applyGroup
  S.closeLibrary = closeLibrary
  S.commitEdgeLabel = commitEdgeLabel
  S.commitFiles = commitFiles
  S.commitLabel = commitLabel
  S.commitNewGroup = commitNewGroup
  S.commitNote = commitNote
  S.commitTags = commitTags
  S.consolidateEdgesAction = consolidateEdgesAction
  S.copySource = copySource
  S.deleteDiagram = deleteDiagram
  S.deleteSel = deleteSel
  S.exportPng = exportPng
  S.exportSvg = exportSvg
  S.flash = flash
  S.focusNode = focusNode
  S.loadHistory = loadHistory
  S.loadLibrary = loadLibrary
  S.markNote = markNote
  S.onJumpDown = onJumpDown
  S.openDiagram = openDiagram
  S.openFilePicker = openFilePicker
  S.openPath = openPath
  S.patchPicker = patchPicker
  S.push = push
  S.redo = redo
  S.refreshLibraryItems = refreshLibraryItems
  S.relayout = relayout
  S.remember = remember
  S.renameDiagram = renameDiagram
  S.restoreDiagram = restoreDiagram
  S.rollbackTo = rollbackTo
  S.setArrow = setArrow
  S.setLocal = setLocal
  S.setShape = setShape
  S.toggleGroup = toggleGroup
  S.undo = undo
}
