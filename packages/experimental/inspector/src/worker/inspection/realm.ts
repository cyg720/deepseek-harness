/** Worker-owned lifecycle model for active Host and Client JavaScript realms.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 realm 模块的职责，并向相邻模块提供可复用能力。
 * ；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { InspectorSourceGeneration, InspectorSourceId } from '../../shared/bridge/ids.ts'
import type { InspectorRealmCapabilities } from '../../shared/cdp/capabilities.ts'
import type { InspectorRealmId } from '../../shared/cdp/ids.ts'
import type {
  ConsoleBackend,
  DebuggerBackend,
  NativeDomainBackend,
  RealmCapability,
  RuntimeBackend,
  SourceBackend,
} from '../../shared/cdp/realm.ts'

/** Stable description of one active realm generation. */
export interface InspectorRealmDescriptor {
  readonly realmId: InspectorRealmId
  readonly sourceId: InspectorSourceId
  readonly generation: InspectorSourceGeneration
  readonly kind: 'host' | 'client'
  readonly label: string
}

/** Execution-context ownership for one realm. */
export type InspectorRealmContext =
  | { readonly kind: 'native' }
  | {
    readonly kind: 'synthetic'
    readonly id: number
    readonly uniqueId: string
    readonly origin: string
  }

/** Capabilities bound to one realm and one DevTools connection. */
export interface InspectorRealmSession {
  readonly descriptor: InspectorRealmDescriptor
  readonly context: InspectorRealmContext
  readonly runtime: RealmCapability<RuntimeBackend>
  readonly console: RealmCapability<ConsoleBackend>
  readonly sources: RealmCapability<SourceBackend>
  readonly debugger: RealmCapability<DebuggerBackend>
  readonly nativeDomains: RealmCapability<NativeDomainBackend>
  /** Release every connection-owned backend resource.
   * @remarks 中文说明：功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 close()，并按返回类型处理结果。 */
  close(): void
}

/** Active realm that can create isolated state for each DevTools connection. */
export interface InspectorRealm {
  readonly descriptor: InspectorRealmDescriptor
  readonly context: InspectorRealmContext
  readonly capabilities: InspectorRealmCapabilities
  /** @returns Isolated backend state for one DevTools connection.
   * @remarks 中文说明：功能说明：打开 Session 相关流程；使用场景由所在模块及调用位置决定。；
   * 返回值：InspectorRealmSession；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * openSession()，并按返回类型处理结果。 */
  openSession(): InspectorRealmSession
}
