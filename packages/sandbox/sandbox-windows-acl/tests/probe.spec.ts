/**
 * End-to-end probe of the ACL write-restriction sandbox, using the same
 * probes as the POC verification harness: the confined child must be able to
 * write into the granted target and temp directories, must be DENIED writing
 * anywhere else, and (documented boundary) may still READ outside — the
 * WRITE_RESTRICTED token intersects write accesses only.
 *
 * The escape target sits in its own scratch dir under the system temp
 * directory, OUTSIDE both granted trees: tempDir is an explicit private
 * mkdtemp directory (the API never grants the ambient temp root implicitly),
 * and the writable dir is a separate mkdtemp directory that contains neither
 * sibling. Nothing under the user profile is touched.
 */
/*
 * 文件职责：验证 probe.spec.ts 覆盖的沙箱安全与权限隔离行为与失败场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件上下文和受控系统资源。
 * 产品维度：保障 Agent 使用沙箱安全与权限隔离时得到稳定且可诊断的结果。
 * 逻辑维度：准备配置与资源，触发被测流程，再核对结果、事件、错误和清理。
 * 关键边界：平台能力可能不同；持久化数据和外部输入不可信；异步资源必须完全释放。
 * 新手阅读建议：先读辅助函数和平台条件，再看正常路径，最后阅读恢复与失败用例。
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AclSandbox } from '../src/index.ts'

/** 中文说明：变量 isWin32 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const isWin32 = process.platform === 'win32'

/** 中文说明：函数 pwshAvailable 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function pwshAvailable(): boolean {
  try {
    execFileSync('where.exe', ['pwsh'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

describe.skipIf(!isWin32 || !pwshAvailable())('AclSandbox write restriction', () => {
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
  /** 中文说明：变量 sandbox 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let sandbox: AclSandbox

  beforeAll(async () => {
    scratchRoot = mkdtempSync(join(tmpdir(), 'dsh-acl-sandbox-'))
    writableDir = join(scratchRoot, 'writable')
    mkdirSync(writableDir)
    isolatedTemp = mkdtempSync(join(tmpdir(), 'dsh-acl-sandbox-temp-'))
    secretFile = join(scratchRoot, 'secret.txt')
    writeFileSync(secretFile, 'top secret - must stay readable to prove the read boundary')
    escapeFile = join(scratchRoot, 'escaped.txt')
    // The direct API requires this explicit private temp directory and its
    // own SID; it never widens the grant over the ambient temp root.
    sandbox = new AclSandbox({
      writableDirs: [writableDir],
      tempDir: isolatedTemp,
      writeSid: 'S-1-4-9000-4',
      tempWriteSid: 'S-1-4-9000-4-1',
      mode: 'workspace-write',
    })
    await sandbox.init()
  })

  afterAll(() => {
    sandbox.dispose()
    rmSync(scratchRoot, { recursive: true, force: true })
    rmSync(isolatedTemp, { recursive: true, force: true })
  })

  it('allows writes only in granted directories and denies the escape write', async () => {
    /** 中文说明：变量 probe 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const probe = [
      "$ErrorActionPreference='SilentlyContinue';",
      `try{Set-Content -Path '${writableDir}\\child-wrote.txt' -Value ok -ErrorAction Stop;'TARGET-WRITE: OK'}catch{'TARGET-WRITE: DENIED'};`,
      `try{Set-Content -Path '${isolatedTemp}\\child-wrote.txt' -Value ok -ErrorAction Stop;'TEMP-WRITE: OK'}catch{'TEMP-WRITE: DENIED'};`,
      `try{Set-Content -Path '${escapeFile}' -Value ok -ErrorAction Stop;'ESCAPE-WRITE: OK (ESCAPE!)'}catch{'ESCAPE-WRITE: DENIED'};`,
      `try{Get-Content '${secretFile}' -ErrorAction Stop | Out-Null;'SECRET-READ: OK'}catch{'SECRET-READ: DENIED'}`,
    ].join('')
    /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const child = sandbox.spawn({
      command: 'pwsh',
      args: ['/NoLogo', '/NonInteractive', '/NoProfile', '/Command', probe],
      cwd: writableDir,
    })
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await child.wait()
    /** 中文说明：变量 output 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const output = result.stdout.toString('utf8') + result.stderr.toString('utf8')

    expect(result.exitCode, `child output:\n${output}`).toBe(0)
    expect(output, `child output:\n${output}`).toContain('TARGET-WRITE: OK')
    expect(output, `child output:\n${output}`).toContain('TEMP-WRITE: OK')
    expect(output, `child output:\n${output}`).toContain('ESCAPE-WRITE: DENIED')
    // Documented boundary: WRITE_RESTRICTED intersects write accesses only,
    // so reads outside the allowlist still succeed.
    expect(output, `child output:\n${output}`).toContain('SECRET-READ: OK')
    expect(existsSync(escapeFile)).toBe(false)
    expect(existsSync(join(writableDir, 'child-wrote.txt'))).toBe(true)
  }, 30_000)

  it('fails closed when the write SID cannot be parsed (no unrestricted fallback)', async () => {
    // A malformed SID makes ConvertStringSidToSidW fail; init must throw
    // before any grant is applied and never spawn unrestricted.
    /** 中文说明：变量 broken 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const broken = new AclSandbox({ writableDirs: [writableDir], tempDir: null, writeSid: 'S-1-4-abc-1', mode: 'workspace-write' })
    await expect(broken.init()).rejects.toThrow(/ConvertStringSidToSidW/u)
  }, 15_000)

  it('failed init clears provisional temp state before a retry', async () => {
    /** 中文说明：变量 broken 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const broken = new AclSandbox({ writableDirs: [writableDir], tempDir: null, writeSid: 'S-1-4-abc-1', mode: 'workspace-write' })
    /** 中文说明：变量 provisionalState 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const provisionalState = broken as unknown as { tempDirResolved: string | undefined }
    provisionalState.tempDirResolved = isolatedTemp

    await expect(broken.init()).rejects.toThrow(/ConvertStringSidToSidW/u)
    expect(broken.tempDir).toBeUndefined()
  }, 15_000)
})
