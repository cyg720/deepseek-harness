/** 奇术子代理模型配置卡，编辑与请求生命周期由注入控制器持有。 */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SubagentEditor } from './subagent-editor.ts'
import type {} from './contract.ts'
import css from './numeric.module.css'

/** 子代理配置卡消费独立编辑器，不复制设置镜像。 */
export interface SubagentInjected {
  readonly hooks: { readonly editor: SubagentEditor }
  /** 编辑动作由注册生命周期注入。 */
  readonly actions: Pick<SubagentEditor, 'toggleEnabled' | 'toggleModel' | 'save' | 'discard' | 'refresh'>
}
/** 子代理配置卡完整槽座位。 */
export type SubagentProps = PropsRuntime<'qs.settings.plugin.item'> & PropsLocale<'qs-ui-settings-plugins'> & InjectFace<SubagentInjected>
/**
 * 显示精确模型路由、失效授权与明确保存结果。
 * @param props - 编辑快照、动作和词典。
 * @returns 当前部署提供的子代理授权卡。
 */
export function SubagentCard({ useEditor, actions, t }: SubagentProps) {
  const state = useEditor(value => value)
  if (!state.available) return null
  const disabled = !state.writable || state.saving
  return <section className={css.card} aria-label={t('subagentTitle')}>
    <h4>{t('subagentTitle')}</h4>
    <p>{t('subagentScope')}</p>
    <label className={css.choice}>
      <input type="checkbox" checked={state.enabled} disabled={disabled} onChange={actions.toggleEnabled} />
      {t('subagentEnabled')}
    </label>
    {state.enabled ? <>
      {state.catalog.status === 'loading' ? <p role="status">{t('catalogLoading')}</p> : null}
      {state.catalog.status === 'error' ? <p role="alert">{t('catalogFailed')}</p> : null}
      {state.catalog.partial ? <p role="status">{t('catalogPartial')}</p> : null}
      <button type="button" disabled={state.saving || state.catalog.status === 'loading'} onClick={actions.refresh}>{t('retry')}</button>
      <fieldset disabled={disabled} className={css.routes}>
        <legend>{t('allowedModels')}</legend>
        {state.candidates.map(candidate => <label key={candidate.key} className={css.choice}>
          <input type="checkbox" checked={state.selected.has(candidate.key)} onChange={() => { actions.toggleModel(candidate.key) }} />
          <span>{candidate.providerName} · {candidate.modelName}<small>{candidate.provider}/{candidate.model}</small>
            {!candidate.available ? <small>{t('unavailableRoute')}</small> : null}</span>
        </label>)}
      </fieldset>
      {state.invalid ? <p role="alert">{t('selectModel')}</p> : null}
    </> : <p>{t('subagentOff')}</p>}
    {state.conflicted || state.outcome === 'conflict' ? <p role="alert">{t('subagentConflict')}</p> : null}
    {state.outcome === 'refused' ? <p role="alert">{t('saveFailed')}</p> : null}
    {state.outcome === 'written' ? <p role="status">{t('saved')}</p> : null}
    <div className={css.actions}>
      <button type="button" disabled={disabled || !state.dirty || state.invalid || state.conflicted} onClick={() => { void actions.save() }}>{t(state.saving ? 'saving' : 'save')}</button>
      <button type="button" disabled={state.saving || !state.dirty} onClick={actions.discard}>{t('discard')}</button>
    </div>
  </section>
}
