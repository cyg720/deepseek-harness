/*
 * ================================ 文件注释 ================================
 * 【文件职责】纯类型、客户端安全的子代理投影词汇：子代理"身份"（模式 + 创建标签）与
 *   "进行中回合耗时"两个投影值的形状定义，并通过声明合并挂进 SessionProjectionMap。
 * 【技术维度】无任何运行时逻辑的类型模块；使用声明合并扩展
 *   @deepseek-ai/dsh-session-projection 的投影注册表映射。
 * 【产品维度】会话投影（projection）是"从会话日志折叠出的持久摘要"，这里定义子代理相关摘要的
 *   形状，供枚举子代理（list-children）与 API 代理在浏览器端复用同一套类型。
 * 【逻辑维度】按代码顺序：SubagentTimingProjection（耗时）→ SubagentIdentityProjection（身份，区分
 *   one-shot/continuable 两臂）→ 声明合并把两者注册进 SessionProjectionMap。
 * 【关键边界】identity 的 seq 字段用于证明身份来自子代理"自己的日志后缀"而非 fork seed 回放；
 *   null 哨兵表示"无有效描述符"，可被 JSON 无损序列化。
 * 【新手阅读建议】先读 SubagentIdentityProjection 的 union 两臂，再看 projection.ts 如何折叠产生它。
 * ==========================================================================
 */

/**
 * Pure client-safe subagent projection vocabulary.
 *
 * @module @deepseek-ai/dsh-subagent/projection-types
 */

/** Durable active-turn timing for one descriptor-backed child session. */
// 中文：子代理"进行中回合耗时"投影：settledMs 是已结束回合累计的毫秒数，
// active 是当前未结束回合的起止时间窗（存在时才有）。
export interface SubagentTimingProjection {
  /** Milliseconds accumulated across completed turns after the child's own descriptor. */
  settledMs: number
  /** Same-cut bounds of the currently open turn, when one has not reached `turn/end`. */
  active?: {
    /** Start of the open turn. */
    since: number
    /** Latest event time folded into this projection cut. */
    through: number
  }
}

/**
 * Durable identity of one descriptor-backed subagent session: lifecycle mode
 * plus creation label, folded last-wins from `subagent/descriptor` events.
 * Label strength follows the descriptor schema: a continuable child always
 * carries one, a one-shot child may omit it.
 */
// 中文：子代理"身份"投影（union）：one-shot 臂标签可选，continuable 臂标签必填；
// seq 是该身份所源自的 subagent/descriptor 事件的序号，用于证明身份来自
// 子代理自己的日志后缀（seq >= seedLength）而非 fork seed 回放的祖先描述符。
export type SubagentIdentityProjection =
  | {
    /** A terminal one-shot child. */
    mode: 'one-shot'
    /** Optional durable creation label from the child's descriptor. */
    label?: string
    /**
     * Seq of the `subagent/descriptor` event this identity was folded from.
     * `seq >= header.seedLength` proves the identity comes from the child's
     * OWN log suffix — where a descriptor is immutable once appended — and
     * not from a fork seed's replayed ancestor descriptor.
     */
    seq: number
  }
  | {
    /** A resumable conversation. */
    mode: 'continuable'
    /** Durable creation label from the child's descriptor. */
    label: string
    /** Seq of the folded descriptor event; see the one-shot arm for the own-suffix proof. */
    seq: number
  }

// 中文：声明合并：把两个子代理投影键注册进 SessionProjectionMap，
// 使 session-projection 注册表在类型层面认识 subagentTiming 与 subagent 两个键。
declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Active-turn duration for a descriptor-backed subagent session. */
    subagentTiming: SubagentTimingProjection
    /**
     * Identity of a descriptor-backed subagent session. `null` ⟺ no valid
     * descriptor (missing, malformed, or unrecognized-version — deliberately
     * undistinguished). The sentinel is deliberately serializable: a
     * value pushed over JSON transports must survive `JSON.stringify`
     * losslessly, where an `undefined` field would be dropped and a stale
     * identity would survive on the receiving side. The entry itself stays
     * non-optional.
     */
    subagent: SubagentIdentityProjection | null
  }
}
