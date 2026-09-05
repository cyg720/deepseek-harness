/**
 * 文件职责：验证反馈记录的 command-feedback.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis Context、插件生命周期、React 和 Vitest。
 * 产品维度：保证反馈记录在配置、运行、失败和清理场景中可理解且可靠。
 * 逻辑维度：构造插件或沙箱，驱动操作并断言日志与清理。
 * 关键边界：沙箱与宿主 Context 不可混用；反馈追加新记录，不改写既有会话历史。
 * 新手阅读建议：先读类型和夹具，再按注册、执行、错误与卸载流程阅读。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore, { foldSurface, Session, SessionId } from '@deepseek-ai/dsh-session'
import { SessionTelemetryBackend, type SessionTelemetrySharingStatus } from '@deepseek-ai/dsh-session-telemetry'
import * as commandFeedback from '@deepseek-ai/dsh-command-feedback'

/** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
const { USER_ID, getOrCreateAnonymousUserId } = vi.hoisted(() => {
  /** 中文说明：测试局部值 USER_ID，由紧邻初始化决定。 */
  const USER_ID = '01234567-89ab-4cde-8f01-23456789abcd'
  return { USER_ID, getOrCreateAnonymousUserId: vi.fn(() => USER_ID) }
})

vi.mock('@deepseek-ai/dsh-anonymous-user-id', () => ({
  getOrCreateAnonymousUserId,
}))

beforeEach(() => getOrCreateAnonymousUserId.mockClear())

/** 中文说明：类型或类 Harness 约束扩展或反馈数据职责。 */
interface Harness {
  readonly ctx: Context
  readonly agent: Agent
  readonly session: Session
  readonly plugin: Awaited<ReturnType<Context['plugin']>>
}

/** Minimal mounted backend disclosing one sharing policy. */
/* 中文说明：类型或类 FakeTelemetry 约束扩展或反馈数据职责。 */
class FakeTelemetry extends SessionTelemetryBackend {
  override readonly sharing: SessionTelemetrySharingStatus

  constructor(ctx: Context, config: { sharing: SessionTelemetrySharingStatus }) {
    super(ctx)
    this.sharing = config.sharing
  }

  emit(): void {}

  async shutdown(): Promise<void> {}
}

/** Build a live idle agent over a store-owned session, as an app's spine does. */
/* 中文说明：函数 stubAgent 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function stubAgent(ctx: Context, id: string): { agent: Agent; session: Session } {
  /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
  const session = ctx.sessions.create(SessionId(id))
  /** 中文说明：测试局部值 inbox，由紧邻初始化决定。 */
  const inbox = new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
  /** 中文说明：测试局部值 status，由紧邻初始化决定。 */
  let status: AgentStatus = 'idle'
  /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
  const agent: Agent = {
    id: session.id,
    options: {},
    session,
    inbox,
    ctx: new Context(),
    get status() { return status },
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => {},
    cancel() { status = 'idle' },
    runMaintenance: task => task(new AbortController().signal),
    whenIdle() { return Promise.resolve() },
  }
  return { agent, session }
}

/**
 * Mount the real command registry, this producer, and optionally a telemetry
 * backend disclosing one sharing policy. Without `sharing`, no telemetry
 * service exists and the acknowledgement reports "not configured".
 */
/* 中文说明：函数 harness 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function harness(sharing?: SessionTelemetrySharingStatus): Promise<Harness> {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionStore)
  if (sharing !== undefined) await ctx.plugin(FakeTelemetry, { sharing })
  /** 中文说明：测试局部值 plugin，由紧邻初始化决定。 */
  const plugin = await ctx.plugin(commandFeedback)
  /** 中文说明：测试局部值 { agent, session }，由紧邻初始化决定。 */
  const { agent, session } = stubAgent(ctx, `command-feedback-${Math.random()}`)
  ctx.agents.register(agent)
  return { ctx, agent, session, plugin }
}

/** Execute `/feedback` through the same registry boundary as a UI adapter. */
/* 中文说明：函数 run 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function run(test: Harness, suffix = ''): Promise<{ kind: string; text?: string }> {
  /** 中文说明：测试局部值 settled，由紧邻初始化决定。 */
  const settled = await test.ctx.commands.execute(
    test.agent,
    `/feedback${suffix}`,
    [],
    new AbortController().signal,
  )
  if (settled === undefined) throw new Error('feedback command was not registered')
  return settled.result
}

/** Authoritative feedback payloads in log order. */
/* 中文说明：函数 feedbackTexts 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function feedbackTexts(session: Session): string[] {
  return session.snapshotEvents()
    .filter(event => event.type === 'feedback/record')
    .map(event => event.data.text)
}

describe('@deepseek-ai/dsh-command-feedback registration', () => {
  it('registers one global command with Loader-safe exports and disposes it', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness()
    expect(commandFeedback.name).toBe('command-feedback')
    expect(commandFeedback.inject).toEqual(['commands'])
    expect('default' in commandFeedback).toBe(false)
    /** 中文说明：测试局部值 loader，由紧邻初始化决定。 */
    const loader = Object.create(Loader.prototype) as Loader
    expect(loader.unwrapExports(commandFeedback)).toBe(commandFeedback)

    expect(test.ctx.commands.list(test.agent)).toContainEqual({
      name: 'feedback',
      description: 'record feedback about this session',
      input: { hint: '<text>' },
    })
    expect(test.ctx.commands.find(test.agent, 'feedback')).toMatchObject({ recordInput: false })

    await test.plugin.dispose()
    expect(test.ctx.commands.find(test.agent, 'feedback')).toBeUndefined()
  })
})

describe('/feedback human command', () => {
  it('acknowledges feedback and records its payload exactly once in the domain event', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness()
    await expect(run(test, ' the diff view is unreadable')).resolves.toEqual({
      kind: 'success',
      text: `Feedback recorded for session ${test.session.id}\nAnonymous user: ${USER_ID}. Session sharing is not configured.`,
    })
    expect(feedbackTexts(test.session)).toEqual(['the diff view is unreadable'])
    const commandRun = test.session.snapshotEvents().find(event => event.type === 'command/run')
    expect(commandRun?.type === 'command/run' && Object.hasOwn(commandRun.data, 'args')).toBe(false)
    expect(JSON.stringify(test.session.snapshotEvents()).match(/the diff view is unreadable/gu)).toHaveLength(1)
  })

  it('exports a command-independent feedback producer', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness()
    commandFeedback.recordFeedback(test.session, '  recorded outside a command  ')
    expect(test.session.snapshotEvents().map(event => event.type)).toEqual(['feedback/record'])
    expect(feedbackTexts(test.session)).toEqual(['recorded outside a command'])
    expect(() => { commandFeedback.recordFeedback(test.session, ' \n\t ') })
      .toThrow('feedback text must not be empty')
    expect(feedbackTexts(test.session)).toEqual(['recorded outside a command'])
  })

  it('keeps command bookkeeping around the authoritative feedback event', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness()
    await run(test, ' nothing else happens')
    expect(test.session.snapshotEvents().map(event => event.type)).toEqual([
      'command/run', 'feedback/record', 'command/done',
    ])
  })

  it('normalizes surrounding whitespace without parsing command-like content', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness()
    await run(test, ' /plan felt SLOW\n\ttwice today ')
    expect(feedbackTexts(test.session)).toEqual(['/plan felt SLOW\n\ttwice today'])
  })

  it('records each entry separately without replacing earlier ones', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness()
    await run(test, ' first')
    await run(test, ' second')
    expect(feedbackTexts(test.session)).toEqual(['first', 'second'])
  })

  it('records concurrent submissions in dispatch order', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness()
    /** 中文说明：测试局部值 signal，由紧邻初始化决定。 */
    const signal = new AbortController().signal
    // Command adapters may dispatch concurrent requests without awaiting one another.
    /** 中文说明：测试局部值 settled，由紧邻初始化决定。 */
    const settled = await Promise.all([
      test.ctx.commands.execute(test.agent, '/feedback first', [], signal),
      test.ctx.commands.execute(test.agent, '/feedback second', [], signal),
    ])
    expect(settled.map(item => item?.result)).toEqual([
      { kind: 'success', text: `Feedback recorded for session ${test.session.id}\nAnonymous user: ${USER_ID}. Session sharing is not configured.` },
      { kind: 'success', text: `Feedback recorded for session ${test.session.id}\nAnonymous user: ${USER_ID}. Session sharing is not configured.` },
    ])
    expect(feedbackTexts(test.session)).toEqual(['first', 'second'])
  })

  it('discloses full session sharing in the acknowledgement', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness('full')
    await expect(run(test, ' everything shared')).resolves.toEqual({
      kind: 'success',
      text: `Feedback recorded for session ${test.session.id}\nAnonymous user: ${USER_ID}. Session sharing is enabled.`,
    })
    expect(feedbackTexts(test.session)).toEqual(['everything shared'])
  })

  it('discloses feedback-gated session sharing in the acknowledgement', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness('feedback-only')
    await expect(run(test, ' gated sharing')).resolves.toEqual({
      kind: 'success',
      text: `Feedback recorded for session ${test.session.id}\nAnonymous user: ${USER_ID}. Session sharing is feedback-gated; recording feedback uploads the session records not yet shared.`,
    })
    expect(feedbackTexts(test.session)).toEqual(['gated sharing'])
  })

  it('discloses disabled session sharing in the acknowledgement', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness('disabled')
    await expect(run(test, ' local only')).resolves.toEqual({
      kind: 'success',
      text: `Feedback recorded for session ${test.session.id}\nAnonymous user: ${USER_ID}. Session sharing is disabled.`,
    })
    expect(feedbackTexts(test.session)).toEqual(['local only'])
  })

  it('keeps every recorded event out of model context and derived history', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness()
    await run(test, ' invisible to the model')
    for (const event of test.session.snapshotEvents()) {
      expect('surfaceOp' in event).toBe(false)
      expect(test.session.deriveEventMessage(event)).toBeNull()
    }
    expect(foldSurface(test.session.snapshotEvents()).nodes).toEqual([])
    expect(test.session.surface.nodes).toEqual([])
    expect(test.session.deriveMessages()).toEqual([])
  })

  it('rejects empty and whitespace-only input as a failed command record', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness()
    /** 中文说明：测试局部值 expected，由紧邻初始化决定。 */
    const expected = {
      kind: 'error',
      text: 'Feedback text is required. Usage: /feedback <text>',
    }
    await expect(run(test)).resolves.toEqual(expected)
    await expect(run(test, '   \n\t ')).resolves.toEqual(expected)
    expect(getOrCreateAnonymousUserId).not.toHaveBeenCalled()
    expect(feedbackTexts(test.session)).toEqual([])
    const done = test.session.snapshotEvents().filter(event => event.type === 'command/done')
    expect(done.map(event => event.data.kind)).toEqual(['error', 'error'])
    for (const event of test.session.snapshotEvents()) {
      if (event.type === 'command/run') expect(Object.hasOwn(event.data, 'args')).toBe(false)
    }
  })

  it('records nothing when dispatch rejects an already-cancelled request', async () => {
    /** 中文说明：测试局部值 test，由紧邻初始化决定。 */
    const test = await harness()
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()
    controller.abort(new Error('user cancelled the command'))
    await expect(test.ctx.commands.execute(test.agent, '/feedback too late', [], controller.signal))
      .rejects.toThrow('user cancelled the command')
    expect(test.session.snapshotEvents()).toEqual([])
  })
})
