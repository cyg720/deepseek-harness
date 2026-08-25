/**
 * 文件职责：验证 list-children.spec.ts 覆盖的子代理工具行为与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、进程流、终端会话或快照规范化。
 * 产品维度：保障 Agent 的子代理工具能力稳定、可复现且可诊断。
 * 逻辑维度：准备输入和资源，执行核心流程，收集事件或输出，再处理错误与清理。
 * 关键边界：进程退出与取消可能竞态；外部输出不可信；清理必须等待子资源完全停止。
 * 新手阅读建议：先看类型和夹具，再读启动/收集主流程，最后关注平台差异、规范化和清理。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import SessionStore, { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import SessionProjectionCache from '@deepseek-ai/dsh-session-projection-cache'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import SubagentRuntime, {
  SUBAGENT_DESCRIPTOR_VERSION,
  SubagentError,
} from '@deepseek-ai/dsh-subagent'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import * as SubagentFork from '@deepseek-ai/dsh-subagent-fork-in-process'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

/** 中文说明：type Script 定义本测试所需的数据或行为，用于表达子代理工具场景。 */
type Script = ConstructorParameters<typeof MockAdapter>[0]

/** 中文说明：变量 roots 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const roots: string[] = []
afterEach(() => {
  /** 中文说明：该循环依次处理事件或输出；循环变量仅在当前循环中有效。 */
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

/** Boot the continuable stack with real JSONL session persistence. */
/* 中文说明：函数 setup 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function setup(
  script: Script,
  options: { sessionProjections?: boolean; projectionCache?: boolean } = {},
) {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const root = mkdtempSync(join(tmpdir(), 'dsh-subagent-list-'))
  roots.push(root)
  await ctx.plugin(JsonlSessionPersistence, { root })
  await ctx.plugin(AgentLoop, { agents: [] })
  if (options.sessionProjections !== false) await ctx.plugin(SessionProjectionRegistry)
  if (options.projectionCache === true) {
    await ctx.plugin(Storage)
    ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
    /** 中文说明：变量 facility 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
    ctx.storage.mount('domain', facility)
    ctx.provide('storageDomain', facility)
    await ctx.plugin(SessionProjectionCache, { writeEveryEvents: 100, writeIntervalMs: 60_000 })
  }
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  await ctx.plugin(SubagentFork, { providerName: 'fork' })
  ctx.llm.registerAdapter(['mock'], new MockAdapter(script))
  /** 中文说明：变量 parent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const parent = ctx.agentLoop.create(SessionId('parent'), { provider: 'mock', model: 'mock' })
  return { ctx, parent }
}

/** 中文说明：变量 testSignal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const testSignal = new AbortController().signal

/** Start one continuable child through the real service path and await Activation release. */
/* 中文说明：函数 startChild 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function startChild(
  ctx: Context,
  parent: ReturnType<Context['agentLoop']['create']>,
  label: string,
): Promise<SessionId> {
  /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const started = await ctx.subagents.startContinuable({
    provider: 'spawn',
    label,
    request: { prompt: [{ type: 'text', text: `task: ${label}` }], parent },
    signal: testSignal,
  })
  await vi.waitFor(() => {
    expect(ctx.agents.get(started.childId)).toBeUndefined()
  }, { timeout: 5_000 })
  return started.childId
}

/** Author one persisted child session directly against the persistence backend. */
/* 中文说明：函数 authorChild 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function authorChild(
  ctx: Context,
  id: string,
  header: Partial<SessionHeader>,
  events: SessionEvent[],
): Promise<SessionId> {
  /** 中文说明：变量 sessionId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const sessionId = SessionId(id)
  await ctx.sessionPersistence.create({
    version: SESSION_FORMAT_VERSION,
    id: sessionId,
    createdAt: 1,
    ...header,
  })
  await ctx.sessionPersistence.append(sessionId, events)
  return sessionId
}

/** Minimal complete-turn child log with one descriptor payload. */
/* 中文说明：函数 childEvents 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function childEvents(descriptor: unknown): SessionEvent[] {
  return [
    { type: 'turn/start', seq: 0, time: 1, data: { turn: 1, trigger: { kind: 'message', source: { kind: 'user' } } } },
    {
      type: 'user/message',
      seq: 1,
      time: 2,
      data: createUserMessage({ content: [{ type: 'text', text: 'work' }], source: { kind: 'user' } }),
      surfaceOp: 'append',
    },
    { type: 'subagent/descriptor', seq: 2, time: 3, data: descriptor },
    { type: 'turn/end', seq: 3, time: 4, data: { turn: 1, reason: { kind: 'completed' } } },
  ] as SessionEvent[]
}

/** 中文说明：函数 descriptorPayload 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function descriptorPayload(label: string, version = SUBAGENT_DESCRIPTOR_VERSION) {
  return { version, mode: 'continuable' as const, provider: 'spawn', label }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  /** 中文说明：interface SessionProjectionStateMap 定义本测试所需的数据或行为，用于表达子代理工具场景。 */
  interface SessionProjectionStateMap {
    subagentListHostileProbe: { poisoned?: boolean | undefined }
  }
  /** 中文说明：interface SessionProjectionMap 定义本测试所需的数据或行为，用于表达子代理工具场景。 */
  interface SessionProjectionMap {
    /** Test-only hostile probe proving per-child isolation of foreign unit failures. */
    subagentListHostileProbe: null
  }
}

/**
 * A foreign registered unit that rejects one specific child's log at view
 * time: `apply` never throws (the eager drive passes every committed event
 * through it), while the poisoned state detonates only when a listing read
 * folds or serves this child through the registry.
 */
/* 中文说明：变量 hostileProjectionDefinition 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const hostileProjectionDefinition = {
  key: 'subagentListHostileProbe',
  stateSchema: z.object({ poisoned: z.boolean().optional() }),
  init: () => ({}),
  apply: (state, event) =>
    event.type === 'subagent/descriptor' && (event.data as { label?: string }).label === 'poison me'
      ? { poisoned: true }
      : state,
  wire: {
    viewSchema: z.null(),
    view: (state) => {
      if (state.poisoned === true) throw new Error('hostile unit rejects the poisoned log')
      return null
    },
  },
  stateVersion: 1,
} satisfies ProjectionDefinition<'subagentListHostileProbe', { poisoned?: boolean | undefined }>

describe('SubagentRuntime.listChildren', () => {
  it('lists live children without persistence, query services, or the continuation runtime', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SubagentRuntime)
    expect(ctx.get('jobs')).toBeUndefined()
    expect(ctx.get('agents')).toBeUndefined()
    expect(ctx.get('sessionPersistence')).toBeUndefined()

    /** 中文说明：变量 parentId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const parentId = SessionId('live-only-parent')
    ctx.sessions.create(parentId)
    /** 中文说明：变量 childId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const childId = SessionId('live-only-child')
    /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const child = ctx.sessions.create(childId, {
      meta: { parentSession: parentId, origin: 'subagent' },
    })
    child.append('turn/start', {
      turn: 1,
    })
    child.append('subagent/descriptor', descriptorPayload('live-only child'))

    await expect(ctx.subagents.listChildren(parentId)).resolves.toEqual([
      {
        kind: 'child', id: childId, label: 'live-only child', mode: 'continuable',
        activity: 'running', hasChildren: false,
      },
    ])
  })

  it('fails loud when the projection registry is not mounted, even with no children', async () => {
    const { ctx, parent } = await setup([], { sessionProjections: false })
    await expect(ctx.subagents.listChildren(parent.id)).rejects.toThrow(
      expect.objectContaining({ code: 'SUBAGENT_CONTROL_PROJECTIONS_UNAVAILABLE' }) as Error,
    )
  })

  it('fails loud when the session store is not mounted', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SubagentRuntime)
    await expect(ctx.subagents.listChildren(SessionId('no-store-parent'))).rejects.toThrow(
      expect.objectContaining({ code: 'SUBAGENT_CONTROL_SESSION_STORE_UNAVAILABLE' }) as Error,
    )
  })

  it('lists a persisted continuable child as inactive with its durable label', async () => {
    const { ctx, parent } = await setup([textResponse('done')])
    /** 中文说明：变量 childId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const childId = await startChild(ctx, parent, 'summarize the doc')
    /** 中文说明：变量 entries 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const entries = await ctx.subagents.listChildren(parent.id)
    expect(entries).toEqual([
      {
        kind: 'child', id: childId, label: 'summarize the doc', mode: 'continuable',
        activity: 'inactive', hasChildren: false,
      },
    ])
  })

  it('lists one-shot and continuable children under the same parent', async () => {
    const { ctx, parent } = await setup([textResponse('once'), textResponse('again')])
    /** 中文说明：变量 oneShot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const oneShot = await ctx.subagents.start('spawn', {
      prompt: [{ type: 'text', text: 'finish once' }],
      parent,
      signal: new AbortController().signal,
    })
    /** 中文说明：变量 oneShotId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const oneShotId = oneShot.id
    await oneShot.result
    await oneShot.dispose()
    /** 中文说明：变量 continuableId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const continuableId = await startChild(ctx, parent, 'continuable child')

    /** 中文说明：变量 entries 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const entries = await ctx.subagents.listChildren(parent.id)
    expect(entries).toHaveLength(2)
    expect(entries).toContainEqual({
      kind: 'child',
      id: oneShotId,
      mode: 'one-shot',
      activity: 'inactive',
      hasChildren: false,
    })
    expect(entries).toContainEqual({
      kind: 'child',
      id: continuableId,
      label: 'continuable child',
      mode: 'continuable',
      activity: 'inactive',
      hasChildren: false,
    })
  })

  it('accepts a persisted (non-live) parent target after restart', async () => {
    const { ctx } = await setup([])
    // A parent that exists only in persistence — the restart shape.
    /** 中文说明：变量 coldParent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const coldParent = SessionId('00000000-0000-4000-8000-00000000cccc')
    await ctx.sessionPersistence.create({
      version: SESSION_FORMAT_VERSION,
      id: coldParent,
      createdAt: 1,
    })
    await ctx.sessionPersistence.append(coldParent, [
      { type: 'turn/start', seq: 0, time: 1, data: { turn: 1, trigger: { kind: 'message', source: { kind: 'user' } } } },
      { type: 'turn/end', seq: 1, time: 2, data: { turn: 1, reason: { kind: 'completed' } } },
    ] as SessionEvent[])
    /** 中文说明：变量 childId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const childId = await authorChild(ctx, '00000000-0000-4000-8000-00000000cdcd', {
      parentSession: coldParent,
      origin: 'subagent',
    }, childEvents(descriptorPayload('persisted parent case')))
    /** 中文说明：变量 entries 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const entries = await ctx.subagents.listChildren(coldParent)
    expect(entries).toEqual([
      {
        kind: 'child', id: childId, label: 'persisted parent case', mode: 'continuable',
        activity: 'inactive', hasChildren: false,
      },
    ])
  })

  it('orders children by createdAt then id without listing ordinary forks', async () => {
    const { ctx, parent } = await setup([])
    /** Publish one live child with a pinned header ordering key. */
    /* 中文说明：函数值 liveChild 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const liveChild = (parentId: SessionId, id: string, createdAt: number, label: string): SessionId => {
      /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const session = ctx.sessions.create(SessionId(id), {
        meta: { parentSession: parentId, origin: 'subagent', createdAt },
      })
      session.append('turn/start', { turn: 1 })
      session.append('subagent/descriptor', descriptorPayload(label))
      return session.header.id
    }
    // Live creation order is deliberately shuffled against the expected
    // result: same-createdAt ties break on id, different createdAt orders
    // ascending.
    /** 中文说明：变量 late 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const late = liveChild(parent.id, '00000000-0000-4000-8000-000000000009', 9, 'late child')
    /** 中文说明：变量 tieB 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const tieB = liveChild(parent.id, '00000000-0000-4000-8000-000000000002', 5, 'tie b')
    /** 中文说明：变量 tieA 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const tieA = liveChild(parent.id, '00000000-0000-4000-8000-000000000001', 5, 'tie a')
    // An ordinary session fork shares parentSession but has no subagent origin.
    /** 中文说明：变量 fork 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fork = ctx.sessions.fork(parent.session, undefined, SessionId('plain-fork'))
    await ctx.sessions.flush(fork)
    /** 中文说明：变量 entries 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const entries = await ctx.subagents.listChildren(parent.id)
    expect(entries.map(entry => entry.id)).toEqual([tieA, tieB, late])
    expect(entries.every(entry => entry.kind === 'child')).toBe(true)
  })

  it('omits a live child that has not appended its descriptor yet', async () => {
    const { ctx, parent } = await setup([])
    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = ctx.sessions.create(SessionId('creation-window-child'), {
      meta: { parentSession: parent.id, origin: 'subagent' },
    })
    pending.append('turn/start', { turn: 1 })
    // The creation window: the establishing provider has not appended the
    // descriptor yet, so the row is omitted rather than diagnosed.
    await expect(ctx.subagents.listChildren(parent.id)).resolves.toEqual([])
  })

  it('lists a one-shot child with its durable creation label', async () => {
    const { ctx, parent } = await setup([])
    /** 中文说明：变量 labeled 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const labeled = await authorChild(ctx, '00000000-0000-4000-8000-00000000ab02', {
      parentSession: parent.id,
      origin: 'subagent',
    }, childEvents({
      version: SUBAGENT_DESCRIPTOR_VERSION,
      mode: 'one-shot',
      provider: 'spawn',
      label: 'labeled one-shot',
    }))
    await expect(ctx.subagents.listChildren(parent.id)).resolves.toEqual([
      {
        kind: 'child', id: labeled, mode: 'one-shot', label: 'labeled one-shot',
        activity: 'inactive', hasChildren: false,
      },
    ])
  })

  it('reports a live child as running while keeping settled siblings complete', async () => {
    const { ctx, parent } = await setup([textResponse('done')])
    /** 中文说明：变量 settled 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const settled = await startChild(ctx, parent, 'settled child')
    // A live child session outside persistence: publish a live session with a
    // descriptor and the parent lineage, without starting an Activation.
    /** 中文说明：变量 liveId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const liveId = SessionId('live-child')
    /** 中文说明：变量 live 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const live = ctx.sessions.create(liveId, {
      meta: { parentSession: parent.id, origin: 'subagent' },
    })
    live.append('turn/start', { turn: 1 })
    live.append('subagent/descriptor', descriptorPayload('live child'))
    /** 中文说明：变量 entries 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const entries = await ctx.subagents.listChildren(parent.id)
    expect(entries).toContainEqual({
      kind: 'child', id: settled, label: 'settled child', mode: 'continuable',
      activity: 'inactive', hasChildren: false,
    })
    expect(entries).toContainEqual({
      kind: 'child', id: liveId, label: 'live child', mode: 'continuable',
      activity: 'running', hasChildren: false,
    })
  })

  it('lists the last descriptor when a log carries more than one', async () => {
    const { ctx, parent } = await setup([textResponse('done')])
    /** 中文说明：变量 healthy 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const healthy = await startChild(ctx, parent, 'healthy sibling')
    /** 中文说明：变量 events 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const events = childEvents(descriptorPayload('twice'))
    events.splice(3, 0, {
      type: 'subagent/descriptor',
      seq: 3,
      time: 3,
      data: descriptorPayload('twice again'),
    } as SessionEvent)
    events[4] = { ...events[4]!, seq: 4 }
    /** 中文说明：变量 doubled 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const doubled = await authorChild(ctx, '00000000-0000-4000-8000-00000000dupe', {
      parentSession: parent.id,
      origin: 'subagent',
    }, events)
    // The last-wins projection fold serves the final descriptor's identity; a
    // repeated descriptor is not a per-child corruption diagnostic.
    /** 中文说明：变量 entries 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const entries = await ctx.subagents.listChildren(parent.id)
    expect(entries).toContainEqual({
      kind: 'child', id: doubled, label: 'twice again', mode: 'continuable',
      activity: 'inactive', hasChildren: false,
    })
    expect(entries).toContainEqual({
      kind: 'child', id: healthy, label: 'healthy sibling', mode: 'continuable',
      activity: 'inactive', hasChildren: false,
    })
  })

  it('serves the serializable null sentinel when a later descriptor invalidates the identity', async () => {
    const { ctx, parent } = await setup([])
    /** 中文说明：变量 liveId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const liveId = SessionId('invalidated-live-child')
    /** 中文说明：变量 live 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const live = ctx.sessions.create(liveId, {
      meta: { parentSession: parent.id, origin: 'subagent' },
    })
    live.append('turn/start', { turn: 1 })
    live.append('subagent/descriptor', descriptorPayload('was valid'))
    expect(ctx.sessionProjections.snapshot(live).values.subagent)
      .toEqual({ mode: 'continuable', label: 'was valid', seq: 1 })
    // Last-wins: the malformed follow-up resets the identity to the sentinel.
    live.append(
      'subagent/descriptor',
      { version: SUBAGENT_DESCRIPTOR_VERSION, mode: 'continuable', provider: 7 } as never,
    )
    /** 中文说明：变量 values 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const values = ctx.sessionProjections.snapshot(live).values
    expect(values.subagent).toBeNull()
    // The sentinel survives a JSON push frame; an undefined field would be
    // dropped there and a consumer would keep the stale identity forever.
    /** 中文说明：变量 wired 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const wired = JSON.parse(JSON.stringify(values)) as Record<string, unknown>
    expect('subagent' in wired).toBe(true)
    expect(wired['subagent']).toBeNull()
    // The listing reads the same null as no value: running → omitted.
    await expect(ctx.subagents.listChildren(parent.id)).resolves.toEqual([])
  })

  it('diagnoses a settled child whose later descriptor invalidated the identity as corrupt', async () => {
    const { ctx, parent } = await setup([])
    /** 中文说明：变量 events 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const events = childEvents(descriptorPayload('was valid'))
    events.splice(3, 0, {
      type: 'subagent/descriptor',
      seq: 3,
      time: 3,
      data: { version: SUBAGENT_DESCRIPTOR_VERSION, mode: 'continuable', provider: 7 },
    } as SessionEvent)
    events[4] = { ...events[4]!, seq: 4 }
    /** 中文说明：变量 invalidated 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const invalidated = await authorChild(ctx, '00000000-0000-4000-8000-00000000ad01', {
      parentSession: parent.id,
      origin: 'subagent',
    }, events)
    await expect(ctx.subagents.listChildren(parent.id)).resolves.toEqual([
      { kind: 'diagnostic', id: invalidated, reason: 'corrupt' },
    ])
  })

  it('serves a cached own-suffix identity directly without inspection', async () => {
    const { ctx, parent } = await setup([], { projectionCache: true })
    /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const child = await authorChild(ctx, '00000000-0000-4000-8000-00000000ae01', {
      parentSession: parent.id,
      origin: 'subagent',
    }, childEvents(descriptorPayload('disk label')))
    // seq 2 >= seedLength 0: the cached identity provably comes from the
    // child's own suffix, so it is final and the log is never re-read — the
    // divergent label proves the row, not the log, produced the entry.
    ctx.sessionProjectionCache.cachedSnapshot = () => ({
      asOfSeq: 2,
      values: { subagent: { mode: 'continuable', label: 'cached own', seq: 2 } },
    })
    /** 中文说明：变量 inspect 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const inspect = vi.spyOn(ctx.sessionPersistence, 'inspect')
    await expect(ctx.subagents.listChildren(parent.id)).resolves.toEqual([{
      kind: 'child', id: child, label: 'cached own', mode: 'continuable',
      activity: 'inactive', hasChildren: false,
    }])
    expect(inspect).not.toHaveBeenCalled()
  })

  it('refuses a cached ancestor identity from the fork seed and lets preparation rule', async () => {
    const { ctx, parent } = await setup([], { projectionCache: true })
    // A fork child: the seed replays the ancestor's descriptor (seq 2), and
    // the child's own descriptor arrives in its first own turn (seq 5).
    /** 中文说明：变量 seed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const seed = childEvents(descriptorPayload('ancestor label'))
    /** 中文说明：变量 events 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const events = [
      ...seed,
      { type: 'turn/start', seq: 4, time: 5, data: { turn: 2, trigger: { kind: 'message', source: { kind: 'user' } } } },
      { type: 'subagent/descriptor', seq: 5, time: 6, data: descriptorPayload('own label') },
      { type: 'turn/end', seq: 6, time: 7, data: { turn: 2, reason: { kind: 'completed' } } },
    ] as SessionEvent[]
    /** 中文说明：变量 forkChild 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const forkChild = await authorChild(ctx, '00000000-0000-4000-8000-00000000ae02', {
      parentSession: parent.id,
      seedLength: seed.length,
      origin: 'subagent',
    }, events)
    // A creation-window checkpoint carried the ANCESTOR identity: its seq 2
    // fails the own-suffix gate (< seedLength 4), so preparation rules.
    ctx.sessionProjectionCache.cachedSnapshot = () => ({
      asOfSeq: 2,
      values: { subagent: { mode: 'continuable', label: 'ancestor label', seq: 2 } },
    })
    /** 中文说明：变量 inspect 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const inspect = vi.spyOn(ctx.sessionPersistence, 'inspect')
    await expect(ctx.subagents.listChildren(parent.id)).resolves.toEqual([{
      kind: 'child', id: forkChild, label: 'own label', mode: 'continuable',
      activity: 'inactive', hasChildren: false,
    }])
    expect(inspect).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['version', (meta: SessionHeader): SessionHeader => ({ ...meta, version: meta.version + 1 })],
    ['id', (meta: SessionHeader): SessionHeader => ({ ...meta, id: SessionId('another-lifecycle') })],
    ['createdAt', (meta: SessionHeader): SessionHeader => ({ ...meta, createdAt: meta.createdAt + 1 })],
    ['cwd', (meta: SessionHeader): SessionHeader => ({ ...meta, cwd: '/elsewhere' })],
    ['parentSession', (meta: SessionHeader): SessionHeader => ({ ...meta, parentSession: SessionId('another-parent') })],
    ['seedLength', (meta: SessionHeader): SessionHeader => ({ ...meta, seedLength: (meta.seedLength ?? 0) + 1 })],
    ['delegationDepth', (meta: SessionHeader): SessionHeader => ({ ...meta, delegationDepth: (meta.delegationDepth ?? 0) + 1 })],
  ] as const)('diagnoses an inspection returning another lifecycle (%s) as corrupt', async (_field, mutate) => {
    const { ctx, parent } = await setup([textResponse('done')])
    /** 中文说明：变量 healthy 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const healthy = await startChild(ctx, parent, 'healthy sibling')
    /** 中文说明：变量 reborn 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const reborn = await authorChild(ctx, '00000000-0000-4000-8000-00000000ae03', {
      parentSession: parent.id,
      origin: 'subagent',
    }, childEvents(descriptorPayload('reborn child')))
    /** 中文说明：变量 original 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const original = ctx.sessionPersistence.inspect.bind(ctx.sessionPersistence)
    ctx.sessionPersistence.inspect = async (sessionId, signal) => {
      /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const result = await original(sessionId, signal)
      if (sessionId !== reborn) return result
      // The id was re-published as a different lifecycle after enumeration.
      return { ...result, meta: mutate(result.meta) }
    }
    /** 中文说明：变量 entries 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const entries = await ctx.subagents.listChildren(parent.id)
    expect(entries).toContainEqual({ kind: 'diagnostic', id: reborn, reason: 'corrupt' })
    expect(entries).toContainEqual({
      kind: 'child', id: healthy, label: 'healthy sibling', mode: 'continuable',
      activity: 'inactive', hasChildren: false,
    })
  })

  it('lets preparation rule when the cache serves the null sentinel', async () => {
    const { ctx, parent } = await setup([], { projectionCache: true })
    /** 中文说明：变量 healthy 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const healthy = await authorChild(ctx, '00000000-0000-4000-8000-00000000ad02', {
      parentSession: parent.id,
      origin: 'subagent',
    }, childEvents(descriptorPayload('actually valid')))
    // A stale cached sentinel must not out-rank the authoritative re-fold.
    ctx.sessionProjectionCache.cachedSnapshot = () => ({ asOfSeq: 0, values: { subagent: null } })
    /** 中文说明：变量 inspect 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const inspect = vi.spyOn(ctx.sessionPersistence, 'inspect')
    await expect(ctx.subagents.listChildren(parent.id)).resolves.toEqual([{
      kind: 'child', id: healthy, label: 'actually valid', mode: 'continuable',
      activity: 'inactive', hasChildren: false,
    }])
    expect(inspect).toHaveBeenCalledTimes(1)
  })

  it('maps a child rejected by persistence inspection to unavailable', async () => {
    const { ctx, parent } = await setup([])
    // The surface-eligible user/message lacks its required surfaceOp, so the
    // first-party inspection rejects before any projection fold can run.
    /** 中文说明：变量 invalid 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const invalid = await authorChild(ctx, '00000000-0000-4000-8000-0000000000ee', {
      parentSession: parent.id,
      origin: 'subagent',
    }, [
      { type: 'turn/start', seq: 0, time: 1, data: { turn: 1, trigger: { kind: 'message', source: { kind: 'user' } } } },
      {
        type: 'user/message',
        seq: 1,
        time: 2,
        data: createUserMessage({ content: [{ type: 'text', text: 'work' }], source: { kind: 'user' } }),
      },
      { type: 'subagent/descriptor', seq: 2, time: 3, data: descriptorPayload('broken surface') },
    ] as SessionEvent[])
    /** 中文说明：变量 entries 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const entries = await ctx.subagents.listChildren(parent.id)
    expect(entries).toEqual([{ kind: 'diagnostic', id: invalid, reason: 'unavailable' }])
  })

  it('diagnoses a malformed descriptor payload as corrupt', async () => {
    const { ctx, parent } = await setup([])
    /** 中文说明：变量 malformed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const malformed = await authorChild(ctx, '00000000-0000-4000-8000-0000000000ff', {
      parentSession: parent.id,
      origin: 'subagent',
    }, childEvents({ version: SUBAGENT_DESCRIPTOR_VERSION, mode: 'continuable', provider: 7 }))
    /** 中文说明：变量 entries 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const entries = await ctx.subagents.listChildren(parent.id)
    expect(entries).toEqual([{ kind: 'diagnostic', id: malformed, reason: 'corrupt' }])
  })

  it('diagnoses an unknown descriptor version as corrupt', async () => {
    const { ctx, parent } = await setup([])
    /** 中文说明：变量 future 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const future = await authorChild(ctx, '00000000-0000-4000-8000-0000000000aa', {
      parentSession: parent.id,
      origin: 'subagent',
    }, childEvents(descriptorPayload('from the future', SUBAGENT_DESCRIPTOR_VERSION + 1)))
    // The projection fold does not distinguish an unrecognized version from
    // other invalid descriptors: both serve no identity, and a settled
    // no-value candidate is corrupt.
    /** 中文说明：变量 entries 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const entries = await ctx.subagents.listChildren(parent.id)
    expect(entries).toEqual([{ kind: 'diagnostic', id: future, reason: 'corrupt' }])
  })

  it('lists a fork whose seed replays an ancestor descriptor under that identity', async () => {
    const { ctx, parent } = await setup([])
    // The last-wins fold serves a seed-replayed ancestor descriptor until the
    // child's own descriptor overrides it (known deviation #1 in the design).
    /** 中文说明：变量 seed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const seed = childEvents(descriptorPayload('ancestor label'))
    /** 中文说明：变量 forkChild 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const forkChild = await authorChild(ctx, '00000000-0000-4000-8000-0000000000f0', {
      parentSession: parent.id,
      seedLength: seed.length,
      origin: 'subagent',
    }, seed)
    /** 中文说明：变量 entries 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const entries = await ctx.subagents.listChildren(parent.id)
    expect(entries).toEqual([
      {
        kind: 'child', id: forkChild, label: 'ancestor label', mode: 'continuable',
        activity: 'inactive', hasChildren: false,
      },
    ])
  })

  it('does not filter by provider availability: children of unmounted providers stay listed', async () => {
    const { ctx, parent } = await setup([])
    /** 中文说明：变量 foreign 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const foreign = await authorChild(ctx, '00000000-0000-4000-8000-0000000000bb', {
      parentSession: parent.id,
      origin: 'subagent',
    }, childEvents({
      version: SUBAGENT_DESCRIPTOR_VERSION,
      mode: 'continuable',
      provider: 'not-mounted',
      label: 'orphan provider',
    }))
    /** 中文说明：变量 entries 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const entries = await ctx.subagents.listChildren(parent.id)
    expect(entries).toEqual([
      {
        kind: 'child', id: foreign, label: 'orphan provider', mode: 'continuable',
        activity: 'inactive', hasChildren: false,
      },
    ])
  })

  it('contains a foreign unit failure during a cold fold to that child as corrupt', async () => {
    const { ctx, parent } = await setup([textResponse('done')])
    ctx.sessionProjections.register(hostileProjectionDefinition)
    /** 中文说明：变量 healthy 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const healthy = await startChild(ctx, parent, 'healthy sibling')
    /** 中文说明：变量 poisoned 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const poisoned = await authorChild(ctx, '00000000-0000-4000-8000-00000000d00d', {
      parentSession: parent.id,
      origin: 'subagent',
    }, childEvents(descriptorPayload('poison me')))
    // The subagent unit itself folds this child cleanly; the FOREIGN unit's
    // view throws, and that damage stays contained to the one child.
    /** 中文说明：变量 entries 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const entries = await ctx.subagents.listChildren(parent.id)
    expect(entries).toContainEqual({ kind: 'diagnostic', id: poisoned, reason: 'corrupt' })
    expect(entries).toContainEqual({
      kind: 'child', id: healthy, label: 'healthy sibling', mode: 'continuable',
      activity: 'inactive', hasChildren: false,
    })
  })

  it('contains a foreign unit failure during a live snapshot to that child as corrupt', async () => {
    const { ctx, parent } = await setup([])
    ctx.sessionProjections.register(hostileProjectionDefinition)
    /** 中文说明：变量 poisonedId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const poisonedId = SessionId('live-poisoned-child')
    /** 中文说明：变量 poisoned 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const poisoned = ctx.sessions.create(poisonedId, {
      meta: { parentSession: parent.id, origin: 'subagent' },
    })
    poisoned.append('turn/start', { turn: 1 })
    poisoned.append('subagent/descriptor', descriptorPayload('poison me'))
    /** 中文说明：变量 healthyId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const healthyId = SessionId('live-healthy-child')
    /** 中文说明：变量 healthy 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const healthy = ctx.sessions.create(healthyId, {
      meta: { parentSession: parent.id, origin: 'subagent' },
    })
    healthy.append('turn/start', { turn: 1 })
    healthy.append('subagent/descriptor', descriptorPayload('live healthy'))
    /** 中文说明：变量 entries 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const entries = await ctx.subagents.listChildren(parent.id)
    expect(entries).toContainEqual({ kind: 'diagnostic', id: poisonedId, reason: 'corrupt' })
    expect(entries).toContainEqual({
      kind: 'child', id: healthyId, label: 'live healthy', mode: 'continuable',
      activity: 'running', hasChildren: false,
    })
  })

  it('fails the whole enumeration when the persisted listing itself fails', async () => {
    const { ctx, parent } = await setup([textResponse('done')])
    await startChild(ctx, parent, 'never listed')
    ctx.sessionPersistence.list = () => Promise.reject(new Error('backend listing failed'))
    // Without any abort in flight, the original backend failure propagates
    // as the operation failure — no cancellation mapping, no diagnostic rows.
    await expect(ctx.subagents.listChildren(parent.id)).rejects.toThrow('backend listing failed')
  })

  it('maps a failed cold inspection to one unavailable diagnostic and retries it next listing', async () => {
    const { ctx, parent } = await setup([textResponse('done')])
    /** 中文说明：变量 healthy 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const healthy = await startChild(ctx, parent, 'healthy sibling')
    /** 中文说明：变量 flaky 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const flaky = await authorChild(ctx, '00000000-0000-4000-8000-00000000f1a7', {
      parentSession: parent.id,
      origin: 'subagent',
    }, childEvents(descriptorPayload('flaky storage')))
    /** 中文说明：变量 original 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const original = ctx.sessionPersistence.inspect.bind(ctx.sessionPersistence)
    ctx.sessionPersistence.inspect = (sessionId, signal) => {
      if (sessionId === flaky) {
        return Promise.reject(new Error('backend read failed'))
      }
      return original(sessionId, signal)
    }
    // Per-child isolation: the failed child degrades to one diagnostic while
    // the healthy sibling stays complete.
    /** 中文说明：变量 degraded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const degraded = await ctx.subagents.listChildren(parent.id)
    expect(degraded).toContainEqual({ kind: 'diagnostic', id: flaky, reason: 'unavailable' })
    expect(degraded).toContainEqual({
      kind: 'child', id: healthy, label: 'healthy sibling', mode: 'continuable',
      activity: 'inactive', hasChildren: false,
    })
    // Nothing is memoized: with the backend healthy again, the next listing
    // folds the same child to its identity.
    ctx.sessionPersistence.inspect = original
    await expect(ctx.subagents.listChildren(parent.id)).resolves.toContainEqual({
      kind: 'child', id: flaky, label: 'flaky storage', mode: 'continuable',
      activity: 'inactive', hasChildren: false,
    })
  })

  it('lists compacted and uncompacted children identically', async () => {
    const { ctx, parent } = await setup([])
    /** 中文说明：变量 plain 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const plain = await authorChild(ctx, '00000000-0000-4000-8000-00000000c0de', {
      parentSession: parent.id,
      createdAt: 1,
      origin: 'subagent',
    }, childEvents(descriptorPayload('twin child')))
    // The compacted twin: a compaction checkpoint replaces the whole surface,
    // while the append-only log retains the model-hidden descriptor event.
    /** 中文说明：变量 compactedEvents 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const compactedEvents = childEvents(descriptorPayload('twin child'))
    compactedEvents.push({
      type: 'user/message',
      seq: 4,
      time: 5,
      data: createUserMessage({
        content: [{ type: 'text', text: 'summary of everything' }],
        source: { kind: 'plugin', plugin: 'compact' },
      }),
      surfaceOp: { op: 'replace', start: 1, end: 1 },
      sourceEventSeqs: [1],
    })
    /** 中文说明：变量 compacted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const compacted = await authorChild(ctx, '00000000-0000-4000-8000-00000000c1de', {
      parentSession: parent.id,
      createdAt: 2,
      origin: 'subagent',
    }, compactedEvents)
    /** 中文说明：变量 entries 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const entries = await ctx.subagents.listChildren(parent.id)
    expect(entries).toEqual([
      {
        kind: 'child', id: plain, label: 'twin child', mode: 'continuable',
        activity: 'inactive', hasChildren: false,
      },
      {
        kind: 'child', id: compacted, label: 'twin child', mode: 'continuable',
        activity: 'inactive', hasChildren: false,
      },
    ])
  })

  it('reports an origin-classified grandchild without inspecting it', async () => {
    const { ctx, parent } = await setup([textResponse('done')])
    /** 中文说明：变量 childId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const childId = await startChild(ctx, parent, 'direct child')
    /** 中文说明：变量 grandchildId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const grandchildId = await authorChild(ctx, '00000000-0000-4000-8000-0000000000cc', {
      parentSession: childId,
      origin: 'subagent',
    }, childEvents(descriptorPayload('grandchild')))
    /** 中文说明：变量 inspected 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const inspected: SessionId[] = []
    /** 中文说明：变量 original 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const original = ctx.sessionPersistence.inspect.bind(ctx.sessionPersistence)
    ctx.sessionPersistence.inspect = (sessionId, signal) => {
      inspected.push(sessionId)
      return original(sessionId, signal)
    }
    /** 中文说明：变量 entries 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const entries = await ctx.subagents.listChildren(parent.id)
    expect(entries).toEqual([
      {
        kind: 'child', id: childId, label: 'direct child', mode: 'continuable',
        activity: 'inactive', hasChildren: true,
      },
    ])
    // The grandchild contributes only its header to the hasChildren hint.
    expect(inspected).toContain(childId)
    expect(inspected).not.toContain(grandchildId)
  })

  it('inspects each cold child exactly once and a live child never', async () => {
    const { ctx, parent } = await setup([textResponse('done')])
    /** 中文说明：变量 coldStarted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const coldStarted = await startChild(ctx, parent, 'cold started child')
    /** 中文说明：变量 coldAuthored 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const coldAuthored = await authorChild(ctx, '00000000-0000-4000-8000-00000000ab01', {
      parentSession: parent.id,
      origin: 'subagent',
    }, childEvents(descriptorPayload('cold authored child')))
    /** 中文说明：变量 liveId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const liveId = SessionId('live-mixed-child')
    /** 中文说明：变量 live 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const live = ctx.sessions.create(liveId, {
      meta: { parentSession: parent.id, origin: 'subagent' },
    })
    live.append('turn/start', { turn: 1 })
    live.append('subagent/descriptor', descriptorPayload('live mixed child'))

    /** 中文说明：变量 inspected 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const inspected: SessionId[] = []
    /** 中文说明：变量 original 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const original = ctx.sessionPersistence.inspect.bind(ctx.sessionPersistence)
    ctx.sessionPersistence.inspect = (sessionId, signal) => {
      inspected.push(sessionId)
      return original(sessionId, signal)
    }
    /** 中文说明：变量 entries 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const entries = await ctx.subagents.listChildren(parent.id)
    expect(entries).toHaveLength(3)
    // The cost model: one inspection per cold child, none for a live child,
    // whose identity is served from the registry's watermark cache.
    expect(inspected.filter(id => id === coldStarted)).toHaveLength(1)
    expect(inspected.filter(id => id === coldAuthored)).toHaveLength(1)
    expect(inspected).not.toContain(liveId)
  })

  it('serves a cold child from the projection cache without any inspection', async () => {
    const { ctx, parent } = await setup([textResponse('done')], { projectionCache: true })
    /** 中文说明：变量 childId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const childId = await startChild(ctx, parent, 'cached child')
    // The child's turn/end and disposal are the cache's mandatory checkpoint
    // points; both writes are fail-soft asynchronous, so wait for the row.
    /** 中文说明：函数值 header 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const header = (await ctx.sessionPersistence.list()).find(meta => meta.id === childId)
    await vi.waitFor(() => {
      expect(ctx.sessionProjectionCache.cachedSnapshot(header!)?.values.subagent).toBeDefined()
    }, { timeout: 5_000 })
    /** 中文说明：变量 inspect 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const inspect = vi.spyOn(ctx.sessionPersistence, 'inspect')
    await expect(ctx.subagents.listChildren(parent.id)).resolves.toEqual([{
      kind: 'child', id: childId, label: 'cached child', mode: 'continuable',
      activity: 'inactive', hasChildren: false,
    }])
    expect(inspect).not.toHaveBeenCalled()
  })

  it('falls back to inspection when the cache serves no identity for the child', async () => {
    const { ctx, parent } = await setup([], { projectionCache: true })
    /** 中文说明：变量 foreign 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const foreign = await authorChild(ctx, '00000000-0000-4000-8000-00000000ac01', {
      parentSession: parent.id,
      origin: 'subagent',
    }, childEvents(descriptorPayload('uncached child')))
    /** 中文说明：变量 expected 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const expected = [{
      kind: 'child', id: foreign, label: 'uncached child', mode: 'continuable',
      activity: 'inactive', hasChildren: false,
    }]
    // No stored row at all for a foreign child this process never ran.
    /** 中文说明：变量 inspect 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const inspect = vi.spyOn(ctx.sessionPersistence, 'inspect')
    await expect(ctx.subagents.listChildren(parent.id)).resolves.toEqual(expected)
    expect(inspect).toHaveBeenCalledTimes(1)
    // A stored row whose cut predates the descriptor: the subagent key is
    // absent from the served values, and preparation still rules.
    ctx.sessionProjectionCache.cachedSnapshot = () => ({ asOfSeq: 0, values: {} })
    await expect(ctx.subagents.listChildren(parent.id)).resolves.toEqual(expected)
    expect(inspect).toHaveBeenCalledTimes(2)
  })

  it('takes the preparation rung directly when no projection cache is mounted', async () => {
    const { ctx, parent } = await setup([])
    expect(ctx.get('sessionProjectionCache')).toBeUndefined()
    /** 中文说明：变量 foreign 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const foreign = await authorChild(ctx, '00000000-0000-4000-8000-00000000ac02', {
      parentSession: parent.id,
      origin: 'subagent',
    }, childEvents(descriptorPayload('uncacheable child')))
    /** 中文说明：变量 inspect 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const inspect = vi.spyOn(ctx.sessionPersistence, 'inspect')
    await expect(ctx.subagents.listChildren(parent.id)).resolves.toEqual([{
      kind: 'child', id: foreign, label: 'uncacheable child', mode: 'continuable',
      activity: 'inactive', hasChildren: false,
    }])
    expect(inspect).toHaveBeenCalledTimes(1)
  })

  it('silently falls through to preparation when the cache read throws', async () => {
    const { ctx, parent } = await setup([], { projectionCache: true })
    /** 中文说明：变量 recovered 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const recovered = await authorChild(ctx, '00000000-0000-4000-8000-00000000ac03', {
      parentSession: parent.id,
      origin: 'subagent',
    }, childEvents(descriptorPayload('recovered child')))
    ctx.sessionProjectionCache.cachedSnapshot = () => {
      // A poisoned stored row (any unit's) detonates at view time; the cache
      // is derived data, so its failure must not become a verdict.
      throw new Error('poisoned cache row')
    }
    /** 中文说明：变量 inspect 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const inspect = vi.spyOn(ctx.sessionPersistence, 'inspect')
    await expect(ctx.subagents.listChildren(parent.id)).resolves.toEqual([{
      kind: 'child', id: recovered, label: 'recovered child', mode: 'continuable',
      activity: 'inactive', hasChildren: false,
    }])
    expect(inspect).toHaveBeenCalledTimes(1)
  })

  it('does not count an ordinary grandchild without subagent origin', async () => {
    const { ctx, parent } = await setup([textResponse('done')])
    /** 中文说明：变量 childId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const childId = await startChild(ctx, parent, 'direct child')
    await authorChild(ctx, '00000000-0000-4000-8000-0000000000f1', {
      parentSession: childId,
    }, [
      { type: 'turn/start', seq: 0, time: 1, data: { turn: 1, trigger: { kind: 'message', source: { kind: 'user' } } } },
      { type: 'turn/end', seq: 1, time: 2, data: { turn: 1, reason: { kind: 'completed' } } },
    ] as SessionEvent[])

    await expect(ctx.subagents.listChildren(parent.id)).resolves.toEqual([{
      kind: 'child', id: childId, label: 'direct child', mode: 'continuable',
      activity: 'inactive', hasChildren: false,
    }])
  })

  it('counts an origin-classified diagnostic grandchild', async () => {
    const { ctx, parent } = await setup([textResponse('done')])
    /** 中文说明：变量 childId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const childId = await startChild(ctx, parent, 'direct child')
    /** 中文说明：变量 diagnosticId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const diagnosticId = await authorChild(ctx, '00000000-0000-4000-8000-0000000000f2', {
      parentSession: childId,
      origin: 'subagent',
    }, childEvents({ version: SUBAGENT_DESCRIPTOR_VERSION, mode: 'continuable', provider: 7 }))

    await expect(ctx.subagents.listChildren(childId)).resolves.toEqual([
      { kind: 'diagnostic', id: diagnosticId, reason: 'corrupt' },
    ])
    await expect(ctx.subagents.listChildren(parent.id)).resolves.toEqual([{
      kind: 'child', id: childId, label: 'direct child', mode: 'continuable',
      activity: 'inactive', hasChildren: true,
    }])
  })

  it('a pre-aborted signal stops before any persistence read', async () => {
    const { ctx, parent } = await setup([])
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    controller.abort()
    ctx.sessionPersistence.list = () => Promise.reject(new Error('must not be called'))
    await expect(ctx.subagents.listChildren(parent.id, controller.signal)).rejects.toThrow(
      expect.objectContaining({ code: 'CANCELLED' }) as Error,
    )
  })

  it('forwards cancellation to the persisted listing and reports the stable subagent error', async () => {
    const { ctx, parent } = await setup([])
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    /** 中文说明：变量 entered 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const entered = Promise.withResolvers<undefined>()
    ctx.sessionPersistence.list = (signal) => {
      entered.resolve(undefined)
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          reject(new Error('backend listing aborted'))
        }, { once: true })
      })
    }
    /** 中文说明：变量 listing 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const listing = ctx.subagents.listChildren(parent.id, controller.signal)
    await entered.promise
    controller.abort()
    await expect(listing).rejects.toThrow(
      expect.objectContaining({ code: 'CANCELLED' }) as Error,
    )
  })

  it('forwards cancellation to a cold inspection and reports the stable subagent error', async () => {
    const { ctx, parent } = await setup([])
    await authorChild(ctx, '00000000-0000-4000-8000-00000000ce11', {
      parentSession: parent.id,
      origin: 'subagent',
    }, childEvents(descriptorPayload('cancelled cold read')))
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    /** 中文说明：变量 entered 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const entered = Promise.withResolvers<undefined>()
    ctx.sessionPersistence.inspect = (_sessionId, signal) => {
      entered.resolve(undefined)
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          reject(new Error('backend read aborted'))
        }, { once: true })
      })
    }
    /** 中文说明：变量 listing 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const listing = ctx.subagents.listChildren(parent.id, controller.signal)
    await entered.promise
    controller.abort()
    await expect(listing).rejects.toThrow(
      expect.objectContaining({ code: 'CANCELLED' }) as Error,
    )
  })

  it('an abort observed after a cold inspection resolves cannot become a successful result', async () => {
    const { ctx, parent } = await setup([])
    await authorChild(ctx, '00000000-0000-4000-8000-00000000ce12', {
      parentSession: parent.id,
      origin: 'subagent',
    }, childEvents(descriptorPayload('cancelled mid-listing')))
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    /** 中文说明：变量 original 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const original = ctx.sessionPersistence.inspect.bind(ctx.sessionPersistence)
    ctx.sessionPersistence.inspect = async (sessionId, signal) => {
      /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const result = await original(sessionId, signal)
      controller.abort()
      return result
    }
    // The post-read checkpoint throws the stable subagent error instead of
    // interpreting the fully-read log as a successful listing.
    await expect(ctx.subagents.listChildren(parent.id, controller.signal))
      .rejects.toThrow(expect.objectContaining({ code: 'CANCELLED' }) as Error)
  })

  it('a cold inspection failure during an abort cannot become an unavailable diagnostic', async () => {
    const { ctx, parent } = await setup([])
    await authorChild(ctx, '00000000-0000-4000-8000-00000000ce13', {
      parentSession: parent.id,
      origin: 'subagent',
    }, childEvents(descriptorPayload('aborted behind a failure')))
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    ctx.sessionPersistence.inspect = () => {
      // The read fails while the caller aborts: cancellation normalization
      // must fail the listing rather than return a one-diagnostic success.
      controller.abort()
      return Promise.reject(new Error('backend read failed'))
    }
    await expect(ctx.subagents.listChildren(parent.id, controller.signal)).rejects.toThrow(
      expect.objectContaining({ code: 'CANCELLED' }) as Error,
    )
  })

  it('returns an empty array for a parent with no children', async () => {
    const { ctx, parent } = await setup([])
    await ctx.sessions.flush(parent.session)
    await expect(ctx.subagents.listChildren(parent.id)).resolves.toEqual([])
  })

  it('SubagentError from listChildren is typed with its stable code', async () => {
    const { ctx, parent } = await setup([], { sessionProjections: false })
    /** 中文说明：函数值 caught 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const caught: unknown = await ctx.subagents.listChildren(parent.id).catch((error: unknown) => error)
    expect(caught).toBeInstanceOf(SubagentError)
    expect((caught as SubagentError).code).toBe('SUBAGENT_CONTROL_PROJECTIONS_UNAVAILABLE')
  })
})

describe('SubagentRuntime.listDescendants', () => {
  it('flattens the complete tree in stable pre-order with verified parent and depth', async () => {
    const { ctx, parent } = await setup([])
    /** 中文说明：变量 childA 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const childA = await authorChild(ctx, '00000000-0000-4000-8000-00000000aaa1', {
      parentSession: parent.id,
      createdAt: 1,
      origin: 'subagent',
    }, childEvents(descriptorPayload('branch a')))
    /** 中文说明：变量 grandchild 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const grandchild = await authorChild(ctx, '00000000-0000-4000-8000-00000000aaa2', {
      parentSession: childA,
      createdAt: 2,
      origin: 'subagent',
    }, childEvents(descriptorPayload('under a')))
    /** 中文说明：变量 childB 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const childB = await authorChild(ctx, '00000000-0000-4000-8000-00000000aaa3', {
      parentSession: parent.id,
      createdAt: 3,
      origin: 'subagent',
    }, childEvents(descriptorPayload('branch b')))

    /** 中文说明：变量 entries 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const entries = await ctx.subagents.listDescendants(parent.id)
    expect(entries).toEqual([
      {
        kind: 'child', id: childA, label: 'branch a', mode: 'continuable',
        activity: 'inactive', hasChildren: true, parentId: parent.id, depth: 1,
      },
      {
        kind: 'child', id: grandchild, label: 'under a', mode: 'continuable',
        activity: 'inactive', hasChildren: false, parentId: childA, depth: 2,
      },
      {
        kind: 'child', id: childB, label: 'branch b', mode: 'continuable',
        activity: 'inactive', hasChildren: false, parentId: parent.id, depth: 1,
      },
    ])
  })

  it('returns an empty result when the root has no descendants', async () => {
    const { ctx, parent } = await setup([])
    await ctx.sessions.flush(parent.session)
    await expect(ctx.subagents.listDescendants(parent.id)).resolves.toEqual([])
  })

  it('omits a live creation-window candidate while continuing through its subtree', async () => {
    const { ctx, parent } = await setup([])
    /** 中文说明：变量 bareId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bareId = SessionId('live-creation-window')
    /** 中文说明：变量 bare 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bare = ctx.sessions.create(bareId, {
      meta: { createdAt: 1, parentSession: parent.id, origin: 'subagent' },
    })
    bare.append('turn/start', { turn: 1 })
    /** 中文说明：变量 below 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const below = await authorChild(ctx, '00000000-0000-4000-8000-00000000aaaf', {
      parentSession: bareId,
      createdAt: 2,
      origin: 'subagent',
    }, childEvents(descriptorPayload('below the creation window')))

    await expect(ctx.subagents.listDescendants(parent.id)).resolves.toEqual([{
      kind: 'child', id: below, label: 'below the creation window', mode: 'continuable',
      activity: 'inactive', hasChildren: false, parentId: bareId, depth: 2,
    }])
  })

  it('contains a corrupt parent cycle without revisiting the requested root', async () => {
    const { ctx } = await setup([])
    /** 中文说明：变量 rootId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const rootId = SessionId('cycle-root')
    /** 中文说明：变量 nodeId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const nodeId = SessionId('cycle-node')
    await authorChild(ctx, rootId, {
      parentSession: nodeId,
      createdAt: 2,
    }, childEvents(descriptorPayload('ordinary cycle root')))
    await authorChild(ctx, nodeId, {
      parentSession: rootId,
      createdAt: 1,
      origin: 'subagent',
    }, childEvents(descriptorPayload('cycle child')))

    await expect(ctx.subagents.listDescendants(rootId)).resolves.toEqual([{
      kind: 'child', id: nodeId, label: 'cycle child', mode: 'continuable',
      activity: 'inactive', hasChildren: false, parentId: rootId, depth: 1,
    }])
  })


  it('walks a deeply nested ordinary-session chain without consuming the call stack', { timeout: 20_000 }, async () => {
    const { ctx, parent } = await setup([])
    /** 中文说明：变量 depth 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const depth = 10_000
    /** 中文说明：变量 parentId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let parentId = parent.id
    /** 中文说明：该循环依次处理事件或输出；循环变量仅在当前循环中有效。 */
    for (let level = 1; level < depth; level += 1) {
      /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const session = ctx.sessions.create(SessionId(`deep-ordinary-${level}`), {
        meta: { createdAt: level, parentSession: parentId },
      })
      parentId = session.id
    }
    /** 中文说明：变量 leafId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const leafId = SessionId('deep-subagent-leaf')
    /** 中文说明：变量 leaf 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const leaf = ctx.sessions.create(leafId, {
      meta: { createdAt: depth, parentSession: parentId, origin: 'subagent' },
    })
    leaf.append('turn/start', { turn: 1 })
    leaf.append('subagent/descriptor', descriptorPayload('deep leaf'))

    await expect(ctx.subagents.listDescendants(parent.id)).resolves.toEqual([{
      kind: 'child', id: leafId, label: 'deep leaf', mode: 'continuable',
      activity: 'running', hasChildren: false, parentId, depth,
    }])
  })

  it('discovers continuable descendants below ordinary and one-shot intermediates', { timeout: 20_000 }, async () => {
    const { ctx, parent } = await setup([textResponse('one shot')])
    // An ordinary fork has no descriptor: omitted itself, subtree still walked.
    /** 中文说明：变量 fork 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fork = ctx.sessions.fork(parent.session, undefined, SessionId('plain-fork'))
    await ctx.sessions.flush(fork)
    /** 中文说明：变量 underFork 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const underFork = await authorChild(ctx, '00000000-0000-4000-8000-00000000bbb1', {
      parentSession: fork.header.id,
      createdAt: 2,
      origin: 'subagent',
    }, childEvents(descriptorPayload('under the fork')))
    // A real one-shot child, then a continuable authored below it.
    /** 中文说明：变量 oneShot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const oneShot = await ctx.subagents.start('spawn', {
      label: 'one-shot intermediate',
      prompt: [{ type: 'text', text: 'one-shot task' }],
      parent,
      signal: testSignal,
    })
    await oneShot.result
    await ctx.sessions.flush(oneShot.localAgent!.session)
    /** 中文说明：变量 oneShotId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const oneShotId = oneShot.id
    await oneShot.dispose()
    /** 中文说明：变量 underOneShot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const underOneShot = await authorChild(ctx, '00000000-0000-4000-8000-00000000bbb2', {
      parentSession: oneShotId,
      createdAt: 9_999_999_999_999,
      origin: 'subagent',
    }, childEvents(descriptorPayload('under the one-shot')))

    /** 中文说明：变量 entries 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const entries = await ctx.subagents.listDescendants(parent.id)
    // The fork is absent (descriptor-less); the one-shot is present with its
    // mode so a caller can see the lineage it walked through.
    expect(entries.map(entry => entry.id)).not.toContain(fork.header.id)
    expect(entries).toContainEqual({
      kind: 'child', id: underFork, label: 'under the fork', mode: 'continuable',
      activity: 'inactive', hasChildren: false, parentId: fork.header.id, depth: 2,
    })
    expect(entries).toContainEqual(expect.objectContaining({
      kind: 'child', id: oneShotId, mode: 'one-shot', parentId: parent.id, depth: 1,
    }))
    expect(entries).toContainEqual({
      kind: 'child', id: underOneShot, label: 'under the one-shot', mode: 'continuable',
      activity: 'inactive', hasChildren: false, parentId: oneShotId, depth: 2,
    })
    // Pre-order: every child appears after its own parent entry.
    /** 中文说明：函数值 position 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const position = new Map(entries.map((entry, index) => [entry.id, index]))
    expect(position.get(underOneShot)!).toBeGreaterThan(position.get(oneShotId)!)
  })

  it('diagnoses a settled descriptor-less node while walking its subtree', async () => {
    const { ctx, parent } = await setup([])
    // A settled origin-marked candidate without an identity is corrupt under
    // the projection contract, but its subtree remains independently visible.
    /** 中文说明：变量 bare 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bare = await authorChild(ctx, '00000000-0000-4000-8000-00000000eee1', {
      parentSession: parent.id,
      createdAt: 1,
      origin: 'subagent',
    }, [
      { type: 'turn/start', seq: 0, time: 1, data: { turn: 1, trigger: { kind: 'message', source: { kind: 'user' } } } },
      { type: 'turn/end', seq: 1, time: 2, data: { turn: 1, reason: { kind: 'completed' } } },
    ] as SessionEvent[])
    /** 中文说明：变量 below 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const below = await authorChild(ctx, '00000000-0000-4000-8000-00000000eee2', {
      parentSession: bare,
      createdAt: 2,
      origin: 'subagent',
    }, childEvents(descriptorPayload('below the bare node')))

    await expect(ctx.subagents.listDescendants(parent.id)).resolves.toEqual([
      { kind: 'diagnostic', id: bare, reason: 'corrupt', parentId: parent.id, depth: 1 },
      {
        kind: 'child', id: below, label: 'below the bare node', mode: 'continuable',
        activity: 'inactive', hasChildren: false, parentId: bare, depth: 2,
      },
    ])
  })

  it('keeps traversing below a corrupt intermediate and positions its diagnostic', async () => {
    const { ctx, parent } = await setup([])
    /** 中文说明：变量 corrupt 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const corrupt = await authorChild(ctx, '00000000-0000-4000-8000-00000000ccc1', {
      parentSession: parent.id,
      createdAt: 1,
      origin: 'subagent',
    }, childEvents(descriptorPayload('unsupported descriptor', 999)))
    /** 中文说明：变量 below 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const below = await authorChild(ctx, '00000000-0000-4000-8000-00000000ccc2', {
      parentSession: corrupt,
      createdAt: 2,
      origin: 'subagent',
    }, childEvents(descriptorPayload('below the corrupt node')))

    /** 中文说明：变量 entries 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const entries = await ctx.subagents.listDescendants(parent.id)
    expect(entries).toEqual([
      { kind: 'diagnostic', id: corrupt, reason: 'corrupt', parentId: parent.id, depth: 1 },
      {
        kind: 'child', id: below, label: 'below the corrupt node', mode: 'continuable',
        activity: 'inactive', hasChildren: false, parentId: corrupt, depth: 2,
      },
    ])
  })

  it('verifies a cold candidate still belongs to its enumerated lifecycle', async () => {
    const { ctx, parent } = await setup([])
    /** 中文说明：变量 childId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const childId = await authorChild(ctx, '00000000-0000-4000-8000-00000000ddd1', {
      parentSession: parent.id,
      createdAt: 1,
      origin: 'subagent',
    }, childEvents(descriptorPayload('lineage checked')))
    /** 中文说明：变量 realInspect 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const realInspect = ctx.sessionPersistence.inspect.bind(ctx.sessionPersistence)
    ctx.sessionPersistence.inspect = async (sessionId, signal) => {
      /** 中文说明：变量 inspected 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const inspected = await realInspect(sessionId, signal)
      // The exact read reports a different durable parent than enumeration did.
      return { ...inspected, meta: { ...inspected.meta, parentSession: SessionId('someone-else') } }
    }
    await expect(ctx.subagents.listDescendants(parent.id)).resolves.toEqual([
      { kind: 'diagnostic', id: childId, reason: 'corrupt', parentId: parent.id, depth: 1 },
    ])
  })

  it('a pre-aborted signal stops the descendant scan before persistence reads', async () => {
    const { ctx, parent } = await setup([textResponse('done')])
    await startChild(ctx, parent, 'never read')
    /** 中文说明：变量 list 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const list = vi.spyOn(ctx.sessionPersistence, 'list')
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    controller.abort()
    await expect(ctx.subagents.listDescendants(parent.id, controller.signal)).rejects.toThrow(
      expect.objectContaining({ code: 'CANCELLED' }) as Error,
    )
    expect(list).not.toHaveBeenCalled()
  })

  it('fails loud when the projection registry is not mounted', async () => {
    const { ctx, parent } = await setup([], { sessionProjections: false })
    await expect(ctx.subagents.listDescendants(parent.id)).rejects.toThrow(
      expect.objectContaining({ code: 'SUBAGENT_CONTROL_PROJECTIONS_UNAVAILABLE' }) as Error,
    )
  })
})
