/** 目标投影与进程激活分开读取；草稿和在途动作只属于当前会话及目标。 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { GoalRef, GoalView } from '@deepseek-ai/dsh-goal/client'
import type { GoalActionResult } from '@deepseek-ai/dsh-client-ui-goal/client'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { GoalProps } from './contract.ts'
import css from './goal.module.css'

type GoalError = { readonly code: string; readonly message: string }

function GoalPanel(props: GoalProps): ReactNode {
  const { t, useProjection, useGoalActivation, useGoalConnected, useSession,
    onCreate, onRefresh, onEdit, onPause, onResume, onClear } = props
  const projection = useProjection('goal')
  const goal = projection?.goal
  const connected = useGoalConnected(value => value)
  const writable = useSession(value => value.openState === 'open' && !value.removed && value.subagent === null) && connected
  const activation = useGoalActivation(value => value.id === goal?.id && value.revision === goal?.revision ? value.activation : undefined)
  const [editing, setEditing] = useState(false)
  const [clearTarget, setClearTarget] = useState<{ ref: GoalRef; objective: string }>()
  const clearDialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (clearTarget === undefined) return
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- 弹窗始终随目标条挂载，effect 在 DOM 提交后执行。
    const element = clearDialog.current!
    element.showModal()
    return () => { element.close() }
  }, [clearTarget])
  const [draft, setDraft] = useState('')
  const [editRef, setEditRef] = useState<GoalRef>()
  const [review, setReview] = useState<GoalView>()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<GoalError>()
  const [notice, setNotice] = useState<'done' | 'refreshed' | 'missing'>()
  const editButton = useRef<HTMLButtonElement>(null)
  const wasEditing = useRef(false)
  // 表单结束后回到原入口，避免键盘焦点落到已卸载节点。
  useEffect(() => {
    if (wasEditing.current && !editing) editButton.current?.focus()
    wasEditing.current = editing
  }, [editing])
  const locked = useRef(false)
  const alive = useRef(false)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  // 冲突锁独立于请求提示，刷新失败不能重新开放旧版本保存。
  const [conflict, setConflict] = useState(false)

  // 同一次点击批次也只能取得一次锁；卸载后的 Promise 无权改变新实例。
  async function run<T>(
    action: () => Promise<RemoteResult<T> | Extract<GoalActionResult, { ok: false }>>,
    accept: (value: T) => void,
  ): Promise<void> {
    if (locked.current || !writable) return
    locked.current = true; setPending(true); setError(undefined); setNotice(undefined)
    try {
      const result = await action()
      if (!alive.current) return
      if (result.ok) accept(result.value)
      else {
        setError({ code: result.error.code, message: result.error.message })
        if (result.error.code === 'GOAL_STALE_REVISION') setConflict(true)
      }
    } catch {
      // 服务卸载及传输异常只影响当前视图，不向事件处理器泄漏拒绝。
      if (alive.current) setError({ code: 'request-failed', message: t('failed') })
    } finally {
      if (alive.current) { locked.current = false; setPending(false) }
    }
  }
  function begin(): void {
    setDraft(goal?.objective ?? ''); setEditRef(goal === undefined ? undefined : { id: goal.id, revision: goal.revision })
    setConflict(false); setReview(undefined); setError(undefined); setNotice(undefined); setEditing(true)
  }
  function save(): void {
    if (projection === undefined || draft.trim() === '' || conflict) return
    const objective = draft.trim()
    void run(() => editRef === undefined ? onCreate(objective) : onEdit(objective, editRef), () => { setReview(undefined); setEditing(false); setNotice('done') })
  }
  function refresh(): void {
    void run(onRefresh, (latest) => {
      if (latest === undefined || latest.id !== goal?.id) { setConflict(true); setNotice('missing'); return }
      setConflict(false); setReview(latest); setEditRef({ id: latest.id, revision: latest.revision }); setNotice('refreshed')
    })
  }
  function mutate(action: (ref?: GoalRef) => Promise<GoalActionResult>, current: GoalRef): void {
    // 显式刷新后用户已看到最新正文；仍由 Host 比较版本，禁止覆盖后续更改。
    const shown = review !== undefined && review.revision > current.revision ? review : current
    const ref = { id: shown.id, revision: shown.revision }
    void run(() => action(ref), () => { setReview(undefined); setNotice('done') })
  }
  const disabled = pending || !writable || projection === undefined
  const canResume = goal !== undefined && projection !== null && projection !== undefined
    && projection.roundsStarted < goal.maxGoalRounds
    && (goal.phase === 'paused' || goal.phase === 'blocked' || goal.phase === 'active' && activation === 'disarmed')
  return <section className={css.dock} aria-label={t('title')} data-qs-goal>
    {projection === undefined ? <p role="status">{t('loading')}</p> : projection === null ? <p>{t('empty')}</p> : <>
      <strong>{t(projection.goal.phase === 'active' ? activation === undefined ? 'reading' : activation === 'armed' ? 'active' : 'disarmed' : projection.goal.phase)}</strong>
      <p className={css.objective}>{projection.goal.objective}</p>
      <p className={css.meta}>{t('rounds', { started: projection.roundsStarted, limit: projection.goal.maxGoalRounds })}</p>
      {projection.goal.phase === 'blocked' && projection.goal.blockedReason !== undefined ? <p className={css.reason}><code>{projection.goal.blockedReason.code}</code> · {projection.goal.blockedReason.message}</p> : null}
      {projection.goal.phase !== 'complete' && projection.roundsStarted >= projection.goal.maxGoalRounds ? <p className={css.meta}>{t('exhausted')}</p> : null}
    </>}
    {!writable && <p className={css.meta}>{t('readonly')}</p>}
    {editing ? <form onSubmit={(event) => { event.preventDefault(); save() }}>
      <label>{t('objective')}<textarea autoFocus value={draft} disabled={disabled} onChange={(event) => { setDraft(event.target.value) }} onKeyDown={(event) => {
        if (event.key === 'Escape' && !pending) { event.preventDefault(); setEditing(false) }
      }} /></label>
      <div className={css.actions}>
        <button type="submit" disabled={disabled || draft.trim() === '' || conflict}>{t('save')}</button>
        <button type="button" disabled={pending} onClick={() => { setEditing(false) }}>{t('cancel')}</button>
      </div>
    </form> : projection !== undefined && <div className={css.actions}>
      <button type="button" ref={editButton} disabled={disabled} onClick={begin}>{t(goal === undefined ? 'create' : 'edit')}</button>
      {goal?.phase === 'active' && activation === 'armed' && <button type="button" disabled={disabled} onClick={() => { mutate(onPause, goal) }}>{t('pause')}</button>}
      {canResume && <button type="button" disabled={disabled} onClick={() => { mutate(onResume, goal) }}>{t('resume')}</button>}
      {goal !== undefined && <button type="button" disabled={disabled} onClick={() => {
        // 确认绑定已展示的正文和版本；后续投影更新不能悄悄改变清除对象。
        const shown = review !== undefined && review.revision > goal.revision ? review : goal
        setClearTarget({ ref: { id: shown.id, revision: shown.revision }, objective: shown.objective })
      }}>{t('clear')}</button>}
    </div>}
    <dialog ref={clearDialog} className="qs-dialog" aria-label={t('clear')}
      onCancel={(event) => { event.preventDefault(); setClearTarget(undefined) }}>
      <div className="qs-modal-head"><h2>{t('clear')}</h2></div>
      <div className="qs-modal-body"><p>{t('clearHint')}</p><p className={css.objective}>{clearTarget?.objective}</p></div>
      <div className="qs-modal-actions">
        <button type="button" className="qs-btn" autoFocus onClick={() => { setClearTarget(undefined) }}>{t('cancel')}</button>
        {clearTarget !== undefined && <button type="button" className="qs-btn qs-btn-primary" disabled={disabled} onClick={() => {
          const { ref } = clearTarget
          setClearTarget(undefined)
          void run(() => onClear(ref), () => { setReview(undefined); setNotice('done') })
        }}>{t('confirmClear')}</button>}
      </div>
    </dialog>
    {review !== undefined && <p className={css.objective}>{t('current')}: {review.objective}</p>}
    {error !== undefined && <p role="alert" className={css.reason}>{conflict ? t('conflict') : `${error.message} (${error.code})`}</p>}
    {conflict && <button type="button" className={css.refresh} disabled={disabled} onClick={refresh}>{t('refresh')}</button>}
    {pending ? <p role="status">{t('pending')}</p> : notice !== undefined && <p role="status">{t(notice)}</p>}
  </section>
}

/**
 * 会话或目标身份变化时重建局部状态；同一目标的 revision 变化保留用户草稿。
 * @param props - 框架提供的严格会话座席与动作。
 * @returns 当前目标条。
 */
export function GoalDock(props: GoalProps): ReactNode {
  const id = props.useProjection('goal')?.goal.id ?? ''
  return <GoalPanel key={`${props.sessionId}:${id}`} {...props} />
}
