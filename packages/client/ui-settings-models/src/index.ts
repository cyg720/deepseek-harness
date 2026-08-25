/*
 * ================================ 文件注释 ================================
 * 【文件职责】模型设置包的宿主加载入口：空 apply 占位，浏览器实现从 ./client 导出。
 * 【技术维度】Cordis 插件机制。
 * 【产品维度】模型设置页与产品引导（onboarding）对话框。
 * 【逻辑维度】apply() 为空函数——本文件仅为占位。
 * 【关键边界】宿主进程无行为。
 * 【新手阅读建议】浏览器半部见 src/client/。
 * ==========================================================================
 */
/** Host loader entry for the browser implementation exported from `./client`. */

/** Host plugin body — no host-side behavior for the models settings plugin. */
export function apply(): void {}
