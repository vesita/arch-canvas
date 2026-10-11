// 界面渲染分片（共享脚手架见 ui.render.shared.mjs；DOM/React/桩 RPC/槽位捕获都由它装载）。
import { endPhase } from './ui.render.shared.mjs'

ok('ui.js 挂出了 __archCanvas.install', !!(globalThis.__archCanvas && typeof globalThis.__archCanvas.install === 'function'))
console.log('\n[1] 注册面')
const dispose = globalThis.__archCanvasDispose
ok('注册了主窗口子页标签体', typeof captured['conversation.view'] === 'function')
eq('子页 id 是 arch-canvas', capturedDef['conversation.view'].id, 'arch-canvas')
eq('子页排在「对话」「轨迹」之后', capturedDef['conversation.view'].order, 30)
eq('子页标题', capturedDef['conversation.view'].label, '架构画布')
ok('注册了 @ 引用源（按会话取节点的那条）', !!capturedSource && capturedSource.trigger === '@' && capturedSource.name === 'arch-canvas')
ok('样式里有起始页与选择器的样式', insertedCss.indexOf('.ac-start') >= 0 && insertedCss.indexOf('.ac-lib') >= 0)
console.log('\n[2] 首次渲染：工具条与空画布都得有出路')
await act(async () => {
  root.render(React.createElement(captured['conversation.view'], {
    cwd: UI, sessionId: 's1', useSessions: () => UI,
  }))
})
await flush()
const html = () => container.innerHTML
const buttons = () => Array.from(container.querySelectorAll('button'))
const byText = (t) => buttons().find((b) => b.textContent.trim() === t)

ok('工具条：＋ 节点', !!byText('＋ 节点'))
ok('工具条：自动布局', !!byText('自动布局'))
ok('工具条：适应窗口', !!byText('适应窗口'))
ok('工具条：删除', !!byText('删除'))
ok('工具条：导出 SVG / PNG / 复制源码', !!byText('SVG') && !!byText('PNG') && !!byText('复制源码'))
ok('工具条：图库入口', !!buttons().find((b) => b.textContent.indexOf('图库') === 0), buttons().map((b) => b.textContent))
ok('工具条：常驻「打开」按钮', !!byText('打开'), buttons().map((b) => b.textContent))
ok('起始页：标题', html().indexOf('这张图还是空的') >= 0)
ok('起始页：三个动作按钮', !!byText('＋ 加一个节点') && !!byText('打开文件…') && !!byText('图库…'), buttons().map((b) => b.textContent))
ok('起始页：列出这个项目里已有的图', html().indexOf('这个项目里的图') >= 0 && html().indexOf('arch-canvas/architecture') >= 0)
ok('起始页：列出项目里的 mermaid 文件', html().indexOf('项目里的 mermaid 文件') >= 0 && html().indexOf('docs/design.mmd') >= 0)

console.log('\n[1b] 检查点：没有「AI 只读」开关了，改成随时可退回的历史')
{
  // 顶栏不该再有那个开关（真机上它永远打不开：写 settings.json 那次没带沙箱策略）
  ok('顶栏不再有「AI 只读」按钮', !byText('AI 只读') && !byText('AI 可改图'), buttons().map((b) => b.textContent))
  ok('面板加载时不再去读 setting:get', !rpcCalls.some((c) => c.method === 'setting:get'), rpcCalls.map((c) => c.method))
  const histBtn = buttons().find((b) => b.textContent.indexOf('历史') === 0)
  ok('顶栏有「历史」按钮（带条数）', !!histBtn, buttons().map((b) => b.textContent))
  eq('条数来自宿主的 historyCount', histBtn && histBtn.textContent.trim(), '历史 1')
}

console.log('\n[2b] 起始页里直接点开一张已有的图')
rpcCalls.length = 0
const startOpen = Array.from(container.querySelectorAll('.ac-start-row button')).find((b) => b.textContent.trim() === '打开' && b.closest('.ac-start-row').textContent.indexOf('arch-canvas/architecture') >= 0)
ok('起始页那一行有「打开」', !!startOpen, Array.from(container.querySelectorAll('.ac-start-row')).map((r) => r.textContent))
await act(async () => { startOpen.click() })
await flush()
const openDiagramCall = rpcCalls.find((c) => c.method === 'doc:open')
ok('调了 doc:open', !!openDiagramCall, rpcCalls.map((c) => c.method))
eq('带上了 key', openDiagramCall && openDiagramCall.args.key, 'arch-canvas/architecture')
eq('带上了 where', openDiagramCall && openDiagramCall.args.where, UI)

console.log('\n[3] 点工具条「打开」：展开选择器并读图库清单')
rpcCalls.length = 0
const toolOpen = container.querySelector('.ac-tools button[title^="打开项目里的"]')
ok('工具条那个「打开」找得到', !!toolOpen)
await act(async () => { toolOpen.click() })
await flush()
ok('调了 doc:list', rpcCalls.some((c) => c.method === 'doc:list'), rpcCalls.map((c) => c.method))
ok('选择器里有「重新扫描」', html().indexOf('重新扫描') >= 0)
ok('选择器里列出图库里的图（含子项目的）', html().indexOf('arch-canvas/architecture') >= 0)
ok('选择器里列出项目里的 mermaid 文件', html().indexOf('docs/design.mmd') >= 0)
const pathInput = container.querySelector('input[placeholder^="按路径打开"]')
ok('选择器里有「按路径打开」输入框', !!pathInput)

console.log('\n[4] 填路径并点「打开」→ 走 doc:openPath')
rpcCalls.length = 0
const setValue = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set
await act(async () => {
  // 先 focus：真实用户也是先点进输入框再打字
  pathInput.focus()
  setValue.call(pathInput, 'docs/design.mmd')
  pathInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
})
const openBtn = container.querySelector('.ac-lib-open button')
ok('选择器那一行有自己的「打开」', !!openBtn && openBtn.textContent.trim() === '打开', openBtn && openBtn.textContent)
ok('输入后按钮变为可用（onChange 确实进了 state）', !!openBtn && !openBtn.disabled, { disabled: openBtn && openBtn.disabled, value: pathInput.value })
await act(async () => { openBtn.click() })
await flush()
const openCall = rpcCalls.find((c) => c.method === 'doc:openPath')
ok('调了 doc:openPath', !!openCall)
eq('带上了 where（会话 cwd）', openCall && openCall.args.where, UI)
eq('带上了路径', openCall && openCall.args.path, 'docs/design.mmd')
// 判「收起」要看结构：起始页的提示文案里也含有「按路径打开」这几个字
ok('选择器随后收起（面板不再挂载）', !container.querySelector('.ac-lib'))

console.log('\n[4b] 空画布起手：「＋ 加一个节点」直接把图带到非空')
rpcCalls.length = 0
const addBtn = container.querySelector('.ac-start-actions button')
eq('起始页第一个动作是「＋ 加一个节点」', addBtn && addBtn.textContent.trim(), '＋ 加一个节点')
await act(async () => { addBtn.click() })
await flush()
const setCall = rpcCalls.find((c) => c.method === 'doc:set')
ok('调了 doc:set（加节点即落盘）', !!setCall, rpcCalls.map((c) => c.method))
eq('提交的模型里确实多了一个节点', setCall && setCall.args.model.nodes.length, 1)
ok('起始页消失（图不再为空）', !container.querySelector('.ac-start'))
ok('画布上出现了一个节点', !!container.querySelector('g.ac-node'))

console.log('\n[7] 卸载不留尾')
await act(async () => { root.unmount() })
dispose()
ok('卸载没抛错', true)
endPhase()
