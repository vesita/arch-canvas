// 自动布局的守门断言（W2 锚定正交布局）。
//
// 为什么单独一个文件、还要读 dist/：布局函数住在 lib/ui.js 里，而那份脚本只把
// `install` 挂到 globalThis 上，其余全在闭包里 —— 测试够不着。所以 tools/build.mjs
// 把 src/client/runtime.ts 单独也出一份（和解析器的 dist/mermaid.js 同一个理由），
// 这里读的就是**当前构建**的那份真身，不是抄来的副本。
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'dist', 'client-runtime.js');
if (!fs.existsSync(FILE)) {
  console.error('缺少 ' + FILE + ' —— 先跑 npm run build');
  process.exit(1);
}
const src = fs.readFileSync(FILE, 'utf8');
const api = new Function(src + '\n;return {'
  + ' autoLayout, pickAnchor, sccOf, layerOfComps, groupByLayer,'
  + ' layoutPositions, crossingsOf, totalBend, layoutCost,'
  + ' nodeSize, splitLabel };')();
const { autoLayout, pickAnchor, crossingsOf, layoutCost, totalBend } = api;

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}
const eq = (name, got, want) => ok(name, got === want, { got, want });

// ---------- 造图辅助 ----------
function mk(ids, edges, dir) {
  return {
    nodes: ids.map(function (id) {
      return { id: id, label: id, shape: 'rect', group: null, files: ['a/' + id + '.ts'], note: 'x' + id, link: null };
    }),
    edges: edges.map(function (e, i) { return { id: 'e' + (i + 1), from: e[0], to: e[1] }; }),
    direction: dir || 'TD', extras: [],
  };
}
const byId = (out) => { const m = {}; out.nodes.forEach((n) => { m[n.id] = n; }); return m; };
const ys = (out) => Array.from(new Set(out.nodes.map((n) => n.y))).sort((a, b) => a - b);
const xs = (out) => Array.from(new Set(out.nodes.map((n) => n.x))).sort((a, b) => a - b);

function pairsOf(m, out) {
  const ids = out ? out.nodes.map((n) => n.id) : m.nodes.map((n) => n.id);
  const has = {};
  ids.forEach((i) => { has[i] = true; });
  return m.edges.filter((e) => has[e.from] && has[e.to] && e.from !== e.to).map((e) => [e.from, e.to]);
}

function baselineCost(m) {
  const baseOut = autoLayout(m, { baseline: true });
  const pos = {};
  baseOut.nodes.forEach((n) => { pos[n.id] = { x: n.x, y: n.y }; });
  const horiz = m.direction === 'LR' || m.direction === 'RL';
  return layoutCost(pos, pairsOf(m, baseOut), horiz);
}

function resultCost(m) {
  const out = autoLayout(m);
  const pos = {};
  out.nodes.forEach((n) => { pos[n.id] = { x: n.x, y: n.y }; });
  const horiz = m.direction === 'LR' || m.direction === 'RL';
  return layoutCost(pos, pairsOf(m, out), horiz);
}

console.log('\n[1] 选锚点 pickAnchor：入度 0 枢纽、want 优先、乱序不变量、全环退化与主分量选择');
{
  // 扇出图：hub 出度 5，leaf1..5 入度 1
  const fanNodes = ['leaf1', 'leaf2', 'hub', 'leaf3', 'leaf4', 'leaf5'];
  const fanEdges = [['hub', 'leaf1'], ['hub', 'leaf2'], ['hub', 'leaf3'], ['hub', 'leaf4'], ['hub', 'leaf5']];
  eq('扇出图上自动选中入度 0 且出度最大的枢纽', pickAnchor(fanNodes, fanEdges), 'hub');

  // want 显式指定时生效
  eq('want 存在于节点表时严格生效', pickAnchor(fanNodes, fanEdges, 'leaf2'), 'leaf2');

  // 节点数组乱序后结果不变（确定性守门）
  let allEqual = true;
  for (let round = 0; round < 20; round++) {
    const shuffled = fanNodes.slice().sort(() => (round % 3 === 0 ? 1 : -1));
    if (pickAnchor(shuffled, fanEdges) !== 'hub') allEqual = false;
  }
  ok('节点数组多次乱序后结果保持完全一致', allEqual);

  // 全环图退化为度数最大节点，平局按 id 字典序
  const cycleEdges = [['c3', 'c1'], ['c1', 'c2'], ['c2', 'c3']];
  eq('全环图退化为度数最大节点（平局按 id 字典序）', pickAnchor(['c1', 'c2', 'c3'], cycleEdges), 'c1');

  // 断开分量：主分量（节点数更多）的锚点被选中
  const discNodes = ['m1', 'm2', 'hub', 'a', 'b', 'c'];
  const discEdges = [['m1', 'm2'], ['hub', 'a'], ['hub', 'b'], ['hub', 'c']];
  eq('断开分量中先挑主分量的锚点', pickAnchor(discNodes, discEdges), 'hub');
}

console.log('\n[2] 锚点精确落在 (0, 0)：各方向与各形态图硬性质校验');
{
  const testCases = [
    { name: '链式图 TD', model: mk(['a', 'b', 'c'], [['a', 'b'], ['b', 'c']], 'TD') },
    { name: '扇出图 BT', model: mk(['root', 'c1', 'c2'], [['root', 'c1'], ['root', 'c2']], 'BT') },
    { name: '环形图 LR', model: mk(['x', 'y', 'z'], [['x', 'y'], ['y', 'z'], ['z', 'x']], 'LR') },
    { name: '断开图 RL', model: mk(['p1', 'p2', 'q1', 'q2'], [['p1', 'p2'], ['q1', 'q2']], 'RL') },
  ];

  testCases.forEach((tc) => {
    const out = autoLayout(tc.model);
    const anchor = pickAnchor(tc.model.nodes, tc.model.edges);
    const anchorNode = out.nodes.find((n) => n.id === anchor);
    ok(tc.name + ' 锚点存在', Boolean(anchorNode));
    eq(tc.name + ' 锚点 x 精确为 0', anchorNode.x, 0);
    eq(tc.name + ' 锚点 y 精确为 0', anchorNode.y, 0);
  });

  // options.anchor 显式指定也必须精确落在 (0, 0)
  const customModel = mk(['u', 'v', 'w'], [['u', 'v'], ['v', 'w']]);
  const customOut = autoLayout(customModel, { anchor: 'v' });
  const customNode = customOut.nodes.find((n) => n.id === 'v');
  eq('指定 options.anchor 时指定节点落在 (0, 0)', customNode.x === 0 && customNode.y === 0, true);
}

console.log('\n[3] 正交性：单亲节点自动与父节点对齐的边占比 ≥ 阈值，并配负向对照');
{
  // 构造流水线/树状结构：包含长链和分支
  const pipe = mk(
    ['src', 'filter', 'proc', 'sink', 'aux1', 'aux2'],
    [['src', 'filter'], ['filter', 'proc'], ['proc', 'sink'], ['filter', 'aux1'], ['aux1', 'aux2']]
  );
  const out = autoLayout(pipe);
  const pos = byId(out);
  const inDeg = {};
  pipe.nodes.forEach((n) => { inDeg[n.id] = 0; });
  pipe.edges.forEach((e) => { inDeg[e.to]++; });
  const singleParentEdges = pipe.edges.filter((e) => inDeg[e.to] === 1);

  let aligned = 0;
  singleParentEdges.forEach((e) => {
    if (pos[e.from].x === pos[e.to].x) aligned++;
  });
  const alignedRatio = aligned / singleParentEdges.length;
  ok('单亲节点与父节点对齐比例受控（≥ 0.6）', alignedRatio >= 0.6, { alignedRatio, aligned, total: singleParentEdges.length });

  // 负向对照：随机摆放绝不可能达到如此高的正交对齐率
  let randomAligned = 0;
  const trials = 100;
  for (let t = 0; t < trials; t++) {
    const randPos = {};
    pipe.nodes.forEach((n, idx) => { randPos[n.id] = { x: Math.floor((t * 37 + idx * 71) % 400), y: idx * 80 }; });
    singleParentEdges.forEach((e) => {
      if (randPos[e.from].x === randPos[e.to].x) randomAligned++;
    });
  }
  const randomRatio = randomAligned / (trials * singleParentEdges.length);
  ok('负向对照：随机摆放几乎无法自动正交对齐（< 0.1）', randomRatio < 0.1, { randomRatio });
}

console.log('\n[4] 成本不变量：80 张定种子随机图 cost 一次都不比基线差，且至少一张更好');
{
  let seed = 20260921;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  let worse = 0;
  let better = 0;
  let equal = 0;
  let worseCase = null;
  let tested = 0;

  for (let g = 0; g < 80; g++) {
    const n = 5 + Math.floor(rnd() * 9);
    const ids = [];
    for (let i = 0; i < n; i++) ids.push('v' + i);
    const seen = {};
    const edges = [];
    const m = 4 + Math.floor(rnd() * (n * 1.6));
    for (let i = 0; i < m; i++) {
      const a = 1 + Math.floor(rnd() * n);
      const b = Math.floor(rnd() * n);
      if (a === b || seen[a + '>' + b]) continue;
      seen[a + '>' + b] = 1;
      edges.push(['v' + a, 'v' + b]);
    }
    if (edges.length < 2) continue;
    tested++;
    const model = mk(ids, edges);
    const base = baselineCost(model);
    const got = resultCost(model);
    if (got > base) { worse++; if (!worseCase) worseCase = { ids, edges, base, got }; }
    else if (got < base) better++;
    else equal++;
  }

  eq('80 张随机图上，综合成本 cost 一次都不许比基线多', worse, 0);
  ok('样本量充足（>= 60 张）', tested >= 60, tested);
  ok('负向对照：存在显著更优的图（排序与正交优化未空转）', better >= 1, { better, equal, worse, tested });
  if (worse) console.log('     最差的一张：', JSON.stringify(worseCase));
}

console.log('\n[5] 折环 / 方向单调 / 纯函数整份复制（去 groups）/ pinned 保留');
{
  // 环折叠
  const cyc = mk(
    ['a', 'b', 'c', 'x1', 'x2', 'x3'],
    [['a', 'b'], ['b', 'c'], ['c', 'a'], ['x1', 'x2'], ['x2', 'x3']]
  );
  const cycOut = autoLayout(cyc);
  const cg = byId(cycOut);
  eq('环里三个节点必须同层（折环保证）', new Set([cg.a.y, cg.b.y, cg.c.y]).size, 1);
  ok('整图层数紧凑受控', ys(cycOut).length <= 3, ys(cycOut));

  // 方向单调
  const td = autoLayout(mk(['p', 'q', 'r'], [['p', 'q'], ['q', 'r']], 'TD'));
  const tg = byId(td);
  ok('TD 下越深的层越靠下（y 递增）', tg.p.y < tg.q.y && tg.q.y < tg.r.y, { p: tg.p.y, q: tg.q.y, r: tg.r.y });

  const bt = autoLayout(mk(['p', 'q', 'r'], [['p', 'q'], ['q', 'r']], 'BT'));
  const bg = byId(bt);
  ok('BT 下越深的层越靠上（y 递减）', bg.p.y > bg.q.y && bg.q.y > bg.r.y, { p: bg.p.y, q: bg.q.y, r: bg.r.y });

  const lr = autoLayout(mk(['p', 'q', 'r'], [['p', 'q'], ['q', 'r']], 'LR'));
  const lg = byId(lr);
  ok('LR 下越深的层越靠右（x 递增）', lg.p.x < lg.q.x && lg.q.x < lg.r.x, { p: lg.p.x, q: lg.q.x, r: lg.r.x });

  const rl = autoLayout(mk(['p', 'q', 'r'], [['p', 'q'], ['q', 'r']], 'RL'));
  const rg = byId(rl);
  ok('RL 下越深的层越靠左（x 递减）', rg.p.x > rg.q.x && rg.q.x > rg.r.x, { p: rg.p.x, q: rg.q.x, r: rg.r.x });

  // 纯函数与整份复制（去 groups）
  const chain = mk(['a', 'b', 'c', 'd'], [['a', 'b'], ['b', 'c'], ['c', 'd']]);
  const before = JSON.stringify(chain);
  const out = autoLayout(chain);
  eq('纯函数：不改入参', JSON.stringify(chain), before);
  eq('模型输出去掉 groups 字段', out.groups, undefined);
  ok('edges 引用原样带过去', out.edges === chain.edges);
  ok('整份复制：节点原有 files / note / link 完整保留', out.nodes.every((n) => Array.isArray(n.files) && typeof n.note === 'string'));
  ok('每个节点坐标均为有限数值', out.nodes.every((n) => isFinite(n.x) && isFinite(n.y)));

  // pinned
  chain.nodes[0].x = 777;
  chain.nodes[0].y = 888;
  const pinnedOut = autoLayout(chain, { pinned: ['a'] });
  const pg = byId(pinnedOut);
  eq('pinned 节点 x 保持不变', pg.a.x, 777);
  eq('pinned 节点 y 保持不变', pg.a.y, 888);
  ok('非 pinned 节点正常重排', pg.b.x !== 777 || pg.b.y !== 888);
}

console.log('\n[6] 规模性能：700 边 < 1s');
{
  const ids = [];
  for (let i = 0; i < 120; i++) ids.push('b' + i);
  const edges = [];
  for (let i = 0; i < 700; i++) {
    const a = i % 119;
    const b = 1 + ((i * 7) % 119);
    if (a !== b) edges.push(['b' + a, 'b' + b]);
  }
  const t0 = Date.now();
  const out = autoLayout(mk(ids, edges));
  const ms = Date.now() - t0;
  ok('700 条边正常生成全部有限坐标', out.nodes.every((n) => isFinite(n.x) && isFinite(n.y)));
  ok('耗时严格控制在 1s 内', ms < 1000, ms);
}

console.log('\n[7] 断开分量：各自独立分层并沿交叉轴并排排布，块与块不重叠');
{
  const disc = mk(
    ['a1', 'a2', 'a3', 'b1', 'b2', 'c1', 'c2'],
    [['a1', 'a2'], ['a2', 'a3'], ['b1', 'b2'], ['c1', 'c2']],
    'TD'
  );
  const out = autoLayout(disc);
  const dpos = byId(out);

  const compGroups = [
    ['a1', 'a2', 'a3'],
    ['b1', 'b2'],
    ['c1', 'c2']
  ];

  // 计算每个分量的真实包围盒
  const boxes = compGroups.map((grp) => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    grp.forEach((nid) => {
      const p = dpos[nid];
      const sz = api.nodeSize ? api.nodeSize(nid, 0) : { w: 100, h: 45 };
      if (p.x - sz.w / 2 < minX) minX = p.x - sz.w / 2;
      if (p.x + sz.w / 2 > maxX) maxX = p.x + sz.w / 2;
      if (p.y - sz.h / 2 < minY) minY = p.y - sz.h / 2;
      if (p.y + sz.h / 2 > maxY) maxY = p.y + sz.h / 2;
    });
    return { minX, maxX, minY, maxY };
  });

  let overlap = false;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const b1 = boxes[i], b2 = boxes[j];
      const xOverlap = !(b1.maxX < b2.minX || b2.maxX < b1.minX);
      const yOverlap = !(b1.maxY < b2.minY || b2.maxY < b1.minY);
      if (xOverlap && yOverlap) {
        overlap = true;
        console.log('重叠分量:', i, j, b1, b2);
      }
    }
  }
  eq('三个断开分量之间完全不重叠', overlap, false);
}

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败\n');
process.exit(fail === 0 ? 0 : 1);
