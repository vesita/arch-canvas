#!/usr/bin/env node
/**
 * tools/render-panel.mjs
 *
 * 把「架构画布」面板渲染为真实 UI 样式的独立 HTML 并生成 PNG 截图（让 Lead 亲眼看面板 UI）。
 *
 * 用法:
 *   node tools/render-panel.mjs <in.mmd> <out.png> [--width N] [--state canvas|selected|source] [--select <nodeId>]
 *
 * 【深色主题近似 Token 映射表（非真实 token，仅作独立页面的视觉近似）】
 * 面板样式依赖宿主环境注入的 --dsw-alias-* 主题变量。
 * 在脱离 DSH 外壳的独立 HTML 渲染中，使用以下深色主题近似值注入以保证样式正常：
 *
 *   --dsw-alias-bg-base:               #14161a  (基底背景色：面板底色、输入框底色、画布 SVG 兜底)
 *   --dsw-alias-bg-layer-1:            #1b1e23  (第一层背景色：工具条、标签栏底色、分组背景、dock 底色)
 *   --dsw-alias-bg-layer-2:            #232830  (第二层背景色：节点填充、激活 tab、hover 态)
 *   --dsw-alias-label-primary:         #e8eaed  (一级文本色：主标题、节点文本、主要文字)
 *   --dsw-alias-label-secondary:       #9aa3af  (二级文本色：副标题、未激活 tab、连线标签、元数据)
 *   --dsw-alias-label-tertiary:        #6b7280  (三级文本色：辅助占位符、微弱提示)
 *   --dsw-alias-label-error:           #ff5f56  (错误提示文本)
 *   --dsw-alias-border-l1:             #2a2e35  (一级边框：弱分割线、网格参考点)
 *   --dsw-alias-border-l2:             #3a4048  (二级边框：按钮边框、输入框边框、卡片描边)
 *   --dsw-alias-brand-primary:         #4c8dff  (品牌主色：选中高亮轮廓、主按钮、激活指示)
 *   --dsw-alias-state-error-primary:   #ff5f56  (状态错误色：高亮警示)
 *   --dsw-alias-state-warning-primary: #d29922  (状态警告色：待办角标、忙碌指示)
 *   --dsw-alias-state-success-primary: #3fb950  (状态成功色：正常状态点)
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { JSDOM } from 'jsdom'

// ---------- 1. 命令行参数解析 ----------
const USAGE = '用法: node tools/render-panel.mjs <in.mmd> <out.png> [--width N] [--state canvas|selected|source] [--select <nodeId>]'

const args = process.argv.slice(2)
if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
  console.log(USAGE)
  process.exit(args.includes('-h') || args.includes('--help') ? 0 : 1)
}

let inMmd = null
let outPng = null
let width = 1400
let state = 'canvas'
let selectNodeId = null

for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '--width' || a === '-w') {
    if (i + 1 < args.length) {
      const val = parseInt(args[++i], 10)
      if (isNaN(val) || val <= 0) {
        console.error('错误: --width 必须是正整数')
        console.log(USAGE)
        process.exit(1)
      }
      width = val
    } else {
      console.error('错误: --width 缺少数值参数')
      console.log(USAGE)
      process.exit(1)
    }
  } else if (a === '--state' || a === '-s') {
    if (i + 1 < args.length) {
      state = args[++i]
      if (!['canvas', 'selected', 'source'].includes(state)) {
        console.error(`错误: --state 只支持 canvas | selected | source，收到 "${state}"`)
        console.log(USAGE)
        process.exit(1)
      }
    } else {
      console.error('错误: --state 缺少参数')
      console.log(USAGE)
      process.exit(1)
    }
  } else if (a === '--select') {
    if (i + 1 < args.length) {
      selectNodeId = args[++i]
    } else {
      console.error('错误: --select 缺少节点 ID')
      console.log(USAGE)
      process.exit(1)
    }
  } else if (a.startsWith('-')) {
    console.error(`错误: 未知参数 ${a}`)
    console.log(USAGE)
    process.exit(1)
  } else if (!inMmd) {
    inMmd = a
  } else if (!outPng) {
    outPng = a
  } else {
    console.error(`错误: 多余参数 ${a}`)
    console.log(USAGE)
    process.exit(1)
  }
}

if (!inMmd || !outPng) {
  console.error('错误: 缺少必填参数 <in.mmd> 或 <out.png>')
  console.log(USAGE)
  process.exit(1)
}

// ---------- 2. 检查依赖产物与输入文件 ----------
const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.dirname(HERE)

const LIB_UI = path.join(ROOT, 'lib', 'ui.js')
const DIST_MERMAID = path.join(ROOT, 'dist', 'mermaid.js')

if (!fs.existsSync(LIB_UI) || !fs.existsSync(DIST_MERMAID)) {
  console.error('缺少构建产物（lib/ui.js 或 dist/mermaid.js）—— 请先执行 npm run build')
  process.exit(1)
}

const resolvedInMmd = path.resolve(process.cwd(), inMmd)
if (!fs.existsSync(resolvedInMmd)) {
  console.error(`输入文件不存在: ${inMmd}`)
  process.exit(1)
}
const mmdText = fs.readFileSync(resolvedInMmd, 'utf8')

// ---------- 3. 解析 .mmd 模型并加载旁路表 ----------
const mermaidSrc = fs.readFileSync(DIST_MERMAID, 'utf8')
const { parseMermaid } = new Function(mermaidSrc + '\n;return { parseMermaid };')()
const model = parseMermaid(mmdText)

const mmdDir = path.dirname(resolvedInMmd)
const notesPath = path.join(mmdDir, 'notes.json')
if (fs.existsSync(notesPath)) {
  try {
    const notesJson = JSON.parse(fs.readFileSync(notesPath, 'utf8'))
    const mmdKey = path.basename(resolvedInMmd)
    const fileNotes = notesJson[mmdKey] || {}
    for (const node of model.nodes || []) {
      if (!node || !node.id) continue
      const entry = fileNotes[node.id]
      if (entry && typeof entry.text === 'string') {
        node.note = entry.text
        node.noteDone = entry.done === true
      }
    }
  } catch (_e) {
    // 忽略旁路表读取失败
  }
}

// ---------- 4. JSDOM 环境搭建 ----------
// 硬规矩 1：DOM 必须在动态 import react-dom/client 之前就位
const dom = new JSDOM('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body><div id="app" style="width:100%;height:100%;"></div></body></html>', {
  pretendToBeVisual: true,
})
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const targetWidth = width
const targetHeight = 900

// 桩 stage/dock 的 getBoundingClientRect，使 fitView 能根据 1400x900 视口合理自适应
dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
  const isStage = this.classList && this.classList.contains('ac-stage')
  const isDock = this.classList && this.classList.contains('ac-dock')
  if (isStage) {
    const dockH = state === 'selected' ? 280 : 0
    return {
      width: targetWidth,
      height: Math.max(160, targetHeight - 70 - dockH),
      top: 40,
      left: 0,
      right: targetWidth,
      bottom: targetHeight - 30 - dockH,
      x: 0,
      y: 40,
    }
  }
  if (isDock) {
    return {
      width: targetWidth,
      height: 280,
      top: targetHeight - 310,
      left: 0,
      right: targetWidth,
      bottom: targetHeight - 30,
      x: 0,
      y: targetHeight - 310,
    }
  }
  return {
    width: targetWidth,
    height: targetHeight,
    top: 0,
    left: 0,
    right: targetWidth,
    bottom: targetHeight,
    x: 0,
    y: 0,
  }
}

// 动态 import React 与 react-dom/client
const ReactModule = await import('react')
const React = ReactModule.default
const act = ReactModule.act
const { createRoot } = await import('react-dom/client')

// ---------- 5. 桩 host RPC 与 lib/ui.js 装载 ----------
let insertedCss = ''
const diagramName = path.basename(inMmd, path.extname(inMmd))

function respond(method, _args) {
  if (method === 'doc:get') {
    return {
      ok: true,
      revision: 1,
      updatedBy: 'switch',
      model: model,
      mermaid: mmdText,
      file: inMmd,
      diagram: diagramName,
      key: diagramName,
      external: null,
      project: '',
      dir: mmdDir,
      scope: 'project',
      workspace: ROOT,
      tombstoned: false,
      nodeCount: model.nodes ? model.nodes.length : 0,
      edgeCount: model.edges ? model.edges.length : 0,
      libraryRev: 1,
      historyCount: 1,
      warnings: model.warnings || [],
      notes: [],
      lastChange: null,
      summary: model.summary || '',
      fileStatus: {},
    }
  }
  if (method === 'doc:rev') return { revision: 1, updatedBy: 'switch', diagram: diagramName, dir: mmdDir, libraryRev: 1, external: null }
  if (method === 'doc:list') return { ok: true, dir: mmdDir, scope: 'project', workspace: ROOT, current: diagramName, external: null, items: [], files: [], libraryRev: 1 }
  if (method === 'mermaid:info') return { url: '/arch-canvas/mermaid.min.js' }
  if (method === 'ui:info') return { url: '/arch-canvas/ui.js', file: '/dev/null' }
  return { ok: true }
}

const deps = {
  React,
  styles: {
    insert: (css) => {
      insertedCss += css + '\n'
      return () => {}
    },
  },
  rpc: (method, args) => Promise.resolve(respond(method, args)),
}
globalThis.__archCanvasDeps = deps

const uiSrc = fs.readFileSync(LIB_UI, 'utf8')
new Function(uiSrc)()

const captured = {}
const slots = {
  inject: (_name, cb) => { cb(); return () => {} },
  register: (def, comp) => { captured[def.name] = comp; return () => {} },
}
const ctx = {
  get: (k) => ({ slots, inputTriggers: { registerSource: () => () => {} } })[k],
  effect: (fn) => { const d = fn(); return typeof d === 'function' ? d : () => {} },
  inject: () => () => {},
  on: () => () => {},
  interval: () => () => {},
  timeout: () => () => {},
}
const dispose = globalThis.__archCanvas.install(ctx)

// ---------- 6. 挂载真实面板并驱动状态 ----------
const container = dom.window.document.getElementById('app')
const root = createRoot(container)

await act(async () => {
  root.render(React.createElement(captured['conversation.view'], {
    cwd: ROOT,
    sessionId: 'render-panel',
    useSessions: () => ROOT,
    inputActions: { setDraft: () => {} },
    useInput: (sel) => sel({ draft: '' }),
  }))
})

async function flush() {
  await act(async () => {
    await Promise.resolve()
  })
}
await flush()

function clickEl(el, x, y) {
  const opts = { bubbles: true, button: 0, clientX: x == null ? 0 : x, clientY: y == null ? 0 : y }
  el.dispatchEvent(new dom.window.PointerEvent('pointerdown', opts))
  el.dispatchEvent(new dom.window.PointerEvent('pointerup', opts))
}

// 默认先做一次「适应窗口」，使视图中心几何对齐
const fitBtn = Array.from(container.querySelectorAll('.ac-tools button')).find((b) => b.textContent.trim() === '适应窗口')
if (fitBtn) {
  await act(async () => { fitBtn.click() })
  await flush()
}

// 驱动不同状态
if (state === 'canvas') {
  // 画布状态：已完成适应窗口
} else if (state === 'selected') {
  // 寻找目标节点
  let targetNode = null
  if (selectNodeId) {
    targetNode = (model.nodes || []).find((n) => n.id === selectNodeId)
    if (!targetNode) {
      console.warn(`[render-panel] 警告: 未找到指定的节点 ID "${selectNodeId}"，将自动选择候选节点`)
    }
  }
  if (!targetNode) {
    targetNode = (model.nodes || []).find((n) => (n.files && n.files.length > 0) || (n.note && n.note.length > 0))
    if (!targetNode && model.nodes && model.nodes.length > 0) {
      targetNode = model.nodes[0]
    }
  }

  if (targetNode) {
    const nodeEls = Array.from(container.querySelectorAll('g.ac-node'))
    const title = String(targetNode.label || '').split('\n')[0].trim()
    let targetEl = nodeEls.find((el) => {
      const lbl = el.querySelector('.ac-lbl')?.textContent?.trim()
      return lbl === title
    })
    if (!targetEl) {
      const nodeIdx = (model.nodes || []).findIndex((n) => n.id === targetNode.id)
      targetEl = (nodeIdx >= 0 && nodeEls[nodeIdx]) ? nodeEls[nodeIdx] : nodeEls[0]
    }

    if (targetEl) {
      await act(async () => {
        clickEl(targetEl)
      })
      await flush()

      // 若处于收起细条状态，展开它
      const peekBtn = container.querySelector('.ac-peek-btn')
      if (peekBtn) {
        await act(async () => { peekBtn.click() })
        await flush()
      }
    }
  }
} else if (state === 'source') {
  // 切到源码页
  const tabs = Array.from(container.querySelectorAll('.ac-tabs button, .ac-tab, button'))
  const srcTab = tabs.find((b) => b.textContent.trim() === '源码')
  if (srcTab) {
    await act(async () => {
      srcTab.click()
    })
    await flush()
  }
}

// 同步 input 与 textarea 的文本到静态属性或 textContent
for (const ta of container.querySelectorAll('textarea')) {
  if (ta.value && !ta.textContent) {
    ta.textContent = ta.value
  }
}
for (const inp of container.querySelectorAll('input')) {
  if (inp.value && !inp.getAttribute('value')) {
    inp.setAttribute('value', inp.value)
  }
}

// ---------- 7. 组装合成独立 HTML ----------
// 注入深色主题近似 Token 样式（写在 head 中，标明为近似值）
const darkThemeTokens = `
/* 深色主题变量近似值（脱离 DSH 外壳时注入的近似调色板） */
:root {
  --dsw-alias-bg-base: #14161a;
  --dsw-alias-bg-layer-1: #1b1e23;
  --dsw-alias-bg-layer-2: #232830;
  --dsw-alias-border-l1: #2a2e35;
  --dsw-alias-border-l2: #3a4048;
  --dsw-alias-label-primary: #e8eaed;
  --dsw-alias-label-secondary: #9aa3af;
  --dsw-alias-label-tertiary: #6b7280;
  --dsw-alias-label-error: #ff5f56;
  --dsw-alias-brand-primary: #4c8dff;
  --dsw-alias-state-error-primary: #ff5f56;
  --dsw-alias-state-success-primary: #3fb950;
  --dsw-alias-state-warning-primary: #d29922;
  color-scheme: dark;
}
html, body {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--dsw-alias-bg-base, #14161a);
  color: var(--dsw-alias-label-primary, #e8eaed);
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
#app {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}
`

const styleNode = dom.window.document.createElement('style')
const stylesFromDom = Array.from(dom.window.document.querySelectorAll('style'))
  .map((s) => s.textContent)
  .join('\n')
styleNode.textContent = `${darkThemeTokens}\n${insertedCss}\n${stylesFromDom}`
dom.window.document.head.appendChild(styleNode)

const fullHtml = '<!doctype html>\n' + dom.window.document.documentElement.outerHTML

// ---------- 8. 写入 HTML 并调用 Firefox 截图 ----------
const htmlPath = `/tmp/panel-${state}.html`
fs.writeFileSync(htmlPath, fullHtml, 'utf8')
console.log(`HTML 预览已写入: ${htmlPath}`)

const resolvedOutPng = path.resolve(process.cwd(), outPng)
fs.mkdirSync(path.dirname(resolvedOutPng), { recursive: true })

const tmpProf = fs.mkdtempSync(path.join(os.tmpdir(), 'ffprof-panel-'))
const firefoxBin = process.env.FIREFOX || (fs.existsSync('/usr/bin/firefox') ? '/usr/bin/firefox' : 'firefox')

const ffArgs = [
  '--headless',
  '--profile', tmpProf,
  '--screenshot', resolvedOutPng,
  `--window-size=${targetWidth},${targetHeight}`,
  `file://${htmlPath}`,
]

try {
  execFileSync(firefoxBin, ffArgs, {
    env: { ...process.env, MOZ_HEADLESS: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  console.log(`PNG 截图已生成: ${resolvedOutPng} (${targetWidth}x${targetHeight})`)
} catch (err) {
  console.error(`Firefox 截图失败: ${err.message}`)
  if (err.stderr) {
    console.error(err.stderr.toString())
  }
  process.exit(1)
} finally {
  try {
    fs.rmSync(tmpProf, { recursive: true, force: true })
  } catch {}
}

dispose()
process.exit(0)
