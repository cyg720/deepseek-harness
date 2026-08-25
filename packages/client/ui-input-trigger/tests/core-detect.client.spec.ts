// detectTrigger word-boundary, position, guard-tier, and span behavior.
// URL rule pinned here: '/' is dead when its predecessor is
// another '/' (second slash of '//') or a ':' itself preceded by a
// non-whitespace char (scheme separator) — this is the concrete rule chosen
// to honor "no trigger inside URLs".
/**
 * 文件职责：验证输入触发菜单的 core-detect.client.spec.ts 行为。
 * 技术维度：Vitest、React 渲染、事件模拟和服务替身。
 * 产品维度：防止输入触发菜单用户流程回归。
 * 逻辑维度：构造状态，触发行为并断言结果和清理。
 * 关键边界：异步任务、全局替身和 DOM 必须在用例后恢复。
 * 新手阅读建议：先读辅助函数，再按场景顺序阅读。
 */
import { describe, expect, it } from 'vitest'
import { detectTrigger } from '../src/core/detect.ts'
import type { TriggerGuard } from '../src/types.ts'

/** 中文说明：测试局部值 plain，由紧邻初始化决定。 */
const plain: TriggerGuard = { tier: 'plain' }
/** 中文说明：测试局部值 claimed，由紧邻初始化决定。 */
const claimed: TriggerGuard = { tier: 'claimed' }
/** 中文说明：测试局部值 frozen，由紧邻初始化决定。 */
const frozen: TriggerGuard = { tier: 'frozen' }

/** Hit at the end of the draft under the plain tier. */
/* 中文说明：测试局部值 atEnd，由紧邻初始化决定。 */
const atEnd = (draft: string, guard: TriggerGuard = plain) => detectTrigger(draft, draft.length, guard)

describe('detectTrigger word boundaries', () => {
  it('triggers at start of draft', () => {
    expect(atEnd('/go')).toMatchObject({ trigger: '/', query: 'go', position: 'leading' })
    expect(atEnd('@wo')).toMatchObject({ trigger: '@', query: 'wo', position: 'leading' })
  })

  it('triggers after whitespace, newline, and punctuation', () => {
    expect(atEnd('say /co')).toMatchObject({ trigger: '/', query: 'co' })
    expect(atEnd('line1\n/go')).toMatchObject({ trigger: '/', query: 'go', position: 'inline' })
    expect(atEnd('see (/go')).toMatchObject({ trigger: '/', query: 'go' })
    expect(atEnd('ping @wo')).toMatchObject({ trigger: '@', query: 'wo' })
  })

  it('does not trigger after a word character', () => {
    expect(atEnd('user@host')).toBeNull()
    expect(atEnd('a/b')).toBeNull()
    expect(atEnd('foo_1@bar')).toBeNull()
  })

  it('does not trigger on URL slashes', () => {
    // Both '//' slashes: first blocked by the ':' rule, second by the '/' rule.
    expect(atEnd('https://example')).toBeNull()
    expect(atEnd('see https://example')).toBeNull()
    // Path slashes deeper in the URL sit after word chars.
    expect(atEnd('https://a.b/c/d')).toBeNull()
    // Single slash after a scheme-like colon (mailto:/, C:/).
    expect(atEnd('C:/path')).toBeNull()
  })

  it('still triggers when a colon is not a scheme separator', () => {
    // ':' preceded by whitespace / at index 0 is ordinary punctuation.
    expect(atEnd('note: /go')).toMatchObject({ trigger: '/', query: 'go' })
    expect(atEnd(':/go')).toMatchObject({ trigger: '/', query: 'go' })
  })

  it('stops the backward scan at whitespace', () => {
    // Space after the token: no trigger at the caret anymore.
    expect(atEnd('/goal x')).toBeNull()
    expect(atEnd('@worker done')).toBeNull()
  })

  it('finds the nearest trigger left of the caret', () => {
    expect(atEnd('/goal @wor')).toMatchObject({ trigger: '@', query: 'wor' })
  })
})

describe('detectTrigger position', () => {
  it('treats a draft whose leading trim (incl. newlines) starts at the token as leading', () => {
    expect(atEnd('\n\n/goal')).toMatchObject({ position: 'leading' })
    expect(atEnd('  \n /goal')).toMatchObject({ position: 'leading' })
  })

  it('treats a token after non-whitespace text as inline', () => {
    expect(atEnd('第一行\n/goal')).toMatchObject({ position: 'inline' })
    expect(atEnd('a /goal')).toMatchObject({ position: 'inline' })
  })
})

describe('detectTrigger guard tiers', () => {
  it('claimed suppresses "/" everywhere but keeps "@"', () => {
    expect(atEnd('/co', claimed)).toBeNull()
    expect(atEnd('args /path', claimed)).toBeNull()
    expect(atEnd('/goal @wor', claimed)).toMatchObject({ trigger: '@', query: 'wor' })
  })

  it('a suppressed "/" is scanned through like an ordinary char', () => {
    // '/x' right of the caret path: scan passes the dead '/' and hits nothing.
    expect(detectTrigger('/goal /x', 8, claimed)).toBeNull()
  })

  it('frozen suppresses both triggers', () => {
    expect(atEnd('/co', frozen)).toBeNull()
    expect(atEnd('@wo', frozen)).toBeNull()
  })
})

describe('detectTrigger span and query', () => {
  it('keeps an open quoted @file token active across spaces', () => {
    /** 中文说明：测试局部值 draft，由紧邻初始化决定。 */
    const draft = 'read @"docs/design notes'
    expect(atEnd(draft)).toMatchObject({
      trigger: '@',
      query: 'docs/design notes',
      quoted: true,
      position: 'inline',
      span: { start: 5, end: draft.length },
    })
  })

  it('spans trigger char to caret with a placeholder draftRev', () => {
    /** 中文说明：测试局部值 hit，由紧邻初始化决定。 */
    const hit = detectTrigger('say /goal', 9, plain)
    expect(hit?.span).toEqual({ start: 4, end: 9, draftRev: 0 })
    expect(hit?.query).toBe('goal')
  })

  it('cuts the query at a mid-token caret', () => {
    /** 中文说明：测试局部值 hit，由紧邻初始化决定。 */
    const hit = detectTrigger('/goal', 3, plain)
    expect(hit).toMatchObject({ query: 'go', span: { start: 0, end: 3 } })
  })

  it('returns null at caret 0 and on empty drafts', () => {
    expect(detectTrigger('', 0, plain)).toBeNull()
    expect(detectTrigger('/goal', 0, plain)).toBeNull()
  })

  it('handles multi-line drafts with the token on a later line', () => {
    /** 中文说明：测试局部值 draft，由紧邻初始化决定。 */
    const draft = 'first line\nsecond /com'
    /** 中文说明：测试局部值 hit，由紧邻初始化决定。 */
    const hit = detectTrigger(draft, draft.length, plain)
    expect(hit).toMatchObject({ trigger: '/', query: 'com', position: 'inline', span: { start: 18, end: 22 } })
  })
})
