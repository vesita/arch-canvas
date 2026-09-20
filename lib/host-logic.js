'use strict'
// 由 tools/build.mjs 从 src/host/*.js 生成 —— 不要手改这个文件。
// 导出工厂：module.exports(harness, hostEnv) → Cordis 插件对象。
module.exports = function (harness, hostEnv) {
return {
  apply: function (ctx) {
"use strict";
// Mermaid flowchart ⇄ 图模型 的双向转换（纯函数，不碰服务、不碰状态）。
// 关键约定：坐标存 `%% @pos <id> <x> <y>`、下钻存 `%% @link`、用户注释存 `%% @note`
// （已解决的写 `%% @done`）、代码锚点存 `%% @file <id> <路径>`（可带 `#符号`）、
// 整张图的一句话总结存 `%% @summary`（图级，不挂节点）
// —— 全是注释行，对 Mermaid 渲染零影响，
// 所以这份文本既是给 AI 看的图，也是能直接贴进任何 Markdown 的合法 Mermaid。
// 只有头部那些**格式说明**行是 `%%!` 前缀：它们也是注释，但明确不是数据。
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
    if (s === '')
        s = 'n';
    if (/^[0-9]/.test(s))
        s = 'n' + s;
    if (RESERVED_ID.test(s))
        s = 'n' + s;
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
var SUMMARY_LIMIT = 500;
/**
 * 一句话总结的规范化。它必须占**一行**（头部就是它的载体），而且会随每一步注入给 AI，
 * 所以换行、连续空白、超长都在这里一次收干净 —— 解析（读文件）与 normalizeModel
 * （读界面/AI 传上来的模型）两条路共用，两边不一致的话往返就不幂等。
 */
function cleanSummary(raw) {
    var s = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
    if (s.length > SUMMARY_LIMIT)
        s = s.slice(0, SUMMARY_LIMIT).trim();
    return s;
}
var ENTITIES = [
    ['&', '&amp;'],
    ['#', '#35;'],
    ['<', '#60;'],
    ['"', '#quot;'],
];
function unquote(text) {
    var s = String(text == null ? '' : text).trim();
    if (s.length >= 2 && s.charAt(0) === '"' && s.charAt(s.length - 1) === '"')
        s = s.slice(1, -1);
    s = s.replace(/<br\s*\/?>/gi, '\n');
    s = s.replace(/#quot;/g, '"').replace(/&quot;/g, '"');
    s = s.replace(/#35;/g, '#').replace(/#60;/g, '<');
    s = s.replace(/&amp;/g, '&');
    return s.trim();
}
function q(label) {
    var s = String(label == null ? '' : label);
    for (var i = 0; i < ENTITIES.length; i++)
        s = s.split(ENTITIES[i][0]).join(ENTITIES[i][1]);
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
        if (ch === '"') {
            inQuote = !inQuote;
            continue;
        }
        if (!inQuote && line.slice(i, i + needle.length) === needle)
            return i;
    }
    return -1;
}
function scanNodeRef(line, start) {
    var n = line.length;
    var j = start;
    while (j < n && ID_RE.test(line.charAt(j)))
        j++;
    if (j === start)
        return null;
    var id = line.slice(start, j);
    var k = j;
    while (k < n && /\s/.test(line.charAt(k)))
        k++;
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
    if (label !== null && label !== undefined && label !== '')
        node.label = label;
    if (shape)
        node.shape = shape;
    if (group && !node.group)
        node.group = group;
    return node;
}
function addEdge(doc, from, to, arrow, label) {
    var text = label || '';
    var kind = arrow || '-->';
    for (var i = 0; i < doc.edges.length; i++) {
        var e = doc.edges[i];
        if (e.from === from && e.to === to && e.label === text && e.arrow === kind)
            return e;
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
        for (var k = doc.nodes.length - 1; k >= nodesBefore; k--)
            delete byId[doc.nodes[k].id];
        doc.nodes.length = nodesBefore;
        doc.edges.length = edgesBefore;
        return false;
    }
    var i = 0;
    var n = line.length;
    var groupIds = []; // 当前这一串并列节点（`A & B -->`），它们是一段连线的源
    var pending = null; // { froms, arrow, label }：箭头右边正在接的那一串
    var joined = false; // 刚见过 `&`：下一个节点属于同一串
    while (i < n) {
        while (i < n && /\s/.test(line.charAt(i)))
            i++;
        if (i >= n)
            break;
        // `;` 语句分隔符（在扫描器内处理，这样标签里的 `#quot;` 之类实体不会被误切）
        if (line.charAt(i) === ';') {
            i++;
            groupIds = [];
            pending = null;
            joined = false;
            continue;
        }
        // `-- 文本 -->` 形式
        if (line.slice(i, i + 2) === '--' && line.slice(i, i + 3) !== '-->') {
            var stop = indexOutsideQuotes(line, '-->', i + 2);
            if (stop !== -1) {
                if (groupIds.length === 0)
                    return fail();
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
            if (line.slice(i, i + ARROWS[a].length) === ARROWS[a]) {
                arrow = ARROWS[a];
                break;
            }
        }
        if (arrow !== null) {
            if (groupIds.length === 0)
                return fail();
            i += arrow.length;
            var label = '';
            while (i < n && /\s/.test(line.charAt(i)))
                i++;
            if (line.charAt(i) === '|') {
                var bar = indexOutsideQuotes(line, '|', i + 1);
                if (bar === -1)
                    return fail();
                label = unquote(line.slice(i + 1, bar));
                i = bar + 1;
            }
            pending = { froms: groupIds.slice(), arrow: arrow, label: label };
            groupIds = [];
            joined = false;
            continue;
        }
        // `&` 并列：左边（`A & B --> C`）和右边（`A --> B & C`）都靠它
        if (line.charAt(i) === '&') {
            i++;
            joined = true;
            continue;
        }
        var ref = scanNodeRef(line, i);
        if (ref === null)
            return fail();
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
            if (joined)
                groupIds.push(node.id);
            else
                groupIds = [node.id];
            joined = false;
            continue; // pending 留着：`A --> B & C` 的 C 还要从同一批源连过来
        }
        if (joined)
            groupIds.push(node.id);
        else
            groupIds = [node.id];
        joined = false;
    }
    return true;
}
function parseMermaid(text) {
    var doc = { nodes: [], edges: [], groups: [], extras: [], direction: 'TD', warnings: [], summary: '' };
    var byId = {};
    var stack = [];
    // 坐标与下钻先存着，等图体读完再挂到真有的节点上。
    // 读到注释就 ensureNode 的后果是：节点删了、注释忘了删，节点会凭注释复活写回图里。
    var posMap = {};
    var linkMap = {};
    // 注释也先存着，同样等图体读完再挂到真有的节点上（理由与坐标一致：不能让注释把节点复活）。
    // 一个节点只有一条注释，`@note` / `@done` 谁在后面谁说了算。
    var noteMap = {};
    // 代码锚点（%% @file）与注释不同：**一个节点可以有多条**，所以存成数组、按出现顺序保留。
    var filesMap = {};
    function warn(message) {
        if (doc.warnings.length < 50)
            doc.warnings.push(message);
    }
    var raw = String(text == null ? '' : text).split(/\r?\n/);
    for (var li = 0; li < raw.length; li++) {
        var line = raw[li].trim();
        if (line === '')
            continue;
        if (line.slice(0, 3) === '%%{')
            continue;
        if (line.slice(0, 3) === '%%!')
            continue;
        if (line.slice(0, 2) === '%%') {
            // 格式说明行（本文件头部那几行模板）不是数据 —— 见 LEGACY_TEMPLATE_RE。
            if (LEGACY_TEMPLATE_RE.test(line))
                continue;
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
            // %% @note <节点id> <文本>：用户留给 AI 的注释；%% @done 是同一件事但已解决。
            // 拆成两种注释而不是加一个状态字段，是为了让提示词能用一行过滤掉已解决的：
            // 已解决的留在文件里可追溯，但不该再进上下文（否则注释会累积成噪音）。
            var nm = /^%%\s*@(note|done)\s+(\S+)\s+(.*)$/.exec(line);
            if (nm) {
                noteMap[cleanId(nm[2])] = { text: unquote(nm[3]), done: nm[1] === 'done' };
            }
            // %% @file <节点id> "<项目相对路径>[#符号]"：这个节点对应哪段源码。
            // 同一个节点可以写多条 —— 一个「模块」常常落在好几个文件里。
            var fm = /^%%\s*@file\s+(\S+)\s+(.*)$/.exec(line);
            if (fm) {
                var fref = unquote(fm[2]);
                if (fref) {
                    var fid = cleanId(fm[1]);
                    if (!filesMap[fid])
                        filesMap[fid] = [];
                    filesMap[fid].push(fref);
                }
            }
            continue;
        }
        if (/^(flowchart|graph)\b/.test(line)) {
            var dm = /^(?:flowchart|graph)\s+(TB|TD|BT|RL|LR)\b/.exec(line);
            if (dm)
                doc.direction = dm[1] === 'TB' ? 'TD' : dm[1];
            continue;
        }
        if (/^subgraph\b/.test(line)) {
            var rest = line.slice(8).trim();
            var gref = scanNodeRef(rest, 0);
            var gid;
            var glabel;
            if (gref && gref.label !== null) {
                gid = gref.id;
                glabel = gref.label;
            }
            else if (gref) {
                gid = gref.id;
                glabel = rest;
            }
            else {
                gid = 'g' + (doc.groups.length + 1);
                glabel = rest;
            }
            doc.groups.push({ id: gid, label: glabel || gid });
            stack.push(gid);
            continue;
        }
        if (line === 'end') {
            stack.pop();
            continue;
        }
        if (/^(classDef|class|style|linkStyle|click|link)\b/.test(line)) {
            doc.extras.push(line);
            continue;
        }
        if (/^direction\b/.test(line))
            continue;
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
        if (posMap[pn.id]) {
            pn.x = posMap[pn.id].x;
            pn.y = posMap[pn.id].y;
        }
        if (linkMap[pn.id])
            pn.link = linkMap[pn.id];
        var pnote = noteMap[pn.id];
        if (pnote && pnote.text) {
            pn.note = pnote.text;
            pn.noteDone = pnote.done === true;
        }
        if (filesMap[pn.id])
            pn.files = filesMap[pn.id].slice();
    }
    for (var pid in posMap)
        if (!byId[pid])
            warn('坐标注释 @pos ' + pid + ' 指向图里不存在的节点，已丢弃');
    for (var lid in linkMap)
        if (!byId[lid])
            warn('下钻注释 @link ' + lid + ' 指向图里不存在的节点，已丢弃');
    for (var nid2 in noteMap)
        if (!byId[nid2])
            warn('注释 @note ' + nid2 + ' 指向图里不存在的节点，已丢弃');
    for (var fid3 in filesMap)
        if (!byId[fid3])
            warn('代码锚点 @file ' + fid3 + ' 指向图里不存在的节点，已丢弃');
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
            if (nodes[m].group === grp.id) {
                members.push(nodes[m]);
                grouped[nodes[m].id] = true;
            }
        }
        if (members.length > 0)
            blocks.push({ group: grp, members: members });
    }
    var loose = [];
    for (var k = 0; k < nodes.length; k++) {
        if (!grouped[nodes[k].id])
            loose.push(nodes[k]);
    }
    var seq = [];
    for (var b = 0; b < blocks.length; b++) {
        for (var bi = 0; bi < blocks[b].members.length; bi++)
            seq.push(blocks[b].members[bi]);
    }
    for (var l = 0; l < loose.length; l++)
        seq.push(loose[l]);
    var out = [];
    // 头部这几行是**写给人的格式说明**，不是数据：一律用 `%%!` 前缀，解析器见到就整行跳过。
    // 为什么需要这个前缀 —— 这些行本来就长着 `%% @note <节点id> …` 的样子，早先真的被解析成
    // 「一条指向 <节点id> 这个不存在节点的注释」，于是每读一次文件就多一条假警告。
    out.push('%% arch-canvas —— 由「架构画布」面板与 AI 共同维护（`%%!` 开头的是格式说明，不是图的内容）');
    out.push('%%! @summary <一句话> 这张图讲的是什么 —— 会随每一步注入给 AI');
    out.push('%%! @pos <节点id> <x> <y> 是画布坐标注释，@link <节点id> <图名> 是下钻到另一张图');
    out.push('%%! @note <节点id> <文本> 是用户留给 AI 的注释，@done 是同一件事但已解决');
    out.push('%%! @file <节点id> <路径> 是这个节点对应的源码文件（可带 #符号），一个节点可多条');
    out.push('%%! 以上对 Mermaid 渲染都无任何影响，可忽略或手改');
    // 一句话总结紧跟头部：它描述整张图，所以写在所有节点级注释**之前**（人一眼就看到这张图是干嘛的）。
    var docSummary = cleanSummary(doc.summary);
    if (docSummary)
        out.push('%% @summary ' + q(docSummary));
    for (var i = 0; i < seq.length; i++) {
        var n = seq[i];
        if (typeof n.x === 'number' && typeof n.y === 'number' && isFinite(n.x) && isFinite(n.y)) {
            out.push('%% @pos ' + n.id + ' ' + Math.round(n.x) + ' ' + Math.round(n.y));
        }
    }
    // 下钻链接也走注释 —— 对 Mermaid 渲染同样零影响，文件仍是合法 Mermaid
    for (var lk = 0; lk < seq.length; lk++) {
        if (seq[lk].link)
            out.push('%% @link ' + seq[lk].id + ' ' + q(seq[lk].link));
    }
    // 用户注释：未解决的写 @note、已解决的写 @done。块顺序与 @pos / @link 共用同一个 seq，
    // 两处不一致的话同一份文件每往返一次就会重排一次。
    for (var nto = 0; nto < seq.length; nto++) {
        if (seq[nto].note && !seq[nto].noteDone)
            out.push('%% @note ' + seq[nto].id + ' ' + q(seq[nto].note));
    }
    for (var ndn = 0; ndn < seq.length; ndn++) {
        if (seq[ndn].note && seq[ndn].noteDone)
            out.push('%% @done ' + seq[ndn].id + ' ' + q(seq[ndn].note));
    }
    // 代码锚点：一个节点可多条，按「节点顺序 + 引用自身顺序」写出（顺序稳定，往返才幂等）。
    for (var ft = 0; ft < seq.length; ft++) {
        var frefs = seq[ft].files || [];
        for (var fr = 0; fr < frefs.length; fr++) {
            if (frefs[fr])
                out.push('%% @file ' + seq[ft].id + ' ' + q(frefs[fr]));
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
    for (var lo = 0; lo < loose.length; lo++)
        out.push('  ' + nodeText(loose[lo]));
    for (var e = 0; e < edges.length; e++) {
        var edge = edges[e];
        var arrow = edge.arrow || '-->';
        var tail = edge.label ? arrow + '|' + q(edge.label) + '|' : arrow;
        out.push('  ' + edge.from + ' ' + tail + ' ' + edge.to);
    }
    var extras = doc.extras || [];
    for (var x = 0; x < extras.length; x++)
        out.push('  ' + extras[x]);
    return out.join('\n') + '\n';
}

"use strict";
// ==================== 文件日志 ====================
// 这个插件对 console 一字不吐（挂载播报会变成一屏噪音，故障一律抛错），
// 所以出问题时唯一的现场就是这些 .log 文件：挂载结果、AI 工具调用、落盘失败、
// 解析告警、RPC 出错都记在这里。按天一个文件，超过保留期的自动清掉。
//
// 真正的写盘能力由外层（lib/index.js 或动态引导层）通过 hostEnv.logBackend 注入 ——
// 两种形态的 IO 差异全收在那一层，这里只认这些方法：
//   append(dir, file, text)  追加
//   list(dir)                目录里的文件名
//   remove(dir, file)        删掉（动态形态的 fs 服务没有 unlink，退化成清空 + 不再列出）
//   ensureDir(dir)           确保目录存在
//   size(dir, file)          现有字节数（当日上限用）
// 没注入 backend 就整个不写：日志坏掉绝不能把插件带崩，也不能让它变哑。
var LOG_KEEP_DAYS = 3;
var LOG_MAX_BYTES = 8 * 1024 * 1024;
var logBackend = (typeof hostEnv === 'object' && hostEnv && hostEnv.logBackend) || null;
var logState = { day: '', bytes: 0, capped: false, cappedDropped: 0 };
var logQueue = Promise.resolve();
// 落盘门槛。**为什么需要它**：日志纪律里有两类事件 —— 故障/动作（error/warn/info）与高频成功的
// 巡检（debug）。后者在默认门槛下不落盘，需要排查时把门槛调低就能看到，不必改代码。
// 门槛由外层经 hostEnv.logLevel 递进来（真插件读 `ARCH_CANVAS_LOG_LEVEL`，动态形态缺省）、
// 缺省 `info`；认不出的取值一律退回 `info`（**不**放宽，也不把日志整个关掉）。
// 层级别写错成 debug 的后果是"这条现场没了"，所以每一处 debug 都要在注释里说明为什么它可降级。
var LOG_LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
function logThreshold() {
    var raw = (typeof hostEnv === 'object' && hostEnv && typeof hostEnv.logLevel === 'string') ? hostEnv.logLevel.toLowerCase() : '';
    var lv = LOG_LEVELS[raw];
    return typeof lv === 'number' ? lv : LOG_LEVELS.info;
}
/** 日志落地目录：跟全局图库同一个位置，排查时只找一个地方。 */
function logDir() { return GLOBAL_DIR + '/logs'; }
function logDay(ts) {
    var d = new Date(ts);
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' + m : '' + m) + '-' + (day < 10 ? '0' + day : '' + day);
}
function logFileName(day) { return 'arch-canvas-' + day + '.log'; }
function logDayOfName(name) {
    var m = /^arch-canvas-(\d{4}-\d{2}-\d{2})\.log$/.exec(String(name == null ? '' : name));
    return m ? m[1] : '';
}
/** 一行一个 JSON 对象：能直接 grep，也不用担心字段里的换行把格式撑破。 */
function logText(level, event, fields) {
    var row = { t: new Date().toISOString(), lvl: level, ev: event };
    if (fields) {
        for (var k in fields) {
            if (fields[k] !== undefined && fields[k] !== null)
                row[k] = fields[k];
        }
    }
    var text;
    try {
        text = JSON.stringify(row);
    }
    catch (e) {
        text = '{"t":"' + row.t + '","lvl":"' + level + '","ev":"' + event + '","error":"日志字段无法序列化"}';
    }
    return text + '\n';
}
/** 记一行。异步、串行、永不抛错 —— 日志写不进去也只是没日志。低于门槛的级别直接丢。 */
function logEvent(level, event, fields) {
    if (!logBackend)
        return;
    var lvl = LOG_LEVELS[level] || LOG_LEVELS.info;
    if (lvl < logThreshold())
        return;
    var text = logText(level, event, fields);
    logQueue = logQueue.then(function () { return writeLog(text); }).catch(function () { });
}
async function writeLog(text) {
    var now = Date.now();
    var day = logDay(now);
    if (day !== logState.day) {
        // 跨天（或本次进程第一次写）：建目录、量一下当天文件已有多少、顺手清一次旧日志。
        // 清理挂在这里而不是定时器上 —— 不会泄漏，也不需要额外的生命周期管理。
        logState.day = day;
        logState.capped = false;
        logState.cappedDropped = 0;
        await logBackend.ensureDir(logDir());
        try {
            logState.bytes = await logBackend.size(logDir(), logFileName(day));
        }
        catch (e) {
            logState.bytes = 0;
        }
        await pruneLogs(now);
    }
    if (logState.capped) {
        logState.cappedDropped += 1;
        return;
    }
    if (logState.bytes + text.length > LOG_MAX_BYTES) {
        // 出故障时最怕日志自己变成故障：写满上限就只留一条说明，之后不再写。
        logState.capped = true;
        await logBackend.append(logDir(), logFileName(day), logText('warn', 'log.capped', { limitBytes: LOG_MAX_BYTES }));
        return;
    }
    logState.bytes += text.length;
    await logBackend.append(logDir(), logFileName(day), text);
}
/** 清掉保留期之外的日志。文件名里带日期，所以不依赖 mtime（fs 服务的 stat 里没有）。 */
async function pruneLogs(now) {
    var cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - LOG_KEEP_DAYS);
    var keepFrom = logDay(cutoff.getTime());
    var names = [];
    try {
        names = await logBackend.list(logDir());
    }
    catch (e) {
        return;
    }
    var removed = 0;
    var failed = 0;
    for (var i = 0; i < names.length; i++) {
        var day = logDayOfName(names[i]);
        if (!day || day >= keepFrom)
            continue; // YYYY-MM-DD 的字符串序就是日期序
        try {
            await logBackend.remove(logDir(), names[i]);
            removed += 1;
        }
        catch (e) {
            failed += 1;
        }
    }
    if (removed > 0 || failed > 0) {
        logEvent('info', 'log.retention', { removed: removed, failed: failed, keepDays: LOG_KEEP_DAYS, dir: logDir() });
    }
}

"use strict";
// 文档状态：图库定位（跟项目走）、加载/落盘、模型规范化、增量 op 应用、坐标继承。
// 只依赖 apply(ctx) 闭包里的 ctx / harness，不引任何模块。
// ==================== 文档状态 ====================
// 数据目录（全局图库与日志写在哪）由外层注入：真插件按 $DSH_HOME / ~/.dsh 算，
// 动态开发形态递它自己那份本机路径。宿主逻辑里不写死用户目录 —— 写死了包就只能在
// 本机用：tarball 装到别处，全局图库与日志会指向一个不存在的家目录。
var DATA_DIR = (typeof hostEnv === 'object' && hostEnv && typeof hostEnv.dataDir === 'string' && hostEnv.dataDir) ? hostEnv.dataDir : '';
if (!DATA_DIR)
    throw new Error('hostEnv.dataDir 没给：外层必须告诉插件数据目录（全局图库与日志的落点）');
var DSH_ROOT = DATA_DIR.replace(/\/[^/]+$/, '');
// 图库跟着项目走：<项目>/.arch-canvas/*.mmd —— 你在哪个项目里讨论，就打开那个项目的图库。
// 但图的内容不与代码绑死：它表达的是**讨论中的逻辑框架**，可以刻意与代码不一致。
// 识别不出项目时（没绑工作区、或界面还没回报）回退到全局图库。
var GLOBAL_DIR = DATA_DIR;
var PROJECT_SUBDIR = '.arch-canvas';
var DEFAULT_DIAGRAM = 'architecture';
/** 上一次真正落过 doc.load 的内容键：用来把「同一份图被反复读进来」的重复行压掉。 */
var lastDocLoadKey = '';
// 软删除：文件里出现这行即视为已删除，列表里隐藏但内容原样保留。
// fs 服务没有 unlink/rename，而我不愿意为了删两个文件给插件开 bash 权限；
// 软删除反而更契合「记录思路」——删错了能捞回来，彻底删由你自己 rm。
var TOMBSTONE = '%% @deleted';
// mermaid 的第一来源是包内 assets/（由外层递 mermaidFile），这里是早期手工下载的缓存。
var MERMAID_CACHE = DSH_ROOT + '/.cache/arch-canvas/mermaid.min.js';
var ARROW_SET = { '-->': 1, '---': 1, '-.->': 1, '==>': 1, '===': 1, '~~~': 1, '<-->': 1, '<==>': 1 };
var DIR_SET = { TD: 1, TB: 1, BT: 1, LR: 1, RL: 1 };
var fs = ctx.get('fs');
var systemPromptSvc = ctx.get('systemPrompt');
var sandboxPolicySvc = ctx.get('sandboxPolicy');
var agentsSvc = ctx.get('agents');
// webServer 不在这里取快照（服务何时可用由 Cordis 定，行顺序不承载加载语义）：
// 快照一次的后果是路由静默 404。路由交给 harness.route 登记，由外层在就绪后注册。
// root：会话所在项目对应的图库（「根」）。lib：当前打开的那一层，可能是根，也可能是某个子项目。
// 图引用一律用「相对根的 key」：`架构` 是根的图，`支付/对账` 是子项目「支付」的图库里的图。
// 只此一条规则 —— 没有 ./ 也没有 ../，这样列表、AI、链接三处写法完全一致。
var root = { dir: GLOBAL_DIR, scope: 'global', workspace: '' };
var lib = { dir: GLOBAL_DIR, scope: 'global', workspace: '' };
var loadedFor = null; // 内存里这份文档来自哪个 dir
var everLoaded = false; // 是否已经载入过 —— 首次载入不 bump 修订号（「刚载入」就是 0）
var loadQueue = Promise.resolve(); // 载入/切库的串行队列
// 提示词上下文是同步求值的，不能 await，所以清单走缓存；周期扫描让它自己保持新鲜。
var libraryCache = [];
var libraryCacheAt = 0; // 上次**扫描**的时刻（TTL 门）：扫描只走目录，所以可以几秒一次
var libraryFiles = []; // 项目里散落的 .mmd / .mermaid（自动扫描的副产物，按路径打开用）
var libraryFingerprint = ''; // 上次扫描的指纹：变了才去读文件内容算节点数
var libraryRev = 0; // 图库清单修订号：界面靠它发现「有新图了」并自动刷新
var doc = {
    name: DEFAULT_DIAGRAM,
    nodes: [], edges: [], groups: [], extras: [],
    direction: 'TD', revision: 0, updatedBy: 'init', updatedAt: Date.now(),
    file: '', warnings: [], notes: [], tombstoned: false,
    // 整张图的一句话总结（`%% @summary`）：图级字段，不挂节点。进提示词的头部，
    // 也随图库清单回给界面 —— 它回答的是「这张图讲的是什么」，不必读完整个文件。
    summary: '',
    absent: false,
    // 代码锚点的失效校验结果（派生数据，不落盘）：{ 节点id: { 引用: 'ok'|'missing'|'symbol-missing'|'unknown' } }
    fileStatus: {},
    // 打开的是项目里某个 .mmd / .mermaid 文件时，这里放它的绝对路径（图库里的图是 null）。
    // 有它就意味着「别被图库加载冲掉」+ 提示词里要写明这张图的真相源是哪个文件。
    external: null,
};
// 最近一次改动的来源与涉及节点。界面拿它把 AI 刚动过的地方高亮出来 ——
// 「图变了」和「变在哪」是两件事，后者才是沟通。
var lastChange = null;
function msgOf(e) {
    if (e && typeof e === 'object' && typeof e.message === 'string')
        return e.message;
    return String(e);
}
function cleanName(raw) {
    var s = String(raw == null ? '' : raw).replace(/[\/\\:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
    if (s === '' || s === '.' || s === '..')
        return DEFAULT_DIAGRAM;
    return s.slice(0, 60);
}
function hasTombstone(text) { return /^\s*%%\s*@deleted/.test(text); }
function bump(by) {
    doc.revision += 1;
    doc.updatedBy = by;
    doc.updatedAt = Date.now();
}
function adopt(parsed) {
    doc.nodes = parsed.nodes;
    doc.edges = parsed.edges;
    doc.groups = parsed.groups;
    doc.extras = parsed.extras || [];
    doc.direction = parsed.direction || 'TD';
    // 一句话总结是图级的，解析器直接给出来；解析结果里没有就归零（删掉那一行 = 真的删掉）。
    doc.summary = cleanSummary(parsed.summary);
    // 解析器发现的异常行、指向不存在节点的注释 —— 这些是「图悄悄少了一块」的唯一线索，
    // 收进 warnings 供 RPC / 日志带出去，别让它烂在解析结果里。
    var parsedWarnings = parsed.warnings || [];
    for (var i = 0; i < parsedWarnings.length; i++) {
        if (doc.warnings.length < 50)
            doc.warnings.push(parsedWarnings[i]);
    }
}
function emptyDoc() {
    return { nodes: [], edges: [], groups: [], extras: [], direction: 'TD', warnings: [] };
}
function seedDoc() {
    return parseMermaid([
        'flowchart TD',
        '  n1["用户界面 (Web GUI)"]',
        '  n2["会话与工具编排"]',
        '  n3[("持久化状态")]',
        '  n4{"是否需要用户确认?"}',
        '  n5["同步执行"]',
        '  n1 -->|"输入 / 操作"| n2',
        '  n2 -->|"读写"| n3',
        '  n2 --> n4',
        '  n4 -->|"否"| n5',
        '  n4 -->|"是"| n1',
        '  n5 -.->|"事件流"| n1',
        '',
        '%% @pos n1 0 0',
        '%% @pos n2 0 140',
        '%% @pos n3 300 140',
        '%% @pos n4 0 300',
        '%% @pos n5 -190 460',
    ].join('\n'));
}
// 记录沙箱策略缺失原因，同原因只报一次，防止高频刷屏
var reportedSandboxMissingReasons = {};
/**
 * 获取会话对应的沙箱执行策略。
 * 必须传会话：fs 服务的写入受按调用沙箱策略约束，若不传会退回后端默认（部署工作区根，而非当前项目）。
 * 绝不自己声明 mode：传 mode 会被视为「一次已批准的显式模式」从而覆盖会话自身的模式（权限放大）。
 * 只传 { session }，由策略归属方 sandboxPolicy 决定真实的 mode 与 workspaceRoot。
 */
function policyOfSession(sess) {
    if (!sess) {
        if (!reportedSandboxMissingReasons['no-session']) {
            reportedSandboxMissingReasons['no-session'] = true;
            logEvent('warn', 'sandbox.policy.missing', { reason: 'no-session' });
        }
        return undefined;
    }
    if (!sandboxPolicySvc || typeof sandboxPolicySvc.resolve !== 'function') {
        if (!reportedSandboxMissingReasons['no-service']) {
            reportedSandboxMissingReasons['no-service'] = true;
            logEvent('warn', 'sandbox.policy.missing', { reason: 'no-service' });
        }
        return undefined;
    }
    try {
        return sandboxPolicySvc.resolve({ session: sess });
    }
    catch (e) {
        var r = 'resolve-failed:' + msgOf(e);
        if (!reportedSandboxMissingReasons[r]) {
            reportedSandboxMissingReasons[r] = true;
            logEvent('warn', 'sandbox.policy.missing', { reason: r });
        }
        return undefined;
    }
}
function policyOfAgent(agent) {
    return policyOfSession(agent && agent.session);
}
function policyOfSessionId(id) {
    if (!id)
        return undefined;
    if (!agentsSvc || typeof agentsSvc.get !== 'function') {
        if (!reportedSandboxMissingReasons['no-agents-service']) {
            reportedSandboxMissingReasons['no-agents-service'] = true;
            logEvent('warn', 'sandbox.policy.missing', { reason: 'no-agents-service' });
        }
        return undefined;
    }
    try {
        var agent = agentsSvc.get(id);
        return policyOfAgent(agent);
    }
    catch (e) {
        var r = 'agents-get-failed:' + msgOf(e);
        if (!reportedSandboxMissingReasons[r]) {
            reportedSandboxMissingReasons[r] = true;
            logEvent('warn', 'sandbox.policy.missing', { reason: r });
        }
        return undefined;
    }
}
/**
 * 落盘。`site` 只是记进检查点标签（谁在哪儿改的），不影响写什么。
 * 写成功之后在这里记一份检查点 —— 这是唯一的收口：所有写入路径都经过 persist，
 * 于是「AI 改的」「用户改的」自动都留档，不需要每个调用点各自记得。
 */
async function persist(policy, site) {
    if (!fs)
        return 'fs 服务不可用';
    try {
        if (doc.absent) {
            var targetDir = doc.file.slice(0, doc.file.lastIndexOf('/'));
            if (lib.scope === 'project') {
                var inherited = await inheritGlobalOnce({ dir: targetDir }, policy);
                if (inherited)
                    doc.notes.push(inherited);
            }
            await ensureDir(targetDir, policy);
        }
        var body = serializeDoc(doc);
        // 软删除过的图再落盘时要把墓碑保住，否则一次无关的写就把「已删除」抹掉了
        if (doc.tombstoned)
            body = TOMBSTONE + '\n' + body;
        await fs.writeText(await fs.resolve(doc.file), body, undefined, undefined, policy);
        doc.absent = false;
        pushHistory(body, site);
        return null;
    }
    catch (e) {
        return msgOf(e);
    }
}
/** where 为字符串时解析成图库；空串表示显式用全局图库。undefined 表示「不改」。 */
function resolveLib(where) {
    var w = typeof where === 'string' ? where.trim() : '';
    if (w === '')
        return { dir: GLOBAL_DIR, scope: 'global', workspace: '' };
    w = w.replace(/\/+$/, '');
    return { dir: w + '/' + PROJECT_SUBDIR, scope: 'project', workspace: w };
}
/**
 * 从工具执行上下文里取项目路径。
 * ToolExecutionInput.agent 是「这次调用代表谁」，Agent 上带着会话的 cwd ——
 * 所以 AI 侧的调用不会跑错图库。字段名按 DSH 的会话元数据取值，取不到就算了。
 */
function whereOfExec(exec) {
    try {
        var a = exec && exec.agent;
        if (!a)
            return undefined;
        var cands = [a.cwd, a.session && a.session.cwd, a.header && a.header.cwd];
        for (var i = 0; i < cands.length; i++) {
            if (typeof cands[i] === 'string' && cands[i])
                return cands[i];
        }
    }
    catch (e) { }
    return undefined;
}
/**
 * 从工具执行上下文里取会话 id —— 落盘要用它换一份沙箱策略（见 policyOfSessionId）。
 * 取不到就返回 undefined：那一路退回「不传策略」的旧行为，而不是伪造一把更宽的围栏。
 */
function sessionIdOfExec(exec) {
    try {
        var a = exec && exec.agent;
        if (!a)
            return undefined;
        if (a.session && a.session.id)
            return a.session.id;
        if (a.id)
            return a.id;
    }
    catch (e) { }
    return undefined;
}
async function listDiagrams(dir) {
    var items = [];
    if (!fs)
        return items;
    var entries = [];
    try {
        var t = await fs.resolve(dir);
        var info = await fs.stat(t);
        if (info)
            entries = await fs.listDir(t);
    }
    catch (e) {
        return items;
    }
    for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        if (entry.type !== 'file')
            continue;
        if (entry.name.slice(-4) !== '.mmd')
            continue;
        var text = '';
        try {
            text = await fs.readText(entry.target);
        }
        catch (e) {
            continue;
        }
        var parsed = parseMermaid(text);
        items.push({
            name: entry.name.slice(0, -4),
            deleted: hasTombstone(text),
            nodes: parsed.nodes.length,
            edges: parsed.edges.length,
            links: parsed.nodes.filter(function (n) { return !!n.link; }).length,
            bytes: entry.size || text.length,
            summary: cleanSummary(parsed.summary),
        });
    }
    items.sort(function (a, b) {
        if (a.deleted !== b.deleted)
            return a.deleted ? 1 : -1;
        return a.name.localeCompare(b.name);
    });
    return items;
}
/**
 * 保证目录存在。fs 服务没有 mkdir，所以先试「写一个占位文件」——
 * 多数后端在写文件时会顺手建父目录；不行再问 directoryPickerController。
 * 占位文件用 .gitkeep，顺便让这个目录容易被纳入版本管理。
 */
async function ensureDir(path, policy) {
    if (!fs)
        return false;
    try {
        var t = await fs.resolve(path);
        if (await fs.stat(t))
            return true;
    }
    catch (e) { }
    try {
        await fs.writeText(await fs.resolve(path + '/.gitkeep'), '', undefined, undefined, policy);
        return true;
    }
    catch (e) { }
    try {
        var dp = ctx.get('directoryPickerController');
        if (dp && typeof dp.createDirectory === 'function') {
            await dp.createDirectory(path.replace(/\/[^/]+$/, ''), path.replace(/^.*\//, ''));
            return true;
        }
    }
    catch (e) { }
    return false;
}
/**
 * 第一次进入某个项目图库、且那个目录还不存在时，把全局图库里的图复制过来。
 * 为什么要有这一步：图库从「全局」改成「跟项目走」之后，用户已有的图如果不搬，
 * 一打开项目就会看到空画布 —— 看起来像丢了。用全局目录里的标记文件保证只发生一次
 * （之后新建的项目从干净的图库开始）。
 */
async function inheritGlobalOnce(target, policy) {
    if (!fs)
        return '';
    try {
        var marker = await fs.resolve(GLOBAL_DIR + '/.inherited');
        if (await fs.stat(marker))
            return '';
        var items = await listDiagrams(GLOBAL_DIR);
        var live = items.filter(function (x) { return !x.deleted; });
        for (var i = 0; i < live.length; i++) {
            var text = await fs.readText(await fs.resolve(GLOBAL_DIR + '/' + live[i].name + '.mmd'));
            await fs.writeText(await fs.resolve(fileAt(target.dir, live[i].name)), text, undefined, undefined, policy);
        }
        await fs.writeText(marker, '首次进入项目图库时做过一次继承：' + new Date().toISOString() + '\n', undefined, undefined, policy);
        return live.length > 0 ? '已把全局图库里的 ' + live.length + ' 张图复制到 ' + target.dir : '';
    }
    catch (e) {
        doc.warnings.push('继承全局图库失败: ' + msgOf(e));
        return '';
    }
}
function cleanSeg(raw) {
    return String(raw == null ? '' : raw).replace(/[\/\\:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
}
/** key → { project, name }。project 为空表示根图库。 */
function splitKey(key) {
    var raw = String(key == null ? '' : key).replace(/\\/g, '/').trim();
    var segs = raw.split('/');
    var name = cleanName(segs.pop() || '');
    var proj = [];
    for (var i = 0; i < segs.length; i++) {
        var seg = segs[i].trim();
        if (seg === '' || seg === '.')
            continue;
        if (seg === '..') {
            proj.pop();
            continue;
        }
        proj.push(cleanSeg(seg));
    }
    return { project: proj.join('/'), name: name };
}
function libOf(project) {
    if (!project)
        return { dir: root.dir, scope: root.scope, workspace: root.workspace };
    var base = String(root.workspace || '').replace(/\/+$/, '');
    if (!base)
        return null; // 没有项目可言，就没法引用子图库
    var ws = base + '/' + project;
    return { dir: ws + '/' + PROJECT_SUBDIR, scope: 'project', workspace: ws };
}
function resolveKey(key) {
    var k = splitKey(key);
    var target = libOf(k.project);
    if (!target)
        return null;
    // 返回新对象而不是往 k 上挂字段 —— 后者 TS 推不出来，而且会悄悄改变 splitKey 的返回形状
    return {
        project: k.project, name: k.name,
        dir: target.dir, scope: target.scope, workspace: target.workspace,
    };
}
/** 当前这一层相对根的子路径（根层为空串）。 */
function projectRel() {
    if (root.scope !== 'project' || !root.workspace || !lib.workspace)
        return '';
    if (lib.workspace === root.workspace)
        return '';
    if (lib.workspace.indexOf(root.workspace + '/') !== 0)
        return '';
    return lib.workspace.slice(root.workspace.length + 1);
}
function keyOf(name, project) {
    var p = project === undefined ? projectRel() : project;
    return p ? p + '/' + name : name;
}
function fileAt(dir, name) { return dir + '/' + name + '.mmd'; }
/** 节点的下钻链接统一按 key 存（允许 `子项目/图名`）；空串表示没有链接。 */
function normLink(v) {
    var t = typeof v === 'string' ? v.trim() : '';
    if (t === '')
        return null;
    var k = splitKey(t);
    return keyOf(k.name, k.project);
}
/** 能直接打开的 mermaid 文件：整份文件就是一张图。 */
function isDiagramPath(p) {
    return DIAGRAM_EXT_RE.test(String(p == null ? '' : p));
}
/**
 * 把用户给的路径弄成绝对路径：绝对路径照用，相对路径按项目根（没有项目根就按当前图库）。
 * 不限制「必须在自己的项目里」—— 路径是用户自己敲的，fs 服务那边自有它的边界，越界会明确报错。
 */
function resolveDiagramPath(raw) {
    var p = String(raw == null ? '' : raw).trim().replace(/\\/g, '/');
    if (p === '')
        return '';
    p = p.replace(/^\.\//, '').replace(/\/{2,}/g, '/');
    if (p.charAt(0) === '/')
        return p;
    var base = String((root && root.workspace) || (lib && lib.dir) || '').replace(/\/+$/, '');
    if (!base)
        return '';
    return base + '/' + p;
}
function baseNameOf(path) {
    var s = String(path == null ? '' : path).replace(/\\/g, '/');
    var i = s.lastIndexOf('/');
    return cleanName(s.slice(i + 1).replace(DIAGRAM_EXT_RE, ''));
}
/**
 * 打开项目里任意位置的一个 mermaid 文件：此后画布编辑的就是这个文件本身（落盘写回原路径）。
 * 它不属于任何图库，所以不参与改名/软删除那一套 —— 这张图的「key」就是路径。
 */
async function openExternal(path, create, policy) {
    if (!fs)
        return { ok: false, error: 'fs 服务不可用' };
    if (!isDiagramPath(path))
        return { ok: false, error: '只支持 .mmd / .mermaid 文件：' + path };
    var text = null;
    try {
        var t = await fs.resolve(path);
        var info = await fs.stat(t);
        if (info)
            text = await fs.readText(t);
    }
    catch (e) {
        return { ok: false, error: '读不到 ' + path + '：' + msgOf(e) };
    }
    if (text === null && !create) {
        return { ok: false, error: '文件不存在：' + path + '（要新建就带上 create）' };
    }
    doc.external = path;
    doc.name = baseNameOf(path);
    doc.file = path;
    doc.tombstoned = false;
    doc.absent = false;
    doc.warnings = [];
    doc.notes = [];
    if (text !== null) {
        adopt(parseMermaid(text));
    }
    else {
        adopt(emptyDoc());
        var err = await persist(policy, 'doc:openPath');
        if (err)
            doc.warnings.push('写入失败: ' + err);
    }
    bump('switch');
    lastChange = { by: 'switch', rev: doc.revision, nodes: [] };
    // 外部文件不改变「内存里这份文档来自哪个图库」：切回图库里的图仍按 loadedFor 判断
    loadedFor = lib.dir;
    logEvent('info', 'doc.openPath', {
        path: path, created: text === null, nodes: doc.nodes.length, edges: doc.edges.length,
    });
    return fullOf();
}
// 往下扫的时候要跳过的目录：不跳的话在 my/ 这种容器根下会扫进 node_modules 和 target
var SKIP_DIRS = {
    node_modules: 1, '.git': 1, dist: 1, build: 1, target: 1, coverage: 1,
    '.venv': 1, venv: 1, __pycache__: 1, '.next': 1, '.cache': 1, '.turbo': 1,
};
// 图库嵌在子项目里（<子项目>/.arch-canvas），所以往下找 .arch-canvas。
// 深度与条数都封顶：这是一次「走目录」的扫描，不能在大仓库里变成遍历全树。
var SCAN_MAX_DEPTH = 5;
var SCAN_MAX_LIBS = 200;
var SCAN_MAX_FILES = 200;
var MAX_ITEMS = 300;
// 自动扫描的节奏与边界。走目录很便宜（不读文件内容），但项目一大就不便宜了 ——
// 实测一个 596 个目录的项目（深度 ≤5、跳过常规目录）走一遍是几百次 fs 调用，
// 所以：① TTL 让 2.5s 一轮的界面轮询最多每 15s 触发一次；② 目录预算封顶，
// 走不完就记 truncated（宁可少扫，不可让轮询把宿主拖慢）。
var SCAN_TTL_MS = 15000;
var SCAN_INTERVAL_MS = 20000;
var SCAN_MAX_DIRS = 800;
// 项目里散落的 mermaid 文件只认这两种扩展名：「打开就是编辑这个文件」只对
// 「整份文件就是一张图」成立，.md 里的 ```mermaid 代码块不在其中。
var DIAGRAM_EXT_RE = /\.(mmd|mermaid)$/i;
/** 一次项目扫描：找出所有 .arch-canvas 图库目录 + 散落的 mermaid 文件。只走目录，不读内容。 */
async function scanProject() {
    var out = { dirs: [], files: [], visited: 0, truncated: false };
    if (!fs)
        return out;
    if (root.scope !== 'project' || !root.workspace)
        return out;
    await walkProject(String(root.workspace).replace(/\/+$/, ''), '', 0, out);
    return out;
}
async function walkProject(absDir, rel, depth, out) {
    out.visited += 1;
    if (out.visited > SCAN_MAX_DIRS) {
        out.truncated = true;
        return;
    }
    // 1) 这个目录自己是不是一个图库（<dir>/.arch-canvas）
    var libDir = absDir + '/' + PROJECT_SUBDIR;
    var entries = [];
    try {
        entries = await fs.listDir(await fs.resolve(libDir));
    }
    catch (e) {
        entries = [];
    }
    var files = [];
    for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        if (entry.type !== 'file')
            continue;
        // 图库里的图固定是 .mmd：改名/删除/落盘都靠「key + .mmd」定位文件，不能有第二种扩展名
        if (entry.name.slice(-4) !== '.mmd')
            continue;
        files.push({ name: entry.name, bytes: entry.size || 0 });
    }
    if (files.length > 0 && out.dirs.length < SCAN_MAX_LIBS) {
        out.dirs.push({ dir: libDir, project: rel, files: files });
    }
    // 2) 继续往下找子项目里的图库，顺手收下散落的 mermaid 文件
    if (depth >= SCAN_MAX_DEPTH)
        return;
    var kids = [];
    try {
        kids = await fs.listDir(await fs.resolve(absDir));
    }
    catch (e) {
        return;
    }
    for (var j = 0; j < kids.length; j++) {
        var kid = kids[j];
        if (kid.name.charAt(0) === '.')
            continue; // 含 .arch-canvas 自己：它的图已经按图库收在上面了
        if (SKIP_DIRS[kid.name])
            continue;
        var childAbs = absDir + '/' + kid.name;
        var childRel = rel ? rel + '/' + kid.name : kid.name;
        if (kid.type === 'directory') {
            await walkProject(childAbs, childRel, depth + 1, out);
            continue;
        }
        if (kid.type !== 'file')
            continue;
        if (!DIAGRAM_EXT_RE.test(kid.name))
            continue;
        if (out.files.length >= SCAN_MAX_FILES)
            continue;
        out.files.push({ path: childAbs, rel: childRel, name: kid.name, bytes: kid.size || 0 });
    }
}
/** 扫描结果的指纹：谁加了/删了/改了图，指纹就变。 */
function scanFingerprint(scan) {
    var parts = [];
    for (var i = 0; i < scan.dirs.length; i++) {
        for (var j = 0; j < scan.dirs[i].files.length; j++) {
            parts.push(scan.dirs[i].project + '/' + scan.dirs[i].files[j].name + ':' + scan.dirs[i].files[j].bytes);
        }
    }
    for (var k = 0; k < scan.files.length; k++)
        parts.push(scan.files[k].rel + ':' + scan.files[k].bytes);
    return parts.join('|');
}
/** 把扫描到的图库目录变成列表项：这一步要读文件内容算节点数，所以只在指纹变了才跑。 */
async function buildLibraryItems(scan) {
    var items = [];
    for (var i = 0; i < scan.dirs.length && items.length < MAX_ITEMS; i++) {
        var info = scan.dirs[i];
        for (var j = 0; j < info.files.length && items.length < MAX_ITEMS; j++) {
            var f = info.files[j];
            var text = '';
            try {
                text = await fs.readText(await fs.resolve(info.dir + '/' + f.name));
            }
            catch (e) {
                continue;
            }
            var parsed = parseMermaid(text);
            var name = f.name.slice(0, -4);
            items.push({
                name: name,
                deleted: hasTombstone(text),
                nodes: parsed.nodes.length,
                edges: parsed.edges.length,
                links: parsed.nodes.filter(function (n) { return !!n.link; }).length,
                bytes: f.bytes || text.length,
                project: info.project,
                key: info.project ? info.project + '/' + name : name,
                dir: info.dir,
                summary: cleanSummary(parsed.summary),
            });
        }
    }
    items.sort(function (a, b) {
        if (a.deleted !== b.deleted)
            return a.deleted ? 1 : -1;
        if (a.project !== b.project)
            return a.project < b.project ? -1 : 1;
        return a.name.localeCompare(b.name);
    });
    return items;
}
/**
 * 刷新图库清单 —— 这就是「自动扫描 .arch-canvas」。
 * 周期性调用（界面轮询 + 定时器）时只走目录 + 比指纹；指纹没变就直接返回，
 * 于是「没人看图时也不会漏掉新加的图」，代价却只是一次目录遍历。
 * 指纹变了才 ++libraryRev：界面靠它自动刷新选择器，不用人去重新打开。
 */
async function refreshLibrary(force) {
    var now = Date.now();
    if (!force && libraryCacheAt && now - libraryCacheAt < SCAN_TTL_MS)
        return libraryCache;
    libraryCacheAt = now;
    if (root.scope !== 'project' || !root.workspace) {
        // 没有项目根：全局图库是平铺的，既没有子项目图库也没有「散落文件」
        var flat = await listDiagrams(root.dir);
        for (var i = 0; i < flat.length; i++) {
            flat[i].project = '';
            flat[i].key = flat[i].name;
            flat[i].dir = root.dir;
        }
        libraryCache = flat;
        libraryFiles = [];
        var fpFlat = flat.map(function (x) { return x.name + ':' + x.bytes + ':' + (x.deleted ? 1 : 0); }).join('|');
        if (fpFlat !== libraryFingerprint) {
            libraryFingerprint = fpFlat;
            libraryRev += 1;
        }
        return libraryCache;
    }
    var scan = await scanProject();
    var fp = scanFingerprint(scan);
    if (fp !== libraryFingerprint) {
        libraryCache = await buildLibraryItems(scan);
        libraryFingerprint = fp;
        libraryRev += 1;
        // 高频成功的巡检降为 debug：指纹没变就不读文件、不解析，这条记录的诊断价值只在于
        // "清单确实变了"。默认门槛（info）下不落盘；把 ARCH_CANVAS_LOG_LEVEL=debug 打开就能看到。
        logEvent('debug', 'library.scan', {
            libs: scan.dirs.length, files: scan.files.length, items: libraryCache.length,
            revision: libraryRev, visited: scan.visited, truncated: scan.truncated,
        });
    }
    libraryFiles = scan.files;
    return libraryCache;
}
/** 载入一张图。create 为真时不存在就建；默认图总是允许隐式创建。
 *  target 是这一趟的图库：加载期间的 await 点上 lib 可能已经被别的请求切走，
 *  路径必须从这里取，不能看全局 lib —— 否则 A 库的内容会落到 B 库的文件里。 */
async function loadInto(name, create, target, policy) {
    var clean = cleanName(name);
    if (fs && !create && clean !== DEFAULT_DIAGRAM) {
        try {
            var probe = await fs.resolve(fileAt(target.dir, clean));
            var info0 = await fs.stat(probe);
            if (!info0) {
                logEvent('warn', 'doc.load.missing', { file: fileAt(target.dir, clean) });
                return { ok: false, error: '这个图库里没有叫「' + clean + '」的图' };
            }
        }
        catch (e) { }
    }
    doc.name = clean;
    doc.file = fileAt(target.dir, clean);
    doc.external = null; // 从图库载入：之前打开的外部文件就此让位
    doc.tombstoned = false;
    doc.warnings = [];
    var text = null;
    if (fs) {
        try {
            var t = await fs.resolve(doc.file);
            var info = await fs.stat(t);
            if (info)
                text = await fs.readText(t);
        }
        catch (e) {
            doc.warnings.push('读取 ' + doc.file + ' 失败: ' + msgOf(e));
        }
    }
    if (text !== null) {
        doc.absent = false;
        doc.tombstoned = hasTombstone(text);
        adopt(parseMermaid(text));
        // 打开也是一个检查点：这是「AI 第一次动手之前」那个状态，最常被退回到的就是它。
        pushHistory(text, 'open', 'open');
    }
    else {
        // 读路径（loadInto）绝不创建任何东西：不 ensureDir、不 inheritGlobalOnce、不播种默认图。
        // 项目图库目录或文件不存在时，把 doc 置成空文档，doc.file 仍指向本该写入的路径，标记 absent = true。
        // 只有显式 create（例如 doc:open { create: true } / arch_switch { create: true }）或全局图库才允许创建。
        if (create) {
            if (target.scope === 'project') {
                var inherited = await inheritGlobalOnce(target, policy);
                if (inherited)
                    doc.notes.push(inherited);
                await ensureDir(target.dir, policy);
            }
            adopt(emptyDoc());
            doc.absent = false;
            var err = await persist(policy, 'doc:new');
            if (err)
                doc.warnings.push('写入失败: ' + err);
        }
        else if (target.scope === 'global' && clean === DEFAULT_DIAGRAM) {
            var items = await listDiagrams(target.dir);
            var seed = items.length === 0;
            adopt(seed ? seedDoc() : emptyDoc());
            doc.absent = false;
            var errG = await persist(policy, 'seed');
            if (errG)
                doc.warnings.push('写入失败: ' + errG);
        }
        else {
            adopt(emptyDoc());
            doc.absent = true;
        }
    }
    doc.notes = [];
    // 同一份内容不重复落行（治噪音）：hmr 每次构建都会重新 loadInto 一遍，实测单日 50 行 doc.load，
    // 其中绝大多数内容**逐字节相同**（同一份图被反复读进来）。换了一张图、或文本真的变了才再落一行 ——
    // 「打开了哪张图」这个现场一点没丢，丢掉的只是重复。
    var loadKey = doc.file + '|' + (text === null ? '#new#' + doc.nodes.length : text);
    if (loadKey !== lastDocLoadKey) {
        lastDocLoadKey = loadKey;
        logEvent('info', 'doc.load', {
            file: doc.file, diagram: doc.name, scope: target.scope,
            nodes: doc.nodes.length, edges: doc.edges.length, groups: doc.groups.length,
            tombstoned: doc.tombstoned, warnings: doc.warnings.slice(0, 10),
        });
    }
    return { ok: true };
}
/**
 * 保证内存里的文档来自 where 指定的图库。
 * where 为 undefined 时保持现状（工具或界面没提供信息就沿用上次识别出的项目）。
 * 换库会 bump 修订号并标 by:'switch'，这样界面轮询能发现并重新适应视图。
 *
 * 加载**串行排队**：切库是异步的，而 lib 是模块级可变状态。两个请求同时进来
 * （界面报会话 cwd、AI 工具报另一个项目的 cwd）时，并发的加载会让「内存里这份文档来自
 * 哪个库」与 lib 对不上，后续落盘就把 A 的图写进了 B 的图库。排队之后，每个任务在轮到自己
 * 时才定目标库，谁也不覆盖谁。
 */
function ensureLoaded(where, sessionId) {
    var policy = policyOfSessionId(sessionId);
    if (typeof where === 'string') {
        var next = resolveLib(where);
        if (next.dir !== root.dir) {
            // 换了项目：根和当前层都回到新根。注意这里比的是 root 而不是 lib ——
            // 界面每次都会报会话 cwd，如果拿它跟 lib 比，用户刚下钻到子图库就会被拽回来。
            root = next;
            lib = next;
            loadedFor = null;
            libraryCache = [];
            libraryCacheAt = 0;
            libraryFingerprint = '';
            doc.external = null;
            doc.name = DEFAULT_DIAGRAM;
        }
    }
    // 打开的是项目里的外部文件：别被「图库加载」冲掉（界面每次请求都带 where）
    if (doc.external)
        return Promise.resolve({ ok: true });
    if (loadedFor === lib.dir)
        return Promise.resolve({ ok: true });
    return enqueueLoad(function () {
        // 排到自己时才看 lib：这时它是最新一次切库的结果
        if (loadedFor === lib.dir)
            return { ok: true };
        return loadDiagram(lib, policy);
    });
}
/** 所有加载都排这一条队列 —— 并发进两个库时，内存里的文档与 lib 不会各说各话。 */
function enqueueLoad(task) {
    loadQueue = loadQueue.catch(function () { }).then(task);
    return loadQueue;
}
/**
 * 按 key 打开/新建一张图（doc:open、arch_switch 走这里）。
 * 也排队：这两个入口是直接改 lib 再加载的，不排队就仍与 ensureLoaded 有交叉窗口。
 */
function loadDiagramAt(target, name, create, policy) {
    return enqueueLoad(async function () {
        // 显式新建（create === true）时才创建目录；读路径绝不建目录
        if (create && target.scope === 'project')
            await ensureDir(target.dir, policy);
        var r = await loadInto(name, create, target, policy);
        // 只有目标仍是当前层时才认这一趟；否则下次 ensureLoaded 会重新加载
        if (r && r.ok && lib.dir === target.dir)
            loadedFor = target.dir;
        return r;
    });
}
async function loadDiagram(target, policy) {
    // 读路径绝不创建任何东西：不 ensureDir、不 inheritGlobalOnce、不播种默认图
    var result = await loadInto(doc.name || DEFAULT_DIAGRAM, false, target, policy);
    loadedFor = target.dir;
    // 只有「真的换了」才 bump —— 界面靠修订号变化发现图库变了并重新适应视图
    if (everLoaded) {
        bump('switch');
        lastChange = { by: 'switch', rev: doc.revision, nodes: [] };
        logEvent('info', 'library.switch', { dir: target.dir, scope: target.scope, diagram: doc.name });
    }
    everLoaded = true;
    await refreshLibrary();
    return result;
}
function normalizeModel(model) {
    var nodes = [];
    var seen = {};
    var rawNodes = Array.isArray(model.nodes) ? model.nodes : [];
    for (var i = 0; i < rawNodes.length; i++) {
        var n = rawNodes[i];
        if (!n || typeof n !== 'object')
            continue;
        var id = cleanId(n.id);
        if (seen[id])
            continue;
        seen[id] = true;
        // 用户注释：从界面/文件进来的自由文本，长度要设闸门 —— 它会被原样注入每一步的提示词，
        // 一条超长注释能把上下文挤爆。空注释一律归一成「不存在」：没有正文时 noteDone 没有意义。
        var noteText = typeof n.note === 'string' ? n.note : '';
        if (noteText.length > 2000)
            noteText = noteText.slice(0, 2000);
        // 代码锚点：数组，逐条 trim / 去重 / 设闸门 —— 它同样会进提示词，而且会被拿去 stat。
        var fileList = [];
        var rawFiles = Array.isArray(n.files) ? n.files : [];
        for (var fi = 0; fi < rawFiles.length && fileList.length < 20; fi++) {
            if (typeof rawFiles[fi] !== 'string')
                continue;
            var fv = rawFiles[fi].trim();
            if (!fv || fv.length > 300)
                continue;
            if (fileList.indexOf(fv) < 0)
                fileList.push(fv);
        }
        nodes.push({
            id: id,
            label: typeof n.label === 'string' ? n.label : id,
            shape: SHAPE_WRAP[n.shape] ? n.shape : 'rect',
            group: typeof n.group === 'string' && n.group ? cleanId(n.group) : null,
            x: typeof n.x === 'number' && isFinite(n.x) ? n.x : null,
            y: typeof n.y === 'number' && isFinite(n.y) ? n.y : null,
            link: normLink(n.link),
            note: noteText,
            noteDone: noteText !== '' && n.noteDone === true,
            files: fileList,
        });
    }
    var edges = [];
    var rawEdges = Array.isArray(model.edges) ? model.edges : [];
    for (var j = 0; j < rawEdges.length; j++) {
        var e = rawEdges[j];
        if (!e || typeof e !== 'object')
            continue;
        var from = cleanId(e.from);
        var to = cleanId(e.to);
        if (!seen[from] || !seen[to])
            continue;
        if (from === to)
            continue;
        edges.push({
            id: 'e' + (edges.length + 1), from: from, to: to,
            label: typeof e.label === 'string' ? e.label : '',
            arrow: ARROW_SET[e.arrow] ? e.arrow : '-->',
        });
    }
    var groups = [];
    var known = {};
    for (var a = 0; a < nodes.length; a++)
        if (nodes[a].group)
            known[nodes[a].group] = true;
    var rawGroups = Array.isArray(model.groups) ? model.groups : [];
    for (var k = 0; k < rawGroups.length; k++) {
        var g = rawGroups[k];
        if (!g || typeof g !== 'object')
            continue;
        var gid = cleanId(g.id);
        groups.push({ id: gid, label: typeof g.label === 'string' && g.label ? g.label : gid });
        known[gid] = true;
    }
    for (var key in known) {
        var found = false;
        for (var m = 0; m < groups.length; m++)
            if (groups[m].id === key) {
                found = true;
                break;
            }
        if (!found)
            groups.push({ id: key, label: key });
    }
    var dir = DIR_SET[model.direction] ? model.direction : 'TD';
    if (dir === 'TB')
        dir = 'TD';
    var extras = [];
    var rawExtras = Array.isArray(model.extras) ? model.extras : [];
    for (var x = 0; x < rawExtras.length; x++) {
        if (typeof rawExtras[x] === 'string')
            extras.push(rawExtras[x]);
    }
    return {
        nodes: nodes, edges: edges, groups: groups, direction: dir, extras: extras,
        // 图级的一句话总结：白名单里必须带上它 —— normalizeModel 是逐字段重建，
        // 漏了就是「用户每保存一次，总结被静默清空一次」（与元素注释同一个坑）。
        // 唯一的例外是**字段整个缺席**：那是旧界面（换宿主前就打开的页面）发来的模型，
        // 它根本不知道有 summary 这回事 —— 这时保留现状，而不是把它当成「要清空」。
        // 显式清空走 summary: ''（新界面/工具一直是这么发的）。
        summary: typeof model.summary === 'string' ? cleanSummary(model.summary) : cleanSummary(doc.summary),
    };
}
function adoptModel(model) {
    var norm = normalizeModel(model);
    doc.nodes = norm.nodes;
    doc.edges = norm.edges;
    doc.groups = norm.groups;
    doc.direction = norm.direction;
    doc.extras = norm.extras;
    doc.summary = norm.summary;
}
function modelOf() {
    return {
        nodes: doc.nodes, edges: doc.edges, groups: doc.groups,
        direction: doc.direction, extras: doc.extras,
        summary: doc.summary,
    };
}
/** 未解决 / 已解决的元素注释条数。已解决的不进提示词（见 plugin.ts promptText），所以两处都要用。 */
function noteCounts() {
    var open = 0;
    var done = 0;
    for (var i = 0; i < doc.nodes.length; i++) {
        if (!doc.nodes[i].note)
            continue;
        if (doc.nodes[i].noteDone)
            done += 1;
        else
            open += 1;
    }
    return { open: open, done: done };
}
// 把当前所有节点的关键字段压成一个可比较的快照。
// 用「改完求差」而不是「在 applyOps 里逐个记录」：这样 arch_edit / arch_write /
// 用户回写 三条路都自动覆盖，也不会漏掉某个 op 分支。
function nodeKey(n) {
    return n.label + '\u0000' + n.shape + '\u0000' + n.group + '\u0000' + n.x + '\u0000' + n.y +
        '\u0000' + n.link + '\u0000' + (n.note || '') + '\u0000' + (n.noteDone === true ? '1' : '0') +
        '\u0000' + (n.files || []).join('\u0001');
}
function snapshotNodes() {
    var out = {};
    for (var i = 0; i < doc.nodes.length; i++)
        out[doc.nodes[i].id] = nodeKey(doc.nodes[i]);
    return out;
}
// 新增的、以及任何一个字段变了的节点 id。已删除的节点不返回（画布上没东西可高亮）。
function changedNodes(before) {
    var out = [];
    for (var i = 0; i < doc.nodes.length; i++) {
        if (before[doc.nodes[i].id] !== nodeKey(doc.nodes[i]))
            out.push(doc.nodes[i].id);
    }
    return out;
}
// 用户自己的改动不高亮（他知道自己做了什么），但也要记下来，
// 好让界面能区分「这次变更不是我引起的」。
function noteUserChange() {
    lastChange = { by: 'user', rev: doc.revision, nodes: [] };
}
function noteAiChange(before) {
    lastChange = { by: 'ai', rev: doc.revision, nodes: changedNodes(before) };
}
function findNode(id) {
    var key = cleanId(id);
    for (var i = 0; i < doc.nodes.length; i++)
        if (doc.nodes[i].id === key)
            return doc.nodes[i];
    return null;
}
function nextNodeId() {
    var i = doc.nodes.length + 1;
    while (findNode('n' + i))
        i += 1;
    return 'n' + i;
}
function removeNode(id) {
    var key = cleanId(id);
    doc.nodes = doc.nodes.filter(function (n) { return n.id !== key; });
    doc.edges = doc.edges.filter(function (e) { return e.from !== key && e.to !== key; });
}
function removeEdge(from, to) {
    var a = cleanId(from);
    var b = cleanId(to);
    doc.edges = doc.edges.filter(function (e) { return !(e.from === a && e.to === b); });
}
function setEdgeLabel(from, to, label) {
    var a = cleanId(from);
    var b = cleanId(to);
    var hit = null;
    for (var i = 0; i < doc.edges.length; i++) {
        if (doc.edges[i].from === a && doc.edges[i].to === b) {
            hit = doc.edges[i];
            break;
        }
    }
    if (!hit) {
        hit = { id: 'e' + (doc.edges.length + 1), from: a, to: b, label: '', arrow: '-->' };
        doc.edges.push(hit);
    }
    hit.label = typeof label === 'string' ? label : '';
    return hit;
}
/** 落盘前的模型快照。写盘失败时用它把内存恢复回去，别让内存与磁盘各说各话。 */
function snapshotModel() {
    return JSON.stringify({
        name: doc.name, file: doc.file, tombstoned: doc.tombstoned, absent: doc.absent === true,
        nodes: doc.nodes, edges: doc.edges, groups: doc.groups,
        direction: doc.direction, extras: doc.extras, notes: doc.notes, fileStatus: doc.fileStatus,
        summary: doc.summary,
    });
}
function restoreModel(saved) {
    var m = JSON.parse(saved);
    doc.name = m.name;
    doc.file = m.file;
    doc.tombstoned = m.tombstoned;
    doc.absent = m.absent === true;
    doc.nodes = m.nodes;
    doc.edges = m.edges;
    doc.groups = m.groups;
    doc.direction = m.direction;
    doc.extras = m.extras;
    doc.notes = m.notes;
    doc.fileStatus = m.fileStatus || {};
    doc.summary = cleanSummary(m.summary);
}
/**
 * 落盘；失败就把内存恢复回改动前，并把原因记进日志。
 * 不恢复的后果：这一版改动只活在内存里，而后续任何一次落盘又会把它写出去 ——
 * 用户看到的是「明明改了，重启之后没了 / 时有时无」。
 */
async function persistOrRollback(saved, site, policy) {
    var err = await persist(policy, site);
    if (!err)
        return null;
    restoreModel(saved);
    if (lastChange)
        lastChange = { by: lastChange.by, rev: doc.revision, nodes: [] };
    doc.warnings.push('保存失败，本次改动已回滚: ' + err);
    logEvent('error', 'persist.fail', { site: site, file: doc.file, error: err });
    return err;
}
/**
 * 回到某个检查点。
 *
 * **这不是「撤销一步」**：把那一份正文重新装进文档、落盘，然后在历史末尾追加一条
 * 「用户 · 回到检查点」。时间线只增不减 —— 于是退回之后还能再往前走（更晚的那些检查点还在），
 * 而不是「一退就再也回不来」。界面上的 60 步撤销是另一层（只在内存、只管这一次会话的手动编辑）。
 *
 * 为什么用 `inheritPositions`：老快照里某些节点可能没有坐标（用户摆过、后来才写进文件），
 * 继承当前位置比让它们跳回去更符合直觉 —— 与 arch_write 同一条规则。
 */
async function applyRollback(seq, policy) {
    var entry = findHistory(seq);
    if (!entry)
        return { ok: false, error: '这个检查点不在历史里了（历史只在内存里，重启 dsh 会清空）' };
    if (entry.text === currentText())
        return { ok: false, error: '这就是当前状态，不用退回' };
    var parsed = inheritPositions(parseMermaid(entry.text));
    if (parsed.nodes.length === 0 && parsed.extras.length === 0) {
        return { ok: false, error: '那份快照里没有节点也没有内容行，已放弃（图没有变）' };
    }
    var saved = snapshotModel();
    adopt(parsed);
    adoptModel(modelOf());
    doc.tombstoned = hasTombstone(entry.text);
    bump('user');
    noteUserChange();
    doc.notes = ['回到检查点：' + historyLabelOf(entry)];
    var err = await persistOrRollback(saved, 'rollback:' + seq, policy);
    if (err) {
        logEvent('error', 'history.rollback.fail', { seq: seq, file: doc.file, error: err });
        return { ok: false, error: err };
    }
    logEvent('info', 'history.rollback', {
        seq: seq, file: doc.file, fromRev: entry.rev, nodes: doc.nodes.length, edges: doc.edges.length,
    });
    return { ok: true };
}
/**
 * 取 op 里的节点 / 分组引用。
 * 缺字段时 cleanId('') 会得到 'n' —— 图里恰好有节点 'n' 的话，一个畸形 op 就会静默删掉它。
 * 所以这里显式拒绝，并把原因交给 problems 回给 AI。
 */
function opRef(value, field, tag, problems) {
    if (typeof value !== 'string' || value.trim() === '') {
        problems.push(tag + ': 缺少 ' + field);
        return null;
    }
    return cleanId(value);
}
function applyOps(ops) {
    var problems = [];
    var done = [];
    for (var i = 0; i < ops.length; i++) {
        var op = ops[i] && typeof ops[i] === 'object' ? ops[i] : {};
        var kind = op.op;
        var tag = '第 ' + (i + 1) + ' 个 op(' + String(kind) + ')';
        if (kind === 'add_node') {
            var nid = op.id ? cleanId(op.id) : nextNodeId();
            if (findNode(nid)) {
                problems.push(tag + ': 节点 ' + nid + ' 已存在，改用 set_label');
                continue;
            }
            doc.nodes.push({
                id: nid,
                label: typeof op.label === 'string' && op.label !== '' ? op.label : nid,
                shape: SHAPE_WRAP[op.shape] ? op.shape : 'rect',
                group: typeof op.group === 'string' && op.group ? cleanId(op.group) : null,
                x: typeof op.x === 'number' ? op.x : null,
                y: typeof op.y === 'number' ? op.y : null,
                link: normLink(op.link),
                note: '',
                noteDone: false,
                files: [],
            });
            done.push('新增节点 ' + nid);
        }
        else if (kind === 'set_label') {
            var lid = opRef(op.id, 'id', tag, problems);
            if (lid === null)
                continue;
            var ln = findNode(lid);
            if (!ln) {
                problems.push(tag + ': 找不到节点 ' + String(op.id));
                continue;
            }
            ln.label = typeof op.label === 'string' ? op.label : ln.label;
            done.push('改标签 ' + ln.id);
        }
        else if (kind === 'set_shape') {
            var sid = opRef(op.id, 'id', tag, problems);
            if (sid === null)
                continue;
            var sn = findNode(sid);
            if (!sn) {
                problems.push(tag + ': 找不到节点 ' + String(op.id));
                continue;
            }
            if (!SHAPE_WRAP[op.shape]) {
                problems.push(tag + ': 未知形状 ' + String(op.shape));
                continue;
            }
            sn.shape = op.shape;
            done.push('改形状 ' + sn.id);
        }
        else if (kind === 'set_link') {
            var kid = opRef(op.id, 'id', tag, problems);
            if (kid === null)
                continue;
            var kn = findNode(kid);
            if (!kn) {
                problems.push(tag + ': 找不到节点 ' + String(op.id));
                continue;
            }
            kn.link = normLink(op.link);
            done.push(kn.link ? '把 ' + kn.id + ' 下钻到「' + kn.link + '」' : '取消 ' + kn.id + ' 的下钻链接');
        }
        else if (kind === 'move_node') {
            var mid = opRef(op.id, 'id', tag, problems);
            if (mid === null)
                continue;
            var mn = findNode(mid);
            if (!mn) {
                problems.push(tag + ': 找不到节点 ' + String(op.id));
                continue;
            }
            if (typeof op.x === 'number')
                mn.x = op.x;
            if (typeof op.y === 'number')
                mn.y = op.y;
            done.push('移动 ' + mn.id);
        }
        else if (kind === 'remove_node') {
            var rid = opRef(op.id, 'id', tag, problems);
            if (rid === null)
                continue;
            if (!findNode(rid)) {
                problems.push(tag + ': 找不到节点 ' + String(op.id));
                continue;
            }
            removeNode(rid);
            done.push('删除节点 ' + rid);
        }
        else if (kind === 'add_edge') {
            var af = opRef(op.from, 'from', tag, problems);
            var at = opRef(op.to, 'to', tag, problems);
            if (af === null || at === null)
                continue;
            var f = findNode(af);
            var t = findNode(at);
            if (!f) {
                problems.push(tag + ': from 节点不存在 ' + String(op.from));
                continue;
            }
            if (!t) {
                problems.push(tag + ': to 节点不存在 ' + String(op.to));
                continue;
            }
            if (f.id === t.id) {
                problems.push(tag + ': 不允许自环');
                continue;
            }
            var arrow = ARROW_SET[op.arrow] ? op.arrow : '-->';
            var dup = false;
            for (var d = 0; d < doc.edges.length; d++) {
                if (doc.edges[d].from === f.id && doc.edges[d].to === t.id) {
                    dup = true;
                    break;
                }
            }
            if (dup) {
                problems.push(tag + ': ' + f.id + ' -> ' + t.id + ' 已存在，改用 set_edge_label');
                continue;
            }
            doc.edges.push({ id: 'e' + (doc.edges.length + 1), from: f.id, to: t.id, label: typeof op.label === 'string' ? op.label : '', arrow: arrow });
            done.push('连线 ' + f.id + ' -> ' + t.id);
        }
        else if (kind === 'remove_edge') {
            var xf = opRef(op.from, 'from', tag, problems);
            var xt = opRef(op.to, 'to', tag, problems);
            if (xf === null || xt === null)
                continue;
            removeEdge(xf, xt);
            done.push('删除连线 ' + xf + ' -> ' + xt);
        }
        else if (kind === 'set_edge_label') {
            var lf = opRef(op.from, 'from', tag, problems);
            var lt = opRef(op.to, 'to', tag, problems);
            if (lf === null || lt === null)
                continue;
            if (!findNode(lf) || !findNode(lt)) {
                problems.push(tag + ': from/to 节点不存在');
                continue;
            }
            if (lf === lt) {
                problems.push(tag + ': 不允许自环');
                continue;
            }
            setEdgeLabel(lf, lt, typeof op.label === 'string' ? op.label : '');
            done.push('改连线标签 ' + lf + ' -> ' + lt);
        }
        else if (kind === 'set_group') {
            var gid0 = opRef(op.id, 'id', tag, problems);
            if (gid0 === null)
                continue;
            var gn = findNode(gid0);
            if (!gn) {
                problems.push(tag + ': 找不到节点 ' + String(op.id));
                continue;
            }
            var want = typeof op.group === 'string' && op.group ? cleanId(op.group) : null;
            gn.group = want;
            if (want) {
                var exists = false;
                for (var q = 0; q < doc.groups.length; q++)
                    if (doc.groups[q].id === want) {
                        exists = true;
                        break;
                    }
                if (!exists)
                    doc.groups.push({ id: want, label: typeof op.label === 'string' && op.label ? op.label : want });
            }
            done.push('设置分组 ' + gn.id + ' -> ' + String(want));
        }
        else if (kind === 'add_group') {
            var gid = op.group ? cleanId(op.group) : (op.id ? cleanId(op.id) : 'g' + (doc.groups.length + 1));
            var have = false;
            for (var w = 0; w < doc.groups.length; w++)
                if (doc.groups[w].id === gid) {
                    have = true;
                    break;
                }
            if (have) {
                problems.push(tag + ': 分组 ' + gid + ' 已存在');
                continue;
            }
            doc.groups.push({ id: gid, label: typeof op.label === 'string' && op.label ? op.label : gid });
            done.push('新增分组 ' + gid);
        }
        else if (kind === 'remove_group') {
            var rgRaw = typeof op.group === 'string' && op.group !== '' ? op.group : op.id;
            var rgid = opRef(rgRaw, 'group', tag, problems);
            if (rgid === null)
                continue;
            doc.groups = doc.groups.filter(function (g) { return g.id !== rgid; });
            for (var z = 0; z < doc.nodes.length; z++)
                if (doc.nodes[z].group === rgid)
                    doc.nodes[z].group = null;
            done.push('删除分组 ' + rgid);
        }
        else if (kind === 'set_direction') {
            var dv = String(op.value || op.label || '').toUpperCase();
            if (!DIR_SET[dv]) {
                problems.push(tag + ': 方向只能是 TD/BT/LR/RL');
                continue;
            }
            doc.direction = dv === 'TB' ? 'TD' : dv;
            done.push('方向 -> ' + doc.direction);
        }
        else if (kind === 'set_summary') {
            // 整张图的一句话总结（图级，不挂节点）：传空串 = 清掉。用 label 传文本，
            // 与其它 op 一致（工具 schema 里 label 的描述写明了这一条）。
            var sumNext = cleanSummary(typeof op.label === 'string' ? op.label : '');
            doc.summary = sumNext;
            done.push(sumNext ? '这张图的一句话总结已更新' : '清掉了这张图的一句话总结');
        }
        else if (kind === 'set_files') {
            // 代码锚点：整组替换（不是增删单条）—— 「这个节点对应哪几个文件」是一个整体判断，
            // 增量改容易改出半截状态。传空数组 = 清掉。
            var ffid = opRef(op.id, 'id', tag, problems);
            if (ffid === null)
                continue;
            var ffn = findNode(ffid);
            if (!ffn) {
                problems.push(tag + ': 找不到节点 ' + String(op.id));
                continue;
            }
            var nextFiles = [];
            var rawFs = Array.isArray(op.files) ? op.files : [];
            for (var fk = 0; fk < rawFs.length && nextFiles.length < 20; fk++) {
                if (typeof rawFs[fk] !== 'string')
                    continue;
                var fsv = rawFs[fk].trim();
                if (!fsv || fsv.length > 300)
                    continue;
                if (nextFiles.indexOf(fsv) < 0)
                    nextFiles.push(fsv);
            }
            ffn.files = nextFiles;
            done.push(nextFiles.length
                ? ('给 ' + ffn.id + ' 标了 ' + nextFiles.length + ' 个代码锚点')
                : ('清掉 ' + ffn.id + ' 的代码锚点'));
        }
        else {
            problems.push(tag + ': 未知操作类型');
        }
    }
    return { problems: problems, done: done };
}
function inheritPositions(parsed) {
    var old = {};
    for (var i = 0; i < doc.nodes.length; i++) {
        var n = doc.nodes[i];
        if (typeof n.x === 'number' && typeof n.y === 'number')
            old[n.id] = { x: n.x, y: n.y };
    }
    for (var j = 0; j < parsed.nodes.length; j++) {
        var p = parsed.nodes[j];
        if ((p.x === null || p.x === undefined) && old[p.id]) {
            p.x = old[p.id].x;
            p.y = old[p.id].y;
        }
    }
    return parsed;
}
/**
 * 把「用户在元素上留的东西」（注释 + 代码锚点）继承到一份新文本解析出来的模型上，返回继承了几处。
 *
 * 为什么只给 arch_write 用、不给 doc:applyText 用 —— 这条边界是刻意的：
 * 注释与锚点都是**用户**的东西，AI 整体重画时不该把它悄悄抹掉；但用户自己在「源码」页删掉那一行，
 * 就是真的要删，这时还去继承，它们就成了删不掉的幽灵
 * （和 `@pos` 那条「注释不许让节点复活」是同一个坑，只是方向相反）。
 *
 * 图级的一句话总结（`%% @summary`）走同一条边界：新文本自己写了就用新的，
 * 没写就继承 —— 重画时把它悄悄清掉，等于把「这张图讲的是什么」也一起丢了。
 */
function inheritUserMarks(parsed) {
    var old = {};
    for (var i = 0; i < doc.nodes.length; i++) {
        var n = doc.nodes[i];
        if (n.note || (n.files && n.files.length)) {
            old[n.id] = { note: n.note || '', done: n.noteDone === true, files: (n.files || []).slice() };
        }
    }
    var kept = 0;
    for (var j = 0; j < parsed.nodes.length; j++) {
        var p = parsed.nodes[j];
        if (p.note)
            continue; // 新文本自己带了注释，以它为准
        if (!old[p.id])
            continue; // 节点没重画出来，注释与锚点跟着它一起走
        p.note = old[p.id].note;
        p.noteDone = old[p.id].done;
        // 代码锚点同理：AI 重画时不该把用户标的文件引用抹掉（新文本自己写了就用新的）
        if (!(p.files && p.files.length))
            p.files = old[p.id].files.slice();
        kept += 1;
    }
    if (!cleanSummary(parsed.summary))
        parsed.summary = cleanSummary(doc.summary);
    return kept;
}
// ==================== 代码锚点的失效校验 ====================
// 为什么必须校验：文件会改名、会移动，而注释不会自己更新 —— **一条过期锚点比没有锚点更坏**，
// 它会把 AI 自信地送到错的文件。所以加载/保存后 stat 一遍（带 #符号的再查一次符号），
// 把结论显式摆到界面与提示词里 —— 让腐烂可见，这是这个功能能不能帮上忙的分水岭。
var FILE_REF_LIMIT = 40; // 一次最多校验多少条：有人塞一千条也不能把加载拖死
/** `路径#符号` → { path, symbol }；没有 `#` 时 symbol 为空串。 */
function splitFileRef(ref) {
    var s = String(ref == null ? '' : ref);
    var i = s.indexOf('#');
    if (i < 0)
        return { path: s, symbol: '' };
    return { path: s.slice(0, i), symbol: s.slice(i + 1) };
}
/** 锚点相对谁解析：项目图库相对项目根；外部文件相对它自己所在的目录；其余判不了。 */
function fileRefRoot() {
    if (lib.scope === 'project' && lib.workspace)
        return lib.workspace.replace(/\/+$/, '');
    if (doc.external)
        return doc.external.replace(/\/[^/]*$/, '');
    return '';
}
async function checkFileRef(ref, root) {
    var parts = splitFileRef(ref);
    if (!parts.path)
        return 'missing';
    var abs = /^\//.test(parts.path) ? parts.path : (root ? root + '/' + parts.path : '');
    if (!abs)
        return 'unknown';
    try {
        var t = await fs.resolve(abs);
        var info = await fs.stat(t);
        if (!info)
            return 'missing';
        if (!parts.symbol)
            return 'ok';
        var text = await fs.readText(t);
        return text.indexOf(parts.symbol) >= 0 ? 'ok' : 'symbol-missing';
    }
    catch (e) {
        // 读不出来就当它坏了 —— 宁可说「这条不能用」，也不假装没问题
        return 'missing';
    }
}
/**
 * 重算每个节点上代码锚点的状态，写进 doc.fileStatus（派生数据，不进文件）。
 * 调用方：加载/切库之后、doc:get、doc:set 之后、arch_read —— 这几处覆盖了界面与提示词两条消费路径。
 */
async function verifyFileRefs() {
    var status = {};
    if (!fs) {
        doc.fileStatus = status;
        return status;
    }
    var root = fileRefRoot();
    var budget = FILE_REF_LIMIT;
    for (var i = 0; i < doc.nodes.length; i++) {
        var n = doc.nodes[i];
        var refs = n.files || [];
        if (!refs.length)
            continue;
        var per = {};
        for (var j = 0; j < refs.length; j++) {
            if (budget <= 0) {
                per[refs[j]] = 'unknown';
                continue;
            }
            budget -= 1;
            per[refs[j]] = await checkFileRef(refs[j], root);
        }
        status[n.id] = per;
    }
    doc.fileStatus = status;
    return status;
}

"use strict";
// ==================== 检查点（快照） ====================
// 这里换掉的是早先那道「AI 写图开关」。那条路的问题是**机制本身不可用**：
// 开关状态要落盘到 `<dataDir>/settings.json`（在会话工作区之外），而那次写入没带沙箱策略
// —— 在真机上 `setting:set` 永远抛 file access denied，用户点了也打不开（见 AGENTS.md）。
// 与其修一条「拦人」的路，不如换一条「兜底」的路：
//
//   **不拦 AI 改图，但每一次改动都留一份快照，并标明是谁改的 —— 改坏了点一下退回去。**
//
// 三条设计取舍：
// 1. **只在内存里。** 真相源始终是那个 `.mmd` 文件本身，历史只在「刚刚改坏了、撤回去」这个
//    窗口里有用；写盘要再挂一条沙箱策略路径（正是上面那个坑），代价与收益不成比例。
//    代价是重启后历史清空 —— 界面上写着这句话，别让它看起来像个持久化的版本库。
// 2. **按文件分开存。** 切图/切项目时历史不该串味：`doc.file` 就是键（外部文件按路径打开也适用）。
// 3. **只在新状态**（写盘成功之后）留一份，标签取 `doc.updatedBy` 与 `lastChange.nodes`。
//    于是「回到某一点」= 把那一份文本重新装回文档，而不是「撤销一步」——
//    撤销是界面的事（它有 60 步内存历史），这里是**跨会话、跨工具**的落点。
var HISTORY_LIMIT = 50;
/** { [file]: [ { seq, rev, by, at, site, text, nodeCount, edgeCount, changed } ] }，新的在后面。 */
var historyByFile = {};
var historySeq = 0;
function historyKey() {
    return doc.file || '';
}
function historyOf(file) {
    var key = String(file == null ? '' : file);
    if (!historyByFile[key])
        historyByFile[key] = [];
    return historyByFile[key];
}
/**
 * 记一份检查点。`text` 是这一刻的完整文件正文（落盘写什么，这里就存什么）。
 * 连续两次正文逐字节相同就不记（切图、重复保存、hmr 重新加载都会走到这里）；
 * 同一份内容只在历史里出现一次，列表才是「改动」而不是「操作」。
 * `byOverride` 给「打开」这种**不是改动**的入口用：那时 doc.updatedBy 还是上一份文档留下的。
 */
function pushHistory(text, site, byOverride) {
    var body = String(text == null ? '' : text);
    if (!body || !doc.file)
        return null;
    var list = historyOf(historyKey());
    if (list.length > 0 && list[list.length - 1].text === body)
        return list[list.length - 1];
    var lc = lastChange && lastChange.rev === doc.revision ? lastChange : null;
    var entry = {
        seq: ++historySeq,
        rev: doc.revision,
        by: byOverride || doc.updatedBy || 'init',
        at: Date.now(),
        site: String(site == null ? '' : site),
        text: body,
        nodeCount: doc.nodes.length,
        edgeCount: doc.edges.length,
        changed: lc && lc.nodes ? lc.nodes.slice(0, 12) : [],
    };
    list.push(entry);
    while (list.length > HISTORY_LIMIT)
        list.shift();
    return entry;
}
/** 给界面看的清单：不带正文（正文是整份文件，列表不需要）。 */
function historyList() {
    var list = historyOf(historyKey());
    var out = [];
    for (var i = list.length - 1; i >= 0; i--) {
        var e = list[i];
        out.push({
            seq: e.seq, rev: e.rev, by: e.by, at: e.at, site: e.site,
            nodeCount: e.nodeCount, edgeCount: e.edgeCount, changed: e.changed.slice(),
            current: i === list.length - 1,
        });
    }
    return out;
}
function findHistory(seq) {
    var list = historyOf(historyKey());
    for (var i = 0; i < list.length; i++)
        if (list[i].seq === seq)
            return list[i];
    return null;
}
/** 「AI 的改动（修订 12）」这种给人看的一句话 —— 回执与检查点说明里都用它。 */
var HISTORY_BY_LABEL = { ai: 'AI', user: '用户', open: '打开', switch: '切换', init: '初始' };
function historyByLabel(by) { return HISTORY_BY_LABEL[by] || String(by || ''); }
function historyLabelOf(e) {
    return historyByLabel(e.by) + '的改动（修订 ' + e.rev + '）';
}
/** 当前文档落成正文时的样子 —— 与 persist 写出去的那份逐字节一致。 */
function currentText() {
    var body = serializeDoc(doc);
    if (doc.tombstoned)
        body = TOMBSTONE + '\n' + body;
    return body;
}

"use strict";
// 对外接口面：给 AI 的提示词上下文、mermaid 静态路由、Client↔Host RPC、四个 AI 工具。
// 这一节末尾 return 出 Cordis 插件对象 —— 构建脚本会在最外层再套 return/apply。
// ==================== 注册与现场记录 ====================
// 注册口统一包一层：一是顺手把现场写进日志文件（这个插件对 console 一字不吐），
// 二是让「到底注册上了几个」有据可查 —— 不用再靠人去数。
var registeredTools = [];
var registeredRoutes = [];
/** 注册一条私有 RPC。handler 抛错先留一行现场，再把错抛给外层。 */
function onRpc(name, fn) {
    return harness.handle(name, async function (args) {
        var t0 = Date.now();
        try {
            return await fn(args);
        }
        catch (e) {
            logEvent('error', 'rpc.fail', { method: name, error: msgOf(e), ms: Date.now() - t0 });
            throw e;
        }
    });
}
function onRoute(path, handler) {
    registeredRoutes.push(path);
    harness.route(path, handler);
}
function onTool(def) {
    registeredTools.push(def && def.name);
    harness.registerTool(ctx, def);
}
/** 工具入参不合格时的统一回执。日志里留一行 —— 「它说改了、图上却没变」先查这里。 */
function toolReject(tool, reason, t0) {
    logEvent('warn', 'tool.reject', { tool: tool, reason: reason, ms: Date.now() - t0 });
    return { ok: false, error: reason };
}
// ==================== AI 侧提示词上下文 ====================
function promptText() {
    var curKey = doc.external || keyOf(doc.name);
    var where = doc.external ? '项目里的文件 ' : (lib.scope === 'project' ? '项目图库 ' : '全局图库 ');
    var loc = doc.external ? doc.external : lib.dir;
    var head = [
        '## 逻辑框架画布（arch-canvas）',
        '你和用户在看同一张图。当前这张的引用名是「' + curKey + '」，在' + where + loc + '（修订 ' + doc.revision + '，最后修改者：' + doc.updatedBy + '）。',
        '- 这张图表达的是**讨论中的逻辑框架**，不保证与代码一致 —— 不要拿代码去「纠正」它，也不要因为图上没有某个模块就断定它漏了。它是讨论的画布，不是代码的镜像。',
        doc.external
            ? '- 这张图不是图库里的图，而是项目里的一个 mermaid 文件（' + doc.external + '）：用户是按路径把它打开的，你的改动落盘就写回这个文件。'
            : '- 图库跟着项目走：每个项目目录下有一个 .arch-canvas/，里面每张图一个 .mmd 文件。同一个图库可以有多张图。',
        '- 图引用一律用「相对项目根的 key」：`架构` 指根图库里的图，`支付/对账` 指子项目「支付」的图库里的图。`arch_switch` / `arch_read` / `set_link` 都用这个写法。',
        '- 用户的手动改动会立即反映到下一步的你。回答图相关内容时以下面这份为准，不要凭记忆。',
        // 没有写图闸门了：安全性由**检查点**兜底，而不是靠拦人（见 history.ts）。
        // 所以这里要写清「放手改」的边界 —— 改的是用户眼前的画布，别未经要求大改。
        '这是一张**共享画布**：你改完用户立刻看见。放手用 `arch_edit` 做增量修改（add_node / add_edge / set_label / set_link / move_node / remove_node / add_group / set_files / set_summary ...），这样用户已摆好的布局不会被清掉；只有整体重画时才用 `arch_write`。',
        '- 每次落盘都会留一份**检查点**（标明是 AI 改的还是用户改的），用户能在面板里一键退回 —— 不必因为「怕改坏」而不敢动手；但也别拿它当借口一次大改：改动越小，用户越容易看懂你做了什么。',
        '- `%%` 开头的行是元数据：`@pos` 是画布坐标、`@link` 是下钻到另一张图、`@summary` 是这张图的一句话总结，原样保留、不要当成图的内容来讨论；`@note` / `@done` / `@file` 不一样 —— 那是**用户写在元素上的东西**（注释与代码锚点），见下面的清单。`%%!` 开头的只是给人看的格式说明（已从下面这份里滤掉，文件里还在）。',
        '- 你改动过的节点会在用户画布上短暂高亮 —— 用户能直接看到你动了哪里，所以说明里点名节点 id 会很有用。',
    ];
    // 一句话总结（`%% @summary`）：这是「读这张图之前先知道它讲的是什么」的那一行，
    // 作用与 skill 的描述行一样 —— 所以放在最上面，而且不截断（它本身有 500 字上限）。
    if (doc.summary)
        head.push('**这张图讲的是**（文件里的 `%% @summary`）：' + doc.summary);
    var others = [];
    for (var i = 0; i < libraryCache.length; i++) {
        var it = libraryCache[i];
        if (it.deleted || it.key === curKey)
            continue;
        var itSum = typeof it.summary === 'string' && it.summary ? it.summary : '';
        if (itSum.length > 60)
            itSum = itSum.slice(0, 60) + '…';
        others.push('「' + it.key + '」' + (itSum ? '：' + itSum : '') + '(' + it.nodes + ' 节点' + (it.links ? '、' + it.links + ' 处下钻' : '') + ')');
    }
    if (others.length > 0) {
        head.push('- 同一图库里还有：' + others.join('、') + '。要一起看另一张就用 `arch_switch`（用户画布会跟着切），只读不改则用 `arch_read` 带 `diagram`。');
    }
    else {
        head.push('- 这个图库里目前只有这一张图。想另起一张（换个视角/换个层次）可以用 `arch_switch` 带 `create` 新建。');
    }
    head.push('- 只读当前图时用 `arch_read`。');
    // 用户注释：只有**未解决**的那些进上下文。已解决的留在文件里可追溯，但不注入 ——
    // 注释会单调累积，全都灌进来的话，AI 会开始重新讨论早就定下来的事（那是负的表达力）。
    var openNotes = [];
    for (var ni = 0; ni < doc.nodes.length; ni++) {
        var nn = doc.nodes[ni];
        if (nn.note && !nn.noteDone)
            openNotes.push(nn);
    }
    var nc = noteCounts();
    if (openNotes.length > 0) {
        head.push('', '**用户在这些元素上留了注释**（文件里写作 `%% @note`）—— 它们是待处理的疑问或要求，' +
            '逐条回应，点名节点 id；处理完提醒用户可以在检查器里标成「已解决」（标记后就不再出现在你的上下文里，但会留在文件里）。');
        for (var on = 0; on < openNotes.length && on < 20; on++) {
            var ot = String(openNotes[on].note);
            if (ot.length > 400)
                ot = ot.slice(0, 400) + '…（已截断，完整内容见文件）';
            head.push('- `' + openNotes[on].id + '`（' + String(openNotes[on].label || '') + '）：' + ot.replace(/\r?\n/g, ' / '));
        }
        if (openNotes.length > 20)
            head.push('- …还有 ' + (openNotes.length - 20) + ' 条未解决的注释，完整内容见文件。');
    }
    if (nc.done > 0) {
        head.push('- 另有 ' + nc.done + ' 条注释已被标记为已解决（文件里写作 `%% @done`）：**没有列出来，也不要据此行动**；需要看全部用 `arch_read`。');
    }
    // 代码锚点：用户给节点标的源码文件。价值在于「中文标签 ↔ 英文路径」这个映射 grep 不出来，
    // 所以能省掉一次定位；但它会腐烂 —— 失效的必须显式标出来，并且明说别照着用。
    // 状态取 doc.fileStatus 这份缓存（加载/切库、doc:get、doc:set 之后会重算）。
    var refLines = [];
    for (var ri = 0; ri < doc.nodes.length; ri++) {
        var rn = doc.nodes[ri];
        var rfs = rn.files || [];
        if (!rfs.length)
            continue;
        var rst = (doc.fileStatus && doc.fileStatus[rn.id]) || {};
        var good = [];
        var bad = [];
        for (var rj = 0; rj < rfs.length; rj++) {
            var rsc = rst[rfs[rj]];
            if (rsc === 'ok')
                good.push('`' + rfs[rj] + '`');
            else
                bad.push('`' + rfs[rj] + '`（' + (rsc === 'missing' ? '文件不在' : rsc === 'symbol-missing' ? '符号不在' : '未能校验') + '）');
        }
        refLines.push('- `' + rn.id + '`（' + String(rn.label || '') + '）：' + (good.length ? good.join('、') : '') +
            (bad.length ? (good.length ? '；' : '') + '⚠ ' + bad.join('、') : ''));
    }
    if (refLines.length > 0) {
        head.push('', '**图元素上标的代码锚点**（文件里写作 `%% @file`）：用户给的「这个节点对应哪些源码文件」，' +
            '可以先按它去读，省掉一次 grep 定位。动手前先确认文件在；标了 ⚠ 的**已经失效，不要照着用** —— ' +
            '重新定位后告诉用户锚点该改成什么。');
        for (var rk2 = 0; rk2 < refLines.length && rk2 < 20; rk2++)
            head.push(refLines[rk2]);
        if (refLines.length > 20)
            head.push('- …还有 ' + (refLines.length - 20) + ' 个节点带锚点，完整内容见文件。');
        head.push('- 锚点是**部分**节点的指路牌，不代表图与代码一致 —— 别据此认为图漏了或多了什么。');
    }
    if (doc.nodes.length === 0) {
        head.push('', '画布目前是空的。可以用 `arch_write` 画一版初稿，或用 `arch_edit` 逐块搭建。');
        return head.join('\n');
    }
    var src = serializeDoc(doc).replace(/\n+$/, '');
    // 两处「注入用的视图」与文件不再逐字相同，都是为了别把噪音灌给 AI：
    // 1. 已解决的注释（`%% @done`）—— 留在文件里可追溯，但全灌进去 AI 会重新讨论早就定下来的事；
    // 2. 头部 `%%!` 格式说明 —— 每张图逐字相同，格式上面已经讲清了，而且里面有 `<节点id>` 这类模板。
    // 所以上面明说了「另有 N 条已解决」「%%! 已滤掉」，要看原文用 arch_read。
    src = src.split('\n').filter(function (l) {
        return l.indexOf('%% @done ') !== 0 && l.slice(0, 3) !== '%%!';
    }).join('\n');
    return head.concat(['', '```mermaid', src, '```']).join('\n');
}
// ==================== 静态资源路由 ====================
// 只是「把包里的文件发给浏览器」。register 由外层在 webServer 就绪后做。
var mermaidSource = null;
var mermaidAssetUrl = null;
// mermaid 优先包内 assets/（随包分发，装机即有），退回早期手工下载的缓存。
// 两个路径都由外层递进来（真插件按 __dirname，动态形态按项目目录），这里不留本机路径。
var MERMAID_PKG_FILE = (typeof hostEnv === 'object' && hostEnv && typeof hostEnv.mermaidFile === 'string' && hostEnv.mermaidFile)
    ? hostEnv.mermaidFile
    : '';
var mermaidCandidates = [MERMAID_PKG_FILE, MERMAID_CACHE].filter(function (p) { return !!p; });
async function readFirstFile(paths) {
    for (var i = 0; i < paths.length; i++) {
        try {
            var t = await fs.resolve(paths[i]);
            var info = await fs.stat(t);
            if (!info)
                continue;
            var text = await fs.readText(t);
            if (text)
                return text;
        }
        catch (e) { /* 换下一个候选 */ }
    }
    return '';
}
// 界面脚本每次请求现读现发，所以构建完刷新页面即可。路径由外层递：真插件是 <包>/lib/ui.js，
// 动态形态是 <项目>/dist/ui.js —— 宿主逻辑不猜自己装在哪儿。
var UI_FILE = (typeof hostEnv === 'object' && hostEnv && typeof hostEnv.uiFile === 'string' && hostEnv.uiFile)
    ? hostEnv.uiFile
    : '';
var uiAssetUrl = null;
if (fs) {
    onRoute('/arch-canvas/mermaid.min.js', async function (req, res) {
        if (mermaidSource === null)
            mermaidSource = await readFirstFile(mermaidCandidates);
        if (!mermaidSource) {
            res.statusCode = 404;
            res.end('mermaid bundle not found: ' + mermaidCandidates.join(' | '));
            return;
        }
        res.setHeader('content-type', 'text/javascript; charset=utf-8');
        res.setHeader('cache-control', 'public, max-age=86400');
        res.end(mermaidSource);
    });
    mermaidAssetUrl = '/arch-canvas/mermaid.min.js';
    onRoute('/arch-canvas/ui.js', async function (req, res) {
        var body = '';
        try {
            var t = await fs.resolve(UI_FILE);
            var info = await fs.stat(t);
            body = info ? await fs.readText(t) : '';
        }
        catch (e) {
            body = '';
        }
        if (!body) {
            res.statusCode = 404;
            res.end('界面脚本不存在：' + (UI_FILE || '(hostEnv.uiFile 没给)') + '（在项目里跑 npm run build）');
            return;
        }
        res.setHeader('content-type', 'text/javascript; charset=utf-8');
        res.setHeader('cache-control', 'no-store, no-cache, must-revalidate');
        res.end(body);
    });
    uiAssetUrl = '/arch-canvas/ui.js';
}
function summaryOf() {
    return {
        ok: true,
        revision: doc.revision,
        updatedBy: doc.updatedBy,
        updatedAt: doc.updatedAt,
        file: doc.file,
        diagram: doc.name,
        // 外部文件的「引用名」就是它的路径：图库那套 key 对它不成立
        key: doc.external ? doc.external : keyOf(doc.name),
        external: doc.external || null,
        project: projectRel(),
        dir: lib.dir,
        scope: lib.scope,
        workspace: lib.workspace,
        tombstoned: doc.tombstoned,
        nodeCount: doc.nodes.length,
        edgeCount: doc.edges.length,
        groupCount: doc.groups.length,
        // 整张图的一句话总结：界面拿它作图库清单的副标题，提示词拿它当「这张图讲的是什么」那一行。
        summary: doc.summary,
        libraryRev: libraryRev,
        warnings: doc.warnings.slice(),
        notes: doc.notes.slice(),
        noteCount: noteCounts().open,
        resolvedNoteCount: noteCounts().done,
        // 代码锚点的校验结果（派生数据，不落盘）：放在 summaryOf 里，所有 RPC 一起带上 ——
        // 界面靠它标失效的引用，只有 fullOf 有的话 doc:get/doc:set 这两条主路径就收不到。
        fileStatus: doc.fileStatus || {},
        // 检查点条数：面板顶栏那个「历史 N」显示它（清单本身走 doc:history）
        historyCount: historyOf(doc.file).length,
        lastChange: lastChange,
    };
}
function fullOf() {
    var out = summaryOf();
    out.model = modelOf();
    out.mermaid = serializeDoc(doc);
    return out;
}
// 载入完成后的统一收尾：标记来源、bump、刷新清单缓存。
// 界面靠「修订号变了 + lastChange.by === 'switch'」发现图库或图换了，并重新适应视图。
async function afterSwitch() {
    loadedFor = lib.dir;
    bump('switch');
    lastChange = { by: 'switch', rev: doc.revision, nodes: [] };
    await refreshLibrary();
    await verifyFileRefs();
    logEvent('info', 'doc.switch', {
        diagram: doc.name, key: keyOf(doc.name), dir: lib.dir, scope: lib.scope,
        nodes: doc.nodes.length, edges: doc.edges.length,
    });
    return fullOf();
}
ctx.effect(function () {
    return onRpc('doc:get', async function (args) {
        await ensureLoaded(args && args.where, args && args.session);
        await verifyFileRefs();
        var out = summaryOf();
        out.model = modelOf();
        out.mermaid = serializeDoc(doc);
        doc.notes = [];
        return out;
    });
});
ctx.effect(function () {
    return onRpc('doc:rev', async function (args) {
        // 顺手按 TTL 重扫一次图库（只走目录 + 比指纹，很便宜）：别人新加的图要能自己冒出来。
        // 界面轮询这个 RPC，所以「自动扫描」在面板开着时就有人驱动；面板关着时由定时器兜住。
        await ensureLoaded(args && args.where, args && args.session);
        await refreshLibrary();
        return {
            revision: doc.revision, updatedBy: doc.updatedBy, diagram: doc.name, dir: lib.dir,
            libraryRev: libraryRev, external: doc.external || null,
        };
    });
});
ctx.effect(function () {
    return onRpc('doc:set', async function (args) {
        await ensureLoaded(args && args.where, args && args.session);
        var model = args && args.model;
        if (!model || typeof model !== 'object')
            return { ok: false, error: '需要 model' };
        var saved = snapshotModel();
        adoptModel(model);
        if (args && typeof args.note === 'string' && args.note)
            doc.notes = [args.note];
        bump('user');
        noteUserChange();
        var policy = policyOfSessionId(args && args.session);
        var saveError = await persistOrRollback(saved, 'doc:set', policy);
        await verifyFileRefs();
        var out = summaryOf();
        out.mermaid = serializeDoc(doc);
        out.model = modelOf();
        out.saved = !saveError;
        return out;
    });
});
ctx.effect(function () {
    return onRpc('doc:applyText', async function (args) {
        await ensureLoaded(args && args.where, args && args.session);
        var text = args && typeof args.text === 'string' ? args.text : '';
        var parsed = inheritPositions(parseMermaid(text));
        if (parsed.nodes.length === 0 && text.trim() !== '') {
            return { ok: false, error: '没能从这段文本里解析出任何节点', mermaid: serializeDoc(doc) };
        }
        var saved = snapshotModel();
        adopt(parsed);
        adoptModel(modelOf());
        bump('user');
        noteUserChange();
        var policy = policyOfSessionId(args && args.session);
        var saveError = await persistOrRollback(saved, 'doc:applyText', policy);
        await verifyFileRefs();
        var out = summaryOf();
        out.mermaid = serializeDoc(doc);
        out.model = modelOf();
        out.saved = !saveError;
        return out;
    });
});
ctx.effect(function () {
    return onRpc('mermaid:info', async function () {
        return { url: mermaidAssetUrl };
    });
});
ctx.effect(function () {
    return onRpc('ui:info', async function () {
        return { url: uiAssetUrl, file: UI_FILE };
    });
});
ctx.effect(function () {
    return onRpc('doc:file', async function (args) {
        await ensureLoaded(args && args.where, args && args.session);
        if (args && args.save) {
            var err = await persist(policyOfSessionId(args && args.session));
            var out = summaryOf();
            out.saved = !err;
            if (err)
                out.error = err;
            return out;
        }
        return summaryOf();
    });
});
// ---- 图库管理：清单 / 打开 / 新建 / 改名 / 软删除 / 恢复 / 按路径打开外部文件 ----
ctx.effect(function () {
    return onRpc('doc:list', async function (args) {
        await ensureLoaded(args && args.where, args && args.session);
        // rescan 为真时忽略 TTL 立刻重扫（选择器上的「重新扫描」按钮走这条路）
        var items = await refreshLibrary(!!(args && args.rescan));
        return {
            ok: true, dir: lib.dir, scope: lib.scope, workspace: lib.workspace,
            current: doc.name, external: doc.external || null,
            items: items,
            // 项目里散落的 mermaid 文件（同一次扫描的副产物）：按路径打开
            files: libraryFiles,
            libraryRev: libraryRev,
        };
    });
});
ctx.effect(function () {
    return onRpc('doc:openPath', async function (args) {
        await ensureLoaded(args && args.where, args && args.session);
        var path = resolveDiagramPath(args && args.path);
        if (!path)
            return { ok: false, error: '需要一个文件路径：绝对路径，或相对项目根的路径' };
        return openExternal(path, !!(args && args.create), policyOfSessionId(args && args.session));
    });
});
ctx.effect(function () {
    return onRpc('doc:open', async function (args) {
        await ensureLoaded(args && args.where, args && args.session);
        var raw = args && typeof args.key === 'string' ? args.key
            : (args && typeof args.name === 'string' ? args.name : '');
        if (!raw.trim())
            return { ok: false, error: '需要 key（图名，或 `子项目/图名`）' };
        var k = resolveKey(raw);
        if (!k)
            return { ok: false, error: '当前没有项目根，无法引用子项目的图' };
        // 打开子项目的图 = 把「当前层」切过去：此后坐标、落盘、AI 上下文都落在那一层
        if (k.dir !== lib.dir) {
            lib = { dir: k.dir, scope: k.scope, workspace: k.workspace };
            loadedFor = null;
        }
        var r = await loadDiagramAt(k, k.name, !!(args && args.create), policyOfSessionId(args && args.session));
        if (!r.ok) {
            await refreshLibrary();
            return { ok: false, error: r.error, items: libraryCache, dir: lib.dir };
        }
        return afterSwitch();
    });
});
ctx.effect(function () {
    return onRpc('doc:rename', async function (args) {
        await ensureLoaded(args && args.where, args && args.session);
        if (!fs)
            return { ok: false, error: 'fs 服务不可用' };
        var a = resolveKey(args && args.from);
        var b = resolveKey(args && args.to);
        if (!a || !b)
            return { ok: false, error: '需要 from 与 to（图名，或 `子项目/图名`）' };
        if (a.project !== b.project) {
            return { ok: false, error: '改名不能跨图库（' + (a.project || '根') + ' → ' + (b.project || '根') + '）；跨库请手工移动文件' };
        }
        if (a.name === b.name)
            return { ok: false, error: '新名字和旧名字一样' };
        // 目标已存在就不动 —— 改名不该悄悄吞掉另一张图
        try {
            var probe = await fs.resolve(fileAt(b.dir, b.name));
            if (await fs.stat(probe))
                return { ok: false, error: '已经有叫「' + args.to + '」的图了' };
        }
        catch (e) { }
        var text;
        try {
            text = await fs.readText(await fs.resolve(fileAt(a.dir, a.name)));
        }
        catch (e) {
            return { ok: false, error: '读不到「' + args.from + '」：' + msgOf(e) };
        }
        try {
            var renamePolicy = policyOfSessionId(args && args.session);
            await fs.writeText(await fs.resolve(fileAt(b.dir, b.name)), text, undefined, undefined, renamePolicy);
            // 旧文件只能软删（fs 没有 unlink），于是「改名」= 新建 + 把旧的标成已删除
            await fs.writeText(await fs.resolve(fileAt(a.dir, a.name)), TOMBSTONE + '\n' + text, undefined, undefined, renamePolicy);
        }
        catch (e) {
            return { ok: false, error: '改名失败：' + msgOf(e) };
        }
        if (doc.name === a.name && lib.dir === a.dir) {
            doc.name = b.name;
            doc.file = fileAt(b.dir, b.name);
            doc.tombstoned = hasTombstone(text);
        }
        await refreshLibrary();
        return fullOf();
    });
});
ctx.effect(function () {
    return onRpc('doc:delete', async function (args) {
        await ensureLoaded(args && args.where, args && args.session);
        if (!fs)
            return { ok: false, error: 'fs 服务不可用' };
        var dk = resolveKey(args && (args.key || args.name));
        if (!dk)
            return { ok: false, error: '需要 key（图名，或 `子项目/图名`）' };
        var name = dk.name;
        var text;
        try {
            text = await fs.readText(await fs.resolve(fileAt(dk.dir, dk.name)));
        }
        catch (e) {
            return { ok: false, error: '读不到「' + (args && (args.key || args.name)) + '」：' + msgOf(e) };
        }
        if (!hasTombstone(text)) {
            try {
                await fs.writeText(await fs.resolve(fileAt(dk.dir, dk.name)), TOMBSTONE + '\n' + text, undefined, undefined, policyOfSessionId(args && args.session));
            }
            catch (e) {
                return { ok: false, error: '删除失败：' + msgOf(e) };
            }
        }
        // 删的正好是当前这张 → 换回默认图，别让界面停在已删除的内容上
        if (doc.name === name && lib.dir === dk.dir) {
            doc.name = DEFAULT_DIAGRAM;
            loadedFor = null;
            await ensureLoaded(undefined, args && args.session);
            return fullOf();
        }
        await refreshLibrary();
        return fullOf();
    });
});
ctx.effect(function () {
    return onRpc('doc:restore', async function (args) {
        await ensureLoaded(args && args.where, args && args.session);
        if (!fs)
            return { ok: false, error: 'fs 服务不可用' };
        var rk = resolveKey(args && (args.key || args.name));
        if (!rk)
            return { ok: false, error: '需要 key（图名，或 `子项目/图名`）' };
        var text;
        try {
            text = await fs.readText(await fs.resolve(fileAt(rk.dir, rk.name)));
        }
        catch (e) {
            return { ok: false, error: '读不到「' + (args && (args.key || args.name)) + '」：' + msgOf(e) };
        }
        if (hasTombstone(text)) {
            try {
                await fs.writeText(await fs.resolve(fileAt(rk.dir, rk.name)), text.replace(/^\s*%%\s*@deleted[^\n]*\n?/, ''), undefined, undefined, policyOfSessionId(args && args.session));
            }
            catch (e) {
                return { ok: false, error: '恢复失败：' + msgOf(e) };
            }
        }
        await refreshLibrary();
        return { ok: true, dir: lib.dir, scope: lib.scope, workspace: lib.workspace, current: doc.name, items: libraryCache };
    });
});
// ==================== 检查点（快照）的 RPC ====================
// 这是取代「AI 写图开关」的那条安全路径：不拦 AI，但每一步都能退回去。
// 历史**只在内存里**，键是当前文件的路径 —— 所以这两条都先 ensureLoaded，拿到的是「用户正看着的这张」。
ctx.effect(function () {
    return onRpc('doc:history', async function (args) {
        await ensureLoaded(args && args.where, args && args.session);
        return { ok: true, file: doc.file, diagram: doc.name, limit: HISTORY_LIMIT, entries: historyList() };
    });
});
ctx.effect(function () {
    return onRpc('doc:rollback', async function (args) {
        await ensureLoaded(args && args.where, args && args.session);
        var seq = Number(args && args.seq);
        if (!isFinite(seq) || seq <= 0)
            return { ok: false, error: '需要 seq（检查点编号，见 doc:history）' };
        var r = await applyRollback(seq, policyOfSessionId(args && args.session));
        if (!r.ok)
            return r;
        await verifyFileRefs();
        await refreshLibrary();
        var out = fullOf();
        out.rolledBackTo = seq;
        return out;
    });
});
// ==================== 给 AI 的动态工具 ====================
var OUT_SCHEMA = { type: 'object', additionalProperties: true };
var readTool = harness.defineTool({
    name: 'arch_read',
    description: '读取一张逻辑框架图的 Mermaid 源码。默认读当前与用户共享的这张；给 diagram 可以只读同一个图库里的另一张（不会切换用户看到的图）。注意：当前这张图通常已经自动出现在你的上下文里，只有怀疑它过期、或要看别的图时才需要调用。',
    parameters: {
        type: 'object',
        properties: {
            diagram: { type: 'string', description: '要读的图名；省略则读当前这张' },
        },
    },
    output: {
        schema: OUT_SCHEMA,
        render: function (args, value) {
            try {
                var v = value || {};
                if (v.ok === false)
                    return [{ type: 'text', text: 'arch_read 失败：' + String(v.error || '') }];
                return [{ type: 'text', text: '【' + String(v.diagram || '?') + '】\n' + String(v.mermaid || '(空)') }];
            }
            catch (e) {
                return [{ type: 'text', text: '(读取失败)' }];
            }
        },
    },
    execute: async function (args, exec) {
        await ensureLoaded(whereOfExec(exec), sessionIdOfExec(exec));
        var want = args && typeof args.diagram === 'string' ? args.diagram.trim() : '';
        var wantParts = want ? splitKey(want) : null;
        var wantKey = wantParts ? keyOf(wantParts.name, wantParts.project) : '';
        if (want && wantKey !== keyOf(doc.name)) {
            // 只读不切：读盘、解析、序列化后原样返回，一点不碰当前文档 ——
            // 用户正看着 A，AI 不该因为「读了一眼 B」就把画面切走。
            var rk = resolveKey(want);
            if (!rk)
                return { ok: false, error: '当前没有项目根，无法引用子项目的图', diagram: doc.name };
            var text = '';
            try {
                text = await fs.readText(await fs.resolve(fileAt(rk.dir, rk.name)));
            }
            catch (e) {
                return { ok: false, error: '读不到「' + want + '」：' + msgOf(e), diagram: doc.name };
            }
            var parsed = parseMermaid(text);
            return {
                ok: true, diagram: rk.name, key: wantKey, dir: rk.dir, scope: rk.scope,
                nodeCount: parsed.nodes.length, edgeCount: parsed.edges.length,
                mermaid: serializeDoc(parsed),
            };
        }
        await verifyFileRefs();
        var out = summaryOf();
        out.mermaid = serializeDoc(doc);
        return out;
    },
});
onTool(readTool);
var switchTool = harness.defineTool({
    name: 'arch_switch',
    description: '切换用户正在看的逻辑框架图（同一个图库里的另一张），用户的画布会跟着切过去。要新建一张就带 create: true。这会改变用户眼前的画面，所以除非确实要一起看另一张，否则只用 arch_read 读。',
    parameters: {
        type: 'object',
        properties: {
            key: { type: 'string', description: '图的引用名：根图库写图名，子项目写 `子项目/图名`（不含 .mmd）' },
            create: { type: 'boolean', description: '图不存在时是否新建；默认 false，不存在会报错并列出可选图名' },
        },
        required: ['key'],
    },
    output: {
        schema: OUT_SCHEMA,
        render: function (args, value) {
            try {
                var v = value || {};
                if (!v.ok)
                    return [{ type: 'text', text: 'arch_switch 未生效：' + String(v.error || '') }];
                return [{ type: 'text', text: '已切到「' + v.diagram + '」（' + v.nodeCount + ' 个节点、' + v.edgeCount + ' 条连线）。用户画布已同步。' }];
            }
            catch (e) {
                return [{ type: 'text', text: 'arch_switch 已完成' }];
            }
        },
    },
    execute: async function (args, exec) {
        await ensureLoaded(whereOfExec(exec), sessionIdOfExec(exec));
        var raw = args && typeof args.key === 'string' ? args.key
            : (args && typeof args.name === 'string' ? args.name : '');
        if (!raw.trim())
            return { ok: false, error: '需要 key' };
        var k = resolveKey(raw);
        if (!k)
            return { ok: false, error: '当前没有项目根，无法引用子项目的图' };
        if (k.dir !== lib.dir) {
            lib = { dir: k.dir, scope: k.scope, workspace: k.workspace };
            loadedFor = null;
        }
        var r = await loadDiagramAt(k, k.name, !!(args && args.create), policyOfAgent(exec && exec.agent));
        if (!r.ok) {
            var items = await refreshLibrary();
            var names = items.filter(function (x) { return !x.deleted; }).map(function (x) { return x.key; });
            return {
                ok: false,
                error: r.error + '。可用的图有：' + (names.length ? names.join('、') : '(还没有别的图)') + '；要新建请带 create: true',
            };
        }
        return afterSwitch();
    },
});
onTool(switchTool);
var writeTool = harness.defineTool({
    name: 'arch_write',
    description: '用一份完整的 Mermaid flowchart 源码整体替换当前这张逻辑框架图。适合画初稿或结构性重画。只改局部时请改用 `arch_edit`：arch_write 会丢掉未被重新声明节点的画布坐标，用户手动摆好的布局会散掉。',
    parameters: {
        type: 'object',
        properties: {
            mermaid: { type: 'string', description: '完整的 Mermaid flowchart 源码。用 flowchart TD 或 flowchart LR 开头，例如：flowchart TD\\n  a["入口"] --> b["核心"]。可以在头部写一行 `%% @summary <一句话>` 说明这张图讲的是什么；不写就沿用原来那句。' },
            note: { type: 'string', description: '给用户看的一句话说明，会显示在画布状态栏' },
        },
        required: ['mermaid'],
    },
    output: {
        schema: OUT_SCHEMA,
        render: function (args, value) {
            try {
                var v = value || {};
                if (!v.ok)
                    return [{ type: 'text', text: 'arch_write 未生效: ' + String(v.error || v.problems || '') }];
                var kept = v.keptNotes ? '（保留了用户在该图元素上的 ' + v.keptNotes + ' 条注释）' : '';
                return [{ type: 'text', text: '已更新「' + String(v.diagram || '') + '」（修订 ' + v.revision + '）：' + v.nodeCount + ' 个节点、' + v.edgeCount + ' 条连线。用户现在看到的图形已同步。' + kept }];
            }
            catch (e) {
                return [{ type: 'text', text: 'arch_write 已完成' }];
            }
        },
    },
    execute: async function (args, exec) {
        var t0 = Date.now();
        await ensureLoaded(whereOfExec(exec), sessionIdOfExec(exec));
        if (doc.absent && !doc.external) {
            logEvent('warn', 'doc.absent', { tool: 'arch_write', dir: lib.dir });
            return { ok: false, error: '这个项目还没有图库（' + lib.dir + ' 还不存在）。图库不会自动创建——要建先征得用户同意，再用 arch_switch { create: true } 建一张。' };
        }
        var text = args && typeof args.mermaid === 'string' ? args.mermaid : '';
        if (!text.trim())
            return toolReject('arch_write', 'mermaid 不能为空', t0);
        var parsed = inheritPositions(parseMermaid(text));
        // 用户留的东西（注释 + 代码锚点）是**用户**的：AI 整体重画时继承下来，别让它悄悄抹掉。
        // doc:applyText（用户自己改源码）刻意不走这条 —— 那边删掉一行就是真的要删（见 inheritUserMarks）。
        var keptNotes = inheritUserMarks(parsed);
        if (parsed.nodes.length === 0) {
            return toolReject('arch_write', '解析不出任何节点（首行应是 flowchart TD 或 graph LR）', t0);
        }
        var before = snapshotNodes();
        var saved = snapshotModel();
        adopt(parsed);
        adoptModel(modelOf());
        bump('ai');
        noteAiChange(before);
        if (args && typeof args.note === 'string' && args.note)
            doc.notes = [args.note];
        var policy = policyOfAgent(exec && exec.agent);
        var saveError = await persistOrRollback(saved, 'arch_write', policy);
        var out = summaryOf();
        out.mermaid = serializeDoc(doc);
        out.keptNotes = keptNotes;
        // 写盘失败时内存已经回滚了 —— 那就**不能说「已更新」**：回执必须让 AI 知道自己白改了。
        // （历史里也不会多一份检查点：那一版从来没落到盘上，见 history.ts。）
        out.saved = !saveError;
        if (saveError) {
            out.ok = false;
            out.error = '保存失败，本次改动已回滚：' + saveError;
        }
        logEvent(saveError ? 'error' : 'info', 'tool.arch_write', {
            diagram: doc.name, key: keyOf(doc.name), file: doc.file,
            nodes: doc.nodes.length, edges: doc.edges.length, revision: doc.revision,
            keptNotes: keptNotes,
            saved: !saveError, rollback: !!saveError, warnings: (parsed.warnings || []).slice(0, 5), ms: Date.now() - t0,
        });
        return out;
    },
});
onTool(writeTool);
var editTool = harness.defineTool({
    name: 'arch_edit',
    description: '对当前这张逻辑框架图做增量修改（推荐方式）。一次传多个 op，按顺序执行，只影响你指定的部分，用户已经拖好的节点位置完全不受影响。若 op 里出现尚未存在的节点 id，会返回 problems 告诉你原因。',
    parameters: {
        type: 'object',
        properties: {
            ops: {
                type: 'array',
                description: '要执行的操作列表，按顺序应用',
                items: {
                    type: 'object',
                    additionalProperties: true,
                    properties: {
                        op: {
                            type: 'string',
                            enum: ['add_node', 'set_label', 'set_shape', 'set_link', 'move_node', 'remove_node', 'add_edge', 'remove_edge', 'set_edge_label', 'add_group', 'set_group', 'remove_group', 'set_direction', 'set_files', 'set_summary'],
                            description: '操作类型',
                        },
                        id: { type: 'string', description: '节点 id（add_node/set_label/set_shape/set_link/move_node/remove_node/set_group 用）' },
                        label: { type: 'string', description: '节点或连线的显示文本；add_group 时作为分组标题；set_summary 时是这张图的一句话总结（传空串清掉）' },
                        shape: { type: 'string', description: '节点形状：rect 矩形 / round 圆角 / stadium 胶囊 / circle 圆 / diamond 判定 / cyl 数据库 / hex 六边形 / sub 子流程 / asym 旗形' },
                        link: { type: 'string', description: 'set_link / add_node 用：把这个节点下钻到另一张图（图名，不含 .mmd）；传空串取消' },
                        from: { type: 'string', description: '连线的起点节点 id' },
                        to: { type: 'string', description: '连线的终点节点 id' },
                        group: { type: 'string', description: '分组 id；set_group 时传空串表示移出分组' },
                        arrow: { type: 'string', description: '连线样式：--> 实线箭头 / --- 无箭头 / -.-> 虚线 / ==> 粗线' },
                        x: { type: 'number', description: '画布横坐标（move_node / add_node 用）' },
                        y: { type: 'number', description: '画布纵坐标（move_node / add_node 用）' },
                        value: { type: 'string', description: 'set_direction 时用：TD / BT / LR / RL' },
                        files: {
                            type: 'array',
                            items: { type: 'string' },
                            description: 'set_files 用：这个节点对应的源码文件（项目相对路径，可带 `#符号` 指到具体函数/类）。整组替换；传空数组表示清掉',
                        },
                    },
                    required: ['op'],
                },
            },
            note: { type: 'string', description: '给用户看的一句话说明' },
        },
        required: ['ops'],
    },
    output: {
        schema: OUT_SCHEMA,
        render: function (args, value) {
            try {
                var v = value || {};
                var lines = ['已应用 ' + v.appliedCount + ' 个操作，当前「' + String(v.diagram || '') + '」有 ' + v.nodeCount + ' 个节点、' + v.edgeCount + ' 条连线（修订 ' + v.revision + '）。'];
                if (v.done && v.done.length)
                    lines.push('完成：' + v.done.join('；'));
                if (v.problems && v.problems.length)
                    lines.push('未生效：' + v.problems.join('；'));
                if (v.appliedCount > 0)
                    lines.push('（改动过的节点已在用户画布上高亮）');
                return [{ type: 'text', text: lines.join('\n') }];
            }
            catch (e) {
                return [{ type: 'text', text: 'arch_edit 已完成' }];
            }
        },
    },
    execute: async function (args, exec) {
        var t0 = Date.now();
        await ensureLoaded(whereOfExec(exec), sessionIdOfExec(exec));
        if (doc.absent && !doc.external) {
            logEvent('warn', 'doc.absent', { tool: 'arch_edit', dir: lib.dir });
            return { ok: false, error: '这个项目还没有图库（' + lib.dir + ' 还不存在）。图库不会自动创建——要建先征得用户同意，再用 arch_switch { create: true } 建一张。' };
        }
        var ops = args && Array.isArray(args.ops) ? args.ops : [];
        if (ops.length === 0)
            return toolReject('arch_edit', 'ops 不能为空', t0);
        var before = snapshotNodes();
        var saved = snapshotModel();
        var result = applyOps(ops);
        if (args && typeof args.note === 'string' && args.note)
            doc.notes = [args.note];
        bump('ai');
        noteAiChange(before);
        var policy = policyOfAgent(exec && exec.agent);
        var saveError = await persistOrRollback(saved, 'arch_edit', policy);
        // 改完锚点要立刻重算校验状态：`summaryOf()` 会把 doc.fileStatus 一起带回去，
        // 少了这一行，AI 下一步读到的还是**旧锚点字符串**对应的那份缓存 ——
        // 新锚点在缓存里没有条目，于是全部显示「未能校验」，而界面走 doc:get 重算后是 ok。
        // 同一个锚点在人和 AI 两边显示成两种状态，是最难查的那种不一致。
        await verifyFileRefs();
        var out = summaryOf();
        out.mermaid = serializeDoc(doc);
        out.appliedCount = result.done.length;
        out.done = result.done;
        out.problems = result.problems;
        // 同上：落盘失败 ⇒ ok:false，并把原因塞进 problems（AI 先看 problems 再汇报）。
        out.saved = !saveError;
        if (saveError) {
            out.ok = false;
            out.error = '保存失败，本次改动已回滚：' + saveError;
            out.problems = result.problems.concat(['保存失败，本次改动已回滚：' + saveError]);
        }
        // AI 每次改图留一行：改的是哪张图、几个 op 没生效、有没有回滚 —— 图不对时先看这里。
        logEvent(saveError || result.problems.length ? 'warn' : 'info', 'tool.arch_edit', {
            diagram: doc.name, key: keyOf(doc.name), file: doc.file,
            ops: ops.length, applied: result.done.length, problems: result.problems.slice(0, 5),
            revision: doc.revision, saved: !saveError, rollback: !!saveError, ms: Date.now() - t0,
        });
        return out;
    },
});
onTool(editTool);
// ==================== 每步注入给模型的上下文 ====================
if (systemPromptSvc) {
    try {
        ctx.effect(function () {
            return systemPromptSvc.context({ name: 'arch-canvas', order: 137, text: promptText });
        });
    }
    catch (e) {
        doc.warnings.push('注册提示词上下文失败: ' + msgOf(e));
        logEvent('error', 'prompt.fail', { error: msgOf(e) });
    }
}
// 挂载现场：这个插件对 console 一字不吐，「挂上了没」以前只能靠人去数注册结果，
// 现在落一行到日志文件里，顺带留下日志目录与形态。
//
// **同进程内同内容只落一行**（0.9.x，治噪音）：hmr 每次构建都会把这份模块重新求值一遍，
// 实测同一次事件里 26 毫秒内连发 4 行、单日 46 行、**逐字节相同**（只有 t 不同）。那种重复
// 对「挂上了没」这个问题没有任何新信息，只会把日志撑成噪音。
// 判据用 `globalThis` 上的一个标记，而**不是**模块级变量：模块被清缓存重载后模块级变量会归零，
// 那正是 4 连发的成因之一。挂载形状（工具/路由/图库/形态）一变，判据就变，于是照旧落一行。
var MOUNT_MARK_KEY = '__archCanvasMountMark';
var mountShape = registeredTools.join(',') + '|' + registeredRoutes.join(',') + '|' + lib.dir + '|' + lib.scope;
var mountMark = null;
try {
    mountMark = globalThis[MOUNT_MARK_KEY] || null;
}
catch (e) {
    mountMark = null;
}
if (!mountMark || mountMark.shape !== mountShape) {
    logEvent('info', 'plugin.mount', {
        tools: registeredTools.join(','), toolCount: registeredTools.length,
        routes: registeredRoutes.join(','), routeCount: registeredRoutes.length,
        dir: lib.dir, scope: lib.scope, logDir: logDir(), logBackend: logBackend ? 'file' : 'none',
        mounts: (mountMark && mountMark.shape === mountShape && mountMark.n ? mountMark.n : 0) + 1,
    });
    try {
        globalThis[MOUNT_MARK_KEY] = { shape: mountShape, n: 1 };
    }
    catch (e) { /* 标记写不进去只是少一条去重，不影响挂载 */ }
}
else {
    mountMark.n = (mountMark.n || 1) + 1;
}
// ==================== 自动扫描：周期重扫图库 ====================
// 面板开着时是 doc:rev 的轮询在驱动重扫；面板关掉后没人驱动了，所以再挂一个慢速定时器 ——
// 别人（git pull、手写、另一个会话）新加的图与散落文件照样会被发现，AI 的上下文也跟着新鲜。
// timer 是可选服务：缺席时插件照常工作，自动扫描退化成「界面在轮询时才扫」。
ctx.inject(['timer'], function (timerCtx) {
    timerCtx.effect(function () {
        return timerCtx.interval(function () {
            // 强制扫：TTL 是给「2.5s 一次的高频轮询」节流的；这个慢速定时器是「没人看的时候」的
            // 兜底扫描器，被 TTL 挡住就等于自动扫描失效。
            refreshLibrary(true).catch(function (e) {
                logEvent('error', 'library.scan.fail', { error: msgOf(e) });
            });
        }, SCAN_INTERVAL_MS);
    });
});
void ensureLoaded();

  },
}

}
