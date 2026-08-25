/**
 * 文件职责：验证Hook 线协议的 matcher.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis、JSON 编解码、子进程、事件匹配和严格联合类型。
 * 产品维度：保证Hook 线协议可预测地传递事件、限制循环或适配外部工具。
 * 逻辑维度：构造事件与配置，驱动入口并断言结果。
 * 关键边界：线协议输入必须校验；外部 Hook 失败不得破坏会话日志或核心循环。
 * 新手阅读建议：先读 types/events，再看 codec/matcher/runner，最后阅读桥接配置。
 */
import { describe, expect, it } from 'vitest'
import { matcherDiagnostic, matchesMatcher } from '@deepseek-ai/dsh-hook-protocol'

describe('matchesMatcher — match-all sentinels (both dialects)', () => {
  /** 中文说明：测试局部值 mode，由紧邻初始化决定。 */
  for (const mode of ['claude-code', 'codex'] as const) {
    it(`${mode}: absent / empty / '*' match everything`, () => {
      expect(matchesMatcher(undefined, 'Bash', mode)).toBe(true)
      expect(matchesMatcher('', 'anything', mode)).toBe(true)
      expect(matchesMatcher('*', 'whatever', mode)).toBe(true)
    })
  }
})

describe('matchesMatcher — claude dialect (literal-or-regex)', () => {
  it('a pure word-char pattern is a LITERAL exact match (not substring)', () => {
    expect(matchesMatcher('Bash', 'Bash', 'claude-code')).toBe(true)
    // literal exact: "Bash" must NOT match "BashOutput" (a regex would, substring)
    expect(matchesMatcher('Bash', 'BashOutput', 'claude-code')).toBe(false)
  })

  it('a pipe pattern is literal ALTERNATION (exact match any alternative)', () => {
    expect(matchesMatcher('Edit|Write', 'Edit', 'claude-code')).toBe(true)
    expect(matchesMatcher('Edit|Write', 'Write', 'claude-code')).toBe(true)
    expect(matchesMatcher('Edit|Write', 'Read', 'claude-code')).toBe(false)
    // still exact per-alternative, not substring
    expect(matchesMatcher('Edit|Write', 'EditFile', 'claude-code')).toBe(false)
  })

  it('a non-word pattern falls through to regex (unanchored)', () => {
    expect(matchesMatcher('^Bash$', 'Bash', 'claude-code')).toBe(true)
    expect(matchesMatcher('Bash.*', 'BashOutput', 'claude-code')).toBe(true)
    expect(matchesMatcher('.*\\.ts$', 'foo.ts', 'claude-code')).toBe(true)
    expect(matchesMatcher('.*\\.ts$', 'foo.js', 'claude-code')).toBe(false)
  })
})

describe('matchesMatcher — codex dialect (always regex)', () => {
  it('a word pattern is an unanchored regex (substring matches, unlike claude literal)', () => {
    expect(matchesMatcher('Bash', 'Bash', 'codex')).toBe(true)
    // codex has NO literal fast path: "Bash" is /Bash/, so it DOES match a substring
    expect(matchesMatcher('Bash', 'BashOutput', 'codex')).toBe(true)
  })

  it('regex alternation and anchors work', () => {
    expect(matchesMatcher('Edit|Write', 'Edit', 'codex')).toBe(true)
    expect(matchesMatcher('^Bash$', 'Bash', 'codex')).toBe(true)
    expect(matchesMatcher('^Bash$', 'BashOutput', 'codex')).toBe(false)
  })
})

describe('matchesMatcher — invalid regex is a non-match (never throws)', () => {
  it('an unbalanced pattern matches nothing rather than throwing', () => {
    // '(' is not the claude-literal charset, so it goes to the regex path and is invalid.
    expect(() => matchesMatcher('(', 'x', 'claude-code')).not.toThrow()
    expect(matchesMatcher('(', 'x', 'claude-code')).toBe(false)
    expect(matchesMatcher('[', 'x', 'codex')).toBe(false)
  })
})

describe('matcherDiagnostic — parse-time diagnostics', () => {
  it('accepts match-all sentinels, Claude literals, and valid regexes', () => {
    expect(matcherDiagnostic(undefined, 'claude-code')).toBeUndefined()
    expect(matcherDiagnostic('', 'codex')).toBeUndefined()
    expect(matcherDiagnostic('*', 'codex')).toBeUndefined()
    expect(matcherDiagnostic('Edit|Write', 'claude-code')).toBeUndefined()
    expect(matcherDiagnostic('^Bash$', 'claude-code')).toBeUndefined()
    expect(matcherDiagnostic('Edit|Write', 'codex')).toBeUndefined()
  })

  it('returns a stable diagnostic for invalid regexes in either dialect', () => {
    expect(matcherDiagnostic('(', 'claude-code')).toBe('invalid claude-code regex matcher "("')
    expect(matcherDiagnostic('[', 'codex')).toBe('invalid codex regex matcher "["')
  })
})
