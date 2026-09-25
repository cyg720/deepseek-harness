/** 同一会话的消息与会话反馈共用官方草稿，取消不撤销已提交操作。 */
import { useEffect, useRef } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { FeedbackDialogInjected } from '@deepseek-ai/dsh-client-ui-message-feedback/client'
import type { FeedbackCategory } from '@deepseek-ai/dsh-command-feedback/types'
import css from './feedback.module.css'

/** 分类由官方类型完整约束，不导入 Host 常量。 */
const categories = { 'task-result': true, 'instruction-following': true, 'product-interaction': true,
  'service-stability': true, 'resource-cost': true, 'security-privacy-permission': true, other: true,
} satisfies Record<FeedbackCategory, true>
const orderedCategories = Object.keys(categories) as FeedbackCategory[]
/** 反馈表单的会话、草稿与冻结租约。 */
export type FeedbackProps = InjectFace<FeedbackDialogInjected> & PropsRuntime<'qs.composer.overlay'> & PropsLocale<'qs-ui-message-feedback'>

/**
 * 显示官方分类、对象和完整草稿；失败保留输入，可重新提交。
 * @param props - 官方反馈动作、会话输入宿主与文案。
 * @returns 对象表单及反馈专属结果提示。
 */
export function Feedback({ sessionId, useDialog, edit, submit, dismiss, dismissFailure, dismissToast, acquireFreeze, t }: FeedbackProps) {
  const state = useDialog(value => value)
  const open = state.target !== null
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (!open) return
    const element = dialog.current
    element?.showModal()
    return () => { element?.close() }
  }, [open])
  useEffect(() => { if (open) return acquireFreeze('confirmation') }, [open, acquireFreeze])
  // 已显示的提示随视图释放；共享草稿保留，切回会话仍可继续编辑。
  useEffect(() => () => { dismissToast(state.toast) }, [dismissToast, state.toast])
  const failureKey = state.failure === 'version-conflict' ? 'error.conflict'
    : state.failure === 'note-too-large' ? 'error.noteTooLarge'
      : state.failure === 'target-not-found' || state.failure === 'session-not-found' ? 'error.target' : 'error.generic'
  return <>
    {state.toast > 0 && state.failure === null && <div role="status" className={css.notice} data-qs-feedback-recorded>
      {t('recorded')}<button type="button" onClick={() => { dismissToast(state.toast) }}>{t('dismissNotice')}</button>
    </div>}
    {/* 原生模态留在 QS 根内，继承主题，浏览器负责焦点约束和恢复。 */}
    <dialog ref={dialog} className={`qs-dialog ${css.dialog}`} aria-label={t('dialog.title')}
      onCancel={(event) => { event.preventDefault(); dismiss() }}>
      <div className="qs-modal-head"><h2>{t('dialog.title')}</h2><button type="button" className="qs-text-button" onClick={dismiss}>{t('cancel')}</button></div>
      <div className="qs-modal-body">
        <p className={css.target}>{t(state.target?.kind === 'message' ? 'target.message' : 'target.session')} · {sessionId}
          {state.target?.kind === 'message' && <code>{state.target.messageId}</code>}</p>
        <p>{t('dialog.hint')}</p>
        <div className={css.categories} role="group" aria-label={t('dialog.categories')}>
          {orderedCategories.map(category => <button key={category} type="button" aria-pressed={state.category === category}
            disabled={state.submitting} onClick={() => { edit({ category: state.category === category ? null : category }) }}>{t(`category.${category}`)}</button>)}
        </div>
        <textarea autoFocus className={css.detail} aria-label={t('dialog.detail')} value={state.text} readOnly={state.submitting}
          onChange={(event) => { edit({ text: event.currentTarget.value }) }} />
        {state.failure !== null && <div role="alert">{t(failureKey)}<button type="button" onClick={dismissFailure}>{t('dismissNotice')}</button></div>}
        {state.submitting && <p role="status">{t('closeInFlight')}</p>}
      </div>
      <div className="qs-modal-actions">
        <button type="button" className="qs-btn" onClick={dismiss}>{t('cancel')}</button>
        <button type="button" className="qs-btn qs-btn-primary" disabled={state.submitting} onClick={() => { void submit() }}>{t(state.submitting ? 'submitting' : 'submit')}</button>
      </div>
    </dialog>
  </>
}
