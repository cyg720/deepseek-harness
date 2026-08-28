/** Host realm adapter backed by a connection-local Node inspector session.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 index 模块的职责，并向相邻模块提供可复用能力。
 * ；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import { randomUUID } from 'node:crypto'
import { inspectorId } from '../../../shared/identity.ts'
import { HostConsoleBackend } from './console.ts'
import { HostDebuggerBackend } from './debugger.ts'
import { HostRuntimeBackend } from './runtime.ts'
import { HostSourceBackend } from './sources.ts'
import { HostInspectorSession } from './bridge.ts'
import type { InspectorRealm, InspectorRealmDescriptor, InspectorRealmSession } from '../../inspection/realm.ts'

/**
 * 常量说明：HOST_RUNTIME_OPERATIONS 用于处理 HOST_RUNTIME_OPERATIONS 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const HOST_RUNTIME_OPERATIONS = [
  'evaluate',
  'get-properties',
  'call-function',
  'await-promise',
  'release-object',
  'release-object-group',
  'global-lexical-scope-names',
] as const

/** Host realm definition that opens one native V8 session per DevTools connection.
 * @remarks 中文说明：类说明：HostInspectorRealm 用于集中封装 处理 HostInspectorRealm
 * 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由
 * experimental/inspector 在对应插件或业务生命周期内创建和调用。 */
export class HostInspectorRealm implements InspectorRealm {
  /**
   * 常量说明：descriptor 用于处理 descriptor 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  readonly descriptor: InspectorRealmDescriptor
  /**
   * 常量说明：context 用于处理 context 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  readonly context: InspectorRealm['context'] = { kind: 'native' }
  /**
   * 常量说明：capabilities 用于处理 capabilities 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  readonly capabilities: InspectorRealm['capabilities'] = {
    runtime: HOST_RUNTIME_OPERATIONS,
    console: ['events', 'exceptions', 'clear'],
    sources: ['catalog', 'content', 'source-map'],
    debugger: ['breakpoint', 'pause', 'resume', 'step', 'call-frame'],
  }

  /**
   * 功能说明：处理 HostInspectorRealm 相关流程；使用场景由所在模块及调用位置决定。
   * @param label （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new HostInspectorRealm(label) 创建实例，并在所属生命周期内使用。
   */
  constructor(private readonly label: string) {
    this.descriptor = {
      realmId: inspectorId<'InspectorRealmId'>(randomUUID(), 'realmId'),
      sourceId: inspectorId<'InspectorSourceId'>('host-runtime', 'sourceId'),
      generation: inspectorId<'InspectorSourceGeneration'>(randomUUID(), 'generation'),
      kind: 'host',
      label,
    }
  }

  /** Open a native Host inspector session for one DevTools connection.
   * @remarks 中文说明：功能说明：打开 Session 相关流程；使用场景由所在模块及调用位置决定。；
   * 返回值：InspectorRealmSession；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * openSession()，并按返回类型处理结果。 */
  openSession(): InspectorRealmSession {
    /**
     * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const target = new HostInspectorSession(this.label)
    /**
     * 常量说明：runtime 用于处理 runtime 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const runtime = new HostRuntimeBackend(target)
    /**
     * 常量说明：console 用于处理 console 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const console = new HostConsoleBackend(target, runtime)
    /**
     * 常量说明：sources 用于处理 sources 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const sources = new HostSourceBackend(target)
    /**
     * 常量说明：debug 用于处理 debug 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const debug = new HostDebuggerBackend(target, runtime)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    return {
      descriptor: this.descriptor,
      context: this.context,
      runtime: { state: 'supported', backend: runtime },
      console: { state: 'supported', backend: console },
      sources: { state: 'supported', backend: sources },
      debugger: { state: 'supported', backend: debug },
      nativeDomains: { state: 'supported', backend: target },
      close: () => {
        sources.close()
        debug.close()
        console.close()
        runtime.close()
        target.close()
      },
    }
  }
}
