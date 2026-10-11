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
const api = new Function(src + '\n;return { parseMermaid: parseMermaid, serializeDoc: serializeDoc, roundTripDiff: roundTripDiff, roundTripDetail: roundTripDetail, cleanId: cleanId, q: q, unquote: unquote, qRef: qRef, unquoteRef: unquoteRef, ARROWS: ARROWS, MERMAID_KEYWORD_LIST: MERMAID_KEYWORD_LIST, stableJson: stableJson };')();
const parseMermaid = api.parseMermaid;
const serializeDoc = api.serializeDoc;
const roundTripDiff = api.roundTripDiff;
const ARROWS = api.ARROWS;
const MERMAID_KEYWORD_LIST = api.MERMAID_KEYWORD_LIST;
const stableJson = api.stableJson;
// 元数据值的编解码对：qRef/unquoteRef 是 `%% @file` 的，q/unquote 是标签的。
const cleanId = api.cleanId;
const q = api.q;
const unquote = api.unquote;
const qRef = api.qRef;
const unquoteRef = api.unquoteRef;

/** 两份文本第一个不同的位置（往返不一致时给日志指路，别只说「不一样」）。 */
function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

// serializeDoc 每次重写的那行横幅。它自己也说「`%%!` 开头的是格式说明」，
// 所以解析时按说明行跳过（见 mermaid.ts 的 HEADER_BANNER）—— 这里用它拼「老文件」样本。
const HEADER_LINE_FOR_TEST = '%% arch-canvas —— 由「架构画布」面板与 AI 共同维护（`%%!` 开头的是格式说明，不是图的内容）';

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// ---------- 共享出口：给两个分片共用（一个事实一个家） ----------
// 分片只 require 这一个文件：解析器 API、断言计数器与汇总出口都在这里，不在各分片里各抄一份。
function endPhase() {
  console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败\n');
  process.exit(fail === 0 ? 0 : 1);
}
module.exports = {
  fs, path,
  parseMermaid, serializeDoc, roundTripDiff, cleanId, q, unquote, qRef, unquoteRef,
  ARROWS, MERMAID_KEYWORD_LIST, stableJson, firstDiff, HEADER_LINE_FOR_TEST, check, eq, endPhase,
};
