/** Package-owned durable goal-stream invariants. @module @deepseek-ai/dsh-goal/invariant */

/*
 * 【文件职责】检查目标领域持久事件的顺序及关联，保证目标状态可以一致回放。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { applyGoalEvent, emptyGoalFoldState } from './fold.ts'
import type { GoalFoldState } from './fold.ts'

/** 中文说明：领域局部值 PACKAGE_NAME，由紧邻初始化决定。 */
const PACKAGE_NAME = '@deepseek-ai/dsh-goal'

/** Cordis companion plugin name. */
/* 中文说明：领域局部值 name，由紧邻初始化决定。 */
export const name = 'goal-invariant'
/** Service required before the companion can reserve package ownership. */
/* 中文说明：领域局部值 inject，由紧邻初始化决定。 */
export const inject = ['invariants']

/** Copy the independent fold before validating one candidate event. */
/* 中文说明：函数 cloneState 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function cloneState(state: GoalFoldState): GoalFoldState {
  return {
    goal: state.goal,
    roundsStarted: state.roundsStarted,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    lastRef: state.lastRef,
    seenGoalIds: new Set(state.seenGoalIds),
  }
}

/** Apply one event through the strict goal decoder and attribute failures. */
/* 中文说明：函数 applyChecked 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function applyChecked(state: GoalFoldState, event: SessionEvent, fail: InvariantFailure): void {
  try {
    applyGoalEvent(state, event)
  } catch (error) {
    /** 中文说明：领域局部值 message，由紧邻初始化决定。 */
    /* v8 ignore next -- the strict goal decoder throws Error instances */
    const message = error instanceof Error ? error.message : String(error)
    fail(`session event ${event.seq} violates the durable goal stream: ${message}`)
  }
}

/** Install an independent incremental fold over every attached session. */
/* 中文说明：领域局部值 install，由紧邻初始化决定。 */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  /** 中文说明：领域局部值 states，由紧邻初始化决定。 */
  const states = new WeakMap<Session, GoalFoldState>()
  /** 中文说明：领域局部值 staged，由紧邻初始化决定。 */
  const staged = new WeakMap<SessionEvent, { session: Session; state: GoalFoldState }>()

  /** 中文说明：领域局部值 seed，由紧邻初始化决定。 */
  const seed = (session: Session): GoalFoldState => {
    /** 中文说明：领域局部值 state，由紧邻初始化决定。 */
    const state = emptyGoalFoldState()
    for (const event of session.snapshotEvents()) applyChecked(state, event, fail)
    states.set(session, state)
    return state
  }
  /** 中文说明：领域局部值 stateFor，由紧邻初始化决定。 */
  /* v8 ignore next -- session/event always follows list() or session/created seeding */
  const stateFor = (session: Session): GoalFoldState => states.get(session) ?? seed(session)

  /** 中文说明：领域局部值 session，由紧邻初始化决定。 */
  for (const session of ctx.sessions.list()) seed(session)
  ctx.on('session/created', (session) => { seed(session) }, { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    /** 中文说明：领域局部值 [session, event]，由紧邻初始化决定。 */
    const [session, event] = args as [Session, SessionEvent]
    /** 中文说明：领域局部值 state，由紧邻初始化决定。 */
    const state = cloneState(stateFor(session))
    applyChecked(state, event, fail)
    staged.set(event, { session, state })
  }, { global: true })
  ctx.on('session/event', (session, event) => {
    /** 中文说明：领域局部值 candidate，由紧邻初始化决定。 */
    const candidate = staged.get(event)
    /* v8 ignore next 2 -- internal/dispatch stages the exact callback arguments */
    if (candidate === undefined || candidate.session !== session) {
      return fail('session/event reached publication without matching goal-fold validation')
    }
    staged.delete(event)
    states.set(session, candidate.state)
  }, { global: true })
}, { inject: ['sessions'] })

/**
 * Register the goal-stream invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
/* 中文说明：领域局部值 apply，由紧邻初始化决定。 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
