// ==================== 源码页分词 ====================
// 只用来给源码页着色，**不做任何校验**（语义校验归宿主的 mermaid.ts 解析器）。
// 认的是 AC 那个 mermaid 子集：`%%` 注释行分三类、关键字、引号标签、箭头、id。
// 三类注释的颜色不同是有意的：`%%!` 是格式说明（最淡，可以无视）、
// `@pos/@link/@summary` 是元数据、`@note/@done/@file` 是**用户写在这个元素上的东西**。
var HL_ARROWS = ['<==>', '<-->', '-.->', '==>', '-->', '---', '~~~', '===', '->']
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
    for (var a = 0; a < HL_ARROWS.length; a++) {
      if (t.slice(i, i + HL_ARROWS[a].length) === HL_ARROWS[a]) { arrow = HL_ARROWS[a]; break }
    }
    if (arrow) { flush(); out.push({ k: 'a', s: arrow }); i += arrow.length; continue }
    if ('[](){}|&;,>'.indexOf(ch) >= 0) { flush(); out.push({ k: 'p', s: ch }); i++; continue }
    buf += ch
    i++
  }
  flush()
  return out
}

// ==================== 组 → 色相档位 ====================
// 为什么不是「第几个组就用第几档」：删掉中间一个组会让它后面**所有**组换色，而用户记住的
// 是「那个绿框」。所以按组 id 哈希定位。哈希撞档时按 id 字典序往后探 —— 分配只取决于
// 「有哪些组」（顺序无关），现实中最多在插入新组时动一个组。
// 组多于 8 个时色相从头复用（图上一眼看得出「不是同一组」，但两组同色 —— 有意的取舍）。
var GROUP_HUE_COUNT = 8
function groupHueIndex(groups) {
  var ids = []
  var seen = {}
  for (var i = 0; i < (groups || []).length; i++) {
    var id = groups[i] && groups[i].id
    if (typeof id !== 'string' || id === '' || seen[id]) continue
    seen[id] = true
    ids.push(id)
  }
  ids.sort()
  var used = {}
  var out = {}
  for (var k = 0; k < ids.length; k++) {
    var h = 5381
    for (var j = 0; j < ids[k].length; j++) h = ((h * 33) ^ ids[k].charCodeAt(j)) >>> 0
    var slot = h % GROUP_HUE_COUNT
    for (var probe = 0; probe < GROUP_HUE_COUNT; probe++) {
      var cand = (slot + probe) % GROUP_HUE_COUNT
      if (!used[cand]) { slot = cand; break }
    }
    used[slot] = true
    out[ids[k]] = slot
  }
  return out
}

// 拿不到档位（没有组、节点不属于任何组）时返回空串 —— 节点于是落在中性的 --ac-line 上。
function hueClassOf(hueOf, id) {
  var h = hueOf && id ? hueOf[id] : undefined
  return typeof h === 'number' ? ' ac-h' + h : ''
}

function needsLayout(model) {
  if (!model || !model.nodes || model.nodes.length === 0) return false
  for (var i = 0; i < model.nodes.length; i++) {
    var n = model.nodes[i]
    if (typeof n.x !== 'number' || typeof n.y !== 'number') return true
  }
  return false
}

// ==================== 自动布局 ====================
// 两条**从真实图里量出来**的规矩，动这一段之前先读（数字见 test/layout.test.cjs 的守门断言）：
//
// 1. **分层前必须先折环。** 从前是「对边做最长路径松弛，靠 `cand < nodes.length` 兜底」——
//    有环时那个上界就是唯一的刹车。实测（2026-09-21，本仓库自己的 dsh-plugin-framework：
//    28 节点 / 35 边，环是 reg→dyn→studio→ui 这四个）：层号变成 0,1,2,3,24,25,26,27，
//    15 个节点被扔到第 24~27 层，中间 20 层是空的 —— 而每层照样吃掉 84px，画布上凭空多出
//    ~1.7k px 的空白，35 条边压出 92 个交叉。折成强连通分量再分层，层分布回到 0..7，
//    交叉降到 68。缩点图是 DAG，最长路径一次收敛，不需要任何人为上界。
// 2. **同层排序不是必胜，所以要比一遍再决定。** 中位数（barycenter）启发式把上面那张大图
//    从 92 压到 31，但在本仓库的 architecture 图（23 节点 / 6 层、本来只有 11 个交叉）上
//    会把交叉顶到 13。所以这里算完**比交叉数，不更少就不换** —— 「新布局永远不比旧布局差」
//    是有意维持的不变量，不是实现细节。代价是那一次比较为 O(E²)，所以给它一个边数上限。

var LAYOUT_ORDER_ROUNDS = 4      // 中位数扫描轮数（上下来回交替）
var LAYOUT_ORDER_MAX_EDGES = 600 // 超过这个边数就不做「比交叉数」这一步（它是 O(E²)）

/** Kosaraju 求强连通分量。**迭代版**：递归版在几千节点的长链上会爆栈。 */
function sccOf(ids, edges) {
  var adj = {}, radj = {}
  for (var i = 0; i < ids.length; i++) { adj[ids[i]] = []; radj[ids[i]] = [] }
  for (var e = 0; e < edges.length; e++) {
    adj[edges[e][0]].push(edges[e][1])
    radj[edges[e][1]].push(edges[e][0])
  }
  // 第一趟：正图上的完成序
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
  // 第二趟：反图按完成序的逆序走，一次能捞到的就是同一个分量
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
  // 成员按 ids 的原始顺序收集：同层里的先后必须稳定，不能随 DFS 的访问顺序漂
  var comps = []
  for (var c = 0; c < count; c++) comps.push([])
  for (var m = 0; m < ids.length; m++) comps[comp[ids[m]]].push(ids[m])
  return { comp: comp, comps: comps }
}

/** 缩点图上的最长路径分层：环已经折掉，所以不需要任何上界。 */
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
 * 计算两个节点集合的 Tag Jaccard 相似度 [0, 1]
 * 概念 Tag 越相似，节点间的语义亲和度越高，在空间中优先聚拢相邻排布
 */
function tagSimilarity(tagsA, tagsB) {
  if (!tagsA || !tagsB || tagsA.length === 0 || tagsB.length === 0) return 0
  var intersection = 0
  var setA = {}
  for (var i = 0; i < tagsA.length; i++) setA[tagsA[i]] = 1
  for (var j = 0; j < tagsB.length; j++) {
    if (setA[tagsB[j]]) intersection++
  }
  var union = tagsA.length + tagsB.length - intersection
  return union > 0 ? intersection / union : 0
}

/** 中位数（barycenter）启发式：结合连线拓扑与 Tag 概念相似度进行对齐与聚域排布。 */
function medianOrder(ids, layer, edges, rounds, nodeTags) {
  var layers = groupByLayer(ids, layer)
  var keys = sortedLayerKeys(layers)
  var pos = {}
  for (var i = 0; i < keys.length; i++) {
    var row0 = layers[keys[i]]
    for (var j = 0; j < row0.length; j++) pos[row0[j]] = j
  }
  var pred = {}, succ = {}
  for (var m = 0; m < ids.length; m++) { pred[ids[m]] = []; succ[ids[m]] = [] }
  for (var e = 0; e < edges.length; e++) { succ[edges[e][0]].push(edges[e][1]); pred[edges[e][1]].push(edges[e][0]) }
  for (var r = 0; r < rounds; r++) {
    var down = r % 2 === 0
    var seq = down ? keys : keys.slice().reverse()
    for (var s = 0; s < seq.length; s++) {
      var row = layers[seq[s]]
      var key = {}
      for (var n = 0; n < row.length; n++) {
        var nb = down ? pred[row[n]] : succ[row[n]]
        var sum = 0, cnt = 0
        for (var b = 0; b < nb.length; b++) {
          var p = pos[nb[b]]
          if (p !== undefined) { sum += p; cnt++ }
        }
        key[row[n]] = cnt ? sum / cnt : pos[row[n]]
      }
      // 综合排序：拓扑重心优先，中位数相近时按 Tag 概念相似度与首个标签聚拢排布
      row.sort(function (a, b) {
        var diff = key[a] - key[b]
        if (Math.abs(diff) > 0.4) return diff
        if (nodeTags) {
          var ta = nodeTags[a] || []
          var tb = nodeTags[b] || []
          var mainA = ta[0] || ''
          var mainB = tb[0] || ''
          if (mainA !== mainB) return mainA < mainB ? -1 : 1
        }
        return a < b ? -1 : a > b ? 1 : 0
      })
      for (var f = 0; f < row.length; f++) pos[row[f]] = f
    }
  }
  return layers
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

/** 按层摆坐标。`rev` 只影响摆出去的值，**不能去改累加器本身** —— 从前的写法是
 *  `along = -along`，于是累加器被来回翻转，BT / RL 下第 0 层和第 2 层会落到同一个 y。 */
/** 按层摆坐标并进行轻量对齐松弛，避免梳状歪斜。 */
function layoutPositions(sizes, layers, horiz, rev, GAP, edges?: any) {
  var keys = sortedLayerKeys(layers)
  var pos = {}
  var along = 0
  for (var i = 0; i < keys.length; i++) {
    var bucket = layers[keys[i]] || []
    var deep = 0
    for (var d = 0; d < bucket.length; d++) deep = Math.max(deep, horiz ? sizes[bucket[d]].w : sizes[bucket[d]].h)
    var span = GAP * Math.max(0, bucket.length - 1)
    for (var s = 0; s < bucket.length; s++) span += horiz ? sizes[bucket[s]].h : sizes[bucket[s]].w
    var acc = -span / 2
    var axis = rev ? -along : along
    for (var n = 0; n < bucket.length; n++) {
      var sz = sizes[bucket[n]]
      var cross = acc + (horiz ? sz.h : sz.w) / 2
      acc += (horiz ? sz.h : sz.w) + GAP
      pos[bucket[n]] = horiz ? { x: axis, y: cross } : { x: cross, y: axis }
    }
    along += deep + 84
  }

  // 针对父子节点进行居中微调（Alignment Bias）：当上一层父节点与子节点存在直接连线时，
  // 若整层只有单个子节点或子节点位置偏斜，在不发生碰撞的前提下向父节点中心轻量吸引
  if (edges && edges.length > 0 && keys.length > 1) {
    var pred = {}
    for (var ei = 0; ei < edges.length; ei++) {
      var u = edges[ei][0], v = edges[ei][1]
      if (!pred[v]) pred[v] = []
      pred[v].push(u)
    }
    for (var ki = 1; ki < keys.length; ki++) {
      var row = layers[keys[ki]] || []
      if (row.length === 1) {
        var nid = row[0]
        var parents = pred[nid]
        if (parents && parents.length > 0) {
          var sumCross = 0, count = 0
          for (var pi = 0; pi < parents.length; pi++) {
            var pp = pos[parents[pi]]
            if (pp) { sumCross += horiz ? pp.y : pp.x; count++ }
          }
          if (count > 0) {
            var targetCross = sumCross / count
            if (horiz) pos[nid].y = targetCross
            else pos[nid].x = targetCross
          }
        }
      }
    }
  }

  return pos
}

/** 两条边（按节点中心连直线）真交叉的条数。共端点的直接跳过 —— 它们必然交在端点。 */
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

/** 把一份 model 排成坐标。纯函数：不改入参，返回新的 nodes 数组。 */
function autoLayout(model) {
  var nodes = model.nodes || []
  if (nodes.length === 0) return model
  var byId = {}
  var sizes = {}
  var ids = []
  var nodeTags = {}
  for (var i = 0; i < nodes.length; i++) {
    byId[nodes[i].id] = nodes[i]
    ids.push(nodes[i].id)
    nodeTags[nodes[i].id] = Array.isArray(nodes[i].tags) ? nodes[i].tags : (nodes[i].group ? [nodes[i].group] : [])
    // 与 studio 渲染层对齐：画布上永远只渲染第一行标题（高度约 45），不渲染多余 files 行
    var split = splitLabel(nodes[i].label)
    sizes[nodes[i].id] = nodeSize(split ? split.title : nodes[i].label, 0)
  }
  var pairs = []
  for (var e = 0; e < (model.edges || []).length; e++) {
    var ed = model.edges[e]
    if (byId[ed.from] && byId[ed.to] && ed.from !== ed.to) pairs.push([ed.from, ed.to])
  }
  var dir = model.direction || 'TD'
  var horiz = dir === 'LR' || dir === 'RL'
  var rev = dir === 'BT' || dir === 'RL'
  var GAP = horiz ? 74 : 56

  // 1) 分层：先把环折成强连通分量，再在缩点图上做最长路径
  var part = sccOf(ids, pairs)
  var cl = layerOfComps(part.comps, pairs, part.comp)
  var layer = {}
  for (var t = 0; t < ids.length; t++) layer[ids[t]] = cl[part.comp[ids[t]]]

  // 2) 同层顺序：中位数启发式 + 概念 Tag 亲和聚类，保持拓扑主干清晰流动
  var layers = groupByLayer(ids, layer)
  var pos = layoutPositions(sizes, layers, horiz, rev, GAP)
  // 基线交叉数**只算一次**：下面两处安全闸各比它一次，而 `crossingsOf` 是 O(E²) 的双重循环
  // （N=400 时单次约 3ms，占总布局的大头）。两处比的是同一组 pos/pairs，重算没有意义；
  // 中途 pos 被换成 altPos 时把基线一起换掉 —— 判据与从前逐字等价。
  var baseCrossings = crossingsOf(pos, pairs)
  if (pairs.length > 1 && pairs.length <= LAYOUT_ORDER_MAX_EDGES) {
    var alt = medianOrder(ids, layer, pairs, LAYOUT_ORDER_ROUNDS, nodeTags)
    var altPos = layoutPositions(sizes, alt, horiz, rev, GAP)
    var altCrossings = crossingsOf(altPos, pairs)
    if (altCrossings < baseCrossings) { layers = alt; pos = altPos; baseCrossings = altCrossings }
  }
  // 对齐微调安全闸：仅当对齐不增加交叉数时才采纳，守住「交叉数永远不比基线多」不变量
  var alignedPos = layoutPositions(sizes, layers, horiz, rev, GAP, pairs)
  if (crossingsOf(alignedPos, pairs) <= baseCrossings) {
    pos = alignedPos
  }

  var out = []
  for (var q = 0; q < nodes.length; q++) {
    // **整份复制，只改坐标。** 从前这里是逐字段重建 `{id,label,shape,group,x,y}` ——
    // 于是点一下「自动布局」（或加载一张没带坐标的图触发它），所有节点的 files / note /
    // noteDone / link 全被丢掉，而且紧接着经 doc:set 落盘，**永久损坏**。
    // （2026-09-20 客户端逻辑审计抓到的头号问题；`refRowCount(nodes[i].files)` 上面还在用
    //   files 算尺寸，就更说明这些字段本该跟着走。）
    out.push(Object.assign({}, nodes[q]))
  }
  for (var f = 0; f < out.length; f++) {
    var pt = pos[out[f].id]
    if (pt) { out[f].x = Math.round(pt.x); out[f].y = Math.round(pt.y) }
  }
  return { nodes: out, edges: model.edges, groups: model.groups, direction: dir, extras: model.extras }
}

