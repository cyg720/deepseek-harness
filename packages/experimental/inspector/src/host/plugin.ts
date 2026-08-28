/** Host Cordis plugin for the cross-realm Inspector Worker and full fetch capture.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 plugin 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { Context } from '@deepseek-ai/cordis'
import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'
import { resolveInspectorOptions, startInspector, type InspectorOptions } from './bridge/controller.ts'
import { createInspectorService } from '../shared/service.ts'
import { publishCordisTree } from './inspection/cordis.ts'

export { resolveInspectorOptions, startInspector } from './bridge/controller.ts'
export type { InspectorEndpoint, InspectorHandle, InspectorOptions, InspectorSpec } from './bridge/controller.ts'
export type { CordisRuntimeTreeReader } from '../shared/cordis/reader.ts'
export type {
  CordisRuntimeConnection,
  CordisRuntimeContext,
  CordisRuntimeFiber,
  CordisRuntimeNode,
  CordisRuntimeRealm,
  CordisRuntimeSource,
  CordisRuntimeTree,
} from '../shared/cordis/model.ts'
export type { InspectorClientBootstrap } from '../shared/bridge/messages/control.ts'
export type { InspectorRecordInput, InspectorSourceDescriptor, InspectorSourceKind } from '../shared/bridge/messages/observation.ts'
export type { InspectorJsonObject, InspectorJsonPrimitive, InspectorJsonValue } from '../shared/json.ts'
export type {
  CordisContextTreeNode,
  CordisFiberTreeNode,
  CordisTreeNode,
  CordisTreeSnapshot,
} from '../shared/cordis/snapshot.ts'

/** Configuration consumed by the Host implementation after package-entry validation. */
export interface HostPluginConfig extends Omit<InspectorOptions, 'clientOrigins'> {
  /** Browser origins allowed to open the Client ingest WebSocket. */
  clientOrigins?: string[]
}

/** Start the Worker, expose `ctx.inspector`, and inject the matching Client bootstrap.
 * @remarks 中文说明：功能说明：注册并应用 apply 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；
 * 参数说明：config（HostPluginConfig）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；
 * 返回值：Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * apply(ctx, config)，并按返回类型处理结果。 */
export async function apply(ctx: Context, config: HostPluginConfig): Promise<void> {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  await ctx.effect(async () => {
    /**
     * 常量说明：spec 用于处理 spec 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const spec = resolveInspectorOptions(config)
    /**
     * 常量说明：handle 用于处理 handle 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const handle = await startInspector(spec)
    /**
     * 常量说明：disposers 用于处理 disposers 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const disposers: Array<() => unknown> = []
    /**
     * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      disposers.push(publishCordisTree(ctx, handle.source, {
        maxNodes: spec.maxCordisNodes,
        maxBytes: spec.maxSourceFrameBytes - 4_096,
      }))
      disposers.push(ctx.provide('inspector', createInspectorService(handle.source)))
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：table（IndexInjection[]）：提供本次调用所需的
       * 数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
       * ；典型用法：在完成前置校验后调用 匿名回调(table)，并按返回类型处理结果。
       */
      disposers.push(ctx.on('webserver/index-inject', (table: IndexInjection[]) => {
        table.push({ kind: 'global', name: '__DSH_INSPECTOR__', value: handle.endpoint.client })
      }))
      // This readiness URL is emitted while the plugin tree is still loading, before a logger sink is guaranteed.
      console.log(`dsh inspector: ${handle.endpoint.devtoolsFrontendUrl}`)
    } catch (error) {
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：cleanupError（unknown）：提供本次调用所需的数据；
       * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
       * 典型用法：在完成前置校验后调用 匿名回调(cleanupError)，并按返回类型处理结果。
       */
      await disposeInspector(handle, disposers).catch((cleanupError: unknown) => {
        ctx.logger.error('experimental-inspector: initialization rollback failed', cleanupError)
      })
      throw error
    }
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    return async () => { await disposeInspector(handle, disposers) }
  }, 'experimental-inspector: Host Worker')
}

/**
 * 功能说明：处理 disposeInspector 相关流程；使用场景由所在模块及调用位置决定。
 * @param handle （Awaited<ReturnType<typeof startInspector>>）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @param disposers （readonly (() => unknown)[]）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 disposeInspector(handle, disposers)，并按返回类型处理结果。
 */
async function disposeInspector(
  handle: Awaited<ReturnType<typeof startInspector>>,
  disposers: readonly (() => unknown)[],
): Promise<void> {
  /**
   * 常量说明：failures 用于处理 failures 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const failures: unknown[] = []
  /**
   * 变量说明：dispose 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const dispose of [...disposers].reverse()) {
    /**
     * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      await dispose()
    } catch (error) {
      failures.push(error)
    }
  }
  /**
   * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
   */
  try {
    await handle.close()
  } catch (error) {
    failures.push(error)
  }
  if (failures.length > 0) throw new AggregateError(failures, 'experimental-inspector: disposal failed')
}
