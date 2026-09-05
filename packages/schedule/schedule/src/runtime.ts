/**
 * Disposable live timer projection for one exact root agent.
 * @module @deepseek-ai/dsh-schedule
 */

/*
 * 【文件职责】为一个确定的根 Agent 持有可释放计时器，唤醒后重新检查时间与所有权再派发提醒。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { EveryScheduleRecord, OneShotScheduleRecord } from './types.ts'
import {
  foldScheduleEvents,
  renderEveryReminderBatchFraming,
  renderReminderFraming,
  resolveEveryOccurrence,
  ScheduleLogError,
} from './domain.ts'
import type { FoldedSchedules } from './domain.ts'
import { flushSchedulePersistence } from './persistence.ts'
import { runScheduleTransaction } from './transaction.ts'

/** Largest delay that Node timers represent without clamping. */
/* 中文说明：常量 MAX_TIMER_DELAY_MS 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
export const MAX_TIMER_DELAY_MS = 2_147_483_647

/** 中文说明：interface EveryDue 定义本模块所需的数据或行为，用于表达计划调度场景。 */
interface EveryDue {
  readonly record: EveryScheduleRecord
  readonly occurrenceAt: string
}

/** 中文说明：type DueDecision 定义本模块所需的数据或行为，用于表达计划调度场景。 */
type DueDecision =
  | { readonly kind: 'one-shot'; readonly record: OneShotScheduleRecord }
  | { readonly kind: 'every'; readonly reminders: readonly EveryDue[]; readonly acceptedAt: string }
  | { readonly kind: 'wait'; readonly target?: number }

/** Select one due one-shot, one complete fixed-rate batch, or the next wake. */
/* 中文说明：函数 dueDecision 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function dueDecision(folded: FoldedSchedules, now: number): DueDecision {
  /** 中文说明：函数值 indexed 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const indexed = folded.active.map((record, index) => ({ record, index }))
  /** 中文说明：变量 byTargetThenCreate 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const byTargetThenCreate = (
    left: { readonly record: { readonly scheduledAt: string }; readonly index: number },
    right: { readonly record: { readonly scheduledAt: string }; readonly index: number },
  ): number => Date.parse(left.record.scheduledAt) - Date.parse(right.record.scheduledAt)
    || left.index - right.index

  /** 中文说明：变量 oneShot 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const oneShot = indexed
    .filter((entry): entry is { record: OneShotScheduleRecord; index: number } =>
      entry.record.kind !== 'every' && Date.parse(entry.record.scheduledAt) <= now)
    .sort(byTargetThenCreate)[0]?.record
  if (oneShot !== undefined) return { kind: 'one-shot', record: oneShot }

  /** 中文说明：变量 every 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const every = indexed
    .filter((entry): entry is { record: EveryScheduleRecord; index: number } =>
      entry.record.kind === 'every' && Date.parse(entry.record.scheduledAt) <= now)
    .sort(byTargetThenCreate)
  if (every.length > 0) {
    return {
      kind: 'every',
      acceptedAt: new Date(now).toISOString(),
      reminders: every.map(({ record }) => ({
        record,
        occurrenceAt: resolveEveryOccurrence(record, now).occurrenceAt,
      })),
    }
  }

  /** 中文说明：函数值 target 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const target = folded.active.reduce<number | undefined>((selected, record) => {
    /** 中文说明：变量 candidate 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const candidate = Date.parse(record.scheduledAt)
    return candidate > now && (selected === undefined || candidate < selected) ? candidate : selected
  }, undefined)
  return { kind: 'wait', ...(target === undefined ? {} : { target }) }
}

/** Render an unknown value for process-local diagnostics only. */
/* 中文说明：函数 renderThrown 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function renderThrown(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}

/** One process-local, disposable projection of an exact agent's durable schedules. */
/* 中文说明：class ScheduleRuntime 定义本模块所需的数据或行为，用于表达计划调度场景。 */
export class ScheduleRuntime {
  private readonly stop = Promise.withResolvers<void>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private idleWait: Promise<void> | undefined
  private run: Promise<void> | undefined
  private requested = false
  private stopping = false
  private faulted = false
  private disposal: Promise<void> | undefined

  /**
   * Construct an inactive runtime; {@link start} begins the first preflight.
   * @param ctx - Global service context.
   * @param agent - Exact live root agent.
   */
  constructor(
    private readonly ctx: Context,
    private readonly agent: Agent,
  ) {}

  /** Begin the initial durability preflight and timer derivation. */
  start(): void {
    this.requestDrive()
  }

  /** Recompute the live projection after a committed mutation or idle transition. */
  requestDrive(): void {
    if (this.stopping || this.faulted) return
    this.clearTimer()
    this.requested = true
    if (this.run !== undefined) return
    /** 中文说明：变量 run 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let run: Promise<void>
    try {
      run = this.ctx.agents.withoutInitiator(() => this.runRequested())
    } catch (error: unknown) {
      if (this.isLive()) {
        this.ctx.logger.warn(`schedule: could not start runtime for agent "${this.agent.id}": ${renderThrown(error)}`)
      }
      return
    }
    this.run = run
    void run.then(
      () => { this.retire(run) },
      (error: unknown) => {
        if (this.isLive()) {
          this.ctx.logger.warn(`schedule: runtime failed for agent "${this.agent.id}": ${renderThrown(error)}`)
        }
        this.faulted = true
        this.retire(run)
      },
    )
  }

  /** Stop future work, cancel timers, and await every outstanding runtime promise. */
  dispose(): Promise<void> {
    return (this.disposal ??= (async () => {
      this.stopping = true
      this.requested = false
      this.clearTimer()
      this.stop.resolve()
      /** 中文说明：函数值 pending 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
      const pending = [this.run, this.idleWait].filter((value): value is Promise<void> => value !== undefined)
      await Promise.allSettled(pending)
    })())
  }

  /** Drain coalesced triggers serially. */
  private async runRequested(): Promise<void> {
    while (this.requested && !this.stopping && !this.faulted) {
      this.requested = false
      await runScheduleTransaction(this.agent, () => this.driveOnce())
    }
  }

  /** Retire one exact run and honor a trigger that landed during its final microtask. */
  private retire(run: Promise<void>): void {
    /* v8 ignore next -- only the exact stored run installs this callback. */
    if (this.run !== run) return
    this.run = undefined
    /* v8 ignore next -- covers a trigger in the promise-settlement microtask gap. */
    if (this.requested && !this.stopping && !this.faulted) this.requestDrive()
  }

  /** Whether this exact root lifecycle remains authoritative. */
  private isLive(): boolean {
    return this.ctx.agents.get(this.agent.id) === this.agent
      && this.ctx.agents.roots().includes(this.agent)
  }

  /** Whether this runtime may start or continue Schedule work. */
  private isRunnable(): boolean {
    return !this.stopping && this.isLive()
  }

  /** Cancel the currently armed timer, if any. */
  private clearTimer(): void {
    if (this.timer === undefined) return
    clearTimeout(this.timer)
    this.timer = undefined
  }

  /** Arm one bounded timer segment; every wake rechecks the wall clock. */
  private arm(target: number, now: number): void {
    /** 中文说明：变量 delay 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const delay = Math.min(target - now, MAX_TIMER_DELAY_MS)
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.requestDrive()
    }, delay)
  }

  /** Await one public idle boundary without holding admission or creating a retry timer. */
  private waitForIdle(): void {
    if (this.idleWait !== undefined) return
    /** 中文说明：变量 wait 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const wait = Promise.race([this.agent.whenIdle(), this.stop.promise])
    this.idleWait = wait
    void wait.then(
      () => {
        this.idleWait = undefined
        this.requestDrive()
      },
      (error: unknown) => {
        this.idleWait = undefined
        if (this.isLive()) {
          this.ctx.logger.warn(`schedule: idle wait failed for agent "${this.agent.id}": ${renderThrown(error)}`)
        }
      },
    )
  }

  /** Fold the current exact runtime suffix and contain a corrupt durable stream. */
  private readFolded(): FoldedSchedules | undefined {
    try {
      return foldScheduleEvents(this.agent.session.ownEvents())
    } catch (error: unknown) {
      this.faulted = true
      /** 中文说明：变量 detail 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const detail = error instanceof ScheduleLogError ? error.message : renderThrown(error)
      this.ctx.logger.warn(`schedule: corrupt schedule log for agent "${this.agent.id}": ${detail}`)
      return undefined
    }
  }

  /** Contain an invalid wall-clock decision without permanently faulting this runtime. */
  private decide(folded: FoldedSchedules, now: number): DueDecision | undefined {
    try {
      return dueDecision(folded, now)
    } catch (error: unknown) {
      this.ctx.logger.warn(`schedule: fixed-rate decision failed for agent "${this.agent.id}": ${renderThrown(error)}`)
      return undefined
    }
  }

  /** Preflight, fold, arm, or dispatch the next one-shot or fixed-rate batch. */
  private async driveOnce(): Promise<void> {
    this.clearTimer()
    if (!this.isRunnable()) return
    try {
      await flushSchedulePersistence(this.ctx, this.agent.session)
    } catch (error: unknown) {
      if (this.isLive()) {
        this.ctx.logger.warn(`schedule: preflight failed for agent "${this.agent.id}": ${renderThrown(error)}`)
      }
      return
    }
    if (!this.isRunnable()) return

    /** 中文说明：变量 folded 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const folded = this.readFolded()
    if (folded === undefined) return
    /** 中文说明：变量 wakeNow 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const wakeNow = Date.now()
    /** 中文说明：变量 wakeDecision 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const wakeDecision = this.decide(folded, wakeNow)
    if (wakeDecision === undefined) return
    if (wakeDecision.kind === 'wait') {
      if (wakeDecision.target !== undefined) this.arm(wakeDecision.target, wakeNow)
      return
    }

    /** 中文说明：变量 maintenance 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let maintenance: Promise<boolean>
    try {
      maintenance = this.agent.runMaintenance(() => {
        if (!this.isRunnable()) return Promise.resolve(false)
        /** 中文说明：变量 claimed 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const claimed = this.readFolded()
        if (claimed === undefined) return Promise.resolve(false)
        /** 中文说明：变量 decisionNow 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const decisionNow = Date.now()
        /** 中文说明：变量 decision 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const decision = this.decide(claimed, decisionNow)
        if (decision === undefined) return Promise.resolve(false)
        if (decision.kind === 'wait') {
          if (decision.target !== undefined) this.arm(decision.target, decisionNow)
          return Promise.resolve(false)
        }
        try {
          /** 中文说明：变量 text 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const text = decision.kind === 'one-shot'
            ? renderReminderFraming(decision.record)
            : renderEveryReminderBatchFraming(decision.reminders)
          /** 中文说明：变量 message 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const message = createUserMessage({
            content: [{ type: 'text', text }],
            source: { kind: 'plugin', plugin: 'schedule' },
          })
          this.agent.followup(message)
        } catch (error: unknown) {
          if (this.isLive()) {
            this.ctx.logger.warn(`schedule: framing or followup failed for agent "${this.agent.id}": ${renderThrown(error)}`)
          }
          return Promise.resolve(false)
        }
        try {
          if (decision.kind === 'one-shot') {
            this.agent.session.append('schedule/change', {
              version: 1,
              operation: 'dispatch',
              id: decision.record.id,
            })
          } else {
            /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
            for (const reminder of decision.reminders) {
              this.agent.session.append('schedule/change', {
                version: 1,
                operation: 'dispatch',
                id: reminder.record.id,
                acceptedAt: decision.acceptedAt,
              })
            }
          }
        } catch (error: unknown) {
          this.faulted = true
          this.clearTimer()
          this.ctx.logger.warn(`schedule: dispatch append failed for agent "${this.agent.id}": ${renderThrown(error)}`)
          return Promise.resolve(false)
        }
        return Promise.resolve(true)
      })
    } catch (_busy: unknown) {
      // `runMaintenance` rejects synchronously only while another agent activity owns the idle phase.
      if (this.isLive()) this.waitForIdle()
      return
    }
    if (!await maintenance) return

    try {
      await flushSchedulePersistence(this.ctx, this.agent.session)
    } catch (error: unknown) {
      if (this.isLive()) {
        this.ctx.logger.warn(`schedule: dispatch barrier failed for agent "${this.agent.id}": ${renderThrown(error)}`)
      }
      return
    }
    if (this.isRunnable()) this.requestDrive()
  }
}
