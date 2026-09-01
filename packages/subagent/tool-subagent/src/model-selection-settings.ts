/** Host-owned opt-in setting for model-selectable subagent delegation. */

/*
 * 文件说明：文件职责：实现 subagent/tool-subagent 中 model selection settings
 * 模块的职责，并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与
 * Cordis 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * subagent/tool-subagent 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-settings'
import {
  AllowedModelRouteSchema,
  assertAllowedModelRoutes,
  type AllowedModelRoute,
} from './model-selection.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** User preference sampled when a new Agent receives its delegation tools. */
    subagentModelSelection: SubagentModelSelectionConfig
  }
}

/** User-settings section for model-selectable subagent delegation. */
export const SUBAGENT_MODEL_SELECTION_SETTINGS_NAMESPACE = 'subagent-model-selection'

/** Stored user preference; the shipped composition defaults it off. */
export interface SubagentModelSelectionSettings {
  /** Whether newly composed top-level Sessions receive model selection. */
  enabled: boolean
  /** Exact child LLM routes offered to newly composed top-level Sessions. */
  allowedModels: AllowedModelRoute[]
}

/** Schema served to settings clients for the opt-in preference. */
export const SUBAGENT_MODEL_SELECTION_SETTINGS_SCHEMA: z<SubagentModelSelectionSettings> = z.object({
  enabled: z.boolean().default(false),
  allowedModels: z.array(AllowedModelRouteSchema).default([]),
})

/** Optional deployment base for the preference. */
export interface Config {
  /** Initial enabled state inherited when the user document does not override it. */
  enabled?: boolean
  /** Initial route list inherited when the user document does not override it. */
  allowedModels?: AllowedModelRoute[]
}

/** Singleton settings owner read by delegation tools when an Agent is published. */
export class SubagentModelSelectionConfig extends Service {
  static Config: z<Config> = z.object({
    enabled: z.boolean().default(false),
    allowedModels: z.array(AllowedModelRouteSchema).default([]),
  })

  private source: () => SubagentModelSelectionSettings

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'subagentModelSelection')
    // Cordis supplies the schema default; the fallback also covers direct construction.
    /* v8 ignore next */
    const entry: SubagentModelSelectionSettings = {
      enabled: config.enabled ?? false,
      allowedModels: config.allowedModels ?? [],
    }
    this.validate(entry)
    this.source = () => entry
    ctx.inject(['settings'], (settingsCtx) => {
      settingsCtx.settings.installSection(
        ctx,
        SUBAGENT_MODEL_SELECTION_SETTINGS_NAMESPACE,
        SUBAGENT_MODEL_SELECTION_SETTINGS_SCHEMA,
        entry,
        {
          setSource: (source) => { this.source = source },
          validate: (value) => { this.validate(value) },
          // Consumers sample at Agent publication, so a settings update never
          // rebuilds the tool definitions of an Agent that is already running.
          onChange: () => {},
        },
      )
    })
  }

  /**
   * Read a detached selection preference for the next eligible Agent publication.
   * @returns the enabled state and exact allowed routes.
   */
  current(): SubagentModelSelectionSettings {
    const current = this.source()
    return {
      enabled: current.enabled,
      allowedModels: current.allowedModels.map(route => ({ ...route })),
    }
  }

  private validate(value: SubagentModelSelectionSettings): void {
    assertAllowedModelRoutes(value.allowedModels)
    if (value.enabled && value.allowedModels.length === 0) {
      throw new Error('enabled subagent model selection requires at least one allowed model')
    }
  }
}

export const name = 'subagent-model-selection-settings'
export default SubagentModelSelectionConfig
