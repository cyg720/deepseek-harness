/** CDP-independent snapshot model for a Cordis Context and Fiber tree.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 snapshot 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import {
  type InspectorObjectHandle,
  type InspectorObjectRegistryId,
} from './ids.ts'
import { isPlainObject } from '../json.ts'
import { exactKeys, exactObject, wireId } from '../validation.ts'

/** Current serialized Cordis tree model version.
 * @remarks 中文说明：常量说明：CORDIS_TREE_SCHEMA_VERSION 用于处理
 * CORDIS_TREE_SCHEMA_VERSION 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const CORDIS_TREE_SCHEMA_VERSION = 0 as const

/** Maximum nesting accepted from one realm snapshot.
 * @remarks 中文说明：常量说明：CORDIS_TREE_MAX_DEPTH 用于处理 CORDIS_TREE_MAX_DEPTH 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const CORDIS_TREE_MAX_DEPTH = 256

interface CordisTreeNodeBase {
  readonly objectHandle: InspectorObjectHandle
}

/** One Context entity in a Cordis tree snapshot. */
export interface CordisContextTreeNode extends CordisTreeNodeBase {
  readonly kind: 'context'
  readonly children: readonly CordisTreeNode[]
}

/** One Fiber entity in a Cordis tree snapshot. */
export interface CordisFiberTreeNode extends CordisTreeNodeBase {
  readonly kind: 'fiber'
  readonly uid: number
  readonly children: readonly [CordisContextTreeNode]
}

/** One semantic entity node in preorder. */
export type CordisTreeNode = CordisContextTreeNode | CordisFiberTreeNode

/** Immutable, serializable state of one realm's reachable Cordis tree. */
export interface CordisTreeSnapshot {
  readonly schemaVersion: typeof CORDIS_TREE_SCHEMA_VERSION
  readonly revision: number
  readonly objectRegistryId: InspectorObjectRegistryId
  readonly root: CordisContextTreeNode
  readonly truncated: boolean
}

/**
 * Decode and validate one complete Cordis tree replacement.
 * @param value - Untrusted observation payload.
 * @param maxNodes - Maximum nodes admitted from one source.
 * @returns A detached, validated snapshot.
 * @remarks 中文说明：功能说明：解析 Cordis Tree Snapshot 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：maxNodes（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：CordisTreeSnapshot；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * parseCordisTreeSnapshot(value, maxNodes)，并按返回类型处理结果。
 */
export function parseCordisTreeSnapshot(value: unknown, maxNodes: number): CordisTreeSnapshot {
  /**
   * 常量说明：record 用于处理 record 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const record = exactObject(value, [
    'schemaVersion', 'revision', 'objectRegistryId', 'root', 'truncated',
  ], 'Cordis tree')
  if (record.schemaVersion !== CORDIS_TREE_SCHEMA_VERSION
    || !Number.isSafeInteger(record.revision) || (record.revision as number) < 1
    || typeof record.truncated !== 'boolean') {
    throw new Error('inspector protocol: invalid Cordis tree header')
  }
  /**
   * 常量说明：state 用于处理 state 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const state: ParseState = { count: 0, handles: new Set(), fiberUids: new Set() }
  /**
   * 常量说明：root 用于处理 root 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const root = parseNode(record.root, state, maxNodes, 0)
  if (root.kind !== 'context') throw new Error('inspector protocol: Cordis tree root must be a Context')
  return {
    schemaVersion: CORDIS_TREE_SCHEMA_VERSION,
    revision: record.revision as number,
    objectRegistryId: wireId<'InspectorObjectRegistryId'>(record.objectRegistryId, 'objectRegistryId'),
    root,
    truncated: record.truncated,
  }
}

interface ParseState {
  count: number
  readonly handles: Set<InspectorObjectHandle>
  readonly fiberUids: Set<number>
}

/**
 * 功能说明：解析 Node 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param state （ParseState）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param maxNodes （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param depth （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns CordisTreeNode；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 parseNode(value, state, maxNodes, depth)，并按返回类型处理结果。
 */
function parseNode(value: unknown, state: ParseState, maxNodes: number, depth: number): CordisTreeNode {
  if (depth > CORDIS_TREE_MAX_DEPTH) throw new Error('inspector protocol: Cordis tree exceeds the depth limit')
  if (++state.count > maxNodes) throw new Error(`inspector protocol: Cordis tree exceeds ${String(maxNodes)} nodes`)
  if (!isPlainObject(value) || (value.kind !== 'context' && value.kind !== 'fiber')) {
    throw new Error('inspector protocol: Cordis tree node must have a known kind')
  }
  /**
   * 常量说明：objectHandle 用于处理 objectHandle 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const objectHandle = wireId<'InspectorObjectHandle'>(value.objectHandle, 'objectHandle')
  if (state.handles.has(objectHandle)) throw new Error('inspector protocol: Cordis tree repeats an object handle')
  state.handles.add(objectHandle)
  if (!Array.isArray(value.children)) throw new Error('inspector protocol: Cordis tree node children must be an array')
  if (value.kind === 'context') {
    exactKeys(value, ['kind', 'objectHandle', 'children'], 'Context tree node')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：child（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(child)，并按返回类型处理结果。
     */
    return {
      kind: 'context',
      objectHandle,
      children: value.children.map(child => parseNode(child, state, maxNodes, depth + 1)),
    }
  }
  exactKeys(value, ['kind', 'objectHandle', 'uid', 'children'], 'Fiber tree node')
  if (!Number.isSafeInteger(value.uid) || (value.uid as number) < 1) {
    throw new Error('inspector protocol: Cordis Fiber uid must be a positive safe integer')
  }
  if (state.fiberUids.has(value.uid as number)) throw new Error('inspector protocol: Cordis tree repeats a Fiber uid')
  state.fiberUids.add(value.uid as number)
  if (value.children.length !== 1) throw new Error('inspector protocol: Cordis Fiber must own exactly one Context')
  /**
   * 常量说明：context 用于处理 context 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const context = parseNode(value.children[0], state, maxNodes, depth + 1)
  if (context.kind !== 'context') throw new Error('inspector protocol: Cordis Fiber child must be a Context')
  return {
    kind: 'fiber',
    objectHandle,
    uid: value.uid as number,
    children: [context],
  }
}
