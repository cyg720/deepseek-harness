// @vitest-environment jsdom
/** 独立模型贡献可迟到装配、卸载重装；目录始终来自官方服务。 */
import { expect, it, vi } from 'vitest'
import { Service, type Context } from '@deepseek-ai/cordis'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { CommandDecoration } from '@deepseek-ai/dsh-client-ui-commands/client'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { ModelSeatInjected } from '../src/client/ModelSeat.tsx'
import * as plugin from '../src/client/index.ts'
it('目录唯一，QS 装饰随槽释放，子会话与失效选择拒绝', async () => {
  const runtime = await SlotTestRuntime.create()
  try {
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.ctx.provide('locale', locale); runtime.slots.installLocale(locale)
    const state: ModelDirectoryState = { current: { provider: 'p', model: 'm' }, routable: true,
      groups: [{ id: 'p', name: 'Provider', models: [{ id: 'm', name: 'Model' }] }], failures: [], status: 'ready', error: null }
    const load = vi.fn(async () => state), select = vi.fn(async () => {})
    const directory = { store: { getSnapshot: () => state, subscribe: () => () => {} }, load, select }
    const forSession = vi.fn(() => directory), remove = vi.fn()
    let decoration: CommandDecoration | undefined
    class Models extends Service {
      constructor(ctx: Context) { super(ctx, 'modelDirectories') }
      directoryFor = forSession
    }
    class Commands extends Service {
      constructor(ctx: Context) { super(ctx, 'commandUi') }
      decorate(value: CommandDecoration) { decoration = value; return remove }
    }
    new Models(runtime.ctx); new Commands(runtime.ctx)
    const first = await runtime.mount(plugin)
    expect(decoration).toBeUndefined()
    await runtime.declare({ 'qs.composer.model': { kind: 'single', scope: 'session' } })
    expect(runtime.slots.entries('qs.composer.model')).toHaveLength(1)
    expect(decoration?.priority).toBe(1)
    const address = vi.spyOn(runtime.ctx.sessions, 'subagentAddress').mockReturnValue(undefined)
    const entry = runtime.slots.entries('qs.composer.model')[0]!
    const inject = entry.inject as unknown as (id: string) => ModelSeatInjected
    const face = inject('a')
    face.load(); await expect(face.select({ provider: 'p', model: 'm' })).resolves.toBe(true)
    expect(forSession).toHaveBeenCalledWith('a')
    expect(select).toHaveBeenCalledExactlyOnceWith({ provider: 'p', model: 'm' })
    const session = { sessionId: 'a' } as Parameters<NonNullable<CommandDecoration['available']>>[0]
    expect(decoration!.available(session)).toBe(true)
    const ui = decoration!.ui
    if (ui.kind !== 'popupSelect') throw new Error('Expected model selection popup')
    const options = await ui.options(session, new AbortController().signal)
    expect(options).toEqual([{ id: '["p","m"]', label: 'Model', detail: 'Provider', active: true }])
    await ui.onSelect(options[0]!, session)
    state.current = null
    expect((await ui.options(session, new AbortController().signal))[0]).not.toHaveProperty('active')
    await expect(ui.onSelect({ id: 'missing', label: 'Missing' }, session)).rejects.toThrow('Model operation failed')
    select.mockRejectedValueOnce(new Error('failed')); await expect(face.select({ provider: 'p', model: 'm' })).resolves.toBe(false)
    load.mockRejectedValueOnce(new Error('failed')); face.load()
    address.mockReturnValue({} as never)
    expect(decoration!.available(session)).toBe(false)
    const child = inject('child'); child.load()
    await expect(child.select({ provider: 'p', model: 'm' })).resolves.toBe(false)
    await expect(ui.options(session, new AbortController().signal)).rejects.toThrow('unavailable')
    await expect(ui.onSelect(options[0]!, session)).rejects.toThrow('unavailable')
    await first.dispose(); expect(remove).toHaveBeenCalledOnce()
    expect(runtime.slots.entries('qs.composer.model')).toHaveLength(0)
    await runtime.mount(plugin); expect(runtime.slots.entries('qs.composer.model')).toHaveLength(1)
  } finally { await runtime.dispose() }
})
