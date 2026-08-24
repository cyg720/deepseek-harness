// CompactionCommandCard: the `/compact` command's running row and its
// successful checkpoint disclosure. Outcomes without a checkpoint keep the
// generic command card so no-history, cancellation, and failures retain their
// complete handler-authored text.
// 文件职责：渲染 /compact 命令的运行状态、成功检查点或通用结果卡片。
// 技术维度：使用 React TSX、判别式条件渲染和共享的会话视图插槽类型。
// 产品维度：让用户看到压缩进度与成功生成的检查点，同时保留取消、失败等完整提示。
// 逻辑维度：优先渲染压缩检查点，其次渲染已结束的通用卡片，最后渲染带运行摘要的通用卡片。
// 关键边界：只有存在 compaction 节点时才展示 CompactionItem，避免重复显示检查点标记。
// 新手阅读建议：先看 Props 中三个输入，再按函数中的三个 return 分支理解界面状态。

import type { ChatViewSlotProps, CommandRowOwnerProps } from '../contract/slots.ts'
import { CompactionItem } from './CompactionItem.tsx'
import { GenericCommandCard } from './GenericCommandCard.tsx'

// 组件输入属性；继承命令行所有者数据，并额外要求本地化函数 t。
interface CompactionCommandCardProps extends CommandRowOwnerProps {
  // 文案翻译函数；取值与 ChatViewSlotProps.t 完全一致，不应在组件内替换实现。
  t: ChatViewSlotProps['t']
}

/** Render one manual compaction lifecycle without duplicating its checkpoint marker. */
/**
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
        title="compact"
        fallbackSummary={node.outcome?.text ?? null}
        t={t}
      />
    )
  }
  if (node.outcome !== null) return <GenericCommandCard node={node} t={t} />
  return <GenericCommandCard node={node} t={t} runningSummary={t('message.compaction.running')} />
}
