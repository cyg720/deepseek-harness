// @vitest-environment jsdom
/** 语言呈现使用同一官方服务，不能重挂 locale 或建立第二份偏好。 */
import { expect, it, vi } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { LanguageInjected } from '../src/client/index.ts'
import * as plugin from '../src/client/index.ts'
import { apply as host } from '../src/index.ts'
it('语言行等候通用槽、委派实际语言选择并释放重装', async () => {
  host()
  const runtime = await SlotTestRuntime.create()
  try {
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.ctx.provide('locale', locale); runtime.slots.installLocale(locale)
    const mirror = { getSnapshot: () => ({ status: 'unavailable', view: undefined, error: null }), subscribe: () => () => {} }
    runtime.ctx.provide('settingsScope', { describe: () => mirror } as never)
    const feature = await runtime.mount(plugin)
    expect(runtime.slots.entries('qs.settings.general.item')).toHaveLength(0)
    await runtime.declare({ 'qs.settings.general.item': { kind: 'list', scope: 'root' } })
    const entry = runtime.slots.entries('qs.settings.general.item')[0]!
    const face = (entry.inject as unknown as () => LanguageInjected)()
    expect(face.hooks.locale).toBe(locale); expect(face.hooks.settings).toBe(mirror)
    const observe = vi.fn(), off = face.hooks.locale.subscribe(observe)
    face.setLocale('zh'); expect(locale.getSnapshot().active).toBe('zh')
    face.setLocale('en'); expect(observe).toHaveBeenCalled()
    off(); await feature.dispose(); expect(runtime.slots.entries('qs.settings.general.item')).toHaveLength(0)
    expect(runtime.ctx.locale).toBe(locale)
    await runtime.mount(plugin); expect(runtime.slots.entries('qs.settings.general.item')).toHaveLength(1)
  } finally { await runtime.dispose() }
})
