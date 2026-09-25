/** 自定义路线通过一次带版本创建写入，凭据部分失败后只重试凭据。 */
import { useEffect, useRef, useState } from 'react'
import type { ProviderEditorProps } from './ProviderEditor.tsx'
import { createProviderWriter, type ProviderWriter } from './provider-save.ts'
import { invalidCredentialInput, providerProtocols } from './provider-fields.ts'
import { ModelCatalog } from './ModelCatalog.tsx'
import { ModelDiscovery } from './ModelDiscovery.tsx'
import { modelDrafts, modelFailure, modelValues, type ModelDraft } from './model-draft.ts'
import css from './models.module.css'
/** 新路线使用独立创建卡，避免先构造不存在的编辑地址。 */
export interface CustomProviderProps extends Omit<ProviderEditorProps, 'row'> {
  readonly taken: readonly string[]
}
/**
 * 创建一条官方目录尚不存在的 pi-ai 路线。
 * @param props - 命名空间、已用标识与共享官方操作。
 * @returns 原型设置区域内的自定义供应商表单。
 */
export function CustomProvider({ namespace, schema, operations, taken, readOnly, t, onClose }: CustomProviderProps) {
  const protocols = providerProtocols(namespace, schema)
  const [revision] = useState(namespace.revision)
  const [route, setRoute] = useState(''), [name, setName] = useState(''), [endpoint, setEndpoint] = useState('')
  const [protocol, setProtocol] = useState(protocols[0] ?? ''), [key, setKey] = useState('')
  const [models, setModels] = useState<ModelDraft[]>([]), [committed, setCommitted] = useState(false)
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState<Parameters<typeof t>[0]>()
  const [writer, setWriter] = useState<ProviderWriter>()
  const owner = useRef({ readOnly, route, namespace, committed: false })
  owner.current.readOnly = readOnly; owner.current.route = route
  if (namespace.revision > owner.current.namespace.revision) owner.current.namespace = namespace
  useEffect(() => {
    const next = createProviderWriter(namespace.ns, operations, {
      writable: () => !owner.current.readOnly,
      accept: (view) => {
        // 创建回执可能晚于更高版本的配置推送，不能把有效凭据引用退回旧版本。
        if (view.revision >= owner.current.namespace.revision) owner.current.namespace = view
        owner.current.committed = true; setCommitted(true)
      },
      credentialRef: () => {
        const value = schema.getPath(owner.current.namespace.value, ['providers', owner.current.route, 'apiKeyEnv'])
        return typeof value === 'string' ? value : undefined
      },
    })
    setWriter(next); return () => { next.dispose() }
  }, [namespace.ns, operations, schema])
  const invalidRoute = !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(route)
  const duplicate = !committed && taken.includes(route)
  const invalidKey = invalidCredentialInput(key), catalogFailure = modelFailure(models)
  let validEndpoint = false
  try { const url = new URL(endpoint.trim()); validEndpoint = url.protocol === 'http:' || url.protocol === 'https:' }
  catch { /* 用户尚未填入合法地址时保持不可提交，不传播 URL 解析异常。 */ }
  const profileReady = !invalidRoute && !duplicate && validEndpoint && protocols.includes(protocol)
    && models.length > 0 && catalogFailure === undefined
  const disabled = readOnly || busy, profileDisabled = disabled || committed
  const create = async (): Promise<void> => {
    if (writer === undefined || disabled || invalidKey || (!committed && !profileReady)) return
    const value = key.trim(), ref = `${route.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
    const profile = { ...(name.trim() === '' ? {} : { displayName: name.trim() }),
      api: protocol, baseURL: endpoint.trim(), models: modelValues(models), ...(value === '' ? {} : { apiKeyEnv: ref }) }
    setBusy(true); setNotice(undefined)
    const result = await writer.save({ revision,
      ops: committed ? [] : [{ op: 'set', path: ['providers', route], value: profile }],
      ...(value === '' ? {} : { credential: { ref, value } }) })
    if (result.configuration === 'inactive' || result.credential === 'inactive') return
    setBusy(false)
    if (result.configuration === 'conflict') { setNotice('conflict'); return }
    if (result.configuration === 'refused' || result.configuration === 'busy') { setNotice('saveFailed'); return }
    if (result.credential === 'refused' || result.credential === 'reference-changed') { setNotice('partialSave'); return }
    setKey(''); onClose(true)
  }
  return <form className={css.editor} onSubmit={(event) => { event.preventDefault(); void create() }}>
    <h4>{t('createProvider')}</h4>
    <label>{t('providerRoute')}<input value={route} disabled={profileDisabled} onChange={(event) => { setRoute(event.target.value) }} /></label>
    <p>{t('routeHint')}</p>
    {route !== '' && invalidRoute && <p role="alert">{t('routeInvalid')}</p>}
    {duplicate && <p role="alert">{t('routeTaken')}</p>}
    <label>{t('providerName')}<input value={name} disabled={profileDisabled} onChange={(event) => { setName(event.target.value) }} /></label>
    <label>{t('endpoint')}<input value={endpoint} disabled={profileDisabled} onChange={(event) => { setEndpoint(event.target.value) }} /></label>
    {endpoint !== '' && !validEndpoint && <p role="alert">{t('invalidEndpoint')}</p>}
    <label>{t('providerProtocol')}<select value={protocol} disabled={profileDisabled} onChange={(event) => { setProtocol(event.target.value) }}>
      {protocols.map(value => <option key={value} value={value}>{value}</option>)}
    </select></label>
    {protocols.length === 0 && <p role="alert">{t('protocolUnavailable')}</p>}
    <label>{t('apiKey')}<input type="password" autoComplete="new-password" value={key} disabled={disabled} onChange={(event) => { setKey(event.target.value) }} /></label>
    <p>{t('keyHint')}</p>
    {invalidKey && <p role="alert">{t('invalidKey')}</p>}
    <ModelCatalog rows={models} disabled={profileDisabled} t={t} onChange={setModels} />
    {models.length === 0 && <p>{t('modelsRequired')}</p>}
    {catalogFailure !== undefined && <p role="alert">{t(catalogFailure)}</p>}
    <ModelDiscovery namespace={namespace.ns} operations={operations} known={new Set(models.map(model => model.id.trim()))}
      disabled={profileDisabled || invalidKey || !validEndpoint || !protocols.includes(protocol)} t={t}
      request={{ baseURL: endpoint.trim(), api: protocol, ...(key.trim() === '' ? {} : { apiKey: key.trim() }) }}
      onAdopt={(candidates) => { setModels(previous => [...previous, ...modelDrafts(candidates)]) }} />
    {notice !== undefined && <p role="alert">{t(notice)}</p>}
    <div className={css.actions}>
      <button type="button" className="qs-btn" onClick={() => { onClose(owner.current.committed) }}>{t('cancel')}</button>
      <button type="submit" className="qs-btn" disabled={writer === undefined || disabled || invalidKey || (!committed && !profileReady)}>{t(busy ? 'saving' : 'save')}</button>
    </div>
  </form>
}
