import { describe, expect, it } from 'vitest'
import { findUnavailableRepositoryReferences } from './verify-public-repository-links.ts'

/** 中文：公共仓库链接策略测试组。 */
describe('repository link policy', () => {
  /** 中文：识别不可用仓库的大小写和四种编码表示，同时忽略合法相邻名称；无参数和返回值。 */
  it('rejects encoded and case-varied references to the unavailable repository', () => {
    /** 不可用仓库的所有者名称，由片段拼接避免门禁误扫测试源码本身。 */
    const unavailableOwner = ['deepseek', 'ai'].join('-')
    /** 不可用仓库名。 */
    const unavailableName = ['deepseek', 'harness', 'sdk'].join('-')
    /** 完整 owner/name 形式。 */
    const unavailableRepository = `${unavailableOwner}/${unavailableName}`
    /** 连字符和斜杠采用百分号编码的形式。 */
    const encodedRepository = unavailableRepository.replaceAll('-', '%2D').replace('/', '%2F')
    /** 斜杠采用 HTML 实体编码的形式。 */
    const htmlEncodedRepository = unavailableRepository.replace('/', '&#x2f;')
    /** 斜杠采用 JSON 转义的形式。 */
    const jsonEscapedRepository = unavailableRepository.replace('/', '\\/')
    /** 斜杠采用 Unicode 转义的形式。 */
    const unicodeEscapedRepository = unavailableRepository.replace('/', String.raw`\u002f`)
    /** 包含一个合法公开链接、五个非法变体和两个近似合法链接的多行源码。 */
    const source = [
      'https://github.com/deepseek-ai/deepseek-harness',
      `https://github.com/${unavailableRepository.toUpperCase()}/issues/1`,
      `https://github.com/${encodedRepository}/issues/2`,
      `https://github.com/${htmlEncodedRepository}/issues/3`,
      `"https:\\/\\/github.com\\/${jsonEscapedRepository}\\/issues\\/4"`,
      `"https:\\/\\/github.com\\/${unicodeEscapedRepository}\\/issues\\/5"`,
      `https://github.com/${unavailableOwner}/cordis`,
      `https://github.com/example/${unavailableName}`,
    ].join('\n')

    expect(findUnavailableRepositoryReferences('subject.md', source)).toEqual([
      { file: 'subject.md', line: 2 },
      { file: 'subject.md', line: 3 },
      { file: 'subject.md', line: 4 },
      { file: 'subject.md', line: 5 },
      { file: 'subject.md', line: 6 },
    ])
  })

  /** 中文：冻结归档 Agent Note 忽略不可用链接，活动记录仍报告；无参数和返回值。 */
  it('preserves frozen archived Agent Notes', () => {
    /** 用片段拼出的不可用 owner/name。 */
    const unavailableRepository = ['deepseek-ai', 'deepseek-harness-sdk'].join('/')

    expect(findUnavailableRepositoryReferences(
      '.agents/notes/archived/process/historical-record.md',
      `https://github.com/${unavailableRepository}`,
    )).toEqual([])
    expect(findUnavailableRepositoryReferences(
      '.agents/notes/implemented/process/active-record.md',
      `https://github.com/${unavailableRepository}`,
    )).toEqual([{ file: '.agents/notes/implemented/process/active-record.md', line: 1 }])
  })
})
/**
 * 中文说明：
 * - 文件职责：验证公共仓库链接门禁能识别不可用仓库的大小写、URL/HTML/JSON/Unicode 编码变体。
 * - 技术维度：使用 Vitest、字符串编码变换和逐行位置诊断。
 * - 产品维度：避免公开文档指向不可访问仓库，同时保护冻结归档记录不被追溯修改。
 * - 逻辑维度：构造多种等价链接及相邻合法链接，再验证命中行；另测归档与活动 Agent Note。
 * - 关键边界：冻结 archived 路径必须忽略，implemented 活动记录仍受门禁约束。
 * - 新手阅读建议：先看 unavailableRepository 的逐步编码，再对照期望第 2 至 6 行命中。
 */
