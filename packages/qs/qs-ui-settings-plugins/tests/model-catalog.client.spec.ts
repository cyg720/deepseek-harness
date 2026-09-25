/** 可控请求顺序验证目录刷新与连接代际，不依赖定时等待。 */
import { expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import { createModelCatalog, modelCandidates, modelRouteKey } from '../src/client/model-catalog.ts'

type Result = Awaited<ReturnType<Context['remote']['session']['modelCatalog']>>
const groups = [{ id: 'alpha', name: 'Alpha', models: [{ id: 'fast', name: 'Fast' }] }]
it('明确拒绝仅显示错误状态，重试成功清除错误和部分失败标记', async () => {
  const load = vi.fn<Context['remote']['session']['modelCatalog']>()
  const catalog = createModelCatalog(load)
  load.mockResolvedValueOnce({ ok: false, error: new RemoteError('gateway/internal', 'private', {}) })
  await catalog.refresh(); expect(catalog.getSnapshot()).toEqual({ status: 'error', groups: [], partial: false })
  load.mockResolvedValueOnce({ ok: true, value: { default: { provider: 'alpha', model: 'fast' }, routableProviders: ['alpha'], groups, failures: [] } })
  await catalog.refresh(); expect(catalog.getSnapshot()).toEqual({ status: 'ready', groups, partial: false })
  catalog.dispose()
})
it('后发请求拥有目录，部分供应商失败不丢失成功结果，旧拒绝不污染新连接', async () => {
  const pending: { resolve: (value: Result) => void; reject: (error: Error) => void }[] = []
  const load = vi.fn<Context['remote']['session']['modelCatalog']>(() => new Promise((resolve, reject) => { pending.push({ resolve, reject }) }))
  const catalog = createModelCatalog(load), changed = vi.fn(), off = catalog.subscribe(changed)
  expect(catalog.getSnapshot()).toBe(catalog.getSnapshot())
  const old = catalog.refresh(), latest = catalog.refresh()
  pending[1]!.resolve({ ok: true, value: { default: { provider: 'alpha', model: 'fast' }, routableProviders: ['alpha'], groups, failures: [{ id: 'beta', name: 'Beta', message: 'private transport detail' }] } })
  await latest
  expect(catalog.getSnapshot()).toEqual({ status: 'ready', groups, partial: true })
  pending[0]!.resolve({ ok: true, value: { default: { provider: 'alpha', model: 'fast' }, routableProviders: ['alpha'], groups: [], failures: [] } }); await old
  expect(catalog.getSnapshot().groups).toEqual(groups)
  const stale = catalog.refresh(); catalog.reset()
  expect(catalog.getSnapshot()).toEqual({ status: 'idle', groups: [], partial: false })
  pending[2]!.reject(new Error('old connection')); await stale
  expect(catalog.getSnapshot().status).toBe('idle')
  const failed = catalog.refresh(); pending[3]!.reject(new Error('secret')); await failed
  expect(catalog.getSnapshot()).toEqual({ status: 'error', groups: [], partial: false })
  const final = catalog.refresh(); off(); const count = changed.mock.calls.length
  catalog.dispose(); pending[4]!.resolve({ ok: true, value: { default: { provider: 'alpha', model: 'fast' }, routableProviders: ['alpha'], groups, failures: [] } }); await final
  catalog.reset(); await catalog.refresh()
  expect(load).toHaveBeenCalledTimes(5); expect(changed).toHaveBeenCalledTimes(count)
})
it('精确区分同名模型，目录消失后仍保留可删除的授权和草稿路由', () => {
  const stored = [{ provider: 'alpha', model: 'fast' }, { provider: 'beta', model: 'fast' }]
  const result = modelCandidates(groups, [...stored, stored[1]!])
  expect(result).toEqual([
    { ...stored[0], key: modelRouteKey(stored[0]!), providerName: 'Alpha', modelName: 'Fast', available: true },
    { ...stored[1], key: modelRouteKey(stored[1]!), providerName: 'beta', modelName: 'fast', available: false },
  ])
  expect(modelRouteKey({ provider: 'a\0b', model: 'c' })).not.toBe(modelRouteKey({ provider: 'a', model: 'b\0c' }))
  expect(modelCandidates([], [])).toEqual([])
})
