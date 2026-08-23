/**
 * ================================ 文件注释 ================================
 * 【文件职责】cordis-client-runner 的 Host（Node）半部：纯浏览器侧能力的占位入口。
 *             空 apply 只是为了让它在宿主 cordis.yml / Loader 中出现，真正的浏览器
 *             半部经 exports["./client"] 由 package.json 的 dshClient 声明发现。
 * 【技术维度】Cordis 插件约定：apply() 即插件体；浏览器侧代码独立编译发布。
 * 【产品维度】动态插件在浏览器内的加载/守卫/回收逻辑全部在客户端，Host 侧仅声明
 *             "存在该插件"以参与组合装配。
 * 【逻辑维度】文件头说明 → 空 apply 函数。
 * 【关键边界】不要在 Host 半部添加行为；浏览器半部入口见 ./client/index.ts。
 * 【新手阅读建议】把本文件视为占位声明，随后直接读 client/index.ts。
 * ==========================================================================
 */

/**
 * Dynamic-package runner plugin, node half. Pure browser-side capability: the
 * empty apply exists so the row appears in the host cordis.yml / Loader, while
 * the browser half ships through exports["./client"], discovered from the
 * package.json dshClient declaration.
 */

/** Host plugin body — this package contributes nothing host-side. */
/** Host 插件体：本包在 Host 侧不贡献任何行为。 */
export function apply(): void {}
