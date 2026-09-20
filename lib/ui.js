// arch-canvas 浏览器界面 —— 由 host 从 <项目>/dist/ui.js 现读现发。
// 依赖由 Package 的引导层经 globalThis.__archCanvasDeps 递进来（<script> 标签没法传参）。
(function () {
var __deps = globalThis.__archCanvasDeps || {}
var React = __deps.React
var host = __deps.host
var styles = __deps.styles
var __rpc = __deps.rpc
"use strict";
// 浏览器侧基础设施：样式、mermaid 运行时加载、几何与自动布局、图标。
// 这一半的沙箱里 React / host / styles / ctx 都是闭包参数，不是全局。
// ==================== 样式（为窄侧栏设计） ====================
var STUDIO_CSS = [
    '.ac-root{height:100%;min-height:200px;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base,#14161a);color:var(--dsw-alias-label-primary,#e8eaed);font:13px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;overflow:hidden}',
    '.ac-bar{display:flex;align-items:center;gap:6px;padding:7px 8px 6px;flex:0 0 auto;flex-wrap:wrap}',
    '.ac-title{font-weight:600;font-size:12.5px;white-space:nowrap;color:var(--dsw-alias-label-primary,#e8eaed)}',
    '.ac-tabs{display:flex;gap:2px;background:var(--dsw-alias-bg-layer-1,#1b1e23);border:1px solid var(--dsw-alias-border-l1,#2a2e35);border-radius:8px;padding:2px}',
    '.ac-tab{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary,#9aa3af);border-radius:6px;padding:3px 8px;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}',
    '.ac-tab:hover{color:var(--dsw-alias-label-primary,#e8eaed)}',
    '.ac-tab.on{background:var(--dsw-alias-bg-layer-2,#232830);color:var(--dsw-alias-label-primary,#e8eaed)}',
    '.ac-tab[disabled]{opacity:.35;cursor:not-allowed}',
    // AI 刚改过的地方：描边转金 + 一圈脉动环（环动画自带 forwards，跑完自己隐形）
    '.ac-node.hl .ac-shape{stroke:#f0b429;stroke-width:3}',
    // 这个类从前叫 .ac-hl，而源码页的**代码高亮层**也叫 .ac-hl —— 于是上面那条
    // `animation:acPulse ... forwards`（终点 opacity:0）被一起焊到了代码 <pre> 上：
    // 进源码页 2.6 秒后整层淡成透明，读起来就是「文本逐渐变白」。
    // 两个东西一个管 SVG 描边、一个管 DOM 盒子，别再共用一个类名。
    '.ac-pulse{fill:none;stroke:#f0b429;stroke-width:3;animation:acPulse 2.6s ease-out forwards}',
    '@keyframes acPulse{0%{opacity:.9}60%{opacity:.45}100%{opacity:0}}',
    '.ac-tools{display:flex;gap:4px;flex-wrap:wrap;padding:0 8px 7px;flex:0 0 auto}',
    '.ac-btn{appearance:none;border:1px solid var(--dsw-alias-border-l2,#3a4048);background:var(--dsw-alias-bg-layer-1,#1b1e23);color:inherit;border-radius:7px;padding:3px 8px;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}',
    '.ac-btn:hover{border-color:var(--dsw-alias-brand-primary,#4c8dff)}',
    '.ac-btn.primary{background:var(--dsw-alias-brand-primary,#4c8dff);border-color:var(--dsw-alias-brand-primary,#4c8dff);color:#fff}',
    '.ac-btn.danger:hover{border-color:var(--dsw-alias-state-error-primary,#ff5f56);color:var(--dsw-alias-state-error-primary,#ff5f56)}',
    '.ac-btn[disabled]{opacity:.45;cursor:not-allowed}',
    '.ac-body{flex:1 1 auto;min-height:0;display:flex;flex-direction:column}',
    '.ac-stage{flex:1 1 auto;min-height:140px;position:relative;overflow:hidden}',
    '.ac-svg{width:100%;height:100%;display:block;touch-action:none;cursor:grab;background:radial-gradient(circle at 1px 1px,var(--dsw-alias-border-l1,#2a2e35) 1px,transparent 0) 0 0/22px 22px}',
    '.ac-node{cursor:pointer}',
    '.ac-node .ac-shape{fill:var(--dsw-alias-bg-layer-2,#232830);stroke:var(--dsw-alias-border-l2,#3a4048);stroke-width:1.5}',
    '.ac-node.sel .ac-shape{stroke:var(--dsw-alias-brand-primary,#4c8dff);stroke-width:2.5}',
    // 节点卡片：第一段是标题（.ac-lbl —— 保持既有契约，它的 textContent 就是标题本身），
    // 其余段是描述（.ac-desc）；「意图：」「原理：」是**惯例**不是框架硬约束，写了才分层着色。
    '.ac-node .ac-lbl{fill:var(--dsw-alias-label-primary,#e8eaed);font-size:13px;font-weight:600;text-anchor:middle;dominant-baseline:central;pointer-events:none;user-select:none}',
    '.ac-node .ac-desc{fill:var(--dsw-alias-label-secondary,#9aa3af);font-size:11.5px;text-anchor:middle;dominant-baseline:central;pointer-events:none;user-select:none}',
    '.ac-node .ac-desc .ac-intent{fill:#7cc4ff}',
    '.ac-node .ac-desc .ac-rationale{fill:#b39ddb}',
    '.ac-node .ac-ref{fill:var(--dsw-alias-label-secondary,#9aa3af);font-size:10px;text-anchor:middle;dominant-baseline:central;pointer-events:none;user-select:none;opacity:.8}',
    '.ac-edge{fill:none;stroke:var(--dsw-alias-border-l2,#3a4048);stroke-width:1.6}',
    '.ac-edge.dashed{stroke-dasharray:6 5}',
    '.ac-edge.sel{stroke:var(--dsw-alias-brand-primary,#4c8dff);stroke-width:2.6}',
    '.ac-edge-hit{fill:none;stroke:transparent;stroke-width:14;cursor:pointer}',
    '.ac-arrowhead{fill:var(--dsw-alias-border-l2,#3a4048)}',
    '.ac-elbl{fill:var(--dsw-alias-label-secondary,#9aa3af);font-size:11.5px;text-anchor:middle;dominant-baseline:central;pointer-events:none;user-select:none}',
    '.ac-elbl-bg{fill:var(--dsw-alias-bg-base,#14161a)}',
    '.ac-group-box{fill:var(--dsw-alias-bg-layer-1,#1b1e23);fill-opacity:.5;stroke:var(--dsw-alias-border-l1,#2a2e35);stroke-dasharray:5 5;stroke-width:1.2}',
    '.ac-group-lbl{fill:var(--dsw-alias-label-secondary,#9aa3af);font-size:11.5px;font-weight:600;cursor:pointer}',
    // 折叠块：被收起来的组（视图状态，不落盘）。点一下展开 —— 与「点节点展开描述」同一个心智模型。
    // 块本体**可拖**（拖的是组内所有人），但不可点开 —— 展开只认右边那个按钮。
    // 所以光标是 move 而不是 pointer：给的是「能搬动它」的暗示，不是「点了会发生什么」。
    '.ac-fold{cursor:move}',
    '.ac-fold-box{fill:var(--dsw-alias-bg-layer-2,#232830);stroke:var(--dsw-alias-brand-primary,#4c8dff);stroke-width:1.5}',
    '.ac-fold-lbl{fill:var(--dsw-alias-label-primary,#e8eaed);font-size:12.5px;text-anchor:middle;dominant-baseline:central;pointer-events:none;user-select:none}',
    '.ac-fold-btn,.ac-group-btn{cursor:pointer}',
    // 底色写死品牌蓝，**不要**用 --dsw-alias-brand-primary：那个变量在浅色主题下是近黑的
    // （neutral-bluish-1000），实心圆 + 白字就成了一坨黑块；深色主题下它又近乎纯白，白字看不见。
    // 它适合做描边/文字色，不适合做「填充底 + 白字」。AC 里其他角标（留言 ✎ / 锚点 ▤ / 下钻 ↗）
    // 用的也都是写死的语义色 —— 按钮跟着它们走，别自成一套。
    '.ac-fold-btn circle,.ac-group-btn circle{fill:#4c8dff;stroke:var(--dsw-alias-bg-base,#14161a);stroke-width:1.5}',
    '.ac-fold-btn text,.ac-group-btn text{fill:#fff;font-size:10px;text-anchor:middle;pointer-events:none;user-select:none}',
    '.ac-handle{fill:var(--dsw-alias-brand-primary,#4c8dff);stroke:var(--dsw-alias-bg-base,#14161a);stroke-width:2;cursor:crosshair}',
    '.ac-link-preview{stroke:var(--dsw-alias-brand-primary,#4c8dff);stroke-width:2;stroke-dasharray:5 4;fill:none}',
    // 拖拽吸附的参考线：拖拽时才出现，松手即消失（不进模型、不进文件、也不导出）。
    '.ac-snapline{stroke:var(--dsw-alias-brand-primary,#4c8dff);stroke-width:1;stroke-dasharray:4 4;pointer-events:none;opacity:.9}',
    // 选中后才出现的底部检查器（窄栏放不下右侧栏，改成下挂）
    '.ac-dock{flex:0 0 auto;max-height:46%;overflow:auto;border-top:1px solid var(--dsw-alias-border-l1,#2a2e35);background:var(--dsw-alias-bg-layer-1,#1b1e23);padding:9px 10px}',
    '.ac-dock h4{margin:0 0 8px;font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:var(--dsw-alias-label-secondary,#9aa3af)}',
    '.ac-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}',
    '.ac-grid .full{grid-column:1 / -1}',
    '.ac-field label{display:block;font-size:11px;color:var(--dsw-alias-label-secondary,#9aa3af);margin-bottom:3px}',
    '.ac-input,.ac-area,.ac-select{width:100%;box-sizing:border-box;background:var(--dsw-alias-bg-base,#14161a);color:inherit;border:1px solid var(--dsw-alias-border-l2,#3a4048);border-radius:7px;padding:5px 7px;font:inherit;font-size:12.5px}',
    '.ac-readonly{opacity:.65}',
    '.ac-area{height:100%;min-height:120px;resize:none;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;line-height:1.55;white-space:pre;overflow:auto}',
    // 源码高亮：底层 <pre> 画彩色 token 并**撑出整段源码的高度**，顶层 textarea 把文字设成透明
    // （只留光标与选区）用绝对定位铺满它。两层**都不滚动**，滚动交给 .ac-textwrap 这一个口。
    //
    // 从前两层各自 overflow:auto、靠 textarea 的 onScroll 同步 —— 那是两个滚动口互相同步，
    // 滚轮落在哪一层、哪一层先到底都会错位；而它们的文字一层可见一层透明，
    // 错位看起来就是「一片空白 / 文字在变白」。现在 textarea 没有可滚动的溢出（高度跟着 <pre> 走），
    // 也就**无从错位**：光标永远落在它自己那一格上。
    //
    // 两层的 font / padding / border / white-space / tab-size 必须逐项一致，差一点光标就与文字错位。
    '.ac-editwrap{position:relative;flex:0 0 auto;min-height:120px;display:block}',
    '.ac-hl{position:relative;margin:0;box-sizing:border-box;border:1px solid transparent;border-radius:7px;padding:5px 7px;pointer-events:none;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;line-height:1.55;white-space:pre;tab-size:2}',
    '.ac-area-hl{position:absolute;top:0;left:0;right:0;bottom:0;height:auto;min-height:0;z-index:1;background:transparent;color:transparent;caret-color:var(--dsw-alias-label-primary,#e8eaed);resize:none;overflow:hidden;tab-size:2}',
    '.ac-area-hl::selection{background:rgba(76,141,255,.35)}',
    '.ac-hl-c{color:#6a737d}',
    '.ac-hl-m{color:#c08b5c}',
    '.ac-hl-u{color:#e8a33d}',
    '.ac-hl-k{color:#7cc4ff}',
    '.ac-hl-s{color:#a5d6a7}',
    '.ac-hl-a{color:#ff9e64}',
    '.ac-hl-p{color:#8b949e}',
    '.ac-hl-i{color:#e8eaed}',
    // 源码页整个是一个滚动口。flex-basis 用 0（`flex:1 1 0`）而不是 auto：用 auto 时基准尺寸
    // 取的是内容高度，外层高度链一旦有哪一处不定，这个盒子就跟着内容一起长高、永远「没有溢出」。
    // （源码页滚轮不动的**真凶**不在这里 —— 是画布页的滚轮缩放监听器泄漏到了这个节点上，
    //  见 studio.ts 里那条 `if (tab !== 'canvas') return`。这里只是把它做成一个规矩的滚动口。）
    '.ac-textwrap{flex:1 1 0;min-height:0;display:flex;flex-direction:column;padding:8px;gap:7px;overflow:auto}',
    '.ac-textwrap > *{flex:0 0 auto}',
    // 解析警告区：宿主一直在发 warnings，界面从前一条都不显示。折叠不成，直接列出来。
    '.ac-warn{flex:0 0 auto;max-height:32%;overflow:auto;padding:7px 9px;border:1px solid #e8a33d;border-radius:8px;background:rgba(232,163,61,.07)}',
    '.ac-warn-h{color:#e8a33d;font-size:11.5px;font-weight:600;margin-bottom:4px}',
    '.ac-warn-i{color:var(--dsw-alias-label-secondary,#9aa3af);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:1.6;word-break:break-all}',
    '.ac-previewwrap{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;overflow:hidden}',
    '.ac-preview{flex:1 1 auto;min-height:0;overflow:auto;padding:12px;background:#fff;color:#111}',
    '.ac-preview svg{max-width:100%;height:auto}',
    '.ac-err{margin:8px;padding:8px 10px;border:1px solid var(--dsw-alias-state-error-primary,#ff5f56);border-radius:8px;color:var(--dsw-alias-state-error-primary,#ff5f56);font-family:ui-monospace,Menlo,monospace;font-size:11.5px;white-space:pre-wrap;max-height:36%;overflow:auto}',
    '.ac-hint{color:var(--dsw-alias-label-secondary,#9aa3af);font-size:11.5px;line-height:1.65}',
    // 图库选择器：列图 / 切图 / 新建（人这一侧换图的入口）
    '.ac-lib{flex:0 0 auto;max-height:52%;overflow:auto;display:flex;flex-direction:column;gap:6px;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1,#2a2e35);background:var(--dsw-alias-bg-layer-1,#1b1e23)}',
    '.ac-lib-head{display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--dsw-alias-label-secondary,#9aa3af)}',
    '.ac-lib-head .grow{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.ac-lib-item{text-align:left;background:transparent;border:1px solid transparent;border-radius:7px;color:inherit;font:inherit;font-size:12.5px;padding:5px 8px;cursor:pointer}',
    '.ac-lib-item:hover{background:var(--dsw-alias-bg-layer-2,#232830)}',
    '.ac-lib-item.on{border-color:var(--dsw-alias-brand-primary,#4c8dff);color:var(--dsw-alias-brand-primary,#4c8dff)}',
    '.ac-lib-new{display:flex;gap:6px;align-items:center}',
    '.ac-lib-new .ac-btn{flex:0 0 auto}',
    // 「按路径打开」是另一件事，别和「新建图」共用类名
    '.ac-lib-open{display:flex;gap:6px;align-items:center}',
    '.ac-lib-open .ac-input{flex:1 1 auto}',
    '.ac-lib-open .ac-btn{flex:0 0 auto}',
    '.ac-lib-row{display:flex;gap:6px;align-items:center}',
    '.ac-lib-row .ac-lib-item{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.ac-lib-row .ac-input{flex:1 1 auto}',
    '.ac-lib-deleted{display:flex;flex-direction:column;gap:6px;margin-top:4px;padding-top:6px;border-top:1px dashed var(--dsw-alias-border-l1,#2a2e35)}',
    '.ac-lib-gone{flex:1 1 auto;font-size:12px;color:var(--dsw-alias-label-secondary,#9aa3af);text-decoration:line-through}',
    '.ac-lib-file{flex:1 1 auto;min-width:0;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    // 空画布上的起始页：动作按钮 + 项目里已有的图/文件（浮在画布上，可点可滚）
    '.ac-start{position:absolute;inset:0;display:flex;flex-direction:column;gap:10px;align-items:stretch;justify-content:center;padding:14px 12px;overflow:auto;text-align:center}',
    '.ac-start-title{font-size:13px;color:var(--dsw-alias-label-primary,#e8eaed)}',
    '.ac-start-actions{display:flex;flex-wrap:wrap;gap:6px;justify-content:center}',
    '.ac-start-list{display:flex;flex-direction:column;gap:4px;text-align:left;border-top:1px dashed var(--dsw-alias-border-l1,#2a2e35);padding-top:7px}',
    '.ac-start-head{font-size:11px;color:var(--dsw-alias-label-secondary,#9aa3af)}',
    '.ac-start-row{display:flex;gap:6px;align-items:center}',
    '.ac-start-key{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}',
    '.ac-start-meta{flex:0 0 auto;font-size:11px;color:var(--dsw-alias-label-secondary,#9aa3af)}',
    // 一句话总结（%% @summary）：清单里回答「这张图是干嘛的」，长了就截断，全文在 title 里
    '.ac-start-sum{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--dsw-alias-label-secondary,#9aa3af);opacity:.85}',
    // 节点上的下钻角标
    '.ac-jump{cursor:pointer}',
    '.ac-jump circle{fill:var(--dsw-alias-brand-primary,#4c8dff);stroke:var(--dsw-alias-bg-base,#14161a);stroke-width:1.5}',
    '.ac-jump text{fill:#fff;font-size:11px;text-anchor:middle;pointer-events:none;user-select:none}',
    // 节点上的留言角标：未解决=琥珀色笔，已解决=灰底勾（与留言清单里的两区一致）
    '.ac-note-badge circle{fill:#e8a33d;stroke:var(--dsw-alias-bg-base,#14161a);stroke-width:1.5}',
    '.ac-note-badge.done circle{fill:var(--dsw-alias-label-secondary,#9aa3af)}',
    '.ac-note-badge text{fill:#14161a;font-size:11px;text-anchor:middle;pointer-events:none;user-select:none}',
    '.ac-note-badge.done text{fill:#fff}',
    '.ac-notes .ac-lib-item.done{opacity:.55;text-decoration:line-through}',
    // 检查点清单：AI 改的那几行左边一道蓝条，当前状态那一行加粗 —— 一眼看出「谁在什么时候动的」
    '.ac-hist .ac-hist-item{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;padding:3px 6px;border-left:3px solid transparent;color:var(--dsw-alias-label-secondary,#9aa3af)}',
    '.ac-hist .ac-hist-item.ai{border-left-color:var(--dsw-alias-brand-primary,#4c8dff);color:var(--dsw-alias-label-primary,#e8eaed)}',
    '.ac-hist .ac-hist-item.on{font-weight:600;color:var(--dsw-alias-label-primary,#e8eaed)}',
    '.ac-hist .ac-hist-cur{flex:0 0 auto;font-size:11px;color:var(--dsw-alias-label-secondary,#9aa3af)}',
    '.ac-note-actions{display:flex;gap:6px;margin-top:6px}',
    // 节点上的代码锚点角标与检查器中的引用校验状态
    '.ac-file-badge circle{fill:var(--dsw-alias-brand-primary,#4c8dff);stroke:var(--dsw-alias-bg-base,#14161a);stroke-width:1.5}',
    '.ac-file-badge.broken circle{fill:#e5534b}',
    '.ac-file-badge text{fill:#fff;font-size:10px;text-anchor:middle;pointer-events:none;user-select:none}',
    '.ac-ref-status{display:flex;flex-direction:column;gap:2px;margin-top:6px;font-size:11px;color:var(--dsw-alias-label-secondary,#9aa3af)}',
    '.ac-ref-status .ac-ref-bad{color:#e5534b}',
    '.ac-statusbar{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:4px 10px;border-top:1px solid var(--dsw-alias-border-l1,#2a2e35);font-size:11px;color:var(--dsw-alias-label-secondary,#9aa3af);white-space:nowrap;overflow:hidden}',
    '.ac-statusbar .grow{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis}',
    '.ac-dot{display:inline-block;width:6px;height:6px;border-radius:99px;background:var(--dsw-alias-state-success-primary,#3fb950);flex:0 0 auto}',
    '.ac-dot.busy{background:var(--dsw-alias-state-warning-primary,#d29922)}',
    // 侧栏底部入口按钮
    '.ac-foot{display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;padding:6px 8px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#9aa3af);font:inherit;font-size:13px;cursor:pointer;text-align:left;overflow:hidden;white-space:nowrap}',
    '.ac-foot:hover{background:var(--dsw-alias-bg-layer-2,#232830);color:var(--dsw-alias-label-primary,#e8eaed)}',
    '.ac-foot .lbl{overflow:hidden;text-overflow:ellipsis}',
].join('\n');
// ==================== RPC 出口 ====================
// 同一份界面要能在两种宿主下跑：
//   动态 Package —— 沙箱给的 host.call（Package 私有 RPC）
//   装成真插件   —— 客户端模块给的 fetch（打到 host 的 /arch-canvas/rpc）
// 差别收在这一个函数里，界面其余部分不关心。
var RPC = null;
function rpc(method, args) {
    if (typeof RPC === 'function')
        return RPC(method, args);
    if (typeof host !== 'undefined' && host && typeof host.call === 'function')
        return host.call(method, args);
    return Promise.reject(new Error('没有可用的 RPC 出口（既没有注入 rpc，也没有 host.call）'));
}
// ==================== Mermaid 运行时（可选增强） ====================
var MERMAID_CDN = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js';
var mermaidLoading = null;
var mermaidInited = false;
function msgOf(e) {
    if (e && typeof e === 'object' && typeof e.message === 'string')
        return e.message;
    return String(e);
}
function loadScript(src) {
    return new Promise(function (resolve, reject) {
        var el = document.createElement('script');
        el.src = src;
        el.async = true;
        el.onload = function () { resolve(window.mermaid); };
        el.onerror = function () { try {
            el.remove();
        }
        catch (e) { } reject(new Error('无法加载 ' + src)); };
        document.head.appendChild(el);
    });
}
function ensureMermaid() {
    if (window.mermaid)
        return Promise.resolve(window.mermaid);
    if (mermaidLoading)
        return mermaidLoading;
    mermaidLoading = (async function () {
        var urls = [];
        try {
            var info = await rpc('mermaid:info');
            if (info && typeof info.url === 'string' && info.url)
                urls.push(info.url);
        }
        catch (e) { }
        urls.push(MERMAID_CDN);
        var last = null;
        for (var i = 0; i < urls.length; i++) {
            try {
                var api = await loadScript(urls[i]);
                if (api)
                    return api;
            }
            catch (e) {
                last = e;
            }
        }
        mermaidLoading = null;
        throw last || new Error('mermaid 不可用');
    })();
    return mermaidLoading;
}
function kindOf(shape) {
    if (shape === 'diamond')
        return 'diamond';
    if (shape === 'cyl')
        return 'cyl';
    if (shape === 'circle')
        return 'ellipse';
    if (shape === 'hex')
        return 'hex';
    if (shape === 'round' || shape === 'stadium')
        return 'round';
    if (shape === 'sub')
        return 'sub';
    return 'rect';
}
function arrowMarkerRef(arrow) {
    if (arrow === '---' || arrow === '~~~')
        return '';
    return 'url(#ac-arrow)';
}
// ==================== 几何与布局 ====================
function visualLen(s) {
    var n = 0;
    var str = String(s == null ? '' : s);
    for (var i = 0; i < str.length; i++)
        n += str.charCodeAt(i) > 0x2e7f ? 2 : 1;
    return n;
}
// 纯函数记忆化：避免每帧拖拽时对全图节点重复拆行与计算视觉宽度。
// 用无原型对象存：标签可以叫 `__proto__` / `constructor`，普通 {} 会把它们当继承属性返回。
var nodeSizeCache = Object.create(null);
var nodeSizeCacheCount = 0;
// extraRows：标签之外还要占几行（目前只有「引用」那一行）。
// 它必须进缓存键 —— 同一个标签的节点，带 @file 与不带 @file 的高度不同，
// 共用一条缓存会让先算出来的那个尺寸污染另一个。
function nodeSize(label, extraRows) {
    var text = String(label == null ? '' : label);
    var extra = extraRows > 0 ? Math.round(extraRows) : 0;
    var key = text + '\u0000' + extra;
    var cached = nodeSizeCache[key];
    if (cached)
        return cached;
    var lines = text.split('\n');
    var widest = 4;
    for (var i = 0; i < lines.length; i++)
        widest = Math.max(widest, visualLen(lines[i]));
    var res = {
        w: Math.round(Math.min(300, Math.max(104, widest * 8.2 + 36))),
        h: Math.round(Math.max(44, (lines.length + extra) * 19 + 26)),
    };
    if (nodeSizeCacheCount > 2000) {
        nodeSizeCache = Object.create(null);
        nodeSizeCacheCount = 0;
    }
    nodeSizeCache[key] = res;
    nodeSizeCacheCount++;
    return res;
}
// 节点上「引用」那一行的文案：取路径最后一段、去掉 `#符号`，多条锚点追加 +N。
// 只给人看，不参与寻址 —— 完整路径在底部检查器与 AI 提示词里。
function refRowText(files) {
    if (!files || !files.length)
        return '';
    var first = String(files[0] == null ? '' : files[0]).split('#')[0].replace(/\/+$/, '');
    var base = first.split('/').pop() || first;
    return base ? ('▤ ' + base + (files.length > 1 ? ' +' + (files.length - 1) : '')) : '';
}
// 引用行占不占一行 —— nodeSize 与渲染必须用同一个判据，否则节点高度和文字对不上。
function refRowCount(files) {
    return refRowText(files) ? 1 : 0;
}
// 拖拽吸附：把候选坐标对齐到「其他节点的中心线」上，阈值内才吸。
// **只做中心线对齐**，不做边缘、也不做网格 —— 网格会限制自由布局，
// 而「这两个节点该不该排成一条线」才是摆整齐真正要回答的问题。
// 返回吸附后的坐标，以及命中的参考线位置（gx / gy 为 null 表示那条轴没吸上）。
var SNAP_PX = 8;
function snapToPeers(nodes, movingId, x, y) {
    var bx = null, by = null;
    var dbx = SNAP_PX + 1, dby = SNAP_PX + 1;
    for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (!n || n.id === movingId)
            continue;
        if (n.x == null || n.y == null)
            continue;
        var ax = Math.abs(n.x - x);
        if (ax <= SNAP_PX && ax < dbx) {
            dbx = ax;
            bx = n.x;
        }
        var ay = Math.abs(n.y - y);
        if (ay <= SNAP_PX && ay < dby) {
            dby = ay;
            by = n.y;
        }
    }
    return { x: bx == null ? x : bx, y: by == null ? y : by, gx: bx, gy: by };
}
// 标签 = 标题（第一段）+ 描述（其余段）。节点默认只画标题，点开（选中）才画描述 ——
// 所以这套分/合规则被**四处**共用：节点渲染、gstate 的尺寸、检查器的两个输入框、提交时的合成。
// 任何一处自己 split 一下，都会在某个方向上和别处对不上。
function splitLabel(label) {
    var s = String(label == null ? '' : label);
    var i = s.indexOf('\n');
    if (i < 0)
        return { title: s, desc: '' };
    return { title: s.slice(0, i), desc: s.slice(i + 1) };
}
// 标题是单行（换行压成空格）；描述保留内部换行、只去掉尾部空行。
// 描述为空时**不留尾随换行** —— 否则「只有标题」的节点会凭空多出一个空描述段，
// 每往返一次就多一行，节点也越画越高。
function composeLabel(title, desc) {
    var t = String(title == null ? '' : title).replace(/\r?\n/g, ' ');
    var d = String(desc == null ? '' : desc).replace(/\s+$/, '');
    return d ? (t + '\n' + d) : t;
}
// ==================== 源码页分词 ====================
// 只用来给源码页着色，**不做任何校验**（语义校验归宿主的 mermaid.ts 解析器）。
// 认的是 AC 那个 mermaid 子集：`%%` 注释行分三类、关键字、引号标签、箭头、id。
// 三类注释的颜色不同是有意的：`%%!` 是格式说明（最淡，可以无视）、
// `@pos/@link/@summary` 是元数据、`@note/@done/@file` 是**用户写在这个元素上的东西**。
var HL_ARROWS = ['<==>', '<-->', '-.->', '==>', '-->', '---', '~~~', '===', '->'];
var HL_KEYWORDS = {
    flowchart: 1, graph: 1, subgraph: 1, end: 1, direction: 1,
    classDef: 1, class: 1, style: 1, linkStyle: 1, click: 1, link: 1,
};
function tokenizeMermaidLine(line) {
    var out = [];
    var t = String(line == null ? '' : line);
    var trimmed = t.replace(/^\s+/, '');
    if (trimmed.slice(0, 2) === '%%') {
        var lead = t.slice(0, t.length - trimmed.length);
        var kind = 'c';
        if (trimmed.slice(0, 3) !== '%%!') {
            if (/^%%\s*@(pos|link|summary)\b/.test(trimmed))
                kind = 'm';
            else if (/^%%\s*@(note|done|file)\b/.test(trimmed))
                kind = 'u';
        }
        if (lead)
            out.push({ k: '', s: lead });
        out.push({ k: kind, s: trimmed });
        return out;
    }
    var i = 0;
    var buf = '';
    // 先切掉行首缩进（真实文件里节点行是缩进的，注入给 AI 的视图也带空白），再认行首关键字。
    // 关键字必须在这里单独认：进了下面的字符循环，`flowchart` 会被当普通 id 一路累积进 buf，
    // 等遇见空白时 buf 已非空，就再也认不出它是关键字了 ——
    // 这个 bug（顶格版与缩进版）是被 test/ui.render.mjs 的 [4g] 断言连着抓出来两次的。
    var lead = /^\s*/.exec(t)[0];
    if (lead) {
        out.push({ k: '', s: lead });
        i = lead.length;
    }
    var km = /^([A-Za-z][A-Za-z0-9_]*)/.exec(t.slice(i));
    if (km && HL_KEYWORDS[km[1]]) {
        out.push({ k: 'k', s: km[1] });
        i += km[1].length;
    }
    function flush() { if (buf) {
        out.push({ k: 'i', s: buf });
        buf = '';
    } }
    while (i < t.length) {
        var ch = t.charAt(i);
        if (ch === '"') {
            flush();
            var j = i + 1;
            while (j < t.length && t.charAt(j) !== '"')
                j++;
            out.push({ k: 's', s: t.slice(i, Math.min(j + 1, t.length)) });
            i = j + 1;
            continue;
        }
        var arrow = null;
        for (var a = 0; a < HL_ARROWS.length; a++) {
            if (t.slice(i, i + HL_ARROWS[a].length) === HL_ARROWS[a]) {
                arrow = HL_ARROWS[a];
                break;
            }
        }
        if (arrow) {
            flush();
            out.push({ k: 'a', s: arrow });
            i += arrow.length;
            continue;
        }
        if ('[](){}|&;,>'.indexOf(ch) >= 0) {
            flush();
            out.push({ k: 'p', s: ch });
            i++;
            continue;
        }
        buf += ch;
        i++;
    }
    flush();
    return out;
}
function needsLayout(model) {
    if (!model || !model.nodes || model.nodes.length === 0)
        return false;
    for (var i = 0; i < model.nodes.length; i++) {
        var n = model.nodes[i];
        if (typeof n.x !== 'number' || typeof n.y !== 'number')
            return true;
    }
    return false;
}
function autoLayout(model) {
    var nodes = model.nodes || [];
    if (nodes.length === 0)
        return model;
    var byId = {};
    var sizes = {};
    for (var i = 0; i < nodes.length; i++) {
        byId[nodes[i].id] = nodes[i];
        sizes[nodes[i].id] = nodeSize(nodes[i].label, refRowCount(nodes[i].files));
    }
    var edges = [];
    for (var e = 0; e < (model.edges || []).length; e++) {
        var ed = model.edges[e];
        if (byId[ed.from] && byId[ed.to] && ed.from !== ed.to)
            edges.push(ed);
    }
    var layer = {};
    for (var k = 0; k < nodes.length; k++)
        layer[nodes[k].id] = 0;
    for (var pass = 0; pass < nodes.length + 1; pass++) {
        var changed = false;
        for (var m = 0; m < edges.length; m++) {
            var cand = layer[edges[m].from] + 1;
            if (cand > layer[edges[m].to] && cand < nodes.length) {
                layer[edges[m].to] = cand;
                changed = true;
            }
        }
        if (!changed)
            break;
    }
    var buckets = [];
    for (var j = 0; j < nodes.length; j++) {
        var L = layer[nodes[j].id] || 0;
        if (!buckets[L])
            buckets[L] = [];
        buckets[L].push(nodes[j]);
    }
    var dir = model.direction || 'TD';
    var horiz = dir === 'LR' || dir === 'RL';
    var rev = dir === 'BT' || dir === 'RL';
    var GAP = horiz ? 74 : 56;
    var out = [];
    for (var q = 0; q < nodes.length; q++) {
        // **整份复制，只改坐标。** 从前这里是逐字段重建 `{id,label,shape,group,x,y}` ——
        // 于是点一下「自动布局」（或加载一张没带坐标的图触发它），所有节点的 files / note /
        // noteDone / link 全被丢掉，而且紧接着经 doc:set 落盘，**永久损坏**。
        // （2026-09-20 客户端逻辑审计抓到的头号问题；`refRowCount(nodes[i].files)` 上面还在用
        //   files 算尺寸，就更说明这些字段本该跟着走。）
        out.push(Object.assign({}, nodes[q]));
    }
    var pos = {};
    for (var li = 0; li < buckets.length; li++) {
        var bucket = buckets[li] || [];
        var span = GAP * Math.max(0, bucket.length - 1);
        for (var b = 0; b < bucket.length; b++)
            span += horiz ? sizes[bucket[b].id].h : sizes[bucket[b].id].w;
        var acc = -span / 2;
        var along = 0;
        for (var p = 0; p < li; p++) {
            var deep = 0;
            var row = buckets[p] || [];
            for (var r = 0; r < row.length; r++)
                deep = Math.max(deep, horiz ? sizes[row[r].id].w : sizes[row[r].id].h);
            along += deep + 84;
        }
        if (rev)
            along = -along;
        for (var n2 = 0; n2 < bucket.length; n2++) {
            var node = bucket[n2];
            var sz = sizes[node.id];
            var cross = acc + (horiz ? sz.h : sz.w) / 2;
            acc += (horiz ? sz.h : sz.w) + GAP;
            pos[node.id] = horiz ? { x: along, y: cross } : { x: cross, y: along };
        }
    }
    for (var f = 0; f < out.length; f++) {
        var pt = pos[out[f].id];
        if (pt) {
            out[f].x = Math.round(pt.x);
            out[f].y = Math.round(pt.y);
        }
    }
    return { nodes: out, edges: model.edges, groups: model.groups, direction: dir, extras: model.extras };
}
// ==================== 连线几何：正交折线 + 避让（draw.io 式） ====================
// 为什么是正交折线而不是曲线：曲线避让要在连续空间里解几何，很难做对；正交布线把候选
// 路径限制在「方块边线 ± 余量」这些格线上，避让就退化成「找一条不穿过任何方块的折线」，
// 几十个节点规模下是微秒级的事。两条抱怨（线穿过别的方块、弧度和拐弯不好看）一并解决。
//
// 契约不变：仍返回 { d, mid }（mid 给标签用）。新增的两个参数都是可选的，
// 老调用（只传 a、b）仍然得到一条合法的正交折线。
var EDGE_PAD = 12; // 避让余量：线离方块至少这么远
var EDGE_LANE = 16; // 绕行时走到障碍外侧的额外距离
var EDGE_PORT_INSET = 8; // 端口离方块两角的边距，别让线从角上出去
var EDGE_PORT_MIN_GAP = 12; // 同一侧两个端口的最小间距 ≈ 箭头宽度，否则箭头会叠在一起
var EDGE_CORNER = 8; // 拐角的圆角半径：折线不是画成直角，而是「稍微转个弯」（用户要的观感）
var EDGE_HOP = 5; // 交叉处的半圆拱桥半径：十字交叉时有一条线从上面跨过去
var EDGE_LANE_STEP = 12; // 中位线被占时，往两侧让的步长（并行线之间要有肉眼可见的间隔）
var EDGE_LANE_GAP = 10; // 两条平行线窄于这个距离就算「画在一起了」，必须错开
/** 轴对齐线段是否真的穿过矩形。用严格不等号，所以线可以**贴着**障碍边界走。 */
function edgeSegHitsRect(x1, y1, x2, y2, r) {
    if (y1 === y2) {
        if (y1 <= r.y1 || y1 >= r.y2)
            return false;
        return Math.max(x1, x2) > r.x1 && Math.min(x1, x2) < r.x2;
    }
    if (x1 === x2) {
        if (x1 <= r.x1 || x1 >= r.x2)
            return false;
        return Math.max(y1, y2) > r.y1 && Math.min(y1, y2) < r.y2;
    }
    return false;
}
function edgePathHits(pts, obs) {
    for (var i = 0; i + 1 < pts.length; i++) {
        for (var j = 0; j < obs.length; j++) {
            if (edgeSegHitsRect(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, obs[j]))
                return true;
        }
    }
    return false;
}
/** 把折点整理成一条干净的路径：去掉零长段与共线的多余拐点。`hops` 是交叉处的拱桥（可省）。 */
function edgeCleanPath(pts, hops) {
    var hp = (hops && hops.length) ? hops : [];
    var out = [];
    for (var i = 0; i < pts.length; i++) {
        var last = out[out.length - 1];
        if (last && Math.abs(last.x - pts[i].x) < 0.5 && Math.abs(last.y - pts[i].y) < 0.5)
            continue;
        out.push({ x: pts[i].x, y: pts[i].y });
    }
    var res = [out[0]];
    for (var k = 1; k + 1 < out.length; k++) {
        var p = res[res.length - 1], c = out[k], n = out[k + 1];
        var col = (Math.abs(p.x - c.x) < 0.5 && Math.abs(c.x - n.x) < 0.5) ||
            (Math.abs(p.y - c.y) < 0.5 && Math.abs(c.y - n.y) < 0.5);
        if (!col)
            res.push(c);
    }
    if (out.length > 1)
        res.push(out[out.length - 1]);
    // 出 d 要同时照顾两件事，所以按**段**走一遍，而不是按顶点：
    //   1) 拐角抹圆（EDGE_CORNER）：折线不是折成硬直角，而是「稍微转个弯」；
    //   2) 交叉处的拱桥（EDGE_HOP）：和别的连线十字相交时，在交点上画一段半圆从上面跨过去。
    //      用户的原话是「十字交叉时应该有一条线弯折一下」—— 要的就是这个，不是把直角抹圆。
    //
    // 两处的让位半径都收敛到「相邻线段的一半以内」，短段自动退化成尖角：
    // 圆角/拱桥永远吃不掉一整条线段，也就不会把路径抹穿或反向。
    // 注意返回的 `pts` 仍是**尖角折线**：避让判定、交叉检测与标签中点都按它算，只是画出来带修饰。
    var d = 'M ' + res[0].x + ' ' + res[0].y;
    var lx = res[0].x, ly = res[0].y;
    function lineTo(x, y) {
        if (Math.abs(x - lx) < 0.01 && Math.abs(y - ly) < 0.01)
            return;
        d += ' L ' + x + ' ' + y;
        lx = x;
        ly = y;
    }
    var np = res.length;
    // 每个顶点让给拐角多少（两端不让：那是方块边界，抹了箭头就离开边框）
    var trim = [];
    for (var v = 0; v < np; v++) {
        var rv = 0;
        if (v > 0 && v < np - 1) {
            var rl1 = edgeSegLen(res[v - 1], res[v]);
            var rl2 = edgeSegLen(res[v], res[v + 1]);
            rv = Math.min(EDGE_CORNER, rl1 / 2, rl2 / 2);
            if (!(rv > 0.6) || !(rl1 > 0) || !(rl2 > 0))
                rv = 0;
        }
        trim.push(rv);
    }
    for (var k = 0; k + 1 < np; k++) {
        var A = res[k], B = res[k + 1];
        var L = edgeSegLen(A, B);
        if (L <= 0)
            continue;
        var ux = (B.x - A.x) / L, uy = (B.y - A.y) / L;
        var t0 = trim[k];
        var t1 = L - trim[k + 1];
        // 本段上的拱桥：把 hop 点投影到本段参数上，只收真的落在这条线上的
        var hs = [];
        for (var h2 = 0; h2 < hp.length; h2++) {
            var hx = hp[h2].x - A.x, hy = hp[h2].y - A.y;
            var dt = hx * ux + hy * uy;
            var off = Math.abs(-hx * uy + hy * ux);
            if (off < 1.0)
                hs.push(dt);
        }
        hs.sort(function (q1, q2) { return q1 - q2; });
        lineTo(A.x + ux * t0, A.y + uy * t0);
        var cur = t0;
        for (var h3 = 0; h3 < hs.length; h3++) {
            var hb = hs[h3] - EDGE_HOP, he = hs[h3] + EDGE_HOP;
            // 与已画出来的圆角/拱桥打架就放弃这条 —— 少一个拱只是不好看，叠在一起是烂的
            if (hb < cur + 0.5 || he > t1 - 0.5)
                continue;
            lineTo(A.x + ux * hb, A.y + uy * hb);
            var aex = A.x + ux * he, aey = A.y + uy * he;
            // sweep 固定为 1：拱一律鼓在前进方向的**左侧**（屏幕上从左往右的线就往上鼓）
            d += ' A ' + EDGE_HOP + ' ' + EDGE_HOP + ' 0 0 1 ' + aex + ' ' + aey;
            lx = aex;
            ly = aey;
            cur = he;
        }
        lineTo(A.x + ux * t1, A.y + uy * t1);
        if (trim[k + 1] > 0) {
            var C = res[k + 1], N = res[k + 2];
            var l3 = edgeSegLen(C, N);
            var ex = C.x + (N.x - C.x) * (trim[k + 1] / l3), ey = C.y + (N.y - C.y) * (trim[k + 1] / l3);
            d += ' Q ' + C.x + ' ' + C.y + ' ' + ex + ' ' + ey;
            lx = ex;
            ly = ey;
        }
    }
    return { d: d, pts: res };
}
/** 轴对齐折线一段的长度。 */
function edgeSegLen(a, b) {
    return Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
}
/** 两条同向平行线段是否「贴在一起」：线距小于 gap 且投影相交。 */
function edgeLaneConflict(vert, c, lo, hi, u) {
    if (!u || u.vert !== vert)
        return false;
    if (Math.abs(u.c - c) >= EDGE_LANE_GAP)
        return false;
    return Math.min(hi, u.hi) - Math.max(lo, u.lo) > 0;
}
/** 取出折线里所有**内部**线段，作为「这条线占掉的车道」记下来。 */
function edgePathLanes(pts) {
    var out = [];
    for (var i = 1; i + 1 < pts.length; i++) {
        var a = pts[i], b = pts[i + 1];
        var vert = Math.abs(a.x - b.x) < 0.5;
        out.push(vert
            ? { vert: true, c: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y) }
            : { vert: false, c: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) });
    }
    return out;
}
/** 标签落点：取整条路径**按弧长**的一半处 —— 折线不再是直线，两端中点会偏。 */
function edgeMidOfPath(pts) {
    var total = 0;
    for (var i = 0; i + 1 < pts.length; i++) {
        total += Math.abs(pts[i + 1].x - pts[i].x) + Math.abs(pts[i + 1].y - pts[i].y);
    }
    if (total <= 0)
        return { x: pts[0].x, y: pts[0].y };
    var half = total / 2;
    for (var k = 0; k + 1 < pts.length; k++) {
        var seg = Math.abs(pts[k + 1].x - pts[k].x) + Math.abs(pts[k + 1].y - pts[k].y);
        if (half <= seg || k + 2 === pts.length) {
            var t = seg <= 0 ? 0 : half / seg;
            return { x: pts[k].x + (pts[k + 1].x - pts[k].x) * t, y: pts[k].y + (pts[k + 1].y - pts[k].y) * t };
        }
        half -= seg;
    }
    return { x: pts[0].x, y: pts[0].y };
}
/**
 * 端口在它那一侧上偏离正中心的距离。`p = { n, i }` 是「这一侧一共 n 根线、我是第 i 根」
 * （调用方按对端方向排好序传入），于是同一侧的线会沿边**展开**而不是全挤在边心。
 *
 * **端口绝不允许越过方块边界** —— 越过就是"悬空连接"（线头挂在方块外面）。矮节点
 * （只画标题的那种）尤其容易踩：高度只有 30 出头，一侧挤进 4 条线时，按最小间距摆
 * 会直接溢出到框外。所以这里把间距**同时**压在 (a) 不小于箭头宽、(b) 整串不越界；
 * 两个约束冲突时以 (b) 为准 —— 箭头挤一点只是难看，线头悬空是错的。
 */
function edgePortOffset(span, p) {
    if (!p || !(p.n > 1) || !(p.i >= 0))
        return 0;
    var usable = Math.max(0, span - 2 * EDGE_PORT_INSET);
    var gap = usable / (p.n - 1);
    if (gap < EDGE_PORT_MIN_GAP)
        gap = EDGE_PORT_MIN_GAP;
    var maxGap = (span - 4) / (p.n - 1);
    if (gap > maxGap)
        gap = Math.max(0, maxGap);
    return (p.i - (p.n - 1) / 2) * gap;
}
/**
 * 一条连线的路径。`obstacles` 是画布上**其它可见方块**的几何（被折叠收起的方块不该挡路），
 * `offset` 用于把同一对节点之间的多条线错开（由调用方按序号算），
 * `ports` 是两端的端口位次 `{ a: {n,i}, b: {n,i} }`，
 * `usedLanes` 是**前面几条线已经占掉的车道** —— 有了它，两条不同连线的中位线撞上时
 * 后来者会自己往旁边让（用户要的「平行间隔」）。由调用方逐条累积。
 */
function edgeGeometry(a, b, obstacles, offset, ports, usedLanes) {
    if (!a || !b)
        return null;
    var shift = (typeof offset === 'number' && isFinite(offset)) ? offset : 0;
    var obs = [];
    if (obstacles) {
        for (var i = 0; i < obstacles.length; i++) {
            var o = obstacles[i];
            if (!o || o === a || o === b)
                continue;
            if (typeof o.w !== 'number' || typeof o.h !== 'number')
                continue;
            obs.push({
                x1: o.x - o.w / 2 - EDGE_PAD, y1: o.y - o.h / 2 - EDGE_PAD,
                x2: o.x + o.w / 2 + EDGE_PAD, y2: o.y + o.h / 2 + EDGE_PAD,
            });
        }
    }
    var dx = b.x - a.x;
    var dy = b.y - a.y;
    var vertical = Math.abs(dy) >= Math.abs(dx);
    var pA = ports && ports.a;
    var pB = ports && ports.b;
    var p0, p1;
    // 自环（`n1 --> n1`）：从右边绕出去一小圈再回来。不特判的话 dx=dy=0 会被判成"垂直"，
    // 出点取底边中心、入点取顶边中心 —— 画出来是一条**从底边穿到顶边的直线**，正好捅穿方块。
    if (a === b) {
        var loopX = a.x + a.w / 2;
        var loopL = loopX + EDGE_LANE * 1.4;
        var loopT = a.y - a.h / 4;
        var loopB = a.y + a.h / 4;
        var loopPts = [{ x: loopX, y: loopT }, { x: loopL, y: loopT }, { x: loopL, y: loopB }, { x: loopX, y: loopB }];
        var lc = edgeCleanPath(loopPts);
        return { d: lc.d, mid: { x: loopL, y: a.y }, pts: lc.pts, lanes: edgePathLanes(lc.pts) };
    }
    if (vertical) {
        var down = dy >= 0;
        p0 = { x: a.x + edgePortOffset(a.w, pA), y: a.y + (down ? a.h / 2 : -a.h / 2) };
        p1 = { x: b.x + edgePortOffset(b.w, pB), y: b.y + (down ? -b.h / 2 : b.h / 2) };
    }
    else {
        var right = dx >= 0;
        p0 = { x: a.x + (right ? a.w / 2 : -a.w / 2), y: a.y + edgePortOffset(a.h, pA) };
        p1 = { x: b.x + (right ? -b.w / 2 : b.w / 2), y: b.y + edgePortOffset(b.h, pB) };
    }
    // 端口倒挂：中心点说「b 在下」，可两个方块**纵向上是重叠的**（a.x 与 b.x 差得远、
    // y 只差一点点，于是 |dy| >= |dx| 选中的是纵轴）—— 出点（a 的下边）反而落在入点
    // （b 的上边）之下。折线一出发就在往回走，直接钻进 a 自己身体里。
    // 这时换另一条轴：横着连过去不会倒挂。（2026-09-20 客户端逻辑审计第 7 条。）
    var inverted = vertical ? (dy >= 0 ? p1.y < p0.y : p1.y > p0.y) : (dx >= 0 ? p1.x < p0.x : p1.x > p0.x);
    if (inverted) {
        vertical = !vertical;
        if (vertical) {
            var down2 = dy >= 0;
            p0 = { x: a.x + edgePortOffset(a.w, pA), y: a.y + (down2 ? a.h / 2 : -a.h / 2) };
            p1 = { x: b.x + edgePortOffset(b.w, pB), y: b.y + (down2 ? -b.h / 2 : b.h / 2) };
        }
        else {
            var right2 = dx >= 0;
            p0 = { x: a.x + (right2 ? a.w / 2 : -a.w / 2), y: a.y + edgePortOffset(a.h, pA) };
            p1 = { x: b.x + (right2 ? -b.w / 2 : b.w / 2), y: b.y + edgePortOffset(b.h, pB) };
        }
    }
    // a 和 b 自己**不**进障碍表（带 12px 余量的话会把贴着边框出发的端口段一起判成"命中"，
    // 于是每条线都被拒），但要单独做一次**零余量**的自穿透检查：两个方块纵向上重叠时，
    // 中位线候选会从出点往回钻、直接穿过方块自己。零余量 + 严格不等号正好能分开
    // 「贴着边框出发」（不算命中）与「钻进边框内部」（算命中）。（审计第 6/7 条的地基。）
    var guard = obs.concat([
        { x1: a.x - a.w / 2, y1: a.y - a.h / 2, x2: a.x + a.w / 2, y2: a.y + a.h / 2 },
        { x1: b.x - b.w / 2, y1: b.y - b.h / 2, x2: b.x + b.w / 2, y2: b.y + b.h / 2 },
    ]);
    // 一段跨越式：从出点直走 → 在某个「跨越线」上横过去 → 再直走进点。
    // 候选跨越线按「离正中越近越优先」排序；障碍的边线外侧也在候选里 —— 那让线能贴着障碍绕。
    //
    // 中位线两侧先按 EDGE_LANE_STEP 铺开若干条：这是**平行间隔**的来源。从前中位线被别的线
    // 占了也照样画上去，两条线就逐像素叠在一起（实测画布上 48 处、线距 0px）。
    var mid0 = vertical ? (p0.y + p1.y) / 2 : (p0.x + p1.x) / 2;
    var cands = [mid0];
    for (var q = 1; q <= 3; q++) {
        cands.push(mid0 - q * EDGE_LANE_STEP);
        cands.push(mid0 + q * EDGE_LANE_STEP);
    }
    for (var j = 0; j < obs.length; j++) {
        if (vertical) {
            cands.push(obs[j].y1 - 2);
            cands.push(obs[j].y2 + 2);
        }
        else {
            cands.push(obs[j].x1 - 2);
            cands.push(obs[j].x2 + 2);
        }
    }
    if (vertical)
        cands.push(Math.min(p0.y, p1.y) - EDGE_LANE, Math.max(p0.y, p1.y) + EDGE_LANE);
    else
        cands.push(Math.min(p0.x, p1.x) - EDGE_LANE, Math.max(p0.x, p1.x) + EDGE_LANE);
    cands.sort(function (m, n) { return Math.abs(m - mid0) - Math.abs(n - mid0); });
    // 挑选顺序：**既不撞障碍、也不压别的线** > 只不撞障碍 > 兜底。
    // 车道冲突只在「两条线的这一段平行且投影相交」时才算 —— 隔得远的并行线互不相干。
    var used = usedLanes || [];
    var freeOfLane = function (pts) {
        var lanes = edgePathLanes(pts);
        for (var li = 0; li < lanes.length; li++) {
            for (var ui = 0; ui < used.length; ui++) {
                if (edgeLaneConflict(lanes[li].vert, lanes[li].c, lanes[li].lo, lanes[li].hi, used[ui]))
                    return false;
            }
        }
        return true;
    };
    var best = null;
    var bestAny = null;
    for (var c = 0; c < cands.length; c++) {
        var m = cands[c] + shift;
        var pts = vertical
            ? [{ x: p0.x, y: p0.y }, { x: p0.x, y: m }, { x: p1.x, y: m }, { x: p1.x, y: p1.y }]
            : [{ x: p0.x, y: p0.y }, { x: m, y: p0.y }, { x: m, y: p1.y }, { x: p1.x, y: p1.y }];
        if (edgePathHits(pts, guard))
            continue;
        if (!bestAny)
            bestAny = pts;
        if (freeOfLane(pts)) {
            best = pts;
            break;
        }
    }
    if (!best)
        best = bestAny;
    // 兜底一：两段跨越式，从整片障碍的外侧绕过去（中间那条直路被完全堵死时走这条）。
    if (!best) {
        var bx1 = Math.min(a.x - a.w / 2, b.x - b.w / 2);
        var by1 = Math.min(a.y - a.h / 2, b.y - b.h / 2);
        var bx2 = Math.max(a.x + a.w / 2, b.x + b.w / 2);
        var by2 = Math.max(a.y + a.h / 2, b.y + b.h / 2);
        for (var z = 0; z < obs.length; z++) {
            bx1 = Math.min(bx1, obs[z].x1);
            by1 = Math.min(by1, obs[z].y1);
            bx2 = Math.max(bx2, obs[z].x2);
            by2 = Math.max(by2, obs[z].y2);
        }
        var lanes = vertical ? [bx1 - EDGE_LANE, bx2 + EDGE_LANE] : [by1 - EDGE_LANE, by2 + EDGE_LANE];
        // 绕行折线的形状：先走一小段离开出点方块，横到外侧车道、沿车道走到另一端，再横回来进去。
        // 关键是那两条横线落在「刚离开方块」的位置，而不是落在正中 —— 落在正中时第一段
        // 就已经穿进障碍带了（这条是实测踩出来的，不是想出来的）。
        // 出点落在方块哪半边，第一步就往哪边走；入点落在哪半边，最后一步就从那一侧绕进去。
        // 从前这两个符号是按 p1 与 p0 的先后推的 —— 端口一旦倒挂（见上面那个 inverted）
        // 就会推出反号，绕行折线的第一步直接**缩进方块自己身体里**。（审计第 7 条。）
        var sy = (p0.y >= a.y) ? 1 : -1;
        var ey = (p1.y >= b.y) ? 1 : -1;
        var sx = (p0.x >= a.x) ? 1 : -1;
        var ex = (p1.x >= b.x) ? 1 : -1;
        for (var s = 0; s < lanes.length && !best; s++) {
            // 车道本身要带上 shift，否则同一对节点之间的多条线会算出**逐字节相同**的绕行路径。
            var lane = lanes[s] + shift;
            var detour = vertical
                ? [{ x: p0.x, y: p0.y }, { x: p0.x, y: p0.y + sy * EDGE_LANE }, { x: lane, y: p0.y + sy * EDGE_LANE },
                    { x: lane, y: p1.y + ey * EDGE_LANE }, { x: p1.x, y: p1.y + ey * EDGE_LANE }, { x: p1.x, y: p1.y }]
                : [{ x: p0.x, y: p0.y }, { x: p0.x + sx * EDGE_LANE, y: p0.y }, { x: p0.x + sx * EDGE_LANE, y: lane },
                    { x: p1.x + ex * EDGE_LANE, y: lane }, { x: p1.x + ex * EDGE_LANE, y: p1.y }, { x: p1.x, y: p1.y }];
            if (!edgePathHits(detour, guard))
                best = detour;
        }
    }
    // 兜底二：还是不行就直接跨越。画布上一根线消失比画得难看严重得多，所以绝不返回 null。
    if (!best) {
        var mf = mid0 + shift;
        best = vertical
            ? [{ x: p0.x, y: p0.y }, { x: p0.x, y: mf }, { x: p1.x, y: mf }, { x: p1.x, y: p1.y }]
            : [{ x: p0.x, y: p0.y }, { x: mf, y: p0.y }, { x: mf, y: p1.y }, { x: p1.x, y: p1.y }];
    }
    var clean = edgeCleanPath(best);
    // pts 交给调用方：交叉检测（拱桥）与「这条线占掉哪些车道」都要按尖角折线算。
    return { d: clean.d, mid: edgeMidOfPath(clean.pts), pts: clean.pts, lanes: edgePathLanes(clean.pts) };
}
function cloneModel(m) {
    return JSON.parse(JSON.stringify(m));
}
// ==================== 图标 ====================
function ArchIcon(props) {
    var s = props && typeof props.size === 'number' ? props.size : 18;
    return React.createElement('svg', { width: s, height: s, viewBox: '0 0 20 20', fill: 'none', 'aria-hidden': 'true', style: { flex: '0 0 auto' } }, React.createElement('rect', { x: 1.5, y: 1.5, width: 7, height: 5.5, rx: 1.5, stroke: 'currentColor', strokeWidth: 1.4 }), React.createElement('rect', { x: 11.5, y: 1.5, width: 7, height: 5.5, rx: 1.5, stroke: 'currentColor', strokeWidth: 1.4 }), React.createElement('rect', { x: 6.5, y: 13, width: 7, height: 5.5, rx: 1.5, stroke: 'currentColor', strokeWidth: 1.4 }), React.createElement('path', { d: 'M5 7v3h10V7M10 10v3', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }));
}
// ==================== 导出 ====================
// 导出用独立的字面色板：画布本身靠 --dsw-alias-* 变量，导出的 SVG 里没有主题上下文，
// 而且贴进文档通常是浅底。所以这里白底墨线，与面板内的观感无关。
var EXPORT_CSS = [
    '.ac-shape{fill:#ffffff;stroke:#4a5568;stroke-width:1.5}',
    '.ac-node.sel .ac-shape{stroke:#4a5568;stroke-width:1.5}',
    '.ac-lbl{fill:#1a202c;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-size:13px;font-weight:600;text-anchor:middle;dominant-baseline:central}',
    '.ac-desc{fill:#718096;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-size:11.5px;text-anchor:middle;dominant-baseline:central}',
    '.ac-desc .ac-intent{fill:#2b6cb0}',
    '.ac-desc .ac-rationale{fill:#6b46c1}',
    '.ac-ref{fill:#a0aec0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-size:10px;text-anchor:middle;dominant-baseline:central}',
    '.ac-edge{fill:none;stroke:#718096;stroke-width:1.6}',
    '.ac-edge.dashed{stroke-dasharray:6 5}',
    '.ac-arrowhead{fill:#718096}',
    '.ac-elbl{fill:#4a5568;font-size:11.5px;text-anchor:middle;dominant-baseline:central}',
    '.ac-elbl-bg{fill:#ffffff}',
    '.ac-group-box{fill:#f7fafc;stroke:#cbd5e0;stroke-dasharray:5 5;stroke-width:1.2}',
    '.ac-group-lbl{fill:#4a5568;font-size:11.5px;font-weight:600}',
    '.ac-fold-box{fill:#ebf4ff;stroke:#4c8dff;stroke-width:1.5}',
    '.ac-fold-lbl{fill:#1a202c;font-size:12.5px;text-anchor:middle;dominant-baseline:central}',
    '.ac-fold-btn circle,.ac-group-btn circle{fill:#4c8dff;stroke:#ffffff;stroke-width:1.5}',
    '.ac-fold-btn text,.ac-group-btn text{fill:#fff;font-size:10px;text-anchor:middle}',
].join('');
// 把画布内容做成一张独立的、自解释的 SVG。
// 只取 .ac-world 的子内容 —— 它那层 translate/scale 是视口变换，导出不要；
// 裁剪交给 viewBox（内容坐标与 box 同一坐标系，所以对得上）。
// 必须自带 marker 定义的 <defs>，保证连线箭头独立自包含、不丢箭头。
function buildExportSvg(worldNode, box) {
    var clone = worldNode.cloneNode(true);
    // 导出的是**结构**，不是面板：交互手柄、吸附线、脉动环、以及三个角标
    // （留言 ✎ / 锚点 ▤ / 下钻 ↗）全是界面装饰。它们从前既没被剔掉、EXPORT_CSS 里也没有
    // 对应规则 —— 而导出的 SVG 是一份脱离主题的独立文档，circle/text 缺省就是纯黑，
    // 于是节点角上会出现一坨黑斑。（2026-09-20 客户端逻辑审计第 4 条。）
    var drop = ['.ac-handle', '.ac-link-preview', '.ac-pulse', '.ac-snapline', '.ac-note-badge', '.ac-file-badge', '.ac-jump'];
    for (var i = 0; i < drop.length; i++) {
        var hits = clone.querySelectorAll(drop[i]);
        for (var j = 0; j < hits.length; j++)
            hits[j].parentNode.removeChild(hits[j]);
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + box.w + '" height="' + box.h + '"'
        + ' viewBox="' + box.x + ' ' + box.y + ' ' + box.w + ' ' + box.h + '">'
        + '<defs>'
        + '<marker id="ac-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
        + '<path d="M 0 0 L 10 5 L 0 10 z" class="ac-arrowhead" fill="#718096"/>'
        + '</marker>'
        + '</defs>'
        + '<style>' + EXPORT_CSS + '</style>'
        + '<rect x="' + box.x + '" y="' + box.y + '" width="' + box.w + '" height="' + box.h + '" fill="#ffffff"/>'
        + clone.innerHTML
        + '</svg>';
}
// SVG 串 → PNG。走 <img> 载 data/blob URL，所以 SVG 里不能有外部引用（已保证）。
function svgToPngBlob(svgText, w, h, scale) {
    return new Promise(function (resolve, reject) {
        var url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }));
        var img = new Image();
        img.onload = function () {
            try {
                var canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(w * scale));
                canvas.height = Math.max(1, Math.round(h * scale));
                var c2 = canvas.getContext('2d');
                c2.fillStyle = '#ffffff';
                c2.fillRect(0, 0, canvas.width, canvas.height);
                c2.setTransform(scale, 0, 0, scale, 0, 0);
                c2.drawImage(img, 0, 0);
                URL.revokeObjectURL(url);
                canvas.toBlob(function (b) {
                    if (b)
                        resolve(b);
                    else
                        reject(new Error('canvas.toBlob 返回空'));
                }, 'image/png');
            }
            catch (e) {
                URL.revokeObjectURL(url);
                reject(e);
            }
        };
        img.onerror = function () {
            URL.revokeObjectURL(url);
            reject(new Error('SVG 转图片失败'));
        };
        img.src = url;
    });
}
function downloadBlob(name, blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    try {
        ctxTimeout(function () { URL.revokeObjectURL(url); }, 8000);
    }
    catch (e) { }
}
// ==================== 定时器 ====================
// 客户端 Cordis 里 `timer` 是可选的：真插件形态**刻意不把它写进 inject**
// （声明了而部署里没有，插件会永远 park —— 侧栏里什么都不出现，还不报错）。
//
// 但「不 inject」不等于「可以直接读属性」：Cordis 对未 inject 的服务是**抛错**而不是给 undefined，
// 所以 `typeof PLUGIN_CTX.interval === 'function'` 会直接抛
// `cannot get property "timer" without inject`，兜底分支根本没机会跑 —— 面板一渲染就崩，一片空白。
// 正确的姿势是 `ctx.get('timer')`（可选取用，拿不到给 undefined），拿不到再退回原生定时器。
// 真插件形态里这段代码不在沙箱内，原生定时器可用；动态形态 inject 了 timer，走不到兜底。
function timerService() {
    if (!PLUGIN_CTX || typeof PLUGIN_CTX.get !== 'function')
        return null;
    try {
        return PLUGIN_CTX.get('timer') || null;
    }
    catch (e) {
        return null;
    }
}
function ctxTimeout(fn, ms) {
    var timer = timerService();
    if (timer && typeof timer.timeout === 'function')
        return timer.timeout(fn, ms);
    var id = globalThis.setTimeout(fn, ms);
    return function () { globalThis.clearTimeout(id); };
}
function ctxInterval(fn, ms) {
    var timer = timerService();
    if (timer && typeof timer.interval === 'function')
        return timer.interval(fn, ms);
    var id = globalThis.setInterval(fn, ms);
    return function () { globalThis.clearInterval(id); };
}

"use strict";
// ArchStudio：自绘 SVG 画布 + 源码视图 + 官方渲染预览。
// 编辑历史的关键：committedRef 存「已提交」快照，拖拽期间逐帧的 model 不进去。
// ==================== 主面板 ====================
var PLUGIN_CTX = null;
var TAB_ID = 'arch-canvas';
/**
 * 按下之后多远才算「拖动」而不是「点了一下」（client 像素，曼哈顿距离）。
 * 定这条门槛是为了让「点选」这个动作在触控板上也可靠：人的手点一下很少一动不动，
 * 没有门槛就会把「手抖了一像素」当成拖动 —— 既挪了节点、又记一条假历史、还不开详情。
 */
var DRAG_SLOP = 4;
// 当前画布的实时节点快照，供 register.ts 里的 @ 引用 trigger source 消费
var studioLiveNodes = [];
/**
 * 草稿里有没有这个节点的引用。**必须按词边界判**，不能用 `indexOf('@' + id)`：
 * 草稿里有 `@c11` 时 `@c1` 会被误判成「已经在了」，于是 c1 的未办留言永远进不了输入框。
 * 这一个口子同时管着自动补引用与写完留言时的去重。
 */
function draftHasRef(draft, id) {
    var s = String(id == null ? '' : id);
    if (!s)
        return false;
    var esc = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try {
        return new RegExp('(^|[^\\w-])@' + esc + '(?![\\w-])').test(String(draft == null ? '' : draft));
    }
    catch (e) {
        return String(draft == null ? '' : draft).indexOf('@' + s) >= 0;
    }
}
function syncLiveNodes(m) {
    if (!m || !m.nodes || !Array.isArray(m.nodes)) {
        studioLiveNodes = [];
    }
    else {
        studioLiveNodes = m.nodes.slice();
    }
}
function ArchStudio(props) {
    var cwd = props && props.cwd;
    var cwdRef = React.useRef(cwd);
    cwdRef.current = cwd;
    var sessionId = props && props.sessionId;
    var sidRef = React.useRef(sessionId);
    sidRef.current = sessionId;
    var inputActions = props && props.inputActions;
    // 草稿当前内容。写完留言要**自动**把 `@节点id` 追加进去（它会被装饰成上下文块），
    // 而 setDraft 是**整段替换** —— 不先读出来就会把用户正在打的字顶掉。
    // 这里的判断条件（props.useInput 在不在）在会话内是稳定的，不影响 hook 顺序。
    var useInputHook = (props && typeof props.useInput === 'function') ? props.useInput : null;
    var liveDraft = '';
    if (useInputHook) {
        var draftSel = useInputHook(function (s) { return (s && typeof s.draft === 'string') ? s.draft : ''; });
        if (typeof draftSel === 'string')
            liveDraft = draftSel;
    }
    var modelState = React.useState(null);
    var model = modelState[0];
    var setModel = modelState[1];
    var revState = React.useState(-1);
    var revision = revState[0];
    var setRevision = revState[1];
    var byState = React.useState('');
    var updatedBy = byState[0];
    var setUpdatedBy = byState[1];
    var fileState = React.useState('');
    var filePath = fileState[0];
    var setFilePath = fileState[1];
    // 当前图在本项目图库里的 key 与目录：选择器要显示自己站在哪一层
    var keyState = React.useState('');
    var libKey = keyState[0];
    var setLibKey = keyState[1];
    var dirState = React.useState('');
    var libDir = dirState[0];
    var setLibDir = dirState[1];
    // 打开的是项目里某个文件（按路径打开的）时，这里是它的绝对路径；图库里的图是 null
    var extState = React.useState(null);
    var external = extState[0];
    var setExternal = extState[1];
    // 上次见到的图库清单修订号：主人那边扫描发现变化时，选择器自己刷新
    var libRevRef = React.useRef(-1);
    // 图库选择器（列图 / 切图 / 新建 / 按路径打开）：人这一侧换图的唯一入口
    var pickerState = React.useState({
        open: false, items: [], files: [], busy: false,
        draft: '', pathDraft: '', focusPath: false, renameKey: '', renameDraft: '', confirmKey: '',
    });
    var picker = pickerState[0];
    var setPicker = pickerState[1];
    // 轮询回调只建一次，要读到「选择器是不是开着」就得走 ref
    var pickerRef = React.useRef(picker);
    pickerRef.current = picker;
    // 起始页（空画布）直接用最近一次扫描到的清单，它由 mount、轮询与「图库」按钮共同维护。
    // 位置必须在这里：stage 是在 return 之前就构造好的，声明放到文件后半段会被 var 提升成 undefined。
    var libItems = picker.items || [];
    var libFiles = picker.files || [];
    var textState = React.useState('');
    var mermaidText = textState[0];
    var setMermaidText = textState[1];
    var draftState = React.useState('');
    var draft = draftState[0];
    var setDraft = draftState[1];
    var tabState = React.useState('canvas');
    var tab = tabState[0];
    var setTab = tabState[1];
    var selState = React.useState(null);
    var sel = selState[0];
    var setSel = selState[1];
    // 下挂的检查器（节点/连线的详情）是**点开**的，不是**按下**就开的 —— 见 onPointerUp。
    // 从前面板在 pointerdown 就 setSel，于是「想拖一个节点」的那一下也把详情顶出来：
    // 它最多吃掉画布 46% 的高度，拖动途中画布变矮，节点被挤到看不见的地方，手感就坏了。
    // 选中的高亮仍然在按下时给（描边不改变布局，是拖动时该有的即时反馈），详情等抬手。
    var dockState = React.useState(false);
    var dockOpen = dockState[0];
    var setDockOpen = dockState[1];
    var viewState = React.useState({ x: 0, y: 0, k: 1 });
    var view = viewState[0];
    var setView = viewState[1];
    var statusState = React.useState('正在加载…');
    var status = statusState[0];
    var setStatus = statusState[1];
    var svgState = React.useState('');
    var svg = svgState[0];
    var setSvg = svgState[1];
    // 检查点面板（宿主侧的历史在内存里，见 src/host/history.ts）。
    // 这里只放「打开没打开 / 清单 / 正在退回哪一条」——清单每次打开都重新拉，不吃缓存：
    // AI 可能刚好在你打开面板的这一刻改了一次图。
    var histState = React.useState({ open: false, entries: [], busy: false, confirmSeq: 0 });
    var hist = histState[0];
    var setHist = histState[1];
    function patchHist(p) { setHist(function (h) { return Object.assign({}, h, p); }); }
    var historyCountState = React.useState(0);
    var historyCount = historyCountState[0];
    var setHistoryCount = historyCountState[1];
    var errState = React.useState('');
    var renderError = errState[0];
    var setRenderError = errState[1];
    // 解析警告：宿主一直把 warnings 随每个响应带回来，但界面从前一处都没读 ——
    // 「图悄悄少了一块」这件事，人和 AI 都看不见。这里把它接住，源码页渲染成诊断列表。
    var warnState = React.useState([]);
    var warnings = warnState[0];
    var setWarnings = warnState[1];
    var labState = React.useState('');
    var labelDraft = labState[0];
    var setLabelDraft = labState[1];
    // 描述单独一个草稿：检查器把「标题 / 描述」拆成两个框，提交时用 composeLabel 合成完整 label。
    // 这两个草稿必须**成对**读写 —— 切节点时只更新其中一个，另一个就会把上个节点的文字串过去。
    var descState = React.useState('');
    var descDraft = descState[0];
    var setDescDraft = descState[1];
    // 组折叠：**视图状态，不落盘**。它只改变「怎么画」，不动模型、不进文件 ——
    // 所以重开面板就复原，也不需要动解析器与 normalizeModel 的白名单。
    // 将来若要落盘，得走 `%% @collapsed` 那条完整的链（解析 / 白名单 / 快照 / 提示词），一处都不能漏。
    var collState = React.useState({});
    var collapsed = collState[0];
    var setCollapsed = collState[1];
    // 拖拽时的吸附参考线：{ gx, gy }，null = 没有吸上任何一条线。
    // 它只是**反馈**，不进模型、不进文件 —— 松手即消失。
    var hintState = React.useState(null);
    var dragHint = hintState[0];
    var setDragHint = hintState[1];
    var grpState = React.useState('');
    var groupDraft = grpState[0];
    var setGroupDraft = grpState[1];
    var elabState = React.useState('');
    var edgeDraft = elabState[0];
    var setEdgeDraft = elabState[1];
    // 节点留言：草稿与「已解决」标记分开存。留言不走拖拽路径，不需要 committedRef 那一套。
    var noteState = React.useState('');
    var noteDraft = noteState[0];
    var setNoteDraft = noteState[1];
    var noteDoneState = React.useState(false);
    var noteDoneDraft = noteDoneState[0];
    var setNoteDoneDraft = noteDoneState[1];
    var notesOpenState = React.useState(false);
    var notesOpen = notesOpenState[0];
    var setNotesOpen = notesOpenState[1];
    // 代码锚点草稿（textarea 绑定的文本，每行一个文件引用）
    var filesState = React.useState('');
    var filesDraft = filesState[0];
    var setFilesDraft = filesState[1];
    // 服务端返回的代码锚点校验状态映射：{ [nodeId]: { [ref]: 'ok' | 'missing' | 'symbol-missing' | 'unknown' } }
    var fileStatusRef = React.useRef({});
    var fileStatusTickState = React.useState(0);
    var setFileStatusTick = fileStatusTickState[1];
    var linkPtState = React.useState(null);
    var linkPt = linkPtState[0];
    var setLinkPt = linkPtState[1];
    // AI 刚改过哪些节点（用于脉动高亮）
    var hlState = React.useState(null);
    var highlight = hlState[0];
    var setHighlight = hlState[1];
    var hostRef = React.useRef(null);
    var svgRef = React.useRef(null);
    var dragRef = React.useRef(null);
    var modelRef = React.useRef(null);
    var viewRef = React.useRef(view);
    var revRef = React.useRef(-1);
    var currentDiagramRef = React.useRef('');
    var selRef = React.useRef(null);
    var geomRef = React.useRef({});
    var fittedRef = React.useRef(false);
    var rootRef = React.useRef(null);
    var hlTimerRef = React.useRef(null);
    // 编辑历史：past/future 存「已提交」的完整模型快照。
    // 关键：不能用当前 model 当「拖之前的状态」—— 拖拽期间每个 pointermove 都在 setLocal,
    // 所以另存一份 committedRef，只在提交点更新它。
    var histRef = React.useRef({ past: [], future: [] });
    var committedRef = React.useRef(null);
    var hotRef = React.useRef(false);
    var tabRef = React.useRef('canvas');
    // 源码页高亮：底层 <pre> 画彩色 token、顶层 textarea 文字透明（只留光标与选区）。
    // 两层必须字体、行高、padding、border 逐项一致，差一点光标与文字就错位。
    var hlRef = React.useRef(null);
    var taRef = React.useRef(null);
    // 源码页整页只有一个滚动口，就是它（见 runtime.ts 的 .ac-textwrap）。
    var textWrapRef = React.useRef(null);
    // 已经自动放进输入框的那一批待办留言（按 id 拼成的签名），防止删掉又被加回来。
    var autoFilledRef = React.useRef('');
    var histState = React.useState(0);
    var setHistTick = histState[1];
    viewRef.current = view;
    selRef.current = sel;
    tabRef.current = tab;
    var gstate = React.useMemo(function () {
        var out = {};
        if (model && model.nodes) {
            for (var i = 0; i < model.nodes.length; i++) {
                var n = model.nodes[i];
                // 节点**永远只画标题**，具体信息一律去检查器里看（2026-09 用户要求取消就地展开）。
                // 好处不只是省地方：尺寸不再与选中有关，于是选中一个方块**不会改变它的几何** ——
                // 连在它上面的线就不会因为你点一下而全部重画。
                var s = nodeSize(splitLabel(n.label).title, 0);
                out[n.id] = { x: n.x == null ? 0 : n.x, y: n.y == null ? 0 : n.y, w: s.w, h: s.h };
            }
        }
        geomRef.current = out;
        return out;
    }, [model, sel]);
    // 折叠后每个节点落在哪个「可见单元」上：普通节点是它自己，被收起来的组内节点合到组块上。
    // 边只有经过这张映射，才会从「连到节点」正确改接到「连到折叠块」。
    var foldMap = React.useMemo(function () {
        var m = {};
        if (!model || !model.groups)
            return m;
        for (var i = 0; i < model.groups.length; i++) {
            var g = model.groups[i];
            if (!collapsed[g.id])
                continue;
            for (var j = 0; j < model.nodes.length; j++) {
                if (model.nodes[j].group === g.id)
                    m[model.nodes[j].id] = g.id;
            }
        }
        return m;
    }, [model, collapsed]);
    // 折叠块自身的几何：位置取该组原本的包围盒中心 —— **成员节点的坐标一个字节都不动**，
    // 展开时原样回来。折叠是渲染视图，不是「删掉再放回」。尺寸与节点共用 nodeSize。
    var foldGeom = React.useMemo(function () {
        var out = {};
        if (!model || !model.groups)
            return out;
        for (var i = 0; i < model.groups.length; i++) {
            var g = model.groups[i];
            if (!collapsed[g.id])
                continue;
            var members = 0;
            var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (var j = 0; j < model.nodes.length; j++) {
                var n = model.nodes[j];
                if (n.group !== g.id)
                    continue;
                var gm = gstate[n.id];
                if (!gm)
                    continue;
                members++;
                minX = Math.min(minX, gm.x - gm.w / 2);
                maxX = Math.max(maxX, gm.x + gm.w / 2);
                minY = Math.min(minY, gm.y - gm.h / 2);
                maxY = Math.max(maxY, gm.y + gm.h / 2);
            }
            if (!members || !isFinite(minX))
                continue;
            var lbl = String(g.label == null ? g.id : g.label) + '（' + members + '）';
            var s = nodeSize(lbl, 0);
            out[g.id] = {
                x: Math.round((minX + maxX) / 2), y: Math.round((minY + maxY) / 2),
                w: s.w, h: s.h, label: lbl, members: members,
            };
        }
        return out;
    }, [model, gstate, collapsed]);
    // 给边用的几何：折叠组内的节点，一律换成它所属的那个折叠块。
    var visGeom = function (id) {
        var fid = foldMap[id];
        if (fid && foldGeom[fid])
            return foldGeom[fid];
        return gstate[id];
    };
    var groups = React.useMemo(function () {
        if (!model || !model.groups)
            return [];
        var res = [];
        for (var i = 0; i < model.groups.length; i++) {
            var g = model.groups[i];
            var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (var j = 0; j < model.nodes.length; j++) {
                var n = model.nodes[j];
                if (n.group !== g.id)
                    continue;
                var gm = gstate[n.id];
                if (!gm)
                    continue;
                minX = Math.min(minX, gm.x - gm.w / 2);
                maxX = Math.max(maxX, gm.x + gm.w / 2);
                minY = Math.min(minY, gm.y - gm.h / 2);
                maxY = Math.max(maxY, gm.y + gm.h / 2);
            }
            if (!isFinite(minX))
                continue;
            res.push({ id: g.id, label: g.label, x: minX - 20, y: minY - 34, w: maxX - minX + 40, h: maxY - minY + 54 });
        }
        return res;
    }, [model, gstate]);
    // 组折叠的开关（视图状态）。整份重建而不是原地改：React 要看到新对象才会重渲染。
    function toggleGroup(gid) {
        setCollapsed(function (m) {
            var next = {};
            for (var k in m)
                if (m[k])
                    next[k] = true;
            if (next[gid])
                delete next[gid];
            else
                next[gid] = true;
            return next;
        });
    }
    function setLocal(next) {
        modelRef.current = next;
        syncLiveNodes(next);
        setModel(next);
    }
    // ---------- 编辑历史 ----------
    function remember(snapshot) {
        var h = histRef.current;
        h.past.push(snapshot);
        if (h.past.length > 60)
            h.past.shift();
        h.future.length = 0;
        setHistTick(function (n) { return n + 1; });
    }
    // 只负责发送，不碰历史
    function sendModel(next, note) {
        setLocal(next);
        committedRef.current = cloneModel(next);
        rpc('doc:set', { model: next, note: note || '', where: cwdRef.current, session: sidRef.current }).then(function (r) {
            if (r && r.ok) {
                revRef.current = r.revision;
                setRevision(r.revision);
                setUpdatedBy('user');
                setMermaidText(r.mermaid);
                setDraft(r.mermaid);
                if (r.fileStatus) {
                    fileStatusRef.current = r.fileStatus || {};
                    setFileStatusTick(function (n) { return n + 1; });
                }
                setStatus(r.saved === false ? '已改图，但写盘失败' : '已同步给 AI');
            }
            else {
                setStatus('同步被拒绝：' + String(r && r.error));
            }
        }).catch(function (e) { setStatus('同步失败：' + msgOf(e)); });
    }
    // 用户提交一个新状态：把「上一次已提交的状态」压进历史。
    // committedRef 而不是 modelRef —— 后者在拖拽中被逐帧改过了。
    function push(next, note) {
        remember(cloneModel(committedRef.current || modelRef.current));
        sendModel(next, note);
    }
    function undo() {
        var h = histRef.current;
        if (h.past.length === 0) {
            setStatus('没有可撤销的操作');
            return;
        }
        var prev = h.past.pop();
        h.future.push(cloneModel(modelRef.current));
        setHistTick(function (n) { return n + 1; });
        if (tabRef.current !== 'canvas')
            setTab('canvas');
        sendModel(prev, '用户撤销了上一步');
        setStatus('已撤销');
    }
    function redo() {
        var h = histRef.current;
        if (h.future.length === 0) {
            setStatus('没有可重做的操作');
            return;
        }
        var next = h.future.pop();
        h.past.push(cloneModel(modelRef.current));
        setHistTick(function (n) { return n + 1; });
        if (tabRef.current !== 'canvas')
            setTab('canvas');
        sendModel(next, '用户重做了上一步');
        setStatus('已重做');
    }
    // 把 AI 刚动过的节点在图上闪一下。
    // 高亮的清除走定时器（有 timer 服务就用它，否则退回原生 —— 见 runtime.ts 的 ctxTimeout）。
    function flash(ids) {
        if (hlTimerRef.current) {
            try {
                hlTimerRef.current();
            }
            catch (e) { }
            hlTimerRef.current = null;
        }
        setHighlight({ nodes: ids, key: Date.now() });
        hlTimerRef.current = ctxTimeout(function () {
            hlTimerRef.current = null;
            setHighlight(null);
        }, 5200);
    }
    var applyServer = React.useCallback(function (r, origin) {
        if (!r || !r.ok)
            return;
        // 版本校验：慢响应乱序返回时，拒绝低于当前已知修订号的过期响应
        if (typeof r.revision === 'number' && r.revision < revRef.current)
            return;
        var m = r.model;
        if (needsLayout(m))
            m = autoLayout(m);
        var prev = committedRef.current;
        var diagKey = String(r.key || r.diagram || '');
        var diagChanged = currentDiagramRef.current !== '' && diagKey !== '' && currentDiagramRef.current !== diagKey;
        var isSwitch = (r.lastChange && r.lastChange.by === 'switch') || diagChanged;
        if (prev === null || isSwitch) {
            histRef.current.past.length = 0;
            histRef.current.future.length = 0;
            setHistTick(function (n) { return n + 1; });
            setSel(null);
            setDockOpen(false);
        }
        else if (origin === 'ai' || origin === 'local') {
            // AI 改图、从源码重建，同样进历史：Ctrl+Z 能把 AI 的改动退回去
            remember(cloneModel(prev));
        }
        if (diagKey)
            currentDiagramRef.current = diagKey;
        syncLiveNodes(m);
        setLocal(m);
        committedRef.current = cloneModel(m);
        revRef.current = r.revision;
        setRevision(r.revision);
        setUpdatedBy(r.updatedBy);
        setFilePath(r.file);
        setLibKey(r.key || r.diagram || '');
        setLibDir(r.dir || '');
        setExternal(r.external || null);
        fileStatusRef.current = r.fileStatus || {};
        setFileStatusTick(function (n) { return n + 1; });
        // 检查点条数：顶栏「历史 N」显示它。清单本身打开面板时才拉（可能刚好有新的一次 AI 改动）。
        if (typeof r.historyCount === 'number')
            setHistoryCount(r.historyCount);
        if (typeof r.libraryRev === 'number')
            libRevRef.current = r.libraryRev;
        setWarnings(Array.isArray(r.warnings) ? r.warnings : []);
        setMermaidText(r.mermaid);
        setDraft(r.mermaid);
        var lc = r.lastChange;
        if (lc && lc.by === 'ai' && lc.nodes && lc.nodes.length > 0) {
            flash(lc.nodes);
            setStatus('AI 改动了 ' + lc.nodes.length + ' 个节点（已高亮）');
        }
    }, []);
    // ==================== 源码页：滚轮兜底 ====================
    // 真凶已经在上面的滚轮缩放 effect 里修掉了（那条监听器泄漏到这个节点上、无条件
    // preventDefault）。这里再挂一道**原生** wheel 兜底：自己把 deltaY 加到 scrollTop 上，
    // 滚动了就 preventDefault，保证**只滚一次** —— 只要还有第二个想吃掉滚轮的东西，
    // 源码页就还能滑。将来真要删，先确认 [4q] 那两条探针还在守着。
    //
    // 必须用 addEventListener({ passive: false }) —— React 的 onWheel 在根上是 passive 的，
    // 里面调 preventDefault() 无效，会和浏览器自己的滚动叠加成双倍速。
    React.useEffect(function () {
        if (tab !== 'text')
            return;
        var el = textWrapRef.current;
        if (!el || typeof el.addEventListener !== 'function')
            return;
        var onWheel = function (ev) {
            var dy = (typeof ev.deltaY === 'number' && isFinite(ev.deltaY)) ? ev.deltaY : 0;
            // deltaMode：0=像素，1=行（Firefox），2=页。不换算的话行模式下每格只挪 3px，像没动。
            if (ev.deltaMode === 1)
                dy *= 16;
            else if (ev.deltaMode === 2)
                dy *= Math.max(1, el.clientHeight);
            var before = el.scrollTop;
            el.scrollTop = before + dy;
            // 只有真的滚动了才拦：已经到底时再拦会把滚轮整个吞掉，页面看起来是"卡住"
            if (el.scrollTop !== before) {
                if (typeof ev.preventDefault === 'function')
                    ev.preventDefault();
            }
        };
        el.addEventListener('wheel', onWheel, { passive: false });
        return function () { el.removeEventListener('wheel', onWheel); };
    }, [tab]);
    // ==================== 未办留言自动进输入框 ====================
    // 用户要的：不再有「放入输入框」那个按钮，**所有未办留言自动**以 `@id` 的形式进草稿。
    // 只追加缺的那些 —— 既不顶掉正在打的字，也不重复加。
    //
    // 触发条件是「待办集合变了」，不是「草稿变了」：后者会在用户手动删掉一个引用之后
    // 立刻又给他加回来，那不是自动，那是按键精灵。已解决的**不进** —— 它们不该再注入给 AI。
    React.useEffect(function () {
        if (!inputActions || typeof inputActions.setDraft !== 'function')
            return;
        if (!model || !model.nodes)
            return;
        var ids = [];
        for (var i = 0; i < model.nodes.length; i++) {
            var n = model.nodes[i];
            if (n && n.note && !n.noteDone)
                ids.push(n.id);
        }
        if (ids.length === 0) {
            // 待办清空了，签名也要跟着清 —— 否则「写一条留言 → 清掉 → 在同一个节点上再写一条」
            // 会撞上同一个签名，effect 以为这一批加过了，新留言永远进不了输入框。
            autoFilledRef.current = '';
            return;
        }
        var sig = ids.join(',');
        if (autoFilledRef.current === sig)
            return;
        autoFilledRef.current = sig;
        var cur = String(liveDraft == null ? '' : liveDraft);
        var add = [];
        for (var j = 0; j < ids.length; j++) {
            // 必须按**词边界**判，不能用 `indexOf('@' + id)`：草稿里有 `@c11` 时
            // `@c1` 会被误判成「已经在里面了」，于是 c1 的未办留言永远进不了输入框（审计第 8 条）。
            if (!draftHasRef(cur, ids[j]))
                add.push('@' + ids[j]);
        }
        if (add.length === 0)
            return;
        inputActions.setDraft(cur.trim() ? cur.replace(/\s+$/, '') + ' ' + add.join(' ') : add.join(' '));
    }, [model, liveDraft]);
    // 卸载与清理：组件卸载时取消待执行的高亮定时器
    React.useEffect(function () {
        return function () {
            if (hlTimerRef.current) {
                try {
                    hlTimerRef.current();
                }
                catch (e) { }
                hlTimerRef.current = null;
            }
        };
    }, []);
    /** 拉检查点清单。cwd 是必须的：历史按文件存，宿主得先落到同一个图库上。 */
    function loadHistory() {
        patchHist({ busy: true });
        rpc('doc:history', { where: cwd, session: sessionId }).then(function (r) {
            if (r && r.ok)
                patchHist({ busy: false, entries: r.entries || [], confirmSeq: 0 });
            else
                patchHist({ busy: false, entries: [] });
        }).catch(function () { patchHist({ busy: false, entries: [] }); });
    }
    /**
     * 退回某个检查点。**以宿主的返回值为准**：成功后整份文档都以回执为准重画
     * （与 doc:get 走同一条 applyServer），失败就原样显示错误 —— 不本地假装成功。
     */
    function rollbackTo(seq) {
        setStatus('正在退回检查点…');
        rpc('doc:rollback', { seq: seq, where: cwd, session: sessionId }).then(function (r) {
            if (!r || r.ok === false) {
                setStatus('退回失败：' + String((r && r.error) || '未知原因'));
                loadHistory();
                return;
            }
            applyServer(r, 'rollback');
            setStatus('已退回到检查点 #' + seq + '（这一步本身也记了一次检查点，可以再往前走）');
            loadHistory();
        }).catch(function (e) { setStatus('退回失败：' + msgOf(e)); loadHistory(); });
    }
    // 拉取与切换图：cwd 变化（从不就绪变就绪、或切会话）时重新拉取并重置视图
    React.useEffect(function () {
        var alive = true;
        setStatus('正在加载…');
        fittedRef.current = false;
        rpc('doc:get', { where: cwd, session: sessionId }).then(function (r) {
            if (!alive || !r || !r.ok) {
                if (alive)
                    setStatus('加载失败');
                return;
            }
            if (r.model)
                syncLiveNodes(r.model);
            applyServer(r, 'init');
            setStatus(needsLayout(r.model) ? '已按依赖关系自动布局' : '已就绪');
            // 起始页要列出项目里已有的图，所以清单不等用户点「图库」就先读一次
            if (alive)
                refreshLibraryItems(false, true);
        }).catch(function (e) { if (alive)
            setStatus('加载失败：' + msgOf(e)); });
        return function () { alive = false; };
    }, [cwd, sessionId, applyServer]);
    // AI 改了图就拉回来（只在修订号变化时才真正取数据）；
    // 顺带盯图库清单修订号 —— 宿主在自动扫描里发现新图/新文件时，选择器开着就自己刷新。
    React.useEffect(function () {
        var alive = true;
        var stopInterval = ctxInterval(function () {
            if (!alive)
                return;
            rpc('doc:rev', { where: cwdRef.current, session: sidRef.current }).then(function (r) {
                if (!alive || !r)
                    return null;
                if (typeof r.libraryRev === 'number' && r.libraryRev !== libRevRef.current) {
                    libRevRef.current = r.libraryRev;
                    // 选择器开着就整条刷新；没开也要更新清单 —— 起始页正是靠它列出现有图
                    if (pickerRef.current.open)
                        loadLibrary(false);
                    else
                        refreshLibraryItems(false, true);
                }
                if (r.revision === revRef.current)
                    return null;
                return rpc('doc:get', { where: cwdRef.current, session: sidRef.current }).then(function (full) {
                    if (!alive || !full || !full.ok)
                        return;
                    applyServer(full, full.updatedBy === 'ai' ? 'ai' : 'sync');
                    setStatus(full.updatedBy === 'ai' ? 'AI 刚更新了这张图' : '已从画布同步');
                });
            }).catch(function () { });
        }, 2500);
        return function () {
            alive = false;
            if (typeof stopInterval === 'function') {
                try {
                    stopInterval();
                }
                catch (e) { }
            }
        };
    }, [applyServer]);
    // 只有「刚在面板里点过」才接管 Ctrl/Cmd+Z；点回输入框或对话区就交还给浏览器
    React.useEffect(function () {
        function onDown(e) {
            var root = rootRef.current;
            hotRef.current = !!(root && e.target && root.contains(e.target));
        }
        window.addEventListener('pointerdown', onDown, true);
        return function () { window.removeEventListener('pointerdown', onDown, true); };
    }, []);
    React.useEffect(function () {
        function onKey(e) {
            if (!(e.metaKey || e.ctrlKey))
                return;
            var k = String(e.key).toLowerCase();
            if (k !== 'z' && k !== 'y')
                return;
            var el = document.activeElement;
            var tag = el && el.tagName ? String(el.tagName).toLowerCase() : '';
            if (tag === 'input' || tag === 'textarea' || tag === 'select' || (el && el.isContentEditable))
                return;
            if (!hotRef.current)
                return;
            e.preventDefault();
            if (k === 'y' || e.shiftKey)
                redo();
            else
                undo();
        }
        window.addEventListener('keydown', onKey);
        return function () { window.removeEventListener('keydown', onKey); };
    }, []);
    function fitView(force) {
        var el = hostRef.current;
        var cur = modelRef.current;
        if (!el || !cur || cur.nodes.length === 0)
            return false;
        var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (var i = 0; i < cur.nodes.length; i++) {
            var g = geomRef.current[cur.nodes[i].id];
            if (!g)
                continue;
            minX = Math.min(minX, g.x - g.w / 2);
            maxX = Math.max(maxX, g.x + g.w / 2);
            minY = Math.min(minY, g.y - g.h / 2);
            maxY = Math.max(maxY, g.y + g.h / 2);
        }
        var rect = el.getBoundingClientRect();
        if (!isFinite(minX) || rect.width < 60 || rect.height < 60)
            return false;
        var k = Math.min(1.4, Math.max(0.12, Math.min((rect.width - 48) / Math.max(1, maxX - minX), (rect.height - 48) / Math.max(1, maxY - minY))));
        var nv = { k: k, x: rect.width / 2 - ((minX + maxX) / 2) * k, y: rect.height / 2 - ((minY + maxY) / 2) * k };
        viewRef.current = nv;
        setView(nv);
        if (force)
            setStatus('已适应窗口');
        return true;
    }
    React.useEffect(function () {
        if (!model || fittedRef.current)
            return;
        if (fitView(false))
            fittedRef.current = true;
    }, [model]);
    // 侧栏从折叠恢复（宽度从 0 变正常）时补一次适应窗口。
    // 依赖 tab：三个 tab 的根元素是同一个 div，React 复用 DOM 节点 —— 挂了 [] 就一辈子
    // 盯着那个节点（切到源码页后它已经是 .ac-textwrap 了），只在画布页才该观测。
    React.useEffect(function () {
        if (tab !== 'canvas')
            return;
        var el = hostRef.current;
        if (!el || typeof ResizeObserver !== 'function')
            return;
        var ro = new ResizeObserver(function () {
            if (fittedRef.current)
                return;
            if (fitView(false))
                fittedRef.current = true;
        });
        ro.observe(el);
        return function () { ro.disconnect(); };
    }, [tab]);
    React.useEffect(function () {
        // **只在画布页挂滚轮缩放。** 这条 `if` 修的是一桩真 bug（用户报了两遍）：
        // 三个 tab 的根元素都是同一个 `div`，React 复用 DOM 节点，于是画布页挂上去的监听器
        // 切到源码页之后**还挂在那个节点上**（它现在的类名已经变成 .ac-textwrap 了），
        // 每次滚轮都无条件 preventDefault() —— 源码页的滚动被整条掐掉，
        // 表现就是「进了源码页，滚轮怎么滚都不动」。找了两轮 CSS 都没找到，因为它根本不在 CSS 里。
        if (tab !== 'canvas')
            return;
        var el = hostRef.current;
        if (!el)
            return;
        function onWheel(e) {
            e.preventDefault();
            var rect = el.getBoundingClientRect();
            var sx = e.clientX - rect.left;
            var sy = e.clientY - rect.top;
            var v = viewRef.current;
            var k2 = Math.min(2.6, Math.max(0.1, v.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
            var nv = { k: k2, x: sx - (sx - v.x) * (k2 / v.k), y: sy - (sy - v.y) * (k2 / v.k) };
            viewRef.current = nv;
            setView(nv);
        }
        el.addEventListener('wheel', onWheel, { passive: false });
        return function () { el.removeEventListener('wheel', onWheel); };
    }, [tab]);
    function toModelPt(e) {
        var el = hostRef.current;
        if (!el)
            return { x: 0, y: 0 };
        var rect = el.getBoundingClientRect();
        var v = viewRef.current;
        return { x: (e.clientX - rect.left - v.x) / v.k, y: (e.clientY - rect.top - v.y) / v.k };
    }
    function nodeAt(pt) {
        var cur = modelRef.current;
        if (!cur)
            return null;
        for (var i = cur.nodes.length - 1; i >= 0; i--) {
            var g = geomRef.current[cur.nodes[i].id];
            if (!g)
                continue;
            if (Math.abs(pt.x - g.x) <= g.w / 2 && Math.abs(pt.y - g.y) <= g.h / 2)
                return cur.nodes[i];
        }
        return null;
    }
    function capture(e) {
        try {
            if (svgRef.current)
                svgRef.current.setPointerCapture(e.pointerId);
        }
        catch (err) { }
    }
    function release(e) {
        try {
            if (svgRef.current)
                svgRef.current.releasePointerCapture(e.pointerId);
        }
        catch (err) { }
    }
    function onBackgroundDown(e) {
        if (e.button !== 0)
            return;
        setSel(null);
        setDockOpen(false);
        capture(e);
        var v = viewRef.current;
        dragRef.current = { kind: 'pan', ox: e.clientX - v.x, oy: e.clientY - v.y };
    }
    function onNodeDown(e, node) {
        if (e.button !== 0)
            return;
        e.stopPropagation();
        setSel({ kind: 'node', id: node.id });
        var sp0 = splitLabel(node.label);
        setLabelDraft(sp0.title);
        setDescDraft(sp0.desc);
        setGroupDraft(node.group || '');
        setNoteDraft(node.note || '');
        setNoteDoneDraft(node.noteDone === true);
        setFilesDraft((node.files || []).join('\n'));
        capture(e);
        var pt = toModelPt(e);
        var g = geomRef.current[node.id];
        dragRef.current = { kind: 'node', id: node.id, dx: g.x - pt.x, dy: g.y - pt.y, moved: false, sx: e.clientX, sy: e.clientY };
    }
    /**
     * 拖折叠起来的组。组**没有自己的坐标** —— 它就是成员节点的包围盒，
     * 所以「把组拖到哪」唯一真实的含义是「把它里面的人一起挪到哪」。
     * 这里只记起点与成员的初始坐标；位移在 move 里用**起点差值**算，避免逐帧累加磨偏坐标。
     */
    function onGroupDown(e, gid) {
        if (e.button !== 0)
            return;
        e.stopPropagation();
        var cur = modelRef.current;
        if (!cur)
            return;
        var members = [];
        for (var i = 0; i < cur.nodes.length; i++) {
            var n = cur.nodes[i];
            if (n.group !== gid)
                continue;
            members.push({ id: n.id, x: n.x == null ? 0 : n.x, y: n.y == null ? 0 : n.y });
        }
        if (!members.length)
            return;
        capture(e);
        dragRef.current = { kind: 'group', gid: gid, start: toModelPt(e), members: members, moved: false, sx: e.clientX, sy: e.clientY };
    }
    function onHandleDown(e, node) {
        if (e.button !== 0)
            return;
        e.stopPropagation();
        capture(e);
        setLinkPt(toModelPt(e));
        dragRef.current = { kind: 'link', from: node.id };
    }
    function onEdgeDown(e, from, to) {
        if (e.button !== 0)
            return;
        e.stopPropagation();
        setSel({ kind: 'edge', from: from, to: to });
        // 连线没有拖动语义，按下就是点 —— 详情直接开。
        setDockOpen(true);
        var cur = modelRef.current;
        var ed = null;
        if (cur && cur.edges) {
            for (var i = 0; i < cur.edges.length; i++) {
                if (cur.edges[i].from === from && cur.edges[i].to === to) {
                    ed = cur.edges[i];
                    break;
                }
            }
        }
        setEdgeDraft(ed && ed.label ? ed.label : '');
    }
    function onPointerMove(e) {
        var d = dragRef.current;
        if (!d)
            return;
        if (d.kind === 'pan') {
            var nv = { k: viewRef.current.k, x: e.clientX - d.ox, y: e.clientY - d.oy };
            viewRef.current = nv;
            setView(nv);
            return;
        }
        var pt = toModelPt(e);
        if (d.kind === 'node') {
            var cur = modelRef.current;
            if (!cur)
                return;
            // 抖动门槛：按下之后的一两像素移动**不算拖动**（触控板点一下很少一动不动）。
            // 过了门槛才认成拖动，也才可能进历史 —— 于是「按下就没动」的那一次干净地留给
            // onPointerUp 去开详情，而不是既开详情又记一条「用户移动了节点」的假历史。
            if (!d.moved && Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) < DRAG_SLOP)
                return;
            d.moved = true;
            // 吸附：接近别的节点的中心线就贴上去，并留一条参考线说明「贴的是哪一条」。
            var sn = snapToPeers(cur.nodes, d.id, Math.round(pt.x + d.dx), Math.round(pt.y + d.dy));
            setDragHint(sn.gx == null && sn.gy == null ? null : sn);
            var nx = sn.x;
            var ny = sn.y;
            var nodes = [];
            for (var i = 0; i < cur.nodes.length; i++) {
                var n = cur.nodes[i];
                // 用 Object.assign 保留**所有**字段：原先显式列 {id,label,shape,group,x,y} 会把
                // note / noteDone / files / link 悄悄丢掉 —— 拖一下，留言和锚点就没了（而且不报错）。
                nodes.push(n.id === d.id ? Object.assign({}, n, { x: nx, y: ny }) : n);
            }
            setLocal({ nodes: nodes, edges: cur.edges, groups: cur.groups, direction: cur.direction, extras: cur.extras });
            return;
        }
        if (d.kind === 'group') {
            var curG = modelRef.current;
            if (!curG)
                return;
            // 与节点拖动同一条门槛：折叠块「点一下」不该把整组挪走，也不该记一条历史。
            if (!d.moved && Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) < DRAG_SLOP)
                return;
            d.moved = true;
            // 组**没有自己的坐标** —— 它就是成员节点的包围盒。所以「拖动组」唯一真实的含义
            // 是把成员一起挪。位移用**起点差值**而不是逐帧累加，免得浮点误差把坐标磨偏。
            var gdx = Math.round(pt.x - d.start.x);
            var gdy = Math.round(pt.y - d.start.y);
            var startPos = {};
            for (var mk = 0; mk < d.members.length; mk++)
                startPos[d.members[mk].id] = d.members[mk];
            var gNodes = [];
            for (var gk = 0; gk < curG.nodes.length; gk++) {
                var gn = curG.nodes[gk];
                var base = startPos[gn.id];
                gNodes.push(base ? Object.assign({}, gn, { x: base.x + gdx, y: base.y + gdy }) : gn);
            }
            setLocal({ nodes: gNodes, edges: curG.edges, groups: curG.groups, direction: curG.direction, extras: curG.extras });
            return;
        }
        if (d.kind === 'link')
            setLinkPt(pt);
    }
    function onPointerUp(e) {
        var d = dragRef.current;
        dragRef.current = null;
        release(e);
        setDragHint(null);
        if (!d)
            return;
        if (d.kind === 'node' && d.moved) {
            push(modelRef.current, '用户移动了节点');
            setStatus('已移动节点并同步');
            return;
        }
        if (d.kind === 'node' && !d.moved) {
            // 按下与抬手之间没有真实位移 = 一次「点选」。详情在这一刻才展开：
            // 它下挂的是一块最多占 46% 高度的面板，拖动中途展开会把画布挤矮、把节点挤出视野。
            setDockOpen(true);
            return;
        }
        if (d.kind === 'group' && d.moved) {
            push(modelRef.current, '用户移动了分组');
            setStatus('已移动分组里的 ' + d.members.length + ' 个节点');
            return;
        }
        if (d.kind === 'link') {
            var pt = toModelPt(e);
            var target = nodeAt(pt);
            setLinkPt(null);
            if (!target || target.id === d.from)
                return;
            var cur = modelRef.current;
            for (var i = 0; i < cur.edges.length; i++) {
                if (cur.edges[i].from === d.from && cur.edges[i].to === target.id) {
                    setStatus('这条连线已经存在');
                    return;
                }
            }
            var next = cloneModel(cur);
            next.edges.push({ id: 'e' + (next.edges.length + 1), from: d.from, to: target.id, label: '', arrow: '-->' });
            push(next, '用户新增了一条连线');
            setStatus('已连线 ' + d.from + ' → ' + target.id);
        }
    }
    function onLostPointerCapture(e) {
        dragRef.current = null;
        setLinkPt(null);
    }
    function onKeyDown(e) {
        var tag = e.target && e.target.tagName ? String(e.target.tagName).toLowerCase() : '';
        var inField = tag === 'input' || tag === 'textarea' || tag === 'select';
        if (e.key === 'Delete' || e.key === 'Backspace') {
            if (inField)
                return;
            e.preventDefault();
            deleteSel();
            return;
        }
        if (e.key === 'Escape') {
            // 两段式：焦点在输入框里时，第一下只把焦点**拿出来**（不关编辑页、也不动你写的内容），
            // 再按一下（此时焦点已不在输入框）才关。
            // 为什么不直接关：中文输入法组字过程中按 Esc 是"取消这次组字"，
            // 顺手把编辑页关掉会连带丢掉刚写的东西；所以组字进行中连焦点都不动。
            if (inField) {
                if (e.isComposing)
                    return;
                // 注意：这里**不能**用 blur()。Esc 的处理器挂在面板容器（.ac-root）上，
                // 一旦焦点 blur 到 body，第二下 Esc 就再也到不了这个函数 —— 实测过：
                // 那样只会"丢焦点"，编辑页永远关不掉。面板根本来就 tabIndex=0，
                // 把焦点移进去既是"离开了输入框"，又让第二下仍然落在面板里。
                if (rootRef.current && typeof rootRef.current.focus === 'function')
                    rootRef.current.focus();
                else if (e.target && typeof e.target.blur === 'function')
                    e.target.blur();
                return;
            }
            // 取消选中，连带收掉还没落下的连线预览
            setSel(null);
            setLinkPt(null);
            setDragHint(null);
            return;
        }
        // 方向键微调选中节点：1px；按住 Shift 是 10px。
        // 「改优先」里这是最省力的一条 —— 手摆的坐标是用户的劳动成果，
        // 用键盘能一次对准到像素，不必靠鼠标抖。
        var step = e.key === 'ArrowLeft' ? [-1, 0] : e.key === 'ArrowRight' ? [1, 0]
            : e.key === 'ArrowUp' ? [0, -1] : e.key === 'ArrowDown' ? [0, 1] : null;
        if (!step || inField)
            return;
        var s = selRef.current;
        if (!s || s.kind !== 'node')
            return;
        e.preventDefault();
        var k = e.shiftKey ? 10 : 1;
        nudgeSel(step[0] * k, step[1] * k);
    }
    /** 把选中节点平移 (dx, dy)：方向键走这里，拖拽吸附落定后也走这里。 */
    function nudgeSel(dx, dy) {
        var s = selRef.current;
        var cur = modelRef.current;
        if (!s || s.kind !== 'node' || !cur)
            return;
        var next = cloneModel(cur);
        for (var i = 0; i < next.nodes.length; i++) {
            if (next.nodes[i].id !== s.id)
                continue;
            next.nodes[i].x = (next.nodes[i].x == null ? 0 : next.nodes[i].x) + dx;
            next.nodes[i].y = (next.nodes[i].y == null ? 0 : next.nodes[i].y) + dy;
        }
        push(next, '用户微调了节点位置');
    }
    function deleteSel() {
        var s = selRef.current;
        var cur = modelRef.current;
        if (!s || !cur)
            return;
        var next = cloneModel(cur);
        if (s.kind === 'node') {
            next.nodes = next.nodes.filter(function (n) { return n.id !== s.id; });
            next.edges = next.edges.filter(function (e) { return e.from !== s.id && e.to !== s.id; });
            setSel(null);
            push(next, '用户删除了节点');
            setStatus('已删除节点');
        }
        else {
            var found = false;
            var filtered = [];
            for (var i = 0; i < next.edges.length; i++) {
                var ed = next.edges[i];
                if (!found && ed.from === s.from && ed.to === s.to) {
                    found = true;
                    continue;
                }
                filtered.push(ed);
            }
            setSel(null);
            if (found) {
                next.edges = filtered;
                push(next, '用户删除了一条连线');
                setStatus('已删除连线');
            }
        }
    }
    function addNode() {
        var cur = modelRef.current;
        if (!cur)
            return;
        var used = {};
        for (var i = 0; i < cur.nodes.length; i++)
            used[cur.nodes[i].id] = true;
        var k = cur.nodes.length + 1;
        while (used['n' + k])
            k += 1;
        var id = 'n' + k;
        var v = viewRef.current;
        var el = hostRef.current;
        var rect = el ? el.getBoundingClientRect() : { width: 320, height: 300 };
        var x = Math.round((rect.width / 2 - v.x) / v.k);
        var y = Math.round((rect.height / 2 - v.y) / v.k);
        var next = cloneModel(cur);
        next.nodes.push({ id: id, label: '新节点', shape: 'rect', group: null, x: x, y: y });
        push(next, '用户新增了节点');
        setSel({ kind: 'node', id: id });
        setDockOpen(true);
        setLabelDraft('新节点');
        setDescDraft('');
        setGroupDraft('');
        setNoteDraft('');
        setNoteDoneDraft(false);
        setFilesDraft('');
        setStatus('已新增节点，可在下方改名字');
    }
    function relayout() {
        var cur = modelRef.current;
        if (!cur)
            return;
        push(autoLayout(cur), '用户点了自动布局');
        setStatus('已自动布局');
        fittedRef.current = false;
        if (fitView(false))
            fittedRef.current = true;
    }
    function commitLabel() {
        var s = selRef.current;
        var cur = modelRef.current;
        if (!s || s.kind !== 'node' || !cur)
            return;
        var node = null;
        for (var i = 0; i < cur.nodes.length; i++)
            if (cur.nodes[i].id === s.id)
                node = cur.nodes[i];
        // 标题与描述是两个框，合成之后才是真正的 label —— 比较也用合成值，
        // 否则「只改了描述」会被误判成没变而悄悄丢掉。
        var want = composeLabel(labelDraft, descDraft);
        if (!node || node.label === want)
            return;
        var next = cloneModel(cur);
        for (var j = 0; j < next.nodes.length; j++)
            if (next.nodes[j].id === s.id)
                next.nodes[j].label = want;
        push(next, '用户改了节点名称');
        setStatus('已改名');
        fittedRef.current = false;
    }
    /**
     * 组 id 不能含空格：`scanNodeRef` 的 ID_RE 遇到空格就停，`subgraph AI 端["AI 端"]`
     * 会被解析成 id=`AI` + 标签=`端["AI 端"]`，下次加载组结构就分裂、往返严重漂移。
     * 宿主侧 `set_group` 会过一遍 `cleanId`，但**检查器这条路是客户端直接改模型** ——
     * 从前这里没洗，用户在分组框里打一个空格就能把源文本写坏（审计第 3 条）。
     */
    function groupKeyOf(name) {
        return String(name == null ? '' : name).replace(/\s+/g, '_').replace(/[\u005b\u005d{}()"#;|&<>]/g, '');
    }
    function commitGroup() {
        var s = selRef.current;
        var cur = modelRef.current;
        if (!s || s.kind !== 'node' || !cur)
            return;
        var next = cloneModel(cur);
        var raw = groupDraft.trim();
        var want = null;
        if (raw) {
            // 先按**现有组的 id 或标签**认领：用户打的是给人看的名字（"AI 端"），
            // 而 id 早就被洗成 "AI端" 了。不认领就会凭空多出一个同名组、图被分成两半。
            var pick = groupKeyOf(raw);
            for (var g0 = 0; g0 < next.groups.length; g0++) {
                var gg = next.groups[g0];
                if (gg && (gg.id === pick || gg.label === raw || groupKeyOf(gg.label) === pick)) {
                    want = gg.id;
                    break;
                }
            }
            if (!want)
                want = pick;
        }
        var prev = undefined;
        var found = false;
        for (var i = 0; i < next.nodes.length; i++) {
            if (next.nodes[i].id !== s.id)
                continue;
            prev = next.nodes[i].group || null;
            next.nodes[i].group = want;
            found = true;
        }
        if (!found)
            return;
        if (prev === want)
            return;
        if (want) {
            var exists = false;
            for (var g = 0; g < next.groups.length; g++)
                if (next.groups[g].id === want)
                    exists = true;
            // label 保留用户打的原话（可以是 "AI 端"），id 用洗干净的那个
            if (!exists)
                next.groups.push({ id: want, label: raw });
        }
        push(next, '用户改了分组');
        setStatus('已更新分组');
    }
    /**
     * 提交节点留言。空文本 = 删除留言（文件里那一行也不再写出）。
     * 留言只存在节点上、经 `doc:set` 整份回传落盘，所以不需要新的 RPC。
     */
    function commitNote() {
        var s = selRef.current;
        var cur = modelRef.current;
        if (!s || s.kind !== 'node' || !cur)
            return;
        var text = String(noteDraft == null ? '' : noteDraft).trim();
        var next = cloneModel(cur);
        var node = null;
        for (var i = 0; i < next.nodes.length; i++)
            if (next.nodes[i].id === s.id)
                node = next.nodes[i];
        if (!node)
            return;
        // 没有正文时「已解决」不成立（宿主侧也这么归一），别把半截状态写进文件
        var changed = (node.note || '') !== text;
        var done = text !== '' && noteDoneDraft === true;
        // 改过正文 = 这条留言重新变成**待办**：用户花力气改了它，就是为了让我重新看到它。
        // 不改的话，一条被标成「已解决」的留言被编辑后仍然不进上下文 —— 用户改的话 AI 永远读不到，
        // 而界面上它还是「已解决」，看不出任何异常（用户报的「编辑后应该自动重新打开」）。
        var reopened = changed && done;
        if (reopened)
            done = false;
        if ((node.note || '') === text && (node.noteDone === true) === done)
            return;
        node.note = text;
        node.noteDone = done;
        if (text === '' || reopened)
            setNoteDoneDraft(false);
        push(next, text === '' ? '用户清除了节点留言' : (reopened ? '用户改了留言，已自动重新打开' : '用户写了节点留言'));
        setStatus(text === ''
            ? '已清除留言'
            : (reopened
                ? '留言已改动，自动重新打开（会随每一步进入 AI 的上下文）'
                : (done ? '留言已保存（已解决，不再注入给 AI）' : '留言已保存，会随每一步进入 AI 的上下文')));
        // 「自动进输入框」不在这里做：那条 effect 盯着**待办集合**，写完留言它会自己补上。
        // 两处都写就会互相打架（一个用签名去重、一个用 `@id` 去重，删了又被另一个加回来）。
    }
    /**
     * 提交代码锚点引用。按行切分、trim、丢掉空行；与旧值相同时直接 return。
     * 空数组 = 清掉该节点的所有引用（宿主序列化时就不写出 %% @file 行）。
     */
    function commitFiles() {
        var s = selRef.current;
        var cur = modelRef.current;
        if (!s || s.kind !== 'node' || !cur)
            return;
        var raw = String(filesDraft == null ? '' : filesDraft);
        var lines = raw.split('\n');
        var list = [];
        for (var i = 0; i < lines.length; i++) {
            var item = lines[i].trim();
            if (item)
                list.push(item);
        }
        var next = cloneModel(cur);
        var node = null;
        for (var j = 0; j < next.nodes.length; j++)
            if (next.nodes[j].id === s.id)
                node = next.nodes[j];
        if (!node)
            return;
        var oldList = node.files || [];
        if (oldList.length === list.length) {
            var same = true;
            for (var k = 0; k < list.length; k++) {
                if (oldList[k] !== list[k]) {
                    same = false;
                    break;
                }
            }
            if (same)
                return;
        }
        node.files = list;
        push(next, '用户改了代码锚点');
        setStatus(list.length === 0 ? '已清除代码锚点' : '已保存代码锚点 (' + list.length + ' 个引用)');
    }
    /** 标记已解决 / 重新打开。`id` 省略时作用于当前选中的节点（留言清单里按 id 调用）。 */
    function markNote(done, id) {
        var cur = modelRef.current;
        if (!cur)
            return;
        var target = id || (selRef.current && selRef.current.kind === 'node' ? selRef.current.id : '');
        if (!target)
            return;
        var next = cloneModel(cur);
        var found = null;
        for (var i = 0; i < next.nodes.length; i++)
            if (next.nodes[i].id === target)
                found = next.nodes[i];
        if (!found || !found.note)
            return;
        found.noteDone = done === true;
        if (!id)
            setNoteDoneDraft(done === true);
        push(next, done ? '用户标记留言已解决' : '用户重新打开了留言');
        setStatus(done ? '已标记为已解决（不再注入给 AI）' : '留言已重新打开');
    }
    /** 从留言清单跳到某个节点：选中它（检查器随之出现），并把它挪到视口中央。 */
    function focusNode(id) {
        var cur = modelRef.current;
        if (!cur)
            return;
        var node = null;
        for (var i = 0; i < cur.nodes.length; i++)
            if (cur.nodes[i].id === id)
                node = cur.nodes[i];
        if (!node)
            return;
        setSel({ kind: 'node', id: id });
        setDockOpen(true);
        var sp1 = splitLabel(node.label);
        setLabelDraft(sp1.title);
        setDescDraft(sp1.desc);
        setGroupDraft(node.group || '');
        setNoteDraft(node.note || '');
        setNoteDoneDraft(node.noteDone === true);
        setFilesDraft((node.files || []).join('\n'));
        setNotesOpen(false);
        var g = geomRef.current[id];
        var svg = svgRef.current;
        if (g && svg && typeof svg.getBoundingClientRect === 'function') {
            var box = svg.getBoundingClientRect();
            var v = viewRef.current;
            var nv = { k: v.k, x: box.width / 2 - g.x * v.k, y: box.height / 2 - g.y * v.k };
            viewRef.current = nv;
            setView(nv);
        }
        setStatus('已定位到节点 ' + id);
    }
    function setShape(shape) {
        var s = selRef.current;
        var cur = modelRef.current;
        if (!s || s.kind !== 'node' || !cur)
            return;
        var next = cloneModel(cur);
        for (var i = 0; i < next.nodes.length; i++)
            if (next.nodes[i].id === s.id)
                next.nodes[i].shape = shape;
        push(next, '用户改了节点形状');
    }
    function commitEdgeLabel() {
        var s = selRef.current;
        var cur = modelRef.current;
        if (!s || s.kind !== 'edge' || !cur)
            return;
        var next = cloneModel(cur);
        var targetEdge = null;
        for (var i = 0; i < next.edges.length; i++) {
            if (next.edges[i].from === s.from && next.edges[i].to === s.to) {
                targetEdge = next.edges[i];
                break;
            }
        }
        if (!targetEdge) {
            setSel(null);
            return;
        }
        if (targetEdge.label === edgeDraft)
            return;
        targetEdge.label = edgeDraft;
        push(next, '用户改了连线标签');
        setStatus('已更新连线标签');
    }
    function setArrow(arrow) {
        var s = selRef.current;
        var cur = modelRef.current;
        if (!s || s.kind !== 'edge' || !cur)
            return;
        var next = cloneModel(cur);
        var targetEdge = null;
        for (var i = 0; i < next.edges.length; i++) {
            if (next.edges[i].from === s.from && next.edges[i].to === s.to) {
                targetEdge = next.edges[i];
                break;
            }
        }
        if (!targetEdge) {
            setSel(null);
            return;
        }
        targetEdge.arrow = arrow;
        push(next, '用户改了连线样式');
    }
    // 内容包围盒（含分组框），导出与适应窗口共用同一套算法
    function contentBox() {
        var cur = modelRef.current;
        if (!cur || cur.nodes.length === 0)
            return null;
        var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (var i = 0; i < cur.nodes.length; i++) {
            var g = geomRef.current[cur.nodes[i].id];
            if (!g)
                continue;
            minX = Math.min(minX, g.x - g.w / 2);
            maxX = Math.max(maxX, g.x + g.w / 2);
            minY = Math.min(minY, g.y - g.h / 2);
            maxY = Math.max(maxY, g.y + g.h / 2);
        }
        for (var j = 0; j < groups.length; j++) {
            minX = Math.min(minX, groups[j].x);
            maxX = Math.max(maxX, groups[j].x + groups[j].w);
            minY = Math.min(minY, groups[j].y);
            maxY = Math.max(maxY, groups[j].y + groups[j].h);
        }
        if (!isFinite(minX))
            return null;
        var pad = 26;
        return {
            x: Math.round(minX - pad), y: Math.round(minY - pad),
            w: Math.ceil(maxX - minX + pad * 2), h: Math.ceil(maxY - minY + pad * 2),
        };
    }
    function exportSvg() {
        try {
            var box = contentBox();
            var world = svgRef.current && svgRef.current.querySelector('.ac-world');
            if (!box) {
                setStatus('画布是空的，没什么可导出');
                return;
            }
            if (!world) {
                setStatus('导出失败：找不到画布内容');
                return;
            }
            downloadBlob('architecture.svg', new Blob([buildExportSvg(world, box)], { type: 'image/svg+xml;charset=utf-8' }));
            setStatus('已导出 SVG（' + box.w + '×' + box.h + '）');
        }
        catch (e) {
            setStatus('导出 SVG 失败：' + msgOf(e));
        }
    }
    function exportPng() {
        try {
            var box = contentBox();
            var world = svgRef.current && svgRef.current.querySelector('.ac-world');
            if (!box) {
                setStatus('画布是空的，没什么可导出');
                return;
            }
            if (!world) {
                setStatus('导出失败：找不到画布内容');
                return;
            }
            setStatus('正在生成 PNG…');
            svgToPngBlob(buildExportSvg(world, box), box.w, box.h, 2).then(function (blob) {
                downloadBlob('architecture.png', blob);
                setStatus('已导出 PNG（' + box.w * 2 + '×' + box.h * 2 + '）');
            }).catch(function (e) { setStatus('导出 PNG 失败：' + msgOf(e)); });
        }
        catch (e) {
            setStatus('导出 PNG 失败：' + msgOf(e));
        }
    }
    function copySource() {
        var text = mermaidText || '';
        if (!text) {
            setStatus('还没有内容可复制');
            return;
        }
        function fallback() {
            setTab('text');
            setStatus('自动复制被拒，已切到「源码」标签，手动全选复制即可');
        }
        try {
            if (!navigator.clipboard) {
                fallback();
                return;
            }
            navigator.clipboard.writeText(text).then(function () {
                setStatus('已复制 Mermaid 源码（' + text.split('\n').length + ' 行）');
            }, fallback);
        }
        catch (e) {
            fallback();
        }
    }
    // ---------- 图库选择器：列图 / 切图 / 新建 / 改名 / 软删除 / 恢复 ----------
    // 图库跟着项目走（<项目>/.arch-canvas/），所以每个 RPC 都带 where=会话 cwd，
    // 界面与 AI 工具才会落在同一个项目图库上。
    function patchPicker(patch) {
        setPicker(function (prev) { return Object.assign({}, prev, patch); });
    }
    function closeLibrary() {
        patchPicker({ open: false, draft: '', pathDraft: '', focusPath: false, renameKey: '', renameDraft: '', confirmKey: '' });
    }
    // rescan 为真时让宿主忽略扫描间隔，立刻重扫（「重新扫描」按钮走这条）
    /**
     * 读一次图库清单（只更新数据，不打开面板）。
     * 起始页要在「用户还没点图库」的时候就列出项目里已有的图，所以这条路必须独立存在。
     * quiet 用于自动触发的场景：读不到就别去污染状态栏。
     */
    function refreshLibraryItems(rescan, quiet) {
        return rpc('doc:list', { where: cwdRef.current, session: sidRef.current, rescan: !!rescan }).then(function (r) {
            if (!r || !r.ok) {
                if (!quiet)
                    setStatus('读图库失败：' + String(r && r.error));
                patchPicker({ busy: false });
                return false;
            }
            patchPicker({ items: r.items || [], files: r.files || [], busy: false });
            setLibDir(r.dir || '');
            if (typeof r.libraryRev === 'number')
                libRevRef.current = r.libraryRev;
            return true;
        }).catch(function (e) {
            if (!quiet)
                setStatus('读图库失败：' + msgOf(e));
            patchPicker({ busy: false });
            return false;
        });
    }
    function loadLibrary(rescan) {
        patchPicker({ open: true, busy: true, draft: '' });
        refreshLibraryItems(rescan);
    }
    // 工具条上的「打开」：展开选择器并把光标放进路径输入框。
    // 入口只在选择器里的话，新用户根本找不到 —— 起始页上也会给同一个按钮。
    function openFilePicker() {
        patchPicker({ focusPath: true });
        loadLibrary(false);
    }
    // 按路径打开项目里的一个 mermaid 文件：此后画布编辑的就是这个文件本身
    function openPath(path, create) {
        var want = String(path == null ? '' : path).trim();
        if (!want) {
            setStatus('请填一个文件路径（绝对路径，或相对项目根）');
            return;
        }
        rpc('doc:openPath', { path: want, create: !!create, where: cwdRef.current, session: sidRef.current }).then(function (r) {
            if (!r || !r.ok) {
                setStatus('打开失败：' + String(r && r.error));
                return;
            }
            closeLibrary();
            applyServer(r, 'sync');
            fittedRef.current = false;
            setStatus((create ? '已新建并打开 ' : '已打开 ') + want);
        }).catch(function (e) { setStatus('打开失败：' + msgOf(e)); });
    }
    function openDiagram(key, create) {
        var want = String(key == null ? '' : key).trim();
        if (!want) {
            setStatus('先给新图起个名字');
            return;
        }
        rpc('doc:open', { key: want, create: !!create, where: cwdRef.current, session: sidRef.current }).then(function (r) {
            if (!r || !r.ok) {
                setStatus('切图失败：' + String(r && r.error));
                return;
            }
            closeLibrary();
            applyServer(r, 'sync'); // 换的是文档，不是编辑：历史由 applyServer 按切图清掉
            fittedRef.current = false;
            setStatus('已切到「' + want + '」');
        }).catch(function (e) { setStatus('切图失败：' + msgOf(e)); });
    }
    function renameDiagram(key) {
        var to = String(picker.renameDraft == null ? '' : picker.renameDraft).trim();
        if (!to) {
            setStatus('新名字不能为空');
            return;
        }
        rpc('doc:rename', { from: key, to: to, where: cwdRef.current, session: sidRef.current }).then(function (r) {
            if (!r || !r.ok) {
                setStatus('改名失败：' + String(r && r.error));
                return;
            }
            patchPicker({ renameKey: '', renameDraft: '' });
            if (r.model)
                applyServer(r, 'sync');
            loadLibrary();
            setStatus('已把「' + key + '」改名为「' + to + '」');
        }).catch(function (e) { setStatus('改名失败：' + msgOf(e)); });
    }
    function deleteDiagram(key) {
        rpc('doc:delete', { key: key, where: cwdRef.current, session: sidRef.current }).then(function (r) {
            if (!r || !r.ok) {
                setStatus('删除失败：' + String(r && r.error));
                return;
            }
            patchPicker({ confirmKey: '' });
            // 删的正好是当前这张时宿主已经换回默认图，回执里带着新文档
            if (r.model)
                applyServer(r, 'sync');
            loadLibrary();
            setStatus('已删除「' + key + '」（软删除：内容还在文件里，能恢复）');
        }).catch(function (e) { setStatus('删除失败：' + msgOf(e)); });
    }
    function restoreDiagram(key) {
        rpc('doc:restore', { key: key, where: cwdRef.current, session: sidRef.current }).then(function (r) {
            if (!r || !r.ok) {
                setStatus('恢复失败：' + String(r && r.error));
                return;
            }
            loadLibrary();
            setStatus('已恢复「' + key + '」');
        }).catch(function (e) { setStatus('恢复失败：' + msgOf(e)); });
    }
    // 下钻角标：节点带 @link 时点它跳到那张图 —— 「一个节点展开成一张图」的入口
    function onJumpDown(e, key) {
        if (e.button !== 0)
            return;
        e.stopPropagation();
        e.preventDefault();
        openDiagram(key, false);
    }
    function applyDraft() {
        rpc('doc:applyText', { text: draft, where: cwdRef.current, session: sidRef.current }).then(function (r) {
            if (!r || !r.ok) {
                setRenderError(String(r && r.error));
                setStatus('源码未能解析: ' + String(r && r.error));
                return;
            }
            setRenderError('');
            applyServer(r, 'local');
            fittedRef.current = false;
            setStatus('已从源码重建画布');
        }).catch(function (e) {
            var err = msgOf(e);
            setRenderError(err);
            setStatus('应用失败：' + err);
        });
    }
    function saveToFile() {
        rpc('doc:file', { path: filePath, save: true, where: cwdRef.current, session: sidRef.current }).then(function (r) {
            if (r && r.saved)
                setStatus('已写入 ' + filePath);
            else
                setStatus('写盘失败：' + String(r && r.error));
        }).catch(function (e) { setStatus('写盘失败：' + msgOf(e)); });
    }
    React.useEffect(function () {
        if (tab !== 'preview')
            return;
        var cancelled = false;
        (async function () {
            try {
                var api = await ensureMermaid();
                if (cancelled)
                    return;
                if (!mermaidInited) {
                    api.initialize({ startOnLoad: false, securityLevel: 'loose', theme: 'neutral', suppressErrorRendering: true });
                    mermaidInited = true;
                }
                var id = 'acmmd' + Math.floor(Math.random() * 1e9).toString(36);
                var src = (mermaidText || '').trim() || 'flowchart TD\n  empty["（画布为空）"]';
                var res = await api.render(id, src);
                if (cancelled)
                    return;
                setSvg(res && res.svg ? res.svg : '');
                setRenderError('');
            }
            catch (e) {
                if (cancelled)
                    return;
                setRenderError(msgOf(e));
            }
        })();
        return function () { cancelled = true; };
    }, [tab, mermaidText]);
    var nodeSel = null;
    if (sel && sel.kind === 'node' && model) {
        for (var si = 0; si < model.nodes.length; si++)
            if (model.nodes[si].id === sel.id)
                nodeSel = model.nodes[si];
    }
    var edgeSel = null;
    if (sel && sel.kind === 'edge' && model) {
        for (var sei = 0; sei < model.edges.length; sei++) {
            if (model.edges[sei].from === sel.from && model.edges[sei].to === sel.to) {
                edgeSel = model.edges[sei];
                break;
            }
        }
    }
    // ---------- SVG 画布 ----------
    var canvasKids = [];
    canvasKids.push(React.createElement('defs', { key: 'defs' }, React.createElement('marker', { id: 'ac-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, React.createElement('path', { d: 'M 0 0 L 10 5 L 0 10 z', className: 'ac-arrowhead' }))));
    var inner = [];
    for (var gi = 0; gi < groups.length; gi++) {
        var gb = groups[gi];
        var fg = foldGeom[gb.id];
        var openFold = (function (gid) { return function (ev) { ev.stopPropagation(); toggleGroup(gid); }; })(gb.id);
        if (fg) {
            // 折叠态：一个块 + 一个**独立的**展开按钮。
            // 折叠/展开只挂在按钮上，块本体不响应 —— 组块长得像个节点，点它多半是想选中或拖它，
            // 顺手把它弹开是最烦的那种误触。
            inner.push(React.createElement('g', {
                key: 'g' + gb.id, className: 'ac-fold',
                // 折叠块整块可拖（拖的是组内所有人）—— 但**拖不等于展开**，展开只认右边那个按钮。
                onPointerDown: (function (gid) { return function (ev) { onGroupDown(ev, gid); }; })(gb.id),
            }, React.createElement('rect', { className: 'ac-fold-box', x: fg.x - fg.w / 2, y: fg.y - fg.h / 2, width: fg.w, height: fg.h, rx: 10 }), React.createElement('text', { className: 'ac-fold-lbl', x: fg.x, y: fg.y }, fg.label), React.createElement('g', {
                className: 'ac-fold-btn',
                transform: 'translate(' + (fg.x + fg.w / 2 - 13) + ',' + fg.y + ')',
                onPointerDown: openFold,
            }, React.createElement('circle', { r: 9 }), React.createElement('text', { y: 3.6 }, '▸'))));
        }
        else {
            inner.push(React.createElement('g', { key: 'g' + gb.id }, React.createElement('rect', { className: 'ac-group-box', x: gb.x, y: gb.y, width: gb.w, height: gb.h, rx: 12 }), React.createElement('text', { className: 'ac-group-lbl', x: gb.x + 12, y: gb.y + 17 }, String(gb.label == null ? gb.id : gb.label)), 
            // 收起按钮：同样只挂在按钮上 —— 点组名、点组内空白都不动。
            React.createElement('g', {
                className: 'ac-group-btn',
                transform: 'translate(' + (gb.x + gb.w - 14) + ',' + (gb.y + 14) + ')',
                onPointerDown: openFold,
            }, React.createElement('circle', { r: 9 }), React.createElement('text', { y: 3.6 }, '▾'))));
        }
    }
    if (model) {
        // 连线要避让**其它可见方块**。一律取 visGeom：被折叠收起的节点会映射到组块几何上，
        // 于是"藏在块里的东西"天然不会挡路。按几何对象去重（折叠组里多个节点共用一个几何）。
        var visList = [];
        var visSeen = [];
        for (var vi = 0; vi < model.nodes.length; vi++) {
            var vg = visGeom(model.nodes[vi].id);
            if (!vg || visSeen.indexOf(vg) >= 0)
                continue;
            visSeen.push(vg);
            visList.push(vg);
        }
        // 同一对节点之间的多条线要错开，否则会完全重叠成一条（有向还是无向都按同一对算）。
        var pairCount = {};
        for (var pi = 0; pi < model.edges.length; pi++) {
            var pe = model.edges[pi];
            var pk = pe.from < pe.to ? pe.from + '|' + pe.to : pe.to + '|' + pe.from;
            pairCount[pk] = (pairCount[pk] || 0) + 1;
        }
        // 端口分配：同一侧的 N 根线不能全挤在边心 —— 那就是"箭头叠在一起"。
        // 按**对端方向**给同一侧的线排序再平分该侧；顺序反了的话线会在方块附近互相交叉。
        // 判据是「可用边长 / 箭头宽」，**与缩放无关**：线宽与箭头都随画布变换缩放，两者比值恒定，
        // 所以放大缩小不会改变"叠不叠"这件事（实测：CSS 里没有任何 non-scaling-stroke）。
        var sideGroups = {};
        for (var gi = 0; gi < model.edges.length; gi++) {
            var ge = model.edges[gi];
            if (foldMap[ge.from] && foldMap[ge.from] === foldMap[ge.to])
                continue;
            var ga2 = visGeom(ge.from);
            var gb2 = visGeom(ge.to);
            if (!ga2 || !gb2)
                continue;
            for (var gend = 0; gend < 2; gend++) {
                var gme = gend === 0 ? ga2 : gb2;
                var got = gend === 0 ? gb2 : ga2;
                var gvert = Math.abs(got.y - gme.y) >= Math.abs(got.x - gme.x);
                var gside = gvert ? (got.y >= gme.y ? 'b' : 't') : (got.x >= gme.x ? 'r' : 'l');
                // 端口按**可见单元**分组 —— 被折叠的组里，好几个成员节点连到外面时都挂在
                // 同一个折叠块上，用原始节点 id 当 key 会把它们拆成 n=1 的小组，
                // edgePortOffset 于是全部返回 0，箭头全叠在块边中心（审计第 5 条）。
                var gunit = gend === 0 ? ge.from : ge.to;
                var gkey = (foldMap[gunit] || gunit) + '|' + gside;
                if (!sideGroups[gkey])
                    sideGroups[gkey] = [];
                sideGroups[gkey].push({ ei: gi, end: gend, at: gvert ? got.x : got.y });
            }
        }
        var portSlots = {};
        for (var sk in sideGroups) {
            var sArr = sideGroups[sk];
            sArr.sort(function (x, y) { return x.at - y.at; });
            for (var si2 = 0; si2 < sArr.length; si2++) {
                portSlots[sArr[si2].ei + ':' + sArr[si2].end] = { n: sArr.length, i: si2 };
            }
        }
        // 连线分三趟画，因为「平行间隔」和「交叉处弯折」都是**线与线之间**的关系，
        // 一条线画的时候还不知道后面那条会落在哪：
        //   第一趟 布线：逐条算出尖角折线，并把它占掉的车道记进 usedLanes —— 后来的线自己让开；
        //   第二趟 找交叉：两两求正交交点，**后画的线**在交点上拱一下（用户要的「十字交叉弯折一下」）；
        //   第三趟 出 d：把拱桥交给 edgeCleanPath 一起画。
        var usedLanes = [];
        var pairSeen = {};
        var routed = [];
        for (var ei = 0; ei < model.edges.length; ei++) {
            var red = model.edges[ei];
            // 两端落在同一个折叠组里 → 那是组内的内部关系，收起来就该一起收掉。
            // 留一条穿进块里的线会把「有东西被藏起来了」变成误导。
            if (foldMap[red.from] && foldMap[red.from] === foldMap[red.to])
                continue;
            var rek = red.from < red.to ? red.from + '|' + red.to : red.to + '|' + red.from;
            var ren = pairCount[rek] || 1;
            var reidx = pairSeen[rek] || 0;
            pairSeen[rek] = reidx + 1;
            var rgeo = edgeGeometry(visGeom(red.from), visGeom(red.to), visList, ren > 1 ? (reidx - (ren - 1) / 2) * 10 : 0, { a: portSlots[ei + ':0'], b: portSlots[ei + ':1'] }, usedLanes);
            if (!rgeo)
                continue;
            var rlanes = rgeo.lanes || [];
            for (var rl = 0; rl < rlanes.length; rl++)
                usedLanes.push(rlanes[rl]);
            routed.push({ ei: ei, ed: red, geo: rgeo, hops: [] });
        }
        // 交叉检测：一根横线 × 一根竖线，交点必须落在**两段各自的内部**（端点贴边不算交叉）。
        // 后来的线拱过去，先画的直走 —— 规则固定，所以同一张图每次画出来都一样。
        for (var ca = 0; ca < routed.length; ca++) {
            var pa = routed[ca].geo.pts;
            for (var cb = ca + 1; cb < routed.length; cb++) {
                var pb = routed[cb].geo.pts;
                for (var sa = 0; sa + 1 < pa.length; sa++) {
                    var a1 = pa[sa], a2 = pa[sa + 1];
                    var aVert = Math.abs(a1.x - a2.x) < 0.5;
                    if (Math.abs(a1.x - a2.x) > 0.5 && Math.abs(a1.y - a2.y) > 0.5)
                        continue;
                    for (var sb = 0; sb + 1 < pb.length; sb++) {
                        var b1 = pb[sb], b2 = pb[sb + 1];
                        var bVert = Math.abs(b1.x - b2.x) < 0.5;
                        if (aVert === bVert)
                            continue;
                        if (Math.abs(b1.x - b2.x) > 0.5 && Math.abs(b1.y - b2.y) > 0.5)
                            continue;
                        var hor = aVert ? { p: b1, q: b2 } : { p: a1, q: a2 };
                        var ver = aVert ? { p: a1, q: a2 } : { p: b1, q: b2 };
                        var hx1 = Math.min(hor.p.x, hor.q.x), hx2 = Math.max(hor.p.x, hor.q.x);
                        var hy1 = Math.min(ver.p.y, ver.q.y), hy2 = Math.max(ver.p.y, ver.q.y);
                        var hy = hor.p.y, vx = ver.p.x;
                        if (vx > hx1 + 3 && vx < hx2 - 3 && hy > hy1 + 3 && hy < hy2 - 3) {
                            routed[cb].hops.push({ x: vx, y: hy });
                        }
                    }
                }
            }
        }
        for (var ri = 0; ri < routed.length; ri++) {
            var rt = routed[ri];
            var red2 = rt.ed;
            var rpath = rt.hops.length
                ? edgeCleanPath(rt.geo.pts, rt.hops)
                : { d: rt.geo.d, pts: rt.geo.pts };
            var dashed = red2.arrow === '-.->';
            var isEdgeSel = sel && sel.kind === 'edge' && sel.from === red2.from && sel.to === red2.to;
            var cls = 'ac-edge' + (dashed ? ' dashed' : '') + (isEdgeSel ? ' sel' : '');
            var mk = arrowMarkerRef(red2.arrow);
            inner.push(React.createElement('g', { key: 'e' + red2.from + '-' + red2.to + '-' + rt.ei }, React.createElement('path', { className: 'ac-edge-hit', d: rpath.d, onPointerDown: (function (efrom, eto) { return function (ev) { onEdgeDown(ev, efrom, eto); }; })(red2.from, red2.to) }), React.createElement('path', { className: cls, d: rpath.d, markerEnd: mk || undefined }), red2.label ? React.createElement('g', { key: 'el' }, React.createElement('rect', { className: 'ac-elbl-bg', x: rt.geo.mid.x - Math.max(12, visualLen(red2.label) * 3.3), y: rt.geo.mid.y - 9, width: Math.max(24, visualLen(red2.label) * 6.6), height: 17, rx: 5 }), React.createElement('text', { className: 'ac-elbl', x: rt.geo.mid.x, y: rt.geo.mid.y }, red2.label)) : null));
        }
        for (var ni = 0; ni < model.nodes.length; ni++) {
            var node = model.nodes[ni];
            // 被收起来的组，成员节点整个不画（几何仍在 gstate 里，展开时立刻回来）。
            if (foldMap[node.id])
                continue;
            var gm = gstate[node.id];
            if (!gm)
                continue;
            var isSel = sel && sel.kind === 'node' && sel.id === node.id;
            var kind = kindOf(node.shape);
            var shapeEl;
            var x0 = gm.x - gm.w / 2;
            var y0 = gm.y - gm.h / 2;
            if (kind === 'diamond') {
                shapeEl = React.createElement('polygon', { className: 'ac-shape', points: gm.x + ',' + y0 + ' ' + (gm.x + gm.w / 2) + ',' + gm.y + ' ' + gm.x + ',' + (y0 + gm.h) + ' ' + (gm.x - gm.w / 2) + ',' + gm.y });
            }
            else if (kind === 'hex') {
                shapeEl = React.createElement('polygon', { className: 'ac-shape', points: (x0 + 14) + ',' + y0 + ' ' + (x0 + gm.w - 14) + ',' + y0 + ' ' + (x0 + gm.w) + ',' + gm.y + ' ' + (x0 + gm.w - 14) + ',' + (y0 + gm.h) + ' ' + (x0 + 14) + ',' + (y0 + gm.h) + ' ' + x0 + ',' + gm.y });
            }
            else if (kind === 'ellipse') {
                shapeEl = React.createElement('ellipse', { className: 'ac-shape', cx: gm.x, cy: gm.y, rx: gm.w / 2, ry: gm.h / 2 });
            }
            else if (kind === 'cyl') {
                shapeEl = React.createElement('rect', { className: 'ac-shape', x: x0, y: y0, width: gm.w, height: gm.h, rx: gm.h / 2 });
            }
            else {
                var rx2 = kind === 'rect' ? 9 : gm.h / 2;
                shapeEl = React.createElement('rect', { className: 'ac-shape', x: x0, y: y0, width: gm.w, height: gm.h, rx: rx2 });
            }
            // 节点**永远只画标题**：描述与引用行都不在画布上画，一律去检查器里看。
            // 这里刻意保留 descLines / refText 两个空值，下面那段 JSX 就不用动
            // （它们为空时 descEl / refEl 自然就是 null）。
            var lines = String(node.label == null ? '' : node.label).split('\n');
            var descLines = [];
            var refText = '';
            var rows = 1;
            var spanStart = -((rows - 1) * 19) / 2;
            // 标题必须是 .ac-lbl 的**全部**文本：测试与用户都靠它认节点。
            var titleEl = React.createElement('text', { className: 'ac-lbl' }, React.createElement('tspan', { key: 't0', x: gm.x, y: gm.y + spanStart }, lines.length > 0 ? lines[0] : ''));
            var descEl = descLines.length > 0 ? React.createElement('text', { className: 'ac-desc' }, descLines.map(function (ln, di) {
                // 前缀是**惯例**：写了就分层着色，没写就是普通描述（老图因此可以渐进迁移）。
                var cls = /^\s*意图\s*[：:]/.test(ln) ? 'ac-intent' : (/^\s*原理\s*[：:]/.test(ln) ? 'ac-rationale' : '');
                return React.createElement('tspan', {
                    key: 'd' + di, x: gm.x, y: gm.y + spanStart + (di + 1) * 19,
                    className: cls || undefined,
                }, ln);
            })) : null;
            var refEl = refText ? React.createElement('text', { className: 'ac-ref' }, React.createElement('tspan', { key: 'r0', x: gm.x, y: gm.y + spanStart + lines.length * 19 }, refText)) : null;
            var isHl = !!(highlight && highlight.nodes && highlight.nodes.indexOf(node.id) >= 0);
            inner.push(React.createElement('g', {
                key: 'n' + node.id,
                className: 'ac-node' + (isSel ? ' sel' : '') + (isHl ? ' hl' : ''),
                onPointerDown: (function (nd) { return function (ev) { onNodeDown(ev, nd); }; })(node),
            }, 
            // key 里带 highlight.key：新一轮改动会强制重挂，动画才会重新播
            isHl ? React.createElement('rect', {
                key: 'hl' + highlight.key,
                className: 'ac-pulse',
                x: x0 - 7, y: y0 - 7, width: gm.w + 14, height: gm.h + 14, rx: 13,
            }) : null, shapeEl, titleEl, descEl, refEl, 
            // 下钻角标：带 @link 的节点点它跳到那张图
            node.link ? React.createElement('g', {
                key: 'jump', className: 'ac-jump',
                transform: 'translate(' + (gm.x + gm.w / 2 - 8) + ',' + (y0 + 9) + ')',
                onPointerDown: (function (key) { return function (ev) { onJumpDown(ev, key); }; })(node.link),
            }, React.createElement('circle', { r: 8.5 }), React.createElement('text', { y: 3.6 }, '↗')) : null, 
            // 留言角标：没留言的节点什么都不画。未解决=琥珀色笔，已解决=灰底勾（和清单里的两区一致）。
            node.note ? React.createElement('g', {
                key: 'note',
                className: 'ac-note-badge' + (node.noteDone ? ' done' : ''),
                transform: 'translate(' + (x0 + 9) + ',' + (y0 + 9) + ')',
            }, React.createElement('circle', { r: 8.5 }), React.createElement('text', { y: 3.6 }, node.noteDone ? '✓' : '✎')) : null, 
            // 代码锚点角标：右下角，仅当 node.files && node.files.length > 0 时渲染
            node.files && node.files.length > 0 ? (function () {
                var nStatus = (fileStatusRef.current && fileStatusRef.current[node.id]) || {};
                var isBroken = false;
                for (var fi2 = 0; fi2 < node.files.length; fi2++) {
                    var fRef = node.files[fi2];
                    var fSt = nStatus[fRef] || 'unknown';
                    if (fSt !== 'ok') {
                        isBroken = true;
                        break;
                    }
                }
                return React.createElement('g', {
                    key: 'file-badge',
                    className: 'ac-file-badge' + (isBroken ? ' broken' : ''),
                    transform: 'translate(' + (gm.x + gm.w / 2 - 9) + ',' + (y0 + gm.h - 9) + ')',
                }, React.createElement('circle', { r: 8.5 }), React.createElement('text', { y: 3.6 }, '▤'));
            })() : null, isSel ? React.createElement('circle', {
                className: 'ac-handle', cx: gm.x + gm.w / 2 + 10, cy: gm.y, r: 6,
                onPointerDown: (function (nd) { return function (ev) { onHandleDown(ev, nd); }; })(node),
            }) : null));
        }
    }
    if (linkPt) {
        inner.push(React.createElement('circle', { key: 'lp', className: 'ac-link-preview', cx: linkPt.x, cy: linkPt.y, r: 7 }));
    }
    // 吸附参考线画在最上层：只在拖拽且真吸上时出现，是「你正贴到这条线」的即时反馈。
    // 它不进模型也不进文件，松手就没了。
    if (dragHint) {
        if (dragHint.gx != null) {
            inner.push(React.createElement('line', { key: 'snapline-x', className: 'ac-snapline', x1: dragHint.gx, y1: -99999, x2: dragHint.gx, y2: 99999 }));
        }
        if (dragHint.gy != null) {
            inner.push(React.createElement('line', { key: 'snapline-y', className: 'ac-snapline', x1: -99999, y1: dragHint.gy, x2: 99999, y2: dragHint.gy }));
        }
    }
    canvasKids.push(React.createElement('g', {
        key: 'world',
        className: 'ac-world',
        transform: 'translate(' + view.x + ',' + view.y + ') scale(' + view.k + ')',
    }, inner));
    var stage = React.createElement('div', { className: 'ac-stage', ref: hostRef }, React.createElement('svg', {
        ref: svgRef,
        className: 'ac-svg',
        onPointerDown: onBackgroundDown,
        onPointerMove: onPointerMove,
        onPointerUp: onPointerUp,
        onPointerCancel: onPointerUp,
        onLostPointerCapture: onLostPointerCapture,
    }, canvasKids), 
    // 空画布 = 起始页（跟常见软件一样：给出路，而不是一片空白）。
    // 这里直接把「这个项目里已有的图」和「外面散落的 mermaid 文件」列出来，点一下就能进。
    model && model.nodes.length === 0
        ? React.createElement('div', { className: 'ac-start' }, React.createElement('div', { className: 'ac-start-title' }, '这张图还是空的'), React.createElement('div', { className: 'ac-start-actions' }, React.createElement('button', { className: 'ac-btn primary', onClick: addNode }, '＋ 加一个节点'), React.createElement('button', { className: 'ac-btn', onClick: openFilePicker }, '打开文件…'), React.createElement('button', { className: 'ac-btn', onClick: function () { loadLibrary(false); } }, '图库…')), libItems.length > 0
            ? React.createElement('div', { className: 'ac-start-list' }, React.createElement('div', { className: 'ac-start-head' }, '这个项目里的图'), libItems.filter(function (it) { return !it.deleted && it.key !== libKey; }).map(function (it) {
                return React.createElement('div', { key: 's' + it.key, className: 'ac-start-row' }, React.createElement('span', { className: 'ac-start-key', title: it.dir }, it.key), React.createElement('span', { className: 'ac-start-meta' }, it.nodes + ' 节点 / ' + it.edges + ' 连线'), it.summary ? React.createElement('span', { className: 'ac-start-sum', title: it.summary }, it.summary) : null, React.createElement('button', { className: 'ac-btn', onClick: function () { openDiagram(it.key, false); } }, '打开'));
            }))
            : null, libFiles.length > 0
            ? React.createElement('div', { className: 'ac-start-list' }, React.createElement('div', { className: 'ac-start-head' }, '项目里的 mermaid 文件'), libFiles.slice(0, 6).map(function (f) {
                return React.createElement('div', { key: 'f' + f.path, className: 'ac-start-row' }, React.createElement('span', { className: 'ac-start-key', title: f.path }, f.rel), React.createElement('span', { className: 'ac-start-meta' }, Math.max(1, Math.round((f.bytes || 0) / 1024)) + ' KB'), React.createElement('button', { className: 'ac-btn', onClick: function () { openPath(f.path, false); } }, '打开'));
            }))
            : null, libItems.length === 0 && libFiles.length === 0
            ? React.createElement('div', { className: 'ac-hint' }, '这个项目里还没有图。用「＋ 加一个节点」起手，或让 AI 画一版初稿。')
            : null)
        : null);
    // 解析警告：宿主每条响应都带着 warnings，但从前界面一处都没读 ——
    // 「图悄悄少了一块」这件事，人和 AI 都看不见。这里列出来，最多 12 条，其余提示看日志。
    var warnBox = warnings.length > 0 ? React.createElement('div', { className: 'ac-warn' }, React.createElement('div', { className: 'ac-warn-h' }, '⚠ 解析警告 ' + warnings.length + ' 条 —— 图可能少了一块'), warnings.slice(0, 12).map(function (w, wi) {
        return React.createElement('div', { key: 'w' + wi, className: 'ac-warn-i' }, String(w));
    }), warnings.length > 12 ? React.createElement('div', { className: 'ac-warn-i' }, '…还有 ' + (warnings.length - 12) + ' 条，全部在日志里') : null) : null;
    // 源码页：两层都不滚动，滚动口是 .ac-textwrap（见 runtime.ts 的 STUDIO_CSS）。
    // 从前这里挂着一个 onScroll 把 textarea 的 scrollTop 灌给 <pre> —— 两个滚动口互相同步，
    // 注定会错位，而错位的观感就是「文字变白 / 一片空白」。现在不需要同步，也就没有可错位的东西。
    var hlLines = String(draft == null ? '' : draft).split('\n').map(function (ln, li) {
        var toks = tokenizeMermaidLine(ln);
        var kids = [];
        for (var ti = 0; ti < toks.length; ti++) {
            var tk = toks[ti];
            kids.push(tk.k ? React.createElement('span', { key: 'k' + ti, className: 'ac-hl-' + tk.k }, tk.s) : tk.s);
        }
        return React.createElement('div', { key: 'L' + li }, kids.length ? kids : '\u00a0');
    });
    var textPane = React.createElement('div', { className: 'ac-textwrap', ref: textWrapRef }, React.createElement('div', { className: 'ac-hint' }, '这段 Mermaid 就是 AI 看到的全部内容。可以直接改，然后点「应用回画布」。%% @pos 行是坐标注释，删掉只会让节点重新自动布局。'), renderError ? React.createElement('div', { className: 'ac-err' }, '源码解析报错：\n' + renderError) : null, warnBox, React.createElement('div', { className: 'ac-editwrap' }, React.createElement('pre', { className: 'ac-hl', ref: hlRef, 'aria-hidden': 'true' }, hlLines), React.createElement('textarea', {
        className: 'ac-area ac-area-hl', ref: taRef, value: draft, spellCheck: false,
        onChange: function (e) { setDraft(e.target.value); },
    })));
    var previewPane = React.createElement('div', { className: 'ac-previewwrap' }, renderError ? React.createElement('div', { className: 'ac-err' }, 'Mermaid 渲染报错（画布本身仍可用）：\n' + renderError) : null, React.createElement('div', { className: 'ac-preview', dangerouslySetInnerHTML: { __html: svg || '<div style="color:#666;font-family:system-ui">正在加载 Mermaid 渲染器…</div>' } }));
    // ---------- 节点留言清单（未解决在前，已解决在后） ----------
    // 派生值必须在这里算完：下面的 return 是一个整体表达式，声明晚一步就是 undefined
    // （面板渲染崩溃的老坑，见 AGENTS.md「stage 这类 JSX 在 return 之前就构造好了」）。
    var noteListOpen = [];
    var noteListDone = [];
    if (model && model.nodes) {
        for (var nq = 0; nq < model.nodes.length; nq++) {
            var nnode = model.nodes[nq];
            if (!nnode.note)
                continue;
            if (nnode.noteDone)
                noteListDone.push(nnode);
            else
                noteListOpen.push(nnode);
        }
    }
    // 总量（含已解决）：按钮上那个数字以前只有待办数，读起来像「统计漏了已解决的」。
    var noteTotal = noteListOpen.length + noteListDone.length;
    function noteRow(nd, isDone) {
        return React.createElement('div', { key: (isDone ? 'd' : 'o') + nd.id, className: 'ac-lib-row' }, React.createElement('button', {
            className: 'ac-lib-item' + (isDone ? ' done' : ''),
            title: '定位到这个节点',
            onClick: function () { focusNode(nd.id); },
        }, (isDone ? '✓ ' : '✎ ') + nd.id + '　' + String(nd.label || '').replace(/\n/g, ' ')
            + '　·　' + String(nd.note).replace(/\n/g, ' ')), React.createElement('button', {
            className: 'ac-btn',
            onClick: function () { markNote(!isDone, nd.id); },
        }, isDone ? '重开' : '已解决'));
    }
    var notePanel = notesOpen ? React.createElement('div', { className: 'ac-lib ac-notes' }, React.createElement('div', { className: 'ac-lib-head' }, React.createElement('span', { className: 'grow' }, '节点留言：共 ' + noteTotal + ' 条 —— ' + noteListOpen.length + ' 条待办'
        + (noteListDone.length ? '，' + noteListDone.length + ' 条已解决' : '')
        + '　·　未解决的每一步都会进入 AI 的上下文，已解决的不会'), (inputActions && typeof inputActions.setDraft === 'function' && noteListOpen.length > 0)
        ? React.createElement('button', {
            className: 'ac-btn primary',
            title: '把所有未完成留言打包填入聊天输入框',
            onClick: function () {
                var diagName = (external ? externalName : (libKey || currentDiagramRef.current)) || 'architecture';
                var lines = [
                    '关于画布「' + diagName + '」上的 ' + noteListOpen.length + ' 条留言，请逐条回应（点名节点 id）：',
                    '',
                ];
                for (var bi = 0; bi < noteListOpen.length; bi++) {
                    var bn = noteListOpen[bi];
                    var sp = splitLabel(bn.label);
                    var title = sp.title || bn.id;
                    var cleanNote = String(bn.note || '').replace(/\r?\n/g, ' / ');
                    lines.push((bi + 1) + '. `' + bn.id + '`（' + title + '）：' + cleanNote);
                }
                var batchText = lines.join('\n');
                inputActions.setDraft(batchText);
                setStatus('已把 ' + noteListOpen.length + ' 条留言填入聊天输入框，回车发送');
            },
        }, '发送这一轮留言 (' + noteListOpen.length + ')')
        : null, React.createElement('button', { className: 'ac-btn', onClick: function () { setNotesOpen(false); } }, '收起')), noteListOpen.length === 0
        ? React.createElement('div', { className: 'ac-hint' }, '没有未解决的留言。点一个节点，在下方检查器里就能写。')
        : null, noteListOpen.map(function (nd) { return noteRow(nd, false); }), noteListDone.length > 0
        ? React.createElement('div', { className: 'ac-hint' }, '已解决（不再注入给 AI）：')
        : null, noteListDone.map(function (nd) { return noteRow(nd, true); })) : null;
    // ---------- 检查点清单（每次落盘一份，点一下退回） ----------
    // 与留言清单同一套 .ac-lib 外壳；区别是这里的数据来自 doc:history（宿主内存里的快照），
    // 不是从模型派生的 —— 所以有 busy / 拉取失败这两个状态要如实显示。
    var histByLabel = { ai: 'AI', user: '用户', open: '打开', switch: '切换', init: '初始' };
    function histTime(at) {
        try {
            var d = new Date(at);
            var p = function (n) { return (n < 10 ? '0' : '') + n; };
            return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
        }
        catch (e) {
            return '';
        }
    }
    var histPanel = hist.open ? React.createElement('div', { className: 'ac-lib ac-hist' }, React.createElement('div', { className: 'ac-lib-head' }, React.createElement('span', { className: 'grow' }, '检查点：' + hist.entries.length + ' 份'
        + '　·　每次落盘留一份（标明谁改的），点「退回」把图恢复成那一刻。只在内存里，重启 dsh 会清空'), React.createElement('button', { className: 'ac-btn', onClick: function () { loadHistory(); } }, '刷新'), React.createElement('button', { className: 'ac-btn', onClick: function () { patchHist({ open: false }); } }, '收起')), hist.busy ? React.createElement('div', { className: 'ac-hint' }, '正在读检查点…') : null, !hist.busy && hist.entries.length === 0
        ? React.createElement('div', { className: 'ac-hint' }, '还没有检查点。你和 AI 每改一次图都会留下一个。')
        : null, hist.entries.map(function (e) {
        var who = histByLabel[e.by] || e.by;
        var meta = '修订 ' + e.rev + '　' + e.nodeCount + ' 节点 / ' + e.edgeCount + ' 连线　' + histTime(e.at);
        return React.createElement('div', { key: 'h' + e.seq, className: 'ac-lib-row' }, React.createElement('span', {
            className: 'ac-hist-item' + (e.current ? ' on' : '') + (e.by === 'ai' ? ' ai' : ''),
            title: (e.site ? e.site + '　' : '') + (e.changed && e.changed.length ? '涉及：' + e.changed.join('、') : ''),
        }, (e.current ? '● ' : '') + who + '　' + meta
            + (e.changed && e.changed.length ? '　·　' + e.changed.slice(0, 4).join('、') + (e.changed.length > 4 ? ' 等' : '') : '')), e.current
            ? React.createElement('span', { className: 'ac-hist-cur' }, '当前')
            : (hist.confirmSeq === e.seq
                ? [
                    React.createElement('button', { key: 'yes', className: 'ac-btn primary', onClick: function () { rollbackTo(e.seq); } }, '确认退回'),
                    React.createElement('button', { key: 'no', className: 'ac-btn', onClick: function () { patchHist({ confirmSeq: 0 }); } }, '取消'),
                ]
                : React.createElement('button', {
                    className: 'ac-btn',
                    onClick: function () { patchHist({ confirmSeq: e.seq }); },
                }, '退回')));
    })) : null;
    // ---------- 底部检查器（点选后才展开，拖动中不弹） ----------
    var dock = null;
    if (nodeSel && dockOpen) {
        dock = React.createElement('div', { className: 'ac-dock' }, React.createElement('h4', null, '节点 ' + nodeSel.id), React.createElement('div', { className: 'ac-grid' }, React.createElement('div', { className: 'ac-field full' }, React.createElement('label', null, '标题（回车生效）'), React.createElement('input', {
            className: 'ac-input', value: labelDraft, placeholder: '这个元素是什么',
            onChange: function (e) { setLabelDraft(e.target.value); },
            onBlur: commitLabel,
            onKeyDown: function (e) { if (e.key === 'Enter') {
                e.preventDefault();
                commitLabel();
            } },
        })), React.createElement('div', { className: 'ac-field full' }, React.createElement('label', null, '描述（回车生效，Shift+回车换行）'), React.createElement('textarea', {
            className: 'ac-input', style: { height: 54, resize: 'vertical', fontFamily: 'inherit' },
            placeholder: '意图：想达成什么　/　原理：为什么这么设计',
            value: descDraft,
            onChange: function (e) { setDescDraft(e.target.value); },
            onBlur: commitLabel,
            onKeyDown: function (e) { if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                commitLabel();
            } },
        })), React.createElement('div', { className: 'ac-field' }, React.createElement('label', null, '形状'), React.createElement('select', { className: 'ac-select', value: nodeSel.shape, onChange: function (e) { setShape(e.target.value); } }, ['rect', 'round', 'stadium', 'circle', 'diamond', 'cyl', 'hex', 'sub'].map(function (k) {
            return React.createElement('option', { key: k, value: k }, k);
        }))), React.createElement('div', { className: 'ac-field' }, React.createElement('label', null, '分组（留空=不分组）'), React.createElement('input', { className: 'ac-input', value: groupDraft, onChange: function (e) { setGroupDraft(e.target.value); }, onBlur: commitGroup, onKeyDown: function (e) { if (e.key === 'Enter')
                commitGroup(); } })), React.createElement('div', { className: 'ac-field full' }, React.createElement('label', null, noteDraft
            ? (noteDoneDraft ? '留言（已解决 —— 不再注入给 AI）' : '留言（会随每一步进入 AI 的上下文）')
            : '留言（写给 AI：这里的疑问 / 要求 / 背景）'), React.createElement('textarea', {
            className: 'ac-input', style: { height: 54, resize: 'vertical', fontFamily: 'inherit' },
            placeholder: '例如：这里为什么不用队列？　/　这条链路还没定，先别改',
            value: noteDraft,
            onChange: function (e) { setNoteDraft(e.target.value); },
            onBlur: commitNote,
            onKeyDown: function (e) { if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                commitNote();
            } },
        }), noteDraft
            ? React.createElement('div', { className: 'ac-note-actions' }, React.createElement('button', {
                className: 'ac-btn' + (noteDoneDraft ? '' : ' primary'),
                title: noteDoneDraft ? '重新打开：又会被注入给 AI' : '标记已解决：不再注入给 AI',
                onClick: function () { markNote(!noteDoneDraft); },
            }, noteDoneDraft ? '重新打开' : '标记已解决'), (inputActions && typeof inputActions.setDraft === 'function')
                ? React.createElement('button', {
                    className: 'ac-btn',
                    title: '把这条留言连同节点信息填入聊天输入框',
                    disabled: !String(noteDraft || '').trim(),
                    onClick: function () {
                        var text = formatNodeForModel(Object.assign({}, nodeSel, {
                            label: labelDraft,
                            note: String(noteDraft || '').trim(),
                            noteDone: noteDoneDraft === true,
                            files: (function () {
                                var raw = String(filesDraft || '').split('\n');
                                var arr = [];
                                for (var fi = 0; fi < raw.length; fi++) {
                                    var line = raw[fi].trim();
                                    if (line)
                                        arr.push(line);
                                }
                                return arr;
                            })(),
                        }));
                        inputActions.setDraft(text);
                        setStatus('已填入聊天输入框，回车发送');
                    },
                }, '发送给 AI')
                : null)
            : null), React.createElement('div', { className: 'ac-field full' }, React.createElement('label', null, '代码锚点（每行一个：路径 或 路径#符号）'), React.createElement('textarea', {
            className: 'ac-input', style: { height: 54, resize: 'vertical', fontFamily: 'inherit' },
            placeholder: '例如：src/host/mermaid.ts　/　src/client/runtime.ts#cloneModel',
            value: filesDraft,
            onChange: function (e) { setFilesDraft(e.target.value); },
            onBlur: commitFiles,
            onKeyDown: function (e) { if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                commitFiles();
            } },
        }), filesDraft
            ? (function () {
                var rawLines = filesDraft.split('\n');
                var rows = [];
                var nodeStatus = (fileStatusRef.current && fileStatusRef.current[nodeSel.id]) || {};
                for (var fi = 0; fi < rawLines.length; fi++) {
                    var ref = rawLines[fi].trim();
                    if (!ref)
                        continue;
                    var st = nodeStatus[ref] || 'unknown';
                    var isOk = st === 'ok';
                    var reason = isOk ? '' : (st === 'missing' ? '文件不在' : (st === 'symbol-missing' ? '符号不在' : '无法判定'));
                    rows.push(React.createElement('div', {
                        key: 'ref-' + fi + '-' + ref,
                        className: isOk ? undefined : 'ac-ref-bad',
                    }, (isOk ? '✓ ' : '⚠ ') + ref + (reason ? ' (' + reason + ')' : '')));
                }
                return rows.length > 0 ? React.createElement('div', { className: 'ac-ref-status' }, rows) : null;
            })()
            : null), React.createElement('div', { className: 'ac-field full' }, React.createElement('button', { className: 'ac-btn danger', onClick: deleteSel }, '删除这个节点'))));
    }
    else if (edgeSel && dockOpen) {
        dock = React.createElement('div', { className: 'ac-dock' }, React.createElement('h4', null, '连线 ' + edgeSel.from + ' → ' + edgeSel.to), React.createElement('div', { className: 'ac-grid' }, React.createElement('div', { className: 'ac-field full' }, React.createElement('label', null, '标签（回车生效）'), React.createElement('input', { className: 'ac-input', value: edgeDraft, onChange: function (e) { setEdgeDraft(e.target.value); }, onBlur: commitEdgeLabel, onKeyDown: function (e) { if (e.key === 'Enter')
                commitEdgeLabel(); } })), React.createElement('div', { className: 'ac-field' }, React.createElement('label', null, '样式'), React.createElement('select', { className: 'ac-select', value: edgeSel.arrow, onChange: function (e) { setArrow(e.target.value); } }, ['-->', '---', '-.->', '==>'].map(function (k) {
            return React.createElement('option', { key: k, value: k }, k);
        }))), React.createElement('div', { className: 'ac-field' }, React.createElement('button', { className: 'ac-btn danger', onClick: deleteSel }, '删除这条连线'))));
    }
    var tabs = [['canvas', '画布'], ['text', '源码'], ['preview', '预览']];
    var busy = status.indexOf('加载') === 0 || status.indexOf('失败') >= 0;
    var externalName = external ? String(external).replace(/\\/g, '/').split('/').pop() : '';
    return React.createElement('div', {
        ref: rootRef,
        className: 'ac-root',
        tabIndex: 0,
        onKeyDown: onKeyDown,
        onPointerDown: function () { try {
            if (rootRef.current)
                rootRef.current.focus();
        }
        catch (e) { } },
    }, React.createElement('div', { className: 'ac-bar' }, React.createElement('span', { className: 'ac-title' }, '架构画布'), React.createElement('div', { className: 'ac-tabs' }, tabs.map(function (t) {
        return React.createElement('button', { key: t[0], className: 'ac-tab' + (tab === t[0] ? ' on' : ''), onClick: function () { setTab(t[0]); } }, t[1]);
    })), React.createElement('button', {
        className: 'ac-tab', title: '撤销 (Ctrl/Cmd+Z)', onClick: undo,
        disabled: histRef.current.past.length === 0,
    }, '↶'), React.createElement('button', {
        className: 'ac-tab', title: '重做 (Ctrl/Cmd+Shift+Z)', onClick: redo,
        disabled: histRef.current.future.length === 0,
    }, '↷'), 
    // 检查点：**不再有「AI 只读」开关**。安全靠「随时退回去」而不是拦人 ——
    // 每次落盘（AI 改的 / 用户改的）都留一份快照，点这里就能退回任意一份（见 src/host/history.ts）。
    React.createElement('button', {
        className: 'ac-tab ac-histbtn' + (hist.open ? ' on' : ''),
        title: '检查点：每次改动都留了一份快照（标明是 AI 改的还是用户改的），可以退回任意一份。历史只在内存里，重启 dsh 会清空。',
        onClick: function () {
            if (hist.open) {
                patchHist({ open: false });
                return;
            }
            patchHist({ open: true });
            loadHistory();
        },
    }, '历史' + (historyCount > 0 ? ' ' + historyCount : ''))), React.createElement('div', { className: 'ac-tools' }, tab === 'canvas' ? React.createElement('button', { className: 'ac-btn', onClick: addNode }, '＋ 节点') : null, tab === 'canvas' ? React.createElement('button', { className: 'ac-btn', onClick: relayout }, '自动布局') : null, tab === 'canvas' ? React.createElement('button', { className: 'ac-btn', onClick: function () { fitView(true); } }, '适应窗口') : null, tab === 'canvas' ? React.createElement('button', { className: 'ac-btn danger', onClick: deleteSel, disabled: !sel }, '删除') : null, tab === 'canvas' ? React.createElement('button', { className: 'ac-btn', onClick: exportSvg, title: '导出白底 SVG，可直接贴进文档' }, 'SVG') : null, tab === 'canvas' ? React.createElement('button', { className: 'ac-btn', onClick: exportPng, title: '导出 PNG（2 倍图）' }, 'PNG') : null, tab === 'canvas' ? React.createElement('button', { className: 'ac-btn', onClick: copySource, title: '复制当前 Mermaid 源码' }, '复制源码') : null, tab === 'canvas' ? React.createElement('button', {
        className: 'ac-btn', title: '打开项目里的一个 .mmd / .mermaid 文件（此后编辑的就是它本身）',
        onClick: openFilePicker,
    }, '打开') : null, tab === 'canvas' ? React.createElement('button', {
        className: 'ac-btn' + (external ? ' primary' : ''),
        title: external ? '当前打开的是项目里的文件：' + external : '列图 / 切图 / 新建 / 按路径打开 —— 图库跟着项目走',
        onClick: function () { if (picker.open)
            closeLibrary();
        else
            loadLibrary(false); },
    }, external ? '文件 ' + externalName : '图库 ' + (libKey || '')) : null, tab === 'canvas' ? React.createElement('button', {
        className: 'ac-btn' + (noteListOpen.length ? ' primary' : ''),
        // 这个数字从前只数**未解决**的，于是把一个「留言」按钮读成了「留言总量」的人会
        // 觉得统计有 bug —— 画布上一共 7 条留言（含 4 条已解决），按钮却写着「留言 3」。
        // 现在两个都给：左边是待办数（会进 AI 的上下文），右边是总量。没有待办时只报总量。
        title: '节点留言清单：未解决的待办会随每一步进入 AI 的上下文，已解决的不进'
            + '（共 ' + noteTotal + ' 条，其中 ' + noteListOpen.length + ' 条待办）',
        onClick: function () { setNotesOpen(!notesOpen); },
    }, noteTotal === 0 ? '留言'
        : (noteListOpen.length ? '留言 ' + noteListOpen.length + ' · 共 ' + noteTotal : '留言 · 共 ' + noteTotal)) : null, tab === 'text' ? React.createElement('button', { className: 'ac-btn primary', onClick: applyDraft }, '应用回画布') : null, tab === 'text' ? React.createElement('button', { className: 'ac-btn', onClick: function () { setDraft(mermaidText); } }, '还原') : null), picker.open ? React.createElement('div', { className: 'ac-lib' }, React.createElement('div', { className: 'ac-lib-head' }, React.createElement('span', { className: 'grow' }, (external ? '当前打开：' + external : '当前：图库 ' + (libKey || '—'))
        + '　·　图库目录：' + (libDir || '(还没定位到)')), React.createElement('button', { className: 'ac-btn', title: '立刻重扫 .arch-canvas 与项目里的 mermaid 文件', onClick: function () { loadLibrary(true); } }, '重新扫描'), React.createElement('button', { className: 'ac-btn', onClick: closeLibrary }, '收起')), picker.busy ? React.createElement('div', { className: 'ac-hint' }, '正在读图库…') : null, picker.items.filter(function (it) { return !it.deleted; }).map(function (it) {
        var on = it.key === libKey;
        if (picker.renameKey === it.key) {
            return React.createElement('div', { key: it.key, className: 'ac-lib-row' }, React.createElement('input', {
                className: 'ac-input', value: picker.renameDraft, spellCheck: false, autoFocus: true,
                placeholder: '新名字',
                onChange: function (e) { patchPicker({ renameDraft: e.target.value }); },
                onKeyDown: function (e) {
                    if (e.key === 'Enter')
                        renameDiagram(it.key);
                    if (e.key === 'Escape')
                        patchPicker({ renameKey: '', renameDraft: '' });
                },
            }), React.createElement('button', { className: 'ac-btn primary', onClick: function () { renameDiagram(it.key); } }, '改名'), React.createElement('button', { className: 'ac-btn', onClick: function () { patchPicker({ renameKey: '', renameDraft: '' }); } }, '取消'));
        }
        return React.createElement('div', { key: it.key, className: 'ac-lib-row' }, React.createElement('button', {
            className: 'ac-lib-item' + (on ? ' on' : ''), title: it.summary ? (it.summary + '\n' + it.dir) : it.dir,
            onClick: function () { if (!on)
                openDiagram(it.key, false); },
        }, (on ? '● ' : '') + it.key + '　' + it.nodes + ' 节点 / ' + it.edges + ' 连线'
            + (it.summary ? '　·　' + it.summary : '')), picker.confirmKey === it.key
            ? [
                React.createElement('button', { key: 'yes', className: 'ac-btn danger', onClick: function () { deleteDiagram(it.key); } }, '确认删除'),
                React.createElement('button', { key: 'no', className: 'ac-btn', onClick: function () { patchPicker({ confirmKey: '' }); } }, '取消'),
            ]
            : [
                React.createElement('button', { key: 'rn', className: 'ac-btn', onClick: function () { patchPicker({ renameKey: it.key, renameDraft: it.key, confirmKey: '' }); } }, '改名'),
                React.createElement('button', { key: 'del', className: 'ac-btn danger', onClick: function () { patchPicker({ confirmKey: it.key, renameKey: '' }); } }, '删除'),
            ]);
    }), !picker.busy && picker.items.filter(function (it) { return !it.deleted; }).length === 0
        ? React.createElement('div', { className: 'ac-hint' }, '这个图库还没有别的图。在下面起个名字就能新建一张。')
        : null, React.createElement('div', { className: 'ac-lib-new' }, React.createElement('input', {
        className: 'ac-input', value: picker.draft, spellCheck: false,
        placeholder: '新图的名字（可以是 子项目/图名）',
        onChange: function (e) { patchPicker({ draft: e.target.value }); },
        onKeyDown: function (e) { if (e.key === 'Enter')
            openDiagram(picker.draft, true); },
    }), React.createElement('button', {
        className: 'ac-btn primary', disabled: !String(picker.draft || '').trim(),
        onClick: function () { openDiagram(picker.draft, true); },
    }, '新建并打开')), picker.items.filter(function (it) { return it.deleted; }).length > 0
        ? React.createElement('div', { className: 'ac-lib-deleted' }, React.createElement('div', { className: 'ac-hint' }, '已删除（内容还在文件里，可恢复）：'), picker.items.filter(function (it) { return it.deleted; }).map(function (it) {
            return React.createElement('div', { key: it.key, className: 'ac-lib-row' }, React.createElement('span', { className: 'ac-lib-gone' }, it.key + '　' + it.nodes + ' 节点'), React.createElement('button', { className: 'ac-btn', onClick: function () { restoreDiagram(it.key); } }, '恢复'));
        }))
        : null, picker.files.length > 0
        ? React.createElement('div', { className: 'ac-lib-deleted' }, React.createElement('div', { className: 'ac-hint' }, '项目里的 mermaid 文件（自动扫描出来的，点开就是编辑这个文件本身）：'), picker.files.map(function (f) {
            return React.createElement('div', { key: f.path, className: 'ac-lib-row' }, React.createElement('button', {
                className: 'ac-btn ac-lib-file', title: f.path,
                onClick: function () { openPath(f.path, false); },
            }, f.rel + '　' + Math.max(1, Math.round((f.bytes || 0) / 1024)) + ' KB'));
        }))
        : null, React.createElement('div', { className: 'ac-lib-open' }, React.createElement('input', {
        className: 'ac-input', value: picker.pathDraft, spellCheck: false,
        autoFocus: !!picker.focusPath,
        placeholder: '按路径打开：绝对路径，或相对项目根（.mmd / .mermaid）',
        onChange: function (e) { patchPicker({ pathDraft: e.target.value }); },
        onKeyDown: function (e) { if (e.key === 'Enter')
            openPath(picker.pathDraft, false); },
    }), React.createElement('button', {
        className: 'ac-btn primary', disabled: !String(picker.pathDraft || '').trim(),
        onClick: function () { openPath(picker.pathDraft, false); },
    }, '打开'))) : null, notePanel, histPanel, React.createElement('div', { className: 'ac-body' }, tab === 'canvas' ? stage : tab === 'text' ? textPane : previewPane), dock, React.createElement('div', { className: 'ac-statusbar' }, React.createElement('span', { className: 'ac-dot' + (busy ? ' busy' : '') }), React.createElement('span', { className: 'grow' }, status), model ? React.createElement('span', null, model.nodes.length + ' 节点 · ' + model.edges.length + ' 连线 · r' + revision + ' · ' + (updatedBy === 'ai' ? 'AI' : updatedBy === 'user' ? '你' : updatedBy)) : null));
}

"use strict";
// 注册面：主窗口子页标签体、@ 引用触发源。
// ==================== 主窗口子页标签体 ====================
// 画布是主窗口的一个子页，与「对话」「轨迹」并列（`conversation.view`，session 级 list 槽）。
// 这个槽与旧落点一样由 DSH 注入标准 props：sessionId 与 useSessions。
// 通过 useSessions 响应式订阅当前会话 cwd 并透传给 ArchStudio，保证人与 AI 访问同一项目图库。
function ArchTab(props) {
    var sessionId = props && props.sessionId;
    var useSessions = props && props.useSessions;
    var cwd = typeof useSessions === 'function' && sessionId
        ? useSessions(function (sessions) { return sessions && sessions.byId && sessions.byId[sessionId] ? sessions.byId[sessionId].cwd : undefined; })
        : undefined;
    return React.createElement(ArchStudio, Object.assign({}, props, { cwd: cwd, sessionId: sessionId }));
}
// ==================== @ 引用触发源 ====================
// 让用户在输入框输入 @ 时能看到并引用画布节点。
// 选中后插入 chip，提交时序列化为模型可理解的结构化文本。
function formatNodeForModel(node) {
    if (!node)
        return '';
    var sp = splitLabel(node.label);
    var title = sp.title || node.id;
    var desc = sp.desc ? sp.desc.replace(/\r?\n/g, ' ｜ ') : '';
    var parts = [];
    parts.push('[画布节点 ' + node.id + '「' + title + '」]');
    if (desc)
        parts.push(desc);
    if (node.files && node.files.length > 0) {
        parts.push('源码锚点：' + node.files.join(', '));
    }
    if (node.note) {
        var noteStatus = node.noteDone ? '已解决' : '待办';
        var noteText = String(node.note).replace(/\r?\n/g, ' / ');
        parts.push('用户留言（' + noteStatus + '）：' + noteText);
    }
    return parts.join(' ｜ ');
}
function registerArchInputTrigger(ctx, disposers) {
    var inputTriggers = ctx.get('inputTriggers');
    if (!inputTriggers || typeof inputTriggers.registerSource !== 'function')
        return;
    var source = {
        trigger: '@',
        name: 'arch-canvas',
        showGroupTitle: true,
        candidates: function (session, req) {
            var query = String(req && req.query != null ? req.query : '').trim().toLowerCase();
            var nodes = Array.isArray(studioLiveNodes) ? studioLiveNodes : [];
            var results = [];
            for (var i = 0; i < nodes.length; i++) {
                var n = nodes[i];
                if (!n || !n.id)
                    continue;
                var sp = splitLabel(n.label);
                var title = sp.title || n.id;
                var desc = sp.desc ? sp.desc.replace(/\r?\n/g, ' ') : '';
                var matchId = n.id.toLowerCase().indexOf(query) >= 0;
                var matchTitle = title.toLowerCase().indexOf(query) >= 0;
                var matchDesc = desc.toLowerCase().indexOf(query) >= 0;
                if (!query || matchId || matchTitle || matchDesc) {
                    results.push({
                        name: n.id,
                        label: title,
                        description: desc || undefined,
                        icon: ArchIcon,
                        hint: n.id,
                        value: n.id,
                    });
                }
            }
            return Promise.resolve(results);
        },
        onPick: function (pick) {
            var id = pick && pick.candidate ? (pick.candidate.value || pick.candidate.name) : '';
            var label = (pick && pick.candidate && pick.candidate.label) || id;
            return {
                insert: {
                    source: 'arch-canvas',
                    ref: id,
                    label: label,
                    clipboardText: '@' + id,
                }
            };
        },
        // 让草稿里的 `@u4` 这种**纯文本**被自动渲染成引用块（上下文块）。契约原文见
        // dsh-client-ui-conversation/lib/client.js:12192「Scan the draft for plain-text reference
        // tokens against the hot lexicons」+ :12300 的 registerTextRefDecoration。
        // 有它，往发送区送留言就不必伪造 span 去插 chip —— 那条路要 draftRev 的 CAS，外部够不着。
        // 契约要求这个钩子**同步、无副作用**（渲染路径），模块级的 studioLiveNodes 快照正合适。
        lexicon: function () {
            var nodes = Array.isArray(studioLiveNodes) ? studioLiveNodes : [];
            var ids = [];
            for (var i = 0; i < nodes.length; i++) {
                if (nodes[i] && nodes[i].id)
                    ids.push(nodes[i].id);
            }
            return ids;
        },
        codec: {
            clipboardText: function (ref) {
                return '@' + ref;
            },
            serialize: function (ref, signal) {
                var nodes = Array.isArray(studioLiveNodes) ? studioLiveNodes : [];
                var target = null;
                for (var i = 0; i < nodes.length; i++) {
                    if (nodes[i].id === ref) {
                        target = nodes[i];
                        break;
                    }
                }
                if (!target) {
                    return Promise.resolve('[画布节点 ' + ref + '（当前画布中已不存在该节点）]');
                }
                return Promise.resolve(formatNodeForModel(target));
            }
        }
    };
    try {
        var unreg = inputTriggers.registerSource(source);
        if (typeof unreg === 'function') {
            disposers.push(unreg);
        }
    }
    catch (e) { }
}
// ==================== 注册 ====================
// 做完整注册，返回一个卸载函数。
//
// 这里不再直接 `return { inject, apply }`：本文件现在是**从磁盘热加载**的普通脚本
// （由 host 从 <项目>/dist/ui.js 递给浏览器），Package 里留的是 src/bootstrap/client.js
// 那个薄引导层。所以界面代码的全部生命周期都收敛在这个返回值上。
//
// 发送区上方那条「留言待发」横条（曾经挂在 conversation.input.dock 上）**已经移除**：
// 用户要的是「所有未办留言自动进输入框」，那条横条既提供一个已经不需要的按钮，
// 又要在发送区上方常年占一行。自动补引用的 effect 在 studio.ts 里（盯着待办集合）。
function registerAll(ctx) {
    PLUGIN_CTX = ctx;
    var disposers = [];
    disposers.push(styles.insert(STUDIO_CSS));
    var slots = ctx.get('slots');
    if (slots !== undefined) {
        // 排在主窗口自带的两页之后：对话 0、轨迹 10（另一个插件的用量页占 20）。
        disposers.push(slots.inject('conversation.view', function () {
            return slots.register({ name: 'conversation.view', id: TAB_ID, order: 30, label: '架构画布' }, ArchTab);
        }));
    }
    registerArchInputTrigger(ctx, disposers);
    return function dispose() {
        for (var i = disposers.length - 1; i >= 0; i--) {
            try {
                if (typeof disposers[i] === 'function')
                    disposers[i]();
            }
            catch (e) { }
        }
        disposers.length = 0;
        PLUGIN_CTX = null;
    };
}

globalThis.__archCanvas = {
  install: function (ctx) {
    if (!React || !styles) throw new Error('arch-canvas ui: 缺少依赖 React/styles')
    if (typeof __rpc === 'function') RPC = __rpc
    return registerAll(ctx)
  },
}
})()
