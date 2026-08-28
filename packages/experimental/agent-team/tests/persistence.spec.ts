/**
 * 文件职责：验证实验 Agent Team的 persistence.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis、异步资源生命周期、远程文件/进程接口和 Vitest。
 * 产品维度：保证实验 Agent Team在真实组装、失败和清理场景中可靠。
 * 逻辑维度：构造服务或远程替身，驱动操作并断言结果。
 * 关键边界：凭据不得泄漏；远程句柄、终端和后台进程必须在取消或卸载时释放。
 * 新手阅读建议：先读接口和夹具，再按创建、操作、错误和清理流程阅读。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SqliteSessionPersistence from '@deepseek-ai/dsh-session-persistence-sqlite'
import SubagentService, { seedDescriptorTurn, snapshotSubagentDescriptor } from '@deepseek-ai/dsh-subagent'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import TeamService, { foldTeam, TeamId, TeamMessageId } from '../src/index.ts'
import type { TeamMemberSnapshot, TeamMessageSnapshot, TeamTaskSnapshot } from '../src/index.ts'
import { TestSessionQuery } from './test-session-query.ts'

/** 中文说明：测试局部值 SIGNAL，由紧邻初始化决定。 */
const SIGNAL = new AbortController().signal
/** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
const PERSISTENCE_TEST_TIMEOUT_MS = 15_000
/** 中文说明：测试局部值 roots，由紧邻初始化决定。 */
const roots: string[] = []
/** 中文说明：测试局部值 contexts，由紧邻初始化决定。 */
const contexts = new Set<Context>()

/** Detached durable Team read: the service exposes views, so assertions fold the Lead log. */
/* 中文说明：函数 durable 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function durable(agent: Agent): {
  members: TeamMemberSnapshot[]
  tasks: TeamTaskSnapshot[]
  pendingMessages: TeamMessageSnapshot[]
} {
  /** 中文说明：测试局部值 state，由紧邻初始化决定。 */
  const state = foldTeam(agent.id, agent.session.events)
  return {
    members: [...state.members.values()],
    tasks: [...state.tasks.values()],
    pendingMessages: [...state.messages.values()].filter(message => !state.delivered.has(message.id)),
  }
}

/** 中文说明：函数 disposeContext 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function disposeContext(ctx: Context): Promise<void> {
  try {
    await ctx.fiber.dispose()
  } finally {
    contexts.delete(ctx)
  }
}

afterEach(async () => {
  /** 中文说明：测试局部值 failures，由紧邻初始化决定。 */
  const failures: unknown[] = []
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  for (const ctx of [...contexts].reverse()) {
    try {
      await disposeContext(ctx)
    } catch (error: unknown) {
      failures.push(error)
    }
  }
  /** 中文说明：测试局部值 root，由紧邻初始化决定。 */
  for (const root of roots.splice(0)) {
    try {
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    } catch (error: unknown) {
      failures.push(error)
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, 'Agent Teams persistence test cleanup failed')
})

/** 中文说明：类型或类 PersistenceMount 约束远程资源或测试数据职责。 */
interface PersistenceMount {
  readonly name: string
  mount(ctx: Context, root: string): Promise<{ dispose(): Promise<void> }>
}

/** 中文说明：测试局部值 backends，由紧邻初始化决定。 */
const backends: PersistenceMount[] = [
  {
    name: 'JSONL',
    mount: async (ctx, root) => await ctx.plugin(JsonlSessionPersistence, {
      root: join(root, 'jsonl'),
      compression: 'none',
    }),
  },
  {
    name: 'SQLite',
    mount: async (ctx, root) => await ctx.plugin(SqliteSessionPersistence, {
      path: join(root, 'sessions.sqlite'),
      journalMode: 'delete',
    }),
  },
]

/** 中文说明：函数 stack 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function stack(
  backend: PersistenceMount,
  root: string,
  script: ConstructorParameters<typeof MockAdapter>[0],
) {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  contexts.add(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await backend.mount(ctx, root)
  await ctx.plugin(TestSessionQuery)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentService)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  await ctx.plugin(TeamService)
  /** 中文说明：测试局部值 adapter，由紧邻初始化决定。 */
  const adapter = new MockAdapter(script)
  ctx.llm.registerAdapter(['mock'], adapter)
  return {
    ctx,
    adapter,
    dispose: async () => { await disposeContext(ctx) },
  }
}

/** 中文说明：函数 provisioning 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function provisioning(childId: SessionId, name: string): TeamMemberSnapshot {
  return {
    id: childId,
    name,
    description: `${name} recovery`,
    provider: 'spawn',
    context: 'fresh',
    phase: 'provisioning',
  }
}

/** 中文说明：函数 persistedChild 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function persistedChild(
  ctx: Context,
  rootId: SessionId,
  childId: SessionId,
  message: ReturnType<typeof createUserMessage>,
) {
  /** 中文说明：测试局部值 seed，由紧邻初始化决定。 */
  const seed = seedDescriptorTurn(childId, undefined, snapshotSubagentDescriptor({
    mode: 'continuable',
    provider: 'spawn',
    label: 'persisted child fixture',
    agentProvider: 'mock',
    agentModel: 'mock',
  }))
  /** 中文说明：测试局部值 child，由紧邻初始化决定。 */
  const child = ctx.sessions.create(childId, {
    seed,
    meta: { parentSession: rootId, seedLength: 0, origin: 'subagent' },
  })
  child.append('agent/inbox/spliced', {
    target: 'next-turn',
    start: 0,
    inserted: [message],
  })
  return child
}

/** 中文说明：测试局部值 backend，由紧邻初始化决定。 */
for (const backend of backends) {
  describe(`${backend.name} Agent Teams recovery`, () => {
    it('reconciles a persisted child to active and a missing child to durable failed', {
      timeout: PERSISTENCE_TEST_TIMEOUT_MS,
    }, async () => {
      /** 中文说明：测试局部值 storageRoot，由紧邻初始化决定。 */
      const storageRoot = mkdtempSync(join(tmpdir(), `dsh-team-${backend.name.toLowerCase()}-`))
      roots.push(storageRoot)
      /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
      const first = await stack(backend, storageRoot, [textResponse('initial child answer')])
      /** 中文说明：测试局部值 activeRootId，由紧邻初始化决定。 */
      const activeRootId = SessionId(`${backend.name.toLowerCase()}-active-root`)
      /** 中文说明：测试局部值 failedRootId，由紧邻初始化决定。 */
      const failedRootId = SessionId(`${backend.name.toLowerCase()}-failed-root`)
      /** 中文说明：测试局部值 childId，由紧邻初始化决定。 */
      const childId = SessionId(`${backend.name.toLowerCase()}-child`)
      /** 中文说明：测试局部值 activeRoot，由紧邻初始化决定。 */
      const activeRoot = first.ctx.agentLoop.create(activeRootId, { provider: 'mock', model: 'mock' })
      /** 中文说明：测试局部值 failedRoot，由紧邻初始化决定。 */
      const failedRoot = first.ctx.agentLoop.create(failedRootId, { provider: 'mock', model: 'mock' })
      // Let each root's startup recovery observe the empty initial log before
      // simulating the crash-only provisioning prefix.
      await Promise.resolve()
      await Promise.resolve()

      activeRoot.session.append('team/member', {
        version: 1,
        teamId: TeamId(activeRoot.id),
        member: provisioning(childId, 'recoverable'),
      })
      failedRoot.session.append('team/member', {
        version: 1,
        teamId: TeamId(failedRoot.id),
        member: provisioning(SessionId(`${backend.name}-missing`), 'missing'),
      })
      await Promise.all([
        first.ctx.sessions.flush(activeRoot.session),
        first.ctx.sessions.flush(failedRoot.session),
      ])
      await first.ctx.subagents.startContinuable({
        childId,
        provider: 'spawn',
        label: 'recoverable recovery',
        request: {
          prompt: [{ type: 'text', text: 'persist before active edge' }],
          parent: activeRoot,
        },
        signal: SIGNAL,
      })
      await vi.waitFor(() => { expect(first.ctx.agents.get(childId)).toBeUndefined() }, { timeout: 5_000 })
      expect((await first.ctx.sessionPersistence.inspect(childId)).events
        .some(event => event.type === 'user/message')).toBe(true)
      await first.dispose()

      /** 中文说明：测试局部值 second，由紧邻初始化决定。 */
      const second = await stack(backend, storageRoot, [textResponse('cold resumed answer')])
      /** 中文说明：测试局部值 activeHandle，由紧邻初始化决定。 */
      const activeHandle = await second.ctx.agents.resume({
        resumeSessionId: activeRootId,
        agentOptions: { provider: 'mock', model: 'mock' },
      })
      /** 中文说明：测试局部值 failedHandle，由紧邻初始化决定。 */
      const failedHandle = await second.ctx.agents.resume({
        resumeSessionId: failedRootId,
        agentOptions: { provider: 'mock', model: 'mock' },
      })
      await vi.waitFor(() => {
        expect(durable(activeHandle.agent).members[0]?.phase).toBe('active')
        /** 中文说明：测试局部值 failedMember，由紧邻初始化决定。 */
        const failedMember = durable(failedHandle.agent).members[0]
        expect(failedMember?.phase).toBe('failed')
        expect(failedMember?.error).toContain('child Session recovery failed')
      }, { timeout: 5_000 })

      /** 中文说明：测试局部值 receipt，由紧邻初始化决定。 */
      const receipt = await second.ctx.agentTeams.sendMessage(activeHandle.agent, {
        target: 'recoverable',
        content: [{ type: 'text', text: 'resume after reconciliation' }],
        delivery: 'wakeup',
        signal: SIGNAL,
      })
      expect(receipt.status).toBe('accepted')
      await vi.waitFor(() => { expect(second.ctx.agents.get(childId)).toBeUndefined() }, { timeout: 5_000 })
      await vi.waitFor(() => { expect(durable(activeHandle.agent).pendingMessages).toEqual([]) })

      await activeHandle.dispose()
      await failedHandle.dispose()
      await second.dispose()
    })

    it('reconciles a provisioning child whose initial prompt is durably pending', {
      timeout: PERSISTENCE_TEST_TIMEOUT_MS,
    }, async () => {
      /** 中文说明：测试局部值 storageRoot，由紧邻初始化决定。 */
      const storageRoot = mkdtempSync(join(tmpdir(), `dsh-team-pending-${backend.name.toLowerCase()}-`))
      roots.push(storageRoot)
      /** 中文说明：测试局部值 rootId，由紧邻初始化决定。 */
      const rootId = SessionId(`${backend.name.toLowerCase()}-pending-root`)
      /** 中文说明：测试局部值 childId，由紧邻初始化决定。 */
      const childId = SessionId(`${backend.name.toLowerCase()}-pending-child`)
      /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
      const first = await stack(backend, storageRoot, [])
      /** 中文说明：测试局部值 root，由紧邻初始化决定。 */
      const root = first.ctx.agentLoop.create(rootId, { provider: 'mock', model: 'mock' })
      await Promise.resolve()
      await Promise.resolve()
      root.session.append('team/member', {
        version: 1,
        teamId: TeamId(root.id),
        member: provisioning(childId, 'pending-worker'),
      })
      /** 中文说明：测试局部值 initial，由紧邻初始化决定。 */
      const initial = createUserMessage({
        content: [{ type: 'text', text: 'durably pending initial task' }],
        source: { kind: 'user' },
      })
      /** 中文说明：测试局部值 child，由紧邻初始化决定。 */
      const child = persistedChild(first.ctx, rootId, childId, initial)
      await Promise.all([
        first.ctx.sessions.flush(root.session),
        first.ctx.sessions.flush(child),
      ])
      await first.dispose()

      /** 中文说明：测试局部值 second，由紧邻初始化决定。 */
      const second = await stack(backend, storageRoot, [])
      /** 中文说明：测试局部值 rootHandle，由紧邻初始化决定。 */
      const rootHandle = await second.ctx.agents.resume({
        resumeSessionId: rootId,
        agentOptions: { provider: 'mock', model: 'mock' },
      })
      await vi.waitFor(() => {
        expect(durable(rootHandle.agent).members[0]?.phase).toBe('active')
      })
      expect(second.adapter.requests).toEqual([])
      /** 中文说明：测试局部值 stored，由紧邻初始化决定。 */
      const stored = await second.ctx.sessionPersistence.inspect(childId)
      expect(stored.events.some(event => event.type === 'agent/inbox/spliced'
        && event.data.inserted.some(message => message.id === initial.id))).toBe(true)

      await rootHandle.dispose()
      await second.dispose()
    })

    it('replays queued-minus-delivered mail in FIFO order without waking for quiet mail', {
      timeout: PERSISTENCE_TEST_TIMEOUT_MS,
    }, async () => {
      /** 中文说明：测试局部值 storageRoot，由紧邻初始化决定。 */
      const storageRoot = mkdtempSync(join(tmpdir(), `dsh-team-mail-${backend.name.toLowerCase()}-`))
      roots.push(storageRoot)
      /** 中文说明：测试局部值 rootId，由紧邻初始化决定。 */
      const rootId = SessionId(`${backend.name.toLowerCase()}-mail-root`)

      /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
      const first = await stack(backend, storageRoot, [textResponse('initial teammate answer')])
      /** 中文说明：测试局部值 firstLead，由紧邻初始化决定。 */
      const firstLead = first.ctx.agentLoop.create(rootId, { provider: 'mock', model: 'mock' })
      /** 中文说明：测试局部值 started，由紧邻初始化决定。 */
      const started = await first.ctx.agentTeams.spawnTeammate(firstLead, {
        name: 'mail-worker',
        description: 'mail recovery worker',
        prompt: [{ type: 'text', text: 'finish before restart' }],
        context: 'fresh',
        provider: 'spawn',
        signal: SIGNAL,
      })
      await vi.waitFor(() => { expect(first.ctx.agents.get(started.member.id)).toBeUndefined() }, { timeout: 5_000 })
      /** 中文说明：测试局部值 quiet，由紧邻初始化决定。 */
      const quiet = await first.ctx.agentTeams.sendMessage(firstLead, {
        target: 'mail-worker',
        content: [{ type: 'text', text: 'durable quiet context' }],
        delivery: 'quiet',
        signal: SIGNAL,
      })
      expect(quiet.status).toBe('queued')
      expect(durable(firstLead).pendingMessages.map(message => message.id)).toEqual([quiet.messageId])
      await first.dispose()

      /** 中文说明：测试局部值 second，由紧邻初始化决定。 */
      const second = await stack(backend, storageRoot, [textResponse('resumed teammate answer')])
      /** 中文说明：测试局部值 rootHandle，由紧邻初始化决定。 */
      const rootHandle = await second.ctx.agents.resume({
        resumeSessionId: rootId,
        agentOptions: { provider: 'mock', model: 'mock' },
      })
      await vi.waitFor(() => {
        expect(durable(rootHandle.agent).pendingMessages.map(message => message.id))
          .toEqual([quiet.messageId])
      })
      expect(second.ctx.agents.get(started.member.id)).toBeUndefined()

      /** 中文说明：测试局部值 waking，由紧邻初始化决定。 */
      const waking = await second.ctx.agentTeams.sendMessage(rootHandle.agent, {
        target: 'mail-worker',
        content: [{ type: 'text', text: 'resume after restart' }],
        delivery: 'wakeup',
        signal: SIGNAL,
      })
      expect(waking.status).toBe('accepted')
      await vi.waitFor(() => { expect(second.ctx.agents.get(started.member.id)).toBeUndefined() }, { timeout: 5_000 })
      await vi.waitFor(() => { expect(durable(rootHandle.agent).pendingMessages).toEqual([]) })

      /** 中文说明：测试局部值 child，由紧邻初始化决定。 */
      const child = await second.ctx.sessionPersistence.inspect(started.member.id)
      /** 中文说明：测试局部值 peerIds，由紧邻初始化决定。 */
      const peerIds = child.events.flatMap(event => event.type === 'user/message'
        && event.data.source.kind === 'team-message'
        ? [event.data.source.messageId]
        : [])
      expect(peerIds).toEqual([quiet.messageId, waking.messageId])

      await rootHandle.dispose()
      await second.dispose()
    })

    it('acknowledges target-recorded mail after restart without delivering it twice', {
      timeout: PERSISTENCE_TEST_TIMEOUT_MS,
    }, async () => {
      /** 中文说明：测试局部值 storageRoot，由紧邻初始化决定。 */
      const storageRoot = mkdtempSync(join(tmpdir(), `dsh-team-dedup-${backend.name.toLowerCase()}-`))
      roots.push(storageRoot)
      /** 中文说明：测试局部值 rootId，由紧邻初始化决定。 */
      const rootId = SessionId(`${backend.name.toLowerCase()}-dedup-root`)
      /** 中文说明：测试局部值 messageId，由紧邻初始化决定。 */
      const messageId = TeamMessageId(`${backend.name.toLowerCase()}-recorded-message`)

      /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
      const first = await stack(backend, storageRoot, [textResponse('initial teammate answer')])
      /** 中文说明：测试局部值 firstLead，由紧邻初始化决定。 */
      const firstLead = first.ctx.agentLoop.create(rootId, { provider: 'mock', model: 'mock' })
      /** 中文说明：测试局部值 started，由紧邻初始化决定。 */
      const started = await first.ctx.agentTeams.spawnTeammate(firstLead, {
        name: 'dedup-worker',
        description: 'mail deduplication worker',
        prompt: [{ type: 'text', text: 'finish before the crash window' }],
        context: 'fresh',
        provider: 'spawn',
        signal: SIGNAL,
      })
      await vi.waitFor(() => { expect(first.ctx.agents.get(started.member.id)).toBeUndefined() }, { timeout: 5_000 })

      /** 中文说明：测试局部值 targetHandle，由紧邻初始化决定。 */
      const targetHandle = await first.ctx.agents.resume({
        resumeSessionId: started.member.id,
        agentOptions: { provider: 'mock', model: 'mock' },
      })
      targetHandle.agent.session.append('user/message', createUserMessage({
        content: [
          { type: 'text', text: `Team message ${messageId} from lead:` },
          { type: 'text', text: 'already recorded before acknowledgement' },
        ],
        source: {
          kind: 'team-message',
          teamId: TeamId(rootId),
          messageId,
          senderId: rootId,
          senderName: 'lead',
        },
      }), { surfaceOp: 'append' })
      await first.ctx.sessions.flush(targetHandle.agent.session)
      // Let the pre-queue acknowledgement observer prove there is no mailbox
      // row yet before authoring the simulated crash prefix below.
      await new Promise<void>((resolve) => { setTimeout(resolve, 0) })
      await targetHandle.dispose()

      /** 中文说明：测试局部值 queued，由紧邻初始化决定。 */
      const queued: TeamMessageSnapshot = {
        id: messageId,
        senderId: rootId,
        senderName: 'lead',
        targetId: started.member.id,
        delivery: 'wakeup',
        content: [{ type: 'text', text: 'already recorded before acknowledgement' }],
      }
      firstLead.session.append('team/message/queued', {
        version: 1,
        teamId: TeamId(rootId),
        message: queued,
      })
      await first.ctx.sessions.flush(firstLead.session)
      expect(durable(firstLead).pendingMessages.map(message => message.id)).toEqual([messageId])
      await first.dispose()

      /** 中文说明：测试局部值 second，由紧邻初始化决定。 */
      const second = await stack(backend, storageRoot, [])
      /** 中文说明：测试局部值 rootHandle，由紧邻初始化决定。 */
      const rootHandle = await second.ctx.agents.resume({
        resumeSessionId: rootId,
        agentOptions: { provider: 'mock', model: 'mock' },
      })
      await vi.waitFor(() => { expect(durable(rootHandle.agent).pendingMessages).toEqual([]) })
      expect(second.ctx.agents.get(started.member.id)).toBeUndefined()
      expect(second.adapter.requests).toEqual([])

      /** 中文说明：测试局部值 child，由紧邻初始化决定。 */
      const child = await second.ctx.sessionPersistence.inspect(started.member.id)
      /** 中文说明：测试局部值 occurrences，由紧邻初始化决定。 */
      const occurrences = child.events.filter(event => event.type === 'user/message'
        && event.data.source.kind === 'team-message'
        && event.data.source.messageId === messageId)
      expect(occurrences).toHaveLength(1)

      await rootHandle.dispose()
      await second.dispose()
    })

    it('acknowledges durably pending target mail without cold-resume duplication', {
      timeout: PERSISTENCE_TEST_TIMEOUT_MS,
    }, async () => {
      /** 中文说明：测试局部值 storageRoot，由紧邻初始化决定。 */
      const storageRoot = mkdtempSync(join(tmpdir(), `dsh-team-inbox-${backend.name.toLowerCase()}-`))
      roots.push(storageRoot)
      /** 中文说明：测试局部值 rootId，由紧邻初始化决定。 */
      const rootId = SessionId(`${backend.name.toLowerCase()}-inbox-root`)
      /** 中文说明：测试局部值 childId，由紧邻初始化决定。 */
      const childId = SessionId(`${backend.name.toLowerCase()}-inbox-child`)
      /** 中文说明：测试局部值 messageId，由紧邻初始化决定。 */
      const messageId = TeamMessageId(`${backend.name.toLowerCase()}-pending-team-message`)
      /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
      const first = await stack(backend, storageRoot, [])
      /** 中文说明：测试局部值 root，由紧邻初始化决定。 */
      const root = first.ctx.agentLoop.create(rootId, { provider: 'mock', model: 'mock' })
      await Promise.resolve()
      await Promise.resolve()
      /** 中文说明：测试局部值 provisioned，由紧邻初始化决定。 */
      const provisioned = provisioning(childId, 'pending-mail-worker')
      /** 中文说明：测试局部值 active，由紧邻初始化决定。 */
      const active: TeamMemberSnapshot = {
        ...provisioned,
        phase: 'active',
      }
      /** 中文说明：测试局部值 queued，由紧邻初始化决定。 */
      const queued: TeamMessageSnapshot = {
        id: messageId,
        senderId: rootId,
        senderName: 'lead',
        targetId: childId,
        delivery: 'wakeup',
        content: [{ type: 'text', text: 'already durable in target inbox' }],
      }
      root.session.append('team/member', {
        version: 1,
        teamId: TeamId(root.id),
        member: provisioned,
      })
      root.session.append('team/member', {
        version: 1,
        teamId: TeamId(root.id),
        member: active,
      })
      root.session.append('team/message/queued', {
        version: 1,
        teamId: TeamId(root.id),
        message: queued,
      })
      /** 中文说明：测试局部值 pending，由紧邻初始化决定。 */
      const pending = createUserMessage({
        content: [{ type: 'text', text: 'already durable in target inbox' }],
        source: {
          kind: 'team-message',
          teamId: TeamId(rootId),
          messageId,
          senderId: rootId,
          senderName: 'lead',
        },
      })
      /** 中文说明：测试局部值 child，由紧邻初始化决定。 */
      const child = persistedChild(first.ctx, rootId, childId, pending)
      await Promise.all([
        first.ctx.sessions.flush(root.session),
        first.ctx.sessions.flush(child),
      ])
      await first.dispose()

      /** 中文说明：测试局部值 second，由紧邻初始化决定。 */
      const second = await stack(backend, storageRoot, [])
      /** 中文说明：测试局部值 rootHandle，由紧邻初始化决定。 */
      const rootHandle = await second.ctx.agents.resume({
        resumeSessionId: rootId,
        agentOptions: { provider: 'mock', model: 'mock' },
      })
      await vi.waitFor(() => {
        expect(durable(rootHandle.agent).pendingMessages).toEqual([])
      })
      expect(second.adapter.requests).toEqual([])
      expect(second.ctx.agents.get(childId)).toBeUndefined()
      /** 中文说明：测试局部值 stored，由紧邻初始化决定。 */
      const stored = await second.ctx.sessionPersistence.inspect(childId)
      /** 中文说明：测试局部值 pendingCopies，由紧邻初始化决定。 */
      const pendingCopies = stored.events.flatMap(event => event.type === 'agent/inbox/spliced'
        ? event.data.inserted.filter(message => message.source.kind === 'team-message'
          && message.source.messageId === messageId)
        : [])
      expect(pendingCopies).toHaveLength(1)

      await rootHandle.dispose()
      await second.dispose()
    })
  })
}
