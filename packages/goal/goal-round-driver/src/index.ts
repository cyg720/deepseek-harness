/**
 * Same-session goal-round driver over public agent, session, and goal services.
 * @module @deepseek-ai/dsh-goal-round-driver
 */

/*
 * 【文件职责】通过公共 Agent、Session 和 Goal 服务驱动目标后续轮次，在续轮输入进入 inbox 前保留其身份。
 */

import { isDeepStrictEqual } from 'node:util'
import { FiberState } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { GoalMessageSource, GoalRef, GoalView } from '@deepseek-ai/dsh-goal'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, MessageId, MessageSource } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent, UserMessage } from '@deepseek-ai/dsh-session'
import { renderGoalRoundPrompt } from './prompt.ts'

export { renderGoalRoundPrompt } from './prompt.ts'

/** 中文说明：领域局部值 name，由紧邻初始化决定。 */
export const name = 'goal-round-driver'
/** 中文说明：领域局部值 inject，由紧邻初始化决定。 */
export const inject = ['agents', 'goals', 'sessions']

/** Identity reserved before a goal continuation enters the agent inbox. */
/* 中文说明：类型或类 RoundIdentity 约束文件或目标数据职责。 */
interface RoundIdentity {
  readonly goalId: GoalRef['id']
  readonly revision: number
  readonly round: number
}

/** One queued, claimed, or admitted goal message retained until whole-agent quiescence. */
/* 中文说明：类型或类 RoundAttempt 约束文件或目标数据职责。 */
interface RoundAttempt extends RoundIdentity {
  readonly messageId: MessageId
  readonly content: ContentBlock[]
  phase: 'queued' | 'claimed' | 'admitted'
  cancelled: boolean
  stale: boolean
}

/** Serialized process-local scheduling state for one exact Agent lifecycle. */
/* 中文说明：类型或类 DriverState 约束文件或目标数据职责。 */
interface DriverState {
  readonly agent: Agent
  attempt: RoundAttempt | undefined
  competingQueued: boolean
  needsCheckpoint: boolean
  requested: boolean
  run: Promise<void> | undefined
  stopping: boolean
}

/** Whether a source identifies an automatic, positive-numbered goal round. */
/* 中文说明：函数 isGoalRoundSource 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function isGoalRoundSource(source: MessageSource): source is GoalMessageSource {
  return source.kind === 'goal' && source.round > 0
}

/** Compare a source to one reserved identity. */
/* 中文说明：函数 sameRound 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function sameRound(source: GoalMessageSource, round: RoundIdentity): boolean {
  return source.goalId === round.goalId
    && source.revision === round.revision
    && source.round === round.round
}

/** Compare the complete queued record to the driver's reservation. */
/* 中文说明：函数 sameQueued 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function sameQueued(content: ContentBlock[], source: MessageSource, attempt: RoundAttempt): boolean {
  return isGoalRoundSource(source) && sameRound(source, attempt) && isDeepStrictEqual(content, attempt.content)
}

/** Exact current ref for a view. */
/* 中文说明：函数 goalRef 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function goalRef(goal: GoalView): GoalRef {
  return { id: goal.id, revision: goal.revision }
}

/** Human-readable unexpected values for logs. */
/* 中文说明：函数 renderThrown 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function renderThrown(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}

/** Install automatic same-session continuation and its race fences. */
/* 中文说明：函数 apply 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function apply(ctx: Context): void {
  /** 中文说明：领域局部值 states，由紧邻初始化决定。 */
  const states = new Map<Agent, DriverState>()

  /** Create state for an exact currently live agent. */
  /* 中文说明：函数 stateFor 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
  function stateFor(agent: Agent): DriverState {
    /** 中文说明：领域局部值 existing，由紧邻初始化决定。 */
    const existing = states.get(agent)
    if (existing !== undefined) return existing
    /** 中文说明：领域局部值 state，由紧邻初始化决定。 */
    const state: DriverState = {
      agent,
      attempt: undefined,
      competingQueued: false,
      needsCheckpoint: false,
      requested: false,
      run: undefined,
      stopping: false,
    }
    states.set(agent, state)
    return state
  }

  /** Read only when the exact Agent remains live. */
  /* 中文说明：函数 currentGoal 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
  function currentGoal(state: DriverState): GoalView | undefined {
    if (ctx.agents.get(state.agent.id) !== state.agent) return undefined
    return ctx.goals.get(state.agent)
  }

  /** Whether this exact lifecycle is quiescent with no competing prompt. */
  /* 中文说明：函数 readyToDrive 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
  function readyToDrive(state: DriverState): boolean {
    return ctx.fiber.state === FiberState.ACTIVE
      && !state.stopping
      && ctx.agents.get(state.agent.id) === state.agent
      && state.agent.status === 'idle'
      && !state.competingQueued
  }

  /** Recheck every condition that an awaited checkpoint may have changed. */
  /* 中文说明：函数 readyAfterCheckpoint 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
  function readyAfterCheckpoint(state: DriverState): boolean {
    return readyToDrive(state) && !state.needsCheckpoint
  }

  /** Remove automatic authority while preserving the durable phase. */
  /* 中文说明：函数 disarm 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
  function disarm(state: DriverState): void {
    try {
      /** 中文说明：领域局部值 goal，由紧邻初始化决定。 */
      const goal = currentGoal(state)
      if (goal?.activation === 'armed') ctx.goals.disarm(state.agent)
    } catch (error: unknown) {
      ctx.logger.warn(`goal-round-driver: could not disarm agent "${state.agent.id}": ${renderThrown(error)}`)
    }
  }

  /** Preserve claimed step context when this driver drops only its own round. */
  /* 中文说明：函数 restoreOtherClaimed 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
  function restoreOtherClaimed(agent: Agent, messages: UserMessage[], messageId: MessageId): void {
    /** 中文说明：领域局部值 retained，由紧邻初始化决定。 */
    const retained = messages.filter(message => message.id !== messageId
      && !(message.source.kind === 'goal' && message.source.round === 0))
    /** 中文说明：领域局部值 message，由紧邻初始化决定。 */
    for (const message of retained.toReversed()) {
      if (agent.inbox.nextStep.some(candidate => candidate.id === message.id)
        || agent.inbox.nextTurn.some(candidate => candidate.id === message.id)) continue
      agent.inbox.prepend('next-step', message)
    }
  }

  /** Process admitted work at quiescence, then reserve at most one next round. */
  /* 中文说明：函数 drive 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
  async function drive(state: DriverState): Promise<void> {
    /** 中文说明：领域局部值 { agent }，由紧邻初始化决定。 */
    const { agent } = state
    if (!readyToDrive(state)) return

    if (state.needsCheckpoint) {
      state.needsCheckpoint = false
      try {
        await ctx.sessions.flush(agent.session)
      } catch (error: unknown) {
        ctx.logger.warn(`goal-round-driver: durability checkpoint failed for agent "${agent.id}": ${renderThrown(error)}`)
        disarm(state)
        return
      }
      // A mutation or ordinary prompt may have arrived while the checkpoint
      // was settling. Give it its own checkpoint / turn before reserving.
      if (!readyAfterCheckpoint(state)) return
    }

    /** 中文说明：领域局部值 attempt，由紧邻初始化决定。 */
    const attempt = state.attempt
    if (attempt !== undefined) {
      state.attempt = undefined
      state.needsCheckpoint = true
      state.requested = true
      return
    }

    /** 中文说明：领域局部值 goal，由紧邻初始化决定。 */
    const goal = currentGoal(state)
    if (goal === undefined || goal.phase !== 'active' || goal.activation !== 'armed') return
    if (goal.roundsStarted >= goal.maxGoalRounds) {
      ctx.goals.block(agent, goalRef(goal), {
        code: 'round-limit',
        message: `Goal reached its configured limit of ${goal.maxGoalRounds} rounds.`,
      })
      return
    }

    /** 中文说明：领域局部值 round，由紧邻初始化决定。 */
    const round = goal.roundsStarted + 1
    /** 中文说明：领域局部值 content，由紧邻初始化决定。 */
    const content = renderGoalRoundPrompt(goal, round)
    /** 中文说明：领域局部值 message，由紧邻初始化决定。 */
    const message = createUserMessage({
      content,
      source: { kind: 'goal', goalId: goal.id, revision: goal.revision, round },
    })
    /** 中文说明：领域局部值 reservation，由紧邻初始化决定。 */
    const reservation: RoundAttempt = {
      goalId: goal.id,
      revision: goal.revision,
      round,
      messageId: message.id,
      content,
      phase: 'queued',
      cancelled: false,
      stale: false,
    }
    state.attempt = reservation
    try {
      agent.followup(message)
    } catch (error: unknown) {
      state.attempt = undefined
      ctx.logger.warn(`goal-round-driver: could not queue round ${round} for agent "${agent.id}": ${renderThrown(error)}`)
      /** 中文说明：领域局部值 latest，由紧邻初始化决定。 */
      const latest = currentGoal(state)
      if (latest !== undefined && latest.id === goal.id && latest.revision === goal.revision
        && latest.phase === 'active' && latest.activation === 'armed') {
        ctx.goals.block(agent, goalRef(latest), {
          code: 'queue-failed',
          message: `Could not queue goal round ${round}: ${renderThrown(error)}`,
        })
      }
    }
  }

  /** Coalesce triggers onto one agent-local serialized driver. */
  /* 中文说明：函数 requestDrive 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
  function requestDrive(state: DriverState): void {
    /* v8 ignore next -- teardown may race a final trigger after synchronously closing the step fence */
    if (state.stopping) return
    state.requested = true
    if (state.run !== undefined) return
    /** 中文说明：领域局部值 run: Promise<void>，由紧邻初始化决定。 */
    let run: Promise<void>
    try {
      run = ctx.agents.withoutInitiator(async () => {
        while (state.requested && !state.stopping) {
          state.requested = false
          try {
            await drive(state)
          } catch (error: unknown) {
            ctx.logger.warn(`goal-round-driver: driver failed for agent "${state.agent.id}": ${renderThrown(error)}`)
            disarm(state)
          }
        }
      })
    } catch (error: unknown) {
      ctx.logger.warn(`goal-round-driver: could not start driver for agent "${state.agent.id}": ${renderThrown(error)}`)
      disarm(state)
      return
    }
    state.run = run
    /** 中文说明：领域局部值 retire，由紧邻初始化决定。 */
    const retire = (): void => {
      state.run = undefined
      if (state.requested && !state.stopping) requestDrive(state)
    }
    void run.then(retire, (error: unknown) => {
      ctx.logger.warn(`goal-round-driver: driver task rejected for agent "${state.agent.id}": ${renderThrown(error)}`)
      disarm(state)
      retire()
    })
  }

  // One composite effect keeps the step fence installed until this
  // plugin's own scheduling tasks settle.
  ctx.effect(function* () {
    ctx.on('agent/error', ({ agent }) => {
      /** 中文说明：领域局部值 state，由紧邻初始化决定。 */
      const state = stateFor(agent)
      disarm(state)
    })

    ctx.on('agent/created', ({ agent }) => { stateFor(agent) })
    ctx.on('agent/disposed', ({ agent }) => { states.delete(agent) })
    ctx.on('agent/session-start', ({ agent }) => {
      /** 中文说明：领域局部值 state，由紧邻初始化决定。 */
      const state = stateFor(agent)
      state.attempt = undefined
      state.competingQueued = false
      state.needsCheckpoint = false
    })
    ctx.on('agent/status', ({ agent, status }) => {
      /** 中文说明：领域局部值 state，由紧邻初始化决定。 */
      const state = stateFor(agent)
      if (status === 'idle') {
        state.competingQueued = false
        /** 中文说明：领域局部值 attempt，由紧邻初始化决定。 */
        const attempt = state.attempt
        /** 中文说明：领域局部值 goal，由紧邻初始化决定。 */
        const goal = currentGoal(state)
        // Fence the pause to the exact dropped attempt's ref. A resume bumps
        // the revision, so a host pause followed by an immediate resume (before
        // the aborted turn converges to idle) must not re-pause the resumed goal.
        if (attempt !== undefined
          && (attempt.phase === 'queued' || attempt.phase === 'claimed' || attempt.cancelled)
          && goal !== undefined && goal.phase === 'active' && goal.activation === 'armed'
          && attempt.goalId === goal.id && attempt.revision === goal.revision) {
          state.attempt = undefined
          try {
            ctx.goals.pause(agent, goalRef(goal))
          } catch (error: unknown) {
            ctx.logger.warn(`goal-round-driver: could not pause cancelled goal for agent "${agent.id}": ${renderThrown(error)}`)
            disarm(state)
          }
        }
        requestDrive(state)
      }
    })
    ctx.on('goal/changed', ({ agent, change }) => {
      const state = stateFor(agent)
      state.needsCheckpoint = true
      // A host-initiated pause stops goal execution: abort the live turn so the
      // model cannot keep acting or resume in the same turn. A model-initiated
      // pause (update_goal inside its own turn) finishes normally.
      if (change.operation === 'pause' && agent.status === 'running'
        && ctx.agents.currentInitiator() !== agent) {
        agent.cancel({ kind: 'user' }, { keepInbox: true })
      }
      requestDrive(state)
    })

    ctx.on('agent/inbox/inserted', ({ agent, message }) => {
      if (!agent.inbox.nextTurn.some(candidate => candidate.id === message.id)) return
      /** 中文说明：领域局部值 state，由紧邻初始化决定。 */
      const state = stateFor(agent)
      /** 中文说明：领域局部值 attempt，由紧邻初始化决定。 */
      const attempt = state.attempt
      if (attempt !== undefined && sameQueued(message.content, message.source, attempt)) return
      state.competingQueued = true
      if (attempt?.phase === 'queued') attempt.stale = true
    })
    ctx.on('agent/inbox/claimed', ({ agent, message }) => {
      /** 中文说明：领域局部值 state，由紧邻初始化决定。 */
      const state = stateFor(agent)
      /** 中文说明：领域局部值 attempt，由紧邻初始化决定。 */
      const attempt = state.attempt
      if (attempt !== undefined && sameQueued(message.content, message.source, attempt)) {
        attempt.phase = 'claimed'
      }
    })
    ctx.on('agent/inbox/discarded', ({ agent, message }) => {
      /** 中文说明：领域局部值 state，由紧邻初始化决定。 */
      const state = stateFor(agent)
      /** 中文说明：领域局部值 attempt，由紧邻初始化决定。 */
      const attempt = state.attempt
      if (attempt !== undefined && sameQueued(message.content, message.source, attempt)) {
        attempt.cancelled = true
      }
    })

    ctx.on('session/event', (session: Session, event: SessionEvent) => {
      /** 中文说明：领域局部值 agent，由紧邻初始化决定。 */
      const agent = ctx.agents.get(session.id)
      if (agent === undefined || agent.session !== session) return
      /** 中文说明：领域局部值 state，由紧邻初始化决定。 */
      const state = stateFor(agent)
      switch (event.type) {
        case 'user/message':
          if (state.attempt !== undefined && event.data.id === state.attempt.messageId) {
            state.attempt.phase = 'admitted'
          }
          return
        case 'turn/end':
          if (event.data.reason.kind === 'max-tokens') {
            disarm(state)
            return
          }
          if (event.data.reason.kind !== 'aborted') return
          if (state.attempt?.phase === 'claimed' || state.attempt?.phase === 'admitted') {
            state.attempt.cancelled = true
          }
          else disarm(state)
          return
        default:
          return
      }
    })

    /** Fail closed unless the queued prompt still owns the exact live revision. */
    /* 中文说明：函数 validReservation 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
    function validReservation(
      state: DriverState,
      content: ContentBlock[],
      source: GoalMessageSource,
    ): boolean {
      /** 中文说明：领域局部值 attempt，由紧邻初始化决定。 */
      const attempt = state.attempt
      /** 中文说明：领域局部值 goal，由紧邻初始化决定。 */
      const goal = currentGoal(state)
      return ctx.fiber.state === FiberState.ACTIVE
        && !state.stopping && attempt !== undefined && attempt.phase === 'claimed'
      && !attempt.stale && sameQueued(content, source, attempt)
      && goal !== undefined && goal.id === source.goalId && goal.revision === source.revision
      && goal.phase === 'active' && goal.activation === 'armed'
      && source.round === goal.roundsStarted + 1
    }

    ctx.on('agent/pre-step', async ({ agent, messages, signal }, next): Promise<PreStepDecision> => {
      /** 中文说明：领域局部值 submitted，由紧邻初始化决定。 */
      const submitted = messages.find((message): message is UserMessage & { source: GoalMessageSource } =>
        isGoalRoundSource(message.source))
      if (submitted === undefined) return next()
      /** 中文说明：领域局部值 { content, source }，由紧邻初始化决定。 */
      const { content, source } = submitted
      /** 中文说明：领域局部值 state，由紧邻初始化决定。 */
      const state = stateFor(agent)
      /** 中文说明：领域局部值 valid，由紧邻初始化决定。 */
      let valid = false
      try {
        valid = validReservation(state, content, source)
      } catch (error: unknown) {
        ctx.logger.warn(`goal-round-driver: pre-step check failed for agent "${agent.id}": ${renderThrown(error)}`)
        disarm(state)
      }
      if (!valid) {
        /** 中文说明：领域局部值 attempt，由紧邻初始化决定。 */
        const attempt = state.attempt
        if (attempt !== undefined && sameRound(source, attempt)) {
          attempt.stale = true
          state.attempt = undefined
        }
        restoreOtherClaimed(agent, messages, submitted.id)
        requestDrive(state)
        return { kind: 'reject' }
      }
      /** 中文说明：领域局部值 decision: PreStepDecision，由紧邻初始化决定。 */
      let decision: PreStepDecision
      try {
        decision = await next()
      } catch (error: unknown) {
        if (signal.aborted) throw error
        // A throwing downstream hook drops the whole step proposal. Clear the
        // reservation before the balanced no-step turn returns to idle so the
        // next drive pass can reschedule the round.
        state.attempt = undefined
        requestDrive(state)
        throw error
      }
      if (signal.aborted) {
        if (decision.kind === 'enter') restoreOtherClaimed(agent, decision.messages, submitted.id)
        return decision
      }
      if (decision.kind === 'reject') {
        state.attempt = undefined
        /** 中文说明：领域局部值 goal，由紧邻初始化决定。 */
        const goal = currentGoal(state)
        if (goal !== undefined && goal.id === source.goalId && goal.revision === source.revision
          && goal.phase === 'active' && goal.activation === 'armed') {
          ctx.goals.block(agent, goalRef(goal), {
            code: 'prompt-rejected',
            message: 'Goal round was rejected before entering its step.',
          })
        }
        return decision
      }
      try {
        valid = validReservation(state, content, source)
      } catch (error: unknown) {
        ctx.logger.warn(`goal-round-driver: post-decision check failed for agent "${agent.id}": ${renderThrown(error)}`)
        disarm(state)
        valid = false
      }
      if (!valid) {
        state.attempt = undefined
        restoreOtherClaimed(agent, decision.messages, submitted.id)
        requestDrive(state)
        return { kind: 'reject' }
      }
      return { ...decision, startsRequestSeries: true }
    })

    // Loading a lifecycle driver over existing agents never inherits hidden
    // automatic authority from an earlier producer instance.
    /** 中文说明：领域局部值 agent，由紧邻初始化决定。 */
    for (const agent of ctx.agents.list()) {
      /** 中文说明：领域局部值 state，由紧邻初始化决定。 */
      const state = stateFor(agent)
      disarm(state)
    }

    // Yielded after listener registration, so this close runs first and the
    // composite effect removes listeners only after its promise settles.
    yield async () => {
      /** 中文说明：领域局部值 waits，由紧邻初始化决定。 */
      const waits: Promise<void>[] = []
      /** 中文说明：领域局部值 state，由紧邻初始化决定。 */
      for (const state of states.values()) {
        state.stopping = true
        disarm(state)
        /** 中文说明：领域局部值 attempt，由紧邻初始化决定。 */
        const attempt = state.attempt
        if (attempt !== undefined) {
          attempt.stale = true
          /* v8 ignore next -- followup reserves the live agent before publishing a queued attempt */
          if (state.agent.status === 'running') {
            state.agent.cancel({ kind: 'parent' })
            waits.push(state.agent.whenIdle())
          }
        }
        if (state.run !== undefined) waits.push(state.run)
      }
      await Promise.allSettled(waits)
      states.clear()
    }
  }, 'goal-round-driver lifecycle')
}
