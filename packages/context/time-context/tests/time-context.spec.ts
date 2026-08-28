/**
 * 文件职责：验证时间上下文的 time-context.spec.ts 行为。
 * 技术维度：Vitest、会话事件、模型请求夹具和 Cordis 组装。
 * 产品维度：防止时间上下文改变模型可见内容或生命周期语义。
 * 逻辑维度：构造日志与配置，运行插件并断言事件、请求和清理。
 * 关键边界：模型可见内容必须可重建；工具调用和结果必须保持配对。
 * 新手阅读建议：先读事件夹具，再按正常、边界和失败场景阅读。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { createUserMessage, ToolCallId, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import AgentRegistry, { agentEvents, Inbox, type Agent } from '@deepseek-ai/dsh-agent'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as timeContext from '@deepseek-ai/dsh-time-context'
import type { Config } from '@deepseek-ai/dsh-time-context'

/** 中文说明：测试局部值 BASE，由紧邻初始化决定。 */
const BASE = Date.parse('2026-07-14T00:00:00.000Z')
/** 中文说明：测试局部值 ORIGINAL_TIME_ZONE，由紧邻初始化决定。 */
const ORIGINAL_TIME_ZONE = process.env['TZ']
/** 中文说明：测试局部值 SIGNAL，由紧邻初始化决定。 */
const SIGNAL = new AbortController().signal

beforeEach(() => {
  process.env['TZ'] = 'UTC'
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(BASE)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  if (ORIGINAL_TIME_ZONE === undefined) delete process.env['TZ']
  else process.env['TZ'] = ORIGINAL_TIME_ZONE
})

/** 中文说明：函数 mount 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function mount(config: Config = {}) {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
  const fiber = await ctx.plugin(timeContext, config)
  return { ctx, fiber }
}

/** 中文说明：函数 sessionAgent 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function sessionAgent(session: Session, id = 'agent'): Agent {
  return {
    id: SessionId(id),
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'running',
    ctx: new Context(),
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => { throw new Error('time-context must append directly to the open step') },
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

/** 中文说明：函数 openMessageTurn 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function openMessageTurn(session: Session, turn: number, clientTimeZone?: string): void {
  session.append('turn/start', { turn })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: `turn ${turn}` }],
    source: clientTimeZone === undefined
      ? { kind: 'user' }
      : { kind: 'user', rpcId: `turn-${String(turn)}`, clientTimeZone } as never,
  }), { surfaceOp: 'append' })
}

/** 中文说明：函数 contextTexts 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function contextTexts(session: Session): string[] {
  /** 中文说明：测试局部值 texts，由紧邻初始化决定。 */
  const texts: string[] = []
  /** 中文说明：测试局部值 event，由紧邻初始化决定。 */
  for (const event of session.events) {
    if (event.type === 'user/message'
      && event.data.source.kind === 'plugin'
      && event.data.source.plugin === 'time-context') {
      texts.push(event.data.content.find(block => block.type === 'text')?.text ?? '')
    }
  }
  return texts
}

/** 中文说明：函数 fire 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function fire(
  ctx: Context,
  agent: Agent,
  turn: number,
  step: number,
  signal: AbortSignal = SIGNAL,
): Promise<void> {
  /** 中文说明：测试局部值 proposed，由紧邻初始化决定。 */
  const proposed = createUserMessage({
    content: [{ type: 'text', text: 'request proposal' }],
    source: { kind: 'plugin', plugin: 'time-context-test' },
  })
  /** 中文说明：测试局部值 decision，由紧邻初始化决定。 */
  const decision = await agentEvents(ctx, agent).waterfall(
    'agent/pre-step',
    { messages: [proposed], turn, step, signal },
    () => Promise.resolve({ kind: 'enter' as const, messages: [proposed] }),
  )
  if (decision.kind === 'enter') {
    /** 中文说明：测试局部值 message，由紧邻初始化决定。 */
    for (const message of decision.messages) {
      if (message === proposed) continue
      agent.session.append('user/message', message, { surfaceOp: 'append' })
    }
  }
}

/** 中文说明：函数 textResponse 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/** 中文说明：函数 toolCallResponse 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function toolCallResponse(): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    {
      type: 'block-end',
      index: 0,
      block: { type: 'tool-call', id: ToolCallId('tick-1'), name: 'tick', arguments: '{}' },
    },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

/** 中文说明：类型或类 ScriptedAdapter 约束上下文或压缩数据职责。 */
class ScriptedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  constructor(private readonly script: StreamChunk[][]) {
    super()
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    /** 中文说明：测试局部值 chunks，由紧邻初始化决定。 */
    const chunks = this.script.shift()
    if (chunks === undefined) throw new Error('ScriptedAdapter: script exhausted')
    /** 中文说明：测试局部值 chunk，由紧邻初始化决定。 */
    for (const chunk of chunks) yield chunk
  }
}

/** 中文说明：函数 loopHarness 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function loopHarness(adapter: ScriptedAdapter, config: Config = {}): Promise<Context> {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(timeContext, config)
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

/** 中文说明：函数 requestText 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function requestText(request: GenerateOptions): string {
  return request.messages
    .flatMap(message => message.content)
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
}

describe('durable step context', () => {
  it('records turn, step, zoned time, and the preceding model-visible message baseline', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await mount({ timeZone: 'Asia/Shanghai' })
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = Session.create(SessionId('first'))
    openMessageTurn(session, 1, 'Asia/Shanghai')
    vi.setSystemTime(BASE + 90_061_000)

    await fire(ctx, sessionAgent(session), 1, 1)

    expect(contextTexts(session)).toEqual([
      'Time sampled while preparing turn 1, step 1: 2026-07-15T09:01:01+08:00[Asia/Shanghai]\n'
      + 'Browser time zone for this request: Asia/Shanghai. Interpret otherwise-unqualified dates and times in this zone.\n'
      + 'Elapsed since the preceding model-visible message: 1d 1h 1m 1s.',
    ])
    /** 中文说明：测试局部值 event，由紧邻初始化决定。 */
    const event = session.events.at(-1)
    expect(event?.type).toBe('user/message')
    if (event?.type !== 'user/message') throw new Error('missing time context')
    // The reading is a `snapshot`-form context: one named contribution whose
    // text is exactly what the model read, so a consumer attributes it without
    // re-splitting prose.
    expect(event.data.source).toEqual({
      kind: 'plugin',
      plugin: 'time-context',
      form: 'snapshot',
      sections: [{
        name: 'time-context',
        text: 'Time sampled while preparing turn 1, step 1: 2026-07-15T09:01:01+08:00[Asia/Shanghai]\n'
          + 'Browser time zone for this request: Asia/Shanghai. Interpret otherwise-unqualified dates and times in this zone.\n'
          + 'Elapsed since the preceding model-visible message: 1d 1h 1m 1s.',
      }],
    })
    expect(event.surfaceOp).toBe('append')
  })

  it('reports an unavailable first-step baseline when no model-visible message precedes it', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await mount()
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = Session.create(SessionId('unavailable'))
    session.append('turn/start', { turn: 1 })

    await fire(ctx, sessionAgent(session), 1, 1)

    expect(contextTexts(session)[0]).toContain(
      'Elapsed since the preceding model-visible message: unavailable.',
    )
  })

  it.each([
    ['omitted interval', {}],
    ['zero interval', { refreshIntervalMs: 0 }],
  ] as const)('uses the preceding durable step-context timestamp after step one with %s', async (_label, config) => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await mount(config)
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = Session.create(SessionId('later-step'))
    /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
    const agent = sessionAgent(session)
    openMessageTurn(session, 3)
    await fire(ctx, agent, 3, 1)
    vi.setSystemTime(BASE + 61_000)

    await fire(ctx, agent, 3, 2)

    expect(contextTexts(session)[1]).toBe(
      'Time sampled while preparing turn 3, step 2: 2026-07-14T00:01:01+00:00[UTC]\n'
      + 'Browser time zone for this request: unavailable. Ask the user to clarify otherwise-unqualified dates and times.\n'
      + 'Elapsed since the preceding step context: 1m 1s.',
    )
  })

  it('formats in one browser zone and falls back when steering supplies mixed zones', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await mount({ timeZone: 'UTC' })
    /** 中文说明：测试局部值 resolved，由紧邻初始化决定。 */
    const resolved = Session.create(SessionId('browser-zone-resolved'))
    openMessageTurn(resolved, 1, 'America/New_York')
    await fire(ctx, sessionAgent(resolved), 1, 1)
    expect(contextTexts(resolved)[0]).toContain(
      '2026-07-13T20:00:00-04:00[America/New_York]\n'
      + 'Browser time zone for this request: America/New_York. '
      + 'Interpret otherwise-unqualified dates and times in this zone.',
    )

    /** 中文说明：测试局部值 mixed，由紧邻初始化决定。 */
    const mixed = Session.create(SessionId('browser-zone-mixed'))
    openMessageTurn(mixed, 1, 'Asia/Shanghai')
    mixed.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'steering from another browser' }],
      source: {
        kind: 'user',
        rpcId: 'mixed-steer',
        clientTimeZone: 'America/New_York',
      } as never,
    }), { surfaceOp: 'append' })
    await fire(ctx, sessionAgent(mixed), 1, 1)
    expect(contextTexts(mixed)[0]).toContain(
      '2026-07-14T00:00:00+00:00[UTC]\n'
      + 'Browser time zone for this request: mixed ["America/New_York","Asia/Shanghai"]. '
      + 'Ask the user to clarify otherwise-unqualified dates and times.',
    )
  })

  it('reports an unavailable later-step baseline at the matching turn boundary', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await mount()
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = Session.create(SessionId('later-step-boundary'))
    openMessageTurn(session, 4)

    await fire(ctx, sessionAgent(session), 4, 2)

    expect(contextTexts(session)[0]).toContain(
      'Elapsed since the preceding step context: unavailable.',
    )
  })

  it('reports an unavailable later-step baseline when event lookup is exhausted', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await mount()
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = Session.create(SessionId('later-step-exhausted'))

    await fire(ctx, sessionAgent(session), 1, 2)

    expect(contextTexts(session)[0]).toContain(
      'Elapsed since the preceding step context: unavailable.',
    )
  })

  it('injects after backward wall-clock movement and clamps elapsed time to zero', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await mount({ refreshIntervalMs: 60_000 })
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = Session.create(SessionId('backward'))
    /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
    const agent = sessionAgent(session)
    openMessageTurn(session, 1)
    await fire(ctx, agent, 1, 1)
    vi.setSystemTime(BASE - 5_000)

    await fire(ctx, agent, 1, 2)

    expect(contextTexts(session)).toHaveLength(2)
    expect(contextTexts(session)[1]).toContain('Elapsed since the preceding step context: 0s.')
  })

  it('uses a shadowed durable injection after resume and injects at the exact threshold', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await mount({ refreshIntervalMs: 1_000 })
    /** 中文说明：测试局部值 original，由紧邻初始化决定。 */
    const original = Session.create(SessionId('seed-source'))
    openMessageTurn(original, 1)
    await fire(ctx, sessionAgent(original), 1, 1)
    /** 中文说明：测试局部值 user，由紧邻初始化决定。 */
    const user = original.events.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
    /** 中文说明：测试局部值 reading，由紧邻初始化决定。 */
    const reading = original.events.find(event => event.type === 'user/message' && event.data.source.kind === 'plugin')
    if (user === undefined || reading === undefined) throw new Error('missing source surface events')
    original.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'compacted history' }],
      source: { kind: 'plugin', plugin: 'compaction-basic' },
    }), {
      surfaceOp: { op: 'replace', start: user.seq, end: reading.seq },
      sourceEventSeqs: [user.seq, reading.seq],
    })
    original.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(JSON.stringify(original.deriveMessages())).not.toContain('Time sampled while preparing')

    /** 中文说明：测试局部值 resumed，由紧邻初始化决定。 */
    const resumed = Session.create(SessionId('resumed'), [...original.events])
    /** 中文说明：测试局部值 resumedAgent，由紧邻初始化决定。 */
    const resumedAgent = sessionAgent(resumed)
    vi.setSystemTime(BASE + 999)
    openMessageTurn(resumed, 2)
    /** 中文说明：测试局部值 beforeSkip，由紧邻初始化决定。 */
    const beforeSkip = resumed.events.length

    await fire(ctx, resumedAgent, 2, 1)

    expect(resumed.events).toHaveLength(beforeSkip)
    expect(contextTexts(resumed)).toHaveLength(1)

    vi.setSystemTime(BASE + 1_000)
    await fire(ctx, resumedAgent, 2, 2)

    expect(contextTexts(resumed)).toHaveLength(2)
    expect(contextTexts(resumed)[1]).toContain(
      'Elapsed since the preceding step context: unavailable.',
    )
  })

  it('applies a positive interval across turns without sharing state between sessions', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await mount({ refreshIntervalMs: 1_000 })
    /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
    const first = Session.create(SessionId('interval-first'))
    /** 中文说明：测试局部值 firstAgent，由紧邻初始化决定。 */
    const firstAgent = sessionAgent(first, 'first-agent')
    openMessageTurn(first, 1)
    await fire(ctx, firstAgent, 1, 1)
    first.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    vi.setSystemTime(BASE + 500)
    openMessageTurn(first, 2)
    /** 中文说明：测试局部值 beforeSkip，由紧邻初始化决定。 */
    const beforeSkip = first.events.length
    await fire(ctx, firstAgent, 2, 1)

    /** 中文说明：测试局部值 independent，由紧邻初始化决定。 */
    const independent = Session.create(SessionId('interval-independent'))
    openMessageTurn(independent, 1)
    await fire(ctx, sessionAgent(independent, 'independent-agent'), 1, 1)

    expect(first.events).toHaveLength(beforeSkip)
    expect(contextTexts(first)).toHaveLength(1)
    expect(contextTexts(independent)).toHaveLength(1)
  })

  it('skips an already-aborted prompt submission', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await mount()
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = Session.create(SessionId('ordering'))
    /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
    const agent = sessionAgent(session)
    openMessageTurn(session, 1)

    await fire(ctx, agent, 1, 1)
    /** 中文说明：测试局部值 abort，由紧邻初始化决定。 */
    const abort = new AbortController()
    abort.abort()
    await fire(ctx, agent, 1, 2, abort.signal)

    expect(contextTexts(session)).toHaveLength(1)
  })
})

describe('configuration and lifecycle', () => {
  it('defaults to the process system zone and retains the zone resolved at plugin load', async () => {
    process.env['TZ'] = 'Asia/Shanghai'
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await mount()
    process.env['TZ'] = 'America/New_York'
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = Session.create(SessionId('system-zone'))
    openMessageTurn(session, 1)

    await fire(ctx, sessionAgent(session), 1, 1)

    expect(contextTexts(session)[0]).toContain('2026-07-14T08:00:00+08:00[Asia/Shanghai]')
  })

  it('fails loud for an invalid explicit zone or an unavailable process zone', async () => {
    /** 中文说明：测试局部值 invalid，由紧邻初始化决定。 */
    const invalid = new Context()
    await invalid.plugin(AgentRegistry)
    await expect(invalid.plugin(timeContext, { timeZone: 'Not/A_Real_Zone' })).rejects.toThrow(
      /invalid IANA timeZone/,
    )

    vi.spyOn(Intl, 'DateTimeFormat').mockImplementationOnce(() => {
      throw new RangeError('system zone unavailable')
    })
    /** 中文说明：测试局部值 unresolved，由紧邻初始化决定。 */
    const unresolved = new Context()
    await unresolved.plugin(AgentRegistry)
    await expect(unresolved.plugin(timeContext, {})).rejects.toThrow(/failed to resolve the system time zone/)
  })

  it('rejects invalid refresh intervals at plugin load with one diagnostic', async () => {
    /** 中文说明：测试局部值 invalid，由紧邻初始化决定。 */
    const invalid = [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Number.POSITIVE_INFINITY, Number.NaN]
    /** 中文说明：测试局部值 refreshIntervalMs，由紧邻初始化决定。 */
    for (const refreshIntervalMs of invalid) {
      await expect(mount({ refreshIntervalMs })).rejects.toThrow(
        'time-context: refreshIntervalMs must be a non-negative safe integer',
      )
    }
  })

  it('removes its listener when the plugin fiber disposes', async () => {
    /** 中文说明：测试局部值 { ctx, fiber }，由紧邻初始化决定。 */
    const { ctx, fiber } = await mount()
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = Session.create(SessionId('dispose'))
    /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
    const agent = sessionAgent(session)
    openMessageTurn(session, 1)
    await fire(ctx, agent, 1, 1)

    await fiber.dispose()
    await fire(ctx, agent, 1, 2)

    expect(contextTexts(session)).toHaveLength(1)
  })
})

describe('real agent-loop request history', () => {
  it.each([
    ['throws'],
    ['cancels'],
  ] as const)('does not commit a preparation reading when a downstream pre-step listener %s', async (mode) => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
    const adapter = new ScriptedAdapter([textResponse('unused')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await loopHarness(adapter)
    ctx.on('agent/pre-step', ({ agent: subject }, next) => {
      if (mode === 'throws') throw new Error('later pre-step failure')
      subject.cancel({ kind: 'user' })
      return next()
    })
    /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
    const agent = ctx.agentLoop.create(SessionId(`late-${mode}`), { provider: 'mock', model: 'mock' })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'start' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    expect(contextTexts(agent.session)).toHaveLength(0)
    expect(adapter.requests).toHaveLength(0)
    expect(agent.session.events.some(event => event.type === 'step/start')).toBe(false)
    await ctx.fiber.dispose()
  })

  it('persists one ordered context per request, accumulates readings, and leaves system headers unchanged', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
    const adapter = new ScriptedAdapter([toolCallResponse(), textResponse('done')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await loopHarness(adapter)
    ctx.tools.register(defineContentToolFixture({
      name: 'tick',
      description: 'advance fake time',
      parameters: {},
      async execute() {
        vi.setSystemTime(BASE + 61_000)
        return [{ type: 'text' as const, text: 'advanced' }]
      },
    }))
    /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
    const agent = ctx.agentLoop.create(SessionId('loop'), { provider: 'mock', model: 'mock' })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'start' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(2)
    /** 中文说明：测试局部值 contexts，由紧邻初始化决定。 */
    const contexts = agent.session.events.filter(
      (event): event is SessionEvent<'user/message'> => event.type === 'user/message' && event.data.source.kind === 'plugin')
    /** 中文说明：测试局部值 starts，由紧邻初始化决定。 */
    const starts = agent.session.events.filter(event => event.type === 'step/start')
    expect(contexts).toHaveLength(adapter.requests.length)
    expect(starts).toHaveLength(adapter.requests.length)
    /** 中文说明：测试局部值 index，由紧邻初始化决定。 */
    for (let index = 0; index < contexts.length; index += 1) {
      expect(contexts[index]!.seq).toBeGreaterThan(starts[index]!.seq)
    }
    expect(contexts.every(event => event.data.source.kind === 'plugin'
      && event.data.source.plugin === 'time-context'
      && event.surfaceOp === 'append')).toBe(true)

    /** 中文说明：测试局部值 firstRequestText，由紧邻初始化决定。 */
    const firstRequestText = requestText(adapter.requests[0]!)
    /** 中文说明：测试局部值 secondRequestText，由紧邻初始化决定。 */
    const secondRequestText = requestText(adapter.requests[1]!)
    expect(firstRequestText).toContain('Time sampled while preparing turn 1, step 1:')
    expect(firstRequestText).toContain('Elapsed since the preceding model-visible message: unavailable.')
    expect(firstRequestText).not.toContain('Time sampled while preparing turn 1, step 2:')
    expect(secondRequestText).toContain('Time sampled while preparing turn 1, step 1:')
    expect(secondRequestText).toContain('Time sampled while preparing turn 1, step 2:')
    expect(secondRequestText).toContain('Elapsed since the preceding step context: 1m 1s.')

    /** 中文说明：测试局部值 request，由紧邻初始化决定。 */
    for (const request of adapter.requests) expect(request.system).not.toContain('Time sampled while preparing')
    /** 中文说明：测试局部值 headers，由紧邻初始化决定。 */
    const headers = agent.session.events.filter(event => event.type === 'request/header')
    expect(JSON.stringify(headers)).not.toContain('Time sampled while preparing')
    await ctx.fiber.dispose()
  })
})

describe('real Loader export path', () => {
  it('keeps namespace metadata and boots the agent listener through unwrapExports', async () => {
    expect('default' in timeContext).toBe(false)
    /** 中文说明：测试局部值 loader，由紧邻初始化决定。 */
    const loader = Object.create(Loader.prototype) as Loader
    /** 中文说明：测试局部值 unwrapped，由紧邻初始化决定。 */
    const unwrapped = loader.unwrapExports(timeContext) as Record<string, unknown>
    expect(unwrapped).toBe(timeContext)
    expect(unwrapped.name).toBe('time-context')
    expect(unwrapped.inject).toEqual(['agents'])
    expect(unwrapped.Config).toBeDefined()
    expect(typeof unwrapped.apply).toBe('function')

    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    /** 中文说明：测试局部值 plugin，由紧邻初始化决定。 */
    const plugin = loader.unwrapExports(timeContext) as Parameters<Context['plugin']>[0]
    await ctx.plugin(plugin)
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = Session.create(SessionId('loader'))
    openMessageTurn(session, 1)
    await fire(ctx, sessionAgent(session), 1, 1)
    expect(contextTexts(session)[0]).toContain('Time sampled while preparing turn 1, step 1:')
  })
})
