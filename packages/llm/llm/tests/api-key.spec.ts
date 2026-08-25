/**
 * 文件职责：验证 api-key.spec.ts 覆盖的 LLM 配置、调用与事件处理行为。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件上下文和可控测试替身验证运行时协作。
 * 产品维度：保障模型接入在配置变化、认证、重试与异常场景下仍能给 Agent 稳定反馈。
 * 逻辑维度：准备上下文与测试数据，触发被测流程，再核对请求、事件、结果和清理行为。
 * 关键边界：测试替身必须保持确定性；敏感凭据不可写入日志；异步资源必须在用例结束时释放。
 * 新手阅读建议：先看测试数据和辅助函数，再按 describe/it 场景阅读，最后对照被测插件实现。
 */
import { describe, expect, it } from 'vitest'
import { assertUsableApiKey, INVALID_CREDENTIAL_CODE, normalizeApiKey } from '@deepseek-ai/dsh-llm'

describe('normalizeApiKey', () => {
  it('accepts a printable-ASCII key unchanged', () => {
    expect(normalizeApiKey('sk-0123456789abcdef')).toEqual({ ok: true, value: 'sk-0123456789abcdef' })
  })

  it('trims surrounding whitespace before judging', () => {
    expect(normalizeApiKey('  sk-abc\t\n')).toEqual({ ok: true, value: 'sk-abc' })
  })

  it.each([
    ['an empty string', ''],
    ['spaces only', '   '],
    ['a tab only', '\t'],
  ])('rejects %s as empty', (_label, raw) => {
    expect(normalizeApiKey(raw)).toEqual({ ok: false, reason: 'empty' })
  })

  it.each([
    ['an emoji', 'sk-\u{1F600}abc'],
    ['CJK text', 'sk-你好'],
    ['full-width punctuation', 'sk-abc，'],
    ['an interior space', 'sk-abc def'],
    ['a C0 control character', 'sk-abc\x01'],
    ['a latin-1 character', 'sk-café'],
  ])('rejects %s as illegal characters', (_label, raw) => {
    expect(normalizeApiKey(raw)).toEqual({ ok: false, reason: 'illegalCharacters' })
  })

  it('accepts the printable-ASCII boundary characters', () => {
    expect(normalizeApiKey('!~')).toEqual({ ok: true, value: '!~' })
  })

  it('publishes a code distinct from a missing credential', () => {
    expect(INVALID_CREDENTIAL_CODE).toBe('INVALID_CREDENTIAL')
  })
})

describe('assertUsableApiKey', () => {
  it('returns the trimmed key when it is usable', () => {
    expect(assertUsableApiKey('  sk-abc  ', 'llm-deepseek', 'DEEPSEEK_API_KEY')).toBe('sk-abc')
  })

  it('refuses a blank stored credential, naming the reference', () => {
    expect(() => assertUsableApiKey('   ', 'llm-deepseek', 'DEEPSEEK_API_KEY'))
      .toThrow(/llm-deepseek: the API key resolved from DEEPSEEK_API_KEY is blank/)
  })

  it('refuses an unusable stored credential with the invalid-credential code', () => {
    try {
      assertUsableApiKey('sk-\u{1F600}', 'llm-pi-ai', 'ACME_API_KEY')
      expect.fail('an illegal key must throw')
    } catch (error) {
      expect((error as { code: string }).code).toBe(INVALID_CREDENTIAL_CODE)
      expect((error as Error).message).toContain('llm-pi-ai')
      expect((error as Error).message).toContain('ACME_API_KEY')
    }
  })

  it('never echoes the key it refuses', () => {
    try {
      assertUsableApiKey('sk-\u{1F600}supersecret', 'llm-deepseek', 'DEEPSEEK_API_KEY')
      expect.fail('an illegal key must throw')
    } catch (error) {
      expect((error as Error).message).not.toContain('supersecret')
    }
  })
})
