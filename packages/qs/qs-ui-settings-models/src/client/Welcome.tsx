/** 欢迎说明使用官方版本化文案和唯一确认状态；只有确认成功才能完成引导。 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { WelcomeProps } from './contract.ts'
import css from './onboarding.module.css'
/**
 * 呈现奇术欢迎说明，保留官方确认内容和持久化语义。
 * @param props - 设置壳完成动作、共享欢迎状态及当前语言文案。
 * @returns 阻止误关闭的原型风格说明对话框。
 */
export function Welcome({ useWelcome, load, acknowledge, complete, copy, t }: WelcomeProps) {
  const state = useWelcome(value => value)
  const [pending, setPending] = useState(false), [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0)
  const dialog = useRef<HTMLDialogElement>(null)
  const lifetime = useRef({ active: true, finished: false })
  useLayoutEffect(() => { if (dialog.current !== null && !dialog.current.open) dialog.current.showModal() })
  useEffect(() => {
    const scope = { active: true, finished: false }; lifetime.current = scope
    setPending(true); setFailed(false)
    void load().then(() => { if (scope.active) setPending(false) }, () => {
      if (scope.active) { setPending(false); setFailed(true) }
    })
    return () => { scope.active = false }
  }, [load, attempt])
  const finish = useCallback(() => {
    const scope = lifetime.current
    if (scope.active && !scope.finished) { scope.finished = true; complete() }
  }, [complete])
  useEffect(() => { if (state.acknowledged) finish() }, [state.acknowledged, finish])
  const confirm = async (): Promise<void> => {
    const scope = lifetime.current
    setPending(true); setFailed(false)
    let confirmed: boolean
    // 仅捕获确认 RPC 的传输拒绝；错误原文不进入说明对话框。
    try { confirmed = await acknowledge() }
    catch { if (scope.active) { setPending(false); setFailed(true) }; return }
    if (!scope.active) return
    setPending(false)
    if (confirmed) finish(); else setFailed(true)
  }
  // 查询确认状态时不打开模态框，避免已确认用户刷新时被短暂抢走焦点。
  if (state.acknowledged || ((state.status === 'idle' || state.status === 'loading') && !failed)) return null
  return <dialog ref={dialog} className={css.dialog} aria-label={copy('welcomeTitle')}
    onCancel={(event) => { event.preventDefault() }}>
    <h2 tabIndex={-1} autoFocus>{copy('welcomeTitle')}</h2>
    {copy('welcomeBody').split('\n\n').map((paragraph, index) => <p key={index}>{paragraph}</p>)}
    {state.status === 'loading' || state.status === 'idle' ? <p role="status">{t('welcomeLoading')}</p> : null}
    {(failed || state.error !== null) && <p role="alert">{copy('welcomeError')}</p>}
    <div className={css.actions}>
      {failed && <button className="qs-btn" type="button" disabled={pending} onClick={() => { setAttempt(value => value + 1) }}>{t('retry')}</button>}
      <button className="qs-btn" type="button" disabled={pending || state.status === 'idle' || state.status === 'loading' || state.status === 'saving'}
        onClick={() => { void confirm() }}>{copy('welcomeContinue')}</button>
    </div>
  </dialog>
}
