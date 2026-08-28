/** Host-owned opt-in setting for model-selectable subagent delegation.
 * @remarks 文件说明：文件职责：实现 subagent/tool-subagent 中 model selection settings
 * 模块的职责，并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与
 * Cordis 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * subagent/tool-subagent 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
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

/** User-settings section for model-selectable subagent delegation.
 * @remarks 中文说明：常量说明：SUBAGENT_MODEL_SELECTION_SETTINGS_NAMESPACE 用于处理
 * SUBAGENT_MODEL_SELECTION_SETTINGS_NAMESPACE 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const SUBAGENT_MODEL_SELECTION_SETTINGS_NAMESPACE = settingsNamespace('subagent-model-selection')

/** Stored user preference; the shipped composition defaults it off. */
export interface SubagentModelSelectionSettings {
  /** Whether newly composed top-level Sessions receive model selection. */
  enabled: boolean
  /** Exact child LLM routes offered to newly composed top-level Sessions. */
  allowedModels: AllowedModelRoute[]
}

/** Schema served to settings clients for the opt-in preference.
 * @remarks 中文说明：常量说明：SUBAGENT_MODEL_SELECTION_SETTINGS_SCHEMA 用于处理
 * SUBAGENT_MODEL_SELECTION_SETTINGS_SCHEMA 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
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

/** Singleton settings owner read by delegation tools when an Agent is published.
 * @remarks 中文说明：类说明：SubagentModelSelectionConfig 用于集中封装 处理
 * SubagentModelSelectionConfig 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。
 * ；使用场景：由 subagent/tool-subagent 在对应插件或业务生命周期内创建和调用。 */
export class SubagentModelSelectionConfig extends Service {
  /**
   * 变量说明：Config 用于处理 Config 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  static Config: z<Config> = z.object({
    enabled: z.boolean().default(false),
    allowedModels: z.array(AllowedModelRouteSchema).default([]),
  })

  /**
   * 变量说明：source 用于处理 source 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private source: () => SubagentModelSelectionSettings

  /**
   * 功能说明：处理 SubagentModelSelectionConfig 相关流程；使用场景由所在模块及调用位置决定。
   * @param ctx （Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。
   * @param config （Config）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new SubagentModelSelectionConfig(ctx, config) 创建实例，
   * 并在所属生命周期内使用。
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'subagentModelSelection')
    // Cordis supplies the schema default; the fallback also covers direct construction.
    /* v8 ignore next */
    /**
     * 常量说明：entry 用于处理 entry 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const entry: SubagentModelSelectionSettings = {
      enabled: config.enabled ?? false,
      allowedModels: config.allowedModels ?? [],
    }
    this.validate(entry)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    this.source = () => entry
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：source（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(source)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(value)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    installSettingsSection(
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
  }

  /**
   * Read a detached selection preference for the next eligible Agent publication.
   * @returns the enabled state and exact allowed routes.
   * @remarks 中文说明：功能说明：处理 current 相关流程；使用场景由所在模块及调用位置决定。；
   * 返回值：SubagentModelSelectionSettings；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 current()，并按返回类型处理结果。
   */
  current(): SubagentModelSelectionSettings {
    /**
     * 常量说明：current 用于处理 current 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const current = this.source()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：route（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(route)，并按返回类型处理结果。
     */
    return {
      enabled: current.enabled,
      allowedModels: current.allowedModels.map(route => ({ ...route })),
    }
  }

  /**
   * 功能说明：校验 validate 相关流程；使用场景由所在模块及调用位置决定。
   * @param value （SubagentModelSelectionSettings）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 validate(value)，并按返回类型处理结果。
   */
  private validate(value: SubagentModelSelectionSettings): void {
    assertAllowedModelRoutes(value.allowedModels)
    if (value.enabled && value.allowedModels.length === 0) {
      throw new Error('enabled subagent model selection requires at least one allowed model')
    }
  }
}

/**
 * 常量说明：name 用于处理 name 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
export const name = 'subagent-model-selection-settings'
export default SubagentModelSelectionConfig
