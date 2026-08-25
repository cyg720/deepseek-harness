/** Regression coverage for locale-aware bilingual Markdown links. */
/**
 * 文件职责：验证 translation-links.spec.ts 覆盖的Agent 预设行为与边界场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、异步协议、进程资源或仓库文本分析。
 * 产品维度：保障 Agent 的Agent 预设能力稳定、可复现且可诊断。
 * 逻辑维度：准备输入和夹具，执行被测或验证流程，再核对结果、错误与资源清理。
 * 关键边界：中文测试字符串不是注释；外部数据不可信；异步资源必须完全释放。
 * 新手阅读建议：先看夹具和公开类型，再读正常流程，最后关注中文输入、失败与清理场景。
 */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  normalizeTranslationMarkdownLinks,
  rewriteTranslationLinkLocales,
  translationLinkLocaleViolations,
  /** 中文说明：type TranslationLinkContext 定义本测试所需的数据或行为，用于表达Agent 预设场景。 */
  type TranslationLinkContext,
} from './translation-links.ts'
import { removeFixtureSafely } from './test-fixture-cleanup.ts'

/** 中文说明：变量 roots 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const roots: string[] = []

afterEach(() => {
  /** 中文说明：该循环依次处理输入或事件；循环变量仅在当前循环中有效。 */
  for (const root of roots.splice(0)) removeFixtureSafely(root)
})

/** 中文说明：函数 fixture 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function fixture(): string {
  /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const root = mkdtempSync(join(tmpdir(), 'dsh-translation-links-'))
  roots.push(root)
  mkdirSync(join(root, 'docs/section'), { recursive: true })
  mkdirSync(join(root, 'packages'), { recursive: true })
  writeFileSync(join(root, 'docs/guide.md'), '# Guide\n')
  writeFileSync(join(root, 'docs/guide.zh.md'), '# 指南\n')
  writeFileSync(join(root, 'docs/reference.md'), '# Overview\n')
  writeFileSync(join(root, 'docs/reference.zh.md'), '# 概览\n')
  writeFileSync(join(root, 'docs/unpaired.md'), '# Only\n')
  writeFileSync(join(root, 'docs/section/index.md'), '# Section\n')
  writeFileSync(join(root, 'docs/section/index.zh.md'), '# 章节\n')
  writeFileSync(join(root, 'packages/outside.md'), '# Outside\n')
  writeFileSync(join(root, 'packages/outside.zh.md'), '# 范围外\n')
  return root
}

/** 中文说明：函数 linkContext 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function linkContext(
  root: string,
  sourcePath: string,
  repositoryFileExists?: (repoPath: string) => boolean,
): TranslationLinkContext {
  return {
    repoRoot: root,
    sourcePath,
    isTranslationPairSource: path => path.startsWith('docs/'),
    ...(repositoryFileExists === undefined ? {} : { repositoryFileExists }),
  }
}

/** 中文说明：函数 expectUnchangedLinkInput 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function expectUnchangedLinkInput(root: string, input: string): void {
  /** 中文说明：变量 context 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const context = linkContext(root, 'docs/guide.md')
  expect(translationLinkLocaleViolations(input, context)).toEqual([])
  expect(rewriteTranslationLinkLocales(input, context)).toEqual({ content: input, rewritten: 0 })
  expect(normalizeTranslationMarkdownLinks(input, context)).toBe(input)
}

describe('translation link locale validation', () => {
  it('rejects a Chinese link to the English sibling with an exact diagnostic', () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = fixture()
    expect(translationLinkLocaleViolations(
      '# 指南\n\n正文。\n\n[概览](reference.md?view=full#overview)\n',
      linkContext(root, 'docs/guide.zh.md'),
    )).toEqual([{
      sourcePath: 'docs/guide.zh.md',
      line: 5,
      url: 'reference.md?view=full#overview',
      expectedUrl: 'reference.zh.md?view=full#overview',
    }])
  })

  it('rewrites an encoded exact filename without changing its query or fragment suffix', () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = fixture()
    /** 中文说明：变量 input 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const input = '[概览](reference%2Emd?view=full&amp;mode=all#overview)\n'
    expect(translationLinkLocaleViolations(
      input,
      linkContext(root, 'docs/guide.zh.md'),
    )[0]).toMatchObject({
      url: 'reference%2Emd?view=full&amp;mode=all#overview',
      expectedUrl: 'reference.zh.md?view=full&amp;mode=all#overview',
    })
    expect(rewriteTranslationLinkLocales(input, linkContext(root, 'docs/guide.zh.md'))).toEqual({
      content: '[概览](reference.zh.md?view=full&amp;mode=all#overview)\n',
      rewritten: 1,
    })
  })

  it('encodes each exact path segment with only RFC 3986 unreserved characters', () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = fixture()
    /** 中文说明：变量 input 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const input = '[保留](a%29%23%3Fb%2Emd?view=full#section)\n'
    /** 中文说明：变量 repositoryFiles 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const repositoryFiles = new Set(['docs/a)#?b.md', 'docs/a)#?b.zh.md'])
    expect(rewriteTranslationLinkLocales(
      input,
      linkContext(root, 'docs/guide.zh.md', path => repositoryFiles.has(path)),
    )).toEqual({
      content: '[保留](a%29%23%3Fb.zh.md?view=full#section)\n',
      rewritten: 1,
    })
  })

  it('accepts the target-locale sibling and an out-of-scope target with its own sibling', () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = fixture()
    expect(translationLinkLocaleViolations(
      '[paired](reference.zh.md) [outside](../packages/outside.md)\n',
      linkContext(root, 'docs/guide.zh.md'),
    )).toEqual([])
  })

  it('does not fall back when an active target is missing its locale sibling', () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = fixture()
    expect(translationLinkLocaleViolations(
      '[missing](unpaired.md)\n',
      linkContext(root, 'docs/guide.zh.md'),
    )[0]).toMatchObject({ expectedUrl: 'unpaired.zh.md' })
  })

  it('requires English sources to use the English sibling', () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = fixture()
    expect(translationLinkLocaleViolations(
      '[Reference](reference.zh.md)\n',
      linkContext(root, 'docs/guide.md'),
    )[0]).toMatchObject({
      url: 'reference.zh.md',
      expectedUrl: 'reference.md',
    })
  })

  it('does not infer an index page from a directory target', () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = fixture()
    /** 中文说明：变量 input 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const input = '[Section](section/)\n'
    expect(translationLinkLocaleViolations(input, linkContext(root, 'docs/guide.zh.md'))).toEqual([])
    expect(rewriteTranslationLinkLocales(input, linkContext(root, 'docs/guide.zh.md')))
      .toEqual({ content: input, rewritten: 0 })
  })

  it('exempts the language switcher target explicitly', () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = fixture()
    expect(translationLinkLocaleViolations(
      '# 指南\n\n[English](guide.md) | 中文\n',
      linkContext(root, 'docs/guide.zh.md'),
      ['guide.md'],
    )).toEqual([])
  })

  it('does not exempt an ordinary body link to the counterpart', () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = fixture()
    /** 中文说明：变量 markdown 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const markdown = '# 指南\n\n[English](guide.md) | 中文\n\n[正文](guide.md)\n'
    expect(translationLinkLocaleViolations(
      markdown,
      linkContext(root, 'docs/guide.zh.md'),
      ['guide.md'],
    )).toEqual([{
      sourcePath: 'docs/guide.zh.md',
      line: 5,
      url: 'guide.md',
      expectedUrl: 'guide.zh.md',
    }])
    expect(rewriteTranslationLinkLocales(
      markdown,
      linkContext(root, 'docs/guide.zh.md'),
      ['guide.md'],
    ).content).toBe('# 指南\n\n[English](guide.md) | 中文\n\n[正文](guide.zh.md)\n')
  })

  it('uses the selected content plane for target existence without deriving scope from siblings', () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = fixture()
    /** 中文说明：变量 staged 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const staged = new Set(['docs/reference.md', 'docs/reference.zh.md'])
    expect(translationLinkLocaleViolations(
      '[概览](reference.md)\n',
      linkContext(root, 'docs/guide.zh.md', path => staged.has(path)),
    )).toHaveLength(1)
    staged.delete('docs/reference.zh.md')
    expect(translationLinkLocaleViolations(
      '[概览](reference.md)\n',
      linkContext(root, 'docs/guide.zh.md', path => staged.has(path)),
    )).toHaveLength(1)
    staged.delete('docs/reference.md')
    expect(translationLinkLocaleViolations(
      '[概览](reference.md)\n',
      linkContext(root, 'docs/guide.zh.md', path => staged.has(path)),
    )).toEqual([])
  })
})

describe('translation link rewriting and normalization', () => {
  it('rewrites only the destination while preserving the suffix and title', () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = fixture()
    /** 中文说明：变量 input 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const input = '[概览](reference.md?view=full&amp;mode=all#overview "reference.md title")\n'
    expect(rewriteTranslationLinkLocales(
      input,
      linkContext(root, 'docs/guide.zh.md'),
    )).toEqual({
      content: '[概览](reference.zh.md?view=full&amp;mode=all#overview "reference.md title")\n',
      rewritten: 1,
    })
  })

  it('rewrites link definitions without changing their labels', () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = fixture()
    expect(rewriteTranslationLinkLocales(
      '[概览][ref]\n\n[ref]: <reference.md#overview> "title"\n',
      linkContext(root, 'docs/guide.zh.md'),
    ).content).toBe('[概览][ref]\n\n[ref]: <reference.zh.md#overview> "title"\n')
  })

  it('uses only the first duplicate reference definition', () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = fixture()
    expect(translationLinkLocaleViolations(
      '[概览][ref]\n\n[ref]: reference.zh.md\n[ref]: reference.md\n',
      linkContext(root, 'docs/guide.zh.md'),
    )).toEqual([])
  })

  it('does not treat an image-only definition as a document link', () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = fixture()
    /** 中文说明：变量 input 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const input = '![preview][asset]\n\n[asset]: reference.zh.md#overview\n'
    expectUnchangedLinkInput(root, input)
  })

  it.each([
    '<https://example.com/reference.md>\n',
    'https://example.com/reference.md\n',
  ])('leaves GFM autolink source unchanged: %s', (input) => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = fixture()
    expectUnchangedLinkInput(root, input)
  })

  it('normalizes only paired locale paths and retains other bytes', () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = fixture()
    /** 中文说明：变量 english 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const english = '[Reference](reference.md#overview) [Outside](../packages/outside.md)\n'
    /** 中文说明：变量 chinese 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const chinese = '[Reference](reference.zh.md#overview) [Outside](../packages/outside.md)\n'
    expect(normalizeTranslationMarkdownLinks(
      english,
      linkContext(root, 'docs/guide.md'),
    )).toBe(normalizeTranslationMarkdownLinks(
      chinese,
      linkContext(root, 'docs/guide.zh.md'),
    ))
  })

  it('retains authored query bytes during normalization', () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = fixture()
    /** 中文说明：变量 escaped 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const escaped = '[Reference](reference.md?x=1&amp;y=2#overview)\n'
    /** 中文说明：变量 literal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const literal = '[Reference](reference.zh.md?x=1&y=2#overview)\n'
    expect(normalizeTranslationMarkdownLinks(
      escaped,
      linkContext(root, 'docs/guide.md'),
    )).not.toBe(normalizeTranslationMarkdownLinks(
      literal,
      linkContext(root, 'docs/guide.zh.md'),
    ))
  })
})
