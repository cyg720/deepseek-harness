/*
 * ================================ 文件注释 ================================
 * 【文件职责】计划控制包的宿主侧入口：空 apply 占位；计划行为本身（/plan 命令、
 *             计划投影单元、策略片段）归 dsh-plan-mode 所有。
 * 【技术维度】Cordis 插件机制。
 * 【产品维度】输入条 plan mode 状态芯片。
 * 【逻辑维度】apply() 为空函数——本文件仅为占位。
 * 【关键边界】宿主进程无行为；计划模式逻辑独立挂载于宿主花名册。
 * 【新手阅读建议】浏览器半部见 src/client/index.ts。
 * ==========================================================================
 */
/**
 * Plan control plugin, node half. Pure UI plugin: the empty apply exists so
 * the plugin appears in the host cordis.yml / Loader; the browser half ships
 * via exports["./client"], discovered through the package.json dsh.client
 * declaration. Plan behavior itself (the /plan command, the plan projection
 * unit, the policy section) is owned by `@deepseek-ai/dsh-plan-mode`,
 * composed independently on the host roster.
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply(): void {}
