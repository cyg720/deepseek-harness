/** The shell plugin's card: the limits every command the agent runs is bound by. */
/**
 * 中文说明：
 * - 文件职责：渲染 Shell 插件设置卡片，编辑命令超时和最大输出字节数。
 * - 技术维度：使用 React 函数组件、注入状态面、国际化文案和可复用 ValueField/PluginCard。
 * - 产品维度：让用户控制代理执行命令的等待上限与输出规模，降低卡死和内容过载风险。
 * - 逻辑维度：读取卡片快照，按可写性禁用字段，再把编辑、重置、保存和放弃动作交给控制器。
 * - 关键边界：两个字段都按数字校验；Host 只读时禁止编辑，具体取值范围由控制器负责。
 * - 新手阅读建议：先看 BashCardProps 的三类来源，再比较两个 ValueField 只有字段键和文案不同。
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import type { BashCardFace } from './bash-card-controller.ts'
import type {} from './slot-contract.ts'

/** Props the renderer binds for the shell card. */
/** 中文：渲染器绑定的 Shell 卡片属性，包含插槽运行时、翻译函数和控制器状态面。 */
export type BashCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<BashCardFace>

/**
 * Render the shell card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
/** 中文：渲染 Shell 配置卡片；props 提供状态和操作，返回 React 元素。示例：<BashCard {...props} />。 */
export function BashCard(props: BashCardProps) {
  /** 设置插件命名空间的翻译函数。 */
  const { t } = props
  /** Shell 卡片当前响应式快照，包含保存状态和两个字段模型。 */
  const state = props.useBashCard(snapshot => snapshot)
  /** 字段禁用标记；配置不可写时为 true。 */
  const disabled = !state.writable
  return (
    <PluginCard
      t={t}
      titleKey="bashTitle"
      descriptionKey="bashDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <ValueField
        id="plugin-config-bash-timeout"
        label={t('bashTimeoutMs')}
        hint={t('bashTimeoutMsHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        numeric
        disabled={disabled}
        {...state.timeoutMs}
        onEdit={(text) => { props.edit('timeoutMs', text) }}
        onReset={() => { props.resetField('timeoutMs') }}
      />
      <ValueField
        id="plugin-config-bash-output"
        label={t('bashMaxOutputBytes')}
        hint={t('bashMaxOutputBytesHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        numeric
        disabled={disabled}
        {...state.maxOutputBytes}
        onEdit={(text) => { props.edit('maxOutputBytes', text) }}
        onReset={() => { props.resetField('maxOutputBytes') }}
      />
    </PluginCard>
  )
}
