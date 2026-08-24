import { describe, expect, it } from 'vitest'
import { extractMarkdownPlainText } from '@deepseek-ai/dsh-client-ui-primitives'

/** 覆盖标题、段落、链接、图片、列表、行内代码和代码块的综合 Markdown 样本。 */
const MARKDOWN = [
  '# Release notes',
  '',
  'First **paragraph** with [a link](https://example.com) and ![diagram](diagram.png).',
  '',
  '- shipped',
  '- `verified`',
  '',
  '```ts',
  'const ready = true',
  '```',
].join('\n')

/** 中文：extractMarkdownPlainText 的 GFM 纯文本投影测试组。 */
describe('extractMarkdownPlainText', () => {
  /** 中文：完整文档去除展示语法但保留段落和可见文字；无参数和返回值。 */
  it('projects the complete GFM document without presentation syntax', () => {
    expect(extractMarkdownPlainText(MARKDOWN)).toBe([
      'Release notes',
      '',
      'First paragraph with a link and diagram.',
      '',
      'shipped',
      'verified',
      '',
      'const ready = true',
    ].join('\n'))
  })

  /** 中文：first-line 取首个可见行，first-paragraph 取首个语义段落；无参数和返回值。 */
  it('selects the first visible line or first semantic paragraph', () => {
    expect(extractMarkdownPlainText(MARKDOWN, { mode: 'first-line' })).toBe('Release notes')
    expect(extractMarkdownPlainText(MARKDOWN, { mode: 'first-paragraph' }))
      .toBe('First paragraph with a link and diagram.')
  })

  /** 中文：保留原始 HTML，同时移除包围它的 Markdown 强调语法；无参数和返回值。 */
  it('preserves raw HTML while removing Markdown presentation markup', () => {
    /** 模拟后台任务完成标签的多行原始 HTML 块。 */
    const block = [
      '<background-job-complete id="trajectory-ui-watch">',
      'Command: pnpm test',
      'Exit code: 0',
      '</background-job-complete>',
    ].join('\n')
    expect(extractMarkdownPlainText(block)).toBe(block)
    expect(extractMarkdownPlainText('**Status:** <span data-state="ok">ready</span>'))
      .toBe('Status: <span data-state="ok">ready</span>')
    expect(extractMarkdownPlainText(block, { mode: 'first-paragraph' }))
      .toBe('<background-job-complete id="trajectory-ui-watch">')
  })

  /** 中文：验证引用、硬换行、分隔线、表格和引用定义的投影；无参数和返回值。 */
  it('projects GFM tables, references, hard breaks, and block structure', () => {
    /** 覆盖 GFM 引用、硬换行、图片引用、HTML、分隔线和表格的样本。 */
    const markdown = [
      '> first\\',
      '> second with ![diagram][asset] and <span>visible</span>',
      '',
      '---',
      '',
      '| Name | Value |',
      '| --- | --- |',
      '| alpha | `1` |',
      '',
      '[asset]: diagram.png',
    ].join('\n')
    expect(extractMarkdownPlainText(markdown)).toBe([
      'first second with diagram and <span>visible</span>',
      '',
      'Name\tValue',
      'alpha\t1',
    ].join('\n'))
  })
})
/**
 * 中文说明：
 * - 文件职责：验证 Markdown 到纯文本投影对完整文档、首行/首段、HTML 和 GFM 结构的处理。
 * - 技术维度：使用 Vitest、GFM 解析语义和字符串快照式精确比较。
 * - 产品维度：为摘要、复制和无样式预览提供保留语义但去除展示标记的文本。
 * - 逻辑维度：固定综合 Markdown 样本，依次测试完整投影、选择模式、原始 HTML 和表格/引用结构。
 * - 关键边界：原始 HTML 必须保留；图片保留替代文本；引用定义与分隔线不产生可见文字。
 * - 新手阅读建议：先对照 MARKDOWN 与第一例输出，再看 mode 参数如何缩小结果范围。
 */
