/** 奇术 WebSearch 配置卡，凭据为只写密码输入，保存结果逐项呈现。 */
import { useEffect, useId } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SearchEditor } from './search-editor.ts'
import type {} from './contract.ts'
import css from './numeric.module.css'
/** 搜索卡消费独立编辑器与动作。 */
export interface SearchInjected {
  readonly hooks: { readonly editor: SearchEditor }
  /** 动作归注册生命周期拥有的控制器。 */
  readonly actions: Pick<SearchEditor, 'edit' | 'resetField' | 'editSecret' | 'clearSecret' | 'discard' | 'save' | 'refreshCredential'>
}
/** 搜索配置卡完整呈现座位。 */
export type SearchProps = PropsRuntime<'qs.settings.plugin.item'> & PropsLocale<'qs-ui-settings-plugins'> & InjectFace<SearchInjected>
/**
 * 独立呈现配置和凭据结果，不把部分成功显示为全部保存。
 * @param props - 编辑快照、命令及词典。
 * @returns Host 提供该命名空间时的配置表单。
 */
export function SearchCard({ useEditor, actions, t }: SearchProps) {
  const id = useId(), state = useEditor(value => value)
  // 弹窗关闭不卸载插件；明文的保留范围必须限于当前卡片挂载。
  useEffect(() => () => { actions.clearSecret() }, [actions])
  if (!state.available) return null
  const disabled = !state.writable || state.saving, credential = state.credential
  const result = state.outcome
  return <section className={css.card} aria-label={t('searchTitle')}>
    <h4>{t('searchTitle')}</h4>
    {(['baseURL', 'maxUses'] as const).map(field => <div className={css.field} key={field}>
      <label htmlFor={`${id}-${field}`}>{t(field === 'baseURL' ? 'searchURL' : 'searchMaxUses')}</label>
      <input id={`${id}-${field}`} disabled={disabled} value={state.fields[field].text}
        inputMode={field === 'maxUses' ? 'numeric' : 'url'} onChange={(event) => { actions.edit(field, event.currentTarget.value) }} />
      <small>{t(state.fields[field].overridden ? 'overridden' : 'inherited')}</small>
      <button type="button" disabled={disabled} onClick={() => { actions.resetField(field) }}>{t('resetField')}</button>
      {state.fields[field].invalid ? <p role="alert">{t('invalidSearchField')}</p> : null}
    </div>)}
    <div className={css.field}>
      <label htmlFor={`${id}-secret`}>{t('searchCredential')}</label>
      <input id={`${id}-secret`} type="password" autoComplete="new-password" value={state.secret}
        disabled={disabled || credential.status !== 'ready' || !credential.writable}
        onChange={(event) => { actions.editSecret(event.currentTarget.value) }} />
      <small>{t('credentialHint')}</small>
      <button type="button" disabled={state.saving || credential.status === 'loading'} onClick={actions.refreshCredential}>{t('retry')}</button>
    </div>
    <p role={credential.status === 'error' ? 'alert' : 'status'}>{t(credential.status === 'error' ? 'credentialReadFailed'
      : credential.status !== 'ready' ? 'credentialLoading' : credential.configured ? 'credentialConfigured' : 'credentialMissing')}</p>
    {credential.status === 'ready' && !credential.writable ? <p>{t('credentialReadonly')}</p> : null}
    {state.referenceChanged ? <p role="alert">{t('credentialReferenceChanged')}</p> : null}
    {state.conflicted ? <p role="alert">{t('searchConflict')}</p> : null}
    {result !== undefined ? <div aria-live="polite">
      {result.configuration === 'written' ? <p>{t('configurationSaved')}</p> : null}
      {result.configuration === 'conflict' ? <p role="alert">{t('searchConflict')}</p> : null}
      {result.configuration === 'refused' || result.configuration === 'busy' || result.configuration === 'inactive'
        ? <p role="alert">{t('configurationFailed')}</p> : null}
      {result.credential === 'written' ? <p>{t('credentialSaved')}</p> : null}
      {result.credential === 'reference-changed' ? <p role="alert">{t('credentialReferenceChanged')}</p> : null}
      {result.credential === 'not-attempted' ? <p role="alert">{t('credentialNotAttempted')}</p> : null}
      {result.credential === 'refused' || result.credential === 'busy' || result.credential === 'inactive'
        ? <p role="alert">{t('credentialWriteFailed')}</p> : null}
    </div> : null}
    <div className={css.actions}>
      <button type="button" disabled={disabled || !state.dirty || state.invalid || state.conflicted || state.referenceChanged}
        onClick={() => { void actions.save() }}>{t(state.saving ? 'saving' : 'save')}</button>
      <button type="button" disabled={state.saving || !state.dirty} onClick={actions.discard}>{t('discard')}</button>
    </div>
  </section>
}
