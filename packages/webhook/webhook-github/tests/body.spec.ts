/**
 * 文件职责：验证 webhook/webhook-github 中 body spec 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import type { IncomingMessage } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { readBoundedUtf8Body } from '../src/body.ts'

/** Minimal async-iterable request for byte-level branches Node fetch cannot construct.
 * @remarks 中文说明：功能说明：处理 request 相关流程；使用场景由所在模块及调用位置决定。；参数说明：options（{
 * chunks?: Array<Buffer | string> contentLength?: string
 * co…）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；返回值：IncomingMessage & { resume:
 * ReturnType<typeof vi.fn> }；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 request(options)，并按返回类型处理结果。 */
function request(options: {
  chunks?: Array<Buffer | string>
  contentLength?: string
  complete?: boolean
  error?: unknown
} = {}): IncomingMessage & { resume: ReturnType<typeof vi.fn> } {
  /**
   * 常量说明：resume 用于处理 resume 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const resume = vi.fn()
  return {
    headers: {
      ...(options.contentLength === undefined ? {} : { 'content-length': options.contentLength }),
    },
    complete: options.complete ?? true,
    resume,
    /**
     * 功能说明：处理 [Symbol.asyncIterator] 相关流程；使用场景由所在模块及调用位置决定。
     * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 [Symbol.asyncIterator]()，并按返回类型处理结果。
     */
    async * [Symbol.asyncIterator]() {
      /**
       * 变量说明：chunk 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const chunk of options.chunks ?? []) yield chunk
      if (options.error !== undefined) throw options.error
    },
  } as unknown as IncomingMessage & { resume: ReturnType<typeof vi.fn> }
}

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('bounded webhook body intake', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('accepts an absent length and both Buffer and string chunks', async () => {
    await expect(readBoundedUtf8Body(request({ chunks: [Buffer.from('{'), '}'] }), 2)).resolves.toBe('{}')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('rejects malformed, unsafe, and oversized declared lengths', async () => {
    await expect(readBoundedUtf8Body(request({ contentLength: '01' }), 10)).rejects.toMatchObject({ status: 400 })
    await expect(readBoundedUtf8Body(request({ contentLength: '999999999999999999999' }), Number.MAX_SAFE_INTEGER))
      .rejects.toMatchObject({ status: 413 })
    /**
     * 常量说明：oversized 用于处理 oversized 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const oversized = request({ contentLength: '3' })
    await expect(readBoundedUtf8Body(oversized, 2)).rejects.toMatchObject({ status: 413 })
    expect(oversized.resume).toHaveBeenCalledOnce()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('rejects a chunked body at the first byte beyond the cap', async () => {
    /**
     * 常量说明：streamed 用于处理 streamed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const streamed = request({ chunks: [Buffer.from('ab'), Buffer.from('c')] })
    await expect(readBoundedUtf8Body(streamed, 2)).rejects.toMatchObject({ status: 413 })
    expect(streamed.resume).toHaveBeenCalledOnce()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('normalizes stream failure and incomplete EOF as an aborted body', async () => {
    await expect(readBoundedUtf8Body(request({ error: new Error('socket') }), 10))
      .rejects.toMatchObject({ status: 400, message: 'request body was aborted' })
    await expect(readBoundedUtf8Body(request({ complete: false }), 10))
      .rejects.toMatchObject({ status: 400, message: 'request body was aborted' })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('rejects invalid UTF-8 after a complete bounded read', async () => {
    await expect(readBoundedUtf8Body(request({ chunks: [Buffer.from([0xff])] }), 1))
      .rejects.toMatchObject({ status: 400, message: 'request body is not valid UTF-8' })
  })
})
