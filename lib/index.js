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
/**
 * 本插件的设置 schema（`Config` 就是它的值）。
 *
 * **关键在于加载时序，不是 require 哪个文件。**
 * `@deepseek-ai/schemastery` 的 CJS 入口第一行就是 `require("@deepseek-ai/cosmokit")`，
 * 而 cosmokit 是 ESM-only。dsh 启动时用一个级联 loader **并发** `import()` 一大批插件
 * （`dsh-app-boot` 的 internal loader，见 `getOrInitializeCascadedLoader`）；cosmokit 正在
 * 被那边 import 的同时，从 CJS 里 require 它就会撞
 * `ERR_REQUIRE_ESM_RACE_CONDITION`（"not yet fully loaded"）—— **整个插件 import 失败**：
 * 实测启动直接报 `arch-canvas: failed to import`，画布与「插件」页配置区一起消失，
 * 插件一行代码都没跑。
 *
 * 实测结论（都在并发风暴下复现过）：
 *   1. 换成 require `lib/index.mjs` **不管用** —— 那个文件同样 `import` cosmokit；
 *   2. 把 require 推迟到读 `Config` 时**也不管用** —— Loader 在 `await import()` 之后
 *      紧接着同步读 `plugin.Config`，此时风暴未停；
 *   3. **cosmokit 已完整载入后再 require schemastery 就稳** —— 已载入的模块不再有竞争。
 *
 * 所以模块求值期就**发起**一次 `import('@deepseek-ai/cosmokit')` 预热（不 await ——
 * 这里没有顶层 await 可用），让它在 Loader 读 `Config` 之前有机会结算。Getter 里照旧
 * 同步 require schemastery：预热来得及就命中缓存（dsh 的正常路径），来不及也只是退回
 * 原来的行为 —— **绝不能在这里加"没结算就抛错"的判断**，那会把一个偶发的时序问题
 * 变成必然的启动失败（实测：加了那道判断，web profile 下 arch-canvas 直接 failed to import）。
 */
var cosmokitPreload = null;
try {
    // 只用字符串字面量：某些打包/静态分析场景要求 specifier 可静态求值。
    cosmokitPreload = import('@deepseek-ai/cosmokit');
}
catch (e) {
    cosmokitPreload = null;
}
if (cosmokitPreload && typeof cosmokitPreload.catch === 'function') {
    // 预热失败不该变成 unhandled rejection：读 Config 时会自己报错。
    cosmokitPreload.catch(function () { });
}
var cachedSchema = null;
function loadConfigSchema() {
    if (cachedSchema)
        return cachedSchema;
    // 两种导出形态都要认：CJS 构建直接挂命名导出（无 `default`），ESM 形态是 default。
    var schemastery = require('@deepseek-ai/schemastery');
    var z = schemastery.default || schemastery;
    cachedSchema = z.object({
        dataDir: z.string().volatile(),
    });
    return cachedSchema;
}
/** `$DSH_HOME`（否则 `~/.dsh`）下的默认数据目录。 */
var DEFAULT_DATA_DIR = path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'arch-canvas');
/**
 * 读一个字段，认出 0.1.7 的 volatile 引用。
 *
 * volatile 字段不是普通值，而是一个**稳定引用**（`{ get() }`，见 `@deepseek-ai/cosmokit`
 * 的 `createVolatile`）：`JSON.stringify` 出来是 `{}`，值只能用 `.get()` 取。
 * 非 volatile 字段是普通值，两种形态都要认。
 */
function readField(config, field) {
    var raw = config ? config[field] : undefined;
    return raw !== null && typeof raw === 'object' && typeof raw.get === 'function' ? raw.get() : raw;
}
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
    // 数据目录（全局图库与日志的落点）：设置里写了就用它，否则按 `$DSH_HOME` 算。
    // 宿主逻辑（lib/host-logic.js）本身不认设置 —— 它只收一个 dataDir 字符串，
    // 与动态形态完全一致；所以这条读取只发生在这里。
    //
    // 用 getter：`Config` 由 Loader 在 **import 之后**读取，而构造 schema 要
    // `require` 一个 ESM-only 的包（见文件顶部那段说明）。写成顶层属性就会在
    // import 期撞上并发加载的竞态，插件直接 'failed to import'。
    get Config() {
        return loadConfigSchema();
    },
    apply: function (ctx, config) {
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
            // 外壳**直接**推给 webServer 的那些路由（现在只有 RPC 一条）不在宿主逻辑的
            // registeredRoutes 里，挂载自检（4 工具 / 3 路由 / 1 提示词上下文）要数得上它 ——
            // 宿主逻辑靠这个口拿到「真实注册了哪几条」，日志里的 routeCount 才不是恒为 2。
            describeRoutes: function () {
                var out = [];
                for (var i = 0; i < routes.length; i++)
                    out.push(routes[i].path);
                return out;
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
                    // **只挡「网页跨站」这一种，不假装能认证本机进程。**
                    // 这条 RPC 是浏览器面板打过来的（同源），但任何网页都能盲发一个 POST 到
                    // 127.0.0.1:3080 —— 不设防的话，用户随手打开的某个页面就能改掉他任意项目的图
                    // （2026-09-24 对外接口审计第 1 条：dsh 自己的 /api/* 返 401，这条路由没有那一层；
                    //   同一条审计的第 3 条说明宿主也不校验 where 与会话归属）。
                    // 本机进程（curl / 别的工具）不带这些头，照样能用 —— 它本来就能读写同一批文件，
                    // 假装拦住它只是自欺。真正要挡的是「浏览器替用户发的跨站请求」。
                    var hdrs = (req && req.headers) || {};
                    var site = String(hdrs['sec-fetch-site'] || '');
                    if (site && site !== 'same-origin' && site !== 'none') {
                        send(403, { ok: false, error: '跨站请求已拒绝（sec-fetch-site: ' + site + '）' });
                        return;
                    }
                    // **有 origin 就必须有 host 且一致，否则 403（fail-closed）。** 从前 `host` 缺席时
                    // 整段跳过：`{origin:'http://evil.example'}` 不带 Host 头就能拿到 200（实测）。
                    // 浏览器一定会发 Host，所以这条只是把口径改成一致，不影响本机进程（不带任何头）。
                    var origin = String(hdrs.origin || '');
                    if (origin) {
                        var host = String(hdrs.host || '');
                        if (!host || origin.replace(/^https?:\/\//, '') !== host) {
                            send(403, { ok: false, error: '跨站请求已拒绝（origin 与 host 不一致）' });
                            return;
                        }
                    }
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
        /**
         * 数据目录：设置里的 `dataDir` 优先，否则 `$DSH_HOME` 下的默认值。
         *
         * `readField` 认 volatile 引用（设置页写进去的值就是一个 `{ get() }`），
         * 空串按「没设」处理 —— 表单里清空一个字段写回的正是 `unset`/空值。
         */
        var configuredDir = readField(config, 'dataDir');
        var dataDir = (typeof configuredDir === 'string' && configuredDir !== '') ? configuredDir : DEFAULT_DATA_DIR;
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
        /**
         * 设置改动生效：`dataDir` 是加载期就定下的（图库根、日志落点都建立在它上面），
         * 所以改它必须重载插件 —— 这与「volatile 字段不必重载」是两件事，别混。
         *
         * 这里只记一行日志并明确告诉用户要重启：静默地什么都不做会让人以为设置坏了。
         */
        ctx.on('loader/volatile-update', function () {
            var next = readField(config, 'dataDir');
            var resolved = (typeof next === 'string' && next !== '') ? next : DEFAULT_DATA_DIR;
            if (resolved === dataDir)
                return;
            ctx.logger.warn('arch-canvas: dataDir 已改为 ' + resolved + '，但数据目录在加载期就定了 —— ' +
                '重启 dsh 后生效（当前仍是 ' + dataDir + '）');
        });
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
