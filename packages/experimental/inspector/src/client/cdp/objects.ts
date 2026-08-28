/** Client-local object handles and CDP-compatible RemoteObject serialization.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 objects 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import {
  inspectorId,
  type ClientRemoteObjectHandle,
} from '../../shared/bridge/ids.ts'
import { isJsonValue, type InspectorJsonValue } from '../../shared/json.ts'
import type { ClientRuntimeRemoteObject } from '../../shared/bridge/messages/runtime/index.ts'
import type {
  RuntimeObjectPreview,
  RuntimePropertyPreview,
  RuntimeRemoteObjectSubtype,
  RuntimeRemoteObjectType,
} from '../../shared/cdp/index.ts'
import { ClientRuntimeExecutionError } from './errors.ts'
import { identifyRealmObject } from '../../shared/cordis/object-registry.ts'

/**
 * 常量说明：MAX_CLASS_PROTOTYPE_DEPTH 用于处理 MAX_CLASS_PROTOTYPE_DEPTH 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const MAX_CLASS_PROTOTYPE_DEPTH = 32

interface StoredObject {
  readonly value: unknown
  readonly group: string | undefined
}

/** Opaque set of handles allocated by one Client Runtime operation. */
export type ClientObjectAllocation = symbol

/** Serialization choices inherited by child RemoteObjects. */
export interface ClientRuntimeObjectOptions {
  readonly group?: string
  readonly generatePreview?: boolean
  readonly returnByValue?: boolean
}

/** Per-DevTools-session owner of all live Client object references.
 * @remarks 中文说明：类说明：ClientObjectStore 用于集中封装 处理 ClientObjectStore 相关状态与行为。；
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由 experimental/inspector
 * 在对应插件或业务生命周期内创建和调用。 */
export class ClientObjectStore {
  /**
   * 常量说明：objects 用于处理 objects 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly objects = new Map<ClientRemoteObjectHandle, StoredObject>()
  /**
   * 常量说明：groups 用于处理 groups 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly groups = new Map<string, Set<ClientRemoteObjectHandle>>()
  /**
   * 常量说明：allocations 用于处理 allocations 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly allocations = new Map<ClientObjectAllocation, Set<ClientRemoteObjectHandle>>()
  /**
   * 变量说明：nextOrdinal 用于处理 nextOrdinal 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private nextOrdinal = 1

  /**
   * 功能说明：处理 ClientObjectStore 相关流程；使用场景由所在模块及调用位置决定。
   * @param maxObjects （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new ClientObjectStore(maxObjects) 创建实例，并在所属生命周期内使用。
   */
  constructor(private readonly maxObjects: number) {}

  /**
   * Start tracking handles allocated by one independently settling operation.
   * @returns An opaque allocation identity.
   * @remarks 中文说明：功能说明：处理 beginAllocation 相关流程；使用场景由所在模块及调用位置决定。；
   * 返回值：ClientObjectAllocation；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 beginAllocation()，并按返回类型处理结果。
   */
  beginAllocation(): ClientObjectAllocation {
    /**
     * 常量说明：allocation 用于处理 allocation 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const allocation = Symbol('Client Runtime object allocation')
    this.allocations.set(allocation, new Set())
    return allocation
  }

  /**
   * Keep an operation's handles and release its allocation bookkeeping.
   * @param allocation - Allocation returned by {@link beginAllocation}.
   * @remarks 中文说明：功能说明：处理 commitAllocation 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：allocation（ClientObjectAllocation）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * commitAllocation(allocation)，并按返回类型处理结果。
   */
  commitAllocation(allocation: ClientObjectAllocation): void {
    this.allocations.delete(allocation)
  }

  /**
   * Resolve one handle or fail without exposing another session's objects.
   * @param handle - Client-local object handle.
   * @returns The retained JavaScript value.
   * @remarks 中文说明：功能说明：获取 get 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：handle（ClientRemoteObjectHandle）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：unknown；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 get(handle)，
   * 并按返回类型处理结果。
   */
  get(handle: ClientRemoteObjectHandle): unknown {
    /**
     * 常量说明：object 用于处理 object 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const object = this.objects.get(handle)
    if (object === undefined) throw new ClientRuntimeExecutionError('object-not-found', 'Client RemoteObject was released')
    return object.value
  }

  /**
   * Read the object group inherited by values reached through one handle.
   * @param handle - Client-local object handle.
   * @returns Its object group, or `undefined` when it is ungrouped.
   * @remarks 中文说明：功能说明：处理 group 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：handle（ClientRemoteObjectHandle）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：string | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * group(handle)，并按返回类型处理结果。
   */
  group(handle: ClientRemoteObjectHandle): string | undefined {
    /**
     * 常量说明：object 用于处理 object 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const object = this.objects.get(handle)
    if (object === undefined) throw new ClientRuntimeExecutionError('object-not-found', 'Client RemoteObject was released')
    return object.group
  }

  /**
   * Convert a live value to the JSON-safe RemoteObject protocol.
   * @param value - Value owned by this Client realm.
   * @param options - Object group and serialization options.
   * @param allocation - Optional operation that owns any newly retained handle.
   * @returns A primitive value or opaque Client handle with display metadata.
   * @remarks 中文说明：功能说明：序列化 serialize 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：options（ClientRuntimeObjectOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；
   * 参数说明：allocation（ClientObjectAllocation）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：ClientRuntimeRemoteObject；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 serialize(value, options, allocation)，并按返回类型处理结果。
   */
  serialize(
    value: unknown,
    options: ClientRuntimeObjectOptions = {},
    allocation?: ClientObjectAllocation,
  ): ClientRuntimeRemoteObject {
    /**
     * 常量说明：primitive 用于处理 primitive 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const primitive = serializePrimitive(value)
    if (primitive !== undefined) return primitive
    if (options.returnByValue === true) {
      return {
        descriptor: {
          type: typeof value === 'function' ? 'function' : 'object',
          value: serializeByValue(value),
          description: describe(value),
        },
      }
    }
    /**
     * 常量说明：type 用于处理 type 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const type: RuntimeRemoteObjectType = typeof value === 'function' ? 'function' : typeof value === 'symbol' ? 'symbol' : 'object'
    /**
     * 常量说明：subtype 用于处理 subtype 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const subtype = type === 'object' ? subtypeOf(value) : undefined
    /**
     * 常量说明：objectReference 用于处理 objectReference 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const objectReference = identifyRealmObject(value)
    return {
      descriptor: {
        type,
        ...(subtype === undefined ? {} : { subtype }),
        className: className(value),
        description: describe(value),
        ...(options.generatePreview === true && type === 'object' ? { preview: preview(value, type, subtype) } : {}),
      },
      object: { handle: this.register(value, options.group, allocation) },
      ...(objectReference === undefined ? {} : { semanticReference: objectReference }),
    }
  }

  /**
   * Release exactly one handle. Releasing an unknown handle is idempotent.
   * @param handle - Client-local object handle.
   * @remarks 中文说明：功能说明：处理 release 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：handle（ClientRemoteObjectHandle）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 release(handle)，
   * 并按返回类型处理结果。
   */
  release(handle: ClientRemoteObjectHandle): void {
    /**
     * 常量说明：object 用于处理 object 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const object = this.objects.get(handle)
    if (object === undefined) return
    this.objects.delete(handle)
    if (object.group === undefined) return
    /**
     * 常量说明：members 用于处理 members 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const members = this.groups.get(object.group)
    members?.delete(handle)
    if (members?.size === 0) this.groups.delete(object.group)
  }

  /**
   * Release every handle in one DevTools object group.
   * @param group - DevTools object-group name.
   * @remarks 中文说明：功能说明：处理 releaseGroup 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：group（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 releaseGroup(group)，并按返回类型处理结果。
   */
  releaseGroup(group: string): void {
    /**
     * 常量说明：members 用于处理 members 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const members = this.groups.get(group)
    if (members === undefined) return
    /**
     * 变量说明：handle 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const handle of members) this.objects.delete(handle)
    this.groups.delete(group)
  }

  /**
   * Discard exactly the handles allocated by one failed operation.
   * @param allocation - Allocation returned by {@link beginAllocation}.
   * @remarks 中文说明：功能说明：处理 rollback 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：allocation（ClientObjectAllocation）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * rollback(allocation)，并按返回类型处理结果。
   */
  rollback(allocation: ClientObjectAllocation): void {
    /**
     * 常量说明：handles 用于处理 handles 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const handles = this.allocations.get(allocation)
    if (handles === undefined) return
    this.allocations.delete(allocation)
    /**
     * 变量说明：handle 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const handle of handles) this.release(handle)
  }

  /** Release the whole DevTools session.
   * @remarks 中文说明：功能说明：处理 clear 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 clear()，并按返回类型处理结果。 */
  clear(): void {
    this.objects.clear()
    this.groups.clear()
    this.allocations.clear()
  }

  /**
   * 功能说明：注册 register 相关流程；使用场景由所在模块及调用位置决定。
   * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param group （string | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param allocation （ClientObjectAllocation | undefined）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @returns ClientRemoteObjectHandle；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 register(value, group, allocation)，并按返回类型处理结果。
   */
  private register(
    value: unknown,
    group: string | undefined,
    allocation: ClientObjectAllocation | undefined,
  ): ClientRemoteObjectHandle {
    if (this.objects.size >= this.maxObjects) {
      throw new ClientRuntimeExecutionError('result-too-large', `Client Runtime retained-object limit ${String(this.maxObjects)} reached`)
    }
    /**
     * 常量说明：ordinal 用于处理 ordinal 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ordinal = this.nextOrdinal++
    /**
     * 常量说明：handle 用于处理 handle 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const handle = inspectorId<'ClientRemoteObjectHandle'>(`object-${String(ordinal)}`, 'handle')
    this.objects.set(handle, { value, group })
    if (allocation !== undefined) this.allocations.get(allocation)?.add(handle)
    if (group !== undefined) {
      /**
       * 变量说明：members 用于处理 members 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
       */
      let members = this.groups.get(group)
      if (members === undefined) {
        members = new Set()
        this.groups.set(group, members)
      }
      members.add(handle)
    }
    return handle
  }
}

/**
 * 功能说明：序列化 Primitive 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns ClientRuntimeRemoteObject | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 serializePrimitive(value)，并按返回类型处理结果。
 */
function serializePrimitive(value: unknown): ClientRuntimeRemoteObject | undefined {
  if (value === undefined) return { descriptor: { type: 'undefined' } }
  if (value === null) return { descriptor: { type: 'object', subtype: 'null', value: null } }
  if (typeof value === 'string') return { descriptor: { type: 'string', value } }
  if (typeof value === 'boolean') return { descriptor: { type: 'boolean', value } }
  if (typeof value === 'bigint') {
    /**
     * 常量说明：text 用于处理 text 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const text = `${String(value)}n`
    return { descriptor: { type: 'bigint', unserializableValue: text, description: text } }
  }
  if (typeof value !== 'number') return undefined
  if (Number.isFinite(value) && !Object.is(value, -0)) {
    return { descriptor: { type: 'number', value, description: String(value) } }
  }
  /**
   * 常量说明：text 用于处理 text 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const text = Object.is(value, -0) ? '-0' : String(value)
  return { descriptor: { type: 'number', unserializableValue: text, description: text } }
}

/**
 * 功能说明：序列化 By Value 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns InspectorJsonValue；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 serializeByValue(value)，并按返回类型处理结果。
 */
function serializeByValue(value: unknown): InspectorJsonValue {
  /**
   * 变量说明：serialized 用于处理 serialized 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let serialized: unknown
  /**
   * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
   */
  try {
    serialized = JSON.stringify(value)
  } catch (error) {
    throw new ClientRuntimeExecutionError('unsupported', `Value cannot be returned by value: ${renderError(error)}`)
  }
  if (typeof serialized !== 'string') throw new ClientRuntimeExecutionError('unsupported', 'Value cannot be returned by value')
  /**
   * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const result = JSON.parse(serialized) as unknown
  if (!isJsonValue(result)) throw new ClientRuntimeExecutionError('unsupported', 'Value is outside the JSON value set')
  return result
}

/**
 * 功能说明：处理 preview 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param type （RuntimeRemoteObjectType）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param subtype （RuntimeRemoteObjectSubtype | undefined）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @returns RuntimeObjectPreview；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 preview(value, type, subtype)，并按返回类型处理结果。
 */
function preview(
  value: unknown,
  type: RuntimeRemoteObjectType,
  subtype: RuntimeRemoteObjectSubtype | undefined,
): RuntimeObjectPreview {
  /**
   * 常量说明：properties 用于处理 properties 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const properties: RuntimePropertyPreview[] = []
  /**
   * 变量说明：overflow 用于处理 overflow 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let overflow = false
  if ((typeof value === 'object' && value !== null) || typeof value === 'function') {
    /**
     * 变量说明：keys 用于处理 keys 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let keys: readonly PropertyKey[] = []
    try {
      keys = Reflect.ownKeys(value)
    } catch {
      overflow = true
    }
    /**
     * 变量说明：key 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const key of keys) {
      if (properties.length === 5) {
        overflow = true
        break
      }
      /**
       * 变量说明：descriptor 用于处理 descriptor 相关数据，作用于当前作用域；其值可能随流程推进而变化，
       * 读写时需遵守声明类型和所在生命周期。
       */
      let descriptor: PropertyDescriptor | undefined
      try {
        descriptor = Reflect.getOwnPropertyDescriptor(value, key)
      } catch {
        continue
      }
      if (descriptor === undefined) continue
      if (!('value' in descriptor)) {
        properties.push({ name: String(key), type: 'accessor' })
        continue
      }
      /**
       * 常量说明：propertyType 用于处理 propertyType 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const propertyType = remoteType(descriptor.value)
      /**
       * 常量说明：propertySubtype 用于处理 propertySubtype 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const propertySubtype = propertyType === 'object' ? subtypeOf(descriptor.value) : undefined
      properties.push({
        name: String(key),
        type: propertyType,
        value: previewText(descriptor.value),
        ...(propertySubtype === undefined ? {} : { subtype: propertySubtype }),
      })
    }
  }
  return {
    type,
    ...(subtype === undefined ? {} : { subtype }),
    description: describe(value),
    overflow,
    properties,
  }
}

/**
 * 功能说明：处理 remoteType 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns RuntimeRemoteObjectType；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 remoteType(value)，并按返回类型处理结果。
 */
function remoteType(value: unknown): RuntimeRemoteObjectType {
  if (value === null) return 'object'
  return typeof value
}

/**
 * 功能说明：处理 subtypeOf 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns RuntimeRemoteObjectSubtype | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 subtypeOf(value)，并按返回类型处理结果。
 */
function subtypeOf(value: unknown): RuntimeRemoteObjectSubtype | undefined {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (ArrayBuffer.isView(value)) return value instanceof DataView ? 'dataview' : 'typedarray'
  if (typeof value !== 'object') return undefined
  /**
   * 变量说明：prototype、subtype 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const [prototype, subtype] of SUBTYPES_BY_PROTOTYPE) {
    if (inheritsFrom(value, prototype)) return subtype
  }
  return undefined
}

/**
 * 功能说明：处理 className 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 className(value)，并按返回类型处理结果。
 */
function className(value: unknown): string {
  if (typeof value === 'function') return functionName(value)
  if (typeof value === 'symbol') return 'Symbol'
  if (typeof value !== 'object' || value === null) return 'Object'
  /**
   * 常量说明：visited 用于处理 visited 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const visited = new Set<object>()
  /**
   * 变量说明：prototype 用于处理 prototype 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let prototype = prototypeOf(value)
  while (prototype !== null && visited.size < MAX_CLASS_PROTOTYPE_DEPTH && !visited.has(prototype)) {
    visited.add(prototype)
    /**
     * 常量说明：constructor 用于处理 constructor 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const constructor = Reflect.getOwnPropertyDescriptor(prototype, 'constructor')
    /**
     * 常量说明：candidate 用于处理 candidate 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const candidate: unknown = constructor !== undefined && 'value' in constructor ? constructor.value : undefined
    if (typeof candidate === 'function') {
      return functionName(candidate)
    }
    prototype = prototypeOf(prototype)
  }
  return 'Object'
}

/**
 * 功能说明：处理 describe 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 describe(value)，并按返回类型处理结果。
 */
function describe(value: unknown): string {
  if (typeof value === 'function') {
    try {
      return Function.prototype.toString.call(value)
    } catch {
      return functionName(value)
    }
  }
  /**
   * 常量说明：subtype 用于处理 subtype 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const subtype = subtypeOf(value)
  if (subtype === 'array') {
    /**
     * 常量说明：descriptor 用于处理 descriptor 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const descriptor = Reflect.getOwnPropertyDescriptor(value as object, 'length')
    /**
     * 常量说明：length 用于处理 length 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const length: unknown = descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined
    return `Array(${typeof length === 'number' ? String(length) : '?'})`
  }
  if (subtype === 'error') {
    /**
     * 常量说明：stack 用于处理 stack 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const stack = ownString(value as object, 'stack')
    if (stack !== undefined) return stack
    /**
     * 常量说明：name 用于处理 name 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const name = ownString(value as object, 'name') ?? className(value)
    /**
     * 常量说明：message 用于处理 message 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const message = ownString(value as object, 'message')
    return message === undefined || message.length === 0 ? name : `${name}: ${message}`
  }
  if (subtype === 'date') {
    try {
      return Date.prototype.toString.call(value)
    } catch {
      return 'Date'
    }
  }
  if (subtype === 'regexp') {
    try {
      return RegExp.prototype.toString.call(value)
    } catch {
      return 'RegExp'
    }
  }
  return className(value)
}

/**
 * 功能说明：处理 previewText 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 previewText(value)，并按返回类型处理结果。
 */
function previewText(value: unknown): string {
  if (typeof value === 'string') return value.slice(0, 100)
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint' || typeof value === 'symbol') {
    return String(value)
  }
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  return describe(value).slice(0, 100)
}

/**
 * 功能说明：处理 functionName 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （object）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 functionName(value)，并按返回类型处理结果。
 */
function functionName(value: object): string {
  try {
    /**
     * 常量说明：descriptor 用于处理 descriptor 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const descriptor = Reflect.getOwnPropertyDescriptor(value, 'name')
    /**
     * 常量说明：name 用于处理 name 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const name: unknown = descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined
    return typeof name === 'string' && name.length > 0 ? name : 'Function'
  } catch {
    return 'Function'
  }
}

/**
 * 功能说明：处理 prototypeOf 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （object）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns object | null；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 prototypeOf(value)，并按返回类型处理结果。
 */
function prototypeOf(value: object): object | null {
  try {
    return Reflect.getPrototypeOf(value)
  } catch {
    return null
  }
}

/**
 * 功能说明：处理 inheritsFrom 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （object）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param expected （object）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 inheritsFrom(value, expected)，并按返回类型处理结果。
 */
function inheritsFrom(value: object, expected: object): boolean {
  /**
   * 常量说明：visited 用于处理 visited 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const visited = new Set<object>()
  /**
   * 变量说明：current 用于处理 current 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let current = prototypeOf(value)
  while (current !== null && visited.size < MAX_CLASS_PROTOTYPE_DEPTH && !visited.has(current)) {
    if (current === expected) return true
    visited.add(current)
    current = prototypeOf(current)
  }
  return false
}

/**
 * 功能说明：处理 ownString 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （object）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param key （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 ownString(value, key)，并按返回类型处理结果。
 */
function ownString(value: object, key: string): string | undefined {
  try {
    /**
     * 常量说明：descriptor 用于处理 descriptor 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key)
    return descriptor !== undefined && 'value' in descriptor && typeof descriptor.value === 'string'
      ? descriptor.value
      : undefined
  } catch {
    return undefined
  }
}

/**
 * 功能说明：渲染 Error 相关流程；使用场景由所在模块及调用位置决定。
 * @param error （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 renderError(error)，并按返回类型处理结果。
 */
function renderError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 常量说明：SUBTYPES_BY_PROTOTYPE 用于处理 SUBTYPES_BY_PROTOTYPE 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const SUBTYPES_BY_PROTOTYPE: readonly (readonly [object, RuntimeRemoteObjectSubtype])[] = [
  [RegExp.prototype, 'regexp'],
  [Date.prototype, 'date'],
  [Map.prototype, 'map'],
  [Set.prototype, 'set'],
  [WeakMap.prototype, 'weakmap'],
  [WeakSet.prototype, 'weakset'],
  [Error.prototype, 'error'],
  [Promise.prototype, 'promise'],
  [ArrayBuffer.prototype, 'arraybuffer'],
  [DataView.prototype, 'dataview'],
]
