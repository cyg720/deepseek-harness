// Only a structured checkpoint uses the compaction marker; all other outcomes
// retain the command's complete settlement text.

import type { ChatViewSlotProps, CommandRowOwnerProps } from '../contract/slots.ts'
import { CompactionItem } from './CompactionItem.tsx'
import { GenericCommandCard } from './GenericCommandCard.tsx'

// 组件输入属性；继承命令行所有者数据，并额外要求本地化函数 t。
interface CompactionCommandCardProps extends CommandRowOwnerProps {
  // 文案翻译函数；取值与 ChatViewSlotProps.t 完全一致，不应在组件内替换实现。
  t: ChatViewSlotProps['t']
}

/** Render one manual compaction lifecycle without duplicating its checkpoint marker. */
/*
 * 渲染一次手动压缩生命周期。
 * @param node 命令行节点。
 * @param compaction 可选压缩检查点节点。
 * @param t 翻译函数。
 * @returns 对应当前状态的 React 元素。
 * @example <CompactionCommandCard node={node} compaction={null} t={t} />。
 */
export function CompactionCommandCard({ node, compaction, t }: CompactionCommandCardProps) {
  if (compaction !== undefined) {
    return (
      <CompactionItem
        node={compaction}
        title={t('message.compaction.commandTitle')}
        fallbackSummary={node.outcome?.text ?? null}
        t={t}
      />
    )
  }
  if (node.outcome !== null) return <GenericCommandCard node={node} t={t} />
  return <GenericCommandCard node={node} t={t} runningSummary={t('message.compaction.running')} />
}
