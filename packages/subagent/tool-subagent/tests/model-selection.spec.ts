/**
 * 文件职责：验证 subagent/tool-subagent 中 model selection spec 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type { SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { MockAdapter } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as mock from './scripted-provider.ts'
import * as tool from '../src/index.ts'
import {
  assertAllowedModelRoutes,
  assertAllowedModelSelection,
  preflightChildLlmRoute,
} from '../src/model-selection.ts'
import { callSubagent, modelSelectionSetupAgent, setup, text } from './harness.ts'

/**
 * 常量说明：REASONING 用于处理 REASONING 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const REASONING = {
  efforts: [
    { id: ReasoningEffortId('low'), name: 'Low' },
    { id: ReasoningEffortId('high'), name: 'High' },
  ],
  defaultEffort: ReasoningEffortId('high'),
} as const

/**
 * 功能说明：处理 parentWithRoute 相关流程；使用场景由所在模块及调用位置决定。
 * @param options （Agent['options']）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。
 * @returns Agent；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 parentWithRoute(options)，并按返回类型处理结果。
 */
function parentWithRoute(
  options: Agent['options'] = {
    provider: 'alpha',
    model: 'parent-model',
    reasoningEffort: ReasoningEffortId('high'),
  },
): Agent {
  /**
   * 常量说明：id 用于处理 id 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const id = SessionId('parent-with-route')
  return { id, options, session: Session.create(id) } as unknown as Agent
}

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('dsh-tool-subagent model selection', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('rejects empty route ids at the configuration boundary', () => {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => { assertAllowedModelRoutes([{ provider: '', model: 'model' }]) })
      .toThrow('requires non-empty provider and model ids')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => { assertAllowedModelRoutes([{ provider: 'provider', model: '' }]) })
      .toThrow('requires non-empty provider and model ids')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => { assertAllowedModelRoutes({ provider: 'provider', model: 'model' }) })
      .toThrow('requires an array of routes')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => { assertAllowedModelRoutes([{ provider: 1, model: 'model' }]) })
      .toThrow('requires non-empty provider and model ids')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('allows pure inheritance but rejects explicit values outside a Session allowlist', () => {
    /**
     * 常量说明：policy 用于处理 policy 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const policy = {
      routes: [{ provider: 'alpha', model: 'allowed-model' }],
    }
    /**
     * 常量说明：parent 用于处理 parent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const parent = { provider: 'alpha', model: 'parent-model' }

    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => { assertAllowedModelSelection(policy, parent, undefined, {}) }).not.toThrow()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => {
      assertAllowedModelSelection(
        policy,
        parent,
        { provider: 'alpha', model: 'allowed-model' },
        { provider: 'alpha', model: 'allowed-model' },
      )
    }).not.toThrow()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => {
      assertAllowedModelSelection(
        policy,
        parent,
        { provider: 'alpha', model: 'other-model' },
        { provider: 'alpha', model: 'other-model' },
      )
    }).toThrow('is not allowed for this Session')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => {
      assertAllowedModelSelection(
        policy,
        parent,
        { reasoningEffort: ReasoningEffortId('low') },
        { reasoning_effort: 'low' },
      )
    }).toThrow('alpha/parent-model')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => {
      assertAllowedModelSelection(
        policy,
        {},
        { reasoningEffort: ReasoningEffortId('low') },
        { reasoning_effort: 'low' },
      )
    }).toThrow('without an effective provider and model')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('leaves deployment or parent defaults outside the allowlist usable when the call selects nothing', async () => {
    /**
     * 变量说明：starts 用于处理 starts 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let starts = 0
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const ctx = await setup(
      { provider: 'mock', withModelSelection: true },
      { onStart: () => { starts += 1 } },
    )
    /**
     * 常量说明：parent 用于处理 parent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const parent = modelSelectionSetupAgent(ctx)
    ;(parent as unknown as { options: Agent['options'] }).options = {
      provider: 'deployment-provider',
      model: 'deployment-model',
    }

    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = await callSubagent(ctx, { description: 'default route', prompt: 'do it' })

    expect(result.isError).toBe(false)
    expect(starts).toBe(1)
  })
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('exposes Session-authorized route fields and discovery when selection is enabled', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = await setup({ provider: 'mock', withModelSelection: true })
    /**
     * 常量说明：agent 用于处理 agent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const agent = modelSelectionSetupAgent(ctx)
    /**
     * 常量说明：schema 用于处理 schema 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：entry（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(entry)，并按返回类型处理结果。
     */
    const schema = ctx.tools.schemas(agent).find(entry => entry.name === 'subagent')!
    /**
     * 常量说明：props 用于处理 props 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const props = (schema.parameters as { properties?: Record<string, unknown> }).properties ?? {}
    expect(Object.keys(props).sort()).toEqual([
      'description',
      'model',
      'prompt',
      'provider',
      'reasoning_effort',
      'run_in_background',
    ])
    expect(schema.description).toContain('list_subagent_models')
    expect(ctx.tools.get('list_subagent_models', agent)).toBeDefined()
    expect(schema.description).not.toContain('alpha')

    /**
     * 常量说明：registration 用于处理 registration 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const registration = ctx.llm.registerAdapter(['alpha'], new MockAdapter([]))
    /**
     * 常量说明：definition 用于处理 definition 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const definition = ctx.tools.get('subagent', agent)
    registration.replace(['beta'])
    expect(ctx.tools.get('subagent', agent)).toBe(definition)
    expect(definition?.description).not.toContain('beta')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('hides and rejects route fields when selection is disabled', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = await setup({ provider: 'mock' })
    /**
     * 常量说明：schema 用于处理 schema 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：entry（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(entry)，并按返回类型处理结果。
     */
    const schema = ctx.tools.schemas().find(entry => entry.name === 'subagent')!
    /**
     * 常量说明：props 用于处理 props 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const props = (schema.parameters as { properties?: Record<string, unknown> }).properties ?? {}
    expect(Object.keys(props).sort()).toEqual(['description', 'prompt', 'run_in_background'])
    expect(schema.description).not.toContain('list_subagent_models')
    expect(ctx.tools.get('list_subagent_models')).toBeUndefined()

    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = await callSubagent(ctx, {
      description: 'forced route',
      prompt: 'do it',
      provider: 'alpha',
      model: 'fast-model',
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('child model selection is disabled for this tool instance')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('rejects enabled model selection when the provider cannot apply Agent options', async () => {
    await expect(setup(
      { provider: 'mock', withModelSelection: true, maxDepth: 'provider-managed' },
      { capabilities: { agentOptions: false } },
    )).rejects.toThrow('provider "mock" does not support child model selection')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('selects an unlisted complete route and clears a configured effort when the route changes', async () => {
    /**
     * 常量说明：requests 用于处理 requests 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const requests: SubagentStartRequest[] = []
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：request（由 TypeScript
     * 根据调用位置推断的类型）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(request)，并按返回类型处理结果。
     */
    const ctx = await setup({
      provider: 'mock',
      withModelSelection: true,
      agentOptions: {
        provider: 'alpha',
        model: 'configured-model',
        reasoningEffort: ReasoningEffortId('high'),
        maxTokens: 321,
      },
    }, { onStart: (request) => { requests.push(request) } })
    ctx.llm.registerAdapter(['alpha'], new MockAdapter([], REASONING))
    /**
     * 常量说明：parent 用于处理 parent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const parent = modelSelectionSetupAgent(ctx)
    ;(parent as unknown as { options: Agent['options'] }).options = parentWithRoute().options

    /**
     * 常量说明：selected 用于处理 selected 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const selected = await callSubagent(ctx, {
      description: 'route work',
      prompt: 'do it',
      provider: 'alpha',
      model: 'unlisted-model',
    })
    expect(selected.isError).toBe(false)
    expect(requests[0]?.agentOptions).toEqual({
      provider: 'alpha',
      model: 'unlisted-model',
      maxTokens: 321,
    })

    /**
     * 常量说明：effort 用于处理 effort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const effort = await callSubagent(ctx, {
      description: 'same route effort',
      prompt: 'do it',
      provider: 'alpha',
      model: 'configured-model',
      reasoning_effort: 'low',
    })
    expect(effort.isError).toBe(false)
    expect(requests[1]?.agentOptions).toEqual({
      provider: 'alpha',
      model: 'configured-model',
      reasoningEffort: 'low',
      maxTokens: 321,
    })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('accepts an effort-only override for the effective configured or parent route', async () => {
    /**
     * 常量说明：requests 用于处理 requests 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const requests: SubagentStartRequest[] = []
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：request（由 TypeScript
     * 根据调用位置推断的类型）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(request)，并按返回类型处理结果。
     */
    const ctx = await setup({
      provider: 'mock',
      withModelSelection: true,
      agentOptions: { provider: 'alpha' },
    }, { onStart: (request) => { requests.push(request) } })
    ctx.llm.registerAdapter(['alpha'], new MockAdapter([], REASONING))
    /**
     * 常量说明：parent 用于处理 parent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const parent = modelSelectionSetupAgent(ctx)
    ;(parent as unknown as { options: Agent['options'] }).options = parentWithRoute().options

    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = await callSubagent(ctx, {
      description: 'effort work',
      prompt: 'do it',
      reasoning_effort: 'low',
    })
    expect(result.isError).toBe(false)
    expect(requests[0]?.agentOptions).toEqual({ provider: 'alpha', reasoningEffort: 'low' })

    /**
     * 常量说明：inherited 用于处理 inherited 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const inherited = await setup({ provider: 'mock', withModelSelection: true })
    inherited.llm.registerAdapter(['alpha'], new MockAdapter([], REASONING))
    /**
     * 常量说明：inheritedParent 用于处理 inheritedParent 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const inheritedParent = modelSelectionSetupAgent(inherited)
    ;(inheritedParent as unknown as { options: Agent['options'] }).options = parentWithRoute().options
    /**
     * 常量说明：inheritedResult 用于处理 inheritedResult 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const inheritedResult = await callSubagent(inherited, {
      description: 'parent effort work',
      prompt: 'do it',
      reasoning_effort: 'low',
    })
    expect(inheritedResult.isError).toBe(false)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('inherits a parent effort only when an explicit route stays unchanged', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = await setup({ provider: 'mock', withModelSelection: true })
    ctx.llm.registerAdapter(['alpha'], new MockAdapter([], REASONING))
    /**
     * 常量说明：parent 用于处理 parent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const parent = modelSelectionSetupAgent(ctx)
    ;(parent as unknown as { options: Agent['options'] }).options = parentWithRoute().options
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = await callSubagent(ctx, {
      description: 'same route work',
      prompt: 'do it',
      provider: 'alpha',
      model: 'parent-model',
    })
    expect(result.isError).toBe(false)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('compares explicit routes with the latest logged parent selection', async () => {
    /**
     * 常量说明：requests 用于处理 requests 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const requests: SubagentStartRequest[] = []
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：request（由 TypeScript
     * 根据调用位置推断的类型）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(request)，并按返回类型处理结果。
     */
    const ctx = await setup({
      provider: 'mock',
      withModelSelection: true,
      agentOptions: { reasoningEffort: ReasoningEffortId('high') },
    }, { onStart: (request) => { requests.push(request) } })
    ctx.llm.registerAdapter(['current-provider'], new MockAdapter([], REASONING))
    /**
     * 常量说明：parent 用于处理 parent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const parent = modelSelectionSetupAgent(ctx)
    ;(parent as unknown as { options: Agent['options'] }).options = {
      provider: 'created-provider', model: 'created-model',
    }
    parent.session.append('request/header', {
      header: { config: { provider: 'current-provider', model: 'current-model' } },
      reason: 'initial',
    })

    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = await callSubagent(ctx, {
      description: 'same current route',
      prompt: 'do it',
      provider: 'current-provider',
      model: 'current-model',
    })

    expect(result.isError).toBe(false)
    expect(requests[0]?.agentOptions).toEqual({
      provider: 'current-provider',
      model: 'current-model',
      reasoningEffort: 'high',
    })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('rejects an effort without any effective route', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = await setup({ provider: 'mock', withModelSelection: true })
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = await callSubagent(ctx, {
      description: 'missing route',
      prompt: 'do it',
      reasoning_effort: 'low',
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('without an effective provider and model')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('rejects preflight without an effective provider and model', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = await setup({ provider: 'mock' })
    await expect(preflightChildLlmRoute(ctx.llm, {}, undefined, AbortSignal.abort()))
      .rejects.toThrow('without an effective provider and model')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：route（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(route)，并按返回类型处理结果。
   */
  it.each([
    { provider: 'alpha' },
    { model: 'fast-model' },
  ])('rejects a partial model-facing route before child creation', async (route) => {
    /**
     * 变量说明：starts 用于处理 starts 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let starts = 0
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const ctx = await setup({ provider: 'mock', withModelSelection: true }, { onStart: () => { starts += 1 } })
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = await callSubagent(ctx, { description: 'partial route', prompt: 'do it', ...route })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('`provider` and `model` must be supplied together')
    expect(starts).toBe(0)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：{ expected, ...selection }（由
   * TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
   * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调({ expected,
   * ...sele…)，并按返回类型处理结果。
   */
  it.each([
    { provider: '', model: 'fast-model', expected: '`provider` must be non-empty' },
    { provider: 'alpha', model: '', expected: '`model` must be non-empty' },
    { reasoning_effort: '', expected: '`reasoning_effort` must be non-empty' },
  ])('rejects empty model-facing values', async ({ expected, ...selection }) => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = await setup({ provider: 'mock', withModelSelection: true })
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = await callSubagent(ctx, { description: 'empty route', prompt: 'do it', ...selection })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain(expected)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('uses the LLM runtime for provider and reasoning-effort validation before child creation', async () => {
    /**
     * 变量说明：starts 用于处理 starts 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let starts = 0
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const ctx = await setup({ provider: 'mock', withModelSelection: true }, { onStart: () => { starts += 1 } })
    ctx.llm.registerAdapter(['alpha'], new MockAdapter([], REASONING))

    /**
     * 常量说明：unsupported 用于处理 unsupported 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const unsupported = await callSubagent(ctx, {
      description: 'bad effort',
      prompt: 'do it',
      provider: 'alpha',
      model: 'fast-model',
      reasoning_effort: 'max',
    })
    expect(unsupported.isError).toBe(true)
    expect(text(unsupported)).toContain('does not support reasoning effort "max"')

    /**
     * 常量说明：missing 用于处理 missing 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const missing = await callSubagent(ctx, {
      description: 'bad provider',
      prompt: 'do it',
      provider: 'missing',
      model: 'fast-model',
    })
    expect(missing.isError).toBe(true)
    expect(text(missing)).toContain('no adapter registered for provider "missing"')
    expect(starts).toBe(0)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('validates a configured effort before child creation', async () => {
    /**
     * 变量说明：starts 用于处理 starts 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let starts = 0
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const ctx = await setup({
      provider: 'mock',
      agentOptions: {
        provider: 'alpha',
        model: 'parent-model',
        reasoningEffort: ReasoningEffortId('high'),
      },
    }, { onStart: () => { starts += 1 } })
    ctx.llm.registerAdapter(['alpha'], new MockAdapter([], {
      efforts: [{ id: ReasoningEffortId('low'), name: 'Low' }],
      defaultEffort: ReasoningEffortId('low'),
    }))

    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = await callSubagent(
      ctx,
      { description: 'same route', prompt: 'do it' },
      { agent: parentWithRoute() },
    )
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('does not support reasoning effort "high"')
    expect(starts).toBe(0)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('validates a configured route before child creation', async () => {
    /**
     * 变量说明：starts 用于处理 starts 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let starts = 0
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const ctx = await setup({
      provider: 'mock',
      agentOptions: { provider: 'missing', model: 'configured-model' },
    }, { onStart: () => { starts += 1 } })

    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = await callSubagent(
      ctx,
      { description: 'configured route', prompt: 'do it' },
      { agent: parentWithRoute() },
    )

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('no adapter registered for provider "missing"')
    expect(starts).toBe(0)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('rejects selected routes or configured efforts when the LLM service is absent', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    await mock.mountScriptedProvider(ctx, { name: 'mock' })
    await ctx.plugin(tool, {
      provider: 'mock',
      agentOptions: {
        provider: 'alpha',
        model: 'fast-model',
        reasoningEffort: ReasoningEffortId('high'),
      },
    })

    /**
     * 常量说明：configured 用于处理 configured 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const configured = await callSubagent(ctx, { description: 'configured effort', prompt: 'do it' })
    expect(configured.isError).toBe(true)
    expect(text(configured)).toContain('`llm` service is unavailable')

  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('keeps pure inherited routing usable without an LLM service lookup', async () => {
    /**
     * 变量说明：starts 用于处理 starts 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let starts = 0
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await mock.mountScriptedProvider(ctx, { name: 'mock', onStart: () => { starts += 1 } })
    await ctx.plugin(tool, { provider: 'mock' })

    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = await callSubagent(ctx, { description: 'inherit route', prompt: 'do it' })
    expect(result.isError).toBe(false)
    expect(starts).toBe(1)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('warns that changing a fork route can lose inherited-prefix reuse', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = await setup({ provider: 'mock', withModelSelection: true }, { inheritsParentContext: true })
    /**
     * 常量说明：schema 用于处理 schema 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：entry（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(entry)，并按返回类型处理结果。
     */
    const schema = ctx.tools.schemas(modelSelectionSetupAgent(ctx)).find(entry => entry.name === 'subagent')!
    expect(schema.description).toContain('inherits this conversation')
    expect(schema.description).toContain('can prevent provider-side reuse of the inherited conversation prefix')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('propagates an exact-route resolver failure before child creation', async () => {
    /**
     * 变量说明：starts 用于处理 starts 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let starts = 0
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const ctx = await setup({ provider: 'mock', withModelSelection: true }, { onStart: () => { starts += 1 } })
    /**
     * 常量说明：adapter 用于处理 adapter 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const adapter = new MockAdapter([])
    vi.spyOn(adapter, 'resolveModel').mockRejectedValue(new Error('selected route unavailable'))
    ctx.llm.registerAdapter(['alpha'], adapter)

    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = await callSubagent(ctx, {
      description: 'route work',
      prompt: 'do it',
      provider: 'alpha',
      model: 'fast-model',
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('selected route unavailable')
    expect(starts).toBe(0)
  })
})
