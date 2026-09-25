/** 模型数组的可见编辑控件，不自行写配置或触发模型请求。 */
import type { ModelDraft } from './model-draft.ts'
import type { zh } from './locales.ts'
import css from './models.module.css'
/** 模型数组的编辑与恢复继承操作由供应商表单持有。 */
export interface ModelCatalogProps {
  readonly rows: readonly ModelDraft[]
  readonly overridden?: boolean
  readonly disabled: boolean
  readonly t: (key: keyof typeof zh) => string
  /** @param rows - 用户刚修改的完整模型草稿数组。 */
  readonly onChange: (rows: ModelDraft[]) => void
  /** 恢复部署配置或 schema 默认值，保存时移除 user.models。 */
  readonly onReset?: () => void
}
/**
 * 呈现模型字段和数组编辑操作。
 * @param props - 模型字段及草稿操作。
 * @returns 原型卡片内的模型列表。
 */
export function ModelCatalog({ rows, overridden, disabled, t, onChange, onReset }: ModelCatalogProps) {
  const fields = [['id', 'modelId'], ['name', 'modelName'], ['contextWindow', 'modelContext'], ['maxTokens', 'modelOutput']] as const
  return <fieldset className={css.editor} disabled={disabled}>
    <legend>{t('models')}</legend>{overridden !== undefined && <p>{t(overridden ? 'modelsCustom' : 'modelsInherited')}</p>}
    {rows.map((row, index) => <div className={css.provider} key={index}>
      {fields.map(([field, label]) => <label key={field}>{t(label)}
        <input aria-label={`${t(label)} ${String(index + 1)}`} value={row[field]} onChange={(event) => {
          onChange(rows.map((item, at) => at === index ? { ...item, [field]: event.target.value } : item))
        }} />
      </label>)}
      <button type="button" className="qs-btn" aria-label={`${t('removeModel')} ${String(index + 1)}`}
        onClick={() => { onChange(rows.filter((_item, at) => at !== index)) }}>{t('removeModel')}</button>
    </div>)}
    <div className={css.actions}>
      <button type="button" className="qs-btn" onClick={() => { onChange([...rows, { original: {}, id: '', name: '', contextWindow: '', maxTokens: '' }]) }}>{t('addModel')}</button>
      {overridden && <button type="button" className="qs-btn" onClick={onReset}>{t('resetModels')}</button>}
    </div>
  </fieldset>
}
