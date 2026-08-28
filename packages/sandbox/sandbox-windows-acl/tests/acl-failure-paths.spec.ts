/**
 * ACL failure-path tests with minimal stub binding tables: every checked
 * Win32 call in the lock, read-merge-write, and
 * grant-skip sequence has a failing counterpart, and each failure closes the
 * handles it created before throwing. The exact-ACE skip and the DACL-walk
 * defenses are driven through crafted in-memory ACL/SID buffers. Pure
 * stubs — no real Win32 calls, so these run on every platform; the
 * real-FFI round-trip lives in acl.spec.ts (win32 only).
 */
/*
 * 文件职责：验证 acl-failure-paths.spec.ts 覆盖的沙箱安全与权限隔离行为与失败场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件上下文和受控系统资源。
 * 产品维度：保障 Agent 使用沙箱安全与权限隔离时得到稳定且可诊断的结果。
 * 逻辑维度：准备配置与资源，触发被测流程，再核对结果、事件、错误和清理。
 * 关键边界：平台能力可能不同；持久化数据和外部输入不可信；异步资源必须完全释放。
 * 新手阅读建议：先读辅助函数和平台条件，再看正常路径，最后阅读恢复与失败用例。
 */

import { tmpdir } from 'node:os'
import { Win32Error } from '@deepseek-ai/dsh-win32-process'
import { describe, expect, it, vi } from 'vitest'
import koffi from 'koffi'

import { grantWrite, revokeWrite, withPathLock } from '../src/acl.ts'
import { allocBytes, ptrAddress } from '../src/ffi.ts'
import type { NativePtr, Win32Bindings } from '../src/ffi.ts'
import * as abi from '../src/win32-abi.ts'

/** 中文说明：常量 PVOID 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const PVOID = koffi.pointer('void')

/** The stub the grant/revoke happy path needs; every call succeeds until a field is overridden per test. */
/* 中文说明：函数 aclApi 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function aclApi(overrides: Partial<Win32Bindings> = {}): Win32Bindings {
  return {
    getTempPathW: vi.fn((_length: number, buffer: Buffer) => {
      /** 中文说明：变量 temp 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const temp = tmpdir().replace(/[\\/]$/u, '')
      buffer.write(temp, 'utf16le')
      return temp.length
    }),
    createFileW: vi.fn(() => 7n),
    lockFileEx: vi.fn(() => 1),
    unlockFileEx: vi.fn(() => 1),
    closeHandle: vi.fn(() => 1),
    getNamedSecurityInfoW: vi.fn((
      _path: unknown, _type: unknown, _info: unknown, _owner: unknown, _group: unknown,
      dacl: NativePtr, _sacl: unknown, descriptor: NativePtr,
    ) => {
      koffi.encode(dacl, PVOID, 0n) // no explicit DACL: the merge builds one
      koffi.encode(descriptor, PVOID, 0n)
      return 0
    }),
    setEntriesInAclW: vi.fn((_count: unknown, _entries: unknown, _old: unknown, newAcl: NativePtr) => {
      koffi.encode(newAcl, PVOID, 9n)
      return 0
    }),
    setNamedSecurityInfoW: vi.fn(() => 0),
    localFree: vi.fn(() => 0n as NativePtr),
    getLastError: vi.fn(() => 5),
    formatMessageW: vi.fn(() => 0),
    ...overrides,
  } as unknown as Win32Bindings
}

/** One SID allocation: revision@0, subAuthorityCount@1, identifierAuthority@2 (6 bytes), subauthorities@8. */
/* 中文说明：函数 craftSid 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function craftSid(revision: number, count: number, authority: number[] = [0, 0, 0, 0, 0, 5]): NativePtr {
  /** 中文说明：变量 sid 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const sid = allocBytes(8)
  koffi.encode(sid, 'uint8', revision)
  koffi.encode(sid, 1, 'uint8', count)
  authority.forEach((byte, index) => {
    koffi.encode(sid, 2 + index, 'uint8', byte)
  })
  return sid
}

/**
 * One in-memory ACL carrying the exact grant ACE the skip checks for:
 * header (AclRevision@0, AclSize@2, AceCount@4) then one ACCESS_ALLOWED_ACE
 * (AceType@0, AceFlags@1, AceSize@2, Mask@4, inline SID@8). `match` selects
 * whether the inline SID bytes equal `sid`.
 */
/* 中文说明：函数 craftAclWithGrant 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function craftAclWithGrant(sid: NativePtr, match: boolean): NativePtr {
  /** 中文说明：变量 acl 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const acl = allocBytes(32)
  koffi.encode(acl, 'uint8', 2) // AclRevision
  koffi.encode(acl, 2, 'uint16', 24) // AclSize: 8-byte header + one 16-byte ACE
  koffi.encode(acl, 4, 'uint16', 1) // AceCount
  /** 中文说明：变量 ace 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ace = 8
  koffi.encode(acl, ace + 0, 'uint8', abi.ACCESS_ALLOWED_ACE_TYPE)
  koffi.encode(acl, ace + 1, 'uint8', abi.SUB_CONTAINERS_AND_OBJECTS_INHERIT)
  koffi.encode(acl, ace + 2, 'uint16', 16) // AceSize: header + mask + inline 8-byte SID
  koffi.encode(acl, ace + 4, 'uint32', abi.GRANT_MASK)
  /** 中文说明：变量 inlineSid 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const inlineSid = ace + 8
  /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
  for (let offset = 0; offset < 8; offset++) {
    koffi.encode(acl, inlineSid + offset, 'uint8', match
      ? koffi.decode(sid, offset, 'uint8') as number
      : offset === 0 ? 9 : 0)
  }
  return acl
}

describe('withPathLock failure paths', () => {
  it('fails closed when CreateFileW returns an invalid handle', () => {
    /** 中文说明：函数值 api 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const api = aclApi({ createFileW: vi.fn(() => 0n as NativePtr) })
    /** 中文说明：变量 caught 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let caught: unknown
    try {
      withPathLock(api, 'C:\\locked', () => {})
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Win32Error)
    expect((caught as Win32Error).api).toBe('CreateFileW')
  })

  it('closes the handle and reports when LockFileEx fails', () => {
    /** 中文说明：函数值 closeHandle 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const closeHandle = vi.fn(() => 1)
    /** 中文说明：函数值 api 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const api = aclApi({ lockFileEx: vi.fn(() => 0), closeHandle })
    /** 中文说明：变量 caught 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let caught: unknown
    try {
      withPathLock(api, 'C:\\locked', () => {})
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Win32Error)
    expect((caught as Win32Error).api).toBe('LockFileEx')
    expect(closeHandle).toHaveBeenCalledWith(7n)
  })

  it('closes the handle and reports when UnlockFileEx fails', () => {
    /** 中文说明：函数值 closeHandle 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const closeHandle = vi.fn(() => 1)
    /** 中文说明：函数值 api 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const api = aclApi({ unlockFileEx: vi.fn(() => 0), closeHandle })
    /** 中文说明：变量 caught 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let caught: unknown
    try {
      withPathLock(api, 'C:\\locked', () => {})
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Win32Error)
    expect((caught as Win32Error).api).toBe('UnlockFileEx')
    expect(closeHandle).toHaveBeenCalledWith(7n)
  })

  it('reports a failed CloseHandle after a successful action', () => {
    /** 中文说明：函数值 api 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const api = aclApi({ closeHandle: vi.fn(() => 0) })
    /** 中文说明：变量 caught 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let caught: unknown
    try {
      withPathLock(api, 'C:\\locked', () => {})
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Win32Error)
    expect((caught as Win32Error).api).toBe('CloseHandle')
  })
})

describe('mergeAndApply failure paths', () => {
  it('reports a SetEntriesInAclW failure when the directory carries no descriptor to free', () => {
    /** 中文说明：函数值 api 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const api = aclApi({ setEntriesInAclW: vi.fn(() => 5) }) // default descriptor: none
    /** 中文说明：变量 sid 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sid = craftSid(1, 0)
    /** 中文说明：变量 caught 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let caught: unknown
    try {
      grantWrite(api, 'C:\\granted', sid)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Win32Error)
    expect((caught as Win32Error).api).toBe('SetEntriesInAclW')
  })

  it('reports a NULL merged ACL when there is no descriptor to free', () => {
    /** 中文说明：函数值 api 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const api = aclApi({ setEntriesInAclW: vi.fn(() => 0) }) // no out slot write, no descriptor
    /** 中文说明：变量 sid 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sid = craftSid(1, 0)
    /** 中文说明：变量 caught 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let caught: unknown
    try {
      grantWrite(api, 'C:\\granted', sid)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Win32Error)
    expect((caught as Win32Error).api).toBe('SetEntriesInAclW')
  })

  it('frees the descriptor and reports when SetEntriesInAclW fails', () => {
    /** 中文说明：函数值 localFree 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const localFree = vi.fn(() => 0n as NativePtr)
    /** 中文说明：变量 api 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const api = aclApi({
      getNamedSecurityInfoW: vi.fn((
        _path: unknown, _type: unknown, _info: unknown, _owner: unknown, _group: unknown,
        dacl: NativePtr, _sacl: unknown, descriptor: NativePtr,
      ) => {
        koffi.encode(dacl, PVOID, 0n)
        koffi.encode(descriptor, PVOID, 6n) // an existing explicit DACL
        return 0
      }),
      setEntriesInAclW: vi.fn(() => 5),
      localFree,
    })
    /** 中文说明：变量 sid 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sid = craftSid(1, 0)
    /** 中文说明：变量 caught 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let caught: unknown
    try {
      grantWrite(api, 'C:\\granted', sid)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Win32Error)
    expect((caught as Win32Error).api).toBe('SetEntriesInAclW')
    expect(localFree).toHaveBeenCalledWith(6n)
  })

  it('frees the descriptor and reports a NULL merged ACL', () => {
    /** 中文说明：函数值 localFree 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const localFree = vi.fn(() => 0n as NativePtr)
    /** 中文说明：变量 api 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const api = aclApi({
      getNamedSecurityInfoW: vi.fn((
        _path: unknown, _type: unknown, _info: unknown, _owner: unknown, _group: unknown,
        dacl: NativePtr, _sacl: unknown, descriptor: NativePtr,
      ) => {
        koffi.encode(dacl, PVOID, 0n)
        koffi.encode(descriptor, PVOID, 6n)
        return 0
      }),
      setEntriesInAclW: vi.fn(() => 0), // success without writing the out slot
      localFree,
    })
    /** 中文说明：变量 sid 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sid = craftSid(1, 0)
    /** 中文说明：变量 caught 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let caught: unknown
    try {
      grantWrite(api, 'C:\\granted', sid)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Win32Error)
    expect((caught as Win32Error).api).toBe('SetEntriesInAclW')
    expect(localFree).toHaveBeenCalledWith(6n)
  })

  it('frees the merged ACL and reports when SetNamedSecurityInfoW fails', () => {
    /** 中文说明：函数值 localFree 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const localFree = vi.fn(() => 0n as NativePtr)
    /** 中文说明：函数值 api 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const api = aclApi({ setNamedSecurityInfoW: vi.fn(() => 5), localFree })
    /** 中文说明：变量 sid 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sid = craftSid(1, 0)
    /** 中文说明：变量 caught 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let caught: unknown
    try {
      grantWrite(api, 'C:\\granted', sid)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Win32Error)
    expect((caught as Win32Error).api).toBe('SetNamedSecurityInfoW')
    expect(localFree).toHaveBeenCalledWith(9n)
  })

  it('reports a failed descriptor LocalFree after a successful apply', () => {
    /** 中文说明：变量 api 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const api = aclApi({
      getNamedSecurityInfoW: vi.fn((
        _path: unknown, _type: unknown, _info: unknown, _owner: unknown, _group: unknown,
        dacl: NativePtr, _sacl: unknown, descriptor: NativePtr,
      ) => {
        koffi.encode(dacl, PVOID, 0n)
        koffi.encode(descriptor, PVOID, 6n)
        return 0
      }),
      localFree: vi.fn(() => 1n as NativePtr), // both frees "fail"; the first is checked
    })
    /** 中文说明：变量 sid 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sid = craftSid(1, 0)
    /** 中文说明：变量 caught 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let caught: unknown
    try {
      grantWrite(api, 'C:\\granted', sid)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Win32Error)
    expect((caught as Win32Error).api).toBe('LocalFree')
  })

  it('reports a failed merged-ACL LocalFree after a successful apply', () => {
    // No existing descriptor (the default stub): the merge's only LocalFree
    // is the merged ACL's, which "fails" and is checked after the apply.
    /** 中文说明：函数值 api 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const api = aclApi({ localFree: vi.fn(() => 1n as NativePtr) })
    /** 中文说明：变量 sid 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sid = craftSid(1, 0)
    /** 中文说明：变量 caught 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let caught: unknown
    try {
      grantWrite(api, 'C:\\granted', sid)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Win32Error)
    expect((caught as Win32Error).api).toBe('LocalFree')
  })
})

describe('the exact-ACE skip and DACL-walk defenses', () => {
  it('grantWrite skips the apply when the standing exact ACE matches (descriptor freed, nothing merged)', () => {
    /** 中文说明：变量 sid 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sid = craftSid(1, 0)
    /** 中文说明：函数值 localFree 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const localFree = vi.fn(() => 0n as NativePtr)
    /** 中文说明：函数值 setNamedSecurityInfoW 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const setNamedSecurityInfoW = vi.fn(() => 0)
    /** 中文说明：变量 api 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const api = aclApi({
      getNamedSecurityInfoW: vi.fn((
        _path: unknown, _type: unknown, _info: unknown, _owner: unknown, _group: unknown,
        dacl: NativePtr, _sacl: unknown, descriptor: NativePtr,
      ) => {
        koffi.encode(dacl, PVOID, ptrAddress(craftAclWithGrant(sid, true)))
        koffi.encode(descriptor, PVOID, 6n)
        return 0
      }),
      localFree,
      setNamedSecurityInfoW,
    })
    grantWrite(api, 'C:\\granted', sid)
    expect(setNamedSecurityInfoW).not.toHaveBeenCalled()
    expect(localFree).toHaveBeenCalledWith(6n)
  })

  it('grantWrite skips the apply without freeing when the exact ACE stands but no descriptor owns it', () => {
    /** 中文说明：变量 sid 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sid = craftSid(1, 0)
    /** 中文说明：函数值 localFree 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const localFree = vi.fn(() => 0n as NativePtr)
    /** 中文说明：函数值 setNamedSecurityInfoW 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const setNamedSecurityInfoW = vi.fn(() => 0)
    /** 中文说明：变量 api 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const api = aclApi({
      getNamedSecurityInfoW: vi.fn((
        _path: unknown, _type: unknown, _info: unknown, _owner: unknown, _group: unknown,
        dacl: NativePtr, _sacl: unknown, descriptor: NativePtr,
      ) => {
        koffi.encode(dacl, PVOID, ptrAddress(craftAclWithGrant(sid, true)))
        koffi.encode(descriptor, PVOID, 0n) // the read "returned" a bare ACL with no descriptor
        return 0
      }),
      localFree,
      setNamedSecurityInfoW,
    })
    grantWrite(api, 'C:\\granted', sid)
    expect(setNamedSecurityInfoW).not.toHaveBeenCalled()
    expect(localFree).not.toHaveBeenCalled()
  })

  it('grantWrite reports a failed descriptor LocalFree on the exact-ACE skip path', () => {
    /** 中文说明：变量 sid 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sid = craftSid(1, 0)
    /** 中文说明：变量 api 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const api = aclApi({
      getNamedSecurityInfoW: vi.fn((
        _path: unknown, _type: unknown, _info: unknown, _owner: unknown, _group: unknown,
        dacl: NativePtr, _sacl: unknown, descriptor: NativePtr,
      ) => {
        koffi.encode(dacl, PVOID, ptrAddress(craftAclWithGrant(sid, true)))
        koffi.encode(descriptor, PVOID, 6n)
        return 0
      }),
      localFree: vi.fn(() => 1n as NativePtr),
    })
    /** 中文说明：变量 caught 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let caught: unknown
    try {
      grantWrite(api, 'C:\\granted', sid)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Win32Error)
    expect((caught as Win32Error).api).toBe('LocalFree')
  })

  it('falls back to the merge path when the standing ACE names a different SID', () => {
    /** 中文说明：变量 sid 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sid = craftSid(1, 0)
    /** 中文说明：函数值 setNamedSecurityInfoW 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const setNamedSecurityInfoW = vi.fn(() => 0)
    /** 中文说明：变量 api 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const api = aclApi({
      getNamedSecurityInfoW: vi.fn((
        _path: unknown, _type: unknown, _info: unknown, _owner: unknown, _group: unknown,
        dacl: NativePtr, _sacl: unknown, descriptor: NativePtr,
      ) => {
        koffi.encode(dacl, PVOID, ptrAddress(craftAclWithGrant(sid, false)))
        koffi.encode(descriptor, PVOID, 6n)
        return 0
      }),
      setNamedSecurityInfoW,
    })
    grantWrite(api, 'C:\\granted', sid)
    expect(setNamedSecurityInfoW).toHaveBeenCalledTimes(1)
  })

  it('treats an implausibly small ACL size as no exact grant', () => {
    /** 中文说明：变量 sid 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sid = craftSid(1, 0)
    /** 中文说明：变量 acl 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const acl = allocBytes(32)
    koffi.encode(acl, 'uint8', 2)
    koffi.encode(acl, 2, 'uint16', 4) // smaller than the 8-byte ACL header
    koffi.encode(acl, 4, 'uint16', 1)
    /** 中文说明：函数值 setNamedSecurityInfoW 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const setNamedSecurityInfoW = vi.fn(() => 0)
    /** 中文说明：变量 api 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const api = aclApi({
      getNamedSecurityInfoW: vi.fn((
        _path: unknown, _type: unknown, _info: unknown, _owner: unknown, _group: unknown,
        dacl: NativePtr, _sacl: unknown, descriptor: NativePtr,
      ) => {
        koffi.encode(dacl, PVOID, ptrAddress(acl))
        koffi.encode(descriptor, PVOID, 6n)
        return 0
      }),
      setNamedSecurityInfoW,
    })
    grantWrite(api, 'C:\\granted', sid)
    expect(setNamedSecurityInfoW).toHaveBeenCalledTimes(1)
  })

  it('treats an ACE that would overrun the ACL as no exact grant', () => {
    /** 中文说明：变量 sid 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sid = craftSid(1, 0)
    /** 中文说明：变量 acl 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const acl = allocBytes(32)
    koffi.encode(acl, 'uint8', 2)
    koffi.encode(acl, 2, 'uint16', 8) // header only: no room for any ACE
    koffi.encode(acl, 4, 'uint16', 1)
    koffi.encode(acl, 10, 'uint16', 100) // the walk reads a lying ACE size
    /** 中文说明：函数值 setNamedSecurityInfoW 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const setNamedSecurityInfoW = vi.fn(() => 0)
    /** 中文说明：变量 api 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const api = aclApi({
      getNamedSecurityInfoW: vi.fn((
        _path: unknown, _type: unknown, _info: unknown, _owner: unknown, _group: unknown,
        dacl: NativePtr, _sacl: unknown, descriptor: NativePtr,
      ) => {
        koffi.encode(dacl, PVOID, ptrAddress(acl))
        koffi.encode(descriptor, PVOID, 6n)
        return 0
      }),
      setNamedSecurityInfoW,
    })
    grantWrite(api, 'C:\\granted', sid)
    expect(setNamedSecurityInfoW).toHaveBeenCalledTimes(1)
  })
})

describe('revokeWrite no-DACL path', () => {
  it('reports nothing to revoke when the read yields neither DACL nor descriptor', () => {
    // The default stub encodes a NULL DACL and a NULL descriptor.
    /** 中文说明：变量 api 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const api = aclApi()
    /** 中文说明：变量 sid 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sid = craftSid(1, 0)
    expect(revokeWrite(api, 'C:\\granted', sid)).toBe(false)
  })

  it('frees a descriptor that carries no DACL and reports nothing to revoke', () => {
    /** 中文说明：函数值 localFree 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const localFree = vi.fn(() => 0n as NativePtr)
    /** 中文说明：变量 api 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const api = aclApi({
      getNamedSecurityInfoW: vi.fn((
        _path: unknown, _type: unknown, _info: unknown, _owner: unknown, _group: unknown,
        dacl: NativePtr, _sacl: unknown, descriptor: NativePtr,
      ) => {
        koffi.encode(dacl, PVOID, 0n)
        koffi.encode(descriptor, PVOID, 6n) // descriptor WITHOUT a DACL
        return 0
      }),
      localFree,
    })
    /** 中文说明：变量 sid 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sid = craftSid(1, 0)
    expect(revokeWrite(api, 'C:\\granted', sid)).toBe(false)
    expect(localFree).toHaveBeenCalledWith(6n)
  })

  it('reports a failed descriptor LocalFree on the no-DACL path', () => {
    /** 中文说明：变量 api 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const api = aclApi({
      getNamedSecurityInfoW: vi.fn((
        _path: unknown, _type: unknown, _info: unknown, _owner: unknown, _group: unknown,
        dacl: NativePtr, _sacl: unknown, descriptor: NativePtr,
      ) => {
        koffi.encode(dacl, PVOID, 0n)
        koffi.encode(descriptor, PVOID, 6n)
        return 0
      }),
      localFree: vi.fn(() => 1n as NativePtr),
    })
    /** 中文说明：变量 sid 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sid = craftSid(1, 0)
    /** 中文说明：变量 caught 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let caught: unknown
    try {
      revokeWrite(api, 'C:\\granted', sid)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Win32Error)
    expect((caught as Win32Error).api).toBe('LocalFree')
  })
})
