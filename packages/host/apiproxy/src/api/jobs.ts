/*
 * ================================ 文件注释 ================================
 * 【文件职责】浏览器安全的后台任务（job）域契约：定义客户端可见的任务视图
 * JobView。注册表的内部记录绝不直接过线，每次推送都新铸一个视图子集。
 * 【技术维度】纯类型契约（零依赖、浏览器可导入）；JobId 是品牌化字符串；
 * kind 保持开放字符串以便生产者插件经声明合并扩展 kind 映射。
 * 【产品维度】客户端任务面板（如 bash 命令、pty 发送、子代理委派等后台任务）
 * 的列表渲染依据：展示命令/委派描述、生命周期状态与起止时间。
 * 【逻辑维度】JobView 接口：id、kind、label、status、可选 detail、startedAt、
 * 可选 finishedAt。
 * 【关键边界】三个注册表字段刻意缺席：ownerSession（与帧自带 sessionId 冗余）、
 * reported（内部通知位）、outputLimitBytes（生产者模型展示策略）。
 * 【新手阅读建议】与 jobs.schema.ts 的 taskViewSchema 对照阅读，并留意 api-proxy.ts
 * 中 jobViews 投影函数如何把它从 JobSnapshot 提炼出来。
 * ==========================================================================
 */
/**
 * Browser-safe background-job domain contract. The registry's live records
 * never cross the wire; a view is the subset a human list needs, minted fresh
 * per push.
 */

import type { JobId } from '@deepseek-ai/dsh-jobs/brand'

/**
 * One background job as the client sees it.
 *
 * Three registry fields are deliberately absent. `ownerSession` is redundant
 * beside the frame's own `sessionId`; `reported` is an internal notice-delivery
 * bit with no user meaning; `outputLimitBytes` is producer-owned model
 * presentation policy that never reaches a human surface.
 */
export interface JobView {
  /** Registry-issued `<kind>-N` identity, stable for the task's whole life. */
  id: JobId
  /**
   * Producer kind (`bash`, `pwsh`, `pty-send`, `subagent`, …). Kept as a bare
   * string because producer plugins extend the kind map by declaration merging,
   * so no client build can enumerate the closed set.
   */
  kind: string
  /** Producer-supplied one-line label: the command, or the delegation description. */
  label: string
  /** Current lifecycle state. */
  status: 'running' | 'stopping' | 'completed' | 'killed' | 'failed'
  /** Kind-specific status detail ('exit code: 3'), present once the producer supplied one. */
  detail?: string
  /** Epoch ms when the task was registered. */
  startedAt: number
  /** Epoch ms when the task settled; absent while live. */
  finishedAt?: number
}
