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
    // 可拖的东西给 move，不给 pointer：pointer（手型）在浏览器里的意思是「点一下会跳走」，
    // 而这里按下去是**抓住它**。图里能拖的一律 move，和 Figma / Excalidraw 一致。
    '.ac-node{cursor:move}',
    // 拖动期间（在 .ac-svg 上挂 .dragging）：光标才是「抓着」的意思。
    // 节点自己的 cursor 权重更高，所以这一条要跟着写一遍，否则抓着方块时光标还是 move。
    '.ac-svg.dragging{cursor:grabbing}',
    '.ac-svg.dragging .ac-node{cursor:grabbing}',
    '.ac-node .ac-shape{fill:var(--dsw-alias-bg-layer-2,#232830);stroke:var(--ac-line);stroke-width:1.5}',
    '.ac-node.sel .ac-shape{stroke:var(--dsw-alias-brand-primary,#4c8dff);stroke-width:2.5}',
    // 节点卡片：第一段是标题（.ac-lbl —— 保持既有契约，它的 textContent 就是标题本身），
    // 其余段是描述（.ac-desc）；「意图：」「原理：」是**惯例**不是框架硬约束，写了才分层着色。
    '.ac-node .ac-lbl{fill:var(--dsw-alias-label-primary,#e8eaed);font-size:13px;font-weight:600;text-anchor:middle;dominant-baseline:central;pointer-events:none;user-select:none}',
    '.ac-node .ac-desc{fill:var(--dsw-alias-label-secondary,#9aa3af);font-size:11.5px;text-anchor:middle;dominant-baseline:central;pointer-events:none;user-select:none}',
    '.ac-node .ac-desc .ac-intent{fill:#7cc4ff}',
    '.ac-node .ac-desc .ac-rationale{fill:#b39ddb}',
    '.ac-node .ac-ref{fill:var(--dsw-alias-label-secondary,#9aa3af);font-size:10px;text-anchor:middle;dominant-baseline:central;pointer-events:none;user-select:none;opacity:.8}',
    '.ac-edge{fill:none;stroke:var(--ac-line);stroke-width:1.6}',
    '.ac-edge.dashed{stroke-dasharray:6 5}',
    '.ac-edge.sel{stroke:var(--dsw-alias-brand-primary,#4c8dff);stroke-width:2.6}',
    // 命中区**故意做宽**（14px）：线只有 1.6px，靠它自己几乎点不中。这里只补一条悬停反馈 ——
    // 光标扫过时那条细线才现形（平时完全透明），否则用户根本不知道这条线是可以点的。
    // **stroke-width 不许动**：实测 14px 的命中区是「细线可点」的全部依据。
    '.ac-edge-hit{fill:none;stroke:transparent;stroke-width:14;cursor:pointer}',
    '.ac-edge-hit:hover{stroke:var(--dsw-alias-brand-primary,#4c8dff);stroke-opacity:.35}',
    '.ac-arrowhead{fill:var(--ac-line)}',
    '.ac-elbl{fill:var(--dsw-alias-label-secondary,#9aa3af);font-size:11.5px;text-anchor:middle;dominant-baseline:central;pointer-events:none;user-select:none}',
    '.ac-elbl-bg{fill:var(--dsw-alias-bg-base,#14161a)}',
    '.ac-group-box{fill:var(--dsw-alias-bg-layer-1,#1b1e23);fill-opacity:.5;stroke:var(--ac-line);stroke-dasharray:5 5;stroke-width:1.4;cursor:move}',
    // 组名从前是 cursor:pointer —— 可点它**不**折叠（收起只认那个按钮），所以那个手型是在骗人。
    // 现在它和组框一样，是「抓住整组」的意思。
    '.ac-group-lbl{fill:var(--ac-line);font-size:11.5px;font-weight:600;cursor:move}',
    // ==================== 描边与组配色 ====================
    // 为什么不直接用 --dsw-alias-border-*：「边框」与「图形描边」在令牌体系里是两件事。
    // 实测（2026-09-21，把两个 token 的合成色算出来比对）：border-l2 = #ffffff1f（12% 白），
    // 当作节点描边只有 1.48:1、当作连线 1.42:1，border-l1 当作组框 1.17:1 —— 而 WCAG 对
    // 「有意义的图形」要求 ≥3:1。用户说「淡」不是审美偏好，是这三个数。所以这里自带描边色。
    '.ac-root{--ac-line:#7c828a;--ac-fill-a:.13;--ac-p0:#c238c2;--ac-p1:#ca4772;--ac-p2:#c94f43;--ac-p3:#91732a;--ac-p4:#27864f;--ac-p5:#268478;--ac-p6:#377abc;--ac-p7:#8e5ed0}',
    // 深色钩子：DSH 把深色调色板挂在 body[data-ds-dark-theme] 上（浅色在裸 body 上）。
    // **主题只在这两行里体现** —— 下面每档色相都写 var(--ac-pN)，于是「深/浅」只改这里的值，
    // 不必把每档规则写两遍，规则的特异性也就停在两个类上，永远不会盖掉 .ac-node.sel（三个类）。
    // 套 :where() 是让这条主题规则自身不涨权重（它只是几个变量的声明）。
    // 这个属性名不在令牌清单里，属于实现细节。万一哪天改名，退化成浅色值不会失读
    // （#7c828a 在深色底上仍有 4.8:1），只是组框偏淡 —— 是可接受的退化，不是崩。
    ':where(body[data-ds-dark-theme]) .ac-root{--ac-line:#86888a;--ac-fill-a:.18;--ac-p0:#d139d1;--ac-p1:#d54d7b;--ac-p2:#d45549;--ac-p3:#9d7925;--ac-p4:#229150;--ac-p5:#218d7f;--ac-p6:#3281cf;--ac-p7:#9664db}',
    // 八档色相：同一个组的**组框描边 + 组名 + 组内节点的边框**都是这个色 —— 组框互相压住、
    // 或者折叠起来的时候，成员关系照样读得出来。每档都做过**亮度归一**：让相对亮度相同，
    // 而不是 HSL 的 L 相同 —— 同一个 L 下蓝色比绿色暗三倍（实测 2.58:1 vs 7.83:1）。
    // 归一后每档对底色都是 ≈4.5:1。组框填充只取 13~18%：整块铺满色相会盖过节点本身。
    '.ac-h0 .ac-shape,.ac-h0 .ac-group-box,.ac-h0 .ac-fold-box{stroke:var(--ac-p0)}',
    '.ac-h0 .ac-group-box,.ac-h0 .ac-fold-box{fill:var(--ac-p0);fill-opacity:var(--ac-fill-a)}',
    '.ac-h0 .ac-group-lbl,.ac-h0 .ac-fold-lbl{fill:var(--ac-p0)}',
    '.ac-h1 .ac-shape,.ac-h1 .ac-group-box,.ac-h1 .ac-fold-box{stroke:var(--ac-p1)}',
    '.ac-h1 .ac-group-box,.ac-h1 .ac-fold-box{fill:var(--ac-p1);fill-opacity:var(--ac-fill-a)}',
    '.ac-h1 .ac-group-lbl,.ac-h1 .ac-fold-lbl{fill:var(--ac-p1)}',
    '.ac-h2 .ac-shape,.ac-h2 .ac-group-box,.ac-h2 .ac-fold-box{stroke:var(--ac-p2)}',
    '.ac-h2 .ac-group-box,.ac-h2 .ac-fold-box{fill:var(--ac-p2);fill-opacity:var(--ac-fill-a)}',
    '.ac-h2 .ac-group-lbl,.ac-h2 .ac-fold-lbl{fill:var(--ac-p2)}',
    '.ac-h3 .ac-shape,.ac-h3 .ac-group-box,.ac-h3 .ac-fold-box{stroke:var(--ac-p3)}',
    '.ac-h3 .ac-group-box,.ac-h3 .ac-fold-box{fill:var(--ac-p3);fill-opacity:var(--ac-fill-a)}',
    '.ac-h3 .ac-group-lbl,.ac-h3 .ac-fold-lbl{fill:var(--ac-p3)}',
    '.ac-h4 .ac-shape,.ac-h4 .ac-group-box,.ac-h4 .ac-fold-box{stroke:var(--ac-p4)}',
    '.ac-h4 .ac-group-box,.ac-h4 .ac-fold-box{fill:var(--ac-p4);fill-opacity:var(--ac-fill-a)}',
    '.ac-h4 .ac-group-lbl,.ac-h4 .ac-fold-lbl{fill:var(--ac-p4)}',
    '.ac-h5 .ac-shape,.ac-h5 .ac-group-box,.ac-h5 .ac-fold-box{stroke:var(--ac-p5)}',
    '.ac-h5 .ac-group-box,.ac-h5 .ac-fold-box{fill:var(--ac-p5);fill-opacity:var(--ac-fill-a)}',
    '.ac-h5 .ac-group-lbl,.ac-h5 .ac-fold-lbl{fill:var(--ac-p5)}',
    '.ac-h6 .ac-shape,.ac-h6 .ac-group-box,.ac-h6 .ac-fold-box{stroke:var(--ac-p6)}',
    '.ac-h6 .ac-group-box,.ac-h6 .ac-fold-box{fill:var(--ac-p6);fill-opacity:var(--ac-fill-a)}',
    '.ac-h6 .ac-group-lbl,.ac-h6 .ac-fold-lbl{fill:var(--ac-p6)}',
    '.ac-h7 .ac-shape,.ac-h7 .ac-group-box,.ac-h7 .ac-fold-box{stroke:var(--ac-p7)}',
    '.ac-h7 .ac-group-box,.ac-h7 .ac-fold-box{fill:var(--ac-p7);fill-opacity:var(--ac-fill-a)}',
    '.ac-h7 .ac-group-lbl,.ac-h7 .ac-fold-lbl{fill:var(--ac-p7)}',
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
    // 结构（2026-09-23）：分隔条 → 标题栏（收起 / 关闭）→ 内容体。**只有内容体滚动**，
    // 标题栏一直够得着；高度可以由用户拖出来（`height` 内联样式），没拖过就按内容自适应、
    // 上限 46%（小屏不至于把画布挤没）。
    '.ac-dock{flex:0 0 auto;display:flex;flex-direction:column;max-height:70%;border-top:1px solid var(--dsw-alias-border-l1,#2a2e35);background:var(--dsw-alias-bg-layer-1,#1b1e23)}',
    '.ac-dock:not([style*="height"]){max-height:46%}',
    '.ac-sash{flex:0 0 auto;height:6px;margin:0;cursor:row-resize;background:transparent;position:relative;touch-action:none}',
    '.ac-sash:hover{background:var(--dsw-alias-brand-primary,#4c8dff);opacity:.35}',
    '.ac-dock-bar{flex:0 0 auto;display:flex;align-items:center;gap:6px;padding:4px 8px 5px;border-bottom:1px solid var(--dsw-alias-border-l1,#2a2e35)}',
    '.ac-dock-title{flex:1 1 auto;min-width:0;font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:var(--dsw-alias-label-secondary,#9aa3af);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.ac-dock-btn{flex:0 0 auto;background:transparent;color:var(--dsw-alias-label-secondary,#9aa3af);border:1px solid transparent;border-radius:6px;padding:2px 7px;font:inherit;font-size:11.5px;cursor:pointer}',
    '.ac-dock-btn:hover{color:var(--dsw-alias-label-primary,#e8eaed);border-color:var(--dsw-alias-border-l2,#3a4048);background:var(--dsw-alias-bg-base,#14161a)}',
    '.ac-dock-body{flex:1 1 auto;min-height:0;overflow:auto;padding:9px 10px}',
    // 收起态：只剩一条细条。它必须在**选中还在**的时候出现 —— 用户能一眼看出
    // 「面板收起来了」而不是「选中丢了」，点一下就能展开。
    '.ac-peek{flex:0 0 auto;display:flex;align-items:center;gap:6px;padding:3px 8px;border-top:1px solid var(--dsw-alias-border-l1,#2a2e35);background:var(--dsw-alias-bg-layer-1,#1b1e23)}',
    '.ac-peek-btn{flex:1 1 auto;min-width:0;text-align:left;background:transparent;border:none;color:var(--dsw-alias-label-secondary,#9aa3af);font:inherit;font-size:11.5px;padding:2px 0;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.ac-peek-btn:hover{color:var(--dsw-alias-label-primary,#e8eaed)}',
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
    // 中间那一档：锚点还指得到，但文件在图上一次落盘之后改过 —— 内容可能已经不是图上说的了。
    // 从前的角标只有「蓝=好 / 红=坏」，这一档和「好」长得一模一样，等于没说。
    '.ac-file-badge.stale circle{fill:#e8a33d}',
    // 保鲜横幅（画布页顶部）：与「解析警告」同一套几何，但颜色与措辞都分开 —— 两件事不一样。
    '.ac-drift{flex:0 0 auto;max-height:26%;overflow:auto;margin:0 8px 6px;padding:7px 9px;border:1px solid #e8a33d;border-radius:8px;background:rgba(232,163,61,.06)}',
    '.ac-drift-h{color:#e8a33d;font-size:11.5px;font-weight:600;margin-bottom:4px}',
    // 只有「没画到」那一档：中性色 —— 它不是错误，只是一个待办提示。
    '.ac-drift.hint{border-color:var(--dsw-alias-border-l2,#3a4048);background:transparent}',
    '.ac-drift.hint .ac-drift-h{color:var(--dsw-alias-label-secondary,#9aa3af);font-weight:500}',
    '.ac-drift-i{color:var(--dsw-alias-label-secondary,#9aa3af);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:1.6;word-break:break-all}',
    '.ac-ref-status .ac-ref-stale{color:#e8a33d}',
    '.ac-file-badge text{fill:#fff;font-size:10px;text-anchor:middle;pointer-events:none;user-select:none}',
    '.ac-ref-status{display:flex;flex-direction:column;gap:2px;margin-top:6px;font-size:11px;color:var(--dsw-alias-label-secondary,#9aa3af)}',
    '.ac-ref-status .ac-ref-bad{color:#e5534b}',
    '.ac-statusbar{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:4px 10px;border-top:1px solid var(--dsw-alias-border-l1,#2a2e35);font-size:11px;color:var(--dsw-alias-label-secondary,#9aa3af);white-space:nowrap;overflow:hidden}',
    '.ac-statusbar .grow{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis}',
    // 缩放比例：数字要能一眼扫到，所以给它等宽字 + 固定不缩。
    '.ac-zoom{flex:0 0 auto;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:var(--dsw-alias-label-primary,#e8eaed);opacity:.85}',
    // 「? 快捷键与隐藏手势」那块静态清单：复用 .ac-lib 外壳，行是普通文本（不是按钮）。
    '.ac-help-row{padding:3px 8px;font-size:11.5px;line-height:1.6;color:var(--dsw-alias-label-secondary,#9aa3af)}',
    '.ac-help-row+.ac-help-row{border-top:1px solid var(--dsw-alias-border-l1,#2a2e35)}',
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
// rAF 合帧：拖动时一帧最多做一次状态更新。Chrome 的鼠标 pointermove 本来就与帧对齐，
// 但触屏 / 高刷设备会给得更密，而每一次更新都是一整棵画布的重渲染 + 全图重新布线。
// 拿不到 requestAnimationFrame（老环境、测试桩）就**同步执行** —— 宁可掉帧，也不能不动。
function rafFrame(fn) {
    try {
        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
            return window.requestAnimationFrame(fn);
        }
    }
    catch (e) { }
    fn();
    return 0;
}
function rafCancel(id) {
    try {
        if (id && typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
            window.cancelAnimationFrame(id);
        }
    }
    catch (e) { }
}
// 拖拽吸附：把候选坐标对齐到「其他节点的中心线」上，阈值内才吸。
//
// 2026-09-23 三处改动，都是照着成熟编辑器（Excalidraw / tldraw / Figma）的做法：
//   1) **阈值按屏幕像素算**（`SNAP_PX / k`）。旧值 8 是模型单位 —— 缩到 0.5 倍时屏幕上只剩
//      4px（吸不住），放到 2 倍时是 16px（甩不开）。同一个手感必须与缩放无关。
//   2) **迟滞**：吸上要在 ENTER 半径内，脱开要走到 EXIT 半径外（EXIT > ENTER）。
//      没有迟滞时，鼠标停在阈值边缘上，节点会在「吸住」和「跟手」之间来回抖。
//   3) **按轴记忆**：上一步吸在哪个坐标记在 `prev` 里，这一步才谈得上迟滞。
// 返回吸附后的坐标，以及命中的参考线位置（gx / gy 为 null 表示那条轴没吸上）。
var SNAP_PX = 8; // 进入吸附的半径（屏幕像素）
var SNAP_EXIT_PX = 14; // 脱开吸附的半径（屏幕像素，> 进入半径才有迟滞）
var SNAP_MIN_MODEL = 2; // 折算出来的半径下限：放得很大时也要吸得住 1~2px 的对齐
var SNAP_MAX_MODEL = 28; // 上限：缩得很小时不至于吸住半张画布
/** 屏幕像素半径折算成模型单位（与缩放无关的手感）。 */
function snapRadius(k, px) {
    var kk = (typeof k === 'number' && k > 0) ? k : 1;
    return Math.min(SNAP_MAX_MODEL, Math.max(SNAP_MIN_MODEL, px / kk));
}
/**
 * 一条轴上的吸附决定（纯函数，好测）。`active` 是上一步吸住的那条线（null = 没吸住）。
 * 迟滞的写法就是这两句：**已经吸住的先判脱开半径，没吸住的才判进入半径**。
 */
function snapAxis(raw, cands, enter, exit, active) {
    if (active != null && active !== undefined) {
        if (Math.abs(active - raw) <= exit)
            return { v: active, line: active };
        return { v: raw, line: null };
    }
    var best = null, bd = Infinity;
    for (var i = 0; i < cands.length; i++) {
        var d = Math.abs(cands[i] - raw);
        if (d < bd) {
            bd = d;
            best = cands[i];
        }
    }
    if (best != null && bd <= enter)
        return { v: best, line: best };
    return { v: raw, line: null };
}
/**
 * `movingIds` 是这次被拖着一起动的节点 id（分组拖动时是一整组）——
 * 拖动中的节点不能当自己的吸附候选，否则整组会吸在自己的旧坐标上动不了。
 */
function snapToPeers(nodes, movingIds, x, y, k, prev) {
    var move = {};
    if (movingIds && typeof movingIds.length === 'number') {
        for (var mi = 0; mi < movingIds.length; mi++)
            move[movingIds[mi]] = true;
    }
    else if (movingIds != null) {
        move[movingIds] = true;
    }
    var cxs = [], cys = [];
    for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (!n || move[n.id])
            continue;
        if (n.x == null || n.y == null)
            continue;
        cxs.push(n.x);
        cys.push(n.y);
    }
    var sx = snapAxis(x, cxs, snapRadius(k, SNAP_PX), snapRadius(k, SNAP_EXIT_PX), prev ? prev.gx : null);
    var sy = snapAxis(y, cys, snapRadius(k, SNAP_PX), snapRadius(k, SNAP_EXIT_PX), prev ? prev.gy : null);
    return { x: sx.v, y: sy.v, gx: sx.line, gy: sy.line };
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
// ==================== 组 → 色相档位 ====================
// 为什么不是「第几个组就用第几档」：删掉中间一个组会让它后面**所有**组换色，而用户记住的
// 是「那个绿框」。所以按组 id 哈希定位。哈希撞档时按 id 字典序往后探 —— 分配只取决于
// 「有哪些组」（顺序无关），现实中最多在插入新组时动一个组。
// 组多于 8 个时色相从头复用（图上一眼看得出「不是同一组」，但两组同色 —— 有意的取舍）。
var GROUP_HUE_COUNT = 8;
function groupHueIndex(groups) {
    var ids = [];
    var seen = {};
    for (var i = 0; i < (groups || []).length; i++) {
        var id = groups[i] && groups[i].id;
        if (typeof id !== 'string' || id === '' || seen[id])
            continue;
        seen[id] = true;
        ids.push(id);
    }
    ids.sort();
    var used = {};
    var out = {};
    for (var k = 0; k < ids.length; k++) {
        var h = 5381;
        for (var j = 0; j < ids[k].length; j++)
            h = ((h * 33) ^ ids[k].charCodeAt(j)) >>> 0;
        var slot = h % GROUP_HUE_COUNT;
        for (var probe = 0; probe < GROUP_HUE_COUNT; probe++) {
            var cand = (slot + probe) % GROUP_HUE_COUNT;
            if (!used[cand]) {
                slot = cand;
                break;
            }
        }
        used[slot] = true;
        out[ids[k]] = slot;
    }
    return out;
}
// 拿不到档位（没有组、节点不属于任何组）时返回空串 —— 节点于是落在中性的 --ac-line 上。
function hueClassOf(hueOf, id) {
    var h = hueOf && id ? hueOf[id] : undefined;
    return typeof h === 'number' ? ' ac-h' + h : '';
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
// ==================== 自动布局 ====================
// 两条**从真实图里量出来**的规矩，动这一段之前先读（数字见 test/layout.test.cjs 的守门断言）：
//
// 1. **分层前必须先折环。** 从前是「对边做最长路径松弛，靠 `cand < nodes.length` 兜底」——
//    有环时那个上界就是唯一的刹车。实测（2026-09-21，本仓库自己的 dsh-plugin-framework：
//    28 节点 / 35 边，环是 reg→dyn→studio→ui 这四个）：层号变成 0,1,2,3,24,25,26,27，
//    15 个节点被扔到第 24~27 层，中间 20 层是空的 —— 而每层照样吃掉 84px，画布上凭空多出
//    ~1.7k px 的空白，35 条边压出 92 个交叉。折成强连通分量再分层，层分布回到 0..7，
//    交叉降到 68。缩点图是 DAG，最长路径一次收敛，不需要任何人为上界。
// 2. **同层排序不是必胜，所以要比一遍再决定。** 中位数（barycenter）启发式把上面那张大图
//    从 92 压到 31，但在本仓库的 architecture 图（23 节点 / 6 层、本来只有 11 个交叉）上
//    会把交叉顶到 13。所以这里算完**比交叉数，不更少就不换** —— 「新布局永远不比旧布局差」
//    是有意维持的不变量，不是实现细节。代价是那一次比较为 O(E²)，所以给它一个边数上限。
var LAYOUT_ORDER_ROUNDS = 4; // 中位数扫描轮数（上下来回交替）
var LAYOUT_ORDER_MAX_EDGES = 600; // 超过这个边数就不做「比交叉数」这一步（它是 O(E²)）
/** Kosaraju 求强连通分量。**迭代版**：递归版在几千节点的长链上会爆栈。 */
function sccOf(ids, edges) {
    var adj = {}, radj = {};
    for (var i = 0; i < ids.length; i++) {
        adj[ids[i]] = [];
        radj[ids[i]] = [];
    }
    for (var e = 0; e < edges.length; e++) {
        adj[edges[e][0]].push(edges[e][1]);
        radj[edges[e][1]].push(edges[e][0]);
    }
    // 第一趟：正图上的完成序
    var order = [], seen = {};
    for (var s = 0; s < ids.length; s++) {
        if (seen[ids[s]])
            continue;
        seen[ids[s]] = true;
        var stack = [[ids[s], 0]];
        while (stack.length) {
            var top = stack[stack.length - 1];
            var nb = adj[top[0]];
            if (top[1] < nb.length) {
                var w = nb[top[1]++];
                if (!seen[w]) {
                    seen[w] = true;
                    stack.push([w, 0]);
                }
            }
            else {
                order.push(top[0]);
                stack.pop();
            }
        }
    }
    // 第二趟：反图按完成序的逆序走，一次能捞到的就是同一个分量
    var comp = {}, count = 0;
    for (var k = order.length - 1; k >= 0; k--) {
        var root = order[k];
        if (comp[root] !== undefined)
            continue;
        comp[root] = count;
        var st2 = [root];
        while (st2.length) {
            var v = st2.pop();
            var back = radj[v];
            for (var j = 0; j < back.length; j++) {
                if (comp[back[j]] === undefined) {
                    comp[back[j]] = count;
                    st2.push(back[j]);
                }
            }
        }
        count++;
    }
    // 成员按 ids 的原始顺序收集：同层里的先后必须稳定，不能随 DFS 的访问顺序漂
    var comps = [];
    for (var c = 0; c < count; c++)
        comps.push([]);
    for (var m = 0; m < ids.length; m++)
        comps[comp[ids[m]]].push(ids[m]);
    return { comp: comp, comps: comps };
}
/** 缩点图上的最长路径分层：环已经折掉，所以不需要任何上界。 */
function layerOfComps(comps, edges, comp) {
    var n = comps.length;
    var cl = [];
    for (var i = 0; i < n; i++)
        cl.push(0);
    var ce = [], seen = {};
    for (var e = 0; e < edges.length; e++) {
        var a = comp[edges[e][0]], b = comp[edges[e][1]];
        if (a === b)
            continue;
        var key = a + '>' + b;
        if (seen[key])
            continue;
        seen[key] = true;
        ce.push([a, b]);
    }
    for (var pass = 0; pass <= n; pass++) {
        var changed = false;
        for (var m = 0; m < ce.length; m++) {
            var cand = cl[ce[m][0]] + 1;
            if (cand > cl[ce[m][1]]) {
                cl[ce[m][1]] = cand;
                changed = true;
            }
        }
        if (!changed)
            break;
    }
    return cl;
}
function groupByLayer(ids, layer) {
    var layers = {};
    for (var i = 0; i < ids.length; i++) {
        var L = layer[ids[i]] || 0;
        if (!layers[L])
            layers[L] = [];
        layers[L].push(ids[i]);
    }
    return layers;
}
function sortedLayerKeys(layers) {
    var keys = [];
    for (var k in layers)
        keys.push(Number(k));
    keys.sort(function (a, b) { return a - b; });
    return keys;
}
/** 中位数（barycenter）启发式：上下交替扫，每层按「邻居那一层的平均位次」重排。 */
function medianOrder(ids, layer, edges, rounds) {
    var layers = groupByLayer(ids, layer);
    var keys = sortedLayerKeys(layers);
    var pos = {};
    for (var i = 0; i < keys.length; i++) {
        var row0 = layers[keys[i]];
        for (var j = 0; j < row0.length; j++)
            pos[row0[j]] = j;
    }
    var pred = {}, succ = {};
    for (var m = 0; m < ids.length; m++) {
        pred[ids[m]] = [];
        succ[ids[m]] = [];
    }
    for (var e = 0; e < edges.length; e++) {
        succ[edges[e][0]].push(edges[e][1]);
        pred[edges[e][1]].push(edges[e][0]);
    }
    for (var r = 0; r < rounds; r++) {
        var down = r % 2 === 0;
        var seq = down ? keys : keys.slice().reverse();
        for (var s = 0; s < seq.length; s++) {
            var row = layers[seq[s]];
            var key = {};
            for (var n = 0; n < row.length; n++) {
                var nb = down ? pred[row[n]] : succ[row[n]];
                var sum = 0, cnt = 0;
                for (var b = 0; b < nb.length; b++) {
                    var p = pos[nb[b]];
                    if (p !== undefined) {
                        sum += p;
                        cnt++;
                    }
                }
                key[row[n]] = cnt ? sum / cnt : pos[row[n]];
            }
            // 平局按 id 定序：同一份图跑两次必须得到同一个布局
            row.sort(function (a, b) { return (key[a] - key[b]) || (a < b ? -1 : a > b ? 1 : 0); });
            for (var f = 0; f < row.length; f++)
                pos[row[f]] = f;
        }
    }
    return layers;
}
/** 按层摆坐标。`rev` 只影响摆出去的值，**不能去改累加器本身** —— 从前的写法是
 *  `along = -along`，于是累加器被来回翻转，BT / RL 下第 0 层和第 2 层会落到同一个 y。 */
function layoutPositions(sizes, layers, horiz, rev, GAP) {
    var keys = sortedLayerKeys(layers);
    var pos = {};
    var along = 0;
    for (var i = 0; i < keys.length; i++) {
        var bucket = layers[keys[i]] || [];
        var deep = 0;
        for (var d = 0; d < bucket.length; d++)
            deep = Math.max(deep, horiz ? sizes[bucket[d]].w : sizes[bucket[d]].h);
        var span = GAP * Math.max(0, bucket.length - 1);
        for (var s = 0; s < bucket.length; s++)
            span += horiz ? sizes[bucket[s]].h : sizes[bucket[s]].w;
        var acc = -span / 2;
        var axis = rev ? -along : along;
        for (var n = 0; n < bucket.length; n++) {
            var sz = sizes[bucket[n]];
            var cross = acc + (horiz ? sz.h : sz.w) / 2;
            acc += (horiz ? sz.h : sz.w) + GAP;
            pos[bucket[n]] = horiz ? { x: axis, y: cross } : { x: cross, y: axis };
        }
        along += deep + 84;
    }
    return pos;
}
/** 两条边（按节点中心连直线）真交叉的条数。共端点的直接跳过 —— 它们必然交在端点。 */
function crossingsOf(pos, edges) {
    var n = 0;
    for (var i = 0; i < edges.length; i++) {
        var a1 = edges[i][0], b1 = edges[i][1];
        var p1 = pos[a1], p2 = pos[b1];
        if (!p1 || !p2)
            continue;
        for (var j = i + 1; j < edges.length; j++) {
            var a2 = edges[j][0], b2 = edges[j][1];
            if (a1 === a2 || a1 === b2 || b1 === a2 || b1 === b2)
                continue;
            var p3 = pos[a2], p4 = pos[b2];
            if (!p3 || !p4)
                continue;
            var den = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
            if (den === 0)
                continue;
            var t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / den;
            var u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / den;
            if (t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9)
                n++;
        }
    }
    return n;
}
/** 把一份 model 排成坐标。纯函数：不改入参，返回新的 nodes 数组。 */
function autoLayout(model) {
    var nodes = model.nodes || [];
    if (nodes.length === 0)
        return model;
    var byId = {};
    var sizes = {};
    var ids = [];
    for (var i = 0; i < nodes.length; i++) {
        byId[nodes[i].id] = nodes[i];
        ids.push(nodes[i].id);
        sizes[nodes[i].id] = nodeSize(nodes[i].label, refRowCount(nodes[i].files));
    }
    var pairs = [];
    for (var e = 0; e < (model.edges || []).length; e++) {
        var ed = model.edges[e];
        if (byId[ed.from] && byId[ed.to] && ed.from !== ed.to)
            pairs.push([ed.from, ed.to]);
    }
    var dir = model.direction || 'TD';
    var horiz = dir === 'LR' || dir === 'RL';
    var rev = dir === 'BT' || dir === 'RL';
    var GAP = horiz ? 74 : 56;
    // 1) 分层：先把环折成强连通分量，再在缩点图上做最长路径
    var part = sccOf(ids, pairs);
    var cl = layerOfComps(part.comps, pairs, part.comp);
    var layer = {};
    for (var t = 0; t < ids.length; t++)
        layer[ids[t]] = cl[part.comp[ids[t]]];
    // 2) 同层顺序：中位数启发式，但只在不更差的时候才采纳（见文件头那两条实测）
    var layers = groupByLayer(ids, layer);
    var pos = layoutPositions(sizes, layers, horiz, rev, GAP);
    if (pairs.length > 1 && pairs.length <= LAYOUT_ORDER_MAX_EDGES) {
        var alt = medianOrder(ids, layer, pairs, LAYOUT_ORDER_ROUNDS);
        var altPos = layoutPositions(sizes, alt, horiz, rev, GAP);
        if (crossingsOf(altPos, pairs) < crossingsOf(pos, pairs)) {
            layers = alt;
            pos = altPos;
        }
    }
    var out = [];
    for (var q = 0; q < nodes.length; q++) {
        // **整份复制，只改坐标。** 从前这里是逐字段重建 `{id,label,shape,group,x,y}` ——
        // 于是点一下「自动布局」（或加载一张没带坐标的图触发它），所有节点的 files / note /
        // noteDone / link 全被丢掉，而且紧接着经 doc:set 落盘，**永久损坏**。
        // （2026-09-20 客户端逻辑审计抓到的头号问题；`refRowCount(nodes[i].files)` 上面还在用
        //   files 算尺寸，就更说明这些字段本该跟着走。）
        out.push(Object.assign({}, nodes[q]));
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
/** 点是否在形状**内部**（往里收 0.5px：贴着轮廓走不算「穿进去」）。与 perimeterPoint 同一套尺寸约定。 */
function shapeInterior(px, py, g, kind) {
    var a = Math.max(0.5, g.w / 2 - 0.5), b = Math.max(0.5, g.h / 2 - 0.5);
    var dx = px - g.x, dy = py - g.y;
    if (kind === 'ellipse')
        return Math.hypot(dx / a, dy / b) < 1;
    if (kind === 'diamond')
        return Math.abs(dx) / a + Math.abs(dy) / b < 1;
    if (kind === 'hex') {
        // 六边形 = 上下直边 + 左右两条斜边，对 |dy| 分层：边界 |x| = w/2 - 14·(|y|/(h/2))
        var hw = Math.max(0.5, g.w / 2 - 0.5), hh = Math.max(0.5, g.h / 2 - 0.5);
        if (Math.abs(dy) >= hh)
            return false;
        var hexInset = Math.min(NODE_HEX_INSET, hw);
        return Math.abs(dx) < hw - hexInset * (Math.abs(dy) / hh);
    }
    // rect / round / sub / cyl / stadium：圆角矩形（rect 的 rx=9）
    var r = kind === 'rect' ? 9 : Math.min(a, b);
    var cx = Math.max(Math.abs(dx) - (a - r), 0);
    var cy = Math.max(Math.abs(dy) - (b - r), 0);
    return Math.hypot(cx, cy) < r;
}
/**
 * 线段是否真的穿进这个节点的**可见形状**。包围盒只当快速预筛 —— 非矩形节点的锚点本来就落在
 * 包围盒内部（轮廓上），拿包围盒当判据会把每条候选都判成自穿透（复核第 1 条：那会让整条线
 * 落到不看障碍的兜底上，画出来正好穿过别的方块）。只有真的进了形状才算命中，于是「从轮廓上
 * 出发往外走」天然不算。
 */
function edgeSegHitsNode(x1, y1, x2, y2, g) {
    var box = { x1: g.x - g.w / 2, y1: g.y - g.h / 2, x2: g.x + g.w / 2, y2: g.y + g.h / 2 };
    if (!edgeSegHitsRect(x1, y1, x2, y2, box))
        return false;
    var kind = kindOf(g.shape);
    if (kind === 'rect')
        return true; // 矩形填满包围盒，不必再采样
    var L = Math.abs(x2 - x1) + Math.abs(y2 - y1);
    var steps = Math.max(2, Math.min(48, Math.ceil(L / 6)));
    for (var i = 1; i < steps; i++) {
        var t = i / steps;
        if (shapeInterior(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, g, kind))
            return true;
    }
    return false;
}
/** 一条折线有没有穿进**自己**这个节点（a / b 各查一次）。 */
function edgePathHitsSelf(pts, g) {
    if (!g || typeof g.w !== 'number' || typeof g.h !== 'number')
        return false;
    for (var i = 0; i + 1 < pts.length; i++) {
        if (edgeSegHitsNode(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, g))
            return true;
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
// ==================== 选边与落点（2026-09-23 重写） ====================
// 从前的规则是「两节点中心的 |dx| / |dy| 谁大就走竖轴、否则走横轴，侧边按 delta 的正负取」。
// 那是 React Flow「Simple Floating Edges」那套的简化版：它只看中心，**不看两个方块各自有多大**，
// 于是「一个矮胖节点斜对一个方块」这类常见摆法会选错轴、白绕几十像素
// （实测 420 个相对位置：平均多绕 24.8px，26.7% 的位置多绕 40px 以上）。
// 工业界（draw.io 的端口方向掩码、JointJS 的 anchor + boundary connectionPoint、
// React Flow 官方 floating edges）的共同做法是**先算落点、再定侧**。这里照这个思路做，
// 只保留现有正交路由器能吃的形状（两端走同一条轴），把「选哪条轴、哪条边」交给代价函数。
var NODE_HEX_INSET = 14; // 六边形左右两个斜角的水平内缩 —— 与 studio.ts 画形状时用的是同一个数
function sideNormal(s) {
    if (s === 't')
        return { x: 0, y: -1 };
    if (s === 'b')
        return { x: 0, y: 1 };
    if (s === 'l')
        return { x: -1, y: 0 };
    return { x: 1, y: 0 };
}
/** 这条边上的「半个跨度」：上下边是 w/2，左右边是 h/2。 */
function sideHalfSpan(g, s) {
    return (s === 't' || s === 'b') ? g.w / 2 : g.h / 2;
}
/** 边心（不带端口偏移）—— 只用来估代价。 */
function sideCenter(g, s) {
    var n = sideNormal(s);
    return { x: g.x + n.x * g.w / 2, y: g.y + n.y * g.h / 2 };
}
/** 两个方块在四条边外侧的间隙（负数 = 这一轴上两方块重叠）。 */
function edgeGaps(a, b) {
    return {
        r: b.x - b.w / 2 - (a.x + a.w / 2),
        l: a.x - a.w / 2 - (b.x + b.w / 2),
        b: b.y - b.h / 2 - (a.y + a.h / 2),
        t: a.y - a.h / 2 - (b.y + b.h / 2),
    };
}
/**
 * 这条轴上「朝对端」的那条边。两方块在该轴上有间隙时取有间隙的那条（这就是「朝向」的
 * 准确含义）；没有间隙（在该轴上重叠）就退化成「对端在哪个方向就走哪边」。
 */
function sideOnAxis(a, b, vertical, gp) {
    if (vertical) {
        if (gp.b >= 0)
            return 'b';
        if (gp.t >= 0)
            return 't';
        return b.y >= a.y ? 'b' : 't';
    }
    if (gp.r >= 0)
        return 'r';
    if (gp.l >= 0)
        return 'l';
    return b.x >= a.x ? 'r' : 'l';
}
/**
 * 这条轴「走不走得通」的粗估：用边心 + 中位线附近几条候选试着铺一下，全部撞障碍就返回 false。
 * 它**不替代**布线器（那边会扫十几条车道、还有两段绕行），只用来在选边时避开「这条轴根本没路」
 * 的情况 —— 真图上实测过：不看障碍时，选出来的那条轴会被障碍全部拒掉，最后落到不看障碍的
 * 硬穿兜底，画出一条穿过第三方块的线。
 */
function axisLooksClear(a, b, sa, sb, vertical, obs) {
    var p = sideCenter(a, sa), q = sideCenter(b, sb);
    var mid0 = vertical ? (p.y + q.y) / 2 : (p.x + q.x) / 2;
    var tries = [mid0];
    for (var t = 1; t <= 2; t++) {
        tries.push(mid0 - t * EDGE_LANE_STEP);
        tries.push(mid0 + t * EDGE_LANE_STEP);
    }
    for (var i = 0; i < tries.length; i++) {
        var m = tries[i];
        var pts = vertical
            ? [{ x: p.x, y: p.y }, { x: p.x, y: m }, { x: q.x, y: m }, { x: q.x, y: q.y }]
            : [{ x: p.x, y: p.y }, { x: m, y: p.y }, { x: m, y: q.y }, { x: q.x, y: q.y }];
        if (!edgePathHits(pts, obs))
            return true;
    }
    return false;
}
/**
 * 两端的端口各落在哪条边上。只考虑「两端同轴」的两种组合（竖轴 / 横轴）—— 现有正交
 * 路由器（中位线 + 避障 + 车道 + 拱桥）吃的就是这一类；混轴要出 L 形折线，那是另一套
 * 布线器的事，不在这次改动里。
 *
 * 代价 = 两个边心的曼哈顿距离（**这就是这条折线将会有多长**）
 *      + 从「重叠的那条轴」绕出去的罚（一条轴明明开着，就别从另一条叠着的轴背后出去）
 *      + **这条轴根本走不通**的罚（给 obstacles 时才算；不给就退化成纯几何估价）
 *      + 回头线 / 自穿透的重罚。
 * 实测（420 个相对位置，见 test 里那节的同款网格）：旧规则平均比「两端同轴的最优」多绕
 * 24.8px、26.7% 的位置多绕 40px 以上；换成这个代价函数后是 3.4px / 0%。
 * **边心**（不是端口）参与估价：端口偏移是「同一侧多条线均分」的结果，不该反过来影响选边。
 *
 * `obstacles` 是画布上其它可见方块的几何（可省）。studio 的端口分组与这里的布线器**必须传同一份**，
 * 否则两边会选出不同的侧（端口按 A 侧均分、线却从 B 侧出去）。
 */
function edgeSidesOf(a, b, obstacles = null) {
    if (!a || !b)
        return { a: 'b', b: 't', vertical: true };
    var gp = edgeGaps(a, b);
    var gpB = edgeGaps(b, a); // 反着来一遍：sideOnAxis 的「间隙」是按第一个参数算的
    // 障碍按布线器同一套规则做（带 EDGE_PAD 的余量 + 两端自身零余量的 guard）
    var obs = [];
    if (obstacles) {
        for (var oi = 0; oi < obstacles.length; oi++) {
            var o = obstacles[oi];
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
    var best = null, bestCost = Infinity;
    for (var vi = 0; vi < 2; vi++) {
        var vertical = vi === 0;
        var sa = sideOnAxis(a, b, vertical, gp);
        var sb = sideOnAxis(b, a, vertical, gpB);
        var p = sideCenter(a, sa), q = sideCenter(b, sb);
        var cost = Math.abs(q.x - p.x) + Math.abs(q.y - p.y);
        var gap = vertical ? Math.max(gp.b, gp.t) : Math.max(gp.r, gp.l);
        var gapOther = vertical ? Math.max(gp.r, gp.l) : Math.max(gp.b, gp.t);
        if (gap < 0 && gapOther > 0)
            cost += 200 + Math.min(600, -gap * 2);
        // 粗估只查**别人的方块**：自己的盒子会误伤「锚点在轮廓上」（见 edgeGeometry 里那段注释）
        if (obstacles && !axisLooksClear(a, b, sa, sb, vertical, obs))
            cost += 400;
        var na = sideNormal(sa), nb = sideNormal(sb);
        // 出了门先朝背离对端的方向走 = 回头线（旧代码里那个 `inverted` 兜的正是这一类）
        if ((b.x - p.x) * na.x + (b.y - p.y) * na.y < 0)
            cost += 900;
        if ((a.x - q.x) * nb.x + (a.y - q.y) * nb.y < 0)
            cost += 900;
        // 出点落在对端身体里、或入点落在本端身体里 = 自穿透
        if (Math.abs(p.x - b.x) < b.w / 2 && Math.abs(p.y - b.y) < b.h / 2)
            cost += 100000;
        if (Math.abs(q.x - a.x) < a.w / 2 && Math.abs(q.y - a.y) < a.h / 2)
            cost += 100000;
        if (cost < bestCost) {
            bestCost = cost;
            best = { a: sa, b: sb, vertical: vertical };
        }
    }
    // 两个方块完全重合（同一坐标、同样大小）时，两端会各自选到同一条边的边心 —— 出入点重合，
    // 折线退化成 `M x y` 一个点（看不见、也点不中）。这时改走横轴：一左一右，至少是一条看得见的线。
    // 触发路径很常见：连点两次「＋ 节点」（都落在视口中心）再把它们连起来。
    var pc = sideCenter(a, best.a), qc = sideCenter(b, best.b);
    if (Math.abs(pc.x - qc.x) < 0.5 && Math.abs(pc.y - qc.y) < 0.5) {
        return { a: 'r', b: 'l', vertical: false };
    }
    return best;
}
/**
 * 把「某条边上的横向偏移」投到形状的**可见轮廓**上，而不是包围盒上。
 * 这一步是本次改动里最容易被看见的一条：菱形/椭圆/六边形/胶囊的锚点从前落在包围盒上，
 * 同一侧挤两根线时箭头就悬在方块外面（实测：菱形 24.4px、椭圆 10.1px、六边形 5.4px）。
 * `kind` 来自 kindOf(shape)，与 studio.ts 里画形状的那段共用同一套尺寸约定。
 */
function perimeterPoint(g, kind, side, lateral) {
    var ax = side === 't' || side === 'b';
    var spanA = ax ? g.w / 2 : g.h / 2; // 沿边方向
    var spanD = ax ? g.h / 2 : g.w / 2; // 垂直方向（矩形时就是落点距离）
    var lim = Math.max(0, spanA - 2);
    var lat = Math.max(-lim, Math.min(lim, lateral || 0));
    var perp = spanD;
    if (kind === 'diamond') {
        perp = spanD * Math.max(0, 1 - Math.abs(lat) / Math.max(1e-6, spanA));
    }
    else if (kind === 'ellipse') {
        var eu = spanA > 0 ? lat / spanA : 0;
        perp = spanD * Math.sqrt(Math.max(0, 1 - eu * eu));
    }
    else if (kind === 'hex') {
        if (ax) {
            // 上下边：中间一段是直边，两端各有一个 14px 的斜角
            var inset = Math.min(NODE_HEX_INSET, spanA);
            perp = Math.abs(lat) <= spanA - inset
                ? spanD
                : spanD * Math.max(0, (spanA - Math.abs(lat)) / Math.max(1e-6, inset));
        }
        else {
            // 左右两侧不是边，是两个顶点：从顶点沿斜边收进去（垂直方向的半长是 spanD）
            perp = Math.max(0, spanD - NODE_HEX_INSET * (Math.abs(lat) / Math.max(1e-6, spanA)));
        }
    }
    else if (kind !== 'rect') {
        // round / sub / cyl / stadium：rx = min(h/2, w/2) 的胶囊，直段之外落到圆角上。
        // 圆角圆心在「离形状中心 (spanD - r) 的垂直距离」处，所以半径那一段要**加上这个偏移**：
        // 少了它，横着出去的锚点会缩进方块里（140×60 的胶囊上实测缩了 41px）。
        var r = Math.min(spanA, spanD);
        if (Math.abs(lat) > spanA - r) {
            var dc = Math.abs(lat) - (spanA - r);
            perp = (spanD - r) + Math.sqrt(Math.max(0, r * r - dc * dc));
        }
    }
    if (side === 'b')
        return { x: g.x + lat, y: g.y + perp };
    if (side === 't')
        return { x: g.x + lat, y: g.y - perp };
    if (side === 'r')
        return { x: g.x + perp, y: g.y + lat };
    return { x: g.x - perp, y: g.y + lat };
}
/** 某个端口位次在给定侧上的最终落点（先按「同侧均分」算偏移，再投到轮廓上）。 */
function portPointOf(g, side, p) {
    var span = (side === 't' || side === 'b') ? g.w : g.h;
    return perimeterPoint(g, kindOf(g.shape), side, edgePortOffset(span, p));
}
/**
 * 一条连线的路径。`obstacles` 是画布上**其它可见方块**的几何（被折叠收起的方块不该挡路），
 * `offset` 用于把同一对节点之间的多条线错开（由调用方按序号算），
 * `ports` 是两端的端口位次 `{ a: {n,i}, b: {n,i} }`，
 * `usedLanes` 是**前面几条线已经占掉的车道** —— 有了它，两条不同连线的中位线撞上时
 * 后来者会自己往旁边让（用户要的「平行间隔」）。由调用方逐条累积。
 *
 * 几何里可以带 `shape`（studio 传的就是带 shape 的那份）；不带就按矩形处理。
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
    var pA = ports && ports.a;
    var pB = ports && ports.b;
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
    // 选边（两端同轴）→ 落点（投到真实轮廓上，而不是包围盒）
    // **必须把 obstacles 交进去**：studio 的端口分组用的是带障碍的那一份（它决定每个端口落在哪条边、
    // 以及同一侧多端口怎么均分），这里不交就会挑出另一条轴 —— 端口按 A 侧均分、线却从 B 侧出去，
    // 更坏的是会选中代价函数刚判过「这条轴根本走不通」的那条轴，候选车道全被拒、落到硬穿兜底，
    // 画出一条穿过第三方方块的线（2026-09-24 客户端审计第 2 条，是上一轮改动留下的回归）。
    var sides = edgeSidesOf(a, b, obstacles);
    var vertical = sides.vertical;
    var p0 = portPointOf(a, sides.a, pA);
    var p1 = portPointOf(b, sides.b, pB);
    // 「端口倒挂」（出点反而落在入点之后）从前靠一段 `inverted` 特判兜住，现在由
    // edgeSidesOf 的代价函数在选边阶段就排除掉 —— 自穿透与回头线都是重罚项。
    // a 和 b 自己**不**进障碍表（带 12px 余量的话会把贴着边框出发的端口段一起判成"命中"，
    // 于是每条线都被拒），但要单独做一次自穿透检查：两个方块纵向上重叠时，
    // 中位线候选会从出点往回钻、直接穿过方块自己。**只查内部段**（首末两段贴着端口，
    // 必须允许它从形状的轮廓上出发）—— 非矩形节点的锚点落在圆角/斜边上，那个点本来就在
    // 包围盒**里面**（菱形、胶囊、椭圆都是），连首段也查的话每个候选都会被拒，
    // 整条线落到不看障碍的硬穿兜底上，画出来正好穿过别的方块（复核第 1 条，实测过）。
    // 严格不等号保住「贴着边框出发」与「钻进内部」的分界。（审计第 6/7 条的地基。）
    var blockedBy = function (pts) {
        return edgePathHits(pts, obs) || edgePathHitsSelf(pts, a) || edgePathHitsSelf(pts, b);
    };
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
        if (blockedBy(pts))
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
    // 兜底零：候选车道**再往两边扫一遍**（±10 条车道 + 每条障碍的外侧一条）。
    // 为什么要有这一层：上面那圈候选只铺到 ±3 条车道，方块挤在一起时会被全部拒掉，
    // 然后落到「兜底二」那条**不看障碍**的硬穿线上 —— 实测真图（dsh-plugin-framework）
    // 上就是这里多出了两条穿过第三方块的线。先多找几条干净的车道，实在找不到才硬穿。
    if (!best) {
        var wide = [];
        for (var wq = 1; wq <= 10; wq++) {
            wide.push(mid0 - wq * EDGE_LANE_STEP);
            wide.push(mid0 + wq * EDGE_LANE_STEP);
        }
        for (var wz = 0; wz < obs.length; wz++) {
            if (vertical) {
                wide.push(obs[wz].y1 - EDGE_LANE);
                wide.push(obs[wz].y2 + EDGE_LANE);
            }
            else {
                wide.push(obs[wz].x1 - EDGE_LANE);
                wide.push(obs[wz].x2 + EDGE_LANE);
            }
        }
        wide.sort(function (m, n) { return Math.abs(m - mid0) - Math.abs(n - mid0); });
        var cleanOnly = null;
        for (var wc = 0; wc < wide.length; wc++) {
            var mw = wide[wc] + shift;
            var wpts = vertical
                ? [{ x: p0.x, y: p0.y }, { x: p0.x, y: mw }, { x: p1.x, y: mw }, { x: p1.x, y: p1.y }]
                : [{ x: p0.x, y: p0.y }, { x: mw, y: p0.y }, { x: mw, y: p1.y }, { x: p1.x, y: p1.y }];
            if (blockedBy(wpts))
                continue;
            if (!cleanOnly)
                cleanOnly = wpts;
            if (freeOfLane(wpts)) {
                best = wpts;
                break;
            }
        }
        if (!best)
            best = cleanOnly;
    }
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
        // 车道不只「整片外面的两条」：方块挤成一片时，那两条外侧车道往往正好卡在别的方块旁边，
        // 于是一条都走不通、直接落到硬穿。这里把**每块障碍的外侧**也当候选，按离中位线的远近排。
        var lanes = vertical ? [bx1 - EDGE_LANE, bx2 + EDGE_LANE] : [by1 - EDGE_LANE, by2 + EDGE_LANE];
        for (var lz = 0; lz < obs.length; lz++) {
            if (vertical)
                lanes.push(obs[lz].x1 - EDGE_LANE, obs[lz].x2 + EDGE_LANE);
            else
                lanes.push(obs[lz].y1 - EDGE_LANE, obs[lz].y2 + EDGE_LANE);
        }
        var laneMid = vertical ? (p0.x + p1.x) / 2 : (p0.y + p1.y) / 2;
        lanes.sort(function (m, n) { return Math.abs(m - laneMid) - Math.abs(n - laneMid); });
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
            if (!blockedBy(detour))
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
    '.ac-group-box{fill:#f2f6fa;stroke:#7b8794;stroke-dasharray:5 5;stroke-width:1.4}',
    '.ac-group-lbl{fill:#4a5568;font-size:11.5px;font-weight:600}',
    // 组配色：与屏幕同一套色相，这里写字面值（导出件没有主题上下文，取不到变量）。
    // 白的底上用的是浅色那一列：每一档对白底 ≈4.5:1，实测见 runtime.ts 里屏幕那一段的注释。
    '.ac-h0 .ac-shape,.ac-h0 .ac-group-box,.ac-h0 .ac-fold-box{stroke:#c238c2}',
    '.ac-h0 .ac-group-box,.ac-h0 .ac-fold-box{fill:#c238c2;fill-opacity:.13}',
    '.ac-h0 .ac-group-lbl,.ac-h0 .ac-fold-lbl{fill:#c238c2}',
    '.ac-h1 .ac-shape,.ac-h1 .ac-group-box,.ac-h1 .ac-fold-box{stroke:#ca4772}',
    '.ac-h1 .ac-group-box,.ac-h1 .ac-fold-box{fill:#ca4772;fill-opacity:.13}',
    '.ac-h1 .ac-group-lbl,.ac-h1 .ac-fold-lbl{fill:#ca4772}',
    '.ac-h2 .ac-shape,.ac-h2 .ac-group-box,.ac-h2 .ac-fold-box{stroke:#c94f43}',
    '.ac-h2 .ac-group-box,.ac-h2 .ac-fold-box{fill:#c94f43;fill-opacity:.13}',
    '.ac-h2 .ac-group-lbl,.ac-h2 .ac-fold-lbl{fill:#c94f43}',
    '.ac-h3 .ac-shape,.ac-h3 .ac-group-box,.ac-h3 .ac-fold-box{stroke:#91732a}',
    '.ac-h3 .ac-group-box,.ac-h3 .ac-fold-box{fill:#91732a;fill-opacity:.13}',
    '.ac-h3 .ac-group-lbl,.ac-h3 .ac-fold-lbl{fill:#91732a}',
    '.ac-h4 .ac-shape,.ac-h4 .ac-group-box,.ac-h4 .ac-fold-box{stroke:#27864f}',
    '.ac-h4 .ac-group-box,.ac-h4 .ac-fold-box{fill:#27864f;fill-opacity:.13}',
    '.ac-h4 .ac-group-lbl,.ac-h4 .ac-fold-lbl{fill:#27864f}',
    '.ac-h5 .ac-shape,.ac-h5 .ac-group-box,.ac-h5 .ac-fold-box{stroke:#268478}',
    '.ac-h5 .ac-group-box,.ac-h5 .ac-fold-box{fill:#268478;fill-opacity:.13}',
    '.ac-h5 .ac-group-lbl,.ac-h5 .ac-fold-lbl{fill:#268478}',
    '.ac-h6 .ac-shape,.ac-h6 .ac-group-box,.ac-h6 .ac-fold-box{stroke:#377abc}',
    '.ac-h6 .ac-group-box,.ac-h6 .ac-fold-box{fill:#377abc;fill-opacity:.13}',
    '.ac-h6 .ac-group-lbl,.ac-h6 .ac-fold-lbl{fill:#377abc}',
    '.ac-h7 .ac-shape,.ac-h7 .ac-group-box,.ac-h7 .ac-fold-box{stroke:#8e5ed0}',
    '.ac-h7 .ac-group-box,.ac-h7 .ac-fold-box{fill:#8e5ed0;fill-opacity:.13}',
    '.ac-h7 .ac-group-lbl,.ac-h7 .ac-fold-lbl{fill:#8e5ed0}',
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
    // `.ac-edge-hit` 是连线的**命中区**（透明、宽 14 的描边）—— 也是界面装饰，导出时一并剔掉。
    // 从前它既不在这张表里、EXPORT_CSS 里也没有规则，而 path 的缺省 fill 是**纯黑**：
    // 导出的 SVG/PNG 里每条折线旁边都多出一块黑（栅格化实测 7230 个纯黑像素，加一条规则后 0）。
    // 2026-09-24 客户端审计第 3 条 —— 与上面角标黑斑是同一类，只是漏了这个元素。
    var drop = ['.ac-handle', '.ac-link-preview', '.ac-pulse', '.ac-snapline', '.ac-note-badge', '.ac-file-badge', '.ac-jump', '.ac-edge-hit'];
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
/**
 * 方向键微调的「静默窗口」（ms）：最后一下 keydown 之后过这么久就落一次盘。
 * 按住方向键 ≈2 秒有 60 次自动重复；每一跳都 `doc:set` 的话，60 步撤销栈被整条 shift 掉、
 * 宿主 50 份检查点缓冲也被冲掉 —— 用户再也退不回自己真正的编辑（改名 / 拖拽）。
 * 所以一次手势（一连串 keydown + 一次 keyup）只落**一条**历史、只发**一次** doc:set（见 nudgeSel）。
 */
var NUDGE_IDLE_MS = 450;
/**
 * 底部检查器（详情面板）的高度（px）—— 用户在面板上边缘拖出来的结果。
 * **只活在模块里**：切走子页、换会话都还在，重启 dsh 就复位。与「视角、撤销栈」同一条
 * 记忆规则（见 studioMemo 那段注释）：这些是用户**自己调过**的东西，重开面板该还在；
 * 而面板里的草稿、选中、开合状态都不记 —— 那些是「正在做的事」。
 */
var STUDIO_DOCK_H = null;
// 当前画布的实时节点快照，供 register.ts 里的 @ 引用 trigger source 消费。
// **按会话分开存**：画布现在住在主窗口子页里（`conversation.view`），切到「对话」页就是卸载，
// 而快照是模块级的、卸载不会清。从前只有一个数组，于是在另一个会话（另一个项目）里打 @，
// 列出来的是**上一次打开的那张图**的节点，插进草稿的展开文本也是旧的 —— 静默给错数据。
// 快照归谁，就只给谁用；拿不到就是空，空比别人的图好。
var studioSnapshots = {};
var studioActiveSession = ''; // 最近一次被 @ 引用源问到的会话（candidates / lexicon）
var STUDIO_SNAP_MAX = 8;
function syncLiveNodes(m, sessionId) {
    var sid = String(sessionId == null ? '' : sessionId);
    if (!sid)
        return;
    studioSnapshots[sid] = {
        nodes: (m && m.nodes && Array.isArray(m.nodes)) ? m.nodes.slice() : [],
        at: Date.now(),
    };
    studioActiveSession = sid;
    var keys = Object.keys(studioSnapshots);
    if (keys.length > STUDIO_SNAP_MAX) {
        var oldest = '', touched = Infinity;
        for (var i = 0; i < keys.length; i++) {
            var t = studioSnapshots[keys[i]].at || 0;
            if (t < touched) {
                touched = t;
                oldest = keys[i];
            }
        }
        if (oldest && oldest !== sid)
            delete studioSnapshots[oldest];
    }
}
/**
 * 某个会话当前那份快照的节点。`lexicon` 与 `candidates` 都只有会话 id（见 register.ts），
 * 拿不到就是空列表 —— 契约要求 lexicon **同步、无副作用**，所以这里不做任何补取。
 */
function liveNodesOf(sessionId) {
    var sid = String(sessionId == null ? '' : sessionId);
    if (sid)
        studioActiveSession = sid;
    var e = sid ? studioSnapshots[sid] : null;
    return (e && e.nodes) ? e.nodes : [];
}
/**
 * `codec.serialize(ref, signal)` 的解析。契约里它**拿不到会话**，所以按「最近一次被问到的
 * 会话」优先；两个会话都有同名节点、而活跃的那个没有时，宁可不展开也不许把另一张图的话
 * 塞进 prompt —— 这条路上错一次，AI 就会拿着别人图上的描述去改代码。
 */
function resolveLiveNode(ref) {
    var hit = null, hits = 0;
    var keys = Object.keys(studioSnapshots);
    for (var i = 0; i < keys.length; i++) {
        var nodes = studioSnapshots[keys[i]].nodes || [];
        for (var j = 0; j < nodes.length; j++) {
            if (nodes[j] && nodes[j].id === ref) {
                hits++;
                if (keys[i] === studioActiveSession)
                    return nodes[j];
                if (hit === null)
                    hit = nodes[j];
                break;
            }
        }
    }
    return hits <= 1 ? hit : null;
}
/**
 * drift.stale 里那一串 { node, ref } 摊平成 `{ 引用: 1 }`。
 * 角标与检查器都要按**引用**判，而宿主的报告是按**节点**列的 —— 在这里摊一次，别在渲染里摊 N 次。
 */
function staleRefSet(drift) {
    var out = {};
    if (!drift || !drift.stale || !drift.stale.length)
        return out;
    for (var i = 0; i < drift.stale.length; i++) {
        var r = drift.stale[i] && drift.stale[i].ref;
        if (r)
            out[r] = 1;
    }
    return out;
}
/**
 * 「这一下 keydown 是输入法组字过程中的那一下吗」。
 *
 * 中文/日文输入法在候选框里按 Enter 是「确认选词」，浏览器照样派发 keydown，只是带
 * `isComposing`；Esc 同理（那一下是「取消这次组字」）。不判它的话：组字时按 Enter 会把
 * 半成品直接提交并落盘，组字时按 Esc 会把焦点踢出输入框。
 *
 * **必须读 `e.nativeEvent.isComposing`**：React 的合成事件上根本没有 `isComposing` 这个字段
 * （2026-09 实测：合成事件读到的永远是 undefined），只有原生事件上才有。`keyCode === 229`
 * 是最后一道兜底 —— 少数浏览器/输入法只给这个老字段。
 */
function isComposingEv(e) {
    if (!e)
        return false;
    var ne = e.nativeEvent || e;
    if (ne && ne.isComposing)
        return true;
    var kc = typeof e.keyCode === 'number' ? e.keyCode : (ne ? ne.keyCode : 0);
    return kc === 229;
}
/**
 * 输入框 keydown 的统一守卫：**Enter 与 Esc 都要过它**，组字中的一律不算。
 *
 * 中文/日文输入法在候选框里按 Enter 是「确认选词」、按 Esc 是「取消这次组字」，浏览器照样派发
 * keydown。不挡的话：在新图名字框里组字按 Enter 会**真的建一个文件**、在改名框里按 Enter 会真的改名、
 * 按 Esc 会把正在打的名字整行收掉。检查器那 6 个框从前各写各的 `!isComposingEv(e)`，图库这三条漏了 ——
 * 以后新增输入框一律走这里，别再各写各的。
 *
 * `Shift+Enter` 一律不算提交（多行框里那是换行）。
 */
function fieldKey(e, onEnter, onEscape) {
    if (isComposingEv(e))
        return;
    if (e.key === 'Enter') {
        if (e.shiftKey)
            return;
        if (typeof onEnter === 'function') {
            e.preventDefault();
            onEnter();
        }
        return;
    }
    if (e.key === 'Escape' && typeof onEscape === 'function')
        onEscape();
}
/**
 * 下拉框的选项表。客户端的枚举**照抄宿主**（两个分片不能 import，只能各写一份）：
 * `ARROWS`（src/host/mermaid.ts）28 种连接符、`SHAPE_WRAP` 9 种形状。
 *
 * 从前只列了其中一小撮：图里出现别的值时 `<select>` 的 value 不在选项里 → 显示成空，
 * 用户随手选一下就把它**覆盖**了（值本身没被读过，是「打开下拉」这个动作把值弄丢的）。
 * 所以渲染时一律过 `choiceList()`：**当前值一定在选项里**（不在表里就补一条并标「当前」）。
 */
var ARROW_CHOICES = [
    '-->', '---', '-.->', '==>', '~~~', '===',
    '--o', '--x', '==o', '==x',
    'o---', 'x---', 'o-->', 'x-->',
    'o--o', 'x--x', 'o--x', 'x--o',
    'o==o', 'x==x', 'o==>', 'x==>',
    'o---o', 'x---x', 'o---x', 'x---o',
    '<-->', '<==>',
];
var ARROW_TEXT = {
    '-->': '--> 实线箭头', '---': '--- 实线无箭头', '-.->': '-.-> 虚线箭头', '==>': '==> 粗线箭头',
    '~~~': '~~~ 隐线', '===': '=== 粗线',
    '--o': '--o 圆点端', '--x': '--x 叉端', '==o': '==o 粗线圆点端', '==x': '==x 粗线叉端',
};
var SHAPE_CHOICES = ['rect', 'round', 'stadium', 'circle', 'diamond', 'hex', 'cyl', 'sub', 'asym'];
/** 选项 = 全表 +（不在表里的）当前值。保证**打开下拉不丢值**。 */
function choiceList(all, cur) {
    var out = all.slice();
    var v = String(cur == null ? '' : cur);
    if (v && out.indexOf(v) < 0)
        out.push(v);
    return out;
}
/** 选项文字：常用值给中文解释，其余用原样符号；表里没有的那个（旧文件/新宿主）标「当前」。 */
function arrowChoiceText(k) {
    if (ARROW_TEXT[k])
        return ARROW_TEXT[k];
    return ARROW_CHOICES.indexOf(k) < 0 ? k + '（当前值）' : k;
}
function shapeChoiceText(k) {
    return SHAPE_CHOICES.indexOf(k) < 0 ? k + '（当前值）' : k;
}
/**
 * 「你摆到哪儿了」的跨页记忆。画布是主窗口的一个子页，而那个槽**一次只渲染一个**：
 * 切到「对话」等于卸载整个 ArchStudio，组件里的一切随之归零 —— 缩放/平移、当前子页、
 * 甚至内存里那 60 步撤销历史。于是「看一眼 AI 说了什么 → 回画布接着摆」这个来回，
 * 每一趟都要重新适应窗口、撤销历史从头开始。
 *
 * 这里只记**视图状态**，不记图内容 —— 内容永远以宿主那份（doc:get）为准，
 * 多存一份内容就又多了一份会各自漂移的真相。只在内存里，按 `<会话>|<图>` 分开。
 */
var studioMemo = {};
var STUDIO_MEMO_MAX = 6;
function studioMemoKey(sessionId, diagKey) {
    return String(sessionId == null ? '' : sessionId) + '|' + String(diagKey == null ? '' : diagKey);
}
function studioMemoFor(key, create) {
    var m = studioMemo[key];
    if (!m && create) {
        var keys = Object.keys(studioMemo);
        if (keys.length >= STUDIO_MEMO_MAX) {
            var oldest = keys[0], at = Infinity;
            for (var i = 0; i < keys.length; i++) {
                var t = studioMemo[keys[i]].at || 0;
                if (t < at) {
                    at = t;
                    oldest = keys[i];
                }
            }
            delete studioMemo[oldest];
        }
        m = studioMemo[key] = { at: Date.now() };
    }
    if (m)
        m.at = Date.now();
    return m;
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
    //
    // 三态（2026-09-23）：展开 / 收起成**一条细条**（选中保留）/ 无选中。
    // 「收起」与「关闭」必须分开：收起只把面板收掉、保留选中（还能继续用方向键微调、看高亮），
    // 关闭才取消选中。从前只有布尔开关，收面板的唯一办法是清选中 —— 想「先看看整张图再回来改」
    // 就做不到。VS Code 的 Panel、Blender 的 N 面板都是这个语义。
    var dockState = React.useState(false);
    var dockOpen = dockState[0];
    var setDockOpen = dockState[1];
    var dockHState = React.useState(STUDIO_DOCK_H);
    var dockH = dockHState[0];
    var setDockH = dockHState[1];
    // 面板当前展示的是哪个元素 + 面板是不是开着：这两个都走 ref，因为
    // 「点同一个元素 = 收起」要在**没有重渲染夹在中间**时也成立（测试里 down/up 就是同一个 act）。
    var dockForRef = React.useRef(null);
    var dockOpenRef = React.useRef(false);
    dockOpenRef.current = dockOpen;
    var dockRef = React.useRef(null);
    var sashCleanupRef = React.useRef(null);
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
    // 「现在正按着鼠标拖」——只为了让光标说实话：可拖的东西是 `cursor:move`，
    // 按下去之后应该是 `grabbing`，而不是继续骗人说「点一下试试」。纯视图状态，不落盘。
    var dragCursorState = React.useState(false);
    var dragging = dragCursorState[0];
    var setDragging = dragCursorState[1];
    // 写盘被拒（宿主已把内存回滚）时的说明。**只在画布页**挂着 —— 它说的是「你刚才那一笔没存下去」，
    // 和「源码这段解析不了」是两件事，所以是新的一块，不并进解析警告。
    var saveFailState = React.useState(null);
    var saveFail = saveFailState[0];
    var setSaveFail = saveFailState[1];
    // 隐藏手势与快捷键的静态清单（顶栏那个 `?`）。硬编码就够 —— 这不是帮助系统。
    var helpState = React.useState(false);
    var helpOpen = helpState[0];
    var setHelpOpen = helpState[1];
    // 分组：下拉框选「不属于任何组 / 某个已有组 / ＋ 新建组…」，只在选到「新建」时才用得上那个名字框。
    // 用 '#new' 当哨兵：'#' 是 groupKeyOf 唯一会剥掉、而组 id 里**绝不可能出现**的字符，撞不上真 id。
    var grpState = React.useState('');
    var groupPick = grpState[0];
    var setGroupPick = grpState[1];
    var grpNewState = React.useState('');
    var groupNewName = grpNewState[0];
    var setGroupNewName = grpNewState[1];
    var elabState = React.useState('');
    var edgeDraft = elabState[0];
    var setEdgeDraft = elabState[1];
    // 节点留言：草稿与「已投递」标记分开存。留言不走拖拽路径，不需要 committedRef 那一套。
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
    // 锚点保鲜报告（宿主算，见 drift.ts）：stale = 文件在图之后改过；uncovered = 有源码却没画到的目录。
    // 它和 fileStatus 一样是**派生数据**，随每条响应回来，界面只读。
    var driftRef = React.useRef(null);
    var driftTickState = React.useState(0);
    var setDriftTick = driftTickState[1];
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
    // 方向键微调的手势缓冲（见 nudgeSel / nudgeFlush）：{ id: 正在微调的节点, timer: 静默窗口 }
    var nudgeRef = React.useRef({ id: '', timer: null });
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
    var histState = React.useState(0);
    var setHistTick = histState[1];
    // 跨页记忆的两个 Key（见 studioMemo）：当前这一份图的身份、以及它对应的记忆条目。
    // 身份取「图库 key / 图名 / 文件绝对路径」三者之一 —— 外部文件只有 file 这条路认得出来。
    var memoKeyRef = React.useRef('');
    var diagKeyRef = React.useRef('');
    // 用户**自己动过视角**没有（滚轮缩放 / 平移 / 点「适应窗口」/ 从清单定位）。
    // 只有动过才值得记进跨页记忆：自动适应窗口算出来的那个视角，下次挂载一样能算出来。
    var userViewRef = React.useRef(false);
    // 注意：选中与详情面板**不进记忆**。详情里那一堆输入框（标题/描述/留言/锚点草稿）
    // 是「正在改的东西」，只把「面板开着」还回来而草稿是空的，等于把上一次的正文摆在
    // 回车就生效的输入框里 —— 那是数据损坏的路，不是便利。
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
                // `shape` 要跟着几何一起给连线用：锚点得投到这个形状的**可见轮廓**上，
                // 而 edgeGeometry 只拿到几何 —— 少了它，菱形/椭圆上的箭头会悬在包围盒外面。
                var s = nodeSize(splitLabel(n.label).title, 0);
                out[n.id] = { x: n.x == null ? 0 : n.x, y: n.y == null ? 0 : n.y, w: s.w, h: s.h, shape: n.shape || 'rect' };
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
    // 组 → 色相档位。只取决于「有哪些组」，与它们在文件里的顺序无关（见 runtime.ts 的 groupHueIndex）。
    var hueOfGroup = React.useMemo(function () {
        return groupHueIndex(model && model.groups ? model.groups : []);
    }, [model]);
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
        syncLiveNodes(next, sidRef.current);
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
    /**
     * 回执里的 warnings 挑出「为什么没存下去」。宿主 `persistOrRollback` 会把原因 push 成
     * 「保存失败，本次改动已回滚: <err>」，所以优先找带「回滚」的那条，找不到就退回第一条。
     */
    function rollbackWhy(list) {
        if (!list || !list.length)
            return '';
        for (var i = 0; i < list.length; i++) {
            if (String(list[i]).indexOf('回滚') >= 0)
                return String(list[i]);
        }
        return String(list[0]);
    }
    // 只负责发送，不碰历史
    function sendModel(next, note) {
        setLocal(next);
        committedRef.current = cloneModel(next);
        setSaveFail(null);
        rpc('doc:set', { model: next, note: note || '', where: cwdRef.current, session: sidRef.current }).then(function (r) {
            if (r && r.ok) {
                // 宿主**拒绝了这次写盘**，并且已经把这批改动从内存里回滚掉了（persistOrRollback）。
                // 回执里的 model / mermaid 就是回滚后的真相，必须用它重画 —— 从前这里照样把 revRef
                // 推成新修订号、界面留着那份没落盘的内容：源码页是回滚后的文本、画布页是新的（两页
                // 互相矛盾），而且修订号没变，2.5s 轮询判定「没变化」⇒ **永远不会自我纠正**。
                if (r.saved === false) {
                    applyServer(r, 'sync');
                    var why = rollbackWhy(r.warnings);
                    setSaveFail(why || '写盘被拒（原因见日志）。');
                    setStatus('没有存下去：本次改动已回滚' + (why ? '　·　' + why : ''));
                    return;
                }
                revRef.current = r.revision;
                setRevision(r.revision);
                setUpdatedBy('user');
                setMermaidText(r.mermaid);
                setDraft(r.mermaid);
                if (r.fileStatus) {
                    fileStatusRef.current = r.fileStatus || {};
                    setFileStatusTick(function (n) { return n + 1; });
                }
                // 自己刚改完图 = 刚记了一次基线，drift 该是干净的；清掉旧的那份，
                // 免得角标继续挂着「文件改过」而其实是你自己刚确认过的状态。
                driftRef.current = r.drift || null;
                setDriftTick(function (n) { return n + 1; });
                setStatus('已同步给 AI');
            }
            else {
                setStatus('同步被拒绝：' + String(r && r.error));
            }
        }).catch(function (e) { setStatus('同步失败：' + msgOf(e)); });
    }
    // 用户提交一个新状态：把「上一次已提交的状态」压进历史。
    // committedRef 而不是 modelRef —— 后者在拖拽中被逐帧改过了。
    function push(next, note) {
        // 别的东西要落盘了：先把还没提交的方向键微调收掉（见 nudgeFlush），
        // 否则这一笔会**连带上**刚才那几像素，撤销一次退不干净。
        // nudgeFlush 会先清掉自己的 id 再回调 push，所以这里不会递归。
        if (nudgeRef.current.id)
            nudgeFlush();
        remember(cloneModel(committedRef.current || modelRef.current));
        sendModel(next, note);
    }
    function undo() {
        var h = histRef.current;
        if (nudgeRef.current.id)
            nudgeFlush();
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
        // 这一份文档的身份。图库里的图有 key/diagram，**外部文件只有 file** 认得出来 ——
        // 记忆里带着撤销栈，把 A 的历史还到 B 头上就是拿 A 的内容覆盖 B，所以身份必须认准。
        var diagKey = String(r.key || r.diagram || r.file || '');
        // 版本校验：慢响应乱序返回时，拒绝低于当前已知修订号的过期响应 —— **只在同一份文档里成立**。
        // 修订号是 **per 项目槽** 的（document.ts：新槽 revision: 0、activateSlot 命中别的槽不 bump
        // 只换指针），所以拿 A 的 rev 5 去比 B 的 rev 1，会把一整份**别的文档**的最新回执丢掉：
        // 画布停在旧图上、openDiagram 照样喊「已切到「B」」，之后每次编辑都把旧文档的模型发出去
        // （doc:set 只带 where ⇒ 写进新图）。身份认不出来时（回执里没有 key/diagram/file）退回旧口径。
        var sameDoc = diagKey === '' || diagKey === currentDiagramRef.current;
        // 失败回执（宿主 restoreModel 把版本三件套一起还原，saved:false）是**权威的回滚后状态**：
        // 它的修订号会比当前小 —— 拿「修订号更小」把它挡掉就永远自我纠正不了（见 sendModel）。
        var rolledBack = r.saved === false;
        if (!rolledBack && typeof r.revision === 'number' && sameDoc && r.revision < revRef.current)
            return;
        var m = r.model;
        if (needsLayout(m))
            m = autoLayout(m);
        var prev = committedRef.current;
        var diagChanged = currentDiagramRef.current !== '' && diagKey !== '' && currentDiagramRef.current !== diagKey;
        var isSwitch = (r.lastChange && r.lastChange.by === 'switch') || diagChanged;
        if (prev === null || isSwitch) {
            // 刚挂载（prev 为空）时先问一句：是不是「从这个会话的这一页离开、又回来了」？
            // 是的话把视角 / 撤销栈还回去。**内容不吃记忆** —— 上面那份 m 才是真相。
            // 判据只看「会话 + 这一份文档」对不对得上：`lastChange.by` 在没改过图的会话里
            // 会一直停在 'switch'，拿它当「换了图」会把这辈子都挡掉。
            //
            // 记忆里**只有用户自己动过的东西**（他缩放过、他编辑过），所以「什么都没动过」
            // 的那次挂载与从前完全一样：撤销栈是空的、视角按默认自动适应窗口。
            var memoKey = studioMemoKey(sidRef.current, diagKey);
            var memo = (diagKey && !isSwitch) ? studioMemo[memoKey] : null;
            memoKeyRef.current = memoKey;
            // 撤销栈还回去，但**不还 committedRef**：它必须等于刚从宿主拿回来的这一份，
            // 否则回来后的第一次编辑会把「离开之前的旧状态」记成历史（一撤销就吃掉期间 AI 的改动）。
            if (memo && memo.hist)
                histRef.current = memo.hist;
            if (memo && memo.view) {
                viewRef.current = memo.view;
                setView(memo.view);
                // 还回来的视角本来就是「适应过窗口」的，别再自动 fit 一次把它冲掉。
                fittedRef.current = true;
            }
            else if (!memo) {
                // 只在**真的没有记忆**时才复位。从前这里是 `else`（= 没有 memo **或** memo 里没有 view），
                // 而 hist 与 view 是**独立**写的：只编辑、不动视角的人，memo 里天然只有 hist ——
                // 于是刚还回来的撤销栈被当场清空，而 `histRef.current` 正指向 memo 里那个对象，
                // 连记忆里那份也一起毁掉（切一次页就永久回不来）。
                histRef.current.past.length = 0;
                histRef.current.future.length = 0;
                setSel(null);
                setDockOpen(false);
            }
            setHistTick(function (n) { return n + 1; });
        }
        else if (origin === 'ai' || origin === 'local') {
            // AI 改图、从源码重建，同样进历史：Ctrl+Z 能把 AI 的改动退回去
            remember(cloneModel(prev));
        }
        if (diagKey) {
            currentDiagramRef.current = diagKey;
            diagKeyRef.current = diagKey;
        }
        // 微调还没落盘就来了新模型（AI / 别的会话同时改了这张图）：本地那几个像素会被下面这份
        // 新状态盖掉。**不能静默吞掉** —— 明说一句，用户再按一下就是了。
        var droppedNudge = false;
        if (nudgeRef.current.id) {
            if (nudgeRef.current.timer) {
                try {
                    nudgeRef.current.timer();
                }
                catch (e) { }
            }
            nudgeRef.current.timer = null;
            nudgeRef.current.id = '';
            droppedNudge = true;
        }
        syncLiveNodes(m, sidRef.current);
        setLocal(m);
        if (droppedNudge)
            setStatus('刚才是方向键的未提交微调，已被这一份新状态覆盖（再按一下即可）');
        // **换掉模型之后复核选中还在不在**：元素被宿主（AI / 另一个会话）删掉时，客户端这边的
        // `selRef` / `dockForRef` / `dockOpen` 谁都不会动。后果三条：(a) 撤销把它带回来再点它，
        // 第一下变成「收起」（详情打不开）；(b) 第一下 Esc 被一块**看不见的**面板吞掉；
        // (c) 在这份已不存在的选中上按 Delete → 发一次什么都没删的 doc:set + 一条假历史 +
        // 状态栏谎报「已删除节点」。所以模型一换就复核一次。
        var sNow = selRef.current;
        if (sNow) {
            var alive = false;
            if (sNow.kind === 'node') {
                for (var ai = 0; ai < m.nodes.length; ai++) {
                    if (m.nodes[ai].id === sNow.id) {
                        alive = true;
                        break;
                    }
                }
            }
            else if (sNow.kind === 'edge') {
                for (var aj = 0; m.edges && aj < m.edges.length; aj++) {
                    if (m.edges[aj].from === sNow.from && m.edges[aj].to === sNow.to) {
                        alive = true;
                        break;
                    }
                }
            }
            if (!alive) {
                selRef.current = null;
                setSel(null);
                setDockOpen(false);
                dockForRef.current = null;
                setLinkPt(null);
                setDragHint(null);
            }
        }
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
        driftRef.current = r.drift || null;
        setDriftTick(function (n) { return n + 1; });
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
            // 同一次 AI 改动只闪一次。`lastChange` 是宿主侧的模块状态：之后没人改图的话，
            // `doc:get` 每次都原样带回来 —— 于是**重新挂载**（切页回来、刷新页面）会把同一次
            // 改动再脉动 5.2 秒、顶栏再喊一遍「AI 刚更新了这张图」。那是旧消息，不是新消息。
            var hlKey = String(r.revision == null ? '' : r.revision);
            var memoForHl = studioMemoFor(memoKeyRef.current || studioMemoKey(sidRef.current, diagKeyRef.current), true);
            if (memoForHl.hlKey !== hlKey) {
                memoForHl.hlKey = hlKey;
                flash(lc.nodes);
                setStatus('AI 改动了 ' + lc.nodes.length + ' 个节点（已高亮）');
            }
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
    // ==================== 留言**不**进输入框（2026-09-21 移除） ====================
    // 这里从前有一个 effect：把当前所有未办留言按 `@id` 自动补进聊天草稿，用户按回车就发出去了。
    // 它被移除的原因是**它和提示词注入在送同一件事**：`promptText()` 每一步都把未办留言连正文
    // 一起注入（`src/host/plugin.ts`），所以那串 `@id` 是第二遍搬运。代价却是实的：
    //   ① 你正要打自己的话，框里先多出一串 `@n1 @n2`；
    //   ② 它得靠「签名 + 词边界」两套小机制才不至于重复加、不至于把 `@c11` 认成 `@c1`；
    //   ③ 最要紧的是它让「输入框是空的」这个状态根本不存在 —— 于是「空框也能发」永远测不出来。
    // 现在只有一条路：清单头部那个「交给 AI (N)」按钮，点一下替你把这一批写成一条消息并发出。
    // 手动的 `@` 引用源（register.ts 的 inputTriggers）不动 —— 那是用户主动选的，不是自动塞的。
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
    // 离开这一页时把「你摆到哪儿了」记下来（见 studioMemo）。**只记用户自己动过的**：
    // 他缩放过/平移过，才记视角；撤销栈里有东西，才记撤销栈。什么都没动过就不留记忆 ——
    // 这样「第一次打开这张图」与从前一模一样（撤销栈空、视角自动适应窗口）。
    // 图内容一个字都不记 —— 那是宿主的真相。
    //
    // 只在卸载时写：这个 effect 依赖为空，闭包里读到的是 state 的初始值，
    // 所以一律从 ref 里拿（viewRef / histRef 每次渲染都同步，见上面几行）。
    React.useEffect(function () {
        return function () {
            var key = memoKeyRef.current;
            if (!key)
                return;
            var view = userViewRef.current ? viewRef.current : null;
            var hist = histRef.current.past.length > 0 ? histRef.current : null;
            if (!view && !hist)
                return;
            var memo = studioMemoFor(key, true);
            memo.diagKey = diagKeyRef.current;
            if (view)
                memo.view = view;
            if (hist)
                memo.hist = hist;
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
                syncLiveNodes(r.model, sidRef.current);
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
            var el = document.activeElement;
            var tag = el && el.tagName ? String(el.tagName).toLowerCase() : '';
            // 焦点在输入框里时，快捷键一律不管：你打的是字，不是命令。
            if (tag === 'input' || tag === 'textarea' || tag === 'select' || (el && el.isContentEditable))
                return;
            var k = String(e.key).toLowerCase();
            if (!(e.metaKey || e.ctrlKey)) {
                // `F` = 适应窗口。**必须有「这一下属于这个面板」这道守卫**：监听器挂在 window 上，
                // 而聊天输入框就在同一页 —— 在那边打一个 f 不该把画布重新适应一遍。
                // 两种「属于」都认：焦点/事件目标在面板里，或者最后一次 pointerdown 落在面板里。
                // 后者是必需的 —— 点方块时 onNodeDown 会 stopPropagation，面板根拿不到焦点，
                // 真浏览器里焦点会掉到 body 上（那时候只看 e.target 就永远不成立）。
                if (k !== 'f')
                    return;
                var root = rootRef.current;
                var inside = !!(root && e.target && root.contains(e.target)) || hotRef.current;
                if (!inside)
                    return;
                e.preventDefault();
                fitView(true);
                return;
            }
            if (k !== 'z' && k !== 'y' && k !== '0')
                return;
            // 只有「刚在面板里点过」才接管 Ctrl/Cmd + 键；点回输入框或对话区就交还给浏览器。
            // 这条对 Ctrl+0（也可能是浏览器的重置缩放）同样成立。
            if (!hotRef.current)
                return;
            e.preventDefault();
            if (k === '0') {
                fitView(true);
                return;
            }
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
        if (force) {
            userViewRef.current = true;
            setStatus('已适应窗口');
        }
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
            // 还没适应过窗口 → 补一次适应；已经摆好了 → 只在选中元素被挤出视野时把它带回来。
            // 从前这里 `if (fittedRef.current) return` 什么都不做，于是「详情面板一展开、
            // 贴着底边的那个节点就被盖住」是一个没人管的洞。
            if (!fittedRef.current && fitView(false)) {
                fittedRef.current = true;
                return;
            }
            if (fittedRef.current)
                keepSelInView();
        });
        ro.observe(el);
        return function () { ro.disconnect(); };
    }, [tab]);
    // 面板开合 → 画布高度变了 → 把选中的东西带回视野（最小平移，不重新适应窗口）。
    React.useEffect(function () {
        if (!dockOpen)
            return;
        keepSelInView();
    }, [dockOpen]);
    // 卸载 / 切页 / 浏览器取消手势 —— 三条路归**同一类收口**（见 abortDrag）。
    // 卸载：画布住在子页里，切到「对话」就是卸载，而 rAF 回调里握着的还是旧组件的作用域 ——
    // 让它跑完只是白算一次，还会往已经没人看的状态里写。
    React.useEffect(function () {
        return function () {
            // 攒着的那一段方向键微调先落定（一条历史 + 一次 doc:set）—— 不能因为组件要没了
            // 就让用户按过的方向键消失。rpc 是模块级的，卸载之后照样发得出去。
            nudgeFlush();
            abortDrag();
            if (typeof sashCleanupRef.current === 'function')
                sashCleanupRef.current();
        };
    }, []);
    // 切走画布页（源码页 / 卸载前的那一步）：拖动中的手势必须**当场收口**。
    // 从前这里只取消了 rAF —— 本地模型留着拖动中途的浮点坐标、`.dragging` 与 `.ac-snapline`
    // 还挂在 DOM 上；切回来之后一次「面板按下、画布松开」会把这次**没完成的**位移当成正常抬手
    // 提交（状态栏说「已同步给 AI」+ 一条检查点 + 一条撤销记录）。
    React.useEffect(function () {
        if (tab === 'canvas')
            return;
        abortDrag();
        nudgeFlush();
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
            // **纯增量**：普通滚轮与 Ctrl/Cmd+滚轮都还是缩放，公式与手感逐字不变
            // （改手感不在这一轮的范围内）；只多一条 Shift+滚轮 = 横向平移。
            if (e.shiftKey && !e.ctrlKey && !e.metaKey) {
                // 横向滚轮（触控板/某些鼠标）给的是 deltaX，纵向滚轮给的是 deltaY —— 两个都认。
                var dx = e.deltaY !== 0 ? e.deltaY : e.deltaX;
                var pv = { k: v.k, x: v.x - dx, y: v.y };
                viewRef.current = pv;
                userViewRef.current = true;
                setView(pv);
                return;
            }
            var k2 = Math.min(2.6, Math.max(0.1, v.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
            var nv = { k: k2, x: sx - (sx - v.x) * (k2 / v.k), y: sy - (sy - v.y) * (k2 / v.k) };
            viewRef.current = nv;
            userViewRef.current = true;
            setView(nv);
        }
        el.addEventListener('wheel', onWheel, { passive: false });
        return function () { el.removeEventListener('wheel', onWheel); };
    }, [tab]);
    // 每个 pointermove 都 getBoundingClientRect 会强制一次布局计算（写后读）。
    // 拖动期间画布矩形的尺寸/位置不会变（变的是面板开合，而那发生在抬手），所以按下时量一次、
    // 整段拖动复用；没有缓存时才现量。
    function stageRect() {
        var el = hostRef.current;
        return el ? el.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
    }
    function toModelPt(e, rect = null) {
        var el = hostRef.current;
        if (!el)
            return { x: 0, y: 0 };
        var r = rect || el.getBoundingClientRect();
        var v = viewRef.current;
        return { x: (e.clientX - r.left - v.x) / v.k, y: (e.clientY - r.top - v.y) / v.k };
    }
    function sameSel(x, y) {
        if (!x || !y || x.kind !== y.kind)
            return false;
        if (x.kind === 'node')
            return x.id === y.id;
        return x.from === y.from && x.to === y.to;
    }
    /**
     * 点了一个元素之后，详情面板该怎么办：
     *   同一个元素 + 面板开着  → **收起**（选中保留，画布立刻长回来）
     *   别的元素 / 面板收着    → 展开并换成这个元素
     * 于是「点一下 = 打开，再点一下 = 收起」——一个动作一个开关，不需要去找关闭按钮。
     */
    function toggleDockFor(next) {
        if (dockOpenRef.current && sameSel(dockForRef.current, next)) {
            setDockOpen(false);
            return;
        }
        dockForRef.current = next;
        setDockOpen(true);
    }
    function setDockHeight(h) {
        STUDIO_DOCK_H = h == null ? null : Math.round(h);
        setDockH(STUDIO_DOCK_H);
    }
    /**
     * 拖面板上边缘调整高度（分隔条）。
     * 用 window 上的 pointermove/up 而不是元素自己的：拖动中指针经常跑到分隔条外面，
     * 挂在元素上会中途断掉。双击复位成默认高度。
     */
    function onSashDown(e) {
        if (e.button !== 0)
            return;
        e.stopPropagation();
        e.preventDefault();
        if (typeof window === 'undefined')
            return;
        var el = dockRef.current, root = rootRef.current;
        if (!el)
            return;
        var h0 = el.getBoundingClientRect().height || 200;
        var rootH = root ? (root.getBoundingClientRect().height || 600) : 600;
        var y0 = e.clientY;
        function onMove(ev) {
            var h = h0 + (y0 - ev.clientY);
            // 上限同时受两件事约束：不超过 60% 的根高，也不把画布压到低于它的最小高度
            // （.ac-stage 有 min-height:140px，加上标题栏/工具条/状态栏，再往上顶就会溢出被裁掉）。
            var cap = Math.max(140, Math.min(rootH * 0.6, rootH - 250));
            h = Math.max(120, Math.min(cap, h));
            setDockHeight(h);
        }
        function onUp() {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onUp);
            sashCleanupRef.current = null;
        }
        // pointercancel 也要摘（触屏上拖分隔条很容易被判成滚动手势）；
        // 另外把清理挂到 ref 上，组件卸载时（切到「对话」子页）也要摘掉 ——
        // 不摘的话监听器会留在 window 上，之后**不按键**移动指针也会改面板高度。
        sashCleanupRef.current = onUp;
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
    }
    /**
     * 面板开合会改变 .ac-stage 的高度：选中元素如果因此跑出视野（最典型的是贴着底边的节点，
     * 面板一展开就被盖住），就把视角**最小地**平移一下把它带回来。
     * 刻意不重新 fitView：用户自己摆的视角是一次开面板不该冲掉的东西。
     */
    function keepSelInView() {
        var el = hostRef.current;
        var s = selRef.current;
        if (!el || !s || s.kind !== 'node')
            return;
        var g = geomRef.current[s.id];
        if (!g)
            return;
        var rect = el.getBoundingClientRect();
        if (!rect.width || !rect.height)
            return;
        var v = viewRef.current;
        var pad = 26;
        var x0 = v.x + g.x * v.k - (g.w * v.k) / 2;
        var x1 = v.x + g.x * v.k + (g.w * v.k) / 2;
        var y0 = v.y + g.y * v.k - (g.h * v.k) / 2;
        var y1 = v.y + g.y * v.k + (g.h * v.k) / 2;
        var dx = 0, dy = 0;
        if (x0 < pad)
            dx = pad - x0;
        else if (x1 > rect.width - pad)
            dx = (rect.width - pad) - x1;
        if (y0 < pad)
            dy = pad - y0;
        else if (y1 > rect.height - pad)
            dy = (rect.height - pad) - y1;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5)
            return;
        var nv = { k: v.k, x: v.x + dx, y: v.y + dy };
        viewRef.current = nv;
        setView(nv);
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
    /**
     * 把当前选中元素**还没提交的草稿**先落下去，然后才允许接下来的动作改选中 / 清选中。
     *
     * 为什么必须有这一条：唯一的自动提交路径是各输入框的 `onBlur`，而换元素时浏览器给的顺序是
     * `pointerdown`（我们的处理器**同步**重渲染，输入框的值此刻已经换成新元素的草稿）
     * → `mousedown` 的默认动作才移走焦点 → 这才触发 `blur`。于是 blur 读到的可能已经是
     * **新元素**的草稿，把 B 的标题写进 A 里去 —— 比「丢掉」更坏。所以提交必须在**改选中之前**做：
     * 此刻 `selRef.current` 还是旧元素，闭包里的草稿也还是旧的，两边对得上。
     *
     * 各 `commitXxx` 自己就是幂等的（值没变就 return），所以「一个字都没改」时它一次 RPC 都不发、
     * 也不进撤销栈。
     */
    function flushDrafts() {
        var s = selRef.current;
        if (!s)
            return;
        if (s.kind === 'node') {
            commitLabel();
            // 「＋ 新建组…」那条路的名字框也是草稿；上面那个 select 是选完即时生效的，不用管。
            if (groupPick === GROUP_NEW)
                commitNewGroup();
            commitNote();
            commitFiles();
        }
        else if (s.kind === 'edge') {
            commitEdgeLabel();
        }
    }
    /**
     * 一次只允许一个手势。第二个 pointerdown（触屏第二根手指 / 第二个指针设备）落在同一个
     * `dragRef` 上时，**不能再开一次 drag** —— 那会把第一次还挂在 rAF 里的 pending 位移静默
     * 丢掉（新 drag 的 `moved=false`），抬手时于是走 `toggleDockFor` 当成点选：用户拖了一下、
     * 节点没动、详情反而被收起/展开一次。忽略它，第一次的 pending 照旧由它自己的 rAF / 抬手
     * flush 处理（`applyMove` 里那道 `cur !== mine` 的检查也是为此）。
     *
     * 注意顺序：**先把草稿落下去**（flushDrafts）再判这条。按住一个节点、改到一半、又去按
     * 别处 —— 「按下就提交草稿」是用户看得见的契约，它跟这次按下能不能开新拖动是两码事。
     */
    function gestureBusy() {
        return !!dragRef.current;
    }
    function onBackgroundDown(e) {
        // 中键也是平移（见下面）：它和左键一样会移走焦点，所以同样先落草稿。
        if (e.button !== 0 && e.button !== 1)
            return;
        flushDrafts();
        if (gestureBusy())
            return;
        // 中键在部分浏览器上会触发「自动滚动」；我们拿它当平移，就得把默认动作拦掉。
        if (e.button === 1 && typeof e.preventDefault === 'function')
            e.preventDefault();
        setDragging(true);
        // 清选中 / 收面板**不在这里做**：按下只是「一次可能的平移」的开始。真要清，得等抬手时
        // 仍然没有位移（见 onPointerUp）—— 否则「想把视角挪一下」的那一下一定先把详情面板收掉，
        // 而那正是用户正在看的东西。
        capture(e);
        var v = viewRef.current;
        dragRef.current = {
            kind: 'pan', ox: e.clientX - v.x, oy: e.clientY - v.y,
            moved: false, mid: e.button === 1, sx: e.clientX, sy: e.clientY, rect: stageRect(),
        };
    }
    function onNodeDown(e, node) {
        if (e.button !== 0)
            return;
        e.stopPropagation();
        // **先落草稿，再改选中**（见 flushDrafts）：晚一步就会把 A 的草稿写进 B。
        flushDrafts();
        // 选中与草稿面板永远跟着「最后按下的那个元素」走 —— 这是纯 UI 的事，与手势无关。
        setSel({ kind: 'node', id: node.id });
        var sp0 = splitLabel(node.label);
        setLabelDraft(sp0.title);
        setDescDraft(sp0.desc);
        setGroupPick(node.group || '');
        setGroupNewName('');
        setNoteDraft(node.note || '');
        setNoteDoneDraft(node.noteDone === true);
        setFilesDraft((node.files || []).join('\n'));
        // 但**手势**一次只允许一个（见 gestureBusy）：第二根手指按下时不能重开一次 drag ——
        // 那会把第一次还挂在 rAF 里的 pending 位移静默丢掉（新 drag 的 moved=false），
        // 抬手时于是走 toggleDockFor 当成点选：用户拖了一下、节点没动、详情反而被收起/展开一次。
        if (gestureBusy())
            return;
        // 光标从这里开始说「抓着」——放在真正开始记录拖动之前，免得早退时把 grabbing 留在屏幕上。
        setDragging(true);
        capture(e);
        var g = geomRef.current[node.id];
        if (!g)
            return;
        var rect0 = stageRect();
        var pt0 = toModelPt(e, rect0);
        dragRef.current = {
            kind: 'node', id: node.id, dx: g.x - pt0.x, dy: g.y - pt0.y,
            moved: false, sx: e.clientX, sy: e.clientY, rect: rect0,
            start: { x: g.x, y: g.y }, // 取消（pointercancel）时回滚到这里
            snap: { gx: null, gy: null }, // 吸附迟滞要记住上一步吸在哪条线上
            pending: null, raf: 0,
        };
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
        // 拖整组也会移走焦点：先把草稿落下去（见 flushDrafts）。
        flushDrafts();
        if (gestureBusy())
            return;
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
        setDragging(true);
        capture(e);
        dragRef.current = {
            kind: 'group', gid: gid, start: toModelPt(e), members: members,
            moved: false, sx: e.clientX, sy: e.clientY, rect: stageRect(),
            snap: { gx: null, gy: null }, pending: null, raf: 0,
        };
    }
    function onHandleDown(e, node) {
        if (e.button !== 0)
            return;
        if (gestureBusy())
            return;
        e.stopPropagation();
        capture(e);
        setLinkPt(toModelPt(e));
        dragRef.current = { kind: 'link', from: node.id, rect: stageRect() };
    }
    function onEdgeDown(e, from, to) {
        if (e.button !== 0)
            return;
        e.stopPropagation();
        // 与点节点同一类问题：这里也要换选中，草稿必须先落（见 flushDrafts）。
        flushDrafts();
        setSel({ kind: 'edge', from: from, to: to });
        // 连线没有拖动语义，按下就是点 —— 与节点同一条开关语义（再点一次收起详情）。
        toggleDockFor({ kind: 'edge', from: from, to: to });
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
    /**
     * 把一次 pointermove 交给 rAF 合帧：一帧最多一次状态更新。
     * 每次更新都是一次整树重渲染 + 全图重新布线；鼠标 pointermove 在 Chrome 上本来就与帧对齐，
     * 但触屏/高刷设备会给得更密，中间那些点对「跟手」没有任何贡献。
     * **抬手前必须 flush**（见 flushMove / onPointerUp），否则最后一段位移会丢。
     */
    function scheduleMove(e) {
        var d = dragRef.current;
        if (!d)
            return;
        d.pending = { x: e.clientX, y: e.clientY, alt: e.altKey === true };
        if (d.raf)
            return;
        var mine = d;
        d.raf = rafFrame(function () {
            var cur = dragRef.current;
            if (!cur || cur !== mine)
                return;
            mine.raf = 0;
            var p = mine.pending;
            mine.pending = null;
            if (p)
                applyMove(p);
        });
    }
    function flushMove() {
        var d = dragRef.current;
        if (!d)
            return;
        if (d.raf) {
            rafCancel(d.raf);
            d.raf = 0;
        }
        var p = d.pending;
        d.pending = null;
        if (p)
            applyMove(p);
    }
    /** 一次拖动的实际计算：入参是光标位置（不是事件对象），因此 rAF 合帧与直接调用走同一条路。 */
    function applyMove(p) {
        var d = dragRef.current;
        if (!d)
            return;
        var pt = toModelPt({ clientX: p.x, clientY: p.y }, d.rect);
        if (d.kind === 'node') {
            var cur = modelRef.current;
            if (!cur)
                return;
            // 抖动门槛：按下之后的一两像素移动**不算拖动**（触控板点一下很少一动不动）。
            // 过了门槛才认成拖动，也才可能进历史 —— 于是「按下就没动」的那一次干净地留给
            // onPointerUp 去开详情，而不是既开详情又记一条「用户移动了节点」的假历史。
            if (!d.moved && Math.abs(p.x - d.sx) + Math.abs(p.y - d.sy) < DRAG_SLOP)
                return;
            d.moved = true;
            // 拖动期保持**浮点**坐标：每帧 Math.round 会把它变成 k 像素的台阶（放大时肉眼可见）。
            // 落盘的坐标由宿主自己取整（`mermaid.ts` 与 normalizeModel），提交时这里也再取整一次，
            // 所以「跟手」不会换来「文件里出现小数」。
            var tx = pt.x + d.dx;
            var ty = pt.y + d.dy;
            // 吸附：阈值按屏幕像素折算（与缩放无关），带迟滞；按住 Alt 临时关掉。
            var sn = p.alt
                ? { x: tx, y: ty, gx: null, gy: null }
                : snapToPeers(cur.nodes, [d.id], tx, ty, viewRef.current.k, d.snap);
            d.snap = { gx: sn.gx, gy: sn.gy };
            setDragHint(sn.gx == null && sn.gy == null ? null : sn);
            var nodes = [];
            for (var i = 0; i < cur.nodes.length; i++) {
                var n = cur.nodes[i];
                // 用 Object.assign 保留**所有**字段：原先显式列 {id,label,shape,group,x,y} 会把
                // note / noteDone / files / link 悄悄丢掉 —— 拖一下，留言和锚点就没了（而且不报错）。
                nodes.push(n.id === d.id ? Object.assign({}, n, { x: sn.x, y: sn.y }) : n);
            }
            setLocal({ nodes: nodes, edges: cur.edges, groups: cur.groups, direction: cur.direction, extras: cur.extras });
            return;
        }
        if (d.kind === 'group') {
            var curG = modelRef.current;
            if (!curG)
                return;
            // 与节点拖动同一条门槛：折叠块「点一下」不该把整组挪走，也不该记一条历史。
            if (!d.moved && Math.abs(p.x - d.sx) + Math.abs(p.y - d.sy) < DRAG_SLOP)
                return;
            d.moved = true;
            // 组**没有自己的坐标** —— 它就是成员节点的包围盒。所以「拖动组」唯一真实的含义
            // 是把成员一起挪。位移用**起点差值**而不是逐帧累加，免得浮点误差把坐标磨偏。
            var gdx = pt.x - d.start.x;
            var gdy = pt.y - d.start.y;
            // 分组拖动也要吸附（从前只有节点吸）—— 同一个动作两种手感，本身就是「不自然」的来源。
            // 吸附参考取整组的圈心，于是整组一起贴到别的节点/组的中心线上。
            var startPos = {};
            for (var mk = 0; mk < d.members.length; mk++)
                startPos[d.members[mk].id] = d.members[mk];
            var ids = [];
            var cxs = 0, cys = 0;
            for (var mj = 0; mj < d.members.length; mj++) {
                ids.push(d.members[mj].id);
                cxs += d.members[mj].x;
                cys += d.members[mj].y;
            }
            var n0 = Math.max(1, d.members.length);
            var gsn = p.alt
                ? { x: 0, y: 0, gx: null, gy: null }
                : snapToPeers(curG.nodes, ids, cxs / n0 + gdx, cys / n0 + gdy, viewRef.current.k, d.snap);
            if (gsn.gx != null)
                gdx += gsn.gx - (cxs / n0 + gdx);
            if (gsn.gy != null)
                gdy += gsn.gy - (cys / n0 + gdy);
            d.snap = { gx: gsn.gx, gy: gsn.gy };
            setDragHint(gsn.gx == null && gsn.gy == null ? null : gsn);
            var gNodes = [];
            for (var gk = 0; gk < curG.nodes.length; gk++) {
                var gn = curG.nodes[gk];
                var base = startPos[gn.id];
                gNodes.push(base ? Object.assign({}, gn, { x: base.x + gdx, y: base.y + gdy }) : gn);
            }
            setLocal({ nodes: gNodes, edges: curG.edges, groups: curG.groups, direction: curG.direction, extras: curG.extras });
            return;
        }
        if (d.kind === 'pan') {
            if (!d.moved && Math.abs(p.x - d.sx) + Math.abs(p.y - d.sy) < DRAG_SLOP)
                return;
            d.moved = true;
            var nv = { k: viewRef.current.k, x: p.x - d.ox, y: p.y - d.oy };
            viewRef.current = nv;
            userViewRef.current = true;
            setView(nv);
            return;
        }
        if (d.kind === 'link')
            setLinkPt(pt);
    }
    function onPointerMove(e) {
        var d = dragRef.current;
        if (!d)
            return;
        scheduleMove(e);
    }
    /**
     * 提交一次拖动：**取整只在这里做一次**，然后落历史、发盘。
     * 拖动期间模型里是浮点，所以这里必须重建一份。
     */
    function commitDrag(d, note) {
        var cur = modelRef.current;
        if (!cur)
            return;
        var move = {};
        if (d.kind === 'node')
            move[d.id] = true;
        else
            for (var mi = 0; mi < d.members.length; mi++)
                move[d.members[mi].id] = true;
        var nodes = [];
        for (var i = 0; i < cur.nodes.length; i++) {
            var n = cur.nodes[i];
            nodes.push(move[n.id]
                ? Object.assign({}, n, { x: Math.round(n.x == null ? 0 : n.x), y: Math.round(n.y == null ? 0 : n.y) })
                : n);
        }
        push({ nodes: nodes, edges: cur.edges, groups: cur.groups, direction: cur.direction, extras: cur.extras }, note);
    }
    /** 把被拖的东西放回按下时的位置（浏览器把这次手势取消时用，不进历史、不写盘）。 */
    function restoreDrag(d) {
        var cur = modelRef.current;
        if (!cur)
            return;
        var back = {};
        if (d.kind === 'node')
            back[d.id] = d.start;
        else
            for (var mi = 0; mi < d.members.length; mi++)
                back[d.members[mi].id] = d.members[mi];
        var nodes = [];
        for (var i = 0; i < cur.nodes.length; i++) {
            var n = cur.nodes[i];
            var b = back[n.id];
            nodes.push(b ? Object.assign({}, n, { x: b.x, y: b.y }) : n);
        }
        setLocal({ nodes: nodes, edges: cur.edges, groups: cur.groups, direction: cur.direction, extras: cur.extras });
    }
    /**
     * 「这次手势不算数」的统一收口 —— 切页 / 卸载 / 浏览器取消手势三条路都走它。
     *
     * 为什么必须是一条路：切页与卸载从前只取消 rAF，本地模型留着拖动中途的浮点坐标、
     * 屏幕上还挂着 `.dragging` / `.ac-snapline`；之后一次「面板按下、画布松开」会把这次
     * **没完成的**位移当成正常抬手提交（状态栏说「已同步给 AI」+ 一条检查点 + 一条撤销记录）。
     * 只回滚不清理、或只清理不回滚，都会各留一半。
     *
     * 没位移过就不碰模型（restoreDrag 对「没动过」来说是空转，白白多一次整树重渲染）。
     */
    function abortDrag() {
        var d = dragRef.current;
        dragRef.current = null;
        if (d && d.raf)
            rafCancel(d.raf);
        if (d && d.moved && (d.kind === 'node' || d.kind === 'group'))
            restoreDrag(d);
        setDragging(false);
        setDragHint(null);
        setLinkPt(null);
    }
    function onPointerUp(e) {
        var d = dragRef.current;
        // **平移也要 flush**：它同样走 rAF 合帧，而「这次到底是点空白还是平移」正是由
        // 最终位移决定的 —— 不 flush 就会把一次平移误判成点空白，把选中和面板一起清掉。
        if (d)
            flushMove();
        dragRef.current = null;
        setDragging(false);
        release(e);
        setDragHint(null);
        if (!d)
            return;
        if (d.kind === 'pan') {
            // 背景上「按下 → 抬手、中间没有真实位移」= 一次点空白：清选中、收面板。
            // 平移过就不算 —— 挪视角不该把正在编辑的节点丢掉。
            // **中键不算**：中键从来就是「我要挪视角」，不该顺手把你正在看的东西清掉。
            if (!d.moved && !d.mid) {
                setSel(null);
                setDockOpen(false);
            }
            return;
        }
        if (d.kind === 'node' && d.moved) {
            commitDrag(d, '用户移动了节点');
            setStatus('已移动节点并同步');
            return;
        }
        if (d.kind === 'node' && !d.moved) {
            // 按下与抬手之间没有真实位移 = 一次「点选」。
            // 详情下挂着一块能吃掉半个画布高度的面板，所以拖动途中不展开（见下面的 toggleDockFor）。
            toggleDockFor({ kind: 'node', id: d.id });
            return;
        }
        if (d.kind === 'group' && d.moved) {
            commitDrag(d, '用户移动了分组');
            setStatus('已移动分组里的 ' + d.members.length + ' 个节点');
            return;
        }
        if (d.kind === 'link') {
            var pt = toModelPt(e, d.rect);
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
    /**
     * 浏览器把这次手势取消掉了（判成滚动/缩放/系统手势，或指针被抢走）。
     * **不能当成一次正常抬手**：那会把一次用户根本没完成的拖动写进历史、还发盘。
     * 把被拖的东西放回原位、并把 `.dragging` / `.ac-snapline` 一起清掉 —— 与切页 / 卸载同一条
     * 收口（abortDrag），一个字节都不写。
     */
    function onPointerCancel(e) {
        abortDrag();
        try {
            release(e);
        }
        catch (err) { }
    }
    /**
     * 指针捕获在拖动**中途**丢了（窗口失焦、设备被拔掉、浏览器收回捕获）。
     * 这时静默丢掉已经发生的位移是最坏的选择 —— 用户看到方块在屏幕上动过，
     * 松手后却回到原位，而且没有任何提示。当作一次正常抬手提交（能退回，见检查点）。
     */
    function onLostPointerCapture(e) {
        var d = dragRef.current;
        if (!d) {
            setLinkPt(null);
            return;
        }
        onPointerUp(e);
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
                if (isComposingEv(e))
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
            // 分层（2026-09-23 改成三段）：先收面板（**保留选中**）→ 再取消选中 → 再退焦点。
            // 与 VS Code / DevTools 的 drawer 一致：Esc 先收抽屉，选中留到下一下。
            // 于是「收起来接着摆布局」不需要先丢掉正在改的那个节点。
            if (dockOpen) {
                setDockOpen(false);
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
    /**
     * 把选中节点平移 (dx, dy)：方向键走这里，拖拽吸附落定后也走这里。
     *
     * **一次手势一条历史**：按住方向键 ≈2 秒会来 60 次自动重复，每一跳都 `push` 的话，
     * 60 步撤销栈被整条 shift 掉、宿主 50 份检查点缓冲也被冲掉 —— 用户再也退不回自己真正的
     * 编辑（改名 / 拖拽），而且界面上没有任何提示。所以这里只动**本地**模型（跟手、不写盘、
     * 不进历史），把落盘攒到 `nudgeFlush`：keyup 那一刻、静默窗口到了、或别的动作要先落盘时。
     */
    function nudgeSel(dx, dy) {
        var s = selRef.current;
        var cur = modelRef.current;
        if (!s || s.kind !== 'node' || !cur)
            return;
        var n = nudgeRef.current;
        if (n.id && n.id !== s.id)
            nudgeFlush(); // 换了节点：上一段手势先收掉，别并成一条
        if (n.timer) {
            try {
                n.timer();
            }
            catch (e) { }
            n.timer = null;
        }
        n.id = s.id;
        var next = cloneModel(cur);
        for (var i = 0; i < next.nodes.length; i++) {
            if (next.nodes[i].id !== s.id)
                continue;
            next.nodes[i].x = (next.nodes[i].x == null ? 0 : next.nodes[i].x) + dx;
            next.nodes[i].y = (next.nodes[i].y == null ? 0 : next.nodes[i].y) + dy;
            break;
        }
        setLocal(next);
        n.timer = ctxTimeout(nudgeFlush, NUDGE_IDLE_MS);
    }
    /**
     * 把攒着的那一段方向键微调落成**一笔**：一条历史 + 一次 doc:set。
     * 先清 `n.id` 再 `push` —— push 里也会调 nudgeFlush，不清就是死循环。
     */
    function nudgeFlush() {
        var n = nudgeRef.current;
        if (n.timer) {
            try {
                n.timer();
            }
            catch (e) { }
            n.timer = null;
        }
        var id = n.id;
        n.id = '';
        if (!id)
            return;
        var cur = modelRef.current;
        var base = committedRef.current;
        if (!cur || !base)
            return;
        var a = null;
        var b = null;
        for (var i = 0; i < cur.nodes.length; i++) {
            if (cur.nodes[i].id === id) {
                a = cur.nodes[i];
                break;
            }
        }
        for (var j = 0; j < base.nodes.length; j++) {
            if (base.nodes[j].id === id) {
                b = base.nodes[j];
                break;
            }
        }
        if (!a || !b)
            return;
        // 没真的动过就不写盘（按了方向键但节点已被别处挪回去的边角情况）
        if (a.x === b.x && a.y === b.y)
            return;
        push(cloneModel(cur), '用户微调了节点位置');
    }
    /** 松手（keyup）就把这一段微调落定 —— 不必等静默窗口，测试与真机都更可预期。 */
    function onKeyUp(e) {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'ArrowUp' && e.key !== 'ArrowDown')
            return;
        if (nudgeRef.current.id)
            nudgeFlush();
    }
    function deleteSel() {
        var s = selRef.current;
        var cur = modelRef.current;
        if (!s || !cur)
            return;
        // 删掉之后选中就没了：面板与「面板当前展示的是谁」都要一起复位。
        // 不复位的话，dockOpen 会一直是 true（第一下 Esc 被吞），而 dockForRef 还记着已经删掉的那个元素 ——
        // 撤销回来再点它，第一下会变成「收起」（复核第 4 条）。
        dockForRef.current = null;
        setDockOpen(false);
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
        // 新节点会顶掉面板里的草稿，所以先把旧的那份落下去（见 flushDrafts）。
        flushDrafts();
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
        // 新增的节点要**直接展开**详情（用户下一步一定是给它起名字），
        // 所以这里不是 toggle，但要把「面板现在展示的是谁」记上，后续点它才能收起。
        dockForRef.current = { kind: 'node', id: id };
        setDockOpen(true);
        setLabelDraft('新节点');
        setDescDraft('');
        setGroupPick('');
        setGroupNewName('');
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
     * 分组下拉框里「新建组」那一项的哨兵值。挑 '#' 是因为 groupKeyOf 会把 '#' 剥掉，
     * 所以**任何真实组 id 都不可能是它** —— 哨兵与真 id 不可能撞。
     */
    var GROUP_NEW = '#new';
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
        // 下拉框的三态：'' = 移出，'#new' = 交给下面那个名字框，其余 = 现有组的 id。
        // 选「新建」时先一步什么都不做 —— 名字还没打呢。
        if (groupPick === GROUP_NEW)
            return;
        applyGroup(groupPick ? groupPick : null, null);
    }
    /**
     * 把当前选中的节点放进 `want` 这个组（`want` = null 表示移出）。
     *
     * 从前这条路是「一个自由文本框」，于是有三个坑（2026-09-21 按体验反馈改成下拉框）：
     * ① 用户得**记得**组名，打错一个字就凭空多一个组、图被分成两半；
     * ② 看不出图上一共有哪些组，也不知道自己现在在哪一个；
     * ③ 空、已有、新建三种意图挤在同一个输入框里，回车之前分不出来。
     */
    function applyGroup(want, newLabel) {
        var s = selRef.current;
        var cur = modelRef.current;
        if (!s || s.kind !== 'node' || !cur)
            return;
        var next = cloneModel(cur);
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
                next.groups.push({ id: want, label: newLabel == null ? want : newLabel });
        }
        push(next, '用户改了分组');
        setStatus('已更新分组');
    }
    /** 「＋ 新建组…」那条路：把名字洗干净当 id，名字已经存在就直接认领那个组。 */
    function commitNewGroup() {
        var raw = String(groupNewName || '').trim();
        if (!raw)
            return;
        var pick = groupKeyOf(raw);
        if (!pick)
            return;
        // 先按现有组的 id 或标签认领：用户打的是给人看的名字（"AI 端"），而 id 早已被洗成 "AI端"。
        // 不认领就会凭空多出一个同名组、图被分成两半 —— 这条与旧实现一致，别删。
        var cur = modelRef.current;
        var groups = (cur && cur.groups) || [];
        var want = pick;
        for (var g = 0; g < groups.length; g++) {
            var gg = groups[g];
            if (gg && (gg.id === pick || gg.label === raw || groupKeyOf(gg.label) === pick)) {
                want = gg.id;
                break;
            }
        }
        applyGroup(want, raw);
        setGroupPick(want);
        setGroupNewName('');
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
        // 没有正文时「已投递」不成立（宿主侧也这么归一），别把半截状态写进文件
        var changed = (node.note || '') !== text;
        var done = text !== '' && noteDoneDraft === true;
        // 改过正文 = 这条留言重新变成**待递**：用户花力气改了它，就是为了让我重新看到它。
        // 不改的话，一条已投递的留言被编辑后仍然不进上下文 —— 用户改的话 AI 永远读不到，
        // 而界面上它躺在历史里，看不出任何异常（用户报的「编辑后应该自动重新打开」）。
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
                ? '留言已改动，自动放回待递（会再送一次）'
                : (done ? '留言已保存（已投递，在历史里）' : '留言已保存，AI 读一次就消失')));
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
    /** 收起（挪进历史）/ 再送一次（放回待递）。`id` 省略时作用于当前选中的节点（留言清单里按 id 调用）。 */
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
        push(next, done ? '用户收起了留言（挪进历史）' : '用户把留言放回待递');
        setStatus(done ? '已挪进历史，不会再投递' : '已放回待递，会再送一次');
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
        // 「跳到另一个节点」也会把草稿刷掉：先落下去，再换选中（见 flushDrafts）。
        flushDrafts();
        setSel({ kind: 'node', id: id });
        // 「跳到这个节点」= 明确要看它的详情，所以是展开而不是 toggle；但要记上面板展示的是谁。
        dockForRef.current = { kind: 'node', id: id };
        setDockOpen(true);
        var sp1 = splitLabel(node.label);
        setLabelDraft(sp1.title);
        setDescDraft(sp1.desc);
        setGroupPick(node.group || '');
        setGroupNewName('');
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
            userViewRef.current = true;
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
                key: 'g' + gb.id, className: 'ac-fold' + hueClassOf(hueOfGroup, gb.id),
                // 折叠块整块可拖（拖的是组内所有人）—— 但**拖不等于展开**，展开只认右边那个按钮。
                onPointerDown: (function (gid) { return function (ev) { onGroupDown(ev, gid); }; })(gb.id),
            }, React.createElement('rect', { className: 'ac-fold-box', x: fg.x - fg.w / 2, y: fg.y - fg.h / 2, width: fg.w, height: fg.h, rx: 10 }), React.createElement('text', { className: 'ac-fold-lbl', x: fg.x, y: fg.y }, fg.label), React.createElement('g', {
                className: 'ac-fold-btn',
                transform: 'translate(' + (fg.x + fg.w / 2 - 13) + ',' + fg.y + ')',
                onPointerDown: openFold,
            }, React.createElement('circle', { r: 9 }), React.createElement('text', { y: 3.6 }, '▸'))));
        }
        else {
            inner.push(React.createElement('g', {
                key: 'g' + gb.id,
                className: 'ac-grp' + hueClassOf(hueOfGroup, gb.id),
                // 展开态的组框**整块可拖**（拖的是组内所有人）：用户要的是「展开的时候，组的背景也能被
                // 捕捉并移动」—— 折叠态那个块早就能拖，展开态却只能平移画布，同一个东西一个能拖一个
                // 不能，是没有道理的。节点自己是兄弟节点、又画在组框之上，所以点节点仍然是「拖那一个」。
                onPointerDown: (function (gid) { return function (ev) { onGroupDown(ev, gid); }; })(gb.id),
            }, React.createElement('rect', { className: 'ac-group-box', x: gb.x, y: gb.y, width: gb.w, height: gb.h, rx: 12 }), React.createElement('text', { className: 'ac-group-lbl', x: gb.x + 12, y: gb.y + 17 }, String(gb.label == null ? gb.id : gb.label)), 
            // 收起按钮：收起/展开仍然**只挂在按钮上**，而它会 stopPropagation ——
            // 所以点它不会顺手把整组拖走。
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
        //
        // 「哪一侧」必须和布线器问同一个函数（`edgeSidesOf`）—— 从前这里自己算一遍
        // 「|dy| >= |dx| 就上下」，与 edgeGeometry 内部那套是同一条规则的两份拷贝；
        // 现在选边改成代价择优，两份拷贝必然分叉：端口会按 A 侧均分、线却从 B 侧出去。
        var sideGroups = {};
        for (var gi = 0; gi < model.edges.length; gi++) {
            var ge = model.edges[gi];
            if (foldMap[ge.from] && foldMap[ge.from] === foldMap[ge.to])
                continue;
            var ga2 = visGeom(ge.from);
            var gb2 = visGeom(ge.to);
            if (!ga2 || !gb2)
                continue;
            // 障碍也一起传：选边要避开「这条轴根本没路」的情况，而端口分组必须和布线器选同一条轴
            var gSides = edgeSidesOf(ga2, gb2, visList);
            for (var gend = 0; gend < 2; gend++) {
                var got = gend === 0 ? gb2 : ga2;
                var gside = gend === 0 ? gSides.a : gSides.b;
                // 端口按**可见单元**分组 —— 被折叠的组里，好几个成员节点连到外面时都挂在
                // 同一个折叠块上，用原始节点 id 当 key 会把它们拆成 n=1 的小组，
                // edgePortOffset 于是全部返回 0，箭头全叠在块边中心（审计第 5 条）。
                var gunit = gend === 0 ? ge.from : ge.to;
                var gkey = (foldMap[gunit] || gunit) + '|' + gside;
                if (!sideGroups[gkey])
                    sideGroups[gkey] = [];
                // 排序键取「对端在**这条边**上的投影坐标」：上下边比 x、左右边比 y。
                // 从前统一按 gvert 比 x/y，选边一变（比如从竖轴换到横轴），排序键也得跟着换。
                var gax = gside === 't' || gside === 'b';
                sideGroups[gkey].push({ ei: gi, end: gend, at: gax ? got.x : got.y });
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
                // 内缩量与 runtime.ts 的 NODE_HEX_INSET 是同一个数 —— 锚点要投在这个多边形的轮廓上，
                // 两处一旦不一致，箭头就会落在六边形的边外面。
                shapeEl = React.createElement('polygon', { className: 'ac-shape', points: (x0 + NODE_HEX_INSET) + ',' + y0 + ' ' + (x0 + gm.w - NODE_HEX_INSET) + ',' + y0 + ' ' + (x0 + gm.w) + ',' + gm.y + ' ' + (x0 + gm.w - NODE_HEX_INSET) + ',' + (y0 + gm.h) + ' ' + (x0 + NODE_HEX_INSET) + ',' + (y0 + gm.h) + ' ' + x0 + ',' + gm.y });
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
                className: 'ac-node' + (isSel ? ' sel' : '') + (isHl ? ' hl' : '') + hueClassOf(hueOfGroup, node.group),
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
            // 留言角标：没留言的节点什么都不画。待递=琥珀色笔，已投递=灰底勾（和清单里的两区一致）。
            node.note ? React.createElement('g', {
                key: 'note',
                className: 'ac-note-badge' + (node.noteDone ? ' done' : ''),
                transform: 'translate(' + (x0 + 9) + ',' + (y0 + 9) + ')',
            }, React.createElement('circle', { r: 8.5 }), React.createElement('text', { y: 3.6 }, node.noteDone ? '✓' : '✎')) : null, 
            // 代码锚点角标：右下角，仅当 node.files && node.files.length > 0 时渲染
            node.files && node.files.length > 0 ? (function () {
                var nStatus = (fileStatusRef.current && fileStatusRef.current[node.id]) || {};
                var isBroken = false;
                var isStale = false;
                var staleSet = staleRefSet(driftRef.current);
                for (var fi2 = 0; fi2 < node.files.length; fi2++) {
                    var fRef = node.files[fi2];
                    var fSt = nStatus[fRef] || 'unknown';
                    if (fSt !== 'ok') {
                        isBroken = true;
                        break;
                    }
                    if (staleSet[fRef])
                        isStale = true;
                }
                return React.createElement('g', {
                    key: 'file-badge',
                    // 三态：ok（品牌蓝）/ 文件在图之后改过（琥珀：还指得到，但内容可能已经不是图上说的了）/
                    // 失效（红：文件或符号找不到了）。中间那档是 drift 带来的 —— 从前它和 ok 长得一模一样。
                    className: 'ac-file-badge' + (isBroken ? ' broken' : (isStale ? ' stale' : '')),
                    transform: 'translate(' + (gm.x + gm.w / 2 - 9) + ',' + (y0 + gm.h - 9) + ')',
                }, React.createElement('circle', { r: 8.5 }), React.createElement('text', { y: 3.6 }, '▤'));
            })() : null, isSel ? React.createElement('circle', {
                className: 'ac-handle', cx: gm.x + gm.w / 2 + 10, cy: gm.y, r: 6,
                onPointerDown: (function (nd) { return function (ev) { onHandleDown(ev, nd); }; })(node),
            }, 
            // 建边**只有这一条入口**（先选中 → 把这个半径 6px 的小圆点拖到另一个方块上）。
            // 从前它一个字的说明都没有：整个界面上 0 个 title 提到连线，用户只能靠瞎试。
            React.createElement('title', null, '拖到另一个方块上建立连线')) : null));
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
        className: 'ac-svg' + (dragging ? ' dragging' : ''),
        onPointerDown: onBackgroundDown,
        onPointerMove: onPointerMove,
        onPointerUp: onPointerUp,
        onPointerCancel: onPointerCancel,
        onLostPointerCapture: onLostPointerCapture,
    }, canvasKids), 
    // 空画布 = 起始页（跟常见软件一样：给出路，而不是一片空白）。
    // 这里直接把「这个项目里已有的图」和「外面散落的 mermaid 文件」列出来，点一下就能进。
    model && model.nodes.length === 0
        ? React.createElement('div', { className: 'ac-start' }, React.createElement('div', { className: 'ac-start-title' }, '这张图还是空的'), React.createElement('div', { className: 'ac-start-actions' }, React.createElement('button', { className: 'ac-btn primary', onClick: addNode }, '＋ 加一个节点'), React.createElement('button', { className: 'ac-btn', onClick: openFilePicker }, '打开文件…'), React.createElement('button', { className: 'ac-btn', onClick: function () { loadLibrary(false); } }, '图库…')), 
        // 「怎么建一条边」这句话必须在**没有选中任何东西**的时候也说一遍 ——
        // 手柄只在选中之后才出现，等它出现再说就晚了。
        React.createElement('div', { className: 'ac-hint' }, '选中一个方块后，把它右侧的小圆点拖到另一个方块上就能连线。'), libItems.length > 0
            ? React.createElement('div', { className: 'ac-start-list' }, React.createElement('div', { className: 'ac-start-head' }, '这个项目里的图'), libItems.filter(function (it) { return !it.deleted && it.key !== libKey; }).map(function (it) {
                return React.createElement('div', { key: 's' + it.key, className: 'ac-start-row' }, React.createElement('span', { className: 'ac-start-key', title: it.dir }, it.key), React.createElement('span', { className: 'ac-start-meta' }, it.nodes + ' 节点 / ' + it.edges + ' 连线'), it.summary ? React.createElement('span', { className: 'ac-start-sum', title: it.summary }, it.summary) : null, React.createElement('button', { className: 'ac-btn', onClick: function () { openDiagram(it.key, false); } }, '打开'));
            }))
            : null, libFiles.length > 0
            ? React.createElement('div', { className: 'ac-start-list' }, React.createElement('div', { className: 'ac-start-head' }, '项目里的 mermaid 文件'), libFiles.slice(0, 6).map(function (f) {
                return React.createElement('div', { key: 'f' + f.path, className: 'ac-start-row' }, React.createElement('span', { className: 'ac-start-key', title: f.path }, f.rel), React.createElement('span', { className: 'ac-start-meta' }, Math.max(1, Math.round((f.bytes || 0) / 1024)) + ' KB'), React.createElement('button', { className: 'ac-btn', onClick: function () { openPath(f.path, false); } }, '打开'));
            }))
            : null, libItems.length === 0 && libFiles.length === 0
            ? React.createElement('div', { className: 'ac-hint' }, '这个项目里还没有图。用「＋ 加一个节点」起手，或让 AI 画一版初稿。加完节点后，选中它、把它右侧的小圆点拖到另一个方块上就能连线。')
            : null)
        : null);
    // 解析警告：宿主每条响应都带着 warnings，但从前界面一处都没读 ——
    // 「图悄悄少了一块」这件事，人和 AI 都看不见。这里列出来，最多 12 条，其余提示看日志。
    var warnBox = warnings.length > 0 ? React.createElement('div', { className: 'ac-warn' }, React.createElement('div', { className: 'ac-warn-h' }, '⚠ 解析警告 ' + warnings.length + ' 条 —— 图可能少了一块'), warnings.slice(0, 12).map(function (w, wi) {
        return React.createElement('div', { key: 'w' + wi, className: 'ac-warn-i' }, String(w));
    }), warnings.length > 12 ? React.createElement('div', { className: 'ac-warn-i' }, '…还有 ' + (warnings.length - 12) + ' 条，全部在日志里') : null) : null;
    // 锚点保鲜横幅：图还在，但代码先动了 —— 这是「这张图可能不准了」的**唯一**显式出口。
    // 刻意不塞进上面那个「解析警告」框：那条说的是「图坏了」，这条说的是「图还活着，但可能过期了」，
    // 两种话混在一起，用户就一条都不看了。只在非空时渲染。
    var driftBox = (function () {
        var dr = driftRef.current;
        if (!dr)
            return null;
        var staleN = dr.stale ? dr.stale.length : 0;
        var unN = dr.uncovered ? dr.uncovered.length : 0;
        if (staleN === 0 && unN === 0)
            return null;
        var rows = [];
        for (var di = 0; di < staleN && di < 5; di++) {
            rows.push(React.createElement('div', { key: 'ds' + di, className: 'ac-drift-i' }, '▤ ' + dr.stale[di].node + ' · ' + dr.stale[di].ref + ' —— 文件在图之后改过'));
        }
        if (staleN > 5)
            rows.push(React.createElement('div', { key: 'ds-more', className: 'ac-drift-i' }, '…还有 ' + (staleN - 5) + ' 条'));
        if (unN > 0) {
            var names = [];
            for (var ui = 0; ui < unN && ui < 6; ui++)
                names.push(dr.uncovered[ui].dir + '（' + dr.uncovered[ui].files + ' 个源文件）');
            rows.push(React.createElement('div', { key: 'du', className: 'ac-drift-i' }, '没有锚点指向的目录：' + names.join('、') + (unN > 6 ? ' 等' : '')));
        }
        // 两档语气，**不许一律喊「过期」**：
        //   有 stale → 琥珀（代码先动了，这张图现在可能说的是错的）
        //   只有 uncovered → 更淡的 hint（只是「这几处你还没画」，不是「图上错了」）
        // 一律用警告色，用户三天就会学会无视它 —— 那这条信号就白做了。
        var hasStale = staleN > 0;
        return React.createElement('div', { className: 'ac-drift' + (hasStale ? '' : ' hint') }, React.createElement('div', { className: 'ac-drift-h' }, hasStale ? ('▤ 这张图可能已经过期：' + staleN + ' 条锚点的文件在图之后改过') : '▤ 有源码没画到'), rows, React.createElement('div', { className: 'ac-drift-i' }, hasStale
            ? '在对应的方块上写留言说清楚哪里变了，或者重新标一遍锚点 —— AI 那边也会看到这条。'
            : '这不是说图上错了：要画就给它补个锚点，不画就忽略这一条。'));
    })();
    // 「这一笔没存下去」：宿主拒绝写盘并把内存回滚了（见 sendModel），回执把原因放在 warnings 里。
    // 它**只在画布页**挂着，而且是独立的一块 —— 与「解析警告」（图坏了）、「锚点保鲜」（图可能过期）
    // 是三件不同的事，混成一条用户就一条都不看了。复用警告色（这是坏消息，不是提示）。
    var saveFailBox = saveFail ? React.createElement('div', { className: 'ac-warn ac-savefail' }, React.createElement('div', { className: 'ac-warn-h' }, '⚠ 没有存下去：本次改动已回滚'), React.createElement('div', { className: 'ac-warn-i' }, String(saveFail))) : null;
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
    // ---------- 节点留言清单（待递在前，历史在后） ----------
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
    // 总量（含历史）：按钮上那个数字以前只有待递数，读起来像「统计漏了历史里的」。
    var noteTotal = noteListOpen.length + noteListDone.length;
    var noteBatch = function () {
        var diagName = (external ? externalName : (libKey || currentDiagramRef.current)) || 'architecture';
        var lines = [
            '关于画布「' + diagName + '」上的 ' + noteListOpen.length + ' 条留言，请逐条回应（点名节点 id）：',
            '',
        ];
        for (var bi = 0; bi < noteListOpen.length; bi++) {
            var bn = noteListOpen[bi];
            var bsp = splitLabel(bn.label);
            var btitle = bsp.title || bn.id;
            var bnote = String(bn.note || '').replace(/\r?\n/g, ' / ');
            lines.push((bi + 1) + '. `' + bn.id + '`（' + btitle + '）：' + bnote);
        }
        return lines.join('\n');
    };
    // 有 submit 才是「一个动作交出去」，没有就退回「只放进输入框」——旧宿主上按钮不该消失。
    var canSubmitNote = !!(inputActions && typeof inputActions.submit === 'function');
    /**
     * 把这一批待递的留言**交给 AI**，用户一个字都不用打。
     *
     * 为什么不能只是「放进输入框让用户回车」：DSH 的输入框对**空草稿**是拒绝的 —— Enter 那条路
     * 明确判了 `!empty`，而 `inputActions.submit()` 落到同一台状态机上，空草稿＋无附件是 no-op。
     * 所以「输入框空着也能发送」只能由我们补一句话达成：空着就替用户把这一批写成一条消息，
     * 已经打了字就**原样发他打的那句**（那是他要说的话，别顶掉；留言本来就每一步都在上下文里）。
     */
    function sendNotes() {
        if (!canSubmitNote)
            return;
        if (String(liveDraft == null ? '' : liveDraft).trim()) {
            inputActions.submit();
            setStatus('已发送');
            return;
        }
        if (typeof inputActions.setDraft !== 'function')
            return;
        inputActions.setDraft(noteBatch());
        // 隔一拍再提交：setDraft 与 submit 读的是同一份编辑器投影，不必赌它的更新时机
        ctxTimeout(function () { inputActions.submit(); }, 0);
        setStatus('已把 ' + noteListOpen.length + ' 条留言交给 AI');
    }
    function noteRow(nd, isDone) {
        return React.createElement('div', { key: (isDone ? 'd' : 'o') + nd.id, className: 'ac-lib-row' }, React.createElement('button', {
            className: 'ac-lib-item' + (isDone ? ' done' : ''),
            title: '定位到这个节点',
            onClick: function () { focusNode(nd.id); },
        }, (isDone ? '✓ ' : '✎ ') + nd.id + '　' + String(nd.label || '').replace(/\n/g, ' ')
            + '　·　' + String(nd.note).replace(/\n/g, ' ')), React.createElement('button', {
            className: 'ac-btn',
            onClick: function () { markNote(!isDone, nd.id); },
        }, isDone ? '再送一次' : '不发了'));
    }
    var notePanel = notesOpen ? React.createElement('div', { className: 'ac-lib ac-notes' }, React.createElement('div', { className: 'ac-lib-head' }, React.createElement('span', { className: 'grow' }, '节点留言：共 ' + noteTotal + ' 条 —— ' + noteListOpen.length + ' 条待递'
        + (noteListDone.length ? '，历史 ' + noteListDone.length + ' 条' : '')
        + '　·　待递的会被 AI 读一次就消失；历史里的不会再送（最多留 6 条）'), (inputActions && typeof inputActions.setDraft === 'function' && noteListOpen.length > 0)
        ? React.createElement('button', {
            className: 'ac-btn primary',
            title: canSubmitNote
                ? '把这一批待递的留言交给 AI —— 输入框空着也行（它会替你把这一批写成一条消息发出去）'
                : '把所有未完成留言打包填入聊天输入框',
            onClick: canSubmitNote
                ? sendNotes
                : function () {
                    inputActions.setDraft(noteBatch());
                    setStatus('已把 ' + noteListOpen.length + ' 条留言填入聊天输入框，回车发送');
                },
        }, canSubmitNote
            ? '交给 AI (' + noteListOpen.length + ')'
            : '放入输入框 (' + noteListOpen.length + ')')
        : null, React.createElement('button', { className: 'ac-btn', onClick: function () { setNotesOpen(false); } }, '收起')), noteListOpen.length === 0
        ? React.createElement('div', { className: 'ac-hint' }, '没有待递的留言。点一个节点，在下方检查器里就能写。')
        : null, noteListOpen.map(function (nd) { return noteRow(nd, false); }), noteListDone.length > 0
        ? React.createElement('div', { className: 'ac-hint' }, '历史（已投递，最多留 6 条）：')
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
    // 分组下拉框要用到三样东西：现有组（带成员数）、节点当前指着的那个组、以及
    // 「这个组 id 其实已经不在 groups 里了」这种情况（文件手改过 / 组被删过）。
    // 最后那种必须也在下拉框里有名字 —— 否则 select 找不到匹配项会退回显示第一个选项，界面就在说谎。
    var groupCounts = {};
    var groupIdSet = {};
    var allGroups = (model && model.groups) || [];
    for (var gq = 0; gq < allGroups.length; gq++)
        if (allGroups[gq])
            groupIdSet[allGroups[gq].id] = true;
    if (model && model.nodes) {
        for (var nq = 0; nq < model.nodes.length; nq++) {
            var gqn = model.nodes[nq].group;
            if (gqn)
                groupCounts[gqn] = (groupCounts[gqn] || 0) + 1;
        }
    }
    var orphanGroup = (groupPick && groupPick !== GROUP_NEW && !groupIdSet[groupPick]) ? groupPick : null;
    // 详情面板分三态：展开 / 收起成一条细条 / 没有选中。
    // 内容（`dockBody`）与外壳（标题栏 + 分隔条 + 滚动体）分开构造 —— 外壳是给两种内容共用的。
    var dockBody = null;
    if (nodeSel && dockOpen) {
        dockBody = React.createElement('div', { className: 'ac-grid' }, React.createElement('div', { className: 'ac-field full' }, React.createElement('label', null, '标题（回车生效）'), React.createElement('input', {
            className: 'ac-input', value: labelDraft, placeholder: '这个元素是什么',
            onChange: function (e) { setLabelDraft(e.target.value); },
            onBlur: commitLabel,
            onKeyDown: function (e) { if (e.key === 'Enter' && !isComposingEv(e)) {
                e.preventDefault();
                commitLabel();
            } },
        })), React.createElement('div', { className: 'ac-field full' }, React.createElement('label', null, '描述（回车生效，Shift+回车换行）'), React.createElement('textarea', {
            className: 'ac-input', style: { height: 54, resize: 'vertical', fontFamily: 'inherit' },
            placeholder: '意图：想达成什么　/　原理：为什么这么设计',
            value: descDraft,
            onChange: function (e) { setDescDraft(e.target.value); },
            onBlur: commitLabel,
            onKeyDown: function (e) { if (e.key === 'Enter' && !e.shiftKey && !isComposingEv(e)) {
                e.preventDefault();
                commitLabel();
            } },
        })), React.createElement('div', { className: 'ac-field' }, React.createElement('label', null, '形状'), React.createElement('select', { className: 'ac-select', value: nodeSel.shape, onChange: function (e) { setShape(e.target.value); } }, choiceList(SHAPE_CHOICES, nodeSel.shape).map(function (k) {
            return React.createElement('option', { key: k, value: k }, shapeChoiceText(k));
        }))), React.createElement('div', { className: 'ac-field' }, React.createElement('label', null, '分组'), React.createElement('select', {
            className: 'ac-select', value: groupPick,
            onChange: function (e) {
                var v = e.target.value;
                setGroupPick(v);
                setGroupNewName('');
                // 选「新建」时先不动模型 —— 名字还没打呢，下一步那个输入框回车才生效
                if (v === GROUP_NEW)
                    return;
                applyGroup(v ? v : null, null);
            },
        }, React.createElement('option', { value: '' }, '不属于任何组'), orphanGroup
            ? React.createElement('option', { key: 'orphan', value: orphanGroup }, orphanGroup + '（组已不存在）')
            : null, allGroups.map(function (g) {
            if (!g)
                return null;
            var cnt = groupCounts[g.id] || 0;
            // 带上成员数：两个组名字像的时候，这个数字是唯一的区分办法
            return React.createElement('option', { key: g.id, value: g.id }, String(g.label || g.id) + (cnt ? '（' + cnt + '）' : '（空）'));
        }), React.createElement('option', { value: GROUP_NEW }, '＋ 新建组…'))), groupPick === GROUP_NEW ? React.createElement('div', { className: 'ac-field full' }, React.createElement('label', null, '新组名字（回车生效）'), React.createElement('input', {
            className: 'ac-input', value: groupNewName, placeholder: '例如：AI 端', autoFocus: true,
            onChange: function (e) { setGroupNewName(e.target.value); },
            onBlur: commitNewGroup,
            onKeyDown: function (e) { if (e.key === 'Enter' && !isComposingEv(e)) {
                e.preventDefault();
                commitNewGroup();
            } },
        })) : null, React.createElement('div', { className: 'ac-field full' }, React.createElement('label', null, noteDraft
            ? (noteDoneDraft ? '留言（已投递，在历史里 —— 不会再进上下文）' : '留言（AI 读一次就消失）')
            : '留言（写给 AI：这里的疑问 / 要求 / 背景）'), React.createElement('textarea', {
            className: 'ac-input', style: { height: 54, resize: 'vertical', fontFamily: 'inherit' },
            placeholder: '例如：这里为什么不用队列？　/　这条链路还没定，先别改',
            value: noteDraft,
            onChange: function (e) { setNoteDraft(e.target.value); },
            onBlur: commitNote,
            onKeyDown: function (e) { if (e.key === 'Enter' && !e.shiftKey && !isComposingEv(e)) {
                e.preventDefault();
                commitNote();
            } },
        }), noteDraft
            ? React.createElement('div', { className: 'ac-note-actions' }, React.createElement('button', {
                className: 'ac-btn' + (noteDoneDraft ? '' : ' primary'),
                title: noteDoneDraft ? '再送一次：放回待递，AI 会再读一次' : '不发了：挪进历史，不再投递',
                onClick: function () { markNote(!noteDoneDraft); },
            }, noteDoneDraft ? '再送一次' : '不发了'), (inputActions && typeof inputActions.setDraft === 'function')
                ? React.createElement('button', {
                    className: 'ac-btn',
                    title: '把这条留言连同节点信息填入聊天输入框；框里已经有字就接在你那句后面，不顶掉你打的字',
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
                        // **框里有字就不顶**：与清单头部「交给 AI (N)」同一条规矩（sendNotes
                        // 先读 liveDraft，非空就原样发）。setDraft 是**整段替换** —— 从前这里
                        // 无条件写进去，用户在聊天框里打了一半的话被整段顶掉，而且一点提示都没有。
                        // 用户的话是他的东西：接在前面，节点信息跟在后面（追加不会丢任何字）。
                        var cur = String(liveDraft == null ? '' : liveDraft);
                        var has = !!cur.trim();
                        inputActions.setDraft(has ? cur.replace(/\s+$/, '') + '\n\n' + text : text);
                        setStatus(has
                            ? '已把节点信息接在你那句话后面（没有顶掉你打的字），回车发送'
                            : '已填入聊天输入框，回车发送');
                    },
                }, '发送给 AI')
                : null)
            : null), React.createElement('div', { className: 'ac-field full' }, React.createElement('label', null, '代码锚点（每行一个：路径 或 路径#符号）'), React.createElement('textarea', {
            className: 'ac-input', style: { height: 54, resize: 'vertical', fontFamily: 'inherit' },
            placeholder: '例如：src/host/mermaid.ts　/　src/client/runtime.ts#cloneModel',
            value: filesDraft,
            onChange: function (e) { setFilesDraft(e.target.value); },
            onBlur: commitFiles,
            onKeyDown: function (e) { if (e.key === 'Enter' && !e.shiftKey && !isComposingEv(e)) {
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
                    var drStale = !!staleRefSet(driftRef.current)[ref];
                    var isOk = st === 'ok' && !drStale;
                    var reason = isOk ? ''
                        : (drStale ? '文件在图之后改过 —— 内容可能已经不是图上说的那个了'
                            : (st === 'missing' ? '文件不在' : (st === 'symbol-missing' ? '符号不在' : '无法判定')));
                    rows.push(React.createElement('div', {
                        key: 'ref-' + fi + '-' + ref,
                        className: isOk ? undefined : (st === 'ok' ? 'ac-ref-stale' : 'ac-ref-bad'),
                    }, (isOk ? '✓ ' : '⚠ ') + ref + (reason ? ' (' + reason + ')' : '')));
                }
                return rows.length > 0 ? React.createElement('div', { className: 'ac-ref-status' }, rows) : null;
            })()
            : null), React.createElement('div', { className: 'ac-field full' }, React.createElement('button', { className: 'ac-btn danger', onClick: deleteSel }, '删除这个节点')));
    }
    else if (edgeSel && dockOpen) {
        dockBody = React.createElement('div', { className: 'ac-grid' }, React.createElement('div', { className: 'ac-field full' }, React.createElement('label', null, '标签（回车生效）'), React.createElement('input', { className: 'ac-input', value: edgeDraft, onChange: function (e) { setEdgeDraft(e.target.value); }, onBlur: commitEdgeLabel, onKeyDown: function (e) { if (e.key === 'Enter' && !isComposingEv(e))
                commitEdgeLabel(); } })), React.createElement('div', { className: 'ac-field' }, React.createElement('label', null, '样式'), React.createElement('select', { className: 'ac-select', value: edgeSel.arrow, onChange: function (e) { setArrow(e.target.value); } }, choiceList(ARROW_CHOICES, edgeSel.arrow).map(function (k) {
            return React.createElement('option', { key: k, value: k }, arrowChoiceText(k));
        }))), React.createElement('div', { className: 'ac-field' }, React.createElement('button', { className: 'ac-btn danger', onClick: deleteSel }, '删除这条连线')));
    }
    // 外壳：一条随时可见的标题栏（收起 / 关闭都在上面）+ 可拖的分隔条 + 只有内容滚动的面板体。
    // 标题栏**不滚**：面板内容再长，那两个按钮也一直够得着（VS Code 的面板标题栏同理）。
    var dockTitle = nodeSel ? ('节点 ' + nodeSel.id) : (edgeSel ? ('连线 ' + edgeSel.from + ' → ' + edgeSel.to) : '');
    var dock = null;
    if (dockBody) {
        dock = React.createElement('div', {
            className: 'ac-dock', ref: dockRef, role: 'region', 'aria-label': '元素详情',
            style: dockH ? { height: dockH + 'px' } : undefined,
        }, React.createElement('div', {
            className: 'ac-sash', role: 'separator', 'aria-orientation': 'horizontal',
            'aria-label': '拖动调整详情面板高度（双击复位）',
            title: '拖动调整高度，双击复位',
            onPointerDown: onSashDown, onDoubleClick: function () { setDockHeight(null); },
        }), React.createElement('div', { className: 'ac-dock-bar' }, React.createElement('span', { className: 'ac-dock-title', title: '点画布上同一个元素可以再点一下收起' }, dockTitle), React.createElement('button', {
            className: 'ac-dock-btn', title: '收起详情（保留选中，画布长回来；Esc 同效）',
            onClick: function () { setDockOpen(false); },
        }, '▾ 收起'), React.createElement('button', {
            className: 'ac-dock-btn', title: '关闭详情并取消选中', 'aria-label': '关闭详情',
            onClick: function () { setSel(null); setDockOpen(false); },
        }, '×')), React.createElement('div', { className: 'ac-dock-body' }, dockBody));
    }
    else if (nodeSel || edgeSel) {
        // 收起态：一条细条留在原地。它在说三件事 —— 现在的选中是谁、点这里能展开、
        // 以及选中**还在**（画布上的高亮、方向键微调都还生效）。
        dock = React.createElement('div', { className: 'ac-peek' }, React.createElement('button', {
            className: 'ac-peek-btn', 'aria-expanded': false,
            title: '展开详情面板',
            onClick: function () { setDockOpen(true); },
        }, '▴ 详情：' + dockTitle), React.createElement('button', {
            className: 'ac-dock-btn', title: '取消选中', 'aria-label': '取消选中',
            onClick: function () { setSel(null); },
        }, '×'));
    }
    var tabs = [['canvas', '画布'], ['text', '源码'], ['preview', '预览']];
    var busy = status.indexOf('加载') === 0 || status.indexOf('失败') >= 0;
    var externalName = external ? String(external).replace(/\\/g, '/').split('/').pop() : '';
    // 隐藏手势与快捷键的**静态**清单。硬编码就够 —— 这不是帮助系统，只是把「界面上一个字的
    // 提示都没有」这件事补上（Alt 关吸附、Shift+方向键、双击分隔条、Esc 三段、F/Ctrl+0，
    // 以及「Ctrl+Z 要求最后一次 pointerdown 落在面板里」这条容易当成 bug 的规矩）。
    var helpRows = [
        '拖动方块：按住左键拖。默认吸附到别的方块的中心线，按住 Alt 临时关掉吸附。',
        '微调选中节点：方向键 1px，Shift+方向键 10px。',
        '连线：先点一个方块选中它，把它右侧那个小圆点拖到另一个方块上。',
        '视角：滚轮缩放，Shift+滚轮左右平移，中键拖动平移；F 或 Ctrl/Cmd+0 = 适应窗口。',
        '撤销 / 重做：Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z。要求最后一次 pointerdown 落在面板里（点回聊天输入框就交还给浏览器）。',
        '详情面板：点同一个元素再点一次 = 收起（选中保留）；Esc 逐层退 —— 先退出输入框，再收面板，最后才取消选中。',
        '面板高度：拖它上边缘的分隔条，双击复位。',
        '整组移动：拖动组的标题条，组里的节点一起走。',
        '删除：选中后按 Delete / Backspace，或用工具条上的「删除」。',
    ];
    var helpPanel = helpOpen ? React.createElement('div', { className: 'ac-lib ac-help' }, React.createElement('div', { className: 'ac-lib-head' }, React.createElement('span', { className: 'grow' }, '快捷键与隐藏手势'), React.createElement('button', { className: 'ac-btn', onClick: function () { setHelpOpen(false); } }, '收起')), helpRows.map(function (t, hi) {
        return React.createElement('div', { key: 'h' + hi, className: 'ac-help-row' }, t);
    })) : null;
    return React.createElement('div', {
        ref: rootRef,
        className: 'ac-root',
        tabIndex: 0,
        onKeyDown: onKeyDown,
        onKeyUp: onKeyUp,
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
    }, '历史' + (historyCount > 0 ? ' ' + historyCount : '')), React.createElement('button', {
        className: 'ac-tab ac-helpbtn' + (helpOpen ? ' on' : ''),
        title: '快捷键与隐藏手势（Alt 关吸附 / Shift+方向键 10px / 双击分隔条复位 / Esc 三段 / F 适应窗口）',
        onClick: function () { setHelpOpen(!helpOpen); },
    }, '?')), React.createElement('div', { className: 'ac-tools' }, tab === 'canvas' ? React.createElement('button', { className: 'ac-btn', onClick: addNode }, '＋ 节点') : null, tab === 'canvas' ? React.createElement('button', { className: 'ac-btn', onClick: relayout }, '自动布局') : null, tab === 'canvas' ? React.createElement('button', { className: 'ac-btn', onClick: function () { fitView(true); } }, '适应窗口') : null, tab === 'canvas' ? React.createElement('button', { className: 'ac-btn danger', onClick: deleteSel, disabled: !sel }, '删除') : null, tab === 'canvas' ? React.createElement('button', { className: 'ac-btn', onClick: exportSvg, title: '导出白底 SVG，可直接贴进文档' }, 'SVG') : null, tab === 'canvas' ? React.createElement('button', { className: 'ac-btn', onClick: exportPng, title: '导出 PNG（2 倍图）' }, 'PNG') : null, tab === 'canvas' ? React.createElement('button', { className: 'ac-btn', onClick: copySource, title: '复制当前 Mermaid 源码' }, '复制源码') : null, tab === 'canvas' ? React.createElement('button', {
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
        // 这个数字从前只数**待递**的，于是把一个「留言」按钮读成了「留言总量」的人会
        // 觉得统计有 bug —— 画布上一共 7 条留言（含 4 条已投递），按钮却写着「留言 3」。
        // 现在两个都给：左边是待递数（会被投递一次），右边是总量。没有待递时只报总量。
        title: '节点留言清单：待递的会被 AI 读一次（读后就消失，历史最多留 6 条）'
            + '（共 ' + noteTotal + ' 条，其中 ' + noteListOpen.length + ' 条待递）',
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
                // 组字中的 Enter / Esc 一律不算（见 fieldKey）：不挡的话组字按 Enter 会**真的改名**、
                // 按 Esc 会把正在打的名字整行收掉。
                onKeyDown: function (e) {
                    fieldKey(e, function () { renameDiagram(it.key); }, function () { patchPicker({ renameKey: '', renameDraft: '' }); });
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
        onKeyDown: function (e) { fieldKey(e, function () { openDiagram(picker.draft, true); }); },
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
        onKeyDown: function (e) { fieldKey(e, function () { openPath(picker.pathDraft, false); }); },
    }), React.createElement('button', {
        className: 'ac-btn primary', disabled: !String(picker.pathDraft || '').trim(),
        onClick: function () { openPath(picker.pathDraft, false); },
    }, '打开'))) : null, notePanel, histPanel, helpPanel, 
    // 画布页的横幅一共三条，各说各的事，**并列不合并**（语气不同，混起来就成了一条谁也不看的噪音）：
    //   1) 解析警告 .ac-warn —— 「图可能少了一块」，宿主解析时丢掉了东西；
    //   2) 没存下去 .ac-warn.ac-savefail —— 「你刚才那一笔被回滚了」；
    //   3) 锚点保鲜 .ac-drift —— 「图还活着，但可能过期了」（两档语气，见 driftBox）。
    // 从前 1 只在源码页，而用户 90% 的时间在画布页 —— 最该看到它的地方反而看不到。
    tab === 'canvas'
        ? React.createElement(React.Fragment, null, warnBox, saveFailBox, driftBox)
        : null, React.createElement('div', { className: 'ac-body' }, tab === 'canvas' ? stage : tab === 'text' ? textPane : previewPane), dock, React.createElement('div', { className: 'ac-statusbar' }, React.createElement('span', { className: 'ac-dot' + (busy ? ' busy' : '') }), React.createElement('span', { className: 'grow' }, status), 
    // 缩放比例：滚轮改了 k，但界面上从前没有任何地方说现在是几倍 —— 缩到 12% 还找不到
    // 「图去哪了」的时候，这个数字是唯一的线索。
    React.createElement('span', { className: 'ac-zoom', title: '当前缩放（滚轮 / Shift+滚轮横移 / 中键拖动平移 / F 适应窗口）' }, Math.round(view.k * 100) + '%'), model ? React.createElement('span', null, model.nodes.length + ' 节点 · ' + model.edges.length + ' 连线 · r' + revision + ' · ' + (updatedBy === 'ai' ? 'AI' : updatedBy === 'user' ? '你' : updatedBy)) : null));
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
            // **按会话取**：这里的 `session` 就是投影（`{ sessionId }`，见 ui-input-trigger）。
            // 拿不到这个会话的快照就返回空 —— 空比「别的项目那张图的节点」好得多。
            var nodes = liveNodesOf(session && session.sessionId);
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
        // 契约要求这个钩子**同步、无副作用**（渲染路径），所以它只读这个会话已经攒下的快照。
        //
        // 它同时也是**展开的闸门**：这个会话没有这个 id，token 就不会被装饰成上下文块，
        // 于是 codec.serialize 也不会被叫到它头上（见下面那条注释）。
        lexicon: function (session) {
            var nodes = liveNodesOf(session && session.sessionId);
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
                // 契约里这条**拿不到会话**（`serialize(ref, signal)`，见 ui-input-trigger 的
                // serializeReference）。所以解析交给 resolveLiveNode：优先「最近一次被问到的
                // 那个会话」，同名节点分不清就宁可不展开 —— 绝不把另一张图的话塞进 prompt。
                var target = resolveLiveNode(ref);
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
