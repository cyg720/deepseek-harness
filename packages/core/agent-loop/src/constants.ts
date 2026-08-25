/*
 * ================================ 文件注释 ================================
 * 【文件职责】集中存放 agent-loop 插件内部的共享调度默认值常量，供本包其他模块引用。
 * 【技术维度】纯常量导出模块，无任何运行时逻辑与依赖，属于 @deepseek-ai/dsh-agent-loop 的公共常量面。
 * 【产品维度】决定单个 agent 每个 step 内最多可同时执行的工具调用数量，直接影响并行吞吐与稳定性。
 * 【逻辑维度】全文仅一个导出常量 DEFAULT_MAX_PARALLEL_TOOL_CALLS，作为调度并行上限的默认值。
 * 【关键边界】它只是“默认值”，可被插件配置 maxParallelToolCalls 覆盖；消费方是 tool-calls.ts 的调度池与 index.ts 的配置校验。
 * 【新手阅读建议】极短，直接读完；再结合 tool-calls.ts 中 runGroup 的 inFlight 池理解“并行上限”如何生效。
 * ==========================================================================
 */
/** Shared agent-loop scheduler defaults.
 * @module dsh-agent-loop/constants
 */

/** Default maximum in-flight parallel-safe calls per agent step. */
// 每个 step 内最多允许同时在途的“并行安全”（parallel-safe，即互不冲突、可同时执行）工具调用数量。
// 默认取 10：既保证一定并发吞吐，又避免一次请求塞入过多调用压垮模型/服务端；具体调度在
// tool-calls.ts 的 runGroup（inFlight 池）中消费，配置 index.ts 的 maxParallelToolCalls 可覆盖此值。
export const DEFAULT_MAX_PARALLEL_TOOL_CALLS = 10
