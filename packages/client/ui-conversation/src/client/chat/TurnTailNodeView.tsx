/**
 * 文件职责：实现会话聊天界面的 TurnTailNodeView 组件。
 * 技术维度：React、TypeScript、Cordis 插槽和 CSS Modules。
 * 产品维度：向用户展示并操作会话聊天相关状态。
 * 逻辑维度：读取属性与状态，派生展示数据并响应交互。
 * 关键边界：异步状态、可访问性标签和空数据分支必须保持一致。
 * 新手阅读建议：先读 Props，再看局部状态、effect 和 JSX。
 */
import { memo } from 'react'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChatNodeViewProps, TurnTailOwnerProps } from '../contract/slots.ts'
import { MessageIconActions } from './MessageIconActions.tsx'
import { assistantText } from './turn-assistant.ts'
import css from './TurnTailNodeView.module.css'

/** 中文说明：类型或类 TurnTailNodeViewProps 约束本文件的数据或组件职责。 */
type TurnTailNodeViewProps = ChatNodeViewProps<'turn-tail'>
  & PropsRenderSlots<'conversation.chat.turnTail' | 'conversation.chat.assistant-actions'>

/** Turn-local actions and feature tail over the Location index, independent of Assistant placement. */
/** 中文说明：当前组件的局部值 TurnTailNodeView，由紧邻初始化决定。 */
export const TurnTailNodeView = memo(function TurnTailNodeView({
  node, openFile, forkAt, renderSlot, renderSlotChain, t, useSession,
}: TurnTailNodeViewProps) {
  /** 中文说明：当前组件的局部值 data，由紧邻初始化决定。 */
  const data = node.data
  /** 中文说明：当前组件的局部值 hasLaterChatNode，由紧邻初始化决定。 */
  const hasLaterChatNode = useSession(snapshot =>
    snapshot.chat.locations.getTurn(data.turn).at(-1) !== node.key)
  /** 中文说明：当前组件的局部值 turn，由紧邻初始化决定。 */
  const turn = node.location.kind === 'turn' || node.location.kind === 'step'
    ? node.location.turn
    : undefined
  if (turn === undefined) return null
  /** 中文说明：当前组件的局部值 closing，由紧邻初始化决定。 */
  const closing = data.closing
  /** 中文说明：当前组件的局部值 owner，由紧邻初始化决定。 */
  const owner: TurnTailOwnerProps = { turn, seq: closing?.finalNode.seq ?? data.seq, openFile }
  /** 中文说明：当前组件的局部值 tail，由紧邻初始化决定。 */
  const tail = renderSlotChain('conversation.chat.turnTail', owner)
  if (closing === null) return tail === null ? null : <div className={css.root}>{tail}</div>
  /** 中文说明：当前组件的局部值 runMs，由紧邻初始化决定。 */
  const runMs = turn.start === undefined || turn.end === undefined
    ? undefined
    : Math.max(0, turn.end.time - turn.start.time)
  // Interruption-frozen partials carry no messageId, so they address no
  // durable message and contribute no per-message actions.
  /** 中文说明：当前组件的局部值 messageId，由紧邻初始化决定。 */
  const messageId = closing.finalNode.messageId
  /** 中文说明：当前组件的局部值 assistantActions，由紧邻初始化决定。 */
  const assistantActions = messageId === undefined
    ? null
    : renderSlot('conversation.chat.assistant-actions', { messageId })
  return (
    <div className={css.root} data-turn-tail={data.turn} data-time-hover-root>
      {tail}
      <MessageIconActions
        text={assistantText(closing.blocks)}
        time={closing.time}
        runMs={runMs}
        ttftMs={data.ttftMs}
        tokensPerSecond={data.tokensPerSecond}
        clock="end"
        onBranch={() => { forkAt(closing.finalNode.seq) }}
        branchUnavailable={data.branchUnavailable || hasLaterChatNode}
        className={css.actions}
        extraActions={assistantActions}
        t={t}
      />
    </div>
  )
})
