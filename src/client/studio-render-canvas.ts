// 画布 SVG 那一棵子树（组框 / 连线 / 节点 / 吸附参考线 / 起始页）。
// 从 studio.ts 的 ArchStudio 组件体里原样搬出来的顶层函数 —— 行为不变。
// 分片共享同一段作用域、不能 import，所以靠参数 S（本帧的 state / setter / ref 集合）通信。
function studioCanvasFns(S) {
  var dragHint = S.dragHint, dragging = S.dragging, driftRef = S.driftRef, edgeLayout = S.edgeLayout, fileStatusRef = S.fileStatusRef, foldGeom = S.foldGeom, foldMap = S.foldMap
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
    React.createElement('marker', { id: 'ac-circle', viewBox: '0 0 10 10', refX: 5, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' },
      React.createElement('circle', { cx: 5, cy: 5, r: 3.5, className: 'ac-arrowhead' })),
    React.createElement('marker', { id: 'ac-cross', viewBox: '0 0 10 10', refX: 5, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' },
      React.createElement('path', { d: 'M 2 2 L 8 8 M 8 2 L 2 8', className: 'ac-arrowcross' })),
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
    var elayout = edgeLayout || computeEdgeLayout(model, foldMap, foldGeom, gstate)
    if (elayout && elayout.routed) {
      // 记录已经为分支锚点画过箭头的集合（同汇流点只画一次箭头）
      var junctionArrowDrawn = {}
      var edgeLabels = []
      for (var ri = 0; ri < elayout.routed.length; ri++) {
        var rt = elayout.routed[ri]
        var red2 = rt.ed
        var juncForEdge = elayout.edgeToJunction && elayout.edgeToJunction[rt.ei]
        var style = arrowStyleOf(red2.arrow)
        var isEdgeSel = sel && sel.kind === 'edge' && sel.from === red2.from && sel.to === red2.to
        var cls = 'ac-edge'
          + (style.dashed ? ' dashed' : '')
          + (style.thick ? ' thick' : '')
          + (style.invisible ? ' invisible' : '')
          + (isEdgeSel ? ' sel' : '')

        // 两端形状：实心三角·圆点·叉·无，marker-start 与 marker-end 都要能挂
        var mkStart = arrowMarkerUrl(style.start)
        var mkEnd = arrowMarkerUrl(style.end)
        if (juncForEdge) {
          if (junctionArrowDrawn[juncForEdge.key]) {
            mkEnd = undefined
          } else {
            junctionArrowDrawn[juncForEdge.key] = true
          }
        }

        inner.push(React.createElement('g', { key: 'e' + red2.from + '-' + red2.to + '-' + rt.ei },
          React.createElement('path', { className: 'ac-edge-hit', d: rt.d, onPointerDown: (function (efrom, eto) { return function (ev) { onEdgeDown(ev, efrom, eto) } })(red2.from, red2.to) }),
          React.createElement('path', { className: cls, d: rt.d, markerStart: mkStart || undefined, markerEnd: mkEnd || undefined }),
        ))
        if (red2.label) {
          edgeLabels.push(React.createElement('g', { key: 'el-' + red2.from + '-' + red2.to + '-' + rt.ei },
            React.createElement('rect', {
              className: 'ac-elbl-bg',
              x: rt.mid.x - Math.max(14, visualLen(red2.label) * 3.6 + 6),
              y: rt.mid.y - 10,
              width: Math.max(28, visualLen(red2.label) * 7.2 + 12),
              height: 20,
              rx: 5,
            }),
            React.createElement('text', { className: 'ac-elbl', x: rt.mid.x, y: rt.mid.y }, red2.label),
          ))
        }
      }
      // 渲染分支锚点小圆点标记（输入侧汇流点与输出侧共干点各画一次）
      for (var jkey in elayout.junctionAnchors) {
        var junc = elayout.junctionAnchors[jkey]
        inner.push(React.createElement('circle', {
          key: 'junc-dot-' + jkey,
          className: 'ac-junc-dot',
          cx: junc.jx, cy: junc.jy, r: 3
        }))
      }
      for (var ojkey in elayout.outJunctionAnchors) {
        var ojunc = elayout.outJunctionAnchors[ojkey]
        inner.push(React.createElement('circle', {
          key: 'ojunc-dot-' + ojkey,
          className: 'ac-junc-dot',
          cx: ojunc.jx, cy: ojunc.jy, r: 3
        }))
      }
      // 标签统一画在所有连线与分支点之上，保证不会被后画的线条切穿
      for (var eli = 0; eli < edgeLabels.length; eli++) {
        inner.push(edgeLabels[eli])
      }
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
        var rx2 = kind === 'rect' ? NODE_RECT_RX : gm.h / 2
        shapeEl = React.createElement('rect', { className: 'ac-shape', x: x0, y: y0, width: gm.w, height: gm.h, rx: rx2 })
      }
      // 节点**永远只画标题**：描述与引用行都不在画布上画，一律去检查器里看。
      var lines = String(node.label == null ? '' : node.label).split('\n')
      // 标题必须是 .ac-lbl 的**全部**文本：测试与用户都靠它认节点。
      var titleEl = React.createElement('text', { className: 'ac-lbl' },
        React.createElement('tspan', { key: 't0', x: gm.x, y: gm.y }, lines.length > 0 ? lines[0] : ''))
      var isHl = !!(highlight && highlight.nodes && highlight.nodes.indexOf(node.id) >= 0)
      inner.push(React.createElement('g', {
        key: 'n' + node.id,
        className: 'ac-node' + (isSel ? ' sel' : '') + (isHl ? ' hl' : '') + hueClassOf(hueOfGroup, node.group),
        tabIndex: 0,
        role: 'button',
        onPointerDown: (function (nd) { return function (ev) { onNodeDown(ev, nd) } })(node),
        onKeyDown: (function (nd) {
          return function (ev) {
            if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
              ev.preventDefault()
              ev.stopPropagation()
              var fakeEv = {
                button: 0,
                stopPropagation: function () {},
                preventDefault: function () {},
                clientX: 0,
                clientY: 0,
                pointerId: 1,
                target: ev.target,
                currentTarget: ev.currentTarget,
              }
              onNodeDown(fakeEv, nd)
              onPointerUp(fakeEv)
            }
          }
        })(node),
      },
        // key 里带 highlight.key：新一轮改动会强制重挂，动画才会重新播
        isHl ? React.createElement('rect', {
          key: 'hl' + highlight.key,
          className: 'ac-pulse',
          x: x0 - 7, y: y0 - 7, width: gm.w + 14, height: gm.h + 14, rx: 13,
        }) : null,
        shapeEl,
        titleEl,
        // 概念 Tag 胶囊徽章：当节点打有 tags 时，在节点上方以精致胶囊徽章呈现
        (node.tags && node.tags.length > 0) ? React.createElement('g', {
          key: 'tag', className: 'ac-tag-badge',
          transform: 'translate(' + (x0 + 8) + ',' + (y0 - 9) + ')',
        },
          React.createElement('rect', {
            rx: 4, width: Math.max(26, String(node.tags[0]).length * 10 + 12), height: 16,
          }),
          React.createElement('text', {
            x: Math.max(13, (String(node.tags[0]).length * 10 + 12) / 2), y: 8,
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
  S.stage = stage
}
