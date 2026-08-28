/** Per-DevTools-connection sessions opened from the shared realm registry.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 realm sessions 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import { randomUUID } from 'node:crypto'
import { inspectorId } from '../../shared/identity.ts'
import type { InspectorRealmId } from '../../shared/cdp/ids.ts'
import type { InspectorSourceDescriptor } from '../../shared/bridge/messages/observation.ts'
import type { InspectorRealmEvent, InspectorRealmRegistry } from '../inspection/realm-store.ts'
import type { InspectorRealm, InspectorRealmSession } from '../inspection/realm.ts'
import type { InspectorConnectionId } from './ids.ts'

/** Realm-session lifecycle observed by connection-local CDP domains. */
export type InspectorRealmSessionEvent =
  | { readonly type: 'opened'; readonly session: InspectorRealmSession }
  | { readonly type: 'closed'; readonly session: InspectorRealmSession }

/** Owns exactly one backend session per active realm for one DevTools connection.
 * @remarks 中文说明：类说明：InspectorRealmSessionSet 用于集中封装 处理
 * InspectorRealmSessionSet 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；
 * 使用场景：由 experimental/inspector 在对应插件或业务生命周期内创建和调用。 */
export class InspectorRealmSessionSet {
  /** Opaque identity shared by every domain and object table on this DevTools connection.
   * @remarks 中文说明：常量说明：connectionId 用于处理 connectionId 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。 */
  readonly connectionId: InspectorConnectionId = inspectorId<'InspectorConnectionId'>(randomUUID(), 'connectionId')
  /**
   * 常量说明：sessions 用于处理 sessions 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly sessions = new Map<InspectorRealmId, InspectorRealmSession>()
  /**
   * 常量说明：listeners 用于处理 listeners 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly listeners = new Set<(event: InspectorRealmSessionEvent) => void>()
  /**
   * 常量说明：unsubscribeRealms 用于处理 unsubscribeRealms 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly unsubscribeRealms: () => void
  /**
   * 变量说明：closed 用于处理 closed 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private closed = false

  /**
   * 功能说明：处理 InspectorRealmSessionSet 相关流程；使用场景由所在模块及调用位置决定。
   * @param realms （InspectorRealmRegistry）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new InspectorRealmSessionSet(realms) 创建实例，并在所属生命周期内使用。
   */
  constructor(private readonly realms: InspectorRealmRegistry) {
    /**
     * 变量说明：realm 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const realm of realms.realms()) this.open(realm)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
     * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
     */
    this.unsubscribeRealms = realms.subscribe((event) => { this.receiveRealm(event) })
  }

  /**
   * Return active sessions in the registry's deterministic order.
   * @returns Host followed by connected Clients.
   * @remarks 中文说明：功能说明：处理 all 相关流程；使用场景由所在模块及调用位置决定。；
   * 返回值：InspectorRealmSession[]；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 all()，并按返回类型处理结果。
   */
  all(): InspectorRealmSession[] {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：realm（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(realm)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：session（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：session is
     * InspectorRealmSession；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用
     * 匿名回调(session)，并按返回类型处理结果。
     */
    return this.realms.realms()
      .map(realm => this.sessions.get(realm.descriptor.realmId))
      .filter((session): session is InspectorRealmSession => session !== undefined)
  }

  /**
   * Return the required Host session.
   * @returns The connection-local Host realm session.
   * @remarks 中文说明：功能说明：处理 host 相关流程；使用场景由所在模块及调用位置决定。；
   * 返回值：InspectorRealmSession；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * host()，并按返回类型处理结果。
   */
  host(): InspectorRealmSession {
    /**
     * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const session = this.sessions.get(this.realms.host.descriptor.realmId)
    if (session === undefined) throw new Error('Host Inspector realm session is unavailable')
    return session
  }

  /**
   * Resolve one synthetic Client context.
   * @param contextId - Numeric CDP execution-context id.
   * @returns Its realm session when currently connected.
   * @remarks 中文说明：功能说明：处理 byContextId 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：contextId（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：InspectorRealmSession | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 byContextId(contextId)，并按返回类型处理结果。
   */
  byContextId(contextId: number): InspectorRealmSession | undefined {
    /**
     * 常量说明：realm 用于处理 realm 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const realm = this.realms.byContextId(contextId)
    return realm === undefined ? undefined : this.sessions.get(realm.descriptor.realmId)
  }

  /**
   * Resolve one globally unique Client context.
   * @param uniqueId - CDP unique execution-context id.
   * @returns Its realm session when currently connected.
   * @remarks 中文说明：功能说明：处理 byUniqueContextId 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：uniqueId（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：InspectorRealmSession | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 byUniqueContextId(uniqueId)，并按返回类型处理结果。
   */
  byUniqueContextId(uniqueId: string): InspectorRealmSession | undefined {
    /**
     * 常量说明：realm 用于处理 realm 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const realm = this.realms.byUniqueContextId(uniqueId)
    return realm === undefined ? undefined : this.sessions.get(realm.descriptor.realmId)
  }

  /**
   * Resolve one active source generation to this connection's realm session.
   * @param source - Source identity retained by a Cordis tree node.
   * @returns The matching realm session.
   * @remarks 中文说明：功能说明：处理 bySource 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：source（InspectorSourceDescriptor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：InspectorRealmSession | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 bySource(source)，并按返回类型处理结果。
   */
  bySource(source: InspectorSourceDescriptor): InspectorRealmSession | undefined {
    /**
     * 常量说明：realm 用于处理 realm 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const realm = this.realms.bySource(source)
    return realm === undefined ? undefined : this.sessions.get(realm.descriptor.realmId)
  }

  /**
   * Subscribe to connection-local realm session lifecycle.
   * @param listener - Session observer.
   * @returns A disposer removing the observer.
   * @remarks 中文说明：功能说明：处理 subscribe 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：listener（(event: InspectorRealmSessionEvent) =>
   * void）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。；返回值：() => void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 subscribe(listener)，并按返回类型处理结果。
   */
  subscribe(listener: (event: InspectorRealmSessionEvent) => void): () => void {
    this.listeners.add(listener)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    return () => { this.listeners.delete(listener) }
  }

  /** Close all realm sessions and stop tracking the registry.
   * @remarks 中文说明：功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 close()，并按返回类型处理结果。 */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.unsubscribeRealms()
    /**
     * 变量说明：session 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const session of this.sessions.values()) session.close()
    this.sessions.clear()
    this.listeners.clear()
  }

  /**
   * 功能说明：处理 receiveRealm 相关流程；使用场景由所在模块及调用位置决定。
   * @param event （InspectorRealmEvent）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 receiveRealm(event)，并按返回类型处理结果。
   */
  private receiveRealm(event: InspectorRealmEvent): void {
    if (event.type === 'opened') {
      /**
       * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const session = this.open(event.realm)
      this.emit({ type: 'opened', session })
      return
    }
    /**
     * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const session = this.sessions.get(event.realm.descriptor.realmId)
    if (session === undefined) return
    this.sessions.delete(event.realm.descriptor.realmId)
    session.close()
    this.emit({ type: 'closed', session })
  }

  /**
   * 功能说明：打开 open 相关流程；使用场景由所在模块及调用位置决定。
   * @param realm （InspectorRealm）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns InspectorRealmSession；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 open(realm)，并按返回类型处理结果。
   */
  private open(realm: InspectorRealm): InspectorRealmSession {
    /**
     * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const session = realm.openSession()
    this.sessions.set(realm.descriptor.realmId, session)
    return session
  }

  /**
   * 功能说明：发送 emit 相关流程；使用场景由所在模块及调用位置决定。
   * @param event （InspectorRealmSessionEvent）：提供需要处理或投影的事件数据；
   * 必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 emit(event)，并按返回类型处理结果。
   */
  private emit(event: InspectorRealmSessionEvent): void {
    /**
     * 变量说明：listener 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const listener of [...this.listeners]) {
      try {
        listener(event)
      } catch {
        // One CDP domain cannot prevent sibling domains from observing realm lifecycle.
      }
    }
  }
}
