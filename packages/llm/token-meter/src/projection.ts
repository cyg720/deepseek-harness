/**
 * ================================ 文件注释 ================================
 * 【文件职责】定义 token-meter 的纯客户端安全投影词汇（types only）：累计用量、
 * 上下文压力与上下文构成三种投影的对外形状，并把它们注册进会话投影映射。
 * 【技术维度】三种投影对应三类消费：TokenUsageProjection 是整份日志的互斥
 * 桶累计；ContextPressureProjection 是"最近一次请求的 provider 实测压力 +
 * 最新已知路由容量"的状态展示参考（各字段 last-wins，刻意不是同一次原子观测）；
 * ContextBreakdownProjection 是"下一次请求由什么组成"的启发式构成（非总额）。
 * 【产品维度】UI 的 token 占用/用量展示全部消费这些投影；文档明确它们只是
 * 用户可见参考，不是计费或门控输入。
 * 【逻辑维度】用量投影 → 压力投影 → 构成投影 → 注册进 SessionProjectionMap。
 * 【关键边界】四个用量桶互斥（推理 token 已含在 outputTokens 内，不再重复）；
 * 压力投影各字段来自不同时刻，可短暂"新容量配旧压力"。
 * 【新手阅读建议】先读 ContextPressureProjection 的英文注释（含 README 指引），
 * 理解"非原子"设计取舍，再读其余两个投影。
 * ==========================================================================
 */

/**
 * Pure client-safe token-projection vocabulary.
 *
 * @module @deepseek-ai/dsh-token-meter/projection
 */

/**
 * （中文）整份会话日志的持久累计 provider 用量。
 * 四个桶互斥：特别是推理 token 已包含在 outputTokens 里，不再重复累计。
 */
/**
 * Durable cumulative provider usage for a complete session log.
 *
 * The four buckets are disjoint. In particular, reasoning tokens are already
 * included in `outputTokens` and are not accumulated again.
 */
export interface TokenUsageProjection {
  // 中文：未命中缓存的输入 token 累计。
  uncachedInputTokens: number
  // 中文：输出 token 累计（含推理）。
  outputTokens: number
  // 中文：缓存读取 token 累计。
  cacheReadTokens: number
  // 中文：缓存写入 token 累计。
  cacheWriteTokens: number
}

/**
 * （中文）供状态展示使用的近似上下文占用。
 * 各字段（存在时）刻意不是同一次原子请求观测：每个都是不同时刻的 last-wins
 * 记录。切换模型因此可能在新容量配到旧路由的压力上，直到下一次请求报告用量。
 * 这是有意的取舍——该值只是用户可见参考，不是计费或门控输入。
 */
/**
 * Approximate context occupancy for a status display.
 *
 * The fields, when present, are deliberately NOT one atomic request
 * observation: each is a last-wins record of a different moment. Switching
 * models can therefore pair a fresh capacity with the previous route's
 * pressure until the next request reports usage. This is an intentional trade
 * — the value is a user-facing reference, not a billing or gating input. See
 * the token-meter README for the full rationale.
 */
export interface ContextPressureProjection {
  /**
   * （中文）最近一次请求的 provider 报告提示大小：未缓存输入 + 缓存读写。
   * 响应输出不计入，因此当前轮次流式输出时该值不增长。provider 报告用量前
   * 缺席。
   */
  /**
   * Provider-reported prompt size of the most recent request: uncached input
   * plus cache reads and writes. Response output is excluded, so this does not
   * grow as the current turn streams. Absent until a provider reports usage.
   */
  pressureTokens?: number
  /**
   * （中文）下一次请求的提示会花多少钱：pressureTokens 加上"自该采样以来表面
   * 增删内容的启发式重定价"。只估 delta，因此数字仍锚定 provider，同时压缩
   * 遮蔽某段时立刻反应——而 pressureTokens 单独做不到这点（压缩本身不报告
   * 用量）。provider 报告用量前缺席。
   */
  /**
   * What the NEXT request's prompt would cost: {@link pressureTokens} plus the
   * heuristic repricing of everything the surface gained or lost since that
   * sample. Only the delta is estimated, so the figure stays anchored to the
   * provider while still reacting the moment a compaction shadows a span —
   * which `pressureTokens` alone cannot do, since compaction reports no usage
   * of its own. Absent until a provider reports usage.
   */
  projectedTokens?: number
  /** Newest recorded route capacity; absent when no adapter advertised one. */
  // 中文：最新记录的路由容量；没有适配器宣传过时缺席。
  contextWindow?: number
}

/**
 * （中文）下一次请求上下文的启发式构成：提示由什么组成，而不是花多少钱。
 * 三个数字都用 meter 的固定密度估计，因此不会加起来等于 provider 锚定的
 * projectedTokens：该估计系统性地低估 CJK 文本与 JSON schema，而这正是
 * projectedTokens 的锚定所排除的占用误差。请把它们展示为"构成的近似"，
 * 绝不要当作总额。
 */
/**
 * Heuristic composition of the next request's context: what the prompt is
 * made of, not what it costs. All three figures use the meter's fixed
 * density estimate, so they will not sum to the provider-anchored
 * `projectedTokens`: the estimator systematically underprices CJK text and
 * JSON schemas, which is exactly the error the anchoring in
 * {@link ContextPressureProjection.projectedTokens} keeps out of the occupancy
 * figure. Present these as approximations of composition, never as a total.
 */
export interface ContextBreakdownProjection {
  /** Heuristic tokens of the newest request envelope's system prompt; 0 before any request. */
  // 中文：最新请求包络的系统提示启发式 token 数；任何请求之前为 0。
  systemTokens: number
  /** Heuristic tokens of the newest request envelope's tool schemas; 0 before any request. */
  // 中文：最新请求包络的工具 schema 启发式 token 数；任何请求之前为 0。
  toolsTokens: number
  /** Heuristic tokens of the current model-visible conversation surface. */
  // 中文：当前模型可见对话表面的启发式 token 数。
  messageTokens: number
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Provider-reported usage accumulated across the complete durable log. */
    // 中文：跨整份持久日志累计的 provider 报告用量。
    tokenUsage: TokenUsageProjection
    /** Newest request pressure paired with the newest known route capacity. */
    // 中文：最新请求压力与最新已知路由容量的配对。
    contextPressure: ContextPressureProjection
    /** Heuristic system/tools/message composition of the next request. */
    // 中文：下一次请求的启发式 system/tools/message 构成。
    contextBreakdown: ContextBreakdownProjection
  }
}
