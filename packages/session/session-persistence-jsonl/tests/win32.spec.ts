/**
 * Unit tests for the Windows durable namespace helper with a mocked kernel32
 * binding. The real JSONL suite exercises the helper on native Windows; these
 * tests keep the Win32 error mapping and race handling covered on every host.
 */
/*
 * 文件职责：验证 win32.spec.ts 覆盖的会话持久化行为、持久化与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、事件日志、SQLite 或 OpenTelemetry。
 * 产品维度：保障 Agent 的会话持久化状态稳定、可重放且可诊断。
 * 逻辑维度：准备或解析会话数据，执行核心流程，再处理结果、错误与资源清理。
 * 关键边界：持久化和遥测输入不可信；敏感数据必须脱敏；事件与数据库资源必须正确收尾。
 * 新手阅读建议：先看数据类型和辅助函数，再读写入/投影主流程，最后关注恢复、脱敏和失败场景。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** 中文说明：常量 MOVEFILE_WRITE_THROUGH 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const MOVEFILE_WRITE_THROUGH = 0x00000008
/** 中文说明：常量 ERROR_FILE_NOT_FOUND 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const ERROR_FILE_NOT_FOUND = 2
/** 中文说明：常量 ERROR_PATH_NOT_FOUND 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const ERROR_PATH_NOT_FOUND = 3
/** 中文说明：常量 ERROR_ACCESS_DENIED 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const ERROR_ACCESS_DENIED = 5
/** 中文说明：常量 ERROR_NOT_SAME_DEVICE 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const ERROR_NOT_SAME_DEVICE = 17
/** 中文说明：常量 ERROR_FILE_EXISTS 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const ERROR_FILE_EXISTS = 80
/** 中文说明：常量 ERROR_INVALID_NAME 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const ERROR_INVALID_NAME = 123
/** 中文说明：常量 ERROR_ALREADY_EXISTS 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const ERROR_ALREADY_EXISTS = 183

/** 中文说明：type MoveFileExW 定义本测试所需的数据或行为，用于表达会话持久化场景。 */
type MoveFileExW = (existing: string, replacement: string, flags: number, setLastError: (code: number) => void) => number

/** 中文说明：变量 roots 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const roots: string[] = []

/** 中文说明：函数 stripNamespace 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function stripNamespace(path: string): string {
  if (path.startsWith('\\\\?\\UNC\\')) return `\\\\${path.slice('\\\\?\\UNC\\'.length)}`
  if (path.startsWith('\\\\?\\')) return path.slice('\\\\?\\'.length)
  return path
}

/** 中文说明：函数 tempRoot 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function tempRoot(): Promise<string> {
  /** 中文说明：变量 dir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const dir = await mkdtemp(join(tmpdir(), 'dsh-jsonl-win32-'))
  roots.push(dir)
  return dir
}

/** 中文说明：函数 importWithMove 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function importWithMove(moveFileExW: MoveFileExW): Promise<typeof import('../src/win32.ts')> {
  vi.resetModules()
  vi.doMock('koffi', () => {
    /** 中文说明：变量 lastError 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let lastError = 0
    /** 中文说明：函数值 setLastError 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const setLastError = (code: number): void => { lastError = code }
    /** 中文说明：函数值 move 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const move: MoveFileExW = (existing, replacement, flags, setError) => {
      /** 中文说明：变量 ok 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const ok = moveFileExW(existing, replacement, flags, setError)
      lastError = ok === 0 ? lastError : 0
      return ok
    }
    return {
      default: {
        load: () => ({
          func: (_convention: string, name: string, result: string) => {
            if (name === 'MoveFileExW') return (existing: string, replacement: string, flags: number) => {
              expect(result).toBe('int')
              /** 中文说明：变量 ok 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
              const ok = move(existing, replacement, flags, setLastError)
              return ok
            }
            return () => lastError
          },
        }),
      },
    }
  })
  return import('../src/win32.ts')
}

/** 中文说明：函数 importWithError 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function importWithError(code: number): Promise<typeof import('../src/win32.ts')> {
  vi.resetModules()
  vi.doMock('koffi', () => ({
    default: {
      load: () => ({
        func: (_convention: string, name: string) => {
          if (name === 'MoveFileExW') return () => 0
          return () => code
        },
      }),
    },
  }))
  return import('../src/win32.ts')
}

/** 中文说明：函数 importWithFilesystemMove 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function importWithFilesystemMove(): Promise<typeof import('../src/win32.ts')> {
  return importWithMove((existing, replacement, flags, setLastError) => {
    expect(flags).toBe(MOVEFILE_WRITE_THROUGH)
    /** 中文说明：变量 from 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const from = stripNamespace(existing)
    /** 中文说明：变量 to 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const to = stripNamespace(replacement)
    if (!existsSync(from)) { setLastError(ERROR_FILE_NOT_FOUND); return 0 }
    if (existsSync(to)) { setLastError(ERROR_ALREADY_EXISTS); return 0 }
    renameSync(from, to)
    return 1
  })
}

afterEach(async () => {
  vi.doUnmock('koffi')
  vi.doUnmock('node:fs/promises')
  vi.doUnmock('node:path')
  vi.resetModules()
  /** 中文说明：该循环依次处理会话数据；循环变量仅在当前循环中有效。 */
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('Windows durable namespace helpers', () => {
  it('keeps drive-root probes native while namespacing descendants', async () => {
    /** 中文说明：变量 probes 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const probes: string[] = []
    vi.resetModules()
    vi.doMock('node:fs/promises', async (importOriginal) => {
      /** 中文说明：变量 actual 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const actual = await importOriginal<typeof import('node:fs/promises')>()
      return {
        ...actual,
        stat: async (path: string) => {
          probes.push(path)
          return { isDirectory: () => true }
        },
      }
    })
    vi.doMock('node:path', async (importOriginal) => {
      /** 中文说明：变量 actual 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const actual = await importOriginal<typeof import('node:path')>()
      return {
        ...actual,
        join: (...paths: string[]) => actual.win32.join(...paths),
        parse: (path: string) => actual.win32.parse(path),
        resolve: (...paths: string[]) => actual.win32.resolve(...paths),
        toNamespacedPath: (path: string) => actual.win32.toNamespacedPath(path),
      }
    })
    const { ensureDurableDirectoryWin32 } = await import('../src/win32.ts')

    await ensureDurableDirectoryWin32('C:\\existing')

    expect(probes).toEqual(['C:\\', '\\\\?\\C:\\existing'])
  })

  it('publishes a new file with write-through MoveFileExW semantics', async () => {
    const { publishNewFileWin32 } = await importWithFilesystemMove()
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = await tempRoot()
    /** 中文说明：变量 tmp 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const tmp = join(root, 'log.tmp')
    /** 中文说明：变量 final 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const final = join(root, 'log.jsonl')
    await writeFile(tmp, 'content')

    await publishNewFileWin32(tmp, final)
    expect(existsSync(tmp)).toBe(false)
    expect(readFileSync(final, 'utf8')).toBe('content')
  })

  it('maps Win32 publish failures to Node-style errno codes', async () => {
    /** 中文说明：变量 cases 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cases = [
      [ERROR_FILE_NOT_FOUND, 'ENOENT'],
      [ERROR_PATH_NOT_FOUND, 'ENOENT'],
      [ERROR_ACCESS_DENIED, 'EACCES'],
      [ERROR_NOT_SAME_DEVICE, 'EXDEV'],
      [ERROR_FILE_EXISTS, 'EEXIST'],
      [ERROR_ALREADY_EXISTS, 'EEXIST'],
      [ERROR_INVALID_NAME, 'EINVAL'],
      [9999, 'EIO'],
    ] as const
    /** 中文说明：该循环依次处理会话数据；循环变量仅在当前循环中有效。 */
    for (const [win32Code, code] of cases) {
      const { publishNewFileWin32 } = await importWithError(win32Code)
      await expect(publishNewFileWin32('from', 'to')).rejects.toMatchObject({ code, win32Code, path: 'from', dest: 'to' })
    }
  })

  it('creates missing directories through staging siblings and tolerates an already-created race', async () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = await tempRoot()
    /** 中文说明：变量 raced 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const raced = join(root, 'raced')
    const { ensureDurableDirectoryWin32 } = await importWithMove((existing, replacement, flags, setLastError) => {
      expect(flags).toBe(MOVEFILE_WRITE_THROUGH)
      /** 中文说明：变量 from 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const from = stripNamespace(existing)
      /** 中文说明：变量 to 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const to = stripNamespace(replacement)
      if (to === raced) {
        mkdirSync(to)
        setLastError(ERROR_ALREADY_EXISTS)
        return 0
      }
      if (!existsSync(from)) { setLastError(ERROR_FILE_NOT_FOUND); return 0 }
      if (existsSync(to)) { setLastError(ERROR_ALREADY_EXISTS); return 0 }
      renameSync(from, to)
      return 1
    })

    await ensureDurableDirectoryWin32(join(root, 'a', 'b'))
    expect(existsSync(join(root, 'a', 'b'))).toBe(true)
    await ensureDurableDirectoryWin32(join(root, 'a', 'b'))
    await ensureDurableDirectoryWin32(raced)
    expect(existsSync(raced)).toBe(true)
  })

  it('keeps staging names valid for a maximum-length target component', async () => {
    const { ensureDurableDirectoryWin32 } = await importWithFilesystemMove()
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = await tempRoot()
    /** 中文说明：变量 target 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const target = join(root, 'x'.repeat(255))

    await ensureDurableDirectoryWin32(target)
    expect(existsSync(target)).toBe(true)
  })

  it('surfaces directory publication failures other than an existing-target race', async () => {
    const { ensureDurableDirectoryWin32 } = await importWithError(ERROR_ACCESS_DENIED)
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = await tempRoot()

    await expect(ensureDurableDirectoryWin32(join(root, 'denied'))).rejects.toMatchObject({ code: 'EACCES' })
  })

  it('rejects a non-directory component instead of treating it as missing', async () => {
    const { ensureDurableDirectoryWin32 } = await importWithFilesystemMove()
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = await tempRoot()
    /** 中文说明：变量 blocked 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const blocked = join(root, 'blocked')
    writeFileSync(blocked, 'x')

    await expect(ensureDurableDirectoryWin32(join(blocked, 'child'))).rejects.toMatchObject({ code: 'ENOTDIR' })
  })
})

async function importWithLock(bindings: {
  createSemaphoreW?: (name: string, initial: number, maximum: number) => number
  waitResult?: number
  releaseSemaphore?: (handle: number) => number
  closeHandle?: (handle: number) => number
  lastError?: number
}): Promise<typeof import('../src/win32.ts')> {
  vi.resetModules()
  vi.doMock('koffi', () => ({
    default: {
      load: () => ({
        func: (_convention: string, name: string) => {
          if (name === 'CreateSemaphoreW') {
            return (_security: null, initial: number, maximum: number, semName: string) =>
              (bindings.createSemaphoreW ?? (() => 7))(semName, initial, maximum)
          }
          if (name === 'WaitForSingleObject') return () => bindings.waitResult ?? 0
          if (name === 'ReleaseSemaphore') return bindings.releaseSemaphore ?? (() => 1)
          if (name === 'CloseHandle') return bindings.closeHandle ?? (() => 1)
          if (name === 'MoveFileExW') return () => 1
          return () => bindings.lastError ?? 0 // GetLastError
        },
      }),
    },
  }))
  return import('../src/win32.ts')
}

describe('Windows write-lock semaphore', () => {
  it('acquires a path-derived named semaphore with a zero-timeout wait', async () => {
    const created: Array<{ name: string; initial: number; maximum: number }> = []
    const { acquireLockHandleWin32 } = await importWithLock({
      createSemaphoreW: (name, initial, maximum) => {
        created.push({ name, initial, maximum })
        return 7
      },
    })
    await expect(acquireLockHandleWin32('C:\\s\\session.lock')).resolves.toBe(7)
    expect(created).toHaveLength(1)
    // Count-1 semaphore in the login-session namespace, named by path hash:
    // no filesystem footprint, and case-insensitive like Windows paths.
    expect(created[0]).toMatchObject({ initial: 1, maximum: 1 })
    expect(created[0]?.name).toMatch(/^Local\\dsh-session-lock-[0-9a-f]{64}$/)
    const upper = await importWithLock({ createSemaphoreW: (name) => { created.push({ name, initial: 1, maximum: 1 }); return 7 } })
    await upper.acquireLockHandleWin32('C:\\S\\SESSION.LOCK')
    expect(created[1]?.name).toBe(created[0]?.name)
  })

  it('maps a held semaphore (wait timeout) to EBUSY and closes the probe handle', async () => {
    const closed: number[] = []
    const { acquireLockHandleWin32 } = await importWithLock({
      waitResult: 0x102,
      closeHandle: (handle) => { closed.push(handle); return 1 },
    })
    await expect(acquireLockHandleWin32('C:\\s\\session.lock')).rejects.toMatchObject({ code: 'EBUSY' })
    expect(closed).toEqual([7])
  })

  it('surfaces create and wait failures with Win32 codes', async () => {
    const createFailed = await importWithLock({ createSemaphoreW: () => 0, lastError: 5 })
    await expect(createFailed.acquireLockHandleWin32('C:\\s\\session.lock')).rejects.toMatchObject({ code: 'EACCES', win32Code: 5 })
    const waitFailed = await importWithLock({ waitResult: 0xffffffff, lastError: 5 })
    await expect(waitFailed.acquireLockHandleWin32('C:\\s\\session.lock')).rejects.toMatchObject({ code: 'EACCES', win32Code: 5 })
  })

  it('releases by restoring the count and closing, surfacing a failed release', async () => {
    const order: string[] = []
    const working = await importWithLock({
      releaseSemaphore: (handle) => { order.push(`release:${handle}`); return 1 },
      closeHandle: (handle) => { order.push(`close:${handle}`); return 1 },
    })
    await working.releaseLockHandleWin32(7)
    expect(order).toEqual(['release:7', 'close:7'])
    const failing = await importWithLock({ releaseSemaphore: () => 0, lastError: 5 })
    await expect(failing.releaseLockHandleWin32(9)).rejects.toMatchObject({ code: 'EACCES', win32Code: 5 })
  })
})
