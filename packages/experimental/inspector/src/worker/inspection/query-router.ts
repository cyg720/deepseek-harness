/** Worker-side admission, execution, and bounded settlement of non-CDP queries.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 query router 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { CordisRuntimeTreeReader } from '../../shared/cordis/reader.ts'
import type { InspectorSourceGeneration, InspectorSourceId } from '../../shared/bridge/ids.ts'
import { jsonByteLength, type InspectorJsonValue } from '../../shared/json.ts'
import type { InspectorSourceDescriptor } from '../../shared/bridge/messages/observation.ts'
import type { InspectorQueryError } from '../../shared/bridge/messages/query/commands.ts'
import {
  isInspectorQueryRequestEnvelope,
  parseInspectorQueryFrameIdentity,
  parseInspectorQueryRequestFrame,
} from '../../shared/bridge/messages/query/codec.ts'
import type {
  InspectorQueryRequestFrame,
  InspectorQueryRequestId,
  InspectorQueryResponseFrame,
} from '../../shared/bridge/messages/query/frames.ts'
import { INSPECTOR_PROTOCOL_VERSION } from '../../shared/bridge/version.ts'
import { executeInspectorQuery } from './cordis-query.ts'

/** Carrier operations owned by one Worker query peer. */
export interface InspectorQueryPeerTransport {
  /** Send one bounded Worker response.
   * @remarks 中文说明：功能说明：处理 send 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：frame（InspectorQueryResponseFrame）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 send(frame)，
   * 并按返回类型处理结果。 */
  send(frame: InspectorQueryResponseFrame): void
  /** Reject a malformed peer whose request cannot be correlated safely.
   * @remarks 中文说明：功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：code（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：reason（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 close(code, reason)，并按返回类型处理结果。 */
  close(code: number, reason: string): void
}

interface AcceptedGeneration {
  readonly sourceId: InspectorSourceId
  readonly generation: InspectorSourceGeneration
}

/** Creates isolated query peers over one shared semantic reader.
 * @remarks 中文说明：类说明：InspectorQueryRouter 用于集中封装 处理 InspectorQueryRouter
 * 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由
 * experimental/inspector 在对应插件或业务生命周期内创建和调用。 */
export class InspectorQueryRouter {
  /**
   * 常量说明：peers 用于处理 peers 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly peers = new Set<InspectorQueryPeer>()
  /**
   * 常量说明：activeBySource 用于处理 activeBySource 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly activeBySource = new Map<InspectorSourceId, {
    readonly generation: InspectorSourceGeneration
    readonly peer: InspectorQueryPeer
  }>()

  /**
   * 功能说明：处理 InspectorQueryRouter 相关流程；使用场景由所在模块及调用位置决定。
   * @param reader （CordisRuntimeTreeReader）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param maxFrameBytes （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new InspectorQueryRouter(reader, maxFrameBytes) 创建实例，
   * 并在所属生命周期内使用。
   */
  constructor(
    private readonly reader: CordisRuntimeTreeReader,
    private readonly maxFrameBytes: number,
  ) {}

  /**
   * Create query state for one Host MessagePort or Client WebSocket.
   * @param transport - Carrier response and rejection operations.
   * @returns The peer that receives frames from this carrier only.
  * @remarks 中文说明：功能说明：打开 open 相关流程；使用场景由所在模块及调用位置决定。；
  * 参数说明：transport（InspectorQueryPeerTransport）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
  * ；返回值：InspectorQueryPeer；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
  * open(transport)，并按返回类型处理结果。
  */
  open(transport: InspectorQueryPeerTransport): InspectorQueryPeer {
    /**
     * 常量说明：peer 用于处理 peer 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：accepted（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(accepted)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：accepted（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：boolean；调用方应按声明类型处理，
     * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(accepted)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const peer: InspectorQueryPeer = new InspectorQueryPeer(
      this.reader,
      this.maxFrameBytes,
      transport,
      (accepted) => {
        /**
         * 变量说明：sourceId、active 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
         */
        for (const [sourceId, active] of this.activeBySource) {
          if (active.peer === peer) this.activeBySource.delete(sourceId)
        }
        this.activeBySource.set(accepted.sourceId, { ...accepted, peer })
      },
      (accepted): boolean => this.activeBySource.get(accepted.sourceId)?.peer === peer
        && this.activeBySource.get(accepted.sourceId)?.generation === accepted.generation,
      () => {
        this.peers.delete(peer)
        /**
         * 变量说明：sourceId、active 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
         */
        for (const [sourceId, active] of this.activeBySource) {
          if (active.peer === peer) this.activeBySource.delete(sourceId)
        }
      },
    )
    this.peers.add(peer)
    return peer
  }

  /**
   * Revoke query access when the source registry closes one generation.
   * @param source - Closed source generation.
   * @remarks 中文说明：功能说明：处理 disconnect 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：source（InspectorSourceDescriptor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * disconnect(source)，并按返回类型处理结果。
   */
  disconnect(source: InspectorSourceDescriptor): void {
    /**
     * 常量说明：active 用于处理 active 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const active = this.activeBySource.get(source.sourceId)
    if (active?.generation !== source.generation) return
    this.activeBySource.delete(source.sourceId)
    active.peer.revoke(source.sourceId, source.generation)
  }

  /** Revoke every peer during Worker shutdown.
   * @remarks 中文说明：功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 close()，并按返回类型处理结果。 */
  close(): void {
    /**
     * 变量说明：peer 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const peer of [...this.peers]) peer.close()
    this.activeBySource.clear()
  }
}

/** Query protocol state associated with exactly one source carrier.
 * @remarks 中文说明：类说明：InspectorQueryPeer 用于集中封装 处理 InspectorQueryPeer
 * 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由
 * experimental/inspector 在对应插件或业务生命周期内创建和调用。 */
export class InspectorQueryPeer {
  /**
   * 变量说明：accepted 用于处理 accepted 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private accepted: AcceptedGeneration | undefined
  /**
   * 常量说明：inFlight 用于处理 inFlight 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly inFlight = new Map<InspectorQueryRequestId, AcceptedGeneration>()
  /**
   * 变量说明：closed 用于处理 closed 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private closed = false

  /**
   * 功能说明：处理 InspectorQueryPeer 相关流程；使用场景由所在模块及调用位置决定。
   * @param reader （CordisRuntimeTreeReader）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param maxFrameBytes （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param transport （InspectorQueryPeerTransport）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @param register （(accepted: AcceptedGeneration) => void）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @param isRegistered （(accepted: AcceptedGeneration) =>
   * boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param unregister （() => void）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new InspectorQueryPeer(reader, maxFrameBytes, transport,
   * register, isRegistered, unregister) 创建实例，并在所属生命周期内使用。
   */
  constructor(
    private readonly reader: CordisRuntimeTreeReader,
    private readonly maxFrameBytes: number,
    private readonly transport: InspectorQueryPeerTransport,
    private readonly register: (accepted: AcceptedGeneration) => void,
    private readonly isRegistered: (accepted: AcceptedGeneration) => boolean,
    private readonly unregister: () => void,
  ) {}

  /**
   * Admit the source generation after the source registry accepts it.
   * @param sourceId - Stable source identity.
   * @param generation - Active carrier generation.
   * @remarks 中文说明：功能说明：处理 accept 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：sourceId（InspectorSourceId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：generation（InspectorSourceGeneration）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 accept(sourceId,
   * generation)，并按返回类型处理结果。
   */
  accept(sourceId: InspectorSourceId, generation: InspectorSourceGeneration): void {
    if (this.closed) return
    this.accepted = { sourceId, generation }
    this.inFlight.clear()
    this.register(this.accepted)
  }

  /**
   * Revoke one generation while leaving its carrier available for a later source/open.
   * @param sourceId - Stable source identity.
   * @param generation - Generation being removed by the source registry.
   * @remarks 中文说明：功能说明：处理 revoke 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：sourceId（InspectorSourceId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：generation（InspectorSourceGeneration）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 revoke(sourceId,
   * generation)，并按返回类型处理结果。
   */
  revoke(sourceId: InspectorSourceId, generation: InspectorSourceGeneration): void {
    if (this.accepted?.sourceId !== sourceId || this.accepted.generation !== generation) return
    this.accepted = undefined
    this.inFlight.clear()
  }

  /**
   * Consume a decoded carrier value when it belongs to the query protocol.
   * @param value - Untrusted source-to-Worker value.
   * @returns Whether this peer owned the value.
   * @remarks 中文说明：功能说明：处理 receive 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：boolean；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 receive(value)，并按返回类型处理结果。
   */
  receive(value: unknown): boolean {
    if (!isInspectorQueryRequestEnvelope(value)) return false
    /**
     * 变量说明：frame 用于处理 frame 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let frame: InspectorQueryRequestFrame
    /**
     * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      frame = parseInspectorQueryRequestFrame(value)
      if (jsonByteLength(frame as unknown as InspectorJsonValue) > this.maxFrameBytes) {
        throw new Error(`inspector protocol: query request exceeds ${String(this.maxFrameBytes)} bytes`)
      }
    } catch (error) {
      this.rejectMalformed(value, renderError(error))
      return true
    }
    /**
     * 常量说明：accepted 用于处理 accepted 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const accepted = this.accepted
    if (this.closed || accepted === undefined || !this.isRegistered(accepted)
      || accepted.sourceId !== frame.sourceId
      || accepted.generation !== frame.generation) {
      this.sendFailure(frame, 'stale-source', 'Inspector query does not belong to the accepted source generation')
      return true
    }
    if (this.inFlight.has(frame.requestId)) {
      this.sendFailure(frame, 'invalid-request', 'Inspector query requestId is already in flight')
      return true
    }
    this.inFlight.set(frame.requestId, accepted)
    void this.execute(frame, accepted)
    return true
  }

  /** Stop this peer and suppress completion from in-flight readers.
   * @remarks 中文说明：功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 close()，并按返回类型处理结果。 */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.accepted = undefined
    this.inFlight.clear()
    this.unregister()
  }

  /**
   * 功能说明：执行 execute 相关流程；使用场景由所在模块及调用位置决定。
   * @param frame （InspectorQueryRequestFrame）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param accepted （AcceptedGeneration）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 execute(frame, accepted)，并按返回类型处理结果。
   */
  private async execute(frame: InspectorQueryRequestFrame, accepted: AcceptedGeneration): Promise<void> {
    /**
     * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      /**
       * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const result = await executeInspectorQuery(this.reader, frame.query)
      if (!this.canReply(frame, accepted)) return
      /**
       * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const response: InspectorQueryResponseFrame = {
        v: INSPECTOR_PROTOCOL_VERSION,
        t: 'query/response',
        sourceId: frame.sourceId,
        generation: frame.generation,
        requestId: frame.requestId,
        outcome: { ok: true, result },
      }
      if (jsonByteLength(response as unknown as InspectorJsonValue) > this.maxFrameBytes) {
        this.sendFailure(frame, 'result-too-large', `Inspector query result exceeds ${String(this.maxFrameBytes)} bytes`)
        return
      }
      this.deliver(response)
    } catch (error) {
      if (this.canReply(frame, accepted)) this.sendFailure(frame, 'internal-error', renderError(error).message)
    } finally {
      if (this.inFlight.get(frame.requestId) === accepted) this.inFlight.delete(frame.requestId)
    }
  }

  /**
   * 功能说明：处理 rejectMalformed 相关流程；使用场景由所在模块及调用位置决定。
   * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param error （Error）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 rejectMalformed(value, error)，并按返回类型处理结果。
   */
  private rejectMalformed(value: unknown, error: Error): void {
    try {
      /**
       * 常量说明：identity 用于处理 identity 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const identity = parseInspectorQueryFrameIdentity(value)
      this.sendFailure(identity, 'invalid-request', error.message)
    } catch {
      this.rejectTransport(1008, error.message)
    }
  }

  /**
   * 功能说明：处理 sendFailure 相关流程；使用场景由所在模块及调用位置决定。
   * @param frame （Pick<InspectorQueryRequestFrame, 'sourceId' | 'generation'
   * …）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param code （InspectorQueryError['code']）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param message （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 sendFailure(frame, code, message)，并按返回类型处理结果。
   */
  private sendFailure(
    frame: Pick<InspectorQueryRequestFrame, 'sourceId' | 'generation' | 'requestId'>,
    code: InspectorQueryError['code'],
    message: string,
  ): void {
    if (this.closed) return
    /**
     * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const response: InspectorQueryResponseFrame = {
      v: INSPECTOR_PROTOCOL_VERSION,
      t: 'query/response',
      sourceId: frame.sourceId,
      generation: frame.generation,
      requestId: frame.requestId,
      outcome: { ok: false, error: { code, message } },
    }
    if (jsonByteLength(response as unknown as InspectorJsonValue) > this.maxFrameBytes) {
      this.rejectTransport(1009, 'Inspector query error exceeds the frame limit')
      return
    }
    this.deliver(response)
  }

  /**
   * 功能说明：判断是否能够 Reply 相关流程；使用场景由所在模块及调用位置决定。
   * @param frame （InspectorQueryRequestFrame）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param accepted （AcceptedGeneration）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 canReply(frame, accepted)，并按返回类型处理结果。
   */
  private canReply(frame: InspectorQueryRequestFrame, accepted: AcceptedGeneration): boolean {
    return !this.closed
      && this.accepted === accepted
      && this.isRegistered(accepted)
      && this.inFlight.get(frame.requestId) === accepted
  }

  /**
   * 功能说明：处理 deliver 相关流程；使用场景由所在模块及调用位置决定。
   * @param frame （InspectorQueryResponseFrame）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 deliver(frame)，并按返回类型处理结果。
   */
  private deliver(frame: InspectorQueryResponseFrame): void {
    /**
     * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      this.transport.send(frame)
    } catch (error) {
      this.rejectTransport(1011, renderError(error).message)
    }
  }

  /**
   * 功能说明：处理 rejectTransport 相关流程；使用场景由所在模块及调用位置决定。
   * @param code （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param reason （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 rejectTransport(code, reason)，并按返回类型处理结果。
   */
  private rejectTransport(code: number, reason: string): void {
    this.close()
    try {
      this.transport.close(code, reason.slice(0, 123))
    } catch {
      // The carrier is already unusable; query state has reached quiescence.
    }
  }
}

/**
 * 功能说明：渲染 Error 相关流程；使用场景由所在模块及调用位置决定。
 * @param error （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Error；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 renderError(error)，并按返回类型处理结果。
 */
function renderError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
