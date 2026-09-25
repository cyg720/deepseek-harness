// @vitest-environment jsdom
import { useSearchableHidden } from '@deepseek-ai/dsh-client-ui-chat/src/client/chat/searchable-hidden.ts'
/** 使用真实槽注册表验证分页快照稳定性、节点订阅与会话阅读位置隔离。 */
import { expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import * as host from '@deepseek-ai/dsh-qs-transcript'
import { apply, inject } from '../src/client/index.ts'
import type { QsTranscriptInjected } from '../src/client/contract.ts'
import type { TranscriptViewInjected } from '../src/client/TranscriptViewRow.tsx'
it('分页订阅随状态更新，节点目标可迟到且会话阅读位置不串用', async () => {
  const runtime = await SlotTestRuntime.create()
  try {
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.ctx.provide('locale', locale); runtime.slots.installLocale(locale)
    let state = { hasMore: true, loadingOlder: false, historyLoad: { phase: 'idle' as const } }
    const listeners = new Set<() => void>()
    const loadOlder = vi.fn(), reconnect = vi.fn()
    const binding = { session: { getSnapshot: () => state, loadOlder,
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    } }
    const other = { session: binding.session }
    vi.spyOn(runtime.ctx.sessions, 'binding').mockImplementation(id => (id === 'one' ? binding : id === 'two' ? other : undefined) as ReturnType<typeof runtime.ctx.sessions.binding>)
    const stateChat: { value: ChatSnapshot | undefined } = { value: undefined }
    const node = { getSnapshot: () => undefined, subscribe: vi.fn(() => () => {}) }
    const process = { getSnapshot: () => undefined, subscribe: vi.fn(() => () => {}) }
    const source = vi.fn(() => node), processSource = vi.fn(() => process)
    const target = vi.fn(() => ({ getSnapshot: () => stateChat.value }))
    const imageUrl = vi.fn(async () => 'blob:image')
    runtime.ctx.provide('uiConversation', { binding: () => ({ target }), imageUrl } as never)
    const openResource = vi.fn()
    const mode = createSnapshotStore<'normal' | 'compact'>('compact')
    runtime.ctx.provide('chatPresentation', { useSearchableHidden, transcriptView: mode, setTranscriptView: (value) => { mode.set(value) } })
    runtime.ctx.provide('sidebarRight', { openResource } as never)
    runtime.ctx.provide('connection', { reconnect, state: { getSnapshot: () => 'connected', subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } } } } as never)
    await runtime.declare({
      'qs.stage.transcript': { kind: 'single', scope: 'session' },
      'qs.settings.general.item': { kind: 'list', scope: 'root' },
    })
    const mounted = await runtime.mount({ inject, apply })
    const factory = runtime.slots.entries('qs.stage.transcript')[0]!.inject as unknown as (id: SessionId) => QsTranscriptInjected
    expect(() => factory('missing' as SessionId)).toThrow('unknown session')
    const face = factory('one' as SessionId), again = factory('one' as SessionId)
    const setting = runtime.slots.entries('qs.settings.general.item').find(entry => entry.options.id === 'transcript-view')!
    expect(setting.options.order).toBe(12)
    const preference = (setting.inject as unknown as () => TranscriptViewInjected)()
    expect(preference.hooks.transcriptView).toBe(mode)
    preference.setTranscriptView('normal')
    expect(mode.getSnapshot()).toBe('normal')
    preference.setTranscriptView('compact')
    const modeChanged = vi.fn()
    const stopMode = face.hooks.qsCompactTranscript.subscribe(modeChanged)
    expect(face.hooks.qsCompactTranscript.getSnapshot()).toBe(true)
    mode.set('normal')
    expect(face.hooks.qsCompactTranscript.getSnapshot()).toBe(false)
    expect(modeChanged).toHaveBeenCalledOnce()
    stopMode()
    mode.set('compact')
    expect(modeChanged).toHaveBeenCalledOnce()
    expect(target).toHaveBeenCalledTimes(1)
    expect(again.readScroll()).toBeUndefined()
    const history = face.hooks.qsHistory, notice = vi.fn(), off = history.subscribe(notice)
    expect(face.hooks.qsHistoryConnected.getSnapshot()).toBe(true)
    const connectionOff = face.hooks.qsHistoryConnected.subscribe(vi.fn())
    connectionOff()
    const before = history.getSnapshot()
    expect(history.getSnapshot()).toBe(before)
    state = { hasMore: false, loadingOlder: false, historyLoad: { phase: 'idle' as const } }
    for (const listener of listeners) listener()
    expect(notice).toHaveBeenCalledOnce()
    expect(history.getSnapshot()).toEqual(state)
    expect(history.getSnapshot()).not.toBe(before)
    state = { hasMore: false, loadingOlder: true, historyLoad: { phase: 'idle' as const } }
    expect(history.getSnapshot().loadingOlder).toBe(true)
    off(); expect(listeners.size).toBe(0)
    for (const empty of [face.keyedHooks.node('n'), face.keyedHooks.process('p')]) {
      expect(empty.getSnapshot()).toBeUndefined()
      const callback = vi.fn(); empty.subscribe(callback)()
      expect(callback).not.toHaveBeenCalled()
    }
    stateChat.value = { nodes: { source, processSource } } as unknown as ChatSnapshot
    expect(face.keyedHooks.node('n')).toBe(node)
    expect(source).toHaveBeenCalledWith('n')
    expect(face.keyedHooks.process('p')).toBe(process)
    expect(processSource).toHaveBeenCalledWith('p')
    face.loadOlder(); face.retryHistory()
    expect(loadOlder).toHaveBeenCalledOnce(); expect(reconnect).toHaveBeenCalledOnce()
    face.saveScroll({ top: 120, follow: false })
    expect(again.readScroll()).toEqual({ top: 120, follow: false })
    expect(factory('two' as SessionId).readScroll()).toBeUndefined()
    // 图片装载按会话签发；折叠状态按会话隔离，且同一会话复用同一实例。
    await expect(face.loadImage({ attachmentId: 'a' } as never)).resolves.toBe('blob:image')
    expect(imageUrl).toHaveBeenCalledWith('one', { attachmentId: 'a' })
    // 可选词表缺席时不造链接；存在时保留当前会话并使用官方文件地址导航。
    const owner = { turn: {}, seq: 10 } as Parameters<typeof face.fileMentions>[0]
    expect(face.fileMentions(owner)).toBeUndefined()
    const forClosing = vi.fn((value: import('@deepseek-ai/dsh-client-ui-chat/client').TurnTailOwnerProps) => {
      value.openFile('report.txt')
      return undefined
    })
    runtime.ctx.provide('chatFileMentions', { forClosing })
    face.fileMentions(owner)
    expect(forClosing).toHaveBeenCalledWith(expect.objectContaining({ turn: owner.turn, seq: 10 }), 'one')
    expect(openResource).toHaveBeenCalledWith('dsh-resource://file/session/one/report.txt')
    expect(face.fold.isOpen('one|1|1')).toBe(false)
    expect(again.fold).toBe(face.fold)
    expect(factory('two' as SessionId).fold).not.toBe(face.fold)
    expect(() => { host.apply() }).not.toThrow()
    // 后装贡献无需修改内建白名单；卸载恢复兜底并保持快照引用稳定。
    const keys = face.hooks.qsRowKeys
    const keyChanged = vi.fn()
    const unsubscribeKeys = keys.subscribe(keyChanged)
    const original = keys.getSnapshot()
    expect(keys.getSnapshot()).toBe(original)
    const offRow = runtime.slots.register({ name: 'qs.stage.transcript.row', key: 'qs-m0-extra' }, () => null)
    await Promise.resolve() // 注册表在微任务中批量通知。
    expect(keys.getSnapshot()).toContain('qs-m0-extra')
    expect(keys.getSnapshot()).toBe(keys.getSnapshot())
    offRow()
    expect(keys.getSnapshot()).not.toContain('qs-m0-extra')
    expect(keyChanged).toHaveBeenCalled()
    unsubscribeKeys()
    await mounted.dispose()
    expect(runtime.slots.entries('qs.stage.transcript')).toHaveLength(0)
    expect(runtime.slots.entries('qs.settings.general.item')).toHaveLength(0)
  } finally { await runtime.dispose() }
})
