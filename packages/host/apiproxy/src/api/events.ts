/**
 * ================================ 文件注释 ================================
 * 【文件职责】events 域契约：两条逻辑事件流（mux 聚合流 + host 宿主流）的签名
 * 与帧联合。四象限语义：流产出窄形式 RpcRequest<Frame>（server-request 视图）
 * ——rpcId 必须暴露给业务层，因为可回答帧（approval/question requested）的响应
 * 要回显它；纯推送帧用它标识该次推送。
 * 【技术维度】纯类型契约；signal 是本地流控制参数、独立于请求（绝不上线）；
 * ToolEventView 是宿主在发射时刻经注册 presenter 计算的渲染意图（纯派生、不
 * 持久化）；声明合并从 dsh-tools 重新导出展示词汇。
 * 【产品维度】会话列表/消息流的实时推送（mux）与宿主级信息（会话增删、运行
 * 状态、工作区变更、归档集、白名单宿主事件）推送（host）。
 * 【逻辑维度】ToolEventView / QueuedInboxItem → EventsApi（mux/host 打开器）→
 * MuxFrame 联合（事件透传 + 控制 + 审批/提问 + 队列/任务/投影快照）→ HostFrame
 * 联合（会话/状态/工作区/远程事件）。
 * 【关键边界】mux 打开时先为每个附着会话发 subscribed 控制帧，再重放仍待决的
 * 审批/提问帧（rpcId 原样复用，是刷新恢复基线）；since 是 v1 未实现的续传钩子
 * （传了也被忽略），重连 = 重开流 + 重取历史；session/queue 与 session/jobs 发
 * 整快照（无持久化事件可回放）；host/remote-event 原样转发、不投影不脱敏。
 * 【新手阅读建议】先读 MuxFrame 与 HostFrame 两个联合，再看 EventsApi 打开器
 * 的基线语义，最后对照 api-proxy.ts 的 events 域实现。
 * ==========================================================================
 */
/**
 * events domain contract: signatures and frame unions for the two logical
 * streams. Four-quadrant: streams yield the narrow form `RpcRequest<Frame>` (server-request
 * view) — rpcId must be exposed to the business layer, because responses to answerable frames
 * (approval/question requested) echo it; for pure pushes it identifies that one push.
 * signal is a local stream-control parameter, independent of the request (never on the wire).
 */

import type { AskUserQuestionItem } from '@deepseek-ai/dsh-user-questions/types'
import type { ApprovalOutcome, ApprovalRequestId } from '@deepseek-ai/dsh-user-approval/types'
import type { Message } from '@deepseek-ai/dsh-llm/types'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { CallId } from '@deepseek-ai/dsh-llm/brand'
import type { JsonValue, SessionEvent, SessionId } from '@deepseek-ai/dsh-session/types'
import type { ToolCallView, ToolResultView } from '@deepseek-ai/dsh-tools/presentation'
import type { RpcError, RpcId, RpcRequest } from './rpc.ts'
import type { JobView } from './jobs.ts'
import type { WorkspaceView } from './workspace.ts'

// Client-side consumers take the render-intent vocabulary from the contract;
// dsh-tools remains its owner.
// 客户端消费者从契约取渲染意图词汇；dsh-tools 仍是其属主。
export type { ToolCallView, ToolResultView } from '@deepseek-ai/dsh-tools/presentation'

/**
 * Host-computed render intent accompanying a `tool/call` or `tool/result`
 * event. A pure derivation of args/result through the presenter registered at
 * emission time — never persisted (the session log carries only the event), so
 * the same event may carry a different view (or none) on a later delivery.
 * `for` names which vocabulary applies without re-inspecting the event type.
 * An absent view means the client's documented default (generic JSON card).
 */
// 宿主在发射时刻为 tool/call 或 tool/result 事件计算的渲染意图：参数/结果经
// 注册的 presenter 纯派生，绝不持久化——同一事件后续投递可能带不同视图（或
// 没有）；缺失视图 = 客户端默认（通用 JSON 卡片）。
export type ToolEventView =
  | { for: 'call'; view: ToolCallView }
  | { for: 'result'; view: ToolResultView }

/** One pending inbox occurrence in the authoritative `session/queue` snapshot. */
// 权威 session/queue 快照中的一条待处理收件箱记录。
export interface QueuedInboxItem {
  /** Message identity used by inbox mutations. */
  // 收件箱变更使用的消息身份。
  id: MessageId
  /** Agent-resolved FIFO placement; queued and steering items render on different surfaces, context items stay invisible until claimed. */
  // Agent 解析的 FIFO 位置：queued/steering 渲染在不同表面，context 在被认领前不可见。
  placement: 'queued' | 'steering' | 'context'
  /** Complete pending message; it is not durable until the Agent claims it. */
  // 完整待处理消息；Agent 认领前不持久化。
  message: Message
}

/** Streaming face of the contract: the two logical stream openers (mux + host). */
// 契约的流式面孔：两个逻辑流打开器。
export interface EventsApi {
  /**
   * All-session aggregated mux stream. On open, emits a subscribed control frame for every
   * attached session, then replays each session's still-pending approval/question requested
   * frames (rpcId reused verbatim — the refresh-recovery baseline). Session titles ride the
   * generic projection pair (history-tail projections block + session/projection frames).
   * since: resume hook, unimplemented in v1 (ignored if passed); reconnection = reopen the
   * stream + refetch history.
   */
  mux(request: RpcRequest<{ since?: Record<SessionId, number> }>, signal: AbortSignal): AsyncIterable<RpcRequest<MuxFrame>>

  /**
   * Host-level info stream: session create/destroy, running-status flips, and
   * agent failures with no turn position. Empty payload uses `{}`.
   */
  host(request: RpcRequest<{}>, signal: AbortSignal): AsyncIterable<RpcRequest<HostFrame>>
}

/**
 * Mux stream frames: raw session-event passthrough + control frames +
 * approval/question frames (requested = answerable server-request, the rest are pure pushes).
 */
export type MuxFrame =
  | { type: 'session/event'; sessionId: SessionId; event: SessionEvent; view?: ToolEventView }
  | { type: 'session/subscribed'; sessionId: SessionId; lastSeq: number }
  | { type: 'approval/requested'; sessionId: SessionId; approvalId: ApprovalRequestId; toolName: string; callId?: CallId; reason?: string }
  | { type: 'approval/resolved'; sessionId: SessionId; approvalId: ApprovalRequestId; outcome: ApprovalOutcome }
  | { type: 'question/requested'; sessionId: SessionId; questions: AskUserQuestionItem[] }
  | { type: 'question/resolved'; sessionId: SessionId; questionRpcId: RpcId; outcome: 'answered' | 'cancelled' }
  /**
   * Complete transient inbox state after every enqueue, mutation, claim, or
   * discard. Pending work is not model-visible and therefore has no durable
   * session event; the whole snapshot makes edit, deletion, cancel, and
   * reconnect converge through one authoritative signal. `session/queue`
   * covers both resolved placements: queued items render
   * in QueueDock, while pending steering renders at the conversation tail.
   */
  | { type: 'session/queue'; sessionId: SessionId; items: QueuedInboxItem[] }
  /**
   * Complete set of background jobs this session can see, after every registry
   * commit that changes it: registration, the stopping transition, settlement,
   * and owner-disposal removal. The registry is process-local and holds no
   * durable event, so — exactly like `session/queue` — the whole snapshot is
   * what makes a start, a kill, a reconnect, and a second tab converge on one
   * authoritative value.
   *
   * Sent as a subscription baseline only for a session that currently has
   * tasks; an absent key means an empty set. A change that empties the set
   * still sends `[]`, since that transition is the only one absence cannot
   * express.
   */
  | { type: 'session/jobs'; sessionId: SessionId; jobs: JobView[] }
  /**
   * One projection unit's finished value changed (session-projection RFC).
   * Live push state, never logged — replay recomputes on the host (the
   * tool-view posture). `value` is the unit's schema-validated view output;
   * `seq` is the unit's watermark at emission. Clients keep one generic
   * per-session value store under higher-seq-wins, seeded by the history
   * tail page's projections block.
   */
  | { type: 'session/projection'; sessionId: SessionId; key: string; value: unknown; seq: number }
  | { type: 'stream/error'; error: RpcError }

/**
 * Host stream frames. session-added carries the lineage anchor, product
 * origin, project cwd, and blank bit (the list-summary fields a client cannot
 * wait for a refresh to learn); the frame fires at session/created, so blank is
 * constantly true — clients flip it on the session's first
 * `host/session-status(running:true)` (a blank session never runs), and a
 * reconnecting client takes `session.list`'s summary.blank as authoritative.
 * agent-error is the only outlet for live failures with no turn position;
 * workspace-changed pushes the full new snapshot after every durable
 * workspace mutation (create/attach/order change — the client upserts, while
 * `workspace.list` provides the reconnect baseline); workspace-removed is the
 * committed registration-deletion increment and never implies directory or
 * session-log deletion; workspace-order-changed pushes the complete durable
 * registry order after a reorder; archived-sessions-changed pushes the full registry
 * archive set after every durable change (same full-snapshot posture as
 * workspace-changed — `workspace.list` re-baselines it on reconnect).
 */
export type HostFrame =
  | {
    type: 'host/session-added'
    sessionId: SessionId
    blank: boolean
    parentSessionId?: SessionId
    origin?: 'subagent'
    cwd?: string
    agentPreset?: string
  }
  | { type: 'host/session-removed'; sessionId: SessionId }
  | { type: 'host/session-status'; sessionId: SessionId; running: boolean }
  | { type: 'host/agent-error'; sessionId: SessionId; message: string }
  | { type: 'host/workspace-changed'; workspace: WorkspaceView }
  | { type: 'host/workspace-removed'; workspaceId: WorkspaceView['workspaceId'] }
  | { type: 'host/workspace-order-changed'; workspaceIds: WorkspaceView['workspaceId'][] }
  | { type: 'host/archived-sessions-changed'; archivedSessionIds: SessionId[] }
  /**
   * One allowlisted host cordis event forwarded verbatim. The allowlist is
   * owned by `@deepseek-ai/dsh-api-remotes` (`API_REMOTE_FORWARDED_EVENTS`),
   * which is also the only control point over what a consumer can receive.
   * `event` is the host's own event name and `args` its argument list: this
   * path applies no projection, no redaction, and no renaming, so the payload
   * contract is the owner package's cordis `Events` declaration rather than
   * anything stated here. Delivery lands on `ctx.remote.$on`, not on a
   * per-event frame variant.
   */
  | { type: 'host/remote-event'; event: string; args: JsonValue[] }
  | { type: 'stream/error'; error: RpcError }
