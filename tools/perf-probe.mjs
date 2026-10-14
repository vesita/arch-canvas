#!/usr/bin/env node
/**
 * arch-canvas 浏览器半「大图渲染与交互」**度量脚本**（不是测试，不进 `npm run check`）。
 *
 * 跑法：`npm run build && node tools/perf-probe.mjs`（读 `dist/` 产物；不带参数跑全表，
 * `--hotspot=<名>` 只跑一项，`--negative-control` 跑负向对照）。改渲染/几何之后用它对照前后：
 * 数字要跟改动一起交代，别只写「变快了」。
 *
 * 测量项：
 *   1. 整棵树 Tree Mount 渲染耗时
 *   2. 单次交互 Node Select Re-render 耗时
 *   3. 自动布局 autoLayout 耗时
 *   4. 连线几何 edgeGeometry 与 hops 拱桥耗时
 *   5. 细分子模块与负向对照
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { performance } from 'node:perf_hooks'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.dirname(HERE)   // 仓库根（本文件在 tools/ 下）
const req = createRequire(path.join(ROOT, 'package.json'))

// 1. 加载运行时与 JSDOM
const { JSDOM } = req('jsdom')
const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { pretendToBeVisual: true })
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.groupHueIndex = () => ({})
globalThis.hueClassOf = () => ''

const React = req('react')
const act = React.act
const { createRoot } = req('react-dom/client')

const runtimeSrc = fs.readFileSync(path.join(ROOT, 'dist', 'client-runtime.js'), 'utf8')
const api = new Function(runtimeSrc + '\n;return {'
  + ' autoLayout, consolidateEdgesModel, nodeSize, splitLabel, edgeGeometry, edgeSidesOf, crossingsOf, sccOf };')()

// 2. 加载 UI 组件
const captured = {}
const capturedDef = {}
let currentDoc = null

const slots = {
  inject: (_name, cb) => { cb(); return () => {} },
  register: (def, comp) => { captured[def.name] = comp; capturedDef[def.name] = def; return () => {} },
}
const ctx = {
  get: (k) => ({ slots, inputTriggers: { registerSource: () => () => {} } })[k],
  effect: (fn) => { const d = fn(); return typeof d === 'function' ? d : () => {} },
  inject: () => () => {},
  on: () => () => {},
  interval: () => () => {},
  timeout: () => () => {},
}

const deps = {
  React,
  styles: { insert: () => () => {} },
  rpc: (method, args) => {
    if (method === 'doc:get') return Promise.resolve(currentDoc)
    if (method === 'doc:rev') return Promise.resolve({ revision: currentDoc?.revision || 1, updatedBy: 'switch' })
    if (method === 'doc:list') return Promise.resolve({ ok: true, items: [], files: [] })
    return Promise.resolve({ ok: true })
  }
}
globalThis.__archCanvasDeps = deps
const uiSrc = fs.readFileSync(path.join(ROOT, 'dist', 'ui.js'), 'utf8')
new Function(uiSrc)()
globalThis.__archCanvas.install(ctx)

// 3. 统计函数：计算中位数与 MAD (中位数绝对偏差)
function calcStats(samples) {
  if (!samples || samples.length === 0) return { median: 0, mad: 0, min: 0, max: 0 }
  const sorted = samples.slice().sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  const absDiffs = sorted.map(v => Math.abs(v - median)).sort((a, b) => a - b)
  const mad = sorted.length % 2 !== 0 ? absDiffs[mid] : (absDiffs[mid - 1] + absDiffs[mid]) / 2
  return {
    median,
    mad,
    min: sorted[0],
    max: sorted[sorted.length - 1],
  }
}

// 4. 生成同构模型（N 节点，M=round(1.2*N) 边）
function generateBenchmarkModel(N) {
  const M = Math.round(N * 1.2)
  const shapes = ['rect', 'round', 'diamond', 'cyl', 'hex']
  const nodes = []
  for (let i = 0; i < N; i++) {
    nodes.push({
      id: `n${i}`,
      label: `Node ${i}\nDesc ${i}`,
      shape: shapes[i % shapes.length],
      group: `grp_${i % 5}`
    })
  }
  const edges = []
  for (let k = 0; k < M; k++) {
    const fromIdx = k % N
    let toIdx
    if (k % 10 === 0) {
      toIdx = (fromIdx - 2 + N) % N
    } else if (k % 7 === 0) {
      toIdx = (fromIdx + 1) % N
    } else {
      toIdx = (fromIdx + 1 + (k % 4)) % N
    }
    if (toIdx === fromIdx) toIdx = (toIdx + 1) % N
    edges.push({
      id: `e${k}`,
      from: `n${fromIdx}`,
      to: `n${toIdx}`,
      label: `call_${k}`,
      arrow: '-->'
    })
  }
  const groups = [
    { id: 'grp_0', label: '接入层' },
    { id: 'grp_1', label: '核心层' },
    { id: 'grp_2', label: '服务层' },
    { id: 'grp_3', label: '存储层' },
    { id: 'grp_4', label: '消息层' },
  ]
  return {
    direction: 'TD',
    nodes,
    edges,
    groups,
    extras: []
  }
}

// 5. 纯连线几何管道提取测量（来自 studio-render-canvas.ts）
function measureEdgePipeline(laidModel) {
  const model = laidModel
  const gstate = {}
  for (let i = 0; i < model.nodes.length; i++) {
    const n = model.nodes[i]
    const s = api.nodeSize(api.splitLabel(n.label).title, 0)
    gstate[n.id] = { x: n.x, y: n.y, w: s.w, h: s.h, shape: n.shape || 'rect' }
  }
  const visGeom = (id) => gstate[id]
  const visList = []
  const visSeen = []
  for (let vi = 0; vi < model.nodes.length; vi++) {
    const vg = visGeom(model.nodes[vi].id)
    if (!vg || visSeen.indexOf(vg) >= 0) continue
    visSeen.push(vg)
    visList.push(vg)
  }

  const pairCount = {}
  for (let pi = 0; pi < model.edges.length; pi++) {
    const pe = model.edges[pi]
    const pk = pe.from < pe.to ? pe.from + '|' + pe.to : pe.to + '|' + pe.from
    pairCount[pk] = (pairCount[pk] || 0) + 1
  }

  const tConsolidate0 = performance.now()
  const consolidated = api.consolidateEdgesModel(model)
  const tConsolidate1 = performance.now()

  const renderEdges = consolidated.edges || []
  const sideGroups = {}

  const tSides0 = performance.now()
  for (let gi = 0; gi < renderEdges.length; gi++) {
    const ge = renderEdges[gi]
    const ga2 = visGeom(ge.from)
    const gb2 = visGeom(ge.to)
    if (!ga2 || !gb2) continue
    const gSides = api.edgeSidesOf(ga2, gb2, visList)
    for (let gend = 0; gend < 2; gend++) {
      const got = gend === 0 ? gb2 : ga2
      const gside = gend === 0 ? gSides.a : gSides.b
      const gunit = gend === 0 ? ge.from : ge.to
      const gkey = gunit + '|' + gside
      if (!sideGroups[gkey]) sideGroups[gkey] = []
      const gax = gside === 't' || gside === 'b'
      sideGroups[gkey].push({ ei: gi, end: gend, at: gax ? got.x : got.y })
    }
  }
  const tSides1 = performance.now()

  const portSlots = {}
  for (const sk in sideGroups) {
    const sArr = sideGroups[sk]
    sArr.sort((x, y) => x.at - y.at)
    for (let si2 = 0; si2 < sArr.length; si2++) {
      const sItem = sArr[si2]
      portSlots[sItem.ei + ':' + sItem.end] = { n: sArr.length, i: si2 }
    }
  }

  const usedLanes = []
  const pairSeen = {}
  const routed = []
  const tGeom0 = performance.now()
  for (let ei = 0; ei < renderEdges.length; ei++) {
    const red = renderEdges[ei]
    const rek = red.from < red.to ? red.from + '|' + red.to : red.to + '|' + red.from
    const ren = pairCount[rek] || 1
    const reidx = pairSeen[rek] || 0
    pairSeen[rek] = reidx + 1
    const rgeo = api.edgeGeometry(visGeom(red.from), visGeom(red.to), visList,
      ren > 1 ? (reidx - (ren - 1) / 2) * 10 : 0,
      { a: portSlots[ei + ':0'], b: portSlots[ei + ':1'] }, usedLanes)
    if (!rgeo) continue
    const rlanes = rgeo.lanes || []
    for (let rl = 0; rl < rlanes.length; rl++) usedLanes.push(rlanes[rl])
    routed.push({ ei, ed: red, geo: rgeo, hops: [] })
  }
  const tGeom1 = performance.now()

  const tHops0 = performance.now()
  for (let ca = 0; ca < routed.length; ca++) {
    const pa = routed[ca].geo.pts
    for (let cb = ca + 1; cb < routed.length; cb++) {
      const pb = routed[cb].geo.pts
      for (let sa = 0; sa + 1 < pa.length; sa++) {
        const a1 = pa[sa], a2 = pa[sa + 1]
        const aVert = Math.abs(a1.x - a2.x) < 0.5
        if (Math.abs(a1.x - a2.x) > 0.5 && Math.abs(a1.y - a2.y) > 0.5) continue
        for (let sb = 0; sb + 1 < pb.length; sb++) {
          const b1 = pb[sb], b2 = pb[sb + 1]
          const bVert = Math.abs(b1.x - b2.x) < 0.5
          if (aVert === bVert) continue
          if (Math.abs(b1.x - b2.x) > 0.5 && Math.abs(b1.y - b2.y) > 0.5) continue
          const hor = aVert ? { p: b1, q: b2 } : { p: a1, q: a2 }
          const ver = aVert ? { p: a1, q: a2 } : { p: b1, q: b2 }
          const hx1 = Math.min(hor.p.x, hor.q.x), hx2 = Math.max(hor.p.x, hor.q.x)
          const hy1 = Math.min(ver.p.y, ver.q.y), hy2 = Math.max(ver.p.y, ver.q.y)
          const hy = hor.p.y, vx = ver.p.x
          if (vx > hx1 + 3 && vx < hx2 - 3 && hy > hy1 + 3 && hy < hy2 - 3) {
            routed[cb].hops.push({ x: vx, y: hy })
          }
        }
      }
    }
  }
  const tHops1 = performance.now()

  return {
    consolidateMs: tConsolidate1 - tConsolidate0,
    sidesMs: tSides1 - tSides0,
    geomMs: tGeom1 - tGeom0,
    hopsMs: tHops1 - tHops0,
    totalEdgeMs: (tSides1 - tSides0) + (tGeom1 - tGeom0) + (tHops1 - tHops0),
    edgesCount: renderEdges.length
  }
}

// 6. 执行核心度量
async function runBenchmarks() {
  const NS = [20, 50, 100, 200, 400]
  const ROUNDS = 5
  const container = document.getElementById('app')
  const root = createRoot(container)

  console.log('========================================================================================')
  console.log('             arch-canvas 浏览器半「大图渲染与交互」实测热点基准测试')
  console.log('  每档 N ∈ {20, 50, 100, 200, 400}，边数 M=round(1.2*N)，每档运行 5 轮取中位数与 MAD')
  console.log('========================================================================================\n')

  const summary = []

  for (const N of NS) {
    const rawModel = generateBenchmarkModel(N)
    const laidModel = api.autoLayout(rawModel)

    currentDoc = {
      ok: true, revision: 1, updatedBy: 'switch',
      model: laidModel,
      mermaid: 'flowchart TD\n',
      file: '/tmp/test.mmd', diagram: 'test', key: 'test',
      external: null, dir: '/tmp', scope: 'project', workspace: '/tmp',
      nodeCount: laidModel.nodes.length, edgeCount: laidModel.edges.length,
      groupCount: (laidModel.groups && laidModel.groups.length) || 0, libraryRev: 1, historyCount: 1,
      warnings: [], notes: [], lastChange: null
    }

    const samplesLayout = []
    const samplesEdgeGeom = []
    const samplesTreeMount = []
    const samplesSelect = []
    const samplesHops = []
    const samplesConsolidate = []
    const samplesScc = []
    const samplesCrossings = []

    // 运行 ROUNDS 次
    for (let r = 0; r < ROUNDS; r++) {
      // 1) 布局耗时
      const tL0 = performance.now()
      api.autoLayout(rawModel)
      const tL1 = performance.now()
      samplesLayout.push(tL1 - tL0)

      // 2) 连线几何耗时
      const edgeRes = measureEdgePipeline(laidModel)
      samplesEdgeGeom.push(edgeRes.geomMs)
      samplesHops.push(edgeRes.hopsMs)
      samplesConsolidate.push(edgeRes.consolidateMs)

      // 3) 树挂载渲染耗时
      const tM0 = performance.now()
      await act(async () => {
        root.render(React.createElement(captured['conversation.view'], {
          cwd: '/tmp', sessionId: `s_${N}_${r}`, useSessions: () => '/tmp'
        }))
      })
      await act(async () => { await Promise.resolve() })
      const tM1 = performance.now()
      samplesTreeMount.push(tM1 - tM0)

      // 4) 交互点击耗时 (Node Select)
      const nodeEl = container.querySelector('.ac-node')
      if (nodeEl) {
        const tI0 = performance.now()
        await act(async () => {
          nodeEl.dispatchEvent(new dom.window.PointerEvent('pointerdown', { bubbles: true, button: 0 }))
          nodeEl.dispatchEvent(new dom.window.PointerEvent('pointerup', { bubbles: true, button: 0 }))
        })
        const tI1 = performance.now()
        samplesSelect.push(tI1 - tI0)
      }

      // 5) 细分子项
      const pairs = rawModel.edges.map(e => [e.from, e.to])
      const ids = rawModel.nodes.map(n => n.id)
      const tScc0 = performance.now()
      api.sccOf(ids, pairs)
      const tScc1 = performance.now()
      samplesScc.push(tScc1 - tScc0)

      const pos = {}
      for (let i = 0; i < N; i++) pos[ids[i]] = { x: (i % 10) * 100, y: Math.floor(i / 10) * 100 }
      const tCr0 = performance.now()
      api.crossingsOf(pos, pairs)
      const tCr1 = performance.now()
      samplesCrossings.push(tCr1 - tCr0)
    }

    const statMount = calcStats(samplesTreeMount)
    const statLayout = calcStats(samplesLayout)
    const statEdge = calcStats(samplesEdgeGeom)
    const statSelect = calcStats(samplesSelect)
    const statHops = calcStats(samplesHops)
    const statCross = calcStats(samplesCrossings)
    const statConsolidate = calcStats(samplesConsolidate)
    const statScc = calcStats(samplesScc)

    summary.push({
      N,
      E: rawModel.edges.length,
      statMount,
      statLayout,
      statEdge,
      statSelect,
      statHops,
      statCross,
      statConsolidate,
      statScc
    })

    console.log(`[档位 N=${N}, M=${rawModel.edges.length}]`)
    console.log(`  - 整棵树挂载渲染 (Tree Mount):  中位数 ${statMount.median.toFixed(2)} ms (±${statMount.mad.toFixed(2)} ms, 范围 [${statMount.min.toFixed(2)} .. ${statMount.max.toFixed(2)}])`)
    console.log(`  - 节点点选交互 (Node Select):   中位数 ${statSelect.median.toFixed(2)} ms (±${statSelect.mad.toFixed(2)} ms, 范围 [${statSelect.min.toFixed(2)} .. ${statSelect.max.toFixed(2)}])`)
    console.log(`  - 自动布局 (autoLayout):        中位数 ${statLayout.median.toFixed(2)} ms (±${statLayout.mad.toFixed(2)} ms, 范围 [${statLayout.min.toFixed(2)} .. ${statLayout.max.toFixed(2)}])`)
    console.log(`  - 连线几何 (edgeGeometry):      中位数 ${statEdge.median.toFixed(2)} ms (±${statEdge.mad.toFixed(2)} ms, 范围 [${statEdge.min.toFixed(2)} .. ${statEdge.max.toFixed(2)}])`)
    console.log(`  - 拱桥相交检测 (hops):          中位数 ${statHops.median.toFixed(2)} ms (±${statHops.mad.toFixed(2)} ms, 范围 [${statHops.min.toFixed(2)} .. ${statHops.max.toFixed(2)}])`)
    console.log(`  - 交叉数检测 (crossingsOf单次): 中位数 ${statCross.median.toFixed(3)} ms (±${statCross.mad.toFixed(3)} ms)`)
    console.log(`  - [负向] 平行边合并 (consolidate): 中位数 ${statConsolidate.median.toFixed(3)} ms (±${statConsolidate.mad.toFixed(3)} ms)`)
    console.log(`  - [负向] 强连通分量 (sccOf):       中位数 ${statScc.median.toFixed(3)} ms (±${statScc.mad.toFixed(3)} ms)`)
    console.log('')
  }

  // 打印综合对比表与倍率
  console.log('========================================================================================')
  console.log('                          实测数据汇总与相邻档倍率分析')
  console.log('========================================================================================')
  console.log('|  N  |  M  | Tree Mount (倍率) | Node Select (倍率) | autoLayout (倍率) | edgeGeometry (倍率) |')
  console.log('|-----|-----|-------------------|--------------------|-------------------|---------------------|')

  for (let i = 0; i < summary.length; i++) {
    const s = summary[i]
    let mRatio = '-', sRatio = '-', lRatio = '-', eRatio = '-'
    if (i > 0) {
      const prev = summary[i - 1]
      mRatio = (s.statMount.median / prev.statMount.median).toFixed(2) + 'x'
      sRatio = (s.statSelect.median / prev.statSelect.median).toFixed(2) + 'x'
      lRatio = (s.statLayout.median / prev.statLayout.median).toFixed(2) + 'x'
      eRatio = (s.statEdge.median / prev.statEdge.median).toFixed(2) + 'x'
    }
    const mountStr = `${s.statMount.median.toFixed(1)}ms (${mRatio})`.padEnd(17)
    const selectStr = `${s.statSelect.median.toFixed(1)}ms (${sRatio})`.padEnd(18)
    const layoutStr = `${s.statLayout.median.toFixed(1)}ms (${lRatio})`.padEnd(17)
    const edgeStr = `${s.statEdge.median.toFixed(1)}ms (${eRatio})`.padEnd(19)
    console.log(`| ${s.N.toString().padEnd(3)} | ${s.E.toString().padEnd(3)} | ${mountStr} | ${selectStr} | ${layoutStr} | ${edgeStr} |`)
  }
  console.log('========================================================================================\n')
}

// 7. 单项热点独立复现模式
async function runSpecific(hotspot) {
  if (hotspot === 'edge-geometry') {
    console.log('--- [复现命令] 热点 1: edgeGeometry 连线几何与避障搜索 ---')
    for (const N of [50, 100, 200, 400]) {
      const model = generateBenchmarkModel(N)
      const laid = api.autoLayout(model)
      const t0 = performance.now()
      const res = measureEdgePipeline(laid)
      const t1 = performance.now()
      console.log(`N=${N.toString().padEnd(3)}, E=${model.edges.length.toString().padEnd(3)}: edgeGeometry=${res.geomMs.toFixed(2)}ms (总连线管线=${(t1 - t0).toFixed(2)}ms)`)
    }
  } else if (hotspot === 'interaction-re-render') {
    console.log('--- [复现命令] 热点 2: 单次点击交互 (Node Select) 触发整树与连线重算 ---')
    const container = document.getElementById('app')
    const root = createRoot(container)
    for (const N of [50, 100, 200, 400]) {
      const rawModel = generateBenchmarkModel(N)
      const laidModel = api.autoLayout(rawModel)
      currentDoc = {
        ok: true, revision: 1, updatedBy: 'switch', model: laidModel, mermaid: 'flowchart TD\n',
        file: '/tmp/test.mmd', diagram: 'test', key: 'test', external: null, dir: '/tmp', scope: 'project', workspace: '/tmp',
        nodeCount: N, edgeCount: rawModel.edges.length, groupCount: 5, libraryRev: 1, historyCount: 1, warnings: [], notes: [], lastChange: null
      }
      await act(async () => {
        root.render(React.createElement(captured['conversation.view'], { cwd: '/tmp', sessionId: `s_int_${N}`, useSessions: () => '/tmp' }))
      })
      await act(async () => { await Promise.resolve() })
      const nodeEl = container.querySelector('.ac-node')
      const t0 = performance.now()
      await act(async () => {
        nodeEl.dispatchEvent(new dom.window.PointerEvent('pointerdown', { bubbles: true, button: 0 }))
        nodeEl.dispatchEvent(new dom.window.PointerEvent('pointerup', { bubbles: true, button: 0 }))
      })
      const t1 = performance.now()
      console.log(`N=${N.toString().padEnd(3)}, E=${rawModel.edges.length.toString().padEnd(3)}: 点选节点重算耗时=${(t1 - t0).toFixed(2)}ms`)
    }
  } else if (hotspot === 'layout-crossings') {
    console.log('--- [复现命令] 热点 3: autoLayout 中 crossingsOf 交叉数检测 ---')
    for (const N of [50, 100, 200, 400]) {
      const model = generateBenchmarkModel(N)
      const pairs = model.edges.map(e => [e.from, e.to])
      const pos = {}
      for (let i = 0; i < N; i++) pos[`n${i}`] = { x: (i % 10) * 100, y: Math.floor(i / 10) * 100 }
      const t0 = performance.now()
      const c = api.crossingsOf(pos, pairs)
      const t1 = performance.now()
      console.log(`N=${N.toString().padEnd(3)}, E=${pairs.length.toString().padEnd(3)}: crossingsOf单次耗时=${(t1 - t0).toFixed(3)}ms (交叉数=${c})`)
    }
  } else if (hotspot === 'negative-control') {
    console.log('--- [复现命令] 负向对照: consolidateEdgesModel 与 sccOf 的线性表现 ---')
    for (const N of [50, 100, 200, 400]) {
      const model = generateBenchmarkModel(N)
      const pairs = model.edges.map(e => [e.from, e.to])
      const ids = model.nodes.map(n => n.id)
      const tC0 = performance.now()
      api.consolidateEdgesModel(model)
      const tC1 = performance.now()
      const tS0 = performance.now()
      api.sccOf(ids, pairs)
      const tS1 = performance.now()
      console.log(`N=${N.toString().padEnd(3)}, E=${pairs.length.toString().padEnd(3)}: consolidateEdgesModel=${(tC1 - tC0).toFixed(3)}ms, sccOf=${(tS1 - tS0).toFixed(3)}ms`)
    }
  }
}

// 主入口解析参数
const args = process.argv.slice(2)
const hsArg = args.find(a => a.startsWith('--hotspot='))
const isNeg = args.includes('--negative-control')

if (hsArg) {
  const name = hsArg.split('=')[1]
  await runSpecific(name)
  process.exit(0)
} else if (isNeg) {
  await runSpecific('negative-control')
  process.exit(0)
} else {
  await runBenchmarks()
  process.exit(0)
}
