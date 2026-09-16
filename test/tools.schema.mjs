// 守住四个工具的 parameters 是**规范 JSON Schema**：根 `type: 'object'` 且带 `properties`/`required`。
// 这是 dsh 自己的 ToolDefinition 契约（dsh-tools 的 ObjectJsonSchema），两条加载半边都要过：
//
//   真插件（装机形态）   lib/index.js → ctx.tools.register(def)  —— **原样**注册，不做任何包装
//   动态 Package（开发形态）harness.defineTool（沙箱壳）      —— 归一化，规范形态和裸属性表都收
//
// 踩过的坑：定义里 parameters 曾经是「裸属性表」`{ key: schema }`。沙箱那条路会自动包一层
// `type: 'object'`，所以照着沙箱写的 schema 测试一直绿；装机走 lib/index.js 原样注册，运行时不包 ——
// 一用 Antigravity 端点就 400：
//   Invalid JSON payload received. Unknown name "ops" at 'request.tools[0].function_declarations[0].parameters'
//   Invalid schema for function 'arch_edit': schema must be a JSON Schema of 'type: "object"', got 'type: null'
//
// 所以这里**不抄定义**：直接抓构建产物 lib/host-logic.js 在真插件 half 上注册的那四个定义。
// 抄一份「逐字同形」的副本看着像守着，其实守住的是副本 —— 源码改回裸属性表它也照样绿。
import { createRequire } from 'node:module'

const DSH_ROOT = process.env.DSH_ROOT ?? '/usr/lib/node_modules/@deepseek-ai/dsh'
const { assertSupportedJsonSchema, assertObjectJsonSchema } = await import(
  `${DSH_ROOT}/node_modules/@deepseek-ai/dsh-tools/lib/index.js`
)
const { sandboxDefineTool } = await import(
  `${DSH_ROOT}/node_modules/@deepseek-ai/dsh-cordis-host-runner/lib/types/guard.js`
)

// ---------- 真插件形态：和 src/package/host.ts 递进去的 harness 同形 ----------
const registered = []
const harness = {
  handle: () => {},
  route: () => {},
  defineTool: (def) => def,
  registerTool: (_ctx, def) => { registered.push(def) },
}

const require = createRequire(import.meta.url)
const logicPath = new URL('../lib/host-logic.js', import.meta.url)
let plugin
try {
  plugin = require(logicPath.pathname)(harness, {
    uiFile: '/dev/null',
    mermaidFile: '/dev/null',
    // 数据目录是外层硬依赖（缺了宿主逻辑直接抛错）：这里给个临时目录，测试不碰真图库
    dataDir: '/tmp/arch-canvas-schema-test',
  })
} catch (e) {
  console.error('✗ 加载不了 lib/host-logic.js：' + e.message + '（先跑 npm run build）')
  process.exit(1)
}
// ctx 桩要给 inject：宿主逻辑用它注册周期扫描（真 cordis 上下文自带 inject）
plugin.apply({
  get: () => undefined,
  effect: (fn) => fn(),
  on: () => () => {},
  inject: (_names, cb) => { cb({ effect: (fn) => fn(), interval: () => () => {} }) },
})

let bad = 0
const fail = (msg) => { bad++; console.log('  ✗ ' + msg) }

if (registered.length !== 4) {
  fail(`注册到的工具数不是 4（实际 ${registered.length}：${registered.map((d) => d.name)}）`)
}

// ---------- 契约一：dsh 的 schema 子集必须接受它（装机路径原样送出去的正是这个） ----------
console.log('【ctx.tools.register 收到的东西必须是规范 object 根】')
for (const def of registered) {
  const p = def.parameters
  let rejected = ''
  try {
    assertSupportedJsonSchema(p)
    assertObjectJsonSchema(p)
  } catch (e) {
    rejected = e.message.split('\n')[0]
  }
  const declared = Object.keys(p?.properties ?? {})
  const required = p?.required ?? []
  const undeclared = required.filter((r) => !declared.includes(r))
  const ok = !rejected && p?.type === 'object' && declared.length > 0 && undeclared.length === 0
  if (!ok) {
    fail(`${def.name} 的 parameters 不合规：${rejected || `type=${p?.type} properties=[${declared}] required=[${required}]`}`)
    continue
  }
  console.log(`  ✓ ${def.name.padEnd(11)} type=object properties=[${declared}] required=${JSON.stringify(required)}`)
}

// ---------- 契约二：同一份定义经沙箱 defineTool（开发形态）也不能变形 ----------
console.log('【沙箱 defineTool 归一化后仍要是同一个 object 根】')
for (const def of registered) {
  try {
    const t = sandboxDefineTool({ ...def, parameters: JSON.parse(JSON.stringify(def.parameters)) })
    const p = t.parameters
    const declared = Object.keys(p.properties ?? {})
    const want = Object.keys(def.parameters?.properties ?? {})
    if (p.type !== 'object' || declared.join() !== want.join()) {
      fail(`${def.name} 归一化后走样：type=${p.type} properties=[${declared}]，期望 [${want}]`)
      continue
    }
    if (JSON.stringify(p.required ?? []) !== JSON.stringify(def.parameters.required ?? [])) {
      fail(`${def.name} 归一化后 required 变了：${JSON.stringify(p.required)}`)
      continue
    }
    console.log(`  ✓ ${def.name.padEnd(11)} 归一化后一致`)
  } catch (e) {
    fail(`${def.name} 过不了沙箱 defineTool：${String(e.message).slice(0, 400)}`)
  }
}

// ---------- 契约三：规范形态下 execute → render 这条链还活着 ----------
// （arch_edit 的 ops 是嵌套 object，最容易在归一化里被吃掉）
console.log('【execute → render 链路】')
try {
  const edit = registered.find((d) => d.name === 'arch_edit')
  const call = edit.execute({ ops: [{ op: 'add_node', id: 'smoke' }] }, {})
  if (call && typeof call.then === 'function') {
    const blocks = edit.output.render({ ops: [] }, await call)
    console.log('  ✓ arch_edit execute → render  →  ' + JSON.stringify(blocks).slice(0, 200))
  } else {
    // 桩 fs 不存在时 execute 会返回 ok:false 之类的结构，render 仍不许抛
    console.log('  ✓ arch_edit execute 返回结构，render  →  ' + JSON.stringify(edit.output.render({ ops: [] }, call)).slice(0, 200))
  }
} catch (e) {
  fail('execute → render 抛了：' + String(e.message).slice(0, 400))
}

console.log(bad === 0 ? '\n全部通过\n' : '\n' + bad + ' 项失败\n')
process.exit(bad === 0 ? 0 : 1)
