// 解析器（一半）：空输入 / 典型 LLM 语法 / 注释 / 标签实体 / 留言与锚点迁移 / 往返守恒。
// 公共装载（读 dist/mermaid.js、断言计数器、汇总出口）在 mermaid.shared.cjs；真 Mermaid 校验在 mermaid.real.test.cjs。
const {
  fs, path,
  parseMermaid, serializeDoc, roundTripDiff, cleanId, q, unquote, qRef, unquoteRef,
  ARROWS, MERMAID_KEYWORD_LIST, stableJson, firstDiff, HEADER_LINE_FOR_TEST, check, eq, endPhase,
} = require('./mermaid.shared.cjs');

console.log('\n[1] 空输入 / 垃圾输入');
{
  const d = parseMermaid('');
  check('空串 -> 空文档', d.nodes.length === 0 && d.edges.length === 0);
  const d2 = parseMermaid('@@@ ###\n=== ???');
  check('垃圾行进 extras 不崩', d2.extras.length === 2 && d2.nodes.length === 0, { extras: d2.extras, nodes: d2.nodes.map(n => n.id) });

  // 坏行不许改变**已存在**节点上的字段。ensureNode 对 label/shape/group 是原地改的，
  // 光按 doc.nodes.length 截断只回滚得了本行新增的节点 —— 于是坏行的标签会留在干净节点行上，
  // 文件里同时有 `A["新标签"]` 和 `A["新标签"] ?!`，而往返检查因为定点而完全安静。
  const dirty = parseMermaid('flowchart TD\n  A["旧标签"]\n  A["新标签"] ?!');
  check('坏行不改变已存在节点的 label',
    dirty.nodes.find(n => n.id === 'A').label === '旧标签', dirty.nodes);
  check('坏行原样进 extras（半截模型与 extras 不许同时存在）',
    dirty.extras.length === 1 && dirty.extras[0] === 'A["新标签"] ?!', dirty.extras);
  const dirtyGroup = parseMermaid([
    'flowchart TD',
    '  A["x"]',
    '  subgraph g["G"]',
    '  A["y"] ?!',
    '  end',
  ].join('\n'));
  const dgA = dirtyGroup.nodes.find(n => n.id === 'A');
  check('坏行不改变已存在节点的 group（回滚到 null）', dgA.group === null, dgA);
  check('坏行不改变已存在节点的 shape', dgA.shape === 'rect', dgA);
  check('坏行不改变已存在节点的 label（子图里那次）', dgA.label === 'x', dgA);
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

  // `--o` / `--x` 也是 `--` 开头，而同一行后面很可能还有一条 `-->`。
  // 「带标签长写法」的扫描器不许把它们抢走（抢走就会把 `o B` 当成标签、把 `A --o B` 整段吃掉）。
  const mixed = parseMermaid('graph LR\n  A --o B --> C');
  check('A --o B --> C 是两条边（--o 没被 `-- 文本 -->` 抢走）',
    eq(mixed.edges.map(e => e.from + ' ' + e.arrow + ' ' + e.to), ['A --o B', 'B --> C']), mixed.edges);
  const mixedDot = parseMermaid('graph LR\n  A -. text .-> B --> C');
  check('A -. text .-> B --> C 是两条边（各自带各自的标签）',
    eq(mixedDot.edges.map(e => e.from + ' ' + e.arrow + ' ' + e.to + ' ' + e.label), ['A -.-> B text', 'B --> C ']), mixedDot.edges);
  check('`A -- 文本 --> B` 的带标签长写法没被新箭头破坏',
    eq(parseMermaid('graph LR\n  A -- 文本 --> B').edges.map(e => e.from + e.label + e.to), ['A文本B']));
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
  // 这一节**不钉节点数**：那是用户正在编辑的活图，他删两个节点就变成一条红灯，
  // 而红灯说的不是解析器坏了。钉的是「这份真文件能被完整读进来」这件事本身。
  // （2026-09-21 踩过：这张图被从 23 个节点改成 16 个，测试立刻红，查了半天才发现是文件变了。）
  check('解析出节点（至少有内容）', d.nodes.length >= 2, d.nodes.length);
  check('解析这份真文件格式正常', d.nodes.length >= 2, d.nodes.length);
  check('解析这份真文件没有产生警告', d.warnings.length === 0, d.warnings);
  check('每个节点都落在某个子图里或明确不属于任何组', d.nodes.every(n => n.group === null || d.groups.some(g => g.id === n.group)),
    d.nodes.map(n => [n.id, n.group]).filter((x) => x[1] !== null));
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

console.log('\n[10] 标签实体转义是对称的（& # < " ` 与换行）');
{
  const labels = [
    'a & b', '号 #3 通道', 'x < y', '他说 "行"', '第一行\n第二行', '字面 #quot; 不是引号',
    // 首尾空白是**内容**不是语法：从前 unquote 两端 trim，于是标签 '  hello  ' 读回 'hello'、
    // ' ' 读回 '' 再被兜成节点 id —— persist() 每次保存都记一条 serialize.not-idempotent。
    ' 首尾空格 ', ' ', '\t x \t',
    // 反引号：不转义的话写出的 .mmd 直接非法（真 Mermaid 报 Lexical error），而往返检查全安静。
    '`arch_edit` 是默认', '单个 ` 反引号',
    // `#60;` 的**字面写法**：解码顺序反了的话会被先解成 `#` 再变成 `<`（'x#60;y' → 'x<y'）。
    '字面 #60; 不是 <', '#96; 的字面写法',
  ];
  for (const label of labels) {
    const doc = { nodes: [{ id: 'n1', label: label, shape: 'rect', group: null, x: 0, y: 0, link: null, files: [] }], edges: [], groups: [], direction: 'TD', extras: [], summary: '' };
    const back = parseMermaid(serializeDoc(doc));
    check('标签往返：' + JSON.stringify(label), back.nodes[0].label === label, back.nodes[0].label);
    check('标签二次往返稳定：' + JSON.stringify(label), serializeDoc(back) === serializeDoc(parseMermaid(serializeDoc(back))));
    check('标签往返检查安静：' + JSON.stringify(label), roundTripDiff(doc).length === 0, roundTripDiff(doc));
  }
  // 引号**外**的空白是语法（真 Mermaid 也给 `x`），引号**内**的才是内容 —— 别一刀切。
  check('引号外的空白按语法去掉', unquote(' "x" ') === 'x', unquote(' "x" '));
  check('引号内的空白原样保留', unquote('"  x  "') === '  x  ', JSON.stringify(unquote('"  x  "')));
  // AI 手写的换行变体：`<br>` / `<\br>` / `</br>` / `<BR/>`，以及被老版本转义着写进文件的
  // `&lt;br&gt;` —— 全都要读成**真实换行**。否则 q() 会把 `<` 转义成 `#60;`，
  // 用户方块里看到的就是那串字面垃圾（2026-09-27 现场）。
  const brVariants = ['a<br>b', 'a<br/>b', 'a<br />b', 'a<BR>b', 'a<\\br>b', 'a</br>b', 'a<\\br/>b', 'a&lt;br&gt;b'];
  for (const v of brVariants) {
    check('换行变体读成真实换行：' + JSON.stringify(v), unquote('"' + v + '"') === 'a\nb', unquote('"' + v + '"'));
  }
  check('q() 仍然只写规范的 <br/>', q('a\nb') === '"a<br/>b"', q('a\nb'));
  const brDoc = { nodes: [{ id: 'n1', label: '一\n二', shape: 'rect', group: null, x: 0, y: 0, link: null, files: [] }], edges: [], groups: [], direction: 'TD', extras: [], summary: '' };
  check('带换行的标签逐字节往返', parseMermaid(serializeDoc(brDoc)).nodes[0].label === '一\n二');
  check('带换行的标签往返检查安静', roundTripDiff(brDoc).length === 0, roundTripDiff(brDoc));
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

  // 写坏的元数据行必须出声：从前一律 `continue`，用户摆好的坐标/锚点无声消失。
  const brokenPos = parseMermaid('flowchart TD\n  a["A"]\n%% @pos a b 1 2');
  check('id 含空格的 @pos 会出声',
    brokenPos.warnings.length === 1 && brokenPos.warnings[0].indexOf('@pos') >= 0, brokenPos.warnings);
  check('坏 @pos 不会凭空挂坐标', brokenPos.nodes[0].x === null && brokenPos.nodes[0].y === null);
  const sciPos = parseMermaid('flowchart TD\n  a["A"]\n%% @pos a 1e5 2');
  check('科学计数法的 @pos 会出声',
    sciPos.warnings.length === 1 && sciPos.warnings[0].indexOf('1e5') >= 0, sciPos.warnings);
  // 尾部垃圾：坐标照收（用户摆出来的东西不能因为多打两个字就丢），多出来的那段要出声
  const tailPos = parseMermaid('flowchart TD\n  a["A"]\n%% @pos a 1 2 尾部垃圾');
  check('@pos 尾部垃圾会出声',
    tailPos.warnings.length === 1 && tailPos.warnings[0].indexOf('尾部垃圾') >= 0, tailPos.warnings);
  check('@pos 尾部垃圾不影响坐标本身', tailPos.nodes[0].x === 1 && tailPos.nodes[0].y === 2, [tailPos.nodes[0].x, tailPos.nodes[0].y]);
  // 幽灵那一条不许变成两条（第 [12] 节原来就守着它）
  check('幽灵 @pos 仍然只有一条警告',
    parseMermaid('flowchart TD\n  a["A"]\n%% @pos gone 1 2').warnings.length === 1);
  const brokenFile = parseMermaid('flowchart TD\n  a["A"]\n%% @file a');
  check('缺路径的 @file 会出声',
    brokenFile.warnings.length === 1 && brokenFile.warnings[0].indexOf('@file') >= 0, brokenFile.warnings);
  const brokenLink = parseMermaid('flowchart TD\n  a["A"]\n%% @link a');
  check('缺图名的 @link 会出声',
    brokenLink.warnings.length === 1 && brokenLink.warnings[0].indexOf('@link') >= 0, brokenLink.warnings);
  // 警告里要指得出**哪一行**
  check('警告里带行号', brokenPos.warnings[0].indexOf('3') >= 0, brokenPos.warnings[0]);
}

console.log('\n[13] 节点 id 不能踩原型链');
{
  const d = parseMermaid('flowchart TD\n  __proto__["原型"] --> constructor["构造"]');
  check('__proto__ 当成普通节点收下', d.nodes.map(n => n.id).sort().join(',') === 'n__proto__,nconstructor', d.nodes.map(n => n.id));
  check('constructor 也当成普通节点', d.nodes.length === 2, d.nodes.length);
  check('没有被写到 Object.prototype 上', ({}).label === undefined && Object.prototype.id === undefined);
  const back = parseMermaid(serializeDoc(d));
  check('往返仍是 2 个节点 1 条边', back.nodes.length === 2 && back.edges.length === 1, { n: back.nodes.length, e: back.edges.length });

  // Mermaid 自己的关键字当节点 id：`end`/`graph`/`subgraph`/`interpolate` 写出的是**非法** Mermaid，
  // `link`/`click`/`direction` 会被我们自己的指令规则吃掉、`end` 会被当 subgraph 收尾。
  // 归一成带前缀的 id（cleanId）之后，读文件与写文件两侧对同一个原始 id 得到同一个结果，
  // `%% @pos end 10 20` 也照样对得上。真 Mermaid 那半在第 [25] 节验。
  for (const kw of ['end', 'graph', 'flowchart', 'subgraph', 'link', 'click', 'direction', 'interpolate']) {
    const dk = parseMermaid('flowchart TD\n  ' + kw + '["L"]\n%% @pos ' + kw + ' 10 20');
    const want = cleanId(kw);
    check('关键字 id ' + kw + '：归一成 ' + want + ' 且坐标找得回',
      dk.nodes.length === 1 && dk.nodes[0].id === want && dk.nodes[0].x === 10 && dk.nodes[0].y === 20,
      { id: dk.nodes[0] && dk.nodes[0].id, x: dk.nodes[0] && dk.nodes[0].x, w: dk.warnings });
    check('关键字 id ' + kw + '：序列化产物里不再出现裸关键字 id',
      serializeDoc(dk).indexOf('\n  ' + kw + '[') < 0, serializeDoc(dk).split('\n').filter(l => l.indexOf(kw) >= 0));
    check('关键字 id ' + kw + '：往返检查为空', roundTripDiff(dk).length === 0, roundTripDiff(dk));
  }
  // `style` / `class` / `classDef` / `linkStyle` 真 Mermaid 根本不允许当 id（`style["L"]` 直接 Parse error）。
  // 从前它们被指令闸门当指令、整行进 extras：文本保住了，但**产出的仍是一份真 Mermaid 拒收的文件**
  // —— 每存一次都重写一遍那条非法行。现在判据收成一条「关键字后面是空白才算指令」，
  // 紧贴形状定界符的一律走节点解析并被 cleanId 归一成 `n_style`，产物合法、坐标也认得住。
  const styleId = parseMermaid('flowchart TD\n  style["L"]\n%% @pos style 10 20');
  check('style["L"]：归一成 n_style 的节点（不再原样留成一条非法指令行）',
    styleId.nodes.length === 1 && styleId.nodes[0].id === 'n_style' && styleId.nodes[0].label === 'L' &&
    styleId.nodes[0].x === 10 && styleId.nodes[0].y === 20 && styleId.extras.length === 0, styleId);
  check('style["L"]：产物里不再出现裸关键字 id', serializeDoc(styleId).indexOf('\n  style[') < 0, serializeDoc(styleId));
  // 真指令照旧：关键字后面是空白 → 进 extras 原样保留（不静默丢）
  const styleDirective = parseMermaid('flowchart TD\n  A["a"]\n  style A fill:#f9f');
  check('真指令 style A fill:#f9f：原样进 extras 不静默丢',
    styleDirective.extras.length === 1 && styleDirective.extras[0] === 'style A fill:#f9f' && styleDirective.nodes.length === 1,
    styleDirective);
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

  // 普通 `%%` 注释 / `%%{init}%%` / subgraph 内的 `direction`：都是**合法 Mermaid 文本**，
  // 从前分完类就 `continue` —— 既不进 doc 也不进 extras，用户没删、落盘时自己没了
  // （`%%{init}%%` 还带走渲染主题，`direction` 还带走布局方向）。
  // 现在一律原样留进 extras：位置从行内挪到文件尾，往返仍然幂等，但**一个字都不丢**。
  const kept = parseMermaid([
    '%%{init:{"theme":"dark"}}%%',
    'flowchart TD',
    '  %% 这是用户写的一句注释',
    '  subgraph g["G"]',
    '  direction LR',
    '  A --> B',
    '  end',
  ].join('\n'));
  check('%%{init}%% / 普通注释 / subgraph 内 direction 都原样保留',
    kept.extras.length === 3 &&
    kept.extras.indexOf('%%{init:{"theme":"dark"}}%%') >= 0 &&
    kept.extras.indexOf('%% 这是用户写的一句注释') >= 0 &&
    kept.extras.indexOf('direction LR') >= 0, kept.extras);
  check('保留它们不产生任何警告', kept.warnings.length === 0, kept.warnings);
  check('图体照旧解析（节点与组都在）',
    kept.nodes.map(n => n.id).join(',') === 'A,B' && kept.groups.length === 1 && kept.groups[0].id === 'g', kept);
  const keptOut = serializeDoc(kept);
  check('三条都写进了文件（没有丢）',
    keptOut.indexOf('%%{init:{"theme":"dark"}}%%') >= 0 &&
    keptOut.indexOf('%% 这是用户写的一句注释') >= 0 &&
    keptOut.indexOf('direction LR') >= 0, keptOut.split('\n').slice(-6));
  check('原样往返：再序列化稳定', serializeDoc(parseMermaid(keptOut)) === keptOut, keptOut);

  // 墓碑行 `%% @deleted` 是**文档级标记**（document.ts 的 TOMBSTONE 写在文件最前面、hasTombstone 从行首读），
  // 不是内容。它若落进上面那个「未知 %% 行原样留进 extras」的兜底，就会在「恢复」（摘掉行首那一行）
  // 之后的下一次保存里从 extras 写回文件末尾 —— 用户点了恢复、过一会儿它自己又变回已删除，
  // 而且文件里出现两条墓碑。2026-09-24 合并四批改动时实测到（墓碑跑到第 309 字节）。
  const tomb = parseMermaid('%% @deleted\nflowchart TD\n  A["甲"]\n');
  check('墓碑行不进 extras（它不是内容）', tomb.extras.length === 0, tomb.extras);
  check('墓碑行不产生警告', tomb.warnings.length === 0, tomb.warnings);
  check('墓碑行不会出现在序列化输出里（要写由 document.ts 从行首写）',
    serializeDoc(tomb).indexOf('@deleted') < 0, serializeDoc(tomb));
  check('带墓碑的文件仍能解析出节点', tomb.nodes.map(n => n.id).join(',') === 'A', tomb.nodes);
  check('解析自己写出的文件不产生假警告', parseMermaid(keptOut).warnings.length === 0, parseMermaid(keptOut).warnings);
  // `%%!` 说明行**仍然**整行跳过：不许因为「保留注释」把格式说明也留进 extras。
  check('%%! 说明行仍然跳过（不进 extras）',
    parseMermaid('%%! 这是说明\nflowchart TD\n  a["A"]').extras.length === 0);
  // serializeDoc 每次重写的那行横幅同理：否则文件头写一遍、文件尾又写一遍，真图立刻不再逐字节往返。
  check('横幅注释不重复写（真图逐字节往返的前提）',
    parseMermaid(serializeDoc(parseMermaid('flowchart TD\n  a["A"]'))).extras.length === 0);
  // 真指令仍然进 extras 且**不报**「没能解析」的假警告（它不是垃圾）
  const directive = parseMermaid('flowchart TD\n  A --> B\n  style A fill:#f9f\n  click A href "http://x"');
  check('真指令行进 extras 且不产生警告', directive.extras.length === 2 && directive.warnings.length === 0, directive);
}

// ==================== 写盘前的往返守恒检查 ====================
// 这条检查是「往返幂等」的运行时版本：`parse(serialize(doc))` 必须与 doc 在所有**会被持久化
// 的**字段上一致。它抓的不是解析器，而是「某个字段写不出去」——2026-09 我们连续踩了三次
// 同一类坑（拖拽丢字段、自动布局丢 4 个字段、add_node 丢组名），每次都**不报错**。
console.log('\n[18] 往返守恒检查：安静时真安静，出问题时真会喊')
{
  const good = {
    direction: 'TD', summary: '', edges: [], extras: [],
    nodes: [{ id: 'a', label: '甲', shape: 'rect', group: null, x: 10.4, y: -3.6, link: null, files: ['src/a.ts'] }],
    groups: [],
  }
  check('正常文档：检查安静（坐标写盘时取整，不算差异）', roundTripDiff(good).length === 0, roundTripDiff(good))

  // 负向对照：手工做一个"解析器会把这一行吃进模型里"的 extras —— 它确实不是定点。
  // 有它才能证明上面那条"安静"不是空转（撤掉检查也一样通过的那种假绿）。
  const broken = {
    direction: 'TD', summary: '', nodes: [], edges: [], groups: [],
    extras: ['  x["原样"] --> y'],
  }
  const bad = roundTripDiff(broken)
  check('负向对照：真的不对称时报得出来', bad.length > 0, bad)
  check('并且指明差在哪个字段', bad.indexOf('extras') >= 0, bad)

  // 留言**不由这份文本承载**（在旁路表 notes.json 里），必须排除 —— 否则每张有留言的图都误报
  const withNote = {
    direction: 'TD', summary: '', edges: [], extras: [], groups: [],
    nodes: [{ id: 'a', label: '甲', shape: 'rect', group: null, x: 0, y: 0, link: null, files: [], note: '这里是留言', noteDone: true }],
  }
  check('留言在旁路表里：不算这份文本的差异', roundTripDiff(withNote).length === 0, roundTripDiff(withNote))

  // 负向对照的另一半：**带尾空格**的标签必须安静 —— 它有自己的合法表达（`n1["  甲  "]`），
  // 所以 unquote 不许 trim 它、这条检查也不许报它。把 trim 加回去，这几条立刻红。
  const spaced = {
    direction: 'TD', summary: '', edges: [], extras: [],
    nodes: [{ id: 'a', label: '  甲  ', shape: 'round', group: 'g1', x: 0, y: 0, link: null, files: [] }],
    groups: [{ id: 'g1', label: ' 组 ' }],
  }
  check('带尾空格的标签：往返检查安静（空白是内容不是语法）', roundTripDiff(spaced).length === 0, roundTripDiff(spaced))
  const spacedBack = parseMermaid(serializeDoc(spaced))
  check('带尾空格的标签原样读回',
    spacedBack.nodes[0].label === '  甲  ' && spacedBack.groups[0].label === ' 组 ',
    { n: spacedBack.nodes[0].label, g: spacedBack.groups[0].label })

  // 空 label 的**写盘口径**是节点 id（`n1[""]` 是非法 Mermaid，没有第二种表达）。
  // 模型边界上归一（normalizeModel）之后，这份文本照样是安静的 —— 不能报成漂移。
  const blankLabel = {
    direction: 'TD', summary: '', edges: [], extras: [], groups: [],
    nodes: [{ id: 'a', label: '', shape: 'rect', group: null, x: 0, y: 0, link: null, files: [] }],
  }
  check('空 label 按写盘口径归一：不报成漂移', roundTripDiff(blankLabel).length === 0, roundTripDiff(blankLabel))
  const blankGroupLabel = {
    direction: 'TD', summary: '', edges: [], extras: [], groups: [{ id: 'g1', label: ' ' }],
    nodes: [{ id: 'a', label: '甲', shape: 'rect', group: 'g1', x: 0, y: 0, link: null, files: [] }],
  }
  check('纯空白组 label 归一到组 id：不报成漂移', roundTripDiff(blankGroupLabel).length === 0, roundTripDiff(blankGroupLabel))
}

console.log('\n[19] 空组必须能写进文件（往返检查当场逮到的那条）')
{
  const doc = {
    direction: 'TD', summary: '', edges: [], extras: [],
    nodes: [{ id: 'a', label: '甲', shape: 'rect', group: null, x: 0, y: 0, link: null, files: [] }],
    groups: [{ id: 'g1', label: '孤组' }],
  }
  const text = serializeDoc(doc)
  // 从前这里是 if (members.length > 0)：删掉一个组的最后一个成员之后，那个组写不进文件，
  // 下次读回来就静默消失了（组名、标签全没）。解析器本来就认空组，是序列化器单方面不写。
  check('空组也写出了 subgraph', text.indexOf('subgraph g1') >= 0, text.split('\n').filter((l) => l.indexOf('subgraph') >= 0))
  const back = parseMermaid(text)
  check('读回来那个组还在', back.groups.length === 1 && back.groups[0].id === 'g1', back.groups)
  check('往返检查安静', roundTripDiff(doc).length === 0, roundTripDiff(doc))
}

console.log('\n[20] 锚点路径里的 `#` 不再写成 `#35;`（人要在源码页里读这一行）')
{
  const doc = {
    direction: 'TD', summary: '', edges: [], extras: [], groups: [],
    nodes: [{ id: 'a', label: '甲', shape: 'rect', group: null, x: 0, y: 0, link: null, files: ['src/host/document.ts#applyOps'] }],
  }
  const text = serializeDoc(doc)
  check('写出的是原样的 #applyOps',
    text.indexOf('%% @file a "src/host/document.ts#applyOps"') >= 0, text.split('\n').filter((l) => l.indexOf('@file') === 0))
  check('负向对照：文件里不再出现 #35; 这套实体转义', text.indexOf('#35;') < 0)
  const back = parseMermaid(text)
  check('读回来仍然是 #applyOps', back.nodes[0].files[0] === 'src/host/document.ts#applyOps', back.nodes[0].files)
  check('往返检查安静', roundTripDiff(doc).length === 0, roundTripDiff(doc))

  // 老文件（0.6.x 及以前写的是 #35;）必须照旧解析得出来 —— 否则这一改就是把老图读坏。
  const legacy = parseMermaid([
    'flowchart TD',
    '  a["甲"]',
    '%% @file a "src/host/document.ts#35;applyOps"',
  ].join('\n'))
  check('老文件的 #35;applyOps 仍然解析成 #applyOps',
    legacy.nodes[0].files[0] === 'src/host/document.ts#applyOps', legacy.nodes[0].files)
  check('读进来再写出去 = 规整（老写法只活到下一次落盘）',
    serializeDoc(legacy).indexOf('"src/host/document.ts#applyOps"') >= 0)
}

console.log('\n[21] 仓库里那两张真图必须逐字节往返（最重要的回归断言）')
{
  // 这一条从前**没有任何断言守着**：解析器怎么改，只要 mermaid.test 那几条不红，
  // 那两张真图被悄悄改写也没人知道。钉的是「原样进、原样出」这条最强的性质：
  // serializeDoc(parseMermaid(原文)) === 原文，且零警告、往返检查为空。
  // **故意不钉节点/边/组的数量** —— 那是用户正在编辑的活图，他删两个节点就变成一条红灯，
  // 而红灯说的不是解析器坏了（这是第 [8] 节踩过的同一个坑）。
  for (const name of ['architecture.mmd', 'dsh-plugin-framework.mmd']) {
    const p = path.join(__dirname, '..', '.arch-canvas', name)
    check(name + ' 在仓库里', fs.existsSync(p))
    if (!fs.existsSync(p)) continue
    const text = fs.readFileSync(p, 'utf8')
    const d = parseMermaid(text)
    const out = serializeDoc(d)
    check(name + ' 解析零警告', d.warnings.length === 0, d.warnings)
    check(name + ' 往返检查为空（所有会被持久化的字段都写得出去）', roundTripDiff(d).length === 0, roundTripDiff(d))
    check(name + ' 逐字节往返：serializeDoc(parseMermaid(原文)) === 原文', out === text,
      { nodes: d.nodes.length, edges: d.edges.length, groups: d.groups.length, len: out.length, want: text.length, at: firstDiff(text, out) })
  }
}

console.log('\n[22] `%% @file` 值的专用 reader：unquoteRef 只解 qRef 会写出的东西')
{
  // finding 6：@file 的值从前走 unquote()（标签那套实体转义），于是
  // `src/a&amp;b.ts` → `src/a&b.ts`、`src/a#60;b.ts` → `src/a<b.ts`，第一次落盘就被改写。
  // 现在的口径：只解 qRef 真正会写出的（真引号 `#quot;`、换行 `<br/>`），加上老文件的 `#35;`。
  const plain = ['&amp;', '#60;', 'src/a&amp;b.ts', 'src/a#60;b.ts', 'a b', 'a\\b', '中文', '😀',
    'src/host/document.ts#applyOps', 'src/x.ts#sym'];
  for (const v of plain) {
    check('unquoteRef(qRef(x)) === x：' + JSON.stringify(v),
      unquoteRef(qRef(v)) === v, { out: qRef(v), back: unquoteRef(qRef(v)) });
  }
  check('真引号经 qRef → unquoteRef 原样回来', unquoteRef(qRef('带 "引号" 的路径.ts')) === '带 "引号" 的路径.ts');
  check('换行经 qRef → unquoteRef 原样回来', unquoteRef(qRef('a\nb')) === 'a\nb');
  check('qRef 不转义 & / #（人要在源码页里读这一行）',
    qRef('src/a&b.ts#sym') === '"src/a&b.ts#sym"', qRef('src/a&b.ts#sym'));

  // 老文件（0.6.x 及以前）写的是 #35; —— 必须照旧读得出来（AGENTS.md 的硬要求，[20] 也守着）
  check('老文件的 #35; 仍然解回 #',
    unquoteRef('"src/host/document.ts#35;applyOps"') === 'src/host/document.ts#applyOps');
  const legacyDoc = parseMermaid('flowchart TD\n  a["甲"]\n%% @file a "src/x.ts#35;sym"')
  check('老文件读进来再写出去 = 规整',
    serializeDoc(legacyDoc).indexOf('"src/x.ts#sym"') >= 0, serializeDoc(legacyDoc).split('\n').filter(l => l.indexOf('@file') === 0));

  // **已知的固有歧义**（取舍写在报告的「未做或不确定」里）：老文件的 `#35;` 与新文件里
  // **字面**写着的 `#35;` 长得一模一样，而 `#35;` 必须解回 `#`（否则老图读坏）。
  // 所以「值本身含这三个字面量」第一次落盘会被解释一次。这不是「没修」，是两个要求
  // 在数学上互斥；这里把它钉成**已定义**行为，并要求解一次之后永远稳定（不再每存一次变一次）。
  check('字面 #quot; 按老口径解成真引号（已定义行为）', unquoteRef(qRef('字面 #quot; x')) === '字面 " x');
  check('字面 #35; 按老口径解成 #（已定义行为）', unquoteRef(qRef('#35;')) === '#');
  check('字面 <br/> 按老口径解成换行（已定义行为）', unquoteRef(qRef('a<br/>b')) === 'a\nb');
  check('字面 <BR > 按老口径解成换行（已定义行为）', unquoteRef(qRef('a<BR >b')) === 'a\nb');
  for (const v of ['字面 #quot; x', '#35;', 'a<br/>b', 'a<BR >b']) {
    const once = unquoteRef(qRef(v));
    check('字面序列第二次往返稳定：' + JSON.stringify(v), unquoteRef(qRef(once)) === once, { once });
  }
}
endPhase();
