/** CDP Network projection over the Worker-owned normalized network store.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 session 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import { Buffer } from 'node:buffer'
import type { InspectorHeader } from '../../../../shared/network/observation.ts'
import type { NetworkStore, NetworkStoreEvent } from '../../../inspection/network-store.ts'

/** CDP session slice used by the Network domain. */
export interface NetworkSink {
  /**
   * 功能说明：处理 sendEvent 相关流程；使用场景由所在模块及调用位置决定。
   * @param method （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param params （Readonly<Record<string, unknown>>）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 sendEvent(method, params)，并按返回类型处理结果。
   */
  sendEvent(method: string, params: Readonly<Record<string, unknown>>): void
}

type RequestStartedEvent = Extract<NetworkStoreEvent, { readonly type: 'request-started' }>
type NetworkResourceType = 'EventSource' | 'Fetch'

/** Projects retained and live network observations into connection-local CDP state.
 * @remarks 中文说明：类说明：NetworkDomain 用于集中封装 处理 NetworkDomain 相关状态与行为。；
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由 experimental/inspector
 * 在对应插件或业务生命周期内创建和调用。 */
export class NetworkDomain {
  /**
   * 常量说明：enabled 用于处理 enabled 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly enabled = new Set<NetworkSink>()
  /**
   * 常量说明：streamedRequests 用于处理 streamedRequests 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly streamedRequests = new Map<NetworkSink, Set<string>>()
  /**
   * 常量说明：pendingStarts 用于处理 pendingStarts 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly pendingStarts = new Map<NetworkSink, Map<string, RequestStartedEvent>>()
  /**
   * 常量说明：requestTypes 用于处理 requestTypes 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly requestTypes = new Map<NetworkSink, Map<string, NetworkResourceType>>()
  /**
   * 常量说明：unsubscribe 用于处理 unsubscribe 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly unsubscribe: () => void

  /**
   * 功能说明：处理 NetworkDomain 相关流程；使用场景由所在模块及调用位置决定。
   * @param store （NetworkStore）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new NetworkDomain(store) 创建实例，并在所属生命周期内使用。
   */
  constructor(private readonly store: NetworkStore) {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
     * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
     */
    this.unsubscribe = store.subscribe((event) => { this.receive(event) })
  }

  /**
   * Enable Network for one DevTools connection and replay retained lifecycle events.
   * @param session - Connection receiving replay and subsequent events.
   * @remarks 中文说明：功能说明：处理 enable 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：session（NetworkSink）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 enable(session)，
   * 并按返回类型处理结果。
   */
  enable(session: NetworkSink): void {
    if (this.enabled.has(session)) return
    this.enabled.add(session)
    this.pendingStarts.set(session, new Map())
    this.requestTypes.set(session, new Map())
    /**
     * 变量说明：event 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const event of this.store.replay()) this.send(session, event)
  }

  /**
   * Stop Network events for one DevTools connection.
   * @param session - Connection leaving the enabled set.
   * @remarks 中文说明：功能说明：处理 disable 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：session（NetworkSink）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 disable(session)，
   * 并按返回类型处理结果。
   */
  disable(session: NetworkSink): void {
    this.enabled.delete(session)
    this.streamedRequests.delete(session)
    this.pendingStarts.delete(session)
    this.requestTypes.delete(session)
  }

  /**
   * Forget a closed DevTools connection.
   * @param session - Closed DevTools connection.
   * @remarks 中文说明：功能说明：处理 detach 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：session（NetworkSink）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 detach(session)，
   * 并按返回类型处理结果。
   */
  detach(session: NetworkSink): void {
    this.disable(session)
  }

  /** Release the repository subscription and all connection-local state.
   * @remarks 中文说明：功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 close()，并按返回类型处理结果。 */
  close(): void {
    this.unsubscribe()
    this.enabled.clear()
    this.streamedRequests.clear()
    this.pendingStarts.clear()
    this.requestTypes.clear()
  }

  /**
   * Handle one Worker-local Network method.
   * @param method - CDP method name.
   * @param params - Parsed request parameters.
   * @param session - Calling DevTools connection.
   * @returns The CDP result fields.
   * @remarks 中文说明：功能说明：处理 handle 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：method（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：params（Readonly<Record<string, unknown>>）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；参数说明：session（NetworkSink）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * ；返回值：unknown；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * handle(method, params, session)，并按返回类型处理结果。
   */
  handle(method: string, params: Readonly<Record<string, unknown>>, session: NetworkSink): unknown {
    switch (method) {
      case 'Network.enable':
        this.enable(session)
        return {}
      case 'Network.disable':
        this.disable(session)
        return {}
      case 'Network.getResponseBody': {
        /**
         * 常量说明：body 用于处理 body 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const body = this.store.responseBody(params.requestId)
        return {
          body: Buffer.from(body.bytes).toString('base64'),
          base64Encoded: true,
          dshInspectorTruncated: body.truncated,
          ...(body.captureError === undefined ? {} : { dshInspectorCaptureError: body.captureError }),
        }
      }
      case 'Network.getRequestPostData': {
        /**
         * 常量说明：body 用于处理 body 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const body = this.store.requestBody(params.requestId)
        return {
          postData: Buffer.from(body.bytes).toString('utf8'),
          dshInspectorTruncated: body.truncated,
          ...(body.captureError === undefined ? {} : { dshInspectorCaptureError: body.captureError }),
        }
      }
      case 'Network.streamResourceContent': {
        /**
         * 常量说明：body 用于处理 body 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const body = this.store.responseBody(params.requestId)
        if (typeof params.requestId !== 'string') throw new Error('Network requestId must be a string')
        if (!body.complete) {
          /**
           * 变量说明：requests 用于处理 requests 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
           */
          let requests = this.streamedRequests.get(session)
          if (requests === undefined) this.streamedRequests.set(session, requests = new Set())
          requests.add(params.requestId)
        }
        return { bufferedData: Buffer.from(body.bytes).toString('base64') }
      }
      case 'Network.setCacheDisabled':
      case 'Network.setBypassServiceWorker':
      case 'Network.setExtraHTTPHeaders':
      case 'Network.clearBrowserCache':
      case 'Network.clearBrowserCookies':
        return {}
      default:
        throw new Error(`unsupported Network method ${method}`)
    }
  }

  /**
   * 功能说明：处理 receive 相关流程；使用场景由所在模块及调用位置决定。
   * @param event （NetworkStoreEvent）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 receive(event)，并按返回类型处理结果。
   */
  private receive(event: NetworkStoreEvent): void {
    if (event.type === 'request-evicted') {
      /**
       * 变量说明：session、requests 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const [session, requests] of this.streamedRequests) {
        requests.delete(event.requestKey)
        if (requests.size === 0) this.streamedRequests.delete(session)
      }
      /**
       * 变量说明：requests 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const requests of this.pendingStarts.values()) requests.delete(event.requestKey)
      /**
       * 变量说明：requests 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const requests of this.requestTypes.values()) requests.delete(event.requestKey)
      return
    }
    /**
     * 变量说明：session 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const session of this.enabled) this.send(session, event)
  }

  /**
   * 功能说明：处理 send 相关流程；使用场景由所在模块及调用位置决定。
   * @param session （NetworkSink）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param event （Exclude<NetworkStoreEvent, { readonly type:
   * 'request-evicte…）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 send(session, event)，并按返回类型处理结果。
   */
  private send(session: NetworkSink, event: Exclude<NetworkStoreEvent, { readonly type: 'request-evicted' }>): void {
    /**
     * 常量说明：timestamp 用于处理 timestamp 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const timestamp = (event.timestampMs - performance.timeOrigin) / 1_000
    switch (event.type) {
      case 'request-started':
        this.pendingStarts.get(session)?.set(event.requestKey, event)
        return
      case 'response-received': {
        /**
         * 常量说明：resourceType 用于处理 resourceType 相关数据，作用于当前作用域；初始化后不可重新赋值，
         * 但对象内部是否可变仍由其类型决定。
         */
        const resourceType = event.mimeType === 'text/event-stream' ? 'EventSource' : 'Fetch'
        this.sendRequestStart(session, event.requestKey, resourceType)
        session.sendEvent('Network.responseReceived', {
          requestId: event.requestId,
          loaderId: 'dsh-inspector-loader',
          frameId: 'dsh-inspector-host-frame',
          timestamp,
          type: resourceType,
          response: {
            url: event.url,
            status: event.status,
            statusText: event.statusText,
            headers: cdpHeaders(event.headers),
            mimeType: event.mimeType,
            connectionReused: false,
            connectionId: 0,
            encodedDataLength: resourceType === 'EventSource' ? -1 : 0,
            securityState: 'neutral',
          },
        })
        return
      }
      case 'event-source-message':
        session.sendEvent('Network.eventSourceMessageReceived', {
          requestId: event.requestId,
          timestamp,
          eventName: event.eventName,
          eventId: event.eventId,
          data: event.data,
        })
        return
      case 'response-data':
        session.sendEvent('Network.dataReceived', {
          requestId: event.requestId,
          timestamp,
          dataLength: event.byteLength,
          encodedDataLength: event.byteLength,
          ...(this.streamedRequests.get(session)?.has(event.requestKey) === true ? { data: event.data } : {}),
        })
        return
      case 'request-finished':
        this.sendRequestStart(session, event.requestKey, 'Fetch')
        session.sendEvent('Network.loadingFinished', {
          requestId: event.requestId,
          timestamp,
          encodedDataLength: event.encodedDataLength,
          dshInspectorTruncated: event.truncated,
        })
        this.stopRequest(session, event.requestKey)
        return
      case 'request-failed': {
        this.sendRequestStart(session, event.requestKey, 'Fetch')
        /**
         * 常量说明：resourceType 用于处理 resourceType 相关数据，作用于当前作用域；初始化后不可重新赋值，
         * 但对象内部是否可变仍由其类型决定。
         */
        const resourceType = this.requestTypes.get(session)?.get(event.requestKey) ?? 'Fetch'
        session.sendEvent('Network.loadingFailed', {
          requestId: event.requestId,
          timestamp,
          type: resourceType,
          errorText: event.errorText,
          canceled: event.canceled,
        })
        this.stopRequest(session, event.requestKey)
        return
      }
      default:
        return assertNever(event)
    }
  }

  /**
   * 功能说明：处理 sendRequestStart 相关流程；使用场景由所在模块及调用位置决定。
   * @param session （NetworkSink）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param requestKey （string）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @param resourceType （NetworkResourceType）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 sendRequestStart(session, requestKey, resourceType)，
   * 并按返回类型处理结果。
   */
  private sendRequestStart(session: NetworkSink, requestKey: string, resourceType: NetworkResourceType): void {
    /**
     * 常量说明：pending 用于处理 pending 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const pending = this.pendingStarts.get(session)
    /**
     * 常量说明：event 用于处理 event 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const event = pending?.get(requestKey)
    if (event === undefined) return
    pending?.delete(requestKey)
    this.requestTypes.get(session)?.set(requestKey, resourceType)
    session.sendEvent('Network.requestWillBeSent', {
      requestId: event.requestId,
      loaderId: 'dsh-inspector-loader',
      documentURL: 'dsh://host',
      request: {
        url: event.url,
        method: event.method,
        headers: cdpHeaders(event.headers),
        hasPostData: event.hasBody,
      },
      timestamp: (event.timestampMs - performance.timeOrigin) / 1_000,
      wallTime: event.wallTimeMs / 1_000,
      initiator: { type: 'other' },
      type: resourceType,
    })
  }

  /**
   * 功能说明：停止 Request 相关流程；使用场景由所在模块及调用位置决定。
   * @param session （NetworkSink）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param requestKey （string）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 stopRequest(session, requestKey)，并按返回类型处理结果。
   */
  private stopRequest(session: NetworkSink, requestKey: string): void {
    /**
     * 常量说明：streamed 用于处理 streamed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const streamed = this.streamedRequests.get(session)
    streamed?.delete(requestKey)
    if (streamed?.size === 0) this.streamedRequests.delete(session)
    this.pendingStarts.get(session)?.delete(requestKey)
    this.requestTypes.get(session)?.delete(requestKey)
  }
}

/**
 * 功能说明：处理 cdpHeaders 相关流程；使用场景由所在模块及调用位置决定。
 * @param entries （readonly InspectorHeader[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Record<string, string>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 cdpHeaders(entries)，并按返回类型处理结果。
 */
function cdpHeaders(entries: readonly InspectorHeader[]): Record<string, string> {
  /**
   * 常量说明：headers 用于处理 headers 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const headers: Record<string, string> = Object.create(null) as Record<string, string>
  /**
   * 变量说明：name、value 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const [name, value] of entries) {
    headers[name] = headers[name] === undefined ? value : `${headers[name]}\n${value}`
  }
  return headers
}

/**
 * 功能说明：断言 Never 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （never）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns never；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 assertNever(value)，并按返回类型处理结果。
 */
function assertNever(value: never): never {
  throw new Error(`Unexpected network event: ${JSON.stringify(value)}`)
}
