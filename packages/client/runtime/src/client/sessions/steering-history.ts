/**
 * ================================ 文件注释 ================================
 * 【文件职责】从事务化（event-sourced）的 agent 收件箱重建"持久化的
 *   steering（人工插话）身份"：区分用户消息来自排队轮还是下一步列表。
 * 【技术维度】事件回放类：维护按收件箱目标分类的待处理身份数组 + 已认领
 *   集合，增量吸收 agent/inbox/spliced 与 user/message 事件。
 * 【产品维度】steering（打断/插话）是产品关键交互：界面需要知道当前消息
 *   是用户主动打断产生的，以正确展示来源与层级。
 * 【逻辑维度】reset 清空回放状态；apply 吸收事件并判定是否为持久化的
 *   人工 steering 消息；applySplice 回放一次收件箱拼接（splice）操作。
 * 【关键边界】只有从 next-step 列表认领的用户消息才算 steering；
 *   canceled 结果不产生认领；调用方需按顺序喂入事件。
 * 【新手阅读建议】先理解 agent/inbox/spliced 事件的 target/start 语义。
 * ==========================================================================
 */
/** Reconstruct durable steering identity from the event-sourced agent inbox. */
/* 从事件溯源（event-sourced）的 agent 收件箱重建持久化的 steering 身份。 */

import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { InboxTarget } from '@deepseek-ai/dsh-agent/types'

/** Minimal pending identity retained while replaying durable inbox splices. */
/* 回放持久化收件箱拼接时保留的最小待处理身份。 */
interface PendingIdentity {
  readonly id: string
}

/** Client-side structural view of the host-owned inbox event. */
/* Host 侧收件箱事件在客户端的结构化视图。 */
interface InboxSplice {
  readonly target: InboxTarget
  readonly start: number
  readonly removedCount?: number
  readonly inserted: readonly PendingIdentity[]
  readonly outcome?: 'canceled'
}

/**
 * Incrementally identifies `user/message` events claimed from the next-step
 * inbox. The agent loop records all admitted input as `user/message`; the
 * preceding `agent/inbox/spliced` events preserve whether it came from the
 * queued-turn list or the next-step list.
 */
/*
 * 增量识别从 next-step 收件箱认领的 user/message 事件。agent 循环把所有
 * 被受理的输入记录为 user/message；其前的 agent/inbox/spliced 事件保留了
 * 它来自排队轮列表还是下一步列表。
 */
export class SteeringHistory {
  private readonly inbox: Record<InboxTarget, PendingIdentity[]> = {
    'next-turn': [],
    'next-step': [],
  } // 按收件箱目标分类的待处理身份队列

  private readonly claimedNextStep = new Set<string>() // 已从 next-step 认领、等待 user/message 兑现的身份集合

  /** Clear all replay state before rebuilding a history window. */
  /* 在重建历史窗口前清空全部回放状态。 */
  reset(): void {
    this.inbox['next-turn'] = []
    this.inbox['next-step'] = []
    this.claimedNextStep.clear()
  }

  /**
   * Apply one event and report whether it is a durable human steering message.
   * @param event - next raw session event in sequence order.
   * @returns true only for a user-origin message previously claimed from `next-step`.
   */
  /*
   * 吸收一个事件并报告它是否是持久化的用户 steering 消息。
   * @param event 按顺序到达的下一个原始会话事件。
   * @returns 仅当该消息是先前从 next-step 认领的用户来源消息时为 true。
   */
  apply(event: SessionEvent): boolean {
    if (event.type === 'agent/inbox/spliced') {
      this.applySplice(event.data)
      return false
    }
    if (event.type !== 'user/message') return false
    const id = event.data.id
    if (!this.claimedNextStep.delete(id)) return false // 只有先前从 next-step 认领过的才算
    return event.data.source.kind === 'user'
  }

  /** Replay one host-validated inbox splice. */
  /* 回放一次 Host 已验证的收件箱拼接操作。 */
  private applySplice({ target, start, removedCount = 0, inserted, outcome }: InboxSplice): void {
    const removed = this.inbox[target].splice(start, removedCount, ...inserted)
    for (const identity of inserted) this.claimedNextStep.delete(identity.id)
    if (target !== 'next-step' || outcome === 'canceled') return
    for (const identity of removed) this.claimedNextStep.add(identity.id)
  }
}
