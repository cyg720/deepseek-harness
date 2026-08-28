/** Fire-and-forget webhook rule registry and Workspace-backed Session runtime.
 * @remarks 文件说明：文件职责：实现 webhook/webhook 中 index 模块的职责，并向相邻模块提供可复用能力。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的 webhook/webhook 能力，
 * 使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import { Context, Service } from '@deepseek-ai/cordis'
import { deepFreeze, errorChain } from '@deepseek-ai/dsh-llm'
import { snapshotJsonValue } from '@deepseek-ai/dsh-session'
import type { WebhookRuleId } from './brand.ts'
import { createWebhookSession } from './session.ts'
import type { VerifiedWebhookDelivery, WebhookRule, WebhookSessionRequest } from './types.ts'

export * from './brand.ts'
export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    webhookRuntime: WebhookRuntime
  }
}

/** Internal type erasure after public generic registration validates the provider kind. */
interface AnyWebhookRule {
  readonly id: WebhookRuleId
  readonly kind: string
  /**
   * 功能说明：执行 run 相关流程；使用场景由所在模块及调用位置决定。
   * @param delivery （Readonly<VerifiedWebhookDelivery>）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @param signal （AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
   * @returns WebhookSessionRequest | null | Promise<WebhookSessionRequest |
   * null>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 run(delivery, signal)，并按返回类型处理结果。
   */
  run(
    delivery: Readonly<VerifiedWebhookDelivery>,
    signal: AbortSignal,
  ): WebhookSessionRequest | null | Promise<WebhookSessionRequest | null>
}

/** One effect-owned rule registration and the invocations that currently use it. */
interface RuleRegistration {
  readonly rule: AnyWebhookRule
  readonly controller: AbortController
  readonly active: Set<Promise<void>>
  closing: boolean
  disposal?: Promise<void>
}

/** Validate and detach one delivery before sharing it across arbitrary rules.
 * @remarks 中文说明：功能说明：处理 snapshotDelivery 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：delivery（VerifiedWebhookDelivery）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：VerifiedWebhookDelivery；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 snapshotDelivery(delivery)，并按返回类型处理结果。 */
function snapshotDelivery(delivery: VerifiedWebhookDelivery): VerifiedWebhookDelivery {
  if (typeof delivery.kind !== 'string' || delivery.kind.trim() === '') {
    throw new TypeError('webhook delivery kind must be a non-empty string')
  }
  if (typeof delivery.source !== 'string' || delivery.source.trim() === '') {
    throw new TypeError('webhook delivery source must be a non-empty string')
  }
  if (typeof delivery.deliveryId !== 'string' || delivery.deliveryId.trim() === '') {
    throw new TypeError('webhook delivery id must be a non-empty string')
  }
  if (!Number.isSafeInteger(delivery.receivedAt) || delivery.receivedAt < 0) {
    throw new TypeError('webhook delivery receivedAt must be a non-negative safe integer')
  }
  /**
   * 常量说明：snapshot 用于处理 snapshot 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const snapshot = snapshotJsonValue(delivery)
  if (snapshot === undefined) throw new TypeError('webhook delivery must be lossless JSON')
  return deepFreeze(snapshot)
}

/** Fire-and-forget rule runtime. Session creation is the only built-in action.
 * @remarks 中文说明：类说明：WebhookRuntime 用于集中封装 处理 WebhookRuntime 相关状态与行为。；
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由 webhook/webhook
 * 在对应插件或业务生命周期内创建和调用。 */
export class WebhookRuntime extends Service {
  /**
   * 变量说明：inject 用于处理 inject 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  static inject = [
    'agents',
    'agentDefaultModel',
    'agentPresets',
    'permissionPresets',
    'sessionTitle',
    'workspaceRegistry',
  ]

  /**
   * 常量说明：rules 用于处理 rules 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly rules = new Map<WebhookRuleId, RuleRegistration>()
  /**
   * 常量说明：selfCtx 用于处理 selfCtx 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly selfCtx: Context
  /**
   * 变量说明：closing 用于处理 closing 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private closing = false

  /**
   * 功能说明：处理 WebhookRuntime 相关流程；使用场景由所在模块及调用位置决定。
   * @param ctx （Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new WebhookRuntime(ctx) 创建实例，并在所属生命周期内使用。
   */
  constructor(ctx: Context) {
    super(ctx, 'webhookRuntime')
    this.selfCtx = ctx
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    ctx.effect(() => async () => {
      this.closing = true
      /* v8 ignore next -- caller-owned registration effects normally dispose first; this covers provider-first unload. */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：rule（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(rule)，并按返回类型处理结果。
       */
      await Promise.all(
        [...this.rules.values()].map(rule => this.disposeRegistration(rule)),
      )
    }, 'webhookRuntime.lifecycle()')
  }

  /**
   * Register one trusted programmatic rule.
   * @param rule - unique id, provider kind, and arbitrary callback.
   * @returns awaitable effect disposer that aborts and drains this rule's active callbacks.
   * @remarks 中文说明：功能说明：注册 register 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：rule（WebhookRule<K>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：() =>
   * Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * register(rule)，并按返回类型处理结果。
   */
  register<K extends string>(rule: WebhookRule<K>): () => Promise<void> {
    if (this.closing) throw new Error('webhook runtime is closing')
    if (typeof rule.id !== 'string' || rule.id.trim() === '') {
      throw new TypeError('webhook rule id must be a non-empty string')
    }
    if (typeof rule.kind !== 'string' || rule.kind.trim() === '') {
      throw new TypeError(`webhook rule "${String(rule.id)}" kind must be a non-empty string`)
    }
    if (typeof rule.run !== 'function') {
      throw new TypeError(`webhook rule "${String(rule.id)}" requires run()`)
    }

    // The public generic preserves adapter-specific authoring types. The runtime
    // stores one erased callback after validating the shared provider tag.
    /**
     * 常量说明：erased 用于处理 erased 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const erased = rule as unknown as AnyWebhookRule
    /**
     * 变量说明：registration 用于处理 registration 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let registration!: RuleRegistration
    /**
     * 常量说明：disposeEffect 用于处理 disposeEffect 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const disposeEffect = this.ctx.effect(() => {
      /* v8 ignore next -- no await separates the public liveness check from this initializer. */
      if (this.closing) throw new Error('webhook runtime is closing')
      if (this.rules.has(rule.id)) throw new Error(`webhook rule "${rule.id}" is already registered`)
      registration = {
        rule: erased,
        controller: new AbortController(),
        active: new Set(),
        closing: false,
      }
      this.rules.set(rule.id, registration)
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      return () => this.disposeRegistration(registration)
    }, `webhookRuntime.register(${rule.id})`)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    return async () => { await disposeEffect() }
  }

  /**
   * Start every currently matching rule and return before any callback settles.
   * @param delivery - authenticated provider data; snapshotted before dispatch.
   * @throws synchronously when the runtime is closing or the delivery is malformed.
   * @remarks 中文说明：功能说明：分发 dispatch 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：delivery（VerifiedWebhookDelivery<K>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * dispatch(delivery)，并按返回类型处理结果。
   */
  dispatch<K extends string>(delivery: VerifiedWebhookDelivery<K>): void {
    if (this.closing) throw new Error('webhook runtime is closing')
    /**
     * 常量说明：snapshot 用于处理 snapshot 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const snapshot = snapshotDelivery(delivery)
    /**
     * 变量说明：registration 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const registration of [...this.rules.values()]) {
      if (registration.closing || registration.rule.kind !== snapshot.kind) continue
      this.startInvocation(registration, snapshot)
    }
  }

  /** Start one contained invocation and attach it to registration teardown.
   * @remarks 中文说明：功能说明：启动 Invocation 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：registration（RuleRegistration）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：delivery（VerifiedWebhookDelivery）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * startInvocation(registration, delivery)，并按返回类型处理结果。 */
  private startInvocation(registration: RuleRegistration, delivery: VerifiedWebhookDelivery): void {
    /**
     * 常量说明：tracked 用于处理 tracked 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（unknown）：提供本次调用所需的数据；
     * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
     * 典型用法：在完成前置校验后调用 匿名回调(error)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const tracked = Promise.resolve().then(async () => {
      registration.controller.signal.throwIfAborted()
      /**
       * 常量说明：request 用于处理 request 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const request = await registration.rule.run(delivery, registration.controller.signal)
      registration.controller.signal.throwIfAborted()
      if (request !== null) {
        await createWebhookSession(
          this.selfCtx,
          delivery,
          registration.rule.id,
          request,
          registration.controller.signal,
        )
      }
    }).catch((error: unknown) => {
      /**
       * 常量说明：invocation 用于处理 invocation 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const invocation = `webhook: provider=${JSON.stringify(delivery.kind)} source=${JSON.stringify(delivery.source)} `
        + `delivery=${JSON.stringify(delivery.deliveryId)} rule=${JSON.stringify(registration.rule.id)}`
      if (registration.controller.signal.aborted) {
        this.selfCtx.logger.debug(`${invocation} stopped after disposal: ${errorChain(error)}`)
      } else {
        this.selfCtx.logger.warn(`${invocation} failed: ${errorChain(error)}`)
      }
    }).finally(() => {
      registration.active.delete(tracked)
    })
    registration.active.add(tracked)
  }

  /** Memoized registration teardown: hide, abort, then drain.
   * @remarks 中文说明：功能说明：处理 disposeRegistration 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：registration（RuleRegistration）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * disposeRegistration(registration)，并按返回类型处理结果。 */
  private disposeRegistration(registration: RuleRegistration): Promise<void> {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    registration.disposal ??= (async () => {
      registration.closing = true
      this.rules.delete(registration.rule.id)
      registration.controller.abort(new Error(`webhook rule "${registration.rule.id}" was disposed`))
      while (registration.active.size > 0) {
        await Promise.allSettled([...registration.active])
      }
    })()
    return registration.disposal
  }
}

export default WebhookRuntime
