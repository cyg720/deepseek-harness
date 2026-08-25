/**
 * 文件职责：验证 token-usage-projection.spec.ts 覆盖的 LLM 计量、配置、调用与事件处理行为。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件上下文和可控测试替身验证运行时协作。
 * 产品维度：保障模型调用及令牌统计能向 Agent 和使用者提供稳定、可追踪的结果。
 * 逻辑维度：准备上下文与测试数据，触发被测流程，再核对请求、事件、投影结果和清理行为。
 * 关键边界：测试替身必须保持确定性；持久化事件应可重放；异步资源必须在用例结束时释放。
 * 新手阅读建议：先看测试数据和辅助函数，再按 describe/it 场景阅读，最后对照被测插件实现。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import type { ContextPressureProjection, TokenUsageProjection } from '@deepseek-ai/dsh-token-meter/client'
import { CompactionId } from '@deepseek-ai/dsh-compaction'
import type {} from '../src/usage-projection.ts'

/** 中文说明：常量 ZERO 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const ZERO: TokenUsageProjection = {
  uncachedInputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
}

/** 中文说明：函数 harness 承担本测试场景中的准备或验证工作；参数按签名传入，返回值供后续断言使用；示例见本文件调用。 */
async function harness(): Promise<{
  ctx: Context
  session: Session
  meterFiber: Awaited<ReturnType<Context['plugin']>>
}> {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  /** 中文说明：变量 meterFiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const meterFiber = await ctx.plugin(TokenMeter)
  return { ctx, session: ctx.sessions.create(), meterFiber }
}

/** 中文说明：函数 startStep 承担本测试场景中的准备或验证工作；参数按签名传入，返回值供后续断言使用；示例见本文件调用。 */
function startStep(session: Session, turn: number, step: number): void {
  session.append('step/start', { turn, step })
}

/** 中文说明：函数 usageChunk 承担本测试场景中的准备或验证工作；参数按签名传入，返回值供后续断言使用；示例见本文件调用。 */
function usageChunk(
  session: Session,
  usage: TokenUsage,
  turn: number,
  step: number,
): number {
  return session.append('assistant/chunk', {
    turn,
    step,
    chunk: { type: 'usage', usage },
  }).seq
}

/** 中文说明：函数 finalUsage 承担本测试场景中的准备或验证工作；参数按签名传入，返回值供后续断言使用；示例见本文件调用。 */
function finalUsage(
  session: Session,
  usage: TokenUsage,
  turn: number,
  step: number,
  sourceSeqs: number[],
): void {
  session.append('assistant/message', {
    turn,
    step,
    message: createMessage({
      role: 'assistant',
      content: [],
      source: { kind: 'model', provider: 'mock', model: 'mock' },
    }),
    usage,
  }, { surfaceOp: 'append', sourceEventSeqs: sourceSeqs })
  session.append('step/end', { turn, step })
}

/** 中文说明：函数值 projected 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
const projected = (ctx: Context, session: Session): TokenUsageProjection => {
  /** 中文说明：变量 value 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const value = ctx.sessionProjections.snapshot(session).values.tokenUsage
  if (value === undefined) throw new Error('tokenUsage projection is not registered')
  return value
}

/**
 * Meter one upcoming replacement the way compaction-basic does: price the
 * replaced span from the measurement service's own nodes and log the
 * shadow-price event directly before the replace.
 */
/* 中文说明：函数 appendSummaryMeter 承担本测试场景中的准备或验证工作；参数按签名传入，返回值供后续断言使用；示例见本文件调用。 */
function appendSummaryMeter(ctx: Context, session: Session, start: number, end: number): void {
  /** 中文说明：变量 nodes 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const nodes = ctx.tokenMeter.measure(session).nodes
  /** 中文说明：函数值 startIdx 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  const startIdx = nodes.findIndex(node => node.seq === start)
  /** 中文说明：函数值 endIdx 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  const endIdx = nodes.findIndex(node => node.seq === end)
  /** 中文说明：变量 shadowed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const shadowed = nodes.slice(startIdx, endIdx + 1)
  session.append('compaction/summary', {
    compactionId: CompactionId('token-usage-summary'),
    summary: [{ type: 'text', text: 'summary' }],
    shadowedRange: { start, end },
    shadowedSeqs: shadowed.map(node => node.seq),
    shadowedTokenCount: shadowed.reduce((total, node) => total + node.tokens, 0),
    provider: 'mock',
    model: 'mock',
  })
}

describe('tokenUsage session projection', () => {
  it('serves zero buckets for an empty log', async () => {
    const { ctx, session } = await harness()
    expect(projected(ctx, session)).toEqual(ZERO)
  })

  it('does not count a usage chunk and identical final usage twice', async () => {
    const { ctx, session } = await harness()
    /** 中文说明：变量 changes 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const changes: unknown[] = []
    ctx.sessionProjections.onChanged((_session, key, value) => {
      if (key === 'tokenUsage') changes.push(value)
    })
    /** 中文说明：变量 usage 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const usage = {
      inputTokens: 10,
      outputTokens: 4,
      cacheReadTokens: 7,
      cacheWriteTokens: 2,
      reasoningTokens: 3,
    }
    startStep(session, 1, 1)
    /** 中文说明：变量 source 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const source = usageChunk(session, usage, 1, 1)
    finalUsage(session, usage, 1, 1, [source])

    expect(projected(ctx, session)).toEqual({
      uncachedInputTokens: 10,
      outputTokens: 4,
      cacheReadTokens: 7,
      cacheWriteTokens: 2,
    })
    expect(changes).toHaveLength(1)
  })

  it('replaces an earlier same-step chunk sample with the final usage', async () => {
    const { ctx, session } = await harness()
    startStep(session, 1, 1)
    /** 中文说明：变量 source 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const source = usageChunk(session, {
      inputTokens: 10,
      outputTokens: 2,
      cacheReadTokens: 3,
    }, 1, 1)
    finalUsage(session, {
      inputTokens: 14,
      outputTokens: 5,
      cacheReadTokens: 8,
      cacheWriteTokens: 1,
    }, 1, 1, [source])

    expect(projected(ctx, session)).toEqual({
      uncachedInputTokens: 14,
      outputTokens: 5,
      cacheReadTokens: 8,
      cacheWriteTokens: 1,
    })
  })

  it('accumulates disjoint buckets across steps without adding reasoning twice', async () => {
    const { ctx, session } = await harness()
    startStep(session, 1, 1)
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = usageChunk(session, {
      inputTokens: 10,
      outputTokens: 6,
      reasoningTokens: 5,
      cacheReadTokens: 2,
    }, 1, 1)
    finalUsage(session, {
      inputTokens: 10,
      outputTokens: 6,
      reasoningTokens: 5,
      cacheReadTokens: 2,
    }, 1, 1, [first])
    startStep(session, 1, 2)
    /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const second = usageChunk(session, {
      inputTokens: 20,
      outputTokens: 9,
      reasoningTokens: 7,
      cacheWriteTokens: 4,
    }, 1, 2)
    finalUsage(session, {
      inputTokens: 20,
      outputTokens: 9,
      reasoningTokens: 7,
      cacheWriteTokens: 4,
    }, 1, 2, [second])

    expect(projected(ctx, session)).toEqual({
      uncachedInputTokens: 30,
      outputTokens: 15,
      cacheReadTokens: 2,
      cacheWriteTokens: 4,
    })
  })

  it('retains a usage chunk when the request produces no final assistant message', async () => {
    const { ctx, session } = await harness()
    startStep(session, 1, 1)
    usageChunk(session, { inputTokens: 9, outputTokens: 1 }, 1, 1)
    session.append('step/end', { turn: 1, step: 1 })
    expect(projected(ctx, session)).toEqual({
      uncachedInputTokens: 9,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    })
  })

  it('does not erase historical billing when the visible surface is replaced', async () => {
    const { ctx, session } = await harness()
    startStep(session, 1, 1)
    /** 中文说明：变量 source 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const source = usageChunk(session, { inputTokens: 12, outputTokens: 3 }, 1, 1)
    finalUsage(session, { inputTokens: 12, outputTokens: 3 }, 1, 1, [source])
    /** 中文说明：变量 before 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const before = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'before compaction' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    appendSummaryMeter(ctx, session, before.seq, before.seq)
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'compacted' }],
      source: { kind: 'plugin', plugin: 'test' },
    }), {
      surfaceOp: { op: 'replace', start: before.seq, end: before.seq },
      sourceEventSeqs: [before.seq],
    })

    expect(projected(ctx, session)).toEqual({
      uncachedInputTokens: 12,
      outputTokens: 3,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    })
  })

  it('unregisters with the token-meter fiber and restores from a JSON checkpoint', async () => {
    const { ctx, session, meterFiber } = await harness()
    startStep(session, 1, 1)
    usageChunk(session, { inputTokens: 8, outputTokens: 2, cacheReadTokens: 5 }, 1, 1)
    /** 中文说明：变量 checkpoint 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const checkpoint = JSON.parse(JSON.stringify(
      ctx.sessionProjections.checkpoint(session),
    )) as ReturnType<typeof ctx.sessionProjections.checkpoint>

    await meterFiber.dispose()
    expect(ctx.sessionProjections.snapshot(session).values).not.toHaveProperty('tokenUsage')

    await ctx.plugin(TokenMeter)
    expect(ctx.sessionProjections.viewCheckpoint(checkpoint).tokenUsage).toEqual({
      uncachedInputTokens: 8,
      outputTokens: 2,
      cacheReadTokens: 5,
      cacheWriteTokens: 0,
    })
  })
})

/** 中文说明：函数值 pressure 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
const pressure = (ctx: Context, session: Session): ContextPressureProjection => {
  /** 中文说明：变量 value 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const value = ctx.sessionProjections.snapshot(session).values.contextPressure
  if (value === undefined) throw new Error('contextPressure projection is not registered')
  return value
}

/** 中文说明：函数 recordContext 承担本测试场景中的准备或验证工作；参数按签名传入，返回值供后续断言使用；示例见本文件调用。 */
function recordContext(session: Session, model: string, contextWindow?: number): void {
  session.append('request/context', {
    provider: 'mock',
    model,
    ...contextWindow === undefined ? {} : { contextWindow },
  })
}

/** Append one model-visible user turn and return its surface seq. */
/* 中文说明：函数 appendUser 承担本测试场景中的准备或验证工作；参数按签名传入，返回值供后续断言使用；示例见本文件调用。 */
function appendUser(session: Session, text: string): number {
  return session.append('user/message', createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' }).seq
}

/** Append one finalized assistant turn carrying its provider usage. */
/* 中文说明：函数 appendAssistant 承担本测试场景中的准备或验证工作；参数按签名传入，返回值供后续断言使用；示例见本文件调用。 */
function appendAssistant(
  session: Session,
  text: string,
  usage: TokenUsage,
  turn: number,
  step: number,
): number {
  return session.append('assistant/message', {
    turn,
    step,
    message: createMessage({
      role: 'assistant',
      content: [{ type: 'text', text }],
      source: { kind: 'model', provider: 'mock', model: 'mock' },
    }),
    usage,
  }, { surfaceOp: 'append', sourceEventSeqs: [] }).seq
}

describe('contextPressure session projection', () => {
  it('serves no pressure or capacity for an empty log', async () => {
    const { ctx, session } = await harness()
    expect(pressure(ctx, session)).toEqual({})
  })

  it('does not synthesize zero pressure before a provider usage sample', async () => {
    const { ctx, session } = await harness()
    startStep(session, 1, 1)
    recordContext(session, 'small', 64_000)
    expect(pressure(ctx, session)).toEqual({ contextWindow: 64_000 })
  })

  it('sums prompt-side buckets and excludes response output', async () => {
    const { ctx, session } = await harness()
    startStep(session, 1, 1)
    usageChunk(session, {
      inputTokens: 100,
      outputTokens: 4_000,
      cacheReadTokens: 20,
      cacheWriteTokens: 5,
    }, 1, 1)
    // Output is deliberately absent: occupancy describes the prompt that was
    // sent, so it holds still while the response streams.
    expect(pressure(ctx, session).pressureTokens).toBe(125)
  })

  it('replaces pressure with the newest request rather than accumulating', async () => {
    const { ctx, session } = await harness()
    startStep(session, 1, 1)
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = usageChunk(session, { inputTokens: 100, outputTokens: 10 }, 1, 1)
    finalUsage(session, { inputTokens: 100, outputTokens: 10 }, 1, 1, [first])
    startStep(session, 2, 1)
    usageChunk(session, { inputTokens: 250, outputTokens: 10 }, 2, 1)
    expect(pressure(ctx, session).pressureTokens).toBe(250)
  })

  it('carries the newest recorded capacity and replaces it on a model switch', async () => {
    const { ctx, session } = await harness()
    startStep(session, 1, 1)
    recordContext(session, 'small', 64_000)
    usageChunk(session, { inputTokens: 100, outputTokens: 10 }, 1, 1)
    expect(pressure(ctx, session)).toEqual({
      pressureTokens: 100, projectedTokens: 100, contextWindow: 64_000,
    })
    recordContext(session, 'large', 256_000)
    expect(pressure(ctx, session)).toEqual({
      pressureTokens: 100, projectedTokens: 100, contextWindow: 256_000,
    })
  })

  it('removes an older capacity when the newest route advertises none', async () => {
    const { ctx, session } = await harness()
    startStep(session, 1, 1)
    recordContext(session, 'small', 64_000)
    usageChunk(session, { inputTokens: 100, outputTokens: 10 }, 1, 1)
    recordContext(session, 'unknown')
    expect(pressure(ctx, session)).toEqual({ pressureTokens: 100, projectedTokens: 100 })
  })

  it('pushes no change for unrelated events or a restated capacity', async () => {
    // The registry gates its change feed on Object.is, so a unit that rebuilt
    // state for an event it does not care about would push phantom updates.
    const { ctx, session } = await harness()
    startStep(session, 1, 1)
    recordContext(session, 'small', 64_000)
    usageChunk(session, { inputTokens: 100, outputTokens: 10 }, 1, 1)
    /** 中文说明：变量 changed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const changed: string[] = []
    ctx.sessionProjections.onChanged((_session, key) => { changed.push(key) })

    session.append('todo/write', { todos: [] })
    expect(changed).not.toContain('contextPressure')
    // A repeated capacity record for the same window is also a no-op.
    recordContext(session, 'small', 64_000)
    expect(changed).not.toContain('contextPressure')
    // A real capacity change still reports.
    recordContext(session, 'large', 256_000)
    expect(changed).toContain('contextPressure')
  })

  it('restores from a JSON checkpoint and unregisters with the token-meter fiber', async () => {
    const { ctx, session, meterFiber } = await harness()
    startStep(session, 1, 1)
    recordContext(session, 'small', 64_000)
    usageChunk(session, { inputTokens: 42, outputTokens: 2 }, 1, 1)
    /** 中文说明：变量 checkpoint 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const checkpoint = JSON.parse(JSON.stringify(
      ctx.sessionProjections.checkpoint(session),
    )) as ReturnType<typeof ctx.sessionProjections.checkpoint>
    expect(checkpoint.contextPressure?.ver).toBe(4)

    await meterFiber.dispose()
    expect(ctx.sessionProjections.snapshot(session).values).not.toHaveProperty('contextPressure')

    await ctx.plugin(TokenMeter)
    expect(ctx.sessionProjections.viewCheckpoint(checkpoint).contextPressure).toEqual({
      pressureTokens: 42,
      projectedTokens: 42,
      contextWindow: 64_000,
    })
  })

  it('carries the sample forward over surface growth and a compaction', async () => {
    const { ctx, session } = await harness()
    recordContext(session, 'large', 128_000)
    /** 中文说明：变量 question 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const question = appendUser(session, 'a first question worth a few tokens')
    startStep(session, 1, 1)
    // The provider prices the prompt its request actually carried; the sample
    // must anchor against the surface as of that request, not after the
    // assistant message joins it.
    /** 中文说明：变量 answer 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const answer = appendAssistant(session, 'an answer of some length', { inputTokens: 900, outputTokens: 20 }, 1, 1)
    session.append('step/end', { turn: 1, step: 1 })
    /** 中文说明：变量 afterTurn 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const afterTurn = pressure(ctx, session)
    expect(afterTurn.pressureTokens).toBe(900)
    // The assistant message landed after the sample, so it already shows.
    expect(afterTurn.projectedTokens).toBeGreaterThan(900)

    /** 中文说明：变量 grown 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const grown = appendUser(session, 'a follow-up question that grows the surface further')
    /** 中文说明：变量 beforeCompaction 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const beforeCompaction = pressure(ctx, session).projectedTokens
    expect(beforeCompaction).toBeGreaterThan(afterTurn.projectedTokens!)

    // Compaction reports no usage of its own, so `pressureTokens` cannot move;
    // the projected figure must shrink anyway — the defect this field fixes.
    appendSummaryMeter(ctx, session, question, grown)
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'summary' }],
      source: { kind: 'plugin', plugin: 'test' },
    }), {
      surfaceOp: { op: 'replace', start: question, end: grown },
      sourceEventSeqs: [question, answer, grown],
    })
    /** 中文说明：变量 compacted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const compacted = pressure(ctx, session)
    expect(compacted.pressureTokens).toBe(900)
    expect(compacted.projectedTokens).toBeLessThan(beforeCompaction!)
  })

  it('folds a replacement without a claim at zero', async () => {
    const { ctx, session } = await harness()
    /** 中文说明：变量 question 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const question = appendUser(session, 'a question from an unmetered log')
    startStep(session, 1, 1)
    usageChunk(session, { inputTokens: 100, outputTokens: 1 }, 1, 1)
    session.append('step/end', { turn: 1, step: 1 })
    /** 中文说明：变量 before 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const before = pressure(ctx, session)

    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'summary without a preceding claim' }],
      source: { kind: 'plugin', plugin: 'test' },
    }), {
      surfaceOp: { op: 'replace', start: question, end: question },
      sourceEventSeqs: [question],
    })

    expect(pressure(ctx, session)).toEqual(before)
  })

  it('clamps a projection that heuristic error drove below zero', async () => {
    const { ctx, session } = await harness()
    recordContext(session, 'large', 128_000)
    /** 中文说明：变量 question 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const question = appendUser(session, 'a question long enough to outprice the sample'.repeat(4))
    startStep(session, 1, 1)
    // A provider sample far below the heuristic price of what it replaced:
    // shadowing that span subtracts more than the sample holds.
    appendAssistant(session, 'ok', { inputTokens: 3, outputTokens: 1 }, 1, 1)
    session.append('step/end', { turn: 1, step: 1 })
    appendSummaryMeter(ctx, session, question, question)
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '.' }],
      source: { kind: 'plugin', plugin: 'test' },
    }), {
      surfaceOp: { op: 'replace', start: question, end: question },
      sourceEventSeqs: [question],
    })
    expect(pressure(ctx, session).projectedTokens).toBe(0)
  })
})
