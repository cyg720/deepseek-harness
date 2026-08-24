// @vitest-environment jsdom
/**
 * 文件职责：验证会话输入的 selection-survival.client.spec.tsx 行为。
 * 技术维度：Vitest、React 渲染、事件模拟和服务替身。
 * 产品维度：防止会话输入用户流程回归。
 * 逻辑维度：构造状态，触发行为并断言结果和清理。
 * 关键边界：异步任务、全局替身和 DOM 必须在用例后恢复。
 * 新手阅读建议：先读辅助函数，再按场景顺序阅读。
 */
/**
 * Exercises selection persistence through the real SlotRegistry store axis;
 * component stubs cannot prove per-session identity or disposal.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { createChatStore } from '../src/client/stores.ts'

/** 中文说明：测试局部值 sid，由紧邻初始化决定。 */
const sid = (s: string): SessionId => s as SessionId

/** 中文说明：类型或类 ChatInstance 约束本文件数据或组件职责。 */
type ChatInstance = ReturnType<ReturnType<typeof createChatStore>['create']>

/** 中文说明：函数 bench 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function bench() {
  /** 中文说明：测试局部值 runtime，由紧邻初始化决定。 */
  const runtime = await SlotTestRuntime.create()
  /** 中文说明：测试局部值 chat，由紧邻初始化决定。 */
  const chat = createChatStore()
  // The apply.ts shape: one shared handle across the strict Session header,
  // body, and details registrations; the session-maybe 'conversation' shell
  // carries no store by design. The slots must first exist in the ledger.
  await runtime.root.declare({
    'conversation': { kind: 'single', scope: 'session-maybe' },
    'conversation.session': { kind: 'single', scope: 'session' },
    'conversation.session.header': { kind: 'single', scope: 'session' },
    'details': { kind: 'single', scope: 'session' },
  }, (_p: { renderSlot?: unknown }) => null)
  runtime.slots.register({ name: 'conversation.session', store: chat }, () => null)
  runtime.slots.register({ name: 'conversation.session.header', store: chat }, () => null)
  runtime.slots.register({ name: 'details', store: chat }, () => null)
  runtime.renderRoot() // materializes the host face storeOf resolves through
  return { runtime, chat }
}

/** Resolve the store instance the renderer would hand a slot's component for a session. */
/** 中文说明：函数 storeFor 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function storeFor(b: Awaited<ReturnType<typeof bench>>, slot: 'conversation.session' | 'details', sessionId: SessionId) {
  return b.runtime.storeOf(slot, sessionId) as ChatInstance
}

beforeEach(() => {
  localStorage.clear()
})

describe('selection survives on the store seat', () => {
  it('one session, two slots: conversation writes, details reads the SAME instance', async () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench()

    /** 中文说明：测试局部值 conv，由紧邻初始化决定。 */
    const conv = storeFor(b, 'conversation.session', sid('s1'))
    /** 中文说明：测试局部值 details，由紧邻初始化决定。 */
    const details = storeFor(b, 'details', sid('s1'))
    conv.actions.select({ turnSeq: 3, callId: 'c1' })
    expect(details.store.getSnapshot().selection).toEqual({ turnSeq: 3, callId: 'c1' })
    // Identity, not just value: the shared handle resolves one instance per scope key.
    expect(details).toBe(conv)
    await b.runtime.dispose()
  })

  it('sessions are isolated: s2 selection never bleeds into s1', async () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench()

    /** 中文说明：测试局部值 one，由紧邻初始化决定。 */
    const one = storeFor(b, 'conversation.session', sid('s1'))
    /** 中文说明：测试局部值 two，由紧邻初始化决定。 */
    const two = storeFor(b, 'conversation.session', sid('s2'))
    expect(two).not.toBe(one)
    one.actions.select({ turnSeq: 1, callId: 'a' })
    two.actions.select({ turnSeq: 9, callId: 'z' })
    expect(one.store.getSnapshot().selection).toEqual({ turnSeq: 1, callId: 'a' })
    expect(two.store.getSnapshot().selection).toEqual({ turnSeq: 9, callId: 'z' })
    await b.runtime.dispose()
  })

  it('a list-projection update keeps instance identity and the selection value', async () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench()
    /** 中文说明：测试局部值 id，由紧邻初始化决定。 */
    const id = sid('s1')

    /** 中文说明：测试局部值 store，由紧邻初始化决定。 */
    const store = storeFor(b, 'conversation.session', id)
    store.actions.select({ turnSeq: 3, callId: 'c1' })
    store.actions.setDraft('half-typed')

    // A projection churn elsewhere (list rows re-projected) must not touch
    // store identity: drive the runtime's own list observable.
    await b.runtime.sessions.add({ id, summary: { displayTitle: 'proj-a' } })
    expect(b.runtime.sessions.list.getSnapshot().byId[id]?.displayTitle).toBe('proj-a')

    /** 中文说明：测试局部值 after，由紧邻初始化决定。 */
    const after = storeFor(b, 'conversation.session', id)
    expect(after).toBe(store)
    expect(after.store.getSnapshot().selection).toEqual({ turnSeq: 3, callId: 'c1' })
    expect(after.store.getSnapshot().draft).toBe('half-typed')
    await b.runtime.dispose()
  })

  it('session death buries the instance and its persisted draft', async () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench()
    await b.runtime.sessions.add({ id: 's1' })

    /** 中文说明：测试局部值 doomed，由紧邻初始化决定。 */
    const doomed = storeFor(b, 'conversation.session', sid('s1'))
    doomed.actions.setDraft('to be buried')
    doomed.actions.select({ turnSeq: 1 })
    expect(localStorage.getItem('dsh.conversation.chat.s1')).not.toBeNull()

    // TestSessions.remove drives the same public slot lifecycle contract the
    // production SessionRuntime calls when the scope dies (pruneStoreScope).
    await b.runtime.sessions.remove('s1')

    // Persisted residue is gone with the session...
    expect(localStorage.getItem('dsh.conversation.chat.s1')).toBeNull()
    // ...and a re-created same-id session starts from a FRESH instance.
    /** 中文说明：测试局部值 reborn，由紧邻初始化决定。 */
    const reborn = storeFor(b, 'conversation.session', sid('s1'))
    expect(reborn).not.toBe(doomed)
    expect(reborn.store.getSnapshot()).toEqual({ selection: null, draft: '', view: null, inspect: null })
    await b.runtime.dispose()
  })
})
