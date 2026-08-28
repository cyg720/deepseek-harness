/** Realm-neutral values used by active debugger backends.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 debugger 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { InspectorJsonValue } from '../json.ts'
import type { RuntimeScriptKey } from './ids.ts'
import type { RuntimeStackTrace } from './errors.ts'
import type { RuntimeCompletion } from './operations.ts'
import type { RuntimeRemoteObject } from './remote-object.ts'

/** One source location independent of a CDP ScriptId allocation policy. */
export interface RuntimeDebuggerLocation {
  readonly scriptKey: RuntimeScriptKey
  readonly lineNumber: number
  readonly columnNumber?: number
}

/** One lexical scope attached to a paused call frame. */
export interface RuntimeDebuggerScope<Handle extends string> {
  readonly type: string
  readonly object: RuntimeRemoteObject<Handle>
  readonly name?: string
  readonly startLocation?: RuntimeDebuggerLocation
  readonly endLocation?: RuntimeDebuggerLocation
}

/** One paused JavaScript call frame. */
export interface RuntimeDebuggerCallFrame<Handle extends string> {
  readonly callFrameId: string
  readonly functionName: string
  readonly functionLocation?: RuntimeDebuggerLocation
  readonly location: RuntimeDebuggerLocation
  readonly url: string
  readonly scopeChain: readonly RuntimeDebuggerScope<Handle>[]
  readonly thisObject: RuntimeRemoteObject<Handle>
  readonly returnValue?: RuntimeRemoteObject<Handle>
}

/** Engine-independent evaluation request for one paused call frame. */
export interface RuntimeCallFrameEvaluationRequest {
  readonly callFrameId: string
  readonly expression: string
  readonly objectGroup?: string
  readonly includeCommandLineAPI?: boolean
  readonly silent?: boolean
  readonly returnByValue?: boolean
  readonly generatePreview?: boolean
  readonly throwOnSideEffect?: boolean
  readonly timeoutMs?: number
}

/** Optional native script-cache limit requested while enabling Debugger. */
export interface RuntimeDebuggerEnableRequest {
  readonly maxScriptsCacheSize?: number
}

/** Optional termination requested while resuming a native debugger. */
export interface RuntimeDebuggerResumeRequest {
  readonly terminateOnResume?: boolean
}

/** Debugger lifecycle notification emitted by a realm backend. */
export type RuntimeDebuggerEvent<Handle extends string> =
  | {
    readonly type: 'paused'
    readonly callFrames: readonly RuntimeDebuggerCallFrame<Handle>[]
    readonly reason: string
    readonly data?: InspectorJsonValue
    readonly hitBreakpoints?: readonly string[]
    readonly asyncStackTrace?: RuntimeStackTrace
  }
  | { readonly type: 'resumed' }
  | {
    readonly type: 'breakpoint-resolved'
    readonly breakpointId: string
    readonly location: RuntimeDebuggerLocation
  }

/** Active debugger operation result containing a Runtime value. */
export type RuntimeCallFrameEvaluation<Handle extends string> = RuntimeCompletion<Handle>
