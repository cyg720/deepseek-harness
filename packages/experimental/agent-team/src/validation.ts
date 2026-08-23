/**
 * ================================ 文件注释 ================================
 * 【文件职责】团队名册与任务命令共享的输入规范化：必填文本与工作区相对路径前缀。
 * 【技术维度】requiredText 裁剪并限长；writeScope 把路径前缀规范为斜杠分隔的
 *   工作区相对形式，拒绝绝对路径、盘符、空段与 . / .. 段。
 * 【产品维度】防止队友名/任务文本/写作用域出现非法或歧义输入。
 * 【逻辑维度】requiredText → writeScope。
 * 【新手阅读建议】看 writeScope 的拒绝规则（安全相关）。
 * ==========================================================================
 */

/** Input normalization shared by Team roster and task commands. */

import { TeamError } from './error.ts'

/**
 * Normalize one required human-authored string.
 * @param value - raw input value.
 * @param field - diagnostic field name.
 * @param maxLength - maximum normalized character count.
 * @returns trimmed non-empty text.
 */
export function requiredText(value: string, field: string, maxLength: number): string {
  const text = value.trim()
  if (text.length === 0) throw new TeamError(`${field} must be non-empty`, 'TEAM_INVALID_ARGUMENT')
  if (text.length > maxLength) {
    throw new TeamError(`${field} exceeds ${maxLength} characters`, 'TEAM_INVALID_ARGUMENT')
  }
  return text
}

/**
 * Normalize one workspace-relative path prefix without treating it as a lock.
 * @param value - user-authored path prefix.
 * @returns normalized slash-separated prefix.
 */
export function writeScope(value: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//u, '').replace(/\/+$/u, '')
  const segments = normalized.split('/')
  if (normalized.length === 0 || normalized.startsWith('/') || /^[a-z]:/iu.test(normalized)
    || segments.some(segment => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new TeamError(`invalid workspace-relative write scope ${JSON.stringify(value)}`, 'TEAM_INVALID_WRITE_SCOPE')
  }
  return normalized
}
