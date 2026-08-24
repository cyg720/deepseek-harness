/**
 * 文件职责：把用户提交的 /goal 命令输入渲染为右对齐的轨迹气泡。
 * 技术维度：使用 React memo、作用域插槽属性、国际化函数、类型化节点数据和 CSS Modules。
 * 产品维度：让目标指令在对话中与普通消息区分，并保留用户输入原文而不显示常规消息操作。
 * 逻辑维度：从节点取得 GoalCommandInputData，用本地化文本标记分组，再通过 MessageText 渲染正文。
 * 关键边界：组件假定 command-input 节点数据已由上游校验；自身不执行或更新目标。
 * 新手阅读建议：先看 PropsRuntime 如何限定节点种类，再跟踪 node.data 到 MessageText 的数据流。
 */
import { memo } from 'react'
import { MessageText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { GoalCommandInputData } from './goal-command-input.ts'
import css from './GoalCommandInputView.module.css'

// GoalCommandInputViewProps：命令输入轨迹节点的运行时属性与 goal 领域本地化能力组合。
type GoalCommandInputViewProps =
  PropsRuntime<'conversation.chat.node', 'command-input'>
  & PropsLocale<'goal'>

/** Right-aligned `/goal` input bubble without ordinary message actions. */
/**
 * GoalCommandInputView：渲染无普通消息操作的右对齐 /goal 输入气泡，并用 memo 避免无关重渲染。
 * @param props - node 携带已验证的目标命令输入数据；t 提供 goal 领域本地化文本。
 * @returns 带可访问分组标签和原始命令文本的气泡元素树。
 * @example <GoalCommandInputView node={node} t={t} />
 */
export const GoalCommandInputView = memo(function GoalCommandInputView({
  node, t,
}: GoalCommandInputViewProps) {
  // data：从命令输入节点取得的类型化目标数据，text 保存用户输入原文。
  const data: GoalCommandInputData = node.data
  return (
    <div
      className={css.row}
      data-command-input=""
      role="group"
      aria-label={t('commandInput.aria')}
    >
      <div className={css.stack}>
        <div className={css.bubble}>
          <MessageText text={data.text} />
        </div>
      </div>
    </div>
  )
})
