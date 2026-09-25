import { describe, expect, it, vi } from 'vitest'
// 仅测试接入真实投影容器，生产消费者仍通过官方会话座席读取。
import { ProjectionValueStore } from '@deepseek-ai/dsh-api-session-controller/src/client/sessions/projection-store.ts'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionSeq } from '@deepseek-ai/dsh-session/types'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { GoalActivationChanged, GoalId, GoalProjection, GoalView } from '@deepseek-ai/dsh-goal/client'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import { createGoalActivationSource } from '../src/client/activation-source.ts'

const GOAL_ID = 'g-1' as GoalId

function projection(): GoalProjection {
  return {
    goal: {
      id: GOAL_ID,
      revision: 1,
      objective: 'ship it',
      phase: 'active',
      maxGoalRounds: 8,
    },
    roundsStarted: 0,
    createdAt: 1,
    updatedAt: 1,
  }
}

function goalView(activation: 'armed' | 'disarmed'): GoalView {
  return { ...projection().goal, roundsStarted: 0, createdAt: 1, updatedAt: 1, activation }
}

describe('goal activation source', () => {
  it('does not let a stale read overwrite a later activation event', async () => {
    const projectionStore = createSnapshotStore<GoalProjection | null | undefined>(projection())
    const session = createSnapshotStore({ running: false })
    let resolveRead!: (value: RemoteResult<GoalView | undefined>) => void
    const getGoal = vi.fn(() => new Promise<RemoteResult<GoalView | undefined>>((resolve) => {
      resolveRead = resolve
    }))
    let activationListener: ((goal: GoalActivationChanged['goal']) => void) | undefined
    const source = createGoalActivationSource({
      projection: projectionStore,
      session,
      getGoal,
      subscribeActivation: (listener) => {
        activationListener = listener
        return () => { activationListener = undefined }
      },
      subscribeReset: () => () => {},
    })
    const dispose = source.subscribe(() => {})

    activationListener?.({ id: GOAL_ID, revision: 1, activation: 'disarmed' })
    resolveRead({ ok: true, value: goalView('armed') })
    await Promise.resolve()

    expect(source.getSnapshot()).toMatchObject({ id: 'g-1', revision: 1, activation: 'disarmed' })
    dispose()
  })

  it('refreshes on the running edge without clearing the last activation', async () => {
    const projectionStore = createSnapshotStore<GoalProjection | null | undefined>(projection())
    const session = createSnapshotStore({ running: false })
    const getGoal = vi.fn()
      .mockResolvedValueOnce({ ok: true as const, value: goalView('disarmed') })
      .mockImplementationOnce(() => new Promise<RemoteResult<GoalView | undefined>>(() => {}))
    const source = createGoalActivationSource({
      projection: projectionStore,
      session,
      getGoal,
      subscribeActivation: () => () => {},
      subscribeReset: () => () => {},
    })
    const dispose = source.subscribe(() => {})
    await Promise.resolve()
    await Promise.resolve()
    expect(source.getSnapshot().activation).toBe('disarmed')

    session.set({ running: true })
    expect(source.getSnapshot().activation).toBe('disarmed')
    dispose()
  })

  it('merges lifecycle edges and releases subscriptions with the last observer', async () => {
    const projectionStore = createSnapshotStore<GoalProjection | null | undefined>(projection())
    const session = createSnapshotStore({ running: false })
    const getGoal = vi.fn(() => Promise.resolve({
      ok: true as const,
      value: goalView('armed'),
    }))
    let emitActivation: ((goal: GoalActivationChanged['goal']) => void) | undefined
    let emitReset: (() => void) | undefined
    const disposeProjection: Array<() => void> = []
    const disposeSession: Array<() => void> = []
    const source = createGoalActivationSource({
      projection: {
        getSnapshot: () => projectionStore.getSnapshot(),
        subscribe: (listener) => {
          disposeProjection.push(listener)
          return projectionStore.subscribe(listener)
        },
      },
      session: {
        getSnapshot: () => session.getSnapshot(),
        subscribe: (listener) => {
          disposeSession.push(listener)
          return session.subscribe(listener)
        },
      },
      getGoal,
      subscribeActivation: (listener) => {
        emitActivation = listener
        return () => { emitActivation = undefined }
      },
      subscribeReset: (listener) => {
        emitReset = listener
        return () => { emitReset = undefined }
      },
    })

    const first = source.subscribe(() => {})
    const second = source.subscribe(() => {})
    emitActivation?.({ id: GOAL_ID, revision: 1, activation: 'disarmed' })
    emitActivation?.({ id: GOAL_ID, revision: 1, activation: 'disarmed' })
    emitActivation?.(undefined)
    emitActivation?.({ id: GOAL_ID, revision: 1, activation: 'armed' })
    projectionStore.set(null)
    session.set({ running: false })
    session.set({ running: true })
    await Promise.resolve()
    emitReset?.()
    await Promise.resolve()
    projectionStore.set(projection())
    await Promise.resolve()

    expect(source.getSnapshot()).toMatchObject({ id: 'g-1', revision: 1, activation: 'armed' })
    expect(disposeProjection.length).toBeGreaterThan(0)
    expect(disposeSession.length).toBeGreaterThan(0)
    first()
    expect(emitActivation).toBeDefined()
    second()
    expect(emitActivation).toBeUndefined()
    expect(emitReset).toBeUndefined()
  })

  it('leaves the ref unarmed when an authoritative read fails', async () => {
    const projectionStore = createSnapshotStore<GoalProjection | null | undefined>(projection())
    const session = createSnapshotStore({ running: false })
    const source = createGoalActivationSource({
      projection: projectionStore,
      session,
      getGoal: () => Promise.resolve({
        ok: false,
        error: new RemoteError('gateway/internal', 'no', {}),
      }),
      subscribeActivation: () => () => {},
      subscribeReset: () => () => {},
    })
    const dispose = source.subscribe(() => {})
    await Promise.resolve()
    await Promise.resolve()
    expect(source.getSnapshot()).toMatchObject({ id: 'g-1', revision: 1 })
    expect(source.getSnapshot().activation).toBeUndefined()
    dispose()
  })

  it('does not republish an unchanged active ref or an already-empty projection', async () => {
    const emptyProjection = createSnapshotStore<GoalProjection | null | undefined>(null)
    const emptySession = createSnapshotStore({ running: false })
    const emptySource = createGoalActivationSource({
      projection: emptyProjection,
      session: emptySession,
      getGoal: () => Promise.resolve({ ok: true, value: undefined }),
      subscribeActivation: () => () => {},
      subscribeReset: () => () => {},
    })
    const emptyDispose = emptySource.subscribe(() => {})
    expect(emptySource.getSnapshot()).toEqual({})
    emptyDispose()

    const projectionStore = createSnapshotStore<GoalProjection | null | undefined>(projection())
    const session = createSnapshotStore({ running: false })
    const source = createGoalActivationSource({
      projection: projectionStore,
      session,
      getGoal: () => Promise.resolve({ ok: true, value: goalView('armed') }),
      subscribeActivation: () => () => {},
      subscribeReset: () => () => {},
    })
    const dispose = source.subscribe(() => {})
    await Promise.resolve()
    await Promise.resolve()
    let notifications = 0
    const disposeObserver = source.subscribe(() => { notifications++ })
    projectionStore.set(projection())
    await Promise.resolve()
    expect(notifications).toBe(0)
    expect(source.getSnapshot()).toMatchObject({ id: 'g-1', revision: 1, activation: 'armed' })
    disposeObserver()
    dispose()
  })
})

// 连接重置清除旧进程的激活权限，旧读结果不能恢复已失效的 armed 状态。
it('invalidates activation on connection reset until the replacement read settles', async () => {
  const reads: ReturnType<typeof Promise.withResolvers<RemoteResult<GoalView | undefined>>>[] = []
  let reset: (() => void) | undefined
  const source = createGoalActivationSource({
    projection: createSnapshotStore<GoalProjection | null | undefined>(projection()),
    session: createSnapshotStore({ running: false }),
    getGoal: () => {
      const read = Promise.withResolvers<RemoteResult<GoalView | undefined>>()
      reads.push(read)
      return read.promise
    },
    subscribeActivation: () => () => {},
    subscribeReset: (listener) => { reset = listener; return () => { reset = undefined } },
  })
  const dispose = source.subscribe(() => {})
  try {
    reads[0]!.resolve({ ok: true, value: goalView('armed') })
    await Promise.resolve()
    expect(source.getSnapshot().activation).toBe('armed')
    reset!()
    expect(source.getSnapshot()).toEqual({ id: GOAL_ID, revision: 1 })
    reset!()
    reads[1]!.resolve({ ok: true, value: goalView('armed') })
    await Promise.resolve()
    expect(source.getSnapshot().activation).toBeUndefined()
    reads[2]!.resolve({ ok: true, value: goalView('disarmed') })
    await Promise.resolve()
    expect(source.getSnapshot().activation).toBe('disarmed')
  } finally { dispose() }
})

// 使用官方微任务投影容器：值可先读取，通知在下一微任务到达。
it.each([false, true])('handles an empty live result before a projection notification: %s', async (clear) => {
  const values = new ProjectionValueStore()
  values.apply('goal', projection(), 0 as SessionSeq)
  await Promise.resolve()
  const read = Promise.withResolvers<RemoteResult<GoalView | undefined>>()
  const source = createGoalActivationSource({
    projection: values.faceOf('goal') as HostObservable<GoalProjection | null | undefined>,
    session: createSnapshotStore({ running: false }),
    getGoal: () => read.promise,
    subscribeActivation: () => () => {},
    subscribeReset: () => () => {},
  })
  const dispose = source.subscribe(() => {})
  try {
    read.resolve({ ok: true, value: undefined })
    if (clear) values.apply('goal', null, 1 as SessionSeq)
    await Promise.resolve()
    expect(source.getSnapshot()).toEqual(clear ? {} : { id: GOAL_ID, revision: 1 })
    expect(source.getSnapshot().activation).toBeUndefined()
  } finally { dispose() }
})
