/**
 * ================================ 文件注释 ================================
 * 【文件职责】ui-input-trigger 包在宿主侧的入口：空 apply 占位，触发管线在浏览器半部。
 * 【技术维度】Cordis 插件机制。
 * 【产品维度】'/' 命令与 '@' 引用触发菜单。
 * 【逻辑维度】apply() 为空函数——本文件仅为占位。
 * 【关键边界】宿主进程无行为。
 * 【新手阅读建议】浏览器半部见 src/client/index.ts。
 * ==========================================================================
 */
/**
 * Slash trigger plugin, node half. Pure UI plugin: the empty apply exists so
 * the plugin appears in the host cordis.yml / Loader; the browser half ships
 * via exports["./client"], discovered through the package.json dsh.client
 * declaration.
 */

/** Host plugin body — no host-side behavior for the slash trigger plugin. */
export function apply(): void {}
