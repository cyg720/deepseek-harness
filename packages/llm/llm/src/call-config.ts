/**
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

/**
 * Conversation call configuration and freeze utilities. Provider routing,
 * model, reasoning effort, and sampling values are request-header state that
 * can affect cache reuse; request waterfalls replace them and the loop logs
 * changed snapshots instead of allowing silent per-call drift.
 * @module dsh-llm/call-config
 */

import type { GenerateOptions } from './types.ts'
import type { ReasoningEffortId } from './brand.ts'

/** Process-local identities of request objects assembled by dsh-agent-loop. */
// 中文：dsh-agent-loop 组装出的请求对象的进程本地标识集合（WeakSet，弱引用、
// 不阻碍垃圾回收）；用于区分"loop 构建的请求"与"手工构建的请求"。
const AGENT_LOOP_REQUESTS = new WeakSet<GenerateOptions>()

// TODO(call-config-shape): Revisit which fields are epoch-level for cache reuse
// and where provider-specific request options belong.
// 中文：TODO——重新审视哪些字段属于"epoch 级"（影响缓存复用）、provider 专属
// 请求选项应该放在哪里。
/**
 * （中文）一次对话请求的配置：provider、model、推理强度与采样标量。每个字段
 * 与 GenerateOptions 中同名的一对一映射；loop 从日志化的请求头重建请求，而
 * 不是每次调用时接受这些值。
 */
/**
 * Provider, model, reasoning effort, and sampling scalars of one conversation's
 * requests. Every field maps 1:1 onto the same-named `GenerateOptions` field;
 * the loop builds requests from the logged header rather than accepting these
 * per call.
 */
export interface LlmCallConfig {
  // 中文：provider 路由。
  provider: string
  // 中文：模型 id。
  model: string
  // 中文：推理强度（可选）。
  reasoningEffort?: ReasoningEffortId
  // 中文：采样温度（可选）。
  temperature?: number
  // 中文：最大输出 token 数（可选）。
  maxTokens?: number
  // 中文：停止序列列表（可选）。
  stop?: string[]
}

/**
 * （中文）"由精确模型解析补充、而非调用方提议"的有效配置字段标记：值为 true
 * 表示该字段的最终值来自适配器默认而非请求提议。
 */
/**
 * Effective config fields supplied by exact-model adapter resolution rather
 * than by the caller's request proposal.
 */
export interface LlmCallConfigAdapterDefaults {
  reasoningEffort?: true
  maxTokens?: true
}

/**
 * （中文）对 LlmCallConfig 做逐字段相等比较——调用方用它判断"新提议的配置"
 * 是否真的是变化（值得记录一次日志快照）还是旧配置的复述。
 * @param a 一份配置。
 * @param b 另一份配置。
 * @returns 每个字段（包括 stop 列表按元素逐一比较）都相同则返回 true。
 */
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
 * （中文）把某个精确请求对象标记为"由 dsh-agent-loop 组装"。带此标记的请求
 * 到达 llm/stream 瀑布流时是深冻结的（任何改写都会抛错），其内容只是会话日志
 * 的纯函数。
 * @param request loop 在 LLM 分发前持有的请求包络。
 * @returns 同一个被标记为进程本地 agent loop 创建的请求对象。
 */
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
 * （中文）判断某个精确请求对象是否由 dsh-agent-loop 组装（按对象身份判断）。
 * @param request 在 LLM 瀑布流处观察到的请求包络。
 * @returns 该对象是否被 markAgentLoopRequest 记录过。
 */
/**
 * Test whether the exact request object was assembled by dsh-agent-loop.
 * @param request - request envelope observed at the LLM waterfall.
 * @returns whether {@link markAgentLoopRequest} recorded this object.
 */
export function isAgentLoopRequest(request: GenerateOptions): boolean {
  return AGENT_LOOP_REQUESTS.has(request)
}

/**
 * （中文）就地深冻结一个值：用迭代遍历（显式工作栈）替代递归，既防循环引用
 * 又不给 JS 调用栈设深度上限；后续任何改写都会在严格模式下抛错。刻意跳过
 * AbortSignal 对象——它们是请求的活跃取消通道，冻结会破坏取消能力。
 * @param value 要就地冻结的值。
 * @returns 同一个值，已被冻结。
 */
/**
 * Deep-freeze a value in place with an iterative traversal, guarding cycles,
 * so later mutation throws without imposing a JavaScript call-stack depth cap.
 * {@link AbortSignal} objects are deliberately skipped because they are the
 * request's live cancellation channel and freezing them breaks abort.
 * @param value - the value to freeze in place.
 * @returns the same value, frozen.
 */
export function deepFreeze<T>(value: T): T {
  const seen = new WeakSet<object>()
  const pending: (
    | { kind: 'visit'; node: unknown }
    | { kind: 'property'; source: Record<string, unknown>; key: string }
  )[] = [{ kind: 'visit', node: value }]
  // 中文：工作栈里两种任务：visit（冻结一个节点并展开其属性）与 property
  // （把某属性入栈待访问）；pop 取出任务循环处理直到栈空。
  while (pending.length > 0) {
    const task = pending.pop()
    /* v8 ignore next -- the loop condition guarantees one pending task. */
    if (task === undefined) continue
    if (task.kind === 'property') {
      pending.push({ kind: 'visit', node: task.source[task.key] })
      continue
    }
    const node = task.node
    // 中文：跳过基本类型、AbortSignal 以及已处理过的对象（防循环引用）。
    if (node === null || typeof node !== 'object') continue
    if (node instanceof AbortSignal) continue
    if (seen.has(node)) continue
    seen.add(node)
    Object.freeze(node)
    const keys = Object.keys(node)
    // 中文：逆序入栈，保证按原 key 顺序处理（栈是后进先出）。
    for (let index = keys.length - 1; index >= 0; index--) {
      const key = keys[index]
      /* v8 ignore next -- the loop is bounded by the captured key count. */
      if (key === undefined) continue
      pending.push({ kind: 'property', source: node as Record<string, unknown>, key })
    }
  }
  return value
}
