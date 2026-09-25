/** 命令历史只消费官方 command-input 节点，不把后续正文中的 /goal 当命令。 */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { GoalCommandInputData } from '@deepseek-ai/dsh-client-ui-goal/client'
import { projectUserText } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from './contract.ts'
import css from './goal.module.css'

/**
 * 呈现一条持久目标指令。
 * @param props - 行键、官方节点订阅和语言。
 * @returns 命令气泡；节点已撤销时为空。
 */
export function GoalCommandRow({ useNode, nodeKey, t }: PropsRuntime<'qs.stage.transcript.row'> & PropsLocale<'qs-ui-goal'>) {
  const node = useNode(nodeKey, value => value)
  if (node?.kind !== 'command-input') return null
  // 行槽擦除了扩展负载类型；kind 已由官方 Definition 确认。
  const data = node.data as GoalCommandInputData
  const split = data.text.search(/\s/u)
  const head = split === -1 ? data.text : data.text.slice(0, split)
  const rest = split === -1 ? '' : data.text.slice(split)
  return <div className={css.commandRow} role="group" aria-label={t('command')} data-qs-goal-command>
    <div className={css.bubble}>{projectUserText(head, [], ['goal'], 'command')}{rest !== '' && projectUserText(rest, [])}</div>
  </div>
}
