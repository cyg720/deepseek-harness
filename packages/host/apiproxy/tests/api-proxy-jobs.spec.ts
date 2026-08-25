/**
 * Background-task carrier paths of the host ApiProxy: the subscription
 * baseline is sent only for a session that has tasks, every registry change
 * pushes that owner's whole set, an unowned change fans out to every
 * subscribed session, the projection drops the three internal snapshot
 * fields, a composition without `ctx.jobs` emits nothing, and listing never
 * resumes a cold session.
 */
/*
 * 文件职责：验证Host API Proxy的 api-proxy-jobs.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis、Fetch/RPC 信封、运行时模式校验、Node/Windows 宿主接口。
 * 产品维度：保证浏览器 API、Hook 或目录操作在各种状态下可靠且可诊断。
 * 逻辑维度：构造请求与宿主服务，调用端点并断言响应和清理。
 * 关键边界：网络与路径输入必须校验；原生对话框和宿主路径操作只允许受信调用。
 * 新手阅读建议：先读请求/响应夹具，再按 API 域、错误码和生命周期场景阅读。
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import type { JobOutcome } from '@deepseek-ai/dsh-jobs'
import type { MuxFrame, RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { createApiProxy } from '@deepseek-ai/dsh-host-apiproxy'

/** 中文说明：类型或类 JobFrame 约束 API、Hook 或目录数据职责。 */
type JobFrame = Extract<MuxFrame, { type: 'session/jobs' }>

/**
 * A producer whose settlement the test drives. `cancel` deliberately does not
 * settle, so a kill is observable as the distinct `stopping` step before the
 * test supplies the terminal outcome and its detail.
 */
/* 中文说明：函数 producer 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function producer(label = 'sleep 60') {
  /** 中文说明：测试局部值 settle，由紧邻初始化决定。 */
  let settle!: (outcome: JobOutcome) => void
  // A stream producer, so the carrier CAN consume the cursor if it ever calls
  // `read()`; `reads` is what proves it never does.
  /** 中文说明：测试局部值 reads，由紧邻初始化决定。 */
  const reads = { count: 0 }
  /** 中文说明：测试局部值 spec，由紧邻初始化决定。 */
  const spec = {
    kind: 'bash' as const,
    label,
    run: () => ({
      cancel: () => {},
      done: new Promise<JobOutcome>((resolve) => { settle = resolve }),
      readOutput: () => { reads.count += 1; return 'stolen output' },
    }),
  }
  return { spec, reads, settle: (outcome: JobOutcome) => { settle(outcome) } }
}

/** 中文说明：函数 harness 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function harness(withRegistry: boolean): Promise<{ ctx: Context; session: Session; agent: Agent }> {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(AgentRegistry)
  if (withRegistry) {
    await ctx.plugin(LocalJobRegistry)
    ctx.jobs.attachController('api-proxy-test')
  }
  /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
  const session = ctx.sessions.create()
  /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
  const agent = {
    id: session.id,
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle',
    ctx,
  } as Agent
  ctx.agents.register(agent)
  return { ctx, session, agent }
}

/** 中文说明：测试局部值 api，由紧邻初始化决定。 */
const api = (ctx: Context) => createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })

/** Drain the mux until `count` session/jobs frames arrived, then abort. */
/* 中文说明：函数 collect 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function collect(
  iterable: AsyncIterable<RpcRequest<MuxFrame>>,
  count: number,
  abort: AbortController,
): Promise<JobFrame[]> {
  /** 中文说明：测试局部值 frames，由紧邻初始化决定。 */
  const frames: MuxFrame[] = []
  /** 中文说明：测试局部值 envelope，由紧邻初始化决定。 */
  for await (const envelope of iterable) {
    frames.push(envelope.payload)
    if (frames.filter(frame => frame.type === 'session/jobs').length >= count) abort.abort()
  }
  return frames.filter((frame): frame is JobFrame => frame.type === 'session/jobs')
}

describe('session/jobs subscription baseline', () => {
  it('is omitted for a session with no tasks — absence is the empty set', async () => {
    /** 中文说明：测试局部值 { ctx, session }，由紧邻初始化决定。 */
    const { ctx, session } = await harness(true)
    /** 中文说明：测试局部值 abort，由紧邻初始化决定。 */
    const abort = new AbortController()
    /** 中文说明：测试局部值 stream，由紧邻初始化决定。 */
    const stream = api(ctx).events.mux({ rpcId: RpcId('t-tasks-empty'), payload: {} }, abort.signal)
    /** 中文说明：测试局部值 frames，由紧邻初始化决定。 */
    const frames: MuxFrame[] = []
    /** 中文说明：测试局部值 drained，由紧邻初始化决定。 */
    const drained = (async () => {
      /** 中文说明：测试局部值 envelope，由紧邻初始化决定。 */
      for await (const envelope of stream) {
        frames.push(envelope.payload)
        if (frames.some(frame => frame.type === 'session/subscribed')) abort.abort()
      }
    })()
    await drained
    expect(frames.some(frame => frame.type === 'session/jobs')).toBe(false)
    expect(frames.some(frame => frame.type === 'session/subscribed')).toBe(true)
    void session
  })

  it('carries the live set for a session that already has tasks when the stream opens', async () => {
    /** 中文说明：测试局部值 { ctx, session, agent }，由紧邻初始化决定。 */
    const { ctx, session, agent } = await harness(true)
    ctx.jobs.start({ ...producer('pnpm run build').spec, owner: agent })
    /** 中文说明：测试局部值 abort，由紧邻初始化决定。 */
    const abort = new AbortController()
    /** 中文说明：测试局部值 stream，由紧邻初始化决定。 */
    const stream = api(ctx).events.mux({ rpcId: RpcId('t-tasks-baseline'), payload: {} }, abort.signal)
    /** 中文说明：测试局部值 [baseline]，由紧邻初始化决定。 */
    const [baseline] = await collect(stream, 1, abort)
    expect(baseline?.sessionId).toBe(session.id)
    expect(baseline?.jobs).toHaveLength(1)
    /** 中文说明：测试局部值 [job]，由紧邻初始化决定。 */
    const [job] = baseline?.jobs ?? []
    expect(job?.startedAt).toBeTypeOf('number')
    expect({ ...job, startedAt: 0 }).toEqual({
      id: 'bash-1',
      kind: 'bash',
      label: 'pnpm run build',
      status: 'running',
      startedAt: 0,
    })
  })
})

describe('session/jobs change pushes', () => {
  it('pushes the owner\'s whole set on registration, stopping, and settlement', async () => {
    /** 中文说明：测试局部值 { ctx, session, agent }，由紧邻初始化决定。 */
    const { ctx, session, agent } = await harness(true)
    /** 中文说明：测试局部值 proxy，由紧邻初始化决定。 */
    const proxy = api(ctx)
    /** 中文说明：测试局部值 abort，由紧邻初始化决定。 */
    const abort = new AbortController()
    /** 中文说明：测试局部值 stream，由紧邻初始化决定。 */
    const stream = proxy.events.mux({ rpcId: RpcId('t-tasks-changes'), payload: {} }, abort.signal)
    /** 中文说明：测试局部值 collected，由紧邻初始化决定。 */
    const collected = collect(stream, 3, abort)

    /** 中文说明：测试局部值 p，由紧邻初始化决定。 */
    const p = producer()
    /** 中文说明：测试局部值 id，由紧邻初始化决定。 */
    const id = ctx.jobs.start({ ...p.spec, owner: agent })
    ctx.jobs.kill(id, agent, 'test')
    p.settle({ status: 'killed', detail: 'signal: SIGTERM' })

    /** 中文说明：测试局部值 frames，由紧邻初始化决定。 */
    const frames = await collected
    expect(frames.map(frame => frame.sessionId)).toEqual([session.id, session.id, session.id])
    expect(frames.map(frame => frame.jobs[0]?.status)).toEqual(['running', 'stopping', 'killed'])
    // Terminal detail rides the same whole-set push; no separate signal.
    expect(frames[2]?.jobs[0]?.detail).toBe('signal: SIGTERM')
    expect(frames[2]?.jobs[0]?.finishedAt).toBeTypeOf('number')
  })

  it('drops ownerSession, reported, and outputLimitBytes from the wire view', async () => {
    /** 中文说明：测试局部值 { ctx, agent }，由紧邻初始化决定。 */
    const { ctx, agent } = await harness(true)
    /** 中文说明：测试局部值 proxy，由紧邻初始化决定。 */
    const proxy = api(ctx)
    /** 中文说明：测试局部值 abort，由紧邻初始化决定。 */
    const abort = new AbortController()
    /** 中文说明：测试局部值 stream，由紧邻初始化决定。 */
    const stream = proxy.events.mux({ rpcId: RpcId('t-tasks-fields'), payload: {} }, abort.signal)
    /** 中文说明：测试局部值 collected，由紧邻初始化决定。 */
    const collected = collect(stream, 1, abort)
    ctx.jobs.start({ ...producer().spec, owner: agent, outputLimitBytes: 1_024 })

    /** 中文说明：测试局部值 [frame]，由紧邻初始化决定。 */
    const [frame] = await collected
    /** 中文说明：测试局部值 fields，由紧邻初始化决定。 */
    const fields: readonly string[] = Object.keys(frame?.jobs[0] ?? {})
    expect([...fields].sort()).toEqual(['id', 'kind', 'label', 'startedAt', 'status'])
  })

  it('fans an unowned change out to every subscribed session', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await harness(true)
    /** 中文说明：测试局部值 second，由紧邻初始化决定。 */
    const second = ctx.sessions.create()
    /** 中文说明：测试局部值 proxy，由紧邻初始化决定。 */
    const proxy = api(ctx)
    /** 中文说明：测试局部值 abort，由紧邻初始化决定。 */
    const abort = new AbortController()
    /** 中文说明：测试局部值 stream，由紧邻初始化决定。 */
    const stream = proxy.events.mux({ rpcId: RpcId('t-tasks-unowned'), payload: {} }, abort.signal)
    /** 中文说明：测试局部值 collected，由紧邻初始化决定。 */
    const collected = collect(stream, 2, abort)

    ctx.jobs.start(producer('open to every caller').spec)

    /** 中文说明：测试局部值 frames，由紧邻初始化决定。 */
    const frames = await collected
    expect(new Set(frames.map(frame => frame.sessionId)).size).toBe(2)
    expect(frames.some(frame => frame.sessionId === second.id)).toBe(true)
    /** 中文说明：测试局部值 frame，由紧邻初始化决定。 */
    for (const frame of frames) expect(frame.jobs[0]?.label).toBe('open to every caller')
  })

  it('serves a cold session the unowned set without resuming it', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await harness(true)
    /** 中文说明：测试局部值 coldId，由紧邻初始化决定。 */
    const coldId = SessionId('session-cold-tasks')
    /** 中文说明：测试局部值 loaded，由紧邻初始化决定。 */
    let loaded = false
    ctx.provide('sessionPersistence', {
      list: async () => [{ version: 0, id: coldId, createdAt: 5, cwd: '/tmp' }],
      locate: () => undefined,
      load: () => { loaded = true; throw new Error('task listing must not load a cold log') },
    } as never)
    /** 中文说明：测试局部值 proxy，由紧邻初始化决定。 */
    const proxy = api(ctx)
    /** 中文说明：测试局部值 abort，由紧邻初始化决定。 */
    const abort = new AbortController()
    /** 中文说明：测试局部值 stream，由紧邻初始化决定。 */
    const stream = proxy.events.mux({ rpcId: RpcId('t-tasks-cold'), payload: {} }, abort.signal)
    /** 中文说明：测试局部值 collected，由紧邻初始化决定。 */
    const collected = collect(stream, 1, abort)

    ctx.jobs.start(producer().spec)
    await collected
    expect(loaded).toBe(false)
    expect(ctx.agents.get(coldId)).toBeUndefined()
  })
})

describe('session/jobs without the registry', () => {
  it('emits no frames at all, so the client renders no entry point', async () => {
    /** 中文说明：测试局部值 { ctx, session }，由紧邻初始化决定。 */
    const { ctx, session } = await harness(false)
    /** 中文说明：测试局部值 proxy，由紧邻初始化决定。 */
    const proxy = api(ctx)
    /** 中文说明：测试局部值 abort，由紧邻初始化决定。 */
    const abort = new AbortController()
    /** 中文说明：测试局部值 stream，由紧邻初始化决定。 */
    const stream = proxy.events.mux({ rpcId: RpcId('t-tasks-absent'), payload: {} }, abort.signal)
    /** 中文说明：测试局部值 frames，由紧邻初始化决定。 */
    const frames: MuxFrame[] = []
    /** 中文说明：测试局部值 drained，由紧邻初始化决定。 */
    const drained = (async () => {
      /** 中文说明：测试局部值 envelope，由紧邻初始化决定。 */
      for await (const envelope of stream) {
        frames.push(envelope.payload)
        if (frames.filter(frame => frame.type === 'session/event').length >= 1) abort.abort()
      }
    })()
    session.append('turn/start', { turn: 1 })
    await drained
    expect(frames.some(frame => frame.type === 'session/jobs')).toBe(false)
  })
})

describe('session/jobs never consumes model output', () => {
  it('drives the whole lifecycle without calling the single consuming cursor', async () => {
    // `ctx.jobs.read()` consumes the one output cursor, so a carrier read
    // silently takes bytes the model's `job_output` will never see. The
    // failure is invisible at the call site, which is why this asserts the
    // count rather than trusting review.
    /** 中文说明：测试局部值 { ctx, agent }，由紧邻初始化决定。 */
    const { ctx, agent } = await harness(true)
    /** 中文说明：测试局部值 proxy，由紧邻初始化决定。 */
    const proxy = api(ctx)
    /** 中文说明：测试局部值 abort，由紧邻初始化决定。 */
    const abort = new AbortController()
    /** 中文说明：测试局部值 stream，由紧邻初始化决定。 */
    const stream = proxy.events.mux({ rpcId: RpcId('t-tasks-no-read'), payload: {} }, abort.signal)
    /** 中文说明：测试局部值 collected，由紧邻初始化决定。 */
    const collected = collect(stream, 3, abort)

    /** 中文说明：测试局部值 p，由紧邻初始化决定。 */
    const p = producer()
    /** 中文说明：测试局部值 id，由紧邻初始化决定。 */
    const id = ctx.jobs.start({ ...p.spec, owner: agent })
    ctx.jobs.kill(id, agent, 'test')
    p.settle({ status: 'killed', detail: 'signal: SIGTERM' })
    await collected

    expect(p.reads.count).toBe(0)
  })

  it('reads nothing while minting the subscription baseline either', async () => {
    /** 中文说明：测试局部值 { ctx, agent }，由紧邻初始化决定。 */
    const { ctx, agent } = await harness(true)
    /** 中文说明：测试局部值 p，由紧邻初始化决定。 */
    const p = producer()
    ctx.jobs.start({ ...p.spec, owner: agent })

    /** 中文说明：测试局部值 abort，由紧邻初始化决定。 */
    const abort = new AbortController()
    /** 中文说明：测试局部值 stream，由紧邻初始化决定。 */
    const stream = api(ctx).events.mux({ rpcId: RpcId('t-tasks-no-read-baseline'), payload: {} }, abort.signal)
    /** 中文说明：测试局部值 [baseline]，由紧邻初始化决定。 */
    const [baseline] = await collect(stream, 1, abort)

    expect(baseline?.jobs).toHaveLength(1)
    expect(p.reads.count).toBe(0)
  })
})

describe('session/jobs baseline for a session born after the stream opened', () => {
  it('carries the already-visible unowned set to the new session', async () => {
    /** 中文说明：测试局部值 { ctx }，由紧邻初始化决定。 */
    const { ctx } = await harness(true)
    /** 中文说明：测试局部值 proxy，由紧邻初始化决定。 */
    const proxy = api(ctx)
    /** 中文说明：测试局部值 abort，由紧邻初始化决定。 */
    const abort = new AbortController()
    /** 中文说明：测试局部值 stream，由紧邻初始化决定。 */
    const stream = proxy.events.mux({ rpcId: RpcId('t-tasks-late-session'), payload: {} }, abort.signal)

    // One unowned task exists before the new session is created; the subscribe
    // frame clears the client mirror, so the baseline has to follow it.
    ctx.jobs.start(producer('visible to every caller').spec)
    /** 中文说明：测试局部值 created，由紧邻初始化决定。 */
    const created = ctx.sessions.create()

    /** 中文说明：测试局部值 frames，由紧邻初始化决定。 */
    const frames = await collect(stream, 2, abort)
    /** 中文说明：测试局部值 forNew，由紧邻初始化决定。 */
    const forNew = frames.filter(frame => frame.sessionId === created.id)
    expect(forNew.at(-1)?.jobs[0]?.label).toBe('visible to every caller')
  })
})
