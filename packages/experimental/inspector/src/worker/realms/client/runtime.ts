/** RuntimeBackend over the typed Worker-to-Client transport.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 runtime 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type {
  ClientCallArgument,
  ClientRuntimeCommand,
  ClientRuntimeResult,
} from '../../../shared/bridge/messages/runtime/index.ts'
import type { ClientRuntimeSessionId } from '../../../shared/bridge/ids.ts'
import type { RuntimeBackendObjectHandle } from '../../../shared/cdp/ids.ts'
import type { RuntimeCallArgument } from '../../../shared/cdp/index.ts'
import type { ClientRuntimeRouter, ClientRuntimeTarget } from '../../bridge/runtime-rpc.ts'
import type { RuntimeBackend } from '../../../shared/cdp/realm.ts'
import {
  clientCompletion,
  clientException,
  clientHandle,
  clientInternalProperty,
  clientProperty,
} from './values.ts'
import type { ClientScriptIdentity } from './scripts.ts'

/** Adapts one connection-local Client Runtime session to the common backend API.
 * @remarks 中文说明：类说明：ClientRuntimeBackend 用于集中封装 处理 ClientRuntimeBackend
 * 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由
 * experimental/inspector 在对应插件或业务生命周期内创建和调用。 */
export class ClientRuntimeBackend implements RuntimeBackend {
  /**
   * 变量说明：closed 用于处理 closed 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private closed = false

  /**
   * 功能说明：处理 ClientRuntimeBackend 相关流程；使用场景由所在模块及调用位置决定。
   * @param target （ClientRuntimeTarget）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param sessionId （ClientRuntimeSessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param router （ClientRuntimeRouter）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param scriptIds （ClientScriptIdentity）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new ClientRuntimeBackend(target, sessionId, router,
   * scriptIds) 创建实例，并在所属生命周期内使用。
   */
  constructor(
    private readonly target: ClientRuntimeTarget,
    private readonly sessionId: ClientRuntimeSessionId,
    private readonly router: ClientRuntimeRouter,
    private readonly scriptIds: ClientScriptIdentity,
  ) {}

  /**
   * 功能说明：处理 enable 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 enable()，并按返回类型处理结果。
   */
  enable(): Promise<void> {
    return Promise.resolve()
  }

  /**
   * 功能说明：处理 disable 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 disable()，并按返回类型处理结果。
   */
  disable(): Promise<void> {
    this.router.closeTargetSession(this.target, this.sessionId)
    return Promise.resolve()
  }

  /**
   * 功能说明：处理 evaluate 相关流程；使用场景由所在模块及调用位置决定。
   * @param request （Parameters<RuntimeBackend['evaluate']>[0]）：提供调用方提交的请求信息；
   * 必须满足声明的类型及调用时序要求。
   * @returns ReturnType<RuntimeBackend['evaluate']>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 evaluate(request)，并按返回类型处理结果。
   */
  async evaluate(request: Parameters<RuntimeBackend['evaluate']>[0]): ReturnType<RuntimeBackend['evaluate']> {
    assertClientEvaluationOptions(request)
    /**
     * 常量说明：_context、_throwOnSideEffect、_serializationOptions、supported 用于处理
     * _context、_throwOnSideEffect、_serializationOptions、supported 相关数据，
     * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const {
      context: _context,
      throwOnSideEffect: _throwOnSideEffect,
      serializationOptions: _serializationOptions,
      ...supported
    } = request
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：scriptKey（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(scriptKey)，并按返回类型处理结果。
     */
    return clientCompletion(
      expectResult(await this.request({ op: 'evaluate', ...supported }), 'evaluate'),
      scriptKey => this.scriptIds.toRuntime(scriptKey),
    )
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
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = expectResult(await this.request({
      op: 'get-properties',
      ...request,
      handle: clientHandle(request.handle),
    }), 'get-properties')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：scriptKey（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(scriptKey)，并按返回类型处理结果。
     */
    return {
      properties: result.properties.map(clientProperty),
      ...(result.internalProperties === undefined
        ? {}
        : { internalProperties: result.internalProperties.map(clientInternalProperty) }),
      ...(result.exceptionDetails === undefined
        ? {}
        : {
          exceptionDetails: clientException(
            result.exceptionDetails,
            scriptKey => this.scriptIds.toRuntime(scriptKey),
          ),
        }),
    }
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
    assertClientCallOptions(request)
    /**
     * 常量说明：receiver、_context、args、_throwOnSideEffect、_serializationOptions、opt
     * ions 用于处理 receiver、_context、args、_throwOnSideEffect、_serializationOption
     * s、options 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const {
      receiver,
      context: _context,
      arguments: args,
      throwOnSideEffect: _throwOnSideEffect,
      serializationOptions: _serializationOptions,
      ...options
    } = request
    /**
     * 常量说明：command 用于处理 command 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const command: Extract<ClientRuntimeCommand, { op: 'call-function' }> = {
      op: 'call-function',
      ...options,
      ...(receiver === undefined ? {} : { receiver: clientHandle(receiver) }),
      ...(args === undefined ? {} : { arguments: args.map(argumentToClient) }),
    }
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：scriptKey（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(scriptKey)，并按返回类型处理结果。
     */
    return clientCompletion(
      expectResult(await this.request(command), 'call-function'),
      scriptKey => this.scriptIds.toRuntime(scriptKey),
    )
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
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：scriptKey（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(scriptKey)，并按返回类型处理结果。
     */
    return clientCompletion(
      expectResult(await this.request({
        op: 'await-promise',
        ...request,
        promise: clientHandle(request.promise),
      }), 'await-promise'),
      scriptKey => this.scriptIds.toRuntime(scriptKey),
    )
  }

  /**
   * 功能说明：处理 globalLexicalScopeNames 相关流程；使用场景由所在模块及调用位置决定。
   * @param context （Parameters<RuntimeBackend['globalLexicalScopeNames']>[0]
   * ）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。
   * @returns Promise<readonly string[]>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 globalLexicalScopeNames(context)，并按返回类型处理结果。
   */
  async globalLexicalScopeNames(context?: Parameters<RuntimeBackend['globalLexicalScopeNames']>[0]): Promise<readonly string[]> {
    if (context !== undefined) throw new Error('Client Runtime does not support native execution contexts')
    return expectResult(await this.request({ op: 'global-lexical-scope-names' }), 'global-lexical-scope-names').names
  }

  /**
   * 功能说明：处理 releaseObject 相关流程；使用场景由所在模块及调用位置决定。
   * @param handle （RuntimeBackendObjectHandle）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 releaseObject(handle)，并按返回类型处理结果。
   */
  async releaseObject(handle: RuntimeBackendObjectHandle): Promise<void> {
    expectResult(await this.request({ op: 'release-object', handle: clientHandle(handle) }), 'release-object')
  }

  /**
   * 功能说明：处理 releaseObjectGroup 相关流程；使用场景由所在模块及调用位置决定。
   * @param group （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 releaseObjectGroup(group)，并按返回类型处理结果。
   */
  async releaseObjectGroup(group: string): Promise<void> {
    expectResult(await this.request({ op: 'release-object-group', objectGroup: group }), 'release-object-group')
  }

  /** Close this connection's session and reject further requests.
   * @remarks 中文说明：功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 close()，并按返回类型处理结果。 */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.router.closeTargetSession(this.target, this.sessionId)
  }

  /**
   * 功能说明：处理 request 相关流程；使用场景由所在模块及调用位置决定。
   * @param command （ClientRuntimeCommand）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<ClientRuntimeResult>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 request(command)，并按返回类型处理结果。
   */
  private request(command: ClientRuntimeCommand): Promise<ClientRuntimeResult> {
    if (this.closed) return Promise.reject(new Error('Client realm session is closed'))
    return this.router.request(this.target, this.sessionId, command)
  }
}

/**
 * 功能说明：处理 argumentToClient 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （RuntimeCallArgument<RuntimeBackendObjectHandle>）：提供本次调用所需的
 * 数据；必须满足声明的类型及调用时序要求。
 * @returns ClientCallArgument；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 argumentToClient(value)，并按返回类型处理结果。
 */
function argumentToClient(value: RuntimeCallArgument<RuntimeBackendObjectHandle>): ClientCallArgument {
  return value.kind === 'object' ? { kind: 'object', handle: clientHandle(value.handle) } : value
}

/**
 * 功能说明：处理 expectResult 相关流程；使用场景由所在模块及调用位置决定。
 * @param result （ClientRuntimeResult）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param operation （Operation）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Extract<ClientRuntimeResult, { op: Operation }>；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 expectResult(result, operation)，并按返回类型处理结果。
 */
function expectResult<Operation extends ClientRuntimeResult['op']>(
  result: ClientRuntimeResult,
  operation: Operation,
): Extract<ClientRuntimeResult, { op: Operation }> {
  if (result.op !== operation) throw new Error(`Client Runtime returned ${result.op} for ${operation}`)
  return result as Extract<ClientRuntimeResult, { op: Operation }>
}

/**
 * 功能说明：断言 Client Evaluation Options 相关流程；使用场景由所在模块及调用位置决定。
 * @param request （Parameters<RuntimeBackend['evaluate']>[0]）：提供调用方提交的请求信息；
 * 必须满足声明的类型及调用时序要求。
 * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 assertClientEvaluationOptions(request)，并按返回类型处理结果。
 */
function assertClientEvaluationOptions(request: Parameters<RuntimeBackend['evaluate']>[0]): void {
  if (request.context !== undefined) throw new Error('Client Runtime does not support native execution contexts')
  if (request.throwOnSideEffect === true) throw new Error('Client Runtime does not support throwOnSideEffect')
  if (request.serializationOptions !== undefined) throw new Error('Client Runtime does not support serializationOptions')
  if (request.disableBreaks === true) throw new Error('Client Runtime does not support disableBreaks')
  if (request.allowUnsafeEvalBlockedByCSP === true) {
    throw new Error('Client Runtime cannot bypass the page Content Security Policy')
  }
  if (request.timeoutMs !== undefined && request.awaitPromise !== true) {
    throw new Error('Client Runtime supports timeout only when awaitPromise is enabled')
  }
}

/**
 * 功能说明：断言 Client Call Options 相关流程；使用场景由所在模块及调用位置决定。
 * @param request （Parameters<RuntimeBackend['callFunction']>[0]）：提供调用方提交的请
 * 求信息；必须满足声明的类型及调用时序要求。
 * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 assertClientCallOptions(request)，并按返回类型处理结果。
 */
function assertClientCallOptions(request: Parameters<RuntimeBackend['callFunction']>[0]): void {
  if (request.context !== undefined) throw new Error('Client Runtime does not support native execution contexts')
  if (request.throwOnSideEffect === true) throw new Error('Client Runtime does not support throwOnSideEffect')
  if (request.serializationOptions !== undefined) throw new Error('Client Runtime does not support serializationOptions')
  if (request.userGesture === true) throw new Error('Client Runtime does not support userGesture')
}
