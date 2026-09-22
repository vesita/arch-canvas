// arch-canvas 的浏览器半边（真插件形态）。
//
// 手写 __ModuleLoader__.load 包装是浏览器半边的加载协议：客户端插件以「一个自带 id 的
// 工厂」注册，require 由加载器注入。全文件不使用 JSX —— React.createElement 的第三个
// 参数起是 children，而自动 jsx runtime 从 props.children 读取，混用会静默渲染出空元素。
//
// 这一层同样刻意做薄：界面本体（lib/ui.js）由 host 从 /arch-canvas/ui.js 现读现发，
// 这里只负责把宿主环境才有的东西递进去 —— React、styles、rpc；另外挂一张设置卡
// （「插件」页里的数据目录），它用的是官方设置表单原语，不碰界面本体。
//
// 由 tools/build.mjs 从 src/package/client.js 拷到 lib/client.js，不要手改 lib/。

window.__ModuleLoader__!.load({
  id: 'arch-canvas',
  factory: (require) => {
    var module: { exports: any } = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    /**
     * 官方设置表单原语：保存/放弃/暂存语义全部由它们承担，不自己发明一套。
     * 与 dsh-collab 的同款用法（见 `ui-settings-agent-loop` 的官方页面）。
     */
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')

    const RPC_PATH = '/arch-canvas/rpc'
    const UI_URL = '/arch-canvas/ui.js'
    /** 本插件在 profile 里的**条目 id**，也就是配置表单的命名空间（与 cordis.patch.yml 的 id 一致）。 */
    const CONFIG_NS = 'arch-canvas'
    /** 插件页里本插件那张配置卡的键：必须是 bundle 的包名。 */
    const BUNDLE_KEY = 'arch-canvas'
    /** 本卡编辑的唯一字段，与 Host 半边 Config 的字段名逐字一致。 */
    const DATA_DIR_FIELD = 'dataDir'

    var uiDispose = null

    function detach() {
      if (typeof uiDispose === 'function') {
        try { uiDispose() } catch (e) {}
      }
      uiDispose = null
    }

    // 界面里的 host.call 在真插件形态下走这个：同源 POST，请求/响应都是 JSON。
    // 约定与服务端一致：HTTP 层 {ok, value|error}，value 里面才是业务返回值。
    function rpc(method, args) {
      return fetch(RPC_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method: method, args: args || {} }),
      })
        .then(function (r) { return r.json() })
        .then(function (r) {
          if (!r || r.ok !== true) throw new Error((r && r.error) || 'RPC 失败')
          return r.value
        })
    }

    // 界面用 styles.insert(css) 注入样式。动态模式里这是沙箱给的，这里是等价实现。
    function makeStyles() {
      return {
        insert: function (css) {
          var el = document.createElement('style')
          el.setAttribute('data-arch-canvas', '')
          el.textContent = css
          document.head.appendChild(el)
          return function () { try { el.remove() } catch (e) {} }
        },
      }
    }

    function loadUi(ctx) {
      window.__archCanvasDeps = { React: React, styles: makeStyles(), rpc: rpc }
      return new Promise<void>(function (resolve, reject) {
        var el = document.createElement('script')
        el.src = UI_URL
        el.async = false
        el.onload = function () { resolve() }
        el.onerror = function () {
          try { el.remove() } catch (e) {}
          reject(new Error('无法加载 ' + UI_URL))
        }
        document.head.appendChild(el)
      })
        .then(function () {
          var mod = window.__archCanvas
          if (!mod || typeof mod.install !== 'function') {
            throw new Error('ui.js 没有导出 __archCanvas.install')
          }
          detach() // 重复加载时先卸旧的，避免槽位重复注册
          uiDispose = mod.install(ctx)
        })
      // 不 catch：界面加载失败就让 Promise 带着原因去吵（浏览器自己会报 uncaught），
      // 这个插件对 console 一字不吐 —— 成功也安静。
    }

    function apply(ctx) {
      ctx.effect(function () { return detach })
      mountConfigCard(ctx)
      loadUi(ctx)
    }

    /**
     * 侧边栏「插件」页里 arch-canvas 那张卡上的配置区。
     *
     * DSH 0.1.7 起客户端不再有 `settingsScope`：设置页读写的统一入口是
     * `configForms`（当前 Profile 的插件配置在浏览器里的那张表单）。插件页只为
     * **条目上带 config 的包**渲染配置区 —— `ledger.bundles` 收集注册了
     * `plugins.bundle.config` 槽的包名，所以这里 `key` 必须是**包名**。
     *
     * 本卡只编辑一项：数据目录。它只放**平铺标量** —— 官方 `SettingsFormModel`
     * 按单键读写（`value?.[field]` / `path: [field]`），嵌套对象在表单里够不着。
     */
    function mountConfigCard(ctx) {
      // `configForms` 缺席（旧构建 / 没有设置服务的部署）时安静跳过，绝不抛 ——
      // 抛出去会把整个浏览器半边带下去，连画布都开不了。
      var forms = ctx && ctx.configForms
      if (!forms || typeof forms.get !== 'function') return
      var scope = forms.get(CONFIG_NS)
      if (!scope) return

      var SettingsForm = primitives.SettingsForm
      var SettingsValueField = primitives.SettingsValueField
      var SettingsFormModel = primitives.SettingsFormModel
      var settingsTextField = primitives.settingsTextField

      var formModel = new SettingsFormModel(scope, [settingsTextField(DATA_DIR_FIELD)])
      ctx.effect(function () { return function () { formModel.dispose() } })

      /**
       * 保存栏文案。官方 `SettingsForm` 的 labels 契约，逐字对齐
       * `ui-settings-agent-loop` 与 dsh-collab。
       */
      var formLabels = {
        unavailable: '本部署没有提供这项配置。',
        readOnly: '本部署的配置为只读，无法在此修改。',
        save: '保存',
        saving: '保存中…',
        saveFailed: '保存失败，改动未生效。',
      }

      var formStore = formModel.bind(function () {
        var projection: any = { shell: formModel.shell() }
        projection[DATA_DIR_FIELD] = formModel.field(DATA_DIR_FIELD)
        return projection
      })
      ctx.effect(function () { return function () { formStore.dispose() } })

      /** 本卡的内联样式：本包不发布 CSS，只用已安装主题里确认存在的 token。 */
      var cardStyles = {
        row: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
        button: {
          appearance: 'none',
          cursor: 'pointer',
          border: '1px solid var(--dsw-alias-border-l2)',
          borderRadius: '8px',
          padding: '5px 14px',
          font: 'inherit',
          fontSize: '13px',
          lineHeight: 1.5,
          color: 'var(--dsw-alias-label-secondary)',
          background: 'none',
        },
        hint: { color: 'var(--dsw-alias-label-tertiary)', margin: 0, fontSize: '12px', lineHeight: 1.5 },
        notice: { color: 'var(--dsw-alias-label-error)', margin: 0, fontSize: '12px', lineHeight: 1.5 },
      }

      /**
       * 官方工作区服务：`uiWorkspace` 是**可选**服务（headless / ACP 形态根本没有浏览器），
       * 所以走 `ctx.get` 而不是 `inject` —— 列进 inject 而缺席会让整个浏览器半边 park。
       */
      function workspaceService(): any {
        try {
          return typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : undefined
        } catch (e) {
          return undefined
        }
      }

      /**
       * 挑一个目录：桌面 App 走 preload 桥，网页走官方 `uiWorkspace.pickDirectory()`。
       *
       * 这个优先级逐字对齐官方 native 那半（`dsh-client-ui-directory-picker-native/lib/client.js:63`）。
       * 注意 `pickDirectory` **只在 native 组合里成立**：宿主按 kind 门禁（`native` 给 pick，
       * `browse` 给 list/create），所以网页内浏览组合下它会 reject —— 调用方必须把 reject
       * 当成「这里没有系统选择器」如实说出来，而不是静默失败。
       */
      function pickDirectoryWith(workspace: any): Promise<any> {
        var bridge = typeof globalThis !== 'undefined' ? (globalThis as any).__DSH_DIRECTORY_PICKER__ : undefined
        if (bridge && typeof bridge.pick === 'function') return bridge.pick()
        return workspace.pickDirectory()
      }

      /** 有没有可用的系统选择器：preload 桥，或宿主里的 native 能力入口。 */
      function hasDirectoryPicker(workspace: any): boolean {
        var bridge = typeof globalThis !== 'undefined' ? (globalThis as any).__DSH_DIRECTORY_PICKER__ : undefined
        if (bridge && typeof bridge.pick === 'function') return true
        return !!workspace && typeof workspace.pickDirectory === 'function'
      }

      function ArchConfigCard(props) {
        var state = props.useArchConfig(function (s) { return s })
        var node = state[DATA_DIR_FIELD]
        var notice = React.useState(null)
        var busy = React.useState(false)
        var locked = !state.shell.writable || state.shell.saving

        /**
         * 弹出系统文件管理器，选中的路径**只填进输入框**（暂存草稿），仍然要点「保存」才写入。
         *
         * 取消（`null`）什么都不做；失败原样说出来并指回「直接填路径」——本卡永远保留文本
         * 输入，因为 browse 组合与 headless 形态下这里没有系统对话框可弹。
         */
        function choose() {
          var workspace = workspaceService()
          if (!hasDirectoryPicker(workspace)) {
            notice[1]('这个部署没有系统目录选择器（没有桌面端，或用的是网页内浏览组合），请直接填写上面的路径。')
            return Promise.resolve()
          }
          notice[1](null)
          busy[1](true)
          return Promise.resolve()
            .then(function () { return pickDirectoryWith(workspace) })
            .then(function (path) {
              if (typeof path === 'string' && path.length > 0) props.edit(DATA_DIR_FIELD, path)
              else notice[1](null)
            }, function (error) {
              notice[1]('打不开系统目录选择器：' + ((error && error.message) || '未知错误') + '。可以直接填写上面的路径。')
            })
            .then(function () { busy[1](false) })
        }

        return React.createElement(
          SettingsForm,
          {
            labels: formLabels,
            state: state.shell,
            onSave: props.save,
            onDiscard: props.discard,
          },
          React.createElement(SettingsValueField, {
            id: DATA_DIR_FIELD,
            label: '数据目录',
            hint: '全局图库与日志的落点。留空则用 $DSH_HOME（否则 ~/.dsh）下的 arch-canvas。' +
              '它决定图库根目录，所以改完要重启 dsh 才生效。',
            text: node.text,
            overridden: node.overridden,
            invalid: node.invalid,
            onEdit: function (text) { props.edit(DATA_DIR_FIELD, text) },
            onReset: function () { props.resetField(DATA_DIR_FIELD) },
          }),
          React.createElement(
            'div',
            { style: cardStyles.row },
            React.createElement(
              'button',
              {
                type: 'button',
                style: cardStyles.button,
                disabled: busy[0] || locked,
                onClick: choose,
              },
              busy[0] ? '正在等待选择…' : '选择目录…'
            ),
            React.createElement(
              'span',
              { style: cardStyles.hint },
              '打开系统文件管理器挑一个目录；选中只是填进上面的输入框，仍要点「保存」才写入。'
            )
          ),
          notice[0] !== null
            ? React.createElement('p', { style: cardStyles.notice, role: 'status' }, notice[0])
            : null
        )
      }

      ctx.slots.inject('plugins.bundle.config', function () {
        return ctx.slots.register(
          {
            name: 'plugins.bundle.config',
            key: BUNDLE_KEY,
            inject: function () {
              var face: any = formModel.actions()
              face.hooks = { archConfig: formStore }
              return face
            },
          },
          ArchConfigCard
        )
      })
    }

    exports.apply = apply
    // 界面本体依赖 slots（注册主窗口子页）；配置卡依赖 configForms。
    // **不列 timer**：没有它界面靠原生定时器回退（见 runtime.ts 的 ctxTimeout），
    // 而列了又缺席，插件会永远 park 且不报错。
    exports.inject = ['slots', 'configForms']
    return module.exports
  },
})
