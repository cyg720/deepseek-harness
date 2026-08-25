/**
 * AclWriteGrant failure-path tests with stub binding tables (the
 * failure-paths.spec.ts pattern): create fails closed on SID-parse failure,
 * dispose aggregates revocation and SID-free failures into an
 * AggregateError. Pure stubs — no real Win32 calls, so these run on every
 * platform; the real-FFI round-trip lives in grant.spec.ts (win32 only).
 */
/*
 * 文件职责：验证 grant-failure-paths.spec.ts 覆盖的沙箱安全与权限隔离行为与失败场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件上下文和受控系统资源。
 * 产品维度：保障 Agent 使用沙箱安全与权限隔离时得到稳定且可诊断的结果。
 * 逻辑维度：准备配置与资源，触发被测流程，再核对结果、事件、错误和清理。
 * 关键边界：平台能力可能不同；持久化数据和外部输入不可信；异步资源必须完全释放。
 * 新手阅读建议：先读辅助函数和平台条件，再看正常路径，最后阅读恢复与失败用例。
 */

import { describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import koffi from 'koffi'

import type { NativePtr, Win32Bindings } from '../src/ffi.ts'
import { AclWriteGrant } from '../src/index.ts'

/** 中文说明：常量 PVOID 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const PVOID = koffi.pointer('void')

/** The stub the grant-then-fail-revoke sequence needs: every call succeeds until the DACL read is flipped off. */
/* 中文说明：函数 grantThenFailApi 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function grantThenFailApi(): { api: Win32Bindings; failReads: () => void } {
  /** 中文说明：变量 state 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const state = { failReads: false }
  /** 中文说明：变量 api 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const api = {
    convertStringSidToSidW: vi.fn((_sid: string, slot: NativePtr) => {
      koffi.encode(slot, PVOID, 42n)
      return 1
    }),
    getTempPathW: vi.fn((_length: number, buffer: Buffer) => {
      /** 中文说明：变量 temp 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const temp = tmpdir().endsWith('/') || tmpdir().endsWith('\\') ? tmpdir() : `${tmpdir()}/`
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
      if (state.failReads) return 2 // ERROR_FILE_NOT_FOUND — the revoke's read fails
      koffi.encode(dacl, PVOID, 0n) // no explicit DACL: the merge builds one
      koffi.encode(descriptor, PVOID, 0n)
      return 0
    }),
    setEntriesInAclW: vi.fn((_count: unknown, _entries: unknown, _old: unknown, newAcl: NativePtr) => {
      koffi.encode(newAcl, PVOID, 9n)
      return 0
    }),
    setNamedSecurityInfoW: vi.fn(() => 0),
    localFree: vi.fn(() => 0n),
    getLastError: vi.fn(() => 2),
    formatMessageW: vi.fn(() => 0),
  } as unknown as Win32Bindings
  return { api, failReads: () => { state.failReads = true } }
}

describe('AclWriteGrant failure paths', () => {
  it('create fails closed: a SID parse failure throws before anything is granted', () => {
    /** 中文说明：变量 api 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const api = {
      convertStringSidToSidW: vi.fn(() => 0),
      getLastError: vi.fn(() => 87),
      formatMessageW: vi.fn(() => 0),
    } as unknown as Win32Bindings
    expect(() => AclWriteGrant.create('S-1-4-abc-1', api)).toThrow(/ConvertStringSidToSidW/)
  })

  it('create fails closed: a null SID pointer is rejected', () => {
    /** 中文说明：变量 api 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const api = {
      convertStringSidToSidW: vi.fn((_sid: string, slot: NativePtr) => {
        koffi.encode(slot, PVOID, 0n)
        return 1
      }),
      getLastError: vi.fn(() => 87),
      formatMessageW: vi.fn(() => 0),
    } as unknown as Win32Bindings
    expect(() => AclWriteGrant.create('S-1-4-42-42', api)).toThrow(/null SID/)
  })

  it('dispose aggregates a failing revocation into an AggregateError (best-effort cleanup)', () => {
    const { api, failReads } = grantThenFailApi()
    /** 中文说明：变量 grant 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const grant = AclWriteGrant.create('S-1-4-42-42', api)
    grant.add('C:\\granted')
    expect(grant.paths).toEqual(['C:\\granted'])
    failReads()
    expect(() =>{  grant.dispose() }).toThrow(AggregateError)
  })

  it('dispose aggregates a failing SID free into an AggregateError', () => {
    /** 中文说明：变量 api 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const api = {
      convertStringSidToSidW: vi.fn((_sid: string, slot: NativePtr) => {
        koffi.encode(slot, PVOID, 42n)
        return 1
      }),
      localFree: vi.fn(() => 1n), // non-NULL: LocalFree "failed"
      getLastError: vi.fn(() => 87),
      formatMessageW: vi.fn(() => 0),
    } as unknown as Win32Bindings
    /** 中文说明：变量 grant 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const grant = AclWriteGrant.create('S-1-4-42-42', api)
    expect(() =>{  grant.dispose() }).toThrow(AggregateError)
  })
})
