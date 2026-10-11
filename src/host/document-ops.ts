// 宿主侧架构图增量编辑算子执行器 (applyOps)
// 包含节点的增删改、连线属性、标签、代码锚点与图级总结

function opRef(value, field, tag, problems) {
  if (typeof value !== 'string' || value.trim() === '') {
    problems.push(tag + ': 缺少 ' + field)
    return null
  }
  return cleanId(value)
}

function applyOps(ops) {
  var problems = []
  var done = []
  for (var i = 0; i < ops.length; i++) {
    var op = ops[i] && typeof ops[i] === 'object' ? ops[i] : {}
    var kind = op.op
    var tag = '第 ' + (i + 1) + ' 个 op(' + String(kind) + ')'
    if (kind === 'mark_note') {
      var mnId = op.id ? cleanId(String(op.id)) : ''
      var mnNode = mnId ? findNode(mnId) : null
      if (!mnNode) { problems.push(tag + ': 找不到节点 ' + (mnId || '(空)') + '，mark_note 需要有效的 id'); continue }
      if (!mnNode.note) { problems.push(tag + ': 节点 ' + mnId + ' 上没有留言，无需标记'); continue }
      if (op.done !== undefined && typeof op.done !== 'boolean') {
        problems.push(tag + ': done 必须是布尔（省略 = 标成已办，false = 重新打开）')
        continue
      }
      mnNode.noteDone = op.done === false ? false : true
      done.push(mnNode.noteDone ? ('把 ' + mnId + ' 的留言标成已办') : ('重新打开 ' + mnId + ' 的留言'))
      continue
    }
    if (kind === 'add_node') {
      var nid = op.id ? cleanId(op.id) : nextNodeId()
      if (findNode(nid)) { problems.push(tag + ': 节点 ' + nid + ' 已存在，改用 set_label'); continue }
      if (op.shape !== undefined && !SHAPE_WRAP[op.shape]) { problems.push(tag + ': 未知形状 ' + String(op.shape)); continue }
      if (op.x !== undefined && (typeof op.x !== 'number' || !isFinite(op.x))) { problems.push(tag + ': x 必须是有限数字'); continue }
      if (op.y !== undefined && (typeof op.y !== 'number' || !isFinite(op.y))) { problems.push(tag + ': y 必须是有限数字'); continue }
      var ngid = typeof op.group === 'string' && op.group ? cleanId(op.group) : null
      if (ngid) {
        var groupExists = false
        for (var ge = 0; ge < doc.groups.length; ge++) if (doc.groups[ge].id === ngid) { groupExists = true; break }
        if (!groupExists) doc.groups.push({ id: ngid, label: ngid })
      }
      var newNode: any = {
        id: nid,
        label: typeof op.label === 'string' && op.label ? normalizeBreaks(op.label) : nid,
        shape: SHAPE_WRAP[op.shape] ? op.shape : 'rect',
        group: ngid,
        x: typeof op.x === 'number' && isFinite(op.x) ? op.x : null,
        y: typeof op.y === 'number' && isFinite(op.y) ? op.y : null,
        link: normLink(op.link),
        note: '',
        noteDone: false,
        files: [],
      }
      if (Array.isArray(op.tags)) {
        newNode.tags = op.tags.filter(function (t) { return typeof t === 'string' && t.trim() }).map(function (t) { return t.trim() })
      }
      doc.nodes.push(newNode)
      done.push('新增节点 ' + nid)
    } else if (kind === 'set_label') {
      var sid = opRef(op.id, 'id', tag, problems)
      if (sid === null) continue
      var sn = findNode(sid)
      if (!sn) { problems.push(tag + ': 找不到节点 ' + String(op.id)); continue }
      sn.label = typeof op.label === 'string' && op.label ? normalizeBreaks(op.label) : sn.id
      done.push('改名 ' + sn.id)
    } else if (kind === 'set_shape') {
      var shid = opRef(op.id, 'id', tag, problems)
      if (shid === null) continue
      var shn = findNode(shid)
      if (!shn) { problems.push(tag + ': 找不到节点 ' + String(op.id)); continue }
      if (!SHAPE_WRAP[op.shape]) { problems.push(tag + ': 未知形状 ' + String(op.shape)); continue }
      shn.shape = op.shape
      done.push('改形状 ' + shn.id + ' -> ' + op.shape)
    } else if (kind === 'set_link') {
      var lid0 = opRef(op.id, 'id', tag, problems)
      if (lid0 === null) continue
      var ln0 = findNode(lid0)
      if (!ln0) { problems.push(tag + ': 找不到节点 ' + String(op.id)); continue }
      if (typeof op.link !== 'string') { problems.push(tag + ': link 必须是字符串（取消下钻传空串）'); continue }
      ln0.link = normLink(op.link)
      done.push(ln0.link ? ('设置下钻 ' + ln0.id + ' -> ' + ln0.link) : ('取消下钻 ' + ln0.id))
    } else if (kind === 'move_node') {
      var mid = opRef(op.id, 'id', tag, problems)
      if (mid === null) continue
      var mn = findNode(mid)
      if (!mn) { problems.push(tag + ': 找不到节点 ' + String(op.id)); continue }
      if (op.x !== undefined && (typeof op.x !== 'number' || !isFinite(op.x))) { problems.push(tag + ': x 必须是有限数字'); continue }
      if (op.y !== undefined && (typeof op.y !== 'number' || !isFinite(op.y))) { problems.push(tag + ': y 必须是有限数字'); continue }
      if (typeof op.x !== 'number' && typeof op.y !== 'number') { problems.push(tag + ': 至少要给 x 或 y'); continue }
      if (typeof op.x === 'number') mn.x = op.x
      if (typeof op.y === 'number') mn.y = op.y
      done.push('移动 ' + mn.id)
    } else if (kind === 'remove_node') {
      var rid = opRef(op.id, 'id', tag, problems)
      if (rid === null) continue
      if (!findNode(rid)) { problems.push(tag + ': 找不到节点 ' + String(op.id)); continue }
      removeNode(rid)
      done.push('删除节点 ' + rid)
    } else if (kind === 'add_edge') {
      var af = opRef(op.from, 'from', tag, problems)
      var at = opRef(op.to, 'to', tag, problems)
      if (af === null || at === null) continue
      var f = findNode(af)
      var t = findNode(at)
      if (!f) { problems.push(tag + ': from 节点不存在 ' + String(op.from)); continue }
      if (!t) { problems.push(tag + ': to 节点不存在 ' + String(op.to)); continue }
      if (f.id === t.id) { problems.push(tag + ': 不允许自环'); continue }
      var arrow = ARROW_SET[op.arrow] ? op.arrow : '-->'
      var dupIdx = -1
      for (var d = 0; d < doc.edges.length; d++) {
        if (doc.edges[d].from === f.id && doc.edges[d].to === t.id) { dupIdx = d; break }
      }
      if (dupIdx >= 0) {
        var newLbl = typeof op.label === 'string' ? normalizeBreaks(op.label) : ''
        if (newLbl) {
          var existingLbl = doc.edges[dupIdx].label || ''
          if (existingLbl && existingLbl !== newLbl) {
            if (existingLbl.indexOf(newLbl) < 0) doc.edges[dupIdx].label = existingLbl + ' / ' + newLbl
          } else {
            doc.edges[dupIdx].label = newLbl
          }
        }
        done.push('合并连线 ' + f.id + ' -> ' + t.id)
        continue
      }
      doc.edges.push({ id: 'e' + (doc.edges.length + 1), from: f.id, to: t.id, label: typeof op.label === 'string' ? normalizeBreaks(op.label) : '', arrow: arrow })
      done.push('连线 ' + f.id + ' -> ' + t.id)
    } else if (kind === 'consolidate_edges') {
      var mergedN = consolidateParallelEdges(doc)
      done.push('合并同向连线 ' + mergedN + ' 条')
    } else if (kind === 'remove_edge') {
      var xf = opRef(op.from, 'from', tag, problems)
      var xt = opRef(op.to, 'to', tag, problems)
      if (xf === null || xt === null) continue
      if (!hasEdge(xf, xt)) { problems.push(tag + ': 这两点之间没有连线'); continue }
      removeEdge(xf, xt)
      done.push('删除连线 ' + xf + ' -> ' + xt)
    } else if (kind === 'set_edge_label') {
      var lf = opRef(op.from, 'from', tag, problems)
      var lt = opRef(op.to, 'to', tag, problems)
      if (lf === null || lt === null) continue
      if (!findNode(lf) || !findNode(lt)) { problems.push(tag + ': from/to 节点不存在'); continue }
      if (lf === lt) { problems.push(tag + ': 不允许自环'); continue }
      if (!hasEdge(lf, lt)) { problems.push(tag + ': 这两点之间没有连线（要新建用 add_edge）'); continue }
      setEdgeLabel(lf, lt, typeof op.label === 'string' ? normalizeBreaks(op.label) : '')
      done.push('改连线标签 ' + lf + ' -> ' + lt)
    } else if (kind === 'set_tags') {
      var tid0 = opRef(op.id, 'id', tag, problems)
      if (tid0 === null) continue
      var tn = findNode(tid0)
      if (!tn) { problems.push(tag + ': 找不到节点 ' + String(op.id)); continue }
      if (!Array.isArray(op.tags)) { problems.push(tag + ': tags 必须是字符串数组'); continue }
      tn.tags = op.tags.filter(function (t) { return typeof t === 'string' && t.trim() }).map(function (t) { return t.trim() })
      done.push('设置标签 ' + tn.id + ' -> ' + JSON.stringify(tn.tags))
    } else if (kind === 'set_group') {
      var gid0 = opRef(op.id, 'id', tag, problems)
      if (gid0 === null) continue
      var gn = findNode(gid0)
      if (!gn) { problems.push(tag + ': 找不到节点 ' + String(op.id)); continue }
      if (typeof op.group !== 'string') { problems.push(tag + ': group 必须是字符串（移出分组传空串）'); continue }
      var want = op.group ? cleanId(op.group) : null
      gn.group = want
      if (want) {
        var exists = false
        for (var q = 0; q < doc.groups.length; q++) if (doc.groups[q].id === want) { exists = true; break }
        if (!exists) doc.groups.push({ id: want, label: typeof op.label === 'string' && op.label ? normalizeBreaks(op.label) : want })
      }
      done.push('设置分组 ' + gn.id + ' -> ' + String(want))
    } else if (kind === 'add_group') {
      var gid = op.group ? cleanId(op.group) : (op.id ? cleanId(op.id) : 'g' + (doc.groups.length + 1))
      var have = false
      for (var p = 0; p < doc.groups.length; p++) if (doc.groups[p].id === gid) { have = true; break }
      if (have) { problems.push(tag + ': 分组 ' + gid + ' 已存在'); continue }
      doc.groups.push({ id: gid, label: typeof op.label === 'string' && op.label ? normalizeBreaks(op.label) : gid })
      done.push('新增分组 ' + gid)
    } else if (kind === 'remove_group') {
      var rgid = opRef(op.id || op.group, 'group', tag, problems)
      if (rgid === null) continue
      var gidx = -1
      for (var u = 0; u < doc.groups.length; u++) if (doc.groups[u].id === rgid) { gidx = u; break }
      if (gidx < 0) { problems.push(tag + ': 找不到分组 ' + String(op.id || op.group)); continue }
      doc.groups.splice(gidx, 1)
      for (var v = 0; v < doc.nodes.length; v++) if (doc.nodes[v].group === rgid) doc.nodes[v].group = null
      done.push('删除分组 ' + rgid)
    } else if (kind === 'set_direction') {
      var dv = String(op.value || op.direction || '').toUpperCase()
      if (['TD', 'TB', 'BT', 'LR', 'RL'].indexOf(dv) < 0) { problems.push(tag + ': 未知方向 ' + dv); continue }
      doc.direction = dv === 'TB' ? 'TD' : dv
      done.push('方向 -> ' + doc.direction)
    } else if (kind === 'set_summary') {
      var sumNext = cleanSummary(typeof op.label === 'string' ? op.label : '')
      doc.summary = sumNext
      done.push(sumNext ? '这张图的一句话总结已更新' : '清掉了这张图的一句话总结')
    } else if (kind === 'set_files') {
      var ffid = opRef(op.id, 'id', tag, problems)
      if (ffid === null) continue
      var ffn = findNode(ffid)
      if (!ffn) { problems.push(tag + ': 找不到节点 ' + String(op.id)); continue }
      if (!Array.isArray(op.files)) { problems.push(tag + ': files 必须是数组（清空传空数组）'); continue }
      var nextFiles = []
      var rawFs = op.files
      for (var fk = 0; fk < rawFs.length && nextFiles.length < 20; fk++) {
        if (typeof rawFs[fk] !== 'string') continue
        var fsv = normalizeBreaks(rawFs[fk]).trim()
        if (!fsv || fsv.length > 300) continue
        if (nextFiles.indexOf(fsv) < 0) nextFiles.push(fsv)
      }
      ffn.files = nextFiles
      done.push(nextFiles.length
        ? ('给 ' + ffn.id + ' 标了 ' + nextFiles.length + ' 个代码锚点')
        : ('清掉 ' + ffn.id + ' 的代码锚点'))
    } else {
      problems.push(tag + ': 未知操作类型')
    }
  }
  return { problems: problems, done: done }
}
