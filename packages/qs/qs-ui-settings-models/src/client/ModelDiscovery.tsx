/** 模型发现只查询候选，明确添加后进入草稿，绝不顺带存储配置或密钥。 */
import { useEffect, useRef, useState } from 'react'
import type { LlmDiscoveredModel, LlmModelDiscoveryRequest } from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelsOperations } from '@deepseek-ai/dsh-client-ui-settings-models/client'
import type { zh } from './locales.ts'
import css from './models.module.css'
/** 候选查询使用表单当前字段，不要求先保存。 */
export interface ModelDiscoveryProps {
  readonly namespace: string
  readonly request: LlmModelDiscoveryRequest
  readonly known: ReadonlySet<string>
  readonly operations: ModelsOperations
  readonly disabled: boolean
  readonly t: (key: keyof typeof zh) => string
  /** @param candidates - 用户明确选择且尚未存在的候选模型。 */
  readonly onAdopt: (candidates: readonly LlmDiscoveredModel[]) => void
}
/**
 * 查询、筛选和选取候选；请求字段变化即失效旧结果。
 * @param props - 当前供应商查询字段和草稿添加动作。
 * @returns 奇术模型候选区域。
 */
export function ModelDiscovery({ namespace, request, known, operations, disabled, t, onAdopt }: ModelDiscoveryProps) {
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false)
  const [candidates, setCandidates] = useState<readonly LlmDiscoveredModel[]>()
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set()), [query, setQuery] = useState('')
  const owner = useRef({ active: true })
  useEffect(() => {
    const scope = { active: true }; owner.current = scope
    setBusy(false); setFailed(false); setCandidates(undefined); setPicked(new Set()); setQuery('')
    return () => { scope.active = false }
  }, [namespace, operations, request.provider, request.baseURL, request.api, request.apiKey])
  const fetchModels = async (): Promise<void> => {
    const scope = owner.current
    setBusy(true); setFailed(false); setCandidates(undefined)
    let result: Awaited<ReturnType<ModelsOperations['discoverModels']>>
    // 只处理发现 RPC 的传输拒绝，远端诊断可能包含请求密钥，不直接展示。
    try { result = await operations.discoverModels(namespace, { ...request }) }
    catch { if (scope.active) { setBusy(false); setFailed(true) }; return }
    if (!scope.active) return
    setBusy(false)
    if (result.kind === 'refused') { setFailed(true); return }
    const unique = [...new Map(result.models.map(model => [model.id, model])).values()]
    setQuery(''); setCandidates(unique); setPicked(new Set(unique.filter(model => !known.has(model.id)).map(model => model.id)))
  }
  const search = query.trim().toLowerCase()
  const visible = candidates?.filter(model => model.id.toLowerCase().includes(search) || model.name?.toLowerCase().includes(search)) ?? []
  const selectable = visible.filter(model => !known.has(model.id))
  return <fieldset className={css.editor} disabled={disabled}>
    <legend>{t('discoverModels')}</legend>
    <button type="button" className="qs-btn" disabled={busy} onClick={() => { void fetchModels() }}>{t(busy ? 'discovering' : 'discoverModels')}</button>
    {failed && <p role="alert">{t('discoveryFailed')}</p>}
    {candidates !== undefined && <>
      {candidates.length === 0 ? <p>{t('discoveryEmpty')}</p> : <>
        <label>{t('filterModels')}<input value={query} onChange={(event) => { setQuery(event.target.value) }} /></label>
        <button type="button" className="qs-btn" disabled={selectable.length === 0} onClick={() => {
          const all = selectable.every(model => picked.has(model.id)), next = new Set(picked)
          for (const model of selectable) { if (all) next.delete(model.id); else next.add(model.id) }
          setPicked(next)
        }}>{t('toggleVisibleModels')}</button>
        {visible.length === 0 && <p>{t('noModelMatches')}</p>}
        {visible.map(model => <label key={model.id}><input type="checkbox" checked={picked.has(model.id)} disabled={known.has(model.id)}
          onChange={() => { const next = new Set(picked); if (!next.delete(model.id)) next.add(model.id); setPicked(next) }} />
        <span>{model.name ?? model.id}</span><code>{model.id}</code>{known.has(model.id) && <span>{t('modelAlreadyAdded')}</span>}
        </label>)}
      </>}
      <div className={css.actions}>
        <button type="button" className="qs-btn" onClick={() => { setCandidates(undefined); setPicked(new Set()) }}>{t('dismissCandidates')}</button>
        <button type="button" className="qs-btn" disabled={picked.size === 0} onClick={() => {
          onAdopt(candidates.filter(model => picked.has(model.id) && !known.has(model.id)))
          setCandidates(undefined); setPicked(new Set())
        }}>{t('adoptModels')}</button>
      </div>
    </>}
  </fieldset>
}
