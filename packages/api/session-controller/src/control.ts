/** Live Session queue, jobs, and projection state with reconnect baselines.
 * @remarks 文件说明：文件职责：实现 api/session-controller 中 control 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * api/session-controller 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { JobSnapshot } from '@deepseek-ai/dsh-jobs'
import type {
  JsonValue, Session, SessionEvent, SessionEventMap, SessionId, UserMessage,
} from '@deepseek-ai/dsh-session'
import type {
  SessionControlBaseline,
  SessionControlFrame,
  SessionJob,
  SessionProjectionBaseline,
  SessionProjectionValues,
  SessionQueuedItem,
} from './types.ts'

/** Owns the Host-wide Session control stream.
 * @remarks 中文说明：类说明：SessionControlController 用于集中封装 处理
 * SessionControlController 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；
 * 使用场景：由 api/session-controller 在对应插件或业务生命周期内创建和调用。 */
export class SessionControlController {
  /**
   * 常量说明：streams 用于处理 streams 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly streams = new Set<ControlQueue>()

  /** @param ctx - Host context carrying live Agent, projection, and jobs services.
   * @remarks 中文说明：功能说明：处理 SessionControlController 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；返回值：当前类实例；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：通过 new SessionControlController(ctx)
   * 创建实例，并在所属生命周期内使用。 */
  constructor(private readonly ctx: Context) {
    ctx.on('session/event', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：session（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：event（由 TypeScript
 * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(session, event)，
 * 并按返回类型处理结果。
 */ (session, event) => { this.onSessionEvent(session, event) })
    ctx.inject(['sessionProjections'], /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：projectionCtx（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(projectionCtx)，并按返回类型处理结果。
 */ (projectionCtx) => {
        projectionCtx.sessionProjections.onChanged(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：session（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：key（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：value（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：seq（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(session, key, value, seq)，
 * 并按返回类型处理结果。
 */ (session, key, value, seq) => {
            this.broadcast({
              type: 'projection',
              sessionId: session.id,
              key,
              value: value as JsonValue,
              seq,
            })
          })
      })
    ctx.inject(['jobs'], /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：jobsCtx（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(jobsCtx)，并按返回类型处理结果。
 */ (jobsCtx) => {
        jobsCtx.jobs.onJobsChanged(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：owner（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(owner)，并按返回类型处理结果。
 */ (owner) => { this.onJobsChanged(owner) })
      })
    ctx.on('session/created', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：session（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(session)，并按返回类型处理结果。
 */ (session) => {
      /**
       * 常量说明：jobs 用于处理 jobs 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
        const jobs = this.jobsFor(this.ctx.agents.get(session.id))
        if (jobs.length > 0) this.broadcast({ type: 'jobs', sessionId: session.id, jobs })
      })
    ctx.effect(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
          for (const /*
       * 变量说明：stream 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */ stream of this.streams) stream.end()
          this.streams.clear()
        }, 'session-controller.control')
  }

  /**
   * Open one generation of Host-wide live control state.
   * @param signal - Remote stream cancellation.
   * @returns one complete baseline followed by live replacement frames.
   * @remarks 中文说明：功能说明：处理 control 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：signal（AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；
   * 返回值：AsyncIterable<SessionControlFrame>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 control(signal)，并按返回类型处理结果。
   */
  async *control(signal: AbortSignal): AsyncIterable<SessionControlFrame> {
    signal.throwIfAborted()
    /**
     * 常量说明：queue 用于处理 queue 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const queue = new ControlQueue()
    this.streams.add(queue)
    try {
      yield { type: 'baseline', value: this.baseline() }
      yield* queue.iterate(signal)
    } finally {
      this.streams.delete(queue)
      queue.end()
    }
  }

  /**
   * 功能说明：处理 baseline 相关流程；使用场景由所在模块及调用位置决定。
   * @returns SessionControlBaseline；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 baseline()，并按返回类型处理结果。
   */
  private baseline(): SessionControlBaseline {
    /**
     * 常量说明：sessions 用于处理 sessions 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const sessions = this.ctx.sessions.list()
    /**
     * 常量说明：queues 用于处理 queues 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const queues = Object.create(null) as Record<SessionId, readonly SessionQueuedItem[]>
    /**
     * 常量说明：jobs 用于处理 jobs 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const jobs = Object.create(null) as Record<SessionId, readonly SessionJob[]>
    for (const /*
     * 变量说明：session 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */ session of sessions) {
      /**
       * 常量说明：agent 用于处理 agent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const agent = this.ctx.agents.get(session.id)
      queues[session.id] = agent?.session === session ? queueItems(agent) : []
      jobs[session.id] = this.jobsFor(agent)
    }
    return {
      queues,
      jobs,
      projections: this.projectionBaseline(sessions),
    }
  }

  /**
   * 功能说明：处理 projectionBaseline 相关流程；使用场景由所在模块及调用位置决定。
   * @param sessions （readonly Session[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Readonly<Record<SessionId, SessionProjectionBaseline>>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 projectionBaseline(sessions)，并按返回类型处理结果。
   */
  private projectionBaseline(
    sessions: readonly Session[],
  ): Readonly<Record<SessionId, SessionProjectionBaseline>> {
    /**
     * 常量说明：registry 用于处理 registry 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const registry = this.ctx.get('sessionProjections')
    /**
     * 常量说明：blocks 用于处理 blocks 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const blocks = Object.create(null) as Record<SessionId, SessionProjectionBaseline>
    for (const /*
     * 变量说明：session 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */ session of sessions) {
      /**
       * 常量说明：snapshot 用于处理 snapshot 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const snapshot = registry?.snapshot(session)
      blocks[session.id] = snapshot === undefined
        ? { asOfSeq: session.seq - 1, values: {} }
        : {
          asOfSeq: snapshot.asOfSeq,
          // Every projection definition validates its value before snapshot publication.
          values: snapshot.values as SessionProjectionValues,
        }
    }
    return blocks
  }

  /**
   * 功能说明：响应 Session Event 相关流程；使用场景由所在模块及调用位置决定。
   * @param session （Session）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param event （SessionEvent）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 onSessionEvent(session, event)，并按返回类型处理结果。
   */
  private onSessionEvent(session: Session, event: SessionEvent): void {
    if (event.type !== 'agent/inbox/spliced') return
    /**
     * 常量说明：agent 用于处理 agent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const agent = this.ctx.agents.get(session.id)
    if (agent?.session !== session) return
    this.broadcast({
      type: 'queue',
      sessionId: session.id,
      items: queueItems(agent, event.data),
    })
  }

  /**
   * 功能说明：响应 Jobs Changed 相关流程；使用场景由所在模块及调用位置决定。
   * @param owner （Agent | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 onJobsChanged(owner)，并按返回类型处理结果。
   */
  private onJobsChanged(owner: Agent | undefined): void {
    if (owner !== undefined) {
      this.broadcast({ type: 'jobs', sessionId: owner.id, jobs: this.jobsFor(owner) })
      return
    }
    for (const /*
     * 变量说明：session 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */ session of this.ctx.sessions.list()) {
      this.broadcast({
        type: 'jobs',
        sessionId: session.id,
        jobs: this.jobsFor(this.ctx.agents.get(session.id)),
      })
    }
  }

  /**
   * 功能说明：处理 jobsFor 相关流程；使用场景由所在模块及调用位置决定。
   * @param agent （Agent | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns SessionJob[]；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 jobsFor(agent)，并按返回类型处理结果。
   */
  private jobsFor(agent: Agent | undefined): SessionJob[] {
    /**
     * 常量说明：jobs 用于处理 jobs 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const jobs = this.ctx.get('jobs')
    return jobs === undefined ? [] : jobs.list(agent).map(jobView)
  }

  /**
   * 功能说明：处理 broadcast 相关流程；使用场景由所在模块及调用位置决定。
   * @param frame （SessionControlFrame）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 broadcast(frame)，并按返回类型处理结果。
   */
  private broadcast(frame: SessionControlFrame): void {
    for (const /*
     * 变量说明：stream 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */ stream of this.streams) stream.push(frame)
  }
}

/**
 * 类说明：ControlQueue 用于集中封装 处理 ControlQueue 相关状态与行为。
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。
 * 使用场景：由 api/session-controller 在对应插件或业务生命周期内创建和调用。
 */
class ControlQueue {
  /**
   * 常量说明：buffer 用于处理 buffer 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly buffer: SessionControlFrame[] = []
  /**
   * 变量说明：wake 用于处理 wake 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private wake: (() => void) | undefined
  /**
   * 变量说明：done 用于处理 done 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private done = false

  /**
   * 功能说明：处理 push 相关流程；使用场景由所在模块及调用位置决定。
   * @param frame （SessionControlFrame）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 push(frame)，并按返回类型处理结果。
   */
  push(frame: SessionControlFrame): void {
    if (this.done) return
    this.buffer.push(frame)
    /**
     * 常量说明：wake 用于处理 wake 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const wake = this.wake
    this.wake = undefined
    wake?.()
  }

  /**
   * 功能说明：处理 end 相关流程；使用场景由所在模块及调用位置决定。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 end()，并按返回类型处理结果。
   */
  end(): void {
    if (this.done) return
    this.done = true
    /**
     * 常量说明：wake 用于处理 wake 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const wake = this.wake
    this.wake = undefined
    wake?.()
  }

  /**
   * 功能说明：处理 iterate 相关流程；使用场景由所在模块及调用位置决定。
   * @param signal （AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
   * @returns AsyncIterable<SessionControlFrame>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 iterate(signal)，并按返回类型处理结果。
   */
  async *iterate(signal: AbortSignal): AsyncIterable<SessionControlFrame> {
    /**
     * 常量说明：onAbort 用于响应 Abort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：响应 Abort 相关流程；使用场景由所在模块及调用位置决定。
     * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 onAbort()，并按返回类型处理结果。
     */
    const onAbort = (): void => { this.end() }
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      while (!this.done && !signal.aborted) {
        /**
         * 常量说明：frame 用于处理 frame 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const frame = this.buffer.shift()
        if (frame !== undefined) {
          yield frame
          continue
        }
        await new Promise<void>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
 */ (resolve) => { this.wake = resolve })
      }
      while (this.buffer.length > 0 && !signal.aborted) yield this.buffer.shift() as SessionControlFrame
    } finally {
      signal.removeEventListener('abort', onAbort)
      this.end()
    }
  }
}

/**
 * 功能说明：处理 queueItems 相关流程；使用场景由所在模块及调用位置决定。
 * @param agent （Agent）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param splice （SessionEventMap['agent/inbox/spliced']）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @returns SessionQueuedItem[]；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 queueItems(agent, splice)，并按返回类型处理结果。
 */
function queueItems(
  agent: Agent,
  splice?: SessionEventMap['agent/inbox/spliced'],
): SessionQueuedItem[] {
  /**
   * 常量说明：project 用于处理 project 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 project 相关流程；使用场景由所在模块及调用位置决定。
   * @param target （'next-turn' | 'next-step'）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns readonly UserMessage[]；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 project(target)，并按返回类型处理结果。
   */
  const project = (target: 'next-turn' | 'next-step'): readonly UserMessage[] => {
    /**
     * 常量说明：messages 用于处理 messages 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const messages = target === 'next-turn' ? agent.inbox.nextTurn : agent.inbox.nextStep
    return splice?.target === target
      ? messages.toSpliced(splice.start, splice.removedCount ?? 0, ...splice.inserted)
      : messages
  }
  return [
    ...project('next-turn').map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：message（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(message)，并按返回类型处理结果。
 */ message => ({
        id: message.id,
        placement: 'queued' as const,
        ...promptRpcId(message),
        message: { id: message.id, content: message.content as unknown as JsonValue[] },
      })),
    ...project('next-step').map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：message（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(message)，并按返回类型处理结果。
 */ message => ({
        id: message.id,
        placement: message.source.kind === 'user' ? 'steering' as const : 'context' as const,
        ...promptRpcId(message),
        message: { id: message.id, content: message.content as unknown as JsonValue[] },
      })),
  ]
}

/** Prompt-RPC identity carried by a browser-submitted message's user source.
 * @remarks 中文说明：功能说明：处理 promptRpcId 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：message（UserMessage）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：Pick<SessionQueuedItem, 'rpcId'>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 promptRpcId(message)，并按返回类型处理结果。 */
function promptRpcId(message: UserMessage): Pick<SessionQueuedItem, 'rpcId'> {
  /**
   * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const source = message.source
  return source.kind === 'user' && 'rpcId' in source ? { rpcId: source.rpcId } : {}
}

/**
 * 功能说明：处理 jobView 相关流程；使用场景由所在模块及调用位置决定。
 * @param job （JobSnapshot）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns SessionJob；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 jobView(job)，并按返回类型处理结果。
 */
function jobView(job: JobSnapshot): SessionJob {
  return {
    id: job.id,
    kind: job.kind,
    label: job.label,
    status: job.status,
    ...(job.detail === undefined ? {} : { detail: job.detail }),
    startedAt: job.startedAt,
    ...(job.finishedAt === undefined ? {} : { finishedAt: job.finishedAt }),
  }
}
