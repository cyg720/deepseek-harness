/**
 * 文件职责：验证上下文压缩的 compaction-loop-repro.spec.ts 行为。
 * 技术维度：Vitest、会话事件、模型请求夹具和 Cordis 组装。
 * 产品维度：防止上下文压缩改变模型可见内容或生命周期语义。
 * 逻辑维度：构造日志与配置，运行插件并断言事件、请求和清理。
 * 关键边界：模型可见内容必须可重建；工具调用和结果必须保持配对。
 * 新手阅读建议：先读事件夹具，再按正常、边界和失败场景阅读。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { toolPairingBalancedAfter, toolPairingBalancedBefore } from '@deepseek-ai/dsh-compaction'
import { createUserMessage, CONTEXT_WINDOW_EXCEEDED_CODE, LlmError, resolveRetryPolicy , createMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, LlmResolvedModelInfo, ResolvedRetryPolicy, StreamChunk } from '@deepseek-ai/dsh-llm'
import { ToolCallId, LlmAdapter } from '@deepseek-ai/dsh-llm'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as SessionInvariant from '@deepseek-ai/dsh-session/invariant'
import * as AgentInvariant from '@deepseek-ai/dsh-agent/invariant'
import * as AgentLoopInvariant from '@deepseek-ai/dsh-agent-loop/invariant'
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import * as LlmRetry from '@deepseek-ai/dsh-llm-retry'
import { Session, SessionId, type SessionEvent, type SurfaceEvent } from '@deepseek-ai/dsh-session'

/**
 * CBR-001 regression through the real loop. A replacement checkpoint has a high
 * log seq at the surface head and carries no tool pair, so both adjacent cuts
 * must be safe and re-compacting that checkpoint alone must succeed. This pins
 * surface-position semantics rather than raw-log scanning.
 */

/* 中文说明：类型或类 ReproCompactionEngine 约束上下文或压缩数据职责。 */
class ReproCompactionEngine extends BasicCompactionEngine {
  override async summarize(): Promise<{ summary: ContentBlock[]; provider: string; model: string }> {
    return {
      summary: [{ type: 'text', text: 'CHECKPOINT SUMMARY' }],
      provider: 'mock',
      model: 'stub',
    }
  }
}

/** Each call emits one tool-call until exhausted, then a final text answer. */
/* 中文说明：类型或类 StepwiseToolAdapter 约束上下文或压缩数据职责。 */
class StepwiseToolAdapter extends LlmAdapter {
  calls = 0
  constructor(private toolSteps: number) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      context: { contextWindow: 400 },
    })
  }

  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    /** 中文说明：测试局部值 n，由紧邻初始化决定。 */
    const n = this.calls
    this.calls += 1
    if (n < this.toolSteps) {
      const id = ToolCallId(`c${n}`)
      const args = `{"i":${n}}`
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: `step ${n}` } }
      yield { type: 'block-start', index: 1, blockType: 'tool-call' }
      yield { type: 'block-end', index: 1, block: { type: 'tool-call', id, name: 'work', arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'all done' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** First conversation request overflows, then the rebuilt retry succeeds. */
/* 中文说明：类型或类 OverflowRecoveryAdapter 约束上下文或压缩数据职责。 */
class OverflowRecoveryAdapter extends LlmAdapter {
  readonly conversationRequests: GenerateOptions[] = []
  readonly summaryRequests: GenerateOptions[] = []
  private readonly retryPolicy = resolveRetryPolicy({
    mode: 'normal',
    maxRetries: 1,
    backoff: { initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 },
  }, 'compaction test provider retryPolicy')

  constructor(
    private readonly delivery: 'thrown' | 'in-band',
    private readonly transientAfterOverflow = false,
  ) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      context: { contextWindow: 128 },
    })
  }

  override providerRetryPolicy(_provider: string): ResolvedRetryPolicy {
    return this.retryPolicy
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    // The cache-reusing summarizer replays the conversation prefix and marks
    // its call only by the compaction instruction in the trailing user message.
    /** 中文说明：测试局部值 trailing，由紧邻初始化决定。 */
    const trailing = options.messages.at(-1)?.content
      .map(block => (block.type === 'text' ? block.text : ''))
      .join('') ?? ''
    if (trailing.includes('acting as a compaction engine')) {
      this.summaryRequests.push(options)
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'RECOVERY CHECKPOINT' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }

    this.conversationRequests.push(options)
    if (this.conversationRequests.length === 1) {
      if (this.delivery === 'thrown') {
        throw new LlmError('request too large for model context', CONTEXT_WINDOW_EXCEEDED_CODE)
      }
      yield {
        type: 'finish',
        reason: {
          kind: 'error',
          failure: {
            message: 'request too large for model context',
            code: CONTEXT_WINDOW_EXCEEDED_CODE,
          },
        },
      }
      return
    }
    if (this.transientAfterOverflow && this.conversationRequests.length === 2) {
      throw new LlmError('temporary provider outage', 'SERVER')
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'recovered' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** 中文说明：函数 mountInvariants 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function mountInvariants(ctx: Context): Promise<void> {
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(SessionInvariant)
  await ctx.plugin(AgentInvariant)
  await ctx.plugin(AgentLoopInvariant)
}

/** 中文说明：函数 harness 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function harness(toolSteps: number): Promise<{ ctx: Context; compact: ReproCompactionEngine }> {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await mountInvariants(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(TokenMeter)
  ctx.llm.registerAdapter(['mock'], new StepwiseToolAdapter(toolSteps))
  ctx.tools.register(defineContentToolFixture({
    name: 'work',
    description: 'does work',
    parameters: { i: { type: 'number' } },
    async execute() {
      return [{ type: 'text', text: 'work result' }]
    },
  }))
  // Small window so several tool steps cross the threshold and compaction
  // fires within the runaway turn after enough history can shrink.
  /** 中文说明：测试局部值 compact，由紧邻初始化决定。 */
  const compact = new ReproCompactionEngine(ctx, {
    auto: true,
    thresholdRatio: 0.5,
    retainTokens: 50,
    maxTokens: 8192,
    compactionRetries: 1,
  })
  return { ctx, compact }
}

/** 中文说明：函数 waitForIdle 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    /** 中文说明：测试局部值 dispose，由紧邻初始化决定。 */
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}

/** 中文说明：函数 overflowHistorySeed 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function overflowHistorySeed(): SessionEvent[] {
  /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
  const session = Session.create(SessionId('overflow-history-seed'))
  /** 中文说明：测试局部值 turn，由紧邻初始化决定。 */
  for (let turn = 1; turn <= 2; turn += 1) {
    /** 中文说明：测试局部值 sentinel，由紧邻初始化决定。 */
    const sentinel = turn === 1 ? 'OLD HISTORY SENTINEL' : 'RECENT HISTORY'
    session.append('turn/start', {
      turn,
    })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: `${sentinel} ${'old context '.repeat(200)}` }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('step/start', { turn, step: 1 })
    session.append('assistant/message', {
      turn,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: `historical response ${turn} ${'detail '.repeat(200)}` }],
        source: {
          kind: 'model',
          ...{ provider: 'mock', model: 'mock' },
        },
      }),
    }, { surfaceOp: 'append' })
    session.append('step/end', { turn, step: 1 })
    session.append('turn/end', { turn, reason: { kind: 'completed' } })
  }
  return [...session.events]
}

describe('CBR-001: a real-loop checkpoint is a valid boundary on both sides', () => {
  it('uses the model actually routed by agent/request for post-step pressure', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await harness(8)
    ctx.on('agent/request', async (_payload, next) => ({
      ...await next(), provider: 'mock', model: 'mock',
    }))
    try {
      /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
      const agent = ctx.agentLoop.create(SessionId('routed-pressure'), {
        provider: 'unconfigured-agent-fallback',
        model: 'unconfigured-agent-fallback',
      })
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'do a routed multi-step task' }], source: { kind: 'user' } }))
      await waitForIdle(ctx, agent)

      expect(agent.session.requestHeader()?.config.model).toBe('mock')
      expect(agent.session.events.some(event => event.type === 'compaction/summary')).toBe(true)
      expect(agent.session.events.at(-1)).toMatchObject({
        type: 'turn/end',
        data: { reason: { kind: 'completed' } },
      })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('runs automatic pressure between the completed tool step and the next step', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await harness(8)
    try {
      /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
      const agent = ctx.agentLoop.create(SessionId('post-step-order'), { provider: 'mock', model: 'mock' })
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'do tool work' }], source: { kind: 'user' } }))
      await waitForIdle(ctx, agent)

      /** 中文说明：测试局部值 events，由紧邻初始化决定。 */
      const events = [...agent.session.events]
      /** 中文说明：测试局部值 compactStart，由紧邻初始化决定。 */
      const compactStart = events.find(event => event.type === 'compaction/start')
      expect(compactStart).toBeDefined()
      /** 中文说明：测试局部值 precedingResult，由紧邻初始化决定。 */
      const precedingResult = events.findLast(event =>
        event.type === 'tool/result' && event.seq < compactStart!.seq,
      )
      if (precedingResult?.type !== 'tool/result') throw new Error('expected a durable tool result before compaction')
      /** 中文说明：测试局部值 precedingStepEnd，由紧邻初始化决定。 */
      const precedingStepEnd = events.find(event =>
        event.type === 'step/end'
        && event.data.step === precedingResult.data.step
        && event.seq > precedingResult.seq,
      )
      /** 中文说明：测试局部值 nextStepStart，由紧邻初始化决定。 */
      const nextStepStart = events.find(event =>
        event.type === 'step/start'
        && event.data.step === precedingResult.data.step + 1
        && event.seq > compactStart!.seq,
      )
      expect(precedingResult.seq).toBeLessThan(compactStart!.seq)
      expect(precedingStepEnd!.seq).toBeLessThan(compactStart!.seq)
      expect(compactStart!.seq).toBeLessThan(nextStepStart!.seq)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('the head checkpoint the loop lands is a balanced cut on both sides', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await harness(8)
    try {
      /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
      const agent = ctx.agentLoop.create(SessionId('repro'), { provider: 'mock', model: 'mock' })
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'do a long multi-step task' }], source: { kind: 'user' } }))
      await waitForIdle(ctx, agent)

      /** 中文说明：测试局部值 events，由紧邻初始化决定。 */
      const events = [...agent.session.events]
      // A compaction ran: at least one checkpoint landed on the surface.
      /** 中文说明：测试局部值 checkpoints，由紧邻初始化决定。 */
      const checkpoints = events.filter(
        (e): e is SurfaceEvent =>
          e.type === 'user/message'
          && typeof (e as SurfaceEvent).surfaceOp === 'object',
      )
      expect(checkpoints.length).toBeGreaterThan(0)

      // High log position does not make a text-only checkpoint mid-step; both
      // its start and end cuts are balanced in surface order.
      /** 中文说明：测试局部值 nodes，由紧邻初始化决定。 */
      const nodes = agent.session.surface.nodes
      /** 中文说明：测试局部值 cp，由紧邻初始化决定。 */
      for (const cp of checkpoints) {
        /** 中文说明：测试局部值 index，由紧邻初始化决定。 */
        const index = nodes.indexOf(cp.seq)
        if (index === -1) continue // shadowed by a later checkpoint — no longer an edge.
        expect(toolPairingBalancedBefore(agent.session, cp.seq),
          `checkpoint seq ${cp.seq} must be a balanced region START`).toBe(true)
        expect(toolPairingBalancedAfter(agent.session, cp.seq),
          `checkpoint seq ${cp.seq} must be a balanced region END`).toBe(true)
      }
    } finally {
      await ctx.fiber.dispose()
    }
  })
})

describe('context-overflow recovery across the real loop and compaction-basic', () => {
  it.each(['thrown', 'in-band'] as const)(
    'force-compacts a %s overflow within the retried step',
    async (delivery) => {
      /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
      const ctx = new Context()
      /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
      const adapter = new OverflowRecoveryAdapter(delivery)
      await mountAgentLoopTestDependencies(ctx)
      await mountInvariants(ctx)
      await ctx.plugin(AgentLoop, { agents: [] })
      await ctx.plugin(TokenMeter)
      ctx.llm.registerAdapter(['mock'], adapter)
      ctx.on('agent/request', async (_payload, next) => ({
        ...await next(), provider: 'mock', model: 'mock',
      }))
      await ctx.plugin(BasicCompactionEngine, {
        thresholdRatio: 1,
        retainTokens: 100,
        maxTokens: 64,
        compactionRetries: 0,
        maxOverflowRetries: 1,
      })

      try {
        /** 中文说明：测试局部值 { agent }，由紧邻初始化决定。 */
        const { agent } = await ctx.agentLoop.createAgent(ctx, {
          sessionId: SessionId(`overflow-${delivery}`),
          seed: overflowHistorySeed(),
          agentOptions: {
            provider: 'unconfigured-agent-fallback',
            model: 'unconfigured-agent-fallback',
          },
        })

        agent.followup(createUserMessage({ content: [{ type: 'text', text: 'continue from history' }], source: { kind: 'user' } }))
        await agent.whenIdle()

        expect(adapter.conversationRequests).toHaveLength(2)
        expect(adapter.summaryRequests).toHaveLength(1)
        /** 中文说明：测试局部值 instruction，由紧邻初始化决定。 */
        const instruction = adapter.summaryRequests[0]!.messages.at(-1)?.content
          .map(block => (block.type === 'text' ? block.text : ''))
          .join('') ?? ''
        expect(instruction).toContain('Write concise English engineering prose.')
        expect(instruction).toContain('numeric values, function signatures, and syntax fragments.')
        expect(JSON.stringify(adapter.conversationRequests[0]!.messages)).toContain('OLD HISTORY SENTINEL')
        /** 中文说明：测试局部值 retry，由紧邻初始化决定。 */
        const retry = JSON.stringify(adapter.conversationRequests[1]!.messages)
        expect(retry).toContain('RECOVERY CHECKPOINT')
        expect(retry).not.toContain('OLD HISTORY SENTINEL')

        /** 中文说明：测试局部值 events，由紧邻初始化决定。 */
        const events = [...agent.session.events]
        /** 中文说明：测试局部值 stepStart，由紧邻初始化决定。 */
        const stepStart = events.find(event =>
          event.type === 'step/start' && event.data.turn === 3 && event.data.step === 1,
        )!
        /** 中文说明：测试局部值 stepEnd，由紧邻初始化决定。 */
        const stepEnd = events.find(event =>
          event.type === 'step/end' && event.data.turn === 3 && event.data.step === 1,
        )!
        /** 中文说明：测试局部值 compaction，由紧邻初始化决定。 */
        const compaction = events.filter(event =>
          event.type === 'compaction/start'
          || event.type === 'compaction/summary'
          || event.type === 'compaction/end',
        )
        expect(compaction.map(event => event.type)).toEqual([
          'compaction/start',
          'compaction/summary',
          'compaction/end',
        ])
        expect(compaction.every(event =>
          event.seq > stepStart.seq && event.seq < stepEnd.seq,
        )).toBe(true)
        expect(events.filter(event => event.type === 'turn/start').slice(-1).map(event => event.data.turn))
          .toEqual([3])
        expect(events.filter(event => event.type === 'step/start' && event.data.turn === 3))
          .toHaveLength(1)
        expect(events.at(-1)).toMatchObject({
          type: 'turn/end',
          data: { reason: { kind: 'completed' } },
        })
      } finally {
        await ctx.fiber.dispose()
      }
    },
  )

  it('keeps context-overflow and transient retry budgets independent in one sequence', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
    const adapter = new OverflowRecoveryAdapter('thrown', true)
    await mountAgentLoopTestDependencies(ctx)
    await mountInvariants(ctx)
    await ctx.plugin(LlmRetry)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(TokenMeter)
    ctx.llm.registerAdapter(['mock'], adapter)
    await ctx.plugin(BasicCompactionEngine, {
      thresholdRatio: 1,
      retainTokens: 100,
      maxTokens: 64,
      compactionRetries: 0,
      maxOverflowRetries: 1,
    })

    try {
      /** 中文说明：测试局部值 { agent }，由紧邻初始化决定。 */
      const { agent } = await ctx.agentLoop.createAgent(ctx, {
        sessionId: SessionId('alternating-recovery'),
        seed: overflowHistorySeed(),
        agentOptions: { provider: 'mock', model: 'mock' },
      })
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'continue from history' }], source: { kind: 'user' } }))
      await agent.whenIdle()

      expect(adapter.conversationRequests).toHaveLength(3)
      expect(adapter.summaryRequests).toHaveLength(1)
      expect(agent.session.events.filter(event => event.type === 'llm/retry').map(event => event.data))
        .toEqual([expect.objectContaining({ turn: 3, step: 1, retry: 1, failure: { message: 'temporary provider outage', code: 'SERVER' } })])
      expect(agent.session.events.filter(event => event.type === 'turn/start').slice(-1).map(event => event.data.turn))
        .toEqual([3])
      expect(agent.session.events.at(-1)).toMatchObject({
        type: 'turn/end',
        data: { reason: { kind: 'completed' } },
      })
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
