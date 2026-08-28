/**
 * 文件职责：实现工作流运行的 WorkflowRunPanel 组件。
 * 技术维度：React、TypeScript、Cordis 插槽、外部 Store 和 CSS Modules。
 * 产品维度：支持用户查看或操作工作流运行。
 * 逻辑维度：读取状态，派生展示数据，处理操作并渲染界面。
 * 关键边界：异步状态、空状态、虚拟滚动和可访问性必须一致。
 * 新手阅读建议：先读 Props，再看状态选择、事件和 JSX。
 */
import {
  useLayoutEffect, useMemo, useRef, useState,
  /** 中文说明：类型或类 FocusEvent 约束模块数据或组件职责。 */
  type FocusEvent, type MouseEvent, type ReactNode,
} from 'react'
import {
  DisclosureRow, IconChevronRightOutline14, StateDot,
  /** 中文说明：类型或类 DisclosureRowProps 约束模块数据或组件职责。 */
  type DisclosureRowProps, type StateDotState,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import { shallowEqual } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkflowRunKey } from './locales.ts'
import type {
  WorkflowRunMemberData, WorkflowRunPhaseData, WorkflowRunStatus,
} from './workflow-definition.ts'
import css from './WorkflowRunPanel.module.css'

/** Navigation action injected from the plugin's own Session Controller access. */
export interface WorkflowRunInjected {
  readonly openSession: (id: SessionId) => void
}

/** Complete keyed Chat renderer props. */
/* 中文说明：类型或类 WorkflowRunPanelProps 约束模块数据或组件职责。 */
export type WorkflowRunPanelProps =
  PropsRuntime<'conversation.chat.node', 'workflow-run'>
  & PropsLocale<'workflowRun'>
  & WorkflowRunInjected

/** 中文说明：组件局部值 STATUS_KEYS，由紧邻初始化决定。 */
const STATUS_KEYS = {
  running: 'status.running',
  completed: 'status.completed',
  failed: 'status.failed',
  cancelled: 'status.cancelled',
  interrupted: 'status.interrupted',
} as const satisfies Record<WorkflowRunStatus, WorkflowRunKey>

/** 中文说明：函数 dotState 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function dotState(status: WorkflowRunStatus): StateDotState {
  switch (status) {
    case 'running': return 'ongoing'
    case 'completed': return 'done'
    case 'failed': return 'error'
    case 'cancelled':
    case 'interrupted': return 'warning'
    /* v8 ignore next -- WorkflowRunStatus is closed and every variant is handled above. */
    default: return status satisfies never
  }
}

/** 中文说明：函数 readablePhase 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function readablePhase(phase: string | null, t: WorkflowRunPanelProps['t']): string {
  if (phase === null) return t('phase.unassigned')
  return phase === '' ? t('phase.empty') : phase
}

/** 中文说明：函数 readableMember 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function readableMember(label: string, t: WorkflowRunPanelProps['t']): string {
  return label === '' ? t('member.empty') : label
}

/** 中文说明：函数 statusCount 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function statusCount(
  status: WorkflowRunStatus,
  count: number,
  t: WorkflowRunPanelProps['t'],
): string {
  return t(`statusCount.${status}`, { count })
}

/** 中文说明：函数 memberCount 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function memberCount(count: number, t: WorkflowRunPanelProps['t']): string {
  return t(count === 1 ? 'run.members.one' : 'run.members.other', { count })
}

/** 中文说明：类型或类 DisclosureMode 约束模块数据或组件职责。 */
type DisclosureMode = 'clean' | 'running' | 'abnormal'

/** 中文说明：类型或类 DisclosureFacts 约束模块数据或组件职责。 */
interface DisclosureFacts {
  readonly mode: DisclosureMode
  readonly activityCount: number
}

/** 中文说明：类型或类 DisclosureState 约束模块数据或组件职责。 */
interface DisclosureState extends DisclosureFacts {
  readonly open: boolean
  readonly pendingCleanCollapse: boolean
}

/** 中文说明：类型或类 WorkflowDisclosureState 约束模块数据或组件职责。 */
interface WorkflowDisclosureState {
  readonly run: DisclosureState
  readonly phases: ReadonlyMap<string, DisclosureState>
}

/** 中文说明：类型或类 StatusDisclosureProps 约束模块数据或组件职责。 */
type StatusDisclosureProps = Omit<DisclosureRowProps, 'expandable'>

/** 中文说明：函数 StatusDisclosure 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function StatusDisclosure(props: StatusDisclosureProps) {
  return <DisclosureRow {...props} expandable />
}

/** 中文说明：函数 abnormal 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function abnormal(status: WorkflowRunStatus): boolean {
  return status === 'failed' || status === 'cancelled' || status === 'interrupted'
}

/** 中文说明：函数 phaseDisclosureFacts 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function phaseDisclosureFacts(phase: WorkflowRunPhaseData): DisclosureFacts {
  /** 中文说明：组件局部值 mode，由紧邻初始化决定。 */
  const mode = phase.members.some(member => abnormal(member.status))
    ? 'abnormal'
    : phase.members.some(member => member.status === 'running') ? 'running' : 'clean'
  return { mode, activityCount: phase.members.length }
}

/** 中文说明：函数 runDisclosureFacts 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function runDisclosureFacts(
  status: WorkflowRunStatus,
  phases: readonly (readonly [string, DisclosureFacts])[],
): DisclosureFacts {
  /** 中文说明：组件局部值 mode，由紧邻初始化决定。 */
  const mode = abnormal(status) || phases.some(([, facts]) => facts.mode === 'abnormal')
    ? 'abnormal'
    : status === 'running' || phases.some(([, facts]) => facts.mode === 'running')
      ? 'running'
      : 'clean'
  /** 中文说明：组件局部值 activityCount，由紧邻初始化决定。 */
  const activityCount = phases.reduce((count, [, facts]) => count + facts.activityCount, 0)
  return { mode, activityCount }
}

/** 中文说明：函数 initialDisclosureState 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function initialDisclosureState(facts: DisclosureFacts): DisclosureState {
  return { ...facts, open: facts.mode !== 'clean', pendingCleanCollapse: false }
}

/** 中文说明：函数 advanceDisclosureState 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function advanceDisclosureState(
  current: DisclosureState,
  facts: DisclosureFacts,
  focusWithin: boolean,
): DisclosureState {
  /** 中文说明：组件局部值 sameFacts，由紧邻初始化决定。 */
  const sameFacts = current.mode === facts.mode && current.activityCount === facts.activityCount
  if (sameFacts) {
    if (!current.pendingCleanCollapse || focusWithin) return current
    return { ...current, open: false, pendingCleanCollapse: false }
  }
  if (facts.mode === 'clean') {
    /** 中文说明：组件局部值 deferCollapse，由紧邻初始化决定。 */
    const deferCollapse = current.open && focusWithin
    return { ...facts, open: deferCollapse, pendingCleanCollapse: deferCollapse }
  }
  if (current.mode === 'clean' || (facts.mode === 'abnormal' && current.mode !== 'abnormal')) {
    return { ...facts, open: true, pendingCleanCollapse: false }
  }
  return { ...facts, open: current.open, pendingCleanCollapse: false }
}

/** 中文说明：函数 focusIsWithin 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function focusIsWithin(element: HTMLElement | null | undefined): boolean {
  if (element === null || element === undefined) return false
  return element.contains(element.ownerDocument.activeElement)
}

/** 中文说明：函数 collapsePending 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function collapsePending(state: DisclosureState): DisclosureState {
  if (!state.pendingCleanCollapse) return state
  return { ...state, open: false, pendingCleanCollapse: false }
}

/** 中文说明：函数 existingPhaseState 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function existingPhaseState(
  phases: ReadonlyMap<string, DisclosureState>,
  key: string,
): DisclosureState {
  /** 中文说明：组件局部值 phase，由紧邻初始化决定。 */
  const phase = phases.get(key)
  /* v8 ignore next -- mounted phase callbacks are created from this owner map. */
  if (phase === undefined) throw new Error(`Missing disclosure state for phase ${key}`)
  return phase
}

/** 中文说明：函数 preventPendingHeaderFocus 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function preventPendingHeaderFocus(event: MouseEvent<HTMLElement>): void {
  /** 中文说明：组件局部值 header，由紧邻初始化决定。 */
  const header = event.currentTarget.querySelector('[data-disclosure-row]')
  /* v8 ignore next -- DisclosureRow always renders its header before the content. */
  if (header === null) throw new Error('Missing disclosure header')
  if (header.contains(event.target as Node)) event.preventDefault()
}

/** 中文说明：函数 phaseStatusSummary 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function phaseStatusSummary(members: readonly WorkflowRunMemberData[], t: WorkflowRunPanelProps['t']): string {
  /** 中文说明：组件局部值 counts，由紧邻初始化决定。 */
  const counts = new Map<WorkflowRunStatus, number>()
  /** 中文说明：组件局部值 member，由紧邻初始化决定。 */
  for (const member of members) counts.set(member.status, (counts.get(member.status) ?? 0) + 1)
  /** 中文说明：组件局部值 count，由紧邻初始化决定。 */
  const count = (status: WorkflowRunStatus): number => counts.get(status) ?? 0
  /** 中文说明：组件局部值 active，由紧邻初始化决定。 */
  const active = (['running', 'failed', 'cancelled', 'interrupted'] as const)
    .filter(status => count(status) > 0)
  if (active.length === 0) return statusCount('completed', count('completed'), t)
  /** 中文说明：组件局部值 visible，由紧邻初始化决定。 */
  const visible = active.includes('interrupted') && count('completed') > 0
    ? ['completed' as const, ...active]
    : active
  return visible.map(status => statusCount(status, count(status), t)).join(' · ')
}

/** 中文说明：函数 navigableMembers 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function navigableMembers(
  sessions: SessionListState,
  phases: readonly WorkflowRunPhaseData[],
  parentId: SessionId,
): readonly SessionId[] {
  /** 中文说明：组件局部值 ordinary，由紧邻初始化决定。 */
  const ordinary = new Set(sessions.ids)
  /** 中文说明：组件局部值 result，由紧邻初始化决定。 */
  const result: SessionId[] = []
  /** 中文说明：组件局部值 phase，由紧邻初始化决定。 */
  for (const phase of phases) {
    /** 中文说明：组件局部值 member，由紧邻初始化决定。 */
    for (const member of phase.members) {
      /** 中文说明：组件局部值 summary，由紧邻初始化决定。 */
      const summary = sessions.byId[member.childId]
      if (member.status === 'running'
        && ordinary.has(member.childId)
        && summary?.origin === 'subagent'
        && summary.parentId === parentId
        && summary.running) {
        result.push(member.childId)
      }
    }
  }
  return result
}

/** 中文说明：函数 RunHeader 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function RunHeader({ children, count, name, onToggle, open, status, t }: {
  readonly children: ReactNode
  readonly count: number
  readonly name: string
  readonly onToggle: () => void
  readonly open: boolean
  readonly status: WorkflowRunStatus
  readonly t: WorkflowRunPanelProps['t']
}) {
  return (
    <StatusDisclosure
      icon={<IconChevronRightOutline14 />}
      title={t('run.title', { name })}
      open={open}
      onToggle={onToggle}
      expandOnRowClick
      previewChevron={false}
      keepContentWhenOpen
      rowClassName={css.runHeader}
      leadingClassName={css.runLeading}
      titleClassName={css.runTitle}
      collapsedContent={(
        <>
          <span className={css.separator} aria-hidden />
          <span className={css.runSummary}>{memberCount(count, t)}</span>
          <span className={css.statusTail} data-status={status}>
            <StateDot state={dotState(status)} />
            <span>{t(STATUS_KEYS[status])}</span>
          </span>
        </>
      )}
    >
      {children}
    </StatusDisclosure>
  )
}

/** 中文说明：函数 MemberRow 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function MemberRow({ member, navigable, openSession, t }: {
  readonly member: WorkflowRunMemberData
  readonly navigable: boolean
  readonly openSession: WorkflowRunInjected['openSession']
  readonly t: WorkflowRunPanelProps['t']
}) {
  /** 中文说明：组件局部值 name，由紧邻初始化决定。 */
  const name = readableMember(member.label, t)
  /** 中文说明：组件局部值 [focused, setFocused]，由紧邻初始化决定。 */
  const [focused, setFocused] = useState(false)
  /** 中文说明：组件局部值 renderButton，由紧邻初始化决定。 */
  const renderButton = navigable || focused

  /** 中文说明：组件局部值 content，由紧邻初始化决定。 */
  const content = (
    <>
      <span className={css.dotSlot}><StateDot state={dotState(member.status)} /></span>
      <span className={css.memberLabelWrap} data-member-label-wrap><span className={css.memberLabel} data-member-label>{name}</span></span>
      <span className={css.memberStatus} data-member-status-text>{t(STATUS_KEYS[member.status])}</span>
    </>
  )
  if (!renderButton) {
    return <div className={css.memberRow} data-member-status={member.status}>{content}</div>
  }
  return (
    <button
      type="button"
      className={navigable ? css.memberButton : css.memberRow}
      data-member-status={member.status}
      aria-disabled={navigable ? undefined : true}
      aria-label={navigable ? t('member.open', { name }) : name}
      tabIndex={navigable ? undefined : -1}
      onFocus={() => { setFocused(true) }}
      onBlur={() => { setFocused(false) }}
      onClick={navigable ? () => { openSession(member.childId) } : undefined}
    >
      {content}
    </button>
  )
}

/** 中文说明：函数 PhaseSection 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function PhaseSection({
  contentRef, onContentBlur, onToggle, open, pendingCleanCollapse,
  phase, navigable, openSession, t,
}: {
  readonly contentRef: (element: HTMLDivElement | null) => void
  readonly onContentBlur: (event: FocusEvent<HTMLDivElement>) => void
  readonly onToggle: () => void
  readonly open: boolean
  readonly pendingCleanCollapse: boolean
  readonly phase: WorkflowRunPhaseData
  readonly navigable: readonly SessionId[]
  readonly openSession: WorkflowRunInjected['openSession']
  readonly t: WorkflowRunPanelProps['t']
}) {
  return (
    <div
      className={css.phase}
      onMouseDownCapture={pendingCleanCollapse ? preventPendingHeaderFocus : undefined}
    >
      <StatusDisclosure
        icon={<IconChevronRightOutline14 />}
        title={readablePhase(phase.phase, t)}
        open={open}
        onToggle={onToggle}
        expandOnRowClick
        previewChevron={false}
        keepContentWhenOpen
        rowClassName={css.phaseHeader}
        leadingClassName={css.phaseLeading}
        titleClassName={css.phaseTitle}
        collapsedContent={(
          <>
            <span className={css.separator} aria-hidden />
            <span className={css.phaseCount} data-phase-count>{memberCount(phase.members.length, t)}</span>
            <span className={css.phaseStatus} data-phase-status-text>{phaseStatusSummary(phase.members, t)}</span>
          </>
        )}
      >
        <div ref={contentRef} className={css.members} onBlur={onContentBlur}>
          {phase.members.map(member => (
            <MemberRow
              key={member.seq}
              member={member}
              navigable={navigable.includes(member.childId)}
              openSession={openSession}
              t={t}
            />
          ))}
        </div>
      </StatusDisclosure>
    </div>
  )
}

/** Render one durable workflow run with status-driven run and phase disclosure. */
/* 中文说明：函数 WorkflowRunPanel 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function WorkflowRunPanel({ node, sessionId, useSessions, openSession, t }: WorkflowRunPanelProps) {
  /** 中文说明：组件局部值 phaseFacts，由紧邻初始化决定。 */
  const phaseFacts = useMemo(() => node.data.phases.map(phase => (
    [phase.key, phaseDisclosureFacts(phase)] as const
  )), [node.data.phases])
  /** 中文说明：组件局部值 runFacts，由紧邻初始化决定。 */
  const runFacts = useMemo(
    () => runDisclosureFacts(node.data.status, phaseFacts),
    [node.data.status, phaseFacts],
  )
  /** 中文说明：组件局部值 totalMembers，由紧邻初始化决定。 */
  const totalMembers = runFacts.activityCount
  /** 中文说明：组件局部值 解构结果，由紧邻初始化决定。 */
  const [disclosures, setDisclosures] = useState<WorkflowDisclosureState>(() => ({
    run: initialDisclosureState(runFacts),
    phases: new Map(phaseFacts.map(([key, facts]) => [key, initialDisclosureState(facts)])),
  }))
  /** 中文说明：组件局部值 runContentRef，由紧邻初始化决定。 */
  const runContentRef = useRef<HTMLDivElement>(null)
  /** 中文说明：组件局部值 phaseContentRefs，由紧邻初始化决定。 */
  const phaseContentRefs = useRef(new Map<string, HTMLDivElement>())
  /** 中文说明：组件局部值 navigable，由紧邻初始化决定。 */
  const navigable = useSessions(
    sessions => navigableMembers(sessions, node.data.phases, sessionId),
    shallowEqual,
  )

  // Outer hiding unmounts Phase content without a dependable blur event, so this edge settles deferred closes.
  useLayoutEffect(() => {
    setDisclosures((current) => {
      /** 中文说明：组件局部值 phases，由紧邻初始化决定。 */
      const phases = new Map<string, DisclosureState>()
      /** 中文说明：组件局部值 phasesChanged，由紧邻初始化决定。 */
      let phasesChanged = current.phases.size !== phaseFacts.length
      /** 中文说明：组件局部值 phaseStartedCycle，由紧邻初始化决定。 */
      let phaseStartedCycle = false
      /** 中文说明：组件局部值 [key，由紧邻初始化决定。 */
      for (const [key, facts] of phaseFacts) {
        /** 中文说明：组件局部值 previous，由紧邻初始化决定。 */
        const previous = current.phases.get(key)
        /** 中文说明：组件局部值 next，由紧邻初始化决定。 */
        const next = previous === undefined
          ? initialDisclosureState(facts)
          : advanceDisclosureState(previous, facts, focusIsWithin(phaseContentRefs.current.get(key)))
        phases.set(key, next)
        if (next !== previous) phasesChanged = true
        if (previous?.mode === 'clean'
          && (facts.mode !== 'clean' || facts.activityCount !== previous.activityCount)) {
          phaseStartedCycle = true
        }
      }
      /** 中文说明：组件局部值 advancedRun，由紧邻初始化决定。 */
      const advancedRun = advanceDisclosureState(
        current.run,
        runFacts,
        focusIsWithin(runContentRef.current),
      )
      /** 中文说明：组件局部值 run，由紧邻初始化决定。 */
      const run = phaseStartedCycle && runFacts.mode !== 'clean' && !advancedRun.open
        ? { ...advancedRun, open: true, pendingCleanCollapse: false }
        : advancedRun
      return run !== current.run || phasesChanged ? { run, phases } : current
    })
  }, [disclosures.run.open, phaseFacts, runFacts])

  /** 中文说明：组件局部值 toggleRun，由紧邻初始化决定。 */
  const toggleRun = (): void => {
    setDisclosures(current => ({
      ...current,
      run: {
        ...current.run,
        open: !current.run.open,
        pendingCleanCollapse: false,
      },
    }))
  }
  /** 中文说明：组件局部值 togglePhase，由紧邻初始化决定。 */
  const togglePhase = (key: string): void => {
    setDisclosures((current) => {
      /** 中文说明：组件局部值 phases，由紧邻初始化决定。 */
      const phases = new Map(current.phases)
      /** 中文说明：组件局部值 phase，由紧邻初始化决定。 */
      const phase = existingPhaseState(phases, key)
      phases.set(key, {
        ...phase,
        open: !phase.open,
        pendingCleanCollapse: false,
      })
      return { ...current, phases }
    })
  }
  /** 中文说明：组件局部值 settleRunBlur，由紧邻初始化决定。 */
  const settleRunBlur = (event: FocusEvent<HTMLDivElement>): void => {
    if (event.currentTarget.contains(event.relatedTarget)) return
    setDisclosures((current) => {
      /** 中文说明：组件局部值 run，由紧邻初始化决定。 */
      const run = collapsePending(current.run)
      return run === current.run ? current : { ...current, run }
    })
  }
  /** 中文说明：组件局部值 settlePhaseBlur，由紧邻初始化决定。 */
  const settlePhaseBlur = (key: string, event: FocusEvent<HTMLDivElement>): void => {
    if (event.currentTarget.contains(event.relatedTarget)) return
    setDisclosures((current) => {
      /** 中文说明：组件局部值 phase，由紧邻初始化决定。 */
      const phase = existingPhaseState(current.phases, key)
      /** 中文说明：组件局部值 next，由紧邻初始化决定。 */
      const next = collapsePending(phase)
      if (next === phase) return current
      /** 中文说明：组件局部值 phases，由紧邻初始化决定。 */
      const phases = new Map(current.phases)
      phases.set(key, next)
      return { ...current, phases }
    })
  }

  return (
    <section
      className={css.root}
      data-workflow-run
      data-run-status={node.data.status}
      onMouseDownCapture={disclosures.run.pendingCleanCollapse
        ? preventPendingHeaderFocus
        : undefined}
    >
      <RunHeader
        count={totalMembers}
        name={node.data.name}
        open={disclosures.run.open}
        onToggle={toggleRun}
        status={node.data.status}
        t={t}
      >
        <div ref={runContentRef} className={css.phaseList} onBlur={settleRunBlur}>
          {node.data.phases.length === 0
            ? <span className={css.empty}>{t('run.empty')}</span>
            : node.data.phases.map((phase) => {
              /** 中文说明：组件局部值 facts，由紧邻初始化决定。 */
              const facts = phaseDisclosureFacts(phase)
              /** 中文说明：组件局部值 disclosure，由紧邻初始化决定。 */
              const disclosure = disclosures.phases.get(phase.key) ?? initialDisclosureState(facts)
              return (
                <PhaseSection
                  key={phase.key}
                  contentRef={(element) => {
                    if (element === null) phaseContentRefs.current.delete(phase.key)
                    else phaseContentRefs.current.set(phase.key, element)
                  }}
                  onContentBlur={(event) => { settlePhaseBlur(phase.key, event) }}
                  onToggle={() => { togglePhase(phase.key) }}
                  open={disclosure.open}
                  pendingCleanCollapse={disclosure.pendingCleanCollapse}
                  phase={phase}
                  navigable={navigable}
                  openSession={openSession}
                  t={t}
                />
              )
            })}
        </div>
      </RunHeader>
    </section>
  )
}
