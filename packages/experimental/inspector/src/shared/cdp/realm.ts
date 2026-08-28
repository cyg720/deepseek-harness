/** Environment-independent backend interfaces for inspected JavaScript realms.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 realm 模块的职责，并向相邻模块提供可复用能力。
 * ；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { RuntimeBackendObjectHandle, RuntimeScriptKey } from './ids.ts'
import type {
  RuntimeAwaitPromiseRequest,
  RuntimeCallFunctionRequest,
  RuntimeCompletion,
  RuntimeConsoleBackendEvent,
  RuntimeDebuggerEvent,
  RuntimeDebuggerEnableRequest,
  RuntimeDebuggerResumeRequest,
  RuntimeCallFrameEvaluationRequest,
  RuntimeEvaluateRequest,
  RuntimeGetPropertiesRequest,
  RuntimeExecutionContext,
  RuntimeProperties,
  RuntimeScript,
} from './index.ts'

/** Raw notification emitted by a native engine protocol backend. */
export interface NativeProtocolNotification {
  readonly method: string
  readonly params?: Readonly<Record<string, unknown>>
}

/** Explicitly supported or unsupported realm capability. */
export type RealmCapability<Backend> =
  | { readonly state: 'supported'; readonly backend: Backend }
  | { readonly state: 'unsupported'; readonly reason: string }

/** Runtime operations implemented inside one per-connection realm session. */
export interface RuntimeBackend {
  /** Prepare Runtime events and execution state for this connection.
   * @remarks 中文说明：功能说明：处理 enable 相关流程；使用场景由所在模块及调用位置决定。；返回值：Promise<void>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 enable()，并按返回类型处理结果。 */
  enable(): Promise<void>
  /** Disable Runtime events and release backend session state.
   * @remarks 中文说明：功能说明：处理 disable 相关流程；使用场景由所在模块及调用位置决定。；返回值：Promise<void>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 disable()，并按返回类型处理结果。 */
  disable(): Promise<void>
  /**
   * Evaluate source in this realm.
   * @param request - Engine-independent evaluation request.
   * @returns Completion containing a value or JavaScript exception.
   * @remarks 中文说明：功能说明：处理 evaluate 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：request（RuntimeEvaluateRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<RuntimeCompletion<RuntimeBackendObjectHandle>>；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 evaluate(request)，并按返回类型处理结果。
   */
  evaluate(request: RuntimeEvaluateRequest): Promise<RuntimeCompletion<RuntimeBackendObjectHandle>>
  /**
   * Enumerate one retained object's properties.
   * @param request - Property request containing this backend's object handle.
   * @returns Property descriptors and optional exception details.
   * @remarks 中文说明：功能说明：获取 Properties 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：request（RuntimeGetPropertiesRequest<RuntimeBackendObjectHandle>）：提供
   * 调用方提交的请求信息；必须满足声明的类型及调用时序要求。；返回值：Promise<RuntimeProperties<RuntimeBacken
   * dObjectHandle>>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * getProperties(request)，并按返回类型处理结果。
   */
  getProperties(
    request: RuntimeGetPropertiesRequest<RuntimeBackendObjectHandle>,
  ): Promise<RuntimeProperties<RuntimeBackendObjectHandle>>
  /**
   * Invoke a function with references owned by this realm session.
   * @param request - Function source, receiver, arguments, and result options.
   * @returns Completion containing the invocation result or JavaScript exception.
   * @remarks 中文说明：功能说明：处理 callFunction 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：request（RuntimeCallFunctionRequest<RuntimeBackendObjectHandle>）：提供调
   * 用方提交的请求信息；必须满足声明的类型及调用时序要求。；返回值：Promise<RuntimeCompletion<RuntimeBackend
   * ObjectHandle>>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * callFunction(request)，并按返回类型处理结果。
   */
  callFunction(
    request: RuntimeCallFunctionRequest<RuntimeBackendObjectHandle>,
  ): Promise<RuntimeCompletion<RuntimeBackendObjectHandle>>
  /**
   * Await one retained Promise.
   * @param request - Promise handle and result options.
   * @returns Completion containing the fulfilled value or rejection.
   * @remarks 中文说明：功能说明：处理 awaitPromise 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：request（RuntimeAwaitPromiseRequest<RuntimeBackendObjectHandle>）：提供调
   * 用方提交的请求信息；必须满足声明的类型及调用时序要求。；返回值：Promise<RuntimeCompletion<RuntimeBackend
   * ObjectHandle>>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * awaitPromise(request)，并按返回类型处理结果。
   */
  awaitPromise(
    request: RuntimeAwaitPromiseRequest<RuntimeBackendObjectHandle>,
  ): Promise<RuntimeCompletion<RuntimeBackendObjectHandle>>
  /**
   * Read names visible in one backend execution context's global lexical scope.
   * @param context - Native sub-context selector, or the realm default when omitted.
   * @returns Names visible in the selected global lexical scope.
   * @remarks 中文说明：功能说明：处理 globalLexicalScopeNames 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：context（RuntimeExecutionContext）：提供当前 Cordis 插件上下文与已声明服务；
   * 必须满足声明的类型及调用时序要求。；返回值：Promise<readonly string[]>；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 globalLexicalScopeNames(context)，
   * 并按返回类型处理结果。
   */
  globalLexicalScopeNames(context?: RuntimeExecutionContext): Promise<readonly string[]>
  /**
   * Release one backend object reference.
   * @param handle - Handle owned by this realm session.
   * @remarks 中文说明：功能说明：处理 releaseObject 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：handle（RuntimeBackendObjectHandle）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * releaseObject(handle)，并按返回类型处理结果。
   */
  releaseObject(handle: RuntimeBackendObjectHandle): Promise<void>
  /**
   * Release every backend object retained under one group.
   * @param group - DevTools object-group name.
   * @remarks 中文说明：功能说明：处理 releaseObjectGroup 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：group（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<void>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 releaseObjectGroup(group)，
   * 并按返回类型处理结果。
   */
  releaseObjectGroup(group: string): Promise<void>
}

/** Realm Console event source. */
export interface ConsoleBackend {
  /**
   * Subscribe to Console and uncaught-exception events.
   * @param listener - Connection-local event consumer.
   * @returns A disposer for the subscription.
   * @remarks 中文说明：功能说明：处理 subscribe 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：listener（(event: RuntimeConsoleBackendEvent<RuntimeBackendObjectHan
   * d…）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。；返回值：() => void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 subscribe(listener)，并按返回类型处理结果。
   */
  subscribe(listener: (event: RuntimeConsoleBackendEvent<RuntimeBackendObjectHandle>) => void): () => void
  /** Clear backend-owned Console history when supported.
   * @remarks 中文说明：功能说明：处理 clear 相关流程；使用场景由所在模块及调用位置决定。；返回值：Promise<void>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 clear()，并按返回类型处理结果。 */
  clear(): Promise<void>
}

/** Realm script catalog independent of CDP ScriptId allocation. */
export interface SourceBackend {
  /** @returns Every script currently known to this realm.
   * @remarks 中文说明：功能说明：列出 Scripts 相关流程；使用场景由所在模块及调用位置决定。；
   * 返回值：Promise<readonly RuntimeScript[]>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 listScripts()，并按返回类型处理结果。 */
  listScripts(): Promise<readonly RuntimeScript[]>
  /**
   * Read source text for one realm-local script key.
   * @param scriptKey - Script identity allocated by this realm.
   * @returns The complete source text.
   * @remarks 中文说明：功能说明：获取 Script Source 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：scriptKey（RuntimeScriptKey）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<string>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * getScriptSource(scriptKey)，并按返回类型处理结果。
   */
  getScriptSource(scriptKey: RuntimeScriptKey): Promise<string>
  /**
   * Read an optional source map for one realm-local script key.
   * @param scriptKey - Script identity allocated by this realm.
   * @returns Source-map JSON when one exists.
   * @remarks 中文说明：功能说明：获取 Source Map 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：scriptKey（RuntimeScriptKey）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<string | undefined>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 getSourceMap(scriptKey)，并按返回类型处理结果。
   */
  getSourceMap(scriptKey: RuntimeScriptKey): Promise<string | undefined>
  /**
   * Subscribe to scripts discovered after the initial catalog read.
   * @param listener - Consumer of newly discovered scripts.
   * @returns A disposer for the subscription.
   * @remarks 中文说明：功能说明：处理 subscribe 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：listener（(script: RuntimeScript) => void）：接收后续状态或事件并执行调用方逻辑；
   * 必须满足声明的类型及调用时序要求。；返回值：() => void；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 subscribe(listener)，并按返回类型处理结果。
   */
  subscribe(listener: (script: RuntimeScript) => void): () => void
}

/** Active JavaScript debugging backend for one realm session. */
export interface DebuggerBackend {
  /** Enable debugger events for this connection.
   * @remarks 中文说明：功能说明：处理 enable 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：request（RuntimeDebuggerEnableRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * ；返回值：Promise<Readonly<Record<string, unknown>>>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * ；使用示例：典型用法：在完成前置校验后调用 enable(request)，并按返回类型处理结果。 */
  enable(request: RuntimeDebuggerEnableRequest): Promise<Readonly<Record<string, unknown>>>
  /** Disable debugger events for this connection.
   * @remarks 中文说明：功能说明：处理 disable 相关流程；使用场景由所在模块及调用位置决定。；
   * 返回值：Promise<Readonly<Record<string, unknown>>>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 disable()，并按返回类型处理结果。 */
  disable(): Promise<Readonly<Record<string, unknown>>>
  /** Pause this realm.
   * @remarks 中文说明：功能说明：处理 pause 相关流程；使用场景由所在模块及调用位置决定。；
   * 返回值：Promise<Readonly<Record<string, unknown>>>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 pause()，并按返回类型处理结果。 */
  pause(): Promise<Readonly<Record<string, unknown>>>
  /** Resume this realm.
   * @remarks 中文说明：功能说明：处理 resume 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：request（RuntimeDebuggerResumeRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * ；返回值：Promise<Readonly<Record<string, unknown>>>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * ；使用示例：典型用法：在完成前置校验后调用 resume(request)，并按返回类型处理结果。 */
  resume(request: RuntimeDebuggerResumeRequest): Promise<Readonly<Record<string, unknown>>>
  /**
   * Evaluate an expression in one paused frame.
   * @param request - Frame identity, expression, and result options.
   * @returns A common Runtime completion.
   * @remarks 中文说明：功能说明：处理 evaluateOnCallFrame 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：request（RuntimeCallFrameEvaluationRequest）：提供调用方提交的请求信息；
   * 必须满足声明的类型及调用时序要求。；返回值：Promise<RuntimeCompletion<RuntimeBackendObjectHand
   * le>>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * evaluateOnCallFrame(request)，并按返回类型处理结果。
   */
  evaluateOnCallFrame(
    request: RuntimeCallFrameEvaluationRequest,
  ): Promise<RuntimeCompletion<RuntimeBackendObjectHandle>>
  /**
   * Subscribe to paused, resumed, and breakpoint events.
   * @param listener - Connection-local debugger event consumer.
   * @returns A disposer removing the consumer.
   * @remarks 中文说明：功能说明：处理 subscribe 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：listener（(event: RuntimeDebuggerEvent<RuntimeBackendObjectHandle>)
   * =…）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。；返回值：() => void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 subscribe(listener)，并按返回类型处理结果。
   */
  subscribe(listener: (event: RuntimeDebuggerEvent<RuntimeBackendObjectHandle>) => void): () => void
}

/** Explicit Host-only native protocol adapter for domains not yet normalized. */
export interface NativeDomainBackend {
  /**
   * Execute one native protocol request.
   * @param method - CDP method owned by the native engine.
   * @param params - Parsed CDP parameters.
   * @returns Native response fields.
   * @remarks 中文说明：功能说明：处理 request 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：method（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：params（Readonly<Record<string, unknown>>）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：Promise<Readonly<Record<string, unknown>>>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 request(method, params)，
   * 并按返回类型处理结果。
   */
  request(method: string, params: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>>
  /**
   * Subscribe to native protocol notifications.
   * @param listener - Notification consumer.
   * @returns A disposer removing the consumer.
   * @remarks 中文说明：功能说明：处理 subscribe 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：listener（(message: NativeProtocolNotification) =>
   * void）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。；返回值：() => void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 subscribe(listener)，并按返回类型处理结果。
   */
  subscribe(listener: (message: NativeProtocolNotification) => void): () => void
}
