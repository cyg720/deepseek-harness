// @vitest-environment jsdom
/** 共享显示偏好必须与官方设置行同源，并随插件释放及重装。 */
import { expect, it, vi } from 'vitest'
import { SlotTestRuntime, stubSettingsScope, TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import * as conversation from '@deepseek-ai/dsh-client-ui-conversation/client'
import { useSearchableHidden } from '../../src/client/chat/searchable-hidden.ts'
import * as chat from '../../src/client/index.ts'
import type { ChatSettings } from '../../src/chat-settings.ts'
import type { TranscriptViewRowInjected } from '../../src/client/settings/TranscriptViewRow.tsx'
it('官方与二开共享普通紧凑偏好，卸载后移除旧入口', async () => {
  const runtime = await SlotTestRuntime.create()
  try {
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.ctx.provide('locale', locale); runtime.slots.installLocale(locale)
    const host = stubSettingsScope<ChatSettings>()
    // Chat 与 Conversation 各自绑定命名空间，避免夹具把不同偏好混成同一个源。
    const bind = vi.fn(({ namespace }: { namespace: string }) =>
      namespace === 'ui-chat' ? host.scope : stubSettingsScope().scope,
    )
    runtime.ctx.provide('settingsScope', { bind } as never)
    runtime.ctx.provide('uiWorkspace', { openSession: vi.fn(), openWorkspace: vi.fn() } as never)
    runtime.ctx.provide('sidebarRight', { openResource: vi.fn() } as never)
    await runtime.declare({ main: { kind: 'keyed', scope: 'root' }, 'settings.general.item': { kind: 'list', scope: 'root' } })
    new TestRemote(runtime.ctx, { session: { openWorkspacePath: vi.fn(async () => ({ ok: true, value: { opened: true } })) } })
    await runtime.mount(conversation)
    const mounted = await runtime.mount(chat)
    const shared = runtime.ctx.chatPresentation
    expect(shared.useSearchableHidden).toBe(useSearchableHidden)
    const entry = runtime.slots.entries('settings.general.item').find(value => value.options.id === 'transcript-view')!
    const row = (entry.inject as unknown as () => TranscriptViewRowInjected)()
    expect(bind).toHaveBeenCalledWith({ namespace: 'ui-chat' })
    expect(shared.transcriptView).toBe(row.hooks.transcriptView)
    expect(shared.transcriptView.getSnapshot()).toBe('compact')
    shared.setTranscriptView('normal')
    expect(row.hooks.transcriptView.getSnapshot()).toBe('normal')
    row.setTranscriptView('compact')
    expect(shared.transcriptView.getSnapshot()).toBe('compact')
    expect(host.set.mock.calls).toEqual([['transcriptView', 'normal'], ['transcriptView', 'compact']])
    // Host 接受的新值必须同时更新两个呈现端，且读取不能再次触发写入。
    host.publish({ status: 'ready', value: { transcriptView: 'normal' }, revision: 1, writable: true })
    expect(shared.transcriptView.getSnapshot()).toBe('normal')
    expect(row.hooks.transcriptView.getSnapshot()).toBe('normal')
    shared.setTranscriptView('normal')
    expect(host.set).toHaveBeenCalledTimes(2)
    await mounted.dispose()
    expect(runtime.ctx.get('chatPresentation')).toBeUndefined()
    await runtime.mount(chat)
    expect(runtime.ctx.chatPresentation).not.toBe(shared)
    expect(runtime.ctx.chatPresentation.transcriptView.getSnapshot()).toBe('normal')
  } finally { await runtime.dispose() }
})
