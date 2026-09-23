// 连线几何的守门断言：**选边**（端口落在哪条边上）与**落点**（锚点落在轮廓上哪个点）。
//
// 为什么单独一个文件、还要读 dist/：这两个函数住在 lib/ui.js 的闭包里，测试够不着。
// tools/build.mjs 会把 src/client/runtime.ts 单独出一份 dist/client-runtime.js，
// 这里读的就是**当前构建**的那份真身 —— 与 layout.test.cjs 同一个理由，不抄副本。
//
// 这层以前没有守门人：选边规则（|dy| >= |dx| 就走竖轴）与落点（一律落在包围盒上）
// 都只被 UI 冒烟测试间接照到一点。2026-09-23 重写这两块时补上 —— 否则「菱形上的箭头
// 悬在方块外面 24px」这类问题只能靠人眼看出来。
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'dist', 'client-runtime.js');
if (!fs.existsSync(FILE)) {
  console.error('缺少 ' + FILE + ' —— 先跑 npm run build');
  process.exit(1);
}
const src = fs.readFileSync(FILE, 'utf8');
const api = new Function(src + '\n;return {'
  + ' edgeGeometry: edgeGeometry, edgeSidesOf: edgeSidesOf, perimeterPoint: perimeterPoint,'
  + ' kindOf: kindOf, nodeSize: nodeSize, edgePortOffset: edgePortOffset, edgePathHits: edgePathHits,'
  + ' edgeGaps: edgeGaps, EDGE_PAD: EDGE_PAD };')();
const { edgeGeometry, edgeSidesOf, perimeterPoint, kindOf, nodeSize, edgePathHits } = api;

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}
const eq = (name, got, want) => ok(name, got === want, { got, want });

// ---------- 独立的「点到形状轮廓的距离」实现（**故意不复用生产代码的公式**） ----------
function segDist(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay;
  const L2 = vx * vx + vy * vy;
  let t = L2 ? ((px - ax) * vx + (py - ay) * vy) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  const dx = px - (ax + vx * t), dy = py - (ay + vy * t);
  return Math.sqrt(dx * dx + dy * dy);
}
function hexPts(g) {
  const x0 = g.x - g.w / 2, y0 = g.y - g.h / 2;
  return [
    [x0 + 14, y0], [x0 + g.w - 14, y0], [x0 + g.w, g.y],
    [x0 + g.w - 14, y0 + g.h], [x0 + 14, y0 + g.h], [x0, g.y],
  ];
}
function insideHex(g, p) {
  const pts = hexPts(g);
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a[1] > p.y) !== (b[1] > p.y) && p.x < ((b[0] - a[0]) * (p.y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
/**
 * 点到形状**可见轮廓**的**有符号**距离：0 = 正好在轮廓上，正 = 悬在外面，负 = 埋在形状里。
 * 一定要有符号 —— 只测「离轮廓多远」的话，锚点缩到方块正中间也会算 0 距离，
 * 那正好是这条断言要抓的错（六边形左右两侧的公式一度把两个半长写反了，锚点落在里面 40px）。
 */
function outlineSD(p, g, kind) {
  const a = g.w / 2, b = g.h / 2;
  const dx = p.x - g.x, dy = p.y - g.y;
  if (kind === 'diamond') {
    return (Math.abs(dx) / a + Math.abs(dy) / b - 1) * (a * b) / Math.hypot(a, b);
  }
  if (kind === 'ellipse') {
    return (Math.hypot(dx / a, dy / b) - 1) * Math.min(a, b);
  }
  if (kind === 'hex') {
    const pts = hexPts(g);
    let best = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const q = pts[(i + 1) % pts.length];
      best = Math.min(best, segDist(p.x, p.y, pts[i][0], pts[i][1], q[0], q[1]));
    }
    return insideHex(g, p) ? -best : best;
  }
  const rx = kind === 'rect' ? 9 : Math.min(a, b);
  const coreX = Math.max(Math.abs(dx) - (a - rx), 0);
  const coreY = Math.max(Math.abs(dy) - (b - rx), 0);
  return Math.hypot(coreX, coreY) - rx;
}
const routeLen = (pts) => {
  let L = 0;
  for (let i = 0; i + 1 < pts.length; i++) L += Math.abs(pts[i + 1].x - pts[i].x) + Math.abs(pts[i + 1].y - pts[i].y);
  return L;
};
const sideCenter = (g, s) => s === 't' ? { x: g.x, y: g.y - g.h / 2 }
  : s === 'b' ? { x: g.x, y: g.y + g.h / 2 }
  : s === 'l' ? { x: g.x - g.w / 2, y: g.y } : { x: g.x + g.w / 2, y: g.y };
const inside = (g, p) => Math.abs(p.x - g.x) < g.w / 2 && Math.abs(p.y - g.y) < g.h / 2;

console.log('\n[1] 落点必须落在**可见轮廓**上（不是包围盒）');
{
  const A = { x: 0, y: 0, w: 140, h: 60 };
  // 竖着摆（走上下边）与横着摆（走左右边）都要测：六边形的左右两侧**不是边而是两个顶点**，
  // 上下边才有一段直边 —— 只测一个方向的话，另一条分支写错了也看不出来（这里踩过一次）。
  const PAIRS = [
    { name: '竖轴（上下边）', B: { x: 0, y: 320, w: 140, h: 60 } },
    { name: '横轴（左右边）', B: { x: 320, y: 0, w: 140, h: 60 } },
  ];
  const KINDS = ['rect', 'round', 'stadium', 'circle', 'diamond', 'cyl', 'hex', 'sub'];
  let worst = 0, worstAt = null;
  for (const pair of PAIRS) {
    const B = pair.B;
    for (const shape of KINDS) {
      const kind = kindOf(shape);
      for (let n = 1; n <= 4; n++) {
        for (let i = 0; i < n; i++) {
          const ga = Object.assign({ shape: shape }, A);
          const geo = edgeGeometry(ga, Object.assign({ shape: 'rect' }, B), [], 0, { a: { n: n, i: i } }, []);
          const d = Math.abs(outlineSD(geo.pts[0], A, kind));
          if (d > worst) { worst = d; worstAt = { pair: pair.name, shape: shape, n: n, i: i, d: +d.toFixed(2), p: geo.pts[0] }; }
        }
      }
    }
  }
  ok('两种摆放 × 8 种形状 × 一侧 1~4 条线：锚点离轮廓都 < 0.5px（实测最差 ' + worst.toFixed(2) + 'px）',
    worst < 0.5, worstAt);
  // 负向对照：这条断言必须真的在测东西 —— 同一个锚点按**包围盒**算就是悬空的。
  const B = PAIRS[0].B;
  const diamondA = Object.assign({ shape: 'diamond' }, A);
  const geo2 = edgeGeometry(diamondA, Object.assign({ shape: 'rect' }, B), [], 0, { a: { n: 2, i: 0 } }, []);
  const bboxPoint = { x: geo2.pts[0].x, y: A.y + A.h / 2 };   // 旧实现给的就是这个点
  const bboxOff = Math.abs(outlineSD(bboxPoint, A, 'diamond'));
  ok('负向对照：同一个锚点按包围盒算离菱形轮廓 > 20px（所以上一条不是空转）', bboxOff > 20, +bboxOff.toFixed(1));
  // 有符号距离本身要有牙：方块正中间的点必须报「埋在形状里」
  const deep = outlineSD({ x: 0, y: 0 }, A, 'hex');
  ok('负向对照：六边形正中间的点算出来是「埋在形状里」（有符号距离 < -20）', deep < -20, +deep.toFixed(1));
  // 端口不许越过方块边界（矮节点挤 4 条线时最容易踩）
  const tiny = Object.assign({ shape: 'rect' }, { x: 0, y: 0, w: 40, h: 30 });
  let over = 0;
  for (let i = 0; i < 4; i++) {
    const geo = edgeGeometry(tiny, Object.assign({ shape: 'rect' }, B), [], 0, { a: { n: 4, i: i } }, []);
    if (Math.abs(geo.pts[0].x) > 20.01) over++;
  }
  eq('40px 宽的方块一侧挤 4 条线：锚点一个都不越界', over, 0);
}

console.log('\n[2] 选边：朝对端的那条边 + 折线更短的那条轴');
{
  const mk = (x, y, w, h) => ({ x: x, y: y, w: w || 104, h: h || 45 });
  const s1 = edgeSidesOf(mk(0, 0), mk(0, 400));
  eq('上下堆叠 → 出下边、进上边', s1.a + s1.b, 'bt');
  eq('上下堆叠 → 竖轴', s1.vertical, true);
  const s2 = edgeSidesOf(mk(0, 0), mk(400, 0));
  eq('左右并排 → 出右边、进左边', s2.a + s2.b, 'rl');
  eq('左右并排 → 横轴', s2.vertical, false);
  // 斜着摆：两条轴都开着时，选**折线更短**的那条（旧规则只看中心差，会选错）
  const A = mk(0, 0), B = mk(200, 400);
  const s3 = edgeSidesOf(A, B);
  const vLen = routeLen([sideCenter(A, 'b'), sideCenter(B, 't')]);
  const hLen = routeLen([sideCenter(A, 'r'), sideCenter(B, 'l')]);
  eq('斜着摆（都开着）→ 选更短的那条轴', s3.vertical ? 'v' : 'h', vLen <= hLen ? 'v' : 'h');
  // 一条轴开着、另一条叠着：别为了省几十像素从叠着的那条轴背后绕出去
  // （-60 与 104 宽的方块在 x 上重叠 44px，纵向上却隔着 355px）
  const s4 = edgeSidesOf(mk(0, 0), mk(-60, -400));
  eq('一条轴开着、另一条重叠 → 走开着的那条轴（竖轴）', s4.vertical, true);
  const gp4 = api.edgeGaps(A, mk(-60, -400));
  ok('负向对照：这一对在横轴上确实是重叠的（' + gp4.l.toFixed(0) + 'px）', gp4.l < 0, gp4);
}

console.log('\n[3] 不变量：420 个相对位置上，「白绕」与「从背后出线」都要近乎为零');
{
  // 与旧规则（只看中心差）在同一批样本上对照 —— 旧规则的数字留在注释里：
  // 平均多绕 24.8px、26.7% 的位置多绕 40px 以上、回头线 2.7%。
  const sides = ['t', 'b', 'l', 'r'];
  const bestSameAxis = (a, b) => {
    let best = Infinity;
    for (const sa of sides) for (const sb of sides) {
      const axA = sa === 'l' || sa === 'r', axB = sb === 'l' || sb === 'r';
      if (axA !== axB) continue;
      const p = sideCenter(a, sa), q = sideCenter(b, sb);
      if (inside(b, p) || inside(a, q)) continue;
      best = Math.min(best, Math.abs(q.x - p.x) + Math.abs(q.y - p.y));
    }
    return best;
  };
  const oldRule = (a, b) => (Math.abs(b.y - a.y) >= Math.abs(b.x - a.x) ? { vertical: true } : { vertical: false });
  let cases = 0, sumEx = 0, worstEx = 0, uTurn = 0, backSide = 0, oldSumEx = 0;
  for (let dx = -400; dx <= 400; dx += 40) {
    for (let dy = -400; dy <= 400; dy += 40) {
      if (dx === 0 && dy === 0) continue;
      const a = { x: 0, y: 0, w: 140, h: 60 };
      const b = { x: dx, y: dy, w: 140, h: 60 };
      if (Math.abs(dx) < 140 && Math.abs(dy) < 60) continue;
      const best = bestSameAxis(a, b);
      if (!isFinite(best)) continue;
      const geo = edgeGeometry(a, b, [], 0, null, []);
      const got = routeLen(geo.pts);
      cases++;
      sumEx += got - best;
      worstEx = Math.max(worstEx, got - best);
      // 旧规则在同一对上的折线长度（用它自己的选边，再按「两端同轴」估）
      const ov = oldRule(a, b).vertical;
      const op = ov ? sideCenter(a, dy >= 0 ? 'b' : 't') : sideCenter(a, dx >= 0 ? 'r' : 'l');
      const oq = ov ? sideCenter(b, dy >= 0 ? 't' : 'b') : sideCenter(b, dx >= 0 ? 'l' : 'r');
      oldSumEx += Math.abs(oq.x - op.x) + Math.abs(oq.y - op.y) - best;
      const p0 = geo.pts[0], p1 = geo.pts[1];
      if ((p1.x - p0.x) * (b.x - a.x) + (p1.y - p0.y) * (b.y - a.y) < -1) uTurn++;
      const gp = api.edgeGaps(a, b);
      const facing = [];
      if (gp.r >= 0) facing.push('r');
      if (gp.l >= 0) facing.push('l');
      if (gp.b >= 0) facing.push('b');
      if (gp.t >= 0) facing.push('t');
      const sd = Math.abs(p0.x - a.x) >= a.w / 2 - 0.5 ? (p0.x > a.x ? 'r' : 'l') : (p0.y > a.y ? 'b' : 't');
      if (facing.length && facing.indexOf(sd) < 0) backSide++;
    }
  }
  ok('样本够多', cases >= 400, cases);
  ok('平均白绕 < 6px（旧规则 ' + (oldSumEx / cases).toFixed(1) + 'px）', sumEx / cases < 6, +(sumEx / cases).toFixed(2));
  ok('最差白绕 ≤ 60px（旧规则最差 80px）', worstEx <= 60, +worstEx.toFixed(1));
  eq('一条回头线都没有', uTurn, 0);
  eq('出点不在朝向对端的边上：0 次', backSide, 0);
  // 负向对照：同一批样本上，旧规则必须明显更差 —— 否则这节测不出「选边变聪明了」。
  ok('负向对照：旧规则在同一批样本上白绕 > 15px', oldSumEx / cases > 15, +(oldSumEx / cases).toFixed(1));
}

console.log('\n[4] 避障与边界');
{
  // 中间横着一个方块：直路被挡，折线必须绕开
  const a = { x: 0, y: 0, w: 100, h: 50, shape: 'rect' };
  const b = { x: 0, y: 400, w: 100, h: 50, shape: 'rect' };
  const mid = { x: 0, y: 200, w: 300, h: 60, shape: 'rect' };
  const obs = [{ x1: mid.x - mid.w / 2 - 12, y1: mid.y - mid.h / 2 - 12, x2: mid.x + mid.w / 2 + 12, y2: mid.y + mid.h / 2 + 12 }];
  const geo = edgeGeometry(a, b, [mid], 0, null, []);
  ok('中间挡着方块时仍然画得出来', !!geo && geo.pts.length >= 2);
  ok('折线不穿过中间那个方块', !edgePathHits(geo.pts, obs), geo.pts);
  // 负向对照：同一个位置、没有障碍时，中位线本来就是直的（说明上面那条不是「绕远必然成立」）
  const geo2 = edgeGeometry(a, b, [], 0, null, []);
  ok('负向对照：没有障碍时就是一条直上直下的线', geo2.pts.every((p) => Math.abs(p.x - a.x) < 0.01), geo2.pts);

  eq('自环：a === b 时给一条绕出去的回路', edgeGeometry(a, a, [], 0, null, []).pts.length >= 4, true);
  eq('几何缺失时返回 null', edgeGeometry(null, b, [], 0, null, []), null);
  // 几何里没有 shape（老调用）→ 按矩形处理，仍然是合法折线
  const geo3 = edgeGeometry({ x: 0, y: 0, w: 100, h: 50 }, b, [], 0, null, []);
  ok('几何不带 shape 也能出线（按矩形）', !!geo3 && geo3.pts.length >= 2);
  // 端口位次缺失 / 单条线：偏移为 0，落点就是边心
  const one = edgeGeometry(a, b, [], 0, null, []);
  ok('单条线落在边心', Math.abs(one.pts[0].x - a.x) < 0.01 && Math.abs(one.pts[0].y - (a.y + a.h / 2)) < 0.01, one.pts[0]);
  const p = perimeterPoint({ x: 0, y: 0, w: 100, h: 50 }, 'rect', 'b', 0);
  ok('perimeterPoint 直接调用也自洽（矩形底边中心）', Math.abs(p.x) < 0.01 && Math.abs(p.y - 25) < 0.01, p);
}

console.log('\n[5] 非矩形节点 + 多个端口：整条路既不能穿别人，也不能穿自己');
{
  // 这是复核抓到的高危缺陷的回归闸门：锚点投到**轮廓**上之后，落点落在包围盒内部
  // （圆角/斜边本来就在盒子里），而自穿透检查若拿包围盒当判据，每条候选都会被判成「撞自己」，
  // 于是整条线落到不看障碍的硬穿兜底上 —— 画出来正好穿过中间的方块。
  // 实测（修之前）：8 种形状 × 2 个端口全部穿透；修之后 0 例。
  const mid = { x: 0, y: 200, w: 300, h: 60, shape: 'rect' };
  const midBox = { x1: -150, y1: 170, x2: 150, y2: 230 };
  // 「自己」不能用包围盒判 —— 非矩形节点的锚点本来就落在包围盒**里面**（轮廓上）。
  // 这里按有符号距离采样：线段上有点埋进形状超过 1px 才算穿自己。
  const cutsNode = (pts, g, kind) => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const L = Math.abs(pts[i + 1].x - pts[i].x) + Math.abs(pts[i + 1].y - pts[i].y);
      const steps = Math.max(2, Math.min(60, Math.ceil(L / 4)));
      for (let k = 1; k < steps; k++) {
        const t = k / steps;
        const p = { x: pts[i].x + (pts[i + 1].x - pts[i].x) * t, y: pts[i].y + (pts[i + 1].y - pts[i].y) * t };
        if (outlineSD(p, g, kind) < -1) return true;
      }
    }
    return false;
  };
  ok('负向对照：采样判据能认出「埋进形状里」的线段',
    cutsNode([{ x: -40, y: 0 }, { x: 40, y: 0 }], { x: 0, y: 0, w: 140, h: 60 }, 'ellipse') === true);
  let bad = 0, badAt = null;
  for (const shape of ['rect', 'round', 'stadium', 'cyl', 'diamond', 'hex', 'sub', 'circle']) {
    const kind = kindOf(shape);
    for (let n = 1; n <= 4; n++) {
      for (let i = 0; i < n; i++) {
        const a = { x: 0, y: 0, w: 140, h: 60, shape: shape };
        const b = { x: 0, y: 400, w: 140, h: 60, shape: shape };
        const geo = edgeGeometry(a, b, [mid], 0, { a: { n: n, i: i } }, []);
        if (!geo || edgePathHits(geo.pts, [midBox]) || cutsNode(geo.pts, a, kind) || cutsNode(geo.pts, b, kind)) {
          bad++; if (!badAt) badAt = { shape: shape, n: n, i: i, pts: geo && geo.pts };
        }
      }
    }
  }
  eq('8 种形状 × 一侧 1~4 条线：既不穿中间的方块、也不穿自己（128 例）', bad, 0);
  if (badAt) console.log('     ', JSON.stringify(badAt));
  // 负向对照：同样的几何，把「自己」当矩形（用包围盒判自穿透）就会退化成硬穿 —— 证明这条断言有牙
  const dd = { x: 0, y: 0, w: 140, h: 60, shape: 'diamond' };
  const db = { x: 0, y: 400, w: 140, h: 60, shape: 'diamond' };
  const gRound = edgeGeometry(dd, db, [mid], 0, { a: { n: 2, i: 0 } }, []);
  const p0 = perimeterPoint(dd, 'diamond', 'b', -62);
  ok('负向对照：菱形这个锚点确实在包围盒内部（所以「拿包围盒判自穿透」必错）',
    Math.abs(p0.x) < 70 && Math.abs(p0.y) < 30, p0);
  ok('而整条路仍然是干净的（绕行到侧面进去，不是硬穿）', !edgePathHits(gRound.pts, [midBox]), gRound.pts);

  // 两个方块完全重合时不许退化成一个点（连点两次「＋ 节点」就会这样）
  const same = { x: 100, y: 130, w: 104, h: 45, shape: 'rect' };
  const gSame = edgeGeometry(same, Object.assign({}, same), [], 0, null, []);
  ok('两个方块完全重合：仍然是一条看得见的线（≥2 个折点，不是 M x y 一个点）',
    gSame.pts.length >= 2 && Math.hypot(gSame.pts[gSame.pts.length - 1].x - gSame.pts[0].x, gSame.pts[gSame.pts.length - 1].y - gSame.pts[0].y) > 1,
    gSame.pts);
}

console.log('\n[6] 平行间隔：后来者必须让开车道（含负向对照）');
{
  // 两条线的中位线本来是同一条，横向跨度完全重叠 —— 没有间隔算法时它们会画成同一条线。
  // 这里直接喂 usedLanes，不经过界面：断言「让道」这件事本身。
  const a1 = { x: 0, y: 0, w: 104, h: 45, shape: 'rect' };
  const b1 = { x: 40, y: 500, w: 104, h: 45, shape: 'rect' };
  const a2 = { x: 20, y: 1000, w: 104, h: 45, shape: 'rect' };
  const b2 = { x: 60, y: -500, w: 104, h: 45, shape: 'rect' };
  const laneY = (pts) => {
    let best = null, len = -1;
    for (let i = 0; i + 1 < pts.length; i++) {
      if (Math.abs(pts[i].y - pts[i + 1].y) > 0.5) continue;
      const L = Math.abs(pts[i + 1].x - pts[i].x);
      if (L > len) { len = L; best = pts[i].y; }
    }
    return best;
  };
  const one = edgeGeometry(a1, b1, [], 0, null, []);
  const twoFree = edgeGeometry(a2, b2, [], 0, null, []);
  eq('负向对照：不给前一条的车道时，两条线落在同一个 y 上（所以下面那条不是白测）',
    laneY(one.pts), laneY(twoFree.pts));
  const two = edgeGeometry(a2, b2, [], 0, null, one.lanes);
  ok('给上前一条的车道之后，后来者让开了 ≥10px',
    Math.abs(laneY(two.pts) - laneY(one.pts)) >= 10, { first: laneY(one.pts), second: laneY(two.pts) });
  ok('让开的那条仍然是干净的 Z（不是靠绕远让开的）', two.pts.length === 4, two.pts);
}

console.log('\n[7] 真实节点尺寸下也不越界（nodeSize 与落点共用同一套尺寸）');
{
  const s = nodeSize('上下文注入', 0);
  const a = { x: 0, y: 0, w: s.w, h: s.h, shape: 'round' };
  const b = { x: 0, y: 400, w: s.w, h: s.h, shape: 'rect' };
  let bad = 0, worst = 0;
  for (let i = 0; i < 4; i++) {
    const geo = edgeGeometry(a, b, [], 0, { a: { n: 4, i: i } }, []);
    const d = Math.abs(outlineSD(geo.pts[0], a, 'round'));
    worst = Math.max(worst, d);
    if (d > 0.5) bad++;
  }
  eq('中文标签节点（' + s.w + '×' + s.h + '）一侧 4 条线：都贴在胶囊轮廓上', bad, 0);
  ok('最差偏差 ' + worst.toFixed(2) + 'px', worst < 0.5);
}

console.log('\n[8] 端口分组与布线器必须问同一个 edgeSidesOf（带障碍的那一份）');
{
  // 客户端审计第 2 条：studio 的端口分组交的是 `edgeSidesOf(ga2, gb2, visList)`（带障碍），
  // 而 edgeGeometry 内部从前是 `edgeSidesOf(a, b)`（不交障碍）—— 两条路选出的侧会分叉：
  // 端口按一侧均分、线却从另一侧出去；更坏的是布线器会选中代价函数刚判过「这条轴走不通」的
  // 那条轴，候选车道全被拒、落到硬穿兜底，画出一条穿过第三方方块的线。
  //
  // 这里的几何就是审计给出的见证（A 104x45 在原点、B 60x120、障碍 -100,50 220x44）：
  //   带障碍：{a:'r',b:'l',vertical:false} → 路径 [(52,0),(30,0),(30,120),(8,120)] 不穿
  //   不交障碍：{a:'b',b:'t',vertical:true} → 路径 [(0,22.5),(0,60),(60,60),(60,97.5)] 穿过
  const padBox = (o) => ({
    x1: o.x - o.w / 2 - api.EDGE_PAD, y1: o.y - o.h / 2 - api.EDGE_PAD,
    x2: o.x + o.w / 2 + api.EDGE_PAD, y2: o.y + o.h / 2 + api.EDGE_PAD,
  });
  // 端点落在节点的哪条边上。容差 0.5px：rect 单端口就落在边心上，不用管轮廓那套。
  const sideOfPoint = (g, p) => {
    if (Math.abs(p.x - (g.x + g.w / 2)) < 0.5) return 'r';
    if (Math.abs(p.x - (g.x - g.w / 2)) < 0.5) return 'l';
    if (Math.abs(p.y - (g.y + g.h / 2)) < 0.5) return 'b';
    if (Math.abs(p.y - (g.y - g.h / 2)) < 0.5) return 't';
    return '?';
  };
  const s3 = (s) => s.a + s.b + (s.vertical ? 'v' : 'h');
  const A = { x: 0, y: 0, w: 104, h: 45, shape: 'rect' };
  const B = { x: 60, y: 120, w: 104, h: 45, shape: 'rect' };
  const ob = { x: -100, y: 50, w: 220, h: 44, shape: 'rect' };
  const obBox = padBox(ob);
  const sidesWith = edgeSidesOf(A, B, [ob]);
  const geo = edgeGeometry(A, B, [ob], 0, null, []);
  eq('见证：带障碍时选横轴、出右边进左边', s3(sidesWith), 'rlh');
  ok('见证：带障碍时折线不穿过那个第三方方块', !edgePathHits(geo.pts, [obBox]), geo.pts);
  eq('见证：起点落在 edgeSidesOf(...,[障碍]) 选出的 a 侧上', sideOfPoint(A, geo.pts[0]), sidesWith.a);
  eq('见证：终点落在 edgeSidesOf(...,[障碍]) 选出的 b 侧上',
    sideOfPoint(B, geo.pts[geo.pts.length - 1]), sidesWith.b);
  // 负向对照 1：这块障碍真的挡在「不带障碍时选出的那条轴」上 —— 所以上面不是空转，
  // 而且它把「端口分组与布线器必须传同一份障碍」这件事钉死：不传就选到另一条轴。
  const sidesNo = edgeSidesOf(A, B);
  const geoNo = edgeGeometry(A, B, [], 0, null, []);
  eq('负向对照：不带障碍时选出的是另一条轴（竖轴、出下边进上边）', s3(sidesNo), 'btv');
  ok('负向对照：拿掉障碍参数 → 选出的侧确实不同（两条路必须传同一份）',
    s3(sidesNo) !== s3(sidesWith), { with: sidesWith, without: sidesNo });
  ok('负向对照：那条「不带障碍」的路径正好穿过第三方方块（障碍是真挡路的）',
    edgePathHits(geoNo.pts, [obBox]), geoNo.pts);
  // 负向对照 2：障碍不挡路的摆放 → 两种调用必须选出**同一个**侧（证明这条断言不是恒真式）
  const far = { x: 900, y: 900, w: 100, h: 40, shape: 'rect' };
  eq('负向对照：斜角远处放一块不挡路的障碍时，两种调用选出同一个侧',
    s3(edgeSidesOf(A, B, [far])), s3(sidesNo));
  const A2 = { x: 0, y: 0, w: 104, h: 45, shape: 'rect' };
  const B2 = { x: 0, y: 400, w: 104, h: 45, shape: 'rect' };
  const side = { x: 600, y: 200, w: 100, h: 40, shape: 'rect' };
  eq('负向对照：上下堆叠 + 侧面远处的障碍，仍然选竖轴（与不带障碍一致）',
    s3(edgeSidesOf(A2, B2, [side])), 'btv');
}

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败\n');
process.exit(fail === 0 ? 0 : 1);
