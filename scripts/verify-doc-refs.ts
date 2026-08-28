/**
 * Verify root-relative documentation paths in repo-authored TypeScript. The
 * textual scan covers `docs/*.md` and `.agents/notes/*.md`, requires the
 * extension, checks matching string literals too, and excludes built
 * declarations and vendored source.
 */
/**
 * 文件职责：检查仓库 TypeScript 中所有根相对文档引用都带 .md 且目标真实存在。
 * 技术维度：使用文件 glob、正则文本扫描、去重文件枚举和文件系统存在性检查。
 * 产品维度：防止源码注释和 Agent Notes 中的文档链接随移动或删除变成死链。
 * 逻辑维度：定义扫描模式、排除规则与文档正则；逐文件收集违规，成功打印数量，失败逐条报告并退出 1。
 * 关键边界：只扫描仓库编写的 TS，排除 lib、d.ts 与 vendor；路径必须根相对且显式 .md。
 * 新手阅读建议：先看 PATTERNS/isExcluded/DOC_REF，再看 findViolations，最后看 all 的成功与失败分支。
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { findReferenceViolations, uniqueRepoFiles, type ReferenceViolation as Violation } from './repo-files.ts'

// 仓库根绝对路径。
const root = resolve(import.meta.dirname, '..')

/** Repo-authored TypeScript that may cite docs in comments. */
const PATTERNS = ['packages/**/*.ts']

/** Paths excluded from the scan: built output and vendored upstream source. */
/* 判断扫描排除路径。@param p 根相对正斜杠路径。@returns 是否为构建物、声明或 vendored 源码。 */
const isExcluded = (p: string): boolean =>
  p.includes('/lib/') || p.endsWith('.d.ts') || p.startsWith('vendor/')

/** Root-relative Markdown path token, excluding trailing prose. */
/* 根相对 docs 或 Agent Notes Markdown 路径匹配式，不包含尾随正文。 */
const DOC_REF = /(?:\bdocs|\.agents\/notes)\/[A-Za-z0-9._/-]+\.md/g

/** Find every broken root-relative documentation reference in one TypeScript file. */
/* 查找单文件死链。@param absPath 文件绝对路径。@returns 违规列表。@example findViolations(path)。 */
function findViolations(absPath: string): Violation[] {
  return findReferenceViolations(root, absPath, DOC_REF, ref => ref, ref => !existsSync(resolve(root, ref)))
}

// 去重且已排除的待扫描文件记录。
const files = uniqueRepoFiles(root, PATTERNS, isExcluded)
// 跨全部文件汇总的引用违规；file 是单个文件记录。
const all = files.flatMap(file => findViolations(file.abs))
// 已检查文件数量，用于成功诊断。
const checked = files.length

if (all.length === 0) {
  console.log(`verify-doc-refs: ${checked} file(s) checked, all documentation references resolve.`)
  process.exit(0)
}

console.error('verify-doc-refs: broken documentation references found in source comments (target does not exist):')
// 当前违规记录，包含文件、行号和引用文本。
for (const v of all) {
  console.error(`  ${v.file}:${v.line}  ${v.ref}`)
}
process.exit(1)
