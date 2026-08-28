/** Worker-owned registry of Host and Client realm definitions.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 realm store 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { ClientRuntimeRouter, ClientRuntimeTargetEvent } from '../bridge/runtime-rpc.ts'
import type { ClientSourceRouter } from '../bridge/source-rpc.ts'
import type { InspectorSourceDescriptor } from '../../shared/bridge/messages/observation.ts'
import { ClientInspectorRealm } from '../realms/client/index.ts'
import type { InspectorRealm } from './realm.ts'

/** Realm admission and removal observed by each DevTools connection. */
export type InspectorRealmEvent =
  | { readonly type: 'opened'; readonly realm: InspectorRealm }
  | { readonly type: 'closed'; readonly realm: InspectorRealm }

/** Authoritative collection of all currently executable realms.
 * @remarks 中文说明：类说明：InspectorRealmRegistry 用于集中封装 处理
 * InspectorRealmRegistry 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；
 * 使用场景：由 experimental/inspector 在对应插件或业务生命周期内创建和调用。 */
export class InspectorRealmRegistry {
  /**
   * 常量说明：clientsBySource 用于处理 clientsBySource 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly clientsBySource = new Map<string, ClientInspectorRealm>()
  /**
   * 常量说明：listeners 用于处理 listeners 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly listeners = new Set<(event: InspectorRealmEvent) => void>()
  /**
   * 常量说明：unsubscribeClients 用于处理 unsubscribeClients 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly unsubscribeClients: () => void

  /**
   * 功能说明：处理 InspectorRealmRegistry 相关流程；使用场景由所在模块及调用位置决定。
   * @param host （InspectorRealm）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param clients （ClientRuntimeRouter）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param clientSources （ClientSourceRouter）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new InspectorRealmRegistry(host, clients, clientSources)
   * 创建实例，并在所属生命周期内使用。
   */
  constructor(
    readonly host: InspectorRealm,
    private readonly clients: ClientRuntimeRouter,
    private readonly clientSources: ClientSourceRouter,
  ) {
    /**
     * 变量说明：target 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const target of clients.targets()) this.openClient(target)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
     * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
     */
    this.unsubscribeClients = clients.subscribe((event) => { this.receiveClient(event) })
  }

  /**
   * Return the realm admission order used by every connection-local session set.
   * @returns Host followed by active Clients.
   * @remarks 中文说明：功能说明：处理 realms 相关流程；使用场景由所在模块及调用位置决定。；返回值：InspectorRealm[]；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 realms()，并按返回类型处理结果。
   */
  realms(): InspectorRealm[] {
    return [this.host, ...this.clientsBySource.values()]
  }

  /**
   * Resolve one synthetic Client execution context.
   * @param contextId - Numeric CDP execution-context id.
   * @returns The active realm when the id belongs to a Client.
   * @remarks 中文说明：功能说明：处理 byContextId 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：contextId（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：InspectorRealm
   * | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * byContextId(contextId)，并按返回类型处理结果。
   */
  byContextId(contextId: number): InspectorRealm | undefined {
    /**
     * 变量说明：realm 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const realm of this.clientsBySource.values()) {
      if (realm.context.kind === 'synthetic' && realm.context.id === contextId) return realm
    }
    return undefined
  }

  /**
   * Resolve one globally unique Client execution context.
   * @param uniqueId - CDP unique execution-context id.
   * @returns The active realm when the id belongs to a Client.
   * @remarks 中文说明：功能说明：处理 byUniqueContextId 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：uniqueId（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：InspectorRealm |
   * undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * byUniqueContextId(uniqueId)，并按返回类型处理结果。
   */
  byUniqueContextId(uniqueId: string): InspectorRealm | undefined {
    /**
     * 变量说明：realm 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const realm of this.clientsBySource.values()) {
      if (realm.context.kind === 'synthetic' && realm.context.uniqueId === uniqueId) return realm
    }
    return undefined
  }

  /**
   * Resolve the realm for one active source generation.
   * @param source - Source identity retained by a Cordis tree node.
   * @returns The matching active realm.
   * @remarks 中文说明：功能说明：处理 bySource 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：source（InspectorSourceDescriptor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：InspectorRealm | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 bySource(source)，并按返回类型处理结果。
   */
  bySource(source: InspectorSourceDescriptor): InspectorRealm | undefined {
    if (source.kind === 'host') return this.host
    /**
     * 常量说明：realm 用于处理 realm 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const realm = this.clientsBySource.get(source.sourceId)
    return realm?.descriptor.generation === source.generation ? realm : undefined
  }

  /**
   * Subscribe to Client realm admission and removal.
   * @param listener - Registry observer.
   * @returns A disposer removing the observer.
   * @remarks 中文说明：功能说明：处理 subscribe 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：listener（(event: InspectorRealmEvent) => void）：接收后续状态或事件并执行调用方逻辑；
   * 必须满足声明的类型及调用时序要求。；返回值：() => void；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 subscribe(listener)，并按返回类型处理结果。
   */
  subscribe(listener: (event: InspectorRealmEvent) => void): () => void {
    this.listeners.add(listener)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    return () => { this.listeners.delete(listener) }
  }

  /** Stop observing Client targets and clear registry listeners.
   * @remarks 中文说明：功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 close()，并按返回类型处理结果。 */
  close(): void {
    this.unsubscribeClients()
    this.clientsBySource.clear()
    this.listeners.clear()
  }

  /**
   * 功能说明：处理 receiveClient 相关流程；使用场景由所在模块及调用位置决定。
   * @param event （ClientRuntimeTargetEvent）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 receiveClient(event)，并按返回类型处理结果。
   */
  private receiveClient(event: ClientRuntimeTargetEvent): void {
    if (event.type === 'opened') {
      /**
       * 常量说明：realm 用于处理 realm 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const realm = this.openClient(event.target)
      this.emit({ type: 'opened', realm })
      return
    }
    /**
     * 常量说明：realm 用于处理 realm 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const realm = this.clientsBySource.get(event.target.source.sourceId)
    if (realm === undefined || realm.target !== event.target) return
    this.clientsBySource.delete(event.target.source.sourceId)
    this.emit({ type: 'closed', realm })
  }

  /**
   * 功能说明：打开 Client 相关流程；使用场景由所在模块及调用位置决定。
   * @param target （ClientRuntimeTargetEvent['target']）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @returns ClientInspectorRealm；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 openClient(target)，并按返回类型处理结果。
   */
  private openClient(target: ClientRuntimeTargetEvent['target']): ClientInspectorRealm {
    /**
     * 常量说明：realm 用于处理 realm 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const realm = new ClientInspectorRealm(target, this.clients, this.clientSources)
    this.clientsBySource.set(target.source.sourceId, realm)
    return realm
  }

  /**
   * 功能说明：发送 emit 相关流程；使用场景由所在模块及调用位置决定。
   * @param event （InspectorRealmEvent）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 emit(event)，并按返回类型处理结果。
   */
  private emit(event: InspectorRealmEvent): void {
    /**
     * 变量说明：listener 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const listener of [...this.listeners]) {
      try {
        listener(event)
      } catch {
        // One DevTools connection cannot disrupt realm delivery to sibling connections.
      }
    }
  }
}
