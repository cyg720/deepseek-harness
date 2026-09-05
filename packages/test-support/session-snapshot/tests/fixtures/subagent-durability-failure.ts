/**
 * 文件职责：验证 test-support/session-snapshot 中 subagent durability failure
 * 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'

/**
 * 常量说明：name 用于处理 name 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
export const name = 'subagent-durability-failure'
/**
 * 常量说明：inject 用于处理 inject 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
export const inject = ['agents', 'sessionPersistence', 'subagents']

/**
 * The authored parent transcript names the background child by a stable
 * placeholder id, but the live continuable child is minted with a fresh random
 * session id at run time. This snapshot-only overlay bridges that gap and forces
 * deterministic ordering plus authored child durability failures:
 *
 *  - `PLACEHOLDER_CHILD_ID` in a scripted `send_message` is remapped to the real
 *    child so both follow-ups queue onto the same live inbox in FIFO order.
 *  - The unknown-id `send_message` (`UNKNOWN_CHILD_ID`) resolves through a
 *    persistence stat fenced behind both accepted follow-ups, so the transcript
 *    records the same order on every runner.
 *  - The child's final continuation turn fails its durability checkpoint with a
 *    fixed message, so the scenario proves child-first disposal survives a failed
 *    last flush.
 *  - Under `DSH_SUBAGENT_PUBLISHED_FAILURE`, a one-shot child's first
 *    follow-up fails after publication, so its model prompt never runs; its
 *    published handle then also fails disposal, so the parent observes both
 *    independent failures.
 * @remarks 中文说明：常量说明：PLACEHOLDER_CHILD_ID 用于处理 PLACEHOLDER_CHILD_ID 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const PLACEHOLDER_CHILD_ID = '33333333-3333-4333-8333-333333333333'
/**
 * 常量说明：UNKNOWN_CHILD_ID 用于处理 UNKNOWN_CHILD_ID 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const UNKNOWN_CHILD_ID = '22222222-2222-4222-8222-222222222222'
/** The child continuation turn whose durability checkpoint is forced to fail.
 * @remarks 中文说明：常量说明：FAILED_CHECKPOINT_TURN 用于处理 FAILED_CHECKPOINT_TURN
 * 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
const FAILED_CHECKPOINT_TURN = 3

/** Fail the child checkpoint and stabilize the authored follow-up failure ordering.
 * @remarks 中文说明：功能说明：注册并应用 apply 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；返回值：void；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 apply(ctx)，并按返回类型处理结果。 */
export function apply(ctx: Context): void {
  /**
   * 常量说明：followupsAccepted 用于处理 followupsAccepted 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const followupsAccepted = Promise.withResolvers<undefined>()
  /**
   * 常量说明：parentTurnClosed 用于处理 parentTurnClosed 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const parentTurnClosed = Promise.withResolvers<undefined>()
  /**
   * 变量说明：parentClosed 用于处理 parentClosed 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let parentClosed = false
  /**
   * 常量说明：publishedFailure 用于处理 publishedFailure 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const publishedFailure = process.env.DSH_SUBAGENT_PUBLISHED_FAILURE === '1'
  /**
   * 常量说明：persistence 用于处理 persistence 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const persistence = ctx.sessionPersistence
  const stat = persistence.stat.bind(persistence)
  const agents = ctx.agents
  /**
   * 常量说明：create 用于创建 create 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const create = agents.create.bind(agents)

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：options（由 TypeScript
   * 根据调用位置推断的类型）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(options)，并按返回类型处理结果。
   */
  agents.create = async (options) => {
    /**
     * 常量说明：handle 用于处理 handle 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const handle = await create(options)
    if (!publishedFailure || options.meta?.parentSession === undefined) return handle
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    handle.agent.followup = () => {
      throw new Error('snapshot published run failed')
    }
    return {
      ...handle,
      /**
       * 功能说明：处理 dispose 相关流程；使用场景由所在模块及调用位置决定。
       * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 dispose()，并按返回类型处理结果。
       */
      async dispose() {
        await handle.dispose()
        throw new Error('snapshot published handle disposal failed')
      },
    }
  }

  // The unavailable-child lookup is real asynchronous I/O. Fence it behind both
  // authored follow-ups so runner speed cannot reorder the exact log.
  persistence.stat = async (id, options) => {
    if (id === UNKNOWN_CHILD_ID) await followupsAccepted.promise
    return stat(id, options)
  }
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  ctx.effect(() => () => {
    agents.create = create
    persistence.stat = stat
    followupsAccepted.resolve(undefined)
    parentTurnClosed.resolve(undefined)
  }, 'subagent snapshot ordering')

  // The manager's settlement notice races whatever the parent is doing when the
  // child's Activation ends, and this transcript pins it as the parent's own
  // later turn. Hold the child's steps until the parent's spawn turn closes, so
  // the notice can only arrive at an idle parent. The parent's turn never awaits
  // child model work — its own fences need inbox acceptance only — so the child
  // cannot deadlock it.
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：session（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：event（由 TypeScript
   * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(session, event)，
   * 并按返回类型处理结果。
   */
  ctx.on('session/event', (session, event) => {
    if (session.header.parentSession !== undefined || event.type !== 'turn/end') return
    if (event.data.turn !== 1) return
    parentClosed = true
    parentTurnClosed.resolve(undefined)
  })

  // Remap the placeholder child id in a follow-up to the live child. The child
  // id the model "knows" is authored into the transcript, while the running
  // child is minted with a random id, so without this the follow-ups would
  // never reach the live inbox.
  /**
   * 变量说明：realChildId 用于处理 realChildId 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let realChildId: string | undefined
  /**
   * 常量说明：subagents 用于处理 subagents 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const subagents = ctx.subagents as unknown as {
    sendMessage: (authority: unknown, childId: SessionId, content: unknown, options: unknown) => Promise<unknown>
  }
  const deliver = subagents.sendMessage.bind(subagents)
  subagents.sendMessage = (authority, childId, content, options) => {
    const mapped = childId === PLACEHOLDER_CHILD_ID && realChildId !== undefined
      ? SessionId(realChildId)
      : childId
    return deliver(authority, mapped, content, options)
  }

  // Both authored follow-ups reach the child inbox before the unknown-id lookup
  // runs, so the queued FIFO order is what the transcript records. The first
  // child enqueue is the initial delegation, which also pins the real child id.
  /**
   * 变量说明：accepted 用于处理 accepted 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let accepted = 0
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：{ agent }（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调({ agent })，并按返回类型处理结果。
   */
  ctx.on('agent/inbox/inserted', ({ agent }) => {
    if (agent.session.header.parentSession === undefined) return
    if (realChildId === undefined) realChildId = agent.session.header.id
    accepted += 1
    if (accepted >= 3) followupsAccepted.resolve(undefined)
  })
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：{ agent }（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：next（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调({ agent }, next)，
   * 并按返回类型处理结果。
   */
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    if (agent.session.header.parentSession === undefined) return next()
    await followupsAccepted.promise
    // The published-failure variant's child never reaches a step (its follow-up
    // throws), and its parent turn awaits that child, so only the continuable
    // scenario takes the settlement fence.
    if (!publishedFailure && !parentClosed) await parentTurnClosed.promise
    return next()
  })

  // The child's ordinary per-turn flushes succeed; only the final continuation
  // turn's durability checkpoint fails, turning that turn/end into a durable
  // error the parent never sees.
  /**
   * 常量说明：childTurn 用于处理 childTurn 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const childTurn = new WeakMap<object, number>()
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：session（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：event（由 TypeScript
   * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(session, event)，
   * 并按返回类型处理结果。
   */
  ctx.on('session/event', (session, event) => {
    if (session.header.parentSession === undefined || event.type !== 'turn/start') return
    childTurn.set(session, event.data.turn)
  })
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：session（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(session)，并按返回类型处理结果。
   */
  ctx.on('session/flush', (session) => {
    if (session.header.parentSession === undefined) return
    if (childTurn.get(session) === FAILED_CHECKPOINT_TURN) throw new Error('snapshot disk full')
  })
}
