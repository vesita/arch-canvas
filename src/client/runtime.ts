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
  '.ac-hl{fill:none;stroke:#f0b429;stroke-width:3;animation:acPulse 2.6s ease-out forwards}',
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
  '.ac-group-lbl{fill:var(--dsw-alias-label-secondary,#9aa3af);font-size:11.5px;font-weight:600}',
  '.ac-handle{fill:var(--dsw-alias-brand-primary,#4c8dff);stroke:var(--dsw-alias-bg-base,#14161a);stroke-width:2;cursor:crosshair}',
  '.ac-link-preview{stroke:var(--dsw-alias-brand-primary,#4c8dff);stroke-width:2;stroke-dasharray:5 4;fill:none}',
  // 选中后才出现的底部检查器（窄栏放不下右侧栏，改成下挂）
  '.ac-dock{flex:0 0 auto;max-height:46%;overflow:auto;border-top:1px solid var(--dsw-alias-border-l1,#2a2e35);background:var(--dsw-alias-bg-layer-1,#1b1e23);padding:9px 10px}',
  '.ac-dock h4{margin:0 0 8px;font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:var(--dsw-alias-label-secondary,#9aa3af)}',
  '.ac-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}',
  '.ac-grid .full{grid-column:1 / -1}',
  '.ac-field label{display:block;font-size:11px;color:var(--dsw-alias-label-secondary,#9aa3af);margin-bottom:3px}',
  '.ac-input,.ac-area,.ac-select{width:100%;box-sizing:border-box;background:var(--dsw-alias-bg-base,#14161a);color:inherit;border:1px solid var(--dsw-alias-border-l2,#3a4048);border-radius:7px;padding:5px 7px;font:inherit;font-size:12.5px}',
  '.ac-readonly{opacity:.65}',
  '.ac-area{height:100%;min-height:120px;resize:none;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;line-height:1.55;white-space:pre;overflow:auto}',
  // 源码高亮：底层 <pre> 画彩色 token，顶层 textarea 把文字设成透明（只留光标与选区）。
  // 两层的 font / padding / border / white-space 必须逐项一致，差一点光标就与文字错位。
  '.ac-editwrap{position:relative;flex:1 1 auto;min-height:120px;display:flex}',
  '.ac-hl{position:absolute;inset:0;margin:0;box-sizing:border-box;border:1px solid transparent;border-radius:7px;padding:5px 7px;overflow:auto;pointer-events:none;scrollbar-width:none;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;line-height:1.55;white-space:pre;tab-size:2}',
  '.ac-hl::-webkit-scrollbar{width:0;height:0}',
  '.ac-area-hl{position:relative;z-index:1;background:transparent;color:transparent;caret-color:var(--dsw-alias-label-primary,#e8eaed);resize:none}',
  '.ac-area-hl::selection{background:rgba(76,141,255,.35)}',
  '.ac-hl-c{color:#6a737d}',
  '.ac-hl-m{color:#c08b5c}',
  '.ac-hl-u{color:#e8a33d}',
  '.ac-hl-k{color:#7cc4ff}',
  '.ac-hl-s{color:#a5d6a7}',
  '.ac-hl-a{color:#ff9e64}',
  '.ac-hl-p{color:#8b949e}',
  '.ac-hl-i{color:#e8eaed}',
  '.ac-textwrap{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;padding:8px;gap:7px}',
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
  // 节点上的注释角标：未解决=琥珀色笔，已解决=灰底勾（与注释清单里的两区一致）
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
    out.push({ id: nodes[q].id, label: nodes[q].label, shape: nodes[q].shape, group: nodes[q].group, x: nodes[q].x, y: nodes[q].y })
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

function edgeGeometry(a, b) {
  if (!a || !b) return null
  var dx = b.x - a.x
  var dy = b.y - a.y
  var vertical = Math.abs(dy) >= Math.abs(dx)
  var p0, p1
  if (vertical) {
    var down = dy >= 0
    p0 = { x: a.x + (b.x - a.x) * 0.12, y: a.y + (down ? a.h / 2 : -a.h / 2) }
    p1 = { x: b.x - (b.x - a.x) * 0.12, y: b.y + (down ? -b.h / 2 : b.h / 2) }
  } else {
    var right = dx >= 0
    p0 = { x: a.x + (right ? a.w / 2 : -a.w / 2), y: a.y + (b.y - a.y) * 0.12 }
    p1 = { x: b.x + (right ? -b.w / 2 : b.w / 2), y: b.y - (b.y - a.y) * 0.12 }
  }
  var c1, c2
  if (vertical) {
    c1 = { x: p0.x, y: p0.y + (p1.y - p0.y) * 0.55 }
    c2 = { x: p1.x, y: p1.y - (p1.y - p0.y) * 0.55 }
  } else {
    c1 = { x: p0.x + (p1.x - p0.x) * 0.55, y: p0.y }
    c2 = { x: p1.x - (p1.x - p0.x) * 0.55, y: p1.y }
  }
  return {
    d: 'M ' + p0.x + ' ' + p0.y + ' C ' + c1.x + ' ' + c1.y + ', ' + c2.x + ' ' + c2.y + ', ' + p1.x + ' ' + p1.y,
    mid: { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 },
  }
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
].join('')

// 把画布内容做成一张独立的、自解释的 SVG。
// 只取 .ac-world 的子内容 —— 它那层 translate/scale 是视口变换，导出不要；
// 裁剪交给 viewBox（内容坐标与 box 同一坐标系，所以对得上）。
// 必须自带 marker 定义的 <defs>，保证连线箭头独立自包含、不丢箭头。
function buildExportSvg(worldNode, box) {
  var clone = worldNode.cloneNode(true)
  var drop = ['.ac-handle', '.ac-link-preview', '.ac-hl']
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

