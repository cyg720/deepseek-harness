/**
 * 文件职责：验证 change-scope.spec.ts 覆盖的仓库构建、校验或维护脚本职责。
 * 技术维度：使用 TypeScript、JavaScript、Vitest、Node.js 文件系统或构建工具。
 * 产品维度：通过仓库构建、校验或维护脚本保障项目开发、发布和 Agent 工作区行为一致。
 * 逻辑维度：解析参数和文件，执行检查或转换，再输出结果并处理错误。
 * 关键边界：脚本可能修改构建产物；路径和子进程输出不可信；失败必须以非零状态显式报告。
 * 新手阅读建议：先看命令入口和参数，再读文件遍历或转换，最后关注错误码和平台差异。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { renderChangeScope } from './change-scope.ts'

/** 中文说明：interface Report 定义本测试所需的数据或行为，用于表达仓库构建、校验或维护脚本场景。 */
interface Report {
  formatVersion: number
  repositoryRoot: string
  input: { base: string; head: string }
  resolved: { baseSha: string; headSha: string; mergeBaseSha: string }
  paths: { committed: string[]; staged: string[]; unstaged: string[]; untracked: string[] }
}

/** 中文说明：interface Fixture 定义本测试所需的数据或行为，用于表达仓库构建、校验或维护脚本场景。 */
interface Fixture {
  container: string
  root: string
}

/** 中文说明：变量 fixtureRoots 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const fixtureRoots: string[] = []

afterEach(() => {
  /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
  for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** 中文说明：函数 git 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function git(cwd: string, args: string[], input?: string | Buffer): string {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C' },
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim()
}

/** 中文说明：函数 gitBytes 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function gitBytes(cwd: string, args: string[], input?: Buffer): Buffer {
  return execFileSync('git', ['-C', cwd, ...args], {
    env: { ...process.env, LANG: 'C', LC_ALL: 'C' },
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}

/** 中文说明：函数 write 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function write(path: string, content: string, mode?: number): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, mode === undefined ? undefined : { mode })
}

/** 中文说明：函数 fixture 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function fixture(worktreeName = 'worktree'): Fixture {
  /** 中文说明：变量 container 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const container = mkdtempSync(join(tmpdir(), 'dsh-change-scope-'))
  fixtureRoots.push(container)
  /** 中文说明：变量 origin 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const origin = join(container, 'origin.git')
  /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const root = join(container, worktreeName)
  /** 中文说明：变量 hooks 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const hooks = join(container, 'hooks')
  mkdirSync(hooks)
  git(container, ['init', '--bare', '--initial-branch=master', origin])
  git(container, ['init', '--initial-branch=master', root])
  git(root, ['config', 'user.email', 'change-scope@example.com'])
  git(root, ['config', 'user.name', 'Change Scope Tests'])
  git(root, ['config', 'commit.gpgsign', 'false'])
  git(root, ['config', 'core.hooksPath', hooks])
  write(join(root, 'README.md'), '# Fixture\n')
  git(root, ['add', 'README.md'])
  git(root, ['commit', '-m', 'initial'])
  git(root, ['remote', 'add', 'origin', origin])
  git(root, ['push', '--set-upstream', 'origin', 'master'])
  return { container, root }
}

/** 中文说明：函数 commit 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function commit(root: string, path: string, content: string): string {
  write(join(root, path), content)
  git(root, ['add', '--', path])
  git(root, ['commit', '-m', `add ${path}`])
  return git(root, ['rev-parse', 'HEAD'])
}

/** 中文说明：函数 invoke 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function invoke(root: string, args: string[]): string {
  return renderChangeScope(args, root)
}

/** 中文说明：函数 jsonReport 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function jsonReport(root: string, base: string, head?: string): Report {
  /** 中文说明：变量 args 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const args = ['--base', base]
  if (head !== undefined) args.push('--head', head)
  return JSON.parse(invoke(root, args)) as Report
}

/** 中文说明：函数 repositoryState 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function repositoryState(root: string): Record<string, string> {
  /** 中文说明：变量 status 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const status = git(root, ['status', '--porcelain=v2', '--branch', '-z'])
  return {
    status,
    head: git(root, ['rev-parse', 'HEAD']),
    refs: git(root, ['for-each-ref', '--format=%(refname) %(objectname)']),
    index: readFileSync(join(root, '.git/index')).toString('base64'),
    config: readFileSync(join(root, '.git/config')).toString('base64'),
  }
}

describe('change-scope', () => {
  it('uses an explicit base on a fresh branch without a same-name remote and after its first push', { timeout: 20_000 }, () => {
    const { root } = fixture()
    git(root, ['switch', '-c', 'feature'])
    git(root, ['branch', '--set-upstream-to=origin/master'])
    /** 中文说明：变量 headSha 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const headSha = commit(root, 'feature.txt', 'feature\n')

    /** 中文说明：变量 fresh 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fresh = jsonReport(root, 'origin/master')
    expect(realpathSync.native(fresh.repositoryRoot)).toBe(realpathSync.native(root))
    expect(fresh.resolved).toEqual({
      baseSha: git(root, ['rev-parse', 'origin/master']),
      headSha,
      mergeBaseSha: git(root, ['rev-parse', 'origin/master']),
    })
    expect(fresh.paths).toEqual({ committed: ['feature.txt'], staged: [], unstaged: [], untracked: [] })
    expect(git(root, ['for-each-ref', '--format=%(refname)', 'refs/remotes/origin/feature'])).toBe('')

    git(root, ['push', '--set-upstream', 'origin', 'feature'])
    /** 中文说明：变量 pushed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pushed = jsonReport(root, 'origin/master')
    expect(pushed.paths.committed).toEqual(['feature.txt'])
  })

  it.skipIf(process.platform === 'win32')('preserves trailing spaces in the worktree path', () => {
    const { root } = fixture('worktree ')
    /** 中文说明：变量 report 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const report = jsonReport(root, 'HEAD')

    expect(realpathSync.native(report.repositoryRoot)).toBe(realpathSync.native(root))
    expect(report.paths).toEqual({ committed: [], staged: [], unstaged: [], untracked: [] })
  })

  it('reports an exact head above a non-master stacked base while dirty paths remain worktree-local', () => {
    const { root } = fixture()
    git(root, ['switch', '-c', 'foundation'])
    /** 中文说明：变量 baseSha 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const baseSha = commit(root, 'foundation.txt', 'foundation\n')
    git(root, ['switch', '-c', 'topic'])
    /** 中文说明：变量 headSha 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const headSha = commit(root, 'topic.txt', 'topic\n')
    commit(root, 'later.txt', 'later\n')
    write(join(root, 'current-worktree.txt'), 'current worktree\n')

    /** 中文说明：变量 report 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const report = jsonReport(root, 'foundation', headSha)
    expect(report.input).toEqual({ base: 'foundation', head: headSha })
    expect(report.resolved).toEqual({ baseSha, headSha, mergeBaseSha: baseSha })
    expect(report.paths.committed).toEqual(['topic.txt'])
    expect(report.paths.untracked).toEqual(['current-worktree.txt'])
  })

  it('keeps committed, staged, unstaged, and untracked paths independent and does not mutate state', () => {
    const { root } = fixture()
    commit(root, 'unstaged.txt', 'before\n')
    /** 中文说明：变量 baseSha 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const baseSha = git(root, ['rev-parse', 'HEAD'])
    commit(root, 'committed.txt', 'committed\n')
    write(join(root, 'staged.txt'), 'staged\n')
    write(join(root, 'mixed.txt'), 'staged part\n')
    git(root, ['add', 'staged.txt', 'mixed.txt'])
    write(join(root, 'mixed.txt'), 'staged part\nunstaged part\n')
    write(join(root, 'unstaged.txt'), 'unstaged\n')
    write(join(root, 'untracked.txt'), 'untracked\n')
    /** 中文说明：变量 before 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const before = repositoryState(root)

    /** 中文说明：变量 report 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const report = jsonReport(root, baseSha)

    expect(report.paths).toEqual({
      committed: ['committed.txt'],
      staged: ['mixed.txt', 'staged.txt'],
      unstaged: ['mixed.txt', 'unstaged.txt'],
      untracked: ['untracked.txt'],
    })
    expect(repositoryState(root)).toEqual(before)
  })

  it.skipIf(process.platform === 'win32')('does not execute a configured filesystem monitor', () => {
    const { container, root } = fixture()
    /** 中文说明：变量 monitor 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const monitor = join(container, 'fsmonitor.sh')
    /** 中文说明：变量 sideEffect 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sideEffect = `${monitor}.ran`
    write(monitor, '#!/bin/sh\ntouch "$0.ran"\n', 0o755)
    git(root, ['config', 'core.fsmonitor', monitor])

    /** 中文说明：变量 report 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const report = jsonReport(root, 'HEAD')

    expect(report.paths).toEqual({ committed: [], staged: [], unstaged: [], untracked: [] })
    expect(existsSync(sideEffect)).toBe(false)
  })

  it.skipIf(process.platform === 'win32')('rejects distinct non-UTF-8 Git paths', () => {
    const { root } = fixture()
    /** 中文说明：变量 blobSha 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const blobSha = git(root, ['hash-object', '-w', '--stdin'], 'content')
    /** 中文说明：变量 entry 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const entry = Buffer.from(`100644 ${blobSha}\t`, 'ascii')
    /** 中文说明：变量 firstPath 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const firstPath = Buffer.from([0x80])
    /** 中文说明：变量 secondPath 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const secondPath = Buffer.from([0x81])
    gitBytes(root, ['update-index', '-z', '--index-info'], Buffer.concat([
      entry,
      firstPath,
      Buffer.from([0]),
      entry,
      secondPath,
      Buffer.from([0]),
    ]))
    expect(gitBytes(root, ['diff', '--cached', '--name-only', '-z', '--'])).toEqual(Buffer.concat([
      firstPath,
      Buffer.from([0]),
      secondPath,
      Buffer.from([0]),
    ]))
    expect(() => {
      renderChangeScope(['--base', 'HEAD'], root)
    }).toThrow('cannot inspect staged paths: Git path 1 is not valid UTF-8')
  })

  it('rejects missing, ambiguous, and non-commit refs', () => {
    const { root } = fixture()
    git(root, ['branch', 'collision'])
    git(root, ['tag', 'collision'])
    write(join(root, 'blob.txt'), 'blob\n')
    /** 中文说明：变量 blobSha 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const blobSha = git(root, ['hash-object', '-w', 'blob.txt'])
    git(root, ['tag', 'blob-ref', blobSha])

    /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
    for (const { args, message } of [
      { args: ['--base', 'missing'], message: /base ref .* does not resolve to a commit/u },
      { args: ['--base', 'collision'], message: /base ref .* is ambiguous/u },
      { args: ['--base', 'blob-ref'], message: /base ref .* does not resolve to a commit/u },
      { args: ['--base', 'HEAD', '--head', 'missing'], message: /head ref .* does not resolve to a commit/u },
    ]) {
      expect(() => {
        renderChangeScope(args, root)
      }).toThrow(message)
    }
  })

  it('renders deterministic versioned JSON', () => {
    const { root } = fixture()
    git(root, ['switch', '-c', 'format'])
    commit(root, 'zeta.txt', 'zeta\n')
    commit(root, 'alpha.txt', 'alpha\n')

    /** 中文说明：变量 json 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const json = invoke(root, ['--base', 'origin/master'])
    /** 中文说明：变量 repeatedJson 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const repeatedJson = invoke(root, ['--base', 'origin/master'])
    /** 中文说明：变量 report 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const report = JSON.parse(json) as Report

    expect(json).toBe(repeatedJson)
    expect(report.formatVersion).toBe(1)
    expect(report.paths.committed).toEqual(['alpha.txt', 'zeta.txt'])
  })
})
