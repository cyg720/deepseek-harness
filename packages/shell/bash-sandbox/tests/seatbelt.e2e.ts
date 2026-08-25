/**
 * 文件职责：验证 seatbelt.e2e.ts 覆盖的Shell 命令与沙箱行为、并发与异常场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、临时文件系统或受控子进程。
 * 产品维度：保障 Agent 的Shell 命令与沙箱能力稳定、安全且可诊断。
 * 逻辑维度：准备配置和测试资源，执行被测流程，再核对结果、错误与资源清理。
 * 关键边界：并发写入和进程退出可能竞态；敏感配置不得泄露；资源必须等待完全停止。
 * 新手阅读建议：先看夹具与平台条件，再读正常场景，最后关注并发、安全与失败路径。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LocalSandboxProvider } from '@deepseek-ai/dsh-sandbox-local'
import { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import { seatbeltProfileArgs } from '@deepseek-ai/dsh-sandbox-local/src/profiles.ts'
import { SandboxBashExecutor } from '@deepseek-ai/dsh-bash-sandbox'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'

/**
 * Keyless macOS integration of the real provider and executor through public run/start paths.
 * Linux rungs are forced off so Seatbelt is selected. The tests check world effects and stamped
 * facts, including EPERM classification through the wrap-carried dialect; backend-only
 * confinement is covered by `@deepseek-ai/dsh-sandbox-local`. Skips off macOS or when
 * `sandbox-exec` rejects the profile.
 */

/* 中文说明：变量 probe 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const probe = spawnSync('sandbox-exec', [...seatbeltProfileArgs({ mode: 'read-only', workspaceRoot: '/' }), '--', 'true'], { timeout: 5_000, stdio: 'ignore' })
/** 中文说明：变量 seatbeltUsable 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const seatbeltUsable = probe.status === 0

/** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let ctx: Context | undefined
/** 中文说明：变量 tempDirs 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const tempDirs: string[] = []

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

/** 中文说明：函数 tempDir 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function tempDir(base: string): Promise<string> {
  /** 中文说明：变量 dir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const dir = await mkdtemp(join(base, 'dsh-seatbelt-e2e-'))
  tempDirs.push(dir)
  return dir
}

/** 中文说明：函数 sandboxedBash 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function sandboxedBash(workspace: string, mode: 'read-only' | 'workspace-write'): Promise<SandboxBashExecutor> {
  ctx = new Context()
  await ctx.plugin(LocalSandboxProvider, {})
  ;(ctx.sandbox as LocalSandboxProvider).internals = { probeBwrap: () => false, probeLandlock: () => 'unusable' }
  await ctx.plugin(SandboxPolicyService, { mode, workspaceRoot: workspace })
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(SandboxBashExecutor, { cwd: workspace, timeoutMs: 30_000 })
  return ctx.shell as SandboxBashExecutor
}

describe.skipIf(!seatbeltUsable)('bash-sandbox: real Seatbelt confinement through ctx.shell', () => {
  it('read-only denies a write — the file must NOT exist, and EPERM text classifies as a denial', async () => {
    /** 中文说明：变量 workdir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const workdir = await tempDir(homedir())
    /** 中文说明：变量 bash 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bash = await sandboxedBash(workdir, 'read-only')
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await bash.run(bash.resolve({ command: `echo hi > ${workdir}/denied.txt` }))
    expect(result.exitCode).not.toBe(0)
    expect(result.sandbox).toEqual({ mode: 'read-only', denied: true, enforcement: 'full' })
    expect(existsSync(join(workdir, 'denied.txt'))).toBe(false)
  })

  it('workspace-write lands a write inside the workspace root and still denies one beside it', async () => {
    // HOME-based dirs on purpose: workspace-write grants /tmp and the
    // per-user temp dir wholesale, so only paths outside both prove the
    // workspace-root boundary.
    /** 中文说明：变量 workdir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const workdir = await tempDir(homedir())
    /** 中文说明：变量 outside 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const outside = await tempDir(homedir())
    /** 中文说明：变量 bash 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bash = await sandboxedBash(workdir, 'workspace-write')

    /** 中文说明：变量 inside 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const inside = await bash.run(bash.resolve({ command: `printf seatbelt-ok > ${workdir}/allowed.txt` }))
    expect(inside.exitCode).toBe(0)
    expect(inside.sandbox).toEqual({ mode: 'workspace-write', denied: false, enforcement: 'full' })
    expect(readFileSync(join(workdir, 'allowed.txt'), 'utf8')).toBe('seatbelt-ok')

    /** 中文说明：变量 denied 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const denied = await bash.run(bash.resolve({ command: `echo hi > ${outside}/denied.txt` }))
    expect(denied.exitCode).not.toBe(0)
    expect(denied.sandbox).toEqual({ mode: 'workspace-write', denied: true, enforcement: 'full' })
    expect(existsSync(join(outside, 'denied.txt'))).toBe(false)
  })

  it('evaluates BASH_ENV only after Seatbelt confines the inner Bash', async () => {
    /** 中文说明：变量 workdir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const workdir = await tempDir(homedir())
    /** 中文说明：变量 outside 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const outside = await tempDir(homedir())
    /** 中文说明：变量 hook 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const hook = join(workdir, 'bash-env-hook.sh')
    /** 中文说明：变量 insideProbe 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const insideProbe = join(workdir, 'hook-ran.txt')
    /** 中文说明：变量 outsideProbe 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const outsideProbe = join(outside, 'escaped.txt')
    await writeFile(hook, [
      'printf hook > "$DSH_BASH_ENV_INSIDE"',
      'printf escaped > "$DSH_BASH_ENV_OUTSIDE"',
      '',
    ].join('\n'))
    /** 中文说明：变量 bash 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bash = await sandboxedBash(workdir, 'workspace-write')

    await bash.run(bash.resolve({
      command: 'true',
      env: { BASH_ENV: hook },
      dshEnv: {
        DSH_BASH_ENV_INSIDE: insideProbe,
        DSH_BASH_ENV_OUTSIDE: outsideProbe,
      },
    }))

    expect(readFileSync(insideProbe, 'utf8')).toBe('hook')
    expect(existsSync(outsideProbe)).toBe(false)
  })

  it('classifies a background denial once the task settles', async () => {
    /** 中文说明：变量 workdir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const workdir = await tempDir(homedir())
    /** 中文说明：变量 bash 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bash = await sandboxedBash(workdir, 'read-only')
    /** 中文说明：变量 task 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const task = bash.start(bash.resolve({ command: `echo hi > ${workdir}/bg-denied.txt` }))
    await task.done
    expect(task.sandbox).toEqual({ mode: 'read-only', denied: true, enforcement: 'full' })
    expect(existsSync(join(workdir, 'bg-denied.txt'))).toBe(false)
  })

  it('an approved escalated retry — the spec-level workspace-write override — lands the exact write read-only denied', async () => {
    /** 中文说明：变量 workdir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const workdir = await tempDir(homedir())
    /** 中文说明：变量 bash 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bash = await sandboxedBash(workdir, 'read-only')
    /** 中文说明：变量 command 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const command = `printf escalated > ${workdir}/escalated.txt`
    /** 中文说明：变量 strict 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const strict = await bash.run(bash.resolve({ command }))
    expect(strict.exitCode).not.toBe(0)
    expect(strict.sandbox).toEqual({ mode: 'read-only', denied: true, enforcement: 'full' })
    expect(existsSync(join(workdir, 'escalated.txt'))).toBe(false)
    /** 中文说明：变量 retried 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const retried = await bash.run(bash.resolve({ command, sandboxPolicy: { mode: 'workspace-write', workspaceRoot: workdir } }))
    expect(retried.exitCode).toBe(0)
    expect(retried.sandbox).toEqual({ mode: 'workspace-write', denied: false, enforcement: 'full' })
    expect(readFileSync(join(workdir, 'escalated.txt'), 'utf8')).toBe('escalated')
  })
})
