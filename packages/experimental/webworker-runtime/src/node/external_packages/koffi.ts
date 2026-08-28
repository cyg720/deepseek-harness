/**
 * `koffi` stub: the FFI bridge the Windows ACL layer and the Landlock launcher
 * use. Type constructors return opaque tokens because the ACL module builds its
 * pointer and struct descriptors at module scope — the plugin must mount. Every
 * entry that would actually cross into native code is loud; on this platform
 * none of it is reachable (`process.platform === 'linux'`, no sandbox).
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 koffi 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */
import { notImplementedFail } from '../notImplementedFail.ts'

/**
 * 常量说明：MODULE 用于处理 MODULE 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const MODULE = 'koffi'

/** Opaque type descriptor standing in for a koffi type handle. */
interface KoffiType {
  readonly __dshKoffiType: string
  /** Byte size under the x64 ABI; struct layout guards compare against it. */
  readonly size: number
  /** Byte alignment under the x64 ABI. */
  readonly alignment: number
}

/** Primitive sizes koffi's own x64 ABI reports.
 * @remarks 中文说明：常量说明：PRIMITIVES 用于处理 PRIMITIVES 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
const PRIMITIVES: Record<string, number> = {
  void: 0,
  bool: 1,
  char: 1,
  uchar: 1,
  int8: 1,
  uint8: 1,
  short: 2,
  ushort: 2,
  int16: 2,
  uint16: 2,
  int: 4,
  uint: 4,
  int32: 4,
  uint32: 4,
  float: 4,
  float32: 4,
  long: 8,
  ulong: 8,
  longlong: 8,
  ulonglong: 8,
  int64: 8,
  uint64: 8,
  double: 8,
  float64: 8,
  str: 8,
  str16: 8,
}

/**
 * 常量说明：token 用于处理 token 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 token 相关流程；使用场景由所在模块及调用位置决定。
 * @param label （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param size （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param alignment （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns KoffiType；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 token(label, size, alignment)，并按返回类型处理结果。
 */
const token = (label: string, size: number, alignment = Math.min(size, 8) || 1): KoffiType =>
  ({ __dshKoffiType: label, size, alignment })

/**
 * 常量说明：typeOf 用于处理 typeOf 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 typeOf 相关流程；使用场景由所在模块及调用位置决定。
 * @param target （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns KoffiType；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 typeOf(target)，并按返回类型处理结果。
 */
const typeOf = (target: unknown): KoffiType => {
  if (typeof target === 'string') {
    /**
     * 常量说明：size 用于处理 size 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const size = PRIMITIVES[target]
    if (size === undefined) throw new Error(`web-preview: koffi type "${target}" is unknown to the stub`)
    return token(target, size)
  }
  /**
   * 常量说明：descriptor 用于处理 descriptor 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const descriptor = target as KoffiType | undefined
  if (descriptor?.__dshKoffiType === undefined) {
    throw new Error(`web-preview: koffi type ${JSON.stringify(target)} is not a stub descriptor`)
  }
  return descriptor
}

/**
 * 常量说明：describe 用于处理 describe 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 describe 相关流程；使用场景由所在模块及调用位置决定。
 * @param target （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 describe(target)，并按返回类型处理结果。
 */
const describe = (target: unknown): string =>
  typeof target === 'string' ? target : (target as KoffiType | undefined)?.__dshKoffiType ?? 'anonymous'

/**
 * Pointer type descriptor.
 * @param target - pointee type name or descriptor.
 * @returns the descriptor token.
 * @remarks 中文说明：功能说明：处理 pointer 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：target（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：KoffiType；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 pointer(target)，
 * 并按返回类型处理结果。
 */
function pointer(target: unknown): KoffiType {
  return token(`pointer(${describe(target)})`, 8)
}

/**
 * Struct type descriptor. The size and alignment are computed with the same
 * padding rules koffi uses on x64, because the Windows ACL layer compares them
 * against its own header probe at module scope.
 * @param name - struct name, or the field record when the name is omitted.
 * @param fields - field name → type record.
 * @returns the descriptor token.
 * @remarks 中文说明：功能说明：处理 struct 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：name（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：fields（Record<string, unknown>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：KoffiType；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * struct(name, fields)，并按返回类型处理结果。
 */
function struct(name: unknown, fields?: Record<string, unknown>): KoffiType {
  /**
   * 常量说明：members 用于处理 members 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const members = (typeof name === 'string' ? fields : name as Record<string, unknown>) ?? {}
  /**
   * 变量说明：offset 用于处理 offset 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let offset = 0
  /**
   * 变量说明：alignment 用于处理 alignment 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let alignment = 1
  /**
   * 变量说明：member 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const member of Object.values(members)) {
    /**
     * 常量说明：type 用于处理 type 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const type = typeOf(member)
    alignment = Math.max(alignment, type.alignment)
    offset = Math.ceil(offset / type.alignment) * type.alignment + type.size
  }
  /**
   * 常量说明：size 用于处理 size 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const size = Math.ceil(offset / alignment) * alignment
  return token(`struct(${typeof name === 'string' ? name : 'anonymous'})`, size, alignment)
}

/**
 * Array type descriptor.
 * @param target - element type.
 * @param length - element count.
 * @returns the descriptor token.
 * @remarks 中文说明：功能说明：处理 array 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：target（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：length（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：KoffiType；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 array(target, length)，
 * 并按返回类型处理结果。
 */
function array(target: unknown, length: number): KoffiType {
  /**
   * 常量说明：element 用于处理 element 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const element = typeOf(target)
  return token(`array(${element.__dshKoffiType}, ${String(length)})`, element.size * length, element.alignment)
}

/**
 * Opaque type descriptor.
 * @param name - type name.
 * @returns the descriptor token.
 * @remarks 中文说明：功能说明：处理 opaque 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：name（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：KoffiType；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 opaque(name)，并按返回类型处理结果。
 */
function opaque(name?: string): KoffiType {
  return token(`opaque(${name ?? 'anonymous'})`, 0, 1)
}

/** Primitive type table; members carry their x64 sizes.
 * @remarks 中文说明：常量说明：types 用于处理 types 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_target（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：property（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(_target, property)，
 * 并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：property（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(property)，并按返回类型处理结果。
 */
const types: Record<string, KoffiType> = new Proxy({}, {
  get: (_target, property) => typeOf(String(property)),
  has: property => typeof property === 'string' && property in PRIMITIVES,
})

/** The koffi face its consumers read; every call refuses.
 * @remarks 中文说明：常量说明：koffi 用于处理 koffi 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：name（string）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；参数：target（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：KoffiType；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(name,
 * target)，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：target（unknown）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：number；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用
 * 匿名回调(target)，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：target（unknown）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：number；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用
 * 匿名回调(target)，并按返回类型处理结果。
 */
const koffi = {
  pointer,
  struct,
  array,
  opaque,
  types,
  alias: (name: string, target: unknown): KoffiType => {
    /**
     * 常量说明：type 用于处理 type 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const type = typeOf(target)
    return token(`alias(${name})`, type.size, type.alignment)
  },
  sizeof: (target: unknown): number => typeOf(target).size,
  alignof: (target: unknown): number => typeOf(target).alignment,
  load: notImplementedFail(MODULE, 'load'),
  alloc: notImplementedFail(MODULE, 'alloc'),
  free: notImplementedFail(MODULE, 'free'),
  decode: notImplementedFail(MODULE, 'decode'),
  encode: notImplementedFail(MODULE, 'encode'),
  address: notImplementedFail(MODULE, 'address'),
  register: notImplementedFail(MODULE, 'register'),
  unregister: notImplementedFail(MODULE, 'unregister'),
  call: notImplementedFail(MODULE, 'call'),
}

export { pointer, struct, array, opaque, types }

/** CommonJS interop marker: the worker loader hands `default` to default imports (see ./builtins.ts).
 * @remarks 中文说明：常量说明：__esModule 用于处理 __esModule 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const __esModule = true

export default koffi
