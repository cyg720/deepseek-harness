/** Worker-owned source generations, observation dispatch, and extension transport.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 hub 模块的职责，并向相邻模块提供可复用能力。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import { jsonByteLength, type InspectorJsonValue } from '../../shared/json.ts'
import {
  INSPECTOR_PROTOCOL_VERSION,
  parseSourceFrame,
  type InspectorRecordInput,
  type InspectorSourceDescriptor,
  type InspectorSourceKind,
  type SourceToWorkerFrame,
  type WorkerToSourceFrame,
} from '../../shared/bridge/messages/observation.ts'
import type { ClientConsoleEventFrame, ClientRuntimeResponseFrame } from '../../shared/bridge/messages/runtime/index.ts'
import type { ClientSourceResponseFrame } from '../../shared/bridge/messages/sources/index.ts'

/** One validated record with its source-local sequence. */
export interface IngestedInspectorRecord extends InspectorRecordInput {
  readonly sequence: number
}

/** One connected source's reply and close operations. */
export interface SourceConnection {
  readonly kind: InspectorSourceKind
  /**
   * 功能说明：处理 send 相关流程；使用场景由所在模块及调用位置决定。
   * @param frame （WorkerToSourceFrame）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 send(frame)，并按返回类型处理结果。
   */
  send(frame: WorkerToSourceFrame): void
  /**
   * 功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。
   * @param code （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param reason （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 close(code, reason)，并按返回类型处理结果。
   */
  close(code: number, reason: string): void
}

/** Consumer of source lifecycle and records. */
export interface InspectorRecordConsumer {
  readonly topics: ReadonlySet<string>
  /**
   * 功能说明：处理 replace 相关流程；使用场景由所在模块及调用位置决定。
   * @param source （InspectorSourceDescriptor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param records （readonly IngestedInspectorRecord[]）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 replace(source, records)，并按返回类型处理结果。
   */
  replace(source: InspectorSourceDescriptor, records: readonly IngestedInspectorRecord[]): void
  /**
   * 功能说明：处理 append 相关流程；使用场景由所在模块及调用位置决定。
   * @param source （InspectorSourceDescriptor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param records （readonly IngestedInspectorRecord[]）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 append(source, records)，并按返回类型处理结果。
   */
  append(source: InspectorSourceDescriptor, records: readonly IngestedInspectorRecord[]): void
  /**
   * 功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。
   * @param source （InspectorSourceDescriptor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param reason （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 close(source, reason)，并按返回类型处理结果。
   */
  close(source: InspectorSourceDescriptor, reason: string): void
}

interface SourceState {
  readonly source: InspectorSourceDescriptor
  readonly topics: ReadonlySet<string>
  readonly connection: SourceConnection
  expectedSequence: number
  dropped: number
  readonly topicCounts: Map<string, number>
}

/** Source lifecycle and typed extension frames observed inside the Worker. */
export type InspectorSourceEvent =
  | { readonly type: 'opened'; readonly source: InspectorSourceDescriptor }
  | { readonly type: 'closed'; readonly source: InspectorSourceDescriptor; readonly reason: string }
  | {
    readonly type: 'client-runtime-response'
    readonly source: InspectorSourceDescriptor
    readonly frame: ClientRuntimeResponseFrame
  }
  | {
    readonly type: 'client-console-event'
    readonly source: InspectorSourceDescriptor
    readonly frame: ClientConsoleEventFrame
  }
  | {
    readonly type: 'client-source-response'
    readonly source: InspectorSourceDescriptor
    readonly frame: ClientSourceResponseFrame
  }

/** Read-only diagnostic for `DSHInspector.getSources`. */
export interface InspectorSourceView {
  readonly sourceId: string
  readonly generation: string
  readonly kind: InspectorSourceKind
  readonly label: string
  readonly capabilities: readonly string[]
  readonly expectedSequence: number
  readonly dropped: number
  readonly topics: Readonly<Record<string, number>>
}

/** Serial Worker-side owner of every Host and Client source generation.
 * @remarks 中文说明：类说明：InspectorSourceRegistry 用于集中封装 处理
 * InspectorSourceRegistry 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；
 * 使用场景：由 experimental/inspector 在对应插件或业务生命周期内创建和调用。 */
export class InspectorSourceRegistry {
  /**
   * 常量说明：sources 用于处理 sources 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly sources = new Map<string, SourceState>()
  /**
   * 常量说明：statusListeners 用于处理 statusListeners 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly statusListeners = new Set<() => void>()
  /**
   * 常量说明：eventListeners 用于处理 eventListeners 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly eventListeners = new Set<(event: InspectorSourceEvent) => void>()

  /**
   * 功能说明：处理 InspectorSourceRegistry 相关流程；使用场景由所在模块及调用位置决定。
   * @param consumers （readonly InspectorRecordConsumer[]）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @param maxFrameBytes （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param maxRecordsPerFrame （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new InspectorSourceRegistry(consumers, maxFrameBytes,
   * maxRecordsPerFrame) 创建实例，并在所属生命周期内使用。
   */
  constructor(
    private readonly consumers: readonly InspectorRecordConsumer[],
    private readonly maxFrameBytes: number,
    private readonly maxRecordsPerFrame: number,
  ) {}

  /**
   * Parse and apply one frame; malformed input closes only its source transport.
   * @param connection - Carrier that delivered the frame.
   * @param value - Untrusted decoded frame.
   * @remarks 中文说明：功能说明：处理 receive 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：connection（SourceConnection）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 receive(connection, value)，并按返回类型处理结果。
   */
  receive(connection: SourceConnection, value: unknown): void {
    /**
     * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      /**
       * 常量说明：frame 用于处理 frame 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const frame = parseSourceFrame(value, this.maxRecordsPerFrame)
      if (jsonByteLength(frame as unknown as InspectorJsonValue) > this.maxFrameBytes) {
        throw new Error(`inspector protocol: source frame exceeds ${String(this.maxFrameBytes)} bytes`)
      }
      this.apply(connection, frame)
    } catch (error) {
      /**
       * 常量说明：message 用于处理 message 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const message = error instanceof Error ? error.message : String(error)
      connection.send({ v: INSPECTOR_PROTOCOL_VERSION, t: 'source/rejected', code: 'invalid-frame', message })
      connection.close(1008, message)
    }
  }

  /**
   * Remove every generation carried by a closed connection.
   * @param connection - Closed source carrier.
   * @param reason - Diagnostic propagated to domain consumers.
   * @remarks 中文说明：功能说明：处理 disconnect 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：connection（SourceConnection）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：reason（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 disconnect(connection, reason)，
   * 并按返回类型处理结果。
   */
  disconnect(connection: SourceConnection, reason: string): void {
    /**
     * 变量说明：sourceId、state 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const [sourceId, state] of this.sources) {
      if (state.connection !== connection) continue
      this.sources.delete(sourceId)
      /**
       * 变量说明：consumer 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const consumer of this.consumers) consumer.close(state.source, reason)
      this.emit({ type: 'closed', source: state.source, reason })
    }
    this.notifyStatus()
  }

  /**
   * Read current source status for the diagnostic CDP domain.
   * @returns A detached status row for every active source.
   * @remarks 中文说明：功能说明：处理 describe 相关流程；使用场景由所在模块及调用位置决定。；
   * 返回值：InspectorSourceView[]；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * describe()，并按返回类型处理结果。
   */
  describe(): InspectorSourceView[] {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：state（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(state)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：capability（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(capability)，并按返回类型处理结果。
     */
    return [...this.sources.values()].map(state => ({
      sourceId: state.source.sourceId,
      generation: state.source.generation,
      kind: state.source.kind,
      label: state.source.label,
      capabilities: state.source.capabilities.map(capability => capability.type),
      expectedSequence: state.expectedSequence,
      dropped: state.dropped,
      topics: Object.fromEntries(state.topicCounts),
    }))
  }

  /**
   * Subscribe to source status changes.
   * @param listener - Status observer.
   * @returns A disposer that removes the observer.
   * @remarks 中文说明：功能说明：处理 subscribeStatus 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：listener（() => void）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。；返回值：() =>
   * void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * subscribeStatus(listener)，并按返回类型处理结果。
   */
  subscribeStatus(listener: () => void): () => void {
    this.statusListeners.add(listener)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    return () => { this.statusListeners.delete(listener) }
  }

  /**
   * Subscribe to source admission, removal, and typed extension frames.
   * @param listener - Source protocol observer.
   * @returns A disposer that removes the observer.
   * @remarks 中文说明：功能说明：处理 subscribeEvents 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：listener（(event: InspectorSourceEvent) => void）：接收后续状态或事件并执行调用方逻辑；
   * 必须满足声明的类型及调用时序要求。；返回值：() => void；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 subscribeEvents(listener)，并按返回类型处理结果。
   */
  subscribeEvents(listener: (event: InspectorSourceEvent) => void): () => void {
    this.eventListeners.add(listener)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    return () => { this.eventListeners.delete(listener) }
  }

  /**
   * Send a typed control frame only to its still-active source generation.
   * @param source - Expected active source generation.
   * @param frame - Validated Worker-to-source frame.
   * @returns Whether the generation was still active and accepted the send.
   * @remarks 中文说明：功能说明：处理 send 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：source（InspectorSourceDescriptor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：frame（WorkerToSourceFrame）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：boolean；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 send(source,
   * frame)，并按返回类型处理结果。
   */
  send(source: InspectorSourceDescriptor, frame: WorkerToSourceFrame): boolean {
    /**
     * 常量说明：state 用于处理 state 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const state = this.sources.get(source.sourceId)
    if (state === undefined || state.source.generation !== source.generation) return false
    if (jsonByteLength(frame as unknown as InspectorJsonValue) > this.maxFrameBytes) {
      throw new Error(`inspector protocol: Worker source frame exceeds ${String(this.maxFrameBytes)} bytes`)
    }
    state.connection.send(frame)
    return true
  }

  /** Close every source and forget all state.
   * @remarks 中文说明：功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 close()，并按返回类型处理结果。 */
  close(): void {
    /**
     * 变量说明：state 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const state of this.sources.values()) {
      /**
       * 变量说明：consumer 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const consumer of this.consumers) consumer.close(state.source, 'inspector worker stopped')
      this.emit({ type: 'closed', source: state.source, reason: 'inspector worker stopped' })
    }
    this.sources.clear()
    this.notifyStatus()
  }

  /**
   * 功能说明：注册并应用 apply 相关流程；使用场景由所在模块及调用位置决定。
   * @param connection （SourceConnection）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param frame （SourceToWorkerFrame）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 apply(connection, frame)，并按返回类型处理结果。
   */
  private apply(connection: SourceConnection, frame: SourceToWorkerFrame): void {
    if (frame.t === 'source/open') {
      this.open(connection, frame.source, frame.topics)
      return
    }
    /**
     * 常量说明：state 用于处理 state 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const state = this.sources.get(frame.sourceId)
    if (state === undefined || state.connection !== connection || state.source.generation !== frame.generation) {
      throw new Error('inspector protocol: frame does not belong to the active source generation')
    }
    if (frame.t === 'source/close') {
      this.sources.delete(frame.sourceId)
      /**
       * 变量说明：consumer 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const consumer of this.consumers) consumer.close(state.source, 'source closed')
      this.emit({ type: 'closed', source: state.source, reason: 'source closed' })
      this.notifyStatus()
      return
    }
    if (frame.t === 'client-runtime/response') {
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：capability（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(capability)，并按返回类型处理结果。
       */
      if (state.source.kind !== 'client'
        || !state.source.capabilities.some(capability => capability.type === 'client-runtime')) {
        throw new Error('inspector protocol: source did not declare Client Runtime')
      }
      this.emit({ type: 'client-runtime-response', source: state.source, frame })
      return
    }
    if (frame.t === 'client-console/event') {
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：capability（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(capability)，并按返回类型处理结果。
       */
      if (state.source.kind !== 'client'
        || !state.source.capabilities.some(capability => capability.type === 'client-console')) {
        throw new Error('inspector protocol: source did not declare Client Console')
      }
      this.emit({ type: 'client-console-event', source: state.source, frame })
      return
    }
    if (frame.t === 'client-sources/response') {
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：capability（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(capability)，并按返回类型处理结果。
       */
      if (state.source.kind !== 'client'
        || !state.source.capabilities.some(capability => capability.type === 'client-sources')) {
        throw new Error('inspector protocol: source did not declare Client Sources')
      }
      this.emit({ type: 'client-source-response', source: state.source, frame })
      return
    }
    this.assertTopics(state, frame.records)
    if (frame.t === 'source/replace') {
      state.expectedSequence = frame.nextSequence
      /**
       * 变量说明：consumer 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const consumer of this.consumers) /**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：record（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：index（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(record, index)，并按返回类型处理结果。
 */
consumer.replace(
        state.source,
        frame.records.map((record, index) => ({ ...record, sequence: frame.nextSequence + index })),
      )
      this.count(state, frame.records)
      this.notifyStatus()
      return
    }
    /**
     * 常量说明：gap 用于处理 gap 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const gap = frame.firstSequence - state.expectedSequence
    if (gap < 0 || gap !== frame.droppedBefore) {
      connection.send({
        v: INSPECTOR_PROTOCOL_VERSION,
        t: 'source/resnapshot',
        sourceId: state.source.sourceId,
        generation: state.source.generation,
        expectedSequence: state.expectedSequence,
        reason: `expected sequence ${String(state.expectedSequence)}, received ${String(frame.firstSequence)}`,
      })
      return
    }
    state.dropped += frame.droppedBefore
    /**
     * 常量说明：records 用于处理 records 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：record（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：index（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(record, index)，并按返回类型处理结果。
     */
    const records = frame.records.map((record, index) => ({ ...record, sequence: frame.firstSequence + index }))
    state.expectedSequence = frame.firstSequence + frame.records.length
    /**
     * 变量说明：consumer 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const consumer of this.consumers) consumer.append(state.source, records)
    this.count(state, frame.records)
    connection.send({
      v: INSPECTOR_PROTOCOL_VERSION,
      t: 'source/append-acknowledged',
      sourceId: state.source.sourceId,
      generation: state.source.generation,
      nextSequence: state.expectedSequence,
    })
    this.notifyStatus()
  }

  /**
   * 功能说明：打开 open 相关流程；使用场景由所在模块及调用位置决定。
   * @param connection （SourceConnection）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param source （InspectorSourceDescriptor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param topics （readonly string[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 open(connection, source, topics)，并按返回类型处理结果。
   */
  private open(connection: SourceConnection, source: InspectorSourceDescriptor, topics: readonly string[]): void {
    if (source.kind !== connection.kind) throw new Error('inspector protocol: source kind does not match its carrier')
    /**
     * 常量说明：accepted 用于处理 accepted 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const accepted = new Set(topics)
    /**
     * 常量说明：prior 用于处理 prior 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const prior = this.sources.get(source.sourceId)
    if (prior !== undefined) {
      /**
       * 变量说明：consumer 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const consumer of this.consumers) consumer.close(prior.source, 'source generation replaced')
      this.emit({ type: 'closed', source: prior.source, reason: 'source generation replaced' })
    }
    this.sources.set(source.sourceId, {
      source,
      topics: accepted,
      connection,
      expectedSequence: 1,
      dropped: 0,
      topicCounts: new Map(),
    })
    connection.send({
      v: INSPECTOR_PROTOCOL_VERSION,
      t: 'source/accepted',
      sourceId: source.sourceId,
      generation: source.generation,
    })
    this.emit({ type: 'opened', source })
    this.notifyStatus()
  }

  /**
   * 功能说明：断言 Topics 相关流程；使用场景由所在模块及调用位置决定。
   * @param state （SourceState）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param records （readonly InspectorRecordInput[]）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 assertTopics(state, records)，并按返回类型处理结果。
   */
  private assertTopics(state: SourceState, records: readonly InspectorRecordInput[]): void {
    /**
     * 变量说明：record 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const record of records) {
      if (!state.topics.has('*') && !state.topics.has(record.topic)) {
        throw new Error(`inspector protocol: source did not declare topic ${JSON.stringify(record.topic)}`)
      }
    }
  }

  /**
   * 功能说明：处理 count 相关流程；使用场景由所在模块及调用位置决定。
   * @param state （SourceState）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param records （readonly InspectorRecordInput[]）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 count(state, records)，并按返回类型处理结果。
   */
  private count(state: SourceState, records: readonly InspectorRecordInput[]): void {
    /**
     * 变量说明：record 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const record of records) {
      state.topicCounts.set(record.topic, (state.topicCounts.get(record.topic) ?? 0) + 1)
    }
  }

  /**
   * 功能说明：处理 notifyStatus 相关流程；使用场景由所在模块及调用位置决定。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 notifyStatus()，并按返回类型处理结果。
   */
  private notifyStatus(): void {
    /**
     * 变量说明：listener 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const listener of [...this.statusListeners]) {
      try {
        listener()
      } catch {
        // A diagnostic observer is isolated from source admission and later observers.
      }
    }
  }

  /**
   * 功能说明：发送 emit 相关流程；使用场景由所在模块及调用位置决定。
   * @param event （InspectorSourceEvent）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 emit(event)，并按返回类型处理结果。
   */
  private emit(event: InspectorSourceEvent): void {
    /**
     * 变量说明：listener 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const listener of [...this.eventListeners]) {
      try {
        listener(event)
      } catch {
        // A protocol consumer is isolated from source admission and sibling consumers.
      }
    }
  }
}
