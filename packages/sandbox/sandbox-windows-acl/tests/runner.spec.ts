/**
 * End-to-end runner tests: spawn the REAL runner entry through tsx (exactly
 * the argv shape dsh-sandbox-local's confine() builds), with piped stdio
 * inherited through the runner into the confined child — the same chain a
 * production confined execution walks.
 */
/*
 * 文件职责：验证 runner.spec.ts 覆盖的沙箱安全与权限隔离行为与失败场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件上下文和受控系统资源。
 * 产品维度：保障 Agent 使用沙箱安全与权限隔离时得到稳定且可诊断的结果。
 * 逻辑维度：准备配置与资源，触发被测流程，再核对结果、事件、错误和清理。
 * 关键边界：平台能力可能不同；持久化数据和外部输入不可信；异步资源必须完全释放。
 * 新手阅读建议：先读辅助函数和平台条件，再看正常路径，最后阅读恢复与失败用例。
 */

import { spawnSync } from 'node:child_process'
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { resolvePwshPath } from '@deepseek-ai/dsh-pwsh-local'
import { AclWriteGrant, tempWriteSid, workspaceWriteSid } from '../src/index.ts'

/** 中文说明：变量 isWin32 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const isWin32 = process.platform === 'win32'
/** 中文说明：变量 runnerEntry 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const runnerEntry = fileURLToPath(new URL('../src/runner.ts', import.meta.url))

// Functional probe, not where.exe: spawnSync never throws on a missing
// binary (status null) and where.exe exits 1 without pwsh — only an actual
// pwsh invocation's exit status is truth.
/** 中文说明：函数 pwshAvailable 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function pwshAvailable(): boolean {
  return spawnSync(resolvePwshPath(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$true'], { encoding: 'utf8' }).status === 0
}

/** 中文说明：函数 runRunner 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function runRunner(args: string[], timeoutMs = 30_000) {
  return spawnSync(process.execPath, ['--import', 'tsx/esm', runnerEntry, ...args], {
    timeout: timeoutMs,
    encoding: 'utf8',
  })
}

describe.skipIf(!isWin32 || !pwshAvailable())('windows-acl runner', () => {
  /** 中文说明：变量 scratchRoot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let scratchRoot!: string
  /** 中文说明：变量 writableDir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let writableDir!: string
  /** 中文说明：变量 isolatedTemp 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let isolatedTemp!: string
  /** 中文说明：变量 secretFile 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let secretFile!: string
  /** 中文说明：变量 escapeFile 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let escapeFile!: string
  /** 中文说明：变量 worldWritableDir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let worldWritableDir!: string
  // The ambient-writable probe target: a subdirectory of C:\Users\Public.
  // INTERACTIVE/LOCAL are absent from BOTH restricting lists, so the Public
  // tree's INTERACTIVE grant must NOT satisfy the write check — the ambient
  // boundary the dual-list design closes (bot-reported blind spot). The
  // Public tree may be unavailable or unwritable for the test user on some
  // hosts; the probe test skips itself when the directory cannot be created.
  /** 中文说明：变量 publicProbeDir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let publicProbeDir: string | undefined

  beforeAll(() => {
    scratchRoot = mkdtempSync(join(tmpdir(), 'dsh-acl-runner-'))
    writableDir = join(scratchRoot, 'writable')
    mkdirSync(writableDir)
    isolatedTemp = mkdtempSync(join(tmpdir(), 'dsh-acl-runner-temp-'))
    secretFile = join(scratchRoot, 'secret.txt')
    writeFileSync(secretFile, 'top secret - must stay readable to prove the read boundary')
    escapeFile = join(scratchRoot, 'escaped.txt')
    worldWritableDir = join(scratchRoot, 'world-writable')
    mkdirSync(worldWritableDir)
    /** 中文说明：变量 worldGrant 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const worldGrant = spawnSync('icacls', [worldWritableDir, '/grant', '*S-1-1-0:(OI)(CI)(M)'], { encoding: 'utf8' })
    if (worldGrant.status !== 0) {
      throw new Error(`icacls Everyone grant failed: ${worldGrant.stdout}\n${worldGrant.stderr}`)
    }
    try {
      publicProbeDir = mkdtempSync(join(process.env.PUBLIC ?? 'C:\\Users\\Public', 'dsh-acl-public-'))
    } catch {
      publicProbeDir = undefined
    }
  })

  afterAll(() => {
    rmSync(scratchRoot, { recursive: true, force: true })
    rmSync(isolatedTemp, { recursive: true, force: true })
    if (publicProbeDir !== undefined) rmSync(publicProbeDir, { recursive: true, force: true })
  })

  it('workspace-write: the confined child writes granted directories only', () => {
    /** 中文说明：变量 probe 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const probe = [
      "$ErrorActionPreference='SilentlyContinue';",
      // The private-temp capability lets PowerShell complete its startup
      // AppLocker probe, so without a host policy workspace-write stays in
      // FullLanguage. Read-only cannot create those scratch files and fails
      // that probe closed to ConstrainedLanguage (pinned below).
      '\'LANGMODE: \' + $ExecutionContext.SessionState.LanguageMode;',
      `try{Set-Content -Path '${writableDir}\\child-wrote.txt' -Value ok -ErrorAction Stop;'TARGET-WRITE: OK'}catch{'TARGET-WRITE: DENIED'};`,
      "try{Set-Content -Path (Join-Path $env:TEMP 'child-wrote.txt') -Value ok -ErrorAction Stop;'TEMP-WRITE: OK'}catch{'TEMP-WRITE: DENIED'};",
      `try{Set-Content -Path '${escapeFile}' -Value ok -ErrorAction Stop;'ESCAPE-WRITE: OK (ESCAPE!)'}catch{'ESCAPE-WRITE: DENIED'};`,
      `try{Get-Content '${secretFile}' -ErrorAction Stop | Out-Null;'SECRET-READ: OK'}catch{'SECRET-READ: DENIED'};`,
      // Authenticated Users is absent from BOTH lists: the WMI namespace
      // security check fails (0x80041003) — CIM is unavailable under every
      // confined mode (the documented contract; the C:\-root tree-creation
      // escape is closed in both as the other side of the trade).
      "try{Get-CimInstance Win32_OperatingSystem -ErrorAction Stop | Out-Null;'CIM: OK'}catch{'CIM: DENIED'}",
    ].join('')
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = runRunner([
      '--workspace', writableDir, '--temp', isolatedTemp, '--mode', 'workspace-write',
      '--', 'pwsh', '/NoLogo', '/NonInteractive', '/NoProfile', '/Command', probe,
    ])
    expect(result.status, `stderr: ${result.stderr}`).toBe(0)
    expect(result.stdout).toContain('LANGMODE: FullLanguage')
    expect(result.stdout).toContain('TARGET-WRITE: OK')
    expect(result.stdout).toContain('TEMP-WRITE: OK')
    expect(result.stdout).toContain('ESCAPE-WRITE: DENIED')
    expect(result.stdout).toContain('SECRET-READ: OK')
    expect(result.stdout).toContain('CIM: DENIED')
    expect(existsSync(escapeFile)).toBe(false)
    expect(existsSync(join(writableDir, 'child-wrote.txt'))).toBe(true)
  }, 30_000)

  it('read-only: no write-SID grants — workspace/temp writes denied, reads and $null redirection fine, CIM unavailable', () => {
    /** 中文说明：变量 probe 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const probe = [
      "$ErrorActionPreference='SilentlyContinue';",
      '\'LANGMODE: \' + $ExecutionContext.SessionState.LanguageMode;',
      `try{Set-Content -Path '${writableDir}\\readonly-child-wrote.txt' -Value ok -ErrorAction Stop;'TARGET-WRITE: OK'}catch{'TARGET-WRITE: DENIED'};`,
      `try{Set-Content -Path '${isolatedTemp}\\readonly-child-wrote.txt' -Value ok -ErrorAction Stop;'TEMP-WRITE: OK'}catch{'TEMP-WRITE: DENIED'};`,
      // Set-Content NUL fails at the PowerShell/.NET layer even though the
      // device DACL's Everyone rights remain an ambient backend boundary.
      'try{Set-Content -Path \'NUL\' -Value ok -ErrorAction Stop;\'NUL-WRITE: OK\'}catch{\'NUL-WRITE: DENIED\'};',
      // PowerShell's $null redirection discards without opening NUL — must keep working.
      'echo hi > $null;\'DOLLAR-NULL: OK\';',
      `try{Get-Content '${secretFile}' -ErrorAction Stop | Out-Null;'SECRET-READ: OK'}catch{'SECRET-READ: DENIED'};`,
      // BOTH lists drop Authenticated Users: the WMI namespace security
      // check fails (0x80041003) — the documented CIM boundary of every
      // confined mode, the price of the zero ambient-write surface.
      "try{Get-CimInstance Win32_OperatingSystem -ErrorAction Stop | Out-Null;'CIM: OK'}catch{'CIM: DENIED'}",
    ].join('')
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = runRunner([
      '--workspace', writableDir, '--temp', isolatedTemp, '--mode', 'read-only',
      '--', 'pwsh', '/NoLogo', '/NonInteractive', '/NoProfile', '/Command', probe,
    ])
    expect(result.status, `stderr: ${result.stderr}`).toBe(0)
    expect(result.stdout).toContain('LANGMODE: ConstrainedLanguage')
    expect(result.stdout).toContain('TARGET-WRITE: DENIED')
    expect(result.stdout).toContain('TEMP-WRITE: DENIED')
    expect(result.stdout).toContain('NUL-WRITE: DENIED')
    expect(result.stdout).toContain('DOLLAR-NULL: OK')
    expect(result.stdout).toContain('SECRET-READ: OK')
    expect(result.stdout).toContain('CIM: DENIED')
    expect(existsSync(join(writableDir, 'readonly-child-wrote.txt'))).toBe(false)
  }, 30_000)

  it('workspace-write: Remove-Item and Rename-Item succeed in the granted workspace (DELETE + FILE_DELETE_CHILD)', () => {
    // Deleting a file and renaming a directory both hit the second access
    // check on the workspace itself: the grant must carry DELETE (on the
    // object) and FILE_DELETE_CHILD (on its parent).
    /** 中文说明：变量 victimFile 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const victimFile = join(writableDir, 'delete-me.txt')
    writeFileSync(victimFile, 'remove me')
    /** 中文说明：变量 victimDir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const victimDir = join(writableDir, 'rename-me')
    mkdirSync(victimDir)
    /** 中文说明：变量 renamedDir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const renamedDir = join(writableDir, 'renamed-by-child')
    /** 中文说明：变量 probe 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const probe = [
      "$ErrorActionPreference='SilentlyContinue';",
      `try{Remove-Item -LiteralPath '${victimFile}' -ErrorAction Stop;'DELETE-FILE: OK'}catch{'DELETE-FILE: DENIED'};`,
      `try{Rename-Item -LiteralPath '${victimDir}' -NewName 'renamed-by-child' -ErrorAction Stop;'RENAME-DIR: OK'}catch{'RENAME-DIR: DENIED'}`,
    ].join('')
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = runRunner([
      '--workspace', writableDir, '--temp', isolatedTemp, '--mode', 'workspace-write',
      '--', 'pwsh', '/NoLogo', '/NonInteractive', '/NoProfile', '/Command', probe,
    ])
    expect(result.status, `stderr: ${result.stderr}`).toBe(0)
    expect(result.stdout).toContain('DELETE-FILE: OK')
    expect(result.stdout).toContain('RENAME-DIR: OK')
    expect(existsSync(victimFile)).toBe(false)
    expect(existsSync(renamedDir)).toBe(true)
  }, 30_000)

  it('paired SIDs: the runner trusts caller-owned private-temp grants and materializes nothing itself', () => {
    /** 中文说明：变量 seamWorkspace 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const seamWorkspace = join(scratchRoot, 'seam-workspace')
    mkdirSync(seamWorkspace)
    /** 中文说明：变量 writeSid 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const writeSid = workspaceWriteSid(seamWorkspace)
    /** 中文说明：变量 privateTemp 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const privateTemp = join(isolatedTemp, 'private-subdir')
    mkdirSync(privateTemp)
    /** 中文说明：变量 privateTempSid 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const privateTempSid = tempWriteSid(privateTemp)
    /** 中文说明：变量 grant 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const grant = AclWriteGrant.create(privateTempSid)
    grant.add(privateTemp)
    try {
      /** 中文说明：变量 probe 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const probe = [
        "$ErrorActionPreference='SilentlyContinue';",
        `try{Set-Content -Path '${seamWorkspace}\\server-granted.txt' -Value ok -ErrorAction Stop;'WORKSPACE-WRITE: OK'}catch{'WORKSPACE-WRITE: DENIED'};`,
        `try{Set-Content -Path '${privateTemp}\\server-granted.txt' -Value ok -ErrorAction Stop;'PRIVATE-TEMP-WRITE: OK'}catch{'PRIVATE-TEMP-WRITE: DENIED'};`,
        "'TEMP-ENV: ' + $env:TEMP;",
        "'TMP-ENV: ' + $env:TMP",
      ].join('')
      /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const result = runRunner([
        '--workspace', seamWorkspace, '--temp', privateTemp, '--mode', 'workspace-write', '--write-sid', writeSid,
        '--temp-write-sid', privateTempSid,
        '--', 'pwsh', '/NoLogo', '/NonInteractive', '/NoProfile', '/Command', probe,
      ])
      expect(result.status, `stderr: ${result.stderr}`).toBe(0)
      // The runner granted nothing (only the caller's temp-SID grant
      // stands): the workspace write is denied, the private temp write lands,
      // and the child's TMP/TEMP point at the private subdirectory.
      expect(result.stdout).toContain('WORKSPACE-WRITE: DENIED')
      expect(result.stdout).toContain('PRIVATE-TEMP-WRITE: OK')
      expect(result.stdout).toContain(`TEMP-ENV: ${privateTemp}`)
      expect(result.stdout).toContain(`TMP-ENV: ${privateTemp}`)
      expect(existsSync(join(seamWorkspace, 'server-granted.txt'))).toBe(false)
      expect(existsSync(join(privateTemp, 'server-granted.txt'))).toBe(true)
    } finally {
      grant.dispose()
      rmSync(privateTemp, { recursive: true, force: true })
    }
  }, 30_000)

  it('temp capabilities isolate sibling sessions that share one workspace SID', () => {
    /** 中文说明：变量 writeSid 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const writeSid = workspaceWriteSid(writableDir)
    /** 中文说明：变量 tempA 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const tempA = join(isolatedTemp, 'session-a')
    /** 中文说明：变量 tempB 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const tempB = join(isolatedTemp, 'session-b')
    mkdirSync(tempA)
    mkdirSync(tempB)
    /** 中文说明：变量 sidA 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sidA = tempWriteSid(tempA)
    /** 中文说明：变量 sidB 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sidB = tempWriteSid(tempB)
    /** 中文说明：变量 workspaceGrant 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const workspaceGrant = AclWriteGrant.create(writeSid)
    /** 中文说明：变量 grantA 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const grantA = AclWriteGrant.create(sidA)
    /** 中文说明：变量 grantB 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const grantB = AclWriteGrant.create(sidB)
    workspaceGrant.add(writableDir)
    grantA.add(tempA)
    grantB.add(tempB)
    /** 中文说明：变量 sharedWorkspaceFile 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sharedWorkspaceFile = join(writableDir, 'shared-between-sessions.txt')
    /** 中文说明：变量 probe 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const probe = [
      "const fs = require('node:fs');",
      "const targets = [['OWN', process.argv[1]], ['SIBLING', process.argv[2]], ['WORKSPACE', process.argv[3]]];",
      "if (process.argv[4]) targets.push(['SIBLING-EXISTING', process.argv[4]]);",
      'for (const [name, target] of targets) {',
      "try { fs.writeFileSync(target, name); console.log(name + ': OK'); } catch { console.log(name + ': DENIED'); }",
      '}',
    ].join('')
    try {
      /** 中文说明：变量 resultA 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const resultA = runRunner([
        '--workspace', writableDir, '--temp', tempA, '--mode', 'workspace-write',
        '--write-sid', writeSid, '--temp-write-sid', sidA,
        '--', process.execPath, '-e', probe, join(tempA, 'a.txt'), join(tempB, 'a-escaped.txt'), sharedWorkspaceFile,
      ])
      expect(resultA.status, `stderr: ${resultA.stderr}`).toBe(0)
      expect(resultA.stdout).toContain('OWN: OK')
      expect(resultA.stdout).toContain('SIBLING: DENIED')
      expect(resultA.stdout).toContain('WORKSPACE: OK')

      /** 中文说明：变量 resultB 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const resultB = runRunner([
        '--workspace', writableDir, '--temp', tempB, '--mode', 'workspace-write',
        '--write-sid', writeSid, '--temp-write-sid', sidB,
        '--', process.execPath, '-e', probe, join(tempB, 'b.txt'), join(tempA, 'b-escaped.txt'), sharedWorkspaceFile, join(tempA, 'a.txt'),
      ])
      expect(resultB.status, `stderr: ${resultB.stderr}`).toBe(0)
      expect(resultB.stdout).toContain('OWN: OK')
      expect(resultB.stdout).toContain('SIBLING: DENIED')
      expect(resultB.stdout).toContain('SIBLING-EXISTING: DENIED')
      expect(resultB.stdout).toContain('WORKSPACE: OK')
      expect(existsSync(join(tempB, 'a-escaped.txt'))).toBe(false)
      expect(existsSync(join(tempA, 'b-escaped.txt'))).toBe(false)
      expect(readFileSync(join(tempA, 'a.txt'), 'utf8')).toBe('OWN')
    } finally {
      workspaceGrant.dispose()
      grantA.dispose()
      grantB.dispose()
      rmSync(tempA, { recursive: true, force: true })
      rmSync(tempB, { recursive: true, force: true })
    }
  }, 30_000)

  it('agentless workspace-write creates a fresh private temp per call and removes it on exit', () => {
    /** 中文说明：变量 captureA 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const captureA = join(writableDir, 'agentless-temp-a.txt')
    /** 中文说明：变量 captureB 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const captureB = join(writableDir, 'agentless-temp-b.txt')
    /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
    for (const capture of [captureA, captureB]) {
      /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const result = runRunner([
        '--workspace', writableDir, '--temp', isolatedTemp, '--mode', 'workspace-write',
        '--', process.execPath, '-e', "require('node:fs').writeFileSync(process.argv[1], process.env.TEMP)", capture,
      ])
      expect(result.status, `stderr: ${result.stderr}`).toBe(0)
    }
    /** 中文说明：变量 tempA 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const tempA = readFileSync(captureA, 'utf8')
    /** 中文说明：变量 tempB 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const tempB = readFileSync(captureB, 'utf8')
    expect(tempA).not.toBe(tempB)
    expect(tempA.startsWith(isolatedTemp)).toBe(true)
    expect(tempB.startsWith(isolatedTemp)).toBe(true)
    expect(existsSync(tempA)).toBe(false)
    expect(existsSync(tempB)).toBe(false)
  }, 30_000)

  it('agentless workspace-write rejects a temp root inside the workspace before spawning', () => {
    /** 中文说明：变量 overlapWorkspace 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const overlapWorkspace = join(scratchRoot, 'overlap-workspace')
    /** 中文说明：变量 nestedTempRoot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const nestedTempRoot = join(overlapWorkspace, 'temp')
    /** 中文说明：变量 marker 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const marker = join(overlapWorkspace, 'command-ran.txt')
    mkdirSync(overlapWorkspace)
    mkdirSync(nestedTempRoot)

    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = runRunner([
      '--workspace', overlapWorkspace, '--temp', nestedTempRoot, '--mode', 'workspace-write',
      '--', process.execPath, '-e', "require('node:fs').writeFileSync(process.argv[1], 'ran')", marker,
    ])
    expect(result.status, `stderr: ${result.stderr}`).toBe(127)
    expect(result.stderr).toContain('windows-acl-run: Windows ACL temp root must be outside the workspace')
    expect(existsSync(marker)).toBe(false)
  }, 15_000)

  it('confined children spawn grandchildren with inherited stdio; piped capture stays denied (named-pipe default SD template)', () => {
    // Two-layer pin of the grandchild-spawn boundary:
    //  - the token default DACL carries a restricting-SID ACE (set in init),
    //    so ANONYMOUS pipe creation (CreatePipe — the token-default-DACL
    //    consumer) works and inherited/ignored stdio spawns succeed;
    //  - libuv's pipe-stdio uses NAMED pipes, whose default security
    //    descriptor is the Win32 layer's user-mode default SD template
    //    (built by KernelBase — owner/SYSTEM/Admins full, Everyone/ANONYMOUS
    //    read-only) — NOT the token default DACL, which is what the kernel
    //    applies to a raw SD-null create — so the client-end open requests
    //    write access no restricting SID is
    //    granted: ERROR_ACCESS_DENIED, surfaced as spawn EPERM. That is the
    //    POC-documented "no output redirection" boundary of WRITE_RESTRICTED
    //    tokens; piped capture cannot work and is pinned as DENIED.
    /** 中文说明：变量 probe 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const probe = [
      "const { spawnSync } = require('child_process');",
      "const t = (name, opts) => { const s = spawnSync(process.execPath, ['-e', '1'], { encoding: 'utf8', ...opts }); console.log(name + ':' + (s.status === 0 ? 'OK' : 'DENIED')); };",
      "t('inherit', { stdio: 'inherit' });",
      "t('ignore', { stdio: 'ignore' });",
      "t('pipe', { stdio: 'pipe' });",
    ].join('')
    /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
    for (const mode of ['workspace-write', 'read-only'] as const) {
      /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const result = runRunner([
        '--workspace', writableDir, '--temp', isolatedTemp, '--mode', mode,
        '--', 'node', '-e', probe,
      ])
      expect(result.status, `stderr: ${result.stderr}`).toBe(0)
      expect(result.stdout, `mode: ${mode}`).toContain('inherit:OK')
      expect(result.stdout, `mode: ${mode}`).toContain('ignore:OK')
      expect(result.stdout, `mode: ${mode}`).toContain('pipe:DENIED')
    }
  }, 30_000)

  it('mode-downgrade leak regression: a STANDING workspace grant is inert under read-only and effective again on re-upgrade', () => {
    // The reported defect: a session that materialized its grant in
    // workspace-write keeps the ACE standing for the server lifetime. After
    // switching to read-only, the restricted token's read-only list must carry NO
    // capability SID — the standing ACE stays but the pass-2 check cannot use
    // it, so the workspace write is denied instead of leaking through the
    // standing ACE. The switch back reuses the SAME standing ACE: the
    // re-upgrade write lands without any re-grant.
    const writeSid = workspaceWriteSid(writableDir)
    /** 中文说明：变量 privateTemp 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const privateTemp = join(isolatedTemp, 'mode-switch-temp')
    mkdirSync(privateTemp)
    /** 中文说明：变量 privateTempSid 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const privateTempSid = tempWriteSid(privateTemp)
    /** 中文说明：变量 grant 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const grant = AclWriteGrant.create(writeSid)
    grant.add(writableDir)
    try {
      /** 中文说明：变量 downgradeProbe 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const downgradeProbe = [
        "$ErrorActionPreference='SilentlyContinue';",
        `try{Set-Content -Path '${writableDir}\\downgraded.txt' -Value ok -ErrorAction Stop;'DOWNGRADE-WRITE: OK (LEAK!)'}catch{'DOWNGRADE-WRITE: DENIED'}`,
      ].join('')
      /** 中文说明：变量 downgraded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const downgraded = runRunner([
        '--workspace', writableDir, '--temp', isolatedTemp, '--mode', 'read-only',
        '--', 'pwsh', '/NoLogo', '/NonInteractive', '/NoProfile', '/Command', downgradeProbe,
      ])
      expect(downgraded.status, `stderr: ${downgraded.stderr}`).toBe(0)
      expect(downgraded.stdout).toContain('DOWNGRADE-WRITE: DENIED')
      expect(existsSync(join(writableDir, 'downgraded.txt'))).toBe(false)

      /** 中文说明：变量 reupgradeProbe 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const reupgradeProbe = [
        "$ErrorActionPreference='SilentlyContinue';",
        `try{Set-Content -Path '${writableDir}\\reupgraded.txt' -Value ok -ErrorAction Stop;'REUPGRADE-WRITE: OK'}catch{'REUPGRADE-WRITE: DENIED'}`,
      ].join('')
      /** 中文说明：变量 reupgraded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const reupgraded = runRunner([
        '--workspace', writableDir, '--temp', privateTemp, '--mode', 'workspace-write', '--write-sid', writeSid,
        '--temp-write-sid', privateTempSid,
        '--', 'pwsh', '/NoLogo', '/NonInteractive', '/NoProfile', '/Command', reupgradeProbe,
      ])
      expect(reupgraded.status, `stderr: ${reupgraded.stderr}`).toBe(0)
      expect(reupgraded.stdout).toContain('REUPGRADE-WRITE: OK')
      expect(existsSync(join(writableDir, 'reupgraded.txt'))).toBe(true)
    } finally {
      grant.dispose()
      rmSync(privateTemp, { recursive: true, force: true })
    }
  }, 30_000)

  it('ambient-writable escape regression: a C:\\Users\\Public subdirectory is denied under BOTH modes (INTERACTIVE absent from both lists)', (ctx) => {
    // The Public tree grants write to INTERACTIVE; the D1-D6 matrix pinned
    // that removing INTERACTIVE from the restricting lists closes the escape.
    // The committed suites never probed it — this pins the ambient boundary
    // end to end with the real restricted token.
    if (publicProbeDir === undefined) {
      ctx.skip() // Public unavailable/unwritable on this host
      return
    }
    /** 中文说明：变量 probe 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const probe = [
      "$ErrorActionPreference='SilentlyContinue';",
      `try{Set-Content -Path '${publicProbeDir}\\public-escaped.txt' -Value ok -ErrorAction Stop;'PUBLIC-WRITE: OK (ESCAPE!)'}catch{'PUBLIC-WRITE: DENIED'}`,
    ].join('')
    /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
    for (const mode of ['read-only', 'workspace-write'] as const) {
      /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const result = runRunner([
        '--workspace', writableDir, '--temp', isolatedTemp, '--mode', mode,
        '--', 'pwsh', '/NoLogo', '/NonInteractive', '/NoProfile', '/Command', probe,
      ])
      expect(result.status, `stderr: ${result.stderr}`).toBe(0)
      expect(result.stdout, `mode: ${mode}`).toContain('PUBLIC-WRITE: DENIED')
      expect(existsSync(join(publicProbeDir, 'public-escaped.txt')), `mode: ${mode}`).toBe(false)
    }
  }, 30_000)

  it('partial boundary: an external Everyone-Modify directory stays writable under BOTH modes', () => {
    // Everyone is a required keep-alive restricting SID: without it early DLL
    // initialization and CNG fail. A normal DACL that grants Everyone Modify
    // therefore also clears the WRITE_RESTRICTED pass-2 check. Pin this
    // unavoidable gap beside the provider's `partial` enforcement report.
    /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
    for (const mode of ['read-only', 'workspace-write'] as const) {
      /** 中文说明：变量 target 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const target = join(worldWritableDir, `${mode}.txt`)
      /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const result = runRunner([
        '--workspace', writableDir, '--temp', isolatedTemp, '--mode', mode,
        '--', process.execPath, '-e', "require('node:fs').writeFileSync(process.argv[1], 'written')", target,
      ])
      expect(result.status, `mode: ${mode}\nstderr: ${result.stderr}`).toBe(0)
      expect(existsSync(target), `mode: ${mode}`).toBe(true)
    }
  }, 30_000)

  it('partial boundary: a workspace hard link lets the grant reach an external file object', () => {
    // NTFS ACLs belong to the file object, not one pathname. Propagating the
    // workspace write-SID ACE through an existing hard-link alias therefore
    // grants the external alias too. pnpm workspaces commonly contain hard
    // links, so rejecting every multiply-linked file is not a viable profile.
    /** 中文说明：变量 hardlinkWorkspace 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const hardlinkWorkspace = join(scratchRoot, 'hardlink-workspace')
    /** 中文说明：变量 hardlinkTemp 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const hardlinkTemp = join(scratchRoot, 'hardlink-temp')
    /** 中文说明：变量 externalFile 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const externalFile = join(scratchRoot, 'hardlink-target.txt')
    /** 中文说明：变量 workspaceLink 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const workspaceLink = join(hardlinkWorkspace, 'hardlink-alias.txt')
    mkdirSync(hardlinkWorkspace)
    mkdirSync(hardlinkTemp)
    writeFileSync(externalFile, 'original')
    linkSync(externalFile, workspaceLink)
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = runRunner([
      // This workspace has not been granted before the alias exists: the first
      // recursive materialization reaches the shared file security descriptor.
      '--workspace', hardlinkWorkspace, '--temp', hardlinkTemp, '--mode', 'workspace-write',
      '--', process.execPath, '-e', "require('node:fs').writeFileSync(process.argv[1], 'mutated')", workspaceLink,
    ])
    expect(result.status, `stderr: ${result.stderr}`).toBe(0)
    expect(readFileSync(externalFile, 'utf8')).toBe('mutated')
  }, 30_000)

  it('runner-side failure: signature on stderr and exit 127, the command never runs', () => {
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = runRunner(['--workspace', writableDir, '--temp', isolatedTemp, '--mode', 'workspace-write'])
    expect(result.status).toBe(127)
    expect(result.stderr).toContain('windows-acl-run: ')
  }, 15_000)

  it('runner-side failure: seam-managed SID flags must be paired and match their owning paths', () => {
    /** 中文说明：变量 writeSid 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const writeSid = workspaceWriteSid(writableDir)
    /** 中文说明：变量 tempSid 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const tempSid = tempWriteSid(isolatedTemp)
    /** 中文说明：变量 cases 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cases = [
      ['--write-sid', writeSid],
      ['--write-sid', 'S-1-4-1-2', '--temp-write-sid', tempSid],
      ['--write-sid', writeSid, '--temp-write-sid', 'S-1-4-1-2-1'],
    ]
    /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
    for (const args of cases) {
      /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const result = runRunner([
        '--workspace', writableDir, '--temp', isolatedTemp, '--mode', 'workspace-write',
        ...args,
        '--', process.execPath, '-e', 'process.exit(99)',
      ])
      expect(result.status, `args: ${args.join(' ')}\nstderr: ${result.stderr}`).toBe(127)
      expect(result.stderr).toContain('windows-acl-run: ')
    }
  }, 15_000)
})
