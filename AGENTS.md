# arch-canvas 项目纪律

## 改完必须跑

`src/` 下任何改动都要过 `npm run check`。解析器是这项目的命门：往返一旦不幂等，图会在「用户改 → 落盘 → AI 读」这条链路上悄悄漂移，**不报错**。

## 写盘前的往返守恒检查

`persist()` 每次落盘前跑 `roundTripDetail(doc)`（`src/host/mermaid.ts`）：**`parse(serialize(doc))` 必须在所有会被持久化的字段上与
`doc` 一致**；不一致就记 `serialize.not-idempotent`（带**差在哪个节点的哪个字段**）+ 面板挂一条警告，**照旧写盘** —— 拒绝保存比丢字段更糟。

三条**排除项**（写错任何一条，每次保存都误报，等于没用）：

1. **不进文件的运行期字段** —— 权威名单是代码里的 `RUNTIME_ONLY_FIELDS`（含 `drift` / `workspace`）。
2. **旁路表承载的字段**：`note` / `noteDone` 存在 `notes.json` 里，不由这份文本承载。
3. **派生字段与集合顺序**：边的 `id` 每次解析重新编号、不进文件；节点/边/组的**顺序**（`serializeDoc` 会重排），所以按 key 排序后**按集合比**。

守门人：`test/mermaid.test.cjs`【往返守恒检查：安静时真安静，出问题时真会喊】、【空组必须写进文件】；`test/host.e2e.mjs`【写盘前的往返守恒检查：整套测试跑下来一次都不该报】。

## TypeScript

源码是 `.ts`，由 `tools/build.mjs` 先跑 `tsc` 再拼接。三条约束：

1. **`src/host/*` 与 `src/client/*` 必须分成两个 tsc 程序**（`tsconfig.host.json` / `tsconfig.client.json`）：同一个程序会因
   `msgOf` 之类重名而 `Duplicate identifier`。
2. **这些文件里绝对不能出现 `import` / `export`** —— 一旦出现就变成模块，拼接与整体求值都不成立；跨文件共享靠同一段作用域，`ctx` / `harness` / `React` /
   `host` / `styles` 由 `types/sandbox.d.ts` 声明。
3. **片段里不能有顶层 `return`**（TS1108）；`src/bootstrap/*.ts` 结尾写 `var __plugin = {...}`，那个 `return` 由构建补上。

另有四条：**同一个 tsc 程序里的顶层名字不能撞**（`tsconfig.host.json` 同时收
`src/host/**`、`src/package/host.ts`、`src/bootstrap/host.ts`），外壳里写同名的 `var logBackend` 会 `TS2403`；**构建走
`tsc --outDir` 各文件产出**（TS 7 没有 `module: "none"`，`--outFile` 只支持 `amd`/`system`），无 import/export 的文件仍是
global script，再按序拼；全局 `CSS` 与 `lib.dom` 的 `CSS` 撞名，样式常量叫 `STUDIO_CSS`；`types/sandbox.d.ts` 里**不要**重复声明
`window` / `document` / `fetch`，给窗口挂字段用接口合并。

**`types/sandbox.d.ts` 对 `src/host/*` 也声明了 Node 全局**（`process` / `require` / `Buffer` /
`__dirname`），那半边能过类型检查、运行时却没有它们；只能靠 `tools/build.mjs` 的构建期守门（`src/host/*` 里出现就构建失败 ——
判据是**标识符**，`process['env']` 这种写法同样挡；注释不算）。

**新功能一律用 TypeScript 写**（`src/` 下不新增 `.js` 源文件），除非明确决定引入 Rust。天花板**不在 CPU**：宿主每步注入整份源码，节点一多就先撞 token 墙。动态
Package 形态下 `code.host` 是**源码字符串**，wasm 塞不进去；真要 Rust，正确的形状是把解析器 / 校验抽成独立模块。

## 四个不能破的约定

1. **分片不能 import**：`src/host/*` 和 `src/client/*` 各是一段被沙箱求值的函数体，没有模块系统；复用靠拼接顺序 + 函数声明提升。
2. **`%% @pos` 是坐标的唯一载体**：坐标只写在注释里，图体里没有第二个地方存布局；注释指向图里不存在的节点时**直接丢弃**（不许凭注释把节点复活）。**组 id 和节点 id
   一样不能含空格**：`scanNodeRef` 的 `ID_RE` 遇到空格就停，`subgraph AI 端["AI 端"]` 会被解析成 id=`AI` + 标签=`端["AI 端"]`；走
   `set_group` 不会踩（它过 `cleanId`）。**`set_label` 里的换行要传真实换行符**：`q()` 先转义 `&` / `#` / `<`，最后才把换行写成 `<br/>`。
3. **分片里不能有顶层 `return`**：`src/host/*` 是 `apply(ctx)` 的函数体，`src/client/*` 被拼进一个 IIFE（`UI_PARTS`），两者都不自带
   `return`；`return {...}` 只由 `src/bootstrap/*` 写。分片清单与顺序由 `tools/build.mjs` 的 `HOST_PARTS` / `UI_PARTS`
   声明。
4. **工具的 `parameters` 必须是规范 JSON Schema**：根 `type: 'object'` + `properties`（`required`
   写在这一层的数组里），**不能**写「裸属性表」`{ key: schema }`。沙箱 `harness.defineTool` 会替裸属性表补上 `type:
   'object'`（看着是通的），装机形态走 `lib/index.js` 的 `ctx.tools.register(def)` **原样**送出，于是每次请求 400。守门人
   `test/tools.schema.mjs`：抓构建产物注册的那四个真定义，用 dsh 自己的 `assertObjectJsonSchema` 过一遍，**同时**再过一遍沙箱
   `defineTool`。

## 解析器的两条真相

1. **`ARROWS` 是连接符的唯一真相。** `ARROW_SET` 必须**从它派生**（`document.ts` 里那个由 `ARROWS` 填出来的循环），不许手抄第二份列表 ——
   手抄那次漂了 20 种，`--o` / `o==>` 这类端点连接符会被归一静默降级成 `-->`，而检查发生在归一**之后**，所以零警告。
2. **判据是真 `mermaid.parse()`**，不是「我们自己能读回来」。由此三条不许破：
   - **id 归一**：① 不许静默合并 —— `a-b` / `a.b` / `a/b` 归一后撞名时，后来者加**稳定后缀**并**出声**，两条都活下来；
     ② 不许放行 emoji / 代理对码元（真 Mermaid 报 Lexical error；**只剔 id，label 里的 emoji 合法**）；
     ③ 不许把「关键字 + 非 ASCII 后缀」（`end中`、`link中`、`call`）判成指令行 —— 判据是「**关键字后面不能再是 id 字符**」，
     且 `call` / `href` 这类 Mermaid 认的关键字也要在表里。
   - **`%% @pos` 的数值闸门**：必须要求**解析后有限**，否则走「没能解析」那条**出声**分支，不许把那行注释静默丢掉
     （`parseFloat('.')` 是 NaN，而 NaN 会让往返检查也瞎）。
   - **重复的组 id**：解析与序列化两侧都按「保留第一条」去重，否则那个组的成员行与 `%% @pos` 会被写两遍（模型一致，往返检查判不出）。

守门人：`test/host.e2e.mjs` 的 P0 / P1 各节（连接符唯一真相 / 指令闸门 / emoji id / 重复组 id / 归一撞名），判据都是真 `mermaid.parse()`。

## 元素上的东西：留言旁路表、`@file`、`@summary`

用户给元素留话、标源码文件，以及给整张图写一句「这张图讲的是什么」——这些都要能进下一步的对话。

1. **对用户一律叫「留言」；代码字段保持 `note` / `noteDone`。** 它是**一次投递**，存与那张 `.mmd` 同目录的 `notes.json` 旁路表：`{ "<图文件名>": {
   "<节点id>": { text, done, at } } }`；源文本里没有留言行，头部 `%%!` 也不写留言模板。
2. **内存里的形状是旁路表的投影**：`note` / `noteDone` 是节点上扁平两个字段，加载时从表灌进节点、落盘时从节点收进表；空文本 = 没有留言。字段名**不能**叫 `notes` ——
   `doc.notes` 已被「AI 改图后的一句话说明」占用（内存态，`doc:get` 后清空）。
3. **留言是一次性消耗的。** `promptText()` 读过那一段清单就算**送达**，随即在内存里把这一批标成已办，此后不再出现在任何上下文里。`done`
   的就是历史：落盘时（`harvestNoteStore`）按 `at` 丢最旧的，只留 `NOTE_HISTORY_MAX` 条；`at` **不在模型上**，所以不用碰 `normalizeModel`
   白名单 / `snapshotModel` / `restoreModel`。**这是读路径上的内存变更**：`promptText` 只改内存、落盘照旧由 `persist()`
   做；送达后一直没人写盘，重启 dsh 会让这批**再送一次** —— 宁可多送一次，也不丢用户写的东西。留言**正文**只由用户写，AI
   只能改状态（`mark_note`）；**要长期挂着的意图不要放留言**。守门人：`test/host.e2e.mjs`【留言历史封顶 6 条】+【提示词注入】的「送达之后同一条不再出现」。
4. **孤儿保留**：留言搬出源文本后不再有「注释把删掉的节点拽回图里」的风险，删掉节点后留言留在表里。
5. **一次性迁移（表优先、正文兜底）**：老文件正文里的老式留言行在加载时读进表（表里已有该节点条目就以表为准），下一次落盘时从文件里剥掉。
6. **写入两道防覆盖闸门**（`src/host/notes.ts`）：`fs.processPath(target)` 必须严格等于预期路径，且文件不存在或能解析成 JSON
   对象才允许写入；任一不过就拒写并记 `notes.save.refused`；加载失败记 `notes.load.fail`。守门人：
   `test/host.e2e.mjs` 的「数据目录是一次性临时目录」断言与 `test/plugin-mount.e2e.mjs` 的「日志写进一次性临时目录」。
7. **客户端发送入口与 `@` 引用源**：清单头部「交给 AI (N)」**一个动作把整批交出去**（框空就替用户写成一条消息再
   `submit()`；框里有字就**原样发他那句**；检查器单节点只填入、不自动发）；**空草稿 + 无附件是 no-op**（DSH 的规矩），所以「空框也能发」由我们补一句话；两条路都走客户端
   `props.inputActions`（`setDraft` / `submit`）—— 宿主半边禁止 import，拿不到 `createUserMessage`；注册 `@`
   引用源（`ctx.inputTriggers.registerSource`，trigger: '@'）走 `ctx.get` 可选获取，chip 由 `codec.serialize(ref)`
   展开；**节点快照按会话分开存**（`studioSnapshots`），**拿不到这个会话的快照就返回空**；`codec.serialize(ref, signal)` **拿不到会话**，解析走
   `resolveLiveNode`，两个会话都有同名节点而活跃的那个没有 → **拒绝展开**。守门人：`test/ui.render.mjs` 第 [4s] 节。
8. **代码锚点 `%% @file <id> <路径>` 是数组，一个节点可多条。** 它回答「中文标签 ↔ 英文路径」这个 grep 不出来的映射，而它会**腐烂**，所以加载/保存后一律
   `verifyFileRefs()` 重算 `doc.fileStatus`（`ok` / `missing` / `symbol-missing` / `unknown`）——
   **一条过期锚点比没有锚点更坏**；判不了根时返回 `unknown`，**不许假装 ok**。结论同时摆到界面（`▤` 角标，失效变红）与提示词（⚠ + 「不要照着用」）。**`%% @file`
   的值不套标签那套实体转义**（写出去用 `qRef()`，不是 `q()`）：这条值在一行注释里、Mermaid 根本不看，写成 `#35;` 只坑**人**；读回仍走 `unquote()`。
9. **一句话总结 `%% @summary` 是图级字段，不挂节点**：必须占**一行**、上限 500 字、规范化只有一处（`cleanSummary()`），解析与 `normalizeModel`
   两条路共用；它进提示词头部（「**这张图讲的是**」），也随图库清单回给界面。**字段整个缺席 ≠ 要清空**：旧界面发来的模型不知道有 `summary`，那是「保留现状」；显式清空走 `summary:
   ''`。
10. **锚点 / 总结都是用户的东西：AI 重画要继承，用户改源码不继承。** 边界在 `inheritUserMarks()`（只被 `arch_write` 调用）：AI 整体重画按节点 id
    留下锚点、图级总结沿用旧句子（新文本自己写了就用新的）；`doc:applyText` **不继承**。留言按节点 id 关联，重画不受影响。
11. **这些走的是读路径，与「谁能改图」无关**：它们是**用户 → AI** 的单向通道；改 `promptText` 时别把「`%%`
    是元数据、不要讨论」那条纪律盖到它们头上。`skills/arch-canvas/SKILL.md` 里同一句话也要跟着改。

**加字段要同时改 `normalizeModel()` 的白名单（`document.ts`）与 `snapshotModel`/`restoreModel`** ——
逐字段重建，漏了就是**用户每保存一次，那个字段被静默清空一次**。

### 文件头的格式说明行一律 `%%!` 前缀

`serializeDoc()` 写出的头部那几行是**给人看的模板**：写出时说明行一律 `%%!`，解析器见到 `%%!` 整行跳过 —— 普通 `%% @xxx`
行会被算成指向不存在节点的元数据，每解析一次就多一条假警告。老文件靠 `LEGACY_TEMPLATE_RE`（`%% @pos|link|note|done|file <...>`）兜住。

「注入的视图」与文件**不逐字相同，差异三处**：`%%!` 行、`%% @pos` 行（纯布局数据，AI 不消费，改坐标走 `move_node`）、`{{` 被拆成 `{
{`。前两处要在提示词里明说「已滤掉、要看原文用 `arch_read`」。

### 提示词模板注入：`{{` 必须在注入前拆开

`systemPrompt.context` 把注册的文本当 `{{变量}}` 模板渲染，**这条通道没有关插值的开关**（只有 section 通道认 `interpolate: false`）。源文本里出现
`{{...}}`（Mermaid 的 **hexagon 形状**就是 `id{{"标签"}}`）而中间那段名字不匹配 `/^[a-z][a-z0-9_]*$/` 就**直接抛错** ——
整条提示词注入失败、插件当场崩，**连会话都起不来**。守卫收口在 `promptSafe()`（`plugin.ts`）：把 `{{` 拆成 `{ {`、循环拆到不动为止，`promptText()` 每个
return 都过它；这是唯一一处**必须改动用户文本**的地方，别在别处再开第二个口子。

守门人是 `test/host.e2e.mjs` 末尾的【提示词模板注入防护】；它真的加一个 hex 节点再删掉，所以**必须放在文件最后** —— 夹在中间会推进修订号，撞坏前面所有「修订号 == N」的断言。

### `promptText()` 只写「状态」，不写「教材」

`promptText()`（`src/host/plugin.ts`）**每一步都注入**，只回答两件事：**当前状态是什么**（哪张图、修订几、谁刚改了什么节点、一句话总结、同图库还有哪些图、未办的留言、锚点校验结果）与**用户要什么**。「工具怎么用、图库怎么组织、`%%`
各字段什么意思」是 `skills/arch-canvas/SKILL.md` 的职责；抄进来就是**两份会各自漂移的真相**。属于「读这份数据」的注意事项只有三条，必须留在 `promptText`
里（紧贴源码块）：图不保证与代码一致、共享画布的边界、`%%`
行是元数据不要当内容讨论。清单类内容里节点名一律取**标题**（`labelTitle()`）。守门人：`test/mermaid.test.cjs` 第 [14]~[17]
节；`test/host.e2e.mjs`【代码锚点 %% @file】【一句话总结 %% @summary】；`test/ui.render.mjs` 第 [4d] 节。

## 锚点保鲜 `drift`：这张图会不会已经过期

`fileStatus`
只回答「文件/符号还在不在」，答不了**函数还在、但已经不是图上说的那个东西了**（改名、职责搬走、参数换掉）。所以给每条锚点存**内容指纹**（`src/host/drift.ts`）：`persist()`
落盘时记基线到 `anchors.json`；`verifyFileRefs()` 末尾算一次 `doc.drift`（派生数据，随每条响应回给界面与提示词）。`stale` =
锚点还解析得到、但内容变过；`uncovered` = 有源码、却没有任何锚点指向的目录（只报最浅那层）。

四条不许破：

1. **没有基线就不猜**：`baseline=false` 时一条 `stale` 都不许报；「算不出指纹」（读不到、超过 1MB）同样不猜 —— 把「未知」说成「过期」，用户三天就学会无视这条信号。
2. **读路径不写盘**：指纹只在 `persist()` 里记；`verifyFileRefs()`（加载 / `doc:get` / `doc:set` / `arch_read` 都走它）只读、只比。
3. **落盘失败不记基线**：写表排在 `.mmd` 写成功之后；失败**只记日志**（`drift.persist.fail`），不挂 `doc.warnings`。
4. **旁路表与留言表共用同一套闸门**：走 `writeSidecarJson()`（notes.ts）—— 路径必须与 `fs.processPath` 一致 + 已有文件必须能解析，否则拒写并记
   `drift.save.refused`；坏表不会被覆盖，坏表之下 `baseline` 永远是 false。

三条实现注意：`drift` **必须留在 `RUNTIME_ONLY_FIELDS`**（漏了就是每次保存都误报
`serialize.not-idempotent`）；**走目录有预算**（`DRIFT_WALK_MAX_DIRS` / `DRIFT_WALK_MAX_FILES` / TTL 20s，走不完记
`truncated`）；**跳过名单**与图库扫描共用 `SKIP_DIRS`，再补 `DRIFT_SKIP_DIRS`（test / fixtures / generated / vendor /
assets / docs…）并跳过 `*.min.*` 与 `*.d.ts`，`lib` / `es` / `cjs` 只在同级真有 `src` 时跳过（`DRIFT_BUILD_DIRS`）。

界面与提示词都是**两档语气**：有 `stale` → 琥珀角标 + 琥珀横幅 + 提示词里「别照着这些锚点走」；只有 `uncovered` → 中性 `.hint` 横幅 +
提示词里「这只是还没画，**不是**图上写错了」。守门人：`test/host.e2e.mjs`【锚点保鲜 drift】，`test/ui.render.mjs` 第 [4t] 节。

## 图库不会自动创建（opt-in）

**读路径一个字节都不创建。** 项目里没有 `.arch-canvas/`（或那张 `.mmd` 不存在）时，`loadInto` 把 `doc` 置成空文档并标记 `doc.absent =
true`，**不 `ensureDir`、不 `inheritGlobalOnce`、不播种默认图**；只有 `doc:open { create: true }` / `arch_switch {
create: true }` 两个显式入口会建（工具侧还要先征得用户同意）。

- `arch_write` / `arch_edit` 在 `doc.absent`
  时**硬拒绝**（错误信息说明「图库不会自动创建」）：**唯一**一道写图闸门。守门人：`test/host.e2e.mjs`【任务 1 守门断言：读路径不建库，写路径防隐式创建】。
- `persist()` 是唯一会把 `absent` 清掉的地方；`snapshotModel`/`restoreModel` 必须带上它，否则「写盘失败回滚」会把空库状态也一起回滚掉。

**继承全局图库只在目标图库还是空的时候发生**（`inheritGlobalOnce`）：判据是「目标图库里有没有活着的图」，不是任何标记文件；逐张复制时**同名一律跳过**，一个字节都不往会话工作区之外写。守门人：`test/host.e2e.mjs`【回归：建新图不许覆盖已有的图】。

## 写盘必须带会话

`fs` 的写入受**按调用沙箱策略**约束；不传策略的调用是 **agentless call**，掉到部署默认（可写根 = `process.cwd()`）—— dsh
从别的项目目录启动时，画布上每一次保存都被拒，而**日志照写不误**（日志走外层注入的 `node:fs`）。**正解不是绕开 `fs`**：

```js
const policy = ctx.sandboxPolicy.resolve({ session })   // 只传 session，绝不传 mode
await fs.writeText(target, body, undefined, undefined, policy)
```

1. **绝不自己传 `mode`**：传 mode 等于声称「一次已批准的显式模式」，会越过会话自己的模式 —— 那是**放大权限**。守门人：`test/host.e2e.mjs` 断言 `resolve`
   入参 `mode === undefined`。
2. **会话从哪来**：AI 工具走 `exec.agent.session`；面板的 RPC 走客户端传上来的 `sessionId` →
   `ctx.get('agents').get(id).session`。
3. **两个服务都走 `ctx.get`**（`sandboxPolicy` / `agents` 都可选，不进 `inject`）；拿不到会话就**不伪造策略**（退回 `undefined`）并落一行
   `sandbox.policy.missing`。
4. **读不传**：`stat` / `readText` / `listDir` 不受围栏，只有 `writeText` / `editText` 收策略。

dsh 侧原文（`dsh-sandbox-policy`）："A session cwd is its workspace-write boundary; the configured root is the
fallback for **agentless calls** and sessions without a cwd."

## 改动生效路径

| 改了什么 | 怎么让它生效 |
|---|---|
| `src/client/*` | `npm run build` → **刷新页面**（host 每次请求都现读 `lib/ui.js`） |
| `src/host/*`、`src/package/*` | 先看部署是**链接**还是**快照**（见下）；最稳的是 build → 重装 → **重启 dsh** |
| `src/bootstrap/*` | 动态 Package 形态：重新 `cordis_define` + `cordis_run` |

**先查部署是哪种安装 —— 这一步决定上面所有结论**：`grep arch-canvas ~/.dsh/profiles/web/package.json`（`file:...tgz` =
快照；`link:...` = 链接），或看 `node_modules/arch-canvas` 是真目录还是符号链接。**`link:` / 符号链接**（`dsh plugin --profile web
add <本目录>`）下 `node_modules` 指向项目目录，`npm run build` 之后文件真的换了 → 能重载，这是**推荐**装法；**`file:...tgz` / 真目录**是 pnpm
复制的**快照**，此后**改仓库对运行态零影响**，换掉已加载进内存的宿主代码**只有重启 dsh**。

**半新的客户端是最危险的**：`lib/ui.js` 是 host 每次请求现读磁盘的，一更新安装目录界面立刻是新的、宿主还在内存里跑旧的；旧宿主的 `normalizeModel`
逐字段重建，会**静默丢掉**新界面发来的字段。上线顺序：`npm run build` → `npm run pack`（落点 `${DSH_HOME:-~/.dsh}/packages/`）→ 装包 →
**重启 dsh**。

**怎么确认真的上线了**：`test/*` 用的是桩 `fs`，「真机上存不下来」它一条都抓不到；对活着的进程打一次真 RPC（`POST
/arch-canvas/rpc`，`doc:get`），挑一个**只有新宿主才会返回**的字段来验。**`plugin.mount` 那一行不能当证据** —— 它可能只是把旧快照重新挂了一遍。

**这个插件对 console 一字不吐**：正常挂载完全安静，故障一律 **抛错**（`apply` 抛出去，由宿主用自己的格式报）；「挂上了没」靠数注册结果（工具 / 路由 /
提示词上下文）—— 路由数是**真实注册数**（1 条 RPC + 2 条静态 = 3），`plugin.mount` 那行现在报的就是这个真数。`tools/build.mjs` 在源码出现
`console.*` 调用时直接构建失败，`test/plugin-mount.e2e.mjs` 连挂载过程的零输出一起断言。

**现场一律写进日志文件**（`src/host/log.ts`，`~/.dsh/arch-canvas/logs/arch-canvas-YYYY-MM-DD.log`，按天分文件、超过 3
天自动清理）：挂载、打开了哪张图、AI 每次改图、入参被拒、RPC 抛错、落盘失败并回滚；轮询之类的高频成功路径**不要**记。级别门槛 `debug` / `info` / `warn` /
`error`，缺省 `info`（`hostEnv.logLevel`）；**重复行**要去重（`plugin.mount` 按挂载形状、`doc.load` 按文件名+内容）。

## 检查点：安全靠「退得回去」，不靠「拦得住」（`src/host/history.ts`）

1. **每次落盘留一份快照，并标明是谁改的。** 收口在 `persist()`（所有写入的唯一出口），标签取 `doc.updatedBy` + `lastChange.nodes` +
   站点（`arch_edit` / `doc:set` / `rollback:<seq>` …）。
2. **「退回」不是撤销，是重放。** `applyRollback(seq)` 把那一份正文重新装进文档并落盘，再在末尾**追加**一条「用户 · 回到检查点」—— 时间线只增不减。界面上的 60 步
   Ctrl+Z 是另一层（只在内存、只管这一次会话的手动编辑）。
3. **只在内存里，按文件分开存**（键就是 `doc.file`，上限 50 份，内容逐字节相同不重复记）。真相源始终是那个 `.mmd` 文件；代价是**重启后清空** —— 面板上如实写着这句。
4. **写盘失败的那一次不进历史**；两个写工具在落盘失败时**必须回 `ok: false` + 把原因塞进 `problems`**（内存已经回滚了，回执还说「已更新」就是骗 AI）。

守门人：`test/host.e2e.mjs`【检查点（快照）】，`test/ui.render.mjs` 第 [4e] 节。

## 服务时序：硬依赖走 inject，可选取用走 ctx.get

哪个服务何时可用由 Cordis 按**可用性**决定，行顺序不承载加载语义（`dsh-base/cordis.patch.yml` 开头就写着这句）。`ctx.get` 是同步快照，
服务晚一步就是静默失败（装机后 `tools` 是 `undefined`，插件挂上了，工具和路由却一个都没注册）。正解是把硬依赖 park 到齐：
`module.exports = { name, inject: ['fs', 'tools', 'systemPrompt'], apply }`。

- **`webServer` 是例外**：它只在 web 形态里存在，进了 `inject` 会让插件在 headless/acp 里永远 park；走 `ctx.inject(['webServer'],
  webCtx => …)` 在里面注册路由 —— **没有界面时 AI 工具与提示词上下文照常可用**。同理 `harness.route` 只**登记**路由，真正 `webServer.register`
  由外层在服务就绪后做。
- **`timer`** 周期扫描要它，但**不进 `inject` 声明**；客户端 `exports.inject` 同理只列 `slots`，**不列 `timer`** —— 没有它界面靠
  `ctxTimeout`/`ctxInterval` 回退到原生定时器（`src/client/runtime.ts`），列了而部署里没有就永远 park。
- **宿主逻辑用到的 ctx 能力，测试桩也得提供**：`ctx.inject` 是第四个必须的桩方法（`get` / `effect` / `on` / `inject`），加一个就要同步补
  host.e2e、host-loader、plugin-mount、tools.schema 四个文件里的桩。
- **可选取用的服务必须走 `ctx.get(name)`**：Cordis 对**未 inject** 的服务直接读属性是**抛错**（`cannot get property "timer" without
  inject`），**不是**给 `undefined`。规则：**硬依赖走 `inject`，可选取用走 `ctx.get`，拿不到就降级。** 守门人是 `test/ui.render.mjs` 第 6
  节（strict ctx 渲染面板）。

## 包内资源与数据目录都不要写死本机路径

`assets/mermaid.min.js`（构建期从 `node_modules/mermaid` 拷进来）、`lib/ui.js` 与**数据目录**（全局图库、日志）全部由外层经 `hostEnv`
递进来：

| hostEnv 字段 | 真插件（`lib/index.js`） | 动态形态（`bootstrap/host.ts`） |
|---|---|---|
| `uiFile` / `mermaidFile` | `path.join(__dirname, …)` | `<项目>/dist/ui.js`、`<项目>/assets/…` |
| `dataDir` | `$DSH_HOME`（否则 `~/.dsh`）+ `/arch-canvas` | 本机字面量（这一层本来就写死项目路径） |
| `logBackend` | `node:fs`：真 append、真 unlink | `fs` 服务：读全文写回、清理=清空 |

`dataDir` 缺失时宿主逻辑**直接抛错**（`src/host/document.ts` 开头）：它不是可选项。宿主逻辑里出现任何 /home/<某人> 都是 bug ——
写死就只在装机那一台能用。守门人：`test/plugin-mount.e2e.mjs` 的「设置里给了就用它」那一条。

## Package 里只应该有引导层

两半都必须是薄壳：`code.host` 取 `dist/bootstrap-host.js` 的原文，`code.client` 取 `dist/bootstrap-client.js`
的原文。**取构建产物，不要手抄** —— 手抄漏掉包装，`ctx` 成为顶层未定义变量，host 半边整个加载失败；把 `dist/host.js` / `dist/ui.js` 塞进 Package
则等于改一行重发上千行；规则本身是 `code.host` 必须等于 `return { apply(ctx) { ... } }`，由引导层和构建兜住。`tools/build.mjs`
里有结构性断言，判据是**只有真宿主逻辑里才有的东西**（bootstrap 里出现 `onRpc('doc:get'` 或 `function ArchStudio` 就构建失败），
且判前先**去注释、归一引号** —— 所以注释里提到这些名字不会误伤。每条断言有**稳定 id** 并在构建尾行打印，
`test/build-guards.mjs` 逐 id 断言「都有负向对照」（少一个、或对照表里多一个，都红）。守门人另有 `test/host-loader.e2e.mjs`。

## 沙箱里没有的东西（只对**动态 Package 形态**成立）

- host 半边：没有 `process` / `Buffer` / `fetch` / `require` / `fs`（`types/sandbox.d.ts`
  只为类型检查声明了它们，构建期正则会拦）。服务取用见「服务时序」；副作用一律 `ctx.effect(...)` 包住，否则卸载时泄漏。
- client 半边：`setTimeout` / `setInterval` / `fetch` / `require` **被 trap 掉了**，用了会直接抛错；定时器一律走 `ctxTimeout` /
  `ctxInterval`（`src/client/runtime.ts`）。`document` / `window` / `React` / `styles` / `host` 是可用的。

## 客户端界面：没有浏览器怎么看

`test/ui.render.mjs` 拿 jsdom + React 把 `lib/ui.js` **真渲染出来点一遍**。两条必须照做的规矩：

1. **DOM 必须在 `import('react-dom/client')` 之前就位。** react-dom 在**模块求值期**就用 `window` / `document`
   探测能力；晚一步它会认为环境不支持 input 事件，改走 IE 时代的 `propertychange` 分支 —— `onChange` 永不触发、`focusin` 抛 `attachEvent is
   not a function`。所以测试里 React 走动态 import。
2. **stage 这类 JSX 在 return 之前就构造好了**，它用到的派生值必须声明在**那之前**：写在 `return` 前几行的 `var libItems = …` 会被 `var` 提升成
   `undefined`，整个面板渲染崩溃。

改面板结构时先跑它；它断言的是按钮文案与 DOM 结构（用户看得见的那层契约）。

## 画布住在主窗口子页里

`conversation.view` 的契约是**一次只渲染一个**（shell 用 `renderSlot(..., { only: viewId })`），所以「切到对话」= **卸载整个
ArchStudio**。这条契约牵出四件事：

1. **组件里的一切都会归零**：缩放/平移、当前子页、内存里那 60 步撤销历史。所以「你摆到哪儿了」存在模块级的 `studioMemo`（`src/client/studio.ts`），按
   `<会话>|<文档>` 分开：**只记用户自己动过的**（`userViewRef`、「撤销栈非空」；自动适应窗口算出来的视角**不记**）；**不记图内容**（内容以宿主的 `doc:get`
   为准）；**不记选中与详情面板**（只把面板还回来而草稿是空的，等于把上一次的正文摆在回车即生效的框里）；**`committedRef` 不还**（必须等于刚 `doc:get`
   回来的那份，否则回来后的第一次编辑会把「离开之前的旧状态」记成历史 —— 一撤销就吃掉离开期间 AI 的改动）；文档身份取 `key || diagram || file`（**外部文件只有 `file`
   认得出来**）。
2. **宿主的 `lastChange` 会随 `doc:get` 一直回来**，所以「AI 刚改了 N 个节点」的高亮必须由客户端按「文档 + 修订号」去重（`memo.hlKey`）——
   否则每次切页回来都会把**同一次**旧改动再脉动一遍。
3. **左下角那个入口没有**（`sidebar.footer.action` + `sidebarRightTabs` 摘掉，客户端 `exports.inject` 因此只剩
   `slots`）；代价：**空白会话里没有任何入口打开画布**。
4. **粘滞的都是「开关」，状态不是**：详情只在**没有位移的那一次抬手**上展开（`DRAG_SLOP` 的抖动门槛）。守门人：`test/ui.render.mjs` 第 [4r] G、第 [4s] 节。

## 目录含义

- `src/host/mermaid.ts` —— 纯函数，不碰服务不碰状态。测试的第一道防线在这里。
- `src/host/log.ts` —— 文件日志与保留期；写盘能力由 `hostEnv.logBackend` 从外层注入，这里只认接口。
- `src/host/document.ts` —— 状态与 op 应用；新增 op 类型要同时改 plugin.ts 的工具 schema 和这里。所有加载/切库都排 `loadQueue`
  这一条队列，并发进两个项目图库时谁也不能覆盖谁的 `lib`。**自动扫描**（`scanProject` / `walkProject` / `refreshLibrary`）：**2.5s 轮询**只走目录 +
  比 `name:bytes`，指纹没变就不读文件、不解析；**force**（`rescan:true` / 20s 慢速定时器 / 写路径收尾）**必须真读内容** ——
  同字节数的改写只有它看得见。`libraryRev` 是给界面的「清单变了」信号。**外部文件**（`doc.external`）是按路径打开的 `.mmd`
  / `.mermaid`：不属于任何图库，`ensureLoaded` 里那道「有 external 就直接返回」的闸不能拆 —— 拆了界面轮询就把它冲回图库的图；它的「key」就是路径，落盘写回原文件。
- `src/host/history.ts` —— 检查点（快照）环形缓冲：按文件存正文、标明谁改的、退回即重放；排在 `document.ts` 之后拼接。
- `src/host/plugin.ts` —— 对外接口面；改工具描述等于改 AI 的行为，要慎重。RPC 与工具注册统一走 `onRpc` / `onTool` /
  `onRoute`，现场记录就挂在那一层。
- `src/client/studio.ts` —— 编辑历史的关键是 `committedRef`：**不能拿拖拽中的 `modelRef.current` 当「拖之前的状态」**，它每个
  pointermove 都在变。

拼接顺序由 `tools/build.mjs` 的 `HOST_PARTS` / `UI_PARTS` 声明 —— 文件名不带编号，**改顺序只改那两处**。

## 画布交互三件：拖动 / 详情面板 / 连线锚定

### 1. 拖动：一帧一次更新，浮点跟手，吸附按屏幕像素

- **rAF 合帧**（`rafFrame` / `rafCancel`）：`pointermove` 只写 pending，一帧最多一次 `setLocal`。**抬手前必须
  flush**（`flushMove`）—— 最后一段位移决定「点空白还是平移」，不 flush 会把平移误判成点空白、连选中一起清掉。平移也走同一条路。
- **拖动期用浮点坐标，提交时才取整**（`commitDrag`）；宿主落盘本来就会取整（`normalizeModel`）。
- **吸附阈值按屏幕像素折算**（`snapRadius(k, SNAP_PX)`）：`SNAP_PX` 吸上 / `SNAP_EXIT_PX` 脱开（`snapAxis`），**Alt
  临时关掉**；分组拖动走同一条吸附。
- **pointercancel = 回滚**（`restoreDrag`，不写盘不进历史）；**lostpointercapture = 提交**。
- `DRAG_SLOP` 是「点选 vs 拖动」的门槛，和面板展开挂钩，**不要**为了手感去动它。

### 2. 详情面板：收起 ≠ 关闭（三态）

- 状态是**三态**：展开 / 收起成 `.ac-peek` 细条（选中保留）/ 无选中。收起只收面板，关闭（`×`）才取消选中；点**同一个元素**再点一次 = 收起（`toggleDockFor` +
  `dockForRef`）。
- **Esc 分层**：焦点在输入框 → 只退焦点；面板开着 → 只收起（保留选中）；再一下才清选中。
- **点空白只在「无位移的抬手」上清选中**。
- 面板开合会改变 stage 高度：`keepSelInView()` 把选中节点**最小平移**带回视野（不重新 fitView）。
- 面板高度由 `.ac-sash` 拖出来，**只活在模块变量 `STUDIO_DOCK_H` 里**（不落盘）。

### 3. 连线锚定：先落点、再定侧；落点必须在**真实轮廓**上

- 选边走 `edgeSidesOf`：两端**同轴**的两种组合里挑代价最小的。**不做** 16 组合枚举、**不抄** mxGraph 的 routePatterns 查表、**不用**
  ELK（整图重排会毁掉用户坐标）。选边还带 `axisLooksClear`（给 obstacles 时才算）：一条轴的中位线附近全被挡住就加罚，否则选出来的轴会被障碍全部拒掉、落到硬穿兜底上。
- **落点投到轮廓**（`perimeterPoint`）：矩形/胶囊/椭圆/菱形/六边形各一条闭式解。三条实现注意：**胶囊的圆角圆心离形状中心有 (spanD - r)
  的偏移**，少了它横着出去的锚点会缩进方块里；六边形的内缩是 `NODE_HEX_INSET`，**画形状与算锚点共用同一个常量**；**「有没有穿进自己」不能用包围盒判** ——
  轮廓上的锚点也在包围盒内部，走 `edgePathHitsSelf` → `edgeSegHitsNode`，包围盒只当快速预筛，再用 `shapeInterior` 按形状采样判「真的进去了」。
- **兜底绕行的车道要铺开**：`兜底一`（两段绕行）把每块障碍的外侧也当候选（按离中位线远近排），否则方块挤成一片时那两条整片外侧的车道一条都走不通，落入**不看障碍的硬穿**。
- **端口分组（studio）与布线器（runtime）必须问同一个 `edgeSidesOf`**：两份拷贝必然分叉；`gstate` 要把 `shape` 一起给连线用，折叠块没有 shape
  就按矩形处理。
- 锚点的守门断言用**有符号**距离（0 = 在轮廓上，负 = 埋在形状里）：只测「离轮廓多远」的话，锚点缩到方块正中间也会算 0 —— 那条断言就没牙了。

守门人：`test/edges.test.cjs`（轮廓有符号距离 × 两种摆放 × 8 种形状 × 1~4 端口、选边、420 点网格的「白绕/回头线/从背后出线」不变量 +
**旧规则负向对照**、非矩形多端口「不穿别人也不穿自己」、平行间隔让道、避障、自环、坐标完全重合的退化输入）；`test/ui.render.mjs` 第 [4r] G（面板三态 / Esc 分层 /
分隔条）、第 [4p] 平行间隔（坐标**穷举搜出来**，否则断言空转）与第 [4w] 节（rAF 合帧 / 吸附阈值与迟滞 / Alt / pointercancel 回滚 /
lostpointercapture 提交）。

## 画布属于项目，不属于进程

画布是共享的，而 `promptText` 是**同步求值、拿不到会话** —— 归属判断必须在注入路径上做。四条不许破：

1. **`promptText(asctx)` 必须按会话判归属。** DSH 会把装配上下文（`{ agent, scope, signal }`）传给注册的 `text` 函数，里面的
   `agent.session.cwd` 就是这一步所属的项目。**画布不属于你（`docBelongsTo(where)`
   为假）时**：先试着同步换到自己项目那一份（内存槽命中，`syncWorkspaceFor`）；命中不了就只注入一段**说明**（`foreignCanvasText`：画布停在哪个项目、为什么这一轮看不到内容、要看自己的图去调
   `arch_read`），**不含任何别人的图内容、锚点、留言**，也不消费那些留言。没有会话信息（工具、测试桩、headless）时**保持旧行为** —— 别把「判不了」变成「一律不给」。
2. **留言只投递给它所属项目的会话。** 留言是**一次性**投递，投错人等于丢了；守门断言就是「Y 那一步没吃掉 X 的留言」+ 盘上 `done` 仍为 false。
3. **每个项目一份内存画布（`docSlots`）**，槽里放的是**同一批对象引用**，切换只是换指针：换项目时 `saveActiveSlot()` → `activateSlot(key)`
   命中就返回（**不读盘、不 bump 修订号**）；**只存「已经载入过」的状态**（`loadedFor` 为空时不存），否则下次「命中」就等于命中一张空图；**换新项目必须给一份全新的 doc
   对象**（`newDocState()`）；归属的键是**项目根**（`projectKeyOfTarget`），不是子图库那一层。
4. **读路径不发起加载**：`promptText` 里**不许** `ensureLoaded(...)`，它与别的会话的切库抢同一个活动指针，会把一份空文档写进某个项目的槽；要画布走
   `arch_read` —— 那条路带着会话 cwd。

另外两条：**`doc.workspace` 必须留在 `RUNTIME_ONLY_FIELDS`**（漏了就是每次保存都误报
`serialize.not-idempotent`）；**残留（未修）**：`whereOfExec` 取不到 cwd 的会话（无 cwd 的 headless）仍按「当前文档」读写。

守门人：`test/host.e2e.mjs`【会话隔离：画布属于项目、不属于进程】（Y 那一步读不到 X 的图/留言/源文本块、盘上 `done` 仍为 false、X
那一步仍能拿到自己的留言、一次性投递语义不变、工具带回自己的画布、换回 X 修订号不动 + 负向对照、子图库归属仍按项目根、无会话信息时保持旧行为）。

## 宿主数据安全与并发归属

十四条不变式：

1. **旁路表：没读过的表一个字节都不许写。** `notes.json` / `anchors.json` 的键是**图文件名**、整目录共用一份；「当前 `.mmd` 不存在」时 absent
   分支**不读**表，对没读过的表 `= {}` 再写回就会把整个图库所有图的留言**覆盖成空**（零日志零警告）。所以 `persist()` 先 `await
   loadNoteStoreFor(fileNow)` 再收表，`harvest` / `save` 遇到「表不在缓存里」跳过并记日志。
2. **并发归属：指针切换排进 `loadQueue`，落盘认下自己的文件。** 切换（`saveActiveSlot` / `activateSlot` /
   `resetToWorkspace`）在队列**外面**同步改全局的话，别的请求 await 期间目标就被换了 —— 醒来读到别人的 `doc`/`lib`，把 A 的图写进 B
   的图库。`persist(policy, site, expectFile)` 入口检查一过就**立刻**把「要写什么」快照成本地（`file` / `body` / `nodes` /
   `absent`）；此后**每个 await 之后、在动任何旁的状态（旁路表 / 基线表 / 检查点）之前**都要再复核一次归属，被抢走就记
   `persist.doc-stolen` 并且**什么都不写**。写 `.mmd` 用认下的 `fileNow`；`persistOrRollback` 在指针被换走时**不许回滚**（`restoreModel`
   会把 A 的快照灌进 B 的文档）。读路径用 `docTicket()` 在 await 后复核 `{slot,dir,file}`；**`doc:openPath` 原先唯一不排队的加载路径**，
   现在也必须排进 `loadQueue` 并在 await 后复核 ticket。**`applyRollback` 必须把 `expectFile` 传给 `persistOrRollback`** —— 不传，
   「指针被换走不许回滚」那道闸门**不可达**。
3. **缺凭据不许退化成默认值。** `splitKey('')` 的 name 会兜成默认图名 —— 一句不带 key 的 `doc:delete` 就把默认图软删了。`doc:delete` /
   `doc:restore` 要 `key` 是非空字符串；`doc:rename` 的 `from` / `to` 都要非空字符串；`doc:applyText` 要 `text` 是字符串，**「清空」只认显式空串**
   （纯空白串必须拒绝）。`doc:set` 的 `model` 要是 `{nodes:[],edges:[]}` 的形状 —— **数组也是 `object`**，只判 `typeof` 就是漏网。**要清空就显式传空串/空数组** —— op 同理。
4. **op 传错类型 = 拒绝，不许静默清空。** `set_link {link:42}` / `set_files {files:'x'}` / `set_group {group:99}`
   不能等于清空那个字段；`move_node` 非数值不许报「移动了」却没动，`1e999`（JSON 合法 → Infinity）不许让坐标消失；`remove_edge` / `remove_group`
   / `set_edge_label` 对不存在的东西也进 `problems`；`mark_note.done` 出现就必须是布尔（缺省 = 标已办）。工具与 RPC 的入参同族同口径：
   `doc:file.save` 必须布尔、`doc:rollback.seq` 必须是有限整数、`doc:get.where` 出现就必须是非空字符串（**`where: ''` 仍表示全局图库**，别误拒）、
   `arch_read.diagram` 出现必须是字符串、`arch_switch.create` 出现必须是布尔。**一个 op 都没生效时不写盘、不推修订号**。
5. **`{{` 守卫收口到 `promptSafe()`，三个 return 都要过**（含空画布的提前 return 与 `foreignCanvasText`，后者带着别人的图名）；循环拆到没有 `{{`
   为止。`foreignCanvasText` 不报对方图名。
6. **留言的一次性投递只标「列出来的」那些。** 清单上限 20 条，把 `openNotes` **全部**标已办的话，第 21 条起既不进上下文、又永远不会再投递；剩下的明说「下一步继续投递」。
7. **墓碑行 `%% @deleted` 不是内容。** 它是文档级标记（`TOMBSTONE` 写在最前面、`hasTombstone` 从行首读）；解析器把它当「未知 `%%` 行」留进 extras
   之后，**「恢复」就无声作废**（下次保存又写回文件末尾）。解析器显式跳过它、`doc:restore` 也摘掉内存里的 `doc.tombstoned`。
8. **两处「静默说谎」**：落盘失败那条警告（`SAVE_FAIL_PREFIX`）描述的是**已过去**的瞬时状态，成功落盘时清掉；`drift.uncovered`（漏画）**与基线无关** ——
   零锚点的图也要有基线，否则它恒为空，偏偏它最需要这条信号（空 refs 也记 `{refs:{}}` 基线）。
9. **RPC 路由的跨站防护**：`/arch-canvas/rpc` 没有 dsh 那层鉴权（同端口 `/api/*` 返 401），任何网页都能盲发 POST 到 `127.0.0.1:3080`。拒绝
   `sec-fetch-site` 非 `same-origin`/`none` 的请求；**有 `origin` 就必须有 `host` 且两者一致**，否则 403（`host` 缺席同样拒，fail-closed）。**本机进程（不带这些头）照常放行** ——
   它本来就能读写同一批文件；要挡的是「浏览器替用户发的跨站请求」。
10. **墓碑守卫：认下的 `.mmd` 已带 `%% @deleted` 而内存这份不是墓碑时拒写。** 典型是 `doc:delete` 把画布从刚打上墓碑的内容上撤走后再保存 ——
    落盘一次就等于把用户的「已删除」静默抹掉。拒写记 `persist.tombstone-guard`，原因经 `doc.warnings` / 回执的 `problems` 摆给用户。
    **「恢复」是 `doc:restore` 的事，不是一次无关保存的副作用**：它直接 `fs.writeText` 摘掉墓碑行，并在画布被清空过时把这份文件重新读回画布。
11. **`arch_edit` 一个 op 都没生效时不设 `doc.notes`。** 写工具的说明文字必须跟「至少一个 op 生效」绑在一起 ——
    否则面板状态栏写着「AI 说：…」而盘上什么都没变，说明与事实相反。
12. **图库指纹与 force 的边界。** `name:bytes` 指纹看不见**同字节数**的改写（改一个词、删两个节点再补个空格），所以**2.5s 轮询**只走目录 +
    比 `name:bytes`（TTL 之内一个字节都不读），而 **force**（`doc:list {rescan:true}` / 20s 慢速定时器 / 写路径收尾的 delete / restore / rename）
    **必须真读一遍内容**。别把 force 也砍成只比大小。
13. **删掉「当前」那张图之后画布不许留在墓碑上。** 同一图库还有活图就切过去；一张都不剩才把画布清成空 / `absent` 并给说明 ——
    盘上那份文件保持 `%% @deleted`，不被改写。
14. **留言表改名要按节点 id 合并。** `notes.json` 以**图文件名**为键，`doc:rename` 要把它那一格搬到新键；**目标键已存在时按节点 id 合并、源图优先**，
    不能直接把源图的留言 `delete` 掉 —— 那等于用户写给源图的留言全丢，反而留下孤儿条目。

守门人：`test/host.e2e.mjs` 的 A~U 各节（含逐条「撤回修复就红」的咬合检查）、`test/mermaid.test.cjs` 第 [21]~[28] 节（真 Mermaid 合法性 /
真图逐字节往返）+ 第 [17] 节（墓碑不进 extras）、`test/edges.test.cjs` 第 [8] 节、`test/ui.render.mjs` 第 [4s] 节与第 [4r]
B2、`test/build-guards.mjs`。

## 与主会话协作

改图数据的默认位置是 `~/.dsh/arch-canvas/architecture.mmd`；插件重启后 `revision` 从 0
重算（修订号只在内存里），但坐标从文件恢复。排查「图不对」时先看这个文件，它比内存状态可信。

