/** 受控异步回归：插件卸载不能继续发布旧清单或返回旧查询结果。 */
import { Context } from '@deepseek-ai/cordis'
import type { CordisInspectRequestId, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { afterEach, expect, it, vi } from 'vitest'
import { ClientCordisInspectRegistry, provideClientCordisInspect } from '../../src/client/inspect-registry.ts'

afterEach(() => { vi.restoreAllMocks() })

it('cancels a queued publication when its owning plugin is disposed', async () => {
  const ctx = new Context(), sync = vi.fn(async () => {}), resolve = vi.fn(async () => {})
  const registry = new ClientCordisInspectRegistry({ sync, resolve })
  try {
    const fiber = await ctx.plugin({ apply: (scope: Context) => { provideClientCordisInspect(scope, registry) } })
    // 插件同步启动释放，排队微任务不得在服务消失后发起 RPC。
    registry.publish()
    const stopped = fiber.dispose()
    await stopped
    await Promise.resolve()
    expect(sync).not.toHaveBeenCalled()
    registry.publish()
    await Promise.resolve()
    expect(sync).not.toHaveBeenCalled()
    expect(() => registry.register({ manifest: { id: 'late', description: 'late', methods: [] }, query: async () => null }))
      .toThrow('registry is disposed')
  } finally { await ctx.fiber.dispose() }
})

it('drops queued work behind an in-flight publication but still reports failures while active', async () => {
  const pending = Promise.withResolvers<undefined>()
  const sync = vi.fn(() => pending.promise), error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const registry = new ClientCordisInspectRegistry({ sync, resolve: async () => {} })
  try {
    registry.publish()
    await vi.waitFor(() => { expect(sync).toHaveBeenCalledTimes(1) })
    registry.publish()
    await Promise.resolve()
    registry.dispose()
    pending.reject(new Error('old connection closed'))
    // 活动实例的失败是正向结算信号；旧实例的迟到失败不能一起进入控制台。
    const active = new ClientCordisInspectRegistry({ sync: async () => { throw new Error('active failure') }, resolve: async () => {} })
    try {
      active.publish()
      await vi.waitFor(() => { expect(error).toHaveBeenCalledWith('[cordis-client-runner] syncing inspect providers failed:', expect.any(Error)) })
      expect(error).toHaveBeenCalledTimes(1)
      expect(error.mock.calls[0]?.[1]).toEqual(new Error('active failure'))
      expect(sync).toHaveBeenCalledTimes(1)
    } finally { active.dispose() }
  } finally { pending.resolve(undefined); registry.dispose() }
})

it('aborts an in-flight query and refuses late work after disposal', async () => {
  const pending = Promise.withResolvers<null>(), resolve = vi.fn(async () => {})
  const registry = new ClientCordisInspectRegistry({ sync: async () => {}, resolve })
  let signal: AbortSignal | undefined
  const unregister = registry.register({
    manifest: { id: 'controlled', description: 'controlled query', methods: [{ name: 'read', description: 'read', inputSchema: {}, outputSchema: {} }] },
    query: async (_method, _input, context) => { signal = context.signal; return pending.promise },
  })
  const request = {
    requestId: 'qs-query' as CordisInspectRequestId, agentId: 'qs-inspect' as SessionId, provider: 'controlled', method: 'read',
  }
  const work = registry.query(request)
  try {
    expect(signal?.aborted).toBe(false)
    registry.dispose()
    expect(signal?.aborted).toBe(true)
    unregister()
    pending.resolve(null)
    await work
    await registry.query(request)
    expect(resolve).not.toHaveBeenCalled()
  } finally { registry.dispose(); pending.resolve(null); await work }
})
