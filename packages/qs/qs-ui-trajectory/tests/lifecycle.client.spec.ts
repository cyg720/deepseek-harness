// @vitest-environment jsdom
/** target 生命周期控制呈现，不能留下失效入口或重复事件定义。 */
import { expect, it, vi } from 'vitest'
import { createConversationStore } from '@deepseek-ai/dsh-client-ui-conversation/src/client/stores.ts'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TrajectorySnapshot } from '@deepseek-ai/dsh-client-ui-trajectory/client'
import type { TrajectoryInjected, InspectInjected } from '../src/client/contract.ts'
import * as plugin from '../src/client/index.ts'
import { apply as host } from '../src/index.ts'
it('target 加载、卸载及重装仅维护一份呈现并使用当前会话分页', async () => {
  host()
  const runtime = await SlotTestRuntime.create()
  try {
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.ctx.provide('locale', locale); runtime.slots.installLocale(locale)
    const id = 'trace-test' as SessionId, loadOlder = vi.fn(async () => {})
    await runtime.sessions.add({ id, session: { loadOlder } })
    await runtime.declare({ 'qs.stage.view': { kind: 'list', scope: 'session' }, 'qs.tool.call.actions': { kind: 'list', scope: 'session' } })
    const sharedStore = createConversationStore(), activate = vi.fn()
    runtime.ctx.provide('conversationPresentation', { store: sharedStore, activate } as never)
    let available = false, connected = false, snapshot: TrajectorySnapshot | undefined = undefined
    const listeners = new Set<() => void>(), offSource = vi.fn()
    const source = { getSnapshot: () => snapshot, subscribe: () => offSource }
    runtime.ctx.provide('connection', { state: { getSnapshot: () => connected ? 'connected' : 'disconnected', subscribe: () => offSource } } as never)
    const imageUrl = vi.fn(async () => 'blob:authorized'), peekImageUrl = vi.fn(() => 'blob:cached')
    runtime.ctx.provide('uiConversation', {
      imageUrl, peekImageUrl,
      views: { entries: () => available ? [{ target: 'trajectory' }] : [], subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } } },
      binding: () => ({ target: () => source }),
    } as never)
    let imageSeats = 0
    runtime.slots.inject('qs.conversation.trajectory.images', () => {
      imageSeats++
      return () => { imageSeats-- }
    })
    const feature = await runtime.mount(plugin)
    const action = runtime.slots.entries('qs.tool.call.actions')[0]!
    expect(action.store).toBe(sharedStore)
    const inspect = (action.inject as unknown as (id: SessionId) => InspectInjected)(id)
    expect(inspect.hooks.available.getSnapshot()).toBe(false)
    const offAvailable = inspect.hooks.available.subscribe(vi.fn())
    expect(runtime.slots.entries('qs.stage.view')).toHaveLength(0)
    available = true; for (const listener of listeners) listener()
    for (const listener of listeners) listener()
    expect(runtime.slots.entries('qs.stage.view')).toHaveLength(1)
    expect(inspect.hooks.available.getSnapshot()).toBe(true)
    inspect.activate()
    expect(activate).toHaveBeenCalledWith(id, 'trajectory')
    offAvailable()
    const entry = runtime.slots.entries('qs.stage.view')[0]!
    expect(typeof entry.options.label === 'function' ? entry.options.label() : '').toBeTruthy()
    const inject = entry.inject as unknown as (id: SessionId) => TrajectoryInjected
    expect(() => inject('missing' as SessionId)).toThrow('requires a session binding')
    expect(imageSeats).toBe(1)
    const face = inject(id)
    face.reading.scrollTop = 125
    expect(inject(id).reading).toBe(face.reading)
    const other = 'other-trace' as SessionId
    await runtime.sessions.add({ id: other, session: { loadOlder } })
    expect(inject(other).reading.scrollTop).toBe(0)
    expect(inject(other).reading).not.toBe(face.reading)
    const image = { attachmentId: 'image' as never, mediaType: 'image/png' as const, bytes: 1, width: 1, height: 1 }
    expect(await face.loadImage(image)).toBe('blob:authorized')
    expect(face.loadImage.peek?.(image)).toBe('blob:cached')
    expect(imageUrl).toHaveBeenCalledWith(id, image)
    expect(peekImageUrl).toHaveBeenCalledWith(id, image)
    expect(face.hooks.partial.getSnapshot()).toBeNull()
    const emptyCalls = face.hooks.runningCalls.getSnapshot()
    expect(face.hooks.runningCalls.getSnapshot()).toBe(emptyCalls)
    const empty = face.hooks.requests.getSnapshot()
    expect(face.hooks.requests.getSnapshot()).toBe(empty)
    const emptyNodes = face.hooks.nodes.getSnapshot()
    expect(face.hooks.nodes.getSnapshot()).toBe(emptyNodes)
    snapshot = { requests: [], eventNodes: [], eventLocations: new Map(), callSchemas: new Map(), partial: null, runningCalls: [] }
    expect(face.hooks.requests.getSnapshot()).toBe(snapshot.requests)
    expect(face.hooks.nodes.getSnapshot()).toBe(snapshot.eventNodes)
    expect(face.hooks.runningCalls.getSnapshot()).toBe(snapshot.runningCalls)
    snapshot = { ...snapshot, partial: { turn: 1, step: 1, blocks: [] } }
    expect(face.hooks.partial.getSnapshot()).toBe(snapshot.partial)
    face.hooks.partial.subscribe(vi.fn())(); face.hooks.runningCalls.subscribe(vi.fn())()
    face.hooks.nodes.subscribe(vi.fn())()
    face.hooks.requests.subscribe(vi.fn())(); face.hooks.connected.subscribe(vi.fn())()
    expect(offSource).toHaveBeenCalledTimes(5)
    expect(face.hooks.connected.getSnapshot()).toBe(false)
    connected = true; expect(face.hooks.connected.getSnapshot()).toBe(true)
    await face.loadOlder(); expect(loadOlder).toHaveBeenCalledOnce()
    available = false; for (const listener of listeners) listener()
    expect(runtime.slots.entries('qs.stage.view')).toHaveLength(0)
    available = true; for (const listener of listeners) listener()
    await feature.dispose()
    expect(imageSeats).toBe(0)
    expect(runtime.slots.entries('qs.tool.call.actions')).toHaveLength(0)
    expect(listeners.size).toBe(0); expect(runtime.slots.entries('qs.stage.view')).toHaveLength(0)
    await runtime.mount(plugin)
    expect(runtime.slots.entries('qs.stage.view')).toHaveLength(1)
  } finally { await runtime.dispose() }
})
