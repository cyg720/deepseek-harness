/** Worker-owned repository of CDP-independent Cordis tree snapshots.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 cordis store 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import {
  parseCordisTreeSnapshot,
  type CordisTreeNode,
  type CordisTreeSnapshot,
} from '../../shared/cordis/snapshot.ts'
import { CORDIS_TREE_TOPIC } from '../../shared/bridge/messages/cordis.ts'
import type { InspectorSourceDescriptor } from '../../shared/bridge/messages/observation.ts'
import type { InspectorSourceGeneration, InspectorSourceId } from '../../shared/bridge/ids.ts'
import type { InspectorObjectReference } from '../../shared/cordis/object-reference.ts'
import {
  projectCordisRuntimeTree,
  type CordisInspectionTree as SharedCordisInspectionTree,
  type CordisTreeSourceSnapshot as SharedCordisTreeSourceSnapshot,
} from '../../shared/cordis/projector.ts'
import type { CordisRuntimeTree } from '../../shared/cordis/model.ts'
import type { IngestedInspectorRecord, InspectorRecordConsumer } from '../bridge/hub.ts'

/** Routed Worker snapshot retaining its complete source-generation descriptor. */
export type CordisTreeSourceSnapshot = SharedCordisTreeSourceSnapshot<InspectorSourceDescriptor>

/** Routed Host and Client snapshots retained by the Worker. */
export type CordisInspectionTree = SharedCordisInspectionTree<InspectorSourceDescriptor>

export type { CordisTreeSourceConnection } from '../../shared/cordis/projector.ts'

/** One object-backed tree node with its owning source generation. */
export interface CordisTreeObjectRoute extends CordisTreeSourceSnapshot {
  readonly node: CordisTreeNode
}

/** Store mutation consumed by presentation adapters. */
export type CordisTreeStoreEvent =
  | { readonly type: 'snapshot-changed'; readonly source: InspectorSourceDescriptor }
  | { readonly type: 'source-disconnected'; readonly source: InspectorSourceDescriptor }

/** Independent bounds for live tree size and retained disconnected snapshots. */
export interface CordisTreeStoreOptions {
  readonly maxNodes: number
  readonly maxDisconnectedTrees: number
}

interface StoredTree extends CordisTreeSourceSnapshot {
  readonly nodesByObject: ReadonlyMap<string, CordisTreeNode>
}

/** Validated latest-value store consumed independently by CDP and future query adapters.
 * @remarks 中文说明：类说明：CordisTreeStore 用于集中封装 处理 CordisTreeStore 相关状态与行为。；
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由 experimental/inspector
 * 在对应插件或业务生命周期内创建和调用。 */
export class CordisTreeStore implements InspectorRecordConsumer {
  /**
   * 常量说明：topics 用于处理 topics 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  readonly topics = new Set([CORDIS_TREE_TOPIC])
  /**
   * 常量说明：trees 用于处理 trees 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly trees = new Map<string, StoredTree>()
  /**
   * 常量说明：disconnected 用于处理 disconnected 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly disconnected = new Set<string>()
  /**
   * 常量说明：listeners 用于处理 listeners 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly listeners = new Set<(event: CordisTreeStoreEvent) => void>()

  /**
   * 功能说明：处理 CordisTreeStore 相关流程；使用场景由所在模块及调用位置决定。
   * @param options （CordisTreeStoreOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new CordisTreeStore(options) 创建实例，并在所属生命周期内使用。
   */
  constructor(private readonly options: CordisTreeStoreOptions) {}

  /** Replace all retained state for one source generation.
   * @remarks 中文说明：功能说明：处理 replace 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：source（InspectorSourceDescriptor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：records（readonly IngestedInspectorRecord[]）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 replace(source, records)，并按返回类型处理结果。 */
  replace(source: InspectorSourceDescriptor, records: readonly IngestedInspectorRecord[]): void {
    /**
     * 常量说明：next 用于处理 next 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const next = this.latest(source, records)
    /**
     * 常量说明：changed 用于处理 changed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const changed = next === undefined
      ? this.remove(source.sourceId)
      : this.install(source, next)
    if (changed) this.emit({ type: 'snapshot-changed', source })
  }

  /** Apply later state replacements, ignoring unrelated observation topics.
   * @remarks 中文说明：功能说明：处理 append 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：source（InspectorSourceDescriptor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：records（readonly IngestedInspectorRecord[]）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 append(source, records)，并按返回类型处理结果。 */
  append(source: InspectorSourceDescriptor, records: readonly IngestedInspectorRecord[]): void {
    /**
     * 常量说明：next 用于处理 next 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const next = this.latest(source, records)
    if (next !== undefined && this.install(source, next)) this.emit({ type: 'snapshot-changed', source })
  }

  /** Freeze a closed source generation's last tree and invalidate its object routes.
   * @remarks 中文说明：功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：source（InspectorSourceDescriptor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：reason（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 close(source, reason)，并按返回类型处理结果。 */
  close(source: InspectorSourceDescriptor, reason: string): void {
    /**
     * 常量说明：current 用于处理 current 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const current = this.trees.get(source.sourceId)
    if (current?.source.generation !== source.generation || current.connection.state === 'disconnected') return
    this.trees.set(source.sourceId, {
      ...current,
      connection: { state: 'disconnected', reason },
    })
    this.disconnected.delete(source.sourceId)
    this.disconnected.add(source.sourceId)
    while (this.disconnected.size > this.options.maxDisconnectedTrees) {
      /**
       * 常量说明：oldest 用于处理 oldest 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const oldest = this.disconnected.values().next().value
      if (oldest === undefined) break
      this.remove(oldest)
    }
    this.emit({ type: 'source-disconnected', source })
  }

  /**
   * Read all current realm snapshots without CDP identifiers.
   * @returns Snapshots in source admission order.
   * @remarks 中文说明：功能说明：处理 snapshots 相关流程；使用场景由所在模块及调用位置决定。；
   * 返回值：CordisTreeSourceSnapshot[]；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 snapshots()，并按返回类型处理结果。
   */
  snapshots(): CordisTreeSourceSnapshot[] {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：{ source, snapshot, connection
     * }（由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由
     * TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调({
     * source, snapshot,…)，并按返回类型处理结果。
     */
    return [...this.trees.values()].map(({ source, snapshot, connection }) => ({ source, snapshot, connection }))
  }

  /**
   * Compose the common realm model into Host and Client slots.
   * @returns A detached view whose Host and Client entries share one type.
   * @remarks 中文说明：功能说明：处理 tree 相关流程；使用场景由所在模块及调用位置决定。；
   * 返回值：CordisInspectionTree；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * tree()，并按返回类型处理结果。
   */
  tree(): CordisInspectionTree {
    /**
     * 常量说明：snapshots 用于处理 snapshots 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const snapshots = this.snapshots()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：tree（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(tree)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：tree（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(tree)，并按返回类型处理结果。
     */
    return {
      host: snapshots.find(tree => tree.source.kind === 'host') ?? null,
      clients: snapshots.filter(tree => tree.source.kind === 'client'),
    }
  }

  /**
   * Read a detached semantic tree without object-routing or CDP identifiers.
   * @returns The latest retained Host and Client topology.
   * @remarks 中文说明：功能说明：读取 Tree 相关流程；使用场景由所在模块及调用位置决定。；返回值：CordisRuntimeTree；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 readTree()，并按返回类型处理结果。
   */
  readTree(): CordisRuntimeTree {
    return projectCordisRuntimeTree(this.tree())
  }

  /**
   * Resolve a source-local object reference to its semantic tree node.
   * @param source - Active source generation.
   * @param reference - Realm-local registry and object handle.
   * @returns The matching node while its source remains connected.
   * @remarks 中文说明：功能说明：解析 Object 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：source（InspectorSourceDescriptor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：reference（InspectorObjectReference）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：CordisTreeObjectRoute | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 resolveObject(source, reference)，并按返回类型处理结果。
   */
  resolveObject(source: InspectorSourceDescriptor, reference: InspectorObjectReference): CordisTreeObjectRoute | undefined {
    /**
     * 常量说明：tree 用于处理 tree 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const tree = this.trees.get(source.sourceId)
    if (tree === undefined
      || tree.source.generation !== source.generation
      || tree.connection.state === 'disconnected') return undefined
    /**
     * 常量说明：node 用于处理 node 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const node = tree.nodesByObject.get(objectKey(reference))
    return node === undefined ? undefined : this.route(tree, node)
  }

  /**
   * Resolve a source-local object without requiring the source's presentation fields.
   * @param sourceId - Logical source identity.
   * @param generation - Active source generation.
   * @param reference - Realm-local object reference.
   * @returns The matching live tree node.
   * @remarks 中文说明：功能说明：解析 Object Identity 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：sourceId（InspectorSourceId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：generation（InspectorSourceGeneration）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：reference（InspectorObjectReference）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：CordisTreeObjectRoute | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 resolveObjectIdentity(sourceId, generation,
   * reference)，并按返回类型处理结果。
   */
  resolveObjectIdentity(
    sourceId: InspectorSourceId,
    generation: InspectorSourceGeneration,
    reference: InspectorObjectReference,
  ): CordisTreeObjectRoute | undefined {
    /**
     * 常量说明：tree 用于处理 tree 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const tree = this.trees.get(sourceId)
    if (tree === undefined || tree.source.generation !== generation || tree.connection.state === 'disconnected') {
      return undefined
    }
    /**
     * 常量说明：node 用于处理 node 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const node = tree.nodesByObject.get(objectKey(reference))
    return node === undefined ? undefined : this.route(tree, node)
  }

  /**
   * Resolve a live reference when only its source realm kind is known.
   * @param kind - Host or Client ownership inferred by the Runtime adapter.
   * @param reference - Realm-local registry and object handle.
   * @returns The matching connected node, when present.
   * @remarks 中文说明：功能说明：解析 Object In Kind 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：kind（InspectorSourceDescriptor['kind']）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；参数说明：reference（InspectorObjectReference）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：CordisTreeObjectRoute | undefined；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 resolveObjectInKind(kind, reference)，
   * 并按返回类型处理结果。
   */
  resolveObjectInKind(kind: InspectorSourceDescriptor['kind'], reference: InspectorObjectReference): CordisTreeObjectRoute | undefined {
    /**
     * 变量说明：tree 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const tree of this.trees.values()) {
      if (tree.source.kind !== kind || tree.connection.state === 'disconnected') continue
      /**
       * 常量说明：node 用于处理 node 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const node = tree.nodesByObject.get(objectKey(reference))
      if (node !== undefined) return this.route(tree, node)
    }
    return undefined
  }

  /**
   * Subscribe to accepted tree replacements and source availability changes.
   * @param listener - Repository observer.
   * @returns A disposer removing the observer.
   * @remarks 中文说明：功能说明：处理 subscribe 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：listener（(event: CordisTreeStoreEvent) => void）：接收后续状态或事件并执行调用方逻辑；
   * 必须满足声明的类型及调用时序要求。；返回值：() => void；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 subscribe(listener)，并按返回类型处理结果。
   */
  subscribe(listener: (event: CordisTreeStoreEvent) => void): () => void {
    this.listeners.add(listener)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    return () => { this.listeners.delete(listener) }
  }

  /**
   * 功能说明：处理 latest 相关流程；使用场景由所在模块及调用位置决定。
   * @param source （InspectorSourceDescriptor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param records （readonly IngestedInspectorRecord[]）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @returns CordisTreeSnapshot | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 latest(source, records)，并按返回类型处理结果。
   */
  private latest(
    source: InspectorSourceDescriptor,
    records: readonly IngestedInspectorRecord[],
  ): CordisTreeSnapshot | undefined {
    /**
     * 变量说明：snapshot 用于处理 snapshot 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let snapshot: CordisTreeSnapshot | undefined
    /**
     * 变量说明：record 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const record of records) {
      if (record.topic !== CORDIS_TREE_TOPIC) continue
      /**
       * 常量说明：candidate 用于处理 candidate 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const candidate = parseCordisTreeSnapshot(record.payload, this.options.maxNodes)
      if (snapshot === undefined || candidate.revision > snapshot.revision) snapshot = candidate
    }
    if (snapshot === undefined) return undefined
    /**
     * 常量说明：current 用于处理 current 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const current = this.trees.get(source.sourceId)
    if (current?.source.generation === source.generation && current.snapshot.revision >= snapshot.revision) {
      return current.snapshot
    }
    return snapshot
  }

  /**
   * 功能说明：处理 install 相关流程；使用场景由所在模块及调用位置决定。
   * @param source （InspectorSourceDescriptor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param snapshot （CordisTreeSnapshot）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 install(source, snapshot)，并按返回类型处理结果。
   */
  private install(source: InspectorSourceDescriptor, snapshot: CordisTreeSnapshot): boolean {
    /**
     * 常量说明：current 用于处理 current 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const current = this.trees.get(source.sourceId)
    if (current?.source.generation === source.generation
      && current.snapshot === snapshot
      && current.connection.state === 'connected') return false
    this.disconnected.delete(source.sourceId)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：node（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(node)，并按返回类型处理结果。
     */
    this.trees.set(source.sourceId, {
      source,
      snapshot,
      connection: { state: 'connected' },
      nodesByObject: new Map(treeNodes(snapshot.root).map(node => [objectKey({
        registryId: snapshot.objectRegistryId,
        handle: node.objectHandle,
      }), node])),
    })
    return true
  }

  /**
   * 功能说明：移除 remove 相关流程；使用场景由所在模块及调用位置决定。
   * @param sourceId （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 remove(sourceId)，并按返回类型处理结果。
   */
  private remove(sourceId: string): boolean {
    this.disconnected.delete(sourceId)
    return this.trees.delete(sourceId)
  }

  /**
   * 功能说明：处理 route 相关流程；使用场景由所在模块及调用位置决定。
   * @param tree （StoredTree）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param node （CordisTreeNode）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns CordisTreeObjectRoute；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 route(tree, node)，并按返回类型处理结果。
   */
  private route(tree: StoredTree, node: CordisTreeNode): CordisTreeObjectRoute {
    return { source: tree.source, snapshot: tree.snapshot, connection: tree.connection, node }
  }

  /**
   * 功能说明：发送 emit 相关流程；使用场景由所在模块及调用位置决定。
   * @param event （CordisTreeStoreEvent）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 emit(event)，并按返回类型处理结果。
   */
  private emit(event: CordisTreeStoreEvent): void {
    /**
     * 变量说明：listener 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const listener of [...this.listeners]) {
      try {
        listener(event)
      } catch {
        // One query adapter cannot prevent later repository observers from updating.
      }
    }
  }
}

/**
 * 功能说明：处理 objectKey 相关流程；使用场景由所在模块及调用位置决定。
 * @param reference （InspectorObjectReference）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 objectKey(reference)，并按返回类型处理结果。
 */
function objectKey(reference: InspectorObjectReference): string {
  return `${reference.registryId}\0${reference.handle}`
}

/**
 * 功能说明：处理 treeNodes 相关流程；使用场景由所在模块及调用位置决定。
 * @param root （CordisTreeNode）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns CordisTreeNode[]；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 treeNodes(root)，并按返回类型处理结果。
 */
function treeNodes(root: CordisTreeNode): CordisTreeNode[] {
  /**
   * 常量说明：nodes 用于处理 nodes 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const nodes: CordisTreeNode[] = []
  /**
   * 常量说明：pending 用于处理 pending 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const pending: CordisTreeNode[] = [root]
  while (pending.length > 0) {
    /**
     * 常量说明：node 用于处理 node 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const node = pending.pop()
    if (node === undefined) break
    nodes.push(node)
    pending.push(...node.children.toReversed())
  }
  return nodes
}
