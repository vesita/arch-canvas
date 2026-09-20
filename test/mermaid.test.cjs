const fs = require('fs');
const path = require('path');
// 必须读**当前构建**的解析器。这里曾经读 /tmp 下一份手工快照：它在别的机器上根本不存在，
// 而且早已与源码脱节（快照里没有 @link，当前的解析器有）—— 37 条断言全在测旧代码。
const PARSER = path.join(__dirname, '..', 'dist', 'mermaid.js');
if (!fs.existsSync(PARSER)) {
  console.error('缺少 ' + PARSER + ' —— 先跑 npm run build');
  process.exit(1);
}
const src = fs.readFileSync(PARSER, 'utf8');
const api = new Function(src + '\n;return { parseMermaid: parseMermaid, serializeDoc: serializeDoc };')();
const parseMermaid = api.parseMermaid;
const serializeDoc = api.serializeDoc;

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

console.log('\n[1] 空输入 / 垃圾输入');
{
  const d = parseMermaid('');
  check('空串 -> 空文档', d.nodes.length === 0 && d.edges.length === 0);
  const d2 = parseMermaid('@@@ ###\n=== ???');
  check('垃圾行进 extras 不崩', d2.extras.length === 2 && d2.nodes.length === 0, { extras: d2.extras, nodes: d2.nodes.map(n => n.id) });
}

console.log('\n[2] 典型 LLM 生成的 flowchart');
{
  const text = [
    'flowchart TD',
    '    A[Client] --> B[API Gateway]',
    '    B --> C{Auth?}',
    '    C -->|yes| D[(Postgres)]',
    '    C -->|no| E[Reject]',
    '    subgraph Data',
    '      F[Redis Cache]',
    '    end',
    '    B -.-> F',
    '    style A fill:#f9f',
  ].join('\n');
  const d = parseMermaid(text);
  check('direction=TD', d.direction === 'TD', d.direction);
  check('节点数=6', d.nodes.length === 6, d.nodes.map(n => n.id));
  check('边数=5', d.edges.length === 5, d.edges.map(e => e.from + '->' + e.to));
  check('A label', d.nodes.find(n => n.id === 'A').label === 'Client');
  check('C 是菱形', d.nodes.find(n => n.id === 'C').shape === 'diamond');
  check('D 是圆柱', d.nodes.find(n => n.id === 'D').shape === 'cyl');
  check('C->D 带标签 yes', d.edges.some(e => e.from === 'C' && e.to === 'D' && e.label === 'yes'));
  check('C->E 带标签 no', d.edges.some(e => e.from === 'C' && e.to === 'E' && e.label === 'no'));
  check('B-.->F 是虚线', d.edges.some(e => e.from === 'B' && e.to === 'F' && e.arrow === '-.->'));
  check('F 属于子图 Data', d.nodes.find(n => n.id === 'F').group === 'Data', d.nodes.find(n => n.id === 'F'));
  check('子图 1 个', d.groups.length === 1 && d.groups[0].id === 'Data', d.groups);
  check('style 行进 extras', d.extras.length === 1, d.extras);
}

console.log('\n[3] 无空格 / 各种箭头 / & 并列 / 分号');
{
  const d = parseMermaid([
    'graph LR',
    'A-->B',
    'B---C',
    'C==>D',
    'E & F -->|both| G',
    'H --> I; I --> J',
  ].join('\n'));
  check('direction=LR', d.direction === 'LR', d.direction);
  check('A->B 无空格', d.edges.some(e => e.from === 'A' && e.to === 'B' && e.arrow === '-->'), d.edges);
  check('B---C 开放线', d.edges.some(e => e.from === 'B' && e.to === 'C' && e.arrow === '---'));
  check('C==>D 粗线', d.edges.some(e => e.from === 'C' && e.to === 'D' && e.arrow === '==>'));
  check('E&F->G 两条边', d.edges.filter(e => e.to === 'G').length === 2, d.edges);
  check('分号分隔 H->I->J', d.edges.some(e => e.from === 'H' && e.to === 'I') && d.edges.some(e => e.from === 'I' && e.to === 'J'));
}

console.log('\n[4] -- 文本 --> 形式 与 引号 / 转义 / 换行');
{
  const d = parseMermaid([
    'flowchart TD',
    'A -- 说明文字 --> B',
    'C["带 \\"引号\\" 的标签"] --> D',
    'E["第一行<br/>第二行"]',
  ].join('\n'));
  check('-- 文本 --> 边', d.edges.some(e => e.from === 'A' && e.to === 'B' && e.label === '说明文字'), d.edges);
  check('id 未被空格截断', d.nodes.some(n => n.id === 'A') && d.nodes.some(n => n.id === 'B'), d.nodes.map(n => n.id));
  check('E 标签含换行', d.nodes.find(n => n.id === 'E').label === '第一行\n第二行', d.nodes.find(n => n.id === 'E'));
}

console.log('\n[5] @pos 注释往返');
{
  const doc = {
    direction: 'TD',
    nodes: [
      { id: 'n1', label: '接入层', shape: 'rect', group: null, x: 100, y: 40 },
      { id: 'n2', label: '网关 "A"', shape: 'round', group: 'g1', x: 100, y: 200 },
      { id: 'n3', label: '数据库', shape: 'cyl', group: 'g1', x: 320, y: 200 },
    ],
    edges: [
      { id: 'e1', from: 'n1', to: 'n2', label: 'HTTP', arrow: '-->' },
      { id: 'e2', from: 'n2', to: 'n3', label: '', arrow: '-.->' },
    ],
    groups: [{ id: 'g1', label: '数据层' }],
    extras: ['style n1 fill:#eef'],
  };
  const text = serializeDoc(doc);
  console.log('--- 序列化结果 ---\n' + text + '------------------');
  const back = parseMermaid(text);
  check('节点数一致', back.nodes.length === 3, back.nodes.map(n => n.id));
  // 按 id 排一下再比：节点的**顺序**是分组优先决定的（下面单钉一条），这里只钉坐标本身。
  const coords = back.nodes.map(n => [n.id, n.x, n.y]).sort();
  check('坐标往返', eq(coords, [['n1', 100, 40], ['n2', 100, 200], ['n3', 320, 200]]), coords);
  // 节点顺序 = 分组块优先。@pos 注释与图体必须同序，否则同一份文件每往返一次就重排一次。
  check('节点与注释同序（分组优先）', eq(back.nodes.map(n => n.id), ['n2', 'n3', 'n1']), back.nodes.map(n => n.id));
  check('标签引号往返', back.nodes.find(n => n.id === 'n2').label === '网关 "A"', back.nodes.find(n => n.id === 'n2').label);
  check('中文标签往返', back.nodes.find(n => n.id === 'n1').label === '接入层');
  check('shape round 往返', back.nodes.find(n => n.id === 'n2').shape === 'round', back.nodes.find(n => n.id === 'n2').shape);
  check('cyl 往返', back.nodes.find(n => n.id === 'n3').shape === 'cyl');
  check('group 往返', back.nodes.find(n => n.id === 'n2').group === 'g1' && back.nodes.find(n => n.id === 'n3').group === 'g1');
  check('子图标签往返', back.groups[0].label === '数据层', back.groups);
  check('边往返', back.edges.length === 2 && back.edges[0].label === 'HTTP' && back.edges[1].arrow === '-.->', back.edges);
  check('extras 往返', back.extras.length === 1 && back.extras[0] === 'style n1 fill:#eef', back.extras);
  const text2 = serializeDoc(back);
  check('二次序列化稳定', text2 === text, { text2 });
}

console.log('\n[6] 幂等性：解析->序列化->解析');
{
  const inputs = [
    'flowchart TD\n  A[一] --> B[二]\n  B --> C{三}',
    'graph LR\n  X --> Y --> Z',
    'flowchart LR\n  subgraph api["接入"]\n    a1["网关"]\n    a2["鉴权"]\n  end\n  a1 --> a2\n  a2 --> db[("库")]',
  ];
  for (let i = 0; i < inputs.length; i++) {
    const d1 = parseMermaid(inputs[i]);
    const t1 = serializeDoc(d1);
    const d2 = parseMermaid(t1);
    const strip = d => ({ direction: d.direction, nodes: d.nodes.map(n => [n.id, n.label, n.shape, n.group]), edges: d.edges.map(e => [e.from, e.to, e.label, e.arrow]), groups: d.groups.map(g => [g.id, g.label]) });
    check('样例 ' + (i + 1) + ' 稳定', eq(strip(d1), strip(d2)), { a: strip(d1), b: strip(d2) });
  }
}

console.log('\n[7] @link 下钻注释往返（旧快照里没有这个特性，所以专门钉一条）');
{
  const d = parseMermaid('flowchart TD\n  %% @link a 支付/对账\n  a["入口"] --> b["出口"]');
  check('解析出 link', d.nodes.find(n => n.id === 'a').link === '支付/对账', d.nodes.map(n => [n.id, n.link]));
  const back = parseMermaid(serializeDoc(d));
  check('link 往返', back.nodes.find(n => n.id === 'a').link === '支付/对账');
  check('没有 link 的节点是 null 而不是 undefined', back.nodes.find(n => n.id === 'b').link === null);
}

console.log('\n[8] 项目自己的框架图 .arch-canvas/architecture.mmd');
{
  const p = path.join(__dirname, '..', '.arch-canvas', 'architecture.mmd');
  check('框架图在仓库里', fs.existsSync(p));
  const text = fs.readFileSync(p, 'utf8');
  const d = parseMermaid(text);
  const strip = x => ({ direction: x.direction, nodes: x.nodes.map(n => [n.id, n.label, n.shape, n.group, n.x, n.y, n.link]), edges: x.edges.map(e => [e.from, e.to, e.label, e.arrow]), groups: x.groups.map(g => [g.id, g.label]) });
  check('解析出 23 个节点', d.nodes.length === 23, d.nodes.length);
  check('解析出 4 个子图', d.groups.length === 4, d.groups.map(g => g.id));
  check('每个节点都摆了坐标', d.nodes.every(n => n.x !== null && n.y !== null));
  check('往返幂等（用户摆的布局不会漂）', eq(strip(d), strip(parseMermaid(serializeDoc(d)))));
}

console.log('\n[9] 引号感知：标签里的定界符不再把整行打散');
{
  // 这些标签以前会被 indexOf 截在中间：节点或边整行掉进 extras，而且不报错。
  const cases = [
    ['方形', 'A["Array[int]"] --> B["出口"]', 'Array[int]'],
    ['圆角', 'A("f(x) 求值") --> B["出口"]', 'f(x) 求值'],
    ['菱形', 'A{"是否 x>1?"} --> B["出口"]', '是否 x>1?'],
    ['方括号', 'A["读 [conf] 配置"] --> B["出口"]', '读 [conf] 配置'],
  ];
  for (const [name, text, label] of cases) {
    const d = parseMermaid('flowchart TD\n  ' + text);
    check(name + '标签解析出 2 个节点', d.nodes.length === 2, d.nodes.map(n => n.id));
    check(name + '标签完整', d.nodes[0].label === label, d.nodes[0].label);
    check(name + '边没丢', d.edges.length === 1, d.edges);
    const back = parseMermaid(serializeDoc(d));
    check(name + '往返仍是 2 节点 1 边', back.nodes.length === 2 && back.edges.length === 1, { n: back.nodes.length, e: back.edges.length });
    check(name + '往返标签不变', back.nodes[0].label === label, back.nodes[0].label);
  }
  const pipe = parseMermaid('flowchart TD\n  A -->|"读 | 写"| B');
  check('连线标签里的 | 不再截断边', pipe.edges.length === 1 && pipe.edges[0].label === '读 | 写', { edges: pipe.edges });
  const pipeBack = parseMermaid(serializeDoc(pipe));
  check('连线标签 | 往返', pipeBack.edges.length === 1 && pipeBack.edges[0].label === '读 | 写', pipeBack.edges);
}

console.log('\n[10] 标签实体转义是对称的（& # < " 与换行）');
{
  const labels = ['a & b', '号 #3 通道', 'x < y', '他说 "行"', '第一行\n第二行', '字面 #quot; 不是引号'];
  for (const label of labels) {
    const doc = { nodes: [{ id: 'n1', label: label, shape: 'rect', group: null, x: 0, y: 0, link: null }], edges: [], groups: [], direction: 'TD', extras: [] };
    const back = parseMermaid(serializeDoc(doc));
    check('标签往返：' + JSON.stringify(label), back.nodes[0].label === label, back.nodes[0].label);
    check('标签二次往返稳定：' + JSON.stringify(label), serializeDoc(back) === serializeDoc(parseMermaid(serializeDoc(back))));
  }
}

console.log('\n[11] & 并列连线');
{
  const right = parseMermaid('flowchart TD\n  A --> B & C');
  check('A --> B & C 出两条边', eq(right.edges.map(e => [e.from, e.to]), [['A', 'B'], ['A', 'C']]), right.edges.map(e => [e.from, e.to]));
  const both = parseMermaid('flowchart TD\n  A & B --> C & D');
  check('A & B --> C & D 出四条边', eq(both.edges.map(e => e.from + '>' + e.to).sort(), ['A>C', 'A>D', 'B>C', 'B>D']), both.edges.map(e => e.from + '>' + e.to));
  const chain = parseMermaid('flowchart TD\n  A --> B & C --> D');
  check('A --> B & C --> D 是 4 条边（B、C 都是下一段的源）', eq(chain.edges.map(e => e.from + '>' + e.to).sort(), ['A>B', 'A>C', 'B>D', 'C>D']), chain.edges.map(e => e.from + '>' + e.to));
  const bad = parseMermaid('flowchart TD\n  A --> B C');
  check('A --> B C（非法）不凭空造边：只有 A>B', eq(bad.edges.map(e => e.from + '>' + e.to), ['A>B']), bad.edges.map(e => e.from + '>' + e.to));
  check('A --> B C 仍收下 C 这个节点', bad.nodes.map(n => n.id).indexOf('C') >= 0, bad.nodes.map(n => n.id));
  check('A --> B C 记了 warning', bad.warnings.length > 0, bad.warnings);
}

console.log('\n[12] 注释不再造节点（删了节点、忘了删注释）');
{
  const ghost = parseMermaid([
    '%% @pos gone 10 20',
    '%% @link gone 另一张图',
    'flowchart TD',
    '  alive["还在"]',
    '%% @pos alive 30 40',
  ].join('\n'));
  check('不存在的 id 不复活成节点', ghost.nodes.length === 1 && ghost.nodes[0].id === 'alive', ghost.nodes.map(n => n.id));
  check('坐标注释指向不存在的节点会记 warning', ghost.warnings.some(w => w.indexOf('gone') >= 0), ghost.warnings);
  check('坐标注释照样挂在真节点上', ghost.nodes[0].x === 30 && ghost.nodes[0].y === 40, [ghost.nodes[0].x, ghost.nodes[0].y]);
  const saved = serializeDoc(ghost);
  check('落盘时不再写出幽灵注释', saved.indexOf('gone') < 0, saved);
  // 注释写在图体之后也要认（文件顶部之外的位置）
  const late = parseMermaid('flowchart TD\n  a["A"]\n%% @pos a 7 8');
  check('注释在图体之后也认', late.nodes[0].x === 7 && late.nodes[0].y === 8, [late.nodes[0].x, late.nodes[0].y]);
}

console.log('\n[13] 节点 id 不能踩原型链');
{
  const d = parseMermaid('flowchart TD\n  __proto__["原型"] --> constructor["构造"]');
  check('__proto__ 当成普通节点收下', d.nodes.map(n => n.id).sort().join(',') === 'n__proto__,nconstructor', d.nodes.map(n => n.id));
  check('constructor 也当成普通节点', d.nodes.length === 2, d.nodes.length);
  check('没有被写到 Object.prototype 上', ({}).label === undefined && Object.prototype.id === undefined);
  const back = parseMermaid(serializeDoc(d));
  check('往返仍是 2 个节点 1 条边', back.nodes.length === 2 && back.edges.length === 1, { n: back.nodes.length, e: back.edges.length });
}

console.log('\n[14] 元素留言迁移（老式 %% @note / @done）与正文纯净');
{
  const src1 = [
    'flowchart TD',
    '  a["入口"] --> b["出口"]',
    '%% @note a 这里为什么不用队列？',
  ].join('\n');
  const d1 = parseMermaid(src1);
  check('老式注释收进 legacyNotes', d1.legacyNotes && d1.legacyNotes['a'] && d1.legacyNotes['a'].text === '这里为什么不用队列？');
  check('老式注释默认是未解决', d1.legacyNotes && d1.legacyNotes['a'] && d1.legacyNotes['a'].done === false);
  check('mermaid 解析节点上不再直接挂 note（等待 applyNoteStore）', d1.nodes.find(n => n.id === 'a').note === '');
  check('没注释的节点是空串而不是 undefined', d1.nodes.find(n => n.id === 'b').note === '', d1.nodes.map(n => [n.id, n.note]));

  const out1 = serializeDoc(d1);
  check('序列化不再写出 @note 行', out1.indexOf('@note') < 0 && out1.indexOf('@done') < 0, out1.split('\n').filter(l => l.indexOf('@note') >= 0 || l.indexOf('@done') >= 0));
  check('文件头自述里不再写 @note 模板', out1.indexOf('@note <节点id>') < 0, out1.split('\n').slice(0, 5));
  const back1 = parseMermaid(out1);
  check('再序列化变干净（一次性迁移）', back1.legacyNotes && Object.keys(back1.legacyNotes).length === 0);

  const d2 = parseMermaid('flowchart TD\n  a["入口"]\n%% @done a 已经确认过了');
  check('老式 @done 收进 legacyNotes 且 done 为 true', d2.legacyNotes && d2.legacyNotes['a'] && d2.legacyNotes['a'].done === true && d2.legacyNotes['a'].text === '已经确认过了');
  const out2 = serializeDoc(d2);
  check('序列化不写 @done 也不写 @note', out2.indexOf('@done') < 0 && out2.indexOf('@note') < 0);

  const d3 = parseMermaid('flowchart TD\n  a["A"] --> b["B"]\n%% @note a 待办\n%% @done b 已结');
  check('老式注释两态都收进 legacyNotes', d3.legacyNotes && d3.legacyNotes['a'].text === '待办' && d3.legacyNotes['b'].text === '已结' && d3.legacyNotes['b'].done === true);
  const t3 = serializeDoc(d3);
  check('序列化不带任何 @note / @done', t3.indexOf('@note') < 0 && t3.indexOf('@done') < 0);
  const back3 = parseMermaid(t3);
  check('纯图往返幂等', serializeDoc(back3) === t3, { a: t3, b: serializeDoc(back3) });

  // 孤儿规则反转：不再把不存在节点的 @note / @done 当成错误警告，也不丢弃
  const ghost = parseMermaid('flowchart TD\n  alive["还在"]\n%% @note gone 指向不存在\n%% @done gone2 也不存在');
  check('注释不会让节点复活', ghost.nodes.length === 1 && ghost.nodes[0].id === 'alive', ghost.nodes.map(n => n.id));
  check('孤儿注释不再记 warning', ghost.warnings.filter(w => w.indexOf('@note') >= 0).length === 0, ghost.warnings);
  check('孤儿注释保留在 legacyNotes 中', ghost.legacyNotes && ghost.legacyNotes['gone'] && ghost.legacyNotes['gone2']);
  check('落盘不再写出幽灵注释', serializeDoc(ghost).indexOf('gone') < 0, serializeDoc(ghost));

  const both = parseMermaid('flowchart TD\n  a["A"]\n%% @note a 先\n%% @done a 后');
  check('同节点两条老式注释：后写的说了算', both.legacyNotes && both.legacyNotes['a'].text === '后' && both.legacyNotes['a'].done === true);

  const empty = parseMermaid('flowchart TD\n  a["A"]\n%% @note a');
  check('没有正文的老式注释等于没有', !empty.legacyNotes || !empty.legacyNotes['a']);
}

console.log('\n[15] 代码锚点 %% @file（节点 → 源码文件，可多条）');
{
  const src = [
    'flowchart TD',
    '  a["解析器"] --> b["客户端"]',
    '%% @file a "src/host/mermaid.ts"',
    '%% @file a "src/host/document.ts#normalizeModel"',
    '%% @file b "src/client/studio.ts"',
  ].join('\n');
  const d = parseMermaid(src);
  const a = d.nodes.find(n => n.id === 'a');
  const b = d.nodes.find(n => n.id === 'b');
  check('解析出多条锚点且保持顺序', eq(a.files, ['src/host/mermaid.ts', 'src/host/document.ts#normalizeModel']), a.files);
  check('另一个节点一条', eq(b.files, ['src/client/studio.ts']), b.files);
  check('没有锚点的节点是空数组而不是 undefined', eq(parseMermaid('flowchart TD\n  x["X"]').nodes[0].files, []));

  const out = serializeDoc(d);
  check('序列化写出 @file 行', out.indexOf('%% @file a "src/host/mermaid.ts"') >= 0, out.split('\n').filter(l => l.indexOf('@file') >= 0));
  check('文件头自述里交代了 @file', out.indexOf('@file <节点id>') >= 0);
  const back = parseMermaid(out);
  check('锚点往返（含 #符号）', eq(back.nodes.find(n => n.id === 'a').files, a.files), back.nodes.find(n => n.id === 'a').files);
  check('含锚点时往返幂等', serializeDoc(back) === out, { a: out, b: serializeDoc(back) });

  // 锚点和标签共用一套转义：引号、中文、实体都要能原样回来
  const tricky = '带 "引号" 与 & 的#路径/文件.ts#sym';
  const d2 = { nodes: [{ id: 'n1', label: 'N', shape: 'rect', group: null, x: 0, y: 0, link: null, note: '', noteDone: false, files: [tricky] }], edges: [], groups: [], direction: 'TD', extras: [] };
  const back2 = parseMermaid(serializeDoc(d2));
  check('锚点里的引号 / 实体 / #符号 往返', back2.nodes[0].files[0] === tricky, { got: back2.nodes[0].files[0], want: tricky });

  // 幽灵锚点：节点删了、锚点忘了删 —— 丢弃、记 warning、绝不凭它把节点复活
  const ghost = parseMermaid('flowchart TD\n  alive["还在"]\n%% @file gone "src/x.ts"\n%% @file gone "src/y.ts#s"');
  check('锚点不会让节点复活', ghost.nodes.length === 1 && ghost.nodes[0].id === 'alive', ghost.nodes.map(n => n.id));
  check('幽灵锚点记 warning', ghost.warnings.filter(w => w.indexOf('@file') >= 0).length >= 1, ghost.warnings);
  check('落盘不再写出幽灵锚点', serializeDoc(ghost).indexOf('gone') < 0, serializeDoc(ghost));

  // 各种元数据共存时的往返（@pos / @link / @file，以及老式 @note / @done 解析进 legacyNotes）
  const all = parseMermaid([
    'flowchart TD',
    '  a["A"] --> b["B"]',
    '%% @pos a 10 20',
    '%% @link b 另一张图',
    '%% @note a 这里为什么不用队列？',
    '%% @done b 已经确认过了',
    '%% @file a "src/x.ts"',
  ].join('\n'));
  check('@pos/@link/@file 及老式注释解析',
    all.nodes.find(n => n.id === 'a').x === 10 &&
    all.nodes.find(n => n.id === 'b').link === '另一张图' &&
    all.legacyNotes['a'].text === '这里为什么不用队列？' &&
    all.legacyNotes['b'].done === true &&
    eq(all.nodes.find(n => n.id === 'a').files, ['src/x.ts']));
  const cleanOut = serializeDoc(all);
  check('序列化后为纯图（不带 @note/@done）', cleanOut.indexOf('@note') < 0 && cleanOut.indexOf('@done') < 0);
  const round = parseMermaid(cleanOut);
  check('@pos/@link/@file 往返稳定',
    round.nodes.find(n => n.id === 'a').x === 10 &&
    round.nodes.find(n => n.id === 'b').link === '另一张图' &&
    eq(round.nodes.find(n => n.id === 'a').files, ['src/x.ts']));
  check('纯图往返稳定', serializeDoc(round) === cleanOut);
}

console.log('\n[16] 整张图的一句话总结 %% @summary（图级，不挂节点）');
{
  // 基本形状：解析出来、序列化写回头部、往返幂等
  const d = parseMermaid([
    'flowchart TD',
    '  a["A"] --> b["B"]',
    '%% @summary 这是这张图讲的东西',
    '%% @pos a 10 20',
  ].join('\n'));
  check('解析出图级 summary', d.summary === '这是这张图讲的东西', d.summary);
  check('没有 summary 时是空串而不是 undefined', parseMermaid('flowchart TD\n  a["A"]').summary === '');

  const out = serializeDoc(d);
  check('序列化写出 @summary 行', out.indexOf('%% @summary "这是这张图讲的东西"') >= 0,
    out.split('\n').filter(l => l.indexOf('@summary') >= 0));
  check('@summary 在头部（所有 @pos 之前）',
    out.split('\n').findIndex(l => l.indexOf('@summary ') === 0) < out.split('\n').findIndex(l => l.indexOf('%% @pos ') === 0));
  check('summary 往返幂等', serializeDoc(parseMermaid(out)) === out);

  // summary 不挂节点，所以**没有幽灵问题**：不指向任何节点的 summary 照样有效
  const only = parseMermaid('flowchart TD\n  a["A"]\n%% @summary 只有一句话');
  check('@summary 不依赖任何节点', only.summary === '只有一句话' && only.warnings.length === 0, only.warnings);
  check('没有节点也照样写出 summary', serializeDoc({ nodes: [], edges: [], groups: [], direction: 'TD', extras: [], summary: '空图也要有说明' })
    .indexOf('%% @summary "空图也要有说明"') >= 0);

  // 与元素注释同一套转义；换行会被压成一行（它必须占一行）
  const tricky = '带 "引号" & 和 <尖括号> 的一句话';
  const back = parseMermaid(serializeDoc({ nodes: [], edges: [], groups: [], direction: 'TD', extras: [], summary: tricky }));
  check('summary 里的引号 / 实体往返', back.summary === tricky, { got: back.summary, want: tricky });
  check('summary 里的换行被压成一行', parseMermaid('%% @summary 第一行\n%% 这是注释').summary === '第一行');
  check('多行 summary 落盘后仍是单行',
    serializeDoc({ nodes: [], edges: [], groups: [], direction: 'TD', extras: [], summary: 'a\nb\tc' }).indexOf('%% @summary "a b c"') >= 0);
  check('超长 summary 被截断到 500',
    parseMermaid('%% @summary ' + 'x'.repeat(900)).summary.length === 500);

  // 写多条时后面那条说了算（与 @note 一致）
  check('两条 @summary：后写的说了算',
    parseMermaid('%% @summary 旧的\n%% @summary 新的').summary === '新的');

  // 图体里的 @summary 不能把节点复活，也不该被当成节点注释
  const body = parseMermaid('flowchart TD\n  a["A"]\n%% @summary 说明\n%% @note a 这是节点注释');
  check('@summary 不会被当成节点注释',
    body.legacyNotes && body.legacyNotes['a'] && body.legacyNotes['a'].text === '这是节点注释' && body.summary === '说明');
}

console.log('\n[17] 文件头的格式说明行不算数据（%%!）');
{
  // serializeDoc 写出的头里说明行一律用 %%!；头部不再写 %%! @note 模板
  const out = serializeDoc(parseMermaid('flowchart TD\n  a["A"]'));
  check('说明行带 %%! 前缀且恰好 4 行', out.split('\n').filter(l => l.slice(0, 3) === '%%!').length === 4,
    out.split('\n').slice(0, 6));
  const back = parseMermaid(out);
  check('解析自己写出的头不产生任何警告', back.warnings.length === 0, back.warnings);
  check('说明行不会被解析成注释 / 锚点 / 总结',
    back.nodes[0].note === '' && back.nodes[0].files.length === 0 && back.summary === '');

  // 老文件（0.4.x 写出）里的模板行同样不能变成假警告
  const legacy = parseMermaid([
    '%% arch-canvas —— 由「架构画布」面板与 AI 共同维护',
    '%% @pos <节点id> <x> <y> 是画布坐标注释，@link <节点id> <图名> 是下钻到另一张图；',
    '%% @note <节点id> <文本> 是用户留给 AI 的注释，@done 是同一件事但已解决；',
    '%% @file <节点id> <路径> 是这个节点对应的源码文件（可带 #符号），一个节点可多条；',
    '%% 以上对 Mermaid 渲染都无任何影响，可忽略或手改',
    'flowchart TD',
    '  a["A"]',
  ].join('\n'));
  check('0.4.x 的模板头不产生假警告', legacy.warnings.length === 0, legacy.warnings);
  check('0.4.x 的模板头不会被解析成数据',
    legacy.nodes[0].note === '' && legacy.nodes[0].files.length === 0);

  // 真数据当然还要照常认；`%%!` 只是「这行是说明」
  const mixed = parseMermaid([
    '%%! @note <节点id> 模板：不会被当成数据',
    'flowchart TD',
    '  a["A"]',
    '%% @note a 真注释',
  ].join('\n'));
  check('%%! 说明行与真注释共存', mixed.legacyNotes && mixed.legacyNotes['a'] && mixed.legacyNotes['a'].text === '真注释' && mixed.warnings.length === 0, mixed);
}

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败\n');
process.exit(fail === 0 ? 0 : 1);
