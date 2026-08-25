/*
 * ================================ 文件注释 ================================
 * 【文件职责】工作区选择插件的宿主侧入口：空 apply 占位，浏览器半部经
 *             ./client 导出。
 * 【技术维度】Cordis 插件机制。
 * 【产品维度】侧边栏工作区浏览区与英雄区工作区选择器。
 * 【逻辑维度】apply() 为空函数——本文件仅为占位。
 * 【关键边界】宿主进程无行为。
 * 【新手阅读建议】浏览器半部见 src/client/。
 * ==========================================================================
 */
/**
 * Workspace picker plugin, node half. Pure UI plugin: the empty apply exists
 * so the plugin appears in the host cordis.yml / Loader (load and lifecycle
 * follow the host; the browser half ships via exports["./client"], discovered
 * through the package.json dsh.client declaration).
 */

/** Host plugin body — no host-side behavior for the workspace picker plugin. */
export function apply(): void {}
