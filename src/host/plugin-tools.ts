// ==================== 检查点（快照）的 RPC ====================
// 这是取代「AI 写图开关」的那条安全路径：不拦 AI，但每一步都能退回去。
// 历史**只在内存里**，键是当前文件的路径 —— 所以这两条都先 ensureLoaded，拿到的是「用户正看着的这张」。
ctx.effect(function () {
  return onRpc('doc:history', async function (args) {
    await ensureLoaded(args && args.where, args && args.session)
    return { ok: true, file: doc.file, diagram: doc.name, limit: HISTORY_LIMIT, entries: historyList() }
  })
})

ctx.effect(function () {
  return onRpc('doc:rollback', async function (args) {
    await ensureLoaded(args && args.where, args && args.session)
    // **必须是有限整数。** 从前是 `Number(args.seq)`：`"1"` / `true` / `[2]` 全被强转成合法编号
    // 并能真的把图退回去 —— 一个类型错的入参不该产生一次真实的回滚。
    var rawSeq = args && args.seq
    if (typeof rawSeq !== 'number' || !isFinite(rawSeq) || Math.floor(rawSeq) !== rawSeq || rawSeq <= 0) {
      return { ok: false, error: '需要 seq（检查点编号，见 doc:history）' }
    }
    var seq = rawSeq
    var r = await applyRollback(seq, policyOfSessionId(args && args.session))
    if (!r.ok) return r
    await verifyFileRefs()
    await refreshLibrary()
    var out = fullOf()
    out.rolledBackTo = seq
    return out
  })
})

// ==================== 给 AI 的动态工具 ====================
var OUT_SCHEMA = { type: 'object', additionalProperties: true }

var readTool = harness.defineTool({
  name: 'arch_read',
  description: '读取一张逻辑框架图的 Mermaid 源码。默认读当前与用户共享的这张；给 diagram 可以只读同一个图库里的另一张（不会切换用户看到的图）。注意：当前这张图通常已经自动出现在你的上下文里，只有怀疑它过期、或要看别的图时才需要调用。',
  parameters: {
    type: 'object',
    properties: {
      diagram: { type: 'string', description: '要读的图名；省略则读当前这张' },
    },
  },
  output: {
    schema: OUT_SCHEMA,
    render: function (args, value) {
      try {
        var v = value || {}
        if (v.ok === false) return [{ type: 'text', text: 'arch_read 失败：' + String(v.error || '') }]
        return [{ type: 'text', text: '【' + String(v.diagram || '?') + '】\n' + String(v.mermaid || '(空)') }]
      } catch (e) {
        return [{ type: 'text', text: '(读取失败)' }]
      }
    },
  },
  execute: async function (args, exec) {
    await ensureLoaded(whereOfExec(exec), sessionIdOfExec(exec))
    // `diagram` 出现就必须是非空字符串：`{diagram:42}` 从前静默读了**当前这张**还回 ok:true，
    // 而 `arch_switch {key:42}` 是拒绝的 —— 同一族入参两套口径，AI 会以为它读了别的图。
    if (args && args.diagram !== undefined) {
      if (typeof args.diagram !== 'string' || args.diagram.trim() === '') {
        return { ok: false, error: '需要 diagram（要读的图名，非空字符串；省略则读当前这张）', diagram: doc.name }
      }
    }
    var want = args && typeof args.diagram === 'string' ? args.diagram.trim() : ''
    var wantParts = want ? splitKey(want) : null
    var wantKey = wantParts ? keyOf(wantParts.name, wantParts.project) : ''
    if (want && wantKey !== keyOf(doc.name)) {
      // 只读不切：读盘、解析、序列化后原样返回，一点不碰当前文档 ——
      // 用户正看着 A，AI 不该因为「读了一眼 B」就把画面切走。
      var rk = resolveKey(want)
      if (!rk) return { ok: false, error: '当前没有项目根，无法引用子项目的图', diagram: doc.name }
      var text = ''
      try {
        text = await fs.readText(await fs.resolve(fileAt(rk.dir, rk.name)))
      } catch (e) {
        return { ok: false, error: '读不到「' + want + '」：' + msgOf(e), diagram: doc.name }
      }
      var parsed = parseMermaid(text)
      return {
        ok: true, diagram: rk.name, key: wantKey, dir: rk.dir, scope: rk.scope,
        nodeCount: parsed.nodes.length, edgeCount: parsed.edges.length,
        mermaid: serializeDoc(parsed),
      }
    }
    await verifyFileRefs()
    var out = summaryOf()
    out.mermaid = serializeDoc(doc)
    return out
  },
})
onTool(readTool)

var switchTool = harness.defineTool({
  name: 'arch_switch',
  description: '切换用户正在看的逻辑框架图（同一个图库里的另一张），用户的画布会跟着切过去。要新建一张就带 create: true。这会改变用户眼前的画面，所以除非确实要一起看另一张，否则只用 arch_read 读。',
  parameters: {
    type: 'object',
    properties: {
      key: { type: 'string', description: '图的引用名：根图库写图名，子项目写 `子项目/图名`（不含 .mmd）' },
      create: { type: 'boolean', description: '图不存在时是否新建；默认 false，不存在会报错并列出可选图名' },
    },
    required: ['key'],
  },
  output: {
    schema: OUT_SCHEMA,
    render: function (args, value) {
      try {
        var v = value || {}
        if (!v.ok) return [{ type: 'text', text: 'arch_switch 未生效：' + String(v.error || '') }]
        return [{ type: 'text', text: '已切到「' + v.diagram + '」（' + v.nodeCount + ' 个节点、' + v.edgeCount + ' 条连线）。用户画布已同步。' }]
      } catch (e) {
        return [{ type: 'text', text: 'arch_switch 已完成' }]
      }
    },
  },
  execute: async function (args, exec) {
    var swWhere = whereOfExec(exec)
    await ensureLoaded(swWhere, sessionIdOfExec(exec))
    var raw = args && typeof args.key === 'string' ? args.key
      : (args && typeof args.name === 'string' ? args.name : '')
    if (!raw.trim()) return { ok: false, error: '需要 key' }
    // `create` 出现就必须是布尔：`create:"false"` 是真值，从前会**真的把图建出来**
    // （实测 新图.mmd 存在）—— 模型给字符串布尔是常态，不能把 "false" 当成「要新建」。
    if (args && args.create !== undefined && typeof args.create !== 'boolean') {
      return { ok: false, error: 'create 必须是布尔（true 才新建）' }
    }
    var k = resolveKey(raw)
    if (!k) return { ok: false, error: '当前没有项目根，无法引用子项目的图' }
    if (k.dir !== lib.dir) {
      // 换层要**两步**，少一步都是静默错位：
      //  ① 先把当前这份存进它自己的槽 —— 否则上一层从内存里消失，同步路径（`syncWorkspaceFor`）
      //     再也命中不了它，提示词只能对模型说「画布停在别的图上」，而它其实就在自己项目里；
      //  ② 再换一份**全新的 doc**（`resetToWorkspace` 干的就是这个）—— 只把 `lib` 指过去是不够的：
      //     `loadInto` 是**原地**改 `doc`，而旧那份已经挂在 ① 的槽里，原地改会让那个槽悄悄
      //     变成这一层的文档（2026-10-01 复核实测：回执 `dir` 说 A、`file` 却在 B，还报 saved:true）。
      saveActiveSlot()
      // **会话目录要一起传**：`resetToWorkspace` 的第三参是检测锚点，漏了它这一步的扫描范围
      // 就从会话目录放宽到图库根，紧接着 `afterSwitch()` 的 `refreshLibrary(true)` 会把
      // 图库根整棵扫进来（别的子项目的图库跟着进「同图库」清单）。
      resetToWorkspace(resolveLibCanonical(String((root && root.workspace) || '')), k, cleanSessionDir(swWhere))
    }
    var r = await loadDiagramAt(k, k.name, !!(args && args.create), policyOfAgent(exec && exec.agent))
    if (!r.ok) {
      var items = await refreshLibrary()
      var names = items.filter(function (x) { return !x.deleted }).map(function (x) { return x.key })
      return {
        ok: false,
        error: r.error + '。可用的图有：' + (names.length ? names.join('、') : '(还没有别的图)') + '；要新建请带 create: true',
      }
    }
    // **回执不许说谎**：这一趟的加载如果被别的请求抢走了，`lib`/`doc` 可能是别人的，
    // 直接 `afterSwitch()` 会返回一份「dir 说 A、file 在 B」的混合状态并报成功。
    if (!(lib.dir === k.dir && docInLayer(k.dir))) {
      logEvent('warn', 'doc.open.stolen', { want: k.dir, now: lib.dir })
      return { ok: false, error: '这一趟打开被另一个请求切走了（画布现在在 ' + lib.dir + '）—— 重试一次' }
    }
    // 同上：记请求的这一层，不记可能被抢走的全局 lib
    rememberLayer(sessionIdOfExec(exec), k, root && root.workspace)
    return afterSwitch()
  },
})
onTool(switchTool)

var writeTool = harness.defineTool({
  name: 'arch_write',
  description: '用一份完整的 Mermaid flowchart 源码整体替换当前这张逻辑框架图。适合画初稿或结构性重画。只改局部时请改用 `arch_edit`：arch_write 会丢掉未被重新声明节点的画布坐标，用户手动摆好的布局会散掉。',
  parameters: {
    type: 'object',
    properties: {
      mermaid: { type: 'string', description: '完整的 Mermaid flowchart 源码。用 flowchart TD 或 flowchart LR 开头，例如：flowchart TD\\n  a["入口"] --> b["核心"]。可以在头部写一行 `%% @summary <一句话>` 说明这张图讲的是什么；不写就沿用原来那句。' },
      note: { type: 'string', description: '给用户看的一句话说明，会显示在画布状态栏' },
    },
    required: ['mermaid'],
  },
  output: {
    schema: OUT_SCHEMA,
    render: function (args, value) {
      try {
        var v = value || {}
        if (!v.ok) return [{ type: 'text', text: 'arch_write 未生效: ' + String(v.error || v.problems || '') }]
        var kept = v.keptNotes ? '（保留了用户在该图元素上的 ' + v.keptNotes + ' 条留言）' : ''
        return [{ type: 'text', text: '已更新「' + String(v.diagram || '') + '」（修订 ' + v.revision + '）：' + v.nodeCount + ' 个节点、' + v.edgeCount + ' 条连线。用户现在看到的图形已同步。' + kept }]
      } catch (e) {
        return [{ type: 'text', text: 'arch_write 已完成' }]
      }
    },
  },
  execute: async function (args, exec) {
    var t0 = Date.now()
    await ensureLoaded(whereOfExec(exec), sessionIdOfExec(exec))
    if (doc.absent && !doc.external) {
      logEvent('warn', 'doc.absent', { tool: 'arch_write', dir: lib.dir })
      return { ok: false, error: '这个项目还没有图库（' + lib.dir + ' 还不存在）。图库不会自动创建——要建先征得用户同意，再用 arch_switch { create: true } 建一张。' }
    }
    var text = args && typeof args.mermaid === 'string' ? args.mermaid : ''
    if (!text.trim()) return toolReject('arch_write', 'mermaid 不能为空', t0)
    var parsed = inheritPositions(parseMermaid(text))
    // 用户留的东西（注释 + 代码锚点）是**用户**的：AI 整体重画时继承下来，别让它悄悄抹掉。
    // doc:applyText（用户自己改源码）刻意不走这条 —— 那边删掉一行就是真的要删（见 inheritUserMarks）。
    var keptNotes = inheritUserMarks(parsed)
    if (parsed.nodes.length === 0) {
      return toolReject('arch_write', '解析不出任何节点（首行应是 flowchart TD 或 graph LR）', t0)
    }
    var before = snapshotNodes()
    var saved = snapshotModel()
    var expectFile = doc.file
    adopt(parsed)
    adoptModel(modelOf())
    bump('ai')
    noteAiChange(before)
    if (args && typeof args.note === 'string' && args.note) doc.notes = [args.note]
    var policy = policyOfAgent(exec && exec.agent)
    var saveError = await persistOrRollback(saved, 'arch_write', policy, expectFile)
    var out = summaryOf()
    out.mermaid = serializeDoc(doc)
    out.keptNotes = keptNotes
    // 写盘失败时内存已经回滚了 —— 那就**不能说「已更新」**：回执必须让 AI 知道自己白改了。
    // （历史里也不会多一份检查点：那一版从来没落到盘上，见 history.ts。）
    out.saved = !saveError
    if (saveError) { out.ok = false; out.error = '保存失败，本次改动已回滚：' + saveError }
    logEvent(saveError ? 'error' : 'info', 'tool.arch_write', {
      diagram: doc.name, key: keyOf(doc.name), file: doc.file,
      nodes: doc.nodes.length, edges: doc.edges.length, revision: doc.revision,
      keptNotes: keptNotes,
      saved: !saveError, rollback: !!saveError, warnings: (parsed.warnings || []).slice(0, 5), ms: Date.now() - t0,
    })
    return out
  },
})
onTool(writeTool)

var editTool = harness.defineTool({
  name: 'arch_edit',
  description: '对当前这张逻辑框架图做增量修改（推荐方式）。一次传多个 op，按顺序执行，只影响你指定的部分，用户已经拖好的节点位置完全不受影响。若 op 里出现尚未存在的节点 id，会返回 problems 告诉你原因。',
  parameters: {
    type: 'object',
    properties: {
      ops: {
        type: 'array',
        description: '要执行的操作列表，按顺序应用',
        items: {
          type: 'object',
          additionalProperties: true,
          properties: {
            op: {
              type: 'string',
              enum: ['add_node', 'set_label', 'set_shape', 'set_link', 'move_node', 'remove_node', 'add_edge', 'remove_edge', 'set_edge_label', 'add_group', 'set_group', 'remove_group', 'set_direction', 'set_files', 'set_summary', 'mark_note', 'consolidate_edges'],
              description: '操作类型。consolidate_edges 为合并全图同向平行边',
            },
            id: { type: 'string', description: '节点 id（add_node/set_label/set_shape/set_link/move_node/remove_node/set_group/mark_note 用）' },
            done: { type: 'boolean', description: 'mark_note 用：省略或 true = 把该节点的留言标成已办；false = 重新打开。已办的留言不再进入你的上下文' },
            label: { type: 'string', description: '节点或连线的显示文本；add_group 时作为分组标题；set_summary 时是这张图的一句话总结（传空串清掉）。**换行直接给真实换行符**（JSON 里就是 `\\n`），写 `<br/>` 也等价；`<br>` / `<\\br>` / `</br>` 这类写法会被自动归一，不用自己手写转义。' },
            shape: { type: 'string', description: '节点形状：rect 矩形 / round 圆角 / stadium 胶囊 / circle 圆 / diamond 判定 / cyl 数据库 / hex 六边形 / sub 子流程 / asym 旗形' },
            link: { type: 'string', description: 'set_link / add_node 用：把这个节点下钻到另一张图（图名，不含 .mmd）；传空串取消' },
            from: { type: 'string', description: '连线的起点节点 id' },
            to: { type: 'string', description: '连线的终点节点 id' },
            merge: { type: 'boolean', description: 'add_edge 用：若同向连线已存在，是否将其合并追加到既有边（避免平行边泛滥，默认 false）' },
            group: { type: 'string', description: '分组 id；set_group 时传空串表示移出分组' },
            arrow: { type: 'string', description: '连线样式：--> 实线箭头 / --- 无箭头 / -.-> 虚线 / ==> 粗线' },
            x: { type: 'number', description: '画布横坐标（move_node / add_node 用）' },
            y: { type: 'number', description: '画布纵坐标（move_node / add_node 用）' },
            value: { type: 'string', description: 'set_direction 时用：TD / BT / LR / RL' },
            files: {
              type: 'array',
              items: { type: 'string' },
              description: 'set_files 用：这个节点对应的源码文件（项目相对路径，可带 `#符号` 指到具体函数/类）。整组替换；传空数组表示清掉',
            },
          },
          required: ['op'],
        },
      },
      note: { type: 'string', description: '给用户看的一句话说明' },
    },
    required: ['ops'],
  },
  output: {
    schema: OUT_SCHEMA,
    render: function (args, value) {
      try {
        var v = value || {}
        var lines = ['已应用 ' + v.appliedCount + ' 个操作，当前「' + String(v.diagram || '') + '」有 ' + v.nodeCount + ' 个节点、' + v.edgeCount + ' 条连线（修订 ' + v.revision + '）。']
        if (v.done && v.done.length) lines.push('完成：' + v.done.join('；'))
        if (v.problems && v.problems.length) lines.push('未生效：' + v.problems.join('；'))
        if (v.appliedCount > 0) lines.push('（改动过的节点已在用户画布上高亮）')
        return [{ type: 'text', text: lines.join('\n') }]
      } catch (e) {
        return [{ type: 'text', text: 'arch_edit 已完成' }]
      }
    },
  },
  execute: async function (args, exec) {
    var t0 = Date.now()
    await ensureLoaded(whereOfExec(exec), sessionIdOfExec(exec))
    if (doc.absent && !doc.external) {
      logEvent('warn', 'doc.absent', { tool: 'arch_edit', dir: lib.dir })
      return { ok: false, error: '这个项目还没有图库（' + lib.dir + ' 还不存在）。图库不会自动创建——要建先征得用户同意，再用 arch_switch { create: true } 建一张。' }
    }
    var ops = args && Array.isArray(args.ops) ? args.ops : []
    if (ops.length === 0) return toolReject('arch_edit', 'ops 不能为空', t0)
    var expectFile = doc.file
    var before = snapshotNodes()
    var saved = snapshotModel()
    var result = applyOps(ops)
    // **一个 op 都没生效时不写盘、不推修订号**（上面那轮已经修对），但 `doc.notes` 从前照设 ——
    // 面板状态栏于是显示「AI 说：…」，而盘上什么都没变：AI 的说明与事实相反。
    // 所以它必须跟「至少一个 op 生效」绑在一起。
    var saveError = null
    if (result.done.length > 0) {
      if (args && typeof args.note === 'string' && args.note) doc.notes = [args.note]
      bump('ai')
      noteAiChange(before)
      var policy = policyOfAgent(exec && exec.agent)
      saveError = await persistOrRollback(saved, 'arch_edit', policy, expectFile)
    } else {
      // 一个 op 都没生效：不写盘、不推修订号，但**要把上一次的高亮清掉** ——
      // 留着 lastChange.nodes 会让界面继续脉动「AI 刚改了这几个节点」，而这一轮 AI 什么都没改成。
      lastChange = { by: 'ai', rev: doc.revision, nodes: [] }
    }
    // 改完锚点要立刻重算校验状态：`summaryOf()` 会把 doc.fileStatus 一起带回去，
    // 少了这一行，AI 下一步读到的还是**旧锚点字符串**对应的那份缓存 ——
    // 新锚点在缓存里没有条目，于是全部显示「未能校验」，而界面走 doc:get 重算后是 ok。
    // 同一个锚点在人和 AI 两边显示成两种状态，是最难查的那种不一致。
    await verifyFileRefs()
    var out = summaryOf()
    out.mermaid = serializeDoc(doc)
    out.appliedCount = result.done.length
    out.done = result.done
    out.problems = result.problems
    // 同上：落盘失败 ⇒ ok:false，并把原因塞进 problems（AI 先看 problems 再汇报）。
    out.saved = !saveError
    if (saveError) {
      out.ok = false
      out.error = '保存失败，本次改动已回滚：' + saveError
      out.problems = result.problems.concat(['保存失败，本次改动已回滚：' + saveError])
    }
    // AI 每次改图留一行：改的是哪张图、几个 op 没生效、有没有回滚 —— 图不对时先看这里。
    logEvent(saveError || result.problems.length ? 'warn' : 'info', 'tool.arch_edit', {
      diagram: doc.name, key: keyOf(doc.name), file: doc.file,
      ops: ops.length, applied: result.done.length, problems: result.problems.slice(0, 5),
      revision: doc.revision, saved: !saveError, rollback: !!saveError, ms: Date.now() - t0,
    })
    return out
  },
})
onTool(editTool)

// ==================== 每步注入给模型的上下文 ====================
if (systemPromptSvc) {
  try {
    ctx.effect(function () {
      return systemPromptSvc.context({ name: 'arch-canvas', order: 137, text: promptText })
    })
  } catch (e) {
    doc.warnings.push('注册提示词上下文失败: ' + msgOf(e))
    logEvent('error', 'prompt.fail', { error: msgOf(e) })
  }
}

// ==================== 随包 skill：注册给 skills 服务 ====================
// 「工具怎么用、图库怎么组织、`%%` 各字段什么意思」是 skill 的职责（`skills/arch-canvas/SKILL.md`）。
// 从前它只随包分发、**没有任何东西把它注册进去**，而 promptText 每一步都在告诉模型「见 arch-canvas
// skill（用 skill 工具加载）」—— 指向一个加载不到的名字。做法照 dsh-collab：
//   · 正文由外层经 `hostEnv.skillText` 递进来（真插件读 `<pkg>/skills/…`，动态形态走 fs 服务）；
//     解析与注册收口在这里，所以两个形态只有一份实现；
//   · `skills` 是**可选**服务：走 `ctx.get`（不进 inject），没有它（headless / 测试桩 / 没装
//     skill 插件）就静默跳过 —— 附加能力绝不阻断工具与路由；
//   · 注册挂在 `ctx.effect` 上，卸载即撤销；文件缺失 / frontmatter 不合法一律静默跳过。
var SKILL_FILE = (typeof hostEnv === 'object' && hostEnv && typeof hostEnv.skillFile === 'string') ? hostEnv.skillFile : ''
var SKILL_TEXT = (typeof hostEnv === 'object' && hostEnv && typeof hostEnv.skillText === 'string') ? hostEnv.skillText : ''

/**
 * 极简 frontmatter 解析：只认文件开头的 `---` 块，只取 `name` / `description` / `whenToUse`
 * 三个标量，其余行（含注释）忽略；正文是闭合 `---` 之后的全部原文，一字不改。
 * 与 dsh-collab 的 `src/skill.ts` 同构 —— 两边 `skills/` 的落点与形状本来就一致。
 * 缺 frontmatter、或缺 `name` ⇒ null，调用方静默降级。
 */
function parseSkillFrontmatter(text) {
  var m = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(String(text == null ? '' : text))
  if (!m) return null
  var meta: any = {}
  var lines = m[1].split(/\r?\n/)
  for (var i = 0; i < lines.length; i++) {
    var kv = /^([A-Za-z][A-Za-z0-9_-]*)[ \t]*:[ \t]*(.*)$/.exec(lines[i])
    if (!kv) continue
    var v = kv[2].trim()
    var q0 = v.charAt(0)
    if (v.length >= 2 && (q0 === '"' || q0 === "'") && v.charAt(v.length - 1) === q0) v = v.slice(1, -1)
    meta[kv[1]] = v
  }
  var name = String(meta.name || '').trim()
  if (!name) return null
  return {
    name: name,
    description: String(meta.description || '').trim(),
    whenToUse: String(meta.whenToUse || '').trim(),
    content: String(text).slice(m[0].length),
  }
}

if (SKILL_TEXT) {
  var parsedSkill = parseSkillFrontmatter(SKILL_TEXT)
  var skillsSvc = parsedSkill ? ctx.get('skills') : null
  if (parsedSkill && skillsSvc && typeof skillsSvc.register === 'function') {
    try {
      ctx.effect(function () {
        var def: any = {
          name: parsedSkill.name,
          // 空 description 会让 skills 服务直接抛错，兜回名字
          description: parsedSkill.description || parsedSkill.name,
          content: parsedSkill.content,
          source: 'bundled',
          provider: 'arch-canvas',
          path: SKILL_FILE,
          resourceBase: { kind: 'directory', path: String(SKILL_FILE).replace(/\/[^/]+$/, '') },
          invocation: { modelInvocable: true, userInvocable: true },
        }
        if (parsedSkill.whenToUse) def.whenToUse = parsedSkill.whenToUse
        return skillsSvc.register(def)
      })
      logEvent('info', 'skill.register', { name: parsedSkill.name, bytes: parsedSkill.content.length, file: SKILL_FILE })
    } catch (e) {
      // 注册失败只记一行：工具与路由照常可用，附加能力不该把插件带下去
      logEvent('warn', 'skill.register.fail', { error: msgOf(e) })
    }
  }
}

// 挂载现场：这个插件对 console 一字不吐，「挂上了没」以前只能靠人去数注册结果，
// 现在落一行到日志文件里，顺带留下日志目录与形态。
//
// **同进程内同内容只落一行**（0.9.x，治噪音）：hmr 每次构建都会把这份模块重新求值一遍，
// 实测同一次事件里 26 毫秒内连发 4 行、单日 46 行、**逐字节相同**（只有 t 不同）。那种重复
// 对「挂上了没」这个问题没有任何新信息，只会把日志撑成噪音。
// 判据用 `globalThis` 上的一个标记，而**不是**模块级变量：模块被清缓存重载后模块级变量会归零，
// 那正是 4 连发的成因之一。挂载形状（工具/路由/图库/形态）一变，判据就变，于是照旧落一行。
var MOUNT_MARK_KEY = '__archCanvasMountMark'
// **路由数必须反映真实注册数。** RPC 路由（`/arch-canvas/rpc`）是外壳直接推给 webServer 的，
// 不经过宿主逻辑的 `onRoute` —— 只数 `registeredRoutes` 会恒为 2，而实际注册了 3 条：
// AGENTS 把「4 工具 / 3 路由 / 1 提示词上下文」当挂载自检判据，唯一的机器可读记录却永远对不上。
// 外壳实现了 `describeRoutes` 就把它报的也算进来（动态形态没这条路由，自然还是 2）。
var mountRoutePaths = registeredRoutes.slice()
try {
  if (harness && typeof (harness as any).describeRoutes === 'function') {
    var extraRoutes = (harness as any).describeRoutes() || []
    for (var mr = 0; mr < extraRoutes.length; mr++) {
      if (mountRoutePaths.indexOf(extraRoutes[mr]) < 0) mountRoutePaths.push(extraRoutes[mr])
    }
  }
} catch (eMountRoutes) { /* 外壳没提供就退回 registeredRoutes，不影响挂载 */ }
var mountShape = registeredTools.join(',') + '|' + mountRoutePaths.join(',') + '|' + lib.dir + '|' + lib.scope
var mountMark = null
try { mountMark = (globalThis as any)[MOUNT_MARK_KEY] || null } catch (e) { mountMark = null }
if (!mountMark || mountMark.shape !== mountShape) {
  logEvent('info', 'plugin.mount', {
    tools: registeredTools.join(','), toolCount: registeredTools.length,
    routes: mountRoutePaths.join(','), routeCount: mountRoutePaths.length,
    dir: lib.dir, scope: lib.scope, logDir: logDir(), logBackend: logBackend ? 'file' : 'none',
    mounts: (mountMark && mountMark.shape === mountShape && mountMark.n ? mountMark.n : 0) + 1,
  })
  try { (globalThis as any)[MOUNT_MARK_KEY] = { shape: mountShape, n: 1 } } catch (e) { /* 标记写不进去只是少一条去重，不影响挂载 */ }
} else {
  mountMark.n = (mountMark.n || 1) + 1
}

// ==================== 自动扫描：周期重扫图库 ====================
// 面板开着时是 doc:rev 的轮询在驱动重扫；面板关掉后没人驱动了，所以再挂一个慢速定时器 ——
// 别人（git pull、手写、另一个会话）新加的图与散落文件照样会被发现，AI 的上下文也跟着新鲜。
// timer 是可选服务：缺席时插件照常工作，自动扫描退化成「界面在轮询时才扫」。
ctx.inject(['timer'], function (timerCtx) {
  timerCtx.effect(function () {
    return timerCtx.interval(function () {
      // 强制扫：TTL 是给「2.5s 一次的高频轮询」节流的；这个慢速定时器是「没人看的时候」的
      // 兜底扫描器，被 TTL 挡住就等于自动扫描失效。
      refreshLibrary(true).catch(function (e) {
        logEvent('error', 'library.scan.fail', { error: msgOf(e) })
      })
    }, SCAN_INTERVAL_MS)
  })
})

void ensureLoaded()
