// @vitest-environment jsdom
/** 只读 RPC 延迟到页面读取，父槽与贡献释放可重复装配。 */
import { Service, type Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import * as plugin from '../src/client/index.ts'
import type { InventoryInjected } from '../src/client/Inventory.tsx'
import { apply as host } from '../src/index.ts'
it('父槽迟到、服务载荷、预设翻译和卸载重装', async () => {
  host(); const runtime = await SlotTestRuntime.create()
  try {
    const locale = new LocaleRuntime(runtime.ctx); runtime.ctx.provide('locale', locale); runtime.slots.installLocale(locale)
    class Remote extends Service { constructor(ctx: Context) { super(ctx, 'remote') } }
    new Remote(runtime.ctx)
    const list = vi.fn().mockResolvedValue({ ok: true, value: { entries: [] } })
    runtime.ctx.provide('remote.pluginInventory', { list })
    const feature = await runtime.mount(plugin)
    expect(list).not.toHaveBeenCalled(); expect(runtime.slots.entries('qs.settings.plugins.tab')).toHaveLength(0)
    await runtime.declare({ 'qs.settings.plugins.tab': { kind: 'list', scope: 'root' } })
    const entry = runtime.slots.entries('qs.settings.plugins.tab')[0]!
    expect(resolveSlotLabel(entry.options.label)).toBe(locale.getSnapshot().active === 'zh' ? '插件列表' : 'Plugin list')
    const face = (entry.inject as unknown as () => InventoryInjected)()
    await expect(face.list()).resolves.toEqual({ entries: [] })
    list.mockResolvedValueOnce({ ok: false, error: { code: 'REFUSED', message: 'private detail' } })
    await expect(face.list()).rejects.toThrow('pluginInventory.list refused')
    expect(face.presetName({ id: 'mine', trust: 'user', name: '私人预设', isDefault: false, rows: [] })).toBe('私人预设')
    await feature.dispose(); expect(runtime.slots.entries('qs.settings.plugins.tab')).toHaveLength(0)
    await runtime.mount(plugin); expect(runtime.slots.entries('qs.settings.plugins.tab')).toHaveLength(1)
  } finally { await runtime.dispose() }
})
