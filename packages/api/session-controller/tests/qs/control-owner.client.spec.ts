/** 可控消费器验证替换等待、迟到回调和卸载交错，不依赖真实时钟。 */
import { afterEach, expect, it, vi } from 'vitest'
import type { SessionControlStreamOptions } from '../../src/client/transport.ts'
import type { SessionRemotes } from '../../src/client/sessions/remotes.ts'
import { SessionControlOwner } from '../../src/client/qs/control-owner.ts'

const factory = vi.hoisted(() => vi.fn())
vi.mock('../../src/client/transport.ts', () => ({ createSessionControlStream: factory }))
afterEach(() => { vi.restoreAllMocks(); factory.mockReset() })

function fixture() {
  const instances: { options: SessionControlStreamOptions; start: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }[] = []
  factory.mockImplementation((_remote: unknown, options: SessionControlStreamOptions) => {
    const stream = { options, start: vi.fn(), dispose: vi.fn(async () => {}) }
    instances.push(stream)
    return stream
  })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const accept = vi.fn()
  // 本例仅测试所有者，Remote 不被替代工厂读取。
  const owner = new SessionControlOwner({} as SessionRemotes, accept)
  return { owner, accept, instances }
}
const baseline = { type: 'baseline', value: { queues: {}, jobs: {}, projections: {} } } as const

it('publishes baseline readiness and carrier retry without creating another stream', async () => {
  const { owner, instances, accept } = fixture()
  try {
    expect(owner.state.getSnapshot()).toEqual({ phase: 'loading', baseline: 0 })
    await owner.retry()
    owner.start(); owner.start()
    expect(instances).toHaveLength(1)
    instances[0]!.options.accept(baseline)
    expect(owner.state.getSnapshot()).toEqual({ phase: 'ready', baseline: 1 })
    instances[0]!.options.accept({ type: 'jobs', sessionId: 'a' as never, jobs: [] })
    expect(accept).toHaveBeenCalledTimes(2)
    instances[0]!.options.carrierFailed?.(new Error('carrier'))
    expect(owner.state.getSnapshot().phase).toBe('reconnecting')
    await owner.retry()
    expect(instances).toHaveLength(1)
    instances[0]!.options.accept(baseline)
    expect(owner.state.getSnapshot()).toEqual({ phase: 'ready', baseline: 2 })
  } finally { await owner.dispose() }
})

it('coalesces retries and waits for quiescence before replacement; old callbacks are ignored', async () => {
  const { owner, instances, accept } = fixture()
  const stopped = Promise.withResolvers<undefined>()
  try {
    owner.start()
    const old = instances[0]!
    old.options.failed(new Error('terminal'))
    old.dispose.mockReturnValue(stopped.promise)
    const pending = owner.retry()
    expect(owner.retry()).toBe(pending)
    owner.start()
    old.options.accept(baseline); old.options.failed(new Error('late')); old.options.carrierFailed?.(new Error('late'))
    expect(accept).not.toHaveBeenCalled()
    expect(owner.state.getSnapshot().phase).toBe('loading')
    expect(instances).toHaveLength(1)
    stopped.resolve(undefined); await pending
    expect(instances).toHaveLength(2)
    instances[1]!.options.accept(baseline)
    expect(owner.state.getSnapshot().phase).toBe('ready')
  } finally { stopped.resolve(undefined); await owner.dispose() }
})

it('disposal during replacement prevents reopening and waits for the old consumer', async () => {
  const { owner, instances } = fixture()
  const stopped = Promise.withResolvers<undefined>()
  owner.start()
  const old = instances[0]!
  old.options.failed(new Error('terminal'))
  old.dispose.mockReturnValue(stopped.promise)
  const retry = owner.retry(), closing = owner.dispose()
  expect(owner.dispose()).toBe(closing)
  stopped.resolve(undefined); await Promise.all([retry, closing])
  owner.start(); await owner.retry()
  old.options.accept(baseline); old.options.failed(new Error('late')); old.options.carrierFailed?.(new Error('late'))
  expect(instances).toHaveLength(1)
  expect(owner.state.getSnapshot().phase).toBe('disposed')
})

it('retains failed state when teardown rejects and does not open a competing consumer', async () => {
  const { owner, instances } = fixture()
  owner.start()
  instances[0]!.options.failed(new Error('terminal'))
  instances[0]!.dispose.mockRejectedValueOnce(new Error('teardown'))
  await expect(owner.retry()).rejects.toThrow('teardown')
  expect(owner.state.getSnapshot().phase).toBe('failed')
  expect(instances).toHaveLength(1)
  await owner.dispose()
})

it('does not replace disposed state when an in-flight teardown rejects', async () => {
  const { owner, instances } = fixture()
  const stopped = Promise.withResolvers<undefined>()
  owner.start()
  instances[0]!.options.failed(new Error('terminal'))
  instances[0]!.dispose.mockReturnValue(stopped.promise)
  const retry = owner.retry(), closing = owner.dispose()
  const assertions = Promise.all([
    expect(retry).rejects.toThrow('teardown'), expect(closing).rejects.toThrow('teardown'),
  ])
  stopped.reject(new Error('teardown'))
  await assertions
  expect(owner.state.getSnapshot().phase).toBe('disposed')
  expect(instances).toHaveLength(1)
})
