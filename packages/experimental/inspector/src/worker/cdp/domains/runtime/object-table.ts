/** Per-CDP-connection routing and projection for every realm's Runtime objects.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 object table 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type {
  RuntimeCompletion,
  RuntimeConsoleBackendEvent,
  RuntimeExceptionDetails,
  RuntimeInternalPropertyDescriptor,
  RuntimePrivatePropertyDescriptor,
  RuntimeProperties,
  RuntimePropertyDescriptor,
  RuntimeRemoteObject,
  RuntimeStackTrace,
} from '../../../../shared/cdp/index.ts'
import type { InspectorObjectReference } from '../../../../shared/cordis/object-reference.ts'
import type { RuntimeBackendObjectHandle } from '../../../../shared/cdp/ids.ts'
import type { InspectorRealmDescriptor, InspectorRealmSession } from '../../../inspection/realm.ts'
import { cdpStringId, type CdpRemoteObjectId, type InspectorConnectionId } from '../../ids.ts'

/** Object retained behind one connection-local CDP object id. */
export interface RuntimeObjectRoute {
  readonly realm: InspectorRealmSession
  readonly handle: RuntimeBackendObjectHandle
  readonly group: string | undefined
}

/** Semantic presentation applied when an object belongs to a projected node. */
export interface RuntimeObjectPresentation {
  readonly subtype: 'node'
  readonly className: string
  readonly description: string
}

/** Observer of newly exposed Runtime object ids. */
export type RuntimeObjectObserver = (
  objectId: CdpRemoteObjectId,
  realm: InspectorRealmDescriptor,
  reference: InspectorObjectReference,
  group: string | undefined,
) => RuntimeObjectPresentation | undefined

/** CDP Runtime payload derived from one realm completion. */
export interface CdpRuntimeCompletion {
  readonly result: Readonly<Record<string, unknown>>
  readonly exceptionDetails?: Readonly<Record<string, unknown>>
}

/** CDP Runtime payload derived from one realm's property descriptors. */
export interface CdpGetPropertiesResult {
  readonly result: readonly Readonly<Record<string, unknown>>[]
  readonly internalProperties?: readonly Readonly<Record<string, unknown>>[]
  readonly privateProperties?: readonly Readonly<Record<string, unknown>>[]
  readonly exceptionDetails?: Readonly<Record<string, unknown>>
}

/** One CDP notification projected from a realm Console event. */
export interface CdpRuntimeEvent {
  readonly method: 'Runtime.consoleAPICalled' | 'Runtime.exceptionThrown'
  readonly params: Readonly<Record<string, unknown>>
}

/** Maps every realm's backend handles to object ids scoped to one CDP connection.
 * @remarks 中文说明：类说明：RuntimeObjectTable 用于集中封装 处理 RuntimeObjectTable
 * 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由
 * experimental/inspector 在对应插件或业务生命周期内创建和调用。 */
export class RuntimeObjectTable {
  /**
   * 常量说明：routes 用于处理 routes 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly routes = new Map<CdpRemoteObjectId, RuntimeObjectRoute>()
  /**
   * 变量说明：nextObjectId 用于处理 nextObjectId 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private nextObjectId = 1
  /**
   * 变量说明：nextExceptionId 用于处理 nextExceptionId 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private nextExceptionId = 1
  /**
   * 变量说明：observer 用于处理 observer 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private observer: RuntimeObjectObserver | undefined

  /**
   * 功能说明：处理 RuntimeObjectTable 相关流程；使用场景由所在模块及调用位置决定。
   * @param connectionId （InspectorConnectionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new RuntimeObjectTable(connectionId) 创建实例，并在所属生命周期内使用。
   */
  constructor(private readonly connectionId: InspectorConnectionId) {}

  /**
   * Install Cordis object recognition after Runtime and DOM sessions are assembled.
   * @param observer - Callback mapping a semantic reference to node presentation.
   * @remarks 中文说明：功能说明：设置 Observer 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：observer（RuntimeObjectObserver）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * setObserver(observer)，并按返回类型处理结果。
   */
  setObserver(observer: RuntimeObjectObserver): void {
    this.observer = observer
  }

  /**
   * Resolve one connection-local object id.
   * @param objectId - CDP object id allocated by this table.
   * @returns Its realm and backend handle when current.
   * @remarks 中文说明：功能说明：解析 resolve 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：objectId（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：RuntimeObjectRoute | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 resolve(objectId)，并按返回类型处理结果。
   */
  resolve(objectId: string): RuntimeObjectRoute | undefined {
    return this.routes.get(cdpStringId<'CdpRemoteObjectId'>(objectId, 'objectId'))
  }

  /**
   * Convert a realm completion to CDP fields.
   * @param realm - Realm session that produced the value.
   * @param value - Engine-independent completion.
   * @param group - Object group inherited by exposed handles.
   * @returns CDP Runtime completion fields.
   * @remarks 中文说明：功能说明：处理 completion 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：realm（InspectorRealmSession）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：value（RuntimeCompletion<RuntimeBackendObjectHandle>）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；参数说明：group（string | undefined）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：CdpRuntimeCompletion；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 completion(realm, value, group)，并按返回类型处理结果。
   */
  completion(
    realm: InspectorRealmSession,
    value: RuntimeCompletion<RuntimeBackendObjectHandle>,
    group: string | undefined,
  ): CdpRuntimeCompletion {
    return {
      result: this.remote(realm, value.result, group),
      ...(value.exceptionDetails === undefined
        ? {}
        : { exceptionDetails: this.exception(realm, value.exceptionDetails, group) }),
    }
  }

  /**
   * Convert realm property descriptors to CDP fields.
   * @param realm - Realm session that owns returned object references.
   * @param value - Engine-independent property result.
   * @param group - Object group inherited from the inspected object.
   * @returns CDP Runtime property result fields.
   * @remarks 中文说明：功能说明：处理 properties 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：realm（InspectorRealmSession）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：value（RuntimeProperties<RuntimeBackendObjectHandle>）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；参数说明：group（string | undefined）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：CdpGetPropertiesResult；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 properties(realm, value, group)，并按返回类型处理结果。
   */
  properties(
    realm: InspectorRealmSession,
    value: RuntimeProperties<RuntimeBackendObjectHandle>,
    group: string | undefined,
  ): CdpGetPropertiesResult {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：property（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(property)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：property（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(property)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：property（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(property)，并按返回类型处理结果。
     */
    return {
      result: value.properties.map(property => this.property(realm, property, group)),
      ...(value.internalProperties === undefined
        ? {}
        : { internalProperties: value.internalProperties.map(property => this.internalProperty(realm, property, group)) }),
      ...(value.privateProperties === undefined
        ? {}
        : { privateProperties: value.privateProperties.map(property => this.privateProperty(realm, property, group)) }),
      ...(value.exceptionDetails === undefined
        ? {}
        : { exceptionDetails: this.exception(realm, value.exceptionDetails, group) }),
    }
  }

  /**
   * Project one realm Console event to a CDP Runtime notification.
   * @param realm - Realm session that emitted the event.
   * @param value - Realm-neutral Console or exception event.
   * @returns CDP method and parameters.
   * @remarks 中文说明：功能说明：处理 consoleEvent 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：realm（InspectorRealmSession）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：value（RuntimeConsoleBackendEvent<RuntimeBackendObjectHandle>）：提供本次调
   * 用所需的数据；必须满足声明的类型及调用时序要求。；返回值：CdpRuntimeEvent；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 consoleEvent(realm, value)，并按返回类型处理结果。
   */
  consoleEvent(
    realm: InspectorRealmSession,
    value: RuntimeConsoleBackendEvent<RuntimeBackendObjectHandle>,
  ): CdpRuntimeEvent {
    if (value.type === 'console-api') {
      /**
       * 常量说明：contextId 用于处理 contextId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const contextId = value.event.contextId
        ?? (realm.context.kind === 'synthetic' ? realm.context.id : undefined)
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：argument（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(argument)，并按返回类型处理结果。
       */
      return {
        method: 'Runtime.consoleAPICalled',
        params: {
          type: value.event.type,
          args: value.event.arguments.map(argument => this.remote(realm, argument, 'console')),
          timestamp: value.event.timestamp,
          ...(contextId === undefined ? {} : { executionContextId: contextId }),
          ...(value.event.stackTrace === undefined ? {} : { stackTrace: cdpStackTrace(value.event.stackTrace) }),
        },
      }
    }
    /**
     * 常量说明：contextId 用于处理 contextId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const contextId = value.event.contextId
      ?? (realm.context.kind === 'synthetic' ? realm.context.id : undefined)
    return {
      method: 'Runtime.exceptionThrown',
      params: {
        timestamp: value.event.timestamp,
        exceptionDetails: {
          ...this.exception(realm, value.event.details, 'console'),
          ...(contextId === undefined ? {} : { executionContextId: contextId }),
        },
      },
    }
  }

  /**
   * List realm sessions retaining at least one object in a group.
   * @param group - DevTools object-group name.
   * @returns Distinct realm sessions that must receive the release.
   * @remarks 中文说明：功能说明：处理 realmsInGroup 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：group（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：InspectorRealmSession[]；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 realmsInGroup(group)，并按返回类型处理结果。
   */
  realmsInGroup(group: string): InspectorRealmSession[] {
    /**
     * 常量说明：realms 用于处理 realms 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const realms = new Set<InspectorRealmSession>()
    /**
     * 变量说明：route 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const route of this.routes.values()) {
      if (route.group === group) realms.add(route.realm)
    }
    return [...realms]
  }

  /**
   * Forget one externally visible object id.
   * @param objectId - Released CDP object id.
   * @remarks 中文说明：功能说明：处理 release 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：objectId（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 release(objectId)，并按返回类型处理结果。
   */
  release(objectId: string): void {
    this.routes.delete(cdpStringId<'CdpRemoteObjectId'>(objectId, 'objectId'))
  }

  /**
   * Forget all ids retained under one object group.
   * @param group - Released object-group name.
   * @remarks 中文说明：功能说明：处理 releaseGroup 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：group（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 releaseGroup(group)，并按返回类型处理结果。
   */
  releaseGroup(group: string): void {
    /**
     * 变量说明：objectId、route 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const [objectId, route] of this.routes) {
      if (route.group === group) this.routes.delete(objectId)
    }
  }

  /**
   * Forget every object owned by one closed realm session.
   * @param realm - Closed realm session.
   * @remarks 中文说明：功能说明：处理 releaseRealm 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：realm（InspectorRealmSession）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 releaseRealm(realm)，
   * 并按返回类型处理结果。
   */
  releaseRealm(realm: InspectorRealmSession): void {
    /**
     * 变量说明：objectId、route 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const [objectId, route] of this.routes) {
      if (route.realm === realm) this.routes.delete(objectId)
    }
  }

  /** Forget every object exposed on this DevTools connection.
   * @remarks 中文说明：功能说明：处理 clear 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 clear()，并按返回类型处理结果。 */
  clear(): void {
    this.routes.clear()
  }

  /**
   * Project one common Runtime value and retain its backend handle for this connection.
   * @param realm - Realm session that owns the value.
   * @param value - Realm-neutral Runtime value.
   * @param group - Object group assigned to any exposed handle.
   * @returns CDP RemoteObject fields.
   * @remarks 中文说明：功能说明：处理 remote 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：realm（InspectorRealmSession）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：value（RuntimeRemoteObject<RuntimeBackendObjectHandle>）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；参数说明：group（string | undefined）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：Readonly<Record<string, unknown>>；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 remote(realm, value, group)，
   * 并按返回类型处理结果。
   */
  remote(
    realm: InspectorRealmSession,
    value: RuntimeRemoteObject<RuntimeBackendObjectHandle>,
    group: string | undefined,
  ): Readonly<Record<string, unknown>> {
    /**
     * 常量说明：objectId 用于处理 objectId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const objectId = value.object === undefined
      ? undefined
      : this.expose(realm, value.object.handle, group)
    /**
     * 常量说明：presentation 用于处理 presentation 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const presentation = objectId === undefined || value.semanticReference === undefined
      ? undefined
      : this.observer?.(objectId, realm.descriptor, value.semanticReference, group)
    /**
     * 常量说明：descriptor 用于处理 descriptor 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const descriptor = value.descriptor
    return {
      ...descriptor,
      ...(presentation?.subtype === undefined ? {} : { subtype: presentation.subtype }),
      ...(presentation?.className === undefined ? {} : { className: presentation.className }),
      ...(presentation?.description === undefined ? {} : { description: presentation.description }),
      ...(objectId === undefined ? {} : { objectId }),
    }
  }

  /**
   * 功能说明：处理 property 相关流程；使用场景由所在模块及调用位置决定。
   * @param realm （InspectorRealmSession）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param property （RuntimePropertyDescriptor<RuntimeBackendObjectHandle>）：
   * 提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param group （string | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Readonly<Record<string, unknown>>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 property(realm, property, group)，并按返回类型处理结果。
   */
  private property(
    realm: InspectorRealmSession,
    property: RuntimePropertyDescriptor<RuntimeBackendObjectHandle>,
    group: string | undefined,
  ): Readonly<Record<string, unknown>> {
    return {
      ...property,
      ...(property.value === undefined ? {} : { value: this.remote(realm, property.value, group) }),
      ...(property.get === undefined ? {} : { get: this.remote(realm, property.get, group) }),
      ...(property.set === undefined ? {} : { set: this.remote(realm, property.set, group) }),
      ...(property.symbol === undefined ? {} : { symbol: this.remote(realm, property.symbol, group) }),
    }
  }

  /**
   * 功能说明：处理 internalProperty 相关流程；使用场景由所在模块及调用位置决定。
   * @param realm （InspectorRealmSession）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param property （RuntimeInternalPropertyDescriptor<RuntimeBackendObjectH
   * andl…）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param group （string | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Readonly<Record<string, unknown>>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 internalProperty(realm, property, group)，并按返回类型处理结果。
   */
  private internalProperty(
    realm: InspectorRealmSession,
    property: RuntimeInternalPropertyDescriptor<RuntimeBackendObjectHandle>,
    group: string | undefined,
  ): Readonly<Record<string, unknown>> {
    return {
      name: property.name,
      ...(property.value === undefined ? {} : { value: this.remote(realm, property.value, group) }),
    }
  }

  /**
   * 功能说明：处理 privateProperty 相关流程；使用场景由所在模块及调用位置决定。
   * @param realm （InspectorRealmSession）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param property （RuntimePrivatePropertyDescriptor<RuntimeBackendObjectHa
   * ndle>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param group （string | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Readonly<Record<string, unknown>>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 privateProperty(realm, property, group)，并按返回类型处理结果。
   */
  private privateProperty(
    realm: InspectorRealmSession,
    property: RuntimePrivatePropertyDescriptor<RuntimeBackendObjectHandle>,
    group: string | undefined,
  ): Readonly<Record<string, unknown>> {
    return {
      name: property.name,
      ...(property.value === undefined ? {} : { value: this.remote(realm, property.value, group) }),
      ...(property.get === undefined ? {} : { get: this.remote(realm, property.get, group) }),
      ...(property.set === undefined ? {} : { set: this.remote(realm, property.set, group) }),
    }
  }

  /**
   * 功能说明：处理 exception 相关流程；使用场景由所在模块及调用位置决定。
   * @param realm （InspectorRealmSession）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param details （RuntimeExceptionDetails<RuntimeBackendObjectHandle>）：提供本
   * 次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param group （string | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Readonly<Record<string, unknown>>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 exception(realm, details, group)，并按返回类型处理结果。
   */
  private exception(
    realm: InspectorRealmSession,
    details: RuntimeExceptionDetails<RuntimeBackendObjectHandle>,
    group: string | undefined,
  ): Readonly<Record<string, unknown>> {
    return {
      ...details,
      exceptionId: this.nextExceptionId++,
      ...(realm.context.kind === 'synthetic' ? { executionContextId: realm.context.id } : {}),
      ...(details.stackTrace === undefined ? {} : { stackTrace: cdpStackTrace(details.stackTrace) }),
      ...(details.exception === undefined ? {} : { exception: this.remote(realm, details.exception, group) }),
    }
  }

  /**
   * 功能说明：处理 expose 相关流程；使用场景由所在模块及调用位置决定。
   * @param realm （InspectorRealmSession）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param handle （RuntimeBackendObjectHandle）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param group （string | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns CdpRemoteObjectId；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 expose(realm, handle, group)，并按返回类型处理结果。
   */
  private expose(
    realm: InspectorRealmSession,
    handle: RuntimeBackendObjectHandle,
    group: string | undefined,
  ): CdpRemoteObjectId {
    /**
     * 常量说明：objectId 用于处理 objectId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const objectId = cdpStringId<'CdpRemoteObjectId'>(
      `runtime:${this.connectionId}:${String(this.nextObjectId++)}`,
      'objectId',
    )
    this.routes.set(objectId, { realm, handle, group })
    return objectId
  }
}

/**
 * 功能说明：处理 cdpStackTrace 相关流程；使用场景由所在模块及调用位置决定。
 * @param stack （RuntimeStackTrace）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Readonly<Record<string, unknown>>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 cdpStackTrace(stack)，并按返回类型处理结果。
 */
function cdpStackTrace(stack: RuntimeStackTrace): Readonly<Record<string, unknown>> {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：frame（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(frame)，并按返回类型处理结果。
   */
  return {
    ...(stack.description === undefined ? {} : { description: stack.description }),
    callFrames: stack.callFrames.map(frame => ({
      functionName: frame.functionName,
      scriptId: frame.scriptKey ?? '0',
      url: frame.url,
      lineNumber: frame.lineNumber,
      columnNumber: frame.columnNumber,
    })),
    ...(stack.parent === undefined ? {} : { parent: cdpStackTrace(stack.parent) }),
  }
}
