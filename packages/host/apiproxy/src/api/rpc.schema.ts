/**
 * ================================ 文件注释 ================================
 * 【文件职责】消息层的 zod 运行时校验 schema：四种线上完整形式（client-request、
 * server-response、server-request、client-response）、错误体与载体回执。
 * 【技术维度】完整形式里 payload/result.value 槽位保持宽类型（unknown），业务
 * 载荷由各方法的第二次解析完成（两级解析纪律）；Wire<T> 类型做契约类型与 zod
 * optional 输出（T | undefined）之间的宽度对齐；rpcIdSchema 是全文件唯一的
 * 品牌铸造点。
 * 【产品维度】远程客户端与宿主网关在线上边界做确定性校验：格式错误的消息在
 * 载体层就被识别为 bad-request，避免把畸形数据送进业务层。
 * 【逻辑维度】Wire 宽度类型 → rpcIdSchema → 错误体 schema（按 code 判别联合）→
 * rpcResultSchema 通用包装 → 四种完整形式 → 完整形式联合 → 载体回执 schema。
 * 【关键边界】rpcId 不做最小长度校验（它是不透明回显令牌，拒绝会破坏错误关联）；
 * 成功结果的 value 槽可选——void 业务结果序列化时干脆没有 value 字段，但各端点
 * 的二次解析仍要求声明过的值必须存在。
 * 【新手阅读建议】先读 Wire 类型理解"宽度加宽"为何存在，再看 rpcErrorSchema 的
 * 判别联合结构，最后对照 rpc.ts 的类型定义理解 schema 与类型互为镜像。
 * ==========================================================================
 */
/**
 * Message-layer zod schemas: the four wire full forms + error body +
 * carrier receipt. The payload slot is unknown in the full-form schemas — business payloads
 * get a second parse dispatched by method (two-level parse discipline).
 * Brand cast point: rpcIdSchema, and only there.
 */

import { z } from 'zod'
import type { z as zCore } from 'zod'
type ZodIssue = zCore.core.$ZodIssue
import type { ClientRequest, ClientResponse, RpcError, RpcId, RpcReceipt, ServerRequest, ServerResponse } from './rpc.ts'

/**
 * Wire widening of a contract type: widens every property (deeply) to `original | undefined`.
 * The repo enables exactOptionalPropertyTypes while zod `.optional()` outputs `T | undefined`,
 * so `satisfies z.ZodType<ContractType>` is unusable across the board; anchoring is always
 * written `satisfies z.ZodType<Wire<ContractType>>` — the widening only adds undefined, so
 * missing fields / wrong types still fail to compile. On the JSON wire, "absent" and
 * "value undefined" serialize identically, so the widening loses no validation semantics.
 */
export type Wire<T> = T extends readonly (infer E)[] ? Wire<E>[]
  : T extends object ? { [K in keyof T]: Wire<T[K]> | undefined }
    : T
// Wire<T> 递归把每个属性宽度化为"原值 | undefined"，对齐 zod optional 输出；
// 线上 JSON 里"字段缺失"与"值为 undefined"序列化结果相同，因此不损失校验语义。
/**
 * RpcId: one brand cast after schema validation (the only cast point in this
 * file). No min-length: the id is an opaque echo token, and rejecting values
 * here would only turn a correlatable error report into a client-side parse
 * failure (the handler substitutes a sentinel when a request's id is unreadable).
 */
// RpcId 校验：schema 通过后做唯一一次品牌 cast。不做最小长度校验——id 是不透明
// 回显令牌，拒绝只会把可关联的错误报告变成客户端解析失败（请求 id 不可读时
// 处理器会代之以哨兵值）。
export const rpcIdSchema = z.string() as unknown as z.ZodType<RpcId>

/** Error body: discriminated by code, per-branch details aligned to RpcErrorDetailsMap; details is required. */
// 错误体 schema：按 code 判别联合，每支的 details 与 RpcErrorDetailsMap 对齐，
// details 必填（internal 用显式空对象）。这是线上错误词汇的运行时镜像。
export const rpcErrorSchema: z.ZodType<RpcError> = z.discriminatedUnion('code', [
  z.object({ code: z.literal('bad-request'), message: z.string(), details: z.object({ issues: z.array(z.custom<ZodIssue>()) }) }),
  z.object({ code: z.literal('cancelled'), message: z.string(), details: z.object({}) }),
  z.object({ code: z.literal('session-not-found'), message: z.string(), details: z.object({ sessionId: z.string() }) }),
  z.object({ code: z.literal('model-unavailable'), message: z.string(), details: z.object({ provider: z.string(), model: z.string() }) }),
  z.object({ code: z.literal('session-conflict'), message: z.string(), details: z.object({ sessionId: z.string(), requestedCwd: z.string(), existingCwd: z.string().optional() }) }),
  z.object({ code: z.literal('invalid-time-zone'), message: z.string(), details: z.object({ value: z.string() }) }),
  z.object({ code: z.literal('workspace-attach-failed'), message: z.string(), details: z.object({ sessionId: z.string(), workspaceId: z.string() }) }),
  z.object({ code: z.literal('workspace-not-found'), message: z.string(), details: z.object({ workspaceId: z.string() }) }),
  z.object({ code: z.literal('workspace-invalid-path'), message: z.string(), details: z.object({ path: z.string() }) }),
  z.object({ code: z.literal('workspace-name-conflict'), message: z.string(), details: z.object({ name: z.string() }) }),
  z.object({ code: z.literal('workspace-move-invalid'), message: z.string(), details: z.object({ workspaceId: z.string(), sessionId: z.string(), beforeSessionId: z.string().optional() }) }),
  z.object({ code: z.literal('directory-unreadable'), message: z.string(), details: z.object({ path: z.string() }) }),
  z.object({ code: z.literal('directory-exists'), message: z.string(), details: z.object({ path: z.string() }) }),
  z.object({ code: z.literal('directory-create-failed'), message: z.string(), details: z.object({ path: z.string() }) }),
  z.object({ code: z.literal('directory-picker-unavailable'), message: z.string(), details: z.object({ capability: z.string() }) }),
  z.object({ code: z.literal('agent-preset-read-only'), message: z.string(), details: z.object({ agentPreset: z.string(), reason: z.string() }) }),
  z.object({ code: z.literal('agent-preset-locked'), message: z.string(), details: z.object({ sessionId: z.string(), agentPreset: z.string() }) }),
  z.object({ code: z.literal('agent-preset-conflict'), message: z.string(), details: z.object({ sessionId: z.string(), requestedPreset: z.string(), existingPreset: z.string().optional() }) }),
  z.object({ code: z.literal('agent-preset-not-found'), message: z.string(), details: z.object({ agentPreset: z.string(), available: z.array(z.string()) }) }),
  z.object({ code: z.literal('agent-preset-invalid'), message: z.string(), details: z.object({ agentPreset: z.string(), reason: z.string() }) }),
  z.object({ code: z.literal('agent-busy'), message: z.string(), details: z.object({ reason: z.string() }) }),
  z.object({ code: z.literal('attachment-error'), message: z.string(), details: z.object({ reason: z.string() }) }),
  z.object({ code: z.literal('queue-item-not-found'), message: z.string(), details: z.object({ itemId: z.string() }) }),
  z.object({ code: z.literal('steer-unavailable'), message: z.string(), details: z.object({ itemId: z.string() }) }),
  z.object({ code: z.literal('command-error'), message: z.string(), details: z.object({}) }),
  z.object({ code: z.literal('unknown-command'), message: z.string(), details: z.object({}) }),
  z.object({ code: z.literal('settings-rejected'), message: z.string(), details: z.object({ ns: z.string() }) }),
  z.object({ code: z.literal('settings-conflict'), message: z.string(), details: z.object({ ns: z.string(), expected: z.number(), actual: z.number() }) }),
  z.object({ code: z.literal('credential-rejected'), message: z.string(), details: z.object({ ref: z.string() }) }),
  z.object({ code: z.literal('model-discovery-failed'), message: z.string(), details: z.object({ settingsNs: z.string(), baseURL: z.string().optional() }) }),
  z.object({ code: z.literal('title-invalid'), message: z.string(), details: z.object({ sessionId: z.string() }) }),
  z.object({ code: z.literal('fork-unavailable'), message: z.string(), details: z.object({ sessionId: z.string() }) }),
  z.object({ code: z.literal('subagent-parent-unavailable'), message: z.string(), details: z.object({ parentSessionId: z.string() }) }),
  z.object({ code: z.literal('subagent-not-found'), message: z.string(), details: z.object({ parentSessionId: z.string(), childSessionId: z.string() }) }),
  z.object({ code: z.literal('subagent-catalog-diagnostic'), message: z.string(), details: z.object({
    parentSessionId: z.string(),
    childSessionId: z.string(),
    reason: z.union([z.literal('corrupt'), z.literal('unsupported'), z.literal('unavailable')]),
  }) }),
  z.object({ code: z.literal('subagent-not-resumable'), message: z.string(), details: z.object({ childSessionId: z.string() }) }),
  z.object({ code: z.literal('subagent-unauthorized'), message: z.string(), details: z.object({ childSessionId: z.string() }) }),
  z.object({ code: z.literal('subagent-delivery-unavailable'), message: z.string(), details: z.object({ childSessionId: z.string() }) }),
  z.object({ code: z.literal('internal'), message: z.string(), details: z.object({}) }),
]) as unknown as z.ZodType<RpcError>

/**
 * Business success/failure result schema (generic, reusable).
 * @param value - Schema for the business value.
 * @returns Schema for RpcResult<T>.
 */
// 通用业务结果 schema 工厂：成功携带业务值、失败携带错误体的二选一联合。
export function rpcResultSchema<T>(value: z.ZodType<T>): z.ZodUnion<readonly [z.ZodType, z.ZodType]> {
  return z.union([
    z.object({ ok: z.literal(true), value }),
    z.object({ ok: z.literal(false), error: rpcErrorSchema }),
  ])
}

// ---- The four wire full-form schemas (payload/result.value slots stay wide — business layer does the second parse) ----
// The wide value slot is optional: a void business result serializes with no
// `value` field at all. Each endpoint's own second parse still requires its
// declared value, so absence never passes for a method that returns data.

/** ClientRequest full form (payload stays wide — the business layer runs the second parse). */
// 客户端请求完整形式（线上 POST /api/<method> 的请求体）：payload 保持宽类型。
export const clientRequestSchema = z.object({
  type: z.literal('client-request'),
  rpcId: rpcIdSchema,
  method: z.string(),
  payload: z.unknown(),
}) as unknown as z.ZodType<ClientRequest>

/** ServerResponse full form (result.value stays wide). */
// 服务端响应完整形式（该 POST 的响应体）：result.value 保持宽类型。
export const serverResponseSchema = z.object({
  type: z.literal('server-response'),
  rpcId: rpcIdSchema,
  result: rpcResultSchema(z.unknown().optional()),
}) as unknown as z.ZodType<ServerResponse>

/** ServerRequest full form (payload stays wide). */
// 服务端请求完整形式（下行流帧）：由服务端发起，可回答或纯推送。
export const serverRequestSchema = z.object({
  type: z.literal('server-request'),
  rpcId: rpcIdSchema,
  method: z.string(),
  payload: z.unknown(),
}) as unknown as z.ZodType<ServerRequest>

/** ClientResponse full form (result.value stays wide). */
// 客户端响应完整形式（POST /api/respond 的请求体）：回显服务端请求的 rpcId。
export const clientResponseSchema = z.object({
  type: z.literal('client-response'),
  rpcId: rpcIdSchema,
  result: rpcResultSchema(z.unknown().optional()),
}) as unknown as z.ZodType<ClientResponse>

/** Wire full-form union (discriminated by type). */
// 四种完整形式的线上联合 schema：按 type 字段判别。
export const rpcMessageSchema = z.discriminatedUnion('type', [
  clientRequestSchema as unknown as z.ZodObject<z.ZodRawShape>,
  serverResponseSchema as unknown as z.ZodObject<z.ZodRawShape>,
  serverRequestSchema as unknown as z.ZodObject<z.ZodRawShape>,
  clientResponseSchema as unknown as z.ZodObject<z.ZodRawShape>,
])

/** Carrier receipt schema. */
// 载体回执 schema：应答被接受，或给出 not-pending（迟到/重复）/bad-response 理由。
export const rpcReceiptSchema = z.union([
  z.object({ accepted: z.literal(true) }),
  z.object({ accepted: z.literal(false), reason: z.union([z.literal('not-pending'), z.literal('bad-response')]) }),
]) satisfies z.ZodType<Wire<RpcReceipt>>
