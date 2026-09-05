/**
 * 文件职责：验证Hook 线协议的 events.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis、JSON 编解码、子进程、事件匹配和严格联合类型。
 * 产品维度：保证Hook 线协议可预测地传递事件、限制循环或适配外部工具。
 * 逻辑维度：构造事件与配置，驱动入口并断言结果。
 * 关键边界：线协议输入必须校验；外部 Hook 失败不得破坏会话日志或核心循环。
 * 新手阅读建议：先读 types/events，再看 codec/matcher/runner，最后阅读桥接配置。
 */
import { describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { appendHookInvoked, appendHookResult, summarizeStderr, type HookOutput } from '@deepseek-ai/dsh-hook-protocol'

/** A {@link HookOutput} with the required stream fields defaulted. */
/* 中文说明：函数 output 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function output(over: Partial<HookOutput> = {}): HookOutput {
  return { exitCode: 0, stderr: '', stdout: '', ...over }
}

describe('hook/* session events', () => {
  it('appendHookInvoked records a log-only hook/invoked (with matcher when present)', () => {
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = Session.create(SessionId('s'))
    appendHookInvoked(session, { turn: 1, point: 'PreToolUse', dialect: 'claude-code', handlerId: 'h1', matcher: 'Bash' })

    const ev = session.snapshotEvents().find(e => e.type === 'hook/invoked')
    expect(ev?.type).toBe('hook/invoked')
    if (ev?.type === 'hook/invoked') {
      expect(ev.data).toMatchObject({ turn: 1, point: 'PreToolUse', dialect: 'claude-code', handlerId: 'h1', matcher: 'Bash' })
    }
    // Log-only: no surfaceOp on the event.
    expect((ev as unknown as { surfaceOp?: unknown }).surfaceOp).toBeUndefined()
  })

  it('omits matcher when absent (match-all hook)', () => {
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = Session.create(SessionId('s'))
    appendHookInvoked(session, { turn: 2, point: 'Stop', dialect: 'codex', handlerId: 'h2' })

    const ev = session.snapshotEvents().find(e => e.type === 'hook/invoked')
    if (ev?.type === 'hook/invoked') {
      expect('matcher' in ev.data).toBe(false)
    }
  })

  it('appendHookResult derives decision/exitCode/stderrSummary from the output', () => {
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = Session.create(SessionId('s'))
    appendHookResult(session, {
      turn: 1, point: 'PreToolUse', handlerId: 'h1',
      stderrSummaryMaxChars: 500, durationMs: 5, output: output({ exitCode: 2, stderr: 'blocked', decision: 'deny' }),
    })
    const full = session.snapshotEvents().find(e => e.type === 'hook/result')
    if (full?.type === 'hook/result') {
      expect(full.data).toEqual({ turn: 1, point: 'PreToolUse', handlerId: 'h1', decision: 'deny', exitCode: 2, stderrSummary: 'blocked', durationMs: 5 })
    }

    // A result with no exit code / no stderr (e.g. a hook that could not run) omits both keys.
    /** 中文说明：测试局部值 session2，由紧邻初始化决定。 */
    const session2 = Session.create(SessionId('s2'))
    appendHookResult(session2, {
      turn: 1, point: 'Stop', handlerId: 'h3',
      stderrSummaryMaxChars: 500, durationMs: 5, output: output({ exitCode: undefined, decision: 'allow' }),
    })
    const sparse = session2.snapshotEvents().find(e => e.type === 'hook/result')
    if (sparse?.type === 'hook/result') {
      expect('exitCode' in sparse.data).toBe(false)
      expect('stderrSummary' in sparse.data).toBe(false)
      expect(sparse.data.decision).toBe('allow')
    }
  })

  it('the decision falls back to stop on continue:false, else pass', () => {
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = Session.create(SessionId('s'))
    appendHookResult(session, { turn: 1, point: 'Stop', handlerId: 'halt', stderrSummaryMaxChars: 500, durationMs: 5, output: output({ continue: false }) })
    appendHookResult(session, { turn: 1, point: 'Stop', handlerId: 'noop', stderrSummaryMaxChars: 500, durationMs: 5, output: output() })
    // An explicit decision wins over the continue:false fallback.
    appendHookResult(session, { turn: 1, point: 'Stop', handlerId: 'both', stderrSummaryMaxChars: 500, durationMs: 5, output: output({ continue: false, decision: 'block' }) })

    const decisions = session.snapshotEvents()
      .filter(e => e.type === 'hook/result')
      .map(e => e.type === 'hook/result' ? [e.data.handlerId, e.data.decision] : [])
    expect(decisions).toEqual([['halt', 'stop'], ['noop', 'pass'], ['both', 'block']])
  })

  it('stderrSummary is trimmed and truncated to 500 characters with an ellipsis', () => {
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = Session.create(SessionId('s'))
    appendHookResult(session, {
      turn: 1, point: 'PreToolUse', handlerId: 'long',
      stderrSummaryMaxChars: 500, durationMs: 5, output: output({ exitCode: 2, stderr: `  ${'x'.repeat(600)}  ` }),
    })
    const ev = session.snapshotEvents().find(e => e.type === 'hook/result')
    if (ev?.type === 'hook/result') {
      expect(ev.data.stderrSummary).toBe('x'.repeat(500) + '…')
    }
  })

  it('a 500-character stderr is kept verbatim (the cap is exclusive)', () => {
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = Session.create(SessionId('s'))
    appendHookResult(session, {
      turn: 1, point: 'PreToolUse', handlerId: 'edge',
      stderrSummaryMaxChars: 500, durationMs: 5, output: output({ exitCode: 2, stderr: 'y'.repeat(500) }),
    })
    const ev = session.snapshotEvents().find(e => e.type === 'hook/result')
    if (ev?.type === 'hook/result') {
      expect(ev.data.stderrSummary).toBe('y'.repeat(500))
    }
  })

  it('an invoked/result pair correlates by handlerId', () => {
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = Session.create(SessionId('s'))
    appendHookInvoked(session, { turn: 1, point: 'PreToolUse', dialect: 'claude-code', handlerId: 'pair-1' })
    appendHookResult(session, { turn: 1, point: 'PreToolUse', handlerId: 'pair-1', stderrSummaryMaxChars: 500, durationMs: 5, output: output({ decision: 'allow' }) })

    const invoked = session.snapshotEvents().find(e => e.type === 'hook/invoked')
    const result = session.snapshotEvents().find(e => e.type === 'hook/result')
    expect(invoked?.type === 'hook/invoked' && invoked.data.handlerId).toBe('pair-1')
    expect(result?.type === 'hook/result' && result.data.handlerId).toBe('pair-1')
  })
})

describe('summarizeStderr', () => {
  it('returns undefined for empty/whitespace stderr', () => {
    expect(summarizeStderr('', 500)).toBeUndefined()
    expect(summarizeStderr('  \n\t ', 500)).toBeUndefined()
  })

  it('passes through a summary at or under the cap, trimmed', () => {
    expect(summarizeStderr('  blocked: bad tool  ', 500)).toBe('blocked: bad tool')
    expect(summarizeStderr('abc', 3)).toBe('abc')
  })

  it('truncates past the cap with an ellipsis', () => {
    expect(summarizeStderr('abcdef', 4)).toBe('abcd…')
    expect(summarizeStderr('x'.repeat(600), 500)).toBe('x'.repeat(500) + '…')
  })
})
