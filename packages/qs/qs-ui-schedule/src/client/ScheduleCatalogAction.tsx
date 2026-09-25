/** 活动提醒只读视图；浏览器时钟仅用于展示，不触发调度执行。 */
import {
  useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import type { ScheduleRecord } from '@deepseek-ai/dsh-schedule/client'
import {
  IconAlarmClockOutline16,
  IconChevronDownOutline14,
  useAnchoredPosition,
  useDismissOnOutsidePointer,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-qs-composer/client'
import { NS } from './locales.ts'
import css from './ScheduleCatalogAction.module.css'

/** Full props for the Session-header Schedule catalog action. */
export type ScheduleCatalogActionProps =
  PropsRuntime<'qs.stage.header.actions'> & PropsLocale<typeof NS>

type TimeUnit = 'day' | 'hour' | 'minute' | 'second'

const EMPTY_RECORDS: readonly ScheduleRecord[] = []
const SECOND_MS = 1_000
const SECOND_UNIT = { unit: 'second', seconds: 1 } as const
const MEASURE_STYLE: CSSProperties = { visibility: 'hidden', left: 0, top: 0 }
const UNIT_SECONDS: readonly { unit: TimeUnit; seconds: number }[] = [
  { unit: 'day', seconds: 86_400 },
  { unit: 'hour', seconds: 3_600 },
  { unit: 'minute', seconds: 60 },
  SECOND_UNIT,
]

/** Localized unit word for one integral magnitude. */
function unitLabel(unit: TimeUnit, value: number, t: TranslateNS<typeof NS>): string {
  const keys = {
    day: ['unit.day.one', 'unit.day.other'],
    hour: ['unit.hour.one', 'unit.hour.other'],
    minute: ['unit.minute.one', 'unit.minute.other'],
    second: ['unit.second.one', 'unit.second.other'],
  } as const
  const pair = keys[unit]
  return t(value === 1 ? pair[0] : pair[1], { count: value })
}

/**
 * 按最大整除单位显示持久化周期，不舍入调度间隔。
 * @param record - 官方活动提醒。
 * @param t - 本包本地化函数。
 * @returns 本地化的单次或重复周期。
 */
export function formatScheduleFrequency(
  record: ScheduleRecord,
  t: TranslateNS<typeof NS>,
): string {
  if (record.kind !== 'every') return t('frequency.once')
  let selected: { unit: TimeUnit; seconds: number } = SECOND_UNIT
  for (const candidate of UNIT_SECONDS) {
    if (record.everySeconds % candidate.seconds !== 0) continue
    selected = candidate
    break
  }
  const value = record.everySeconds / selected.seconds
  return t('frequency.every', { value, unit: unitLabel(selected.unit, value, t) })
}

/**
 * 将持久化 UTC 目标按浏览器时区显示。
 * @param scheduledAt - 官方已验证的 UTC 时间。
 * @param locale - 当前界面语言；省略则使用浏览器语言。
 * @returns 本机时间文本。
 */
export function formatScheduleLocalTime(scheduledAt: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    // 夏令时回拨会重复本地时刻，偏移用于区分两个真实时间点。
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'shortOffset',
  }).format(Date.parse(scheduledAt))
}

/**
 * 相对时间仅用于展示，不改变执行状态。
 * @param scheduledAt - 持久化目标时间。
 * @param now - 浏览器当前毫秒时间。
 * @param t - 本包本地化函数。
 * @returns 到期或相对时间文本。
 */
export function formatScheduleRelative(
  scheduledAt: string,
  now: number,
  t: TranslateNS<typeof NS>,
): string {
  const difference = Date.parse(scheduledAt) - now
  if (difference === 0) return t('relative.now')
  const absoluteSeconds = Math.abs(difference) / SECOND_MS
  const selected = UNIT_SECONDS.find(candidate => absoluteSeconds >= candidate.seconds)
    ?? SECOND_UNIT
  const value = Math.max(1, difference > 0
    ? Math.ceil(absoluteSeconds / selected.seconds)
    : Math.floor(absoluteSeconds / selected.seconds))
  const unit = unitLabel(selected.unit, value, t)
  return t(difference > 0 ? 'relative.future' : 'relative.overdue', { value, unit })
}

/**
 * 逾期记录优先，其余按目标时间升序，同时间保持原始顺序。
 * @param records - 完整活动提醒投影。
 * @param now - 浏览器当前毫秒时间。
 * @returns 独立排序数组，不修改投影。
 */
export function orderScheduleRecords(
  records: readonly ScheduleRecord[],
  now: number,
): ScheduleRecord[] {
  return records.map((record, index) => ({ record, index })).sort((left, right) => {
    const leftTime = Date.parse(left.record.scheduledAt)
    const rightTime = Date.parse(right.record.scheduledAt)
    const leftOverdue = leftTime <= now
    const rightOverdue = rightTime <= now
    if (leftOverdue !== rightOverdue) return Number(rightOverdue) - Number(leftOverdue)
    return leftTime - rightTime || left.index - right.index
  }).map(({ record }) => record)
}

/**
 * 当前会话的只读活动提醒目录。
 * @param props - 官方会话座席及本包字典。
 * @returns 按会话身份隔离的目录视图。
 */
export function ScheduleCatalogAction(props: ScheduleCatalogActionProps) {
  // 会话切换销毁弹层及计时器，避免沿用上一会话的展开状态。
  return <SchedulePanel key={props.sessionId} {...props} />
}

function SchedulePanel({ useSession, useProjection, t }: ScheduleCatalogActionProps) {
  const openState = useSession(snapshot => snapshot.openState)
  const projected = useProjection('schedule')
  const records = projected ?? EMPTY_RECORDS
  const visible = openState === 'open' && records.length > 0
  const [open, setOpen] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const catalogRef = useRef<HTMLDivElement>(null)
  const catalogPosition = useAnchoredPosition({
    open,
    anchorRef: triggerRef,
    panelRef: catalogRef,
    side: 'bottom',
    gap: 5,
    margin: 16,
  })

  useDismissOnOutsidePointer(rootRef, open, setOpen, catalogRef)

  useEffect(() => {
    if (!open) return
    setNow(Date.now())
    const timer = setInterval(() => { setNow(Date.now()) }, SECOND_MS)
    return () => { clearInterval(timer) }
  }, [open])

  useEffect(() => {
    if (visible || !open) return
    setOpen(false)
  }, [visible, open])

  const rows = useMemo(() => orderScheduleRecords(records, now), [records, now])

  if (!visible) return null

  const countKey = records.length === 1 ? 'trigger.one' : 'trigger.other'
  const countLabel = t(countKey, { count: records.length })
  const toggleCatalog = (): void => {
    setNow(Date.now())
    setOpen(current => !current)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Escape' || !open) return
    event.preventDefault()
    setOpen(false)
    triggerRef.current?.focus()
  }
  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      className={css.trigger}
      aria-expanded={open}
      aria-label={countLabel}
      onClick={toggleCatalog}
    >
      <IconAlarmClockOutline16 size={14} />
      <span className={css.count}>{countLabel}</span>
      <IconChevronDownOutline14 className={open ? css.triggerOpen : undefined} />
    </button>
  )
  const catalog = open
    ? createPortal((
      <div
        ref={catalogRef}
        className={css.menu}
        style={catalogPosition ?? MEASURE_STYLE}
      >
        <p className={css.notice}>{t('list.limit')}</p>
        <ul className={css.records} aria-label={t('list.aria')}>
          {rows.map((record) => {
            const overdue = Date.parse(record.scheduledAt) <= now
            return (
              <li
                key={record.id}
                className={overdue ? `${css.row} ${css.rowOverdue}` : css.row}
              >
                <span className={css.status}>
                  <span className={css.statusDot} aria-hidden="true" />
                  <span>{t(overdue ? 'status.overdue' : 'status.scheduled')}</span>
                </span>
                <span className={css.prompt}>{record.prompt}</span>
                <span className={css.metadata}>
                  <span>{formatScheduleFrequency(record, t)}</span>
                  <span aria-hidden="true">·</span>
                  <time dateTime={record.scheduledAt}>{formatScheduleLocalTime(record.scheduledAt, document.documentElement.lang)}</time>
                  <span>{t('time.utc', { value: record.scheduledAt })}</span>
                  <span aria-hidden="true">·</span>
                  <span className={overdue ? css.relativeOverdue : undefined}>
                    {formatScheduleRelative(record.scheduledAt, now, t)}
                  </span>
                </span>
              </li>
            )
          })}
        </ul>
      </div>
    // 门户挂到当前工作台根以继承明暗令牌，避开转写滚动容器的裁剪。
    ), rootRef.current?.closest('.qs-root') ?? document.body)
    : null

  return (
    <div ref={rootRef} className={css.root} onKeyDown={onKeyDown}>
      {trigger}
      {catalog}
    </div>
  )
}
