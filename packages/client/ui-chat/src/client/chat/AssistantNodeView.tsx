import { memo, useCallback, useMemo } from 'react'
import type { ChatNodeViewProps, TurnTailOwnerProps } from '../contract/slots.ts'
import { AssistantMarkdown } from './AssistantMarkdown.tsx'

/** Streaming, settled, and interrupted Assistant states share one keyed renderer instance. */
/* 流式、完成和中断助手状态共享同一键控组件实例，避免状态切换时丢失渲染上下文。 */
export const AssistantNodeView = memo(function AssistantNodeView({
  node, useTurnData, turnProcess, openFile, renderMessageImages, fileMentions, t,
}: ChatNodeViewProps<'assistant-step'>) {
  // 当前助手步骤的数据，包括内容块、状态和可选最终节点。
  const data = node.data
  // 节点所在回合；只有 turn 或 step 位置包含，其他位置为 undefined。
  const turn = node.location.kind === 'turn' || node.location.kind === 'step'
    ? node.location.turn
    : undefined
  // 当前回合尾部投影，用于确认最终节点属于正在关闭的回合。
  const tail = useTurnData('turn-tail')
  // 可供文件引用解析器使用的最终回合所有者；条件不完整时保持 undefined。
  const owner = useMemo<TurnTailOwnerProps | undefined>(() => {
    if (turn?.status !== 'closed' || data.finalNode === undefined) return undefined
    if (tail?.closing?.finalNode.seq !== data.finalNode.seq) return undefined
    return { turn, seq: data.finalNode.seq, openFile }
  }, [data.finalNode, openFile, tail, turn])
  // 最终回复中的文件提及；只有 owner 确认后才计算，并随依赖缓存。
  const mentions = useMemo(
    () => owner === undefined ? undefined : fileMentions(owner),
    [fileMentions, owner],
  )
  const reasoningHidden = turnProcess !== undefined
    && turnProcess.foldable
    && turnProcess.spec.answerStep === data.step
    && turnProcess.spec.inlineReasoning
    && !turnProcess.open
  const revealProcess = useCallback(() => { turnProcess?.setOpen(true) }, [turnProcess])
  return (
    <AssistantMarkdown
      blocks={data.blocks}
      streaming={data.status === 'running'}
      interrupted={data.status === 'interrupted'}
      renderMessageImages={renderMessageImages}
      reasoningHidden={reasoningHidden}
      revealProcess={revealProcess}
      mentions={mentions}
      t={t}
    />
  )
})
