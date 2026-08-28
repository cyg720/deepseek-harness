/** Shared live/prepared observations for Session page and lifecycle consumers.
 * @remarks 文件说明：文件职责：实现 session-query/session-query 中 observation 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * session-query/session-query 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态
 * → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type {
  BorrowedSessionSource,
  SessionPersistenceRevision,
} from '@deepseek-ai/dsh-session-persistence'
import type { ProjectionSnapshot } from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-projection-cache'
import { SessionQueryError } from './config.ts'

/** One exact immutable Session cut retained for the caller's read lifetime. */
export interface SessionObservation extends Disposable {
  /** Whether the cut came from an attached Session or a retained preparation. */
  readonly source: 'live' | 'prepared'
  /** Immutable Session identity metadata. */
  readonly header: SessionHeader
  /** Immutable contiguous events at {@link cursor}. */
  readonly events: readonly SessionEvent[]
  /** Last observed event seq, or -1 for an empty log. */
  readonly cursor: number
  /** Durable source revision for a cold prepared observation. */
  readonly revision?: SessionPersistenceRevision
  /** Exact projection baseline at {@link cursor}, when the registry is mounted. */
  readonly projections?: ProjectionSnapshot
  /**
   * Retain the same immutable cut for another Host owner.
   * @returns an independently disposable lease over this observation.
   * @remarks 中文说明：功能说明：处理 retain 相关流程；使用场景由所在模块及调用位置决定。；
   * 返回值：SessionObservation；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * retain()，并按返回类型处理结果。
   */
  retain(): SessionObservation
}

/** Projection work and cancellation requested for one exact observation. */
export interface SessionObservationOptions {
  /** Optional cancellation while resolving a cold source. */
  readonly signal?: AbortSignal
  /** Whether to compute every projection or leave projection state untouched. */
  readonly projectionMode?: 'all' | 'none'
}

/** Builds point observations without a corpus listing preflight.
 * @remarks 中文说明：类说明：SessionObservationReader 用于集中封装 处理
 * SessionObservationReader 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；
 * 使用场景：由 session-query/session-query 在对应插件或业务生命周期内创建和调用。 */
export class SessionObservationReader {
  /** @param ctx - context carrying Session and optional persistence/projection services.
   * @remarks 中文说明：功能说明：处理 SessionObservationReader 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；返回值：当前类实例；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：通过 new SessionObservationReader(ctx)
   * 创建实例，并在所属生命周期内使用。 */
  constructor(private readonly ctx: Context) {}

  /**
   * Observe one live-preferred Session and retain a cold preparation until disposal.
   * @param sessionId - logical Session identity.
   * @param options - cancellation and all-or-none projection computation for this read.
   * @returns one exact immutable observation.
   * @remarks 中文说明：功能说明：读取 read 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：sessionId（SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：options（SessionObservationOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<SessionObservation>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 read(sessionId, options)，并按返回类型处理结果。
   */
  async read(
    sessionId: SessionId,
    options: SessionObservationOptions = {},
  ): Promise<SessionObservation> {
    /**
     * 常量说明：signal、projectionMode 用于处理 signal、projectionMode 相关数据，作用于当前作用域；
     * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { signal, projectionMode = 'all' } = options
    for (;;) {
      throwIfObservationAborted(signal)
      /**
       * 常量说明：live 用于处理 live 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const live = this.ctx.sessions.get(sessionId)
      if (live !== undefined) return this.live(live, projectionMode)
      /**
       * 常量说明：persistence 用于处理 persistence 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const persistence = this.ctx.get('sessionPersistence')
      if (persistence === undefined) throw notFound(sessionId)

      /**
       * 变量说明：borrowed 用于处理 borrowed 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
       */
      let borrowed: BorrowedSessionSource
      /**
       * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
       */
      try {
        borrowed = await persistence.borrowSession(sessionId, signal)
      } catch (error: unknown) {
        throwIfObservationAborted(signal)
        if (hasErrorName(error, 'SessionPersistenceNotFoundError')) throw notFound(sessionId, error)
        if (hasErrorName(error, 'SessionPersistenceCorruptionError')) {
          throw new SessionQueryError(
            `stored session "${sessionId}" is corrupt: ${error.message}`,
            'SESSION_QUERY_CORRUPT_SESSION',
            { cause: error },
          )
        }
        throw new SessionQueryError(
          `failed to observe session "${sessionId}": ${errorMessage(error)}`,
          'SESSION_QUERY_PERSISTENCE_FAILED',
          { cause: error },
        )
      }

      /**
       * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
       */
      try {
        throwIfObservationAborted(signal)
        if (borrowed.inspection.meta.id !== sessionId) {
          throw new SessionQueryError(
            `session persistence returned "${borrowed.inspection.meta.id}" for "${sessionId}"`,
            'SESSION_QUERY_SOURCE_CONFLICT',
          )
        }
        /**
         * 常量说明：attached 用于处理 attached 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const attached = this.ctx.sessions.get(sessionId)
        if (attached !== undefined) {
          /**
           * 常量说明：liveObservation 用于处理 liveObservation 相关数据，作用于当前作用域；初始化后不可重新赋值，
           * 但对象内部是否可变仍由其类型决定。
           */
          const liveObservation = this.live(attached, projectionMode)
          borrowed[Symbol.dispose]()
          return liveObservation
        }
        if (borrowed.source === 'live') {
          // The live Session disappeared between persistence's race check and
          // this read. Retry against its now-cold durable identity.
          borrowed[Symbol.dispose]()
          continue
        }
        /**
         * 常量说明：prepared 用于处理 prepared 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const prepared = borrowed
        /**
         * 常量说明：events 用于处理 events 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const events = prepared.inspection.events
        /**
         * 变量说明：projections 用于处理 projections 相关数据，作用于当前作用域；其值可能随流程推进而变化，
         * 读写时需遵守声明类型和所在生命周期。
         */
        let projections: ProjectionSnapshot | undefined
        /**
         * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
         */
        try {
          projections = projectionMode === 'none'
            ? undefined
            : this.preparedProjections(prepared, events)
        } catch (error: unknown) {
          throw new SessionQueryError(
            `failed to project session "${sessionId}": ${errorMessage(error)}`,
            'SESSION_QUERY_CORRUPT_SESSION',
            { cause: error },
          )
        }
        /**
         * 变量说明：references 用于处理 references 相关数据，作用于当前作用域；其值可能随流程推进而变化，
         * 读写时需遵守声明类型和所在生命周期。
         */
        let references = 1
        /**
         * 常量说明：lease 用于处理 lease 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         * 功能说明：处理 lease 相关流程；使用场景由所在模块及调用位置决定。
         * @returns SessionObservation；调用方应按声明类型处理，不应假定未声明的附加状态。
         * @example 在完成前置校验后调用 lease()，并按返回类型处理结果。
         */
        const lease = (): SessionObservation => {
          /**
           * 变量说明：disposed 用于处理 disposed 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
           */
          let disposed = false
          /**
           * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
           * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
           */
          /**
           * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
           * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
           */
          return {
            source: 'prepared',
            header: prepared.inspection.meta,
            events,
            cursor: events.at(-1)?.seq ?? -1,
            revision: prepared.revision,
            ...projections === undefined ? {} : { projections },
            retain: () => {
              if (disposed || references === 0) throw new Error(`session observation "${sessionId}" is disposed`)
              references += 1
              return lease()
            },
            [Symbol.dispose]: () => {
              if (disposed) return
              disposed = true
              references -= 1
              if (references === 0) prepared[Symbol.dispose]()
            },
          }
        }
        return lease()
      } catch (error: unknown) {
        borrowed[Symbol.dispose]()
        throw error
      }
    }
  }

  /**
   * 功能说明：处理 live 相关流程；使用场景由所在模块及调用位置决定。
   * @param session （Session）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param projectionMode （NonNullable<SessionObservationOptions['projection
   * Mode']>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns SessionObservation；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 live(session, projectionMode)，并按返回类型处理结果。
   */
  private live(
    session: Session,
    projectionMode: NonNullable<SessionObservationOptions['projectionMode']>,
  ): SessionObservation {
    /**
     * 常量说明：events 用于处理 events 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const events = Object.freeze([...session.events])
    /**
     * 常量说明：projections 用于处理 projections 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const projections = projectionMode === 'none'
      ? undefined
      : this.ctx.get('sessionProjections')?.snapshot(session)
    /**
     * 常量说明：lease 用于处理 lease 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：处理 lease 相关流程；使用场景由所在模块及调用位置决定。
     * @returns SessionObservation；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 lease()，并按返回类型处理结果。
     */
    const lease = (): SessionObservation => {
      /**
       * 变量说明：disposed 用于处理 disposed 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
       */
      let disposed = false
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      return {
        source: 'live',
        header: session.header,
        events,
        cursor: events.at(-1)?.seq ?? -1,
        ...projections === undefined ? {} : { projections },
        retain: () => {
          if (disposed) throw new Error(`session observation "${session.id}" is disposed`)
          return lease()
        },
        [Symbol.dispose]: () => { disposed = true },
      }
    }
    return lease()
  }

  /**
   * 功能说明：处理 preparedProjections 相关流程；使用场景由所在模块及调用位置决定。
   * @param observation （Extract<BorrowedSessionSource, { readonly source:
   * 'prepared…）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param events （readonly SessionEvent[]）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
   * @returns ProjectionSnapshot | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 preparedProjections(observation, events)，并按返回类型处理结果。
   */
  private preparedProjections(
    observation: Extract<BorrowedSessionSource, { readonly source: 'prepared' }>,
    events: readonly SessionEvent[],
  ): ProjectionSnapshot | undefined {
    /**
     * 常量说明：registry 用于处理 registry 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const registry = this.ctx.get('sessionProjections')
    if (registry === undefined) return undefined
    /**
     * 常量说明：prepared 用于处理 prepared 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const prepared = observation.preparedSession
    /**
     * 常量说明：cache 用于处理 cache 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const cache = this.ctx.get('sessionProjectionCache')
    return cache === undefined
      ? registry.hydrate(prepared, {}, events, 0)
      : cache.hydratePrepared(prepared, observation.inspection.meta, events)
  }
}

/**
 * 功能说明：处理 throwIfObservationAborted 相关流程；使用场景由所在模块及调用位置决定。
 * @param signal （AbortSignal | undefined）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
 * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 throwIfObservationAborted(signal)，并按返回类型处理结果。
 */
function throwIfObservationAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted !== true) return
  throw new SessionQueryError(
    'session observation was aborted',
    'SESSION_QUERY_ABORTED',
    { cause: signal.reason },
  )
}

/**
 * 功能说明：处理 notFound 相关流程；使用场景由所在模块及调用位置决定。
 * @param sessionId （SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param cause （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns SessionQueryError；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 notFound(sessionId, cause)，并按返回类型处理结果。
 */
function notFound(sessionId: SessionId, cause?: unknown): SessionQueryError {
  return new SessionQueryError(
    `session "${sessionId}" not found`,
    'SESSION_QUERY_SESSION_NOT_FOUND',
    cause === undefined ? undefined : { cause },
  )
}

/**
 * 功能说明：处理 errorMessage 相关流程；使用场景由所在模块及调用位置决定。
 * @param error （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 errorMessage(error)，并按返回类型处理结果。
 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error'
}

/**
 * 功能说明：判断是否包含 Error Name 相关流程；使用场景由所在模块及调用位置决定。
 * @param error （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param name （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns error is Error；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 hasErrorName(error, name)，并按返回类型处理结果。
 */
function hasErrorName(error: unknown, name: string): error is Error {
  return error instanceof Error && error.name === name
}
