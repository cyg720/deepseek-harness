/**
 * 文件职责：验证 retry.spec.ts 覆盖的 LLM 配置、调用与事件处理行为。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件上下文和可控测试替身验证运行时协作。
 * 产品维度：保障模型接入在配置变化、认证、重试与异常场景下仍能给 Agent 稳定反馈。
 * 逻辑维度：准备上下文与测试数据，触发被测流程，再核对请求、事件、结果和清理行为。
 * 关键边界：测试替身必须保持确定性；敏感凭据不可写入日志；异步资源必须在用例结束时释放。
 * 新手阅读建议：先看测试数据和辅助函数，再按 describe/it 场景阅读，最后对照被测插件实现。
 */
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage, CallId, EMPTY_RESPONSE_CODE, LlmAdapter, LlmError, resolveRetryPolicy  } from '@deepseek-ai/dsh-llm'
import type {
  AlwaysRetryPolicyConfig,
  BackoffConfig,
  GenerateOptions,
  NormalRetryPolicyConfig,
  ResolvedRetryPolicy,
  RetryPolicyConfig,
  StreamChunk,
} from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionEventMap } from '@deepseek-ai/dsh-session'
import type { LlmRetryEventData } from '@deepseek-ai/dsh-llm-retry/types'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent, RequestErrorAction } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import * as retry from '../src/index.ts'

/** 中文说明：type ScriptEntry 定义本测试所需的数据或行为，用于表达模型调用相关场景。 */
type ScriptEntry = Error | Iterable<StreamChunk> | AsyncIterable<StreamChunk>

it('keeps the browser-safe retry payload identical to the session event', () => {
  expectTypeOf<LlmRetryEventData>().toEqualTypeOf<SessionEventMap['llm/retry']>()
})

/** 中文说明：class ScriptedAdapter 定义本测试所需的数据或行为，用于表达模型调用相关场景。 */
class ScriptedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  private retryPolicies: Readonly<Record<string, ResolvedRetryPolicy | undefined>> = {}

  constructor(private readonly entries: ScriptEntry[]) {
    super()
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    /** 中文说明：变量 entry 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const entry = this.entries.shift()
    if (entry === undefined) throw new Error('retry test script exhausted')
    if (entry instanceof Error) throw entry
    yield* entry
  }

  configureRetryPolicies(
    policies: Readonly<Record<string, RetryPolicyConfig | undefined>>,
  ): void {
    this.retryPolicies = Object.fromEntries(Object.entries(policies).map(([provider, policy]) => [
      provider,
      policy === undefined
        ? undefined
        : resolveRetryPolicy(policy, `retry test provider "${provider}" retryPolicy`),
    ]))
  }

  override providerRetryPolicy(provider: string): ResolvedRetryPolicy | undefined {
    return this.retryPolicies[provider]
  }
}

async function* partialToolFailure(error: Error): AsyncGenerator<StreamChunk> {
  /** 中文说明：变量 id 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const id = CallId('discarded-call')
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text: 'discarded partial output' }
  yield { type: 'block-end', index: 0, block: { type: 'text', text: 'discarded partial output' } }
  yield { type: 'block-start', index: 1, blockType: 'tool-call' }
  yield { type: 'tool-call-delta', index: 1, id, name: 'danger', argumentsDelta: '{}' }
  yield { type: 'block-end', index: 1, block: { type: 'tool-call', id, name: 'danger', arguments: '{}' } }
  throw error
}

/** 中文说明：函数 textResponse 承担本测试场景中的准备或验证工作；参数按签名传入，返回值供后续断言使用；示例见本文件调用。 */
function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/**
 * A degenerate empty provider completion as an error finish chunk. Both
 * adapters emit this shape and the EMPTY_RESPONSE code (the field the policy
 * routes on); the message text here is the deepseek adapter's phrasing (pi-ai
 * qualifies it with the model name).
 */
/* 中文说明：函数 emptyCompletion 承担本测试场景中的准备或验证工作；参数按签名传入，返回值供后续断言使用；示例见本文件调用。 */
function emptyCompletion(): StreamChunk[] {
  return [
    { type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } },
    {
      type: 'finish',
      reason: {
        kind: 'error',
        failure: { message: 'model returned a completed response with no content', code: EMPTY_RESPONSE_CODE },
      },
    },
  ]
}

/** 中文说明：函数 harness 承担本测试场景中的准备或验证工作；参数按签名传入，返回值供后续断言使用；示例见本文件调用。 */
async function harness(
  adapter: ScriptedAdapter,
  policies: Readonly<Record<string, RetryPolicyConfig | undefined>> = { mock: normalConfig() },
  beforeRetry?: (ctx: Context) => void,
  internals: retry.RetryInternals = {},
): Promise<{ ctx: Context; retryFiber: Fiber; disposeAdapter: () => void }> {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  beforeRetry?.(ctx)
  adapter.configureRetryPolicies(policies)
  /** 中文说明：函数值 retryFiber 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  const retryFiber = await ctx.plugin(Object.assign((inner: Context) => {
    retry.apply(inner, {}, internals)
  }, { inject: retry.inject }))
  await ctx.plugin(AgentLoop, { agents: [] })
  /** 中文说明：变量 disposeAdapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const disposeAdapter = ctx.llm.registerAdapter(['mock', 'other'], adapter)
  return { ctx, retryFiber, disposeAdapter }
}

/** 中文说明：函数 normalConfig 承担本测试场景中的准备或验证工作；参数按签名传入，返回值供后续断言使用；示例见本文件调用。 */
function normalConfig(
  overrides: Partial<Omit<NormalRetryPolicyConfig, 'mode'>> = {},
): NormalRetryPolicyConfig {
  const { backoff, ...policy } = overrides
  return {
    mode: 'normal',
    maxRetries: 2,
    ...policy,
    backoff: {
      initialDelayMs: 500,
      maxDelayMs: 10_000,
      jitterRatio: 0,
      ...backoff,
    },
  }
}

/** 中文说明：函数 alwaysConfig 承担本测试场景中的准备或验证工作；参数按签名传入，返回值供后续断言使用；示例见本文件调用。 */
function alwaysConfig(backoff: BackoffConfig = {}): AlwaysRetryPolicyConfig {
  return {
    mode: 'always',
    backoff: {
      initialDelayMs: 500,
      maxDelayMs: 10_000,
      jitterRatio: 0,
      ...backoff,
    },
  }
}

/** 中文说明：函数 waitForIdle 承担本测试场景中的准备或验证工作；参数按签名传入，返回值供后续断言使用；示例见本文件调用。 */
function waitForIdle(_ctx: Context, agent: Agent): Promise<void> {
  return agent.whenIdle()
}

/** 中文说明：函数 waitForRetry 承担本测试场景中的准备或验证工作；参数按签名传入，返回值供后续断言使用；示例见本文件调用。 */
function waitForRetry(ctx: Context, agent: Agent, retryNumber: number): Promise<Extract<SessionEvent, { type: 'llm/retry' }>> {
  return new Promise((resolve) => {
    /** 中文说明：函数值 dispose 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const dispose = ctx.on('session/event', (session, event) => {
      if (session === agent.session && event.type === 'llm/retry' && event.data.retry === retryNumber) {
        dispose()
        resolve(event)
      }
    })
  })
}

/** 中文说明：变量 context 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let context: Context | undefined

afterEach(async () => {
  vi.useRealTimers()
  await context?.fiber.dispose()
  context = undefined
})

describe('provider-routed retry policy', () => {
  it('records the scheduled delay before retrying the request', async () => {
    vi.useFakeTimers()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new ScriptedAdapter([
      new LlmError('busy', 'RATE_LIMIT', { status: 429 }),
      textResponse('done'),
    ])
    ;({ ctx: context } = await harness(adapter, {
      mock: normalConfig({ retryableCodes: ['SERVER', 'RATE_LIMIT'] }),
    }, undefined, { random: () => 0.5 }))
    /** 中文说明：变量 agent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const agent = context.agentLoop.create(SessionId('retry-success'), {
      provider: 'mock',
      model: 'mock',
    })
    /** 中文说明：变量 scheduled 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const scheduled = waitForRetry(context, agent, 1)

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    /** 中文说明：变量 event 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const event = await scheduled

    expect(event.data.retryId).toEqual(expect.any(String))
    expect(event.data).toEqual({
      retryId: event.data.retryId,
      turn: 1,
      step: 1,
      provider: 'mock',
      mode: 'normal',
      policyKey: '["normal",2,["RATE_LIMIT","SERVER"],500,10000,0]',
      retry: 1,
      maxRetries: 2,
      delayMs: 500,
      failure: { message: 'busy', code: 'RATE_LIMIT', status: 429 },
    })
    expect(adapter.requests).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(499)
    expect(adapter.requests).toHaveLength(1)

    /** 中文说明：变量 idle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const idle = waitForIdle(context, agent)
    await vi.advanceTimersByTimeAsync(1)
    await idle

    expect(adapter.requests).toHaveLength(2)
    expect(agent.session.events.filter(item => item.type === 'step/start').map(item => item.data))
      .toEqual([{ turn: 1, step: 1 }])
    expect(agent.session.deriveMessages().at(-1)).toEqual({
      id: expect.any(String) as unknown,
      role: 'assistant',
      content: [{ type: 'text', text: 'done' }],
      source: { kind: 'model', provider: 'mock', model: 'mock' },
    })
  })

  it('retries an EMPTY_RESPONSE error finish under the default retryable codes', async () => {
    vi.useFakeTimers()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new ScriptedAdapter([
      emptyCompletion(),
      textResponse('recovered'),
    ])
    // No retryableCodes override: this proves the default policy covers the
    // adapters' empty-completion classification end to end (finish-chunk error
    // delivery, not a thrown stream error).
    ;({ ctx: context } = await harness(adapter))
    /** 中文说明：变量 agent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const agent = context.agentLoop.create(SessionId('retry-empty-response'), { provider: 'mock', model: 'mock' })
    /** 中文说明：变量 scheduled 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const scheduled = waitForRetry(context, agent, 1)

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    /** 中文说明：变量 event 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const event = await scheduled
    expect(event.data.failure).toEqual({
      message: 'model returned a completed response with no content',
      code: EMPTY_RESPONSE_CODE,
    })

    /** 中文说明：变量 idle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const idle = waitForIdle(context, agent)
    await vi.advanceTimersByTimeAsync(500)
    await idle

    expect(adapter.requests).toHaveLength(2)
    expect(agent.session.events.filter(event => event.type === 'assistant/message').map(event => ({
      turn: event.data.turn,
      step: event.data.step,
    }))).toEqual([{ turn: 1, step: 1 }])
    expect(agent.session.deriveMessages().at(-1)).toMatchObject({
      role: 'assistant',
      content: [{ type: 'text', text: 'recovered' }],
    })
  })

  it('leaves partial failed chunks on their step without committing a message or tool side effect', async () => {
    vi.useFakeTimers()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new ScriptedAdapter([
      partialToolFailure(new LlmError('stream interrupted', 'TRANSPORT')),
      textResponse('recovered'),
    ])
    ;({ ctx: context } = await harness(adapter))
    /** 中文说明：变量 toolExecutions 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let toolExecutions = 0
    context.tools.register(defineContentToolFixture({
      name: 'danger',
      description: 'must not run for a failed provider attempt',
      parameters: {},
      async execute() {
        toolExecutions += 1
        return [{ type: 'text', text: 'unexpected' }]
      },
    }))
    /** 中文说明：变量 agent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const agent = context.agentLoop.create(SessionId('retry-partial'), { provider: 'mock', model: 'mock' })
    /** 中文说明：变量 scheduled 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const scheduled = waitForRetry(context, agent, 1)

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await scheduled
    /** 中文说明：变量 idle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const idle = waitForIdle(context, agent)
    await vi.advanceTimersByTimeAsync(500)
    await idle

    /** 中文说明：函数值 retryEvent 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const retryEvent = agent.session.events.find(event => event.type === 'llm/retry')
    /** 中文说明：函数值 failedChunks 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const failedChunks = agent.session.events.filter(event =>
      event.type === 'assistant/chunk'
      && retryEvent !== undefined
      && event.seq < retryEvent.seq,
    )
    expect(failedChunks).toHaveLength(7)
    /** 中文说明：函数值 assistantMessages 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const assistantMessages = agent.session.events.filter(event => event.type === 'assistant/message')
    expect(assistantMessages.map(event => ({
      turn: event.data.turn,
      step: event.data.step,
    }))).toEqual([{ turn: 1, step: 1 }])
    expect(failedChunks.every(event =>
      !assistantMessages[0]?.sourceEventSeqs?.includes(event.seq),
    )).toBe(true)
    expect(agent.session.events.some(event => event.type === 'tool/call')).toBe(false)
    expect(toolExecutions).toBe(0)
    expect(agent.session.deriveMessages().at(-1)).toMatchObject({
      role: 'assistant',
      content: [{ type: 'text', text: 'recovered' }],
      source: { kind: 'model', provider: 'mock', model: 'mock' },
    })
  })

  it('applies bounded exponential jitter and stops after the configured budget', async () => {
    vi.useFakeTimers()
    /** 中文说明：变量 samples 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const samples = [0, 1]
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new ScriptedAdapter([
      new LlmError('busy one', 'SERVER'),
      new LlmError('busy two', 'SERVER'),
      new LlmError('busy three', 'SERVER'),
    ])
    ;({ ctx: context } = await harness(adapter, { mock: normalConfig({
      backoff: { jitterRatio: 0.1 },
    }) }, undefined, {
      random: () => samples.shift() ?? 0.5,
    }))
    /** 中文说明：变量 agent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const agent = context.agentLoop.create(SessionId('retry-exhausted'), { provider: 'mock', model: 'mock' })
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = waitForRetry(context, agent, 1)

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    expect((await first).data.delayMs).toBe(450)

    /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const second = waitForRetry(context, agent, 2)
    await vi.advanceTimersByTimeAsync(450)
    expect((await second).data.delayMs).toBe(1_100)

    /** 中文说明：变量 idle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const idle = waitForIdle(context, agent)
    await vi.advanceTimersByTimeAsync(1_100)
    await idle

    expect(adapter.requests).toHaveLength(3)
    expect(agent.session.events.filter(event => event.type === 'llm/retry')).toHaveLength(2)
    expect(agent.session.events.at(-1)).toMatchObject({
      type: 'turn/end',
      data: { reason: { kind: 'error', error: { message: 'busy three', code: 'SERVER' } } },
    })
  })

  it('accepts the zero-delay lower jitter bound', async () => {
    vi.useFakeTimers()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new ScriptedAdapter([
      new LlmError('busy', 'SERVER'),
      textResponse('done'),
    ])
    ;({ ctx: context } = await harness(adapter, { mock: normalConfig({
      backoff: { initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 1 },
    }) }, undefined, { random: () => 0 }))
    /** 中文说明：变量 agent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const agent = context.agentLoop.create(SessionId('retry-zero-delay'), { provider: 'mock', model: 'mock' })
    /** 中文说明：变量 scheduled 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const scheduled = waitForRetry(context, agent, 1)

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    expect((await scheduled).data.delayMs).toBe(0)

    /** 中文说明：变量 idle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const idle = waitForIdle(context, agent)
    await vi.runAllTimersAsync()
    await idle
    expect(adapter.requests).toHaveLength(2)
  })

  it('uses a bounded provider Retry-After verbatim and delegates an over-cap instruction', async () => {
    vi.useFakeTimers()
    /** 中文说明：变量 accepted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const accepted = new ScriptedAdapter([
      new LlmError('wait', 'RATE_LIMIT', { providerRetryAfterMs: 2_000 }),
      textResponse('done'),
    ])
    ;({ ctx: context } = await harness(accepted, { mock: normalConfig({
      backoff: { jitterRatio: 1 },
    }) }))
    /** 中文说明：变量 acceptedAgent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const acceptedAgent = context.agentLoop.create(SessionId('retry-after-accepted'), { provider: 'mock', model: 'mock' })
    /** 中文说明：变量 scheduled 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const scheduled = waitForRetry(context, acceptedAgent, 1)
    acceptedAgent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    expect((await scheduled).data.delayMs).toBe(2_000)
    /** 中文说明：变量 acceptedIdle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const acceptedIdle = waitForIdle(context, acceptedAgent)
    await vi.advanceTimersByTimeAsync(2_000)
    await acceptedIdle
    expect(accepted.requests).toHaveLength(2)

    await context.fiber.dispose()
    /** 中文说明：变量 rejected 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const rejected = new ScriptedAdapter([
      new LlmError('wait too long', 'RATE_LIMIT', { providerRetryAfterMs: 10_001 }),
    ])
    ;({ ctx: context } = await harness(rejected))
    /** 中文说明：变量 rejectedAgent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const rejectedAgent = context.agentLoop.create(SessionId('retry-after-rejected'), { provider: 'mock', model: 'mock' })
    /** 中文说明：变量 rejectedIdle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const rejectedIdle = waitForIdle(context, rejectedAgent)
    rejectedAgent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await rejectedIdle
    expect(rejected.requests).toHaveLength(1)
    expect(rejectedAgent.session.events.some(event => event.type === 'llm/retry')).toBe(false)
  })

  it('uses local jittered backoff when always mode receives an over-cap Retry-After', async () => {
    vi.useFakeTimers()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new ScriptedAdapter([
      new LlmError('wait too long', 'AUTH', { providerRetryAfterMs: 10 }),
      textResponse('done'),
    ])
    ;({ ctx: context } = await harness(adapter, { mock: alwaysConfig({
      initialDelayMs: 2,
      maxDelayMs: 4,
      jitterRatio: 0.5,
    }) }, undefined, { random: () => 1 }))
    /** 中文说明：变量 agent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const agent = context.agentLoop.create(SessionId('retry-always-over-cap'), {
      provider: 'mock',
      model: 'mock',
    })
    /** 中文说明：变量 scheduled 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const scheduled = waitForRetry(context, agent, 1)

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    expect((await scheduled).data.delayMs).toBe(3)
    /** 中文说明：变量 idle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const idle = waitForIdle(context, agent)
    await vi.advanceTimersByTimeAsync(3)
    await idle

    expect(adapter.requests).toHaveLength(2)
  })

  it('delegates non-transient failures without scheduling a timer', async () => {
    vi.useFakeTimers()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new ScriptedAdapter([new LlmError('bad key', 'AUTH')])
    ;({ ctx: context } = await harness(adapter))
    /** 中文说明：变量 agent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const agent = context.agentLoop.create(SessionId('retry-auth'), { provider: 'mock', model: 'mock' })
    /** 中文说明：变量 idle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const idle = waitForIdle(context, agent)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await idle
    expect(adapter.requests).toHaveLength(1)
    expect(agent.session.events.some(event => event.type === 'llm/retry')).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('delegates when no final adapter served the failed request', async () => {
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new ScriptedAdapter([textResponse('must not run')])
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await harness(adapter, { mock: alwaysConfig() })
    context = mounted.ctx
    mounted.disposeAdapter()
    /** 中文说明：变量 agent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const agent = context.agentLoop.create(SessionId('retry-no-serving-policy'), {
      provider: 'mock',
      model: 'mock',
    })
    /** 中文说明：变量 idle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const idle = waitForIdle(context, agent)

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'missing route' }], source: { kind: 'user' } }))
    await idle

    expect(adapter.requests).toHaveLength(0)
    expect(agent.session.events.some(event => event.type === 'llm/retry')).toBe(false)
    /** 中文说明：变量 end 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const end = agent.session.events.at(-1)
    expect(end).toMatchObject({
      type: 'turn/end',
      data: { reason: { kind: 'error', error: { code: 'NO_ADAPTER' } } },
    })
    if (end?.type === 'turn/end' && end.data.reason.kind === 'error') {
      expect(end.data.reason.error.message).toContain('no adapter registered for provider')
    }
  })

  it('selects policy by the failed request provider', async () => {
    vi.useFakeTimers()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new ScriptedAdapter([
      new LlmError('mock auth failed', 'AUTH'),
      new LlmError('other auth failed', 'AUTH'),
      textResponse('other recovered'),
    ])
    ;({ ctx: context } = await harness(adapter, {
      other: alwaysConfig({ initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 }),
    }))

    /** 中文说明：变量 normalAgent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const normalAgent = context.agentLoop.create(SessionId('retry-provider-normal'), {
      provider: 'mock',
      model: 'mock',
    })
    /** 中文说明：变量 normalIdle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const normalIdle = waitForIdle(context, normalAgent)
    normalAgent.followup(createUserMessage({ content: [{ type: 'text', text: 'normal' }], source: { kind: 'user' } }))
    await normalIdle
    expect(normalAgent.session.events.some(event => event.type === 'llm/retry')).toBe(false)

    /** 中文说明：变量 alwaysAgent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const alwaysAgent = context.agentLoop.create(SessionId('retry-provider-always'), {
      provider: 'other',
      model: 'mock',
    })
    /** 中文说明：变量 scheduled 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const scheduled = waitForRetry(context, alwaysAgent, 1)
    alwaysAgent.followup(createUserMessage({ content: [{ type: 'text', text: 'always' }], source: { kind: 'user' } }))
    expect((await scheduled).data).toMatchObject({
      provider: 'other',
      mode: 'always',
      retry: 1,
      delayMs: 1,
    })
    /** 中文说明：变量 alwaysIdle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const alwaysIdle = waitForIdle(context, alwaysAgent)
    await vi.advanceTimersByTimeAsync(1)
    await alwaysIdle

    expect(adapter.requests.map(request => request.provider)).toEqual(['mock', 'other', 'other'])
  })

  it('selects an always policy from the provider chosen by agent/request', async () => {
    vi.useFakeTimers()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new ScriptedAdapter([
      new LlmError('rerouted auth failed', 'AUTH'),
      textResponse('rerouted recovery'),
    ])
    ;({ ctx: context } = await harness(adapter, {
      other: alwaysConfig({ initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 }),
    }, (ctx) => {
      ctx.on('agent/request', async (_payload, next) => ({
        ...await next(),
        provider: 'other',
      }))
    }))
    /** 中文说明：变量 agent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const agent = context.agentLoop.create(SessionId('retry-provider-rerouted'), {
      provider: 'mock',
      model: 'mock',
    })
    /** 中文说明：变量 scheduled 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const scheduled = waitForRetry(context, agent, 1)

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'reroute' }], source: { kind: 'user' } }))
    expect((await scheduled).data).toMatchObject({ provider: 'other', mode: 'always' })
    /** 中文说明：变量 idle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const idle = waitForIdle(context, agent)
    await vi.advanceTimersByTimeAsync(1)
    await idle

    expect(adapter.requests.map(request => request.provider)).toEqual(['other', 'other'])
  })

  it('keeps finite retry budgets scoped to the failed provider', async () => {
    vi.useFakeTimers()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new ScriptedAdapter([
      new LlmError('mock failed', 'SERVER'),
      new LlmError('other failed', 'SERVER'),
      textResponse('other recovered'),
    ])
    ;({ ctx: context } = await harness(adapter, {
      mock: normalConfig({
        maxRetries: 1,
        backoff: { initialDelayMs: 1, maxDelayMs: 1 },
      }),
      other: normalConfig({
        maxRetries: 1,
        backoff: { initialDelayMs: 1, maxDelayMs: 1 },
      }),
    }, (ctx) => {
      ctx.on('agent/request', async (_payload, next) => ({
        ...await next(),
        provider: adapter.requests.length === 0 ? 'mock' : 'other',
      }))
    }))
    /** 中文说明：变量 agent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const agent = context.agentLoop.create(SessionId('retry-provider-budgets'), {
      provider: 'mock',
      model: 'mock',
    })
    /** 中文说明：变量 idle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const idle = waitForIdle(context, agent)

    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'switch provider after failure' }],
      source: { kind: 'user' },
    }))
    await vi.runAllTimersAsync()
    await idle

    expect(adapter.requests.map(request => request.provider)).toEqual(['mock', 'other', 'other'])
    expect(agent.session.events.filter(event => event.type === 'llm/retry').map(event => ({
      provider: event.data.provider,
      retry: event.data.retry,
    }))).toEqual([
      { provider: 'mock', retry: 1 },
      { provider: 'other', retry: 1 },
    ])
  })

  it.each(['thrown', 'in-band'] as const)(
    'uses the serving registration policy and resets changed-policy history after a %s failure',
    async (failureKind) => {
      vi.useFakeTimers()
      /** 中文说明：变量 entered 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const entered = Promise.withResolvers<undefined>()
      /** 中文说明：变量 release 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const release = Promise.withResolvers<undefined>()
      /** 中文说明：变量 oldAdapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const oldAdapter = new ScriptedAdapter([(async function * (): AsyncGenerator<StreamChunk> {
        entered.resolve(undefined)
        await release.promise
        if (failureKind === 'thrown') {
          throw new LlmError('old route auth failed', 'AUTH')
        }
        yield {
          type: 'finish',
          reason: {
            kind: 'error',
            failure: { message: 'old route auth failed', code: 'AUTH' },
          },
        }
      })()])
      /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const mounted = await harness(oldAdapter, { mock: alwaysConfig({
        initialDelayMs: 1,
        maxDelayMs: 1,
      }) })
      context = mounted.ctx
      /** 中文说明：变量 agent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const agent = context.agentLoop.create(SessionId('retry-serving-registration'), {
        provider: 'mock',
        model: 'mock',
      })
      /** 中文说明：变量 scheduled 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const scheduled = waitForRetry(context, agent, 1)
      agent.followup(createUserMessage({
        content: [{ type: 'text', text: 'replace while in flight' }],
        source: { kind: 'user' },
      }))
      await entered.promise

      mounted.disposeAdapter()
      /** 中文说明：变量 replacement 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const replacement = new ScriptedAdapter([
        new LlmError('replacement failed', 'AUTH'),
        textResponse('replacement recovered'),
      ])
      replacement.configureRetryPolicies({ mock: alwaysConfig({
        initialDelayMs: 3,
        maxDelayMs: 3,
      }) })
      context.llm.registerAdapter(['mock'], replacement)
      release.resolve(undefined)

      /** 中文说明：变量 firstEvent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const firstEvent = await scheduled
      expect(firstEvent.data).toMatchObject({
        provider: 'mock',
        mode: 'always',
        retry: 1,
        delayMs: 1,
      })
      /** 中文说明：变量 replacementScheduled 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const replacementScheduled = waitForRetry(context, agent, 1)
      /** 中文说明：变量 idle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const idle = waitForIdle(context, agent)
      await vi.advanceTimersByTimeAsync(1)
      /** 中文说明：变量 replacementEvent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const replacementEvent = await replacementScheduled
      expect(replacementEvent.data).toMatchObject({
        provider: 'mock',
        mode: 'always',
        retry: 1,
        delayMs: 3,
      })
      expect(replacementEvent.data.policyKey).not.toBe(firstEvent.data.policyKey)
      await vi.advanceTimersByTimeAsync(3)
      await idle

      expect(oldAdapter.requests).toHaveLength(1)
      expect(replacement.requests).toHaveLength(2)
      expect(agent.session.deriveMessages().at(-1)).toMatchObject({
        role: 'assistant',
        content: [{ type: 'text', text: 'replacement recovered' }],
      })
    },
  )

  it('keeps always mode unbounded while preserving cancellable jittered backoff', async () => {
    vi.useFakeTimers()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new ScriptedAdapter([
      new LlmError('auth one', 'AUTH'),
      new LlmError('auth two', 'AUTH'),
      new LlmError('auth three', 'AUTH'),
      new LlmError('auth four', 'AUTH'),
      textResponse('eventually recovered'),
    ])
    ;({ ctx: context } = await harness(adapter, { mock: alwaysConfig({
      initialDelayMs: 1,
      maxDelayMs: 4,
      jitterRatio: 0.1,
    }) }, undefined, { random: () => 1 }))
    /** 中文说明：变量 agent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const agent = context.agentLoop.create(SessionId('retry-always-unbounded'), {
      provider: 'mock',
      model: 'mock',
    })
    /** 中文说明：变量 idle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const idle = waitForIdle(context, agent)

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'keep trying' }], source: { kind: 'user' } }))
    await vi.runAllTimersAsync()
    await idle

    /** 中文说明：函数值 events 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const events = agent.session.events.filter(event => event.type === 'llm/retry')
    expect(adapter.requests).toHaveLength(5)
    expect(events.map(event => ({
      provider: event.data.provider,
      mode: event.data.mode,
      retry: event.data.retry,
      delayMs: event.data.delayMs,
      hasMax: 'maxRetries' in event.data,
    }))).toEqual([
      { provider: 'mock', mode: 'always', retry: 1, delayMs: 1.1, hasMax: false },
      { provider: 'mock', mode: 'always', retry: 2, delayMs: 2.2, hasMax: false },
      { provider: 'mock', mode: 'always', retry: 3, delayMs: 4, hasMax: false },
      { provider: 'mock', mode: 'always', retry: 4, delayMs: 4, hasMax: false },
    ])
  })

  it('keeps failed error text and partial output out of every retried model context', async () => {
    vi.useFakeTimers()
    /** 中文说明：变量 diagnostic 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const diagnostic = 'private provider diagnostic must not enter context'
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new ScriptedAdapter([
      partialToolFailure(new LlmError(diagnostic, 'AUTH')),
      textResponse('recovered without leaked context'),
    ])
    ;({ ctx: context } = await harness(adapter, { mock: alwaysConfig({
      initialDelayMs: 1,
      maxDelayMs: 1,
    }) }))
    /** 中文说明：变量 agent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const agent = context.agentLoop.create(SessionId('retry-always-context-isolation'), {
      provider: 'mock',
      model: 'mock',
    })
    /** 中文说明：变量 scheduled 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const scheduled = waitForRetry(context, agent, 1)

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'safe input' }], source: { kind: 'user' } }))
    await scheduled
    /** 中文说明：变量 idle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const idle = waitForIdle(context, agent)
    await vi.advanceTimersByTimeAsync(1)
    await idle

    expect(adapter.requests).toHaveLength(2)
    expect(adapter.requests[1]?.messages).toEqual(adapter.requests[0]?.messages)
    /** 中文说明：变量 retriedContext 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const retriedContext = JSON.stringify(adapter.requests[1]?.messages)
    expect(retriedContext).not.toContain(diagnostic)
    expect(retriedContext).not.toContain('discarded partial output')
    expect(agent.session.events.some(event =>
      event.type === 'llm/retry' && event.data.failure.message === diagnostic,
    )).toBe(true)
  })

  it('lets downstream specialized recovery run before always fallback', async () => {
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new ScriptedAdapter([
      new LlmError('requires specialized recovery', 'AUTH'),
      textResponse('specialized recovery won'),
    ])
    ;({ ctx: context } = await harness(adapter, { mock: alwaysConfig() }))
    context.on('agent/request-error', async () => ({ kind: 'retry' }))
    /** 中文说明：变量 agent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const agent = context.agentLoop.create(SessionId('retry-always-composition'), {
      provider: 'mock',
      model: 'mock',
    })
    /** 中文说明：变量 idle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const idle = waitForIdle(context, agent)

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'recover' }], source: { kind: 'user' } }))
    await idle

    expect(adapter.requests).toHaveLength(2)
    expect(agent.session.events.some(event => event.type === 'llm/retry')).toBe(false)
  })

  it.each([
    ['synchronously', () => { throw new Error('downstream recovery failed') }],
    ['asynchronously', async () => { throw new Error('downstream recovery failed') }],
  ])('falls back to always retry when downstream recovery throws %s', async (_kind, failDownstream) => {
    vi.useFakeTimers()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new ScriptedAdapter([
      new LlmError('requires fallback', 'AUTH'),
      textResponse('always recovered'),
    ])
    ;({ ctx: context } = await harness(adapter, { mock: alwaysConfig({
      initialDelayMs: 1,
      maxDelayMs: 1,
    }) }))
    context.on('agent/request-error', failDownstream)
    /** 中文说明：变量 agent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const agent = context.agentLoop.create(SessionId('retry-always-downstream-error'), {
      provider: 'mock',
      model: 'mock',
    })
    /** 中文说明：变量 scheduled 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const scheduled = waitForRetry(context, agent, 1)

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'recover' }], source: { kind: 'user' } }))
    await scheduled
    /** 中文说明：变量 idle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const idle = waitForIdle(context, agent)
    await vi.advanceTimersByTimeAsync(1)
    await idle

    expect(adapter.requests).toHaveLength(2)
  })

  it('aborts and drains a captured backoff before plugin disposal completes', async () => {
    vi.useFakeTimers()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new ScriptedAdapter([
      new LlmError('temporary', 'TRANSPORT'),
      textResponse('must not run'),
    ])
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await harness(adapter, { mock: alwaysConfig() })
    context = mounted.ctx
    /** 中文说明：变量 agent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const agent = context.agentLoop.create(SessionId('retry-hmr'), { provider: 'mock', model: 'mock' })
    /** 中文说明：变量 scheduled 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const scheduled = waitForRetry(context, agent, 1)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await scheduled
    /** 中文说明：变量 idle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const idle = waitForIdle(context, agent)

    await mounted.retryFiber.dispose()
    await idle
    await vi.advanceTimersByTimeAsync(60_000)

    expect(adapter.requests).toHaveLength(1)
    expect(agent.session.events.filter(event => event.type === 'step/start')).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('drains delegated recovery before completing plugin disposal', async () => {
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new ScriptedAdapter([new LlmError('bad key', 'AUTH')])
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await harness(adapter, { mock: alwaysConfig() })
    context = mounted.ctx
    /** 中文说明：变量 release 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const release = Promise.withResolvers<undefined>()
    /** 中文说明：变量 entered 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const entered = Promise.withResolvers<undefined>()
    /** 中文说明：变量 order 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const order: string[] = []
    context.on('agent/request-error', async () => {
      entered.resolve(undefined)
      await release.promise
      order.push('downstream')
      return { kind: 'retry' }
    })
    /** 中文说明：变量 agent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const agent = context.agentLoop.create(SessionId('retry-delegated-disposal'), {
      provider: 'mock',
      model: 'mock',
    })
    /** 中文说明：函数值 idle 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const idle = waitForIdle(context, agent).then(() => { order.push('idle') })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await entered.promise

    /** 中文说明：函数值 disposing 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const disposing = mounted.retryFiber.dispose().then(() => { order.push('disposed') })
    /** 中文说明：变量 timer 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let timer: ReturnType<typeof setTimeout> | undefined
    /** 中文说明：变量 outcome 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const outcome = await Promise.race([
      disposing.then(() => 'disposed' as const),
      new Promise<'blocked'>((resolve) => { timer = setTimeout(() => { resolve('blocked') }, 100) }),
    ])
    if (timer !== undefined) clearTimeout(timer)
    expect(outcome).toBe('blocked')

    release.resolve(undefined)
    await disposing
    await idle

    expect(order[0]).toBe('downstream')
    expect(order).toEqual(expect.arrayContaining(['disposed', 'idle']))
    expect(adapter.requests).toHaveLength(1)
    expect(agent.session.events.some(event => event.type === 'llm/retry')).toBe(false)
  })

  it('drains delegated recovery before turn cancellation reaches idle', async () => {
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new ScriptedAdapter([new LlmError('bad key', 'AUTH')])
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await harness(adapter, { mock: alwaysConfig() })
    context = mounted.ctx
    /** 中文说明：变量 downstream 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const downstream = Promise.withResolvers<RequestErrorAction>()
    /** 中文说明：变量 entered 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const entered = Promise.withResolvers<undefined>()
    /** 中文说明：变量 order 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const order: string[] = []
    context.on('agent/request-error', async () => {
      entered.resolve(undefined)
      /** 中文说明：变量 decision 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const decision = await downstream.promise
      order.push('downstream')
      return decision
    })
    /** 中文说明：变量 agent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const agent = context.agentLoop.create(SessionId('retry-delegated-cancel'), {
      provider: 'mock',
      model: 'mock',
    })
    /** 中文说明：函数值 idle 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const idle = waitForIdle(context, agent).then(() => { order.push('idle') })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await entered.promise

    agent.cancel({ kind: 'user' })
    /** 中文说明：变量 timer 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let timer: ReturnType<typeof setTimeout> | undefined
    /** 中文说明：变量 outcome 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const outcome = await Promise.race([
      idle.then(() => 'idle' as const),
      new Promise<'blocked'>((resolve) => { timer = setTimeout(() => { resolve('blocked') }, 100) }),
    ])
    if (timer !== undefined) clearTimeout(timer)
    expect(outcome).toBe('blocked')

    downstream.resolve({ kind: 'retry' })
    await idle

    expect(order).toEqual(['downstream', 'idle'])
    expect(adapter.requests).toHaveLength(1)
    expect(agent.session.events.at(-1)).toMatchObject({
      type: 'turn/end',
      data: { reason: { kind: 'aborted' } },
    })
  })

  it('handles synchronous cancellation while entering delegated recovery', async () => {
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new ScriptedAdapter([new LlmError('bad key', 'AUTH')])
    /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mounted = await harness(adapter, { mock: alwaysConfig() })
    context = mounted.ctx
    /** 中文说明：变量 downstream 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const downstream = Promise.withResolvers<RequestErrorAction>()
    /** 中文说明：变量 entered 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const entered = Promise.withResolvers<undefined>()
    context.on('agent/request-error', ({ agent }) => {
      agent.cancel({ kind: 'user' })
      entered.resolve(undefined)
      return downstream.promise
    })
    /** 中文说明：变量 agent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const agent = context.agentLoop.create(SessionId('retry-delegated-sync-cancel'), {
      provider: 'mock',
      model: 'mock',
    })
    /** 中文说明：变量 idle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const idle = waitForIdle(context, agent)

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await entered.promise
    /** 中文说明：变量 timer 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let timer: ReturnType<typeof setTimeout> | undefined
    /** 中文说明：变量 outcome 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const outcome = await Promise.race([
      idle.then(() => 'idle' as const),
      new Promise<'blocked'>((resolve) => { timer = setTimeout(() => { resolve('blocked') }, 100) }),
    ])
    if (timer !== undefined) clearTimeout(timer)
    expect(outcome).toBe('blocked')

    downstream.resolve({ kind: 'retry' })
    await idle

    expect(adapter.requests).toHaveLength(1)
    expect(agent.session.events.at(-1)).toMatchObject({
      type: 'turn/end',
      data: { reason: { kind: 'aborted' } },
    })
  })

  it('fails a captured callback after disposal without entering downstream policy', async () => {
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new ScriptedAdapter([new LlmError('bad key', 'AUTH')])
    /** 中文说明：变量 captured 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const captured = Promise.withResolvers<undefined>()
    /** 中文说明：函数值 invokeCaptured 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    let invokeCaptured: (() => Promise<void>) | undefined
    /** 中文说明：函数值 mounted 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const mounted = await harness(adapter, {}, (ctx) => {
      ctx.on('agent/request-error', (_payload, next) => {
        return new Promise<RequestErrorAction>((resolve) => {
          invokeCaptured = async () => { resolve(await next()) }
          captured.resolve(undefined)
        })
      })
    })
    context = mounted.ctx
    /** 中文说明：变量 downstreamCalls 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let downstreamCalls = 0
    context.on('agent/request-error', async (_payload, next) => {
      downstreamCalls += 1
      return next()
    })
    /** 中文说明：变量 agent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const agent = context.agentLoop.create(SessionId('retry-captured-disposal'), {
      provider: 'mock',
      model: 'mock',
    })
    /** 中文说明：变量 idle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const idle = waitForIdle(context, agent)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await captured.promise

    await mounted.retryFiber.dispose()
    if (invokeCaptured === undefined) throw new Error('request-error waterfall did not capture retry callback')
    await invokeCaptured()
    await idle

    expect(downstreamCalls).toBe(0)
    expect(adapter.requests).toHaveLength(1)
  })

  it('lets turn cancellation win during backoff without opening another step', async () => {
    vi.useFakeTimers()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new ScriptedAdapter([
      new LlmError('permanent', 'AUTH'),
      textResponse('must not run'),
    ])
    ;({ ctx: context } = await harness(adapter, { mock: alwaysConfig() }))
    /** 中文说明：变量 agent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const agent = context.agentLoop.create(SessionId('retry-cancel'), { provider: 'mock', model: 'mock' })
    /** 中文说明：变量 scheduled 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const scheduled = waitForRetry(context, agent, 1)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await scheduled
    /** 中文说明：变量 idle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const idle = waitForIdle(context, agent)
    agent.cancel({ kind: 'user' })
    await idle

    expect(adapter.requests).toHaveLength(1)
    expect(agent.session.events.at(-1)).toMatchObject({
      type: 'turn/end',
      data: { reason: { kind: 'aborted' } },
    })
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([
    ['normal', normalConfig()],
    ['always', alwaysConfig()],
  ])('lets an earlier recovery listener cancel before %s retry policy runs', async (_mode, policy) => {
    vi.useFakeTimers()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new ScriptedAdapter([
      new LlmError('temporary', 'SERVER'),
      textResponse('must not run'),
    ])
    ;({ ctx: context } = await harness(adapter, { mock: policy }, (ctx) => {
      ctx.on('agent/request-error', async ({ agent }, next) => {
        agent.cancel({ kind: 'user' })
        return next()
      })
    }))
    /** 中文说明：变量 agent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const agent = context.agentLoop.create(SessionId('retry-pre-cancel'), { provider: 'mock', model: 'mock' })
    /** 中文说明：变量 idle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const idle = waitForIdle(context, agent)

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await idle

    expect(adapter.requests).toHaveLength(1)
    expect(agent.session.events.some(event => event.type === 'llm/retry')).toBe(false)
    expect(agent.session.events.at(-1)).toMatchObject({
      type: 'turn/end',
      data: { reason: { kind: 'aborted' } },
    })
  })

  it('handles synchronous cancellation from the retry status event', async () => {
    vi.useFakeTimers()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new ScriptedAdapter([
      new LlmError('temporary', 'SERVER'),
      textResponse('must not run'),
    ])
    ;({ ctx: context } = await harness(adapter))
    /** 中文说明：变量 agent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const agent = context.agentLoop.create(SessionId('retry-event-cancel'), { provider: 'mock', model: 'mock' })
    context.on('session/event', (session, event) => {
      if (session === agent.session && event.type === 'llm/retry') agent.cancel({ kind: 'user' })
    })
    /** 中文说明：变量 idle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const idle = waitForIdle(context, agent)

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await idle

    expect(adapter.requests).toHaveLength(1)
    expect(agent.session.events.filter(event => event.type === 'llm/retry')).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects retry policy configured on the executor instead of a provider', () => {
    expectTypeOf<{}>().toExtend<retry.Config>()
    expectTypeOf<{ retryPolicy: { mode: 'always' } }>().not.toExtend<retry.Config>()
    expect(() => {
      retry.apply(new Context(), { retryPolicy: { mode: 'always' } } as unknown as retry.Config)
    }).toThrow(/retryPolicy belongs under each provider/)
  })

  it('rejects unknown executor config', () => {
    expect(() => {
      retry.apply(new Context(), { retryPolciy: {} } as unknown as retry.Config)
    }).toThrow(/unknown key "retryPolciy"/)
  })
})
