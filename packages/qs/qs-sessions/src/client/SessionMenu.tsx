/**
 * 会话管理菜单。
 *
 * 用原生 `<dialog>`：键盘与焦点行为由浏览器提供，关闭后焦点自动回到触发元素；
 * 归档前二次确认，并在确认时使用**调用方重新计算过的**可归档性（远端变化仍以
 * 真实快照为准，客户端检查不是原子锁）。
 * 关闭和卸载会失效本实例的异步 UI 回调，已提交的服务动作仍可完成。
 *
 * 动作经 props 从列表的 inject face 传入，不在模块级保存可变单例。
 */
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { QsSessionsLocaleKey } from './contract.ts'
import styles from './sessions.module.css'

/** 菜单可执行的动作（来自列表的 inject face）。 */
export interface SessionMenuActions {
  readonly togglePin: (id: SessionId) => void
  readonly renameSession: (id: SessionId, title: string) => Promise<boolean>
  readonly archiveSession: (id: SessionId) => Promise<boolean>
}

/** 菜单输入。 */
export interface SessionMenuProps {
  readonly sessionId: SessionId
  readonly title: string
  readonly pinned: boolean
  readonly archivable: boolean
  readonly actions: SessionMenuActions
  readonly onClose: () => void
  readonly t: (key: QsSessionsLocaleKey) => string
}

type Step = 'menu' | 'rename' | 'archive'

/**
 * 渲染管理菜单。
 * @param props - 目标会话、动作集、可归档性与语言座席。
 * @returns 对话框节点。
 */
export function SessionMenu(props: SessionMenuProps): ReactNode {
  const { sessionId, title, pinned, archivable, actions, onClose, t } = props
  const ref = useRef<HTMLDialogElement | null>(null)
  const lifetime = useRef<AbortController | undefined>(undefined)
  const [step, setStep] = useState<Step>('menu')
  const [draft, setDraft] = useState(title)
  const [error, setError] = useState<'archive' | 'generic' | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    ref.current?.showModal()
    return () => { controller.abort() }
  }, [])

  const close = (): void => {
    if (lifetime.current === undefined || lifetime.current.signal.aborted) return
    lifetime.current.abort()
    ref.current?.close()
    onClose()
  }

  const run = async (work: () => Promise<boolean>, failure: 'archive' | 'generic'): Promise<void> => {
    const controller = lifetime.current
    if (busy || controller === undefined) return
    const closed = (): boolean => controller.signal.aborted
    if (closed()) return
    setBusy(true)
    setError(undefined)
    try {
      const ok = await work()
      if (closed()) return
      if (ok) close()
      else setError(failure)
    } catch {
      // Service rejections leave the dialog and draft available for retry.
      if (!closed()) setError(failure)
    } finally {
      if (!closed()) setBusy(false)
    }
  }

  const heading = step === 'menu' ? t('menu.title') : step === 'rename' ? t('rename.title') : t('archive.title')

  return (
    <dialog ref={ref} className={`qs-dialog ${styles.dialog}`} onClose={close}
      onCancel={(event) => { event.preventDefault(); close() }} aria-label={heading}>
      <div className="qs-modal-head">
        <h2>{heading}</h2>
        <button type="button" className="qs-text-button" onClick={close}>{t('menu.close')}</button>
      </div>
      <div className="qs-modal-body">
        {error === undefined ? null : <p className={styles.menuError} role="alert">{t(error === 'archive' ? 'archive.busy' : 'error.generic')}</p>}
        {step === 'menu' ? (
          <>
            <p className="qs-modal-intro">{title}</p>
            <div className="qs-modal-list">
              <button
                type="button"
                className="qs-choice-row"
                onClick={() => {
                  actions.togglePin(sessionId)
                  close()
                }}
              >
                {pinned ? t('menu.unpin') : t('menu.pin')}
              </button>
              <button type="button" className="qs-choice-row" onClick={() => { setStep('rename') }}>
                {t('menu.rename')}
              </button>
              <button type="button" className="qs-choice-row" onClick={() => { setStep('archive') }}>
                {t('menu.archive')}
              </button>
            </div>
          </>
        ) : null}

        {step === 'rename' ? (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void run(() => actions.renameSession(sessionId, draft.trim()), 'generic')
            }}
          >
            <label className="qs-field">
              <span>{t('rename.label')}</span>
              <input
                value={draft}
                maxLength={80}
                autoFocus
                onChange={(event) => { setDraft(event.target.value) }}
              />
            </label>
            <div className="qs-modal-actions">
              <button type="button" className="qs-btn" onClick={close}>{t('menu.close')}</button>
              <button type="submit" className="qs-btn qs-btn-primary" disabled={busy || draft.trim() === ''}>
                {t('rename.save')}
              </button>
            </div>
          </form>
        ) : null}

        {step === 'archive' ? (
          <>
            <p className="qs-modal-intro">{archivable ? t('archive.confirm') : t('archive.busy')}</p>
            <div className="qs-modal-actions">
              <button type="button" className="qs-btn" onClick={close}>{t('archive.cancel')}</button>
              <button
                type="button"
                className="qs-btn qs-btn-danger"
                disabled={busy || !archivable}
                onClick={() => { void run(() => actions.archiveSession(sessionId), 'archive') }}
              >
                {t('menu.archive')}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </dialog>
  )
}
