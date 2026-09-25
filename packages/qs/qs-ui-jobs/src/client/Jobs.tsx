/** 五态只读作业列表；连接状态属于共享控制流，不由空列表推断。 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { SessionJob } from '@deepseek-ai/dsh-api-session-controller/types'
import { StateDot, useDismissOnOutsidePointer, type StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { JobsProps } from './contract.ts'
import css from './jobs.module.css'

const EMPTY: readonly SessionJob[] = []
const status: Record<SessionJob['status'], { dot: StateDotState; key: 'running' | 'stopping' | 'completed' | 'killed' | 'failedJob' }> = {
  running: { dot: 'ongoing', key: 'running' }, stopping: { dot: 'warning', key: 'stopping' },
  completed: { dot: 'done', key: 'completed' }, killed: { dot: 'warning', key: 'killed' },
  failed: { dot: 'error', key: 'failedJob' },
}
function live(job: SessionJob): boolean { return job.status === 'running' || job.status === 'stopping' }
function ordered(jobs: readonly SessionJob[]): SessionJob[] {
  return [...jobs].sort((a, b) => {
    if (live(a) !== live(b)) return live(a) ? -1 : 1
    if (live(a)) return a.startedAt - b.startedAt
    return ((b.finishedAt ?? b.startedAt) - (a.finishedAt ?? a.startedAt)) || a.startedAt - b.startedAt
  })
}
function duration(ms: number, t: JobsProps['t']): string {
  const total = Math.max(0, Math.floor(ms / 1_000)), seconds = total % 60
  const minutes = Math.floor(total / 60) % 60, hours = Math.floor(total / 3_600)
  if (hours > 0) return t('hours', { hours, minutes })
  if (minutes > 0) return t('minutes', { minutes, seconds })
  return t('seconds', { seconds })
}

function JobPanel({ sessionId, useSessions, useQsJobsControl, retry, t }: JobsProps): ReactNode {
  const jobs = useSessions(s => s.jobsBySession[sessionId]) ?? EMPTY
  const control = useQsJobsControl(s => s)
  const [open, setOpen] = useState(false), [now, setNow] = useState(() => Date.now())
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null)
  const rows = useMemo(() => ordered(jobs), [jobs])
  const ticking = open && control.phase === 'ready' && jobs.some(live)
  useDismissOnOutsidePointer(root, open, setOpen)
  useEffect(() => {
    if (!ticking) return
    setNow(Date.now())
    const timer = setInterval(() => { setNow(Date.now()) }, 1_000)
    return () => { clearInterval(timer) }
  }, [ticking])
  const close = (): void => { setOpen(false); trigger.current?.focus() }
  return (
    <div ref={root} className={css.root} data-qs-jobs onKeyDown={(event) => {
      if (event.key === 'Escape' && open) { event.preventDefault(); close() }
    }}>
      <button ref={trigger} type="button" className={css.trigger} aria-expanded={open} onClick={() => {
        setNow(Date.now()); setOpen(value => !value)
      }}>{control.baseline === 0 ? t('title') : t('count', { count: jobs.length })}</button>
      {open ? <section className={css.panel} aria-label={t('title')}>
        <strong>{t('title')}</strong>
        {control.phase !== 'ready' ? <p role="status">{t(control.phase)}</p> : null}
        {control.phase === 'failed' ? <button type="button" className={css.action} onClick={() => {
          // 所有者在拒绝处置时保留 failed 状态；视图不显示远端错误正文。
          void retry().catch(() => { /* 处置拒绝已由 control.state 保留失败状态。 */ })
        }}>{t('retry')}</button> : null}
        {rows.length === 0 && control.phase === 'ready' ? <p>{t('empty')}</p> : null}
        <ul className={css.list}>
          {rows.map(job => <li key={job.id} className={css.row} data-qs-job={job.id}>
            <div className={css.rowTitle}>
              <StateDot state={status[job.status].dot} /><strong>{job.label}</strong><span>{t(status[job.status].key)}</span>
            </div>
            <small>{job.id} · {job.kind}</small>
            <p>{job.detail ?? t('noDetail')}</p>
            <dl>
              <dt>{t('start')}</dt><dd><time dateTime={new Date(job.startedAt).toISOString()}>{new Date(job.startedAt).toISOString()}</time></dd>
              <dt>{t('end')}</dt><dd>{job.finishedAt === undefined ? t(live(job) ? 'unfinished' : 'unavailable') : <time dateTime={new Date(job.finishedAt).toISOString()}>{new Date(job.finishedAt).toISOString()}</time>}</dd>
              <dt>{t('elapsed')}</dt><dd>{live(job)
                ? control.phase === 'ready' ? duration(now - job.startedAt, t) : t('stale')
                : job.finishedAt === undefined ? t('unavailable') : duration(job.finishedAt - job.startedAt, t)}</dd>
            </dl>
          </li>)}
        </ul>
        <p className={css.limitation}>{t('noResult')}</p>
        <button type="button" className={css.action} onClick={close}>{t('return')}</button>
      </section> : null}
    </div>
  )
}

/**
 * 按会话重建弹层状态，切换不会保留前一会话的展开状态。
 * @param props - 会话镜像、控制流状态及语言。
 * @returns 当前会话的只读作业入口。
 */
export function Jobs(props: JobsProps): ReactNode { return <JobPanel key={props.sessionId} {...props} /> }
