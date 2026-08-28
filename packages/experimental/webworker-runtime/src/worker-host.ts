/**
 * Worker assembly entry: the whole harness Cordis tree inside one dedicated
 * Web Worker.
 *
 * Every platform object arrives through options — the `node:*` proxy table, the
 * request listener the app's fake `node:http` captured, the image bytes — so this
 * package never reaches back into the application that composes it. **Platform
 * readiness before the call is the caller's responsibility**: anything the
 * proxies need initialized (the zstd WebAssembly module, for one) must be ready
 * before {@link startWorkerHost} runs.
 *
 * Construction is split in two on purpose. {@link createWorkerHost} is
 * synchronous so the worker can accept messages and queue requests that arrive
 * during boot; {@link WorkerHost.start} then mounts the image, the module
 * loader, and the tree. {@link startWorkerHost} performs both and installs the
 * message handler before its first await.
 *
 * The tree itself boots through the host's own `boot()` glue loaded from the
 * image, so entry mounting, the activation audit, and its diagnostics are the
 * same code the Node deployment runs. Only the module seam and the command line
 * are supplied from here.
 * @module @deepseek-ai/dsh-experimental-webworker-runtime/src/worker-host
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 worker host 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */
import { setActiveModuleLoader, WorkerModuleLoader, type StaticModuleFactory } from './module-system/module-loader.ts'
import type { TypertGateway } from '@deepseek-ai/dsh-api-gateway'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import type { AlsCausality } from './polyfill/async-context/als-runtime.ts'
import { dirname, join } from './module-system/posix-path.ts'
import { installProcessGlobal } from './node/globals/process.ts'
import type { RequestListener } from './transport/synthetic-http.ts'
import { TunnelServer, type TunnelPort } from './transport/tunnel.ts'
import { inflateImage, inflateImageStream } from './storage/image-gzip.ts'
import { loadVfsImage, loadVfsOverlay, MemoryVfs } from './storage/memory.ts'
import { setActiveVfs } from './storage/active.ts'
import {
  DEFAULT_ROOT, IMAGE_CONFIG_PATH, IMAGE_EMPTY_DIRECTORIES, IMAGE_HOME_DIRECTORY, IMAGE_MANIFEST_PATH,
  LOWERING_VERSION,
} from './image-layout.ts'

export { DEFAULT_ROOT } from './image-layout.ts'

/** Port reported to the tree when the caller names none; the bind is fake either way.
 * @remarks 中文说明：常量说明：DEFAULT_PORT 用于处理 DEFAULT_PORT 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const DEFAULT_PORT = 3080

// Every literal `require`/`resolve` of an image package below must appear in
// the packer's IMAGE_ENTRY_SEEDS: no image file references these requests, so
// the reachability sweep only keeps them when seeded.

/** One structured log record, as cordis delivers it to an exporter. */
export interface LogMessage {
  readonly name: string
  readonly type: 'error' | 'info' | 'warn' | 'debug'
  readonly args: readonly unknown[]
}

/** The exporter face `ctx.logger.exporter()` accepts. */
export interface LogExporter {
  readonly colors: false
  /** Verbosity gate, per logger name or `default`; cordis drops a message when its level exceeds this. */
  readonly levels: { readonly default: number }
  /**
   * 功能说明：处理 export 相关流程；使用场景由所在模块及调用位置决定。
   * @param message （LogMessage）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 export(message)，并按返回类型处理结果。
   */
  export(message: LogMessage): void
}

/** Minimal view of the Cordis context the entry itself touches. */
/**
 * 功能说明：处理 exporter 相关流程；使用场景由所在模块及调用位置决定。
 * @param exporter （LogExporter）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns unknown；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 exporter(exporter)，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 dispose 相关流程；使用场景由所在模块及调用位置决定。
 * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 dispose()，并按返回类型处理结果。
 */
export interface HostContext {
  loader: { internal: unknown }
  logger: { exporter(exporter: LogExporter): unknown }
  /**
   * 功能说明：获取 get 相关流程；使用场景由所在模块及调用位置决定。
   * @param service （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns unknown；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 get(service)，并按返回类型处理结果。
   */
  get(service: string): unknown
  /**
   * 功能说明：处理 provide 相关流程；使用场景由所在模块及调用位置决定。
   * @param name （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 provide(name, value)，并按返回类型处理结果。
   */
  provide(name: string, value: unknown): void
  fiber: { dispose(): Promise<void> }
}

/** Construction inputs for {@link createWorkerHost}. */
export interface WorkerHostOptions {
  /**
   * Modules served from the worker bundle rather than the image: the `node:*`
   * proxies, the not-implemented stubs for excluded npm packages, and anything else whose
   * platform behavior differs. `node:process` and `process` are added when absent,
   * as factories reading the installed global.
   */
  readonly staticModules: Readonly<Record<string, StaticModuleFactory>>
  /** Prefix-matched proxies, for packages whose subpaths are open-ended. */
  readonly staticModulePrefixes?: Readonly<Record<string, StaticModuleFactory>>
  /**
   * The webserver's request listener, captured by the app's fake `node:http`.
   * Awaited on first tunnel use, so it may resolve after the tree binds.
   */
  readonly requestListener: () => Promise<RequestListener>
  /** Image bytes, or the URL the worker fetches them from. */
  readonly image: Uint8Array | string
  /** Ordered data overlays applied after the base image and before boot. */
  readonly overlays?: readonly (Uint8Array | string)[]
  /** Virtual root; defaults to {@link DEFAULT_ROOT}. */
  readonly root?: string
  /** Composed configuration inside the image; defaults to `<root>/config/cordis.yml`. */
  readonly configPath?: string
  /**
   * Inner arguments the tree parses. The default binds the web server to the
   * loopback authority the tunnel synthesizes, which also keeps
   * `networkInterfaces()` out of the trust snapshot.
   */
  readonly cmdlineArgs?: readonly string[]
  /** Port named on the default command line; defaults to {@link DEFAULT_PORT}. */
  readonly port?: number
  /** Environment for the process shim; `DSH_HOME` defaults to `<root>/home`. */
  readonly env?: Readonly<Record<string, string>>
  /**
   * Image manifest path; defaults to `<root>/config/vfs-manifest.json`. Its
   * `lowered` field must name this build's wrapper contract.
   */
  readonly manifestPath?: string
  /**
   * Ambient-store snapshot face exported by the app's `node:async_hooks` proxy.
   * The rewrite that carries stores across suspension points moves state through
   * it; the proxy remains the only owner of that state.
   */
  readonly alsCausality?: AlsCausality
  /** Privileged API methods that skip the route lane; see {@link TunnelServer}. */
  readonly privilegedMethods?: ReadonlySet<string>
  /** Escape hatch for the unary `/api` lane; see {@link TunnelServer}. */
  readonly unaryApiLane?: 'route' | 'direct'
  /** Channel back to the page; defaults to the worker global scope. */
  readonly channel?: TunnelPort
}

/** The assembled worker host. */
export interface WorkerHost {
  /** Feed one `postMessage` payload; safe before {@link WorkerHost.start}.
   * @remarks 中文说明：功能说明：处理 Message 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：data（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 handleMessage(data)，并按返回类型处理结果。 */
  handleMessage(data: unknown): void
  /**
   * Mount the image and boot the tree, then start serving queued requests.
   * @returns Resolves once the tree is active and the tunnel is serving.
   * @remarks 中文说明：功能说明：启动 start 相关流程；使用场景由所在模块及调用位置决定。；返回值：Promise<void>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 start()，并按返回类型处理结果。
   */
  start(): Promise<void>
  /** Dispose the tree; the tunnel keeps refusing afterwards.
   * @remarks 中文说明：功能说明：停止 stop 相关流程；使用场景由所在模块及调用位置决定。；返回值：Promise<void>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 stop()，并按返回类型处理结果。 */
  stop(): Promise<void>
  /** Filesystem the tree reads, once {@link WorkerHost.start} mounted it. */
  readonly vfs: MemoryVfs | undefined
  /** Module loader behind the Cordis module seam. */
  readonly modules: WorkerModuleLoader | undefined
}

/**
 * 功能说明：处理 requireGlobalPort 相关流程；使用场景由所在模块及调用位置决定。
 * @param channel （TunnelPort | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns TunnelPort；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 requireGlobalPort(channel)，并按返回类型处理结果。
 */
function requireGlobalPort(channel: TunnelPort | undefined): TunnelPort {
  if (channel !== undefined) return channel
  /**
   * 常量说明：scope 用于处理 scope 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const scope = globalThis as { postMessage?: TunnelPort['postMessage'] }
  /**
   * 常量说明：post 用于处理 post 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const post = scope.postMessage
  if (typeof post !== 'function') {
    throw new Error('webworker host: no channel; pass options.channel outside a dedicated worker')
  }
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：message（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：transfer（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(message, transfer)，
   * 并按返回类型处理结果。
   */
  return { postMessage: (message, transfer) => { post(message, transfer) } }
}

/**
 * 功能说明：读取 Image 相关流程；使用场景由所在模块及调用位置决定。
 * @param image （Uint8Array | string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Promise<Uint8Array>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 readImage(image)，并按返回类型处理结果。
 */
async function readImage(image: Uint8Array | string): Promise<Uint8Array> {
  if (typeof image !== 'string') return await inflateImage(image, 'the image bytes given to createWorkerHost')
  /**
   * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const response = await fetch(image)
  if (!response.ok) throw new Error(`webworker host: image fetch failed with ${String(response.status)} for ${image}`)
  if (response.body === null) throw new Error(`webworker host: image response for ${image} carried no body`)
  // Inflated off the response stream: the archive is built while the rest of the
  // image is still arriving.
  return await inflateImageStream(response.body, image)
}

/**
 * Build the worker host without touching the network or the image.
 * @param options - Assembly inputs.
 * @returns Handle whose `handleMessage` is ready immediately.
 * @remarks 中文说明：功能说明：创建 Worker Host 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：options（WorkerHostOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；
 * 返回值：WorkerHost；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * createWorkerHost(options)，并按返回类型处理结果。
 */
export function createWorkerHost(options: WorkerHostOptions): WorkerHost {
  /**
   * 常量说明：root 用于处理 root 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const root = options.root ?? DEFAULT_ROOT
  /**
   * 常量说明：configPath 用于处理 configPath 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const configPath = options.configPath ?? join(root, IMAGE_CONFIG_PATH)
  /**
   * 常量说明：port 用于处理 port 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const port = options.port ?? DEFAULT_PORT
  /**
   * 常量说明：tunnel 用于处理 tunnel 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const tunnel = new TunnelServer({
    port: requireGlobalPort(options.channel),
    requestListener: options.requestListener,
    ...options.privilegedMethods === undefined ? {} : { privilegedMethods: options.privilegedMethods },
    ...options.unaryApiLane === undefined ? {} : { unaryApiLane: options.unaryApiLane },
  })

  /**
   * 变量说明：vfs 用于处理 vfs 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let vfs: MemoryVfs | undefined
  /**
   * 变量说明：modules 用于处理 modules 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let modules: WorkerModuleLoader | undefined
  /**
   * 变量说明：context 用于处理 context 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let context: HostContext | undefined

  /**
   * 常量说明：start 用于启动 start 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：启动 start 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 start()，并按返回类型处理结果。
   */
  const start = async (): Promise<void> => {
    /**
     * 变量说明：reason 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      /**
       * 常量说明：home 用于处理 home 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const home = join(root, IMAGE_HOME_DIRECTORY)
      installProcessGlobal({ cwd: root, env: { DSH_HOME: home, HOME: home, ...options.env } })

      /**
       * 常量说明：bytes、overlays 用于处理 bytes、overlays 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const [bytes, overlays] = await Promise.all([
        readImage(options.image),
        Promise.all((options.overlays ?? []).map(readImage)),
      ])
      /**
       * 常量说明：mounted 用于处理 mounted 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const mounted = loadVfsImage(bytes, root)
      /**
       * 变量说明：overlay 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const overlay of overlays) loadVfsOverlay(overlay, root, mounted)
      // Belt and braces over the image's own empty-directory entries: a hand
      // -built image without them still boots.
      /**
       * 变量说明：directory 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const directory of IMAGE_EMPTY_DIRECTORIES) {
        mounted.seedDirectory(join(root, directory.replace(/\/$/, '')))
      }
      setActiveVfs(mounted)
      vfs = mounted

      /**
       * 常量说明：manifestPath 用于处理 manifestPath 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const manifestPath = options.manifestPath ?? join(root, IMAGE_MANIFEST_PATH)
      requireLoweredImage(mounted, manifestPath)
      /**
       * 常量说明：staticModules 用于处理 staticModules 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const staticModules: Record<string, StaticModuleFactory> = { ...options.staticModules }
      // Read at require time, not here: the table entry then answers whichever
      // global `installProcessGlobal` left in place, in this role's order.
      /**
       * 变量说明：key 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const key of ['node:process', 'process']) {
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：unknown；调用方应按声明类型处理，不应假定未声明的附加状态。
         * ；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
         */
        staticModules[key] ??= (): unknown => (globalThis as { process?: unknown }).process
      }
      /**
       * 常量说明：loader 用于处理 loader 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const loader = new WorkerModuleLoader({
        vfs: mounted,
        root,
        staticModules,
        ...options.staticModulePrefixes === undefined ? {} : { staticModulePrefixes: options.staticModulePrefixes },
        ...options.alsCausality === undefined ? {} : { alsCausality: options.alsCausality },
      })
      setActiveModuleLoader(loader)
      modules = loader

      /**
       * 常量说明：require 用于处理 require 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const require = loader.requireFrom(dirname(configPath))
      /**
       * 常量说明：appBoot 用于处理 appBoot 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const appBoot = require('@deepseek-ai/dsh-app-boot') as {
        /**
         * 功能说明：处理 boot 相关流程；使用场景由所在模块及调用位置决定。
         * @param binName （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
         * @param configPath （string）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。
         * @param patches （unknown[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
         * @param prepare （(ctx: HostContext) => void）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
         * @returns Promise<HostContext>；调用方应按声明类型处理，不应假定未声明的附加状态。
         * @example 在完成前置校验后调用 boot(binName, configPath, patches, prepare)，
         * 并按返回类型处理结果。
         */
        boot(
          binName: string,
          configPath: string,
          patches: unknown[],
          prepare: (ctx: HostContext) => void,
        ): Promise<HostContext>
      }
      /**
       * 常量说明：cmdline 用于处理 cmdline 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const cmdline = require('@deepseek-ai/dsh-cmdline') as {
        /**
         * 功能说明：处理 provideCmdline 相关流程；使用场景由所在模块及调用位置决定。
         * @param ctx （unknown）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。
         * @param host （{ args: readonly string[]; exit: (code: number) => void
         * }）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
         * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
         * @example 在完成前置校验后调用 provideCmdline(ctx, host)，并按返回类型处理结果。
         */
        provideCmdline(ctx: unknown, host: { args: readonly string[]; exit: (code: number) => void }): void
      }

      /**
       * 常量说明：patches、presetOverlay 用于处理 patches、presetOverlay 相关数据，作用于当前作用域；
       * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const { patches, presetOverlay } = bootPatches(loader, mounted, configPath, root)
      /**
       * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：hostCtx（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(hostCtx)，并按返回类型处理结果。
       */
      const ctx = await appBoot.boot('dsh-webworker', configPath, patches, (hostCtx) => {
        // Before any entry mounts: the Loader would otherwise fall back to the
        // runtime's own dynamic import for every row.
        hostCtx.loader.internal = loader.internal
        installLogSink(hostCtx, require)
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：code（number）：提供本次调用所需的数据；
         * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
         * 典型用法：在完成前置校验后调用 匿名回调(code)，并按返回类型处理结果。
         */
        cmdline.provideCmdline(hostCtx, {
          args: [...(options.cmdlineArgs ?? ['--host', '127.0.0.1', '--port', String(port), '--no-open'])],
          exit: (code: number) => { console.warn(`webworker host: tree requested exit(${String(code)})`) },
        })
      })
      context = ctx

      /**
       * 常量说明：connection 用于处理 connection 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const connection = ctx.get('connection') as HostConnectionHandle | undefined
      if (connection === undefined) throw new Error('webworker host: the tree activated without a Connection service')
      /**
       * 常量说明：typertGateway 用于处理 typertGateway 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const typertGateway = ctx.get('typertGateway') as TypertGateway | undefined
      if (typertGateway === undefined) {
        throw new Error('webworker host: the tree activated without a typertGateway service')
      }
      /**
       * 常量说明：handler 用于处理 handler 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const handler = connection.createSharedFetchHandler('/api')
      /**
       * 常量说明：usage 用于处理 usage 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const usage = loader.usage()
      console.info(`webworker host: tree active (modules=${String(usage.modules)}, data overlays=${String(overlays.length)}, preset root overlay=${presetOverlay ? 'applied' : 'already in roster'}, direct lane=connection.createSharedFetchHandler, als causality=${options.alsCausality === undefined ? 'inert' : 'snapshot/restore'}, image lowering=${LOWERING_VERSION})`)

      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：request（Request）：提供调用方提交的请求信息；
       * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
       * 典型用法：在完成前置校验后调用 匿名回调(request)，并按返回类型处理结果。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      tunnel.serve({
        directFetch: (request: Request) => handler.fetch(request),
        bootPayload: () => readBootPayload(ctx),
        openStream: typertGateway.wireStream.open,
        streamFailure: typertGateway.wireStream.failure,
      })
    } catch (reason) {
      tunnel.fail(reason)
      throw reason
    }
  }

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：data（unknown）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用
   * 匿名回调(data)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：Promise<void>；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  return {
    handleMessage: (data: unknown): void => { tunnel.handleMessage(data) },
    start,
    stop: async (): Promise<void> => {
      tunnel.fail(new Error('webworker host: the tree was disposed'))
      await context?.fiber.dispose()
    },
    /**
     * 功能说明：处理 vfs 相关流程；使用场景由所在模块及调用位置决定。
     * @returns MemoryVfs | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 vfs()，并按返回类型处理结果。
     */
    get vfs(): MemoryVfs | undefined {
      return vfs
    },
    /**
     * 功能说明：处理 modules 相关流程；使用场景由所在模块及调用位置决定。
     * @returns WorkerModuleLoader | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 modules()，并按返回类型处理结果。
     */
    get modules(): WorkerModuleLoader | undefined {
      return modules
    },
  }
}

/** The cordis message renderer this sink formats through. */
export interface LogRenderer {
  /**
   * 功能说明：格式化 format 相关流程；使用场景由所在模块及调用位置决定。
   * @param exporter （LogExporter）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param message （LogMessage）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 format(exporter, message)，并按返回类型处理结果。
   */
  format(exporter: LogExporter, message: LogMessage): string
}

/**
 * Send the tree's own warnings and errors to the worker console.
 *
 * Cordis's `LoggerService` always exists and always accepts messages, but with
 * no exporter mounted it only fills a ring buffer — and no profile in this
 * repository mounts one, so `ctx.logger.warn(...)` reaches nothing. A provider
 * that fails and is skipped (the skill registry logs exactly that) then looks
 * identical to one that found nothing, which is how an empty skill catalog hid a
 * filesystem fault twice.
 *
 * Warnings and errors only: `info`/`debug` from 131 plugin rows would bury the
 * page console, and this exists to make failures visible rather than to trace.
 * @param ctx - Host context, before any entry mounts.
 * @param require - Image resolver, for cordis's own message renderer.
 * @remarks 中文说明：功能说明：处理 installLogSink 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：ctx（HostContext）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；
 * 参数说明：require（(specifier: string) => unknown）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 installLogSink(ctx, require)，并按返回类型处理结果。
 */
export function installLogSink(ctx: HostContext, require: (specifier: string) => unknown): void {
  /**
   * 常量说明：Logger 用于处理 Logger 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const { Logger } = require('@deepseek-ai/cordis') as { Logger: LogRenderer }
  /**
   * 常量说明：exporter 用于处理 exporter 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：message（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(message)，并按返回类型处理结果。
   */
  const exporter: LogExporter = {
    colors: false,
    // cordis compares `exporter.levels ?? logger.level ?? INFO` against the
    // message level and drops anything higher, and its scale counts UP with
    // verbosity (ERROR 0, INFO 1, WARN 2, DEBUG 3). An exporter that declares no
    // level therefore admits errors and info but silently drops every warning —
    // which is what the built-in ring-buffer exporter does, so the skipped-provider
    // warning this sink exists for never even reached the buffer.
    levels: { default: 2 },
    export: (message) => {
      if (message.type !== 'warn' && message.type !== 'error') return
      /**
       * 常量说明：line 用于处理 line 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const line = `${message.name}: ${Logger.format(exporter, message)}`
      if (message.type === 'error') console.error(line)
      else console.warn(line)
    },
  }
  ctx.logger.exporter(exporter)
}

/**
 * Require the mounted image to carry bodies this build can wrap.
 *
 * The manifest the packer writes is the single source of truth: the worker holds
 * no transform, so an image that was never lowered — or was lowered against
 * different wrapper semantics — cannot be recovered at load and must be rebuilt.
 * @param vfs - Mounted filesystem.
 * @param path - Manifest path inside the image.
 * @throws When the manifest is missing, unreadable, or names another contract.
 * @remarks 中文说明：功能说明：处理 requireLoweredImage 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：vfs（MemoryVfs）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：void；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 requireLoweredImage(vfs,
 * path)，并按返回类型处理结果。
 */
function requireLoweredImage(vfs: MemoryVfs, path: string): void {
  if (!vfs.existsSync(path)) {
    throw new Error(`webworker host: ${path} is missing, so the image records no lowering; rebuild the image`)
  }
  /**
   * 常量说明：parsed 用于处理 parsed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const parsed: unknown = JSON.parse(vfs.readFileSync(path, 'utf8') as string)
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`webworker host: ${path} does not hold an object`)
  }
  /**
   * 常量说明：lowered 用于处理 lowered 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const lowered = (parsed as { lowered?: unknown }).lowered
  if (lowered !== LOWERING_VERSION) {
    throw new Error(`webworker host: image was lowered by ${String(lowered)}, this build runs ${LOWERING_VERSION}; rebuild the image`)
  }
}

/**
 * The shipped preset root, as the application layer that owns the composition
 * supplies it.
 *
 * A launcher appends this root itself rather than writing it into the roster —
 * `apps/cli` does it in `composeProfile` (`profile-boot.ts:159-166`) because only
 * the application knows where its own presets sit. The worker's presets travel
 * in the image, so the same overlay names their virtual path. Patching replaces
 * a row's whole `config`, so the current one is read and spread, and a roster
 * that already names roots keeps them.
 * @param loader - Module loader, for the image's YAML reader.
 * @param vfs - Filesystem holding the composed configuration.
 * @param configPath - Composed configuration path.
 * @param root - Virtual root.
 * @returns Boot patches (preset root overlay, frontend serving off) and
 * whether the preset overlay was applied.
 * @remarks 中文说明：功能说明：处理 bootPatches 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：loader（WorkerModuleLoader）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：vfs（MemoryVfs）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：configPath（string）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；
 * 参数说明：root（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：{ patches:
 * unknown[]; presetOverlay: boolean }；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 bootPatches(loader, vfs, configPath, root)，
 * 并按返回类型处理结果。
 */
function bootPatches(
  loader: WorkerModuleLoader,
  vfs: MemoryVfs,
  configPath: string,
  root: string,
): { patches: unknown[]; presetOverlay: boolean } {
  /**
   * 常量说明：text 用于处理 text 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const text = vfs.readFileSync(configPath, 'utf8') as string
  /**
   * 变量说明：rows 用于处理 rows 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let rows: unknown
  if (configPath.endsWith('.json')) {
    rows = JSON.parse(text)
  } else {
    // The roster's `!!js` scalars need Include's own YAML dialect.
    /**
     * 常量说明：include 用于处理 include 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const include = loader.load(loader.resolve('@deepseek-ai/cordis-plugin-include', root)) as { entryListSchema: unknown }
    /**
     * 常量说明：yaml 用于处理 yaml 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：加载 load 相关流程；使用场景由所在模块及调用位置决定。
     * @param source （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @param options （{ schema: unknown }）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。
     * @returns unknown；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 load(source, options)，并按返回类型处理结果。
     */
    const yaml = loader.load(loader.resolve('js-yaml', root)) as { load(source: string, options: { schema: unknown }): unknown }
    rows = yaml.load(text, { schema: include.entryListSchema })
  }
  /**
   * 常量说明：find 用于查找 find 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：查找 find 相关流程；使用场景由所在模块及调用位置决定。
   * @param entries （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param id （string）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。
   * @returns Record<string, unknown> | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 find(entries, id)，并按返回类型处理结果。
   */
  const find = (entries: unknown, id: string): Record<string, unknown> | undefined => {
    if (!Array.isArray(entries)) return undefined
    /**
     * 变量说明：entry 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const entry of entries as Array<Record<string, unknown>>) {
      if (entry.id === id) return entry
      /**
       * 常量说明：nested 用于处理 nested 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const nested = find(entry.config, id)
      if (nested !== undefined) return nested
    }
    return undefined
  }
  /**
   * 常量说明：configOf 用于处理 configOf 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 configOf 相关流程；使用场景由所在模块及调用位置决定。
   * @param row （Record<string, unknown>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Record<string, unknown>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 configOf(row)，并按返回类型处理结果。
   */
  const configOf = (row: Record<string, unknown>): Record<string, unknown> =>
    (typeof row.config === 'object' && row.config !== null && !Array.isArray(row.config)
      ? row.config
      : {}) as Record<string, unknown>

  /**
   * 常量说明：patches 用于处理 patches 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const patches: unknown[] = []
  /**
   * 变量说明：presetOverlay 用于处理 presetOverlay 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let presetOverlay = false
  /**
   * 常量说明：presets 用于处理 presets 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const presets = find(rows, 'agent-presets')
  if (presets !== undefined && configOf(presets).roots === undefined) {
    presetOverlay = true
    patches.push({
      id: 'agent-presets',
      config: { ...configOf(presets), roots: [{ path: join(root, 'config/agent-presets'), trust: 'system' }] },
    })
  }
  // The worker carries no compression codec, and the VFS is in-memory anyway:
  // the JSONL backend's plaintext path is the composition's one legal encoding.
  /**
   * 常量说明：jsonl 用于处理 jsonl 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const jsonl = find(rows, 'session-persistence-jsonl')
  if (jsonl !== undefined) {
    patches.push({ id: 'session-persistence-jsonl', config: { ...configOf(jsonl), compression: 'none' } })
  }
  return { patches, presetOverlay }
}

/**
 * Assemble the payload the page's pre-Cordis bootstrap needs: the structured
 * index injection table the served form renders into index.html. Collected
 * from the in-process webserver service, never from the API surface, because
 * the page has no Cordis tree yet.
 * @param ctx - Booted host context.
 * @returns Boot payload for `GET /__boot__`.
 * @remarks 中文说明：功能说明：读取 Boot Payload 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：ctx（HostContext）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；返回值：{
 * injections: unknown }；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * readBootPayload(ctx)，并按返回类型处理结果。
 */
function readBootPayload(ctx: HostContext): { injections: unknown } {
  /**
   * 常量说明：webServer 用于处理 webServer 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：收集 Index Injections 相关流程；使用场景由所在模块及调用位置决定。
   * @returns unknown；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 collectIndexInjections()，并按返回类型处理结果。
   */
  const webServer = ctx.get('webServer') as { collectIndexInjections(): unknown } | undefined
  if (webServer === undefined) {
    throw new Error('webworker host: no webServer service, so the page cannot receive its boot injections')
  }
  return { injections: webServer.collectIndexInjections() }
}

/**
 * Install the message handler and boot the tree.
 *
 * The handler is attached before the first await, so requests that arrive
 * during boot queue instead of being dropped. A boot failure refuses the queue
 * with 503 and rejects.
 * @param options - Assembly inputs; `channel` also replaces the message source.
 * @returns Resolves once the tunnel is serving.
 * @remarks 中文说明：功能说明：启动 Worker Host 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：options（WorkerHostOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；
 * 返回值：Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * startWorkerHost(options)，并按返回类型处理结果。
 */
export async function startWorkerHost(options: WorkerHostOptions): Promise<void> {
  /**
   * 常量说明：host 用于处理 host 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const host = createWorkerHost(options)
  if (options.channel === undefined) {
    /**
     * 常量说明：scope 用于处理 scope 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const scope = globalThis as { addEventListener?: (type: string, listener: (event: MessageEvent) => void) => void }
    if (typeof scope.addEventListener !== 'function') {
      throw new Error('webworker host: no message source; pass options.channel outside a dedicated worker')
    }
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（MessageEvent）：提供需要处理或投影的事件数
     * 据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
     * 典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
     */
    scope.addEventListener('message', (event: MessageEvent) => { host.handleMessage(event.data) })
  }
  await host.start()
}
