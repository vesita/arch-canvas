function serializeDoc(doc) {
  var nodes = doc.nodes || [];
  var edges = doc.edges || [];
  var seq = nodes;

  var out = [];
  // 头部这几行是**写给人的格式说明**，不是数据：一律用 `%%!` 前缀，解析器见到就整行跳过。
  // 为什么需要这个前缀 —— 这些行本来就长着 `%% @note <节点id> …` 的样子，早先真的被解析成
  // 「一条指向 <节点id> 这个不存在节点的注释」，于是每读一次文件就多一条假警告。
  out.push(HEADER_BANNER);
  out.push('%%! @summary <一句话> 这张图讲的是什么 —— 会随每一步注入给 AI');
  out.push('%%! @pos <节点id> <x> <y> 是画布坐标注释，@link <节点id> <图名> 是下钻到另一张图');
  out.push('%%! @file <节点id> <路径> 是这个节点对应的源码文件（可带 #符号），一个节点可多条');
  out.push('%%! @tags <节点id> <标签>… 是节点的概念标签（空格分隔，含特殊字符用引号）');
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
  // 概念标签：以 %% @tags 输出，支持节点多维标注与语义相似性聚类
  for (var tt = 0; tt < seq.length; tt++) {
    var ntags = seq[tt].tags || [];
    if (ntags.length > 0) {
      var tagStr = ntags.map(function (t) { return q(t) }).join(' ');
      out.push('%% @tags ' + cleanId(seq[tt].id) + ' ' + tagStr);
    }
  }
  out.push('flowchart ' + (doc.direction || 'TD'));
  for (var no = 0; no < nodes.length; no++) out.push('  ' + nodeText(nodes[no]));
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
]

// 节点上这些字段**不由这份文本承载**：留言存在旁路表 notes.json 里（见 notes.ts）。
// 往返检查必须把它们排除，否则会误报。
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
      // 往返必须原样（见 test/mermaid.parser.test.cjs 第 [10] 节）。
      if (c.label === null || c.label === undefined || c.label === '') c.label = c.id
      if (!Array.isArray(c.tags) || c.tags.length === 0) delete c.tags
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
 * 报出来的是 `id:字段/字段`，例如 `cache:shape` —— 日志里一眼能看出是哪一条数据丢了什么。
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
  return { fields: diff, detail: detail }
}
