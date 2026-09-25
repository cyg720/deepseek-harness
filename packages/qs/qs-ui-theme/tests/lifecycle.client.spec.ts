// @vitest-environment jsdom
/** 呈现卸载不释放官方主题服务，变更事件订阅随消费者释放。 */
import { expect, it, vi } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { ThemeRuntime } from '@deepseek-ai/dsh-client-ui-theme/client'
import type { ThemeInjected } from '../src/client/index.ts'
import * as plugin from '../src/client/index.ts'
import { apply as host } from '../src/index.ts'
it('两行独立注册，委派唯一官方服务并支持释放重装', async () => {
  host()
  const runtime = await SlotTestRuntime.create()
  try {
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.ctx.provide('locale', locale); runtime.slots.installLocale(locale)
    const set = vi.fn(), scope = { getSnapshot: () => ({ value: { preference: 'system', fontSize: 14 } }), subscribe: () => () => {}, set }
    const theme = new ThemeRuntime(runtime.ctx, scope as never)
    runtime.ctx.provide('theme', theme)
    const mirror = { getSnapshot: () => ({ status: 'unavailable', view: undefined, error: null }), subscribe: () => () => {} }
    runtime.ctx.provide('settingsScope', { describe: () => mirror } as never)
    const feature = await runtime.mount(plugin)
    expect(runtime.slots.entries('qs.settings.general.item')).toHaveLength(0)
    await runtime.declare({ 'qs.settings.general.item': { kind: 'list', scope: 'root' } })
    const rows = runtime.slots.entries('qs.settings.general.item')
    expect(rows.map(row => [row.options.id, row.options.order])).toEqual([['appearance', 10], ['font-size', 11]])
    const face = (rows[0]!.inject as unknown as () => ThemeInjected)()
    expect(face.hooks.theme.getSnapshot()).toBe(theme.getTheme()); expect(face.hooks.settings).toBe(mirror)
    const observe = vi.fn(), off = face.hooks.theme.subscribe(observe)
    face.setTheme('dark'); expect(set).toHaveBeenLastCalledWith('preference', 'dark')
    face.setFontSize(17); expect(set).toHaveBeenLastCalledWith('fontSize', 17)
    expect(face.hooks.theme.getSnapshot()).toMatchObject({ preference: 'dark', fontSize: 17 })
    expect(observe).toHaveBeenCalledTimes(2)
    off(); face.setFontSize(12); expect(observe).toHaveBeenCalledTimes(2)
    await feature.dispose(); expect(runtime.slots.entries('qs.settings.general.item')).toHaveLength(0)
    expect(runtime.ctx.theme).toBe(theme)
    await runtime.mount(plugin); expect(runtime.slots.entries('qs.settings.general.item')).toHaveLength(2)
  } finally { await runtime.dispose() }
})
