/** Verify that the committed translation prompt renders and parses as documented. */
/*
 * 文件职责：实现 verify-translation-prompt.ts 覆盖的Agent 预设行为与边界场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、异步协议、进程资源或仓库文本分析。
 * 产品维度：保障 Agent 的Agent 预设能力稳定、可复现且可诊断。
 * 逻辑维度：准备输入和夹具，执行被测或验证流程，再核对结果、错误与资源清理。
 * 关键边界：中文测试字符串不是注释；外部数据不可信；异步资源必须完全释放。
 * 新手阅读建议：先看夹具和公开类型，再读正常流程，最后关注中文输入、失败与清理场景。
 */

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  consumeTranslationResponse,
  documentedTranslationPromptPlaceholders,
  parseTranslationResponse,
  renderTranslationPrompt,
  renderTranslationRequest,
  renderTranslationResponse,
  TRANSLATION_PROMPT_PLACEHOLDERS,
  /** 中文说明：type TranslationExample 定义本脚本所需的数据或行为，用于表达Agent 预设场景。 */
  type TranslationExample,
} from './translation-prompt.ts'

/** 中文说明：变量 root 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const root = resolve(import.meta.dirname, '..')

/** 中文说明：函数 read 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function read(path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

try {
  /** 中文说明：变量 mode 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const mode = process.argv[2]
  if (mode !== undefined && mode !== '--snapshot') throw new Error(`unsupported argument ${JSON.stringify(mode)}`)
  /** 中文说明：变量 document 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const document = read('docs/i18n/translation-prompt.md')
  /** 中文说明：变量 terminology 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const terminology = read('docs/i18n/terminology.md')
  /** 中文说明：变量 examplePaths 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const examplePaths = [
    ['README.md', 'README.zh.md'],
    ['docs/development.md', 'docs/development.zh.md'],
    ['docs/i18n/README.md', 'docs/i18n/README.zh.md'],
    ['docs/i18n/translation-rules.md', 'docs/i18n/translation-rules.zh.md'],
    [
      '.agents/notes/implemented/process/2026-07-02-bilingual-docs-and-pairing-gate.md',
      '.agents/notes/implemented/process/2026-07-02-bilingual-docs-and-pairing-gate.zh.md',
    ],
  ] as const
  /** 中文说明：函数值 examples 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const examples: TranslationExample[] = examplePaths.map(([english, chinese]) => ({
    english: read(english),
    chinese: read(chinese),
  }))
  /** 中文说明：变量 sourceDocument 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const sourceDocument = read('scripts/fixtures/translation-prompt/snapshot-note.md')
  /** 中文说明：变量 recordedResponse 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const recordedResponse = read('scripts/fixtures/translation-prompt/response.txt')
  /** 中文说明：变量 documented 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const documented = documentedTranslationPromptPlaceholders(document)
  if (documented.join('\n') !== TRANSLATION_PROMPT_PLACEHOLDERS.join('\n')) {
    throw new Error(`placeholder table must list exactly: ${TRANSLATION_PROMPT_PLACEHOLDERS.join(', ')}`)
  }

  /** 中文说明：变量 englishInput 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const englishInput = { sourceLanguage: 'English' as const, sourceFilename: 'snapshot-note.md', terminology }
  /** 中文说明：变量 englishSource 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const englishSource = renderTranslationPrompt(document, englishInput)
  /** 中文说明：变量 chineseSource 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const chineseSource = renderTranslationPrompt(document, {
    sourceLanguage: 'Chinese',
    sourceFilename: 'snapshot-note.zh.md',
    terminology,
  })
  if (englishSource.includes('{{') || chineseSource.includes('{{')) throw new Error('rendered prompt contains an unresolved placeholder')
  if (!englishSource.includes('from English to Chinese')) throw new Error('English-source render does not translate into Chinese')
  if (!chineseSource.includes('from Chinese to English')) throw new Error('Chinese-source render does not translate into English')

  /** 中文说明：变量 example 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const example = /```xml\n([\s\S]*?)\n```/.exec(englishSource)?.[1]
  if (example === undefined) throw new Error('rendered prompt has no three-section response example')
  parseTranslationResponse(example)

  /** 中文说明：变量 roundTrip 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const roundTrip = { translation: 'first pass\n\nwith **markdown**', review: '- 无修正', final: 'final text' }
  /** 中文说明：变量 parsed 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const parsed = parseTranslationResponse(renderTranslationResponse(roundTrip))
  if (JSON.stringify(parsed) !== JSON.stringify(roundTrip)) throw new Error('three-section response does not round-trip')

  /** 中文说明：变量 request 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const request = renderTranslationRequest(document, { ...englishInput, sourceDocument, examples })
  if (request.targetFilename !== 'snapshot-note.zh.md') throw new Error('English request resolves the wrong target filename')
  /** 中文说明：函数值 expectedRoles 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const expectedRoles = ['system', ...examples.flatMap(() => ['user', 'assistant']), 'user']
  if (request.messages.map(message => message.role).join('\n') !== expectedRoles.join('\n')) {
    throw new Error('reviewed examples are not assembled as system, example pairs, then source')
  }
  /** 中文说明：变量 consumed 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const consumed = consumeTranslationResponse(recordedResponse, englishInput)
  /** 中文说明：变量 expectedFinalPrefix 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const expectedFinalPrefix = [
    '---',
    'layout: doc',
    '---',
    '',
    '# 快照说明',
    '',
    '[English](snapshot-note.md) | 中文',
    '',
  ].join('\n')
  if (!consumed.final.startsWith(expectedFinalPrefix)) {
    throw new Error('recorded frontmatter response does not preserve metadata and receive the canonical target switcher')
  }

  if (mode === '--snapshot') {
    process.stdout.write(`${JSON.stringify({ request, response: consumed }, null, 2)}\n`)
  } else {
    console.log('verify-translation-prompt: both directions render, reviewed examples assemble, and the consumed response is target-path correct.')
  }
} catch (error) {
  /** 中文说明：变量 message 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const message = error instanceof Error ? error.message : String(error)
  console.error(`verify-translation-prompt: ${message}`)
  process.exit(1)
}
