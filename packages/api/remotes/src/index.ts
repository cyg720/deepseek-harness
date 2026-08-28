/*
 * ================================ 文件注释 ================================
 * 【文件职责】dsh-api-remotes 的 Host 面入口与装配壳：把 Agent/Session 解析
 * 相关函数（agent-lookup.ts）、转发事件白名单（remote-events.ts）及其类型
 * 投影（types.ts）统一导出，并对白名单做编译期"形状门"校验。
 * 【技术维度】聚合导出（re-export）+ 一个 satisfies 断言：通过导入各属主
 * 包的客户端安全 ./types 声明，把真实 Events 词汇引入本编译面，使
 * TypertForwardableEvent 形状断言能校验真实签名而不是空事件词汇表。
 * 【产品维度】作为 Host 侧装配点，业务方只需 import 本入口即可获得远程
 * 组装所需的全部符号；白名单的形状校验把"转发非法事件"从线上提前到编译期。
 * 【逻辑维度】按出现顺序：事件词汇导入（type-only）→ agent-lookup 导出 →
 * 白名单值/类型导出 → 白名单形状门（satisfies 断言）→ 空 apply 插件体。
 * 【关键边界】本文件是 Host 面：实际贡献集的挂载只发生在 Client 环境
 * （见 client/index.ts），apply 是空实现；白名单的增删必须同步满足形状
 * 门的三项约束（事件已声明 / 不绑定 Scope / 单向）。
 * 【新手阅读建议】先看 remote-events.ts 的白名单，再看文件尾部的 satisfies
 * 断言理解三项静态约束，最后对照 client/index.ts 理解 Host 与 Client 分工。
 * ==========================================================================
 */
/** Host BFF entry and Loader shell for the Remote contribution assembly. */
// 英文模块注释的中文解释：本文件是 Host BFF 的入口与"远程贡献装配"的
// Loader 壳：负责聚合导出与白名单的形状校验。

import { homedir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import type {
  TypertRemoteEventDispatch,
  TypertRemoteEventInvocation,
  TypertRemoteEventOutcome,
  TypertRemoteEventSource,
} from '@deepseek-ai/dsh-api-gateway'
import { carrierKeyOf } from '@deepseek-ai/dsh-scope'
import { isJsonValue } from '@deepseek-ai/dsh-session'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import { API_REMOTE_FORWARDED_EVENTS } from './remote-events.ts'

// The owner packages' client-safe `./types` exports carry the cordis `Events`
// declarations for every allowlisted event. Pulling them into this face is what
// makes the shape assertion below judge real signatures rather than an empty
// event vocabulary.
// 中文：各属主包的客户端安全 ./types 导出携带了白名单每个事件的 cordis
// Events 声明；把这些声明引入本编译面，形状断言才能用真实签名做判断，
// 而不是对着空的事件词汇表做无意义检查。
import type {} from '@deepseek-ai/dsh-commands/types'
import type {} from '@deepseek-ai/dsh-cordis-host-runner/types'
import type {} from '@deepseek-ai/dsh-credentials/types'
import type {} from '@deepseek-ai/dsh-llm/types'
import type {} from '@deepseek-ai/dsh-agent-presets/types'
import type {} from '@deepseek-ai/dsh-settings/types'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-user-questions'
export type {} from '@deepseek-ai/dsh-api-session-controller/types'

export { API_REMOTE_FORWARDED_EVENTS } from './remote-events.ts'
export type { ApiRemoteForwardedEvent } from './types.ts'

/** Required Host service: the Gateway owns the physical Remote stream mux. */
export const inject = ['typertGateway']

/** Host plugin body registering this application's selected Cordis event source. */
export function apply(ctx: Context): void {
  ctx.effect(
    () => ctx.typertGateway.registerRemoteEvents(remoteEventSource(ctx), { home: homedir() }),
    'api-remotes: forwarded Cordis event source',
  )
}

/** Create the sole queue and listener set consumed by the registered Gateway. */
function remoteEventSource(ctx: Context): TypertRemoteEventSource {
  return (signal) => {
    const queue = new RemoteEventQueue()
    const disposers = API_REMOTE_FORWARDED_EVENTS.map(({ event, mode }) => {
      if (mode === 'emit') {
        return ctx.on(event as never, ((...args: unknown[]) => {
          queue.push({ event, args: assertJsonArgs(event, args) })
        }) as never)
      }
      return ctx.on(event as never, (function (
        this: unknown,
        request: object,
        next: () => unknown,
      ) {
        const subject = carrierKeyOf(this)
        if (subject === undefined) return next()
        const value = Reflect.get(subject, 'ctx') as unknown
        if (typeof value !== 'object' || value === null) {
          throw new TypeError(`forwarded scoped event ${JSON.stringify(event)} has no live Context`)
        }
        return forwardWaterfall(
          queue,
          event,
          request,
          { value: value as Context, subject },
          next,
        )
      }) as never)
    })
    return queue.iterate(signal, () => {
      for (const dispose of disposers) dispose()
    })
  }
}

/** One pull-driven queue bridging synchronous Cordis listeners to an AsyncIterable. */
class RemoteEventQueue {
  private readonly buffer: TypertRemoteEventDispatch[] = []
  private waiter: (() => void) | undefined
  private done = false

  push(frame: TypertRemoteEventDispatch): boolean {
    if (this.done) return false
    this.buffer.push(frame)
    this.waiter?.()
    return true
  }

  private end(reason: unknown): void {
    if (this.done) return
    this.done = true
    const buffered = this.buffer.splice(0)
    for (const dispatch of buffered) {
      if ('context' in dispatch) dispatch.reject(reason)
    }
    this.waiter?.()
  }

  async *iterate(signal: AbortSignal, cleanup: () => void): AsyncGenerator<TypertRemoteEventDispatch> {
    const abort = (): void => { this.end(remoteEventSourceEndReason(signal)) }
    signal.addEventListener('abort', abort, { once: true })
    try {
      while (true) {
        if (this.done || signal.aborted) return
        while (this.buffer.length > 0) yield this.buffer.shift() as TypertRemoteEventDispatch
        await new Promise<void>((resolve) => { this.waiter = resolve })
        this.waiter = undefined
      }
    } finally {
      signal.removeEventListener('abort', abort)
      this.end(remoteEventSourceEndReason(signal))
      cleanup()
    }
  }
}

/**
 * Normalize an event-source shutdown for pending Host waterfalls.
 * @param signal - source lifetime whose reason wins after cancellation.
 * @returns the cancellation reason or an unexpected-end failure.
 */
function remoteEventSourceEndReason(signal: AbortSignal): unknown {
  if (signal.aborted) return signal.reason
  return new Error('api-remotes: forwarded Remote event source ended')
}

/** Bridge one Cordis waterfall listener through the Gateway-owned pending event. */
function forwardWaterfall(
  queue: RemoteEventQueue,
  event: string,
  request: object,
  context: TypertRemoteEventInvocation['context'],
  next: () => unknown,
): Promise<unknown> {
  const settled = Promise.withResolvers<unknown>()
  const dispatch: TypertRemoteEventInvocation = {
    event,
    request,
    context,
    resolve: (outcome: TypertRemoteEventOutcome) => {
      if (outcome.kind === 'result') {
        settled.resolve(outcome.value)
        return
      }
      void Promise.resolve().then(next).then(settled.resolve, settled.reject)
    },
    reject: settled.reject,
  }
  if (!queue.push(dispatch)) void Promise.resolve().then(next).then(settled.resolve, settled.reject)
  return settled.promise
}

/** Reject an allowlisted event whose runtime arguments are not lossless JSON data. */
function assertJsonArgs(event: string, args: readonly unknown[]): JsonValue[] {
  for (const [index, arg] of args.entries()) {
    if (!isJsonValue(arg)) {
      throw new Error(`forwarded host event "${event}" argument ${String(index)} is not lossless JSON data`)
    }
  }
  return args as JsonValue[]
}
