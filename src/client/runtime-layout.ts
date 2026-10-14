// ==================== 源码页分词 ====================
// 只用来给源码页着色，**不做任何校验**（语义校验归宿主的 mermaid.ts 解析器）。
// 认的是 AC 那个 mermaid 子集：`%%` 注释行分三类、关键字、引号标签、箭头、id。
// 三类注释的颜色不同是有意的：`%%!` 是格式说明（最淡，可以无视）、
// `@pos/@link/@summary` 是元数据、`@note/@done/@file` 是**用户写在这个元素上的东西**。
var _HL_ARROWS = null
function hlArrows() {
  if (!_HL_ARROWS && typeof ARROW_CHOICES !== 'undefined') {
    _HL_ARROWS = ARROW_CHOICES.slice().sort(function (a, b) { return b.length - a.length })
  }
  return _HL_ARROWS || []
}
var HL_KEYWORDS = {
  flowchart: 1, graph: 1, subgraph: 1, end: 1, direction: 1,
  classDef: 1, class: 1, style: 1, linkStyle: 1, click: 1, link: 1,
}

function tokenizeMermaidLine(line) {
  var out = []
  var t = String(line == null ? '' : line)
  var trimmed = t.replace(/^\s+/, '')
  if (trimmed.slice(0, 2) === '%%') {
    var lead = t.slice(0, t.length - trimmed.length)
    var kind = 'c'
    if (trimmed.slice(0, 3) !== '%%!') {
      if (/^%%\s*@(pos|link|summary)\b/.test(trimmed)) kind = 'm'
      else if (/^%%\s*@(note|done|file)\b/.test(trimmed)) kind = 'u'
    }
    if (lead) out.push({ k: '', s: lead })
    out.push({ k: kind, s: trimmed })
    return out
  }
  var i = 0
  var buf = ''
  // 先切掉行首缩进（真实文件里节点行是缩进的，注入给 AI 的视图也带空白），再认行首关键字。
  // 关键字必须在这里单独认：进了下面的字符循环，`flowchart` 会被当普通 id 一路累积进 buf，
  // 等遇见空白时 buf 已非空，就再也认不出它是关键字了 ——
  // 这个 bug（顶格版与缩进版）是被 test/ui.render.mjs 的 [4g] 断言连着抓出来两次的。
  var lead = /^\s*/.exec(t)[0]
  if (lead) { out.push({ k: '', s: lead }); i = lead.length }
  var km = /^([A-Za-z][A-Za-z0-9_]*)/.exec(t.slice(i))
  if (km && HL_KEYWORDS[km[1]]) {
    out.push({ k: 'k', s: km[1] })
    i += km[1].length
  }
  function flush() { if (buf) { out.push({ k: 'i', s: buf }); buf = '' } }
  while (i < t.length) {
    var ch = t.charAt(i)
    if (ch === '"') {
      flush()
      var j = i + 1
      while (j < t.length && t.charAt(j) !== '"') j++
      out.push({ k: 's', s: t.slice(i, Math.min(j + 1, t.length)) })
      i = j + 1
      continue
    }
    var arrow = null
    var arrows = hlArrows()
    for (var a = 0; a < arrows.length; a++) {
      if (t.slice(i, i + arrows[a].length) === arrows[a]) { arrow = arrows[a]; break }
    }
    if (arrow) { flush(); out.push({ k: 'a', s: arrow }); i += arrow.length; continue }
    if ('[](){}|&;,>'.indexOf(ch) >= 0) { flush(); out.push({ k: 'p', s: ch }); i++; continue }
    buf += ch
    i++
  }
  flush()
  return out
}

// 编译过渡声明：W1 会话正在彻底去组，在此期间让独立 tsc 顺利过关
declare var groupHueIndex: any, hueClassOf: any

function needsLayout(model) {
  if (!model || !model.nodes || model.nodes.length === 0) return false
  for (var i = 0; i < model.nodes.length; i++) {
    var n = model.nodes[i]
    if (typeof n.x !== 'number' || typeof n.y !== 'number') return true
  }
  return false
}

// ==================== 锚定正交自动布局 ====================
//
// 1. **分层前必须先折环**：Kosaraju 迭代版将强连通分量折点，缩点 DAG 上拓扑序一趟收敛，
//    避免环被当成 DAG 松弛而撑出空层。
// 2. **选锚定节点并冻结在 (0, 0)**：入度 0 且出度最大的主分量枢纽作为锚点，
//    分层以无向 BFS 圈层为下界、单向 DAG 拓扑松弛修方向；最终整体平移使锚点严格落在 (0, 0)。
// 3. **同层排序与正交优化机制**：
//    a. 基线守卫：最终 cost 永远不比「只分层不排序」的基线差；
//    b. 虚拟节点 + 重心法扫描（>= 8 轮），结合 tag 相似度与 id 确定性定序；
//    c. 2-opt 邻位交换局部搜索，边数受控时贪心优化综合 cost；
//    d. 正交吸附：尝试将 cross 坐标精确吸附到唯一/主导邻居，无行内重叠且不增 cost 时采纳。

var W_CROSS = 10000              // 交叉数权重（主导项）
var W_BEND = 1                   // 弯折量权重（正交引导项）
var LAYOUT_ORDER_ROUNDS = 8      // 重心法上下来回扫描轮数
var LAYOUT_ORDER_MAX_EDGES = 600 // 超过此边数跳过 O(E²) 局部搜索

/** Kosaraju 求强连通分量。迭代版避免长链递归爆栈。 */
function sccOf(ids, edges) {
  var adj = {}, radj = {}
  for (var i = 0; i < ids.length; i++) { adj[ids[i]] = []; radj[ids[i]] = [] }
  for (var e = 0; e < edges.length; e++) {
    adj[edges[e][0]].push(edges[e][1])
    radj[edges[e][1]].push(edges[e][0])
  }
  var order = [], seen = {}
  for (var s = 0; s < ids.length; s++) {
    if (seen[ids[s]]) continue
    seen[ids[s]] = true
    var stack = [[ids[s], 0]]
    while (stack.length) {
      var top = stack[stack.length - 1]
      var nb = adj[top[0]]
      if (top[1] < nb.length) {
        var w = nb[top[1]++]
        if (!seen[w]) { seen[w] = true; stack.push([w, 0]) }
      } else { order.push(top[0]); stack.pop() }
    }
  }
  var comp = {}, count = 0
  for (var k = order.length - 1; k >= 0; k--) {
    var root = order[k]
    if (comp[root] !== undefined) continue
    comp[root] = count
    var st2 = [root]
    while (st2.length) {
      var v = st2.pop()
      var back = radj[v]
      for (var j = 0; j < back.length; j++) {
        if (comp[back[j]] === undefined) { comp[back[j]] = count; st2.push(back[j]) }
      }
    }
    count++
  }
  var comps = []
  for (var c = 0; c < count; c++) comps.push([])
  for (var m = 0; m < ids.length; m++) comps[comp[ids[m]]].push(ids[m])
  return { comp: comp, comps: comps }
}

/** 缩点图上的最长路径分层（保留供向后兼容与外部测试）。 */
function layerOfComps(comps, edges, comp) {
  var n = comps.length
  var cl = []
  for (var i = 0; i < n; i++) cl.push(0)
  var ce = [], seen = {}
  for (var e = 0; e < edges.length; e++) {
    var a = comp[edges[e][0]], b = comp[edges[e][1]]
    if (a === b) continue
    var key = a + '>' + b
    if (seen[key]) continue
    seen[key] = true
    ce.push([a, b])
  }
  for (var pass = 0; pass <= n; pass++) {
    var changed = false
    for (var m = 0; m < ce.length; m++) {
      var cand = cl[ce[m][0]] + 1
      if (cand > cl[ce[m][1]]) { cl[ce[m][1]] = cand; changed = true }
    }
    if (!changed) break
  }
  return cl
}

function groupByLayer(ids, layer) {
  var layers = {}
  for (var i = 0; i < ids.length; i++) {
    var L = layer[ids[i]] || 0
    if (!layers[L]) layers[L] = []
    layers[L].push(ids[i])
  }
  return layers
}

function sortedLayerKeys(layers) {
  var keys = []
  for (var k in layers) keys.push(Number(k))
  keys.sort(function (a, b) { return a - b })
  return keys
}

/**
 * 合并模型中的同向平行边：
 * 当两点之间存在多条同起点、同终点的连线时，将其标签用 " / " 合并，
 * 保留第一条边的线型与属性并删除冗余平行线，降低画布缠绕度。
 */
function consolidateEdgesModel(model) {
  if (!model || !Array.isArray(model.edges) || model.edges.length <= 1) return model
  var edgeMap = {}
  var newEdges = []
  var changed = false
  for (var i = 0; i < model.edges.length; i++) {
    var e = model.edges[i]
    var key = e.from + '->' + e.to
    if (!edgeMap[key]) {
      edgeMap[key] = {
        id: e.id,
        from: e.from,
        to: e.to,
        labels: e.label ? [e.label] : [],
        arrow: e.arrow || '-->'
      }
      newEdges.push(edgeMap[key])
    } else {
      changed = true
      if (e.label && edgeMap[key].labels.indexOf(e.label) < 0) {
        edgeMap[key].labels.push(e.label)
      }
    }
  }
  if (!changed) return model
  var finalEdges = newEdges.map(function (item) {
    return {
      id: item.id,
      from: item.from,
      to: item.to,
      arrow: item.arrow,
      label: item.labels.length > 0 ? item.labels.join(' / ') : ''
    }
  })
  return Object.assign({}, model, { edges: finalEdges })
}

/** 按层摆放初始坐标。行内按 cross 依次排开，间距 = 各自尺寸 + GAP。 */
function layoutPositions(sizes, layers, horiz, rev, GAP, edges?: any) {
  var keys = sortedLayerKeys(layers)
  var pos = {}
  var along = 0
  for (var i = 0; i < keys.length; i++) {
    var bucket = layers[keys[i]] || []
    var deep = 0
    for (var d = 0; d < bucket.length; d++) {
      var sz = sizes[bucket[d]] || { w: 100, h: 45 }
      deep = Math.max(deep, horiz ? sz.w : sz.h)
    }
    var span = GAP * Math.max(0, bucket.length - 1)
    for (var s = 0; s < bucket.length; s++) {
      var sz = sizes[bucket[s]] || { w: 100, h: 45 }
      span += horiz ? sz.h : sz.w
    }
    var acc = -span / 2
    var axis = rev ? -along : along
    for (var n = 0; n < bucket.length; n++) {
      var sz = sizes[bucket[n]] || { w: 100, h: 45 }
      var cross = acc + (horiz ? sz.h : sz.w) / 2
      acc += (horiz ? sz.h : sz.w) + GAP
      pos[bucket[n]] = horiz ? { x: axis, y: cross } : { x: cross, y: axis }
    }
    along += deep + (horiz ? Math.max(48, Math.round(deep * 0.6)) : Math.max(36, Math.round(deep * 0.8)))
  }
  return pos
}

/** 两条边（按节点中心连直线）真交叉的条数。 */
function crossingsOf(pos, edges) {
  var n = 0
  for (var i = 0; i < edges.length; i++) {
    var a1 = edges[i][0], b1 = edges[i][1]
    var p1 = pos[a1], p2 = pos[b1]
    if (!p1 || !p2) continue
    for (var j = i + 1; j < edges.length; j++) {
      var a2 = edges[j][0], b2 = edges[j][1]
      if (a1 === a2 || a1 === b2 || b1 === a2 || b1 === b2) continue
      var p3 = pos[a2], p4 = pos[b2]
      if (!p3 || !p4) continue
      var den = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x)
      if (den === 0) continue
      var t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / den
      var u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / den
      if (t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9) n++
    }
  }
  return n
}

/** 总弯折量 Σ_edges |cross(u) - cross(v)|。0 为完全正交直连线。 */
function totalBend(pos, edges, horiz) {
  var sum = 0
  for (var i = 0; i < edges.length; i++) {
    var p1 = pos[edges[i][0]], p2 = pos[edges[i][1]]
    if (!p1 || !p2) continue
    var d = horiz ? Math.abs(p1.y - p2.y) : Math.abs(p1.x - p2.x)
    sum += d
  }
  return sum
}

/** 布局综合成本：以交叉数为主导项，以总弯折量为正交优化项。 */
function layoutCost(pos, edges, horiz) {
  return W_CROSS * crossingsOf(pos, edges) + W_BEND * totalBend(pos, edges, horiz)
}

/**
 * 正交吸附微调：
 * 每个节点尝试将 cross 坐标对齐到「唯一 / 主导邻居」，
 * 仅在不发生行内重叠且综合 cost 不增加时采纳。
 */
function snapOrthogonal(pos, layers, sizes, pairs, horiz, GAP) {
  var kList = sortedLayerKeys(layers)
  var realPred = {}, realSucc = {}
  for (var ki = 0; ki < kList.length; ki++) {
    var row = layers[kList[ki]]
    for (var i = 0; i < row.length; i++) {
      realPred[row[i]] = []
      realSucc[row[i]] = []
    }
  }
  for (var e = 0; e < pairs.length; e++) {
    var u = pairs[e][0], v = pairs[e][1]
    if (realSucc[u] && realPred[v]) {
      realSucc[u].push(v)
      realPred[v].push(u)
    }
  }

  var currentPos = Object.assign({}, pos)
  var currentCost = layoutCost(currentPos, pairs, horiz)
  var minGap = 16

  var passes = [kList, kList.slice().reverse()]
  for (var p = 0; p < passes.length; p++) {
    var seq = passes[p]
    for (var si = 0; si < seq.length; si++) {
      var row = layers[seq[si]]
      for (var idx = 0; idx < row.length; idx++) {
        var nid = row[idx]
        var targets = []
        if (realPred[nid].length === 1) {
          var pId = realPred[nid][0]
          if (currentPos[pId]) targets.push(horiz ? currentPos[pId].y : currentPos[pId].x)
        }
        if (realSucc[nid].length === 1) {
          var sId = realSucc[nid][0]
          if (currentPos[sId]) targets.push(horiz ? currentPos[sId].y : currentPos[sId].x)
        }
        if (realPred[nid].length > 1) {
          var sum = 0, cnt = 0
          for (var pi = 0; pi < realPred[nid].length; pi++) {
            var pp = currentPos[realPred[nid][pi]]
            if (pp) { sum += horiz ? pp.y : pp.x; cnt++ }
          }
          if (cnt > 0) targets.push(sum / cnt)
        }

        var nidSz = sizes[nid] || { w: 100, h: 45 }
        var nidSpan = horiz ? nidSz.h : nidSz.w
        var halfNid = nidSpan / 2

        for (var ti = 0; ti < targets.length; ti++) {
          var targetCross = targets[ti]
          var canSnap = true
          if (idx > 0) {
            var leftId = row[idx - 1]
            var leftSz = sizes[leftId] || { w: 100, h: 45 }
            var leftSpan = horiz ? leftSz.h : leftSz.w
            var leftCross = horiz ? currentPos[leftId].y : currentPos[leftId].x
            if (targetCross - halfNid < leftCross + leftSpan / 2 + minGap) canSnap = false
          }
          if (canSnap && idx < row.length - 1) {
            var rightId = row[idx + 1]
            var rightSz = sizes[rightId] || { w: 100, h: 45 }
            var rightSpan = horiz ? rightSz.h : rightSz.w
            var rightCross = horiz ? currentPos[rightId].y : currentPos[rightId].x
            if (targetCross + halfNid > rightCross - rightSpan / 2 - minGap) canSnap = false
          }
          if (!canSnap) continue

          var oldPt = currentPos[nid]
          var testPt = horiz ? { x: oldPt.x, y: targetCross } : { x: targetCross, y: oldPt.y }
          currentPos[nid] = testPt
          var testCost = layoutCost(currentPos, pairs, horiz)

          if (testCost <= currentCost) {
            currentCost = testCost
            break
          } else {
            currentPos[nid] = oldPt
          }
        }
      }
    }
  }
  return currentPos
}

/** 挑选单一分量内的锚点。 */
function pickCompAnchor(comp, pairs) {
  var inDeg = {}, outDeg = {}
  for (var i = 0; i < comp.length; i++) { inDeg[comp[i]] = 0; outDeg[comp[i]] = 0 }
  for (var e = 0; e < pairs.length; e++) {
    var u = pairs[e][0], v = pairs[e][1]
    if (inDeg[u] !== undefined && inDeg[v] !== undefined) {
      outDeg[u]++
      inDeg[v]++
    }
  }
  var zeroIn = []
  for (var i = 0; i < comp.length; i++) {
    var id = comp[i]
    if (inDeg[id] === 0 && outDeg[id] > 0) zeroIn.push(id)
  }
  if (zeroIn.length > 0) {
    zeroIn.sort(function (a, b) {
      var degA = outDeg[a], degB = outDeg[b]
      if (degB !== degA) return degB - degA
      return a < b ? -1 : a > b ? 1 : 0
    })
    return zeroIn[0]
  }
  var maxDeg = -1
  var maxDegNodes = []
  for (var i = 0; i < comp.length; i++) {
    var id = comp[i]
    var tot = inDeg[id] + outDeg[id]
    if (tot > maxDeg) {
      maxDeg = tot
      maxDegNodes = [id]
    } else if (tot === maxDeg) {
      maxDegNodes.push(id)
    }
  }
  if (maxDeg > 0) {
    maxDegNodes.sort()
    return maxDegNodes[0]
  }
  return comp[0]
}

/**
 * 选锚点 pickAnchor(nodes, edges, want) -> 节点 id 字符串（纯函数）
 * 1. want 存在于节点表就返回它；
 * 2. 否则挑选主分量（先比可达数、再比最小 id）中入度 0 且出度 > 0 的节点（度数优先，id 字典序兜底）；
 * 3. 全环图退化为度数最大节点；完全无边退化为首个节点 id。
 */
function pickAnchor(nodes, edges, want) {
  var nodeArr = nodes || []
  var nodeIds = []
  var nodeMap = {}
  for (var i = 0; i < nodeArr.length; i++) {
    var item = nodeArr[i]
    var id = (item && typeof item === 'object') ? item.id : String(item)
    if (typeof id === 'string' && id !== '') {
      nodeIds.push(id)
      nodeMap[id] = true
    }
  }
  if (nodeIds.length === 0) return (typeof want === 'string' ? want : '')
  if (want && nodeMap[want]) return want

  var edgeList = edges || []
  var pairs = []
  for (var e = 0; e < edgeList.length; e++) {
    var ed = edgeList[e]
    var u = ed ? (ed.from !== undefined ? ed.from : ed[0]) : null
    var v = ed ? (ed.to !== undefined ? ed.to : ed[1]) : null
    if (nodeMap[u] && nodeMap[v] && u !== v) {
      pairs.push([u, v])
    }
  }

  if (pairs.length === 0) return nodeIds[0]

  var uAdj = {}
  for (var i = 0; i < nodeIds.length; i++) uAdj[nodeIds[i]] = []
  for (var e = 0; e < pairs.length; e++) {
    uAdj[pairs[e][0]].push(pairs[e][1])
    uAdj[pairs[e][1]].push(pairs[e][0])
  }

  var seen = {}
  var components = []
  for (var i = 0; i < nodeIds.length; i++) {
    var nid = nodeIds[i]
    if (seen[nid]) continue
    var comp = []
    var queue = [nid]
    seen[nid] = true
    var qHead = 0
    while (qHead < queue.length) {
      var curr = queue[qHead++]
      comp.push(curr)
      var nbs = uAdj[curr]
      for (var j = 0; j < nbs.length; j++) {
        var nb = nbs[j]
        if (!seen[nb]) {
          seen[nb] = true
          queue.push(nb)
        }
      }
    }
    components.push(comp)
  }

  components.sort(function (a, b) {
    if (b.length !== a.length) return b.length - a.length
    var minA = a[0], minB = b[0]
    for (var i = 1; i < a.length; i++) if (a[i] < minA) minA = a[i]
    for (var j = 1; j < b.length; j++) if (b[j] < minB) minB = b[j]
    return minA < minB ? -1 : minA > minB ? 1 : 0
  })

  var mainComp = components[0]
  return pickCompAnchor(mainComp, pairs)
}

/** 把一份 model 排成坐标。纯函数：不改入参，整份复制节点只改 x/y，锚点精确落在 (0, 0)。 */
function autoLayout(model, options?: any) {
  var nodes = (model && model.nodes) || []
  if (nodes.length === 0) return model
  var byId = {}
  var sizes = {}
  var ids = []
  var nodeTags = {}
  for (var i = 0; i < nodes.length; i++) {
    var nid = nodes[i].id
    byId[nid] = nodes[i]
    ids.push(nid)
    nodeTags[nid] = Array.isArray(nodes[i].tags) ? nodes[i].tags : []
    var split = splitLabel(nodes[i].label)
    sizes[nid] = nodeSize(split ? split.title : nodes[i].label, 0)
  }
  var pairs = []
  for (var e = 0; e < ((model && model.edges) || []).length; e++) {
    var ed = model.edges[e]
    if (byId[ed.from] && byId[ed.to] && ed.from !== ed.to) pairs.push([ed.from, ed.to])
  }
  var dir = (model && model.direction) || 'TD'
  var horiz = dir === 'LR' || dir === 'RL'
  var rev = dir === 'BT' || dir === 'RL'
  var GAP = horiz ? 74 : 56
  var COMP_GAP = GAP + 40
  var baselineOnly = Boolean(options && (options.baseline || options.baselineOnly))

  // 1) 选锚点
  var want = options && (options.anchor || options.want)
  var globalAnchor = pickAnchor(nodes, pairs, want)

  // 2) 划分断开分量，各自独立分层与排序
  var uAdj = {}
  for (var i = 0; i < ids.length; i++) uAdj[ids[i]] = []
  for (var e = 0; e < pairs.length; e++) {
    uAdj[pairs[e][0]].push(pairs[e][1])
    uAdj[pairs[e][1]].push(pairs[e][0])
  }
  var seen = {}
  var rawComponents = []
  for (var i = 0; i < ids.length; i++) {
    var nid = ids[i]
    if (seen[nid]) continue
    var comp = []
    var q = [nid]
    seen[nid] = true
    var qHead = 0
    while (qHead < q.length) {
      var curr = q[qHead++]
      comp.push(curr)
      var nbs = uAdj[curr]
      for (var j = 0; j < nbs.length; j++) {
        if (!seen[nbs[j]]) {
          seen[nbs[j]] = true
          q.push(nbs[j])
        }
      }
    }
    rawComponents.push(comp)
  }

  var mainCompIdx = 0
  for (var ci = 0; ci < rawComponents.length; ci++) {
    if (rawComponents[ci].indexOf(globalAnchor) >= 0) {
      mainCompIdx = ci
      break
    }
  }
  var mainComp = rawComponents[mainCompIdx]
  var otherComps = []
  for (var ci = 0; ci < rawComponents.length; ci++) {
    if (ci !== mainCompIdx) otherComps.push(rawComponents[ci])
  }
  otherComps.sort(function (a, b) {
    if (b.length !== a.length) return b.length - a.length
    var minA = a[0], minB = b[0]
    for (var i = 1; i < a.length; i++) if (a[i] < minA) minA = a[i]
    for (var j = 1; j < b.length; j++) if (b[j] < minB) minB = b[j]
    return minA < minB ? -1 : minA > minB ? 1 : 0
  })
  var sortedComponents = [mainComp].concat(otherComps)

  var pos = {}
  var prevMaxCross = 0

  for (var ci = 0; ci < sortedComponents.length; ci++) {
    var compIds = sortedComponents[ci]
    var compAnchor = (ci === 0 ? globalAnchor : pickCompAnchor(compIds, pairs))
    var compIdMap = {}
    for (var i = 0; i < compIds.length; i++) compIdMap[compIds[i]] = true
    var compPairs = []
    for (var e = 0; e < pairs.length; e++) {
      if (compIdMap[pairs[e][0]] && compIdMap[pairs[e][1]]) compPairs.push(pairs[e])
    }

    // 分层：折环 -> 缩点 DAG 无向 BFS 圈层下界 -> 拓扑序修方向
    var part = sccOf(compIds, compPairs)
    var nComps = part.comps.length
    var anchorComp = part.comp[compAnchor]

    var sccAdj = [], sccRadj = [], sccUndir = []
    for (var c = 0; c < nComps; c++) { sccAdj.push([]); sccRadj.push([]); sccUndir.push([]) }
    var sccSeen = {}
    for (var e = 0; e < compPairs.length; e++) {
      var cu = part.comp[compPairs[e][0]], cv = part.comp[compPairs[e][1]]
      if (cu === cv) continue
      var key = cu + '>' + cv
      if (sccSeen[key]) continue
      sccSeen[key] = true
      sccAdj[cu].push(cv)
      sccRadj[cv].push(cu)
      sccUndir[cu].push(cv)
      sccUndir[cv].push(cu)
    }

    var d = new Array(nComps)
    for (var c = 0; c < nComps; c++) d[c] = -1
    d[anchorComp] = 0
    var bq = [anchorComp], bHead = 0
    while (bHead < bq.length) {
      var curr = bq[bHead++]
      var nbs = sccUndir[curr]
      for (var j = 0; j < nbs.length; j++) {
        if (d[nbs[j]] === -1) {
          d[nbs[j]] = d[curr] + 1
          bq.push(nbs[j])
        }
      }
    }
    for (var c = 0; c < nComps; c++) if (d[c] === -1) d[c] = 0
    var cl = d.slice()
    cl[anchorComp] = 0

    var inDegs = new Array(nComps)
    var tq = []
    for (var c = 0; c < nComps; c++) {
      inDegs[c] = sccRadj[c].length
      if (inDegs[c] === 0) tq.push(c)
    }
    var topo = []
    while (tq.length) {
      var u = tq.shift()
      topo.push(u)
      for (var j = 0; j < sccAdj[u].length; j++) {
        var v = sccAdj[u][j]
        inDegs[v]--
        if (inDegs[v] === 0) tq.push(v)
      }
    }
    for (var ti = 0; ti < topo.length; ti++) {
      var u = topo[ti]
      for (var j = 0; j < sccAdj[u].length; j++) {
        var v = sccAdj[u][j]
        if (v === anchorComp) continue // 指向锚点的边按回边处理，不许把锚点推下去
        if (cl[u] + 1 > cl[v]) cl[v] = cl[u] + 1
      }
    }
    cl[anchorComp] = 0

    var compLayer = {}
    for (var t = 0; t < compIds.length; t++) compLayer[compIds[t]] = cl[part.comp[compIds[t]]]

    var baseLayers = groupByLayer(compIds, compLayer)
    var basePos = layoutPositions(sizes, baseLayers, horiz, rev, GAP)
    var bestLayers = baseLayers
    var bestPos = basePos

    if (!baselineOnly) {
      // 跨层长边插装虚拟节点
      var allCompIds = compIds.slice()
      var allCompLayer = Object.assign({}, compLayer)
      var dummyEdges = []
      var isDummy = {}
      for (var p = 0; p < compPairs.length; p++) {
        var u = compPairs[p][0], v = compPairs[p][1]
        var lu = compLayer[u], lv = compLayer[v]
        if (lv - lu > 1) {
          var prev = u
          for (var k = lu + 1; k < lv; k++) {
            var dummyId = '__d_' + u + '_' + v + '_' + k
            allCompIds.push(dummyId)
            allCompLayer[dummyId] = k
            isDummy[dummyId] = true
            dummyEdges.push([prev, dummyId])
            prev = dummyId
          }
          dummyEdges.push([prev, v])
        } else {
          dummyEdges.push([u, v])
        }
      }

      var dLayers = groupByLayer(allCompIds, allCompLayer)
      var dKeys = sortedLayerKeys(dLayers)
      var dPos = {}
      for (var ki = 0; ki < dKeys.length; ki++) {
        var row0 = dLayers[dKeys[ki]]
        for (var j = 0; j < row0.length; j++) dPos[row0[j]] = j
      }
      var pred = {}, succ = {}
      for (var m = 0; m < allCompIds.length; m++) { pred[allCompIds[m]] = []; succ[allCompIds[m]] = [] }
      for (var de = 0; de < dummyEdges.length; de++) {
        succ[dummyEdges[de][0]].push(dummyEdges[de][1])
        pred[dummyEdges[de][1]].push(dummyEdges[de][0])
      }

      // 重心法上下来回扫描
      for (var r = 0; r < LAYOUT_ORDER_ROUNDS; r++) {
        var down = r % 2 === 0
        var seq = down ? dKeys : dKeys.slice().reverse()
        for (var s = 0; s < seq.length; s++) {
          var row = dLayers[seq[s]]
          var baryKey = {}
          for (var n = 0; n < row.length; n++) {
            var nb = down ? pred[row[n]] : succ[row[n]]
            var sum = 0, cnt = 0
            for (var b = 0; b < nb.length; b++) {
              var pp = dPos[nb[b]]
              if (pp !== undefined) { sum += pp; cnt++ }
            }
            baryKey[row[n]] = cnt ? sum / cnt : (dPos[row[n]] !== undefined ? dPos[row[n]] : 0)
          }
          row.sort(function (a, b) {
            var diff = baryKey[a] - baryKey[b]
            if (Math.abs(diff) > 0.4) return diff
            if (nodeTags) {
              var ta = nodeTags[a] || [], tb = nodeTags[b] || []
              var mainA = ta[0] || '', mainB = tb[0] || ''
              if (mainA !== mainB) return mainA < mainB ? -1 : 1
            }
            return a < b ? -1 : a > b ? 1 : 0
          })
          for (var f = 0; f < row.length; f++) dPos[row[f]] = f
        }
      }

      var candLayers = {}
      for (var ki = 0; ki < dKeys.length; ki++) {
        candLayers[dKeys[ki]] = dLayers[dKeys[ki]].filter(function (x) { return !isDummy[x] })
      }

      // 基线守卫：比较候选排序与基线排序综合 cost
      var baseCost = layoutCost(basePos, compPairs, horiz)
      var candPos = layoutPositions(sizes, candLayers, horiz, rev, GAP)
      var candCost = layoutCost(candPos, compPairs, horiz)
      var bestCost = baseCost

      if (candCost < baseCost) {
        bestLayers = candLayers
        bestPos = candPos
        bestCost = candCost
      }

      // 2-opt 邻位交换局部搜索
      if (compPairs.length > 1 && compPairs.length <= LAYOUT_ORDER_MAX_EDGES) {
        var kList = sortedLayerKeys(bestLayers)
        var improved = true, pass = 0
        while (improved && pass < 3) {
          improved = false
          pass++
          for (var ki = 0; ki < kList.length; ki++) {
            var row = bestLayers[kList[ki]]
            if (row.length < 2) continue
            for (var i = 0; i < row.length - 1; i++) {
              var a = row[i], b = row[i + 1]
              row[i] = b
              row[i + 1] = a
              var testPos = layoutPositions(sizes, bestLayers, horiz, rev, GAP)
              var testCost = layoutCost(testPos, compPairs, horiz)
              if (testCost < bestCost) {
                bestCost = testCost
                bestPos = testPos
                improved = true
              } else {
                row[i] = a
                row[i + 1] = b
              }
            }
          }
        }
      }

      // 正交吸附微调
      bestPos = snapOrthogonal(bestPos, bestLayers, sizes, compPairs, horiz, GAP)
    }

    // 平移使锚点落在 (0, 0)
    var ax = bestPos[compAnchor].x, ay = bestPos[compAnchor].y
    var minCross = Infinity, maxCross = -Infinity
    for (var i = 0; i < compIds.length; i++) {
      var nid = compIds[i]
      bestPos[nid] = { x: bestPos[nid].x - ax, y: bestPos[nid].y - ay }
      var sz = sizes[nid] || { w: 100, h: 45 }
      var crossVal = horiz ? bestPos[nid].y : bestPos[nid].x
      var halfSpan = (horiz ? sz.h : sz.w) / 2
      if (crossVal - halfSpan < minCross) minCross = crossVal - halfSpan
      if (crossVal + halfSpan > maxCross) maxCross = crossVal + halfSpan
    }

    // 断开分量按交叉轴并排排布，块与块不重叠
    if (ci > 0) {
      var shiftCross = (prevMaxCross + COMP_GAP) - minCross
      for (var i = 0; i < compIds.length; i++) {
        var nid = compIds[i]
        if (horiz) bestPos[nid].y += shiftCross
        else bestPos[nid].x += shiftCross
      }
      prevMaxCross = maxCross + shiftCross
    } else {
      prevMaxCross = maxCross
    }

    for (var i = 0; i < compIds.length; i++) {
      var nid = compIds[i]
      pos[nid] = bestPos[nid]
    }
  }

  // 整份复制节点，仅更新 x/y
  var out = []
  for (var qi = 0; qi < nodes.length; qi++) {
    out.push(Object.assign({}, nodes[qi]))
  }
  var pinned = options && options.pinned
  var isPinned = function (nid) {
    if (!pinned) return false
    if (Array.isArray(pinned)) return pinned.indexOf(nid) >= 0
    if (typeof pinned === 'object') return Boolean(pinned[nid])
    return false
  }

  for (var f = 0; f < out.length; f++) {
    var nid = out[f].id
    var pt = pos[nid]
    if (pt) {
      if (isPinned(nid) && typeof nodes[f].x === 'number' && typeof nodes[f].y === 'number') {
        out[f].x = nodes[f].x
        out[f].y = nodes[f].y
      } else {
        out[f].x = Math.round(pt.x)
        out[f].y = Math.round(pt.y)
      }
    }
  }
  return { nodes: out, edges: model.edges, direction: dir, extras: model.extras }
}
