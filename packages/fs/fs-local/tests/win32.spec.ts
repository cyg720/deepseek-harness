/** Host-independent binding tests for the Win32 DACL and replacement helpers. */
/*
 * 文件职责：验证文件系统与工具的 win32.spec.ts 行为与安全边界。
 * 技术维度：TypeScript、Cordis、会话事件、路径策略、判别联合和 Vitest。
 * 产品维度：保证文件系统与工具操作可预测、可审计并在失败时保持一致。
 * 逻辑维度：构造请求与状态，驱动服务并断言输出和清理。
 * 关键边界：文件路径必须经过策略检查；目标引用含版本，过期修改必须拒绝。
 * 新手阅读建议：先读类型与测试夹具，再按校验、执行、事件折叠和错误流程阅读。
 */

import { toNamespacedPath } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

/** 中文说明：类型或类 GetFileSecurityW 约束文件或目标数据职责。 */
type GetFileSecurityW = (
  path: string,
  requestedInformation: number,
  descriptor: Buffer | null,
  length: number,
  needed: [number],
) => number
/** 中文说明：类型或类 SetFileSecurityW 约束文件或目标数据职责。 */
type SetFileSecurityW = (path: string, securityInformation: number, descriptor: Buffer) => number
/** 中文说明：类型或类 ReplaceFileW 约束文件或目标数据职责。 */
type ReplaceFileW = (
  replaced: string,
  replacement: string,
  backup: null,
  flags: number,
  exclude: null,
  reserved: null,
) => number

/** 中文说明：类型或类 NativeMock 约束文件或目标数据职责。 */
interface NativeMock {
  getFileSecurityW: GetFileSecurityW
  setFileSecurityW: SetFileSecurityW
  replaceFileW: ReplaceFileW
  getLastError: () => number
}

/** 中文说明：函数 importWithNative 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function importWithNative(native: NativeMock): Promise<typeof import('../src/win32.ts')> {
  vi.resetModules()
  vi.doMock('koffi', () => ({
    default: {
      load: () => ({
        func: (definition: string) => {
          if (definition.includes('GetFileSecurityW')) return native.getFileSecurityW
          if (definition.includes('SetFileSecurityW')) return native.setFileSecurityW
          if (definition.includes('ReplaceFileW')) return native.replaceFileW
          if (definition.includes('GetLastError')) return native.getLastError
          throw new Error(`unexpected native function: ${definition}`)
        },
      }),
    },
  }))
  return import('../src/win32.ts')
}

/** 中文说明：函数 successfulNative 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function successfulNative(descriptor: Buffer): NativeMock & { installed: Buffer[]; replacements: string[][] } {
  /** 中文说明：测试局部值 lastError，由紧邻初始化决定。 */
  let lastError = 0
  /** 中文说明：测试局部值 installed，由紧邻初始化决定。 */
  const installed: Buffer[] = []
  /** 中文说明：测试局部值 replacements，由紧邻初始化决定。 */
  const replacements: string[][] = []
  return {
    installed,
    replacements,
    getLastError: () => lastError,
    getFileSecurityW: (_path, _requested, output, _length, needed) => {
      needed[0] = descriptor.length
      if (output === null) {
        lastError = 122
        return 0
      }
      descriptor.copy(output)
      lastError = 0
      return 1
    },
    setFileSecurityW: (_path, information, value) => {
      expect(information).toBe(0x80000004)
      installed.push(Buffer.from(value))
      lastError = 0
      return 1
    },
    replaceFileW: (replaced, replacement, backup, flags, exclude, reserved) => {
      expect([backup, flags, exclude, reserved]).toEqual([null, 0, null, null])
      replacements.push([replaced, replacement])
      lastError = 0
      return 1
    },
  }
}

afterEach(() => {
  vi.doUnmock('koffi')
  vi.resetModules()
})

describe('Windows file-security helpers', () => {
  it('reads and installs a protected DACL before replacing the destination', async () => {
    /** 中文说明：测试局部值 descriptor，由紧邻初始化决定。 */
    const descriptor = Buffer.from([1, 2, 3, 4])
    /** 中文说明：测试局部值 native，由紧邻初始化决定。 */
    const native = successfulNative(descriptor)
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    const { copyFileDaclWin32, readFileDaclWin32, replaceFileWin32 } = await importWithNative(native)

    expect(await readFileDaclWin32('source')).toEqual(descriptor)
    await copyFileDaclWin32('source', 'temp')
    expect(native.installed).toEqual([descriptor])
    await replaceFileWin32('target', 'temp')
    expect(native.replacements).toEqual([[toNamespacedPath('target'), toNamespacedPath('temp')]])
  })

  it('maps descriptor-size probe failures to Node-style codes', async () => {
    /** 中文说明：测试局部值 cases，由紧邻初始化决定。 */
    const cases = [[2, 'ENOENT'], [3, 'ENOENT'], [5, 'EACCES'], [9999, 'EIO']] as const
    /** 中文说明：测试局部值 [win32Code，由紧邻初始化决定。 */
    for (const [win32Code, code] of cases) {
      /** 中文说明：测试局部值 native，由紧邻初始化决定。 */
      const native = successfulNative(Buffer.from([1]))
      native.getFileSecurityW = (_path, _requested, _output, _length, needed) => {
        needed[0] = 0
        return 0
      }
      native.getLastError = () => win32Code
      /** 中文说明：测试局部值 { readFileDaclWin32 }，由紧邻初始化决定。 */
      const { readFileDaclWin32 } = await importWithNative(native)
      await expect(readFileDaclWin32('source')).rejects.toMatchObject({ code, win32Code, path: 'source' })
    }
  })

  it('surfaces a descriptor read failure after the size probe', async () => {
    /** 中文说明：测试局部值 native，由紧邻初始化决定。 */
    const native = successfulNative(Buffer.from([1, 2]))
    native.getFileSecurityW = (_path, _requested, _output, _length, needed) => {
      needed[0] = 2
      return 0
    }
    native.getLastError = () => 5
    /** 中文说明：测试局部值 { readFileDaclWin32 }，由紧邻初始化决定。 */
    const { readFileDaclWin32 } = await importWithNative(native)

    await expect(readFileDaclWin32('source')).rejects.toMatchObject({ code: 'EACCES', syscall: 'GetFileSecurityW' })
  })

  it('surfaces DACL installation and replacement failures', async () => {
    /** 中文说明：测试局部值 setFailure，由紧邻初始化决定。 */
    const setFailure = successfulNative(Buffer.from([1]))
    setFailure.setFileSecurityW = () => 0
    setFailure.getLastError = () => 5
    /** 中文说明：测试局部值 setModule，由紧邻初始化决定。 */
    const setModule = await importWithNative(setFailure)
    await expect(setModule.copyFileDaclWin32('source', 'temp')).rejects.toMatchObject({
      code: 'EACCES',
      syscall: 'SetFileSecurityW',
      path: 'temp',
    })

    /** 中文说明：测试局部值 replaceFailure，由紧邻初始化决定。 */
    const replaceFailure = successfulNative(Buffer.from([1]))
    replaceFailure.replaceFileW = () => 0
    replaceFailure.getLastError = () => 2
    /** 中文说明：测试局部值 replaceModule，由紧邻初始化决定。 */
    const replaceModule = await importWithNative(replaceFailure)
    await expect(replaceModule.replaceFileWin32('target', 'temp')).rejects.toMatchObject({
      code: 'ENOENT',
      syscall: 'ReplaceFileW',
      path: 'target',
    })
  })
})
