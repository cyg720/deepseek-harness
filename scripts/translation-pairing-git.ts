/** Git-blob operations owned by the bilingual pairing workflow. */
/*
 * 文件职责：实现 translation-pairing-git.ts 覆盖的发布、门禁、翻译配对或仓库维护职责。
 * 技术维度：使用 TypeScript、Vitest、Node.js 文件系统、Git、包管理器或构建产物校验。
 * 产品维度：保障项目发布物、文档配对和 CI 门禁保持一致且可追踪。
 * 逻辑维度：解析参数与仓库状态，执行检查或发布步骤，再输出诊断和退出状态。
 * 关键边界：发布与 Git 操作会改变外部状态；失败必须显式停止；路径和命令输出不可信。
 * 新手阅读建议：先看入口参数和只读检查，再读状态变更步骤，最后关注回滚、错误码和平台差异。
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'

/** 中文说明：常量 SNAPSHOT_REF_PREFIX 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const SNAPSHOT_REF_PREFIX = 'refs/dsh/translation-pairing/snapshots'

/** Maximum buffered stdout or stderr for repository-owned Git subprocesses. */
/* 中文说明：常量 GIT_COMMAND_MAX_BUFFER 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
export const GIT_COMMAND_MAX_BUFFER = 1 << 26

/** Full SHA-1 Git blob hash (the 40-hex format used by pairing records). */
/* 中文说明：函数 gitBlobHash 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function gitBlobHash(content: Buffer): string {
  /** 中文说明：变量 hash 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const hash = createHash('sha1')
  hash.update(`blob ${content.byteLength}\0`)
  hash.update(content)
  return hash.digest('hex')
}

/**
 * Run one Git subprocess and return its exact stdout bytes.
 *
 * @param root - Repository root used as Git's working directory.
 * @param args - Arguments following the `git` executable.
 * @param operation - Human-readable operation for failure diagnostics.
 * @param input - Optional stdin bytes.
 * @returns Exact stdout bytes.
 * @throws Error when Git cannot start or exits unsuccessfully.
 */
/* 中文说明：函数 runGit 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function runGit(root: string, args: string[], operation: string, input?: Buffer): Buffer {
  /** 中文说明：变量 result 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const result = spawnSync('git', ['-C', root, ...args], {
    input,
    maxBuffer: GIT_COMMAND_MAX_BUFFER,
  })
  if (result.error) {
    throw new Error(`${operation} failed: ${result.error.message}`, { cause: result.error })
  }
  if (result.status !== 0) {
    throw new Error(`${operation} failed with status ${String(result.status)}: ${result.stderr.toString('utf8').trim()}`)
  }
  return result.stdout
}

/** One regular stage-zero Git index entry and its exact blob bytes. */
/* 中文说明：interface GitIndexBlob 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
export interface GitIndexBlob {
  objectId: string
  content: Buffer
}

/** Every stage-zero path currently present in the Git index. */
/* 中文说明：函数 gitIndexPaths 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function gitIndexPaths(root: string): Set<string> {
  /** 中文说明：变量 paths 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const paths = new Set<string>()
  /** 中文说明：变量 entries 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const entries = runGit(root, ['ls-files', '--stage', '-z'], 'listing Git index paths')
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
  /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
  for (const entry of entries) {
    /** 中文说明：变量 match 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const match = /^\d+ [0-9a-f]+ ([0-3])\t([\s\S]+)$/.exec(entry)
    if (!match?.[1] || match[2] === undefined) throw new Error('git ls-files --stage returned a malformed entry')
    if (match[1] === '0') paths.add(match[2])
  }
  return paths
}

/**
 * Paths visible to a custom merge driver from the current index plus every
 * merge head Git advertises through `GITHEAD_<oid>` environment entries.
 *
 * Git invokes custom drivers before it writes clean additions from the other
 * heads into stage zero. The explicit post-conflict resolver has no GITHEAD
 * entries and therefore uses the already-merged index alone.
 */
/* 中文说明：函数 gitMergeInputPaths 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function gitMergeInputPaths(root: string, environment: NodeJS.ProcessEnv = process.env): Set<string> {
  /** 中文说明：变量 paths 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const paths = gitIndexPaths(root)
  /** 中文说明：变量 heads 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const heads = Object.keys(environment)
    .flatMap(key => /^GITHEAD_([0-9a-f]{40})$/.exec(key)?.[1] ?? [])
    .sort()
  /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
  for (const head of heads) {
    /** 中文说明：变量 files 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const files = runGit(root, ['ls-tree', '-r', '--name-only', '-z', head], `listing merge-head ${head} paths`)
      .toString('utf8')
      .split('\0')
      .filter(Boolean)
    /** 中文说明：该循环依次处理仓库文件或状态；循环变量仅在当前循环中有效。 */
    for (const file of files) paths.add(file)
  }
  return paths
}

/**
 * Read one path from the Git index without consulting working-tree bytes.
 *
 * @param root - Repository root.
 * @param path - Repository-relative path.
 * @returns The stage-zero blob, or `undefined` when the path is absent.
 * @throws Error when the path is unmerged or its index entries are not a valid merge state.
 */
/* 中文说明：函数 readGitIndexBlob 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function readGitIndexBlob(root: string, path: string): GitIndexBlob | undefined {
  /** 中文说明：变量 output 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const output = runGit(
    root,
    ['ls-files', '--stage', '-z', '--', path],
    `git ls-files --stage for ${path}`,
  ).toString('utf8')
  /** 中文说明：变量 entries 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const entries = output.split('\0').filter(Boolean)
  if (entries.length === 0) return undefined
  if (entries.length !== 1) throw new Error(`${path} does not have exactly one resolved index entry`)
  /** 中文说明：变量 match 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const match = /^(?:\d+) ([0-9a-f]+) 0\t[\s\S]+$/.exec(entries[0] ?? '')
  if (!match?.[1]) throw new Error(`${path} remains unmerged or has an invalid index entry`)
  return {
    objectId: match[1],
    content: runGit(root, ['cat-file', 'blob', match[1]], `reading staged ${path}`),
  }
}

/**
 * Persist exact working-tree bytes so a pairing record can later recover them
 * with `git cat-file`, even when they have never appeared in the index or a
 * commit. The returned object ID is checked against the pairing format's own
 * content hash before the caller writes a sidecar.
 */
/* 中文说明：函数 storeGitBlob 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function storeGitBlob(root: string, content: Buffer): string {
  /** 中文说明：变量 expected 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const expected = gitBlobHash(content)
  /** 中文说明：变量 stored 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const stored = runGit(root, ['hash-object', '-w', '--stdin'], 'git hash-object -w --stdin', content)
    .toString('utf8')
    .trim()
  if (stored !== expected) {
    throw new Error(`git hash-object -w --stdin returned unexpected object ID ${JSON.stringify(stored)}; expected ${expected}`)
  }
  runGit(
    root,
    ['update-ref', `${SNAPSHOT_REF_PREFIX}/${stored}`, stored],
    'git update-ref for translation snapshot',
  )
  return stored
}
