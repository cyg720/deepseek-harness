/**
 * Incremental session-log contribution for official DeepSeek LLM API requests.
 * Accepted sequence watermarks live in the canonical log, so restart recovery
 * can conservatively resend uncertain tails without maintaining another store.
 * @module @deepseek-ai/dsh-session-log-deepseek
 * @remarks 文件说明：文件职责：实现 session/session-log-deepseek 中 index 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * session/session-log-deepseek 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态
 * → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-deepseek-llm-api-extensions'
import { SessionId, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { DeepSeekSessionLogExtension } from './types.ts'

export type * from './types.ts'

/** Cordis plugin name.
 * @remarks 中文说明：常量说明：name 用于处理 name 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const name = 'session-log-deepseek'
/** Services required to resolve sessions and contribute the provider request field.
 * @remarks 中文说明：常量说明：inject 用于处理 inject 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const inject = ['deepseekLlmApiExtensions', 'sessions']

/** Session-log request contribution configuration. */
export interface Config {
  /** Contribute `dsh_session_log` to official DeepSeek requests. Defaults to `false`. */
  enabled?: boolean
}

/** Validated Session-log request contribution configuration.
 * @remarks 中文说明：常量说明：Config 用于处理 Config 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(false),
})

interface AcceptanceFold {
  readonly scannedEvents: number
  readonly throughSeq: number
}

/**
 * 常量说明：acceptanceFolds 用于处理 acceptanceFolds 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const acceptanceFolds = new WeakMap<Session, AcceptanceFold>()

/**
 * Highest confirmed sequence for this exact session identity.
 * @param session - canonical log whose matching acceptance events are folded.
 * @returns greatest accepted sequence, or `-1` before any accepted request.
 * @remarks 中文说明：功能说明：处理 acceptedThrough 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：session（Session）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：number；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 acceptedThrough(session)，
 * 并按返回类型处理结果。
 */
export function acceptedThrough(session: Session): number {
  /**
   * 常量说明：previous 用于处理 previous 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const previous = acceptanceFolds.get(session)
  /**
   * 变量说明：throughSeq 用于处理 throughSeq 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let throughSeq = previous?.throughSeq ?? -1
  /**
   * 常量说明：events 用于处理 events 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const events = session.events
  /**
   * 常量说明：start 用于启动 start 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const start = previous?.scannedEvents ?? 0
  /**
   * 变量说明：index 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (let index = start; index < events.length; index++) {
    /**
     * 常量说明：event 用于处理 event 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const event = events[index] as SessionEvent
    if (event.type !== 'session-log-deepseek/delivery-accepted') continue
    if (typeof event.data.sessionId !== 'string' || event.data.sessionId.length === 0
      || !Number.isSafeInteger(event.data.throughSeq) || event.data.throughSeq < 0
      || event.data.throughSeq >= event.seq) {
      throw new Error(`session-log-deepseek: malformed acceptance watermark at seq ${event.seq}`)
    }
    if (event.data.sessionId !== session.id) continue
    throughSeq = Math.max(throughSeq, event.data.throughSeq)
  }
  acceptanceFolds.set(session, { scannedEvents: events.length, throughSeq })
  return throughSeq
}

/**
 * Register the incremental `dsh_session_log` request contribution when enabled.
 * @param ctx - plugin context carrying Sessions and the DeepSeek request-extension registry.
 * @param config - validated opt-in configuration.
 * @remarks 中文说明：功能说明：注册并应用 apply 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；
 * 参数说明：config（Config）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 apply(ctx, config)，并按返回类型处理结果。
 */
export function apply(ctx: Context, config: Config): void {
  if (config.enabled !== true) return
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：request（由 TypeScript
   * 根据调用位置推断的类型）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(request)，并按返回类型处理结果。
   */
  ctx.deepseekLlmApiExtensions.register('dsh_session_log', {
    prepare: (request) => {
      // TODO: Define an explicit wire result for direct or stale-session calls if they become a supported product path.
      if (request.sessionId === undefined) return undefined
      /**
       * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const session = ctx.sessions.get(SessionId(request.sessionId))
      if (session === undefined) return undefined

      /**
       * 常量说明：afterSeq 用于处理 afterSeq 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const afterSeq = acceptedThrough(session)
      /**
       * 常量说明：snapshot 用于处理 snapshot 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const snapshot = session.events
      /**
       * 常量说明：throughSeq 用于处理 throughSeq 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const throughSeq = snapshot.length - 1
      if (throughSeq < 0) return undefined
      /**
       * 常量说明：suffix 用于处理 suffix 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const suffix = snapshot.slice(afterSeq + 1)
      /**
       * 常量说明：value 用于处理 value 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const value: DeepSeekSessionLogExtension = {
        version: 1,
        session: session.header,
        afterSeq,
        throughSeq,
        events: suffix,
      }
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      return {
        value,
        accept: () => {
          session.append('session-log-deepseek/delivery-accepted', { sessionId: session.id, throughSeq })
          // TODO: Add an immediate lightweight checkpoint if duplicate replay after a 2xx crash window becomes unacceptable.
        },
      }
    },
  })
}
