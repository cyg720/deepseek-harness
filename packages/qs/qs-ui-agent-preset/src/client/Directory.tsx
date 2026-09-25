/** 原型设置页的预设目录：损坏项保留可见，正文均按文本渲染。 */
import { useEffect } from 'react'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { QsPresetRosterState } from './roster.ts'
import type { SettingsMirrorSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { QsPresetPolicy } from './policy.ts'
import { PolicyControls } from './PolicyControls.tsx'
import css from './directory.module.css'
/** 预设设置区域消费同一目录快照。 */
export interface DirectoryInjected {
  readonly hooks: { readonly roster: HostObservable<QsPresetRosterState>; readonly settings: HostObservable<SettingsMirrorSnapshot> }
  readonly policy: QsPresetPolicy
  /** @returns 官方目录读取结束。 */
  readonly refresh: () => Promise<void>
}
/** 设置区域的预设目录参数。 */
export type DirectoryProps = PropsRuntime<'qs.settings.section'> & InjectFace<DirectoryInjected> & PropsLocale<'qs-ui-agent-preset'>
/**
 * 显示 Host 提供的预设条目和真实默认标记。
 * @param props - 目录、刷新动作与文案。
 * @returns 奇术设置目录区域。
 */
export function Directory({ useRoster, useSettings, policy, refresh, t }: DirectoryProps) {
  const state = useRoster(value => value)
  const settings = useSettings(value => value)
  useEffect(() => { void refresh() }, [refresh])
  return <section className={css.directory} aria-label={t('title')}>
    <header><div><h3>{t('title')}</h3><p>{t('hint')}</p></div>
      <button type="button" disabled={state.status === 'loading'} onClick={() => { void refresh() }}>{t('reload')}</button></header>
    {state.status !== 'ready' && <p role="status">{t(state.status === 'error' ? 'failed' : state.status === 'unavailable' ? 'unavailable' : 'loading')}</p>}
    {state.roster !== undefined && <PolicyControls settings={settings} roster={state.roster} policy={policy} refresh={refresh} t={t} />}
    {state.status === 'ready' && <ul>{state.roster?.presets.map(row => <li key={row.id}>
      <strong>{row.name ?? row.id}</strong><code>{row.id}</code>
      <span>{t(row.trust === 'system' ? 'system' : 'user')}</span>
      {row.isDefault && <span>{t('default')}</span>}
      {row.description !== undefined && <p>{row.description}</p>}
      {row.broken !== undefined && <p role="status">{t('broken')}</p>}
    </li>)}</ul>}
  </section>
}
