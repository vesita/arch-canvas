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

// 拖拽吸附：把候选坐标对齐到「其他节点的中心线」上，阈值内才吸。
// **只做中心线对齐**，不做边缘、也不做网格 —— 网格会限制自由布局，
// 而「这两个节点该不该排成一条线」才是摆整齐真正要回答的问题。
// 返回吸附后的坐标，以及命中的参考线位置（gx / gy 为 null 表示那条轴没吸上）。
var SNAP_PX = 8
function snapToPeers(nodes, movingId, x, y) {
  var bx = null, by = null
  var dbx = SNAP_PX + 1, dby = SNAP_PX + 1
  for (var i = 0; i < nodes.length; i++) {
    var n = nodes[i]
    if (!n || n.id === movingId) continue
    if (n.x == null || n.y == null) continue
    var ax = Math.abs(n.x - x)
    if (ax <= SNAP_PX && ax < dbx) { dbx = ax; bx = n.x }
    var ay = Math.abs(n.y - y)
    if (ay <= SNAP_PX && ay < dby) { dby = ay; by = n.y }
  }
  return { x: bx == null ? x : bx, y: by == null ? y : by, gx: bx, gy: by }
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

function needsLayout(model) {
  if (!model || !model.nodes || model.nodes.length === 0) return false
  for (var i = 0; i < model.nodes.length; i++) {
    var n = model.nodes[i]
    if (typeof n.x !== 'number' || typeof n.y !== 'number') return true
  }
  return false
}

function autoLayout(model) {
  var nodes = model.nodes || []
  if (nodes.length === 0) return model
  var byId = {}
  var sizes = {}
  for (var i = 0; i < nodes.length; i++) {
    byId[nodes[i].id] = nodes[i]
    sizes[nodes[i].id] = nodeSize(nodes[i].label, refRowCount(nodes[i].files))
  }
  var edges = []
  for (var e = 0; e < (model.edges || []).length; e++) {
    var ed = model.edges[e]
    if (byId[ed.from] && byId[ed.to] && ed.from !== ed.to) edges.push(ed)
  }
  var layer = {}
  for (var k = 0; k < nodes.length; k++) layer[nodes[k].id] = 0
  for (var pass = 0; pass < nodes.length + 1; pass++) {
    var changed = false
    for (var m = 0; m < edges.length; m++) {
      var cand = layer[edges[m].from] + 1
      if (cand > layer[edges[m].to] && cand < nodes.length) { layer[edges[m].to] = cand; changed = true }
    }
    if (!changed) break
  }
  var buckets = []
  for (var j = 0; j < nodes.length; j++) {
    var L = layer[nodes[j].id] || 0
    if (!buckets[L]) buckets[L] = []
    buckets[L].push(nodes[j])
  }
  var dir = model.direction || 'TD'
  var horiz = dir === 'LR' || dir === 'RL'
  var rev = dir === 'BT' || dir === 'RL'
  var GAP = horiz ? 74 : 56
  var out = []
  for (var q = 0; q < nodes.length; q++) {
    // **整份复制，只改坐标。** 从前这里是逐字段重建 `{id,label,shape,group,x,y}` ——
    // 于是点一下「自动布局」（或加载一张没带坐标的图触发它），所有节点的 files / note /
    // noteDone / link 全被丢掉，而且紧接着经 doc:set 落盘，**永久损坏**。
    // （2026-09-20 客户端逻辑审计抓到的头号问题；`refRowCount(nodes[i].files)` 上面还在用
    //   files 算尺寸，就更说明这些字段本该跟着走。）
    out.push(Object.assign({}, nodes[q]))
  }
  var pos = {}
  for (var li = 0; li < buckets.length; li++) {
    var bucket = buckets[li] || []
    var span = GAP * Math.max(0, bucket.length - 1)
    for (var b = 0; b < bucket.length; b++) span += horiz ? sizes[bucket[b].id].h : sizes[bucket[b].id].w
    var acc = -span / 2
    var along = 0
    for (var p = 0; p < li; p++) {
      var deep = 0
      var row = buckets[p] || []
      for (var r = 0; r < row.length; r++) deep = Math.max(deep, horiz ? sizes[row[r].id].w : sizes[row[r].id].h)
      along += deep + 84
    }
    if (rev) along = -along
    for (var n2 = 0; n2 < bucket.length; n2++) {
      var node = bucket[n2]
      var sz = sizes[node.id]
      var cross = acc + (horiz ? sz.h : sz.w) / 2
      acc += (horiz ? sz.h : sz.w) + GAP
      pos[node.id] = horiz ? { x: along, y: cross } : { x: cross, y: along }
    }
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

/**
 * 一条连线的路径。`obstacles` 是画布上**其它可见方块**的几何（被折叠收起的方块不该挡路），
 * `offset` 用于把同一对节点之间的多条线错开（由调用方按序号算），
 * `ports` 是两端的端口位次 `{ a: {n,i}, b: {n,i} }`，
 * `usedLanes` 是**前面几条线已经占掉的车道** —— 有了它，两条不同连线的中位线撞上时
 * 后来者会自己往旁边让（用户要的「平行间隔」）。由调用方逐条累积。
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
  var dx = b.x - a.x
  var dy = b.y - a.y
  var vertical = Math.abs(dy) >= Math.abs(dx)
  var pA = ports && ports.a
  var pB = ports && ports.b
  var p0, p1
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
  if (vertical) {
    var down = dy >= 0
    p0 = { x: a.x + edgePortOffset(a.w, pA), y: a.y + (down ? a.h / 2 : -a.h / 2) }
    p1 = { x: b.x + edgePortOffset(b.w, pB), y: b.y + (down ? -b.h / 2 : b.h / 2) }
  } else {
    var right = dx >= 0
    p0 = { x: a.x + (right ? a.w / 2 : -a.w / 2), y: a.y + edgePortOffset(a.h, pA) }
    p1 = { x: b.x + (right ? -b.w / 2 : b.w / 2), y: b.y + edgePortOffset(b.h, pB) }
  }
  // 端口倒挂：中心点说「b 在下」，可两个方块**纵向上是重叠的**（a.x 与 b.x 差得远、
  // y 只差一点点，于是 |dy| >= |dx| 选中的是纵轴）—— 出点（a 的下边）反而落在入点
  // （b 的上边）之下。折线一出发就在往回走，直接钻进 a 自己身体里。
  // 这时换另一条轴：横着连过去不会倒挂。（2026-09-20 客户端逻辑审计第 7 条。）
  var inverted = vertical ? (dy >= 0 ? p1.y < p0.y : p1.y > p0.y) : (dx >= 0 ? p1.x < p0.x : p1.x > p0.x)
  if (inverted) {
    vertical = !vertical
    if (vertical) {
      var down2 = dy >= 0
      p0 = { x: a.x + edgePortOffset(a.w, pA), y: a.y + (down2 ? a.h / 2 : -a.h / 2) }
      p1 = { x: b.x + edgePortOffset(b.w, pB), y: b.y + (down2 ? -b.h / 2 : b.h / 2) }
    } else {
      var right2 = dx >= 0
      p0 = { x: a.x + (right2 ? a.w / 2 : -a.w / 2), y: a.y + edgePortOffset(a.h, pA) }
      p1 = { x: b.x + (right2 ? -b.w / 2 : b.w / 2), y: b.y + edgePortOffset(b.h, pB) }
    }
  }

  // a 和 b 自己**不**进障碍表（带 12px 余量的话会把贴着边框出发的端口段一起判成"命中"，
  // 于是每条线都被拒），但要单独做一次**零余量**的自穿透检查：两个方块纵向上重叠时，
  // 中位线候选会从出点往回钻、直接穿过方块自己。零余量 + 严格不等号正好能分开
  // 「贴着边框出发」（不算命中）与「钻进边框内部」（算命中）。（审计第 6/7 条的地基。）
  var guard = obs.concat([
    { x1: a.x - a.w / 2, y1: a.y - a.h / 2, x2: a.x + a.w / 2, y2: a.y + a.h / 2 },
    { x1: b.x - b.w / 2, y1: b.y - b.h / 2, x2: b.x + b.w / 2, y2: b.y + b.h / 2 },
  ])

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
    if (edgePathHits(pts, guard)) continue
    if (!bestAny) bestAny = pts
    if (freeOfLane(pts)) { best = pts; break }
  }
  if (!best) best = bestAny
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
    var lanes = vertical ? [bx1 - EDGE_LANE, bx2 + EDGE_LANE] : [by1 - EDGE_LANE, by2 + EDGE_LANE]
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
      if (!edgePathHits(detour, guard)) best = detour
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
  '.ac-group-box{fill:#f7fafc;stroke:#cbd5e0;stroke-dasharray:5 5;stroke-width:1.2}',
  '.ac-group-lbl{fill:#4a5568;font-size:11.5px;font-weight:600}',
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

