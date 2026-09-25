// @vitest-environment jsdom
/** 双呈现必须复用一个会话实例，卸载公开入口不能遗留旧服务。 */
import { expect, it, vi } from 'vitest'
import { SlotTestRuntime, stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import * as official from '../../src/client/index.ts'
import type { EnterBehaviorRowInjected } from '../../src/client/settings/EnterBehaviorRow.tsx'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'qs.test.reading': { kind: 'single'; scope: 'session'; owner: { children?: never } }
  }
}

it('共享草稿、视图及定位请求，注册信息更新后释放与重装入口', async () => {
  const runtime = await SlotTestRuntime.create()
  try {
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.ctx.provide('locale', locale); runtime.slots.installLocale(locale)
    runtime.ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
    runtime.ctx.provide('uiWorkspace', { openSession: vi.fn(), openWorkspace: vi.fn() } as never)
    const id = 'reading-owner' as SessionId
    await runtime.sessions.add({ id })
    await runtime.declare({ main: { kind: 'keyed', scope: 'root' }, 'qs.test.reading': { kind: 'single', scope: 'session' },
      'settings.general.item': { kind: 'list', scope: 'root' },
    })
    const feature = await runtime.mount(official)
    const shared = runtime.ctx.conversationPresentation
    const preference = runtime.slots.entries('settings.general.item').find(entry => entry.options.id === 'composer-enter')!
    const row = (preference.inject as unknown as () => EnterBehaviorRowInjected)()
    expect(shared.submission.busyEnter).toBe(row.hooks.busyEnter)
    shared.submission.setBusyEnter('steer')
    expect(row.hooks.busyEnter.getSnapshot()).toBe('steer')
    expect(shared.submission.resolve(true, 'enter', true)).toBe('steer')
    expect(shared.submission.resolve(true, 'accelerated', true)).toBe('queue')
    row.setBusyEnter('queue')
    expect(shared.submission.busyEnter.getSnapshot()).toBe('queue')
    expect(shared.submission.resolve(true, 'accelerated', true)).toBe('steer')
    expect(shared.submission.resolve(false, 'accelerated', true)).toBe('queue')
    expect(shared.submission.resolve(true, 'enter', false)).toBe('queue')
    expect(runtime.slots.entries('conversation.session')[0]!.store).toBe(shared.store)
    expect(runtime.slots.entries('conversation.session.header')[0]!.store).toBe(shared.store)
    const remove = runtime.slots.register({ name: 'qs.test.reading', store: shared.store }, () => null)
    runtime.renderSlot('qs.test.reading', {})
    const first = runtime.storeOf('conversation.session', id) as ReturnType<typeof shared.store.create>
    const second = runtime.storeOf('qs.test.reading', id) as ReturnType<typeof shared.store.create>
    expect(second).toBe(first)
    first.actions.setDraft('未发送草稿')
    second.actions.openView('trajectory', 'request-17')
    expect(first.getSnapshot()).toMatchObject({ draft: '未发送草稿', view: 'trajectory', viewRequest: { view: 'trajectory', focus: 'request-17' } })
    first.actions.completeViewRequest()
    expect(second.getSnapshot().viewRequest).toBeNull()
    const changed = vi.fn(), off = shared.views.subscribe(changed)
    const dropView = runtime.slots.register({ name: 'conversation.view', id: 'chat', label: 'Chat' }, () => null)
    await vi.waitFor(() => { expect(shared.views.getSnapshot()).toEqual([{ id: 'chat', label: 'Chat' }]) })
    expect(changed).toHaveBeenCalled()
    // target 构建算法由官方现有回归覆盖；这里只验证公开入口委托给同一绑定。
    const binding = runtime.ctx.uiConversation.binding(id)
    const activate = vi.spyOn(binding, 'activate').mockImplementation(() => {})
    shared.activate(id, null)
    expect(activate).toHaveBeenCalledWith('chat')
    activate.mockRestore()
    dropView(); off(); remove()
    await feature.dispose()
    expect(runtime.ctx.get('conversationPresentation')).toBeUndefined()
    await runtime.mount(official)
    expect(runtime.ctx.conversationPresentation).not.toBe(shared)
  } finally { await runtime.dispose() }
})
