/** Repository-facing Host package entry over the mirrored implementation tree.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 index 模块的职责，并向相邻模块提供可复用能力。
 * ；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  apply as applyHost,
} from './host/plugin.ts'
import { resolveInspectorOptions, type InspectorOptions } from './host/bridge/controller.ts'
import type { CordisRuntimeTreeReader } from './shared/cordis/reader.ts'
import type { InspectorJsonValue } from './shared/json.ts'

export { resolveInspectorOptions, startInspector } from './host/plugin.ts'
export type { InspectorEndpoint, InspectorHandle, InspectorOptions, InspectorSpec } from './host/plugin.ts'
export type { CordisRuntimeTreeReader } from './shared/cordis/reader.ts'
export type {
  CordisRuntimeConnection,
  CordisRuntimeContext,
  CordisRuntimeFiber,
  CordisRuntimeNode,
  CordisRuntimeRealm,
  CordisRuntimeSource,
  CordisRuntimeTree,
} from './shared/cordis/model.ts'
export type { InspectorClientBootstrap } from './shared/bridge/messages/control.ts'
export type {
  InspectorRecordInput,
  InspectorSourceDescriptor,
  InspectorSourceKind,
} from './shared/bridge/messages/observation.ts'
export type { InspectorJsonObject, InspectorJsonPrimitive, InspectorJsonValue } from './shared/json.ts'
export type {
  CordisContextTreeNode,
  CordisFiberTreeNode,
  CordisTreeNode,
  CordisTreeSnapshot,
} from './shared/cordis/snapshot.ts'

/** Shared Host/Client service façade over the realm's source publisher. */
export interface InspectorService {
  /**
   * Publish one JSON observation without waiting for Worker delivery.
   * @param topic - Domain-owned topic name.
   * @param payload - JSON value validated before it reaches the carrier.
   * @param monotonicMs - Source-clock timestamp; defaults to `performance.now()`.
   * @remarks 中文说明：功能说明：处理 publish 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：topic（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：payload（InspectorJsonValue）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：monotonicMs（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 publish(topic, payload,
   * monotonicMs)，并按返回类型处理结果。
   */
  publish(topic: string, payload: InspectorJsonValue, monotonicMs?: number): void

  /** Read-only Cordis topology queries independent of CDP sessions. */
  readonly cordis: CordisRuntimeTreeReader
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Publish Host-realm observations and query the shared Inspector state. */
    inspector: InspectorService
  }
}

/** Cordis plugin name shared with the Client face.
 * @remarks 中文说明：常量说明：name 用于处理 name 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const name = 'experimental-inspector'

/** Host service required to inject the Client connection bootstrap into index.html.
 * @remarks 中文说明：常量说明：inject 用于处理 inject 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const inject = ['webServer']

/** Host plugin configuration. Fetch capture is enabled by default. */
export interface Config extends Omit<InspectorOptions, 'clientOrigins'> {
  /** Browser origins allowed to open the Client ingest WebSocket. */
  clientOrigins?: string[]
}

/**
 * 常量说明：libraryDefaults 用于处理 libraryDefaults 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const libraryDefaults = resolveInspectorOptions()

/** Runtime validation for {@link Config}.
 * @remarks 中文说明：常量说明：Config 用于处理 Config 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const Config: z<Config> = z.object({
  host: z.const('127.0.0.1').default('127.0.0.1'),
  port: z.natural().max(65_535).default(9_230),
  clientOrigins: z.array(z.string()).default([]),
  captureFetch: z.boolean().default(true),
  maxRequestBodyBytes: z.natural().min(1).default(libraryDefaults.maxRequestBodyBytes),
  maxResponseBodyBytes: z.natural().min(1).default(libraryDefaults.maxResponseBodyBytes),
  maxBodyChunkBytes: z.natural().min(1).default(libraryDefaults.maxBodyChunkBytes),
  maxJournalBytes: z.natural().min(1).default(libraryDefaults.maxJournalBytes),
  maxRetainedRequests: z.natural().min(1).default(libraryDefaults.maxRetainedRequests),
  maxSourceFrameBytes: z.natural().min(1).default(libraryDefaults.maxSourceFrameBytes),
  maxSourceRecordsPerFrame: z.natural().min(1).default(libraryDefaults.maxSourceRecordsPerFrame),
  maxQueuedRecords: z.natural().min(1).default(libraryDefaults.maxQueuedRecords),
  maxQueuedBytes: z.natural().min(1).default(libraryDefaults.maxQueuedBytes),
  startupTimeoutMs: z.natural().min(1).default(libraryDefaults.startupTimeoutMs),
  stopTimeoutMs: z.natural().min(1).default(libraryDefaults.stopTimeoutMs),
  clientReconnectBaseMs: z.natural().min(1).default(libraryDefaults.clientReconnectBaseMs),
  clientReconnectMaxMs: z.natural().min(1).default(libraryDefaults.clientReconnectMaxMs),
  clientRuntimeTimeoutMs: z.natural().min(1).default(libraryDefaults.clientRuntimeTimeoutMs),
  queryTimeoutMs: z.natural().min(1).default(libraryDefaults.queryTimeoutMs),
  maxClientRuntimeObjects: z.natural().min(1).default(libraryDefaults.maxClientRuntimeObjects),
  maxClientRuntimeProperties: z.natural().min(1).default(libraryDefaults.maxClientRuntimeProperties),
  maxClientSourceBytes: z.natural().min(1).default(libraryDefaults.maxClientSourceBytes),
  maxCordisNodes: z.natural().min(1).default(libraryDefaults.maxCordisNodes),
  maxDisconnectedCordisTrees: z.natural().default(libraryDefaults.maxDisconnectedCordisTrees),
})

/**
 * Apply the Host implementation from the repository-standard package entry.
 * @param ctx - Host Cordis plugin context.
 * @param config - Validated Inspector configuration.
 * @remarks 中文说明：功能说明：注册并应用 apply 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；
 * 参数说明：config（Config）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；返回值：Promise<void>；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 apply(ctx, config)，
 * 并按返回类型处理结果。
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  await applyHost(ctx, config)
}
