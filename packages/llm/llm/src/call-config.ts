/**
 * Conversation call configuration and freeze utilities. Provider routing,
 * model, reasoning effort, and sampling values are request-header state that
 * can affect cache reuse; request waterfalls replace them and the loop logs
 * changed snapshots instead of allowing silent per-call drift.
 * @module dsh-llm/call-config
 */

/*
 * ================================ 文件注释 ================================
 * 【文件职责】定义一次对话调用的配置（provider/model/推理强度/采样参数）及其
 * 相等比较、agent loop 请求标记，以及通用的深度冻结工具 deepFreeze。
 * 【技术维度】LlmCallConfig 是请求头状态，可影响缓存复用；瀑布流会整体替换
 * 它，loop 日志记录变更快照而不允许静默漂移。deepFreeze 用迭代工作栈代替
 * 递归，规避调用栈深度上限，并特意跳过 AbortSignal。
 * 【产品维度】模型请求缓存复用依赖稳定、可比较的配置；请求对象被深冻结后，
 * 任何中间件意外改写都会立刻抛错，从机制上保证请求不可变。
 * 【逻辑维度】请求标记（WeakSet）→ 配置类型 → 字段级相等比较 → 标记/查询
 * 函数 → deepFreeze 迭代冻结。
 * 【关键边界】AGENT_LOOP_REQUESTS 是进程本地弱引用集合；deepFreeze 不冻结
 * AbortSignal（那是请求的活跃取消通道）；配置字段与 GenerateOptions 同名
 * 字段一一对应。
 * 【新手阅读建议】先读 LlmCallConfig 各字段，再看 deepFreeze 的迭代遍历
 * 结构（visit/property 两种任务）理解它如何避免递归爆栈。
 * ==========================================================================
 */

import type { GenerateOptions } from './types.ts'
import type { ReasoningEffortId } from './brand.ts'

/** Process-local identities of request objects assembled by dsh-agent-loop. */
const AGENT_LOOP_REQUESTS = new WeakSet<GenerateOptions>()

// TODO(call-config-shape): Revisit which fields are epoch-level for cache reuse
// and where provider-specific request options belong.
/**
 * Provider, model, reasoning effort, and sampling scalars of one conversation's
 * requests. Every field maps 1:1 onto the same-named `GenerateOptions` field;
 * the loop builds requests from the logged header rather than accepting these
 * per call.
 */
export interface LlmCallConfig {
  provider: string
  model: string
  reasoningEffort?: ReasoningEffortId
  temperature?: number
  maxTokens?: number
  stop?: string[]
}

/**
 * Effective config fields supplied by exact-model adapter resolution rather
 * than by the caller's request proposal.
 */
export interface LlmCallConfigAdapterDefaults {
  reasoningEffort?: true
  maxTokens?: true
}

/**
 * Field-wise equality over {@link LlmCallConfig} — the comparison a caller
 * runs to decide whether a proposed configuration is a real change (worth a
 * logged header snapshot) or the held one restated.
 * @param a - one configuration.
 * @param b - the other.
 * @returns whether every field (including the `stop` list, element-wise) matches.
 */
export function callConfigEquals(a: LlmCallConfig, b: LlmCallConfig): boolean {
  if (
    a.provider !== b.provider
    || a.model !== b.model
    || a.reasoningEffort !== b.reasoningEffort
    || a.temperature !== b.temperature
    || a.maxTokens !== b.maxTokens
  ) return false
  if (a.stop === undefined || b.stop === undefined) return a.stop === b.stop
  return a.stop.length === b.stop.length && a.stop.every((s, i) => s === b.stop?.[i])
}

/**
 * Mark one exact request object as assembled by dsh-agent-loop.
 * @param request - loop-owned request envelope before LLM dispatch.
 * @returns the same request object marked as created by the process-local agent loop.
 */
export function markAgentLoopRequest<T extends GenerateOptions>(request: T): T {
  AGENT_LOOP_REQUESTS.add(request)
  return request
}

/**
 * Test whether the exact request object was assembled by dsh-agent-loop.
 * @param request - request envelope observed at the LLM waterfall.
 * @returns whether {@link markAgentLoopRequest} recorded this object.
 */
export function isAgentLoopRequest(request: GenerateOptions): boolean {
  return AGENT_LOOP_REQUESTS.has(request)
}
