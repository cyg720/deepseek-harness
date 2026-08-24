/**
 * Language preference row registered into the General section item slot
 * (figma 501:30011 'Setting-Cell'): title + selector pill opening the locale
 * menu. Registered by this package — the locale feature owns its own
 * settings surface.
 */
/**
 * 文件职责：渲染客户端设置中的语言选择行，并把用户选择写入语言状态。
 * 技术维度：React/TSX、受控选择框、客户端本地化服务与样式类名。
 * 产品维度：让用户在界面中切换显示语言，并立即看到本地化文本变化。
 * 逻辑维度：读取可选语言和当前值，生成选项列表，在 change 事件中更新语言。
 * 关键边界：组件依赖上层提供的语言状态；未知语言值不能绕过可用语言列表。
 * 新手阅读建议：先看组件参数，再看 options 的来源和 onChange 如何写回状态。
 */
import { useState } from 'react'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { IconChevronDownOutline14, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { createLanguageRowStore } from './settings-store.ts'
import css from './LanguageRow.module.css'

/** Injected business face: the preference write (t rides the standard locale seat). */
/** 中文说明：类型 `LanguageRowInjected` 约束本文件使用的数据字段和取值范围，避免调用方传入不完整状态。 */
export interface LanguageRowInjected {
  /** Switch the active locale (a registered locale id). */
  setLocale: (id: string) => void
}

/** Full component props: runtime share + store share + locale seat + injected face. */
/** 中文说明：类型 `LanguageRowComponentProps` 约束本文件使用的数据字段和取值范围，避免调用方传入不完整状态。 */
export type LanguageRowComponentProps =
  PropsRuntime<'settings.general.item'> & PropsStore<ReturnType<typeof createLanguageRowStore>>
  & PropsLocale<'settings.locale'> & LanguageRowInjected

/**
 * Render the Language row.
 * @param props - composed slot props.
 * @returns the row element tree.
 */
/** 中文说明：内部函数 `LanguageRow`；参数含义见签名，返回值用于后续处理；例如按本文件中的调用位置使用。 */
export function LanguageRow({ t, setLocale, useStore }: LanguageRowComponentProps) {
  /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `active` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
  const active = useStore(s => s.active)
  /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `options` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
  const options = useStore(s => s.options)
  /** 中文说明：保存索引、集合或按顺序观测值的数据结构；变量 `[open, setOpen]` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  const [open, setOpen] = useState(false)
  /** 中文说明：当前处理步骤使用的局部状态或中间值；变量 `activeLabel` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
  const activeLabel = options.find(o => o.id === active)?.label ?? active

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('language.title')}</div>
      </div>
      <Menu
        open={open}
        onClose={() => { setOpen(false) }}
        items={options.map(o => ({ id: o.id, label: o.label }))}
        selectedId={active}
        onSelect={(id) => {
          setLocale(id)
          setOpen(false)
        }}
        align="end"
        portal
        anchor={(
          <button
            type="button"
            className={css.selector}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => { setOpen(v => !v) }}
          >
            {activeLabel}
            <IconChevronDownOutline14 className={css.chevron} />
          </button>
        )}
      />
    </div>
  )
}
