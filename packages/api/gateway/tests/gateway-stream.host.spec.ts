/**
 * 文件职责：验证 api/gateway 中 gateway stream host spec 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WebSocket, { type RawData } from 'ws'
import { Context, Service, symbols } from '@deepseek-ai/cordis'
import { apply as applyConnection, inject as connectionInject } from '@deepseek-ai/dsh-client-connection'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import {
  bindTypertRemote,
  Remote,
  type InvocationDescriptor,
  type TypertContextMap,
  type TypertContextWire,
  TypertRemoteFailure,
} from '@deepseek-ai/dsh-typert-protocol'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { provideBrowserCredentials } from './browser-credentials.ts'
import TypertGatewayService, {
  TypertGatewayError,
  type Config as GatewayConfig,
  type TypertRemoteEventDispatch,
  type TypertRemoteEventInvocation,
  type TypertRemoteEventOutcome,
} from '@deepseek-ai/dsh-api-gateway'
import { z } from 'zod'
import type {
  RemoteEventClientId,
  RemoteEventInvocationFrame,
} from '../src/stream-protocol.ts'

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：importOriginal（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(importOriginal)，
 * 并按返回类型处理结果。
 */
vi.mock('node:crypto', async (importOriginal) => {
  /**
   * 常量说明：actual 用于处理 actual 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const actual = await importOriginal<typeof import('node:crypto')>()
  return { ...actual, randomUUID: vi.fn(actual.randomUUID) }
})

/**
 * 常量说明：randomUuid 用于处理 randomUuid 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const randomUuid = vi.mocked(randomUUID)
/**
 * 常量说明：browserCookies 用于处理 browserCookies 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const browserCookies = new WeakMap<Context, string>()
/**
 * 常量说明：REMOTE_HOST 用于处理 REMOTE_HOST 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const REMOTE_HOST = { home: '/home/fixture' } as const
type AgentWireId = TypertContextWire<TypertContextMap['agent']>
/**
 * 常量说明：agentId 用于处理 agentId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 agentId 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns AgentWireId；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 agentId(value)，并按返回类型处理结果。
 */
const agentId = (value: string): AgentWireId => value as AgentWireId

/** Exchange this test Host's process token for its WebSocket/HTTP Cookie header.
 * @remarks 中文说明：功能说明：处理 browserCookie 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；返回值：string；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 browserCookie(ctx)，
 * 并按返回类型处理结果。 */
function browserCookie(ctx: Context): string {
  /**
   * 常量说明：existing 用于处理 existing 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const existing = browserCookies.get(ctx)
  if (existing !== undefined) return existing
  /**
   * 常量说明：origin 用于处理 origin 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const origin = `http://127.0.0.1:${String(ctx.webServer.port)}`
  /**
   * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const target = new URL(ctx.connection.authenticatedUrl(origin))
  /**
   * 变量说明：setCookie 用于设置 Cookie 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let setCookie: string | undefined
  ctx.connection.authorizeIndex({
    method: 'GET',
    url: `${target.pathname}${target.search}`,
    headers: { host: target.host },
  }, {
    /**
     * 功能说明：写入 Head 相关流程；使用场景由所在模块及调用位置决定。
     * @param _status （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @param headers （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 writeHead(_status, headers)，并按返回类型处理结果。
     */
    writeHead(_status, headers) { setCookie = headers?.['set-cookie'] },
    /**
     * 功能说明：处理 end 相关流程；使用场景由所在模块及调用位置决定。
     * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 end()，并按返回类型处理结果。
     */
    end() {},
  })
  if (setCookie === undefined) throw new Error('gateway stream fixture did not receive a browser cookie')
  /**
   * 常量说明：cookie 用于处理 cookie 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const cookie = setCookie.split(';', 1)[0]!
  browserCookies.set(ctx, cookie)
  return cookie
}

/**
 * 类说明：FeedService 用于集中封装 处理 FeedService 相关状态与行为。
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。
 * 使用场景：由 api/gateway 在对应插件或业务生命周期内创建和调用。
 */
class FeedService extends Service {
  /**
   * 常量说明：typertRemote 用于处理 typertRemote 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  readonly typertRemote = bindTypertRemote(this, 'feed')
  /**
   * 常量说明：signals 用于处理 signals 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  readonly signals: AbortSignal[] = []
  /**
   * 变量说明：returns 用于处理 returns 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  returns = 0

  /**
   * 功能说明：处理 FeedService 相关流程；使用场景由所在模块及调用位置决定。
   * @param ctx （Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new FeedService(ctx) 创建实例，并在所属生命周期内使用。
   */
  constructor(ctx: Context) {
    super(ctx, 'feed')
  }

  /**
   * 功能说明：处理 follow 相关流程；使用场景由所在模块及调用位置决定。
   * @param label （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param signal （AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
   * @returns AsyncIterable<string>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 follow(label, signal)，并按返回类型处理结果。
   */
  @Remote({ mode: 'stream' })
  async *follow(label: string, signal: AbortSignal): AsyncIterable<string> {
    this.signals.push(signal)
    try {
      yield `${label}:ready`
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
        if (signal.aborted) resolve()
        else signal.addEventListener('abort', () => { resolve() }, { once: true })
      })
    } finally {
      this.returns += 1
    }
  }

  /**
   * 功能说明：同步 sync 相关流程；使用场景由所在模块及调用位置决定。
   * @param label （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Iterable<string>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 sync(label)，并按返回类型处理结果。
   */
  @Remote({ mode: 'stream' })
  *sync(label: string): Iterable<string> {
    yield `${label}:one`
    yield `${label}:two`
  }

  /**
   * 功能说明：处理 invalid 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Iterable<string>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 invalid()，并按返回类型处理结果。
   */
  @Remote({ mode: 'stream' })
  *invalid(): Iterable<string> {
    yield 42 as unknown as string
  }

  /**
   * 功能说明：处理 nonJson 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Iterable<unknown>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 nonJson()，并按返回类型处理结果。
   */
  @Remote({ mode: 'stream' })
  *nonJson(): Iterable<unknown> {
    yield 1n
  }

  /**
   * 功能说明：处理 missing 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Iterable<string>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 missing()，并按返回类型处理结果。
   */
  @Remote({ mode: 'stream' })
  missing(): Iterable<string> {
    return null as unknown as Iterable<string>
  }

  /**
   * 功能说明：处理 src 相关流程；使用场景由所在模块及调用位置决定。
   * @param label （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Iterable<string>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 src(label)，并按返回类型处理结果。
   */
  @Remote({ mode: 'stream' })
  *src(label: string): Iterable<string> {
    yield `${label}:src`
  }

  /**
   * 功能说明：处理 abortBeforeOpen 相关流程；使用场景由所在模块及调用位置决定。
   * @param signal （AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
   * @returns Iterable<string>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 abortBeforeOpen(signal)，并按返回类型处理结果。
   */
  @Remote({ mode: 'stream' })
  abortBeforeOpen(signal: AbortSignal): Iterable<string> {
    if (signal.aborted) throw new Error('fixture observed pre-open cancellation')
    return []
  }

  /**
   * 功能说明：处理 reject 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Iterable<string>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 reject()，并按返回类型处理结果。
   */
  @Remote({ mode: 'stream' })
  reject(): Iterable<string> {
    throw new TypertRemoteFailure({
      code: 'fixture-rejected', message: 'fixture rejected the stream', details: { retryable: false },
    })
  }

  /**
   * 功能说明：处理 rejectWithNonJsonDetails 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Iterable<string>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 rejectWithNonJsonDetails()，并按返回类型处理结果。
   */
  @Remote({ mode: 'stream' })
  rejectWithNonJsonDetails(): Iterable<string> {
    throw new TypertRemoteFailure({
      code: 'fixture-broken', message: 'fixture emitted invalid details', details: { count: 1n },
    })
  }

  /**
   * 功能说明：处理 unary 相关流程；使用场景由所在模块及调用位置决定。
   * @param label （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 unary(label)，并按返回类型处理结果。
   */
  unary(label: string): string {
    return label
  }
}

/**
 * 常量说明：roots 用于处理 roots 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const roots: Context[] = []

/**
 * 类说明：RemoteEventSourceProbe 用于集中封装 处理 RemoteEventSourceProbe 相关状态与行为。
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。
 * 使用场景：由 api/gateway 在对应插件或业务生命周期内创建和调用。
 */
class RemoteEventSourceProbe {
  /**
   * 常量说明：source 用于处理 source 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 source 相关流程；使用场景由所在模块及调用位置决定。
   * @param signal （AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
   * @returns AsyncIterable<TypertRemoteEventDispatch>；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 source(signal)，并按返回类型处理结果。
   */
  readonly source = (signal: AbortSignal): AsyncIterable<TypertRemoteEventDispatch> => {
    this.signal = signal
    return this.iterate(signal)
  }

  /**
   * 变量说明：signal 用于处理 signal 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  signal: AbortSignal | undefined
  /**
   * 常量说明：dispatches 用于处理 dispatches 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly dispatches: TypertRemoteEventDispatch[] = []
  /**
   * 变量说明：wake 用于处理 wake 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private wake: (() => void) | undefined

  /**
   * 功能说明：处理 push 相关流程；使用场景由所在模块及调用位置决定。
   * @param dispatch （TypertRemoteEventDispatch）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 push(dispatch)，并按返回类型处理结果。
   */
  push(dispatch: TypertRemoteEventDispatch): void {
    this.dispatches.push(dispatch)
    this.wake?.()
    this.wake = undefined
  }

  /**
   * 功能说明：处理 iterate 相关流程；使用场景由所在模块及调用位置决定。
   * @param signal （AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
   * @returns AsyncGenerator<TypertRemoteEventDispatch>；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 iterate(signal)，并按返回类型处理结果。
   */
  private async *iterate(signal: AbortSignal): AsyncGenerator<TypertRemoteEventDispatch> {
    /**
     * 常量说明：aborted 用于处理 aborted 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：处理 aborted 相关流程；使用场景由所在模块及调用位置决定。
     * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 aborted()，并按返回类型处理结果。
     */
    const aborted = (): void => {
      this.wake?.()
      this.wake = undefined
    }
    signal.addEventListener('abort', aborted, { once: true })
    try {
      while (!signal.aborted) {
        while (this.dispatches.length > 0) {
          yield this.dispatches.shift() as TypertRemoteEventDispatch
        }
        if (signal.aborted) return
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
         * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
         */
        await new Promise<void>((resolve) => { this.wake = resolve })
        this.wake = undefined
      }
    } finally {
      signal.removeEventListener('abort', aborted)
    }
  }
}

interface PendingInvocationProbe {
  readonly dispatch: TypertRemoteEventInvocation
  readonly outcome: Promise<TypertRemoteEventOutcome>
  readonly resolve: (outcome: TypertRemoteEventOutcome) => void
  readonly reject: (reason: unknown) => void
}

/**
 * 功能说明：处理 pendingInvocation 相关流程；使用场景由所在模块及调用位置决定。
 * @param context （Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。
 * @param signal （AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
 * @param prompt （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns PendingInvocationProbe；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 pendingInvocation(context, signal, prompt)，
 * 并按返回类型处理结果。
 */
function pendingInvocation(
  context: Context,
  signal?: AbortSignal,
  prompt = 'ship',
): PendingInvocationProbe {
  /**
   * 常量说明：subject 用于处理 subject 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const subject = { ctx: context }
  /**
   * 常量说明：settled 用于处理 settled 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const settled = Promise.withResolvers<TypertRemoteEventOutcome>()
  /**
   * 常量说明：resolve 用于解析 resolve 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：outcome（TypertRemoteEventOutcome）
   * ：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(outcome)，并按返回类型处理结果。
   */
  const resolve = vi.fn((outcome: TypertRemoteEventOutcome) => {
    settled.resolve(outcome)
  })
  /**
   * 常量说明：reject 用于处理 reject 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：reason（unknown）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(reason)，并按返回类型处理结果。
   */
  const reject = vi.fn((reason: unknown) => {
    settled.reject(reason)
  })
  return {
    dispatch: {
      event: 'fixture/approval',
      request: { prompt, agent: subject, ...(signal === undefined ? {} : { signal }) },
      context: { value: context, subject },
      resolve,
      reject,
    },
    outcome: settled.promise,
    resolve,
    reject,
  }
}

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
afterEach(async () => {
  randomUuid.mockClear()
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：ctx（由 TypeScript
   * 根据调用位置推断的类型）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
   * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(ctx)，并按返回类型处理结果。
   */
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('Typert Remote streams', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('validates the WebSocket heartbeat timer range', () => {
    expect(TypertGatewayService.Config({})).toEqual({ websocketHeartbeatIntervalMs: 30_000 })
    expect(TypertGatewayService.Config({ websocketHeartbeatIntervalMs: MAX_TIMER_DELAY_MS }))
      .toEqual({ websocketHeartbeatIntervalMs: MAX_TIMER_DELAY_MS })
    /**
     * 变量说明：websocketHeartbeatIntervalMs 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const websocketHeartbeatIntervalMs of [0, 1.5, MAX_TIMER_DELAY_MS + 1]) {
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      expect(() => TypertGatewayService.Config({ websocketHeartbeatIntervalMs })).toThrow()
    }
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('opens decoded carrier payloads through the in-process wire adapter', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { ctx } = await setup(false)
    /**
     * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const source = await ctx.typertGateway.wireStream.open(
      'feed/sync',
      { args: { label: 'wire' } },
      new AbortController().signal,
    )

    await expect(collect(source)).resolves.toEqual(['wire:one', 'wire:two'])
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('passes Iterable and AsyncIterable items through and returns the iterator on cancellation', async () => {
    /**
     * 常量说明：ctx、service 用于处理 ctx、service 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const { ctx, service } = await setup(false)
    /**
     * 常量说明：abort 用于处理 abort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const abort = new AbortController()
    /**
     * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const source = await ctx.typertGateway.stream({
      namespace: 'feed',
      method: 'follow',
      args: { label: 'a' },
      signal: abort.signal,
    })
    /**
     * 常量说明：iterator 用于处理 iterator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const iterator = source[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toEqual({ done: false, value: 'a:ready' })
    /**
     * 常量说明：pending 用于处理 pending 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const pending = iterator.next()
    abort.abort(new Error('fixture cancellation'))
    await expect(pending).rejects.toThrow('Remote invocation "feed/follow" was aborted')
    expect(service.signals).toEqual([abort.signal])
    expect(service.returns).toBe(1)

    await expect(collect(await ctx.typertGateway.stream({
      namespace: 'feed', method: 'sync', args: { label: 'b' },
    }))).resolves.toEqual(['b:one', 'b:two'])
    await expect(collect(await ctx.typertGateway.stream({
      namespace: 'feed', method: 'invalid', args: {},
    }))).resolves.toEqual([42])
    await expect(collect(await ctx.typertGateway.stream({
      namespace: 'feed', method: 'nonJson', args: {},
    }))).resolves.toEqual([1n])
    await expect(ctx.typertGateway.stream({
      namespace: 'feed', method: 'missing', args: {},
    })).rejects.toMatchObject({ code: 'result-invalid' })

    await expect(collect(await ctx.typertGateway.stream({
      namespace: 'feed', method: 'src', args: { label: 'c' },
    }))).resolves.toEqual(['c:src'])

    /**
     * 常量说明：abortedBeforeOpen 用于处理 abortedBeforeOpen 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const abortedBeforeOpen = new AbortController()
    abortedBeforeOpen.abort(new Error('cancelled before open'))
    await expect(ctx.typertGateway.stream({
      namespace: 'feed', method: 'abortBeforeOpen', args: {}, signal: abortedBeforeOpen.signal,
    })).rejects.toThrow('Remote invocation "feed/abortBeforeOpen" was aborted')

    /**
     * 常量说明：abortedBeforeIteration 用于处理 abortedBeforeIteration 相关数据，作用于当前作用域；
     * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const abortedBeforeIteration = new AbortController()
    abortedBeforeIteration.abort(new Error('cancelled before iteration'))
    /**
     * 常量说明：preCancelled 用于处理 preCancelled 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const preCancelled = await ctx.typertGateway.stream({
      namespace: 'feed', method: 'sync', args: { label: 'ignored' }, signal: abortedBeforeIteration.signal,
    })
    await expect(collect(preCancelled)).rejects.toThrow('Remote invocation "feed/sync" was aborted')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('keeps unary and stream invocation modes distinct', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { ctx } = await setup(false)
    await expect(ctx.typertGateway.invoke({
      namespace: 'feed', method: 'sync', args: { label: 'a' },
    })).rejects.toMatchObject({ code: 'signature-invalid' } satisfies Partial<TypertGatewayError>)
    await expect(ctx.typertGateway.stream({
      namespace: 'feed', method: 'unary', args: { label: 'a' },
    })).rejects.toMatchObject({ code: 'signature-invalid' } satisfies Partial<TypertGatewayError>)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('uses the configured WebSocket heartbeat interval', { timeout: 1_000 }, async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { ctx } = await setup(true, { websocketHeartbeatIntervalMs: 20 })
    /**
     * 常量说明：socket 用于处理 socket 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const socket = new WebSocket(`ws://127.0.0.1:${String(ctx.webServer.port)}/api/remote.mux`, {
      headers: { cookie: browserCookie(ctx) },
    })
    /**
     * 常量说明：ping 用于处理 ping 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ping = once(socket, 'ping')
    await once(socket, 'open')
    expect((await ping)[0]).toEqual(Buffer.alloc(0))

    socket.close()
    await once(socket, 'close')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('multiplexes independent streams over one WebSocket and propagates cancellation', async () => {
    /**
     * 常量说明：ctx、service 用于处理 ctx、service 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const { ctx, service } = await setup(true)
    /**
     * 常量说明：socket 用于处理 socket 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const socket = new WebSocket(`ws://127.0.0.1:${String(ctx.webServer.port)}/api/remote.mux`, {
      headers: { cookie: browserCookie(ctx) },
    })
    await once(socket, 'open')
    /**
     * 常量说明：frames 用于处理 frames 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const frames: Record<string, unknown>[] = []
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：data（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(data)，并按返回类型处理结果。
     */
    socket.on('message', (data) => { frames.push(JSON.parse(rawText(data)) as Record<string, unknown>) })

    sendOpen(socket, 'a', 'feed/follow', { label: 'a' })
    sendOpen(socket, 'b', 'feed/follow', { label: 'b' })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => {
      expect(frames).toEqual(expect.arrayContaining([
        { type: 'item', streamId: 'a', value: 'a:ready' },
        { type: 'item', streamId: 'b', value: 'b:ready' },
      ]))
    })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：signal（由 TypeScript
     * 根据调用位置推断的类型）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(signal)，并按返回类型处理结果。
     */
    expect(service.signals.map(signal => signal.aborted)).toEqual([false, false])
    expect(service.returns).toBe(0)

    socket.send(JSON.stringify({ type: 'cancel', streamId: 'a' }))
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => { expect(service.returns).toBe(1) })
    expect(service.signals[0]?.aborted).toBe(true)
    expect(service.signals[1]?.aborted).toBe(false)

    sendOpen(socket, 'sync', 'feed/sync', { label: 's' })
    sendOpen(socket, 'invalid', 'feed/invalid', {})
    sendOpen(socket, 'non-json', 'feed/nonJson', {})
    sendOpen(socket, 'rejected', 'feed/reject', {})
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => {
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：frame（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(frame)，并按返回类型处理结果。
       */
      expect(frames.filter(frame => frame.streamId === 'sync')).toEqual([
        { type: 'item', streamId: 'sync', value: 's:one' },
        { type: 'item', streamId: 'sync', value: 's:two' },
        { type: 'end', streamId: 'sync' },
      ])
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：frame（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(frame)，并按返回类型处理结果。
       */
      expect(frames.filter(frame => frame.streamId === 'invalid')).toEqual([
        { type: 'item', streamId: 'invalid', value: 42 },
        { type: 'end', streamId: 'invalid' },
      ])
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：frame（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(frame)，并按返回类型处理结果。
       */
      expect(frames.find(frame => frame.streamId === 'non-json')).toMatchObject({
        type: 'error', error: { code: 'internal' },
      })
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：frame（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(frame)，并按返回类型处理结果。
       */
      expect(frames.find(frame => frame.streamId === 'rejected')).toEqual({
        type: 'error',
        streamId: 'rejected',
        error: {
          code: 'fixture-rejected',
          message: 'fixture rejected the stream',
          details: { retryable: false },
        },
      })
    })

    /**
     * 常量说明：closed 用于处理 closed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const closed = once(socket, 'close')
    sendOpen(socket, 'broken-error', 'feed/rejectWithNonJsonDetails', {})
    /**
     * 常量说明：closeEvent 用于关闭 Event 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const closeEvent = await closed
    expect(closeEvent[0]).toBe(1011)
    expect(String(closeEvent[1])).toBe('Remote stream failure could not be delivered')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => { expect(service.returns).toBe(2) })
    expect(service.signals[1]?.aborted).toBe(true)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('carries the registered Remote event source and withdraws its active stream', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { ctx } = await setup(true)
    /**
     * 变量说明：sourceSignal 用于处理 sourceSignal 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let sourceSignal: AbortSignal | undefined
    /**
     * 常量说明：sourceClosed 用于处理 sourceClosed 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const sourceClosed = vi.fn()
    /**
     * 常量说明：publish 用于处理 publish 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const publish = Promise.withResolvers<undefined>()
    /**
     * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：处理 source 相关流程；使用场景由所在模块及调用位置决定。
     * @param signal （AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
     * @returns AsyncIterable<{ event: string; args: readonly unknown[] }>；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 source(signal)，并按返回类型处理结果。
     */
    const source = (signal: AbortSignal): AsyncIterable<{ event: string; args: readonly unknown[] }> => {
      sourceSignal = signal
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      return (async function *() {
        try {
          await publish.promise
          yield { event: 'fixture/changed', args: ['settings'] }
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
            if (signal.aborted) resolve()
            else signal.addEventListener('abort', () => { resolve() }, { once: true })
          })
        } finally {
          sourceClosed()
        }
      })()
    }
    /**
     * 常量说明：unregister 用于处理 unregister 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const unregister = ctx.typertGateway.registerRemoteEvents(source, REMOTE_HOST)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => { ctx.typertGateway.registerRemoteEvents(source, REMOTE_HOST) })
      .toThrow('forwarded Remote event source is already registered')

    /**
     * 常量说明：socket 用于处理 socket 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const socket = new WebSocket(`ws://127.0.0.1:${String(ctx.webServer.port)}/api/remote.mux`, {
      headers: { cookie: browserCookie(ctx) },
    })
    await once(socket, 'open')
    /**
     * 常量说明：frames 用于处理 frames 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const frames: Record<string, unknown>[] = []
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：data（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(data)，并按返回类型处理结果。
     */
    socket.on('message', (data) => { frames.push(JSON.parse(rawText(data)) as Record<string, unknown>) })
    sendOpen(socket, 'events', '$events', {})

    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => {
      /**
       * 常量说明：eventFrames 用于处理 eventFrames 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：frame（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(frame)，并按返回类型处理结果。
       */
      const eventFrames = frames.filter(frame => frame.streamId === 'events')
      expect(eventFrames).toHaveLength(1)
      expect(eventFrames[0]).toMatchObject({
        type: 'item', streamId: 'events', value: { type: 'ready', host: REMOTE_HOST },
      })
      expect(typeof Reflect.get(eventFrames[0]!.value as object, 'clientId')).toBe('string')
    })
    publish.resolve(undefined)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => {
      /**
       * 常量说明：eventFrames 用于处理 eventFrames 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：frame（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(frame)，并按返回类型处理结果。
       */
      const eventFrames = frames.filter(frame => frame.streamId === 'events').slice(0, 2)
      expect(eventFrames).toHaveLength(2)
      expect(eventFrames[0]).toMatchObject({
        type: 'item', streamId: 'events', value: { type: 'ready', host: REMOTE_HOST },
      })
      expect(typeof Reflect.get(eventFrames[0]!.value as object, 'clientId')).toBe('string')
      expect(eventFrames[1]).toEqual({
        type: 'item', streamId: 'events', value: {
          type: 'emit', event: 'fixture/changed', args: ['settings'],
        },
      })
    })
    expect(sourceSignal?.aborted).toBe(false)

    await unregister()
    expect(sourceClosed).toHaveBeenCalledOnce()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => {
      expect(sourceSignal?.aborted).toBe(true)
      expect(frames).toContainEqual({ type: 'end', streamId: 'events' })
    })

    /**
     * 常量说明：unregisterReplacement 用于处理 unregisterReplacement 相关数据，作用于当前作用域；
     * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const unregisterReplacement = ctx.typertGateway.registerRemoteEvents(source, REMOTE_HOST)
    await unregister()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => { ctx.typertGateway.registerRemoteEvents(source, REMOTE_HOST) })
      .toThrow('forwarded Remote event source is already registered')
    await unregisterReplacement()
    socket.close()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('rejects a scoped dispatch yielded after its Remote event source is withdrawn', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { ctx } = await setup(false)
    /**
     * 常量说明：publish 用于处理 publish 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const publish = Promise.withResolvers<undefined>()
    /**
     * 常量说明：agent 用于处理 agent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const agent = ctx.extend()
    /**
     * 常量说明：pending 用于处理 pending 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const pending = pendingInvocation(agent)
    /**
     * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：处理 source 相关流程；使用场景由所在模块及调用位置决定。
     * @returns AsyncIterable<TypertRemoteEventDispatch>；调用方应按声明类型处理，
     * 不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 source()，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const source = (): AsyncIterable<TypertRemoteEventDispatch> => (async function* () {
      await publish.promise
      yield pending.dispatch
    })()
    /**
     * 常量说明：unregister 用于处理 unregister 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const unregister = ctx.typertGateway.registerRemoteEvents(source, REMOTE_HOST)
    /**
     * 常量说明：rejected 用于处理 rejected 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const rejected = expect(pending.outcome).rejects.toThrow(
      'forwarded Remote event source was removed',
    )

    publish.resolve(undefined)
    await unregister()

    await rejected
    expect(pending.reject).toHaveBeenCalledTimes(1)
    expect(pending.resolve).not.toHaveBeenCalled()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('cancels a pending waterfall when its source rejects during removal', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { ctx } = await setup(true)
    /**
     * 常量说明：agent 用于处理 agent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const agent = ctx.extend()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：candidate（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(candidate)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：id（由 TypeScript
     * 根据调用位置推断的类型）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(id)，并按返回类型处理结果。
     */
    ctx.typert.contexts.registerHost('agent', {
      wire: 'agentId',
      wireTypeSymbol: '@fixture#AgentId',
      identity: candidate => candidate === agent ? agentId('agent-removal') : undefined,
      resolve: id => id === 'agent-removal' ? agent : undefined,
    })
    /**
     * 常量说明：pending 用于处理 pending 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const pending = pendingInvocation(agent)
    /**
     * 常量说明：rejected 用于处理 rejected 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const rejected = expect(pending.outcome).rejects.toThrow(
      'forwarded Remote event source was removed',
    )
    /**
     * 常量说明：unregister 用于处理 unregister 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：signal（由 TypeScript
     * 根据调用位置推断的类型）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(signal)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const unregister = ctx.typertGateway.registerRemoteEvents(signal => (async function* () {
      yield pending.dispatch
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
        if (signal.aborted) resolve()
        else signal.addEventListener('abort', () => { resolve() }, { once: true })
      })
      throw new Error('fixture source rejected during removal')
    })(), REMOTE_HOST)
    /**
     * 常量说明：client 用于处理 client 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const client = await openEventClient(ctx, 'events-removal')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => { expect(deliveredInvocation(client)).toBeDefined() })

    await unregister()
    await rejected
    expect(pending.reject).toHaveBeenCalledTimes(1)
    expect(pending.resolve).not.toHaveBeenCalled()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => {
      expect(client.frames).toContainEqual({ type: 'end', streamId: client.streamId })
    })
    client.socket.close()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('delegates unavailable Contexts and rejects malformed scoped invocations', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { ctx } = await setup(false)
    /**
     * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const source = new RemoteEventSourceProbe()
    /**
     * 常量说明：unregister 用于处理 unregister 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const unregister = ctx.typertGateway.registerRemoteEvents(source.source, REMOTE_HOST)

    /**
     * 变量说明：event 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const event of [42, ''] as const) {
      /**
       * 常量说明：invalidName 用于处理 invalidName 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const invalidName = pendingInvocation(ctx)
      /**
       * 常量说明：rejected 用于处理 rejected 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const rejected = expect(invalidName.outcome).rejects.toThrow(
        'Remote event name must be a nonempty string',
      )
      source.push({
        ...invalidName.dispatch,
        event: event as unknown as string,
      })
      await rejected
    }

    /**
     * 常量说明：unavailable 用于处理 unavailable 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const unavailable = pendingInvocation(ctx)
    source.push(unavailable.dispatch)
    await expect(unavailable.outcome).resolves.toEqual({ kind: 'next' })
    expect(unavailable.reject).not.toHaveBeenCalled()

    /**
     * 变量说明：selected 用于处理 selected 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let selected = ctx.extend()
    /**
     * 变量说明：identity 用于处理 identity 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let identity: unknown = 1n
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：candidate（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(candidate)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    ctx.typert.contexts.registerHost('agent', {
      wire: 'agentId',
      wireTypeSymbol: '@fixture#AgentId',
      identity: candidate => candidate === selected ? identity as AgentWireId : undefined,
      resolve: () => selected,
    })
    /**
     * 常量说明：nonJsonIdentity 用于处理 nonJsonIdentity 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const nonJsonIdentity = pendingInvocation(selected)
    /**
     * 常量说明：nonJsonRejected 用于处理 nonJsonRejected 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const nonJsonRejected = expect(nonJsonIdentity.outcome).rejects.toThrow(
      'require a non-empty Agent identity',
    )
    source.push(nonJsonIdentity.dispatch)
    await nonJsonRejected

    identity = 'agent-invalid-request'
    /**
     * 常量说明：invalidRequest 用于处理 invalidRequest 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const invalidRequest = pendingInvocation(selected)
    /**
     * 常量说明：invalidRequestRejected 用于处理 invalidRequestRejected 相关数据，作用于当前作用域；
     * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const invalidRequestRejected = expect(invalidRequest.outcome).rejects.toThrow(
      'must carry its scoped Agent directly',
    )
    source.push({
      ...invalidRequest.dispatch,
      request: {},
    })
    await invalidRequestRejected

    /**
     * 常量说明：staleFiber 用于处理 staleFiber 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const staleFiber = ctx.plugin(() => {})
    await staleFiber
    selected = staleFiber.ctx
    identity = 'agent-stale'
    await staleFiber.dispose()
    /**
     * 常量说明：stale 用于处理 stale 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const stale = pendingInvocation(selected)
    source.push(stale.dispatch)
    await expect(stale.outcome).resolves.toEqual({ kind: 'next' })
    expect(stale.reject).not.toHaveBeenCalled()

    selected = ctx.extend()
    identity = 'agent-cancelled'
    /**
     * 常量说明：abort 用于处理 abort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const abort = new AbortController()
    abort.abort('fixture non-error cancellation')
    /**
     * 常量说明：cancelled 用于处理 cancelled 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const cancelled = pendingInvocation(selected, abort.signal)
    /**
     * 常量说明：cancelledOutcome 用于处理 cancelledOutcome 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const cancelledOutcome = expect(cancelled.outcome).rejects.toMatchObject({
      message: 'typert gateway: Remote event was cancelled',
      cause: 'fixture non-error cancellation',
    })
    source.push(cancelled.dispatch)
    await cancelledOutcome

    await unregister()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('rejects notification arguments that are not lossless JSON arrays', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { ctx } = await setup(false)
    /**
     * 常量说明：frames 用于处理 frames 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const frames = [
      { event: 'fixture/changed', args: {} },
      { event: 'fixture/changed', args: [1n] },
    ]
    /**
     * 变量说明：frame 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const frame of frames) {
      /**
       * 变量说明：sourceSignal 用于处理 sourceSignal 相关数据，作用于当前作用域；其值可能随流程推进而变化，
       * 读写时需遵守声明类型和所在生命周期。
       */
      let sourceSignal: AbortSignal | undefined
      /**
       * 常量说明：unregister 用于处理 unregister 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：signal（由 TypeScript
       * 根据调用位置推断的类型）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(signal)，并按返回类型处理结果。
       */
      const unregister = ctx.typertGateway.registerRemoteEvents((signal) => {
        sourceSignal = signal
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
         */
        return (async function* () {
          yield frame as unknown as TypertRemoteEventDispatch
        })()
      }, REMOTE_HOST)
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      await vi.waitFor(() => { expect(sourceSignal?.aborted).toBe(true) })
      /**
       * 常量说明：reason 用于处理 reason 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const reason: unknown = sourceSignal?.reason
      if (!(reason instanceof Error)) throw new Error('Remote event source did not fail with an Error')
      expect(reason.message).toContain('arguments are not lossless JSON data')
      await unregister()
    }
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('retries a colliding Remote event id before publishing the second waterfall', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { ctx } = await setup(false)
    /**
     * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const source = new RemoteEventSourceProbe()
    /**
     * 常量说明：unregister 用于处理 unregister 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const unregister = ctx.typertGateway.registerRemoteEvents(source.source, REMOTE_HOST)
    /**
     * 常量说明：agent 用于处理 agent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const agent = ctx.extend()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：candidate（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(candidate)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：id（由 TypeScript
     * 根据调用位置推断的类型）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(id)，并按返回类型处理结果。
     */
    ctx.typert.contexts.registerHost('agent', {
      wire: 'agentId',
      wireTypeSymbol: '@fixture#AgentId',
      identity: candidate => candidate === agent ? agentId('agent-collision') : undefined,
      resolve: id => id === 'agent-collision' ? agent : undefined,
    })
    /**
     * 常量说明：firstId 用于处理 firstId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const firstId = '00000000-0000-4000-8000-000000000001' as ReturnType<typeof randomUUID>
    /**
     * 常量说明：secondId 用于处理 secondId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const secondId = '00000000-0000-4000-8000-000000000002' as ReturnType<typeof randomUUID>
    randomUuid.mockReturnValueOnce(firstId).mockReturnValueOnce(firstId).mockReturnValueOnce(secondId)
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
    const first = pendingInvocation(agent, firstAbort.signal, 'first')
    /**
     * 常量说明：second 用于处理 second 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const second = pendingInvocation(agent, secondAbort.signal, 'second')

    source.push(first.dispatch)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => { expect(randomUuid).toHaveBeenCalledTimes(1) })
    source.push(second.dispatch)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => { expect(randomUuid).toHaveBeenCalledTimes(3) })

    /**
     * 常量说明：firstReason 用于处理 firstReason 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const firstReason = new Error('cancel first collision fixture')
    /**
     * 常量说明：secondReason 用于处理 secondReason 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const secondReason = new Error('cancel second collision fixture')
    /**
     * 常量说明：firstRejected 用于处理 firstRejected 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const firstRejected = expect(first.outcome).rejects.toBe(firstReason)
    /**
     * 常量说明：secondRejected 用于处理 secondRejected 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const secondRejected = expect(second.outcome).rejects.toBe(secondReason)
    firstAbort.abort(firstReason)
    secondAbort.abort(secondReason)
    await firstRejected
    await secondRejected
    await unregister()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('retries a colliding Remote event Client id before opening the second generation', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { ctx } = await setup(true)
    /**
     * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const source = new RemoteEventSourceProbe()
    /**
     * 常量说明：unregister 用于处理 unregister 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const unregister = ctx.typertGateway.registerRemoteEvents(source.source, REMOTE_HOST)
    /**
     * 常量说明：firstId 用于处理 firstId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const firstId = '00000000-0000-4000-8000-000000000011' as ReturnType<typeof randomUUID>
    /**
     * 常量说明：secondId 用于处理 secondId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const secondId = '00000000-0000-4000-8000-000000000012' as ReturnType<typeof randomUUID>
    randomUuid.mockReturnValueOnce(firstId).mockReturnValueOnce(firstId).mockReturnValueOnce(secondId)

    /**
     * 常量说明：first 用于处理 first 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const first = await openEventClient(ctx, 'events-client-id-a')
    /**
     * 常量说明：second 用于处理 second 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const second = await openEventClient(ctx, 'events-client-id-b')

    expect(first.clientId).toBe(firstId)
    expect(second.clientId).toBe(secondId)
    expect(randomUuid).toHaveBeenCalledTimes(3)
    first.socket.close()
    second.socket.close()
    await unregister()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('fans one scoped waterfall out and accepts the first Client result', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { ctx } = await setup(true)
    /**
     * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const source = new RemoteEventSourceProbe()
    /**
     * 常量说明：unregister 用于处理 unregister 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const unregister = ctx.typertGateway.registerRemoteEvents(source.source, REMOTE_HOST)
    /**
     * 常量说明：agent 用于处理 agent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const agent = ctx.extend()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：candidate（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(candidate)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：id（由 TypeScript
     * 根据调用位置推断的类型）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(id)，并按返回类型处理结果。
     */
    ctx.typert.contexts.registerHost('agent', {
      wire: 'agentId',
      wireTypeSymbol: '@fixture#AgentId',
      identity: candidate => candidate === agent ? agentId('agent-1') : undefined,
      resolve: id => id === 'agent-1' ? agent : undefined,
    })
    /**
     * 常量说明：first 用于处理 first 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const first = await openEventClient(ctx, 'events-a')
    /**
     * 常量说明：second 用于处理 second 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const second = await openEventClient(ctx, 'events-b')
    /**
     * 常量说明：pending 用于处理 pending 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const pending = pendingInvocation(agent)
    source.push(pending.dispatch)

    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => {
      expect(deliveredInvocation(first)).toBeDefined()
      expect(deliveredInvocation(second)).toBeDefined()
    })
    /**
     * 常量说明：firstFrame 用于处理 firstFrame 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const firstFrame = deliveredInvocation(first)!
    /**
     * 常量说明：secondFrame 用于处理 secondFrame 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const secondFrame = deliveredInvocation(second)!
    expect(firstFrame.eventId).toBe(secondFrame.eventId)
    expect(firstFrame).toMatchObject({
      type: 'waterfall',
      event: 'fixture/approval',
      agentId: 'agent-1',
      request: { prompt: 'ship' },
    })
    expect(firstFrame).not.toHaveProperty('deliveryId')
    expect(secondFrame).not.toHaveProperty('deliveryId')

    await sendEventResult(second, secondFrame, {
      kind: 'result', value: 'allowed',
    })
    await expect(pending.outcome).resolves.toEqual({ kind: 'result', value: 'allowed' })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => {
      expect(first.frames).toContainEqual({
        type: 'item',
        streamId: first.streamId,
        value: { type: 'cancel', eventId: firstFrame.eventId },
      })
    })

    await sendEventResult(first, firstFrame, {
      kind: 'result', value: 'rejected',
    })
    expect(pending.resolve).toHaveBeenCalledTimes(1)
    expect(pending.reject).not.toHaveBeenCalled()
    first.socket.close()
    second.socket.close()
    await unregister()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('rejects the Host waterfall with the first Client listener rejection', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { ctx } = await setup(true)
    /**
     * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const source = new RemoteEventSourceProbe()
    /**
     * 常量说明：unregister 用于处理 unregister 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const unregister = ctx.typertGateway.registerRemoteEvents(source.source, REMOTE_HOST)
    /**
     * 常量说明：agent 用于处理 agent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const agent = ctx.extend()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：candidate（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(candidate)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：id（由 TypeScript
     * 根据调用位置推断的类型）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(id)，并按返回类型处理结果。
     */
    ctx.typert.contexts.registerHost('agent', {
      wire: 'agentId',
      wireTypeSymbol: '@fixture#AgentId',
      identity: candidate => candidate === agent ? agentId('agent-rejected') : undefined,
      resolve: id => id === 'agent-rejected' ? agent : undefined,
    })
    /**
     * 常量说明：client 用于处理 client 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const client = await openEventClient(ctx, 'events-rejected')
    /**
     * 常量说明：pending 用于处理 pending 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const pending = pendingInvocation(agent)
    source.push(pending.dispatch)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => { expect(deliveredInvocation(client)).toBeDefined() })
    /**
     * 常量说明：frame 用于处理 frame 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const frame = deliveredInvocation(client)!
    /**
     * 常量说明：rejected 用于处理 rejected 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const rejected = expect(pending.outcome).rejects.toMatchObject({
      name: 'UserQuestionError',
      message: 'the user cancelled ask_user_question',
      code: 'ASK_CANCELLED',
      details: { questionId: 'question-1' },
    })

    await sendEventResult(client, frame, {
      kind: 'rejected',
      error: {
        name: 'UserQuestionError',
        message: 'the user cancelled ask_user_question',
        code: 'ASK_CANCELLED',
        details: { questionId: 'question-1' },
      },
    })
    await rejected
    expect(pending.reject).toHaveBeenCalledTimes(1)
    expect(pending.resolve).not.toHaveBeenCalled()

    client.socket.close()
    await unregister()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('delegates to the Host only after every active Client returns next', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { ctx } = await setup(true)
    /**
     * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const source = new RemoteEventSourceProbe()
    /**
     * 常量说明：unregister 用于处理 unregister 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const unregister = ctx.typertGateway.registerRemoteEvents(source.source, REMOTE_HOST)
    /**
     * 常量说明：agent 用于处理 agent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const agent = ctx.extend()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：candidate（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(candidate)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：id（由 TypeScript
     * 根据调用位置推断的类型）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(id)，并按返回类型处理结果。
     */
    ctx.typert.contexts.registerHost('agent', {
      wire: 'agentId',
      wireTypeSymbol: '@fixture#AgentId',
      identity: candidate => candidate === agent ? agentId('agent-1') : undefined,
      resolve: id => id === 'agent-1' ? agent : undefined,
    })
    /**
     * 常量说明：first 用于处理 first 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const first = await openEventClient(ctx, 'events-next-a')
    /**
     * 常量说明：second 用于处理 second 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const second = await openEventClient(ctx, 'events-next-b')
    /**
     * 常量说明：pending 用于处理 pending 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const pending = pendingInvocation(agent)
    source.push(pending.dispatch)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => {
      expect(deliveredInvocation(first)).toBeDefined()
      expect(deliveredInvocation(second)).toBeDefined()
    })
    /**
     * 常量说明：firstFrame 用于处理 firstFrame 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const firstFrame = deliveredInvocation(first)!
    /**
     * 常量说明：secondFrame 用于处理 secondFrame 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const secondFrame = deliveredInvocation(second)!

    await sendEventResult(first, firstFrame, { kind: 'next' })
    expect(pending.resolve).not.toHaveBeenCalled()
    await sendEventResult(second, secondFrame, { kind: 'next' })
    await expect(pending.outcome).resolves.toEqual({ kind: 'next' })
    expect(pending.resolve).toHaveBeenCalledTimes(1)
    expect(pending.reject).not.toHaveBeenCalled()
    first.socket.close()
    second.socket.close()
    await unregister()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('delivers a pending waterfall to the first Client that connects', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { ctx } = await setup(true)
    /**
     * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const source = new RemoteEventSourceProbe()
    /**
     * 常量说明：unregister 用于处理 unregister 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const unregister = ctx.typertGateway.registerRemoteEvents(source.source, REMOTE_HOST)
    /**
     * 常量说明：agent 用于处理 agent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const agent = ctx.extend()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：candidate（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(candidate)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：id（由 TypeScript
     * 根据调用位置推断的类型）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(id)，并按返回类型处理结果。
     */
    ctx.typert.contexts.registerHost('agent', {
      wire: 'agentId',
      wireTypeSymbol: '@fixture#AgentId',
      identity: candidate => candidate === agent ? agentId('agent-late-client') : undefined,
      resolve: id => id === 'agent-late-client' ? agent : undefined,
    })
    /**
     * 常量说明：pending 用于处理 pending 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const pending = pendingInvocation(agent, undefined, 'before-connect')

    source.push(pending.dispatch)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => { expect(randomUuid).toHaveBeenCalledTimes(1) })

    /**
     * 常量说明：client 用于处理 client 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const client = await openEventClient(ctx, 'events-first-client')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => { expect(deliveredInvocation(client)).toBeDefined() })
    /**
     * 常量说明：frame 用于处理 frame 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const frame = deliveredInvocation(client)!
    expect(frame).toMatchObject({
      type: 'waterfall',
      event: 'fixture/approval',
      agentId: 'agent-late-client',
      request: { prompt: 'before-connect' },
    })

    await sendEventResult(client, frame, { kind: 'result', value: 'allowed' })
    await expect(pending.outcome).resolves.toEqual({ kind: 'result', value: 'allowed' })

    client.socket.close()
    await unregister()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('replays a pending event id to a replacement Client generation', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { ctx } = await setup(true)
    /**
     * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const source = new RemoteEventSourceProbe()
    /**
     * 常量说明：unregister 用于处理 unregister 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const unregister = ctx.typertGateway.registerRemoteEvents(source.source, REMOTE_HOST)
    /**
     * 常量说明：agent 用于处理 agent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const agent = ctx.extend()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：candidate（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(candidate)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：id（由 TypeScript
     * 根据调用位置推断的类型）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(id)，并按返回类型处理结果。
     */
    ctx.typert.contexts.registerHost('agent', {
      wire: 'agentId',
      wireTypeSymbol: '@fixture#AgentId',
      identity: candidate => candidate === agent ? agentId('agent-1') : undefined,
      resolve: id => id === 'agent-1' ? agent : undefined,
    })
    /**
     * 常量说明：original 用于处理 original 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const original = await openEventClient(ctx, 'events-original')
    /**
     * 常量说明：pending 用于处理 pending 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const pending = pendingInvocation(agent)
    source.push(pending.dispatch)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => { expect(deliveredInvocation(original)).toBeDefined() })
    /**
     * 常量说明：originalFrame 用于处理 originalFrame 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const originalFrame = deliveredInvocation(original)!
    /**
     * 常量说明：closed 用于处理 closed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const closed = once(original.socket, 'close')
    original.socket.close()
    await closed

    /**
     * 常量说明：replacement 用于处理 replacement 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const replacement = await openEventClient(ctx, 'events-replacement')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => { expect(deliveredInvocation(replacement)).toBeDefined() })
    /**
     * 常量说明：replayed 用于处理 replayed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const replayed = deliveredInvocation(replacement)!
    expect(replayed.eventId).toBe(originalFrame.eventId)
    expect(replayed).not.toHaveProperty('deliveryId')
    await sendEventResult(replacement, replayed, {
      kind: 'result', value: 'allowed',
    })
    await expect(pending.outcome).resolves.toEqual({ kind: 'result', value: 'allowed' })

    replacement.socket.close()
    await unregister()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('cancels pending deliveries when the Host signal or Context ends', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { ctx } = await setup(true)
    /**
     * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const source = new RemoteEventSourceProbe()
    /**
     * 常量说明：unregister 用于处理 unregister 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const unregister = ctx.typertGateway.registerRemoteEvents(source.source, REMOTE_HOST)
    /**
     * 常量说明：signalAgent 用于处理 signalAgent 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const signalAgent = ctx.extend()
    /**
     * 常量说明：contextFiber 用于处理 contextFiber 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const contextFiber = ctx.plugin(() => {})
    await contextFiber
    /**
     * 常量说明：contextAgent 用于处理 contextAgent 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const contextAgent = contextFiber.ctx
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：candidate（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(candidate)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：id（由 TypeScript
     * 根据调用位置推断的类型）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(id)，并按返回类型处理结果。
     */
    ctx.typert.contexts.registerHost('agent', {
      wire: 'agentId',
      wireTypeSymbol: '@fixture#AgentId',
      identity: (candidate) => {
        if (candidate === signalAgent) return agentId('agent-signal')
        if (candidate === contextAgent) return agentId('agent-context')
        return undefined
      },
      resolve: (id) => {
        if (id === 'agent-signal') return signalAgent
        if (id === 'agent-context') return contextAgent
        return undefined
      },
    })
    /**
     * 常量说明：client 用于处理 client 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const client = await openEventClient(ctx, 'events-cancel')

    /**
     * 常量说明：abort 用于处理 abort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const abort = new AbortController()
    /**
     * 常量说明：signalPending 用于处理 signalPending 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const signalPending = pendingInvocation(signalAgent, abort.signal, 'signal')
    source.push(signalPending.dispatch)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => { expect(deliveredInvocation(client)).toBeDefined() })
    /**
     * 常量说明：signalFrame 用于处理 signalFrame 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const signalFrame = deliveredInvocation(client)!
    expect(signalFrame).toMatchObject({
      type: 'waterfall',
      agentId: 'agent-signal',
      request: { prompt: 'signal' },
    })
    /**
     * 常量说明：signalReason 用于处理 signalReason 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const signalReason = new Error('Host caller cancelled')
    /**
     * 常量说明：signalOutcome 用于处理 signalOutcome 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const signalOutcome = expect(signalPending.outcome).rejects.toBe(signalReason)
    abort.abort(signalReason)
    await signalOutcome
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => {
      expect(client.frames).toContainEqual({
        type: 'item',
        streamId: client.streamId,
        value: { type: 'cancel', eventId: signalFrame.eventId },
      })
    })

    /**
     * 常量说明：contextPending 用于处理 contextPending 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const contextPending = pendingInvocation(contextAgent, undefined, 'context')
    source.push(contextPending.dispatch)
    /**
     * 变量说明：contextFrame 用于处理 contextFrame 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let contextFrame: RemoteEventInvocationFrame | undefined
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => {
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：frame（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(frame)，并按返回类型处理结果。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：frame（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(frame)，并按返回类型处理结果。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(value)，并按返回类型处理结果。
       */
      contextFrame = client.frames
        .filter(frame => frame.type === 'item' && frame.streamId === client.streamId)
        .map(frame => frame.value)
        .find(value => typeof value === 'object'
          && value !== null
          && Reflect.get(value, 'event') === 'fixture/approval'
          && Reflect.get(value, 'eventId') !== signalFrame.eventId) as RemoteEventInvocationFrame | undefined
      expect(contextFrame).toBeDefined()
    })
    /**
     * 常量说明：contextOutcome 用于处理 contextOutcome 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const contextOutcome = expect(contextPending.outcome).rejects.toThrow('Context "agent" was released')
    await contextFiber.dispose()
    await contextOutcome
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => {
      expect(client.frames).toContainEqual({
        type: 'item',
        streamId: client.streamId,
        value: { type: 'cancel', eventId: contextFrame!.eventId },
      })
    })

    client.socket.close()
    await unregister()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('validates the internal Remote event request and reports an absent source', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { ctx } = await setup(true)
    /**
     * 常量说明：socket 用于处理 socket 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const socket = new WebSocket(`ws://127.0.0.1:${String(ctx.webServer.port)}/api/remote.mux`, {
      headers: { cookie: browserCookie(ctx) },
    })
    await once(socket, 'open')
    /**
     * 常量说明：frames 用于处理 frames 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const frames: Record<string, unknown>[] = []
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：data（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(data)，并按返回类型处理结果。
     */
    socket.on('message', (data) => { frames.push(JSON.parse(rawText(data)) as Record<string, unknown>) })

    sendOpen(socket, 'missing', '$events', {})
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => {
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：frame（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(frame)，并按返回类型处理结果。
       */
      expect(frames.find(frame => frame.streamId === 'missing')?.type).toBe('error')
      expect(streamErrorMessage(frames, 'missing')).toContain('source is unavailable')
    })

    /**
     * 变量说明：sourceCalls 用于处理 sourceCalls 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let sourceCalls = 0
    /**
     * 常量说明：unregister 用于处理 unregister 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const unregister = ctx.typertGateway.registerRemoteEvents(() => {
      sourceCalls += 1
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：AsyncIterable<never>；调用方应按声明类型处理，
       * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      return (async function *(): AsyncIterable<never> {})()
    }, REMOTE_HOST)
    /**
     * 常量说明：invalidPayloads 用于处理 invalidPayloads 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const invalidPayloads: readonly unknown[] = [
      null,
      [],
      {},
      { other: {} },
      { args: null },
      { args: [] },
      { args: { extra: true } },
    ]
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：payload（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：index（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(payload, index)，
     * 并按返回类型处理结果。
     */
    invalidPayloads.forEach((payload, index) => {
      socket.send(JSON.stringify({
        type: 'open', streamId: `invalid-${String(index)}`, endpoint: '$events', payload,
      }))
    })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => {
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：frame（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(frame)，并按返回类型处理结果。
       */
      expect(frames.filter(frame => String(frame.streamId).startsWith('invalid-'))).toHaveLength(invalidPayloads.length)
    })
    /**
     * 变量说明：index 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const [index] of invalidPayloads.entries()) {
      /**
       * 常量说明：streamId 用于处理 streamId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const streamId = `invalid-${String(index)}`
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：frame（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(frame)，并按返回类型处理结果。
       */
      expect(frames.find(frame => frame.streamId === streamId)?.type).toBe('error')
      expect(streamErrorMessage(frames, streamId)).toContain('requires an empty args object')
    }
    expect(sourceCalls).toBe(1)

    await unregister()
    socket.close()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
  * 功能说明：处理 abort 相关流程；使用场景由所在模块及调用位置决定。
  * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
  * @example 在完成前置校验后调用 abort()，并按返回类型处理结果。
  */
  it('applies Connection trusted-host policy before accepting the Gateway socket', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { ctx } = await setup(true)
    /**
     * 常量说明：socket 用于处理 socket 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const socket = new WebSocket(
      `ws://127.0.0.1:${String(ctx.webServer.port)}/api/remote.mux`,
      { headers: { host: 'untrusted.example' } },
    )
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    socket.on('error', () => {})
    /**
     * 常量说明：responseEvent 用于处理 responseEvent 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const responseEvent: unknown[] = await once(socket, 'unexpected-response')
    /**
     * 常量说明：request 用于处理 request 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const request = responseEvent[0]
    /**
     * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const response = responseEvent[1]
    /**
     * 常量说明：rejected 用于处理 rejected 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 resume 相关流程；使用场景由所在模块及调用位置决定。
     * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 resume()，并按返回类型处理结果。
     */
    const rejected = response as { statusCode?: number; resume(): void }
    expect(rejected.statusCode).toBe(403)
    rejected.resume()
    ;(request as { abort(): void }).abort()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
  * 功能说明：处理 abort 相关流程；使用场景由所在模块及调用位置决定。
  * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
  * @example 在完成前置校验后调用 abort()，并按返回类型处理结果。
  */
  it('answers an unauthenticated trusted Host with 401 before opening a stream', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { ctx } = await setup(true)
    /**
     * 常量说明：socket 用于处理 socket 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const socket = new WebSocket(`ws://127.0.0.1:${String(ctx.webServer.port)}/api/remote.mux`)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    socket.on('error', () => {})
    /**
     * 常量说明：responseEvent 用于处理 responseEvent 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const responseEvent: unknown[] = await once(socket, 'unexpected-response')
    /**
     * 常量说明：request 用于处理 request 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const request = responseEvent[0]
    /**
     * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const response = responseEvent[1]
    /**
     * 常量说明：rejected 用于处理 rejected 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 resume 相关流程；使用场景由所在模块及调用位置决定。
     * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 resume()，并按返回类型处理结果。
     */
    const rejected = response as { statusCode?: number; resume(): void }
    expect(rejected.statusCode).toBe(401)
    rejected.resume()
    ;(request as { abort(): void }).abort()
  })
})

/**
 * 功能说明：处理 setup 相关流程；使用场景由所在模块及调用位置决定。
 * @param transport （boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param gatewayConfig （GatewayConfig）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。
 * @returns Promise<{ readonly ctx: Context; readonly service: FeedService
 * }>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 setup(transport, gatewayConfig)，并按返回类型处理结果。
 */
async function setup(
  transport: boolean,
  gatewayConfig: GatewayConfig = {},
): Promise<{ readonly ctx: Context; readonly service: FeedService }> {
  /**
   * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const ctx = new Context()
  roots.push(ctx)
  if (transport) {
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    provideBrowserCredentials(ctx)
  }
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(TypertGatewayService, gatewayConfig)
  if (transport) {
    await ctx.plugin({ inject: [...connectionInject], apply: applyConnection })
  }
  await ctx.plugin(FeedService)
  ctx.typert.register({
    package: '@fixture/feed',
    face: 'host',
    schemas: [],
    model: { services: [], events: [], objects: [] },
    invocations: descriptors(),
  })
  /**
   * 常量说明：receiver 用于处理 receiver 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const receiver = ctx.get('feed') as unknown as FeedService & { [symbols.original]?: FeedService }
  return { ctx, service: receiver[symbols.original] ?? receiver }
}

/**
 * 功能说明：处理 descriptors 相关流程；使用场景由所在模块及调用位置决定。
 * @returns InvocationDescriptor[]；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 descriptors()，并按返回类型处理结果。
 */
function descriptors(): InvocationDescriptor[] {
  /**
   * 常量说明：label 用于处理 label 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const label = {
    name: 'label',
    wire: 'label',
    source: 'json' as const,
    codec: { mode: 'strict' as const, typeSymbol: '@fixture/feed#Label', schema: z.string() },
  }
  /**
   * 常量说明：stream 用于处理 stream 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 stream 相关流程；使用场景由所在模块及调用位置决定。
   * @param method （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param parameters （InvocationDescriptor['parameters']）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @param schema （z.ZodType）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns InvocationDescriptor；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 stream(method, parameters, schema)，并按返回类型处理结果。
   */
  const stream = (method: string, parameters: InvocationDescriptor['parameters'], schema: z.ZodType): InvocationDescriptor => ({
    id: `@fixture/feed#feed/${method}`,
    service: 'feed',
    namespace: 'feed',
    method,
    mode: 'stream',
    invocation: { kind: 'direct' },
    parameters,
    result: { mode: 'strict', typeSymbol: '@fixture/feed#Item', schema },
  })
  return [
    { ...stream('follow', [label], z.string()), cancellation: { parameter: 'signal' } },
    stream('sync', [label], z.string()),
    stream('invalid', [], z.string()),
    stream('nonJson', [], z.unknown()),
    stream('missing', [], z.string()),
    { ...stream('abortBeforeOpen', [], z.string()), cancellation: { parameter: 'signal' } },
    stream('reject', [], z.string()),
    stream('rejectWithNonJsonDetails', [], z.string()),
    {
      id: '@fixture/feed#feed/unary',
      service: 'feed',
      namespace: 'feed',
      method: 'unary',
      invocation: { kind: 'direct' },
      parameters: [label],
      result: { mode: 'strict', typeSymbol: '@fixture/feed#Item', schema: z.string() },
    },
  ]
}

interface RemoteEventTestClient {
  readonly socket: WebSocket
  readonly frames: Record<string, unknown>[]
  readonly streamId: string
  readonly clientId: RemoteEventClientId
  readonly origin: string
  readonly cookie: string
}

/**
 * 功能说明：打开 Event Client 相关流程；使用场景由所在模块及调用位置决定。
 * @param ctx （Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。
 * @param streamId （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Promise<RemoteEventTestClient>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 openEventClient(ctx, streamId)，并按返回类型处理结果。
 */
async function openEventClient(ctx: Context, streamId: string): Promise<RemoteEventTestClient> {
  /**
   * 常量说明：origin 用于处理 origin 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const origin = `http://127.0.0.1:${String(ctx.webServer.port)}`
  /**
   * 常量说明：cookie 用于处理 cookie 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const cookie = browserCookie(ctx)
  /**
   * 常量说明：socket 用于处理 socket 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const socket = new WebSocket(`${origin.replace('http:', 'ws:')}/api/remote.mux`, {
    headers: { cookie },
  })
  await once(socket, 'open')
  /**
   * 常量说明：frames 用于处理 frames 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const frames: Record<string, unknown>[] = []
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：data（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(data)，并按返回类型处理结果。
   */
  socket.on('message', (data) => { frames.push(JSON.parse(rawText(data)) as Record<string, unknown>) })
  sendOpen(socket, streamId, '$events', {})
  /**
   * 变量说明：clientId 用于处理 clientId 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let clientId: RemoteEventClientId | undefined
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  await vi.waitFor(() => {
    /**
     * 常量说明：ready 用于处理 ready 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：frame（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(frame)，并按返回类型处理结果。
     */
    const ready = frames.find(frame => frame.type === 'item'
      && frame.streamId === streamId
      && typeof frame.value === 'object'
      && frame.value !== null
      && Reflect.get(frame.value, 'type') === 'ready')
    /**
     * 常量说明：candidate 用于处理 candidate 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const candidate: unknown = ready === undefined ? undefined : Reflect.get(ready.value as object, 'clientId')
    expect(typeof candidate).toBe('string')
    if (typeof candidate === 'string') clientId = candidate as RemoteEventClientId
  })
  if (clientId === undefined) throw new Error('Remote event stream omitted its Client id')
  return { socket, frames, streamId, clientId, origin, cookie }
}

/**
 * 功能说明：处理 deliveredInvocation 相关流程；使用场景由所在模块及调用位置决定。
 * @param client （RemoteEventTestClient）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns RemoteEventInvocationFrame | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 deliveredInvocation(client)，并按返回类型处理结果。
 */
function deliveredInvocation(client: RemoteEventTestClient): RemoteEventInvocationFrame | undefined {
  /**
   * 变量说明：frame 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const frame of client.frames) {
    if (frame.type !== 'item' || frame.streamId !== client.streamId) continue
    /**
     * 常量说明：value 用于处理 value 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const value = frame.value
    if (typeof value !== 'object' || value === null || !Object.hasOwn(value, 'eventId')) continue
    return value as RemoteEventInvocationFrame
  }
  return undefined
}

/**
 * 功能说明：处理 sendEventResult 相关流程；使用场景由所在模块及调用位置决定。
 * @param client （RemoteEventTestClient）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param frame （RemoteEventInvocationFrame）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param outcome （| { readonly kind: 'next' } | { readonly kind: 'result';
 * re…）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 sendEventResult(client, frame, outcome)，并按返回类型处理结果。
 */
async function sendEventResult(
  client: RemoteEventTestClient,
  frame: RemoteEventInvocationFrame,
  outcome:
    | { readonly kind: 'next' }
    | { readonly kind: 'result'; readonly value?: unknown }
    | {
      readonly kind: 'rejected'
      readonly error: {
        readonly name: string
        readonly message: string
        readonly code?: string
        readonly details?: unknown
      }
    },
): Promise<void> {
  /**
   * 常量说明：rpcId 用于处理 rpcId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const rpcId = `remote-event-result-${client.streamId}`
  /**
   * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const response = await fetch(`${client.origin}/api/$events/result`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: client.cookie },
    body: JSON.stringify({
      type: 'client-request',
      rpcId,
      method: '$events/result',
      payload: {
        args: { clientId: client.clientId, eventId: frame.eventId, outcome },
      },
    }),
  })
  expect(response.status).toBe(200)
  /**
   * 常量说明：body 用于处理 body 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const body = await response.json() as { readonly result?: { readonly ok?: boolean; readonly error?: { message?: string } } }
  if (body.result?.ok !== true) {
    throw new Error(body.result?.error?.message ?? 'Remote event result failed')
  }
}

/**
 * 功能说明：处理 sendOpen 相关流程；使用场景由所在模块及调用位置决定。
 * @param socket （WebSocket）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param streamId （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param endpoint （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param args （object）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 sendOpen(socket, streamId, endpoint, args)，
 * 并按返回类型处理结果。
 */
function sendOpen(socket: WebSocket, streamId: string, endpoint: string, args: object): void {
  socket.send(JSON.stringify({ type: 'open', streamId, endpoint, payload: { args } }))
}

/**
 * 功能说明：处理 rawText 相关流程；使用场景由所在模块及调用位置决定。
 * @param data （RawData）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 rawText(data)，并按返回类型处理结果。
 */
function rawText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8')
  return Buffer.from(data).toString('utf8')
}

/**
 * 功能说明：处理 streamErrorMessage 相关流程；使用场景由所在模块及调用位置决定。
 * @param frames （readonly Record<string, unknown>[]）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @param streamId （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 streamErrorMessage(frames, streamId)，并按返回类型处理结果。
 */
function streamErrorMessage(frames: readonly Record<string, unknown>[], streamId: string): string | undefined {
  /**
   * 常量说明：error 用于处理 error 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：frame（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(frame)，并按返回类型处理结果。
   */
  const error = frames.find(frame => frame.streamId === streamId)?.error
  if (typeof error !== 'object' || error === null) return undefined
  /**
   * 常量说明：message 用于处理 message 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const message = Reflect.get(error, 'message') as unknown
  return typeof message === 'string' ? message : undefined
}

/**
 * 功能说明：收集 collect 相关流程；使用场景由所在模块及调用位置决定。
 * @param source （AsyncIterable<unknown>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Promise<unknown[]>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 collect(source)，并按返回类型处理结果。
 */
async function collect(source: AsyncIterable<unknown>): Promise<unknown[]> {
  /**
   * 常量说明：values 用于处理 values 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const values: unknown[] = []
  /**
   * 变量说明：value 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for await (const value of source) values.push(value)
  return values
}
