/** RuntimeBackend implementation over one native Node inspector session.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 runtime 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import { inspectorId } from '../../../shared/identity.ts'
import type { RuntimeBackendObjectHandle } from '../../../shared/cdp/ids.ts'
import { isJsonValue } from '../../../shared/json.ts'
import { IDENTIFY_REALM_OBJECT_FUNCTION } from '../../../shared/cordis/object-registry.ts'
import { parseInspectorObjectReference, type InspectorObjectReference } from '../../../shared/cordis/object-reference.ts'
import type {
  RuntimeCallArgument,
  RuntimeCompletion,
  RuntimeExceptionDetails,
  RuntimeInternalPropertyDescriptor,
  RuntimePrivatePropertyDescriptor,
  RuntimeProperties,
  RuntimePropertyDescriptor,
  RuntimeRemoteObject,
  RuntimeRemoteObjectDescriptor,
  RuntimeExecutionContext,
  RuntimeStackTrace,
} from '../../../shared/cdp/index.ts'
import type { HostInspectorNotification, HostInspectorSession } from './bridge.ts'
import type { RuntimeBackend } from '../../../shared/cdp/realm.ts'
import { isNativeRecord, optionalNativeField, requireNativeRecord } from './values.ts'
import { hostScriptKey } from './scripts.ts'

/** Host Runtime adapter preserving native V8 semantics behind common values.
 * @remarks 中文说明：类说明：HostRuntimeBackend 用于集中封装 处理 HostRuntimeBackend
 * 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由
 * experimental/inspector 在对应插件或业务生命周期内创建和调用。 */
export class HostRuntimeBackend implements RuntimeBackend {
  /**
   * 变量说明：defaultContextId 用于处理 defaultContextId 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private defaultContextId: number | undefined
  /**
   * 常量说明：unsubscribe 用于处理 unsubscribe 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly unsubscribe: () => void

  /**
   * 功能说明：处理 HostRuntimeBackend 相关流程；使用场景由所在模块及调用位置决定。
   * @param target （HostInspectorSession）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new HostRuntimeBackend(target) 创建实例，并在所属生命周期内使用。
   */
  constructor(private readonly target: HostInspectorSession) {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：message（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(message)，并按返回类型处理结果。
     */
    this.unsubscribe = target.subscribe((message) => { this.observeContext(message) })
  }

  /**
   * 功能说明：处理 enable 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 enable()，并按返回类型处理结果。
   */
  async enable(): Promise<void> {
    await this.target.request('Runtime.enable', {})
  }

  /**
   * 功能说明：处理 disable 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 disable()，并按返回类型处理结果。
   */
  async disable(): Promise<void> {
    await this.target.request('Runtime.disable', {})
    this.defaultContextId = undefined
  }

  /**
   * 功能说明：处理 evaluate 相关流程；使用场景由所在模块及调用位置决定。
   * @param request （Parameters<RuntimeBackend['evaluate']>[0]）：提供调用方提交的请求信息；
   * 必须满足声明的类型及调用时序要求。
   * @returns ReturnType<RuntimeBackend['evaluate']>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 evaluate(request)，并按返回类型处理结果。
   */
  async evaluate(request: Parameters<RuntimeBackend['evaluate']>[0]): ReturnType<RuntimeBackend['evaluate']> {
    return this.completion(await this.target.request('Runtime.evaluate', {
      expression: request.expression,
      ...nativeContext(request.context, 'contextId'),
      ...optionalNativeField('objectGroup', request.objectGroup),
      ...optionalNativeField('includeCommandLineAPI', request.includeCommandLineAPI),
      ...optionalNativeField('silent', request.silent),
      ...optionalNativeField('returnByValue', request.returnByValue),
      ...optionalNativeField('generatePreview', request.generatePreview),
      ...optionalNativeField('userGesture', request.userGesture),
      ...optionalNativeField('awaitPromise', request.awaitPromise),
      ...optionalNativeField('disableBreaks', request.disableBreaks),
      ...optionalNativeField('replMode', request.replMode),
      ...optionalNativeField('allowUnsafeEvalBlockedByCSP', request.allowUnsafeEvalBlockedByCSP),
      ...optionalNativeField('throwOnSideEffect', request.throwOnSideEffect),
      ...optionalNativeField('serializationOptions', request.serializationOptions),
      ...optionalNativeField('timeout', request.timeoutMs),
    }))
  }

  /**
   * 功能说明：获取 Properties 相关流程；使用场景由所在模块及调用位置决定。
   * @param request （Parameters<RuntimeBackend['getProperties']>[0]）：提供调用方提交的
   * 请求信息；必须满足声明的类型及调用时序要求。
   * @returns ReturnType<RuntimeBackend['getProperties']>；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 getProperties(request)，并按返回类型处理结果。
   */
  async getProperties(request: Parameters<RuntimeBackend['getProperties']>[0]): ReturnType<RuntimeBackend['getProperties']> {
    /**
     * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const response = await this.target.request('Runtime.getProperties', {
      objectId: request.handle,
      ...optionalNativeField('ownProperties', request.ownProperties),
      ...optionalNativeField('accessorPropertiesOnly', request.accessorPropertiesOnly),
      ...optionalNativeField('generatePreview', request.generatePreview),
      ...optionalNativeField('nonIndexedPropertiesOnly', request.nonIndexedPropertiesOnly),
    })
    return this.properties(response)
  }

  /**
   * 功能说明：处理 callFunction 相关流程；使用场景由所在模块及调用位置决定。
   * @param request （Parameters<RuntimeBackend['callFunction']>[0]）：提供调用方提交的请
   * 求信息；必须满足声明的类型及调用时序要求。
   * @returns ReturnType<RuntimeBackend['callFunction']>；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 callFunction(request)，并按返回类型处理结果。
   */
  async callFunction(request: Parameters<RuntimeBackend['callFunction']>[0]): ReturnType<RuntimeBackend['callFunction']> {
    /**
     * 常量说明：receiver 用于处理 receiver 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const receiver = request.receiver
    /**
     * 常量说明：context 用于处理 context 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const context = receiver === undefined
      ? nativeContext(request.context ?? defaultContext(this.defaultContextId), 'executionContextId')
      : undefined
    if (receiver === undefined && context === undefined) {
      throw new Error('Host Runtime default execution context is unavailable')
    }
    return this.completion(await this.target.request('Runtime.callFunctionOn', {
      functionDeclaration: request.functionDeclaration,
      ...(receiver === undefined ? context : { objectId: receiver }),
      ...(request.arguments === undefined ? {} : { arguments: request.arguments.map(toNativeArgument) }),
      ...optionalNativeField('objectGroup', request.objectGroup),
      ...optionalNativeField('silent', request.silent),
      ...optionalNativeField('returnByValue', request.returnByValue),
      ...optionalNativeField('generatePreview', request.generatePreview),
      ...optionalNativeField('userGesture', request.userGesture),
      ...optionalNativeField('awaitPromise', request.awaitPromise),
      ...optionalNativeField('throwOnSideEffect', request.throwOnSideEffect),
      ...optionalNativeField('serializationOptions', request.serializationOptions),
    }))
  }

  /**
   * 功能说明：处理 awaitPromise 相关流程；使用场景由所在模块及调用位置决定。
   * @param request （Parameters<RuntimeBackend['awaitPromise']>[0]）：提供调用方提交的请
   * 求信息；必须满足声明的类型及调用时序要求。
   * @returns ReturnType<RuntimeBackend['awaitPromise']>；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 awaitPromise(request)，并按返回类型处理结果。
   */
  async awaitPromise(request: Parameters<RuntimeBackend['awaitPromise']>[0]): ReturnType<RuntimeBackend['awaitPromise']> {
    return this.completion(await this.target.request('Runtime.awaitPromise', {
      promiseObjectId: request.promise,
      ...optionalNativeField('returnByValue', request.returnByValue),
      ...optionalNativeField('generatePreview', request.generatePreview),
    }))
  }

  /**
   * 功能说明：处理 globalLexicalScopeNames 相关流程；使用场景由所在模块及调用位置决定。
   * @param context （RuntimeExecutionContext）：提供当前 Cordis 插件上下文与已声明服务；
   * 必须满足声明的类型及调用时序要求。
   * @returns Promise<readonly string[]>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 globalLexicalScopeNames(context)，并按返回类型处理结果。
   */
  async globalLexicalScopeNames(context?: RuntimeExecutionContext): Promise<readonly string[]> {
    /**
     * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const response = await this.target.request('Runtime.globalLexicalScopeNames', {
      ...nativeContext(context ?? defaultContext(this.defaultContextId), 'executionContextId'),
    })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：name（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(name)，并按返回类型处理结果。
     */
    if (!Array.isArray(response.names) || !response.names.every(name => typeof name === 'string')) {
      throw new Error('Host Runtime returned invalid lexical scope names')
    }
    return response.names
  }

  /**
   * 功能说明：处理 releaseObject 相关流程；使用场景由所在模块及调用位置决定。
   * @param handle （RuntimeBackendObjectHandle）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 releaseObject(handle)，并按返回类型处理结果。
   */
  async releaseObject(handle: RuntimeBackendObjectHandle): Promise<void> {
    await this.target.request('Runtime.releaseObject', { objectId: handle })
  }

  /**
   * 功能说明：处理 releaseObjectGroup 相关流程；使用场景由所在模块及调用位置决定。
   * @param group （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 releaseObjectGroup(group)，并按返回类型处理结果。
   */
  async releaseObjectGroup(group: string): Promise<void> {
    await this.target.request('Runtime.releaseObjectGroup', { objectGroup: group })
  }

  /** Release the native-context observer owned by this backend.
   * @remarks 中文说明：功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 close()，并按返回类型处理结果。 */
  close(): void {
    this.unsubscribe()
  }

  /**
   * Convert a native Runtime completion returned through another Node domain.
   * @param value - Native result and optional exception details.
   * @returns The realm-neutral completion.
   * @remarks 中文说明：功能说明：处理 completion 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：value（Readonly<Record<string, unknown>>）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：Promise<RuntimeCompletion<RuntimeBackendObjectHand
   * le>>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 completion(value)，
   * 并按返回类型处理结果。
   */
  async completion(value: Readonly<Record<string, unknown>>): Promise<RuntimeCompletion<RuntimeBackendObjectHandle>> {
    return {
      result: await this.remoteObject(value.result),
      ...(value.exceptionDetails === undefined
        ? {}
        : { exceptionDetails: await this.exceptionDetails(value.exceptionDetails) }),
    }
  }

  /**
   * 功能说明：处理 properties 相关流程；使用场景由所在模块及调用位置决定。
   * @param value （Readonly<Record<string, unknown>>）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @returns Promise<RuntimeProperties<RuntimeBackendObjectHandle>>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 properties(value)，并按返回类型处理结果。
   */
  private async properties(value: Readonly<Record<string, unknown>>): Promise<RuntimeProperties<RuntimeBackendObjectHandle>> {
    if (!Array.isArray(value.result)) throw new Error('Host Runtime returned invalid properties')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
     */
    return {
      properties: await Promise.all(value.result.map(item => this.property(item))),
      ...(value.internalProperties === undefined
        ? {}
        : { internalProperties: await this.internalProperties(value.internalProperties) }),
      ...(value.privateProperties === undefined
        ? {}
        : { privateProperties: await this.privateProperties(value.privateProperties) }),
      ...(value.exceptionDetails === undefined
        ? {}
        : { exceptionDetails: await this.exceptionDetails(value.exceptionDetails) }),
    }
  }

  /**
   * 功能说明：处理 property 相关流程；使用场景由所在模块及调用位置决定。
   * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<RuntimePropertyDescriptor<RuntimeBackendObjectHandle>>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 property(value)，并按返回类型处理结果。
   */
  private async property(value: unknown): Promise<RuntimePropertyDescriptor<RuntimeBackendObjectHandle>> {
    /**
     * 常量说明：record 用于处理 record 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const record = requireNativeRecord(value, 'Host Runtime property descriptor')
    if (typeof record.name !== 'string'
      || typeof record.configurable !== 'boolean'
      || typeof record.enumerable !== 'boolean') {
      throw new Error('Host Runtime returned invalid property descriptor')
    }
    return {
      ...record,
      name: record.name,
      configurable: record.configurable,
      enumerable: record.enumerable,
      ...(record.value === undefined ? {} : { value: await this.remoteObject(record.value) }),
      ...(record.get === undefined ? {} : { get: await this.remoteObject(record.get) }),
      ...(record.set === undefined ? {} : { set: await this.remoteObject(record.set) }),
      ...(record.symbol === undefined ? {} : { symbol: await this.remoteObject(record.symbol) }),
    }
  }

  /**
   * 功能说明：处理 internalProperties 相关流程；使用场景由所在模块及调用位置决定。
   * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<RuntimeInternalPropertyDescriptor<RuntimeBackendObjectH
   * andle>…；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 internalProperties(value)，并按返回类型处理结果。
   */
  private async internalProperties(value: unknown): Promise<RuntimeInternalPropertyDescriptor<RuntimeBackendObjectHandle>[]> {
    if (!Array.isArray(value)) throw new Error('Host Runtime returned invalid internal properties')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
     */
    return Promise.all(value.map(async (item) => {
      /**
       * 常量说明：record 用于处理 record 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const record = requireNativeRecord(item, 'Host Runtime internal property')
      if (typeof record.name !== 'string') throw new Error('Host Runtime returned invalid internal property')
      return {
        name: record.name,
        ...(record.value === undefined ? {} : { value: await this.remoteObject(record.value) }),
      }
    }))
  }

  /**
   * 功能说明：处理 privateProperties 相关流程；使用场景由所在模块及调用位置决定。
   * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<RuntimePrivatePropertyDescriptor<RuntimeBackendObjectHa
   * ndle>[…；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 privateProperties(value)，并按返回类型处理结果。
   */
  private async privateProperties(value: unknown): Promise<RuntimePrivatePropertyDescriptor<RuntimeBackendObjectHandle>[]> {
    if (!Array.isArray(value)) throw new Error('Host Runtime returned invalid private properties')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
     */
    return Promise.all(value.map(async (item) => {
      /**
       * 常量说明：record 用于处理 record 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const record = requireNativeRecord(item, 'Host Runtime private property')
      if (typeof record.name !== 'string') throw new Error('Host Runtime returned invalid private property')
      return {
        name: record.name,
        ...(record.value === undefined ? {} : { value: await this.remoteObject(record.value) }),
        ...(record.get === undefined ? {} : { get: await this.remoteObject(record.get) }),
        ...(record.set === undefined ? {} : { set: await this.remoteObject(record.set) }),
      }
    }))
  }

  /**
   * Convert native exception details to the common Runtime model.
   * @param value - Native `Runtime.ExceptionDetails` fields.
   * @returns Exception details with normalized object references.
   * @remarks 中文说明：功能说明：处理 exceptionDetails 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<RuntimeExceptionDetails<RuntimeBackendObjectHandle>>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 exceptionDetails(value)，
   * 并按返回类型处理结果。
   */
  async exceptionDetails(value: unknown): Promise<RuntimeExceptionDetails<RuntimeBackendObjectHandle>> {
    /**
     * 常量说明：record 用于处理 record 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const record = requireNativeRecord(value, 'Host Runtime exception details')
    if (typeof record.text !== 'string'
      || !Number.isSafeInteger(record.lineNumber)
      || !Number.isSafeInteger(record.columnNumber)) {
      throw new Error('Host Runtime returned invalid exception details')
    }
    return {
      ...record,
      text: record.text,
      lineNumber: record.lineNumber as number,
      columnNumber: record.columnNumber as number,
      ...(record.stackTrace === undefined ? {} : { stackTrace: this.stackTrace(record.stackTrace) }),
      ...(record.exception === undefined ? {} : { exception: await this.remoteObject(record.exception) }),
    }
  }

  /**
   * Convert one native V8 RemoteObject to the common Runtime model.
   * @param value - Native `Runtime.RemoteObject` fields.
   * @returns Descriptor, backend handle, and optional Cordis identity.
   * @remarks 中文说明：功能说明：处理 remoteObject 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<RuntimeRemoteObject<RuntimeBackendObjectHandle>>；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 remoteObject(value)，并按返回类型处理结果。
   */
  async remoteObject(value: unknown): Promise<RuntimeRemoteObject<RuntimeBackendObjectHandle>> {
    /**
     * 常量说明：record 用于处理 record 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const record = requireNativeRecord(value, 'Host Runtime RemoteObject')
    if (typeof record.type !== 'string') throw new Error('Host Runtime returned an invalid RemoteObject')
    /**
     * 常量说明：descriptor 用于处理 descriptor 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const descriptor = { ...record }
    Reflect.deleteProperty(descriptor, 'objectId')
    if (!isJsonValue(descriptor)) throw new Error('Host Runtime returned a non-JSON RemoteObject descriptor')
    /**
     * 常量说明：objectId 用于处理 objectId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const objectId = typeof record.objectId === 'string' ? record.objectId : undefined
    /**
     * 常量说明：semanticReference 用于处理 semanticReference 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const semanticReference = objectId === undefined ? undefined : await this.identifyObject(objectId)
    return {
      descriptor: descriptor as unknown as RuntimeRemoteObjectDescriptor,
      ...(objectId === undefined ? {} : { object: { handle: backendHandle(objectId) } }),
      ...(semanticReference === undefined ? {} : { semanticReference }),
    }
  }

  /**
   * Convert a native stack trace while retaining native script identities.
   * @param value - Native `Runtime.StackTrace` fields.
   * @returns Realm-neutral stack frames.
   * @remarks 中文说明：功能说明：处理 stackTrace 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：RuntimeStackTrace；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 stackTrace(value)，
   * 并按返回类型处理结果。
   */
  stackTrace(value: unknown): RuntimeStackTrace {
    /**
     * 常量说明：record 用于处理 record 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const record = requireNativeRecord(value, 'Host Runtime stack trace')
    if (!Array.isArray(record.callFrames)) throw new Error('Host Runtime returned an invalid stack trace')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：frame（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(frame)，并按返回类型处理结果。
     */
    return {
      ...(typeof record.description === 'string' ? { description: record.description } : {}),
      callFrames: record.callFrames.map((frame) => {
        /**
         * 常量说明：fields 用于处理 fields 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const fields = requireNativeRecord(frame, 'Host Runtime call frame')
        if (typeof fields.functionName !== 'string'
          || typeof fields.url !== 'string'
          || !Number.isSafeInteger(fields.lineNumber)
          || !Number.isSafeInteger(fields.columnNumber)) {
          throw new Error('Host Runtime returned an invalid call frame')
        }
        return {
          functionName: fields.functionName,
          ...(typeof fields.scriptId === 'string'
            ? { scriptKey: hostScriptKey(fields.scriptId) }
            : {}),
          url: fields.url,
          lineNumber: fields.lineNumber as number,
          columnNumber: fields.columnNumber as number,
        }
      }),
      ...(record.parent === undefined ? {} : { parent: this.stackTrace(record.parent) }),
    }
  }

  /**
   * 功能说明：处理 observeContext 相关流程；使用场景由所在模块及调用位置决定。
   * @param message （HostInspectorNotification）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 observeContext(message)，并按返回类型处理结果。
   */
  private observeContext(message: HostInspectorNotification): void {
    if (message.method === 'Runtime.executionContextCreated') {
      /**
       * 常量说明：context 用于处理 context 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const context = isNativeRecord(message.params?.context) ? message.params.context : undefined
      /**
       * 常量说明：auxData 用于处理 auxData 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const auxData = isNativeRecord(context?.auxData) ? context.auxData : undefined
      if (context !== undefined && auxData?.isDefault === true && Number.isSafeInteger(context.id)) {
        this.defaultContextId = context.id as number
      }
      return
    }
    if (message.method !== 'Runtime.executionContextDestroyed') return
    if (message.params?.executionContextId === this.defaultContextId) this.defaultContextId = undefined
  }

  /**
   * 功能说明：处理 identifyObject 相关流程；使用场景由所在模块及调用位置决定。
   * @param objectId （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<InspectorObjectReference | undefined>；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 identifyObject(objectId)，并按返回类型处理结果。
   */
  private async identifyObject(objectId: string): Promise<InspectorObjectReference | undefined> {
    try {
      /**
       * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const response = await this.target.request('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: IDENTIFY_REALM_OBJECT_FUNCTION,
        returnByValue: true,
        silent: true,
      })
      if (response.exceptionDetails !== undefined || !isNativeRecord(response.result)) return undefined
      return response.result.value === undefined
        ? undefined
        : parseInspectorObjectReference(response.result.value)
    } catch {
      // Semantic recognition is optional metadata; preserve the Runtime value on failure.
      return undefined
    }
  }
}

/**
 * 功能说明：处理 defaultContext 相关流程；使用场景由所在模块及调用位置决定。
 * @param contextId （number | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns RuntimeExecutionContext | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 defaultContext(contextId)，并按返回类型处理结果。
 */
function defaultContext(contextId: number | undefined): RuntimeExecutionContext | undefined {
  return contextId === undefined ? undefined : { kind: 'numeric', id: contextId }
}

/**
 * 功能说明：处理 nativeContext 相关流程；使用场景由所在模块及调用位置决定。
 * @param context （RuntimeExecutionContext | undefined）：提供当前 Cordis
 * 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。
 * @param numericKey （'contextId' | 'executionContextId'）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @returns Readonly<Record<string, number | string>> | undefined；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 nativeContext(context, numericKey)，并按返回类型处理结果。
 */
function nativeContext(
  context: RuntimeExecutionContext | undefined,
  numericKey: 'contextId' | 'executionContextId',
): Readonly<Record<string, number | string>> | undefined {
  if (context === undefined) return undefined
  return context.kind === 'numeric' ? { [numericKey]: context.id } : { uniqueContextId: context.id }
}

/**
 * 功能说明：处理 toNativeArgument 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （RuntimeCallArgument<RuntimeBackendObjectHandle>）：提供本次调用所需的
 * 数据；必须满足声明的类型及调用时序要求。
 * @returns Readonly<Record<string, unknown>>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 toNativeArgument(value)，并按返回类型处理结果。
 */
function toNativeArgument(value: RuntimeCallArgument<RuntimeBackendObjectHandle>): Readonly<Record<string, unknown>> {
  switch (value.kind) {
    case 'value': return { value: value.value }
    case 'unserializable': return { unserializableValue: value.value }
    case 'object': return { objectId: value.handle }
    case 'undefined': return {}
    default: return assertNever(value)
  }
}

/**
 * 功能说明：处理 backendHandle 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns RuntimeBackendObjectHandle；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 backendHandle(value)，并按返回类型处理结果。
 */
function backendHandle(value: string): RuntimeBackendObjectHandle {
  return inspectorId<'RuntimeBackendObjectHandle'>(value, 'Runtime backend object handle')
}

/**
 * 功能说明：断言 Never 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （never）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns never；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 assertNever(value)，并按返回类型处理结果。
 */
function assertNever(value: never): never {
  throw new Error(`Unexpected Runtime call argument: ${JSON.stringify(value)}`)
}
