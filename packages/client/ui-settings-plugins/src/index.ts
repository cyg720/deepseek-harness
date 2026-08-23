/**
 * ================================ 文件注释 ================================
 * 【文件职责】插件设置表面的宿主侧入口：空 apply 占位，分区与可配置页签在浏览器半部；
 *             本包不注册自己的命名空间（所编辑的分区都归注册它们的宿主插件）。
 * 【技术维度】Cordis 插件机制。
 * 【产品维度】设置页"插件"分区（可配置卡片与清单）。
 * 【逻辑维度】apply() 为空函数——本文件仅为占位。
 * 【关键边界】宿主进程无行为。
 * 【新手阅读建议】浏览器半部见 src/client/。
 * ==========================================================================
 */
/**
 * Plugins settings surface, node half. The empty apply exists so the plugin
 * appears in the host cordis.yml / Loader; the browser half owns the section
 * and its configurable tab through exports["./client"], discovered from the
 * package.json dsh.client declaration. Every section this page edits is owned
 * by the Host plugin that registered it, so this package registers no
 * namespace of its own.
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply(): void {}
