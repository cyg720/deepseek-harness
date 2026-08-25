/** Regression tests for the minimal-update briefing assembly. */
/*
 * 文件职责：验证 translation-brief.spec.ts 覆盖的Agent 预设行为与边界场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、异步协议、进程资源或仓库文本分析。
 * 产品维度：保障 Agent 的Agent 预设能力稳定、可复现且可诊断。
 * 逻辑维度：准备输入和夹具，执行被测或验证流程，再核对结果、错误与资源清理。
 * 关键边界：中文测试字符串不是注释；外部数据不可信；异步资源必须完全释放。
 * 新手阅读建议：先看夹具和公开类型，再读正常流程，最后关注中文输入、失败与清理场景。
 */

import { describe, expect, it } from 'vitest'
import {
  changedSpanIndices,
  computeMechanicalUpdate,
  firstOccurrenceContext,
  markdownUnits,
  parseTerminologyRows,
  relevantTerminologyRows,
  renderTranslationBrief,
  sectionSpans,
  spansAligned,
  termOffsets,
} from './translation-brief.ts'

/** 中文说明：常量 DOC 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const DOC = [
  'Preamble line.',
  '',
  '# Title',
  '',
  'Intro paragraph.',
  '',
  '## First',
  '',
  'First body.',
  '',
  '```ts',
  'const value = 1',
  '```',
  '',
  '## Second',
  '',
  '| A | B |',
  '|---|---|',
  '| 1 | 2 |',
  '',
  '- item one',
  '- item two',
].join('\n')

describe('markdown spans', () => {
  it('lists units with container-scoped kinds in document order', () => {
    /** 中文说明：函数值 kinds 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const kinds = markdownUnits(DOC).map(span => span.kind)
    expect(kinds).toEqual([
      'root.0:paragraph',
      'root.1:heading:1',
      'root.2:paragraph',
      'root.3:heading:2',
      'root.4:paragraph',
      'root.5:code',
      'root.6:heading:2',
      'root.7.0:tableRow',
      'root.7.1:tableRow',
      'root.8.0:listItem',
      'root.8.1:listItem',
    ])
  })

  it('lists heading sections with a preamble span and heading labels', () => {
    /** 中文说明：变量 sections 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sections = sectionSpans(DOC)
    expect(sections.map(span => span.label)).toEqual([
      '(preamble before the first heading)',
      'Title',
      'First',
      'Second',
    ])
    expect(sections[0]).toMatchObject({ startLine: 1, endLine: 2 })
    expect(sections[2]).toMatchObject({ startLine: 7, endLine: 14 })
  })

  it('labels units by their node type', () => {
    /** 中文说明：变量 units 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const units = markdownUnits(DOC)
    expect(units[0]!.label).toBe('paragraph')
    expect(units[1]!.label).toBe('heading')
    expect(units[7]!.label).toBe('tableRow')
  })

  it('aligns sections by depth only, so translated heading text still maps', () => {
    /** 中文说明：变量 zh 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const zh = DOC.replace('## First', '## 第一节').replace('## Second', '## 第二节').replace('# Title', '# 标题')
    expect(spansAligned(sectionSpans(DOC), sectionSpans(zh))).toBe(true)
  })

  it('aligns span lists only on equal non-empty kind sequences', () => {
    /** 中文说明：变量 zh 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const zh = DOC.replace('First body.', '第一段。').replace('item one', '第一项').replace('Intro paragraph.', '导语。')
    expect(spansAligned(markdownUnits(DOC), markdownUnits(zh))).toBe(true)
    /** 中文说明：变量 reshaped 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const reshaped = DOC.replace('- item one\n- item two', 'merged paragraph')
    expect(spansAligned(markdownUnits(DOC), markdownUnits(reshaped))).toBe(false)
    expect(spansAligned([], [])).toBe(false)
  })

  it('reports the indices whose text changed', () => {
    /** 中文说明：变量 edited 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const edited = DOC.replace('First body.', 'First body, revised.').replace('| 1 | 2 |', '| 1 | 3 |')
    expect(changedSpanIndices(markdownUnits(DOC), markdownUnits(edited))).toEqual([4, 8])
  })
})

describe('mechanical code updates', () => {
  /** 中文说明：变量 en 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const en = '# T\n\nProse.\n\n```sh\nrun one\n```\n'
  /** 中文说明：变量 zh 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const zh = '# T\n\n中文。\n\n```sh\nrun one\n```\n'

  it('splices a fence-only edit into the counterpart', () => {
    /** 中文说明：变量 edited 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const edited = en.replace('run one', 'run two')
    expect(computeMechanicalUpdate(en, edited, zh)).toBe(zh.replace('run one', 'run two'))
  })

  it('refuses when prose changed too', () => {
    /** 中文说明：变量 edited 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const edited = en.replace('Prose.', 'Prose!').replace('run one', 'run two')
    expect(computeMechanicalUpdate(en, edited, zh)).toBeUndefined()
  })

  it('refuses when the counterpart fences already diverge from last-confirmed', () => {
    /** 中文说明：变量 edited 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const edited = en.replace('run one', 'run two')
    expect(computeMechanicalUpdate(en, edited, zh.replace('run one', 'run stale'))).toBeUndefined()
  })

  it('refuses when fence counts differ or nothing changed', () => {
    expect(computeMechanicalUpdate(en, `${en}\n\`\`\`sh\nextra\n\`\`\`\n`, zh)).toBeUndefined()
    expect(computeMechanicalUpdate(en, en, zh)).toBeUndefined()
  })
})

/** 中文说明：常量 TERMINOLOGY 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const TERMINOLOGY = [
  '| English | 中文 | 首次出现 | 不要译作 | 备注 |',
  '|---|---|---|---|---|',
  '| agent | agent | agent（智能体） | 智能体 | |',
  '| session log | 会话日志 | | 会话记录 | |',
  '| gate | 门禁 | | | |',
  '| registry | 注册表 | | | |',
].join('\n')

describe('terminology', () => {
  it('parses data rows and skips the header and separator', () => {
    /** 中文说明：变量 rows 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const rows = parseTerminologyRows(TERMINOLOGY)
    expect(rows.map(row => row.english)).toEqual(['agent', 'session log', 'gate', 'registry'])
    expect(rows[0]).toMatchObject({ chinese: 'agent', first: 'agent（智能体）' })
  })

  it('matches English terms on word boundaries with plural inflections', () => {
    expect(termOffsets('two agents met', 'agent', true)).toEqual([4])
    expect(termOffsets('two registries', 'registry', true)).toEqual([4])
    expect(termOffsets('reagents', 'agent', true)).toEqual([])
    expect(termOffsets('', 'agent', true)).toEqual([])
  })

  it('selects rows for the changed text per direction', () => {
    expect(relevantTerminologyRows(TERMINOLOGY, 'en-to-zh', 'All agents write a session log.').map(row => row.english))
      .toEqual(['agent', 'session log'])
    expect(relevantTerminologyRows(TERMINOLOGY, 'zh-to-en', '门禁在提交时运行。').map(row => row.english))
      .toEqual(['gate'])
    expect(relevantTerminologyRows(TERMINOLOGY, 'en-to-zh', 'delegate the work')).toEqual([])
  })
})

describe('first-occurrence tracking', () => {
  /** 中文说明：变量 before 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const before = '# T\n\nAlpha paragraph.\n\nThe agent runs.\n'
  /** 中文说明：变量 after 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const after = '# T\n\nAlpha paragraph with an agent.\n\nThe agent runs.\n'
  /** 中文说明：函数值 rows 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  const rows = parseTerminologyRows(TERMINOLOGY).filter(row => row.english === 'agent')

  it('flags a moved first occurrence and pulls the vacated span in', () => {
    /** 中文说明：变量 context 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const context = firstOccurrenceContext(
      before, after, markdownUnits(before), markdownUnits(after), rows, new Set([1]),
    )
    expect(context.notes).toHaveLength(1)
    expect(context.notes[0]).toContain('moved from #2 to #1')
    expect(context.extraSpanIndices).toEqual([2])
  })

  it('stays silent when the first occurrence does not move', () => {
    /** 中文说明：变量 unmoved 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const unmoved = before.replace('Alpha paragraph.', 'Alpha paragraph, revised.')
    /** 中文说明：变量 context 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const context = firstOccurrenceContext(
      before, unmoved, markdownUnits(before), markdownUnits(unmoved), rows, new Set([1]),
    )
    expect(context.notes).toEqual([])
    expect(context.extraSpanIndices).toEqual([])
  })

  it('ignores rows without a first-occurrence rendering', () => {
    /** 中文说明：函数值 bare 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const bare = parseTerminologyRows(TERMINOLOGY).filter(row => row.english === 'gate')
    /** 中文说明：变量 withGate 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const withGate = after.replace('The agent runs.', 'The gate runs.')
    /** 中文说明：变量 context 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const context = firstOccurrenceContext(
      before, withGate, markdownUnits(before), markdownUnits(withGate), bare, new Set([2]),
    )
    expect(context.notes).toEqual([])
  })
})

describe('brief rendering', () => {
  /** 中文说明：变量 base 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const base = {
    sourcePath: 'docs/foo.md',
    counterpartPath: 'docs/foo.zh.md',
    direction: 'en-to-zh' as const,
    diff: '@@ -5 +5 @@\n-old text about the agent\n+new text about the agent',
    terminology: relevantTerminologyRows(TERMINOLOGY, 'en-to-zh', 'the agent'),
  }
  /** 中文说明：变量 bundle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const bundle = {
    index: 4,
    label: 'paragraph',
    confirmedSourceText: 'old text about the agent\n',
    currentSourceText: 'new text about the agent\n',
    counterpartText: '关于 agent 的旧文本\n',
    counterpartStartLine: 9,
  }

  it('renders unit bundles with three-way context and line anchors', () => {
    /** 中文说明：变量 brief 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const brief = renderTranslationBrief({
      ...base,
      scope: { kind: 'units', bundles: [bundle], firstOccurrenceNotes: ['agent: the document-wide first occurrence moved from #2 to #1; the agent（智能体） form moves with it (later occurrences drop the annotation).'] },
    })
    expect(brief).toContain('# Translation update briefing: docs/foo.md')
    expect(brief).toContain('## Changed units')
    expect(brief).toContain('### #4 paragraph — counterpart at docs/foo.zh.md:9')
    expect(brief).toContain('Last-confirmed English:')
    expect(brief).toContain('Current Chinese (bring this along):')
    expect(brief).toContain('## First-occurrence notes')
    expect(brief).toContain('agent（智能体）')
    expect(brief).toContain('首次出现 annotations attach to the document-wide first occurrence only')
    expect(brief).toContain('targets in the active bilingual corpus use `.zh.md` for Chinese')
    expect(brief).toContain('a missing in-scope counterpart is an error')
    expect(brief).toContain('verify-translation-pairing --write docs/foo.md')
  })

  it('marks first-occurrence bundles and omits their unchanged confirmed text', () => {
    /** 中文说明：变量 brief 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const brief = renderTranslationBrief({
      ...base,
      scope: {
        kind: 'units',
        bundles: [{ ...bundle, reason: 'first-occurrence', confirmedSourceText: bundle.currentSourceText }],
        firstOccurrenceNotes: [],
      },
    })
    expect(brief).toContain('unchanged; included for a first-occurrence move')
    expect(brief).not.toContain('Last-confirmed English:')
  })

  it('renders the mechanical scope with the --apply command', () => {
    /** 中文说明：变量 brief 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const brief = renderTranslationBrief({ ...base, scope: { kind: 'mechanical' } })
    expect(brief).toContain('## Mechanical update — no translation judgment involved')
    expect(brief).toContain('gen-translation-brief --apply docs/foo.md')
    expect(brief).not.toContain('## Changed units')
  })

  it('renders the section fallback under its own heading', () => {
    /** 中文说明：变量 brief 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const brief = renderTranslationBrief({
      ...base,
      scope: { kind: 'sections', bundles: [bundle], firstOccurrenceNotes: [] },
    })
    expect(brief).toContain('## Changed sections')
    expect(brief).toContain('fine-grained units do not align')
  })

  it('renders the document fallback with its reason and no bundles', () => {
    /** 中文说明：变量 brief 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const brief = renderTranslationBrief({
      ...base,
      scope: { kind: 'document', reason: 'BOTH sides changed since the pair was last confirmed consistent, so no side is a trustworthy mapping anchor; decide which side owns each divergence.' },
    })
    expect(brief).toContain('## Whole-document update required')
    expect(brief).toContain('BOTH sides changed')
    expect(brief).toContain('locate the affected regions yourself')
  })

  it('renders the English-target digest for zh-to-en updates', () => {
    /** 中文说明：变量 brief 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const brief = renderTranslationBrief({
      ...base,
      direction: 'zh-to-en',
      sourcePath: 'docs/foo.zh.md',
      counterpartPath: 'docs/foo.md',
      scope: { kind: 'units', bundles: [bundle], firstOccurrenceNotes: [] },
    })
    expect(brief).toContain('exactly what the new Chinese states')
    expect(brief).toContain('targets in the active bilingual corpus use `.md` for English')
    expect(brief).toContain('targets outside the corpus keep the authored path')
    expect(brief).toContain('verify-translation-pairing --write docs/foo.md')
  })

  it('grows bundle fences past tilde runs in the text', () => {
    /** 中文说明：变量 brief 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const brief = renderTranslationBrief({
      ...base,
      scope: {
        kind: 'units',
        bundles: [{ ...bundle, counterpartText: '~~~~\ninner\n~~~~\n' }],
        firstOccurrenceNotes: [],
      },
    })
    expect(brief).toContain('~~~~~markdown')
  })
})
