/** 奇术数值配置卡：本地暂存草稿，明确保存后才写入 Host。 */
import { useEffect, useId, useRef, useState } from 'react'
import type { SettingsMirrorSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SettingsNamespaceView, SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { CardWriter, SaveOutcome } from './save.ts'
import type { zh } from './locales.ts'
import type {} from './contract.ts'
import css from './numeric.module.css'
type Key = keyof typeof zh
/** 由各个官方命名空间独立注册的数值字段。 */
export interface NumericSpec {
  readonly namespace: string
  readonly title: Key
  readonly fields: readonly { readonly name: string; readonly label: Key }[]
}
/** 卡片只持有草稿，真实配置、校验和写入均来自官方能力。 */
export interface NumericInjected extends NumericSpec {
  readonly hooks: { readonly settings: HostObservable<SettingsMirrorSnapshot> }
  /** @returns 当前卡挂载拥有的独立提交器。 */
  readonly createWriter: () => CardWriter
  /**
   * @param field - 配置字段。
   * @param value - 待保存数字。
   * @returns 官方字段 schema 是否接受。
   */
  readonly valid: (field: string, value: number) => boolean
}
/** 数值卡完整槽座位。 */
export type NumericProps = PropsRuntime<'qs.settings.plugin.item'> & PropsLocale<'qs-ui-settings-plugins'> & InjectFace<NumericInjected>
type Draft = { readonly text: string; readonly clear: boolean }
function read(source: SettingsNamespaceView['value'] | undefined, key: string): unknown {
  return source !== null && typeof source === 'object' && !Array.isArray(source) ? source[key] : undefined
}
function display(source: SettingsNamespaceView['value'] | undefined, key: string): string {
  // 镜像中的 JSON 保留可辨认表示，缺失字段允许通过留空恢复继承。
  const value = read(source, key)
  return value === undefined ? '' : JSON.stringify(value)
}
/**
 * 暂存字段，保存使用最初编辑版本；冲突及失败保留草稿。
 * @param props - 独立命名空间、官方镜像及命令。
 * @returns 原型配置表单。
 */
export function NumericCard({ namespace, title, fields, useSettings, createWriter, valid, t }: NumericProps) {
  const id = useId(), mirror = useSettings(value => value)
  const view = mirror.view?.namespaces.find(value => value.ns === namespace)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [revision, setRevision] = useState<number>()
  const [saving, setSaving] = useState(false), [outcome, setOutcome] = useState<SaveOutcome['kind']>()
  const owner = useRef<{ writer: CardWriter; pending: boolean }>()
  useEffect(() => {
    const writer = createWriter(); owner.current = { writer, pending: false }
    return () => { writer.dispose(); owner.current = undefined }
  }, [createWriter])
  if (view === undefined) return null
  const dirty = Object.keys(drafts).length > 0, disabled = saving || mirror.view?.writable !== true
  const invalid = Object.entries(drafts).some(([field, draft]) => !draft.clear && draft.text.trim() !== '' && (!Number.isFinite(Number(draft.text)) || !valid(field, Number(draft.text))))
  const stage = (name: string, draft: Draft): void => {
    if (disabled || owner.current?.pending) return
    setRevision(previous => previous ?? view.revision)
    setDrafts(previous => ({ ...previous, [name]: draft })); setOutcome(undefined)
  }
  const discard = (): void => { setDrafts({}); setRevision(undefined); setOutcome(undefined) }
  const save = async (): Promise<void> => {
    const operation = owner.current
    if (operation === undefined || operation.pending || disabled || !dirty || invalid || revision === undefined) return
    const ops: SettingsPathOpView[] = Object.entries(drafts).map(([name, draft]) => draft.clear || draft.text.trim() === ''
      ? { op: 'unset', path: [name] } : { op: 'set', path: [name], value: Number(draft.text) })
    operation.pending = true; setSaving(true)
    const result = await operation.writer.save(ops, revision)
    if (owner.current !== operation) return
    operation.pending = false
    setSaving(false); setOutcome(result.kind)
    if (result.kind === 'written') { setDrafts({}); setRevision(undefined) }
  }
  return <section className={css.card} aria-label={t(title)}>
    <h4>{t(title)}</h4>
    {fields.map(({ name, label }) => {
      const draft = drafts[name], value = draft?.text ?? display(view.value, name)
      const overridden = draft === undefined ? read(view.user, name) !== undefined : !draft.clear && draft.text.trim() !== ''
      return <div className={css.field} key={name}>
        <label htmlFor={`${id}-${name}`}>{t(label)}</label>
        <input id={`${id}-${name}`} inputMode="decimal" value={value} disabled={disabled} onChange={(event) => { stage(name, { text: event.currentTarget.value, clear: false }) }} />
        <small>{t(overridden ? 'overridden' : 'inherited')} · {t('currentValue')}: {display(view.value, name)}</small>
        <button type="button" disabled={disabled} onClick={() => { stage(name, { text: display(view.base, name), clear: true }) }}>{t('resetField')}</button>
      </div>
    })}
    {invalid ? <p role="alert">{t('invalidNumber')}</p> : null}
    {outcome === 'conflict' || outcome === 'refused' ? <p role="alert">{t(outcome === 'conflict' ? 'conflict' : 'saveFailed')}</p> : null}
    {outcome === 'written' ? <p role="status">{t(view.applies === 'restart' ? 'savedRestart' : 'saved')}</p> : null}
    <div className={css.actions}>
      <button type="button" disabled={disabled || !dirty || invalid} onClick={() => { void save() }}>{t(saving ? 'saving' : 'save')}</button>
      <button type="button" disabled={saving || !dirty} onClick={discard}>{t('discard')}</button>
      {outcome === 'conflict' ? <button type="button" disabled={disabled} onClick={() => { setRevision(view.revision); setOutcome(undefined) }}>{t('adoptRevision')}</button> : null}
    </div>
  </section>
}
