/**
 * 文件职责：验证Agent Loop的 tool-order.spec.ts 行为与不变量。
 * 技术维度：Vitest、Cordis、会话事件、模型适配器和可控工具夹具。
 * 产品维度：防止Agent Loop在取消、恢复、错误或并发场景中产生回归。
 * 逻辑维度：构造服务与事件，驱动执行流程，再断言日志、请求、状态和清理。
 * 关键边界：测试后台任务必须结束；模型可见输入必须可从日志重建；工具调用顺序不可破坏。
 * 新手阅读建议：先读 mock/辅助函数，再按成功、错误、恢复和生命周期场景阅读。
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
/**
 * Loop-level tool-order determinism: the request/header event — and therefore the frozen
 * request the adapter receives — carries the assembly's canonical tool order (system-prompt's
 * `toolOrder` config, or lexicographic name order), regardless of the order tool plugins
 * happened to register in. Registration order is a concurrent loading artifact
 * and must not leak downstream.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, foldRequestHeader } from '@deepseek-ai/dsh-session'
import SystemPrompt, { TOOL_ORDER_REST } from '@deepseek-ai/dsh-system-prompt'
import type { Config as SystemPromptConfig } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'

import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { MockAdapter, textResponse } from './mock-adapter.ts'

/** 中文说明：测试辅助函数 harness 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
async function harness(adapter: MockAdapter, toolOrder?: SystemPromptConfig['toolOrder']) {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: 'stable base', ...toolOrder !== undefined ? { toolOrder } : {} })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

/** 中文说明：测试辅助函数 waitForIdle 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    /** 中文说明：测试局部值 dispose，由紧邻初始化决定，仅在当前场景使用。 */
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}

/** 中文说明：测试辅助函数 registerNamed 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
function registerNamed(ctx: Context, name: string) {
  ctx.tools.register(defineContentToolFixture({
    name,
    description: `the ${name} tool`,
    parameters: {},
    async execute() {
      return [{ type: 'text', text: name }]
    },
  }))
}

/** Run one text-only turn and return the harness context + agent. */
/** 中文说明：测试辅助函数 runTurn 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
async function runTurn(registrationOrder: string[], toolOrder?: SystemPromptConfig['toolOrder']) {
  /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
  const adapter = new MockAdapter([textResponse('done')])
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
  const ctx = await harness(adapter, toolOrder)
  /** 中文说明：测试局部值 name，由紧邻初始化决定，仅在当前场景使用。 */
  for (const name of registrationOrder) registerNamed(ctx, name)
  /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
  const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
  await waitForIdle(ctx, agent)
  return { ctx, agent, adapter }
}

describe('loop-level canonical tool order', () => {
  it('logs the request/header with tools in canonical order, not registration order', async () => {
    /** 中文说明：测试局部值 { agent, adapter }，由紧邻初始化决定，仅在当前场景使用。 */
    const { agent, adapter } = await runTurn(['zulu', 'alpha', 'mike'])
    /** 中文说明：测试局部值 header，由紧邻初始化决定，仅在当前场景使用。 */
    const header = foldRequestHeader(agent.session.events)
    expect(header?.tools?.map(tool => tool.name)).toEqual(['alpha', 'mike', 'zulu'])
    // The dispatched request is built FROM the logged header (whose tools the
    // assembly already canonicalized) and reaches the adapter deep-frozen —
    // the marker the reconstruction invariant keys on.
    expect(adapter.requests[0]?.tools?.map(tool => tool.name)).toEqual(['alpha', 'mike', 'zulu'])
    expect(Object.isFrozen(adapter.requests[0])).toBe(true)
    expect(adapter.requests[0]?.sessionId).toBe(agent.session.id)
  })

  it('produces the same header order for any registration order', async () => {
    /** 中文说明：测试局部值 first，由紧邻初始化决定，仅在当前场景使用。 */
    const first = await runTurn(['alpha', 'mike', 'zulu'])
    /** 中文说明：测试局部值 second，由紧邻初始化决定，仅在当前场景使用。 */
    const second = await runTurn(['zulu', 'mike', 'alpha'])
    /** 中文说明：测试局部值 names，由紧邻初始化决定，仅在当前场景使用。 */
    const names = (run: typeof first) => foldRequestHeader(run.agent.session.events)?.tools?.map(tool => tool.name)
    expect(names(first)).toEqual(['alpha', 'mike', 'zulu'])
    expect(names(second)).toEqual(names(first))
  })

  it('honors a configured toolOrder in the logged header and the dispatched request', async () => {
    /** 中文说明：测试局部值 { agent, adapter }，由紧邻初始化决定，仅在当前场景使用。 */
    const { agent, adapter } = await runTurn(['alpha', 'zulu', 'mike'], ['zulu', TOOL_ORDER_REST])
    /** 中文说明：测试局部值 header，由紧邻初始化决定，仅在当前场景使用。 */
    const header = foldRequestHeader(agent.session.events)
    expect(header?.tools?.map(tool => tool.name)).toEqual(['zulu', 'alpha', 'mike'])
    expect(adapter.requests[0]?.tools?.map(tool => tool.name)).toEqual(['zulu', 'alpha', 'mike'])
    expect(Object.isFrozen(adapter.requests[0])).toBe(true)
  })

  it('closes a no-step turn when toolOrder names an unregistered tool', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('never sent')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter, ['ghost', TOOL_ORDER_REST])
    registerNamed(ctx, 'alpha')
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    expect(adapter.requests).toHaveLength(0)
    expect(foldRequestHeader(agent.session.events)).toBeUndefined()
    expect(agent.session.events.some(e => e.type === 'turn/start')).toBe(true)
    expect(agent.session.events.some(e => e.type === 'turn/end')).toBe(true)
    expect(agent.session.events.some(e => e.type === 'step/start')).toBe(false)
    expect(agent.session.events.some(e => e.type === 'step/end')).toBe(false)
  })
})
