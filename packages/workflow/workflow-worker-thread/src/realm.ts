/**
 * Materializes values leaving the script vm into plain JSON before they cross the worker
 * boundary, and renders thrown script values without rejecting the run. The walk rejects
 * values that JSON cannot preserve but trusts model-written workflow scripts: getters and proxy traps may
 * run, and the vm is not a security boundary. The worker provides host-loop isolation and
 * forced termination, not hostile-value containment. See
 * .agents/notes/implemented/feature/2026-07-05-dynamic-workflows.md for the isolation rationale.
 * @module @deepseek-ai/dsh-workflow-worker-thread/realm
 */
/*
 * 文件职责：实现 realm.ts 覆盖的工作流与 Worker Thread行为与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、Worker Thread、消息协议或领域实体。
 * 产品维度：保障 Agent 的工作流与 Worker Thread能力稳定、可隔离且可诊断。
 * 逻辑维度：准备配置和消息，建立运行环境，执行流程，再处理事件、错误与清理。
 * 关键边界：线程消息不可信；跨线程状态必须显式传递；终止时必须等待所拥有资源停止。
 * 新手阅读建议：先看协议和类型，再读 Host/Runtime 主流程，最后关注隔离、失败与清理。
 */

/** Thrown by {@link materializeFromRealm}; the caller wraps it into the right `WorkflowError` code. */
/* 中文说明：class MaterializeError 定义本模块所需的数据或行为，用于表达工作流与 Worker Thread场景。 */
export class MaterializeError extends Error {
  constructor(public readonly path: string, public readonly reason: string) {
    super(`${path}: ${reason}`)
    this.name = 'MaterializeError'
  }
}

/**
 * Render a thrown value to failure text without ever throwing: prefer the
 * `stack` (host or realm — a realm error's `stack` is a plain string read),
 * fall back to `message`, then `String()`. Reading those properties MAY run
 * script code (a getter, `toString`) — accepted under the module's trust
 * premise; if that code itself throws, a fixed label is returned instead.
 * @param error - any value thrown in the host or worker realm.
 * @returns human-readable text for the failure report; prefers the stack.
 */
/*
 * 中文说明：函数 renderThrown 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param error 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function renderThrown(error: unknown): string {
  try {
    /** 中文说明：变量 stack 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const stack = (error as { stack?: unknown } | null | undefined)?.stack
    if (typeof stack === 'string' && stack.length > 0) return stack
    /** 中文说明：变量 message 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const message = (error as { message?: unknown } | null | undefined)?.message
    if (typeof message === 'string' && message.length > 0) return message
    return String(error)
  } catch {
    // A throwing accessor/toString on the thrown value — rendering must be
    // total (drive()'s never-reject contract), so fall back to a fixed label.
    return '[unrenderable thrown value]'
  }
}

/**
 * Whether an object's prototype chain represents a plain data object: `null`, or a prototype
 * whose own prototype is `null` (the realm's `Object.prototype` — which we
 * cannot compare by identity across realms). A `Date`/`Map`/class instance
 * has a longer chain and is rejected.
 */
/* 中文说明：函数 hasPlainPrototype 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function hasPlainPrototype(value: object): boolean {
  /** 中文说明：变量 proto 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const proto: unknown = Object.getPrototypeOf(value)
  if (proto === null) return true
  return Object.getPrototypeOf(proto) === null
}

/**
 * Copy `value` (typically from the vm realm) into plain host JSON data. Root `undefined` is
 * returned unchanged; nested `undefined` and values JSON cannot represent losslessly fail
 * with the offending path. Property accessors run normally, and a throwing read is wrapped
 * with its rendered failure.
 *
 * @param value - the realm value to materialize.
 * @param root - the path label for the root value (error messages).
 * @returns the host-realm copy (plain objects/arrays/scalars only).
 * @throws {@link MaterializeError} for unsupported values, cycles, sparse arrays, exotic
 *   prototypes, or property reads that throw.
 */
/*
 * 中文说明：函数 materializeFromRealm 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param value 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param root 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function materializeFromRealm(value: unknown, root = 'value'): unknown {
  if (value === undefined) return undefined
  try {
    return materialize(value, root, new Set())
  } catch (error: unknown) {
    if (error instanceof MaterializeError) throw error
    // A property read ran script code that threw; total-ize it so callers can
    // keep the narrow MaterializeError contract.
    throw new MaterializeError(root, `reading the value threw: ${renderThrown(error)}`)
  }
}

/** 中文说明：函数 materialize 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function materialize(value: unknown, path: string, seen: Set<object>): unknown {
  switch (typeof value) {
    case 'boolean':
    case 'string':
      return value
    case 'number': {
      if (!Number.isFinite(value)) throw new MaterializeError(path, 'non-finite numbers are not JSON data')
      return value
    }
    case 'bigint':
      throw new MaterializeError(path, 'bigints are not JSON data')
    case 'function':
      throw new MaterializeError(path, 'functions are not plain JSON data')
    case 'symbol':
      throw new MaterializeError(path, 'symbols are not plain JSON data')
    case 'undefined':
      throw new MaterializeError(path, 'undefined is not JSON data')
    case 'object':
      break
  }
  if (value === null) return null
  /** 中文说明：变量 objectValue 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const objectValue: object = value
  if (seen.has(objectValue)) throw new MaterializeError(path, 'circular references are not JSON data')
  seen.add(objectValue)
  try {
    if (Array.isArray(objectValue)) return materializeArray(objectValue, path, seen)
    return materializeObject(objectValue, path, seen)
  } finally {
    seen.delete(objectValue)
  }
}

/** 中文说明：函数 materializeArray 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function materializeArray(value: unknown[], path: string, seen: Set<object>): unknown[] {
  /** 中文说明：变量 out 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const out: unknown[] = []
  /** 中文说明：该循环依次处理消息或实体；循环变量仅在当前循环中有效。 */
  for (let index = 0; index < value.length; index++) {
    if (!(index in value)) throw new MaterializeError(`${path}[${index}]`, 'sparse arrays are not JSON data')
    out.push(materialize(value[index], `${path}[${index}]`, seen))
  }
  // Own enumerable props beyond the indices (e.g. `arr.total = 3`) would be
  // silently dropped by JSON — reject them instead.
  /** 中文说明：该循环依次处理消息或实体；循环变量仅在当前循环中有效。 */
  for (const key of Object.keys(value)) {
    /** 中文说明：变量 index 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const index = Number(key)
    if (!Number.isInteger(index) || index < 0 || index >= value.length) {
      throw new MaterializeError(`${path}.${key}`, 'arrays with non-index properties are not JSON data')
    }
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new MaterializeError(path, 'symbol-keyed properties are not plain JSON data')
  }
  return out
}

/** 中文说明：函数 materializeObject 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function materializeObject(value: object, path: string, seen: Set<object>): Record<string, unknown> {
  if (!hasPlainPrototype(value)) {
    throw new MaterializeError(path, 'only plain objects and arrays are JSON data (exotic prototype)')
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new MaterializeError(path, 'symbol-keyed properties are not plain JSON data')
  }
  /** 中文说明：变量 out 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const out: Record<string, unknown> = {}
  // Object.keys = own enumerable string keys, matching JSON.stringify's
  // property selection exactly (non-enumerable props never reach JSON output).
  /** 中文说明：该循环依次处理消息或实体；循环变量仅在当前循环中有效。 */
  for (const key of Object.keys(value)) {
    // defineProperty, never assignment: a "__proto__" key must become an OWN
    // data property of the copy, not a prototype mutation.
    Object.defineProperty(out, key, {
      value: materialize((value as Record<string, unknown>)[key], `${path}.${key}`, seen),
      enumerable: true,
      writable: true,
      configurable: true,
    })
  }
  return out
}
