// 画布 SVG 那一棵子树（组框 / 连线 / 节点 / 吸附参考线 / 起始页）。
// 从 studio.ts 的 ArchStudio 组件体里原样搬出来的顶层函数 —— 行为不变。
// 分片共享同一段作用域、不能 import，所以靠参数 S（本帧的 state / setter / ref 集合）通信。
function studioCanvasFns(S) {
  var dragHint = S.dragHint, dragging = S.dragging, driftRef = S.driftRef, fileStatusRef = S.fileStatusRef, foldGeom = S.foldGeom, foldMap = S.foldMap
  var groups = S.groups, gstate = S.gstate, highlight = S.highlight, hostRef = S.hostRef, hueOfGroup = S.hueOfGroup, libFiles = S.libFiles
  var libItems = S.libItems, libKey = S.libKey, linkPt = S.linkPt, model = S.model, sel = S.sel, svgRef = S.svgRef
  var view = S.view, visGeom = S.visGeom
  function addNode(...args) { return S.addNode.apply(null, args) }
  function loadLibrary(...args) { return S.loadLibrary.apply(null, args) }
  function onBackgroundDown(...args) { return S.onBackgroundDown.apply(null, args) }
  function onEdgeDown(...args) { return S.onEdgeDown.apply(null, args) }
  function onGroupDown(...args) { return S.onGroupDown.apply(null, args) }
  function onHandleDown(...args) { return S.onHandleDown.apply(null, args) }
  function onJumpDown(...args) { return S.onJumpDown.apply(null, args) }
  function onLostPointerCapture(...args) { return S.onLostPointerCapture.apply(null, args) }
  function onNodeDown(...args) { return S.onNodeDown.apply(null, args) }
  function onPointerCancel(...args) { return S.onPointerCancel.apply(null, args) }
  function onPointerMove(...args) { return S.onPointerMove.apply(null, args) }
  function onPointerUp(...args) { return S.onPointerUp.apply(null, args) }
  function openDiagram(...args) { return S.openDiagram.apply(null, args) }
  function openFilePicker(...args) { return S.openFilePicker.apply(null, args) }
  function openPath(...args) { return S.openPath.apply(null, args) }
  function toggleGroup(...args) { return S.toggleGroup.apply(null, args) }
  // ---------- SVG 画布 ----------
  var canvasKids = []
  canvasKids.push(React.createElement('defs', { key: 'defs' },
    React.createElement('marker', { id: 'ac-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' },
      React.createElement('path', { d: 'M 0 0 L 10 5 L 0 10 z', className: 'ac-arrowhead' })),
  ))

  var inner = []
  for (var gi = 0; gi < groups.length; gi++) {
    var gb = groups[gi]
    var fg = foldGeom[gb.id]
    var openFold = (function (gid) { return function (ev) { ev.stopPropagation(); toggleGroup(gid) } })(gb.id)
    if (fg) {
      inner.push(React.createElement('g', {
        key: 'g' + gb.id, className: 'ac-fold' + hueClassOf(hueOfGroup, gb.id),
        onPointerDown: (function (gid) { return function (ev) { onGroupDown(ev, gid) } })(gb.id),
      },
        React.createElement('rect', { className: 'ac-fold-box', x: fg.x - fg.w / 2, y: fg.y - fg.h / 2, width: fg.w, height: fg.h, rx: 10 }),
        React.createElement('text', { className: 'ac-fold-lbl', x: fg.x, y: fg.y }, fg.label),
        React.createElement('g', {
          className: 'ac-fold-btn',
          transform: 'translate(' + (fg.x + fg.w / 2 - 13) + ',' + fg.y + ')',
          onPointerDown: openFold,
        },
          React.createElement('circle', { r: 9 }),
          React.createElement('text', { y: 3.6 }, '▸')),
      ))
    } else {
      inner.push(React.createElement('g', {
        key: 'g' + gb.id,
        className: 'ac-grp' + hueClassOf(hueOfGroup, gb.id),
        onPointerDown: (function (gid) { return function (ev) { onGroupDown(ev, gid) } })(gb.id),
      },
        React.createElement('rect', { className: 'ac-group-box', x: gb.x, y: gb.y, width: gb.w, height: gb.h, rx: 12 }),
        React.createElement('text', { className: 'ac-group-lbl', x: gb.x + 12, y: gb.y + 17 },
          String(gb.label == null ? gb.id : gb.label)),
        React.createElement('g', {
          className: 'ac-group-btn',
          transform: 'translate(' + (gb.x + gb.w - 14) + ',' + (gb.y + 14) + ')',
          onPointerDown: openFold,
        },
          React.createElement('circle', { r: 9 }),
          React.createElement('text', { y: 3.6 }, '▾')),
      ))
    }
  }

  if (model) {
    // 连线要避让**其它可见方块**。一律取 visGeom：被折叠收起的节点会映射到组块几何上，
    // 于是"藏在块里的东西"天然不会挡路。按几何对象去重（折叠组里多个节点共用一个几何）。
    var visList = []
    var visSeen = []
    for (var vi = 0; vi < model.nodes.length; vi++) {
      var vg = visGeom(model.nodes[vi].id)
      if (!vg || visSeen.indexOf(vg) >= 0) continue
      visSeen.push(vg)
      visList.push(vg)
    }
    // 同一对节点之间的多条线要错开，否则会完全重叠成一条（有向还是无向都按同一对算）。
    var pairCount = {}
    for (var pi = 0; pi < model.edges.length; pi++) {
      var pe = model.edges[pi]
      var pk = pe.from < pe.to ? pe.from + '|' + pe.to : pe.to + '|' + pe.from
      pairCount[pk] = (pairCount[pk] || 0) + 1
    }
    // 端口分配：同一侧的 N 根线不能全挤在边心 —— 那就是"箭头叠在一起"。
    // 按**对端方向**给同一侧的线排序再平分该侧；顺序反了的话线会在方块附近互相交叉。
    // 判据是「可用边长 / 箭头宽」，**与缩放无关**：线宽与箭头都随画布变换缩放，两者比值恒定，
    // 所以放大缩小不会改变"叠不叠"这件事（实测：CSS 里没有任何 non-scaling-stroke）。
    //
    // 「哪一侧」必须和布线器问同一个函数（`edgeSidesOf`）—— 从前这里自己算一遍
    // 「|dy| >= |dx| 就上下」，与 edgeGeometry 内部那套是同一条规则的两份拷贝；
    // 现在选边改成代价择优，两份拷贝必然分叉：端口会按 A 侧均分、线却从 B 侧出去。
    // 连线视觉渲染层：自动执行同向边折叠合并（来自同一起点到同一终点的多条连线折叠为单条，标签用 " / " 拼接）
    // 彻底解决平行叠线与文字黑块，直观呈现为单条清晰箭头
    var consolidatedRenderModel = consolidateEdgesModel(model)
    var renderEdges = consolidatedRenderModel.edges || []
    var sideGroups = {}
    for (var gi = 0; gi < renderEdges.length; gi++) {
      var ge = renderEdges[gi]
      if (foldMap[ge.from] && foldMap[ge.from] === foldMap[ge.to]) continue
      var ga2 = visGeom(ge.from)
      var gb2 = visGeom(ge.to)
      if (!ga2 || !gb2) continue
      // 障碍也一起传：选边要避开「这条轴根本没路」的情况，而端口分组必须和布线器选同一条轴
      var gSides = edgeSidesOf(ga2, gb2, visList)
      for (var gend = 0; gend < 2; gend++) {
        var got = gend === 0 ? gb2 : ga2
        var gside = gend === 0 ? gSides.a : gSides.b
        // 端口按**可见单元**分组 —— 被折叠的组里，好几个成员节点连到外面时都挂在
        // 同一个折叠块上，用原始节点 id 当 key 会把它们拆成 n=1 的小组，
        // edgePortOffset 于是全部返回 0，箭头全叠在块边中心（审计第 5 条）。
        var gunit = gend === 0 ? ge.from : ge.to
        var gkey = (foldMap[gunit] || gunit) + '|' + gside
        if (!sideGroups[gkey]) sideGroups[gkey] = []
        // 排序键取「对端在**这条边**上的投影坐标」：上下边比 x、左右边比 y。
        // 从前统一按 gvert 比 x/y，选边一变（比如从竖轴换到横轴），排序键也得跟着换。
        var gax = gside === 't' || gside === 'b'
        sideGroups[gkey].push({ ei: gi, end: gend, at: gax ? got.x : got.y })
      }
    }
    // 识别需要建立分支锚点 (Junction Anchor) 的汇流集合
    // 当多条线从同一侧指向同一个节点时，建立分支锚点，统一汇流入单箭头
    var junctionAnchors = {}
    var edgeToJunction = {}
    for (var sk2 in sideGroups) {
      var arr2 = sideGroups[sk2]
      var parts2 = sk2.split('|')
      var unit2 = parts2[0], side2 = parts2[1]
      var inEdges = []
      for (var ai = 0; ai < arr2.length; ai++) {
        if (arr2[ai].end === 1) inEdges.push(arr2[ai])
      }
      if (inEdges.length > 1) {
        var gmNode = visGeom(unit2)
        if (gmNode) {
          var jx = gmNode.x, jy = gmNode.y
          var dist = 28
          if (side2 === 'l') jx = gmNode.x - gmNode.w / 2 - dist
          else if (side2 === 'r') jx = gmNode.x + gmNode.w / 2 + dist
          else if (side2 === 't') jy = gmNode.y - gmNode.h / 2 - dist
          else if (side2 === 'b') jy = gmNode.y + gmNode.h / 2 + dist

          var targetX = gmNode.x, targetY = gmNode.y
          if (side2 === 'l') targetX = gmNode.x - gmNode.w / 2
          else if (side2 === 'r') targetX = gmNode.x + gmNode.w / 2
          else if (side2 === 't') targetY = gmNode.y - gmNode.h / 2
          else if (side2 === 'b') targetY = gmNode.y + gmNode.h / 2

          var juncObj = {
            key: sk2, side: side2, jx: jx, jy: jy, targetX: targetX, targetY: targetY,
            count: inEdges.length
          }
          junctionAnchors[sk2] = juncObj
          for (var ii = 0; ii < inEdges.length; ii++) {
            edgeToJunction[inEdges[ii].ei] = juncObj
          }
        }
      }
    }

    // 输出侧共干：**输出端点由源节点管理**，与输入侧对称 —— 同一源节点同一侧的多条出边
    // 共用该侧一个出锚点，于是它们从同一点出发、先叠成一条主干，再各自拐向目标。
    // 从前只建了输入侧的汇流集合（只取 `end === 1`），所以源节点旁边是一排平行箭头：
    // 「输入侧共干、输出侧不共干」是不对称的，端点归节点管，两侧都该共。
    var outJunctionAnchors = {}
    var edgeToOutJunction = {}
    for (var sk3 in sideGroups) {
      var arr3 = sideGroups[sk3]
      var outEdges = []
      for (var oi2 = 0; oi2 < arr3.length; oi2++) {
        if (arr3[oi2].end === 0) outEdges.push(arr3[oi2])
      }
      if (outEdges.length <= 1) continue
      var oParts = sk3.split('|')
      var oUnit = oParts[0]
      var oSide = oParts[1]
      var ogNode = visGeom(oUnit)
      if (!ogNode) continue
      var ojx = ogNode.x
      var ojy = ogNode.y
      if (oSide === 'l') ojx = ogNode.x - ogNode.w / 2 - 28
      else if (oSide === 'r') ojx = ogNode.x + ogNode.w / 2 + 28
      else if (oSide === 't') ojy = ogNode.y - ogNode.h / 2 - 28
      else if (oSide === 'b') ojy = ogNode.y + ogNode.h / 2 + 28
      var oAnchor = { key: sk3, side: oSide, jx: ojx, jy: ojy, count: outEdges.length }
      outJunctionAnchors[sk3] = oAnchor
      for (var oj2 = 0; oj2 < outEdges.length; oj2++) edgeToOutJunction[outEdges[oj2].ei] = oAnchor
    }

    var portSlots = {}
    for (var sk in sideGroups) {
      var sArr = sideGroups[sk]
      sArr.sort(function (x, y) { return x.at - y.at })
      for (var si2 = 0; si2 < sArr.length; si2++) {
        var sItem = sArr[si2]
        // 两侧同一判据：入端有汇流点、或出端有共干点，就占**同一个**端点（n=1），
        // 否则在该侧按对端投影坐标均分（避免箭头叠在一起）。
        var sharedEnd = (sItem.end === 1 && edgeToJunction[sItem.ei]) || (sItem.end === 0 && edgeToOutJunction[sItem.ei])
        if (sharedEnd) {
          portSlots[sItem.ei + ':' + sItem.end] = { n: 1, i: 0 }
        } else {
          portSlots[sItem.ei + ':' + sItem.end] = { n: sArr.length, i: si2 }
        }
      }
    }
    var usedLanes = []
    var pairSeen = {}
    var routed = []
    for (var ei = 0; ei < renderEdges.length; ei++) {
      var red = renderEdges[ei]
      if (foldMap[red.from] && foldMap[red.from] === foldMap[red.to]) continue
      var rek = red.from < red.to ? red.from + '|' + red.to : red.to + '|' + red.from
      var ren = pairCount[rek] || 1
      var reidx = pairSeen[rek] || 0
      pairSeen[rek] = reidx + 1
      var rgeo = edgeGeometry(visGeom(red.from), visGeom(red.to), visList,
        ren > 1 ? (reidx - (ren - 1) / 2) * 10 : 0,
        { a: portSlots[ei + ':0'], b: portSlots[ei + ':1'] }, usedLanes)
      if (!rgeo) continue
      var rlanes = rgeo.lanes || []
      for (var rl = 0; rl < rlanes.length; rl++) usedLanes.push(rlanes[rl])
      routed.push({ ei: ei, ed: red, geo: rgeo, hops: [] })
    }
    for (var ca = 0; ca < routed.length; ca++) {
      var pa = routed[ca].geo.pts
      for (var cb = ca + 1; cb < routed.length; cb++) {
        var pb = routed[cb].geo.pts
        for (var sa = 0; sa + 1 < pa.length; sa++) {
          var a1 = pa[sa], a2 = pa[sa + 1]
          var aVert = Math.abs(a1.x - a2.x) < 0.5
          if (Math.abs(a1.x - a2.x) > 0.5 && Math.abs(a1.y - a2.y) > 0.5) continue
          for (var sb = 0; sb + 1 < pb.length; sb++) {
            var b1 = pb[sb], b2 = pb[sb + 1]
            var bVert = Math.abs(b1.x - b2.x) < 0.5
            if (aVert === bVert) continue
            if (Math.abs(b1.x - b2.x) > 0.5 && Math.abs(b1.y - b2.y) > 0.5) continue
            var hor = aVert ? { p: b1, q: b2 } : { p: a1, q: a2 }
            var ver = aVert ? { p: a1, q: a2 } : { p: b1, q: b2 }
            var hx1 = Math.min(hor.p.x, hor.q.x), hx2 = Math.max(hor.p.x, hor.q.x)
            var hy1 = Math.min(ver.p.y, ver.q.y), hy2 = Math.max(ver.p.y, ver.q.y)
            var hy = hor.p.y, vx = ver.p.x
            if (vx > hx1 + 3 && vx < hx2 - 3 && hy > hy1 + 3 && hy < hy2 - 3) {
              routed[cb].hops.push({ x: vx, y: hy })
            }
          }
        }
      }
    }
    // 记录已经为分支锚点画过箭头的集合（同汇流点只画一次箭头）
    var junctionArrowDrawn = {}
    for (var ri = 0; ri < routed.length; ri++) {
      var rt = routed[ri]
      var red2 = rt.ed
      var juncForEdge = edgeToJunction[rt.ei]
      var rpts = rt.geo.pts.slice()
      var rpath = rt.hops.length
        ? edgeCleanPath(rpts, rt.hops)
        : { d: edgeCleanPath(rpts, []).d, pts: rpts }
      var dashed = red2.arrow === '-.->'
      var isEdgeSel = sel && sel.kind === 'edge' && sel.from === red2.from && sel.to === red2.to
      var cls = 'ac-edge' + (dashed ? ' dashed' : '') + (isEdgeSel ? ' sel' : '')

      // 同侧汇流入端：同一个分支汇流点只保留首条连线的单个箭头，其余汇入线不重复打箭头！
      var mk = arrowMarkerRef(red2.arrow)
      if (juncForEdge) {
        if (junctionArrowDrawn[juncForEdge.key]) {
          mk = null
        } else {
          junctionArrowDrawn[juncForEdge.key] = true
        }
      }

      inner.push(React.createElement('g', { key: 'e' + red2.from + '-' + red2.to + '-' + rt.ei },
        React.createElement('path', { className: 'ac-edge-hit', d: rpath.d, onPointerDown: (function (efrom, eto) { return function (ev) { onEdgeDown(ev, efrom, eto) } })(red2.from, red2.to) }),
        React.createElement('path', { className: cls, d: rpath.d, markerEnd: mk || undefined }),
        red2.label ? React.createElement('g', { key: 'el' },
          React.createElement('rect', { className: 'ac-elbl-bg', x: rt.geo.mid.x - Math.max(12, visualLen(red2.label) * 3.3), y: rt.geo.mid.y - 9, width: Math.max(24, visualLen(red2.label) * 6.6), height: 17, rx: 5 }),
          React.createElement('text', { className: 'ac-elbl', x: rt.geo.mid.x, y: rt.geo.mid.y }, red2.label),
        ) : null,
      ))
    }
    // 渲染分支锚点小圆点标记（输入侧汇流点与输出侧共干点各画一次）
    for (var jkey in junctionAnchors) {
      var junc = junctionAnchors[jkey]
      inner.push(React.createElement('circle', {
        key: 'junc-dot-' + jkey,
        className: 'ac-junc-dot',
        cx: junc.jx, cy: junc.jy, r: 3
      }))
    }
    for (var ojkey in outJunctionAnchors) {
      var ojunc = outJunctionAnchors[ojkey]
      inner.push(React.createElement('circle', {
        key: 'ojunc-dot-' + ojkey,
        className: 'ac-junc-dot',
        cx: ojunc.jx, cy: ojunc.jy, r: 3
      }))
    }
    for (var ni = 0; ni < model.nodes.length; ni++) {
      var node = model.nodes[ni]
      // 被收起来的组，成员节点整个不画（几何仍在 gstate 里，展开时立刻回来）。
      if (foldMap[node.id]) continue
      var gm = gstate[node.id]
      if (!gm) continue
      var isSel = sel && sel.kind === 'node' && sel.id === node.id
      var kind = kindOf(node.shape)
      var shapeEl
      var x0 = gm.x - gm.w / 2
      var y0 = gm.y - gm.h / 2
      if (kind === 'diamond') {
        shapeEl = React.createElement('polygon', { className: 'ac-shape', points: gm.x + ',' + y0 + ' ' + (gm.x + gm.w / 2) + ',' + gm.y + ' ' + gm.x + ',' + (y0 + gm.h) + ' ' + (gm.x - gm.w / 2) + ',' + gm.y })
      } else if (kind === 'hex') {
        // 内缩量与 runtime.ts 的 NODE_HEX_INSET 是同一个数 —— 锚点要投在这个多边形的轮廓上，
        // 两处一旦不一致，箭头就会落在六边形的边外面。
        shapeEl = React.createElement('polygon', { className: 'ac-shape', points: (x0 + NODE_HEX_INSET) + ',' + y0 + ' ' + (x0 + gm.w - NODE_HEX_INSET) + ',' + y0 + ' ' + (x0 + gm.w) + ',' + gm.y + ' ' + (x0 + gm.w - NODE_HEX_INSET) + ',' + (y0 + gm.h) + ' ' + (x0 + NODE_HEX_INSET) + ',' + (y0 + gm.h) + ' ' + x0 + ',' + gm.y })
      } else if (kind === 'ellipse') {
        shapeEl = React.createElement('ellipse', { className: 'ac-shape', cx: gm.x, cy: gm.y, rx: gm.w / 2, ry: gm.h / 2 })
      } else if (kind === 'cyl') {
        shapeEl = React.createElement('rect', { className: 'ac-shape', x: x0, y: y0, width: gm.w, height: gm.h, rx: gm.h / 2 })
      } else {
        var rx2 = kind === 'rect' ? 9 : gm.h / 2
        shapeEl = React.createElement('rect', { className: 'ac-shape', x: x0, y: y0, width: gm.w, height: gm.h, rx: rx2 })
      }
      // 节点**永远只画标题**：描述与引用行都不在画布上画，一律去检查器里看。
      // 这里刻意保留 descLines / refText 两个空值，下面那段 JSX 就不用动
      // （它们为空时 descEl / refEl 自然就是 null）。
      var lines = String(node.label == null ? '' : node.label).split('\n')
      var descLines = []
      var refText = ''
      var rows = 1
      var spanStart = -((rows - 1) * 19) / 2
      // 标题必须是 .ac-lbl 的**全部**文本：测试与用户都靠它认节点。
      var titleEl = React.createElement('text', { className: 'ac-lbl' },
        React.createElement('tspan', { key: 't0', x: gm.x, y: gm.y + spanStart }, lines.length > 0 ? lines[0] : ''))
      var descEl = descLines.length > 0 ? React.createElement('text', { className: 'ac-desc' },
        descLines.map(function (ln, di) {
          // 前缀是**惯例**：写了就分层着色，没写就是普通描述（老图因此可以渐进迁移）。
          var cls = /^\s*意图\s*[：:]/.test(ln) ? 'ac-intent' : (/^\s*原理\s*[：:]/.test(ln) ? 'ac-rationale' : '')
          return React.createElement('tspan', {
            key: 'd' + di, x: gm.x, y: gm.y + spanStart + (di + 1) * 19,
            className: cls || undefined,
          }, ln)
        })) : null
      var refEl = refText ? React.createElement('text', { className: 'ac-ref' },
        React.createElement('tspan', { key: 'r0', x: gm.x, y: gm.y + spanStart + lines.length * 19 }, refText)) : null
      var isHl = !!(highlight && highlight.nodes && highlight.nodes.indexOf(node.id) >= 0)
      inner.push(React.createElement('g', {
        key: 'n' + node.id,
        className: 'ac-node' + (isSel ? ' sel' : '') + (isHl ? ' hl' : '') + hueClassOf(hueOfGroup, node.group),
        onPointerDown: (function (nd) { return function (ev) { onNodeDown(ev, nd) } })(node),
      },
        // key 里带 highlight.key：新一轮改动会强制重挂，动画才会重新播
        isHl ? React.createElement('rect', {
          key: 'hl' + highlight.key,
          className: 'ac-pulse',
          x: x0 - 7, y: y0 - 7, width: gm.w + 14, height: gm.h + 14, rx: 13,
        }) : null,
        shapeEl,
        titleEl,
        descEl,
        refEl,
        // 概念 Tag 胶囊徽章：当节点打有 tags 时，在节点上方以精致胶囊徽章呈现
        (node.tags && node.tags.length > 0) ? React.createElement('g', {
          key: 'tag', className: 'ac-tag-badge',
          transform: 'translate(' + (x0 + 8) + ',' + (y0 - 9) + ')',
        },
          React.createElement('rect', {
            rx: 4, width: Math.max(26, String(node.tags[0]).length * 10 + 12), height: 16,
            fill: 'var(--dsw-alias-brand-primary,#3b82f6)', fillOpacity: 0.15,
            stroke: 'var(--dsw-alias-brand-primary,#3b82f6)', strokeWidth: 1
          }),
          React.createElement('text', {
            x: Math.max(13, (String(node.tags[0]).length * 10 + 12) / 2), y: 11.5,
            fontSize: 10, fill: 'var(--dsw-alias-brand-primary,#3b82f6)', textAnchor: 'middle', fontWeight: 'bold'
          }, '#' + node.tags[0] + (node.tags.length > 1 ? ' +' + (node.tags.length - 1) : ''))
        ) : null,
        // 下钻角标：带 @link 的节点点它跳到那张图
        node.link ? React.createElement('g', {
          key: 'jump', className: 'ac-jump',
          transform: 'translate(' + (gm.x + gm.w / 2 - 8) + ',' + (y0 + 9) + ')',
          onPointerDown: (function (key) { return function (ev) { onJumpDown(ev, key) } })(node.link),
        },
          React.createElement('circle', { r: 8.5 }),
          React.createElement('text', { y: 3.6 }, '↗'),
        ) : null,
        // 留言角标：没留言的节点什么都不画。待递=琥珀色笔，已投递=灰底勾（和清单里的两区一致）。
        node.note ? React.createElement('g', {
          key: 'note',
          className: 'ac-note-badge' + (node.noteDone ? ' done' : ''),
          transform: 'translate(' + (x0 + 9) + ',' + (y0 + 9) + ')',
        },
          React.createElement('circle', { r: 8.5 }),
          React.createElement('text', { y: 3.6 }, node.noteDone ? '✓' : '✎'),
        ) : null,
        // 代码锚点角标：右下角，仅当 node.files && node.files.length > 0 时渲染
        node.files && node.files.length > 0 ? (function () {
          var nStatus = (fileStatusRef.current && fileStatusRef.current[node.id]) || {}
          var isBroken = false
          var isStale = false
          var staleSet = staleRefSet(driftRef.current)
          for (var fi2 = 0; fi2 < node.files.length; fi2++) {
            var fRef = node.files[fi2]
            var fSt = nStatus[fRef] || 'unknown'
            if (fSt !== 'ok') { isBroken = true; break }
            if (staleSet[fRef]) isStale = true
          }
          return React.createElement('g', {
            key: 'file-badge',
            // 三态：ok（品牌蓝）/ 文件在图之后改过（琥珀：还指得到，但内容可能已经不是图上说的了）/
            // 失效（红：文件或符号找不到了）。中间那档是 drift 带来的 —— 从前它和 ok 长得一模一样。
            className: 'ac-file-badge' + (isBroken ? ' broken' : (isStale ? ' stale' : '')),
            transform: 'translate(' + (gm.x + gm.w / 2 - 9) + ',' + (y0 + gm.h - 9) + ')',
          },
            React.createElement('circle', { r: 8.5 }),
            React.createElement('text', { y: 3.6 }, '▤'),
          )
        })() : null,
        isSel ? React.createElement('g', {
          key: 'h',
          onPointerDown: (function (nd) { return function (ev) { onHandleDown(ev, nd) } })(node),
        },
          // 透明热区（半径 15px）：消除小圆点易脱靶的体验痛点，实际交互面积扩大 6 倍以上
          React.createElement('circle', { cx: gm.x + gm.w / 2 + 10, cy: gm.y, r: 15, fill: 'transparent', cursor: 'crosshair' }),
          React.createElement('circle', {
            className: 'ac-handle', cx: gm.x + gm.w / 2 + 10, cy: gm.y, r: 6,
          },
            React.createElement('title', null, '拖到另一个方块上建立连线'),
          )
        ) : null,
      ))
    }
  }

  if (linkPt) {
    inner.push(React.createElement('circle', { key: 'lp', className: 'ac-link-preview', cx: linkPt.x, cy: linkPt.y, r: 7 }))
  }

  // 吸附参考线画在最上层：只在拖拽且真吸上时出现，是「你正贴到这条线」的即时反馈。
  // 它不进模型也不进文件，松手就没了。
  if (dragHint) {
    if (dragHint.gx != null) {
      inner.push(React.createElement('line', { key: 'snapline-x', className: 'ac-snapline', x1: dragHint.gx, y1: -99999, x2: dragHint.gx, y2: 99999 }))
    }
    if (dragHint.gy != null) {
      inner.push(React.createElement('line', { key: 'snapline-y', className: 'ac-snapline', x1: -99999, y1: dragHint.gy, x2: 99999, y2: dragHint.gy }))
    }
  }

  canvasKids.push(React.createElement('g', {
    key: 'world',
    className: 'ac-world',
    transform: 'translate(' + view.x + ',' + view.y + ') scale(' + view.k + ')',
  }, inner))

  var stage = React.createElement('div', { className: 'ac-stage', ref: hostRef },
    React.createElement('svg', {
      ref: svgRef,
      className: 'ac-svg' + (dragging ? ' dragging' : ''),
      onPointerDown: onBackgroundDown,
      onPointerMove: onPointerMove,
      onPointerUp: onPointerUp,
      onPointerCancel: onPointerCancel,
      onLostPointerCapture: onLostPointerCapture,
    }, canvasKids),
    // 空画布 = 起始页（跟常见软件一样：给出路，而不是一片空白）。
    // 这里直接把「这个项目里已有的图」和「外面散落的 mermaid 文件」列出来，点一下就能进。
    model && model.nodes.length === 0
      ? React.createElement('div', { className: 'ac-start' },
          React.createElement('div', { className: 'ac-start-title' }, '这张图还是空的'),
          React.createElement('div', { className: 'ac-start-actions' },
            React.createElement('button', { className: 'ac-btn primary', onClick: addNode }, '＋ 加一个节点'),
            React.createElement('button', { className: 'ac-btn', onClick: openFilePicker }, '打开文件…'),
            React.createElement('button', { className: 'ac-btn', onClick: function () { loadLibrary(false) } }, '图库…'),
          ),
          // 「怎么建一条边」这句话必须在**没有选中任何东西**的时候也说一遍 ——
          // 手柄只在选中之后才出现，等它出现再说就晚了。
          React.createElement('div', { className: 'ac-hint' }, '选中一个方块后，把它右侧的小圆点拖到另一个方块上就能连线。'),
          libItems.length > 0
            ? React.createElement('div', { className: 'ac-start-list' },
                React.createElement('div', { className: 'ac-start-head' }, '这个项目里的图'),
                libItems.filter(function (it) { return !it.deleted && it.key !== libKey }).map(function (it) {
                  return React.createElement('div', { key: 's' + it.key, className: 'ac-start-row' },
                    React.createElement('span', { className: 'ac-start-key', title: it.dir }, it.key),
                    React.createElement('span', { className: 'ac-start-meta' }, it.nodes + ' 节点 / ' + it.edges + ' 连线'),
                    (it.rel && it.relOutside)
                      ? React.createElement('span', { className: 'ac-start-meta', title: it.dir }, '在 ' + it.rel)
                      : null,
                    it.summary ? React.createElement('span', { className: 'ac-start-sum', title: it.summary }, it.summary) : null,
                    React.createElement('button', { className: 'ac-btn', onClick: function () { openDiagram(it.key, false) } }, '打开'),
                  )
                }),
              )
            : null,
          libFiles.length > 0
            ? React.createElement('div', { className: 'ac-start-list' },
                React.createElement('div', { className: 'ac-start-head' }, '项目里的 mermaid 文件'),
                libFiles.slice(0, 6).map(function (f) {
                  return React.createElement('div', { key: 'f' + f.path, className: 'ac-start-row' },
                    React.createElement('span', { className: 'ac-start-key', title: f.path }, f.rel),
                    React.createElement('span', { className: 'ac-start-meta' }, Math.max(1, Math.round((f.bytes || 0) / 1024)) + ' KB'),
                    React.createElement('button', { className: 'ac-btn', onClick: function () { openPath(f.path, false) } }, '打开'),
                  )
                }),
              )
            : null,
          libItems.length === 0 && libFiles.length === 0
            ? React.createElement('div', { className: 'ac-hint' }, '这个项目里还没有图。用「＋ 加一个节点」起手，或让 AI 画一版初稿。加完节点后，选中它、把它右侧的小圆点拖到另一个方块上就能连线。')
            : null,
        )
      : null,
  )
  S.canvasKids = canvasKids
  S.inner = inner
  S.stage = stage
}
