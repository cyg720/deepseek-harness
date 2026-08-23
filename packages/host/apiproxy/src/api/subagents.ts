/**
 * ================================ 文件注释 ================================
 * 【文件职责】subagents 域契约（浏览器安全）：持久化转写读取绝不激活 Agent，
 * 而可续写提示经"确切的实时直属父"路由进子 Agent 的收件箱。
 * 【技术维度】纯类型契约；SubagentListEntry 是完整持久化直属子目录行（含诊断
 * 行）；SubagentAddress 是选择客户端子代理传输的持久化父/子地址。
 * 【产品维度】远程 GUI 的子代理管理：目录列表、历史读取、续写提示与中断。
 * 【逻辑维度】SubagentListEntry → SubagentPromptReceipt / SubagentInterruptReceipt
 * → SubagentAddress / SubagentCatalog → SubagentsApi 四个方法。
 * 【关键边界】list 不加载任一侧；history 不做 Agent 激活；prompt 只接受
 * continuable 模式并经实时父的续写属主投递；interrupt 以持久化直属父权限授权、
 * 不要求父 Agent 在线，fire-and-return（accepted 只是受理信号，不代表目标已静止）。
 * 【新手阅读建议】与 subagents.schema.ts 及 api-proxy.ts 的 subagents 域实现
 * （catalogChild、subagentPromptError）对照阅读。
 * ==========================================================================
 */
/**
 * Browser-safe subagent domain contract. Persisted transcript reads never
 * activate an Agent, while continuable prompts route through the exact live
 * direct parent into the child's Agent inbox.
 */

import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RpcRequest, RpcResponse } from './rpc.ts'
import type { HistoryEntry, SessionProjectionsBlock } from './sessions.ts'

/** Complete durable direct-child catalog row. */
// 完整的持久化直属子目录行：健康子（one-shot/continuable）或诊断行。
export type SubagentListEntry =
  | {
    kind: 'child'
    id: SessionId
    /** Whether the child Agent driver is running at the Host sampling boundary. */
    activity: 'running' | 'inactive'
    /** Whether a direct descendant has durable `origin: 'subagent'`. */
    hasChildren: boolean
  } & (
    | {
      mode: 'one-shot'
      label?: string
    }
    | {
      mode: 'continuable'
      label: string
    }
  )
  | {
    kind: 'diagnostic'
    id: SessionId
    reason: 'corrupt' | 'unsupported' | 'unavailable'
  }

/** Inbox identity returned once the continuation accepts one human message. */
export interface SubagentPromptReceipt {
  messageId: MessageId
}

/** Uniform acknowledgement that one interrupt request was admitted. */
export interface SubagentInterruptReceipt {
  accepted: true
}

/** Durable parent/child address that selects subagent transport in the client. */
export type SubagentAddress =
  & {
    parentSessionId: SessionId
    childSessionId: SessionId
  }
  & (
    | { mode: 'one-shot' }
    | { mode: 'continuable' }
  )

/** Complete direct-child catalog plus the delivery-time parent availability hint. */
export interface SubagentCatalog {
  entries: SubagentListEntry[]
  parentAvailable: boolean
}

/** Subagent-domain unary methods. */
export interface SubagentsApi {
  /**
   * Lists direct session-backed children without loading either side. Parent
   * availability is a hint; continuable prompt performs the authoritative
   * check.
   */
  list(
    request: RpcRequest<{ parentSessionId: SessionId }>,
    signal?: AbortSignal,
  ): Promise<RpcResponse<SubagentCatalog>>

  /**
   * Reads one healthy catalog child's transcript — the in-memory snapshot of
   * a live child, the persisted log of a cold one — with ordinary
   * message-aligned pagination and render intents, without Agent activation.
   */
  history(
    request: RpcRequest<SubagentAddress & { beforeSeq?: number; maxMessages?: number }>,
    signal?: AbortSignal,
  ): Promise<RpcResponse<{
    events: HistoryEntry[]
    hasMore: boolean
    projections?: SessionProjectionsBlock
  }>>

  /**
   * Delivers human content to a continuable child through the exact live
   * parent's continuation owner. Success identifies the message accepted by
   * the child's FIFO inbox; later execution is independent of this request.
   * Optional browser-zone provenance is validated and logged on that message.
   */
  prompt(
    request: RpcRequest<
      Extract<SubagentAddress, { mode: 'continuable' }> & {
        content: ContentBlock[]
        /** Optional browser zone sampled for this exact human prompt. */
        clientTimeZone?: string
      }
    >,
    signal: AbortSignal,
  ): Promise<RpcResponse<SubagentPromptReceipt>>

  /**
   * Interrupts a live continuable child's current turn under the address's
   * durable direct-parent authority, without requiring a live parent Agent,
   * consulting the catalog, or resuming anything. Fire-and-return: `accepted`
   * acknowledges the admitted cancel signal, not target quiescence, so the
   * child may remain visibly running briefly. Unclaimed queued follow-ups are
   * kept and parked; an absent, idle, or already-completed target is likewise
   * `accepted`.
   */
  interrupt(
    request: RpcRequest<Extract<SubagentAddress, { mode: 'continuable' }>>,
  ): Promise<RpcResponse<SubagentInterruptReceipt>>
}
