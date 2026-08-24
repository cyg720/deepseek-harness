/**
 * InputMachine unit account: the submit
 * plane (adjudication, span CAS, drift
 * guard, anti-backwash), plus the occurrence table (shift / whole-chip
 * deletion / same-name independence), the self-managed undo log (typing
 * coalescing, paste two-stage undo, redo chain), consume-token guards, the
 * paste attempt lifecycle, projectClipboard, and the decoration projection.
 * Pure event sequences — no React, no DOM, no ambient clock.
 */
/**
 * 文件职责：验证会话输入的 input-machine.client.spec.ts 行为。
 * 技术维度：Vitest、React 渲染、事件模拟和服务替身。
 * 产品维度：防止会话输入用户流程回归。
 * 逻辑维度：构造状态，触发行为并断言结果和清理。
 * 关键边界：异步任务、全局替身和 DOM 必须在用例后恢复。
 * 新手阅读建议：先读辅助函数，再按场景顺序阅读。
 */
import { describe, expect, it } from 'vitest'
import type { CommandClaim, ReferenceInsert, TokenSpan } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { InputEffect, SubmitAttempt } from '../src/client/input/contract.ts'
import {
  InputMachine, PLACEHOLDER, projectClipboard, referenceDraftText,
} from '../src/client/input/machine.ts'
import { deriveDecorations, scanTextRefs } from '../src/client/input/decorations.ts'

/** 中文说明：测试局部值 LEGACY_PLACEHOLDER，由紧邻初始化决定。 */
const LEGACY_PLACEHOLDER = PLACEHOLDER

/** 中文说明：函数 claimOf 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function claimOf(name: string, hint?: string): CommandClaim {
  return {
    token: `/${name} `,
    ...(hint !== undefined ? { hint } : {}),
    submit: async () => ({ kind: 'success' }),
  }
}

/** 中文说明：函数 refOf 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function refOf(name: string, source = 'skill'): ReferenceInsert {
  return { source, ref: name, label: name, clipboardText: `/${name}` }
}

/** 中文说明：函数 spanOf 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function spanOf(m: InputMachine, start: number, end: number): TokenSpan {
  return { start, end, draftRev: m.state.draftRev }
}

/** 中文说明：函数 effectAt 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function effectAt<T extends InputEffect['type']>(
  effects: readonly InputEffect[], index: number, type: T,
): Extract<InputEffect, { type: T }> {
  /** 中文说明：测试局部值 e，由紧邻初始化决定。 */
  const e = effects[index]
  expect(e?.type).toBe(type)
  return e as Extract<InputEffect, { type: T }>
}

/** Drive plain → adjudicating and hand back the minted attempt. */
/** 中文说明：函数 enterAdjudicating 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function enterAdjudicating(m: InputMachine, draft: string, mode: 'queue' | 'steer' = 'queue'): SubmitAttempt {
  m.dispatch({ type: 'draft-changed', draft })
  /** 中文说明：测试局部值 fx，由紧邻初始化决定。 */
  const fx = m.dispatch({ type: 'enter', mode })
  return effectAt(fx, 0, 'adjudicate').attempt
}

/** Drive plain → claimed → submitting and hand back attempt + claim. */
/** 中文说明：函数 enterSubmitting 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function enterSubmitting(m: InputMachine, name: string, args: string): { attempt: SubmitAttempt; claim: CommandClaim } {
  /** 中文说明：测试局部值 claim，由紧邻初始化决定。 */
  const claim = claimOf(name)
  m.dispatch({ type: 'draft-changed', draft: `/${name.slice(0, 2)}` })
  m.dispatch({ type: 'begin-command', claim, span: spanOf(m, 0, m.state.draft.length) })
  m.dispatch({ type: 'draft-changed', draft: claim.token + args })
  /** 中文说明：测试局部值 fx，由紧邻初始化决定。 */
  const fx = m.dispatch({ type: 'enter', mode: 'queue' })
  return { attempt: effectAt(fx, 0, 'begin-submit').attempt, claim }
}

/** 中文说明：函数 staleAttempt 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function staleAttempt(): SubmitAttempt {
  return { seq: 9999, signal: new AbortController().signal, draftSnapshot: '', mode: 'queue' }
}

describe('input-machine: plain × enter', () => {
  it('empty and whitespace-only drafts produce nothing', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    expect(m.dispatch({ type: 'enter', mode: 'queue' })).toEqual([])
    m.dispatch({ type: 'draft-changed', draft: '  \n ' })
    expect(m.dispatch({ type: 'enter', mode: 'queue' })).toEqual([])
    expect(m.state.phase).toBe('plain')
  })

  it('non-command text falls to the default sink', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: 'hello world' })
    /** 中文说明：测试局部值 effect，由紧邻初始化决定。 */
    const effect = effectAt(m.dispatch({ type: 'enter', mode: 'queue' }), 0, 'default-sink')
    expect(effect).toMatchObject({ draft: 'hello world', mode: 'queue' })
    expect(effect.attempt.draftSnapshot).toBe('hello world')
    expect(m.state.phase).toBe('submitting')
  })

  it('retains an explicit steer mode on the default sink effect', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: 'steer now' })
    expect(effectAt(m.dispatch({ type: 'enter', mode: 'steer' }), 0, 'default-sink'))
      .toMatchObject({ draft: 'steer now', mode: 'steer' })
  })

  it('leading "/" enters adjudicating with a minted attempt carrying the draft snapshot', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: '/goal x' })
    /** 中文说明：测试局部值 fx，由紧邻初始化决定。 */
    const fx = m.dispatch({ type: 'enter', mode: 'queue' })
    /** 中文说明：测试局部值 eff，由紧邻初始化决定。 */
    const eff = effectAt(fx, 0, 'adjudicate')
    expect(eff.draft).toBe('/goal x')
    expect(eff.attempt.draftSnapshot).toBe('/goal x')
    expect(eff.attempt.signal.aborted).toBe(false)
    expect(m.state.phase).toBe('adjudicating')
  })

  it('leading is judged after trim including newlines', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: '\n\n/goal x' })
    expect(m.dispatch({ type: 'enter', mode: 'queue' })[0]?.type).toBe('adjudicate')
  })

  it('a non-whitespace prefix before "/" is not leading — default sink', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: '第一行\n/goal x' })
    expect(effectAt(m.dispatch({ type: 'enter', mode: 'queue' }), 0, 'default-sink'))
      .toMatchObject({ draft: '第一行\n/goal x', mode: 'queue' })
  })
})

describe('input-machine: adjudication outcomes', () => {
  it('{claim} moves to submitting; args split on the first whitespace, newlines kept', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    /** 中文说明：测试局部值 attempt，由紧邻初始化决定。 */
    const attempt = enterAdjudicating(m, '/goal x\ny')
    /** 中文说明：测试局部值 fx，由紧邻初始化决定。 */
    const fx = m.dispatch({ type: 'adjudicated', attempt, outcome: { claim: claimOf('goal') } })
    /** 中文说明：测试局部值 eff，由紧邻初始化决定。 */
    const eff = effectAt(fx, 0, 'begin-submit')
    expect(eff.args).toBe('x\ny')
    expect(eff.attempt.seq).toBe(attempt.seq)
    expect(m.state.phase).toBe('submitting')
    expect(m.state.claim).toEqual({ token: '/goal ' })
  })

  it('bare "/goal" claim yields empty args; leading whitespace snapshot yields trimmed args', () => {
    /** 中文说明：测试局部值 a，由紧邻初始化决定。 */
    const a = new InputMachine()
    /** 中文说明：测试局部值 attemptA，由紧邻初始化决定。 */
    const attemptA = enterAdjudicating(a, '/goal')
    expect(effectAt(a.dispatch({ type: 'adjudicated', attempt: attemptA, outcome: { claim: claimOf('goal') } }), 0, 'begin-submit').args).toBe('')

    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = new InputMachine()
    /** 中文说明：测试局部值 attemptB，由紧邻初始化决定。 */
    const attemptB = enterAdjudicating(b, '\n\n/goal x')
    expect(effectAt(b.dispatch({ type: 'adjudicated', attempt: attemptB, outcome: { claim: claimOf('goal') } }), 0, 'begin-submit').args).toBe('x')
  })

  it('undefined outcome falls back to the default sink', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    /** 中文说明：测试局部值 attempt，由紧邻初始化决定。 */
    const attempt = enterAdjudicating(m, '/unknown thing', 'steer')
    expect(effectAt(
      m.dispatch({ type: 'adjudicated', attempt, outcome: undefined }),
      0,
      'default-sink',
    )).toMatchObject({ attempt, draft: '/unknown thing', mode: 'steer' })
    expect(m.state.phase).toBe('submitting')
  })

  it("'handled' lands plain with zero effects (popup shell path)", () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    /** 中文说明：测试局部值 attempt，由紧邻初始化决定。 */
    const attempt = enterAdjudicating(m, '/model')
    expect(m.dispatch({ type: 'adjudicated', attempt, outcome: 'handled' })).toEqual([])
    expect(m.state.phase).toBe('plain')
    expect(m.state.draft).toBe('/model')
  })

  it('adjudication failure notices and keeps the draft — no silent downgrade', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    /** 中文说明：测试局部值 attempt，由紧邻初始化决定。 */
    const attempt = enterAdjudicating(m, '/goal x')
    expect(m.dispatch({ type: 'adjudication-failed', attempt, message: 'warmup failed' }))
      .toEqual([{ type: 'notice', level: 'error', text: 'warmup failed' }])
    expect(m.state.phase).toBe('plain')
    expect(m.state.draft).toBe('/goal x')
  })

  it('enter is a no-op while adjudicating (pending lock)', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    enterAdjudicating(m, '/goal x')
    expect(m.dispatch({ type: 'enter', mode: 'queue' })).toEqual([])
    expect(m.state.phase).toBe('adjudicating')
  })

  it('a stale attempt on adjudicated/adjudication-failed is dropped: same state, zero effects', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    enterAdjudicating(m, '/goal x')
    expect(m.dispatch({ type: 'adjudicated', attempt: staleAttempt(), outcome: { claim: claimOf('goal') } })).toEqual([])
    expect(m.dispatch({ type: 'adjudication-failed', attempt: staleAttempt(), message: 'x' })).toEqual([])
    expect(m.state.phase).toBe('adjudicating')
  })

  it('an adjudicated result arriving after release is dropped (anti-backwash)', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    /** 中文说明：测试局部值 attempt，由紧邻初始化决定。 */
    const attempt = enterAdjudicating(m, '/goal x')
    m.dispatch({ type: 'release' })
    expect(m.dispatch({ type: 'adjudicated', attempt, outcome: { claim: claimOf('goal') } })).toEqual([])
    expect(m.state.phase).toBe('plain')
  })
})

describe('input-machine: begin-command CAS', () => {
  it('valid span replaces it with the token and enters claimed; success = draftRev advance', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: '/go' })
    /** 中文说明：测试局部值 before，由紧邻初始化决定。 */
    const before = m.state.draftRev
    /** 中文说明：测试局部值 fx，由紧邻初始化决定。 */
    const fx = m.dispatch({ type: 'begin-command', claim: claimOf('goal', 'objective'), span: spanOf(m, 0, 3) })
    expect(fx).toEqual([])
    expect(m.state.draftRev).toBeGreaterThan(before)
    expect(m.state.draft).toBe('/goal ')
    expect(m.state.phase).toBe('claimed')
    expect(m.state.claim).toEqual({ token: '/goal ', hint: 'objective' })
  })

  it('a leading-whitespace prefix is dropped so the startsWith watch holds', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: '\n\n/go' })
    m.dispatch({ type: 'begin-command', claim: claimOf('goal'), span: spanOf(m, 2, 5) })
    expect(m.state.draft).toBe('/goal ')
    m.dispatch({ type: 'draft-changed', draft: '/goal x' })
    expect(m.state.phase).toBe('claimed')
  })

  it('a stale draftRev no-ops the whole action — no state change, no revision bump', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: '/go' })
    /** 中文说明：测试局部值 span，由紧邻初始化决定。 */
    const span = spanOf(m, 0, 3)
    m.dispatch({ type: 'draft-changed', draft: '/goX' })
    /** 中文说明：测试局部值 rev，由紧邻初始化决定。 */
    const rev = m.state.draftRev
    expect(m.dispatch({ type: 'begin-command', claim: claimOf('goal'), span })).toEqual([])
    expect(m.state).toMatchObject({ phase: 'plain', draft: '/goX', draftRev: rev })
  })

  it('a non-whitespace prefix before the span no-ops (leading-trigger contract)', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: 'x /go' })
    expect(m.dispatch({ type: 'begin-command', claim: claimOf('goal'), span: spanOf(m, 2, 5) })).toEqual([])
    expect(m.state.phase).toBe('plain')
  })

  it('claimed overwrites in place — no stack', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: '/go' })
    m.dispatch({ type: 'begin-command', claim: claimOf('goal'), span: spanOf(m, 0, 3) })
    m.dispatch({ type: 'begin-command', claim: claimOf('model'), span: spanOf(m, 0, 6) })
    expect(m.state.draft).toBe('/model ')
    expect(m.state.claim?.token).toBe('/model ')
    expect(m.state.phase).toBe('claimed')
  })

  it('submitting rejects begin-command (lock)', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    enterSubmitting(m, 'goal', 'x')
    expect(m.dispatch({ type: 'begin-command', claim: claimOf('model'), span: spanOf(m, 0, 6) })).toEqual([])
    expect(m.state.claim?.token).toBe('/goal ')
    expect(m.state.phase).toBe('submitting')
  })

  it('undo reverts the claim transaction and the watch releases the claim', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: '/go' })
    m.dispatch({ type: 'begin-command', claim: claimOf('goal'), span: spanOf(m, 0, 3) })
    m.dispatch({ type: 'undo' })
    expect(m.state).toMatchObject({ draft: '/go', phase: 'plain' })
    expect(m.state.claim).toBeUndefined()
  })
})

describe('input-machine: insert-ref and the occurrence table', () => {
  it('valid span becomes one inline display range + one occurrence with cached projections', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: 'see @wor now' })
    /** 中文说明：测试局部值 reference，由紧邻初始化决定。 */
    const reference = { ...refOf('worker-1', 'reference'), appearance: 'session' as const }
    /** 中文说明：测试局部值 fx，由紧邻初始化决定。 */
    const fx = m.dispatch({
      type: 'insert-ref',
      reference,
      span: spanOf(m, 4, 8),
    })
    expect(fx).toEqual([])
    /** 中文说明：测试局部值 displayText，由紧邻初始化决定。 */
    const displayText = referenceDraftText(reference)
    expect(m.state.draft).toBe(`see ${displayText} now`)
    expect(m.state.occurrences).toEqual([{
      occurrenceId: 1, source: 'reference', ref: 'worker-1', offset: 4,
      length: displayText.length,
      label: 'worker-1', appearance: 'session', clipboardText: '/worker-1',
    }])
    expect(m.state.phase).toBe('plain')
  })

  it('same-named references stay independent: distinct occurrenceIds, one deletion leaves the other', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: '/alp' })
    m.dispatch({ type: 'insert-ref', reference: refOf('alpha'), span: spanOf(m, 0, 4) })
    /** 中文说明：测试局部值 displayText，由紧邻初始化决定。 */
    const displayText = referenceDraftText(refOf('alpha'))
    /** 中文说明：测试局部值 secondDraft，由紧邻初始化决定。 */
    const secondDraft = `${displayText} and /alp`
    /** 中文说明：测试局部值 secondStart，由紧邻初始化决定。 */
    const secondStart = secondDraft.lastIndexOf('/alp')
    m.dispatch({
      type: 'draft-changed',
      draft: secondDraft,
      editRange: { start: displayText.length, end: displayText.length + 1, insertedLength: ' and /alp'.length },
    })
    m.dispatch({ type: 'insert-ref', reference: refOf('alpha'), span: spanOf(m, secondStart, secondStart + 4) })
    expect(m.state.draft).toBe(`${displayText} and ${displayText} `)
    expect(m.state.occurrences.map(o => o.occurrenceId)).toEqual([1, 2])
    // Delete the first reference range whole; the second survives with its own identity.
    m.dispatch({
      type: 'draft-changed',
      draft: ` and ${displayText} `,
      editRange: { start: 0, end: displayText.length, insertedLength: 0 },
    })
    expect(m.state.occurrences).toEqual([expect.objectContaining({ occurrenceId: 2, offset: 5 })])
  })

  it('claimed stays claimed across an inline insert (inline "@" during command args)', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: '/go' })
    m.dispatch({ type: 'begin-command', claim: claimOf('goal'), span: spanOf(m, 0, 3) })
    m.dispatch({ type: 'draft-changed', draft: '/goal ask @wor' })
    m.dispatch({ type: 'insert-ref', reference: refOf('worker-1', 'subagent'), span: spanOf(m, 10, 14) })
    expect(m.state.draft).toBe(`/goal ask ${referenceDraftText(refOf('worker-1'))} `)
    expect(m.state.phase).toBe('claimed')
    expect(m.state.occurrences).toHaveLength(1)
  })

  it('a stale draftRev no-ops: no draft change, no occurrence', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: 'see @wor' })
    /** 中文说明：测试局部值 span，由紧邻初始化决定。 */
    const span = spanOf(m, 4, 8)
    m.dispatch({ type: 'draft-changed', draft: 'see @work' })
    expect(m.dispatch({ type: 'insert-ref', reference: refOf('w'), span })).toEqual([])
    expect(m.state.occurrences).toEqual([])
  })
})

describe('input-machine: occurrence reconciliation on draft edits', () => {
  /** Machine with one reference range at offset 4 inside `see @worker-1 now`. */
  /** 中文说明：函数 withChip 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
  function withChip(): InputMachine {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: 'see @wor now' })
    m.dispatch({ type: 'insert-ref', reference: refOf('worker-1', 'subagent'), span: spanOf(m, 4, 8) })
    return m
  }

  it('an edit before the reference shifts the offset by the length delta (explicit editRange)', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = withChip()
    m.dispatch({ type: 'draft-changed', draft: `I ${m.state.draft}`, editRange: { start: 0, end: 0, insertedLength: 2 } })
    expect(m.state.occurrences[0]?.offset).toBe(6)
    m.dispatch({ type: 'draft-changed', draft: m.state.draft.slice(2), editRange: { start: 0, end: 2, insertedLength: 0 } })
    expect(m.state.occurrences[0]?.offset).toBe(4)
  })

  it('an edit after the reference leaves the offset alone', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = withChip()
    /** 中文说明：测试局部值 oldDraft，由紧邻初始化决定。 */
    const oldDraft = m.state.draft
    /** 中文说明：测试局部值 start，由紧邻初始化决定。 */
    const start = oldDraft.indexOf('now')
    m.dispatch({
      type: 'draft-changed',
      draft: oldDraft.replace('now', 'later'),
      editRange: { start, end: start + 3, insertedLength: 5 },
    })
    expect(m.state.occurrences[0]?.offset).toBe(4)
  })

  it('a deletion covering the reference removes the whole occurrence', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = withChip()
    /** 中文说明：测试局部值 occurrence，由紧邻初始化决定。 */
    const occurrence = m.state.occurrences[0]!
    m.dispatch({
      type: 'draft-changed',
      draft: m.state.draft.slice(0, occurrence.offset) + m.state.draft.slice(occurrence.offset + occurrence.length),
      editRange: { start: occurrence.offset, end: occurrence.offset + occurrence.length, insertedLength: 0 },
    })
    expect(m.state.occurrences).toEqual([])
    expect(m.state.draft).toBe('see  now')
  })

  it('a replacement spanning the reference removes the occurrence and keeps the replacement text', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = withChip()
    /** 中文说明：测试局部值 occurrence，由紧邻初始化决定。 */
    const occurrence = m.state.occurrences[0]!
    m.dispatch({
      type: 'draft-changed',
      draft: 'see all of it now',
      editRange: { start: occurrence.offset, end: occurrence.offset + occurrence.length, insertedLength: 9 },
    })
    expect(m.state.occurrences).toEqual([])
  })

  it('without editRange the prefix/suffix diff scan recovers the edit (shift path)', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = withChip()
    m.dispatch({ type: 'draft-changed', draft: m.state.draft.replace('see ', 'see there ') })
    expect(m.state.occurrences[0]?.offset).toBe(10)
  })

  it('without editRange the diff scan detects reference deletion', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = withChip()
    m.dispatch({ type: 'draft-changed', draft: 'see now' })
    expect(m.state.occurrences).toEqual([])
  })

  it('an identical draft is a no-op: no revision bump, no undo entry', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = withChip()
    /** 中文说明：测试局部值 rev，由紧邻初始化决定。 */
    const rev = m.state.draftRev
    expect(m.dispatch({ type: 'draft-changed', draft: m.state.draft })).toEqual([])
    expect(m.state.draftRev).toBe(rev)
  })
})

describe('input-machine: consume-token guards', () => {
  it('span guard: CAS pass deletes the token — success observable as a draftRev advance', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: '/model rest' })
    /** 中文说明：测试局部值 before，由紧邻初始化决定。 */
    const before = m.state.draftRev
    m.dispatch({ type: 'consume-token', guard: { kind: 'span', span: spanOf(m, 0, 7) } })
    expect(m.state.draftRev).toBeGreaterThan(before)
    expect(m.state.draft).toBe('rest')
    m.dispatch({ type: 'undo' })
    expect(m.state.draft).toBe('/model rest')
  })

  it('span guard: a stale draftRev refuses — no deletion, no revision bump', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: '/model' })
    /** 中文说明：测试局部值 span，由紧邻初始化决定。 */
    const span = spanOf(m, 0, 6)
    m.dispatch({ type: 'draft-changed', draft: '/model x' })
    /** 中文说明：测试局部值 rev，由紧邻初始化决定。 */
    const rev = m.state.draftRev
    expect(m.dispatch({ type: 'consume-token', guard: { kind: 'span', span } })).toEqual([])
    expect(m.state).toMatchObject({ draft: '/model x', draftRev: rev })
  })

  it('bare-token guard: trimmed equality clears the draft; mismatch refuses', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: '  /model \n' })
    m.dispatch({ type: 'consume-token', guard: { kind: 'bare-token', token: '/model' } })
    expect(m.state.draft).toBe('')
    m.dispatch({ type: 'undo' })
    expect(m.state.draft).toBe('  /model \n')

    m.dispatch({ type: 'draft-changed', draft: '/model extra' })
    /** 中文说明：测试局部值 rev，由紧邻初始化决定。 */
    const rev = m.state.draftRev
    expect(m.dispatch({ type: 'consume-token', guard: { kind: 'bare-token', token: '/model' } })).toEqual([])
    expect(m.state).toMatchObject({ draft: '/model extra', draftRev: rev })
  })

  it('a chip elsewhere in the draft shifts across a span consume', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: '/model @wor' })
    m.dispatch({ type: 'insert-ref', reference: refOf('w'), span: spanOf(m, 7, 11) })
    m.dispatch({ type: 'consume-token', guard: { kind: 'span', span: spanOf(m, 0, 7) } })
    expect(m.state.draft).toBe(`${referenceDraftText(refOf('w'))} `)
    expect(m.state.occurrences[0]?.offset).toBe(0)
  })
})

describe('input-machine: undo / redo', () => {
  it('the default constant clock coalesces contiguous single-char typing into one transaction', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: 'a', editRange: { start: 0, end: 0, insertedLength: 1 } })
    m.dispatch({ type: 'draft-changed', draft: 'ab', editRange: { start: 1, end: 1, insertedLength: 1 } })
    m.dispatch({ type: 'draft-changed', draft: 'abc', editRange: { start: 2, end: 2, insertedLength: 1 } })
    m.dispatch({ type: 'undo' })
    expect(m.state.draft).toBe('')
    m.dispatch({ type: 'redo' })
    expect(m.state.draft).toBe('abc')
  })

  it('the merge window splits typing runs: within merges, beyond opens a new transaction', () => {
    /** 中文说明：测试局部值 t，由紧邻初始化决定。 */
    let t = 0
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine({ mergeWindowMs: 1000, now: () => t })
    m.dispatch({ type: 'draft-changed', draft: 'a', editRange: { start: 0, end: 0, insertedLength: 1 } })
    t = 900
    m.dispatch({ type: 'draft-changed', draft: 'ab', editRange: { start: 1, end: 1, insertedLength: 1 } })
    t = 2500 // beyond the window from the previous char
    m.dispatch({ type: 'draft-changed', draft: 'abc', editRange: { start: 2, end: 2, insertedLength: 1 } })
    m.dispatch({ type: 'undo' })
    expect(m.state.draft).toBe('ab')
    m.dispatch({ type: 'undo' })
    expect(m.state.draft).toBe('')
  })

  it('non-contiguous or multi-char edits never merge into a typing run', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: 'a', editRange: { start: 0, end: 0, insertedLength: 1 } })
    m.dispatch({ type: 'draft-changed', draft: 'ba', editRange: { start: 0, end: 0, insertedLength: 1 } })
    m.dispatch({ type: 'draft-changed', draft: 'baXY', editRange: { start: 2, end: 2, insertedLength: 2 } })
    m.dispatch({ type: 'undo' })
    expect(m.state.draft).toBe('ba')
    m.dispatch({ type: 'undo' })
    expect(m.state.draft).toBe('a')
    m.dispatch({ type: 'undo' })
    expect(m.state.draft).toBe('')
  })

  it('a new transaction cuts the redo chain', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: 'a', editRange: { start: 0, end: 0, insertedLength: 1 } })
    m.dispatch({ type: 'undo' })
    m.dispatch({ type: 'draft-changed', draft: 'z', editRange: { start: 0, end: 0, insertedLength: 1 } })
    expect(m.dispatch({ type: 'redo' })).toEqual([])
    expect(m.state.draft).toBe('z')
  })

  it('undo on an empty log and redo on an empty chain are no-ops', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    expect(m.dispatch({ type: 'undo' })).toEqual([])
    expect(m.dispatch({ type: 'redo' })).toEqual([])
  })

  it('the log ring caps at 100 transactions', () => {
    /** 中文说明：测试局部值 t，由紧邻初始化决定。 */
    let t = 0
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine({ mergeWindowMs: 0, now: () => (t += 10) })
    /** 中文说明：测试局部值 draft，由紧邻初始化决定。 */
    let draft = ''
    /** 中文说明：测试局部值 i，由紧邻初始化决定。 */
    for (let i = 0; i < 110; i += 1) {
      draft += 'x'
      m.dispatch({ type: 'draft-changed', draft, editRange: { start: i, end: i, insertedLength: 1 } })
    }
    /** 中文说明：测试局部值 i，由紧邻初始化决定。 */
    for (let i = 0; i < 100; i += 1) m.dispatch({ type: 'undo' })
    expect(m.state.draft).toBe('x'.repeat(10))
    expect(m.dispatch({ type: 'undo' })).toEqual([])
    expect(m.state.draft).toBe('x'.repeat(10))
  })

  it('undo restores the occurrence table with the draft (chip resurrection)', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: '@wor' })
    m.dispatch({ type: 'insert-ref', reference: refOf('w'), span: spanOf(m, 0, 4) })
    m.dispatch({ type: 'draft-changed', draft: '', editRange: { start: 0, end: m.state.draft.length, insertedLength: 0 } })
    expect(m.state.occurrences).toEqual([])
    m.dispatch({ type: 'undo' })
    expect(m.state.draft).toBe(`${referenceDraftText(refOf('w'))} `)
    expect(m.state.occurrences).toHaveLength(1)
  })

  it('a committed submit clears the log: undo cannot resurrect sent content', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    /** 中文说明：测试局部值 { attempt }，由紧邻初始化决定。 */
    const { attempt } = enterSubmitting(m, 'goal', 'x')
    m.dispatch({ type: 'submit-settled', attempt, ok: true })
    expect(m.state.draft).toBe('')
    expect(m.dispatch({ type: 'undo' })).toEqual([])
    expect(m.state.draft).toBe('')
  })

  it('keeps a suffix typed during the round-trip and drops interleaved edits with the commit', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: 'hello' })
    /** 中文说明：测试局部值 effect，由紧邻初始化决定。 */
    const effect = effectAt(m.dispatch({ type: 'enter', mode: 'queue' }), 0, 'default-sink')
    m.dispatch({ type: 'draft-changed', draft: 'hello world' })
    m.dispatch({ type: 'submit-settled', attempt: effect.attempt, ok: true })
    expect(m.state.draft).toBe(' world')

    /** 中文说明：测试局部值 n，由紧邻初始化决定。 */
    const n = new InputMachine()
    n.dispatch({ type: 'draft-changed', draft: 'hello' })
    /** 中文说明：测试局部值 second，由紧邻初始化决定。 */
    const second = effectAt(n.dispatch({ type: 'enter', mode: 'queue' }), 0, 'default-sink')
    n.dispatch({ type: 'draft-changed', draft: 'hXello' })
    n.dispatch({ type: 'submit-settled', attempt: second.attempt, ok: true })
    expect(n.state.draft).toBe('')
  })
})

describe('input-machine: paste plane', () => {
  it('paste replaces the selection as one transaction and opens a match attempt', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: 'abc' })
    m.dispatch({ type: 'paste-begin', text: 'XY', selection: { start: 1, end: 2 }, generation: 7 })
    expect(m.state.draft).toBe('aXYc')
    expect(m.state.paste).toEqual({ attemptId: 1, insertedRange: { start: 1, end: 3 }, generation: 7 })
    m.dispatch({ type: 'undo' })
    expect(m.state.draft).toBe('abc')
  })

  it('pasted text is sanitized: raw U+FFFC never enters the draft as a fake chip', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    m.dispatch({ type: 'paste-begin', text: `x${LEGACY_PLACEHOLDER}y`, selection: { start: 0, end: 0 } })
    expect(m.state.draft).toBe('xy')
    expect(m.state.occurrences).toEqual([])
  })

  it('sync hot-snapshot components mint inside the SAME transaction: one undo returns to pre-paste', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: 'hi ' })
    m.dispatch({
      type: 'paste-begin', text: '/alpha x', selection: { start: 3, end: 3 },
      components: [{ start: 0, end: 6, reference: refOf('alpha') }],
    })
    expect(m.state.draft).toBe(`hi ${referenceDraftText(refOf('alpha'))} x`)
    expect(m.state.occurrences).toEqual([expect.objectContaining({ ref: 'alpha', offset: 3 })])
    expect(m.state.paste?.insertedRange).toEqual({ start: 3, end: m.state.draft.length })
    m.dispatch({ type: 'undo' })
    expect(m.state).toMatchObject({ draft: 'hi ', occurrences: [] })
  })

  it('async upgrade is an INDEPENDENT transaction: undo #1 → token text, undo #2 → pre-paste', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    m.dispatch({ type: 'paste-begin', text: '/alpha rest', selection: { start: 0, end: 0 } })
    expect(m.state.paste?.attemptId).toBe(1)
    m.dispatch({ type: 'paste-upgrade', attemptId: 1, span: spanOf(m, 0, 6), reference: refOf('alpha') })
    expect(m.state.draft).toBe(`${referenceDraftText(refOf('alpha'))} rest`)
    expect(m.state.occurrences).toHaveLength(1)
    m.dispatch({ type: 'undo' })
    expect(m.state).toMatchObject({ draft: '/alpha rest', occurrences: [] })
    m.dispatch({ type: 'undo' })
    expect(m.state.draft).toBe('')
  })

  it('the attempt survives upgrades: successive tokens re-CAS against the advanced revision', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    m.dispatch({ type: 'paste-begin', text: '/alpha /beta', selection: { start: 0, end: 0 } })
    m.dispatch({ type: 'paste-upgrade', attemptId: 1, span: spanOf(m, 0, 6), reference: refOf('alpha') })
    /** 中文说明：测试局部值 alpha，由紧邻初始化决定。 */
    const alpha = referenceDraftText(refOf('alpha'))
    expect(m.state.paste?.insertedRange).toEqual({ start: 0, end: alpha.length + 6 })
    /** 中文说明：测试局部值 betaStart，由紧邻初始化决定。 */
    const betaStart = m.state.draft.indexOf('/beta')
    m.dispatch({ type: 'paste-upgrade', attemptId: 1, span: spanOf(m, betaStart, betaStart + 5), reference: refOf('beta') })
    expect(m.state.draft).toBe(`${alpha} ${referenceDraftText(refOf('beta'))} `)
    expect(m.state.occurrences.map(o => o.ref)).toEqual(['alpha', 'beta'])
    expect(m.state.paste?.insertedRange).toEqual({ start: 0, end: m.state.draft.length })
  })

  it('a stale span CAS drops one upgrade without ending the attempt', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    m.dispatch({ type: 'paste-begin', text: '/alpha /beta', selection: { start: 0, end: 0 } })
    /** 中文说明：测试局部值 preSpan，由紧邻初始化决定。 */
    const preSpan = spanOf(m, 7, 12)
    m.dispatch({ type: 'paste-upgrade', attemptId: 1, span: spanOf(m, 0, 6), reference: refOf('alpha') })
    expect(m.dispatch({ type: 'paste-upgrade', attemptId: 1, span: preSpan, reference: refOf('beta') })).toEqual([])
    expect(m.state.occurrences).toHaveLength(1)
    expect(m.state.paste).toBeDefined()
  })

  it('any new input transaction ends the attempt; late upgrades drop whole', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    m.dispatch({ type: 'paste-begin', text: '/alpha', selection: { start: 0, end: 0 } })
    m.dispatch({ type: 'draft-changed', draft: '/alpha!', editRange: { start: 6, end: 6, insertedLength: 1 } })
    expect(m.state.paste).toBeUndefined()
    expect(m.dispatch({ type: 'paste-upgrade', attemptId: 1, span: spanOf(m, 0, 6), reference: refOf('alpha') })).toEqual([])
    expect(m.state.occurrences).toEqual([])
  })

  it('invalidate-paste (caret/selection/slash activity) and submit start end the attempt', () => {
    /** 中文说明：测试局部值 a，由紧邻初始化决定。 */
    const a = new InputMachine()
    a.dispatch({ type: 'paste-begin', text: '/alpha', selection: { start: 0, end: 0 } })
    a.dispatch({ type: 'invalidate-paste' })
    expect(a.state.paste).toBeUndefined()

    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = new InputMachine()
    b.dispatch({ type: 'paste-begin', text: 'plain text', selection: { start: 0, end: 0 } })
    b.dispatch({ type: 'enter', mode: 'queue' })
    expect(b.state.paste).toBeUndefined()
  })

  it('a mismatched attemptId is dropped (superseded paste)', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    m.dispatch({ type: 'paste-begin', text: '/alpha', selection: { start: 0, end: 0 } })
    m.dispatch({ type: 'paste-begin', text: ' /beta', selection: { start: 6, end: 6 } })
    expect(m.state.paste?.attemptId).toBe(2)
    expect(m.dispatch({ type: 'paste-upgrade', attemptId: 1, span: spanOf(m, 0, 6), reference: refOf('alpha') })).toEqual([])
    expect(m.state.occurrences).toEqual([])
  })
})

describe('input-machine: set-invalid styling bits', () => {
  it('flags exactly the listed occurrences without a transaction', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: '/alp' })
    m.dispatch({ type: 'insert-ref', reference: refOf('alpha'), span: spanOf(m, 0, 4) })
    /** 中文说明：测试局部值 alpha，由紧邻初始化决定。 */
    const alpha = referenceDraftText(refOf('alpha'))
    m.dispatch({
      type: 'draft-changed',
      draft: `${alpha} /bet`,
      editRange: { start: alpha.length + 1, end: alpha.length + 1, insertedLength: 5 },
    })
    m.dispatch({ type: 'insert-ref', reference: refOf('beta'), span: spanOf(m, alpha.length + 1, alpha.length + 5) })
    /** 中文说明：测试局部值 rev，由紧邻初始化决定。 */
    const rev = m.state.draftRev
    m.dispatch({ type: 'set-invalid', invalidIds: [1] })
    expect(m.state.draftRev).toBe(rev)
    expect(m.state.occurrences.map(o => o.invalid === true)).toEqual([true, false])
    // Recovery: the same source/ref resolving again clears the bit.
    m.dispatch({ type: 'set-invalid', invalidIds: [] })
    expect(m.state.occurrences.every(o => o.invalid === undefined)).toBe(true)
  })

  it('a no-change call keeps the table reference (no spurious publish)', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: '/alp' })
    m.dispatch({ type: 'insert-ref', reference: refOf('alpha'), span: spanOf(m, 0, 4) })
    /** 中文说明：测试局部值 table，由紧邻初始化决定。 */
    const table = m.state.occurrences
    expect(m.dispatch({ type: 'set-invalid', invalidIds: [] })).toEqual([])
    expect(m.state.occurrences).toBe(table)
  })
})

describe('input-machine: projectClipboard', () => {
  it('expands each reference range to its occurrence clipboardText in draft order', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: 'use /alp' })
    m.dispatch({ type: 'insert-ref', reference: refOf('alpha'), span: spanOf(m, 4, 8) })
    /** 中文说明：测试局部值 alpha，由紧邻初始化决定。 */
    const alpha = referenceDraftText(refOf('alpha'))
    /** 中文说明：测试局部值 secondDraft，由紧邻初始化决定。 */
    const secondDraft = `use ${alpha} then /bet`
    /** 中文说明：测试局部值 secondStart，由紧邻初始化决定。 */
    const secondStart = secondDraft.lastIndexOf('/bet')
    m.dispatch({
      type: 'draft-changed',
      draft: secondDraft,
      editRange: { start: 4 + alpha.length + 1, end: 4 + alpha.length + 1, insertedLength: 'then /bet'.length },
    })
    m.dispatch({ type: 'insert-ref', reference: refOf('beta'), span: spanOf(m, secondStart, secondStart + 4) })
    expect(m.state.draft).toBe(`use ${alpha} then ${referenceDraftText(refOf('beta'))} `)
    expect(projectClipboard(m.state)).toBe('use /alpha then /beta ')
  })

  it('is the identity on a chip-free draft', () => {
    expect(projectClipboard({ draft: 'plain text', occurrences: [] })).toBe('plain text')
  })
})

describe('decorations: scanTextRefs', () => {
  /** 中文说明：测试局部值 LEX，由紧邻初始化决定。 */
  const LEX: ReadonlyMap<'/' | '@', readonly string[]> = new Map([
    ['/', ['commit-helper', 'fixture-demo']],
    ['@', ['worker-1']],
  ])

  it('matches lexicon tokens at line start and after whitespace, in draft order', () => {
    expect(scanTextRefs('/commit-helper then @worker-1 ok', LEX)).toEqual([
      { start: 0, end: 14, trigger: '/' },
      { start: 20, end: 29, trigger: '@' },
    ])
  })

  it('a cold (empty) lexicon scans nothing', () => {
    expect(scanTextRefs('/commit-helper', new Map())).toEqual([])
  })

  it('recognizes directory paths independently of the dynamic lexicon', () => {
    expect(scanTextRefs('open @src/components/ or @"docs/design notes/', new Map())).toEqual([
      { start: 5, end: 21, trigger: '@', appearance: 'folder' },
      { start: 25, end: 45, trigger: '@', appearance: 'folder' },
    ])
  })

  it('names off the lexicon do not match; triggers are routed per lexicon list', () => {
    expect(scanTextRefs('/unknown @commit-helper', LEX)).toEqual([])
  })

  it('word boundary: a trigger glued to text never matches', () => {
    expect(scanTextRefs('x/commit-helper', LEX)).toEqual([])
    expect(scanTextRefs('a@worker-1', LEX)).toEqual([])
  })

  it('tokens never cross a newline; a token straight after one matches', () => {
    expect(scanTextRefs('line\n/commit-helper', LEX)).toEqual([
      { start: 5, end: 19, trigger: '/' },
    ])
  })

  it('deriveDecorations threads the lexicon through as textRefs', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: 'use /commit-helper now' })
    expect(deriveDecorations(m.state, LEX).textRefs).toEqual([
      { start: 4, end: 18, trigger: '/' },
    ])
  })
})

describe('input-machine: decorations', () => {
  it('projects chips from the occurrence table with identity, offset, label, and invalid bit', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: '/alp' })
    /** 中文说明：测试局部值 reference，由紧邻初始化决定。 */
    const reference = { ...refOf('alpha'), appearance: 'file' as const }
    m.dispatch({
      type: 'insert-ref',
      reference,
      span: spanOf(m, 0, 4),
    })
    m.dispatch({ type: 'set-invalid', invalidIds: [1] })
    expect(deriveDecorations(m.state)).toEqual({
      token: null,
      chips: [{
        occurrenceId: 1,
        offset: 0,
        length: referenceDraftText(reference).length,
        text: referenceDraftText(reference),
        label: 'alpha',
        appearance: 'file',
        invalid: true,
      }],
      textRefs: [],
      hint: null,
    })
  })

  it('claim token range and ghost hint show while claimed with blank args; args clear the hint', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: '/go' })
    m.dispatch({ type: 'begin-command', claim: claimOf('goal', 'objective'), span: spanOf(m, 0, 3) })
    expect(deriveDecorations(m.state)).toEqual({
      token: { start: 0, end: 6 },
      chips: [],
      textRefs: [],
      hint: 'objective',
    })
    m.dispatch({ type: 'draft-changed', draft: '/goal x' })
    expect(deriveDecorations(m.state)).toMatchObject({ token: { start: 0, end: 6 }, hint: null })
  })

  it('the token range persists through submitting; a hintless claim never ghosts', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    enterSubmitting(m, 'goal', '')
    expect(deriveDecorations(m.state)).toEqual({ token: { start: 0, end: 6 }, chips: [], textRefs: [], hint: null })
  })
})

describe('input-machine: claimed lifecycle', () => {
  it('breaking startsWith(token) auto-releases back to plain', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: '/go' })
    m.dispatch({ type: 'begin-command', claim: claimOf('goal'), span: spanOf(m, 0, 3) })
    m.dispatch({ type: 'draft-changed', draft: '/goal make' })
    expect(m.state.phase).toBe('claimed')
    m.dispatch({ type: 'draft-changed', draft: '/goa make' })
    expect(m.state.phase).toBe('plain')
    expect(m.state.claim).toBeUndefined()
    expect(m.state.draft).toBe('/goa make')
  })

  it('explicit release returns to plain when nothing is in flight', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: '/go' })
    m.dispatch({ type: 'begin-command', claim: claimOf('goal'), span: spanOf(m, 0, 3) })
    expect(m.dispatch({ type: 'release' })).toEqual([])
    expect(m.state.phase).toBe('plain')
    expect(m.state.claim).toBeUndefined()
  })

  it('enter begins the submit transaction: args = draft minus token, multi-line legal', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    /** 中文说明：测试局部值 { attempt, claim }，由紧邻初始化决定。 */
    const { attempt, claim } = enterSubmitting(m, 'goal', 'line1\nline2')
    expect(attempt.draftSnapshot).toBe('/goal line1\nline2')
    m.dispatch({ type: 'submit-settled', attempt, ok: true })
    expect(m.state.draft).toBe('')
    expect(claim.token).toBe('/goal ')
  })
})

describe('input-machine: submitting transaction', () => {
  it('enter and begin-command are locked; draft-changed is recorded without leaving submitting', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    enterSubmitting(m, 'goal', 'x')
    expect(m.dispatch({ type: 'enter', mode: 'queue' })).toEqual([])
    expect(m.dispatch({ type: 'draft-changed', draft: '/goal y' })).toEqual([])
    expect(m.state).toMatchObject({ phase: 'submitting', draft: '/goal y' })
  })

  it('commit clears draft and occurrences, releases the claim, and relays the outcome text', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    m.dispatch({ type: 'draft-changed', draft: '@wor' })
    m.dispatch({ type: 'insert-ref', reference: refOf('worker-1', 'subagent'), span: spanOf(m, 0, 4) })
    /** 中文说明：测试局部值 refLength，由紧邻初始化决定。 */
    const refLength = referenceDraftText(refOf('worker-1')).length
    m.dispatch({
      type: 'draft-changed',
      draft: `${referenceDraftText(refOf('worker-1'))}/go`,
      editRange: { start: refLength + 1, end: refLength + 1, insertedLength: 3 },
    })
    m.dispatch({
      type: 'draft-changed',
      draft: '/go',
      editRange: { start: 0, end: refLength + 1, insertedLength: 0 },
    })
    m.dispatch({ type: 'begin-command', claim: claimOf('goal'), span: spanOf(m, 0, 3) })
    m.dispatch({ type: 'draft-changed', draft: '/goal go' })
    /** 中文说明：测试局部值 attempt，由紧邻初始化决定。 */
    const attempt = effectAt(m.dispatch({ type: 'enter', mode: 'queue' }), 0, 'begin-submit').attempt
    /** 中文说明：测试局部值 fx，由紧邻初始化决定。 */
    const fx = m.dispatch({ type: 'submit-settled', attempt, ok: true, outcome: { kind: 'success', text: 'goal set' } })
    expect(fx).toEqual([{ type: 'notice', level: 'info', text: 'goal set' }])
    expect(m.state).toMatchObject({ phase: 'plain', draft: '', occurrences: [] })
    expect(m.state.claim).toBeUndefined()
  })

  it('rollback with an undeviated draft keeps the snapshot and re-enters claimed (same claim)', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    /** 中文说明：测试局部值 { attempt }，由紧邻初始化决定。 */
    const { attempt } = enterSubmitting(m, 'goal', 'x')
    /** 中文说明：测试局部值 fx，由紧邻初始化决定。 */
    const fx = m.dispatch({ type: 'submit-settled', attempt, ok: false, message: 'boom' })
    expect(fx).toEqual([{ type: 'notice', level: 'error', text: 'boom' }])
    expect(m.state).toMatchObject({ phase: 'claimed', draft: '/goal x' })
    expect(m.state.claim?.token).toBe('/goal ')
  })

  it('rollback with a deviated draft only notices — the newer input wins', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    /** 中文说明：测试局部值 { attempt }，由紧邻初始化决定。 */
    const { attempt } = enterSubmitting(m, 'goal', 'x')
    m.dispatch({ type: 'draft-changed', draft: 'fresh typing' })
    /** 中文说明：测试局部值 fx，由紧邻初始化决定。 */
    const fx = m.dispatch({ type: 'submit-settled', attempt, ok: false, message: 'boom' })
    expect(fx).toEqual([{ type: 'notice', level: 'error', text: 'boom' }])
    expect(m.state).toMatchObject({ phase: 'plain', draft: 'fresh typing' })
    expect(m.state.claim).toBeUndefined()
  })

  it('enter-path rollback cannot re-enter claimed when the snapshot never carried the bare token prefix', () => {
    // '\n\n/goal x' round-trips through adjudication; the whitespace prefix
    // would instantly break the claimed watch, so rollback lands plain.
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    /** 中文说明：测试局部值 attempt，由紧邻初始化决定。 */
    const attempt = enterAdjudicating(m, '\n\n/goal x')
    m.dispatch({ type: 'adjudicated', attempt, outcome: { claim: claimOf('goal') } })
    /** 中文说明：测试局部值 fx，由紧邻初始化决定。 */
    const fx = m.dispatch({ type: 'submit-settled', attempt, ok: false, message: 'boom' })
    expect(fx).toEqual([{ type: 'notice', level: 'error', text: 'boom' }])
    expect(m.state).toMatchObject({ phase: 'plain', draft: '\n\n/goal x' })
  })

  it('a stale settle after rollback + resubmit is dropped (anti-backwash)', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    /** 中文说明：测试局部值 { attempt，由紧邻初始化决定。 */
    const { attempt: first } = enterSubmitting(m, 'goal', 'x')
    m.dispatch({ type: 'submit-settled', attempt: first, ok: false, message: 'retry' })
    /** 中文说明：测试局部值 second，由紧邻初始化决定。 */
    const second = effectAt(m.dispatch({ type: 'enter', mode: 'queue' }), 0, 'begin-submit').attempt
    expect(second.seq).not.toBe(first.seq)
    expect(m.dispatch({ type: 'submit-settled', attempt: first, ok: true })).toEqual([])
    expect(m.state.phase).toBe('submitting')
    m.dispatch({ type: 'submit-settled', attempt: second, ok: true })
    expect(m.state.draft).toBe('')
  })

  it('release mid-flight aborts the attempt and later settles are dropped', () => {
    /** 中文说明：测试局部值 m，由紧邻初始化决定。 */
    const m = new InputMachine()
    /** 中文说明：测试局部值 { attempt }，由紧邻初始化决定。 */
    const { attempt } = enterSubmitting(m, 'goal', 'x')
    expect(m.dispatch({ type: 'release' })).toEqual([])
    expect(attempt.signal.aborted).toBe(true)
    expect(m.state.phase).toBe('plain')
    expect(m.dispatch({ type: 'submit-settled', attempt, ok: true })).toEqual([])
    expect(m.state.draft).toBe('/goal x')
  })
})

describe('input-machine: per-session isolation', () => {
  it('one instance per session: A submitting never locks B; settles land on their own instance', () => {
    /** 中文说明：测试局部值 a，由紧邻初始化决定。 */
    const a = new InputMachine()
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = new InputMachine()
    /** 中文说明：测试局部值 { attempt }，由紧邻初始化决定。 */
    const { attempt } = enterSubmitting(a, 'goal', 'from A')
    // B stays fully live while A holds its lock.
    b.dispatch({ type: 'draft-changed', draft: '/mo' })
    b.dispatch({ type: 'begin-command', claim: claimOf('model'), span: spanOf(b, 0, 3) })
    expect(b.state.phase).toBe('claimed')
    expect(a.state.phase).toBe('submitting')
    // A's commit falls back to A alone.
    a.dispatch({ type: 'submit-settled', attempt, ok: true })
    expect(a.state).toMatchObject({ phase: 'plain', draft: '' })
    expect(b.state).toMatchObject({ phase: 'claimed', draft: '/model ' })
  })
})
