/** Per-DevTools Debugger and source routing across Host and Client realms.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 session 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import { respondToCdpRequest, sendCdpFailure, type CdpRequest, type CdpTransport } from '../../protocol.ts'
import type {
  DebuggerBackend,
  NativeDomainBackend,
  SourceBackend,
} from '../../../../shared/cdp/realm.ts'
import type { RuntimeBackendObjectHandle } from '../../../../shared/cdp/ids.ts'
import type { InspectorRealmSession } from '../../../inspection/realm.ts'
import type { InspectorRealmSessionEvent, InspectorRealmSessionSet } from '../../realm-sessions.ts'
import type {
  RuntimeDebuggerEnableRequest,
  RuntimeDebuggerEvent,
  RuntimeScript,
} from '../../../../shared/cdp/index.ts'
import { exactKeys, optionalBoolean } from '../../../../shared/validation.ts'
import type { RuntimeDomainSession } from '../runtime/index.ts'
import { parseCallFrameEvaluation, requestScriptId } from './cdp-params.ts'
import { debuggerEvent, scriptParsedEvent } from './projector.ts'
import { DebuggerScriptRegistry } from './script-registry.ts'

/** Owns Debugger lifecycle, shared script projection, and Host-native fallback.
 * @remarks 中文说明：类说明：DebuggerDomainSession 用于集中封装 处理 DebuggerDomainSession
 * 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由
 * experimental/inspector 在对应插件或业务生命周期内创建和调用。 */
export class DebuggerDomainSession {
  /**
   * 常量说明：scripts 用于处理 scripts 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly scripts = new DebuggerScriptRegistry()
  /**
   * 常量说明：sourceDisposers 用于处理 sourceDisposers 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly sourceDisposers = new Map<string, () => void>()
  /**
   * 常量说明：debuggerDisposers 用于处理 debuggerDisposers 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly debuggerDisposers = new Map<string, () => void>()
  /**
   * 常量说明：callFrameRealms 用于处理 callFrameRealms 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly callFrameRealms = new Map<string, InspectorRealmSession>()
  /**
   * 常量说明：unsubscribeRealms 用于处理 unsubscribeRealms 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly unsubscribeRealms: () => void
  /**
   * 常量说明：native 用于处理 native 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly native: NativeDomainBackend
  /**
   * 变量说明：debuggerEnableRequest 用于处理 debuggerEnableRequest 相关数据，作用于成员；
   * 其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private debuggerEnableRequest: RuntimeDebuggerEnableRequest = {}
  /**
   * 变量说明：enabled 用于处理 enabled 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private enabled = false
  /**
   * 变量说明：closed 用于处理 closed 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private closed = false

  /**
   * 功能说明：处理 DebuggerDomainSession 相关流程；使用场景由所在模块及调用位置决定。
   * @param transport （CdpTransport）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param realms （InspectorRealmSessionSet）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param runtime （RuntimeDomainSession）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new DebuggerDomainSession(transport, realms, runtime) 创建实例，
   * 并在所属生命周期内使用。
   */
  constructor(
    private readonly transport: CdpTransport,
    private readonly realms: InspectorRealmSessionSet,
    private readonly runtime: RuntimeDomainSession,
  ) {
    /**
     * 常量说明：native 用于处理 native 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：realm（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(realm)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：capability（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(capability)，并按返回类型处理结果。
     */
    const native = realms.all()
      .map(realm => realm.nativeDomains)
      .find(capability => capability.state === 'supported')
    if (native === undefined) throw new Error('Inspector has no native Host debugger transport')
    this.native = native.backend
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
     * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
     */
    this.unsubscribeRealms = realms.subscribe((event) => { this.receiveRealm(event) })
  }

  /**
   * Handle one Debugger request, including Client read-only source operations.
   * @param request - Parsed CDP request.
   * @returns Whether the method belongs to the Debugger domain.
   * @remarks 中文说明：功能说明：处理 handle 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：request（CdpRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；返回值：boolean；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 handle(request)，
   * 并按返回类型处理结果。
   */
  handle(request: CdpRequest): boolean {
    if (!request.method.startsWith('Debugger.')) return false
    switch (request.method) {
      case 'Debugger.enable':
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
         */
        this.respond(request, () => this.enable(request.params))
        return true
      case 'Debugger.disable':
        exactKeys(request.params, [], 'Debugger.disable parameters')
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
         */
        this.respond(request, () => this.disable())
        return true
      case 'Debugger.getScriptSource':
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
         */
        this.respond(request, () => this.getScriptSource(request.params))
        return true
      case 'Debugger.searchInContent':
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
         */
        this.respond(request, () => this.searchInContent(request.params))
        return true
      case 'Debugger.evaluateOnCallFrame':
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
         */
        this.respond(request, () => this.evaluateOnCallFrame(request.params))
        return true
      case 'Debugger.pause':
        exactKeys(request.params, [], 'Debugger.pause parameters')
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
         */
        this.respond(request, () => this.pause())
        return true
      case 'Debugger.resume':
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
         */
        this.respond(request, () => this.resume(request.params))
        return true
      default:
        this.forwardNative(request)
        return true
    }
  }

  /** Release source and debugger subscriptions.
   * @remarks 中文说明：功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 close()，并按返回类型处理结果。 */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.unsubscribeRealms()
    this.detachCapabilities()
    this.callFrameRealms.clear()
    this.scripts.clear()
    this.runtime.releaseProjectedGroup('backtrace')
  }

  /**
   * 功能说明：处理 enable 相关流程；使用场景由所在模块及调用位置决定。
   * @param params （Readonly<Record<string, unknown>>）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @returns Promise<Readonly<Record<string, unknown>>>；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 enable(params)，并按返回类型处理结果。
   */
  private async enable(params: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>> {
    exactKeys(params, ['maxScriptsCacheSize'], 'Debugger.enable parameters')
    if (this.enabled) return {}
    /**
     * 常量说明：maxScriptsCacheSize 用于处理 maxScriptsCacheSize 相关数据，作用于当前作用域；
     * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const maxScriptsCacheSize = params.maxScriptsCacheSize
    if (maxScriptsCacheSize !== undefined
      && (typeof maxScriptsCacheSize !== 'number' || !Number.isFinite(maxScriptsCacheSize) || maxScriptsCacheSize < 0)) {
      throw new Error('Debugger.enable maxScriptsCacheSize must be a non-negative number')
    }
    /**
     * 常量说明：enableRequest 用于处理 enableRequest 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const enableRequest = maxScriptsCacheSize === undefined ? {} : { maxScriptsCacheSize }
    this.debuggerEnableRequest = enableRequest
    this.enabled = true
    /**
     * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      /**
       * 变量说明：realm 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const realm of this.realms.all()) this.attachCapabilities(realm)
      /**
       * 常量说明：results 用于处理 results 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：realm（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(realm)，并按返回类型处理结果。
       */
      const results = await Promise.all(this.realms.all().map(async realm =>
        realm.debugger.state === 'supported' ? realm.debugger.backend.enable(enableRequest) : {}))
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：realm（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(realm)，并按返回类型处理结果。
       */
      await Promise.all(this.realms.all().map(async realm => this.publishCatalog(realm)))
      return mergeResults(results)
    } catch (error) {
      this.enabled = false
      this.debuggerEnableRequest = {}
      this.detachCapabilities()
      this.scripts.clear()
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：realm（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(realm)，并按返回类型处理结果。
       */
      await Promise.allSettled(this.realms.all().map(async (realm) => {
        if (realm.debugger.state === 'supported') await realm.debugger.backend.disable()
      }))
      throw error
    }
  }

  /**
   * 功能说明：处理 disable 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Promise<Readonly<Record<string, unknown>>>；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 disable()，并按返回类型处理结果。
   */
  private async disable(): Promise<Readonly<Record<string, unknown>>> {
    this.enabled = false
    this.debuggerEnableRequest = {}
    this.detachCapabilities()
    this.callFrameRealms.clear()
    this.scripts.clear()
    this.runtime.releaseProjectedGroup('backtrace')
    /**
     * 常量说明：results 用于处理 results 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：realm（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(realm)，并按返回类型处理结果。
     */
    const results = await Promise.all(this.realms.all().map(async realm =>
      realm.debugger.state === 'supported' ? realm.debugger.backend.disable() : {}))
    return mergeResults(results)
  }

  /**
   * 功能说明：获取 Script Source 相关流程；使用场景由所在模块及调用位置决定。
   * @param params （Readonly<Record<string, unknown>>）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @returns Promise<object>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 getScriptSource(params)，并按返回类型处理结果。
   */
  private async getScriptSource(params: Readonly<Record<string, unknown>>): Promise<object> {
    exactKeys(params, ['scriptId'], 'Debugger.getScriptSource parameters')
    if (typeof params.scriptId !== 'string') throw new Error('Debugger.getScriptSource requires scriptId')
    /**
     * 常量说明：route 用于处理 route 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const route = this.scripts.resolve(params.scriptId)
    if (route !== undefined) return { scriptSource: await route.source.getScriptSource(route.script.scriptKey) }
    if (this.scripts.wasUnsupported(params.scriptId) || params.scriptId.startsWith('client:')) {
      throw new Error('Client script is no longer available')
    }
    return this.native.request('Debugger.getScriptSource', params)
  }

  /**
   * 功能说明：处理 searchInContent 相关流程；使用场景由所在模块及调用位置决定。
   * @param params （Readonly<Record<string, unknown>>）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @returns Promise<object>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 searchInContent(params)，并按返回类型处理结果。
   */
  private async searchInContent(params: Readonly<Record<string, unknown>>): Promise<object> {
    exactKeys(params, ['scriptId', 'query', 'caseSensitive', 'isRegex'], 'Debugger.searchInContent parameters')
    if (typeof params.scriptId !== 'string' || typeof params.query !== 'string') {
      throw new Error('Debugger.searchInContent requires scriptId and query')
    }
    if (params.caseSensitive !== undefined && typeof params.caseSensitive !== 'boolean') {
      throw new Error('Debugger.searchInContent caseSensitive must be a boolean')
    }
    if (params.isRegex !== undefined && typeof params.isRegex !== 'boolean') {
      throw new Error('Debugger.searchInContent isRegex must be a boolean')
    }
    /**
     * 常量说明：route 用于处理 route 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const route = this.scripts.resolve(params.scriptId)
    if (route === undefined) {
      if (this.scripts.wasUnsupported(params.scriptId) || params.scriptId.startsWith('client:')) {
        throw new Error('Client script is no longer available')
      }
      return this.native.request('Debugger.searchInContent', params)
    }
    /**
     * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const source = await route.source.getScriptSource(route.script.scriptKey)
    return {
      result: searchLines(
        source,
        params.query,
        params.caseSensitive === true,
        params.isRegex === true,
      ),
    }
  }

  /**
   * 功能说明：处理 evaluateOnCallFrame 相关流程；使用场景由所在模块及调用位置决定。
   * @param params （Readonly<Record<string, unknown>>）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @returns Promise<object>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 evaluateOnCallFrame(params)，并按返回类型处理结果。
   */
  private async evaluateOnCallFrame(params: Readonly<Record<string, unknown>>): Promise<object> {
    /**
     * 常量说明：parsed 用于处理 parsed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const parsed = parseCallFrameEvaluation(params)
    if (parsed.callFrameId.startsWith('client:')) throw new Error('Client native debugging is unavailable')
    /**
     * 常量说明：realm 用于处理 realm 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const realm = this.callFrameRealms.get(parsed.callFrameId) ?? this.supportedDebugger()
    /**
     * 常量说明：objectGroup 用于处理 objectGroup 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const objectGroup = parsed.objectGroup ?? 'backtrace'
    /**
     * 常量说明：completion 用于处理 completion 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const completion = await debuggerBackend(realm).evaluateOnCallFrame({ ...parsed, objectGroup })
    return this.runtime.projectCompletion(realm, completion, objectGroup)
  }

  /**
   * 功能说明：处理 pause 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Promise<object>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 pause()，并按返回类型处理结果。
   */
  private async pause(): Promise<object> {
    /**
     * 常量说明：supported 用于处理 supported 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：realm（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(realm)，并按返回类型处理结果。
     */
    const supported = this.realms.all().filter(realm => realm.debugger.state === 'supported')
    if (supported.length === 0) throw new Error('Debugger.pause is unsupported by every active realm')
    /**
     * 常量说明：results 用于处理 results 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：realm（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(realm)，并按返回类型处理结果。
     */
    const results = await Promise.all(supported.map(async realm => debuggerBackend(realm).pause()))
    return mergeResults(results)
  }

  /**
   * 功能说明：处理 resume 相关流程；使用场景由所在模块及调用位置决定。
   * @param params （Readonly<Record<string, unknown>>）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @returns Promise<object>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 resume(params)，并按返回类型处理结果。
   */
  private async resume(params: Readonly<Record<string, unknown>>): Promise<object> {
    exactKeys(params, ['terminateOnResume'], 'Debugger.resume parameters')
    /**
     * 常量说明：request 用于处理 request 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const request = optionalBoolean(params, 'terminateOnResume')
    /**
     * 常量说明：supported 用于处理 supported 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：realm（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(realm)，并按返回类型处理结果。
     */
    const supported = this.realms.all().filter(realm => realm.debugger.state === 'supported')
    if (supported.length === 0) throw new Error('Debugger.resume is unsupported by every active realm')
    /**
     * 常量说明：results 用于处理 results 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：realm（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(realm)，并按返回类型处理结果。
     */
    const results = await Promise.all(supported.map(async realm => debuggerBackend(realm).resume(request)))
    return mergeResults(results)
  }

  /**
   * 功能说明：处理 forwardNative 相关流程；使用场景由所在模块及调用位置决定。
   * @param request （CdpRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 forwardNative(request)，并按返回类型处理结果。
   */
  private forwardNative(request: CdpRequest): void {
    /**
     * 变量说明：params 用于处理 params 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let params: Readonly<Record<string, unknown>>
    /**
     * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      /**
       * 常量说明：unsupported 用于处理 unsupported 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const unsupported = this.unsupportedRoute(request.params)
      if (unsupported !== undefined) throw new Error(unsupported)
      params = this.runtime.nativeParameters(request.params)
    } catch (error) {
      sendCdpFailure(this.transport, request, error)
      return
    }
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    respondToCdpRequest(this.transport, request, async () => this.native.request(request.method, params))
  }

  /**
   * 功能说明：处理 unsupportedRoute 相关流程；使用场景由所在模块及调用位置决定。
   * @param params （Readonly<Record<string, unknown>>）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @returns string | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 unsupportedRoute(params)，并按返回类型处理结果。
   */
  private unsupportedRoute(params: Readonly<Record<string, unknown>>): string | undefined {
    /**
     * 常量说明：scriptId 用于处理 scriptId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const scriptId = requestScriptId(params)
    if (scriptId !== undefined) {
      /**
       * 常量说明：route 用于处理 route 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const route = this.scripts.resolve(scriptId)
      if (route?.realm.debugger.state === 'unsupported') return route.realm.debugger.reason
      if (route === undefined && this.scripts.wasUnsupported(scriptId)) return 'Client script is no longer available'
    }
    if (typeof params.url === 'string') {
      /**
       * 常量说明：route 用于处理 route 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const route = this.scripts.byUrl(params.url)
      if (route?.realm.debugger.state === 'unsupported') return route.realm.debugger.reason
    }
    if (typeof params.urlRegex === 'string') {
      /**
       * 常量说明：route 用于处理 route 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const route = this.scripts.byUrlPattern(params.urlRegex)
      if (route?.realm.debugger.state === 'unsupported') return route.realm.debugger.reason
    }
    if (typeof params.scriptHash === 'string') {
      /**
       * 常量说明：route 用于处理 route 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const route = this.scripts.byHash(params.scriptHash)
      if (route?.realm.debugger.state === 'unsupported') return route.realm.debugger.reason
    }
    if (typeof params.objectId === 'string') {
      /**
       * 常量说明：route 用于处理 route 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const route = this.runtime.objectRoute(params.objectId)
      if (route?.realm.debugger.state === 'unsupported') return route.realm.debugger.reason
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
      /**
      * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（unknown）：提供本次调用所需的数据；
      * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
      * 典型用法：在完成前置校验后调用 匿名回调(error)，并按返回类型处理结果。
      */
      if (this.enabled) void this.enableRealm(event.session).catch((error: unknown) => {
        console.error(`Inspector could not enable Debugger realm ${event.session.descriptor.label}:`, error)
      })
      return
    }
    this.sourceDisposers.get(event.session.descriptor.realmId)?.()
    this.sourceDisposers.delete(event.session.descriptor.realmId)
    this.debuggerDisposers.get(event.session.descriptor.realmId)?.()
    this.debuggerDisposers.delete(event.session.descriptor.realmId)
    /**
     * 变量说明：callFrameId、realm 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const [callFrameId, realm] of this.callFrameRealms) {
      if (realm === event.session) this.callFrameRealms.delete(callFrameId)
    }
    this.scripts.removeRealm(event.session)
  }

  /**
   * 功能说明：处理 enableRealm 相关流程；使用场景由所在模块及调用位置决定。
   * @param realm （InspectorRealmSession）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 enableRealm(realm)，并按返回类型处理结果。
   */
  private async enableRealm(realm: InspectorRealmSession): Promise<void> {
    this.attachCapabilities(realm)
    if (realm.debugger.state === 'supported') await realm.debugger.backend.enable(this.debuggerEnableRequest)
    await this.publishCatalog(realm)
  }

  /**
   * 功能说明：处理 attachCapabilities 相关流程；使用场景由所在模块及调用位置决定。
   * @param realm （InspectorRealmSession）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 attachCapabilities(realm)，并按返回类型处理结果。
   */
  private attachCapabilities(realm: InspectorRealmSession): void {
    if (realm.sources.state === 'supported' && !this.sourceDisposers.has(realm.descriptor.realmId)) {
      /**
       * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const source = realm.sources.backend
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：script（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(script)，并按返回类型处理结果。
       */
      this.sourceDisposers.set(realm.descriptor.realmId, source.subscribe((script) => {
        if (this.enabled) this.publishScript(realm, source, script)
      }))
    }
    if (realm.debugger.state === 'supported' && !this.debuggerDisposers.has(realm.descriptor.realmId)) {
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
       * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
       */
      this.debuggerDisposers.set(realm.descriptor.realmId, realm.debugger.backend.subscribe((event) => {
        if (this.enabled) this.publishDebuggerEvent(realm, event)
      }))
    }
  }

  /**
   * 功能说明：处理 publishCatalog 相关流程；使用场景由所在模块及调用位置决定。
   * @param realm （InspectorRealmSession）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 publishCatalog(realm)，并按返回类型处理结果。
   */
  private async publishCatalog(realm: InspectorRealmSession): Promise<void> {
    if (!this.enabled || realm.sources.state === 'unsupported') return
    /**
     * 常量说明：scripts 用于处理 scripts 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const scripts = await realm.sources.backend.listScripts()
    /**
     * 变量说明：script 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const script of scripts) this.publishScript(realm, realm.sources.backend, script)
  }

  /**
   * 功能说明：处理 publishScript 相关流程；使用场景由所在模块及调用位置决定。
   * @param realm （InspectorRealmSession）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param source （SourceBackend）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param script （RuntimeScript）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 publishScript(realm, source, script)，并按返回类型处理结果。
   */
  private publishScript(realm: InspectorRealmSession, source: SourceBackend, script: RuntimeScript): void {
    /**
     * 常量说明：registered 用于处理 registered 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const registered = this.scripts.register({ realm, source, script })
    if (registered.fresh) this.transport.send(scriptParsedEvent(realm, script))
  }

  /**
   * 功能说明：处理 publishDebuggerEvent 相关流程；使用场景由所在模块及调用位置决定。
   * @param realm （InspectorRealmSession）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param event （RuntimeDebuggerEvent<RuntimeBackendObjectHandle>）：提供需要处理或投
   * 影的事件数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 publishDebuggerEvent(realm, event)，并按返回类型处理结果。
   */
  private publishDebuggerEvent(
    realm: InspectorRealmSession,
    event: RuntimeDebuggerEvent<RuntimeBackendObjectHandle>,
  ): void {
    if (event.type === 'paused') {
      /**
       * 变量说明：frame 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const frame of event.callFrames) this.callFrameRealms.set(frame.callFrameId, realm)
    } else if (event.type === 'resumed') {
      /**
       * 变量说明：callFrameId、owner 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const [callFrameId, owner] of this.callFrameRealms) {
        if (owner === realm) this.callFrameRealms.delete(callFrameId)
      }
      this.runtime.releaseProjectedGroup('backtrace')
    }
    this.transport.send(debuggerEvent(realm, event, this.runtime))
  }

  /**
   * 功能说明：处理 supportedDebugger 相关流程；使用场景由所在模块及调用位置决定。
   * @returns InspectorRealmSession；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 supportedDebugger()，并按返回类型处理结果。
   */
  private supportedDebugger(): InspectorRealmSession {
    /**
     * 常量说明：realm 用于处理 realm 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：candidate（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(candidate)，并按返回类型处理结果。
     */
    const realm = this.realms.all().find(candidate => candidate.debugger.state === 'supported')
    if (realm === undefined) throw new Error('No active realm supports call-frame evaluation')
    return realm
  }

  /**
   * 功能说明：处理 detachCapabilities 相关流程；使用场景由所在模块及调用位置决定。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 detachCapabilities()，并按返回类型处理结果。
   */
  private detachCapabilities(): void {
    /**
     * 变量说明：dispose 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const dispose of this.sourceDisposers.values()) dispose()
    this.sourceDisposers.clear()
    /**
     * 变量说明：dispose 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const dispose of this.debuggerDisposers.values()) dispose()
    this.debuggerDisposers.clear()
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
}

/**
 * 功能说明：处理 debuggerBackend 相关流程；使用场景由所在模块及调用位置决定。
 * @param realm （InspectorRealmSession）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns DebuggerBackend；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 debuggerBackend(realm)，并按返回类型处理结果。
 */
function debuggerBackend(realm: InspectorRealmSession): DebuggerBackend {
  if (realm.debugger.state === 'unsupported') throw new Error(realm.debugger.reason)
  return realm.debugger.backend
}

/**
 * 功能说明：处理 mergeResults 相关流程；使用场景由所在模块及调用位置决定。
 * @param results （readonly Readonly<Record<string,
 * unknown>>[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Readonly<Record<string, unknown>>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 mergeResults(results)，并按返回类型处理结果。
 */
function mergeResults(results: readonly Readonly<Record<string, unknown>>[]): Readonly<Record<string, unknown>> {
  /**
   * 常量说明：merged 用于处理 merged 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const merged: Record<string, unknown> = {}
  /**
   * 变量说明：result 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const result of results) Object.assign(merged, result)
  return merged
}

/**
 * 功能说明：处理 searchLines 相关流程；使用场景由所在模块及调用位置决定。
 * @param source （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param query （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param caseSensitive （boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param isRegex （boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns ReadonlyArray<{ readonly lineNumber: number; readonly
 * lineContent: st…；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 searchLines(source, query, caseSensitive, isRegex)，
 * 并按返回类型处理结果。
 */
function searchLines(
  source: string,
  query: string,
  caseSensitive: boolean,
  isRegex: boolean,
): ReadonlyArray<{ readonly lineNumber: number; readonly lineContent: string }> {
  /**
   * 常量说明：expression 用于处理 expression 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const expression = isRegex
    ? new RegExp(query, caseSensitive ? 'u' : 'iu')
    : undefined
  /**
   * 常量说明：expected 用于处理 expected 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const expected = caseSensitive ? query : query.toLowerCase()
  /**
   * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const result: Array<{ readonly lineNumber: number; readonly lineContent: string }> = []
  /**
   * 变量说明：lineNumber、lineContent 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const [lineNumber, lineContent] of source.split('\n').entries()) {
    /**
     * 常量说明：matches 用于处理 matches 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const matches = expression?.test(lineContent)
      ?? (caseSensitive ? lineContent : lineContent.toLowerCase()).includes(expected)
    if (matches) result.push({ lineNumber, lineContent })
  }
  return result
}
