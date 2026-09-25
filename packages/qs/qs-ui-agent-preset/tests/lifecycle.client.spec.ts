// @vitest-environment jsdom
/** 目录只在被读取后响应失效，事件与设置贡献随插件装卸。 */
import { expect, it, vi } from 'vitest'
import { Service, type Context } from '@deepseek-ai/cordis'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { DirectoryInjected } from '../src/client/Directory.tsx'
import type { PresetSeatInjected } from '../src/client/PresetSeat.tsx'
import { QsSendPreparation } from '@deepseek-ai/dsh-qs-composer/src/client/preparation.ts'
import * as plugin from '../src/client/index.ts'
import { apply as host } from '../src/index.ts'
it('设置槽迟到可注册，刷新仅响应对应命名空间，卸载重装不保留监听', async () => {
  host()
  const runtime = await SlotTestRuntime.create()
  try {
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.ctx.provide('locale', locale); runtime.slots.installLocale(locale)
    const events = new Map<string, (ns: string) => void>()
    class Remote extends Service {
      constructor(ctx: Context) { super(ctx, 'remote') }
      $on(key: string, listener: (ns: string) => void) { events.set(key, listener); return () => { events.delete(key) } }
    }
    new Remote(runtime.ctx)
    const preparation = new QsSendPreparation(runtime.ctx)
    runtime.ctx.provide('settingsScope', { describe: () => ({ getSnapshot: () => ({ status: 'unavailable', error: null, view: undefined }), subscribe: () => () => {}, ensure: vi.fn(async () => {}), acceptView: vi.fn() }) } as never)
    const list = vi.fn().mockResolvedValue({ ok: true, value: { presets: [], authorable: false, modeSelectionEnabled: false } })
    const select = vi.fn<Context['remote']['agentPresets']['select']>()
    runtime.ctx.provide('remote.agentPresets', { list, select } as never)
    runtime.ctx.provide('remote.settings', { canOpenAgentPresetDirectory: vi.fn().mockResolvedValue({ ok: true, value: false }) } as never)
    let notify = () => {}
    const unsubscribe = vi.fn()
    vi.spyOn(runtime.ctx.sessions.list, 'subscribe').mockImplementation((listener) => { notify = listener; return unsubscribe })
    const first = await runtime.mount(plugin)
    expect(runtime.slots.entries('qs.settings.section')).toHaveLength(0)
    events.get('settings/document-updated')!('agent-presets'); runtime.ctx.emit('connection/reset')
    expect(list).not.toHaveBeenCalled()
    await runtime.declare({
      'qs.settings.section': { kind: 'list', scope: 'root' },
      'qs.workspace.hero.agentPreset': { kind: 'single', scope: 'root' },
      'qs.stage.header.actions': { kind: 'list', scope: 'session' },
    })
    const entry = runtime.slots.entries('qs.settings.section')[0]!
    expect((entry.options.label as () => string)()).toBe('Agent presets')
    const face = (entry.inject as unknown as () => DirectoryInjected)()
    await face.refresh(); expect(face.hooks.roster.getSnapshot().status).toBe('unavailable')
    expect(runtime.slots.entries('qs.stage.header.actions')).toHaveLength(1)
    const picker = runtime.slots.entries('qs.workspace.hero.agentPreset')[0]!
    const pickerFace = (picker.inject as unknown as () => PresetSeatInjected)()
    await pickerFace.select('missing'); notify()
    const empty = runtime.ctx.sessions.list.getSnapshot()
    const current = 'preset-test' as NonNullable<typeof empty.current>
    const getSnapshot = vi.spyOn(runtime.ctx.sessions.list, 'getSnapshot')
    for (const preset of ['standard', undefined]) {
      getSnapshot.mockReturnValue({ ...empty, current,
        byId: { [current]: { id: current, blank: true, projectionValues: { agentPreset: preset } } },
      } as typeof empty)
      notify()
      expect(pickerFace.hooks.seat.getSnapshot().current).toBe(preset ?? '')
    }
    getSnapshot.mockReturnValue(empty)
    notify()
    events.get('settings/document-updated')!('other'); expect(list).toHaveBeenCalledOnce()
    events.get('settings/document-updated')!('agent-presets'); expect(list).toHaveBeenCalledTimes(2)
    runtime.ctx.emit('connection/reset'); expect(list).toHaveBeenCalledTimes(3)
    list.mockResolvedValue({ ok: true, value: { presets: [{ id: 'custom', trust: 'user', isDefault: true }], modeSelectionEnabled: true, authorable: false } })
    await face.refresh()
    getSnapshot.mockReturnValue({ ...empty, current,
      byId: { [current]: { id: current, blank: true, projectionValues: { agentPreset: 'standard' } } },
    } as typeof empty)
    let reject!: (error: Error) => void
    select.mockImplementationOnce(() => new Promise((_resolve, refuse) => { reject = refuse }))
    const waiting = pickerFace.select('custom')
    const ready = preparation.forSession(current)
    expect(ready.getSnapshot()).toMatchObject({ sessionId: current, pending: true, reason: 'Applying preset…' })
    reject(new Error('private')); await waiting
    expect(ready.getSnapshot()).toMatchObject({ pending: false, reason: 'Preset selection failed. Retry to continue.' })
    select.mockResolvedValueOnce({ ok: true, value: 'custom' })
    await pickerFace.select('custom'); expect(ready.getSnapshot()).toBeUndefined()
    const delayed = Promise.withResolvers<Awaited<ReturnType<typeof select>>>()
    select.mockReturnValueOnce(delayed.promise)
    const interrupted = pickerFace.select('custom')
    expect(ready.getSnapshot()?.pending).toBe(true)
    await first.dispose()
    expect(ready.getSnapshot()).toMatchObject({ sessionId: current, pending: false })
    expect(ready.getSnapshot()?.reason).toContain('Re-enable the preset plugin')
    delayed.resolve({ ok: true, value: 'custom' }); await interrupted
    expect(ready.getSnapshot()?.pending).toBe(false)
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(events.size).toBe(0); expect(runtime.slots.entries('qs.settings.section')).toHaveLength(0)
    await runtime.mount(plugin); expect(events.size).toBe(1); expect(runtime.slots.entries('qs.settings.section')).toHaveLength(1)
    expect(ready.getSnapshot()?.pending).toBe(false)
    const replacement = runtime.slots.entries('qs.workspace.hero.agentPreset')[0]!
    const nextFace = (replacement.inject as unknown as () => PresetSeatInjected)()
    await nextFace.load()
    select.mockResolvedValueOnce({ ok: true, value: 'custom' })
    await nextFace.select('custom')
    expect(ready.getSnapshot()).toBeUndefined()
  } finally { await runtime.dispose() }
})
