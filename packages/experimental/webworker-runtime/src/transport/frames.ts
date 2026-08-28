/**
 * Tunnel frame protocol between the page and the worker host. Frames cross
 * `postMessage`, so inbound frames are validated before use.
 * @module @deepseek-ai/dsh-experimental-webworker-runtime/src/transport/frames
 */

/** Request identifier minted by the page.
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 frames 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */
export type TunnelRequestId = string | number

/** One request; `body` carries the raw bytes for methods that have one. */
export interface TunnelRequestFrame {
  readonly t: 'req'
  readonly id: TunnelRequestId
  readonly method: string
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  readonly body?: ArrayBuffer | undefined
}

/** Open one Gateway Remote stream over the worker-local carrier. */
export interface TunnelStreamOpenFrame {
  readonly t: 'stream-open'
  readonly id: TunnelRequestId
  readonly endpoint: string
  readonly payload: unknown
}

/** Page-side cancellation of an in-flight request or stream. */
export interface TunnelAbortFrame {
  readonly t: 'abort'
  readonly id: TunnelRequestId
}

/** Frames the worker accepts. */
/**
 * First inbound frame: the base image URL and ordered data overlays selected
 * before the worker assembly starts.
 */
export interface TunnelInitFrame {
  readonly t: 'init'
  readonly image: string
  readonly overlays: readonly string[]
}

/** Every frame the page sends the worker. */
export type TunnelInboundFrame =
  | TunnelInitFrame
  | TunnelRequestFrame
  | TunnelStreamOpenFrame
  | TunnelAbortFrame

/** Complete response for unary requests and static files. */
export interface TunnelResponseFrame {
  readonly t: 'res'
  readonly id: TunnelRequestId
  readonly status: number
  readonly headers: Record<string, string>
  readonly body?: ArrayBuffer | undefined
  /** Present when the worker itself refused the request, so the page can surface the reason. */
  readonly message?: string | undefined
}

/** Head of a streamed response, followed by chunks and one terminator. */
export interface TunnelResponseHeadFrame {
  readonly t: 'res-head'
  readonly id: TunnelRequestId
  readonly status: number
  readonly headers: Record<string, string>
}

/** One body chunk of a streamed response. */
export interface TunnelResponseChunkFrame {
  readonly t: 'res-chunk'
  readonly id: TunnelRequestId
  readonly chunk: ArrayBuffer
}

/** Normal end of a streamed response. */
export interface TunnelResponseEndFrame {
  readonly t: 'res-end'
  readonly id: TunnelRequestId
}

/** Failure of a streamed response after its head was sent. */
export interface TunnelResponseErrorFrame {
  readonly t: 'res-err'
  readonly id: TunnelRequestId
  readonly message: string
}

/** One decoded value from a worker-local Gateway Remote stream. */
export interface TunnelStreamItemFrame {
  readonly t: 'stream-item'
  readonly id: TunnelRequestId
  readonly value?: unknown
}

/** Normal completion of a worker-local Gateway Remote stream. */
export interface TunnelStreamEndFrame {
  readonly t: 'stream-end'
  readonly id: TunnelRequestId
}

/** Stable Host failure or worker-carrier failure for one logical stream. */
export interface TunnelStreamErrorFrame {
  readonly t: 'stream-error'
  readonly id: TunnelRequestId
  readonly failure:
    | {
      readonly kind: 'remote'
      readonly code: string
      readonly message: string
      readonly details: object
    }
    | {
      readonly kind: 'carrier'
      readonly message: string
    }
}

/** Frames the worker emits. */
export type TunnelOutboundFrame =
  | TunnelResponseFrame
  | TunnelResponseHeadFrame
  | TunnelResponseChunkFrame
  | TunnelResponseEndFrame
  | TunnelResponseErrorFrame
  | TunnelStreamItemFrame
  | TunnelStreamEndFrame
  | TunnelStreamErrorFrame

/**
 * Validate a `postMessage` payload as a tunnel frame.
 * @param data - Message data received by the worker.
 * @returns The frame.
 * @remarks 中文说明：功能说明：解析 Inbound Frame 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：data（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：TunnelInboundFrame；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 parseInboundFrame(data)，
 * 并按返回类型处理结果。
 */
export function parseInboundFrame(data: unknown): TunnelInboundFrame {
  if (typeof data !== 'object' || data === null) {
    throw new Error(`webworker tunnel: message is not a frame: ${String(data)}`)
  }
  /**
   * 常量说明：frame 用于处理 frame 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const frame = data as Record<string, unknown>
  if (frame.t === 'init') {
    if (typeof frame.image !== 'string') {
      throw new Error('webworker tunnel: init frame needs a string image url')
    }
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：overlay（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(overlay)，并按返回类型处理结果。
     */
    if (!Array.isArray(frame.overlays) || frame.overlays.some(overlay => typeof overlay !== 'string')) {
      throw new Error('webworker tunnel: init frame needs an array of string overlay urls')
    }
    return { t: 'init', image: frame.image, overlays: frame.overlays as string[] }
  }
  /**
   * 常量说明：id 用于处理 id 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const id = frame.id
  if (typeof id !== 'string' && typeof id !== 'number') {
    throw new Error(`webworker tunnel: frame has no usable id: ${JSON.stringify(frame.id)}`)
  }
  if (frame.t === 'abort') return { t: 'abort', id }
  if (frame.t === 'stream-open') {
    if (typeof frame.endpoint !== 'string' || frame.endpoint.length === 0) {
      throw new Error(`webworker tunnel: stream ${String(id)} needs a non-empty endpoint`)
    }
    return { t: 'stream-open', id, endpoint: frame.endpoint, payload: frame.payload }
  }
  if (frame.t !== 'req') throw new Error(`webworker tunnel: unknown frame type ${JSON.stringify(frame.t)}`)
  if (typeof frame.method !== 'string' || typeof frame.url !== 'string') {
    throw new Error(`webworker tunnel: request ${String(id)} needs string method and url`)
  }
  if (typeof frame.headers !== 'object' || frame.headers === null) {
    throw new Error(`webworker tunnel: request ${String(id)} needs a headers object`)
  }
  /**
   * 常量说明：headers 用于处理 headers 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const headers: Record<string, string> = {}
  /**
   * 变量说明：key、value 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const [key, value] of Object.entries(frame.headers)) {
    if (typeof value === 'string') headers[key.toLowerCase()] = value
  }
  /**
   * 常量说明：body 用于处理 body 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const body = frame.body
  if (body !== undefined && !(body instanceof ArrayBuffer)) {
    throw new Error(`webworker tunnel: request ${String(id)} body must be an ArrayBuffer`)
  }
  return { t: 'req', id, method: frame.method, url: frame.url, headers, body }
}
