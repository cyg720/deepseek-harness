/**
 * Client-safe subagent catalog and control vocabulary: the durable direct-child
 * row both the listing and the browser catalog answer with, plus the
 * browser-facing control surface's prompt, receipts, and failures.
 *
 * @module @deepseek-ai/dsh-subagent/control-types
 */

/*
 * 文件说明：文件职责：实现 subagent/subagent 中 control types 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * subagent/subagent 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 →
 * 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 * /
 */

import type { PromptContentPart } from '@deepseek-ai/dsh-attachment/types'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/**
 * Client-minted identity of one browser prompt, persisted on the exact accepted
 * message. It carries the Session Controller's `session-request-id` brand so a
 * subagent prompt and an ordinary Session prompt share one identity
 * vocabulary; that package depends on this one, so the brand is spelled here
 * rather than imported.
 */
export type SubagentPromptRequestId = Branded<'session-request-id'>

/**
 * One durable direct-child row, ordered by header `createdAt` with ties broken
 * on id. Only a candidate whose durable header has `origin: 'subagent'` is
 * interpreted. A served `subagent` projection value produces a `child`; a
 * settled candidate whose fold served no identity produces a `diagnostic`; a
 * running candidate without one is omitted — its descriptor may not be
 * appended yet (the creation window). Diagnostics relay the projection fold's
 * outcome or a failed read, never a per-child event scan, and never expose
 * model-hidden descriptor content.
 */
export type SubagentListEntry =
  | {
    readonly kind: 'child'
    /** The durable child session id, stable across Activations. */
    readonly id: SessionId
    /**
     * Whether the child is live at the moment its reader sampled it: the
     * durable listing reads the Session store (`running` means the logical
     * record is resident, `inactive` that it exists only in persistence),
     * while the browser catalog re-samples the child's Agent driver. Neither
     * encodes a durable outcome, and a continuable child may still reject
     * delivery as an ownership conflict.
     */
    readonly activity: 'running' | 'inactive'
    /** Whether a direct descendant has durable `origin: 'subagent'`. */
    readonly hasChildren: boolean
  } & (
    | {
      /** A terminal one-shot child. */
      readonly mode: 'one-shot'
      /** Optional durable creation label from the child's descriptor. */
      readonly label?: string
    }
    | {
      /** A resumable conversation. */
      readonly mode: 'continuable'
      /** Durable creation label from the child's descriptor. */
      readonly label: string
    }
  )
  | {
    readonly kind: 'diagnostic'
    /** The candidate's session id. */
    readonly id: SessionId
    /**
     * Why the candidate has no `child` row: `corrupt` for a settled candidate
     * whose projection fold served no identity (a missing, malformed, or
     * unrecognized-version descriptor — deliberately undistinguished), and
     * for any candidate whose log makes a registered unit's fold or schema
     * throw (deterministic data damage, contained per child); `unavailable`
     * when the candidate's Session observation was absent or transiently
     * unreadable (retried on the next listing). `unsupported` is never produced; it remains in the
     * union for consumers that route on it.
     */
    readonly reason: 'corrupt' | 'unsupported' | 'unavailable'
  }

/** Complete direct-child catalog plus the delivery-time parent availability hint. */
export interface SubagentCatalog {
  readonly entries: readonly SubagentListEntry[]
  readonly parentAvailable: boolean
}

/** Durable parent/child address that selects subagent transport in the client. */
export type SubagentAddress =
  & {
    readonly parentSessionId: SessionId
    readonly childSessionId: SessionId
  }
  & (
    | { readonly mode: 'one-shot' }
    | { readonly mode: 'continuable' }
  )

/** One human message addressed to a continuable direct child. */
export interface SubagentPromptRequest {
  /** Identity persisted on the accepted message, minted before the call. */
  readonly requestId: SubagentPromptRequestId
  readonly parentSessionId: SessionId
  readonly childSessionId: SessionId
  /** Required discriminator retained from the browser control address. */
  readonly mode: 'continuable'
  /**
   * Browser prompt parts delivered as the child's user message. The Host
   * admits and persists image parts before delivery, so the wire never
   * carries a durable attachment reference the caller could fabricate.
   */
  readonly content: readonly PromptContentPart[]
  /** Optional browser zone sampled for this exact human prompt. */
  readonly clientTimeZone?: string
}

/** Inbox identity returned once the continuation accepts one human message. */
export interface SubagentPromptReceipt {
  readonly messageId: MessageId
}

/** Uniform acknowledgement that one interrupt request was admitted. */
export interface SubagentInterruptReceipt {
  readonly accepted: true
}

/**
 * Failure details the control surface answers with. Catalog reads, prompts,
 * and interrupts share this vocabulary with the Client Remote result.
 */
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** A browser-supplied zone is neither UTC nor a canonical IANA name. */
    'subagent/invalid-time-zone': { readonly value: string }
    /** No live Agent carries the addressed parent session. */
    'subagent/parent-unavailable': { readonly parentSessionId: SessionId }
    /** The addressed child cannot take a continuation. */
    'subagent/not-resumable': { readonly childSessionId: SessionId }
    /** The claimed parent does not own the addressed child. */
    'subagent/unauthorized': { readonly childSessionId: SessionId }
    /** Image admission or model image-capability refusal. */
    'subagent/attachment-invalid': { readonly reason: string }
    /** The child exists but its inbox cannot admit the message now. */
    'subagent/delivery-unavailable': { readonly childSessionId: SessionId }
    /** The deployment mounts no session-projection registry. */
    'subagent/projections-unavailable': {}
  }
}
