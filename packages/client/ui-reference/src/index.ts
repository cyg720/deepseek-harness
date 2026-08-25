/*
 * ================================ 文件注释 ================================
 * 【文件职责】文件/会话引用包的宿主侧入口：空 apply 占位，统一 '@' 引用源在浏览器半部。
 * 【技术维度】Cordis 插件机制。
 * 【产品维度】输入框 '@' 引用文件/文件夹/会话的统一菜单。
 * 【逻辑维度】apply() 为空函数——本文件仅为占位。
 * 【关键边界】宿主进程无行为。
 * 【新手阅读建议】浏览器半部见 src/client/。
 * ==========================================================================
 */
/**
 * File/session reference plugin, node half. Pure UI plugin: the empty apply
 * exists so the plugin appears in the host cordis.yml / Loader; the browser
 * half ships via exports["./client"], discovered through the package.json
 * `dsh.client` declaration.
 */

/** Host plugin body — no host-side behavior for this source plugin. */
export function apply(): void {}
