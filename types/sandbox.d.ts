// 沙箱环境声明。
//
// src/host/* 与 src/client/* 不是模块：它们会被 tools/build.mjs 拼成**一段函数体**，
// 由宿主（vm + eval 工厂）或浏览器（<script>）整体求值。没有 import/export，
// 跨文件共享靠同一段作用域，外部能力全部由沙箱注入。
//
// 因此这些文件必须按 global script（module: none）编译 —— 不能出现 import/export。
// 而且 **host 与 client 必须分成两个编译程序**：它们运行时本就是两个独立作用域，
// 放进同一个程序会因 msgOf 之类的重名而 Duplicate identifier（见 tsconfig.*.json）。

// ==================== 宿主侧注入 ====================

/**
 * 动态 Package 的宿主注入对象。
 * 真插件形态下 lib/index.js 提供等价物（handle → HTTP 路由，registerTool → ctx.tools.register）。
 */
declare const harness: {
  /** 注册一个 Package 私有 RPC 处理函数，返回注销函数。 */
  handle(name: string, fn: (args: any) => any): () => void
  /** 登记一条静态路由。**只登记不注册** —— webServer.register 由外层在服务就绪后做。 */
  route(path: string, handler: (req: any, res: any) => any): void
  /** 校验并原样返回工具定义（真插件的 ToolDefinition 就是那个形状）。 */
  defineTool<T>(def: T): T
  /** 把工具注册进会话的工具注册表。 */
  registerTool(ctx: CordisCtx, def: any): void
}

/**
 * Cordis 上下文。
 *
 * 注意它**不是全局变量**：运行时由构建期包装（`return { apply: function (ctx) {`）
 * 或 lib/index.js 的 plugin.apply(ctx) 作为参数传入。这里声明成环境变量，是因为
 * 被拼接的片段在包装之前就以顶层代码的身份引用了它 —— 这是「片段不是模块」的代价，
 * 换成 import 反而会破坏拼接。
 */
declare const ctx: CordisCtx

interface CordisCtx {
  get(name: string): any
  effect(fn: () => any): () => void
  /** 服务就绪后回调（服务上下线会重跑）—— 依赖服务的正确姿势，别用 get 取快照。 */
  inject(names: string[], callback: (ready: any) => void): () => void
  interval?(cb: () => void, ms: number): () => void
  timeout?(cb: () => void, ms: number): () => void
  slots?: any
  sidebarRightTabs?: any
  /** 服务按名字取用，允许任意扩展。 */
  [key: string]: any
}

/** 日志后端：按形态注入 —— 真插件用 node:fs（能追加、能删），动态形态用 fs 服务。 */
interface LogBackend {
  /** 追加一行到 dir/file。 */
  append(dir: string, file: string, text: string): Promise<any>
  /** dir 里的文件名（只列日志文件，清空过的旧日志可以不出现在这里）。 */
  list(dir: string): Promise<string[]>
  /** 删掉 dir/file（没有 unlink 的形态退化成清空）。 */
  remove(dir: string, file: string): Promise<any>
  ensureDir(dir: string): Promise<any>
  /** dir/file 现有字节数，不存在算 0。 */
  size(dir: string, file: string): Promise<number>
}

/** 拼接后由外层注入：包内资源路径、数据目录、日志后端。两种形态都必须递。 */
declare const hostEnv: {
  /** 界面脚本（真插件 <包>/lib/ui.js，动态形态 <项目>/dist/ui.js）。 */
  uiFile: string
  /** 随包分发的 mermaid bundle。 */
  mermaidFile: string
  /** 数据目录：全局图库与日志写在这里（真插件按 $DSH_HOME / ~/.dsh 算）。 */
  dataDir: string
  logBackend?: LogBackend
} | undefined

/** 真插件形态是普通 Node，靠它读 $DSH_HOME 定数据目录。 */
declare const process: { env: Record<string, string | undefined> }

// ==================== 浏览器侧注入 ====================

/** 沙箱注入的 React（真插件形态由 lib/client.js 经 __archCanvasDeps 递进来）。 */
declare const React: any
/** 动态 Package 的 Package 私有 RPC；真插件形态下改用注入的 rpc。 */
declare const host: { call(method: string, args?: any): Promise<any> } | undefined
/** 样式注入（动态形态由沙箱提供，真插件形态由 lib/client.js 提供等价实现）。 */
declare const styles: { insert(css: string): () => void }
/** 引导层经 __archCanvasDeps 递进来的 RPC 出口。 */
declare const __rpc: ((method: string, args?: any) => Promise<any>) | undefined
/** 界面本体挂到全局，供引导层调用 install。 */
declare const __deps: { React?: any; host?: any; styles?: any; rpc?: any }

// ==================== 普通 Node（真插件形态） ====================

declare const require: {
  (id: string): any
  /** 真插件半边用它清 CJS 缓存，好让 hmr 重新 import 时连 host-logic 一起换新。 */
  resolve(id: string): string
  cache: Record<string, any>
}
declare const module: { exports: any }
declare const __dirname: string
declare const Buffer: any

// ==================== 浏览器 ====================

interface Window {
  /** 界面本体暴露的安装入口（dist/ui.js 的结尾）。 */
  __archCanvas?: { install(ctx: CordisCtx): () => void }
  /** 引导层递给界面本体的依赖。 */
  __archCanvasDeps?: { React?: any; host?: any; styles?: any; rpc?: any }
  /** Mermaid 11 的 UMD 包加载后挂在 window 上。 */
  mermaid?: any
  /** 真插件形态的客户端模块加载协议（由页面加载器提供）。 */
  __ModuleLoader__?: {
    load(spec: { id: string; factory: (require: (id: string) => any) => any }): void
  }
}
