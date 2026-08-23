/**
 * ================================ 文件注释 ================================
 * 【文件职责】布局插件的宿主加载入口：空 apply 占位，布局 UI 在浏览器半部。
 * 【技术维度】Cordis 插件机制。
 * 【产品维度】应用三栏主框架。
 * 【逻辑维度】apply() 为空函数——本文件仅为占位。
 * 【关键边界】宿主进程无行为。
 * 【新手阅读建议】浏览器半部见 src/client/index.ts。
 * ==========================================================================
 */
/** Host loader entry for the browser-only layout plugin. */

/** Provides no host-side behavior. */
export function apply(): void {}
