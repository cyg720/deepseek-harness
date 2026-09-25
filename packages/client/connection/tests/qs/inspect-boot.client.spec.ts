/** 装配夹具支持官方启动时的只读 Cordis 名录调用，未知接口仍必须报错。 */
import { expect, it } from 'vitest'
import { createFixtureConnectionRpc } from '../../src/client/fixture.ts'
it('支持空动态插件名录和检查清单同步，拒绝未实现调用', async () => {
  const rpc = createFixtureConnectionRpc()
  expect(await rpc.call('/api', 'dynamicCordisRunner/syncInspectManifest', { args: { providers: [] } })).toEqual({ ok: true, value: null })
  expect(await rpc.call('/api', 'dynamicCordisRunner/inventory', { args: {} })).toEqual({ ok: true, value: [] })
  await expect(rpc.call('/api', 'dynamicCordisRunner/unknown', { args: {} })).rejects.toThrow('is unavailable')
})
