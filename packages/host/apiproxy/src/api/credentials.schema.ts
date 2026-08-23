/**
 * ================================ 文件注释 ================================
 * 【文件职责】credentials 域的 zod schema 集合（名字从地图键派生）：describe /
 * set / unset 的请求载荷与响应值校验。
 * 【技术维度】引用名模式镜像接缝的 credentialRef 守卫——非法名字在到达服务前就
 * 以 bad-request 失败；describe 请求的 refs 数组上限 64；satisfies Wire<> 对齐。
 * 【产品维度】凭据管理界面（配置状态/设置/清除）的数据校验；值只在一个方向
 * 过线（credentials.set）。
 * 【逻辑维度】credentialRefNameSchema（POSIX 可移植环境变量名）→ 视图 schema →
 * 三个方法的请求/响应 schema。
 * 【关键边界】值最小长度 1（不允许空值）；ref 必须是合法环境变量名（字母/下划线
 * 开头，仅字母数字下划线）。
 * 【新手阅读建议】与 credentials.ts 契约及 api-proxy.ts 的 credentials 域对照。
 * ==========================================================================
 */
/**
 * credentials domain zod schemas (names derived from map keys:
 * credentialsDescribeRequestSchema / credentialsDescribeValueSchema / …).
 * The reference-name pattern mirrors the seam's `credentialRef` guard so an
 * invalid name fails as `bad-request` before reaching the service.
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import type { CredentialView } from './credentials.ts'

/** POSIX-portable environment-variable name (the seam's `credentialRef` pattern). */
// POSIX 可移植环境变量名：与接缝 credentialRef 守卫同款模式。
export const credentialRefNameSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/)

/** CredentialView entry of credentials.describe. */
// credentials.describe 的凭据视图条目。
export const credentialViewSchema = z.object({
  configured: z.boolean(),
  source: z.string().optional(),
  writable: z.boolean(),
}) satisfies z.ZodType<Wire<CredentialView>>

/** credentials.describe request payload. */
export const credentialsDescribeRequestSchema = z.object({
  refs: z.array(credentialRefNameSchema).max(64),
}) satisfies z.ZodType<Wire<RequestPayload<'credentials.describe'>>>

/** credentials.describe response value. */
export const credentialsDescribeValueSchema = z.object({
  credentials: z.record(z.string(), credentialViewSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'credentials.describe'>>>

/** credentials.set request payload: the one direction a value crosses this wire. */
export const credentialsSetRequestSchema = z.object({
  ref: credentialRefNameSchema,
  value: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'credentials.set'>>>

/** credentials.set response value. */
export const credentialsSetValueSchema = z.object({}) satisfies z.ZodType<Wire<ResponseValue<'credentials.set'>>>

/** credentials.unset request payload. */
export const credentialsUnsetRequestSchema = z.object({
  ref: credentialRefNameSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'credentials.unset'>>>

/** credentials.unset response value. */
export const credentialsUnsetValueSchema = z.object({}) satisfies z.ZodType<Wire<ResponseValue<'credentials.unset'>>>
