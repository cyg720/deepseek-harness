/**
 * Exercises scheduler ordering and cancellation with deterministic gated tools.
 * ACP expected outputs own transcript-facing coverage.
 */
/**
 * 文件职责：验证Agent Loop的 tool-calls.spec.ts 行为与不变量。
 * 技术维度：Vitest、Cordis、会话事件、模型适配器和可控工具夹具。
 * 产品维度：防止Agent Loop在取消、恢复、错误或并发场景中产生回归。
 * 逻辑维度：构造服务与事件，驱动执行流程，再断言日志、请求、状态和清理。
 * 关键边界：测试后台任务必须结束；模型可见输入必须可从日志重建；工具调用顺序不可破坏。
 * 新手阅读建议：先读 mock/辅助函数，再按成功、错误、恢复和生命周期场景阅读。
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage, CallId, StreamChunk  } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import ToolRuntime, { defineContentToolFixture, TOOL_ABORTED_BEFORE_DISPATCH, TOOL_RUNTIME_SCHEDULER, type PostToolDecision, type PreToolDecision } from '@deepseek-ai/dsh-tools'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop, { DEFAULT_MAX_PARALLEL_TOOL_CALLS } from '@deepseek-ai/dsh-agent-loop'
import { MockAdapter, textResponse } from './mock-adapter.ts'
import { CodeRuntime } from '@deepseek-ai/dsh-code-runtime'
import type { CodeRunRequest, CodeRunResult } from '@deepseek-ai/dsh-code-runtime'

/** 中文说明：测试辅助函数 harness 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
async function harness(adapter: MockAdapter, maxParallelToolCalls?: number) {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, {
    agents: [],
    ...maxParallelToolCalls === undefined ? {} : { maxParallelToolCalls },
  })
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

/** 中文说明：测试辅助函数 waitForIdle 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    /** 中文说明：测试局部值 dispose，由紧邻初始化决定，仅在当前场景使用。 */
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') { dispose(); resolve() }
    })
  })
}

/** 中文说明：测试辅助函数 events 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
function events(agent: Agent): SessionEvent[] {
  return [...agent.session.events]
}

/** Build one assistant response containing the supplied tool calls. */
/** 中文说明：测试辅助函数 multiCall 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
function multiCall(calls: { id: string; name: string; args: object }[]): StreamChunk[] {
  /** 中文说明：测试局部值 chunks，由紧邻初始化决定，仅在当前场景使用。 */
  const chunks: StreamChunk[] = []
  calls.forEach((call, index) => {
    chunks.push(
      { type: 'block-start', index, blockType: 'tool-call' },
      { type: 'block-end', index, block: { type: 'tool-call', id: CallId(call.id), name: call.name, arguments: JSON.stringify(call.args) } },
    )
  })
  chunks.push(
    { type: 'usage', usage: { inputTokens: 5, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  )
  return chunks
}

/** A tool whose calls block until the test releases them by callId. */
/** 中文说明：测试辅助函数 gatedTool 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
function gatedTool(name: string, parallel: boolean) {
  /** 中文说明：测试局部值 gates，由紧邻初始化决定，仅在当前场景使用。 */
  const gates = new Map<string, () => void>()
  /** 中文说明：测试局部值 started，由紧邻初始化决定，仅在当前场景使用。 */
  const started: string[] = []
  /** 中文说明：测试局部值 tool，由紧邻初始化决定，仅在当前场景使用。 */
  const tool = defineContentToolFixture({
    name,
    description: `gated ${name}`,
    parameters: { id: { type: 'string', required: true } },
    ...parallel ? { isConcurrencySafe: () => true } : {},
    async execute(args) {
      started.push(args.id)
      await new Promise<void>((resolve) => { gates.set(args.id, resolve) })
      return [{ type: 'text', text: `done-${args.id}` }]
    },
  })
  return {
    tool,
    started,
    release(id: string) { gates.get(id)?.(); gates.delete(id) },
    pending() { return [...gates.keys()] },
  }
}

/** 中文说明：测试辅助函数 gatedParallelTool 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
function gatedParallelTool(name: string) {
  return gatedTool(name, true)
}

/** 中文说明：测试辅助函数 gatedExclusiveTool 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
function gatedExclusiveTool(name: string) {
  return gatedTool(name, false)
}

/** Poll until `predicate` holds, letting microtasks/timers drain between checks. */
/** 中文说明：测试辅助函数 until 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
async function until(predicate: () => boolean): Promise<void> {
  /** 中文说明：测试局部值 i，由紧邻初始化决定，仅在当前场景使用。 */
  for (let i = 0; i < 1000 && !predicate(); i++) await new Promise(r => setTimeout(r, 0))
  if (!predicate()) throw new Error('until: condition never held')
}

describe('tool-call scheduler: grouping and barriers', () => {
  it('runs parallel-safe siblings concurrently (all start before any completes)', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([
      multiCall([{ id: 'c1', name: 'p', args: { id: '1' } }, { id: 'c2', name: 'p', args: { id: '2' } }, { id: 'c3', name: 'p', args: { id: '3' } }]),
      textResponse('done'),
    ])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 gated，由紧邻初始化决定，仅在当前场景使用。 */
    const gated = gatedParallelTool('p')
    ctx.tools.register(gated.tool)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await until(() => gated.started.length === 3)
    expect(gated.started).toEqual(['1', '2', '3'])
    gated.release('1'); gated.release('2'); gated.release('3')
    await waitForIdle(ctx, agent)
  })

  it('an exclusive call between two parallel-safe calls forms a barrier (3 groups)', async () => {
    /** 中文说明：测试局部值 order，由紧邻初始化决定，仅在当前场景使用。 */
    const order: string[] = []
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([
      multiCall([
        { id: 'c1', name: 'r', args: { id: 'A1' } },
        { id: 'c2', name: 'w', args: { id: 'A2' } },
        { id: 'c3', name: 'r', args: { id: 'A3' } },
      ]),
      textResponse('done'),
    ])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    ctx.tools.register(defineContentToolFixture({
      name: 'r', description: 'read', parameters: { id: { type: 'string', required: true } },
      isConcurrencySafe: () => true,
      async execute(args) { order.push(`r-start-${args.id}`); order.push(`r-end-${args.id}`); return [{ type: 'text', text: 'r' }] },
    }))
    ctx.tools.register(defineContentToolFixture({
      name: 'w', description: 'write', parameters: { id: { type: 'string', required: true } },
      async execute(args) { order.push(`w-${args.id}`); return [{ type: 'text', text: 'w' }] },
    }))
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(order).toEqual(['r-start-A1', 'r-end-A1', 'w-A2', 'r-start-A3', 'r-end-A3'])
  })

  it('reclassifies pending calls after an exclusive barrier replaces their tool', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([
      multiCall([
        { id: 'c1', name: 'replace', args: { id: '0' } },
        { id: 'c2', name: 'x', args: { id: '1' } },
        { id: 'c3', name: 'x', args: { id: '2' } },
      ]),
      textResponse('done'),
    ])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 replacement，由紧邻初始化决定，仅在当前场景使用。 */
    const replacement = gatedExclusiveTool('x')
    /** 中文说明：测试局部值 disposeSafe，由紧邻初始化决定，仅在当前场景使用。 */
    const disposeSafe = ctx.tools.register(defineContentToolFixture({
      name: 'x',
      description: 'initially safe',
      parameters: { id: { type: 'string', required: true } },
      isConcurrencySafe: () => true,
      async execute(args) { return [{ type: 'text', text: `old-${args.id}` }] },
    }))
    ctx.tools.register(defineContentToolFixture({
      name: 'replace',
      description: 'replace x',
      parameters: { id: { type: 'string', required: true } },
      async execute() {
        disposeSafe()
        ctx.tools.register(replacement.tool)
        return [{ type: 'text', text: 'replaced' }]
      },
    }))
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await until(() => replacement.started.length === 1)
    await new Promise(r => setTimeout(r, 5))
    expect(replacement.started).toEqual(['1'])
    replacement.release('1')
    await until(() => replacement.started.length === 2)
    expect(replacement.started).toEqual(['1', '2'])
    replacement.release('2')
    await waitForIdle(ctx, agent)
  })

  it('stops replenishing when a result observer makes the next call exclusive', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([
      multiCall([
        { id: 'c1', name: 'x', args: { id: '1' } },
        { id: 'c2', name: 'x', args: { id: '2' } },
        { id: 'c3', name: 'x', args: { id: '3' } },
      ]),
      textResponse('done'),
    ])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter, 2)
    /** 中文说明：测试局部值 initial，由紧邻初始化决定，仅在当前场景使用。 */
    const initial = gatedParallelTool('x')
    /** 中文说明：测试局部值 replacement，由紧邻初始化决定，仅在当前场景使用。 */
    const replacement = gatedExclusiveTool('x')
    /** 中文说明：测试局部值 disposeInitial，由紧邻初始化决定，仅在当前场景使用。 */
    const disposeInitial = ctx.tools.register(initial.tool)
    ctx.on('tools/result', (exec) => {
      if (exec.callId !== CallId('c1')) return
      disposeInitial()
      ctx.tools.register(replacement.tool)
    })
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await until(() => initial.started.length === 2)
    initial.release('1')
    await until(() => events(agent).some(event =>
      event.type === 'tool/result' && event.data.message.source.callId === CallId('c1')))
    await new Promise(r => setTimeout(r, 5))
    expect(replacement.started).toEqual([])
    initial.release('2')
    await until(() => replacement.started.length === 1)
    expect(replacement.started).toEqual(['3'])
    replacement.release('3')
    await waitForIdle(ctx, agent)
  })
})

describe('tool-call scheduler: model-order results despite out-of-order settlement', () => {
  it('commits tool/result in model order even when a later call settles first', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([
      multiCall([{ id: 'c1', name: 'p', args: { id: '1' } }, { id: 'c2', name: 'p', args: { id: '2' } }]),
      textResponse('done'),
    ])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 gated，由紧邻初始化决定，仅在当前场景使用。 */
    const gated = gatedParallelTool('p')
    ctx.tools.register(gated.tool)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await until(() => gated.started.length === 2)
    gated.release('2')
    await new Promise(r => setTimeout(r, 5))
    /** 中文说明：测试局部值 beforeFirst，由紧邻初始化决定，仅在当前场景使用。 */
    const beforeFirst = events(agent).filter(e => e.type === 'tool/result')
    expect(beforeFirst).toEqual([])
    gated.release('1')
    await waitForIdle(ctx, agent)

    /** 中文说明：测试局部值 results，由紧邻初始化决定，仅在当前场景使用。 */
    const results = events(agent).filter(e => e.type === 'tool/result')
    expect(results.map(e => e.data.message.source.callId)).toEqual([CallId('c1'), CallId('c2')])
  })

  it('derived history pairs calls in model order regardless of tool/call log interleaving', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([
      multiCall([{ id: 'c1', name: 'p', args: { id: '1' } }, { id: 'c2', name: 'p', args: { id: '2' } }]),
      textResponse('done'),
    ])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 gated，由紧邻初始化决定，仅在当前场景使用。 */
    const gated = gatedParallelTool('p')
    ctx.tools.register(gated.tool)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await until(() => gated.started.length === 2)
    gated.release('2'); gated.release('1')
    await waitForIdle(ctx, agent)

    /** 中文说明：测试局部值 messages，由紧邻初始化决定，仅在当前场景使用。 */
    const messages = agent.session.deriveMessages()
    /** 中文说明：测试局部值 toolResults，由紧邻初始化决定，仅在当前场景使用。 */
    const toolResults = messages.flatMap(m => m.content.filter(b => b.type === 'tool-result'))
    expect(toolResults.map(b => b.toolCallId)).toEqual([CallId('c1'), CallId('c2')])
  })
})

describe('tool-call scheduler: rolling pool honors maxParallelToolCalls', () => {
  it('rejects invalid global maxParallelToolCalls config at plugin load', async () => {
    await expect(harness(new MockAdapter([]), 0)).rejects.toThrow()
    await expect(harness(new MockAdapter([]), 1.5)).rejects.toThrow()
  })

  it('defensively rejects invalid caps when direct construction bypasses the config schema', () => {
    expect(() => new AgentLoop(new Context(), { agents: [], maxParallelToolCalls: 0 }))
      .toThrow('maxParallelToolCalls must be a positive integer')
    expect(() => new AgentLoop(new Context(), { agents: [], maxParallelToolCalls: 1.5 }))
      .toThrow('maxParallelToolCalls must be a positive integer')
  })

  it('defaults the cap when direct construction bypasses the config schema', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt, { persona: '' })
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)

    /** 中文说明：测试局部值 loop，由紧邻初始化决定，仅在当前场景使用。 */
    const loop = new AgentLoop(ctx, { agents: [] })
    expect(loop.config.maxParallelToolCalls).toBe(DEFAULT_MAX_PARALLEL_TOOL_CALLS)
    await ctx.fiber.dispose()
  })

  it('starts at most the cap, replenishing as calls settle', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([
      multiCall([1, 2, 3, 4].map(n => ({ id: `c${n}`, name: 'p', args: { id: String(n) } }))),
      textResponse('done'),
    ])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter, 2)
    /** 中文说明：测试局部值 gated，由紧邻初始化决定，仅在当前场景使用。 */
    const gated = gatedParallelTool('p')
    ctx.tools.register(gated.tool)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await until(() => gated.started.length === 2)
    await new Promise(r => setTimeout(r, 5))
    expect(gated.started).toEqual(['1', '2'])
    gated.release('1')
    await until(() => gated.started.length === 3)
    expect(gated.started).toEqual(['1', '2', '3'])
    expect(events(agent)
      .filter(e => e.type === 'tool/call' || e.type === 'tool/result')
      .map(e => e.type === 'tool/call'
        ? `${e.type}:${String(e.data.callId)}`
        : `${e.type}:${String(e.data.message.source.callId)}`)
      .slice(0, 4))
      .toEqual(['tool/call:c1', 'tool/call:c2', 'tool/result:c1', 'tool/call:c3'])
    gated.release('2'); gated.release('3')
    await until(() => gated.started.length === 4)
    gated.release('4')
    await waitForIdle(ctx, agent)
    expect(events(agent).filter(e => e.type === 'tool/result').map(e => e.data.message.source.callId))
      .toEqual([CallId('c1'), CallId('c2'), CallId('c3'), CallId('c4')])
  })

  it('maxParallelToolCalls: 1 is fully serial (no second start before the first settles)', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([
      multiCall([{ id: 'c1', name: 'p', args: { id: '1' } }, { id: 'c2', name: 'p', args: { id: '2' } }]),
      textResponse('done'),
    ])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter, 1)
    /** 中文说明：测试局部值 gated，由紧邻初始化决定，仅在当前场景使用。 */
    const gated = gatedParallelTool('p')
    ctx.tools.register(gated.tool)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await until(() => gated.started.length === 1)
    await new Promise(r => setTimeout(r, 5))
    expect(gated.started).toEqual(['1'])
    gated.release('1')
    await until(() => gated.started.length === 2)
    gated.release('2')
    await waitForIdle(ctx, agent)
  })

  it('applies the configured cap to every factory-created agent', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([
      multiCall([{ id: 'c1', name: 'p', args: { id: '1' } }, { id: 'c2', name: 'p', args: { id: '2' } }]),
      textResponse('done'),
    ])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt, { persona: '' })
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 1 })
    ctx.llm.registerAdapter(['mock'], adapter)
    /** 中文说明：测试局部值 gated，由紧邻初始化决定，仅在当前场景使用。 */
    const gated = gatedParallelTool('p')
    ctx.tools.register(gated.tool)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await until(() => gated.started.length === 1)
    await new Promise(r => setTimeout(r, 5))
    expect(gated.started).toEqual(['1'])
    gated.release('1')
    await until(() => gated.started.length === 2)
    gated.release('2')
    await waitForIdle(ctx, agent)
  })

})

describe('tool-call scheduler: ordered middleware and additional contexts', () => {
  it('tools/pre-execute and tools/post-execute observe model call order', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([
      multiCall([{ id: 'c1', name: 'p', args: { id: '1' } }, { id: 'c2', name: 'p', args: { id: '2' } }, { id: 'c3', name: 'p', args: { id: '3' } }]),
      textResponse('done'),
    ])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 gated，由紧邻初始化决定，仅在当前场景使用。 */
    const gated = gatedParallelTool('p')
    ctx.tools.register(gated.tool)
    /** 中文说明：测试局部值 pre，由紧邻初始化决定，仅在当前场景使用。 */
    const pre: string[] = []
    /** 中文说明：测试局部值 post，由紧邻初始化决定，仅在当前场景使用。 */
    const post: string[] = []
    ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => { pre.push(String(exec.callId)); return next() })
    ctx.on('tools/post-execute', async (exec, _result, next): Promise<PostToolDecision> => { post.push(String(exec.callId)); return next() })
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await until(() => gated.started.length === 3)
    gated.release('3'); gated.release('2'); gated.release('1')
    await waitForIdle(ctx, agent)

    expect(pre).toEqual([CallId('c1'), CallId('c2'), CallId('c3')].map(String))
    expect(post).toEqual([CallId('c1'), CallId('c2'), CallId('c3')].map(String))
  })

  it('injects additional contexts in model call order, not settlement order', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([
      multiCall([{ id: 'c1', name: 'p', args: { id: '1' } }, { id: 'c2', name: 'p', args: { id: '2' } }]),
      textResponse('done'),
    ])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter, 2)
    /** 中文说明：测试局部值 gated，由紧邻初始化决定，仅在当前场景使用。 */
    const gated = gatedParallelTool('p')
    ctx.tools.register(gated.tool)
    ctx.on('tools/post-execute', async (exec, _result): Promise<PostToolDecision> =>
      ({ kind: 'accept', additionalContexts: [createUserMessage({
        content: [{ type: 'text', text: `ctx-${exec.callId}` }], source: { kind: 'plugin', plugin: 'p' },
      })] }))
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await until(() => gated.started.length === 2)
    gated.release('2'); gated.release('1')
    await waitForIdle(ctx, agent)

    /** 中文说明：测试局部值 log，由紧邻初始化决定，仅在当前场景使用。 */
    const log = events(agent)
    /** 中文说明：测试局部值 contextTexts，由紧邻初始化决定，仅在当前场景使用。 */
    const contextTexts = log.filter(e => e.type === 'user/message' && e.data.source.kind === 'plugin')
      .map(e => ((e.data as { content: { text: string }[] }).content[0]!).text)
    expect(contextTexts).toEqual(['ctx-c1', 'ctx-c2'])
    /** 中文说明：测试局部值 lastResult，由紧邻初始化决定，仅在当前场景使用。 */
    const lastResult = log.findLastIndex(e => e.type === 'tool/result')
    /** 中文说明：测试局部值 firstContext，由紧邻初始化决定，仅在当前场景使用。 */
    const firstContext = log.findIndex(e => e.type === 'user/message' && e.data.source.kind === 'plugin')
    expect(lastResult).toBeLessThan(firstContext)
  })

  it('orders pre-execute denials and errors without dispatching them', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([
      multiCall([
        { id: 'c1', name: 'p', args: { id: '1' } },
        { id: 'c2', name: 'p', args: { id: '2' } },
        { id: 'c3', name: 'p', args: { id: '3' } },
      ]),
      textResponse('done'),
    ])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 gated，由紧邻初始化决定，仅在当前场景使用。 */
    const gated = gatedParallelTool('p')
    ctx.tools.register(gated.tool)
    /** 中文说明：测试局部值 post，由紧邻初始化决定，仅在当前场景使用。 */
    const post: string[] = []
    ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
      if (exec.callId === CallId('c2')) return { kind: 'deny', reason: 'blocked by policy' }
      if (exec.callId === CallId('c3')) throw new Error('pre exploded')
      return next()
    })
    ctx.on('tools/post-execute', async (exec, _result, next): Promise<PostToolDecision> => {
      post.push(String(exec.callId))
      return next()
    })
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await until(() => gated.started.length === 1)
    gated.release('1')
    await waitForIdle(ctx, agent)

    expect(gated.started).toEqual(['1'])
    expect(post).toEqual(['c1', 'c2'])
    /** 中文说明：测试局部值 results，由紧邻初始化决定，仅在当前场景使用。 */
    const results = events(agent).filter(e => e.type === 'tool/result')
    expect(results.map(e => e.data.message.source.callId)).toEqual([CallId('c1'), CallId('c2'), CallId('c3')])
    expect((results[1]!.data.message.content[0].content[0] as { text: string }).text).toContain('blocked by policy')
    expect((results[2]!.data.message.content[0].content[0] as { text: string }).text).toContain('pre exploded')
  })
})

describe('tool-call scheduler: abort handling', () => {
  it('starts no calls when the signal is already aborted before a parallel group', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([
      multiCall([{ id: 'c1', name: 'p', args: { id: '1' } }, { id: 'c2', name: 'p', args: { id: '2' } }]),
      textResponse('should never be requested'),
    ])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 gated，由紧邻初始化决定，仅在当前场景使用。 */
    const gated = gatedParallelTool('p')
    ctx.tools.register(gated.tool)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    ctx.on('session/event', (session, event) => {
      if (session === agent.session && event.type === 'assistant/message') {
        agent.cancel({ kind: 'user' })
      }
    })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(gated.started).toEqual([])
    expect(events(agent).filter(e => e.type === 'tool/call').map(e => e.data.callId))
      .toEqual([CallId('c1'), CallId('c2')])
    expect(events(agent).filter(e => e.type === 'tool/result').map(e => ({
      callId: e.data.message.source.callId,
      isError: e.data.message.content[0].isError,
      error: e.data.error,
    }))).toEqual([
      { callId: CallId('c1'), isError: true, error: { name: 'AbortError', code: TOOL_ABORTED_BEFORE_DISPATCH } },
      { callId: CallId('c2'), isError: true, error: { name: 'AbortError', code: TOOL_ABORTED_BEFORE_DISPATCH } },
    ])
  })

  it('skips dispatch and stops starting siblings when abort fires during ordered pre-execute', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([
      multiCall([{ id: 'c1', name: 'p', args: { id: '1' } }, { id: 'c2', name: 'p', args: { id: '2' } }]),
      textResponse('should never be requested'),
    ])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter)
    /** 中文说明：测试局部值 gated，由紧邻初始化决定，仅在当前场景使用。 */
    const gated = gatedParallelTool('p')
    ctx.tools.register(gated.tool)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
      if (exec.callId === CallId('c1')) {
        agent.cancel({ kind: 'user' })
      }
      return next()
    })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(gated.started).toEqual([])
    expect(events(agent).filter(e => e.type === 'tool/call').map(e => e.data.callId))
      .toEqual([CallId('c1'), CallId('c2')])
    expect(events(agent).filter(e => e.type === 'tool/result').map(e => ({
      callId: e.data.message.source.callId,
      isError: e.data.message.content[0].isError,
      error: e.data.error,
    }))).toEqual([
      { callId: CallId('c1'), isError: true, error: { name: 'AbortError', code: TOOL_ABORTED_BEFORE_DISPATCH } },
      { callId: CallId('c2'), isError: true, error: { name: 'AbortError', code: TOOL_ABORTED_BEFORE_DISPATCH } },
    ])
  })

  it('stops replenishing after abort, commits started results, and parks accepted additional contexts', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([
      multiCall([1, 2, 3, 4].map(n => ({ id: `c${n}`, name: 'p', args: { id: String(n) } }))),
      textResponse('after wake'),
    ])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter, 2)
    /** 中文说明：测试局部值 gated，由紧邻初始化决定，仅在当前场景使用。 */
    const gated = gatedParallelTool('p')
    ctx.tools.register(gated.tool)
    ctx.on('tools/post-execute', async (exec, _result, next): Promise<PostToolDecision> => ({
      ...await next(),
      additionalContexts: [createUserMessage({
        content: [{ type: 'text', text: `ctx-${exec.callId}` }], source: { kind: 'plugin', plugin: 'p' },
      })],
    }))
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await until(() => gated.started.length === 2)
    agent.cancel({ kind: 'user' })
    gated.release('1')
    gated.release('2')
    await waitForIdle(ctx, agent)

    expect(gated.started).toEqual(['1', '2'])
    expect(events(agent).filter(e => e.type === 'tool/call').map(e => e.data.callId))
      .toEqual([CallId('c1'), CallId('c2'), CallId('c3'), CallId('c4')])
    expect(events(agent).filter(e => e.type === 'tool/result').map(e => e.data.message.source.callId))
      .toEqual([CallId('c1'), CallId('c2'), CallId('c3'), CallId('c4')])
    expect(events(agent).filter(e => e.type === 'tool/result').slice(-2).map(e => ({
      callId: e.data.message.source.callId,
      isError: e.data.message.content[0].isError,
      error: e.data.error,
    })))
      .toEqual([
        {
          callId: CallId('c3'),
          isError: true,
          error: { name: 'AbortError', code: TOOL_ABORTED_BEFORE_DISPATCH },
        },
        {
          callId: CallId('c4'),
          isError: true,
          error: { name: 'AbortError', code: TOOL_ABORTED_BEFORE_DISPATCH },
        },
      ])
    /** 中文说明：测试局部值 settled，由紧邻初始化决定，仅在当前场景使用。 */
    const settled = events(agent).filter(e => e.type === 'tool/result'
      || (e.type === 'user/message' && e.data.source.kind === 'plugin'))
    expect(settled.map(e => e.type))
      .toEqual(['tool/result', 'tool/result', 'tool/result', 'tool/result'])
    expect(agent.inbox.nextStep.map(message => message.content[0]))
      .toEqual([
        { type: 'text', text: 'ctx-c1' },
        { type: 'text', text: 'ctx-c2' },
      ])

    /** 中文说明：测试局部值 idle，由紧邻初始化决定，仅在当前场景使用。 */
    const idle = waitForIdle(ctx, agent)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'wake' }], source: { kind: 'user' } }))
    await idle

    expect(events(agent).flatMap(e =>
      e.type === 'user/message'
        && e.data.source.kind === 'plugin'
        && e.data.content[0]?.type === 'text'
        ? [e.data.content[0].text]
        : []))
      .toEqual(['ctx-c1', 'ctx-c2'])
  })

  it('does not run an exclusive barrier after a parallel group aborts', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([
      multiCall([
        { id: 'c1', name: 'p', args: { id: '1' } },
        { id: 'c2', name: 'p', args: { id: '2' } },
        { id: 'c3', name: 'x', args: { id: '3' } },
      ]),
      textResponse('should never be requested'),
    ])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter, 2)
    /** 中文说明：测试局部值 gated，由紧邻初始化决定，仅在当前场景使用。 */
    const gated = gatedParallelTool('p')
    /** 中文说明：测试局部值 exclusive，由紧邻初始化决定，仅在当前场景使用。 */
    const exclusive: string[] = []
    ctx.tools.register(gated.tool)
    ctx.tools.register(defineContentToolFixture({
      name: 'x',
      description: 'exclusive',
      parameters: { id: { type: 'string', required: true } },
      async execute(args) { exclusive.push(args.id); return [{ type: 'text', text: 'x' }] },
    }))
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await until(() => gated.started.length === 2)
    agent.cancel({ kind: 'user' })
    gated.release('1')
    gated.release('2')
    await waitForIdle(ctx, agent)

    expect(exclusive).toEqual([])
    expect(events(agent).filter(e => e.type === 'tool/call').map(e => e.data.callId))
      .toEqual([CallId('c1'), CallId('c2'), CallId('c3')])
    expect(events(agent).filter(e => e.type === 'tool/result').at(-1)?.data)
      .toMatchObject({
        message: {
          source: { kind: 'tool', callId: CallId('c3') },
          content: [{ isError: true }],
        },
        error: { name: 'AbortError', code: TOOL_ABORTED_BEFORE_DISPATCH },
      })
  })
})

describe('tool-call scheduler: failure quiescence', () => {
  it('stops new dispatches and drains started bodies before surfacing the first failure', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([
      multiCall([
        { id: 'c1', name: 'p', args: { id: '1' } },
        { id: 'c2', name: 'p', args: { id: '2' } },
        { id: 'c3', name: 'p', args: { id: '3' } },
      ]),
    ])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await harness(adapter, 3)
    /** 中文说明：测试局部值 gated，由紧邻初始化决定，仅在当前场景使用。 */
    const gated = gatedParallelTool('p')
    ctx.tools.register(gated.tool)
    // The registry contains expected failures as results; replace its internal
    // view only to inject the invariant violation this boundary must contain.
    /** 中文说明：测试局部值 scheduler，由紧邻初始化决定，仅在当前场景使用。 */
    const scheduler = ctx.tools[TOOL_RUNTIME_SCHEDULER]
    /** 中文说明：测试局部值 prepare，由紧邻初始化决定，仅在当前场景使用。 */
    const prepare = scheduler.prepare.bind(scheduler)
    /** 中文说明：测试局部值 dispatch，由紧邻初始化决定，仅在当前场景使用。 */
    const dispatch = scheduler.dispatch.bind(scheduler)
    /** 中文说明：测试局部值 prepareGate，由紧邻初始化决定，仅在当前场景使用。 */
    const prepareGate = Promise.withResolvers<undefined>()
    /** 中文说明：测试局部值 thirdPrepareEntered，由紧邻初始化决定，仅在当前场景使用。 */
    let thirdPrepareEntered = false
    scheduler.prepare = async (exec) => {
      /** 中文说明：测试局部值 prepared，由紧邻初始化决定，仅在当前场景使用。 */
      const prepared = await prepare(exec)
      if (exec.callId === CallId('c3')) {
        thirdPrepareEntered = true
        await prepareGate.promise
      }
      return prepared
    }
    /** 中文说明：测试局部值 schedulerError，由紧邻初始化决定，仅在当前场景使用。 */
    const schedulerError = new Error('scheduler exploded')
    /** 中文说明：测试局部值 drainedError，由紧邻初始化决定，仅在当前场景使用。 */
    const drainedError = new Error('sibling failed while draining')
    /** 中文说明：测试局部值 rejectFirst，由紧邻初始化决定，仅在当前场景使用。 */
    let rejectFirst: ((error: Error) => void) | undefined
    scheduler.dispatch = exec => exec.callId === CallId('c1')
      ? new Promise((_resolve, reject) => { rejectFirst = reject })
      : dispatch(exec).then(() => { throw drainedError })
    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('scheduler-failure'), { provider: 'mock', model: 'mock' })
    /** 中文说明：测试局部值 idle，由紧邻初始化决定，仅在当前场景使用。 */
    let idle = false
    /** 中文说明：测试局部值 idlePromise，由紧邻初始化决定，仅在当前场景使用。 */
    const idlePromise = waitForIdle(ctx, agent).then(() => { idle = true })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await until(() => gated.started.includes('2') && thirdPrepareEntered && rejectFirst !== undefined)
    rejectFirst?.(schedulerError)
    await new Promise<void>(resolve => setImmediate(resolve))
    prepareGate.resolve(undefined)
    await new Promise<void>(resolve => setImmediate(resolve))

    /** 中文说明：测试局部值 startedBeforeDrain，由紧邻初始化决定，仅在当前场景使用。 */
    const startedBeforeDrain = [...gated.started]
    /** 中文说明：测试局部值 idleBeforeDrain，由紧邻初始化决定，仅在当前场景使用。 */
    const idleBeforeDrain = idle
    /** 中文说明：测试局部值 turnEndBeforeDrain，由紧邻初始化决定，仅在当前场景使用。 */
    const turnEndBeforeDrain = events(agent).find(event => event.type === 'turn/end')
    /** 中文说明：测试局部值 id，由紧邻初始化决定，仅在当前场景使用。 */
    for (const id of gated.pending()) gated.release(id)
    await idlePromise

    expect(startedBeforeDrain).toEqual(['2'])
    expect(idleBeforeDrain).toBe(false)
    expect(turnEndBeforeDrain).toBeUndefined()
    expect(gated.pending()).toEqual([])
    expect(events(agent).findLast(event => event.type === 'turn/end')).toMatchObject({
      data: { reason: { kind: 'error', error: { message: schedulerError.message, code: 'UNKNOWN' } } },
    })
  })
})

describe('code-mode native-tool denial through the agent loop', () => {
  /** A minimal in-process code runtime for test purposes — never actually runs. */
  /** 中文说明：测试类型或类 FakeCodeRuntime 约束夹具数据和行为。 */
  class FakeCodeRuntime extends CodeRuntime {
    readonly language = 'typescript'
    readonly isolation = 'fake' as const
    async run(_request: CodeRunRequest): Promise<CodeRunResult> {
      return { logs: [] }
    }
  }

  /** 中文说明：测试辅助函数 codeModeHarness 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
  async function codeModeHarness(adapter: MockAdapter) {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt, { persona: '' })
    await ctx.plugin(ToolRuntime, { mode: 'code' })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- FakeCodeRuntime is an internal test helper with an opaque type shape
    await ctx.plugin(FakeCodeRuntime as any)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })
    ctx.llm.registerAdapter(['mock'], adapter)
    return ctx
  }

  it('denies a model-direct native-tool call under code mode: tool body never runs and session records UNKNOWN_TOOL', async () => {
    /** 中文说明：测试局部值 toolInvoked，由紧邻初始化决定，仅在当前场景使用。 */
    let toolInvoked = false
    /** 中文说明：测试局部值 tool，由紧邻初始化决定，仅在当前场景使用。 */
    const tool = defineContentToolFixture({
      name: 'write',
      description: 'Write a file.',
      parameters: {
        file_path: { type: 'string', required: true },
        content: { type: 'string', required: true },
      },
      async execute(_args, _exec) {
        toolInvoked = true
        return [{ type: 'text', text: 'written' }]
      },
    })

    // Scripted model emits a native tool call under code mode — the wire
    // never advertised it, but a non-compliant provider may still emit one.
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([
      [
        ...multiCall([{ id: 'call-1', name: 'write', args: { file_path: '/tmp/test', content: 'hello' } }]),
        ...textResponse('ok'),
      ],
    ])

    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await codeModeHarness(adapter)
    ctx.tools.register(tool)

    /** 中文说明：测试局部值 agent，由紧邻初始化决定，仅在当前场景使用。 */
    const agent = ctx.agentLoop.create(SessionId('code-native'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'write a file' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    // The tool body must NOT have executed — the collapse denied the call
    // at createExecution, before the body could start.
    expect(toolInvoked).toBe(false)

    // The session must record a tool/result with UNKNOWN_TOOL error so the
    // transcript faithfully captures that the call was denied.
    /** 中文说明：测试局部值 sessionEvents，由紧邻初始化决定，仅在当前场景使用。 */
    const sessionEvents = events(agent)
    /** 中文说明：测试局部值 toolResult，由紧邻初始化决定，仅在当前场景使用。 */
    const toolResult = sessionEvents.find(e => e.type === 'tool/result')
    expect(toolResult).toBeDefined()
    expect(toolResult!.data.error).toMatchObject({
      name: 'ToolNotFoundError',
      code: 'UNKNOWN_TOOL',
    })
  })
})
