/**
 * AclWriteGrant tests: the server-side grant materialization — SID parsing
 * fail-closed, ACE add/dispose round-trip against the REAL directory DACL
 * (observed through icacls, the operator's own tool), the recorded path
 * order, and the standing/revocable lifecycle split (workspace ACEs outlive
 * dispose as the reuse cache; temp ACEs revoke). Win32-only, like the other
 * real-FFI suites.
 */
/*
 * 文件职责：验证 grant.spec.ts 覆盖的沙箱安全与权限隔离行为与失败场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件上下文和受控系统资源。
 * 产品维度：保障 Agent 使用沙箱安全与权限隔离时得到稳定且可诊断的结果。
 * 逻辑维度：准备配置与资源，触发被测流程，再核对结果、事件、错误和清理。
 * 关键边界：平台能力可能不同；持久化数据和外部输入不可信；异步资源必须完全释放。
 * 新手阅读建议：先读辅助函数和平台条件，再看正常路径，最后阅读恢复与失败用例。
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { AclWriteGrant } from '../src/index.ts'

/** 中文说明：变量 isWin32 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const isWin32 = process.platform === 'win32'

/** The directory DACL as icacls renders it (the operator-visible form). */
/* 中文说明：函数 icaclsText 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function icaclsText(path: string): string {
  /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const result = spawnSync('icacls', [path], { encoding: 'utf8' })
  expect(result.status, `icacls failed: ${result.stderr}`).toBe(0)
  return result.stdout
}

describe.skipIf(!isWin32)('AclWriteGrant (server-side materialization)', () => {
  /** 中文说明：变量 scratchDirs 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const scratchDirs: string[] = []
  afterEach(() => {
    /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
    for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  /** 中文说明：函数 scratch 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
  function scratch(): string {
    /** 中文说明：变量 dir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dir = mkdtempSync(join(tmpdir(), 'dsh-acl-grant-'))
    scratchDirs.push(dir)
    return dir
  }

  it('create parses the SID fail-closed: a malformed SID throws before anything is granted', () => {
    expect(() => AclWriteGrant.create('S-1-4-abc-1')).toThrow(/ConvertStringSidToSidW/u)
  })

  it('add materializes the ACE (idempotently) and reports grant order; dispose revokes revocable paths and keeps standing paths standing', () => {
    /** 中文说明：变量 dir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dir = scratch()
    /** 中文说明：变量 standingDir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const standingDir = scratch()
    /** 中文说明：变量 grant 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const grant = AclWriteGrant.create('S-1-4-9000-77')
    grant.add(dir) // revocable: the session-temp lifecycle
    grant.add(standingDir, true) // standing: the workspace reuse cache
    expect(grant.paths).toEqual([standingDir, dir])
    expect(icaclsText(dir)).toContain('S-1-4-9000-77')
    expect(icaclsText(standingDir)).toContain('S-1-4-9000-77')
    // A second add over the standing exact ACE is a DACL-read no-op: the
    // grant stays exactly one ACE (the reuse across sessions/restarts).
    grant.add(dir)
    grant.add(standingDir, true)
    expect(icaclsText(dir)).toContain('S-1-4-9000-77')
    expect(icaclsText(standingDir)).toContain('S-1-4-9000-77')
    grant.dispose()
    expect(icaclsText(dir)).not.toContain('S-1-4-9000-77')
    expect(icaclsText(standingDir)).toContain('S-1-4-9000-77')
  })

  it('two grants with different SIDs coexist and revoke independently', () => {
    /** 中文说明：变量 dir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dir = scratch()
    /** 中文说明：变量 grantA 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const grantA = AclWriteGrant.create('S-1-4-9000-78')
    /** 中文说明：变量 grantB 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const grantB = AclWriteGrant.create('S-1-4-9000-79')
    grantA.add(dir)
    grantB.add(dir)
    expect(icaclsText(dir)).toContain('S-1-4-9000-78')
    expect(icaclsText(dir)).toContain('S-1-4-9000-79')
    grantA.dispose()
    expect(icaclsText(dir)).not.toContain('S-1-4-9000-78')
    expect(icaclsText(dir)).toContain('S-1-4-9000-79')
    grantB.dispose()
    expect(icaclsText(dir)).not.toContain('S-1-4-9000-79')
  })
})
