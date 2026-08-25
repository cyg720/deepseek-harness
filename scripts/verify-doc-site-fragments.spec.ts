/** Tests for built-site fragment validation. */
/*
 * 文件职责：验证 verify-doc-site-fragments.spec.ts 覆盖的仓库规范、文档、包或运行时门禁职责。
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
import { inspectSiteFragments, missingSiteFiles } from './verify-doc-site-fragments.ts'

/** 中文说明：变量 roots 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const roots: string[] = []

afterEach(() => {
  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** 中文说明：函数 fixture 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function fixture(): string {
  /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const root = mkdtempSync(join(tmpdir(), 'dsh-doc-fragments-'))
  roots.push(root)
  mkdirSync(join(root, 'guide'), { recursive: true })
  writeFileSync(join(root, 'index.html'), '<a id="home"></a><a href="/guide/start#ready">start</a>')
  writeFileSync(join(root, 'guide/start.html'), [
    '<h1 id="ready">Ready</h1>',
    '<a name="legacy"></a>',
    '<a href="#ready">same page</a>',
    '<a href="./start.html#legacy">html alias</a>',
    '<a href="../#home">root</a>',
    '<a href="https://example.com/page#missing">external</a>',
  ].join(''))
  return root
}

describe('inspectSiteFragments', () => {
  it('rejects a directory with no built pages', () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = mkdtempSync(join(tmpdir(), 'dsh-doc-fragments-empty-'))
    roots.push(root)

    expect(() => inspectSiteFragments(root)).toThrow('no HTML files found')
  })

  it('resolves clean, encoded, and same-page routes', () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = fixture()
    writeFileSync(
      join(root, 'guide/encoded.html'),
      '<h1 id="a b">Encoded</h1><h2 id="%">Literal</h2><a href="./encoded#a%20b">encoded</a><a href="#%">literal</a>',
    )

    expect(inspectSiteFragments(root)).toEqual({ checked: 6, broken: [] })
  })

  it('rejects ambiguous built routes', () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = fixture()
    writeFileSync(join(root, 'guide.html'), '<h1 id="flat">Flat</h1>')
    writeFileSync(join(root, 'guide/index.html'), '<h1 id="index">Index</h1>')

    expect(() => inspectSiteFragments(root)).toThrow('share route "/guide"')
  })

  it('rejects malformed fragment hrefs', () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = fixture()
    writeFileSync(join(root, 'guide/invalid.html'), '<a href="http://[invalid]#fragment">invalid</a>')

    expect(() => inspectSiteFragments(root)).toThrow(
      'guide/invalid.html has invalid fragment href "http://[invalid]#fragment"',
    )
  })

  it('reports missing ids and missing built routes', () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = fixture()
    writeFileSync(join(root, 'guide/broken.html'), [
      '<a href="./start#missing">id</a>',
      '<a href="./absent#missing">route</a>',
    ].join(''))

    expect(inspectSiteFragments(root).broken).toEqual([
      {
        source: 'guide/broken.html',
        href: './start#missing',
        target: 'guide/start.html',
        fragment: 'missing',
      },
      {
        source: 'guide/broken.html',
        href: './absent#missing',
        fragment: 'missing',
      },
    ])
  })
})

describe('missingSiteFiles', () => {
  it('reports the expected files a build did not emit', () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = fixture()
    writeFileSync(join(root, 'guide/start.md'), '# Ready\n')

    expect(missingSiteFiles(root, ['guide/start.md', 'guide/absent.md', 'llms.txt']))
      .toEqual(['guide/absent.md', 'llms.txt'])
  })
})
