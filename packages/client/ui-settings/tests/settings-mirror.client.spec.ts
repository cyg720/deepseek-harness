/**
 * 文件职责：验证设置系统的 settings-mirror.client.spec.ts 行为。
 * 技术维度：Vitest、React 渲染、DOM 事件和服务替身。
 * 产品维度：防止设置系统显示、导航或生命周期回归。
 * 逻辑维度：构造状态，触发交互并断言输出和清理。
 * 关键边界：全局主题、DOM 尺寸和订阅必须在用例后恢复。
 * 新手阅读建议：先读夹具，再按加载、交互和卸载场景阅读。
 */
import { describe, expect, it, vi } from 'vitest'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import { SettingsDescribeMirror, type SettingsDescribeView } from '../src/client/settings-mirror.ts'

/** What a Remote call answers with: no carrier envelope, and a free-form failure code. */
type Answer<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string; details: object } }

function ok<T>(value: T): Answer<T> {
  return { ok: true, value }
}

function rejected<T>(message: string): Answer<T> {
  return { ok: false, error: { code: 'settings-rejected', message, details: { ns: 'theme' } } }
}

/** 中文说明：函数 view 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function view(ns: string, revision = 0): SettingsNamespaceView {
  return { ns, schema: {}, value: { field: ns }, applies: 'live', secrets: [], revision }
}

function described(namespaces: SettingsNamespaceView[]): Answer<SettingsDescribeView> {
  return ok({ writable: true, hasDocument: true, namespaces })
}

/** 中文说明：函数 deferred 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function deferred<T>() {
  /** 中文说明：测试局部值 resolve，由紧邻初始化决定。 */
  let resolve!: (value: T) => void
  /** 中文说明：测试局部值 promise，由紧邻初始化决定。 */
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

describe('SettingsDescribeMirror', () => {
  it('folds loads before the wire read into it, and mid-flight loads into one rerun', async () => {
    const gate = deferred<Answer<SettingsDescribeView>>()
    const describeCall = vi.fn()
      .mockReturnValueOnce(gate.promise)
      .mockResolvedValue(described([view('theme', 1)]))
    /** 中文说明：测试局部值 mirror，由紧邻初始化决定。 */
    const mirror = new SettingsDescribeMirror({ settings: { describe: describeCall } } as never)
    /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
    const first = mirror.load()
    // Issued before the wire read goes out: covered by that read, no rerun.
    /** 中文说明：测试局部值 early，由紧邻初始化决定。 */
    const early = mirror.load()
    await Promise.resolve()
    expect(describeCall).toHaveBeenCalledTimes(1)
    // Issued while the read is on the wire: exactly one rerun, however many.
    /** 中文说明：测试局部值 mid，由紧邻初始化决定。 */
    const mid = mirror.load()
    /** 中文说明：测试局部值 midToo，由紧邻初始化决定。 */
    const midToo = mirror.load()
    gate.resolve(described([view('theme', 0)]))
    await Promise.all([first, early, mid, midToo])
    expect(describeCall).toHaveBeenCalledTimes(2)
    expect(mirror.getSnapshot().status).toBe('ready')
    expect(mirror.namespace('theme')?.revision).toBe(1)
  })

  it('keeps the last good view when a later refresh fails, recording the failure', async () => {
    /** 中文说明：测试局部值 describeCall，由紧邻初始化决定。 */
    const describeCall = vi.fn()
      .mockResolvedValueOnce(described([view('theme', 2)]))
      .mockRejectedValueOnce(new Error('host gone'))
      .mockResolvedValueOnce(rejected('busy'))
    /** 中文说明：测试局部值 mirror，由紧邻初始化决定。 */
    const mirror = new SettingsDescribeMirror({ settings: { describe: describeCall } } as never)
    await mirror.load()
    expect(mirror.getSnapshot()).toMatchObject({ status: 'ready', error: null })
    await mirror.load()
    expect(mirror.getSnapshot()).toMatchObject({ status: 'ready', error: 'host gone' })
    expect(mirror.namespace('theme')?.revision).toBe(2)
    await mirror.load()
    expect(mirror.getSnapshot()).toMatchObject({ status: 'ready', error: 'busy' })
    expect(mirror.getSnapshot().view?.namespaces).toHaveLength(1)
  })

  it('returns to idle after a first read that never succeeded, so ensure retries', async () => {
    /** 中文说明：测试局部值 describeCall，由紧邻初始化决定。 */
    const describeCall = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(described([view('theme', 1)]))
    /** 中文说明：测试局部值 mirror，由紧邻初始化决定。 */
    const mirror = new SettingsDescribeMirror({ settings: { describe: describeCall } } as never)
    await mirror.ensure()
    expect(mirror.getSnapshot()).toMatchObject({ status: 'idle', view: undefined, error: 'offline' })
    await mirror.ensure()
    expect(mirror.getSnapshot()).toMatchObject({ status: 'ready', error: null })
    expect(describeCall).toHaveBeenCalledTimes(2)
  })

  it('treats ensure as a no-op once ready', async () => {
    /** 中文说明：测试局部值 describeCall，由紧邻初始化决定。 */
    const describeCall = vi.fn().mockResolvedValue(described([view('theme', 1)]))
    /** 中文说明：测试局部值 mirror，由紧邻初始化决定。 */
    const mirror = new SettingsDescribeMirror({ settings: { describe: describeCall } } as never)
    await mirror.ensure()
    await mirror.ensure()
    await mirror.ensure()
    expect(describeCall).toHaveBeenCalledTimes(1)
  })

  it('memory persistence is terminally unavailable and never touches the wire', async () => {
    /** 中文说明：测试局部值 describeCall，由紧邻初始化决定。 */
    const describeCall = vi.fn()
    /** 中文说明：测试局部值 mirror，由紧邻初始化决定。 */
    const mirror = new SettingsDescribeMirror({ settings: { describe: describeCall } } as never, 'memory')
    await mirror.ensure()
    await mirror.load()
    expect(mirror.getSnapshot()).toEqual({ status: 'unavailable', view: undefined, error: null })
    expect(describeCall).not.toHaveBeenCalled()
  })

  it('acceptView folds one write answer into the held view without a wire read', async () => {
    /** 中文说明：测试局部值 describeCall，由紧邻初始化决定。 */
    const describeCall = vi.fn()
      .mockResolvedValueOnce(described([view('theme', 1), view('locale', 4)]))
    /** 中文说明：测试局部值 mirror，由紧邻初始化决定。 */
    const mirror = new SettingsDescribeMirror({ settings: { describe: describeCall } } as never)
    await mirror.load()
    /** 中文说明：测试局部值 seen，由紧邻初始化决定。 */
    const seen: number[] = []
    mirror.subscribe(() => { seen.push(mirror.namespace('theme')?.revision ?? -1) })
    mirror.acceptView(view('theme', 9))
    expect(mirror.namespace('theme')?.revision).toBe(9)
    expect(mirror.namespace('locale')?.revision).toBe(4)
    expect(seen).toEqual([9])
    expect(describeCall).toHaveBeenCalledTimes(1)
  })

  it('acceptView before any answer is a no-op instead of inventing a document', () => {
    /** 中文说明：测试局部值 describeCall，由紧邻初始化决定。 */
    const describeCall = vi.fn()
    /** 中文说明：测试局部值 mirror，由紧邻初始化决定。 */
    const mirror = new SettingsDescribeMirror({ settings: { describe: describeCall } } as never)
    mirror.acceptView(view('theme', 1))
    expect(mirror.getSnapshot()).toEqual({ status: 'idle', view: undefined, error: null })
  })

  it('acceptView appends a namespace the held view has not seen yet', async () => {
    /** 中文说明：测试局部值 describeCall，由紧邻初始化决定。 */
    const describeCall = vi.fn().mockResolvedValueOnce(described([view('theme', 1)]))
    /** 中文说明：测试局部值 mirror，由紧邻初始化决定。 */
    const mirror = new SettingsDescribeMirror({ settings: { describe: describeCall } } as never)
    await mirror.load()
    mirror.acceptView(view('fresh-ns', 0))
    expect(mirror.namespace('fresh-ns')).toBeDefined()
    expect(mirror.getSnapshot().view?.namespaces).toHaveLength(2)
  })

  it('never loses a load landing between a run settling and its slot clearing', async () => {
    // Regression: with the in-flight slot cleared by a promise .finally(),
    // a load() in the one-microtask gap after the rerun check marked a rerun
    // nobody read, and that refresh never reached the wire.
    /** 中文说明：测试局部值 describeCall，由紧邻初始化决定。 */
    const describeCall = vi.fn().mockResolvedValue(described([view('theme', 1)]))
    /** 中文说明：测试局部值 mirror，由紧邻初始化决定。 */
    const mirror = new SettingsDescribeMirror({ settings: { describe: describeCall } } as never)
    void mirror.load()
    await vi.waitFor(() => { expect(describeCall).toHaveBeenCalledTimes(1) })
    void mirror.load()
    await vi.waitFor(() => { expect(describeCall).toHaveBeenCalledTimes(2) })
    void mirror.load()
    await vi.waitFor(() => { expect(describeCall).toHaveBeenCalledTimes(3) })
  })

  it('starts no second run for a load issued inside the loading publish', async () => {
    const gate = deferred<Answer<SettingsDescribeView>>()
    const describeCall = vi.fn().mockReturnValue(gate.promise)
    /** 中文说明：测试局部值 mirror，由紧邻初始化决定。 */
    const mirror = new SettingsDescribeMirror({ settings: { describe: describeCall } } as never)
    /** 中文说明：测试局部值 reentered，由紧邻初始化决定。 */
    let reentered = false
    /** 中文说明：测试局部值 unsubscribe，由紧邻初始化决定。 */
    const unsubscribe = mirror.subscribe(() => {
      if (reentered) return
      reentered = true
      void mirror.load()
    })
    /** 中文说明：测试局部值 loading，由紧邻初始化决定。 */
    const loading = mirror.load()
    await Promise.resolve()
    expect(describeCall).toHaveBeenCalledTimes(1)
    gate.resolve(described([view('theme', 1)]))
    await loading
    unsubscribe()
    // The reentrant load folded into the first run rather than racing it.
    expect(describeCall).toHaveBeenCalledTimes(1)
    expect(mirror.getSnapshot().status).toBe('ready')
  })

  it('lets the first read cover a write folded inside the loading publish', async () => {
    /** 中文说明：测试局部值 describeCall，由紧邻初始化决定。 */
    const describeCall = vi.fn().mockResolvedValue(described([view('theme', 2)]))
    /** 中文说明：测试局部值 mirror，由紧邻初始化决定。 */
    const mirror = new SettingsDescribeMirror({ settings: { describe: describeCall } } as never)
    /** 中文说明：测试局部值 unsubscribe，由紧邻初始化决定。 */
    const unsubscribe = mirror.subscribe(() => {
      unsubscribe()
      mirror.acceptView(view('theme', 2))
    })

    await mirror.load()

    expect(describeCall).toHaveBeenCalledTimes(1)
    expect(mirror.getSnapshot().status).toBe('ready')
    expect(mirror.namespace('theme')?.revision).toBe(2)
  })

  it('re-reads after a folded write invalidates an in-flight document', async () => {
    const slow = deferred<Answer<SettingsDescribeView>>()
    const describeCall = vi.fn()
      .mockResolvedValueOnce(described([view('theme', 4), view('locale', 1)]))
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce(described([view('theme', 5), view('locale', 2)]))
    /** 中文说明：测试局部值 mirror，由紧邻初始化决定。 */
    const mirror = new SettingsDescribeMirror({ settings: { describe: describeCall } } as never)
    await mirror.load()
    expect(describeCall).toHaveBeenCalledTimes(1)
    /** 中文说明：测试局部值 stale，由紧邻初始化决定。 */
    const stale = mirror.load()
    await Promise.resolve()
    mirror.acceptView(view('theme', 5))
    slow.resolve(described([view('theme', 4), view('locale', 2)]))
    await stale
    expect(describeCall).toHaveBeenCalledTimes(3)
    expect(mirror.namespace('theme')?.revision).toBe(5)
    expect(mirror.namespace('locale')?.revision).toBe(2)
  })

  it('re-reads after a pre-answer write invalidates the in-flight document', async () => {
    const slow = deferred<Answer<SettingsDescribeView>>()
    const describeCall = vi.fn()
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce(described([view('theme', 2)]))
    /** 中文说明：测试局部值 mirror，由紧邻初始化决定。 */
    const mirror = new SettingsDescribeMirror({ settings: { describe: describeCall } } as never)
    /** 中文说明：测试局部值 loading，由紧邻初始化决定。 */
    const loading = mirror.load()
    await Promise.resolve()
    mirror.acceptView(view('theme', 2))
    slow.resolve(described([view('theme', 1)]))
    await loading
    expect(describeCall).toHaveBeenCalledTimes(2)
    expect(mirror.namespace('theme')?.revision).toBe(2)
  })
})
