/**
 * ================================ 文件注释 ================================
 * 【文件职责】ui-commands 包在宿主（Node）侧的入口：空 apply 占位，让插件出现在
 *             宿主 cordis.yml 中；命令行 UI 的实际逻辑在浏览器半部。
 * 【技术维度】Cordis 插件机制；宿主侧另有独立的命令注册表（bootHost + CommandUiRuntime）。
 * 【产品维度】本包实现"/命令"功能：用户在输入框敲 / 触发命令菜单、执行宿主命令、
 *             以及客户端贡献的弹出式选择（popupSelect）。
 * 【逻辑维度】apply() 为空函数——本文件仅为占位。
 * 【关键边界】宿主进程无行为；命令注册表与 UI 运行时分离挂载。
 * 【新手阅读建议】真正逻辑从 src/client/service.ts 开始读。
 * ==========================================================================
 */
/**
 * Command UI plugin, node half. Pure UI plugin: the empty apply exists so
 * the plugin appears in the host cordis.yml / Loader; the browser half ships
 * via exports["./client"], discovered through the package.json dsh.client
 * declaration. The host command registry itself mounts separately
 * (bootHost + CommandUiRuntime).
 */

/** Host plugin body — no host-side behavior for the command UI plugin. */
// 宿主侧无行为：命令行 UI 全部在浏览器半部实现。
export function apply(): void {}
