/**
 * Deterministic real-process proofs for runner classification: the real local
 * provider and sandbox bash executor exercise direct runner-spawn failures
 * and a POSIX fake Landlock launcher that prints its notice before exec.
 */
/**
 * 文件职责：验证 partial-landlock.spec.ts 覆盖的Shell 命令与沙箱行为、并发与异常场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、临时文件系统或受控子进程。
 * 产品维度：保障 Agent 的Shell 命令与沙箱能力稳定、安全且可诊断。
 * 逻辑维度：准备配置和测试资源，执行被测流程，再核对结果、错误与资源清理。
 * 关键边界：并发写入和进程退出可能竞态；敏感配置不得泄露；资源必须等待完全停止。
 * 新手阅读建议：先看夹具与平台条件，再读正常场景，最后关注并发、安全与失败路径。
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LAUNCHER_FAILURE_EXIT } from '@deepseek-ai/node-addon-landlock-run'
import { SANDBOX_UNAVAILABLE, SandboxUnavailableError } from '@deepseek-ai/dsh-sandbox'
import { LocalSandboxProvider } from '@deepseek-ai/dsh-sandbox-local'
import { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import { SandboxBashExecutor } from '@deepseek-ai/dsh-bash-sandbox'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'

/** 中文说明：常量 NOTICE 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const NOTICE = 'landlock-run: partial enforcement (older Landlock ABI)'
/** 中文说明：常量 FATAL_PREFIX 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const FATAL_PREFIX = 'landlock-run: '
/** 中文说明：常量 FATAL 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const FATAL = `${FATAL_PREFIX}landlock ruleset error: Invalid argument`

/** 中文说明：变量 contexts 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const contexts: Context[] = []
/** 中文说明：变量 tempDirs 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

/** Write a fake native launcher that reports partial enforcement, then execs or fails. */
/** 中文说明：函数 fakeLauncher 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function fakeLauncher(fatalExit?: number): Promise<string> {
  /** 中文说明：变量 dir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const dir = await mkdtemp(join(tmpdir(), 'dsh-partial-landlock-'))
  tempDirs.push(dir)
  /** 中文说明：变量 launcher 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const launcher = join(dir, 'landlock-run')
  /** 中文说明：变量 fatalBranch 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const fatalBranch = fatalExit === undefined ? '' : `printf '%s\\n' '${FATAL}' >&2\nexit ${fatalExit}\n`
  await writeFile(launcher, `#!/bin/sh
while [ "$#" -gt 0 ]; do
  case "$1" in
    --ro|--rw) shift 2 ;;
    --) shift; break ;;
    *) printf '%s\\n' '${FATAL_PREFIX}usage error: unexpected fake argument' >&2; exit ${LAUNCHER_FAILURE_EXIT} ;;
  esac
done
printf '%s\\n' '${NOTICE}' >&2
${fatalBranch}exec "$@"
`, { mode: 0o755 })
  return launcher
}

/** 中文说明：函数 setup 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function setup(fatalExit?: number): Promise<SandboxBashExecutor> {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LocalSandboxProvider, {})
  /** 中文说明：变量 sandbox 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const sandbox = ctx.sandbox as LocalSandboxProvider
  sandbox.internals = {
    platform: 'linux',
    probeBwrap: () => false,
    probeLandlock: () => 'partial',
    landlockLauncher: await fakeLauncher(fatalExit),
  }
  await ctx.plugin(SandboxPolicyService, { mode: 'read-only', workspaceRoot: process.cwd() })
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(SandboxBashExecutor, { cwd: process.cwd(), timeoutMs: 5_000 })
  return ctx.shell as SandboxBashExecutor
}

/** 中文说明：函数 setupConfiguredRunner 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function setupConfiguredRunner(runner: string): Promise<SandboxBashExecutor> {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LocalSandboxProvider, {
    runnerCommand: [runner],
    runnerFailureSignatures: ['configured-runner: fatal'],
  })
  await ctx.plugin(SandboxPolicyService, { mode: 'read-only', workspaceRoot: process.cwd() })
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(SandboxBashExecutor, { cwd: process.cwd(), timeoutMs: 5_000 })
  return ctx.shell as SandboxBashExecutor
}

describe('partial Landlock runner-failure classification', () => {
  it.each(['missing', 'unexecutable', 'missing-interpreter'] as const)('classifies a %s configured runner through the direct spawn error channel', async (kind) => {
    /** 中文说明：变量 dir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dir = await mkdtemp(join(tmpdir(), 'dsh-unusable-sandbox-runner-'))
    tempDirs.push(dir)
    /** 中文说明：变量 runner 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const runner = join(dir, `${kind}-runner`)
    if (kind === 'unexecutable') await writeFile(runner, '#!/bin/sh\nexit 0\n', { mode: 0o644 })
    if (kind === 'missing-interpreter') {
      await writeFile(runner, '#!/dsh-definitely-missing-sandbox-interpreter\nexit 0\n', { mode: 0o755 })
    }
    /** 中文说明：变量 bash 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bash = await setupConfiguredRunner(runner)

    /** 中文说明：函数值 error 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const error = await bash.run(bash.resolve({ command: 'true' })).catch((value: unknown) => value)
    expect(error).toMatchObject({ name: 'SandboxUnavailableError', code: SANDBOX_UNAVAILABLE })
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain(runner)

    /** 中文说明：变量 task 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const task = bash.start(bash.resolve({ command: 'true' }))
    await task.done
    expect(task.status).toBe('killed')
    expect(task.readOutput().delta).toContain(`spawn failed: Error: spawn ${runner}`)
    expect(task.sandbox).toEqual({
      mode: 'read-only',
      denied: false,
      enforcement: 'full',
      runnerFailed: true,
    })
    /** 中文说明：变量 accounting 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const accounting = (bash as unknown as { processFacts: Map<unknown, unknown> }).processFacts
    expect(accounting.size).toBe(0)
  })

  it.each(['bare-name', 'relative'] as const)(
    'classifies a %s runner whose shebang interpreter is missing',
    async (form) => {
      /** 中文说明：变量 dir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const dir = await mkdtemp(join(tmpdir(), 'dsh-argv-form-sandbox-runner-'))
      tempDirs.push(dir)
      /** 中文说明：变量 filename 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const filename = 'missing-interpreter-runner'
      /** 中文说明：变量 runner 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const runner = form === 'bare-name' ? filename : `./${filename}`
      await writeFile(join(dir, filename), '#!/dsh-definitely-missing-sandbox-interpreter\nexit 0\n', { mode: 0o755 })
      /** 中文说明：变量 bash 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const bash = await setupConfiguredRunner(runner)
      /** 中文说明：变量 request 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const request = form === 'bare-name'
        ? { command: 'true', env: { PATH: dir } }
        : { command: 'true', workdir: dir }

      /** 中文说明：函数值 error 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
      const error = await bash.run(bash.resolve(request)).catch((value: unknown) => value)
      expect(error).toMatchObject({ name: 'SandboxUnavailableError', code: SANDBOX_UNAVAILABLE })
      expect(error).toBeInstanceOf(Error)
      // Empirically, Darwin and Linux Node 24 preserve the passed bare/relative
      // argv[0] in this spawn error rather than resolving it to an absolute path.
      expect((error as Error).message).toContain(`spawn ${runner} ENOENT`)

      /** 中文说明：变量 task 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const task = bash.start(bash.resolve(request))
      await task.done
      expect(task.status).toBe('killed')
      expect(task.readOutput().delta).toContain(`spawn failed: Error: spawn ${runner} ENOENT`)
      expect(task.sandbox).toEqual({
        mode: 'read-only',
        denied: false,
        enforcement: 'full',
        runnerFailed: true,
      })
    },
  )

  it('keeps a real malformed executable ordinary across no-shebang spawn behavior', async () => {
    /** 中文说明：变量 dir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dir = await mkdtemp(join(tmpdir(), 'dsh-malformed-sandbox-runner-'))
    tempDirs.push(dir)
    /** 中文说明：变量 runner 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const runner = join(dir, 'malformed-runner')
    await writeFile(runner, 'not a native executable or shebang script\n', { mode: 0o755 })
    /** 中文说明：变量 bash 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bash = await setupConfiguredRunner(runner)
    /** 中文说明：变量 request 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const request = { command: 'true' }

    // Node/libuv may expose execve's ENOEXEC directly (Darwin) or retry a
    // no-shebang executable through /bin/sh (Linux). Neither path supplies the
    // ENOENT/EACCES with the exact failed executable path required for runner attribution.
    /** 中文说明：函数值 foreground 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const foreground = await bash.run(bash.resolve(request)).catch((value: unknown) => value)
    expect(foreground).not.toBeInstanceOf(SandboxUnavailableError)

    if (foreground instanceof Error) {
      expect(foreground).toMatchObject({ code: 'ENOEXEC', syscall: 'spawn' })
      expect((foreground as { path?: unknown }).path).toBeUndefined()

      /** 中文说明：变量 background 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      let background: unknown
      try {
        bash.start(bash.resolve(request))
      } catch (error) {
        background = error
      }
      expect(background).toMatchObject({ code: 'ENOEXEC', syscall: 'spawn' })
      expect((background as { path?: unknown }).path).toBeUndefined()
      expect(background).not.toBeInstanceOf(SandboxUnavailableError)
    } else {
      expect(foreground).toMatchObject({
        exitCode: 127,
        signal: null,
        sandbox: { mode: 'read-only', denied: false, enforcement: 'full' },
      })
      expect((foreground as { stderr: { text: string } }).stderr.text.length).toBeGreaterThan(0)

      /** 中文说明：变量 background 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const background = bash.start(bash.resolve(request))
      await background.done
      expect(background.status).toBe('completed')
      expect(background.exitCode).toBe(127)
      expect(background.signal).toBeNull()
      expect(background.sandbox).toEqual({ mode: 'read-only', denied: false, enforcement: 'full' })
      /** 中文说明：变量 output 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const output = background.readOutput().delta
      expect(output.startsWith('[stderr]\n')).toBe(true)
      expect(output.length).toBeGreaterThan('[stderr]\n'.length)
      expect(output).not.toContain('spawn failed:')
    }

    /** 中文说明：变量 accounting 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const accounting = (bash as unknown as { processFacts: Map<unknown, unknown> }).processFacts
    expect(accounting.size).toBe(0)
  })

  it.each([0, 1, 2, LAUNCHER_FAILURE_EXIT])(
    'keeps child exit %i ordinary when the partial-enforcement notice is the only runner line',
    async (exitCode) => {
      /** 中文说明：变量 bash 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const bash = await setup()
      /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const result = await bash.run(bash.resolve({ command: `exit ${exitCode}` }))
      expect(result.exitCode).toBe(exitCode)
      expect(result.stderr.text).toBe(`${NOTICE}\n`)
      expect(result.sandbox).toEqual({ mode: 'read-only', denied: false, enforcement: 'partial' })
    },
  )

  it.each([126, 127])('keeps a successfully launched Landlock child exit %i as an ordinary outcome', async (exitCode) => {
    /** 中文说明：变量 bash 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bash = await setup()
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await bash.run(bash.resolve({ command: `exit ${exitCode}` }))
    expect(result.exitCode).toBe(exitCode)
    expect(result.stderr.text).toBe(`${NOTICE}\n`)
    expect(result.sandbox).toEqual({ mode: 'read-only', denied: false, enforcement: 'partial' })
  })

  it.each([1, 2])('keeps a Landlock fatal line at exit %i as insufficient runner-failure evidence', async (exitCode) => {
    /** 中文说明：变量 bash 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bash = await setup(exitCode)
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await bash.run(bash.resolve({ command: 'true' }))
    expect(result.exitCode).toBe(exitCode)
    expect(result.stderr.text).toBe(`${NOTICE}\n${FATAL}\n`)
    expect(result.sandbox).toEqual({ mode: 'read-only', denied: false, enforcement: 'partial' })
  })

  it('reports the fatal line after the notice as SANDBOX_UNAVAILABLE detail', async () => {
    /** 中文说明：变量 bash 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bash = await setup(LAUNCHER_FAILURE_EXIT)
    /** 中文说明：函数值 error 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const error = await bash.run(bash.resolve({ command: 'true' })).catch((value: unknown) => value)
    expect(error).toMatchObject({ name: 'SandboxUnavailableError', code: SANDBOX_UNAVAILABLE })
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain(`Runner failure: ${FATAL}`)
    expect((error as Error).message).not.toContain(NOTICE)
  })

  it('classifies a notice plus child Permission denied as a denial, not runner failure', async () => {
    /** 中文说明：变量 bash 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bash = await setup()
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await bash.run(bash.resolve({ command: 'printf "%s\\n" "child: Permission denied" >&2; exit 1' }))
    expect(result.stderr.text).toBe(`${NOTICE}\nchild: Permission denied\n`)
    expect(result.sandbox).toEqual({ mode: 'read-only', denied: true, enforcement: 'partial' })
  })

  it('applies the same evidence rule to notice-only background exits', async () => {
    /** 中文说明：变量 bash 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bash = await setup()
    /** 中文说明：该循环依次处理测试数据；循环变量仅在当前循环中有效。 */
    for (const command of ['exit 1', 'exit 2', `exit ${LAUNCHER_FAILURE_EXIT}`]) {
      /** 中文说明：变量 task 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const task = bash.start(bash.resolve({ command }))
      await task.done
      expect(task.sandbox).toEqual({ mode: 'read-only', denied: false, enforcement: 'partial' })
      expect(task.readOutput().delta).toContain(NOTICE)
    }
  })

  it('classifies a background notice plus child Permission denied as denial', async () => {
    /** 中文说明：变量 bash 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bash = await setup()
    /** 中文说明：变量 task 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const task = bash.start(bash.resolve({ command: 'printf "%s\\n" "child: Permission denied" >&2; exit 1' }))
    await task.done
    expect(task.sandbox).toEqual({ mode: 'read-only', denied: true, enforcement: 'partial' })
    expect(task.readOutput().delta).toContain(NOTICE)
  })

  it('makes a background fatal line outrank denial text after the notice', async () => {
    /** 中文说明：变量 bash 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bash = await setup(LAUNCHER_FAILURE_EXIT)
    /** 中文说明：变量 task 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const task = bash.start(bash.resolve({ command: 'true' }))
    await task.done
    expect(task.sandbox).toEqual({
      mode: 'read-only',
      denied: false,
      enforcement: 'partial',
      runnerFailed: true,
    })
    /** 中文说明：变量 output 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const output = task.readOutput().delta
    expect(output).toContain(NOTICE)
    expect(output).toContain(FATAL)
  })
})
