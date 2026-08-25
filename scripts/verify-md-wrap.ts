/**
 * Reject Markdown prose paragraphs spanning multiple physical lines. The GFM
 * AST distinguishes paragraphs—including those in lists and blockquotes—from
 * multiline structural nodes. The checker never rewrites; symlinked instruction
 * files are deduped. VitePress frontmatter and custom-container delimiters are
 * masked before parsing. The owning convention is in `docs/AGENTS.md`.
 */
/**
 * 文件职责：实现 verify-md-wrap.ts 覆盖的仓库规范、文档、包或运行时门禁职责。
 * 技术维度：使用 TypeScript、JavaScript、Vitest、Node.js 文件系统、AST、Git 或依赖图分析。
 * 产品维度：保障源码、配置、文档和发布包满足项目约定，阻止不完整变更进入主分支。
 * 逻辑维度：扫描仓库输入，构建检查模型，收集违规项，再输出诊断并设置退出状态。
 * 关键边界：被检查文本与路径不可信；门禁结果必须确定；任何违规都应显式失败。
 * 新手阅读建议：先看规则入口和扫描范围，再读违规收集，最后关注例外、诊断和退出码。
 */

import { readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import type { Nodes } from 'mdast'
import { parseMarkdown, visitMarkdown } from './markdown.ts'
import { isArchivedAgentNotePath, uniqueRepoFiles } from './repo-files.ts'

/** 中文说明：变量 root 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const root = resolve(import.meta.dirname, '..')

/** Files to check: doc-typecheck's scope, system-prompt expected outputs, and the AGENTS.md pair. */
/** 中文说明：常量 PATTERNS 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const PATTERNS = [
  'README.md',
  'README.zh.md',
  '.agents/notes/**/*.md',
  'docs/**/*.md',
  'packages/*/*.md',
  'packages/*/*/*.md',
  'examples/**/system-prompt.expected.md',
  'packages/**/system-prompt.expected.md',
  'AGENTS.md',
  'packages/AGENTS.md',
]

/** A located hard-wrap: a prose paragraph spanning more than one source line. */
/** 中文说明：interface Violation 定义本脚本所需的数据或行为，用于表达仓库门禁场景。 */
interface Violation {
  file: string
  /** 1-based line where the hard-wrapped paragraph starts. */
  line: number
  text: string
}

/** 中文说明：函数 maskVitePressStructure 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function maskVitePressStructure(source: string): string {
  /** 中文说明：变量 lines 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const lines = source.split('\n')
  if (lines[0] === '---') {
    /** 中文说明：变量 closing 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const closing = lines.indexOf('---', 1)
    if (closing !== -1) {
      /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
      for (let index = 0; index <= closing; index++) lines[index] = ''
    }
  }
  return lines.map(line => line.trimStart().startsWith(':::') ? '' : line).join('\n')
}

/** Find every hard-wrapped prose paragraph in one Markdown file via its AST. */
/** 中文说明：函数 findViolations 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function findViolations(absPath: string): Violation[] {
  /** 中文说明：变量 file 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const file = relative(root, absPath)
  /** 中文说明：变量 source 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const source = readFileSync(absPath, 'utf8')
  /** 中文说明：变量 parsedSource 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const parsedSource = maskVitePressStructure(source)
  /** 中文说明：变量 tree 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const tree = parseMarkdown(parsedSource)
  /** 中文说明：变量 out 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const out: Violation[] = []

  visitMarkdown(tree, (node: Nodes): boolean | void => {
    if (node.type === 'paragraph' && node.position) {
      const { start, end } = node.position
      if (end.line > start.line) {
        /** 中文说明：变量 firstLine 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const firstLine = source.split('\n')[start.line - 1] ?? ''
        out.push({ file, line: start.line, text: firstLine.trim() })
      }
      // Paragraph children are inline, so no further paragraph can be nested.
      return false
    }
  })
  return out
}

/** 中文说明：变量 files 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const files = uniqueRepoFiles(root, PATTERNS, isArchivedAgentNotePath)
/** 中文说明：函数值 all 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
const all = files.flatMap(file => findViolations(file.abs))
/** 中文说明：变量 checked 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const checked = files.length

if (all.length === 0) {
  console.log(`verify-md-wrap: ${checked} file(s) checked, no hard-wrapped prose paragraphs.`)
  process.exit(0)
}

console.error('verify-md-wrap: hard-wrapped prose paragraphs found (write one physical line per paragraph):')
/** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
for (const v of all) {
  console.error(`  ${v.file}:${v.line}  ${v.text.slice(0, 80)}${v.text.length > 80 ? '…' : ''}`)
}
process.exit(1)
