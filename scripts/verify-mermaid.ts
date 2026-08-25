/**
 * Parse every repo-authored Mermaid fence with Mermaid itself, catching syntax that link and fence
 * checks cannot. Scope intentionally matches the Markdown link gate, including standing docs,
 * package/example docs, and agent skills. Run with `tsx scripts/verify-mermaid.ts`.
 */
/**
 * 文件职责：实现 verify-mermaid.ts 覆盖的仓库规范、文档、包或运行时门禁职责。
 * 技术维度：使用 TypeScript、JavaScript、Vitest、Node.js 文件系统、AST、Git 或依赖图分析。
 * 产品维度：保障源码、配置、文档和发布包满足项目约定，阻止不完整变更进入主分支。
 * 逻辑维度：扫描仓库输入，构建检查模型，收集违规项，再输出诊断并设置退出状态。
 * 关键边界：被检查文本与路径不可信；门禁结果必须确定；任何违规都应显式失败。
 * 新手阅读建议：先看规则入口和扫描范围，再读违规收集，最后关注例外、诊断和退出码。
 */

import { globSync, readFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'
import { JSDOM } from 'jsdom'
import type { Nodes } from 'mdast'
import { isArchivedAgentNotePath } from './repo-files.ts'

/** 中文说明：变量 root 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const root = resolve(import.meta.dirname, '..')

/** 中文说明：常量 PATTERNS 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
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

/** 中文说明：interface Block 定义本脚本所需的数据或行为，用于表达仓库门禁场景。 */
interface Block {
  file: string
  line: number
  source: string
}

/** 中文说明：interface Violation 定义本脚本所需的数据或行为，用于表达仓库门禁场景。 */
interface Violation {
  file: string
  line: number
  message: string
}

/** 中文说明：函数 extractMermaidBlocks 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function extractMermaidBlocks(file: string): Block[] {
  /** 中文说明：变量 source 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const source = readFileSync(resolve(root, file), 'utf8')
  /** 中文说明：变量 tree 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const tree = fromMarkdown(source, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })
  /** 中文说明：变量 out 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const out: Block[] = []
  /** 中文说明：函数值 visit 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const visit = (node: Nodes): void => {
    if (node.type === 'code' && node.lang === 'mermaid') {
      out.push({ file, line: node.position?.start.line ?? 0, source: node.value })
    }
    if ('children' in node) {
      /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
      for (const child of node.children) visit(child)
    }
  }
  visit(tree)
  return out
}

/** 中文说明：函数 formatError 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function formatError(error: unknown): string {
  if (error instanceof Error) return error.message.replace(/\s+/g, ' ').trim()
  return String(error).replace(/\s+/g, ' ').trim()
}

/** 中文说明：变量 blocks 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const blocks: Block[] = []
/** 中文说明：变量 seen 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const seen = new Set<string>()
/** 中文说明：变量 checkedFiles 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let checkedFiles = 0
/** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
for (const pattern of PATTERNS) {
  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const match of globSync(pattern, { cwd: root })) {
    if (isArchivedAgentNotePath(match)) continue
    /** 中文说明：变量 real 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const real = realpathSync(resolve(root, match))
    if (seen.has(real)) continue
    seen.add(real)
    checkedFiles++
    blocks.push(...extractMermaidBlocks(match))
  }
}

/** 中文说明：变量 violations 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const violations: Violation[] = []
const { window } = new JSDOM('')
Object.defineProperty(globalThis, 'window', { value: window })
Object.defineProperty(globalThis, 'document', { value: window.document })
Object.defineProperty(globalThis, 'navigator', { value: window.navigator })
/** 中文说明：变量 mermaid 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const mermaid = (await import('mermaid')).default
// maxEdges: mermaid's default 500-edge render guard; the module graph grows
// with every package edge and crossed it legitimately. Raise the guard here
// (a secure config settable only via initialize) rather than trimming edges.
// The graph passed 1000 the same way it passed 500, so the headroom doubles
// again rather than being set to whatever the current count happens to be.
mermaid.initialize({ startOnLoad: false, maxEdges: 2000 })
/** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
for (const block of blocks) {
  try {
    await mermaid.parse(block.source, { suppressErrors: false })
  } catch (error: unknown) {
    violations.push({ file: block.file, line: block.line, message: formatError(error) })
  }
}

if (violations.length === 0) {
  console.log(`verify-mermaid: ${blocks.length} mermaid block(s) parsed across ${checkedFiles} file(s).`)
  process.exit(0)
}

console.error('verify-mermaid: Mermaid syntax errors found:')
/** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
for (const violation of violations) {
  console.error(`  ${violation.file}:${violation.line}  ${violation.message}`)
}
process.exit(1)
