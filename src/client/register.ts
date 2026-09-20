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
  return React.createElement(ArchStudio, { cwd: cwd, sessionId: sessionId })
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
