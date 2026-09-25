/** 真实 Loader 条目验证附加呈现选择、回滚与卸载；不启动应用或打开系统弹窗。 */
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { afterEach, expect, it, vi } from 'vitest'
import * as auto from '../../src/index.ts'

// 只固定环境判定；Loader、Fiber 和卸载事务使用真实实现。
const choice = vi.hoisted(() => ({ kind: 'browse' as 'native' | 'browse' }))
vi.mock('../../src/resolve.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/resolve.ts')>(),
  resolveDirectoryPickerBackend: () => choice.kind,
}))
afterEach(() => { choice.kind = 'browse' })

it.each(['native', 'browse'] as const)('%s 未配置附加呈现时只挂载官方两项，卸载后清空', async (kind) => {
  choice.kind = kind
  const ctx = new Context()
  const live = new Set<string>()
  try {
    ctx.provide('webServer', { host: '0.0.0.0' })
    await ctx.plugin(Loader)
    ctx.loader.internal = {
      version: 'v2',
      async import(name: string) {
        return { name, apply(scope: Context) {
          scope.effect(() => { live.add(name); return () => { live.delete(name) } })
        } }
      },
    } as unknown as NonNullable<typeof ctx.loader.internal>
    // 直接调用公开 apply 的缺省参数，验证非 schema 调用方同样获得官方装配。
    await auto.apply(ctx)
    expect([...live]).toEqual([auto.BACKEND_PACKAGES[kind], auto.SURFACE_PACKAGES[kind]])
    await ctx.fiber.dispose()
    expect(live.size).toBe(0)
  } finally { await ctx.fiber.dispose() }
})

it.each([
  ['browse', false], ['browse', true], ['native', false], ['native', true],
] as const)('%s 附加呈现失败=%s，Host 和已加载呈现均受同一卸载事务管理', async (kind, fail) => {
  choice.kind = kind
  const ctx = new Context()
  const mounted: string[] = []
  const live = new Set<string>()
  try {
    ctx.provide('webServer', { host: '0.0.0.0' })
    await ctx.plugin(Loader)
    ctx.loader.internal = {
      version: 'v2',
      async import(name: string) {
        if (name === 'qs-auto-test') return auto
        if (name === `qs-${kind}` && fail) throw new Error('controlled additional failure')
        return { name, apply(scope: Context) {
          scope.effect(() => {
            mounted.push(name); live.add(name)
            return () => { live.delete(name) }
          })
        } }
      },
    } as unknown as NonNullable<typeof ctx.loader.internal>
    const loaded = ctx.loader.create({ name: 'qs-auto-test', config: { additionalClientSurfaces: { native: ['qs-native'], browse: ['qs-browse'] } } })
    let id: string | undefined
    if (fail) await expect(loaded).rejects.toThrow('controlled additional failure')
    else id = await loaded
    expect(mounted).not.toContain(kind === 'native' ? 'qs-browse' : 'qs-native')
    if (fail) expect(live.size).toBe(0)
    else expect([...live]).toEqual([auto.BACKEND_PACKAGES[kind], auto.SURFACE_PACKAGES[kind], `qs-${kind}`])
    if (id !== undefined) await ctx.loader.remove(id)
    expect(live.size).toBe(0)
  } finally { await ctx.fiber.dispose() }
})

it('加载前拒绝重复官方呈现', async () => {
  const ctx = new Context()
  try {
    await expect(auto.apply(ctx, { additionalClientSurfaces: { browse: [auto.SURFACE_PACKAGES.browse] } })).rejects.toThrow('duplicate')
  } finally { await ctx.fiber.dispose() }
})
