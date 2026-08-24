// @vitest-environment jsdom
/**
 * 文件职责：验证会话界面的 chat-store.client.spec.ts 行为和边界。
 * 技术维度：Vitest、React 测试渲染、事件模拟与可控服务替身。
 * 产品维度：防止会话界面交互和展示在扩展后回归。
 * 逻辑维度：构造状态，触发渲染或交互，再断言输出和清理。
 * 关键边界：全局替身、计时器和异步任务必须在用例后恢复。
 * 新手阅读建议：先读辅助夹具，再按 describe 场景顺序阅读。
 */
/** Chat-store actions, scoped persistence, and instance isolation. */
import { beforeEach, describe, expect, it } from 'vitest'
import { createChatStore } from '../src/client/stores.ts'

/** 中文说明：测试局部值 KEY，取值由紧邻初始化决定。 */
const KEY = 'dsh.conversation.chat'

beforeEach(() => {
  localStorage.clear()
})

describe('createChatStore', () => {
  it('init shape: empty selection/draft/view', () => {
    /** 中文说明：状态快照 store，取值由紧邻初始化决定。 */
    const store = createChatStore().create()
    expect(store.store.getSnapshot()).toEqual({ selection: null, draft: '', view: null, inspect: null })
  })

  it('actions cover the declared write set', () => {
    /** 中文说明：状态快照 store，取值由紧邻初始化决定。 */
    const store = createChatStore().create()

    store.actions.select({ turnSeq: 3, callId: 'c1', toolName: 'bash' })
    expect(store.store.getSnapshot().selection).toEqual({ turnSeq: 3, callId: 'c1', toolName: 'bash' })
    store.actions.select(null)
    expect(store.store.getSnapshot().selection).toBeNull()

    store.actions.setDraft('hello')
    expect(store.store.getSnapshot().draft).toBe('hello')

    store.actions.setView('chat')
    expect(store.store.getSnapshot().view).toBe('chat')

    store.actions.setInspect({ callId: 'c1' })
    expect(store.store.getSnapshot().inspect).toEqual({ callId: 'c1' })
    store.actions.setInspect(null)
    expect(store.store.getSnapshot().inspect).toBeNull()
  })

  it('persists per scope key and rehydrates a fresh instance', () => {
    /** 中文说明：服务对象 handle，取值由紧邻初始化决定。 */
    const handle = createChatStore()
    /** 中文说明：测试局部值 s1，取值由紧邻初始化决定。 */
    const s1 = handle.create('sess-1')
    s1.actions.setDraft('draft for one')
    s1.actions.select({ turnSeq: 1 })

    // Scope-suffixed key: each session persists separately.
    expect(localStorage.getItem(`${KEY}.sess-1`)).not.toBeNull()
    expect(localStorage.getItem(`${KEY}.sess-2`)).toBeNull()

    // A rebuilt instance under the same scope key rehydrates the state.
    /** 中文说明：测试局部值 again，取值由紧邻初始化决定。 */
    const again = createChatStore().create('sess-1')
    expect(again.store.getSnapshot().draft).toBe('draft for one')
    expect(again.store.getSnapshot().selection).toEqual({ turnSeq: 1 })

    // A sibling scope starts clean.
    /** 中文说明：测试局部值 other，取值由紧邻初始化决定。 */
    const other = createChatStore().create('sess-2')
    expect(other.store.getSnapshot().draft).toBe('')
  })

  it('clearPersisted removes the scope entry (session-death cleanup hook)', () => {
    /** 中文说明：状态快照 store，取值由紧邻初始化决定。 */
    const store = createChatStore().create('sess-9')
    store.actions.setDraft('doomed')
    expect(localStorage.getItem(`${KEY}.sess-9`)).not.toBeNull()
    store.clearPersisted()
    expect(localStorage.getItem(`${KEY}.sess-9`)).toBeNull()
  })

  it('every create() is an independent instance; the factory holds no singleton', () => {
    /** 中文说明：服务对象 handle，取值由紧邻初始化决定。 */
    const handle = createChatStore()
    /** 中文说明：测试局部值 a，取值由紧邻初始化决定。 */
    const a = handle.create()
    /** 中文说明：测试局部值 b，取值由紧邻初始化决定。 */
    const b = handle.create()
    a.actions.setDraft('only in a')
    expect(b.store.getSnapshot().draft).toBe('')
    // Two factory calls likewise share no LIVE state (identity is per handle
    // VALUE, not per module — the sharing contract lives in the framework's
    // handle x scope-key resolution, not in module state). Persistence is the
    // one sanctioned cross-instance channel: clear it so this assertion sees
    // memory identity, not rehydration (covered by the persist case above).
    localStorage.clear()
    /** 中文说明：测试局部值 c，取值由紧邻初始化决定。 */
    const c = createChatStore().create()
    expect(c.store.getSnapshot().draft).toBe('')
  })
})
