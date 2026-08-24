/**
 * GoalBar: the goal indicator docked above the message composer (input dock
 * strip). A present goal shows a goal glyph, a phase label, the truncated
 * objective, and icon actions — resume when paused, edit (inline form in the
 * same strip), and clear. Goal creation lives on the `/goal` command, not
 * here: loading (undefined), no goal (null), and complete goals render
 * nothing. Live state arrives as the projected whole snapshot; the verbs are
 * the injected face.
 */
/**
 * 文件职责：实现目标进度的 GoalBar 组件。
 * 技术维度：React、TypeScript、Cordis 插槽和 CSS Modules。
 * 产品维度：支持用户查看或操作目标进度。
 * 逻辑维度：读取状态，派生显示数据并响应交互。
 * 关键边界：空状态、错误状态和可访问性属性必须一致。
 * 新手阅读建议：先读 Props，再看局部状态和 JSX。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { GoalSnapshot } from '@deepseek-ai/dsh-goal/client'
import {
  IconCheckOutline16, IconCloseOutline16, IconEditOutline16, IconGoalOutline16,
  IconPauseOutline16, IconPlayOutline16, IconTrashOutline16, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { GoalActionResult, GoalBarActions } from './slots.ts'
import type { GoalKey } from './locales.ts'
import css from './GoalBar.module.css'

/** 中文说明：类型或类 GoalBarProps 约束本文件数据或组件职责。 */
export interface GoalBarProps extends GoalBarActions {
  /** Current goal snapshot; undefined = capability absent or loading, null = no goal set. */
  goal: GoalSnapshot | null | undefined
}

/** Strip label keys per visible phase; complete goals render nothing. */
/** 中文说明：组件局部值 PHASE_LABELS，由紧邻初始化决定。 */
const PHASE_LABELS = {
  active: 'phase.active',
  paused: 'phase.paused',
  blocked: 'phase.blocked',
} as const satisfies Record<string, GoalKey>

/** 中文说明：函数 GoalBar 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function GoalBar({ goal, onEdit, onPause, onResume, onClear, t }: GoalBarProps & PropsLocale<'goal'>) {
  /** 中文说明：组件局部值 [editing, setEditing]，由紧邻初始化决定。 */
  const [editing, setEditing] = useState(false)
  /** 中文说明：组件局部值 [draft, setDraft]，由紧邻初始化决定。 */
  const [draft, setDraft] = useState('')
  /** 中文说明：组件局部值 [pending, setPending]，由紧邻初始化决定。 */
  const [pending, setPending] = useState(false)
  /** 中文说明：组件局部值 解构结果，由紧邻初始化决定。 */
  const [actionError, setActionError] = useState<string | null>(null)
  /** 中文说明：组件局部值 解构结果，由紧邻初始化决定。 */
  const [clearedGoalId, setClearedGoalId] = useState<GoalSnapshot['id'] | null>(null)
  /** 中文说明：组件局部值 pendingRef，由紧邻初始化决定。 */
  const pendingRef = useRef(false)

  // A new goal identity (cleared/completed/replaced externally) invalidates the local edit
  // state: without the reset a surviving draft's Enter would write over the NEW goal.
  /** 中文说明：组件局部值 goalId，由紧邻初始化决定。 */
  const goalId = goal?.id
  useEffect(() => {
    setEditing(false)
    setActionError(null)
    setClearedGoalId(null)
  }, [goalId])

  // React state disables the controls on the next render; the ref closes the
  // same-render window so rapid clicks cannot submit the same CAS twice.
  /** 中文说明：组件局部值 runAction，由紧邻初始化决定。 */
  const runAction = useCallback(async (action: () => Promise<GoalActionResult>): Promise<GoalActionResult | undefined> => {
    if (pendingRef.current) return undefined
    pendingRef.current = true
    setPending(true)
    setActionError(null)
    /** 中文说明：组件局部值 result，由紧邻初始化决定。 */
    const result = await action()
    pendingRef.current = false
    setPending(false)
    if (!result.ok) setActionError(`${result.error.message} (${result.error.code})`)
    return result
  }, [])

  /** 中文说明：组件局部值 handleEdit，由紧邻初始化决定。 */
  const handleEdit = useCallback(async () => {
    /** 中文说明：组件局部值 trimmed，由紧邻初始化决定。 */
    const trimmed = draft.trim()
    if (trimmed === '') return
    /** 中文说明：组件局部值 result，由紧邻初始化决定。 */
    const result = await runAction(() => onEdit(trimmed))
    if (result?.ok) setEditing(false)
  }, [draft, onEdit, runAction])

  /** 中文说明：组件局部值 handleClear，由紧邻初始化决定。 */
  const handleClear = useCallback(async (clearedId: GoalSnapshot['id']) => {
    /** 中文说明：组件局部值 result，由紧邻初始化决定。 */
    const result = await runAction(onClear)
    if (result?.ok) setClearedGoalId(clearedId)
  }, [onClear, runAction])

  // Loading, absent, and complete goals have no strip at all.
  if (goal === undefined || goal === null || goal.phase === 'complete' || goal.id === clearedGoalId) return null

  if (editing) {
    return (
      <div className={css.dock} data-goal-bar>
        <div className={css.bar}>
          <input
            className={css.objectiveInput}
            type="text"
            aria-label={t('objective.aria')}
            value={draft}
            onChange={(e) => { setDraft(e.target.value) }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleEdit()
              if (e.key === 'Escape') setEditing(false)
            }}
            autoFocus
          />
          {actionError !== null && <span className={css.error} role="alert">{actionError}</span>}
          <div className={css.actions}>
            <Tooltip label={t('action.save')} side="bottom" delayMs={500}>
              <button
                type="button"
                className={css.iconBtn}
                onClick={() => { void handleEdit() }}
                disabled={pending || draft.trim() === ''}
                aria-label={t('action.save')}
              >
                <IconCheckOutline16 size={14} />
              </button>
            </Tooltip>
            <Tooltip label={t('action.cancel')} side="bottom" delayMs={500}>
              <button
                type="button"
                className={css.iconBtn}
                onClick={() => { setEditing(false) }}
                disabled={pending}
                aria-label={t('action.cancel')}
              >
                <IconCloseOutline16 size={14} />
              </button>
            </Tooltip>
          </div>
        </div>
      </div>
    )
  }

  /** 中文说明：组件局部值 title，由紧邻初始化决定。 */
  const title = goal.phase === 'blocked' ? goal.blockedReason?.message : undefined
  return (
    <div className={css.dock} data-goal-bar>
      <div className={css.bar} title={title}>
        <span className={css.goalGlyph}><IconGoalOutline16 size={14} /></span>
        <span className={css.label}>{t(PHASE_LABELS[goal.phase])}</span>
        <span className={css.objective}>{goal.objective}</span>
        {actionError !== null && <span className={css.error} role="alert">{actionError}</span>}
        <div className={css.actions}>
          {goal.phase === 'active' && (
            <Tooltip label={t('action.pause')} side="bottom" delayMs={500}>
              <button type="button" className={css.iconBtn} disabled={pending} onClick={() => { void runAction(onPause) }} aria-label={t('action.pause')}>
                <IconPauseOutline16 size={14} />
              </button>
            </Tooltip>
          )}
          {goal.phase === 'paused' && (
            <Tooltip label={t('action.resume')} side="bottom" delayMs={500}>
              <button type="button" className={css.iconBtn} disabled={pending} onClick={() => { void runAction(onResume) }} aria-label={t('action.resume')}>
                <IconPlayOutline16 size={14} />
              </button>
            </Tooltip>
          )}
          <Tooltip label={t('action.edit')} side="bottom" delayMs={500}>
            <button
              type="button"
              className={css.iconBtn}
              disabled={pending}
              onClick={() => { setDraft(goal.objective); setEditing(true) }}
              aria-label={t('action.edit')}
            >
              <IconEditOutline16 size={14} />
            </button>
          </Tooltip>
          <Tooltip label={t('action.clear')} side="bottom" delayMs={500}>
            <button type="button" className={css.iconBtn} disabled={pending} onClick={() => { void handleClear(goal.id) }} aria-label={t('action.clear')}>
              <IconTrashOutline16 size={14} />
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}

/** Full props of the dock entry: InputZone owner share + session standard kit + injected verbs + the locale seat. */
/** 中文说明：类型或类 GoalDockProps 约束本文件数据或组件职责。 */
export type GoalDockProps = import('@deepseek-ai/dsh-client-ui-slots').PropsRuntime<'conversation.input.dock'> & GoalBarActions & PropsLocale<'goal'>

/** Dock adapter: reads the host-computed 'goal' projection (whole value; absent or null renders nothing). */
/** 中文说明：函数 GoalDock 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function GoalDock({ useProjection, onEdit, onPause, onResume, onClear, t }: GoalDockProps) {
  /** 中文说明：组件局部值 projection，由紧邻初始化决定。 */
  const projection = useProjection('goal')
  return (
    <GoalBar
      goal={projection === undefined ? undefined : projection === null ? null : projection.goal}
      onEdit={onEdit}
      onPause={onPause}
      onResume={onResume}
      onClear={onClear}
      t={t}
    />
  )
}
