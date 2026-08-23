/**
 * ================================ 文件注释 ================================
 * 【文件职责】把“当前选中的模型选择”耦合到 Agent 作用域内的提示词组装与请求路由：在 prompt 组装时快照、在发请求时应用。
 * 【技术维度】两个 scoped 监听器（system-prompt/assemble 快照、agent/request 应用）；并发切换只影响后续步骤，避免一次请求拆成两个模型的“分裂”。
 * 【产品维度】让上层（如会话模型切换功能）能动态更换某个 agent 使用的模型，且切换在步骤边界生效，行为可预期。
 * 【逻辑维度】ModelSelection/ModelSelectionRef 类型 → installModelSelection（组装监听器 → 请求监听器 → 返回合并拆除函数）。
 * 【关键边界】selection 由调用入口持有（本函数不拥有生命周期）；absent 的 effort 会清除继承来的 effort，恢复 provider 默认行为；返回的拆除函数必须被调用。
 * 【新手阅读建议】先理解 current/assembled 两个字段的差异（下一个步骤 vs 当前步骤），再看两个监听器如何分别读写它们。
 * ==========================================================================
 */
/**
 * Agent-scoped model selection shared by runtime entry points.
 * @module @deepseek-ai/dsh-agent/model-selection
 */

import type { Context } from '@deepseek-ai/cordis'
import type { LlmCallConfig, ReasoningEffortId } from '@deepseek-ai/dsh-llm'

/** Complete provider, model, and optional reasoning effort selected for one live Agent. */
// 为一个在线 agent 选定的完整模型路由：provider + model 必填，推理强度可选。
export interface ModelSelection {
  /** Registered provider route. */
  // 已注册的 provider 路由名。
  provider: string
  /** Provider-owned model id. */
  // 由 provider 解释的模型 id。
  model: string
  /** Adapter-owned reasoning effort, or provider/default behavior when absent. */
  // 推理强度；缺省时交给 provider 的默认行为。
  reasoningEffort?: ReasoningEffortId
}

/** Mutable model selection plus the value captured for the current step. */
// 可变选择 + 当前步骤的快照：current 是“下一步将用”的，assembled 是“本步已用”的。
export interface ModelSelectionRef {
  /** Model selected for the next step that enters prompt assembly. */
  // 供下一步进入提示词组装时使用的选择。
  current: ModelSelection | undefined
  /** Selection captured when the current step entered prompt assembly. */
  // 当前步骤进入组装那一刻快照下来的选择。
  assembled: ModelSelection | undefined
}

/**
 * Couple one mutable selection to Agent-scoped prompt assembly and request routing.
 * Prompt assembly snapshots the selected model before delegating, then applies
 * its provider/model pair and effort to request config so a
 * concurrent switch takes effect on a later step instead of splitting the two
 * surfaces. An absent selected effort clears any inherited effort, restoring
 * the selected model's provider/default behavior.
 *
 * @param agentCtx - The selected Agent's scoped context.
 * @param selection - Mutable selection owned by the calling entry point.
 * @returns Disposer for both scoped waterfall listeners.
 */
// 把外部持有的可变选择接到 agent 作用域的两个扩展点上，返回合并拆除函数。
export function installModelSelection(agentCtx: Context, selection: ModelSelectionRef): () => void {
  // 组装监听器：组装开始时快照 selected 到 assembled；返回前把 provider/model 变量注入组装结果，
  // 这样提示词文本与“本步用的模型”保持一致。
  const disposeAssembly = agentCtx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const selected = selection.current
    const assembled = await next()
    selection.assembled = selected
    if (selected === undefined) return assembled
    return {
      ...assembled,
      variables: {
        ...assembled.variables,
        provider: selected.provider,
        model: selected.model,
      },
    }
  })
  // 请求监听器：用本步快照（assembled）覆盖请求配置中的 provider/model/effort；
  // 没有选中 effort 时清除继承来的 effort，恢复该模型的 provider 默认行为。
  const disposeRequest = agentCtx.on(
    'agent/request',
    async (_payload, next): Promise<LlmCallConfig> => {
      const resolved = await next()
      const selected = selection.assembled
      if (selected === undefined) return resolved
      const { reasoningEffort: _inheritedEffort, ...withoutInheritedEffort } = resolved
      return {
        ...withoutInheritedEffort,
        provider: selected.provider,
        model: selected.model,
        ...selected.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: selected.reasoningEffort },
      }
    },
  )
  // 返回合并拆除函数：调用后两个监听器一起卸载。
  return () => {
    disposeAssembly()
    disposeRequest()
  }
}
