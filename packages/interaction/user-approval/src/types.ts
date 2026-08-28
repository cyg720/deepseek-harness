/**
 * Wire-safe approval identifiers and outcome vocabulary, free of
 * cordis/service imports so browser type chains can
 * consume them without loading this package's Context augmentation.
 * @module @deepseek-ai/dsh-user-approval/types
 */
/*
 * 文件职责：定义浏览器安全的审批请求品牌标识和封闭审批结果词汇。
 * 技术维度：使用零依赖 Branded 类型与字符串字面量联合，避免加载 Cordis 服务实现。
 * 产品维度：把一次审批询问与最终决定可靠关联，并让调用方明确处理拒绝、取消和不可用。
 * 逻辑维度：声明 ApprovalRequestId 和品牌函数，再列出四种互斥 ApprovalOutcome。
 * 关键边界：品牌函数不校验字符串；unavailable 必须按失败关闭处理，不能等同于允许。
 * 新手阅读建议：先看 ID 如何配对 asked/decided 事件，再逐个理解四种结果对执行权限的影响。
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { Scoped } from '@deepseek-ai/dsh-scope'
import type { Agent } from '@deepseek-ai/dsh-agent/types'
import type { ToolCallId } from '@deepseek-ai/dsh-llm/brand'

/**
 * Pairs one `approval/asked` audit event with its `approval/decided`.
 * Service-issued (one fresh id per {@link ApprovalService.request} call).
 */
/* ApprovalRequestId：每次审批请求新生成的标识，用于配对 asked 与 decided 审计事件。 */
export type ApprovalRequestId = Branded<'ApprovalRequestId'>

/**
 * Brand a string as an {@link ApprovalRequestId}.
 * @param id - the raw id string to brand.
 * @returns the same string carrying the brand.
 */
/*
 * 把服务已生成的原始字符串标记为 ApprovalRequestId。
 * @param id - 每次 ApprovalService.request 新生成的原始 ID。
 * @returns 运行时不变、仅增加编译期品牌的同一字符串。
 * @example ApprovalRequestId('approval-1')。
 */
export function ApprovalRequestId(id: string): ApprovalRequestId {
  return id as ApprovalRequestId
}

/**
 * Closed approval outcomes: a one-shot grant, explicit rejection, withdrawn
 * request, or unavailable answerer. Callers fail closed on `unavailable`.
 */
/* ApprovalOutcome：一次性允许、明确拒绝、请求撤销或回答者不可用四种封闭结果。 */
export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * An approval question was put to the answerer chain — log-only audit
     * (like `hook/*`; NOT a surface event, carries no `surfaceOp`). `id` pairs
     * it with the `approval/decided` that always follows; `toolName` is the
     * tool the question is about, `callId` the exact tool call when the asker
     * had one, `reason` the asker's human-readable explanation (e.g. a hook's
     * permission-decision reason).
     */
    'approval/asked': {
      id: ApprovalRequestId
      toolName: string
      callId?: ToolCallId
      reason?: string
    }
    /**
     * The outcome of a prior `approval/asked` (same `id`) — log-only audit.
     * Exactly one per ask, appended when the outcome is known: a decision, a
     * cancellation, or the fail-closed `'unavailable'`.
     */
    'approval/decided': {
      id: ApprovalRequestId
      outcome: ApprovalOutcome
    }
  }
}

/** Client-safe payload declared for the approval answerer waterfall. */
export interface ApprovalRequestEvent {
  /** Agent identity projected to the corresponding Client Context in transit. */
  readonly agent: Agent
  /** Tool whose operation requires a decision. */
  readonly toolName: string
  /** Exact tool call being decided, when available. */
  readonly callId?: ToolCallId
  /** Human-readable reason supplied by the asker. */
  readonly reason?: string
  /** Cancellation lifetime of the pending request. */
  readonly signal?: AbortSignal
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Ask composed answerers for one decision. Return an outcome to claim the
     * request or call `next()` to delegate. Scope-filtered dispatch
     * (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
     * @param req - pending approval request.
     * @mode waterfall
     */
    'approval/request'(
      this: Scoped<Agent>,
      req: ApprovalRequestEvent,
      next: () => Promise<ApprovalOutcome>,
    ): Promise<ApprovalOutcome>
  }
}
