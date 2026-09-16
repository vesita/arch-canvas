// 动态 Cordis Package 的 host 半边 —— 薄壳。真身是项目里的 dist/host.js，这里读盘后求值，
// 所以改宿主逻辑不必重新 define 这个 Package。
//
// host 沙箱没有 import / require，但 eval 可达，所以把源码包成
// `(function (ctx, harness, hostEnv) {...})` 再调用（宿主逻辑顶层带 return，
// 不能直接 eval）。代价：cordis_inspect_self 看到的是这层壳。
//
// 这是**开发形态**；装机分发走 lib/index.js。两者递的 harness 形状相同，只差服务时序：
// 动态沙箱里 ctx 已装配完毕，路由可以直接注册，不必等 webServer。

var PROJECT = '/home/vesita/coding/my/arch-canvas'
var HOST_FILE = PROJECT + '/dist/host.js'
// 动态开发形态本来就把本机路径写在这一层（PROJECT 也是）；装机分发的真插件那半
// 按 $DSH_HOME / ~/.dsh 自己算数据目录。
var DATA_DIR = '/home/vesita/.dsh/arch-canvas'

function hostFactory(code) {
  // eval 是这里唯一的加载手段：沙箱没有 import / require / 动态模块。
  var factory = eval('(function (ctx, harness, hostEnv) {\n' + code + '\n})')
  if (typeof factory !== 'function') throw new Error('dist/host.js 求值结果不是函数')
  return factory
}

// 这段是「函数体片段」：末尾的 return 由 tools/build.mjs 补上（TS 不允许顶层 return）。
var __plugin = {
  // 与真插件半边同一条理由：服务依赖走 inject，ctx.get 取快照会静默拿不到。
  inject: ['fs', 'tools', 'systemPrompt'],
  apply: function (ctx) {
    var fs = ctx.get('fs')
    if (fs === undefined) {
      throw new Error('host 半边拿不到 fs 服务，无法从磁盘加载宿主逻辑')
    }

    // 沙箱给的 harness 没有 route，补一个同形状的收集器，稍后在本 ctx 上注册。
    var routes = []
    var dynHarness = {
      handle: function (name, fn) { return harness.handle(name, fn) },
      defineTool: function (def) { return harness.defineTool(def) },
      registerTool: function (c, def) { return harness.registerTool(c, def) },
      route: function (path, handler) { routes.push({ kind: 'exact', path: path, handler: handler }) },
    }

    // 日志后端（动态形态版）：沙箱里没有 require / node:fs，只能用注入的 fs 服务。
    // 代价是「追加」要读全文再写回、「删除」只能清空（fs 服务没有 unlink）——
    // 清空后的文件不再是合法日志名下的有内容文件，list 里直接跳过，于是清理不会重复触发。
    var fsLogBackend = {
      ensureDir: async function (dir) {
        try { await fs.writeText(await fs.resolve(dir + '/.gitkeep'), '') } catch (e) {}
      },
      append: async function (dir, file, text) {
        var target = await fs.resolve(dir + '/' + file)
        var old = ''
        try {
          var info = await fs.stat(target)
          if (info) old = await fs.readText(target)
        } catch (e) {}
        await fs.writeText(target, old + text)
      },
      list: async function (dir) {
        try {
          var t = await fs.resolve(dir)
          if (!(await fs.stat(t))) return []
          var entries = await fs.listDir(t)
          var names = []
          for (var i = 0; i < entries.length; i++) {
            if (entries[i].type !== 'file') continue
            if (entries[i].size === 0) continue  // 已清空的旧日志：视作不存在
            names.push(entries[i].name)
          }
          return names
        } catch (e) { return [] }
      },
      remove: async function (dir, file) {
        try { await fs.writeText(await fs.resolve(dir + '/' + file), '') } catch (e) {}
      },
      size: async function (dir, file) {
        try {
          var target = await fs.resolve(dir + '/' + file)
          var info = await fs.stat(target)
          return info ? (info.size || 0) : 0
        } catch (e) { return 0 }
      },
    }

    // 异步加载；内层用的还是这个 ctx，所以它的 effect 都挂在本 Package 的 fiber 上，会被一并撤销。
    // 不 try/catch：加载失败就让这个 Promise 拒绝（宿主会报 uncaught），
    // 这个插件对 console 一字不吐 —— 成功也安静。
    ;(async function () {
      var target = await fs.resolve(HOST_FILE)
      var info = await fs.stat(target)
      if (!info) throw new Error('找不到 ' + HOST_FILE + '（在项目里跑 npm run build）')
      var code = await fs.readText(target)
      var hostEnv = { uiFile: PROJECT + '/dist/ui.js', mermaidFile: PROJECT + '/assets/mermaid.min.js', dataDir: DATA_DIR, logBackend: fsLogBackend }
      var plugin = hostFactory(code)(ctx, dynHarness, hostEnv)
      if (!plugin || typeof plugin.apply !== 'function') {
        throw new Error('dist/host.js 没有导出 apply —— 是不是把 src/host/*.js 直接拷过来了？')
      }
      plugin.apply(ctx)
      var webServer = ctx.get('webServer')
      if (webServer) {
        for (var i = 0; i < routes.length; i++) {
          (function (r) {
            ctx.effect(function () { return webServer.register(r) })
          })(routes[i])
        }
      }
    })()
  },
}
