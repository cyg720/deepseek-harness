/** Shared repository file discovery and line-oriented reference scanning. */
/*
 * 文件职责：实现 repo-files.ts 覆盖的发布、门禁、翻译配对或仓库维护职责。
 * 技术维度：使用 TypeScript、Vitest、Node.js 文件系统、Git、包管理器或构建产物校验。
 * 产品维度：保障项目发布物、文档配对和 CI 门禁保持一致且可追踪。
 * 逻辑维度：解析参数与仓库状态，执行检查或发布步骤，再输出诊断和退出状态。
 * 关键边界：发布与 Git 操作会改变外部状态；失败必须显式停止；路径和命令输出不可信。
 * 新手阅读建议：先看入口参数和只读检查，再读状态变更步骤，最后关注回滚、错误码和平台差异。
 */

import { globSync, readFileSync, realpathSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'

/** One authored path plus its canonical target for symlink deduplication. */
/* 中文说明：interface RepoFile 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
export interface RepoFile {
  /** Absolute path matched by the caller's glob. */
  abs: string
  /** Absolute canonical path used only for deduplication. */
  real: string
}

/** A rejected line-oriented repository reference. */
/* 中文说明：interface ReferenceViolation 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
export interface ReferenceViolation {
  /** Repo-relative file containing the reference. */
  file: string
  /** 1-based line containing the reference. */
  line: number
  /** Normalized reference text. */
  ref: string
}

/** Whether a repository path is frozen Agent Note history, not evolving source prose. */
/* 中文说明：函数 isArchivedAgentNotePath 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function isArchivedAgentNotePath(path: string): boolean {
  return path.replaceAll('\\', '/').startsWith('.agents/notes/archived/')
}

/**
 * Expand repository-relative globs and deduplicate symlinked files.
 * @param root - absolute repository root.
 * @param patterns - repository-relative glob patterns, processed in order.
 * @param isExcluded - optional predicate over each matched relative path.
 * @returns matched files in stable first-seen order.
 */
/* 中文说明：函数 uniqueRepoFiles 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function uniqueRepoFiles(
  root: string,
  patterns: readonly string[],
  isExcluded: (relativePath: string) => boolean = () => false,
): RepoFile[] {
  /** 中文说明：变量 seen 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const seen = new Set<string>()
  /** 中文说明：变量 files 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const files: RepoFile[] = []
  /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
  for (const pattern of patterns) {
    /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
    for (const match of globSync(pattern, { cwd: root })) {
      /** 中文说明：变量 repoPath 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const repoPath = match.split(sep).join('/')
      if (isExcluded(repoPath)) continue
      /** 中文说明：变量 abs 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const abs = resolve(root, repoPath)
      /** 中文说明：变量 real 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const real = realpathSync(abs)
      if (seen.has(real)) continue
      seen.add(real)
      files.push({ abs, real })
    }
  }
  return files
}

/**
 * Scan regex matches line by line and return the normalized matches rejected by
 * a caller predicate.
 * @param root - absolute repository root used for violation paths.
 * @param absPath - absolute text-file path to scan.
 * @param pattern - global regex matched independently against each line.
 * @param normalize - maps raw regex text to the reference the gate evaluates.
 * @param isViolation - returns true when the normalized reference is invalid.
 * @returns every rejected reference in source order.
 */
/* 中文说明：函数 findReferenceViolations 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function findReferenceViolations(
  root: string,
  absPath: string,
  pattern: RegExp,
  normalize: (raw: string) => string,
  isViolation: (ref: string) => boolean,
): ReferenceViolation[] {
  /** 中文说明：变量 file 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const file = relative(root, absPath).split(sep).join('/')
  /** 中文说明：变量 out 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const out: ReferenceViolation[] = []
  /** 中文说明：变量 lines 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const lines = readFileSync(absPath, 'utf8').split('\n')
  /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
  for (let i = 0; i < lines.length; i++) {
    /** 中文说明：变量 line 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const line = lines[i]
    if (line === undefined) continue
    /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
    for (const match of line.matchAll(pattern)) {
      /** 中文说明：变量 ref 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const ref = normalize(match[0])
      if (isViolation(ref)) out.push({ file, line: i + 1, ref })
    }
  }
  return out
}
