/** 原型通用设置中的默认权限行；完全访问保留明确勾选确认。 */
import { useEffect, useId, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DefaultController, DefaultState } from './defaults.ts'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import { en } from './locales.ts'
import css from './defaults.module.css'
/** 每次挂载从官方设置镜像读取默认值，不保存独立权限状态。 */
export interface DefaultInjected {
  readonly hooks: { readonly defaults: HostObservable<DefaultState> }
  readonly actions: Pick<DefaultController, 'load' | 'select'>
}
/** 权限行的槽注入及本地化参数。 */
export type DefaultProps = PropsRuntime<'qs.settings.general.item'> & InjectFace<DefaultInjected> & PropsLocale<'qs-ui-permission-presets'>
/**
 * 显示动态权限选项及保存结果，风险确认固定用户看到的设置版本。
 * @param props - 官方镜像派生状态、写入口与文案。
 * @returns 原型默认权限设置行。
 */
export function DefaultRow({ useDefaults, actions, t }: DefaultProps) {
  const state = useDefaults(value => value), id = useId()
  const [pending, setPending] = useState<{ value: string; revision: number; epoch: number } | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  useEffect(() => { void actions.load() }, [actions])
  // 只读、重连或版本变化后，旧确认不能继续授权新的设置状态。
  useEffect(() => {
    if (!state.writable || state.status !== 'ready' || (pending !== null && (pending.revision !== state.revision || pending.epoch !== state.epoch))) {
      setPending(null); setAcknowledged(false)
    }
  }, [state.writable, state.status, state.revision, state.epoch, pending])
  return <section className={css.row} aria-label={t('defaults')}>
    <div className={css.heading}><div><label htmlFor={id}>{t('defaults')}</label><p>{t('defaultsHint')}</p></div>
      {state.status === 'ready' && <select id={id} value={state.current} disabled={!state.writable || state.saving}
        onChange={(event) => {
          const value = event.currentTarget.value
          setAcknowledged(false)
          if (value === 'danger-full-access') setPending({ value, revision: state.revision, epoch: state.epoch })
          else { setPending(null); void actions.select(value, state.revision, false, state.epoch) }
        }}>
        {state.options.map((option) => {
          const key = option.value === 'read-only' ? 'readOnly' : option.value === 'workspace-write' ? 'workspaceWrite' : option.value === 'danger-full-access' ? 'fullAccess' : undefined
          const label = key !== undefined && (option.name === option.value || option.name === en[key]) ? t(key) : option.name
          return <option key={option.value} value={option.value}>{label}</option>
        })}
      </select>}
    </div>
    {state.status !== 'ready' && <p role="status">{t(state.status === 'loading' ? 'loading' : state.status === 'error' ? 'readError' : 'defaultsUnavailable')}</p>}
    {state.status === 'error' && <button type="button" onClick={() => { void actions.load() }}>{t('retry')}</button>}
    {state.status === 'ready' && !state.writable && <p>{t('readOnlyHint')}</p>}
    {state.saving && <p role="status">{t('saving')}</p>}
    {state.outcome !== 'none' && <p role="status">{t(state.outcome === 'written' ? 'saved' : state.outcome === 'conflict' ? 'conflict' : 'saveFailed')}</p>}
    {pending !== null && <div className={css.confirm} role="group" aria-label={t('riskTitle')}>
      <strong>{t('riskTitle')}</strong><p>{t('defaultsRisk')}</p>
      <label><input type="checkbox" checked={acknowledged} disabled={state.saving} onChange={(event) => { setAcknowledged(event.currentTarget.checked) }} />{t('acknowledge')}</label>
      <div><button type="button" disabled={state.saving} onClick={() => { setPending(null); setAcknowledged(false) }}>{t('cancel')}</button>
        <button type="button" disabled={!acknowledged || state.saving || !state.writable} onClick={() => {
          void actions.select(pending.value, pending.revision, true, pending.epoch)
          setPending(null); setAcknowledged(false)
        }}>{t('confirm')}</button></div>
    </div>}
  </section>
}
