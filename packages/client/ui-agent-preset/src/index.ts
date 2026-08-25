/*
 * ================================ 文件注释 ================================
 * 【文件职责】ui-agent-preset 包在宿主（Node）侧的入口。该包负责"Agent 预设"管理功能，
 *             本文件只做一件事：声明一个空的 apply，让插件能出现在宿主 cordis.yml 配置中。
 * 【技术维度】Cordis 插件机制：宿主半部与浏览器半部通过 package.json 的 dsh.client
 *             声明分离，浏览器半部（src/client/index.ts）才是实现 UI 的地方。
 * 【产品维度】用户可在设置中查看/复制/删除 Agent 预设、为新会话挑选预设。
 * 【逻辑维度】apply() 为空函数——本文件没有宿主侧逻辑，仅为占位。
 * 【关键边界】本文件只在宿主进程加载；浏览器进程加载的是 ./client 导出。
 * 【新手阅读建议】先理解"空 apply 占位"约定，再进入 src/client/ 阅读真正逻辑。
 * ==========================================================================
 */
/**
 * Agent-preset surface plugin, node half. The empty apply exists so the plugin
 * appears in the host cordis.yml / Loader; the browser half ships the
 * General-settings row through exports["./client"], discovered from the
 * package.json dsh.client declaration.
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
// 宿主侧插件体：此表面插件在宿主进程没有实际行为，仅为占位以便在 cordis.yml 中声明。
export function apply(): void {}
