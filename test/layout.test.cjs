// 自动布局的守门断言。
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
  + ' autoLayout: autoLayout, sccOf: sccOf, layerOfComps: layerOfComps, groupByLayer: groupByLayer,'
  + ' layoutPositions: layoutPositions, crossingsOf: crossingsOf, medianOrder: medianOrder,'
  + ' nodeSize: nodeSize, refRowCount: refRowCount };')();
const { autoLayout } = api;

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}
const eq = (name, got, want) => ok(name, got === want, { got, want });

// ---------- 造图 ----------
function mk(ids, edges, dir) {
  return {
    nodes: ids.map(function (id) {
      return { id: id, label: id, shape: 'rect', group: null, files: ['a/' + id + '.ts'], note: 'x' + id, link: null };
    }),
    edges: edges.map(function (e, i) { return { id: 'e' + (i + 1), from: e[0], to: e[1] }; }),
    groups: [], direction: dir || 'TD', extras: [],
  };
}
const byId = (out) => { const m = {}; out.nodes.forEach((n) => { m[n.id] = n; }); return m; };
const ys = (out) => Array.from(new Set(out.nodes.map((n) => n.y))).sort((a, b) => a - b);
const xs = (out) => Array.from(new Set(out.nodes.map((n) => n.x))).sort((a, b) => a - b);

// 基线 = 「只折环、不做同层排序」的那一套（就是文件头注释里 92 / 68 那两个数字的口径）
function pairsOf(m, out) {
  const ids = out ? out.nodes.map((n) => n.id) : m.nodes.map((n) => n.id);
  const has = {};
  ids.forEach((i) => { has[i] = true; });
  return m.edges.filter((e) => has[e.from] && has[e.to] && e.from !== e.to).map((e) => [e.from, e.to]);
}
function rounds(positions) {
  const p = {};
  for (const k in positions) p[k] = { x: Math.round(positions[k].x), y: Math.round(positions[k].y) };
  return p;
}
function baselineCrossings(m) {
  const ids = m.nodes.map((n) => n.id);
  const sizes = {};
  m.nodes.forEach((n) => { sizes[n.id] = api.nodeSize(n.label, api.refRowCount(n.files)); });
  const pairs = pairsOf(m);
  const part = api.sccOf(ids, pairs);
  const cl = api.layerOfComps(part.comps, pairs, part.comp);
  const layer = {};
  ids.forEach((id) => { layer[id] = cl[part.comp[id]]; });
  return api.crossingsOf(rounds(api.layoutPositions(sizes, api.groupByLayer(ids, layer), false, false, 56)), pairs);
}
function resultCrossings(m) {
  const out = autoLayout(m);
  const pos = {};
  out.nodes.forEach((n) => { pos[n.id] = { x: n.x, y: n.y }; });
  return api.crossingsOf(pos, pairsOf(m, out));
}

console.log('\n[1] 环必须被折掉：从前它把层号撑到 24~27（真实事故的机制）');
{
  // 一个 3 节点环 + 两条无关的链。旧实现的松弛靠 `cand < nodes.length` 兜底，
  // 8 个节点下环上的三个会被推到第 5/6/7 层，中间 4 层是空的（每层照样吃 84px）。
  const cyc = mk(
    ['a', 'b', 'c', 'x1', 'x2', 'x3', 'x4', 'x5'],
    [['a', 'b'], ['b', 'c'], ['c', 'a'], ['x1', 'x2'], ['x3', 'x4']]
  );
  const out = autoLayout(cyc);
  const g = byId(out);
  eq('环里三个节点必须同层（折环的直接后果）', new Set([g.a.y, g.b.y, g.c.y]).size, 1);
  eq('整张图只有两层', ys(out).length, 2);
  ok('纵向跨度受控（旧实现是 5 个 y、跨 900px 左右）', ys(out)[ys(out).length - 1] - ys(out)[0] < 300, ys(out));
  eq('同一份图跑两次得到同一个布局（平局按 id 定序）',
    JSON.stringify(autoLayout(cyc).nodes), JSON.stringify(out.nodes));
}

console.log('\n[2] 方向：BT / RL 不许把层叠在一起（旧实现 `along = -along` 会把第 0 层和第 2 层重合）');
{
  const bt = autoLayout(mk(['p', 'q', 'r'], [['p', 'q'], ['q', 'r']], 'BT'));
  const g = byId(bt);
  eq('BT 下三层落在三个不同的 y 上', ys(bt).length, 3);
  ok('BT 下越深的层越靠上（y 递减）', g.p.y > g.q.y && g.q.y > g.r.y, { p: g.p.y, q: g.q.y, r: g.r.y });

  const lr = autoLayout(mk(['p', 'q', 'r'], [['p', 'q'], ['q', 'r']], 'LR'));
  const h = byId(lr);
  eq('LR 下三层落在三个不同的 x 上', xs(lr).length, 3);
  ok('LR 下越深的层越靠右（x 递增）', h.p.x < h.q.x && h.q.x < h.r.x, { p: h.p.x, q: h.q.x, r: h.r.x });
}

console.log('\n[3] 纯函数：不改入参、整份复制、无环图上就是最长路径分层');
{
  const chain = mk(['a', 'b', 'c', 'd'], [['a', 'b'], ['b', 'c'], ['c', 'd']]);
  const before = JSON.stringify(chain);
  const out = autoLayout(chain);
  eq('不改入参', JSON.stringify(chain), before);
  eq('链式图分成 4 层', ys(out).length, 4);
  const g = byId(out);
  ok('链上是自上而下', g.a.y < g.b.y && g.b.y < g.c.y && g.c.y < g.d.y, { a: g.a.y, b: g.b.y, c: g.c.y, d: g.d.y });
  ok('整份复制：files / note 都跟着走', out.nodes.every((n) => Array.isArray(n.files) && n.files.length === 1 && typeof n.note === 'string'));
  ok('edges 引用原样带过去', out.edges === chain.edges);
  ok('每个节点都拿到了坐标', out.nodes.every((n) => typeof n.x === 'number' && typeof n.y === 'number'));
}

console.log('\n[4] 不变量：自动布局的交叉数**永远不比基线多**（这是「同层排序要比一遍」那条的守门人）');
{
  // 定死种子的 LCG：红了必须能一模一样的复现
  let seed = 20260921;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  let worse = 0;
  let better = 0;
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
    const base = baselineCrossings(model);
    const got = resultCrossings(model);
    if (got > base) { worse++; if (!worseCase) worseCase = { ids: ids, edges: edges, base: base, got: got }; }
    if (got < base) better++;
  }
  eq('80 张随机图上，交叉数一次都不许比基线多', worse, 0);
  ok('样本确实够多', tested >= 60, tested);
  // 负向对照：上面那条断言只有在「排序真的被采纳过」时才有意义 ——
  // 如果排序从来没赢过，它就退化成「永远不做排序」，与断言本身无法区分。
  ok('而且确实有图变好了（否则那条断言是空转）', better >= 1, { better: better, worse: worse, tested: tested });
  if (worse) console.log('     最差的一张：', JSON.stringify(worseCase));
}

console.log('\n[5] 边数超过上限时跳过「比交叉数」这一步，但仍然出得来坐标');
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
  ok('700 条边也出得来坐标', out.nodes.every((n) => isFinite(n.x) && isFinite(n.y)));
  ok('没慢到离谱（< 1s）', ms < 1000, ms);
}

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败\n');
process.exit(fail === 0 ? 0 : 1);
