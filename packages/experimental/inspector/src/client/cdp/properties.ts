/** Lazy Client property enumeration for `Runtime.getProperties`.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 properties 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type {
  ClientRuntimeGetPropertiesCommand,
  ClientRuntimeInternalPropertyDescriptor,
  ClientRuntimePropertyDescriptor,
} from '../../shared/bridge/messages/runtime/index.ts'
import { ClientRuntimeExecutionError } from './errors.ts'
import { ClientObjectStore, type ClientObjectAllocation } from './objects.ts'

/**
 * Read property descriptors without invoking getters.
 * @param objects - Object table that owns the requested handle.
 * @param command - Validated property request.
 * @param maxProperties - Maximum descriptors returned by this operation.
 * @param allocation - Current operation's object-allocation identity.
 * @returns Own or inherited descriptors and the immediate prototype.
 * @remarks 中文说明：功能说明：获取 Client Properties 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：objects（ClientObjectStore）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：command（ClientRuntimeGetPropertiesCommand）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；参数说明：maxProperties（number）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；参数说明：allocation（ClientObjectAllocation）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：{ readonly properties: readonly
 * ClientRuntimePropertyDescriptor[] rea…；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 getClientProperties(objects, command,
 * maxProperties, allocation)，并按返回类型处理结果。
 */
export function getClientProperties(
  objects: ClientObjectStore,
  command: ClientRuntimeGetPropertiesCommand,
  maxProperties: number,
  allocation: ClientObjectAllocation,
): {
  readonly properties: readonly ClientRuntimePropertyDescriptor[]
  readonly internalProperties?: readonly ClientRuntimeInternalPropertyDescriptor[]
} {
  /**
   * 常量说明：raw 用于处理 raw 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const raw = objects.get(command.handle)
  if (!isObjectLike(raw)) return { properties: [] }
  /**
   * 常量说明：value 用于处理 value 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const value: object = typeof raw === 'symbol' ? Symbol.prototype : raw
  /**
   * 常量说明：group 用于处理 group 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const group = objects.group(command.handle)
  /**
   * 常量说明：properties 用于处理 properties 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const properties: ClientRuntimePropertyDescriptor[] = []
  /**
   * 常量说明：seen 用于处理 seen 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const seen = new Set<PropertyKey>()
  /**
   * 常量说明：visited 用于处理 visited 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const visited = new Set<object>()
  /**
   * 变量说明：owner 用于处理 owner 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let owner: object | null = value
  /**
   * 变量说明：own 用于处理 own 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let own = true

  while (owner !== null) {
    if (visited.has(owner) || visited.size >= maxProperties) {
      throw new ClientRuntimeExecutionError('result-too-large', 'Client prototype traversal exceeded its configured limit')
    }
    visited.add(owner)
    /**
     * 常量说明：keys 用于处理 keys 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const keys = readKeys(owner)
    /**
     * 变量说明：key 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const key of keys) {
      if (seen.has(key)) continue
      seen.add(key)
      if (command.nonIndexedPropertiesOnly === true && typeof key === 'string' && isArrayIndex(key)) continue
      /**
       * 常量说明：descriptor 用于处理 descriptor 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const descriptor = readDescriptor(owner, key)
      if (descriptor === undefined) continue
      if (command.accessorPropertiesOnly === true && 'value' in descriptor) continue
      if (properties.length >= maxProperties) {
        throw new ClientRuntimeExecutionError(
          'result-too-large',
          `Client property result exceeds the configured ${String(maxProperties)}-property limit`,
        )
      }
      properties.push(toRemoteDescriptor(
        objects,
        key,
        descriptor,
        group,
        own,
        command.generatePreview === true,
        allocation,
      ))
    }
    if (command.ownProperties === true) break
    owner = readPrototype(owner)
    own = false
  }

  if (command.accessorPropertiesOnly === true) return { properties }
  /**
   * 常量说明：prototype 用于处理 prototype 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const prototype = readPrototype(value)
  /**
   * 常量说明：internalProperties 用于处理 internalProperties 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const internalProperties: ClientRuntimeInternalPropertyDescriptor[] = prototype === null
    ? []
    : [{
      name: '[[Prototype]]',
      value: objects.serialize(prototype, remoteOptions(group, command.generatePreview), allocation),
    }]
  return { properties, internalProperties }
}

/**
 * 功能说明：处理 toRemoteDescriptor 相关流程；使用场景由所在模块及调用位置决定。
 * @param objects （ClientObjectStore）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param key （PropertyKey）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param descriptor （PropertyDescriptor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param group （string | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param own （boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param generatePreview （boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param allocation （ClientObjectAllocation）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns ClientRuntimePropertyDescriptor；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 toRemoteDescriptor(objects, key, descriptor, group,
 * own, generatePreview, allocation)，并按返回类型处理结果。
 */
function toRemoteDescriptor(
  objects: ClientObjectStore,
  key: PropertyKey,
  descriptor: PropertyDescriptor,
  group: string | undefined,
  own: boolean,
  generatePreview: boolean,
  allocation: ClientObjectAllocation,
): ClientRuntimePropertyDescriptor {
  /**
   * 常量说明：common 用于处理 common 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const common = {
    name: typeof key === 'symbol' ? key.description ?? String(key) : String(key),
    configurable: descriptor.configurable ?? false,
    enumerable: descriptor.enumerable ?? false,
    isOwn: own,
    ...(typeof key === 'symbol' ? { symbol: objects.serialize(key, remoteOptions(group), allocation) } : {}),
  }
  if ('value' in descriptor) {
    return {
      ...common,
      value: objects.serialize(descriptor.value, remoteOptions(group, generatePreview), allocation),
      writable: descriptor.writable ?? false,
    }
  }
  /**
   * 常量说明：getter 用于处理 getter 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const getter = Reflect.get(descriptor, 'get') as (() => unknown) | undefined
  /**
   * 常量说明：setter 用于处理 setter 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const setter = Reflect.get(descriptor, 'set') as ((value: unknown) => void) | undefined
  return {
    ...common,
    ...(getter === undefined ? {} : { get: objects.serialize(getter, remoteOptions(group), allocation) }),
    ...(setter === undefined ? {} : { set: objects.serialize(setter, remoteOptions(group), allocation) }),
  }
}

/**
 * 功能说明：读取 Keys 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （object）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns readonly PropertyKey[]；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 readKeys(value)，并按返回类型处理结果。
 */
function readKeys(value: object): readonly PropertyKey[] {
  /**
   * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
   */
  try {
    return Reflect.ownKeys(value)
  } catch (error) {
    throw new ClientRuntimeExecutionError('internal-error', `Cannot enumerate Client object: ${renderError(error)}`)
  }
}

/**
 * 功能说明：读取 Descriptor 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （object）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param key （PropertyKey）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns PropertyDescriptor | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 readDescriptor(value, key)，并按返回类型处理结果。
 */
function readDescriptor(value: object, key: PropertyKey): PropertyDescriptor | undefined {
  /**
   * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
   */
  try {
    return Reflect.getOwnPropertyDescriptor(value, key)
  } catch (error) {
    throw new ClientRuntimeExecutionError('internal-error', `Cannot read Client property ${String(key)}: ${renderError(error)}`)
  }
}

/**
 * 功能说明：读取 Prototype 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （object）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns object | null；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 readPrototype(value)，并按返回类型处理结果。
 */
function readPrototype(value: object): object | null {
  /**
   * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
   */
  try {
    return Object.getPrototypeOf(value) as object | null
  } catch (error) {
    throw new ClientRuntimeExecutionError('internal-error', `Cannot read Client object prototype: ${renderError(error)}`)
  }
}

/**
 * 功能说明：判断是否为 Object Like 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns value is object | symbol；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 isObjectLike(value)，并按返回类型处理结果。
 */
function isObjectLike(value: unknown): value is object | symbol {
  return (typeof value === 'object' && value !== null) || typeof value === 'function' || typeof value === 'symbol'
}

/**
 * 功能说明：判断是否为 Array Index 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 isArrayIndex(value)，并按返回类型处理结果。
 */
function isArrayIndex(value: string): boolean {
  /**
   * 常量说明：number 用于处理 number 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const number = Number(value)
  return Number.isInteger(number) && number >= 0 && number < 4_294_967_295 && String(number) === value
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
 * 功能说明：处理 remoteOptions 相关流程；使用场景由所在模块及调用位置决定。
 * @param group （string | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param generatePreview （boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns { readonly group?: string readonly generatePreview?: boolean }；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 remoteOptions(group, generatePreview)，并按返回类型处理结果。
 */
function remoteOptions(group: string | undefined, generatePreview?: boolean): {
  readonly group?: string
  readonly generatePreview?: boolean
} {
  return {
    ...(group === undefined ? {} : { group }),
    ...(generatePreview === undefined ? {} : { generatePreview }),
  }
}
