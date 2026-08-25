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
/**
 * Default model selection for an Agent without a session-specific selection.
 *
 * @module @deepseek-ai/dsh-agent-default-model
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Default model selection for Agents created without an explicit model. */
    agentDefaultModel: AgentDefaultModelConfig
  }
}

/** Settings namespace carrying the default model selection for future Agents. */
// 设置命名空间键：用户在设置文档（settings）里读写默认模型时用的段名。
export const AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE = settingsNamespace('agent-default-model')

/** Stored and composed default model selection. */
// 持久化/组合用的默认模型选择形态：比对外暴露的 ModelSelection 多了“可选字符串 reasoningEffort”。
export interface AgentDefaultModelSettings {
  /** Registered provider route. */
  // 已注册的提供方路由名（如 deepseek），发请求时必须存在对应适配器。
  provider: string
  /** Provider-owned model id. */
  // 由 provider 解释的模型 id。
  model: string
  /** Adapter-owned reasoning effort, or provider/default behavior when absent. */
  // 推理强度（reasoning effort）；缺省时走 provider 的默认行为。
  reasoningEffort?: string
}

/** Schema of the default Agent model settings section. */
// 设置段的运行时 schema：provider/model 必填，reasoningEffort 可选。
export const AGENT_DEFAULT_MODEL_SETTINGS_SCHEMA: z<AgentDefaultModelSettings> = z.object({
  provider: z.string().required(),
  model: z.string().required(),
  reasoningEffort: z.string(),
})

/** Composition entry for the default model selection. */
// 组合配置项（cordis.yml 插件配置）：只声明 provider/model，推理强度一般由设置层动态给出。
export interface Config {
  /** Registered provider route. */
  provider: string
  /** Provider-owned model id. */
  model: string
}

/** Project stored settings onto the Agent-facing selection type. */
// 投影函数：把可持久化的设置形态转换为 dsh-agent 消费的 ModelSelection（reasoningEffort 转成品牌类型）。
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
// 默认模型选择服务：组合配置提供“基线”，settings 提供者（若有）可覆盖；读取永远实时投影。
export class AgentDefaultModelConfig extends Service {
  static Config: z<Config> = z.object({
    provider: z.string().required(),
    model: z.string().required(),
  })

  // 设置数据源：默认指向构造函数里建的 entry（组合配置），settings 注册后会被换成“读设置文档”的实时函数。
  private source: () => AgentDefaultModelSettings

  constructor(ctx: Context, config: Config) {
    super(ctx, 'agentDefaultModel')
    const entry: AgentDefaultModelSettings = { provider: config.provider, model: config.model }
    this.source = () => entry
    installSettingsSection(ctx, AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE, AGENT_DEFAULT_MODEL_SETTINGS_SCHEMA, entry, {
      setSource: (current) => { this.source = current },
      // Every consumer reads through currentSelection(), so no registration-level fact
      // needs rebuilding when the settings document changes.
      // 所有消费方都走 currentSelection()，设置文档变化时无需重建任何注册项，所以 onChange 为空。
      onChange: () => {},
    })
  }

  /**
   * Read the current default model selection.
   * @returns a detached provider, model, and optional reasoning selection.
   */
  // 读取当前默认选择：每次调用都实时投影，返回值是脱离内部状态的新对象。
  currentSelection(): ModelSelection {
    return selection(this.source())
  }

  /**
   * Save the complete default model selection. A deployment without a settings
   * provider keeps its composition entry.
   * @param next - resolved selection accepted by an entry point.
   * @returns fulfillment after the optional settings write settles.
   */
  // 保存新的默认选择：写入设置文档（若存在 settings 提供者）；没有提供者时保持组合配置不变。
  async saveSelection(next: ModelSelection): Promise<void> {
    await this.ctx.get('settings')?.replace(AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE, {
      provider: next.provider,
      model: next.model,
      ...next.reasoningEffort === undefined ? {} : { reasoningEffort: String(next.reasoningEffort) },
    })
  }
}

export default AgentDefaultModelConfig
