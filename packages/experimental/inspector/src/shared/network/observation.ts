/** Full-capture fetch observations sent to the Inspector Worker. */

/** One header entry; arrays retain duplicate header names.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 observation 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */
export type InspectorHeader = readonly [name: string, value: string]

/** Common request identity. */
export interface FetchIdentity {
  readonly requestId: string
}

/** A high-level global fetch call began. */
export interface FetchStartPayload extends FetchIdentity {
  readonly url: string
  readonly method: string
  readonly headers: InspectorHeader[]
  readonly hasBody: boolean
  readonly wallTimeMs: number
}

/** One captured request-body chunk. */
export interface FetchBodyChunkPayload extends FetchIdentity {
  readonly data: string
}

/** Terminal state of one captured request body. */
export interface FetchRequestBodyEndPayload extends FetchIdentity {
  readonly capturedBytes: number
  readonly truncated: boolean
  readonly captureError?: string
}

/** Fetch resolved with response headers. */
export interface FetchResponsePayload extends FetchIdentity {
  readonly url: string
  readonly status: number
  readonly statusText: string
  readonly headers: InspectorHeader[]
  readonly mimeType: string
}

/** One captured response-body chunk. */
/** Fetch capture reached a terminal response-body state. */
export interface FetchEndPayload extends FetchIdentity {
  readonly capturedBytes: number
  readonly responseBodyTruncated: boolean
  readonly responseCaptureError?: string
}

/** One parsed Server-Sent Event independent of its CDP projection. */
export interface InspectorEventSourceMessage {
  readonly eventName: string
  readonly eventId: string
  readonly data: string
}

/** Fetch rejected before returning a Response. */
export interface FetchErrorPayload extends FetchIdentity {
  readonly message: string
  readonly canceled: boolean
}
