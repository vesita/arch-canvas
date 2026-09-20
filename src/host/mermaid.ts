// Mermaid flowchart ⇄ 图模型 的双向转换（纯函数，不碰服务、不碰状态）。
// 关键约定：坐标存 `%% @pos <id> <x> <y>`、下钻存 `%% @link`、
// 代码锚点存 `%% @file <id> <路径>`（可带 `#符号`）、
// 整张图的一句话总结存 `%% @summary`（图级，不挂节点）
// —— 全是注释行，对 Mermaid 渲染零影响，
// 所以这份文本既是给 AI 看的图，也是能直接贴进任何 Markdown 的合法 Mermaid。
// 元素留言存旁路表（notes.json）；正文里的老式 %% @note / %% @done 仅作为迁移兜底解析。
// 头部那些**格式说明**行是 `%%!` 前缀：它们也是注释，但明确不是数据。
// Mermaid flowchart <-> 图模型 双向转换（host 侧使用；此处独立测试）
var ARROWS = ['<==>', '<-->', '==>', '-.->', '-->', '---', '~~~', '==='];
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
var ID_RE = /[A-Za-z0-9_\u00C0-\uFFFF]/;
// 节点 id 到处都是当对象键用的（byId / posMap / grouped / seen），
// 而 `byId['__proto__']` 拿到的是 Object.prototype 而不是 undefined ——
// 那会让图里的 `__proto__` 节点被当成「已存在」并往原型上写字。出现就加前缀绕开。
var RESERVED_ID = /^(__proto__|constructor|prototype|toString|valueOf|hasOwnProperty)$/;

function cleanId(raw) {
  var s = String(raw == null ? '' : raw).trim();
  s = s.replace(/[^A-Za-z0-9_\u00C0-\uFFFF]/g, '_');
  if (s === '') s = 'n';
  if (/^[0-9]/.test(s)) s = 'n' + s;
  if (RESERVED_ID.test(s)) s = 'n' + s;
  return s;
}

// 标签转义是对称的：q() 写出去，unquote() 必须原样读回来。
// 顺序要紧 —— q() 先转义 & / # / <，最后才把换行写成 <br/>；
// unquote() 反过来先认 <br/>，再解实体，最后解 &amp;（否则 `&amp;quot;` 会被二次解码成 `"`）。
// 文件头部那几行「格式说明」也是 `%% @xxx …` 的形状（例如 `%% @note <节点id> <文本> …`）。
// 0.5.0 起说明行一律写成 `%%!`（见 serializeDoc），但 0.4.x 写出的文件里还是老形状 ——
// 不认它的话，每解析一次就凭空多一条「注释 @note <节点id> 指向图里不存在的节点」的假警告，
// 而这条假警告会出现在 arch_read 的返回值里。`<...>` 不可能是合法的节点 id，见到就当说明。
var LEGACY_TEMPLATE_RE = /^%%\s*@(pos|link|note|done|file)\s+<[^>]*>(\s|$)/;

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
];

function unquote(text) {
  var s = String(text == null ? '' : text).trim();
  if (s.length >= 2 && s.charAt(0) === '"' && s.charAt(s.length - 1) === '"') s = s.slice(1, -1);
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/#quot;/g, '"').replace(/&quot;/g, '"');
  s = s.replace(/#35;/g, '#').replace(/#60;/g, '<');
  s = s.replace(/&amp;/g, '&');
  return s.trim();
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
 *
 * 读回仍然走 `unquote()`（它把 `#35;` 还原成 `#`），所以老文件照旧解析 ——
 * 只是下一次落盘时会被规整回 `#applyOps`。
 */
function qRef(value) {
  var s = String(value == null ? '' : value);
  s = s.split('"').join('#quot;');
  s = s.replace(/\r?\n/g, '<br/>');
  return '"' + s + '"';
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
  while (j < n && ID_RE.test(line.charAt(j))) j++;
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
        return { id: cleanId(id), label: unquote(line.slice(k + open.length, cl)), shape: shape, end: cl + close.length };
      }
    }
  }
  return { id: cleanId(id), label: null, shape: null, end: j };
}

function ensureNode(doc, byId, id, label, shape, group) {
  var node = byId[id];
  if (!node) {
    node = { id: id, label: id, shape: 'rect', group: null, x: null, y: null, link: null, note: '', noteDone: false, files: [] };
    byId[id] = node;
    doc.nodes.push(node);
  }
  if (label !== null && label !== undefined && label !== '') node.label = label;
  if (shape) node.shape = shape;
  if (group && !node.group) node.group = group;
  return node;
}

function addEdge(doc, from, to, arrow, label) {
  var text = label || '';
  var kind = arrow || '-->';
  for (var i = 0; i < doc.edges.length; i++) {
    var e = doc.edges[i];
    if (e.from === from && e.to === to && e.label === text && e.arrow === kind) return e;
  }
  var edge = { id: 'e' + (doc.edges.length + 1), from: from, to: to, label: text, arrow: kind };
  doc.edges.push(edge);
  return edge;
}

function scanStatements(line, doc, byId, group, warn) {
  // 这一行中途解析失败时，已经塞进 doc 的节点/边要回滚 ——
  // 否则「原样保留到 extras」的那份文本会和半截模型同时存在，序列化出去就是重复内容。
  var nodesBefore = doc.nodes.length;
  var edgesBefore = doc.edges.length;

  function fail() {
    for (var k = doc.nodes.length - 1; k >= nodesBefore; k--) delete byId[doc.nodes[k].id];
    doc.nodes.length = nodesBefore;
    doc.edges.length = edgesBefore;
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

    // `-- 文本 -->` 形式
    if (line.slice(i, i + 2) === '--' && line.slice(i, i + 3) !== '-->') {
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

    // 连接符
    var arrow = null;
    for (var a = 0; a < ARROWS.length; a++) {
      if (line.slice(i, i + ARROWS[a].length) === ARROWS[a]) { arrow = ARROWS[a]; break; }
    }
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

    var ref = scanNodeRef(line, i);
    if (ref === null) return fail();
    i = ref.end;
    var node = ensureNode(doc, byId, ref.id, ref.label, ref.shape, group);
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
  var posMap = {};
  var linkMap = {};
  // 老式注释（%% @note / %% @done）收进 legacyNotes 供迁移，不再挂到节点上。
  var legacyNotes = {};
  // 代码锚点（%% @file）与注释不同：**一个节点可以有多条**，所以存成数组、按出现顺序保留。
  var filesMap = {};
  function warn(message) {
    if (doc.warnings.length < 50) doc.warnings.push(message);
  }
  var raw = String(text == null ? '' : text).split(/\r?\n/);
  for (var li = 0; li < raw.length; li++) {
    var line = raw[li].trim();
    if (line === '') continue;
    if (line.slice(0, 3) === '%%{') continue;
    if (line.slice(0, 3) === '%%!') continue;
    if (line.slice(0, 2) === '%%') {
      // 格式说明行（本文件头部那几行模板）不是数据 —— 见 LEGACY_TEMPLATE_RE。
      if (LEGACY_TEMPLATE_RE.test(line)) continue;
      // %% @summary <一句话>：这张图讲的是什么。**图级**的，不挂节点，所以没有幽灵问题；
      // 写多条时后面那条说了算（与 @note 一致）。
      var sm = /^%%\s*@summary\s+(.*)$/.exec(line);
      if (sm) {
        doc.summary = cleanSummary(unquote(sm[1]));
        continue;
      }
      var pm = /^%%\s*@pos\s+(\S+)\s+(-?[0-9.]+)\s+(-?[0-9.]+)/.exec(line);
      if (pm) {
        posMap[cleanId(pm[1])] = { x: parseFloat(pm[2]), y: parseFloat(pm[3]) };
        continue;
      }
      // %% @link <节点id> <另一张图的名字>：把这个节点下钻到那张图
      var lm = /^%%\s*@link\s+(\S+)\s+(.+)$/.exec(line);
      if (lm) {
        linkMap[cleanId(lm[1])] = unquote(lm[2]);
      }
      // 老式 %% @note / %% @done 行收进 legacyNotes，供迁移期兜底
      var nm = /^%%\s*@(note|done)\s+(\S+)\s+(.*)$/.exec(line);
      if (nm) {
        legacyNotes[cleanId(nm[2])] = { text: unquote(nm[3]), done: nm[1] === 'done' };
      }
      // %% @file <节点id> "<项目相对路径>[#符号]"：这个节点对应哪段源码。
      // 同一个节点可以写多条 —— 一个「模块」常常落在好几个文件里。
      var fm = /^%%\s*@file\s+(\S+)\s+(.*)$/.exec(line);
      if (fm) {
        var fref = unquote(fm[2]);
        if (fref) {
          var fid = cleanId(fm[1]);
          if (!filesMap[fid]) filesMap[fid] = [];
          filesMap[fid].push(fref);
        }
      }
      continue;
    }
    if (/^(flowchart|graph)\b/.test(line)) {
      var dm = /^(?:flowchart|graph)\s+(TB|TD|BT|RL|LR)\b/.exec(line);
      if (dm) doc.direction = dm[1] === 'TB' ? 'TD' : dm[1];
      continue;
    }
    if (/^subgraph\b/.test(line)) {
      var rest = line.slice(8).trim();
      var gref = scanNodeRef(rest, 0);
      var gid;
      var glabel;
      if (gref && gref.label !== null) { gid = gref.id; glabel = gref.label; }
      else if (gref) { gid = gref.id; glabel = rest; }
      else { gid = 'g' + (doc.groups.length + 1); glabel = rest; }
      doc.groups.push({ id: gid, label: glabel || gid });
      stack.push(gid);
      continue;
    }
    if (line === 'end') { stack.pop(); continue; }
    if (/^(classDef|class|style|linkStyle|click|link)\b/.test(line)) { doc.extras.push(line); continue; }
    if (/^direction\b/.test(line)) continue;
    var group = stack.length > 0 ? stack[stack.length - 1] : null;
    if (!scanStatements(line, doc, byId, group, warn)) {
      doc.extras.push(line);
      warn('这行没能解析成节点或连线，已按原文原样保留：' + line);
    }
  }
  // 注释里的坐标/下钻只挂在图里真有的节点上；图里没有的注释（多半是删节点时忘了删）就此丢弃，
  // 序列化时自然不再写出去 —— 这就是「幽灵节点」的出口。
  for (var pi = 0; pi < doc.nodes.length; pi++) {
    var pn = doc.nodes[pi];
    if (posMap[pn.id]) { pn.x = posMap[pn.id].x; pn.y = posMap[pn.id].y }
    if (linkMap[pn.id]) pn.link = linkMap[pn.id];
    if (filesMap[pn.id]) pn.files = filesMap[pn.id].slice();
  }
  for (var pid in posMap) if (!byId[pid]) warn('坐标注释 @pos ' + pid + ' 指向图里不存在的节点，已丢弃');
  for (var lid in linkMap) if (!byId[lid]) warn('下钻注释 @link ' + lid + ' 指向图里不存在的节点，已丢弃');
  for (var fid3 in filesMap) if (!byId[fid3]) warn('代码锚点 @file ' + fid3 + ' 指向图里不存在的节点，已丢弃');
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
  var wrap = SHAPE_WRAP[node.shape] || SHAPE_WRAP.rect;
  return node.id + wrap[0] + q(node.label) + wrap[1];
}

function serializeDoc(doc) {
  var nodes = doc.nodes || [];
  var groups = doc.groups || [];
  var edges = doc.edges || [];

  // 节点输出顺序：分组块优先、组内保持原序，剩下的按原序。
  // @pos / @link 注释与图体共用这个顺序 —— 两处不一致的话，同一份文件每往返一次就重排一次。
  var blocks = [];
  var grouped = {};
  for (var g = 0; g < groups.length; g++) {
    var grp = groups[g];
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
  out.push('%% arch-canvas —— 由「架构画布」面板与 AI 共同维护（`%%!` 开头的是格式说明，不是图的内容）');
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
      out.push('%% @pos ' + n.id + ' ' + Math.round(n.x) + ' ' + Math.round(n.y));
    }
  }
  // 下钻链接也走注释 —— 对 Mermaid 渲染同样零影响，文件仍是合法 Mermaid
  for (var lk = 0; lk < seq.length; lk++) {
    if (seq[lk].link) out.push('%% @link ' + seq[lk].id + ' ' + q(seq[lk].link));
  }
  // 代码锚点：一个节点可多条，按「节点顺序 + 引用自身顺序」写出（顺序稳定，往返才幂等）。
  for (var ft = 0; ft < seq.length; ft++) {
    var frefs = seq[ft].files || [];
    for (var fr = 0; fr < frefs.length; fr++) {
      if (frefs[fr]) out.push('%% @file ' + seq[ft].id + ' ' + qRef(frefs[fr]));
    }
  }
  out.push('flowchart ' + (doc.direction || 'TD'));
  for (var bb = 0; bb < blocks.length; bb++) {
    out.push('  subgraph ' + blocks[bb].group.id + '[' + q(blocks[bb].group.label) + ']');
    for (var bm = 0; bm < blocks[bb].members.length; bm++) {
      out.push('    ' + nodeText(blocks[bb].members[bm]));
    }
    out.push('  end');
  }
  for (var lo = 0; lo < loose.length; lo++) out.push('  ' + nodeText(loose[lo]));
  for (var e = 0; e < edges.length; e++) {
    var edge = edges[e];
    var arrow = edge.arrow || '-->';
    var tail = edge.label ? arrow + '|' + q(edge.label) + '|' : arrow;
    out.push('  ' + edge.from + ' ' + tail + ' ' + edge.to);
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
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
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
    out.groups.sort(function (a: any, b: any) { return String(a && a.id) < String(b && b.id) ? -1 : String(a && a.id) > String(b && b.id) ? 1 : 0 })
  }
  // 走一遍 JSON 往返，抹掉原型/引用带来的差异（值本身不变）
  try { return JSON.parse(JSON.stringify(out)) } catch (e) { return out }
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
