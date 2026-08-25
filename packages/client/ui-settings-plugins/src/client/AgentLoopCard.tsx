/** The agent loop's card: how many tool calls one step may run at once. */
/*
 * 文件职责：渲染代理循环插件设置卡，编辑单步最大并行工具调用数。
 * 技术维度：使用 React、客户端插槽属性组合、状态 hook 和可复用 ValueField。
 * 产品维度：让用户调节代理并行度，在速度与资源占用之间选择。
 * 逻辑维度：从 props 取得翻译和快照，把保存/放弃动作交给 PluginCard，把字段编辑/重置交给 ValueField。
 * 关键边界：不可写状态禁用输入；数值合法性和覆盖来源由控制器状态负责。
 * 新手阅读建议：先看 AgentLoopCardProps 三类组合，再跟踪 state 到 PluginCard 和 ValueField 的映射。
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import type { AgentLoopCardFace } from './agent-loop-card-controller.ts'
import type {} from './slot-contract.ts'

/** Props the renderer binds for the agent-loop card. */
/* 渲染器为代理循环卡绑定的运行时、本地化和控制器属性。 */
export type AgentLoopCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<AgentLoopCardFace>

/**
 * Render the agent-loop card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
/* 渲染代理循环卡。@param props 文案、快照和表单动作。@returns 插件设置卡 React 元素。@example <AgentLoopCard {...props} />。 */
export function AgentLoopCard(props: AgentLoopCardProps) {
  // 当前命名空间翻译函数。
  const { t } = props
  // 代理循环卡完整快照；选择器返回当前状态本身。
  const state = props.useAgentLoopCard(snapshot => snapshot)
  return (
    <PluginCard
      t={t}
      titleKey="agentLoopTitle"
      descriptionKey="agentLoopDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <ValueField
        id="plugin-config-agent-loop-parallel"
        label={t('agentLoopMaxParallel')}
        hint={t('agentLoopMaxParallelHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        numeric
        disabled={!state.writable}
        {...state.maxParallelToolCalls}
        // text 是用户输入的新并行数文本，交给控制器解析和校验。
        onEdit={(text) => { props.edit('maxParallelToolCalls', text) }}
        onReset={() => { props.resetField('maxParallelToolCalls') }}
      />
    </PluginCard>
  )
}
