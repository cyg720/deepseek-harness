/** Plugins settings section: localized tabs around feature-owned pages. */
/**
 * 文件职责：实现插件配置的 PluginsSettingsSection 组件。
 * 技术维度：React、TypeScript、受控表单、Cordis 插槽和 CSS Modules。
 * 产品维度：帮助用户查看和调整插件配置。
 * 逻辑维度：读取状态，编辑草稿，调用保存或发现操作并展示结果。
 * 关键边界：界面可见信息不代表授权；密钥只显示配置状态，不显示原值。
 * 新手阅读建议：先读 Props 和状态类型，再看事件处理与 JSX。
 */

import { useEffect, useId, useRef, useState } from 'react'
import type {
  HostObservable, InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { PluginsSettingsLocaleKey } from './locales.ts'
import css from './PluginsSettingsSection.module.css'

/** One tab projected from a `settings.plugins.tab` contribution. */
/** 中文说明：类型或类 PluginsSettingsTabEntry 约束设置数据或组件职责。 */
export interface PluginsSettingsTabEntry {
  id: string
  order: number
  label: string
}

/** Registration-side business face for the section. */
/** 中文说明：类型或类 PluginsSettingsSectionInjected 约束设置数据或组件职责。 */
export interface PluginsSettingsSectionInjected {
  hooks: {
    /** Ordered, locale-aware projection of the Plugins tab ledger. */
    tabs: HostObservable<readonly PluginsSettingsTabEntry[]>
  }
}

/** Props the renderer binds for the section. */
/** 中文说明：类型或类 PluginsSettingsSectionProps 约束设置数据或组件职责。 */
export type PluginsSettingsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.plugins'>
  & PropsRenderSlots<'settings.plugins.tab'>
  & InjectFace<PluginsSettingsSectionInjected>

/** Render one Plugins page whose contents arrive from feature-owned tabs. */
/** 中文说明：函数 PluginsSettingsSection 的参数见签名，返回结果供设置流程使用；示例见本文件。 */
export function PluginsSettingsSection({ t, renderSlot, useTabs }: PluginsSettingsSectionProps) {
  /** 中文说明：设置局部值 tabsId，由紧邻初始化决定。 */
  const tabsId = useId()
  /** 中文说明：设置局部值 tabRefs，由紧邻初始化决定。 */
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  /** 中文说明：设置局部值 rows，由紧邻初始化决定。 */
  const rows = useTabs(value => value)
  /** 中文说明：设置局部值 [activeId, setActiveId]，由紧邻初始化决定。 */
  const [activeId, setActiveId] = useState<string>()
  /** 中文说明：设置局部值 解构结果，由紧邻初始化决定。 */
  const [visitedIds, setVisitedIds] = useState<ReadonlySet<string>>(() => new Set())
  /** 中文说明：设置局部值 active，由紧邻初始化决定。 */
  const active = rows.find(row => row.id === activeId)?.id ?? rows[0]?.id

  // A tab mounts only when first selected, then stays mounted while hidden so
  // local drafts, disclosure state, search, and the inventory snapshot survive
  // switching between the two views.
  useEffect(() => {
    if (active === undefined) return
    setVisitedIds((previous) => {
      if (previous.has(active)) return previous
      return new Set([...previous, active])
    })
  }, [active])

  return (
    <div className={css.section}>
      <h2 className={css.heading}>{t('title')}</h2>
      <p className={css.intro}>{t('intro')}</p>
      {rows.length === 0 ? <p className={css.empty}>{t('empty')}</p> : (
        <>
          <div className={css.tabs} role="tablist" aria-label={t('tabs')}>
            {rows.map((row, index) => {
              /** 中文说明：设置局部值 selected，由紧邻初始化决定。 */
              const selected = row.id === active
              return (
                <button
                  key={row.id}
                  ref={(element) => { tabRefs.current[index] = element }}
                  id={`${tabsId}-tab-${row.id}`}
                  type="button"
                  role="tab"
                  className={css.tab}
                  aria-selected={selected}
                  aria-controls={`${tabsId}-panel-${row.id}`}
                  data-active={selected ? 'true' : undefined}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => { setActiveId(row.id) }}
                  onKeyDown={(event) => {
                    /** 中文说明：设置局部值 nextIndex: number，由紧邻初始化决定。 */
                    let nextIndex: number
                    switch (event.key) {
                      case 'ArrowRight': nextIndex = (index + 1) % rows.length; break
                      case 'ArrowLeft': nextIndex = (index - 1 + rows.length) % rows.length; break
                      case 'Home': nextIndex = 0; break
                      case 'End': nextIndex = rows.length - 1; break
                      default: return
                    }
                    event.preventDefault()
                    /** 中文说明：设置局部值 nextRow，由紧邻初始化决定。 */
                    const nextRow = rows[nextIndex] as PluginsSettingsTabEntry
                    /** 中文说明：设置局部值 nextTab，由紧邻初始化决定。 */
                    const nextTab = tabRefs.current[nextIndex] as HTMLButtonElement
                    setActiveId(nextRow.id)
                    nextTab.focus()
                  }}
                >
                  {row.label}
                </button>
              )
            })}
          </div>
          {rows
            .filter(row => row.id === active || visitedIds.has(row.id))
            .map((row) => {
              /** 中文说明：设置局部值 selected，由紧邻初始化决定。 */
              const selected = row.id === active
              return (
                <div
                  key={row.id}
                  id={`${tabsId}-panel-${row.id}`}
                  className={css.panel}
                  role="tabpanel"
                  aria-labelledby={`${tabsId}-tab-${row.id}`}
                  hidden={!selected}
                >
                  {renderSlot('settings.plugins.tab', {}, { only: row.id })}
                </div>
              )
            })}
        </>
      )}
    </div>
  )
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  /** 中文说明：类型或类 LocaleNamespaceMap 约束设置数据或组件职责。 */
  interface LocaleNamespaceMap {
    /** Plugins section, configurable-tab, and card copy. */
    'settings.plugins': PluginsSettingsLocaleKey
  }
}
