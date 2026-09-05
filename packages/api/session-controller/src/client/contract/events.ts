/*
 * 【文件职责】定义连续会话事件窗口；
 * 客户端临时助手片段通过逻辑序号定位，不能作为持久化事件写回日志。
 */

import { notifySubscribers, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { LlmAttemptId, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'

/** Client-only live chunk presentation; `seq` orders the transient row between durable Session seqs. */
export interface AssistantLiveChunkEvent {
  readonly type: 'assistant/live-chunk'
  readonly seq: number
  readonly time: number
  readonly data: {
    readonly attemptId: LlmAttemptId
    readonly turn: number
    readonly step: number
    readonly chunk: StreamChunk
  }
}

/** Current durable Session event or one client-only live chunk presentation. */
export type SessionEventLike = SessionEvent | AssistantLiveChunkEvent

/** Client history entry retaining its coarse transport discriminator. */
export type SessionEventLikeEntry =
  | { readonly type: 'event'; readonly event: SessionEvent }
  | { readonly type: 'transient'; readonly event: AssistantLiveChunkEvent }

/** Scalar live entry accepted by append-only Client paths. */
export type SessionLiveEventEntry = Extract<SessionEventLikeEntry, { readonly type: 'event' }>
/** Durable Assistant event that atomically supersedes one attempt's transient rows. */
export interface SessionAssistantSettlementEntry {
  readonly type: 'event'
  readonly event: SessionEvent<'assistant/message'> | SessionEvent<'assistant/attempt'>
}
/** Client-only Assistant frame admitted outside durable cursor algebra. */
export type SessionTransientEventEntry = Extract<SessionEventLikeEntry, { readonly type: 'transient' }>

interface EventWindowLeaf {
  readonly kind: 'leaf'
  readonly entries: readonly SessionEventLikeEntry[]
  readonly length: number
}

interface EventWindowConcat {
  readonly kind: 'concat'
  readonly left: EventWindowNode
  readonly right: EventWindowNode
  readonly length: number
}

type EventWindowNode = EventWindowLeaf | EventWindowConcat

/**
 * 功能说明：处理 leaf 相关流程；使用场景由所在模块及调用位置决定。
 * @param entries （readonly SessionEventLikeEntry[]）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @returns EventWindowLeaf；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 leaf(entries)，并按返回类型处理结果。
 */
function leaf(entries: readonly SessionEventLikeEntry[]): EventWindowLeaf {
  return { kind: 'leaf', entries, length: entries.length }
}

/**
 * 功能说明：处理 concat 相关流程；使用场景由所在模块及调用位置决定。
 * @param left （EventWindowNode）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param right （EventWindowNode）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns EventWindowConcat；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 concat(left, right)，并按返回类型处理结果。
 */
function concat(left: EventWindowNode, right: EventWindowNode): EventWindowConcat {
  return { kind: 'concat', left, right, length: left.length + right.length }
}

/**
 * 功能说明：处理 materialize 相关流程；使用场景由所在模块及调用位置决定。
 * @param node （EventWindowNode）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns readonly SessionEventLikeEntry[]；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 materialize(node)，并按返回类型处理结果。
 */
function materialize(node: EventWindowNode): readonly SessionEventLikeEntry[] {
  if (node.kind === 'leaf') return node.entries
  /**
   * 常量说明：entries 用于处理 entries 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const entries = new Array<SessionEventLikeEntry>(node.length)
  /**
   * 常量说明：pending 用于处理 pending 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const pending: EventWindowNode[] = [node]
  /**
   * 变量说明：index 用于处理 index 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let index = 0
  while (pending.length > 0) {
    /**
     * 常量说明：current 用于处理 current 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const current = pending.pop() as EventWindowNode
    if (current.kind === 'concat') {
      pending.push(current.right, current.left)
      continue
    }
    for (const /*
     * 变量说明：entry 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */ entry of current.entries) {
      entries[index] = entry
      index += 1
    }
  }
  return entries
}

/**
 * 功能说明：处理 windowSnapshot 相关流程；使用场景由所在模块及调用位置决定。
 * @param node （EventWindowNode）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param hasMore （boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param revision （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param change （SessionEventChange）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns SessionEventWindow；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 windowSnapshot(node, hasMore, revision, change)，
 * 并按返回类型处理结果。
 */
function windowSnapshot(
  node: EventWindowNode,
  hasMore: boolean,
  revision: number,
  change: SessionEventChange,
): SessionEventWindow {
  /**
   * 变量说明：entries 用于处理 entries 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let entries: readonly SessionEventLikeEntry[] | undefined
  return {
    /**
     * 功能说明：处理 entries 相关流程；使用场景由所在模块及调用位置决定。
     * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 entries()，并按返回类型处理结果。
     */
    get entries() {
      entries ??= materialize(node)
      return entries
    },
    hasMore,
    revision,
    change,
  }
}

/** Exact delta that produced the latest event-window revision. */
export type SessionEventChange =
  | { readonly kind: 'replace'; readonly entries: readonly SessionEventLikeEntry[] }
  | { readonly kind: 'prepend'; readonly entries: readonly SessionEventLikeEntry[] }
  | { readonly kind: 'append'; readonly entries: readonly SessionEventLikeEntry[] }
  | {
    readonly kind: 'settle-assistant'
    readonly attemptId: LlmAttemptId
    readonly entry?: SessionAssistantSettlementEntry
  }

/** Current contiguous event window and its latest synchronous delta. */
export interface SessionEventWindow {
  readonly entries: readonly SessionEventLikeEntry[]
  readonly hasMore: boolean
  readonly revision: number
  readonly change: SessionEventChange
}

/** Conversation-facing event source exposed by one Session binding. */
export type SessionEventSource = ObservableSnapshot<SessionEventWindow>

/** Session-owned event feed; every accepted window mutation publishes synchronously.
 * @remarks 中文说明：类说明：MutableSessionEventSource 用于集中封装 处理
 * MutableSessionEventSource 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；
 * 使用场景：由 api/session-controller 在对应插件或业务生命周期内创建和调用。 */
export class MutableSessionEventSource implements SessionEventSource {
  /**
   * 常量说明：listeners 用于处理 listeners 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly listeners = new Set<() => void>()
  /**
   * 变量说明：window 用于处理 window 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private window: EventWindowNode = leaf([])
  /**
   * 变量说明：snapshot 用于处理 snapshot 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private snapshot: SessionEventWindow = windowSnapshot(
    this.window,
    false,
    0,
    { kind: 'replace', entries: [] },
  )

  /** @returns the cached event-window snapshot.
   * @remarks 中文说明：功能说明：获取 Snapshot 相关流程；使用场景由所在模块及调用位置决定。；
   * 返回值：SessionEventWindow；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * getSnapshot()，并按返回类型处理结果。 */
  getSnapshot(): SessionEventWindow { return this.snapshot }

  /**
   * Subscribe to synchronous window publication.
   * @param listener - invalidation callback.
   * @returns unsubscribe function.
   * @remarks 中文说明：功能说明：处理 subscribe 相关流程；使用场景由所在模块及调用位置决定。；参数说明：listener（()
   * => void）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。；返回值：() => void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 subscribe(listener)，并按返回类型处理结果。
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Replace the complete contiguous window.
   * @param entries - complete window.
   * @param hasMore - whether older history remains.
   * @remarks 中文说明：功能说明：处理 replace 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：entries（readonly SessionEventLikeEntry[]）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；参数说明：hasMore（boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 replace(entries,
   * hasMore)，并按返回类型处理结果。
   */
  replace(entries: readonly SessionEventLikeEntry[], hasMore: boolean): void {
    this.window = leaf(entries)
    this.publish(hasMore, { kind: 'replace', entries })
  }

  /**
   * Prepend one older contiguous page.
   * @param entries - newly loaded older entries.
   * @param hasMore - whether still older history remains.
   * @remarks 中文说明：功能说明：处理 prepend 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：entries（readonly SessionEventLikeEntry[]）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；参数说明：hasMore（boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 prepend(entries,
   * hasMore)，并按返回类型处理结果。
   */
  prepend(entries: readonly SessionEventLikeEntry[], hasMore: boolean): void {
    this.window = concat(leaf(entries), this.window)
    this.publish(hasMore, { kind: 'prepend', entries })
  }

  /**
   * Append one contiguous live entry.
   * @param entry - live tail entry.
   * @remarks 中文说明：功能说明：处理 append 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：entry（SessionLiveEventEntry）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 append(entry)，并按返回类型处理结果。
   */
  append(entry: SessionEventLikeEntry): void {
    const entries = [entry]
    this.window = concat(this.window, leaf(entries))
    this.publish(this.snapshot.hasMore, {
      kind: 'append',
      entries,
    })
  }

  /**
   * Replace one attempt's transient rows with its committed durable settlement.
   * @param attemptId - process-local attempt whose live rows are now redundant.
   * @param entry - durable settlement committed for that attempt.
   */
  settleAssistant(attemptId: LlmAttemptId, entry?: SessionAssistantSettlementEntry): void {
    const entries = materialize(this.window).filter(candidate => (
      candidate.type !== 'transient' || candidate.event.data.attemptId !== attemptId
    ))
    if (entry !== undefined) {
      const index = entries.findIndex(candidate => candidate.event.seq > entry.event.seq)
      if (index < 0) entries.push(entry)
      else entries.splice(index, 0, entry)
    }
    this.window = leaf(entries)
    this.publish(this.snapshot.hasMore, {
      kind: 'settle-assistant',
      attemptId,
      ...(entry === undefined ? {} : { entry }),
    })
  }

  private publish(
    hasMore: boolean,
    change: SessionEventChange,
  ): void {
    this.snapshot = windowSnapshot(this.window, hasMore, this.snapshot.revision + 1, change)
    notifySubscribers(this.listeners, '[session-controller] event feed')
  }
}
