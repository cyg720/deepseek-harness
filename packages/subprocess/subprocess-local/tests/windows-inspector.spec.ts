import { spawnSync as nodeSpawnSync } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import {
  createWindowsProcessInspector,
  isInvalidHandle,
  windowsProcessTree,
  WindowsProcessInspector,
} from '@deepseek-ai/dsh-subprocess-local/src/windows-inspector.ts'
import type {
  NativePtr,
  ProcessEntry,
  WindowsProcessInspectorInternals,
  WindowsProcessState,
} from '@deepseek-ai/dsh-subprocess-local/src/windows-inspector.ts'

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, spawnSync: vi.fn(actual.spawnSync) }
})

function fakeInternals() {
  /** 中文说明：变量 entries 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const entries: ProcessEntry[] = []
  /** 中文说明：变量 states 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const states = new Map<number, WindowsProcessState>()
  /** 中文说明：变量 kills 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const kills: Array<[number, boolean]> = []
  const counts = { enumerations: 0, stateReads: 0 }
  return {
    counts,
    internals: {
      snapshot: () => { counts.enumerations += 1; return [...entries] },
      processState: (pid) => { counts.stateReads += 1; return states.get(pid) },
      taskkill: (pid: number, force: boolean) => { kills.push([pid, force]) },
    } satisfies WindowsProcessInspectorInternals,
    add(entry: ProcessEntry, started?: string, active = true): void {
      entries.push(entry)
      if (started !== undefined) states.set(entry.pid, { started, active })
    },
    kills,
  }
}

describe('WindowsProcessInspector table enumeration', () => {
  it('enumerates the process table only for questions that need it', () => {
    const fake = fakeInternals()
    fake.add({ pid: 10, parentPid: 0 }, 't10')
    fake.add({ pid: 11, parentPid: 10 }, 't11')
    const inspector = new WindowsProcessInspector(fake.internals)

    // Liveness is a per-handle question on Windows, so a snapshot asked only
    // for liveness must not pay a Toolhelp32 walk. The terminal's Windows
    // teardown polls exactly this way, every 25 ms.
    const observed = inspector.snapshot()
    expect(observed.alive({ pid: 11, started: 't11' })).toBe(true)
    expect(fake.counts.enumerations).toBe(0)

    expect(observed.tree(10)).toHaveLength(2)
    expect(fake.counts.enumerations).toBe(1)

    // A second tree question reuses the same observation.
    observed.tree(10)
    expect(fake.counts.enumerations).toBe(1)
  })
})

describe('windowsProcessTree', () => {
  it('walks a table children-first with readable identities only', () => {
    /** 中文说明：函数值 started 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const started = (pid: number): string | undefined => pid === 12 ? undefined : `t${pid}`
    expect(windowsProcessTree([
      { pid: 10, parentPid: 0 },
      { pid: 11, parentPid: 10 },
      { pid: 12, parentPid: 11 },
      { pid: 13, parentPid: 11 },
      { pid: 14, parentPid: 10 },
    ], 10, started)).toEqual([
      { pid: 13, started: 't13' },
      { pid: 11, started: 't11' },
      { pid: 14, started: 't14' },
      { pid: 10, started: 't10' },
    ])
  })

  it('returns an empty walk for an absent root', () => {
    expect(windowsProcessTree([{ pid: 10, parentPid: 0 }], 99, () => 't')).toEqual([])
  })

  it('terminates on a parent cycle instead of recursing forever', () => {
    /** 中文说明：变量 entries 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const entries = [
      { pid: 10, parentPid: 11 },
      { pid: 11, parentPid: 10 },
    ]
    expect(windowsProcessTree(entries, 10, () => 't')).toHaveLength(2)
  })
})

describe('WindowsProcessInspector (injected internals)', () => {
  it('hides the default taskkill helper window for both termination tiers', () => {
    const taskkill = vi.mocked(nodeSpawnSync)
    taskkill.mockReturnValueOnce({} as never).mockReturnValueOnce({} as never)
    const inspector = createWindowsProcessInspector()
    inspector.signalGroup(77, 'SIGKILL')
    inspector.signalGroup(78, 'SIGTERM')
    expect(taskkill).toHaveBeenNthCalledWith(
      1,
      'taskkill',
      ['/PID', '77', '/T', '/F'],
      { stdio: 'ignore', windowsHide: true },
    )
    expect(taskkill).toHaveBeenNthCalledWith(
      2,
      'taskkill',
      ['/PID', '78', '/T'],
      { stdio: 'ignore', windowsHide: true },
    )
  })

  it('exposes the shell pid as the pseudo foreground group and never proves stdin waits', () => {
    /** 中文说明：变量 fake 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fake = fakeInternals()
    /** 中文说明：变量 inspector 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const inspector = new WindowsProcessInspector(fake.internals)
    expect(inspector.foregroundPgid(77)).toBe(77)
    expect(inspector.isStdinWaiting(77, 10)).toBe(false)
    expect(inspector.snapshot().session(77)).toEqual([])
  })

  it('delegates tree walks and identity checks to the internals', () => {
    /** 中文说明：变量 fake 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fake = fakeInternals()
    fake.add({ pid: 10, parentPid: 0 }, 't10')
    fake.add({ pid: 11, parentPid: 10 }, 't11')
    /** 中文说明：变量 inspector 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const inspector = new WindowsProcessInspector(fake.internals)
    expect(inspector.snapshot().tree(10)).toEqual([
      { pid: 11, started: 't11' },
      { pid: 10, started: 't10' },
    ])
    expect(inspector.isAlive({ pid: 11, started: 't11' })).toBe(true)
    expect(inspector.isAlive({ pid: 11, started: 'stale' })).toBe(false)
    expect(inspector.isAlive({ pid: 99, started: 't99' })).toBe(false)

    fake.add({ pid: 12, parentPid: 10 }, 't12', false)
    expect(inspector.isAlive({ pid: 12, started: 't12' })).toBe(false)
  })

  it('maps SIGKILL to a forced taskkill and other signals to the grace form', () => {
    /** 中文说明：变量 fake 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fake = fakeInternals()
    /** 中文说明：变量 inspector 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const inspector = new WindowsProcessInspector(fake.internals)
    inspector.signalGroup(77, 'SIGKILL')
    inspector.signalGroup(77, 'SIGTERM')
    inspector.signalGroup(0, 'SIGKILL')
    expect(fake.kills).toEqual([[77, true], [77, false], [0, true]])
  })

  it('signals a process only while its start identity matches', () => {
    /** 中文说明：变量 fake 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fake = fakeInternals()
    fake.add({ pid: 10, parentPid: 0 }, 't10')
    fake.add({ pid: 11, parentPid: 10 }, 't11', false)
    /** 中文说明：变量 inspector 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const inspector = new WindowsProcessInspector(fake.internals)
    inspector.signalProcess({ pid: 10, started: 't10' }, 'SIGKILL')
    inspector.signalProcess({ pid: 11, started: 't11' }, 'SIGKILL')
    inspector.signalProcess({ pid: 10, started: 'stale' }, 'SIGTERM')
    expect(fake.kills).toEqual([[10, true]])
  })

  it('accepts an injected internals factory through the creator', () => {
    /** 中文说明：变量 fake 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fake = fakeInternals()
    expect(createWindowsProcessInspector(fake.internals)).toBeInstanceOf(WindowsProcessInspector)
    expect(createWindowsProcessInspector()).toBeInstanceOf(WindowsProcessInspector)
  })
})

describe('isInvalidHandle', () => {
  it('rejects null, zero, and the all-ones INVALID_HANDLE_VALUE forms', () => {
    /** 中文说明：函数值 ptr 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const ptr = (value: bigint): NativePtr => value as NativePtr
    expect(isInvalidHandle(null)).toBe(true)
    expect(isInvalidHandle(undefined)).toBe(true)
    expect(isInvalidHandle(ptr(0n))).toBe(true)
    expect(isInvalidHandle(ptr(0xFFFFFFFFFFFFFFFFn))).toBe(true)
    expect(isInvalidHandle(ptr(-1n))).toBe(true)
    expect(isInvalidHandle(ptr(1234n))).toBe(false)
  })
})

/** 中文说明：变量 win32 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const win32 = process.platform === 'win32' ? describe : describe.skip

win32('WindowsProcessInspector over the real koffi bindings', () => {
  it('walks the live process table from the test runner itself', () => {
    /** 中文说明：变量 inspector 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const inspector = createWindowsProcessInspector()
    const tree = inspector.snapshot().tree(process.pid)
    const self = tree.find(member => member.pid === process.pid)
    expect(self).toBeDefined()
    expect(inspector.snapshot().alive(self!)).toBe(true)
    expect(inspector.foregroundPgid(process.pid)).toBe(process.pid)
  })

  it('reports unreadable identities for absent processes and no-ops tree signalling', () => {
    /** 中文说明：变量 inspector 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const inspector = createWindowsProcessInspector()
    expect(inspector.isAlive({ pid: 0x7FFFFFFF, started: 'absent' })).toBe(false)
    expect(() => { inspector.signalGroup(0x7FFFFFFF, 'SIGKILL') }).not.toThrow()
    expect(() => { inspector.signalGroup(0x7FFFFFFF, 'SIGTERM') }).not.toThrow()
    expect(() => { inspector.signalGroup(0, 'SIGKILL') }).not.toThrow()
    expect(() => { inspector.signalProcess({ pid: 0x7FFFFFFF, started: 'absent' }, 'SIGKILL') }).not.toThrow()
  })
})
