/** One DevTools connection: explicit local-domain routing plus a private Host V8 session.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 session 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import { cdpError, parseCdpRequest, type CdpTransport } from './protocol.ts'
import { NetworkDomain, type NetworkSink } from './domains/network/session.ts'
import { CDP_METHOD_NOT_HANDLED, handleScaffold, type CdpTargetDescriptor } from './target.ts'
import { RuntimeDomainSession } from './domains/runtime/index.ts'
import { DebuggerDomainSession } from './domains/debugger/index.ts'
import { CordisDomSession, type CordisDomBackend } from './domains/dom/index.ts'
import type { InspectorSourceRegistry } from '../bridge/hub.ts'
import { HostNativeDomainSession } from './domains/native.ts'
import { InspectorRealmSessionSet } from './realm-sessions.ts'
import type { InspectorRealmRegistry } from '../inspection/realm-store.ts'
import type { CordisRuntimeTreeReader } from '../../shared/cordis/reader.ts'

/** Per-connection CDP dispatcher.
 * @remarks 中文说明：类说明：CdpSession 用于集中封装 处理 CdpSession 相关状态与行为。；
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由 experimental/inspector
 * 在对应插件或业务生命周期内创建和调用。 */
export class CdpSession implements NetworkSink {
  /**
   * 常量说明：realms 用于处理 realms 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly realms: InspectorRealmSessionSet
  /**
   * 常量说明：nativeDomains 用于处理 nativeDomains 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly nativeDomains: HostNativeDomainSession
  /**
   * 常量说明：runtime 用于处理 runtime 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly runtime: RuntimeDomainSession
  /**
   * 常量说明：debugger 用于处理 debugger 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly debugger: DebuggerDomainSession
  /**
   * 常量说明：dom 用于处理 dom 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly dom: CordisDomSession
  /**
   * 变量说明：diagnosticsEnabled 用于处理 diagnosticsEnabled 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private diagnosticsEnabled = false
  /**
   * 常量说明：unsubscribeSources 用于处理 unsubscribeSources 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly unsubscribeSources: () => void

  /**
   * 功能说明：处理 CdpSession 相关流程；使用场景由所在模块及调用位置决定。
   * @param transport （CdpTransport）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param target （CdpTargetDescriptor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param sources （InspectorSourceRegistry）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param network （NetworkDomain）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param realmRegistry （InspectorRealmRegistry）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @param domBackend （CordisDomBackend）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param cordisTrees （CordisRuntimeTreeReader）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new CdpSession(transport, target, sources, network,
   * realmRegistry, domBackend, cordisTrees) 创建实例，并在所属生命周期内使用。
   */
  constructor(
    private readonly transport: CdpTransport,
    private readonly target: CdpTargetDescriptor,
    private readonly sources: InspectorSourceRegistry,
    private readonly network: NetworkDomain,
    realmRegistry: InspectorRealmRegistry,
    domBackend: CordisDomBackend,
    private readonly cordisTrees: CordisRuntimeTreeReader,
  ) {
    this.realms = new InspectorRealmSessionSet(realmRegistry)
    /**
     * 常量说明：native 用于处理 native 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const native = this.realms.host().nativeDomains
    if (native.state === 'unsupported') throw new Error(native.reason)
    this.nativeDomains = new HostNativeDomainSession(transport, native.backend)
    this.runtime = new RuntimeDomainSession(transport, this.realms)
    this.debugger = new DebuggerDomainSession(transport, this.realms, this.runtime)
    this.dom = new CordisDomSession(transport, domBackend, this.runtime)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：objectId（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：realm（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：reference（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：group（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(objectId, realm,
     * reference, group)，并按返回类型处理结果。
     */
    this.runtime.setObjectObserver((objectId, realm, reference, group) =>
      this.dom.bindObject(objectId, realm, reference, group))
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    this.unsubscribeSources = sources.subscribeStatus(() => {
      if (this.diagnosticsEnabled) this.sendEvent('DSHInspector.sourcesChanged', { sources: this.sources.describe() })
    })
  }

  /**
   * Parse and dispatch one raw CDP request. Invalid frames close this client only.
   * @param value - Untrusted decoded WebSocket payload.
   * @remarks 中文说明：功能说明：处理 receive 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 receive(value)，并按返回类型处理结果。
   */
  receive(value: unknown): void {
    /**
     * 变量说明：request 用于处理 request 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let request
    try {
      request = parseCdpRequest(value)
    } catch {
      this.transport.close()
      return
    }
    /**
     * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      if (request.method === 'Runtime.releaseObject') this.dom.releaseObject(request.params.objectId)
      if (request.method === 'Runtime.releaseObjectGroup') this.dom.releaseObjectGroup(request.params.objectGroup)
      if (this.dom.handle(request)) return
      if (this.runtime.handle(request)) return
      if (this.debugger.handle(request)) return
      if (this.nativeDomains.owns(request.method)) {
        this.nativeDomains.handle({ ...request, params: this.runtime.nativeParameters(request.params) })
        return
      }
      /**
       * 变量说明：result 用于处理 result 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
       */
      let result: unknown
      if (request.method.startsWith('Network.')) {
        result = this.network.handle(request.method, request.params, this)
      } else if (request.method === 'DSHInspector.enable') {
        this.diagnosticsEnabled = true
        result = { sources: this.sources.describe() }
      } else if (request.method === 'DSHInspector.disable') {
        this.diagnosticsEnabled = false
        result = {}
      } else if (request.method === 'DSHInspector.getSources') {
        result = { sources: this.sources.describe() }
      } else if (request.method === 'DSHInspector.getCordisTree') {
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：tree（由 TypeScript
         * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(tree)，并按返回类型处理结果。
         */
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（unknown）：提供本次调用所需的数据；
         * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
         * 典型用法：在完成前置校验后调用 匿名回调(error)，并按返回类型处理结果。
         */
        void this.cordisTrees.getTree().then(
          (tree) => { this.transport.send({ id: request.id, result: { tree } }) },
          (error: unknown) => {
            this.transport.send(cdpError(request.id, -32000, error instanceof Error ? error.message : String(error)))
          },
        )
        return
      } else {
        result = handleScaffold(request, this.target)
        if (result === CDP_METHOD_NOT_HANDLED) {
          this.transport.send(cdpError(request.id, -32601, `Method not found: ${request.method}`))
          return
        }
      }
      this.transport.send({ id: request.id, result })
    } catch (error) {
      this.transport.send(cdpError(request.id, -32000, error instanceof Error ? error.message : String(error)))
    }
  }

  /** Push one CDP event.
   * @remarks 中文说明：功能说明：处理 sendEvent 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：method（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：params（Readonly<Record<string, unknown>>）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 sendEvent(method, params)，并按返回类型处理结果。 */
  sendEvent(method: string, params: Readonly<Record<string, unknown>>): void {
    this.transport.send({ method, params })
  }

  /** Release every connection-owned V8 and domain resource.
   * @remarks 中文说明：功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 close()，并按返回类型处理结果。 */
  close(): void {
    this.unsubscribeSources()
    this.network.detach(this)
    this.dom.close()
    this.runtime.close()
    this.debugger.close()
    this.nativeDomains.close()
    this.realms.close()
  }
}
