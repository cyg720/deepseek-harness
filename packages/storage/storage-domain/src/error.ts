/**
 * ================================ 文件注释 ================================
 * 【文件职责】定义领域层（domain layer）的错误类型：错误码枚举、无效记录的定位信息、
 * 以及统一的 DomainError 异常类。
 * 【技术维度】继承内置 Error 并带上稳定判别码 code；detail 字段只在 invalid-record
 * 错误上出现，用于定位是哪个领域、哪张表、哪个键校验失败。
 * 【产品维度】让上层代码能按 code 稳定地分类处理错误（如提示"领域已打开"而非解析
 * 错误文本），message 只是给人看的诊断信息。
 * 【逻辑维度】按出现顺序：DomainErrorCode（错误码联合）→ InvalidRecordDetail（定位结构）
 * → DomainErrorOptions（构造选项）→ DomainError（异常类）。
 * 【关键边界】后端失败（backend-not-found、version-mismatch 等）以 StorageError 形式
 * 直接穿透，领域层不会把它们重新包装成 DomainError；domain 层错误与 backend 层错误分工明确。
 * 【新手阅读建议】先看 DomainErrorCode 知道有哪些错误，再看 DomainError 类理解 code 与
 * detail 的关系。
 * ==========================================================================
 */
/**
 * Error vocabulary of the domain data form.
 * @module @deepseek-ai/dsh-storage-domain/src/error
 */
/**
 * 模块总览：领域层错误与存储后端错误（StorageError，见 dsh-storage 包）是两个独立家族，
 * 后端错误直接穿透领域层，不在本文件出现。
 */

/** Discriminant codes carried by every {@link DomainError}. */
/**
 * DomainError 携带的错误码：消费方可以 switch 这个稳定值来分类处理。
 * already-open：领域已打开；facet-unsupported：后端没有 kv 能力；invalid-record：
 * 介质里的数据不符合声明 schema；missing-key：更新不存在的记录；closed：领域已关闭。
 */
export type DomainErrorCode =
  | 'already-open'
  | 'facet-unsupported'
  | 'invalid-record'
  | 'missing-key'
  | 'closed'

/** Location of the record that failed schema validation at the durable boundary. */
/**
 * 校验失败记录的定位信息：告诉调用方是哪条介质数据不合法。
 */
export interface InvalidRecordDetail {
  /** Table holding the rejected record; `''` for the global singleton. */
  /** 被拒记录所在表；全局单例校验失败时为空字符串 ''。 */
  readonly table: string
  /** Key of the rejected record; `''` for the global singleton. */
  /** 被拒记录的键；全局单例校验失败时为空字符串 ''。 */
  readonly key: string
}

/** Construction options: standard `cause` plus the `invalid-record` location. */
/**
 * 构造选项：继承标准 ErrorOptions（可传 cause 链上原始异常），并附带无效记录定位。
 */
export interface DomainErrorOptions extends ErrorOptions {
  /** Present exactly when `code` is `invalid-record`. */
  /** 仅在 code 为 invalid-record 时存在。 */
  readonly detail?: InvalidRecordDetail
}

/**
 * Error thrown by the domain layer. The `code` is the stable contract
 * consumers may switch on; `message` is diagnostic prose. Backend failures
 * (`backend-not-found`, `version-mismatch`, …) pass through as
 * `StorageError` — the domain layer does not rewrap them.
 */
/**
 * 领域层抛出的错误：code 是稳定契约，message 是诊断说明。
 * 后端失败（backend-not-found、version-mismatch 等）以 StorageError 形式穿透，领域层不重包装。
 */
export class DomainError extends Error {
  override readonly name = 'DomainError'

  /** Present exactly when `code` is `invalid-record`. */
  /** 仅在 code 为 invalid-record 时存在。 */
  readonly detail?: InvalidRecordDetail

  /**
   * @param code - Stable discriminant for the failure class.
   * @param message - Human-readable diagnostic detail.
   * @param options - Standard error options plus the `invalid-record` location.
   */
  /**
   * @param code 稳定判别码，消费方按它分类处理。
   * @param message 给人看的诊断信息。
   * @param options 标准错误选项（cause）加上 invalid-record 的定位信息。
   */
  constructor(
    readonly code: DomainErrorCode,
    message: string,
    options?: DomainErrorOptions,
  ) {
    super(message, options)
    if (options?.detail) this.detail = options.detail
  }
}
