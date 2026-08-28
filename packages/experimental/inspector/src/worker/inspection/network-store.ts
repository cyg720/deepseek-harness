/** Worker-owned repository of normalized fetch observations and captured bodies.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 network store 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import { Buffer } from 'node:buffer'
import { FETCH_TOPICS } from '../../shared/bridge/messages/network.ts'
import type { InspectorHeader } from '../../shared/network/observation.ts'
import { InspectorEventSourceParser } from '../../shared/network/event-source.ts'
import { isPlainObject } from '../../shared/json.ts'
import type { InspectorSourceDescriptor } from '../../shared/bridge/messages/observation.ts'
import type { IngestedInspectorRecord, InspectorRecordConsumer } from '../bridge/hub.ts'

/** Bounded retention policy for observed network requests. */
export interface NetworkStoreOptions {
  readonly maxRetainedRequests: number
  readonly maxJournalBytes: number
}

/** Captured body data returned without a CDP representation. */
export interface CapturedNetworkBody {
  readonly bytes: Uint8Array
  readonly truncated: boolean
  readonly captureError?: string
  readonly complete: boolean
}

interface NetworkEventBase {
  readonly requestKey: string
  readonly requestId: string
  readonly timestampMs: number
}

/** Transport-independent changes emitted by the network repository. */
export type NetworkStoreEvent =
  | NetworkEventBase & {
    readonly type: 'request-started'
    readonly wallTimeMs: number
    readonly url: string
    readonly method: string
    readonly headers: readonly InspectorHeader[]
    readonly hasBody: boolean
  }
  | NetworkEventBase & {
    readonly type: 'response-received'
    readonly url: string
    readonly status: number
    readonly statusText: string
    readonly headers: readonly InspectorHeader[]
    readonly mimeType: string
  }
  | NetworkEventBase & {
    readonly type: 'response-data'
    readonly data: string
    readonly byteLength: number
  }
  | NetworkEventBase & {
    readonly type: 'event-source-message'
    readonly eventName: string
    readonly eventId: string
    readonly data: string
  }
  | NetworkEventBase & {
    readonly type: 'request-finished'
    readonly encodedDataLength: number
    readonly truncated: boolean
  }
  | NetworkEventBase & {
    readonly type: 'request-failed'
    readonly errorText: string
    readonly canceled: boolean
  }
  | { readonly type: 'request-evicted'; readonly requestKey: string }

type JournalNetworkEvent = Exclude<NetworkStoreEvent, { readonly type: 'response-data' | 'request-evicted' }>

interface CapturedRequest {
  readonly key: string
  readonly requestId: string
  readonly sourceId: string
  readonly requestBody: Buffer[]
  readonly responseBody: Buffer[]
  requestBodyBytes: number
  responseBodyBytes: number
  requestBodyTruncated: boolean
  responseBodyTruncated: boolean
  requestCaptureError?: string
  responseCaptureError?: string
  responseSeen: boolean
  completed: boolean
  eventSourceParser: InspectorEventSourceParser | undefined
  nextEventSourceId: number
}

/** Validated Network observation store independent of CDP connection state.
 * @remarks 中文说明：类说明：NetworkStore 用于集中封装 处理 NetworkStore 相关状态与行为。；
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由 experimental/inspector
 * 在对应插件或业务生命周期内创建和调用。 */
export class NetworkStore implements InspectorRecordConsumer {
  /**
   * 常量说明：topics 用于处理 topics 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  readonly topics = new Set<string>(FETCH_TOPICS)
  /**
   * 常量说明：requests 用于处理 requests 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly requests = new Map<string, CapturedRequest>()
  /**
   * 常量说明：journal 用于处理 journal 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly journal: JournalNetworkEvent[] = []
  /**
   * 常量说明：completed 用于处理 completed 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly completed: string[] = []
  /**
   * 常量说明：listeners 用于处理 listeners 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly listeners = new Set<(event: NetworkStoreEvent) => void>()
  /**
   * 变量说明：journalBytes 用于处理 journalBytes 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private journalBytes = 0

  /**
   * 功能说明：处理 NetworkStore 相关流程；使用场景由所在模块及调用位置决定。
   * @param options （NetworkStoreOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new NetworkStore(options) 创建实例，并在所属生命周期内使用。
   */
  constructor(private readonly options: NetworkStoreOptions) {}

  /**
   * 功能说明：处理 replace 相关流程；使用场景由所在模块及调用位置决定。
   * @param source （InspectorSourceDescriptor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param records （readonly IngestedInspectorRecord[]）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 replace(source, records)，并按返回类型处理结果。
   */
  replace(source: InspectorSourceDescriptor, records: readonly IngestedInspectorRecord[]): void {
    this.close(source, 'source state replaced')
    this.append(source, records)
  }

  /**
   * 功能说明：处理 append 相关流程；使用场景由所在模块及调用位置决定。
   * @param source （InspectorSourceDescriptor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param records （readonly IngestedInspectorRecord[]）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 append(source, records)，并按返回类型处理结果。
   */
  append(source: InspectorSourceDescriptor, records: readonly IngestedInspectorRecord[]): void {
    /**
     * 变量说明：record 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const record of records) {
      if (!this.topics.has(record.topic)) continue
      try {
        this.ingest(source, record)
      } catch {
        // A malformed domain payload loses only that observation; later records remain independently useful.
      }
    }
  }

  /**
   * 功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。
   * @param source （InspectorSourceDescriptor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param reason （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 close(source, reason)，并按返回类型处理结果。
   */
  close(source: InspectorSourceDescriptor, reason: string): void {
    /**
     * 变量说明：request 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const request of this.requests.values()) {
      if (request.sourceId !== source.sourceId || request.completed) continue
      request.completed = true
      this.publish({
        type: 'request-failed',
        requestKey: request.key,
        requestId: request.requestId,
        timestampMs: performance.timeOrigin + performance.now(),
        errorText: reason,
        canceled: true,
      })
      this.completed.push(request.key)
    }
    this.enforceRetention()
  }

  /**
   * Read retained request lifecycle events.
   * @returns Events in observation order.
   * @remarks 中文说明：功能说明：处理 replay 相关流程；使用场景由所在模块及调用位置决定。；返回值：readonly
   * JournalNetworkEvent[]；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * replay()，并按返回类型处理结果。
   */
  replay(): readonly JournalNetworkEvent[] {
    return this.journal
  }

  /**
   * Subscribe to live request changes and eviction.
   * @param listener - Consumer called synchronously after each accepted change.
   * @returns A disposer removing the consumer.
   * @remarks 中文说明：功能说明：处理 subscribe 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：listener（(event: NetworkStoreEvent) => void）：接收后续状态或事件并执行调用方逻辑；
   * 必须满足声明的类型及调用时序要求。；返回值：() => void；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 subscribe(listener)，并按返回类型处理结果。
   */
  subscribe(listener: (event: NetworkStoreEvent) => void): () => void {
    this.listeners.add(listener)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Read one retained request body.
   * @param requestId - Public request id assigned by this store.
   * @returns Captured bytes and truncation metadata.
   * @remarks 中文说明：功能说明：处理 requestBody 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：requestId（unknown）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；
   * 返回值：CapturedNetworkBody；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * requestBody(requestId)，并按返回类型处理结果。
   */
  requestBody(requestId: unknown): CapturedNetworkBody {
    /**
     * 常量说明：request 用于处理 request 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const request = this.requestById(requestId)
    return body(request.requestBody, request.requestBodyTruncated, request.requestCaptureError, request.completed)
  }

  /**
   * Read one retained response body after response headers have arrived.
   * @param requestId - Public request id assigned by this store.
   * @returns Captured bytes and truncation metadata.
   * @remarks 中文说明：功能说明：处理 responseBody 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：requestId（unknown）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；
   * 返回值：CapturedNetworkBody；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * responseBody(requestId)，并按返回类型处理结果。
   */
  responseBody(requestId: unknown): CapturedNetworkBody {
    /**
     * 常量说明：request 用于处理 request 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const request = this.requestById(requestId)
    if (!request.responseSeen) throw new Error('response headers have not arrived')
    return body(request.responseBody, request.responseBodyTruncated, request.responseCaptureError, request.completed)
  }

  /** Release subscribers and all retained request data.
   * @remarks 中文说明：功能说明：处理 dispose 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 dispose()，并按返回类型处理结果。 */
  dispose(): void {
    this.listeners.clear()
    this.requests.clear()
    this.journal.length = 0
    this.completed.length = 0
    this.journalBytes = 0
  }

  /**
   * 功能说明：处理 ingest 相关流程；使用场景由所在模块及调用位置决定。
   * @param source （InspectorSourceDescriptor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param record （IngestedInspectorRecord）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 ingest(source, record)，并按返回类型处理结果。
   */
  private ingest(source: InspectorSourceDescriptor, record: IngestedInspectorRecord): void {
    /**
     * 常量说明：payload 用于处理 payload 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const payload = requirePayload(record.payload)
    /**
     * 常量说明：localId 用于处理 localId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const localId = stringField(payload, 'requestId')
    /**
     * 常量说明：key 用于处理 key 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const key = `${source.sourceId}:${source.generation}:${localId}`
    /**
     * 常量说明：timestampMs 用于处理 timestampMs 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const timestampMs = source.timeOriginMs + record.monotonicMs
    if (record.topic === 'fetch/start') {
      if (this.requests.has(key)) throw new Error('fetch observation reused an active request id')
      /**
       * 常量说明：request 用于处理 request 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const request: CapturedRequest = {
        key,
        requestId: key,
        sourceId: source.sourceId,
        requestBody: [],
        responseBody: [],
        requestBodyBytes: 0,
        responseBodyBytes: 0,
        requestBodyTruncated: false,
        responseBodyTruncated: false,
        responseSeen: false,
        completed: false,
        eventSourceParser: undefined,
        nextEventSourceId: 0,
      }
      this.requests.set(key, request)
      this.publish({
        type: 'request-started',
        requestKey: key,
        requestId: request.requestId,
        timestampMs,
        wallTimeMs: numberField(payload, 'wallTimeMs'),
        url: stringField(payload, 'url'),
        method: stringField(payload, 'method'),
        headers: headerField(payload, 'headers'),
        hasBody: booleanField(payload, 'hasBody'),
      })
      this.enforceRetention()
      return
    }
    /**
     * 常量说明：request 用于处理 request 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const request = this.requests.get(key)
    if (request === undefined) return
    switch (record.topic) {
      case 'fetch/request-body-chunk':
        this.appendBody(request, 'request', stringField(payload, 'data'))
        return
      case 'fetch/request-body-end': {
        request.requestBodyTruncated ||= booleanField(payload, 'truncated')
        /**
         * 常量说明：captureError 用于处理 captureError 相关数据，作用于当前作用域；初始化后不可重新赋值，
         * 但对象内部是否可变仍由其类型决定。
         */
        const captureError = optionalStringField(payload, 'captureError')
        if (captureError !== undefined) request.requestCaptureError = captureError
        return
      }
      case 'fetch/response':
        request.responseSeen = true
        /**
         * 常量说明：mimeType 用于处理 mimeType 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const mimeType = stringField(payload, 'mimeType').toLowerCase()
        request.eventSourceParser = mimeType === 'text/event-stream'
          ? new InspectorEventSourceParser()
          : undefined
        this.publish({
          type: 'response-received',
          requestKey: key,
          requestId: request.requestId,
          timestampMs,
          url: stringField(payload, 'url'),
          status: numberField(payload, 'status'),
          statusText: stringField(payload, 'statusText'),
          headers: headerField(payload, 'headers'),
          mimeType,
        })
        return
      case 'fetch/response-body-chunk': {
        /**
         * 常量说明：data 用于处理 data 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const data = stringField(payload, 'data')
        /**
         * 常量说明：bytes 用于处理 bytes 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const bytes = this.appendBody(request, 'response', data)
        /**
         * 常量说明：byteLength 用于处理 byteLength 相关数据，作用于当前作用域；初始化后不可重新赋值，
         * 但对象内部是否可变仍由其类型决定。
         */
        const byteLength = bytes.byteLength
        /**
         * 变量说明：message 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
         */
        for (const message of request.eventSourceParser?.push(bytes) ?? []) {
          this.publish({
            type: 'event-source-message',
            requestKey: key,
            requestId: request.requestId,
            timestampMs,
            ...message,
            eventId: String(++request.nextEventSourceId),
          })
        }
        this.emit({ type: 'response-data', requestKey: key, requestId: request.requestId, timestampMs, data, byteLength })
        return
      }
      case 'fetch/end': {
        request.responseBodyTruncated ||= booleanField(payload, 'responseBodyTruncated')
        /**
         * 常量说明：captureError 用于处理 captureError 相关数据，作用于当前作用域；初始化后不可重新赋值，
         * 但对象内部是否可变仍由其类型决定。
         */
        const captureError = optionalStringField(payload, 'responseCaptureError')
        if (captureError !== undefined) request.responseCaptureError = captureError
        this.complete(request, {
          type: 'request-finished',
          requestKey: key,
          requestId: request.requestId,
          timestampMs,
          encodedDataLength: request.responseBodyBytes,
          truncated: request.responseBodyTruncated,
        })
        return
      }
      case 'fetch/error': {
        if (request.completed) return
        /**
         * 常量说明：errorText 用于处理 errorText 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const errorText = stringField(payload, 'message')
        if (request.responseSeen) {
          request.responseBodyTruncated = true
          request.responseCaptureError = errorText
        }
        this.complete(request, {
          type: 'request-failed',
          requestKey: key,
          requestId: request.requestId,
          timestampMs,
          errorText,
          canceled: booleanField(payload, 'canceled'),
        })
        return
      }
    }
  }

  /**
   * 功能说明：处理 appendBody 相关流程；使用场景由所在模块及调用位置决定。
   * @param request （CapturedRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @param side （'request' | 'response'）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param encoded （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Buffer；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 appendBody(request, side, encoded)，并按返回类型处理结果。
   */
  private appendBody(request: CapturedRequest, side: 'request' | 'response', encoded: string): Buffer {
    /**
     * 常量说明：bytes 用于处理 bytes 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const bytes = decodeBase64(encoded)
    this.evictCompletedFor(bytes.byteLength, request.key)
    /**
     * 常量说明：retained 用于处理 retained 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const retained = bytes.subarray(0, Math.max(0, this.options.maxJournalBytes - this.journalBytes))
    if (side === 'request') {
      if (retained.byteLength > 0) request.requestBody.push(retained)
      request.requestBodyBytes += retained.byteLength
      request.requestBodyTruncated ||= retained.byteLength < bytes.byteLength
    } else {
      if (retained.byteLength > 0) request.responseBody.push(retained)
      request.responseBodyBytes += retained.byteLength
      request.responseBodyTruncated ||= retained.byteLength < bytes.byteLength
    }
    this.journalBytes += retained.byteLength
    this.enforceRetention()
    return bytes
  }

  /**
   * 功能说明：处理 complete 相关流程；使用场景由所在模块及调用位置决定。
   * @param request （CapturedRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @param event （JournalNetworkEvent）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 complete(request, event)，并按返回类型处理结果。
   */
  private complete(request: CapturedRequest, event: JournalNetworkEvent): void {
    if (request.completed) return
    request.completed = true
    this.publish(event)
    this.completed.push(request.key)
    this.enforceRetention()
  }

  /**
   * 功能说明：处理 publish 相关流程；使用场景由所在模块及调用位置决定。
   * @param event （JournalNetworkEvent）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 publish(event)，并按返回类型处理结果。
   */
  private publish(event: JournalNetworkEvent): void {
    this.journal.push(event)
    this.emit(event)
  }

  /**
   * 功能说明：发送 emit 相关流程；使用场景由所在模块及调用位置决定。
   * @param event （NetworkStoreEvent）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 emit(event)，并按返回类型处理结果。
   */
  private emit(event: NetworkStoreEvent): void {
    /**
     * 变量说明：listener 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const listener of [...this.listeners]) {
      try {
        listener(event)
      } catch {
        // One presentation adapter cannot interrupt repository ingestion or sibling consumers.
      }
    }
  }

  /**
   * 功能说明：处理 enforceRetention 相关流程；使用场景由所在模块及调用位置决定。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 enforceRetention()，并按返回类型处理结果。
   */
  private enforceRetention(): void {
    while (this.requests.size > this.options.maxRetainedRequests || this.journalBytes > this.options.maxJournalBytes) {
      /**
       * 常量说明：key 用于处理 key 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const key = (this.completed.shift() ?? this.requests.keys().next().value) as string
      /**
       * 常量说明：request 用于处理 request 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const request = this.requests.get(key) as CapturedRequest
      if (!request.completed) {
        request.completed = true
        this.publish({
          type: 'request-failed',
          requestKey: request.key,
          requestId: request.requestId,
          timestampMs: performance.timeOrigin + performance.now(),
          errorText: 'Inspector retained-request limit exceeded',
          canceled: true,
        })
      }
      this.evict(request)
    }
  }

  /**
   * 功能说明：处理 evictCompletedFor 相关流程；使用场景由所在模块及调用位置决定。
   * @param bytes （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param protectedKey （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 evictCompletedFor(bytes, protectedKey)，并按返回类型处理结果。
   */
  private evictCompletedFor(bytes: number, protectedKey: string): void {
    while (this.journalBytes + bytes > this.options.maxJournalBytes) {
      /**
       * 常量说明：index 用于处理 index 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：key（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(key)，并按返回类型处理结果。
       */
      const index = this.completed.findIndex(key => key !== protectedKey)
      if (index === -1) return
      /**
       * 常量说明：key 用于处理 key 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const key = this.completed.splice(index, 1)[0] as string
      this.evict(this.requests.get(key) as CapturedRequest)
    }
  }

  /**
   * 功能说明：处理 evict 相关流程；使用场景由所在模块及调用位置决定。
   * @param request （CapturedRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 evict(request)，并按返回类型处理结果。
   */
  private evict(request: CapturedRequest): void {
    this.journalBytes -= request.requestBodyBytes + request.responseBodyBytes
    this.requests.delete(request.key)
    /**
     * 变量说明：index 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (let index = this.journal.length - 1; index >= 0; index--) {
      if (this.journal[index]?.requestKey === request.key) this.journal.splice(index, 1)
    }
    this.emit({ type: 'request-evicted', requestKey: request.key })
  }

  /**
   * 功能说明：处理 requestById 相关流程；使用场景由所在模块及调用位置决定。
   * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns CapturedRequest；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 requestById(value)，并按返回类型处理结果。
   */
  private requestById(value: unknown): CapturedRequest {
    if (typeof value !== 'string') throw new Error('Network requestId must be a string')
    /**
     * 常量说明：request 用于处理 request 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：candidate（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(candidate)，并按返回类型处理结果。
     */
    const request = [...this.requests.values()].find(candidate => candidate.requestId === value)
    if (request === undefined) throw new Error(`No resource with given identifier: ${value}`)
    return request
  }
}

/**
 * 功能说明：处理 body 相关流程；使用场景由所在模块及调用位置决定。
 * @param chunks （readonly Buffer[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param truncated （boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param captureError （string | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param complete （boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns CapturedNetworkBody；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 body(chunks, truncated, captureError, complete)，
 * 并按返回类型处理结果。
 */
function body(
  chunks: readonly Buffer[],
  truncated: boolean,
  captureError: string | undefined,
  complete: boolean,
): CapturedNetworkBody {
  return {
    bytes: Buffer.concat(chunks),
    truncated,
    complete,
    ...(captureError === undefined ? {} : { captureError }),
  }
}

/**
 * 功能说明：解码 Base64 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Buffer；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 decodeBase64(value)，并按返回类型处理结果。
 */
function decodeBase64(value: string): Buffer {
  if (value.length === 0 || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    throw new Error('fetch payload body chunk must be canonical base64')
  }
  /**
   * 常量说明：bytes 用于处理 bytes 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const bytes = Buffer.from(value, 'base64')
  if (bytes.toString('base64') !== value) throw new Error('fetch payload body chunk must be canonical base64')
  return bytes
}

/**
 * 功能说明：处理 requirePayload 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Readonly<Record<string, unknown>>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 requirePayload(value)，并按返回类型处理结果。
 */
function requirePayload(value: unknown): Readonly<Record<string, unknown>> {
  if (!isPlainObject(value)) throw new Error('fetch payload must be an object')
  return value
}

/**
 * 功能说明：处理 stringField 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （Readonly<Record<string, unknown>>）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @param name （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 stringField(value, name)，并按返回类型处理结果。
 */
function stringField(value: Readonly<Record<string, unknown>>, name: string): string {
  /**
   * 常量说明：field 用于处理 field 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const field = value[name]
  if (typeof field !== 'string') throw new Error(`fetch payload ${name} must be a string`)
  return field
}

/**
 * 功能说明：处理 optionalStringField 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （Readonly<Record<string, unknown>>）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @param name （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 optionalStringField(value, name)，并按返回类型处理结果。
 */
function optionalStringField(value: Readonly<Record<string, unknown>>, name: string): string | undefined {
  /**
   * 常量说明：field 用于处理 field 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const field = value[name]
  if (field !== undefined && typeof field !== 'string') throw new Error(`fetch payload ${name} must be a string`)
  return field
}

/**
 * 功能说明：处理 numberField 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （Readonly<Record<string, unknown>>）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @param name （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns number；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 numberField(value, name)，并按返回类型处理结果。
 */
function numberField(value: Readonly<Record<string, unknown>>, name: string): number {
  /**
   * 常量说明：field 用于处理 field 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const field = value[name]
  if (typeof field !== 'number' || !Number.isFinite(field)) throw new Error(`fetch payload ${name} must be finite`)
  return field
}

/**
 * 功能说明：处理 booleanField 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （Readonly<Record<string, unknown>>）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @param name （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 booleanField(value, name)，并按返回类型处理结果。
 */
function booleanField(value: Readonly<Record<string, unknown>>, name: string): boolean {
  /**
   * 常量说明：field 用于处理 field 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const field = value[name]
  if (typeof field !== 'boolean') throw new Error(`fetch payload ${name} must be boolean`)
  return field
}

/**
 * 功能说明：处理 headerField 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （Readonly<Record<string, unknown>>）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @param name （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns InspectorHeader[]；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 headerField(value, name)，并按返回类型处理结果。
 */
function headerField(value: Readonly<Record<string, unknown>>, name: string): InspectorHeader[] {
  /**
   * 常量说明：field 用于处理 field 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const field = value[name]
  if (!Array.isArray(field)) throw new Error(`fetch payload ${name} must be a header list`)
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：entry（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(entry)，并按返回类型处理结果。
   */
  return field.map((entry) => {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || typeof entry[1] !== 'string') {
      throw new Error(`fetch payload ${name} contains an invalid header`)
    }
    return [entry[0], entry[1]] as const
  })
}
