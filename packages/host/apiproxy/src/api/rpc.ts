/**
 * ================================ 文件注释 ================================
 * 【文件职责】定义 apiproxy 的"四象限 RPC 消息模型"：消息与物理通道解耦——
 * HTTP、WebSocket、进程内 SSE 只是传输载体，逻辑消息是四成员判别联合
 * （client-request / server-response / server-request / client-response）。
 * 【技术维度】零 Node 依赖（浏览器可导入）；RpcId 是品牌化字符串（Branded<>
 * 编译期约束）；错误码→详情类型由 RpcErrorDetailsMap 驱动，形成与 RpcMethodMap
 * 同构的第二张表；transportError 统一折叠传输异常。
 * 【产品维度】这是远程客户端与宿主网关之间一切通信的"语言规范"：客户端发请求、
 * 宿主回响应、宿主发可回答交互（审批/提问）、客户端回答案，四种消息各司其职；
 * 业务方法绝不 throw，全部折叠进 RpcResult 的成功/失败分支。
 * 【逻辑维度】RpcId 与铸造函数 → 错误码→详情映射表 → 判别联合 RpcError →
 * RpcResult → 窄形式（RpcRequest/RpcResponse）→ 四种线上完整形式（ClientRequest
 * 等）→ RpcMessage 联合与传输回执 RpcReceipt。
 * 【关键边界】rpcId 由发起方铸造，响应只回显绝不新铸；ServerRequest 是否期待
 * 响应由方法静态决定（严格二分，无第三种）；RpcReceipt 属于载体层而非消息。
 * 【新手阅读建议】先记住四象限判别（type 字段），再读 RpcError 判别联合的
 * 收窄用法，最后看 RpcReceipt 的"载体层 vs 消息层"分野。
 * ==========================================================================
 */
/**
 * Four-quadrant RPC message model. Channels and messages are decoupled: HTTP,
 * WebSocket, and in-process SSE are physical carriers, while logical messages
 * are channel-independent and form a four-member discriminated union.
 * api/ contract layer: zero Node dependencies, importable from the browser.
 */

import type { z as zCore } from 'zod'
type ZodIssue = zCore.core.$ZodIssue
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/**
 * Message correlation id: the initiator mints it on a request; a response
 * echoes the matching request's rpcId and never mints a new one.
 */
// 消息关联 id：发起方在请求时铸造，响应只回显匹配请求的 rpcId、绝不新铸。
// 品牌化字符串（编译期约束，不能与裸 string 混用）。
export type RpcId = Branded<'rpc-id'>

/**
 * Brands a string as RpcId (same precedent as core `SessionId()`). Minted by the initiator:
 * client-request → client mints; server-request → host mints (answerable frames get a stable
 * logical id, pure pushes mint a fresh one each time).
 * @param id - Raw id string (implementations mint UUIDs; tests may pass fixtures).
 * @returns The same string, branded (compile-time cast, zero runtime cost).
 */
// 把字符串品牌化为 RpcId：纯编译期 cast、零运行时开销。发起方铸造——客户端
// 请求由客户端铸，服务端请求由宿主铸（可回答帧用稳定逻辑 id，纯推送每次新铸）。
export function RpcId(id: string): RpcId {
  return id as RpcId
}

/** Error code → details type map (a second table isomorphic to RpcMethodMap). New code = one row here + one branch in the error schema. */
// 错误码 → 详情类型的映射表（与 RpcMethodMap 同构的第二张表）：新增错误码 = 这里
// 加一行 + 错误 schema 加一支，编译器强制两端一致。
export interface RpcErrorDetailsMap {
  'bad-request': { issues: ZodIssue[] }
  'cancelled': {}
  'session-not-found': { sessionId: SessionId }
  'model-unavailable': { provider: string; model: string }
  'session-conflict': { sessionId: SessionId; requestedCwd: string; existingCwd?: string }
  'invalid-time-zone': { value: string }
  'workspace-attach-failed': { sessionId: SessionId; workspaceId: string }
  'workspace-not-found': { workspaceId: string }
  'workspace-invalid-path': { path: string }
  'workspace-name-conflict': { name: string }
  'workspace-move-invalid': { workspaceId: string; sessionId: SessionId; beforeSessionId?: SessionId }
  'directory-unreadable': { path: string }
  'directory-exists': { path: string }
  'directory-create-failed': { path: string }
  'directory-picker-unavailable': { capability: string }
  'agent-preset-read-only': { agentPreset: string; reason: string }
  'agent-preset-locked': { sessionId: SessionId; agentPreset: string }
  'agent-preset-conflict': { sessionId: SessionId; requestedPreset: string; existingPreset?: string }
  'agent-preset-not-found': { agentPreset: string; available: string[] }
  'agent-preset-invalid': { agentPreset: string; reason: string }
  'agent-busy': { reason: string }
  'attachment-error': { reason: string }
  'queue-item-not-found': { itemId: MessageId }
  'steer-unavailable': { itemId: MessageId }
  /** A known slash command reported a usage/state error; the message is the command's own text. */
  'command-error': {}
  /** A leading-/ prompt named no registered command; the message names the token. */
  'unknown-command': {}
  /**
   * A settings write was refused (schema validation, unknown namespace,
   * read-only provider, or storage failure); the message is the seam's text.
   */
  'settings-rejected': { ns: string }
  /**
   * A settings write carried an `expectedRevision` the namespace has already
   * moved past: another writer (tab, editor, or an external file edit) landed
   * first. The details carry both revisions so a client can re-read and retry.
   */
  'settings-conflict': { ns: string; expected: number; actual: number }
  /** A credential write was refused (read-only shadowing layer or storage failure); the message is the seam's own text. */
  'credential-rejected': { ref: string }
  /**
   * Interrogating a draft provider endpoint did not produce a model listing:
   * no adapter family serves the namespace, the protocol has no listing this
   * build can read, or the endpoint was unreachable, refused the credential,
   * or answered with something else. The message is the adapter's own text —
   * it is what the form shows before falling back to hand-entry — and the
   * details name the endpoint asked, never the credential offered.
   */
  'model-discovery-failed': { settingsNs: string; baseURL?: string }
  'title-invalid': { sessionId: SessionId }
  'fork-unavailable': { sessionId: SessionId }
  'subagent-parent-unavailable': { parentSessionId: SessionId }
  'subagent-not-found': { parentSessionId: SessionId; childSessionId: SessionId }
  'subagent-catalog-diagnostic': {
    parentSessionId: SessionId
    childSessionId: SessionId
    reason: 'corrupt' | 'unsupported' | 'unavailable'
  }
  'subagent-not-resumable': { childSessionId: SessionId }
  'subagent-unauthorized': { childSessionId: SessionId }
  'subagent-delivery-unavailable': { childSessionId: SessionId }
  'internal': {}
}

/** Closed error-code union (the keys of RpcErrorDetailsMap). */
// 封闭的错误码联合：即映射表的键集合。
export type RpcErrorCode = keyof RpcErrorDetailsMap

/**
 * Distributive union expanded from the map: code is the discriminant, so
 * `switch (error.code)` narrows details. details is required (internal uses an explicit {}).
 */
// 从映射表展开的分配联合：code 是判别字段，switch(error.code) 可收窄 details；
// details 必填（internal 用显式空对象 {}）。
export type RpcError = {
  [C in RpcErrorCode]: { code: C; message: string; details: RpcErrorDetailsMap[C] }
}[RpcErrorCode]

/** Business success/failure result: the result slot of a unary response; methods never throw business errors. */
// 业务成败结果：一元响应的 result 槽位。业务方法绝不抛异常——失败也折叠为错误分支。
export type RpcResult<T> = { ok: true; value: T } | { ok: false; error: RpcError }

/**
 * Fold a transport exception into the RpcResult error branch (unified error
 * API; 'internal' as the catch-all code). Lives with RpcResult so every
 * carrier consumer folds the same way.
 * @param error - the thrown value from the carrier.
 * @returns the error branch of an RpcResult.
 */
// 把传输层异常折叠进 RpcResult 错误分支：统一错误 API，internal 为兜底码。
// 放在 RpcResult 旁边保证所有载体消费者用同一方式折叠。
export function transportError<T>(error: unknown): RpcResult<T> {
  return {
    ok: false,
    error: { code: 'internal', message: error instanceof Error ? error.message : String(error), details: {} },
  }
}

/**
 * Signature-layer narrow form, request side (domain-interface view, shared by
 * both directions): rpcId is explicit in the signature, never mixed into the
 * business payload; the type tag and method are filled in by the carrier layer.
 */
// 签名层窄形式（请求侧，双向共用）：rpcId 显式出现在签名中、绝不混进业务载荷；
// type 标签与方法由载体层补全。这是领域接口视图。
export interface RpcRequest<P> {
  rpcId: RpcId
  payload: P
}

/** Signature-layer narrow form, response side: rpcId always echoes the matching request. */
// 签名层窄形式（响应侧）：rpcId 永远回显匹配的请求。
export interface RpcResponse<T> {
  rpcId: RpcId
  result: RpcResult<T>
}

// ---- Wire full forms: four named members of a discriminated union (discriminant = the four `type` literals) ----

/** Call initiated by the client (wire carrier: POST /api/<method> body). */
// 客户端发起的调用（载体：POST /api/<method> 请求体）。
export interface ClientRequest {
  type: 'client-request'
  rpcId: RpcId
  method: string
  payload: unknown
}

/** Response to a ClientRequest (wire carrier: the HTTP response body of that POST); rpcId echoed. */
// 对 ClientRequest 的响应（载体：该 POST 的响应体）；rpcId 回显。
export interface ServerResponse {
  type: 'server-response'
  rpcId: RpcId
  result: RpcResult<unknown>
}

/**
 * Message initiated by the server (wire carrier: downstream stream frame). Answerable interactions
 * (approval/question requested — stable rpcId, reused on replay) and pure pushes
 * (session/event etc. — rpcId identifies that one push) share this shape; whether a
 * response is expected is determined statically by method (a strict dichotomy, no third kind).
 */
// 服务端发起的消息（载体：下行流帧）。可回答交互（审批/提问——稳定 rpcId，重放
// 复用）与纯推送（会话/事件等——rpcId 标识该次推送）共用此形状；是否期待响应
// 由方法静态决定（严格二分，无第三种）。
export interface ServerRequest {
  type: 'server-request'
  rpcId: RpcId
  method: string
  payload: unknown
}

/** Response to a ServerRequest (wire carrier: POST /api/respond body); rpcId echoed, never minted anew. */
// 对 ServerRequest 的响应（载体：POST /api/respond 请求体）；rpcId 回显、绝不新铸。
export interface ClientResponse {
  type: 'client-response'
  rpcId: RpcId
  result: RpcResult<unknown>
}

/** Authoritative wire full-form union; narrow via `switch (message.type)`. */
// 权威线上完整形式联合：用 switch(message.type) 收窄。
export type RpcMessage = ClientRequest | ServerResponse | ServerRequest | ClientResponse

/**
 * Carrier receipt (not an RpcMessage — it belongs to the carrier layer, same
 * discipline as "HTTP status describes only the carrier"): the HTTP response
 * body of the POST carrying a client-response. Late/duplicate responses yield not-pending.
 */
// 载体回执（不是 RpcMessage——它属于载体层，与"HTTP 状态只描述载体"同一纪律）：
// 携带客户端响应的 POST 的响应体。迟到/重复响应得到 not-pending。
export type RpcReceipt = { accepted: true } | { accepted: false; reason: 'not-pending' | 'bad-response' }
