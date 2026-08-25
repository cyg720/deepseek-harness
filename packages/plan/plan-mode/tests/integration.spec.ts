/**
 * 文件职责：验证 integration.spec.ts 覆盖的计划模式行为、持久化与异常场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件上下文和可控测试替身。
 * 产品维度：保障 Agent 使用计划模式时得到稳定且可重放的结果。
 * 逻辑维度：准备上下文与事件，触发被测流程，再核对状态、输出和资源清理。
 * 关键边界：持久化事件必须可重放；连接和异步资源必须在用例结束时释放。
 * 新手阅读建议：先读辅助函数，再按 describe/it 阅读正常、恢复与失败场景。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage, type StreamChunk  } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import PlanModeController, { foldPlanMode } from '@deepseek-ai/dsh-plan-mode'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

/** 中文说明：常量 PLAN_CONFIG 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const PLAN_CONFIG = { section: 'Test plan mode instructions.' }

/**
 * Full-loop integration: a scripted mock model drives the REAL plan-mode plugin
 * through the agent loop — the pending-intent flush at the step boundary, the
 * assembly the soft layer shapes (the exit tool + mode section), and the
 * `request/header` snapshots every transition leaves.
 * Only the model is mocked; the loop, the session log, and the plugin are
 * real.
 */
/* 中文说明：函数 harness 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function harness(adapter: MockAdapter): Promise<Context> {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(PlanModeController, PLAN_CONFIG)
  ctx.llm.registerAdapter(['mock'], adapter)
  /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
  for (const name of ['read', 'write']) {
    ctx.tools.register(defineContentToolFixture({
      name,
      description: `test tool ${name}`,
      parameters: {},
      execute: () => Promise.resolve([{ type: 'text', text: `ran ${name}` }]),
    }))
  }
  return ctx
}

/** 中文说明：函数 waitForIdle 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    /** 中文说明：函数值 dispose 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}

/** 中文说明：函数 findEvent 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function findEvent<T extends SessionEvent['type']>(
  log: readonly SessionEvent[],
  type: T,
  position: 'first' | 'last' = 'first',
): Extract<SessionEvent, { type: T }> {
  /** 中文说明：变量 found 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const found = position === 'first'
    ? log.find(event => event.type === type)
    : log.findLast(event => event.type === type)
  if (!found) throw new Error(`no ${type} event in the session log`)
  return found as Extract<SessionEvent, { type: T }>
}

describe('plan mode through the agent loop', () => {
  it('a pre-turn set() makes the FIRST header plan-shaped, and a non-shell call is guidance-constrained only', async () => {
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new MockAdapter([
      toolCallResponse('call-1', 'write', {}, 'Writing during plan.'),
      textResponse('Noted in the plan.'),
    ])
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await harness(adapter)
    /** 中文说明：变量 agent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const agent = ctx.agentLoop.create(SessionId('it-plan-seed'), { provider: 'mock', model: 'mock' })
    // Selected while idle: the mode commits immediately, before the first assembly.
    ctx.planMode.set(agent, true)

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'explore the repo' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    /** 中文说明：变量 log 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const log = agent.session.events
    /** 中文说明：变量 planMode 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const planMode = findEvent(log, 'plan/mode')
    /** 中文说明：变量 header 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const header = findEvent(log, 'request/header')
    expect(planMode.seq).toBeLessThan(header.seq)
    expect(header.data.reason).toBe('initial')
    expect(header.data.header.tools?.map(tool => tool.name)).toEqual(['exit_plan_mode', 'read', 'write'])
    expect(header.data.header.system).toContain('plan mode')

    // No tool gate: the write RUNS — plan restrains by the section's
    // guidance alone (enforcement lives on the independent sandbox/approval
    // axes). The mode itself stays plan throughout.
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = findEvent(log, 'tool/result')
    expect(result.data.message.content[0].isError).toBe(false)
    expect(foldPlanMode(log)).toBe(true)
    expect(log.some(event => event.type === 'user/message' && event.data.source.kind === 'plugin')).toBe(false)
  })

  it('a user flip between turns lands at the boundary: one notice and a changed header with stable tool schemas', async () => {
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new MockAdapter([
      textResponse('First turn, default mode.'),
      textResponse('Second turn, plan mode.'),
    ])
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await harness(adapter)
    /** 中文说明：变量 agent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const agent = ctx.agentLoop.create(SessionId('it-plan-flip'), { provider: 'mock', model: 'mock' })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    expect(foldPlanMode(agent.session.events)).toBe(false)
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = findEvent(agent.session.events, 'request/header')
    expect(first.data.header.tools?.map(tool => tool.name)).toEqual(['exit_plan_mode', 'read', 'write'])

    ctx.planMode.set(agent, true)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'now plan' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    /** 中文说明：变量 log 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const log = agent.session.events
    expect(foldPlanMode(log)).toBe(true)
    /** 中文说明：函数值 notices 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const notices = log.filter(event => event.type === 'user/message' && event.data.source.kind === 'plugin')
    expect(notices).toHaveLength(1)
    expect(notices[0]?.type === 'user/message' && notices[0].data.content).toEqual([
      { type: 'text', text: 'The user switched this session to plan mode.' },
    ])
    // The changed request is logged as a complete snapshot.
    /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const second = findEvent(log, 'request/header', 'last')
    expect(second.data.reason).toBe('change')
    expect(second.data.header.tools?.map(tool => tool.name)).toEqual(['exit_plan_mode', 'read', 'write'])
    expect(second.data.header.tools).toEqual(first.data.header.tools)
    expect(second.data.header.system).toContain('plan mode')
  })

  it('a mode flip at error settlement waits until the step after a same-step retry', async () => {
    /** 中文说明：变量 failedRequest 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const failedRequest = [{
      type: 'finish',
      reason: { kind: 'error', failure: { message: 'temporarily unavailable', code: 'SERVER', status: 503 } },
    }] satisfies StreamChunk[]
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new MockAdapter([
      failedRequest,
      textResponse('Recovered with the original step assembly.'),
      textResponse('Entered plan mode on the next step.'),
    ])
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await harness(adapter)
    /** 中文说明：变量 agent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const agent = ctx.agentLoop.create(SessionId('it-plan-retry-flip'), { provider: 'mock', model: 'mock' })
    ctx.on('agent/request-error', async ({ agent: subject }, next) => {
      if (subject !== agent) return next()
      ctx.planMode.set(agent, true)
      return { kind: 'retry' }
    })

    /** 中文说明：变量 idle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const idle = waitForIdle(ctx, agent)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'plan after the transient failure' }], source: { kind: 'user' } }))
    await idle

    expect(adapter.requests).toHaveLength(2)
    expect(adapter.requests[0]?.system).not.toContain(PLAN_CONFIG.section)
    expect(adapter.requests[1]?.system).not.toContain(PLAN_CONFIG.section)
    expect(adapter.requests[1]?.tools).toEqual(adapter.requests[0]?.tools)
    expect(ctx.planMode.get(agent)).toEqual({ active: false, pending: true })
    expect(agent.session.events.some(event => event.type === 'plan/mode')).toBe(false)

    /** 中文说明：变量 nextIdle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const nextIdle = waitForIdle(ctx, agent)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'continue with the plan' }], source: { kind: 'user' } }))
    await nextIdle

    expect(adapter.requests).toHaveLength(3)
    expect(adapter.requests[2]?.system).toContain(PLAN_CONFIG.section)
    expect(adapter.requests[2]?.tools).toEqual(adapter.requests[0]?.tools)
    /** 中文说明：变量 log 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const log = agent.session.events
    /** 中文说明：变量 planMode 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const planMode = findEvent(log, 'plan/mode')
    /** 中文说明：函数值 firstEnd 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const firstEnd = log.find(event => event.type === 'step/end'
      && event.data.turn === 1 && event.data.step === 1)
    /** 中文说明：函数值 nextStart 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const nextStart = log.find(event => event.type === 'step/start'
      && event.data.turn === 2 && event.data.step === 1)
    expect(firstEnd?.seq).toBeLessThan(planMode.seq)
    expect(planMode.seq).toBeLessThan(nextStart?.seq ?? 0)
    expect(findEvent(log, 'request/header', 'last').data.header.system).toContain(PLAN_CONFIG.section)
    /** 中文说明：函数值 notice 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const notice = log.find(event => event.type === 'user/message' && event.data.source.kind === 'plugin')
    expect(notice?.type === 'user/message' && notice.data.content).toEqual([
      { type: 'text', text: 'The user switched this session to plan mode.' },
    ])
  })
})
