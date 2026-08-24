/**
 * 文件职责：实现任务列表的 JobListAction 组件。
 * 技术维度：React、TypeScript、Cordis 插槽和 CSS Modules。
 * 产品维度：支持用户查看或调整任务列表。
 * 逻辑维度：读取服务状态，派生展示值并处理交互。
 * 关键边界：加载、禁用、错误和可访问性状态必须一致。
 * 新手阅读建议：先读 Props，再看状态、effect 与 JSX。
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { JobView } from '@deepseek-ai/dsh-client-runtime/client'
import { IconChevronDownOutline14, StateDot, useDismissOnOutsidePointer, type StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import css from './JobListAction.module.css'

/** Full props for the session-header background-job action. */
/** 中文说明：类型或类 JobListActionProps 约束本文件数据或组件职责。 */
export type JobListActionProps =
  PropsRuntime<'conversation.session.header.actions'> & PropsLocale<typeof NS>

/** Stable empty list so a session with no jobs keeps one array identity. */
/** 中文说明：组件局部值 NO_TASKS，由紧邻初始化决定。 */
const NO_TASKS: readonly JobView[] = []

/** A job the registry still holds open, and whose duration therefore ticks. */
/** 中文说明：函数 isLive 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function isLive(job: JobView): boolean {
  return job.status === 'running' || job.status === 'stopping'
}

/** Closed-union exhaustiveness fence for the wire status set. */
/** 中文说明：函数 assertNever 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
/* v8 ignore next 3 -- closed-union backstop; only reached if a status is forged */
function assertNever(value: never): never {
  throw new Error(`unhandled job status: ${JSON.stringify(value)}`)
}

/**
 * Status marker semantics. `stopping` and `killed` share the attention color:
 * both mean the work ended (or is ending) on request rather than on its own.
 */
/** 中文说明：函数 dotState 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function dotState(status: JobView['status']): StateDotState {
  switch (status) {
    case 'running': return 'ongoing'
    case 'stopping': return 'warning'
    case 'completed': return 'done'
    case 'killed': return 'warning'
    case 'failed': return 'error'
    /* v8 ignore next -- closed wire status union */
    default: return assertNever(status)
  }
}

/** Human status word for the row and its accessible name. */
/** 中文说明：函数 statusLabel 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function statusLabel(status: JobView['status'], t: TranslateNS<typeof NS>): string {
  switch (status) {
    case 'running': return t('status.running')
    case 'stopping': return t('status.stopping')
    case 'completed': return t('status.completed')
    case 'killed': return t('status.killed')
    case 'failed': return t('status.failed')
    /* v8 ignore next -- closed wire status union */
    default: return assertNever(status)
  }
}

/**
 * Elapsed time in at most two adjacent units. A background job that outlives
 * an hour is already exceptional, so hours is the widest unit — beyond that the
 * figure stays in hours rather than growing a day/month vocabulary no producer
 * currently reaches.
 */
/** 中文说明：函数 formatDuration 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function formatDuration(elapsedMs: number, t: TranslateNS<typeof NS>): string {
  /** 中文说明：组件局部值 total，由紧邻初始化决定。 */
  const total = Math.max(0, Math.floor(elapsedMs / 1_000))
  /** 中文说明：组件局部值 seconds，由紧邻初始化决定。 */
  const seconds = total % 60
  /** 中文说明：组件局部值 minutes，由紧邻初始化决定。 */
  const minutes = Math.floor(total / 60) % 60
  /** 中文说明：组件局部值 hours，由紧邻初始化决定。 */
  const hours = Math.floor(total / 3_600)
  if (hours > 0) return t('duration.hours', { hours, minutes })
  if (minutes > 0) return t('duration.minutes', { minutes, seconds })
  return t('duration.seconds', { seconds })
}

/**
 * Live rows first in start order, then settled rows newest-first. Two jobs
 * that settled in the same millisecond fall back to start order, so the sort
 * never depends on the host's map iteration.
 */
/** 中文说明：函数 ordered 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function ordered(jobs: readonly JobView[]): JobView[] {
  return [...jobs].sort((left, right) => {
    /** 中文说明：组件局部值 liveLeft，由紧邻初始化决定。 */
    const liveLeft = isLive(left)
    if (liveLeft !== isLive(right)) return liveLeft ? -1 : 1
    if (liveLeft) return left.startedAt - right.startedAt
    /** 中文说明：组件局部值 finished，由紧邻初始化决定。 */
    const finished = (right.finishedAt ?? right.startedAt) - (left.finishedAt ?? left.startedAt)
    return finished !== 0 ? finished : left.startedAt - right.startedAt
  })
}

/**
 * Session-header entry point for this session's background jobs. It renders
 * nothing at all until the session has at least one job, so an ordinary
 * conversation never grows a control for a capability it is not using.
 * @param props - runtime slot currency plus the namespace translator.
 * @returns the trigger and its popover list, or null when there is nothing to show.
 */
/** 中文说明：函数 JobListAction 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function JobListAction({ sessionId, useSessions, t }: JobListActionProps) {
  /** 中文说明：组件局部值 jobs，由紧邻初始化决定。 */
  const jobs = useSessions(state => state.jobsBySession[sessionId]) ?? NO_TASKS
  /** 中文说明：组件局部值 [open, setOpen]，由紧邻初始化决定。 */
  const [open, setOpen] = useState(false)
  /** 中文说明：组件局部值 [now, setNow]，由紧邻初始化决定。 */
  const [now, setNow] = useState(() => Date.now())
  /** 中文说明：组件局部值 rootRef，由紧邻初始化决定。 */
  const rootRef = useRef<HTMLDivElement>(null)
  /** 中文说明：组件局部值 triggerRef，由紧邻初始化决定。 */
  const triggerRef = useRef<HTMLButtonElement>(null)

  /** 中文说明：组件局部值 rows，由紧邻初始化决定。 */
  const rows = useMemo(() => ordered(jobs), [jobs])
  /** 中文说明：组件局部值 liveCount，由紧邻初始化决定。 */
  const liveCount = useMemo(() => jobs.filter(isLive).length, [jobs])

  useDismissOnOutsidePointer(rootRef, open, setOpen)

  // The clock only runs while an open list is showing something that moves.
  useEffect(() => {
    if (!open || liveCount === 0) return
    setNow(Date.now())
    /** 中文说明：组件局部值 timer，由紧邻初始化决定。 */
    const timer = setInterval(() => { setNow(Date.now()) }, 1_000)
    return () => { clearInterval(timer) }
  }, [open, liveCount])

  // The last job disappearing removes this control; close first so focus does
  // not vanish from an unmounting node.
  useEffect(() => {
    if (jobs.length === 0 && open) setOpen(false)
  }, [jobs.length, open])

  if (jobs.length === 0) return null

  /** 中文说明：组件局部值 countKey，由紧邻初始化决定。 */
  const countKey = liveCount > 0
    ? (liveCount === 1 ? 'count.live.one' : 'count.live.other')
    : (jobs.length === 1 ? 'count.idle.one' : 'count.idle.other')
  /** 中文说明：组件局部值 countLabel，由紧邻初始化决定。 */
  const countLabel = t(countKey, { count: liveCount > 0 ? liveCount : jobs.length })

  /** 中文说明：组件局部值 onKeyDown，由紧邻初始化决定。 */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Escape' || !open) return
    event.preventDefault()
    setOpen(false)
    triggerRef.current?.focus()
  }

  return (
    <div ref={rootRef} className={css.root} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className={css.trigger}
        aria-expanded={open}
        aria-label={countLabel}
        onClick={() => {
          // Sample the clock in the same commit that opens the list: the
          // mount-time value predates every job, so the first painted frame
          // would otherwise clamp a long-running row to zero until the
          // open effect corrects it a frame later.
          setNow(Date.now())
          setOpen(current => !current)
        }}
      >
        {liveCount > 0 ? <StateDot state="ongoing" className={css.triggerDot} /> : null}
        <span className={css.count}>{countLabel}</span>
        <IconChevronDownOutline14 className={open ? css.triggerOpen : undefined} />
      </button>
      {open
        ? (
          <ul className={css.menu} aria-label={t('list.aria')}>
            {rows.map((job) => {
              /** 中文说明：组件局部值 live，由紧邻初始化决定。 */
              const live = isLive(job)
              /** 中文说明：组件局部值 elapsed，由紧邻初始化决定。 */
              const elapsed = live ? now - job.startedAt : (job.finishedAt ?? job.startedAt) - job.startedAt
              /** 中文说明：组件局部值 duration，由紧邻初始化决定。 */
              const duration = formatDuration(elapsed, t)
              /** 中文说明：组件局部值 status，由紧邻初始化决定。 */
              const status = statusLabel(job.status, t)
              return (
                <li key={job.id} className={live ? css.row : `${css.row} ${css.rowSettled}`}>
                  <StateDot state={dotState(job.status)} className={css.rowDot} />
                  <span className={css.kind}>{job.kind}</span>
                  <span className={css.label} title={job.label}>{job.label}</span>
                  <span className={css.status} title={job.detail ?? status}>{job.detail ?? status}</span>
                  <span
                    className={css.duration}
                    title={t(live ? 'duration.title.live' : 'duration.title.done', { duration })}
                  >
                    {duration}
                  </span>
                </li>
              )
            })}
          </ul>
        )
        : null}
    </div>
  )
}
