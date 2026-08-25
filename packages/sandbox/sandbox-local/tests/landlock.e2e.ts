/**
 * 文件职责：验证 landlock.e2e.ts 覆盖的沙箱策略与本地隔离行为与失败场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件上下文和受控系统资源。
 * 产品维度：保障沙箱策略与本地隔离在真实使用路径中稳定且可诊断。
 * 逻辑维度：准备配置与资源，触发被测流程，再核对结果、错误和清理。
 * 关键边界：平台能力可能不同；安全失败必须显式；异步资源必须等待完全停止。
 * 新手阅读建议：先读辅助函数，再看正常路径，最后阅读平台差异与失败用例。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import { launcherPath } from '@deepseek-ai/node-addon-landlock-run'
import { LocalSandboxProvider } from '@deepseek-ai/dsh-sandbox-local'

/**
 * Keyless backend integration through `confine()` and the workspace `landlock-run` launcher, with
 * bwrap forced off. Tests assert real world effects; consumer coverage lives in dsh-bash-sandbox.
 * Skips when the platform package or enforcing kernel is unavailable. HOME-based workspaces avoid
 * Landlock's wholesale `/tmp` grant, so workspace-write proves the workspace-root grant itself.
 */

/* 中文说明：变量 probe 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const probe = spawnSync(launcherPath(), ['--probe'], { timeout: 5_000, encoding: 'utf8' })
/** 中文说明：变量 landlockUsable 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const landlockUsable = probe.status === 0
/** The running kernel's enforcement level, from the launcher's probe report — every wrap below must carry exactly this. */
/* 中文说明：变量 enforcement 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const enforcement = /partially enforced/.test(probe.stdout ?? '') ? 'partial' : 'full'

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
  const dir = await mkdtemp(join(base, 'dsh-landlock-e2e-'))
  tempDirs.push(dir)
  return dir
}

/** 中文说明：函数 provider 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function provider(): Promise<LocalSandboxProvider> {
  ctx = new Context()
  await ctx.plugin(LocalSandboxProvider, {})
  /** 中文说明：变量 sandbox 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const sandbox = ctx.sandbox as LocalSandboxProvider
  sandbox.internals = { probeBwrap: () => false }
  return sandbox
}

/** Confine a shell command under `policy` and run it for real; returns the spawn result and the wrap's enforcement. */
/* 中文说明：函数 runConfined 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function runConfined(sandbox: LocalSandboxProvider, command: string, policy: SandboxPolicy) {
  /** 中文说明：变量 confined 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const confined = sandbox.confine(['bash', '-c', command], policy)
  /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const result = spawnSync(confined.argv[0] as string, confined.argv.slice(1), { timeout: 30_000, encoding: 'utf8' })
  return { result, enforcement: confined.enforcement }
}

describe.skipIf(!landlockUsable)('sandbox-local: real Landlock confinement through the bundled launcher', () => {
  it('read-only denies a write — the file must NOT exist, the wrap reports the probed enforcement', async () => {
    /** 中文说明：变量 workdir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const workdir = await tempDir(tmpdir())
    /** 中文说明：变量 sandbox 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sandbox = await provider()
    const { result, enforcement: wrapped } = runConfined(sandbox, `echo hi > ${workdir}/denied.txt`, { mode: 'read-only', workspaceRoot: workdir })
    expect(result.status).not.toBe(0)
    expect(wrapped).toBe(enforcement)
    expect(existsSync(join(workdir, 'denied.txt'))).toBe(false)
  })

  it('read-only keeps the tree readable/executable and /dev/null writable', async () => {
    /** 中文说明：变量 workdir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const workdir = await tempDir(tmpdir())
    /** 中文说明：变量 sandbox 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sandbox = await provider()
    const { result } = runConfined(sandbox, 'ls / > /dev/null && echo dev-ok', { mode: 'read-only', workspaceRoot: workdir })
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('dev-ok\n')
  })

  it('read-only denies a write beneath the host /dev (the /dev/shm tmpfs must stay untouched)', async () => {
    // The grant is /dev/null the FILE, not /dev the directory: /dev/shm is a
    // world-writable host tmpfs, and a write landing there would be exactly
    // the persistent host effect read-only promises never happen.
    /** 中文说明：变量 workdir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const workdir = await tempDir(tmpdir())
    /** 中文说明：变量 sandbox 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sandbox = await provider()
    /** 中文说明：变量 target 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const target = `/dev/shm/dsh-landlock-e2e-${process.pid}`
    const { result } = runConfined(sandbox, `echo hi > ${target}`, { mode: 'read-only', workspaceRoot: workdir })
    expect(result.status).not.toBe(0)
    expect(existsSync(target)).toBe(false)
  })

  it('workspace-write lands a write inside the workspace root and still denies one beside it', async () => {
    /** 中文说明：变量 workdir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const workdir = await tempDir(homedir())
    /** 中文说明：变量 outside 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const outside = await tempDir(homedir())
    /** 中文说明：变量 sandbox 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sandbox = await provider()

    /** 中文说明：变量 inside 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const inside = runConfined(sandbox, `printf landlock-ok > ${workdir}/allowed.txt`, { mode: 'workspace-write', workspaceRoot: workdir })
    expect(inside.result.status).toBe(0)
    expect(readFileSync(join(workdir, 'allowed.txt'), 'utf8')).toBe('landlock-ok')

    /** 中文说明：变量 denied 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const denied = runConfined(sandbox, `echo hi > ${outside}/denied.txt`, { mode: 'workspace-write', workspaceRoot: workdir })
    expect(denied.result.status).not.toBe(0)
    expect(existsSync(join(outside, 'denied.txt'))).toBe(false)
  })

  it('workspace-write grants the host /tmp (the documented Landlock-profile difference)', async () => {
    /** 中文说明：变量 workdir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const workdir = await tempDir(homedir())
    /** 中文说明：变量 scratch 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const scratch = await tempDir(tmpdir())
    /** 中文说明：变量 sandbox 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sandbox = await provider()
    const { result } = runConfined(sandbox, `printf tmp-ok > ${scratch}/scratch.txt`, { mode: 'workspace-write', workspaceRoot: workdir })
    expect(result.status).toBe(0)
    expect(readFileSync(join(scratch, 'scratch.txt'), 'utf8')).toBe('tmp-ok')
  })
})
