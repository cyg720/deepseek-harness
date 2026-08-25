/**
 * Acceptance-path coverage for fragment validation in `verify-md-links`: a
 * `#fragment` onto a Markdown target — same-file anchors included — must name
 * a real heading slug or explicit `<a id>`, while non-Markdown fragments and
 * external targets stay out of scope.
 */
/**
 * 文件职责：验证 verify-md-links.spec.ts 覆盖的仓库规范、文档、包或运行时门禁职责。
 * 技术维度：使用 TypeScript、JavaScript、Vitest、Node.js 文件系统、AST、Git 或依赖图分析。
 * 产品维度：保障源码、配置、文档和发布包满足项目约定，阻止不完整变更进入主分支。
 * 逻辑维度：扫描仓库输入，构建检查模型，收集违规项，再输出诊断并设置退出状态。
 * 关键边界：被检查文本与路径不可信；门禁结果必须确定；任何违规都应显式失败。
 * 新手阅读建议：先看规则入口和扫描范围，再读违规收集，最后关注例外、诊断和退出码。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { anchorCache, documentAnchors, findViolations, githubSlug } from './verify-md-links.ts'

/** 中文说明：变量 roots 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const roots: string[] = []
afterEach(() => {
  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** 中文说明：函数 layout 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function layout(files: Record<string, string>): string {
  /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const root = mkdtempSync(join(tmpdir(), 'md-links-'))
  roots.push(root)
  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(root, rel, '..'), { recursive: true })
    writeFileSync(join(root, rel), content)
  }
  return root
}

/** 中文说明：函数 violationsIn 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function violationsIn(root: string, rel: string): { url: string; reason: string }[] {
  return findViolations(join(root, rel), anchorCache(), root).map(({ url, reason }) => ({ url, reason }))
}

describe('documentAnchors', () => {
  it('slugs rendered heading text, suffixes repeats, and reads explicit <a id> anchors', () => {
    /** 中文说明：变量 anchors 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const anchors = documentAnchors([
      '# My Doc',
      '## Live `events` — mode!',
      '## Repeat',
      '## Repeat',
      '<a id="hand-anchor"></a>',
      '',
    ].join('\n'))
    expect(anchors).toEqual(new Set(['my-doc', 'live-events--mode', 'repeat', 'repeat-1', 'hand-anchor']))
    expect(githubSlug('Security and authority are non-goals')).toBe('security-and-authority-are-non-goals')
  })

  it('keeps underscores the way GitHub does', () => {
    expect(githubSlug('Showcase: web_fetch')).toBe('showcase-web_fetch')
    expect(documentAnchors('## Showcase: web_fetch\n')).toEqual(new Set(['showcase-web_fetch']))
  })

  it('slugs a heading containing a link from its rendered text', () => {
    expect(documentAnchors('## [Install](setup.md)\n')).toEqual(new Set(['install']))
  })

  it('bumps repeat suffixes past occupied slugs, matching GitHub', () => {
    /** 中文说明：变量 anchors 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const anchors = documentAnchors(['## Repeat', '## Repeat-1', '## Repeat', ''].join('\n'))
    expect(anchors).toEqual(new Set(['repeat', 'repeat-1', 'repeat-2']))
  })

  it('ignores <a id> inside code fences, inline code, and HTML comments', () => {
    /** 中文说明：变量 anchors 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const anchors = documentAnchors([
      '# Doc',
      '```md',
      '<a id="fenced"></a>',
      '```',
      'Inline `<a id="inline"></a>` sample.',
      '<!-- <a id="commented"></a> -->',
      '<a id="real"></a>',
      '',
    ].join('\n'))
    expect(anchors).toEqual(new Set(['doc', 'real']))
  })
})

describe('findViolations fragments', () => {
  it('accepts resolving same-file and cross-file fragments, non-md fragments, and externals', () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = layout({
      'a.md': '# A\n\n## Deferred work\n\n[self](#deferred-work) [b](b.md#part-two) [code](x.ts#L10) [ext](https://x.example/#frag)\n',
      'b.md': '# B\n\n## Part two\n',
      'x.ts': 'export {}\n',
    })
    expect(violationsIn(root, 'a.md')).toEqual([])
  })

  it('rejects a same-file fragment that names no heading or <a id>', () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = layout({ 'a.md': '# A\n\n[gone](#deferred-work)\n' })
    expect(violationsIn(root, 'a.md')).toEqual([{ url: '#deferred-work', reason: 'anchor' }])
  })

  it('rejects a case-variant fragment: element ids are case-sensitive', () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = layout({ 'a.md': '# A\n\n## Default Loop\n\n[case](#Default-Loop)\n' })
    expect(violationsIn(root, 'a.md')).toEqual([{ url: '#Default-Loop', reason: 'anchor' }])
  })

  it('rejects a cross-file fragment missing from the target document', () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = layout({
      'a.md': '# A\n\n[stale](b.md#old-heading)\n',
      'b.md': '# B\n\n## New heading\n',
    })
    expect(violationsIn(root, 'a.md')).toEqual([{ url: 'b.md#old-heading', reason: 'anchor' }])
  })

  it('still rejects a missing target file, reported as target not anchor', () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = layout({ 'a.md': '# A\n\n[ghost](missing.md#anything)\n' })
    expect(violationsIn(root, 'a.md')).toEqual([{ url: 'missing.md#anything', reason: 'target' }])
  })
})
