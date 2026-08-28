/** Realm-neutral Runtime operations and results.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 operations 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { InspectorJsonObject, InspectorJsonValue } from '../json.ts'
import type { RuntimeExceptionDetails } from './errors.ts'
import type {
  RuntimeInternalPropertyDescriptor,
  RuntimePrivatePropertyDescriptor,
  RuntimePropertyDescriptor,
} from './property.ts'
import type { RuntimeRemoteObject } from './remote-object.ts'

/** One argument supplied to a function in an inspected realm. */
export type RuntimeCallArgument<Handle extends string> =
  | { readonly kind: 'value'; readonly value: InspectorJsonValue }
  | { readonly kind: 'unserializable'; readonly value: string }
  | { readonly kind: 'object'; readonly handle: Handle }
  | { readonly kind: 'undefined' }

/** Backend-local selector for a native execution context within one realm. */
export type RuntimeExecutionContext =
  | { readonly kind: 'numeric'; readonly id: number }
  | { readonly kind: 'unique'; readonly id: string }

/** Engine-independent evaluation options supported by Runtime backends. */
export interface RuntimeEvaluateRequest {
  readonly expression: string
  readonly context?: RuntimeExecutionContext
  readonly objectGroup?: string
  readonly includeCommandLineAPI?: boolean
  readonly silent?: boolean
  readonly returnByValue?: boolean
  readonly generatePreview?: boolean
  readonly userGesture?: boolean
  readonly awaitPromise?: boolean
  readonly disableBreaks?: boolean
  readonly replMode?: boolean
  readonly allowUnsafeEvalBlockedByCSP?: boolean
  readonly throwOnSideEffect?: boolean
  readonly serializationOptions?: InspectorJsonObject
  readonly timeoutMs?: number
}

/** Property enumeration request for one backend object. */
export interface RuntimeGetPropertiesRequest<Handle extends string> {
  readonly handle: Handle
  readonly ownProperties?: boolean
  readonly accessorPropertiesOnly?: boolean
  readonly generatePreview?: boolean
  readonly nonIndexedPropertiesOnly?: boolean
}

/** Function invocation request within one inspected realm. */
export interface RuntimeCallFunctionRequest<Handle extends string> {
  readonly functionDeclaration: string
  readonly context?: RuntimeExecutionContext
  readonly receiver?: Handle
  readonly arguments?: readonly RuntimeCallArgument<Handle>[]
  readonly objectGroup?: string
  readonly silent?: boolean
  readonly returnByValue?: boolean
  readonly generatePreview?: boolean
  readonly userGesture?: boolean
  readonly awaitPromise?: boolean
  readonly throwOnSideEffect?: boolean
  readonly serializationOptions?: InspectorJsonObject
}

/** Promise-await request for one retained backend object. */
export interface RuntimeAwaitPromiseRequest<Handle extends string> {
  readonly promise: Handle
  readonly returnByValue?: boolean
  readonly generatePreview?: boolean
}

/** Shared result of evaluation, function calls, and promise awaiting. */
export interface RuntimeCompletion<Handle extends string> {
  readonly result: RuntimeRemoteObject<Handle>
  readonly exceptionDetails?: RuntimeExceptionDetails<Handle>
}

/** Shared result of property enumeration. */
export interface RuntimeProperties<Handle extends string> {
  readonly properties: readonly RuntimePropertyDescriptor<Handle>[]
  readonly internalProperties?: readonly RuntimeInternalPropertyDescriptor<Handle>[]
  readonly privateProperties?: readonly RuntimePrivatePropertyDescriptor<Handle>[]
  readonly exceptionDetails?: RuntimeExceptionDetails<Handle>
}
