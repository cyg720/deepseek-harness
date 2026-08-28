/** Closed command/result protocol for Runtime operations executed by a Client.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 commands 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { ClientRemoteObjectHandle } from '../../ids.ts'
import type {
  RuntimeExceptionDetails,
  RuntimeInternalPropertyDescriptor,
  RuntimeCallArgument,
  RuntimeAwaitPromiseRequest,
  RuntimeCallFunctionRequest,
  RuntimeCompletion,
  RuntimeEvaluateRequest,
  RuntimeGetPropertiesRequest,
  RuntimePropertyDescriptor,
  RuntimeRemoteObject,
} from '../../../cdp/index.ts'

/** Runtime object serialized with one Client-session handle when retained. */
export type ClientRuntimeRemoteObject = RuntimeRemoteObject<ClientRemoteObjectHandle>

/** Property descriptor whose retained values use Client-session handles. */
export type ClientRuntimePropertyDescriptor = RuntimePropertyDescriptor<ClientRemoteObjectHandle>

/** Internal property descriptor whose retained values use Client-session handles. */
export type ClientRuntimeInternalPropertyDescriptor = RuntimeInternalPropertyDescriptor<ClientRemoteObjectHandle>

/** Exception details whose retained value uses a Client-session handle. */
export type ClientRuntimeExceptionDetails = RuntimeExceptionDetails<ClientRemoteObjectHandle>

/** One argument supplied to a function in the Client realm. */
export type ClientCallArgument = RuntimeCallArgument<ClientRemoteObjectHandle>

/** Evaluate source text in the Client global execution context. */
export interface ClientRuntimeEvaluateCommand extends RuntimeEvaluateRequest {
  readonly op: 'evaluate'
}

/** Enumerate properties of one retained Client object. */
export interface ClientRuntimeGetPropertiesCommand extends RuntimeGetPropertiesRequest<ClientRemoteObjectHandle> {
  readonly op: 'get-properties'
}

/** Invoke a function declaration with Client-local receivers and arguments. */
export interface ClientRuntimeCallFunctionCommand extends RuntimeCallFunctionRequest<ClientRemoteObjectHandle> {
  readonly op: 'call-function'
}

/** Await one retained Client promise. */
export interface ClientRuntimeAwaitPromiseCommand extends RuntimeAwaitPromiseRequest<ClientRemoteObjectHandle> {
  readonly op: 'await-promise'
}

/** Release one retained Client object. */
export interface ClientRuntimeReleaseObjectCommand {
  readonly op: 'release-object'
  readonly handle: ClientRemoteObjectHandle
}

/** Release every Client object retained under one DevTools object group. */
export interface ClientRuntimeReleaseObjectGroupCommand {
  readonly op: 'release-object-group'
  readonly objectGroup: string
}

/** Read names visible in the Client global lexical scope. */
export interface ClientRuntimeGlobalLexicalScopeNamesCommand {
  readonly op: 'global-lexical-scope-names'
}

/** Closed command set implemented by the Client Runtime transport. */
export type ClientRuntimeCommand =
  | ClientRuntimeEvaluateCommand
  | ClientRuntimeGetPropertiesCommand
  | ClientRuntimeCallFunctionCommand
  | ClientRuntimeAwaitPromiseCommand
  | ClientRuntimeReleaseObjectCommand
  | ClientRuntimeReleaseObjectGroupCommand
  | ClientRuntimeGlobalLexicalScopeNamesCommand

/** Shared result of evaluation, function calls, and promise awaiting. */
export type ClientRuntimeCompletion = RuntimeCompletion<ClientRemoteObjectHandle>

/** Result discriminant mirrors the command and prevents cross-method settlement. */
export type ClientRuntimeResult =
  | { readonly op: 'evaluate'; readonly completion: ClientRuntimeCompletion }
  | {
    readonly op: 'get-properties'
    readonly properties: readonly ClientRuntimePropertyDescriptor[]
    readonly internalProperties?: readonly ClientRuntimeInternalPropertyDescriptor[]
    readonly exceptionDetails?: ClientRuntimeExceptionDetails
  }
  | { readonly op: 'call-function'; readonly completion: ClientRuntimeCompletion }
  | { readonly op: 'await-promise'; readonly completion: ClientRuntimeCompletion }
  | { readonly op: 'release-object' }
  | { readonly op: 'release-object-group' }
  | { readonly op: 'global-lexical-scope-names'; readonly names: readonly string[] }

/** Stable transport-level failures distinct from evaluated JavaScript exceptions. */
export interface ClientRuntimeError {
  readonly code: 'invalid-request' | 'object-not-found' | 'unsupported' | 'timeout' | 'result-too-large' | 'internal-error'
  readonly message: string
}
