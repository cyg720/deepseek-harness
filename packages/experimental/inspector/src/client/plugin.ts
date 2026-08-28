/** Client Cordis plugin that publishes browser observations directly to the Inspector Worker.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 plugin 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { Context } from '@deepseek-ai/cordis'
import { parseInspectorClientBootstrap } from '../shared/bridge/control-codec.ts'
import { createInspectorService, type InspectorService as SharedInspectorService } from '../shared/service.ts'
import { publishCordisTree } from './inspection/cordis.ts'
import { startInspectorClient } from './bridge/controller.ts'

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

/** Client-facing Inspector service backed by the shared implementation. */
export interface InspectorService extends SharedInspectorService {}

declare global {
  /** Host-injected Inspector Client connection parameters.
   * @remarks 中文说明：变量说明：__DSH_INSPECTOR__ 用于处理 __DSH_INSPECTOR__ 相关数据，
   * 作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。 */
  var __DSH_INSPECTOR__: unknown
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Publish Client-realm observations and query the shared Inspector state. */
    inspector: InspectorService
  }
}

/** Cordis plugin name shared with the Host face.
 * @remarks 中文说明：常量说明：name 用于处理 name 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const name = 'experimental-inspector'

/** This transport root has no Client service dependencies.
 * @remarks 中文说明：常量说明：inject 用于处理 inject 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const inject: string[] = []

/**
 * Mount the Client source and shared `ctx.inspector` publishing API.
 * @param ctx - Client Cordis context whose page identity and lifecycle own the source.
 * @remarks 中文说明：功能说明：注册并应用 apply 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；
 * 返回值：Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * apply(ctx)，并按返回类型处理结果。
 */
export async function apply(ctx: Context): Promise<void> {
  /**
   * 常量说明：injected 用于处理 injected 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const injected = globalThis.__DSH_INSPECTOR__
  if (injected === undefined) {
    throw new Error('experimental inspector: Host bootstrap is missing')
  }
  /**
   * 常量说明：bootstrap 用于处理 bootstrap 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const bootstrap = parseInspectorClientBootstrap(injected)
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  await ctx.effect(async () => {
    /**
     * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const source = await startInspectorClient(bootstrap)
    /**
     * 常量说明：disposers 用于处理 disposers 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const disposers: Array<() => unknown> = []
    /**
     * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      disposers.push(publishCordisTree(ctx, source, {
        maxNodes: bootstrap.maxCordisNodes,
        maxBytes: bootstrap.maxFrameBytes - 4_096,
      }))
      disposers.push(ctx.provide('inspector', createInspectorService(source)))
    } catch (error) {
      /**
       * 变量说明：cleanupError 保存当前捕获的异常；使用前应按项目约定缩小其类型。
       */
      try {
        disposeInspectorClient(source, disposers)
      } catch (cleanupError) {
        ctx.logger.error('experimental-inspector: Client initialization rollback failed', cleanupError)
      }
      throw error
    }
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    return () => { disposeInspectorClient(source, disposers) }
  }, 'experimental-inspector: Client source')
}

/**
 * 功能说明：处理 disposeInspectorClient 相关流程；使用场景由所在模块及调用位置决定。
 * @param source （Awaited<ReturnType<typeof
 * startInspectorClient>>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param disposers （readonly (() => unknown)[]）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 disposeInspectorClient(source, disposers)，并按返回类型处理结果。
 */
function disposeInspectorClient(
  source: Awaited<ReturnType<typeof startInspectorClient>>,
  disposers: readonly (() => unknown)[],
): void {
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
      dispose()
    } catch (error) {
      failures.push(error)
    }
  }
  /**
   * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
   */
  try {
    source.close()
  } catch (error) {
    failures.push(error)
  }
  if (failures.length > 0) throw new AggregateError(failures, 'experimental-inspector: Client disposal failed')
}
