/**
 * 文件职责：验证Agent Loop的 resume.spec.ts 行为与不变量。
 * 技术维度：Vitest、Cordis、会话事件、模型适配器和可控工具夹具。
 * 产品维度：防止Agent Loop在取消、恢复、错误或并发场景中产生回归。
 * 逻辑维度：构造服务与事件，驱动执行流程，再断言日志、请求、状态和清理。
 * 关键边界：测试后台任务必须结束；模型可见输入必须可从日志重建；工具调用顺序不可破坏。
 * 新手阅读建议：先读 mock/辅助函数，再按成功、错误、恢复和生命周期场景阅读。
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SESSION_FORMAT_VERSION, Session, SessionId, SessionPreparation } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'

import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { MockAdapter, textResponse } from './mock-adapter.ts'

/** 中文说明：测试局部值 dirs，由紧邻初始化决定，仅在当前场景使用。 */
const dirs: string[] = []
afterEach(async () => { for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }) })

/** 中文说明：测试辅助函数 persistentHarness 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
async function persistentHarness(adapter: MockAdapter): Promise<{ ctx: Context; root: string }> {
  /** 中文说明：测试局部值 root，由紧邻初始化决定，仅在当前场景使用。 */
  const root = await mkdtemp(join(tmpdir(), 'dsh-resume-'))
  dirs.push(root)
  return { ctx: await mountPersistentHarness(root, adapter), root }
}

/** 中文说明：测试辅助函数 mountPersistentHarness 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
async function mountPersistentHarness(root: string, adapter: MockAdapter): Promise<Context> {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(JsonlSessionPersistence, { root })
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

/** 中文说明：测试辅助函数 persistSession 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
async function persistSession(sessionId: SessionId): Promise<string> {
  /** 中文说明：测试局部值 { ctx, root }，由紧邻初始化决定，仅在当前场景使用。 */
  const { ctx, root } = await persistentHarness(new MockAdapter([textResponse('seed')]))
  // Persistence deliberately has no artifact for a truly empty session. A
  // balanced completed turn is the smallest resumable log and avoids running
  // the model merely to construct this lifecycle fixture.
  /** 中文说明：测试局部值 seed，由紧邻初始化决定，仅在当前场景使用。 */
  const seed: SessionEvent[] = [
    { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
    { type: 'turn/end', seq: 1, time: 2, data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  /** 中文说明：测试局部值 session，由紧邻初始化决定，仅在当前场景使用。 */
  const session = ctx.sessions.create(sessionId, { seed })
  await ctx.sessions.flush(session)
  await ctx.fiber.dispose()
  return root
}

/** Build a detached preparation for lifecycle-race test doubles. */
/** 中文说明：测试辅助函数 preparationFromSnapshot 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
function preparationFromSnapshot(
  ctx: Context,
  snapshot: { meta: SessionHeader; events: readonly SessionEvent[] },
): SessionPreparation {
  return SessionPreparation.create(ctx.sessions.prepare(snapshot.meta.id, {
    seed: structuredClone(snapshot.events) as SessionEvent[],
    meta: structuredClone(snapshot.meta),
    seedSource: 'persistence',
  }))
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

/** Fail a lifecycle regression promptly instead of waiting for Vitest's suite timeout. */
/** 中文说明：测试辅助函数 promptly 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
async function promptly<T>(job: Promise<T>): Promise<T> {
  /** 中文说明：测试局部值 timeout，由紧邻初始化决定，仅在当前场景使用。 */
  const timeout = Promise.withResolvers<never>()
  /** 中文说明：测试局部值 timer，由紧邻初始化决定，仅在当前场景使用。 */
  const timer = setTimeout(() => { timeout.reject(new Error('lifecycle task did not settle promptly')) }, 1000)
  try {
    return await Promise.race([job, timeout.promise])
  } finally {
    clearTimeout(timer)
  }
}

/** Throw an arbitrary callback value to exercise the public unknown-error boundary. */
/** 中文说明：测试辅助函数 throwUnknown 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
function throwUnknown(value: unknown): never {
  throw value
}

describe('the session-persistence Agent Note: AgentLoop factory create/resume', () => {
  it('resumes a pre-react-loop session including pre-identity message events', async () => {
    /** 中文说明：测试局部值 sessionId，由紧邻初始化决定，仅在当前场景使用。 */
    const sessionId = SessionId('pre-identity-resume')
    /** 中文说明：测试局部值 first，由紧邻初始化决定，仅在当前场景使用。 */
    const first = await persistentHarness(new MockAdapter([]))
    await first.ctx.sessionPersistence.create({
      version: SESSION_FORMAT_VERSION,
      id: sessionId,
      createdAt: 1,
    })
    await first.ctx.sessionPersistence.append(sessionId, [
      {
        type: 'turn/start', seq: 0, time: 1,
        data: { turn: 1, trigger: { kind: 'message', source: { kind: 'user' } } },
      },
      {
        type: 'user/message',
        seq: 1,
        time: 2,
        data: { content: [{ type: 'text', text: 'old question' }], source: { kind: 'user' } },
        surfaceOp: 'append',
      },
      { type: 'step/start', seq: 2, time: 3, data: { turn: 1, step: 1 } },
      {
        type: 'assistant/message',
        seq: 3,
        time: 4,
        data: {
          turn: 1,
          step: 1,
          content: [{ type: 'text', text: 'old answer' }],
          provenance: { provider: 'mock', model: 'mock' },
        },
        surfaceOp: 'append',
      },
      {
        type: 'steering/message',
        seq: 4,
        time: 5,
        data: {
          turn: 1,
          content: [{ type: 'text', text: 'old steering' }],
          source: { kind: 'user' },
        },
        surfaceOp: 'append',
      },
      { type: 'step/end', seq: 5, time: 6, data: { turn: 1, step: 1 } },
      { type: 'turn/end', seq: 6, time: 7, data: { turn: 1, reason: { kind: 'completed' } } },
    ] as unknown as SessionEvent[])
    await first.ctx.fiber.dispose()

    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await mountPersistentHarness(first.root, new MockAdapter([textResponse('new answer')]))
    /** 中文说明：测试局部值 handle，由紧邻初始化决定，仅在当前场景使用。 */
    const handle = await ctx.agents.resume({
      resumeSessionId: sessionId,
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    expect(handle.agent.session.deriveMessages()).toMatchObject([
      { id: `legacy-message:${sessionId}:1`, role: 'user' },
      { id: `legacy-message:${sessionId}:3`, role: 'assistant' },
      { id: `legacy-message:${sessionId}:4`, role: 'user' },
    ])
    expect(handle.agent.inbox.nextTurn).toEqual([])
    expect(handle.agent.inbox.nextStep).toEqual([])

    handle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'new question' }],
      source: { kind: 'user' },
    }))
    await waitForIdle(ctx, handle.agent)
    expect(handle.agent.session.deriveMessages()).toHaveLength(5)
    expect(handle.agent.session.events.at(-1)).toMatchObject({
      type: 'turn/end',
      data: { reason: { kind: 'completed' } },
    })
    await handle.dispose()
    await ctx.fiber.dispose()
  })

  it('normalizes a non-Error resume publication failure for rollback and rethrows it', async () => {
    /** 中文说明：测试局部值 sessionId，由紧邻初始化决定，仅在当前场景使用。 */
    const sessionId = SessionId('unknown-resume-failure-s')
    /** 中文说明：测试局部值 root，由紧邻初始化决定，仅在当前场景使用。 */
    const root = await persistSession(sessionId)
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await mountPersistentHarness(root, new MockAdapter([textResponse('next')]))
    /** 中文说明：测试局部值 failure，由紧邻初始化决定，仅在当前场景使用。 */
    const failure = { source: 'resume' }
    ctx.on('session/created', () => throwUnknown(failure))

    await expect(ctx.agents.resume({
      resumeSessionId: sessionId,
    })).rejects.toBe(failure)

    expect(ctx.agents.get(SessionId('unknown-resume-failure'))).toBeUndefined()
    expect(ctx.sessions.get(sessionId)).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('createAgent uses the caller-supplied sessionId (not ${id}-session)', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('hi')])
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定，仅在当前场景使用。 */
    const { ctx } = await persistentHarness(adapter)
    /** 中文说明：测试局部值 { agent }，由紧邻初始化决定，仅在当前场景使用。 */
    const { agent } = await ctx.agents.create({ sessionId: SessionId('custom-session'), meta: { cwd: '/w' } })
    expect(agent.session.id).toBe('custom-session')
    expect(agent.session.header.cwd).toBe('/w')
    await ctx.fiber.dispose()
  })

  it('createAgent rejects a duplicate identity without orphaning a session', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('hi')])
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定，仅在当前场景使用。 */
    const { ctx } = await persistentHarness(adapter)
    /** 中文说明：测试局部值 sessionId，由紧邻初始化决定，仅在当前场景使用。 */
    const sessionId = SessionId('sess-a')
    await ctx.agents.create({ sessionId })
    await expect(ctx.agents.create({ sessionId })).rejects.toThrow(/already exists/)
    expect(ctx.sessions.list()).toHaveLength(1)
    await ctx.fiber.dispose()
  })

  it('resume cannot crash-repair a turn owned by a live agent', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定，仅在当前场景使用。 */
    const { ctx } = await persistentHarness(new MockAdapter([textResponse('unused')]))
    /** 中文说明：测试局部值 sessionId，由紧邻初始化决定，仅在当前场景使用。 */
    const sessionId = SessionId('live-resume-race')
    /** 中文说明：测试局部值 first，由紧邻初始化决定，仅在当前场景使用。 */
    const first = (await ctx.agents.create({ sessionId })).agent
    first.session.append('turn/start', { turn: 1 })
    await ctx.sessions.flush(first.session)

    await expect(ctx.agents.resume({ resumeSessionId: sessionId }))
      .rejects.toThrow(/while it is live/)

    first.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await ctx.sessions.flush(first.session)
    /** 中文说明：测试局部值 loaded，由紧邻初始化决定，仅在当前场景使用。 */
    const loaded = await ctx.sessionPersistence.load(sessionId)
    expect(loaded.events.map(event => event.type)).toEqual(['turn/start', 'turn/end'])
    expect(loaded.events.at(-1)).toMatchObject({
      type: 'turn/end',
      data: { reason: { kind: 'completed' } },
    })
    await ctx.fiber.dispose()
  })

  it('createAgent works without meta (no cwd)', async () => {
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('hi')])
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定，仅在当前场景使用。 */
    const { ctx } = await persistentHarness(adapter)
    /** 中文说明：测试局部值 { agent }，由紧邻初始化决定，仅在当前场景使用。 */
    const { agent } = await ctx.agents.create({ sessionId: SessionId('nometa-session') })
    expect(agent.session.id).toBe('nometa-session')
    expect(agent.session.header.cwd).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('resume of a session with no cwd carries an undefined cwd header', async () => {
    // Lifecycle 1: create a no-cwd session and run a turn.
    /** 中文说明：测试局部值 adapter1，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter1 = new MockAdapter([textResponse('a')])
    /** 中文说明：测试局部值 { ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const { ctx: ctx1, root } = await persistentHarness(adapter1)
    /** 中文说明：测试局部值 a1，由紧邻初始化决定，仅在当前场景使用。 */
    const a1 = (await ctx1.agents.create({ sessionId: SessionId('nocwd-sess') })).agent
    a1.followup(createUserMessage({ content: [{ type: 'text', text: 'q' }], source: { kind: 'user' } }))
    await waitForIdle(ctx1, a1)
    await ctx1.fiber.dispose()

    // Lifecycle 2: resume it; the header cwd stays undefined (no-cwd branch).
    /** 中文说明：测试局部值 adapter2，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter2 = new MockAdapter([textResponse('b')])
    /** 中文说明：测试局部值 ctx2，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx2 = new Context()
    await ctx2.plugin(LlmRuntime)
    await ctx2.plugin(SessionStore)
    await ctx2.plugin(SystemPrompt)
    await ctx2.plugin(ToolRuntime)
    await ctx2.plugin(AgentRegistry)
    await ctx2.plugin(AgentLoop, { agents: [] })
    await ctx2.plugin(JsonlSessionPersistence, { root })
    ctx2.llm.registerAdapter(['mock'], adapter2)
    /** 中文说明：测试局部值 a2，由紧邻初始化决定，仅在当前场景使用。 */
    const a2 = (await ctx2.agents.resume({ resumeSessionId: SessionId('nocwd-sess') })).agent
    expect(a2.session.header.cwd).toBeUndefined()
    await ctx2.fiber.dispose()
  })

  it('agent/session-start fires "startup" for createAgent and "resume" for resume()', async () => {
    // Lifecycle 1: a fresh createAgent emits session-start with source 'startup'.
    /** 中文说明：测试局部值 adapter1，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter1 = new MockAdapter([textResponse('a')])
    /** 中文说明：测试局部值 { ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const { ctx: ctx1, root } = await persistentHarness(adapter1)
    /** 中文说明：测试局部值 sources1，由紧邻初始化决定，仅在当前场景使用。 */
    const sources1: string[] = []
    ctx1.on('agent/session-start', ({ source }) => void sources1.push(source))
    /** 中文说明：测试局部值 a1，由紧邻初始化决定，仅在当前场景使用。 */
    const a1 = (await ctx1.agents.create({ sessionId: SessionId('start-sess') })).agent
    expect(sources1).toEqual(['startup'])
    a1.followup(createUserMessage({ content: [{ type: 'text', text: 'q' }], source: { kind: 'user' } }))
    await waitForIdle(ctx1, a1)
    await ctx1.fiber.dispose()

    // Lifecycle 2: resuming the persisted session emits session-start 'resume'.
    /** 中文说明：测试局部值 adapter2，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter2 = new MockAdapter([textResponse('b')])
    /** 中文说明：测试局部值 ctx2，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx2 = new Context()
    await ctx2.plugin(LlmRuntime)
    await ctx2.plugin(SessionStore)
    await ctx2.plugin(SystemPrompt)
    await ctx2.plugin(ToolRuntime)
    await ctx2.plugin(AgentRegistry)
    await ctx2.plugin(AgentLoop, { agents: [] })
    await ctx2.plugin(JsonlSessionPersistence, { root })
    ctx2.llm.registerAdapter(['mock'], adapter2)
    /** 中文说明：测试局部值 sources2，由紧邻初始化决定，仅在当前场景使用。 */
    const sources2: string[] = []
    ctx2.on('agent/session-start', ({ source }) => void sources2.push(source))
    await ctx2.agents.resume({ resumeSessionId: SessionId('start-sess') })
    expect(sources2).toEqual(['resume'])
    await ctx2.fiber.dispose()
  })

  it('resume awaits setup while unpublished, then publishes a fully composed world in order', async () => {
    /** 中文说明：测试局部值 sessionId，由紧邻初始化决定，仅在当前场景使用。 */
    const sessionId = SessionId('resume-setup-success')
    /** 中文说明：测试局部值 root，由紧邻初始化决定，仅在当前场景使用。 */
    const root = await persistSession(sessionId)
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await mountPersistentHarness(root, new MockAdapter([textResponse('next')]))
    /** 中文说明：测试局部值 gate，由紧邻初始化决定，仅在当前场景使用。 */
    const gate = Promise.withResolvers<undefined>()
    /** 中文说明：测试局部值 setupStarted，由紧邻初始化决定，仅在当前场景使用。 */
    const setupStarted = Promise.withResolvers<undefined>()
    /** 中文说明：测试局部值 order，由紧邻初始化决定，仅在当前场景使用。 */
    const order: string[] = []

    ctx.on('session/created', (session) => {
      expect(ctx.sessions.get(session.id)).toBe(session)
      expect(ctx.agents.get(sessionId)?.session).toBe(session)
      order.push('session/created')
    })
    ctx.on('agent/created', ({ agent }) => {
      expect(agent.status).toBe('idle')
      order.push('agent/created')
    })
    ctx.on('agent/session-start', ({ agent }) => {
      expect(() => { agent.cancel({ kind: 'user' }) }).not.toThrow()
      order.push('agent/session-start')
    })

    /** 中文说明：测试局部值 resuming，由紧邻初始化决定，仅在当前场景使用。 */
    const resuming = ctx.agents.resume({
      resumeSessionId: sessionId,
      agentOptions: { provider: 'mock', model: 'mock' },
      setup: async (agentCtx) => {
        expect(agentCtx.agent?.id).toBe(sessionId)
        // The two persisted events plus the end-seed marker.
        expect(agentCtx.agent?.session.events).toHaveLength(3)
        agentCtx.on('session/created', () => void order.push('setup-listener:session/created'))
        agentCtx.on('agent/created', () => void order.push('setup-listener:agent/created'))
        order.push('setup:start')
        setupStarted.resolve(undefined)
        await gate.promise
        order.push('setup:end')
        return {
          commit: () => {
            expect(ctx.agents.get(sessionId)).toBeUndefined()
            expect(ctx.sessions.get(sessionId)).toBeUndefined()
            order.push('setup:commit')
          },
        }
      },
    })

    await setupStarted.promise
    expect(ctx.agents.get(sessionId)).toBeUndefined()
    expect(ctx.sessions.get(sessionId)).toBeUndefined()
    expect(order).toEqual(['setup:start'])

    gate.resolve(undefined)
    /** 中文说明：测试局部值 handle，由紧邻初始化决定，仅在当前场景使用。 */
    const handle = await resuming
    expect(order).toEqual([
      'setup:start',
      'setup:end',
      'setup:commit',
      'session/created',
      'setup-listener:session/created',
      'agent/created',
      'setup-listener:agent/created',
      'agent/session-start',
    ])
    await handle.dispose()
    await ctx.fiber.dispose()
  })

  it('successful resume disposal retires its caller-owned transaction effects', async () => {
    /** 中文说明：测试局部值 sessionId，由紧邻初始化决定，仅在当前场景使用。 */
    const sessionId = SessionId('resume-retired-effects-s')
    /** 中文说明：测试局部值 root，由紧邻初始化决定，仅在当前场景使用。 */
    const root = await persistSession(sessionId)
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await mountPersistentHarness(root, new MockAdapter([textResponse('next')]))
    /** 中文说明：测试局部值 handle，由紧邻初始化决定，仅在当前场景使用。 */
    const handle = await ctx.agents.resume({
      resumeSessionId: sessionId,
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    /** 中文说明：测试局部值 transactionLabels，由紧邻初始化决定，仅在当前场景使用。 */
    const transactionLabels = [`agentLoop.lifecycle(${sessionId})`]

    expect(ctx.fiber.getEffects().map(effect => effect.label)).toEqual(expect.arrayContaining(transactionLabels))
    await handle.dispose()
    expect(ctx.fiber.getEffects().filter(effect => transactionLabels.includes(effect.label))).toEqual([])
    await ctx.fiber.dispose()
  })

  it('resume setup rejection publishes nothing, unwinds, and releases the identity', async () => {
    /** 中文说明：测试局部值 sessionId，由紧邻初始化决定，仅在当前场景使用。 */
    const sessionId = SessionId('resume-setup-reject')
    /** 中文说明：测试局部值 root，由紧邻初始化决定，仅在当前场景使用。 */
    const root = await persistSession(sessionId)
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await mountPersistentHarness(root, new MockAdapter([textResponse('next')]))
    /** 中文说明：测试局部值 published，由紧邻初始化决定，仅在当前场景使用。 */
    const published: string[] = []
    ctx.on('session/created', () => void published.push('session/created'))
    ctx.on('agent/created', () => void published.push('agent/created'))
    ctx.on('agent/session-start', () => void published.push('agent/session-start'))

    await expect(ctx.agents.resume({
      resumeSessionId: sessionId,
      agentOptions: { provider: 'mock', model: 'mock' },
      setup: async () => {
        await Promise.resolve()
        throw new Error('resume setup failed')
      },
    })).rejects.toThrow('resume setup failed')

    expect(published).toEqual([])
    expect(ctx.agents.get(sessionId)).toBeUndefined()
    expect(ctx.sessions.get(sessionId)).toBeUndefined()
    /** 中文说明：测试局部值 retry，由紧邻初始化决定，仅在当前场景使用。 */
    const retry = await ctx.agents.resume({
      resumeSessionId: sessionId,
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    await retry.dispose()
    await ctx.fiber.dispose()
  })

  it('resume setup commit rejection publishes nothing and releases the identity', async () => {
    /** 中文说明：测试局部值 sessionId，由紧邻初始化决定，仅在当前场景使用。 */
    const sessionId = SessionId('resume-setup-commit-reject')
    /** 中文说明：测试局部值 root，由紧邻初始化决定，仅在当前场景使用。 */
    const root = await persistSession(sessionId)
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await mountPersistentHarness(root, new MockAdapter([textResponse('next')]))
    /** 中文说明：测试局部值 published，由紧邻初始化决定，仅在当前场景使用。 */
    const published: string[] = []
    ctx.on('session/created', () => void published.push('session/created'))
    ctx.on('agent/created', () => void published.push('agent/created'))

    await expect(ctx.agents.resume({
      resumeSessionId: sessionId,
      agentOptions: { provider: 'mock', model: 'mock' },
      setup: () => ({
        commit: () => { throw new Error('resume setup commit failed') },
      }),
    })).rejects.toThrow('resume setup commit failed')

    expect(published).toEqual([])
    expect(ctx.agents.get(sessionId)).toBeUndefined()
    expect(ctx.sessions.get(sessionId)).toBeUndefined()
    /** 中文说明：测试局部值 retry，由紧邻初始化决定，仅在当前场景使用。 */
    const retry = await ctx.agents.resume({
      resumeSessionId: sessionId,
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    await retry.dispose()
    await ctx.fiber.dispose()
  })

  it('owner unload aborts resume setup and cannot publish after the callback settles', async () => {
    /** 中文说明：测试局部值 sessionId，由紧邻初始化决定，仅在当前场景使用。 */
    const sessionId = SessionId('resume-setup-owner-unload')
    /** 中文说明：测试局部值 root，由紧邻初始化决定，仅在当前场景使用。 */
    const root = await persistSession(sessionId)
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await mountPersistentHarness(root, new MockAdapter([textResponse('next')]))
    /** 中文说明：测试局部值 gate，由紧邻初始化决定，仅在当前场景使用。 */
    const gate = Promise.withResolvers<undefined>()
    /** 中文说明：测试局部值 setupStarted，由紧邻初始化决定，仅在当前场景使用。 */
    const setupStarted = Promise.withResolvers<undefined>()
    /** 中文说明：测试局部值 published，由紧邻初始化决定，仅在当前场景使用。 */
    const published: string[] = []
    ctx.on('session/created', () => void published.push('session/created'))
    ctx.on('agent/created', () => void published.push('agent/created'))

    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定，仅在当前场景使用。 */
    let resuming!: ReturnType<typeof ctx.agents.resume>
    /** 中文说明：测试局部值 owner，由紧邻初始化决定，仅在当前场景使用。 */
    const owner = await ctx.plugin(Object.assign((inner: Context) => {
      resuming = inner.agents.resume({
        resumeSessionId: sessionId,
        agentOptions: { provider: 'mock', model: 'mock' },
        setup: async () => {
          setupStarted.resolve(undefined)
          await gate.promise
        },
      })
    }, { inject: ['agents'] }))
    await setupStarted.promise

    await owner.dispose()
    await expect(resuming).rejects.toThrow(/owner disposed during setup/)
    expect(published).toEqual([])
    expect(ctx.agents.get(sessionId)).toBeUndefined()
    expect(ctx.sessions.get(sessionId)).toBeUndefined()

    gate.resolve(undefined)
    await Promise.resolve()
    expect(published).toEqual([])
    await ctx.fiber.dispose()
  })

  it('owner unload aborts a never-settling persistence preparation, releases the identity, and blocks late publication', async () => {
    /** 中文说明：测试局部值 sessionId，由紧邻初始化决定，仅在当前场景使用。 */
    const sessionId = SessionId('resume-load-owner-unload')
    /** 中文说明：测试局部值 root，由紧邻初始化决定，仅在当前场景使用。 */
    const root = await persistSession(sessionId)
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await mountPersistentHarness(root, new MockAdapter([textResponse('next')]))
    /** 中文说明：测试局部值 snapshot，由紧邻初始化决定，仅在当前场景使用。 */
    const snapshot = await ctx.sessionPersistence.load(sessionId)
    /** 中文说明：测试局部值 abandoned，由紧邻初始化决定，仅在当前场景使用。 */
    const abandoned = preparationFromSnapshot(ctx, snapshot)
    /** 中文说明：测试局部值 latePreparation，由紧邻初始化决定，仅在当前场景使用。 */
    const latePreparation = Promise.withResolvers<SessionPreparation>()
    /** 中文说明：测试局部值 preparationStarted，由紧邻初始化决定，仅在当前场景使用。 */
    const preparationStarted = Promise.withResolvers<undefined>()
    /** 中文说明：测试局部值 originalPrepare，由紧邻初始化决定，仅在当前场景使用。 */
    const originalPrepare = ctx.sessionPersistence.prepare.bind(ctx.sessionPersistence)
    /** 中文说明：测试局部值 preparations，由紧邻初始化决定，仅在当前场景使用。 */
    let preparations = 0
    ctx.sessionPersistence.prepare = (id, signal) => {
      expect(id).toBe(sessionId)
      preparations += 1
      if (preparations === 1) {
        preparationStarted.resolve(undefined)
        return latePreparation.promise
      }
      return originalPrepare(id, signal)
    }

    /** 中文说明：测试局部值 published，由紧邻初始化决定，仅在当前场景使用。 */
    const published: string[] = []
    ctx.on('session/created', () => void published.push('session/created'))
    ctx.on('agent/created', () => void published.push('agent/created'))
    ctx.on('agent/session-start', () => void published.push('agent/session-start'))

    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定，仅在当前场景使用。 */
    let resuming!: ReturnType<typeof ctx.agents.resume>
    /** 中文说明：测试局部值 owner，由紧邻初始化决定，仅在当前场景使用。 */
    const owner = await ctx.plugin(Object.assign((inner: Context) => {
      resuming = inner.agents.resume({ resumeSessionId: sessionId, agentOptions: { provider: 'mock', model: 'mock' } })
    }, { inject: ['agents'] }))
    await preparationStarted.promise

    /** 中文说明：测试局部值 rejection，由紧邻初始化决定，仅在当前场景使用。 */
    const rejection = expect(promptly(resuming)).rejects.toThrow(/owner disposed during setup/)
    await promptly(owner.dispose())
    expect(published).toEqual([])
    expect(ctx.agents.get(sessionId)).toBeUndefined()
    expect(ctx.sessions.get(sessionId)).toBeUndefined()

    // owner.dispose() awaited transaction settlement, so the same identities
    // can be reused before awaiting the public rejection.
    /** 中文说明：测试局部值 retry，由紧邻初始化决定，仅在当前场景使用。 */
    const retry = await promptly(ctx.agents.resume({ resumeSessionId: sessionId, agentOptions: { provider: 'mock', model: 'mock' } }))
    await rejection
    expect(preparations).toBe(2)
    expect(published).toEqual(['session/created', 'agent/created', 'agent/session-start'])

    // Settlement of the abandoned backend promise cannot resume the old
    // transaction or emit a second publication after the retry owns the ids.
    latePreparation.resolve(abandoned)
    await Promise.resolve()
    await Promise.resolve()
    expect(ctx.agents.get(sessionId)).toBe(retry.agent)
    expect(ctx.sessions.get(sessionId)).toBe(retry.agent.session)
    expect(published).toEqual(['session/created', 'agent/created', 'agent/session-start'])

    abandoned[Symbol.dispose]()
    await retry.dispose()
    await ctx.fiber.dispose()
  })

  it('AgentLoop unload aborts persistence preparation and awaits wrapper settlement', async () => {
    /** 中文说明：测试局部值 sessionId，由紧邻初始化决定，仅在当前场景使用。 */
    const sessionId = SessionId('resume-load-factory-unload')
    /** 中文说明：测试局部值 root，由紧邻初始化决定，仅在当前场景使用。 */
    const root = await persistSession(sessionId)
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    /** 中文说明：测试局部值 loopFiber，由紧邻初始化决定，仅在当前场景使用。 */
    const loopFiber = await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(JsonlSessionPersistence, { root })
    ctx.llm.registerAdapter(['mock'], new MockAdapter([textResponse('next')]))

    /** 中文说明：测试局部值 snapshot，由紧邻初始化决定，仅在当前场景使用。 */
    const snapshot = await ctx.sessionPersistence.load(sessionId)
    /** 中文说明：测试局部值 abandoned，由紧邻初始化决定，仅在当前场景使用。 */
    const abandoned = preparationFromSnapshot(ctx, snapshot)
    /** 中文说明：测试局部值 latePreparation，由紧邻初始化决定，仅在当前场景使用。 */
    const latePreparation = Promise.withResolvers<SessionPreparation>()
    /** 中文说明：测试局部值 preparationStarted，由紧邻初始化决定，仅在当前场景使用。 */
    const preparationStarted = Promise.withResolvers<undefined>()
    ctx.sessionPersistence.prepare = (id) => {
      expect(id).toBe(sessionId)
      preparationStarted.resolve(undefined)
      return latePreparation.promise
    }
    /** 中文说明：测试局部值 published，由紧邻初始化决定，仅在当前场景使用。 */
    const published: string[] = []
    ctx.on('session/created', () => void published.push('session/created'))
    ctx.on('agent/created', () => void published.push('agent/created'))

    /** 中文说明：测试局部值 resuming，由紧邻初始化决定，仅在当前场景使用。 */
    const resuming = ctx.agents.resume({ resumeSessionId: sessionId, agentOptions: { provider: 'mock', model: 'mock' } })
    await preparationStarted.promise
    /** 中文说明：测试局部值 rejection，由紧邻初始化决定，仅在当前场景使用。 */
    const rejection = expect(promptly(resuming)).rejects.toThrow(/agent loop is not active/)
    await promptly(loopFiber.dispose())
    await rejection

    expect(published).toEqual([])
    expect(ctx.agents.get(sessionId)).toBeUndefined()
    expect(ctx.sessions.get(sessionId)).toBeUndefined()
    latePreparation.resolve(abandoned)
    await Promise.resolve()
    await Promise.resolve()
    expect(published).toEqual([])
    abandoned[Symbol.dispose]()
    await ctx.fiber.dispose()
  })

  it('resume of a forked session preserves the lineage, seed boundary, and delegation depth in the header', async () => {
    // Lifecycle 1: persist a FORKED session (carries parentSession + seedLength
    // in its header) by creating it with a complete-turn seed — the write path
    // materializes the fork (header + seed) on disk.
    /** 中文说明：测试局部值 seed，由紧邻初始化决定，仅在当前场景使用。 */
    const seed: SessionEvent[] = [
      { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
      { type: 'turn/end', seq: 1, time: 2, data: { turn: 1, reason: { kind: 'completed' } } },
    ]
    /** 中文说明：测试局部值 adapter1，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter1 = new MockAdapter([textResponse('a')])
    /** 中文说明：测试局部值 { ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const { ctx: ctx1, root } = await persistentHarness(adapter1)
    /** 中文说明：测试局部值 forked，由紧邻初始化决定，仅在当前场景使用。 */
    const forked = ctx1.sessions.create(SessionId('forked-sess'), {
      seed,
      meta: { cwd: '/w', parentSession: SessionId('parent-sess'), seedLength: seed.length, delegationDepth: 1 },
    })
    await ctx1.sessions.flush(forked)
    await ctx1.fiber.dispose()

    // Lifecycle 2: resume it; the parentSession + seedLength header survives the
    // round-trip (exercises resume's parentSession- and seedLength-present
    // branches). seedLength must come from the PERSISTED header, not from the
    // resume seed length (which is the whole stored log, not the original
    // boundary).
    /** 中文说明：测试局部值 adapter2，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter2 = new MockAdapter([textResponse('b')])
    /** 中文说明：测试局部值 ctx2，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx2 = new Context()
    await ctx2.plugin(LlmRuntime)
    await ctx2.plugin(SessionStore)
    await ctx2.plugin(SystemPrompt)
    await ctx2.plugin(ToolRuntime)
    await ctx2.plugin(AgentRegistry)
    await ctx2.plugin(AgentLoop, { agents: [] })
    await ctx2.plugin(JsonlSessionPersistence, { root })
    ctx2.llm.registerAdapter(['mock'], adapter2)
    /** 中文说明：测试局部值 a2，由紧邻初始化决定，仅在当前场景使用。 */
    const a2 = (await ctx2.agents.resume({ resumeSessionId: SessionId('forked-sess') })).agent
    expect(a2.session.header.parentSession).toBe('parent-sess')
    expect(a2.session.header.cwd).toBe('/w')
    expect(a2.session.header.seedLength).toBe(seed.length)
    // The recursion budget survives resume — a dropped depth would let a
    // resumed child delegate as if it were top-level.
    expect(a2.session.header.delegationDepth).toBe(1)
    await ctx2.fiber.dispose()
  })

  it('a pending idle inject() survives persist + resume without a synthetic turn', async () => {
    /** 中文说明：测试局部值 adapter1，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter1 = new MockAdapter([textResponse('answer')])
    /** 中文说明：测试局部值 { ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const { ctx: ctx1, root } = await persistentHarness(adapter1)
    /** 中文说明：测试局部值 a1，由紧邻初始化决定，仅在当前场景使用。 */
    const a1 = (await ctx1.agents.create({ sessionId: SessionId('inject-sess'), meta: { cwd: '/w' } })).agent
    a1.followup(createUserMessage({ content: [{ type: 'text', text: 'q' }], source: { kind: 'user' } }))
    await waitForIdle(ctx1, a1)
    a1.inject(createUserMessage({ content: [{ type: 'text', text: 'background job 42 finished' }], source: { kind: 'plugin', plugin: 'tool-bash' } }))
    await a1.whenIdle()
    await ctx1.sessions.flush(a1.session)

    // Lifecycle 2: resume; the injected context is still pending and becomes
    // model-visible when the next turn admits it.
    /** 中文说明：测试局部值 adapter2，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter2 = new MockAdapter([textResponse('next')])
    /** 中文说明：测试局部值 ctx2，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx2 = new Context()
    await ctx2.plugin(LlmRuntime)
    await ctx2.plugin(SessionStore)
    await ctx2.plugin(SystemPrompt)
    await ctx2.plugin(ToolRuntime)
    await ctx2.plugin(AgentRegistry)
    await ctx2.plugin(AgentLoop, { agents: [] })
    await ctx2.plugin(JsonlSessionPersistence, { root })
    ctx2.llm.registerAdapter(['mock'], adapter2)
    /** 中文说明：测试局部值 loaded，由紧邻初始化决定，仅在当前场景使用。 */
    const loaded = await ctx2.sessionPersistence.load(SessionId('inject-sess'))
    expect(loaded.events.some(event => event.type === 'agent/inbox/spliced')).toBe(true)
    expect(JSON.stringify(loaded.events)).toContain('background job 42 finished')
    /** 中文说明：测试局部值 a2，由紧邻初始化决定，仅在当前场景使用。 */
    const a2 = (await ctx2.agents.resume({ resumeSessionId: SessionId('inject-sess') })).agent
    expect(JSON.stringify(a2.inbox.nextStep)).toContain('background job 42 finished')
    a2.followup(createUserMessage({ content: [{ type: 'text', text: 'continue' }], source: { kind: 'user' } }))
    await waitForIdle(ctx2, a2)
    /** 中文说明：测试局部值 flat，由紧邻初始化决定，仅在当前场景使用。 */
    const flat = JSON.stringify(a2.session.deriveMessages())
    expect(flat).toContain('background job 42 finished')
    await ctx2.fiber.dispose()
    await ctx1.fiber.dispose()
  })

  it('resume reloads a persisted session: history + turn numbering continue, no duplicate seqs', async () => {
    // Lifecycle 1: run one full turn, persisting it.
    /** 中文说明：测试局部值 adapter1，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter1 = new MockAdapter([textResponse('first answer')])
    /** 中文说明：测试局部值 { ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const { ctx: ctx1, root } = await persistentHarness(adapter1)
    /** 中文说明：测试局部值 a1，由紧邻初始化决定，仅在当前场景使用。 */
    const a1 = (await ctx1.agents.create({ sessionId: SessionId('sess-resume'), meta: { cwd: '/w' } })).agent
    a1.followup(createUserMessage({ content: [{ type: 'text', text: 'first question' }], source: { kind: 'user' } }))
    await waitForIdle(ctx1, a1)
    /** 中文说明：测试局部值 events1，由紧邻初始化决定，仅在当前场景使用。 */
    const events1 = [...a1.session.events]
    /** 中文说明：测试局部值 seqs1，由紧邻初始化决定，仅在当前场景使用。 */
    const seqs1 = events1.map(e => e.seq)
    expect(seqs1).toEqual([...seqs1].sort((x, y) => x - y)) // contiguous
    await ctx1.fiber.dispose()

    // Lifecycle 2: a brand-new context over the SAME root; resume the session.
    /** 中文说明：测试局部值 adapter2，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter2 = new MockAdapter([textResponse('second answer')])
    /** 中文说明：测试局部值 ctx2，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx2 = new Context()
    await ctx2.plugin(LlmRuntime)
    await ctx2.plugin(SessionStore)
    await ctx2.plugin(SystemPrompt)
    await ctx2.plugin(ToolRuntime)
    await ctx2.plugin(AgentRegistry)
    await ctx2.plugin(AgentLoop, { agents: [] })
    await ctx2.plugin(JsonlSessionPersistence, { root })
    ctx2.llm.registerAdapter(['mock'], adapter2)

    /** 中文说明：测试局部值 a2，由紧邻初始化决定，仅在当前场景使用。 */
    const a2 = (await ctx2.agents.resume({ resumeSessionId: SessionId('sess-resume') })).agent
    // The resumed session carries the prior history…
    expect(a2.session.id).toBe('sess-resume')
    // …followed by one end-seed event marking the constructor seed.
    expect(a2.session.events.length).toBe(events1.length + 1)
    expect(a2.session.firstLiveSeq).toBe(events1.length)
    expect(a2.session.events.at(-1)?.type).toBe('session/end-seed')
    /** 中文说明：测试局部值 replay，由紧邻初始化决定，仅在当前场景使用。 */
    const replay = Session.create(SessionId('replay'), events1)
    expect(a2.session.deriveMessages()).toEqual(replay.deriveMessages())

    // …and a new turn continues numbering (turn 2) with contiguous seqs.
    a2.followup(createUserMessage({ content: [{ type: 'text', text: 'second question' }], source: { kind: 'user' } }))
    await waitForIdle(ctx2, a2)
    /** 中文说明：测试局部值 allSeqs，由紧邻初始化决定，仅在当前场景使用。 */
    const allSeqs = a2.session.events.map(e => e.seq)
    expect(allSeqs).toEqual(allSeqs.map((_, i) => i)) // 0..N contiguous, no duplicates
    /** 中文说明：测试局部值 turnStarts，由紧邻初始化决定，仅在当前场景使用。 */
    const turnStarts = a2.session.events.filter(e => e.type === 'turn/start')
    expect(turnStarts.map(e => e.type === 'turn/start' && e.data.turn)).toEqual([1, 2])
    await ctx2.fiber.dispose()
  })

  it('resume rejects when session persistence is not configured', async () => {
    // A harness WITHOUT the persistence plugin.
    /** 中文说明：测试局部值 adapter，由紧邻初始化决定，仅在当前场景使用。 */
    const adapter = new MockAdapter([textResponse('x')])
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })
    ctx.llm.registerAdapter(['mock'], adapter)
    await expect(ctx.agents.resume({ resumeSessionId: SessionId('nope') }))
      .rejects.toThrow(/session persistence is not configured/)
    await ctx.fiber.dispose()
  })
})

describe('creation and resume cancellation edges', () => {
  it('rejects create() with a pre-aborted signal, including a non-Error reason', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定，仅在当前场景使用。 */
    const { ctx } = await persistentHarness(new MockAdapter([]))

    /** 中文说明：测试局部值 errorReason，由紧邻初始化决定，仅在当前场景使用。 */
    const errorReason = new AbortController()
    errorReason.abort(new Error('caller gave up'))
    await expect(promptly(ctx.agents.create({
      sessionId: SessionId('pre-aborted-error'),
      agentOptions: { provider: 'mock', model: 'mock' },
      signal: errorReason.signal,
    }))).rejects.toThrow('caller gave up')

    // A non-Error reason is wrapped into the creation-aborted error.
    /** 中文说明：测试局部值 stringReason，由紧邻初始化决定，仅在当前场景使用。 */
    const stringReason = new AbortController()
    stringReason.abort('operator string reason')
    await expect(promptly(ctx.agents.create({
      sessionId: SessionId('pre-aborted-string'),
      agentOptions: { provider: 'mock', model: 'mock' },
      signal: stringReason.signal,
    }))).rejects.toThrow(/creation aborted/)

    expect(ctx.agents.get(SessionId('pre-aborted-error'))).toBeUndefined()
    expect(ctx.agents.get(SessionId('pre-aborted-string'))).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('a non-Error abort reason arriving during setup is wrapped for the caller', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定，仅在当前场景使用。 */
    const { ctx } = await persistentHarness(new MockAdapter([]))
    /** 中文说明：测试局部值 controller，由紧邻初始化决定，仅在当前场景使用。 */
    const controller = new AbortController()
    /** 中文说明：测试局部值 setupEntered，由紧邻初始化决定，仅在当前场景使用。 */
    const setupEntered = Promise.withResolvers<undefined>()
    /** 中文说明：测试局部值 setupGate，由紧邻初始化决定，仅在当前场景使用。 */
    const setupGate = Promise.withResolvers<undefined>()

    /** 中文说明：测试局部值 creating，由紧邻初始化决定，仅在当前场景使用。 */
    const creating = ctx.agents.create({
      sessionId: SessionId('setup-string-abort'),
      agentOptions: { provider: 'mock', model: 'mock' },
      signal: controller.signal,
      async setup() {
        setupEntered.resolve(undefined)
        await setupGate.promise
      },
    })
    await setupEntered.promise
    controller.abort('mid-setup string reason')
    setupGate.resolve(undefined)

    await expect(promptly(creating)).rejects.toThrow(/creation aborted/)
    expect(ctx.agents.get(SessionId('setup-string-abort'))).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('rejects when setup synchronously aborts its caller signal', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定，仅在当前场景使用。 */
    const { ctx } = await persistentHarness(new MockAdapter([]))
    /** 中文说明：测试局部值 controller，由紧邻初始化决定，仅在当前场景使用。 */
    const controller = new AbortController()

    /** 中文说明：测试局部值 creating，由紧邻初始化决定，仅在当前场景使用。 */
    const creating = ctx.agents.create({
      sessionId: SessionId('setup-synchronous-abort'),
      agentOptions: { provider: 'mock', model: 'mock' },
      signal: controller.signal,
      setup() {
        controller.abort(new Error('setup synchronously cancelled'))
      },
    })

    await expect(promptly(creating)).rejects.toThrow('setup synchronously cancelled')
    expect(ctx.agents.get(SessionId('setup-synchronous-abort'))).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('resume with a pre-aborted caller signal rejects out of the load race', async () => {
    /** 中文说明：测试局部值 sessionId，由紧邻初始化决定，仅在当前场景使用。 */
    const sessionId = SessionId('resume-pre-aborted')
    /** 中文说明：测试局部值 root，由紧邻初始化决定，仅在当前场景使用。 */
    const root = await persistSession(sessionId)
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await mountPersistentHarness(root, new MockAdapter([]))
    /** 中文说明：测试局部值 controller，由紧邻初始化决定，仅在当前场景使用。 */
    const controller = new AbortController()
    controller.abort(new Error('resume abandoned'))

    await expect(promptly(ctx.agents.resume({
      resumeSessionId: sessionId,
      agentOptions: { provider: 'mock', model: 'mock' },
      signal: controller.signal,
    }))).rejects.toThrow('resume abandoned')

    /** 中文说明：测试局部值 stringReason，由紧邻初始化决定，仅在当前场景使用。 */
    const stringReason = new AbortController()
    stringReason.abort('resume string reason')
    await expect(promptly(ctx.agents.resume({
      resumeSessionId: sessionId,
      agentOptions: { provider: 'mock', model: 'mock' },
      signal: stringReason.signal,
    }))).rejects.toThrow(/creation aborted/)

    expect(ctx.agents.get(sessionId)).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('releases a restored preparation if the loop becomes inactive before setup', async () => {
    /** 中文说明：测试局部值 sessionId，由紧邻初始化决定，仅在当前场景使用。 */
    const sessionId = SessionId('resume-loop-inactive-after-prepare')
    /** 中文说明：测试局部值 root，由紧邻初始化决定，仅在当前场景使用。 */
    const root = await persistSession(sessionId)
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await mountPersistentHarness(root, new MockAdapter([]))
    /** 中文说明：测试局部值 loop，由紧邻初始化决定，仅在当前场景使用。 */
    const loop = ctx.agentLoop as unknown as {
      ownership: { isActive: () => boolean }
    }
    vi.spyOn(loop.ownership, 'isActive').mockReturnValueOnce(false)

    await expect(ctx.agents.resume({
      resumeSessionId: sessionId,
      agentOptions: { provider: 'mock', model: 'mock' },
    })).rejects.toThrow('agent loop is not active')
    expect(ctx.agents.get(sessionId)).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('factory teardown during a hung resume preparation rejects with loop-inactive', async () => {
    /** 中文说明：测试局部值 sessionId，由紧邻初始化决定，仅在当前场景使用。 */
    const sessionId = SessionId('resume-loop-teardown')
    /** 中文说明：测试局部值 root，由紧邻初始化决定，仅在当前场景使用。 */
    const root = await persistSession(sessionId)
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await mountPersistentHarness(root, new MockAdapter([]))
    /** 中文说明：测试局部值 snapshot，由紧邻初始化决定，仅在当前场景使用。 */
    const snapshot = await ctx.sessionPersistence.load(sessionId)
    /** 中文说明：测试局部值 abandoned，由紧邻初始化决定，仅在当前场景使用。 */
    const abandoned = preparationFromSnapshot(ctx, snapshot)
    /** 中文说明：测试局部值 gate，由紧邻初始化决定，仅在当前场景使用。 */
    const gate = Promise.withResolvers<SessionPreparation>()
    /** 中文说明：测试局部值 preparationStarted，由紧邻初始化决定，仅在当前场景使用。 */
    const preparationStarted = Promise.withResolvers<undefined>()
    ctx.sessionPersistence.prepare = () => {
      preparationStarted.resolve(undefined)
      return gate.promise
    }

    /** 中文说明：测试局部值 resuming，由紧邻初始化决定，仅在当前场景使用。 */
    const resuming = ctx.agents.resume({
      resumeSessionId: sessionId,
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    await preparationStarted.promise
    // Resolve the preparation only after teardown began: the post-prepare ownership
    // check, not the abort race, must reject the wrapper.
    /** 中文说明：测试局部值 rejection，由紧邻初始化决定，仅在当前场景使用。 */
    const rejection = expect(promptly(resuming)).rejects.toThrow()
    /** 中文说明：测试局部值 disposal，由紧邻初始化决定，仅在当前场景使用。 */
    const disposal = ctx.fiber.dispose()
    gate.resolve(abandoned)
    await rejection
    await disposal
    abandoned[Symbol.dispose]()
  })
})

describe('configured-start failure edges', () => {
  it('a non-Error mid-prepare abort reason is wrapped for the resume caller', async () => {
    /** 中文说明：测试局部值 sessionId，由紧邻初始化决定，仅在当前场景使用。 */
    const sessionId = SessionId('resume-string-mid-abort')
    /** 中文说明：测试局部值 root，由紧邻初始化决定，仅在当前场景使用。 */
    const root = await persistSession(sessionId)
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await mountPersistentHarness(root, new MockAdapter([]))
    /** 中文说明：测试局部值 gate，由紧邻初始化决定，仅在当前场景使用。 */
    const gate = Promise.withResolvers<never>()
    gate.promise.catch(() => undefined)
    /** 中文说明：测试局部值 preparationStarted，由紧邻初始化决定，仅在当前场景使用。 */
    const preparationStarted = Promise.withResolvers<undefined>()
    ctx.sessionPersistence.prepare = () => {
      preparationStarted.resolve(undefined)
      return gate.promise
    }
    /** 中文说明：测试局部值 controller，由紧邻初始化决定，仅在当前场景使用。 */
    const controller = new AbortController()

    /** 中文说明：测试局部值 resuming，由紧邻初始化决定，仅在当前场景使用。 */
    const resuming = ctx.agents.resume({
      resumeSessionId: sessionId,
      agentOptions: { provider: 'mock', model: 'mock' },
      signal: controller.signal,
    })
    await preparationStarted.promise
    controller.abort('operator string reason')

    await expect(promptly(resuming)).rejects.toThrow(/creation aborted/)
    expect(ctx.agents.get(sessionId)).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('a failing exact-id restore over an existing artifact stays loud', async () => {
    /** 中文说明：测试局部值 sessionId，由紧邻初始化决定，仅在当前场景使用。 */
    const sessionId = SessionId('config-existing-corrupt')
    /** 中文说明：测试局部值 root，由紧邻初始化决定，仅在当前场景使用。 */
    const root = await persistSession(sessionId)
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await mountPersistentHarness(root, new MockAdapter([]))
    // The artifact exists (list reports it) but its load fails: this is
    // corruption, not first creation — the failure must be reported, and no
    // fresh same-id session may shadow the broken one.
    ctx.sessionPersistence.prepare = () => Promise.reject(new Error('artifact corrupt'))

    /** 中文说明：测试局部值 configured，由紧邻初始化决定，仅在当前场景使用。 */
    const configured = new Context()
    await configured.plugin(LlmRuntime)
    await configured.plugin(SessionStore)
    await configured.plugin(SystemPrompt)
    await configured.plugin(ToolRuntime)
    await configured.plugin(AgentRegistry)
    await configured.plugin(JsonlSessionPersistence, { root })
    configured.llm.registerAdapter(['mock'], new MockAdapter([]))
    configured.sessionPersistence.prepare = (id, signal) => ctx.sessionPersistence.prepare(id, signal)
    /** 中文说明：测试局部值 configFailures，由紧邻初始化决定，仅在当前场景使用。 */
    const configFailures: unknown[] = []
    configured.on('agent-loop/config-start-failed', ({ error }) => { configFailures.push(error) })
    /** 中文说明：测试局部值 configWarnings，由紧邻初始化决定，仅在当前场景使用。 */
    const configWarnings: string[] = []
    /** 中文说明：测试局部值 configWarn，由紧邻初始化决定，仅在当前场景使用。 */
    const configWarn = configured.logger.warn.bind(configured.logger)
    configured.logger.warn = ((...args: unknown[]) => {
      if (typeof args[0] === 'string') configWarnings.push(args[0])
      return (configWarn as (...a: unknown[]) => unknown)(...args)
    }) as typeof configured.logger.warn
    /** 中文说明：测试局部值 loop，由紧邻初始化决定，仅在当前场景使用。 */
    const loop = await configured.plugin(AgentLoop, {
      agents: [{ id: 'main', sessionId, provider: 'mock', model: 'mock' }],
    })
    await expect.poll(() => configFailures.length).toBe(1)
    expect(configFailures[0]).toBeInstanceOf(Error)
    expect((configFailures[0] as Error).message).toBe('artifact corrupt')
    expect(configWarnings.some(w => w.includes('config-driven restore'))).toBe(true)
    expect(configured.agents.get(sessionId)).toBeUndefined()

    await loop.dispose()
    await configured.fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('suppresses a configured-resume failure that lands after teardown', async () => {
    /** 中文说明：测试局部值 sessionId，由紧邻初始化决定，仅在当前场景使用。 */
    const sessionId = SessionId('config-late-resume-failure')
    /** 中文说明：测试局部值 root，由紧邻初始化决定，仅在当前场景使用。 */
    const root = await persistSession(sessionId)
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await mountPersistentHarness(root, new MockAdapter([]))
    /** 中文说明：测试局部值 gate，由紧邻初始化决定，仅在当前场景使用。 */
    const gate = Promise.withResolvers<never>()
    gate.promise.catch(() => undefined)
    /** 中文说明：测试局部值 preparationStarted，由紧邻初始化决定，仅在当前场景使用。 */
    const preparationStarted = Promise.withResolvers<undefined>()
    ctx.sessionPersistence.prepare = () => {
      preparationStarted.resolve(undefined)
      return gate.promise
    }
    /** 中文说明：测试局部值 failures，由紧邻初始化决定，仅在当前场景使用。 */
    const failures: unknown[] = []
    ctx.on('agent-loop/config-start-failed', ({ error }) => { failures.push(error) })

    /** 中文说明：测试局部值 configured，由紧邻初始化决定，仅在当前场景使用。 */
    const configured = new Context()
    await configured.plugin(LlmRuntime)
    await configured.plugin(SessionStore)
    await configured.plugin(SystemPrompt)
    await configured.plugin(ToolRuntime)
    await configured.plugin(AgentRegistry)
    await configured.plugin(JsonlSessionPersistence, { root })
    configured.llm.registerAdapter(['mock'], new MockAdapter([]))
    configured.sessionPersistence.prepare = (id, signal) => ctx.sessionPersistence.prepare(id, signal)
    configured.on('agent-loop/config-start-failed', ({ error }) => { failures.push(error) })
    /** 中文说明：测试局部值 loop，由紧邻初始化决定，仅在当前场景使用。 */
    const loop = await configured.plugin(AgentLoop, {
      agents: [{ id: 'main', resumeSessionId: sessionId, provider: 'mock', model: 'mock' }],
    })
    await preparationStarted.promise
    /** 中文说明：测试局部值 disposal，由紧邻初始化决定，仅在当前场景使用。 */
    const disposal = loop.dispose()
    gate.reject(new Error('late backend failure'))
    await disposal
    await new Promise(r => setTimeout(r, 20))

    // Ownership deactivated before the failure landed: the report is dropped.
    expect(failures).toEqual([])
    await configured.fiber.dispose()
    await ctx.fiber.dispose()
  })
})
