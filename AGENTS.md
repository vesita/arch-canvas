# arch-canvas 项目纪律

## 改完必须跑

```sh
npm run check
```

`src/` 下任何改动都要过这一关再谈「做完了」。解析器是这项目的命门：
用户摆的坐标和 AI 的增量修改都压在它身上，往返一旦不幂等，图就会在「用户改 → 落盘 → AI 读」
这条链路上悄悄漂移，而且**不会报错**。

## 写盘前的往返守恒检查（2026-09-21 加）

`persist()` 每次落盘前会跑 `roundTripDetail(doc)`（`src/host/mermaid.ts`）：
**`parse(serialize(doc))` 必须与 `doc` 在所有会被持久化的字段上一致**。不一致就记
`serialize.not-idempotent`（带**差在哪个节点的哪个字段**）+ 在面板上挂一条警告，**但照旧写盘** ——
拒绝保存比丢字段更糟：用户当下的编辑一个字都存不下去，而字段在文本里表达不出来就是表达不出来
（检查点回滚也救不了，快照存的就是同一份文本）。

它抓的是「某个字段写不出去」这一类：2026-09 连续踩了四次（拖拽丢 files/note/link、
`autoLayout` 丢 4 个字段、`add_node` 丢组名、**空组写不进文件**），每一次都**不报错**，
都是"用户下次打开发现东西没了"。第四次就是这条检查自己当场逮住的。

三条必须记住的**排除项**（写错任何一条，这条检查就会在每次保存时误报，等于没用）：

1. **不进文件的运行期字段**：`file` / `name` / `tombstoned` / `absent` / `external` /
   `warnings` / `notes` / `fileStatus` / `revision` / `updatedBy` / `updatedAt` / `legacyNotes`。
2. **旁路表承载的字段**：节点的 `note` / `noteDone` 存在 `notes.json` 里，**不由这份文本承载** ——
   「会被持久化」不等于「会写进这份文本」。
3. **派生字段与集合顺序**：边的 `id`（`'e'+length+1`，每次解析重新编号、不进文件、代码里也不寻址）；
   节点/边/组的**顺序**（`serializeDoc` 会重排，那是规整不是漂移），所以按 key 排序后**按集合比**。

守门人：`test/mermaid.test.cjs` 第 [18]（安静时真安静 + **负向对照**：真不对称时报得出来）、
第 [19]（空组必须写进文件）；`test/host.e2e.mjs`【写盘前的往返守恒检查】——
它断言**整套测试几百次落盘里这条检查一次都没报**，所以检查本身一旦误报会立刻红灯。

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

### 技术选型：先 TS，不上 Rust / WASM（2026-09-20 定）

**在明确决定引入 Rust 之前，新功能一律用 TypeScript 写**（`src/` 下不新增 `.js` 源文件）。
这条是决策，也有实测支撑：

- 解析器规模成本一次性基准（未入库，i5-12400F / Node 24）：100 节点 0.64ms、1000 节点 10.1ms、
  5000 节点 198ms、20000 节点（4MB 文本）1.66s，且 100~20000 全规模往返幂等为 TRUE。
- 真正的天花板**不在 CPU**：宿主每步把整份源码注入 AI 上下文，1000 节点就是 55k tokens、
  5000 节点 287k tokens —— 远早于解析变慢就撞墙。性能问题先查「是不是注入了不该注入的东西」。
- 还有一条硬约束：动态 Package 形态下 `code.host` 是**源码字符串**（见「Package 里只应该有引导层」），
  wasm 二进制塞不进去，Rust 化会只在装机形态可用，或把包撑大。

所以：**先想清楚要算的是什么，再谈换语言。** 真到需要 Rust 时，正确的形状是把纯函数核心
（解析器 / 校验）抽成一个独立模块，而不是把插件整体重写。

## 四个不能破的约定

1. **分片不能 import。** `src/host/*.js` 和 `src/client/*.js` 各自是一段会被沙箱求值的函数体，
   没有模块系统。要复用就靠拼接顺序 + 函数声明提升，别写 `import` / `require`。
2. **`%% @pos` 是坐标的唯一载体。** 坐标只写在注释里，图体里没有第二个地方存布局。
   注释指向图里不存在的节点时**直接丢弃**（不许凭注释把节点复活），不然删掉节点后图会被注释拽回来。
   （元素留言存旁路表，不再走源文本注释载体，见下节。）
   **组 id 和节点 id 一样不能含空格**：`scanNodeRef` 的 ID_RE 遇到空格就停，
   `subgraph AI 端["AI 端"]` 会被解析成 id=`AI` + 标签=`端["AI 端"]`，再序列化就成了
   `subgraph AI["AI 端[#quot;AI 端#quot;]"]`（2026-09-20 手写源文本时踩过）。
   走 `arch_edit` 的 `set_group` 不会踩这个坑 —— 它会过一遍 `cleanId`，空格变 `_`。
   **`set_label` 里的换行要传真实换行符，不要传字面量 `<br/>`**：`q()` 的转义顺序是「先转义 `&` / `#` / `<`，最后才把换行写成 `<br/>`」（`src/host/mermaid.ts:49-50`）；传字面量 `<br/>` 会被转义成 `#60;br/>` 写进文件（2026-09-20 踩过，破坏节点显示）。
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

## 元素上的东西：留言旁路表、`@file`、`@summary`

用户在图上给某个元素留话、标源码文件，以及给整张图写一句「这张图讲的是什么」——
这些都要能进下一步的对话。保持一致的性质：

1. **对用户一律叫「留言」，不叫「注释」；代码字段保持 `note` / `noteDone`。**
   它是挂在节点 id 上的待办，有「未办 / 已办」两态，存与那张 `.mmd` 同目录的 `notes.json` 旁路表：
   `{ "<图文件名，例如 architecture.mmd>": { "<节点id>": { "text": "...", "done": false } } }`。
   源文本里再没有留言行，头部 `%%!` 格式说明也不再写留言模板。
2. **内存里的形状是旁路表的投影**：`doc.nodes[i].note` / `.noteDone` 是扁平两个字段，
   加载时从表灌进节点、落盘时从节点收进表。模型层、快照回滚、界面绑定都不动。
   空文本 = 没有留言（`noteDone` 归一成 false）；字段名**不能**叫 `notes` ——
   `doc.notes` 已经被「AI 改图后的一句话说明」占用（内存态，`doc:get` 后清空）。
3. **注入语义：只有未办留言进 `promptText()`。**
   已办留言留在表里可追溯，但不注入模型上下文（留言会单调累积，全灌进去 AI 会重新讨论早就定下来的事）。
   提示词里明说「另有 N 条留言已完成、要看全部用 `arch_read`」。
4. **孤儿保留（无幽灵风险）**：留言搬出源文本后，不再有「注释把删掉的节点拽回图里」的风险，
   所以删掉节点后留言留在表里，不再丢弃。
5. **一次性迁移（表优先、正文兜底）**：老文件正文里的老式留言行在加载时被读进表（表里已有该节点条目就以表为准），并在下一次落盘时从文件里剥掉；加载时导入、落盘时剥离，不走双写。实测已完成：`.mmd` 里已无这些行，`notes.json` 里留言与状态都在。
6. **写入两道防覆盖闸门与日志排障**（`src/host/notes.ts`）：
   落盘时 `fs.processPath(target)` 必须严格等于预期路径，且文件不存在或能解析成 JSON 对象才允许写入；
   任一不过就拒绝写入并记录 `notes.save.refused`。加载失败日志 `notes.load.fail` 带 `head` 字段（前 80 字符）。
   （已知未修：`test/host.e2e.mjs` 的桩 fs 会将测试日志写进生产目录 `~/.dsh/arch-canvas/logs/` 产生 `head` 假警报。）
7. **客户端发送入口与 `@` 引用源**：
   - 清单头部「发送这一轮留言 (N)」将所有未办留言打包填入聊天输入框，检查器单节点提供「发送给 AI」；
     均走客户端 `props.inputActions.setDraft`（DSH 提交管线，必须判空）。宿主半边禁止 import，拿不到
     `createUserMessage`，走客户端避免手搓脆弱的消息结构；
   - 客户端注册 `@` 引用源（`ctx.inputTriggers.registerSource`，trigger: '@'，name: 'arch-canvas'），
     走 `ctx.get` 可选获取（不在 `inject` 声明里），选中的节点 chip 在发送时由 `codec.serialize(ref)` 展开为节点标题/描述/源码锚点/留言。
   - **节点快照按会话分开存**（`studioSnapshots`，`src/client/studio.ts`）。投影给源的就是 `{ sessionId }`
     （`dsh-client-ui-input-trigger` 的 `project()`），`candidates` / `lexicon` 都按它取。
     从前只有一个模块级数组，而画布在主窗口子页里、切走就卸载 —— 那个数组于是留着
     **上一次打开的那张图**：在另一个会话（另一个项目）里打 @，列出来的是别人的节点，
     展开进 prompt 的也是旧描述。**拿不到这个会话的快照就返回空**，空比别人的图好。
   - `codec.serialize(ref, signal)` **拿不到会话**（契约如此，见 `serializeReference`），
     所以解析走 `resolveLiveNode`：优先「最近被问到的那个会话」；两个会话都有同名节点、
     而活跃的那个没有 → **拒绝展开**（回「当前画布中已不存在该节点」）。
     宁可不展开，也不许把另一张图的话塞进 prompt。守门人：`test/ui.render.mjs` 第 [4s] 节
     （含四条负向对照：问别的会话、换图不继承、旧高亮不重放、含糊时拒绝展开）。
8. **代码锚点 `%% @file <id> <路径>` 是数组，一个节点可多条。** 它回答的是「中文标签 ↔
   英文路径」这个 grep 不出来的映射。它会**腐烂**（文件改名/移动而注释不会自己更新），
   所以加载/保存后一律 `verifyFileRefs()` 重算 `doc.fileStatus`
   （`ok` / `missing` / `symbol-missing` / `unknown`）—— **一条过期锚点比没有锚点更坏**，
   它会把 AI 自信地送到错的文件。结论要同时摆到界面（`▤` 角标，失效变红）与提示词（⚠ + 「不要照着用」）上。
   判不了根时返回 `unknown`，**不许假装 ok**。
   **`%% @file` 的值不套标签那套实体转义**（写出去用 `qRef()`，不是 `q()`）：标签里的 `#` 会被
   Mermaid 当成实体转义的起点，所以必须写 `#35;`；而这条值在一行注释里、Mermaid 根本不看 ——
   在那写成 `#35;` 只坑**人**（源码页里该看到的是 `src/host/document.ts#applyOps`）。
   读回仍然走 `unquote()`（它认 `#35;`），所以老文件照旧解析，只是下一次落盘就被规整。
   守门人：`test/mermaid.test.cjs` 第 [20] 节（含老文件那条）。
9. **一句话总结 `%% @summary` 是图级字段，不挂节点。** 它必须占**一行**、有 500 字上限、
   规范化只有一处（`cleanSummary()`，`mermaid.ts`）—— 解析（读文件）与 `normalizeModel`
   （读界面/AI 传来的模型）两条路共用，两边不一致往返就不幂等。它进提示词的头部
   （「**这张图讲的是**」），也随图库清单回给界面（选择器/起始页显示它）。
   它**没有幽灵问题**（不指向节点），但**字段整个缺席 ≠ 要清空**：旧界面发来的模型
   根本不知道有 `summary`，那是「保留现状」；显式清空走 `summary: ''`。
10. **锚点 / 总结都是用户的东西：AI 重画要继承，用户改源码不继承。** 边界在
    `inheritUserMarks()`（只被 `arch_write` 调用）：AI 整体重画时按节点 id 把锚点留下来、
    图级总结沿用旧句子（新文本自己写了就用新的）；但 `doc:applyText`（用户在「源码」页编辑）
    **不继承** —— 用户删掉那一行就是真的删。留言则始终保存在 `notes.json` 旁路表中，按节点 id 关联，重画不受影响。
11. **这些走的是读路径，与「谁能改图」无关。** `promptText` 每步注入状态，所以留言、锚点、
    总结与 AI 能不能改图是两件事 —— 它们是**用户 → AI** 的单向通道。改 `promptText` 时
    别把「`%%` 是元数据、不要讨论」那条纪律重新盖到它们头上，那会**反向压制**整个功能。
    `skills/arch-canvas/SKILL.md` 里同一句话也要跟着改。

**加字段要同时改 `normalizeModel()` 的白名单（`document.ts`）与 `snapshotModel`/`restoreModel`**
—— 它是逐字段重建，漏了就是**用户每保存一次，那个字段被静默清空一次**，不报错。

### 文件头的格式说明行一律 `%%!` 前缀

`serializeDoc()` 写出的头部那几行是**给人看的模板**（`%%! @summary …`、`%%! @pos …` 等，不再包含留言模板）。
从前它们就是普通的 `%% @xxx` 行，于是**每解析一次文件就凭空多一条**
「元数据指向图里不存在的节点，已丢弃」的假警告 —— 而这条警告会出现在
`arch_read` 的返回值里，读的人（AI）每次都要先排掉这口噪音。现在：

- 写出时说明行一律 `%%!`，解析器见到 `%%!` 整行跳过；
- 0.4.x 写出的老文件靠 `LEGACY_TEMPLATE_RE`（`%% @pos|link|note|done|file <...>`）兜住 ——
  `<...>` 不可能是合法节点 id，见到就当说明；
- 提示词注入时把 `%%!` 行也滤掉（每张图逐字相同，格式上面已经讲清了）。
  所以「注入的视图」与文件**不逐字相同，差异三处**：
  1. `%%!` 行（格式说明）—— 每张图逐字相同，而且里面有 `<节点id>` 这类模板；
  2. `%% @pos` 行（坐标）—— 纯布局数据，AI 不消费（改坐标走 `move_node`，整体重画按 id 继承旧坐标），
     而它每节点一行 —— 17 个节点的图里占了源码块近三分之一；
  3. `{{` 被拆成 `{ {` —— **这不是可选项，见下一节**。
  前两处都要在提示词里明说「已滤掉、要看原文用 `arch_read`」。

### 提示词模板注入：`{{` 必须在注入前拆开（2026-09-20 事故）

`systemPrompt.context` 会把注册的文本当 `{{变量}}` 模板渲染，而**这条通道没有关插值的开关**：
`dsh-system-prompt/lib/index.js:150` 对 context 一律 `interpolate`，只有 `:115` 的 **section**
通道认 `interpolate: false`（README:66 说的就是后者）。AC 注入的是「每步刷新的实时状态」，
语义上就该留在 context 通道，所以关不掉插值。

后果很重：源文本里只要出现 `{{...}}`（Mermaid 的 **hexagon 形状**就是 `id{{"标签"}}`），
中间那段名字不匹配 `/^[a-z][a-z0-9_]*$/` 就**直接抛错** —— 整条提示词注入失败、插件当场崩，
**连会话都起不来**。实测：图上加了一个 hex 节点就触发了，只能卸载插件。

所以 `promptText()` 的 return 前有且只有一行 `out.split('{{').join('{ {')` ——
那是唯一一处**必须改动用户文本**的地方，改动收口在那里，别在别处再开第二个口子。

守门人是 `test/host.e2e.mjs` 末尾的【提示词模板注入防护】；它真的加一个 hex 节点再删掉，
所以**必须放在文件最后** —— 夹在中间会推进修订号，撞坏前面所有「修订号 == N」的断言
（第一次就是这么撞的）。

### `promptText()` 只写「状态」，不写「教材」

`promptText()`（`src/host/plugin.ts`）**每一步都注入**，它回答的只有两件事：
**当前状态是什么**（哪张图、修订几、谁刚改了什么节点、一句话总结、同图库还有哪些图、
未办的留言、锚点校验结果）与**用户要什么**。

「工具怎么用、图库怎么组织、`%%` 各字段什么意思」是 `skills/arch-canvas/SKILL.md` 的职责。
抄进 `promptText` 的代价**不是多花点 token**，而是**两份会各自漂移的真相** ——
改了一处忘了另一处，AI 同时读到两套说法（2026-09-20 实测：head 里 8 条 bullet 有 7 条是 SKILL.md 的复述）。

真正属于「读这份数据」的注意事项只有三条，它们必须留在 `promptText` 里（因为紧贴源码块）：
图不保证与代码一致、共享画布的边界、`%%` 行是元数据不要当内容讨论。

清单类内容里，节点名一律取**标题**（`labelTitle()`），**不要插整个多行 label** ——
一个条目撑成三行，清单就读成散文了。

守门人：`test/mermaid.test.cjs` 第 [14] 节（元素留言迁移与正文纯净/转义/幽灵/两态）、
第 [15] 节（锚点）、第 [16] 节（总结）、第 [17] 节（`%%!` 说明行不产生假警告，含 0.4.x 老文件）；
`test/host.e2e.mjs`【代码锚点 %% @file】【一句话总结 %% @summary】两节（落盘往返 / `fileStatus` 四态 /
`set_files`·`set_summary` / 继承边界 / 提示词措辞 / 回滚），`test/ui.render.mjs` 第 [4d] 节
（`▤` 角标与 broken / 锚点编辑框与逐条校验 / 清单里的总结）。

## 锚点保鲜 `drift`：这张图会不会已经过期（2026-09-21 加）

`fileStatus` 只回答「文件/符号还在不在」，它答不了最常见的那种腐烂：**函数还在，但它已经不是
图上说的那个东西了** —— 改名、职责搬走、参数换掉，锚点照样是 ok，而 AI 会照着它读错地方。
所以给每条锚点存一个**内容指纹**（`src/host/drift.ts`）：

- **基线**：`persist()` 落盘时记一遍 —— 那一刻的代码，就是这张图所描述的那份代码。
  存在与图同目录的旁路表 `anchors.json`（键是图文件名，值是 `{ <引用>: '<长度>:<djb2>' }`）。
- **比对**：`verifyFileRefs()` 末尾算一次 `doc.drift`（派生数据，随每条响应回给界面与提示词）。
  `stale` = 锚点还解析得到、但内容变过；`uncovered` = 有源码、却没有任何锚点指向的目录（只报最浅那层）。

四条不许破：

1. **没有基线就不猜。** `baseline=false` 时一条 `stale` 都不许报；「这次算不出指纹」（读不到、
   超过 1MB）同样不猜。把「未知」说成「过期」，用户三天就学会无视这条信号。
2. **读路径不写盘。** 指纹只在 `persist()` 里记。`verifyFileRefs()`（加载 / `doc:get` / `doc:set` /
   `arch_read` 都走它）只读、只比 —— 「读路径一个字节都不创建」这条规矩对它同样成立。
3. **落盘失败不记基线。** 图没写进文件，就不能声称「图描述的就是这一版代码」（写表排在 `.mmd`
   写成功之后）。失败**只记日志**（`drift.persist.fail`），不挂 `doc.warnings`：它只是这一轮
   没记上基线，图本身完好，也没有用户能采取的动作 —— 塞进「解析警告」只会稀释真正的坏消息。
4. **旁路表与留言表共用同一套闸门。** 一律走 `writeSidecarJson()`（notes.ts）：路径必须与
   `fs.processPath` 一致 + 已有文件必须是能解析的对象，否则拒写并记 `drift.save.refused`。
   所以**坏表不会被覆盖** —— 宁可这个功能一直不工作，也不许盖掉别人的东西；坏表之下
   `baseline` 永远是 false，这是有意的（回到第 1 条）。这条闸门从前只写在 `saveNoteStoreFor`
   里，现在两处共用一个实现：这类闸门复制第二份，早晚会有一份忘了改。

三条实现上的注意：

- **`'drift'` 必须留在 `RUNTIME_ONLY_FIELDS`**（mermaid.ts）。漏了就是**每次保存都误报**
  `serialize.not-idempotent` —— 实测（负向对照）：把那行删掉，整套测试立刻红两条。
- **走目录有预算**：`DRIFT_WALK_MAX_DIRS=400` / `DRIFT_WALK_MAX_FILES=4000` / TTL 20s（`doc:get`
  每 2.5s 一次，不能每次都走目录）。走不完记 `truncated`，并在提示词里说明「只看了前 N 个目录」。
- **跳过名单**：与图库扫描共用 `SKIP_DIRS`，再补 `DRIFT_SKIP_DIRS`（test / fixtures / generated /
  vendor / assets / docs…）并跳过 `*.min.*`。图本来就不画测试 —— 把它们算成「漏画」会把这条信号淹掉。

界面与提示词都是**两档语气**（不许一律喊「过期」）：有 `stale` → 琥珀角标 + 琥珀横幅 +
提示词里「别照着这些锚点走」；只有 `uncovered` → 中性 `.hint` 横幅 + 提示词里
「这只是还没画，**不是**图上写错了」。一律用警告色，用户几天就学会无视它。

守门人：`test/host.e2e.mjs`【锚点保鲜 drift】（无基线不猜 / 内容没变不报 / 内容变了要报在哪条 /
覆盖与漏画的分界 / 落盘失败不记基线 / 坏表不覆盖且记日志 / 提示词两档措辞），
`test/ui.render.mjs` 第 [4t] 节（角标三态 / 检查器写原因 / 画布页横幅 / 只有漏画时降一档 / 源码页没有它）。

## 图库不会自动创建（opt-in）

**读路径一个字节都不创建。** 项目里没有 `.arch-canvas/`（或那张 `.mmd` 不存在）时，
`loadInto` 把 `doc` 置成空文档并标记 `doc.absent = true`，**不 `ensureDir`、不 `inheritGlobalOnce`、
不播种默认图**。只有两个显式入口会建：`doc:open { create: true }` / `arch_switch { create: true }`
（工具侧在建之前还会要求先征得用户同意，见 `skills/arch-canvas/SKILL.md`）。

- 为什么：早先「打开面板」这个动作本身就会在会话 cwd 下凭空建出一个 `.arch-canvas/`，
  用户只是路过了几个目录，磁盘上就多出一串空图库 —— 一个只读的界面动作不该有写副作用。
- `arch_write` / `arch_edit` 在 `doc.absent` 时**硬拒绝**（错误信息里说明「图库不会自动创建」）：
  这是**唯一**一道写图闸门了（早先那道「AI 写图开关」已连同它的界面一起移除，见下节）。
- `persist()` 是唯一会把 `absent` 清掉的地方（写成功后目录已存在）。
  `snapshotModel`/`restoreModel` 必须带上它，否则「写盘失败回滚」会把空库状态也一起回滚掉。

守门人：`test/host.e2e.mjs`【任务 1 守门断言：读路径不建库，写路径防隐式创建】
（读路径不新增任何文件 / 未建库时两个写工具的错误信息 / 建库后恢复可用）。

## 写盘必须带会话（2026-09-17 实测）

`fs` 的写入受**按调用沙箱策略**约束；不传策略的调用是 **agentless call**，会掉到部署默认
（可写根 = `process.cwd()`）。症状：dsh 从别的项目目录启动时，画布上每一次保存都被拒 ——
`persist.fail: cannot write ...: file access denied under workspace-write mode`，
而**日志照写不误**（日志走外层注入的 `node:fs`，不经过这道围栏）。这不是权限不够，
是「这次写属于哪个会话」没说。**正解不是绕开 `fs`**：

```js
const policy = ctx.sandboxPolicy.resolve({ session })   // 只传 session，绝不传 mode
await fs.writeText(target, body, undefined, undefined, policy)
```

四条不许破：

1. **绝不自己传 `mode`。** 传 mode 等于声称「一次已批准的显式模式」，会越过会话自己的模式
   —— 那是**放大权限**，不是修复。让归属方去算。守门人是 `test/host.e2e.mjs` 里那条
   断言 `resolve` 入参 `mode === undefined`。
2. **会话从哪来**：AI 工具走 `exec.agent.session`；面板的 RPC 走客户端传上来的 `sessionId`
   → `ctx.get('agents').get(id).session`。客户端本来就拿得到它（`conversation.view`
   是 `scope: session` 的槽位，`sessionId` 是标准 props）。
3. **两个服务都走 `ctx.get`**（`sandboxPolicy` / `agents` 都是可选的，不进 `inject`）；
   拿不到会话就**不伪造策略**（退回 `undefined` = 旧行为）并落一行 `sandbox.policy.missing`
   —— 不静默，也不替用户发明一把更宽的围栏。
4. **读不传**：`stat` / `readText` / `listDir` 不受围栏，只有 `writeText` / `editText` 收策略。

dsh 侧的原文（`dsh-sandbox-policy`）："A session cwd is its workspace-write boundary;
the configured root is the fallback for **agentless calls** and sessions without a cwd."

## 改动生效路径（重要：不知道这条会以为是 bug）

| 改了什么 | 怎么让它生效 |
|---|---|
| `src/client/*` | `npm run build` → **刷新页面**（host 每次请求都现读 `lib/ui.js`） |
| `src/host/*`、`src/package/*` | 先看部署是**链接**还是**快照**（见下）；最稳的是 build → 重装 → **重启 dsh** |
| `src/bootstrap/*` | 动态 Package 形态：重新 `cordis_define` + `cordis_run` |

**先查部署是哪种安装 —— 这一步决定上面所有结论（2026-09-17 实测）**：

```sh
grep arch-canvas ~/.dsh/profiles/web/package.json    # file:...tgz = 快照；link:... = 链接
ls -l ~/.dsh/profiles/web/node_modules/arch-canvas    # 真目录 = 快照副本；符号链接 = 指向项目
```

- **`link:` / 符号链接**（`dsh plugin --profile web add <本目录>` 装出来的就是这种）：
  `node_modules` 指向项目目录，本机 profile 里 hmr 的 `base` 也对得上，`npm run build`
  之后文件真的换了 → 能重载。这是文档一直假设的形态，也是**推荐**的装法。
- **`file:...tgz` / 真目录**：pnpm 复制了一份**快照**。此后**改仓库对运行态零影响**，
  盯着仓库的 hmr 只会把那份**旧快照**重新挂一遍 —— 症状与「没重载」一样，日志里却有一条
  `plugin.mount`，极容易被误判成「已经生效」。

  实测（当时正是快照安装）：把安装目录更新成新构建之后，运行态**仍是旧宿主代码**；
  三种重载触发全部无效 —— `touch lib/index.js`、往 `lib/index.js` 追加真实内容、
  改 profile 的 `cordis.patch.yml`（指望 `patchReload: live`）。**只有重启 dsh
  才能换掉已经加载进内存的宿主代码。**

**半新的客户端是最危险的**：`lib/ui.js` 是 host **每次请求现读磁盘**的，所以一更新安装目录，
界面立刻是新的、宿主还在内存里跑旧的。旧宿主的 `normalizeModel` 是逐字段重建
（见「元素上的东西」一节），它会**静默丢掉**新界面发来的字段 —— 用户看到「写了就没了」。
所以要么两边一起换（重启），要么先别动。

上线的顺序：`npm run build` → `npm run pack`（落点 `${DSH_HOME:-~/.dsh}/packages/`）→
`dsh plugin --profile web add <包>`（改写 profile 依赖，最干净）或直接把包解到
`~/.dsh/profiles/web/node_modules/arch-canvas/` → **重启 dsh**。

**怎么确认真的上线了（测试抓不到的那一层）**：`test/*` 用的是桩 `fs`，
「真机上存不下来」这类问题它一条都抓不到。对活着的进程打一次真 RPC：

```sh
curl -s -X POST http://127.0.0.1:3080/arch-canvas/rpc -H 'content-type: application/json' \
  -d '{"method":"doc:get","args":{"where":"<项目目录>"}}'
```

挑一个**只有新宿主才会返回**的字段来验（例如加留言功能时的 `noteCount`）。
**`plugin.mount` 那一行不能当证据** —— 它可能只是把旧快照重新挂了一遍。

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

**级别门槛**：`debug` / `info` / `warn` / `error`，缺省 `info`（`hostEnv.logLevel`，
真插件读 `ARCH_CANVAS_LOG_LEVEL`）。高频成功路径（如 `library.scan`）记 `debug`，
排查时把门槛调低就能看到 —— 但**别用它当借口记噪音**：默认门槛下也不该出现的东西就别写。
**重复行**：同一内容的重复事件要去重（`plugin.mount` 用 `globalThis` 标记按挂载形状去重、
`doc.load` 按文件名+内容去重）。实测 hmr 每次构建会让模块重新求值，一天能刷出 46 行
逐字节相同的 `plugin.mount`。

## 检查点：安全靠「退得回去」，不靠「拦得住」（`src/host/history.ts`）

**这里换掉的是早先那道「AI 写图开关」，而它被换掉的原因是它根本用不了**（2026-09-18 活体实测）：

```
setting:set → {"ok":false,"error":"cannot write \"~/.dsh/arch-canvas/settings.json\":
               file access denied under workspace-write mode"}
```

开关状态要落盘到 `<dataDir>/settings.json`（在会话工作区之外），而那次 `fs.writeText`
**没带沙箱策略** —— 与「写盘必须带会话」是同一个坑，只是藏在一个不常走的 RPC 里。
后果是：面板上那个按钮在真机上永远打不开（日志里连着三行 `rpc.fail method=setting:set` 就是用户
反复点它）。**别在一个不可用的机制上继续加安全论证** —— 换成一条真正兜底的路：

1. **每次落盘留一份快照，并标明是谁改的。** 收口在 `persist()`（所有写入的唯一出口），
   标签取 `doc.updatedBy` + `lastChange.nodes` + 站点（`arch_edit` / `doc:set` / `rollback:<seq>` …）。
   于是「AI 改的」和「用户改的」在同一条时间线上分得清，且**不需要每个调用点自己记得记一笔**。
2. **「退回」不是撤销，是重放。** `applyRollback(seq)` 把那一份正文重新装进文档并落盘，
   然后在末尾**追加**一条「用户 · 回到检查点」—— 时间线只增不减，所以退回之后还能再往前走
   （更晚的检查点还在）。界面上那 60 步 Ctrl+Z 是另一层（只在内存、只管这一次会话的手动编辑）。
3. **只在内存里，按文件分开存**（键就是 `doc.file`，上限 50 份，内容逐字节相同不重复记）。
   真相源始终是那个 `.mmd` 文件，历史只在「刚刚改坏了、撤回去」这个窗口里有价值；
   写盘要再挂一条沙箱策略路径（正是上面那个坑），代价与收益不成比例。
   代价是**重启后清空** —— 面板上如实写着这句，别让它看起来像个持久化版本库。
4. **写盘失败的那一次不进历史**：历史里不能有「从来没落到盘上」的状态。
   反过来，两个写工具在落盘失败时**必须回 `ok: false` + 把原因塞进 `problems`**
   （内存已经回滚了，回执还说「已更新」就是骗 AI）。

守门人：`test/host.e2e.mjs`【检查点（快照）】（打开即一份 / AI 与用户分得清 / 内容没变不重复记 /
退回 + 再前进 / 三种边界拒绝 / 失败不进历史 / 按文件分开 / 50 份上限），
`test/ui.render.mjs` 第 [4e] 节（「历史 N」按钮、清单、两步确认、真发 `doc:rollback`）。

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

客户端的 `exports.inject` 同理：只列 `slots`（注册主窗口子页），
**不列 `timer`** —— 没有它界面靠 `ctxTimeout/ctxInterval` 回退到原生定时器
（`src/client/runtime.ts`），列了而部署里没有就永远 park。

**可选取用的服务必须走 `ctx.get(name)`。** Cordis 对**未 inject** 的服务，直接读属性是**抛错**
（`cannot get property "timer" without inject`），**不是**给 `undefined` —— 所以
`typeof ctx.interval === 'function'` 这种「探测一下有没有」的写法会当场炸，兜底分支根本没机会跑。
客户端那个「没有 timer 就退回原生定时器」的兜底就是这么坏掉的：真插件形态的客户端只 inject
`slots`，于是**装机形态一渲染就崩、面板一片空白**（动态形态 inject 了
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
选择器、按路径打开、子页登记。两条必须照做的规矩：

1. **DOM 必须在 `import('react-dom/client')` 之前就位。** react-dom 在**模块求值期**就用
   `window` / `document` 探测能力；晚一步它就会认为环境不支持 input 事件，改走 IE 时代的
   `propertychange` 分支 —— 症状是 `onChange` 永不触发、`focusin` 直接抛
   `attachEvent is not a function`。所以那个测试里 React 走的是动态 import。
2. **`stage` 这类 JSX 在 `return` 之前就构造好了**，它用到的派生值必须声明在**那之前**。
   把 `var libItems = …` 写在 `return` 前几行看着没问题，实际会被 `var` 提升成 `undefined`，
   整个面板渲染崩溃 —— 表现就是「打开画布一片空白」。这条被 `ui.render.mjs` 当场抓到过一次。

改面板结构时先跑它；它断言的是按钮文案与 DOM 结构（用户看得见的那层契约）。

## 画布住在主窗口子页里（2026-09-21 搬过来的）

`conversation.view` 的契约是**一次只渲染一个**（shell 用 `renderSlot(..., { only: viewId })`），
所以「切到对话」= **卸载整个 ArchStudio**。这条契约牵出三件事，改界面时必须知道：

1. **组件里的一切都会归零**：缩放/平移、当前子页、内存里那 60 步撤销历史。所以「你摆到哪儿了」
   存在模块级的 `studioMemo`（`src/client/studio.ts`），按 `<会话>|<文档>` 分开：
   - **只记用户自己动过的**：`userViewRef`（滚轮缩放 / 平移 / 点「适应窗口」/ 从留言清单定位）
     与「撤销栈非空」。自动适应窗口算出来的视角**不记** —— 下次挂载一样能算出来，记了反而把它锁死。
   - **不记图内容**（内容永远以宿主的 `doc:get` 为准），**不记选中与详情面板**：详情里那一堆
     输入框是「正在改的东西」，只把面板还回来而草稿是空的，等于把上一次的正文摆在回车即生效的框里。
   - **`committedRef` 不还**（必须等于刚 `doc:get` 回来的那份），否则回来后的第一次编辑会把
     「离开之前的旧状态」记成历史 —— 一撤销就吃掉离开期间 AI 的改动。
   - 文档身份取 `key || diagram || file`：**外部文件只有 `file` 认得出来**，认错就是把 A 的撤销栈
     安到 B 头上（拿 A 的内容覆盖 B）。
2. **宿主的 `lastChange` 会随 `doc:get` 一直回来**（`summaryOf()` 无条件带上它），所以
   「AI 刚改了 N 个节点」的高亮必须由客户端按「文档 + 修订号」去重（`memo.hlKey`）——
   否则每次切页回来都会把**同一次**旧改动再脉动 5.2 秒、顶栏再喊一遍。
3. **左下角那个入口没了**（`sidebar.footer.action` + `sidebarRightTabs` 一起摘掉，客户端
   `exports.inject` 因此只剩 `slots`）。代价：**空白会话里没有任何入口打开画布** ——
   那个槽只在有会话时渲染。这是已知取舍，不是 bug（要改就得另找一个常驻落脚点）。
4. **粘滞的都是「开关」，状态不是。** 画布**页**（`.ac-dock` 那个下挂检查器）也是同一个道理：
   详情只在**没有位移的那一次抬手**上展开（`DRAG_SLOP = 4px` 的抖动门槛），
   因为拖动就是从 pointerdown 开始的，按下即弹会把画布挤矮、把节点挤出视野。
   守门人：`test/ui.render.mjs` 第 [4r] G、第 [4s] 节（各含负向对照）。

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
- `src/host/history.ts` —— 检查点（快照）环形缓冲：按文件存正文、标明谁改的、退回即重放。
  排在 `document.ts` 之后拼接（它读 `doc` / `lastChange` / `serializeDoc`，同一段作用域）。
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
