/**
 * 文件职责：验证 seatbelt.e2e.ts 覆盖的沙箱策略、平台隔离与失败行为。
 * 技术维度：使用 TypeScript、Vitest、平台进程接口和受控文件系统资源。
 * 产品维度：保障 Agent 执行命令时遵循预期权限并给出可诊断失败。
 * 逻辑维度：准备策略和临时资源，启动受限操作，再核对结果、错误与清理。
 * 关键边界：平台能力可能缺失；安全失败必须显式；进程与临时资源必须完全释放。
 * 新手阅读建议：先读平台条件和夹具，再看允许/拒绝场景，最后阅读清理逻辑。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import { LocalSandboxProvider } from '@deepseek-ai/dsh-sandbox-local'
import { seatbeltProfileArgs } from '../src/profiles.ts'

/**
 * Keyless backend integration through `confine()` and a real macOS Seatbelt process, with Linux
 * rungs forced off. Tests assert world effects and that the kernel denial matches the advertised
 * dialect; consumer coverage lives in dsh-bash-sandbox. Skips off macOS or when the profile probe
 * fails. HOME-based workspaces avoid Seatbelt's wholesale temp-directory grants, so
 * workspace-write proves the workspace-root grant itself.
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

/** 中文说明：函数 tempDir 承担本测试的安全处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function tempDir(base: string): Promise<string> {
  /** 中文说明：变量 dir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const dir = await mkdtemp(join(base, 'dsh-seatbelt-e2e-'))
  tempDirs.push(dir)
  return dir
}

/** 中文说明：函数 provider 承担本测试的安全处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function provider(): Promise<LocalSandboxProvider> {
  ctx = new Context()
  await ctx.plugin(LocalSandboxProvider, {})
  /** 中文说明：变量 sandbox 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const sandbox = ctx.sandbox as LocalSandboxProvider
  sandbox.internals = { probeBwrap: () => false, probeLandlock: () => 'unusable' }
  return sandbox
}

/** Confine a shell command under `policy` and run it for real; returns the spawn result and the wrap's facts. */
/* 中文说明：函数 runConfined 承担本测试的安全处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function runConfined(sandbox: LocalSandboxProvider, command: string, policy: SandboxPolicy) {
  /** 中文说明：变量 confined 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const confined = sandbox.confine(['bash', '-c', command], policy)
  /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const result = spawnSync(confined.argv[0] as string, confined.argv.slice(1), { timeout: 30_000, encoding: 'utf8' })
  return { result, confined }
}

describe.skipIf(!seatbeltUsable)('sandbox-local: real Seatbelt confinement through sandbox-exec', () => {
  it('read-only denies a write — the file must NOT exist, and the kernel speaks the advertised dialect', async () => {
    /** 中文说明：变量 workdir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const workdir = await tempDir(tmpdir())
    /** 中文说明：变量 sandbox 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sandbox = await provider()
    const { result, confined } = runConfined(sandbox, `echo hi > ${workdir}/denied.txt`, { mode: 'read-only', workspaceRoot: workdir })
    expect(result.status).not.toBe(0)
    expect(confined.enforcement).toBe('full')
    // The wrap's denialSignatures must be what the kernel actually prints.
    expect(result.stderr.toLowerCase()).toContain('operation not permitted')
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

  it('read-only grants no temp area: a write under the user temp dir is denied too', async () => {
    // The per-user darwin temp dir is a workspace-write grant, not a
    // read-only one — under read-only the only write-shaped path is /dev/null.
    /** 中文说明：变量 workdir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const workdir = await tempDir(tmpdir())
    /** 中文说明：变量 sandbox 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sandbox = await provider()
    /** 中文说明：变量 target 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const target = join(workdir, 'tmp-denied.txt')
    const { result } = runConfined(sandbox, `echo hi > ${target}`, { mode: 'read-only', workspaceRoot: await tempDir(homedir()) })
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
    const inside = runConfined(sandbox, `printf seatbelt-ok > ${workdir}/allowed.txt`, { mode: 'workspace-write', workspaceRoot: workdir })
    expect(inside.result.status).toBe(0)
    expect(readFileSync(join(workdir, 'allowed.txt'), 'utf8')).toBe('seatbelt-ok')

    /** 中文说明：变量 denied 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const denied = runConfined(sandbox, `echo hi > ${outside}/denied.txt`, { mode: 'workspace-write', workspaceRoot: workdir })
    expect(denied.result.status).not.toBe(0)
    expect(existsSync(join(outside, 'denied.txt'))).toBe(false)
  })

  it('workspace-write grants /tmp and the user temp dir (the documented Seatbelt-profile temp areas)', async () => {
    /** 中文说明：变量 workdir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const workdir = await tempDir(homedir())
    /** 中文说明：变量 hostTmp 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const hostTmp = await tempDir('/tmp')
    /** 中文说明：变量 userTmp 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const userTmp = await tempDir(tmpdir())
    /** 中文说明：变量 sandbox 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sandbox = await provider()
    const { result } = runConfined(
      sandbox,
      `printf tmp-ok > ${hostTmp}/scratch.txt && printf user-tmp-ok > ${userTmp}/scratch.txt`,
      { mode: 'workspace-write', workspaceRoot: workdir },
    )
    expect(result.status).toBe(0)
    expect(readFileSync(join(hostTmp, 'scratch.txt'), 'utf8')).toBe('tmp-ok')
    expect(readFileSync(join(userTmp, 'scratch.txt'), 'utf8')).toBe('user-tmp-ok')
  })
})
