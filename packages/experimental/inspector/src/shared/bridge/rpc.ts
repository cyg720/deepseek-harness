/** Shared Host/Client owner of correlated non-CDP query requests.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 rpc 模块的职责，并向相邻模块提供可复用能力。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import { inspectorId, type InspectorSourceGeneration, type InspectorSourceId } from './ids.ts'
import { jsonByteLength, type InspectorJsonValue } from '../json.ts'
import { INSPECTOR_PROTOCOL_VERSION } from './version.ts'
import type {
  InspectorQuery,
  InspectorQueryError,
  InspectorQueryRequester,
  InspectorQueryResult,
  InspectorQueryResultFor,
} from './messages/query/commands.ts'
import { isInspectorQueryResponseEnvelope, parseInspectorQueryResponseFrame } from './messages/query/codec.ts'
import type { InspectorQueryRequestFrame, InspectorQueryRequestId } from './messages/query/frames.ts'

/** Active carrier write used by the shared query owner. */
export interface InspectorQuerySender {
  /**
   * Send one validated query request frame.
   * @param frame - Request belonging to the active source generation.
   * @remarks 中文说明：功能说明：处理 send 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：frame（InspectorQueryRequestFrame）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 send(frame)，
   * 并按返回类型处理结果。
   */
  send(frame: InspectorQueryRequestFrame): void
}

/** Bounds applied by one Host or Client query connection. */
export interface InspectorQueryConnectionOptions {
  readonly timeoutMs: number
  readonly maxFrameBytes: number
}

interface PendingQuery {
  readonly op: string
  readonly resolve: (result: InspectorQueryResult) => void
  readonly reject: (error: Error) => void
  readonly timer: ReturnType<typeof setTimeout>
}

interface QueryGeneration {
  readonly sourceId: InspectorSourceId
  readonly generation: InspectorSourceGeneration
  readonly sender: InspectorQuerySender
}

/** Failure deliberately returned by the Worker query handler.
 * @remarks 中文说明：类说明：InspectorQueryRemoteError 用于集中封装 处理
 * InspectorQueryRemoteError 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；
 * 使用场景：由 experimental/inspector 在对应插件或业务生命周期内创建和调用。 */
export class InspectorQueryRemoteError extends Error {
  /**
   * 功能说明：处理 InspectorQueryRemoteError 相关流程；使用场景由所在模块及调用位置决定。
   * @param code （InspectorQueryError['code']）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param message （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new InspectorQueryRemoteError(code, message) 创建实例，
   * 并在所属生命周期内使用。
   */
  constructor(readonly code: InspectorQueryError['code'], message: string) {
    super(message)
  }
}

/** Correlates requests for one reconnecting Host or Client source.
 * @remarks 中文说明：类说明：InspectorQueryConnection 用于集中封装 处理
 * InspectorQueryConnection 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；
 * 使用场景：由 experimental/inspector 在对应插件或业务生命周期内创建和调用。 */
export class InspectorQueryConnection implements InspectorQueryRequester {
  /**
   * 常量说明：pending 用于处理 pending 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly pending = new Map<InspectorQueryRequestId, PendingQuery>()
  /**
   * 变量说明：active 用于处理 active 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private active: QueryGeneration | undefined
  /**
   * 变量说明：nextRequestId 用于处理 nextRequestId 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private nextRequestId = 0
  /**
   * 变量说明：closed 用于处理 closed 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private closed = false

  /**
   * 功能说明：处理 InspectorQueryConnection 相关流程；使用场景由所在模块及调用位置决定。
   * @param options （InspectorQueryConnectionOptions）：提供本次操作使用的配置选项；
   * 必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new InspectorQueryConnection(options) 创建实例，并在所属生命周期内使用。
   */
  constructor(private readonly options: InspectorQueryConnectionOptions) {}

  /**
   * Admit the source generation acknowledged by the Worker.
   * @param sourceId - Stable source identity.
   * @param generation - Newly accepted transport generation.
   * @param sender - Carrier writer valid for that generation.
   * @remarks 中文说明：功能说明：处理 connect 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：sourceId（InspectorSourceId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：generation（InspectorSourceGeneration）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：sender（InspectorQuerySender）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 connect(sourceId,
   * generation, sender)，并按返回类型处理结果。
   */
  connect(sourceId: InspectorSourceId, generation: InspectorSourceGeneration, sender: InspectorQuerySender): void {
    if (this.closed) throw new Error('inspector query connection is closed')
    this.disconnect('Inspector source generation replaced')
    this.active = { sourceId, generation, sender }
  }

  /**
   * Execute a query against the currently accepted source generation.
   * @param query - Closed typed query command.
   * @returns The result with the same operation discriminant.
   * @remarks 中文说明：功能说明：处理 request 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：query（Query）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<InspectorQueryResultFor<Query>>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 request(query)，并按返回类型处理结果。
   */
  request<Query extends InspectorQuery>(query: Query): Promise<InspectorQueryResultFor<Query>> {
    /**
     * 常量说明：active 用于处理 active 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const active = this.active
    if (this.closed || active === undefined) {
      return Promise.reject(new Error('Inspector query transport is not connected'))
    }
    /**
     * 常量说明：requestId 用于处理 requestId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const requestId = inspectorId<'InspectorQueryRequestId'>(`query-${String(++this.nextRequestId)}`, 'requestId')
    /**
     * 常量说明：frame 用于处理 frame 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const frame: InspectorQueryRequestFrame = {
      v: INSPECTOR_PROTOCOL_VERSION,
      t: 'query/request',
      sourceId: active.sourceId,
      generation: active.generation,
      requestId,
      query,
    }
    if (jsonByteLength(frame as unknown as InspectorJsonValue) > this.options.maxFrameBytes) {
      return Promise.reject(new Error(`Inspector query request exceeds ${String(this.options.maxFrameBytes)} bytes`))
    }
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：reject（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve, reject)，
     * 并按返回类型处理结果。
     */
    const result = new Promise<InspectorQueryResult>((resolve, reject) => {
      /**
       * 常量说明：timer 用于处理 timer 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error(`Inspector query ${query.op} timed out after ${String(this.options.timeoutMs)}ms`))
      }, this.options.timeoutMs)
      this.pending.set(requestId, { op: query.op, resolve, reject, timer })
      /**
       * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
       */
      try {
        active.sender.send(frame)
      } catch (error) {
        this.rejectPending(requestId, renderError(error))
      }
    })
    return result as Promise<InspectorQueryResultFor<Query>>
  }

  /**
   * Consume a decoded carrier value when it is a query response.
   * @param value - Untrusted Worker-to-source value.
   * @returns Whether the value belonged to the query protocol.
   * @remarks 中文说明：功能说明：处理 receive 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：boolean；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 receive(value)，并按返回类型处理结果。
   */
  receive(value: unknown): boolean {
    if (!isInspectorQueryResponseEnvelope(value)) return false
    /**
     * 变量说明：frame 用于处理 frame 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let frame
    /**
     * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      frame = parseInspectorQueryResponseFrame(value)
      if (jsonByteLength(frame as unknown as InspectorJsonValue) > this.options.maxFrameBytes) {
        throw new Error(`inspector protocol: query response exceeds ${String(this.options.maxFrameBytes)} bytes`)
      }
    } catch (error) {
      this.disconnect(`Invalid Inspector query response: ${renderError(error).message}`)
      throw error
    }
    /**
     * 常量说明：pending 用于处理 pending 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const pending = this.pending.get(frame.requestId)
    if (pending === undefined) return true
    /**
     * 常量说明：active 用于处理 active 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const active = this.active
    if (active === undefined || frame.sourceId !== active.sourceId || frame.generation !== active.generation) {
      this.rejectPending(frame.requestId, new Error('Inspector query response source generation does not match'))
      return true
    }
    if (!frame.outcome.ok) {
      this.rejectPending(frame.requestId, new InspectorQueryRemoteError(
        frame.outcome.error.code,
        frame.outcome.error.message,
      ))
      return true
    }
    if (frame.outcome.result.op !== pending.op) {
      this.rejectPending(frame.requestId, new Error(
        `Inspector query response op ${frame.outcome.result.op} does not match ${pending.op}`,
      ))
      return true
    }
    clearTimeout(pending.timer)
    this.pending.delete(frame.requestId)
    pending.resolve(frame.outcome.result)
    return true
  }

  /**
   * Reject active requests while permitting a later source generation.
   * @param reason - Failure reported to every pending caller.
   * @remarks 中文说明：功能说明：处理 disconnect 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：reason（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 disconnect(reason)，并按返回类型处理结果。
   */
  disconnect(reason: string): void {
    this.active = undefined
    /**
     * 变量说明：requestId 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const requestId of [...this.pending.keys()]) this.rejectPending(requestId, new Error(reason))
  }

  /**
   * Permanently reject requests and prevent later reconnection.
   * @param reason - Failure reported to every pending caller.
   * @remarks 中文说明：功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。；参数说明：reason（由
   * TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 close(reason)，并按返回类型处理结果。
   */
  close(reason = 'Inspector query connection closed'): void {
    if (this.closed) return
    this.closed = true
    this.disconnect(reason)
  }

  /**
   * 功能说明：处理 rejectPending 相关流程；使用场景由所在模块及调用位置决定。
   * @param requestId （InspectorQueryRequestId）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @param error （Error）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 rejectPending(requestId, error)，并按返回类型处理结果。
   */
  private rejectPending(requestId: InspectorQueryRequestId, error: Error): void {
    /**
     * 常量说明：pending 用于处理 pending 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const pending = this.pending.get(requestId)
    if (pending === undefined) return
    clearTimeout(pending.timer)
    this.pending.delete(requestId)
    pending.reject(error)
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
