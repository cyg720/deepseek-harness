/**
 * Default model selection for an Agent without a session-specific selection.
 *
 * @module @deepseek-ai/dsh-agent-default-model
 */

/*
 * ================================ 文件注释 ================================
 * 【文件职责】默认模型选择服务（ctx.agentDefaultModel）：为没有显式指定模型的 agent 提供 provider/model/reasoningEffort 默认值，并支持通过 settings 动态读写。
 * 【技术维度】Cordis Service + schemastery 配置校验；settings 提供者可选（没挂载时退回组合配置项）；所有读取都经 currentSelection() 实时投影。
 * 【产品维度】部署方在配置里定默认模型，用户可在运行期用设置命令切换默认模型，后续新建的 agent 自动生效。
 * 【逻辑维度】类型与 schema（Settings/Config/常量）→ selection 投影函数 → AgentDefaultModelConfig 服务（构造注册 settings 段 → currentSelection/saveSelection）。
 * 【关键边界】saveSelection 依赖可选 settings 提供者（无则静默跳过写入）；reasoningEffort 为空时保持 provider 默认行为。
 * 【新手阅读建议】先读 currentSelection/saveSelection 两个方法，再看构造函数的 installSettingsSection 注册方式。
 * ==========================================================================
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-settings'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Default model selection for Agents created without an explicit model. */
    agentDefaultModel: AgentDefaultModelConfig
  }
}

/** Settings namespace carrying the default model selection for future Agents. */
export const AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE = 'agent-default-model'

/** Stored and composed default model selection. */
export interface AgentDefaultModelSettings {
  /** Registered provider route. */
  provider: string
  /** Provider-owned model id. */
  model: string
  /** Adapter-owned reasoning effort, or provider/default behavior when absent. */
  reasoningEffort?: string
}

/** Schema of the default Agent model settings section. */
export const AGENT_DEFAULT_MODEL_SETTINGS_SCHEMA: z<AgentDefaultModelSettings> = z.object({
  provider: z.string().required(),
  model: z.string().required(),
  reasoningEffort: z.string(),
})

/** Composition entry for the default model selection. */
export interface Config {
  /** Registered provider route. */
  provider: string
  /** Provider-owned model id. */
  model: string
}

/** Project stored settings onto the Agent-facing selection type. */
function selection(settings: AgentDefaultModelSettings): ModelSelection {
  return {
    provider: settings.provider,
    model: settings.model,
    ...settings.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: ReasoningEffortId(settings.reasoningEffort) },
  }
}

/**
 * Owns the default model selection independently of any Host or transport.
 * The composition entry remains usable without a settings provider; when one
 * is mounted, its user layer is read live.
 */
export class AgentDefaultModelConfig extends Service {
  static Config: z<Config> = z.object({
    provider: z.string().required(),
    model: z.string().required(),
  })

  private source: () => AgentDefaultModelSettings

  constructor(ctx: Context, config: Config) {
    super(ctx, 'agentDefaultModel')
    const entry: AgentDefaultModelSettings = { provider: config.provider, model: config.model }
    this.source = () => entry
    ctx.inject(['settings'], (settingsCtx) => {
      settingsCtx.settings.installSection(ctx, AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE, AGENT_DEFAULT_MODEL_SETTINGS_SCHEMA, entry, {
        setSource: (current) => { this.source = current },
        // Every consumer reads through currentSelection(), so no registration-level fact
        // needs rebuilding when the settings document changes.
        onChange: () => {},
      })
    })
  }

  /**
   * Read the current default model selection.
   * @returns a detached provider, model, and optional reasoning selection.
   */
  currentSelection(): ModelSelection {
    return selection(this.source())
  }

  /**
   * Save the complete default model selection. A deployment without a settings
   * provider keeps its composition entry.
   * @param next - resolved selection accepted by an entry point.
   * @returns fulfillment after the optional settings write settles.
   */
  async saveSelection(next: ModelSelection): Promise<void> {
    await this.ctx.get('settings')?.replace(AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE, {
      provider: next.provider,
      model: next.model,
      ...next.reasoningEffort === undefined ? {} : { reasoningEffort: String(next.reasoningEffort) },
    })
  }
}

export default AgentDefaultModelConfig
