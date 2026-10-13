// 浏览器侧基础设施：样式、mermaid 运行时加载、几何与自动布局、图标。
// 这一半的沙箱里 React / host / styles / ctx 都是闭包参数，不是全局。
// ==================== 样式（为窄侧栏设计） ====================
var STUDIO_CSS = [
  '.ac-root{height:100%;min-height:200px;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base,#14161a);color:var(--dsw-alias-label-primary,#e8eaed);font:13px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;overflow:hidden;position:relative;z-index:1}',
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
  // 节点卡片：标题（.ac-lbl —— 保持既有契约，它的 textContent 就是标题本身；描述与引用行仅在检查器中查看）。
  '.ac-node .ac-lbl{fill:var(--dsw-alias-label-primary,#e8eaed);font-size:13px;font-weight:600;text-anchor:middle;dominant-baseline:central;pointer-events:none;user-select:none}',
  '.ac-node:focus-visible{outline:none}',
  '.ac-node:focus-visible .ac-shape{stroke:var(--dsw-alias-brand-primary,#4c8dff);stroke-width:2.4}',
  '.ac-edge{fill:none;stroke:var(--ac-line);stroke-width:1.6}',
  '.ac-edge.dashed{stroke-dasharray:6 5}',
  '.ac-edge.thick{stroke-width:3}',
  '.ac-edge.invisible{stroke:transparent}',
  '.ac-edge.sel{stroke:var(--dsw-alias-brand-primary,#4c8dff);stroke-width:2.6}',
  '.ac-edge.thick.sel{stroke-width:4}',
  // 命中区**故意做宽**（14px）：线只有 1.6px，靠它自己几乎点不中。这里只补一条悬停反馈 ——
  // 光标扫过时那条细线才现形（平时完全透明），否则用户根本不知道这条线是可以点的。
  // **stroke-width 不许动**：实测 14px 的命中区是「细线可点」的全部依据。
  '.ac-edge-hit{fill:none;stroke:transparent;stroke-width:14;cursor:pointer}',
  '.ac-edge-hit:hover{stroke:var(--dsw-alias-brand-primary,#4c8dff);stroke-opacity:.35}',
  '.ac-arrowhead{fill:var(--ac-line)}',
  '.ac-arrowcross{stroke:var(--ac-line);stroke-width:1.8;stroke-linecap:round;fill:none}',
  '.ac-junc-dot{fill:var(--ac-line);stroke:var(--dsw-alias-bg-base,#14161a);stroke-width:1.5}',
  '.ac-tag-badge{pointer-events:none;user-select:none}',
  '.ac-tag-badge rect{fill:var(--dsw-alias-brand-primary,#4c8dff);fill-opacity:.12;stroke:var(--dsw-alias-brand-primary,#4c8dff);stroke-width:1}',
  '.ac-tag-badge text{fill:var(--dsw-alias-brand-primary,#4c8dff);font-size:10px;font-weight:700;text-anchor:middle;dominant-baseline:central}',
  '.ac-elbl{fill:var(--dsw-alias-label-secondary,#9aa3af);font-size:11.5px;text-anchor:middle;dominant-baseline:central;pointer-events:none;user-select:none;paint-order:stroke fill;stroke:var(--dsw-alias-bg-base,#14161a);stroke-width:4px;stroke-linejoin:round}',
  '.ac-elbl-bg{fill:var(--dsw-alias-bg-base,#14161a)}',
  '.ac-group-box{fill:var(--dsw-alias-bg-layer-1,#1b1e23);fill-opacity:.5;stroke:var(--ac-line);stroke-dasharray:5 5;stroke-width:1.4;cursor:move}',
  // 组名从前是 cursor:pointer —— 可点它**不**折叠（收起只认那个按钮），所以那个手型是在骗人。
  // 现在它和组框一样，是「抓住整组」的意思。
  '.ac-group-lbl{fill:var(--ac-line);font-size:11.5px;font-weight:600;cursor:move;paint-order:stroke fill;stroke:var(--dsw-alias-bg-base,#14161a);stroke-width:4px;stroke-linejoin:round}',
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
  '.ac-note-badge.done text{fill:var(--dsw-alias-bg-base,#14161a)}',
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
  // **默认收起成一行**（`.open` 才展开明细）：常驻的明细会一直占着画布高度。
  '.ac-drift{flex:0 0 auto;max-height:26%;overflow:auto;margin:0 8px 6px;padding:7px 9px;border:1px solid #e8a33d;border-radius:8px;background:rgba(232,163,61,.06)}',
  '.ac-drift:not(.open){padding:5px 8px}',
  '.ac-drift-h{color:#e8a33d;font-size:11.5px;font-weight:600;margin-bottom:4px;cursor:pointer;user-select:none}',
  '.ac-drift:not(.open) .ac-drift-h{margin-bottom:0}',
  '.ac-drift-h:hover{opacity:.85}',
  '.ac-drift-tgl{color:var(--dsw-alias-label-secondary,#9aa3af);font-weight:500;white-space:nowrap}',
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
].join('\n')

// ==================== RPC 出口 ====================
// 同一份界面要能在两种宿主下跑：
//   动态 Package —— 沙箱给的 host.call（Package 私有 RPC）
//   装成真插件   —— 客户端模块给的 fetch（打到 host 的 /arch-canvas/rpc）
// 差别收在这一个函数里，界面其余部分不关心。
var RPC = null

function rpc(method: string, args?: any) {
  if (typeof RPC === 'function') return RPC(method, args)
  if (typeof host !== 'undefined' && host && typeof host.call === 'function') return host.call(method, args)
  return Promise.reject(new Error('没有可用的 RPC 出口（既没有注入 rpc，也没有 host.call）'))
}

// ==================== Mermaid 运行时（可选增强） ====================
var MERMAID_CDN = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js'
var mermaidLoading = null
var mermaidInited = false

function msgOf(e) {
  if (e && typeof e === 'object' && typeof e.message === 'string') return e.message
  return String(e)
}

function loadScript(src) {
  return new Promise(function (resolve, reject) {
    var el = document.createElement('script')
    el.src = src
    el.async = true
    el.onload = function () { resolve(window.mermaid) }
    el.onerror = function () { try { el.remove() } catch (e) {} reject(new Error('无法加载 ' + src)) }
    document.head.appendChild(el)
  })
}

function ensureMermaid() {
  if (window.mermaid) return Promise.resolve(window.mermaid)
  if (mermaidLoading) return mermaidLoading
  mermaidLoading = (async function () {
    var urls = []
    try {
      var info = await rpc('mermaid:info')
      if (info && typeof info.url === 'string' && info.url) urls.push(info.url)
    } catch (e) {}
    urls.push(MERMAID_CDN)
    var last = null
    for (var i = 0; i < urls.length; i++) {
      try {
        var api = await loadScript(urls[i])
        if (api) return api
      } catch (e) { last = e }
    }
    mermaidLoading = null
    throw last || new Error('mermaid 不可用')
  })()
  return mermaidLoading
}

function kindOf(shape) {
  if (shape === 'diamond') return 'diamond'
  if (shape === 'cyl') return 'cyl'
  if (shape === 'circle') return 'ellipse'
  if (shape === 'hex') return 'hex'
  if (shape === 'round' || shape === 'stadium') return 'round'
  if (shape === 'sub') return 'sub'
  return 'rect'
}

/**
 * 28 种连接符视觉样式表（与宿主 ARROWS 28 项完全对齐）：
 * - 线宽（普通 vs thick）
 * - 虚线（dashed）
 * - 隐线（invisible）
 * - 两端形状：start / end 分别为 'arrow' | 'circle' | 'cross' | 'none'
 */
var ARROW_STYLE = {
  '-->':   { thick: false, dashed: false, invisible: false, start: 'none',   end: 'arrow' },
  '---':   { thick: false, dashed: false, invisible: false, start: 'none',   end: 'none' },
  '-.->':  { thick: false, dashed: true,  invisible: false, start: 'none',   end: 'arrow' },
  '==>':   { thick: true,  dashed: false, invisible: false, start: 'none',   end: 'arrow' },
  '~~~':   { thick: false, dashed: false, invisible: true,  start: 'none',   end: 'none' },
  '===':   { thick: true,  dashed: false, invisible: false, start: 'none',   end: 'none' },
  '--o':   { thick: false, dashed: false, invisible: false, start: 'none',   end: 'circle' },
  '--x':   { thick: false, dashed: false, invisible: false, start: 'none',   end: 'cross' },
  '==o':   { thick: true,  dashed: false, invisible: false, start: 'none',   end: 'circle' },
  '==x':   { thick: true,  dashed: false, invisible: false, start: 'none',   end: 'cross' },
  'o---':  { thick: false, dashed: false, invisible: false, start: 'circle', end: 'none' },
  'x---':  { thick: false, dashed: false, invisible: false, start: 'cross',  end: 'none' },
  'o-->':  { thick: false, dashed: false, invisible: false, start: 'circle', end: 'arrow' },
  'x-->':  { thick: false, dashed: false, invisible: false, start: 'cross',  end: 'arrow' },
  'o--o':  { thick: false, dashed: false, invisible: false, start: 'circle', end: 'circle' },
  'x--x':  { thick: false, dashed: false, invisible: false, start: 'cross',  end: 'cross' },
  'o--x':  { thick: false, dashed: false, invisible: false, start: 'circle', end: 'cross' },
  'x--o':  { thick: false, dashed: false, invisible: false, start: 'cross',  end: 'circle' },
  'o==o':  { thick: true,  dashed: false, invisible: false, start: 'circle', end: 'circle' },
  'x==x':  { thick: true,  dashed: false, invisible: false, start: 'cross',  end: 'cross' },
  'o==>':  { thick: true,  dashed: false, invisible: false, start: 'circle', end: 'arrow' },
  'x==>':  { thick: true,  dashed: false, invisible: false, start: 'cross',  end: 'arrow' },
  'o---o': { thick: false, dashed: false, invisible: false, start: 'circle', end: 'circle' },
  'x---x': { thick: false, dashed: false, invisible: false, start: 'cross',  end: 'cross' },
  'o---x': { thick: false, dashed: false, invisible: false, start: 'circle', end: 'cross' },
  'x---o': { thick: false, dashed: false, invisible: false, start: 'cross',  end: 'circle' },
  '<-->':  { thick: false, dashed: false, invisible: false, start: 'arrow',  end: 'arrow' },
  '<==>':  { thick: true,  dashed: false, invisible: false, start: 'arrow',  end: 'arrow' },
}

function arrowStyleOf(arrow) {
  return ARROW_STYLE[arrow] || { thick: false, dashed: false, invisible: false, start: 'none', end: 'arrow' }
}

function arrowMarkerUrl(shape) {
  if (shape === 'arrow') return 'url(#ac-arrow)'
  if (shape === 'circle') return 'url(#ac-circle)'
  if (shape === 'cross') return 'url(#ac-cross)'
  return undefined
}

function arrowMarkerRef(arrow) {
  var s = arrowStyleOf(arrow)
  return arrowMarkerUrl(s.end) || ''
}

// ==================== 几何与布局 ====================
function visualLen(s) {
  var n = 0
  var str = String(s == null ? '' : s)
  for (var i = 0; i < str.length; i++) n += str.charCodeAt(i) > 0x2e7f ? 2 : 1
  return n
}

// 纯函数记忆化：避免每帧拖拽时对全图节点重复拆行与计算视觉宽度。
// 用无原型对象存：标签可以叫 `__proto__` / `constructor`，普通 {} 会把它们当继承属性返回。
var nodeSizeCache = Object.create(null)
var nodeSizeCacheCount = 0

// extraRows：标签之外还要占几行（目前只有「引用」那一行）。
// 它必须进缓存键 —— 同一个标签的节点，带 @file 与不带 @file 的高度不同，
// 共用一条缓存会让先算出来的那个尺寸污染另一个。
function nodeSize(label, extraRows) {
  var text = String(label == null ? '' : label)
  var extra = extraRows > 0 ? Math.round(extraRows) : 0
  var key = text + '\u0000' + extra
  var cached = nodeSizeCache[key]
  if (cached) return cached
  var lines = text.split('\n')
  var widest = 4
  for (var i = 0; i < lines.length; i++) widest = Math.max(widest, visualLen(lines[i]))
  var res = {
    w: Math.round(Math.min(300, Math.max(104, widest * 8.2 + 36))),
    h: Math.round(Math.max(44, (lines.length + extra) * 19 + 26)),
  }
  if (nodeSizeCacheCount > 2000) {
    nodeSizeCache = Object.create(null)
    nodeSizeCacheCount = 0
  }
  nodeSizeCache[key] = res
  nodeSizeCacheCount++
  return res
}

// rAF 合帧：拖动时一帧最多做一次状态更新。Chrome 的鼠标 pointermove 本来就与帧对齐，
// 但触屏 / 高刷设备会给得更密，而每一次更新都是一整棵画布的重渲染 + 全图重新布线。
// 拿不到 requestAnimationFrame（老环境、测试桩）就**同步执行** —— 宁可掉帧，也不能不动。
function rafFrame(fn) {
  try {
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      return window.requestAnimationFrame(fn)
    }
  } catch (e) {}
  fn()
  return 0
}

function rafCancel(id) {
  try {
    if (id && typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(id)
    }
  } catch (e) {}
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
var SNAP_PX = 8          // 进入吸附的半径（屏幕像素）
var SNAP_EXIT_PX = 14    // 脱开吸附的半径（屏幕像素，> 进入半径才有迟滞）
var SNAP_MIN_MODEL = 2   // 折算出来的半径下限：放得很大时也要吸得住 1~2px 的对齐
var SNAP_MAX_MODEL = 28  // 上限：缩得很小时不至于吸住半张画布

/** 屏幕像素半径折算成模型单位（与缩放无关的手感）。 */
function snapRadius(k, px) {
  var kk = (typeof k === 'number' && k > 0) ? k : 1
  return Math.min(SNAP_MAX_MODEL, Math.max(SNAP_MIN_MODEL, px / kk))
}

/**
 * 一条轴上的吸附决定（纯函数，好测）。`active` 是上一步吸住的那条线（null = 没吸住）。
 * 迟滞的写法就是这两句：**已经吸住的先判脱开半径，没吸住的才判进入半径**。
 */
function snapAxis(raw, cands, enter, exit, active) {
  if (active != null && active !== undefined) {
    if (Math.abs(active - raw) <= exit) return { v: active, line: active }
    return { v: raw, line: null }
  }
  var best = null, bd = Infinity
  for (var i = 0; i < cands.length; i++) {
    var d = Math.abs(cands[i] - raw)
    if (d < bd) { bd = d; best = cands[i] }
  }
  if (best != null && bd <= enter) return { v: best, line: best }
  return { v: raw, line: null }
}

/**
 * `movingIds` 是这次被拖着一起动的节点 id（分组拖动时是一整组）——
 * 拖动中的节点不能当自己的吸附候选，否则整组会吸在自己的旧坐标上动不了。
 */
function snapToPeers(nodes, movingIds, x, y, k, prev) {
  var move = {}
  if (movingIds && typeof movingIds.length === 'number') {
    for (var mi = 0; mi < movingIds.length; mi++) move[movingIds[mi]] = true
  } else if (movingIds != null) {
    move[movingIds] = true
  }
  var cxs = [], cys = []
  for (var i = 0; i < nodes.length; i++) {
    var n = nodes[i]
    if (!n || move[n.id]) continue
    if (n.x == null || n.y == null) continue
    cxs.push(n.x)
    cys.push(n.y)
  }
  var sx = snapAxis(x, cxs, snapRadius(k, SNAP_PX), snapRadius(k, SNAP_EXIT_PX), prev ? prev.gx : null)
  var sy = snapAxis(y, cys, snapRadius(k, SNAP_PX), snapRadius(k, SNAP_EXIT_PX), prev ? prev.gy : null)
  return { x: sx.v, y: sy.v, gx: sx.line, gy: sy.line }
}

// 标签 = 标题（第一段）+ 描述（其余段）。节点默认只画标题，点开（选中）才画描述 ——
// 所以这套分/合规则被**四处**共用：节点渲染、gstate 的尺寸、检查器的两个输入框、提交时的合成。
// 任何一处自己 split 一下，都会在某个方向上和别处对不上。
function splitLabel(label) {
  var s = String(label == null ? '' : label)
  var i = s.indexOf('\n')
  if (i < 0) return { title: s, desc: '' }
  return { title: s.slice(0, i), desc: s.slice(i + 1) }
}

// 标题是单行（换行压成空格）；描述保留内部换行、只去掉尾部空行。
// 描述为空时**不留尾随换行** —— 否则「只有标题」的节点会凭空多出一个空描述段，
// 每往返一次就多一行，节点也越画越高。
function composeLabel(title, desc) {
  var t = String(title == null ? '' : title).replace(/\r?\n/g, ' ')
  var d = String(desc == null ? '' : desc).replace(/\s+$/, '')
  return d ? (t + '\n' + d) : t
}

