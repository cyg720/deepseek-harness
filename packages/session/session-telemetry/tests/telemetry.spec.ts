/**
 * 文件职责：验证 telemetry.spec.ts 覆盖的会话遥测行为、持久化与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、事件日志、SQLite 或 OpenTelemetry。
 * 产品维度：保障 Agent 的会话遥测状态稳定、可重放且可诊断。
 * 逻辑维度：准备或解析会话数据，执行核心流程，再处理结果、错误与资源清理。
 * 关键边界：持久化和遥测输入不可信；敏感数据必须脱敏；事件与数据库资源必须正确收尾。
 * 新手阅读建议：先看数据类型和辅助函数，再读写入/投影主流程，最后关注恢复、脱敏和失败场景。
 */
import { createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
/**
 * Coordinator semantics against a bare fake backend — the RFC's named unit
 * tier for the seam: adoption (fresh, seeded, re-adoption via the handoff
 * cursor), the fixed chunk projection, deep-copy isolation, turn-latency and
 * dispose-ordering pins, failure containment, and the `agent/error` relay.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  SessionTelemetryCoordinator,
  /** 中文说明：type SessionTelemetrySink 定义本测试所需的数据或行为，用于表达会话遥测场景。 */
  type SessionTelemetrySink,
  /** 中文说明：type SessionTelemetryCapture 定义本测试所需的数据或行为，用于表达会话遥测场景。 */
  type SessionTelemetryCapture,
  /** 中文说明：type SessionTelemetryRecord 定义本测试所需的数据或行为，用于表达会话遥测场景。 */
  type SessionTelemetryRecord,
} from '../src/index.ts'

declare module '@deepseek-ai/dsh-session/types' {
  /** 中文说明：interface SessionEventMap 定义本测试所需的数据或行为，用于表达会话遥测场景。 */
  interface SessionEventMap {
    /**
     * Test-only merged event proving unknown types flow through unchanged.
     * @mode emit
     * @param payload - opaque test payload
     */
    'telemetry-test/opaque': { payload: { nested: string[] } }
  }
}

/** 中文说明：class FakeBackend 定义本测试所需的数据或行为，用于表达会话遥测场景。 */
class FakeBackend implements SessionTelemetrySink {
  records: SessionTelemetryRecord[] = []
  calls: string[] = []
  emitError: Error | undefined
  rejectSeq: number | undefined
  shutdownError: Error | undefined
  shutdownResolved = false

  emit(record: SessionTelemetryRecord): void {
    if (this.emitError) throw this.emitError
    if (this.rejectSeq !== undefined && record.attributes['event.seq'] === this.rejectSeq) {
      throw new Error(`backend rejected seq ${this.rejectSeq}`)
    }
    this.records.push(record)
    this.calls.push(`emit:${String(record.attributes['event.seq'] ?? record.attributes['telemetry.op'])}`)
  }

  flush = vi.fn()

  async shutdown(): Promise<void> {
    this.calls.push('shutdown')
    await new Promise(resolve => setTimeout(resolve, 5))
    if (this.shutdownError) throw this.shutdownError
    this.shutdownResolved = true
  }

  ledger(): SessionTelemetryRecord[] {
    return this.records.filter(r => r.channel === 'ledger')
  }
}

/** 中文说明：函数 setup 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function setup(
  backend: FakeBackend = new FakeBackend(),
  capture: SessionTelemetryCapture = 'live',
) {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  /** 中文说明：变量 coordinator 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let coordinator!: SessionTelemetryCoordinator
  /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const fiber = await ctx.plugin({
    name: 'fake-telemetry',
    inject: ['sessions'],
    apply: (inner: Context) => {
      coordinator = new SessionTelemetryCoordinator(inner, backend, capture)
    },
  })
  return { ctx, backend, coordinator, fiber }
}

/** 中文说明：函数 liveSession 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function liveSession(ctx: Context, id = `s-${Math.random().toString(36).slice(2)}`): Session {
  return ctx.sessions.create(SessionId(id), { meta: {} })
}

/** 中文说明：函数 appendTurn 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function appendTurn(session: Session): void {
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
}

describe('SessionTelemetryCoordinator capture', () => {
  it('hands every appended event over with envelope identity and cloned body', async () => {
    const { ctx, backend } = await setup()
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = liveSession(ctx, 'cap')
    appendTurn(session)

    /** 中文说明：变量 start 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const start = backend.ledger()[0]!
    /** 中文说明：变量 message 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const message = backend.ledger()[1]!
    expect(start.attributes).toMatchObject({ 'session.id': 'cap', 'event.type': 'turn/start', 'event.seq': 0 })
    expect(start.time).toBe(session.events[0]!.time)
    expect(start.severity).toBe('info')
    expect(message.attributes['event.seq']).toBe(1)
    // Deep-copy isolation: mutating the handed-off body never reaches the log.
    ;(message.body as { content: { text: string }[] }).content[0]!.text = 'tampered'
    /** 中文说明：变量 logged 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const logged = session.events[1] as SessionEvent<'user/message'>
    expect(logged.data.content[0]).toMatchObject({ text: 'hello' })
  })

  it('stamps header facts on every record when present', async () => {
    const { ctx, backend } = await setup()
    /** 中文说明：变量 parent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const parent = SessionId('parent')
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = ctx.sessions.create(SessionId('child'), { meta: { cwd: '/tmp/proj', parentSession: parent } })
    appendTurn(session)
    /** 中文说明：该循环依次处理会话数据；循环变量仅在当前循环中有效。 */
    for (const record of backend.ledger()) {
      expect(record.attributes['session.cwd']).toBe('/tmp/proj')
      expect(record.attributes['session.parent_id']).toBe('parent')
    }
  })

  it('maps outcome flags to severity, unknown types falling through as info', async () => {
    const { ctx, backend } = await setup()
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = liveSession(ctx)
    session.append('turn/start', { turn: 1 })
    session.append('tool/result', {
      turn: 1, step: 1,
      message: createToolResultMessage({
        callId: 'c1' as never,
        content: [],
        isError: true,
      }),
    }, { surfaceOp: 'append' })
    session.append('tool/result', {
      turn: 1, step: 1,
      message: createToolResultMessage({
        callId: 'c2' as never,
        content: [],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
    session.append('telemetry-test/opaque', { payload: { nested: [] } })
    session.append('turn/end', { turn: 1, reason: { kind: 'error', error: { message: 'boom', code: 'UNKNOWN' } } })
    /** 中文说明：函数值 severities 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const severities = backend.ledger().map(r => [r.attributes['event.type'], r.severity])
    expect(severities).toEqual([
      ['turn/start', 'info'],
      ['tool/result', 'error'],
      ['tool/result', 'info'],
      ['telemetry-test/opaque', 'info'],
      ['turn/end', 'error'],
    ])
  })

  it('passes unknown merged event types through unchanged', async () => {
    const { ctx, backend } = await setup()
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = liveSession(ctx)
    session.append('telemetry-test/opaque', { payload: { nested: ['a', 'b'] } })
    /** 中文说明：变量 record 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const record = backend.ledger()[0]!
    expect(record.attributes['event.type']).toBe('telemetry-test/opaque')
    expect(record.severity).toBe('info')
    expect(record.body).toEqual({ payload: { nested: ['a', 'b'] } })
  })

  it('ships only the first chunk of each (turn, step), per session', async () => {
    const { ctx, backend } = await setup()
    /** 中文说明：变量 a 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const a = liveSession(ctx, 'a')
    /** 中文说明：变量 b 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const b = liveSession(ctx, 'b')
    /** 中文说明：函数值 chunk 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const chunk = (s: Session, turn: number, step: number, text: string) =>
      s.append('assistant/chunk', { turn, step, chunk: { type: 'text-delta', index: 0, text } })
    chunk(a, 1, 1, 'a11-first')
    chunk(a, 1, 1, 'a11-second')
    chunk(a, 1, 2, 'a12-first')
    chunk(b, 1, 1, 'b11-first')
    chunk(b, 1, 1, 'b11-second')
    /** 中文说明：函数值 shipped 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const shipped = backend.ledger().map(r => [r.attributes['session.id'], (r.body as { chunk: { text: string } }).chunk.text])
    expect(shipped).toEqual([
      ['a', 'a11-first'],
      ['a', 'a12-first'],
      ['b', 'b11-first'],
    ])
  })
})

describe('SessionTelemetryCoordinator on-demand capture', () => {
  it('captures one canonical-log prefix at a time without following later events', async () => {
    const { ctx, backend, coordinator } = await setup(new FakeBackend(), 'on-demand')
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = liveSession(ctx, 'on-demand-prefix')
    appendTurn(session)
    /** 中文说明：变量 firstBoundary 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const firstBoundary = session.events[1]!.seq
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(backend.records).toEqual([])

    coordinator.captureSession(session, firstBoundary)
    expect(backend.ledger().map(record => record.attributes['event.type'])).toEqual([
      'turn/start',
      'user/message',
    ])

    expect(backend.ledger()).toHaveLength(2)
    coordinator.captureSession(session)
    coordinator.captureSession(session)
    expect(backend.ledger().map(record => record.attributes['event.type'])).toEqual([
      'turn/start',
      'user/message',
      'turn/end',
    ])
  })

  it('runs the currently mounted redaction policy during canonical-log capture', async () => {
    const { ctx, backend, coordinator } = await setup(new FakeBackend(), 'on-demand')
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = liveSession(ctx, 'on-demand-redacted')
    session.append('turn/start', { turn: 1 })
    /** 中文说明：函数值 disposeRule 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const disposeRule = ctx.on('session-telemetry/record', (_record, next) => ({
      ...next(),
      body: { scrubbed: true },
    }))

    coordinator.captureSession(session)
    expect(backend.ledger()[0]!.body).toEqual({ scrubbed: true })
    disposeRule()

    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    coordinator.captureSession(session)
    expect(backend.ledger()[1]!.body).toEqual({ turn: 1, reason: { kind: 'completed' } })
  })

  it('contains each backend failure independently while replaying a prefix', async () => {
    /** 中文说明：变量 backend 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const backend = new FakeBackend()
    backend.rejectSeq = 1
    const { ctx, coordinator } = await setup(backend, 'on-demand')
    /** 中文说明：函数值 warn 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = liveSession(ctx, 'on-demand-failure')
    appendTurn(session)
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    coordinator.captureSession(session)
    expect(backend.ledger().map(record => record.attributes['event.seq'])).toEqual([0, 2])
    expect(warn).toHaveBeenCalled()
  })

  it('captures a pending prefix after coordinator reload without retained records', async () => {
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = new FakeBackend()
    const { ctx, fiber } = await setup(first, 'on-demand')
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = liveSession(ctx, 'on-demand-reload')
    session.append('turn/start', { turn: 1 })
    await fiber.dispose()
    expect(first.records).toEqual([])

    /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const second = new FakeBackend()
    /** 中文说明：变量 coordinator 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let coordinator!: SessionTelemetryCoordinator
    await ctx.plugin({
      name: 'fake-telemetry-after-on-demand-reload',
      inject: ['sessions'],
      apply: (inner: Context) => {
        coordinator = new SessionTelemetryCoordinator(inner, second, 'on-demand')
      },
    })
    coordinator.captureSession(session)
    expect(second.ledger().map(record => record.attributes['event.seq'])).toEqual([0])
  })

  it('registers no continuous capture, flush, or ops listeners', async () => {
    const { ctx, backend, coordinator, fiber } = await setup(new FakeBackend(), 'on-demand')
    /** 中文说明：函数值 redact 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const redact = vi.fn((_record: SessionTelemetryRecord, next: () => SessionTelemetryRecord) => next())
    ctx.on('session-telemetry/record', redact)
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = liveSession(ctx, 'on-demand-ledger-only')
    session.append('turn/start', { turn: 1 })
    await ctx.parallel('session/flush', session)
    /** 中文说明：变量 agent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const agent = { id: 'agent-1', session } as Agent
    ctx.emit('agent/error', { agent, turn: 1, step: 1, error: new Error('local only') })
    expect(backend.flush).not.toHaveBeenCalled()
    expect(backend.records).toEqual([])
    expect(redact).not.toHaveBeenCalled()

    coordinator.captureSession(session)
    expect(redact).toHaveBeenCalledTimes(1)
    await fiber.dispose()
    expect(backend.records.map(record => record.channel)).toEqual(['ledger'])
  })
})

describe('SessionTelemetryCoordinator adoption', () => {
  it('exports an unpublished suffix without re-exporting constructor history', async () => {
    /** 中文说明：变量 backend 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const backend = new FakeBackend()
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    /** 中文说明：变量 parent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const parent = liveSession(ctx, 'seed-parent')
    appendTurn(parent)
    await ctx.plugin({
      name: 'fake-telemetry',
      inject: ['sessions'],
      apply: (inner: Context) => void new SessionTelemetryCoordinator(inner, backend),
    })
    /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const child = ctx.sessions.prepare(SessionId('seeded'), { seed: [...parent.events], meta: {} })
    child.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    ctx.sessions.enter(child)
    ctx.sessions.announce(child)

    /** 中文说明：函数值 seqs 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const seqs = backend.ledger().map(r => [r.attributes['session.id'], r.attributes['event.seq']])
    expect(seqs).toEqual(expect.arrayContaining([['seed-parent', 0], ['seed-parent', 1]]))
    // 2 end-seed, 3 turn/end: both this lifecycle's own writes, while
    // inherited 0-1 stay with the parent stream.
    expect(seqs.filter(([id]) => id === 'seeded')).toEqual([['seeded', 2], ['seeded', 3]])
  })

  it('resume shape: a full-log seed exports only its own end-seed and rebuilds the chunk projection', async () => {
    /** 中文说明：变量 backend 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const backend = new FakeBackend()
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    /** 中文说明：变量 donor 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const donor = ctx.sessions.create(SessionId('donor'), { meta: {} })
    donor.append('turn/start', { turn: 1 })
    donor.append('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'first' } })
    /** 中文说明：变量 resumed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const resumed = ctx.sessions.create(SessionId('resumed'), { seed: [...donor.events], meta: {} })
    await ctx.plugin({
      name: 'fake-telemetry',
      inject: ['sessions'],
      apply: (inner: Context) => void new SessionTelemetryCoordinator(inner, backend),
    })
    /** 中文说明：函数值 ofResumed 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const ofResumed = () => backend.ledger()
      .filter(r => r.attributes['session.id'] === 'resumed')
      .map(r => r.attributes['event.seq'])
    // Nothing inherited is re-exported; seq 2 is this session's own first
    // write — the end-seed event its constructor appended after the seed.
    expect(ofResumed()).toEqual([2])
    // The seed fed the projection: the (turn 1, step 1) first chunk already
    // shipped from the original process, so its continuation is re-dropped…
    resumed.append('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'continuation' } })
    expect(ofResumed()).toEqual([2])
    // …while a new step's first chunk exports normally.
    resumed.append('assistant/chunk', { turn: 1, step: 2, chunk: { type: 'text-delta', index: 0, text: 'next step' } })
    expect(ofResumed()).toEqual([2, 4])
  })

  it('stamps session.seed_length from the header so receivers can stitch fork streams', async () => {
    /** 中文说明：变量 backend 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const backend = new FakeBackend()
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    /** 中文说明：变量 parent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const parent = liveSession(ctx, 'stitch-parent')
    appendTurn(parent)
    /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const child = ctx.sessions.create(SessionId('stitch-child'), {
      seed: [...parent.events],
      meta: { parentSession: SessionId('stitch-parent'), seedLength: 2 },
    })
    await ctx.plugin({
      name: 'fake-telemetry',
      inject: ['sessions'],
      apply: (inner: Context) => void new SessionTelemetryCoordinator(inner, backend),
    })
    child.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    /** 中文说明：函数值 record 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const record = backend.ledger().find(r => r.attributes['session.id'] === 'stitch-child')!
    expect(record.attributes['session.parent_id']).toBe('stitch-parent')
    expect(record.attributes['session.seed_length']).toBe(2)
  })

  it('adopts exactly once when created fires after the sweep', async () => {
    /** 中文说明：变量 backend 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const backend = new FakeBackend()
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    // The enter/announce window: prepare+enter puts the session in the store
    // (visible to the constructor sweep) before `session/created` fires, so a
    // coordinator loaded inside that window sees the session twice — sweep
    // first, created second. The second adoption must be a no-op.
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = ctx.sessions.prepare(SessionId('overlap'))
    appendTurn(session)
    ctx.sessions.enter(session)
    await ctx.plugin({
      name: 'fake-telemetry',
      inject: ['sessions'],
      apply: (inner: Context) => void new SessionTelemetryCoordinator(inner, backend),
    })
    expect(backend.ledger()).toHaveLength(2)
    ctx.sessions.announce(session)
    expect(backend.ledger()).toHaveLength(2)
  })

  it('resumes from the handoff cursor across a reload, re-dropping mid-step chunks', async () => {
    /** 中文说明：变量 backend 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const backend = new FakeBackend()
    const { ctx, fiber } = await setup(backend)
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = liveSession(ctx, 'hmr')
    session.append('turn/start', { turn: 1 })
    session.append('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'first' } })
    expect(backend.ledger()).toHaveLength(2)

    await fiber.dispose()
    // The reload window: appends while no telemetry listener is registered.
    session.append('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'mid-step continuation' } })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const second = new FakeBackend()
    await ctx.plugin({
      name: 'fake-telemetry-2',
      inject: ['sessions'],
      apply: (inner: Context) => void new SessionTelemetryCoordinator(inner, second),
    })
    // Only the window events past the cursor are re-handed, and the mid-step
    // continuation is re-dropped because ≤cursor events rebuilt the projection.
    expect(second.ledger().map(r => r.attributes['event.type'])).toEqual(['turn/end'])
  })

  it('replays past a record the backend rejects: one event withheld, the rest adopted', async () => {
    /** 中文说明：变量 backend 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const backend = new FakeBackend()
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    /** 中文说明：函数值 warn 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = liveSession(ctx, 'partial')
    appendTurn(session)
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    // The backend rejects exactly the middle historical event: fail-closed
    // must withhold THAT record only — an adoption replay that dies on the
    // first contained failure would silently skip the rest of the log while
    // the session stays marked adopted.
    backend.rejectSeq = 1
    await ctx.plugin({
      name: 'fake-telemetry',
      inject: ['sessions'],
      apply: (inner: Context) => void new SessionTelemetryCoordinator(inner, backend),
    })
    expect(backend.ledger().map(r => r.attributes['event.seq'])).toEqual([0, 2])
    expect(warn).toHaveBeenCalled()
  })

  it('re-hands the full log when no cursor survived (fresh session object)', async () => {
    /** 中文说明：变量 backend 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const backend = new FakeBackend()
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = liveSession(ctx, 'fresh')
    appendTurn(session)
    await ctx.plugin({
      name: 'fake-telemetry',
      inject: ['sessions'],
      apply: (inner: Context) => void new SessionTelemetryCoordinator(inner, backend),
    })
    expect(backend.ledger().map(r => r.attributes['event.seq'])).toEqual([0, 1])
  })
})

describe('SessionTelemetryCoordinator lifecycle and containment', () => {
  it('forwards session/flush as a hint without awaiting backend work', async () => {
    const { ctx, backend } = await setup()
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = liveSession(ctx)
    /** 中文说明：变量 settled 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let settled = false
    backend.flush.mockImplementation(() => {
      // The backend may kick off arbitrary async work; the loop's parallel must not wait for it.
      void new Promise(resolve => setTimeout(resolve, 50)).then(() => { settled = true })
    })
    await ctx.parallel('session/flush', session)
    expect(backend.flush).toHaveBeenCalledTimes(1)
    expect(settled).toBe(false)
  })

  it('ignores flush hints for sessions it never adopted', async () => {
    const { ctx, backend } = await setup()
    /** 中文说明：变量 stranger 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const stranger = ctx.sessions.prepare(SessionId('stranger'), { meta: {} })
    await ctx.parallel('session/flush', stranger)
    expect(backend.flush).not.toHaveBeenCalled()
  })

  it('emits no marker for a session whose announcement was vetoed before adoption', async () => {
    /** 中文说明：变量 backend 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const backend = new FakeBackend()
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    // A listener registered BEFORE the coordinator vetoes publication: the
    // store still emits the paired `session/disposed` for rollback, but the
    // coordinator never saw `session/created` — a marker for a session the
    // receiver saw no activity from would be noise, not signal.
    ctx.on('session/created', () => {
      throw new Error('vetoed by an earlier listener')
    })
    await ctx.plugin({
      name: 'fake-telemetry',
      inject: ['sessions'],
      apply: (inner: Context) => void new SessionTelemetryCoordinator(inner, backend),
    })
    expect(() => ctx.sessions.create(SessionId('vetoed'), { meta: {} })).toThrow('vetoed')
    expect(backend.records.filter(r => r.channel === 'ops')).toHaveLength(0)
  })

  it('emits each adopted session’s shutdown record before awaiting backend shutdown', async () => {
    const { ctx, backend, fiber } = await setup()
    liveSession(ctx, 's1')
    liveSession(ctx, 's2')
    await fiber.dispose()
    expect(backend.calls).toEqual(['emit:shutdown', 'emit:shutdown', 'shutdown'])
    expect(backend.shutdownResolved).toBe(true)
    /** 中文说明：函数值 ops 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const ops = backend.records.filter(r => r.channel === 'ops')
    expect(ops.map(r => r.attributes['session.id']).sort()).toEqual(['s1', 's2'])
    expect(ops.every(r => r.attributes['telemetry.op'] === 'shutdown' && r.severity === 'info')).toBe(true)
    expect(ops.every(r => !('event.seq' in r.attributes) && !('event.type' in r.attributes))).toBe(true)
  })

  it('emits the shutdown marker at the session’s own disposal edge, then retires it', async () => {
    const { ctx, backend, fiber } = await setup()
    liveSession(ctx, 'survivor')
    // A session owned by its own fiber: disposing the fiber detaches it from
    // the store and emits `session/disposed` — the authoritative termination
    // edge. The marker must ride THAT edge (receivers classify a session with
    // activity and no marker as crashed, so a normally closed session in a
    // long-running host must not look like a crash), and the session retires
    // from the adopted set so unload neither retains it nor re-marks it.
    /** 中文说明：函数值 owner 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const owner = await ctx.plugin(Object.assign((inner: Context) => {
      inner.sessions.create(SessionId('ephemeral'), { meta: {} })
    }, { inject: ['sessions'] }))
    await owner.dispose()
    /** 中文说明：函数值 atEdge 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const atEdge = backend.records.filter(r => r.channel === 'ops')
    expect(atEdge.map(r => r.attributes['session.id'])).toEqual(['ephemeral'])
    expect(atEdge[0]!.attributes['telemetry.op']).toBe('shutdown')
    await fiber.dispose()
    /** 中文说明：函数值 ops 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const ops = backend.records.filter(r => r.channel === 'ops')
    expect(ops.map(r => r.attributes['session.id'])).toEqual(['ephemeral', 'survivor'])
  })

  it('warns instead of throwing when backend shutdown fails', async () => {
    /** 中文说明：变量 backend 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const backend = new FakeBackend()
    backend.shutdownError = new Error('exporter unreachable')
    const { ctx, fiber } = await setup(backend)
    /** 中文说明：函数值 warn 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    liveSession(ctx)
    await expect(fiber.dispose()).resolves.not.toThrow()
    expect(warn.mock.calls.some(args => String(args[0]).includes('shutdown failed'))).toBe(true)
  })

  it('contains emit failures: the append succeeds and capture heals', async () => {
    const { ctx, backend } = await setup()
    /** 中文说明：函数值 warn 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = liveSession(ctx)
    backend.emitError = new Error('backend broke')
    expect(() => session.append('turn/start', { turn: 1 })).not.toThrow()
    expect(warn).toHaveBeenCalled()
    backend.emitError = undefined
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(backend.ledger().map(r => r.attributes['event.type'])).toEqual(['turn/end'])
  })

  it.each([
    ['Error values', new TypeError('adapter exploded'), 'TypeError', 'adapter exploded'],
    ['non-Error values', 'plain failure', 'Error', 'plain failure'],
  ])('relays agent/error %s as an ops record with normalized identity', async (_label, error, name, message) => {
    const { ctx, backend } = await setup()
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = liveSession(ctx, 'erring')
    // Only the members the relay reads; the full Agent surface is irrelevant here.
    /** 中文说明：变量 agent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const agent = { id: 'agent-1', session } as Agent
    ctx.emit('agent/error', { agent, turn: 3, step: 2, error })
    /** 中文说明：函数值 record 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const record = backend.records.find(r => r.channel === 'ops')!
    expect(record.severity).toBe('error')
    expect(record.attributes).toMatchObject({
      'telemetry.op': 'agent-error',
      'session.id': 'erring',
      'agent.id': 'agent-1',
      'error.name': name,
      turn: 3,
      step: 2,
    })
    expect(record.body).toEqual({ name, message })
  })
})
