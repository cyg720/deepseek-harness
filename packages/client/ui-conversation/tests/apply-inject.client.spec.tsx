// @vitest-environment jsdom
// apply inject factories exercised end to end against the terminal thin
// API: the strict session API (views triple, draft mirror), the
// provide-channel input face (machine-sink submit choreography incl.
// transactional clear + failure retention), the resident API (selectWorkspace
// draft carrying), the composer-bar stop face, openDetails = select action +
// layout orchestration, and the closeDetails details API. Complements
// chat-apply.spec.tsx (registration) and selection-survival.spec.tsx (store
// axis). History opening is NOT an inject concern — the runtime sessions
// service opens on watch (sessions-service.spec.ts owns that behavior).
//
// The inject APIs are read off the ledger entries deliberately (typed at
// this spec's own contract): these cases pin factory choreography the UI
// guards would mask. Rendering-path acceptance lives in
// chat-toolview-slot.spec.tsx.
/**
 * 文件职责：验证会话界面的 apply-inject.client.spec.tsx 行为和边界。
 * 技术维度：Vitest、React 测试渲染、事件模拟与可控服务替身。
 * 产品维度：防止会话界面交互和展示在扩展后回归。
 * 逻辑维度：构造状态，触发渲染或交互，再断言输出和清理。
 * 关键边界：全局替身、计时器和异步任务必须在用例后恢复。
 * 新手阅读建议：先读辅助夹具，再按 describe 场景顺序阅读。
 */

import { describe, expect, it, vi } from 'vitest'
import { SlotTestRuntime, usePinnedBrowserLanguages, stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionBehaviorOverrides } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { ISession, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  ChatViewInjected, ComposerBarInjected, ConversationInjected, ConversationSessionHeaderInjected,
  ConversationSessionInjected, DetailsInjected,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { createChatStore } from '../src/client/stores.ts'

// The service reads its initial locale from the browser; these specs assert
// the shipped Chinese copy, so they state the browser they assume.
usePinnedBrowserLanguages('zh-CN')

/** 中文说明：测试局部值 ROOT，取值由紧邻初始化决定。 */
const ROOT = 'root-1' as SessionId

/** 中文说明：类型或类 ChatInstance 约束本文件的数据或组件职责。 */
type ChatInstance = ReturnType<ReturnType<typeof createChatStore>['create']>
/** 中文说明：类型或类 ChatActions 约束本文件的数据或组件职责。 */
type ChatActions = ChatInstance['actions']

/** ISession verb mocks, typed against the production face (['prompt'] etc. keep vitest mock ergonomics). */
/** 中文说明：函数 sessionFakeFor 的参数见签名，返回结果供相邻流程使用；示例见本文件调用处。 */
function sessionFakeFor() {
  return {
    open: vi.fn(() => Promise.resolve()),
    loadOlder: vi.fn<ISession['loadOlder']>(() => Promise.resolve()),
    prompt: vi.fn<ISession['prompt']>(() => Promise.resolve({ ok: true, value: { accepted: true } })),
    cancel: vi.fn<ISession['cancel']>(() => Promise.resolve({ ok: true, value: { accepted: true } })),
  } satisfies SessionBehaviorOverrides
}

/** 中文说明：函数 bench 的参数见签名，返回结果供相邻流程使用；示例见本文件调用处。 */
async function bench() {
  /** 中文说明：测试局部值 runtime，取值由紧邻初始化决定。 */
  const runtime = await SlotTestRuntime.create()
  runtime.provide('connection', { api: { settings: {} }, isLoopback: false })
  // The plugin injects both; these specs exercise no settings path.
  runtime.provide('remote', { $on: () => () => {} })
  runtime.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  /** 中文说明：测试局部值 sessionFake，取值由紧邻初始化决定。 */
  const sessionFake = sessionFakeFor()
  await runtime.sessions.add({
    id: ROOT,
    summary: { title: 'R', displayTitle: 'R', cwd: '/proj' },
    session: sessionFake,
  })
  /** 中文说明：测试局部值 layoutFake，取值由紧邻初始化决定。 */
  const layoutFake = { openDetails: vi.fn(), closeDetails: vi.fn() }
  runtime.provide('layout', layoutFake)
  /** 中文说明：测试局部值 locale，取值由紧邻初始化决定。 */
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.provide('locale', locale)
  runtime.slots.installLocale(locale)

  // The AppFrame role: the conversation-package slots must be declared by a
  // live entry before apply can contribute into them.
  await runtime.root.declare({
    'conversation': { kind: 'single', scope: 'session-maybe' },
    'details': { kind: 'single', scope: 'session' },
  }, (_p: { renderSlot?: unknown }) => null)

  /** 中文说明：测试局部值 feature，取值由紧邻初始化决定。 */
  const feature = await runtime.mount({ inject: [...inject], apply })

  // The host face (store resolution) exists only inside the installed
  // renderer, so materialize it the way the shell does.
  runtime.renderRoot()
  /** 中文说明：测试局部值 entryOf，取值由紧邻初始化决定。 */
  const entryOf = (key: 'conversation' | 'conversation.session' | 'conversation.session.header' | 'conversation.composer.bar' | 'conversation.view' | 'details') =>
    runtime.slots.entries(key)[0]!
  /** Resolve store instance + call the inject the way the outlet would. */
  /** 中文说明：服务对象 conversationApi，取值由紧邻初始化决定。 */
  const conversationApi = (id: SessionId) => {
    /** 中文说明：测试局部值 entry，取值由紧邻初始化决定。 */
    const entry = entryOf('conversation.session')
    /** 中文说明：测试局部值 instance，取值由紧邻初始化决定。 */
    const instance = runtime.storeOf('conversation.session', id) as ChatInstance
    /** 中文说明：测试局部值 injected，取值由紧邻初始化决定。 */
    const injected = (entry.inject as unknown as (sessionId: SessionId, actions: ChatActions) => ConversationSessionInjected)(
      id, instance.actions)
    return { instance, injected }
  }
  /** 中文说明：服务对象 conversationHeaderApi，取值由紧邻初始化决定。 */
  const conversationHeaderApi = (id: SessionId) => {
    /** 中文说明：测试局部值 entry，取值由紧邻初始化决定。 */
    const entry = entryOf('conversation.session.header')
    /** 中文说明：测试局部值 instance，取值由紧邻初始化决定。 */
    const instance = runtime.storeOf('conversation.session.header', id) as ChatInstance
    /** 中文说明：测试局部值 injected，取值由紧邻初始化决定。 */
    const injected = (entry.inject as unknown as (sessionId: SessionId, actions: ChatActions) => ConversationSessionHeaderInjected)(
      id, instance.actions)
    return { instance, injected }
  }
  /** 中文说明：服务对象 residentApi，取值由紧邻初始化决定。 */
  const residentApi = (id: SessionId | undefined) => {
    /** 中文说明：测试局部值 entry，取值由紧邻初始化决定。 */
    const entry = entryOf('conversation')
    return (entry.inject as unknown as (sessionId: SessionId | undefined) => ConversationInjected)(id)
  }
  /** 中文说明：服务对象 composerApi，取值由紧邻初始化决定。 */
  const composerApi = (id: SessionId | undefined) => {
    /** 中文说明：测试局部值 entry，取值由紧邻初始化决定。 */
    const entry = entryOf('conversation.composer.bar')
    return (entry.inject as unknown as (sessionId: SessionId | undefined) => ComposerBarInjected)(id)
  }
  /** Same resolution for the chat entry riding the view ring. */
  /** 中文说明：服务对象 chatViewApi，取值由紧邻初始化决定。 */
  const chatViewApi = (id: SessionId) => {
    /** 中文说明：测试局部值 entry，取值由紧邻初始化决定。 */
    const entry = entryOf('conversation.view')
    /** 中文说明：测试局部值 instance，取值由紧邻初始化决定。 */
    const instance = runtime.storeOf('conversation.view', id) as ChatInstance
    /** 中文说明：测试局部值 injected，取值由紧邻初始化决定。 */
    const injected = (entry.inject as unknown as (sessionId: SessionId, actions: ChatActions) => ChatViewInjected)(
      id, instance.actions)
    return { instance, injected }
  }
  /** Materialize the input provide contribution the way the runtime does. */
  /** 中文说明：服务对象 inputApi，取值由紧邻初始化决定。 */
  const inputApi = (id: SessionId) => {
    /** 中文说明：测试局部值 info，取值由紧邻初始化决定。 */
    const info = runtime.sessions.provideInfo(id)!
    /** 中文说明：状态快照 state，取值由紧邻初始化决定。 */
    const state = info.hooks['input'] as {
      getSnapshot: () => { draft: string }
      subscribe: (fn: () => void) => () => void
    }
    /** 中文说明：测试局部值 actions，取值由紧邻初始化决定。 */
    const actions = info.props['inputActions'] as {
      setDraft: (text: string) => void
      submit: () => void
    }
    return { state, actions }
  }
  return {
    runtime, feature, slots: runtime.slots, entryOf,
    conversationApi, conversationHeaderApi, residentApi, composerApi, chatViewApi, inputApi,
    sessionFake, layoutFake,
  }
}

describe('conversation slot inject API', () => {
  it('assembles the thin API side-effect-free', async () => {
    /** 中文说明：测试局部值 b，取值由紧邻初始化决定。 */
    const b = await bench()
    /** 中文说明：测试局部值 { injected }，取值由紧邻初始化决定。 */
    const { injected } = b.conversationApi(ROOT)
    // Assembly has no session side effects: opening the event window belongs
    // to the runtime watch path, not the inject factory.
    expect(b.sessionFake.open).not.toHaveBeenCalled()
    expect(injected.views.list().map(v => v.id)).toEqual(['chat'])

    /** 中文说明：测试局部值 chatView，取值由紧邻初始化决定。 */
    const chatView = b.chatViewApi(ROOT)
    chatView.injected.loadOlder()
    expect(b.sessionFake.loadOlder).toHaveBeenCalledTimes(1)
    chatView.injected.forkAt(17)
    await vi.waitFor(() => {
      expect(b.runtime.sessions.calls).toContainEqual({ method: 'open', args: [ROOT] })
    })
    expect(b.runtime.sessions.calls).toContainEqual({
      method: 'fork', args: [{ sessionId: ROOT, atSeq: 17, increaseTitle: true }],
    })
    await b.runtime.dispose()
  })

  it('the provide-channel input face submits through the machine sink: trim, transactional clear, failure retains the draft', async () => {
    /** 中文说明：测试局部值 b，取值由紧邻初始化决定。 */
    const b = await bench()
    /** 中文说明：测试局部值 { injected }，取值由紧邻初始化决定。 */
    const { injected } = b.conversationApi(ROOT)
    /** 中文说明：状态快照 { state, actions }，取值由紧邻初始化决定。 */
    const { state, actions } = b.inputApi(ROOT)
    // Whitespace-only: the machine treats it as empty — no prompt, draft kept.
    actions.setDraft('   ')
    actions.submit()
    expect(b.sessionFake.prompt).not.toHaveBeenCalled()
    expect(state.getSnapshot().draft).toBe('   ')
    // Success: the draft clears only after the sink settles.
    actions.setDraft('hello')
    actions.submit()
    await vi.waitFor(() => {
      expect(state.getSnapshot().draft).toBe('')
    })
    expect(b.sessionFake.prompt).toHaveBeenCalledWith([{ type: 'text', text: 'hello' }], 'queue', expect.any(AbortSignal))
    // Failure: the draft is retained through the round-trip.
    b.sessionFake.prompt.mockResolvedValueOnce({ ok: false, error: { code: 'agent-busy', message: 'b', details: { reason: 'b' } } })
    actions.setDraft('retry me')
    actions.submit()
    await vi.waitFor(() => {
      expect(b.sessionFake.prompt).toHaveBeenCalledTimes(2)
    })
    await new Promise(r => setTimeout(r, 0))
    expect(state.getSnapshot().draft).toBe('retry me')
    // Failure landing after new typing: no clobber (the interleaved edit wins).
    b.sessionFake.prompt.mockResolvedValueOnce({ ok: false, error: { code: 'agent-busy', message: 'b', details: { reason: 'b' } } })
    actions.submit()
    actions.setDraft('typed during flight')
    await new Promise(r => setTimeout(r, 0))
    expect(state.getSnapshot().draft).toBe('typed during flight')
    // The provide contribution is idempotent per session: one shell identity.
    expect(b.inputApi(ROOT).state).toBe(state)
    // The draft mirror rides the conversation inject face.
    /** 中文说明：测试局部值 mirrored，取值由紧邻初始化决定。 */
    const mirrored: string[] = []
    /** 中文说明：测试局部值 unbind，取值由紧邻初始化决定。 */
    const unbind = injected.bindDraftMirror(text => mirrored.push(text))
    actions.setDraft('mirrored text')
    expect(mirrored).toEqual(['mirrored text'])
    unbind()
    // Stop failure is swallowed (promptError owns the display).
    b.sessionFake.cancel.mockResolvedValueOnce({ ok: false, error: { code: 'internal', message: 'x', details: {} } })
    b.composerApi(ROOT).stop!()
    await new Promise(r => setTimeout(r, 0))
    expect(b.sessionFake.cancel).toHaveBeenCalledTimes(1)
    await b.runtime.dispose()
  })

  it('inject fails loud when the session resolves no binding or the scope lacks the service', async () => {
    /** 中文说明：测试局部值 b，取值由紧邻初始化决定。 */
    const b = await bench()
    /** 中文说明：测试局部值 entry，取值由紧邻初始化决定。 */
    const entry = b.entryOf('conversation.composer.bar')
    /** 中文说明：测试局部值 injectFn，取值由紧邻初始化决定。 */
    const injectFn = entry.inject as unknown as (sessionId: SessionId | undefined) => ComposerBarInjected
    // Unknown session: the keyboard face's binding resolution answers nothing.
    expect(() => { injectFn('ghost' as SessionId).stop!() }).toThrow(/resolved no binding/)
    // No session (session-maybe absent side): machine faces absent, static
    // hooks compartment still present so the render side's hook order holds.
    /** 中文说明：测试局部值 absent，取值由紧邻初始化决定。 */
    const absent = injectFn(undefined)
    expect(absent.keyboard).toBeUndefined()
    expect(absent.toggleCommandMenu).toBeUndefined()
    expect(absent.stop).toBeUndefined()
    expect(absent.hooks.notices.getSnapshot()).toBeNull()
    expect(absent.hooks.lexicon.getSnapshot().size).toBe(0)
    expect(absent.hooks.menuLauncher.getSnapshot()).toBeNull()
    // A scope whose service tree lost 'conversation' (the feature fiber
    // unloaded while a retained inject closure re-runs): fails loud too.
    /** 中文说明：清理函数 stop，取值由紧邻初始化决定。 */
    const stop = injectFn(ROOT).stop!
    await b.feature.dispose()
    expect(() => { stop() }).toThrow(/unavailable through the session scope/)
    await b.runtime.dispose()
  })

  it('openDetails (chat view face) writes the selection through the store actions and opens the panel', async () => {
    /** 中文说明：测试局部值 b，取值由紧邻初始化决定。 */
    const b = await bench()
    /** 中文说明：测试局部值 { instance, injected }，取值由紧邻初始化决定。 */
    const { instance, injected } = b.chatViewApi(ROOT)
    injected.openDetails({ turnSeq: 2, callId: 'c1' })
    expect(instance.store.getSnapshot().selection).toEqual({ turnSeq: 2, callId: 'c1' })
    expect(b.layoutFake.openDetails).toHaveBeenCalledTimes(1)
    // The chat view shares the conversation entry's store instance: selection
    // writes land where the skeleton and details read.
    /** 中文说明：测试局部值 conv，取值由紧邻初始化决定。 */
    const conv = b.conversationApi(ROOT)
    expect(conv.instance).toBe(instance)
    await b.runtime.dispose()
  })

  it('openFile (chat view face) resolves against session cwd and calls workspaces.openPath', async () => {
    /** 中文说明：测试局部值 b，取值由紧邻初始化决定。 */
    const b = await bench()
    /** 中文说明：测试局部值 { injected }，取值由紧邻初始化决定。 */
    const { injected } = b.chatViewApi(ROOT)
    await injected.openFile('src/a.ts')
    await vi.waitFor(() => {
      expect(b.runtime.workspaces.calls).toContainEqual({ method: 'openPath', args: ['/proj/src/a.ts'] })
    })
    await b.runtime.dispose()
  })

  it('openFile rejects when the Host cannot open the path', async () => {
    /** 中文说明：测试局部值 b，取值由紧邻初始化决定。 */
    const b = await bench()
    b.runtime.workspaces.stub('openPath', () => Promise.reject(new Error('xdg-open is not available')))
    /** 中文说明：测试局部值 { injected }，取值由紧邻初始化决定。 */
    const { injected } = b.chatViewApi(ROOT)
    await expect(injected.openFile('src/a.ts')).rejects.toThrow('xdg-open is not available')
    await b.runtime.dispose()
  })

  it('routes workspace switching through the runtime owner, carrying the draft', async () => {
    /** 中文说明：测试局部值 b，取值由紧邻初始化决定。 */
    const b = await bench()
    /** 中文说明：测试局部值 resident，取值由紧邻初始化决定。 */
    const resident = b.residentApi(ROOT)
    // Same-session connect (the picked workspace resolves to this session):
    // no draft movement, plain re-open.
    b.runtime.workspaces.stub('connectWorkspace', () => Promise.resolve(ROOT))
    /** 中文说明：状态快照 { state, actions }，取值由紧邻初始化决定。 */
    const { state, actions } = b.inputApi(ROOT)
    actions.setDraft('carry me')
    void resident.selectWorkspace('workspace-1' as never)
    await vi.waitFor(() => {
      expect(b.runtime.sessions.calls.filter(c => c.method === 'open')).toHaveLength(1)
    })
    expect(b.runtime.workspaces.calls).toContainEqual({ method: 'connectWorkspace', args: ['workspace-1'] })
    expect(state.getSnapshot().draft).toBe('carry me')
    // Cross-session connect: the draft MOVES — the old machine empties, the
    // new session's machine receives the text, then navigation lands there.
    /** 中文说明：测试局部值 OTHER，取值由紧邻初始化决定。 */
    const OTHER = 'other-1' as SessionId
    await b.runtime.sessions.add({ id: OTHER }, { current: false })
    b.runtime.workspaces.stub('connectWorkspace', () => Promise.resolve(OTHER))
    void resident.selectWorkspace('workspace-2' as never)
    await vi.waitFor(() => {
      expect(b.runtime.sessions.calls).toContainEqual({ method: 'open', args: [OTHER] })
    })
    expect(state.getSnapshot().draft).toBe('')
    expect(b.inputApi(OTHER).state.getSnapshot().draft).toBe('carry me')
    await b.runtime.dispose()
  })

  it('selectWorkspace edge arms: no-session resident, empty-draft move, connect failure retryable', async () => {
    /** 中文说明：测试局部值 b，取值由紧邻初始化决定。 */
    const b = await bench()
    // No-session resident (hero before any session): connect resolves and
    // navigation proceeds without any draft choreography.
    /** 中文说明：测试局部值 noSession，取值由紧邻初始化决定。 */
    const noSession = b.residentApi(undefined)
    b.runtime.workspaces.stub('connectWorkspace', () => Promise.resolve(ROOT))
    void noSession.selectWorkspace('workspace-0' as never)
    await vi.waitFor(() => {
      expect(b.runtime.sessions.calls).toContainEqual({ method: 'open', args: [ROOT] })
    })

    // Cross-session connect with an EMPTY draft: no move, no clearing.
    /** 中文说明：测试局部值 OTHER，取值由紧邻初始化决定。 */
    const OTHER = 'b9-other' as SessionId
    await b.runtime.sessions.add({ id: OTHER }, { current: false })
    /** 中文说明：测试局部值 resident，取值由紧邻初始化决定。 */
    const resident = b.residentApi(ROOT)
    /** 中文说明：状态快照 { state }，取值由紧邻初始化决定。 */
    const { state } = b.inputApi(ROOT)
    expect(state.getSnapshot().draft).toBe('')
    b.runtime.workspaces.stub('connectWorkspace', () => Promise.resolve(OTHER))
    void resident.selectWorkspace('workspace-3' as never)
    await vi.waitFor(() => {
      expect(b.runtime.sessions.calls).toContainEqual({ method: 'open', args: [OTHER] })
    })
    expect(b.inputApi(OTHER).state.getSnapshot().draft).toBe('')

    // Connect failure: the rejection propagates to the caller (the view owns
    // the rollback) and no further navigation happens.
    /** 中文说明：测试局部值 opens，取值由紧邻初始化决定。 */
    const opens = b.runtime.sessions.calls.filter(c => c.method === 'open').length
    b.runtime.workspaces.stub('connectWorkspace', () => Promise.reject(new Error('offline')))
    await expect(resident.selectWorkspace('workspace-4' as never)).rejects.toThrow('offline')
    expect(b.runtime.sessions.calls.filter(c => c.method === 'open')).toHaveLength(opens)
    await b.runtime.dispose()
  })

  it('scopedConversation fails loud when the session resolves no scope', async () => {
    /** 中文说明：测试局部值 b，取值由紧邻初始化决定。 */
    const b = await bench()
    // The chat-view inject resolves the scoped conversation service at inject
    // time: an unlisted session hits the scope() === undefined throw directly.
    /** 中文说明：测试局部值 entry，取值由紧邻初始化决定。 */
    const entry = b.entryOf('conversation.view')
    /** 中文说明：测试局部值 injectFn，取值由紧邻初始化决定。 */
    const injectFn = entry.inject as unknown as (sessionId: SessionId, actions: unknown) => unknown
    expect(() => injectFn('never-listed' as SessionId, {})).toThrow(/resolved no scope/)
    await b.runtime.dispose()
  })

  it('views read face projects the ring ledger (subscribe/version through ctx.slots)', async () => {
    /** 中文说明：测试局部值 b，取值由紧邻初始化决定。 */
    const b = await bench()
    /** 中文说明：测试局部值 { injected }，取值由紧邻初始化决定。 */
    const { injected } = b.conversationApi(ROOT)
    /** 中文说明：测试局部值 before，取值由紧邻初始化决定。 */
    const before = injected.views.version()
    /** 中文说明：有序集合 listener，取值由紧邻初始化决定。 */
    const listener = vi.fn()
    /** 中文说明：测试局部值 unsub，取值由紧邻初始化决定。 */
    const unsub = injected.views.subscribe(listener)
    // A second ring rider (what ui-trajectory does in production).
    /** 中文说明：测试局部值 off，取值由紧邻初始化决定。 */
    const off = b.slots.register(
      { name: 'conversation.view', id: 'chat2', order: 5, label: 'X' } as never, (() => null) as never)
    await Promise.resolve() // ledger notifications batch per microtask
    expect(listener).toHaveBeenCalled()
    expect(injected.views.version()).toBeGreaterThan(before)
    expect(injected.views.list().map(v => v.id)).toEqual(['chat', 'chat2'])
    // Label falls back to the id when a rider declares none.
    /** 中文说明：测试局部值 off2，取值由紧邻初始化决定。 */
    const off2 = b.slots.register(
      { name: 'conversation.view', id: 'bare', order: 6 } as never, (() => null) as never)
    expect(injected.views.list().map(v => v.label)).toEqual(['对话', 'X', 'bare'])
    off()
    off2()
    unsub()
    await b.runtime.dispose()
  })
})

describe('details inject API', () => {
  it('details injects the one layout callback; selection rides the shared store instead', async () => {
    /** 中文说明：测试局部值 b，取值由紧邻初始化决定。 */
    const b = await bench()
    /** 中文说明：测试局部值 entry，取值由紧邻初始化决定。 */
    const entry = b.entryOf('details')
    /** 中文说明：测试局部值 injected，取值由紧邻初始化决定。 */
    const injected = (entry.inject as unknown as () => DetailsInjected)()
    expect(Object.keys(injected)).toEqual(['closeDetails'])
    injected.closeDetails()
    expect(b.layoutFake.closeDetails).toHaveBeenCalledTimes(1)
    // The shared handle: details resolves the SAME instance conversation writes.
    /** 中文说明：测试局部值 conv，取值由紧邻初始化决定。 */
    const conv = b.runtime.storeOf('conversation.session', ROOT)
    /** 中文说明：测试局部值 details，取值由紧邻初始化决定。 */
    const details = b.runtime.storeOf('details', ROOT)
    expect(details).toBe(conv)
    await b.runtime.dispose()
  })
})
