/**
 * ================================ 文件注释 ================================
 * 【文件职责】模型选择表面包的宿主侧入口：空 apply 占位，UI 在浏览器半部。
 * 【技术维度】Cordis 插件机制。
 * 【产品维度】/model 命令弹窗与输入条模型选择器。
 * 【逻辑维度】apply() 为空函数——本文件仅为占位。
 * 【关键边界】宿主进程无行为。
 * 【新手阅读建议】浏览器半部见 src/client/index.ts。
 * ==========================================================================
 */
/**
 * Model selection plugin, node half. Pure UI plugin: the empty apply exists
 * so the plugin appears in the host cordis.yml / Loader; the browser half
 * ships via exports["./client"], discovered through the package.json
 * dsh.client declaration.
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply(): void {}
