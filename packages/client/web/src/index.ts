/*
 * ================================ 文件注释 ================================
 * 【文件职责】web shell 库入口：产品是 AppWebEntry——apps/web 的 Vite 入口
 *   针对 #root 运行它；启动页与 fiber 状态投影保持内部；静态模块表及其
 *   平台词构成包的构建期契约。
 * 【技术维度】纯 re-export 桶：聚合 boot/seed/platform 的公开面。
 * 【产品维度】浏览器应用启动的唯一入口面，把内核、种子表与平台词暴露给
 *   上层应用。
 * 【逻辑维度】AppWebEntry 是启动内核；getStaticModules 是模块表；
 *   PLATFORM_MODULES/PRELOADED_CLIENT_EXTERNALS 是构建期契约。
 * 【关键边界】仅公开应公开者；BootPage/loader-status 保持内部。
 * 【新手阅读建议】从 AppWebEntry（boot.ts）入手看启动流程。
 * ==========================================================================
 */
/**
 * Web shell library entry. The shell's product is {@link AppWebEntry} —
 * apps/web's Vite entry runs it against #root. The boot page and fiber-state
 * projection remain internal; the static module table and its platform words
 * form the package's build-time contract.
 * @module @deepseek-ai/dsh-client-web
 */
/*
 * web shell 库入口。shell 的产品是 AppWebEntry——apps/web 的 Vite 入口
 * 针对 #root 运行它。启动页与 fiber 状态投影保持内部；静态模块表及其
 * 平台词构成包的构建期契约。
 * @module @deepseek-ai/dsh-client-web
 */

export { AppWebEntry, type BootSeams } from './boot.ts'
export { getStaticModules } from './seed.ts'
export { PLATFORM_MODULES, PRELOADED_CLIENT_EXTERNALS, type PlatformModule } from './platform.ts'
