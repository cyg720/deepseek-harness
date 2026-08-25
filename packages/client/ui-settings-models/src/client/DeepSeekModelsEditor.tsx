/**
 * Curated editor for the direct DeepSeek adapter's advisory model catalog.
 * The settings layer replaces `models` as one array, so the parent supplies
 * the effective inherited rows until the first edit materializes a user
 * override; reset removes that override instead of copying defaults into it.
 */
/*
 * 文件职责：实现模型设置的 DeepSeekModelsEditor 组件。
 * 技术维度：React、TypeScript、受控表单、Cordis 插槽和 CSS Modules。
 * 产品维度：帮助用户查看和调整模型设置。
 * 逻辑维度：读取状态，编辑草稿，调用保存或发现操作并展示结果。
 * 关键边界：界面可见信息不代表授权；密钥只显示配置状态，不显示原值。
 * 新手阅读建议：先读 Props 和状态类型，再看事件处理与 JSX。
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import {
  IconChevronDownOutline14, IconChevronRightOutline14, IconPlusOutline16, IconTrashOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/** One catalog entry kept structurally open so hidden or future fields survive an edit. */
/* 中文说明：类型或类 DeepSeekModelDraft 约束设置数据或组件职责。 */
export type DeepSeekModelDraft = Record<string, unknown>

/** The catalog fields this editor writes. */
/* 中文说明：类型或类 CatalogField 约束设置数据或组件职责。 */
type CatalogField = 'id' | 'name' | 'contextWindow' | 'maxTokens'

/** The two token counts edited as K/M-suffixed text behind a row's disclosure. */
/* 中文说明：类型或类 CapacityField 约束设置数据或组件职责。 */
type CapacityField = 'contextWindow' | 'maxTokens'

/** Row index encoded in an editing-buffer key. */
/* 中文说明：函数 rowOf 的参数见签名，返回结果供设置流程使用；示例见本文件。 */
function rowOf(key: string): number {
  return Number(key.slice(0, key.indexOf(':')))
}

/** Accepted capacity spellings: a decimal count with an optional K/M suffix. */
/* 中文说明：设置局部值 CAPACITY_PATTERN，由紧邻初始化决定。 */
const CAPACITY_PATTERN = /^(\d+(?:\.\d+)?)([km])?$/i

/** Decimal suffix scales — `1M` is 1000K, matching how model capacities are quoted. */
/* 中文说明：设置局部值 CAPACITY_SCALE，由紧邻初始化决定。 */
const CAPACITY_SCALE = { k: 1_000, m: 1_000_000 } as const

/**
 * Read a typed capacity, so a user can write `256K` or `1M` instead of counting
 * zeroes. The stored value stays a plain token count.
 * @param text - raw field text.
 * @returns the count; `undefined` when blank (inherit), `NaN` when unreadable
 * (rejected by {@link validateDeepSeekModels} before any write).
 */
/* 中文说明：函数 parseCapacity 的参数见签名，返回结果供设置流程使用；示例见本文件。 */
export function parseCapacity(text: string): number | undefined {
  /** 中文说明：设置局部值 trimmed，由紧邻初始化决定。 */
  const trimmed = text.trim()
  if (trimmed.length === 0) return undefined
  /** 中文说明：设置局部值 match，由紧邻初始化决定。 */
  const match = CAPACITY_PATTERN.exec(trimmed)
  if (match === null) return Number.NaN
  /** 中文说明：设置局部值 suffix，由紧邻初始化决定。 */
  const suffix = match[2]?.toLowerCase()
  /** 中文说明：设置局部值 scale，由紧邻初始化决定。 */
  const scale = suffix === 'k' || suffix === 'm' ? CAPACITY_SCALE[suffix] : 1
  /** 中文说明：设置局部值 scaled，由紧邻初始化决定。 */
  const scaled = Number(match[1]) * scale
  // A decimal multiple is exact in intent but not in binary floating point
  // (2.3 * 1e6 lands a few ULPs high), so an integral intent snaps back.
  /** 中文说明：设置局部值 rounded，由紧邻初始化决定。 */
  const rounded = Math.round(scaled)
  return Math.abs(scaled - rounded) < 1e-6 ? rounded : scaled
}

/**
 * Spell a stored count back in the shortest form that survives a round trip
 * through {@link parseCapacity}; a count that is not a whole number of
 * thousands stays written out.
 * @param value - stored capacity.
 * @returns the field text.
 */
/* 中文说明：函数 formatCapacity 的参数见签名，返回结果供设置流程使用；示例见本文件。 */
export function formatCapacity(value: number): string {
  if (!Number.isInteger(value) || value <= 0) return String(value)
  if (value % CAPACITY_SCALE.m === 0) return `${String(value / CAPACITY_SCALE.m)}M`
  if (value % CAPACITY_SCALE.k === 0) return `${String(value / CAPACITY_SCALE.k)}K`
  return String(value)
}

/** A localized validation failure for one user-owned model array. */
/* 中文说明：类型或类 DeepSeekModelsValidationFailure 约束设置数据或组件职责。 */
export interface DeepSeekModelsValidationFailure {
  /** Zero-based model position. */
  index: number
  /** Message key owned by the Models settings section. */
  key: 'modelIdRequired' | 'modelIdDuplicate' | 'modelNameInvalid' | 'modelContextInvalid'
  | 'modelMaxTokensInvalid'
}

/** Convert a schema-validated catalog value into records without dropping hidden fields. */
/* 中文说明：函数 modelDrafts 的参数见签名，返回结果供设置流程使用；示例见本文件。 */
export function modelDrafts(value: unknown): DeepSeekModelDraft[] {
  if (!Array.isArray(value)) return []
  return value.map(entry =>
    typeof entry === 'object' && entry !== null && !Array.isArray(entry)
      ? entry as DeepSeekModelDraft
      : {})
}

/**
 * Validate adapter constraints that the serialized schema cannot express.
 * @param value - user-owned `models` value, or undefined while inherited.
 * @returns the first invalid row, or undefined when the adapter will accept it.
 */
/* 中文说明：函数 validateDeepSeekModels 的参数见签名，返回结果供设置流程使用；示例见本文件。 */
export function validateDeepSeekModels(value: unknown): DeepSeekModelsValidationFailure | undefined {
  if (value === undefined) return undefined
  /** 中文说明：设置局部值 models，由紧邻初始化决定。 */
  const models = modelDrafts(value)
  /** 中文说明：设置局部值 seen，由紧邻初始化决定。 */
  const seen = new Set<string>()
  /** 中文说明：设置局部值 [index，由紧邻初始化决定。 */
  for (const [index, model] of models.entries()) {
    // Compared trimmed: surrounding whitespace is a paste artifact the adapter
    // would never match, and an untrimmed compare lets `model ` slip past the
    // duplicate check against its own twin.
    /** 中文说明：设置局部值 id，由紧邻初始化决定。 */
    const id = model['id']
    /** 中文说明：设置局部值 trimmed，由紧邻初始化决定。 */
    const trimmed = typeof id === 'string' ? id.trim() : undefined
    if (trimmed === undefined || trimmed.length === 0) return { index, key: 'modelIdRequired' }
    if (seen.has(trimmed)) return { index, key: 'modelIdDuplicate' }
    seen.add(trimmed)
    /** 中文说明：设置局部值 name，由紧邻初始化决定。 */
    const name = model['name']
    if (name !== undefined && (typeof name !== 'string' || name.length === 0)) {
      return { index, key: 'modelNameInvalid' }
    }
    /** 中文说明：设置局部值 contextWindow，由紧邻初始化决定。 */
    const contextWindow = model['contextWindow']
    if (contextWindow !== undefined
      && (typeof contextWindow !== 'number' || !Number.isInteger(contextWindow) || contextWindow <= 0)) {
      return { index, key: 'modelContextInvalid' }
    }
    /** 中文说明：设置局部值 maxTokens，由紧邻初始化决定。 */
    const maxTokens = model['maxTokens']
    if (maxTokens !== undefined
      && (typeof maxTokens !== 'number' || !Number.isInteger(maxTokens) || maxTokens <= 0)) {
      return { index, key: 'modelMaxTokensInvalid' }
    }
  }
  return undefined
}

/** Props of {@link DeepSeekModelsEditor}. */
/* 中文说明：类型或类 DeepSeekModelsEditorProps 约束设置数据或组件职责。 */
export interface DeepSeekModelsEditorProps {
  /** Effective rows: inherited until the parent materializes an override. */
  models: readonly DeepSeekModelDraft[]
  /** Whether the user layer currently owns the whole array. */
  overridden: boolean
  /** Fallback context capacity used when a row omits its exact value. */
  defaultContextWindow: number | undefined
  /** Fallback output cap used when a row omits its exact value. */
  defaultMaxTokens: number | undefined
  /** Section copy. */
  t: (key: keyof typeof en) => string
  /** Disable every mutation. */
  disabled: boolean
  /** Replace the user-owned array after one visible edit. */
  onChange: (models: DeepSeekModelDraft[]) => void
  /** Remove the user-owned array and return to inheritance. */
  onReset: () => void
}

/**
 * Render the direct DeepSeek adapter's model catalog: id and display name on
 * each row, capacities behind the row's own disclosure.
 * @param props - effective rows plus the array-level override actions.
 * @returns the catalog editor.
 */
/* 中文说明：函数 DeepSeekModelsEditor 的参数见签名，返回结果供设置流程使用；示例见本文件。 */
export function DeepSeekModelsEditor(props: DeepSeekModelsEditorProps): ReactNode {
  // Capacities are edited as text, so a field's keystrokes are held here
  // rather than re-derived from the parsed count on every change, which would
  // rewrite `1000` to `1K` mid-word. Unreadable text is kept past blur so the
  // save-time rejection names a row the user can still see — which is why
  // this is one entry PER FIELD: a single active buffer would be displaced by
  // editing any other field, and the abandoned one would fall back to
  // rendering its stored NaN as the literal `NaN`.
  //
  // Keys carry the row index, so the two operations that move indexes maintain
  // them: `remove` re-keys around the dropped row, and reset clears them all
  // because the rows they annotated are gone.
  /** 中文说明：设置局部值 [editing, setEditing]，由紧邻初始化决定。 */
  const [editing, setEditing] = useState<ReadonlyMap<string, string>>(() => new Map())
  /** 中文说明：设置局部值 [expanded, setExpanded]，由紧邻初始化决定。 */
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set())

  /** 中文说明：设置局部值 update，由紧邻初始化决定。 */
  const update = (index: number, key: CatalogField, value: unknown): void => {
    /** 中文说明：设置局部值 next，由紧邻初始化决定。 */
    const next = props.models.map((model, at) => {
      /** 中文说明：设置局部值 copy，由紧邻初始化决定。 */
      const copy = { ...model }
      if (at !== index) return copy
      if (value === undefined) Reflect.deleteProperty(copy, key)
      else copy[key] = value
      return copy
    })
    props.onChange(next)
  }

  /** 中文说明：设置局部值 remove，由紧邻初始化决定。 */
  const remove = (index: number): void => {
    setEditing((current) => {
      /** 中文说明：设置局部值 next，由紧邻初始化决定。 */
      const next = new Map<string, string>()
      /** 中文说明：设置局部值 [key，由紧邻初始化决定。 */
      for (const [key, text] of current) {
        /** 中文说明：设置局部值 at，由紧邻初始化决定。 */
        const at = rowOf(key)
        if (at === index) continue
        // Only the row number moves; the field half of the key is untouched.
        next.set(at > index ? key.replace(/^\d+/, String(at - 1)) : key, text)
      }
      return next
    })
    setExpanded((current) => {
      /** 中文说明：设置局部值 next，由紧邻初始化决定。 */
      const next = new Set<number>()
      /** 中文说明：设置局部值 at，由紧邻初始化决定。 */
      for (const at of current) {
        if (at === index) continue
        next.add(at > index ? at - 1 : at)
      }
      return next
    })
    props.onChange(props.models.filter((_model, at) => at !== index).map(model => ({ ...model })))
  }

  /** 中文说明：设置局部值 reset，由紧邻初始化决定。 */
  const reset = (): void => {
    setEditing(new Map())
    setExpanded(new Set())
    props.onReset()
  }

  /** 中文说明：设置局部值 toggle，由紧邻初始化决定。 */
  const toggle = (index: number): void => {
    setExpanded((current) => {
      /** 中文说明：设置局部值 next，由紧邻初始化决定。 */
      const next = new Set(current)
      if (!next.delete(index)) next.add(index)
      return next
    })
  }

  /** The field's text: its live keystrokes, else the stored count spelled short. */
  /* 中文说明：设置局部值 capacityText，由紧邻初始化决定。 */
  const capacityText = (model: DeepSeekModelDraft, index: number, field: CapacityField): string => {
    /** 中文说明：设置局部值 typed，由紧邻初始化决定。 */
    const typed = editing.get(`${String(index)}:${field}`)
    if (typed !== undefined) return typed
    /** 中文说明：设置局部值 value，由紧邻初始化决定。 */
    const value = model[field]
    return typeof value === 'number' ? formatCapacity(value) : ''
  }

  /** 中文说明：设置局部值 settleCapacity，由紧邻初始化决定。 */
  const settleCapacity = (index: number, field: CapacityField): void => {
    /** 中文说明：设置局部值 key，由紧邻初始化决定。 */
    const key = `${String(index)}:${field}`
    /** 中文说明：设置局部值 typed，由紧邻初始化决定。 */
    const typed = editing.get(key)
    if (typed === undefined) return
    // Unreadable text stays on screen: the save-time rejection names a row the
    // user can still see and correct.
    /** 中文说明：设置局部值 parsed，由紧邻初始化决定。 */
    const parsed = parseCapacity(typed)
    if (parsed !== undefined && Number.isNaN(parsed)) return
    setEditing((current) => {
      /** 中文说明：设置局部值 next，由紧邻初始化决定。 */
      const next = new Map(current)
      next.delete(key)
      return next
    })
  }

  /** One capacity field of one row, rendered inside the row's disclosure. */
  /* 中文说明：设置局部值 capacityField，由紧邻初始化决定。 */
  const capacityField = (
    model: DeepSeekModelDraft,
    index: number,
    field: CapacityField,
    fallback: number | undefined,
  ): ReactNode => (
    <label className={styles['modelField']}>
      <span className={styles['modelFieldLabel']}>{props.t(field === 'contextWindow' ? 'contextWindow' : 'maxTokens')}</span>
      <input
        className={styles['input']}
        type="text"
        inputMode="numeric"
        value={capacityText(model, index, field)}
        placeholder={fallback === undefined
          ? props.t(field === 'contextWindow' ? 'contextWindowPlaceholder' : 'maxTokensPlaceholder')
          : formatCapacity(fallback)}
        aria-label={`${props.t(field === 'contextWindow' ? 'contextWindow' : 'maxTokens')} ${String(index + 1)}`}
        disabled={props.disabled}
        onChange={(event) => {
          /** 中文说明：设置局部值 text，由紧邻初始化决定。 */
          const text = event.target.value
          setEditing(current => new Map(current).set(`${String(index)}:${field}`, text))
          update(index, field, parseCapacity(text))
        }}
        onBlur={() => { settleCapacity(index, field) }}
      />
    </label>
  )

  return (
    <section className={styles['modelCatalog']} aria-label={props.t('models')}>
      <div className={styles['modelListHead']}>
        <div className={styles['modelCatalogHeading']}>
          <span className={styles['modelCatalogTitle']}>{props.t('models')}</span>
          <span className={styles['modelCatalogMeta']}>
            {props.overridden ? props.t('modelsCustomized') : props.t('modelsInherited')}
          </span>
        </div>
        {props.overridden
          ? (
            <button
              type="button"
              className={styles['linkButton']}
              disabled={props.disabled}
              onClick={reset}
            >
              {props.t('resetModels')}
            </button>
          )
          : null}
      </div>
      {props.models.length === 0
        ? <p className={styles['modelEmpty']}>{props.t('modelsEmpty')}</p>
        : (
          <div className={styles['modelList']}>
            {props.models.map((model, index) => (
              <div className={styles['modelEntry']} key={index}>
                <div className={styles['modelRow']}>
                  <input
                    className={styles['input']}
                    type="text"
                    value={typeof model['id'] === 'string' ? model['id'] : ''}
                    placeholder={props.t('modelId')}
                    aria-label={`${props.t('modelId')} ${String(index + 1)}`}
                    disabled={props.disabled}
                    onChange={(event) => { update(index, 'id', event.target.value) }}
                    onBlur={(event) => {
                      // Settle a pasted id rather than trimming per keystroke,
                      // which would stop the user typing an interior space.
                      /** 中文说明：设置局部值 trimmed，由紧邻初始化决定。 */
                      const trimmed = event.target.value.trim()
                      if (trimmed !== event.target.value) update(index, 'id', trimmed)
                    }}
                  />
                  <input
                    className={styles['input']}
                    type="text"
                    value={typeof model['name'] === 'string' ? model['name'] : ''}
                    placeholder={props.t('modelName')}
                    aria-label={`${props.t('modelName')} ${String(index + 1)}`}
                    disabled={props.disabled}
                    onChange={(event) => {
                      update(index, 'name', event.target.value === '' ? undefined : event.target.value)
                    }}
                  />
                  <button
                    type="button"
                    className={styles['iconButton']}
                    aria-label={`${props.t('modelAdvanced')} ${String(index + 1)}`}
                    aria-expanded={expanded.has(index)}
                    title={props.t('modelAdvanced')}
                    onClick={() => { toggle(index) }}
                  >
                    {expanded.has(index) ? <IconChevronDownOutline14 /> : <IconChevronRightOutline14 />}
                  </button>
                  <button
                    type="button"
                    className={`${styles['iconButton']} ${styles['iconButtonDanger']}`}
                    aria-label={`${props.t('removeModel')} ${String(index + 1)}`}
                    title={props.t('removeModel')}
                    disabled={props.disabled}
                    onClick={() => { remove(index) }}
                  >
                    <IconTrashOutline16 size={14} />
                  </button>
                </div>
                {expanded.has(index)
                  ? (
                    <div className={styles['modelAdvanced']}>
                      {capacityField(model, index, 'contextWindow', props.defaultContextWindow)}
                      {capacityField(model, index, 'maxTokens', props.defaultMaxTokens)}
                    </div>
                  )
                  : null}
              </div>
            ))}
          </div>
        )}
      <button
        type="button"
        className={styles['addModelButton']}
        disabled={props.disabled}
        onClick={() => { props.onChange([...props.models.map(model => ({ ...model })), { id: '' }]) }}
      >
        <IconPlusOutline16 size={14} />
        {props.t('addModel')}
      </button>
    </section>
  )
}
