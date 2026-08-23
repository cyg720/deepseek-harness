/**
 * ================================ 文件注释 ================================
 * 【文件职责】存储枢纽与各后端共用的错误词汇表：错误码联合与统一的 StorageError 异常类。
 * 【技术维度】与领域层错误（DomainError）并列的另一错误家族：StorageError 带稳定判别码
 * code，message 是给人看的诊断文本。
 * 【产品维度】后端实现（JSON/SQLite）与枢纽本身都抛 StorageError，上层按 code 分类处理，
 * 例如"介质版本不匹配"提示升级或迁移、"介质损坏"提示恢复备份。
 * 【逻辑维度】按出现顺序：StorageErrorCode（错误码：后端未找到/形态未挂载/重名注册/
 * 重复挂载/版本不匹配/介质损坏/已关闭）→ StorageError（异常类）。
 * 【关键边界】code 是稳定契约（消费方可 switch），message 仅诊断用途；领域层不会把
 * 这些错误重新包装成 DomainError，而是让它们直接穿透。
 * 【新手阅读建议】先看 StorageErrorCode 清单，再看类实现理解 code 与 message 的分工。
 * ==========================================================================
 */
/**
 * Error vocabulary for the storage hub and its backends.
 * @module @deepseek-ai/dsh-storage/src/error
 */
/**
 * 模块总览：本文件的错误同时被枢纽（hub）与后端实现使用；领域层错误在
 * dsh-storage-domain 的 error.ts 中定义，两者是两个独立家族。
 */

/** Discriminant codes carried by every {@link StorageError}. */
/**
 * StorageError 携带的错误码，消费方按它稳定分类：
 * backend-not-found 后端名未登记；form-not-mounted 数据形态未挂载；duplicate-backend
 * 后端重名登记；duplicate-mount 形态重复挂载；version-mismatch 介质版本不匹配；
 * malformed-medium 介质无法解析（损坏）；closed 已关闭后仍被调用。
 */
export type StorageErrorCode =
  | 'backend-not-found'
  | 'form-not-mounted'
  | 'duplicate-backend'
  | 'duplicate-mount'
  | 'version-mismatch'
  | 'malformed-medium'
  | 'closed'

/**
 * Error thrown by the hub and by backend implementations. The `code` is the
 * stable contract consumers may switch on; `message` is diagnostic prose.
 */
/**
 * 枢纽与后端实现抛出的错误：code 是稳定契约，message 是诊断说明。
 */
export class StorageError extends Error {
  override readonly name = 'StorageError'

  /**
   * @param code - Stable discriminant for the failure class.
   * @param message - Human-readable diagnostic detail.
   * @param options - Standard error options (`cause`).
   */
  /**
   * @param code 失败类别的稳定判别码。
   * @param message 给人看的诊断细节。
   * @param options 标准错误选项（cause 链上原始异常）。
   */
  constructor(
    readonly code: StorageErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}
