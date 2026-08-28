/** Shared Host/Client projection from live Cordis objects to a bounded semantic tree.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 collector 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import { Context, type Fiber } from '@deepseek-ai/cordis'
import { jsonByteLength, type InspectorJsonValue } from '../json.ts'
import {
  CORDIS_TREE_SCHEMA_VERSION,
  type CordisContextTreeNode,
  type CordisFiberTreeNode,
  type CordisTreeSnapshot,
} from './snapshot.ts'
import type { InspectorObjectHandle } from './ids.ts'
import { RealmObjectRegistry } from './object-registry.ts'

/**
 * 常量说明：SHADOW 用于处理 SHADOW 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const SHADOW = Symbol.for('cordis.shadow')

/** Bounds applied before one snapshot enters a source frame. */
export interface CordisTreeLimits {
  readonly maxNodes: number
  readonly maxBytes: number
}

interface ContextInfo {
  readonly value: Context
  readonly children: ContextInfo[]
  readonly fiber: Fiber | undefined
}

interface MutableContextNode extends Omit<CordisContextTreeNode, 'children'> {
  readonly children: MutableTreeNode[]
}

interface MutableFiberNode extends Omit<CordisFiberTreeNode, 'children'> {
  readonly children: [MutableContextNode]
}

type MutableTreeNode = MutableContextNode | MutableFiberNode

/** Realm-local collector with a current live-object table.
 * @remarks 中文说明：类说明：CordisTreeCollector 用于集中封装 处理 CordisTreeCollector
 * 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由
 * experimental/inspector 在对应插件或业务生命周期内创建和调用。 */
export class CordisTreeCollector {
  /** Live-object table replaced atomically with each emitted snapshot.
   * @remarks 中文说明：常量说明：objects 用于处理 objects 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。 */
  readonly objects = new RealmObjectRegistry()
  /**
   * 变量说明：revision 用于处理 revision 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private revision = 0

  /**
   * 功能说明：处理 CordisTreeCollector 相关流程；使用场景由所在模块及调用位置决定。
   * @param root （Context）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param limits （CordisTreeLimits）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new CordisTreeCollector(root, limits) 创建实例，并在所属生命周期内使用。
   */
  constructor(private readonly root: Context, private readonly limits: CordisTreeLimits) {}

  /**
   * Capture the current reachable Context/Fiber tree.
   * @returns A detached JSON snapshot whose retained objects replace the prior generation atomically.
   * @remarks 中文说明：功能说明：处理 snapshot 相关流程；使用场景由所在模块及调用位置决定。；
   * 返回值：CordisTreeSnapshot；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * snapshot()，并按返回类型处理结果。
   */
  snapshot(): CordisTreeSnapshot {
    /**
     * 常量说明：collected 用于处理 collected 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const collected = collectContexts(this.root)
    /**
     * 常量说明：tree 用于处理 tree 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const tree = collected.root
    /**
     * 常量说明：objects 用于处理 objects 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const objects = this.objects.begin()
    /**
     * 变量说明：nodeCount 用于处理 nodeCount 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let nodeCount = 0
    /**
     * 变量说明：truncated 用于处理 truncated 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let truncated = collected.truncated

    /**
     * 常量说明：contextNode 用于处理 contextNode 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     * 功能说明：处理 contextNode 相关流程；使用场景由所在模块及调用位置决定。
     * @param info （ContextInfo）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns MutableContextNode | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 contextNode(info)，并按返回类型处理结果。
     */
    const contextNode = (info: ContextInfo): MutableContextNode | undefined => {
      if (nodeCount >= this.limits.maxNodes) {
        truncated = true
        return undefined
      }
      nodeCount++
      /**
       * 常量说明：node 用于处理 node 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const node: MutableContextNode = {
        kind: 'context',
        objectHandle: objects.retain(info.value).handle,
        children: [],
      }
      /**
       * 变量说明：child 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const child of info.children) {
        if (child.fiber !== undefined && child.fiber.ctx === child.value) {
          /**
           * 常量说明：projected 用于处理 projected 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
           */
          const projected = fiberNode(child.fiber, child)
          if (projected !== undefined) node.children.push(projected)
        } else {
          /**
           * 常量说明：projected 用于处理 projected 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
           */
          const projected = contextNode(child)
          if (projected !== undefined) node.children.push(projected)
        }
      }
      return node
    }
    /**
     * 常量说明：fiberNode 用于处理 fiberNode 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：处理 fiberNode 相关流程；使用场景由所在模块及调用位置决定。
     * @param fiber （Fiber）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @param owned （ContextInfo）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns MutableFiberNode | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 fiberNode(fiber, owned)，并按返回类型处理结果。
     */
    const fiberNode = (fiber: Fiber, owned: ContextInfo): MutableFiberNode | undefined => {
      if (fiber.uid === null) return undefined
      if (nodeCount + 2 > this.limits.maxNodes) {
        truncated = true
        return undefined
      }
      nodeCount++
      /**
       * 常量说明：context 用于处理 context 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const context = contextNode(owned) as MutableContextNode
      return {
        kind: 'fiber',
        objectHandle: objects.retain(fiber).handle,
        uid: fiber.uid,
        children: [context],
      }
    }

    /**
     * 常量说明：root 用于处理 root 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const root = contextNode(tree)
    if (root === undefined) throw new Error('inspector: maxNodes cannot retain the root Context')
    /**
     * 变量说明：snapshot 用于处理 snapshot 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let snapshot: CordisTreeSnapshot = {
      schemaVersion: CORDIS_TREE_SCHEMA_VERSION,
      revision: ++this.revision,
      objectRegistryId: this.objects.id,
      root,
      truncated,
    }
    while (jsonByteLength(snapshot as unknown as InspectorJsonValue) > this.limits.maxBytes) {
      /**
       * 常量说明：removed 用于处理 removed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const removed = pruneLast(root)
      if (removed.length === 0) break
      /**
       * 变量说明：handle 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const handle of removed) objects.release(handle)
      snapshot = { ...snapshot, truncated: true }
    }
    if (jsonByteLength(snapshot as unknown as InspectorJsonValue) > this.limits.maxBytes) {
      throw new Error('inspector: Cordis root exceeds the source-frame byte limit')
    }
    objects.commit()
    return snapshot
  }

  /** Release the realm-global resolver and every retained object.
   * @remarks 中文说明：功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 close()，并按返回类型处理结果。 */
  close(): void {
    this.objects.close()
  }
}

/**
 * 功能说明：收集 Contexts 相关流程；使用场景由所在模块及调用位置决定。
 * @param root （Context）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns { readonly root: ContextInfo; readonly truncated: boolean }；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 collectContexts(root)，并按返回类型处理结果。
 */
function collectContexts(root: Context): { readonly root: ContextInfo; readonly truncated: boolean } {
  /**
   * 常量说明：contexts 用于处理 contexts 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const contexts = new Map<Context, ContextInfo>()
  /**
   * 变量说明：truncated 用于处理 truncated 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let truncated = false
  /**
   * 常量说明：ensure 用于确保 ensure 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：确保 ensure 相关流程；使用场景由所在模块及调用位置决定。
   * @param candidate （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param depth （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns ContextInfo | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 ensure(candidate, depth)，并按返回类型处理结果。
   */
  const ensure = (candidate: unknown, depth = 0): ContextInfo | undefined => {
    if (depth > 100) {
      truncated = true
      return undefined
    }
    /**
     * 常量说明：value 用于处理 value 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const value = unwrapContext(candidate)
    if (!Context.is(value)) return undefined
    /**
     * 常量说明：existing 用于处理 existing 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const existing = contexts.get(value)
    if (existing !== undefined) return existing
    if (value === root) {
      /**
       * 常量说明：info 用于处理 info 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const info = describeContext(value)
      contexts.set(value, info)
      return info
    }
    /**
     * 常量说明：prototype 用于处理 prototype 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const prototype = unwrapContext(Object.getPrototypeOf(value) as unknown)
    /**
     * 常量说明：parent 用于处理 parent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const parent = ensure(prototype, depth + 1)
    if (parent === undefined) return undefined
    /**
     * 常量说明：info 用于处理 info 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const info = describeContext(value)
    contexts.set(value, info)
    parent.children.push(info)
    return info
  }

  /**
   * 常量说明：rootInfo 用于处理 rootInfo 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const rootInfo = ensure(root) as ContextInfo
  /**
   * 变量说明：runtime 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const runtime of root.registry.values()) {
    /**
     * 变量说明：fiber 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const fiber of runtime.fibers) {
      if (fiber.uid === null) continue
      ensure(fiber.parent)
      ensure(fiber.ctx)
    }
  }
  /**
   * 变量说明：key 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const key of Reflect.ownKeys(root.events._hooks)) {
    /**
     * 变量说明：hook 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const hook of root.events._hooks[key] ?? []) ensure(hook.ctx)
  }
  /**
   * 常量说明：order 用于处理 order 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 order 相关流程；使用场景由所在模块及调用位置决定。
   * @param info （ContextInfo）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns number；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 order(info)，并按返回类型处理结果。
   */
  const order = (info: ContextInfo): number => info.fiber?.uid ?? Number.MAX_SAFE_INTEGER
  /**
   * 变量说明：info 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const info of contexts.values()) {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：left（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：right（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(left, right)，并按返回类型处理结果。
     */
    info.children.sort((left, right) => order(left) - order(right))
  }
  return { root: rootInfo, truncated }
}

/**
 * 功能说明：处理 describeContext 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （Context）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns ContextInfo；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 describeContext(value)，并按返回类型处理结果。
 */
function describeContext(value: Context): ContextInfo {
  /**
   * 常量说明：fiber 用于处理 fiber 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const fiber = ownValue(value, 'fiber') as Fiber | undefined
  return { value, children: [], fiber }
}

/**
 * 功能说明：处理 ownValue 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （object）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param key （PropertyKey）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns unknown；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 ownValue(value, key)，并按返回类型处理结果。
 */
function ownValue(value: object, key: PropertyKey): unknown {
  return Reflect.getOwnPropertyDescriptor(value, key)?.value
}

/**
 * 功能说明：处理 unwrapContext 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns unknown；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 unwrapContext(value)，并按返回类型处理结果。
 */
function unwrapContext(value: unknown): unknown {
  /**
   * 变量说明：current 用于处理 current 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let current = value
  while (typeof current === 'object' && current !== null && Object.hasOwn(current, SHADOW)) {
    current = Object.getPrototypeOf(current)
  }
  return current
}

/**
 * 功能说明：处理 pruneLast 相关流程；使用场景由所在模块及调用位置决定。
 * @param context （MutableContextNode）：提供当前 Cordis 插件上下文与已声明服务；
 * 必须满足声明的类型及调用时序要求。
 * @returns InspectorObjectHandle[]；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 pruneLast(context)，并按返回类型处理结果。
 */
function pruneLast(context: MutableContextNode): InspectorObjectHandle[] {
  /**
   * 常量说明：child 用于处理 child 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const child = context.children.at(-1)
  if (child === undefined) return []
  if (child.kind === 'context') {
    /**
     * 常量说明：nested 用于处理 nested 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const nested = pruneLast(child)
    if (nested.length > 0) return nested
    context.children.pop()
    return [child.objectHandle]
  }
  /**
   * 常量说明：owned 用于处理 owned 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const owned = child.children[0]
  /**
   * 常量说明：nested 用于处理 nested 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const nested = pruneLast(owned)
  if (nested.length > 0) return nested
  context.children.pop()
  return [child.objectHandle, owned.objectHandle]
}
