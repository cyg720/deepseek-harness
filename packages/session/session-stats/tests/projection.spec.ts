/**
 * The `sessionStats` projection unit: mounting the plugin beside the
 * projection registry serves whole-log counts and wall times folded from step
 * boundaries, chunks, tool pairs, and assembled messages; compositions
 * without the registry are unaffected; unmounting the plugin removes the key
 * (HMR safety). The two counting regressions pinned here are the reasons the
 * fold counts step boundaries instead of assistant messages: a cancelled step
 * never assembles a message but still counts, and a max-tokens usage-host
 * message (empty content) adds no extra step. Wall-time math runs against the
 * exported definition directly, where event times are controlled.
 */
/*
 * 文件职责：验证 projection.spec.ts 覆盖的会话投影统计行为、持久化与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、事件日志、SQLite 或 OpenTelemetry。
 * 产品维度：保障 Agent 的会话投影统计状态稳定、可重放且可诊断。
 * 逻辑维度：准备或解析会话数据，执行核心流程，再处理结果、错误与资源清理。
 * 关键边界：持久化和遥测输入不可信；敏感数据必须脱敏；事件与数据库资源必须正确收尾。
 * 新手阅读建议：先看数据类型和辅助函数，再读写入/投影主流程，最后关注恢复、脱敏和失败场景。
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import * as SessionStatsPlugin from '@deepseek-ai/dsh-session-stats'
import { sessionStatsProjectionDefinition } from '@deepseek-ai/dsh-session-stats/src/projection.ts'
import type { SessionStatsProjection } from '@deepseek-ai/dsh-session-stats/types'

/** 中文说明：函数 harness 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function harness(withStatsPlugin: boolean): Promise<{ ctx: Context; session: Session }> {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  if (withStatsPlugin) await ctx.plugin(SessionStatsPlugin)
  return { ctx, session: ctx.sessions.create(SessionId('counted')) }
}

/** Close one step; returns the counted `step/end` seq. */
/* 中文说明：函数 closeStep 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function closeStep(session: Session, turn: number, step: number): number {
  session.append('step/start', { turn, step })
  return session.append('step/end', { turn, step }).seq
}

/** Append the max-tokens usage-host shape: an assistant/message with empty content. */
/* 中文说明：函数 appendEmptyAssistantMessage 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function appendEmptyAssistantMessage(session: Session, turn: number, step: number): void {
  session.append('assistant/message', {
    stream: [],
    turn,
    step,
    message: createMessage({
      role: 'assistant',
      content: [],
      source: { kind: 'model', provider: 'mock', model: 'mock' },
    }),
  }, { surfaceOp: 'append' })
}

/** The all-zero projection value plus overrides, for exact fold expectations. */
/* 中文说明：函数 totals 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function totals(overrides: Partial<SessionStatsProjection> = {}): SessionStatsProjection {
  return {
    turns: 0, steps: 0, llmMs: 0, toolMs: 0, ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0,
    ...overrides,
  }
}

describe('sessionStats projection unit (registry drive)', () => {
  it('serves zero figures on the empty log', async () => {
    const { ctx, session } = await harness(true)
    expect(ctx.sessionProjections.snapshot(session).values.sessionStats).toEqual(totals())
  })

  it('counts distinct turns and closed steps and notifies the change feed with the causing seq', async () => {
    const { ctx, session } = await harness(true)
    /** 中文说明：变量 changes 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const changes: { key: string; value: unknown; seq: number }[] = []
    ctx.sessionProjections.onChanged((_session, key, value, seq) => {
      changes.push({ key, value, seq })
    })
    session.append('turn/start', { turn: 1 })
    /** 中文说明：变量 firstSeq 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const firstSeq = closeStep(session, 1, 1)
    /** 中文说明：变量 secondSeq 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const secondSeq = closeStep(session, 1, 2)
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    session.append('turn/start', { turn: 2 })
    /** 中文说明：变量 thirdSeq 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const thirdSeq = closeStep(session, 2, 1)
    session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
    // Boundary events that carry no figure change (turn/start, empty-prune
    // turn/end, user input) fold to the same reference and stay silent;
    // step/start opens a boundary (internal state) and step/end commits the
    // counts, so each closed step notifies twice with the step/end value last.
    /** 中文说明：函数值 counted 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const counted = changes.filter(change => (change.value as SessionStatsProjection).steps > 0
      || change.seq === firstSeq)
    expect(changes.every(change => change.key === 'sessionStats')).toBe(true)
    expect(counted.map(change => ({ seq: change.seq, value: change.value }))).toContainEqual(
      { seq: firstSeq, value: totals({ turns: 1, steps: 1 }) },
    )
    expect(changes.at(-1)).toEqual({ key: 'sessionStats', value: totals({ turns: 2, steps: 3 }), seq: thirdSeq })
    /** 中文说明：变量 snapshot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const snapshot = ctx.sessionProjections.snapshot(session)
    expect(snapshot.values.sessionStats).toEqual(totals({ turns: 2, steps: 3 }))
    expect(snapshot.asOfSeq).toBe(session.seq - 1)
    expect(changes.map(change => change.seq)).toContain(secondSeq)
  })

  it('does not count a rejected or empty turn that closes with no step', async () => {
    const { ctx, session } = await harness(true)
    session.append('turn/start', { turn: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'blocked' } })
    expect(ctx.sessionProjections.snapshot(session).values.sessionStats).toEqual(totals())
  })

  it('counts a cancelled step that closed without an assistant message', async () => {
    // Regression: an aborted stream never assembles assistant/message, but the
    // loop's finally still appends step/end — the step happened and counts.
    const { ctx, session } = await harness(true)
    session.append('turn/start', { turn: 1 })
    closeStep(session, 1, 1)
    session.append('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'legacy' } } })
    expect(ctx.sessionProjections.snapshot(session).values.sessionStats)
      .toMatchObject({ turns: 1, steps: 1 })
  })

  it('adds no extra step for a max-tokens usage-host assistant message', async () => {
    // Regression: the empty-content assistant/message exists only to host
    // usage and is excluded from the surface; the step counts once, from its
    // step/end, while the message contributes only its model wall time.
    const { ctx, session } = await harness(true)
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    appendEmptyAssistantMessage(session, 1, 1)
    session.append('step/end', { turn: 1, step: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'max-tokens' } })
    expect(ctx.sessionProjections.snapshot(session).values.sessionStats)
      .toMatchObject({ turns: 1, steps: 1, ttftSteps: 0, decodeTokens: 0 })
  })

  it('folds steps already in the log when the plugin mounts late (lazy cell build)', async () => {
    const { ctx, session } = await harness(false)
    session.append('turn/start', { turn: 1 })
    closeStep(session, 1, 1)
    closeStep(session, 1, 2)
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await ctx.plugin(SessionStatsPlugin)
    expect(ctx.sessionProjections.snapshot(session).values.sessionStats)
      .toMatchObject({ turns: 1, steps: 2 })
  })

  it('has no sessionStats key without the plugin, and drops it when the plugin unloads (HMR safety)', async () => {
    const { ctx, session } = await harness(false)
    expect('sessionStats' in ctx.sessionProjections.snapshot(session).values).toBe(false)
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = await ctx.plugin(SessionStatsPlugin)
    session.append('turn/start', { turn: 1 })
    closeStep(session, 1, 1)
    expect(ctx.sessionProjections.snapshot(session).values.sessionStats)
      .toMatchObject({ turns: 1, steps: 1 })
    await fiber.dispose()
    expect('sessionStats' in ctx.sessionProjections.snapshot(session).values).toBe(false)
  })
})

/** Build one synthetic committed event with a controlled timestamp. */
/* 中文说明：函数 at 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function at(time: number, type: string, data: unknown): SessionEvent {
  return { type, seq: time, time, data } as unknown as SessionEvent
}

function attemptAt(
  time: number,
  chunks: readonly { readonly time: number; readonly chunk: StreamChunk }[],
  turn = 1,
  step = 1,
): SessionEvent {
  return at(time, 'assistant/attempt', {
    turn,
    step,
    stream: chunks.map(member => ({ type: 'chunk', ...member })),
  })
}

/** Fold a synthetic event list through the definition and view the result. */
/* 中文说明：函数 fold 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function fold(events: readonly SessionEvent[]): SessionStatsProjection {
  /** 中文说明：变量 state 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const state = events.reduce<Parameters<typeof sessionStatsProjectionDefinition.apply>[0]>(
    (folded, event) => sessionStatsProjectionDefinition.apply(folded, event),
    sessionStatsProjectionDefinition.init(),
  )
  return sessionStatsProjectionDefinition.wire.view(state)
}

describe('sessionStats wall-time fold (controlled timestamps)', () => {
  /** 中文说明：变量 message 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const message = createMessage({
    role: 'assistant',
    content: [{ type: 'text', text: 'answer' }],
    source: { kind: 'model', provider: 'mock', model: 'mock' },
  })

  function messageAt(
    time: number,
    chunks: readonly { readonly time: number; readonly chunk: StreamChunk }[] = [],
    usage?: TokenUsage,
  ): SessionEvent {
    return at(time, 'assistant/message', {
      turn: 1,
      step: 1,
      message,
      stream: chunks.map(member => ({ type: 'chunk', ...member })),
      ...usage === undefined ? {} : { usage },
    })
  }

  it('accrues model, first-token, and decode time from one fully recorded step', () => {
    expect(fold([
      at(1_000, 'step/start', { turn: 1, step: 1 }),
      messageAt(4_800, [{
        time: 1_800, chunk: { type: 'text-delta', index: 0, text: 'a' },
      }], { inputTokens: 10, outputTokens: 60 }),
      at(4_900, 'step/end', { turn: 1, step: 1 }),
    ])).toEqual(totals({
      turns: 1, steps: 1, llmMs: 3_800, ttftMs: 800, ttftSteps: 1, decodeMs: 3_000, decodeTokens: 60,
    }))
  })

  it('keeps the first attempt token boundary across an in-step retry (window resetForRetry parity)', () => {
    expect(fold([
      at(1_000, 'step/start', { turn: 1, step: 1 }),
      attemptAt(1_100, [{
        time: 1_100, chunk: { type: 'text-delta', index: 0, text: '' },
      }]),
      attemptAt(2_000, [{
        time: 1_200, chunk: { type: 'reasoning-delta', index: 0, text: 'x' },
      }]),
      attemptAt(2_500, [{
        time: 1_500, chunk: { type: 'text-delta', index: 0, text: 'later' },
      }]),
      at(2_000, 'llm/retry', { turn: 1, step: 1 }),
      messageAt(5_000, [{
        time: 3_000, chunk: { type: 'text-delta', index: 0, text: 'y' },
      }]),
      at(5_100, 'step/end', { turn: 1, step: 1 }),
    ])).toEqual(totals({ turns: 1, steps: 1, llmMs: 4_000, ttftMs: 200, ttftSteps: 1 }))
  })

  it('ignores empty deltas, non-token chunks, and chunks outside the open step', () => {
    expect(fold([
      // Attempt before any step/start: no open boundary.
      attemptAt(500, [{
        time: 500, chunk: { type: 'text-delta', index: 0, text: 'stray' },
      }]),
      at(1_000, 'step/start', { turn: 1, step: 1 }),
      attemptAt(1_300, [{
        time: 1_300, chunk: { type: 'text-delta', index: 0, text: 'other' },
      }], 2, 9),
      messageAt(2_000, [
        { time: 1_100, chunk: { type: 'block-start', index: 0, blockType: 'text' } },
        { time: 1_200, chunk: { type: 'text-delta', index: 0, text: '' } },
        { time: 1_400, chunk: { type: 'text-delta', index: 0, text: 'first' } },
      ]),
      at(2_100, 'step/end', { turn: 1, step: 1 }),
    ])).toEqual(totals({ turns: 1, steps: 1, llmMs: 1_000, ttftMs: 400, ttftSteps: 1 }))
  })

  it('uses non-empty Tool-call names or arguments as the first token', () => {
    expect(fold([
      at(1_000, 'step/start', { turn: 1, step: 1 }),
      messageAt(2_000, [
        { time: 1_100, chunk: { type: 'tool-call-delta', index: 0, id: ToolCallId('call-1'), argumentsDelta: '' } },
        {
          time: 1_200,
          chunk: { type: 'tool-call-delta', index: 0, id: ToolCallId('call-1'), name: 'read', argumentsDelta: '' },
        },
      ]),
      at(2_100, 'step/end', { turn: 1, step: 1 }),
    ])).toEqual(totals({ turns: 1, steps: 1, llmMs: 1_000, ttftMs: 200, ttftSteps: 1 }))

    expect(fold([
      at(1_000, 'step/start', { turn: 1, step: 1 }),
      messageAt(2_000, [{
        time: 1_300,
        chunk: { type: 'tool-call-delta', index: 0, id: ToolCallId('call-1'), argumentsDelta: '{' },
      }]),
      at(2_100, 'step/end', { turn: 1, step: 1 }),
    ])).toEqual(totals({ turns: 1, steps: 1, llmMs: 1_000, ttftMs: 300, ttftSteps: 1 }))
  })

  it('leaves a cancelled step untimed: counted by step/end, no assembled message to accrue from', () => {
    expect(fold([
      at(1_000, 'step/start', { turn: 1, step: 1 }),
      attemptAt(1_500, [{
        time: 1_500, chunk: { type: 'text-delta', index: 0, text: 'partial' },
      }]),
      at(2_000, 'step/end', { turn: 1, step: 1 }),
    ])).toEqual(totals({ turns: 1, steps: 1 }))
  })

  it('pairs tool wall time by callId, ignores orphan results, and prunes leftovers at turn/end', () => {
    /** 中文说明：函数值 result 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const result = (callId: string): unknown =>
      ({ turn: 1, step: 1, message: { source: { kind: 'tool', callId } } })
    /** 中文说明：变量 paired 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const paired = fold([
      at(1_000, 'step/start', { turn: 1, step: 1 }),
      at(1_100, 'tool/call', { turn: 1, step: 1, callId: 'a', name: 'read', arguments: '{}' }),
      at(1_200, 'tool/call', { turn: 1, step: 1, callId: 'b', name: 'read', arguments: '{}' }),
      // Out-of-order settlement pairs by id, not adjacency.
      at(4_200, 'tool/result', result('b')),
      at(1_600, 'tool/result', result('a')),
      at(5_000, 'tool/result', result('ghost')),
      at(5_100, 'step/end', { turn: 1, step: 1 }),
    ])
    expect(paired).toEqual(totals({ turns: 1, steps: 1, toolMs: 3_500 }))
    // An unresolved call is dropped at turn/end; a later result cannot pair.
    /** 中文说明：变量 pruned 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pruned = fold([
      at(1_000, 'step/start', { turn: 1, step: 1 }),
      at(1_100, 'tool/call', { turn: 1, step: 1, callId: 'orphan', name: 'read', arguments: '{}' }),
      at(2_000, 'step/end', { turn: 1, step: 1 }),
      at(2_100, 'turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'legacy' } } }),
      at(9_000, 'tool/result', result('orphan')),
    ])
    expect(pruned).toEqual(totals({ turns: 1, steps: 1 }))
  })

  it('pairs only own pendingCalls keys: a prototype-name callId without a recorded call stays unmatched', () => {
    /** 中文说明：函数值 result 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const result = (callId: string): unknown =>
      ({ turn: 1, step: 1, message: { source: { kind: 'tool', callId } } })
    // Crash recovery (TOOL_NOT_STARTED) emits results with no preceding
    // tool/call; a provider-minted callId colliding with an Object prototype
    // property must read as absent, not as an inherited function that would
    // fold toolMs to NaN and fail the value schema.
    expect(fold([
      at(1_000, 'step/start', { turn: 1, step: 1 }),
      at(1_500, 'tool/result', result('toString')),
      at(2_000, 'step/end', { turn: 1, step: 1 }),
    ])).toEqual(totals({ turns: 1, steps: 1 }))
    // The same name pairs normally once its call is recorded.
    expect(fold([
      at(1_000, 'step/start', { turn: 1, step: 1 }),
      at(1_100, 'tool/call', { turn: 1, step: 1, callId: 'constructor', name: 'read', arguments: '{}' }),
      at(1_600, 'tool/result', result('constructor')),
      at(2_000, 'step/end', { turn: 1, step: 1 }),
    ])).toEqual(totals({ turns: 1, steps: 1, toolMs: 500 }))
  })

  it('skips decode for an invalid usage report and ignores a duplicate assembled message', () => {
    /** 中文说明：变量 events 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const events = [
      at(1_000, 'step/start', { turn: 1, step: 1 }),
      // A malformed provider report: guarded like the window fold guards node usage.
      messageAt(2_000, [{
        time: 1_400, chunk: { type: 'text-delta', index: 0, text: 'a' },
      }], { inputTokens: 1, outputTokens: -5 }),
    ]
    expect(fold([...events, at(2_100, 'step/end', { turn: 1, step: 1 })]))
      .toEqual(totals({ turns: 1, steps: 1, llmMs: 1_000, ttftMs: 400, ttftSteps: 1 }))
    // The first message closed the step boundary; a defensive duplicate finds
    // no open step and folds to the same reference.
    /** 中文说明：变量 state 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const state = events.reduce<Parameters<typeof sessionStatsProjectionDefinition.apply>[0]>(
      (folded, event) => sessionStatsProjectionDefinition.apply(folded, event),
      sessionStatsProjectionDefinition.init(),
    )
    expect(sessionStatsProjectionDefinition.apply(
      state,
      messageAt(2_050),
    )).toBe(state)
  })

  it('accrues nothing for unrelated events and clamps negative clock skew to zero', () => {
    /** 中文说明：变量 state 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const state = sessionStatsProjectionDefinition.init()
    /** 中文说明：变量 untouched 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const untouched = sessionStatsProjectionDefinition.apply(state, at(1, 'user/message', { content: [] }))
    expect(untouched).toBe(state)
    expect(fold([
      at(2_000, 'step/start', { turn: 1, step: 1 }),
      messageAt(1_000),
      at(2_100, 'step/end', { turn: 1, step: 1 }),
    ])).toEqual(totals({ turns: 1, steps: 1 }))
  })
})
