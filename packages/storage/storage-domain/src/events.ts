/**
 * ================================ 文件注释 ================================
 * 【文件职责】定义领域数据"变更事件"（domain/changed）的词汇表：每次持久化写入在
 * 后端确认落盘后发出一个事件，携带新快照与操作判别符。
 * 【技术维度】纯类型模块（无运行时逻辑）：用可辨识联合（discriminated union）描述
 * 变更事件，操作字段 operation 是判别符；通过声明合并（declare module）把事件挂到
 * Cordis 的 Events 映射上，使 ctx.emit/ctx.on 获得类型提示。
 * 【产品维度】这是跨进程变更推送（RPC 帧）的事件源：其他组件（如界面、日志投影）订阅
 * 该事件即可感知领域数据变化，无需轮询。
 * 【逻辑维度】按出现顺序：DomainChangedBase（公共定位字段）→ DomainChangedPut（写入事件）
 * → DomainChangedDeleted（删除事件）→ DomainChanged（闭合联合）→ Cordis 事件声明。
 * 【关键边界】事件只带新值、绝不含旧值（需要做 diff 的消费方自己保存上一份快照）；
 * 事件在"后端确认持久化之后"发出，且每个领域的事件按写入顺序到达。
 * 【新手阅读建议】先看 DomainChanged 联合类型了解事件长什么样，再看 declare module
 * 部分理解事件如何挂到 Cordis 上。
 * ==========================================================================
 */
/**
 * Change-event vocabulary of the domain data form. Every durable write emits
 * one event after the backend resolves durability, carrying the new snapshot
 * and an operation discriminant — never the old value (a diffing consumer
 * keeps its own previous snapshot). This is the event source for cross-process
 * change push (RPC frames) in a later phase.
 * @module @deepseek-ai/dsh-storage-domain/src/events
 */
/**
 * 模块总览：本文件只声明事件的类型，实际发出事件的代码在 domain.ts 的 DomainImpl 中。
 * 事件作为"通知"而非事务参与者：即使监听器抛错，写入也早已提交。
 */

/** Shared location fields of one durable domain change. */
export interface DomainChangedBase {
  /** Owning domain name. */
  readonly domain: string
  /** Table name; `''` for a global-singleton write. */
  readonly table: string
  /** Record key; `''` for a global-singleton write. */
  readonly key: string
}

/** A record (or the global singleton) was inserted or overwritten. */
export interface DomainChangedPut extends DomainChangedBase {
  readonly operation: 'put'
  /** The new snapshot. */
  readonly value: unknown
}

/** A record was deleted; tombstones carry no value. */
export interface DomainChangedDeleted extends DomainChangedBase {
  readonly operation: 'deleted'
  readonly value?: never
}

/** One durable domain change; a closed union — switch on `operation`. */
export type DomainChanged = DomainChangedPut | DomainChangedDeleted

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A domain record or the global singleton changed, emitted once per write
     * strictly after the backend acknowledged durability. Events of one
     * domain arrive in its write-chain order.
     * @param change - domain, table (`''` for global), key (`''` for global),
     * operation discriminant, and on `put` the new snapshot.
     * @mode emit
     */
    /**
     * 中文说明：这是 Cordis 的事件声明（声明合并）。声明后 ctx.emit('domain/changed', ...)
     * 与 ctx.on('domain/changed', ...) 就有了类型检查。事件在写入被后端确认持久化后发出，
     * 同一领域的事件按写入顺序到达。
     */
    'domain/changed'(change: DomainChanged): void
  }
}
