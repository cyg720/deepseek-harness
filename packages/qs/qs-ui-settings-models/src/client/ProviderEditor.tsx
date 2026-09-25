/** 供应商连接编辑只提交可见字段，密钥为只写草稿，不从 Host 读取原值。 */
import { useEffect, useRef, useState } from 'react'
import type { SettingsNamespaceView, SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelsSettingsFace, ProviderRow } from '@deepseek-ai/dsh-client-ui-settings-models/client'
import { createProviderWriter, type ProviderWriter } from './provider-save.ts'
import type { zh } from './locales.ts'
import css from './models.module.css'
import { ModelCatalog } from './ModelCatalog.tsx'
import { modelDrafts, modelFailure, modelValues } from './model-draft.ts'
import { ModelDiscovery } from './ModelDiscovery.tsx'
import { invalidCredentialInput, providerProtocols } from './provider-fields.ts'

/** 一个已定位供应商的连接表单。 */
export interface ProviderEditorProps {
  readonly row: ProviderRow
  readonly namespace: SettingsNamespaceView
  readonly schema: ModelsSettingsFace['schema']
  readonly operations: ModelsSettingsFace['operations']
  readonly readOnly: boolean
  readonly t: (key: keyof typeof zh) => string
  /** @param changed - 当前编辑器是否确认过配置或凭据写入。 */
  readonly onClose: (changed: boolean) => void
}

/**
 * 编辑供应商端点与凭据，保存失败保留草稿与已提交版本。
 * @param props - 官方供应商定位、配置快照及写入操作。
 * @returns 奇术设置卡内的连接表单。
 */
export function ProviderEditor({ row, namespace, schema, operations, readOnly, t, onClose }: ProviderEditorProps) {
  const path = row.entry.settingsPath
  const [committed, setCommitted] = useState(namespace)
  const declared = row.entry.settingsNs === 'llm-pi-ai' && row.entry.declared === true
  const protocols = declared ? providerProtocols(namespace, schema) : []
  const [displayName, setDisplayName] = useState(() => {
    const value = schema.getPath(namespace.user, [...path, 'displayName'])
    return typeof value === 'string' ? value : ''
  })
  const [protocol, setProtocol] = useState(() => {
    const value = schema.getPath(namespace.value, [...path, 'api'])
    return typeof value === 'string' ? value : ''
  })
  const [protocolDirty, setProtocolDirty] = useState(false)
  const invalidProtocol = declared && !protocols.includes(protocol)
  const modelsPath = [...path, 'models']
  const [models, setModels] = useState(() => modelDrafts(schema.getPath(namespace.value, modelsPath)))
  const [modelsOverridden, setModelsOverridden] = useState(() => schema.hasPath(namespace.user, modelsPath))
  const [modelsDirty, setModelsDirty] = useState(false)
  const catalogFailure = modelsOverridden ? modelFailure(models) : undefined
  const [endpoint, setEndpoint] = useState(() => {
    const value = schema.getPath(namespace.user, [...path, 'baseURL'])
    return typeof value === 'string' ? value : ''
  })
  const [key, setKey] = useState(''), [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<keyof typeof zh>()
  const [writer, setWriter] = useState<ProviderWriter>()
  const current = useRef({ namespace, committed, readOnly, changed: false })
  current.current.namespace = namespace; current.current.readOnly = readOnly
  const keyRef = (view: SettingsNamespaceView): string => {
    const value = schema.getPath(view.value, [...path, 'apiKeyEnv'])
    return typeof value === 'string' && value.length > 0 ? value : `${row.entry.provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
  }
  const reference = useRef(keyRef); reference.current = keyRef
  useEffect(() => {
    const next = createProviderWriter(namespace.ns, operations, {
      writable: () => !current.current.readOnly,
      accept: (view) => {
        current.current.committed = view; current.current.changed = true; setCommitted(view)
        // 在途表单不可编辑；确认成功后清除该批模型修改，重试凭据不依赖 JSON 字段顺序。
        setModelsDirty(false)
        setProtocolDirty(false)
      },
      credentialRef: () => {
        const latest = current.current.namespace.revision > current.current.committed.revision
          ? current.current.namespace : current.current.committed
        return reference.current(latest)
      },
    })
    setWriter(next)
    return () => { next.dispose() }
  }, [namespace.ns, operations])
  const credential = row.apiKeyEnv === undefined ? row.derivedCredential : row.credential
  const trimmedKey = key.trim(), trimmedEndpoint = endpoint.trim()
  const inheritedEndpoint = schema.getPath(committed.base, [...path, 'baseURL'])
  const probeEndpoint = trimmedEndpoint !== '' ? trimmedEndpoint : typeof inheritedEndpoint === 'string' ? inheritedEndpoint : undefined
  const probeApi = declared ? protocol : schema.getPath(committed.value, [...path, 'api'])
  const invalidKey = invalidCredentialInput(key)
  let invalidEndpoint = false
  if (trimmedEndpoint !== '') {
    try { const url = new URL(trimmedEndpoint); invalidEndpoint = url.protocol !== 'https:' && url.protocol !== 'http:' }
    catch { invalidEndpoint = true } // 仅捕获用户端点不是合法 URL 的解析错误。
  }
  const save = async (): Promise<void> => {
    if (writer === undefined || busy || readOnly || invalidKey || invalidEndpoint || invalidProtocol || catalogFailure !== undefined
      || (trimmedKey !== '' && credential?.writable === false)) return
    const ops: SettingsPathOpView[] = [], base = [...path, 'baseURL']
    const previous = schema.getPath(committed.user, base)
    if (trimmedEndpoint !== '' && trimmedEndpoint !== previous) ops.push({ op: 'set', path: base, value: trimmedEndpoint })
    else if (trimmedEndpoint === '' && schema.hasPath(committed.user, base)) ops.push({ op: 'unset', path: base })
    if (declared) {
      const namePath = [...path, 'displayName'], name = displayName.trim()
      if (name !== '' && name !== schema.getPath(committed.user, namePath)) ops.push({ op: 'set', path: namePath, value: name })
      else if (name === '' && schema.hasPath(committed.user, namePath)) ops.push({ op: 'unset', path: namePath })
      if (protocolDirty) ops.push({ op: 'set', path: [...path, 'api'], value: protocol })
    }
    if (modelsDirty) {
      if (modelsOverridden) {
        const value = modelValues(models)
        ops.push({ op: 'set', path: modelsPath, value })
      } else if (schema.hasPath(committed.user, modelsPath)) ops.push({ op: 'unset', path: modelsPath })
    }
    const ref = keyRef(committed)
    if (trimmedKey !== '' && row.entry.settingsNs === 'llm-pi-ai'
      && schema.getPath(committed.value, [...path, 'apiKeyEnv']) === undefined) {
      ops.push({ op: 'set', path: [...path, 'apiKeyEnv'], value: ref })
    }
    // 原生认证允许空配置；显式启用目录中尚未配置的路线时仍需持久化该路线。
    if (ops.length === 0 && row.entry.settingsNs === 'llm-pi-ai'
      && schema.getPath(committed.value, path) === undefined && schema.getPath(committed.user, path) === undefined) {
      ops.push({ op: 'set', path: [...path], value: {} })
    }
    setBusy(true); setNotice(undefined)
    const result = await writer.save({ ops, revision: committed.revision,
      ...(trimmedKey === '' ? {} : { credential: { ref, value: trimmedKey } }) })
    if (result.configuration === 'inactive' || result.credential === 'inactive') return
    setBusy(false)
    if (result.configuration === 'conflict') { setNotice('conflict'); return }
    if (result.configuration === 'refused' || result.configuration === 'busy') { setNotice('saveFailed'); return }
    if (result.credential === 'refused' || result.credential === 'reference-changed') {
      setNotice(current.current.changed ? 'partialSave' : 'credentialFailed'); return
    }
    setKey(''); onClose(current.current.changed || result.credential === 'written')
  }
  return <form className={css.editor} onSubmit={(event) => { event.preventDefault(); void save() }}>
    {declared && <>
      <label>{t('providerName')}<input value={displayName} placeholder={row.entry.displayName} disabled={busy || readOnly}
        onChange={(event) => { setDisplayName(event.target.value) }} /></label>
      <label>{t('providerProtocol')}<select value={protocol} disabled={busy || readOnly}
        onChange={(event) => { setProtocol(event.target.value); setProtocolDirty(true) }}>
        {!protocols.includes(protocol) && <option value={protocol}>{protocol || t('protocolUnset')}</option>}
        {protocols.map(value => <option value={value} key={value}>{value}</option>)}
      </select></label>
      {invalidProtocol && <p role="alert">{t('protocolUnavailable')}</p>}
    </>}
    <label>{t('endpoint')}<input type="url" value={endpoint} disabled={busy || readOnly}
      onChange={(event) =>{  setEndpoint(event.target.value) }} /></label>
    <p>{t('endpointHint')}</p>
    <label>{t('apiKey')}<input type="password" autoComplete="new-password" spellCheck={false} value={key}
      disabled={busy || readOnly || credential?.writable === false} onChange={(event) =>{  setKey(event.target.value) }} /></label>
    <p>{t(credential?.writable === false ? 'keyReadonly' : 'keyHint')}</p>
    <ModelCatalog rows={models} overridden={modelsOverridden} disabled={busy || readOnly} t={t}
      onChange={(next) => { setModels(next); setModelsDirty(true); setModelsOverridden(true) }} onReset={() => {
        // 恢复继承不能读取仍含 user 覆盖的 effective value。
        const inherited: unknown = schema.getPath(committed.base, modelsPath)
          ?? schema.nodeAtPath(schema.rehydrate(committed.schema), modelsPath)?.meta.default
        setModels(modelDrafts(inherited)); setModelsDirty(true); setModelsOverridden(false)
      }} />
    {catalogFailure !== undefined && <p role="alert">{t(catalogFailure)}</p>}
    {row.entry.settingsNs === 'llm-pi-ai' && <ModelDiscovery namespace={namespace.ns} operations={operations}
      disabled={busy || readOnly || invalidKey || invalidEndpoint || invalidProtocol} t={t}
      known={new Set(models.map(model => model.id.trim()))}
      request={{ provider: row.entry.provider, ...(probeEndpoint === undefined ? {} : { baseURL: probeEndpoint }),
        ...(typeof probeApi === 'string' ? { api: probeApi } : {}), ...(trimmedKey === '' ? {} : { apiKey: trimmedKey }) }}
      onAdopt={(candidates) => {
        if (candidates.length === 0) return
        setModels(previous => [...previous, ...modelDrafts(candidates)]); setModelsDirty(true); setModelsOverridden(true)
      }} />}
    {invalidEndpoint && <p role="alert">{t('invalidEndpoint')}</p>}
    {invalidKey && <p role="alert">{t('invalidKey')}</p>}
    {notice !== undefined && <p role="alert">{t(notice)}</p>}
    <div className={css.actions}>
      <button className="qs-btn" type="button" onClick={() =>{  onClose(current.current.changed) }}>{t('cancel')}</button>
      <button className="qs-btn" type="submit"
        disabled={writer === undefined || busy || readOnly || invalidKey || invalidEndpoint
          || invalidProtocol || catalogFailure !== undefined
          || (trimmedKey !== '' && credential?.writable === false)}>
        {t(busy ? 'saving' : 'save')}
      </button>
    </div>
  </form>
}
