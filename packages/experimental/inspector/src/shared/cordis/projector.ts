/** Pure projection from routed Cordis snapshots to the consumer-neutral tree.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 projector 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { CordisTreeNode, CordisTreeSnapshot } from './snapshot.ts'
import {
  CORDIS_RUNTIME_TREE_SCHEMA_VERSION,
  cordisRuntimeSourceId,
  type CordisRuntimeContext,
  type CordisRuntimeNode,
  type CordisRuntimeSourceKind,
  type CordisRuntimeTree,
} from './model.ts'

/** Whether a retained routed snapshot still has a live source generation. */
export type CordisTreeSourceConnection =
  | { readonly state: 'connected' }
  | { readonly state: 'disconnected'; readonly reason: string }

/** One source generation and its latest routed Cordis snapshot. */
export interface CordisTreeSource {
  readonly sourceId: string
  readonly kind: CordisRuntimeSourceKind
  readonly label: string
}

/** One source generation and its latest routed Cordis snapshot. */
export interface CordisTreeSourceSnapshot<Source extends CordisTreeSource = CordisTreeSource> {
  readonly source: Source
  readonly snapshot: CordisTreeSnapshot
  readonly connection: CordisTreeSourceConnection
}

/** Routed Host and Client snapshots before consumer-neutral projection. */
export interface CordisInspectionTree<Source extends CordisTreeSource = CordisTreeSource> {
  readonly host: CordisTreeSourceSnapshot<Source> | null
  readonly clients: readonly CordisTreeSourceSnapshot<Source>[]
}

/**
 * Strip transport and live-object routing fields from retained Cordis snapshots.
 * @param tree - Worker-owned routed snapshots.
 * @returns A detached semantic tree safe for non-CDP consumers.
 * @remarks 中文说明：功能说明：处理 projectCordisRuntimeTree 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：tree（CordisInspectionTree<Source>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：CordisRuntimeTree；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * projectCordisRuntimeTree(tree)，并按返回类型处理结果。
 */
export function projectCordisRuntimeTree<Source extends CordisTreeSource>(tree: CordisInspectionTree<Source>): CordisRuntimeTree {
  return {
    schemaVersion: CORDIS_RUNTIME_TREE_SCHEMA_VERSION,
    host: tree.host === null ? null : projectRealm(tree.host),
    clients: tree.clients.map(projectRealm),
  }
}

/**
 * 功能说明：处理 projectRealm 相关流程；使用场景由所在模块及调用位置决定。
 * @param realm （CordisTreeSourceSnapshot）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns CordisRuntimeTree['clients'][number]；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 projectRealm(realm)，并按返回类型处理结果。
 */
function projectRealm(realm: CordisTreeSourceSnapshot): CordisRuntimeTree['clients'][number] {
  return {
    source: {
      sourceId: cordisRuntimeSourceId(realm.source.sourceId),
      kind: realm.source.kind,
      label: realm.source.label,
    },
    connection: realm.connection.state === 'connected'
      ? { state: 'connected' }
      : { state: 'disconnected', reason: realm.connection.reason },
    revision: realm.snapshot.revision,
    truncated: realm.snapshot.truncated,
    root: projectContext(realm.snapshot.root),
  }
}

/**
 * 功能说明：处理 projectContext 相关流程；使用场景由所在模块及调用位置决定。
 * @param node （Extract<CordisTreeNode, { kind: 'context' }>）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @returns CordisRuntimeContext；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 projectContext(node)，并按返回类型处理结果。
 */
function projectContext(node: Extract<CordisTreeNode, { kind: 'context' }>): CordisRuntimeContext {
  return { kind: 'context', children: node.children.map(projectNode) }
}

/**
 * 功能说明：处理 projectNode 相关流程；使用场景由所在模块及调用位置决定。
 * @param node （CordisTreeNode）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns CordisRuntimeNode；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 projectNode(node)，并按返回类型处理结果。
 */
function projectNode(node: CordisTreeNode): CordisRuntimeNode {
  if (node.kind === 'context') return projectContext(node)
  return {
    kind: 'fiber',
    uid: node.uid,
    children: [projectContext(node.children[0])],
  }
}
