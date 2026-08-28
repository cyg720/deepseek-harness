/**
 * 文件职责：验证 webhook/webhook 中 runtime spec 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { Context } from '@deepseek-ai/cordis'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WebhookRuntime, {
  WebhookDeliveryId,
  WebhookRuleId,
  WebhookSourceId,
  type VerifiedWebhookDelivery,
} from '../src/index.ts'

/**
 * 常量说明：contexts 用于处理 contexts 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const contexts: Context[] = []

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
afterEach(async () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：ctx（由 TypeScript
   * 根据调用位置推断的类型）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
   * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(ctx)，并按返回类型处理结果。
   */
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

/** Construct the runtime directly so callback-only tests need no Agent stack.
 * @remarks 中文说明：功能说明：处理 harness 相关流程；使用场景由所在模块及调用位置决定。；返回值：{ ctx: Context;
 * runtime: WebhookRuntime }；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * harness()，并按返回类型处理结果。 */
function harness(): { ctx: Context; runtime: WebhookRuntime } {
  /**
   * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const ctx = new Context()
  contexts.push(ctx)
  return { ctx, runtime: new WebhookRuntime(ctx) }
}

/** One valid generic delivery.
 * @remarks 中文说明：功能说明：处理 delivery 相关流程；使用场景由所在模块及调用位置决定。；参数说明：id（由
 * TypeScript 根据调用位置推断的类型）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。；
 * 返回值：VerifiedWebhookDelivery<'fixture'>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 delivery(id)，并按返回类型处理结果。 */
function delivery(id = 'delivery-1'): VerifiedWebhookDelivery<'fixture'> {
  return {
    kind: 'fixture',
    source: WebhookSourceId('fixture-source'),
    deliveryId: WebhookDeliveryId(id),
    event: { value: 1 },
    receivedAt: 1,
  }
}

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('WebhookRuntime', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('dispatches a detached immutable snapshot and returns before the rule settles', async () => {
    /**
     * 常量说明：runtime 用于处理 runtime 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { runtime } = harness()
    /**
     * 常量说明：entered 用于处理 entered 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const entered = Promise.withResolvers<Readonly<VerifiedWebhookDelivery<'fixture'>>>()
    /**
     * 常量说明：release 用于处理 release 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const release = Promise.withResolvers<boolean>()
    runtime.register({
      id: WebhookRuleId('fixture-rule'),
      kind: 'fixture',
      /**
       * 功能说明：执行 run 相关流程；使用场景由所在模块及调用位置决定。
       * @param input （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 run(input)，并按返回类型处理结果。
       */
      async run(input) {
        entered.resolve(input)
        await release.promise
        return null
      },
    })
    /**
     * 常量说明：original 用于处理 original 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const original = delivery()
    runtime.dispatch(original)
    ;(original.event as { value: number }).value = 2
    /**
     * 常量说明：seen 用于处理 seen 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const seen = await entered.promise
    expect(seen).not.toBe(original)
    expect(seen.event).toEqual({ value: 1 })
    expect(Object.isFrozen(seen)).toBe(true)
    expect(Object.isFrozen(seen.event)).toBe(true)
    release.resolve(true)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('starts matching siblings independently and contains one failure', async () => {
    /**
     * 常量说明：runtime 用于处理 runtime 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { runtime } = harness()
    /**
     * 常量说明：started 用于处理 started 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const started: string[] = []
    /**
     * 常量说明：both 用于处理 both 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const both = Promise.withResolvers<boolean>()
    /**
     * 常量说明：maybeDone 用于处理 maybeDone 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：处理 maybeDone 相关流程；使用场景由所在模块及调用位置决定。
     * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 maybeDone()，并按返回类型处理结果。
     */
    const maybeDone = (): void => { if (started.length === 2) both.resolve(true) }
    runtime.register({
      id: WebhookRuleId('throws'),
      kind: 'fixture',
      /**
       * 功能说明：执行 run 相关流程；使用场景由所在模块及调用位置决定。
       * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 run()，并按返回类型处理结果。
       */
      run() {
        started.push('throws')
        maybeDone()
        throw new Error('fixture failure')
      },
    })
    runtime.register({
      id: WebhookRuleId('succeeds'),
      kind: 'fixture',
      /**
       * 功能说明：执行 run 相关流程；使用场景由所在模块及调用位置决定。
       * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 run()，并按返回类型处理结果。
       */
      run() {
        started.push('succeeds')
        maybeDone()
        return null
      },
    })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    runtime.register({
      id: WebhookRuleId('other-kind'),
      kind: 'other',
      run: vi.fn(() => null),
    })
    runtime.dispatch(delivery())
    await both.promise
    expect(started).toEqual(['throws', 'succeeds'])
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('rejects malformed registrations and duplicate ids', async () => {
    /**
     * 常量说明：runtime 用于处理 runtime 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { runtime } = harness()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => runtime.register({ id: WebhookRuleId(''), kind: 'fixture', run: () => null }))
      .toThrow(/id must be a non-empty string/)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => runtime.register({ id: WebhookRuleId('bad-kind'), kind: '', run: () => null }))
      .toThrow(/kind must be a non-empty string/)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => runtime.register({ id: WebhookRuleId('bad-run'), kind: 'fixture', run: 1 as never }))
      .toThrow(/requires run/)
    /**
     * 常量说明：dispose 用于处理 dispose 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const dispose = runtime.register({ id: WebhookRuleId('same'), kind: 'fixture', run: () => null })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => runtime.register({ id: WebhookRuleId('same'), kind: 'fixture', run: () => null }))
      .toThrow(/already registered/)
    await dispose()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => runtime.register({ id: WebhookRuleId('same'), kind: 'fixture', run: () => null }))
      .not.toThrow()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('hides, aborts, and drains a registration before disposal resolves', async () => {
    /**
     * 常量说明：ctx、runtime 用于处理 ctx、runtime 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const { ctx, runtime } = harness()
    /**
     * 常量说明：warnings 用于处理 warnings 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const warnings = vi.spyOn(ctx.logger, 'warn')
    /**
     * 常量说明：entered 用于处理 entered 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const entered = Promise.withResolvers<AbortSignal>()
    /**
     * 常量说明：finished 用于处理 finished 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const finished = Promise.withResolvers<boolean>()
    /**
     * 变量说明：calls 用于处理 calls 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let calls = 0
    /**
     * 常量说明：dispose 用于处理 dispose 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const dispose = runtime.register({
      id: WebhookRuleId('draining'),
      kind: 'fixture',
      /**
       * 功能说明：执行 run 相关流程；使用场景由所在模块及调用位置决定。
       * @param _input （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @param signal （由 TypeScript 根据调用位置推断的类型）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
       * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 run(_input, signal)，并按返回类型处理结果。
       */
      async run(_input, signal) {
        calls++
        entered.resolve(signal)
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
         * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
         */
        await new Promise<void>((resolve) => {
          /**
           * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
           * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
           */
          signal.addEventListener('abort', () => { resolve() }, { once: true })
        })
        finished.resolve(true)
        return null
      },
    })
    runtime.dispatch(delivery())
    /**
     * 常量说明：signal 用于处理 signal 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const signal = await entered.promise
    /**
     * 常量说明：draining 用于处理 draining 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const draining = dispose()
    expect(signal.aborted).toBe(true)
    runtime.dispatch(delivery('after-dispose'))
    await draining
    await finished.promise
    expect(calls).toBe(1)
    await expect(dispose()).resolves.toBeUndefined()
    expect(warnings).not.toHaveBeenCalled()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('aborts active rules and refuses later work when the runtime disposes', async () => {
    /**
     * 常量说明：ctx、runtime 用于处理 ctx、runtime 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const { ctx, runtime } = harness()
    /**
     * 常量说明：entered 用于处理 entered 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const entered = Promise.withResolvers<AbortSignal>()
    runtime.register({
      id: WebhookRuleId('runtime-disposal'),
      kind: 'fixture',
      /**
       * 功能说明：执行 run 相关流程；使用场景由所在模块及调用位置决定。
       * @param _input （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @param signal （由 TypeScript 根据调用位置推断的类型）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
       * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 run(_input, signal)，并按返回类型处理结果。
       */
      async run(_input, signal) {
        entered.resolve(signal)
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
         * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
         */
        await new Promise<void>((resolve) => {
          /**
           * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
           * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
           */
          signal.addEventListener('abort', () => { resolve() }, { once: true })
        })
        return null
      },
    })
    runtime.dispatch(delivery())
    /**
     * 常量说明：signal 用于处理 signal 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const signal = await entered.promise
    await ctx.fiber.dispose()
    expect(signal.aborted).toBe(true)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => { runtime.dispatch(delivery()) }).toThrow(/closing/)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => runtime.register({ id: WebhookRuleId('late'), kind: 'fixture', run: () => null }))
      .toThrow(/closing/)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：input（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：message（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(input, message)，
   * 并按返回类型处理结果。
   */
  it.each([
    [{ ...delivery(), kind: '' }, /kind/],
    [{ ...delivery(), source: WebhookSourceId('') }, /source/],
    [{ ...delivery(), deliveryId: WebhookDeliveryId('') }, /delivery id/],
    [{ ...delivery(), receivedAt: -1 }, /receivedAt/],
    [{ ...delivery(), event: { invalid: undefined } }, /lossless JSON/],
  ] as const)('rejects malformed deliveries synchronously', (input, message) => {
    /**
     * 常量说明：runtime 用于处理 runtime 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { runtime } = harness()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => { runtime.dispatch(input as never) }).toThrow(message)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('intentionally invokes a rule again for a repeated delivery', async () => {
    /**
     * 常量说明：runtime 用于处理 runtime 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { runtime } = harness()
    /**
     * 常量说明：calledTwice 用于处理 calledTwice 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const calledTwice = Promise.withResolvers<boolean>()
    /**
     * 变量说明：calls 用于处理 calls 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let calls = 0
    runtime.register({
      id: WebhookRuleId('repeat'),
      kind: 'fixture',
      /**
       * 功能说明：执行 run 相关流程；使用场景由所在模块及调用位置决定。
       * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 run()，并按返回类型处理结果。
       */
      run() {
        calls++
        if (calls === 2) calledTwice.resolve(true)
        return null
      },
    })
    runtime.dispatch(delivery())
    runtime.dispatch(delivery())
    await calledTwice.promise
    expect(calls).toBe(2)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('keeps execution-state, retry, dedupe, and completion machinery out of the runtime', () => {
    /**
     * 常量说明：production 用于处理 production 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（由 TypeScript
     * 根据调用位置推断的类型）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
     * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(path)，
     * 并按返回类型处理结果。
     */
    const production = [
      '../src/brand.ts',
      '../src/types.ts',
      '../src/session.ts',
      '../src/index.ts',
      '../src/invariant.ts',
    ].map(path => readFileSync(new URL(path, import.meta.url), 'utf8')).join('\n')
    /**
     * 常量说明：forbidden 用于处理 forbidden 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const forbidden: ReadonlyArray<readonly [string, RegExp]> = [
      ['execution records', /\bWebhook(?:Execution|Status)\b/],
      ['delivery storage domains', /@deepseek-ai\/dsh-storage|\bstorageDomain\b|\bDomainSpec\b/],
      ['retry timers', /\bset(?:Timeout|Interval)\s*\(/],
      ['delivery-id dedupe maps', /new Map<\s*WebhookDeliveryId/],
      ['Agent idle waits', /\.whenIdle\s*\(/],
      ['Agent status listeners', /\.on\(\s*['"]agent\/status/],
      ['turn completion listeners', /\.on\(\s*['"]turn\/end/],
      ['webhook completion events', /['"]webhook\/(?:completion|completed)['"]/],
      ['webhook management Remotes', /@Remote\b|\bRemote\s*\(/],
    ]
    /**
     * 变量说明：label、pattern 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const [label, pattern] of forbidden) {
      expect(production, label).not.toMatch(pattern)
    }
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('creates one Session per matching repeated delivery', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = new Context()
    contexts.push(ctx)
    /**
     * 常量说明：followedTwice 用于处理 followedTwice 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const followedTwice = Promise.withResolvers<boolean>()
    /**
     * 常量说明：messages 用于处理 messages 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const messages: unknown[] = []
    /**
     * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const session = {}
    /**
     * 常量说明：attachSession 用于处理 attachSession 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const attachSession = vi.fn(async () => {})
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    ctx.provide('agentDefaultModel', {
      currentSelection: () => ({ provider: 'p', model: 'm' }),
    } as never)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    ctx.provide('permissionPresets', {
      resolve: () => ({}),
      set: () => {},
    } as never)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：id（string）：标识本次操作关联的唯一对象；
     * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
     * 典型用法：在完成前置校验后调用 匿名回调(id)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_agentCtx（unknown）：提供本次调用所需的数据；
     * 必须满足声明的类型及调用时序要求。；参数：id（string）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。；返回值：由
     * TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用
     * 匿名回调(_agentCtx, id)，并按返回类型处理结果。
     */
    ctx.provide('agentPresets', {
      resolve: async (id: string) => ({ id }),
      standingKeyFor: async () => ({}),
      mount: async (_agentCtx: unknown, id: string) => ({ id }),
    } as never)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    ctx.provide('workspaceRegistry', {
      create: async () => ({
        path: '/workspace',
        attachSession,
        detachSession: async () => {},
      }),
    } as never)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    ctx.provide('sessionTitle', { rename: () => ({}) } as never)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：options（{ setup?: (agentCtx:
     * unknown) => Promise<void> }）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；返回值：由
     * TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用
     * 匿名回调(options)，并按返回类型处理结果。
     */
    ctx.provide('agents', {
      create: async (options: { setup?: (agentCtx: unknown) => Promise<void> }) => {
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
         */
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
         */
        await options.setup?.({ on: () => () => {} })
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：message（unknown）：提供本次调用所需的数据；
         * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
         * 典型用法：在完成前置校验后调用 匿名回调(message)，并按返回类型处理结果。
         */
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
         */
        return {
          agent: {
            session,
            followup: (message: unknown) => {
              messages.push(message)
              if (messages.length === 2) followedTwice.resolve(true)
            },
          },
          dispose: async () => {},
        }
      },
    } as never)
    /**
     * 常量说明：runtime 用于处理 runtime 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const runtime = new WebhookRuntime(ctx)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    runtime.register({
      id: WebhookRuleId('creates'),
      kind: 'fixture',
      run: () => ({
        workspacePath: '/workspace',
        title: 'Created',
        prompt: 'Work',
        agentPreset: 'standard',
        permissionPreset: 'read-only',
      }),
    })
    runtime.dispatch(delivery())
    runtime.dispatch(delivery())
    await followedTwice.promise
    expect(attachSession).toHaveBeenCalledTimes(2)
    expect(messages).toHaveLength(2)
    expect(messages[0]).toMatchObject({
      content: [{ type: 'text', text: 'Work' }],
      source: { kind: 'webhook', ruleId: 'creates' },
    })
  })
})
