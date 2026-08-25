/**
 * ACL edit tests: the read-merge-write grant keeps pre-existing explicit
 * ACEs, interleaved sandbox instances do not clobber each other, the
 * per-path lock primitive is deterministic, and the grant mask carries
 * DELETE + FILE_DELETE_CHILD (never WRITE_DAC/WRITE_OWNER).
 *
 * All state lives in %TEMP% mkdtemp scratch directories; the only exception
 * is the mandated lock infrastructure under <GetTempPathW()>\dsh-acl-locks,
 * whose per-test lock file is removed in cleanup.
 */
/**
 * 文件职责：验证 acl.spec.ts 覆盖的沙箱安全与权限隔离行为与失败场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件上下文和受控系统资源。
 * 产品维度：保障 Agent 使用沙箱安全与权限隔离时得到稳定且可诊断的结果。
 * 逻辑维度：准备配置与资源，触发被测流程，再核对结果、事件、错误和清理。
 * 关键边界：平台能力可能不同；持久化数据和外部输入不可信；异步资源必须完全释放。
 * 新手阅读建议：先读辅助函数和平台条件，再看正常路径，最后阅读恢复与失败用例。
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import koffi from 'koffi'

import { buildExplicitAccess, grantWrite, lockFilePath, revokeWrite, withPathLock } from '../src/acl.ts'
import { AclSandbox } from '../src/index.ts'
import { createRestrictedToken } from '../src/token.ts'
import { allocOverlapped, allocPtrSlot, decodePtr, isInvalidHandle, isNullPtr, win32 } from '../src/ffi.ts'
import type { NativePtr, Win32Bindings } from '../src/ffi.ts'
import * as abi from '../src/win32-abi.ts'

/** 中文说明：变量 isWin32 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const isWin32 = process.platform === 'win32'

/** FILE_READ_DATA (winnt.h line ~5895): the harmless mask the explicit test ACE grants. */
/** 中文说明：常量 FILE_READ_DATA 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const FILE_READ_DATA = 0x0001

/** koffi SID layout: revision@0, subAuthorityCount@1, identifierAuthority@2 (6 bytes, big-endian), subAuthority@8. */
/** 中文说明：常量 SID_STRUCT 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const SID_STRUCT = koffi.struct('DSH_ACL_SPEC_SID', {
  revision: 'uint8',
  subAuthorityCount: 'uint8',
  identifierAuthority: 'uint8[6]',
  subAuthority: 'uint32[8]',
})

/** 中文说明：interface SidLayout 定义本测试所需的数据或行为，用于表达沙箱安全与权限隔离场景。 */
interface SidLayout {
  revision: number
  subAuthorityCount: number
  identifierAuthority: number[]
  subAuthority: number[]
}

/** One direct (explicit, non-inherited) allow ACE of a directory DACL. */
/** 中文说明：interface DirectAce 定义本测试所需的数据或行为，用于表达沙箱安全与权限隔离场景。 */
interface DirectAce {
  sid: string
  mask: number
}

/** Convert one SID string to a LocalAlloc'd SID pointer (caller frees). */
/** 中文说明：函数 sidFromString 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function sidFromString(api: Win32Bindings, sid: string): NativePtr {
  /** 中文说明：变量 slot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const slot = allocPtrSlot()
  if (api.convertStringSidToSidW(sid, slot) === 0) throw new Error(`ConvertStringSidToSidW failed for ${sid}`)
  /** 中文说明：变量 ptr 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ptr = decodePtr(slot)
  if (ptr === null) throw new Error(`ConvertStringSidToSidW returned null for ${sid}`)
  return ptr
}

/** Stringify a decoded SID layout (identifierAuthority bytes 2..5 are the big-endian value). */
/** 中文说明：函数 sidString 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function sidString(sid: SidLayout): string {
  /** 中文说明：变量 authority 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const authority = ((sid.identifierAuthority[2] ?? 0) << 24)
    | ((sid.identifierAuthority[3] ?? 0) << 16)
    | ((sid.identifierAuthority[4] ?? 0) << 8)
    | (sid.identifierAuthority[5] ?? 0)
  /** 中文说明：变量 subs 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const subs = sid.subAuthority.slice(0, sid.subAuthorityCount).join('-')
  return `S-${sid.revision}-${authority}${sid.subAuthorityCount > 0 ? `-${subs}` : ''}`
}

/**
 * Read the directory's explicit allow ACEs (inherited ACEs excluded): each
 * ACE header is AceType@0, AceFlags@1, AceSize@2 (winnt.h lines ~3477-3480);
 * ACCESS_ALLOWED_ACE stores Mask@4 and the inline SID@8. The ACL pointer sits
 * inside the descriptor allocation — only the descriptor is LocalFree'd.
 */
/** 中文说明：函数 readDirectAces 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function readDirectAces(api: Win32Bindings, path: string): DirectAce[] {
  /** 中文说明：变量 ownerSlot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ownerSlot = allocPtrSlot()
  /** 中文说明：变量 groupSlot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const groupSlot = allocPtrSlot()
  /** 中文说明：变量 daclSlot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const daclSlot = allocPtrSlot()
  /** 中文说明：变量 saclSlot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const saclSlot = allocPtrSlot()
  /** 中文说明：变量 descriptorSlot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const descriptorSlot = allocPtrSlot()
  /** 中文说明：变量 readResult 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const readResult = api.getNamedSecurityInfoW(
    path, abi.SE_FILE_OBJECT, abi.DACL_SECURITY_INFORMATION,
    ownerSlot, groupSlot, daclSlot, saclSlot, descriptorSlot,
  )
  if (readResult !== abi.ERROR_SUCCESS) throw new Error(`GetNamedSecurityInfoW failed (${readResult}) for ${path}`)
  /** 中文说明：变量 acl 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const acl = decodePtr(daclSlot)
  /** 中文说明：变量 descriptor 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const descriptor = decodePtr(descriptorSlot)
  try {
    if (acl === null) return []
    /** 中文说明：变量 aclSize 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const aclSize = koffi.decode(acl, 2, 'uint16') as number
    /** 中文说明：变量 aces 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const aces: DirectAce[] = []
    /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
    for (let offset = 8; offset + 8 <= aclSize;) {
      /** 中文说明：变量 flags 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const flags = koffi.decode(acl, offset + 1, 'uint8') as number
      /** 中文说明：变量 aceSize 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const aceSize = koffi.decode(acl, offset + 2, 'uint16') as number
      if ((flags & abi.INHERITED_ACE) === 0) {
        aces.push({ sid: sidString(koffi.decode(acl, offset + 8, SID_STRUCT) as SidLayout), mask: koffi.decode(acl, offset + 4, 'uint32') as number })
      }
      offset += aceSize
    }
    return aces
  } finally {
    if (descriptor !== null) api.localFree(descriptor)
  }
}

describe.skipIf(!isWin32)('ACL editing', () => {
  /** 中文说明：变量 scratchDirs 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const scratchDirs: string[] = []
  afterEach(() => {
    /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
    for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  /** 中文说明：函数 scratch 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
  function scratch(): string {
    /** 中文说明：变量 dir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dir = mkdtempSync(join(tmpdir(), 'dsh-acl-edit-'))
    scratchDirs.push(dir)
    return dir
  }

  it('grantWrite merges into the current DACL: an explicit Users ACE survives grant+revoke', async () => {
    /** 中文说明：变量 api 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const api = await win32()
    /** 中文说明：变量 dir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dir = scratch()
    /** 中文说明：变量 usersSid 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const usersSid = sidFromString(api, 'S-1-5-32-545')
    /** 中文说明：变量 capabilitySid 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const capabilitySid = sidFromString(api, 'S-1-4-4242-1')
    try {
      // Install one explicit ACE (Users + benign read mask) with the
      // package's own bindings, exactly like a pre-existing explicit DACL
      // entry another sandbox instance or administrator added.
      /** 中文说明：变量 newAclSlot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const newAclSlot = allocPtrSlot()
      /** 中文说明：变量 mergeResult 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const mergeResult = api.setEntriesInAclW(1, buildExplicitAccess(usersSid, abi.GRANT_ACCESS, FILE_READ_DATA), null, newAclSlot)
      expect(mergeResult, `SetEntriesInAclW setup (${mergeResult})`).toBe(abi.ERROR_SUCCESS)
      /** 中文说明：变量 newAcl 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const newAcl = decodePtr(newAclSlot)
      expect(newAcl).not.toBeNull()
      /** 中文说明：变量 applyResult 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const applyResult = api.setNamedSecurityInfoW(
        dir, abi.SE_FILE_OBJECT, abi.DACL_SECURITY_INFORMATION, null, null, newAcl, null,
      )
      /** 中文说明：变量 freed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const freed = newAcl === null ? null : api.localFree(newAcl)
      expect(applyResult, `SetNamedSecurityInfoW setup (${applyResult})`).toBe(abi.ERROR_SUCCESS)
      expect(isNullPtr(freed)).toBe(true)

      grantWrite(api, dir, capabilitySid)
      revokeWrite(api, dir, capabilitySid)

      /** 中文说明：变量 aces 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const aces = readDirectAces(api, dir)
      expect(aces.some(ace => ace.sid === 'S-1-5-32-545')).toBe(true) // explicit ACE preserved
      expect(aces.some(ace => ace.sid === 'S-1-4-4242-1')).toBe(false) // orphan grant fully removed
    } finally {
      if (!isNullPtr(usersSid)) api.localFree(usersSid)
      if (!isNullPtr(capabilitySid)) api.localFree(capabilitySid)
    }
  })

  it('grantWrite is idempotent: a second grant over the standing exact ACE skips the SetNamedSecurityInfoW apply (no eager full-tree re-propagation)', async () => {
    /** 中文说明：变量 api 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const api = await win32()
    /** 中文说明：变量 dir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dir = scratch()
    /** 中文说明：变量 capabilitySid 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const capabilitySid = sidFromString(api, 'S-1-4-4242-2')
    /** 中文说明：变量 apply 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const apply = vi.spyOn(api, 'setNamedSecurityInfoW')
    try {
      grantWrite(api, dir, capabilitySid)
      expect(apply).toHaveBeenCalledTimes(1)
      // The exact ACE now stands (the per-session grant surviving from a
      // previous server lifetime): the second grant is a DACL read only.
      grantWrite(api, dir, capabilitySid)
      expect(apply).toHaveBeenCalledTimes(1)
      /** 中文说明：变量 aces 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const aces = readDirectAces(api, dir)
      expect(aces.filter(ace => ace.sid === 'S-1-4-4242-2')).toHaveLength(1)
      revokeWrite(api, dir, capabilitySid)
      expect(readDirectAces(api, dir).some(ace => ace.sid === 'S-1-4-4242-2')).toBe(false)
    } finally {
      apply.mockRestore()
      if (!isNullPtr(capabilitySid)) api.localFree(capabilitySid)
    }
  })

  it('interleaved sandbox instances: A.init → B.init → A.dispose → B.dispose leaves BOTH standing workspace ACEs (the per-workspace reuse cache)', async () => {
    /** 中文说明：变量 api 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const api = await win32()
    /** 中文说明：变量 dir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dir = scratch()
    /** 中文说明：变量 sandboxA 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sandboxA = new AclSandbox({ writableDirs: [dir], tempDir: null, writeSid: 'S-1-4-9000-1', mode: 'workspace-write' })
    /** 中文说明：变量 sandboxB 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sandboxB = new AclSandbox({ writableDirs: [dir], tempDir: null, writeSid: 'S-1-4-9000-2', mode: 'workspace-write' })
    await sandboxA.init()
    await sandboxB.init()
    // Workspace ACEs are STANDING: dispose frees the instance's SID
    // allocations but deliberately leaves the ACEs — they are the reuse
    // cache the next provision's exact-ACE skip consumes.
    sandboxA.dispose()
    sandboxB.dispose()
    /** 中文说明：变量 aces 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const aces = readDirectAces(api, dir)
    expect(aces.some(ace => ace.sid === 'S-1-4-9000-1')).toBe(true)
    expect(aces.some(ace => ace.sid === 'S-1-4-9000-2')).toBe(true)
  })

  it('dispose revokes the revocable temp ACE and keeps the standing workspace ACE (self-managed flow)', async () => {
    /** 中文说明：变量 api 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const api = await win32()
    /** 中文说明：变量 workspaceDir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const workspaceDir = scratch()
    /** 中文说明：变量 tempDir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const tempDir = scratch()
    /** 中文说明：变量 sandbox 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sandbox = new AclSandbox({
      writableDirs: [workspaceDir],
      tempDir,
      writeSid: 'S-1-4-9000-3',
      tempWriteSid: 'S-1-4-9000-3-1',
      mode: 'workspace-write',
    })
    await sandbox.init()
    sandbox.dispose()
    /** 中文说明：变量 workspaceAces 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const workspaceAces = readDirectAces(api, workspaceDir)
    expect(workspaceAces.some(ace => ace.sid === 'S-1-4-9000-3')).toBe(true)
    /** 中文说明：变量 tempAces 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const tempAces = readDirectAces(api, tempDir)
    expect(tempAces.some(ace => ace.sid === 'S-1-4-9000-3-1')).toBe(false)
  })

  it('rejects an overlapping private temp directory before applying either capability', async () => {
    /** 中文说明：变量 workspaceDir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const workspaceDir = scratch()
    /** 中文说明：变量 nestedTemp 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const nestedTemp = join(workspaceDir, 'temp')
    /** 中文说明：变量 writeSid 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const writeSid = 'S-1-4-9000-30'
    /** 中文说明：变量 privateTempSid 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const privateTempSid = 'S-1-4-9000-30-1'
    mkdirSync(nestedTemp)
    /** 中文说明：变量 sandbox 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sandbox = new AclSandbox({
      writableDirs: [workspaceDir],
      tempDir: nestedTemp,
      writeSid,
      tempWriteSid: privateTempSid,
      mode: 'workspace-write',
    })

    await expect(sandbox.init()).rejects.toThrow(/private temp directory must be disjoint/u)
    /** 中文说明：变量 api 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const api = await win32()
    expect(readDirectAces(api, workspaceDir).some(ace => ace.sid === writeSid)).toBe(false)
    expect(readDirectAces(api, nestedTemp).some(ace => ace.sid === privateTempSid)).toBe(false)
  })

  it('workspace-write without a write SID fails at construction; the token layer guards the same contract', () => {
    /** 中文说明：变量 dir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dir = scratch()
    expect(() => new AclSandbox({ writableDirs: [dir], tempDir: null, mode: 'workspace-write' }))
      .toThrow(/requires a write SID/)
    expect(() => new AclSandbox({ writableDirs: [dir], writeSid: 'S-1-4-1-1', mode: 'workspace-write' }))
      .toThrow(/requires an explicit private temp directory or null/)
    expect(() => new AclSandbox({ writableDirs: [dir], tempDir: dir, writeSid: 'S-1-4-1-1', mode: 'workspace-write' }))
      .toThrow(/requires a temp write SID/)
    expect(() => new AclSandbox({
      writableDirs: [dir],
      tempDir: dir,
      writeSid: 'S-1-4-1-1',
      tempWriteSid: 'S-1-4-1-1',
      mode: 'workspace-write',
    })).toThrow(/must be distinct/)
    expect(() => createRestrictedToken({} as never, 0n as never, 0n as never, [], { world: 0n as never }, 'workspace-write'))
      .toThrow(/requires at least one write SID/)
  })

  it('the per-path lock is exclusive: a second immediate lock attempt fails with ERROR_LOCK_VIOLATION until release', async () => {
    /** 中文说明：变量 api 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const api = await win32()
    /** 中文说明：变量 dir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dir = scratch()
    /** 中文说明：变量 lockPath 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const lockPath = lockFilePath(api, dir)
    /** 中文说明：函数值 open 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const open = (): NativePtr => api.createFileW(
      lockPath, abi.GENERIC_READ | abi.GENERIC_WRITE,
      abi.FILE_SHARE_READ | abi.FILE_SHARE_WRITE, null, abi.OPEN_ALWAYS, 0, null,
    )
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = open()
    /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const second = open()
    expect(isInvalidHandle(first)).toBe(false)
    expect(isInvalidHandle(second)).toBe(false)
    try {
      expect(api.lockFileEx(first, abi.LOCKFILE_EXCLUSIVE_LOCK, 0, 1, 0, allocOverlapped())).toBe(1)
      expect(api.lockFileEx(second, abi.LOCKFILE_EXCLUSIVE_LOCK | abi.LOCKFILE_FAIL_IMMEDIATELY, 0, 1, 0, allocOverlapped())).toBe(0)
      expect(api.getLastError()).toBe(abi.ERROR_LOCK_VIOLATION)
      expect(api.unlockFileEx(first, 0, 1, 0, allocOverlapped())).toBe(1)
      expect(api.lockFileEx(second, abi.LOCKFILE_EXCLUSIVE_LOCK | abi.LOCKFILE_FAIL_IMMEDIATELY, 0, 1, 0, allocOverlapped())).toBe(1)
      expect(api.unlockFileEx(second, 0, 1, 0, allocOverlapped())).toBe(1)
    } finally {
      api.closeHandle(first)
      api.closeHandle(second)
      rmSync(lockPath, { force: true })
    }
  })

  it('withPathLock serializes the action and releases the lock even when the action throws', async () => {
    /** 中文说明：变量 api 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const api = await win32()
    /** 中文说明：变量 dir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dir = scratch()
    /** 中文说明：变量 lockPath 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const lockPath = lockFilePath(api, dir)
    /** 中文说明：变量 attempts 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let attempts = 0
    expect(() => withPathLock(api, dir, () => {
      attempts++
      throw new Error('action failure')
    })).toThrow('action failure')
    expect(attempts).toBe(1)
    // The lock was released: a fresh immediate lock succeeds.
    /** 中文说明：变量 handle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const handle = api.createFileW(
      lockPath, abi.GENERIC_READ | abi.GENERIC_WRITE,
      abi.FILE_SHARE_READ | abi.FILE_SHARE_WRITE, null, abi.OPEN_ALWAYS, 0, null,
    )
    expect(isInvalidHandle(handle)).toBe(false)
    try {
      expect(api.lockFileEx(handle, abi.LOCKFILE_EXCLUSIVE_LOCK | abi.LOCKFILE_FAIL_IMMEDIATELY, 0, 1, 0, allocOverlapped())).toBe(1)
      expect(api.unlockFileEx(handle, 0, 1, 0, allocOverlapped())).toBe(1)
    } finally {
      api.closeHandle(handle)
      rmSync(lockPath, { force: true })
    }
  })

  it('the applied grant mask carries DELETE and FILE_DELETE_CHILD (never WRITE_DAC/WRITE_OWNER)', async () => {
    /** 中文说明：变量 api 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const api = await win32()
    /** 中文说明：变量 dir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dir = scratch()
    /** 中文说明：变量 sandbox 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sandbox = new AclSandbox({ writableDirs: [dir], tempDir: null, writeSid: 'S-1-4-1234-5', mode: 'workspace-write' })
    try {
      await sandbox.init()
      /** 中文说明：函数值 grant 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
      const grant = readDirectAces(api, dir).find(ace => ace.sid === 'S-1-4-1234-5')
      expect(grant).toBeDefined()
      /** 中文说明：变量 mask 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const mask = grant?.mask ?? 0
      expect(mask).toBe(abi.GRANT_MASK)
      expect(mask & abi.DELETE).toBe(abi.DELETE)
      expect(mask & abi.FILE_DELETE_CHILD).toBe(abi.FILE_DELETE_CHILD)
      expect(mask & 0x00040000).toBe(0) // WRITE_DAC must never be granted
      expect(mask & 0x00080000).toBe(0) // WRITE_OWNER must never be granted
    } finally {
      sandbox.dispose()
    }
  })
})
