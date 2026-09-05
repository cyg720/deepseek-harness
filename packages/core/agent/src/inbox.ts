
/**
 * Incremental projection of durable agent inbox events.
 *
 * @module @deepseek-ai/dsh-agent/inbox
 */

/*
 * 【文件职责】从持久 Agent inbox 事件增量重建队列状态，使输入的认领与恢复使用同一事实来源。
 */

import type { MessageId } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEventMap, UserMessage } from '@deepseek-ai/dsh-session'
import type { InboxTarget } from './types.ts'

/** Mutable state privately owned by an {@link Inbox}. */
// 内部可变状态：两个待处理列表（普通轮次队列 + 步骤边界输入），Inbox 之外的代码不可直接修改。
type InboxState = Record<InboxTarget, UserMessage[]>

/** Live notifications committed by inbox mutations. */
// 变更后向外部发布的通知回调集：由调用方（ReactLoopAgent 构造函数）提供，用于转发成 agent 事件。
export interface InboxNotifications {
  /** Publish one inserted message. */
  // 发布一条新插入的消息。
  inserted(message: UserMessage): void
  /** Publish one discarded message. */
  // 发布一条被丢弃的消息。
  discarded(message: UserMessage): void
  /** Publish one claimed message inside its owning turn. */
  // 在所属轮次内发布一条被领取的消息。
  claimed(message: UserMessage, turn: number): void
}

/** A replay-once projection that incrementally consumes later inbox splices. */
// 收件箱：对持久化 inbox 事件做“重放一次 + 增量消费”的投影，内存列表与会话日志保持同步。
export class Inbox {
  // 两个待处理列表的初始状态；此后每次变更都必须先写会话事件再改这里。
  private readonly state: InboxState = { 'next-turn': [], 'next-step': [] }

  constructor(
    private readonly session: Session,
    private readonly notifications: InboxNotifications,
  ) {
    for (const event of session.ownEvents()) {
      if (event.type !== 'agent/inbox/spliced') continue
      try {
        this.apply(event.data)
      } catch (error: unknown) {
        // 持久化的 splice 无法重放说明日志损坏：带上事件序号报错，便于定位。
        throw new Error(`invalid persisted inbox splice at session seq ${event.seq}`, { cause: error })
      }
    }
  }

  /** Prompts awaiting individual turns. */
  // 等待独立轮次的普通消息（只读视图）。
  get nextTurn(): readonly UserMessage[] {
    return this.state['next-turn']
  }

  /** Input awaiting the next step boundary. */
  // 等待最近一步边界消费的转向/上下文输入（只读视图）。
  get nextStep(): readonly UserMessage[] {
    return this.state['next-step']
  }

  /** Whether either pending-message list contains work. */
  // 任一列表有内容即认为有未处理的工作（唤醒驱动器的判断依据）。
  get hasPending(): boolean {
    return this.nextTurn.length > 0 || this.nextStep.length > 0
  }

  /** Durably cancel all pending input, clearing next-step before next-turn. */
  // 持久化地清空全部待处理输入；先清 next-step 再清 next-turn，保证取消记录顺序稳定。
  clear(): void {
    this.splice('next-step', 0, this.nextStep.length, [])
    this.splice('next-turn', 0, this.nextTurn.length, [])
  }

  /**
   * Remove and return the complete batch proposed for one step, publishing
   * each claimed message. The durable splices are pure deletions.
   * @param target - whether this boundary also consumes one queued turn.
   * @param turn - turn that will own the claimed batch.
   * @returns next-step input followed by the queued turn, when requested.
   * @internal - The agent loop's step-boundary operation, not a plugin extension point.
   */
  // 领取一步要消费的整批消息：先取全部 next-step，若目标含 next-turn 再取队首一条普通消息；随后逐个发布 claimed 通知。
  claim(target: InboxTarget, turn: number): UserMessage[] {
    const claimed = this.mutate('next-step', 0, this.nextStep.length, [], false)
    if (target === 'next-turn') {
      claimed.push(...this.mutate('next-turn', 0, 1, [], false))
    }
    for (const message of claimed) this.notifications.claimed(message, turn)
    return claimed
  }

  /**
   * Append one message to a pending list and durably record the insertion.
   * @param target - pending list to extend.
   * @param message - message to append.
   * @throws if the message identity is already pending.
   */
  // 追加一条消息到指定列表尾部并持久化记录。
  append(target: InboxTarget, message: UserMessage): void {
    this.splice(target, this.state[target].length, 0, [message])
  }

  /**
   * Prepend one message to a pending list and durably record the insertion.
   * @param target - pending list to extend.
   * @param message - message to prepend.
   * @throws if the message identity is already pending.
   */
  // 把一条消息插到指定列表头部并持久化记录（steering 等需要优先消费的场景使用）。
  prepend(target: InboxTarget, message: UserMessage): void {
    this.splice(target, 0, 0, [message])
  }

  /**
   * Replace one pending message in place, possibly changing its identity. A
   * successful replacement publishes the old message as discarded and the new
   * message as inserted.
   * @param messageId - identity of the pending message to replace.
   * @param newMessage - replacement message.
   * @returns whether the message was still pending.
   * @throws if the replacement duplicates another pending message identity.
   */
  // 原位替换一条待处理消息（可换身份）；替换成功后旧消息发布 discarded、新消息发布 inserted。
  replace(messageId: MessageId, newMessage: UserMessage): boolean {
    const location = this.locate(messageId)
    if (location === undefined) return false
    this.splice(location.target, location.index, 1, [newMessage])
    return true
  }

  /**
   * Remove one pending message and durably record its cancellation.
   * @param messageId - identity of the pending message to remove.
   * @returns whether the message was still pending.
   */
  // 按身份移除一条待处理消息并持久化记录为取消。
  remove(messageId: MessageId): boolean {
    const location = this.locate(messageId)
    if (location === undefined) return false
    this.splice(location.target, location.index, 1, [])
    return true
  }

  /**
   * Apply standard splice semantics and durably record the normalized result.
   * The durable event commits before the live projection mutates, so synchronous
   * `session/event` observers see the pre-splice lists and can reconstruct the
   * removed messages from the normalized coordinates.
   * @param target - pending list to mutate.
   * @param start - splice position.
   * @param deleteCount - maximum number of messages to remove.
   * @param inserted - messages to insert at the resolved position.
   * @returns messages removed by the splice.
   */
  // 对外暴露的标准 splice 语义：参数规范化后交给 mutate 执行，返回被移除的消息。
  splice(
    target: InboxTarget,
    start: number,
    deleteCount: number,
    inserted: UserMessage[],
  ): UserMessage[] {
    return this.mutate(target, start, deleteCount, inserted, true)
  }

  /** Locate one pending identity across both owned lists. */
  // 在两个列表里按消息身份查找其位置；找不到返回 undefined。
  private locate(messageId: MessageId): { target: InboxTarget; index: number } | undefined {
    for (const target of ['next-turn', 'next-step'] as const) {
      const index = this.state[target].findIndex(message => message.id === messageId)
      if (index >= 0) return { target, index }
    }
    return undefined
  }

  /** Commit one normalized mutation and publish its live notifications. */
  // 所有变更的唯一出口：规范化坐标 → 校验 → 先写会话事件（durable）→ 再改内存并发布通知。
  private mutate(
    target: InboxTarget,
    start: number,
    deleteCount: number,
    inserted: UserMessage[],
    discardRemoved: boolean,
  ): UserMessage[] {
    const inbox = this.state[target]
    // 坐标规范化：非整数取整、NaN 视为 0、负索引按数组尾部偏移、越界钳制到边界。
    const truncatedStart = Math.trunc(start)
    const offset = Number.isNaN(truncatedStart) ? 0 : truncatedStart
    const actualStart = offset < 0
      ? Math.max(inbox.length + offset, 0)
      : Math.min(offset, inbox.length)
    const truncatedDeleteCount = Math.trunc(deleteCount)
    const actualDeleteCount = Math.min(
      Math.max(Number.isNaN(truncatedDeleteCount) ? 0 : truncatedDeleteCount, 0),
      inbox.length - actualStart,
    )
    // 无删除也无插入的空操作：不产生任何事件与通知。
    if (actualDeleteCount === 0 && inserted.length === 0) return []
    // 有删除且 discardRemoved 为真（对外 splice）时标记 outcome: 'canceled'，供工作审计区分“领取”与“丢弃”。
    const outcome = discardRemoved && actualDeleteCount > 0 ? 'canceled' as const : undefined
    const splice = {
      target,
      start: actualStart,
      ...(actualDeleteCount === 0 ? {} : { removedCount: actualDeleteCount }),
      inserted,
      ...(outcome === undefined ? {} : { outcome }),
    }
    this.validate(splice)
    // 先持久化：事件落盘后同步观察者还能读到变更前的列表。
    const event = this.session.append('agent/inbox/spliced', splice)
    const removed = inbox.splice(actualStart, actualDeleteCount, ...event.data.inserted)
    // 再改内存：被丢弃的逐条发 discarded，新插入的逐条发 inserted。
    if (discardRemoved) {
      for (const message of removed) this.notifications.discarded(message)
    }
    for (const message of event.data.inserted) this.notifications.inserted(message)
    return removed
  }

  /** Apply one normalized durable splice to the projection. */
  // 重放用：把一个已持久化的 splice 直接应用到内存投影（不写事件、不发布通知）。
  private apply(splice: SessionEventMap['agent/inbox/spliced']): UserMessage[] {
    this.validate(splice)
    const inbox = this.state[splice.target]
    return inbox.splice(splice.start, splice.removedCount ?? 0, ...splice.inserted)
  }

  /** Validate one normalized splice against the current projection. */
  // 校验：坐标必须在合法范围内，且变更后任一列表中不得出现重复的消息身份。
  private validate(splice: SessionEventMap['agent/inbox/spliced']): void {
    const inbox = this.state[splice.target]
    const removedCount = splice.removedCount ?? 0
    if (!Number.isSafeInteger(splice.start) || splice.start < 0 || splice.start > inbox.length
      || !Number.isSafeInteger(removedCount) || removedCount < 0
      || splice.start + removedCount > inbox.length) {
      throw new Error('invalid inbox splice')
    }
    const candidate = inbox.toSpliced(splice.start, removedCount, ...splice.inserted)
    const ids = new Set<string>()
    // 变更后的目标列表要与另一列表合并检查，确保消息身份在“全局”唯一。
    for (const message of splice.target === 'next-turn'
      ? [...candidate, ...this.nextStep]
      : [...this.nextTurn, ...candidate]) {
      if (ids.has(message.id)) throw new Error(`message "${message.id}" is already pending`)
      ids.add(message.id)
    }
  }
}
