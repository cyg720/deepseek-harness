/**
 * ================================ 文件注释 ================================
 * 【文件职责】ui-cordis 的 Host（Node）半部：一个"纯 UI 插件"的占位入口。
 *             空 apply 只是为了让它出现在宿主 cordis.yml / Loader 中；
 *             真正的浏览器半部经 exports["./client"] 由 package.json 的
 *             dshClient 声明发现。
 * 【技术维度】Cordis 插件约定：apply() 即插件体；浏览器侧代码独立编译发布，
 *             宿主侧不执行任何 UI 逻辑。
 * 【产品维度】动态 Cordis 插件的卡片/面板/库存等 UI 全部在浏览器侧提供，
 *             Host 侧只需声明"存在该插件"以参与组合装配。
 * 【逻辑维度】文件头说明 → 空 apply 函数。
 * 【关键边界】不要在 Host 半部添加行为；浏览器半部入口见 ./client/index.ts。
 * 【新手阅读建议】把本文件视为"占位声明"，随后直接读 client/index.ts。
 * ==========================================================================
 */

/**
 * Cordis dynamic-plugin card, node half. Pure UI plugin: the empty apply
 * exists so the plugin appears in the host cordis.yml / Loader; the browser
 * half ships via exports["./client"], discovered through the package.json
 * dshClient declaration.
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
/** Host 插件体：本表面插件无宿主侧行为。 */
export function apply(): void {}
