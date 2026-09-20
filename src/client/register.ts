// 注册面：主窗口子页标签体、@ 引用触发源。
// ==================== 主窗口子页标签体 ====================
// 画布是主窗口的一个子页，与「对话」「轨迹」并列（`conversation.view`，session 级 list 槽）。
// 这个槽与旧落点一样由 DSH 注入标准 props：sessionId 与 useSessions。
// 通过 useSessions 响应式订阅当前会话 cwd 并透传给 ArchStudio，保证人与 AI 访问同一项目图库。
function ArchTab(props) {
  var sessionId = props && props.sessionId
  var useSessions = props && props.useSessions
  var cwd = typeof useSessions === 'function' && sessionId
    ? useSessions(function (sessions) { return sessions && sessions.byId && sessions.byId[sessionId] ? sessions.byId[sessionId].cwd : undefined })
    : undefined
  return React.createElement(ArchStudio, Object.assign({}, props, { cwd: cwd, sessionId: sessionId }))
}

// ==================== @ 引用触发源 ====================
// 让用户在输入框输入 @ 时能看到并引用画布节点。
// 选中后插入 chip，提交时序列化为模型可理解的结构化文本。
function formatNodeForModel(node) {
  if (!node) return ''
  var sp = splitLabel(node.label)
  var title = sp.title || node.id
  var desc = sp.desc ? sp.desc.replace(/\r?\n/g, ' ｜ ') : ''
  var parts = []
  parts.push('[画布节点 ' + node.id + '「' + title + '」]')
  if (desc) parts.push(desc)
  if (node.files && node.files.length > 0) {
    parts.push('源码锚点：' + node.files.join(', '))
  }
  if (node.note) {
    var noteStatus = node.noteDone ? '已解决' : '待办'
    var noteText = String(node.note).replace(/\r?\n/g, ' / ')
    parts.push('用户留言（' + noteStatus + '）：' + noteText)
  }
  return parts.join(' ｜ ')
}

function registerArchInputTrigger(ctx, disposers) {
  var inputTriggers = ctx.get('inputTriggers')
  if (!inputTriggers || typeof inputTriggers.registerSource !== 'function') return

  var source = {
    trigger: '@',
    name: 'arch-canvas',
    showGroupTitle: true,
    candidates: function (session, req) {
      var query = String(req && req.query != null ? req.query : '').trim().toLowerCase()
      // **按会话取**：这里的 `session` 就是投影（`{ sessionId }`，见 ui-input-trigger）。
      // 拿不到这个会话的快照就返回空 —— 空比「别的项目那张图的节点」好得多。
      var nodes = liveNodesOf(session && session.sessionId)
      var results = []
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i]
        if (!n || !n.id) continue
        var sp = splitLabel(n.label)
        var title = sp.title || n.id
        var desc = sp.desc ? sp.desc.replace(/\r?\n/g, ' ') : ''
        var matchId = n.id.toLowerCase().indexOf(query) >= 0
        var matchTitle = title.toLowerCase().indexOf(query) >= 0
        var matchDesc = desc.toLowerCase().indexOf(query) >= 0
        if (!query || matchId || matchTitle || matchDesc) {
          results.push({
            name: n.id,
            label: title,
            description: desc || undefined,
            icon: ArchIcon,
            hint: n.id,
            value: n.id,
          })
        }
      }
      return Promise.resolve(results)
    },
    onPick: function (pick) {
      var id = pick && pick.candidate ? (pick.candidate.value || pick.candidate.name) : ''
      var label = (pick && pick.candidate && pick.candidate.label) || id
      return {
        insert: {
          source: 'arch-canvas',
          ref: id,
          label: label,
          clipboardText: '@' + id,
        }
      }
    },
    // 让草稿里的 `@u4` 这种**纯文本**被自动渲染成引用块（上下文块）。契约原文见
    // dsh-client-ui-conversation/lib/client.js:12192「Scan the draft for plain-text reference
    // tokens against the hot lexicons」+ :12300 的 registerTextRefDecoration。
    // 有它，往发送区送留言就不必伪造 span 去插 chip —— 那条路要 draftRev 的 CAS，外部够不着。
    // 契约要求这个钩子**同步、无副作用**（渲染路径），所以它只读这个会话已经攒下的快照。
    //
    // 它同时也是**展开的闸门**：这个会话没有这个 id，token 就不会被装饰成上下文块，
    // 于是 codec.serialize 也不会被叫到它头上（见下面那条注释）。
    lexicon: function (session) {
      var nodes = liveNodesOf(session && session.sessionId)
      var ids = []
      for (var i = 0; i < nodes.length; i++) {
        if (nodes[i] && nodes[i].id) ids.push(nodes[i].id)
      }
      return ids
    },
    codec: {
      clipboardText: function (ref) {
        return '@' + ref
      },
      serialize: function (ref, signal) {
        // 契约里这条**拿不到会话**（`serialize(ref, signal)`，见 ui-input-trigger 的
        // serializeReference）。所以解析交给 resolveLiveNode：优先「最近一次被问到的
        // 那个会话」，同名节点分不清就宁可不展开 —— 绝不把另一张图的话塞进 prompt。
        var target = resolveLiveNode(ref)
        if (!target) {
          return Promise.resolve('[画布节点 ' + ref + '（当前画布中已不存在该节点）]')
        }
        return Promise.resolve(formatNodeForModel(target))
      }
    }
  }

  try {
    var unreg = inputTriggers.registerSource(source)
    if (typeof unreg === 'function') {
      disposers.push(unreg)
    }
  } catch (e) {}
}

// ==================== 注册 ====================
// 做完整注册，返回一个卸载函数。
//
// 这里不再直接 `return { inject, apply }`：本文件现在是**从磁盘热加载**的普通脚本
// （由 host 从 <项目>/dist/ui.js 递给浏览器），Package 里留的是 src/bootstrap/client.js
// 那个薄引导层。所以界面代码的全部生命周期都收敛在这个返回值上。
//
// 发送区上方那条「留言待发」横条（曾经挂在 conversation.input.dock 上）**已经移除**：
// 用户要的是「所有未办留言自动进输入框」，那条横条既提供一个已经不需要的按钮，
// 又要在发送区上方常年占一行。自动补引用的 effect 在 studio.ts 里（盯着待办集合）。

function registerAll(ctx) {
  PLUGIN_CTX = ctx
  var disposers = []

  disposers.push(styles.insert(STUDIO_CSS))

  var slots = ctx.get('slots')
  if (slots !== undefined) {
    // 排在主窗口自带的两页之后：对话 0、轨迹 10（另一个插件的用量页占 20）。
    disposers.push(slots.inject('conversation.view', function () {
      return slots.register({ name: 'conversation.view', id: TAB_ID, order: 30, label: '架构画布' }, ArchTab)
    }))
  }

  registerArchInputTrigger(ctx, disposers)

  return function dispose() {
    for (var i = disposers.length - 1; i >= 0; i--) {
      try { if (typeof disposers[i] === 'function') disposers[i]() } catch (e) {}
    }
    disposers.length = 0
    PLUGIN_CTX = null
  }
}
