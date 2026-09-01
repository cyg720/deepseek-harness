/**
 * Durable agent session-event vocabulary shared with type-only consumers.
 *
 * @module @deepseek-ai/dsh-agent/types
 */

/*
 * ================================ 文件注释 ================================
 * 【文件职责】声明 dsh-agent 的会话级事件词汇：把 inbox 变更事件注入 @deepseek-ai/dsh-session 的事件类型图，供类型消费者使用。
 * 【技术维度】类型声明合并（declaration merging）：通过 declare module 向 SessionEventMap 追加成员；本文件只含类型，无运行时代码。
 * 【产品维度】inbox（待处理消息队列）的每次增删改都被记录为可重放的会话事件，支撑“模型可见即日志可重建”的产品承诺。
 * 【逻辑维度】InboxTarget 类型 → SessionEventMap 扩展（agent/inbox/spliced 事件负载定义）。
 * 【关键边界】事件负载必须能无损序列化；live 分发先于投影变更，同步观察者可读到 splice 前的 inbox 以恢复被移除消息。
 * 【新手阅读建议】很短，直接读完；结合 dsh-agent/inbox.ts 的 mutate() 看该事件实际在哪里被写入。
 * ==========================================================================
 */

import type { UserMessage } from '@deepseek-ai/dsh-llm/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TypertContext, TypertLookup } from '@deepseek-ai/dsh-typert-protocol'

/** Public live-agent handle; the runtime face augments its live capabilities. */
export interface Agent {
  /** Session-backed Agent identity. */
  readonly id: SessionId
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertLookupMap {
    agent: TypertLookup<Agent, SessionId>
  }

  interface TypertContextMap {
    /** Agent Context identity shared by Host and Client adapters. */
    agent: TypertContext<SessionId>
  }
}

/** One of the two ordered pending-message lists owned by an agent. */
export type InboxTarget = 'next-turn' | 'next-step'

/**
 * Turn and step boundaries folded from one agent session log.
 *
 * Reader contract: the key is registered by `dsh-agent-loop` and absent
 * otherwise. Without agent-loop no turn events exist, so readers treat an
 * absent key as "no open turn / no boundaries" — capability absence, not a
 * corrupt state. A reader whose behavior has no safe fallback for that
 * absence (the step-open decision, for example) may fail loud instead.
 */
export interface TurnBoundaryProjection {
  /** Seq of the open turn's `turn/start`, or null between turns. */
  readonly openTurnStartSeq: number | null
  /** Seq of the latest `step/start` event, or null before the first step. */
  readonly lastStepStartSeq: number | null
  /** The latest step boundary (`step/start` or `step/end`) and its seq, or null before the first step boundary. */
  readonly lastStepBoundary: { readonly kind: 'start' | 'end'; readonly seq: number } | null
  /** Turn number of the latest `turn/start`; 0 before the first turn. */
  readonly lastTurn: number
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One normalized mutation of an agent's durable pending-message lists.
     * Live dispatch precedes projection mutation, so synchronous observers may
     * read the pre-splice inbox to recover the removed messages.
     */
    'agent/inbox/spliced': {
      target: InboxTarget
      start: number
      removedCount?: number
      inserted: UserMessage[]
      outcome?: 'canceled'
    }
  }
}
