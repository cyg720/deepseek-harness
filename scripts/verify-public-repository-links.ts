/** Reject tracked files that reference an unavailable legacy repository. */
/**
 * 文件职责：实现 verify-public-repository-links.ts 覆盖的仓库规范、文档、包或运行时门禁职责。
 * 技术维度：使用 TypeScript、JavaScript、Vitest、Node.js 文件系统、AST、Git 或依赖图分析。
 * 产品维度：保障源码、配置、文档和发布包满足项目约定，阻止不完整变更进入主分支。
 * 逻辑维度：扫描仓库输入，构建检查模型，收集违规项，再输出诊断并设置退出状态。
 * 关键边界：被检查文本与路径不可信；门禁结果必须确定；任何违规都应显式失败。
 * 新手阅读建议：先看规则入口和扫描范围，再读违规收集，最后关注例外、诊断和退出码。
 */

import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, readlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** 中文说明：变量 root 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const root = resolve(import.meta.dirname, '..')
/** 中文说明：变量 unavailableOwner 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const unavailableOwner = ['deepseek', 'ai'].join('-')
/** 中文说明：变量 unavailableRepositoryName 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const unavailableRepositoryName = ['deepseek', 'harness', 'sdk'].join('-')
/** 中文说明：变量 unavailableRepository 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const unavailableRepository = `${unavailableOwner}/${unavailableRepositoryName}`
/** 中文说明：变量 archivedAgentNotePrefix 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const archivedAgentNotePrefix = '.agents/notes/archived/'

/** 中文说明：变量 namedReferenceCharacters 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const namedReferenceCharacters: Readonly<Record<string, string>> = {
  hyphen: '-',
  sol: '/',
}

/** Normalize source spellings that render or decode to repository separators. */
/** 中文说明：函数 canonicalReferenceText 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function canonicalReferenceText(source: string): string {
  return source
    .replaceAll('\\/', '/')
    .replace(/\\u(0023|002d|002f)/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/%(23|2d|2f)/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(?:(\d+)|x([\da-f]+));/gi, (entity, decimal: string | undefined, hexadecimal: string | undefined) => {
      /** 中文说明：变量 code 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const code = Number.parseInt(decimal ?? hexadecimal ?? '', decimal === undefined ? 16 : 10)
      return code === 35 || code === 45 || code === 47 ? String.fromCodePoint(code) : entity
    })
    .replace(/&(hyphen|num|sol);/gi, (entity, name: string) => namedReferenceCharacters[name.toLowerCase()] ?? entity)
    .normalize('NFKC')
    .toLowerCase()
}

/** One tracked reference to the unavailable repository. */
/** 中文说明：interface UnavailableRepositoryReference 定义本脚本所需的数据或行为，用于表达仓库门禁场景。 */
export interface UnavailableRepositoryReference {
  /** Repository-relative file path. */
  file: string
  /** One-based source line. */
  line: number
}

/**
 * Locate unavailable-repository references in one active text file.
 * @param file - Repository-relative path used in diagnostics.
 * @param source - Text to inspect.
 * @returns every matching source line, excluding frozen archived Agent Notes.
 */
/** 中文说明：函数 findUnavailableRepositoryReferences 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function findUnavailableRepositoryReferences(file: string, source: string): UnavailableRepositoryReference[] {
  if (file.startsWith(archivedAgentNotePrefix)) return []

  /** 中文说明：变量 references 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const references: UnavailableRepositoryReference[] = []
  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const [index, line] of source.split('\n').entries()) {
    /** 中文说明：变量 canonicalLine 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const canonicalLine = canonicalReferenceText(line)
    if (canonicalLine.includes(unavailableRepository)) references.push({ file, line: index + 1 })
  }
  return references
}

/** 中文说明：函数 trackedFiles 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function trackedFiles(repoRoot: string): string[] {
  return execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\0')
    .filter(file => file !== '')
}

/** 中文说明：函数 scanRepository 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function scanRepository(repoRoot: string): UnavailableRepositoryReference[] {
  /** 中文说明：变量 references 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const references: UnavailableRepositoryReference[] = []
  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const file of trackedFiles(repoRoot)) {
    /** 中文说明：变量 path 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = resolve(repoRoot, file)
    if (!existsSync(path)) continue
    /** 中文说明：变量 stat 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const stat = lstatSync(path)
    if (!stat.isFile() && !stat.isSymbolicLink()) continue
    /** 中文说明：变量 source 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const source = stat.isSymbolicLink() ? readlinkSync(path) : readFileSync(path, 'utf8')
    if (source.includes('\0')) continue
    references.push(...findUnavailableRepositoryReferences(file, source))
  }
  return references
}

/** 中文说明：变量 invokedPath 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const invokedPath = process.argv[1]
/** 中文说明：变量 isMain 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const isMain = invokedPath !== undefined && import.meta.url === pathToFileURL(resolve(invokedPath)).href
if (isMain) {
  /** 中文说明：变量 references 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const references = scanRepository(root)
  if (references.length === 0) {
    console.log('verify-public-repository-links: tracked files reference no unavailable repository.')
  } else {
    console.error('verify-public-repository-links: unavailable repository references found:')
    /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
    for (const reference of references) console.error(`  ${reference.file}:${String(reference.line)}`)
    process.exitCode = 1
  }
}
