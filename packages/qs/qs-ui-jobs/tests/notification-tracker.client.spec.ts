/** 终态去重覆盖初始快照、重连、身份复用、容量淘汰与关闭会话。 */
import { expect, it } from 'vitest'
import type { SessionJob } from '@deepseek-ai/dsh-api-session-controller/types'
import { SessionId } from '@deepseek-ai/dsh-session'
import { JobNotificationTracker, type JobNotificationInput } from '../src/client/notification-tracker.ts'

const a = SessionId('a'), b = SessionId('b')
const scope = {}
function job(status: SessionJob['status'], id = 'job', startedAt = 1): SessionJob {
  return { id: id as SessionJob['id'], status, startedAt, label: 'synthetic job', kind: 'test' }
}
function input(jobs: JobNotificationInput['jobs'], extra: Partial<JobNotificationInput> = {}): JobNotificationInput {
  return { scope, baseline: 1, ready: true, eligible: new Set([a, b]), jobs, ...extra }
}

it('silences initial terminal rows and reports each observed live-to-terminal transition once', () => {
  for (const terminal of ['completed', 'failed', 'killed'] as const) {
    const tracker = new JobNotificationTracker(4)
    expect(tracker.observe(input({ [a]: [job(terminal, 'old'), job('running')] }))).toEqual([])
    expect(tracker.observe(input({ [a]: [job('stopping')] }))).toEqual([])
    const done = job(terminal)
    expect(tracker.observe(input({ [a]: [done] }))).toEqual([{ sessionId: a, job: done }])
    expect(tracker.observe(input({ [a]: [done] }))).toEqual([])
  }
})

it('silences reconnect baselines, scope changes and explicit logout resets', () => {
  const tracker = new JobNotificationTracker(4)
  tracker.observe(input({ [a]: [job('running')] }))
  expect(tracker.observe(input({ [a]: [job('failed')] }, { baseline: 2 }))).toEqual([])
  tracker.observe(input({ [a]: [job('running')] }))
  tracker.observe(input({}, { ready: false }))
  expect(tracker.observe(input({ [a]: [job('completed')] }))).toEqual([])
  tracker.observe(input({ [a]: [job('running')] }))
  expect(tracker.observe(input({ [a]: [job('completed')] }, { scope: {} }))).toEqual([])
  tracker.clear()
  expect(tracker.observe(input({ [a]: [job('completed')] }))).toEqual([])
})

it('keeps session and attempt identities separate and discards inaccessible or removed jobs', () => {
  const tracker = new JobNotificationTracker(4)
  tracker.observe(input({ [a]: [job('running')] }))
  expect(tracker.observe(input({ [a]: [job('completed', 'job', 2)], [b]: [job('completed')] }))).toEqual([])
  tracker.observe(input({ [a]: [job('running')] }))
  tracker.observe(input({ [a]: [job('running')] }, { eligible: new Set([b]) }))
  expect(tracker.observe(input({ [a]: [job('completed')] }))).toEqual([])
  tracker.observe(input({ [a]: [job('running')] }))
  tracker.observe(input({}))
  expect(tracker.observe(input({ [a]: [job('completed')] }))).toEqual([])
})

it('evicts old identities without turning an evicted terminal row into a new completion', () => {
  const tracker = new JobNotificationTracker(1)
  tracker.observe(input({ [a]: [job('running', 'first'), job('running', 'second')] }))
  expect(tracker.observe(input({ [a]: [job('completed', 'first')] }))).toEqual([])
  expect(tracker.observe(input({ [a]: [job('completed', 'first')] }))).toEqual([])
})
