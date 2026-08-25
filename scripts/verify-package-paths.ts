/**
 * Find stale root-relative `packages/...` references in repo-authored prose and
 * TypeScript. A missing path is reported only when it names a real package leaf
 * outside its own explaining group directory; globs, placeholders, hypothetical
 * packages, and unbuilt `lib/` output are outside the check.
 */
/**
 * 文件职责：实现 verify-package-paths.ts 覆盖的仓库规范、文档、包或运行时门禁职责。
 * 技术维度：使用 TypeScript、JavaScript、Vitest、Node.js 文件系统、AST、Git 或依赖图分析。
 * 产品维度：保障源码、配置、文档和发布包满足项目约定，阻止不完整变更进入主分支。
 * 逻辑维度：扫描仓库输入，构建检查模型，收集违规项，再输出诊断并设置退出状态。
 * 关键边界：被检查文本与路径不可信；门禁结果必须确定；任何违规都应显式失败。
 * 新手阅读建议：先看规则入口和扫描范围，再读违规收集，最后关注例外、诊断和退出码。
 */

import { existsSync, globSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  findReferenceViolations,
  isArchivedAgentNotePath,
  uniqueRepoFiles,
  /** 中文说明：type ReferenceViolation 定义本脚本所需的数据或行为，用于表达仓库门禁场景。 */
  type ReferenceViolation as Violation,
} from './repo-files.ts'

/** 中文说明：变量 root 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const root = resolve(import.meta.dirname, '..')

/** Markdown + repo-authored TypeScript that may cite package paths. */
/** 中文说明：常量 PATTERNS 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const PATTERNS = [
  'README.md',
  '.agents/notes/**/*.md',
  'docs/**/*.md',
  'packages/*/*.md',
  'packages/*/*/*.md',
  'AGENTS.md',
  'packages/AGENTS.md',
  'packages/**/*.ts',
  'examples/**/*.ts',
]

/** Paths excluded from the scan: built output and vendored upstream source. */
/** 中文说明：函数值 isExcluded 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
const isExcluded = (p: string): boolean =>
  isArchivedAgentNotePath(p) || p.includes('/lib/') || p.endsWith('.d.ts') || p.startsWith('vendor/')

/**
 * Directory names of every real package, `packages/<group>/<pkg>`. A broken
 * reference is only flagged when one of its segments is in this set — that is
 * what scopes the gate to DRIFT (a moved real package) rather than typos or
 * not-yet-existing packages named in a proposal.
 */
/** 中文说明：函数 realPackageNames 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function realPackageNames(): Set<string> {
  /** 中文说明：变量 names 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const names = new Set<string>()
  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const pkg of globSync('packages/*/*', { cwd: root, withFileTypes: true })) {
    if (pkg.isDirectory()) names.add(pkg.name)
  }
  return names
}

/** 中文说明：变量 packageNames 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const packageNames = realPackageNames()

/**
 * Match a `packages/<path>` reference token. The character class is plain path
 * characters only, so a glob (`*`), placeholder (`<`, `>`), or brace expansion
 * (`{`, `}`, `,`) terminates the match before those chars and is never probed —
 * those are patterns, not real paths. A trailing `.`/`/` (e.g. a sentence-ending
 * period) is trimmed before the existence check.
 */
/** 中文说明：常量 PKG_REF 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const PKG_REF = /\bpackages\/[A-Za-z0-9._/-]+/g

/** 中文说明：函数 isDriftedPackageReference 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function isDriftedPackageReference(ref: string): boolean {
  if (existsSync(resolve(root, ref))) return false
  // Ignore unbuilt `lib/` paths only under an existing depth-two package root:
  // CI runs this gate before build, while stale group-less paths must still fail.
  /** 中文说明：变量 parts 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const parts = ref.split('/')
  /** 中文说明：变量 libAt 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const libAt = parts.indexOf('lib')
  if (libAt === 3 && existsSync(resolve(root, parts.slice(0, 3).join('/')))) return false
  // A missing reference is drift only when a path segment names a live package.
  // A leading segment that is itself an existing group directory is explained by
  // the group, not by a relocated leaf sharing its name (`client` is both the
  // client-modules group and the sdk leaf), so only later segments count.
  /** 中文说明：变量 segments 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const segments = ref.split('/').slice(1)
  const [group] = segments
  /** 中文说明：变量 scanned 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const scanned = group !== undefined && segments.length > 1 && existsSync(resolve(root, 'packages', group))
    ? segments.slice(1)
    : segments
  return scanned.some(segment => packageNames.has(segment))
}

/** Find missing package references whose path names a live package; bare paths, typos, and illustrative skeletons do not count. */
/** 中文说明：函数 findViolations 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function findViolations(absPath: string): Violation[] {
  return findReferenceViolations(
    root,
    absPath,
    PKG_REF,
    // Remove trailing separators or sentence punctuation matched greedily.
    ref => ref.replace(/[./]+$/, ''),
    isDriftedPackageReference,
  )
}

/** 中文说明：变量 files 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const files = uniqueRepoFiles(root, PATTERNS, isExcluded)
/** 中文说明：函数值 all 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
const all = files.flatMap(file => findViolations(file.real))
/** 中文说明：变量 checked 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const checked = files.length

if (all.length === 0) {
  console.log(`verify-package-paths: ${checked} file(s) checked, all packages/* references resolve.`)
  process.exit(0)
}

console.error('verify-package-paths: broken packages/* references found (target does not exist):')
/** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
for (const v of all) {
  console.error(`  ${v.file}:${v.line}  ${v.ref}`)
}
process.exit(1)
