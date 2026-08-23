/**
 * ================================ 文件注释 ================================
 * 【文件职责】ui-brand-official 包在宿主（Node）侧的入口：空 apply 仅为让插件出现在
 *             宿主 cordis.yml 中，真正的品牌呈现逻辑在浏览器半部（./client）。
 * 【技术维度】Cordis 插件机制：宿主半部与浏览器半部通过 package.json 的 dsh.client 分离。
 * 【产品维度】本包提供官方 DeepSeek Harness 品牌标识（logo/名称）的默认呈现。
 * 【逻辑维度】apply() 为空函数——本包只贡献浏览器侧呈现。
 * 【关键边界】宿主进程无任何行为；品牌仅出现在官方构建里。
 * 【新手阅读建议】对比 src/client/index.ts 理解"宿主占位 + 浏览器实现"的拆分配置。
 * ==========================================================================
 */
/**
 * Official browser-brand plugin, node half. The empty apply gives Loader a
 * host-side row while the browser half ships through `exports["./client"]`.
 */

/** Host plugin body — this package contributes browser presentation only. */
// 宿主侧插件体：本包只贡献浏览器侧的品牌呈现，宿主侧为空。
export function apply(): void {}
