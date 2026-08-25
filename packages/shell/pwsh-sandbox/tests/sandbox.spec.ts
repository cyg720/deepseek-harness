/**
 * Consumer-side `SandboxPwshExecutor` tests. A fake Cordis sandbox service
 * makes wrapping, policy hand-off, fail-closed propagation, and fact stamping
 * deterministic; real-provider integration lives in `tests/acl.e2e.ts`.
 * Requires pwsh for the integration block (skips without it — same gate as
 * pwsh-local's suites); the helpers block is pure and always runs.
 */
/*
 * 文件职责：验证 sandbox.spec.ts 覆盖的Shell 命令与沙箱行为、并发与异常场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、临时文件系统或受控子进程。
 * 产品维度：保障 Agent 的Shell 命令与沙箱能力稳定、安全且可诊断。
 * 逻辑维度：准备配置和测试资源，执行被测流程，再核对结果、错误与资源清理。
 * 关键边界：并发写入和进程退出可能竞态；敏感配置不得泄露；资源必须等待完全停止。
 * 新手阅读建议：先看夹具与平台条件，再读正常场景，最后关注并发、安全与失败路径。
 */

import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { SandboxProvider, SandboxUnavailableError } from '@deepseek-ai/dsh-sandbox'
import type { ConfinedArgv, RunnerFailureRule, SandboxExecutionPolicy, SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import { resolvePwshPath } from '@deepseek-ai/dsh-pwsh-local'
import { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { SandboxPwshExecutor } from '../src/index.ts'
import { classifyRunnerFailure, isRunnerSpawnFailure, matchesSignature } from '../src/helpers.ts'

// The same probe pwsh-local's suites and the vitest coverage exemption use:
// spawnSync never throws on a missing binary (it reports status null), and
// `where.exe pwsh` exits 1 when pwsh is absent — only the status is truth.
/** 中文说明：函数 pwshAvailable 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function pwshAvailable(): boolean {
  return spawnSync(resolvePwshPath(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$true'], { encoding: 'utf8' }).status === 0
}

/** 中文说明：变量 spillDir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const spillDir = mkdtempSync(join(tmpdir(), 'dsh-pwsh-sandbox-spec-'))

/** One recorded provider call: the argv handed over and the policy it rode with. */
/* 中文说明：interface ConfineCall 定义本测试所需的数据或行为，用于表达Shell 命令与沙箱场景。 */
interface ConfineCall {
  argv: string[]
  policy: SandboxPolicy
}

/** A passthrough wrap: the caller's argv unchanged, asserted full — commands run unconfined, deterministically. */
/* 中文说明：函数值 passthrough 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
const passthrough = (argv: readonly string[]): ConfinedArgv =>
  ({ argv: [...argv], enforcement: 'full', denialSignatures: ['access is denied', 'access to the path'], runnerFailureRules: [] })

/** A subprocess service whose spawn() throws SYNCHRONOUSLY — the paths the async service never produces. */
/* 中文说明：函数 throwingSubprocessRuntime 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function throwingSubprocessRuntime(error: unknown): new (ctx: Context) => Service {
  return class extends Service {
    constructor(ctx: Context) {
      super(ctx, 'subprocess')
    }

    spawn(): never {
      throw error
    }
  }
}

/** 中文说明：函数 setup 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function setup(
  behavior: (argv: readonly string[], policy: SandboxPolicy) => ConfinedArgv = passthrough,
  subprocess: new (ctx: Context) => Service = LocalSubprocessRuntime,
): Promise<{ executor: SandboxPwshExecutor; calls: ConfineCall[] }> {
  /** 中文说明：变量 calls 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const calls: ConfineCall[] = []
  /** 中文说明：class FakeSandboxProvider 定义本测试所需的数据或行为，用于表达Shell 命令与沙箱场景。 */
  class FakeSandboxProvider extends SandboxProvider {
    confine(argv: readonly string[], policy: SandboxPolicy): ConfinedArgv {
      calls.push({ argv: [...argv], policy })
      return behavior(argv, policy)
    }
  }
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await ctx.plugin(FakeSandboxProvider)
  await ctx.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: spillDir })
  await ctx.plugin(subprocess)
  if (ctx.subprocess instanceof LocalSubprocessRuntime) {
    ctx.subprocess.internals = { spillDir }
  }
  await ctx.plugin(SandboxPwshExecutor, { graceMs: 200 })
  return { executor: ctx.shell as SandboxPwshExecutor, calls }
}

describe('helpers (pure)', () => {
  /** 中文说明：变量 workdir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const workdir = mkdtempSync(join(tmpdir(), 'dsh-pwsh-sandbox-helpers-'))
  afterAll(() => {
    rmSync(workdir, { recursive: true, force: true })
  })

  describe('isRunnerSpawnFailure', () => {
    /** 中文说明：变量 absolute 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const absolute = process.execPath
    /** 中文说明：变量 bare 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bare = 'node'
    /** 中文说明：变量 relative 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const relative = './sandbox-runner'

    it('attributes ENOENT/EACCES with argv[0] provenance and a usable workdir', () => {
      /** 中文说明：该循环依次处理测试数据；循环变量仅在当前循环中有效。 */
      for (const runnerProgram of [absolute, bare, relative]) {
        expect(isRunnerSpawnFailure({ code: 'ENOENT', syscall: `spawn ${runnerProgram}`, path: runnerProgram }, runnerProgram, workdir)).toBe(true)
        expect(isRunnerSpawnFailure({ code: 'EACCES', syscall: `spawn ${runnerProgram}`, path: runnerProgram }, runnerProgram, workdir)).toBe(true)
        expect(isRunnerSpawnFailure({ code: 'ENOENT', syscall: 'spawn', path: runnerProgram }, runnerProgram, workdir)).toBe(true)
        expect(isRunnerSpawnFailure({ code: 'ENOENT', syscall: `spawn ${runnerProgram}` }, runnerProgram, workdir)).toBe(true)
      }
    })

    it('rejects mismatched provenance, foreign codes, unusable workdirs, and non-object errors', () => {
      expect(isRunnerSpawnFailure({ code: 'ENOENT', syscall: 'spawn', path: 'other' }, 'node', workdir)).toBe(false)
      expect(isRunnerSpawnFailure({ code: 'ENOENT', syscall: 'spawn other', path: 'node' }, 'node', workdir)).toBe(false)
      expect(isRunnerSpawnFailure({ code: 'EMFILE', syscall: 'spawn', path: 'node' }, 'node', workdir)).toBe(false)
      expect(isRunnerSpawnFailure({ code: 'ENOENT', path: 'node' }, 'node', workdir)).toBe(false)
      expect(isRunnerSpawnFailure({ code: 'ENOENT', syscall: 'spawn' }, 'node', join(workdir, 'missing'))).toBe(false)
      expect(isRunnerSpawnFailure({ code: 'ENOENT', syscall: 'spawn' }, undefined, workdir)).toBe(false)
      expect(isRunnerSpawnFailure('boom', 'node', workdir)).toBe(false)
      expect(isRunnerSpawnFailure(null, 'node', workdir)).toBe(false)
      // An existing FILE (not a directory) workdir is unusable without throwing.
      /** 中文说明：变量 fileWorkdir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const fileWorkdir = join(workdir, 'a-file')
      writeFileSync(fileWorkdir, 'x')
      expect(isRunnerSpawnFailure({ code: 'ENOENT', syscall: 'spawn', path: 'node' }, 'node', fileWorkdir)).toBe(false)
    })
  })

  describe('classifyRunnerFailure', () => {
    /** 中文说明：变量 rules 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const rules: readonly RunnerFailureRule[] = [{
      allowedExitCodes: [127],
      fatalSignatures: ['fake-runner: '],
      informationalLines: ['fake-runner: partial enforcement'],
    }]

    it('matches a fatal signature on a gated exit code, skipping informational lines', () => {
      expect(classifyRunnerFailure(127, 'fake-runner: partial enforcement\nfake-runner: profile refused\n', rules))
        .toEqual({ detail: 'fake-runner: profile refused' })
    })

    it('rejects zero/null exits, gate mismatches, and empty signatures', () => {
      expect(classifyRunnerFailure(0, 'fake-runner: x', rules)).toBeUndefined()
      expect(classifyRunnerFailure(null, 'fake-runner: x', rules)).toBeUndefined()
      expect(classifyRunnerFailure(1, 'fake-runner: x', rules)).toBeUndefined()
      expect(classifyRunnerFailure(127, 'clean output', rules)).toBeUndefined()
      expect(classifyRunnerFailure(127, 'fake-runner: x', [{ fatalSignatures: ['  '] }])).toBeUndefined()
    })

    it('the windows-acl rule is exit-gated on 127: a confined command that merely prints the signature on a non-127 exit is NOT a runner failure', () => {
      /** 中文说明：变量 windowsAclRules 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const windowsAclRules: readonly RunnerFailureRule[] = [{ allowedExitCodes: [127], fatalSignatures: ['windows-acl-run: '] }]
      expect(classifyRunnerFailure(3, 'windows-acl-run: something the command printed', windowsAclRules)).toBeUndefined()
      expect(classifyRunnerFailure(127, 'windows-acl-run: missing --workspace', windowsAclRules))
        .toEqual({ detail: 'windows-acl-run: missing --workspace' })
    })
  })

  describe('matchesSignature', () => {
    it('matches non-zero exits case-insensitively, never zero or signal exits', () => {
      expect(matchesSignature(1, 'Access to the path is denied.', ['access to the path'])).toBe(true)
      expect(matchesSignature(1, 'ACCESS IS DENIED.', ['access is denied'])).toBe(true)
      expect(matchesSignature(1, 'clean', ['access is denied'])).toBe(false)
      expect(matchesSignature(0, 'access is denied', ['access is denied'])).toBe(false)
      expect(matchesSignature(null, 'access is denied', ['access is denied'])).toBe(false)
    })
  })
})

describe.skipIf(!pwshAvailable())('SandboxPwshExecutor', () => {
  // Denial device for the POSIX classification cases: a mode-0555 directory
  // INSIDE a temp scratch tree (the same device as bash-sandbox's suites) —
  // unit tests never attempt writes outside the system temp directory. On
  // win32 there is no POSIX mode denial; the real-sandbox denial coverage
  // lives in tests/acl.e2e.ts, where the ACL runner denies scratch paths.
  /** 中文说明：变量 readOnlyDir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const readOnlyDir = mkdtempSync(join(tmpdir(), 'dsh-pwsh-sandbox-ro-'))
  if (process.platform !== 'win32') chmodSync(readOnlyDir, 0o555)
  /** 中文说明：变量 deniedWriteCommand 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const deniedWriteCommand = `[IO.File]::WriteAllText('${join(readOnlyDir, 'probe.txt')}', 'x')`

  afterAll(() => {
    if (process.platform !== 'win32') chmodSync(readOnlyDir, 0o755)
    rmSync(readOnlyDir, { recursive: true, force: true })
    rmSync(spillDir, { recursive: true, force: true })
  })

  /** 中文说明：常量 RO 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
  const RO: SandboxExecutionPolicy = { mode: 'read-only', workspaceRoot: '/ws' }

  it('wraps the exact pwsh argv through ctx.sandbox with the per-call policy', async () => {
    const { executor, calls } = await setup()
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await executor.run(executor.resolve({ command: 'echo wrapped', sandboxPolicy: RO }))
    expect(result.exitCode).toBe(0)
    expect(calls).toHaveLength(1)
    /** 中文说明：变量 call 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const call = calls[0]
    expect(call?.policy).toEqual(RO)
    // The confined argv is the pwsh invocation, ready for a runner prefix.
    expect(call?.argv[0]).toMatch(/pwsh(\.exe)?$/u)
    expect(call?.argv).toContain('-NonInteractive')
    expect(call?.argv.at(-1)).toContain('echo wrapped')
    expect(result.sandbox).toEqual({ mode: 'read-only', denied: false, enforcement: 'full' })
  }, 30_000)

  it('advertises the deployment default mode and stamps the deployment policy when none rides the request', async () => {
    const { executor, calls } = await setup()
    expect(executor.sandboxMode).toBe('workspace-write')
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await executor.run(executor.resolve({ command: 'echo fallback' }))
    expect(result.exitCode).toBe(0)
    expect(calls[0]?.policy.mode).toBe('workspace-write')
  }, 30_000)

  it('danger-full-access bypasses confine entirely and stamps full-access facts', async () => {
    const { executor, calls } = await setup()
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await executor.run(executor.resolve({ command: 'echo full', sandboxPolicy: { mode: 'danger-full-access', workspaceRoot: '/ws' } }))
    expect(result.exitCode).toBe(0)
    expect(calls).toHaveLength(0)
    expect(result.sandbox).toEqual({ mode: 'danger-full-access', denied: false })
  }, 30_000)

  it('an aborted caller signal outranks runner-spawn attribution', async () => {
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    controller.abort('caller-cancel')
    const { executor } = await setup(() => ({
      argv: ['definitely-not-a-real-runner', '--', 'pwsh'],
      enforcement: 'full',
      denialSignatures: [],
      runnerFailureRules: [],
    }))
    await expect(executor.run(executor.resolve({ command: 'echo never', sandboxPolicy: RO, signal: controller.signal })))
      .rejects.toThrow('caller-cancel')
  }, 30_000)

  // POSIX-only: the denial device is a mode-0555 scratch dir. On win32 the
  // real-sandbox denial classification is covered by tests/acl.e2e.ts
  // (the ACL runner denies scratch paths — unit tests never leave temp).
  it.skipIf(process.platform === 'win32')('classifies a failed write against the backend denial dialect', async () => {
    const { executor } = await setup()
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await executor.run(executor.resolve({
      command: deniedWriteCommand,
      sandboxPolicy: RO,
    }))
    expect(result.exitCode).not.toBe(0)
    expect(result.sandbox).toEqual({ mode: 'read-only', denied: true, enforcement: 'full' })
  }, 30_000)

  it('a runner launch refusal fails closed with SANDBOX_UNAVAILABLE, never unconfined', async () => {
    const { executor } = await setup(() => ({
      argv: ['definitely-not-a-real-runner', '--', 'pwsh'],
      enforcement: 'full',
      denialSignatures: [],
      runnerFailureRules: [{ fatalSignatures: ['fake-runner: '] }],
    }))
    await expect(executor.run(executor.resolve({ command: 'echo never-runs', sandboxPolicy: RO })))
      .rejects.toThrow(SandboxUnavailableError)
  }, 30_000)

  it('a SYNCHRONOUS attributable spawn rejection in run() fails closed, an unattributable one rethrows', async () => {
    /** 中文说明：变量 attributable 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const attributable = Object.assign(new Error('sync-enoent'), { code: 'ENOENT', syscall: 'spawn node', path: 'node' })
    const { executor: closed } = await setup(() => ({
      argv: ['node', '--', 'pwsh'],
      enforcement: 'full',
      denialSignatures: [],
      runnerFailureRules: [{ fatalSignatures: ['fake-runner: '] }],
    }), throwingSubprocessRuntime(attributable))
    await expect(closed.run(closed.resolve({ command: 'echo never', sandboxPolicy: RO })))
      .rejects.toThrow(SandboxUnavailableError)

    /** 中文说明：变量 foreign 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const foreign = Object.assign(new Error('sync-emfile'), { code: 'EMFILE', syscall: 'spawn', path: 'node' })
    const { executor: passthroughError } = await setup(undefined, throwingSubprocessRuntime(foreign))
    await expect(passthroughError.run(passthroughError.resolve({ command: 'echo never', sandboxPolicy: RO })))
      .rejects.toThrow('sync-emfile')
  }, 30_000)

  it('a SYNCHRONOUS spawn rejection in start() follows the same attribution split', async () => {
    /** 中文说明：变量 attributable 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const attributable = Object.assign(new Error('sync-enoent-start'), { code: 'ENOENT', syscall: 'spawn node', path: 'node' })
    const { executor: closed } = await setup(() => ({
      argv: ['node', '--', 'pwsh'],
      enforcement: 'full',
      denialSignatures: [],
      runnerFailureRules: [{ fatalSignatures: ['fake-runner: '] }],
    }), throwingSubprocessRuntime(attributable))
    expect(() => closed.start(closed.resolve({ command: 'echo never', sandboxPolicy: RO })))
      .toThrow(SandboxUnavailableError)

    /** 中文说明：变量 foreign 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const foreign = Object.assign(new Error('sync-emfile-start'), { code: 'EMFILE', syscall: 'spawn', path: 'node' })
    const { executor: passthroughError } = await setup(undefined, throwingSubprocessRuntime(foreign))
    expect(() => passthroughError.start(passthroughError.resolve({ command: 'echo never', sandboxPolicy: RO })))
      .toThrow('sync-emfile-start')
  }, 30_000)

  it('a runner that REFUSES at runtime (fatal signature, nonzero exit) fails closed too', async () => {
    const { executor } = await setup(() => ({
      argv: [process.execPath, '-e', 'console.error(\'fake-runner: profile refused\'); process.exit(127)', '--'],
      enforcement: 'full',
      denialSignatures: [],
      runnerFailureRules: [{ fatalSignatures: ['fake-runner: '] }],
    }))
    await expect(executor.run(executor.resolve({ command: 'echo never-runs', sandboxPolicy: RO })))
      .rejects.toThrow(SandboxUnavailableError)
  }, 30_000)

  it('background confined runs stamp clean facts at settlement', async () => {
    const { executor } = await setup()
    /** 中文说明：变量 clean 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const clean = executor.start(executor.resolve({ command: 'echo background-ok', sandboxPolicy: RO }))
    await clean.done
    expect(clean.sandbox).toEqual({ mode: 'read-only', denied: false, enforcement: 'full' })
  }, 30_000)

  // POSIX-only denial device (mode-0555 scratch); win32 real-sandbox denial
  // coverage lives in tests/acl.e2e.ts.
  it.skipIf(process.platform === 'win32')('background denied writes stamp denied facts at settlement', async () => {
    const { executor } = await setup()
    /** 中文说明：变量 denied 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const denied = executor.start(executor.resolve({
      command: deniedWriteCommand,
      sandboxPolicy: RO,
    }))
    await denied.done
    expect(denied.sandbox).toEqual({ mode: 'read-only', denied: true, enforcement: 'full' })
  }, 30_000)

  it('background spawn rejections settle as runnerFailed facts', async () => {
    const { executor } = await setup(() => ({
      argv: ['definitely-not-a-real-runner', '--', 'pwsh'],
      enforcement: 'full',
      denialSignatures: [],
      runnerFailureRules: [{ fatalSignatures: ['fake-runner: '] }],
    }))
    /** 中文说明：变量 proc 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const proc = executor.start(executor.resolve({ command: 'echo never', sandboxPolicy: RO }))
    await proc.done
    expect(proc.sandbox).toEqual({ mode: 'read-only', denied: false, enforcement: 'full', runnerFailed: true })
    // The failure note surfaces through the read path.
    /** 中文说明：变量 read 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const read = proc.readOutput()
    expect(read.delta).toContain('spawn failed')
  }, 30_000)

  it('danger-full-access background runs bypass confine and carry no facts', async () => {
    const { executor, calls } = await setup()
    /** 中文说明：变量 proc 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const proc = executor.start(executor.resolve({
      command: 'echo full-bg',
      sandboxPolicy: { mode: 'danger-full-access', workspaceRoot: '/ws' },
    }))
    await proc.done
    expect(calls).toHaveLength(0)
    expect(proc.sandbox).toBeUndefined()
  }, 30_000)
})
