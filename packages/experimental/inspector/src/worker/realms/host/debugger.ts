/** DebuggerBackend implementation over one native Node inspector session.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 debugger 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { RuntimeBackendObjectHandle } from '../../../shared/cdp/ids.ts'
import { isJsonValue } from '../../../shared/json.ts'
import type {
  RuntimeDebuggerCallFrame,
  RuntimeDebuggerEvent,
  RuntimeDebuggerLocation,
  RuntimeDebuggerScope,
} from '../../../shared/cdp/index.ts'
import type { DebuggerBackend } from '../../../shared/cdp/realm.ts'
import type { HostInspectorSession } from './bridge.ts'
import { optionalNativeField, requireNativeRecord } from './values.ts'
import { HostNotificationChannel } from './bridge.ts'
import type { HostRuntimeBackend } from './runtime.ts'
import { hostScriptKey } from './scripts.ts'

/** Native Host debugger adapted to common commands, Runtime values, and events.
 * @remarks 中文说明：类说明：HostDebuggerBackend 用于集中封装 处理 HostDebuggerBackend
 * 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由
 * experimental/inspector 在对应插件或业务生命周期内创建和调用。 */
export class HostDebuggerBackend implements DebuggerBackend {
  /**
   * 常量说明：events 用于处理 events 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly events: HostNotificationChannel<RuntimeDebuggerEvent<RuntimeBackendObjectHandle>>

  /**
   * 功能说明：处理 HostDebuggerBackend 相关流程；使用场景由所在模块及调用位置决定。
   * @param target （HostInspectorSession）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param runtime （HostRuntimeBackend）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new HostDebuggerBackend(target, runtime) 创建实例，并在所属生命周期内使用。
   */
  constructor(
    private readonly target: HostInspectorSession,
    private readonly runtime: HostRuntimeBackend,
  ) {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：message（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(message)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：message（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(message)，并按返回类型处理结果。
     */
    this.events = new HostNotificationChannel(
      target,
      message => message.method === 'Debugger.resumed'
        || message.method === 'Debugger.breakpointResolved'
        || message.method === 'Debugger.paused',
      async message => message.method === 'Debugger.resumed'
        ? { type: 'resumed' }
        : message.method === 'Debugger.breakpointResolved'
          ? breakpointResolved(message.params)
          : this.paused(message.params),
    )
  }

  /**
   * 功能说明：处理 enable 相关流程；使用场景由所在模块及调用位置决定。
   * @param request （Parameters<DebuggerBackend['enable']>[0]）：提供调用方提交的请求信息；
   * 必须满足声明的类型及调用时序要求。
   * @returns Promise<Readonly<Record<string, unknown>>>；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 enable(request)，并按返回类型处理结果。
   */
  async enable(request: Parameters<DebuggerBackend['enable']>[0]): Promise<Readonly<Record<string, unknown>>> {
    return this.target.request('Debugger.enable', {
      ...optionalNativeField('maxScriptsCacheSize', request.maxScriptsCacheSize),
    })
  }

  /**
   * 功能说明：处理 disable 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Promise<Readonly<Record<string, unknown>>>；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 disable()，并按返回类型处理结果。
   */
  async disable(): Promise<Readonly<Record<string, unknown>>> {
    return this.target.request('Debugger.disable', {})
  }

  /**
   * 功能说明：处理 pause 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Promise<Readonly<Record<string, unknown>>>；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 pause()，并按返回类型处理结果。
   */
  async pause(): Promise<Readonly<Record<string, unknown>>> {
    return this.target.request('Debugger.pause', {})
  }

  /**
   * 功能说明：处理 resume 相关流程；使用场景由所在模块及调用位置决定。
   * @param request （Parameters<DebuggerBackend['resume']>[0]）：提供调用方提交的请求信息；
   * 必须满足声明的类型及调用时序要求。
   * @returns Promise<Readonly<Record<string, unknown>>>；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 resume(request)，并按返回类型处理结果。
   */
  async resume(request: Parameters<DebuggerBackend['resume']>[0]): Promise<Readonly<Record<string, unknown>>> {
    return this.target.request('Debugger.resume', {
      ...optionalNativeField('terminateOnResume', request.terminateOnResume),
    })
  }

  /**
   * 功能说明：处理 evaluateOnCallFrame 相关流程；使用场景由所在模块及调用位置决定。
   * @param request （Parameters<DebuggerBackend['evaluateOnCallFrame']>[0]）：提
   * 供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @returns ReturnType<DebuggerBackend['evaluateOnCallFrame']>；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 evaluateOnCallFrame(request)，并按返回类型处理结果。
   */
  async evaluateOnCallFrame(
    request: Parameters<DebuggerBackend['evaluateOnCallFrame']>[0],
  ): ReturnType<DebuggerBackend['evaluateOnCallFrame']> {
    return this.runtime.completion(await this.target.request('Debugger.evaluateOnCallFrame', {
      callFrameId: request.callFrameId,
      expression: request.expression,
      ...optionalNativeField('objectGroup', request.objectGroup),
      ...optionalNativeField('includeCommandLineAPI', request.includeCommandLineAPI),
      ...optionalNativeField('silent', request.silent),
      ...optionalNativeField('returnByValue', request.returnByValue),
      ...optionalNativeField('generatePreview', request.generatePreview),
      ...optionalNativeField('throwOnSideEffect', request.throwOnSideEffect),
      ...optionalNativeField('timeout', request.timeoutMs),
    }))
  }

  /**
   * 功能说明：处理 subscribe 相关流程；使用场景由所在模块及调用位置决定。
   * @param listener （(event: RuntimeDebuggerEvent<RuntimeBackendObjectHandle
   * >) =…）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。
   * @returns () => void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 subscribe(listener)，并按返回类型处理结果。
   */
  subscribe(listener: (event: RuntimeDebuggerEvent<RuntimeBackendObjectHandle>) => void): () => void {
    return this.events.subscribe(listener)
  }

  /** Release the native notification subscription.
   * @remarks 中文说明：功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 close()，并按返回类型处理结果。 */
  close(): void {
    this.events.close()
  }

  /**
   * 功能说明：处理 paused 相关流程；使用场景由所在模块及调用位置决定。
   * @param params （Readonly<Record<string, unknown>> |
   * undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<RuntimeDebuggerEvent<RuntimeBackendObjectHandle> |
   * undefined>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 paused(params)，并按返回类型处理结果。
   */
  private async paused(
    params: Readonly<Record<string, unknown>> | undefined,
  ): Promise<RuntimeDebuggerEvent<RuntimeBackendObjectHandle> | undefined> {
    if (!Array.isArray(params?.callFrames) || typeof params.reason !== 'string') return undefined
    /**
     * 常量说明：callFrames 用于处理 callFrames 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：frame（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(frame)，并按返回类型处理结果。
     */
    const callFrames = await Promise.all(params.callFrames.map(async frame => this.callFrame(frame)))
    /**
     * 常量说明：data 用于处理 data 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const data = params.data
    /**
     * 常量说明：hitBreakpoints 用于处理 hitBreakpoints 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const hitBreakpoints = params.hitBreakpoints
    return {
      type: 'paused',
      callFrames,
      reason: params.reason,
      ...(data === undefined || !isJsonValue(data) ? {} : { data }),
      ...(isStringArray(hitBreakpoints)
        ? { hitBreakpoints: hitBreakpoints }
        : {}),
      ...(params.asyncStackTrace === undefined
        ? {}
        : { asyncStackTrace: this.runtime.stackTrace(params.asyncStackTrace) }),
    }
  }

  /**
   * 功能说明：处理 callFrame 相关流程；使用场景由所在模块及调用位置决定。
   * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<RuntimeDebuggerCallFrame<RuntimeBackendObjectHandle>>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 callFrame(value)，并按返回类型处理结果。
   */
  private async callFrame(value: unknown): Promise<RuntimeDebuggerCallFrame<RuntimeBackendObjectHandle>> {
    /**
     * 常量说明：record 用于处理 record 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const record = requireNativeRecord(value, 'Host Debugger call frame')
    if (typeof record.callFrameId !== 'string'
      || typeof record.functionName !== 'string'
      || typeof record.url !== 'string'
      || !Array.isArray(record.scopeChain)) {
      throw new Error('Host Debugger returned an invalid call frame')
    }
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：scope（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(scope)，并按返回类型处理结果。
     */
    return {
      callFrameId: record.callFrameId,
      functionName: record.functionName,
      ...(record.functionLocation === undefined ? {} : { functionLocation: location(record.functionLocation) }),
      location: location(record.location),
      url: record.url,
      scopeChain: await Promise.all(record.scopeChain.map(async scope => this.scope(scope))),
      thisObject: await this.runtime.remoteObject(record.this),
      ...(record.returnValue === undefined ? {} : { returnValue: await this.runtime.remoteObject(record.returnValue) }),
    }
  }

  /**
   * 功能说明：处理 scope 相关流程；使用场景由所在模块及调用位置决定。
   * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<RuntimeDebuggerScope<RuntimeBackendObjectHandle>>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 scope(value)，并按返回类型处理结果。
   */
  private async scope(value: unknown): Promise<RuntimeDebuggerScope<RuntimeBackendObjectHandle>> {
    /**
     * 常量说明：record 用于处理 record 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const record = requireNativeRecord(value, 'Host Debugger scope')
    if (typeof record.type !== 'string') throw new Error('Host Debugger returned an invalid scope')
    return {
      type: record.type,
      object: await this.runtime.remoteObject(record.object),
      ...(typeof record.name === 'string' ? { name: record.name } : {}),
      ...(record.startLocation === undefined ? {} : { startLocation: location(record.startLocation) }),
      ...(record.endLocation === undefined ? {} : { endLocation: location(record.endLocation) }),
    }
  }

}

/**
 * 功能说明：处理 breakpointResolved 相关流程；使用场景由所在模块及调用位置决定。
 * @param params （Readonly<Record<string, unknown>> |
 * undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Extract<RuntimeDebuggerEvent<RuntimeBackendObjectHandle>, {
 * type: 'br…；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 breakpointResolved(params)，并按返回类型处理结果。
 */
function breakpointResolved(
  params: Readonly<Record<string, unknown>> | undefined,
): Extract<RuntimeDebuggerEvent<RuntimeBackendObjectHandle>, { type: 'breakpoint-resolved' }> | undefined {
  if (typeof params?.breakpointId !== 'string' || params.location === undefined) return undefined
  return {
    type: 'breakpoint-resolved',
    breakpointId: params.breakpointId,
    location: location(params.location),
  }
}

/**
 * 功能说明：处理 location 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns RuntimeDebuggerLocation；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 location(value)，并按返回类型处理结果。
 */
function location(value: unknown): RuntimeDebuggerLocation {
  /**
   * 常量说明：record 用于处理 record 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const record = requireNativeRecord(value, 'Host Debugger location')
  if (typeof record.scriptId !== 'string' || !Number.isSafeInteger(record.lineNumber)) {
    throw new Error('Host Debugger returned an invalid location')
  }
  if (record.columnNumber !== undefined && !Number.isSafeInteger(record.columnNumber)) {
    throw new Error('Host Debugger returned an invalid location column')
  }
  return {
    scriptKey: hostScriptKey(record.scriptId),
    lineNumber: record.lineNumber as number,
    ...(record.columnNumber === undefined ? {} : { columnNumber: record.columnNumber as number }),
  }
}

/**
 * 功能说明：判断是否为 String Array 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns value is string[]；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 isStringArray(value)，并按返回类型处理结果。
 */
function isStringArray(value: unknown): value is string[] {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
   */
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}
