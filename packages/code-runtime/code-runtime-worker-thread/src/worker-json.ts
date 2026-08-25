/**
 * Lossless-JSON snapshots for the dependency-free source worker closure.
 * @module @deepseek-ai/dsh-code-runtime-worker-thread/worker-json
 */
/*
 * 文件职责：实现代码运行时的 worker-json 模块。
 * 技术维度：TypeScript、Cordis 插件、Worker/JSON 协议和严格类型。
 * 产品维度：为产品提供代码运行时能力。
 * 逻辑维度：解析配置或协议，执行核心流程并返回结构化结果。
 * 关键边界：跨线程和模型输入属于不可信边界；资源与事件注册必须清理。
 * 新手阅读建议：先读导出类型与配置，再跟踪入口和错误分支。
 */

import type { CodeJsonValue } from '@deepseek-ai/dsh-code-runtime'

/* jscpd:ignore-start -- the source worker mirrors session JSON helpers without workspace runtime imports */
/** 中文说明：类型或类 IntrinsicCallable 约束协议数据或模块职责。 */
type IntrinsicCallable = (this: unknown, ...args: unknown[]) => unknown

/** 中文说明：运行时局部值 intrinsicFunctionToString，由紧邻初始化决定。 */
const intrinsicFunctionToString = Reflect.get(Function.prototype, 'toString') as IntrinsicCallable
/** 中文说明：运行时局部值 intrinsicReflectApply，由紧邻初始化决定。 */
const intrinsicReflectApply = Reflect.get(Reflect, 'apply') as (
  target: IntrinsicCallable,
  thisArgument: unknown,
  argumentsList: readonly unknown[],
) => unknown
/** 中文说明：运行时局部值 IntrinsicError，由紧邻初始化决定。 */
const IntrinsicError = Error
/** 中文说明：运行时局部值 IntrinsicSet，由紧邻初始化决定。 */
const IntrinsicSet = Set
/** 中文说明：运行时局部值 intrinsicArrayIsArray，由紧邻初始化决定。 */
const intrinsicArrayIsArray = Array.isArray
/** 中文说明：运行时局部值 intrinsicArrayPrototype，由紧邻初始化决定。 */
const intrinsicArrayPrototype = Array.prototype
/** 中文说明：运行时局部值 intrinsicNumberIsFinite，由紧邻初始化决定。 */
const intrinsicNumberIsFinite = Number.isFinite
/** 中文说明：运行时局部值 解构结果，由紧邻初始化决定。 */
const intrinsicNumberIsSafeInteger = Number.isSafeInteger
/** 中文说明：运行时局部值 intrinsicObjectCreate，由紧邻初始化决定。 */
const intrinsicObjectCreate = Object.create
/** 中文说明：运行时局部值 解构结果，由紧邻初始化决定。 */
const intrinsicObjectDefineProperty = Object.defineProperty
/** 中文说明：运行时局部值 解构结果，由紧邻初始化决定。 */
const intrinsicObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor
/** 中文说明：运行时局部值 解构结果，由紧邻初始化决定。 */
const intrinsicObjectGetPrototypeOf = Object.getPrototypeOf
/** 中文说明：运行时局部值 intrinsicObjectHasOwn，由紧邻初始化决定。 */
const intrinsicObjectHasOwn = Object.hasOwn
/** 中文说明：运行时局部值 intrinsicObjectIs，由紧邻初始化决定。 */
const intrinsicObjectIs = Object.is
/** 中文说明：运行时局部值 intrinsicObjectKeys，由紧邻初始化决定。 */
const intrinsicObjectKeys = Object.keys
/** 中文说明：运行时局部值 intrinsicObjectPrototype，由紧邻初始化决定。 */
const intrinsicObjectPrototype = Object.prototype
/** 中文说明：运行时局部值 解构结果，由紧邻初始化决定。 */
const intrinsicObjectPropertyIsEnumerable = Reflect.get(intrinsicObjectPrototype, 'propertyIsEnumerable') as IntrinsicCallable
/** 中文说明：运行时局部值 intrinsicReflectOwnKeys，由紧邻初始化决定。 */
const intrinsicReflectOwnKeys = Reflect.ownKeys
/** 中文说明：运行时局部值 intrinsicSetAdd，由紧邻初始化决定。 */
const intrinsicSetAdd = Reflect.get(Set.prototype, 'add') as IntrinsicCallable
/** 中文说明：运行时局部值 intrinsicSetDelete，由紧邻初始化决定。 */
const intrinsicSetDelete = Reflect.get(Set.prototype, 'delete') as IntrinsicCallable
/** 中文说明：运行时局部值 intrinsicSetHas，由紧邻初始化决定。 */
const intrinsicSetHas = Reflect.get(Set.prototype, 'has') as IntrinsicCallable

/** Build a data descriptor that cannot inherit model-defined accessor fields. */
/* 中文说明：函数 dataDescriptor 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function dataDescriptor(value: unknown): PropertyDescriptor {
  /** 中文说明：运行时局部值 descriptor，由紧邻初始化决定。 */
  const descriptor = intrinsicObjectCreate(null) as PropertyDescriptor
  descriptor.value = value
  return descriptor
}

/** Define an ordinary enumerable data slot without a prototype-bearing descriptor. */
/* 中文说明：函数 defineEnumerableDataProperty 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function defineEnumerableDataProperty(target: object, key: PropertyKey, value: unknown): void {
  /** 中文说明：运行时局部值 descriptor，由紧邻初始化决定。 */
  const descriptor = dataDescriptor(value)
  descriptor.enumerable = true
  descriptor.configurable = true
  descriptor.writable = true
  intrinsicObjectDefineProperty(target, key, descriptor)
}

/** Append without consulting a model-mutated `Array.prototype`. */
/* 中文说明：函数 append 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function append<T>(target: T[], value: T): void {
  defineEnumerableDataProperty(target, target.length, value)
}

/** Pop without consulting a model-mutated `Array.prototype`. */
/* 中文说明：函数 takeLast 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function takeLast<T>(target: T[]): T | undefined {
  if (target.length === 0) return undefined
  /** 中文说明：运行时局部值 index，由紧邻初始化决定。 */
  const index = target.length - 1
  /** 中文说明：运行时局部值 value，由紧邻初始化决定。 */
  const value = target[index]
  intrinsicObjectDefineProperty(target, 'length', dataDescriptor(index))
  return value
}

/** Whether one captured-intrinsic Set contains a value. */
/* 中文说明：函数 setHas 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function setHas<T>(target: Set<T>, value: T): boolean {
  return intrinsicReflectApply(intrinsicSetHas, target, [value]) as boolean
}

/** Add to one captured-intrinsic Set. */
/* 中文说明：函数 setAdd 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function setAdd<T>(target: Set<T>, value: T): void {
  intrinsicReflectApply(intrinsicSetAdd, target, [value])
}

/** Delete from one captured-intrinsic Set. */
/* 中文说明：函数 setDelete 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function setDelete<T>(target: Set<T>, value: T): void {
  intrinsicReflectApply(intrinsicSetDelete, target, [value])
}

/** Whether a realm-owned intrinsic prototype is backed by its native constructor. */
/* 中文说明：函数 hasIntrinsicConstructor 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function hasIntrinsicConstructor(prototype: object, name: 'Array' | 'Object'): boolean {
  /** 中文说明：运行时局部值 descriptor，由紧邻初始化决定。 */
  const descriptor = intrinsicObjectGetOwnPropertyDescriptor(prototype, 'constructor')
  /** 中文说明：运行时局部值 constructor，由紧邻初始化决定。 */
  const constructor: unknown = descriptor?.value
  if (typeof constructor !== 'function') return false
  try {
    return constructor.name === name
      && constructor.prototype === prototype
      && intrinsicReflectApply(intrinsicFunctionToString, constructor, []) === `function ${name}() { [native code] }`
  } catch {
    return false
  }
}

/** Whether a candidate is a foreign realm's intrinsic `Object.prototype`. */
/* 中文说明：函数 isForeignIntrinsicObjectPrototype 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function isForeignIntrinsicObjectPrototype(value: object): boolean {
  return intrinsicObjectGetPrototypeOf(value) === null && hasIntrinsicConstructor(value, 'Object')
}

/** Whether an array uses one realm's intrinsic `Array.prototype`, not a subclass or forged prototype. */
/* 中文说明：函数 hasPlainArrayPrototype 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function hasPlainArrayPrototype(value: unknown[]): boolean {
  /** 中文说明：运行时局部值 prototype，由紧邻初始化决定。 */
  const prototype: unknown = intrinsicObjectGetPrototypeOf(value)
  if (prototype === intrinsicArrayPrototype) return true
  if (!intrinsicArrayIsArray(prototype) || !hasIntrinsicConstructor(prototype, 'Array')) return false
  /** 中文说明：运行时局部值 objectPrototype，由紧邻初始化决定。 */
  const objectPrototype: unknown = intrinsicObjectGetPrototypeOf(prototype)
  return typeof objectPrototype === 'object'
    && objectPrototype !== null
    && isForeignIntrinsicObjectPrototype(objectPrototype)
}

/** Whether an object is a plain or null-prototype record from any JavaScript realm. */
/* 中文说明：函数 hasPlainObjectPrototype 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function hasPlainObjectPrototype(value: object): boolean {
  /** 中文说明：运行时局部值 prototype，由紧邻初始化决定。 */
  const prototype: unknown = intrinsicObjectGetPrototypeOf(value)
  return prototype === null
    || prototype === intrinsicObjectPrototype
    || typeof prototype === 'object' && isForeignIntrinsicObjectPrototype(prototype)
}

/** Return every JSON-visible object key, or reject own data JSON would discard. */
/* 中文说明：函数 enumerableStringKeys 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function enumerableStringKeys(value: object): string[] | undefined {
  /** 中文说明：运行时局部值 keys，由紧邻初始化决定。 */
  const keys = intrinsicReflectOwnKeys(value)
  /** 中文说明：运行时局部值 index，由紧邻初始化决定。 */
  for (let index = 0; index < keys.length; index++) {
    /** 中文说明：运行时局部值 key，由紧邻初始化决定。 */
    const key = keys[index]
    if (typeof key !== 'string' || !intrinsicReflectApply(intrinsicObjectPropertyIsEnumerable, value, [key])) return undefined
  }
  return keys as string[]
}

/** 中文说明：类型或类 SnapshotDestination 约束协议数据或模块职责。 */
type SnapshotDestination =
  | { kind: 'root' }
  | { kind: 'array'; target: CodeJsonValue[]; index: number }
  | { kind: 'object'; target: Record<string, CodeJsonValue>; key: string }

/** 中文说明：类型或类 SnapshotTask 约束协议数据或模块职责。 */
type SnapshotTask =
  | { kind: 'visit'; value: unknown; destination: SnapshotDestination }
  | { kind: 'array-item'; source: unknown[]; index: number; target: CodeJsonValue[] }
  | { kind: 'object-property'; source: Record<string, unknown>; key: string; target: Record<string, CodeJsonValue> }
  | { kind: 'leave'; source: object }

/**
 * Validate and detach one worker-boundary value without loading another
 * workspace package at runtime. This mirrors the session-owned canonical
 * JSON boundary while remaining safe to import from the unbuilt worker.
 * Its iterative traversal adds no JavaScript call-stack depth limit.
 *
 * @param value - the candidate completion value.
 * @returns a detached lossless-JSON snapshot, or `undefined` when invalid.
 */
/* 中文说明：函数 snapshotCodeJsonValue 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function snapshotCodeJsonValue(value: unknown): CodeJsonValue | undefined {
  /** 中文说明：运行时局部值 active，由紧邻初始化决定。 */
  const active = new IntrinsicSet<object>()
  /** 中文说明：运行时局部值 解构结果，由紧邻初始化决定。 */
  let root: CodeJsonValue | undefined
  /** 中文说明：运行时局部值 assign，由紧邻初始化决定。 */
  const assign = (destination: SnapshotDestination, item: CodeJsonValue): void => {
    if (destination.kind === 'root') {
      root = item
    } else if (destination.kind === 'array') {
      defineEnumerableDataProperty(destination.target, destination.index, item)
    } else {
      defineEnumerableDataProperty(destination.target, destination.key, item)
    }
  }

  /** 中文说明：运行时局部值 tasks，由紧邻初始化决定。 */
  const tasks: SnapshotTask[] = [{ kind: 'visit', value, destination: { kind: 'root' } }]
  /** 中文说明：运行时局部值 task，由紧邻初始化决定。 */
  for (let task = takeLast(tasks); task !== undefined; task = takeLast(tasks)) {
    if (task.kind === 'leave') {
      setDelete(active, task.source)
      continue
    }
    if (task.kind === 'array-item') {
      if (!intrinsicObjectHasOwn(task.source, task.index)) return undefined
      append(tasks, {
        kind: 'visit',
        value: task.source[task.index],
        destination: { kind: 'array', target: task.target, index: task.index },
      })
      continue
    }
    if (task.kind === 'object-property') {
      append(tasks, {
        kind: 'visit',
        value: task.source[task.key],
        destination: { kind: 'object', target: task.target, key: task.key },
      })
      continue
    }

    /** 中文说明：运行时局部值 candidate，由紧邻初始化决定。 */
    const candidate = task.value
    if (candidate === null) {
      assign(task.destination, null)
      continue
    }
    if (typeof candidate === 'boolean' || typeof candidate === 'string') {
      assign(task.destination, candidate)
      continue
    }
    if (typeof candidate === 'number') {
      if (!intrinsicNumberIsFinite(candidate) || intrinsicObjectIs(candidate, -0)) return undefined
      assign(task.destination, candidate)
      continue
    }
    if (typeof candidate !== 'object') return undefined
    if (setHas(active, candidate)) return undefined

    if (intrinsicArrayIsArray(candidate)) {
      if (!hasPlainArrayPrototype(candidate)) return undefined
      /** 中文说明：运行时局部值 length，由紧邻初始化决定。 */
      const length = candidate.length
      if (intrinsicReflectOwnKeys(candidate).length !== length + 1) return undefined
      /** 中文说明：运行时局部值 target，由紧邻初始化决定。 */
      const target: CodeJsonValue[] = []
      assign(task.destination, target)
      setAdd(active, candidate)
      append(tasks, { kind: 'leave', source: candidate })
      /** 中文说明：运行时局部值 index，由紧邻初始化决定。 */
      for (let index = length - 1; index >= 0; index--) {
        append(tasks, { kind: 'array-item', source: candidate, index, target })
      }
      continue
    }

    if (!hasPlainObjectPrototype(candidate)) return undefined
    /** 中文说明：运行时局部值 keys，由紧邻初始化决定。 */
    const keys = enumerableStringKeys(candidate)
    if (keys === undefined) return undefined
    /** 中文说明：运行时局部值 target，由紧邻初始化决定。 */
    const target: Record<string, CodeJsonValue> = {}
    assign(task.destination, target)
    setAdd(active, candidate)
    append(tasks, { kind: 'leave', source: candidate })
    /** 中文说明：运行时局部值 index，由紧邻初始化决定。 */
    for (let index = keys.length - 1; index >= 0; index--) {
      /** 中文说明：运行时局部值 key，由紧邻初始化决定。 */
      const key = keys[index]
      /* v8 ignore next -- the loop is bounded by the captured key count. */
      if (key === undefined) return undefined
      append(tasks, { kind: 'object-property', source: candidate as Record<string, unknown>, key, target })
    }
  }
  return root
}

/** 中文说明：类型或类 ArrayWireToken 约束协议数据或模块职责。 */
interface ArrayWireToken {
  kind: 'array'
  length: number
}

/** 中文说明：类型或类 ObjectWireToken 约束协议数据或模块职责。 */
interface ObjectWireToken {
  kind: 'object'
  keys: string[]
}

/** 中文说明：类型或类 WorkerJsonToken 约束协议数据或模块职责。 */
type WorkerJsonToken = null | boolean | number | string | ArrayWireToken | ObjectWireToken

/**
 * A pre-order, bounded-depth transport for one lossless JSON value. Container
 * markers and scalar leaves share one flat token array, so `worker_threads`
 * never has to structured-clone the value's application nesting.
 */
/* 中文说明：类型或类 WorkerJsonWire 约束协议数据或模块职责。 */
export type WorkerJsonWire = WorkerJsonToken[]

/**
 * Flatten one validated JSON value for the worker-thread message port.
 * @param value - the lossless JSON value to transport.
 * @returns a pre-order token stream whose own nesting is bounded.
 */
/* 中文说明：函数 encodeWorkerJson 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function encodeWorkerJson(value: CodeJsonValue): WorkerJsonWire {
  /** 中文说明：运行时局部值 wire，由紧邻初始化决定。 */
  const wire: WorkerJsonWire = []
  /** 中文说明：运行时局部值 pending，由紧邻初始化决定。 */
  const pending: CodeJsonValue[] = [value]
  /** 中文说明：运行时局部值 current，由紧邻初始化决定。 */
  for (let current = takeLast(pending); current !== undefined; current = takeLast(pending)) {
    if (current === null || typeof current === 'boolean' || typeof current === 'number' || typeof current === 'string') {
      append(wire, current)
      continue
    }
    if (intrinsicArrayIsArray(current)) {
      append(wire, { kind: 'array', length: current.length })
      /** 中文说明：运行时局部值 index，由紧邻初始化决定。 */
      for (let index = current.length - 1; index >= 0; index--) {
        /** 中文说明：运行时局部值 item，由紧邻初始化决定。 */
        const item = current[index]
        if (item === undefined) throw new IntrinsicError('cannot encode a sparse JSON array')
        append(pending, item)
      }
      continue
    }
    /** 中文说明：运行时局部值 keys，由紧邻初始化决定。 */
    const keys = intrinsicObjectKeys(current)
    append(wire, { kind: 'object', keys })
    /** 中文说明：运行时局部值 index，由紧邻初始化决定。 */
    for (let index = keys.length - 1; index >= 0; index--) {
      /** 中文说明：运行时局部值 key，由紧邻初始化决定。 */
      const key = keys[index]
      /* v8 ignore next -- the loop is bounded by the captured key count. */
      if (key === undefined) throw new IntrinsicError('cannot encode a missing JSON object key')
      /** 中文说明：运行时局部值 item，由紧邻初始化决定。 */
      const item = current[key]
      if (item === undefined) throw new IntrinsicError('cannot encode an undefined JSON object property')
      append(pending, item)
    }
  }
  return wire
}

/** 中文说明：类型或类 DecodeFrame 约束协议数据或模块职责。 */
type DecodeFrame =
  | { kind: 'array'; target: CodeJsonValue[]; length: number; index: number }
  | { kind: 'object'; target: Record<string, CodeJsonValue>; keys: string[]; index: number }

/** Whether an array contains exactly its dense indexed slots and `length`. */
/* 中文说明：函数 isDenseArray 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function isDenseArray(value: unknown[]): boolean {
  if (!hasPlainArrayPrototype(value) || intrinsicReflectOwnKeys(value).length !== value.length + 1) return false
  /** 中文说明：运行时局部值 index，由紧邻初始化决定。 */
  for (let index = 0; index < value.length; index++) {
    if (!intrinsicObjectHasOwn(value, index)) return false
  }
  return true
}

/** Whether one exact string-key list contains a key, without consulting its prototype. */
/* 中文说明：函数 keysContain 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function keysContain(keys: string[], expected: string): boolean {
  /** 中文说明：运行时局部值 index，由紧邻初始化决定。 */
  for (let index = 0; index < keys.length; index++) {
    if (keys[index] === expected) return true
  }
  return false
}

/** Return one exact container marker, or reject any extra/missing fields. */
/* 中文说明：函数 containerToken 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function containerToken(value: object): ArrayWireToken | ObjectWireToken | undefined {
  if (intrinsicArrayIsArray(value) || !hasPlainObjectPrototype(value)) return undefined
  /** 中文说明：运行时局部值 keys，由紧邻初始化决定。 */
  const keys = enumerableStringKeys(value)
  if (keys === undefined) return undefined
  /** 中文说明：运行时局部值 token，由紧邻初始化决定。 */
  const token = value as Record<string, unknown>
  if (token.kind === 'array') {
    if (keys.length !== 2 || !keysContain(keys, 'kind') || !keysContain(keys, 'length')) return undefined
    /** 中文说明：运行时局部值 length，由紧邻初始化决定。 */
    const length = token.length
    return typeof length === 'number' && intrinsicNumberIsSafeInteger(length) && length >= 0
      ? { kind: 'array', length }
      : undefined
  }
  if (token.kind === 'object') {
    if (keys.length !== 2 || !keysContain(keys, 'kind') || !keysContain(keys, 'keys')) return undefined
    /** 中文说明：运行时局部值 objectKeys，由紧邻初始化决定。 */
    const objectKeys = token.keys
    if (!intrinsicArrayIsArray(objectKeys) || !isDenseArray(objectKeys)) return undefined
    /** 中文说明：运行时局部值 unique，由紧邻初始化决定。 */
    const unique = new IntrinsicSet<string>()
    /** 中文说明：运行时局部值 normalizedKeys，由紧邻初始化决定。 */
    const normalizedKeys: string[] = []
    /** 中文说明：运行时局部值 objectKeyValues，由紧邻初始化决定。 */
    const objectKeyValues = objectKeys as unknown[]
    /** 中文说明：运行时局部值 index，由紧邻初始化决定。 */
    for (let index = 0; index < objectKeyValues.length; index++) {
      /** 中文说明：运行时局部值 key，由紧邻初始化决定。 */
      const key = objectKeyValues[index]
      if (typeof key !== 'string' || setHas(unique, key)) return undefined
      setAdd(unique, key)
      append(normalizedKeys, key)
    }
    return { kind: 'object', keys: normalizedKeys }
  }
  return undefined
}

/**
 * Rebuild one lossless JSON value from the flat worker-thread wire format.
 * Malformed or incomplete traffic returns `undefined`; traversal is iterative
 * and therefore independent of the transported value's application depth.
 * @param input - untrusted message-port payload.
 * @returns the detached JSON value, or `undefined` when the wire is invalid.
 */
/* 中文说明：函数 decodeWorkerJson 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function decodeWorkerJson(input: unknown): CodeJsonValue | undefined {
  try {
    if (!intrinsicArrayIsArray(input) || !isDenseArray(input) || input.length === 0) return undefined
    /** 中文说明：运行时局部值 wire，由紧邻初始化决定。 */
    const wire = input as unknown[]
    /** 中文说明：运行时局部值 frames，由紧邻初始化决定。 */
    const frames: DecodeFrame[] = []
    /** 中文说明：运行时局部值 解构结果，由紧邻初始化决定。 */
    let root: CodeJsonValue | undefined
    /** 中文说明：运行时局部值 rootAssigned，由紧邻初始化决定。 */
    let rootAssigned = false

    /** 中文说明：运行时局部值 attach，由紧邻初始化决定。 */
    const attach = (value: CodeJsonValue): boolean => {
      /** 中文说明：运行时局部值 parent，由紧邻初始化决定。 */
      const parent = frames[frames.length - 1]
      if (!parent) {
        if (rootAssigned) return false
        root = value
        rootAssigned = true
        return true
      }
      /* v8 ignore next -- completed frames are popped before another token can attach. */
      if (parent.index >= (parent.kind === 'array' ? parent.length : parent.keys.length)) return false
      if (parent.kind === 'array') {
        append(parent.target, value)
      } else {
        /** 中文说明：运行时局部值 key，由紧邻初始化决定。 */
        const key = parent.keys[parent.index]
        /* v8 ignore next -- object frames are built from validated keys and their exact length. */
        if (key === undefined) return false
        defineEnumerableDataProperty(parent.target, key, value)
      }
      parent.index += 1
      return true
    }

    /** 中文说明：运行时局部值 tokenIndex，由紧邻初始化决定。 */
    for (let tokenIndex = 0; tokenIndex < wire.length; tokenIndex++) {
      /** 中文说明：运行时局部值 token，由紧邻初始化决定。 */
      const token = wire[tokenIndex]
      /** 中文说明：运行时局部值 value: CodeJsonValue，由紧邻初始化决定。 */
      let value: CodeJsonValue
      /** 中文说明：运行时局部值 解构结果，由紧邻初始化决定。 */
      let frame: DecodeFrame | undefined
      if (token === null || typeof token === 'boolean' || typeof token === 'string') {
        value = token
      } else if (typeof token === 'number') {
        if (!intrinsicNumberIsFinite(token) || intrinsicObjectIs(token, -0)) return undefined
        value = token
      } else {
        if (typeof token !== 'object') return undefined
        /** 中文说明：运行时局部值 marker，由紧邻初始化决定。 */
        const marker = containerToken(token)
        if (!marker) return undefined
        /** 中文说明：运行时局部值 remainingTokens，由紧邻初始化决定。 */
        const remainingTokens = wire.length - tokenIndex - 1
        if (marker.kind === 'array') {
          if (marker.length > remainingTokens) return undefined
          /** 中文说明：运行时局部值 target，由紧邻初始化决定。 */
          const target: CodeJsonValue[] = []
          value = target
          if (marker.length > 0) frame = { kind: 'array', target, length: marker.length, index: 0 }
        } else {
          if (marker.keys.length > remainingTokens) return undefined
          /** 中文说明：运行时局部值 target，由紧邻初始化决定。 */
          const target: Record<string, CodeJsonValue> = {}
          value = target
          if (marker.keys.length > 0) frame = { kind: 'object', target, keys: marker.keys, index: 0 }
        }
      }
      if (!attach(value)) return undefined
      if (frame) append(frames, frame)
      while (frames.length > 0) {
        /** 中文说明：运行时局部值 current，由紧邻初始化决定。 */
        const current = frames[frames.length - 1]
        /* v8 ignore next -- the loop condition guarantees a final frame. */
        if (current === undefined) break
        if (current.index < (current.kind === 'array' ? current.length : current.keys.length)) break
        takeLast(frames)
      }
    }
    return frames.length === 0 ? root : undefined
  } catch {
    return undefined
  }
}
/* jscpd:ignore-end */
