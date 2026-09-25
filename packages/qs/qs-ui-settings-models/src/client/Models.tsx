/** 原型设置分区的供应商卡片，凭据仅显示已确认状态。 */
import { useEffect, useState } from 'react'
import type { ModelsProps } from './contract.ts'
import css from './models.module.css'
import { ProviderEditor } from './ProviderEditor.tsx'
import { ProviderRemoval } from './ProviderRemoval.tsx'
import { CustomProvider } from './CustomProvider.tsx'
/**
 * 展示共享目录及状态；读取失败保留上一次可见条目。
 * @param props - 官方快照、重读动作、子槽和本地化。
 * @returns 原型风格模型设置区域。
 */
export function Models({ useSnapshot, reload, renderSlot, operations, schema, t }: ModelsProps) {
  const state = useSnapshot(value => value)
  const [attempt, setAttempt] = useState(0), [failed, setFailed] = useState(false), [pending, setPending] = useState(true)
  const [editing, setEditing] = useState<string>()
  const [removing, setRemoving] = useState<string>()
  const [creating, setCreating] = useState(false)
  const creationNamespace = state.namespaces.get('llm-pi-ai')
  useEffect(() => {
    let active = true
    setFailed(false); setPending(true)
    void reload().then(() => { if (active) setPending(false) }, () => {
      if (active) { setFailed(true); setPending(false) }
    })
    return () => { active = false }
  }, [reload, attempt])
  const error = failed || state.status === 'error'
  return <section className={css.section} data-qs-model-settings>
    <header><div><h3>{t('title')}</h3><p>{t('intro')}</p></div>
      <button type="button" className="qs-btn" disabled={pending} onClick={() => { setAttempt(value => value + 1) }}>{t('retry')}</button></header>
    {pending && <p role="status">{t('loading')}</p>}
    {error && <p role="alert">{t('failed')}</p>}
    {state.status === 'ready' && !state.writable && <p role="status">{t('readonly')}</p>}
    {state.credentialError !== null && <p role="status">{t('credentialsError')}</p>}
    {!pending && !error && state.rows.length === 0 && <p>{t('empty')}</p>}
    {creationNamespace !== undefined && (creating
      ? <CustomProvider namespace={creationNamespace} schema={schema} operations={operations} readOnly={!state.writable}
        taken={state.rows.map(row => row.entry.provider)} t={t} onClose={(changed) => {
          setCreating(false); if (changed) setAttempt(value => value + 1)
        }} />
      : <button className="qs-btn" type="button" disabled={!state.writable} onClick={() => {
        setEditing(undefined); setRemoving(undefined); setCreating(true)
      }}>{t('createProvider')}</button>)}
    <div className={css.providers}>{state.rows.map((row) => {
      const namespace = state.namespaces.get(row.entry.settingsNs)
      const supported = row.entry.settingsNs === 'llm-deepseek' || row.entry.settingsNs === 'llm-pi-ai'
      const credential = row.apiKeyEnv === undefined ? row.derivedCredential : row.credential
      const key = credential?.configured === true ? 'keyReady'
        : row.apiKeyEnv === undefined && row.entry.active ? 'nativeAuth'
          : credential !== undefined ? 'keyMissing' : 'keyUnknown'
      return <article key={row.entry.provider} className={css.provider}>
        <h4>{row.entry.displayName}</h4><code>{row.entry.provider}</code>
        <div className={css.badges}><span>{t(row.entry.active ? 'active' : 'inactive')}</span>
          <span>{t(row.configured ? 'configured' : 'inherited')}</span><span>{t(key)}</span></div>
        {row.entry.error !== undefined && <p role="alert">{t('providerError')}</p>}
        {editing === row.entry.provider && namespace !== undefined && supported
          ? <ProviderEditor key={JSON.stringify([namespace.ns, row.entry.settingsPath])}
            row={row} namespace={namespace} operations={operations} schema={schema}
            readOnly={!state.writable} t={t} onClose={(changed) => {
              setEditing(undefined); if (changed) setAttempt(value => value + 1)
            }} />
          : <button type="button" className="qs-btn" disabled={!state.writable || namespace === undefined || !supported}
            onClick={() => { setCreating(false); setRemoving(undefined); setEditing(row.entry.provider) }}>{t('edit')}</button>}
        {row.removable && namespace !== undefined && (removing === row.entry.provider
          ? <ProviderRemoval key={JSON.stringify([namespace.ns, row.entry.settingsPath])} row={row} rows={state.rows}
            namespace={namespace} operations={operations} readOnly={!state.writable} t={t} onClose={(changed) => {
              setRemoving(undefined); if (changed) setAttempt(value => value + 1)
            }} />
          : <button className="qs-btn" type="button" disabled={!state.writable}
            onClick={() => { setCreating(false); setEditing(undefined); setRemoving(row.entry.provider) }}>{t('remove')}</button>)}
        {!supported && <p>{t('unsupported')}</p>}
        {row.entry.settingsNs !== '' && renderSlot('qs.settings.models.provider-card', {
          provider: row.entry, configured: row.configured, keyConfigured: credential?.configured === true,
        }, { entryKey: row.entry.settingsNs })}
      </article>
    })}</div>
    {renderSlot('qs.settings.models.footer', {})}
  </section>
}
