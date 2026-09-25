/** 首次凭据配置仅写密钥；是否可用由共享目录重载后的快照决定。 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CredentialOnboardingProps } from './contract.ts'
import { credentialStep } from './onboarding-state.ts'
import { invalidCredentialInput } from './provider-fields.ts'
import css from './onboarding.module.css'
/**
 * 为尚无可用供应商的首次使用者提供 DeepSeek 凭据入口。
 * @param props - 官方模型目录、凭据写入、重载及设置壳完成动作。
 * @returns 原型风格凭据对话框，或无需配置时的空呈现。
 */
export function CredentialOnboarding({ useSnapshot, operations, reload, complete, t }: CredentialOnboardingProps) {
  const state = useSnapshot(value => value), step = credentialStep(state)
  const dialog = useRef<HTMLDialogElement>(null)
  const [key, setKey] = useState(''), [busy, setBusy] = useState(false), [failed, setFailed] = useState<'load' | 'credential'>()
  const scope = useRef({ active: true, pending: false, finished: false })
  useEffect(() => {
    const lifetime = { active: true, pending: false, finished: false }; scope.current = lifetime
    return () => { lifetime.active = false }
  }, [])
  const finish = (): void => {
    if (!scope.current.active || scope.current.finished) return
    scope.current.finished = true; complete()
  }
  useEffect(() => {
    if (step === 'skip') finish()
  })
  useLayoutEffect(() => {
    if (dialog.current !== null && !dialog.current.open) dialog.current.showModal()
  })
  const load = async (): Promise<void> => {
    const lifetime = scope.current
    if (lifetime.pending) return
    lifetime.pending = true; setBusy(true); setFailed(undefined)
    // 目录加载拒绝只呈现通用重试提示，不显示可能包含配置的远端错误。
    try { await reload() }
    catch { if (lifetime.active) setFailed('load') }
    if (lifetime.active) { lifetime.pending = false; setBusy(false) }
  }
  useEffect(() => { if (state.status === 'idle') void load() }, [state.status, reload])
  const save = async (): Promise<void> => {
    const lifetime = scope.current, value = key.trim()
    if (lifetime.pending || typeof step === 'string' || step.apiKeyEnv === undefined
      || value === '' || invalidCredentialInput(key)) return
    lifetime.pending = true; setBusy(true); setFailed(undefined)
    let failure: string | undefined
    // 凭据写入失败不能完成引导；密钥保留在当前表单以便重试。
    try { failure = await operations.storeCredential(step.apiKeyEnv, value) }
    catch { failure = 'transport' }
    if (!lifetime.active) return
    lifetime.pending = false; setBusy(false)
    if (failure !== undefined) { setFailed('credential'); return }
    setKey('')
    await load()
  }
  // 状态未查明时不弹窗；加载明确失败后仍提供可见重试入口。
  if (step === 'skip' || (step === 'loading' && failed === undefined)) return null
  return <dialog ref={dialog} className={css.dialog} aria-label={t('onboardingTitle')}
    onCancel={(event) => { event.preventDefault(); if (!busy) finish() }}>
    <h2>{t('onboardingTitle')}</h2><p>{t('onboardingDescription')}</p>
    {step === 'loading' ? <p role="status">{t('loading')}</p> : <form onSubmit={(event) => { event.preventDefault(); void save() }}>
      <label>{t('apiKey')}<input type="password" autoComplete="new-password" spellCheck={false} autoFocus
        value={key} disabled={busy} onChange={(event) => { setKey(event.target.value) }} /></label>
      {invalidCredentialInput(key) && <p role="alert">{t('invalidKey')}</p>}
      <button className="qs-btn" type="submit" disabled={busy || key.trim() === '' || invalidCredentialInput(key)}>
        {t(busy ? 'saving' : 'onboardingSave')}</button>
    </form>}
    {failed && <p role="alert">{t(failed === 'load' ? 'onboardingReloadFailed' : 'credentialFailed')}</p>}
    <div className={css.actions}>
      <button className="qs-btn" type="button" disabled={busy} onClick={finish}>{t('onboardingLater')}</button>
      <button className="qs-btn" type="button" disabled={busy} onClick={() => { void load() }}>{t('retry')}</button>
    </div>
  </dialog>
}
