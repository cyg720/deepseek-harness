/** JSON string-prefix accounting for the outer-output ledger. @module @deepseek-ai/dsh-code-runtime-worker-thread/output-json */
/*
 * 文件职责：实现代码运行时的 output-json 模块。
 * 技术维度：TypeScript、Cordis 插件、Worker/JSON 协议和严格类型。
 * 产品维度：为产品提供代码运行时能力。
 * 逻辑维度：解析配置或协议，执行核心流程并返回结构化结果。
 * 关键边界：跨线程和模型输入属于不可信边界；资源与事件注册必须清理。
 * 新手阅读建议：先读导出类型与配置，再跟踪入口和错误分支。
 */

import type { CodeJsonValue } from '@deepseek-ai/dsh-code-runtime'

/** 中文说明：类型或类 IntrinsicCallable 约束协议数据或模块职责。 */
type IntrinsicCallable = (this: unknown, ...args: unknown[]) => unknown

/** 中文说明：运行时局部值 intrinsicReflectApply，由紧邻初始化决定。 */
const intrinsicReflectApply = Reflect.apply as (
  target: IntrinsicCallable,
  thisArgument: unknown,
  argumentsList: readonly unknown[],
) => unknown
/** 中文说明：运行时局部值 intrinsicArrayIsArray，由紧邻初始化决定。 */
const intrinsicArrayIsArray = Array.isArray
/** 中文说明：运行时局部值 IntrinsicBuffer，由紧邻初始化决定。 */
const IntrinsicBuffer = Buffer
/** 中文说明：运行时局部值 intrinsicBufferByteLength，由紧邻初始化决定。 */
const intrinsicBufferByteLength = Reflect.get(Buffer, 'byteLength') as IntrinsicCallable
/** 中文说明：运行时局部值 intrinsicObjectCreate，由紧邻初始化决定。 */
const intrinsicObjectCreate = Object.create
/** 中文说明：运行时局部值 解构结果，由紧邻初始化决定。 */
const intrinsicObjectDefineProperty = Object.defineProperty
/** 中文说明：运行时局部值 intrinsicObjectKeys，由紧邻初始化决定。 */
const intrinsicObjectKeys = Object.keys
/** 中文说明：运行时局部值 intrinsicString，由紧邻初始化决定。 */
const intrinsicString = String
/** 中文说明：运行时局部值 intrinsicStringCharCodeAt，由紧邻初始化决定。 */
const intrinsicStringCharCodeAt = Reflect.get(String.prototype, 'charCodeAt') as IntrinsicCallable
/** 中文说明：运行时局部值 解构结果，由紧邻初始化决定。 */
const intrinsicStringCodePointAt = Reflect.get(String.prototype, 'codePointAt') as IntrinsicCallable
/** 中文说明：运行时局部值 intrinsicStringSlice，由紧邻初始化决定。 */
const intrinsicStringSlice = Reflect.get(String.prototype, 'slice') as IntrinsicCallable

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

/** UTF-8 byte length through the module-captured Node intrinsic. */
/* 中文说明：函数 byteLength 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function byteLength(text: string): number {
  return intrinsicReflectApply(intrinsicBufferByteLength, IntrinsicBuffer, [text, 'utf8']) as number
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

/** One code-point-aligned character from a string. */
/* 中文说明：函数 characterAt 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function characterAt(text: string, index: number): string {
  /** 中文说明：运行时局部值 codePoint，由紧邻初始化决定。 */
  const codePoint = intrinsicReflectApply(intrinsicStringCodePointAt, text, [index]) as number
  /** 中文说明：运行时局部值 width，由紧邻初始化决定。 */
  const width = codePoint > 0xffff ? 2 : 1
  return intrinsicReflectApply(intrinsicStringSlice, text, [index, index + width]) as string
}

/** Serialized bytes contributed by one complete Unicode code point inside JSON quotes. */
/* 中文说明：函数 serializedCharacterBytes 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function serializedCharacterBytes(character: string): number {
  if (character.length === 2) return 4
  if (character === '"' || character === '\\') return 2
  /** 中文说明：运行时局部值 code，由紧邻初始化决定。 */
  const code = intrinsicReflectApply(intrinsicStringCharCodeAt, character, [0]) as number
  if (code >= 0xd800 && code <= 0xdfff) return 6
  if (code < 0x20) return code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d ? 2 : 6
  return byteLength(character)
}

/**
 * Measure one JSON string without materializing its complete escaped form.
 * @param text - the candidate string.
 * @param maxBytes - largest serialized size the caller can admit.
 * @returns Exact serialized bytes, or `undefined` as soon as the cap is crossed.
 */
/* 中文说明：函数 jsonStringBytesUpTo 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function jsonStringBytesUpTo(text: string, maxBytes: number): number | undefined {
  if (maxBytes < 2) return undefined
  /** 中文说明：运行时局部值 bytes，由紧邻初始化决定。 */
  let bytes = 2
  /** 中文说明：运行时局部值 index，由紧邻初始化决定。 */
  for (let index = 0; index < text.length;) {
    /** 中文说明：运行时局部值 character，由紧邻初始化决定。 */
    const character = characterAt(text, index)
    bytes += serializedCharacterBytes(character)
    if (bytes > maxBytes) return undefined
    index += character.length
  }
  return bytes
}

/**
 * Measure one lossless JSON value without allocating its serialized form.
 * @param value - already validated lossless JSON.
 * @param maxBytes - largest serialized size the caller can admit.
 * @returns Exact serialized bytes, or `undefined` as soon as the cap is crossed.
 */
/* 中文说明：函数 jsonValueBytesUpTo 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function jsonValueBytesUpTo(value: CodeJsonValue, maxBytes: number): number | undefined {
  /** 中文说明：类型或类 Task 约束协议数据或模块职责。 */
  type Task =
    | { kind: 'value'; value: CodeJsonValue }
    | { kind: 'array'; value: CodeJsonValue[]; index: number }
    | { kind: 'object'; value: Record<string, CodeJsonValue>; keys: string[]; index: number }

  /** 中文说明：运行时局部值 bytes，由紧邻初始化决定。 */
  let bytes = 0
  /** 中文说明：运行时局部值 add，由紧邻初始化决定。 */
  const add = (cost: number): boolean => {
    bytes += cost
    return bytes <= maxBytes
  }
  /** 中文说明：运行时局部值 tasks，由紧邻初始化决定。 */
  const tasks: Task[] = [{ kind: 'value', value }]
  /** 中文说明：运行时局部值 task，由紧邻初始化决定。 */
  for (let task = takeLast(tasks); task !== undefined; task = takeLast(tasks)) {
    if (task.kind === 'value') {
      /** 中文说明：运行时局部值 current，由紧邻初始化决定。 */
      const current = task.value
      if (current === null) {
        if (!add(4)) return undefined
      } else if (typeof current === 'string') {
        /** 中文说明：运行时局部值 stringBytes，由紧邻初始化决定。 */
        const stringBytes = jsonStringBytesUpTo(current, maxBytes - bytes)
        if (stringBytes === undefined) return undefined
        bytes += stringBytes
      } else if (typeof current === 'number') {
        if (!add(byteLength(intrinsicString(current)))) return undefined
      } else if (typeof current === 'boolean') {
        if (!add(current ? 4 : 5)) return undefined
      } else if (intrinsicArrayIsArray(current)) {
        if (!add(2)) return undefined
        if (current.length > 0) append(tasks, { kind: 'array', value: current, index: 0 })
      } else {
        if (!add(2)) return undefined
        /** 中文说明：运行时局部值 keys，由紧邻初始化决定。 */
        const keys = intrinsicObjectKeys(current)
        if (keys.length > 0) append(tasks, { kind: 'object', value: current, keys, index: 0 })
      }
      continue
    }

    if (task.index > 0 && !add(1)) return undefined
    if (task.kind === 'array') {
      /** 中文说明：运行时局部值 item，由紧邻初始化决定。 */
      const item = task.value[task.index]
      if (item === undefined) return undefined
      if (task.index + 1 < task.value.length) append(tasks, { ...task, index: task.index + 1 })
      append(tasks, { kind: 'value', value: item })
      continue
    }

    /** 中文说明：运行时局部值 key，由紧邻初始化决定。 */
    const key = task.keys[task.index]
    /* v8 ignore next -- an object frame is created and advanced only for an existing Object.keys entry. */
    if (key === undefined) return undefined
    /** 中文说明：运行时局部值 keyBytes，由紧邻初始化决定。 */
    const keyBytes = jsonStringBytesUpTo(key, maxBytes - bytes)
    if (keyBytes === undefined) return undefined
    if (!add(keyBytes + 1)) return undefined
    /** 中文说明：运行时局部值 item，由紧邻初始化决定。 */
    const item = task.value[key]
    if (item === undefined) return undefined
    if (task.index + 1 < task.keys.length) append(tasks, { ...task, index: task.index + 1 })
    append(tasks, { kind: 'value', value: item })
  }
  return bytes
}

/**
 * Return the longest code-point-aligned prefix whose JSON string encoding,
 * including its surrounding quotes, fits `maxBytes`.
 *
 * @param text - the candidate string.
 * @param maxBytes - serialized JSON-string bytes available.
 * @returns the fitting prefix, or an empty string when even useful content cannot fit.
 */
/* 中文说明：函数 truncateJsonStringBytes 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function truncateJsonStringBytes(text: string, maxBytes: number): string {
  if (maxBytes < 2) return ''
  /** 中文说明：运行时局部值 bytes，由紧邻初始化决定。 */
  let bytes = 2
  /** 中文说明：运行时局部值 end，由紧邻初始化决定。 */
  let end = 0
  /** 中文说明：运行时局部值 index，由紧邻初始化决定。 */
  for (let index = 0; index < text.length;) {
    /** 中文说明：运行时局部值 character，由紧邻初始化决定。 */
    const character = characterAt(text, index)
    /** 中文说明：运行时局部值 cost，由紧邻初始化决定。 */
    const cost = serializedCharacterBytes(character)
    if (bytes + cost > maxBytes) break
    bytes += cost
    end += character.length
    index += character.length
  }
  return end === text.length ? text : intrinsicReflectApply(intrinsicStringSlice, text, [0, end]) as string
}
