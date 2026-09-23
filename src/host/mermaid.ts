// Mermaid flowchart ⇄ 图模型 的双向转换（纯函数，不碰服务、不碰状态）。
// 关键约定：坐标存 `%% @pos <id> <x> <y>`、下钻存 `%% @link`、
// 代码锚点存 `%% @file <id> <路径>`（可带 `#符号`）、
// 整张图的一句话总结存 `%% @summary`（图级，不挂节点）
// —— 全是注释行，对 Mermaid 渲染零影响，
// 所以这份文本既是给 AI 看的图，也是能直接贴进任何 Markdown 的合法 Mermaid。
// 元素留言存旁路表（notes.json）；正文里的老式 %% @note / %% @done 仅作为迁移兜底解析。
// 头部那些**格式说明**行是 `%%!` 前缀：它们也是注释，但明确不是数据。
// Mermaid flowchart <-> 图模型 双向转换（host 侧使用；此处独立测试）
// 连接符表。**必须按长度降序**：`o---o` 排在 `o---` 前面，否则后者会先把字符抢走。
// 这里列的每一个，都是在真 Mermaid 11.16 上验过「`A <连接符> B` 合法、`A <连接符>|标签| B` 也合法」的
// （见 test/mermaid.test.cjs 的真 Mermaid 校验一节）：
//   - 圆头 / 交叉端点：`--o` `--x` `o--o` `x--x` `o--x` `x--o`，以及三横的代用形 `o---` `x---`
//     `o---o` `x---x` `o---x` `x---o` `o-->` `x-->`；
//   - 粗线端点：`o==o` `x==x` `o==>` `x==>` `==o` `==x`。
// **故意不收** `o--` / `x--` / `o==` / `x==`：真 Mermaid 判它们非法（`A o-- B` → Parse error），
// 收进来的话序列化出去就是一份非法 .mmd —— 少认一种语法，好过写出一份坏文件。
var ARROWS = [
  'o---o', 'x---x', 'o---x', 'x---o',
  '<==>', '<-->', '-.->', 'o--o', 'x--x', 'o--x', 'x--o',
  'o---', 'x---', 'o-->', 'x-->', 'o==o', 'x==x', 'o==>', 'x==>',
  '==>', '-->', '---', '~~~', '===', '--o', '--x', '==o', '==x',
];
// id 扫描时要在哪里收手：连接符的首字符（`-` `.`）现在也是合法 id 字符，
// 光看字符集分不出 `api-gateway` 的 `-` 和 `-->` 的 `-`，所以逐个位置比一遍连接符。
// `--` / `-.` 是**带标签的长写法**的开头（`A -- 文本 --> B` / `A -. 文本 .-> B`），也要算。
var ID_STOPS = ARROWS.concat(['--', '-.']);

/** 当前位置上匹配到的最长连接符（ARROWS 已按长度降序，取第一个命中即可）。 */
function matchArrowAt(line, i) {
  for (var a = 0; a < ARROWS.length; a++) {
    if (line.slice(i, i + ARROWS[a].length) === ARROWS[a]) return ARROWS[a];
  }
  return null;
}

// `link` / `click` / `direction` 在真 Mermaid 里**两头都能当**：既是节点 id
// （`link["L"]` / `link --> B` / `direction LR` 都合法），也是指令开头（`click A href "…"`）。
// 分辨办法：关键字后面**紧贴着**形状定界符 / 注解，或者跳过空白后是连接符 —— 就是节点；
// 否则是指令（进 extras）。真实测过：`link ["L"]`（中间有空格）Mermaid 自己判 ERR，
// 所以「紧贴」这条也跟真 Mermaid 对齐。
// `AMBIGUOUS_KEYWORD` / 指令闸门那几个正则的**定义挪到了 ID_RE 下面**：它们要拿同一份
// 「id 字符」集合拼出来 —— 见那里为什么不能再直接用 `\b`。

function keywordIsNode(line) {
  var m = /^(link|click|direction)\b([\s\S]*)$/.exec(line);
  if (!m) return false;
  var rest = m[2];
  // 关键字后面还有 id 字符（`link中["L"]` / `direction中`）：真 Mermaid 认它是个 id ——
  // 直接判成节点，归一（`n_link中`）交给 cleanId。用 `\b` 会把 `中` 当词边界，
  // 整行于是被当指令塞进 extras：节点丢，重启后 `%% @pos` / `%% @file` 也一起丢。
  if (rest !== '' && ID_RE.test(rest.charAt(0))) return true;
  if (/^(\[|\(|\{|>|:::|@\{)/.test(rest)) return true;
  var t = rest.replace(/^\s+/, '');
  if (t === '') return true;   // 裸 `direction` / `link`：Mermaid 认它是一个孤立节点
  return matchArrowAt(t, 0) !== null || t.slice(0, 2) === '--' || t.slice(0, 2) === '-.';
}

// Mermaid 11 的 `@{ shape: … }` 形状名 → 我们模型里的 8 种形状。
// 映射不到的一律丢注解 + 记警告（结构必须保住，样式可以丢）。
var AT_SHAPE_MAP = {
  rect: 'rect', square: 'rect',
  rounded: 'round', round: 'round',
  stadium: 'stadium', pill: 'stadium',
  circle: 'circle', doublecircle: 'circle', circ: 'circle',
  diamond: 'diamond', diam: 'diamond', rhombus: 'diamond', decision: 'diamond',
  hexagon: 'hex', hex: 'hex',
  cylinder: 'cyl', cyl: 'cyl', database: 'cyl', db: 'cyl',
  subroutine: 'sub', sub: 'sub', framed: 'sub',
  asym: 'asym', odd: 'asym',
};
var SHAPE_OPENERS = [
  ['((', '))', 'circle'],
  ['{{', '}}', 'hex'],
  ['[[', ']]', 'sub'],
  ['[(', ')]', 'cyl'],
  ['([', '])', 'stadium'],
  ['[', ']', 'rect'],
  ['(', ')', 'round'],
  ['{', '}', 'diamond'],
  ['>', ']', 'asym'],
];
var SHAPE_WRAP = {
  rect: ['[', ']'],
  round: ['(', ')'],
  stadium: ['([', '])'],
  circle: ['((', '))'],
  diamond: ['{', '}'],
  hex: ['{{', '}}'],
  cyl: ['[(', ')]'],
  sub: ['[[', ']]'],
  asym: ['>', ']'],
};
// id 里允许的字符。`-` `.` `/` 是真 Mermaid 认的 id 字符
// （`api-gateway --> db-primary`、`a.b --> c.d`、`a/b --> c` 都合法），
// 从前 ID_RE 一遇到它们就停 → scanNodeRef 返回 null → **整行进 extras**，画布上什么都没有。
// 收进来之后由 cleanId 把它们归成 `_`（见下），所以模型里的 id 仍然只有「字母/数字/下划线/CJK」。
var ID_RE = /[A-Za-z0-9_.\-\/\u00C0-\uFFFF]/;
// 「这一行是不是指令」的判据：关键字后面**是空白**才算指令。
//
// 不能用 `\b`（= 后面不是 [A-Za-z0-9_]）：它太宽 —— `link中["L"]` / `classDef中["L"]` /
// `style-1` 都会被判成指令，整行塞进 extras。真 Mermaid 认 `link中` 这个 id，
// 后果不是「画布上少个节点」：重开时 `%% @pos link中` / `%% @file link中` 被当成
// 「指向不存在的节点」丢掉，而那份多余的声明行每「打开→保存」一轮就多一行
// （实测 4 轮 3 行 / 350B → 6 行 / 401B，**无界增长**，而整份文件每一步都进提示词）。
//
// 「紧贴东西 = 不是指令」这条既安全又够用：真指令后面一定有内容（`style A fill:#f9f`、
// `classDef cls …`、`click A href "…"`），而关键字紧贴形状定界符 / 注解 / 连接符时
// （`style["L"]` / `classDef>「L」` / `link --> B`）真 Mermaid 只可能是节点/连线。
// 走节点解析之后由 cleanId 归一成 `n_style` / `n_classDef`，写出去的是合法 Mermaid。
var DIRECTIVE_TAIL = '(?=\\s)';
var DIRECTIVE_RE = new RegExp('^(classDef|class|style|linkStyle|click|link)' + DIRECTIVE_TAIL);
var AMBIGUOUS_KEYWORD = new RegExp('^(link|click|direction)' + DIRECTIVE_TAIL);
// subgraph 声明 / subgraph 内 `direction`：`subgraph中["L"]` 里 `subgraph中` 是真 Mermaid 拒收的
// id（lexer 见到 `subgraph` 就吃 token），必须让它走节点解析被归一成 `n_subgraph中` ——
// 按 `\b` 判的话它会被当成「组声明」，凭空造出一个叫 `中` 的组、节点丢了。
// 裸 `subgraph`（匿名组）是合法写法，所以这里额外允许行尾。
var SUBGRAPH_RE = new RegExp('^subgraph(?=\\s|$)');
var DIRECTION_RE = new RegExp('^direction' + DIRECTIVE_TAIL);
// 节点 id 到处都是当对象键用的（byId / posMap / grouped / seen），
// 而 `byId['__proto__']` 拿到的是 Object.prototype 而不是 undefined ——
// 那会让图里的 `__proto__` 节点被当成「已存在」并往原型上写字。出现就加前缀绕开。
var RESERVED_ID = /^(__proto__|constructor|prototype|toString|valueOf|hasOwnProperty)$/;
// Mermaid 自己的关键字。这些当节点 id 会坏掉，分两种坏法：
//   1. 写出的是**非法 Mermaid**（真 mermaid.parse 报 Parse error）：
//      `end` / `graph` / `flowchart` / `subgraph` / `style` / `class` / `classDef` /
//      `linkStyle` / `interpolate`，外加裸着当代价端点时的 `call` / `href`（`call --> B` 实测 Parse error）；
//   2. 我们自己的解析规则会吃掉整行：`link` / `click`（指令闸门）、`direction`（整行丢弃）、
//      `end`（被当成 subgraph 收尾）。
// 用 `n_` 前缀绕开。前缀在这里**一处**决定，而 cleanId 同时是「读文件」与「写文件」两侧的唯一入口
// （模型里的 id 就是 cleanId 的结果），所以同一个原始 id 两侧归一结果必然一致：
// `%% @pos end 10 20` 与图体里的 `end["L"]` 都落到 `n_end`，坐标照样找得回（含 `end` 的旧文件
// 加载→落盘后仍能找回它）。代价与 `__proto__` 那条一样：真有个节点叫 `n_end` 时会和 `end` 撞名，
// 但撞名由 claimNodeId 加后缀兜住（两条都活），而写坏文件的代价是不可逆的。
//
// 尾判据为什么是 `(?![A-Za-z0-9_])`：真 Mermaid 的 lexer 用 `\b` 判关键字（实测 11.16）——
// 关键字后面是 `[A-Za-z0-9_]` 才算普通 id（`endx` / `end_2` / `classDefx` 全都合法），
// 后面是**别的任何东西**（`end` 结尾、`end-`、`end中`、`end😀`）都被吃成关键字 token → 整行被拒。
// 它和上面闸门那条**故意不同**：闸门问「还能不能接 id」（CJK 也算 id 的一部分），
// 这里问「Mermaid 会不会把它吃成关键字」（CJK 不算 \w）。两条判据都是实测出来的。
var WORD_TAIL = '(?![A-Za-z0-9_])';
// 代理对码元（emoji 等 astral 平面字符）：cleanId 会把它们整对剔掉，真 Mermaid 也拒收。
var SURROGATE_RE = /[\uD800-\uDFFF]/;
// **唯一一张关键字表**（`test/mermaid.test.cjs` 逐个拿真 mermaid.parse 过一遍）。
// 长的排前面，别让 `class` 抢走 `classDef`（尾判据会兜住，显式排开更清楚）。
var MERMAID_KEYWORD_LIST = [
  'end', 'graph', 'flowchart', 'subgraph', 'classDef', 'class', 'linkStyle', 'style',
  'link', 'click', 'direction', 'interpolate', 'call', 'href',
];
var MERMAID_KEYWORDS = new RegExp('^(' + MERMAID_KEYWORD_LIST.join('|') + ')' + WORD_TAIL);
var KEYWORD_PREFIX = 'n_';

function cleanId(raw) {
  var s = String(raw == null ? '' : raw).trim();
  // 代理对（emoji 等 astral 平面字符）先整个剔掉：按 UTF-16 码元看，`😀` 的两个码元
  // （\uD83D \uDE00）都落在下面那条字符类的 \u00C0-\uFFFF 里，会被当合法 CJK 原样放行 ——
  // 而真 Mermaid 见到 `🚀["发布"]` 直接 Lexical error（我们却把它写进了文件，零警告）。
  // **label 里的 emoji 不走这里**，照旧原样合法（第 [23] 节钉着）。
  s = s.replace(/[\uD800-\uDFFF]/g, '');
  s = s.replace(/[^A-Za-z0-9_\u00C0-\uFFFF]/g, '_');
  if (s === '') s = 'n';
  if (/^[0-9]/.test(s)) s = 'n' + s;
  if (RESERVED_ID.test(s)) s = 'n' + s;
  if (MERMAID_KEYWORDS.test(s)) s = KEYWORD_PREFIX + s;
  return s;
}

/**
 * 归一后的 id 撞名时给**后来者**一个稳定后缀，两条都活下来（绝不改已有节点的名）。
 *
 * 为什么必须做：`a-b` / `a.b` / `a/b` 都归一到 `a_b`，`1` 归一到 `n1`（与真有个 `n1` 撞）——
 * 从前后写覆盖先写，用户写两个节点、读回来一个，**零警告**。`ensureNode` 只按 id 去重，
 * 它看不见「两个不同的原始写法」这件事。
 *
 * 后缀由「同一份文本里归一结果相同的第几处」决定，所以写出去（id 已经是 `a_b` / `a_b_2`）
 * 再读回来不会再分配，往返稳定。`owners` 是 `归一 id → 原始写法`；**同一个原始写法**重复出现
 * 不算撞名 —— 真 Mermaid 里 `a-b["甲"]` 与 `a-b["乙"]` 就是同一个节点，标签后写覆盖先写。
 */
function claimNodeId(owners, raw, warn) {
  var base = cleanId(raw);
  var existing = owners[base];
  if (existing === undefined) { owners[base] = raw; return base; }
  if (existing === raw) return base;
  var probe = 2;
  while (owners[base + '_' + probe] !== undefined) probe++;
  var id = base + '_' + probe;
  owners[id] = raw;
  warn('两个节点 id 归一后撞名：' + existing + ' 与 ' + raw + ' 都是 ' + base + '，已把 ' + raw + ' 改叫 ' + id + '（两条都保留）');
  return id;
}

// 标签转义是对称的：q() 写出去，unquote() 必须原样读回来。
// 顺序要紧 —— q() 先转义 & / # / < / " / `，最后才把换行写成 <br/>；
// unquote() 必须**严格倒着来**：先认 <br/>，再按 `#96;` → `#quot;`/`&quot;` → `#60;` → `#35;`
// 的顺序解实体，最后解 &amp;。任何一步提前都是静默漂移：
//   - `#35;` 跑在 `#60;` 前面 → 字面量 `#60;` 被解成 `<`（'x#60;y' → 'x<y'）；
//   - `&amp;` 跑在任何一步前面 → `&amp;quot;` 被二次解码成 `"`。
// 文件头部那几行「格式说明」也是 `%% @xxx …` 的形状（例如 `%% @note <节点id> <文本> …`）。
// 0.5.0 起说明行一律写成 `%%!`（见 serializeDoc），但 0.4.x 写出的文件里还是老形状 ——
// 不认它的话，每解析一次就凭空多一条「注释 @note <节点id> 指向图里不存在的节点」的假警告，
// 而这条假警告会出现在 arch_read 的返回值里。`<...>` 不可能是合法的节点 id，见到就当说明。
var LEGACY_TEMPLATE_RE = /^%%\s*@(pos|link|note|done|file)\s+<[^>]*>(\s|$)/;

// serializeDoc 每次都会重新写出的那行横幅。它自己也说「`%%!` 开头的是格式说明」——
// 所以解析时按**说明行**跳过（它不是数据），写出时由 serializeDoc 原样补回，两边对称。
// 不做这件事的后果：横幅会被当成一条普通 `%%` 注释推进 extras（见下面的注释保留），
// 于是文件头写一遍、文件尾又写一遍 —— 仓库里那两张真图立刻不再逐字节往返。
var HEADER_BANNER = '%% arch-canvas —— 由「架构画布」面板与 AI 共同维护（`%%!` 开头的是格式说明，不是图的内容）';

var SUMMARY_LIMIT = 500

/**
 * 一句话总结的规范化。它必须占**一行**（头部就是它的载体），而且会随每一步注入给 AI，
 * 所以换行、连续空白、超长都在这里一次收干净 —— 解析（读文件）与 normalizeModel
 * （读界面/AI 传上来的模型）两条路共用，两边不一致的话往返就不幂等。
 */
function cleanSummary(raw) {
  var s = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim()
  if (s.length > SUMMARY_LIMIT) s = s.slice(0, SUMMARY_LIMIT).trim()
  return s
}

var ENTITIES = [
  ['&', '&amp;'],
  ['#', '#35;'],
  ['<', '#60;'],
  ['"', '#quot;'],
  // 反引号：真 Mermaid 的 lexer 会把「引号后面紧跟一个 `」当成别的 token，
  // `n1["`arch_edit` 是默认"]` 直接 Lexical error —— 而往返检查完全安静（它只看模型，不看 Mermaid）。
  // `n1["#96;arch_edit#96; 是默认"]` 已实测合法。
  ['`', '#96;'],
];

/**
 * 引号剥离：是被引号包住的值就返回**引号内的原文**（一个字符都不 trim），否则返回 null。
 *
 * 为什么引号**外**的空白可以去掉、引号**内**的不行：`A[ "x" ]` 里那两处空白是语法
 * （真 Mermaid 也给 `x`），而 `A["  x  "]` 里的空白是**内容**（用户就要那两个空格）。
 * 只按引号的绝对首尾判会把 `A[ "x" ]` 读成 ` "x"`，再写出去就漂移了。
 */
function unquoteInner(text) {
  var s = String(text == null ? '' : text);
  var a = 0;
  var b = s.length;
  while (a < b && /\s/.test(s.charAt(a))) a++;
  while (b > a && /\s/.test(s.charAt(b - 1))) b--;
  if (b - a >= 2 && s.charAt(a) === '"' && s.charAt(b - 1) === '"') return s.slice(a + 1, b - 1);
  return null;
}

function unquote(text) {
  var s = String(text == null ? '' : text);
  var inner = unquoteInner(s);
  // 引号内的空白是内容，原样留；没引号的裸值按语法处理（去首尾空白）。
  // 从前这里不分青红皂白 trim 两端，于是标签 '  hello  ' 读回 'hello'、
  // ' ' 读回 '' 再被兜成节点 id —— persist() 每次保存都记一条 serialize.not-idempotent。
  s = (inner !== null) ? inner : s.trim();
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/#96;/g, '`').replace(/#quot;/g, '"').replace(/&quot;/g, '"');
  s = s.replace(/#60;/g, '<');
  s = s.replace(/#35;/g, '#');
  s = s.replace(/&amp;/g, '&');
  return s;
}

function q(label) {
  var s = String(label == null ? '' : label);
  for (var i = 0; i < ENTITIES.length; i++) s = s.split(ENTITIES[i][0]).join(ENTITIES[i][1]);
  s = s.replace(/\r?\n/g, '<br/>');
  return '"' + s + '"';
}

/**
 * 引号包住一个**元数据值**（现在只有 `%% @file <id> <路径>`）。
 *
 * 为什么不能直接用 `q()`：那条路上的 `#` 是**图里**的字符，Mermaid 会把它当实体转义的起点，
 * 所以必须写成 `#35;`。而 `%% @file` 的值在一行注释里，Mermaid 根本不看 —— 于是
 * `src/host/document.ts#35;applyOps` 这种写法只坑到**人**（源码页里看到的就是它），
 * 明明该是 `#applyOps`。这条值只由我们自己的解析器读回，所以只转义引号与换行。
 */
function qRef(value) {
  var s = String(value == null ? '' : value);
  s = s.split('"').join('#quot;');
  s = s.replace(/\r?\n/g, '<br/>');
  return '"' + s + '"';
}

/**
 * `%% @file` 值的专用 reader —— 与 `qRef()` 配对，**不是** `unquote()`。
 *
 * 从前这里走的是 `unquote()`，而那会把**标签**那套实体转义也解一遍：
 * `src/a&amp;b.ts` → `src/a&b.ts`、`src/a#60;b.ts` → `src/a<b.ts`，
 * 于是一个字面量路径第一次落盘就被改写。`@file` 的值在一行注释里、不经过 Mermaid，
 * 套那套转义只坑人（AGENTS.md 明写这条值不套标签实体转义）。
 *
 * 所以这里只解 `qRef()` 真正会写出的那几种：`#quot;` / `&quot;` / `<br/>` 各变体
 * （`#quot;` 对应真引号、`<br/>` 对应换行），**加上老文件的 `#35;`** ——
 * 0.6.x 及以前写的是它，AGENTS.md 写明老文件要能读、落盘时规整。
 * 守门人：test/mermaid.test.cjs 第 [20] 节 + 第 [21] 节。
 */
function unquoteRef(text) {
  var s = String(text == null ? '' : text);
  var inner = unquoteInner(s);
  s = (inner !== null) ? inner : s.trim();
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/#quot;/g, '"').replace(/&quot;/g, '"');
  // 老文件的 `#35;` 必须解回 `#`。代价是一条固有歧义：新文件里**字面**写着的 `#35;`
  // 与老文件的转义长得一模一样，只能按老文件解释（真路径里不会有这种字符）。
  s = s.replace(/#35;/g, '#');
  return s;
}

/**
 * 在双引号之外找 needle。
 * 标签里可以出现 `]` `)` `|` 这些定界符（序列化时一律加引号），
 * 直接 indexOf 会截在标签中间：节点或连线整行掉进 extras，而且是静默的。
 */
function indexOutsideQuotes(line, needle, from) {
  var inQuote = false;
  var last = line.length - needle.length;
  for (var i = from; i <= last; i++) {
    var ch = line.charAt(i);
    if (ch === '"') { inQuote = !inQuote; continue }
    if (!inQuote && line.slice(i, i + needle.length) === needle) return i;
  }
  return -1;
}

function scanNodeRef(line, start) {
  var n = line.length;
  var j = start;
  while (j < n && ID_RE.test(line.charAt(j))) {
    // `-` `.` 现在也是合法 id 字符（`api-gateway` / `a.b` / `a/b` 都是真 Mermaid 认的 id），
    // 但它们同时是连接符的首字符，光看字符集分不出来。已经吃掉至少一个字符之后，
    // 一旦这个位置上是一个连接符（或 `--` / `-.` 这两个带标签长写法的开头）就收手：
    //   `A-->B`  → id `A`，连接符 `-->`   （不准读成 id `A--`）
    //   `A-.->B` → id `A`，连接符 `-.->`  （不准读成 id `A-.`）
    //   `a-b-->c`→ id `a-b`，连接符 `-->` （`-` 只要不构成连接符就留在 id 里）
    // 首个字符不判：否则 `x` / `o` 开头的连接符会把 id 吃成空串。
    if (j > start) {
      var stops = false;
      for (var st = 0; st < ID_STOPS.length; st++) {
        if (line.slice(j, j + ID_STOPS[st].length) === ID_STOPS[st]) { stops = true; break; }
      }
      if (stops) break;
    }
    j++;
  }
  if (j === start) return null;
  var id = line.slice(start, j);
  var k = j;
  while (k < n && /\s/.test(line.charAt(k))) k++;
  for (var s = 0; s < SHAPE_OPENERS.length; s++) {
    var open = SHAPE_OPENERS[s][0];
    var close = SHAPE_OPENERS[s][1];
    var shape = SHAPE_OPENERS[s][2];
    if (line.slice(k, k + open.length) === open) {
      var cl = indexOutsideQuotes(line, close, k + open.length);
      if (cl !== -1) {
        // `raw` 是**原始写法**（归一之前）：claimNodeId 靠它区分「同一个 id 写了两次」
        // 与「两个不同写法归一到同一个 id」。
        return { id: cleanId(id), raw: id, label: unquote(line.slice(k + open.length, cl)), shape: shape, end: cl + close.length };
      }
    }
  }
  return { id: cleanId(id), raw: id, label: null, shape: null, end: j };
}

/**
 * 节点引用的**后缀注解**（Mermaid 11 新语法），就地改 ref 并返回扫描到哪儿为止。
 *
 *   - `id:::class` —— 类名是样式，我们模型里没有这个字段：**静默丢弃**（结构保住、样式可以丢，
 *     而且这类写法很多，报起来全是噪音）。可以连着写多个（`A:::a:::b`）。
 *   - `id@{ shape: …, label: … }` —— 能映射到已知形状的就用（`AT_SHAPE_MAP`），
 *     `label:` 是内容，取出来当节点标签。映射不了就丢注解并**记一条警告说明丢了什么**
 *     （不能静默：用户写了 hexagon、我们写成方块，他得知道）。
 *
 * 这两种写法从前整行进 extras：节点和边都不进模型，画布上什么都没有。
 */
function readRefAnnotations(line, ref, warn) {
  var n = line.length;
  var k = ref.end;
  for (;;) {
    var p = k;
    while (p < n && /\s/.test(line.charAt(p))) p++;
    if (line.slice(p, p + 3) === ':::') {
      var cEnd = p + 3;
      while (cEnd < n && /[\w-]/.test(line.charAt(cEnd))) cEnd++;
      if (cEnd === p + 3) break;   // `:::` 后面什么都没有：不认，交给主循环去失败
      k = cEnd;
      continue;
    }
    if (line.slice(p, p + 2) === '@{') {
      var close = indexOutsideQuotes(line, '}', p + 2);
      if (close === -1) break;
      var body = line.slice(p + 2, close);
      var sh = /shape\s*:\s*["']?([A-Za-z_][\w-]*)["']?/.exec(body);
      if (sh) {
        var mapped = AT_SHAPE_MAP[sh[1]];
        if (mapped) ref.shape = mapped;
        else warn('节点 ' + ref.id + ' 的 `@{ shape: ' + sh[1] + ' }` 没能对应到已知形状，注解已丢弃（节点本身保留）：' + line);
      }
      var lb = /label\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(body) || /label\s*:\s*'((?:[^'\\]|\\.)*)'/.exec(body);
      if (lb) ref.label = unquote('"' + lb[1].replace(/\\"/g, '#quot;').replace(/\\'/g, "'").replace(/\\n/g, '<br/>') + '"');
      else if (/label\s*:/.test(body)) warn('节点 ' + ref.id + ' 的 `@{ … }` 里 label 没能解析，注解已丢弃（节点本身保留）：' + line);
      k = close + 1;
      continue;
    }
    break;
  }
  return k;
}

function ensureNode(doc, byId, id, label, shape, group, fallbackLabel) {
  var node = byId[id];
  if (!node) {
    // 裸声明（`id --> B`，没有形状也没有标签）：标题取**用户写的原始写法**，不是归一后的 id。
    // `call --> B` 里 Mermaid 画的就是 `call`，我们不该把它改名成 `n_call` 摆到画布上 ——
    // id 必须归一（否则写出的是真 Mermaid 拒收的文件），标题不必跟着变。
    var title = (fallbackLabel === undefined || fallbackLabel === null || fallbackLabel === '') ? id : fallbackLabel;
    node = { id: id, label: title, shape: 'rect', group: null, x: null, y: null, link: null, note: '', noteDone: false, files: [] };
    byId[id] = node;
    doc.nodes.push(node);
  }
  if (label !== null && label !== undefined && label !== '') node.label = label;
  if (shape) node.shape = shape;
  if (group && !node.group) node.group = group;
  return node;
}

function addEdge(doc, from, to, arrow, label) {
  // **不去重**：源里写两遍 `A --> B`，Mermaid 画的就是两条平行的边；从前这里按
  // (from,to,label,arrow) 合并成一条，模型里塌掉了、落盘后只剩一行，**零警告**。
  // 允许重复之后往返仍然逐字节一致（两条一样的行写出去、读回来还是两条），
  // 而且用户看到的东西与 Mermaid 一致。边的 `id` 只是内存里的序号，不进文件、往返检查也排除它。
  var edge = {
    id: 'e' + (doc.edges.length + 1),
    from: from, to: to,
    label: label || '',
    arrow: arrow || '-->',
  };
  doc.edges.push(edge);
  return edge;
}

function scanStatements(line, doc, byId, group, warn, idOwners) {
  // 这一行中途解析失败时，已经塞进 doc 的节点/边要回滚 ——
  // 否则「原样保留到 extras」的那份文本会和半截模型同时存在，序列化出去就是重复内容。
  var nodesBefore = doc.nodes.length;
  var edgesBefore = doc.edges.length;
  // 光按长度截断只回滚**本行新增**的节点：ensureNode 对**已存在**节点的 label / shape / group
  // 是原地改的，坏行（`A["新标签"] ?!`）会把新标签留在干净节点行上 —— 于是文件里
  // 同时有 `A["新标签"]` 和 `A["新标签"] ?!`，而往返检查因为定点而完全安静。
  // 所以先把这些字段记一份，失败时逐个恢复。
  var snapshot = {};
  for (var si = 0; si < doc.nodes.length; si++) {
    var sn = doc.nodes[si];
    snapshot[sn.id] = { label: sn.label, shape: sn.shape, group: sn.group };
  }

  function fail() {
    for (var k = doc.nodes.length - 1; k >= nodesBefore; k--) delete byId[doc.nodes[k].id];
    doc.nodes.length = nodesBefore;
    doc.edges.length = edgesBefore;
    for (var sk in snapshot) {
      var ex = byId[sk];
      if (!ex) continue;
      ex.label = snapshot[sk].label;
      ex.shape = snapshot[sk].shape;
      ex.group = snapshot[sk].group;
    }
    return false;
  }

  var i = 0;
  var n = line.length;
  var groupIds = [];   // 当前这一串并列节点（`A & B -->`），它们是一段连线的源
  var pending = null;  // { froms, arrow, label }：箭头右边正在接的那一串
  var joined = false;  // 刚见过 `&`：下一个节点属于同一串
  while (i < n) {
    while (i < n && /\s/.test(line.charAt(i))) i++;
    if (i >= n) break;

    // `;` 语句分隔符（在扫描器内处理，这样标签里的 `#quot;` 之类实体不会被误切）
    if (line.charAt(i) === ';') { i++; groupIds = []; pending = null; joined = false; continue; }

    // `-- 文本 -->` 形式。**只在当前位置不是真连接符时**才当它：`--o` / `--x` 也是 `--` 开头，
    // 而它们后面很可能还有一条 `-->`（`A --o B --> C`）—— 先走带标签长写法就会把
    // `o B` 当成标签、把 `A --o B` 整段吃掉（加新箭头时差点漏掉的一条）。
    if (line.slice(i, i + 2) === '--' && matchArrowAt(line, i) === null) {
      var stop = indexOutsideQuotes(line, '-->', i + 2);
      if (stop !== -1) {
        if (groupIds.length === 0) return fail();
        pending = { froms: groupIds.slice(), arrow: '-->', label: unquote(line.slice(i + 2, stop)) };
        groupIds = [];
        joined = false;
        i = stop + 3;
        continue;
      }
    }

    // `-. 文本 .->` 形式（带标签的虚线长写法；`-.->` 走下面的连接符表）
    if (line.slice(i, i + 2) === '-.' && matchArrowAt(line, i) === null) {
      var dstop = indexOutsideQuotes(line, '.->', i + 2);
      if (dstop !== -1) {
        if (groupIds.length === 0) return fail();
        pending = { froms: groupIds.slice(), arrow: '-.->', label: unquote(line.slice(i + 2, dstop)) };
        groupIds = [];
        joined = false;
        i = dstop + 3;
        continue;
      }
    }

    // 连接符
    var arrow = matchArrowAt(line, i);
    if (arrow !== null) {
      if (groupIds.length === 0) return fail();
      i += arrow.length;
      var label = '';
      while (i < n && /\s/.test(line.charAt(i))) i++;
      if (line.charAt(i) === '|') {
        var bar = indexOutsideQuotes(line, '|', i + 1);
        if (bar === -1) return fail();
        label = unquote(line.slice(i + 1, bar));
        i = bar + 1;
      }
      pending = { froms: groupIds.slice(), arrow: arrow, label: label };
      groupIds = [];
      joined = false;
      continue;
    }

    // `&` 并列：左边（`A & B --> C`）和右边（`A --> B & C`）都靠它
    if (line.charAt(i) === '&') { i++; joined = true; continue; }

    // `o--` / `x--` / `o==` / `x==`：端点只写一半的**非法**连接符（真 Mermaid 判 Parse error，
    // 所以不进 ARROWS）。但 `o` / `x` 自己是合法 id 字符，落到 scanNodeRef 就会把
    // `A o-- B` 读成 `A` + 节点 `o` + 节点 `__` + 节点 `B`（一行垃圾长出四个幽灵节点）。
    // 合法的那几种（`o--o` `o---` `o-->` …）在上面 matchArrowAt 已经被匹配走了，走到这里必是坏的。
    if (/^[ox](--|==)/.test(line.slice(i))) return fail();

    var ref = scanNodeRef(line, i);
    if (ref === null) return fail();
    i = readRefAnnotations(line, ref, warn);
    // 归一撞名（`a-b` 与 `a.b` → `a_b`）：给后来者加稳定后缀，两条都活下来并出声。
    ref.id = claimNodeId(idOwners, ref.raw, warn);
    // id 被归一成**别的**东西时，只在用户会看不懂的两类上出声：保留字 / emoji。
    // `api-gateway` → `api_gateway` 这类是既有口径（真 Mermaid 认它，语义无损、量大），
    // 加了就是噪音 —— 第 [24] 节明写这条语料必须零警告。
    // 而「你的节点被改叫 n_end / n 了」必须说，否则用户在画布上找不到它。
    if (ref.id !== ref.raw && (MERMAID_KEYWORDS.test(ref.raw) || SURROGATE_RE.test(ref.raw))) {
      warn('节点 id ' + ref.raw + ' 是 Mermaid 保留字或含 emoji（真 Mermaid 会拒收），已归一成 ' + ref.id);
    }
    var node = ensureNode(doc, byId, ref.id, ref.label, ref.shape, group, ref.raw);
    if (pending) {
      if (groupIds.length > 0 && !joined) {
        // `A --> B C` 这种写法 Mermaid 自己也不认：不凭空造一条 A --> C，
        // 把 C 当成新一段的开头（节点照收），并记一笔让人能发现。
        warn('这行里的 ' + node.id + ' 没有用 `&` 与前一个节点并列，已按新的一段处理：' + line);
        pending = null;
        groupIds = [node.id];
        continue;
      }
      for (var f = 0; f < pending.froms.length; f++) {
        addEdge(doc, pending.froms[f], node.id, pending.arrow, pending.label);
      }
      if (joined) groupIds.push(node.id); else groupIds = [node.id];
      joined = false;
      continue;  // pending 留着：`A --> B & C` 的 C 还要从同一批源连过来
    }
    if (joined) groupIds.push(node.id); else groupIds = [node.id];
    joined = false;
  }
  return true;
}

function parseMermaid(text) {
  var doc = { nodes: [], edges: [], groups: [], extras: [], direction: 'TD', warnings: [], summary: '', legacyNotes: {} };
  var byId = {};
  var stack = [];
  // 坐标与下钻先存着，等图体读完再挂到真有的节点上。
  // 读到注释就 ensureNode 的后果是：节点删了、注释忘了删，节点会凭注释复活写回图里。
  // 这几个表的 key 是**用户原文里的 id**（`\S+`），可能是 `__proto__` 这种名字 ——
  // 查表命中 Object.prototype 会静默读错值，所以一律用**无原型对象**。
  var posMap = Object.create(null);
  var linkMap = Object.create(null);
  // 老式注释（%% @note / %% @done）收进 legacyNotes 供迁移，不再挂到节点上。
  var legacyNotes = {};
  // 代码锚点（%% @file）与注释不同：**一个节点可以有多条**，所以存成数组、按出现顺序保留。
  var filesMap = Object.create(null);
  // `归一 id → 原始写法`：归一撞名时（`a-b` / `a.b` / `a/b` 都到 `a_b`）靠它给后来者
  // 加稳定后缀，两条都活下来（详见 claimNodeId）。
  var idOwners = Object.create(null);
  // 组 id 去重（保留第一条，与 normalizeModel 同口径）：同一个 id 的第二个 subgraph
  // 从前会整块写第二遍 —— 成员行、`%% @pos` / `%% @link` / `%% @file` 全写两遍，
  // 而往返检查因为「重解析还是两个组」判不出异常（零警告）。
  var groupSeen = {};
  function warn(message) {
    if (doc.warnings.length < 50) doc.warnings.push(message);
  }
  var raw = String(text == null ? '' : text).split(/\r?\n/);
  for (var li = 0; li < raw.length; li++) {
    var line = raw[li].trim();
    if (line === '') continue;
    // serializeDoc 每次都重写的那行横幅：它是**格式说明**，不是数据。
    // 不跳过的后果见 HEADER_BANNER 的注释（会被当普通注释留在 extras 里、文件尾再写一遍）。
    if (line === HEADER_BANNER) continue;
    if (line.slice(0, 3) === '%%!') continue;
    if (line.slice(0, 2) === '%%') {
      // 格式说明行（本文件头部那几行模板）不是数据 —— 见 LEGACY_TEMPLATE_RE。
      if (LEGACY_TEMPLATE_RE.test(line)) continue;
      // **墓碑行 `%% @deleted` 是文档级标记，不是内容，绝不能进 extras。**
      // 它由 document.ts 的 TOMBSTONE 写在文件最前面、由 hasTombstone 从行首读。
      // 落到下面那个「未知 %% 行原样留进 extras」的兜底，就会在**恢复**（把行首那一行摘掉）
      // 之后的下一次保存里从 extras 写回文件末尾 —— 用户点了「恢复」，过一会儿它自己又变回已删除，
      // 而且文件里出现两条墓碑。2026-09-24 合并四批改动时实测到（`doc:restore` 后 `doc:set`，
      // 墓碑从行首跑到第 309 字节）。删掉这一行就是**真的**恢复。
      if (/^%%\s*@deleted\b/.test(line)) continue;
      // `%%{init:…}%%` 这类配置指令：Mermaid 合法文本，我们模型里没有它的字段。
      // 从前是 `continue` —— 用户没删、落盘时自己没了（渲染主题也跟着没了）。
      // 一律原样留进 extras：结构保住，位置从行内挪到文件尾（往返仍然幂等）。
      if (line.slice(0, 3) === '%%{') { doc.extras.push(line); continue; }
      // %% @summary <一句话>：这张图讲的是什么。**图级**的，不挂节点，所以没有幽灵问题；
      // 写多条时后面那条说了算（与 @note 一致）。
      var sm = /^%%\s*@summary\s+(.*)$/.exec(line);
      if (sm) {
        doc.summary = cleanSummary(unquote(sm[1]));
        continue;
      }
      // 尾部内容也不许无声吞掉：坐标照样收下（用户摆的坐标不能因为多打两个字就消失），
      // 但多出来的那段要出声。`$` 锚是**故意不加**的 —— 加了就是「整行没匹配上 = 坐标全丢」。
      // 数值部分用**严格十进制**（`-?\d*\.?\d+`）而不是从前的 `-?[0-9.]+`：
      // 字符类会放行 `.`（parseFloat('.') === NaN）与 `1.2.3`（parseFloat 读成 1.2），
      // 到不了盘上的是 NaN（serializeDoc 有 isFinite 闸），于是用户写的
      // `%% @pos A . .` **零警告消失**；`1.2.3` 更坏：静默改写成 `1`。
      // 解析出来不有限就**不 continue**，落到下面那条「没能解析」分支出声（不许静默消失）。
      var pm = /^%%\s*@pos\s+(\S+)\s+(-?\d*\.?\d+)\s+(-?\d*\.?\d+)(.*)$/.exec(line);
      if (pm) {
        var px = parseFloat(pm[2]);
        var py = parseFloat(pm[3]);
        if (isFinite(px) && isFinite(py)) {
          // 注释行里的 id 按**原始写法**记账（不是归一结果）：撞名时（`a-b` 与 `a.b` 都归一成
          // `a_b`，后者被改叫 `a_b_2`）只有原始写法能把 `%% @pos a.b …` 认回正确的那一个。
          posMap[pm[1]] = { x: px, y: py };
          if (pm[4] && pm[4].trim()) {
            warn('第 ' + (li + 1) + ' 行 @pos 尾部还有内容没能解析，已忽略（坐标照收）：' + pm[4].trim());
          }
          continue;
        }
      }
      // %% @link <节点id> <另一张图的名字>：把这个节点下钻到那张图
      var lm = /^%%\s*@link\s+(\S+)\s+(.+)$/.exec(line);
      if (lm) {
        linkMap[lm[1]] = unquote(lm[2]);
        continue;
      }
      // 老式 %% @note / %% @done 行收进 legacyNotes，供迁移期兜底
      var nm = /^%%\s*@(note|done)\s+(\S+)\s+(.*)$/.exec(line);
      if (nm) {
        // legacyNotes 由旁路表按**节点 id** 关联，所以这里保持归一（迁移只看归一结果）。
        legacyNotes[cleanId(nm[2])] = { text: unquote(nm[3]), done: nm[1] === 'done' };
        continue;
      }
      // %% @file <节点id> "<项目相对路径>[#符号]"：这个节点对应哪段源码。
      // 同一个节点可以写多条 —— 一个「模块」常常落在好几个文件里。
      // 值走 unquoteRef()：**不是**标签那套实体转义（见 qRef 的注释）。
      var fm = /^%%\s*@file\s+(\S+)\s+(.*)$/.exec(line);
      if (fm) {
        var fref = unquoteRef(fm[2]);
        if (fref) {
          if (!filesMap[fm[1]]) filesMap[fm[1]] = [];
          filesMap[fm[1]].push(fref);
        }
        continue;
      }
      // 走到这儿既不是 %%!、也不是上面任何一种 **解析成功** 的元数据。两种可能：
      //   1. 形如 `%% @<已知字段>` 但写法坏了（`%% @pos a b 1 2` 的 id 含空格、
      //      `%% @pos a 1e5 2` 的科学计数法、`%% @file a` 缺路径…）—— 这必须出声，
      //      否则用户摆好的坐标 / 锚点会无声消失；
      //   2. 一条普通 `%%` 注释 —— 同样是用户写的东西，原样留进 extras，不许静默丢弃。
      //      （`%%!` 说明行与 HEADER_BANNER 上面已经跳过。）
      var km = /^%%\s*@(summary|pos|link|note|done|file)\b/.exec(line);
      if (km) {
        var why = {
          summary: '后面要跟一句话',
          pos: 'id 不能含空格、坐标必须是两个数字',
          link: '后面要跟 `<节点id> <图名>`',
          note: '后面要跟 `<节点id> <文本>`',
          done: '后面要跟 `<节点id> <文本>`',
          file: '后面要跟 `<节点id> <路径>`',
        }[km[1]];
        warn('第 ' + (li + 1) + ' 行的 %% @' + km[1] + ' 没能解析（' + why + '），已丢弃：' + line);
        continue;
      }
      doc.extras.push(line);
      continue;
    }
    // 图类型声明。**必须整行都是声明**才算：`graph["L"]` / `flowchart["L"]` 是（非法 Mermaid 的）
    // 节点声明，从前的 `^(flowchart|graph)\b` 会把它们当声明吞掉 —— 节点凭空消失、连 extras 都不进。
    if (/^(flowchart|graph)\b/.test(line)) {
      var dm = /^(?:flowchart|graph)(\s+(?:TB|TD|BT|RL|LR))?\s*$/.exec(line);
      if (dm) {
        if (dm[1]) doc.direction = dm[1].trim() === 'TB' ? 'TD' : dm[1].trim();
        continue;
      }
    }
    if (SUBGRAPH_RE.test(line)) {
      var rest = line.slice(8).trim();
      var gref = scanNodeRef(rest, 0);
      // 下面两种情况都**不是** subgraph 声明，而是（真 Mermaid 拒收的）节点/连线写法，
      // 不能拿它们凭空造一个匿名组 —— 那会把后面的节点整个吞掉：
      //   `subgraph["L"]`：紧跟着形状定界符；
      //   `subgraph --> B`：紧跟着连接符（scanNodeRef 会把 `-->` 当 id 读成 `___`）。
      // 放它走节点解析，`subgraph` 才会经 cleanId 归一成 `n_subgraph`、B 与这条边才留得住。
      var badDecl = !gref ? (rest !== '' && /^[\[\(\{>]/.test(rest)) : matchArrowAt(rest, 0) !== null;
      if (!badDecl) {
        var gid;
        var glabel;
        if (gref && gref.label !== null) { gid = gref.id; glabel = gref.label; }
        else if (gref) { gid = gref.id; glabel = rest; }
        else { gid = 'g' + (doc.groups.length + 1); glabel = rest; }
        // 空 / 纯空白的组 label 归一到组 id：`subgraph g1[""]` 是非法 Mermaid，
        // 而 `subgraph g1[" "]` 回读会被 normalizeModel / 序列化两侧来回拉扯（每次保存都报 roundTripDiff）。
        // 「没有名字的组」在这一处定义 = 组 id，读写共用。
        if (glabel == null || String(glabel).trim() === '') glabel = gid;
        // 重复的组 id 保留第一条（与 normalizeModel 同口径）。`stack` 照样 push —— 不 push 的话
        // `end` 的配对会错位，后面所有节点都会被挂到错误的组上。
        if (!groupSeen[gid]) {
          groupSeen[gid] = true;
          doc.groups.push({ id: gid, label: glabel });
        } else {
          warn('重复的组 id ' + gid + '：第二处 subgraph 已并入第一处（保留第一次的组名）');
        }
        stack.push(gid);
        continue;
      }
    }
    if (line === 'end') { stack.pop(); continue; }
    // 指令行（样式 / 类 / 点击跳转）。这几个关键字里 `style` / `class` / `classDef` / `linkStyle`
    // 真 Mermaid 根本不允许当 id；`link` / `click` / `direction` 允许 —— 但只在
    // `link["L"]` / `link --> B` / `direction LR` 这种形状下（前者是节点，后者是指令）。
    // 分不清就交给下面：真指令进 extras，关键字 id 走节点解析并归一成 `n_link`。
    // 闸门用的是 `DIRECTIVE_RE`（尾判据 = 「后面是空白」），不是 `\b` —— 见上面那条说明。
    if (DIRECTIVE_RE.test(line)) {
      if (!(AMBIGUOUS_KEYWORD.test(line) && keywordIsNode(line))) { doc.extras.push(line); continue; }
    }
    // subgraph 内的 `direction LR`：模型里没有「每个组自己的方向」这个字段，
    // 所以只能原样留进 extras —— 但从前的 `continue` 是**静默丢弃**，用户没删、落盘时自己没了。
    if (DIRECTION_RE.test(line)) {
      if (!keywordIsNode(line)) { doc.extras.push(line); continue; }
    }
    var group = stack.length > 0 ? stack[stack.length - 1] : null;
    if (!scanStatements(line, doc, byId, group, warn, idOwners)) {
      doc.extras.push(line);
      warn('这行没能解析成节点或连线，已按原文原样保留：' + line);
    }
  }
  // 注释里的坐标/下钻只挂在图里真有的节点上；图里没有的注释（多半是删节点时忘了删）就此丢弃，
  // 序列化时自然不再写出去 —— 这就是「幽灵节点」的出口。
  // 三个 map 的 key 是**原始写法**，所以先按节点自己的原始写法找（撞名时才对得上），
  // 找不到再退回归一结果（老文件里 `%% @pos a_b` 配 `a-b["甲"]` 那种写法）。
  var rawOwned = Object.create(null);
  for (var ok in idOwners) rawOwned[idOwners[ok]] = true;
  for (var pi = 0; pi < doc.nodes.length; pi++) {
    var pn = doc.nodes[pi];
    var praw = idOwners[pn.id];
    var pos = (praw !== undefined && posMap[praw]) ? posMap[praw] : posMap[pn.id];
    if (pos) { pn.x = pos.x; pn.y = pos.y }
    var lnk = (praw !== undefined && linkMap[praw]) ? linkMap[praw] : linkMap[pn.id];
    if (lnk) pn.link = lnk;
    var fls = (praw !== undefined && filesMap[praw]) ? filesMap[praw] : filesMap[pn.id];
    if (fls) pn.files = fls.slice();
  }
  for (var pid in posMap) if (!byId[cleanId(pid)] && !rawOwned[pid]) warn('坐标注释 @pos ' + pid + ' 指向图里不存在的节点，已丢弃');
  for (var lid in linkMap) if (!byId[cleanId(lid)] && !rawOwned[lid]) warn('下钻注释 @link ' + lid + ' 指向图里不存在的节点，已丢弃');
  for (var fid3 in filesMap) if (!byId[cleanId(fid3)] && !rawOwned[fid3]) warn('代码锚点 @file ' + fid3 + ' 指向图里不存在的节点，已丢弃');
  doc.legacyNotes = legacyNotes;
  var cleanNodes = [];
  for (var i = 0; i < doc.nodes.length; i++) {
    var nd = doc.nodes[i];
    cleanNodes.push({
      id: nd.id, label: nd.label, shape: nd.shape, group: nd.group, x: nd.x, y: nd.y,
      link: nd.link || null, note: nd.note || '', noteDone: nd.noteDone === true,
      files: (nd.files || []).slice(),
    });
  }
  doc.nodes = cleanNodes;
  return doc;
}

function nodeText(node) {
  // 写文件这一侧也过 cleanId —— 「读文件」与「写文件」必须对同一个原始 id 得到同一个归一结果。
  // 模型里的 id 本该已经归一（parseMermaid 与 normalizeModel 都调 cleanId），这里是第二道闸：
  // 万一哪个调用点漏了，写出去的仍是一份合法 .mmd，而不是 `end["L"]` 这种真 Mermaid 直接拒收的行。
  var id = cleanId(node.id);
  var wrap = SHAPE_WRAP[node.shape] || SHAPE_WRAP.rect;
  // 空 label 无条件写成 `n1[""]` —— 真 Mermaid 直接 Parse error（见 test 里的真 Mermaid 校验一节）。
  // 「没有标签」在这份文本里只有一种合法表达：**不写标签**，读回来就等于节点 id
  // （解析器本来就是这个口径：ensureNode 只在 label 非空时才覆盖 id）。
  // 所以这里退化成 id，形状照旧保留（不能为了空标签把形状一起丢掉）。
  var label = node.label;
  if (label === null || label === undefined || label === '') label = id;
  return id + wrap[0] + q(label) + wrap[1];
}

function serializeDoc(doc) {
  var nodes = doc.nodes || [];
  var groups = doc.groups || [];
  var edges = doc.edges || [];

  // 节点输出顺序：分组块优先、组内保持原序，剩下的按原序。
  // @pos / @link 注释与图体共用这个顺序 —— 两处不一致的话，同一份文件每往返一次就重排一次。
  var blocks = [];
  var grouped = {};
  // 同一个组 id 只写一块。模型里有两个同 id 的组时（老文件 / 界面传来的模型），
  // 从前每个组各写一遍成员行与 `%% @pos` / `%% @link` / `%% @file`，而往返检查因为
  // 「重解析还是两个组」判不出异常 —— 零警告地写出重复内容。保留第一条，与
  // normalizeModel / parseMermaid 同口径。节点归属不受影响：两个组的成员都进第一块。
  var seenGroup = {};
  for (var g = 0; g < groups.length; g++) {
    var grp = groups[g];
    var gkey = cleanId(grp.id);
    if (seenGroup[gkey]) continue;
    seenGroup[gkey] = true;
    var members = [];
    for (var m = 0; m < nodes.length; m++) {
      if (nodes[m].group === grp.id) { members.push(nodes[m]); grouped[nodes[m].id] = true; }
    }
    // 空组也要写出去。从前这里是 `if (members.length > 0)`，于是「删掉一个组的最后一个成员」
    // 或「把最后一个成员移出组」之后，doc.groups 里留着的那个组**写不进文件** ——
    // 下次读回来它就静默消失了（组名、标签全没）。解析器本来就认空组（它从 subgraph 行建组），
    // 是序列化器单方面不写：两边不对称，就是一条静默丢数据的路。
    // 这一条不是我读出来的，是写盘前的往返检查 roundTripDetail() 当场报出来的。
    blocks.push({ group: grp, members: members });
  }
  var loose = [];
  for (var k = 0; k < nodes.length; k++) {
    if (!grouped[nodes[k].id]) loose.push(nodes[k]);
  }
  var seq = [];
  for (var b = 0; b < blocks.length; b++) {
    for (var bi = 0; bi < blocks[b].members.length; bi++) seq.push(blocks[b].members[bi]);
  }
  for (var l = 0; l < loose.length; l++) seq.push(loose[l]);

  var out = [];
  // 头部这几行是**写给人的格式说明**，不是数据：一律用 `%%!` 前缀，解析器见到就整行跳过。
  // 为什么需要这个前缀 —— 这些行本来就长着 `%% @note <节点id> …` 的样子，早先真的被解析成
  // 「一条指向 <节点id> 这个不存在节点的注释」，于是每读一次文件就多一条假警告。
  out.push(HEADER_BANNER);
  out.push('%%! @summary <一句话> 这张图讲的是什么 —— 会随每一步注入给 AI');
  out.push('%%! @pos <节点id> <x> <y> 是画布坐标注释，@link <节点id> <图名> 是下钻到另一张图');
  out.push('%%! @file <节点id> <路径> 是这个节点对应的源码文件（可带 #符号），一个节点可多条');
  out.push('%%! 以上对 Mermaid 渲染都无任何影响，可忽略或手改');
  // 一句话总结紧跟头部：它描述整张图，所以写在所有节点级注释**之前**（人一眼就看到这张图是干嘛的）。
  var docSummary = cleanSummary(doc.summary)
  if (docSummary) out.push('%% @summary ' + q(docSummary));
  for (var i = 0; i < seq.length; i++) {
    var n = seq[i];
    if (typeof n.x === 'number' && typeof n.y === 'number' && isFinite(n.x) && isFinite(n.y)) {
      out.push('%% @pos ' + cleanId(n.id) + ' ' + Math.round(n.x) + ' ' + Math.round(n.y));
    }
  }
  // 下钻链接也走注释 —— 对 Mermaid 渲染同样零影响，文件仍是合法 Mermaid
  for (var lk = 0; lk < seq.length; lk++) {
    if (seq[lk].link) out.push('%% @link ' + cleanId(seq[lk].id) + ' ' + q(seq[lk].link));
  }
  // 代码锚点：一个节点可多条，按「节点顺序 + 引用自身顺序」写出（顺序稳定，往返才幂等）。
  for (var ft = 0; ft < seq.length; ft++) {
    var frefs = seq[ft].files || [];
    for (var fr = 0; fr < frefs.length; fr++) {
      if (frefs[fr]) out.push('%% @file ' + cleanId(seq[ft].id) + ' ' + qRef(frefs[fr]));
    }
  }
  out.push('flowchart ' + (doc.direction || 'TD'));
  for (var bb = 0; bb < blocks.length; bb++) {
    // 组 label 为空 / 纯空白时退化成组 id：`subgraph g1[""]` 是非法 Mermaid，
    // `subgraph g1[" "]` 回读会被归一（见 parseMermaid），不统一就是每次保存都报 roundTripDiff。
    var gid = cleanId(blocks[bb].group.id);
    var glabel = blocks[bb].group.label;
    if (glabel == null || String(glabel).trim() === '') glabel = gid;
    out.push('  subgraph ' + gid + '[' + q(glabel) + ']');
    for (var bm = 0; bm < blocks[bb].members.length; bm++) {
      out.push('    ' + nodeText(blocks[bb].members[bm]));
    }
    out.push('  end');
  }
  for (var lo = 0; lo < loose.length; lo++) out.push('  ' + nodeText(loose[lo]));
  for (var e = 0; e < edges.length; e++) {
    var edge = edges[e];
    // 连接符与两端 id 同样过闸：拿了模型里没有的箭头（比如半截的 `o--`，真 Mermaid 判它非法）
    // 就退回默认 `-->`，别把一份坏文件写出去。两端 id 走 cleanId，与图体保持同一个口径。
    var arrow = matchArrowAt(String(edge.arrow || ''), 0) === (edge.arrow || '') ? (edge.arrow || '-->') : '-->';
    var tail = edge.label ? arrow + '|' + q(edge.label) + '|' : arrow;
    out.push('  ' + cleanId(edge.from) + ' ' + tail + ' ' + cleanId(edge.to));
  }
  var extras = doc.extras || [];
  for (var x = 0; x < extras.length; x++) out.push('  ' + extras[x]);
  return out.join('\n') + '\n';
}

// ==================== 往返守恒检查（写盘前的运行时不变式） ====================
//
// 这是「往返幂等」的运行时版本。它的价值不在解析器，而在**抓住「某个字段写不出去」**：
// 2026-09 我们连续踩了三次同一类坑（拖拽丢 files/note/link、自动布局丢 4 个字段、
// add_node 丢组名），每一次都是「用户下次打开发现东西没了」，**中间不报任何错**。
// 三次都是事后靠测试补的 —— 而测试只覆盖已知字段，新字段没人写测试就等于没人拦。
//
// 立意上和「字段白名单」相反：白名单列的是**要保留**的（漏一个就静默清空），
// 这里列的是**故意不落盘的运行期字段**（漏一个会吵，方向是安全的）。
var RUNTIME_ONLY_FIELDS = [
  'file', 'name', 'tombstoned', 'absent', 'external', 'warnings', 'notes',
  'fileStatus', 'revision', 'updatedBy', 'updatedAt', 'legacyNotes',
  // 锚点保鲜报告（见 drift.ts）：同样是派生数据，一次落盘都不进文件。
  // 漏一个的后果不是「多写一行」——是**每次保存都误报** serialize.not-idempotent。
  'drift',
  // 这份文档属于哪个工作区（会话隔离用，见 document.ts）：纯运行期信息，不进文件。
  // 漏了它同样每存必报 —— 2026-09-23 加会话隔离时当场踩到（就是这条守门人逮住的）。
  'workspace',
]

// 节点上这两个字段**不由这份文本承载**：留言存在旁路表 notes.json 里（见 notes.ts），
// 按节点 id 关联。往返检查必须把它们排除，否则每一张有留言的图都会误报 ——
// 这正是「会被持久化」和「会写进这份文本」的区别，也是这条检查最容易踩空的地方。
var OUT_OF_BAND_NODE_FIELDS = ['note', 'noteDone']

// 边的 id 也是派生的：`'e' + (edges.length + 1)`，每次解析都会重新编号，而且**不进文件**
// （文件里只写 `from --> to`），代码里寻址一律按 from/to。所以它不是状态，别拿去比。
var OUT_OF_BAND_EDGE_FIELDS = ['id']

/** 边的排序键：id 可能重复（同名 from/to 的并列边），所以带上两端。 */
function edgeSortKey(e: any) {
  if (!e || typeof e !== 'object') return ''
  return String(e.from) + '\u0000' + String(e.to) + '\u0000' + String(e.id)
}

/** 键序无关的 JSON —— 内存模型与回读模型的键序天然不同，直接 stringify 会把它们判成不等。 */
function stableJson(v) {
  if (v === undefined) return 'null'
  if (v === null || typeof v !== 'object') {
    // 非有限的数字（NaN / ±Infinity）：`JSON.stringify` 一律写成 `null`，于是
    // 「模型里是 NaN、回读是 null」被判成相等 —— 往返检查对这类漂移完全瞎。
    // 显式写一个不可能与真值撞车的哨兵，让差异看得见。
    if (typeof v === 'number' && !isFinite(v)) return '"\\u0000nonfinite:' + String(v) + '"'
    return JSON.stringify(v)
  }
  if (Array.isArray(v)) {
    var parts = []
    for (var i = 0; i < v.length; i++) parts.push(stableJson(v[i]))
    return '[' + parts.join(',') + ']'
  }
  var ks = Object.keys(v).sort()
  var out = []
  for (var k = 0; k < ks.length; k++) out.push(JSON.stringify(ks[k]) + ':' + stableJson(v[ks[k]]))
  return '{' + out.join(',') + '}'
}

/**
 * 递归克隆成纯对象。**不要**用 `JSON.parse(JSON.stringify(…))`：它会把 NaN / ±Infinity
 * 悄悄写成 `null`，于是上面 stableJson 那条哨兵永远见不到它们 —— 检查继续瞎。
 * 只处理数组 / 普通对象 / 原始值这几样（这里的输入本来就只有这些）。
 */
function plainClone(v) {
  if (Array.isArray(v)) {
    var a = []
    for (var i = 0; i < v.length; i++) a.push(plainClone(v[i]))
    return a
  }
  if (v && typeof v === 'object') {
    var o: any = {}
    for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) o[k] = plainClone(v[k])
    return o
  }
  return v
}

/** 按**写盘口径**归一：丢掉运行期字段与 undefined、节点坐标取整（`@pos` 是 Math.round 出去的）。 */
function roundTripNorm(m) {
  if (!m || typeof m !== 'object') return {} as any
  var out: any = {}
  for (var k in m) {
    if (RUNTIME_ONLY_FIELDS.indexOf(k) >= 0) continue
    if (m[k] === undefined) continue
    out[k] = m[k]
  }
  if (Array.isArray(out.nodes)) {
    out.nodes = out.nodes.map(function (n: any) {
      var c: any = {}
      for (var k2 in n) {
        if (n[k2] === undefined) continue
        if (OUT_OF_BAND_NODE_FIELDS.indexOf(k2) >= 0) continue
        c[k2] = n[k2]
      }
      if (typeof c.x === 'number' && isFinite(c.x)) c.x = Math.round(c.x)
      if (typeof c.y === 'number' && isFinite(c.y)) c.y = Math.round(c.y)
      // 空 label 的**写盘口径**就是节点 id（serializeDoc 写 id、解析器读回来也是 id）——
      // `n1[""]` 是非法 Mermaid，这一条没有别的表达方式。所以按口径归一，而不是判成漂移。
      // 注意只归 `''`/null/undefined：**纯空白标签 `' '` 是内容**，它有自己的合法表达（`n1[" "]`），
      // 往返必须原样（见 test/mermaid.test.cjs 第 [10] 节）。
      if (c.label === null || c.label === undefined || c.label === '') c.label = c.id
      return c
    })
  }
  // 集合**按 key 排序**再比：`serializeDoc` 会重排节点（成组的排在前、组内保序、散节点在后），
  // 所以「内存里的顺序」和「文件里的顺序」天然不同 —— 那是规整，不是漂移。
  // 顺序本身不进文件语义（序列化每次都按同一条规则重新推），所以按集合比才是对的。
  if (Array.isArray(out.nodes)) {
    out.nodes.sort(function (a: any, b: any) { return String(a && a.id) < String(b && b.id) ? -1 : String(a && a.id) > String(b && b.id) ? 1 : 0 })
  }
  if (Array.isArray(out.edges)) {
    out.edges = out.edges.map(function (e: any) {
      var c: any = {}
      for (var k3 in e) {
        if (e[k3] === undefined) continue
        if (OUT_OF_BAND_EDGE_FIELDS.indexOf(k3) >= 0) continue
        c[k3] = e[k3]
      }
      return c
    })
    out.edges.sort(function (a: any, b: any) { return edgeSortKey(a) < edgeSortKey(b) ? -1 : edgeSortKey(a) > edgeSortKey(b) ? 1 : 0 })
  }
  if (Array.isArray(out.groups)) {
    out.groups = out.groups.map(function (g: any) {
      var c: any = {}
      for (var k4 in g) {
        if (g[k4] === undefined) continue
        c[k4] = g[k4]
      }
      // 与 serializeDoc / parseMermaid 同一个口径：空 / 纯空白的组 label 落盘就是组 id。
      if (c.label == null || String(c.label).trim() === '') c.label = c.id
      return c
    })
    out.groups.sort(function (a: any, b: any) { return String(a && a.id) < String(b && b.id) ? -1 : String(a && a.id) > String(b && b.id) ? 1 : 0 })
  }
  // 走一遍深拷贝，抹掉原型/引用带来的差异（值本身不变）。**不能用 JSON 往返** ——
  // 它把 NaN / ±Infinity 写成 null，stableJson 那条非有限哨兵就永远没机会说话。
  return plainClone(out)
}

/** 两个对象里哪些键的值不同（键序无关）。 */
function roundTripFieldDiff(a, b) {
  var out = []
  var A: any = (a && typeof a === 'object') ? a : {}
  var B: any = (b && typeof b === 'object') ? b : {}
  var seen = {}
  for (var k in A) { seen[k] = true; if (stableJson(A[k]) !== stableJson(B[k])) out.push(k) }
  for (var k2 in B) if (!seen[k2]) out.push(k2)
  return out
}

/**
 * 两个数组里「哪些元素对不上、差在哪个字段」。
 * 报出来的是 `id:字段/字段`，例如 `cache:group` —— 日志里一眼能看出是哪一条数据丢了什么。
 */
function roundTripBadIds(mine, theirs, keyOf) {
  var a = Array.isArray(mine) ? mine : []
  var b = Array.isArray(theirs) ? theirs : []
  var out = []
  var n = Math.max(a.length, b.length)
  for (var i = 0; i < n; i++) {
    if (stableJson(a[i]) === stableJson(b[i])) continue
    var x = a[i] || b[i] || {}
    var label = typeof keyOf === 'function' ? keyOf(x, i) : String(i)
    out.push(label + ':' + roundTripFieldDiff(a[i], b[i]).join('/'))
    if (out.length >= 8) break
  }
  return out
}

/**
 * 往返守恒：`parse(serialize(doc))` 必须与 `doc` 在所有**会被持久化**的字段上一致。
 * 返回差异清单（正常是空数组）。**它只报告，不改任何东西** —— 落盘照旧。
 */
function roundTripDiff(doc) {
  var out = []
  if (!doc || typeof doc !== 'object') return out
  var back
  try {
    back = parseMermaid(serializeDoc(doc))
  } catch (e) {
    return ['写出的文本再解析时抛错：' + (e && e.message ? e.message : String(e))]
  }
  var mine = roundTripNorm(doc)
  var theirs = roundTripNorm(back)
  var seen = {}
  for (var k in mine) {
    seen[k] = true
    if (stableJson(mine[k]) !== stableJson(theirs[k])) out.push(k)
  }
  for (var k2 in theirs) if (!seen[k2]) out.push(k2)
  return out
}

/** 差异的**现场**：哪个节点的哪个字段对不上（日志与面板都要能指路，不能只说"不一致"）。 */
function roundTripDetail(doc) {
  var diff = roundTripDiff(doc)
  if (diff.length === 0) return null
  var back: any
  try { back = parseMermaid(serializeDoc(doc)) } catch (e) { return { fields: diff, detail: '解析回读失败' } }
  var mine: any = roundTripNorm(doc)
  var theirs: any = roundTripNorm(back)
  var detail: any = {}
  if (diff.indexOf('nodes') >= 0) {
    detail.nodes = roundTripBadIds(mine.nodes, theirs.nodes, function (n, i) { return n && n.id != null ? n.id : '#' + i })
  }
  if (diff.indexOf('edges') >= 0) {
    detail.edges = roundTripBadIds(mine.edges, theirs.edges, function (e, i) { return e && e.from != null ? e.from + '->' + e.to : '#' + i })
  }
  if (diff.indexOf('groups') >= 0) {
    detail.groups = roundTripBadIds(mine.groups, theirs.groups, function (g, i) { return g && g.id != null ? g.id : '#' + i })
  }
  return { fields: diff, detail: detail }
}
