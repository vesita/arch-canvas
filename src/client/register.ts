// 注册面：右键栏标签体、左栏底部入口、sidebarRightTabs 选项卡声明。
// ==================== 右键栏标签体 ====================
// DSH 的 sidebar.right.pane.tab 会自动注入 sessionId 与 useSessions（见 files 插件实现）。
// 通过 useSessions 响应式订阅当前会话 cwd 并透传给 ArchStudio，保证人与 AI 访问同一项目图库。
function ArchTab(props) {
  var sessionId = props && props.sessionId
  var useSessions = props && props.useSessions
  var cwd = typeof useSessions === 'function' && sessionId
    ? useSessions(function (sessions) { return sessions && sessions.byId && sessions.byId[sessionId] ? sessions.byId[sessionId].cwd : undefined })
    : undefined
  return React.createElement(ArchStudio, Object.assign({}, props, { cwd: cwd, sessionId: sessionId }))
}

// ==================== 侧栏底部入口 ====================
// 做成真正的开关：点一下打开侧栏并激活本插件标签；此时再点一下 = 关掉标签 + 收起侧栏。
// 开关一律走 sidebarRight：`openTab` 自己会展开侧栏，收起用 `toggleExpanded`。
// `layout.openRightbar(track, fullscreen)` 只是置位、不是 toggle，而且传 `track=false` 会覆盖轨道偏好。
function toggleArchTab(retried?: boolean) {
  if (!PLUGIN_CTX) return
  var right = PLUGIN_CTX.get('sidebarRight')
  if (right && typeof right.openTab === 'function' && typeof right.isExpanded === 'function') {
    var cur = typeof right.active === 'function' ? right.active() : null
    if (right.isExpanded() && cur && cur.kind === TAB_KIND) {
      try { right.close(cur.id) } catch (e) {}
      try { if (right.isExpanded()) right.toggleExpanded() } catch (e) {}
      return
    }
    try { right.openTab(TAB_KIND); return } catch (e) {}
  }
  // 席位可能还没挂上（点得比挂载早），等一拍再试一次
  if (!retried) {
    try {
      ctxTimeout(function () { toggleArchTab(true) }, 260)
    } catch (e) {}
  }
}

function ArchFoot(props) {
  var wide = props && props.wide
  // 包一层：直接传 toggleArchTab 会把 MouseEvent 当成 retried 参数收下
  return React.createElement('button', { className: 'ac-foot', type: 'button', title: '架构画布', onClick: function () { toggleArchTab() } },
    React.createElement(ArchIcon, { size: 17 }),
    wide ? React.createElement('span', { className: 'lbl' }, '架构画布') : null,
  )
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
      var nodes = Array.isArray(studioLiveNodes) ? studioLiveNodes : []
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
    // 契约要求这个钩子**同步、无副作用**（渲染路径），模块级的 studioLiveNodes 快照正合适。
    lexicon: function () {
      var nodes = Array.isArray(studioLiveNodes) ? studioLiveNodes : []
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
        var nodes = Array.isArray(studioLiveNodes) ? studioLiveNodes : []
        var target = null
        for (var i = 0; i < nodes.length; i++) {
          if (nodes[i].id === ref) { target = nodes[i]; break }
        }
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
// ==================== 发送区上方的「留言待发」横条 ====================
// 用户要的是：留言出现在发送区、能一键发，但**不占用输入框**（不能顶掉正在打的字）。
// 走 conversation.input.dock —— 契约原文 "Full-width entries above the composer card"
// （dsh-client-ui-conversation/.../slots.d.ts:207），位置就是为这件事留的。
//
// 为什么是「放入输入框」而不是「直接发送」：留言以 `@节点id` 的形式进草稿后，会被
// registerArchInputTrigger 的 lexicon 装饰成**上下文块**（上下文块 = 可见、可编辑、
// 发送时才由 codec.serialize 展开）。直接 submit 等于替用户把话发出去，不给反悔余地。
function PendingNotesDock(props) {
  var inputActions = props && props.inputActions
  var useInput = props && props.useInput
  var seed = React.useState(0)
  var bump = seed[1]
  // studioLiveNodes 是普通模块级快照（不是响应式的），所以靠一个低频心跳重算清单。
  // 1 秒只是扫一遍几十个节点的 note 字段；而且界面里的定时器必须走 ctxInterval ——
  // 动态形态下裸 setInterval 会被沙箱 trap 掉（见 AGENTS.md）。
  React.useEffect(function () {
    var stop = ctxInterval(function () { bump(function (n) { return n + 1 }) }, 1000)
    return typeof stop === 'function' ? stop : undefined
  }, [])
  // 草稿必须读出来：setDraft 是**整段替换**，不知道现有内容就会把用户打的字顶掉。
  var draft = ''
  if (typeof useInput === 'function') {
    var d = useInput(function (s) { return (s && typeof s.draft === 'string') ? s.draft : '' })
    if (typeof d === 'string') draft = d
  }
  var pending = []
  var nodes = Array.isArray(studioLiveNodes) ? studioLiveNodes : []
  for (var i = 0; i < nodes.length; i++) {
    if (nodes[i] && nodes[i].id && nodes[i].note && !nodes[i].noteDone) pending.push(nodes[i].id)
  }
  if (pending.length === 0) return null
  // 查重：已经在草稿里的不再重复加。否则点两下就会把同一批留言塞进去两遍 ——
  // 用户报的就是这个（"加过后这个加入功能还在"）。草稿一变 useInput 就会推着我们重渲染，
  // 所以加完这一下按钮自己就会变成"已在输入框中"。
  var missing = []
  for (var k = 0; k < pending.length; k++) {
    if (String(draft || '').indexOf('@' + pending[k]) < 0) missing.push(pending[k])
  }
  var allIn = missing.length === 0
  // 全部都已经在草稿里 → 整条消失。留一条"已在输入框中"的灰条只是噪音：
  // 它不再提供任何动作，却一直占着输入框上方那一行。
  if (allIn) return null
  var canPut = !!(inputActions && typeof inputActions.setDraft === 'function')
  var put = function () {
    if (!canPut) return
    var add = missing.map(function (id) { return '@' + id }).join(' ')
    inputActions.setDraft(draft.trim() ? draft.replace(/\s+$/, '') + '\n' + add : add)
  }
  return React.createElement('div', { className: 'ac-pending' },
    React.createElement('span', { className: 'ac-pending-n' },
      '留言 ' + pending.length + ' 条待发' +
      (missing.length < pending.length ? '（只补还没放进来的 ' + missing.length + ' 条）'
        : (draft.trim() ? '（追加在你已写的后面）' : ''))),
    React.createElement('button', {
      className: 'ac-pending-btn', onClick: put, disabled: !canPut,
    }, payloadLabel(missing.length)),
  )
}

function payloadLabel(n) {
  return n > 1 ? '放入输入框（一次说清）' : '放入输入框'
}

function registerAll(ctx) {
  PLUGIN_CTX = ctx
  var disposers = []

  disposers.push(styles.insert(STUDIO_CSS))

  var slots = ctx.get('slots')
  if (slots !== undefined) {
    disposers.push(slots.inject('sidebar.footer.action', function () {
      return slots.register({ name: 'sidebar.footer.action', id: TAB_ID, order: 55, label: '架构画布' }, ArchFoot)
    }))
    disposers.push(slots.inject('sidebar.right.pane.tab', function () {
      return slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID }, ArchTab)
    }))
    // 发送区上方的留言横条。**单独** inject 这一个 slot：conversation 插件不在时
    // 它不会回调，但侧栏、AI 工具与提示词上下文照常可用（同 webServer 那条道理）。
    disposers.push(slots.inject('conversation.input.dock', function () {
      return slots.register({ name: 'conversation.input.dock', id: TAB_ID + '-pending', order: 40 }, PendingNotesDock)
    }))
  }

  var tabs = ctx.get('sidebarRightTabs')
  if (tabs !== undefined) {
    disposers.push(tabs.register({
      id: TAB_ID,
      kind: TAB_KIND,
      priority: 'extension',
      title: function () { return '架构画布' },
      guide: [{
        id: TAB_ID,
        order: 120,
        title: function () { return '架构画布' },
        description: function () { return '和 AI 一起看同一张 Mermaid 架构图' },
        icon: ArchIcon,
      }],
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
