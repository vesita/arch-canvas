// ==================== 文件日志 ====================
// 这个插件对 console 一字不吐（挂载播报会变成一屏噪音，故障一律抛错），
// 所以出问题时唯一的现场就是这些 .log 文件：挂载结果、AI 工具调用、落盘失败、
// 解析告警、RPC 出错都记在这里。按天一个文件，超过保留期的自动清掉。
//
// 真正的写盘能力由外层（lib/index.js 或动态引导层）通过 hostEnv.logBackend 注入 ——
// 两种形态的 IO 差异全收在那一层，这里只认这些方法：
//   append(dir, file, text)  追加
//   list(dir)                目录里的文件名
//   remove(dir, file)        删掉（动态形态的 fs 服务没有 unlink，退化成清空 + 不再列出）
//   ensureDir(dir)           确保目录存在
//   size(dir, file)          现有字节数（当日上限用）
// 没注入 backend 就整个不写：日志坏掉绝不能把插件带崩，也不能让它变哑。

var LOG_KEEP_DAYS = 3
var LOG_MAX_BYTES = 8 * 1024 * 1024
var logBackend = (typeof hostEnv === 'object' && hostEnv && hostEnv.logBackend) || null
var logState = { day: '', bytes: 0, capped: false, cappedDropped: 0 }
var logQueue: Promise<any> = Promise.resolve()

/** 日志落地目录：跟全局图库同一个位置，排查时只找一个地方。 */
function logDir() { return GLOBAL_DIR + '/logs' }

function logDay(ts) {
  var d = new Date(ts)
  var m = d.getMonth() + 1
  var day = d.getDate()
  return d.getFullYear() + '-' + (m < 10 ? '0' + m : '' + m) + '-' + (day < 10 ? '0' + day : '' + day)
}

function logFileName(day) { return 'arch-canvas-' + day + '.log' }

function logDayOfName(name) {
  var m = /^arch-canvas-(\d{4}-\d{2}-\d{2})\.log$/.exec(String(name == null ? '' : name))
  return m ? m[1] : ''
}

/** 一行一个 JSON 对象：能直接 grep，也不用担心字段里的换行把格式撑破。 */
function logText(level, event, fields) {
  var row: Record<string, any> = { t: new Date().toISOString(), lvl: level, ev: event }
  if (fields) {
    for (var k in fields) {
      if (fields[k] !== undefined && fields[k] !== null) row[k] = fields[k]
    }
  }
  var text
  try {
    text = JSON.stringify(row)
  } catch (e) {
    text = '{"t":"' + row.t + '","lvl":"' + level + '","ev":"' + event + '","error":"日志字段无法序列化"}'
  }
  return text + '\n'
}

/** 记一行。异步、串行、永不抛错 —— 日志写不进去也只是没日志。 */
function logEvent(level, event, fields) {
  if (!logBackend) return
  var text = logText(level, event, fields)
  logQueue = logQueue.then(function () { return writeLog(text) }).catch(function () {})
}

async function writeLog(text) {
  var now = Date.now()
  var day = logDay(now)
  if (day !== logState.day) {
    // 跨天（或本次进程第一次写）：建目录、量一下当天文件已有多少、顺手清一次旧日志。
    // 清理挂在这里而不是定时器上 —— 不会泄漏，也不需要额外的生命周期管理。
    logState.day = day
    logState.capped = false
    logState.cappedDropped = 0
    await logBackend.ensureDir(logDir())
    try { logState.bytes = await logBackend.size(logDir(), logFileName(day)) } catch (e) { logState.bytes = 0 }
    await pruneLogs(now)
  }
  if (logState.capped) { logState.cappedDropped += 1; return }
  if (logState.bytes + text.length > LOG_MAX_BYTES) {
    // 出故障时最怕日志自己变成故障：写满上限就只留一条说明，之后不再写。
    logState.capped = true
    await logBackend.append(logDir(), logFileName(day), logText('warn', 'log.capped', { limitBytes: LOG_MAX_BYTES }))
    return
  }
  logState.bytes += text.length
  await logBackend.append(logDir(), logFileName(day), text)
}

/** 清掉保留期之外的日志。文件名里带日期，所以不依赖 mtime（fs 服务的 stat 里没有）。 */
async function pruneLogs(now) {
  var cutoff = new Date(now)
  cutoff.setDate(cutoff.getDate() - LOG_KEEP_DAYS)
  var keepFrom = logDay(cutoff.getTime())
  var names = []
  try { names = await logBackend.list(logDir()) } catch (e) { return }
  var removed = 0
  var failed = 0
  for (var i = 0; i < names.length; i++) {
    var day = logDayOfName(names[i])
    if (!day || day >= keepFrom) continue  // YYYY-MM-DD 的字符串序就是日期序
    try {
      await logBackend.remove(logDir(), names[i])
      removed += 1
    } catch (e) {
      failed += 1
    }
  }
  if (removed > 0 || failed > 0) {
    logEvent('info', 'log.retention', { removed: removed, failed: failed, keepDays: LOG_KEEP_DAYS, dir: logDir() })
  }
}
