/**
 * Ownership of one unpublished Session before registry publication.
 * @module @deepseek-ai/dsh-session/preparation
 */
/*
 * ================================ 文件注释 ================================
 * 【文件职责】表达“一个尚未发布进 store 的 Session”的所有权封装（SessionPreparation），
 *           在 prepare → enter → announce 发布事务中，于发布成功或回滚时同步释放
 *           提供方（如缓存）持有的未发布状态。
 * 【技术维度】TC39 Disposable 显式资源管理协议（实现 Symbol.dispose，可被 using 语法消费）；
 *            幂等释放标志位；私有构造器 + 静态工厂方法控制创建入口。
 * 【产品维度】agent 工厂把会话生命周期折叠进自己的 effect：准备阶段拿到的这个封装保证
 *           “要么干净发布、要么干净回滚”，不会把缓存中的半成品会话泄漏出去。
 * 【逻辑维度】SessionPreparationOptions 定义可选的 release 回调；SessionPreparation 持有
 *           确切 Session 与回调；create 静态创建；dispose 时一次性触发 release。
 * 【关键边界】释放是同步且幂等的（多次 dispose 只生效一次）；提供方自行决定 release 是归还缓存
 *           还是丢弃；发布流程若在释放前就消费了那份状态，release 就成为无害的空操作。
 * 【新手阅读建议】代码很短，可直接通读；重点体会 Disposable 协议与幂等标志的配合方式。
 * ==========================================================================
 */

import type { Session } from './index.ts'

/** Options for a preparation whose provider retains unpublished state. */
/* 提供方保留“未发布状态”的准备工作所需的选项。 */
export interface SessionPreparationOptions {
  /** Release provider-owned state when the Session was not published. */
  /* Session 最终未被发布时，释放提供方所持状态的回调。 */
  readonly release?: () => void
}

/**
 * One exact unpublished Session and the provider state that keeps it usable.
 * Disposal is synchronous and idempotent. Providers decide whether release
 * returns the Session to a cache or discards it; publication may consume that
 * state before disposal, making the callback a no-op.
 */
/*
 * 一个确切的未发布 Session 及维持其可用性的提供方状态。
 * 释放（disposal）是同步且幂等的。提供方自行决定 release 是把 Session 归还缓存还是丢弃；
 * 发布过程可能在释放前就消费了那份状态，此时回调成为空操作。
 */
export class SessionPreparation implements Disposable {
  // 是否已经释放过；保证幂等。
  private released = false

  /** The exact Session to use for setup and publication. */
  /* 用于 setup 与发布的那个确切 Session。 */
  readonly session: Session

  // 私有构造：外部请通过静态 create 方法创建。
  private constructor(
    session: Session,
    private readonly options: SessionPreparationOptions,
  ) {
    this.session = session
  }

  /**
   * Wrap an unpublished Session in one preparation lifetime.
   * @param session - exact unpublished Session.
   * @param options - optional provider release behavior.
   * @returns a preparation disposed after publication or rollback.
   */
  /*
   * 把一个未发布 Session 包装进一次准备生命周期。
   * @param session - 确切的未发布 Session。
   * @param options - 可选的提供方释放行为。
   * @returns 会在发布或回滚后被释放的准备对象。
   */
  static create(session: Session, options?: SessionPreparationOptions): SessionPreparation {
    return new SessionPreparation(session, options ?? {})
  }

  /** Release provider state once when this preparation leaves its caller. */
  /* 当本准备对象离开调用方作用域时，一次性释放提供方状态。 */
  [Symbol.dispose](): void {
    if (this.released) return
    this.released = true
    this.options.release?.()
  }
}
