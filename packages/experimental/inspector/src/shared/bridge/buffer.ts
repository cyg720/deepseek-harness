/** Realm-neutral bounded buffering for Host and Client observation sources.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 buffer 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { InspectorSourceGeneration, InspectorSourceId } from './ids.ts'
import { isJsonValue, jsonByteLength, type InspectorJsonValue } from '../json.ts'
import type { InspectorRecordInput, SourceAppendFrame, SourceReplaceFrame } from './messages/observation.ts'
import { INSPECTOR_PROTOCOL_VERSION } from './version.ts'

/**
 * 常量说明：SOURCE_FRAME_OVERHEAD_BYTES 用于处理 SOURCE_FRAME_OVERHEAD_BYTES 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const SOURCE_FRAME_OVERHEAD_BYTES = 4_096

/** Limits and declared topics shared by both source transports. */
export interface InspectorSourceBufferOptions {
  readonly topics: readonly string[]
  readonly maxQueuedRecords: number
  readonly maxQueuedBytes: number
  readonly maxRecordsPerFrame: number
  readonly maxFrameBytes: number
}

interface QueuedRecord {
  sequence: number
  readonly bytes: number
  readonly record: InspectorRecordInput
}

/**
 * Owns retained state, queued events, and source-local sequencing independently
 * of whether frames travel over MessagePort or WebSocket.
 * @remarks 中文说明：类说明：InspectorSourceBuffer 用于集中封装 处理 InspectorSourceBuffer
 * 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由
 * experimental/inspector 在对应插件或业务生命周期内创建和调用。
 */
export class InspectorSourceBuffer {
  /**
   * 常量说明：queue 用于处理 queue 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly queue: QueuedRecord[] = []
  /**
   * 常量说明：state 用于处理 state 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly state = new Map<string, InspectorRecordInput>()
  /**
   * 变量说明：queuedBytes 用于处理 queuedBytes 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private queuedBytes = 0
  /**
   * 变量说明：nextSequence 用于处理 nextSequence 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private nextSequence = 1
  /**
   * 变量说明：expectedSequence 用于处理 expectedSequence 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private expectedSequence = 1

  /**
   * 功能说明：处理 InspectorSourceBuffer 相关流程；使用场景由所在模块及调用位置决定。
   * @param options （InspectorSourceBufferOptions）：提供本次操作使用的配置选项；
   * 必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new InspectorSourceBuffer(options) 创建实例，并在所属生命周期内使用。
   */
  constructor(private readonly options: InspectorSourceBufferOptions) {}

  /** Whether at least one observation is waiting for transport.
   * @remarks 中文说明：功能说明：判断是否包含 Pending 相关流程；使用场景由所在模块及调用位置决定。；返回值：boolean；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 hasPending()，并按返回类型处理结果。 */
  get hasPending(): boolean {
    return this.queue.length > 0
  }

  /**
   * Validate and enqueue one observation, dropping the oldest prefix as needed.
   * A record larger than one transport frame is dropped after consuming its sequence number.
   * @param topic - Declared domain topic.
   * @param payload - Lossless JSON payload.
   * @param monotonicMs - Finite source-clock timestamp.
   * @remarks 中文说明：功能说明：处理 publish 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：topic（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：payload（InspectorJsonValue）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：monotonicMs（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 publish(topic, payload,
   * monotonicMs)，并按返回类型处理结果。
   */
  publish(topic: string, payload: InspectorJsonValue, monotonicMs: number): void {
    this.enqueue(this.record(topic, payload, monotonicMs))
  }

  /**
   * Replace one retained topic and enqueue the same observation for live delivery.
   * @param topic - Declared state topic.
   * @param payload - Lossless JSON payload retained for replacement frames.
   * @param monotonicMs - Finite source-clock timestamp.
   * @remarks 中文说明：功能说明：设置 State 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：topic（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：payload（InspectorJsonValue）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：monotonicMs（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 setState(topic, payload,
   * monotonicMs)，并按返回类型处理结果。
   */
  setState(topic: string, payload: InspectorJsonValue, monotonicMs: number): void {
    /**
     * 常量说明：record 用于处理 record 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const record = this.record(topic, payload, monotonicMs)
    /**
     * 常量说明：previous 用于处理 previous 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const previous = this.state.get(topic)
    this.state.set(topic, record)
    if (!this.stateFits()) {
      if (previous === undefined) this.state.delete(topic)
      else this.state.set(topic, previous)
      throw new Error('inspector: source state exceeds the source-frame byte limit')
    }
    this.enqueue(record)
  }

  /**
   * Build a complete state replacement and absorb every preceding queue drop.
   * @param sourceId - Logical source identity.
   * @param generation - Current transport generation.
   * @returns A replacement frame whose sequence is the next append position.
   * @remarks 中文说明：功能说明：处理 replacement 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：sourceId（InspectorSourceId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：generation（InspectorSourceGeneration）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：SourceReplaceFrame；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * replacement(sourceId, generation)，并按返回类型处理结果。
   */
  replacement(sourceId: InspectorSourceId, generation: InspectorSourceGeneration): SourceReplaceFrame {
    /**
     * 常量说明：nextSequence 用于处理 nextSequence 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const nextSequence = this.queue[0]?.sequence ?? this.nextSequence
    this.expectedSequence = nextSequence
    return {
      v: INSPECTOR_PROTOCOL_VERSION,
      t: 'source/replace',
      sourceId,
      generation,
      nextSequence,
      records: [...this.state.values()],
    }
  }

  /**
   * Remove and sequence the next transport-sized observation batch.
   * @param sourceId - Logical source identity.
   * @param generation - Current transport generation.
   * @returns The next append frame, or `undefined` when the queue is empty.
   * @remarks 中文说明：功能说明：处理 takeBatch 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：sourceId（InspectorSourceId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：generation（InspectorSourceGeneration）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：SourceAppendFrame | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 takeBatch(sourceId, generation)，并按返回类型处理结果。
   */
  takeBatch(sourceId: InspectorSourceId, generation: InspectorSourceGeneration): SourceAppendFrame | undefined {
    if (this.queue.length === 0) return undefined
    /**
     * 常量说明：batch 用于处理 batch 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const batch: QueuedRecord[] = []
    /**
     * 变量说明：batchBytes 用于处理 batchBytes 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let batchBytes = SOURCE_FRAME_OVERHEAD_BYTES
    /**
     * 常量说明：first 用于处理 first 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const first = this.queue[0] as QueuedRecord
    while (batch.length < this.options.maxRecordsPerFrame && this.queue.length > 0) {
      /**
       * 常量说明：candidate 用于处理 candidate 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const candidate = this.queue[0] as QueuedRecord
      if (candidate.sequence !== first.sequence + batch.length) break
      if (batch.length > 0 && batchBytes + candidate.bytes > this.options.maxFrameBytes) break
      this.queue.shift()
      batch.push(candidate)
      batchBytes += candidate.bytes
    }
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：sum（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：item（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(sum, item)，并按返回类型处理结果。
     */
    this.queuedBytes -= batch.reduce((sum, item) => sum + item.bytes, 0)
    /**
     * 常量说明：firstSequence 用于处理 firstSequence 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const firstSequence = first.sequence
    /**
     * 常量说明：frame 用于处理 frame 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
     */
    const frame: SourceAppendFrame = {
      v: INSPECTOR_PROTOCOL_VERSION,
      t: 'source/append',
      sourceId,
      generation,
      firstSequence,
      droppedBefore: firstSequence - this.expectedSequence,
      records: batch.map(item => item.record),
    }
    this.expectedSequence = firstSequence + frame.records.length
    return frame
  }

  /** Discard observations that have not entered a transport frame.
   * @remarks 中文说明：功能说明：处理 discardPending 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 discardPending()，
   * 并按返回类型处理结果。 */
  discardPending(): void {
    this.queue.length = 0
    this.queuedBytes = 0
  }

  /**
   * 功能说明：处理 record 相关流程；使用场景由所在模块及调用位置决定。
   * @param topic （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param payload （InspectorJsonValue）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param monotonicMs （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns InspectorRecordInput；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 record(topic, payload, monotonicMs)，并按返回类型处理结果。
   */
  private record(topic: string, payload: InspectorJsonValue, monotonicMs: number): InspectorRecordInput {
    if (topic.length === 0 || topic.length > 128) {
      throw new Error('inspector: topic must contain 1 to 128 characters')
    }
    if (!this.options.topics.includes('*') && !this.options.topics.includes(topic)) {
      throw new Error(`inspector: source does not declare topic ${JSON.stringify(topic)}`)
    }
    if (!isJsonValue(payload)) throw new Error('inspector: source payload must be lossless JSON data')
    if (!Number.isFinite(monotonicMs)) throw new Error('inspector: monotonicMs must be finite')
    return { monotonicMs, topic, payload }
  }

  /**
   * 功能说明：处理 enqueue 相关流程；使用场景由所在模块及调用位置决定。
   * @param record （InspectorRecordInput）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 enqueue(record)，并按返回类型处理结果。
   */
  private enqueue(record: InspectorRecordInput): void {
    /**
     * 常量说明：bytes 用于处理 bytes 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const bytes = jsonByteLength(record as unknown as InspectorJsonValue)
    /**
     * 常量说明：sequence 用于处理 sequence 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const sequence = this.nextSequence++
    if (bytes + SOURCE_FRAME_OVERHEAD_BYTES > this.options.maxFrameBytes) {
      return
    }
    this.queue.push({ sequence, bytes, record })
    this.queuedBytes += bytes
    while (this.queue.length > this.options.maxQueuedRecords || this.queuedBytes > this.options.maxQueuedBytes) {
      /**
       * 常量说明：dropped 用于处理 dropped 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const dropped = this.queue.shift() as QueuedRecord
      this.queuedBytes -= dropped.bytes
    }
  }

  /**
   * 功能说明：处理 stateFits 相关流程；使用场景由所在模块及调用位置决定。
   * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 stateFits()，并按返回类型处理结果。
   */
  private stateFits(): boolean {
    return jsonByteLength([...this.state.values()] as unknown as InspectorJsonValue) + SOURCE_FRAME_OVERHEAD_BYTES
      <= this.options.maxFrameBytes
  }
}
