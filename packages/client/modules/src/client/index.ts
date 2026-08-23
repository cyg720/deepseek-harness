/**
 * ================================ 文件注释 ================================
 * 【文件职责】dsh-client-modules 的浏览器半边（标准 ./client 导出）：模块
 *   系统类、线契约，以及注册插件面（把内核预建的实例登记为 ctx.modules）。
 * 【技术维度】模块系统在 Cordis 存在前由 shell 内核构建（bootstrap 例外
 *   ——加载插件的机制不能经由自己到达）；HTML 把本普通客户端 bundle 预载
 *   进待处理注册队列。
 * 【产品维度】浏览器启动时，loader 门面物化本 bundle 并调用其 bootstrap
 *   导出，构造模块系统；插件面只登记该既有实例。
 * 【逻辑维度】createClientModuleSystem 从门面物化的模块 bundle 构建系统
 *   （解析启动图、切换注册门面为 live 模式）；apply 提供 ctx.modules。
 * 【关键边界】createClientModuleSystem 必须先于插件启动运行，否则 apply
 *   抛错。
 * 【新手阅读建议】先读 manifest.ts 的契约文档，再看 system.ts 的实现。
 * ==========================================================================
 */
/**
 * Browser half (the standard `./client` export): the module-system class and
 * wire contract, plus the enrollment plugin face. The module system itself is
 * built by the shell kernel BEFORE cordis exists (the bootstrap exception —
 * the mechanism that loads plugins cannot arrive through itself). The host
 * parser-preloads this ordinary client bundle into the pending registration
 * queue. The HTML-installed loader facade materializes this bundle and calls
 * its bootstrap export, which constructs the system and retains the same
 * exports for this package's graph row. The plugin face only enrolls that
 * pre-existing instance by providing it as `ctx.modules`.
 * @module @deepseek-ai/dsh-client-modules/client
 */
/**
 * 浏览器半边（标准 ./client 导出）：模块系统类与线契约，加注册插件面。
 * 模块系统本身在 Cordis 存在之前由 shell 内核构建（bootstrap 例外——加载
 * 插件的机制不能经由自己到达）。Host 解析器把本普通客户端 bundle 预载进
 * 待处理注册队列。HTML 安装的 loader 门面物化本 bundle 并调用其 bootstrap
 * 导出，它构造系统并为本包的图行保留同一导出。插件面只以 ctx.modules
 * 登记那个既有实例。
 * @module @deepseek-ai/dsh-client-modules/client
 */
import type { Context } from '@deepseek-ai/cordis'
import { ClientModuleSystem } from './system.ts'
import { parseBootManifest } from './manifest.ts'
import type {
  ClientBootstrapModule, ClientModuleCreateOptions, ClientModuleLoaderTarget,
} from './manifest.ts'

export { ClientModuleSystem }
export { parseBootManifest, stripClientSuffix } from './manifest.ts'
export type {
  BootManifest, BootModuleRow, BootPluginRow, ClientBootstrapModule, ClientBundleRegistration,
  ClientModuleCreateOptions, ClientModuleLoader, ClientModuleLoaderTarget, ClientModuleRecord,
  ClientModuleSystemOptions, DshWindow,
  WebBootEntry, WebBootGraph,
} from './manifest.ts'

let moduleSystem: ClientModuleSystem | undefined // 进程级单例：bootstrap 构建后供插件面登记

/**
 * Build the live module system from the HTML facade's materialized modules bundle.
 * @param target - Stable registration facade whose pending queue becomes the live sink.
 * @param bootstrapModule - This bundle's id and already-materialized exports.
 * @param options - Raw boot graph, platform seed, and optional bundle transport.
 * @returns The created module system, also published for this package's Cordis plugin face.
 */
/**
 * 从 HTML 门面的已物化 modules bundle 构建实时模块系统。
 * @param target 其待处理队列成为实时汇的稳定注册门面。
 * @param bootstrapModule 本 bundle 的 id 与已物化导出。
 * @param options 原始启动图、平台种子与可选 bundle 传输。
 * @returns 创建出的模块系统，同时为本包的 Cordis 插件面发布。
 */
export function createClientModuleSystem(
  target: ClientModuleLoaderTarget,
  bootstrapModule: ClientBootstrapModule,
  options: ClientModuleCreateOptions,
): ClientModuleSystem {
  moduleSystem = new ClientModuleSystem({
    manifest: parseBootManifest(options.boot),
    staticModules: options.staticModules,
    registrationTarget: target,
    bootstrapModule,
    ...(options.loadBundle === undefined ? {} : { loadBundle: options.loadBundle }),
  })
  return moduleSystem
}

/**
 * Enroll the kernel-built module system as `ctx.modules`.
 * @param ctx - client root context.
 */
/**
 * 把内核构建的模块系统登记为 ctx.modules。
 * @param ctx 客户端根上下文。
 */
export function apply(ctx: Context): void {
  if (moduleSystem === undefined) {
    throw new Error('client-modules: createClientModuleSystem must run before plugin boot')
  }
  ctx.reflect.provide('modules', moduleSystem)
}
