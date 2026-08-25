/** Unit tests for the prompt-v7 content and unchanged three-section protocol. */
/**
 * 文件职责：验证 translation-prompt.spec.ts 覆盖的Agent 预设行为与边界场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、异步协议、进程资源或仓库文本分析。
 * 产品维度：保障 Agent 的Agent 预设能力稳定、可复现且可诊断。
 * 逻辑维度：准备输入和夹具，执行被测或验证流程，再核对结果、错误与资源清理。
 * 关键边界：中文测试字符串不是注释；外部数据不可信；异步资源必须完全释放。
 * 新手阅读建议：先看夹具和公开类型，再读正常流程，最后关注中文输入、失败与清理场景。
 */

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  consumeTranslationResponse,
  parseTranslationResponse,
  renderTranslationPrompt,
  renderTranslationRequest,
  renderTranslationResponse,
} from './translation-prompt.ts'

/** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const root = resolve(import.meta.dirname, '..')
/** 中文说明：变量 document 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const document = readFileSync(join(root, 'docs/i18n/translation-prompt.md'), 'utf8')
/** 中文说明：变量 terminology 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const terminology = '| English | 中文 |\n|---|---|\n| agent | agent |'

/** 中文说明：变量 retainedExamples 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const retainedExamples = [
  ['### Colloquial verb → Professional verb', 'The repo pins pnpm@11.7.0 in package.json', '该仓库在 package.json 中固定使用 pnpm@11.7.0'],
  ['### Run-on sentence → Natural phrasing with pause', 'Read docs/architecture.md before changing anything under packages/.', '在修改 packages/ 目录下的任何内容之前，请先阅读 docs/architecture.md。'],
  ['### Stiff passive voice → Active and natural', 'a green gate means the pair was confirmed consistent at these exact contents, not that the confirmation was sound.', '门禁通过意味着这组文档在当前内容上的一致性得到了确认，不代表确认本身正确可靠。'],
  ['### Invented word → Natural expression', 'A sidecar record of both blob hashes makes consistency checkable', '伴随记录保存两侧 blob hash，使一致性可检查'],
  ['### Em-dash → Colon/period', 'FIXME — an issue that should block a new release.', 'FIXME：应当阻塞新版本发布的问题。'],
  ['### Overly literal → Meaningful rendering', 'awkward phrasing is easier to notice when you read the translation without comparing it with the source', '不对照原文阅读译文时，更容易察觉别扭的表达'],
  ['### Terminology — do not translate what should be kept in English', 'typed service seams, and explicit extension points', '类型化的服务 seam 与显式扩展点'],
  ['### Slang/jargon → Professional phrasing', 'The committed agent workflow lives in .agents/skills/dsh-translate-docs', '仓库内置的 agent 工作流见 .agents/skills/dsh-translate-docs'],
  ['### "For humans" — translate the intent, not the word', 'For humans, start with the development guide', '面向开发者：请先阅读开发指南'],
  ['### Code block comments — NEVER translate', '# full-screen TUI coding agent (needs DEEPSEEK_API_KEY)', 'keep exactly as-is, byte-for-byte'],
  ['### Language switcher — flip direction', 'English | [中文](README.zh.md)', '[English](README.md) | 中文'],
]

describe('translation prompt rendering', () => {
  it('renders both directions with every placeholder resolved', () => {
    /** 中文说明：变量 en 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const en = renderTranslationPrompt(document, { sourceLanguage: 'English', sourceFilename: 'guide.md', terminology })
    expect(en).toContain('from English to Chinese')
    expect(en).toContain(terminology)
    expect(en).not.toContain('{{')
    expect(en).toContain('plain source stays plain (必须)')
    expect(en).toContain('For an English target, use the established English technical term')
    expect(en).toContain('does a Chinese target use an established Chinese rendering')
    expect(en).toContain('does an English target use the established English technical term')
    expect(en).toContain('The parser removes exactly one framing escape')
    /** 中文说明：变量 zh 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const zh = renderTranslationPrompt(document, { sourceLanguage: 'Chinese', sourceFilename: 'guide.zh.md', terminology })
    expect(zh).toContain('from Chinese to English')
  })

  it('contains every embedded example', () => {
    /** 中文说明：该循环依次处理输入或事件；循环变量仅在当前循环中有效。 */
    for (const example of retainedExamples) {
      /** 中文说明：该循环依次处理输入或事件；循环变量仅在当前循环中有效。 */
      for (const fragment of example) expect(document).toContain(fragment)
    }
  })

  it('states the selected v7 safeguards', () => {
    /** 中文说明：变量 rendered 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const rendered = renderTranslationPrompt(document, { sourceLanguage: 'English', sourceFilename: 'guide.md', terminology })
    expect(rendered).toContain('## Priority')
    expect(rendered).toContain('### Faithfulness')
    expect(rendered).toContain('do not invent a filename or switcher')
    expect(rendered).toContain('Markdown emphasis markers do not create a word boundary')
    expect(rendered).toContain('Never invent responsibility merely to avoid a passive construction')
    expect(rendered).toContain('Never vary a terminology-table form, defined concept, or contract verb merely for stylistic variety')
    expect(rendered).toContain('Chinese output uses its `.zh.md` path')
    expect(rendered).toContain('belongs to the active bilingual corpus')
    expect(rendered).toContain('a missing counterpart in that corpus is an error')
    expect(rendered).toContain('exact query/fragment suffix')
    expect(rendered).toContain('Return exactly three raw XML sections')
  })

  it('rejects a template with unknown or missing placeholders', () => {
    /** 中文说明：变量 alien 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const alien = document.replaceAll('{{terminology}}', '{{terms_prompt}}')
    expect(() => renderTranslationPrompt(alien, { sourceLanguage: 'English', sourceFilename: 'guide.md', terminology })).toThrow(/unsupported placeholder/)
    /** 中文说明：变量 missing 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const missing = document.replaceAll('{{terminology}}', '')
    expect(() => renderTranslationPrompt(missing, { sourceLanguage: 'English', sourceFilename: 'guide.md', terminology })).toThrow(/required placeholder/)
  })

  it('rejects unmatched placeholder delimiters', () => {
    /** 中文说明：该循环依次处理输入或事件；循环变量仅在当前循环中有效。 */
    for (const delimiter of ['{{', '}}']) {
      /** 中文说明：变量 malformed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const malformed = document.replace('Your task is to translate', `Your task ${delimiter} is to translate`)
      expect(() => renderTranslationPrompt(malformed, {
        sourceLanguage: 'English',
        sourceFilename: 'guide.md',
        terminology,
      })).toThrow(/malformed placeholder syntax/)
    }
  })

  it('assembles bare few-shot turns before the real source document', () => {
    /** 中文说明：变量 request 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const request = renderTranslationRequest(document, {
      sourceLanguage: 'English',
      sourceFilename: 'guide.md',
      sourceDocument: '# Guide\n\nNew source.',
      terminology,
      examples: [{ english: '# Example\n\nEnglish.', chinese: '# 示例\n\n中文。' }],
    })
    expect(request.targetFilename).toBe('guide.zh.md')
    expect(request.messages.map(message => message.role)).toEqual(['system', 'user', 'assistant', 'user'])
    expect(request.messages.slice(1).map(message => message.content)).toEqual([
      '# Example\n\nEnglish.',
      '# 示例\n\n中文。',
      '# Guide\n\nNew source.',
    ])

    /** 中文说明：变量 reverse 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const reverse = renderTranslationRequest(document, {
      sourceLanguage: 'Chinese',
      sourceFilename: 'guide.zh.md',
      sourceDocument: '# 指南\n\n新源文。',
      terminology,
      examples: [{ english: '# Example\n\nEnglish.', chinese: '# 示例\n\n中文。' }],
    })
    expect(reverse.targetFilename).toBe('guide.md')
    expect(reverse.messages.slice(1).map(message => message.content)).toEqual([
      '# 示例\n\n中文。',
      '# Example\n\nEnglish.',
      '# 指南\n\n新源文。',
    ])
  })
})

describe('translation response sections', () => {
  it('round-trips Markdown bodies', () => {
    /** 中文说明：变量 response 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const response = { translation: '# 标题\n\n正文 **加粗**。', review: '- [Tone] 修正一处。\n- 无修正', final: '# 标题\n\n定稿。' }
    expect(parseTranslationResponse(renderTranslationResponse(response))).toEqual(response)
  })

  it('tolerates a fenced xml wrapper around the whole response', () => {
    /** 中文说明：变量 fenced 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fenced = '```xml\n<translation>\nA\n</translation>\n\n<review>\n- 无修正\n</review>\n\n<final>\nA\n</final>\n```'
    expect(parseTranslationResponse(fenced).final).toBe('A')
  })

  it('keeps an inline close tag inside prose from terminating the section', () => {
    /** 中文说明：变量 doc 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const doc = { translation: 'the wire format uses </translation> as its close tag', review: '- 无修正', final: 'F' }
    expect(parseTranslationResponse(renderTranslationResponse(doc))).toEqual(doc)
  })

  it('round-trips wrapper-tag lines inside Markdown bodies', () => {
    /** 中文说明：变量 doc 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const doc = {
      translation: '```xml\n</translation>\n```',
      review: '- [Structure] Preserved `<final>` on its own line.',
      final: 'literal delimiters\n</final>\n\\</final>',
    }
    /** 中文说明：变量 rendered 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const rendered = renderTranslationResponse(doc)
    expect(parseTranslationResponse(rendered)).toEqual(doc)
    expect(() => parseTranslationResponse(rendered.replace('\\</translation>', '</translation>'))).toThrow(/duplicate <translation>/)
  })

  it('rejects a duplicate section appearing before final', () => {
    /** 中文说明：变量 early 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const early = '<translation>\nA\n</translation>\n<translation>\nB\n</translation>\n<review>\nR\n</review>\n<final>\nF\n</final>'
    expect(() => parseTranslationResponse(early)).toThrow(/duplicate <translation>/)
  })

  it('rejects missing, unterminated, or duplicated sections', () => {
    expect(() => parseTranslationResponse('<translation>\nA\n</translation>')).toThrow(/missing or unterminated <review>/)
    expect(() => parseTranslationResponse('<translation>\nA')).toThrow(/missing or unterminated <translation>/)
    /** 中文说明：变量 dup 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dup = '<translation>\nA\n</translation>\n<review>\nR\n</review>\n<final>\nF\n</final>\n<final>\nG\n</final>'
    expect(() => parseTranslationResponse(dup)).toThrow(/duplicate <final>/)
    expect(() => parseTranslationResponse(`${renderTranslationResponse({ translation: 'A', review: 'R', final: 'F' })}\nstray`))
      .toThrow(/content is not allowed outside/)
  })

  it('inserts or corrects the target switcher after parsing a new-pair response', () => {
    /** 中文说明：变量 response 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const response = renderTranslationResponse({
      translation: '# 指南\n\n初稿。',
      review: '- 无修正',
      final: '# 指南\n\nEnglish | [中文](guide.zh.md)\n\n定稿。',
    })
    expect(consumeTranslationResponse(response, { sourceLanguage: 'English', sourceFilename: 'guide.md' }).final).toBe([
      '# 指南',
      '',
      '[English](guide.md) | 中文',
      '',
      '定稿。',
      '',
    ].join('\n'))
  })

  it('preserves YAML frontmatter before inserting the target switcher', () => {
    /** 中文说明：变量 response 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const response = renderTranslationResponse({
      translation: '# 指南\n\n初稿。',
      review: '- 无修正',
      final: [
        '---',
        'layout: home',
        '---',
        '',
        '# 指南',
        '',
        '定稿。',
      ].join('\n'),
    })
    expect(consumeTranslationResponse(response, { sourceLanguage: 'English', sourceFilename: 'guide.md' }).final).toBe([
      '---',
      'layout: home',
      '---',
      '',
      '# 指南',
      '',
      '[English](guide.md) | 中文',
      '',
      '定稿。',
      '',
    ].join('\n'))
  })

  it('rejects unterminated YAML frontmatter before the target H1', () => {
    /** 中文说明：变量 response 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const response = renderTranslationResponse({
      translation: '# 指南\n\n初稿。',
      review: '- 无修正',
      final: '---\nlayout: home\n\n# 指南\n\n定稿。',
    })
    expect(() => consumeTranslationResponse(response, {
      sourceLanguage: 'English',
      sourceFilename: 'guide.md',
    })).toThrow(/unterminated YAML frontmatter/)
  })

  it('rejects a source filename that contradicts the translation direction', () => {
    expect(() => renderTranslationPrompt(document, {
      sourceLanguage: 'Chinese',
      sourceFilename: 'guide.md',
      terminology,
    })).toThrow(/does not match source language Chinese/)
  })

  it('inserts the English target switcher for a Chinese source', () => {
    /** 中文说明：变量 response 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const response = renderTranslationResponse({
      translation: '# Guide\n\nDraft.',
      review: '- [None] No corrections.',
      final: '# Guide\n\nFinal.',
    })
    expect(consumeTranslationResponse(response, {
      sourceLanguage: 'Chinese',
      sourceFilename: 'guide.zh.md',
    }).final).toContain('\n\nEnglish | [中文](guide.zh.md)\n\n')
  })
})
