// 动态 Cordis Package 的 client 半边 —— 刻意做得很薄。
//
// 真正的界面代码住在项目里（src/client/*），由 host 从 <项目>/dist/ui.js 递送。
// 于是「改界面」的循环是：改源码 → npm run build → 刷新页面，
// 不需要重新定义 / 重新授权这个 Package。
//
// 代价要说清楚：热加载进来的脚本跑在页面普通作用域里，不在这个沙箱闭包里，
// 因此它不享受 Cordis 客户端那套 setTimeout/fetch 遮蔽 —— 只递进来 React / host / styles。

var UI_DISPOSE = null

function detach() {
  if (typeof UI_DISPOSE === 'function') {
    try { UI_DISPOSE() } catch (e) {}
  }
  UI_DISPOSE = null
}

function attach(ctx) {
  var mod = window.__archCanvas
  if (!mod || typeof mod.install !== 'function') {
    throw new Error('ui.js 没有导出 __archCanvas.install')
  }
  detach() // 重复加载（HMR / 手动刷新）时先卸旧的，避免槽位重复注册
  UI_DISPOSE = mod.install(ctx)
}

function loadUi(ctx) {
  return host.call('ui:info').then(function (info) {
    if (!info) throw new Error('ui:info 无响应')
    if (!info.url) {
      throw new Error('host 没有注册 UI 路由；期望 ' + String(info.file || info.dir || '?') + ' 存在')
    }
    // <script> 标签没法传参，依赖走全局递进
    window.__archCanvasDeps = {
      React: React,
      styles: styles,
      // 动态模式下 RPC 就是 Package 私有的 host.call；装成真插件后由客户端模块换成 fetch
      rpc: function (method, args) { return host.call(method, args) },
    }
    return new Promise<void>(function (resolve, reject) {
      var el = document.createElement('script')
      el.src = info.url
      el.async = false
      el.onload = function () { resolve() }
      el.onerror = function () {
        try { el.remove() } catch (e) {}
        reject(new Error('无法加载 ' + info.url))
      }
      document.head.appendChild(el)
    }).then(function () {
      attach(ctx)
    })
    // 不 catch：失败让 Promise 带着原因去吵（浏览器自己会报 uncaught），这个插件对 console 一字不吐。
  })
}

// 这段是「函数体片段」：末尾的 return 由 tools/build.mjs 补上（TS 不允许顶层 return）。
var __plugin = {
  inject: ['timer'],
  apply: function (ctx) {
    ctx.effect(function () { return detach })
    loadUi(ctx)
  },
}
