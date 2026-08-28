/** Host fetch observation behavior.
 * @remarks 文件说明：文件职责：验证 experimental/inspector 中 fetch observer host spec
 * 相关行为与失败场景。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { installFetchObserver, type FetchObserver } from '../src/host/inspection/network.ts'
import type { InspectorRecordInput } from '../src/shared/bridge/messages/observation.ts'
import type { InspectorJsonValue } from '../src/shared/json.ts'

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('full fetch observer', () => {
  /**
   * 常量说明：originalDescriptor 用于处理 originalDescriptor 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch')
  /**
   * 变量说明：observer 用于处理 observer 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let observer: FetchObserver | undefined

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  afterEach(async () => {
    await observer?.stop()
    observer = undefined
    vi.restoreAllMocks()
    if (originalDescriptor === undefined) Reflect.deleteProperty(globalThis, 'fetch')
    else Object.defineProperty(globalThis, 'fetch', originalDescriptor)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('captures complete URL, headers, request body, response headers, and response body', async () => {
    /**
     * 常量说明：records 用于处理 records 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const records: InspectorRecordInput[] = []
    /**
     * 常量说明：native 用于处理 native 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：request（Request）：提供调用方提交的请求信息；
     * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
     * 典型用法：在完成前置校验后调用 匿名回调(request)，并按返回类型处理结果。
     */
    const native = vi.fn(async (request: Request) => {
      expect(await request.clone().text()).toBe('secret request body')
      return new Response('complete response body', {
        status: 201,
        statusText: 'Created',
        headers: { authorization: 'response secret', 'content-type': 'text/plain' },
      })
    })
    Object.defineProperty(globalThis, 'fetch', { value: native, writable: true, configurable: true })
    observer = installFetchObserver({
      /**
       * 功能说明：处理 publish 相关流程；使用场景由所在模块及调用位置决定。
       * @param topic （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @param payload （InspectorJsonValue）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @param monotonicMs （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；
       * 必须满足声明的类型及调用时序要求。
       * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 publish(topic, payload, monotonicMs)，并按返回类型处理结果。
       */
      publish(topic: string, payload: InspectorJsonValue, monotonicMs = performance.now()) {
        records.push({ topic, payload, monotonicMs })
      },
    }, { maxRequestBodyBytes: 1_024, maxResponseBodyBytes: 1_024, maxChunkBytes: 4 })

    /**
     * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const response = await fetch('https://example.test/path?token=visible', {
      method: 'POST',
      headers: { authorization: 'Bearer visible' },
      body: 'secret request body',
    })
    expect(await response.text()).toBe('complete response body')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => { /**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：record（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(record)，并按返回类型处理结果。
 */
expect(records.some(record => record.topic === 'fetch/end')).toBe(true) })

    /**
     * 常量说明：start 用于启动 start 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const start = payload(records, 'fetch/start')
    expect(start).toMatchObject({
      url: 'https://example.test/path?token=visible',
      method: 'POST',
    })
    expect(start.headers).toEqual(expect.arrayContaining([['authorization', 'Bearer visible']]))
    expect(decodeChunks(records, 'fetch/request-body-chunk')).toBe('secret request body')
    /**
     * 常量说明：responseRecord 用于处理 responseRecord 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const responseRecord = payload(records, 'fetch/response')
    expect(responseRecord.status).toBe(201)
    expect(responseRecord.headers).toEqual(expect.arrayContaining([['authorization', 'response secret']]))
    expect(decodeChunks(records, 'fetch/response-body-chunk')).toBe('complete response body')
    expect(payload(records, 'fetch/request-body-end')).toMatchObject({ truncated: false })
    expect(payload(records, 'fetch/end')).toMatchObject({ responseBodyTruncated: false })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('marks bodies truncated without changing the caller response', async () => {
    /**
     * 常量说明：records 用于处理 records 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const records: InspectorRecordInput[] = []
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    Object.defineProperty(globalThis, 'fetch', {
      value: vi.fn(() => Promise.resolve(new Response('response-long'))),
      writable: true,
      configurable: true,
    })
    observer = installFetchObserver({
      /**
       * 功能说明：处理 publish 相关流程；使用场景由所在模块及调用位置决定。
       * @param topic （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @param payload （InspectorJsonValue）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @param monotonicMs （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；
       * 必须满足声明的类型及调用时序要求。
       * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 publish(topic, payload, monotonicMs)，并按返回类型处理结果。
       */
      publish(topic: string, payload: InspectorJsonValue, monotonicMs = performance.now()) {
        records.push({ topic, payload, monotonicMs })
      },
    }, { maxRequestBodyBytes: 4, maxResponseBodyBytes: 4, maxChunkBytes: 2 })

    /**
     * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const response = await fetch('https://example.test/', { method: 'POST', body: 'request-long' })
    expect(await response.text()).toBe('response-long')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => { /**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：record（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(record)，并按返回类型处理结果。
 */
expect(records.some(record => record.topic === 'fetch/end')).toBe(true) })

    expect(decodeChunks(records, 'fetch/request-body-chunk')).toBe('requ')
    expect(payload(records, 'fetch/request-body-end')).toMatchObject({ capturedBytes: 4, truncated: true })
    expect(decodeChunks(records, 'fetch/response-body-chunk')).toBe('resp')
    expect(payload(records, 'fetch/end')).toMatchObject({ capturedBytes: 4, responseBodyTruncated: true })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('finishes response capture when the caller aborts after response headers', async () => {
    /**
     * 常量说明：records 用于处理 records 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const records: InspectorRecordInput[] = []
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：request（Request）：提供调用方提交的请求信息；
     * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
     * 典型用法：在完成前置校验后调用 匿名回调(request)，并按返回类型处理结果。
     */
    Object.defineProperty(globalThis, 'fetch', {
      value: vi.fn(async (request: Request) => new Response(new ReadableStream<Uint8Array>({
        /**
         * 功能说明：启动 start 相关流程；使用场景由所在模块及调用位置决定。
         * @param controller （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；
         * 必须满足声明的类型及调用时序要求。
         * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
         * @example 在完成前置校验后调用 start(controller)，并按返回类型处理结果。
         */
        start(controller) {
          controller.enqueue(Buffer.from('first'))
          /**
           * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
           * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
           */
          request.signal.addEventListener('abort', () => {
            controller.error(new DOMException('aborted', 'AbortError'))
          }, { once: true })
        },
      }))),
      writable: true,
      configurable: true,
    })
    observer = installFetchObserver({
      /**
       * 功能说明：处理 publish 相关流程；使用场景由所在模块及调用位置决定。
       * @param topic （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @param payload （InspectorJsonValue）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @param monotonicMs （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；
       * 必须满足声明的类型及调用时序要求。
       * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 publish(topic, payload, monotonicMs)，并按返回类型处理结果。
       */
      publish(topic: string, payload: InspectorJsonValue, monotonicMs = performance.now()) {
        records.push({ topic, payload, monotonicMs })
      },
    }, { maxRequestBodyBytes: 1_024, maxResponseBodyBytes: 1_024, maxChunkBytes: 4 })
    /**
     * 常量说明：abort 用于处理 abort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const abort = new AbortController()

    /**
     * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const response = await fetch('https://example.test/cancel-body', { signal: abort.signal })
    abort.abort()
    await expect(response.text()).rejects.toThrow()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => { /**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：record（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(record)，并按返回类型处理结果。
 */
expect(records.some(record => record.topic === 'fetch/end')).toBe(true) })

    expect(decodeChunks(records, 'fetch/response-body-chunk')).toBe('first')
    expect(payload(records, 'fetch/end')).toMatchObject({
      capturedBytes: 5,
      responseBodyTruncated: true,
      responseCaptureError: 'AbortError: aborted',
    })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：record（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(record)，并按返回类型处理结果。
     */
    expect(records.some(record => record.topic === 'fetch/error')).toBe(false)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('reports a fetch rejected before response headers as a canceled request', async () => {
    /**
     * 常量说明：records 用于处理 records 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const records: InspectorRecordInput[] = []
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：request（Request）：提供调用方提交的请求信息；
     * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
     * 典型用法：在完成前置校验后调用 匿名回调(request)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_resolve（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：reject（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(_resolve, reject)，
     * 并按返回类型处理结果。
     */
    Object.defineProperty(globalThis, 'fetch', {
      value: vi.fn(async (request: Request) => await new Promise<Response>((_resolve, reject) => {
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
         */
        request.signal.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'))
        }, { once: true })
      })),
      writable: true,
      configurable: true,
    })
    observer = installFetchObserver({
      /**
       * 功能说明：处理 publish 相关流程；使用场景由所在模块及调用位置决定。
       * @param topic （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @param payload （InspectorJsonValue）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @param monotonicMs （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；
       * 必须满足声明的类型及调用时序要求。
       * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 publish(topic, payload, monotonicMs)，并按返回类型处理结果。
       */
      publish(topic: string, payload: InspectorJsonValue, monotonicMs = performance.now()) {
        records.push({ topic, payload, monotonicMs })
      },
    }, { maxRequestBodyBytes: 1_024, maxResponseBodyBytes: 1_024, maxChunkBytes: 4 })
    /**
     * 常量说明：abort 用于处理 abort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const abort = new AbortController()

    /**
     * 常量说明：pending 用于处理 pending 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const pending = fetch('https://example.test/cancel-before-response', { signal: abort.signal })
    abort.abort()
    await expect(pending).rejects.toThrow()

    expect(payload(records, 'fetch/error')).toMatchObject({ canceled: true })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：record（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(record)，并按返回类型处理结果。
     */
    expect(records.some(record => record.topic === 'fetch/response')).toBe(false)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：record（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(record)，并按返回类型处理结果。
     */
    expect(records.some(record => record.topic === 'fetch/end')).toBe(false)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('reports non-cancellation fetch failures without manufacturing a canceled flag', async () => {
    /**
     * 常量说明：records 用于处理 records 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const records: InspectorRecordInput[] = []
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    Object.defineProperty(globalThis, 'fetch', {
      value: vi.fn(() => Promise.reject(new Error('connection failed'))),
      writable: true,
      configurable: true,
    })
    observer = installFetchObserver({
      /**
       * 功能说明：处理 publish 相关流程；使用场景由所在模块及调用位置决定。
       * @param topic （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @param payload （InspectorJsonValue）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @param monotonicMs （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；
       * 必须满足声明的类型及调用时序要求。
       * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 publish(topic, payload, monotonicMs)，并按返回类型处理结果。
       */
      publish(topic: string, payload: InspectorJsonValue, monotonicMs = performance.now()) {
        records.push({ topic, payload, monotonicMs })
      },
    }, { maxRequestBodyBytes: 1_024, maxResponseBodyBytes: 1_024, maxChunkBytes: 4 })

    await expect(fetch('https://example.test/failure')).rejects.toThrow('connection failed')
    expect(payload(records, 'fetch/error')).toMatchObject({ message: 'Error: connection failed', canceled: false })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('records request and response clone failures without replacing the caller response', async () => {
    /**
     * 常量说明：records 用于处理 records 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const records: InspectorRecordInput[] = []
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    Object.defineProperty(globalThis, 'fetch', {
      value: vi.fn(() => Promise.resolve(new Response('response'))),
      writable: true,
      configurable: true,
    })
    /**
     * 常量说明：requestClone 用于处理 requestClone 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const requestClone = vi.spyOn(Request.prototype, 'clone').mockImplementationOnce(() => {
      throw new Error('request clone failed')
    })
    /**
     * 常量说明：responseClone 用于处理 responseClone 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const responseClone = vi.spyOn(Response.prototype, 'clone').mockImplementationOnce(() => {
      throw new Error('response clone failed')
    })
    observer = installFetchObserver({
      /**
       * 功能说明：处理 publish 相关流程；使用场景由所在模块及调用位置决定。
       * @param topic （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @param payload （InspectorJsonValue）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @param monotonicMs （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；
       * 必须满足声明的类型及调用时序要求。
       * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 publish(topic, payload, monotonicMs)，并按返回类型处理结果。
       */
      publish(topic: string, payload: InspectorJsonValue, monotonicMs = performance.now()) {
        records.push({ topic, payload, monotonicMs })
      },
    }, { maxRequestBodyBytes: 1_024, maxResponseBodyBytes: 1_024, maxChunkBytes: 4 })

    /**
     * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const response = await fetch('https://example.test/clone-failure', { method: 'POST', body: 'request' })
    expect(await response.text()).toBe('response')
    expect(payload(records, 'fetch/request-body-end')).toMatchObject({ captureError: 'Error: request clone failed' })
    expect(payload(records, 'fetch/end')).toMatchObject({ responseCaptureError: 'Error: response clone failed' })
    requestClone.mockRestore()
    responseClone.mockRestore()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('handles responses without bodies and keeps stop idempotent when fetch is replaced', async () => {
    /**
     * 常量说明：records 用于处理 records 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const records: InspectorRecordInput[] = []
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    Object.defineProperty(globalThis, 'fetch', {
      value: vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
      writable: true,
      configurable: true,
    })
    observer = installFetchObserver({
      /**
       * 功能说明：处理 publish 相关流程；使用场景由所在模块及调用位置决定。
       * @param topic （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @param payload （InspectorJsonValue）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @param monotonicMs （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；
       * 必须满足声明的类型及调用时序要求。
       * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 publish(topic, payload, monotonicMs)，并按返回类型处理结果。
       */
      publish(topic: string, payload: InspectorJsonValue, monotonicMs = performance.now()) {
        records.push({ topic, payload, monotonicMs })
      },
    }, { maxRequestBodyBytes: 1_024, maxResponseBodyBytes: 1_024, maxChunkBytes: 4 })
    /**
     * 常量说明：replacement 用于处理 replacement 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const replacement = vi.fn<typeof fetch>()

    await fetch('https://example.test/no-content')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => { /**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：record（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(record)，并按返回类型处理结果。
 */
expect(records.some(record => record.topic === 'fetch/end')).toBe(true) })
    Object.defineProperty(globalThis, 'fetch', { value: replacement, writable: true, configurable: true })
    /**
     * 常量说明：firstStop 用于处理 firstStop 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const firstStop = observer.stop()
    expect(observer.stop()).toBe(firstStop)
    await firstStop
    expect(globalThis.fetch).toBe(replacement)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('rejects installation without a callable global fetch', () => {
    Object.defineProperty(globalThis, 'fetch', { value: undefined, writable: true, configurable: true })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => installFetchObserver({ publish: vi.fn() }, {
      maxRequestBodyBytes: 1,
      maxResponseBodyBytes: 1,
      maxChunkBytes: 1,
    })).toThrow('globalThis.fetch is unavailable')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('rejects an accessor fetch property', () => {
    /**
     * 常量说明：nativeFetch 用于处理 nativeFetch 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const nativeFetch = globalThis.fetch
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      get: () => nativeFetch,
    })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => installFetchObserver({ publish: vi.fn() }, {
      maxRequestBodyBytes: 1,
      maxResponseBodyBytes: 1,
      maxChunkBytes: 1,
    })).toThrow('globalThis.fetch is an accessor')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('contains publisher failures from asynchronous body completion', async () => {
    /**
     * 变量说明：endAttempted 用于处理 endAttempted 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let endAttempted = false
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    Object.defineProperty(globalThis, 'fetch', {
      value: vi.fn(() => Promise.resolve(new Response('response'))),
      writable: true,
      configurable: true,
    })
    observer = installFetchObserver({
      /**
       * 功能说明：处理 publish 相关流程；使用场景由所在模块及调用位置决定。
       * @param topic （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 publish(topic)，并按返回类型处理结果。
       */
      publish(topic: string): void {
        if (topic !== 'fetch/end') return
        endAttempted = true
        throw new Error('publisher closed')
      },
    }, { maxRequestBodyBytes: 1_024, maxResponseBodyBytes: 1_024, maxChunkBytes: 4 })

    await fetch('https://example.test/publisher-failure')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => { expect(endAttempted).toBe(true) })
    await expect(observer.stop()).resolves.toBeUndefined()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('cancels an active clone reader when the observer stops', async () => {
    /**
     * 常量说明：records 用于处理 records 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const records: InspectorRecordInput[] = []
    /**
     * 变量说明：settleRead 用于处理 settleRead 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let settleRead: ((value: ReadableStreamReadResult<Uint8Array>) => void) | undefined
    /**
     * 常量说明：reader 用于处理 reader 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const reader = {
      read: vi.fn(async () => await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve) => {
        settleRead = resolve
      })),
      cancel: vi.fn(() => {
        settleRead?.({ done: true, value: undefined })
        return Promise.reject(new Error('cancel already observed'))
      }),
      releaseLock: vi.fn(),
    }
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    Object.defineProperty(globalThis, 'fetch', {
      value: vi.fn(() => Promise.resolve(new Response('caller response'))),
      writable: true,
      configurable: true,
    })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    vi.spyOn(Response.prototype, 'clone').mockReturnValueOnce({
      body: { getReader: () => reader },
    } as unknown as Response)
    observer = installFetchObserver({
      /**
       * 功能说明：处理 publish 相关流程；使用场景由所在模块及调用位置决定。
       * @param topic （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @param payload （InspectorJsonValue）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @param monotonicMs （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；
       * 必须满足声明的类型及调用时序要求。
       * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 publish(topic, payload, monotonicMs)，并按返回类型处理结果。
       */
      publish(topic: string, payload: InspectorJsonValue, monotonicMs = performance.now()) {
        records.push({ topic, payload, monotonicMs })
      },
    }, { maxRequestBodyBytes: 1_024, maxResponseBodyBytes: 1_024, maxChunkBytes: 4 })

    await fetch('https://example.test/pending-body')
    await observer.stop()
    expect(reader.cancel).toHaveBeenCalled()
    expect(payload(records, 'fetch/end')).toMatchObject({
      responseCaptureError: 'inspector stopped during body capture',
    })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('contains a rejected reader cancellation after reaching the body limit', async () => {
    /**
     * 常量说明：records 用于处理 records 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const records: InspectorRecordInput[] = []
    /**
     * 常量说明：reader 用于处理 reader 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const reader = {
      read: vi.fn()
        .mockResolvedValueOnce({ done: false, value: Buffer.from('oversized') })
        .mockResolvedValue({ done: true, value: undefined }),
      cancel: vi.fn(() => Promise.reject(new Error('cancel failed'))),
      releaseLock: vi.fn(),
    }
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    Object.defineProperty(globalThis, 'fetch', {
      value: vi.fn(() => Promise.resolve(new Response('caller response'))),
      writable: true,
      configurable: true,
    })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    vi.spyOn(Response.prototype, 'clone').mockReturnValueOnce({
      body: { getReader: () => reader },
    } as unknown as Response)
    observer = installFetchObserver({
      /**
       * 功能说明：处理 publish 相关流程；使用场景由所在模块及调用位置决定。
       * @param topic （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @param payload （InspectorJsonValue）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @param monotonicMs （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；
       * 必须满足声明的类型及调用时序要求。
       * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 publish(topic, payload, monotonicMs)，并按返回类型处理结果。
       */
      publish(topic: string, payload: InspectorJsonValue, monotonicMs = performance.now()) {
        records.push({ topic, payload, monotonicMs })
      },
    }, { maxRequestBodyBytes: 1_024, maxResponseBodyBytes: 1, maxChunkBytes: 1 })

    await fetch('https://example.test/body-limit')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => { /**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：record（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(record)，并按返回类型处理结果。
 */
expect(records.some(record => record.topic === 'fetch/end')).toBe(true) })
    expect(payload(records, 'fetch/end')).toMatchObject({ capturedBytes: 1, responseBodyTruncated: true })
    expect(reader.cancel).toHaveBeenCalledWith('inspector body capture limit reached')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('renders non-Error rejection values without allowing hostile coercion to escape', async () => {
    /**
     * 常量说明：records 用于处理 records 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const records: InspectorRecordInput[] = []
    /**
     * 常量说明：plainFailure 用于处理 plainFailure 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const plainFailure: unknown = 'plain failure'
    /**
     * 常量说明：unrenderable 用于处理 unrenderable 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const unrenderable = { toString: () => { throw new Error('cannot stringify') } }
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    Object.defineProperty(globalThis, 'fetch', {
      value: vi.fn()
        .mockImplementationOnce(async () => { throw plainFailure })
        .mockImplementationOnce(async () => { throw unrenderable }),
      writable: true,
      configurable: true,
    })
    observer = installFetchObserver({
      /**
       * 功能说明：处理 publish 相关流程；使用场景由所在模块及调用位置决定。
       * @param topic （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @param payload （InspectorJsonValue）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @param monotonicMs （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；
       * 必须满足声明的类型及调用时序要求。
       * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 publish(topic, payload, monotonicMs)，并按返回类型处理结果。
       */
      publish(topic: string, payload: InspectorJsonValue, monotonicMs = performance.now()) {
        records.push({ topic, payload, monotonicMs })
      },
    }, { maxRequestBodyBytes: 1_024, maxResponseBodyBytes: 1_024, maxChunkBytes: 4 })

    await expect(fetch('https://example.test/plain-failure')).rejects.toBe('plain failure')
    await expect(fetch('https://example.test/unrenderable-failure')).rejects.toBe(unrenderable)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：record（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(record)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：record（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(record)，并按返回类型处理结果。
     */
    expect(records.filter(record => record.topic === 'fetch/error').map(record => record.payload))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ message: 'plain failure', canceled: false }),
        expect.objectContaining({ message: 'unrenderable fetch error', canceled: false }),
      ]))
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('restores an inherited fetch without leaving an own property', async () => {
    /**
     * 常量说明：prototype 用于处理 prototype 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const prototype = Object.getPrototypeOf(globalThis) as object
    /**
     * 常量说明：inheritedDescriptor 用于处理 inheritedDescriptor 相关数据，作用于当前作用域；
     * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const inheritedDescriptor = Object.getOwnPropertyDescriptor(prototype, 'fetch')
    /**
     * 常量说明：nativeFetch 用于处理 nativeFetch 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const nativeFetch = originalDescriptor?.value as typeof fetch
    Reflect.deleteProperty(globalThis, 'fetch')
    Object.defineProperty(prototype, 'fetch', { value: nativeFetch, writable: true, configurable: true })
    try {
      observer = installFetchObserver({ publish: vi.fn() }, {
        maxRequestBodyBytes: 1_024,
        maxResponseBodyBytes: 1_024,
        maxChunkBytes: 4,
      })
      await observer.stop()
      expect(Object.hasOwn(globalThis, 'fetch')).toBe(false)
    } finally {
      if (inheritedDescriptor === undefined) Reflect.deleteProperty(prototype, 'fetch')
      else Object.defineProperty(prototype, 'fetch', inheritedDescriptor)
    }
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('reports request clone read errors and non-abort DOM failures', async () => {
    /**
     * 常量说明：records 用于处理 records 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const records: InspectorRecordInput[] = []
    /**
     * 常量说明：requestReadFailure 用于处理 requestReadFailure 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const requestReadFailure: unknown = 'request read failed'
    /**
     * 常量说明：reader 用于处理 reader 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const reader = {
      read: vi.fn(async () => { throw requestReadFailure }),
      cancel: vi.fn(() => Promise.resolve()),
      releaseLock: vi.fn(),
    }
    Object.defineProperty(globalThis, 'fetch', {
      value: vi.fn()
        .mockResolvedValueOnce(new Response(null, { status: 204 }))
        .mockRejectedValueOnce(new DOMException('network failed', 'NetworkError')),
      writable: true,
      configurable: true,
    })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    vi.spyOn(Request.prototype, 'clone').mockReturnValueOnce({
      body: { getReader: () => reader },
    } as unknown as Request)
    observer = installFetchObserver({
      /**
       * 功能说明：处理 publish 相关流程；使用场景由所在模块及调用位置决定。
       * @param topic （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @param payload （InspectorJsonValue）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @param monotonicMs （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；
       * 必须满足声明的类型及调用时序要求。
       * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 publish(topic, payload, monotonicMs)，并按返回类型处理结果。
       */
      publish(topic: string, payload: InspectorJsonValue, monotonicMs = performance.now()) {
        records.push({ topic, payload, monotonicMs })
      },
    }, { maxRequestBodyBytes: 1_024, maxResponseBodyBytes: 1_024, maxChunkBytes: 4 })

    await fetch('https://example.test/request-read-failure')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => { /**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：record（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(record)，并按返回类型处理结果。
 */
expect(records.some(record => record.topic === 'fetch/request-body-end')).toBe(true) })
    expect(payload(records, 'fetch/request-body-end')).toMatchObject({ captureError: 'request read failed' })
    await expect(fetch('https://example.test/network-failure')).rejects.toThrow('network failed')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：record（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(record)，并按返回类型处理结果。
     */
    expect(records.filter(record => record.topic === 'fetch/error').at(-1)?.payload)
      .toMatchObject({ canceled: false })
  })
})

/**
 * 功能说明：处理 payload 相关流程；使用场景由所在模块及调用位置决定。
 * @param records （readonly InspectorRecordInput[]）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @param topic （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Record<string, unknown>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 payload(records, topic)，并按返回类型处理结果。
 */
function payload(records: readonly InspectorRecordInput[], topic: string): Record<string, unknown> {
  /**
   * 常量说明：record 用于处理 record 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：candidate（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(candidate)，并按返回类型处理结果。
   */
  const record = records.find(candidate => candidate.topic === topic)
  expect(record).toBeDefined()
  return record!.payload as Record<string, unknown>
}

/**
 * 功能说明：解码 Chunks 相关流程；使用场景由所在模块及调用位置决定。
 * @param records （readonly InspectorRecordInput[]）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @param topic （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 decodeChunks(records, topic)，并按返回类型处理结果。
 */
function decodeChunks(records: readonly InspectorRecordInput[], topic: string): string {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：record（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(record)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：record（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(record)，并按返回类型处理结果。
   */
  return Buffer.concat(records
    .filter(record => record.topic === topic)
    .map(record => Buffer.from(String((record.payload as Record<string, unknown>).data), 'base64')))
    .toString('utf8')
}
