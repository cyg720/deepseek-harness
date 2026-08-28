/** Connection-local routing from CDP ScriptId values to realm source backends.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 script registry 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { RuntimeScriptKey } from '../../../../shared/cdp/ids.ts'
import type { RuntimeScript } from '../../../../shared/cdp/index.ts'
import type { SourceBackend } from '../../../../shared/cdp/realm.ts'
import type { InspectorRealmSession } from '../../../inspection/realm.ts'
import { cdpStringId, type CdpScriptId } from '../../ids.ts'

/** One script and the realm source backend that owns its content. */
export interface DebuggerScriptRoute {
  readonly realm: InspectorRealmSession
  readonly source: SourceBackend
  readonly script: RuntimeScript
}

/** Tracks active and retired scripts without exposing source transport ids.
 * @remarks 中文说明：类说明：DebuggerScriptRegistry 用于集中封装 处理
 * DebuggerScriptRegistry 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；
 * 使用场景：由 experimental/inspector 在对应插件或业务生命周期内创建和调用。 */
export class DebuggerScriptRegistry {
  /**
   * 常量说明：routes 用于处理 routes 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly routes = new Map<CdpScriptId, DebuggerScriptRoute>()
  /**
   * 常量说明：retiredUnsupported 用于处理 retiredUnsupported 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly retiredUnsupported = new Set<CdpScriptId>()

  /**
   * Register one realm script under its globally unique Runtime script key.
   * @param route - Script descriptor and owning realm session.
   * @returns The CDP ScriptId and whether this is its first announcement.
   * @remarks 中文说明：功能说明：注册 register 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：route（DebuggerScriptRoute）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：{
   * readonly scriptId: CdpScriptId; readonly fresh: boolean }；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 register(route)，并按返回类型处理结果。
   */
  register(route: DebuggerScriptRoute): { readonly scriptId: CdpScriptId; readonly fresh: boolean } {
    /**
     * 常量说明：scriptId 用于处理 scriptId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const scriptId = cdpScriptId(route.script.scriptKey)
    /**
     * 常量说明：current 用于处理 current 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const current = this.routes.get(scriptId)
    if (current !== undefined && current.realm !== route.realm) {
      throw new Error(`Inspector realms produced the same script key ${scriptId}`)
    }
    this.routes.set(scriptId, route)
    return { scriptId, fresh: current === undefined }
  }

  /**
   * Resolve an active CDP ScriptId.
   * @param scriptId - Connection-visible script id.
   * @returns The active route when the script remains connected.
   * @remarks 中文说明：功能说明：解析 resolve 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：scriptId（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：DebuggerScriptRoute | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 resolve(scriptId)，并按返回类型处理结果。
   */
  resolve(scriptId: string): DebuggerScriptRoute | undefined {
    return this.routes.get(cdpStringId<'CdpScriptId'>(scriptId, 'scriptId'))
  }

  /**
   * Resolve a script by its exact URL.
   * @param url - Script URL from a CDP request.
   * @returns The active route when one script has that URL.
   * @remarks 中文说明：功能说明：处理 byUrl 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：url（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：DebuggerScriptRoute |
   * undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 byUrl(url)，
   * 并按返回类型处理结果。
   */
  byUrl(url: string): DebuggerScriptRoute | undefined {
    /**
     * 变量说明：route 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const route of this.routes.values()) {
      if (route.script.url === url) return route
    }
    return undefined
  }

  /**
   * Resolve a script by its exact content hash.
   * @param hash - Script hash from a breakpoint request.
   * @returns The active route when one script has that hash.
   * @remarks 中文说明：功能说明：处理 byHash 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：hash（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：DebuggerScriptRoute
   * | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 byHash(hash)，
   * 并按返回类型处理结果。
   */
  byHash(hash: string): DebuggerScriptRoute | undefined {
    /**
     * 变量说明：route 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const route of this.routes.values()) {
      if (route.script.hash === hash) return route
    }
    return undefined
  }

  /**
   * Resolve the first script whose URL matches a breakpoint regular expression.
   * @param pattern - JavaScript regular-expression source accepted by CDP.
   * @returns The first matching active route.
   * @remarks 中文说明：功能说明：处理 byUrlPattern 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：pattern（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：DebuggerScriptRoute | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 byUrlPattern(pattern)，并按返回类型处理结果。
   */
  byUrlPattern(pattern: string): DebuggerScriptRoute | undefined {
    /**
     * 常量说明：expression 用于处理 expression 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const expression = new RegExp(pattern, 'u')
    /**
     * 变量说明：route 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const route of this.routes.values()) {
      if (expression.test(route.script.url)) return route
    }
    return undefined
  }

  /**
   * Test whether a disconnected script belonged to a realm without active debugging.
   * @param scriptId - Script id from a later CDP request.
   * @returns Whether the id must still fail as an unsupported Client script.
   * @remarks 中文说明：功能说明：处理 wasUnsupported 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：scriptId（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：boolean；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 wasUnsupported(scriptId)，
   * 并按返回类型处理结果。
   */
  wasUnsupported(scriptId: string): boolean {
    return this.retiredUnsupported.has(cdpStringId<'CdpScriptId'>(scriptId, 'scriptId'))
  }

  /**
   * Forget scripts for one closed realm while retaining their unsupported identity.
   * @param realm - Realm session being removed.
   * @remarks 中文说明：功能说明：移除 Realm 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：realm（InspectorRealmSession）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 removeRealm(realm)，
   * 并按返回类型处理结果。
   */
  removeRealm(realm: InspectorRealmSession): void {
    /**
     * 变量说明：scriptId、route 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const [scriptId, route] of this.routes) {
      if (route.realm !== realm) continue
      this.routes.delete(scriptId)
      if (realm.debugger.state === 'unsupported') this.retiredUnsupported.add(scriptId)
    }
  }

  /** Forget all active and retired script routes.
   * @remarks 中文说明：功能说明：处理 clear 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 clear()，并按返回类型处理结果。 */
  clear(): void {
    this.routes.clear()
    this.retiredUnsupported.clear()
  }
}

/**
 * Preserve a branded script key as its CDP wire identifier.
 * @param scriptKey - Realm-wide Runtime script key.
 * @returns The corresponding CDP ScriptId text.
 * @remarks 中文说明：功能说明：处理 cdpScriptId 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：scriptKey（RuntimeScriptKey）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：CdpScriptId；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * cdpScriptId(scriptKey)，并按返回类型处理结果。
 */
export function cdpScriptId(scriptKey: RuntimeScriptKey): CdpScriptId {
  return cdpStringId<'CdpScriptId'>(scriptKey, 'scriptId')
}
