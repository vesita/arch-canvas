// 界面渲染分片（共享脚手架见 ui.render.shared.mjs；DOM/React/桩 RPC/槽位捕获都由它装载）。
import { endPhase } from './ui.render.shared.mjs'

console.log('\n[4z] 客户端交互缺陷修复：发送不顶草稿 / 文档身份 / 选中复核 / 拖动收口 / 输入法 / 微调合历史 / 第二指针 / 枚举不丢值')
{
  // 八条都是「静默弄丢用户东西」或「静默说谎」那一档。每条都有**负向对照**：
  // 要么证明修复不是恒真式（撤掉修复就红），要么证明旁边的旧行为一个字没动。
  const prevZ = respond
  const Z = (id, label, extra) => Object.assign({ id, label, shape: 'rect', x: 40, y: 40 }, extra || {})
  const mkModelZ = (nodes, edges) => ({ nodes: nodes, edges: edges || [], direction: 'TD', extras: [] })
  const nodeEl = (h, t) => Array.from(h.querySelectorAll('g.ac-node')).find((el) => (el.textContent || '').indexOf(t) >= 0)
  const labelsOf = (h) => Array.from(h.querySelectorAll('g.ac-node .ac-lbl')).map((t) => t.textContent.trim())
  const dockState = (h) => ({ dock: !!h.querySelector('.ac-dock'), peek: !!h.querySelector('.ac-peek') })
  const rectX = (h, t) => {
    const g = nodeEl(h, t)
    const r = g && g.querySelector('rect:not(.ac-pulse)')
    return r ? Number(r.getAttribute('x')) : null
  }
  const fireP = (el, type, extra) => el.dispatchEvent(new dom.window.PointerEvent(type, Object.assign({ bubbles: true, button: 0, clientX: 0, clientY: 0 }, extra || {})))
  const keyDown = (el, key, composing) => el.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, isComposing: !!composing, bubbles: true }))
  const keyUp = (el, key) => el.dispatchEvent(new dom.window.KeyboardEvent('keyup', { key, bubbles: true }))
  // rAF 真的走一帧：拖动是「一帧一次 setLocal」，不等帧测到的就是「还没来得及更新」的世界。
  const frameZ = async () => { await act(async () => { await new Promise((r) => dom.window.requestAnimationFrame(() => r())) }) }
  const setNativeZ = (el, v) => {
    const proto = el.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v)
    el.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  }
  const setFieldZ = async (el, v) => { await act(async () => { setNativeZ(el, v) }); await flush() }
  const mountZ = async (props, stub) => {
    respond = stub
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => {
      root.render(React.createElement(captured['conversation.view'],
        Object.assign({ cwd: UI, sessionId: 's-4z', useSessions: () => UI }, props || {})))
    })
    await flush()
    return { host, root }
  }
  const dropZ = async (t) => { await act(async () => { t.root.unmount() }); t.host.remove() }
  const tabZ = async (h, label) => {
    await act(async () => { Array.from(h.querySelectorAll('.ac-tabs button')).find((b) => b.textContent.trim() === label).click() })
    await flush()
  }
  // 「宿主那边把图换掉了」= 源码页改文本 + 应用回画布（doc:applyText 的回执走 applyServer）
  const applyTextZ = async (h, text) => {
    await tabZ(h, '源码')
    await setFieldZ(h.querySelector('textarea.ac-area'), text)
    await act(async () => { Array.from(h.querySelectorAll('button')).find((b) => b.textContent.trim() === '应用回画布').click() })
    await flush()
    await tabZ(h, '画布')
  }
  const MER2 = 'flowchart TD\n  x1["甲"]\n  x2["乙"]\n'

  // ================= A. 「发送给 AI」不许顶掉用户打了一半的话（P0-1） =================
  {
    const MM = mkModelZ([Z('x1', '甲', { note: '甲上的留言' }), Z('x2', '乙', { x: 260 })])
    const drafts = []
    const submits = []
    const stub = (method, args) => {
      if (method === 'doc:get') return fullDoc({ model: MM, nodeCount: 2, mermaid: MER2 })
      if (method === 'doc:set') return fullDoc({ model: args.model, nodeCount: (args.model.nodes || []).length, revision: 2, updatedBy: 'user' })
      return prevZ(method, args)
    }
    const USER = '我已经打了一半的话，别删'
    const t = await mountZ({
      sessionId: 's-4z-send',
      inputActions: { setDraft: (s) => { drafts.push(s) }, submit: () => { submits.push(1) } },
      useInput: (sel) => sel({ draft: USER }),
    }, stub)
    await act(async () => { clickEl(nodeEl(t.host, '甲')) })
    await flush()
    const sendBtn = Array.from(t.host.querySelectorAll('.ac-dock button')).find((b) => b.textContent.trim() === '发送给 AI')
    ok('前置：检查器里有「发送给 AI」', !!sendBtn)
    ok('按钮 title 明说「不顶掉你打的字」', !!sendBtn && (sendBtn.getAttribute('title') || '').indexOf('不顶掉') >= 0,
      sendBtn && sendBtn.getAttribute('title'))
    if (sendBtn) { await act(async () => { sendBtn.click() }); await flush() }
    eq('setDraft 只调一次', drafts.length, 1)
    const got = String(drafts[0] == null ? '' : drafts[0])
    ok('用户打的那句话**还在**，而且原样排在最前面（修前整段被顶掉）', got.indexOf(USER) === 0, got.slice(0, 40))
    ok('节点上下文接在后面，没有因为「不顶」而丢掉', got.indexOf('x1') > USER.length, got.slice(0, 120))
    eq('这条按钮仍然只填入、不自动提交（与从前一致）', submits.length, 0)
    await dropZ(t)
  }
  {
    // 负向对照：草稿本来是空的 → 直接填节点信息，前面不许留一个空行
    const MM = mkModelZ([Z('x1', '甲', { note: '甲上的留言' })])
    const drafts2 = []
    const t2 = await mountZ({
      sessionId: 's-4z-send2',
      inputActions: { setDraft: (s) => { drafts2.push(s) }, submit: () => {} },
      useInput: (sel) => sel({ draft: '' }),
    }, (method, args) => {
      if (method === 'doc:get') return fullDoc({ model: MM, nodeCount: 1 })
      return prevZ(method, args)
    })
    await act(async () => { clickEl(nodeEl(t2.host, '甲')) })
    await flush()
    const b2 = Array.from(t2.host.querySelectorAll('.ac-dock button')).find((b) => b.textContent.trim() === '发送给 AI')
    if (b2) { await act(async () => { b2.click() }); await flush() }
    ok('负向对照：空草稿时填的就是节点信息本身（没有多余的空行前缀）',
      drafts2.length === 1 && String(drafts2[0]).indexOf('画布节点') >= 0 && String(drafts2[0]).indexOf('\n') !== 0,
      drafts2[0])
    await dropZ(t2)
  }

  // ================= B. 修订号是 per 文档槽的：先比身份，再比修订号（P0-2） =================
  const LIB_Z = {
    ok: true, dir: UI + '/.arch-canvas', scope: 'project', workspace: UI, current: 'A', external: null,
    items: [
      { name: 'A', deleted: false, nodes: 1, key: 'A', dir: UI + '/.arch-canvas' },
      { name: 'B', deleted: false, nodes: 1, key: 'B', dir: UI + '/.arch-canvas' },
    ],
    files: [], libraryRev: 1,
  }
  const openLibPick = async (h, name) => {
    await act(async () => { h.querySelector('.ac-tools button[title^="打开项目里的"]').click() })
    await flush()
    const row = Array.from(h.querySelectorAll('.ac-lib-row'))
      .find((r) => r.querySelector('.ac-lib-item') && r.querySelector('.ac-lib-item').textContent.trim().indexOf(name) === 0)
    ok('前置：图库清单里有「' + name + '」那一行', !!row)
    await act(async () => { row.querySelector('.ac-lib-item').click() })
    await flush()
  }
  {
    const MA = mkModelZ([Z('a1', 'A图')])
    const MB = mkModelZ([Z('b1', 'B图')])
    const t = await mountZ({ sessionId: 's-4z-id' }, (method, args) => {
      if (method === 'doc:get') return fullDoc({ key: 'A', diagram: 'A', model: MA, revision: 5, nodeCount: 1, mermaid: 'flowchart TD\n  a1["A图"]\n' })
      if (method === 'doc:list') return LIB_Z
      if (method === 'doc:open') {
        return fullDoc({
          key: args.key, diagram: args.key,
          model: args.key === 'B' ? MB : mkModelZ([Z('a1', '不该被旧回执画回来')]),
          revision: args.key === 'B' ? 1 : 3,   // B 是**另一份文档**（修订号从 1 起）；A 那份是过期回执
          nodeCount: 1, mermaid: 'flowchart TD\n', updatedBy: 'switch', lastChange: { by: 'switch', nodes: [] },
        })
      }
      return prevZ(method, args)
    })
    eq('前置：画布上是 A 的图', labelsOf(t.host).join(','), 'A图')
    await openLibPick(t.host, 'B')
    eq('切到 B：另一份文档的修订号（1 < 5）也必须照单接受（修前画布停在旧图上）', labelsOf(t.host).join(','), 'B图')
    const sb = t.host.querySelector('.ac-statusbar').textContent
    ok('状态栏「已切到 B」这次不是谎话（画布真的切了）', sb.indexOf('已切到「B」') >= 0 && sb.indexOf('r1') >= 0, sb)
    await dropZ(t)
  }
  {
    // 负向对照：**同一份文档**的过期回执（rev 3 < 已见到的 5）仍然必须被拒。
    // 走「按路径打开同一个文件」这条路：两次回执的 key/file 完全相同，只有修订号在倒退。
    const t = await mountZ({ sessionId: 's-4z-id2' }, (method, args) => {
      if (method === 'doc:get') return fullDoc({ key: 'A', diagram: 'A', model: mkModelZ([Z('a1', '甲')]), revision: 5, nodeCount: 1, mermaid: 'flowchart TD\n  a1["甲"]\n' })
      if (method === 'doc:list') return LIB_Z
      if (method === 'doc:openPath') {
        const stale = t.openCount > 0
        t.openCount += 1
        return fullDoc({
          key: args.path, diagram: args.path, file: args.path, external: args.path,
          model: mkModelZ([Z('a1', stale ? '不该出现' : '已打开')]),
          revision: stale ? 3 : 5, nodeCount: 1, mermaid: 'flowchart TD\n',
        })
      }
      return prevZ(method, args)
    })
    t.openCount = 0
    await act(async () => { t.host.querySelector('.ac-tools button[title^="打开项目里的"]').click() })
    await flush()
    const pathIn = t.host.querySelector('.ac-lib-open input')
    await setFieldZ(pathIn, 'docs/x.mmd')
    await act(async () => { keyDown(pathIn, 'Enter') })
    await flush()
    eq('前置：第一次按路径打开真的把画布换掉了', labelsOf(t.host).join(','), '已打开')
    // 打开成功会收起选择器；再开一次、填同一个路径（= 同一份文档的第二次回执）
    await act(async () => { t.host.querySelector('.ac-tools button[title^="打开项目里的"]').click() })
    await flush()
    await setFieldZ(t.host.querySelector('.ac-lib-open input'), 'docs/x.mmd')
    await act(async () => { keyDown(t.host.querySelector('.ac-lib-open input'), 'Enter') })
    await flush()
    eq('负向对照：同一份文档的过期回执（rev 3 < rev 5）仍被拒（乱序保护没有被我拆掉）', labelsOf(t.host).join(','), '已打开')
    await dropZ(t)
  }

  // ================= C. 宿主换掉模型时复核选中（P1-3） =================
  {
    const MA = mkModelZ([Z('x1', '甲'), Z('x2', '乙', { x: 260 })])
    const MB = mkModelZ([Z('x2', '乙', { x: 260 })])
    let phase = 'A'
    const sets = []
    const t = await mountZ({ sessionId: 's-4z-sel' }, (method, args) => {
      if (method === 'doc:get') return fullDoc({ model: phase === 'A' ? MA : MB, nodeCount: phase === 'A' ? 2 : 1, mermaid: MER2 })
      if (method === 'doc:applyText') {
        phase = String(args.text).indexOf('x1') >= 0 ? 'A' : 'B'
        return fullDoc({ model: phase === 'A' ? MA : MB, nodeCount: phase === 'A' ? 2 : 1, mermaid: MER2, revision: 5, updatedBy: 'user' })
      }
      if (method === 'doc:set') { sets.push(args.model); return fullDoc({ model: args.model, nodeCount: (args.model.nodes || []).length, revision: 9, updatedBy: 'user' }) }
      return prevZ(method, args)
    })
    await act(async () => { clickEl(nodeEl(t.host, '甲')) })
    await flush()
    ok('前置：选中甲、检查器展开', dockState(t.host).dock)
    await applyTextZ(t.host, 'flowchart TD\n  x2["乙"]\n')          // 宿主删掉了 x1
    ok('宿主删掉选中之后，内部选中也跟着复位（面板是「无选中」，不是「收起成细条」）',
      !dockState(t.host).dock && !dockState(t.host).peek, dockState(t.host))
    sets.length = 0
    await act(async () => { keyDown(t.host.querySelector('.ac-root'), 'Delete') })
    await flush()
    eq('在这份已不存在的选中上按 Delete 不再发空写盘（修前 = 1 次 doc:set + 假历史 + 谎报「已删除节点」）', sets.length, 0)
    await applyTextZ(t.host, MER2)                                   // 撤销/回滚把 x1 带回来
    await act(async () => { clickEl(nodeEl(t.host, '甲')) })
    await flush()
    ok('x1 回来之后点一下是**展开**详情（修前第一下被「收起」吞掉，只剩 .ac-peek）',
      dockState(t.host).dock && !dockState(t.host).peek, dockState(t.host))
    await dropZ(t)
  }
  {
    // Esc：宿主删掉选中之后，那一下 Esc 不许被一块**看不见的**面板吞掉
    const MA = mkModelZ([Z('x1', '甲'), Z('x2', '乙', { x: 260 })])
    const MB = mkModelZ([Z('x2', '乙', { x: 260 })])
    let phase = 'A'
    const sets = []
    const t = await mountZ({ sessionId: 's-4z-sel2' }, (method, args) => {
      if (method === 'doc:get') return fullDoc({ model: phase === 'A' ? MA : MB, nodeCount: phase === 'A' ? 2 : 1, mermaid: MER2 })
      if (method === 'doc:applyText') {
        phase = String(args.text).indexOf('x1') >= 0 ? 'A' : 'B'
        return fullDoc({ model: phase === 'A' ? MA : MB, nodeCount: phase === 'A' ? 2 : 1, mermaid: MER2, revision: 5, updatedBy: 'user' })
      }
      if (method === 'doc:set') { sets.push(args.model); return fullDoc({ model: args.model, nodeCount: (args.model.nodes || []).length, revision: 9, updatedBy: 'user' }) }
      return prevZ(method, args)
    })
    await act(async () => { clickEl(nodeEl(t.host, '甲')) })
    await flush()
    await applyTextZ(t.host, 'flowchart TD\n  x2["乙"]\n')
    await act(async () => { keyDown(t.host.querySelector('.ac-root'), 'Escape') })
    await flush()
    sets.length = 0
    await act(async () => { keyDown(t.host.querySelector('.ac-root'), 'Delete') })
    await flush()
    eq('第一下 Esc 不再被看不见的面板吞掉（修前 = 1 次空写盘）', sets.length, 0)
    await dropZ(t)
  }

  // ================= D. 切页 / 卸载与 pointercancel 同一类收口（P1-4） =================
  {
    const MM = mkModelZ([Z('m1', '甲'), Z('m2', '乙', { x: 300 })],
      [{ id: 'e1', from: 'm1', to: 'm2', label: '', arrow: '-->' }])
    const sets = []
    const t = await mountZ({ sessionId: 's-4z-drag' }, (method, args) => {
      if (method === 'doc:get') return fullDoc({ model: MM, nodeCount: 2, edgeCount: 1 })
      if (method === 'doc:set') { sets.push(args.model); return fullDoc({ model: args.model, nodeCount: (args.model.nodes || []).length, revision: 9, updatedBy: 'user' }) }
      return prevZ(method, args)
    })
    const svg = t.host.querySelector('svg.ac-svg')
    const x0 = rectX(t.host, '甲')
    await act(async () => { fireP(nodeEl(t.host, '甲'), 'pointerdown', { clientX: 20, clientY: 20 }) })
    await flush()
    await act(async () => { fireP(svg, 'pointermove', { clientX: 120, clientY: 20 }) })
    await frameZ()
    ok('前置：拖动中确实动了（pending 已经落成一帧）', rectX(t.host, '甲') !== x0, { x0, now: rectX(t.host, '甲') })
    await tabZ(t.host, '源码')
    await tabZ(t.host, '画布')
    // 切页会把画布 DOM 整个卸载再重建：下面一律重新取 svg，别拿已经不挂在文档里的旧节点
    ok('拖动中切页再切回：不再残留 .dragging（修前会留到最后一次抬手）',
      String(t.host.querySelector('svg.ac-svg').getAttribute('class')).indexOf('dragging') < 0,
      t.host.querySelector('svg.ac-svg').getAttribute('class'))
    eq('拖动中切页再切回：不再残留吸附提示线 .ac-snapline', t.host.querySelectorAll('.ac-snapline').length, 0)
    eq('而且本地模型被回滚到按下时的坐标（没留一个没人认领的中间态）', rectX(t.host, '甲'), x0)
    sets.length = 0
    // 「面板上按下、画布上松开」：切页前那次没完成的位移从前会在这里被当成正常抬手提交
    await act(async () => { fireP(Array.from(t.host.querySelectorAll('.ac-toolbar button, .ac-bar button')).find((b) => b.textContent.trim() === '＋ 节点') || nodeEl(t.host, '乙'), 'pointerdown', { clientX: 5, clientY: 300 }) })
    await flush()
    await act(async () => { fireP(t.host.querySelector('svg.ac-svg'), 'pointerup', { clientX: 5, clientY: 300 }) })
    await flush()
    eq('之后一次「面板按下、画布松开」不再把没完成的位移写进盘（修前 = 1 次 + 假检查点）', sets.length, 0)
    // 负向对照：一次**正常的**拖动照旧提交（别把好路一起堵死）
    sets.length = 0
    await act(async () => { fireP(nodeEl(t.host, '甲'), 'pointerdown', { clientX: 20, clientY: 20 }) })
    await flush()
    await act(async () => { fireP(t.host.querySelector('svg.ac-svg'), 'pointermove', { clientX: 100, clientY: 20 }) })
    await frameZ()
    await act(async () => { fireP(t.host.querySelector('svg.ac-svg'), 'pointerup', { clientX: 100, clientY: 20 }) })
    await flush()
    eq('负向对照：正常的一次拖动仍然提交一次', sets.length, 1)
    // pointercancel 仍然回滚（这条旧契约不许被收口改坏）
    sets.length = 0
    await act(async () => { fireP(nodeEl(t.host, '甲'), 'pointerdown', { clientX: 20, clientY: 20 }) })
    await flush()
    await act(async () => { fireP(t.host.querySelector('svg.ac-svg'), 'pointermove', { clientX: 200, clientY: 20 }) })
    await frameZ()
    await act(async () => { fireP(t.host.querySelector('svg.ac-svg'), 'pointercancel', { clientX: 200, clientY: 20 }) })
    await flush()
    await act(async () => { fireP(t.host.querySelector('svg.ac-svg'), 'lostpointercapture', { clientX: 200, clientY: 20 }) })
    await flush()
    eq('负向对照：pointercancel 仍然回滚、一个字节都不写（cancel 之后那发 lostpointercapture 也不许提交）', sets.length, 0)
    await dropZ(t)
  }

  // ================= E. 图库三条输入框的输入法守卫（P1-5） =================
  {
    const MM = mkModelZ([Z('x1', '甲')])
    const calls = []
    const t = await mountZ({ sessionId: 's-4z-ime' }, (method, args) => {
      if (method === 'doc:get') return fullDoc({ model: MM, nodeCount: 1 })
      if (method === 'doc:list') return LIB_Z
      if (method === 'doc:open') { calls.push(['open', args.key]); return fullDoc({ key: args.key, diagram: args.key, model: MM, nodeCount: 1, revision: 1 }) }
      if (method === 'doc:openPath') { calls.push(['openPath', args.path]); return fullDoc({ model: MM, nodeCount: 1, revision: 1 }) }
      if (method === 'doc:rename') { calls.push(['rename', args.to]); return fullDoc({ model: MM, nodeCount: 1, revision: 1 }) }
      return prevZ(method, args)
    })
    await act(async () => { t.host.querySelector('.ac-tools button[title^="打开项目里的"]').click() })
    await flush()
    // --- 新图名字 ---
    const nameInput = () => t.host.querySelector('.ac-lib-new input')
    await setFieldZ(nameInput(), 'zhongjian')
    calls.length = 0
    await act(async () => { keyDown(nameInput(), 'Enter', true) })
    await flush()
    eq('组字中在「新图名字」框按 Enter 不许真的建图（修前会发 doc:open create:true）', calls.length, 0)
    // --- 按路径打开 ---
    const pathInput = () => t.host.querySelector('.ac-lib-open input')
    await setFieldZ(pathInput(), 'docs/zhongjian')
    calls.length = 0
    await act(async () => { keyDown(pathInput(), 'Enter', true) })
    await flush()
    eq('组字中在「按路径打开」框按 Enter 不许真的打开/建文件', calls.length, 0)
    // --- 改名：Enter 与 Esc 都要过守卫 ---
    const renameRow = () => Array.from(t.host.querySelectorAll('.ac-lib-row'))
      .find((r) => Array.from(r.querySelectorAll('button')).some((b) => b.textContent.trim() === '改名'))
    await act(async () => { Array.from(renameRow().querySelectorAll('button')).find((b) => b.textContent.trim() === '改名').click() })
    await flush()
    const renameInput = () => renameRow() && renameRow().querySelector('input')
    ok('前置：改名输入框出现', !!renameInput())
    await setFieldZ(renameInput(), 'bie_ming')
    calls.length = 0
    await act(async () => { keyDown(renameInput(), 'Enter', true) })
    await flush()
    eq('组字中在改名框按 Enter 不许真的改名（修前会发 doc:rename）', calls.length, 0)
    await act(async () => { keyDown(renameInput(), 'Escape', true) })
    await flush()
    ok('组字中在改名框按 Esc 不许把正在打的名字整行收掉（框还在、字还在）',
      !!renameInput() && renameInput().value === 'bie_ming', renameInput() && renameInput().value)
    // 负向对照 1：普通 Esc 照旧取消改名（守卫不许把正常的 Esc 也吞掉）
    await act(async () => { keyDown(renameInput(), 'Escape', false) })
    await flush()
    eq('负向对照：普通 Esc 仍然取消改名（框收起来）', renameInput(), null)
    // 负向对照 2：普通 Enter 照旧改名（守卫不许把正常的 Enter 也吞掉）
    await act(async () => { Array.from(renameRow().querySelectorAll('button')).find((b) => b.textContent.trim() === '改名').click() })
    await flush()
    await setFieldZ(renameInput(), 'bie_ming')
    calls.length = 0
    await act(async () => { keyDown(renameInput(), 'Enter', false) })
    await flush()
    eq('负向对照：普通 Enter 仍然真的改名', calls.length, 1, calls)
    // 负向对照 3：普通 Enter 在新图名字框里照旧建图
    calls.length = 0
    // 改名成功会 loadLibrary()（它有意清空「新图名字」的草稿），重新填一次
    await setFieldZ(nameInput(), 'zhongjian')
    await act(async () => { keyDown(nameInput(), 'Enter', false) })
    await flush()
    ok('负向对照：普通 Enter 在「新图名字」框里仍然真的建图（守卫没把正常路径一起吞掉）',
      calls.length === 1 && calls[0][0] === 'open', calls)
    await dropZ(t)
  }

  // ================= F. 方向键微调：一次手势一条历史 + 一次写盘（P1-6） =================
  {
    const MM = mkModelZ([Z('x1', '甲')])
    const sets = []
    const t = await mountZ({ sessionId: 's-4z-nudge' }, (method, args) => {
      if (method === 'doc:get') return fullDoc({ model: MM, nodeCount: 1 })
      if (method === 'doc:set') { sets.push(args.model); return fullDoc({ model: args.model, nodeCount: (args.model.nodes || []).length, revision: 9, updatedBy: 'user' }) }
      return prevZ(method, args)
    })
    await act(async () => { clickEl(nodeEl(t.host, '甲')) })
    await flush()
    ok('前置：选中了节点（方向键才有对象）', dockState(t.host).dock)
    const rootEl = t.host.querySelector('.ac-root')
    sets.length = 0
    // 20 次自动重复 ≈ 按住半秒；修前是 20 次 doc:set + 20 条撤销
    for (let i = 0; i < 20; i++) { await act(async () => { keyDown(rootEl, 'ArrowRight') }) }
    await flush()
    eq('按住方向键 20 次：一次盘都没写（修前 = 20 次）', sets.length, 0)
    ok('本地仍然跟手（方块真的往右挪了）', rectX(t.host, '甲') > 0, rectX(t.host, '甲'))
    await act(async () => { keyUp(rootEl, 'ArrowRight') })
    await flush()
    eq('松手（keyup）只落一次 doc:set', sets.length, 1)
    const xAfter = sets[0].nodes.find((n) => n.id === 'x1').x
    eq('落下去的是**累计**后的坐标（不是最后一跳的 1px）', xAfter, 60)
    const undoBtn = () => Array.from(t.host.querySelectorAll('.ac-bar button')).find((b) => b.textContent.trim() === '↶')
    ok('↶ 可用（这一段确实记了一条历史）', !!undoBtn() && !undoBtn().disabled)
    await act(async () => { undoBtn().click() })
    await flush()
    eq('一次撤销就退回这段微调之前（修前要按 20 次才退得回来）',
      sets[sets.length - 1].nodes.find((n) => n.id === 'x1').x, 40)
    await dropZ(t)
  }

  // ================= G. 同一个节点上的第二次 pointerdown（P2-7） =================
  {
    const MM = mkModelZ([Z('m1', '甲'), Z('m2', '乙', { x: 300 })])
    const sets = []
    const t = await mountZ({ sessionId: 's-4z-ptr' }, (method, args) => {
      if (method === 'doc:get') return fullDoc({ model: MM, nodeCount: 2 })
      if (method === 'doc:set') { sets.push(args.model); return fullDoc({ model: args.model, nodeCount: (args.model.nodes || []).length, revision: 9, updatedBy: 'user' }) }
      return prevZ(method, args)
    })
    const svg = t.host.querySelector('svg.ac-svg')
    const x0 = rectX(t.host, '甲')
    await act(async () => { fireP(nodeEl(t.host, '甲'), 'pointerdown', { clientX: 20, clientY: 20 }) })
    await flush()
    await act(async () => { fireP(svg, 'pointermove', { clientX: 120, clientY: 20 }) })
    // **不等帧**，第二根手指 / 第二个指针又按在同一个节点上
    await act(async () => { fireP(nodeEl(t.host, '甲'), 'pointerdown', { clientX: 20, clientY: 20 }) })
    await flush()
    await frameZ()
    ok('第二次 pointerdown 之后，第一次挂在 rAF 里的位移仍然生效（修前被静默丢掉）',
      rectX(t.host, '甲') !== x0, { x0, now: rectX(t.host, '甲') })
    sets.length = 0
    await act(async () => { fireP(svg, 'pointerup', { clientX: 120, clientY: 20 }) })
    await flush()
    eq('抬手提交的是**移动过**的一次拖动（修前 moved=false → 走 toggleDockFor、一次都不提交）', sets.length, 1)
    ok('提交的坐标不是起点', sets[0].nodes.find((n) => n.id === 'm1').x !== 40, sets[0].nodes.find((n) => n.id === 'm1').x)
    await dropZ(t)
  }

  // ================= H. 两个下拉框的枚举不许比宿主窄（P2-8） =================
  {
    const MM = mkModelZ([Z('n1', '甲'), Z('n2', '乙', { x: 300 })],
      [{ id: 'e1', from: 'n1', to: 'n2', label: '', arrow: '--o' }])
    const t = await mountZ({ sessionId: 's-4z-enum' }, (method, args) => {
      if (method === 'doc:get') return fullDoc({ model: MM, nodeCount: 2, edgeCount: 1 })
      if (method === 'doc:set') return fullDoc({ model: args.model, nodeCount: (args.model.nodes || []).length, revision: 9, updatedBy: 'user' })
      return prevZ(method, args)
    })
    await act(async () => { clickEl(t.host.querySelector('.ac-edge-hit'), 0, 0) })
    await flush()
    const asel = t.host.querySelector('.ac-dock select.ac-select')
    ok('前置：连线检查器的样式下拉在', !!asel)
    eq('图里的 --o 原样选中（修前那 4 个选项里没有它 → 显示成空）', asel && asel.value, '--o')
    const aopts = Array.from(asel.querySelectorAll('option')).map((o) => o.value)
    ok('宿主 ARROWS 的 28 种连接符全在选项里',
      ['o---o', 'x---x', 'o---x', 'x---o', '<==>', '<-->', '-.->', 'o--o', 'x--x', 'o--x', 'x--o',
        'o---', 'x---', 'o-->', 'x-->', 'o==o', 'x==x', 'o==>', 'x==>', '==>', '-->', '---', '~~~', '===', '--o', '--x', '==o', '==x']
        .every((k) => aopts.indexOf(k) >= 0), aopts.length)
    await act(async () => { clickEl(nodeEl(t.host, '甲'), 0, 0) })
    await flush()
    const ssel = t.host.querySelector('.ac-dock select.ac-select')
    const sopts = Array.from(ssel.querySelectorAll('option')).map((o) => o.value)
    ok('形状下拉补上了 asym（宿主 SHAPE_WRAP 是 9 种，客户端从前只有 8 种）', sopts.indexOf('asym') >= 0, sopts)
    ok('负向对照：8 种老形状一个都没少', ['rect', 'round', 'stadium', 'circle', 'diamond', 'hex', 'cyl', 'sub'].every((k) => sopts.indexOf(k) >= 0), sopts)
    await dropZ(t)
  }
  {
    // 负向对照：一个**两边表都没有**的怪值也必须被补进选项并选中 —— 打开下拉永远不丢值
    const MM = mkModelZ([Z('n1', '甲'), Z('n2', '乙', { x: 300 })],
      [{ id: 'e1', from: 'n1', to: 'n2', label: '', arrow: 'zzz' }])
    const t = await mountZ({ sessionId: 's-4z-enum2' }, (method, args) => {
      if (method === 'doc:get') return fullDoc({ model: MM, nodeCount: 2, edgeCount: 1 })
      return prevZ(method, args)
    })
    await act(async () => { clickEl(t.host.querySelector('.ac-edge-hit'), 0, 0) })
    await flush()
    const asel = t.host.querySelector('.ac-dock select.ac-select')
    const aopts = Array.from(asel.querySelectorAll('option'))
    eq('负向对照：表里没有的当前值也原样选中（不会显示成空被人随手覆盖）', asel.value, 'zzz')
    ok('而且它在选项里、并标出「当前值」',
      aopts.some((o) => o.value === 'zzz' && o.textContent.indexOf('当前值') >= 0), aopts.map((o) => o.textContent))
    await dropZ(t)
  }

  // ================= I. 输出侧共干：同一源节点同侧的多条出边共用出锚点与分支小圆点 =================
  {
    // 1. 三节点：源节点 a，两个目标 b、c 都在 a 右侧且竖直错开（同为右侧出边）
    const OUT_JUNCTION_MODEL = {
      nodes: [
        { id: "oa", label: "源", shape: "rect", x: 0, y: 100 },
        { id: "ob", label: "目标一", shape: "rect", x: 260, y: 40 },
        { id: "oc", label: "目标二", shape: "rect", x: 260, y: 160 },
      ],
      edges: [
        { id: "oe1", from: "oa", to: "ob", label: "", arrow: "-->" },
        { id: "oe2", from: "oa", to: "oc", label: "", arrow: "-->" },
      ],
      direction: "TD", extras: [],
    }
    const tSame = await mountZ({ sessionId: "s-out-junc" }, (method, args) => {
      if (method === "doc:get") return fullDoc({ model: OUT_JUNCTION_MODEL, nodeCount: 3, edgeCount: 2 })
      return prevZ(method, args)
    })
    const sameEdges = Array.from(tSame.host.querySelectorAll("path.ac-edge"))
    eq("输出侧共干：两条出边都渲染出来了", sameEdges.length, 2)
    const sameStarts = sameEdges.map((p) => {
      const m = p.getAttribute("d").match(/^M\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/)
      return m ? `${m[1]},${m[2]}` : ""
    })
    ok("输出侧共干：两条出边起点坐标完全相同（共干）", sameStarts.length === 2 && sameStarts[0] !== "" && sameStarts[0] === sameStarts[1], sameStarts)
    const juncDots = Array.from(tSame.host.querySelectorAll(".ac-junc-dot"))
    ok("输出侧共干：画布上存在 .ac-junc-dot 共干点标记", juncDots.length > 0, juncDots.length)
    await dropZ(tSame)

    // 2. 反向对照：目标分别在源节点的不同侧（一个在右、一个在下）
    const DIFF_SIDE_MODEL = {
      nodes: [
        { id: "da", label: "源", shape: "rect", x: 0, y: 0 },
        { id: "db", label: "右目标", shape: "rect", x: 260, y: 0 },
        { id: "dc", label: "下目标", shape: "rect", x: 0, y: 260 },
      ],
      edges: [
        { id: "de1", from: "da", to: "db", label: "", arrow: "-->" },
        { id: "de2", from: "da", to: "dc", label: "", arrow: "-->" },
      ],
      direction: "TD", extras: [],
    }
    const tDiff = await mountZ({ sessionId: "s-diff-side" }, (method, args) => {
      if (method === "doc:get") return fullDoc({ model: DIFF_SIDE_MODEL, nodeCount: 3, edgeCount: 2 })
      return prevZ(method, args)
    })
    const diffEdges = Array.from(tDiff.host.querySelectorAll("path.ac-edge"))
    eq("反向对照：不同侧出边均渲染出来了", diffEdges.length, 2)
    const diffStarts = diffEdges.map((p) => {
      const m = p.getAttribute("d").match(/^M\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/)
      return m ? `${m[1]},${m[2]}` : ""
    })
    ok("反向对照：不同侧出边不共干（两条路径起点不同）", diffStarts.length === 2 && diffStarts[0] !== "" && diffStarts[0] !== diffStarts[1], diffStarts)
    await dropZ(tDiff)
  }

  respond = prevZ
}

endPhase()
