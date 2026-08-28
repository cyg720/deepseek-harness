/** Client owner for forwarded Remote Event subscriptions and deliveries.
 * @remarks 文件说明：文件职责：实现 api/gateway 中 remote events 模块的职责，并向相邻模块提供可复用能力。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的 api/gateway 能力，
 * 使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import type { Context } from '@deepseek-ai/cordis'
import type {
  ConnectionGenerationSource,
  ConnectionHostInfo,
  ConnectionHandle,
} from '@deepseek-ai/dsh-client-connection/client'
import type {
  TypertClientEventListener,
  TypertRemoteEvent,
} from '@deepseek-ai/dsh-typert-protocol'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import {
  REMOTE_EVENT_RESULT_ENDPOINT,
  REMOTE_EVENT_STREAM_ENDPOINT,
  REMOTE_EVENT_STREAM_PAYLOAD,
  isRemoteEventAgentId,
  isRemoteEventClientId,
  isRemoteEventId,
  isRemoteJsonValue,
  projectRemoteEventRejection,
  type RemoteEventClientId,
  type RemoteEventDownlinkFrame,
  type RemoteEventEmitFrame,
  type RemoteEventInvocationFrame,
  type RemoteEventResult,
} from '../stream-protocol.ts'

/** Open the Gateway-internal forwarded-event stream on the selected carrier. */
export type RemoteEventStreamOpener = (
  endpoint: string,
  payload: unknown,
  signal: AbortSignal,
) => AsyncIterable<unknown>

/** One subscribed listener after its event-specific signature is erased. */
type RemoteEventListener = (this: Context, ...args: unknown[]) => unknown

/** Untyped access used only for instance-private Cordis event keys. */
interface PrivateEventContext {
  /**
   * 功能说明：响应 on 相关流程；使用场景由所在模块及调用位置决定。
   * @param name （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param listener （RemoteEventListener）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。
   * @returns () => boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 on(name, listener)，并按返回类型处理结果。
   */
  on(name: string, listener: RemoteEventListener): () => boolean
  /**
   * 功能说明：处理 parallel 相关流程；使用场景由所在模块及调用位置决定。
   * @param name （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param args （unknown[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 parallel(name, args)，并按返回类型处理结果。
   */
  parallel(name: string, ...args: unknown[]): Promise<void>
  /**
   * 功能说明：处理 waterfall 相关流程；使用场景由所在模块及调用位置决定。
   * @param thisArg （Context）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param name （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param request （Readonly<Record<string, unknown>>）：提供调用方提交的请求信息；
   * 必须满足声明的类型及调用时序要求。
   * @param next （() => Promise<symbol>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns unknown；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 waterfall(thisArg, name, request, next)，并按返回类型处理结果。
   */
  waterfall(
    thisArg: Context,
    name: string,
    request: Readonly<Record<string, unknown>>,
    next: () => Promise<symbol>,
  ): unknown
}

/** Transport outcome after one Client listener chain either claims or delegates. */
type RemoteEventReplyOutcome =
  | { readonly kind: 'result'; readonly value: unknown }
  | { readonly kind: 'next' }
  | { readonly kind: 'rejected'; readonly error: ReturnType<typeof projectRemoteEventRejection> }

/** Private end-of-chain marker that cannot collide with a JSON listener result.
 * @remarks 中文说明：常量说明：REMOTE_EVENT_NEXT 用于处理 REMOTE_EVENT_NEXT 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
const REMOTE_EVENT_NEXT = Symbol('api-gateway.remote-event.next')

/** Own Cordis registrations, generation pumping, waterfall dispatch, and HTTP replies.
 * @remarks 中文说明：类说明：ClientRemoteEvents 用于集中封装 处理 ClientRemoteEvents
 * 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由 api/gateway
 * 在对应插件或业务生命周期内创建和调用。 */
export class ClientRemoteEvents {
  /**
   * 常量说明：eventPrefix 用于处理 eventPrefix 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly eventPrefix = `internal/api-gateway/remote-event/${randomUUID()}/`
  /**
   * 常量说明：unregisterGeneration 用于处理 unregisterGeneration 相关数据，作用于成员；
   * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly unregisterGeneration: () => void
  /**
   * 变量说明：activeGeneration 用于处理 activeGeneration 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private activeGeneration: Promise<void> | undefined

  /**
   * @param ownerCtx - Client Gateway root used for Agent Context resolution.
   * @param connection - Connection carrier used for HTTP result calls.
   * @param openStream - selected in-process or WebSocket stream opener.
   * @remarks 中文说明：功能说明：处理 ClientRemoteEvents 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：ownerCtx（Context）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：connection（ConnectionHandle）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：openStream（RemoteEventStreamOpener）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：通过 new
   * ClientRemoteEvents(ownerCtx, connection, openStream) 创建实例，并在所属生命周期内使用。
   */
  constructor(
    private readonly ownerCtx: Context,
    private readonly connection: ConnectionHandle,
    private readonly openStream: RemoteEventStreamOpener,
  ) {
    this.unregisterGeneration = connection.registerGenerationSource(this.runGeneration)
  }

  /**
   * Register one typed Remote Event listener in its calling fiber.
   * @param callerCtx - fiber Context owning the registration.
   * @param event - selected forwarded event.
   * @param listener - listener derived from that event's declaration.
   * @returns disposer for this exact registration.
   * @remarks 中文说明：功能说明：处理 subscribe 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：callerCtx（Context）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：event（Event）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：listener（TypertClientEventListener<Event>）：接收后续状态或事件并执行调用方逻辑；
   * 必须满足声明的类型及调用时序要求。；返回值：() => void；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 subscribe(callerCtx, event, listener)，并按返回类型处理结果。
   */
  subscribe<Event extends TypertRemoteEvent>(
    callerCtx: Context,
    event: Event,
    listener: TypertClientEventListener<Event>,
  ): () => void {
    /**
     * 常量说明：dispose 用于处理 dispose 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const dispose = privateEvents(callerCtx).on(
      this.eventKey(event),
      listener as unknown as RemoteEventListener,
    )
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    return () => { dispose() }
  }

  /** Withdraw the generation source and wait for active listener work to quiesce.
   * @remarks 中文说明：功能说明：处理 dispose 相关流程；使用场景由所在模块及调用位置决定。；返回值：Promise<void>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 dispose()，并按返回类型处理结果。 */
  async dispose(): Promise<void> {
    this.unregisterGeneration()
    await Promise.allSettled([this.activeGeneration])
  }

  /** Track the current generation so plugin disposal waits for listener work to stop.
   * @remarks 中文说明：常量说明：runGeneration 用于执行 Generation 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。；功能说明：执行 Generation 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：signal（由 TypeScript 根据调用位置推断的类型）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；
   * 参数说明：ready（由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由
   * TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * runGeneration(signal, ready)，并按返回类型处理结果。 */
  private readonly runGeneration: ConnectionGenerationSource = (signal, ready) => {
    /**
     * 常量说明：tracked 用于处理 tracked 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const tracked = this.pumpEvents(signal, ready).finally(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
        if (this.activeGeneration === tracked) this.activeGeneration = undefined
      })
    this.activeGeneration = tracked
    return tracked
  }

  /** Deliver one notification through Cordis while containing listener failures.
   * @remarks 中文说明：功能说明：处理 deliver 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：frame（RemoteEventEmitFrame）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 deliver(frame)，并按返回类型处理结果。 */
  private deliver(frame: RemoteEventEmitFrame): void {
    void privateEvents(this.ownerCtx)
      .parallel(this.eventKey(frame.event), ...frame.args)
      .catch(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（unknown）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 典型用法：在完成前置校验后调用 匿名回调(error)，并按返回类型处理结果。
 */ (error: unknown) => { this.reportError(frame.event, error) })
  }

  /** Run one Connection generation over the forwarded-event logical stream.
   * @remarks 中文说明：功能说明：处理 pumpEvents 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：signal（AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；参数说明：ready（(host:
   * ConnectionHostInfo) => void）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * pumpEvents(signal, ready)，并按返回类型处理结果。 */
  private async pumpEvents(
    signal: AbortSignal,
    ready: (host: ConnectionHostInfo) => void,
  ): Promise<void> {
    /**
     * 变量说明：clientId 用于处理 clientId 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let clientId: RemoteEventClientId | undefined
    /**
     * 常量说明：failed 用于处理 failed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const failed = new AbortController()
    /**
     * 常量说明：generationSignal 用于处理 generationSignal 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const generationSignal = AbortSignal.any([signal, failed.signal])
    /**
     * 常量说明：active 用于处理 active 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const active = new Map<string, AbortController>()
    /**
     * 常量说明：tasks 用于处理 tasks 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const tasks = new Set<Promise<void>>()
    /**
     * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const source = this.openStream(
      REMOTE_EVENT_STREAM_ENDPOINT,
      REMOTE_EVENT_STREAM_PAYLOAD,
      generationSignal,
    )
    /**
     * 变量说明：streamFailed 用于处理 streamFailed 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let streamFailed = false
    /**
     * 变量说明：streamError 用于处理 streamError 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let streamError: unknown
    try {
      for await (const /*
       * 变量说明：value 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */ value of source) {
        if (clientId === undefined) {
          /**
           * 常量说明：opening 用于处理 opening 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
           */
          const opening = parseRemoteEventReady(value)
          clientId = opening.clientId
          ready(opening.host)
          continue
        }
        /**
         * 常量说明：frame 用于处理 frame 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const frame = parseRemoteEventFrame(value)
        if (frame.type === 'cancel') {
          active.get(frame.eventId)?.abort(new Error('client api: Remote event was cancelled by the Host'))
          continue
        }
        if (frame.type === 'emit') {
          this.deliver(frame)
          continue
        }
        /**
         * 常量说明：controller 用于处理 controller 相关数据，作用于当前作用域；初始化后不可重新赋值，
         * 但对象内部是否可变仍由其类型决定。
         */
        const controller = new AbortController()
        active.set(frame.eventId, controller)
        /**
         * 常量说明：deliverySignal 用于处理 deliverySignal 相关数据，作用于当前作用域；初始化后不可重新赋值，
         * 但对象内部是否可变仍由其类型决定。
         */
        const deliverySignal = AbortSignal.any([generationSignal, controller.signal])
        /**
         * 常量说明：task 用于处理 task 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const task = this.answer(frame, clientId, deliverySignal)
          .catch(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（unknown）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 典型用法：在完成前置校验后调用 匿名回调(error)，并按返回类型处理结果。
 */ (error: unknown) => {
              if (!deliverySignal.aborted) failed.abort(error)
            })
          .finally(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
              active.delete(frame.eventId)
              tasks.delete(task)
            })
        tasks.add(task)
      }
    } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error) {
      streamFailed = true
      streamError = error
    } finally {
      for (const /*
       * 变量说明：controller 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */ controller of active.values()) {
        controller.abort(new Error('client api: Remote event generation ended'))
      }
      await Promise.allSettled(tasks)
    }
    if (failed.signal.aborted) {
      throw toError(failed.signal.reason, 'client api: Remote event result delivery failed')
    }
    if (signal.aborted) return
    if (streamFailed) throw streamError
    throw new Error('client api: forwarded Remote event stream ended unexpectedly')
  }

  /**
   * 功能说明：处理 answer 相关流程；使用场景由所在模块及调用位置决定。
   * @param frame （RemoteEventInvocationFrame）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param clientId （RemoteEventClientId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param signal （AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
   * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 answer(frame, clientId, signal)，并按返回类型处理结果。
   */
  private async answer(
    frame: RemoteEventInvocationFrame,
    clientId: RemoteEventClientId,
    signal: AbortSignal,
  ): Promise<void> {
    /**
     * 常量说明：adapter 用于处理 adapter 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const adapter = this.ownerCtx.typert.contexts.getClient('agent')
    /**
     * 变量说明：target 用于处理 target 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let target: Context | undefined
    try {
      target = adapter?.resolve(frame.agentId)
    } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error) {
      this.reportError(frame.event, error)
    }
    /**
     * 变量说明：outcome 用于处理 outcome 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let outcome: RemoteEventReplyOutcome = { kind: 'next' }
    if (target !== undefined) {
      try {
        outcome = await this.dispatchWaterfall(target, frame, signal)
      } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error) {
        if (signal.aborted) return
        outcome = { kind: 'rejected', error: projectRemoteEventRejection(error) }
      }
    }
    if (signal.aborted) return
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result: RemoteEventResult = {
      clientId,
      eventId: frame.eventId,
      outcome: outcome.kind === 'result' && outcome.value === undefined
        ? { kind: 'result' }
        : outcome,
    }
    /**
     * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const response = await this.connection.rpc.call(
      '/api',
      REMOTE_EVENT_RESULT_ENDPOINT,
      { args: result },
      signal,
    )
    if (!response.ok) throw new Error(response.error.message)
  }

  /**
   * 功能说明：分发 Waterfall 相关流程；使用场景由所在模块及调用位置决定。
   * @param target （Context）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param frame （RemoteEventInvocationFrame）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param signal （AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
   * @returns Promise<RemoteEventReplyOutcome>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 dispatchWaterfall(target, frame, signal)，并按返回类型处理结果。
   */
  private async dispatchWaterfall(
    target: Context,
    frame: RemoteEventInvocationFrame,
    signal: AbortSignal,
  ): Promise<RemoteEventReplyOutcome> {
    /**
     * 常量说明：request 用于处理 request 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const request = {
      ...frame.request,
      agent: target,
      signal,
    }
    /**
     * 常量说明：value 用于处理 value 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const value = await abortable(
      Promise.resolve(privateEvents(target).waterfall(
        target,
        this.eventKey(frame.event),
        request,
        /*
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
         */ () => Promise.resolve(REMOTE_EVENT_NEXT),
      )),
      signal,
    )
    if (value !== REMOTE_EVENT_NEXT && value !== undefined && !isRemoteJsonValue(value)) {
      throw new TypeError('Remote event listener result is not lossless JSON data')
    }
    return value === REMOTE_EVENT_NEXT
      ? { kind: 'next' }
      : { kind: 'result', value }
  }

  /**
   * 功能说明：处理 eventKey 相关流程；使用场景由所在模块及调用位置决定。
   * @param event （string）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
   * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 eventKey(event)，并按返回类型处理结果。
   */
  private eventKey(event: string): string {
    return `${this.eventPrefix}${event}`
  }

  /**
   * 功能说明：处理 reportError 相关流程；使用场景由所在模块及调用位置决定。
   * @param event （string）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
   * @param error （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 reportError(event, error)，并按返回类型处理结果。
   */
  private reportError(event: string, error: unknown): void {
    console.error(`client api: Remote event ${JSON.stringify(event)} listener threw:`, error)
  }
}

/** Validate and return one generation's Client identity and Host facts.
 * @remarks 中文说明：功能说明：解析 Remote Event Ready 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：{ readonly
 * clientId: RemoteEventClientId readonly host: ConnectionHos…；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 parseRemoteEventReady(value)，
 * 并按返回类型处理结果。 */
function parseRemoteEventReady(value: unknown): {
  readonly clientId: RemoteEventClientId
  readonly host: ConnectionHostInfo
} {
  if (!isRemoteEventRecord(value)
    || !hasExactRemoteEventKeys(value, ['type', 'clientId', 'host'])
    || value.type !== 'ready'
    || !isRemoteEventClientId(value.clientId)
    || !isRemoteEventRecord(value.host)
    || !hasExactRemoteEventKeys(value.host, ['home'])
    || typeof value.host.home !== 'string') {
    throw new TypeError('client api: forwarded Remote event stream did not begin with ready')
  }
  return { clientId: value.clientId, host: { home: value.host.home } }
}

/** Validate one untrusted value from the Gateway-internal forwarded-event stream.
 * @remarks 中文说明：功能说明：解析 Remote Event Frame 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：Exclude<RemoteEventDownlinkFrame, { type: 'ready' }>；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 parseRemoteEventFrame(value)，
 * 并按返回类型处理结果。 */
function parseRemoteEventFrame(value: unknown): Exclude<RemoteEventDownlinkFrame, { type: 'ready' }> {
  if (!isRemoteEventRecord(value)) invalidRemoteEventFrame()
  if (value.type === 'cancel'
    && hasExactRemoteEventKeys(value, ['type', 'eventId'])
    && isRemoteEventId(value.eventId)) {
    return { type: 'cancel', eventId: value.eventId }
  }
  if (value.type === 'emit'
    && hasExactRemoteEventKeys(value, ['type', 'event', 'args'])
    && validRemoteEventName(value.event)
    && Array.isArray(value.args)
    && isRemoteJsonValue(value.args)) {
    return { type: 'emit', event: value.event, args: value.args }
  }
  if (value.type === 'waterfall'
    && hasExactRemoteEventKeys(value, ['type', 'event', 'eventId', 'agentId', 'request'])
    && validRemoteEventName(value.event)
    && isRemoteEventId(value.eventId)
    && isRemoteEventAgentId(value.agentId)
    && isRemoteEventRecord(value.request)
    && !Object.hasOwn(value.request, 'agent')
    && !Object.hasOwn(value.request, 'signal')
    && isRemoteJsonValue(value.request)) {
    return {
      type: 'waterfall',
      event: value.event,
      eventId: value.eventId,
      agentId: value.agentId,
      request: value.request,
    }
  }
  invalidRemoteEventFrame()
}

/**
 * 功能说明：判断是否为 Remote Event Record 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns value is Record<string, unknown>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 isRemoteEventRecord(value)，并按返回类型处理结果。
 */
function isRemoteEventRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  /**
   * 常量说明：prototype 用于处理 prototype 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * 功能说明：判断是否包含 Exact Remote Event Keys 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （Record<string, unknown>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param keys （readonly string[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 hasExactRemoteEventKeys(value, keys)，并按返回类型处理结果。
 */
function hasExactRemoteEventKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  /**
   * 常量说明：ownKeys 用于处理 ownKeys 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const ownKeys = Reflect.ownKeys(value)
  return ownKeys.length === keys.length && keys.every(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：key（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(key)，并按返回类型处理结果。
 */ key => Object.hasOwn(value, key))
}

/**
 * 功能说明：处理 validRemoteEventName 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns value is string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 validRemoteEventName(value)，并按返回类型处理结果。
 */
function validRemoteEventName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/**
 * 功能说明：处理 invalidRemoteEventFrame 相关流程；使用场景由所在模块及调用位置决定。
 * @returns never；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 invalidRemoteEventFrame()，并按返回类型处理结果。
 */
function invalidRemoteEventFrame(): never {
  throw new TypeError('client api: invalid forwarded Remote event frame')
}

/** Race listener completion against its delivery lifetime.
 * @remarks 中文说明：功能说明：处理 abortable 相关流程；使用场景由所在模块及调用位置决定。；参数说明：value（T |
 * PromiseLike<T>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：signal（AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；返回值：Promise<T>；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 abortable(value, signal)，
 * 并按返回类型处理结果。 */
async function abortable<T>(value: T | PromiseLike<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  /**
   * 变量说明：rejectAbort 用于处理 rejectAbort 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let rejectAbort: ((reason: unknown) => void) | undefined
  /**
   * 常量说明：aborted 用于处理 aborted 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const aborted = new Promise<never>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：reject（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(_resolve, reject)，
 * 并按返回类型处理结果。
 */ (_resolve, reject) => { rejectAbort = reject })
  /**
   * 常量说明：onAbort 用于响应 Abort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：响应 Abort 相关流程；使用场景由所在模块及调用位置决定。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 onAbort()，并按返回类型处理结果。
   */
  const onAbort = (): void => { rejectAbort?.(signal.reason) }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    return await Promise.race([Promise.resolve(value), aborted])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

/**
 * 功能说明：处理 privateEvents 相关流程；使用场景由所在模块及调用位置决定。
 * @param ctx （Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。
 * @returns PrivateEventContext；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 privateEvents(ctx)，并按返回类型处理结果。
 */
function privateEvents(ctx: Context): PrivateEventContext {
  return ctx
}

/**
 * 功能说明：处理 toError 相关流程；使用场景由所在模块及调用位置决定。
 * @param reason （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param message （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Error；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 toError(reason, message)，并按返回类型处理结果。
 */
function toError(reason: unknown, message: string): Error {
  return reason instanceof Error ? reason : new Error(message, { cause: reason })
}
