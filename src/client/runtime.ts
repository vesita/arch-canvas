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
  '.ac-edge-hit{fill:none;stroke:transparent;stroke-width:14;cursor:pointer}',
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

function arrowMarkerRef(arrow) {
  if (arrow === '---' || arrow === '~~~') return ''
  return 'url(#ac-arrow)'
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

// 节点上「引用」那一行的文案：取路径最后一段、去掉 `#符号`，多条锚点追加 +N。
// 只给人看，不参与寻址 —— 完整路径在底部检查器与 AI 提示词里。
function refRowText(files) {
  if (!files || !files.length) return ''
  var first = String(files[0] == null ? '' : files[0]).split('#')[0].replace(/\/+$/, '')
  var base = first.split('/').pop() || first
  return base ? ('▤ ' + base + (files.length > 1 ? ' +' + (files.length - 1) : '')) : ''
}

// 引用行占不占一行 —— nodeSize 与渲染必须用同一个判据，否则节点高度和文字对不上。
function refRowCount(files) {
  return refRowText(files) ? 1 : 0
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

// ==================== 源码页分词 ====================
// 只用来给源码页着色，**不做任何校验**（语义校验归宿主的 mermaid.ts 解析器）。
// 认的是 AC 那个 mermaid 子集：`%%` 注释行分三类、关键字、引号标签、箭头、id。
// 三类注释的颜色不同是有意的：`%%!` 是格式说明（最淡，可以无视）、
// `@pos/@link/@summary` 是元数据、`@note/@done/@file` 是**用户写在这个元素上的东西**。
var HL_ARROWS = ['<==>', '<-->', '-.->', '==>', '-->', '---', '~~~', '===', '->']
var HL_KEYWORDS = {
  flowchart: 1, graph: 1, subgraph: 1, end: 1, direction: 1,
  classDef: 1, class: 1, style: 1, linkStyle: 1, click: 1, link: 1,
}

function tokenizeMermaidLine(line) {
  var out = []
  var t = String(line == null ? '' : line)
  var trimmed = t.replace(/^\s+/, '')
  if (trimmed.slice(0, 2) === '%%') {
    var lead = t.slice(0, t.length - trimmed.length)
    var kind = 'c'
    if (trimmed.slice(0, 3) !== '%%!') {
      if (/^%%\s*@(pos|link|summary)\b/.test(trimmed)) kind = 'm'
      else if (/^%%\s*@(note|done|file)\b/.test(trimmed)) kind = 'u'
    }
    if (lead) out.push({ k: '', s: lead })
    out.push({ k: kind, s: trimmed })
    return out
  }
  var i = 0
  var buf = ''
  // 先切掉行首缩进（真实文件里节点行是缩进的，注入给 AI 的视图也带空白），再认行首关键字。
  // 关键字必须在这里单独认：进了下面的字符循环，`flowchart` 会被当普通 id 一路累积进 buf，
  // 等遇见空白时 buf 已非空，就再也认不出它是关键字了 ——
  // 这个 bug（顶格版与缩进版）是被 test/ui.render.mjs 的 [4g] 断言连着抓出来两次的。
  var lead = /^\s*/.exec(t)[0]
  if (lead) { out.push({ k: '', s: lead }); i = lead.length }
  var km = /^([A-Za-z][A-Za-z0-9_]*)/.exec(t.slice(i))
  if (km && HL_KEYWORDS[km[1]]) {
    out.push({ k: 'k', s: km[1] })
    i += km[1].length
  }
  function flush() { if (buf) { out.push({ k: 'i', s: buf }); buf = '' } }
  while (i < t.length) {
    var ch = t.charAt(i)
    if (ch === '"') {
      flush()
      var j = i + 1
      while (j < t.length && t.charAt(j) !== '"') j++
      out.push({ k: 's', s: t.slice(i, Math.min(j + 1, t.length)) })
      i = j + 1
      continue
    }
    var arrow = null
    for (var a = 0; a < HL_ARROWS.length; a++) {
      if (t.slice(i, i + HL_ARROWS[a].length) === HL_ARROWS[a]) { arrow = HL_ARROWS[a]; break }
    }
    if (arrow) { flush(); out.push({ k: 'a', s: arrow }); i += arrow.length; continue }
    if ('[](){}|&;,>'.indexOf(ch) >= 0) { flush(); out.push({ k: 'p', s: ch }); i++; continue }
    buf += ch
    i++
  }
  flush()
  return out
}

// ==================== 组 → 色相档位 ====================
// 为什么不是「第几个组就用第几档」：删掉中间一个组会让它后面**所有**组换色，而用户记住的
// 是「那个绿框」。所以按组 id 哈希定位。哈希撞档时按 id 字典序往后探 —— 分配只取决于
// 「有哪些组」（顺序无关），现实中最多在插入新组时动一个组。
// 组多于 8 个时色相从头复用（图上一眼看得出「不是同一组」，但两组同色 —— 有意的取舍）。
var GROUP_HUE_COUNT = 8
function groupHueIndex(groups) {
  var ids = []
  var seen = {}
  for (var i = 0; i < (groups || []).length; i++) {
    var id = groups[i] && groups[i].id
    if (typeof id !== 'string' || id === '' || seen[id]) continue
    seen[id] = true
    ids.push(id)
  }
  ids.sort()
  var used = {}
  var out = {}
  for (var k = 0; k < ids.length; k++) {
    var h = 5381
    for (var j = 0; j < ids[k].length; j++) h = ((h * 33) ^ ids[k].charCodeAt(j)) >>> 0
    var slot = h % GROUP_HUE_COUNT
    for (var probe = 0; probe < GROUP_HUE_COUNT; probe++) {
      var cand = (slot + probe) % GROUP_HUE_COUNT
      if (!used[cand]) { slot = cand; break }
    }
    used[slot] = true
    out[ids[k]] = slot
  }
  return out
}

// 拿不到档位（没有组、节点不属于任何组）时返回空串 —— 节点于是落在中性的 --ac-line 上。
function hueClassOf(hueOf, id) {
  var h = hueOf && id ? hueOf[id] : undefined
  return typeof h === 'number' ? ' ac-h' + h : ''
}

function needsLayout(model) {
  if (!model || !model.nodes || model.nodes.length === 0) return false
  for (var i = 0; i < model.nodes.length; i++) {
    var n = model.nodes[i]
    if (typeof n.x !== 'number' || typeof n.y !== 'number') return true
  }
  return false
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

var LAYOUT_ORDER_ROUNDS = 4      // 中位数扫描轮数（上下来回交替）
var LAYOUT_ORDER_MAX_EDGES = 600 // 超过这个边数就不做「比交叉数」这一步（它是 O(E²)）

/** Kosaraju 求强连通分量。**迭代版**：递归版在几千节点的长链上会爆栈。 */
function sccOf(ids, edges) {
  var adj = {}, radj = {}
  for (var i = 0; i < ids.length; i++) { adj[ids[i]] = []; radj[ids[i]] = [] }
  for (var e = 0; e < edges.length; e++) {
    adj[edges[e][0]].push(edges[e][1])
    radj[edges[e][1]].push(edges[e][0])
  }
  // 第一趟：正图上的完成序
  var order = [], seen = {}
  for (var s = 0; s < ids.length; s++) {
    if (seen[ids[s]]) continue
    seen[ids[s]] = true
    var stack = [[ids[s], 0]]
    while (stack.length) {
      var top = stack[stack.length - 1]
      var nb = adj[top[0]]
      if (top[1] < nb.length) {
        var w = nb[top[1]++]
        if (!seen[w]) { seen[w] = true; stack.push([w, 0]) }
      } else { order.push(top[0]); stack.pop() }
    }
  }
  // 第二趟：反图按完成序的逆序走，一次能捞到的就是同一个分量
  var comp = {}, count = 0
  for (var k = order.length - 1; k >= 0; k--) {
    var root = order[k]
    if (comp[root] !== undefined) continue
    comp[root] = count
    var st2 = [root]
    while (st2.length) {
      var v = st2.pop()
      var back = radj[v]
      for (var j = 0; j < back.length; j++) {
        if (comp[back[j]] === undefined) { comp[back[j]] = count; st2.push(back[j]) }
      }
    }
    count++
  }
  // 成员按 ids 的原始顺序收集：同层里的先后必须稳定，不能随 DFS 的访问顺序漂
  var comps = []
  for (var c = 0; c < count; c++) comps.push([])
  for (var m = 0; m < ids.length; m++) comps[comp[ids[m]]].push(ids[m])
  return { comp: comp, comps: comps }
}

/** 缩点图上的最长路径分层：环已经折掉，所以不需要任何上界。 */
function layerOfComps(comps, edges, comp) {
  var n = comps.length
  var cl = []
  for (var i = 0; i < n; i++) cl.push(0)
  var ce = [], seen = {}
  for (var e = 0; e < edges.length; e++) {
    var a = comp[edges[e][0]], b = comp[edges[e][1]]
    if (a === b) continue
    var key = a + '>' + b
    if (seen[key]) continue
    seen[key] = true
    ce.push([a, b])
  }
  for (var pass = 0; pass <= n; pass++) {
    var changed = false
    for (var m = 0; m < ce.length; m++) {
      var cand = cl[ce[m][0]] + 1
      if (cand > cl[ce[m][1]]) { cl[ce[m][1]] = cand; changed = true }
    }
    if (!changed) break
  }
  return cl
}

function groupByLayer(ids, layer) {
  var layers = {}
  for (var i = 0; i < ids.length; i++) {
    var L = layer[ids[i]] || 0
    if (!layers[L]) layers[L] = []
    layers[L].push(ids[i])
  }
  return layers
}

function sortedLayerKeys(layers) {
  var keys = []
  for (var k in layers) keys.push(Number(k))
  keys.sort(function (a, b) { return a - b })
  return keys
}

/** 中位数（barycenter）启发式：上下交替扫，每层按「邻居那一层的平均位次」重排。 */
function medianOrder(ids, layer, edges, rounds) {
  var layers = groupByLayer(ids, layer)
  var keys = sortedLayerKeys(layers)
  var pos = {}
  for (var i = 0; i < keys.length; i++) {
    var row0 = layers[keys[i]]
    for (var j = 0; j < row0.length; j++) pos[row0[j]] = j
  }
  var pred = {}, succ = {}
  for (var m = 0; m < ids.length; m++) { pred[ids[m]] = []; succ[ids[m]] = [] }
  for (var e = 0; e < edges.length; e++) { succ[edges[e][0]].push(edges[e][1]); pred[edges[e][1]].push(edges[e][0]) }
  for (var r = 0; r < rounds; r++) {
    var down = r % 2 === 0
    var seq = down ? keys : keys.slice().reverse()
    for (var s = 0; s < seq.length; s++) {
      var row = layers[seq[s]]
      var key = {}
      for (var n = 0; n < row.length; n++) {
        var nb = down ? pred[row[n]] : succ[row[n]]
        var sum = 0, cnt = 0
        for (var b = 0; b < nb.length; b++) {
          var p = pos[nb[b]]
          if (p !== undefined) { sum += p; cnt++ }
        }
        key[row[n]] = cnt ? sum / cnt : pos[row[n]]
      }
      // 平局按 id 定序：同一份图跑两次必须得到同一个布局
      row.sort(function (a, b) { return (key[a] - key[b]) || (a < b ? -1 : a > b ? 1 : 0) })
      for (var f = 0; f < row.length; f++) pos[row[f]] = f
    }
  }
  return layers
}

/** 按层摆坐标。`rev` 只影响摆出去的值，**不能去改累加器本身** —— 从前的写法是
 *  `along = -along`，于是累加器被来回翻转，BT / RL 下第 0 层和第 2 层会落到同一个 y。 */
function layoutPositions(sizes, layers, horiz, rev, GAP) {
  var keys = sortedLayerKeys(layers)
  var pos = {}
  var along = 0
  for (var i = 0; i < keys.length; i++) {
    var bucket = layers[keys[i]] || []
    var deep = 0
    for (var d = 0; d < bucket.length; d++) deep = Math.max(deep, horiz ? sizes[bucket[d]].w : sizes[bucket[d]].h)
    var span = GAP * Math.max(0, bucket.length - 1)
    for (var s = 0; s < bucket.length; s++) span += horiz ? sizes[bucket[s]].h : sizes[bucket[s]].w
    var acc = -span / 2
    var axis = rev ? -along : along
    for (var n = 0; n < bucket.length; n++) {
      var sz = sizes[bucket[n]]
      var cross = acc + (horiz ? sz.h : sz.w) / 2
      acc += (horiz ? sz.h : sz.w) + GAP
      pos[bucket[n]] = horiz ? { x: axis, y: cross } : { x: cross, y: axis }
    }
    along += deep + 84
  }
  return pos
}

/** 两条边（按节点中心连直线）真交叉的条数。共端点的直接跳过 —— 它们必然交在端点。 */
function crossingsOf(pos, edges) {
  var n = 0
  for (var i = 0; i < edges.length; i++) {
    var a1 = edges[i][0], b1 = edges[i][1]
    var p1 = pos[a1], p2 = pos[b1]
    if (!p1 || !p2) continue
    for (var j = i + 1; j < edges.length; j++) {
      var a2 = edges[j][0], b2 = edges[j][1]
      if (a1 === a2 || a1 === b2 || b1 === a2 || b1 === b2) continue
      var p3 = pos[a2], p4 = pos[b2]
      if (!p3 || !p4) continue
      var den = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x)
      if (den === 0) continue
      var t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / den
      var u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / den
      if (t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9) n++
    }
  }
  return n
}

/** 把一份 model 排成坐标。纯函数：不改入参，返回新的 nodes 数组。 */
function autoLayout(model) {
  var nodes = model.nodes || []
  if (nodes.length === 0) return model
  var byId = {}
  var sizes = {}
  var ids = []
  for (var i = 0; i < nodes.length; i++) {
    byId[nodes[i].id] = nodes[i]
    ids.push(nodes[i].id)
    sizes[nodes[i].id] = nodeSize(nodes[i].label, refRowCount(nodes[i].files))
  }
  var pairs = []
  for (var e = 0; e < (model.edges || []).length; e++) {
    var ed = model.edges[e]
    if (byId[ed.from] && byId[ed.to] && ed.from !== ed.to) pairs.push([ed.from, ed.to])
  }
  var dir = model.direction || 'TD'
  var horiz = dir === 'LR' || dir === 'RL'
  var rev = dir === 'BT' || dir === 'RL'
  var GAP = horiz ? 74 : 56

  // 1) 分层：先把环折成强连通分量，再在缩点图上做最长路径
  var part = sccOf(ids, pairs)
  var cl = layerOfComps(part.comps, pairs, part.comp)
  var layer = {}
  for (var t = 0; t < ids.length; t++) layer[ids[t]] = cl[part.comp[ids[t]]]

  // 2) 同层顺序：中位数启发式，但只在不更差的时候才采纳（见文件头那两条实测）
  var layers = groupByLayer(ids, layer)
  var pos = layoutPositions(sizes, layers, horiz, rev, GAP)
  if (pairs.length > 1 && pairs.length <= LAYOUT_ORDER_MAX_EDGES) {
    var alt = medianOrder(ids, layer, pairs, LAYOUT_ORDER_ROUNDS)
    var altPos = layoutPositions(sizes, alt, horiz, rev, GAP)
    if (crossingsOf(altPos, pairs) < crossingsOf(pos, pairs)) { layers = alt; pos = altPos }
  }

  var out = []
  for (var q = 0; q < nodes.length; q++) {
    // **整份复制，只改坐标。** 从前这里是逐字段重建 `{id,label,shape,group,x,y}` ——
    // 于是点一下「自动布局」（或加载一张没带坐标的图触发它），所有节点的 files / note /
    // noteDone / link 全被丢掉，而且紧接着经 doc:set 落盘，**永久损坏**。
    // （2026-09-20 客户端逻辑审计抓到的头号问题；`refRowCount(nodes[i].files)` 上面还在用
    //   files 算尺寸，就更说明这些字段本该跟着走。）
    out.push(Object.assign({}, nodes[q]))
  }
  for (var f = 0; f < out.length; f++) {
    var pt = pos[out[f].id]
    if (pt) { out[f].x = Math.round(pt.x); out[f].y = Math.round(pt.y) }
  }
  return { nodes: out, edges: model.edges, groups: model.groups, direction: dir, extras: model.extras }
}

// ==================== 连线几何：正交折线 + 避让（draw.io 式） ====================
// 为什么是正交折线而不是曲线：曲线避让要在连续空间里解几何，很难做对；正交布线把候选
// 路径限制在「方块边线 ± 余量」这些格线上，避让就退化成「找一条不穿过任何方块的折线」，
// 几十个节点规模下是微秒级的事。两条抱怨（线穿过别的方块、弧度和拐弯不好看）一并解决。
//
// 契约不变：仍返回 { d, mid }（mid 给标签用）。新增的两个参数都是可选的，
// 老调用（只传 a、b）仍然得到一条合法的正交折线。
var EDGE_PAD = 12       // 避让余量：线离方块至少这么远
var EDGE_LANE = 16      // 绕行时走到障碍外侧的额外距离
var EDGE_PORT_INSET = 8 // 端口离方块两角的边距，别让线从角上出去
var EDGE_PORT_MIN_GAP = 12 // 同一侧两个端口的最小间距 ≈ 箭头宽度，否则箭头会叠在一起
var EDGE_CORNER = 8     // 拐角的圆角半径：折线不是画成直角，而是「稍微转个弯」（用户要的观感）
var EDGE_HOP = 5        // 交叉处的半圆拱桥半径：十字交叉时有一条线从上面跨过去
var EDGE_LANE_STEP = 12 // 中位线被占时，往两侧让的步长（并行线之间要有肉眼可见的间隔）
var EDGE_LANE_GAP = 10  // 两条平行线窄于这个距离就算「画在一起了」，必须错开

/** 轴对齐线段是否真的穿过矩形。用严格不等号，所以线可以**贴着**障碍边界走。 */
function edgeSegHitsRect(x1, y1, x2, y2, r) {
  if (y1 === y2) {
    if (y1 <= r.y1 || y1 >= r.y2) return false
    return Math.max(x1, x2) > r.x1 && Math.min(x1, x2) < r.x2
  }
  if (x1 === x2) {
    if (x1 <= r.x1 || x1 >= r.x2) return false
    return Math.max(y1, y2) > r.y1 && Math.min(y1, y2) < r.y2
  }
  return false
}

function edgePathHits(pts, obs) {
  for (var i = 0; i + 1 < pts.length; i++) {
    for (var j = 0; j < obs.length; j++) {
      if (edgeSegHitsRect(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, obs[j])) return true
    }
  }
  return false
}

/** 点是否在形状**内部**（往里收 0.5px：贴着轮廓走不算「穿进去」）。与 perimeterPoint 同一套尺寸约定。 */
function shapeInterior(px, py, g, kind) {
  var a = Math.max(0.5, g.w / 2 - 0.5), b = Math.max(0.5, g.h / 2 - 0.5)
  var dx = px - g.x, dy = py - g.y
  if (kind === 'ellipse') return Math.hypot(dx / a, dy / b) < 1
  if (kind === 'diamond') return Math.abs(dx) / a + Math.abs(dy) / b < 1
  if (kind === 'hex') {
    // 六边形 = 上下直边 + 左右两条斜边，对 |dy| 分层：边界 |x| = w/2 - 14·(|y|/(h/2))
    var hw = Math.max(0.5, g.w / 2 - 0.5), hh = Math.max(0.5, g.h / 2 - 0.5)
    if (Math.abs(dy) >= hh) return false
    var hexInset = Math.min(NODE_HEX_INSET, hw)
    return Math.abs(dx) < hw - hexInset * (Math.abs(dy) / hh)
  }
  // rect / round / sub / cyl / stadium：圆角矩形（rect 的 rx=9）
  var r = kind === 'rect' ? 9 : Math.min(a, b)
  var cx = Math.max(Math.abs(dx) - (a - r), 0)
  var cy = Math.max(Math.abs(dy) - (b - r), 0)
  return Math.hypot(cx, cy) < r
}

/**
 * 线段是否真的穿进这个节点的**可见形状**。包围盒只当快速预筛 —— 非矩形节点的锚点本来就落在
 * 包围盒内部（轮廓上），拿包围盒当判据会把每条候选都判成自穿透（复核第 1 条：那会让整条线
 * 落到不看障碍的兜底上，画出来正好穿过别的方块）。只有真的进了形状才算命中，于是「从轮廓上
 * 出发往外走」天然不算。
 */
function edgeSegHitsNode(x1, y1, x2, y2, g) {
  var box = { x1: g.x - g.w / 2, y1: g.y - g.h / 2, x2: g.x + g.w / 2, y2: g.y + g.h / 2 }
  if (!edgeSegHitsRect(x1, y1, x2, y2, box)) return false
  var kind = kindOf(g.shape)
  if (kind === 'rect') return true            // 矩形填满包围盒，不必再采样
  var L = Math.abs(x2 - x1) + Math.abs(y2 - y1)
  var steps = Math.max(2, Math.min(48, Math.ceil(L / 6)))
  for (var i = 1; i < steps; i++) {
    var t = i / steps
    if (shapeInterior(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, g, kind)) return true
  }
  return false
}

/** 一条折线有没有穿进**自己**这个节点（a / b 各查一次）。 */
function edgePathHitsSelf(pts, g) {
  if (!g || typeof g.w !== 'number' || typeof g.h !== 'number') return false
  for (var i = 0; i + 1 < pts.length; i++) {
    if (edgeSegHitsNode(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, g)) return true
  }
  return false
}

/** 把折点整理成一条干净的路径：去掉零长段与共线的多余拐点。`hops` 是交叉处的拱桥（可省）。 */
function edgeCleanPath(pts, hops?: any) {
  var hp = (hops && hops.length) ? hops : []
  var out = []
  for (var i = 0; i < pts.length; i++) {
    var last = out[out.length - 1]
    if (last && Math.abs(last.x - pts[i].x) < 0.5 && Math.abs(last.y - pts[i].y) < 0.5) continue
    out.push({ x: pts[i].x, y: pts[i].y })
  }
  var res = [out[0]]
  for (var k = 1; k + 1 < out.length; k++) {
    var p = res[res.length - 1], c = out[k], n = out[k + 1]
    var col = (Math.abs(p.x - c.x) < 0.5 && Math.abs(c.x - n.x) < 0.5) ||
              (Math.abs(p.y - c.y) < 0.5 && Math.abs(c.y - n.y) < 0.5)
    if (!col) res.push(c)
  }
  if (out.length > 1) res.push(out[out.length - 1])
  // 出 d 要同时照顾两件事，所以按**段**走一遍，而不是按顶点：
  //   1) 拐角抹圆（EDGE_CORNER）：折线不是折成硬直角，而是「稍微转个弯」；
  //   2) 交叉处的拱桥（EDGE_HOP）：和别的连线十字相交时，在交点上画一段半圆从上面跨过去。
  //      用户的原话是「十字交叉时应该有一条线弯折一下」—— 要的就是这个，不是把直角抹圆。
  //
  // 两处的让位半径都收敛到「相邻线段的一半以内」，短段自动退化成尖角：
  // 圆角/拱桥永远吃不掉一整条线段，也就不会把路径抹穿或反向。
  // 注意返回的 `pts` 仍是**尖角折线**：避让判定、交叉检测与标签中点都按它算，只是画出来带修饰。
  var d = 'M ' + res[0].x + ' ' + res[0].y
  var lx = res[0].x, ly = res[0].y
  function lineTo(x, y) {
    if (Math.abs(x - lx) < 0.01 && Math.abs(y - ly) < 0.01) return
    d += ' L ' + x + ' ' + y
    lx = x; ly = y
  }
  var np = res.length
  // 每个顶点让给拐角多少（两端不让：那是方块边界，抹了箭头就离开边框）
  var trim = []
  for (var v = 0; v < np; v++) {
    var rv = 0
    if (v > 0 && v < np - 1) {
      var rl1 = edgeSegLen(res[v - 1], res[v])
      var rl2 = edgeSegLen(res[v], res[v + 1])
      rv = Math.min(EDGE_CORNER, rl1 / 2, rl2 / 2)
      if (!(rv > 0.6) || !(rl1 > 0) || !(rl2 > 0)) rv = 0
    }
    trim.push(rv)
  }
  for (var k = 0; k + 1 < np; k++) {
    var A = res[k], B = res[k + 1]
    var L = edgeSegLen(A, B)
    if (L <= 0) continue
    var ux = (B.x - A.x) / L, uy = (B.y - A.y) / L
    var t0 = trim[k]
    var t1 = L - trim[k + 1]
    // 本段上的拱桥：把 hop 点投影到本段参数上，只收真的落在这条线上的
    var hs = []
    for (var h2 = 0; h2 < hp.length; h2++) {
      var hx = hp[h2].x - A.x, hy = hp[h2].y - A.y
      var dt = hx * ux + hy * uy
      var off = Math.abs(-hx * uy + hy * ux)
      if (off < 1.0) hs.push(dt)
    }
    hs.sort(function (q1, q2) { return q1 - q2 })
    lineTo(A.x + ux * t0, A.y + uy * t0)
    var cur = t0
    for (var h3 = 0; h3 < hs.length; h3++) {
      var hb = hs[h3] - EDGE_HOP, he = hs[h3] + EDGE_HOP
      // 与已画出来的圆角/拱桥打架就放弃这条 —— 少一个拱只是不好看，叠在一起是烂的
      if (hb < cur + 0.5 || he > t1 - 0.5) continue
      lineTo(A.x + ux * hb, A.y + uy * hb)
      var aex = A.x + ux * he, aey = A.y + uy * he
      // sweep 固定为 1：拱一律鼓在前进方向的**左侧**（屏幕上从左往右的线就往上鼓）
      d += ' A ' + EDGE_HOP + ' ' + EDGE_HOP + ' 0 0 1 ' + aex + ' ' + aey
      lx = aex; ly = aey
      cur = he
    }
    lineTo(A.x + ux * t1, A.y + uy * t1)
    if (trim[k + 1] > 0) {
      var C = res[k + 1], N = res[k + 2]
      var l3 = edgeSegLen(C, N)
      var ex = C.x + (N.x - C.x) * (trim[k + 1] / l3), ey = C.y + (N.y - C.y) * (trim[k + 1] / l3)
      d += ' Q ' + C.x + ' ' + C.y + ' ' + ex + ' ' + ey
      lx = ex; ly = ey
    }
  }
  return { d: d, pts: res }
}

/** 轴对齐折线一段的长度。 */
function edgeSegLen(a, b) {
  return Math.abs(b.x - a.x) + Math.abs(b.y - a.y)
}

/** 两条同向平行线段是否「贴在一起」：线距小于 gap 且投影相交。 */
function edgeLaneConflict(vert, c, lo, hi, u) {
  if (!u || u.vert !== vert) return false
  if (Math.abs(u.c - c) >= EDGE_LANE_GAP) return false
  return Math.min(hi, u.hi) - Math.max(lo, u.lo) > 0
}

/** 取出折线里所有**内部**线段，作为「这条线占掉的车道」记下来。 */
function edgePathLanes(pts) {
  var out = []
  for (var i = 1; i + 1 < pts.length; i++) {
    var a = pts[i], b = pts[i + 1]
    var vert = Math.abs(a.x - b.x) < 0.5
    out.push(vert
      ? { vert: true, c: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y) }
      : { vert: false, c: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) })
  }
  return out
}

/** 标签落点：取整条路径**按弧长**的一半处 —— 折线不再是直线，两端中点会偏。 */
function edgeMidOfPath(pts) {
  var total = 0
  for (var i = 0; i + 1 < pts.length; i++) {
    total += Math.abs(pts[i + 1].x - pts[i].x) + Math.abs(pts[i + 1].y - pts[i].y)
  }
  if (total <= 0) return { x: pts[0].x, y: pts[0].y }
  var half = total / 2
  for (var k = 0; k + 1 < pts.length; k++) {
    var seg = Math.abs(pts[k + 1].x - pts[k].x) + Math.abs(pts[k + 1].y - pts[k].y)
    if (half <= seg || k + 2 === pts.length) {
      var t = seg <= 0 ? 0 : half / seg
      return { x: pts[k].x + (pts[k + 1].x - pts[k].x) * t, y: pts[k].y + (pts[k + 1].y - pts[k].y) * t }
    }
    half -= seg
  }
  return { x: pts[0].x, y: pts[0].y }
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
  if (!p || !(p.n > 1) || !(p.i >= 0)) return 0
  var usable = Math.max(0, span - 2 * EDGE_PORT_INSET)
  var gap = usable / (p.n - 1)
  if (gap < EDGE_PORT_MIN_GAP) gap = EDGE_PORT_MIN_GAP
  var maxGap = (span - 4) / (p.n - 1)
  if (gap > maxGap) gap = Math.max(0, maxGap)
  return (p.i - (p.n - 1) / 2) * gap
}

// ==================== 选边与落点（2026-09-23 重写） ====================
// 从前的规则是「两节点中心的 |dx| / |dy| 谁大就走竖轴、否则走横轴，侧边按 delta 的正负取」。
// 那是 React Flow「Simple Floating Edges」那套的简化版：它只看中心，**不看两个方块各自有多大**，
// 于是「一个矮胖节点斜对一个方块」这类常见摆法会选错轴、白绕几十像素
// （实测 420 个相对位置：平均多绕 24.8px，26.7% 的位置多绕 40px 以上）。
// 工业界（draw.io 的端口方向掩码、JointJS 的 anchor + boundary connectionPoint、
// React Flow 官方 floating edges）的共同做法是**先算落点、再定侧**。这里照这个思路做，
// 只保留现有正交路由器能吃的形状（两端走同一条轴），把「选哪条轴、哪条边」交给代价函数。
var NODE_HEX_INSET = 14  // 六边形左右两个斜角的水平内缩 —— 与 studio.ts 画形状时用的是同一个数

function sideNormal(s) {
  if (s === 't') return { x: 0, y: -1 }
  if (s === 'b') return { x: 0, y: 1 }
  if (s === 'l') return { x: -1, y: 0 }
  return { x: 1, y: 0 }
}

/** 这条边上的「半个跨度」：上下边是 w/2，左右边是 h/2。 */
function sideHalfSpan(g, s) {
  return (s === 't' || s === 'b') ? g.w / 2 : g.h / 2
}

/** 边心（不带端口偏移）—— 只用来估代价。 */
function sideCenter(g, s) {
  var n = sideNormal(s)
  return { x: g.x + n.x * g.w / 2, y: g.y + n.y * g.h / 2 }
}

/** 两个方块在四条边外侧的间隙（负数 = 这一轴上两方块重叠）。 */
function edgeGaps(a, b) {
  return {
    r: b.x - b.w / 2 - (a.x + a.w / 2),
    l: a.x - a.w / 2 - (b.x + b.w / 2),
    b: b.y - b.h / 2 - (a.y + a.h / 2),
    t: a.y - a.h / 2 - (b.y + b.h / 2),
  }
}

/**
 * 这条轴上「朝对端」的那条边。两方块在该轴上有间隙时取有间隙的那条（这就是「朝向」的
 * 准确含义）；没有间隙（在该轴上重叠）就退化成「对端在哪个方向就走哪边」。
 */
function sideOnAxis(a, b, vertical, gp) {
  if (vertical) {
    if (gp.b >= 0) return 'b'
    if (gp.t >= 0) return 't'
    return b.y >= a.y ? 'b' : 't'
  }
  if (gp.r >= 0) return 'r'
  if (gp.l >= 0) return 'l'
  return b.x >= a.x ? 'r' : 'l'
}

/**
 * 这条轴「走不走得通」的粗估：用边心 + 中位线附近几条候选试着铺一下，全部撞障碍就返回 false。
 * 它**不替代**布线器（那边会扫十几条车道、还有两段绕行），只用来在选边时避开「这条轴根本没路」
 * 的情况 —— 真图上实测过：不看障碍时，选出来的那条轴会被障碍全部拒掉，最后落到不看障碍的
 * 硬穿兜底，画出一条穿过第三方块的线。
 */
function axisLooksClear(a, b, sa, sb, vertical, obs) {
  var p = sideCenter(a, sa), q = sideCenter(b, sb)
  var mid0 = vertical ? (p.y + q.y) / 2 : (p.x + q.x) / 2
  var tries = [mid0]
  for (var t = 1; t <= 2; t++) { tries.push(mid0 - t * EDGE_LANE_STEP); tries.push(mid0 + t * EDGE_LANE_STEP) }
  for (var i = 0; i < tries.length; i++) {
    var m = tries[i]
    var pts = vertical
      ? [{ x: p.x, y: p.y }, { x: p.x, y: m }, { x: q.x, y: m }, { x: q.x, y: q.y }]
      : [{ x: p.x, y: p.y }, { x: m, y: p.y }, { x: m, y: q.y }, { x: q.x, y: q.y }]
    if (!edgePathHits(pts, obs)) return true
  }
  return false
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
  if (!a || !b) return { a: 'b', b: 't', vertical: true }
  var gp = edgeGaps(a, b)
  var gpB = edgeGaps(b, a)   // 反着来一遍：sideOnAxis 的「间隙」是按第一个参数算的
  // 障碍按布线器同一套规则做（带 EDGE_PAD 的余量 + 两端自身零余量的 guard）
  var obs = []
  if (obstacles) {
    for (var oi = 0; oi < obstacles.length; oi++) {
      var o = obstacles[oi]
      if (!o || o === a || o === b) continue
      if (typeof o.w !== 'number' || typeof o.h !== 'number') continue
      obs.push({
        x1: o.x - o.w / 2 - EDGE_PAD, y1: o.y - o.h / 2 - EDGE_PAD,
        x2: o.x + o.w / 2 + EDGE_PAD, y2: o.y + o.h / 2 + EDGE_PAD,
      })
    }
  }
  var best = null, bestCost = Infinity
  for (var vi = 0; vi < 2; vi++) {
    var vertical = vi === 0
    var sa = sideOnAxis(a, b, vertical, gp)
    var sb = sideOnAxis(b, a, vertical, gpB)
    var p = sideCenter(a, sa), q = sideCenter(b, sb)
    var cost = Math.abs(q.x - p.x) + Math.abs(q.y - p.y)
    var gap = vertical ? Math.max(gp.b, gp.t) : Math.max(gp.r, gp.l)
    var gapOther = vertical ? Math.max(gp.r, gp.l) : Math.max(gp.b, gp.t)
    if (gap < 0 && gapOther > 0) cost += 200 + Math.min(600, -gap * 2)
    // 粗估只查**别人的方块**：自己的盒子会误伤「锚点在轮廓上」（见 edgeGeometry 里那段注释）
    if (obstacles && !axisLooksClear(a, b, sa, sb, vertical, obs)) cost += 400
    var na = sideNormal(sa), nb = sideNormal(sb)
    // 出了门先朝背离对端的方向走 = 回头线（旧代码里那个 `inverted` 兜的正是这一类）
    if ((b.x - p.x) * na.x + (b.y - p.y) * na.y < 0) cost += 900
    if ((a.x - q.x) * nb.x + (a.y - q.y) * nb.y < 0) cost += 900
    // 出点落在对端身体里、或入点落在本端身体里 = 自穿透
    if (Math.abs(p.x - b.x) < b.w / 2 && Math.abs(p.y - b.y) < b.h / 2) cost += 100000
    if (Math.abs(q.x - a.x) < a.w / 2 && Math.abs(q.y - a.y) < a.h / 2) cost += 100000
    if (cost < bestCost) { bestCost = cost; best = { a: sa, b: sb, vertical: vertical } }
  }
  // 两个方块完全重合（同一坐标、同样大小）时，两端会各自选到同一条边的边心 —— 出入点重合，
  // 折线退化成 `M x y` 一个点（看不见、也点不中）。这时改走横轴：一左一右，至少是一条看得见的线。
  // 触发路径很常见：连点两次「＋ 节点」（都落在视口中心）再把它们连起来。
  var pc = sideCenter(a, best.a), qc = sideCenter(b, best.b)
  if (Math.abs(pc.x - qc.x) < 0.5 && Math.abs(pc.y - qc.y) < 0.5) {
    return { a: 'r', b: 'l', vertical: false }
  }
  return best
}

/**
 * 把「某条边上的横向偏移」投到形状的**可见轮廓**上，而不是包围盒上。
 * 这一步是本次改动里最容易被看见的一条：菱形/椭圆/六边形/胶囊的锚点从前落在包围盒上，
 * 同一侧挤两根线时箭头就悬在方块外面（实测：菱形 24.4px、椭圆 10.1px、六边形 5.4px）。
 * `kind` 来自 kindOf(shape)，与 studio.ts 里画形状的那段共用同一套尺寸约定。
 */
function perimeterPoint(g, kind, side, lateral) {
  var ax = side === 't' || side === 'b'
  var spanA = ax ? g.w / 2 : g.h / 2   // 沿边方向
  var spanD = ax ? g.h / 2 : g.w / 2   // 垂直方向（矩形时就是落点距离）
  var lim = Math.max(0, spanA - 2)
  var lat = Math.max(-lim, Math.min(lim, lateral || 0))
  var perp = spanD
  if (kind === 'diamond') {
    perp = spanD * Math.max(0, 1 - Math.abs(lat) / Math.max(1e-6, spanA))
  } else if (kind === 'ellipse') {
    var eu = spanA > 0 ? lat / spanA : 0
    perp = spanD * Math.sqrt(Math.max(0, 1 - eu * eu))
  } else if (kind === 'hex') {
    if (ax) {
      // 上下边：中间一段是直边，两端各有一个 14px 的斜角
      var inset = Math.min(NODE_HEX_INSET, spanA)
      perp = Math.abs(lat) <= spanA - inset
        ? spanD
        : spanD * Math.max(0, (spanA - Math.abs(lat)) / Math.max(1e-6, inset))
    } else {
      // 左右两侧不是边，是两个顶点：从顶点沿斜边收进去（垂直方向的半长是 spanD）
      perp = Math.max(0, spanD - NODE_HEX_INSET * (Math.abs(lat) / Math.max(1e-6, spanA)))
    }
  } else if (kind !== 'rect') {
    // round / sub / cyl / stadium：rx = min(h/2, w/2) 的胶囊，直段之外落到圆角上。
    // 圆角圆心在「离形状中心 (spanD - r) 的垂直距离」处，所以半径那一段要**加上这个偏移**：
    // 少了它，横着出去的锚点会缩进方块里（140×60 的胶囊上实测缩了 41px）。
    var r = Math.min(spanA, spanD)
    if (Math.abs(lat) > spanA - r) {
      var dc = Math.abs(lat) - (spanA - r)
      perp = (spanD - r) + Math.sqrt(Math.max(0, r * r - dc * dc))
    }
  }
  if (side === 'b') return { x: g.x + lat, y: g.y + perp }
  if (side === 't') return { x: g.x + lat, y: g.y - perp }
  if (side === 'r') return { x: g.x + perp, y: g.y + lat }
  return { x: g.x - perp, y: g.y + lat }
}

/** 某个端口位次在给定侧上的最终落点（先按「同侧均分」算偏移，再投到轮廓上）。 */
function portPointOf(g, side, p) {
  var span = (side === 't' || side === 'b') ? g.w : g.h
  return perimeterPoint(g, kindOf(g.shape), side, edgePortOffset(span, p))
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
  if (!a || !b) return null
  var shift = (typeof offset === 'number' && isFinite(offset)) ? offset : 0
  var obs = []
  if (obstacles) {
    for (var i = 0; i < obstacles.length; i++) {
      var o = obstacles[i]
      if (!o || o === a || o === b) continue
      if (typeof o.w !== 'number' || typeof o.h !== 'number') continue
      obs.push({
        x1: o.x - o.w / 2 - EDGE_PAD, y1: o.y - o.h / 2 - EDGE_PAD,
        x2: o.x + o.w / 2 + EDGE_PAD, y2: o.y + o.h / 2 + EDGE_PAD,
      })
    }
  }
  var pA = ports && ports.a
  var pB = ports && ports.b
  // 自环（`n1 --> n1`）：从右边绕出去一小圈再回来。不特判的话 dx=dy=0 会被判成"垂直"，
  // 出点取底边中心、入点取顶边中心 —— 画出来是一条**从底边穿到顶边的直线**，正好捅穿方块。
  if (a === b) {
    var loopX = a.x + a.w / 2
    var loopL = loopX + EDGE_LANE * 1.4
    var loopT = a.y - a.h / 4
    var loopB = a.y + a.h / 4
    var loopPts = [{ x: loopX, y: loopT }, { x: loopL, y: loopT }, { x: loopL, y: loopB }, { x: loopX, y: loopB }]
    var lc = edgeCleanPath(loopPts)
    return { d: lc.d, mid: { x: loopL, y: a.y }, pts: lc.pts, lanes: edgePathLanes(lc.pts) }
  }
  // 选边（两端同轴）→ 落点（投到真实轮廓上，而不是包围盒）
  var sides = edgeSidesOf(a, b)
  var vertical = sides.vertical
  var p0 = portPointOf(a, sides.a, pA)
  var p1 = portPointOf(b, sides.b, pB)
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
    return edgePathHits(pts, obs) || edgePathHitsSelf(pts, a) || edgePathHitsSelf(pts, b)
  }

  // 一段跨越式：从出点直走 → 在某个「跨越线」上横过去 → 再直走进点。
  // 候选跨越线按「离正中越近越优先」排序；障碍的边线外侧也在候选里 —— 那让线能贴着障碍绕。
  //
  // 中位线两侧先按 EDGE_LANE_STEP 铺开若干条：这是**平行间隔**的来源。从前中位线被别的线
  // 占了也照样画上去，两条线就逐像素叠在一起（实测画布上 48 处、线距 0px）。
  var mid0 = vertical ? (p0.y + p1.y) / 2 : (p0.x + p1.x) / 2
  var cands = [mid0]
  for (var q = 1; q <= 3; q++) { cands.push(mid0 - q * EDGE_LANE_STEP); cands.push(mid0 + q * EDGE_LANE_STEP) }
  for (var j = 0; j < obs.length; j++) {
    if (vertical) { cands.push(obs[j].y1 - 2); cands.push(obs[j].y2 + 2) }
    else { cands.push(obs[j].x1 - 2); cands.push(obs[j].x2 + 2) }
  }
  if (vertical) cands.push(Math.min(p0.y, p1.y) - EDGE_LANE, Math.max(p0.y, p1.y) + EDGE_LANE)
  else cands.push(Math.min(p0.x, p1.x) - EDGE_LANE, Math.max(p0.x, p1.x) + EDGE_LANE)
  cands.sort(function (m, n) { return Math.abs(m - mid0) - Math.abs(n - mid0) })

  // 挑选顺序：**既不撞障碍、也不压别的线** > 只不撞障碍 > 兜底。
  // 车道冲突只在「两条线的这一段平行且投影相交」时才算 —— 隔得远的并行线互不相干。
  var used = usedLanes || []
  var freeOfLane = function (pts) {
    var lanes = edgePathLanes(pts)
    for (var li = 0; li < lanes.length; li++) {
      for (var ui = 0; ui < used.length; ui++) {
        if (edgeLaneConflict(lanes[li].vert, lanes[li].c, lanes[li].lo, lanes[li].hi, used[ui])) return false
      }
    }
    return true
  }
  var best = null
  var bestAny = null
  for (var c = 0; c < cands.length; c++) {
    var m = cands[c] + shift
    var pts = vertical
      ? [{ x: p0.x, y: p0.y }, { x: p0.x, y: m }, { x: p1.x, y: m }, { x: p1.x, y: p1.y }]
      : [{ x: p0.x, y: p0.y }, { x: m, y: p0.y }, { x: m, y: p1.y }, { x: p1.x, y: p1.y }]
    if (blockedBy(pts)) continue
    if (!bestAny) bestAny = pts
    if (freeOfLane(pts)) { best = pts; break }
  }
  if (!best) best = bestAny
  // 兜底零：候选车道**再往两边扫一遍**（±10 条车道 + 每条障碍的外侧一条）。
  // 为什么要有这一层：上面那圈候选只铺到 ±3 条车道，方块挤在一起时会被全部拒掉，
  // 然后落到「兜底二」那条**不看障碍**的硬穿线上 —— 实测真图（dsh-plugin-framework）
  // 上就是这里多出了两条穿过第三方块的线。先多找几条干净的车道，实在找不到才硬穿。
  if (!best) {
    var wide = []
    for (var wq = 1; wq <= 10; wq++) { wide.push(mid0 - wq * EDGE_LANE_STEP); wide.push(mid0 + wq * EDGE_LANE_STEP) }
    for (var wz = 0; wz < obs.length; wz++) {
      if (vertical) { wide.push(obs[wz].y1 - EDGE_LANE); wide.push(obs[wz].y2 + EDGE_LANE) }
      else { wide.push(obs[wz].x1 - EDGE_LANE); wide.push(obs[wz].x2 + EDGE_LANE) }
    }
    wide.sort(function (m, n) { return Math.abs(m - mid0) - Math.abs(n - mid0) })
    var cleanOnly = null
    for (var wc = 0; wc < wide.length; wc++) {
      var mw = wide[wc] + shift
      var wpts = vertical
        ? [{ x: p0.x, y: p0.y }, { x: p0.x, y: mw }, { x: p1.x, y: mw }, { x: p1.x, y: p1.y }]
        : [{ x: p0.x, y: p0.y }, { x: mw, y: p0.y }, { x: mw, y: p1.y }, { x: p1.x, y: p1.y }]
      if (blockedBy(wpts)) continue
      if (!cleanOnly) cleanOnly = wpts
      if (freeOfLane(wpts)) { best = wpts; break }
    }
    if (!best) best = cleanOnly
  }
  // 兜底一：两段跨越式，从整片障碍的外侧绕过去（中间那条直路被完全堵死时走这条）。
  if (!best) {
    var bx1 = Math.min(a.x - a.w / 2, b.x - b.w / 2)
    var by1 = Math.min(a.y - a.h / 2, b.y - b.h / 2)
    var bx2 = Math.max(a.x + a.w / 2, b.x + b.w / 2)
    var by2 = Math.max(a.y + a.h / 2, b.y + b.h / 2)
    for (var z = 0; z < obs.length; z++) {
      bx1 = Math.min(bx1, obs[z].x1); by1 = Math.min(by1, obs[z].y1)
      bx2 = Math.max(bx2, obs[z].x2); by2 = Math.max(by2, obs[z].y2)
    }
    // 车道不只「整片外面的两条」：方块挤成一片时，那两条外侧车道往往正好卡在别的方块旁边，
    // 于是一条都走不通、直接落到硬穿。这里把**每块障碍的外侧**也当候选，按离中位线的远近排。
    var lanes = vertical ? [bx1 - EDGE_LANE, bx2 + EDGE_LANE] : [by1 - EDGE_LANE, by2 + EDGE_LANE]
    for (var lz = 0; lz < obs.length; lz++) {
      if (vertical) lanes.push(obs[lz].x1 - EDGE_LANE, obs[lz].x2 + EDGE_LANE)
      else lanes.push(obs[lz].y1 - EDGE_LANE, obs[lz].y2 + EDGE_LANE)
    }
    var laneMid = vertical ? (p0.x + p1.x) / 2 : (p0.y + p1.y) / 2
    lanes.sort(function (m, n) { return Math.abs(m - laneMid) - Math.abs(n - laneMid) })
    // 绕行折线的形状：先走一小段离开出点方块，横到外侧车道、沿车道走到另一端，再横回来进去。
    // 关键是那两条横线落在「刚离开方块」的位置，而不是落在正中 —— 落在正中时第一段
    // 就已经穿进障碍带了（这条是实测踩出来的，不是想出来的）。
    // 出点落在方块哪半边，第一步就往哪边走；入点落在哪半边，最后一步就从那一侧绕进去。
    // 从前这两个符号是按 p1 与 p0 的先后推的 —— 端口一旦倒挂（见上面那个 inverted）
    // 就会推出反号，绕行折线的第一步直接**缩进方块自己身体里**。（审计第 7 条。）
    var sy = (p0.y >= a.y) ? 1 : -1
    var ey = (p1.y >= b.y) ? 1 : -1
    var sx = (p0.x >= a.x) ? 1 : -1
    var ex = (p1.x >= b.x) ? 1 : -1
    for (var s = 0; s < lanes.length && !best; s++) {
      // 车道本身要带上 shift，否则同一对节点之间的多条线会算出**逐字节相同**的绕行路径。
      var lane = lanes[s] + shift
      var detour = vertical
        ? [{ x: p0.x, y: p0.y }, { x: p0.x, y: p0.y + sy * EDGE_LANE }, { x: lane, y: p0.y + sy * EDGE_LANE },
           { x: lane, y: p1.y + ey * EDGE_LANE }, { x: p1.x, y: p1.y + ey * EDGE_LANE }, { x: p1.x, y: p1.y }]
        : [{ x: p0.x, y: p0.y }, { x: p0.x + sx * EDGE_LANE, y: p0.y }, { x: p0.x + sx * EDGE_LANE, y: lane },
           { x: p1.x + ex * EDGE_LANE, y: lane }, { x: p1.x + ex * EDGE_LANE, y: p1.y }, { x: p1.x, y: p1.y }]
      if (!blockedBy(detour)) best = detour
    }
  }
  // 兜底二：还是不行就直接跨越。画布上一根线消失比画得难看严重得多，所以绝不返回 null。
  if (!best) {
    var mf = mid0 + shift
    best = vertical
      ? [{ x: p0.x, y: p0.y }, { x: p0.x, y: mf }, { x: p1.x, y: mf }, { x: p1.x, y: p1.y }]
      : [{ x: p0.x, y: p0.y }, { x: mf, y: p0.y }, { x: mf, y: p1.y }, { x: p1.x, y: p1.y }]
  }
  var clean = edgeCleanPath(best)
  // pts 交给调用方：交叉检测（拱桥）与「这条线占掉哪些车道」都要按尖角折线算。
  return { d: clean.d, mid: edgeMidOfPath(clean.pts), pts: clean.pts, lanes: edgePathLanes(clean.pts) }
}

function cloneModel(m) {
  return JSON.parse(JSON.stringify(m))
}

// ==================== 图标 ====================
function ArchIcon(props) {
  var s = props && typeof props.size === 'number' ? props.size : 18
  return React.createElement('svg', { width: s, height: s, viewBox: '0 0 20 20', fill: 'none', 'aria-hidden': 'true', style: { flex: '0 0 auto' } },
    React.createElement('rect', { x: 1.5, y: 1.5, width: 7, height: 5.5, rx: 1.5, stroke: 'currentColor', strokeWidth: 1.4 }),
    React.createElement('rect', { x: 11.5, y: 1.5, width: 7, height: 5.5, rx: 1.5, stroke: 'currentColor', strokeWidth: 1.4 }),
    React.createElement('rect', { x: 6.5, y: 13, width: 7, height: 5.5, rx: 1.5, stroke: 'currentColor', strokeWidth: 1.4 }),
    React.createElement('path', { d: 'M5 7v3h10V7M10 10v3', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
  )
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
].join('')

// 把画布内容做成一张独立的、自解释的 SVG。
// 只取 .ac-world 的子内容 —— 它那层 translate/scale 是视口变换，导出不要；
// 裁剪交给 viewBox（内容坐标与 box 同一坐标系，所以对得上）。
// 必须自带 marker 定义的 <defs>，保证连线箭头独立自包含、不丢箭头。
function buildExportSvg(worldNode, box) {
  var clone = worldNode.cloneNode(true)
  // 导出的是**结构**，不是面板：交互手柄、吸附线、脉动环、以及三个角标
  // （留言 ✎ / 锚点 ▤ / 下钻 ↗）全是界面装饰。它们从前既没被剔掉、EXPORT_CSS 里也没有
  // 对应规则 —— 而导出的 SVG 是一份脱离主题的独立文档，circle/text 缺省就是纯黑，
  // 于是节点角上会出现一坨黑斑。（2026-09-20 客户端逻辑审计第 4 条。）
  var drop = ['.ac-handle', '.ac-link-preview', '.ac-pulse', '.ac-snapline', '.ac-note-badge', '.ac-file-badge', '.ac-jump']
  for (var i = 0; i < drop.length; i++) {
    var hits = clone.querySelectorAll(drop[i])
    for (var j = 0; j < hits.length; j++) hits[j].parentNode.removeChild(hits[j])
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
    + '</svg>'
}

// SVG 串 → PNG。走 <img> 载 data/blob URL，所以 SVG 里不能有外部引用（已保证）。
function svgToPngBlob(svgText, w, h, scale) {
  return new Promise(function (resolve, reject) {
    var url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }))
    var img = new Image()
    img.onload = function () {
      try {
        var canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(w * scale))
        canvas.height = Math.max(1, Math.round(h * scale))
        var c2 = canvas.getContext('2d')
        c2.fillStyle = '#ffffff'
        c2.fillRect(0, 0, canvas.width, canvas.height)
        c2.setTransform(scale, 0, 0, scale, 0, 0)
        c2.drawImage(img, 0, 0)
        URL.revokeObjectURL(url)
        canvas.toBlob(function (b) {
          if (b) resolve(b)
          else reject(new Error('canvas.toBlob 返回空'))
        }, 'image/png')
      } catch (e) {
        URL.revokeObjectURL(url)
        reject(e)
      }
    }
    img.onerror = function () {
      URL.revokeObjectURL(url)
      reject(new Error('SVG 转图片失败'))
    }
    img.src = url
  })
}

function downloadBlob(name, blob) {
  var url = URL.createObjectURL(blob)
  var a = document.createElement('a')
  a.href = url
  a.download = name
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  try {
    ctxTimeout(function () { URL.revokeObjectURL(url) }, 8000)
  } catch (e) {}
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
  if (!PLUGIN_CTX || typeof PLUGIN_CTX.get !== 'function') return null
  try {
    return PLUGIN_CTX.get('timer') || null
  } catch (e) {
    return null
  }
}

function ctxTimeout(fn: () => void, ms: number): () => void {
  var timer = timerService()
  if (timer && typeof timer.timeout === 'function') return timer.timeout(fn, ms)
  var id = globalThis.setTimeout(fn, ms)
  return function () { globalThis.clearTimeout(id) }
}

function ctxInterval(fn: () => void, ms: number): () => void {
  var timer = timerService()
  if (timer && typeof timer.interval === 'function') return timer.interval(fn, ms)
  var id = globalThis.setInterval(fn, ms)
  return function () { globalThis.clearInterval(id) }
}

