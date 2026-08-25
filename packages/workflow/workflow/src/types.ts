/**
 * Workflow seam vocabulary: the request/run/result types a workflow engine
 * consumes and produces, plus the fields in the `workflow/*` event payloads.
 * Types only (plus the id-brand factory), per the package convention.
 *
 * @module @deepseek-ai/dsh-workflow/types
 */
/*
 * 文件职责：实现 types.ts 覆盖的工作流与 Worker Thread行为与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、Worker Thread、消息协议或领域实体。
 * 产品维度：保障 Agent 的工作流与 Worker Thread能力稳定、可隔离且可诊断。
 * 逻辑维度：准备配置和消息，建立运行环境，执行流程，再处理事件、错误与清理。
 * 关键边界：线程消息不可信；跨线程状态必须显式传递；终止时必须等待所拥有资源停止。
 * 新手阅读建议：先看协议和类型，再读 Host/Runtime 主流程，最后关注隔离、失败与清理。
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Identifies one workflow run. */
/* 中文说明：type WorkflowRunId 定义本模块所需的数据或行为，用于表达工作流与 Worker Thread场景。 */
export type WorkflowRunId = Branded<'WorkflowRunId'>

/**
 * Brand a string as a {@link WorkflowRunId}.
 * @param id - the raw id string (the engine mints UUIDs; tests may pass fixtures).
 * @returns the same string, branded.
 */
/*
 * 中文说明：函数 WorkflowRunId 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param id 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function WorkflowRunId(id: string): WorkflowRunId {
  return id as WorkflowRunId
}

/**
 * One phase declared in a script's `meta.phases` (progress vocabulary only —
 * phases group agents in observers/UIs; they impose no execution structure).
 */
/* 中文说明：interface WorkflowPhase 定义本模块所需的数据或行为，用于表达工作流与 Worker Thread场景。 */
export interface WorkflowPhase {
  /** The phase title; `phase()` calls match against it by exact string. */
  title: string
  /** Optional one-line description of what the phase does. */
  detail?: string
  /** Optional provider override this phase is expected to use (informational). */
  provider?: string
  /** Optional model override this phase is expected to use (informational). */
  model?: string
}

/**
 * The script's identity block, provided as plain JSON data alongside the
 * script body (the model-facing tool carries it as its `meta` parameter) and
 * validated by the engine before the body runs. `name`/`description` are
 * required; the rest is optional annotation. The field vocabulary matches the
 * Claude Code dynamic-workflows meta block.
 */
/* 中文说明：interface WorkflowMeta 定义本模块所需的数据或行为，用于表达工作流与 Worker Thread场景。 */
export interface WorkflowMeta {
  /** Short kebab-case workflow name (display + persistence key). */
  name: string
  /** One-line description of what the workflow does. */
  description: string
  /** Optional guidance on when this workflow applies (shown in listings). */
  whenToUse?: string
  /** Optional phase declarations matched by `phase()` calls. */
  phases?: WorkflowPhase[]
}

/**
 * Why a run settled. CLOSED union (engine-owned, consumers may exhaust):
 * `completed` = the script ran to its final `return`; `cancelled` = the run
 * was cancelled (caller `cancel()`/signal); `error` = the script threw, a
 * fatal `WorkflowError` propagated, or the result failed materialization.
 */
/* 中文说明：type WorkflowStopReason 定义本模块所需的数据或行为，用于表达工作流与 Worker Thread场景。 */
export type WorkflowStopReason = 'completed' | 'cancelled' | 'error'

/**
 * The outcome resolved by a live workflow run. `value` is
 * the script's materialized return value (plain host-realm JSON data; `null`
 * when the script returned `undefined`) — meaningful only for `completed`.
 * A non-`completed` reason carries the failure in `error`; the consumer maps
 * it to an `isError` tool result rather than reporting partial output.
 */
/* 中文说明：interface WorkflowResult 定义本模块所需的数据或行为，用于表达工作流与 Worker Thread场景。 */
export interface WorkflowResult {
  /** The script's return value (host JSON data; `null` for no return). */
  value: unknown
  /** Why the run settled. */
  stopReason: WorkflowStopReason
  /** The failure message (present iff `stopReason` is not `completed`). */
  error?: string
  /**
   * How many `agent()` calls the run accepted over its whole lifetime. On a
   * graceful settlement this is the script-side count (calls still queued for
   * a concurrency slot included); on a termination path (grace force-settle,
   * worker death) it degrades to the host-observed count — calls queued
   * inside a terminated script are unknowable then.
   */
  agentsStarted: number
}

/** Identifying detail for a run, carried by every `workflow/*` event as borrowed immutable data, never the live run. */
/* 中文说明：interface WorkflowRunInfo 定义本模块所需的数据或行为，用于表达工作流与 Worker Thread场景。 */
export interface WorkflowRunInfo {
  /** The run's id. */
  id: WorkflowRunId
  /** The run's validated meta block. */
  meta: WorkflowMeta
}

/** One `agent()` call's identity within a run (the `workflow/agent-start` payload). */
/* 中文说明：interface WorkflowAgentInfo 定义本模块所需的数据或行为，用于表达工作流与 Worker Thread场景。 */
export interface WorkflowAgentInfo {
  /** 1-based sequence number of this `agent()` call within the run. */
  seq: number
  /** The display label (the `label` option, or a prompt snippet). */
  label: string
  /** The phase this agent belongs to (the `phase` option, else the current `phase()` title). */
  phase?: string
  /** The child agent's id on the subagent seam. */
  childId: SessionId
}

/** How one `agent()` call settled: clean result, child failure (script sees `null`), or run cancellation. */
/* 中文说明：type WorkflowAgentOutcome 定义本模块所需的数据或行为，用于表达工作流与 Worker Thread场景。 */
export type WorkflowAgentOutcome = 'completed' | 'failed' | 'cancelled'

/** One `agent()` call's settlement (the `workflow/agent-end` payload). */
/* 中文说明：interface WorkflowAgentEndInfo 定义本模块所需的数据或行为，用于表达工作流与 Worker Thread场景。 */
export interface WorkflowAgentEndInfo extends WorkflowAgentInfo {
  /** How the call settled. */
  outcome: WorkflowAgentOutcome
}

/**
 * A settled run's outcome as event data (the `workflow/end` payload): the
 * {@link WorkflowResult} minus `value` (a listener observing outcomes must not
 * receive a mutable alias of the caller's result value; a consumer that needs
 * the value holds the run and awaits `result`).
 */
/* 中文说明：interface WorkflowResultInfo 定义本模块所需的数据或行为，用于表达工作流与 Worker Thread场景。 */
export interface WorkflowResultInfo {
  /** Why the run settled. */
  stopReason: WorkflowStopReason
  /** The failure message (present iff `stopReason` is not `completed`). */
  error?: string
  /** How many `agent()` calls the run accepted (see {@link WorkflowResult.agentsStarted}). */
  agentsStarted: number
}
