/**
 * 文件职责：验证 api/remotes 中 remote events host spec 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import type {
  RemoteEventHostInfo,
  TypertRemoteEventInvocation,
  TypertRemoteEventSource,
} from '@deepseek-ai/dsh-api-gateway'
import { scopeTarget } from '@deepseek-ai/dsh-scope'
import { describe, expect, it } from 'vitest'
import { apply, inject } from '../src/index.ts'

interface GatewayProbe {
  source: TypertRemoteEventSource | undefined
  host: RemoteEventHostInfo | undefined
  removals: number
  /**
   * 功能说明：注册 Remote Events 相关流程；使用场景由所在模块及调用位置决定。
   * @param source （TypertRemoteEventSource）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param host （RemoteEventHostInfo）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns () => Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 registerRemoteEvents(source, host)，并按返回类型处理结果。
   */
  registerRemoteEvents(
    source: TypertRemoteEventSource,
    host: RemoteEventHostInfo,
  ): () => Promise<void>
}

/**
 * 功能说明：处理 setup 相关流程；使用场景由所在模块及调用位置决定。
 * @returns Promise<{ readonly ctx: Context readonly gateway: GatewayProbe
 * readon…；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 setup()，并按返回类型处理结果。
 */
async function setup(): Promise<{
  readonly ctx: Context
  readonly gateway: GatewayProbe
  readonly fiber: Fiber
}> {
  /**
   * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const ctx = new Context()
  /**
   * 常量说明：gateway 用于处理 gateway 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const gateway: GatewayProbe = {
    source: undefined,
    host: undefined,
    removals: 0,
    /**
     * 功能说明：注册 Remote Events 相关流程；使用场景由所在模块及调用位置决定。
     * @param source （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @param host （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 registerRemoteEvents(source, host)，并按返回类型处理结果。
     */
    registerRemoteEvents(source, host) {
      gateway.source = source
      gateway.host = host
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      return async () => {
        if (gateway.source !== source) return
        gateway.source = undefined
        gateway.host = undefined
        gateway.removals += 1
      }
    },
  }
  ctx.reflect.provide('typertGateway', gateway)
  /**
   * 常量说明：fiber 用于处理 fiber 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber
  return { ctx, gateway, fiber }
}

/**
 * 功能说明：处理 sourceOf 相关流程；使用场景由所在模块及调用位置决定。
 * @param gateway （GatewayProbe）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns TypertRemoteEventSource；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 sourceOf(gateway)，并按返回类型处理结果。
 */
function sourceOf(gateway: GatewayProbe): TypertRemoteEventSource {
  if (gateway.source === undefined) throw new Error('fixture Gateway has no Remote event source')
  return gateway.source
}

/**
 * 功能说明：发送 Raw 相关流程；使用场景由所在模块及调用位置决定。
 * @param ctx （Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。
 * @param event （string）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
 * @param args （readonly unknown[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 emitRaw(ctx, event, args)，并按返回类型处理结果。
 */
function emitRaw(ctx: Context, event: string, args: readonly unknown[]): void {
  /**
   * 常量说明：emit 用于发送 emit 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const emit = ctx.emit.bind(ctx) as unknown as (name: string, ...values: readonly unknown[]) => void
  emit(event, ...args)
}

/**
 * 功能说明：处理 waterfallRaw 相关流程；使用场景由所在模块及调用位置决定。
 * @param ctx （Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。
 * @param target （object）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param event （string）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
 * @param args （readonly unknown[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param next （() => Promise<unknown>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Promise<unknown>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 waterfallRaw(ctx, target, event, args, next)，
 * 并按返回类型处理结果。
 */
function waterfallRaw(
  ctx: Context,
  target: object,
  event: string,
  args: readonly unknown[],
  next: () => Promise<unknown>,
): Promise<unknown> {
  /**
   * 常量说明：waterfall 用于处理 waterfall 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const waterfall = ctx.waterfall.bind(ctx) as unknown as (
    receiver: object,
    name: string,
    ...values: readonly unknown[]
  ) => Promise<unknown>
  return waterfall(target, event, ...args, next)
}

/**
 * 功能说明：处理 invocationOf 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns TypertRemoteEventInvocation；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 invocationOf(value)，并按返回类型处理结果。
 */
function invocationOf(value: unknown): TypertRemoteEventInvocation {
  if (typeof value !== 'object' || value === null || !Object.hasOwn(value, 'context')) {
    throw new Error('fixture did not receive a scoped Remote Event invocation')
  }
  return value as TypertRemoteEventInvocation
}

describe('Remote event Host source', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
    it('registers the Host home used by Client connection generations', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：gateway、fiber 用于处理 gateway、fiber 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { gateway, fiber } = await setup()
        expect(gateway.host?.home).toBeTypeOf('string')
        expect(gateway.host?.home.length).toBeGreaterThan(0)
        await fiber.dispose()
        expect(gateway.host).toBeUndefined()
      })

    it('gives each Client stream an independent allowlisted event queue', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx、gateway、fiber 用于处理 ctx、gateway、fiber 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { ctx, gateway, fiber } = await setup()
        /**
     * 常量说明：firstAbort 用于处理 firstAbort 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const firstAbort = new AbortController()
        /**
     * 常量说明：secondAbort 用于处理 secondAbort 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const secondAbort = new AbortController()
        /**
     * 常量说明：first 用于处理 first 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const first = sourceOf(gateway)(firstAbort.signal)[Symbol.asyncIterator]()
        /**
     * 常量说明：second 用于处理 second 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const second = sourceOf(gateway)(secondAbort.signal)[Symbol.asyncIterator]()

        emitRaw(ctx, 'settings/document-updated', ['ui-theme', 1])
        await expect(first.next()).resolves.toEqual({
          done: false,
          value: { event: 'settings/document-updated', args: ['ui-theme', 1] },
        })
        await expect(second.next()).resolves.toEqual({
          done: false,
          value: { event: 'settings/document-updated', args: ['ui-theme', 1] },
        })

        /**
     * 常量说明：firstDone 用于处理 firstDone 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const firstDone = first.next()
        firstAbort.abort(new Error('first Client disconnected'))
        emitRaw(ctx, 'commands/change', [])
        await expect(firstDone).resolves.toEqual({ done: true, value: undefined })
        await expect(second.next()).resolves.toEqual({
          done: false,
          value: { event: 'commands/change', args: [] },
        })

        /**
     * 常量说明：secondDone 用于处理 secondDone 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const secondDone = second.next()
        secondAbort.abort(new Error('second Client disconnected'))
        await expect(secondDone).resolves.toEqual({ done: true, value: undefined })

        await fiber.dispose()
        expect(gateway.source).toBeUndefined()
        expect(gateway.removals).toBe(1)
        await ctx.fiber.dispose()
      })

    it('rejects a non-JSON argument without poisoning the stream', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx、gateway 用于处理 ctx、gateway 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { ctx, gateway } = await setup()
        /**
     * 常量说明：abort 用于处理 abort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const abort = new AbortController()
        /**
     * 常量说明：iterator 用于处理 iterator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const iterator = sourceOf(gateway)(abort.signal)[Symbol.asyncIterator]()
        /**
     * 常量说明：pending 用于处理 pending 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const pending = iterator.next()

        expect(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
            emitRaw(ctx, 'settings/document-updated', ['ui-theme', 1n])
          }).toThrow('argument 1 is not lossless JSON data')
        emitRaw(ctx, 'settings/document-updated', ['ui-theme', 2])
        await expect(pending).resolves.toEqual({
          done: false,
          value: { event: 'settings/document-updated', args: ['ui-theme', 2] },
        })

        /**
     * 常量说明：done 用于处理 done 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const done = iterator.next()
        abort.abort()
        await expect(done).resolves.toEqual({ done: true, value: undefined })

        /**
     * 常量说明：alreadyAborted 用于处理 alreadyAborted 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const alreadyAborted = new AbortController()
        alreadyAborted.abort()
        await expect(sourceOf(gateway)(alreadyAborted.signal)[Symbol.asyncIterator]().next())
          .resolves.toEqual({ done: true, value: undefined })
        await ctx.fiber.dispose()
      })

    it('bridges scoped waterfall result, next delegation, and rejection', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx、gateway 用于处理 ctx、gateway 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { ctx, gateway } = await setup()
        /**
     * 常量说明：abort 用于处理 abort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const abort = new AbortController()
        /**
     * 常量说明：iterator 用于处理 iterator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const iterator = sourceOf(gateway)(abort.signal)[Symbol.asyncIterator]()
        /**
     * 常量说明：agentCtx 用于处理 agentCtx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const agentCtx = ctx.extend()
        /**
     * 常量说明：agent 用于处理 agent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const agent = { ctx: agentCtx }
        /**
     * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const target = scopeTarget(ctx, agent)
        /**
     * 常量说明：request 用于处理 request 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const request = { questions: [], agent }

        /**
     * 常量说明：claimed 用于处理 claimed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const claimed = waterfallRaw(
          ctx,
          target,
          'user-questions/request',
          [request],
          /*
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */ () => Promise.resolve('host fallback'),
        )
        /**
     * 常量说明：claimedDispatch 用于处理 claimedDispatch 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const claimedDispatch = invocationOf((await iterator.next()).value)
        expect(claimedDispatch).toMatchObject({
          event: 'user-questions/request',
          request,
          context: { value: agentCtx, subject: agent },
        })
        claimedDispatch.resolve({ kind: 'result', value: 'client answer' })
        await expect(claimed).resolves.toBe('client answer')

        /**
     * 常量说明：delegated 用于处理 delegated 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const delegated = waterfallRaw(
          ctx,
          target,
          'user-questions/request',
          [request],
          /*
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */ () => Promise.resolve('host fallback'),
        )
        /**
     * 常量说明：delegatedDispatch 用于处理 delegatedDispatch 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const delegatedDispatch = invocationOf((await iterator.next()).value)
        delegatedDispatch.resolve({ kind: 'next' })
        await expect(delegated).resolves.toBe('host fallback')

        /**
     * 常量说明：rejection 用于处理 rejection 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const rejection = Object.assign(new Error('the user cancelled ask_user_question'), {
          code: 'ASK_CANCELLED',
        })
        /**
     * 常量说明：rejected 用于处理 rejected 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const rejected = waterfallRaw(
          ctx,
          target,
          'user-questions/request',
          [request],
          /*
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */ () => Promise.resolve('host fallback'),
        )
        /**
     * 常量说明：rejectedAssertion 用于处理 rejectedAssertion 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const rejectedAssertion = expect(rejected).rejects.toBe(rejection)
        /**
     * 常量说明：rejectedDispatch 用于处理 rejectedDispatch 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const rejectedDispatch = invocationOf((await iterator.next()).value)
        rejectedDispatch.reject(rejection)
        await rejectedAssertion

        /**
     * 常量说明：done 用于处理 done 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const done = iterator.next()
        abort.abort()
        await expect(done).resolves.toEqual({ done: true, value: undefined })
        await ctx.fiber.dispose()
      })

    it('rejects a queued scoped waterfall when its source is withdrawn', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx、gateway、fiber 用于处理 ctx、gateway、fiber 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { ctx, gateway, fiber } = await setup()
        /**
     * 常量说明：abort 用于处理 abort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const abort = new AbortController()
        /**
     * 常量说明：iterator 用于处理 iterator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const iterator = sourceOf(gateway)(abort.signal)[Symbol.asyncIterator]()
        /**
     * 常量说明：delivery 用于处理 delivery 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const delivery = iterator.next()
        /**
     * 常量说明：agent 用于处理 agent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const agent = { ctx: ctx.extend() }
        /**
     * 常量说明：reason 用于处理 reason 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const reason = new Error('forwarded event source removed')
        /**
     * 常量说明：pending 用于处理 pending 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const pending = waterfallRaw(
          ctx,
          scopeTarget(ctx, agent),
          'user-questions/request',
          [{ questions: [], agent }],
          /*
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */ () => Promise.resolve('host fallback'),
        )
        /**
     * 常量说明：rejected 用于处理 rejected 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const rejected = expect(pending).rejects.toBe(reason)

        abort.abort(reason)

        await rejected
        await expect(delivery).resolves.toEqual({ done: true, value: undefined })
        await fiber.dispose()
        await ctx.fiber.dispose()
      })
  })
