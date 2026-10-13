#!/usr/bin/env node
/**
 * tools/render-preview.mjs
 * 将 .mmd 架构图文件渲染为真实画布样式的 SVG 与 PNG 预览图。
 *
 * 用法:
 *   node tools/render-preview.mjs <in.mmd> <out.png> [--width N]
 *
 * 走的是与导出件**同一个** `buildExportSvg` + `EXPORT_CSS`，所以几何、排版、字面色是忠实的。
 * 与**真实画布**有三点差异，看图时要知道：
 *   1) 配色：画布用 DSH 主题变量（暗色底），导出件用脱离主题的字面色板（纯白底）——
 *      「暗色主题下好不好看」不能只看这张 PNG。
 *   2) 交互装饰被剔掉 8 类（`.ac-handle` / `.ac-edge-hit` / `.ac-pulse` / `.ac-snapline` /
 *      `.ac-note-badge` / `.ac-file-badge` / `.ac-jump` / `.ac-link-preview`）—— 画布上能点、
 *      能看的那层不在这张图里。
 *   3) 视口：裁到几何包围盒 + 26px padding，没有 `.ac-world` 的缩放/平移。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { JSDOM } from 'jsdom'

// 1. 参数解析
const args = process.argv.slice(2)
let inMmd = null
let outPng = null
let width = null

for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '--help' || a === '-h') {
    console.log('用法: node tools/render-preview.mjs <in.mmd> <out.png> [--width N]')
    process.exit(0)
  }
  if (a === '--width' || a === '-w') {
    if (i + 1 < args.length) {
      width = parseInt(args[++i], 10)
      if (isNaN(width) || width <= 0) {
        console.error('错误: --width 必须是正整数')
        process.exit(1)
      }
    } else {
      console.error('错误: --width 缺少数值参数')
      process.exit(1)
    }
  } else if (!inMmd) {
    inMmd = a
  } else if (!outPng) {
    outPng = a
  } else {
    console.error(`错误: 未知参数 ${a}`)
    console.log('用法: node tools/render-preview.mjs <in.mmd> <out.png> [--width N]')
    process.exit(1)
  }
}

if (!inMmd || !outPng) {
  console.log('用法: node tools/render-preview.mjs <in.mmd> <out.png> [--width N]')
  process.exit(1)
}

// 2. 依赖检查（dist/ 与 lib/）
const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.dirname(HERE)

const MERMAID_FILE = path.join(ROOT, 'dist', 'mermaid.js')
const RUNTIME_FILE = path.join(ROOT, 'dist', 'client-runtime.js')
const UI_FILE = path.join(ROOT, 'lib', 'ui.js')

if (!fs.existsSync(MERMAID_FILE) || !fs.existsSync(RUNTIME_FILE) || !fs.existsSync(UI_FILE)) {
  console.error('缺少构建产物（dist/mermaid.js, dist/client-runtime.js 或 lib/ui.js），请先跑 npm run build')
  process.exit(1)
}

// 3. 读取 .mmd
const resolvedInMmd = path.resolve(process.cwd(), inMmd)
if (!fs.existsSync(resolvedInMmd)) {
  console.error(`输入文件不存在: ${inMmd}`)
  process.exit(1)
}
const mmdText = fs.readFileSync(resolvedInMmd, 'utf8')

// 4. 解析与自动布局
const mermaidSrc = fs.readFileSync(MERMAID_FILE, 'utf8')
const { parseMermaid } = new Function(mermaidSrc + '\n;return { parseMermaid };')()

const runtimeSrc = fs.readFileSync(RUNTIME_FILE, 'utf8')
const runtimeApi = new Function(runtimeSrc + '\n;return {'
  + ' autoLayout, needsLayout, consolidateEdgesModel, nodeSize, splitLabel, buildExportSvg, EXPORT_CSS'
  + ' };')()

let model = parseMermaid(mmdText)
const unpositioned = model.nodes && model.nodes.some(n => typeof n.x !== 'number' || typeof n.y !== 'number')
if (unpositioned || runtimeApi.needsLayout(model)) {
  console.log(`[render-preview] 图「${path.basename(inMmd)}」存在未定位节点，执行 autoLayout 自动布局...`)
  model = runtimeApi.autoLayout(model)
}

// 5. 挂载 JSDOM（必须在 import react-dom/client 之前完成）
const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { pretendToBeVisual: true })
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const ReactModule = await import('react')
const React = ReactModule.default
const act = ReactModule.act
const { createRoot } = await import('react-dom/client')

// 6. 加载真实面板 lib/ui.js
let insertedCss = ''
function respond(method, args) {
  if (method === 'doc:get') {
    return {
      ok: true, revision: 1, updatedBy: 'switch',
      model: model, mermaid: mmdText,
      file: inMmd, diagram: path.basename(inMmd, path.extname(inMmd)), key: inMmd,
      external: null, project: '', dir: '', scope: 'project', workspace: '',
      tombstoned: false, nodeCount: model.nodes.length, edgeCount: (model.edges || []).length, groupCount: (model.groups || []).length,
      libraryRev: 1, historyCount: 1, warnings: [], notes: [], lastChange: null,
    }
  }
  if (method === 'doc:rev') return { revision: 1, updatedBy: 'switch', diagram: 'preview', dir: '', libraryRev: 1, external: null }
  if (method === 'doc:list') return { ok: true, dir: '', scope: 'project', workspace: '', current: 'preview', external: null, items: [], files: [], libraryRev: 1 }
  if (method === 'mermaid:info') return { url: '/arch-canvas/mermaid.min.js' }
  if (method === 'ui:info') return { url: '/arch-canvas/ui.js', file: '/dev/null' }
  return { ok: true }
}

const deps = {
  React,
  styles: {
    insert: (css) => {
      insertedCss += css
      const s = dom.window.document.createElement('style')
      s.textContent = css
      dom.window.document.head.appendChild(s)
      return () => { s.remove() }
    }
  },
  rpc: (method, args) => Promise.resolve(respond(method, args)),
}
globalThis.__archCanvasDeps = deps
const uiSrc = fs.readFileSync(UI_FILE, 'utf8')
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
globalThis.__archCanvas.install(ctx)

// 7. 拦截导出产物
let exportedSvg = ''
const realBlob = globalThis.Blob
globalThis.Blob = function (parts, opts) {
  if (parts && parts[0] && typeof parts[0] === 'string' && parts[0].includes('<svg')) {
    exportedSvg = parts[0]
  }
  return { __fake: true }
}

const host = dom.window.document.getElementById('app')
const root = createRoot(host)
await act(async () => {
  root.render(React.createElement(captured['conversation.view'], {
    cwd: '/', sessionId: 'render-preview', useSessions: () => '/',
    inputActions: { setDraft: () => {} },
    useInput: (sel) => sel({ draft: '' }),
  }))
})
await act(async () => { await Promise.resolve() })

// 优先点击真实界面上的 SVG 按钮（直接触发真实 exportSvg -> buildExportSvg(world, box)）
const svgBtn = Array.from(host.querySelectorAll('.ac-tools button')).find((b) => b.textContent.trim() === 'SVG')
if (svgBtn) {
  await act(async () => {
    svgBtn.click()
  })
  await act(async () => { await Promise.resolve() })
}

// 兜底：若未能通过按钮点击获取，从舞台取 .ac-world 配合 runtimeApi.buildExportSvg
if (!exportedSvg) {
  const worldNode = host.querySelector('.ac-world')
  if (worldNode && runtimeApi.buildExportSvg) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const n of model.nodes) {
      const s = runtimeApi.nodeSize(runtimeApi.splitLabel(n.label).title, 0)
      const nx = n.x || 0, ny = n.y || 0
      minX = Math.min(minX, nx - s.w / 2); maxX = Math.max(maxX, nx + s.w / 2)
      minY = Math.min(minY, ny - s.h / 2); maxY = Math.max(maxY, ny + s.h / 2)
    }
    const pad = 26
    const box = {
      x: isFinite(minX) ? Math.round(minX - pad) : 0,
      y: isFinite(minY) ? Math.round(minY - pad) : 0,
      w: isFinite(minX) ? Math.ceil(maxX - minX + pad * 2) : 100,
      h: isFinite(minY) ? Math.ceil(maxY - minY + pad * 2) : 100,
    }
    exportedSvg = runtimeApi.buildExportSvg(worldNode, box)
  }
}

// 卸载组件，避免未完成的定时器或观察器阻碍进程退出
await act(async () => { root.unmount() })

if (!exportedSvg || !exportedSvg.includes('<svg')) {
  console.error('错误: 未能生成有效的 SVG 画布内容')
  process.exit(1)
}

// 8. 写入 SVG 与 PNG
const resolvedOutPng = path.resolve(process.cwd(), outPng)
const resolvedOutSvg = resolvedOutPng.endsWith('.png')
  ? resolvedOutPng.slice(0, -4) + '.svg'
  : resolvedOutPng + '.svg'

fs.mkdirSync(path.dirname(resolvedOutPng), { recursive: true })
fs.writeFileSync(resolvedOutSvg, exportedSvg, 'utf8')

let hasRsvg = false
try {
  execFileSync('rsvg-convert', ['--version'], { stdio: 'ignore' })
  hasRsvg = true
} catch {
  hasRsvg = false
}

if (!hasRsvg) {
  console.warn(`未找到 rsvg-convert，已生成 SVG 文件：${resolvedOutSvg}。如需转为 PNG 请安装 librsvg2-bin / rsvg-convert。`)
  process.exit(0)
}

const rsvgArgs = ['-o', resolvedOutPng]
if (width) {
  rsvgArgs.push('-w', String(width))
}
rsvgArgs.push(resolvedOutSvg)

try {
  execFileSync('rsvg-convert', rsvgArgs)
  console.log(`已成功渲染: ${resolvedOutPng} (SVG: ${resolvedOutSvg})`)
} catch (err) {
  console.error(`rsvg-convert 转换失败: ${err.message}`)
  process.exit(1)
}

process.exit(0)
