/**
 * 文件职责：渲染普通命令节点，并为手动压缩命令提供专用生命周期卡片。
 * 技术维度：使用 React memo/useMemo、键控插槽和命令数据判别类型。
 * 产品维度：让插件可按命令名定制显示，同时为未知命令保留通用卡片。
 * 逻辑维度：普通命令构造 owner 并渲染键控插槽；手动压缩拆出 command/compaction 传给专用组件。
 * 关键边界：缺失命令名使用空键；compaction 为 null 时不得传递该属性。
 * 新手阅读建议：先看 Props 类型，再比较两个 memo 组件的 owner 数据和回退路径。
 */
import { memo, useMemo } from 'react'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  ChatNodeViewProps, CommandRowOwnerProps,
} from '../contract/slots.ts'
import { CompactionCommandCard } from './CompactionCommandCard.tsx'
import { GenericCommandCard } from './GenericCommandCard.tsx'
import css from './ChatView.module.css'

// 普通命令节点所需属性；合并聊天节点和命令视图插槽渲染能力。
type CommandNodeViewProps = ChatNodeViewProps<'command'> & PropsRenderSlots<'conversation.chat.commandview'>

/** Ordinary command lifecycle renderer with command-name keyed specialization. */
/** 按命令名渲染普通命令生命周期，并允许键控插件覆盖。 */
export const CommandNodeView = memo(function CommandNodeView({ node, renderSlot, t }: CommandNodeViewProps) {
  // 当前命令生命周期数据。
  const command = node.data
  // 传给命令卡片和插槽的稳定 owner；仅 command 改变时重建。
  const owner = useMemo<CommandRowOwnerProps>(() => ({ node: command }), [command])
  return (
    <div className={css.callRow}>
      {renderSlot('conversation.chat.commandview', owner, {
        entryKey: command.name ?? '',
        fallback: <GenericCommandCard {...owner} t={t} />,
      })}
    </div>
  )
})

/** One integrated `/compact` command and compaction transaction renderer. */
/** 渲染集成的 /compact 命令和对应压缩事务。 */
export const ManualCompactionNodeView = memo(function ManualCompactionNodeView({
  node, t,
}: ChatNodeViewProps<'manual-compaction'>) {
  // 手动压缩节点数据，包含命令和可选压缩事务。
  const data = node.data
  return (
    <div className={css.callRow}>
      <CompactionCommandCard
        node={data.command}
        {...data.compaction === null ? {} : { compaction: data.compaction }}
        t={t}
      />
    </div>
  )
})
