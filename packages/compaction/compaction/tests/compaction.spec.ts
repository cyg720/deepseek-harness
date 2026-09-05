/**
 * 文件职责：验证上下文压缩的 compaction.spec.ts 行为。
 * 技术维度：Vitest、会话事件、模型请求夹具和 Cordis 组装。
 * 产品维度：防止上下文压缩改变模型可见内容或生命周期语义。
 * 逻辑维度：构造日志与配置，运行插件并断言事件、请求和清理。
 * 关键边界：模型可见内容必须可重建；工具调用和结果必须保持配对。
 * 新手阅读建议：先读事件夹具，再按正常、边界和失败场景阅读。
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  CompactionId,
  CompactionEngine,
  compactCheckpointSource,
  isCompactCheckpointSource,
} from '@deepseek-ai/dsh-compaction'
import type { CompactionResult, CompactionTrigger } from '@deepseek-ai/dsh-compaction'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionSeq } from '@deepseek-ai/dsh-session'
import type { CompactionAgentContext } from '@deepseek-ai/dsh-compaction'
import type { ManualCompactAgentContext } from '@deepseek-ai/dsh-compaction'

/**
 * A trivial concrete CompactionEngine implementing the abstract contract. The
 * Service Definition package owns no algorithm — these tests exercise its contract:
 * service registration, the abstract method shape, and the `compaction/*` event
 * declaration merge.
 */
/* 中文说明：类型或类 StubCompactionEngine 约束上下文或压缩数据职责。 */
class StubCompactionEngine extends CompactionEngine {
  /** Records the signal handed to the most recent call, to prove it threads through. */
  lastSignal: AbortSignal | undefined

  override async compactIfNeeded(
    _agent: CompactionAgentContext,
    _trigger: CompactionTrigger,
    signal: AbortSignal,
  ): Promise<CompactionResult | null> {
    this.lastSignal = signal
    return null
  }

  override async compactNow(
    _agent: ManualCompactAgentContext,
    signal: AbortSignal,
  ): Promise<CompactionResult | null> {
    this.lastSignal = signal
    return null
  }

  override async compactRegion(
    start: SessionSeq,
    end: SessionSeq,
    agent: CompactionAgentContext,
    signal?: AbortSignal,
  ): Promise<CompactionResult> {
    this.lastSignal = signal
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = agent.session
    /** 中文说明：测试局部值 summary，由紧邻初始化决定。 */
    const summary = [{ type: 'text' as const, text: 'stub' }]
    /** 中文说明：测试局部值 surface，由紧邻初始化决定。 */
    const surface = session.surface.nodes
    /** 中文说明：测试局部值 startIndex，由紧邻初始化决定。 */
    const startIndex = surface.indexOf(start)
    /** 中文说明：测试局部值 endIndex，由紧邻初始化决定。 */
    const endIndex = surface.indexOf(end)
    if (startIndex < 0 || endIndex < startIndex) throw new Error('stub compact range is invalid')
    /** 中文说明：测试局部值 shadowedSeqs，由紧邻初始化决定。 */
    const shadowedSeqs = surface.slice(startIndex, endIndex + 1)
    /** 中文说明：测试局部值 compactionId，由紧邻初始化决定。 */
    const compactionId = CompactionId('stub-compaction')
    // Minimal stub honoring the lock + log-only event contract.
    /** 中文说明：测试局部值 startEvent，由紧邻初始化决定。 */
    const startEvent = session.append('compaction/start', { compactionId, turn: 0 })
    /** 中文说明：测试局部值 summaryEvent，由紧邻初始化决定。 */
    const summaryEvent = session.append('compaction/summary', {
      compactionId,
      summary,
      shadowedRange: { start, end },
      shadowedSeqs,
      shadowedTokenCount: 0,
      provider: 'mock',
      model: 'stub',
    })
    session.append('user/message', createUserMessage({
      content: summary,
      source: compactCheckpointSource(compactionId),
    }), {
      surfaceOp: { op: 'replace', start, end },
      sourceEventSeqs: [startEvent.seq, summaryEvent.seq, ...shadowedSeqs],
    })
    /** 中文说明：测试局部值 endEvent，由紧邻初始化决定。 */
    const endEvent = session.append('compaction/end', { compactionId, turn: 0 })
    return {
      compactionId,
      startSeq: startEvent.seq,
      summarySeq: summaryEvent.seq,
      endSeq: endEvent.seq,
      summary,
      shadowedRange: { start, end },
      shadowedSeqs,
      shadowedTokenCount: 0,
    }
  }
}

describe('CompactionEngine seam', () => {
  /** 中文说明：函数 stubAgent 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
  function stubAgent(session: Session, model?: string): CompactionAgentContext {
    return { session, options: model === undefined ? {} : { model } }
  }

  it('registers as ctx.compaction', () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    void new StubCompactionEngine(ctx)
    expect(ctx.compaction).toBeDefined()
    expect(ctx.compaction).toBeInstanceOf(StubCompactionEngine)
  })

  it('disposing the fiber unregisters ctx.compaction (HMR safety)', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = await ctx.plugin(StubCompactionEngine)
    expect(ctx.compaction).toBeInstanceOf(StubCompactionEngine)
    await fiber.dispose()
    expect(ctx.compaction).toBeUndefined()
  })

  it('exposes the abstract contract methods', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    /** 中文说明：测试局部值 svc，由紧邻初始化决定。 */
    const svc = new StubCompactionEngine(ctx)
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = Session.create(SessionId('s'))
    expect(await svc.compactIfNeeded(stubAgent(session), 'pressure', new AbortController().signal)).toBeNull()
    /** 中文说明：测试局部值 signal，由紧邻初始化决定。 */
    const signal = new AbortController().signal
    expect(await svc.compactNow({
      ...stubAgent(session),
      runMaintenance: task => task(new AbortController().signal),
    }, signal)).toBeNull()
    expect(svc.lastSignal).toBe(signal)
  })

  it('compaction/* events merge into SessionEventMap and are log-only', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    /** 中文说明：测试局部值 svc，由紧邻初始化决定。 */
    const svc = new StubCompactionEngine(ctx)
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = Session.create(SessionId('s'))
    /** 中文说明：测试局部值 original，由紧邻初始化决定。 */
    const original = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'original' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await svc.compactRegion(original.seq, original.seq, stubAgent(session, 'm'))

    const startEvent = session.snapshotEvents().find(e => e.type === 'compaction/start')
    expect(startEvent).toBeDefined()
    // Log-only: the compiler rejects surfaceOp on compaction/* (not a SurfaceEventType);
    // verify the runtime value is absent.
    /** 中文说明：测试局部值 raw，由紧邻初始化决定。 */
    const raw = startEvent as unknown as { surfaceOp?: unknown }
    expect(raw.surfaceOp).toBeUndefined()
    expect(result.summary).toEqual([{ type: 'text', text: 'stub' }])
    expect(result.summarySeq).toBeGreaterThan(result.startSeq)
    expect(result.endSeq).toBeGreaterThan(result.summarySeq)
    expect(result.shadowedRange).toEqual({ start: original.seq, end: original.seq })
    expect(result.shadowedSeqs).toEqual([original.seq])
    const checkpoint = session.snapshotEvents().find(event => event.type === 'user/message'
      && isCompactCheckpointSource(event.data.source))
    expect(checkpoint?.type === 'user/message' && checkpoint.data.source)
      .toEqual(compactCheckpointSource(result.compactionId))
    expect(isCompactCheckpointSource({ kind: 'plugin', plugin: 'other' })).toBe(false)
    expect(isCompactCheckpointSource({ kind: 'user' })).toBe(false)
    expect(session.snapshotEvents().filter(e => e.type.startsWith('compaction/')).map(e => e.type))
      .toEqual(['compaction/start', 'compaction/summary', 'compaction/end'])
  })

  it('threads the cancellation signal through to the backend', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    /** 中文说明：测试局部值 svc，由紧邻初始化决定。 */
    const svc = new StubCompactionEngine(ctx)
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = Session.create(SessionId('s'))
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()
    /** 中文说明：测试局部值 original，由紧邻初始化决定。 */
    const original = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'original' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    await svc.compactRegion(original.seq, original.seq, stubAgent(session, 'm'), controller.signal)
    expect(svc.lastSignal).toBe(controller.signal)

    await svc.compactIfNeeded(stubAgent(session), 'context-overflow', controller.signal)
    expect(svc.lastSignal).toBe(controller.signal)
  })
})
