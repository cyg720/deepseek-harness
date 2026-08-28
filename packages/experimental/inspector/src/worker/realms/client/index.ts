/** Client realm definition assembled from independent Runtime, Console, and Source backends.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 index 模块的职责，并向相邻模块提供可复用能力。
 * ；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import { randomUUID } from 'node:crypto'
import { inspectorId } from '../../../shared/identity.ts'
import { ClientConsoleBackend } from './console.ts'
import { ClientRuntimeBackend } from './runtime.ts'
import { ClientSourceBackend } from './sources.ts'
import { ClientScriptIdentity } from './scripts.ts'
import type { ClientRuntimeRouter, ClientRuntimeTarget } from '../../bridge/runtime-rpc.ts'
import type { ClientSourceRouter } from '../../bridge/source-rpc.ts'
import type { InspectorRealm, InspectorRealmDescriptor, InspectorRealmSession } from '../../inspection/realm.ts'
import { createClientRealmBridge, type ClientRealmBridge } from './bridge.ts'
import { clientDebuggerCapability } from './debugger.ts'

/**
 * 常量说明：CLIENT_RUNTIME_OPERATIONS 用于处理 CLIENT_RUNTIME_OPERATIONS 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const CLIENT_RUNTIME_OPERATIONS = [
  'evaluate',
  'get-properties',
  'call-function',
  'await-promise',
  'release-object',
  'release-object-group',
  'global-lexical-scope-names',
] as const

/** Active Client realm exposed through the common Worker realm model.
 * @remarks 中文说明：类说明：ClientInspectorRealm 用于集中封装 处理 ClientInspectorRealm
 * 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由
 * experimental/inspector 在对应插件或业务生命周期内创建和调用。 */
export class ClientInspectorRealm implements InspectorRealm {
  /**
   * 常量说明：descriptor 用于处理 descriptor 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  readonly descriptor: InspectorRealmDescriptor
  /**
   * 常量说明：context 用于处理 context 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  readonly context: InspectorRealm['context']
  /**
   * 常量说明：capabilities 用于处理 capabilities 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  readonly capabilities: InspectorRealm['capabilities']
  /**
   * 常量说明：scriptIds 用于处理 scriptIds 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly scriptIds: ClientScriptIdentity
  /**
   * 常量说明：bridge 用于处理 bridge 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly bridge: ClientRealmBridge

  /**
   * 功能说明：处理 ClientInspectorRealm 相关流程；使用场景由所在模块及调用位置决定。
   * @param target （ClientRuntimeTarget）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param runtimeRouter （ClientRuntimeRouter）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param sourceRouter （ClientSourceRouter）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new ClientInspectorRealm(target, runtimeRouter,
   * sourceRouter) 创建实例，并在所属生命周期内使用。
   */
  constructor(
    target: ClientRuntimeTarget,
    runtimeRouter: ClientRuntimeRouter,
    sourceRouter: ClientSourceRouter,
  ) {
    this.bridge = createClientRealmBridge(target, runtimeRouter, sourceRouter)
    this.descriptor = {
      realmId: inspectorId<'InspectorRealmId'>(randomUUID(), 'realmId'),
      sourceId: target.source.sourceId,
      generation: target.source.generation,
      kind: 'client',
      label: target.source.label,
    }
    this.context = {
      kind: 'synthetic',
      id: target.contextId,
      uniqueId: target.uniqueContextId,
      origin: target.capability.origin,
    }
    this.scriptIds = new ClientScriptIdentity(target.contextId)
    this.capabilities = {
      runtime: CLIENT_RUNTIME_OPERATIONS,
      console: supports(target, 'client-console') ? ['events', 'exceptions', 'clear'] : [],
      sources: supports(target, 'client-sources') ? ['catalog', 'content', 'source-map'] : [],
      debugger: [],
    }
  }

  /** Active source generation represented by this realm.
   * @remarks 中文说明：功能说明：处理 target 相关流程；使用场景由所在模块及调用位置决定。；
   * 返回值：ClientRuntimeTarget；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * target()，并按返回类型处理结果。 */
  get target(): ClientRuntimeTarget {
    return this.bridge.target
  }

  /** Open one isolated set of Client backends for a DevTools connection.
   * @remarks 中文说明：功能说明：打开 Session 相关流程；使用场景由所在模块及调用位置决定。；
   * 返回值：InspectorRealmSession；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * openSession()，并按返回类型处理结果。 */
  openSession(): InspectorRealmSession {
    /**
     * 常量说明：runtimeSessionId 用于处理 runtimeSessionId 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const runtimeSessionId = inspectorId<'ClientRuntimeSessionId'>(randomUUID(), 'runtimeSessionId')
    /**
     * 常量说明：runtime 用于处理 runtime 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const runtime = new ClientRuntimeBackend(this.target, runtimeSessionId, this.bridge.runtime, this.scriptIds)
    /**
     * 常量说明：console 用于处理 console 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const console = supports(this.target, 'client-console')
      ? new ClientConsoleBackend(this.target, runtimeSessionId, this.bridge.runtime, this.scriptIds)
      : undefined
    /**
     * 常量说明：sources 用于处理 sources 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const sources = supports(this.target, 'client-sources')
      ? new ClientSourceBackend(
        this.target,
        inspectorId<'ClientSourceSessionId'>(randomUUID(), 'sourceSessionId'),
        this.bridge.sources,
        this.scriptIds,
      )
      : undefined
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    return {
      descriptor: this.descriptor,
      context: this.context,
      runtime: { state: 'supported', backend: runtime },
      console: console === undefined
        ? { state: 'unsupported', reason: 'Client source does not provide Console events' }
        : { state: 'supported', backend: console },
      sources: sources === undefined
        ? { state: 'unsupported', reason: 'Client source does not provide a script catalog' }
        : { state: 'supported', backend: sources },
      debugger: clientDebuggerCapability(),
      nativeDomains: { state: 'unsupported', reason: 'Client realm has no native CDP transport' },
      close: () => {
        console?.close()
        sources?.close()
        runtime.close()
      },
    }
  }
}

/**
 * 功能说明：处理 supports 相关流程；使用场景由所在模块及调用位置决定。
 * @param target （ClientRuntimeTarget）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param capability （'client-console' | 'client-sources'）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 supports(target, capability)，并按返回类型处理结果。
 */
function supports(target: ClientRuntimeTarget, capability: 'client-console' | 'client-sources'): boolean {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：candidate（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(candidate)，并按返回类型处理结果。
   */
  return target.source.capabilities.some(candidate => candidate.type === capability)
}
