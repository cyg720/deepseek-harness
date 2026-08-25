/**
 * FFI helper tests with stub binding tables (the failure-paths.spec.ts
 * pattern): error formatting and temp-path decoding defenses, the
 * last-error throwers' detail fallback, pointer decode NULL handling, and
 * the bounded SID comparison's early exits. Pure stubs — no real Win32
 * calls, so these run on every platform; the real-FFI round-trip lives in
 * acl.spec.ts and probe.spec.ts (win32 only).
 */
/**
 * 文件职责：验证 ffi.spec.ts 覆盖的沙箱安全与权限隔离行为与失败场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件上下文和受控系统资源。
 * 产品维度：保障 Agent 使用沙箱安全与权限隔离时得到稳定且可诊断的结果。
 * 逻辑维度：准备配置与资源，触发被测流程，再核对结果、事件、错误和清理。
 * 关键边界：平台能力可能不同；持久化数据和外部输入不可信；异步资源必须完全释放。
 * 新手阅读建议：先读辅助函数和平台条件，再看正常路径，最后阅读恢复与失败用例。
 */

import { describe, expect, it, vi } from 'vitest'
import koffi from 'koffi'

import { Win32Error } from '../src/errors.ts'
import {
  allocBytes, decodePtr, decodePtrAt, errorText, getTempPath,
  isInvalidHandle, isNullPtr, sameSidAt, throwLastError, throwWin32,
} from '../src/ffi.ts'
import type { NativePtr, Win32Bindings } from '../src/ffi.ts'
import * as abi from '../src/win32-abi.ts'

/** 中文说明：常量 PVOID 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const PVOID = koffi.pointer('void')

/** A stub whose formatMessageW writes real UTF-16 text (the errorText round-trip). */
/** 中文说明：函数 formatApi 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function formatApi(): { api: Win32Bindings; formatMessageW: ReturnType<typeof vi.fn> } {
  /** 中文说明：函数值 formatMessageW 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  const formatMessageW = vi.fn((_flags: number, _source: null, _id: number, _lang: number, buffer: Buffer, _size: number, _args: null) => {
    /** 中文说明：变量 text 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const text = 'access denied'
    buffer.write(text, 'utf16le')
    return text.length
  })
  /** 中文说明：变量 api 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const api = {
    formatMessageW,
    getLastError: vi.fn(() => 5),
  } as unknown as Win32Bindings
  return { api, formatMessageW }
}

/** A minimal SID allocation: revision@0, subAuthorityCount@1, identifierAuthority@2, subauthorities@8. */
/** 中文说明：函数 craftSid 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function craftSid(revision: number, count: number, authority: number[] = [0, 0, 0, 0, 0, 0], subs: number[] = []): NativePtr {
  /** 中文说明：变量 sid 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const sid = allocBytes(8 + subs.length * 4)
  koffi.encode(sid, 'uint8', revision)
  koffi.encode(sid, 1, 'uint8', count)
  authority.forEach((byte, index) => {
    koffi.encode(sid, 2 + index, 'uint8', byte)
  })
  subs.forEach((sub, index) => {
    koffi.encode(sid, 8 + index * 4, 'uint32', sub)
  })
  return sid
}

describe('errorText', () => {
  it('decodes the formatted UTF-16 message and trims it', () => {
    const { api } = formatApi()
    expect(errorText(api, 5)).toBe('access denied')
  })

  it('returns an empty string when FormatMessageW formats nothing', () => {
    /** 中文说明：函数值 api 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const api = { formatMessageW: vi.fn(() => 0) } as unknown as Win32Bindings
    expect(errorText(api, 5)).toBe('')
  })
})

describe('getTempPath', () => {
  it('decodes the NUL-terminated temp path GetTempPathW wrote', () => {
    /** 中文说明：变量 api 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const api = {
      getTempPathW: vi.fn((_length: number, buffer: Buffer) => {
        buffer.write('C:\\TEMP', 'utf16le')
        return 7
      }),
    } as unknown as Win32Bindings
    expect(getTempPath(api)).toBe('C:\\TEMP')
  })

  it('reports the Win32 failure when GetTempPathW writes nothing', () => {
    const { api } = formatApi()
    /** 中文说明：函数值 failing 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const failing = { ...api, getTempPathW: vi.fn(() => 0) } as Win32Bindings
    /** 中文说明：变量 caught 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let caught: unknown
    try {
      getTempPath(failing)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Win32Error)
    expect((caught as Win32Error).api).toBe('GetTempPathW')
  })
})

describe('throwLastError and throwWin32', () => {
  it('throwLastError formats the system message when no detail is given', () => {
    const { api } = formatApi()
    /** 中文说明：变量 caught 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let caught: unknown
    try {
      throwLastError(api, 'Probe')
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Win32Error)
    expect((caught as Win32Error).message).toContain('Probe failed (Win32 5): access denied')
  })

  it('throwWin32 formats the system message when no detail is given', () => {
    const { api } = formatApi()
    /** 中文说明：变量 caught 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let caught: unknown
    try {
      throwWin32(api, 'Probe', 5)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Win32Error)
    expect((caught as Win32Error).message).toContain('Probe failed (Win32 5): access denied')
  })

  it('Win32Error appends the detail when one is given', () => {
    /** 中文说明：变量 error 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const error = new Win32Error('Probe', 5, 'the lock file path')
    expect(error.name).toBe('Win32Error')
    expect(error.api).toBe('Probe')
    expect(error.win32Code).toBe(5)
    expect(error.message).toBe('Probe failed (Win32 5): the lock file path')
  })

  it('Win32Error omits the detail suffix when none is given', () => {
    /** 中文说明：变量 error 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const error = new Win32Error('Probe', 5)
    expect(error.message).toBe('Probe failed (Win32 5)')
  })
})

describe('pointer NULL handling', () => {
  it('isNullPtr accepts null, undefined, and the zero pointer', () => {
    expect(isNullPtr(null)).toBe(true)
    expect(isNullPtr(undefined)).toBe(true)
    expect(isNullPtr(0n as NativePtr)).toBe(true)
    expect(isNullPtr(42n as NativePtr)).toBe(false)
  })

  it('isInvalidHandle treats NULL as failure', () => {
    expect(isInvalidHandle(null)).toBe(true)
    expect(isInvalidHandle(undefined)).toBe(true)
    expect(isInvalidHandle(0n as NativePtr)).toBe(true)
    expect(isInvalidHandle(42n as NativePtr)).toBe(false)
  })

  it('decodePtrAt returns null for a NULL pointer stored in a buffer', () => {
    /** 中文说明：变量 buffer 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const buffer = Buffer.alloc(8)
    buffer.writeBigUInt64LE(0n, 0)
    expect(decodePtrAt(buffer, 0)).toBeNull()
  })

  it('decodePtrAt returns the stored pointer value', () => {
    /** 中文说明：变量 buffer 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const buffer = Buffer.alloc(8)
    buffer.writeBigUInt64LE(42n, 0)
    expect(decodePtrAt(buffer, 0)).toBe(42n)
  })

  it('decodePtr returns null for an unset out-parameter slot', () => {
    /** 中文说明：变量 slot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const slot = koffi.alloc(PVOID, 1) as unknown as NativePtr
    expect(decodePtr(slot)).toBeNull()
  })
})

describe('sameSidAt bounded comparison', () => {
  it('rejects a revision mismatch before comparing anything else', () => {
    /** 中文说明：变量 left 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const left = craftSid(1, 0)
    /** 中文说明：变量 right 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const right = craftSid(2, 0)
    expect(sameSidAt(left, 0, right, 0)).toBe(false)
  })

  it('rejects a subauthority-count mismatch', () => {
    /** 中文说明：变量 left 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const left = craftSid(1, 1, [0, 0, 0, 0, 0, 5], [42])
    /** 中文说明：变量 right 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const right = craftSid(1, 2, [0, 0, 0, 0, 0, 5], [42, 43])
    expect(sameSidAt(left, 0, right, 0)).toBe(false)
  })

  it('rejects an implausible subauthority count', () => {
    /** 中文说明：变量 left 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const left = craftSid(1, abi.SID_MAX_SUB_AUTHORITIES + 1)
    /** 中文说明：变量 right 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const right = craftSid(1, abi.SID_MAX_SUB_AUTHORITIES + 1)
    expect(sameSidAt(left, 0, right, 0)).toBe(false)
  })

  it('rejects a differing identifier authority byte', () => {
    /** 中文说明：变量 left 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const left = craftSid(1, 0, [0, 0, 0, 0, 0, 5])
    /** 中文说明：变量 right 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const right = craftSid(1, 0, [0, 0, 0, 0, 0, 6])
    expect(sameSidAt(left, 0, right, 0)).toBe(false)
  })

  it('accepts identical SIDs at nonzero offsets over differing leading bytes', () => {
    /** 中文说明：变量 sid 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sid = craftSid(1, 1, [0, 0, 0, 0, 0, 5], [42])
    // Embed the same SID bytes at offset 4 of two buffers whose first four
    // bytes differ: an offset-ignoring comparison reads the differing
    // prefixes and must reject.
    /** 中文说明：变量 left 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const left = allocBytes(4 + 12)
    /** 中文说明：变量 right 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const right = allocBytes(4 + 12)
    koffi.encode(left, 0, 'uint32', 0x11111111)
    koffi.encode(right, 0, 'uint32', 0x22222222)
    /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
    for (let offset = 0; offset < 12; offset++) {
      /** 中文说明：变量 byte 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const byte = koffi.decode(sid, offset, 'uint8') as number
      koffi.encode(left, 4 + offset, 'uint8', byte)
      koffi.encode(right, 4 + offset, 'uint8', byte)
    }
    expect(sameSidAt(left, 4, right, 4)).toBe(true)
    expect(sameSidAt(left, 0, right, 0)).toBe(false) // the differing prefixes are not a matching SID
  })
})
