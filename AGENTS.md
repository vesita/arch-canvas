# arch-canvas 项目纪律

## 改完必须跑

```sh
npm run check
```

`src/` 下任何改动都要过这一关再谈「做完了」。解析器是这项目的命门：
用户摆的坐标和 AI 的增量修改都压在它身上，往返一旦不幂等，图就会在「用户改 → 落盘 → AI 读」
这条链路上悄悄漂移，而且**不会报错**。

## TypeScript（2026-09 迁移）

源码是 `.ts`，由 `tools/build.mjs` 先跑 `tsc` 再拼接。三条约束来自这套「拼接 + 整体求值」的架构，**不是风格偏好**：

1. **`src/host/*` 与 `src/client/*` 必须分成两个 tsc 程序**（`tsconfig.host.json` / `tsconfig.client.json`）。
   它们运行时本就是两个独立作用域；放进同一个程序会因 `msgOf` 之类重名而 `Duplicate identifier`。
2. **这些文件里绝对不能出现 `import` / `export`** —— 一旦出现就变成模块，拼接与整体求值都不成立。
   跨文件共享靠同一段作用域；`ctx` / `harness` / `React` / `host` / `styles` 这些外部能力
   由 `types/sandbox.d.ts` 声明（它们的真实来源是构建期包装或沙箱注入，**不是** import）。
3. **片段里不能有顶层 `return`**（TS 报 TS1108）。`src/bootstrap/*.ts` 因此结尾写
   `var __plugin = {...}`，那个 `return` 由 `tools/build.mjs` 拼接时补上。
   这不是权宜之计：这两个文件的内容本来就是「函数体」，只是换了个地方长出 return 来。

另外两个踩过的坑：
- **同一个 tsc 程序里的顶层名字不能撞。** `tsconfig.host.json` 同时收了 `src/host/**`、
  `src/package/host.ts`、`src/bootstrap/host.ts` —— 它们**运行时**是两个独立作用域，但**编译期**是同一个程序。
  所以在外面壳里再写一个同名的 `var logBackend` 会直接 `TS2403`（类型不一致）。
  给壳里的东西起个自己的名字（`nodeLogBackend` / `fsLogBackend`）。
- **TS 7 移除了 `module: "none"`**，而 `--outFile` 只支持 `amd`/`system`。所以构建不用 `--outFile` 拼接，
  改成 `tsc --outDir` 各文件产出（无 import/export 的文件仍是 global script），再由脚本按序拼。
- `var CSS` 撞 `lib.dom` 的全局 `CSS` —— 已改名 `STUDIO_CSS`。`types/sandbox.d.ts` 里也**不要**重复声明
  `window` / `document` / `fetch` 这些 `lib.dom` 已有的东西；要给窗口挂字段就用接口合并。

## 四个不能破的约定

1. **分片不能 import。** `src/host/*.js` 和 `src/client/*.js` 各自是一段会被沙箱求值的函数体，
   没有模块系统。要复用就靠拼接顺序 + 函数声明提升，别写 `import` / `require`。
2. **`%% @pos` 是坐标的唯一载体。** 坐标只写在注释里，图体里没有第二个地方存布局。
   注释指向图里不存在的节点时**直接丢弃**（不许凭注释把节点复活），不然删掉节点后图会被注释拽回来。
3. **host 的分片是 `apply(ctx)` 的函数体，client 的分片自带 `return {...}`。**
   两者包装方式不同（见 `tools/build.mjs`），别把 host 的分片写成自带 return。
4. **工具的 `parameters` 必须是规范 JSON Schema**：根 `type: 'object'` + `properties`（`required` 写在这一层
   的数组里），**不能**写「裸属性表」`{ key: schema }`。
   这条坑过一次（2026-09-16，Antigravity 端点）：宿主动态 Package 那半边走沙箱 `harness.defineTool`，
   它会替裸属性表补上 `type: 'object'`，所以照着沙箱调出来的形状**看着是通的**；装机形态走
   `lib/index.js` 的 `ctx.tools.register(def)`，**原样**送出去 —— 于是每次请求都是 400：
   `Unknown name "ops" at 'request.tools[0].function_declarations[0].parameters'`、
   `Invalid schema for function 'arch_edit': ... got 'type: null'`。
   守门人是 `test/tools.schema.mjs`：它不抄定义，直接抓构建产物注册的那四个真定义，
   用 dsh 自己的 `assertObjectJsonSchema` 过一遍，**同时**再过一遍沙箱 `defineTool`（两条加载路都要活）。

## 改动生效路径（重要：不知道这条会以为是 bug）

| 改了什么 | 怎么让它生效 |
|---|---|
| `src/client/*` | `npm run build` → **刷新页面**（host 每次请求都现读 `lib/ui.js`） |
| `src/host/*`、`src/package/*` | `npm run build` → **自动重载**（hmr 盯着 `lib/index.js`） |
| `src/bootstrap/*` | 同上（它是动态 Package 形态的引导层，装机路径不经过它） |

交付形态是**真插件包**，用 `dsh plugin --profile web add <本目录>` 装。hmr 的两条硬约束
（原话在 `~/.dsh/profiles/web/cordis.patch.yml`）：`base` 必须显式写项目目录，否则 `root`
解析错、**静默不重载**；`ignored` 必须排除 `dist/**`，否则构建的事件洪流会把 watcher 冲傻，
症状是「只有第一次重载生效」。

不打开 hmr 时的退路：`src/host/*` / `src/package/*` 的改动要**重启 dsh**；
动态 Package 形态（`src/bootstrap/*`）要重新 `cordis_define` + `cordis_run`。

**这个插件对 console 一字不吐。** 正常挂载完全安静（早先成功时打过一行
`[arch-canvas] 已挂载：4 个 AI 工具（…），3 条路由`，但 hmr 每次 `npm run build` 都会重新挂一遍，
一行变一屏），故障一律 **抛错**：`apply` 抛出去，由宿主（cordis / 浏览器）用自己的格式报 ——
既不静默，也不占输出。所以「挂上了没」靠数注册结果（4 工具 / 3 路由 / 1 提示词上下文），
不靠看 console；`tools/build.mjs` 会在源码出现 `console.*` 调用时直接构建失败，
`test/plugin-mount.e2e.mjs`（真插件形态）连挂载过程的零输出一起断言。

**现场一律写进日志文件**（`src/host/log.ts`，`~/.dsh/arch-canvas/logs/arch-canvas-YYYY-MM-DD.log`，
按天分文件、超过 3 天自动清理）：挂载、打开了哪张图、AI 每次改图、入参被拒、RPC 抛错、落盘失败并回滚。
所以新增一条故障路径时，顺手 `logEvent('error', '<事件名>', {...})` —— 不写日志的故障，
在这个插件里等于匿名。轮询之类的高频成功路径**不要**记，别把日志变成噪音。

## 服务时序：一律 inject，不要 ctx.get 取快照

**这是本仓库最贵的一课**（2026-09 装机实测）：

```js
// ✗ 装机后 tools 是 undefined —— 插件挂上了，工具和路由却一个都没注册，只在日志里喊两声
var tools = ctx.get('tools')

// ✓ park 到服务齐了才 apply
module.exports = { name, inject: ['fs', 'tools', 'systemPrompt'], apply }
```

哪个服务何时可用由 Cordis 按**可用性**决定，行顺序不承载加载语义
（`dsh-base/cordis.patch.yml` 开头就写着这句）。`ctx.get` 是同步快照，服务晚一步就是静默失败。

`webServer` 是例外：它只在 web 形态里存在，进了 `inject` 会让插件在 headless/acp 里永远 park。
所以它走 `ctx.inject(['webServer'], webCtx => …)`，在里面注册路由 ——
**没有界面时 AI 工具与提示词上下文照常可用**。同理，`harness.route` 只**登记**路由，
真正 `webServer.register` 由外层在服务就绪后做。

`timer` 也走这条路：周期扫描要它，但**不进 `inject` 声明**（缺席只是不自动扫）。
代价：宿主逻辑用到的 ctx 能力，**测试桩也得提供**。现在 `ctx.inject` 是第四个必须的桩方法
（`get` / `effect` / `on` / `inject`），加一个就要同步补 host.e2e、host-loader、plugin-mount、
tools.schema 四个文件里的桩 —— 2026-09 加定时器时整整踩了三处，`npm run check` 才把它们逐个点出来。

客户端的 `exports.inject` 同理：只列 `slots / sidebarRightTabs / layout`，
**不列 `timer`** —— 没有它界面靠 `ctxTimeout/ctxInterval` 回退到原生定时器
（`src/client/runtime.ts`），列了而部署里没有就永远 park。

**可选取用的服务必须走 `ctx.get(name)`。** Cordis 对**未 inject** 的服务，直接读属性是**抛错**
（`cannot get property "timer" without inject`），**不是**给 `undefined` —— 所以
`typeof ctx.interval === 'function'` 这种「探测一下有没有」的写法会当场炸，兜底分支根本没机会跑。
客户端那个「没有 timer 就退回原生定时器」的兜底就是这么坏掉的：真插件形态的客户端只 inject
`slots / sidebarRightTabs / layout`，于是**装机形态一渲染就崩、面板一片空白**（动态形态 inject 了
`timer`，作者自测时看不见）。规则：**硬依赖走 `inject`，可选取用走 `ctx.get`，拿不到就降级。**
守门人是 `test/ui.render.mjs` 的第 6 节 —— 它专门用一个「直接读属性就抛」的 strict ctx 渲染面板。

## 包内资源与数据目录都不要写死本机路径

`assets/mermaid.min.js`（构建期从 `node_modules/mermaid` 拷进来，随包分发）、`lib/ui.js`
与**数据目录**（全局图库、日志）全部由外层经 `hostEnv` 递进来：

| hostEnv 字段 | 真插件（`lib/index.js`） | 动态形态（`bootstrap/host.ts`） |
|---|---|---|
| `uiFile` / `mermaidFile` | `path.join(__dirname, …)` | `<项目>/dist/ui.js`、`<项目>/assets/…` |
| `dataDir` | `$DSH_HOME`（否则 `~/.dsh`）+ `/arch-canvas` | 本机字面量（这一层本来就写死项目路径） |
| `logBackend` | `node:fs`：真 append、真 unlink | `fs` 服务：读全文写回、清理=清空 |

`dataDir` 缺失时宿主逻辑**直接抛错**（`src/host/document.ts` 开头）：它不是可选项，
没它连全局图库与日志该写哪都不知道。宿主逻辑里出现任何 `/home/<某人>` 都是 bug ——
写死就只在装机那一台能用（2026-09 从 `HOME` / `PROJECT_DIR` 两个常量上清掉过）。

## Package 里只应该有引导层

两半都必须是薄壳。定义时：

> `code.host` 取 `dist/bootstrap-host.js` 的原文，`code.client` 取 `dist/bootstrap-client.js` 的原文。

**不要把 `dist/host.js` 或 `dist/ui.js` 塞进 Package** —— 那就退回了「改一行重发上千行」。
`tools/build.mjs` 里有结构性断言守着：bootstrap 里一旦出现 `harness.defineTool`
或 `function ArchStudio`，构建直接失败。

### 这条规矩是怎么来的

2026-09 两次 `host-half-failed: ctx is not defined`，同一个原因：
`src/host/*.js` 的分片是 **`apply(ctx)` 的函数体**，而 `code.host` 必须是
**`return { apply(ctx) { ... } }`** —— 包装由 `tools/build.mjs` 加。
凭记忆从 src 手抄就会漏掉包装，`ctx` 成为顶层未定义变量，整个 host 半边加载失败。

现在引导层把这件事绕开了，但规则本身仍成立：**取构建产物，不要手抄。**
守门人是 `test/host-loader.e2e.mjs` —— 它专门验「薄壳能不能正确加载磁盘上的真身、
路径不对会不会吵」。

## 沙箱里没有的东西（只对**动态 Package 形态**成立）

- host 半边：没有 `process` / `Buffer` / `fetch` / `require` / `fs`。
  服务取用见上面「服务时序」——**要 inject，不要 `ctx.get` 取快照**；
  副作用一律 `ctx.effect(...)` 包住（否则卸载时泄漏）。
- client 半边：`setTimeout` / `setInterval` / `fetch` / `require` **被 trap 掉了**，
  用了会直接抛错。所以界面里的定时器一律走 `ctxTimeout` / `ctxInterval`
  （`src/client/runtime.ts`）：有 `timer` 服务就用它，没有就回退原生 —— 动态形态下
  必须声明 `inject: ['timer']`，真插件形态刻意不声明。
  `document` / `window` / `React` / `styles` / `host` 是可用的。

## 客户端界面：没有浏览器怎么看

`test/ui.render.mjs` 拿 jsdom + React 把 `lib/ui.js` **真渲染出来点一遍**：工具条按钮、起始页、
选择器、按路径打开、左下角开关。两条必须照做的规矩：

1. **DOM 必须在 `import('react-dom/client')` 之前就位。** react-dom 在**模块求值期**就用
   `window` / `document` 探测能力；晚一步它就会认为环境不支持 input 事件，改走 IE 时代的
   `propertychange` 分支 —— 症状是 `onChange` 永不触发、`focusin` 直接抛
   `attachEvent is not a function`。所以那个测试里 React 走的是动态 import。
2. **`stage` 这类 JSX 在 `return` 之前就构造好了**，它用到的派生值必须声明在**那之前**。
   把 `var libItems = …` 写在 `return` 前几行看着没问题，实际会被 `var` 提升成 `undefined`，
   整个面板渲染崩溃 —— 表现就是「打开画布一片空白」。这条被 `ui.render.mjs` 当场抓到过一次。

改面板结构时先跑它；它断言的是按钮文案与 DOM 结构（用户看得见的那层契约）。

## 目录含义

- `src/host/mermaid.ts` —— 纯函数，不碰服务不碰状态。测试的第一道防线在这里。
- `src/host/log.ts` —— 文件日志与保留期。写盘能力由 `hostEnv.logBackend` 从外层注入
  （真插件 `node:fs`，动态形态 `fs` 服务），这里只认接口。
- `src/host/document.ts` —— 状态与 op 应用。新增 op 类型要同时改 plugin.ts 的工具 schema 和这里。
  所有加载/切库都排 `loadQueue` 这一条队列：并发进两个项目图库时，谁也不能覆盖谁的 `lib`。
  **自动扫描**（`scanProject` / `walkProject` / `refreshLibrary`）只走目录 + 比指纹；指纹没变就不读
  文件、不解析。`libraryRev` 是给界面的「清单变了」信号。TTL 只挡「2.5s 轮询」这条高频路，
  定时器与 `doc:list {rescan:true}` 走强制扫 —— 把 TTL 也加到定时器上，自动扫描就等于没有。
  **外部文件**（`doc.external`）是按路径打开的 `.mmd` / `.mermaid`：不属于任何图库，
  `ensureLoaded` 里那道「有 external 就直接返回」的闸不能拆 —— 拆了界面轮询就把它冲回图库的图；
  它的「key」就是路径，落盘写回原文件。
- `src/host/plugin.ts` —— 对外接口面。改工具描述等于改 AI 的行为，要慎重。
  RPC 与工具注册统一走 `onRpc` / `onTool` / `onRoute`，现场记录就挂在那一层。
- `src/client/studio.ts` —— 编辑历史的关键是 `committedRef`：
  **不能拿拖拽中的 `modelRef.current` 当「拖之前的状态」**，它每个 pointermove 都在变。

拼接顺序由 `tools/build.mjs` 的 `HOST_PARTS` / `UI_PARTS` 声明 —— 文件名不带编号，
**改顺序只改那两处**，别用文件名暗示顺序。

## 与主会话协作

改图数据的默认位置是 `~/.dsh/arch-canvas/architecture.mmd`；
插件重启后 `revision` 从 0 重算（修订号只在内存里），但坐标从文件恢复。
排查「图不对」时先看这个文件，它比内存状态可信。
