// @vitest-environment jsdom
/** 审批索引按会话缓存并随官方 Chat 快照更新，不能混用其他会话的调用详情。 */
import { expect, it, vi } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { QsInteractionOwnerProps } from '@deepseek-ai/dsh-qs-transcript/client'
import { apply, inject } from '../src/client/index.ts'
import type { QsApprovalInjected } from '../src/client/contract.ts'
it('调用索引复用稳定快照，目标清空后撤下旧详情', async () => {
  const runtime = await SlotTestRuntime.create()
  try {
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.ctx.provide('locale', locale); runtime.slots.installLocale(locale)
    const binding = {}, other = {}
    vi.spyOn(runtime.ctx.sessions, 'binding').mockImplementation(id => (id === 'one' ? binding : id === 'two' ? other : undefined) as ReturnType<typeof runtime.ctx.sessions.binding>)
    let chat: ChatSnapshot | undefined
    const subscribe = vi.fn(() => vi.fn())
    const target = vi.fn(() => ({ getSnapshot: () => chat, subscribe }))
    runtime.ctx.provide('uiConversation', { binding: () => ({ target }) } as never)
    await runtime.declare({ 'qs.stage.interaction': { kind: 'chain', scope: 'session' } })
    await runtime.mount({ inject, apply })
    const entry = runtime.slots.entries('qs.stage.interaction')[0]!
    const factory = entry.inject as unknown as (id: string) => QsApprovalInjected
    expect(() => factory('missing')).toThrow('unknown session')
    const source = factory('one').hooks.approvalDetail
    expect(factory('one').hooks.approvalDetail).toBe(source)
    expect(factory('two').hooks.approvalDetail).not.toBe(source)
    expect(target).toHaveBeenCalledTimes(2)
    const initial = source.getSnapshot()
    expect(initial.size).toBe(0); expect(source.getSnapshot()).toBe(initial)
    const nodes = [{ kind: 'tool-call', data: { root: { callId: 'call', name: 'pwsh', argsRaw: '{"script":"echo ok"}' } } }]
    const values = vi.fn(() => nodes)
    chat = { nodes: { values } } as unknown as ChatSnapshot
    const indexed = source.getSnapshot()
    expect(indexed.get('call')).toEqual({ callId: 'call', name: 'pwsh', argsRaw: '{"script":"echo ok"}' })
    expect(source.getSnapshot()).toBe(indexed); expect(values).toHaveBeenCalledOnce()
    const listener = vi.fn(), off = source.subscribe(listener)
    expect(subscribe).toHaveBeenCalledWith(listener)
    off(); expect(subscribe.mock.results[0]!.value).toHaveBeenCalledOnce()
    chat = undefined
    expect(source.getSnapshot().size).toBe(0)
    const select = entry.select as unknown as (owner: QsInteractionOwnerProps) => unknown
    for (const kind of ['approval', 'question']) {
      const pendingInteraction = { kind } as QsInteractionOwnerProps['pendingInteraction']
      expect(select({ sessionId: 'one', pendingInteraction })).toBe(kind === 'approval' ? pendingInteraction : null)
      expect(select({ sessionId: undefined, pendingInteraction })).toBeNull()
    }
    expect(select({ sessionId: 'one', pendingInteraction: undefined })).toBeNull()
  } finally { await runtime.dispose() }
})
