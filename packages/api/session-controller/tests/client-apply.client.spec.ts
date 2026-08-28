/**
 * 文件职责：验证 api/session-controller 中 client apply client spec 相关行为与失败场景。
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
  ConnectionGeneration,
  ConnectionHandle,
} from '@deepseek-ai/dsh-client-connection/client'
import {
  RemoteStreamCarrierError,
  RemoteStream,
  type RemoteStreamOptions,
} from '@deepseek-ai/dsh-api-gateway/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as SessionClient from '../src/client/index.ts'
import { ClientSessions } from '../src/client/sessions/service.ts'
import { FakeApiClient, fakeRemote } from './fake-api.client.ts'

/**
 * 常量说明：GENERATION 用于处理 GENERATION 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const GENERATION: ConnectionGeneration = { id: 1, host: { home: '/home/fixture' } }

/**
 * 常量说明：sid 用于处理 sid 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 sid 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns SessionId；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 sid(value)，并按返回类型处理结果。
 */
const sid = (value: string): SessionId => value as SessionId

type RemoteListener = (...args: never[]) => void

interface Bench {
  readonly ctx: Context
  readonly api: FakeApiClient
  readonly fiber: Fiber
  readonly sessions: ClientSessions
  /**
   * 功能说明：分发 dispatch 相关流程；使用场景由所在模块及调用位置决定。
   * @param event （string）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
   * @param args （unknown[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 dispatch(event, args)，并按返回类型处理结果。
   */
  dispatch(event: string, ...args: unknown[]): void
  /**
   * 功能说明：处理 publishGeneration 相关流程；使用场景由所在模块及调用位置决定。
   * @param generation （ConnectionGeneration | undefined）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 publishGeneration(generation)，并按返回类型处理结果。
   */
  publishGeneration(generation: ConnectionGeneration | undefined): void
}

/**
 * 常量说明：contexts 用于处理 contexts 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const contexts = new Set<Context>()

afterEach(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
    vi.restoreAllMocks()
    await Promise.all([...contexts].map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：ctx（由 TypeScript
 * 根据调用位置推断的类型）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
 * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(ctx)，并按返回类型处理结果。
 */ async (ctx) => { await ctx.fiber.dispose() }))
    contexts.clear()
  })

/**
 * 功能说明：处理 mount 相关流程；使用场景由所在模块及调用位置决定。
 * @param initialGeneration （ConnectionGeneration）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @returns Promise<Bench>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 mount(initialGeneration)，并按返回类型处理结果。
 */
async function mount(initialGeneration?: ConnectionGeneration): Promise<Bench> {
  /**
   * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const ctx = new Context()
  contexts.add(ctx)
  await ctx.plugin(TypertRegistry)
  /**
   * 常量说明：api 用于处理 api 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const api = new FakeApiClient()
  /**
   * 常量说明：remote 用于处理 remote 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const remote = fakeRemote(api)
  /**
   * 常量说明：listeners 用于处理 listeners 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const listeners = new Map<string, Set<RemoteListener>>()
  /**
   * 常量说明：generationListeners 用于处理 generationListeners 相关数据，作用于当前作用域；
   * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const generationListeners = new Set<() => void>()
  /**
   * 变量说明：generation 用于处理 generation 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let generation = initialGeneration
  /**
   * 常量说明：connection 用于处理 connection 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const connection: ConnectionHandle = {
    isLoopback: true,
    generation: {
      getSnapshot: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => generation,
      subscribe: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：listener（由 TypeScript
 * 根据调用位置推断的类型）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
 * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(listener)，
 * 并按返回类型处理结果。
 */ (listener) => {
        generationListeners.add(listener)
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
         */
        return () => { generationListeners.delete(listener) }
      },
    },
    rpc: {
      call: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => Promise.reject(new Error('unexpected generic RPC call')),
    },
    registerGenerationSource: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {},
    start: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => ({ stop: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {} }),
  }
  ctx.reflect.provide('connection', connection)
  ctx.reflect.provide('remote', {
    ...remote,
    $stream: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：options（RemoteStreamOptions<Item>
 * ）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(options)，并按返回类型处理结果。
 */ <Item>(options: RemoteStreamOptions<Item>) => (
      new RemoteStream(connection, options)
    ),
    $on: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（string）：提供需要处理或投影的事件数据；
 * 必须满足声明的类型及调用时序要求。；参数：listener（RemoteListener）：接收后续状态或事件并执行调用方逻辑；
 * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 典型用法：在完成前置校验后调用 匿名回调(event, listener)，并按返回类型处理结果。
 */ (event: string, listener: RemoteListener) => {
      /**
       * 常量说明：eventListeners 用于处理 eventListeners 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const eventListeners = listeners.get(event) ?? new Set<RemoteListener>()
      eventListeners.add(listener)
      listeners.set(event, eventListeners)
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      return () => { eventListeners.delete(listener) }
    },
  })
  ctx.reflect.provide('remote.commands', remote.commands)
  ctx.reflect.provide('remote.session', remote.session)
  ctx.reflect.provide('remote.subagents', remote.subagents)
  /**
   * 常量说明：fiber 用于处理 fiber 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const fiber = ctx.plugin(SessionClient)
  await fiber
  /**
   * 常量说明：sessions 用于处理 sessions 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const sessions = ctx.sessions as ClientSessions
  return {
    ctx,
    api,
    fiber,
    sessions,
    dispatch: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
 * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；参数：args（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event, args)，并按返回类型处理结果。
 */ (event, ...args) => {
      for (const /*
       * 变量说明：listener 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */ listener of listeners.get(event) ?? []) listener(...args as never[])
    },
    publishGeneration: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：next（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(next)，并按返回类型处理结果。
 */ (next) => {
      generation = next
      for (const /*
       * 变量说明：listener 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */ listener of [...generationListeners]) listener()
    },
  }
}

/**
 * 功能说明：处理 flush 相关流程；使用场景由所在模块及调用位置决定。
 * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 flush()，并按返回类型处理结果。
 */
async function flush(): Promise<void> {
  for (let /*
   * 变量说明：index 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */ index = 0; index < 12; index++) await Promise.resolve()
}

describe('Session Controller Client apply', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
    it('routes Session Remote Events and connection generations into the object layer', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：connected 用于处理 connected 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const connected = vi.spyOn(ClientSessions.prototype, 'handleConnected')
        /**
     * 常量说明：error 用于处理 error 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const error = vi.spyOn(ClientSessions.prototype, 'handleSessionError')
        /**
     * 常量说明：bench 用于处理 bench 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const bench = await mount()
        expect(connected).not.toHaveBeenCalled()

        bench.dispatch('api-session/added', {
          sessionId: sid('session-1'),
          updatedAt: 1,
          running: false,
          blank: true,
        })
        await flush()
        expect(bench.sessions.list.getSnapshot().byId[sid('session-1')]).toMatchObject({
          running: false,
          updatedAt: 1,
        })

        bench.dispatch('api-session/status', sid('session-1'), true)
        bench.dispatch('api-session/activity', sid('session-1'), 9)
        bench.dispatch('api-session/error', sid('session-1'), 'agent failed')
        await flush()
        expect(bench.sessions.list.getSnapshot().byId[sid('session-1')]).toMatchObject({
          running: true,
          updatedAt: 9,
        })
        expect(error).toHaveBeenCalledWith(sid('session-1'), 'agent failed')

        bench.dispatch('api-session/removed', sid('session-1'))
        await flush()
        expect(bench.sessions.list.getSnapshot().byId[sid('session-1')]).toBeUndefined()

        bench.ctx.emit('connection/reset')
        expect(connected).toHaveBeenCalledOnce()
      })

    it('accepts the control baseline, retries a carrier generation, and reports terminal protocol failure', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：accept 用于处理 accept 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const accept = vi.spyOn(ClientSessions.prototype, 'handleControlFrame')
        /**
     * 常量说明：logged 用于处理 logged 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const logged = vi.spyOn(console, 'error').mockImplementation(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {})
        /**
     * 常量说明：bench 用于处理 bench 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const bench = await mount(GENERATION)
        await flush()

        expect(accept).toHaveBeenCalledWith({
          type: 'baseline',
          value: { queues: {}, jobs: {}, projections: {} },
        })

        bench.api.failStreams(new RemoteStreamCarrierError('generation lost'))
        await flush()
        expect(accept.mock.calls.filter(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：[frame]（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调([frame])，并按返回类型处理结果。
 */ ([frame]) => frame.type === 'baseline')).toHaveLength(2)

        bench.api.pushControl({ type: 'baseline', value: bench.api.controlBaseline } as never)
        await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
            expect(logged).toHaveBeenCalledWith(
              '[session-controller] control stream failed:',
              expect.objectContaining({ message: 'session control stream emitted more than one opening snapshot' }),
            )
          })
      })

    it('materializes Host-addressed Agent scopes before the Session list arrives', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：bench 用于处理 bench 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const bench = await mount()
        /**
     * 常量说明：adapter 用于处理 adapter 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const adapter = bench.ctx.typert.contexts.getClient('agent')
        /**
     * 常量说明：first 用于处理 first 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const first = adapter?.resolve(sid('agent-early'))

        expect(first).toBeDefined()
        expect(bench.sessions.scopeOf(first as Context)).toBe(sid('agent-early'))
        expect(adapter?.resolve(sid('agent-early'))).toBe(first)
      })

    it('projects Agent Context identity in both directions and withdraws the adapter on disposal', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：bench 用于处理 bench 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const bench = await mount(GENERATION)
        await flush()
        expect(bench.sessions.list.getSnapshot().phase).toBe('ready')

        bench.dispatch('api-session/added', {
          sessionId: sid('agent-1'),
          updatedAt: 1,
          running: false,
          blank: true,
        })
        await flush()
        /**
     * 常量说明：scoped 用于处理 scoped 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const scoped = bench.sessions.scope(sid('agent-1'))
        /**
     * 常量说明：adapter 用于处理 adapter 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const adapter = bench.ctx.typert.contexts.getClient('agent')
        expect(scoped).toBeDefined()
        expect(adapter?.identity(bench.ctx)).toBeUndefined()
        expect(adapter?.identity(scoped!)).toBe(sid('agent-1'))
        expect(adapter?.resolve(sid('agent-1'))).toBe(scoped)

        await bench.fiber.dispose()
        expect(bench.ctx.typert.contexts.getClient('agent')).toBeUndefined()
      })

    it('waits for a Host generation before retrying the control stream', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：accept 用于处理 accept 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const accept = vi.spyOn(ClientSessions.prototype, 'handleControlFrame')
        /**
     * 常量说明：bench 用于处理 bench 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const bench = await mount()
        await flush()
        expect(accept.mock.calls.filter(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：[frame]（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调([frame])，并按返回类型处理结果。
 */ ([frame]) => frame.type === 'baseline')).toHaveLength(1)

        bench.api.failStreams(new RemoteStreamCarrierError('offline'))
        await flush()
        expect(accept.mock.calls.filter(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：[frame]（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调([frame])，并按返回类型处理结果。
 */ ([frame]) => frame.type === 'baseline')).toHaveLength(1)

        bench.publishGeneration(GENERATION)
        await flush()
        expect(accept.mock.calls.filter(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：[frame]（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调([frame])，并按返回类型处理结果。
 */ ([frame]) => frame.type === 'baseline')).toHaveLength(2)
      })
  })
