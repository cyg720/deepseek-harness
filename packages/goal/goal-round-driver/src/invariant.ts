/** Package-owned goal-round prompt invariants. @module @deepseek-ai/dsh-goal-round-driver/invariant */

/*
 * 【文件职责】检查目标续轮提示与对应持久目标事实的关系，约束自动续轮输入来源。
 */

import { isDeepStrictEqual } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import { foldGoal, type FoldedGoal, type GoalMessageSource, type GoalView } from '@deepseek-ai/dsh-goal'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { renderGoalRoundPrompt } from './prompt.ts'

/** 中文说明：领域局部值 PACKAGE_NAME，由紧邻初始化决定。 */
const PACKAGE_NAME = '@deepseek-ai/dsh-goal-round-driver'

/** Cordis companion plugin name. */
/* 中文说明：领域局部值 name，由紧邻初始化决定。 */
export const name = 'goal-round-driver-invariant'
/** Service required before the companion can reserve package ownership. */
/* 中文说明：领域局部值 inject，由紧邻初始化决定。 */
export const inject = ['invariants']

/** Attribute strict goal-fold failures to this companion's reconstruction. */
/* 中文说明：函数 foldChecked 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function foldChecked(events: readonly SessionEvent[], fail: InvariantFailure): FoldedGoal {
  try {
    return foldGoal(events)
  } catch (error: unknown) {
    /** 中文说明：领域局部值 message，由紧邻初始化决定。 */
    /* v8 ignore next -- the strict goal decoder throws Error instances */
    const message = error instanceof Error ? error.message : String(error)
    return fail(`cannot reconstruct the goal before a continuation message: ${message}`)
  }
}

/** Recreate the live-shaped view consumed by the package's pure prompt renderer. */
/* 中文说明：函数 goalView 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function goalView(folded: FoldedGoal, source: GoalMessageSource, fail: InvariantFailure): GoalView {
  /** 中文说明：领域局部值 goal，由紧邻初始化决定。 */
  const goal = folded.goal
  if (goal === undefined || folded.createdAt === undefined || folded.updatedAt === undefined
    || goal.phase !== 'active' || goal.id !== source.goalId || goal.revision !== source.revision
    || source.round !== folded.roundsStarted + 1 || source.round > goal.maxGoalRounds) {
    return fail(`goal round ${source.round} cannot be reconstructed from the preceding durable goal state`)
  }
  return {
    ...goal,
    roundsStarted: folded.roundsStarted,
    createdAt: folded.createdAt,
    updatedAt: folded.updatedAt,
    activation: 'armed',
  }
}

/** Validate one package-owned continuation message against its durable prefix. */
/* 中文说明：函数 validateEvent 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function validateEvent(
  prior: readonly SessionEvent[],
  event: SessionEvent,
  fail: InvariantFailure,
): void {
  if (event.type !== 'user/message') return
  /** 中文说明：领域局部值 source，由紧邻初始化决定。 */
  const source = event.data.source
  if (source.kind !== 'goal' || source.round <= 0) return
  /** 中文说明：领域局部值 expected，由紧邻初始化决定。 */
  const expected = renderGoalRoundPrompt(goalView(foldChecked(prior, fail), source, fail), source.round)
  if (!isDeepStrictEqual(event.data.content, expected)) {
    fail(`goal round ${source.round} content does not match the package-owned continuation prompt`)
  }
}

/** Check existing sessions and every candidate event before Session publishes it. */
/* 中文说明：领域局部值 install，由紧邻初始化决定。 */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  /** 中文说明：领域局部值 session，由紧邻初始化决定。 */
  for (const session of ctx.sessions.list()) {
    /** 中文说明：领域局部值 prior，由紧邻初始化决定。 */
    const prior: SessionEvent[] = []
    for (const event of session.snapshotEvents()) {
      validateEvent(prior, event, fail)
      prior.push(event)
    }
  }
  /* jscpd:ignore-start -- package companions share dispatch and registration plumbing */
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    /** 中文说明：领域局部值 [session, event]，由紧邻初始化决定。 */
    const [session, event] = args as [Session, SessionEvent]
    validateEvent(session.snapshotEvents(), event, fail)
  }, { global: true })
}, { inject: ['sessions'] })

/**
 * Register the goal-round-driver invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
/* 中文说明：领域局部值 apply，由紧邻初始化决定。 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
