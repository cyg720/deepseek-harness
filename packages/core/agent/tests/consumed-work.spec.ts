/**
 * 文件职责：验证Agent 服务的 consumed-work.spec.ts 行为与不变量。
 * 技术维度：Vitest、Cordis、会话事件、模型适配器和可控工具夹具。
 * 产品维度：防止Agent 服务在取消、恢复、错误或并发场景中产生回归。
 * 逻辑维度：构造服务与事件，驱动执行流程，再断言日志、请求、状态和清理。
 * 关键边界：测试后台任务必须结束；模型可见输入必须可从日志重建；工具调用顺序不可破坏。
 * 新手阅读建议：先读 mock/辅助函数，再按成功、错误、恢复和生命周期场景阅读。
 */
import { describe, expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { TurnEndReason } from '@deepseek-ai/dsh-session'
import { foldConsumedWork } from '@deepseek-ai/dsh-agent'

/** One pending message, as the inbox records it. */
/* 中文说明：测试辅助函数 message 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
function message(text: string) {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

/** Log an accepted message the way `Inbox.append()` does. */
/* 中文说明：测试辅助函数 accept 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
function accept(session: Session, text: string): void {
  session.append('agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [message(text)] })
}

/** Log the step-boundary read of one pending message, as `Inbox.claim()` does. */
/* 中文说明：测试辅助函数 claim 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
function claim(session: Session): void {
  session.append('agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 1, inserted: [] })
}

/** Log a cancellation of one pending message, as `Inbox.clear()` does. */
/* 中文说明：测试辅助函数 cancelPending 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
function cancelPending(session: Session): void {
  session.append('agent/inbox/spliced', {
    target: 'next-turn', start: 0, removedCount: 1, inserted: [], outcome: 'canceled',
  })
}

/** Run one whole turn that reached a model step. */
/* 中文说明：测试辅助函数 steppedTurn 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
function steppedTurn(session: Session, turn: number, reason: TurnEndReason): void {
  session.append('turn/start', { turn })
  claim(session)
  session.append('step/start', { turn, step: 1 })
  session.append('step/end', { turn, step: 1 })
  session.append('turn/end', { turn, reason })
}

describe('foldConsumedWork', () => {
  it('reports nothing for a log that consumed no work', () => {
    /** 中文说明：测试局部值 session，由紧邻初始化决定，仅在当前场景使用。 */
    const session = Session.create(SessionId('empty'))
    accept(session, 'queued')

    expect(foldConsumedWork(session.snapshotEvents())).toEqual({ droppedUnrun: false })
  })

  it('reports the latest turn that entered a model step', () => {
    /** 中文说明：测试局部值 session，由紧邻初始化决定，仅在当前场景使用。 */
    const session = Session.create(SessionId('stepped'))
    steppedTurn(session, 1, { kind: 'completed' })
    steppedTurn(session, 2, { kind: 'max-tokens' })

    expect(foldConsumedWork(session.snapshotEvents()).end?.data)
      .toEqual({ turn: 2, reason: { kind: 'max-tokens' } })
  })

  it('reports a turn that claimed its input and then failed before any step', () => {
    /** 中文说明：测试局部值 session，由紧邻初始化决定，仅在当前场景使用。 */
    const session = Session.create(SessionId('failed-claim'))
    steppedTurn(session, 1, { kind: 'completed' })
    // The step boundary runs the durability checkpoint and prompt assembly, so a
    // turn can take its input and then fail without entering a step.
    session.append('turn/start', { turn: 2 })
    claim(session)
    session.append('turn/end', { turn: 2, reason: { kind: 'error', error: { message: 'ENOSPC', code: 'UNKNOWN' } } })

    expect(foldConsumedWork(session.snapshotEvents()).end?.data.turn).toBe(2)
  })

  it('reports a turn that claimed its input and was then stopped before any step', () => {
    /** 中文说明：测试局部值 session，由紧邻初始化决定，仅在当前场景使用。 */
    const session = Session.create(SessionId('stopped-claim'))
    steppedTurn(session, 1, { kind: 'completed' })
    session.append('turn/start', { turn: 2 })
    claim(session)
    session.append('turn/end', { turn: 2, reason: { kind: 'aborted', reason: { kind: 'user' } } })

    expect(foldConsumedWork(session.snapshotEvents()).end?.data.turn).toBe(2)
  })

  it('ignores a turn stopped, failed, or rejected without taking any input', () => {
    /** 中文说明：测试局部值 session，由紧邻初始化决定，仅在当前场景使用。 */
    const session = Session.create(SessionId('no-claim'))
    steppedTurn(session, 1, { kind: 'completed' })
    session.append('turn/start', { turn: 2 })
    session.append('turn/end', { turn: 2, reason: { kind: 'aborted', reason: { kind: 'parent' } } })
    session.append('turn/start', { turn: 3 })
    session.append('turn/end', { turn: 3, reason: { kind: 'error', error: { message: 'x', code: 'UNKNOWN' } } })
    session.append('turn/start', { turn: 4 })
    session.append('turn/end', { turn: 4, reason: { kind: 'blocked' } })

    // None of these turns describes work: they opened, found nothing of their own, and closed.
    expect(foldConsumedWork(session.snapshotEvents()).end?.data.turn).toBe(1)
  })

  it('reports a turn whose claimed input a pre-step rejection discarded', () => {
    /** 中文说明：测试局部值 session，由紧邻初始化决定，仅在当前场景使用。 */
    const session = Session.create(SessionId('rejected-claim'))
    steppedTurn(session, 1, { kind: 'completed' })
    session.append('turn/start', { turn: 2 })
    claim(session)
    session.append('turn/end', { turn: 2, reason: { kind: 'blocked' } })

    // Rejection does not retain the claimed messages, so the `blocked` end is
    // the only account of input that will never run.
    expect(foldConsumedWork(session.snapshotEvents()).end?.data.turn).toBe(2)
  })

  it('ignores a claim its own turn emptied', () => {
    /** 中文说明：测试局部值 session，由紧邻初始化决定，仅在当前场景使用。 */
    const session = Session.create(SessionId('emptied-claim'))
    steppedTurn(session, 1, { kind: 'completed' })
    session.append('turn/start', { turn: 2 })
    claim(session)
    session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })

    // An emptied claim ran nothing and dropped nothing: a listener rewrote the
    // batch away, which is not this log's account of the work.
    expect(foldConsumedWork(session.snapshotEvents()).end?.data.turn).toBe(1)
  })

  it('credits a claim with no open turn to no turn at all', () => {
    /** 中文说明：测试局部值 session，由紧邻初始化决定，仅在当前场景使用。 */
    const session = Session.create(SessionId('mid-turn-suffix'))
    steppedTurn(session, 1, { kind: 'completed' })
    // An owned suffix can begin inside a turn whose start it does not contain,
    // so a claim may appear with no turn to attribute it to.
    claim(session)
    session.append('turn/end', { turn: 2, reason: { kind: 'aborted', reason: { kind: 'user' } } })

    expect(foldConsumedWork(session.snapshotEvents()).end?.data.turn).toBe(1)
  })

  it('reports work cancelled out of the inbox after the last accounting turn', () => {
    /** 中文说明：测试局部值 session，由紧邻初始化决定，仅在当前场景使用。 */
    const session = Session.create(SessionId('dropped'))
    steppedTurn(session, 1, { kind: 'completed' })
    accept(session, 'never runs')
    cancelPending(session)

    // No turn opened over it, so only the cancellation says the work was cut short.
    expect(foldConsumedWork(session.snapshotEvents())).toEqual({
      end: session.snapshotEvents().find(event => event.type === 'turn/end'),
      droppedUnrun: true,
    })
  })

  it('keeps a replacement pending rather than counting it as dropped', () => {
    /** 中文说明：测试局部值 session，由紧邻初始化决定，仅在当前场景使用。 */
    const session = Session.create(SessionId('replaced'))
    steppedTurn(session, 1, { kind: 'completed' })
    session.append('agent/inbox/spliced', {
      target: 'next-turn', start: 0, removedCount: 1, inserted: [message('rewritten')], outcome: 'canceled',
    })

    expect(foldConsumedWork(session.snapshotEvents()).droppedUnrun).toBe(false)
  })

  it('lets a later accounting turn absorb an earlier drop', () => {
    /** 中文说明：测试局部值 session，由紧邻初始化决定，仅在当前场景使用。 */
    const session = Session.create(SessionId('absorbed'))
    steppedTurn(session, 1, { kind: 'completed' })
    cancelPending(session)
    steppedTurn(session, 2, { kind: 'completed' })

    expect(foldConsumedWork(session.snapshotEvents())).toEqual({
      end: session.snapshotEvents().findLast(event => event.type === 'turn/end'),
      droppedUnrun: false,
    })
  })
})
