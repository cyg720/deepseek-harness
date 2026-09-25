/** 基线接收完成时领域列表必须可读，避免通知把重连完成记录当作实时增量。 */
import { Context } from '@deepseek-ai/cordis'
import { expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionJob } from '../../src/types.ts'
import { ClientSessions } from '../../src/client/sessions/service.ts'
import { FakeApiClient, fakeRemote } from '../fake-api.client.ts'

it('publishes jobs from the accepted baseline before the control owner can announce readiness', async () => {
  const ctx = new Context(), sessions = new ClientSessions(ctx, fakeRemote(new FakeApiClient()))
  const id = SessionId('notification-baseline')
  const job: SessionJob = { id: 'job' as SessionJob['id'], kind: 'test', label: 'synthetic', status: 'completed', startedAt: 1 }
  try {
    sessions.handleControlFrame({ type: 'baseline', value: { queues: {}, projections: {}, jobs: { [id]: [job] } } })
    expect(sessions.list.getSnapshot().jobsBySession[id]).toEqual([job])
    sessions.handleControlFrame({ type: 'baseline', value: { queues: {}, projections: {}, jobs: {} } })
    expect(sessions.list.getSnapshot().jobsBySession).toEqual({})
    await Promise.resolve()
    expect(sessions.list.getSnapshot().jobsBySession).toEqual({})
  } finally { await ctx.fiber.dispose() }
})
