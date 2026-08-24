/**
 * Shell chrome content registered into the shell's trigger/header seats: the
 * trigger row icon + label (figma sidebar foot) and the panel title text.
 * The shell renders the surrounding chrome (button, nav heading row) and
 * reads each entry's `label` option for aria text.
 */
/**
 * 文件职责：提供设置 Shell 触发器、面板标题和关闭按钮的本地化内容节点。
 * 技术维度：使用 React 片段、组合插槽属性、响应式宽栏状态和图标组件。
 * 产品维度：在侧栏窄/宽模式与设置面板中展示一致图标和可访问文案。
 * 逻辑维度：TriggerContent 按 wide 选择图标和标签；HeaderContent/CloseLabel 分别返回翻译文本。
 * 关键边界：外围按钮、导航标题和 aria 属性由 Shell 渲染；本文件只贡献内部内容。
 * 新手阅读建议：先看三个 Props 类型，再比较三个函数各自使用哪些字段和翻译键。
 */
import { IconSettingsOutline14, IconSettingsOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './chrome.module.css'

/** Trigger content props: the sidebar column state + the standard locale seat. */
/** 设置触发器属性：侧栏运行时状态和标准设置本地化。 */
export type TriggerContentProps = PropsRuntime<'settings.trigger'> & PropsLocale<'settings'>

/** Header content props: the standard locale seat only. */
/** 设置面板标题属性：运行时标题插槽和标准本地化。 */
export type HeaderContentProps = PropsRuntime<'settings.header'> & PropsLocale<'settings'>

/**
 * Render the trigger row content (icon; label only in the wide column).
 * @param props - composed slot props.
 * @returns the trigger content fragment.
 */
/** 渲染触发器内容。@param wide 是否宽侧栏。@param t 翻译函数。@returns 图标及可选标签。@example <TriggerContent wide t={t} />。 */
export function TriggerContent({ wide, t }: TriggerContentProps) {
  return (
    <>
      {wide ? <IconSettingsOutline16 size={16} /> : <IconSettingsOutline14 size={18} />}
      {wide && <span className={css.triggerLabel}>{t('trigger')}</span>}
    </>
  )
}

/**
 * Render the panel title text.
 * @param props - composed slot props.
 * @returns the title text node.
 */
/** 渲染面板标题。@param t 翻译函数。@returns title 文本节点。@example <HeaderContent t={t} />。 */
export function HeaderContent({ t }: HeaderContentProps) {
  return <>{t('title')}</>
}

/** Close-button label text props: the standard locale seat only. */
/** 关闭按钮隐藏标签属性：关闭插槽运行时和标准本地化。 */
export type CloseLabelProps = PropsRuntime<'settings.close'> & PropsLocale<'settings'>

/**
 * Render the close button's visually-hidden label text.
 * @param props - composed slot props.
 * @returns the label text node.
 */
/** 渲染关闭标签。@param t 翻译函数。@returns close 文本节点。@example <CloseLabel t={t} />。 */
export function CloseLabel({ t }: CloseLabelProps) {
  return <>{t('close')}</>
}
