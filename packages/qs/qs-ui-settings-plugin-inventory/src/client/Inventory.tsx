/** 奇术原型只读卡片清单；预设条件和错误说明只作为文本呈现。 */
import { useEffect, useId, useState } from 'react'
import type { PluginInventorySnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-qs-ui-settings-plugins/client'
import type { PluginInventoryLocaleKey } from './locales.ts'
import css from './inventory.module.css'
type Preset = NonNullable<PluginInventorySnapshot['agentPresets']>[number]
type Entry = PluginInventorySnapshot['entries'][number]
/** 只读 Host 目录及官方预设名称解析。 */
export interface InventoryInjected {
  /** @returns 当前 Host 清单；读取失败时拒绝。 */
  readonly list: () => Promise<PluginInventorySnapshot>
  /**
   * @param preset - 官方预设元数据。
   * @returns 当前语言的预设名称。
   */
  readonly presetName: (preset: Preset) => string
}
/** 清单页完整槽座位。 */
export type InventoryProps = PropsRuntime<'qs.settings.plugins.tab'> & PropsLocale<'qs-ui-settings-plugin-inventory'> & InjectFace<InventoryInjected>
type State = { status: 'loading' } | { status: 'error' } | { status: 'ready'; snapshot: PluginInventorySnapshot }
const PHASE = { pending: 'pending', loading: 'loadingPhase', active: 'active', failed: 'failed', unloading: 'unloading' } as const
/**
 * 加载并搜索全局和预设目录，卸载后忽略迟到读取。
 * @param props - 只读操作与本地化文案。
 * @returns 原型清单卡片。
 */
export function Inventory({ list, presetName, t }: InventoryProps) {
  const id = useId(), [query, setQuery] = useState(''), [chosen, setChosen] = useState<string>()
  const [request, setRequest] = useState(0), [state, setState] = useState<State>({ status: 'loading' })
  useEffect(() => {
    let current = true
    void Promise.resolve().then(list).then(
      (snapshot) => { if (current) setState({ status: 'ready', snapshot }) },
      () => { if (current) setState({ status: 'error' }) },
    )
    return () => { current = false }
  }, [list, request])
  if (state.status === 'loading') return <p role="status">{t('loading')}</p>
  if (state.status === 'error') return <div role="alert"><p>{t('error')}</p><button type="button" onClick={() => { setState({ status: 'loading' }); setRequest(value => value + 1) }}>{t('retry')}</button></div>
  const presets = state.snapshot.agentPresets ?? []
  const selected = presets.find(preset => preset.id === chosen) ?? presets.find(preset => preset.isDefault) ?? presets[0]
  const normalized = query.trim().toLocaleLowerCase()
  const matches = (row: { moduleName: string; entryId: string | null }): boolean => row.moduleName.toLocaleLowerCase().includes(normalized) || (row.entryId ?? '').toLocaleLowerCase().includes(normalized)
  const entries = [...state.snapshot.entries].sort((a, b) => Number(b.fiberPhase === 'failed') - Number(a.fiberPhase === 'failed')).filter(matches)
  const selectedRows = selected?.rows.filter(matches) ?? []
  const others = normalized.length === 0 ? [] : presets.filter(preset => preset !== selected && preset.rows.some(matches))
  const phase = (value: Entry['fiberPhase']): string => t(value === null ? 'unobserved' : PHASE[value])
  const status = (enabled: boolean | 'conditional', failed: boolean): string => t(failed ? 'failedTag' : enabled === 'conditional' ? 'conditionalTag' : enabled ? 'enabledTag' : 'disabledTag')
  const none = entries.length === 0 && selectedRows.length === 0 && others.length === 0
  const facts = (moduleName: string, entryId: string | null, stateText: string, runtime: Entry['fiberPhase'], condition?: string) => <>
    <dt>{t('moduleLabel')}</dt><dd>{moduleName}</dd>
    {entryId === null ? null : <><dt>{t('entryId')}</dt><dd><code>{entryId}</code></dd></>}
    <dt>{t('configuration')}</dt><dd>{stateText}</dd><dt>{t('runtime')}</dt><dd>{phase(runtime)}</dd>
    {condition === undefined ? null : <><dt>{t('condition')}</dt><dd><code>{condition}</code></dd></>}
  </>
  const brokenLabel = (preset: Preset): string => {
    const key: PluginInventoryLocaleKey | undefined = preset.broken !== undefined ? 'presetOptionBroken' : preset.isDefault ? 'presetOptionDefault' : undefined
    return key === undefined ? presetName(preset) : t(key, { name: presetName(preset) })
  }
  return <section className={css.section}>
    <label htmlFor={`${id}-search`}>{t('search')}</label>
    <input id={`${id}-search`} type="search" value={query} onChange={(event) => { setQuery(event.currentTarget.value) }} />
    {presets.length === 0 ? null : <>
      <label htmlFor={`${id}-preset`}>{t('switcherLabel')}</label>
      <select id={`${id}-preset`} value={selected?.id} onChange={(event) => { setChosen(event.currentTarget.value) }}>{presets.map(preset => <option key={preset.id} value={preset.id}>{brokenLabel(preset)}</option>)}</select>
    </>}
    {selected === undefined ? null : <details open className={css.group} key={selected.id}><summary>{t('presetTitle')} · {presetName(selected)} · {selectedRows.length}</summary>
      {selected.broken === undefined ? null : <p role="alert">{selected.broken}</p>}
      <div className={css.cards}>{selectedRows.map((row, index) => <details key={`${selected.id}:${index}`} className={css.card}>
        <summary>{row.moduleName}<span>{status(row.enabled, row.fiberPhase === 'failed')}</span></summary>
        <dl>{facts(row.moduleName, row.entryId, status(row.enabled, row.fiberPhase === 'failed'), row.fiberPhase, row.condition)}</dl>
      </details>)}</div>
    </details>}
    {others.map(preset => <button type="button" key={preset.id} onClick={() => { setChosen(preset.id) }}>{t('viewInPreset')} · {presetName(preset)} · {preset.rows.filter(matches).length}</button>)}
    <details open className={css.group}><summary>{t('globalTitle')} · {entries.length}</summary><div className={css.cards}>
      {entries.map((entry) => {
        const providers = presets.filter(preset => preset.rows.some(row => row.moduleName === entry.moduleName && row.enabled === true))
        return <details key={entry.entryId} className={css.card} data-plugin-entry={entry.entryId}>
          <summary>{entry.moduleName}<span>{entry.fiberPhase === 'failed' ? t('failedTag') : providers.length > 0 ? t('presetEnabledTag') : status(entry.enabled, false)}</span></summary>
          <dl>{facts(entry.moduleName, entry.entryId, status(entry.enabled, entry.fiberPhase === 'failed'), entry.fiberPhase)}</dl>
          {providers.map(preset => <button type="button" key={preset.id} onClick={() => { setChosen(preset.id) }}>{t('viewInPreset')} · {presetName(preset)}</button>)}
        </details>
      })}
    </div></details>
    {none ? <p role="status">{t(normalized.length === 0 ? 'empty' : 'emptySearch')}</p> : null}
  </section>
}
