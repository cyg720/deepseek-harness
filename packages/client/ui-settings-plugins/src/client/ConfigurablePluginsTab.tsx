/**
 * Configurable Host plugins contributed to the shared Plugins section.
 *
 * The tab enumerates settings namespaces but never interprets one — a card
 * arrives through `settings.plugin.item` keyed by the namespace it edits, so a
 * plugin that ships a browser half owns its own card and this tab only decides
 * which keys to dispatch.
 */
/**
 * 文件职责：枚举宿主声明的可配置插件命名空间，并通过键控插槽渲染各插件自有设置卡。
 * 技术维度：使用 React Fragment、状态 hook、键控 renderSlot 和组合插槽属性类型。
 * 产品维度：让新增插件自行贡献设置界面，而公共标签页无需理解具体配置字段。
 * 逻辑维度：读取 loaded/namespaces；有命名空间时逐键分发卡片，无项且加载完成时显示空文案，否则返回 null。
 * 关键边界：列表身份必须使用命名空间而非位置；标签页不能解释或修改插件设置内容。
 * 新手阅读建议：先看 Props 四类能力，再看 namespaces.length 分支，最后理解 loaded 对空状态的影响。
 */

import { Fragment } from 'react'
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from './slot-contract.ts'
import type { ConfigurablePluginsTabFace } from './tab-store.ts'
import css from './PluginsSettingsSection.module.css'

/** Props the renderer binds for the configurable tab. */
/** 渲染器绑定的运行时、本地化、卡片插槽和标签页状态属性。 */
export type ConfigurablePluginsTabProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.plugins'>
  & PropsRenderSlots<'settings.plugin.item'>
  & InjectFace<ConfigurablePluginsTabFace>

/**
 * Render cards registered by plugins that expose editable settings.
 * @param props - locale copy, slot rendering, and the namespaces to dispatch.
 * @returns the card list, or the empty line once the Host has answered.
 */
/** 渲染可配置插件标签。@param props 文案、插槽渲染和命名空间状态。@returns 卡片列表、空文案或加载中的 null。@example <ConfigurablePluginsTab {...props} />。 */
export function ConfigurablePluginsTab(props: ConfigurablePluginsTabProps) {
  // 翻译函数与键控插槽渲染器。
  const { t, renderSlot } = props
  // 宿主是否已回答以及可配置插件命名空间顺序列表。
  const { loaded, namespaces } = props.useConfigurablePlugins(snapshot => snapshot)
  if (namespaces.length > 0) {
    return (
      <ul className={css.cards}>
        // 当前插件设置命名空间，既作为 React key 也作为插槽 entryKey。
        {namespaces.map(ns => (
          // One dispatch per namespace, so the list identity is the namespace
          // rather than a position that shifts as cards arrive.
          // 每个命名空间只分发一次；用稳定命名空间作为身份，避免卡片到达时位置变化。
          <Fragment key={ns}>{renderSlot('settings.plugin.item', {}, { entryKey: ns })}</Fragment>
        ))}
      </ul>
    )
  }
  return loaded ? <p className={css.empty}>{t('empty')}</p> : null
}
