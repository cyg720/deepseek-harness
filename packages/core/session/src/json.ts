/** Lossless-JSON validation and detached snapshots for durable session data. @module @deepseek-ai/dsh-session/json */
/**
 * ================================ 文件注释 ================================
 * 【文件职责】为耐久会话数据提供“无损 JSON”的运行时校验与分离快照（detached snapshot）：
 *           判定一个值能否经 JSON 往返而不丢失任何信息，并能一次性完成“校验 + 深拷贝”。
 * 【技术维度】迭代式（显式任务栈）遍历代替递归，嵌套深度不受 JS 调用栈限制；原型链白名单
 *            （只接受内在 Array/Object 原型或 null 原型，且跨 JS realm 兼容）；拒绝稀疏数组、
 *            循环引用、异构对象（Date/Map/Set/类实例）、-0 与非有限数；“每属性只读一次”
 *            防有状态 getter 在校验与拷贝之间给出不同的值。
 * 【产品维度】会话日志要能字节级一致地重放：append 进日志的一切事件数据都必须是无损 JSON，
 *           否则在源头就被拒绝——这支撑了“模型可见 ⟺ 可从日志重建”的架构承诺。
 * 【逻辑维度】JsonValue 是递归类型定义；四个原型检查辅助函数；enumerableStringKeys 拒绝会被
 *           JSON 丢弃的属性；walkJsonValue 是核心迭代校验/快照引擎；snapshotJsonValue =
 *           校验 + 分离拷贝，isJsonValue = 只校验不拷贝。
 * 【关键边界】toJSON 被忽略、getter 会被求值（所以持久化边界应使用 snapshotJsonValue）；
 *           BigInt/function/symbol/undefined、稀疏与循环结构、负零与非有限数都被拒；
 *           getter 抛错会向上传播。
 * 【新手阅读建议】先读 JsonValue 的类型注释建立“什么能进日志”的直觉，再读 walkJsonValue
 *           理解任务栈遍历与 ancestors 防环机制，最后对照两个公开导出的用途差异。
 * ==========================================================================
 */

/**
 * A value that round-trips losslessly through JSON: `null`, a boolean, a finite
 * number other than negative zero, a string, an array of such values, or a
 * plain object whose values are such values. Arrays may carry only their dense
 * indexed elements; extra own properties would be discarded by JSON. TypeScript
 * cannot distinguish `-0` from `number`, so {@link isJsonValue} and
 * {@link snapshotJsonValue} enforce these details at runtime. Use this type for
 * a payload that must survive session-log persistence and replay byte-identically
 * — e.g. a tool's private presentation `meta`.
 */
/**
 * 能经 JSON 无损往返的值：null、布尔、除负零外的有限数字、字符串、这类值的数组、
 * 或值同样受限的普通对象。数组只包含稠密索引元素——额外的自有属性会被 JSON 丢弃。
 * TypeScript 无法区分 -0 与 number，所以 isJsonValue 与 snapshotJsonValue 在运行时强制这些细节。
 * 凡是要在会话日志持久化与重放之间字节级一致的载荷都用这个类型，例如工具私有的展示 meta。
 */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

/** Whether a realm-owned intrinsic prototype is backed by its native constructor. */
/** 判断某个 realm（JS 执行环境，如 iframe/vm 沙箱）自有的内在原型是否确实由其原生构造函数支撑（防伪造原型）。 */
function hasIntrinsicConstructor(prototype: object, name: 'Array' | 'Object'): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'constructor')
  const constructor: unknown = descriptor?.value
  if (typeof constructor !== 'function') return false
  try {
    return constructor.name === name
      && constructor.prototype === prototype
      && Function.prototype.toString.call(constructor) === `function ${name}() { [native code] }`
  } catch {
    return false
  }
}

/** Whether a candidate is one realm's intrinsic `Object.prototype`. */
/** 判断一个对象是否是某个 realm 的内在 Object.prototype（原型链顶端且构造器匹配）。 */
function isIntrinsicObjectPrototype(value: object): boolean {
  return Object.getPrototypeOf(value) === null && hasIntrinsicConstructor(value, 'Object')
}

/** Whether an array uses one realm's intrinsic `Array.prototype`, not a subclass or forged prototype. */
/** 判断数组使用的是某 realm 的内在 Array.prototype，而非子类或伪造原型。 */
function hasPlainArrayPrototype(value: unknown[]): boolean {
  const prototype: unknown = Object.getPrototypeOf(value)
  if (!Array.isArray(prototype) || !hasIntrinsicConstructor(prototype, 'Array')) return false
  const objectPrototype: unknown = Object.getPrototypeOf(prototype)
  return typeof objectPrototype === 'object'
    && objectPrototype !== null
    && isIntrinsicObjectPrototype(objectPrototype)
}

/** Whether an object is a plain or null-prototype record from any JavaScript realm. */
/** 判断对象是来自任意 JavaScript realm 的普通对象或 null 原型记录。 */
function hasPlainObjectPrototype(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === null
    || typeof prototype === 'object' && isIntrinsicObjectPrototype(prototype)
}

/** Return every JSON-visible object key, or reject own data JSON would discard. */
/** 返回 JSON 可见的全部自有键；存在符号键或不可枚举的自有属性（JSON 会丢掉它们）时返回 undefined。 */
function enumerableStringKeys(value: object): string[] | undefined {
  const keys = Reflect.ownKeys(value)
  if (keys.some(key => typeof key !== 'string' || !Object.prototype.propertyIsEnumerable.call(value, key))) return undefined
  return keys as string[]
}

// 快照赋值目的地：根、数组的某下标、或对象的某键。
type SnapshotDestination =
  | { kind: 'root' }
  | { kind: 'array'; target: JsonValue[]; index: number }
  | { kind: 'object'; target: { [key: string]: JsonValue }; key: string }

// 迭代遍历的任务种类：访问值、处理数组元素、处理对象属性、离开容器（解除祖先占用）。
type JsonWalkTask =
  | { kind: 'visit'; value: unknown; destination?: SnapshotDestination }
  | { kind: 'array-item'; source: unknown[]; index: number; target?: JsonValue[] }
  | { kind: 'object-property'; source: Record<string, unknown>; key: string; target?: { [key: string]: JsonValue } }
  | { kind: 'leave'; source: object }

/** Validate lossless JSON iteratively, optionally materializing a detached snapshot. */
/** 以迭代方式校验无损 JSON，可选地产出一份分离的快照副本。返回 true（仅校验）、快照值，非法时为 undefined。 */
function walkJsonValue(value: unknown, detach: boolean): JsonValue | true | undefined {
  // 正在容器栈中的祖先对象集合，用于检测循环引用。
  const ancestors = new Set<object>()
  // detach 模式下最终快照的落点。
  let root: JsonValue | undefined
  // 把校验通过的值写入指定目的地（根/数组元素/对象属性）。
  const assign = (destination: SnapshotDestination | undefined, item: JsonValue): void => {
    if (destination === undefined) return
    if (destination.kind === 'root') {
      root = item
    } else if (destination.kind === 'array') {
      destination.target[destination.index] = item
    } else {
      Object.defineProperty(destination.target, destination.key, {
        value: item,
        enumerable: true,
        configurable: true,
        writable: true,
      })
    }
  }

  // 显式的待办任务栈，代替递归调用栈；后进先出保证深度优先。
  const tasks: JsonWalkTask[] = [{
    kind: 'visit',
    value,
    ...(detach ? { destination: { kind: 'root' } as const } : {}),
  }]
  for (let task = tasks.pop(); task !== undefined; task = tasks.pop()) {
    if (task.kind === 'leave') {
      ancestors.delete(task.source)
      continue
    }
    if (task.kind === 'array-item') {
      if (!Object.prototype.hasOwnProperty.call(task.source, task.index)) return undefined
      tasks.push({
        kind: 'visit',
        value: task.source[task.index],
        ...(task.target === undefined ? {} : { destination: { kind: 'array', target: task.target, index: task.index } as const }),
      })
      continue
    }
    if (task.kind === 'object-property') {
      tasks.push({
        kind: 'visit',
        value: task.source[task.key],
        ...(task.target === undefined ? {} : { destination: { kind: 'object', target: task.target, key: task.key } as const }),
      })
      continue
    }

    const current = task.value
    if (current === null) {
      assign(task.destination, null)
      continue
    }
    if (typeof current === 'boolean' || typeof current === 'string') {
      assign(task.destination, current)
      continue
    }
    if (typeof current === 'number') {
      if (!Number.isFinite(current) || Object.is(current, -0)) return undefined
      assign(task.destination, current)
      continue
    }
    if (typeof current !== 'object') return undefined
    if (ancestors.has(current)) return undefined

    if (Array.isArray(current)) {
      if (!hasPlainArrayPrototype(current)) return undefined
      const length = current.length
      if (Reflect.ownKeys(current).length !== length + 1) return undefined
      const target = detach ? [] as JsonValue[] : undefined
      if (target !== undefined) assign(task.destination, target)
      ancestors.add(current)
      tasks.push({ kind: 'leave', source: current })
      for (let index = length - 1; index >= 0; index--) {
        tasks.push({ kind: 'array-item', source: current, index, ...(target === undefined ? {} : { target }) })
      }
      continue
    }

    if (!hasPlainObjectPrototype(current)) return undefined
    const keys = enumerableStringKeys(current)
    if (keys === undefined) return undefined
    const target = detach ? {} as { [key: string]: JsonValue } : undefined
    if (target !== undefined) assign(task.destination, target)
    ancestors.add(current)
    tasks.push({ kind: 'leave', source: current })
    for (let index = keys.length - 1; index >= 0; index--) {
      const key = keys[index]
      /* v8 ignore next -- the loop is bounded by the captured key count. */
      if (key === undefined) return undefined
      tasks.push({ kind: 'object-property', source: current as Record<string, unknown>, key, ...(target === undefined ? {} : { target }) })
    }
  }
  return detach ? root : true
}

/**
 * Validate and detach lossless JSON in one read per property, so a stateful
 * getter cannot change between validation and copying. Traversal is iterative,
 * so valid nesting is bounded by available memory rather than the JavaScript
 * call stack. Accepts ordinary arrays, plain or null-prototype objects, and JSON
 * scalars; rejects sparse, cyclic, exotic, negative-zero, and non-finite values.
 * Getter throws propagate.
 *
 * @param value - the candidate value to validate and detach.
 * @returns the detached snapshot, or `undefined` when the value is not
 *   losslessly JSON-serializable.
 */
/**
 * 一次读取即完成校验与分离拷贝，确保有状态的 getter 无法在校验与复制之间给出不同的值。
 * 遍历是迭代的，因此合法嵌套深度只受内存限制而不受 JS 调用栈限制。接受普通数组、
 * 普通或 null 原型对象以及 JSON 标量；拒绝稀疏、循环、异构、负零与非有限值；getter 抛错会传播。
 * @param value - 待校验并分离的候选值。
 * @returns 分离出的快照；该值不能无损 JSON 序列化时为 undefined。
 */
export function snapshotJsonValue<T>(value: T): T | undefined {
  return walkJsonValue(value, true) as T | undefined
}

/**
 * Test the same lossless JSON boundary as {@link snapshotJsonValue} without
 * detaching it. Only own enumerable string properties participate; `toJSON`
 * is ignored and getters run, so persistence boundaries use the snapshotter.
 * @param value - the candidate event data to test.
 * @returns whether `value` survives JSON round-trip losslessly.
 */
/**
 * 与 snapshotJsonValue 相同的无损 JSON 判定，但只测试不拷贝。
 * 只有自己的可枚举字符串属性参与判定；toJSON 被忽略、getter 会被求值，
 * 因此持久化边界请改用快照函数。
 * @param value - 待判定的事件数据候选值。
 * @returns 该值能否无损通过 JSON 往返。
 */
export function isJsonValue(value: unknown): boolean {
  return walkJsonValue(value, false) === true
}
