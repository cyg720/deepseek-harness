// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
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
