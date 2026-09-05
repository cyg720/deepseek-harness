/**
 * 文件职责：验证上下文压缩的 invariant.spec.ts 行为。
 * 技术维度：Vitest、会话事件、模型请求夹具和 Cordis 组装。
 * 产品维度：防止上下文压缩改变模型可见内容或生命周期语义。
 * 逻辑维度：构造日志与配置，运行插件并断言事件、请求和清理。
 * 关键边界：模型可见内容必须可重建；工具调用和结果必须保持配对。
 * 新手阅读建议：先读事件夹具，再按正常、边界和失败场景阅读。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { Session, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { CompactionId, compactCheckpointSource } from '@deepseek-ai/dsh-compaction'
import * as CompactionInvariant from '@deepseek-ai/dsh-compaction/invariant'
import { CommandId } from '@deepseek-ai/dsh-commands/brand'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'

/** 中文说明：函数 setup 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function setup(): Promise<Context> {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(CompactionInvariant)
  return ctx
}

/** 中文说明：测试局部值 TEST_COMPACTION_ID，由紧邻初始化决定。 */
const TEST_COMPACTION_ID = CompactionId('test-compaction')
/** 中文说明：测试局部值 NEXT_COMPACTION_ID，由紧邻初始化决定。 */
const NEXT_COMPACTION_ID = CompactionId('next-test-compaction')
/** 中文说明：测试局部值 TEST_COMMAND_ID，由紧邻初始化决定。 */
const TEST_COMMAND_ID = CommandId('test-command')
/** 中文说明：测试局部值 NEXT_COMMAND_ID，由紧邻初始化决定。 */
const NEXT_COMMAND_ID = CommandId('next-test-command')

const summary = (session: Session, overrides: Record<string, unknown> = {}) => {
  const appendMessage = (text: string) => session.append(
    'user/message',
    createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }),
    { surfaceOp: 'append' },
  )
  const first = appendMessage('first')
  const second = appendMessage('second')
  const third = appendMessage('third')
  const shadowedSeqs: [SessionSeq, SessionSeq, SessionSeq] = [first.seq, second.seq, third.seq]
  return {
    compactionId: TEST_COMPACTION_ID,
    summary: [{ type: 'text' as const, text: 'short' }],
    shadowedRange: { start: first.seq, end: third.seq },
    shadowedSeqs,
    shadowedTokenCount: 12,
    provider: 'mock',
    model: 'mock',
    ...overrides,
  }
}

/** 中文说明：函数 startTurn 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function startTurn(session: ReturnType<Context['sessions']['create']>, turn = 1): void {
  session.append('turn/start', { turn })
}

describe('compaction invariants', () => {
  it('accepts successful and failed compaction lifecycles', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 success，由紧邻初始化决定。 */
    const success = ctx.sessions.create()
    startTurn(success)
    success.append('compaction/start', { compactionId: TEST_COMPACTION_ID, turn: 1 })
    const summaryData = summary(success)
    success.append('compaction/summary', summaryData)
    success.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'checkpoint' }],
      source: compactCheckpointSource(TEST_COMPACTION_ID),
    }), {
      surfaceOp: { op: 'replace', ...summaryData.shadowedRange },
      sourceEventSeqs: summaryData.shadowedSeqs,
    })
    success.append('compaction/end', { compactionId: TEST_COMPACTION_ID, turn: 1 })

    /** 中文说明：测试局部值 failed，由紧邻初始化决定。 */
    const failed = ctx.sessions.create()
    startTurn(failed, 2)
    failed.append('compaction/start', { compactionId: TEST_COMPACTION_ID, turn: 2 })
    failed.append('compaction/end', { compactionId: TEST_COMPACTION_ID, turn: 2, error: 'provider failed' })
  })

  it('rejects shadow identities outside the exact earlier surface span', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create()
    const turn = session.append('turn/start', { turn: 1 })
    session.append('compaction/start', { compactionId: TEST_COMPACTION_ID, turn: 1 })
    const valid = summary(session)
    const current = SessionSeq(session.seq)
    expect(() => session.append('compaction/summary', {
      ...valid,
      shadowedRange: { start: current, end: current },
      shadowedSeqs: [current],
    })).toThrow(/must name an earlier current surface span/)
    expect(() => session.append('compaction/summary', {
      ...valid,
      shadowedRange: { start: turn.seq, end: turn.seq },
      shadowedSeqs: [turn.seq],
    })).toThrow(/must name an earlier current surface span/)
    expect(() => session.append('compaction/summary', {
      ...valid,
      shadowedSeqs: [valid.shadowedSeqs[0], valid.shadowedSeqs[2]],
    })).toThrow(/must list every node in the current surface span/)
    expect(() => session.append('compaction/summary', {
      ...valid,
      shadowedRange: { start: valid.shadowedSeqs[2], end: valid.shadowedSeqs[0] },
      shadowedSeqs: [valid.shadowedSeqs[2], valid.shadowedSeqs[0]],
    })).toThrow(/must name an earlier current surface span/)
    expect(() => session.append('compaction/summary', {
      ...valid,
      shadowedSeqs: [valid.shadowedSeqs[0], valid.shadowedSeqs[2], valid.shadowedSeqs[2]],
    })).toThrow(/must list every node in the current surface span/)
  })

  it('validates a model-free prune against the current surface', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create()
    const shadow = summary(session)
    expect(() => session.append('compaction/prune', {
      shadowedRange: shadow.shadowedRange,
      shadowedSeqs: shadow.shadowedSeqs,
      shadowedTokenCount: shadow.shadowedTokenCount,
    })).not.toThrow()
  })

  it('accepts standalone successful and failed compaction lifecycles between turns', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 success，由紧邻初始化决定。 */
    const success = ctx.sessions.create()
    success.append('compaction/start', { compactionId: TEST_COMPACTION_ID, turn: null })
    success.append('compaction/summary', summary(success))
    success.append('compaction/end', { compactionId: TEST_COMPACTION_ID, turn: null })

    /** 中文说明：测试局部值 failed，由紧邻初始化决定。 */
    const failed = ctx.sessions.create()
    failed.append('compaction/start', { compactionId: TEST_COMPACTION_ID, turn: null })
    failed.append('compaction/end', { compactionId: TEST_COMPACTION_ID, turn: null, error: 'provider failed' })
  })

  it('clears an inherited open compaction trace at end-seed during replay', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    /** 中文说明：测试局部值 source，由紧邻初始化决定。 */
    const source = Session.create(SessionId('stale-compaction-source'))
    source.append('compaction/start', { compactionId: TEST_COMPACTION_ID, turn: null })
    /** 中文说明：测试局部值 replayed，由紧邻初始化决定。 */
    const replayed = ctx.sessions.create(SessionId('stale-compaction-replay'), {
      seed: source.snapshotEvents(),
    })
    expect(replayed.snapshotEvents().map(event => event.type))
      .toEqual(['compaction/start', 'session/end-seed'])

    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(CompactionInvariant)

    expect(() => {
      replayed.append('compaction/start', { compactionId: NEXT_COMPACTION_ID, turn: null })
      replayed.append('compaction/end', { compactionId: NEXT_COMPACTION_ID, turn: null, error: 'new attempt failed' })
    }).not.toThrow()
  })

  it('allows repair turn boundaries after end-seed clears a seeded numbered orphan', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    /** 中文说明：测试局部值 source，由紧邻初始化决定。 */
    const source = Session.create(SessionId('stale-numbered-compaction-source'))
    startTurn(source)
    source.append('compaction/start', { compactionId: TEST_COMPACTION_ID, turn: 1 })
    /** 中文说明：测试局部值 replayed，由紧邻初始化决定。 */
    const replayed = ctx.sessions.create(SessionId('stale-numbered-compaction-replay'), {
      seed: source.snapshotEvents(),
    })
    expect(replayed.snapshotEvents().map(event => event.type))
      .toEqual(['turn/start', 'compaction/start', 'session/end-seed'])

    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(CompactionInvariant)

    expect(() => replayed.append(
      'turn/end',
      { turn: 1, reason: { kind: 'interrupted' } },
    )).not.toThrow()
  })

  it('accepts inherited repair boundaries before the end-seed that clears a standalone orphan', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    /** 中文说明：测试局部值 source，由紧邻初始化决定。 */
    const source = Session.create(SessionId('stale-repaired-compaction-source'))
    source.append('compaction/start', { compactionId: TEST_COMPACTION_ID, turn: null })
    startTurn(source)
    source.append('turn/end', { turn: 1, reason: { kind: 'interrupted' } })
    /** 中文说明：测试局部值 replayed，由紧邻初始化决定。 */
    const replayed = ctx.sessions.create(SessionId('stale-repaired-compaction-replay'), {
      seed: source.snapshotEvents(),
    })
    expect(replayed.snapshotEvents().map(event => event.type)).toEqual([
      'compaction/start',
      'turn/start',
      'turn/end',
      'session/end-seed',
    ])

    await ctx.plugin(InvariantRegistry)
    await expect(ctx.plugin(CompactionInvariant).then(() => undefined)).resolves.toBeUndefined()

    expect(() => {
      startTurn(replayed, 2)
      replayed.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
    }).not.toThrow()
  })

  it('rejects a closed standalone bracket that contains a turn before end-seed', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    /** 中文说明：测试局部值 source，由紧邻初始化决定。 */
    const source = Session.create(SessionId('closed-nested-compaction-source'))
    source.append('compaction/start', { compactionId: TEST_COMPACTION_ID, turn: null })
    startTurn(source)
    source.append('turn/end', { turn: 1, reason: { kind: 'interrupted' } })
    source.append('compaction/end', { compactionId: TEST_COMPACTION_ID, turn: null, error: 'failed after crossing turn' })
    /** 中文说明：测试局部值 replayed，由紧邻初始化决定。 */
    const replayed = ctx.sessions.create(SessionId('closed-nested-compaction-replay'), {
      seed: source.snapshotEvents(),
    })
    expect(replayed.snapshotEvents().at(-1)?.type).toBe('session/end-seed')

    await ctx.plugin(InvariantRegistry)
    await expect(ctx.plugin(CompactionInvariant).then(() => undefined))
      .rejects.toThrow(/turn\/start cannot cross an open standalone compaction/)
  })

  it('rebuilds an open trace when the companion loads after the session', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = ctx.sessions.create()
    session.append('turn/start', { turn: 1 })
    session.append('compaction/start', { compactionId: TEST_COMPACTION_ID, turn: 1 })
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(CompactionInvariant)
    expect(() => session.append('compaction/end', {
      compactionId: TEST_COMPACTION_ID,
      turn: 1,
      error: 'resume failed',
    })).not.toThrow()
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  })

  it('adopts a bare session and ignores unrelated committed events', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = Session.create(SessionId('bare-compaction-session'))
    expect(() => {
      ctx.emit('session/event', session, {
        type: 'turn/start', seq: SessionSeq(0), time: 0,
        data: { turn: 1 },
      })
      ctx.emit('session/event', session, {
        type: 'step/start', seq: SessionSeq(1), time: 1, data: { turn: 1, step: 1 },
      })
      ctx.emit('session/event', session, {
        type: 'compaction/start', seq: SessionSeq(2), time: 2,
        data: { compactionId: TEST_COMPACTION_ID, turn: 1 },
      })
    }).not.toThrow()
  })

  it('rejects compaction outside or for a different open turn', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = ctx.sessions.create()
    expect(() => session.append('compaction/start', { compactionId: TEST_COMPACTION_ID, turn: 1 }))
      .toThrow(/outside any open turn/)
    startTurn(session)
    expect(() => session.append('compaction/start', { compactionId: TEST_COMPACTION_ID, turn: 2 }))
      .toThrow(/but open turn is 1/)
  })

  it('rejects a standalone bracket while a turn is open and a numbered bracket between turns', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 open，由紧邻初始化决定。 */
    const open = ctx.sessions.create()
    startTurn(open)
    expect(() => open.append('compaction/start', { compactionId: TEST_COMPACTION_ID, turn: null }))
      .toThrow(/standalone but turn 1 is open/)

    /** 中文说明：测试局部值 idle，由紧邻初始化决定。 */
    const idle = ctx.sessions.create()
    expect(() => idle.append('compaction/start', { compactionId: TEST_COMPACTION_ID, turn: 1 }))
      .toThrow(/outside any open turn/)
  })

  it('attributes a nested standalone start to the standalone owner', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = ctx.sessions.create()
    session.append('compaction/start', { compactionId: TEST_COMPACTION_ID, turn: null })
    expect(() => session.append('compaction/start', { compactionId: NEXT_COMPACTION_ID, turn: null }))
      .toThrow(/standalone compaction is still compacting/)
  })

  it('rejects an unenclosed compaction event when replaying an existing session', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = ctx.sessions.create()
    startTurn(session)
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    session.append('compaction/start', { compactionId: TEST_COMPACTION_ID, turn: 1 })
    await ctx.plugin(InvariantRegistry)
    await expect(ctx.plugin(CompactionInvariant).then(() => undefined)).rejects.toThrow(/outside any open turn/)
  })

  it('rejects turn boundaries that cross live standalone or numbered compaction brackets', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 standalone，由紧邻初始化决定。 */
    const standalone = ctx.sessions.create()
    standalone.append('compaction/start', { compactionId: TEST_COMPACTION_ID, turn: null })
    expect(() => { startTurn(standalone) })
      .toThrow(/turn\/start cannot cross an open standalone compaction/)
    standalone.append('compaction/end', { compactionId: TEST_COMPACTION_ID, turn: null, error: 'cancelled' })
    expect(() => {
      startTurn(standalone)
      standalone.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    }).not.toThrow()

    /** 中文说明：测试局部值 numbered，由紧邻初始化决定。 */
    const numbered = ctx.sessions.create()
    startTurn(numbered)
    numbered.append('compaction/start', { compactionId: TEST_COMPACTION_ID, turn: 1 })
    expect(() => numbered.append(
      'turn/end',
      { turn: 1, reason: { kind: 'completed' } },
    )).toThrow(/turn\/end cannot cross an open compaction for turn 1/)
    numbered.append('compaction/end', { compactionId: TEST_COMPACTION_ID, turn: 1, error: 'cancelled' })
    expect(() => numbered.append(
      'turn/end',
      { turn: 1, reason: { kind: 'completed' } },
    )).not.toThrow()
  })

  it('rejects a replacement checkpoint for another compaction transaction', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = ctx.sessions.create()
    /** 中文说明：测试局部值 original，由紧邻初始化决定。 */
    const original = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'original' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    startTurn(session)
    session.append('compaction/start', { compactionId: TEST_COMPACTION_ID, turn: 1 })
    session.append('compaction/summary', summary(session))

    expect(() => session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'checkpoint' }],
      source: compactCheckpointSource(NEXT_COMPACTION_ID),
    }), {
      surfaceOp: { op: 'replace', start: original.seq, end: original.seq },
      sourceEventSeqs: [original.seq],
    })).toThrow(/compaction checkpoint id .* does not match compaction\/start id/)
  })

  it('requires checkpoint provenance to name an open transaction', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 withoutStart，由紧邻初始化决定。 */
    const withoutStart = ctx.sessions.create()
    /** 中文说明：测试局部值 original，由紧邻初始化决定。 */
    const original = withoutStart.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'original' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    expect(() => withoutStart.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'checkpoint' }],
      source: compactCheckpointSource(TEST_COMPACTION_ID),
    }), {
      surfaceOp: { op: 'replace', start: original.seq, end: original.seq },
      sourceEventSeqs: [original.seq],
    })).toThrow(/no matching compaction\/start/)

    /** 中文说明：测试局部值 emptyCommand，由紧邻初始化决定。 */
    const emptyCommand = ctx.sessions.create()
    /** 中文说明：测试局部值 replaced，由紧邻初始化决定。 */
    const replaced = emptyCommand.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'original' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    startTurn(emptyCommand)
    emptyCommand.append('compaction/start', { compactionId: TEST_COMPACTION_ID, turn: 1 })
    expect(() => emptyCommand.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'checkpoint' }],
      source: compactCheckpointSource(TEST_COMPACTION_ID, CommandId('')),
    }), {
      surfaceOp: { op: 'replace', start: replaced.seq, end: replaced.seq },
      sourceEventSeqs: [replaced.seq],
    })).toThrow(/checkpoint sourceCommandId must be a non-empty string/)
  })

  it.each([
    ['empty start id', (session: ReturnType<Context['sessions']['create']>) => {
      session.append('compaction/start', { compactionId: CompactionId(''), turn: 1 })
    }, /compaction\/start compactionId must be a non-empty string/],
    ['empty start source command id', (session: ReturnType<Context['sessions']['create']>) => {
      session.append('compaction/start', {
        compactionId: TEST_COMPACTION_ID,
        sourceCommandId: CommandId(''),
        turn: 1,
      })
    }, /compaction\/start sourceCommandId must be a non-empty string/],
    ['summary without start', (session: ReturnType<Context['sessions']['create']>) => {
      session.append('compaction/summary', summary(session))
    }, /no matching compaction\/start/],
    ['nested start', (session: ReturnType<Context['sessions']['create']>) => {
      session.append('compaction/start', { compactionId: TEST_COMPACTION_ID, turn: 1 })
      session.append('compaction/start', { compactionId: NEXT_COMPACTION_ID, turn: 2 })
    }, /still compacting/],
    ['repeated summary', (session: ReturnType<Context['sessions']['create']>) => {
      session.append('compaction/start', { compactionId: TEST_COMPACTION_ID, turn: 1 })
      session.append('compaction/summary', summary(session))
      session.append('compaction/summary', summary(session))
    }, /repeated within one compaction/],
    ['summary for another compaction', (session: ReturnType<Context['sessions']['create']>) => {
      session.append('compaction/start', { compactionId: TEST_COMPACTION_ID, turn: 1 })
      session.append('compaction/summary', summary(session, { compactionId: NEXT_COMPACTION_ID }))
    }, /compaction\/summary id .* does not match compaction\/start id/],
    ['summary for another source command', (session: ReturnType<Context['sessions']['create']>) => {
      session.append('compaction/start', {
        compactionId: TEST_COMPACTION_ID,
        sourceCommandId: TEST_COMMAND_ID,
        turn: 1,
      })
      session.append('compaction/summary', summary(session, { sourceCommandId: NEXT_COMMAND_ID }))
    }, /compaction\/summary sourceCommandId .* does not match compaction\/start sourceCommandId/],
    ['empty shadow set', (session: ReturnType<Context['sessions']['create']>) => {
      session.append('compaction/start', { compactionId: TEST_COMPACTION_ID, turn: 1 })
      session.append('compaction/summary', summary(session, { shadowedSeqs: [] }))
    }, /shadowedSeqs must be non-empty/],
    ['wrong endpoints', (session: ReturnType<Context['sessions']['create']>) => {
      session.append('compaction/start', { compactionId: TEST_COMPACTION_ID, turn: 1 })
      session.append('compaction/summary', summary(session, { shadowedRange: { start: 1, end: 4 } }))
    }, /shadowedRange must match/],
    ['non-numeric shadow seq', (session: ReturnType<Context['sessions']['create']>) => {
      session.append('compaction/start', { compactionId: TEST_COMPACTION_ID, turn: 1 })
      session.append('compaction/summary', summary(session, {
        shadowedRange: { start: 'bad', end: 'bad' }, shadowedSeqs: ['bad'],
      }))
    }, /non-negative safe integer event seq/],
    ['negative shadow seq', (session: ReturnType<Context['sessions']['create']>) => {
      session.append('compaction/start', { compactionId: TEST_COMPACTION_ID, turn: 1 })
      session.append('compaction/summary', summary(session, {
        shadowedRange: { start: -1, end: -1 }, shadowedSeqs: [-1],
      }))
    }, /non-negative safe integer event seq/],
    ['invalid token count', (session: ReturnType<Context['sessions']['create']>) => {
      session.append('compaction/start', { compactionId: TEST_COMPACTION_ID, turn: 1 })
      session.append('compaction/summary', summary(session, { shadowedTokenCount: -1 }))
    }, /non-negative safe integer/],
    ['end without start', (session: ReturnType<Context['sessions']['create']>) => {
      session.append('compaction/end', { compactionId: TEST_COMPACTION_ID, turn: 1, error: 'failed' })
    }, /no matching compaction\/start/],
    ['wrong end turn', (session: ReturnType<Context['sessions']['create']>) => {
      session.append('compaction/start', { compactionId: TEST_COMPACTION_ID, turn: 1 })
      session.append('compaction/end', { compactionId: TEST_COMPACTION_ID, turn: 2, error: 'failed' })
    }, /does not match/],
    ['end for another compaction', (session: ReturnType<Context['sessions']['create']>) => {
      session.append('compaction/start', { compactionId: TEST_COMPACTION_ID, turn: 1 })
      session.append('compaction/end', { compactionId: NEXT_COMPACTION_ID, turn: 1, error: 'failed' })
    }, /compaction\/end id .* does not match compaction\/start id/],
    ['end missing the source command', (session: ReturnType<Context['sessions']['create']>) => {
      session.append('compaction/start', {
        compactionId: TEST_COMPACTION_ID,
        sourceCommandId: TEST_COMMAND_ID,
        turn: 1,
      })
      session.append('compaction/end', { compactionId: TEST_COMPACTION_ID, turn: 1, error: 'failed' })
    }, /compaction\/end sourceCommandId .* does not match compaction\/start sourceCommandId/],
    ['empty end source command id', (session: ReturnType<Context['sessions']['create']>) => {
      session.append('compaction/start', {
        compactionId: TEST_COMPACTION_ID,
        sourceCommandId: TEST_COMMAND_ID,
        turn: 1,
      })
      session.append('compaction/end', {
        compactionId: TEST_COMPACTION_ID,
        sourceCommandId: CommandId(''),
        turn: 1,
        error: 'failed',
      })
    }, /compaction\/end sourceCommandId must be a non-empty string/],
    ['success without summary', (session: ReturnType<Context['sessions']['create']>) => {
      session.append('compaction/start', { compactionId: TEST_COMPACTION_ID, turn: 1 })
      session.append('compaction/end', { compactionId: TEST_COMPACTION_ID, turn: 1 })
    }, /requires one compaction\/summary/],
  ])('rejects %s', async (_name, action, message) => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = ctx.sessions.create()
    startTurn(session)
    expect(() => { action(session) }).toThrow(message)
  })
})
