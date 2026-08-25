/** Report the explicit committed and worktree scope of a repository change. */
/**
 * 文件职责：实现 change-scope.ts 覆盖的仓库构建、校验或维护脚本职责。
 * 技术维度：使用 TypeScript、JavaScript、Vitest、Node.js 文件系统或构建工具。
 * 产品维度：通过仓库构建、校验或维护脚本保障项目开发、发布和 Agent 工作区行为一致。
 * 逻辑维度：解析参数和文件，执行检查或转换，再输出结果并处理错误。
 * 关键边界：脚本可能修改构建产物；路径和子进程输出不可信；失败必须以非零状态显式报告。
 * 新手阅读建议：先看命令入口和参数，再读文件遍历或转换，最后关注错误码和平台差异。
 */

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { parseArgs, TextDecoder } from 'node:util'

/** 中文说明：常量 FORMAT_VERSION 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const FORMAT_VERSION = 1
/** 中文说明：常量 MAX_GIT_OUTPUT 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const MAX_GIT_OUTPUT = 64 * 1024 * 1024
/** 中文说明：常量 UTF8_DECODER 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true })

/** 中文说明：interface ChangeScopeReport 定义本模块所需的数据或行为，用于表达仓库构建、校验或维护脚本场景。 */
interface ChangeScopeReport {
  formatVersion: typeof FORMAT_VERSION
  repositoryRoot: string
  input: {
    base: string
    head: string
  }
  resolved: {
    baseSha: string
    headSha: string
    mergeBaseSha: string
  }
  paths: {
    committed: string[]
    staged: string[]
    unstaged: string[]
    untracked: string[]
  }
}

/** 中文说明：interface GitCommandResult 定义本模块所需的数据或行为，用于表达仓库构建、校验或维护脚本场景。 */
interface GitCommandResult {
  status: number | null
  stdout: string
  stderr: string
  error: Error | undefined
}

/** 中文说明：interface GitBytesCommandResult 定义本模块所需的数据或行为，用于表达仓库构建、校验或维护脚本场景。 */
interface GitBytesCommandResult {
  status: number | null
  stdout: Buffer
  stderr: Buffer
  error: Error | undefined
}

/** 中文说明：interface ChangeScopeOptions 定义本模块所需的数据或行为，用于表达仓库构建、校验或维护脚本场景。 */
interface ChangeScopeOptions {
  base: string
  head: string
}

/** 中文说明：函数 executeGit 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function executeGit(cwd: string, args: string[], context: string): GitCommandResult {
  /** 中文说明：变量 result 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const result = executeGitBytes(cwd, args)
  return {
    status: result.status,
    stdout: decodeGitText(result.stdout, context, 'stdout'),
    stderr: decodeGitText(result.stderr, context, 'stderr'),
    error: result.error,
  }
}

/** 中文说明：函数 executeGitBytes 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function executeGitBytes(cwd: string, args: string[]): GitBytesCommandResult {
  /** 中文说明：变量 result 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const result = spawnSync('git', ['-C', cwd, '-c', 'core.fsmonitor=false', ...args], {
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', LANG: 'C', LC_ALL: 'C' },
    maxBuffer: MAX_GIT_OUTPUT,
  })
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error,
  }
}

/** 中文说明：函数 decodeGitText 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function decodeGitText(output: Buffer, context: string, stream: 'stdout' | 'stderr'): string {
  try {
    return UTF8_DECODER.decode(output)
  } catch {
    throw new Error(`${context}: Git ${stream} is not valid UTF-8`)
  }
}

/** 中文说明：函数 failureDetail 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function failureDetail(result: GitCommandResult): string {
  return result.error?.message ?? (result.stderr.trim() || `Git exited with status ${String(result.status)}`)
}

/** 中文说明：函数 requireGit 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function requireGit(cwd: string, args: string[], context: string): string {
  /** 中文说明：变量 result 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const result = executeGit(cwd, args, context)
  if (result.status !== 0) throw new Error(`${context}: ${failureDetail(result)}`)
  return result.stdout
}

/** 中文说明：函数 requireGitBytes 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function requireGitBytes(cwd: string, args: string[], context: string): Buffer {
  /** 中文说明：变量 result 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const result = executeGitBytes(cwd, args)
  if (result.status !== 0) {
    /** 中文说明：变量 detail 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const detail = result.error?.message
      ?? (result.stderr.toString('utf8').trim() || `Git exited with status ${String(result.status)}`)
    throw new Error(`${context}: ${detail}`)
  }
  return result.stdout
}

/** 中文说明：函数 parseOptions 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function parseOptions(args: string[]): ChangeScopeOptions {
  const { values } = parseArgs({
    args,
    allowPositionals: false,
    options: {
      base: { type: 'string' },
      head: { type: 'string', default: 'HEAD' },
    },
    strict: true,
  })
  if (values.base === undefined) throw new Error('missing required --base <ref>')
  return { base: values.base, head: values.head }
}

/** 中文说明：函数 resolveCommit 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function resolveCommit(root: string, label: 'base' | 'head', ref: string): string {
  /** 中文说明：变量 context 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const context = `cannot resolve ${label} ref ${JSON.stringify(ref)}`
  /** 中文说明：变量 result 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const result = executeGit(root, [
    '-c',
    'core.warnAmbiguousRefs=true',
    'rev-parse',
    '--verify',
    '--end-of-options',
    `${ref}^{commit}`,
  ], context)
  if (/\bambiguous\b/iu.test(result.stderr)) {
    throw new Error(`${label} ref ${JSON.stringify(ref)} is ambiguous; use a fully qualified ref or commit ID`)
  }
  if (result.status !== 0) {
    throw new Error(`${label} ref ${JSON.stringify(ref)} does not resolve to a commit: ${failureDetail(result)}`)
  }
  /** 中文说明：变量 commits 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const commits = result.stdout.trim().split(/\r?\n/u).filter(Boolean)
  if (commits.length !== 1) {
    throw new Error(`${label} ref ${JSON.stringify(ref)} did not resolve to exactly one commit`)
  }
  return commits[0] as string
}

/** 中文说明：函数 resolveMergeBase 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function resolveMergeBase(root: string, baseSha: string, headSha: string): string {
  /** 中文说明：变量 result 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const result = executeGit(
    root,
    ['merge-base', '--all', baseSha, headSha],
    'cannot resolve the merge base',
  )
  if (result.status !== 0) {
    throw new Error(`base and head do not have a merge base: ${failureDetail(result)}`)
  }
  /** 中文说明：变量 mergeBases 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const mergeBases = result.stdout.trim().split(/\r?\n/u).filter(Boolean)
  if (mergeBases.length !== 1) {
    throw new Error(`base and head do not have a unique merge base; found ${mergeBases.length}`)
  }
  return mergeBases[0] as string
}

/** 中文说明：函数 parsePathSet 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function parsePathSet(output: Buffer, context: string): string[] {
  /** 中文说明：变量 paths 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const paths: string[] = []
  /** 中文说明：变量 start 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let start = 0
  /** 中文说明：变量 record 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let record = 0
  /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
  for (let end = 0; end < output.length; end += 1) {
    if (output[end] !== 0) continue
    if (end > start) {
      record += 1
      try {
        paths.push(UTF8_DECODER.decode(output.subarray(start, end)))
      } catch {
        throw new Error(`${context}: Git path ${record} is not valid UTF-8`)
      }
    }
    start = end + 1
  }
  return [...new Set(paths)].sort()
}

/** 中文说明：函数 diffPaths 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function diffPaths(root: string, args: string[], context: string): string[] {
  return parsePathSet(requireGitBytes(root, [
    'diff',
    '--no-ext-diff',
    '--no-textconv',
    '--no-renames',
    '--ignore-submodules=none',
    '--name-only',
    '-z',
    ...args,
    '--',
  ], context), context)
}

/** 中文说明：函数 stripGitLineTerminator 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function stripGitLineTerminator(output: string): string {
  /** 中文说明：变量 withoutLineFeed 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const withoutLineFeed = output.endsWith('\n') ? output.slice(0, -1) : output
  return process.platform === 'win32' && withoutLineFeed.endsWith('\r')
    ? withoutLineFeed.slice(0, -1)
    : withoutLineFeed
}

/** 中文说明：函数 collectReport 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function collectReport(options: ChangeScopeOptions, cwd: string): ChangeScopeReport {
  /** 中文说明：变量 root 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const root = stripGitLineTerminator(
    requireGit(cwd, ['rev-parse', '--show-toplevel'], 'cannot locate a Git worktree'),
  )
  /** 中文说明：变量 baseSha 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const baseSha = resolveCommit(root, 'base', options.base)
  /** 中文说明：变量 headSha 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const headSha = resolveCommit(root, 'head', options.head)
  /** 中文说明：变量 mergeBaseSha 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const mergeBaseSha = resolveMergeBase(root, baseSha, headSha)
  return {
    formatVersion: FORMAT_VERSION,
    repositoryRoot: root,
    input: {
      base: options.base,
      head: options.head,
    },
    resolved: {
      baseSha,
      headSha,
      mergeBaseSha,
    },
    paths: {
      committed: diffPaths(root, [mergeBaseSha, headSha], 'cannot inspect committed paths'),
      staged: diffPaths(root, ['--cached'], 'cannot inspect staged paths'),
      unstaged: diffPaths(root, [], 'cannot inspect unstaged paths'),
      untracked: parsePathSet(requireGitBytes(
        root,
        ['ls-files', '--others', '--exclude-standard', '-z', '--'],
        'cannot inspect untracked paths',
      ), 'cannot inspect untracked paths'),
    },
  }
}

/**
 * Validate arguments and render one complete versioned report.
 * @param args - Command-line arguments after the script path.
 * @param cwd - Directory whose containing Git worktree is inspected.
 * @returns JSON report with a trailing newline.
 */
/** 中文说明：函数 renderChangeScope 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export function renderChangeScope(args: string[], cwd: string): string {
  /** 中文说明：变量 options 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const options = parseOptions(args)
  /** 中文说明：变量 report 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const report = collectReport(options, cwd)
  return `${JSON.stringify(report, null, 2)}\n`
}

/** 中文说明：变量 entryPath 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const entryPath = process.argv[1]
if (entryPath !== undefined && resolve(entryPath) === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(renderChangeScope(process.argv.slice(2), process.cwd()))
  } catch (error) {
    /** 中文说明：变量 message 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`change-scope: ${message}\n`)
    process.exitCode = 1
  }
}
