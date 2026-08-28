/** Bounded raw HTTP body intake for GitHub signature verification.
 * @remarks 文件说明：文件职责：实现 webhook/webhook-github 中 body 模块的职责，并向相邻模块提供可复用能力。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * webhook/webhook-github 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { IncomingMessage } from 'node:http'

/** HTTP refusal whose message is safe to return without request data.
 * @remarks 中文说明：类说明：WebhookHttpError 用于集中封装 处理 WebhookHttpError 相关状态与行为。；
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由 webhook/webhook-github
 * 在对应插件或业务生命周期内创建和调用。 */
export class WebhookHttpError extends Error {
  /**
   * 常量说明：name 用于处理 name 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  override readonly name = 'WebhookHttpError'

  /**
   * 功能说明：处理 WebhookHttpError 相关流程；使用场景由所在模块及调用位置决定。
   * @param status （400 | 401 | 405 | 413 | 415 | 503）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @param message （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new WebhookHttpError(status, message) 创建实例，并在所属生命周期内使用。
   */
  constructor(
    readonly status: 400 | 401 | 405 | 413 | 415 | 503,
    message: string,
  ) {
    super(message)
  }
}

/** Parse a decimal Content-Length or reject an ambiguous header.
 * @remarks 中文说明：功能说明：处理 contentLength 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：request（IncomingMessage）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；返回值：number
 * | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * contentLength(request)，并按返回类型处理结果。 */
function contentLength(request: IncomingMessage): number | undefined {
  /**
   * 常量说明：value 用于处理 value 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const value = request.headers['content-length']
  if (value === undefined) return undefined
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new WebhookHttpError(400, 'invalid Content-Length')
  }
  /**
   * 常量说明：length 用于处理 length 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const length = Number(value)
  if (!Number.isSafeInteger(length)) throw new WebhookHttpError(413, 'request body is too large')
  return length
}

/**
 * Read one request body as exact, bounded UTF-8 text.
 * @param request - incoming request before any parser consumes it.
 * @param maxBodyBytes - positive byte ceiling.
 * @returns the decoded body after EOF.
 * @throws {WebhookHttpError} for invalid length, excessive bytes, invalid UTF-8, or an aborted stream.
 * @remarks 中文说明：功能说明：读取 Bounded Utf8 Body 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：request（IncomingMessage）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；
 * 参数说明：maxBodyBytes（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：Promise<string>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * readBoundedUtf8Body(request, maxBodyBytes)，并按返回类型处理结果。
 */
export async function readBoundedUtf8Body(
  request: IncomingMessage,
  maxBodyBytes: number,
): Promise<string> {
  /**
   * 常量说明：declared 用于处理 declared 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const declared = contentLength(request)
  if (declared !== undefined && declared > maxBodyBytes) {
    request.resume()
    throw new WebhookHttpError(413, 'request body is too large')
  }

  /**
   * 常量说明：chunks 用于处理 chunks 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const chunks: Buffer[] = []
  /**
   * 变量说明：size 用于处理 size 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let size = 0
  /**
   * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
   */
  try {
    /**
     * 变量说明：raw 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for await (const raw of request) {
      /**
       * 常量说明：chunk 用于处理 chunk 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as string)
      size += chunk.byteLength
      if (size > maxBodyBytes) {
        request.resume()
        throw new WebhookHttpError(413, 'request body is too large')
      }
      chunks.push(chunk)
    }
  } catch (error: unknown) {
    if (error instanceof WebhookHttpError) throw error
    throw new WebhookHttpError(400, 'request body was aborted')
  }
  if (!request.complete) throw new WebhookHttpError(400, 'request body was aborted')
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size))
  } catch {
    // TextDecoder is the only statement in the try; GitHub JSON must be valid UTF-8.
    throw new WebhookHttpError(400, 'request body is not valid UTF-8')
  }
}
