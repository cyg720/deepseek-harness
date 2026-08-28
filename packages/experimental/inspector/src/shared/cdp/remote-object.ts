/** Realm-neutral JavaScript value descriptions used by Inspector backends.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 remote object 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { InspectorObjectReference } from '../cordis/object-reference.ts'
import type { InspectorJsonValue } from '../json.ts'

/** Runtime value kinds represented by CDP `Runtime.RemoteObject`. */
export type RuntimeRemoteObjectType =
  | 'object'
  | 'function'
  | 'undefined'
  | 'string'
  | 'number'
  | 'boolean'
  | 'symbol'
  | 'bigint'

/** Runtime object subtype hints understood by Chrome DevTools. */
export type RuntimeRemoteObjectSubtype =
  | 'array'
  | 'null'
  | 'node'
  | 'regexp'
  | 'date'
  | 'map'
  | 'set'
  | 'weakmap'
  | 'weakset'
  | 'iterator'
  | 'generator'
  | 'error'
  | 'proxy'
  | 'promise'
  | 'typedarray'
  | 'arraybuffer'
  | 'dataview'
  | 'webassemblymemory'
  | 'wasmvalue'

/** Shallow property rendered inline by DevTools. */
export interface RuntimePropertyPreview {
  readonly name: string
  readonly type: RuntimeRemoteObjectType | 'accessor'
  readonly value?: string
  readonly valuePreview?: RuntimeObjectPreview
  readonly subtype?: RuntimeRemoteObjectSubtype
}

/** Shallow object rendering that never carries a live-object reference. */
export interface RuntimeObjectPreview {
  readonly type: RuntimeRemoteObjectType
  readonly subtype?: RuntimeRemoteObjectSubtype
  readonly description?: string
  readonly overflow: boolean
  readonly properties: readonly RuntimePropertyPreview[]
}

/** Engine-independent description of one JavaScript value. */
export interface RuntimeRemoteObjectDescriptor {
  readonly type: RuntimeRemoteObjectType
  readonly subtype?: RuntimeRemoteObjectSubtype
  readonly className?: string
  readonly value?: InspectorJsonValue
  readonly unserializableValue?: string
  readonly description?: string
  readonly preview?: RuntimeObjectPreview
}

/** Backend-owned reference to a retained object in one realm session. */
export interface RuntimeBackendObjectReference<Handle extends string> {
  readonly handle: Handle
}

/** Realm-neutral value plus optional backend and Cordis identities. */
export interface RuntimeRemoteObject<Handle extends string> {
  readonly descriptor: RuntimeRemoteObjectDescriptor
  readonly object?: RuntimeBackendObjectReference<Handle>
  readonly semanticReference?: InspectorObjectReference
}
