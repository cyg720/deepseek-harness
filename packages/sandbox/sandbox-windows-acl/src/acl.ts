/**
 * ACL editing helpers: grant/revoke a capability SID on a directory via
 * SetEntriesInAclW + SetNamedSecurityInfoW (the same calls the POC uses, with
 * the failure handling the POC lacks). Every API call is checked and every
 * failure is reported with the API name, the exact Win32 code, the formatted
 * system text, and the affected path.
 *
 * Concurrency: grants are read-merge-write against the directory's CURRENT
 * DACL, and the whole get-merge-set sequence runs under a per-path exclusive
 * LockFileEx lock (see {@link withPathLock}) so concurrent sandbox instances
 * cannot clobber each other's ACEs.
 * @module @deepseek-ai/dsh-sandbox-windows-acl/acl
 */
/**
 * 文件职责：实现 acl.ts 承担的沙箱策略或 Windows ACL 隔离职责。
 * 技术维度：使用 TypeScript、Windows 原生接口、访问控制列表和进程生命周期管理。
 * 产品维度：限制 Agent 子进程可访问的系统资源，降低误操作和凭据泄露风险。
 * 逻辑维度：解析策略，构造权限或原生调用，启动受限进程，并等待退出后清理。
 * 关键边界：原生句柄和权限失败必须显式处理；环境变量需净化；清理必须达到静止状态。
 * 新手阅读建议：先看公开配置和 Win32 类型，再读权限授予与启动，最后关注错误和清理。
 */

import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { allocOverlapped, allocPtrSlot, decodePtr, decodeUint8At, decodeUint16At, decodeUint32At, getTempPath, isInvalidHandle, isNullPtr, ptrAddress, sameSidAt, throwLastError, throwWin32 } from './ffi.ts'
import type { NativePtr, Win32Bindings } from './ffi.ts'
import * as abi from './win32-abi.ts'

/**
 * Pack one EXPLICIT_ACCESS_W (48 bytes, layout verified by abi-probe.cpp):
 * perms@0, mode@4, inheritance@8, Trustee@16 { pMultipleTrustee@16,
 * MultipleTrusteeOperation@24, TrusteeForm@28, TrusteeType@32, ptstrName@40 }.
 * `permissions` is the access mask; the POC passes 0 for REVOKE_ACCESS, which
 * removes every ACE for the trustee.
 * @param sidPtr - the trustee SID the entry names.
 * @param mode - the access mode (GRANT_ACCESS or REVOKE_ACCESS).
 * @param permissions - the access mask to grant (0 for REVOKE_ACCESS).
 * @returns the packed entry buffer.
 */
/** 中文说明：函数 buildExplicitAccess 承担本模块的安全处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export function buildExplicitAccess(sidPtr: NativePtr, mode: number, permissions: number): Buffer {
  /** 中文说明：变量 entry 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const entry = Buffer.alloc(abi.EXPLICIT_ACCESS_W_SIZE)
  entry.writeUInt32LE(permissions, 0) // grfAccessPermissions
  entry.writeUInt32LE(mode, 4) // grfAccessMode
  entry.writeUInt32LE(abi.SUB_CONTAINERS_AND_OBJECTS_INHERIT, 8) // grfInheritance: OI|CI
  entry.writeUInt32LE(abi.NO_MULTIPLE_TRUSTEE, 24) // Trustee.MultipleTrusteeOperation
  entry.writeUInt32LE(abi.TRUSTEE_IS_SID, 28) // Trustee.TrusteeForm
  entry.writeUInt32LE(abi.TRUSTEE_IS_UNKNOWN, 32) // Trustee.TrusteeType
  entry.writeBigUInt64LE(ptrAddress(sidPtr), 40) // Trustee.ptstrName = the capability SID
  return entry
}

/**
 * One lock file per protected path: `<GetTempPathW()>\dsh-acl-locks\<first 16
 * hex of sha256(lowercased path)>.lock`. The lock root derives from
 * GetTempPathW (never from runner argv or DSH_HOME), and the lowercasing
 * maps Windows's case-insensitive path spellings onto one lock.
 * @param api - the binding table.
 * @param path - the protected directory (absolute).
 * @returns the lock file path for that directory.
 */
/** 中文说明：函数 lockFilePath 承担本模块的安全处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export function lockFilePath(api: Win32Bindings, path: string): string {
  /** 中文说明：变量 digest 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const digest = createHash('sha256').update(path.toLowerCase()).digest('hex').slice(0, 16)
  return join(getTempPath(api), 'dsh-acl-locks', `${digest}.lock`)
}

/**
 * Run `action` holding the per-path exclusive lock: CreateFileW
 * (OPEN_ALWAYS, shared read/write but NOT delete — a deletable lock file
 * could be removed and recreated under the holder, letting two processes
 * hold "the same" lock), then a one-byte LockFileEx
 * (LOCKFILE_EXCLUSIVE_LOCK, zeroed OVERLAPPED = lock from offset 0 on the
 * synchronous handle — see allocOverlapped for why not NULL), then
 * UnlockFileEx + CloseHandle. Fail-closed: open/lock/unlock/close failures
 * throw like every other Win32 call in this package; an `action` failure
 * still unlocks (best-effort) and rethrows the original error.
 * @param api - the binding table.
 * @param path - the protected directory (absolute).
 * @param action - the get-merge-set sequence to serialize.
 * @returns the action's result.
 */
/** 中文说明：函数 withPathLock 承担本模块的安全处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export function withPathLock<T>(api: Win32Bindings, path: string, action: () => T): T {
  /** 中文说明：变量 lockPath 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const lockPath = lockFilePath(api, path)
  mkdirSync(dirname(lockPath), { recursive: true })
  /** 中文说明：变量 handle 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const handle = api.createFileW(
    lockPath,
    abi.GENERIC_READ | abi.GENERIC_WRITE,
    abi.FILE_SHARE_READ | abi.FILE_SHARE_WRITE,
    null, abi.OPEN_ALWAYS, 0, null,
  )
  if (isInvalidHandle(handle)) throwLastError(api, 'CreateFileW', lockPath)
  /** 中文说明：变量 overlapped 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const overlapped = allocOverlapped() // stays zeroed: offset 0, hEvent NULL
  if (api.lockFileEx(handle, abi.LOCKFILE_EXCLUSIVE_LOCK, 0, 1, 0, overlapped) === 0) {
    /** 中文说明：变量 win32Code 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const win32Code = api.getLastError()
    api.closeHandle(handle) // best-effort on the lock-failure path
    throwWin32(api, 'LockFileEx', win32Code, lockPath)
  }

  /** 中文说明：变量 result 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let result: T
  try {
    result = action()
  } catch (error) {
    // Best-effort release on the action-failure path: cleanup failures must
    // not mask the action's error.
    api.unlockFileEx(handle, 0, 1, 0, overlapped)
    api.closeHandle(handle)
    throw error
  }
  if (api.unlockFileEx(handle, 0, 1, 0, overlapped) === 0) {
    /** 中文说明：变量 win32Code 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const win32Code = api.getLastError()
    api.closeHandle(handle) // best-effort on the unlock-failure path
    throwWin32(api, 'UnlockFileEx', win32Code, lockPath)
  }
  if (api.closeHandle(handle) === 0) throwLastError(api, 'CloseHandle', `lock file ${lockPath}`)
  return result
}

/**
 * Read the directory's current explicit DACL via GetNamedSecurityInfoW.
 * Allocation contract (the POC's RevokeAccess, minus its missing checks): the
 * returned ACL pointer sits INSIDE the security descriptor allocation — only
 * the descriptor may be LocalFree'd, and it must not be freed before
 * SetEntriesInAclW has consumed the ACL. Freeing the ACL pointer itself
 * corrupts the heap (verified the hard way).
 * @param api - the binding table.
 * @param path - the directory whose DACL is read.
 * @returns the current explicit DACL (null when the directory carries none) and its owning descriptor.
 */
/** 中文说明：函数 readCurrentDacl 承担本模块的安全处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function readCurrentDacl(api: Win32Bindings, path: string): { oldAcl: NativePtr | null; descriptor: NativePtr | null } {
  /** 中文说明：变量 ownerSlot 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ownerSlot = allocPtrSlot()
  /** 中文说明：变量 groupSlot 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const groupSlot = allocPtrSlot()
  /** 中文说明：变量 daclSlot 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const daclSlot = allocPtrSlot()
  /** 中文说明：变量 saclSlot 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const saclSlot = allocPtrSlot()
  /** 中文说明：变量 descriptorSlot 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const descriptorSlot = allocPtrSlot()
  /** 中文说明：变量 readResult 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const readResult = api.getNamedSecurityInfoW(
    path, abi.SE_FILE_OBJECT, abi.DACL_SECURITY_INFORMATION,
    ownerSlot, groupSlot, daclSlot, saclSlot, descriptorSlot,
  )
  if (readResult !== abi.ERROR_SUCCESS) throwWin32(api, 'GetNamedSecurityInfoW', readResult, path)
  return { oldAcl: decodePtr(daclSlot), descriptor: decodePtr(descriptorSlot) }
}

/**
 * Shared tail of grantWrite and revokeWrite: merge `entry` into `oldAcl`
 * (null = no explicit DACL yet; SetEntriesInAclW builds one from scratch),
 * free the descriptor before applying the merged ACL, apply it, then free the
 * merged ACL — checking every call and reporting with the caller's label.
 * @param api - the binding table.
 * @param path - the directory the DACL edit applies to.
 * @param entry - the EXPLICIT_ACCESS_W to merge (grant or revoke).
 * @param oldAcl - the current explicit DACL (from {@link readCurrentDacl}).
 * @param descriptor - the descriptor allocation owning `oldAcl`.
 * @param label - the caller's name for error details.
 */
/** 中文说明：函数 mergeAndApply 承担本模块的安全处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function mergeAndApply(
  api: Win32Bindings,
  path: string,
  entry: Buffer,
  oldAcl: NativePtr | null,
  descriptor: NativePtr | null,
  label: string,
): void {
  /** 中文说明：变量 newAclSlot 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const newAclSlot = allocPtrSlot()
  /** 中文说明：变量 mergeResult 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const mergeResult = api.setEntriesInAclW(1, entry, oldAcl, newAclSlot)
  if (mergeResult !== abi.ERROR_SUCCESS) {
    if (descriptor !== null) api.localFree(descriptor) // frees the ACL block too
    throwWin32(api, 'SetEntriesInAclW', mergeResult, `${label}(${path})`)
  }
  /** 中文说明：变量 newAcl 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const newAcl = decodePtr(newAclSlot)
  if (newAcl === null) {
    if (descriptor !== null) api.localFree(descriptor)
    throwWin32(api, 'SetEntriesInAclW', api.getLastError(), `${label}(${path}): null new ACL`)
  }

  // The descriptor block (oldAcl included) is dead after the merge — free it
  // before applying, exactly like the POC.
  /** 中文说明：变量 freedDescriptor 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const freedDescriptor = descriptor !== null ? api.localFree(descriptor) : null
  /** 中文说明：变量 applyResult 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const applyResult = api.setNamedSecurityInfoW(
    path, abi.SE_FILE_OBJECT, abi.DACL_SECURITY_INFORMATION,
    null, null, newAcl, null,
  )
  /** 中文说明：变量 freedNew 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const freedNew = api.localFree(newAcl)
  if (applyResult !== abi.ERROR_SUCCESS) throwWin32(api, 'SetNamedSecurityInfoW', applyResult, `${label}(${path})`)
  if (freedDescriptor !== null && !isNullPtr(freedDescriptor)) throwLastError(api, 'LocalFree', `${label}(${path}) descriptor`)
  if (!isNullPtr(freedNew)) throwLastError(api, 'LocalFree', `${label}(${path}) new ACL`)
}

/**
 * True when the explicit DACL already carries the EXACT write grant this
 * module would add (Allow ACE, OI|CI inheritance, {@link abi.GRANT_MASK}, the
 * capability SID). Every field is read through koffi.decode at pointer offsets —
 * no memcpy, no pointer arithmetic. The ACE's SID is INLINE (embedded in the
 * ACE after the 4-byte mask — there is no pointer to read; reading one
 * yields garbage addresses and crashed EqualSid, verified by gdb), so it is
 * compared field-by-field against the capability SID through bounded offset
 * reads ({@link sameSidAt}). A malformed header reads as "no exact grant"
 * so the caller falls back to the merge-apply path, which owns the robust
 * failure handling.
 * @param oldAcl - the current explicit DACL pointer (from {@link readCurrentDacl}).
 * @param sidPtr - the capability SID to match.
 * @returns whether the exact grant ACE is already present.
 */
/** 中文说明：函数 hasExactGrant 承担本模块的安全处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function hasExactGrant(oldAcl: NativePtr, sidPtr: NativePtr): boolean {
  /** 中文说明：变量 aclSize 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const aclSize = decodeUint16At(oldAcl, 2)
  /** 中文说明：变量 aceCount 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const aceCount = decodeUint16At(oldAcl, 4)
  if (aclSize < 8 || aclSize > 1_048_576) return false // implausible: fall back to the merge path
  /** 中文说明：变量 offset 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let offset = 8 // the first ACE follows the 8-byte ACL header
  /** 中文说明：该循环依次处理权限或资源数据；循环变量仅在当前循环中有效。 */
  for (let index = 0; index < aceCount; index++) {
    // ACE_HEADER: AceType@0, AceFlags@1, AceSize@2 (WORD);
    // ACCESS_ALLOWED_ACE: Mask@4, inline SID@8.
    /** 中文说明：变量 aceSize 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const aceSize = decodeUint16At(oldAcl, offset + 2)
    if (aceSize < 8 || offset + aceSize > aclSize) return false // implausible: fall back to the merge path
    /** 中文说明：变量 exact 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const exact = decodeUint8At(oldAcl, offset) === abi.ACCESS_ALLOWED_ACE_TYPE
      && decodeUint8At(oldAcl, offset + 1) === abi.SUB_CONTAINERS_AND_OBJECTS_INHERIT
      && decodeUint32At(oldAcl, offset + 4) === abi.GRANT_MASK
    if (exact && sameSidAt(oldAcl, offset + 8, sidPtr, 0)) return true
    offset += aceSize
  }
  return false
}

/**
 * Grant `GRANT_MASK` (Write+Delete, displays as "Modify") to the capability SID
 * on `path`, inheriting to subcontainers and objects. Idempotent: when the
 * directory's current explicit DACL already carries the exact ACE (the
 * per-session grant surviving from a previous server lifetime), the
 * SetNamedSecurityInfoW apply is SKIPPED — it would otherwise re-propagate
 * the identical ACE across the whole tree (eager inheritance; minutes on
 * large workspaces). Otherwise read-merge-write: the new ACE merges into the
 * directory's CURRENT explicit DACL (same shape as {@link revokeWrite}), so
 * pre-existing explicit ACEs survive. Runs under the per-path lock. The
 * directory must be owned by the caller (owner implicit WRITE_DAC) — same
 * precondition as the POC.
 * @param api - the binding table.
 * @param path - the directory whose DACL gains the grant (the workspace or temp root).
 * @param sidPtr - the capability SID the ACE names.
 */
/** 中文说明：函数 grantWrite 承担本模块的安全处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export function grantWrite(api: Win32Bindings, path: string, sidPtr: NativePtr): void {
  withPathLock(api, path, () => {
    const { oldAcl, descriptor } = readCurrentDacl(api, path)
    if (oldAcl !== null && hasExactGrant(oldAcl, sidPtr)) {
      // The exact ACE stands: releasing the descriptor is the whole operation.
      if (descriptor !== null) {
        /** 中文说明：变量 freed 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const freed = api.localFree(descriptor)
        if (!isNullPtr(freed)) throwLastError(api, 'LocalFree', `grantWrite(${path}) descriptor`)
      }
      return
    }
    mergeAndApply(api, path, buildExplicitAccess(sidPtr, abi.GRANT_ACCESS, abi.GRANT_MASK), oldAcl, descriptor, 'grantWrite')
  })
}

/**
 * Remove every ACE for the capability SID from the directory DACL (REVOKE_ACCESS
 * merge — other entries are preserved). Returns whether an ACE removal was
 * attempted (false when the directory carries no DACL at all).
 *
 * Runs under the per-path lock (the whole get-merge-set sequence); the
 * descriptor/ACL allocation contract lives on {@link readCurrentDacl}.
 * @param api - the binding table.
 * @param path - the directory whose DACL loses the capability-SID ACEs.
 * @param sidPtr - the capability SID whose ACEs are removed.
 * @returns whether an ACE removal was attempted (false when the directory carries no DACL at all).
 */
/** 中文说明：函数 revokeWrite 承担本模块的安全处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export function revokeWrite(api: Win32Bindings, path: string, sidPtr: NativePtr): boolean {
  return withPathLock(api, path, () => {
    const { oldAcl, descriptor } = readCurrentDacl(api, path)
    if (oldAcl === null) {
      if (descriptor !== null) {
        /** 中文说明：变量 freed 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const freed = api.localFree(descriptor)
        if (!isNullPtr(freed)) throwLastError(api, 'LocalFree', `revokeWrite(${path}) descriptor`)
      }
      return false
    }
    mergeAndApply(api, path, buildExplicitAccess(sidPtr, abi.REVOKE_ACCESS, 0), oldAcl, descriptor, 'revokeWrite')
    return true
  })
}
