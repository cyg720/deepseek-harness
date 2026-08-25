/**
 * Server-side write-grant materialization. The sandbox seam holds one
 * standing workspace grant per workspace and one revocable temp grant per
 * live session/workspace pair. Workspace identities survive by deterministic
 * derivation and their standing ACE; temp identities derive from random
 * private paths and are deliberately new after a restart.
 *
 * Fail-closed: `add` throws on any grant failure and the caller disposes the
 * instance (revoking every path granted so far); `dispose` revokes every
 * standing grant and reports every cleanup failure.
 * @module @deepseek-ai/dsh-sandbox-windows-acl/grant
 */
/**
 * 文件职责：实现 grant.ts 承担的沙箱策略或 Windows ACL 隔离职责。
 * 技术维度：使用 TypeScript、Windows 原生接口、访问控制列表和进程生命周期管理。
 * 产品维度：限制 Agent 子进程可访问的系统资源，降低误操作和凭据泄露风险。
 * 逻辑维度：解析策略，构造权限或原生调用，启动受限进程，并等待退出后清理。
 * 关键边界：原生句柄和权限失败必须显式处理；环境变量需净化；清理必须达到静止状态。
 * 新手阅读建议：先看公开配置和 Win32 类型，再读权限授予与启动，最后关注错误和清理。
 */

import { grantWrite, revokeWrite } from './acl.ts'
import { allocPtrSlot, decodePtr, isNullPtr, throwLastError, win32Sync } from './ffi.ts'
import type { NativePtr, Win32Bindings } from './ffi.ts'

/**
 * One write SID's provider-lifetime grant materialization: the parsed SID
 * pointer plus every directory whose DACL currently carries its ACE.
 * Workspace paths are added STANDING (their ACEs are the cross-session reuse
 * cache and outlive the grant — dispose() skips revoking them, or the next
 * provision would re-propagate the whole tree); temp paths are revocable
 * (dispose() revokes them — an inheritable ACE must not outlive its
 * session's temp directory). Create with {@link AclWriteGrant.create};
 * dispose revokes the revocable paths and frees the SID.
 */
/** 中文说明：class AclWriteGrant 定义本模块所需的数据或行为，用于表达沙箱安全场景。 */
export class AclWriteGrant {
  /** The write SID in SDDL string form. */
  readonly writeSid: string
  private readonly api: Win32Bindings
  private readonly sidPtr: NativePtr
  private readonly revocablePaths: string[] = []
  private readonly standingPaths: string[] = []

  private constructor(api: Win32Bindings, sidPtr: NativePtr, writeSid: string) {
    this.api = api
    this.sidPtr = sidPtr
    this.writeSid = writeSid
  }

  /**
   * Parse the SID string and open the binding table (lazily, once per
   * server). Fail-closed: any failure throws — nothing is granted yet.
   * @param writeSid - the workspace (`S-1-4-x-y`) or temp (`S-1-4-x-y-1`) capability SID string.
   * @param api - optional already-resolved bindings (tests).
   * @returns the ready grant (no ACEs yet).
   */
  static create(writeSid: string, api?: Win32Bindings): AclWriteGrant {
    /** 中文说明：变量 bindings 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bindings = api ?? win32Sync()
    /** 中文说明：变量 sidSlot 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sidSlot = allocPtrSlot()
    if (bindings.convertStringSidToSidW(writeSid, sidSlot) === 0) {
      throwLastError(bindings, 'ConvertStringSidToSidW', writeSid)
    }
    /** 中文说明：变量 sidPtr 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sidPtr = decodePtr(sidSlot)
    if (sidPtr === null) throwLastError(bindings, 'ConvertStringSidToSidW', `null SID for ${writeSid}`)
    return new AclWriteGrant(bindings, sidPtr, writeSid)
  }

  /**
   * Grant the write ACE on one directory (idempotent: an already-standing
   * exact ACE skips the eager full-tree re-propagation — see
   * {@link grantWrite}) and record the path for {@link dispose} unless it is
   * standing. The path is recorded BEFORE the grant: a post-apply throw (a
   * LocalFree failure after SetNamedSecurityInfoW succeeded) must still
   * revoke it, and revoking an ungranted path is a no-op merge. Callers
   * treat a throw as a failed materialization and dispose the instance to
   * revoke the paths granted so far.
   * @param path - the directory whose DACL gains the grant.
   * @param standing - the ACE outlives this grant (the workspace reuse
   *   cache; dispose() skips revoking it). Default false (revoked on
   *   dispose — the temp-directory lifecycle).
   */
  add(path: string, standing = false): void {
    ;(standing ? this.standingPaths : this.revocablePaths).push(path)
    grantWrite(this.api, path, this.sidPtr)
  }

  /** Every directory currently carrying the grant, in grant order. */
  get paths(): readonly string[] {
    return [...this.standingPaths, ...this.revocablePaths]
  }

  /** Revoke every revocable grant (standing ACEs stay) and free the SID; reports every cleanup failure. */
  dispose(): void {
    /** 中文说明：变量 failures 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const failures: unknown[] = []
    /** 中文说明：该循环依次处理权限或资源数据；循环变量仅在当前循环中有效。 */
    for (const path of this.revocablePaths) {
      try {
        revokeWrite(this.api, path, this.sidPtr)
      } catch (error) {
        failures.push(error)
      }
    }
    try {
      /** 中文说明：变量 freed 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const freed = this.api.localFree(this.sidPtr)
      if (!isNullPtr(freed)) throwLastError(this.api, 'LocalFree', 'write SID')
    } catch (error) {
      failures.push(error)
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, `AclWriteGrant dispose completed with ${failures.length} cleanup failure(s)`)
    }
  }
}
