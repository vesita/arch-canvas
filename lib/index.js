'use strict';
// arch-canvas 的宿主半边（真插件形态）。
//
// 与动态 Package 的差别只有四处，全部收在本文件里；宿主逻辑本体
// （lib/host-logic.js）完全不感知这个差别：
//
//   harness.handle       → webServer 上一个 POST 路由 /arch-canvas/rpc
//   harness.route        → webServer.register（在 webServer 就绪后统一注册）
//   harness.defineTool   → 原样返回（真插件的 ToolDefinition 就是那个形状）
//   harness.registerTool → ctx.tools.register
//
// 这一层刻意做薄，是因为「加载方式」和「业务逻辑」被分开了：业务逻辑来自 src/host/*，
// 构建期拼成 lib/host-logic.js —— 一个导出「工厂」的普通模块。
//
// 由 tools/build.mjs 从 src/package/host.js 拷到 lib/index.js，不要手改 lib/。
var path = require('path');
var fsp = require('fs/promises');
var os = require('os');
var RPC_PATH = '/arch-canvas/rpc';
var MAX_BODY = 8 * 1024 * 1024;
// 数据目录（全局图库与日志的落点）：跟 dsh 自己的约定一致（$DSH_HOME，否则 ~/.dsh）。
// 于是 tarball 装到别人机器上时它们落在那个人的家目录里，而不是本机的 /home/vesita。
var dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
var dataDir = path.join(dshHome, 'arch-canvas');
// 日志后端交给宿主逻辑用。真插件形态在真 Node 里，能直接 append / unlink ——
// 「追加一行」和「真的删掉过期日志」这两件事 fs 服务都做不到，
// 而这两种能力正是一个会自己翻天的日志目录需要的。
var nodeLogBackend = {
    ensureDir: function (dir) { return fsp.mkdir(dir, { recursive: true }); },
    append: function (dir, file, text) { return fsp.appendFile(path.join(dir, file), text, 'utf8'); },
    list: function (dir) { return fsp.readdir(dir).then(function (names) { return names; }, function () { return []; }); },
    remove: function (dir, file) { return fsp.unlink(path.join(dir, file)); },
    size: function (dir, file) {
        return fsp.stat(path.join(dir, file)).then(function (st) { return st.size; }, function () { return 0; });
    },
};
function readBody(req) {
    return new Promise(function (resolve, reject) {
        var chunks = [];
        var size = 0;
        req.on('data', function (c) {
            size += c.length;
            if (size > MAX_BODY) {
                reject(new Error('请求体过大'));
                try {
                    req.destroy();
                }
                catch (e) { }
                return;
            }
            chunks.push(c);
        });
        req.on('end', function () { resolve(Buffer.concat(chunks).toString('utf8')); });
        req.on('error', reject);
    });
}
module.exports = {
    name: 'arch-canvas',
    // 这三个是**硬依赖**，必须走 inject 而不是 ctx.get。
    //
    // 必须用 inject：ctx.get 是同步快照，服务晚一步就静默失败 —— 装机实测拿到 undefined，
    // 插件挂上了，工具和路由却一个都没注册。
    inject: ['fs', 'tools', 'systemPrompt'],
    apply: function (ctx) {
        // 与动态 Package 里的 harness.handle 同构：处理函数收进一张表，由下面那个 POST 路由分发。
        var handlers = new Map();
        // 路由只登记，等 webServer 就绪再 register —— 宿主逻辑不猜服务时序。
        var routes = [];
        var toolNames = [];
        var harness = {
            handle: function (name, fn) {
                handlers.set(name, fn);
                return function () { handlers.delete(name); };
            },
            route: function (routePath, handler) {
                routes.push({ kind: 'exact', path: routePath, handler: handler });
            },
            // 真插件的 ToolDefinition 与沙箱里是同一个形状，所以不做任何转换。
            defineTool: function (def) { return def; },
            registerTool: function (c, def) {
                c.effect(function () { return c.tools.register(def); });
                toolNames.push(def && def.name);
            },
        };
        routes.push({
            kind: 'exact',
            path: RPC_PATH,
            handler: async function (req, res) {
                function send(code, obj) {
                    res.statusCode = code;
                    res.setHeader('content-type', 'application/json; charset=utf-8');
                    res.setHeader('cache-control', 'no-store');
                    res.end(JSON.stringify(obj));
                }
                try {
                    var text = await readBody(req);
                    var call = text ? JSON.parse(text) : {};
                    var fn = handlers.get(call.method);
                    if (typeof fn !== 'function') {
                        send(404, { ok: false, error: '未知方法 ' + String(call.method) });
                        return;
                    }
                    send(200, { ok: true, value: await fn(call.args || {}) });
                }
                catch (e) {
                    send(500, { ok: false, error: (e && e.message) ? e.message : String(e) });
                }
            },
        });
        // 包内资源按包自身定位：写死项目目录只在本机成立，tarball 装到别处就全 404。
        var pkgDir = path.resolve(__dirname, '..');
        // hmr 只重新 import 本文件，CJS 缓存会把 host-logic 的改动挡住；加载前清掉。
        var logicPath = require.resolve('./host-logic.js');
        delete require.cache[logicPath];
        var plugin = require(logicPath)(harness, {
            uiFile: path.join(__dirname, 'ui.js'),
            mermaidFile: path.join(pkgDir, 'assets', 'mermaid.min.js'),
            dataDir: dataDir,
            logBackend: nodeLogBackend,
            // 日志门槛：真插件形态在真 Node 里，所以读得到环境变量。
            // 缺省 info（高频巡检走 debug，默认不落盘）；认不出的取值在 log.ts 里退回 info。
            logLevel: process.env.ARCH_CANVAS_LOG_LEVEL || 'info',
        });
        if (!plugin || typeof plugin.apply !== 'function') {
            throw new Error('lib/host-logic.js 没有导出 apply —— 跑 npm run build 重生成，别手改 lib/');
        }
        plugin.apply(ctx);
        // 这个插件对 console **一字不吐**：挂载播报全是正常操作噪音（hmr 每次 build 都会重挂一遍），
        // 出问题一律抛错，让宿主用自己的格式去报 —— 既不静默，也不占输出。
        var toolNote = toolNames.join(', ') || '（无）';
        if (toolNames.length !== 4) {
            throw new Error('工具注册数不对：期望 4 个，实际 ' + toolNames.length + ' 个 —— ' + toolNote);
        }
        // webServer 只在 web 形态里有，不进 inject：headless/acp 里工具与提示词照常可用，只是没界面。
        ctx.inject(['webServer'], function (webCtx) {
            for (var i = 0; i < routes.length; i++) {
                (function (r) {
                    webCtx.effect(function () { return webCtx.webServer.register(r); });
                })(routes[i]);
            }
        });
    },
};
