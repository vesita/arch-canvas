// 预渲染测试与 SVG 预览生成
// 验证同向箭头合并与按边方向的自动分层排序
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const RUNTIME_FILE = path.join(ROOT, 'dist', 'client-runtime.js')

if (!fs.existsSync(RUNTIME_FILE)) {
  console.error('缺少 dist/client-runtime.js，请先跑 npm run build')
  process.exit(1)
}

const runtimeSrc = fs.readFileSync(RUNTIME_FILE, 'utf8')
const api = new Function(runtimeSrc + '\n;return {'
  + ' autoLayout: autoLayout, consolidateEdgesModel: consolidateEdgesModel,'
  + ' nodeSize: nodeSize, splitLabel: splitLabel };')()

console.log('--- 架构画布 (arch-canvas) 预渲染与自动排序效果检验 ---')

// 构造带多条同向平行边的测试架构模型（夹具不带 groups / group：生产模型里没有这些字段）
const testModel = {
  direction: 'TD',
  nodes: [
    { id: 'gw', label: 'API网关\n统一流量入口', shape: 'hex' },
    { id: 'auth', label: '鉴权守卫\nToken与白名单', shape: 'diamond' },
    { id: 'svc1', label: '订单服务\n核心业务调度', shape: 'rect' },
    { id: 'svc2', label: '库存服务\n库存扣减锁', shape: 'rect' },
    { id: 'db', label: 'MySQL主库\n订单与流水', shape: 'cyl' },
    { id: 'cache', label: 'Redis集群\n热点缓存', shape: 'cyl' },
    { id: 'mq', label: 'Kafka总线\n异步解耦', shape: 'asym' },
  ],
  edges: [
    { id: 'e1', from: 'gw', to: 'auth', label: '请求鉴权', arrow: '-->' },
    { id: 'e2', from: 'auth', to: 'svc1', label: '派发请求', arrow: '-->' },
    // 故意增加同向多平行边（痛点场景）
    { id: 'e3', from: 'svc1', to: 'svc2', label: '检查库存', arrow: '-->' },
    { id: 'e4', from: 'svc1', to: 'svc2', label: '锁定库存', arrow: '-->' },
    { id: 'e5', from: 'svc1', to: 'svc2', label: '核销配额', arrow: '-->' },
    { id: 'e6', from: 'svc1', to: 'db', label: '写入主单', arrow: '-->' },
    { id: 'e7', from: 'svc1', to: 'db', label: '记录流水', arrow: '-->' },
    { id: 'e8', from: 'svc1', to: 'cache', label: '写入缓存', arrow: '-->' },
    { id: 'e9', from: 'svc1', to: 'mq', label: '发送事件', arrow: '-.->' },
  ],
  extras: []
}

console.log(`原始模型：节点数 ${testModel.nodes.length}，连线数 ${testModel.edges.length}`)

// 1. 测试同向边合并效果
const consolidated = api.consolidateEdgesModel(testModel)
console.log(`合并同向平行边后连线数：${consolidated.edges.length}（成功消除 ${testModel.edges.length - consolidated.edges.length} 条重复平行线）`)

const svc1ToSvc2 = consolidated.edges.find(e => e.from === 'svc1' && e.to === 'svc2')
console.log(`  svc1 -> svc2 合并后标签: "${svc1ToSvc2?.label}"`)
const svc1ToDb = consolidated.edges.find(e => e.from === 'svc1' && e.to === 'db')
console.log(`  svc1 -> db   合并后标签: "${svc1ToDb?.label}"`)

if (!svc1ToSvc2 || svc1ToSvc2.label !== '检查库存 / 锁定库存 / 核销配额') {
  console.error('FAIL: 同向边合并标签拼接不符合预期！')
  process.exit(1)
}

// 2. 测试自动拓扑分层排序效果：判据只看**边方向**，与布局实现（含是否分组感知）无关
const laid = api.autoLayout(consolidated)
console.log('\n自动排序与布局坐标分布：')
const yById = {}
for (const n of laid.nodes) {
  console.log(`  节点 [${n.id.padEnd(5)}] -> 坐标 (x: ${String(n.x).padStart(5)}, y: ${String(n.y).padStart(5)})`)
  yById[n.id] = n.y
}

// 无环链 gw -> auth -> svc1（方向完全由边定义）：TD 下源头在上（y 严格递增），
// BT 下源头在下（y 严格递减）。任何按边方向分层的布局都必须满足，不依赖组或具体算法。
const chain = ['gw', 'auth', 'svc1']
console.log(`\n边方向流向验证（链 gw -> auth -> svc1）：`)
console.log(`  TD: ${chain.join(' -> ')} 的 y = ${chain.map(id => yById[id]).join(', ')}`)
if (!(yById.gw < yById.auth && yById.auth < yById.svc1)) {
  console.error('FAIL: TD 下沿边方向 y 未严格递增（拓扑层次流向倒置）！')
  process.exit(1)
}

const laidBt = api.autoLayout(Object.assign({}, consolidated, { direction: 'BT' }))
const btY = {}
for (const n of laidBt.nodes) btY[n.id] = n.y
console.log(`  BT: ${chain.join(' -> ')} 的 y = ${chain.map(id => btY[id]).join(', ')}`)
if (!(btY.gw > btY.auth && btY.auth > btY.svc1)) {
  console.error('FAIL: BT 下沿边方向 y 未严格递减（方向翻转失效）！')
  process.exit(1)
}

// 3. 生成可直观查看的预览 SVG
const minX = Math.min(...laid.nodes.map(n => n.x)) - 100
const maxX = Math.max(...laid.nodes.map(n => n.x)) + 100
const minY = Math.min(...laid.nodes.map(n => n.y)) - 80
const maxY = Math.max(...laid.nodes.map(n => n.y)) + 80
const width = maxX - minX
const height = maxY - minY

let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${width} ${height}" width="${width}" height="${height}">\n`
svg += `  <style>
    .node rect, .node polygon { fill: #f8fafc; stroke: #3b82f6; stroke-width: 2; rx: 6; }
    .node text { font-family: sans-serif; font-size: 13px; text-anchor: middle; fill: #1e293b; }
    .edge { stroke: #64748b; stroke-width: 1.8; fill: none; }
    .edge.dashed { stroke-dasharray: 5 4; }
    .edge-lbl { font-family: sans-serif; font-size: 11px; fill: #475569; text-anchor: middle; }
    .edge-bg { fill: #ffffff; opacity: 0.9; }
  </style>\n`

// 画边
for (const e of consolidated.edges) {
  const f = laid.nodes.find(n => n.id === e.from)
  const t = laid.nodes.find(n => n.id === e.to)
  if (!f || !t) continue
  const midX = (f.x + t.x) / 2
  const midY = (f.y + t.y) / 2
  const isDashed = e.arrow === '-.->'
  svg += `  <path class="edge ${isDashed ? 'dashed' : ''}" d="M ${f.x} ${f.y + 20} L ${f.x} ${midY} L ${t.x} ${midY} L ${t.x} ${t.y - 20}" />\n`
  if (e.label) {
    const lblW = e.label.length * 9 + 12
    svg += `  <rect class="edge-bg" x="${midX - lblW/2}" y="${midY - 8}" width="${lblW}" height="16" rx="4" />\n`
    svg += `  <text class="edge-lbl" x="${midX}" y="${midY + 4}">${e.label}</text>\n`
  }
}

// 画节点
for (const n of laid.nodes) {
  const lines = n.label.split('\n')
  svg += `  <g class="node">\n`
  svg += `    <rect x="${n.x - 65}" y="${n.y - 22}" width="130" height="44" />\n`
  svg += `    <text x="${n.x}" y="${n.y - 2}" font-weight="bold">${lines[0] || ''}</text>\n`
  if (lines[1]) svg += `    <text x="${n.x}" y="${n.y + 14}" font-size="11" fill="#64748b">${lines[1]}</text>\n`
  svg += `  </g>\n`
}

svg += `</svg>\n`

const previewPath = path.join(ROOT, 'test', 'output-preview.svg')
fs.writeFileSync(previewPath, svg, 'utf8')
console.log(`\n✓ 成功生成预渲染矢量预览文件: test/output-preview.svg`)
console.log('✓ 同向连线合并与拓扑分层自动排序效果检验 100% 通过！\n')
