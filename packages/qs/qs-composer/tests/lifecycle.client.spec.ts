// @vitest-environment jsdom
/** 输入插件通过官方会话服务收发状态；切换会话必须解除旧队列订阅。 */
import { expect, it, vi } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createConversationStore } from '@deepseek-ai/dsh-client-ui-conversation/src/client/stores.ts'
import type { ReadingInjected } from '../src/client/Reading.tsx'
import { apply, inject } from '../src/client/index.ts'
import type { EnterBehaviorInjected } from '../src/client/EnterBehaviorRow.tsx'
import type { QsComposerInjected } from '../src/client/contract.ts'
it.each([false, true])('可选服务就绪 %s 时输入动作和订阅正确绑定', async (ready) => {
  const runtime = await SlotTestRuntime.create()
  try {
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.ctx.provide('locale', locale); runtime.slots.installLocale(locale)
    let current: SessionId | undefined
    const listListeners = new Set<() => void>(), sessionListeners = new Set<() => void>()
    let queue = [{ id: 'item', text: 'queued', placement: 'queued' }]
    const cancel = vi.fn(), updateQueue = vi.fn().mockResolvedValue({ ok: true })
    let running = true
    let subagent: { address: { mode: string } } | undefined
    const session = { getSnapshot: () => ({ queue, running, subagent }), cancel, updateQueue,
      subscribe: (listener: () => void) => { sessionListeners.add(listener); return () => { sessionListeners.delete(listener) } },
    }
    const binding = { session }
    vi.spyOn(runtime.ctx.sessions, 'binding').mockImplementation(id => (id === 'one' ? binding : undefined) as ReturnType<typeof runtime.ctx.sessions.binding>)
    vi.spyOn(runtime.ctx.sessions, 'scope').mockReturnValue(ready ? {} as ReturnType<typeof runtime.ctx.sessions.scope> : undefined)
    vi.spyOn(runtime.ctx.sessions.list, 'getSnapshot').mockImplementation(() => ({ current }) as ReturnType<typeof runtime.ctx.sessions.list.getSnapshot>)
    vi.spyOn(runtime.ctx.sessions.list, 'subscribe').mockImplementation((listener) => { listListeners.add(listener); return () => { listListeners.delete(listener) } })
    const create = vi.spyOn(runtime.ctx.sessions, 'create').mockImplementation(async request => request!.sessionId!)
    const open = vi.spyOn(runtime.ctx.sessions, 'open').mockImplementation(() => {})
    const subscribe = vi.fn((_listener?: () => void) => vi.fn())
    const load = vi.fn().mockRejectedValue(new Error('offline'))
    const submit = vi.fn(), steerQueue = vi.fn()
    const inputSnapshot = { draft: 'draft' }
    runtime.ctx.provide('conversation', {
      input: { for: () => ({ submit, state: { getSnapshot: () => inputSnapshot }, notices: { getSnapshot: () => ({ text: 'notice' }), subscribe } }) },
      blocks: { storeFor: () => ready ? { getSnapshot: () => ({ reason: 'blocked' }), subscribe } : undefined },
    } as never)
    runtime.ctx.provide('remote', {} as never); runtime.ctx.provide('remote.session', {} as never)
    const setLocalFreeze = vi.fn()
    const readingStore = createConversationStore(), activate = vi.fn()
    const setBusyEnter = vi.fn(), busyEnter = { getSnapshot: () => 'steer' as const, subscribe }
    const resolve = vi.fn(() => 'steer' as const)
    runtime.ctx.provide('conversationPresentation', {
      submission: { busyEnter, setBusyEnter, resolve, steerQueue },
      store: readingStore, views: { getSnapshot: () => [], subscribe: () => () => {} }, activate,
    })
    if (ready) {
      runtime.ctx.provide('connection', { state: { getSnapshot: () => 'connected', subscribe } } as never)
      runtime.ctx.provide('modelDirectories', { directoryFor: () => ({ store: { getSnapshot: () => ({ current: { model: 'deepseek' } }), subscribe }, load }) } as never)
      runtime.ctx.reflect.provide('qsShell', { setLocalFreeze })
    }
    await runtime.declare({ 'qs.stage': { kind: 'single', scope: 'root' }, 'qs.settings.general.item': { kind: 'list', scope: 'root' } })
    const mounted = await runtime.mount({ inject, apply })
    const settingsEntry = runtime.slots.entries('qs.settings.general.item')[0]!
    expect(settingsEntry.options).toMatchObject({ id: 'composer-enter', order: 20 })
    const settings = (settingsEntry.inject as unknown as () => EnterBehaviorInjected)()
    expect(settings.hooks.busyEnter).toBe(busyEnter)
    settings.setBusyEnter('queue')
    expect(setBusyEnter).toHaveBeenCalledExactlyOnceWith('queue')
    if (ready) {
      const entry = runtime.slots.entries('qs.stage.reading')[0]!
      expect(entry.store).toBe(readingStore)
      const face = (entry.inject as unknown as (id: SessionId) => ReadingInjected)('one' as SessionId)
      const source = face.hooks.readingViews, notify = vi.fn(), off = source.subscribe(notify)
      const empty = source.getSnapshot()
      expect(empty).toEqual([]); expect(source.getSnapshot()).toBe(empty)
      const remove = runtime.slots.register({ name: 'qs.stage.view', id: 'trajectory', label: () => 'Trace' }, () => null)
      await vi.waitFor(() => { expect(notify).toHaveBeenCalled() })
      expect(source.getSnapshot()).toEqual([{ id: 'trajectory', label: 'Trace' }])
      face.activate('trajectory'); expect(activate).toHaveBeenCalledWith('one', 'trajectory')
      remove()
      const removeUnnamed = runtime.slots.register({ name: 'qs.stage.view', id: 'unlabeled' }, () => null)
      expect(source.getSnapshot()).toEqual([{ id: 'unlabeled', label: 'unlabeled' }])
      removeUnnamed(); off()
    }
    const factory = runtime.slots.entries('qs.composer')[0]!.inject as unknown as (id?: SessionId) => QsComposerInjected
    const unbound = factory(), bound = factory('one' as SessionId), missing = factory('missing' as SessionId)
    // 同一模式源订阅偏好与会话两端，取消订阅后不再保留会话监听。
    for (const face of [unbound, bound, missing]) {
      const notifyMode = vi.fn(), before = sessionListeners.size
      const offMode = face.hooks.qsSubmitMode.subscribe(notifyMode)
      expect(face.hooks.qsSubmitMode.getSnapshot()).toBe('steer')
      expect(resolve).toHaveBeenLastCalledWith(face === bound, 'enter', true)
      const preferenceListener = subscribe.mock.calls.at(-1)?.[0]
      preferenceListener?.()
      expect(notifyMode).toHaveBeenCalledOnce()
      for (const listener of sessionListeners) listener()
      expect(notifyMode).toHaveBeenCalledTimes(face === bound ? 2 : 1)
      offMode()
      expect(sessionListeners.size).toBe(before)
    }
    // 发送必须调用共享策略，并使用发送瞬间的运行状态。
    unbound.submitGesture('enter'); missing.submitGesture('enter')
    expect(submit).not.toHaveBeenCalled()
    bound.submitGesture('accelerated')
    if (ready) {
      expect(resolve).toHaveBeenLastCalledWith(true, 'accelerated', true)
      expect(submit).toHaveBeenLastCalledWith('steer')
      running = false
      bound.submitGesture('enter')
      expect(resolve).toHaveBeenLastCalledWith(false, 'enter', true)
      subagent = { address: { mode: 'continuable' } }
      bound.submitGesture('enter')
      expect(resolve).toHaveBeenLastCalledWith(false, 'enter', true)
      subagent = { address: { mode: 'snapshot' } }
      bound.submitGesture('accelerated')
      expect(resolve).toHaveBeenLastCalledWith(false, 'accelerated', false)
    } else expect(submit).not.toHaveBeenCalled()
    // 空草稿只允许忙碌、可引导会话的加速手势调用整队操作。
    if (ready) {
      inputSnapshot.draft = ''
      bound.submitGesture('accelerated')
      expect(steerQueue).not.toHaveBeenCalled()
      running = true
      bound.submitGesture('accelerated')
      expect(steerQueue).not.toHaveBeenCalled()
      subagent = { address: { mode: 'continuable' } }
      bound.submitGesture('enter')
      expect(steerQueue).not.toHaveBeenCalled()
      bound.submitGesture('accelerated')
      expect(steerQueue).toHaveBeenCalledTimes(1)
      subagent = undefined
      bound.submitGesture('accelerated')
      expect(steerQueue).toHaveBeenCalledTimes(2)
    }
    // 租约只对已归属输入取得，缺插件时不复制控制器。
    expect(unbound.acquireTriggerConsumer?.()).toBeUndefined()
    expect(bound.acquireTriggerConsumer?.()).toBeUndefined()
    const releaseTrigger = vi.fn()
    const acquireConsumer = vi.fn(() => ({ release: releaseTrigger }))
    runtime.ctx.reflect.provide('inputTriggers', { acquireConsumer })
    const release = bound.acquireTriggerConsumer?.()
    if (ready) {
      expect(acquireConsumer).toHaveBeenCalledWith(expect.anything(), { triggers: ['/'] })
      expect(release).toBe(releaseTrigger)
      release?.()
      expect(releaseTrigger).toHaveBeenCalledOnce()
    } else expect(acquireConsumer).not.toHaveBeenCalled()
    for (const face of [unbound, bound]) {
      const has = ready && face === bound
      expect(face.hooks.qsBlocked.getSnapshot()).toBe(has ? 'blocked' : undefined)
      expect(face.hooks.qsNotice.getSnapshot()).toBe(has ? 'notice' : undefined)
      expect(face.hooks.qsModel.getSnapshot()).toBe(has ? 'deepseek' : undefined)
      expect(face.hooks.qsConnected.getSnapshot()).toBe(ready)
      for (const hook of [face.hooks.qsBlocked, face.hooks.qsNotice, face.hooks.qsModel, face.hooks.qsConnected]) hook.subscribe(vi.fn())()
      face.loadModel()
    }
    await Promise.resolve()
    expect(load).toHaveBeenCalledTimes(ready ? 1 : 0)
    const local = unbound.hooks.qsComposer, notice = vi.fn(), off = local.subscribe(notice)
    const reserved = unbound.reserveSessionId()
    expect(unbound.reserveSessionId()).toBe(reserved)
    unbound.setUnownedDraft('draft'); unbound.setFrozen('sending')
    expect(local.getSnapshot()).toMatchObject({ unownedDraft: 'draft', frozen: true, freezeReason: 'sending' })
    unbound.setFrozen(undefined)
    expect(local.getSnapshot().frozen).toBe(false)
    unbound.setUnownedDraft('')
    expect(unbound.reserveSessionId()).not.toBe(reserved)
    expect(notice).toHaveBeenCalledTimes(4)
    off()
    // 弹层与创建请求各自持有冻结原因，释放一个不能解锁另一个。
    const releaseCommand = bound.acquireFreeze('command')
    const releaseConfirmation = bound.acquireFreeze('confirmation')
    unbound.setFrozen('sending')
    releaseCommand()
    releaseCommand()
    expect(local.getSnapshot().freezeReason).toBe('sending')
    unbound.setFrozen(undefined)
    expect(local.getSnapshot().freezeReason).toBe('confirmation')
    releaseConfirmation()
    expect(local.getSnapshot().frozen).toBe(false)
    const qsQueue = bound.hooks.qsQueue, changed = vi.fn(), unsubscribe = qsQueue.subscribe(changed)
    expect(qsQueue.getSnapshot()).toEqual([])
    current = 'one' as SessionId
    for (const listener of listListeners) listener()
    expect(sessionListeners.size).toBe(1)
    const rows = qsQueue.getSnapshot()
    expect(rows[0]?.text).toBe('queued'); expect(qsQueue.getSnapshot()).toBe(rows)
    queue = [{ id: 'item', text: 'updated', placement: 'queued' }]
    for (const listener of sessionListeners) listener()
    expect(qsQueue.getSnapshot()[0]?.text).toBe('updated')
    current = 'missing' as SessionId
    for (const listener of listListeners) listener()
    expect(sessionListeners.size).toBe(0); expect(qsQueue.getSnapshot()).toEqual([])
    unsubscribe(); expect(listListeners.size).toBe(0)
    for (const face of [unbound, missing]) {
      face.stop()
      expect(await face.removeQueueItem('item')).toBe(false)
      expect(await face.steerQueueItem('item')).toBe(false)
      expect(await face.editQueueItem('item', 'text')).toBe(false)
    }
    bound.stop(); expect(cancel).toHaveBeenCalledOnce()
    expect(await bound.removeQueueItem('item')).toBe(true)
    expect(await bound.steerQueueItem('item')).toBe(true)
    expect(await bound.editQueueItem('item', 'text')).toBe(true)
    expect(updateQueue.mock.calls).toEqual([['item', { kind: 'remove' }], ['item', { kind: 'steer' }], ['item', { kind: 'edit', content: [{ type: 'text', text: 'text' }] }]])
    expect(await unbound.createSession(reserved, new AbortController().signal)).toBe(reserved)
    expect(create).toHaveBeenCalledWith({ sessionId: reserved }); expect(open).toHaveBeenCalledWith(reserved)
    const releaseAfterDispose = bound.acquireFreeze('command')
    await mounted.dispose()
    expect(runtime.slots.entries('qs.settings.general.item')).toHaveLength(0)
    const afterDispose = local.getSnapshot()
    const freezeCallCount = setLocalFreeze.mock.calls.length
    releaseAfterDispose()
    bound.acquireFreeze('confirmation')()
    bound.setFrozen('sending')
    expect(local.getSnapshot()).toBe(afterDispose)
    expect(setLocalFreeze.mock.calls).toHaveLength(freezeCallCount)
    if (ready) expect(setLocalFreeze).toHaveBeenLastCalledWith(undefined)
    expect(await unbound.createSession(reserved, new AbortController().signal)).toBeUndefined()
  } finally { await runtime.dispose() }
})
