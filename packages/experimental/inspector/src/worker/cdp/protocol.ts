/** Minimal CDP request and transport types owned by the Worker.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 protocol 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import { isPlainObject } from '../../shared/json.ts'

/** Parsed client request. */
export interface CdpRequest {
  readonly id: number
  readonly method: string
  readonly params: Readonly<Record<string, unknown>>
}

/** Outbound CDP event. */
export interface CdpNotification {
  readonly method: string
  readonly params: Readonly<Record<string, unknown>>
}

/** A connected DevTools transport. */
export interface CdpTransport {
  /**
   * 功能说明：处理 send 相关流程；使用场景由所在模块及调用位置决定。
   * @param payload （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 send(payload)，并按返回类型处理结果。
   */
  send(payload: unknown): void
  /**
   * 功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 close()，并按返回类型处理结果。
   */
  close(): void
}

/**
 * Parse one DevTools request before routing it.
 * @param value - Untrusted decoded WebSocket payload.
 * @returns The validated request envelope.
 * @remarks 中文说明：功能说明：解析 Cdp Request 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：CdpRequest；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 parseCdpRequest(value)，
 * 并按返回类型处理结果。
 */
export function parseCdpRequest(value: unknown): CdpRequest {
  if (!isPlainObject(value)
    || !Number.isSafeInteger(value.id)
    || (value.id as number) < 0
    || typeof value.method !== 'string'
    || value.method.length === 0
    || (value.params !== undefined && !isPlainObject(value.params))) {
    throw new Error('inspector CDP: invalid request')
  }
  return {
    id: value.id as number,
    method: value.method,
    params: value.params ?? {},
  }
}

/**
 * Build a stable CDP error response.
 * @param id - Request id copied from the caller.
 * @param code - JSON-RPC error code.
 * @param message - Human-readable failure reason.
 * @returns The CDP error envelope.
 * @remarks 中文说明：功能说明：处理 cdpError 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：id（number）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。；
 * 参数说明：code（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：message（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：object；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 cdpError(id, code,
 * message)，并按返回类型处理结果。
 */
export function cdpError(id: number, code: number, message: string): object {
  return { id, error: { code, message } }
}

/**
 * Send one failed CDP operation using the domain error code.
 * @param transport - Connection receiving the response.
 * @param request - Request supplying the response id.
 * @param error - Rejection or synchronous error to render.
 * @remarks 中文说明：功能说明：处理 sendCdpFailure 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：transport（CdpTransport）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：request（CdpRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；
 * 参数说明：error（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 sendCdpFailure(transport, request,
 * error)，并按返回类型处理结果。
 */
export function sendCdpFailure(transport: CdpTransport, request: CdpRequest, error: unknown): void {
  /**
   * 常量说明：message 用于处理 message 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const message = error instanceof Error ? error.message : String(error)
  transport.send(cdpError(request.id, -32000, message))
}

/**
 * Settle an asynchronous CDP operation through one transport.
 * @param transport - Connection receiving the response.
 * @param request - Request supplying the response id.
 * @param operation - Domain operation that produces the result.
 * @remarks 中文说明：功能说明：处理 respondToCdpRequest 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：transport（CdpTransport）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：request（CdpRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；
 * 参数说明：operation（() => Promise<object>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * respondToCdpRequest(transport, request, operation)，并按返回类型处理结果。
 */
export function respondToCdpRequest(
  transport: CdpTransport,
  request: CdpRequest,
  operation: () => Promise<object>,
): void {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：result（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(result)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（unknown）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(error)，并按返回类型处理结果。
   */
  void operation().then(
    (result) => { transport.send({ id: request.id, result }) },
    (error: unknown) => { sendCdpFailure(transport, request, error) },
  )
}
