/**
 * ================================ 文件注释 ================================
 * 【文件职责】消息反馈表面包的宿主侧入口：空 apply 占位，UI 在浏览器半部。
 * 【技术维度】Cordis 插件机制。
 * 【产品维度】用户对助手消息的赞/踩反馈。
 * 【逻辑维度】apply() 为空函数——本文件仅为占位。
 * 【关键边界】宿主进程无行为。
 * 【新手阅读建议】浏览器半部见 src/client/index.ts。
 * ==========================================================================
 */
/**
 * Message feedback surface plugin, node half. Pure UI plugin: the empty apply
 * exists so the plugin appears in the host cordis.yml / Loader; the browser
 * half ships via exports["./client"], discovered through the package.json
 * dsh.client declaration.
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply(): void {}
