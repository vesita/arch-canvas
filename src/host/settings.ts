// ==================== AI 写图开关 ====================
// **默认关**：用户没有在画布面板上显式打开之前，AI 的 `arch_write` / `arch_edit` 一律被拒。
// 这不是「AI 少做一件事」的礼貌约定，而是**硬闸门** —— 拿不到开关状态、读盘失败、JSON 坏了，
// 一律按「关」处理（fail-closed：宁可让 AI 少写，也不许它在你没同意时改图）。
//
// 为什么自建这套，而不是走 `ctx.settings.installSection`：
// 那条路要在宿主组合里注册命名空间**外加一张设置卡片**（本插件没有卡片，dsh-collab 才有），
// 而本插件已经有自己的 RPC 通道与侧栏面板 —— 复用它们少一个部署依赖，两种形态（真插件 /
// 动态 Package）都能用，也不必让客户端去 inject 设置服务。
//
// 存储：`<dataDir>/settings.json`，与图库、日志同一个地方，排查时只看一处。
// 只认显式 `aiWrite: true`：其余取值（缺字段、"true" 字符串、文件不存在、解析失败）都是关。

var AI_WRITE_SETTING_FILE = 'settings.json'

/** 当前状态。**只在 ensureAiWriteLoaded / setAiWriteEnabled 里改**，别的地方只读它。 */
var aiWriteEnabled = false

/** 惰性加载的一次性 promise：第一次问到才读盘，之后复用（RPC 与工具闸门共用）。 */
var aiWriteLoadPromise: Promise<any> | null = null

/** 开关文件的绝对路径。GLOBAL_DIR 来自 document.ts（运行时同一段作用域）。 */
function aiWriteSettingPath() { return GLOBAL_DIR + '/' + AI_WRITE_SETTING_FILE }

/** 读一次磁盘。任何异常都按「关」处理 —— 日志坏掉不能把插件带崩，开关坏掉更不能放开写入。 */
async function readAiWriteSetting() {
  try {
    var text = await fs.readText(await fs.resolve(aiWriteSettingPath()))
    var obj = JSON.parse(text)
    aiWriteEnabled = !!(obj && obj.aiWrite === true)
  } catch (e) {
    aiWriteEnabled = false
  }
  return aiWriteEnabled
}

/** 确保已经读过一次磁盘（幂等）。工具闸门与 RPC 都先 await 它。 */
function ensureAiWriteLoaded() {
  if (!aiWriteLoadPromise) {
    aiWriteLoadPromise = readAiWriteSetting().catch(function () { aiWriteEnabled = false })
  }
  return aiWriteLoadPromise
}

/**
 * 改开关并落盘。**先写盘再改内存**：写不进去就不改内存，调用方拿到的是真错误
 * （否则界面显示"已打开"、闸门却还是关的 —— 那种不一致比报错难查得多）。
 */
async function setAiWriteEnabled(on) {
  var next = on === true
  await ensureDir(GLOBAL_DIR)
  var body = JSON.stringify({ aiWrite: next, updatedAt: new Date().toISOString() }, null, 2) + '\n'
  await fs.writeText(await fs.resolve(aiWriteSettingPath()), body)
  aiWriteEnabled = next
  logEvent('info', 'aiwrite.set', { enabled: next, file: aiWriteSettingPath() })
  return next
}

/** 给 AI 看的拒绝理由：要能一句话说清「为什么没生效」和「接下来该干什么」。 */
function aiWriteOffMessage(tool) {
  return 'AI 改图当前是**关闭**的（默认关闭），' + tool + ' 没有任何改动。'
    + '用户可以在画布面板顶栏点一下「AI 只读」开关打开它（打开后按钮变成「AI 可改图」）。'
    + '在此之前请不要改图：用 arch_read 读，把想改的内容写在回复里请用户确认。'
}
