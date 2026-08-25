/*
 * ================================ 文件注释 ================================
 * 【文件职责】权限表面包的宿主侧入口：空 apply 占位，浏览器半部提供新会话设置行
 *             与当前会话的命令选择器。
 * 【技术维度】Cordis 插件机制。
 * 【产品维度】新会话的默认权限模式设置与当前会话的 /permission 选择器。
 * 【逻辑维度】apply() 为空函数——本文件仅为占位。
 * 【关键边界】宿主进程无行为。
 * 【新手阅读建议】浏览器半部见 src/client/index.ts。
 * ==========================================================================
 */
/**
 * Permission surfaces plugin, node half. The empty apply exists so the plugin
 * appears in the host cordis.yml / Loader; the browser half ships the
 * new-session Settings row and current-session command picker through
 * exports["./client"], discovered from the package.json dsh.client declaration.
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply(): void {}
