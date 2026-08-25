/**
 * ================================ 文件注释 ================================
 * 【文件职责】会话引用能力的配置常量、配置接口与稳定诊断错误类型。
 *             所有与外部宿主协议交互的错误都从这里取稳定的错误码。
 * 【技术维度】纯常量 + 类型 + 一个 Error 子类；错误码是字符串字面量联合
 *             （discriminated union 的判别字段），宿主办到错误码即可路由。
 * 【产品维度】约束"一条消息最多引用几个会话""补全返回几个候选""单份快照
 *             最多占多少字节"，并给宿主提供稳定的错误分类。
 * 【逻辑维度】1) 三个默认常量（上限类安全常量，不可配置越界）；2) Config
 *             可选配置接口；3) 错误码联合类型；4) SessionReferenceError
 *             带 code 字段的领域错误。
 * 【关键边界】MAX_REFERENCES 是协议级硬上限，即使配置也不得超过；错误码一旦
 *             发布即为稳定契约，宿主协议映射依赖它。
 * 【新手阅读建议】先记三个常量（后面 index.ts 里反复使用），再认识错误码
 *                 联合类型的每个成员含义。
 * ==========================================================================
 */

/** Configuration and stable diagnostics for session references. */

/** Hard maximum references accepted by one message. */
/* 单条消息最多可引用的会话数（协议级硬上限，配置也不得突破）。 */
export const MAX_REFERENCES = 3
/** Default number of discovery candidates returned to a host. */
/* 默认返回给宿主的发现候选数量。 */
export const DEFAULT_CANDIDATE_LIMIT = 50
/** Default UTF-8 budget for one rendered reference JSON object. */
/* 单份渲染后的引用 JSON 对象的默认 UTF-8 字节预算（超长快照会被裁剪）。 */
export const DEFAULT_MAX_REFERENCE_BYTES = 65_536

/** Session-reference service configuration. */
/* 会话引用服务的配置项：均可由用户覆盖，缺省用上方默认值。 */
export interface Config {
  /** Maximum distinct source sessions referenced by one message, from one to three. */
  /* 单条消息可引用的不同来源会话数，范围 1 到 3。 */
  maxReferences?: number
  /** Default host candidate-list limit. */
  /* 宿主候选列表的默认条数上限。 */
  candidateLimit?: number
  /** Maximum rendered UTF-8 bytes for one source snapshot. */
  /* 单份来源快照渲染后的最大 UTF-8 字节数。 */
  maxReferenceBytes?: number
}

/** Stable failure codes exposed to host adapters. */
/* 暴露给宿主适配器的稳定失败码：宿主据此路由错误展示/重试策略。 */
export type SessionReferenceErrorCode =
  | 'SESSION_REFERENCE_INVALID_CONFIG'
  | 'SESSION_REFERENCE_INVALID_REFERENCE'
  | 'SESSION_REFERENCE_SELF_REFERENCE'
  | 'SESSION_REFERENCE_TOO_MANY'
  | 'SESSION_REFERENCE_READ_FAILED'
  | 'SESSION_REFERENCE_BUDGET_EXCEEDED'
  | 'SESSION_REFERENCE_CANCELLED'

/** Typed session-reference failure suitable for host protocol error mapping. */
/* 带类型的会话引用失败：携带稳定错误码，适合宿主协议错误映射。 */
export class SessionReferenceError extends Error {
  /** @param message Human-readable diagnosis. @param code Stable routing code. @param options Optional cause. */
  /* 构造领域错误：message 给人看，code 给宿主办路由，options 携带原始原因。 */
  constructor(
    message: string,
    readonly code: SessionReferenceErrorCode,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'SessionReferenceError'
  }
}
