/**
 * 文件职责：验证Agent Loop的 config-session-id.spec.ts 行为与不变量。
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
import SessionStore, { SessionId, SessionPreparation } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'

import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import AgentLoop, { CONFIGURED_AGENT_IDENTITIES_KEY } from '@deepseek-ai/dsh-agent-loop'
import { MockAdapter, textResponse } from './mock-adapter.ts'

/** 中文说明：测试局部值 dirs，由紧邻初始化决定，仅在当前场景使用。 */
const dirs: string[] = []
afterEach(async () => { for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }) })

/** 中文说明：测试辅助函数 waitForIdle 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    /** 中文说明：测试局部值 dispose，由紧邻初始化决定，仅在当前场景使用。 */
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') { dispose(); resolve() }
    })
  })
}

/** 中文说明：测试辅助函数 makeCoreContext 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
async function makeCoreContext(): Promise<Context> {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  return ctx
}

describe('config-driven session id', () => {
  it('applies launcher identities by configured id without changing unmatched entries', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await makeCoreContext()
    ctx.provide(CONFIGURED_AGENT_IDENTITIES_KEY, {
      fresh: { id: SessionId('launcher-fresh'), resume: false },
      resumed: { id: SessionId('launcher-resumed'), resume: true },
    })
    await ctx.plugin(AgentLoop, {
      agents: [
        { id: 'fresh', sessionId: SessionId('config-fresh'), model: 'mock' },
        { id: 'resumed', sessionId: SessionId('config-resumed'), model: 'mock' },
        { id: 'unchanged', sessionId: SessionId('config-unchanged'), model: 'mock' },
      ],
    })
    expect(ctx.agents.get(SessionId('launcher-fresh'))?.session.id).toBe('launcher-fresh')
    expect(ctx.agents.get(SessionId('launcher-resumed'))).toBeUndefined()
    expect(ctx.agents.get(SessionId('config-resumed'))).toBeUndefined()
    expect(ctx.agents.get(SessionId('config-unchanged'))?.session.id).toBe('config-unchanged')
    await ctx.fiber.dispose()
  })

  it('rejects an empty exact id before publishing an agent', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await makeCoreContext()
    await expect(ctx.plugin(AgentLoop, {
      agents: [{ id: 'main', sessionId: SessionId(''), model: 'mock' }],
    })).rejects.toThrow('expected string length >= 1')
    expect(ctx.agents.get(SessionId(''))).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('accepts one exact fresh id and rejects it alongside a resume id', async () => {
    /** 中文说明：测试局部值 exact，由紧邻初始化决定，仅在当前场景使用。 */
    const exact = await makeCoreContext()
    await exact.plugin(AgentLoop, {
      agents: [{ id: 'main', sessionId: SessionId('config-exact'), model: 'mock' }],
    })
    expect(exact.agents.get(SessionId('config-exact'))?.session.id).toBe('config-exact')
    await exact.fiber.dispose()

    /** 中文说明：测试局部值 conflicting，由紧邻初始化决定，仅在当前场景使用。 */
    const conflicting = await makeCoreContext()
    await expect(conflicting.plugin(AgentLoop, {
      agents: [{
        id: 'main',
        sessionId: SessionId('fresh'),
        resumeSessionId: SessionId('persisted'),
        model: 'mock',
      }],
    })).rejects.toThrow('sessionId and resumeSessionId are mutually exclusive')
    await conflicting.fiber.dispose()
  })

  it('rejects duplicate exact ids before asynchronous configured startup', async () => {
    /** 中文说明：测试局部值 root，由紧邻初始化决定，仅在当前场景使用。 */
    const root = await mkdtemp(join(tmpdir(), 'dsh-cfg-exact-duplicate-'))
    dirs.push(root)
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await makeCoreContext()
    await ctx.plugin(JsonlSessionPersistence, { root })

    /** 中文说明：测试局部值 outcome，由紧邻初始化决定，仅在当前场景使用。 */
    const outcome = await ctx.plugin(AgentLoop, {
      agents: [
        { id: 'first', sessionId: SessionId('shared'), model: 'mock' },
        { id: 'second', sessionId: SessionId('shared'), model: 'mock' },
      ],
    }).then(() => undefined, (error: unknown) => error)
    /** 中文说明：测试局部值 published，由紧邻初始化决定，仅在当前场景使用。 */
    const published = ctx.agents.get(SessionId('shared'))
    await ctx.fiber.dispose()

    expect(outcome).toEqual(new Error('agents "first" and "second" use duplicate exact session identity "shared"'))
    expect(published).toBeUndefined()
  })

  it('restores a materialized exact id across an AgentLoop-only reload', async () => {
    /** 中文说明：测试局部值 root，由紧邻初始化决定，仅在当前场景使用。 */
    const root = await mkdtemp(join(tmpdir(), 'dsh-cfg-exact-reload-'))
    dirs.push(root)
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await makeCoreContext()
    await ctx.plugin(JsonlSessionPersistence, { root })
    ctx.llm.registerAdapter(['mock'], new MockAdapter([textResponse('first'), textResponse('second')]))
    /** 中文说明：测试局部值 config，由紧邻初始化决定，仅在当前场景使用。 */
    const config = { agents: [{ id: 'main', sessionId: SessionId('config-exact-reload'), provider: 'mock', model: 'mock' }] }

    /** 中文说明：测试局部值 firstLoop，由紧邻初始化决定，仅在当前场景使用。 */
    const firstLoop = await ctx.plugin(AgentLoop, config)
    await expect.poll(() => ctx.agents.get(SessionId('config-exact-reload')), { timeout: 5_000 }).toBeDefined()
    /** 中文说明：测试局部值 first，由紧邻初始化决定，仅在当前场景使用。 */
    const first = ctx.agents.get(SessionId('config-exact-reload'))!
    first.followup(createUserMessage({ content: [{ type: 'text', text: 'remember me' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, first)
    await firstLoop.dispose()

    /** 中文说明：测试局部值 secondLoop，由紧邻初始化决定，仅在当前场景使用。 */
    const secondLoop = await ctx.plugin(AgentLoop, config)
    await expect.poll(() => ctx.agents.get(SessionId('config-exact-reload')), { timeout: 5_000 }).toBeDefined()
    /** 中文说明：测试局部值 second，由紧邻初始化决定，仅在当前场景使用。 */
    const second = ctx.agents.get(SessionId('config-exact-reload'))!
    expect(JSON.stringify(second.session.deriveMessages())).toContain('remember me')
    second.followup(createUserMessage({ content: [{ type: 'text', text: 'continue' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, second)
    await ctx.sessions.flush(second.session)
    /** 中文说明：测试局部值 loaded，由紧邻初始化决定，仅在当前场景使用。 */
    const loaded = await ctx.sessionPersistence.load(SessionId('config-exact-reload'))
    expect(loaded.events.filter(event => event.type === 'turn/start')).toHaveLength(2)

    await secondLoop.dispose()
    await ctx.fiber.dispose()
  })

  it('waits for a draining exact-id lifecycle during an overlapping reload', async () => {
    /** 中文说明：测试局部值 root，由紧邻初始化决定，仅在当前场景使用。 */
    const root = await mkdtemp(join(tmpdir(), 'dsh-cfg-exact-overlap-'))
    dirs.push(root)
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await makeCoreContext()
    await ctx.plugin(JsonlSessionPersistence, { root })
    ctx.llm.registerAdapter(['mock'], new MockAdapter([textResponse('saved')]))
    /** 中文说明：测试局部值 sessionId，由紧邻初始化决定，仅在当前场景使用。 */
    const sessionId = SessionId('config-exact-overlap')
    /** 中文说明：测试局部值 config，由紧邻初始化决定，仅在当前场景使用。 */
    const config = { agents: [{ id: 'main', sessionId, provider: 'mock', model: 'mock' }] }
    /** 中文说明：测试局部值 firstLoop，由紧邻初始化决定，仅在当前场景使用。 */
    const firstLoop = await ctx.plugin(AgentLoop, config)
    await expect.poll(() => ctx.agents.get(sessionId)).toBeDefined()
    /** 中文说明：测试局部值 first，由紧邻初始化决定，仅在当前场景使用。 */
    const first = ctx.agents.get(sessionId) as Agent

    /** 中文说明：测试局部值 cleanupGate，由紧邻初始化决定，仅在当前场景使用。 */
    const cleanupGate = Promise.withResolvers<undefined>()
    /** 中文说明：测试局部值 cleanupStarted，由紧邻初始化决定，仅在当前场景使用。 */
    const cleanupStarted = Promise.withResolvers<undefined>()
    first.ctx.effect(() => async () => {
      cleanupStarted.resolve(undefined)
      await cleanupGate.promise
    })
    /** 中文说明：测试局部值 idle，由紧邻初始化决定，仅在当前场景使用。 */
    const idle = waitForIdle(ctx, first)
    first.followup(createUserMessage({ content: [{ type: 'text', text: 'persist before replacement' }], source: { kind: 'user' } }))
    await idle
    await ctx.sessions.flush(first.session)
    expect(JSON.stringify((await ctx.sessionPersistence.inspect(sessionId)).events))
      .toContain('persist before replacement')

    /** 中文说明：测试局部值 firstDisposal，由紧邻初始化决定，仅在当前场景使用。 */
    const firstDisposal = firstLoop.dispose()
    await cleanupStarted.promise
    expect(first.status).toBe('idle')
    /** 中文说明：测试局部值 failures，由紧邻初始化决定，仅在当前场景使用。 */
    const failures: unknown[] = []
    ctx.on('agent-loop/config-start-failed', ({ error }) => { failures.push(error) })
    /** 中文说明：测试局部值 secondLoop，由紧邻初始化决定，仅在当前场景使用。 */
    const secondLoop = await ctx.plugin(AgentLoop, config)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(ctx.agents.get(sessionId)).toBe(first)
    expect(failures).toEqual([])

    cleanupGate.resolve(undefined)
    await firstDisposal
    await expect.poll(() => ctx.agents.get(sessionId)).toBeDefined()
    /** 中文说明：测试局部值 second，由紧邻初始化决定，仅在当前场景使用。 */
    const second = ctx.agents.get(sessionId) as Agent
    expect(second).not.toBe(first)
    expect(JSON.stringify(second.session.deriveMessages())).toContain('persist before replacement')
    expect(failures).toEqual([])

    await secondLoop.dispose()
    await ctx.fiber.dispose()
  })

  it('cancels an exact-id reload while the prior lifecycle is still draining', async () => {
    /** 中文说明：测试局部值 root，由紧邻初始化决定，仅在当前场景使用。 */
    const root = await mkdtemp(join(tmpdir(), 'dsh-cfg-exact-cancel-'))
    dirs.push(root)
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await makeCoreContext()
    await ctx.plugin(JsonlSessionPersistence, { root })
    /** 中文说明：测试局部值 sessionId，由紧邻初始化决定，仅在当前场景使用。 */
    const sessionId = SessionId('config-exact-cancel')
    /** 中文说明：测试局部值 config，由紧邻初始化决定，仅在当前场景使用。 */
    const config = { agents: [{ id: 'main', sessionId, model: 'mock' }] }
    /** 中文说明：测试局部值 firstLoop，由紧邻初始化决定，仅在当前场景使用。 */
    const firstLoop = await ctx.plugin(AgentLoop, config)
    await expect.poll(() => ctx.agents.get(sessionId)).toBeDefined()
    /** 中文说明：测试局部值 first，由紧邻初始化决定，仅在当前场景使用。 */
    const first = ctx.agents.get(sessionId) as Agent

    /** 中文说明：测试局部值 cleanupGate，由紧邻初始化决定，仅在当前场景使用。 */
    const cleanupGate = Promise.withResolvers<undefined>()
    /** 中文说明：测试局部值 cleanupStarted，由紧邻初始化决定，仅在当前场景使用。 */
    const cleanupStarted = Promise.withResolvers<undefined>()
    first.ctx.effect(() => async () => {
      cleanupStarted.resolve(undefined)
      await cleanupGate.promise
    })
    first.inject(createUserMessage({ content: [{ type: 'text', text: 'persist before cancellation' }], source: { kind: 'plugin', plugin: 'test' } }))
    await ctx.sessions.flush(first.session)
    expect(JSON.stringify((await ctx.sessionPersistence.inspect(sessionId)).events))
      .toContain('persist before cancellation')

    /** 中文说明：测试局部值 firstDisposal，由紧邻初始化决定，仅在当前场景使用。 */
    const firstDisposal = firstLoop.dispose()
    await cleanupStarted.promise
    expect(first.status).toBe('idle')
    /** 中文说明：测试局部值 secondLoop，由紧邻初始化决定，仅在当前场景使用。 */
    const secondLoop = await ctx.plugin(AgentLoop, config)
    await secondLoop.dispose()
    expect(ctx.agents.get(sessionId)).toBe(first)

    cleanupGate.resolve(undefined)
    await firstDisposal
    expect(ctx.agents.get(sessionId)).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('contains an exact-id persistence lookup failure', async () => {
    /** 中文说明：测试局部值 root，由紧邻初始化决定，仅在当前场景使用。 */
    const root = await mkdtemp(join(tmpdir(), 'dsh-cfg-exact-failure-'))
    dirs.push(root)
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await makeCoreContext()
    await ctx.plugin(JsonlSessionPersistence, { root })
    /** 中文说明：测试局部值 failure，由紧邻初始化决定，仅在当前场景使用。 */
    const failure = new Error('persistence index failed')
    /** 中文说明：测试局部值 listenerFailure，由紧邻初始化决定，仅在当前场景使用。 */
    const listenerFailure = new Error('failure observer failed')
    /** 中文说明：测试局部值 asyncListenerFailure，由紧邻初始化决定，仅在当前场景使用。 */
    const asyncListenerFailure = new Error('async failure observer failed')
    /** 中文说明：测试局部值 failures，由紧邻初始化决定，仅在当前场景使用。 */
    const failures: { sessionId: SessionId; error: unknown }[] = []
    ctx.on('agent-loop/config-start-failed', () => { throw listenerFailure })
    ctx.on('agent-loop/config-start-failed', () => Promise.reject(asyncListenerFailure) as never)
    ctx.on('agent-loop/config-start-failed', ({ sessionId, error }) => {
      failures.push({ sessionId, error })
    })
    vi.spyOn(ctx.sessionPersistence, 'list').mockRejectedValue(failure)
    /** 中文说明：测试局部值 warn，由紧邻初始化决定，仅在当前场景使用。 */
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)

    await ctx.plugin(AgentLoop, {
      agents: [{ id: 'main', sessionId: SessionId('config-exact-failure'), model: 'mock' }],
    })

    await expect.poll(() => warn).toHaveBeenCalledWith(expect.stringContaining(
      'config-driven restore of "config-exact-failure" failed: persistence index failed',
    ))
    expect(failures).toEqual([{ sessionId: SessionId('config-exact-failure'), error: failure }])
    expect(warn).toHaveBeenCalledWith(
      'agent "main": config-start-failed listener threw: failure observer failed',
    )
    await expect.poll(() => warn).toHaveBeenCalledWith(
      'agent "main": config-start-failed listener rejected: async failure observer failed',
    )
    expect(ctx.agents.get(SessionId('config-exact-failure'))).toBeUndefined()
    warn.mockRestore()
    await ctx.fiber.dispose()
  })

  it('contains startup and observer failures whose string coercion throws', async () => {
    /** 中文说明：测试局部值 root，由紧邻初始化决定，仅在当前场景使用。 */
    const root = await mkdtemp(join(tmpdir(), 'dsh-cfg-exact-unrenderable-'))
    dirs.push(root)
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await makeCoreContext()
    await ctx.plugin(JsonlSessionPersistence, { root })
    /** 中文说明：测试局部值 unrenderable，由紧邻初始化决定，仅在当前场景使用。 */
    const unrenderable = {
      [Symbol.toPrimitive](): never {
        throw new Error('coercion escaped')
      },
    }
    /** 中文说明：测试局部值 failures，由紧邻初始化决定，仅在当前场景使用。 */
    const failures: unknown[] = []
    ctx.on('agent-loop/config-start-failed', () => { throw unrenderable })
    // Deliberately violate the normal Error-only rejection rule to exercise the unknown boundary.
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors
    ctx.on('agent-loop/config-start-failed', () => Promise.reject(unrenderable) as never)
    ctx.on('agent-loop/config-start-failed', ({ error }) => { failures.push(error) })
    vi.spyOn(ctx.sessionPersistence, 'list').mockRejectedValue(unrenderable)
    /** 中文说明：测试局部值 warn，由紧邻初始化决定，仅在当前场景使用。 */
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)

    await ctx.plugin(AgentLoop, {
      agents: [{ id: 'main', sessionId: SessionId('config-exact-unrenderable'), model: 'mock' }],
    })

    await expect.poll(() => failures).toEqual([unrenderable])
    expect(warn).toHaveBeenCalledWith(
      'agent "main": config-driven restore of "config-exact-unrenderable" failed: <unrenderable value>',
    )
    expect(warn).toHaveBeenCalledWith(
      'agent "main": config-start-failed listener threw: <unrenderable value>',
    )
    await expect.poll(() => warn).toHaveBeenCalledWith(
      'agent "main": config-start-failed listener rejected: <unrenderable value>',
    )
    await ctx.fiber.dispose()
  })

  it.each(['resolve', 'reject'] as const)(
    'abandons an exact-id preparation that later %s when AgentLoop disposal starts',
    async (outcome) => {
      /** 中文说明：测试局部值 root，由紧邻初始化决定，仅在当前场景使用。 */
      const root = await mkdtemp(join(tmpdir(), 'dsh-cfg-exact-dispose-'))
      dirs.push(root)
      /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
      const ctx = await makeCoreContext()
      await ctx.plugin(JsonlSessionPersistence, { root })
      /** 中文说明：测试局部值 preparing，由紧邻初始化决定，仅在当前场景使用。 */
      const preparing = Promise.withResolvers<SessionPreparation>()
      vi.spyOn(ctx.sessionPersistence, 'prepare').mockReturnValue(preparing.promise)
      /** 中文说明：测试局部值 released，由紧邻初始化决定，仅在当前场景使用。 */
      const released = vi.fn()
      /** 中文说明：测试局部值 warn，由紧邻初始化决定，仅在当前场景使用。 */
      const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)
      /** 中文说明：测试局部值 failures，由紧邻初始化决定，仅在当前场景使用。 */
      const failures: unknown[] = []
      ctx.on('agent-loop/config-start-failed', ({ error }) => { failures.push(error) })

      /** 中文说明：测试局部值 loop，由紧邻初始化决定，仅在当前场景使用。 */
      const loop = await ctx.plugin(AgentLoop, {
        agents: [{ id: 'main', sessionId: SessionId('config-exact-dispose'), model: 'mock' }],
      })
      await loop.dispose()
      if (outcome === 'resolve') {
        preparing.resolve(SessionPreparation.create(
          ctx.sessions.prepare(SessionId('config-exact-dispose')),
          { release: released },
        ))
      } else {
        preparing.reject(new Error('startup cancelled by teardown'))
      }
      await Promise.resolve()
      if (outcome === 'resolve') await expect.poll(() => released).toHaveBeenCalledOnce()
      expect(ctx.agents.get(SessionId('config-exact-dispose'))).toBeUndefined()
      expect(failures).toEqual([])
      expect(warn).not.toHaveBeenCalled()
      warn.mockRestore()
      await ctx.fiber.dispose()
    },
  )

  it('identity-nests the deferred resume fiber under its labeled owner effect', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    /** 中文说明：测试局部值 loopFiber，由紧邻初始化决定，仅在当前场景使用。 */
    const loopFiber = await ctx.plugin(AgentLoop, {
      agents: [{ id: SessionId('main'), provider: 'mock', model: 'mock', resumeSessionId: SessionId('deferred') }],
    })

    /** 中文说明：测试局部值 resumeEffect，由紧邻初始化决定，仅在当前场景使用。 */
    const resumeEffect = loopFiber.getEffects().find(effect => effect.label === 'agentLoop.resume(main)')
    expect(resumeEffect?.children.map(child => child.label)).toEqual(['ctx.plugin()'])
    // Exactly one plugin effect sits at the fiber's own level — the optional
    // settings wiring, whose `ctx.inject` cordis labels like any other plugin.
    // A resumed agent joining it there is the regression this pins.
    expect(loopFiber.getEffects().filter(effect => effect.label === 'ctx.plugin()')).toHaveLength(1)

    await loopFiber.dispose()
  })

  it('config-driven create uses a fresh ${id}-session-<uuid> per run (restart-safe)', async () => {
    /** 中文说明：测试局部值 root，由紧邻初始化决定，仅在当前场景使用。 */
    const root = await mkdtemp(join(tmpdir(), 'dsh-cfg-session-'))
    dirs.push(root)
    /** 中文说明：测试局部值 idPattern，由紧邻初始化决定，仅在当前场景使用。 */
    const idPattern = /^cfg-session-[0-9a-f-]{36}$/
    // Run 1: a config agent persists a turn under a generated session id.
    /** 中文说明：测试局部值 ctx1，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx1 = new Context()
    await ctx1.plugin(LlmRuntime)
    await ctx1.plugin(SessionStore)
    await ctx1.plugin(SystemPrompt)
    await ctx1.plugin(ToolRuntime)
    await ctx1.plugin(AgentRegistry)
    await ctx1.plugin(AgentLoop, { agents: [{ id: SessionId('cfg'), provider: 'mock', model: 'mock' }] })
    await ctx1.plugin(JsonlSessionPersistence, { root })
    ctx1.llm.registerAdapter(['mock'], new MockAdapter([textResponse('cfg')]))
    /** 中文说明：测试局部值 a1，由紧邻初始化决定，仅在当前场景使用。 */
    const a1 = ctx1.agents.list()[0] as Agent
    expect(a1.id).toBe(a1.session.id)
    expect(a1.session.id).toMatch(idPattern)
    expect(ctx1.agents.get(SessionId('cfg'))).toBeUndefined()
    a1.followup(createUserMessage({ content: [{ type: 'text', text: 'q' }], source: { kind: 'user' } }))
    await waitForIdle(ctx1, a1)
    await ctx1.fiber.dispose()

    // Run 2 over the SAME root: a fresh id means no on-disk collision (a fixed
    // ${id}-session would crash here with "already has a persisted log").
    /** 中文说明：测试局部值 ctx2，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx2 = new Context()
    await ctx2.plugin(LlmRuntime)
    await ctx2.plugin(SessionStore)
    await ctx2.plugin(SystemPrompt)
    await ctx2.plugin(ToolRuntime)
    await ctx2.plugin(AgentRegistry)
    await ctx2.plugin(AgentLoop, { agents: [{ id: SessionId('cfg'), provider: 'mock', model: 'mock' }] })
    await ctx2.plugin(JsonlSessionPersistence, { root })
    ctx2.llm.registerAdapter(['mock'], new MockAdapter([textResponse('cfg2')]))
    /** 中文说明：测试局部值 a2，由紧邻初始化决定，仅在当前场景使用。 */
    const a2 = ctx2.agents.list()[0] as Agent
    expect(a2.id).toBe(a2.session.id)
    expect(a2.session.id).toMatch(idPattern)
    expect(a2.session.id).not.toBe(a1.session.id)
    a2.followup(createUserMessage({ content: [{ type: 'text', text: 'q2' }], source: { kind: 'user' } }))
    await waitForIdle(ctx2, a2)
    await ctx2.fiber.dispose()
  })

  it('config-driven resumeSessionId continues a persisted session', async () => {
    /** 中文说明：测试局部值 root，由紧邻初始化决定，仅在当前场景使用。 */
    const root = await mkdtemp(join(tmpdir(), 'dsh-cfg-resume-'))
    dirs.push(root)

    // Run 1: a programmatically-created agent on a KNOWN session id persists a
    // completed turn, so run 2 has a concrete id to resume.
    /** 中文说明：测试局部值 ctx1，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx1 = new Context()
    await ctx1.plugin(LlmRuntime)
    await ctx1.plugin(SessionStore)
    await ctx1.plugin(SystemPrompt)
    await ctx1.plugin(ToolRuntime)
    await ctx1.plugin(AgentRegistry)
    await ctx1.plugin(AgentLoop, { agents: [] })
    await ctx1.plugin(JsonlSessionPersistence, { root })
    ctx1.llm.registerAdapter(['mock'], new MockAdapter([textResponse('first')]))
    /** 中文说明：测试局部值 a1，由紧邻初始化决定，仅在当前场景使用。 */
    const a1 = (await ctx1.agents.create({ sessionId: SessionId('sticky-1') })).agent
    a1.followup(createUserMessage({ content: [{ type: 'text', text: 'remember me' }], source: { kind: 'user' } }))
    await waitForIdle(ctx1, a1)
    await ctx1.fiber.dispose()

    // Resume waits for the injected persistence service, so poll until the
    // config-created agent appears with its stored history.
    /** 中文说明：测试局部值 ctx2，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx2 = new Context()
    await ctx2.plugin(LlmRuntime)
    await ctx2.plugin(SessionStore)
    await ctx2.plugin(SystemPrompt)
    await ctx2.plugin(ToolRuntime)
    await ctx2.plugin(AgentRegistry)
    await ctx2.plugin(AgentLoop, { agents: [{ id: SessionId('main'), provider: 'mock', model: 'mock', resumeSessionId: SessionId('sticky-1') }] })
    await ctx2.plugin(JsonlSessionPersistence, { root })
    ctx2.llm.registerAdapter(['mock'], new MockAdapter([textResponse('second')]))

    // The deferred resume runs after the backend is available.
    await expect.poll(() => ctx2.agents.get(SessionId('sticky-1')), { timeout: 5_000 }).toBeDefined()
    /** 中文说明：测试局部值 resumed，由紧邻初始化决定，仅在当前场景使用。 */
    const resumed = ctx2.agents.get(SessionId('sticky-1'))!
    // The live session id IS the resumed id (NOT a fresh ${id}-session-<uuid>),
    // and the prior turn's user message is in the derived history.
    expect(resumed.id).toBe(SessionId('sticky-1'))
    expect(resumed.session.id).toBe('sticky-1')
    /** 中文说明：测试局部值 derived，由紧邻初始化决定，仅在当前场景使用。 */
    const derived = resumed.session.deriveMessages()
    expect(JSON.stringify(derived)).toContain('remember me')
    await ctx2.fiber.dispose()
  })

  it('config-driven resume of a missing session is contained: logs a warning, no agent, no crash', async () => {
    /** 中文说明：测试局部值 root，由紧邻初始化决定，仅在当前场景使用。 */
    const root = await mkdtemp(join(tmpdir(), 'dsh-cfg-resume-miss-'))
    dirs.push(root)
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [{ id: SessionId('main'), provider: 'mock', model: 'mock', resumeSessionId: SessionId('does-not-exist') }] })
    /** 中文说明：测试局部值 warn，由紧邻初始化决定，仅在当前场景使用。 */
    const warn = vi.spyOn((ctx.agentLoop as unknown as { ctx: { logger: { warn: (...a: unknown[]) => void } } }).ctx.logger, 'warn')
      .mockImplementation(() => undefined)
    await ctx.plugin(JsonlSessionPersistence, { root })
    ctx.llm.registerAdapter(['mock'], new MockAdapter([textResponse('x')]))

    // The deferred resume fails (no such session on disk). It must be contained:
    // a warning is logged, no agent is registered, and the app stays up.
    await new Promise(r => setTimeout(r, 200))
    expect(ctx.agents.list()).toEqual([])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('config-driven resume of "does-not-exist" failed'))
    warn.mockRestore()
    await ctx.fiber.dispose()
  })
})

describe('startup reporting after factory teardown', () => {
  it('suppresses the configured-restore failure report once the loop is disposed', async () => {
    /** 中文说明：测试局部值 root，由紧邻初始化决定，仅在当前场景使用。 */
    const root = await mkdtemp(join(tmpdir(), 'dsh-cfg-disposed-report-'))
    dirs.push(root)
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
    const ctx = await makeCoreContext()
    await ctx.plugin(JsonlSessionPersistence, { root })
    ctx.llm.registerAdapter(['mock'], new MockAdapter([textResponse('x')]))

    // A restore lookup that hangs until after the loop is gone: the eventual
    // failure lands with ownership inactive and must be silently dropped.
    /** 中文说明：测试局部值 gate，由紧邻初始化决定，仅在当前场景使用。 */
    const gate = Promise.withResolvers<never>()
    // The teardown path may drop the pending lookup without awaiting it.
    gate.promise.catch(() => undefined)
    vi.spyOn(ctx.sessionPersistence, 'list').mockReturnValue(gate.promise)
    /** 中文说明：测试局部值 failures，由紧邻初始化决定，仅在当前场景使用。 */
    const failures: unknown[] = []
    ctx.on('agent-loop/config-start-failed', ({ error }) => { failures.push(error) })
    /** 中文说明：测试局部值 warn，由紧邻初始化决定，仅在当前场景使用。 */
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)

    /** 中文说明：测试局部值 loop，由紧邻初始化决定，仅在当前场景使用。 */
    const loop = await ctx.plugin(AgentLoop, {
      agents: [{ id: 'main', sessionId: SessionId('config-disposed-report'), model: 'mock' }],
    })
    /** 中文说明：测试局部值 disposal，由紧邻初始化决定，仅在当前场景使用。 */
    const disposal = loop.dispose()
    gate.reject(new Error('backend failed after teardown began'))
    await disposal

    await new Promise(r => setTimeout(r, 20))
    expect(failures).toEqual([])
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('config-driven restore'))
    warn.mockRestore()
    await ctx.fiber.dispose()
  })
})
