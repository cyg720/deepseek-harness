/*
 * ================================ 文件注释 ================================
 * 【文件职责】dsh-client-runtime 包的 Host 加载器入口：浏览器运行时主体
 *   从 ./client 与 ./loader 导出，本文件仅提供 Host 插件壳。
 * 【技术维度】Cordis 插件模块：apply 是插件主体函数。
 * 【产品维度】Host 侧挂载本插件时不需要任何运行时行为（浏览器侧才运行
 *   真正的客户端运行时），故主体为空函数。
 * 【逻辑维度】单函数 apply：无操作。
 * 【关键边界】apply 参数是 unknown 类型，本插件不使用它。
 * 【新手阅读建议】对照 ./client/index.ts 看浏览器侧实际装配。
 * ==========================================================================
 */
/** Host loader entry for the browser runtime exported from `./client` and `./loader`. */
/* Host 加载器入口：浏览器运行时主体从 ./client 与 ./loader 导出。 */

/** Host plugin body — no host-side behavior for the runtime plugin. */
/* Host 插件主体——runtime 插件在 Host 侧没有任何行为。 */
export function apply(_ctx: unknown): void {}
