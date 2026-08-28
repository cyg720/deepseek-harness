/** Consumer-neutral Cordis runtime tree shared by non-CDP readers.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 model 模块的职责，并向相邻模块提供可复用能力。
 * ；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import { CORDIS_TREE_MAX_DEPTH } from './snapshot.ts'
import { inspectorId, type InspectorId } from '../identity.ts'
import { isPlainObject } from '../json.ts'
import { exactKeys, exactObject, wireId } from '../validation.ts'

/** Current consumer-neutral Cordis tree version.
 * @remarks 中文说明：常量说明：CORDIS_RUNTIME_TREE_SCHEMA_VERSION 用于处理
 * CORDIS_RUNTIME_TREE_SCHEMA_VERSION 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const CORDIS_RUNTIME_TREE_SCHEMA_VERSION = 0 as const

/** Consumer-visible identity of one inspected Cordis runtime. */
export type CordisRuntimeSourceId = InspectorId<'CordisRuntimeSourceId'>

/** Execution environment represented by one consumer-visible Cordis runtime. */
export type CordisRuntimeSourceKind = 'host' | 'client'

/** Availability of the realm represented by a retained tree. */
export type CordisRuntimeConnection =
  | { readonly state: 'connected' }
  | { readonly state: 'disconnected'; readonly reason: string }

/** Consumer-visible identity of one Cordis realm. */
export interface CordisRuntimeSource {
  readonly sourceId: CordisRuntimeSourceId
  readonly kind: CordisRuntimeSourceKind
  readonly label: string
}

/** One Context in a consumer-neutral Cordis tree. */
export interface CordisRuntimeContext {
  readonly kind: 'context'
  readonly children: readonly CordisRuntimeNode[]
}

/** One Fiber and its owned Context in a consumer-neutral Cordis tree. */
export interface CordisRuntimeFiber {
  readonly kind: 'fiber'
  readonly uid: number
  readonly children: readonly [CordisRuntimeContext]
}

/** One semantic Cordis runtime node. */
export type CordisRuntimeNode = CordisRuntimeContext | CordisRuntimeFiber

/** Latest retained topology and availability of one Cordis realm. */
export interface CordisRuntimeRealm {
  readonly source: CordisRuntimeSource
  readonly connection: CordisRuntimeConnection
  readonly revision: number
  readonly truncated: boolean
  readonly root: CordisRuntimeContext
}

/** Latest Host and Client Cordis topology without routing or CDP identifiers. */
export interface CordisRuntimeTree {
  readonly schemaVersion: typeof CORDIS_RUNTIME_TREE_SCHEMA_VERSION
  readonly host: CordisRuntimeRealm | null
  readonly clients: readonly CordisRuntimeRealm[]
}

/**
 * Decode a consumer-neutral tree received across an Inspector transport.
 * @param value - Untrusted query result value.
 * @returns A detached tree containing only public semantic fields.
 * @remarks 中文说明：功能说明：解析 Cordis Runtime Tree 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：CordisRuntimeTree；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * parseCordisRuntimeTree(value)，并按返回类型处理结果。
 */
export function parseCordisRuntimeTree(value: unknown): CordisRuntimeTree {
  /**
   * 常量说明：record 用于处理 record 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const record = exactObject(value, ['schemaVersion', 'host', 'clients'], 'Cordis runtime tree')
  if (record.schemaVersion !== CORDIS_RUNTIME_TREE_SCHEMA_VERSION || !Array.isArray(record.clients)) {
    throw new Error('inspector protocol: invalid Cordis runtime tree')
  }
  /**
   * 常量说明：host 用于处理 host 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const host = record.host === null ? null : parseRealm(record.host, 'host')
  /**
   * 常量说明：clients 用于处理 clients 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：client（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(client)，并按返回类型处理结果。
   */
  const clients = record.clients.map(client => parseRealm(client, 'client'))
  /**
   * 常量说明：sourceIds 用于处理 sourceIds 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const sourceIds = new Set<CordisRuntimeSourceId>()
  /**
   * 变量说明：realm 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const realm of host === null ? clients : [host, ...clients]) {
    if (sourceIds.has(realm.source.sourceId)) {
      throw new Error('inspector protocol: Cordis runtime tree repeats a sourceId')
    }
    sourceIds.add(realm.source.sourceId)
  }
  return {
    schemaVersion: CORDIS_RUNTIME_TREE_SCHEMA_VERSION,
    host,
    clients,
  }
}

/**
 * 功能说明：解析 Realm 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param kind （CordisRuntimeSourceKind）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns CordisRuntimeRealm；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 parseRealm(value, kind)，并按返回类型处理结果。
 */
function parseRealm(value: unknown, kind: CordisRuntimeSourceKind): CordisRuntimeRealm {
  /**
   * 常量说明：record 用于处理 record 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const record = exactObject(value, ['source', 'connection', 'revision', 'truncated', 'root'], 'Cordis runtime realm')
  /**
   * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const source = exactObject(record.source, ['sourceId', 'kind', 'label'], 'Cordis runtime source')
  if (source.kind !== kind || typeof source.label !== 'string' || source.label.length === 0 || source.label.length > 256) {
    throw new Error(`inspector protocol: invalid ${kind} Cordis runtime source`)
  }
  if (!Number.isSafeInteger(record.revision) || (record.revision as number) < 1 || typeof record.truncated !== 'boolean') {
    throw new Error('inspector protocol: invalid Cordis runtime realm header')
  }
  /**
   * 常量说明：root 用于处理 root 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const root = parseNode(record.root, { fiberUids: new Set() }, 0)
  if (root.kind !== 'context') throw new Error('inspector protocol: Cordis runtime root must be a Context')
  return {
    source: {
      sourceId: wireId<'CordisRuntimeSourceId'>(source.sourceId, 'sourceId'),
      kind,
      label: source.label,
    },
    connection: parseConnection(record.connection),
    revision: record.revision as number,
    truncated: record.truncated,
    root,
  }
}

/**
 * Project an inspected source id into the consumer-visible Cordis identity namespace.
 * @param value - Stable source id carried by the current runtime observation.
 * @returns The corresponding Cordis runtime source id.
 * @remarks 中文说明：功能说明：处理 cordisRuntimeSourceId 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：CordisRuntimeSourceId；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * cordisRuntimeSourceId(value)，并按返回类型处理结果。
 */
export function cordisRuntimeSourceId(value: string): CordisRuntimeSourceId {
  return inspectorId<'CordisRuntimeSourceId'>(value, 'sourceId')
}

/**
 * 功能说明：解析 Connection 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns CordisRuntimeConnection；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 parseConnection(value)，并按返回类型处理结果。
 */
function parseConnection(value: unknown): CordisRuntimeConnection {
  if (!isPlainObject(value)) throw new Error('inspector protocol: Cordis runtime connection must be an object')
  if (value.state === 'connected') {
    exactKeys(value, ['state'], 'connected Cordis runtime connection')
    return { state: 'connected' }
  }
  if (value.state === 'disconnected' && typeof value.reason === 'string') {
    exactKeys(value, ['state', 'reason'], 'disconnected Cordis runtime connection')
    return { state: 'disconnected', reason: value.reason }
  }
  throw new Error('inspector protocol: invalid Cordis runtime connection')
}

interface ParseState {
  readonly fiberUids: Set<number>
}

/**
 * 功能说明：解析 Node 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param state （ParseState）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param depth （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns CordisRuntimeNode；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 parseNode(value, state, depth)，并按返回类型处理结果。
 */
function parseNode(value: unknown, state: ParseState, depth: number): CordisRuntimeNode {
  if (depth > CORDIS_TREE_MAX_DEPTH) throw new Error('inspector protocol: Cordis runtime tree exceeds the depth limit')
  if (!isPlainObject(value) || (value.kind !== 'context' && value.kind !== 'fiber')) {
    throw new Error('inspector protocol: Cordis runtime node must have a known kind')
  }
  /**
   * 常量说明：record 用于处理 record 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const record = exactObject(value, value.kind === 'fiber'
    ? ['kind', 'uid', 'children']
    : ['kind', 'children'], 'Cordis runtime node')
  if (!Array.isArray(record.children)) throw new Error('inspector protocol: Cordis runtime node children must be an array')
  if (record.kind === 'context') {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：child（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(child)，并按返回类型处理结果。
     */
    return { kind: 'context', children: record.children.map(child => parseNode(child, state, depth + 1)) }
  }
  if (!Number.isSafeInteger(record.uid)
    || (record.uid as number) < 1
    || record.children.length !== 1) {
    throw new Error('inspector protocol: invalid Cordis runtime Fiber')
  }
  /**
   * 常量说明：uid 用于处理 uid 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const uid = record.uid as number
  if (state.fiberUids.has(uid)) throw new Error('inspector protocol: Cordis runtime tree repeats a Fiber uid')
  state.fiberUids.add(uid)
  /**
   * 常量说明：context 用于处理 context 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const context = parseNode(record.children[0], state, depth + 1)
  if (context.kind !== 'context') throw new Error('inspector protocol: Cordis runtime Fiber child must be a Context')
  return { kind: 'fiber', uid, children: [context] }
}
