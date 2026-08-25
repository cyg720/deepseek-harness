/**
 * Doc-sync gate for the canonical package-README limitations section. It scans
 * package manifests, rejects missing or variant sections, and requires one
 * top-level bullet; audited packages in {@link NO_LIMITATIONS} must omit it.
 * See the [limitations Agent Note](../.agents/notes/implemented/process/2026-07-10-readme-known-limitations-gate.md).
 */
/**
 * 文件职责：实现 verify-package-readme-limitations.ts 覆盖的仓库规范、文档、包或运行时门禁职责。
 * 技术维度：使用 TypeScript、JavaScript、Vitest、Node.js 文件系统、AST、Git 或依赖图分析。
 * 产品维度：保障源码、配置、文档和发布包满足项目约定，阻止不完整变更进入主分支。
 * 逻辑维度：扫描仓库输入，构建检查模型，收集违规项，再输出诊断并设置退出状态。
 * 关键边界：被检查文本与路径不可信；门禁结果必须确定；任何违规都应显式失败。
 * 新手阅读建议：先看规则入口和扫描范围，再读违规收集，最后关注例外、诊断和退出码。
 */

import { existsSync, globSync, readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { markdownHeadingLines, markdownProseLines } from './markdown.ts'

/** 中文说明：变量 root 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const root = resolve(import.meta.dirname, '..')

/** The one canonical section heading, required verbatim as an h2. */
/** 中文说明：常量 CANONICAL 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const CANONICAL = '## Known Limitations and Deferred Work'

/** Packages audited as having no limitations section, keyed by repo-relative directory. */
/** 中文说明：常量 NO_LIMITATIONS 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const NO_LIMITATIONS: Readonly<Record<string, string>> = {
  'packages/util/brand': 'Type-only nominal-branding primitive with no runtime behavior or deferred work.',
}

/** A heading that reads as a limitations section — canonical or drifted. */
/** 中文说明：函数 isLimitationsLike 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function isLimitationsLike(headingText: string): boolean {
  return (
    /\blimitations?\b/i.test(headingText)
    || /deferred work/i.test(headingText)
    || /what is not here/i.test(headingText)
    || /^deferred\b/i.test(headingText)
    || /^non-goals?\b/i.test(headingText)
  )
}

/** 中文说明：函数值 packageJsons 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
const packageJsons = globSync('packages/*/*/package.json', { cwd: root }).map(path => path.split(sep).join('/')).sort()
/** 中文说明：函数值 scannedPackages 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
const scannedPackages = new Set(packageJsons.map(path => path.slice(0, -'/package.json'.length)))
/** 中文说明：变量 failures 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const failures: string[] = []

/** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
for (const [entry, reason] of Object.entries(NO_LIMITATIONS)) {
  if (!scannedPackages.has(entry)) {
    failures.push(`whitelist entry ${entry} does not name a scanned package — renamed or removed? update NO_LIMITATIONS in scripts/verify-package-readme-limitations.ts in the same change`)
  }
  if (reason.trim().length === 0) {
    failures.push(`whitelist entry ${entry} has no justification — state why a limitations section would be empty boilerplate`)
  }
}

/** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
for (const pkg of scannedPackages) {
  /** 中文说明：变量 readme 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const readme = `${pkg}/README.md`
  if (!existsSync(resolve(root, readme))) {
    failures.push(`${readme}: package manifest has no sibling README with the \`${CANONICAL}\` section`)
    continue
  }
  /** 中文说明：变量 source 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const source = readFileSync(resolve(root, readme), 'utf8')
  /** 中文说明：变量 lines 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const lines = markdownProseLines(source)
  /** 中文说明：变量 headings 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const headings = markdownHeadingLines(source)
  /** 中文说明：函数值 limitations 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const limitations = headings.filter(heading => isLimitationsLike(heading.text))

  if (Object.hasOwn(NO_LIMITATIONS, pkg)) {
    /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
    for (const heading of limitations) {
      failures.push(`${readme}:${heading.index}: whitelisted as having no known limitations, but carries ${JSON.stringify(heading.raw)} — drop the section or remove the package from NO_LIMITATIONS`)
    }
    continue
  }

  /** 中文说明：变量 heading 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const heading = limitations.at(0)
  if (heading === undefined) {
    failures.push(`${readme}: missing the \`${CANONICAL}\` section (a package with genuinely nothing to declare joins NO_LIMITATIONS in scripts/verify-package-readme-limitations.ts instead)`)
    continue
  }
  if (limitations.length > 1) {
    failures.push(`${readme}: ${limitations.length} limitations-like headings (lines ${limitations.map(line => line.index).join(', ')}) — keep exactly one \`${CANONICAL}\` section`)
    continue
  }
  if (heading.depth !== 2 || heading.raw.trimEnd() !== CANONICAL) {
    failures.push(`${readme}:${heading.index}: non-canonical heading ${JSON.stringify(heading.raw)} — use \`${CANONICAL}\``)
    continue
  }
  /** 中文说明：函数值 headingAt 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const headingAt = lines.findIndex(line => line.index === heading.index)
  /** 中文说明：变量 body 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const body = lines.slice(headingAt + 1)
  /** 中文说明：函数值 headingLines 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const headingLines = new Set(headings.map(entry => entry.index))
  /** 中文说明：函数值 end 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const end = body.findIndex(line => headingLines.has(line.index))
  /** 中文说明：变量 section 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const section = end === -1 ? body : body.slice(0, end)
  if (!section.some(line => /^- /.test(line.raw))) {
    failures.push(`${readme}:${heading.index}: the \`${CANONICAL}\` section has no top-level \`- \` bullet — state the limitations, or whitelist the package if there are genuinely none`)
  }
}

if (failures.length > 0) {
  console.error('verify-package-readme-limitations: violations found:')
  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const failure of failures) console.error(`  ${failure}`)
  process.exit(1)
}

console.log(`verify-package-readme-limitations: ${scannedPackages.size} package READMEs checked (${Object.keys(NO_LIMITATIONS).length} whitelisted), all conform.`)
