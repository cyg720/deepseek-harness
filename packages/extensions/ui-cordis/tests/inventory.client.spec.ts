// The inventory store: how the panel's rows arrive, what a failed read leaves
// behind, and why a read is single-flight.
/**
 * 文件职责：验证Cordis 扩展界面的 inventory.client.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis Context、插件生命周期、React 和 Vitest。
 * 产品维度：保证Cordis 扩展界面在配置、运行、失败和清理场景中可理解且可靠。
 * 逻辑维度：构造插件或沙箱，驱动操作并断言日志与清理。
 * 关键边界：沙箱与宿主 Context 不可混用；反馈追加新记录，不改写既有会话历史。
 * 新手阅读建议：先读类型和夹具，再按注册、执行、错误与卸载流程阅读。
 */

import { describe, expect, it, vi } from 'vitest'
import { createCordisInventory } from '../src/client/inventory.ts'
import type { CordisDynamicPort, CordisInventoryRow } from '../src/client/dynamic-port.ts'

/** 中文说明：测试局部值 ROW，由紧邻初始化决定。 */
const ROW = {
  id: 'dyn-1', name: 'clock', purpose: '顶栏时钟', agentId: 'sess-1', running: true,
} as unknown as CordisInventoryRow

/** A port whose inventory answer the test controls. */
/* 中文说明：函数 port 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function port(answer: () => Promise<readonly CordisInventoryRow[]>): { port: CordisDynamicPort; reads: () => number } {
  /** 中文说明：测试局部值 reads，由紧邻初始化决定。 */
  let reads = 0
  return {
    port: {
      inventory: () => { reads += 1; return answer() },
      stop: () => Promise.reject(new Error('unused')),
      remove: () => Promise.reject(new Error('unused')),
    },
    reads: () => reads,
  }
}

describe('reading the registry', () => {
  it('starts unread, then publishes the rows', async () => {
    /** 中文说明：测试局部值 seam，由紧邻初始化决定。 */
    const seam = port(() => Promise.resolve([ROW]))
    /** 中文说明：测试局部值 inventory，由紧邻初始化决定。 */
    const inventory = createCordisInventory(seam.port, vi.fn())
    // Unread is not empty: the panel must not claim "nothing defined" before a
    // read settles.
    expect(inventory.getSnapshot()).toEqual({ rows: [], removed: new Set(), read: false })

    /** 中文说明：测试局部值 seen，由紧邻初始化决定。 */
    const seen = vi.fn()
    /** 中文说明：测试局部值 off，由紧邻初始化决定。 */
    const off = inventory.subscribe(seen)
    inventory.refresh()
    await vi.waitFor(() => { expect(inventory.getSnapshot().read).toBe(true) })
    expect(inventory.getSnapshot().rows).toEqual([ROW])
    expect(seen).toHaveBeenCalled()

    off()
    /** 中文说明：测试局部值 before，由紧邻初始化决定。 */
    const before = seen.mock.calls.length
    inventory.refresh()
    await vi.waitFor(() => { expect(seam.reads()).toBe(2) })
    expect(seen.mock.calls.length).toBe(before)
  })

  it('is single-flight: concurrent triggers read once', async () => {
    /** 中文说明：测试局部值 release，由紧邻初始化决定。 */
    let release: ((rows: readonly CordisInventoryRow[]) => void) | undefined
    /** 中文说明：测试局部值 seam，由紧邻初始化决定。 */
    const seam = port(() => new Promise((resolve) => { release = resolve }))
    /** 中文说明：测试局部值 inventory，由紧邻初始化决定。 */
    const inventory = createCordisInventory(seam.port, vi.fn())
    inventory.refresh()
    inventory.refresh()
    inventory.refresh()
    expect(seam.reads()).toBe(1)
    release?.([ROW])
    await vi.waitFor(() => { expect(inventory.getSnapshot().read).toBe(true) })
    // The slot frees once it settles, so the next trigger reads again.
    inventory.refresh()
    await vi.waitFor(() => { expect(seam.reads()).toBe(2) })
  })

  it('keeps the rows it had when a read fails, and says why', async () => {
    /** 中文说明：测试局部值 fail，由紧邻初始化决定。 */
    let fail = false
    /** 中文说明：测试局部值 seam，由紧邻初始化决定。 */
    const seam = port(() => (fail ? Promise.reject(new Error('socket closed')) : Promise.resolve([ROW])))
    /** 中文说明：测试局部值 onError，由紧邻初始化决定。 */
    const onError = vi.fn()
    /** 中文说明：测试局部值 inventory，由紧邻初始化决定。 */
    const inventory = createCordisInventory(seam.port, onError)
    inventory.refresh()
    await vi.waitFor(() => { expect(inventory.getSnapshot().read).toBe(true) })

    fail = true
    inventory.refresh()
    await vi.waitFor(() => { expect(inventory.getSnapshot().error).toBeDefined() })
    // Dropping the rows would turn a transient wire failure into "nothing is
    // defined", which is a different and wrong statement.
    expect(inventory.getSnapshot().rows).toEqual([ROW])
    expect(inventory.getSnapshot().read).toBe(true)
    expect(inventory.getSnapshot().error).toBe('socket closed')
    expect(onError).toHaveBeenCalled()
  })

  it('reports a non-Error rejection without inventing a message', async () => {
    /** 中文说明：测试局部值 seam，由紧邻初始化决定。 */
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- the non-Error rejection is the scenario.
    const seam = port(() => Promise.reject('nope'))
    /** 中文说明：测试局部值 inventory，由紧邻初始化决定。 */
    const inventory = createCordisInventory(seam.port, vi.fn())
    inventory.refresh()
    await vi.waitFor(() => { expect(inventory.getSnapshot().error).toBeDefined() })
    expect(inventory.getSnapshot().error).toBe('reading the cordis inventory failed')
  })

  it('forgets everything on reset, because the next host may be a new process', async () => {
    /** 中文说明：测试局部值 seam，由紧邻初始化决定。 */
    const seam = port(() => Promise.resolve([ROW]))
    /** 中文说明：测试局部值 inventory，由紧邻初始化决定。 */
    const inventory = createCordisInventory(seam.port, vi.fn())
    inventory.refresh()
    await vi.waitFor(() => { expect(inventory.getSnapshot().read).toBe(true) })
    inventory.reset()
    expect(inventory.getSnapshot()).toEqual({ rows: [], removed: new Set(), read: false })
  })
})

describe('a reconnect while a read is in flight', () => {
  it('discards the previous connection’s answer and lets the fresh read through', async () => {
    // Each read gets its own resolver, so the test can settle the stale one only.
    /** 中文说明：测试局部值 releases，由紧邻初始化决定。 */
    const releases: ((rows: readonly CordisInventoryRow[]) => void)[] = []
    /** 中文说明：测试局部值 seam，由紧邻初始化决定。 */
    const seam = port(() => new Promise((resolve) => { releases.push(resolve) }))
    /** 中文说明：测试局部值 inventory，由紧邻初始化决定。 */
    const inventory = createCordisInventory(seam.port, vi.fn())
    inventory.refresh()
    expect(seam.reads()).toBe(1)

    // The in-flight read belongs to the host we just left; a reset frees the slot
    // so the fresh read is not swallowed by it.
    inventory.reset()
    inventory.refresh()
    expect(seam.reads()).toBe(2)

    // The stale answer arriving late must not repopulate what reset cleared.
    releases[0]?.([ROW])
    await Promise.resolve()
    await Promise.resolve()
    expect(inventory.getSnapshot()).toEqual({ rows: [], removed: new Set(), read: false })

    // The fresh read still lands.
    releases[1]?.([ROW])
    await vi.waitFor(() => { expect(inventory.getSnapshot().read).toBe(true) })
    expect(inventory.getSnapshot().rows).toEqual([ROW])
  })

  it('swallows a stale read’s failure too, rather than blaming the new connection', async () => {
    /** 中文说明：测试局部值 rejects，由紧邻初始化决定。 */
    const rejects: ((reason: unknown) => void)[] = []
    /** 中文说明：测试局部值 seam，由紧邻初始化决定。 */
    const seam = port(() => new Promise((_resolve, reject) => { rejects.push(reject) }))
    /** 中文说明：测试局部值 onError，由紧邻初始化决定。 */
    const onError = vi.fn()
    /** 中文说明：测试局部值 inventory，由紧邻初始化决定。 */
    const inventory = createCordisInventory(seam.port, onError)
    inventory.refresh()
    inventory.reset()

    rejects[0]?.(new Error('socket closed'))
    await Promise.resolve()
    await Promise.resolve()
    // The failure belongs to a connection nobody is looking at any more.
    expect(onError).not.toHaveBeenCalled()
    expect(inventory.getSnapshot()).toEqual({ rows: [], removed: new Set(), read: false })
  })
})
