/**
 * ================================ 文件注释 ================================
 * 【文件职责】downloads 域的 zod schema：把 session.export 的查询参数解析为
 * sessionLog 请求形状。下载表面无线上信封——请求以查询参数（全是字符串）到达，
 * 因此请求 schema 解析原始查询参数对象。
 * 【技术维度】sessionIdSchema 是本域唯一品牌铸造点（托管在 sessions.schema，
 * 与所有其他铸造点同处）；includeDescendants 只接受 true/false/缺省，拼错的
 * 标志会被拒绝（400）而非静默少导出。
 * 【产品维度】会话日志下载 URL 的查询参数校验：?sessionId=...&includeDescendants=true。
 * 【逻辑维度】查询参数 schema → transform 为精确请求形状（字符串 'true' 转布尔）。
 * 【关键边界】transform 只把 'true' 展开为 includeDescendants: true，'false' 与
 * 缺省都不带该字段（undefined 语义）。
 * 【新手阅读建议】与 downloads.ts 契约及 fetch/handler.ts 的
 * /api/session.export 路由对照阅读。
 * ==========================================================================
 */
/**
 * downloads domain zod schemas. The download surface has no wire
 * envelope: the request arrives as query parameters (all strings), so its
 * request schema parses the raw query-parameter object into the method's
 * exact request shape. SessionId brand cast point: sessionIdSchema, and only
 * there (hosted in sessions.schema like every other cast).
 */

import { z } from 'zod'
import type { DownloadsApi } from './downloads.ts'
import { sessionIdSchema } from './sessions.schema.ts'

/**
 * session.export query params → the sessionLog request. `includeDescendants`
 * accepts exactly `true`/`false`/absent; any other value is rejected (400) so
 * a misspelled flag cannot silently under-export.
 */
// session.export 查询参数 → sessionLog 请求：includeDescendants 仅接受
// true/false/缺省，其余值一律 400 拒绝，防止拼错的标志导致静默少导出。
export const sessionLogQuerySchema = z
  .object({
    sessionId: sessionIdSchema,
    includeDescendants: z.union([z.literal('true'), z.literal('false')]).optional(),
  })
  .transform(query => ({
    sessionId: query.sessionId,
    ...(query.includeDescendants === 'true' ? { includeDescendants: true } : {}),
  })) satisfies z.ZodType<Parameters<DownloadsApi['sessionLog']>[0]>
