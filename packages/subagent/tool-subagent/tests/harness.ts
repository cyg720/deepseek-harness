/**
 * 文件职责：验证 subagent/tool-subagent 中 harness 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { Agent, AgentOptions } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import * as mock from './scripted-provider.ts'
import * as tool from '../src/index.ts'
import SubagentModelSelectionConfig from '../src/model-selection-settings.ts'

/** Shared non-aborted tool signal for package-local integration tests.
 * @remarks 中文说明：常量说明：testToolSignal 用于处理 testToolSignal 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const testToolSignal = new AbortController().signal

/** Build the minimal parent Agent owned by the package-local scripted provider.
 * @remarks 中文说明：功能说明：处理 fakeAgent 相关流程；使用场景由所在模块及调用位置决定。；参数说明：id（由
 * TypeScript 根据调用位置推断的类型）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。；返回值：Agent；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 fakeAgent(id)，并按返回类型处理结果。 */
export function fakeAgent(id = 'parent-1'): Agent {
  /**
   * 常量说明：sessionId 用于处理 sessionId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const sessionId = SessionId(id)
  return { id: sessionId, options: {}, session: Session.create(sessionId) } as unknown as Agent
}

/** Mount the real tool and service stack around one scripted subagent provider.
 * @remarks 中文说明：常量说明：setupAgents 用于处理 setupAgents 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
const setupAgents = new WeakMap<Context, Agent>()
/**
 * 常量说明：setupProviders 用于处理 setupProviders 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const setupProviders = new WeakMap<Context, Awaited<ReturnType<typeof mock.mountScriptedProvider>>>()
/**
 * 变量说明：setupAgentCounter 用于处理 setupAgentCounter 相关数据，作用于当前作用域；其值可能随流程推进而变化，
 * 读写时需遵守声明类型和所在生命周期。
 */
let setupAgentCounter = 0

/** Test-only opt-in translated to the real Host setting and Session path. */
type SetupConfig = tool.Config & {
  withModelSelection?: boolean
  parentAgentOptions?: AgentOptions
}

/**
 * 常量说明：TEST_ALLOWED_MODELS 用于处理 TEST_ALLOWED_MODELS 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：model（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(model)，并按返回类型处理结果。
 */
const TEST_ALLOWED_MODELS = [
  'allowed-model', 'child-model', 'configured-model', 'current-model', 'fast-model',
  'other-model', 'parent-model', 'selected-model', 'unlisted-model',
].flatMap(model => [
  { provider: 'alpha', model },
  { provider: 'current-provider', model },
  { provider: 'missing', model },
])

/**
 * 功能说明：处理 setup 相关流程；使用场景由所在模块及调用位置决定。
 * @param toolConfig （SetupConfig）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。
 * @param mockConfig （Partial<mock.Config>）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。
 * @returns Promise<Context>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 setup(toolConfig, mockConfig)，并按返回类型处理结果。
 */
export async function setup(toolConfig: SetupConfig, mockConfig: Partial<mock.Config> = {}): Promise<Context> {
  /**
   * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const ctx = new Context()
  /**
   * 常量说明：withModelSelection、parentAgentOptions、config 用于处理
   * withModelSelection、parentAgentOptions、config 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const { withModelSelection, parentAgentOptions, ...config } = toolConfig
  if (withModelSelection === true) {
    await ctx.plugin(SubagentModelSelectionConfig, {
      enabled: true,
      allowedModels: TEST_ALLOWED_MODELS,
    })
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(SubagentRuntime)
    /**
     * 常量说明：provider 用于处理 provider 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const provider = await mock.mountScriptedProvider(ctx, { name: 'mock', ...mockConfig })
    setupProviders.set(ctx, provider)
    /**
     * 常量说明：handle 用于处理 handle 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：agentCtx（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(agentCtx)，并按返回类型处理结果。
     */
    const handle = await ctx.agents.create({
      sessionId: SessionId(`model-selection-setup-${++setupAgentCounter}`),
      ...parentAgentOptions !== undefined ? { agentOptions: parentAgentOptions } : {},
      setup: async (agentCtx) => {
        await agentCtx.plugin(tool, { ...config, modelSelectionSettings: true })
      },
    })
    setupAgents.set(ctx, handle.agent)
    return ctx
  }
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SubagentRuntime)
  /**
   * 常量说明：provider 用于处理 provider 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const provider = await mock.mountScriptedProvider(ctx, { name: 'mock', ...mockConfig })
  setupProviders.set(ctx, provider)
  await ctx.plugin(tool, config)
  return ctx
}

/** Dispose the scripted provider mounted by {@link setup}.
 * @remarks 中文说明：功能说明：处理 disposeSetupProvider 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；
 * 返回值：Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * disposeSetupProvider(ctx)，并按返回类型处理结果。 */
export async function disposeSetupProvider(ctx: Context): Promise<void> {
  /**
   * 常量说明：provider 用于处理 provider 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const provider = setupProviders.get(ctx)
  if (provider === undefined) throw new Error('context has no setup provider')
  setupProviders.delete(ctx)
  await provider.dispose()
}

/** Return the real Agent created for a settings-controlled setup.
 * @remarks 中文说明：功能说明：处理 modelSelectionSetupAgent 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；返回值：Agent；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * modelSelectionSetupAgent(ctx)，并按返回类型处理结果。 */
export function modelSelectionSetupAgent(ctx: Context): Agent {
  /**
   * 常量说明：agent 用于处理 agent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const agent = setupAgents.get(ctx)
  if (agent === undefined) throw new Error('context has no model-selection setup Agent')
  return agent
}

/**
 * 变量说明：callCounter 用于处理 callCounter 相关数据，作用于当前作用域；其值可能随流程推进而变化，
 * 读写时需遵守声明类型和所在生命周期。
 */
let callCounter = 0

/** Execute the registered subagent tool through the real ToolRuntime pipeline.
 * @remarks 中文说明：功能说明：处理 callSubagent 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；
 * 参数说明：args（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：over（{ agent?:
 * Agent | undefined; signal?: AbortSignal }）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 callSubagent(ctx, args, over)，并按返回类型处理结果。 */
export function callSubagent(
  ctx: Context,
  args: unknown,
  over: { agent?: Agent | undefined; signal?: AbortSignal } = {},
) {
  // Distinguish "no override" (use a default agent) from an explicit
  // `{ agent: undefined }` (test the no-agent path). Under
  // exactOptionalPropertyTypes the key is omitted rather than set to undefined.
  /**
   * 常量说明：agent 用于处理 agent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const agent = 'agent' in over ? over.agent : setupAgents.get(ctx) ?? fakeAgent()
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: ToolCallId(`call-${++callCounter}`),
    name: 'subagent',
    arguments: args,
    ...agent ? { agent } : {},
    ...over.signal ? { signal: over.signal } : {},
  })
}

/** Join text blocks from one rendered tool result.
 * @remarks 中文说明：功能说明：处理 text 相关流程；使用场景由所在模块及调用位置决定。；参数说明：result（{ content:
 * { type: string; text?: string }[] }）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：string；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 text(result)，
 * 并按返回类型处理结果。 */
export function text(result: { content: { type: string; text?: string }[] }): string {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：block（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(block)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：block（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(block)，并按返回类型处理结果。
   */
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}
