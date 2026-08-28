/** Realm-local retention and identity for live objects referenced by Inspector snapshots.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 object registry 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { inspectorId } from '../identity.ts'
import {
  type InspectorObjectHandle,
  type InspectorObjectRegistryId,
} from './ids.ts'
import type { InspectorObjectReference } from './object-reference.ts'

/**
 * 常量说明：REGISTRIES_SYMBOL 用于处理 REGISTRIES_SYMBOL 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const REGISTRIES_SYMBOL = 'dsh.inspector.realm-object-registries'
/**
 * 常量说明：MAX_FIBER_WRAPPER_DEPTH 用于处理 MAX_FIBER_WRAPPER_DEPTH 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const MAX_FIBER_WRAPPER_DEPTH = 8

/** Self-contained function sent through CDP to identify its `this` object in the inspected realm.
 * @remarks 中文说明：常量说明：IDENTIFY_REALM_OBJECT_FUNCTION 用于处理
 * IDENTIFY_REALM_OBJECT_FUNCTION 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const IDENTIFY_REALM_OBJECT_FUNCTION = `function () {
  const table = globalThis[Symbol.for(${JSON.stringify(REGISTRIES_SYMBOL)})]
  if (!(table instanceof Map)) return undefined
  for (const registry of table.values()) {
    const reference = registry.identify(this)
    if (reference !== undefined) return reference
  }
  return undefined
}`

/** One realm's bounded table of objects retained by its latest semantic snapshot.
 * @remarks 中文说明：类说明：RealmObjectRegistry 用于集中封装 处理 RealmObjectRegistry
 * 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由
 * experimental/inspector 在对应插件或业务生命周期内创建和调用。 */
export class RealmObjectRegistry {
  /** Realm-unique id carried by every reference from this registry.
   * @remarks 中文说明：常量说明：id 用于处理 id 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
  readonly id = inspectorId<'InspectorObjectRegistryId'>(randomUUID(), 'registryId')
  /**
   * 常量说明：known 用于处理 known 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly known = new WeakMap<object, InspectorObjectHandle>()
  /**
   * 变量说明：retained 用于处理 retained 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private retained = new Map<InspectorObjectHandle, object>()
  /**
   * 变量说明：nextHandle 用于处理 nextHandle 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private nextHandle = 1
  /**
   * 变量说明：disposed 用于处理 disposed 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private disposed = false

  /**
   * 功能说明：处理 RealmObjectRegistry 相关流程；使用场景由所在模块及调用位置决定。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new RealmObjectRegistry() 创建实例，并在所属生命周期内使用。
   */
  constructor() {
    registries().set(this.id, this)
  }

  /**
   * Start one replacement generation.
   * @returns A collector that atomically installs exactly the retained objects on commit.
   * @remarks 中文说明：功能说明：处理 begin 相关流程；使用场景由所在模块及调用位置决定。；
   * 返回值：RealmObjectGeneration；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * begin()，并按返回类型处理结果。
   */
  begin(): RealmObjectGeneration {
    if (this.disposed) throw new Error('inspector: realm object registry is disposed')
    return new RealmObjectGeneration(this)
  }

  /**
   * Resolve one current opaque handle.
   * @param handle - Handle from the latest committed snapshot.
   * @returns The live object, when it remains retained.
   * @remarks 中文说明：功能说明：解析 resolve 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：handle（InspectorObjectHandle）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：object | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * resolve(handle)，并按返回类型处理结果。
   */
  resolve(handle: InspectorObjectHandle): object | undefined {
    return this.retained.get(handle)
  }

  /**
   * Identify one object retained by the latest snapshot. Cordis plugin calls may return nested thenable facades;
   * only objects whose prototype path consists exclusively of those `then` wrappers resolve to the retained Fiber.
   * @param value - Candidate live value.
   * @returns Its wire reference, when present in this registry.
   * @remarks 中文说明：功能说明：处理 identify 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：InspectorObjectReference | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 identify(value)，并按返回类型处理结果。
   */
  identify(value: unknown): InspectorObjectReference | undefined {
    if ((typeof value !== 'object' || value === null) && typeof value !== 'function') return undefined
    /**
     * 变量说明：candidate 用于处理 candidate 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let candidate: object | null = value
    /**
     * 变量说明：depth 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (let depth = 0; candidate !== null && depth <= MAX_FIBER_WRAPPER_DEPTH; depth++) {
      /**
       * 常量说明：handle 用于处理 handle 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const handle = this.known.get(candidate)
      if (handle !== undefined && this.retained.get(handle) === candidate) return { registryId: this.id, handle }
      try {
        /**
         * 常量说明：keys 用于处理 keys 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const keys = Reflect.ownKeys(candidate)
        if (keys.length !== 1 || keys[0] !== 'then') return undefined
        candidate = Object.getPrototypeOf(candidate) as object | null
      } catch {
        // A hostile proxy cannot prevent later registries from checking the original value.
        return undefined
      }
    }
    return undefined
  }

  /** Remove this registry from the realm and release all strong references.
   * @remarks 中文说明：功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 close()，并按返回类型处理结果。 */
  close(): void {
    if (this.disposed) return
    this.disposed = true
    registries().delete(this.id)
    this.retained.clear()
  }

  /**
   * Assign a stable handle and retain a value in one pending generation.
   * @param value - Object represented by the pending snapshot.
   * @param next - Pending generation's strong-reference table.
   * @returns The registry id and stable object handle.
   * @remarks 中文说明：功能说明：处理 retain 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：value（object）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：next（Map<InspectorObjectHandle, object>）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：InspectorObjectReference；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 retain(value, next)，并按返回类型处理结果。
   */
  retain(value: object, next: Map<InspectorObjectHandle, object>): InspectorObjectReference {
    /**
     * 变量说明：handle 用于处理 handle 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let handle = this.known.get(value)
    if (handle === undefined) {
      handle = inspectorId<'InspectorObjectHandle'>(`object-${String(this.nextHandle++)}`, 'objectHandle')
      this.known.set(value, handle)
    }
    next.set(handle, value)
    return { registryId: this.id, handle }
  }

  /**
   * Replace the current strong-reference set with one completed generation.
   * @param next - Complete object table for the committed snapshot.
   * @remarks 中文说明：功能说明：处理 commit 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：next（Map<InspectorObjectHandle, object>）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 commit(next)，并按返回类型处理结果。
   */
  commit(next: Map<InspectorObjectHandle, object>): void {
    this.retained = next
  }
}

/** Mutable object set assembled before one snapshot becomes visible.
 * @remarks 中文说明：类说明：RealmObjectGeneration 用于集中封装 处理 RealmObjectGeneration
 * 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由
 * experimental/inspector 在对应插件或业务生命周期内创建和调用。 */
export class RealmObjectGeneration {
  /**
   * 常量说明：retained 用于处理 retained 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly retained = new Map<InspectorObjectHandle, object>()
  /**
   * 变量说明：committed 用于处理 committed 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private committed = false

  /**
   * 功能说明：处理 RealmObjectGeneration 相关流程；使用场景由所在模块及调用位置决定。
   * @param owner （RealmObjectRegistry）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new RealmObjectGeneration(owner) 创建实例，并在所属生命周期内使用。
   */
  constructor(private readonly owner: RealmObjectRegistry) {}

  /**
   * Retain one object and obtain its stable opaque reference.
   * @param value - Context or Fiber represented in the snapshot.
   * @returns Source-local wire reference.
   * @remarks 中文说明：功能说明：处理 retain 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：value（object）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：InspectorObjectReference；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 retain(value)，并按返回类型处理结果。
   */
  retain(value: object): InspectorObjectReference {
    if (this.committed) throw new Error('inspector: realm object generation is already committed')
    return this.owner.retain(value, this.retained)
  }

  /**
   * Stop retaining an object omitted while bounding the pending snapshot.
   * @param handle - Opaque handle removed from this pending generation.
   * @remarks 中文说明：功能说明：处理 release 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：handle（InspectorObjectHandle）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 release(handle)，
   * 并按返回类型处理结果。
   */
  release(handle: InspectorObjectHandle): void {
    if (this.committed) throw new Error('inspector: realm object generation is already committed')
    this.retained.delete(handle)
  }

  /** Atomically replace the registry's retained set.
   * @remarks 中文说明：功能说明：处理 commit 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 commit()，并按返回类型处理结果。 */
  commit(): void {
    if (this.committed) return
    this.committed = true
    this.owner.commit(this.retained)
  }
}

/**
 * Build an expression that resolves one reference inside its owning realm.
 * @param reference - Validated source-local object reference.
 * @returns Side-effect-free JavaScript expression for Runtime evaluation.
 * @remarks 中文说明：功能说明：处理 realmObjectExpression 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：reference（InspectorObjectReference）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：string；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * realmObjectExpression(reference)，并按返回类型处理结果。
 */
export function realmObjectExpression(reference: InspectorObjectReference): string {
  return `globalThis[Symbol.for(${JSON.stringify(REGISTRIES_SYMBOL)})]?.get(${JSON.stringify(reference.registryId)})?.resolve(${JSON.stringify(reference.handle)})`
}

/**
 * Identify a retained object across all Inspector collectors in this realm.
 * @param value - Runtime value returned to a debugger.
 * @returns Its source-local reference, when the value is a visible entity.
 * @remarks 中文说明：功能说明：处理 identifyRealmObject 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：InspectorObjectReference | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 identifyRealmObject(value)，并按返回类型处理结果。
 */
export function identifyRealmObject(value: unknown): InspectorObjectReference | undefined {
  /**
   * 变量说明：registry 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const registry of registries().values()) {
    /**
     * 常量说明：reference 用于处理 reference 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const reference = registry.identify(value)
    if (reference !== undefined) return reference
  }
  return undefined
}

/**
 * 功能说明：处理 registries 相关流程；使用场景由所在模块及调用位置决定。
 * @returns Map<InspectorObjectRegistryId, RealmObjectRegistry>；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 registries()，并按返回类型处理结果。
 */
function registries(): Map<InspectorObjectRegistryId, RealmObjectRegistry> {
  /**
   * 常量说明：key 用于处理 key 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const key = Symbol.for(REGISTRIES_SYMBOL)
  /**
   * 常量说明：existing 用于处理 existing 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const existing = Reflect.get(globalThis, key) as unknown
  if (existing instanceof Map) return existing as Map<InspectorObjectRegistryId, RealmObjectRegistry>
  /**
   * 常量说明：value 用于处理 value 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const value = new Map<InspectorObjectRegistryId, RealmObjectRegistry>()
  Reflect.set(globalThis, key, value)
  return value
}
