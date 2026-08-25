/**
 * 文件职责：把助手步骤节点转换为支持流式、完成和中断状态的 Markdown 消息视图。
 * 技术维度：使用 React memo/useMemo、会话插槽类型和稳定键控渲染实例。
 * 产品维度：持续展示助手回答，并在最终节点关闭时补充可点击文件引用。
 * 逻辑维度：提取节点数据和回合，读取回合尾部，计算最终所有者与文件提及，再渲染 Markdown。
 * 关键边界：只有关闭回合且 finalNode 与 closing 序号一致时才生成 owner；其他状态不解析文件提及。
 * 新手阅读建议：先看 data/turn/tail，再理解 owner 的两个提前返回，最后看 mentions 和渲染属性。
 */
import { memo, useMemo } from 'react'
import type { ChatNodeViewProps, TurnTailOwnerProps } from '../contract/slots.ts'
import { AssistantMarkdown } from './AssistantMarkdown.tsx'

/** Streaming, settled, and interrupted Assistant states share one keyed renderer instance. */
/* 流式、完成和中断助手状态共享同一键控组件实例，避免状态切换时丢失渲染上下文。 */
export const AssistantNodeView = memo(function AssistantNodeView({
  node, useTurnData, openFile, renderMessageImages, fileMentions, t,
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
  return (
    <AssistantMarkdown
      blocks={data.blocks}
      streaming={data.status === 'running'}
      interrupted={data.status === 'interrupted'}
      renderMessageImages={renderMessageImages}
      mentions={mentions}
      t={t}
    />
  )
})
