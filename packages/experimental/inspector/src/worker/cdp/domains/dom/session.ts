/** Per-DevTools-session read-only DOM projection over Cordis tree snapshots.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 session 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import { realmObjectExpression } from '../../../../shared/cordis/object-registry.ts'
import type { InspectorSourceDescriptor } from '../../../../shared/bridge/messages/observation.ts'
import type { InspectorObjectReference } from '../../../../shared/cordis/object-reference.ts'
import { respondToCdpRequest, type CdpRequest, type CdpTransport } from '../../protocol.ts'
import type { InspectorRealmDescriptor } from '../../../inspection/realm.ts'
import type { RuntimeDomainSession } from '../runtime/index.ts'
import type { RuntimeObjectPresentation } from '../runtime/object-table.ts'
import type { CordisDomBackend, CordisDomChange, CordisDomMutation, CordisDomNode } from './model.ts'
import {
  cdpNumericId,
  cdpStringId,
  type CdpBackendNodeId,
  type CdpNodeId,
  type CdpRemoteObjectId,
} from '../../ids.ts'

/**
 * 常量说明：READ_ONLY_METHODS 用于读取 ONLY METHODS 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const READ_ONLY_METHODS = new Set([
  'DOM.setAttributeValue', 'DOM.setAttributesAsText', 'DOM.setNodeName', 'DOM.setNodeValue',
  'DOM.setOuterHTML', 'DOM.removeNode', 'DOM.moveTo', 'DOM.copyTo',
])

/**
 * Children levels `DOM.getDocument` serves when the caller omits `depth`;
 * deeper levels arrive through `DOM.requestChildNodes` on expand.
 * @remarks 中文说明：常量说明：DEFAULT_DOCUMENT_DEPTH 用于处理 DEFAULT_DOCUMENT_DEPTH
 * 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const DEFAULT_DOCUMENT_DEPTH = 3

interface BoundDomObject {
  readonly backendNodeId: CdpBackendNodeId
  readonly sourceId: string
  readonly generation: string
}

/**
 * Connection-local NodeId, search, and RemoteObject mapping owner. Node payloads are depth-limited;
 * withheld levels are fetched through `DOM.requestChildNodes` or pushed with the ancestor chain
 * when a NodeId leaves through search or object lookup.
 * @remarks 中文说明：类说明：CordisDomSession 用于集中封装 处理 CordisDomSession 相关状态与行为。；
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由 experimental/inspector
 * 在对应插件或业务生命周期内创建和调用。
 */
export class CordisDomSession {
  /**
   * 常量说明：nodeIdByBackend 用于处理 nodeIdByBackend 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly nodeIdByBackend = new Map<CdpBackendNodeId, CdpNodeId>()
  /**
   * 常量说明：backendByNodeId 用于处理 backendByNodeId 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly backendByNodeId = new Map<CdpNodeId, CdpBackendNodeId>()
  /**
   * 常量说明：childrenSent 用于处理 childrenSent 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly childrenSent = new Set<CdpBackendNodeId>()
  /**
   * 常量说明：backendByObjectId 用于处理 backendByObjectId 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly backendByObjectId = new Map<CdpRemoteObjectId, BoundDomObject>()
  /**
   * 常量说明：objectIdsByGroup 用于处理 objectIdsByGroup 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly objectIdsByGroup = new Map<string, Set<CdpRemoteObjectId>>()
  /**
   * 常量说明：searches 用于处理 searches 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly searches = new Map<string, CdpNodeId[]>()
  /**
   * 常量说明：unsubscribe 用于处理 unsubscribe 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly unsubscribe: () => void
  /**
   * 变量说明：nextNodeId 用于处理 nextNodeId 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private nextNodeId = 1
  /**
   * 变量说明：nextSearchId 用于处理 nextSearchId 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private nextSearchId = 1
  /**
   * 变量说明：enabled 用于处理 enabled 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private enabled = false

  /**
   * 功能说明：处理 CordisDomSession 相关流程；使用场景由所在模块及调用位置决定。
   * @param transport （CdpTransport）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param backend （CordisDomBackend）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param runtime （RuntimeDomainSession）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new CordisDomSession(transport, backend, runtime) 创建实例，
   * 并在所属生命周期内使用。
   */
  constructor(
    private readonly transport: CdpTransport,
    private readonly backend: CordisDomBackend,
    private readonly runtime: RuntimeDomainSession,
  ) {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
     * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
     */
    this.unsubscribe = backend.subscribe((event) => { this.updateDocument(event) })
  }

  /**
   * Handle one DOM command.
   * @param request - Parsed CDP request.
   * @returns Whether this adapter owns the method.
   * @remarks 中文说明：功能说明：处理 handle 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：request（CdpRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；返回值：boolean；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 handle(request)，
   * 并按返回类型处理结果。
   */
  handle(request: CdpRequest): boolean {
    if (!request.method.startsWith('DOM.')) return false
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    this.respond(request, async () => this.execute(request.method, request.params))
    return true
  }

  /**
   * Forget a Runtime object mapping before its owner releases the object.
   * @param objectId - Connection-local Runtime object id.
   * @remarks 中文说明：功能说明：处理 releaseObject 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：objectId（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 releaseObject(objectId)，
   * 并按返回类型处理结果。
   */
  releaseObject(objectId: unknown): void {
    if (typeof objectId !== 'string') return
    /**
     * 常量说明：id 用于处理 id 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const id = cdpStringId<'CdpRemoteObjectId'>(objectId, 'objectId')
    this.backendByObjectId.delete(id)
    /**
     * 变量说明：ids 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const ids of this.objectIdsByGroup.values()) ids.delete(id)
  }

  /**
   * Recognize a Runtime object from any realm as one current Cordis node.
   * @param objectId - Connection-local CDP object id.
   * @param realm - Realm that exposed the object.
   * @param reference - Realm-local semantic object identity.
   * @param group - Runtime object group retaining the id.
   * @returns Node presentation fields, when the object remains in the current tree.
   * @remarks 中文说明：功能说明：处理 bindObject 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：objectId（CdpRemoteObjectId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：realm（InspectorRealmDescriptor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：reference（InspectorObjectReference）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：group（string | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：RuntimeObjectPresentation | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 bindObject(objectId, realm, reference, group)，
   * 并按返回类型处理结果。
   */
  bindObject(
    objectId: CdpRemoteObjectId,
    realm: InspectorRealmDescriptor,
    reference: InspectorObjectReference,
    group: string | undefined,
  ): RuntimeObjectPresentation | undefined {
    /**
     * 常量说明：node 用于处理 node 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const node = this.backend.nodeForRealm(realm, reference)
    if (node === undefined) return undefined
    this.bindObjectId(objectId, node, group)
    return presentation(node)
  }

  /**
   * Forget every DOM mapping retained under one Runtime object group.
   * @param group - Runtime object-group name.
   * @remarks 中文说明：功能说明：处理 releaseObjectGroup 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：group（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 releaseObjectGroup(group)，并按返回类型处理结果。
   */
  releaseObjectGroup(group: unknown): void {
    if (typeof group !== 'string') return
    /**
     * 变量说明：objectId 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const objectId of this.objectIdsByGroup.get(group) ?? []) this.backendByObjectId.delete(objectId)
    this.objectIdsByGroup.delete(group)
  }

  /** Release connection-owned ids and subscriptions.
   * @remarks 中文说明：功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 close()，并按返回类型处理结果。 */
  close(): void {
    this.unsubscribe()
    this.resetDocument()
    this.searches.clear()
  }

  /**
   * 功能说明：执行 execute 相关流程；使用场景由所在模块及调用位置决定。
   * @param method （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param params （Readonly<Record<string, unknown>>）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @returns Promise<object>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 execute(method, params)，并按返回类型处理结果。
   */
  private async execute(method: string, params: Readonly<Record<string, unknown>>): Promise<object> {
    if (READ_ONLY_METHODS.has(method)) throw new Error('Cordis DOM projection is read-only')
    switch (method) {
      case 'DOM.enable':
        this.enabled = true
        return {}
      case 'DOM.disable':
        this.enabled = false
        this.resetDocument()
        return {}
      case 'DOM.getDocument':
        this.enabled = true
        return { root: this.serialize(this.backend.document().root, 0, depthParam(params.depth, DEFAULT_DOCUMENT_DEPTH), true) }
      case 'DOM.requestChildNodes': {
        /**
         * 常量说明：node 用于处理 node 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const node = this.fromNodeId(params.nodeId)
        /**
         * 常量说明：depth 用于处理 depth 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const depth = depthParam(params.depth, 1)
        this.childrenSent.add(node.backendNodeId)
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：child（由 TypeScript
         * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(child)，并按返回类型处理结果。
         */
        this.transport.send({
          method: 'DOM.setChildNodes',
          params: {
            parentId: numberParam(params.nodeId, 'nodeId'),
            nodes: node.children.map(child => this.serialize(child, this.nodeId(node), depth - 1, true)),
          },
        })
        return {}
      }
      case 'DOM.describeNode': {
        /**
         * 常量说明：node 用于处理 node 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const node = this.selectNode(params)
        return { node: this.serialize(node, this.parentNodeId(node), depthParam(params.depth, 1), false) }
      }
      case 'DOM.getAttributes':
        return { attributes: this.fromNodeId(params.nodeId).attributes.flat() }
      case 'DOM.getOuterHTML':
        return { outerHTML: outerHtml(this.selectNode(params)) }
      case 'DOM.pushNodesByBackendIdsToFrontend': {
        if (!Array.isArray(params.backendNodeIds)) throw new Error('backendNodeIds must be an array')
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（由 TypeScript
         * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(value)，并按返回类型处理结果。
         */
        return {
          nodeIds: params.backendNodeIds.map((value) => {
            if (!Number.isSafeInteger(value) || (value as number) < 1) return 0
            /**
             * 常量说明：node 用于处理 node 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
             */
            const node = this.backend.document().byBackendId.get(cdpBackendNodeId(value, 'backendNodeId'))
            if (node === undefined) return 0
            this.pushNodePath(node)
            return this.nodeId(node)
          }),
        }
      }
      case 'DOM.resolveNode':
        return { object: await this.resolveNode(this.selectNode(params), optionalString(params.objectGroup)) }
      case 'DOM.requestNode': {
        /**
         * 常量说明：objectId 用于处理 objectId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const objectId = cdpStringId<'CdpRemoteObjectId'>(stringParam(params.objectId, 'objectId'), 'objectId')
        /**
         * 常量说明：binding 用于处理 binding 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const binding = this.backendByObjectId.get(objectId)
        if (binding === undefined) throw new Error('RemoteObject is not a current Cordis node')
        /**
         * 常量说明：node 用于处理 node 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const node = this.backend.document().byBackendId.get(binding.backendNodeId)
        if (node === undefined) throw new Error('Cordis node is no longer available')
        this.pushNodePath(node)
        return { nodeId: this.nodeId(node) }
      }
      case 'DOM.performSearch': {
        /**
         * 常量说明：query 用于处理 query 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const query = stringParam(params.query, 'query').toLowerCase()
        /**
         * 常量说明：nodes 用于处理 nodes 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：node（由 TypeScript
         * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(node)，并按返回类型处理结果。
         */
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：node（由 TypeScript
         * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(node)，并按返回类型处理结果。
         */
        const nodes = [...this.backend.document().byBackendId.values()]
          .filter(node => node.name !== '#document' && searchable(node).includes(query))
          .map(node => this.nodeId(node))
        /**
         * 常量说明：searchId 用于处理 searchId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const searchId = `cordis-search-${String(this.nextSearchId++)}`
        this.searches.set(searchId, nodes)
        return { searchId, resultCount: nodes.length }
      }
      case 'DOM.getSearchResults': {
        /**
         * 常量说明：ids 用于处理 ids 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const ids = this.searches.get(stringParam(params.searchId, 'searchId')) ?? []
        /**
         * 常量说明：nodeIds 用于处理 nodeIds 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const nodeIds = ids.slice(nonNegativeInteger(params.fromIndex, 'fromIndex'), nonNegativeInteger(params.toIndex, 'toIndex'))
        /**
         * 变量说明：nodeId 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
         */
        for (const nodeId of nodeIds) {
          /**
           * 常量说明：backendId 用于处理 backendId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
           */
          const backendId = this.backendByNodeId.get(nodeId)
          /**
           * 常量说明：node 用于处理 node 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
           */
          const node = backendId === undefined ? undefined : this.backend.document().byBackendId.get(backendId)
          if (node !== undefined) this.pushNodePath(node)
        }
        return { nodeIds }
      }
      case 'DOM.discardSearchResults':
        this.searches.delete(stringParam(params.searchId, 'searchId'))
        return {}
      case 'DOM.setInspectedNode':
        this.fromNodeId(params.nodeId)
        return {}
      case 'DOM.getBoxModel':
      case 'DOM.getNodeForLocation':
        throw new Error('Cordis semantic nodes do not have browser layout geometry')
      default:
        throw new Error(`Method not found: ${method}`)
    }
  }

  /**
   * 功能说明：解析 Node 相关流程；使用场景由所在模块及调用位置决定。
   * @param node （CordisDomNode）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param objectGroup （string | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<Readonly<Record<string, unknown>>>；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 resolveNode(node, objectGroup)，并按返回类型处理结果。
   */
  private async resolveNode(node: CordisDomNode, objectGroup: string | undefined): Promise<Readonly<Record<string, unknown>>> {
    /**
     * 常量说明：route 用于处理 route 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const route = node.object
    if (route === undefined) throw new Error('Structural Cordis node has no live Runtime object')
    if (route.connection.state === 'disconnected') throw new Error('Cordis realm is disconnected')
    /**
     * 常量说明：expression 用于处理 expression 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const expression = realmObjectExpression({
      registryId: route.snapshot.objectRegistryId,
      handle: route.node.objectHandle,
    })
    /**
     * 常量说明：remote 用于处理 remote 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const remote = await this.runtime.resolveObject(route.source, expression, objectGroup)
    /**
     * 常量说明：rawObjectId 用于处理 rawObjectId 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const rawObjectId = remote.objectId
    if (typeof rawObjectId !== 'string') throw new Error('Cordis object lookup returned no RemoteObjectId')
    /**
     * 常量说明：objectId 用于处理 objectId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const objectId = cdpStringId<'CdpRemoteObjectId'>(rawObjectId, 'objectId')
    this.bindObjectId(objectId, node, objectGroup)
    return {
      ...remote,
      ...presentation(node),
    }
  }

  /**
   * 功能说明：处理 bindObjectId 相关流程；使用场景由所在模块及调用位置决定。
   * @param objectId （CdpRemoteObjectId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param node （CordisDomNode）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param group （string | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 bindObjectId(objectId, node, group)，并按返回类型处理结果。
   */
  private bindObjectId(objectId: CdpRemoteObjectId, node: CordisDomNode, group: string | undefined): void {
    /**
     * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const source = node.object?.source
    if (source === undefined) throw new Error('Structural Cordis node cannot bind a Runtime object')
    this.backendByObjectId.set(objectId, {
      backendNodeId: node.backendNodeId,
      sourceId: source.sourceId,
      generation: source.generation,
    })
    if (group === undefined) return
    /**
     * 变量说明：ids 用于处理 ids 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let ids = this.objectIdsByGroup.get(group)
    if (ids === undefined) this.objectIdsByGroup.set(group, ids = new Set())
    ids.add(objectId)
  }

  /**
   * 功能说明：处理 selectNode 相关流程；使用场景由所在模块及调用位置决定。
   * @param params （Readonly<Record<string, unknown>>）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @returns CordisDomNode；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 selectNode(params)，并按返回类型处理结果。
   */
  private selectNode(params: Readonly<Record<string, unknown>>): CordisDomNode {
    if (params.nodeId !== undefined) return this.fromNodeId(params.nodeId)
    if (params.backendNodeId !== undefined) {
      /**
       * 常量说明：id 用于处理 id 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const id = cdpBackendNodeId(params.backendNodeId, 'backendNodeId')
      /**
       * 常量说明：node 用于处理 node 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const node = this.backend.document().byBackendId.get(id)
      if (node !== undefined) return node
    }
    if (typeof params.objectId === 'string') {
      /**
       * 常量说明：binding 用于处理 binding 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const binding = this.backendByObjectId.get(cdpStringId<'CdpRemoteObjectId'>(params.objectId, 'objectId'))
      /**
       * 常量说明：node 用于处理 node 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const node = binding === undefined
        ? undefined
        : this.backend.document().byBackendId.get(binding.backendNodeId)
      if (node !== undefined) return node
    }
    throw new Error('Cordis node is not available')
  }

  /**
   * 功能说明：处理 fromNodeId 相关流程；使用场景由所在模块及调用位置决定。
   * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns CordisDomNode；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 fromNodeId(value)，并按返回类型处理结果。
   */
  private fromNodeId(value: unknown): CordisDomNode {
    /**
     * 常量说明：backendId 用于处理 backendId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const backendId = this.backendByNodeId.get(cdpNodeId(value, 'nodeId'))
    /**
     * 常量说明：node 用于处理 node 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const node = backendId === undefined ? undefined : this.backend.document().byBackendId.get(backendId)
    if (node === undefined) throw new Error('Cordis NodeId is not available in this document')
    return node
  }

  /**
   * 功能说明：序列化 serialize 相关流程；使用场景由所在模块及调用位置决定。
   * @param node （CordisDomNode）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param parentId （CdpNodeId | 0）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param remaining （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param delivery （boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns object；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 serialize(node, parentId, remaining, delivery)，
   * 并按返回类型处理结果。
   */
  private serialize(node: CordisDomNode, parentId: CdpNodeId | 0, remaining: number, delivery: boolean): object {
    /**
     * 常量说明：nodeId 用于处理 nodeId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const nodeId = this.nodeId(node)
    /**
     * 常量说明：document 用于处理 document 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const document = node.name === '#document'
    /**
     * 常量说明：withChildren 用于处理 withChildren 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const withChildren = remaining > 0
    // `DOM.describeNode` results are out-of-band descriptions the frontend does not merge into its tree,
    // so only delivery payloads record which nodes already carried their children.
    if (delivery && withChildren) this.childrenSent.add(node.backendNodeId)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：child（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(child)，并按返回类型处理结果。
     */
    return {
      nodeId,
      backendNodeId: node.backendNodeId,
      nodeType: document ? 9 : 1,
      nodeName: document ? '#document' : node.name.toUpperCase(),
      localName: document ? '' : node.name,
      nodeValue: '',
      ...(parentId === 0 ? {} : { parentId }),
      ...(document ? { documentURL: 'dsh://cordis', baseURL: 'dsh://cordis' } : {}),
      childNodeCount: node.children.length,
      ...(withChildren ? { children: node.children.map(child => this.serialize(child, nodeId, remaining - 1, delivery)) } : {}),
      attributes: node.attributes.flat(),
    }
  }

  /** Deliver the not-yet-sent ancestor levels of one node so its NodeId attaches to the frontend tree.
   * @remarks 中文说明：功能说明：处理 pushNodePath 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：node（CordisDomNode）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 pushNodePath(node)，
   * 并按返回类型处理结果。 */
  private pushNodePath(node: CordisDomNode): void {
    /**
     * 常量说明：document 用于处理 document 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const document = this.backend.document()
    /**
     * 常量说明：chain 用于处理 chain 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const chain: CordisDomNode[] = []
    /**
     * 变量说明：backendId 用于处理 backendId 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let backendId = document.parentByBackendId.get(node.backendNodeId)
    while (backendId !== undefined) {
      /**
       * 常量说明：parent 用于处理 parent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const parent = document.byBackendId.get(backendId)
      if (parent === undefined) break
      chain.unshift(parent)
      backendId = document.parentByBackendId.get(parent.backendNodeId)
    }
    /**
     * 变量说明：ancestor 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const ancestor of chain) {
      if (this.childrenSent.has(ancestor.backendNodeId)) continue
      /**
       * 常量说明：parentId 用于处理 parentId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const parentId = this.nodeId(ancestor)
      this.childrenSent.add(ancestor.backendNodeId)
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：child（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(child)，并按返回类型处理结果。
       */
      this.transport.send({
        method: 'DOM.setChildNodes',
        params: { parentId, nodes: ancestor.children.map(child => this.serialize(child, parentId, 0, true)) },
      })
    }
  }

  /**
   * 功能说明：处理 forgetSubtree 相关流程；使用场景由所在模块及调用位置决定。
   * @param node （CordisDomNode）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 forgetSubtree(node)，并按返回类型处理结果。
   */
  private forgetSubtree(node: CordisDomNode): void {
    this.childrenSent.delete(node.backendNodeId)
    /**
     * 变量说明：child 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const child of node.children) this.forgetSubtree(child)
  }

  /**
   * 功能说明：处理 nodeId 相关流程；使用场景由所在模块及调用位置决定。
   * @param node （CordisDomNode）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns CdpNodeId；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 nodeId(node)，并按返回类型处理结果。
   */
  private nodeId(node: CordisDomNode): CdpNodeId {
    /**
     * 变量说明：nodeId 用于处理 nodeId 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let nodeId = this.nodeIdByBackend.get(node.backendNodeId)
    if (nodeId === undefined) {
      nodeId = cdpNumericId<'CdpNodeId'>(this.nextNodeId++, 'nodeId')
      this.nodeIdByBackend.set(node.backendNodeId, nodeId)
      this.backendByNodeId.set(nodeId, node.backendNodeId)
    }
    return nodeId
  }

  /**
   * 功能说明：处理 parentNodeId 相关流程；使用场景由所在模块及调用位置决定。
   * @param node （CordisDomNode）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns CdpNodeId | 0；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 parentNodeId(node)，并按返回类型处理结果。
   */
  private parentNodeId(node: CordisDomNode): CdpNodeId | 0 {
    /**
     * 常量说明：parent 用于处理 parent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const parent = this.backend.document().parentByBackendId.get(node.backendNodeId)
    if (parent === undefined) return 0
    /**
     * 常量说明：nodeValue 用于处理 nodeValue 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const nodeValue = this.backend.document().byBackendId.get(parent)
    return nodeValue === undefined ? 0 : this.nodeId(nodeValue)
  }

  /**
   * 功能说明：处理 resetDocument 相关流程；使用场景由所在模块及调用位置决定。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 resetDocument()，并按返回类型处理结果。
   */
  private resetDocument(): void {
    this.nodeIdByBackend.clear()
    this.backendByNodeId.clear()
    this.backendByObjectId.clear()
    this.objectIdsByGroup.clear()
    this.searches.clear()
    this.childrenSent.clear()
  }

  /**
   * 功能说明：更新 Document 相关流程；使用场景由所在模块及调用位置决定。
   * @param event （CordisDomChange）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 updateDocument(event)，并按返回类型处理结果。
   */
  private updateDocument(event: CordisDomChange): void {
    if (event.type === 'source-disconnected') {
      this.releaseSourceObjects(event.source)
      return
    }
    if (this.enabled) /**
 * 变量说明：mutation 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
 */
for (const mutation of event.mutations) this.sendMutation(mutation)
    this.pruneDocumentState()
  }

  /**
   * 功能说明：处理 sendMutation 相关流程；使用场景由所在模块及调用位置决定。
   * @param mutation （CordisDomMutation）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 sendMutation(mutation)，并按返回类型处理结果。
   */
  private sendMutation(mutation: CordisDomMutation): void {
    switch (mutation.type) {
      case 'document-updated':
        this.resetDocument()
        this.transport.send({ method: 'DOM.documentUpdated', params: {} })
        return
      case 'child-inserted': {
        /**
         * 常量说明：parentNodeId 用于处理 parentNodeId 相关数据，作用于当前作用域；初始化后不可重新赋值，
         * 但对象内部是否可变仍由其类型决定。
         */
        const parentNodeId = this.nodeIdByBackend.get(mutation.parentBackendNodeId)
        if (parentNodeId === undefined) return
        /**
         * 常量说明：previousNodeId 用于处理 previousNodeId 相关数据，作用于当前作用域；初始化后不可重新赋值，
         * 但对象内部是否可变仍由其类型决定。
         */
        const previousNodeId = mutation.previousBackendNodeId === 0
          ? 0
          : this.nodeIdByBackend.get(mutation.previousBackendNodeId)
        if (previousNodeId === undefined) return
        // A reconnected source reuses backend ids; the collapsed payload resets any earlier delivery record.
        this.forgetSubtree(mutation.node)
        this.transport.send({
          method: 'DOM.childNodeInserted',
          params: {
            parentNodeId,
            previousNodeId,
            node: this.serialize(mutation.node, parentNodeId, 0, true),
          },
        })
        return
      }
      case 'child-removed': {
        /**
         * 常量说明：parentNodeId 用于处理 parentNodeId 相关数据，作用于当前作用域；初始化后不可重新赋值，
         * 但对象内部是否可变仍由其类型决定。
         */
        const parentNodeId = this.nodeIdByBackend.get(mutation.parentBackendNodeId)
        /**
         * 常量说明：nodeId 用于处理 nodeId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const nodeId = this.nodeIdByBackend.get(mutation.node.backendNodeId)
        this.forgetSubtree(mutation.node)
        if (parentNodeId === undefined || nodeId === undefined) return
        this.transport.send({ method: 'DOM.childNodeRemoved', params: { parentNodeId, nodeId } })
        return
      }
      case 'children-replaced': {
        /**
         * 常量说明：parentNodeId 用于处理 parentNodeId 相关数据，作用于当前作用域；初始化后不可重新赋值，
         * 但对象内部是否可变仍由其类型决定。
         */
        const parentNodeId = this.nodeIdByBackend.get(mutation.parentBackendNodeId)
        if (parentNodeId === undefined) return
        // Replacement payloads carry no grandchildren, so the frontend forgets any it knew below this parent.
        /**
         * 变量说明：child 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
         */
        for (const child of mutation.children) this.forgetSubtree(child)
        this.childrenSent.add(mutation.parentBackendNodeId)
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：child（由 TypeScript
         * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(child)，并按返回类型处理结果。
         */
        this.transport.send({
          method: 'DOM.setChildNodes',
          params: {
            parentId: parentNodeId,
            nodes: mutation.children.map(child => this.serialize(child, parentNodeId, 0, true)),
          },
        })
        return
      }
      case 'attribute-modified': {
        /**
         * 常量说明：nodeId 用于处理 nodeId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const nodeId = this.nodeIdByBackend.get(mutation.backendNodeId)
        if (nodeId !== undefined) {
          this.transport.send({
            method: 'DOM.attributeModified',
            params: { nodeId, name: mutation.name, value: mutation.value },
          })
        }
        return
      }
      case 'attribute-removed': {
        /**
         * 常量说明：nodeId 用于处理 nodeId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const nodeId = this.nodeIdByBackend.get(mutation.backendNodeId)
        if (nodeId !== undefined) {
          this.transport.send({ method: 'DOM.attributeRemoved', params: { nodeId, name: mutation.name } })
        }
        return
      }
      default:
        return assertNever(mutation)
    }
  }

  /**
   * 功能说明：处理 pruneDocumentState 相关流程；使用场景由所在模块及调用位置决定。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 pruneDocumentState()，并按返回类型处理结果。
   */
  private pruneDocumentState(): void {
    /**
     * 常量说明：document 用于处理 document 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const document = this.backend.document()
    /**
     * 变量说明：backendNodeId、nodeId 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const [backendNodeId, nodeId] of this.nodeIdByBackend) {
      if (document.byBackendId.has(backendNodeId)) continue
      this.nodeIdByBackend.delete(backendNodeId)
      this.backendByNodeId.delete(nodeId)
    }
    /**
     * 变量说明：backendNodeId 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const backendNodeId of this.childrenSent) {
      if (!document.byBackendId.has(backendNodeId)) this.childrenSent.delete(backendNodeId)
    }
    /**
     * 变量说明：objectId、binding 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const [objectId, binding] of this.backendByObjectId) {
      /**
       * 常量说明：node 用于处理 node 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const node = document.byBackendId.get(binding.backendNodeId)
      /**
       * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const source = node?.object?.source
      if (source?.sourceId === binding.sourceId && source.generation === binding.generation) continue
      this.backendByObjectId.delete(objectId)
      /**
       * 变量说明：group、objectIds 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const [group, objectIds] of this.objectIdsByGroup) {
        objectIds.delete(objectId)
        if (objectIds.size === 0) this.objectIdsByGroup.delete(group)
      }
    }
    /**
     * 变量说明：searchId、nodeIds 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const [searchId, nodeIds] of this.searches) {
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：nodeId（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(nodeId)，并按返回类型处理结果。
       */
      this.searches.set(searchId, nodeIds.filter((nodeId) => {
        /**
         * 常量说明：backendNodeId 用于处理 backendNodeId 相关数据，作用于当前作用域；初始化后不可重新赋值，
         * 但对象内部是否可变仍由其类型决定。
         */
        const backendNodeId = this.backendByNodeId.get(nodeId)
        return backendNodeId !== undefined && document.byBackendId.has(backendNodeId)
      }))
    }
  }

  /**
   * 功能说明：处理 releaseSourceObjects 相关流程；使用场景由所在模块及调用位置决定。
   * @param source （InspectorSourceDescriptor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 releaseSourceObjects(source)，并按返回类型处理结果。
   */
  private releaseSourceObjects(source: InspectorSourceDescriptor): void {
    /**
     * 变量说明：objectId、binding 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const [objectId, binding] of this.backendByObjectId) {
      if (binding.sourceId !== source.sourceId || binding.generation !== source.generation) continue
      this.backendByObjectId.delete(objectId)
      /**
       * 变量说明：group、objectIds 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const [group, objectIds] of this.objectIdsByGroup) {
        objectIds.delete(objectId)
        if (objectIds.size === 0) this.objectIdsByGroup.delete(group)
      }
    }
  }

  /**
   * 功能说明：处理 respond 相关流程；使用场景由所在模块及调用位置决定。
   * @param request （CdpRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @param operation （() => Promise<object>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 respond(request, operation)，并按返回类型处理结果。
   */
  private respond(request: CdpRequest, operation: () => Promise<object>): void {
    respondToCdpRequest(this.transport, request, operation)
  }
}

/**
 * 功能说明：处理 outerHtml 相关流程；使用场景由所在模块及调用位置决定。
 * @param node （CordisDomNode）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param indent （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 outerHtml(node, indent)，并按返回类型处理结果。
 */
function outerHtml(node: CordisDomNode, indent = ''): string {
  /**
   * 常量说明：attributes 用于处理 attributes 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：[name, value]（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调([name, value])，并按返回类型处理结果。
   */
  const attributes = node.attributes.map(([name, value]) => ` ${name}=${JSON.stringify(value)}`).join('')
  if (node.children.length === 0) return `${indent}<${node.name}${attributes} />`
  /**
   * 常量说明：children 用于处理 children 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：child（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(child)，并按返回类型处理结果。
   */
  const children = node.children.map(child => outerHtml(child, `${indent}  `)).join('\n')
  return `${indent}<${node.name}${attributes}>\n${children}\n${indent}</${node.name}>`
}

/**
 * 功能说明：处理 searchable 相关流程；使用场景由所在模块及调用位置决定。
 * @param node （CordisDomNode）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 searchable(node)，并按返回类型处理结果。
 */
function searchable(node: CordisDomNode): string {
  return `${node.name} ${node.description} ${node.attributes.flat().join(' ')}`.toLowerCase()
}

/**
 * 功能说明：处理 numberParam 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param name （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns number；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 numberParam(value, name)，并按返回类型处理结果。
 */
function numberParam(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${name} must be a non-negative integer`)
  return value as number
}

/**
 * 功能说明：处理 depthParam 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param fallback （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns number；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 depthParam(value, fallback)，并按返回类型处理结果。
 */
function depthParam(value: unknown, fallback: number): number {
  if (value === undefined) return fallback
  if (value === -1) return Number.POSITIVE_INFINITY
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error('depth must be -1 or a positive integer')
  return value as number
}

/**
 * 功能说明：处理 cdpNodeId 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param name （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns CdpNodeId；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 cdpNodeId(value, name)，并按返回类型处理结果。
 */
function cdpNodeId(value: unknown, name: string): CdpNodeId {
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be an integer`)
  return cdpNumericId<'CdpNodeId'>(value as number, name)
}

/**
 * 功能说明：处理 cdpBackendNodeId 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param name （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns CdpBackendNodeId；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 cdpBackendNodeId(value, name)，并按返回类型处理结果。
 */
function cdpBackendNodeId(value: unknown, name: string): CdpBackendNodeId {
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be an integer`)
  return cdpNumericId<'CdpBackendNodeId'>(value as number, name)
}

/**
 * 功能说明：处理 nonNegativeInteger 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param name （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns number；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 nonNegativeInteger(value, name)，并按返回类型处理结果。
 */
function nonNegativeInteger(value: unknown, name: string): number {
  return numberParam(value, name)
}

/**
 * 功能说明：处理 stringParam 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param name （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 stringParam(value, name)，并按返回类型处理结果。
 */
function stringParam(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new Error(`${name} must be a string`)
  return value
}

/**
 * 功能说明：处理 optionalString 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 optionalString(value)，并按返回类型处理结果。
 */
function optionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined
  return stringParam(value, 'objectGroup')
}

/**
 * 功能说明：处理 presentation 相关流程；使用场景由所在模块及调用位置决定。
 * @param node （CordisDomNode）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns RuntimeObjectPresentation；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 presentation(node)，并按返回类型处理结果。
 */
function presentation(node: CordisDomNode): RuntimeObjectPresentation {
  return {
    subtype: 'node',
    className: node.object?.node.kind === 'fiber' ? 'Fiber' : 'Context',
    description: node.description,
  }
}

/**
 * 功能说明：断言 Never 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （never）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns never；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 assertNever(value)，并按返回类型处理结果。
 */
function assertNever(value: never): never {
  throw new Error(`Unexpected Cordis DOM mutation: ${JSON.stringify(value)}`)
}
