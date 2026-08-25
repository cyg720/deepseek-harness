/**
 * Real-backend end-to-end: LocalSandboxProvider (win32 chain → the
 * windows-acl runner), SandboxPolicyService, and SandboxPwshExecutor with
 * REAL pwsh spawns confined through the runner — the debug-instance
 * verification of both modes on ordinary user-owned paths: read-only denies
 * writes, workspace-write allows its promised roots while denying escape
 * writes, and the partial-enforcement/denial facts ride the settled result.
 */
/**
 * 文件职责：验证 acl.e2e.ts 覆盖的Shell 命令与沙箱行为、并发与异常场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、临时文件系统或受控子进程。
 * 产品维度：保障 Agent 的Shell 命令与沙箱能力稳定、安全且可诊断。
 * 逻辑维度：准备配置和测试资源，执行被测流程，再核对结果、错误与资源清理。
 * 关键边界：并发写入和进程退出可能竞态；敏感配置不得泄露；资源必须等待完全停止。
 * 新手阅读建议：先看夹具与平台条件，再读正常场景，最后关注并发、安全与失败路径。
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import { resolvePwshPath } from '@deepseek-ai/dsh-pwsh-local'
import { LocalSandboxProvider } from '@deepseek-ai/dsh-sandbox-local'
import { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { SandboxPwshExecutor } from '../src/index.ts'

/** 中文说明：变量 isWin32 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const isWin32 = process.platform === 'win32'

/** 中文说明：函数 pwshAvailable 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function pwshAvailable(): boolean {
  return spawnSync(resolvePwshPath(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$true'], { encoding: 'utf8' }).status === 0
}

describe.skipIf(!isWin32 || !pwshAvailable())('pwsh-sandbox real ACL confinement', () => {
  /** 中文说明：变量 scratchRoot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let scratchRoot!: string
  /** 中文说明：变量 writableDir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let writableDir!: string
  /** 中文说明：变量 outsideTempDir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let outsideTempDir!: string
  /** 中文说明：变量 secretFile 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let secretFile!: string
  /** 中文说明：变量 escapeFile 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let escapeFile!: string
  /** 中文说明：变量 executor 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let executor!: SandboxPwshExecutor

  beforeAll(async () => {
    // The workspace escape sits under the profile. A separate directory under
    // the ambient temp root proves that the root itself is not granted: the
    // runner creates its own private child and rewrites TMP/TEMP to it.
    scratchRoot = mkdtempSync(join(homedir(), 'dsh-pwsh-sandbox-e2e-'))
    writableDir = join(scratchRoot, 'writable')
    mkdirSync(writableDir)
    outsideTempDir = mkdtempSync(join(tmpdir(), 'dsh-pwsh-sandbox-e2e-outside-temp-'))
    secretFile = join(scratchRoot, 'secret.txt')
    writeFileSync(secretFile, 'top secret - must stay readable to prove the read boundary')
    escapeFile = join(scratchRoot, 'escaped.txt')

    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(LocalSandboxProvider, {})
    await ctx.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: writableDir })
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(SandboxPwshExecutor, {})
    executor = ctx.shell as SandboxPwshExecutor
  })

  afterAll(() => {
    rmSync(scratchRoot, { recursive: true, force: true })
    rmSync(outsideTempDir, { recursive: true, force: true })
  })

  it('read-only: ordinary path writes denied, reads fine, partial and denial facts ride the result', async () => {
    /** 中文说明：变量 policy 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const policy: SandboxExecutionPolicy = { mode: 'read-only', workspaceRoot: writableDir }
    /** 中文说明：变量 probe 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const probe = [
      "$ErrorActionPreference='SilentlyContinue';",
      `try{Set-Content -Path '${writableDir}\\ro-write.txt' -Value ok -ErrorAction Stop;'TARGET-WRITE: OK'}catch{'TARGET-WRITE: DENIED'};`,
      `try{Set-Content -Path '${outsideTempDir}\\ro-write.txt' -Value ok -ErrorAction Stop;'TEMP-WRITE: OK'}catch{'TEMP-WRITE: DENIED'};`,
      `try{Set-Content -Path '${escapeFile}' -Value ok -ErrorAction Stop;'ESCAPE-WRITE: OK'}catch{'ESCAPE-WRITE: DENIED'};`,
      `try{Get-Content '${secretFile}' -ErrorAction Stop | Out-Null;'SECRET-READ: OK'}catch{'SECRET-READ: DENIED'}`,
    ].join('')
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await executor.run(executor.resolve({ command: probe, sandboxPolicy: policy }))
    expect(result.exitCode, `stderr: ${result.stderr.text}`).toBe(0)
    expect(result.stdout.text).toContain('TARGET-WRITE: DENIED')
    expect(result.stdout.text).toContain('TEMP-WRITE: DENIED')
    expect(result.stdout.text).toContain('ESCAPE-WRITE: DENIED')
    expect(result.stdout.text).toContain('SECRET-READ: OK')
    expect(existsSync(join(writableDir, 'ro-write.txt'))).toBe(false)
    // A self-caught denial keeps the command exit 0: no denial fact.
    expect(result.sandbox).toEqual({ mode: 'read-only', denied: false, enforcement: 'partial' })

    // A raw failing write must classify as a denial of the ACL dialect.
    /** 中文说明：变量 denied 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const denied = await executor.run(executor.resolve({
      command: `Set-Content -Path '${escapeFile}' -Value x`,
      sandboxPolicy: policy,
    }))
    expect(denied.exitCode).not.toBe(0)
    expect(denied.sandbox).toEqual({ mode: 'read-only', denied: true, enforcement: 'partial' })
  }, 60_000)

  it('workspace-write: workspace and private temp writable, ambient temp and escape denied', async () => {
    /** 中文说明：变量 policy 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const policy: SandboxExecutionPolicy = { mode: 'workspace-write', workspaceRoot: writableDir }
    /** 中文说明：变量 probe 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const probe = [
      "$ErrorActionPreference='SilentlyContinue';",
      `try{Set-Content -Path '${writableDir}\\ww-write.txt' -Value ok -ErrorAction Stop;'TARGET-WRITE: OK'}catch{'TARGET-WRITE: DENIED'};`,
      "try{Set-Content -Path (Join-Path $env:TEMP 'ww-write.txt') -Value ok -ErrorAction Stop;'TEMP-WRITE: OK'}catch{'TEMP-WRITE: DENIED'};",
      `try{Set-Content -Path '${outsideTempDir}\\ww-write.txt' -Value ok -ErrorAction Stop;'AMBIENT-TEMP-WRITE: OK'}catch{'AMBIENT-TEMP-WRITE: DENIED'};`,
      `try{Set-Content -Path '${escapeFile}' -Value ok -ErrorAction Stop;'ESCAPE-WRITE: OK'}catch{'ESCAPE-WRITE: DENIED'};`,
      `try{Get-Content '${secretFile}' -ErrorAction Stop | Out-Null;'SECRET-READ: OK'}catch{'SECRET-READ: DENIED'};`,
      "'TEMP-PATH: ' + $env:TEMP",
    ].join('')
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await executor.run(executor.resolve({ command: probe, sandboxPolicy: policy }))
    expect(result.exitCode, `stderr: ${result.stderr.text}`).toBe(0)
    expect(result.stdout.text).toContain('TARGET-WRITE: OK')
    expect(result.stdout.text).toContain('TEMP-WRITE: OK')
    expect(result.stdout.text).toContain('AMBIENT-TEMP-WRITE: DENIED')
    expect(result.stdout.text).toContain('ESCAPE-WRITE: DENIED')
    expect(result.stdout.text).toContain('SECRET-READ: OK')
    expect(existsSync(join(writableDir, 'ww-write.txt'))).toBe(true)
    expect(existsSync(join(outsideTempDir, 'ww-write.txt'))).toBe(false)
    expect(existsSync(escapeFile)).toBe(false)
    /** 中文说明：变量 privateTemp 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const privateTemp = result.stdout.text.match(/^TEMP-PATH: (.+)$/mu)?.[1]?.trim()
    expect(privateTemp).toBeDefined()
    expect(privateTemp?.startsWith(tmpdir())).toBe(true)
    expect(existsSync(privateTemp ?? '')).toBe(false)
    expect(result.sandbox).toEqual({ mode: 'workspace-write', denied: false, enforcement: 'partial' })
  }, 60_000)
})
