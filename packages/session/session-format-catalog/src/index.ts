/** Build-static first-party Session format migration catalog. */

/*
 * 【文件职责】导出构建期固定的第一方会话格式目录，供持久化读取选择编解码和迁移路径。
 */

export { sessionFormatCatalog } from './generated.ts'
export { SessionFormatUnsupportedMigrationError } from '@deepseek-ai/dsh-session-format'
