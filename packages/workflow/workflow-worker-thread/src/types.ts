/**
 * Non-protocol wire vocabulary for the worker-thread engine: the `workerData` init payload and
 * the child-port interfaces the worker-side runtime consumes. Host/worker messages are defined in
 * `./protocol.ts`; transported child requests and results are plain JSON for structured clone.
 * @module @deepseek-ai/dsh-workflow-worker-thread/types
 */
/**
 * 文件职责：实现 types.ts 覆盖的工作流与 Worker Thread行为与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、Worker Thread、消息协议或领域实体。
 * 产品维度：保障 Agent 的工作流与 Worker Thread能力稳定、可隔离且可诊断。
 * 逻辑维度：准备配置和消息，建立运行环境，执行流程，再处理事件、错误与清理。
 * 关键边界：线程消息不可信；跨线程状态必须显式传递；终止时必须等待所拥有资源停止。
 * 新手阅读建议：先看协议和类型，再读 Host/Runtime 主流程，最后关注隔离、失败与清理。
 */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import type { WorkflowMeta } from '@deepseek-ai/dsh-workflow'

/**
 * The per-run limits the worker-side runtime enforces. The host keeps the
 * knobs only it can act on (`provider`, `disposeGraceMs`).
 */
/** 中文说明：interface WorkerLimits 定义本模块所需的数据或行为，用于表达工作流与 Worker Thread场景。 */
export interface WorkerLimits {
  /** Concurrent `agent()` ceiling (already auto-resolved; ≥ 1). */
  maxConcurrentAgents: number
  /** Total `agent()` calls per run (the runaway-loop backstop). */
  maxTotalAgents: number
  /** Items accepted by one `parallel()`/`pipeline()` call. */
  maxItemsPerCall: number
  /** vm timeout for the script's initial synchronous slice (inside the worker). */
  syncTimeoutMs: number
}

/** The `workerData` payload one run is initialized with (host → worker, once, at spawn). */
/** 中文说明：interface WorkerInit 定义本模块所需的数据或行为，用于表达工作流与 Worker Thread场景。 */
export interface WorkerInit {
  /** The validated meta block (plain data off the start request, validated host-side). */
  meta: WorkflowMeta
  /** The plain-JS script body, exactly as the start request carried it. */
  body: string
  /** The run's `args` value; the workerData structured clone is the copy that isolates the caller. */
  args?: unknown
  /** The worker-enforced limits. */
  limits: WorkerLimits
}

/** What the worker asks the host to start for one `agent()` call (options already validated worker-side). */
/** 中文说明：interface ChildStartRequest 定义本模块所需的数据或行为，用于表达工作流与 Worker Thread场景。 */
export interface ChildStartRequest {
  /** The child's prompt text. */
  prompt: string
  /** The structured-output schema, if the call passed one (already subset-checked). */
  schema?: ObjectJsonSchema
  /** The per-child provider override, if the call passed one. */
  provider?: string
  /** The per-child model override, if the call passed one. */
  model?: string
}

/**
 * The JSON projection of a child's `SubagentResult` crossing the port. The
 * seam's `stopReason` union is merge-extensible, so it degrades to `string`
 * on the wire — the runtime only ever branches on `'completed'`.
 */
/** 中文说明：interface ChildResult 定义本模块所需的数据或行为，用于表达工作流与 Worker Thread场景。 */
export interface ChildResult {
  /** The child's final assistant output blocks. */
  output: ContentBlock[]
  /** The structured value, present iff the request carried a schema AND the provider honored it. */
  structured?: unknown
  /** Why the child run ended (`'completed'` is the only value the runtime branches on). */
  stopReason: string
}

/**
 * The worker-side handle for one started child — the RPC mirror of the
 * subagent seam's run handle, reduced to what the runtime consumes.
 */
/** 中文说明：interface ChildHandle 定义本模块所需的数据或行为，用于表达工作流与 Worker Thread场景。 */
export interface ChildHandle {
  /** The child agent's id (minted host-side by the subagent seam). */
  readonly id: string
  /**
   * Resolves with the child's terminal {@link ChildResult}; REJECTS only when
   * the host reports an infrastructure fault (`child-failed`) — a child that
   * failed for its own reasons resolves with a non-`completed` stop reason.
   */
  readonly result: Promise<ChildResult>
  /** Ask the host to dispose the child; resolves on the host's ack. */
  dispose(): Promise<void>
}

/**
 * The worker-side port the runtime starts child agents through — the seam
 * that lets the execution core stay ignorant of the thread boundary.
 */
/** 中文说明：interface ChildPort 定义本模块所需的数据或行为，用于表达工作流与 Worker Thread场景。 */
export interface ChildPort {
  /**
   * Start one child agent on the host (the `agent()` hook's start half).
   * @param request - the prompt and validated options.
   * @returns the published child handle; rejects when synchronous start or the
   *   provider's asynchronous start fails.
   */
  startAgent(request: ChildStartRequest): Promise<ChildHandle>
}
