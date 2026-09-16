# arch-canvas · 架构画布

人与 AI 共用**同一张 Mermaid 架构图**的 DSH 插件。

用户在右侧栏的画布上直接拖节点、拉连线、改属性；AI 读到的是同一张图的 Mermaid 文本。
用户在图上动一下，AI 下一步就能看见；AI 改一处，用户那边立刻跟着动，**而且能看到它改的是哪几个节点**。

```
        ┌────────── 用户 ──────────┐          ┌─────────── AI ───────────┐
        │  右侧栏「架构画布」面板    │          │  每步注入的上下文里就有图  │
        │  拖拽 / 连线 / 改标签      │          │  arch_read / arch_edit    │
        │  AI 改过的地方会高亮       │          │  改动过的节点会在画布上高亮 │
        └───────────┬──────────────┘          └────────────┬─────────────┘
                    │  doc:set（整个图模型）                │  arch_edit（增量 op）
                    ▼                                      ▼
              ┌──────────────── host 侧唯一真相源 ────────────────┐
              │  图模型 ⇄ Mermaid 文本（parser/serializer）       │
              │  写盘 <项目>/.arch-canvas/<图名>.mmd（每张一个文件）│
              └──────────────────────────────────────────────────┘
```

## 三条设计决定

**1. Mermaid 文本是唯一真相源，图形是它的一种视图。**
不是「渲染 Mermaid 然后去改 SVG」—— 那条路走不通，因为 Mermaid flowchart 不支持手工坐标，
布局引擎每次都会把你的摆放重算一遍。这里反过来：图模型是编辑对象，文本是交换格式。

**2. 「用户摆的坐标」存在 `%%` 注释里。**
```mermaid
%% @pos n1 66 -17
%% @pos n2 -2 144
flowchart TD
  n1["用户界面 (Web GUI)"]
  n1 -->|"输入 / 操作"| n2
```
`@pos` 对 Mermaid 渲染**零影响**，所以这个文件仍然是能直接贴进任何 Markdown、任何支持 Mermaid 的
工具里都能画的**合法 Mermaid**。顺带解决了「AI 重写整张图 → 布局散掉」这个老问题：
`arch_write` 会按节点 id 继承旧坐标，`arch_edit` 更是只碰你指定的那一部分。

**3. AI 优先走增量，而不是整图重画。**
`arch_edit` 收一个 op 列表（`add_node` / `add_edge` / `set_label` / `move_node` / `set_group` /
`set_direction` …），按顺序应用，遇到不存在的节点会在 `problems` 里说明原因而不是静默失败。
只有画初稿或结构性重画才用 `arch_write`。

## 沟通的两条腿

| | 谁看得懂 | 靠什么 |
|---|---|---|
| 图形 | 人 | 自绘 SVG 画布：拖拽、拉连线、改形状/分组、撤销重做 |
| 文本 | AI | 每步注入的 Mermaid 全文 + 三个工具 |

而「AI 改了什么」——光看图变了不够，得知道变在哪。所以：
**AI 动过的节点会在画布上脉动高亮 5 秒**（描边转金 + 一圈扩散的环），
`arch_edit` / `arch_write` 的回执里也会写明「改动过的节点已在用户画布上高亮」。
用户自己的改动不高亮（他自己知道做了什么）。

## 目录

```
src/bootstrap/     Package 的两段引导层（基本不变）
  host.ts            经 eval 从 dist/host.js 加载宿主逻辑
  client.ts          让浏览器 <script> 加载 dist/ui.js
src/host/          宿主逻辑（改这些只需 npm run build）
  mermaid.ts         Mermaid ⇄ 图模型 双向转换（纯函数，可独立测试）
  log.ts             文件日志：按天一个 .log、超过 3 天自动清理、当日写满上限封顶
  document.ts        文档状态、模型规范化、增量 op 应用、坐标继承、改动来源记录
  plugin.ts          提示词上下文、静态资源路由、RPC、四个 AI 工具
src/client/        浏览器界面
  runtime.ts         样式、mermaid 运行时、几何与自动布局、图标、导出
  studio.ts          ArchStudio —— 画布 + 源码视图 + 官方渲染预览 + 撤销重做 + 高亮
  register.ts        registerAll(ctx)：槽位注册，返回卸载函数
src/package/       dsh 插件包的两半（装机形态的入口）
  host.ts            harness 适配 + 一个 POST RPC 路由
  client.ts          __ModuleLoader__ 包装，把 React/styles/rpc 递给界面
lib/               构建产物，入库（tarball 装到没网没 devDeps 的机器上也能直接用）
assets/            mermaid.min.js —— 随包分发的运行时资源
skills/            随包 skill（dsh-skill-filesystem 按目录名自动发现）
.arch-canvas/      项目自己的框架图（这张画的就是插件本身），随仓库提交，测试钉着它
test/
  mermaid.test.cjs   解析/序列化往返（幂等、坐标、@link、本仓库的框架图）—— 读 dist/mermaid.js
  host.e2e.mjs       在 vm 里用桩服务端到端跑宿主逻辑（种子、RPC、工具、改动来源、落盘、扫描、按路径打开）
  host-loader.e2e.mjs 引导层本身：能不能正确加载磁盘上的真身、路径不对会不会吵
  plugin-mount.e2e.mjs 装机形态（lib/index.js）挂载：注册数、console 零输出、周期扫描定时器
  ui.render.mjs      界面真渲染（jsdom + React）：工具条、起始页、选择器、按路径打开、左下角开关
  tools.schema.mjs   拿 DSH 自己的 sandboxDefineTool 校验四个工具的 schema
tools/build.mjs      拼接 src → dist 与 lib
dist/                构建产物（不入库）
```

`src/host/*` 与 `src/client/*` 是**被拼接成一段函数体的分片**，不是模块：文件名不带编号，
拼接顺序由 `tools/build.mjs` 的 `HOST_PARTS` / `UI_PARTS` 显式声明（顺序写在一处，
改顺序不用重命名文件）。所以它们里不能出现 `import` / `export`。

## 构建与测试

```sh
npm run build     # 产出 dist/{host,ui,bootstrap-host,bootstrap-client}.js + payload.json
npm test          # 构建 + 解析器 + 宿主端到端 + 引导层 + 装机挂载 + 界面真渲染
npm run check     # 上面全部 + 工具 schema 校验（改完必须过这一关）
```

当前基线：**解析器 95 · 宿主 245 · 引导层 20 · 插件挂载 10 · 界面渲染 43 · 工具 schema 全通过**。
宿主那一半里包含日志落盘与 3 天保留、并发切库不互相覆盖、落盘失败回滚、畸形 op 被拒、
图库改名 / 软删除 / 恢复、**自动扫描（含指纹与 `libraryRev`）与按路径打开外部文件**、
以及「外层必须递 dataDir」的断言。界面那一半（`test/ui.render.mjs`）用 jsdom + React
把 `lib/ui.js` 真渲染出来点一遍 —— 在没有浏览器可看的情况下，这是「按钮在不在、点了有没有反应」
唯一的验证手段（它当场抓出过一次 `var` 提升导致的渲染崩溃）。

## 加载方式（为什么改代码不用重新定义插件）

**交付形态是真插件**（`lib/index.js` + `lib/client.js` + `lib/host-logic.js` + `lib/ui.js`
+ `assets/mermaid.min.js`）。下面这段讲的是**早期动态 Cordis Package 形态**的加载技巧 ——
它现在只作为「不装包也能在会话里跑起来」的开发/演示路径保留，装机分发一律走真插件。

动态 Cordis Package 一旦定义就不可变，改一行都要重新 define。所以这里把**易变的部分全放到磁盘上**，
Package 里只留两段不怎么会变的引导层（合计 151 行）：

| 产物 | 是什么 | 谁加载它 |
|---|---|---|
| `dist/host.js` | 宿主逻辑真身 | `bootstrap/host.js` 读盘后用 `eval` 包成工厂调用 |
| `dist/ui.js` | 界面真身 | 浏览器 `<script src="/arch-canvas/ui.js">`（host 现读现发） |
| `dist/bootstrap-host.js` | Package 的 `code.host` | Cordis |
| `dist/bootstrap-client.js` | Package 的 `code.client` | Cordis |

于是：**改 host 或改界面都只要 `npm run build`**，界面还可能只刷个页面就行。
只有动到引导层本身才需要重新 define。

两边的加载手段不同，原因在沙箱能力：client 没有 `import` 但有 `document`（走 `<script>`）；
host 没有 `import` 但有 `eval`（走工厂函数 —— 宿主逻辑顶层带 `return`，不能直接 eval）。

代价摊开说：真身不在 Package 里，所以 `cordis_inspect_self` 看到的是壳；
要审阅真正的逻辑请看 `dist/host.js` / `dist/ui.js`。另外 `dist/ui.js` 是运行时读盘的，
**项目目录被移走界面就没了**（host 会返回 404 并提示去 build）。

## 图库与图引用

图库**跟着项目走**：每个项目目录下有一个 `.arch-canvas/`，里面每张图一个 `.mmd` 文件。
项目路径来自会话的 cwd：AI 工具侧用 `exec.agent.cwd`，界面侧从 DSH 的
`sidebar.right.pane.tab` 槽位注入的 `useSessions` 取 `sessionId` 的 cwd
（`src/client/register.ts`），两端都带 `where` 交给宿主解析 —— 于是**人和 AI 落在同一个项目图库**。
识别不出 cwd 就回退全局图库 `~/.dsh/arch-canvas/`，并且提示词里会写明当前用的是哪个。

**本仓库自己就有一张**：`my/arch-canvas/.arch-canvas/architecture.mmd` —— 这张图画的就是
arch-canvas 的框架本身（client / host / AI 三侧、四个不变式、引导层与真身的关系）。
它随仓库提交，是被 `npm run check` 钉住的活文档（解析、坐标、往返幂等都有断言），
不是一次性截图。用 Mermaid 渲染器直接打开即可看。

> 界面的入口是画布工具条上的「图库」按钮：列出当前项目图库里的图（key、节点/连线数），点一条就切过去；
> 每条后面有「改名」「删除」（删除要再点一次「确认删除」），底部「已删除」区里可以「恢复」；
> 输入框可以新建（名字可以是 `子项目/图名`）。切图时撤销历史会清空 —— 跨图的撤销会把上一张图
> 的内容写进当前图，那是数据损坏而不是撤销。

**存储是平铺的，嵌套只体现在浏览视图里。** 宿主会**自动扫描**项目里所有 `.arch-canvas` 目录
（跳过 `node_modules` / `.git` / `target` / `dist` 与隐藏目录，深度 5、图库上限 200、散落文件上限 200），
把每个图库里的图合成一份清单；清单里的 key 就是「相对项目根的路径 + 图名」。所以
「`my/` 能看到 `my/arch-canvas/` 的图」不需要谁去建目录层级 —— 有没有子图库，完全由
「你在那儿画过图没有」决定。

自动扫描的节奏是有讲究的，因为**不能在大仓库里每次轮询都遍历全树**：

| 触发 | 行为 |
|---|---|
| 扫描本身 | 只**走目录**（不读文件内容），所以几秒一次也不贵 |
| 指纹 | 目录 + 文件名 + 大小拼成一个指纹；**指纹没变就到此为止**，不解析任何文件 |
| 指纹变了 | 才去读文件、算节点/连线数，并 `libraryRev++` |
| 谁在驱动 | 面板每 2.5s 轮询 `doc:rev`（受 8s 的 TTL 节流）+ 宿主每 20s 一次的定时器（强制扫，面板关着也扫） |
| 界面反应 | `doc:rev` 带回 `libraryRev`：变了就自动刷新选择器，**不用人重新打开** |
| 手动 | 选择器里的「重新扫描」（`doc:list { rescan: true }`）忽略 TTL 立刻扫 |

**项目里散落的 mermaid 文件也能打开。** 同一次扫描顺手收下 `*.mmd` / `*.mermaid`（`node_modules`
等照样跳过），列在选择器下半部分；点一条就是**按路径打开**这个文件 —— 之后拖拽/改属性落盘写回的就是
它本身。也可以在选择器底部直接填路径（绝对路径，或相对项目根）打开/新建。
`*.md` 里的 ```mermaid 代码块**不扫**：那需要精确定位并回写文档里的某一个代码块，语义与风险都不是
「打开一个文件」这一档。

**图引用一律用「相对项目根的 key」**，只此一条规则（按路径打开的外部文件例外：它的「key」就是路径）：

| key | 含义 |
|---|---|
| `架构` | 根图库里的 `架构.mmd` |
| `支付/对账` | 子项目 `支付` 的图库里的 `对账.mmd` |

`doc:open` / `arch_switch` / `arch_read` 的 `diagram` / `set_link` 的 `link` 都用这个写法。
节点上的 `%% @link <节点id> <key>` 就是**下钻**：这个节点展开就是那张图 —— 这是「一个节点展开成一张图」
的自然写法，比目录层级更贴合「思考时放大/缩小」的关系。画布上带 `@link` 的节点右上角有一个 `↗` 角标，
点它直接跳到那张图。

**删除是软删除**：文件顶部写一行 `%% @deleted`，图库选择器里不列它（在「已删除」区可一键恢复），
**文件和内容永不丢**。（`fs` 服务没有 unlink/rename，而为了删两个文件给插件开 bash 权限不成比例。）
改名 = 新建 + 旧名软删，且不能跨图库；界面上的「改名 / 删除 / 恢复」都接在图库选择器里。

## 与 AI 的接口

| 通道 | 内容 |
|---|---|
| 每步注入 | `systemPrompt.context` 把当前 Mermaid 全文塞进模型上下文 |
| `arch_read` | 读当前图源码（通常不必调，上下文里已有） |
| `arch_edit` | 增量改图，**推荐**；不破坏用户布局 |
| `arch_switch` | 切到另一张图（用户画布跟着切）；不存在时报错并列出可选 key |
| `arch_write` | 整图替换；会继承同 id 节点的旧坐标 |

## Client ↔ Host 私有 RPC

| 方法 | 用途 |
|---|---|
| `doc:get` | 取图模型 + Mermaid 文本 + 元信息 + `lastChange`（外部文件时带 `external`） |
| `doc:rev` | 只取修订号 + `libraryRev`（面板 2.5s 轮询用，变了才拉全量）；顺带按 TTL 重扫图库 |
| `doc:set` | 用户改图：整份图模型回写 |
| `doc:applyText` | 用户直接改源码后重建画布 |
| `doc:file` | 手动落盘 |
| `doc:list` | 图库清单（`items`）+ 项目里散落的 mermaid 文件（`files`）+ `libraryRev`；`rescan: true` 忽略 TTL 立刻重扫 |
| `doc:open` | 按 key 打开图库里的图（可跨子项目），并把「当前层」切过去 |
| `doc:openPath` | **按路径打开**项目里任意一个 `.mmd` / `.mermaid`（相对项目根或绝对路径；`create: true` 可新建） |
| `doc:rename` / `doc:delete` / `doc:restore` | 改名 / 软删除 / 恢复 |
| `mermaid:info` | 拿本地 mermaid bundle 的路由（失败回退 CDN） |
| `ui:info` | 拿界面脚本的路由（引导层用它决定去哪加载） |

`lastChange` 的语义：`{ by: 'ai' \| 'user' \| 'init', rev, nodes: [节点 id] }`，
`nodes` 是「相对上一次状态，新增或任何字段变了的节点」。界面只在 `by === 'ai'` 且非空时高亮。

## 导出

画布工具条上的 `SVG` / `PNG` / `复制源码`：
导出会生成一张**白底墨线**的独立 SVG（不依赖主题变量，可直接贴进文档），
内容按所有节点与分组框的包围盒裁剪，自动排除选中手柄、连线预览、高亮环这些临时元素。
PNG 是 2 倍图。

## 日志与排查

这个插件**对 console 一字不吐**（挂载播报会变成一屏噪音，故障一律抛错），
所以它把现场写进文件：`~/.dsh/arch-canvas/logs/arch-canvas-YYYY-MM-DD.log`
（数据目录本身跟着 dsh 的约定走：`$DSH_HOME`，没设才是 `~/.dsh`）。

- 一行一个 JSON 对象：`{"t":"2026-09-16T01:22:03.481Z","lvl":"info","ev":"plugin.mount","tools":"...","toolCount":4,...}`
  —— 能直接 `grep`，字段里带换行也不会把格式撑破。
- **按天分文件、超过 3 天自动清理**。清理挂在「当天第一次写日志」上（跨天自然触发），
  不依赖定时器，也就没有随插件卸载泄漏的钩子。
- 记什么：`plugin.mount`（挂上了没、注册了几个工具/路由）、`doc.load` / `doc.switch`（打开了哪张图、多少节点）、
  `tool.arch_edit` / `tool.arch_write`（AI 改了什么、几个 op 没生效）、`tool.reject`（入参被拒）、
  `rpc.fail`（某个私有 RPC 抛错）、`persist.fail`（落盘失败并已回滚）、`doc.warnings`（解析告警）、
  `log.retention`（这次清掉了几个旧文件）。轮询这类高频成功路径**不记**，免得把日志变成噪音。
- 当日文件写满 8 MB 就封顶：写一条 `log.capped` 说明，之后不再写。
  「出故障」时最怕日志自己变成故障。
- 写盘能力由外层按形态注入（`hostEnv.logBackend`）：真插件形态用 `node:fs`
  （真 append、真 unlink）；动态 Package 形态只能用注入的 `fs` 服务 ——
  追加是「读全文再写回」、清理只能清空（`fs` 服务没有 unlink），所以清空过的旧日志不再出现在 `list` 里。
  没有后端就整个不写：日志坏掉绝不能把插件带崩。
- 排查顺序：先看当天这份 `.log` 的尾部（挂载与最近一次 AI 改动就在末尾）；
  `persist.fail` 出现说明磁盘没写进去，而那一版改动**已经回滚**，内存与磁盘仍是一致的。

## 已知短板

- **连线会重叠**：边到边画贝塞尔，没有正交路由；同一源发出的多条线会挤在一起。
- **自动布局只是起点**：简单分层，交叉多了不如 dagre。
- **撤销历史只在内存里**：关掉面板标签就没了（上限 60 步），切图时按设计清空。
- **只有节点会高亮**：新增/删除的连线不参与高亮。
- **自动扫描不看 `.md`**：`README.md` / `docs/*.md` 里的 ```mermaid 代码块不会被发现，也不会被打开
  （只认 `.mmd` / `.mermaid`）。要编辑文档里的图，先把那一块另存成 `.mmd`。

## 安装与开发循环

`arch-canvas` 是标准的 dsh 插件包（`package.json` 声明 `dsh.bundle.patch` 与 `dsh.client`），
所以用 `dsh plugin` 一条命令管理，不需要手改任何 yml：

```sh
dsh plugin --profile web add  /home/vesita/coding/my/arch-canvas   # 装（本机开发用目录）
dsh plugin --profile web add  dist/arch-canvas-0.1.0.tgz           # 装（分发给别人）
dsh plugin --profile web update arch-canvas
dsh plugin --profile web remove arch-canvas
```

它是 `pnpm` 的转发器：在 profile 里跑 pnpm，再**按安装结果**对齐 `dsh.profile.bundles`
（声明了 `dsh.bundle` 的依赖进层，不再声明就出层）。pnpm v11 对目录安装给的是 symlink，
所以本机装进去的就是这份项目：`node_modules/arch-canvas -> /home/vesita/coding/my/arch-canvas`。

### 改代码怎么生效

| 改什么 | 怎么生效 |
|---|---|
| `src/client/*` | `npm run build` → **刷新页面**（host 每次请求都现读 `lib/ui.js`） |
| `src/host/*`、`src/package/*` | `npm run build` → **自动重载**，不用重启 dsh |
| 分发给别人 | `npm pack`（`prepack` 自动 build）→ `dsh plugin add <tgz>` |

自动重载靠随包的 `@deepseek-ai/cordis-plugin-hmr`，本机 profile 的 `cordis.patch.yml`
把默认禁用的那行打开并指向本项目。三个必须照做的点（都实测踩过）：

1. `base` 显式写成项目目录 —— hmr 拿 `root` 当 chokidar 的 cwd 解析，留空会**静默不重载**。
2. `ignored` 排除 `dist/**` —— 构建往 `dist/.tmp` 写几百个文件，事件洪流会把 watcher 冲傻
   （症状：只有第一次改动能重载）。
3. `lib/index.js` 加载 host-logic 前清一次 `require.cache` —— hmr 只重新 import 前者。

配置放 profile 的 patch 层而非插件包：`base` 是本机绝对路径，属于部署事实。

### 怎么确认它真的挂上了

**console 里依然一个字都没有**（`tools/build.mjs` 会在源码出现 `console.*` 时直接构建失败）。
「挂上了没」现在有据可查：当天日志里有一行 `plugin.mount`，带着注册到的工具名、路由数与日志目录，
例如 `{"ev":"plugin.mount","toolCount":4,"routeCount":2,...}`。工具注册数不对（期望 4 个）时
`lib/index.js` 会直接抛错，同时日志里也能看到实际数字。

要看注册结果也可以数：4 个工具（`arch_read/arch_switch/arch_write/arch_edit`）、
3 条路由、1 条提示词上下文。守门人是 `test/plugin-mount.e2e.mjs`（真插件形态，并断言挂载过程零 console 输出）
与 `test/host-loader.e2e.mjs`（引导层形态，路径不对时以拒绝收场）。

`tools/build.mjs` 里还有一条结构性断言：源码里一旦出现 `console.log/error/warn/…` 调用，构建直接失败。

两个已修的坑：

- **`ctx.get('tools')` 取快照**：装机后拿到 `undefined`，插件挂上了但工具和路由都没注册。
  现在硬依赖走 `inject: ['fs','tools','systemPrompt']`；`webServer` 不进 inject
  （headless 形态没有它），改用 `ctx.inject(['webServer'], …)` 注册路由。
- **包内资源写死项目目录**：`assets/mermaid.min.js` 与 `lib/ui.js` 改为按包自身定位
  （`__dirname`），tarball 装到别的机器上界面与渲染都在。
