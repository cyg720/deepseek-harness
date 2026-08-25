/**
 * Restricted-token construction: open the current process token, extract its
 * logon SID, build the well-known SIDs, and call CreateRestrictedToken with
 * the POC's restricting-SID allowlist. Every API call is checked; any failure
 * throws with the API name and the exact Win32 code — the original POC ignored
 * all of these and silently ran children with the FULL, unrestricted token.
 * @module @deepseek-ai/dsh-sandbox-windows-acl/token
 */
/**
 * 文件职责：实现 token.ts 承担的沙箱安全与权限隔离配置、协议与生命周期职责。
 * 技术维度：使用 TypeScript、Cordis 插件、配置校验、事件日志与异步资源管理。
 * 产品维度：为 Agent 提供可靠的沙箱安全与权限隔离能力。
 * 逻辑维度：解析输入，注册能力，执行核心操作，并在结束时释放所拥有的资源。
 * 关键边界：权限和配置失败必须显式；模型可见状态必须记录；清理必须达到静止状态。
 * 新手阅读建议：先看导出类型和常量，再读主流程，最后关注平台限制、恢复和清理。
 */

import { allocBytes, allocPtrSlot, allocUint32, decodePtr, decodePtrAt, decodeUint32, encodeUint32, isNullPtr, ptrAddress, throwLastError, throwWin32 } from './ffi.ts'
import type { NativePtr, Win32Bindings } from './ffi.ts'
import { buildExplicitAccess } from './acl.ts'
import * as abi from './win32-abi.ts'

/**
 * Open the current process's access token with the rights
 * CreateRestrictedToken requires (the POC's OpenProcessToken call; the token
 * handle is obtained through a real OpenProcess handle because the
 * GetCurrentProcess() pseudo-handle is not addressable through koffi).
 * @param api - the binding table.
 * @returns the opened token handle.
 */
/** 中文说明：函数 openCurrentProcessToken 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export function openCurrentProcessToken(api: Win32Bindings): NativePtr {
  /** 中文说明：变量 processHandle 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const processHandle = api.openProcess(abi.PROCESS_QUERY_INFORMATION, 0, process.pid)
  if (isNullPtr(processHandle)) throwLastError(api, 'OpenProcess', `pid ${process.pid}`)

  /** 中文说明：变量 tokenSlot 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const tokenSlot = allocPtrSlot()
  /** 中文说明：变量 opened 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const opened = api.openProcessToken(
    processHandle,
    abi.TOKEN_QUERY | abi.TOKEN_DUPLICATE | abi.TOKEN_ADJUST_DEFAULT | abi.TOKEN_ASSIGN_PRIMARY,
    tokenSlot,
  )
  if (opened === 0) {
    /** 中文说明：变量 win32Code 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const win32Code = api.getLastError()
    api.closeHandle(processHandle) // best-effort on the error path
    throwWin32(api, 'OpenProcessToken', win32Code, `pid ${process.pid}`)
  }
  if (api.closeHandle(processHandle) === 0) throwLastError(api, 'CloseHandle', 'OpenProcess process handle')
  /** 中文说明：变量 token 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const token = decodePtr(tokenSlot)
  if (token === null) throwWin32(api, 'OpenProcessToken', api.getLastError(), 'null token handle')
  return token
}

/**
 * Find and copy the token's logon session SID (S-1-5-5-x-y, attribute
 * SE_GROUP_LOGON_ID). The restricted token needs it for WinSta0/desktop and
 * other per-logon objects; the POC extracts it the same way.
 * @param api - the binding table.
 * @param token - the token whose groups are scanned.
 * @returns a copied logon SID (thrown when the token carries none).
 */
/** 中文说明：函数 findLogonSid 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export function findLogonSid(api: Win32Bindings, token: NativePtr): NativePtr {
  /** 中文说明：变量 neededSlot 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const neededSlot = allocUint32()
  api.getTokenInformation(token, abi.TokenGroups, null, 0, neededSlot) // expected to fail with ERROR_INSUFFICIENT_BUFFER
  /** 中文说明：变量 needed 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const needed = decodeUint32(neededSlot)
  if (needed === 0) throwLastError(api, 'GetTokenInformation', 'TokenGroups size query')
  if (needed < abi.TOKEN_GROUPS_OFFSET) throwWin32(api, 'GetTokenInformation', api.getLastError(), `implausible TokenGroups size ${needed}`)

  /** 中文说明：变量 groups 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const groups = Buffer.alloc(needed)
  if (api.getTokenInformation(token, abi.TokenGroups, groups, groups.length, neededSlot) === 0) {
    throwLastError(api, 'GetTokenInformation', 'TokenGroups')
  }
  /** 中文说明：变量 groupCount 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const groupCount = groups.readUInt32LE(0)
  /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
  for (let index = 0; index < groupCount; index++) {
    /** 中文说明：变量 sidPtr 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sidPtr = decodePtrAt(groups, abi.TOKEN_GROUPS_OFFSET + index * abi.SID_AND_ATTRIBUTES_SIZE)
    /** 中文说明：变量 attributes 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const attributes = groups.readUInt32LE(abi.TOKEN_GROUPS_OFFSET + index * abi.SID_AND_ATTRIBUTES_SIZE + 8)
    // >>> 0: JS bitwise & is signed 32-bit; SE_GROUP_LOGON_ID has bit 31 set.
    /** 中文说明：变量 isLogonId 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const isLogonId = ((attributes & abi.SE_GROUP_LOGON_ID) >>> 0) === (abi.SE_GROUP_LOGON_ID >>> 0)
    if (sidPtr === null || !isLogonId) continue
    /** 中文说明：变量 sidLength 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sidLength = api.getLengthSid(sidPtr)
    if (sidLength === 0) throwLastError(api, 'GetLengthSid', `logon SID group ${index}`)
    /** 中文说明：变量 copy 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const copy = allocBytes(sidLength)
    if (api.copySid(sidLength, copy, sidPtr) === 0) throwLastError(api, 'CopySid', `logon SID group ${index}`)
    return copy
  }
  throw new Error(`CreateRestrictedToken prerequisite failed: no logon SID found among ${groupCount} token groups`)
}

/**
 * Create one well-known SID (68-byte buffer) and assert its validity.
 * @param api - the binding table.
 * @param type - the WELL_KNOWN_SID_TYPE to create.
 * @returns the created SID pointer.
 */
/** 中文说明：函数 makeWellKnownSid 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export function makeWellKnownSid(api: Win32Bindings, type: number): NativePtr {
  /** 中文说明：变量 sid 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const sid = allocBytes(abi.SECURITY_MAX_SID_SIZE)
  /** 中文说明：变量 sizeSlot 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const sizeSlot = allocUint32()
  encodeUint32(sizeSlot, abi.SECURITY_MAX_SID_SIZE)
  if (api.createWellKnownSid(type, null, sid, sizeSlot) === 0) {
    throwLastError(api, 'CreateWellKnownSid', `type ${type}`)
  }
  if (api.isValidSid(sid) === 0) throwLastError(api, 'IsValidSid', `CreateWellKnownSid type ${type}`)
  return sid
}

/**
 * Merge one full-access allow ACE for `sidPtr` into the token's DEFAULT DACL
 * — the DACL every NEW object the token holder creates (without an explicit
 * security descriptor) takes. The restricted token inherits the user's
 * default DACL verbatim, which names no restricting SID: a new anonymous pipe
 * (child stdio) therefore fails the write pass-2 check at creation
 * (ERROR_ACCESS_DENIED; Node surfaces it as spawn EPERM), breaking every
 * piped-stdio grandchild spawn. The merged ACE names a RESTRICTING SID (the
 * write SID under workspace-write, Everyone under read-only), so each new
 * object's own DACL passes pass-2 while object creation itself stays gated by
 * the parent container's DACL (files outside the granted trees remain
 * uncreatable). Fails closed: any Win32 failure throws before the spawn.
 * @param api - the binding table.
 * @param token - the restricted token to adjust (requires TOKEN_ADJUST_DEFAULT).
 * @param sidPtr - the restricting SID whose full-access ACE joins the default DACL.
 */
/** 中文说明：函数 setTokenDefaultDaclGrant 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export function setTokenDefaultDaclGrant(api: Win32Bindings, token: NativePtr, sidPtr: NativePtr): void {
  /** 中文说明：变量 neededSlot 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const neededSlot = allocUint32()
  api.getTokenInformation(token, abi.TokenDefaultDacl, null, 0, neededSlot) // expected to fail with ERROR_INSUFFICIENT_BUFFER
  /** 中文说明：变量 needed 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const needed = decodeUint32(neededSlot)
  if (needed === 0) throwLastError(api, 'GetTokenInformation', 'TokenDefaultDacl size query')
  /** 中文说明：变量 buffer 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const buffer = Buffer.alloc(needed)
  if (api.getTokenInformation(token, abi.TokenDefaultDacl, buffer, buffer.length, neededSlot) === 0) {
    throwLastError(api, 'GetTokenInformation', 'TokenDefaultDacl')
  }
  /** 中文说明：变量 currentDacl 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const currentDacl = decodePtrAt(buffer, 0)
  if (currentDacl === null) {
    throw new Error('setTokenDefaultDaclGrant: the token carries no default DACL to extend')
  }
  /** 中文说明：变量 newDaclSlot 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const newDaclSlot = allocPtrSlot()
  /** 中文说明：变量 result 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const result = api.setEntriesInAclW(
    1,
    buildExplicitAccess(sidPtr, abi.GRANT_ACCESS, abi.FILE_ALL_ACCESS),
    currentDacl,
    newDaclSlot,
  )
  if (result !== abi.ERROR_SUCCESS) throwWin32(api, 'SetEntriesInAclW', result, 'default DACL merge')
  /** 中文说明：变量 newDacl 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const newDacl = decodePtr(newDaclSlot)
  if (newDacl === null) throwWin32(api, 'SetEntriesInAclW', result, 'null merged default DACL')
  // TOKEN_DEFAULT_DACL { PACL DefaultDacl; } — the struct is exactly the
  // pointer; SetTokenInformation copies the ACL before returning.
  /** 中文说明：变量 info 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const info = Buffer.alloc(8)
  info.writeBigUInt64LE(newDacl, 0)
  if (api.setTokenInformation(token, abi.TokenDefaultDacl, info, info.length) === 0) {
    /** 中文说明：变量 win32Code 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const win32Code = api.getLastError()
    api.localFree(newDacl)
    throwWin32(api, 'SetTokenInformation', win32Code, 'TokenDefaultDacl')
  }
  api.localFree(newDacl)
}

/** Pack `SID_AND_ATTRIBUTES[count]` (16-byte stride; Attributes stay 0). */
/** 中文说明：函数 buildRestrictingSids 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function buildRestrictingSids(sids: readonly NativePtr[]): Buffer {
  /** 中文说明：变量 buffer 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const buffer = Buffer.alloc(abi.SID_AND_ATTRIBUTES_SIZE * sids.length)
  sids.forEach((sid, index) => {
    buffer.writeBigUInt64LE(ptrAddress(sid), abi.SID_AND_ATTRIBUTES_SIZE * index)
  })
  return buffer
}

/** The well-known SID packed into every restricted token's restricting list. */
/** 中文说明：interface RestrictingSidSet 定义本模块所需的数据或行为，用于表达沙箱安全与权限隔离场景。 */
export interface RestrictingSidSet {
  world: NativePtr
}

/**
 * Create the write-restricted token with the mode-selected restricting list
 * (verified on Win11 26200, see the POC-worktree restrict-variant harness):
 *  - read-only:       [logon SID, EVERYONE]
 *  - workspace-write: [logon SID, EVERYONE, workspace SID, optional temp SID]
 *
 * The logon SID + EVERYONE keep-alive group is shared by both modes: early
 * DLL init dies with 0xC0000142 and CNG (`\Device\CNG` write trustee —
 * pwsh crashes 0xE0434352) fails without them. The write SIDs join ONLY
 * workspace-write — read-only carries no write SID, so a standing grant ACE
 * from an earlier workspace-write period (a `/permission` mode downgrade, or
 * a crash-resumed session) stays INERT under read-only: the WRITE_RESTRICTED
 * pass-2 check grants only what the restricting list carries, keeping that
 * workspace grant inert under read-only while the unrevoked ACE keeps the
 * re-upgrade free (the grant's exact-ACE skip — no re-propagation).
 * Everyone's own ambient grants remain the documented partial boundary.
 * Authenticated Users is absent from BOTH lists: the WMI
 * namespace security check fails (0x80041003), so CIM is unavailable in
 * every confined mode, and the C:\-root tree-creation escape (standing
 * `AU:(AD)` + `AU:(OI)(CI)(IO)(M)` ACEs) is closed in both — documented in
 * README. INTERACTIVE/LOCAL are absent from BOTH lists too — the host's
 * Public tree grants write to INTERACTIVE, so removing it closes that
 * escape. S-1-2-1 (console logon) is intentionally absent: see win32-abi.ts
 * for the verified failure modes. FAILS CLOSED: any failure throws — never
 * spawn unrestricted.
 * @param api - the binding table.
 * @param currentToken - the process token to restrict.
 * @param logonSid - the copied logon session SID.
 * @param writeSids - the distinct write SIDs forming the workspace and
 * optional temp allowlists (workspace-write only; empty under read-only).
 * @param known - the well-known SIDs entering the restricting list.
 * @param mode - selects the restricting list (workspace-write adds the capability SIDs).
 * @returns the restricted token handle.
 */
/** 中文说明：函数 createRestrictedToken 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export function createRestrictedToken(
  api: Win32Bindings,
  currentToken: NativePtr,
  logonSid: NativePtr,
  writeSids: readonly NativePtr[],
  known: RestrictingSidSet,
  mode: 'read-only' | 'workspace-write',
): NativePtr {
  /** 中文说明：变量 restrictingSids 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const restrictingSids = buildRestrictingSids(mode === 'read-only'
    ? [logonSid, known.world]
    : writeSids.length === 0
      ? (() => { throw new Error('createRestrictedToken: workspace-write restricting list requires at least one write SID') })()
      : [logonSid, known.world, ...writeSids])
  /** 中文说明：变量 tokenSlot 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const tokenSlot = allocPtrSlot()
  /** 中文说明：变量 created 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const created = api.createRestrictedToken(
    currentToken,
    abi.DISABLE_MAX_PRIVILEGE | abi.LUA_TOKEN | abi.WRITE_RESTRICTED,
    0, null, // no SIDs disabled
    0, null, // no privileges deleted
    restrictingSids.length / abi.SID_AND_ATTRIBUTES_SIZE,
    restrictingSids,
    tokenSlot,
  )
  if (created === 0) throwLastError(api, 'CreateRestrictedToken', `restricting SIDs: ${restrictingSids.length / abi.SID_AND_ATTRIBUTES_SIZE}`)
  /** 中文说明：变量 token 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const token = decodePtr(tokenSlot)
  if (token === null) throwWin32(api, 'CreateRestrictedToken', api.getLastError(), 'null token handle')
  return token
}
