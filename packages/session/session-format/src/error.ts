/** Error raised when a durable Session artifact cannot be restored or migrated losslessly. */

/*
 * 【文件职责】区分无法无损恢复的格式错误与源格式策略不支持的迁移，供持久化后端统一报告。
 */

export class SessionFormatError extends Error {
  override readonly name: string = 'SessionFormatError'
}

/** A readable artifact whose released source policy has no supported migration. */
export class SessionFormatUnsupportedMigrationError extends SessionFormatError {
  override readonly name = 'SessionFormatUnsupportedMigrationError'
}
