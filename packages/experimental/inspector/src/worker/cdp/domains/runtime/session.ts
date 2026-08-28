/** Per-DevTools-session Runtime routing across uniform Host and Client realms.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 session 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { InspectorSourceDescriptor } from '../../../../shared/bridge/messages/observation.ts'
import type { InspectorRealmId, RuntimeBackendObjectHandle } from '../../../../shared/cdp/ids.ts'
import type { RuntimeCallArgument, RuntimeCompletion, RuntimeRemoteObject } from '../../../../shared/cdp/index.ts'
import type { RuntimeExecutionContext } from '../../../../shared/cdp/operations.ts'
import type { RuntimeBackend } from '../../../../shared/cdp/realm.ts'
import { cdpError, respondToCdpRequest, type CdpRequest, type CdpTransport } from '../../protocol.ts'
import type { InspectorRealmSession } from '../../../inspection/realm.ts'
import type { InspectorRealmSessionEvent, InspectorRealmSessionSet } from '../../realm-sessions.ts'
import {
  parseAwaitPromise,
  parseCallFunction,
  parseEvaluate,
  parseGetProperties,
  parseGlobalLexicalScopeNames,
  parseReleaseObject,
  parseReleaseObjectGroup,
  type CdpCallArgument,
  type CdpExecutionContextSelector,
} from './cdp-params.ts'
import { RuntimeObjectTable, type RuntimeObjectObserver } from './object-table.ts'
import type { RuntimeObjectRoute } from './object-table.ts'

/** Runtime router layered over the common per-connection realm sessions.
 * @remarks 中文说明：类说明：RuntimeDomainSession 用于集中封装 处理 RuntimeDomainSession
 * 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由
 * experimental/inspector 在对应插件或业务生命周期内创建和调用。 */
export class RuntimeDomainSession {
  /**
   * 常量说明：objects 用于处理 objects 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly objects: RuntimeObjectTable
  /**
   * 常量说明：announcedContexts 用于处理 announcedContexts 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly announcedContexts = new Set<number>()
  /**
   * 常量说明：consoleDisposers 用于处理 consoleDisposers 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly consoleDisposers = new Map<InspectorRealmId, () => void>()
  /**
   * 常量说明：unsubscribeRealms 用于处理 unsubscribeRealms 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly unsubscribeRealms: () => void
  /**
   * 变量说明：enabled 用于处理 enabled 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private enabled = false
  /**
   * 变量说明：closed 用于处理 closed 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private closed = false

  /**
   * 功能说明：处理 RuntimeDomainSession 相关流程；使用场景由所在模块及调用位置决定。
   * @param transport （CdpTransport）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param realms （InspectorRealmSessionSet）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new RuntimeDomainSession(transport, realms) 创建实例，并在所属生命周期内使用。
   */
  constructor(
    private readonly transport: CdpTransport,
    private readonly realms: InspectorRealmSessionSet,
  ) {
    this.objects = new RuntimeObjectTable(realms.connectionId)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
     * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
     */
    this.unsubscribeRealms = realms.subscribe((event) => { this.receiveRealm(event) })
  }

  /**
   * Handle methods that require cross-realm Runtime coordination.
   * @param request - Parsed CDP request.
   * @returns Whether this domain owns the method or object id.
   * @remarks 中文说明：功能说明：处理 handle 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：request（CdpRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；返回值：boolean；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 handle(request)，
   * 并按返回类型处理结果。
   */
  handle(request: CdpRequest): boolean {
    switch (request.method) {
      case 'Runtime.enable':
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
         */
        this.respond(request, () => this.enable())
        return true
      case 'Runtime.disable':
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
         */
        this.respond(request, () => this.disable())
        return true
      case 'Runtime.evaluate':
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
         */
        this.respond(request, () => this.evaluate(request.params))
        return true
      case 'Runtime.getProperties':
        return this.getProperties(request)
      case 'Runtime.callFunctionOn':
        return this.callFunction(request)
      case 'Runtime.awaitPromise':
        return this.awaitPromise(request)
      case 'Runtime.releaseObject':
        return this.releaseObject(request)
      case 'Runtime.releaseObjectGroup':
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
         */
        this.respond(request, () => this.releaseObjectGroup(request.params))
        return true
      case 'Runtime.globalLexicalScopeNames':
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
         */
        this.respond(request, () => this.globalLexicalScopeNames(request.params))
        return true
      case 'Runtime.discardConsoleEntries':
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
         */
        this.respond(request, () => this.discardConsoleEntries())
        return true
      default:
        if (request.method.startsWith('Runtime.')) {
          /**
           * 常量说明：reason 用于处理 reason 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
           */
          const reason = this.unsupportedNativeRoute(request.params)
          if (reason !== undefined) {
            this.sendError(request, reason)
            return true
          }
        }
        return false
    }
  }

  /** Release this connection's object routes and realm subscription.
   * @remarks 中文说明：功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 close()，并按返回类型处理结果。 */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.unsubscribeRealms()
    /**
     * 变量说明：dispose 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const dispose of this.consoleDisposers.values()) dispose()
    this.consoleDisposers.clear()
    this.objects.clear()
    this.announcedContexts.clear()
  }

  /**
   * Install semantic object recognition shared with the DOM adapter.
   * @param observer - Callback invoked for objects carrying semantic references.
   * @remarks 中文说明：功能说明：设置 Object Observer 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：observer（RuntimeObjectObserver）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * setObjectObserver(observer)，并按返回类型处理结果。
   */
  setObjectObserver(observer: RuntimeObjectObserver): void {
    this.objects.setObserver(observer)
  }

  /**
   * Resolve a connection-local CDP object id for another domain adapter.
   * @param objectId - CDP object id allocated by this Runtime session.
   * @returns Its realm and backend handle when still live.
   * @remarks 中文说明：功能说明：处理 objectRoute 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：objectId（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：RuntimeObjectRoute | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 objectRoute(objectId)，并按返回类型处理结果。
   */
  objectRoute(objectId: string): RuntimeObjectRoute | undefined {
    return this.objects.resolve(objectId)
  }

  /**
   * Project a completion produced by another domain through this connection's object table.
   * @param realm - Realm session that owns the completion.
   * @param completion - Realm-neutral result and exception fields.
   * @param group - Object group assigned to exposed handles.
   * @returns CDP Runtime result fields.
   * @remarks 中文说明：功能说明：处理 projectCompletion 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：realm（InspectorRealmSession）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：completion（RuntimeCompletion<RuntimeBackendObjectHandle>）：提供本次调用所需的
   * 数据；必须满足声明的类型及调用时序要求。；参数说明：group（string | undefined）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：object；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 projectCompletion(realm, completion, group)，
   * 并按返回类型处理结果。
   */
  projectCompletion(
    realm: InspectorRealmSession,
    completion: RuntimeCompletion<RuntimeBackendObjectHandle>,
    group: string | undefined,
  ): object {
    return this.objects.completion(realm, completion, group)
  }

  /**
   * Project one Runtime value produced by another domain.
   * @param realm - Realm session that owns the value.
   * @param value - Realm-neutral Runtime value.
   * @param group - Object group assigned to an exposed handle.
   * @returns CDP RemoteObject fields.
   * @remarks 中文说明：功能说明：处理 projectRemoteObject 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：realm（InspectorRealmSession）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：value（RuntimeRemoteObject<RuntimeBackendObjectHandle>）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；参数说明：group（string | undefined）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：Readonly<Record<string, unknown>>；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 projectRemoteObject(realm, value,
   * group)，并按返回类型处理结果。
   */
  projectRemoteObject(
    realm: InspectorRealmSession,
    value: RuntimeRemoteObject<RuntimeBackendObjectHandle>,
    group: string | undefined,
  ): Readonly<Record<string, unknown>> {
    return this.objects.remote(realm, value, group)
  }

  /**
   * Forget connection-local ids retained for another domain's object group.
   * @param group - Object group whose projected ids have expired.
   * @remarks 中文说明：功能说明：处理 releaseProjectedGroup 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：group（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 releaseProjectedGroup(group)，
   * 并按返回类型处理结果。
   */
  releaseProjectedGroup(group: string): void {
    this.objects.releaseGroup(group)
  }

  /**
   * Replace common object ids with native backend handles in a Host-only request.
   * @param params - Parsed CDP parameters that may contain nested object ids.
   * @returns A detached parameter record suitable for the native Host protocol.
   * @remarks 中文说明：功能说明：处理 nativeParameters 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：params（Readonly<Record<string, unknown>>）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：Readonly<Record<string, unknown>>；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 nativeParameters(params)，并按返回类型处理结果。
   */
  nativeParameters(params: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
    /**
     * 常量说明：visit 用于处理 visit 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：处理 visit 相关流程；使用场景由所在模块及调用位置决定。
     * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @param key （string | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns unknown；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 visit(value, key)，并按返回类型处理结果。
     */
    const visit = (value: unknown, key: string | undefined): unknown => {
      if ((key === 'objectId' || key?.endsWith('ObjectId') === true) && typeof value === 'string') {
        /**
         * 常量说明：route 用于处理 route 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const route = this.objects.resolve(value)
        if (route === undefined) return value
        if (route.realm.nativeDomains.state === 'unsupported') throw new Error(route.realm.nativeDomains.reason)
        return route.handle
      }
      /**
      * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：item（由 TypeScript
      * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
      * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(item)，并按返回类型处理结果。
      */
      if (Array.isArray(value)) return value.map(item => visit(item, undefined))
      if (typeof value !== 'object' || value === null) return value
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：[name, item]（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调([name, item])，并按返回类型处理结果。
       */
      return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, visit(item, name)]))
    }
    return visit(params, undefined) as Readonly<Record<string, unknown>>
  }

  /**
   * Resolve one realm-registry expression to a connection-local object id.
   * @param source - Source generation that owns the Cordis tree node.
   * @param expression - Side-effect-free realm object lookup.
   * @param objectGroup - Optional DevTools retention group.
   * @returns The CDP RemoteObject fields.
   * @remarks 中文说明：功能说明：解析 Object 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：source（InspectorSourceDescriptor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：expression（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：objectGroup（string | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<Readonly<Record<string, unknown>>>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 resolveObject(source, expression, objectGroup)，
   * 并按返回类型处理结果。
   */
  async resolveObject(
    source: InspectorSourceDescriptor,
    expression: string,
    objectGroup: string | undefined,
  ): Promise<Readonly<Record<string, unknown>>> {
    /**
     * 常量说明：realm 用于处理 realm 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const realm = this.realms.bySource(source)
    if (realm === undefined) throw new Error('Cordis realm is no longer connected')
    /**
     * 常量说明：runtime 用于处理 runtime 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const runtime = runtimeBackend(realm)
    /**
     * 常量说明：completion 用于处理 completion 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const completion = await runtime.evaluate({
      expression,
      generatePreview: true,
      ...(objectGroup === undefined ? {} : { objectGroup }),
    })
    if (completion.exceptionDetails !== undefined) throw new Error('Cordis object lookup failed')
    return this.objects.completion(realm, completion, objectGroup).result
  }

  /**
   * 功能说明：处理 enable 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Promise<object>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 enable()，并按返回类型处理结果。
   */
  private async enable(): Promise<object> {
    this.enabled = true
    /**
     * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：realm（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(realm)，并按返回类型处理结果。
       */
      await Promise.all(this.realms.all().map(async (realm) => { await runtimeBackend(realm).enable() }))
      /**
       * 变量说明：realm 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const realm of this.realms.all()) {
        this.attachConsole(realm)
        this.announce(realm)
      }
      return {}
    } catch (error) {
      this.enabled = false
      /**
       * 变量说明：dispose 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const dispose of this.consoleDisposers.values()) dispose()
      this.consoleDisposers.clear()
      this.announcedContexts.clear()
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：realm（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(realm)，并按返回类型处理结果。
       */
      await Promise.allSettled(this.realms.all().map(async (realm) => { await runtimeBackend(realm).disable() }))
      throw error
    }
  }

  /**
   * 功能说明：处理 disable 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Promise<object>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 disable()，并按返回类型处理结果。
   */
  private async disable(): Promise<object> {
    /**
     * 变量说明：dispose 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const dispose of this.consoleDisposers.values()) dispose()
    this.consoleDisposers.clear()
    try {
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：realm（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(realm)，并按返回类型处理结果。
       */
      await Promise.all(this.realms.all().map(async (realm) => { await runtimeBackend(realm).disable() }))
    } finally {
      this.enabled = false
      this.objects.clear()
      this.announcedContexts.clear()
    }
    return {}
  }

  /**
   * 功能说明：处理 evaluate 相关流程；使用场景由所在模块及调用位置决定。
   * @param params （Readonly<Record<string, unknown>>）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @returns Promise<object>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 evaluate(params)，并按返回类型处理结果。
   */
  private async evaluate(params: Readonly<Record<string, unknown>>): Promise<object> {
    /**
     * 常量说明：parsed 用于处理 parsed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const parsed = parseEvaluate(params)
    /**
     * 常量说明：realm 用于处理 realm 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const realm = this.realmFromSelector(parsed, 'contextId')
    /**
     * 常量说明：completion 用于处理 completion 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const completion = await runtimeBackend(realm).evaluate({
      ...parsed.request,
      ...this.backendContext(realm, parsed, 'contextId'),
    })
    return this.objects.completion(realm, completion, parsed.request.objectGroup)
  }

  /**
   * 功能说明：获取 Properties 相关流程；使用场景由所在模块及调用位置决定。
   * @param request （CdpRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 getProperties(request)，并按返回类型处理结果。
   */
  private getProperties(request: CdpRequest): boolean {
    /**
     * 常量说明：objectId 用于处理 objectId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const objectId = request.params.objectId
    if (typeof objectId !== 'string') return false
    /**
     * 常量说明：route 用于处理 route 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const route = this.objects.resolve(objectId)
    if (route === undefined) return false
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    this.respond(request, async () => {
      /**
       * 常量说明：parsed 用于处理 parsed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const parsed = parseGetProperties(request.params)
      /**
       * 常量说明：properties 用于处理 properties 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const properties = await runtimeBackend(route.realm).getProperties({ ...parsed.request, handle: route.handle })
      return this.objects.properties(route.realm, properties, route.group)
    })
    return true
  }

  /**
   * 功能说明：处理 callFunction 相关流程；使用场景由所在模块及调用位置决定。
   * @param request （CdpRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 callFunction(request)，并按返回类型处理结果。
   */
  private callFunction(request: CdpRequest): boolean {
    /**
     * 常量说明：objectId 用于处理 objectId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const objectId = typeof request.params.objectId === 'string' ? request.params.objectId : undefined
    /**
     * 常量说明：receiver 用于处理 receiver 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const receiver = objectId === undefined ? undefined : this.objects.resolve(objectId)
    /**
     * 常量说明：selected 用于处理 selected 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const selected = this.realmFromOptionalSelector(request.params, 'executionContextId')
    if (receiver === undefined && selected === undefined && objectId !== undefined) return false
    /**
     * 常量说明：realm 用于处理 realm 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const realm = receiver?.realm ?? selected ?? this.realms.host()
    if (receiver !== undefined && selected !== undefined && receiver.realm !== selected) {
      this.sendError(request, 'Runtime.callFunctionOn receiver and execution context belong to different realms')
      return true
    }
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    this.respond(request, async () => {
      /**
       * 常量说明：parsed 用于处理 parsed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const parsed = parseCallFunction(request.params)
      /**
       * 常量说明：group 用于处理 group 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const group = parsed.request.objectGroup ?? receiver?.group
      /**
       * 常量说明：completion 用于处理 completion 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：argument（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(argument)，并按返回类型处理结果。
       */
      const completion = await runtimeBackend(realm).callFunction({
        ...parsed.request,
        ...this.backendContext(realm, parsed, 'executionContextId'),
        ...(receiver === undefined ? {} : { receiver: receiver.handle }),
        arguments: parsed.arguments.map(argument => this.routeArgument(realm, argument)),
      })
      return this.objects.completion(realm, completion, group)
    })
    return true
  }

  /**
   * 功能说明：处理 awaitPromise 相关流程；使用场景由所在模块及调用位置决定。
   * @param request （CdpRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 awaitPromise(request)，并按返回类型处理结果。
   */
  private awaitPromise(request: CdpRequest): boolean {
    /**
     * 常量说明：objectId 用于处理 objectId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const objectId = request.params.promiseObjectId
    if (typeof objectId !== 'string') return false
    /**
     * 常量说明：route 用于处理 route 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const route = this.objects.resolve(objectId)
    if (route === undefined) return false
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    this.respond(request, async () => {
      /**
       * 常量说明：parsed 用于处理 parsed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const parsed = parseAwaitPromise(request.params)
      /**
       * 常量说明：completion 用于处理 completion 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const completion = await runtimeBackend(route.realm).awaitPromise({ ...parsed.request, promise: route.handle })
      return this.objects.completion(route.realm, completion, route.group)
    })
    return true
  }

  /**
   * 功能说明：处理 releaseObject 相关流程；使用场景由所在模块及调用位置决定。
   * @param request （CdpRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 releaseObject(request)，并按返回类型处理结果。
   */
  private releaseObject(request: CdpRequest): boolean {
    /**
     * 常量说明：objectId 用于处理 objectId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const objectId = request.params.objectId
    if (typeof objectId !== 'string') return false
    /**
     * 常量说明：route 用于处理 route 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const route = this.objects.resolve(objectId)
    if (route === undefined) return false
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    this.respond(request, async () => {
      parseReleaseObject(request.params)
      await runtimeBackend(route.realm).releaseObject(route.handle)
      this.objects.release(objectId)
      return {}
    })
    return true
  }

  /**
   * 功能说明：处理 releaseObjectGroup 相关流程；使用场景由所在模块及调用位置决定。
   * @param params （Readonly<Record<string, unknown>>）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @returns Promise<object>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 releaseObjectGroup(params)，并按返回类型处理结果。
   */
  private async releaseObjectGroup(params: Readonly<Record<string, unknown>>): Promise<object> {
    /**
     * 常量说明：group 用于处理 group 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const group = parseReleaseObjectGroup(params)
    /**
     * 常量说明：realms 用于处理 realms 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const realms = this.objects.realmsInGroup(group)
    try {
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：realm（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(realm)，并按返回类型处理结果。
       */
      await Promise.all(realms.map(async (realm) => { await runtimeBackend(realm).releaseObjectGroup(group) }))
    } finally {
      this.objects.releaseGroup(group)
    }
    return {}
  }

  /**
   * 功能说明：处理 globalLexicalScopeNames 相关流程；使用场景由所在模块及调用位置决定。
   * @param params （Readonly<Record<string, unknown>>）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @returns Promise<object>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 globalLexicalScopeNames(params)，并按返回类型处理结果。
   */
  private async globalLexicalScopeNames(params: Readonly<Record<string, unknown>>): Promise<object> {
    /**
     * 常量说明：parsed 用于处理 parsed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const parsed = parseGlobalLexicalScopeNames(params)
    /**
     * 常量说明：realm 用于处理 realm 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const realm = this.realmFromSelector(parsed, 'executionContextId')
    /**
     * 常量说明：context 用于处理 context 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const context = this.backendContext(realm, parsed, 'executionContextId').context
    return { names: await runtimeBackend(realm).globalLexicalScopeNames(context) }
  }

  /**
   * 功能说明：处理 discardConsoleEntries 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Promise<object>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 discardConsoleEntries()，并按返回类型处理结果。
   */
  private async discardConsoleEntries(): Promise<object> {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：realm（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(realm)，并按返回类型处理结果。
     */
    await Promise.all(this.realms.all().map(async (realm) => {
      if (realm.console.state === 'supported') await realm.console.backend.clear()
      await runtimeBackend(realm).releaseObjectGroup('console')
    }))
    this.objects.releaseGroup('console')
    return {}
  }

  /**
   * 功能说明：处理 realmFromSelector 相关流程；使用场景由所在模块及调用位置决定。
   * @param params （CdpExecutionContextSelector）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param numericKey （'contextId' | 'executionContextId'）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @returns InspectorRealmSession；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 realmFromSelector(params, numericKey)，并按返回类型处理结果。
   */
  private realmFromSelector(
    params: CdpExecutionContextSelector,
    numericKey: 'contextId' | 'executionContextId',
  ): InspectorRealmSession {
    return this.realmFromOptionalSelector(params, numericKey) ?? this.realms.host()
  }

  /**
   * 功能说明：处理 realmFromOptionalSelector 相关流程；使用场景由所在模块及调用位置决定。
   * @param params （CdpExecutionContextSelector）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param numericKey （'contextId' | 'executionContextId'）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @returns InspectorRealmSession | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 realmFromOptionalSelector(params, numericKey)，
   * 并按返回类型处理结果。
   */
  private realmFromOptionalSelector(
    params: CdpExecutionContextSelector,
    numericKey: 'contextId' | 'executionContextId',
  ): InspectorRealmSession | undefined {
    /**
     * 常量说明：numeric 用于处理 numeric 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const numeric = params[numericKey]
    if (typeof numeric === 'number' && Number.isSafeInteger(numeric)) {
      /**
       * 常量说明：realm 用于处理 realm 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const realm = this.realms.byContextId(numeric)
      if (realm !== undefined) return realm
      if (numeric < 0) throw new Error('Client execution context is no longer available')
      return this.realms.host()
    }
    /**
     * 常量说明：unique 用于处理 unique 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const unique = params.uniqueContextId
    if (typeof unique === 'string') {
      /**
       * 常量说明：realm 用于处理 realm 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const realm = this.realms.byUniqueContextId(unique)
      if (realm !== undefined) return realm
      if (unique.startsWith('dsh-client:')) throw new Error('Client execution context is no longer available')
      return this.realms.host()
    }
    return undefined
  }

  /**
   * 功能说明：处理 backendContext 相关流程；使用场景由所在模块及调用位置决定。
   * @param realm （InspectorRealmSession）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param params （CdpExecutionContextSelector）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param numericKey （'contextId' | 'executionContextId'）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @returns { readonly context?: RuntimeExecutionContext }；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 backendContext(realm, params, numericKey)，并按返回类型处理结果。
   */
  private backendContext(
    realm: InspectorRealmSession,
    params: CdpExecutionContextSelector,
    numericKey: 'contextId' | 'executionContextId',
  ): { readonly context?: RuntimeExecutionContext } {
    if (realm.context.kind !== 'native') return {}
    /**
     * 常量说明：numeric 用于处理 numeric 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const numeric = params[numericKey]
    if (typeof numeric === 'number') return { context: { kind: 'numeric', id: numeric } }
    return params.uniqueContextId === undefined
      ? {}
      : { context: { kind: 'unique', id: params.uniqueContextId } }
  }

  /**
   * 功能说明：处理 routeArgument 相关流程；使用场景由所在模块及调用位置决定。
   * @param realm （InspectorRealmSession）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param argument （CdpCallArgument）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns RuntimeCallArgument<RuntimeBackendObjectHandle>；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 routeArgument(realm, argument)，并按返回类型处理结果。
   */
  private routeArgument(
    realm: InspectorRealmSession,
    argument: CdpCallArgument,
  ): RuntimeCallArgument<RuntimeBackendObjectHandle> {
    if (argument.kind !== 'object') return argument
    /**
     * 常量说明：route 用于处理 route 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const route = this.objects.resolve(argument.objectId)
    if (route === undefined || route.realm !== realm) {
      throw new Error('Runtime.callFunctionOn cannot pass an object between realms')
    }
    return { kind: 'object', handle: route.handle }
  }

  /**
   * 功能说明：处理 unsupportedNativeRoute 相关流程；使用场景由所在模块及调用位置决定。
   * @param params （Readonly<Record<string, unknown>>）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @returns string | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 unsupportedNativeRoute(params)，并按返回类型处理结果。
   */
  private unsupportedNativeRoute(params: Readonly<Record<string, unknown>>): string | undefined {
    /**
     * 变量说明：key 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const key of ['contextId', 'executionContextId'] as const) {
      /**
       * 常量说明：contextId 用于处理 contextId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const contextId = params[key]
      if (typeof contextId !== 'number') continue
      /**
       * 常量说明：realm 用于处理 realm 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const realm = this.realms.byContextId(contextId)
      if (realm?.nativeDomains.state === 'unsupported') return realm.nativeDomains.reason
      if (contextId < 0 && realm === undefined) return 'Client execution context is no longer available'
    }
    if (typeof params.uniqueContextId === 'string') {
      /**
       * 常量说明：realm 用于处理 realm 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const realm = this.realms.byUniqueContextId(params.uniqueContextId)
      if (realm?.nativeDomains.state === 'unsupported') return realm.nativeDomains.reason
      if (params.uniqueContextId.startsWith('dsh-client:') && realm === undefined) {
        return 'Client execution context is no longer available'
      }
    }
    /**
     * 变量说明：key、value 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const [key, value] of Object.entries(params)) {
      if (!key.endsWith('ObjectId') && key !== 'objectId') continue
      if (typeof value !== 'string') continue
      /**
       * 常量说明：route 用于处理 route 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const route = this.objects.resolve(value)
      if (route?.realm.nativeDomains.state === 'unsupported') return route.realm.nativeDomains.reason
    }
    return undefined
  }

  /**
   * 功能说明：处理 receiveRealm 相关流程；使用场景由所在模块及调用位置决定。
   * @param event （InspectorRealmSessionEvent）：提供需要处理或投影的事件数据；
   * 必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 receiveRealm(event)，并按返回类型处理结果。
   */
  private receiveRealm(event: InspectorRealmSessionEvent): void {
    if (event.type === 'opened') {
      if (this.enabled) {
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
         */
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
         */
        void runtimeBackend(event.session).enable().then(
          () => {
            this.attachConsole(event.session)
            this.announce(event.session)
          },
          () => { event.session.close() },
        )
      }
      return
    }
    this.consoleDisposers.get(event.session.descriptor.realmId)?.()
    this.consoleDisposers.delete(event.session.descriptor.realmId)
    this.objects.releaseRealm(event.session)
    this.destroy(event.session)
  }

  /**
   * 功能说明：处理 attachConsole 相关流程；使用场景由所在模块及调用位置决定。
   * @param realm （InspectorRealmSession）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 attachConsole(realm)，并按返回类型处理结果。
   */
  private attachConsole(realm: InspectorRealmSession): void {
    if (realm.console.state === 'unsupported' || this.consoleDisposers.has(realm.descriptor.realmId)) return
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
     * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
     */
    this.consoleDisposers.set(realm.descriptor.realmId, realm.console.backend.subscribe((event) => {
      if (!this.enabled) return
      this.transport.send(this.objects.consoleEvent(realm, event))
    }))
  }

  /**
   * 功能说明：处理 announce 相关流程；使用场景由所在模块及调用位置决定。
   * @param realm （InspectorRealmSession）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 announce(realm)，并按返回类型处理结果。
   */
  private announce(realm: InspectorRealmSession): void {
    if (!this.enabled || realm.context.kind !== 'synthetic' || this.announcedContexts.has(realm.context.id)) return
    this.announcedContexts.add(realm.context.id)
    this.transport.send({
      method: 'Runtime.executionContextCreated',
      params: {
        context: {
          id: realm.context.id,
          uniqueId: realm.context.uniqueId,
          origin: realm.context.origin,
          name: `Client — ${realm.descriptor.label}`,
          auxData: { isDefault: false, type: 'dsh-client', sourceId: realm.descriptor.sourceId },
        },
      },
    })
  }

  /**
   * 功能说明：处理 destroy 相关流程；使用场景由所在模块及调用位置决定。
   * @param realm （InspectorRealmSession）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 destroy(realm)，并按返回类型处理结果。
   */
  private destroy(realm: InspectorRealmSession): void {
    if (realm.context.kind !== 'synthetic' || !this.announcedContexts.delete(realm.context.id)) return
    this.transport.send({
      method: 'Runtime.executionContextDestroyed',
      params: {
        executionContextId: realm.context.id,
        executionContextUniqueId: realm.context.uniqueId,
      },
    })
  }

  /**
   * 功能说明：处理 respond 相关流程；使用场景由所在模块及调用位置决定。
   * @param request （CdpRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @param operation （() => Promise<object>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 respond(request, operation)，并按返回类型处理结果。
   */
  private respond(request: CdpRequest, operation: () => Promise<object>): void {
    respondToCdpRequest(this.transport, request, operation)
  }

  /**
   * 功能说明：处理 sendError 相关流程；使用场景由所在模块及调用位置决定。
   * @param request （CdpRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @param message （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 sendError(request, message)，并按返回类型处理结果。
   */
  private sendError(request: CdpRequest, message: string): void {
    this.transport.send(cdpError(request.id, -32000, message))
  }
}

/**
 * 功能说明：处理 runtimeBackend 相关流程；使用场景由所在模块及调用位置决定。
 * @param realm （InspectorRealmSession）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns RuntimeBackend；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 runtimeBackend(realm)，并按返回类型处理结果。
 */
function runtimeBackend(realm: InspectorRealmSession): RuntimeBackend {
  if (realm.runtime.state === 'unsupported') throw new Error(realm.runtime.reason)
  return realm.runtime.backend
}
