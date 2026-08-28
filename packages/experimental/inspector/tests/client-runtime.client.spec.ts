/** Client-face Runtime behavior.
 * @remarks 文件说明：文件职责：验证 experimental/inspector 中 client runtime client
 * spec 相关行为与失败场景。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import { afterEach, describe, expect, it } from 'vitest'
import { ClientRuntimeExecutor } from '../src/client/cdp/runtime.ts'
import type {
  ClientRuntimeCommand,
  ClientRuntimeRequestFrame,
  ClientRuntimeResult,
} from '../src/shared/bridge/messages/runtime/index.ts'
import {
  inspectorId,
} from '../src/shared/bridge/ids.ts'

/**
 * 常量说明：sourceId 用于处理 sourceId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const sourceId = inspectorId<'InspectorSourceId'>('client-test', 'sourceId')
/**
 * 常量说明：generation 用于处理 generation 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const generation = inspectorId<'InspectorSourceGeneration'>('generation-test', 'generation')
/**
 * 常量说明：sessionId 用于处理 sessionId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const sessionId = inspectorId<'ClientRuntimeSessionId'>('session-test', 'sessionId')
/**
 * 常量说明：secondSessionId 用于处理 secondSessionId 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const secondSessionId = inspectorId<'ClientRuntimeSessionId'>('session-second', 'sessionId')

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('Client Runtime executor', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  afterEach(() => {
    Reflect.deleteProperty(globalThis, '__clientRuntimeFixture')
    Reflect.deleteProperty(globalThis, '__clientRuntimeGetterCalls')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('retains RemoteObjects, reads descriptors lazily, calls functions, and releases groups', async () => {
    Reflect.set(globalThis, '__clientRuntimeGetterCalls', 0)
    /**
     * 常量说明：fixture 用于处理 fixture 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const fixture = {
      value: 4,
      /**
       * 功能说明：处理 dangerous 相关流程；使用场景由所在模块及调用位置决定。
       * @returns number；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 dangerous()，并按返回类型处理结果。
       */
      get dangerous(): number {
        /**
         * 常量说明：calls 用于处理 calls 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const calls = Number(Reflect.get(globalThis, '__clientRuntimeGetterCalls'))
        Reflect.set(globalThis, '__clientRuntimeGetterCalls', calls + 1)
        return 99
      },
    }
    Object.defineProperty(fixture, Symbol.toStringTag, {
      /**
       * 功能说明：获取 get 相关流程；使用场景由所在模块及调用位置决定。
       * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 get()，并按返回类型处理结果。
       */
      get() {
        /**
         * 常量说明：calls 用于处理 calls 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const calls = Number(Reflect.get(globalThis, '__clientRuntimeGetterCalls'))
        Reflect.set(globalThis, '__clientRuntimeGetterCalls', calls + 1)
        return 'DangerousTag'
      },
    })
    Reflect.set(globalThis, '__clientRuntimeFixture', fixture)
    /**
     * 常量说明：runtime 用于处理 runtime 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const runtime = new ClientRuntimeExecutor({
      maxObjectsPerSession: 100,
      maxPropertiesPerResult: 100,
      maxResponseBytes: 32_768,
    })

    /**
     * 常量说明：evaluated 用于处理 evaluated 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const evaluated = success(await runtime.execute(frame({
      op: 'evaluate',
      expression: 'globalThis.__clientRuntimeFixture',
      objectGroup: 'console',
      generatePreview: true,
    })), 'evaluate')
    /**
     * 常量说明：handle 用于处理 handle 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const handle = evaluated.completion.result.object?.handle
    if (handle === undefined) throw new Error('evaluate did not return a Client object handle')

    /**
     * 常量说明：properties 用于处理 properties 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const properties = success(await runtime.execute(frame({
      op: 'get-properties',
      handle,
      ownProperties: true,
    })), 'get-properties')
    /**
     * 常量说明：valueProperty 用于处理 valueProperty 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：property（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(property)，并按返回类型处理结果。
     */
    const valueProperty = properties.properties.find(property => property.name === 'value')
    /**
     * 常量说明：getterProperty 用于处理 getterProperty 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：property（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(property)，并按返回类型处理结果。
     */
    const getterProperty = properties.properties.find(property => property.name === 'dangerous')
    expect(valueProperty?.value).toMatchObject({ descriptor: { type: 'number', value: 4 } })
    expect(getterProperty?.get).toMatchObject({ descriptor: { type: 'function' } })
    expect(Reflect.get(globalThis, '__clientRuntimeGetterCalls')).toBe(0)

    /**
     * 常量说明：called 用于处理 called 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const called = success(await runtime.execute(frame({
      op: 'call-function',
      functionDeclaration: 'function (increment) { return this.value + increment }',
      receiver: handle,
      arguments: [{ kind: 'value', value: 3 }],
      returnByValue: true,
    })), 'call-function')
    expect(called.completion.result).toMatchObject({ descriptor: { type: 'number', value: 7 } })

    success(await runtime.execute(frame({ op: 'release-object-group', objectGroup: 'console' })), 'release-object-group')
    /**
     * 常量说明：released 用于处理 released 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const released = await runtime.execute(frame({ op: 'get-properties', handle }))
    expect(released.outcome).toEqual({
      ok: false,
      error: { code: 'object-not-found', message: 'Client RemoteObject was released' },
    })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('keeps evaluated exceptions separate from transport failures', async () => {
    /**
     * 常量说明：runtime 用于处理 runtime 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const runtime = new ClientRuntimeExecutor({
      maxObjectsPerSession: 100,
      maxPropertiesPerResult: 100,
      maxResponseBytes: 32_768,
    })
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = success(await runtime.execute(frame({
      op: 'evaluate',
      expression: 'throw new TypeError("bad value")',
    })), 'evaluate')
    expect(result.completion.exceptionDetails).toMatchObject({
      text: 'Uncaught',
      exception: { descriptor: { type: 'object', subtype: 'error' } },
    })
    expect(result.completion.result).toMatchObject({ descriptor: { type: 'object', subtype: 'error' } })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('preserves non-JSON primitives and reports bounded async execution failures', async () => {
    /**
     * 常量说明：runtime 用于处理 runtime 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const runtime = new ClientRuntimeExecutor({
      maxObjectsPerSession: 100,
      maxPropertiesPerResult: 100,
      maxResponseBytes: 32_768,
    })
    /**
     * 常量说明：values 用于处理 values 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const values = [
      ['NaN', { descriptor: { type: 'number', unserializableValue: 'NaN' } }],
      ['-0', { descriptor: { type: 'number', unserializableValue: '-0' } }],
      ['12n', { descriptor: { type: 'bigint', unserializableValue: '12n' } }],
      ['null', { descriptor: { type: 'object', subtype: 'null', value: null } }],
    ] as const
    /**
     * 变量说明：expression、expected 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const [expression, expected] of values) {
      /**
       * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const result = success(await runtime.execute(frame({ op: 'evaluate', expression })), 'evaluate')
      expect(result.completion.result).toMatchObject(expected)
    }
    /**
     * 常量说明：fn 用于处理 fn 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const fn = success(await runtime.execute(frame({
      op: 'evaluate',
      expression: '(value) => value',
      generatePreview: true,
    })), 'evaluate')
    expect(fn.completion.result).toMatchObject({ descriptor: { type: 'function' } })
    expect(fn.completion.result.descriptor.preview).toBeUndefined()

    /**
     * 常量说明：timedOut 用于处理 timedOut 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const timedOut = await runtime.execute(frame({
      op: 'evaluate',
      expression: 'new Promise(() => {})',
      awaitPromise: true,
      timeoutMs: 1,
    }))
    expect(timedOut.outcome).toMatchObject({ ok: false, error: { code: 'timeout' } })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('rolls back only objects allocated by the failing concurrent request', async () => {
    /**
     * 常量说明：runtime 用于处理 runtime 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const runtime = new ClientRuntimeExecutor({
      maxObjectsPerSession: 100,
      maxPropertiesPerResult: 100,
      maxResponseBytes: 32_768,
    })
    /**
     * 常量说明：blocked 用于处理 blocked 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const blocked = runtime.execute(frame({
      op: 'evaluate',
      expression: 'new Promise(() => {})',
      awaitPromise: true,
      timeoutMs: 10,
    }))
    /**
     * 常量说明：completed 用于处理 completed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const completed = success(await runtime.execute(frame({
      op: 'evaluate',
      expression: '({ retainedByConcurrentRequest: true })',
    })), 'evaluate')
    /**
     * 常量说明：handle 用于处理 handle 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const handle = completed.completion.result.object?.handle
    if (handle === undefined) throw new Error('concurrent evaluation did not retain an object')

    await expect(blocked).resolves.toMatchObject({ outcome: { ok: false, error: { code: 'timeout' } } })
    /**
     * 常量说明：properties 用于处理 properties 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const properties = success(await runtime.execute(frame({
      op: 'get-properties',
      handle,
      ownProperties: true,
    })), 'get-properties')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：property（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(property)，并按返回类型处理结果。
     */
    expect(properties.properties.find(property => property.name === 'retainedByConcurrentRequest')?.value)
      .toMatchObject({ descriptor: { value: true } })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('rolls back a canceled function call instead of returning its cancellation as a JavaScript exception', async () => {
    /**
     * 常量说明：runtime 用于处理 runtime 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const runtime = new ClientRuntimeExecutor({
      maxObjectsPerSession: 1,
      maxPropertiesPerResult: 100,
      maxResponseBytes: 32_768,
    })
    /**
     * 常量说明：controller 用于处理 controller 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const controller = new AbortController()
    /**
     * 常量说明：pending 用于处理 pending 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const pending = runtime.execute(frame({
      op: 'call-function',
      functionDeclaration: 'function () { return new Promise(() => {}) }',
      awaitPromise: true,
    }), controller.signal)
    controller.abort()

    await expect(pending).resolves.toMatchObject({ outcome: { ok: false, error: { code: 'timeout' } } })
    await expect(runtime.execute(frame({
      op: 'evaluate',
      expression: '({ retainedAfterCancellation: true })',
    }))).resolves.toMatchObject({ outcome: { ok: true } })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('keeps response handles provisional until the Worker accepts or cancels them', async () => {
    /**
     * 常量说明：runtime 用于处理 runtime 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const runtime = new ClientRuntimeExecutor({
      maxObjectsPerSession: 2,
      maxPropertiesPerResult: 100,
      maxResponseBytes: 32_768,
    })
    /**
     * 常量说明：canceledFrame 用于处理 canceledFrame 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const canceledFrame = frame({ op: 'evaluate', expression: '({ canceled: true })' })
    /**
     * 常量说明：canceled 用于处理 canceled 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const canceled = success(await runtime.execute(canceledFrame, undefined, true), 'evaluate')
    /**
     * 常量说明：canceledHandle 用于处理 canceledHandle 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const canceledHandle = canceled.completion.result.object?.handle
    if (canceledHandle === undefined) throw new Error('deferred response did not retain an object')
    runtime.cancel(canceledFrame.sessionId, canceledFrame.requestId)
    expect((await runtime.execute(frame({ op: 'get-properties', handle: canceledHandle }))).outcome)
      .toMatchObject({ ok: false, error: { code: 'object-not-found' } })

    /**
     * 常量说明：acceptedFrame 用于处理 acceptedFrame 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const acceptedFrame = frame({ op: 'evaluate', expression: '({ accepted: true })' })
    /**
     * 常量说明：accepted 用于处理 accepted 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const accepted = success(await runtime.execute(acceptedFrame, undefined, true), 'evaluate')
    /**
     * 常量说明：acceptedHandle 用于处理 acceptedHandle 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const acceptedHandle = accepted.completion.result.object?.handle
    if (acceptedHandle === undefined) throw new Error('deferred response did not retain an object')
    runtime.acknowledge(acceptedFrame.sessionId, acceptedFrame.requestId)
    /**
     * 常量说明：properties 用于处理 properties 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const properties = success(await runtime.execute(frame({
      op: 'get-properties',
      handle: acceptedHandle,
      ownProperties: true,
    })), 'get-properties')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：property（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(property)，并按返回类型处理结果。
     */
    expect(properties.properties.find(property => property.name === 'accepted')?.value)
      .toMatchObject({ descriptor: { value: true } })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('rejects oversized by-value results before they enter the source transport', async () => {
    /**
     * 常量说明：runtime 用于处理 runtime 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const runtime = new ClientRuntimeExecutor({
      maxObjectsPerSession: 100,
      maxPropertiesPerResult: 100,
      maxResponseBytes: 256,
    })
    /**
     * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const response = await runtime.execute(frame({
      op: 'evaluate',
      expression: '"x".repeat(1000)',
      returnByValue: true,
    }))
    expect(response.outcome).toMatchObject({ ok: false, error: { code: 'result-too-large' } })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('drops every retained handle when its DevTools Runtime session closes', async () => {
    /**
     * 常量说明：runtime 用于处理 runtime 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const runtime = new ClientRuntimeExecutor({
      maxObjectsPerSession: 100,
      maxPropertiesPerResult: 100,
      maxResponseBytes: 32_768,
    })
    /**
     * 常量说明：evaluated 用于处理 evaluated 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const evaluated = success(await runtime.execute(frame({
      op: 'evaluate',
      expression: '({ retained: true })',
    })), 'evaluate')
    /**
     * 常量说明：handle 用于处理 handle 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const handle = evaluated.completion.result.object?.handle
    if (handle === undefined) throw new Error('evaluate did not return a Client object handle')

    runtime.closeSession(sessionId)
    /**
     * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const response = await runtime.execute(frame({ op: 'get-properties', handle }))
    expect(response.outcome).toMatchObject({ ok: false, error: { code: 'object-not-found' } })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('serializes Console objects into isolated DevTools sessions', async () => {
    /**
     * 常量说明：runtime 用于处理 runtime 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const runtime = new ClientRuntimeExecutor({
      maxObjectsPerSession: 100,
      maxPropertiesPerResult: 100,
      maxResponseBytes: 32_768,
    })
    /**
     * 常量说明：value 用于处理 value 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const value = { owner: 'console' }
    /**
     * 常量说明：first 用于处理 first 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const first = runtime.consoleEvent(sessionId, 'log', [value], 12)
    /**
     * 常量说明：second 用于处理 second 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const second = runtime.consoleEvent(secondSessionId, 'log', [value], 12)
    if (first?.type !== 'console-api' || second?.type !== 'console-api') {
      throw new Error('Console event was unexpectedly dropped')
    }
    /**
     * 常量说明：firstHandle 用于处理 firstHandle 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const firstHandle = first.event.arguments[0]?.object?.handle
    /**
     * 常量说明：secondHandle 用于处理 secondHandle 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const secondHandle = second.event.arguments[0]?.object?.handle
    if (firstHandle === undefined || secondHandle === undefined) throw new Error('Console object was not retained')

    runtime.releaseObjectGroup(sessionId, 'console')
    expect((await runtime.execute(frame({ op: 'get-properties', handle: firstHandle }))).outcome)
      .toMatchObject({ ok: false, error: { code: 'object-not-found' } })
    /**
     * 常量说明：properties 用于处理 properties 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const properties = success(await runtime.execute(
      frame({ op: 'get-properties', handle: secondHandle }, secondSessionId),
    ), 'get-properties').properties
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：property（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(property)，并按返回类型处理结果。
     */
    expect(properties.find(property => property.name === 'owner')?.value?.descriptor.value).toBe('console')
  })
})

/**
 * 变量说明：nextRequestId 用于处理 nextRequestId 相关数据，作用于当前作用域；其值可能随流程推进而变化，
 * 读写时需遵守声明类型和所在生命周期。
 */
let nextRequestId = 0

/**
 * 功能说明：处理 frame 相关流程；使用场景由所在模块及调用位置决定。
 * @param command （ClientRuntimeCommand）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param owner （ClientRuntimeRequestFrame['sessionId']）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @returns ClientRuntimeRequestFrame；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 frame(command, owner)，并按返回类型处理结果。
 */
function frame(
  command: ClientRuntimeCommand,
  owner: ClientRuntimeRequestFrame['sessionId'] = sessionId,
): ClientRuntimeRequestFrame {
  return {
    v: 0,
    t: 'client-runtime/request',
    sourceId,
    generation,
    sessionId: owner,
    requestId: inspectorId<'ClientRuntimeRequestId'>(`request-${String(++nextRequestId)}`, 'requestId'),
    command,
  }
}

/**
 * 功能说明：处理 success 相关流程；使用场景由所在模块及调用位置决定。
 * @param response （Awaited<ReturnType<ClientRuntimeExecutor['execute']>>）：
 * 提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param operation （Operation）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Extract<ClientRuntimeResult, { op: Operation }>；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 success(response, operation)，并按返回类型处理结果。
 */
function success<Operation extends ClientRuntimeResult['op']>(
  response: Awaited<ReturnType<ClientRuntimeExecutor['execute']>>,
  operation: Operation,
): Extract<ClientRuntimeResult, { op: Operation }> {
  if (!response.outcome.ok) throw new Error(response.outcome.error.message)
  if (response.outcome.result.op !== operation) throw new Error('unexpected Client Runtime result')
  return response.outcome.result as Extract<ClientRuntimeResult, { op: Operation }>
}
