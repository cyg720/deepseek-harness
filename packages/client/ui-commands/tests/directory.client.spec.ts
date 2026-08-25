/**
 * CommandDirectory unit tests over the session-key axis: per-key status
 * transitions and epoch guard, key isolation across sessions, soft
 * invalidation (invalidateAll), the reconnect hard reset (resetConnected:
 * every entry drops its snapshot and prewarms), the warm hook's cold/failed
 * gate, and the per-key ensureReady strong-wait policy.
 */
/*
 * 文件职责：验证命令弹层的 directory.client.spec.ts 行为。
 * 技术维度：Vitest、React 测试渲染和可控替身。
 * 产品维度：防止命令弹层用户流程发生回归。
 * 逻辑维度：构造输入、触发交互并断言输出与清理。
 * 关键边界：全局替身和异步任务必须在用例后清理。
 * 新手阅读建议：先读辅助函数，再按测试场景顺序阅读。
 */
import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { CommandDescriptor } from '../src/client/directory.ts'
import { CommandDirectory } from '../src/client/directory.ts'

/** 中文说明：测试场景的局部值 sid，由紧邻初始化决定。 */
const sid = (k: string): SessionId => k as SessionId
/** 中文说明：测试场景的局部值 S1，由紧邻初始化决定。 */
const S1 = sid('s1')
/** 中文说明：测试场景的局部值 S2，由紧邻初始化决定。 */
const S2 = sid('s2')

/** 中文说明：函数 deferred 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
function deferred<T>() {
  /** 中文说明：测试场景的局部值 resolve!，由紧邻初始化决定。 */
  let resolve!: (value: T) => void
  /** 中文说明：测试场景的局部值 reject!，由紧邻初始化决定。 */
  let reject!: (reason?: unknown) => void
  /** 中文说明：测试场景的局部值 promise，由紧邻初始化决定。 */
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

/** 中文说明：测试场景的局部值 CMDS，由紧邻初始化决定。 */
const CMDS: CommandDescriptor[] = [
  { name: 'plan', description: 'plan mode' },
  { name: 'goal', description: 'set goal', input: { hint: 'goal text' } },
]

/** 中文说明：测试场景的局部值 S2_CMDS，由紧邻初始化决定。 */
const S2_CMDS: CommandDescriptor[] = [
  ...CMDS,
  { name: 'attach', description: 'attach a file', input: { hint: 'path' } },
]

/** Directory over per-key pull queues: each fetch appends a hand-settled deferred. */
/* 中文说明：函数 bench 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
function bench() {
  /** 中文说明：测试场景的局部值 pulls，由紧邻初始化决定。 */
  const pulls = new Map<SessionId, Array<ReturnType<typeof deferred<readonly CommandDescriptor[]>>>>()
  /** 中文说明：测试场景的局部值 calls，由紧邻初始化决定。 */
  const calls: SessionId[] = []
  /** 中文说明：测试场景的局部值 dir，由紧邻初始化决定。 */
  const dir = new CommandDirectory((key) => {
    calls.push(key)
    /** 中文说明：测试场景的局部值 d，由紧邻初始化决定。 */
    const d = deferred<readonly CommandDescriptor[]>()
    /** 中文说明：测试场景的局部值 queue，由紧邻初始化决定。 */
    const queue = pulls.get(key) ?? []
    queue.push(d)
    pulls.set(key, queue)
    return d.promise
  })
  /** 中文说明：测试场景的局部值 pull，由紧邻初始化决定。 */
  const pull = (key: SessionId, i: number) => {
    /** 中文说明：测试场景的局部值 d，由紧邻初始化决定。 */
    const d = pulls.get(key)?.[i]
    if (d === undefined) throw new Error(`no pull #${i} for ${key}`)
    return d
  }
  return { dir, pull, calls, countOf: (key: SessionId) => pulls.get(key)?.length ?? 0 }
}

describe('status and resolve (per key)', () => {
  it('starts cold and resolves nothing', () => {
    /** 中文说明：测试场景的局部值 { dir }，由紧邻初始化决定。 */
    const { dir } = bench()
    expect(dir.status(S1)).toBe('cold')
    expect(dir.resolve(S1, 'plan')).toBeUndefined()
  })

  it('serves exact-name lookups once ready, undefined for unknown names', async () => {
    /** 中文说明：测试场景的局部值 { dir, pull }，由紧邻初始化决定。 */
    const { dir, pull } = bench()
    /** 中文说明：测试场景的局部值 refreshed，由紧邻初始化决定。 */
    const refreshed = dir.refresh(S1)
    expect(dir.status(S1)).toBe('pending')
    pull(S1, 0).resolve(CMDS)
    await refreshed
    expect(dir.status(S1)).toBe('ready')
    expect(dir.resolve(S1, 'goal')).toEqual(CMDS[1])
    expect(dir.resolve(S1, 'nope')).toBeUndefined()
  })

  it('drops the snapshot and records failure on a failed pull', async () => {
    /** 中文说明：测试场景的局部值 { dir, pull }，由紧邻初始化决定。 */
    const { dir, pull } = bench()
    /** 中文说明：测试场景的局部值 refreshed，由紧邻初始化决定。 */
    const refreshed = dir.refresh(S1)
    pull(S1, 0).reject(new Error('boom'))
    await refreshed
    expect(dir.status(S1)).toBe('failed')
    expect(dir.resolve(S1, 'plan')).toBeUndefined()
  })

  it('keys are isolated: one session catalog landing leaves another cold', async () => {
    /** 中文说明：测试场景的局部值 { dir, pull }，由紧邻初始化决定。 */
    const { dir, pull } = bench()
    /** 中文说明：测试场景的局部值 refreshed，由紧邻初始化决定。 */
    const refreshed = dir.refresh(S1)
    pull(S1, 0).resolve(CMDS)
    await refreshed
    expect(dir.status(S2)).toBe('cold')
    expect(dir.resolve(S2, 'plan')).toBeUndefined()

    /** 中文说明：测试场景的局部值 other，由紧邻初始化决定。 */
    const other = dir.refresh(S2)
    pull(S2, 0).resolve(S2_CMDS)
    await other
    expect(dir.resolve(S2, 'attach')).toBeDefined()
    expect(dir.resolve(S1, 'attach')).toBeUndefined()
  })
})

describe('epoch guard (per key)', () => {
  it('a superseded pull cannot overwrite the newer one (old resolves after new)', async () => {
    /** 中文说明：测试场景的局部值 { dir, pull }，由紧邻初始化决定。 */
    const { dir, pull } = bench()
    /** 中文说明：测试场景的局部值 first，由紧邻初始化决定。 */
    const first = dir.refresh(S1)
    /** 中文说明：测试场景的局部值 second，由紧邻初始化决定。 */
    const second = dir.refresh(S1)
    pull(S1, 1).resolve(CMDS)
    await second
    expect(dir.resolve(S1, 'plan')).toBeDefined()
    pull(S1, 0).resolve([{ name: 'stale', description: 'old world' }])
    await first
    expect(dir.resolve(S1, 'stale')).toBeUndefined()
    expect(dir.resolve(S1, 'plan')).toBeDefined()
  })

  it('a superseded failure cannot demote the newer success', async () => {
    /** 中文说明：测试场景的局部值 { dir, pull }，由紧邻初始化决定。 */
    const { dir, pull } = bench()
    /** 中文说明：测试场景的局部值 first，由紧邻初始化决定。 */
    const first = dir.refresh(S1)
    /** 中文说明：测试场景的局部值 second，由紧邻初始化决定。 */
    const second = dir.refresh(S1)
    pull(S1, 1).resolve(CMDS)
    await second
    pull(S1, 0).reject(new Error('late failure'))
    await first
    expect(dir.status(S1)).toBe('ready')
    expect(dir.resolve(S1, 'plan')).toBeDefined()
  })

  it('epochs are per key: one session supersede leaves another session epoch alone', async () => {
    /** 中文说明：测试场景的局部值 { dir, pull }，由紧邻初始化决定。 */
    const { dir, pull } = bench()
    /** 中文说明：测试场景的局部值 one，由紧邻初始化决定。 */
    const one = dir.refresh(S1)
    void dir.refresh(S2)
    void dir.refresh(S2) // supersedes the s2 pull only
    pull(S1, 0).resolve(CMDS)
    await one
    expect(dir.status(S1)).toBe('ready')
  })
})

describe('invalidateAll (commands-changed soft)', () => {
  it('repulls every touched key in the background while ready snapshots keep serving', async () => {
    /** 中文说明：测试场景的局部值 { dir, pull, countOf }，由紧邻初始化决定。 */
    const { dir, pull, countOf } = bench()
    /** 中文说明：测试场景的局部值 a，由紧邻初始化决定。 */
    const a = dir.refresh(S1)
    /** 中文说明：测试场景的局部值 b，由紧邻初始化决定。 */
    const b = dir.refresh(S2)
    pull(S1, 0).resolve(CMDS)
    pull(S2, 0).resolve(S2_CMDS)
    await Promise.all([a, b])

    dir.invalidateAll()
    expect(countOf(S1)).toBe(2)
    expect(countOf(S2)).toBe(2)
    expect(dir.status(S1)).toBe('ready')
    expect(dir.resolve(S2, 'attach')).toBeDefined()

    pull(S1, 1).resolve([{ name: 'fresh', description: 'new world' }])
    await Promise.resolve()
    await Promise.resolve()
    expect(dir.resolve(S1, 'fresh')).toBeDefined()
    expect(dir.resolve(S1, 'plan')).toBeUndefined()
  })

  it('an untouched directory invalidates to nothing (no keys, no pulls)', () => {
    /** 中文说明：测试场景的局部值 { dir, calls }，由紧邻初始化决定。 */
    const { dir, calls } = bench()
    dir.invalidateAll()
    expect(calls).toEqual([])
  })
})

describe('resetConnected (reconnect hard)', () => {
  it('every entry drops its snapshot immediately and prewarms', async () => {
    /** 中文说明：测试场景的局部值 { dir, pull, countOf }，由紧邻初始化决定。 */
    const { dir, pull, countOf } = bench()
    /** 中文说明：测试场景的局部值 a，由紧邻初始化决定。 */
    const a = dir.refresh(S1)
    /** 中文说明：测试场景的局部值 b，由紧邻初始化决定。 */
    const b = dir.refresh(S2)
    pull(S1, 0).resolve(CMDS)
    pull(S2, 0).resolve(S2_CMDS)
    await Promise.all([a, b])

    dir.resetConnected()
    // Hard: the agent world may have changed shape across the generation.
    expect(dir.status(S1)).toBe('pending')
    expect(dir.resolve(S1, 'plan')).toBeUndefined()
    expect(dir.status(S2)).toBe('pending')
    expect(dir.resolve(S2, 'attach')).toBeUndefined()
    expect(countOf(S1)).toBe(2)
    expect(countOf(S2)).toBe(2)

    pull(S1, 1).resolve(CMDS)
    pull(S2, 1).resolve(S2_CMDS)
    await Promise.resolve()
    await Promise.resolve()
    expect(dir.status(S1)).toBe('ready')
    expect(dir.resolve(S2, 'attach')).toBeDefined()
  })
})

describe('warm', () => {
  it('launches a pull from cold, again after failure, and never over pending/ready', async () => {
    /** 中文说明：测试场景的局部值 { dir, pull, countOf }，由紧邻初始化决定。 */
    const { dir, pull, countOf } = bench()
    dir.warm(S1)
    expect(countOf(S1)).toBe(1)
    dir.warm(S1) // pending → no second pull
    expect(countOf(S1)).toBe(1)

    pull(S1, 0).reject(new Error('boom'))
    await Promise.resolve()
    await Promise.resolve()
    expect(dir.status(S1)).toBe('failed')
    dir.warm(S1) // failed → retry
    expect(countOf(S1)).toBe(2)

    pull(S1, 1).resolve(CMDS)
    await Promise.resolve()
    await Promise.resolve()
    dir.warm(S1) // ready → no-op
    expect(countOf(S1)).toBe(2)
  })

  it('warms keys independently', () => {
    /** 中文说明：测试场景的局部值 { dir, countOf }，由紧邻初始化决定。 */
    const { dir, countOf } = bench()
    dir.warm(S2)
    expect(countOf(S2)).toBe(1)
    expect(countOf(S1)).toBe(0)
  })
})

describe('ensureReady (per key)', () => {
  /** 中文说明：测试场景的局部值 signal，由紧邻初始化决定。 */
  const signal = () => new AbortController().signal

  it('returns the hot snapshot at once when ready', async () => {
    /** 中文说明：测试场景的局部值 { dir, pull, countOf }，由紧邻初始化决定。 */
    const { dir, pull, countOf } = bench()
    /** 中文说明：测试场景的局部值 warm，由紧邻初始化决定。 */
    const warm = dir.refresh(S1)
    pull(S1, 0).resolve(CMDS)
    await warm
    await expect(dir.ensureReady(S1, signal())).resolves.toEqual(CMDS)
    expect(countOf(S1)).toBe(1)
  })

  it('launches a pull from cold and resolves on arrival, without touching other keys', async () => {
    /** 中文说明：测试场景的局部值 { dir, pull, countOf }，由紧邻初始化决定。 */
    const { dir, pull, countOf } = bench()
    /** 中文说明：测试场景的局部值 wait，由紧邻初始化决定。 */
    const wait = dir.ensureReady(S2, signal())
    expect(dir.status(S2)).toBe('pending')
    pull(S2, 0).resolve(S2_CMDS)
    await expect(wait).resolves.toEqual(S2_CMDS)
    expect(countOf(S1)).toBe(0)
  })

  it('joins a flying pull instead of starting a second one', async () => {
    /** 中文说明：测试场景的局部值 { dir, pull, countOf }，由紧邻初始化决定。 */
    const { dir, pull, countOf } = bench()
    void dir.refresh(S1)
    /** 中文说明：测试场景的局部值 wait，由紧邻初始化决定。 */
    const wait = dir.ensureReady(S1, signal())
    expect(countOf(S1)).toBe(1)
    pull(S1, 0).resolve(CMDS)
    await expect(wait).resolves.toEqual(CMDS)
  })

  it('rejects when the awaited pull fails (no silent downgrade)', async () => {
    /** 中文说明：测试场景的局部值 { dir, pull }，由紧邻初始化决定。 */
    const { dir, pull } = bench()
    /** 中文说明：测试场景的局部值 wait，由紧邻初始化决定。 */
    const wait = dir.ensureReady(S1, signal())
    pull(S1, 0).reject(new Error('warmup boom'))
    await expect(wait).rejects.toThrow('command directory warmup failed: warmup boom')
  })

  it('retries from failed state with a fresh pull', async () => {
    /** 中文说明：测试场景的局部值 { dir, pull }，由紧邻初始化决定。 */
    const { dir, pull } = bench()
    /** 中文说明：测试场景的局部值 first，由紧邻初始化决定。 */
    const first = dir.ensureReady(S1, signal())
    pull(S1, 0).reject(new Error('boom'))
    await expect(first).rejects.toThrow()
    /** 中文说明：测试场景的局部值 second，由紧邻初始化决定。 */
    const second = dir.ensureReady(S1, signal())
    pull(S1, 1).resolve(CMDS)
    await expect(second).resolves.toEqual(CMDS)
  })

  it('rejects on abort while waiting', async () => {
    /** 中文说明：测试场景的局部值 { dir }，由紧邻初始化决定。 */
    const { dir } = bench()
    /** 中文说明：测试场景的局部值 ac，由紧邻初始化决定。 */
    const ac = new AbortController()
    /** 中文说明：测试场景的局部值 wait，由紧邻初始化决定。 */
    const wait = dir.ensureReady(S1, ac.signal)
    ac.abort(new Error('attempt superseded'))
    await expect(wait).rejects.toThrow('attempt superseded')
  })

  it('rejects immediately on an already-aborted signal', async () => {
    /** 中文说明：测试场景的局部值 { dir, pull }，由紧邻初始化决定。 */
    const { dir, pull } = bench()
    /** 中文说明：测试场景的局部值 warm，由紧邻初始化决定。 */
    const warm = dir.refresh(S1)
    pull(S1, 0).reject(new Error('irrelevant'))
    await warm
    /** 中文说明：测试场景的局部值 ac，由紧邻初始化决定。 */
    const ac = new AbortController()
    ac.abort() // bare abort: the DOMException reason is itself an Error and travels as-is
    await expect(dir.ensureReady(S1, ac.signal)).rejects.toThrow(/aborted/)
  })

  it('keeps waiting across a superseded pull and settles on the winner', async () => {
    /** 中文说明：测试场景的局部值 { dir, pull }，由紧邻初始化决定。 */
    const { dir, pull } = bench()
    /** 中文说明：测试场景的局部值 wait，由紧邻初始化决定。 */
    const wait = dir.ensureReady(S1, signal())
    void dir.refresh(S1) // supersedes pull #0 with pull #1
    pull(S1, 0).resolve([{ name: 'stale', description: 'loser' }])
    pull(S1, 1).resolve(CMDS)
    await expect(wait).resolves.toEqual(CMDS)
  })
})
