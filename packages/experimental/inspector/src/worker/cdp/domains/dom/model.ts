/** Worker projection from Cordis snapshots to a connection-neutral semantic DOM.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 model 模块的职责，并向相邻模块提供可复用能力。
 * ；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { CordisTreeNode } from '../../../../shared/cordis/snapshot.ts'
import type { InspectorSourceDescriptor } from '../../../../shared/bridge/messages/observation.ts'
import type { InspectorObjectReference } from '../../../../shared/cordis/object-reference.ts'
import type { InspectorRealmDescriptor } from '../../../inspection/realm.ts'
import { cdpNumericId, type CdpBackendNodeId } from '../../ids.ts'
import type {
  CordisTreeObjectRoute,
  CordisTreeSourceSnapshot,
  CordisTreeStore,
} from '../../../inspection/cordis-store.ts'

/** One Worker-global backend node independent of any DevTools connection. */
export interface CordisDomNode {
  readonly backendNodeId: CdpBackendNodeId
  readonly key: string
  readonly name: string
  readonly attributes: readonly (readonly [string, string])[]
  readonly description: string
  readonly object?: CordisTreeObjectRoute
  readonly children: readonly CordisDomNode[]
}

/** Immutable document revision shared by all current DevTools sessions. */
export interface CordisDomDocument {
  readonly revision: number
  readonly root: CordisDomNode
  readonly byBackendId: ReadonlyMap<CdpBackendNodeId, CordisDomNode>
  readonly parentByBackendId: ReadonlyMap<CdpBackendNodeId, CdpBackendNodeId>
}

/** One structural or attribute mutation between two projected documents. */
export type CordisDomMutation =
  | { readonly type: 'document-updated' }
  | {
    readonly type: 'child-inserted'
    readonly parentBackendNodeId: CdpBackendNodeId
    readonly previousBackendNodeId: CdpBackendNodeId | 0
    readonly node: CordisDomNode
  }
  | {
    readonly type: 'child-removed'
    readonly parentBackendNodeId: CdpBackendNodeId
    readonly node: CordisDomNode
  }
  | {
    readonly type: 'children-replaced'
    readonly parentBackendNodeId: CdpBackendNodeId
    readonly children: readonly CordisDomNode[]
  }
  | {
    readonly type: 'attribute-modified'
    readonly backendNodeId: CdpBackendNodeId
    readonly name: string
    readonly value: string
  }
  | {
    readonly type: 'attribute-removed'
    readonly backendNodeId: CdpBackendNodeId
    readonly name: string
  }

/** A visible incremental mutation or an in-place source availability change. */
export type CordisDomChange =
  | { readonly type: 'tree-mutated'; readonly mutations: readonly CordisDomMutation[] }
  | { readonly type: 'source-disconnected'; readonly source: InspectorSourceDescriptor }

/** Assigns durable backend ids and projects the latest source snapshots.
 * @remarks 中文说明：类说明：CordisDomBackend 用于集中封装 处理 CordisDomBackend 相关状态与行为。；
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由 experimental/inspector
 * 在对应插件或业务生命周期内创建和调用。 */
export class CordisDomBackend {
  /**
   * 常量说明：backendIdByKey 用于处理 backendIdByKey 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly backendIdByKey = new Map<string, CdpBackendNodeId>()
  /**
   * 常量说明：listeners 用于处理 listeners 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly listeners = new Set<(event: CordisDomChange) => void>()
  /**
   * 变量说明：documentValue 用于处理 documentValue 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private documentValue: CordisDomDocument
  /**
   * 变量说明：nextBackendNodeId 用于处理 nextBackendNodeId 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private nextBackendNodeId = 1
  /**
   * 变量说明：nextRevision 用于处理 nextRevision 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private nextRevision = 1
  /**
   * 常量说明：unsubscribe 用于处理 unsubscribe 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly unsubscribe: () => void
  /**
   * 常量说明：nodeByObject 用于处理 nodeByObject 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly nodeByObject = new Map<string, CordisDomNode>()

  /**
   * 功能说明：处理 CordisDomBackend 相关流程；使用场景由所在模块及调用位置决定。
   * @param trees （CordisTreeStore）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new CordisDomBackend(trees) 创建实例，并在所属生命周期内使用。
   */
  constructor(private readonly trees: CordisTreeStore) {
    this.documentValue = this.build()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
     * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
     */
    this.unsubscribe = trees.subscribe((event) => {
      /**
       * 常量说明：previous 用于处理 previous 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const previous = this.documentValue
      this.documentValue = this.build()
      if (event.type === 'source-disconnected') this.emit({ type: 'source-disconnected', source: event.source })
      /**
       * 常量说明：mutations 用于处理 mutations 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const mutations = diffDocument(previous, this.documentValue)
      if (mutations.length > 0) this.emit({ type: 'tree-mutated', mutations })
    })
  }

  /**
   * Read the latest connection-neutral semantic document.
   * @returns The current immutable document revision.
   * @remarks 中文说明：功能说明：处理 document 相关流程；使用场景由所在模块及调用位置决定。；
   * 返回值：CordisDomDocument；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * document()，并按返回类型处理结果。
   */
  document(): CordisDomDocument {
    return this.documentValue
  }

  /**
   * Subscribe to full document replacements and in-place realm state changes.
   * @param listener - Called after a new backend revision is installed.
   * @returns A disposer removing the listener.
   * @remarks 中文说明：功能说明：处理 subscribe 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：listener（(event: CordisDomChange) => void）：接收后续状态或事件并执行调用方逻辑；
   * 必须满足声明的类型及调用时序要求。；返回值：() => void；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 subscribe(listener)，并按返回类型处理结果。
   */
  subscribe(listener: (event: CordisDomChange) => void): () => void {
    this.listeners.add(listener)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    return () => { this.listeners.delete(listener) }
  }

  /** Release repository subscriptions at Worker shutdown.
   * @remarks 中文说明：功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 close()，并按返回类型处理结果。 */
  close(): void {
    this.unsubscribe()
    this.listeners.clear()
  }

  /**
   * Resolve one source-local object reference to its current projected node.
   * @param source - Connected source generation that owns the reference.
   * @param reference - Realm-local registry and object handle.
   * @returns The current projected node, when present.
   * @remarks 中文说明：功能说明：处理 nodeForObject 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：source（InspectorSourceDescriptor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：reference（InspectorObjectReference）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：CordisDomNode | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 nodeForObject(source, reference)，并按返回类型处理结果。
   */
  nodeForObject(source: InspectorSourceDescriptor, reference: InspectorObjectReference): CordisDomNode | undefined {
    return this.nodeByObject.get(objectKey(source, reference))
  }

  /**
   * Resolve a reference when a Runtime route identifies only Host or Client ownership.
   * @param kind - Host or Client ownership inferred by the Runtime adapter.
   * @param reference - Realm-local registry and object handle.
   * @returns The current projected node, when present.
   * @remarks 中文说明：功能说明：处理 nodeForObjectKind 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：kind（InspectorSourceDescriptor['kind']）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；参数说明：reference（InspectorObjectReference）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：CordisDomNode | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
   * ；使用示例：典型用法：在完成前置校验后调用 nodeForObjectKind(kind, reference)，并按返回类型处理结果。
   */
  nodeForObjectKind(kind: InspectorSourceDescriptor['kind'], reference: InspectorObjectReference): CordisDomNode | undefined {
    /**
     * 常量说明：route 用于处理 route 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const route = this.trees.resolveObjectInKind(kind, reference)
    return route === undefined ? undefined : this.nodeForObject(route.source, reference)
  }

  /**
   * Resolve one realm-neutral Runtime reference to its current projected node.
   * @param realm - Realm that exposed the Runtime object.
   * @param reference - Realm-local registry and object handle.
   * @returns The current projected node, when present.
   * @remarks 中文说明：功能说明：处理 nodeForRealm 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：realm（InspectorRealmDescriptor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：reference（InspectorObjectReference）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：CordisDomNode | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 nodeForRealm(realm, reference)，并按返回类型处理结果。
   */
  nodeForRealm(realm: InspectorRealmDescriptor, reference: InspectorObjectReference): CordisDomNode | undefined {
    if (realm.kind === 'host') return this.nodeForObjectKind('host', reference)
    /**
     * 常量说明：route 用于处理 route 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const route = this.trees.resolveObjectIdentity(realm.sourceId, realm.generation, reference)
    return route === undefined ? undefined : this.nodeForObject(route.source, reference)
  }

  /**
   * 功能说明：构建 build 相关流程；使用场景由所在模块及调用位置决定。
   * @returns CordisDomDocument；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 build()，并按返回类型处理结果。
   */
  private build(): CordisDomDocument {
    /**
     * 常量说明：byBackendId 用于处理 byBackendId 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const byBackendId = new Map<CdpBackendNodeId, CordisDomNode>()
    /**
     * 常量说明：parentByBackendId 用于处理 parentByBackendId 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const parentByBackendId = new Map<CdpBackendNodeId, CdpBackendNodeId>()
    this.nodeByObject.clear()
    /**
     * 常量说明：tree 用于处理 tree 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const tree = this.trees.tree()
    /**
     * 常量说明：root 用于处理 root 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const root = this.node('document', '#document', [], '#document')
    /**
     * 常量说明：host 用于处理 host 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const host = this.node('host', 'host', [], '<host>')
    if (tree.host !== null) host.children.push(this.entity(tree.host, tree.host.snapshot.root))
    /**
     * 常量说明：clients 用于处理 clients 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const clients = this.node('clients', 'clients', [], '<clients>')
    /**
     * 变量说明：clientTree 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const clientTree of tree.clients) {
      /**
       * 常量说明：client 用于处理 client 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const client = this.node(`client:${clientTree.source.sourceId}`, 'client', [], '<client>')
      client.children.push(this.entity(clientTree, clientTree.snapshot.root))
      clients.children.push(client)
    }
    root.children.push(host, clients)
    /**
     * 常量说明：retainedKeys 用于处理 retainedKeys 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const retainedKeys = new Set<string>()
    /**
     * 常量说明：freeze 用于处理 freeze 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：处理 freeze 相关流程；使用场景由所在模块及调用位置决定。
     * @param node （MutableDomNode）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @param parent （MutableDomNode）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns CordisDomNode；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 freeze(node, parent)，并按返回类型处理结果。
     */
    const freeze = (node: MutableDomNode, parent?: MutableDomNode): CordisDomNode => {
      /**
       * 常量说明：value 用于处理 value 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：child（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(child)，并按返回类型处理结果。
       */
      const value: CordisDomNode = { ...node, children: node.children.map(child => freeze(child, node)) }
      retainedKeys.add(value.key)
      byBackendId.set(value.backendNodeId, value)
      if (parent !== undefined) parentByBackendId.set(value.backendNodeId, parent.backendNodeId)
      if (value.object?.connection.state === 'connected') this.nodeByObject.set(objectKey(value.object.source, {
        registryId: value.object.snapshot.objectRegistryId,
        handle: value.object.node.objectHandle,
      }), value)
      return value
    }
    /**
     * 常量说明：frozenRoot 用于处理 frozenRoot 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const frozenRoot = freeze(root)
    /**
     * 变量说明：key 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const key of this.backendIdByKey.keys()) {
      if (!retainedKeys.has(key)) this.backendIdByKey.delete(key)
    }
    return { revision: this.nextRevision++, root: frozenRoot, byBackendId, parentByBackendId }
  }

  /**
   * 功能说明：处理 entity 相关流程；使用场景由所在模块及调用位置决定。
   * @param tree （CordisTreeSourceSnapshot）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param node （CordisTreeNode）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns MutableDomNode；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 entity(tree, node)，并按返回类型处理结果。
   */
  private entity(
    tree: CordisTreeSourceSnapshot,
    node: CordisTreeNode,
  ): MutableDomNode {
    /**
     * 常量说明：source、snapshot 用于处理 source、snapshot 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const { source, snapshot } = tree
    /**
     * 常量说明：key 用于处理 key 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const key = `entity:${objectKey(source, { registryId: snapshot.objectRegistryId, handle: node.objectHandle })}`
    /**
     * 常量说明：object 用于处理 object 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const object = { ...tree, node }
    /**
     * 常量说明：attributes 用于处理 attributes 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const attributes: readonly (readonly [string, string])[] = node.kind === 'fiber'
      ? [['uid', String(node.uid)]]
      : []
    /**
     * 常量说明：projected 用于处理 projected 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const projected = this.node(key, node.kind, attributes, elementDescription(node.kind, attributes), object)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：child（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(child)，并按返回类型处理结果。
     */
    projected.children.push(...node.children.map(child => this.entity(tree, child)))
    return projected
  }

  /**
   * 功能说明：处理 node 相关流程；使用场景由所在模块及调用位置决定。
   * @param key （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param name （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param attributes （readonly (readonly [string, string])[]）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @param description （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param object （CordisTreeObjectRoute）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns MutableDomNode；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 node(key, name, attributes, description, object)，
   * 并按返回类型处理结果。
   */
  private node(
    key: string,
    name: string,
    attributes: readonly (readonly [string, string])[],
    description: string,
    object?: CordisTreeObjectRoute,
  ): MutableDomNode {
    /**
     * 变量说明：backendNodeId 用于处理 backendNodeId 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let backendNodeId = this.backendIdByKey.get(key)
    if (backendNodeId === undefined) {
      backendNodeId = cdpNumericId<'CdpBackendNodeId'>(this.nextBackendNodeId++, 'backendNodeId')
      this.backendIdByKey.set(key, backendNodeId)
    }
    return { backendNodeId, key, name, attributes, description, ...(object === undefined ? {} : { object }), children: [] }
  }

  /**
   * 功能说明：发送 emit 相关流程；使用场景由所在模块及调用位置决定。
   * @param change （CordisDomChange）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 emit(change)，并按返回类型处理结果。
   */
  private emit(change: CordisDomChange): void {
    /**
     * 变量说明：listener 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const listener of [...this.listeners]) {
      try {
        listener(change)
      } catch {
        // One closed CDP connection cannot prevent sibling sessions from receiving the document mutation.
      }
    }
  }
}

interface MutableDomNode extends Omit<CordisDomNode, 'children'> {
  readonly children: MutableDomNode[]
}

/**
 * 功能说明：处理 elementDescription 相关流程；使用场景由所在模块及调用位置决定。
 * @param name （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param attributes （readonly (readonly [string, string])[]）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 elementDescription(name, attributes)，并按返回类型处理结果。
 */
function elementDescription(name: string, attributes: readonly (readonly [string, string])[]): string {
  /**
   * 常量说明：rendered 用于处理 rendered 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：[key, value]（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调([key, value])，并按返回类型处理结果。
   */
  const rendered = attributes.map(([key, value]) => value === '' ? key : `${key}=${JSON.stringify(value)}`).join(' ')
  return `<${name}${rendered === '' ? '' : ` ${rendered}`}>`
}

/**
 * 功能说明：处理 objectKey 相关流程；使用场景由所在模块及调用位置决定。
 * @param source （InspectorSourceDescriptor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param reference （InspectorObjectReference）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 objectKey(source, reference)，并按返回类型处理结果。
 */
function objectKey(source: InspectorSourceDescriptor, reference: InspectorObjectReference): string {
  return `${source.sourceId}\0${source.generation}\0${reference.registryId}\0${reference.handle}`
}

/**
 * 功能说明：处理 diffDocument 相关流程；使用场景由所在模块及调用位置决定。
 * @param previous （CordisDomDocument）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param current （CordisDomDocument）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns CordisDomMutation[]；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 diffDocument(previous, current)，并按返回类型处理结果。
 */
function diffDocument(previous: CordisDomDocument, current: CordisDomDocument): CordisDomMutation[] {
  /**
   * 常量说明：mutations 用于处理 mutations 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const mutations: CordisDomMutation[] = []
  return diffNode(previous.root, current.root, mutations)
    ? mutations
    : [{ type: 'document-updated' }]
}

/**
 * 功能说明：处理 diffNode 相关流程；使用场景由所在模块及调用位置决定。
 * @param previous （CordisDomNode）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param current （CordisDomNode）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param mutations （CordisDomMutation[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 diffNode(previous, current, mutations)，并按返回类型处理结果。
 */
function diffNode(previous: CordisDomNode, current: CordisDomNode, mutations: CordisDomMutation[]): boolean {
  if (previous.backendNodeId !== current.backendNodeId || previous.name !== current.name) {
    return false
  }
  /**
   * 常量说明：previousAttributes 用于处理 previousAttributes 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const previousAttributes = new Map(previous.attributes)
  /**
   * 常量说明：currentAttributes 用于处理 currentAttributes 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const currentAttributes = new Map(current.attributes)
  /**
   * 变量说明：name、value 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const [name, value] of currentAttributes) {
    if (previousAttributes.get(name) === value) continue
    mutations.push({ type: 'attribute-modified', backendNodeId: current.backendNodeId, name, value })
  }
  /**
   * 变量说明：name 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const [name] of previousAttributes) {
    if (!currentAttributes.has(name)) {
      mutations.push({ type: 'attribute-removed', backendNodeId: current.backendNodeId, name })
    }
  }

  /**
   * 常量说明：previousIds 用于处理 previousIds 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：child（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(child)，并按返回类型处理结果。
   */
  const previousIds = previous.children.map(child => child.backendNodeId)
  /**
   * 常量说明：currentIds 用于处理 currentIds 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：child（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(child)，并按返回类型处理结果。
   */
  const currentIds = current.children.map(child => child.backendNodeId)
  /**
   * 常量说明：previousSet 用于处理 previousSet 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const previousSet = new Set(previousIds)
  /**
   * 常量说明：currentSet 用于处理 currentSet 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const currentSet = new Set(currentIds)
  /**
   * 常量说明：retainedBefore 用于处理 retainedBefore 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：id（由 TypeScript
   * 根据调用位置推断的类型）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(id)，并按返回类型处理结果。
   */
  const retainedBefore = previousIds.filter(id => currentSet.has(id))
  /**
   * 常量说明：retainedAfter 用于处理 retainedAfter 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：id（由 TypeScript
   * 根据调用位置推断的类型）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(id)，并按返回类型处理结果。
   */
  const retainedAfter = currentIds.filter(id => previousSet.has(id))
  if (!sameIds(retainedBefore, retainedAfter)) {
    mutations.push({
      type: 'children-replaced',
      parentBackendNodeId: current.backendNodeId,
      children: current.children,
    })
    return true
  }
  /**
   * 变量说明：child 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const child of previous.children) {
    if (!currentSet.has(child.backendNodeId)) {
      mutations.push({ type: 'child-removed', parentBackendNodeId: current.backendNodeId, node: child })
    }
  }
  /**
   * 变量说明：index 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (let index = 0; index < current.children.length; index++) {
    /**
     * 常量说明：child 用于处理 child 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const child = current.children[index] as CordisDomNode
    if (previousSet.has(child.backendNodeId)) continue
    mutations.push({
      type: 'child-inserted',
      parentBackendNodeId: current.backendNodeId,
      previousBackendNodeId: index === 0 ? 0 : (current.children[index - 1] as CordisDomNode).backendNodeId,
      node: child,
    })
  }
  /**
   * 常量说明：previousById 用于处理 previousById 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：child（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(child)，并按返回类型处理结果。
   */
  const previousById = new Map(previous.children.map(child => [child.backendNodeId, child]))
  /**
   * 变量说明：child 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const child of current.children) {
    /**
     * 常量说明：prior 用于处理 prior 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const prior = previousById.get(child.backendNodeId)
    if (prior !== undefined && !diffNode(prior, child, mutations)) return false
  }
  return true
}

/**
 * 功能说明：处理 sameIds 相关流程；使用场景由所在模块及调用位置决定。
 * @param left （readonly CdpBackendNodeId[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param right （readonly CdpBackendNodeId[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 sameIds(left, right)，并按返回类型处理结果。
 */
function sameIds(left: readonly CdpBackendNodeId[], right: readonly CdpBackendNodeId[]): boolean {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：index（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(value, index)，并按返回类型处理结果。
   */
  return left.length === right.length && left.every((value, index) => value === right[index])
}
