// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { SessionPendingInteraction } from '@deepseek-ai/dsh-client-ui-session/client'
import { PendingQuestion } from '@deepseek-ai/dsh-client-ui-user-questions/src/client/contract/slots.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { apply, inject } from '../src/client/index.ts'
import type { QsQuestionsInjected } from '../src/client/contract.ts'

it.each(['answer', 'abort'] as const)('clears drafts when the official request settles through %s outside its card', async (action) => {
  const runtime = await SlotTestRuntime.create()
  try {
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.ctx.provide('locale', locale)
    runtime.slots.installLocale(locale)
    await runtime.declare({ 'qs.stage.interaction': { kind: 'chain', scope: 'session' } })
    await runtime.mount({ inject: [...inject], apply })
    const request = new PendingQuestion('session' as SessionId, [{ id: 'q', question: 'Question' }])
    const publish = runtime.ctx.uiSession.registerPendingInteraction<PendingQuestion>(() => 1)
    const remove = publish(request, async () => { request.delegate() })
    const factory = runtime.slots.entries('qs.stage.interaction')[0]!.inject as unknown as () => QsQuestionsInjected
    const face = factory()
    face.writeDraft('session', request.key, 'q', { selected: [], custom: 'private draft' })
    expect(face.hooks.questionDraft.getSnapshot().size).toBe(1)
    if (action === 'answer') await request.answer({ answers: [{ id: 'q', selected: [], custom: 'external answer' }] })
    else request.abort(new Error('Host withdrew request'))
    await request.result.catch(() => undefined)
    expect(face.hooks.questionDraft.getSnapshot().size).toBe(0)
    remove()
  } finally { await runtime.dispose() }
})

/** 清理仅针对同一会话的同一请求，取消订阅和插件卸载后不再发布通知。 */
it('草稿增删、批量清理和异步落定均保持请求隔离', async () => {
  const runtime = await SlotTestRuntime.create()
  try {
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.ctx.provide('locale', locale); runtime.slots.installLocale(locale)
    await runtime.declare({ 'qs.stage.interaction': { kind: 'chain', scope: 'session' } })
    const mounted = await runtime.mount({ inject: [...inject], apply })
    const entry = runtime.slots.entries('qs.stage.interaction')[0]!
    const face = (entry.inject as unknown as () => QsQuestionsInjected)()
    const notice = vi.fn(), off = face.hooks.questionDraft.subscribe(notice)
    const draft = { selected: [], custom: 'draft' }
    face.writeDraft(undefined, 'request', 'q', draft)
    face.writeDraft('session', 'request', 'q', draft)
    face.writeDraft('session', 'other', 'q', draft)
    face.clearDrafts(undefined, 'request')
    expect(face.hooks.questionDraft.getSnapshot().size).toBe(2)
    face.clearDrafts('session', 'request')
    expect(face.hooks.questionDraft.getSnapshot().size).toBe(1)
    face.writeDraft('session', 'other', 'q', undefined)
    expect(face.hooks.questionDraft.getSnapshot().size).toBe(0)
    expect(notice).toHaveBeenCalledTimes(6)
    off()
    const request = new PendingQuestion('session' as SessionId, [{ id: 'q', question: 'Question' }])
    const publish = runtime.ctx.uiSession.registerPendingInteraction<PendingQuestion>(() => 1)
    const remove = publish(request, async () => { request.delegate() })
    face.writeDraft('session', request.key, 'q', draft)
    expect(notice).toHaveBeenCalledTimes(6)
    const select = entry.select as unknown as (owner: { sessionId: string | undefined; pendingInteraction?: unknown }) => unknown
    expect(select({ sessionId: 'session', pendingInteraction: request })).toBe(request)
    const plan = { kind: 'plan-review' }
    expect(select({ sessionId: 'session', pendingInteraction: plan })).toBe(plan)
    expect(select({ sessionId: 'session', pendingInteraction: { kind: 'approval' } })).toBeNull()
    expect(select({ sessionId: 'session' })).toBeNull()
    expect(select({ sessionId: undefined, pendingInteraction: request })).toBeNull()
    await mounted.dispose()
    const before = face.hooks.questionDraft.getSnapshot()
    request.abort(new Error('withdrawn'))
    await request.result.catch(() => undefined)
    expect(face.hooks.questionDraft.getSnapshot()).toBe(before)
    remove()
  } finally { await runtime.dispose() }
})

/** 并行会话的重复通知不重复订阅；审批和无草稿的落定不改变草稿表。 */
it('并行待答复请求只回收所属提问的草稿', async () => {
  const runtime = await SlotTestRuntime.create()
  try {
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.ctx.provide('locale', locale); runtime.slots.installLocale(locale)
    await runtime.declare({ 'qs.stage.interaction': { kind: 'chain', scope: 'session' } })
    await runtime.mount({ inject: [...inject], apply })
    const face = (runtime.slots.entries('qs.stage.interaction')[0]!.inject as unknown as () => QsQuestionsInjected)()
    const question = new PendingQuestion('one' as SessionId, [{ id: 'q', question: 'Question' }])
    // 审批仅用于验证类型过滤；结果由测试控制，卡片无需调用审批专有方法。
    const approval = { kind: 'approval', sessionId: 'two' as SessionId, key: 'approval', result: Promise.resolve('allowed-once') } as SessionPendingInteraction
    const publishQuestion = runtime.ctx.uiSession.registerPendingInteraction<PendingQuestion>(() => 1)
    const publishApproval = runtime.ctx.uiSession.registerPendingInteraction<SessionPendingInteraction>(() => 1)
    const removeQuestion = publishQuestion(question, async () => { question.delegate() })
    const removeApproval = publishApproval(approval, async () => {})
    const initial = face.hooks.questionDraft.getSnapshot()
    question.abort(new Error('withdrawn'))
    await Promise.allSettled([question.result, approval.result])
    expect(face.hooks.questionDraft.getSnapshot()).toBe(initial)
    removeQuestion(); removeApproval()
  } finally { await runtime.dispose() }
})
