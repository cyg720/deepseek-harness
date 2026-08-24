/**
 * Host-only workflow request and live-run handles. The browser-safe durable
 * vocabulary remains in `./types` so Client programs never import Agent or
 * host Cordis context declarations.
 *
 * @module @deepseek-ai/dsh-workflow
 */
/**
 * 文件职责：定义宿主侧工作流启动请求和运行中句柄类型。
 * 技术维度：使用 TypeScript 接口、Promise、AbortSignal 和品牌化 WorkflowRunId 描述运行生命周期。
 * 产品维度：让调用方启动、取消并可靠释放可创建子代理的脚本工作流。
 * 逻辑维度：WorkflowStartRequest 收集脚本、元数据、参数、限制和父代理；WorkflowRun 暴露 id/meta/result/cancel/dispose。
 * 关键边界：浏览器安全词汇留在 types；result 永不拒绝，消费者仍必须调用幂等 dispose 等待静止。
 * 新手阅读建议：先看启动请求必填/可选字段，再按运行句柄的 result、cancel、dispose 理解生命周期。
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type {
  WorkflowMeta, WorkflowResult, WorkflowRunId,
} from './types.ts'

/**
 * What a caller asks for when starting a workflow run. `meta` and `args` are
 * plain JSON data by the seam contract. `parent` is required because every
 * `agent()` spawned by the script is attributed to that live Agent.
 */
/** 启动一次工作流所需的宿主请求。 */
export interface WorkflowStartRequest {
  /** The plain-JS script body (top-level await allowed; ends with `return <json-value>`). */
  /** 纯 JavaScript 脚本正文，允许顶层 await，最终返回 JSON 值。 */
  script: string
  /** The workflow's identity block, as plain JSON data (shape-validated by the engine). */
  /** 工作流身份元数据，由引擎校验。 */
  meta: WorkflowMeta
  /** Optional input exposed verbatim to the script as the `args` global. */
  /** 可选输入，原样作为脚本 args 全局变量。 */
  args?: unknown
  /** Optional engine-wide child-provider override for this run. */
  /** 本次运行可选的子代理提供者覆盖。 */
  subagentProvider?: string
  /** Optional per-run total-child ceiling. */
  /** 本次运行允许创建的子代理总数上限。 */
  maxTotalAgents?: number
  /** The agent on whose behalf the run executes (parent of every child). */
  /** 代表其执行的实时父代理，也是所有子代理父级。 */
  parent: Agent
  /** Cancels the run when aborted. */
  /** 中止时取消运行的可选信号。 */
  signal?: AbortSignal
}

/**
 * Holder-owned live workflow. `result` never rejects; consumers may cancel
 * and must call idempotent `dispose()` to await script and child quiescence.
 */
/** 由持有者管理的实时工作流句柄。 */
export interface WorkflowRun {
  // 品牌化运行标识。
  readonly id: WorkflowRunId
  /** The validated meta block available before the script body runs. */
  /** 脚本运行前已校验的元数据。 */
  readonly meta: WorkflowMeta
  // 永不拒绝的最终工作流结果 Promise。
  readonly result: Promise<WorkflowResult>
  /** Cancel the run and its children. */
  /** 取消运行及子代理。@param reason 可选原因。@returns 无。@example run.cancel('user request')。 */
  cancel(reason?: string): void
  /** Cancel if needed and await bounded settlement and cleanup. */
  /** 必要时取消并等待有界清理。@returns 清理完成 Promise。@example await run.dispose()。 */
  dispose(): Promise<void>
}
