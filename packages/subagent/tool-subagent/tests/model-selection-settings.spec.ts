/** Default-off settings and per-session model-selection decisions.
 * @remarks 文件说明：文件职责：验证 subagent/tool-subagent 中 model selection settings
 * spec 相关行为与失败场景。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { bindScopeParent, createScope, scopeOf, scopeTarget } from '@deepseek-ai/dsh-scope'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import * as tool from '../src/index.ts'
import * as ToolInvariant from '../src/invariant.ts'
import SubagentModelSelectionConfig, {
  SUBAGENT_MODEL_SELECTION_SETTINGS_NAMESPACE,
} from '../src/model-selection-settings.ts'
import { subagentModelSelectionPolicy } from '../src/model-selection-state.ts'
import { text } from './harness.ts'

/**
 * 常量说明：ALLOWED_MODELS 用于处理 ALLOWED_MODELS 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const ALLOWED_MODELS = [{ provider: 'alpha', model: 'fast-model' }]

/** Writable in-memory settings provider for the package integration.
 * @remarks 中文说明：类说明：MemorySettings 用于集中封装 处理 MemorySettings 相关状态与行为。；
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由 subagent/tool-subagent
 * 在对应插件或业务生命周期内创建和调用。 */
class MemorySettings extends SettingsProvider {
  /**
   * 变量说明：doc 用于处理 doc 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  doc: Record<string, unknown> = {}

  /**
   * 功能说明：处理 writable 相关流程；使用场景由所在模块及调用位置决定。
   * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 writable()，并按返回类型处理结果。
   */
  get writable(): boolean {
    return true
  }

  /**
   * 功能说明：加载 load 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Promise<Record<string, unknown>>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 load()，并按返回类型处理结果。
   */
  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  /**
   * 功能说明：处理 persist 相关流程；使用场景由所在模块及调用位置决定。
   * @param ns （SettingsNamespace）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param section （Record<string, unknown>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 persist(ns, section)，并按返回类型处理结果。
   */
  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

/** Read whether one Agent's delegation definition contains route fields.
 * @remarks 中文说明：功能说明：处理 selectable 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；
 * 参数说明：agent（Awaited<ReturnType<Context['agents']['create']>>['agent']）：提供
 * 本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：boolean；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 selectable(ctx, agent)，并按返回类型处理结果。 */
function selectable(ctx: Context, agent: Awaited<ReturnType<Context['agents']['create']>>['agent']): boolean {
  /**
   * 常量说明：schema 用于处理 schema 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：candidate（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(candidate)，并按返回类型处理结果。
   */
  const schema = ctx.tools.schemas(agent).find(candidate => candidate.name === 'subagent')
  /**
   * 常量说明：properties 用于处理 properties 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const properties = (schema?.parameters as { properties?: Record<string, unknown> } | undefined)?.properties
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：candidate（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(candidate)，并按返回类型处理结果。
   */
  return properties?.['provider'] !== undefined
    && properties['model'] !== undefined
    && properties['reasoning_effort'] !== undefined
    && ctx.tools.schemas(agent).some(candidate => candidate.name === 'list_subagent_models')
}

/** Mount the real settings, Agent, provider, and tool services.
 * @remarks 中文说明：功能说明：处理 boot 相关流程；使用场景由所在模块及调用位置决定。；返回值：Promise<Context>；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 boot()，并按返回类型处理结果。 */
async function boot(): Promise<Context> {
  /**
   * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const ctx = new Context()
  await ctx.plugin(MemorySettings)
  await ctx.plugin(SubagentModelSelectionConfig)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  return ctx
}

/** Create one Agent whose setup mounts the settings-controlled tool preset row.
 * @remarks 中文说明：功能说明：创建 Agent 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；
 * 参数说明：id（string）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。；参数说明：options（{ meta?: {
 * parentSession: SessionId; origin: 'subagent' } s…）：提供本次操作使用的配置选项；
 * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 createAgent(ctx, id, options)，并按返回类型处理结果。 */
async function createAgent(ctx: Context, id: string, options: {
  meta?: { parentSession: SessionId; origin: 'subagent' }
  seed?: readonly SessionEvent[]
} = {}) {
  /**
   * 常量说明：handle 用于处理 handle 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：agentCtx（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(agentCtx)，并按返回类型处理结果。
   */
  const handle = await ctx.agents.create({
    sessionId: SessionId(id),
    ...options,
    setup: async (agentCtx) => {
      await agentCtx.plugin(tool, {
        provider: 'spawn',
        modelSelectionSettings: true,
        backgroundMode: 'continuable',
      })
    },
  })
  return handle.agent
}

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('SubagentModelSelectionConfig', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('uses the composed default without a settings provider', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = new Context()
    await ctx.plugin(SubagentModelSelectionConfig, { enabled: true, allowedModels: ALLOWED_MODELS })

    expect(ctx.subagentModelSelection.current()).toEqual({ enabled: true, allowedModels: ALLOWED_MODELS })
    await ctx.fiber.dispose()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('defaults off and follows the validated user layer', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = new Context()
    await ctx.plugin(MemorySettings)
    await ctx.plugin(SubagentModelSelectionConfig)

    expect(ctx.subagentModelSelection.current()).toEqual({ enabled: false, allowedModels: [] })
    await ctx.settings.update(SUBAGENT_MODEL_SELECTION_SETTINGS_NAMESPACE, {
      enabled: true,
      allowedModels: ALLOWED_MODELS,
    })
    expect(ctx.subagentModelSelection.current()).toEqual({ enabled: true, allowedModels: ALLOWED_MODELS })
    await ctx.fiber.dispose()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('rejects duplicate routes, enabled empty settings, and an empty durable policy', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = new Context()
    await ctx.plugin(MemorySettings)
    await ctx.plugin(SubagentModelSelectionConfig)

    await expect(ctx.settings.update(SUBAGENT_MODEL_SELECTION_SETTINGS_NAMESPACE, {
      allowedModels: [...ALLOWED_MODELS, ...ALLOWED_MODELS],
    })).rejects.toThrow('repeats route "alpha/fast-model"')

    await expect(ctx.settings.update(SUBAGENT_MODEL_SELECTION_SETTINGS_NAMESPACE, {
      enabled: true,
      allowedModels: [],
    })).rejects.toThrow('enabled subagent model selection requires at least one allowed model')
    await ctx.settings.update(SUBAGENT_MODEL_SELECTION_SETTINGS_NAMESPACE, {
      enabled: false,
      allowedModels: ALLOWED_MODELS,
    })
    expect(ctx.subagentModelSelection.current()).toEqual({ enabled: false, allowedModels: ALLOWED_MODELS })
    await ctx.settings.update(SUBAGENT_MODEL_SELECTION_SETTINGS_NAMESPACE, { allowedModels: [] })
    expect(ctx.subagentModelSelection.current()).toEqual({ enabled: false, allowedModels: [] })

    /**
     * 常量说明：invalid 用于处理 invalid 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const invalid = Session.create(SessionId('empty-policy'))
    invalid.append('subagent/model-selection-policy', { allowedModels: [] })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => subagentModelSelectionPolicy(invalid)).toThrow('requires at least one route')

    /**
     * 常量说明：malformed 用于处理 malformed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const malformed = Session.create(SessionId('malformed-policy'))
    malformed.append('subagent/model-selection-policy', {
      allowedModels: [{ provider: 1, model: 'fast-model' }],
    } as never)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => subagentModelSelectionPolicy(malformed))
      .toThrow('requires non-empty provider and model ids')
    await ctx.fiber.dispose()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('samples each new root session without changing existing Agents', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = await boot()
    /**
     * 常量说明：disabled 用于处理 disabled 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const disabled = await createAgent(ctx, 'disabled')
    expect(selectable(ctx, disabled)).toBe(false)
    expect(subagentModelSelectionPolicy(disabled.session)).toBeUndefined()

    await ctx.settings.update(SUBAGENT_MODEL_SELECTION_SETTINGS_NAMESPACE, {
      enabled: true,
      allowedModels: ALLOWED_MODELS,
    })
    /**
     * 常量说明：enabled 用于处理 enabled 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const enabled = await createAgent(ctx, 'enabled')
    expect(subagentModelSelectionPolicy(enabled.session)).toEqual(ALLOWED_MODELS)
    expect(selectable(ctx, enabled)).toBe(true)
    expect(selectable(ctx, disabled)).toBe(false)

    await ctx.settings.update(SUBAGENT_MODEL_SELECTION_SETTINGS_NAMESPACE, { enabled: false })
    /**
     * 常量说明：disabledAgain 用于处理 disabledAgain 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const disabledAgain = await createAgent(ctx, 'disabled-again')
    expect(selectable(ctx, disabledAgain)).toBe(false)
    expect(selectable(ctx, enabled)).toBe(true)
    await ctx.fiber.dispose()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('rejects a forced route outside the Session policy before child creation', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = await boot()
    await ctx.settings.update(SUBAGENT_MODEL_SELECTION_SETTINGS_NAMESPACE, {
      enabled: true,
      allowedModels: ALLOWED_MODELS,
    })
    /**
     * 常量说明：agent 用于处理 agent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const agent = await createAgent(ctx, 'enforced')

    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('disallowed-session-route'),
      name: 'subagent',
      arguments: {
        description: 'forced route',
        prompt: 'do it',
        provider: 'alpha',
        model: 'other-model',
      },
      agent,
    })

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('is not allowed for this Session')
    await ctx.fiber.dispose()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('installs per-Agent definitions for a shared preset scope', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = await boot()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await ctx.plugin(ToolInvariant)
    /**
     * 常量说明：preset 用于处理 preset 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const preset = createScope(ctx, { preset: 'standard' })
    /**
     * 常量说明：other 用于处理 other 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const other = createScope(ctx, { preset: 'minimal' })
    await preset.ctx.plugin(tool, {
      provider: 'spawn',
      modelSelectionSettings: true,
      backgroundMode: 'continuable',
    })

    /**
     * 变量说明：enabledBinding 用于处理 enabledBinding 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let enabledBinding: ReturnType<typeof bindScopeParent> | undefined
    /**
     * 常量说明：createComposed 用于创建 Composed 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     * 功能说明：创建 Composed 相关流程；使用场景由所在模块及调用位置决定。
     * @param id （string）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。
     * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 createComposed(id)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：agentCtx（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(agentCtx)，并按返回类型处理结果。
     */
    const createComposed = async (id: string) => ctx.agents.create({
      sessionId: SessionId(id),
      setup: (agentCtx) => {
        /**
         * 常量说明：binding 用于处理 binding 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const binding = bindScopeParent(scopeOf(agentCtx)!, scopeOf(preset.ctx)!)
        if (id === 'preset-enabled') enabledBinding = binding
      },
    })

    /**
     * 常量说明：disabled 用于处理 disabled 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const disabled = await createComposed('preset-disabled')
    expect(selectable(ctx, disabled.agent)).toBe(false)
    await ctx.settings.update(SUBAGENT_MODEL_SELECTION_SETTINGS_NAMESPACE, {
      enabled: true,
      allowedModels: ALLOWED_MODELS,
    })
    /**
     * 常量说明：enabled 用于处理 enabled 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const enabled = await createComposed('preset-enabled')
    expect(selectable(ctx, enabled.agent)).toBe(true)
    expect(selectable(ctx, disabled.agent)).toBe(false)

    enabledBinding!.rebind(scopeOf(other.ctx)!)
    ctx.emit(scopeTarget({}, scopeOf(preset.ctx)), 'tools/change')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => { expect(selectable(ctx, enabled.agent)).toBe(false) })
    /**
     * 常量说明：next 用于处理 next 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：处理 next 相关流程；使用场景由所在模块及调用位置决定。
     * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 next()，并按返回类型处理结果。
     */
    const next = () => Promise.resolve({ kind: 'enter' as const, messages: [] })
    /**
     * 常量说明：payload 用于处理 payload 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const payload = {
      agent: enabled.agent,
      messages: [],
      turn: 1,
      step: 1,
      signal: new AbortController().signal,
    }
    await expect(ctx.waterfall(ctx as never, 'agent/pre-step', payload, next))
      .resolves.toEqual({ kind: 'enter', messages: [] })

    enabledBinding!.rebind(scopeOf(preset.ctx)!)
    ctx.emit(scopeTarget({}, scopeOf(preset.ctx)), 'tools/change')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => { expect(selectable(ctx, enabled.agent)).toBe(true) })
    await expect(ctx.waterfall(ctx as never, 'agent/pre-step', payload, next))
      .resolves.toEqual({ kind: 'enter', messages: [] })

    await enabled.dispose()
    ctx.emit(scopeTarget({}, scopeOf(preset.ctx)), 'tools/change')
    await disabled.dispose()
    await ctx.fiber.dispose()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('releases a shared-preset installation reservation after policy selection fails', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = await boot()
    /**
     * 常量说明：preset 用于处理 preset 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const preset = createScope(ctx, { preset: 'standard' })
    /**
     * 常量说明：other 用于处理 other 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const other = createScope(ctx, { preset: 'minimal' })
    await preset.ctx.plugin(tool, {
      provider: 'spawn',
      modelSelectionSettings: true,
      backgroundMode: 'continuable',
    })
    /**
     * 变量说明：binding 用于处理 binding 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let binding: ReturnType<typeof bindScopeParent> | undefined
    /**
     * 常量说明：handle 用于处理 handle 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：agentCtx（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(agentCtx)，并按返回类型处理结果。
     */
    const handle = await ctx.agents.create({
      sessionId: SessionId('preset-policy-retry'),
      setup: (agentCtx) => {
        binding = bindScopeParent(scopeOf(agentCtx)!, scopeOf(preset.ctx)!)
      },
    })
    expect(selectable(ctx, handle.agent)).toBe(false)

    binding!.rebind(scopeOf(other.ctx)!)
    ctx.emit(scopeTarget({}, scopeOf(preset.ctx)), 'tools/change')
    binding!.rebind(scopeOf(preset.ctx)!)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    vi.spyOn(ctx.subagentModelSelection, 'current')
      .mockImplementationOnce(() => { throw new Error('transient settings read') })
      .mockReturnValue({ enabled: true, allowedModels: ALLOWED_MODELS })

    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => { ctx.emit(scopeTarget({}, scopeOf(preset.ctx)), 'tools/change') })
      .toThrow('transient settings read')
    ctx.emit(scopeTarget({}, scopeOf(preset.ctx)), 'tools/change')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => { expect(selectable(ctx, handle.agent)).toBe(true) })

    await handle.dispose()
    await ctx.fiber.dispose()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('inherits the parent decision and preserves seeded decisions across composition', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = await boot()
    await ctx.settings.update(SUBAGENT_MODEL_SELECTION_SETTINGS_NAMESPACE, {
      enabled: true,
      allowedModels: ALLOWED_MODELS,
    })
    /**
     * 常量说明：parent 用于处理 parent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const parent = await createAgent(ctx, 'parent')
    await ctx.settings.update(SUBAGENT_MODEL_SELECTION_SETTINGS_NAMESPACE, { enabled: false })
    /**
     * 常量说明：child 用于处理 child 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const child = await createAgent(ctx, 'child', {
      meta: { parentSession: parent.id, origin: 'subagent' },
    })
    expect(selectable(ctx, child)).toBe(true)
    expect(subagentModelSelectionPolicy(child.session)).toEqual(ALLOWED_MODELS)

    /**
     * 常量说明：orphan 用于处理 orphan 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const orphan = await createAgent(ctx, 'orphan', {
      meta: { parentSession: SessionId('missing-parent'), origin: 'subagent' },
    })
    expect(selectable(ctx, orphan)).toBe(false)

    /**
     * 常量说明：enabledSeed 用于处理 enabledSeed 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const enabledSeed = Session.create(SessionId('enabled-seed'))
    enabledSeed.append('subagent/model-selection-policy', { allowedModels: ALLOWED_MODELS })
    /**
     * 常量说明：resumedEnabled 用于处理 resumedEnabled 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const resumedEnabled = await createAgent(ctx, 'resumed-enabled', { seed: enabledSeed.events })
    expect(selectable(ctx, resumedEnabled)).toBe(true)

    /**
     * 常量说明：oldSeed 用于处理 oldSeed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const oldSeed = Session.create(SessionId('old-seed'), [])
    await ctx.settings.update(SUBAGENT_MODEL_SELECTION_SETTINGS_NAMESPACE, {
      enabled: true,
      allowedModels: ALLOWED_MODELS,
    })
    /**
     * 常量说明：resumedDisabled 用于处理 resumedDisabled 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const resumedDisabled = await createAgent(ctx, 'resumed-disabled', { seed: oldSeed.events })
    expect(selectable(ctx, resumedDisabled)).toBe(false)
    expect(subagentModelSelectionPolicy(resumedDisabled.session)).toBeUndefined()
    await ctx.fiber.dispose()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('requires both the Host setting owner and a composition scope', async () => {
    /**
     * 常量说明：withoutSettings 用于处理 withoutSettings 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const withoutSettings = new Context()
    await mountAgentLoopTestDependencies(withoutSettings)
    await withoutSettings.plugin(SubagentRuntime)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => {
      tool.apply(withoutSettings, {
        provider: 'missing',
        modelSelectionSettings: true,
        maxDepth: 'provider-managed',
      })
    }).toThrow('requires @deepseek-ai/dsh-tool-subagent/model-selection-settings')
    await withoutSettings.fiber.dispose()

    /**
     * 常量说明：withoutAgent 用于处理 withoutAgent 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const withoutAgent = await boot()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => {
      tool.apply(withoutAgent, {
        provider: 'spawn',
        modelSelectionSettings: true,
        backgroundMode: 'continuable',
      })
    }).toThrow('requires an Agent or preset scope')
    await withoutAgent.fiber.dispose()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('checks model-selectable definitions without rejecting a policy-only preset', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = await boot()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await ctx.plugin(ToolInvariant)
    /**
     * 常量说明：disabled 用于处理 disabled 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const disabled = await createAgent(ctx, 'invariant-disabled')
    /**
     * 常量说明：next 用于处理 next 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：处理 next 相关流程；使用场景由所在模块及调用位置决定。
     * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 next()，并按返回类型处理结果。
     */
    const next = () => Promise.resolve({ kind: 'enter' as const, messages: [] })
    /**
     * 常量说明：payload 用于处理 payload 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const payload = {
      agent: disabled,
      messages: [],
      turn: 1,
      step: 1,
      signal: new AbortController().signal,
    }
    await expect(ctx.waterfall(ctx as never, 'agent/pre-step', payload, next)).resolves.toEqual({
      kind: 'enter', messages: [],
    })

    disabled.session.append('subagent/model-selection-policy', { allowedModels: ALLOWED_MODELS })
    await expect(ctx.waterfall(ctx as never, 'agent/pre-step', payload, next))
      .resolves.toEqual({ kind: 'enter', messages: [] })

    await ctx.settings.update(SUBAGENT_MODEL_SELECTION_SETTINGS_NAMESPACE, {
      enabled: true,
      allowedModels: ALLOWED_MODELS,
    })
    /**
     * 常量说明：enabled 用于处理 enabled 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const enabled = await createAgent(ctx, 'invariant-enabled')
    await expect(ctx.waterfall(ctx as never, 'agent/pre-step', { ...payload, agent: enabled }, next))
      .resolves.toEqual({ kind: 'enter', messages: [] })

    /**
     * 常量说明：enabledSchemas 用于处理 enabledSchemas 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const enabledSchemas = ctx.tools.schemas(enabled)
    /**
     * 常量说明：schemas 用于处理 schemas 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const schemas = vi.spyOn(ctx.tools, 'schemas')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：schema（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(schema)，并按返回类型处理结果。
     */
    schemas.mockReturnValue(enabledSchemas.filter(schema => schema.name !== 'list_subagent_models'))
    await expect(ctx.waterfall(ctx as never, 'agent/pre-step', { ...payload, agent: enabled }, next))
      .rejects.toThrow('require a durable policy, route fields, and list_subagent_models')

    schemas.mockReturnValue(enabledSchemas)
    await ctx.settings.update(SUBAGENT_MODEL_SELECTION_SETTINGS_NAMESPACE, { enabled: false })
    /**
     * 常量说明：withoutPolicy 用于处理 withoutPolicy 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const withoutPolicy = await createAgent(ctx, 'invariant-without-policy')
    await expect(ctx.waterfall(ctx as never, 'agent/pre-step', { ...payload, agent: withoutPolicy }, next))
      .rejects.toThrow('require a durable policy, route fields, and list_subagent_models')
    await ctx.fiber.dispose()
  })
})
