/**
 * ================================ 文件注释 ================================
 * 【文件职责】UI 渲染器的宿主加载入口：空 apply 占位，渲染逻辑在浏览器半部。
 * 【技术维度】Cordis 插件机制。
 * 【产品维度】浏览器应用的渲染与挂载。
 * 【逻辑维度】apply() 为空函数——本文件仅为占位。
 * 【关键边界】宿主进程无行为。
 * 【新手阅读建议】浏览器半部见 src/client/index.ts。
 * ==========================================================================
 */
/** Host loader entry for the browser-only UI renderer. */

/** Provides no host-side behavior. */
export function apply(): void {}
