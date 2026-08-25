/*
 * ================================ 文件注释 ================================
 * 【文件职责】agent-loop 设置卡片的控制器：把 agent-loop 命名空间作用域桥接到
 *             卡片共享的暂存表单上。
 * 【技术维度】CardForm 复用 + SnapshotStore 投影：字段为 maxParallelToolCalls
 *             （数字字段）；命名空间名拼写在此（客户端包不得依赖宿主包）。
 * 【产品维度】设置页"插件"中的 agent-loop 卡片：并行工具调用上限配置。
 * 【逻辑维度】构造建表单与投影存储 → projection 装配 shell + 字段 → inject 暴露
 *             快照与表单动作。
 * 【关键边界】宿主的 agents 组合数组刻意不在此卡片中（只编辑单一字段）。
 * 【新手阅读建议】先读 card-form.ts 的共享模型，再看本控制器的薄桥接。
 * ==========================================================================
 */
/** The agent-loop card's staged form over the `agent-loop` settings namespace. */

import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { CardForm, numberField, type CardActions, type CardFieldState, type CardShell } from './card-form.ts'

/**
 * Namespace of the agent loop's user-owned settings. Spelled here rather than
 * imported: a client package must not depend on a Host package.
 */
export const AGENT_LOOP_NS = 'agent-loop'

/**
 * The agent-loop fields this card edits. The Host section carries only this
 * field — the composed `agents` array is deliberately not part of it.
 */
export interface AgentLoopSettings {
  /** Upper bound on parallel-safe tool calls in flight per step. */
  maxParallelToolCalls?: number
}

/** What the agent-loop card renders. */
export interface AgentLoopCardState extends CardShell {
  /** Parallel tool-call cap. */
  maxParallelToolCalls: CardFieldState
}

/** The registration-side face the agent-loop card's slot entry injects. */
export interface AgentLoopCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useAgentLoopCard. */
    agentLoopCard: SnapshotStore<AgentLoopCardState>
  }
}

/** Bridges the `agent-loop` scope onto the card's staged form. */
export class AgentLoopCardController {
  private readonly form: CardForm<AgentLoopSettings>
  private readonly store: SnapshotStore<AgentLoopCardState>

  /** @param scope - the bound settings scope for the `agent-loop` namespace. */
  constructor(scope: SettingsScope<AgentLoopSettings>) {
    this.form = new CardForm(scope, [numberField('maxParallelToolCalls')])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): AgentLoopCardState {
    return { ...this.form.shell(), maxParallelToolCalls: this.form.field('maxParallelToolCalls') }
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject(): AgentLoopCardFace {
    return { hooks: { agentLoopCard: this.store }, ...this.form.actions() }
  }
}
