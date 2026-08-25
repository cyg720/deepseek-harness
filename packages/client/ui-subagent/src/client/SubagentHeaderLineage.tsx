/**
 * 文件职责：实现子代理谱系的 SubagentHeaderLineage 组件。
 * 技术维度：React、TypeScript、Cordis 插槽和 CSS Modules。
 * 产品维度：帮助用户查看或调整子代理谱系。
 * 逻辑维度：读取状态，派生展示信息并处理交互。
 * 关键边界：父子作用域、空状态、可访问性和主题同步必须正确。
 * 新手阅读建议：先读 Props，再看派生值、effect 和 JSX。
 */
import {
  useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent,
} from 'react'
import { createPortal } from 'react-dom'
import {
  indexSubagentDescendants, type SessionId, type SessionListState, type SessionProjectionMap,
  /** 中文说明：类型或类 SessionSummary 约束模块数据或组件职责。 */
  type SessionSummary, type SubagentAddress, type SubagentCatalogSnapshot,
} from '@deepseek-ai/dsh-client-runtime/client'
import {
  IconChevronDownOutline14, IconChevronRightOutline14, IconRefreshOutline14, StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-subagent/client'
import type {} from '@deepseek-ai/dsh-token-meter/client'
import css from './SubagentHeaderLineage.module.css'

/** 中文说明：类型或类 CatalogEntry 约束模块数据或组件职责。 */
type CatalogEntry = SubagentCatalogSnapshot['entries'][number]
/** 中文说明：类型或类 Catalogs 约束模块数据或组件职责。 */
type Catalogs = SessionListState['subagentsByParent']

/** Business actions supplied by the slot registration. */
/* 中文说明：类型或类 SubagentCatalogInjected 约束模块数据或组件职责。 */
export interface SubagentCatalogInjected {
  openChild: (address: SubagentAddress) => void
  refresh: (parentSessionId: SessionId) => void
  setCatalogOpen: (parentSessionId: SessionId, open: boolean) => void
}

/** Full props for the session-header lineage renderer. */
/* 中文说明：类型或类 SubagentHeaderLineageProps 约束模块数据或组件职责。 */
export type SubagentHeaderLineageProps =
  PropsRuntime<'conversation.session.header.lineage'> & SubagentCatalogInjected & PropsLocale<typeof NS>

/** 中文说明：类型或类 CatalogRowsProps 约束模块数据或组件职责。 */
interface CatalogRowsProps {
  parentSessionId: SessionId
  currentSessionId: SessionId | undefined
  catalog: SubagentCatalogSnapshot
  catalogs: Catalogs
  summaries: Readonly<Record<SessionId, SessionSummary>>
  expanded: ReadonlySet<SessionId>
  level: number
  now: number
  openChild: (address: SubagentAddress) => void
  refresh: (parentSessionId: SessionId) => void
  toggleBranch: (childSessionId: SessionId) => void
  closeCatalog: () => void
}

/** 中文说明：函数 diagnosticReason 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function diagnosticReason(
  entry: Extract<CatalogEntry, { kind: 'diagnostic' }>,
  t: TranslateNS<typeof NS>,
): string {
  switch (entry.reason) {
    case 'corrupt': return t('diagnostic.corrupt')
    case 'unsupported': return t('diagnostic.unsupported')
    case 'unavailable': return t('diagnostic.unavailable')
  }
}

/** 中文说明：函数 treeItems 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function treeItems(root: HTMLDivElement | null): HTMLElement[] {
  return root === null
    ? []
    : Array.from(root.querySelectorAll<HTMLElement>('[role="treeitem"]:not([aria-disabled="true"])'))
}

/** Compact token count shared in shape with the conversation stats strip. */
/* 中文说明：函数 formatTokens 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function formatTokens(value: number): string {
  /** 中文说明：组件局部值 scaled，由紧邻初始化决定。 */
  const scaled = (next: number): string => next >= 100
    ? String(Math.round(next))
    : String(Math.round(next * 10) / 10)
  if (value < 1_000) return String(value)
  if (value < 1_000_000) return `${scaled(value / 1_000)}K`
  return `${scaled(value / 1_000_000)}M`
}

/** Sum the four disjoint durable provider-usage buckets. */
/* 中文说明：函数 tokenTotal 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function tokenTotal(
  usage: SessionProjectionMap['tokenUsage'] | undefined,
): number | undefined {
  return usage === undefined
    ? undefined
    : usage.uncachedInputTokens + usage.outputTokens
      + usage.cacheReadTokens + usage.cacheWriteTokens
}

/** Exact whole-second active-turn duration for one catalog row. */
/* 中文说明：函数 activityDuration 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function activityDuration(
  summary: SessionSummary | undefined,
  activity: 'running' | 'inactive',
  now: number,
): number | undefined {
  if (summary === undefined) return undefined
  /** 中文说明：组件局部值 解构结果，由紧邻初始化决定。 */
  const timing: SessionProjectionMap['subagentTiming'] | undefined
    = summary.projectionValues?.subagentTiming
  if (timing === undefined) return undefined
  if (timing.active === undefined) return timing.settledMs
  /** 中文说明：组件局部值 end，由紧邻初始化决定。 */
  const end = activity === 'running'
    ? now
    : timing.active.through
  return timing.settledMs + Math.max(0, end - timing.active.since)
}

/** 中文说明：类型或类 DurationParts 约束模块数据或组件职责。 */
interface DurationParts {
  seconds: number
  minutes: number
  hours: number
  days: number
  totalMinutes: number
  totalHours: number
}

/** 中文说明：函数 splitDuration 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function splitDuration(ms: number): DurationParts {
  /** 中文说明：组件局部值 totalSeconds，由紧邻初始化决定。 */
  const totalSeconds = Math.floor(Math.max(0, ms) / 1_000)
  /** 中文说明：组件局部值 totalMinutes，由紧邻初始化决定。 */
  const totalMinutes = Math.floor(totalSeconds / 60)
  /** 中文说明：组件局部值 totalHours，由紧邻初始化决定。 */
  const totalHours = Math.floor(totalMinutes / 60)
  return {
    seconds: totalSeconds % 60,
    minutes: totalMinutes % 60,
    hours: totalHours % 24,
    days: Math.floor(totalHours / 24),
    totalMinutes,
    totalHours,
  }
}

/** Format a duration with decreasing visual precision at larger scales. */
/* 中文说明：函数 formatDuration 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function formatDuration(ms: number, t: TranslateNS<typeof NS>): string {
  /** 中文说明：组件局部值 解构结果，由紧邻初始化决定。 */
  const { seconds, minutes, hours, days, totalMinutes, totalHours } = splitDuration(ms)
  if (days >= 365) {
    /** 中文说明：组件局部值 years，由紧邻初始化决定。 */
    const years = Math.floor(days / 365)
    /** 中文说明：组件局部值 months，由紧邻初始化决定。 */
    const months = Math.floor((days % 365) / 30)
    return months === 0
      ? t('duration.years', { years })
      : t('duration.yearsMonths', { years, months })
  }
  if (days >= 30) {
    /** 中文说明：组件局部值 months，由紧邻初始化决定。 */
    const months = Math.floor(days / 30)
    /** 中文说明：组件局部值 remainingDays，由紧邻初始化决定。 */
    const remainingDays = days % 30
    return remainingDays === 0
      ? t('duration.months', { months })
      : t('duration.monthsDays', { months, days: remainingDays })
  }
  if (days > 0) {
    return hours === 0
      ? t('duration.days', { days })
      : t('duration.daysHours', { days, hours })
  }
  if (totalHours > 0) {
    return t('duration.hours', {
      hours: totalHours,
      minutes: String(minutes).padStart(2, '0'),
      seconds: String(seconds).padStart(2, '0'),
    })
  }
  if (totalMinutes > 0) {
    return t('duration.minutes', {
      minutes: totalMinutes,
      seconds: String(seconds).padStart(2, '0'),
    })
  }
  return t('duration.seconds', { seconds })
}

/** Preserve exact whole seconds for hover and accessible naming. */
/* 中文说明：函数 formatExactDuration 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function formatExactDuration(ms: number, t: TranslateNS<typeof NS>): string {
  /** 中文说明：组件局部值 解构结果，由紧邻初始化决定。 */
  const { seconds, minutes, hours, days } = splitDuration(ms)
  return days === 0
    ? formatDuration(ms, t)
    : t('duration.exactDays', {
      days,
      hours: String(hours).padStart(2, '0'),
      minutes: String(minutes).padStart(2, '0'),
      seconds: String(seconds).padStart(2, '0'),
    })
}

/** 中文说明：组件局部值 NO_DESCENDANTS，由紧邻初始化决定。 */
const NO_DESCENDANTS = { count: 0, runningCount: 0 } as const

/** 中文说明：函数 SubagentSwitcherIcon 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function SubagentSwitcherIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M5.99951 12.7L8.95546 14.9478C9.40011 15.2859 9.62244 15.455 9.87526 15.488C9.95774 15.4988 10.0413 15.4988 10.1238 15.488C10.3766 15.455 10.5989 15.2859 11.0436 14.9478L13.9995 12.7"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M13.9995 7.7417L11.0436 5.49387C10.5989 5.15574 10.3766 4.98668 10.1238 4.95362C10.0413 4.94283 9.95775 4.94283 9.87527 4.95362C9.62245 4.98668 9.40012 5.15574 8.95547 5.49387L5.99952 7.7417"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  )
}

/** Render the known direct-child shape while its authoritative catalog hydrates. */
/* 中文说明：函数 CatalogLoadingRows 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function CatalogLoadingRows({
  parentSessionId,
  summaries,
  level,
  t,
}: {
  parentSessionId: SessionId
  summaries: Readonly<Record<SessionId, SessionSummary>>
  level: number
  t: TranslateNS<typeof NS>
}) {
  /** 中文说明：组件局部值 children，由紧邻初始化决定。 */
  const children = Object.values(summaries).filter(summary => (
    summary.origin === 'subagent' && summary.parentId === parentSessionId
  ))
  if (children.length === 0) return <div className={css.notice}>{t('loading.label')}</div>
  return children.map(summary => (
    <div key={summary.id} className={css.node}>
      <div
        role="treeitem"
        aria-disabled="true"
        aria-level={level}
        aria-label={t('loading.aria')}
        className={`${css.row} ${css.disabled} ${css.loadingRow}`}
      >
        <span className={css.disclosureSpace} />
        <StateDot state={summary.running ? 'ongoing' : 'done'} />
        <span className={css.content}>
          <span className={css.label}>{t('loading.label')}</span>
        </span>
      </div>
    </div>
  ))
}

/** Render one catalog level and recurse only through explicitly expanded rows. */
/* 中文说明：函数 CatalogRows 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function CatalogRows({
  parentSessionId, currentSessionId, catalog, catalogs, summaries, expanded, level, now,
  openChild, refresh, toggleBranch, closeCatalog, t,
}: CatalogRowsProps & { t: TranslateNS<typeof NS> }) {
  /** 中文说明：组件局部值 emptyLoading，由紧邻初始化决定。 */
  const emptyLoading = catalog.state === 'loading' && catalog.entries.length === 0
  /** 中文说明：组件局部值 reserveDisclosure，由紧邻初始化决定。 */
  const reserveDisclosure = catalog.entries.some(
    entry => entry.kind === 'child' && entry.hasChildren,
  )
  return (
    <>
      {emptyLoading && (
        <CatalogLoadingRows
          parentSessionId={parentSessionId}
          summaries={summaries}
          level={level}
          t={t}
        />
      )}
      {catalog.state === 'error' && (
        <div className={css.error}>
          <span>{catalog.error?.message ?? t('load.error')}</span>
          <button
            type="button"
            className={css.refresh}
            onClick={() => { refresh(parentSessionId) }}
          >
            <IconRefreshOutline14 />
            {t('retry')}
          </button>
        </div>
      )}
      {catalog.entries.map((entry) => {
        if (entry.kind === 'diagnostic') {
          /** 中文说明：组件局部值 reason，由紧邻初始化决定。 */
          const reason = diagnosticReason(entry, t)
          return (
            <div key={entry.id} className={css.node}>
              <div
                role="treeitem"
                aria-disabled="true"
                aria-level={level}
                aria-label={`${entry.id} ${reason}`}
                className={`${css.row} ${css.disabled}`}
                title={reason}
              >
                {reserveDisclosure && <span className={css.disclosureSpace} />}
                <StateDot state="error" />
                <span className={css.content}>
                  <span className={css.label}>{entry.id}</span>
                  <span className={css.summary}>{reason}</span>
                </span>
              </div>
            </div>
          )
        }

        /** 中文说明：组件局部值 childCatalog，由紧邻初始化决定。 */
        const childCatalog = catalogs[entry.id]
        /** 中文说明：组件局部值 isCurrent，由紧邻初始化决定。 */
        const isCurrent = entry.id === currentSessionId
        /** 中文说明：组件局部值 isExpanded，由紧邻初始化决定。 */
        const isExpanded = expanded.has(entry.id)
        /** 中文说明：组件局部值 knownLeaf，由紧邻初始化决定。 */
        const knownLeaf = !entry.hasChildren
        /** 中文说明：组件局部值 childLoading，由紧邻初始化决定。 */
        const childLoading = childCatalog === undefined
          || (childCatalog.state === 'loading' && childCatalog.entries.length === 0)
        /** 中文说明：组件局部值 summary，由紧邻初始化决定。 */
        const summary = summaries[entry.id]
        /** 中文说明：组件局部值 label，由紧邻初始化决定。 */
        const label = entry.label ?? entry.id
        /** 中文说明：组件局部值 mode，由紧邻初始化决定。 */
        const mode = entry.mode === 'one-shot' ? t('mode.oneShot') : t('mode.continuable')
        /** 中文说明：组件局部值 activity，由紧邻初始化决定。 */
        const activity = entry.activity === 'running' ? t('activity.running') : t('activity.inactive')
        /** 中文说明：组件局部值 secondary，由紧邻初始化决定。 */
        const secondary = [summary?.title, mode, activity]
          .filter(value => value !== undefined)
          .join(' · ')
        /** 中文说明：组件局部值 totalTokens，由紧邻初始化决定。 */
        const totalTokens = tokenTotal(summary?.projectionValues?.tokenUsage)
        /** 中文说明：组件局部值 durationMs，由紧邻初始化决定。 */
        const durationMs = activityDuration(
          summary,
          entry.activity,
          now,
        )
        /** 中文说明：组件局部值 tokenMetric，由紧邻初始化决定。 */
        const tokenMetric = totalTokens === undefined
          ? undefined
          : `${formatTokens(totalTokens)} tok`
        /** 中文说明：组件局部值 durationMetric，由紧邻初始化决定。 */
        const durationMetric = durationMs === undefined
          ? undefined
          : {
            compact: formatDuration(durationMs, t),
            exact: formatExactDuration(durationMs, t),
          }
        /** 中文说明：组件局部值 metrics，由紧邻初始化决定。 */
        const metrics = [tokenMetric, durationMetric?.exact]
          .filter(value => value !== undefined)
          .join(' · ')

        /** 中文说明：组件局部值 open，由紧邻初始化决定。 */
        const open = (): void => {
          openChild({ parentSessionId, childSessionId: entry.id, mode: entry.mode })
          closeCatalog()
        }
        /** 中文说明：组件局部值 handleKey，由紧邻初始化决定。 */
        const handleKey = (event: KeyboardEvent<HTMLDivElement>): void => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            event.stopPropagation()
            open()
          } else if (
            (event.key === 'ArrowRight' && !knownLeaf && !isExpanded)
            || (event.key === 'ArrowLeft' && isExpanded)
          ) {
            event.preventDefault()
            event.stopPropagation()
            toggleBranch(entry.id)
          }
        }
        /** 中文说明：组件局部值 toggle，由紧邻初始化决定。 */
        const toggle = (event: MouseEvent<HTMLButtonElement>): void => {
          event.preventDefault()
          event.stopPropagation()
          toggleBranch(entry.id)
        }

        return (
          <div key={entry.id} className={css.node}>
            <div
              role="treeitem"
              tabIndex={0}
              aria-level={level}
              aria-current={isCurrent || undefined}
              aria-label={[label, secondary, metrics].filter(value => value !== '').join(' ')}
              {...knownLeaf ? {} : { 'aria-expanded': isExpanded }}
              className={css.row}
              onClick={open}
              onKeyDown={handleKey}
            >
              {knownLeaf
                ? reserveDisclosure && <span className={css.disclosureSpace} />
                : (
                  <button
                    type="button"
                    tabIndex={-1}
                    className={`${css.disclosure} ${isExpanded ? css.disclosureOpen : ''}`}
                    aria-label={t(isExpanded ? 'branch.collapse' : 'branch.expand', { label })}
                    onClick={toggle}
                  >
                    <IconChevronRightOutline14 />
                  </button>
                )}
              <div className={css.clickarea}>
                <StateDot state={entry.activity === 'running' ? 'ongoing' : 'done'} />
                <span className={css.content}>
                  <span className={`${css.label} ${isCurrent ? css.currentLabel : ''}`}>{label}</span>
                  <span className={css.summary}>{secondary}</span>
                </span>
                {metrics !== '' && (
                  <span className={css.metrics}>
                    {tokenMetric !== undefined && <span className={css.metricToken}>{tokenMetric}</span>}
                    {durationMetric !== undefined && (
                      <span
                        className={css.metricDuration}
                        title={t('duration.exactTitle', { duration: durationMetric.exact })}
                      >
                        {durationMetric.compact}
                      </span>
                    )}
                  </span>
                )}
              </div>
            </div>
            {isExpanded && !knownLeaf && (
              <div
                role="group"
                className={css.children}
                aria-busy={childLoading || undefined}
              >
                {childCatalog === undefined
                  ? (
                    <CatalogLoadingRows
                      parentSessionId={entry.id}
                      summaries={summaries}
                      level={level + 1}
                      t={t}
                    />
                  )
                  : (
                    <CatalogRows
                      parentSessionId={entry.id}
                      currentSessionId={currentSessionId}
                      catalog={childCatalog}
                      catalogs={catalogs}
                      summaries={summaries}
                      expanded={expanded}
                      level={level + 1}
                      now={now}
                      openChild={openChild}
                      refresh={refresh}
                      toggleBranch={toggleBranch}
                      closeCatalog={closeCatalog}
                      t={t}
                    />
                  )}
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}

/** 中文说明：类型或类 CatalogDropdownSharedProps 约束模块数据或组件职责。 */
interface CatalogDropdownSharedProps extends SubagentCatalogInjected {
  /** Session whose direct catalog roots the tree. */
  rootSessionId: SessionId
  /** Whether an ordinary title needs a breadcrumb separator before its count. */
  separator?: boolean
  useSessions: SubagentHeaderLineageProps['useSessions']
  t: TranslateNS<typeof NS>
}

/** 中文说明：类型或类 CatalogDropdownProps 约束模块数据或组件职责。 */
type CatalogDropdownProps = CatalogDropdownSharedProps & (
  | {
    /** Descendant-count control. */
    variant: 'count'
    currentSessionId?: never
    displayTitle?: never
    openTitle?: never
  }
  | {
    /** Current-title sibling switcher. */
    variant: 'switcher'
    /** Selected descendant highlighted in the catalog. */
    currentSessionId: SessionId
    /** Visible title included in the switcher's hover target. */
    displayTitle: string
    /** Optional ancestor navigation when the combined title is clicked. */
    openTitle?: () => void
  }
)

/** 中文说明：组件局部值 MENU_VIEWPORT_MARGIN，由紧邻初始化决定。 */
const MENU_VIEWPORT_MARGIN = 16

/** Place a portaled catalog below its trigger without crossing the viewport edge. */
/* 中文说明：函数 catalogMenuPosition 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function catalogMenuPosition(trigger: HTMLButtonElement): CSSProperties {
  /** 中文说明：组件局部值 rect，由紧邻初始化决定。 */
  const rect = trigger.getBoundingClientRect()
  /** 中文说明：组件局部值 width，由紧邻初始化决定。 */
  const width = Math.min(336, window.innerWidth - MENU_VIEWPORT_MARGIN * 2)
  return {
    top: rect.bottom + 5,
    left: Math.min(
      Math.max(MENU_VIEWPORT_MARGIN, rect.left),
      window.innerWidth - width - MENU_VIEWPORT_MARGIN,
    ),
  }
}

/** One trigger-plus-tree dropdown over the catalog rooted at `rootSessionId`. */
/* 中文说明：函数 CatalogDropdown 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function CatalogDropdown({
  rootSessionId, currentSessionId, displayTitle, openTitle, variant, separator = false,
  useSessions, openChild, refresh, setCatalogOpen, t,
}: CatalogDropdownProps) {
  /** 中文说明：组件局部值 ancestorSwitcher，由紧邻初始化决定。 */
  const ancestorSwitcher = variant === 'switcher' && openTitle !== undefined
  /** 中文说明：组件局部值 catalogs，由紧邻初始化决定。 */
  const catalogs = useSessions(state => state.subagentsByParent)
  /** 中文说明：组件局部值 summaries，由紧邻初始化决定。 */
  const summaries = useSessions(state => state.byId)
  /** 中文说明：组件局部值 catalog，由紧邻初始化决定。 */
  const catalog = catalogs[rootSessionId]
  /** 中文说明：组件局部值 [open, setOpen]，由紧邻初始化决定。 */
  const [open, setOpen] = useState(false)
  /** 中文说明：组件局部值 解构结果，由紧邻初始化决定。 */
  const [menuPosition, setMenuPosition] = useState<CSSProperties>()
  /** 中文说明：组件局部值 [now, setNow]，由紧邻初始化决定。 */
  const [now, setNow] = useState(() => Date.now())
  /** 中文说明：组件局部值 [expanded, setExpanded]，由紧邻初始化决定。 */
  const [expanded, setExpanded] = useState<ReadonlySet<SessionId>>(() => new Set())
  /** 中文说明：组件局部值 rootRef，由紧邻初始化决定。 */
  const rootRef = useRef<HTMLDivElement>(null)
  /** 中文说明：组件局部值 triggerRef，由紧邻初始化决定。 */
  const triggerRef = useRef<HTMLButtonElement>(null)
  /** 中文说明：组件局部值 menuRef，由紧邻初始化决定。 */
  const menuRef = useRef<HTMLDivElement>(null)
  /** 中文说明：组件局部值 hoverOpenTimer，由紧邻初始化决定。 */
  const hoverOpenTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  /** 中文说明：组件局部值 hoverCloseTimer，由紧邻初始化决定。 */
  const hoverCloseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  /** 中文说明：组件局部值 observedCatalogs，由紧邻初始化决定。 */
  const observedCatalogs = useRef(new Set<SessionId>())
  /** 中文说明：组件局部值 requestedInitialCatalog，由紧邻初始化决定。 */
  const requestedInitialCatalog = useRef<SessionId>()
  /** 中文说明：组件局部值 setCatalogOpenRef，由紧邻初始化决定。 */
  const setCatalogOpenRef = useRef(setCatalogOpen)
  setCatalogOpenRef.current = setCatalogOpen
  /** 中文说明：组件局部值 currentEntry，由紧邻初始化决定。 */
  const currentEntry = currentSessionId === undefined
    ? undefined
    : catalog?.entries.find(entry => entry.kind === 'child' && entry.id === currentSessionId)
  /** 中文说明：组件局部值 switcherDisplayTitle，由紧邻初始化决定。 */
  const switcherDisplayTitle = currentEntry?.kind === 'child'
    ? currentEntry.label ?? currentEntry.id
    : displayTitle
  /** 中文说明：组件局部值 healthy，由紧邻初始化决定。 */
  const healthy = catalog?.entries.filter(entry => entry.kind === 'child') ?? []
  /** 中文说明：组件局部值 descendants，由紧邻初始化决定。 */
  const descendants = useMemo(
    () => indexSubagentDescendants(summaries).get(rootSessionId) ?? NO_DESCENDANTS,
    [rootSessionId, summaries],
  )
  // The catalog can arrive before the session-list baseline; never undercount
  // the already-visible direct rows during that short bootstrap window.
  /** 中文说明：组件局部值 descendantCount，由紧邻初始化决定。 */
  const descendantCount = Math.max(healthy.length, descendants.count)
  /** 中文说明：组件局部值 totalCountKey，由紧邻初始化决定。 */
  const totalCountKey = descendantCount === 1 ? 'count.total.one' : 'count.total.other'
  /** 中文说明：组件局部值 runningCountKey，由紧邻初始化决定。 */
  const runningCountKey = descendants.runningCount === 1 ? 'count.running.one' : 'count.running.other'
  // Session summaries can announce membership before the descriptor-backed catalog catches up.
  // Keep that entry point visible through disabled loading rows; only catalog rows are navigable.
  /** 中文说明：组件局部值 summaryBackedLoading，由紧邻初始化决定。 */
  const summaryBackedLoading = (descendants.count > 0 || variant === 'switcher')
    && (catalog === undefined || (catalog.state === 'ready' && catalog.entries.length === 0))
  /** 中文说明：组件局部值 presentedCatalog，由紧邻初始化决定。 */
  const presentedCatalog: SubagentCatalogSnapshot | undefined = summaryBackedLoading
    ? {
      entries: [],
      parentAvailable: catalog?.parentAvailable ?? false,
      state: 'loading',
      error: null,
    }
    : catalog

  useEffect(() => {
    if (
      variant !== 'switcher'
      || catalog !== undefined
      || requestedInitialCatalog.current === rootSessionId
    ) return
    requestedInitialCatalog.current = rootSessionId
    refresh(rootSessionId)
  }, [catalog, refresh, rootSessionId, variant])

  /** 中文说明：组件局部值 observeCatalog，由紧邻初始化决定。 */
  const observeCatalog = (parentSessionId: SessionId, next: boolean): void => {
    if (next) observedCatalogs.current.add(parentSessionId)
    else observedCatalogs.current.delete(parentSessionId)
    setCatalogOpen(parentSessionId, next)
  }

  /** 中文说明：组件局部值 closeAllCatalogs，由紧邻初始化决定。 */
  const closeAllCatalogs = (): void => {
    /** 中文说明：组件局部值 parentSessionId，由紧邻初始化决定。 */
    for (const parentSessionId of observedCatalogs.current) {
      setCatalogOpen(parentSessionId, false)
    }
    observedCatalogs.current.clear()
    setExpanded(new Set())
  }

  /** 中文说明：组件局部值 cancelHoverClose，由紧邻初始化决定。 */
  const cancelHoverClose = (): void => {
    if (hoverCloseTimer.current === undefined) return
    clearTimeout(hoverCloseTimer.current)
    hoverCloseTimer.current = undefined
  }

  /** 中文说明：组件局部值 cancelHoverOpen，由紧邻初始化决定。 */
  const cancelHoverOpen = (): void => {
    if (hoverOpenTimer.current === undefined) return
    clearTimeout(hoverOpenTimer.current)
    hoverOpenTimer.current = undefined
  }

  /** 中文说明：组件局部值 changeOpen，由紧邻初始化决定。 */
  const changeOpen = (next: boolean, restoreFocus = false): void => {
    cancelHoverOpen()
    cancelHoverClose()
    if (next) {
      /** 中文说明：组件局部值 trigger，由紧邻初始化决定。 */
      const trigger = triggerRef.current
      /* v8 ignore next -- a queued callback can outlive the trigger */
      if (trigger === null) return
      setOpen(true)
      setMenuPosition(catalogMenuPosition(trigger))
      setNow(Date.now())
      observeCatalog(rootSessionId, true)
    }
    else {
      setOpen(false)
      setMenuPosition(undefined)
      closeAllCatalogs()
    }
    if (restoreFocus) queueMicrotask(() => { triggerRef.current?.focus() })
  }

  /** 中文说明：组件局部值 scheduleHoverOpen，由紧邻初始化决定。 */
  const scheduleHoverOpen = (): void => {
    cancelHoverOpen()
    cancelHoverClose()
    if (open) return
    hoverOpenTimer.current = setTimeout(() => {
      hoverOpenTimer.current = undefined
      changeOpen(true)
    }, 150)
  }

  /** 中文说明：组件局部值 scheduleHoverClose，由紧邻初始化决定。 */
  const scheduleHoverClose = (): void => {
    cancelHoverOpen()
    cancelHoverClose()
    hoverCloseTimer.current = setTimeout(() => {
      hoverCloseTimer.current = undefined
      changeOpen(false)
    }, 120)
  }

  /** 中文说明：组件局部值 closeBranch，由紧邻初始化决定。 */
  const closeBranch = (root: SessionId): void => {
    /** 中文说明：组件局部值 closing，由紧邻初始化决定。 */
    const closing = new Set<SessionId>()
    /** 中文说明：组件局部值 visit，由紧邻初始化决定。 */
    const visit = (parentSessionId: SessionId): void => {
      if (closing.has(parentSessionId) || !expanded.has(parentSessionId)) return
      closing.add(parentSessionId)
      /** 中文说明：组件局部值 branch，由紧邻初始化决定。 */
      const branch = catalogs[parentSessionId]
      /** 中文说明：组件局部值 entry，由紧邻初始化决定。 */
      for (const entry of branch?.entries ?? []) {
        if (entry.kind === 'child') visit(entry.id)
      }
    }
    visit(root)
    /** 中文说明：组件局部值 parentSessionId，由紧邻初始化决定。 */
    for (const parentSessionId of closing) observeCatalog(parentSessionId, false)
    setExpanded(current => new Set([...current].filter(id => !closing.has(id))))
  }

  /** 中文说明：组件局部值 toggleBranch，由紧邻初始化决定。 */
  const toggleBranch = (childSessionId: SessionId): void => {
    if (expanded.has(childSessionId)) {
      closeBranch(childSessionId)
      return
    }
    setExpanded(current => new Set(current).add(childSessionId))
    observeCatalog(childSessionId, true)
  }

  useEffect(() => {
    if (!open) return
    /** 中文说明：组件局部值 closeOutside，由紧邻初始化决定。 */
    const closeOutside = (event: PointerEvent): void => {
      if (
        event.target instanceof Node
        && !rootRef.current?.contains(event.target)
        && !menuRef.current?.contains(event.target)
      ) {
        changeOpen(false)
      }
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => { document.removeEventListener('pointerdown', closeOutside) }
  }, [open])

  useEffect(() => {
    if (!open) return
    /** 中文说明：组件局部值 placeMenu，由紧邻初始化决定。 */
    const placeMenu = (): void => {
      /** 中文说明：组件局部值 trigger，由紧邻初始化决定。 */
      const trigger = triggerRef.current
      /* v8 ignore next -- native resize or scroll can outlive the trigger */
      if (trigger === null) return
      setMenuPosition(catalogMenuPosition(trigger))
    }
    window.addEventListener('resize', placeMenu)
    document.addEventListener('scroll', placeMenu, true)
    return () => {
      window.removeEventListener('resize', placeMenu)
      document.removeEventListener('scroll', placeMenu, true)
    }
  }, [open])

  useEffect(() => {
    if (!open || descendants.runningCount === 0) return
    /** 中文说明：组件局部值 timer，由紧邻初始化决定。 */
    const timer = setInterval(() => { setNow(Date.now()) }, 1_000)
    return () => { clearInterval(timer) }
  }, [open, descendants.runningCount])

  useEffect(() => () => {
    cancelHoverOpen()
    cancelHoverClose()
    /** 中文说明：组件局部值 parentSessionId，由紧邻初始化决定。 */
    for (const parentSessionId of observedCatalogs.current) {
      setCatalogOpenRef.current(parentSessionId, false)
    }
    observedCatalogs.current.clear()
  }, [])

  // Visibility needs evidence of children (entries, summary-known descendants,
  // or a failed load worth retrying). A bare loading catalog is not evidence:
  // selecting any session schedules a refresh whose loading snapshot would
  // otherwise flash the action in and out on childless sessions.
  /** 中文说明：组件局部值 visible，由紧邻初始化决定。 */
  const visible = presentedCatalog !== undefined
    && (variant === 'switcher'
      || presentedCatalog.state === 'error'
      || presentedCatalog.entries.length > 0
      || descendantCount > 0)
  useEffect(() => {
    if (visible) return
    cancelHoverOpen()
    cancelHoverClose()
    if (!open) return
    setOpen(false)
    closeAllCatalogs()
  }, [visible, open])

  if (!visible) return null

  /** 中文说明：组件局部值 focusAt，由紧邻初始化决定。 */
  const focusAt = (index: number): void => {
    /** 中文说明：组件局部值 items，由紧邻初始化决定。 */
    const items = treeItems(menuRef.current)
    if (items.length === 0) return
    items[(index + items.length) % items.length]?.focus()
  }

  /** 中文说明：组件局部值 navigate，由紧邻初始化决定。 */
  const navigate = (event: KeyboardEvent<HTMLDivElement>): void => {
    /** 中文说明：组件局部值 items，由紧邻初始化决定。 */
    const items = treeItems(menuRef.current)
    /** 中文说明：组件局部值 index，由紧邻初始化决定。 */
    const index = items.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'Escape') {
      event.preventDefault()
      changeOpen(false, true)
    } else if (event.key === 'Home') {
      event.preventDefault()
      focusAt(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      focusAt(items.length - 1)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusAt(index + 1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      focusAt(index < 0 ? items.length - 1 : index - 1)
    }
  }

  return (
    <div
      className={`${css.root} ${variant === 'switcher' ? css.switcherRoot : ''}`}
      ref={rootRef}
      onKeyDown={navigate}
      onMouseEnter={scheduleHoverOpen}
      onMouseLeave={scheduleHoverClose}
    >
      {separator && <span className={css.separator}>/</span>}
      <button
        ref={triggerRef}
        type="button"
        className={variant === 'switcher'
          ? `${css.switcherTrigger} ${ancestorSwitcher ? css.ancestorSwitcherTrigger : ''}`
          : css.trigger}
        aria-haspopup="tree"
        aria-expanded={open}
        aria-label={variant === 'switcher'
          ? t('switcher.aria', { title: switcherDisplayTitle })
          : t(
            descendants.runningCount > 0 ? runningCountKey : totalCountKey,
            { count: descendants.runningCount > 0 ? descendants.runningCount : descendantCount },
          )}
        onClick={openTitle === undefined
          ? undefined
          : () => {
            cancelHoverOpen()
            if (open) changeOpen(false)
            openTitle()
          }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown') return
          event.preventDefault()
          if (!open) changeOpen(true)
          queueMicrotask(() => { focusAt(0) })
        }}
      >
        {variant === 'switcher'
          ? <span className={css.switcherTitle}>{switcherDisplayTitle}</span>
          : (
            <>
              {descendants.runningCount > 0 && (
                <span className={css.activitySlot}>
                  <StateDot state="ongoing" />
                </span>
              )}
              <span className={css.count}>{t(totalCountKey, { count: descendantCount })}</span>
            </>
          )}
        {variant === 'switcher'
          ? <SubagentSwitcherIcon />
          : <IconChevronDownOutline14 className={open ? css.triggerOpen : undefined} />}
      </button>
      {open && createPortal((
        <div
          ref={menuRef}
          className={css.menu}
          style={menuPosition}
          role="tree"
          aria-label={t('tree.aria')}
          onMouseEnter={cancelHoverClose}
          onMouseLeave={scheduleHoverClose}
        >
          <CatalogRows
            parentSessionId={rootSessionId}
            currentSessionId={currentSessionId}
            catalog={presentedCatalog}
            catalogs={catalogs}
            summaries={summaries}
            expanded={expanded}
            level={1}
            now={now}
            openChild={openChild}
            refresh={refresh}
            toggleBranch={toggleBranch}
            closeCatalog={() => { changeOpen(false) }}
            t={t}
          />
        </div>
      ), document.body)}
    </div>
  )
}

/**
 * Render one breadcrumb title together with its subagent navigation.
 * @param props - Breadcrumb title, session standard props, and catalog actions.
 * @returns An ordinary-title descendant count, or a title-and-chevron sibling switcher.
 */
/* 中文说明：函数 SubagentHeaderLineage 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function SubagentHeaderLineage({
  lineageSessionId, displayTitle, openTitle,
  useSessions, openChild, refresh, setCatalogOpen, t,
}: SubagentHeaderLineageProps) {
  /** 中文说明：组件局部值 parentId，由紧邻初始化决定。 */
  const parentId = useSessions((state) => {
    /** 中文说明：组件局部值 summary，由紧邻初始化决定。 */
    const summary = state.byId[lineageSessionId]
    return summary?.origin === 'subagent' ? summary.parentId : undefined
  })
  /** 中文说明：组件局部值 shared，由紧邻初始化决定。 */
  const shared = { useSessions, openChild, refresh, setCatalogOpen, t }
  if (parentId === undefined) {
    return (
      <CatalogDropdown
        key={lineageSessionId}
        rootSessionId={lineageSessionId}
        variant="count"
        separator
        {...shared}
      />
    )
  }
  return (
    <>
      <CatalogDropdown
        key={lineageSessionId}
        rootSessionId={parentId}
        currentSessionId={lineageSessionId}
        variant="switcher"
        displayTitle={displayTitle}
        {...openTitle === undefined ? {} : { openTitle }}
        {...shared}
      />
      {openTitle === undefined && (
        <CatalogDropdown
          key={lineageSessionId}
          rootSessionId={lineageSessionId}
          variant="count"
          {...shared}
        />
      )}
    </>
  )
}
