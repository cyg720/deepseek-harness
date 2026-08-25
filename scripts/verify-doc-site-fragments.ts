/**
 * Verify fragment links against the HTML emitted by VitePress, and that the
 * build carries the raw-Markdown twin of every route plus llms.txt. Markdown
 * and VitePress use different heading-slug algorithms, so source-link
 * validation alone cannot prove that a published fragment exists.
 *
 * This runs as part of `docs:build` and can also run directly after a build
 * with `tsx scripts/verify-doc-site-fragments.ts`.
 */
/**
 * 文件职责：实现 verify-doc-site-fragments.ts 覆盖的仓库规范、文档、包或运行时门禁职责。
 * 技术维度：使用 TypeScript、JavaScript、Vitest、Node.js 文件系统、AST、Git 或依赖图分析。
 * 产品维度：保障源码、配置、文档和发布包满足项目约定，阻止不完整变更进入主分支。
 * 逻辑维度：扫描仓库输入，构建检查模型，收集违规项，再输出诊断并设置退出状态。
 * 关键边界：被检查文本与路径不可信；门禁结果必须确定；任何违规都应显式失败。
 * 新手阅读建议：先看规则入口和扫描范围，再读违规收集，最后关注例外、诊断和退出码。
 */

import { existsSync, globSync, readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { JSDOM } from 'jsdom'
import { rawMarkdownFiles } from './project-doc-site.ts'

/** 中文说明：变量 root 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const root = resolve(import.meta.dirname, '..')

/** One fragment reference that does not resolve in the built site. */
/** 中文说明：interface BrokenSiteFragment 定义本脚本所需的数据或行为，用于表达仓库门禁场景。 */
export interface BrokenSiteFragment {
  /** HTML file containing the link. */
  source: string
  /** Link value as emitted by VitePress. */
  href: string
  /** Built HTML target, or `undefined` when the route was not emitted. */
  target?: string
  /** Decoded fragment id requested by the link. */
  fragment: string
}

/** Result of checking every fragment-bearing anchor in a built site. */
/** 中文说明：interface SiteFragmentReport 定义本脚本所需的数据或行为，用于表达仓库门禁场景。 */
export interface SiteFragmentReport {
  /** Number of internal fragment references inspected. */
  checked: number
  /** References whose route or fragment id is absent. */
  broken: BrokenSiteFragment[]
}

/** 中文说明：interface BuiltPage 定义本脚本所需的数据或行为，用于表达仓库门禁场景。 */
interface BuiltPage {
  file: string
  route: string
  ids: Set<string>
  document: Document
}

/** 中文说明：函数 posixPath 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function posixPath(path: string): string {
  return path.split(sep).join('/')
}

/** 中文说明：函数 routeFor 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function routeFor(file: string): string {
  if (file === 'index.html') return '/'
  if (file.endsWith('/index.html')) return `/${file.slice(0, -'index.html'.length)}`
  return `/${file.slice(0, -'.html'.length)}`
}

/** 中文说明：函数 aliasesFor 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function aliasesFor(page: BuiltPage): string[] {
  if (page.route === '/') return ['/', '/index', '/index.html']
  if (page.route.endsWith('/')) {
    /** 中文说明：变量 stem 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const stem = page.route.slice(0, -1)
    return [page.route, stem, `${stem}/index`, `${stem}/index.html`]
  }
  return [page.route, `${page.route}.html`]
}

/** 中文说明：函数 decodedFragment 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function decodedFragment(hash: string): string {
  try {
    return decodeURIComponent(hash.slice(1))
  } catch (error) {
    if (!(error instanceof URIError)) throw error
    // URIError means malformed percent encoding; preserve the literal id for comparison.
    return hash.slice(1)
  }
}

/**
 * Check fragment-bearing links in a VitePress output directory.
 *
 * @param distRoot - Directory containing generated HTML files.
 * @returns Counted internal links and every unresolved target.
 */
/** 中文说明：函数 inspectSiteFragments 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function inspectSiteFragments(distRoot: string): SiteFragmentReport {
  /** 中文说明：变量 files 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const files = globSync('**/*.html', { cwd: distRoot }).map(posixPath).sort()
  if (files.length === 0) {
    throw new Error(`verify-doc-site-fragments: no HTML files found under ${distRoot}; run docs:build first.`)
  }
  /** 中文说明：函数值 pages 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const pages: BuiltPage[] = files.map((file) => {
    /** 中文说明：变量 document 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const document = new JSDOM(readFileSync(resolve(distRoot, file), 'utf8')).window.document
    /** 中文说明：变量 ids 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ids = new Set<string>()
    /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
    for (const element of document.querySelectorAll<HTMLElement>('[id]')) ids.add(element.id)
    /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
    for (const element of document.querySelectorAll<HTMLAnchorElement>('a[name]')) {
      /** 中文说明：变量 name 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const name = element.getAttribute('name')
      if (name !== null) ids.add(name)
    }
    return { file, route: routeFor(file), ids, document }
  })

  /** 中文说明：变量 byRoute 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const byRoute = new Map<string, BuiltPage>()
  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const page of pages) {
    /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
    for (const alias of aliasesFor(page)) {
      /** 中文说明：变量 existing 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const existing = byRoute.get(alias)
      if (existing !== undefined && existing !== page) {
        throw new Error(
          `verify-doc-site-fragments: built pages ${existing.file} and ${page.file} share route ${JSON.stringify(alias)}.`,
        )
      }
      byRoute.set(alias, page)
    }
  }

  /** 中文说明：变量 origin 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const origin = 'https://dsh-docs.invalid'
  /** 中文说明：变量 broken 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const broken: BrokenSiteFragment[] = []
  /** 中文说明：变量 checked 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let checked = 0
  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const page of pages) {
    /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
    for (const anchor of page.document.querySelectorAll<HTMLAnchorElement>('a[href]')) {
      /** 中文说明：变量 href 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const href = anchor.getAttribute('href')
      if (href === null || !href.includes('#')) continue
      /** 中文说明：变量 targetUrl 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      let targetUrl: URL
      try {
        targetUrl = new URL(href, `${origin}${page.route}`)
      } catch (error) {
        throw new Error(
          `verify-doc-site-fragments: ${page.file} has invalid fragment href ${JSON.stringify(href)}.`,
          { cause: error },
        )
      }
      if (targetUrl.origin !== origin || targetUrl.hash === '') continue
      /** 中文说明：变量 fragment 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const fragment = decodedFragment(targetUrl.hash)
      if (fragment === '') continue
      checked++
      /** 中文说明：变量 target 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const target = byRoute.get(targetUrl.pathname)
      if (target === undefined || !target.ids.has(fragment)) {
        broken.push({
          source: page.file,
          href,
          ...(target === undefined ? {} : { target: target.file }),
          fragment,
        })
      }
    }
  }
  return { checked, broken }
}

/**
 * Expected files a build did not emit.
 *
 * @param distRoot - Directory containing the built site.
 * @param expected - Site-relative files the build must carry.
 * @returns The absent files, in the given order.
 */
/** 中文说明：函数 missingSiteFiles 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function missingSiteFiles(distRoot: string, expected: readonly string[]): string[] {
  return expected.filter(file => !existsSync(resolve(distRoot, file)))
}

/** 中文说明：函数 main 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function main(): number {
  /** 中文说明：变量 distRoot 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const distRoot = resolve(root, 'website/.dist')
  /** 中文说明：变量 report 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const report = inspectSiteFragments(distRoot)
  /** 中文说明：变量 expected 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const expected = rawMarkdownFiles()
  /** 中文说明：变量 missing 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const missing = missingSiteFiles(distRoot, [...expected, 'llms.txt'])
  if (report.broken.length === 0 && missing.length === 0) {
    console.log(
      `verify-doc-site-fragments: ${report.checked} internal fragment reference(s) resolve;`
      + ` ${expected.length} raw-Markdown file(s) and llms.txt emitted.`,
    )
    return 0
  }

  if (report.broken.length > 0) {
    console.error(`verify-doc-site-fragments: ${report.broken.length} broken fragment reference(s):`)
    /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
    for (const item of report.broken) {
      /** 中文说明：变量 target 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const target = item.target === undefined ? 'target route was not built' : `${item.target} has no id ${JSON.stringify(item.fragment)}`
      console.error(`  ${item.source}: ${JSON.stringify(item.href)} (${target})`)
    }
  }
  if (missing.length > 0) {
    console.error(`verify-doc-site-fragments: ${missing.length} expected raw-Markdown file(s) missing from the build:`)
    /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
    for (const file of missing) console.error(`  ${file}`)
  }
  return 1
}

if (import.meta.main) process.exitCode = main()
