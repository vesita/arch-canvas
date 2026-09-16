// 对外接口面：给 AI 的提示词上下文、mermaid 静态路由、Client↔Host RPC、四个 AI 工具。
// 这一节末尾 return 出 Cordis 插件对象 —— 构建脚本会在最外层再套 return/apply。
// ==================== 注册与现场记录 ====================
// 注册口统一包一层：一是顺手把现场写进日志文件（这个插件对 console 一字不吐），
// 二是让「到底注册上了几个」有据可查 —— 不用再靠人去数。
var registeredTools: string[] = []
var registeredRoutes: string[] = []

/** 注册一条私有 RPC。handler 抛错先留一行现场，再把错抛给外层。 */
function onRpc(name, fn) {
  return harness.handle(name, async function (args) {
    var t0 = Date.now()
    try {
      return await fn(args)
    } catch (e) {
      logEvent('error', 'rpc.fail', { method: name, error: msgOf(e), ms: Date.now() - t0 })
      throw e
    }
  })
}

function onRoute(path, handler) {
  registeredRoutes.push(path)
  harness.route(path, handler)
}

function onTool(def) {
  registeredTools.push(def && def.name)
  harness.registerTool(ctx, def)
}

/** 工具入参不合格时的统一回执。日志里留一行 —— 「它说改了、图上却没变」先查这里。 */
function toolReject(tool, reason, t0) {
  logEvent('warn', 'tool.reject', { tool: tool, reason: reason, ms: Date.now() - t0 })
  return { ok: false, error: reason }
}

// ==================== AI 侧提示词上下文 ====================
function promptText() {
  var curKey = doc.external || keyOf(doc.name)
  var where = doc.external ? '项目里的文件 ' : (lib.scope === 'project' ? '项目图库 ' : '全局图库 ')
  var loc = doc.external ? doc.external : lib.dir
  var head = [
    '## 逻辑框架画布（arch-canvas）',
    '你和用户在看同一张图。当前这张的引用名是「' + curKey + '」，在' + where + loc + '（修订 ' + doc.revision + '，最后修改者：' + doc.updatedBy + '）。',
    '- 这张图表达的是**讨论中的逻辑框架**，不保证与代码一致 —— 不要拿代码去「纠正」它，也不要因为图上没有某个模块就断定它漏了。它是讨论的画布，不是代码的镜像。',
    doc.external
      ? '- 这张图不是图库里的图，而是项目里的一个 mermaid 文件（' + doc.external + '）：用户是按路径把它打开的，你的改动落盘就写回这个文件。'
      : '- 图库跟着项目走：每个项目目录下有一个 .arch-canvas/，里面每张图一个 .mmd 文件。同一个图库可以有多张图。',
    '- 图引用一律用「相对项目根的 key」：`架构` 指根图库里的图，`支付/对账` 指子项目「支付」的图库里的图。`arch_switch` / `arch_read` / `set_link` 都用这个写法。',
    '- 用户的手动改动会立即反映到下一步的你。回答图相关内容时以下面这份为准，不要凭记忆。',
    '- 改图优先用 `arch_edit` 做增量修改（add_node / add_edge / set_label / set_link / move_node / remove_node / add_group ...），这样用户已摆好的布局不会被清掉；只有整体重画时才用 `arch_write`。',
    '- `%%` 开头的行是元数据：`@pos` 是画布坐标，`@link` 是「这个节点下钻到另一张图」。请原样保留，也不要把它们当成图的内容来讨论。',
    '- 你改动过的节点会在用户画布上短暂高亮 —— 用户能直接看到你动了哪里，所以说明里点名节点 id 会很有用。',
  ]
  var others = []
  for (var i = 0; i < libraryCache.length; i++) {
    var it = libraryCache[i]
    if (it.deleted || it.key === curKey) continue
    others.push('「' + it.key + '」(' + it.nodes + ' 节点' + (it.links ? '、' + it.links + ' 处下钻' : '') + ')')
  }
  if (others.length > 0) {
    head.push('- 同一图库里还有：' + others.join('、') + '。要一起看另一张就用 `arch_switch`（用户画布会跟着切），只读不改则用 `arch_read` 带 `diagram`。')
  } else {
    head.push('- 这个图库里目前只有这一张图。想另起一张（换个视角/换个层次）可以用 `arch_switch` 带 `create` 新建。')
  }
  head.push('- 只读当前图时用 `arch_read`。')
  if (doc.nodes.length === 0) {
    head.push('', '画布目前是空的。可以用 `arch_write` 画一版初稿，或用 `arch_edit` 逐块搭建。')
    return head.join('\n')
  }
  var src = serializeDoc(doc).replace(/\n+$/, '')
  return head.concat(['', '```mermaid', src, '```']).join('\n')
}

// ==================== 静态资源路由 ====================
// 只是「把包里的文件发给浏览器」。register 由外层在 webServer 就绪后做。
var mermaidSource = null
var mermaidAssetUrl = null

// mermaid 优先包内 assets/（随包分发，装机即有），退回早期手工下载的缓存。
// 两个路径都由外层递进来（真插件按 __dirname，动态形态按项目目录），这里不留本机路径。
var MERMAID_PKG_FILE = (typeof hostEnv === 'object' && hostEnv && typeof hostEnv.mermaidFile === 'string' && hostEnv.mermaidFile)
  ? hostEnv.mermaidFile
  : ''
var mermaidCandidates = [MERMAID_PKG_FILE, MERMAID_CACHE].filter(function (p) { return !!p })

async function readFirstFile(paths) {
  for (var i = 0; i < paths.length; i++) {
    try {
      var t = await fs.resolve(paths[i])
      var info = await fs.stat(t)
      if (!info) continue
      var text = await fs.readText(t)
      if (text) return text
    } catch (e) { /* 换下一个候选 */ }
  }
  return ''
}

// 界面脚本每次请求现读现发，所以构建完刷新页面即可。路径由外层递：真插件是 <包>/lib/ui.js，
// 动态形态是 <项目>/dist/ui.js —— 宿主逻辑不猜自己装在哪儿。
var UI_FILE = (typeof hostEnv === 'object' && hostEnv && typeof hostEnv.uiFile === 'string' && hostEnv.uiFile)
  ? hostEnv.uiFile
  : ''
var uiAssetUrl = null

if (fs) {
  onRoute('/arch-canvas/mermaid.min.js', async function (req, res) {
    if (mermaidSource === null) mermaidSource = await readFirstFile(mermaidCandidates)
    if (!mermaidSource) {
      res.statusCode = 404
      res.end('mermaid bundle not found: ' + mermaidCandidates.join(' | '))
      return
    }
    res.setHeader('content-type', 'text/javascript; charset=utf-8')
    res.setHeader('cache-control', 'public, max-age=86400')
    res.end(mermaidSource)
  })
  mermaidAssetUrl = '/arch-canvas/mermaid.min.js'

  onRoute('/arch-canvas/ui.js', async function (req, res) {
    var body = ''
    try {
      var t = await fs.resolve(UI_FILE)
      var info = await fs.stat(t)
      body = info ? await fs.readText(t) : ''
    } catch (e) { body = '' }
    if (!body) {
      res.statusCode = 404
      res.end('界面脚本不存在：' + (UI_FILE || '(hostEnv.uiFile 没给)') + '（在项目里跑 npm run build）')
      return
    }
    res.setHeader('content-type', 'text/javascript; charset=utf-8')
    res.setHeader('cache-control', 'no-store, no-cache, must-revalidate')
    res.end(body)
  })
  uiAssetUrl = '/arch-canvas/ui.js'
}

function summaryOf(): Record<string, any> {
  return {
    ok: true,
    revision: doc.revision,
    updatedBy: doc.updatedBy,
    updatedAt: doc.updatedAt,
    file: doc.file,
    diagram: doc.name,
    // 外部文件的「引用名」就是它的路径：图库那套 key 对它不成立
    key: doc.external ? doc.external : keyOf(doc.name),
    external: doc.external || null,
    project: projectRel(),
    dir: lib.dir,
    scope: lib.scope,
    workspace: lib.workspace,
    tombstoned: doc.tombstoned,
    nodeCount: doc.nodes.length,
    edgeCount: doc.edges.length,
    groupCount: doc.groups.length,
    libraryRev: libraryRev,
    warnings: doc.warnings.slice(),
    notes: doc.notes.slice(),
    lastChange: lastChange,
  }
}

function fullOf() {
  var out = summaryOf()
  out.model = modelOf()
  out.mermaid = serializeDoc(doc)
  return out
}

// 载入完成后的统一收尾：标记来源、bump、刷新清单缓存。
// 界面靠「修订号变了 + lastChange.by === 'switch'」发现图库或图换了，并重新适应视图。
async function afterSwitch() {
  loadedFor = lib.dir
  bump('switch')
  lastChange = { by: 'switch', rev: doc.revision, nodes: [] }
  await refreshLibrary()
  logEvent('info', 'doc.switch', {
    diagram: doc.name, key: keyOf(doc.name), dir: lib.dir, scope: lib.scope,
    nodes: doc.nodes.length, edges: doc.edges.length,
  })
  return fullOf()
}

ctx.effect(function () {
  return onRpc('doc:get', async function (args) {
    await ensureLoaded(args && args.where)
    var out = summaryOf()
    out.model = modelOf()
    out.mermaid = serializeDoc(doc)
    doc.notes = []
    return out
  })
})

ctx.effect(function () {
  return onRpc('doc:rev', async function () {
    // 顺手按 TTL 重扫一次图库（只走目录 + 比指纹，很便宜）：别人新加的图要能自己冒出来。
    // 界面轮询这个 RPC，所以「自动扫描」在面板开着时就有人驱动；面板关着时由定时器兜住。
    await refreshLibrary()
    return {
      revision: doc.revision, updatedBy: doc.updatedBy, diagram: doc.name, dir: lib.dir,
      libraryRev: libraryRev, external: doc.external || null,
    }
  })
})

ctx.effect(function () {
  return onRpc('doc:set', async function (args) {
    await ensureLoaded(args && args.where)
    var model = args && args.model
    if (!model || typeof model !== 'object') return { ok: false, error: '需要 model' }
    var saved = snapshotModel()
    adoptModel(model)
    if (args && typeof args.note === 'string' && args.note) doc.notes = [args.note]
    bump('user')
    noteUserChange()
    var saveError = await persistOrRollback(saved, 'doc:set')
    var out = summaryOf()
    out.mermaid = serializeDoc(doc)
    out.model = modelOf()
    out.saved = !saveError
    return out
  })
})

ctx.effect(function () {
  return onRpc('doc:applyText', async function (args) {
    await ensureLoaded(args && args.where)
    var text = args && typeof args.text === 'string' ? args.text : ''
    var parsed = inheritPositions(parseMermaid(text))
    if (parsed.nodes.length === 0 && text.trim() !== '') {
      return { ok: false, error: '没能从这段文本里解析出任何节点', mermaid: serializeDoc(doc) }
    }
    var saved = snapshotModel()
    adopt(parsed)
    adoptModel(modelOf())
    bump('user')
    noteUserChange()
    var saveError = await persistOrRollback(saved, 'doc:applyText')
    var out = summaryOf()
    out.mermaid = serializeDoc(doc)
    out.model = modelOf()
    out.saved = !saveError
    return out
  })
})

ctx.effect(function () {
  return onRpc('mermaid:info', async function () {
    return { url: mermaidAssetUrl }
  })
})

ctx.effect(function () {
  return onRpc('ui:info', async function () {
    return { url: uiAssetUrl, file: UI_FILE }
  })
})

ctx.effect(function () {
  return onRpc('doc:file', async function (args) {
    await ensureLoaded(args && args.where)
    if (args && args.save) {
      var err = await persist()
      var out = summaryOf()
      out.saved = !err
      if (err) out.error = err
      return out
    }
    return summaryOf()
  })
})

// ---- 图库管理：清单 / 打开 / 新建 / 改名 / 软删除 / 恢复 / 按路径打开外部文件 ----
ctx.effect(function () {
  return onRpc('doc:list', async function (args) {
    await ensureLoaded(args && args.where)
    // rescan 为真时忽略 TTL 立刻重扫（选择器上的「重新扫描」按钮走这条路）
    var items = await refreshLibrary(!!(args && args.rescan))
    return {
      ok: true, dir: lib.dir, scope: lib.scope, workspace: lib.workspace,
      current: doc.name, external: doc.external || null,
      items: items,
      // 项目里散落的 mermaid 文件（同一次扫描的副产物）：按路径打开
      files: libraryFiles,
      libraryRev: libraryRev,
    }
  })
})

ctx.effect(function () {
  return onRpc('doc:openPath', async function (args) {
    await ensureLoaded(args && args.where)
    var path = resolveDiagramPath(args && args.path)
    if (!path) return { ok: false, error: '需要一个文件路径：绝对路径，或相对项目根的路径' }
    return openExternal(path, !!(args && args.create))
  })
})

ctx.effect(function () {
  return onRpc('doc:open', async function (args) {
    await ensureLoaded(args && args.where)
    var raw = args && typeof args.key === 'string' ? args.key
      : (args && typeof args.name === 'string' ? args.name : '')
    if (!raw.trim()) return { ok: false, error: '需要 key（图名，或 `子项目/图名`）' }
    var k = resolveKey(raw)
    if (!k) return { ok: false, error: '当前没有项目根，无法引用子项目的图' }
    // 打开子项目的图 = 把「当前层」切过去：此后坐标、落盘、AI 上下文都落在那一层
    if (k.dir !== lib.dir) {
      lib = { dir: k.dir, scope: k.scope, workspace: k.workspace }
      loadedFor = null
    }
    var r = await loadDiagramAt(k, k.name, !!(args && args.create))
    if (!r.ok) {
      await refreshLibrary()
      return { ok: false, error: r.error, items: libraryCache, dir: lib.dir }
    }
    return afterSwitch()
  })
})

ctx.effect(function () {
  return onRpc('doc:rename', async function (args) {
    await ensureLoaded(args && args.where)
    if (!fs) return { ok: false, error: 'fs 服务不可用' }
    var a = resolveKey(args && args.from)
    var b = resolveKey(args && args.to)
    if (!a || !b) return { ok: false, error: '需要 from 与 to（图名，或 `子项目/图名`）' }
    if (a.project !== b.project) {
      return { ok: false, error: '改名不能跨图库（' + (a.project || '根') + ' → ' + (b.project || '根') + '）；跨库请手工移动文件' }
    }
    if (a.name === b.name) return { ok: false, error: '新名字和旧名字一样' }
    // 目标已存在就不动 —— 改名不该悄悄吞掉另一张图
    try {
      var probe = await fs.resolve(fileAt(b.dir, b.name))
      if (await fs.stat(probe)) return { ok: false, error: '已经有叫「' + args.to + '」的图了' }
    } catch (e) {}
    var text
    try {
      text = await fs.readText(await fs.resolve(fileAt(a.dir, a.name)))
    } catch (e) {
      return { ok: false, error: '读不到「' + args.from + '」：' + msgOf(e) }
    }
    try {
      await fs.writeText(await fs.resolve(fileAt(b.dir, b.name)), text)
      // 旧文件只能软删（fs 没有 unlink），于是「改名」= 新建 + 把旧的标成已删除
      await fs.writeText(await fs.resolve(fileAt(a.dir, a.name)), TOMBSTONE + '\n' + text)
    } catch (e) {
      return { ok: false, error: '改名失败：' + msgOf(e) }
    }
    if (doc.name === a.name && lib.dir === a.dir) {
      doc.name = b.name
      doc.file = fileAt(b.dir, b.name)
      doc.tombstoned = hasTombstone(text)
    }
    await refreshLibrary()
    return fullOf()
  })
})

ctx.effect(function () {
  return onRpc('doc:delete', async function (args) {
    await ensureLoaded(args && args.where)
    if (!fs) return { ok: false, error: 'fs 服务不可用' }
    var dk = resolveKey(args && (args.key || args.name))
    if (!dk) return { ok: false, error: '需要 key（图名，或 `子项目/图名`）' }
    var name = dk.name
    var text
    try {
      text = await fs.readText(await fs.resolve(fileAt(dk.dir, dk.name)))
    } catch (e) {
      return { ok: false, error: '读不到「' + (args && (args.key || args.name)) + '」：' + msgOf(e) }
    }
    if (!hasTombstone(text)) {
      try {
        await fs.writeText(await fs.resolve(fileAt(dk.dir, dk.name)), TOMBSTONE + '\n' + text)
      } catch (e) {
        return { ok: false, error: '删除失败：' + msgOf(e) }
      }
    }
    // 删的正好是当前这张 → 换回默认图，别让界面停在已删除的内容上
    if (doc.name === name && lib.dir === dk.dir) {
      doc.name = DEFAULT_DIAGRAM
      loadedFor = null
      await ensureLoaded()
      return fullOf()
    }
    await refreshLibrary()
    return fullOf()
  })
})

ctx.effect(function () {
  return onRpc('doc:restore', async function (args) {
    await ensureLoaded(args && args.where)
    if (!fs) return { ok: false, error: 'fs 服务不可用' }
    var rk = resolveKey(args && (args.key || args.name))
    if (!rk) return { ok: false, error: '需要 key（图名，或 `子项目/图名`）' }
    var text
    try {
      text = await fs.readText(await fs.resolve(fileAt(rk.dir, rk.name)))
    } catch (e) {
      return { ok: false, error: '读不到「' + (args && (args.key || args.name)) + '」：' + msgOf(e) }
    }
    if (hasTombstone(text)) {
      try {
        await fs.writeText(await fs.resolve(fileAt(rk.dir, rk.name)), text.replace(/^\s*%%\s*@deleted[^\n]*\n?/, ''))
      } catch (e) {
        return { ok: false, error: '恢复失败：' + msgOf(e) }
      }
    }
    await refreshLibrary()
    return { ok: true, dir: lib.dir, scope: lib.scope, workspace: lib.workspace, current: doc.name, items: libraryCache }
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
    await ensureLoaded(whereOfExec(exec))
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
    await ensureLoaded(whereOfExec(exec))
    var raw = args && typeof args.key === 'string' ? args.key
      : (args && typeof args.name === 'string' ? args.name : '')
    if (!raw.trim()) return { ok: false, error: '需要 key' }
    var k = resolveKey(raw)
    if (!k) return { ok: false, error: '当前没有项目根，无法引用子项目的图' }
    if (k.dir !== lib.dir) {
      lib = { dir: k.dir, scope: k.scope, workspace: k.workspace }
      loadedFor = null
    }
    var r = await loadDiagramAt(k, k.name, !!(args && args.create))
    if (!r.ok) {
      var items = await refreshLibrary()
      var names = items.filter(function (x) { return !x.deleted }).map(function (x) { return x.key })
      return {
        ok: false,
        error: r.error + '。可用的图有：' + (names.length ? names.join('、') : '(还没有别的图)') + '；要新建请带 create: true',
      }
    }
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
      mermaid: { type: 'string', description: '完整的 Mermaid flowchart 源码。用 flowchart TD 或 flowchart LR 开头，例如：flowchart TD\\n  a["入口"] --> b["核心"]' },
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
        return [{ type: 'text', text: '已更新「' + String(v.diagram || '') + '」（修订 ' + v.revision + '）：' + v.nodeCount + ' 个节点、' + v.edgeCount + ' 条连线。用户现在看到的图形已同步。' }]
      } catch (e) {
        return [{ type: 'text', text: 'arch_write 已完成' }]
      }
    },
  },
  execute: async function (args, exec) {
    var t0 = Date.now()
    await ensureLoaded(whereOfExec(exec))
    var text = args && typeof args.mermaid === 'string' ? args.mermaid : ''
    if (!text.trim()) return toolReject('arch_write', 'mermaid 不能为空', t0)
    var parsed = inheritPositions(parseMermaid(text))
    if (parsed.nodes.length === 0) {
      return toolReject('arch_write', '解析不出任何节点（首行应是 flowchart TD 或 graph LR）', t0)
    }
    var before = snapshotNodes()
    var saved = snapshotModel()
    adopt(parsed)
    adoptModel(modelOf())
    bump('ai')
    noteAiChange(before)
    if (args && typeof args.note === 'string' && args.note) doc.notes = [args.note]
    var saveError = await persistOrRollback(saved, 'arch_write')
    var out = summaryOf()
    out.mermaid = serializeDoc(doc)
    logEvent(saveError ? 'error' : 'info', 'tool.arch_write', {
      diagram: doc.name, key: keyOf(doc.name), file: doc.file,
      nodes: doc.nodes.length, edges: doc.edges.length, revision: doc.revision,
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
              enum: ['add_node', 'set_label', 'set_shape', 'set_link', 'move_node', 'remove_node', 'add_edge', 'remove_edge', 'set_edge_label', 'add_group', 'set_group', 'remove_group', 'set_direction'],
              description: '操作类型',
            },
            id: { type: 'string', description: '节点 id（add_node/set_label/set_shape/set_link/move_node/remove_node/set_group 用）' },
            label: { type: 'string', description: '节点或连线的显示文本；add_group 时作为分组标题' },
            shape: { type: 'string', description: '节点形状：rect 矩形 / round 圆角 / stadium 胶囊 / circle 圆 / diamond 判定 / cyl 数据库 / hex 六边形 / sub 子流程 / asym 旗形' },
            link: { type: 'string', description: 'set_link / add_node 用：把这个节点下钻到另一张图（图名，不含 .mmd）；传空串取消' },
            from: { type: 'string', description: '连线的起点节点 id' },
            to: { type: 'string', description: '连线的终点节点 id' },
            group: { type: 'string', description: '分组 id；set_group 时传空串表示移出分组' },
            arrow: { type: 'string', description: '连线样式：--> 实线箭头 / --- 无箭头 / -.-> 虚线 / ==> 粗线' },
            x: { type: 'number', description: '画布横坐标（move_node / add_node 用）' },
            y: { type: 'number', description: '画布纵坐标（move_node / add_node 用）' },
            value: { type: 'string', description: 'set_direction 时用：TD / BT / LR / RL' },
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
    await ensureLoaded(whereOfExec(exec))
    var ops = args && Array.isArray(args.ops) ? args.ops : []
    if (ops.length === 0) return toolReject('arch_edit', 'ops 不能为空', t0)
    var before = snapshotNodes()
    var saved = snapshotModel()
    var result = applyOps(ops)
    if (args && typeof args.note === 'string' && args.note) doc.notes = [args.note]
    bump('ai')
    noteAiChange(before)
    var saveError = await persistOrRollback(saved, 'arch_edit')
    var out = summaryOf()
    out.mermaid = serializeDoc(doc)
    out.appliedCount = result.done.length
    out.done = result.done
    out.problems = result.problems
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

// 挂载现场：这个插件对 console 一字不吐，「挂上了没」以前只能靠人去数注册结果，
// 现在落一行到日志文件里，顺带留下日志目录与形态。
logEvent('info', 'plugin.mount', {
  tools: registeredTools.join(','), toolCount: registeredTools.length,
  routes: registeredRoutes.join(','), routeCount: registeredRoutes.length,
  dir: lib.dir, scope: lib.scope, logDir: logDir(), logBackend: logBackend ? 'file' : 'none',
})

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
