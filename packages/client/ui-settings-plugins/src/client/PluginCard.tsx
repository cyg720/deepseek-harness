/**
 * One plugin's card: a header naming the plugin and what its settings govern,
 * disclosing that plugin's controls in place, with the save that writes them.
 *
 * The header is its own button rather than a shared disclosure row because a
 * card stacks its name over its description, while that row lays the two side
 * by side — the layout, not the behavior, is what differs. Disclosure is
 * card-local state: which card a user has open is a reading gesture, not
 * something the Host or the section has any stake in. Staged edits outlive
 * collapsing, so the header marks a card holding unsaved edits.
 *
 * A card renders nothing while its namespace is unavailable: a deployment that
 * does not compose the owning plugin should show no trace of it, rather than a
 * disabled card the user cannot act on.
 */
/*
 * 文件职责：实现插件配置的 PluginCard 组件。
 * 技术维度：React、TypeScript、受控表单、Cordis 插槽和 CSS Modules。
 * 产品维度：帮助用户查看和调整插件配置。
 * 逻辑维度：读取状态，编辑草稿，调用保存或发现操作并展示结果。
 * 关键边界：界面可见信息不代表授权；密钥只显示配置状态，不显示原值。
 * 新手阅读建议：先读 Props 和状态类型，再看事件处理与 JSX。
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CardShell } from './card-form.ts'
import type { PluginsSettingsLocaleKey } from './locales.ts'
import css from './PluginCard.module.css'

/** Card chrome shared by every plugin section. */
/* 中文说明：类型或类 PluginCardProps 约束设置数据或组件职责。 */
export interface PluginCardProps {
  /** Locale reader for this section's copy. */
  t: (key: PluginsSettingsLocaleKey) => string
  /** Locale key of the plugin's name. */
  titleKey: PluginsSettingsLocaleKey
  /** Locale key of the line describing what this plugin's settings govern. */
  descriptionKey: PluginsSettingsLocaleKey
  /** The card's form state: availability, writability, and what a save would do. */
  state: CardShell
  /** Write every staged edit. */
  onSave: () => void
  /** Drop every staged edit. */
  onDiscard: () => void
  /** The plugin's controls. */
  children: ReactNode
}

/**
 * Render one plugin card.
 * @param props - the plugin's copy keys, its form state, and its controls.
 * @returns the card, or nothing when the namespace is unavailable.
 */
/* 中文说明：函数 PluginCard 的参数见签名，返回结果供设置流程使用；示例见本文件。 */
export function PluginCard(props: PluginCardProps) {
  /** 中文说明：设置局部值 [open, setOpen]，由紧邻初始化决定。 */
  const [open, setOpen] = useState(false)
  const saveStarted = useRef(false)
  const { state } = props
  // Collapse only after Host-confirmed settlement; a rejected write keeps its
  // diagnostics and retained drafts visible for correction.
  useEffect(() => {
    if (state.saving) {
      saveStarted.current = true
      return
    }
    if (!saveStarted.current) return
    saveStarted.current = false
    if (!state.dirty && !state.failed) setOpen(false)
  }, [state.dirty, state.failed, state.saving])
  if (!state.available) return null
  /** 中文说明：设置局部值 title，由紧邻初始化决定。 */
  const title = props.t(props.titleKey)
  /** 中文说明：设置局部值 blocked，由紧邻初始化决定。 */
  const blocked = !state.dirty || state.invalid || state.saving
  return (
    <li className={clsx(css.card, open && css.cardOpen)}>
      <button
        type="button"
        className={css.header}
        aria-expanded={open}
        aria-label={`${props.t(open ? 'collapse' : 'expand')}: ${title}`}
        onClick={() => { setOpen(!open) }}
      >
        <span className={css.headText}>
          <span className={css.name}>{title}</span>
          <span className={css.description}>{props.t(props.descriptionKey)}</span>
        </span>
        {state.dirty ? <span className={css.pending}>{props.t('unsaved')}</span> : null}
        <IconChevronDownOutline14 className={clsx(css.chevron, open && css.chevronOpen)} />
      </button>
      {open
        ? (
          <div className={css.body}>
            {!state.writable ? <p className={css.readOnly} role="status">{props.t('readOnly')}</p> : null}
            {props.children}
            <div className={css.footer}>
              {state.failed ? <p className={css.failed} role="status">{props.t('saveFailed')}</p> : null}
              <button
                type="button"
                className={css.discard}
                disabled={!state.dirty || state.saving}
                onClick={props.onDiscard}
              >
                {props.t('discard')}
              </button>
              <button
                type="button"
                className={css.save}
                disabled={blocked}
                onClick={props.onSave}
              >
                {props.t(state.saving ? 'saving' : 'save')}
              </button>
            </div>
          </div>
        )
        : null}
    </li>
  )
}
