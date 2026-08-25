/**
 * 文件职责：验证 integration.spec.ts 覆盖的工作流与 Worker Thread行为与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、Worker Thread、消息协议或领域实体。
 * 产品维度：保障 Agent 的工作流与 Worker Thread能力稳定、可隔离且可诊断。
 * 逻辑维度：准备配置和消息，建立运行环境，执行流程，再处理事件、错误与清理。
 * 关键边界：线程消息不可信；跨线程状态必须显式传递；终止时必须等待所拥有资源停止。
 * 新手阅读建议：先看协议和类型，再读 Host/Runtime 主流程，最后关注隔离、失败与清理。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage, CallId  } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import { STRUCTURED_OUTPUT_TOOL } from '@deepseek-ai/dsh-subagent-in-process-driver'
import * as spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import WorkerThreadWorkflowEngine from '@deepseek-ai/dsh-workflow-worker-thread'
import { MockAdapter, maxTokensResponse, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as toolRalph from '../src/index.ts'

/** 中文说明：type MockScript 定义本测试所需的数据或行为，用于表达工作流与 Worker Thread场景。 */
type MockScript = ConstructorParameters<typeof MockAdapter>[0]
/** 中文说明：变量 testToolSignal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const testToolSignal = new AbortController().signal

/** Mount the shipped Ralph execution stack around one keyless model script. */
/** 中文说明：函数 mountRalph 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function mountRalph(script: MockScript, config: toolRalph.Config) {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const adapter = new MockAdapter(script)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(spawn, { providerName: 'spawn' })
  await ctx.plugin(WorkerThreadWorkflowEngine, {})
  await ctx.plugin(toolRalph, config)
  ctx.llm.registerAdapter(['mock'], adapter)
  /** 中文说明：变量 parentHandle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const parentHandle = await ctx.agents.create({
    sessionId: SessionId('ralph-parent'),
    meta: { cwd: '/tmp/ralph-shared-workspace' },
    agentOptions: { provider: 'mock', model: 'mock' },
  })
  return { ctx, adapter, parentHandle, parent: parentHandle.agent }
}

describe('dsh-tool-ralph over the real spawn and worker-thread stack', () => {
  it('uses distinct empty-seed children, shared cwd, and only the prior bounded handoff', async () => {
    /** 中文说明：变量 firstReport 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const firstReport = {
      status: 'continue',
      summary: 'ROUND_ONE_HANDOFF',
      evidence: ['Created migration-a.ts.'],
      nextSteps: ['Finish migration-b.ts.'],
      blocker: '',
    }
    /** 中文说明：变量 finalReport 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const finalReport = {
      status: 'complete',
      summary: 'Both migration slices are complete.',
      evidence: ['Focused migration tests pass.'],
      nextSteps: [],
      blocker: '',
    }
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new MockAdapter([
      textResponse('PARENT_HISTORY_MARKER'),
      toolCallResponse('round-1', STRUCTURED_OUTPUT_TOOL, firstReport),
      toolCallResponse('round-2', STRUCTURED_OUTPUT_TOOL, finalReport),
    ])
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(spawn, { providerName: 'spawn' })
    await ctx.plugin(WorkerThreadWorkflowEngine, {})
    await ctx.plugin(toolRalph, { maxRounds: 2 })
    ctx.llm.registerAdapter(['mock'], adapter)

    /** 中文说明：变量 parentHandle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const parentHandle = await ctx.agents.create({
      sessionId: SessionId('ralph-parent'),
      meta: { cwd: '/tmp/ralph-shared-workspace' },
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    /** 中文说明：变量 parent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const parent = parentHandle.agent
    parent.followup(createUserMessage({ content: [{ type: 'text', text: 'PARENT_PROMPT_MARKER' }], source: { kind: 'user' } }))
    await parent.whenIdle()

    /** 中文说明：变量 children 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const children: Agent[] = []
    /** 中文说明：变量 phases 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const phases: string[] = []
    ctx.on('workflow/phase', (_run, title) => { phases.push(title) })
    ctx.on('workflow/agent-start', (_run, child) => {
      /** 中文说明：变量 agent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const agent = ctx.agents.get(child.childId)
      expect(agent).toBeDefined()
      children.push(agent!)
    })
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: CallId('ralph-integration'),
      name: 'ralph',
      arguments: { objective: 'Complete both migration slices.', maxRounds: 2 },
      agent: parent,
    })

    expect(result.isError).toBe(false)
    expect((result.content[0] as { text: string }).text)
      .toContain('Ralph worker reported completion after 2 rounds.')
    expect(phases).toEqual(['Fresh-agent rounds'])
    expect(children).toHaveLength(2)
    expect(new Set(children.map(child => child.id)).size).toBe(2)
    /** 中文说明：该循环依次处理消息或实体；循环变量仅在当前循环中有效。 */
    for (const child of children) {
      expect(child.session.header.cwd).toBe('/tmp/ralph-shared-workspace')
      expect(child.session.header.parentSession).toBe(parent.session.header.id)
      expect(child.session.header.seedLength).toBeUndefined()
      expect(ctx.agents.get(child.id)).toBeUndefined()
    }

    expect(adapter.requests).toHaveLength(3)
    /** 中文说明：变量 firstChildRequest 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const firstChildRequest = JSON.stringify(adapter.requests[1]!.messages)
    /** 中文说明：变量 secondChildRequest 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const secondChildRequest = JSON.stringify(adapter.requests[2]!.messages)
    expect(firstChildRequest).not.toContain('PARENT_PROMPT_MARKER')
    expect(firstChildRequest).not.toContain('PARENT_HISTORY_MARKER')
    expect(firstChildRequest).not.toContain('ROUND_ONE_HANDOFF')
    expect(secondChildRequest).not.toContain('PARENT_PROMPT_MARKER')
    expect(secondChildRequest).not.toContain('PARENT_HISTORY_MARKER')
    expect(secondChildRequest).toContain('ROUND_ONE_HANDOFF')

    await parentHandle.dispose()
  })

  it('reports the failed round and last good handoff when a child fails', async () => {
    /** 中文说明：变量 firstReport 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const firstReport = {
      status: 'continue',
      summary: 'ROUND_ONE_HANDOFF',
      evidence: ['Created migration-a.ts.'],
      nextSteps: ['Finish migration-b.ts.'],
      blocker: '',
    }
    const { ctx, parent, parentHandle } = await mountRalph([
      toolCallResponse('round-1', STRUCTURED_OUTPUT_TOOL, firstReport),
      maxTokensResponse('unfinished child output'),
    ], { maxRounds: 2 })
    /** 中文说明：变量 children 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const children: Agent[] = []
    ctx.on('workflow/agent-start', (_run, child) => {
      /** 中文说明：变量 agent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const agent = ctx.agents.get(child.childId)
      if (agent !== undefined) children.push(agent)
    })

    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: CallId('ralph-child-failure'),
      name: 'ralph',
      arguments: { objective: 'Complete both migration slices.', maxRounds: 2 },
      agent: parent,
    })

    expect(result.isError).toBe(true)
    /** 中文说明：变量 text 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const text = (result.content[0] as { text: string }).text
    expect(text).toContain('Ralph round 2 child failed before producing a structured report.')
    expect(text).toContain('Last successful handoff:')
    expect(text).toContain('ROUND_ONE_HANDOFF')
    expect(children).toHaveLength(2)
    /** 中文说明：该循环依次处理消息或实体；循环变量仅在当前循环中有效。 */
    for (const child of children) expect(ctx.agents.get(child.id)).toBeUndefined()
    await parentHandle.dispose()
  })

  it.each([
    {
      name: 'blocked',
      report: {
        status: 'blocked',
        summary: 'External authorization is required.',
        evidence: ['The local implementation is ready.'],
        nextSteps: ['Continue after authorization.'],
        blocker: 'The required external authorization is unavailable.',
      },
      config: { maxRounds: 2 },
      expectedError: false,
      expectedText: 'Ralph worker reported a blocker after 1 round.',
    },
    {
      name: 'budget-limited',
      report: {
        status: 'continue',
        summary: 'One slice is complete.',
        evidence: ['The first focused test passes.'],
        nextSteps: ['Implement the remaining slice.'],
        blocker: '',
      },
      config: { maxRounds: 1 },
      expectedError: false,
      expectedText: 'Ralph reached its 1 round limit; the worker reported work remaining.',
    },
    {
      name: 'unnormalized report',
      report: {
        status: 'continue',
        summary: ' padded summary ',
        evidence: ['A focused test passes.'],
        nextSteps: ['Continue implementation.'],
        blocker: '',
      },
      config: { maxRounds: 1 },
      expectedError: true,
      expectedText: 'summary must be non-empty and normalized',
    },
    {
      name: 'invalid continuing report',
      report: {
        status: 'continue',
        summary: 'Work remains.',
        evidence: ['A focused test passes.'],
        nextSteps: [],
        blocker: '',
      },
      config: { maxRounds: 1 },
      expectedError: true,
      expectedText: 'a continuing Ralph report needs nextSteps and an empty blocker',
    },
    {
      name: 'oversized report',
      report: {
        status: 'continue',
        summary: 'x'.repeat(300),
        evidence: ['A focused test passes.'],
        nextSteps: ['Continue implementation.'],
        blocker: '',
      },
      config: { maxRounds: 1, maxHandoffChars: 100 },
      expectedError: true,
      expectedText: 'Ralph round report exceeds maxHandoffChars',
    },
  ])('enforces the fixed script for $name', async ({ report, config, expectedError, expectedText }) => {
    const { ctx, parent, parentHandle } = await mountRalph([
      toolCallResponse('round-report', STRUCTURED_OUTPUT_TOOL, report),
    ], config)

    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: CallId('ralph-script-enforcement'),
      name: 'ralph',
      arguments: { objective: 'Complete the scoped work.', maxRounds: config.maxRounds },
      agent: parent,
    })

    expect(result.isError).toBe(expectedError)
    expect((result.content[0] as { text: string }).text).toContain(expectedText)
    await parentHandle.dispose()
  })

  it('cancels the real worker and fresh child to quiescence', { timeout: 20_000 }, async () => {
    const { ctx, parent, parentHandle } = await mountRalph(['hang'], { maxRounds: 2 })
    /** 中文说明：变量 children 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const children: Agent[] = []
    /** 中文说明：变量 outcomes 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const outcomes: string[] = []
    /** 中文说明：函数值 resolveChildStarted 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    let resolveChildStarted!: (child: Agent) => void
    /** 中文说明：函数值 childStarted 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const childStarted = new Promise<Agent>((resolve) => { resolveChildStarted = resolve })
    ctx.on('workflow/agent-start', (_run, child) => {
      /** 中文说明：变量 agent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const agent = ctx.agents.get(child.childId)
      if (agent !== undefined) {
        children.push(agent)
        resolveChildStarted(agent)
      }
    })
    ctx.on('workflow/agent-end', (_run, child) => { outcomes.push(child.outcome) })
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = ctx.tools.execute({
      callId: CallId('ralph-real-cancel'),
      name: 'ralph',
      arguments: { objective: 'Keep working until cancelled.', maxRounds: 2 },
      agent: parent,
      signal: controller.signal,
    })
    await childStarted

    controller.abort()
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await pending

    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain('Ralph workflow was cancelled')
    expect(outcomes).toEqual(['cancelled'])
    expect(ctx.agents.get(children[0]!.id)).toBeUndefined()
    await parentHandle.dispose()
  })
})
