/**
 * Browser-safe durable workflow-record events written by the model-facing
 * workflow tool into its calling parent Session.
 *
 * @module @deepseek-ai/dsh-tool-workflow/types
 */
/*
 * 中文说明：
 * - 文件职责：声明工作流工具写入父会话的四类持久事件数据，并扩展 SessionEventMap。
 * - 技术维度：使用浏览器安全 TypeScript 类型、品牌标识和模块声明合并。
 * - 产品维度：让界面和 SDK 能从日志重建工作流、成员及最终状态。
 * - 逻辑维度：运行开始后记录成员开始与结束，资源静止后用运行结束事件收尾。
 * - 关键边界：agent-end 的 seq 必须配对先前 agent-start；childId 只能在子会话发布后记录。
 * - 新手阅读建议：按 run-start、agent-start、agent-end、run-end 的时间顺序阅读字段和事件映射。
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  WorkflowAgentOutcome, WorkflowRunId, WorkflowStopReason,
} from '@deepseek-ai/dsh-workflow/types'

/** Opens one durable top-level workflow run record. */
/* 中文：打开一条顶层工作流持久记录的数据。 */
export interface ToolWorkflowRunStartData {
  /** 本次工作流运行的稳定品牌标识。 */
  readonly runId: WorkflowRunId
  /** 面向用户显示的工作流名称。 */
  readonly name: string
}

/** Records one workflow member after its child Session is published. */
/* 中文：子会话发布后记录一个工作流成员开始的数据。 */
export interface ToolWorkflowAgentStartData {
  readonly runId: WorkflowRunId
  /** 运行内成员序号，用于与结束事件配对。 */
  readonly seq: number
  /** 成员显示标签。 */
  readonly label: string
  /** 可选阶段名称；未分阶段时省略。 */
  readonly phase?: string
  /** 已发布子会话的品牌标识。 */
  readonly childId: SessionId
}

/** Settles one previously started workflow member. */
/* 中文：结算先前已开始成员的数据。 */
export interface ToolWorkflowAgentEndData {
  readonly runId: WorkflowRunId
  /** 对应 agent-start 的成员序号。 */
  readonly seq: number
  /** 成员完成、失败或停止的结果。 */
  readonly outcome: WorkflowAgentOutcome
}

/** Settles one workflow run after its live resources reach quiescence. */
/* 中文：全部活动资源静止后结算顶层运行的数据。 */
export interface ToolWorkflowRunEndData {
  readonly runId: WorkflowRunId
  /** 工作流终止原因。 */
  readonly stopReason: WorkflowStopReason
}

declare module '@deepseek-ai/dsh-session/types' {
  /** 中文：会话事件名到对应数据类型的扩展映射。 */
  interface SessionEventMap {
    /**
     * Opens one top-level workflow record.
     * @param data - stable run identity and display name.
     */
    /* 中文：打开工作流记录；data 包含运行标识和显示名称。 */
    'tool-workflow/run-start': ToolWorkflowRunStartData
    /**
     * Records one published workflow member.
     * @param data - run identity, member sequence, display identity, and child Session.
     */
    /* 中文：记录已发布成员；data 包含运行、序号、显示信息和子会话。 */
    'tool-workflow/agent-start': ToolWorkflowAgentStartData
    /**
     * Records one member settlement.
     * @param data - run identity, paired member sequence, and outcome.
     */
    /* 中文：记录成员结算；data 包含运行标识、配对序号和结果。 */
    'tool-workflow/agent-end': ToolWorkflowAgentEndData
    /**
     * Closes one workflow record after cleanup.
     * @param data - stable run identity and terminal reason.
     */
    /* 中文：关闭工作流记录；data 包含运行标识和终止原因。 */
    'tool-workflow/run-end': ToolWorkflowRunEndData
  }
}
