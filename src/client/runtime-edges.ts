// ==================== 连线几何：正交折线 + 避让（draw.io 式） ====================
// 为什么是正交折线而不是曲线：曲线避让要在连续空间里解几何，很难做对；正交布线把候选
// 路径限制在「方块边线 ± 余量」这些格线上，避让就退化成「找一条不穿过任何方块的折线」，
// 几十个节点规模下是微秒级的事。两条抱怨（线穿过别的方块、弧度和拐弯不好看）一并解决。
//
// 契约不变：仍返回 { d, mid }（mid 给标签用）。新增的两个参数都是可选的，
// 老调用（只传 a、b）仍然得到一条合法的正交折线。
var EDGE_PAD = 12       // 避让余量：线离方块至少这么远
var EDGE_LANE = 16      // 绕行时走到障碍外侧的额外距离
var EDGE_PORT_INSET = 8 // 端口离方块两角的边距，别让线从角上出去
var EDGE_PORT_MIN_GAP = 12 // 同一侧两个端口的最小间距 ≈ 箭头宽度，否则箭头会叠在一起
var EDGE_CORNER = 8     // 拐角的圆角半径：折线不是画成直角，而是「稍微转个弯」（用户要的观感）
var EDGE_HOP = 5        // 交叉处的半圆拱桥半径：十字交叉时有一条线从上面跨过去
var EDGE_LANE_STEP = 12 // 中位线被占时，往两侧让的步长（并行线之间要有肉眼可见的间隔）
var EDGE_LANE_GAP = 10  // 两条平行线窄于这个距离就算「画在一起了」，必须错开

/** 轴对齐线段是否真的穿过矩形。用严格不等号，所以线可以**贴着**障碍边界走。 */
function edgeSegHitsRect(x1, y1, x2, y2, r) {
  if (y1 === y2) {
    if (y1 <= r.y1 || y1 >= r.y2) return false
    return Math.max(x1, x2) > r.x1 && Math.min(x1, x2) < r.x2
  }
  if (x1 === x2) {
    if (x1 <= r.x1 || x1 >= r.x2) return false
    return Math.max(y1, y2) > r.y1 && Math.min(y1, y2) < r.y2
  }
  return false
}

function edgePathHits(pts, obs) {
  for (var i = 0; i + 1 < pts.length; i++) {
    for (var j = 0; j < obs.length; j++) {
      if (edgeSegHitsRect(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, obs[j])) return true
    }
  }
  return false
}

/** 点是否在形状**内部**（往里收 0.5px：贴着轮廓走不算「穿进去」）。与 perimeterPoint 同一套尺寸约定。 */
function shapeInterior(px, py, g, kind) {
  var a = Math.max(0.5, g.w / 2 - 0.5), b = Math.max(0.5, g.h / 2 - 0.5)
  var dx = px - g.x, dy = py - g.y
  if (kind === 'ellipse') return Math.hypot(dx / a, dy / b) < 1
  if (kind === 'diamond') return Math.abs(dx) / a + Math.abs(dy) / b < 1
  if (kind === 'hex') {
    // 六边形 = 上下直边 + 左右两条斜边，对 |dy| 分层：边界 |x| = w/2 - 14·(|y|/(h/2))
    var hw = Math.max(0.5, g.w / 2 - 0.5), hh = Math.max(0.5, g.h / 2 - 0.5)
    if (Math.abs(dy) >= hh) return false
    var hexInset = Math.min(NODE_HEX_INSET, hw)
    return Math.abs(dx) < hw - hexInset * (Math.abs(dy) / hh)
  }
  // rect / round / sub / cyl / stadium：圆角矩形（rect 的 rx=9）
  var r = kind === 'rect' ? 9 : Math.min(a, b)
  var cx = Math.max(Math.abs(dx) - (a - r), 0)
  var cy = Math.max(Math.abs(dy) - (b - r), 0)
  return Math.hypot(cx, cy) < r
}

/**
 * 线段是否真的穿进这个节点的**可见形状**。包围盒只当快速预筛 —— 非矩形节点的锚点本来就落在
 * 包围盒内部（轮廓上），拿包围盒当判据会把每条候选都判成自穿透（复核第 1 条：那会让整条线
 * 落到不看障碍的兜底上，画出来正好穿过别的方块）。只有真的进了形状才算命中，于是「从轮廓上
 * 出发往外走」天然不算。
 */
function edgeSegHitsNode(x1, y1, x2, y2, g) {
  var box = { x1: g.x - g.w / 2, y1: g.y - g.h / 2, x2: g.x + g.w / 2, y2: g.y + g.h / 2 }
  if (!edgeSegHitsRect(x1, y1, x2, y2, box)) return false
  var kind = kindOf(g.shape)
  if (kind === 'rect') return true            // 矩形填满包围盒，不必再采样
  var L = Math.abs(x2 - x1) + Math.abs(y2 - y1)
  var steps = Math.max(2, Math.min(48, Math.ceil(L / 6)))
  for (var i = 1; i < steps; i++) {
    var t = i / steps
    if (shapeInterior(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, g, kind)) return true
  }
  return false
}

/** 一条折线有没有穿进**自己**这个节点（a / b 各查一次）。 */
function edgePathHitsSelf(pts, g) {
  if (!g || typeof g.w !== 'number' || typeof g.h !== 'number') return false
  for (var i = 0; i + 1 < pts.length; i++) {
    if (edgeSegHitsNode(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, g)) return true
  }
  return false
}

/** 把折点整理成一条干净的路径：去掉零长段与共线的多余拐点。`hops` 是交叉处的拱桥（可省）。 */
function edgeCleanPath(pts, hops?: any) {
  var hp = (hops && hops.length) ? hops : []
  var out = []
  for (var i = 0; i < pts.length; i++) {
    var last = out[out.length - 1]
    if (last && Math.abs(last.x - pts[i].x) < 0.5 && Math.abs(last.y - pts[i].y) < 0.5) continue
    out.push({ x: pts[i].x, y: pts[i].y })
  }
  var res = [out[0]]
  for (var k = 1; k + 1 < out.length; k++) {
    var p = res[res.length - 1], c = out[k], n = out[k + 1]
    var col = (Math.abs(p.x - c.x) < 0.5 && Math.abs(c.x - n.x) < 0.5) ||
              (Math.abs(p.y - c.y) < 0.5 && Math.abs(c.y - n.y) < 0.5)
    if (!col) res.push(c)
  }
  if (out.length > 1) res.push(out[out.length - 1])
  // 出 d 要同时照顾两件事，所以按**段**走一遍，而不是按顶点：
  //   1) 拐角抹圆（EDGE_CORNER）：折线不是折成硬直角，而是「稍微转个弯」；
  //   2) 交叉处的拱桥（EDGE_HOP）：和别的连线十字相交时，在交点上画一段半圆从上面跨过去。
  //      用户的原话是「十字交叉时应该有一条线弯折一下」—— 要的就是这个，不是把直角抹圆。
  //
  // 两处的让位半径都收敛到「相邻线段的一半以内」，短段自动退化成尖角：
  // 圆角/拱桥永远吃不掉一整条线段，也就不会把路径抹穿或反向。
  // 注意返回的 `pts` 仍是**尖角折线**：避让判定、交叉检测与标签中点都按它算，只是画出来带修饰。
  var d = 'M ' + res[0].x + ' ' + res[0].y
  var lx = res[0].x, ly = res[0].y
  function lineTo(x, y) {
    if (Math.abs(x - lx) < 0.01 && Math.abs(y - ly) < 0.01) return
    d += ' L ' + x + ' ' + y
    lx = x; ly = y
  }
  var np = res.length
  // 每个顶点让给拐角多少（两端不让：那是方块边界，抹了箭头就离开边框）
  var trim = []
  for (var v = 0; v < np; v++) {
    var rv = 0
    if (v > 0 && v < np - 1) {
      var rl1 = edgeSegLen(res[v - 1], res[v])
      var rl2 = edgeSegLen(res[v], res[v + 1])
      rv = Math.min(EDGE_CORNER, rl1 / 2, rl2 / 2)
      if (!(rv > 0.6) || !(rl1 > 0) || !(rl2 > 0)) rv = 0
    }
    trim.push(rv)
  }
  for (var k = 0; k + 1 < np; k++) {
    var A = res[k], B = res[k + 1]
    var L = edgeSegLen(A, B)
    if (L <= 0) continue
    var ux = (B.x - A.x) / L, uy = (B.y - A.y) / L
    var t0 = trim[k]
    var t1 = L - trim[k + 1]
    // 本段上的拱桥：把 hop 点投影到本段参数上，只收真的落在这条线上的
    var hs = []
    for (var h2 = 0; h2 < hp.length; h2++) {
      var hx = hp[h2].x - A.x, hy = hp[h2].y - A.y
      var dt = hx * ux + hy * uy
      var off = Math.abs(-hx * uy + hy * ux)
      if (off < 1.0) hs.push(dt)
    }
    hs.sort(function (q1, q2) { return q1 - q2 })
    lineTo(A.x + ux * t0, A.y + uy * t0)
    var cur = t0
    for (var h3 = 0; h3 < hs.length; h3++) {
      var hb = hs[h3] - EDGE_HOP, he = hs[h3] + EDGE_HOP
      // 与已画出来的圆角/拱桥打架就放弃这条 —— 少一个拱只是不好看，叠在一起是烂的
      if (hb < cur + 0.5 || he > t1 - 0.5) continue
      lineTo(A.x + ux * hb, A.y + uy * hb)
      var aex = A.x + ux * he, aey = A.y + uy * he
      // sweep 固定为 1：拱一律鼓在前进方向的**左侧**（屏幕上从左往右的线就往上鼓）
      d += ' A ' + EDGE_HOP + ' ' + EDGE_HOP + ' 0 0 1 ' + aex + ' ' + aey
      lx = aex; ly = aey
      cur = he
    }
    lineTo(A.x + ux * t1, A.y + uy * t1)
    if (trim[k + 1] > 0) {
      var C = res[k + 1], N = res[k + 2]
      var l3 = edgeSegLen(C, N)
      var ex = C.x + (N.x - C.x) * (trim[k + 1] / l3), ey = C.y + (N.y - C.y) * (trim[k + 1] / l3)
      d += ' Q ' + C.x + ' ' + C.y + ' ' + ex + ' ' + ey
      lx = ex; ly = ey
    }
  }
  return { d: d, pts: res }
}

/** 轴对齐折线一段的长度。 */
function edgeSegLen(a, b) {
  return Math.abs(b.x - a.x) + Math.abs(b.y - a.y)
}

/** 两条同向平行线段是否「贴在一起」：线距小于 gap 且投影相交。 */
function edgeLaneConflict(vert, c, lo, hi, u) {
  if (!u || u.vert !== vert) return false
  if (Math.abs(u.c - c) >= EDGE_LANE_GAP) return false
  return Math.min(hi, u.hi) - Math.max(lo, u.lo) > 0
}

/** 取出折线里所有**内部**线段，作为「这条线占掉的车道」记下来。 */
function edgePathLanes(pts) {
  var out = []
  for (var i = 1; i + 1 < pts.length; i++) {
    var a = pts[i], b = pts[i + 1]
    var vert = Math.abs(a.x - b.x) < 0.5
    out.push(vert
      ? { vert: true, c: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y) }
      : { vert: false, c: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) })
  }
  return out
}

/** 标签落点：取整条路径**按弧长**的一半处 —— 折线不再是直线，两端中点会偏。 */
function edgeMidOfPath(pts) {
  var total = 0
  for (var i = 0; i + 1 < pts.length; i++) {
    total += Math.abs(pts[i + 1].x - pts[i].x) + Math.abs(pts[i + 1].y - pts[i].y)
  }
  if (total <= 0) return { x: pts[0].x, y: pts[0].y }
  var half = total / 2
  for (var k = 0; k + 1 < pts.length; k++) {
    var seg = Math.abs(pts[k + 1].x - pts[k].x) + Math.abs(pts[k + 1].y - pts[k].y)
    if (half <= seg || k + 2 === pts.length) {
      var t = seg <= 0 ? 0 : half / seg
      return { x: pts[k].x + (pts[k + 1].x - pts[k].x) * t, y: pts[k].y + (pts[k + 1].y - pts[k].y) * t }
    }
    half -= seg
  }
  return { x: pts[0].x, y: pts[0].y }
}

/**
 * 端口在它那一侧上偏离正中心的距离。`p = { n, i }` 是「这一侧一共 n 根线、我是第 i 根」
 * （调用方按对端方向排好序传入），于是同一侧的线会沿边**展开**而不是全挤在边心。
 *
 * **端口绝不允许越过方块边界** —— 越过就是"悬空连接"（线头挂在方块外面）。矮节点
 * （只画标题的那种）尤其容易踩：高度只有 30 出头，一侧挤进 4 条线时，按最小间距摆
 * 会直接溢出到框外。所以这里把间距**同时**压在 (a) 不小于箭头宽、(b) 整串不越界；
 * 两个约束冲突时以 (b) 为准 —— 箭头挤一点只是难看，线头悬空是错的。
 */
function edgePortOffset(span, p) {
  if (!p || !(p.n > 1) || !(p.i >= 0)) return 0
  var usable = Math.max(0, span - 2 * EDGE_PORT_INSET)
  var gap = usable / (p.n - 1)
  if (gap < EDGE_PORT_MIN_GAP) gap = EDGE_PORT_MIN_GAP
  var maxGap = (span - 4) / (p.n - 1)
  if (gap > maxGap) gap = Math.max(0, maxGap)
  return (p.i - (p.n - 1) / 2) * gap
}

// ==================== 选边与落点（2026-09-23 重写） ====================
// 从前的规则是「两节点中心的 |dx| / |dy| 谁大就走竖轴、否则走横轴，侧边按 delta 的正负取」。
// 那是 React Flow「Simple Floating Edges」那套的简化版：它只看中心，**不看两个方块各自有多大**，
// 于是「一个矮胖节点斜对一个方块」这类常见摆法会选错轴、白绕几十像素
// （实测 420 个相对位置：平均多绕 24.8px，26.7% 的位置多绕 40px 以上）。
// 工业界（draw.io 的端口方向掩码、JointJS 的 anchor + boundary connectionPoint、
// React Flow 官方 floating edges）的共同做法是**先算落点、再定侧**。这里照这个思路做，
// 只保留现有正交路由器能吃的形状（两端走同一条轴），把「选哪条轴、哪条边」交给代价函数。
var NODE_HEX_INSET = 14  // 六边形左右两个斜角的水平内缩 —— 与 studio.ts 画形状时用的是同一个数

function sideNormal(s) {
  if (s === 't') return { x: 0, y: -1 }
  if (s === 'b') return { x: 0, y: 1 }
  if (s === 'l') return { x: -1, y: 0 }
  return { x: 1, y: 0 }
}


/** 边心（不带端口偏移）—— 只用来估代价。 */
function sideCenter(g, s) {
  var n = sideNormal(s)
  return { x: g.x + n.x * g.w / 2, y: g.y + n.y * g.h / 2 }
}

/** 两个方块在四条边外侧的间隙（负数 = 这一轴上两方块重叠）。 */
function edgeGaps(a, b) {
  return {
    r: b.x - b.w / 2 - (a.x + a.w / 2),
    l: a.x - a.w / 2 - (b.x + b.w / 2),
    b: b.y - b.h / 2 - (a.y + a.h / 2),
    t: a.y - a.h / 2 - (b.y + b.h / 2),
  }
}

/**
 * 这条轴上「朝对端」的那条边。两方块在该轴上有间隙时取有间隙的那条（这就是「朝向」的
 * 准确含义）；没有间隙（在该轴上重叠）就退化成「对端在哪个方向就走哪边」。
 */
function sideOnAxis(a, b, vertical, gp) {
  if (vertical) {
    if (gp.b >= 0) return 'b'
    if (gp.t >= 0) return 't'
    return b.y >= a.y ? 'b' : 't'
  }
  if (gp.r >= 0) return 'r'
  if (gp.l >= 0) return 'l'
  return b.x >= a.x ? 'r' : 'l'
}

/**
 * 这条轴「走不走得通」的粗估：用边心 + 中位线附近几条候选试着铺一下，全部撞障碍就返回 false。
 * 它**不替代**布线器（那边会扫十几条车道、还有两段绕行），只用来在选边时避开「这条轴根本没路」
 * 的情况 —— 真图上实测过：不看障碍时，选出来的那条轴会被障碍全部拒掉，最后落到不看障碍的
 * 硬穿兜底，画出一条穿过第三方块的线。
 */
function axisLooksClear(a, b, sa, sb, vertical, obs) {
  var p = sideCenter(a, sa), q = sideCenter(b, sb)
  var mid0 = vertical ? (p.y + q.y) / 2 : (p.x + q.x) / 2
  var tries = [mid0]
  for (var t = 1; t <= 2; t++) { tries.push(mid0 - t * EDGE_LANE_STEP); tries.push(mid0 + t * EDGE_LANE_STEP) }
  for (var i = 0; i < tries.length; i++) {
    var m = tries[i]
    var pts = vertical
      ? [{ x: p.x, y: p.y }, { x: p.x, y: m }, { x: q.x, y: m }, { x: q.x, y: q.y }]
      : [{ x: p.x, y: p.y }, { x: m, y: p.y }, { x: m, y: q.y }, { x: q.x, y: q.y }]
    if (!edgePathHits(pts, obs)) return true
  }
  return false
}

/**
 * 两端的端口各落在哪条边上。
 * 支持两端同轴（竖轴 Z / 横轴 Z）及开阔无阻挡下的正交 L 形（混轴）选边。
 * 代价 = 两个边心的曼哈顿距离
 *      + 从「重叠的那条轴」绕出去的罚
 *      + 这条轴走不通的罚
 *      + 转弯惩罚（L 形 1 个拐弯优于 Z 形 2 个拐弯）
 *      + 回头线 / 自穿透重罚
 */
function edgeSidesOf(a, b, obstacles = null) {
  if (!a || !b) return { a: 'b', b: 't', vertical: true }
  var gp = edgeGaps(a, b)
  var gpB = edgeGaps(b, a)
  var obs = []
  if (obstacles) {
    for (var oi = 0; oi < obstacles.length; oi++) {
      var o = obstacles[oi]
      if (!o || o === a || o === b) continue
      if (typeof o.w !== 'number' || typeof o.h !== 'number') continue
      obs.push({
        x1: o.x - o.w / 2 - EDGE_PAD, y1: o.y - o.h / 2 - EDGE_PAD,
        x2: o.x + o.w / 2 + EDGE_PAD, y2: o.y + o.h / 2 + EDGE_PAD,
      })
    }
  }

  // 基础候选：两条同轴（竖轴 / 横轴）
  var best = null, bestCost = Infinity
  for (var vi = 0; vi < 2; vi++) {
    var vertical = vi === 0
    var sa = sideOnAxis(a, b, vertical, gp)
    var sb = sideOnAxis(b, a, vertical, gpB)
    var p = sideCenter(a, sa), q = sideCenter(b, sb)
    var cost = Math.abs(q.x - p.x) + Math.abs(q.y - p.y)
    var gap = vertical ? Math.max(gp.b, gp.t) : Math.max(gp.r, gp.l)
    var gapOther = vertical ? Math.max(gp.r, gp.l) : Math.max(gp.b, gp.t)
    if (gap < 0 && gapOther > 0) cost += 200 + Math.min(600, -gap * 2)
    if (obstacles && !axisLooksClear(a, b, sa, sb, vertical, obs)) cost += 400
    var na = sideNormal(sa), nb = sideNormal(sb)
    if ((b.x - p.x) * na.x + (b.y - p.y) * na.y < 0) cost += 900
    if ((a.x - q.x) * nb.x + (a.y - q.y) * nb.y < 0) cost += 900
    if (Math.abs(p.x - b.x) < b.w / 2 && Math.abs(p.y - b.y) < b.h / 2) cost += 100000
    if (Math.abs(q.x - a.x) < a.w / 2 && Math.abs(q.y - a.y) < a.h / 2) cost += 100000
    if (cost < bestCost) { bestCost = cost; best = { a: sa, b: sb, vertical: vertical } }
  }

  // 完全重合特判
  var pc = sideCenter(a, best.a), qc = sideCenter(b, best.b)
  if (Math.abs(pc.x - qc.x) < 0.5 && Math.abs(pc.y - qc.y) < 0.5) {
    return { a: 'r', b: 'l', vertical: false }
  }
  return best
}

/**
 * 把「某条边上的横向偏移」投到形状的**可见轮廓**上，而不是包围盒上。
 * 这一步是本次改动里最容易被看见的一条：菱形/椭圆/六边形/胶囊的锚点从前落在包围盒上，
 * 同一侧挤两根线时箭头就悬在方块外面（实测：菱形 24.4px、椭圆 10.1px、六边形 5.4px）。
 * `kind` 来自 kindOf(shape)，与 studio.ts 里画形状的那段共用同一套尺寸约定。
 */
function perimeterPoint(g, kind, side, lateral) {
  var ax = side === 't' || side === 'b'
  var spanA = ax ? g.w / 2 : g.h / 2   // 沿边方向
  var spanD = ax ? g.h / 2 : g.w / 2   // 垂直方向（矩形时就是落点距离）
  var lim = Math.max(0, spanA - 2)
  var lat = Math.max(-lim, Math.min(lim, lateral || 0))
  var perp = spanD
  if (kind === 'diamond') {
    perp = spanD * Math.max(0, 1 - Math.abs(lat) / Math.max(1e-6, spanA))
  } else if (kind === 'ellipse') {
    var eu = spanA > 0 ? lat / spanA : 0
    perp = spanD * Math.sqrt(Math.max(0, 1 - eu * eu))
  } else if (kind === 'hex') {
    if (ax) {
      // 上下边：中间一段是直边，两端各有一个 14px 的斜角
      var inset = Math.min(NODE_HEX_INSET, spanA)
      perp = Math.abs(lat) <= spanA - inset
        ? spanD
        : spanD * Math.max(0, (spanA - Math.abs(lat)) / Math.max(1e-6, inset))
    } else {
      // 左右两侧不是边，是两个顶点：从顶点沿斜边收进去（垂直方向的半长是 spanD）
      perp = Math.max(0, spanD - NODE_HEX_INSET * (Math.abs(lat) / Math.max(1e-6, spanA)))
    }
  } else if (kind !== 'rect') {
    // round / sub / cyl / stadium：rx = min(h/2, w/2) 的胶囊，直段之外落到圆角上。
    // 圆角圆心在「离形状中心 (spanD - r) 的垂直距离」处，所以半径那一段要**加上这个偏移**：
    // 少了它，横着出去的锚点会缩进方块里（140×60 的胶囊上实测缩了 41px）。
    var r = Math.min(spanA, spanD)
    if (Math.abs(lat) > spanA - r) {
      var dc = Math.abs(lat) - (spanA - r)
      perp = (spanD - r) + Math.sqrt(Math.max(0, r * r - dc * dc))
    }
  }
  if (side === 'b') return { x: g.x + lat, y: g.y + perp }
  if (side === 't') return { x: g.x + lat, y: g.y - perp }
  if (side === 'r') return { x: g.x + perp, y: g.y + lat }
  return { x: g.x - perp, y: g.y + lat }
}

/** 某个端口位次在给定侧上的最终落点（先按「同侧均分」算偏移，再投到轮廓上）。 */
function portPointOf(g, side, p) {
  var span = (side === 't' || side === 'b') ? g.w : g.h
  return perimeterPoint(g, kindOf(g.shape), side, edgePortOffset(span, p))
}

/**
 * 一条连线的路径。`obstacles` 是画布上**其它可见方块**的几何（被折叠收起的方块不该挡路），
 * `offset` 用于把同一对节点之间的多条线错开（由调用方按序号算），
 * `ports` 是两端的端口位次 `{ a: {n,i}, b: {n,i} }`，
 * `usedLanes` 是**前面几条线已经占掉的车道** —— 有了它，两条不同连线的中位线撞上时
 * 后来者会自己往旁边让（用户要的「平行间隔」）。由调用方逐条累积。
 *
 * 几何里可以带 `shape`（studio 传的就是带 shape 的那份）；不带就按矩形处理。
 */
function edgeGeometry(a, b, obstacles, offset, ports, usedLanes) {
  if (!a || !b) return null
  var shift = (typeof offset === 'number' && isFinite(offset)) ? offset : 0
  var obs = []
  if (obstacles) {
    for (var i = 0; i < obstacles.length; i++) {
      var o = obstacles[i]
      if (!o || o === a || o === b) continue
      if (typeof o.w !== 'number' || typeof o.h !== 'number') continue
      obs.push({
        x1: o.x - o.w / 2 - EDGE_PAD, y1: o.y - o.h / 2 - EDGE_PAD,
        x2: o.x + o.w / 2 + EDGE_PAD, y2: o.y + o.h / 2 + EDGE_PAD,
      })
    }
  }
  var pA = ports && ports.a
  var pB = ports && ports.b
  // 自环（`n1 --> n1`）：从右边绕出去一小圈再回来。不特判的话 dx=dy=0 会被判成"垂直"，
  // 出点取底边中心、入点取顶边中心 —— 画出来是一条**从底边穿到顶边的直线**，正好捅穿方块。
  if (a === b) {
    var loopX = a.x + a.w / 2
    var loopL = loopX + EDGE_LANE * 1.4
    var loopT = a.y - a.h / 4
    var loopB = a.y + a.h / 4
    var loopPts = [{ x: loopX, y: loopT }, { x: loopL, y: loopT }, { x: loopL, y: loopB }, { x: loopX, y: loopB }]
    var lc = edgeCleanPath(loopPts)
    return { d: lc.d, mid: { x: loopL, y: a.y }, pts: lc.pts, lanes: edgePathLanes(lc.pts) }
  }
  // 选边（两端同轴）→ 落点（投到真实轮廓上，而不是包围盒）
  // **必须把 obstacles 交进去**：studio 的端口分组用的是带障碍的那一份（它决定每个端口落在哪条边、
  // 以及同一侧多端口怎么均分），这里不交就会挑出另一条轴 —— 端口按 A 侧均分、线却从 B 侧出去，
  // 更坏的是会选中代价函数刚判过「这条轴根本走不通」的那条轴，候选车道全被拒、落到硬穿兜底，
  // 画出一条穿过第三方方块的线（2026-09-24 客户端审计第 2 条，是上一轮改动留下的回归）。
  var sides = edgeSidesOf(a, b, obstacles)
  var vertical = sides.vertical
  var p0 = portPointOf(a, sides.a, pA)
  var p1 = portPointOf(b, sides.b, pB)
  // 「端口倒挂」（出点反而落在入点之后）从前靠一段 `inverted` 特判兜住，现在由
  // edgeSidesOf 的代价函数在选边阶段就排除掉 —— 自穿透与回头线都是重罚项。

  // a 和 b 自己**不**进障碍表（带 12px 余量的话会把贴着边框出发的端口段一起判成"命中"，
  // 于是每条线都被拒），但要单独做一次自穿透检查：两个方块纵向上重叠时，
  // 中位线候选会从出点往回钻、直接穿过方块自己。**只查内部段**（首末两段贴着端口，
  // 必须允许它从形状的轮廓上出发）—— 非矩形节点的锚点落在圆角/斜边上，那个点本来就在
  // 包围盒**里面**（菱形、胶囊、椭圆都是），连首段也查的话每个候选都会被拒，
  // 整条线落到不看障碍的硬穿兜底上，画出来正好穿过别的方块（复核第 1 条，实测过）。
  // 严格不等号保住「贴着边框出发」与「钻进内部」的分界。（审计第 6/7 条的地基。）
  var blockedBy = function (pts) {
    return edgePathHits(pts, obs) || edgePathHitsSelf(pts, a) || edgePathHitsSelf(pts, b)
  }

  // 一段跨越式：从出点直走 → 在某个「跨越线」上横过去 → 再直走进点。
  // 候选跨越线按「离正中越近越优先」排序；障碍的边线外侧也在候选里 —— 那让线能贴着障碍绕。
  //
  // 中位线两侧先按 EDGE_LANE_STEP 铺开若干条：这是**平行间隔**的来源。从前中位线被别的线
  // 占了也照样画上去，两条线就逐像素叠在一起（实测画布上 48 处、线距 0px）。
  var mid0 = vertical ? (p0.y + p1.y) / 2 : (p0.x + p1.x) / 2

  // 候选跨越线：以中位线为基准平滑铺开车道与避让线
  var cands = [mid0]
  for (var q = 1; q <= 3; q++) { cands.push(mid0 - q * EDGE_LANE_STEP); cands.push(mid0 + q * EDGE_LANE_STEP) }
  for (var j = 0; j < obs.length; j++) {
    if (vertical) { cands.push(obs[j].y1 - 2); cands.push(obs[j].y2 + 2) }
    else { cands.push(obs[j].x1 - 2); cands.push(obs[j].x2 + 2) }
  }
  if (vertical) cands.push(Math.min(p0.y, p1.y) - EDGE_LANE, Math.max(p0.y, p1.y) + EDGE_LANE)
  else cands.push(Math.min(p0.x, p1.x) - EDGE_LANE, Math.max(p0.x, p1.x) + EDGE_LANE)
  cands.sort(function (m, n) {
    return Math.abs(m - mid0) - Math.abs(n - mid0)
  })

  // 挑选顺序：既不撞障碍、也不压别的线 > 只不撞障碍 > 兜底
  var used = usedLanes || []
  var freeOfLane = function (pts) {
    var lanes = edgePathLanes(pts)
    for (var li = 0; li < lanes.length; li++) {
      for (var ui = 0; ui < used.length; ui++) {
        if (edgeLaneConflict(lanes[li].vert, lanes[li].c, lanes[li].lo, lanes[li].hi, used[ui])) return false
      }
    }
    return true
  }

  var best = null
  var bestAny = null
  for (var c = 0; c < cands.length; c++) {
    var m = cands[c] + shift
    var pts = vertical
      ? [{ x: p0.x, y: p0.y }, { x: p0.x, y: m }, { x: p1.x, y: m }, { x: p1.x, y: p1.y }]
      : [{ x: p0.x, y: p0.y }, { x: m, y: p0.y }, { x: m, y: p1.y }, { x: p1.x, y: p1.y }]
    if (blockedBy(pts)) continue
    if (!bestAny) bestAny = pts
    if (freeOfLane(pts)) { best = pts; break }
  }
  if (!best) best = bestAny
  // 兜底零：候选车道**再往两边扫一遍**（±10 条车道 + 每条障碍的外侧一条）。
  // 为什么要有这一层：上面那圈候选只铺到 ±3 条车道，方块挤在一起时会被全部拒掉，
  // 然后落到「兜底二」那条**不看障碍**的硬穿线上 —— 实测真图（dsh-plugin-framework）
  // 上就是这里多出了两条穿过第三方块的线。先多找几条干净的车道，实在找不到才硬穿。
  if (!best) {
    var wide = []
    for (var wq = 1; wq <= 10; wq++) { wide.push(mid0 - wq * EDGE_LANE_STEP); wide.push(mid0 + wq * EDGE_LANE_STEP) }
    for (var wz = 0; wz < obs.length; wz++) {
      if (vertical) { wide.push(obs[wz].y1 - EDGE_LANE); wide.push(obs[wz].y2 + EDGE_LANE) }
      else { wide.push(obs[wz].x1 - EDGE_LANE); wide.push(obs[wz].x2 + EDGE_LANE) }
    }
    wide.sort(function (m, n) { return Math.abs(m - mid0) - Math.abs(n - mid0) })
    var cleanOnly = null
    for (var wc = 0; wc < wide.length; wc++) {
      var mw = wide[wc] + shift
      var wpts = vertical
        ? [{ x: p0.x, y: p0.y }, { x: p0.x, y: mw }, { x: p1.x, y: mw }, { x: p1.x, y: p1.y }]
        : [{ x: p0.x, y: p0.y }, { x: mw, y: p0.y }, { x: mw, y: p1.y }, { x: p1.x, y: p1.y }]
      if (blockedBy(wpts)) continue
      if (!cleanOnly) cleanOnly = wpts
      if (freeOfLane(wpts)) { best = wpts; break }
    }
    if (!best) best = cleanOnly
  }
  // 兜底一：两段跨越式，从整片障碍的外侧绕过去（中间那条直路被完全堵死时走这条）。
  if (!best) {
    var bx1 = Math.min(a.x - a.w / 2, b.x - b.w / 2)
    var by1 = Math.min(a.y - a.h / 2, b.y - b.h / 2)
    var bx2 = Math.max(a.x + a.w / 2, b.x + b.w / 2)
    var by2 = Math.max(a.y + a.h / 2, b.y + b.h / 2)
    for (var z = 0; z < obs.length; z++) {
      bx1 = Math.min(bx1, obs[z].x1); by1 = Math.min(by1, obs[z].y1)
      bx2 = Math.max(bx2, obs[z].x2); by2 = Math.max(by2, obs[z].y2)
    }
    // 车道不只「整片外面的两条」：方块挤成一片时，那两条外侧车道往往正好卡在别的方块旁边，
    // 于是一条都走不通、直接落到硬穿。这里把**每块障碍的外侧**也当候选，按离中位线的远近排。
    var lanes = vertical ? [bx1 - EDGE_LANE, bx2 + EDGE_LANE] : [by1 - EDGE_LANE, by2 + EDGE_LANE]
    for (var lz = 0; lz < obs.length; lz++) {
      if (vertical) lanes.push(obs[lz].x1 - EDGE_LANE, obs[lz].x2 + EDGE_LANE)
      else lanes.push(obs[lz].y1 - EDGE_LANE, obs[lz].y2 + EDGE_LANE)
    }
    var laneMid = vertical ? (p0.x + p1.x) / 2 : (p0.y + p1.y) / 2
    lanes.sort(function (m, n) { return Math.abs(m - laneMid) - Math.abs(n - laneMid) })
    // 绕行折线的形状：先走一小段离开出点方块，横到外侧车道、沿车道走到另一端，再横回来进去。
    // 关键是那两条横线落在「刚离开方块」的位置，而不是落在正中 —— 落在正中时第一段
    // 就已经穿进障碍带了（这条是实测踩出来的，不是想出来的）。
    // 出点落在方块哪半边，第一步就往哪边走；入点落在哪半边，最后一步就从那一侧绕进去。
    // 从前这两个符号是按 p1 与 p0 的先后推的 —— 端口一旦倒挂（见上面那个 inverted）
    // 就会推出反号，绕行折线的第一步直接**缩进方块自己身体里**。（审计第 7 条。）
    var sy = (p0.y >= a.y) ? 1 : -1
    var ey = (p1.y >= b.y) ? 1 : -1
    var sx = (p0.x >= a.x) ? 1 : -1
    var ex = (p1.x >= b.x) ? 1 : -1
    for (var s = 0; s < lanes.length && !best; s++) {
      // 车道本身要带上 shift，否则同一对节点之间的多条线会算出**逐字节相同**的绕行路径。
      var lane = lanes[s] + shift
      var detour = vertical
        ? [{ x: p0.x, y: p0.y }, { x: p0.x, y: p0.y + sy * EDGE_LANE }, { x: lane, y: p0.y + sy * EDGE_LANE },
           { x: lane, y: p1.y + ey * EDGE_LANE }, { x: p1.x, y: p1.y + ey * EDGE_LANE }, { x: p1.x, y: p1.y }]
        : [{ x: p0.x, y: p0.y }, { x: p0.x + sx * EDGE_LANE, y: p0.y }, { x: p0.x + sx * EDGE_LANE, y: lane },
           { x: p1.x + ex * EDGE_LANE, y: lane }, { x: p1.x + ex * EDGE_LANE, y: p1.y }, { x: p1.x, y: p1.y }]
      if (!blockedBy(detour)) best = detour
    }
  }
  // 兜底二：还是不行就直接跨越。画布上一根线消失比画得难看严重得多，所以绝不返回 null。
  if (!best) {
    var mf = mid0 + shift
    best = vertical
      ? [{ x: p0.x, y: p0.y }, { x: p0.x, y: mf }, { x: p1.x, y: mf }, { x: p1.x, y: p1.y }]
      : [{ x: p0.x, y: p0.y }, { x: mf, y: p0.y }, { x: mf, y: p1.y }, { x: p1.x, y: p1.y }]
  }
  var clean = edgeCleanPath(best)
  // pts 交给调用方：交叉检测（拱桥）与「这条线占掉哪些车道」都要按尖角折线算。
  return { d: clean.d, mid: edgeMidOfPath(clean.pts), pts: clean.pts, lanes: edgePathLanes(clean.pts) }
}

function cloneModel(m) {
  return JSON.parse(JSON.stringify(m))
}

// ==================== 图标 ====================
function ArchIcon(props) {
  var s = props && typeof props.size === 'number' ? props.size : 18
  return React.createElement('svg', { width: s, height: s, viewBox: '0 0 20 20', fill: 'none', 'aria-hidden': 'true', style: { flex: '0 0 auto' } },
    React.createElement('rect', { x: 1.5, y: 1.5, width: 7, height: 5.5, rx: 1.5, stroke: 'currentColor', strokeWidth: 1.4 }),
    React.createElement('rect', { x: 11.5, y: 1.5, width: 7, height: 5.5, rx: 1.5, stroke: 'currentColor', strokeWidth: 1.4 }),
    React.createElement('rect', { x: 6.5, y: 13, width: 7, height: 5.5, rx: 1.5, stroke: 'currentColor', strokeWidth: 1.4 }),
    React.createElement('path', { d: 'M5 7v3h10V7M10 10v3', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
  )
}

// ==================== 导出 ====================
// 导出用独立的字面色板：画布本身靠 --dsw-alias-* 变量，导出的 SVG 里没有主题上下文，
// 而且贴进文档通常是浅底。所以这里白底墨线，与面板内的观感无关。
var EXPORT_CSS = [
  '.ac-shape{fill:#ffffff;stroke:#4a5568;stroke-width:1.5}',
  '.ac-node.sel .ac-shape{stroke:#4a5568;stroke-width:1.5}',
  '.ac-lbl{fill:#1a202c;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-size:13px;font-weight:600;text-anchor:middle;dominant-baseline:central}',
  '.ac-desc{fill:#718096;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-size:11.5px;text-anchor:middle;dominant-baseline:central}',
  '.ac-desc .ac-intent{fill:#2b6cb0}',
  '.ac-desc .ac-rationale{fill:#6b46c1}',
  '.ac-ref{fill:#a0aec0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-size:10px;text-anchor:middle;dominant-baseline:central}',
  '.ac-edge{fill:none;stroke:#718096;stroke-width:1.6}',
  '.ac-edge.dashed{stroke-dasharray:6 5}',
  '.ac-arrowhead{fill:#718096}',
  '.ac-elbl{fill:#4a5568;font-size:11.5px;text-anchor:middle;dominant-baseline:central}',
  '.ac-elbl-bg{fill:#ffffff}',
  '.ac-group-box{fill:#f2f6fa;stroke:#7b8794;stroke-dasharray:5 5;stroke-width:1.4}',
  '.ac-group-lbl{fill:#4a5568;font-size:11.5px;font-weight:600}',
  // 组配色：与屏幕同一套色相，这里写字面值（导出件没有主题上下文，取不到变量）。
  // 白的底上用的是浅色那一列：每一档对白底 ≈4.5:1，实测见 runtime.ts 里屏幕那一段的注释。
  '.ac-h0 .ac-shape,.ac-h0 .ac-group-box,.ac-h0 .ac-fold-box{stroke:#c238c2}',
  '.ac-h0 .ac-group-box,.ac-h0 .ac-fold-box{fill:#c238c2;fill-opacity:.13}',
  '.ac-h0 .ac-group-lbl,.ac-h0 .ac-fold-lbl{fill:#c238c2}',
  '.ac-h1 .ac-shape,.ac-h1 .ac-group-box,.ac-h1 .ac-fold-box{stroke:#ca4772}',
  '.ac-h1 .ac-group-box,.ac-h1 .ac-fold-box{fill:#ca4772;fill-opacity:.13}',
  '.ac-h1 .ac-group-lbl,.ac-h1 .ac-fold-lbl{fill:#ca4772}',
  '.ac-h2 .ac-shape,.ac-h2 .ac-group-box,.ac-h2 .ac-fold-box{stroke:#c94f43}',
  '.ac-h2 .ac-group-box,.ac-h2 .ac-fold-box{fill:#c94f43;fill-opacity:.13}',
  '.ac-h2 .ac-group-lbl,.ac-h2 .ac-fold-lbl{fill:#c94f43}',
  '.ac-h3 .ac-shape,.ac-h3 .ac-group-box,.ac-h3 .ac-fold-box{stroke:#91732a}',
  '.ac-h3 .ac-group-box,.ac-h3 .ac-fold-box{fill:#91732a;fill-opacity:.13}',
  '.ac-h3 .ac-group-lbl,.ac-h3 .ac-fold-lbl{fill:#91732a}',
  '.ac-h4 .ac-shape,.ac-h4 .ac-group-box,.ac-h4 .ac-fold-box{stroke:#27864f}',
  '.ac-h4 .ac-group-box,.ac-h4 .ac-fold-box{fill:#27864f;fill-opacity:.13}',
  '.ac-h4 .ac-group-lbl,.ac-h4 .ac-fold-lbl{fill:#27864f}',
  '.ac-h5 .ac-shape,.ac-h5 .ac-group-box,.ac-h5 .ac-fold-box{stroke:#268478}',
  '.ac-h5 .ac-group-box,.ac-h5 .ac-fold-box{fill:#268478;fill-opacity:.13}',
  '.ac-h5 .ac-group-lbl,.ac-h5 .ac-fold-lbl{fill:#268478}',
  '.ac-h6 .ac-shape,.ac-h6 .ac-group-box,.ac-h6 .ac-fold-box{stroke:#377abc}',
  '.ac-h6 .ac-group-box,.ac-h6 .ac-fold-box{fill:#377abc;fill-opacity:.13}',
  '.ac-h6 .ac-group-lbl,.ac-h6 .ac-fold-lbl{fill:#377abc}',
  '.ac-h7 .ac-shape,.ac-h7 .ac-group-box,.ac-h7 .ac-fold-box{stroke:#8e5ed0}',
  '.ac-h7 .ac-group-box,.ac-h7 .ac-fold-box{fill:#8e5ed0;fill-opacity:.13}',
  '.ac-h7 .ac-group-lbl,.ac-h7 .ac-fold-lbl{fill:#8e5ed0}',
  '.ac-fold-box{fill:#ebf4ff;stroke:#4c8dff;stroke-width:1.5}',
  '.ac-fold-lbl{fill:#1a202c;font-size:12.5px;text-anchor:middle;dominant-baseline:central}',
  '.ac-fold-btn circle,.ac-group-btn circle{fill:#4c8dff;stroke:#ffffff;stroke-width:1.5}',
  '.ac-fold-btn text,.ac-group-btn text{fill:#fff;font-size:10px;text-anchor:middle}',
].join('')

// 把画布内容做成一张独立的、自解释的 SVG。
// 只取 .ac-world 的子内容 —— 它那层 translate/scale 是视口变换，导出不要；
// 裁剪交给 viewBox（内容坐标与 box 同一坐标系，所以对得上）。
// 必须自带 marker 定义的 <defs>，保证连线箭头独立自包含、不丢箭头。
function buildExportSvg(worldNode, box) {
  var clone = worldNode.cloneNode(true)
  // 导出的是**结构**，不是面板：交互手柄、吸附线、脉动环、以及三个角标
  // （留言 ✎ / 锚点 ▤ / 下钻 ↗）全是界面装饰。它们从前既没被剔掉、EXPORT_CSS 里也没有
  // 对应规则 —— 而导出的 SVG 是一份脱离主题的独立文档，circle/text 缺省就是纯黑，
  // 于是节点角上会出现一坨黑斑。（2026-09-20 客户端逻辑审计第 4 条。）
  // `.ac-edge-hit` 是连线的**命中区**（透明、宽 14 的描边）—— 也是界面装饰，导出时一并剔掉。
  // 从前它既不在这张表里、EXPORT_CSS 里也没有规则，而 path 的缺省 fill 是**纯黑**：
  // 导出的 SVG/PNG 里每条折线旁边都多出一块黑（栅格化实测 7230 个纯黑像素，加一条规则后 0）。
  // 2026-09-24 客户端审计第 3 条 —— 与上面角标黑斑是同一类，只是漏了这个元素。
  var drop = ['.ac-handle', '.ac-link-preview', '.ac-pulse', '.ac-snapline', '.ac-note-badge', '.ac-file-badge', '.ac-jump', '.ac-edge-hit']
  for (var i = 0; i < drop.length; i++) {
    var hits = clone.querySelectorAll(drop[i])
    for (var j = 0; j < hits.length; j++) hits[j].parentNode.removeChild(hits[j])
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + box.w + '" height="' + box.h + '"'
    + ' viewBox="' + box.x + ' ' + box.y + ' ' + box.w + ' ' + box.h + '">'
    + '<defs>'
    + '<marker id="ac-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
    + '<path d="M 0 0 L 10 5 L 0 10 z" class="ac-arrowhead" fill="#718096"/>'
    + '</marker>'
    + '</defs>'
    + '<style>' + EXPORT_CSS + '</style>'
    + '<rect x="' + box.x + '" y="' + box.y + '" width="' + box.w + '" height="' + box.h + '" fill="#ffffff"/>'
    + clone.innerHTML
    + '</svg>'
}

// SVG 串 → PNG。走 <img> 载 data/blob URL，所以 SVG 里不能有外部引用（已保证）。
function svgToPngBlob(svgText, w, h, scale) {
  return new Promise(function (resolve, reject) {
    var url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }))
    var img = new Image()
    img.onload = function () {
      try {
        var canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(w * scale))
        canvas.height = Math.max(1, Math.round(h * scale))
        var c2 = canvas.getContext('2d')
        c2.fillStyle = '#ffffff'
        c2.fillRect(0, 0, canvas.width, canvas.height)
        c2.setTransform(scale, 0, 0, scale, 0, 0)
        c2.drawImage(img, 0, 0)
        URL.revokeObjectURL(url)
        canvas.toBlob(function (b) {
          if (b) resolve(b)
          else reject(new Error('canvas.toBlob 返回空'))
        }, 'image/png')
      } catch (e) {
        URL.revokeObjectURL(url)
        reject(e)
      }
    }
    img.onerror = function () {
      URL.revokeObjectURL(url)
      reject(new Error('SVG 转图片失败'))
    }
    img.src = url
  })
}

function downloadBlob(name, blob) {
  var url = URL.createObjectURL(blob)
  var a = document.createElement('a')
  a.href = url
  a.download = name
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  try {
    ctxTimeout(function () { URL.revokeObjectURL(url) }, 8000)
  } catch (e) {}
}

// ==================== 定时器 ====================
// 客户端 Cordis 里 `timer` 是可选的：真插件形态**刻意不把它写进 inject**
// （声明了而部署里没有，插件会永远 park —— 侧栏里什么都不出现，还不报错）。
//
// 但「不 inject」不等于「可以直接读属性」：Cordis 对未 inject 的服务是**抛错**而不是给 undefined，
// 所以 `typeof PLUGIN_CTX.interval === 'function'` 会直接抛
// `cannot get property "timer" without inject`，兜底分支根本没机会跑 —— 面板一渲染就崩，一片空白。
// 正确的姿势是 `ctx.get('timer')`（可选取用，拿不到给 undefined），拿不到再退回原生定时器。
// 真插件形态里这段代码不在沙箱内，原生定时器可用；动态形态 inject 了 timer，走不到兜底。
function timerService() {
  if (!PLUGIN_CTX || typeof PLUGIN_CTX.get !== 'function') return null
  try {
    return PLUGIN_CTX.get('timer') || null
  } catch (e) {
    return null
  }
}

function ctxTimeout(fn: () => void, ms: number): () => void {
  var timer = timerService()
  if (timer && typeof timer.timeout === 'function') return timer.timeout(fn, ms)
  var id = globalThis.setTimeout(fn, ms)
  return function () { globalThis.clearTimeout(id) }
}

function ctxInterval(fn: () => void, ms: number): () => void {
  var timer = timerService()
  if (timer && typeof timer.interval === 'function') return timer.interval(fn, ms)
  var id = globalThis.setInterval(fn, ms)
  return function () { globalThis.clearInterval(id) }
}

