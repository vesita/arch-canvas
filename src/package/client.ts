// arch-canvas 的浏览器半边（真插件形态）。
//
// 手写 __ModuleLoader__.load 包装是浏览器半边的加载协议：客户端插件以「一个自带 id 的
// 工厂」注册，require 由加载器注入。全文件不使用 JSX —— React.createElement 的第三个
// 参数起是 children，而自动 jsx runtime 从 props.children 读取，混用会静默渲染出空元素。
//
// 这一层同样刻意做薄：界面本体（lib/ui.js）由 host 从 /arch-canvas/ui.js 现读现发，
// 这里只负责把三样宿主环境才有的东西递进去 —— React、styles、rpc。
//
// 由 tools/build.mjs 从 src/package/client.js 拷到 lib/client.js，不要手改 lib/。

window.__ModuleLoader__!.load({
  id: 'arch-canvas',
  factory: (require) => {
    var module: { exports: any } = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')

    const RPC_PATH = '/arch-canvas/rpc'
    const UI_URL = '/arch-canvas/ui.js'

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
      loadUi(ctx)
    }

    exports.apply = apply
    // 只列界面真正需要的三个服务。**不列 timer**：没有它界面靠原生定时器回退
    // （见 runtime.ts 的 ctxTimeout），而列了又缺席，插件会永远 park 且不报错。
    exports.inject = ['slots', 'sidebarRightTabs', 'layout']
    return module.exports
  },
})
