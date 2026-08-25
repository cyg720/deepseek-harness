/**
 * Verify that relative Markdown links, images, and definitions resolve — the
 * target file must exist AND a `#fragment` onto a Markdown target (including
 * a same-file `#anchor`) must name a real heading slug or explicit `<a id>`.
 * URL and root-absolute targets are excluded; query strings do not affect
 * resolution against the source file. The checker never rewrites, and
 * symlinked instruction files are deduped.
 */
/*
 * 文件职责：实现 verify-md-links.ts 覆盖的仓库规范、文档、包或运行时门禁职责。
 * 技术维度：使用 TypeScript、JavaScript、Vitest、Node.js 文件系统、AST、Git 或依赖图分析。
 * 产品维度：保障源码、配置、文档和发布包满足项目约定，阻止不完整变更进入主分支。
 * 逻辑维度：扫描仓库输入，构建检查模型，收集违规项，再输出诊断并设置退出状态。
 * 关键边界：被检查文本与路径不可信；门禁结果必须确定；任何违规都应显式失败。
 * 新手阅读建议：先看规则入口和扫描范围，再读违规收集，最后关注例外、诊断和退出码。
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import type { Nodes } from 'mdast'
import { markdownHeadingLines, parseMarkdown, visitMarkdown } from './markdown.ts'
import { isArchivedAgentNotePath, uniqueRepoFiles } from './repo-files.ts'

/** 中文说明：变量 root 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const root = resolve(import.meta.dirname, '..')

/** Repo-authored Markdown checked for relative links. */
/* 中文说明：常量 PATTERNS 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const PATTERNS = [
  'README.md',
  'README.zh.md',
  '.agents/notes/**/*.md',
  'docs/**/*.md',
  'packages/*/*.md',
  'packages/*/*/*.md',
  'examples/**/*.md',
  'AGENTS.md',
  'packages/AGENTS.md',
  '.agents/skills/**/*.md',
]

/** A broken relative link: a missing target path or a missing anchor on it. */
/* 中文说明：interface Violation 定义本脚本所需的数据或行为，用于表达仓库门禁场景。 */
interface Violation {
  file: string
  /** 1-based line where the link/image/definition node starts. */
  line: number
  url: string
  /** What failed: the target file or the fragment onto it. */
  reason: 'target' | 'anchor'
}

/**
 * True for targets this gate must NOT check: scheme-qualified URLs (`https:`,
 * `mailto:`, …), protocol-relative (`//host`), and root-absolute (`/path`).
 * Pure in-page anchors (`#frag`) ARE checked, against the source file itself.
 */
/* 中文说明：函数 isExternal 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function isExternal(url: string): boolean {
  if (url.startsWith('//')) return true
  if (url.startsWith('/')) return true
  // A scheme like `https:` / `mailto:` — a colon before any slash, dot, or hash.
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)
}

/**
 * Strip the `#fragment` and `?query` from a link target, then percent-decode
 * the remaining path so an encoded target (`My%20File.md`, `READ%4DE.md`)
 * probes the real filename on disk, the way a Markdown renderer resolves it. A
 * malformed escape (`%zz`) makes `decodeURIComponent` throw; we keep the raw
 * path in that case so the link is reported as broken (a `%zz` target is not a
 * file anyone meant to link) rather than crashing the gate.
 */
/* 中文说明：函数 pathPart 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function pathPart(url: string): string {
  /** 中文说明：变量 raw 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const raw = url.replace(/[#?].*$/, '')
  try {
    return decodeURIComponent(raw)
  } catch {
    // decodeURIComponent throws only on a malformed percent-escape; the raw
    // string is then a path no renderer resolves, so fall through to the
    // existence check, which reports it broken.
    return raw
  }
}

/** The percent-decoded `#fragment` of a link target, or null when it has none. */
/* 中文说明：函数 fragmentPart 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function fragmentPart(url: string): string | null {
  /** 中文说明：变量 hash 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const hash = url.indexOf('#')
  if (hash === -1) return null
  /** 中文说明：变量 raw 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const raw = url.slice(hash + 1).replace(/\?.*$/, '')
  try {
    return decodeURIComponent(raw)
  } catch {
    // Same stance as pathPart: a malformed escape names no anchor anyone
    // meant, so the raw text flows into the lookup and is reported missing.
    return raw
  }
}

/**
 * GitHub's heading-slug algorithm (lowercase; drop everything but letters,
 * numbers, underscores, spaces, hyphens; spaces become hyphens). Underscores
 * survive (`## Showcase: web_fetch` → `#showcase-web_fetch`), unlike
 * `gen-cordis-catalog`'s region-anchor slugs — the generator's headings are
 * always reachable through its explicit `<a id>` anchors, so the two need not
 * share one rule.
 * @param heading - the RENDERED heading text (Markdown syntax already gone).
 * @returns the anchor GitHub assigns the first occurrence of the heading.
 */
/* 中文说明：函数 githubSlug 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function githubSlug(heading: string): string {
  return heading.toLowerCase().replace(/[^\p{L}\p{N}_ -]/gu, '').replaceAll(' ', '-')
}

/**
 * Every anchor one Markdown document exposes: each heading's GitHub slug —
 * computed from the RENDERED heading text, so links, images, inline code, and
 * emphasis inside a heading slug the way GitHub renders them — plus every
 * explicit `<a id="…">` that appears in real HTML flow (a fenced or inline
 * code sample and a commented-out anchor register nothing). Repeated slugs
 * get GitHub's occupied-set `-1`, `-2`, … suffixes: each collision bumps the
 * ORIGINAL slug's counter until a free name is found, so `Repeat`, `Repeat-1`,
 * `Repeat` yields `repeat`, `repeat-1`, `repeat-2`. Matching is exact —
 * element ids are case-sensitive.
 * @param source - the document's full Markdown text.
 * @returns the set of valid fragments for links into this document.
 */
/* 中文说明：函数 documentAnchors 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function documentAnchors(source: string): Set<string> {
  /** 中文说明：变量 anchors 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const anchors = new Set<string>()
  /** 中文说明：变量 occurrences 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const occurrences = new Map<string, number>()
  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const heading of markdownHeadingLines(source)) {
    /** 中文说明：变量 base 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const base = githubSlug(heading.text)
    /** 中文说明：变量 result 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let result = base
    /** 中文说明：变量 bump 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let bump = occurrences.get(base) ?? 0
    while (anchors.has(result)) {
      bump += 1
      result = `${base}-${bump}`
    }
    occurrences.set(base, bump)
    anchors.add(result)
  }
  visitMarkdown(parseMarkdown(source), (node: Nodes): void => {
    if (node.type !== 'html') return
    /** 中文说明：变量 html 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const html = node.value.replace(/<!--[\s\S]*?-->/g, '')
    /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
    for (const match of html.matchAll(/<a id="([^"]+)"/g)) anchors.add(match[1] ?? '')
  })
  return anchors
}

/**
 * Lazily collect and cache the anchor set of any existing Markdown file —
 * shared across all scanned sources so a target parses once.
 * @returns the memoized absolute-path → anchor-set lookup.
 */
/* 中文说明：函数 anchorCache 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function anchorCache(): (absPath: string) => Set<string> {
  /** 中文说明：变量 cache 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const cache = new Map<string, Set<string>>()
  return (absPath) => {
    /** 中文说明：变量 hit 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const hit = cache.get(absPath)
    if (hit) return hit
    /** 中文说明：变量 anchors 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const anchors = documentAnchors(readFileSync(absPath, 'utf8'))
    cache.set(absPath, anchors)
    return anchors
  }
}

/**
 * Find every broken relative cross-link in one Markdown file via its AST: a
 * relative target that does not exist, or a fragment onto a Markdown file
 * (same-file `#anchor` links included) that names no heading slug or explicit
 * `<a id>` there. Fragments onto non-Markdown targets (`file.ts#L10`) carry
 * renderer-owned semantics and are not judged.
 * @param absPath - absolute path of the Markdown source to scan.
 * @param anchorsOf - anchor lookup shared across files for cross-link checks.
 * @param scanRoot - repository root violations are reported relative to.
 * @returns one entry per broken link, in document order.
 */
/* 中文说明：函数 findViolations 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function findViolations(
  absPath: string,
  anchorsOf: (abs: string) => Set<string>,
  scanRoot: string = root,
): Violation[] {
  /** 中文说明：变量 file 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const file = relative(scanRoot, absPath)
  /** 中文说明：变量 dir 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const dir = dirname(absPath)
  /** 中文说明：变量 source 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const source = readFileSync(absPath, 'utf8')
  /** 中文说明：变量 tree 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const tree = parseMarkdown(source)
  /** 中文说明：变量 out 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const out: Violation[] = []

  /** 中文说明：函数值 check 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const check = (url: string, node: Nodes): void => {
    if (isExternal(url)) return
    /** 中文说明：变量 target 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const target = pathPart(url)
    /** 中文说明：变量 resolved 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const resolved = target === '' ? absPath : resolve(dir, target)
    if (!existsSync(resolved)) {
      out.push({ file, line: node.position?.start.line ?? 0, url, reason: 'target' })
      return
    }
    /** 中文说明：变量 fragment 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fragment = fragmentPart(url)
    if (fragment === null || !resolved.endsWith('.md')) return
    if (!anchorsOf(resolved).has(fragment)) {
      out.push({ file, line: node.position?.start.line ?? 0, url, reason: 'anchor' })
    }
  }

  visitMarkdown(tree, (node: Nodes): void => {
    if ((node.type === 'link' || node.type === 'image' || node.type === 'definition') && 'url' in node) {
      check(node.url, node)
    }
  })
  return out
}

// Run only when invoked as a script, not when imported by the spec.
if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  // Archived notes remain valid link targets, but their historical outbound links are frozen.
  /** 中文说明：变量 files 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const files = uniqueRepoFiles(root, PATTERNS, isArchivedAgentNotePath)
  /** 中文说明：变量 anchorsOf 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const anchorsOf = anchorCache()
  /** 中文说明：函数值 all 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const all = files.flatMap(file => findViolations(file.abs, anchorsOf))
  /** 中文说明：变量 checked 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const checked = files.length

  if (all.length === 0) {
    console.log(`verify-md-links: ${checked} file(s) checked, all relative cross-links and fragments resolve.`)
    process.exit(0)
  }

  console.error('verify-md-links: broken relative cross-links found:')
  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const v of all) {
    console.error(`  ${v.file}:${v.line}  ${v.url}  (${v.reason === 'target' ? 'target does not exist' : 'no such anchor in target'})`)
  }
  process.exit(1)
}
