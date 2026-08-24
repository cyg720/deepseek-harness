// CompactionItem: the one row a landed compaction contributes to the flow.
// The conversation it shadowed on the model surface stays above it, so this
// marker reports where the model stopped seeing that history — it never
// replaces it. The framed checkpoint payload is written for the model and is
// not rendered; the disclosure shows the summary from the checkpoint's own
// cited `compaction/summary` event, and a window cut that left that event outside makes the row
// non-expandable rather than empty.
/**
 * 文件职责：实现会话聊天界面的 CompactionItem 组件。
 * 技术维度：React、TypeScript、Cordis 插槽和 CSS Modules。
 * 产品维度：向用户展示并操作会话聊天相关状态。
 * 逻辑维度：读取属性与状态，派生展示数据并响应交互。
 * 关键边界：异步状态、可访问性标签和空数据分支必须保持一致。
 * 新手阅读建议：先读 Props，再看局部状态、effect 和 JSX。
 */

import { memo, useState } from 'react'
import type { CompactionSummaryNode } from '@deepseek-ai/dsh-client-runtime/client'
import {
  IconApiOutline14,
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  MarkdownText,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import css from './MessageItem.module.css'

/** 中文说明：类型或类 CompactionItemProps 约束本文件的数据或组件职责。 */
interface CompactionItemProps {
  node: CompactionSummaryNode
  /** Optional command title for a manual compaction folded into this marker. */
  title?: string
  /** Command settlement text used when structured compaction counts are unavailable. */
  fallbackSummary?: string | null
  /** The owning view's locale seat. */
  t: ChatViewSlotProps['t']
}

/**
 * The collapsed-by-default compaction marker.
 * @param props - the marker node off the snapshot cache.
 * @returns the marker row, with the summary disclosure when one is available.
 */
/** 中文说明：当前组件的局部值 CompactionItem，由紧邻初始化决定。 */
export const CompactionItem = memo(function CompactionItem({
  node,
  title,
  fallbackSummary,
  t,
}: CompactionItemProps) {
  /** 中文说明：当前组件的局部值 [expanded, setExpanded]，由紧邻初始化决定。 */
  const [expanded, setExpanded] = useState(false)
  /** 中文说明：当前组件的局部值 expandable，由紧邻初始化决定。 */
  const expandable = node.summary !== null
  /** 中文说明：当前组件的局部值 open，由紧邻初始化决定。 */
  const open = expandable && expanded
  /** 中文说明：当前组件的局部值 summary，由紧邻初始化决定。 */
  const summary = node.shadowedItemCount !== null && node.shadowedTokenCount !== null
    ? t('message.compaction.completed', {
      items: node.shadowedItemCount,
      tokens: node.shadowedTokenCount,
    })
    : fallbackSummary
      ?? (expandable ? t('message.compaction.expand') : t('message.compaction.unavailable'))
  return (
    <div className={css.compactionRow}>
      <button
        type="button"
        className={css.compactionButton}
        disabled={!expandable}
        aria-expanded={expandable ? open : undefined}
        onClick={() => { setExpanded(value => !value) }}
      >
        <span className={css.compactionLeading} aria-hidden>
          <span className={css.compactionContextIcon} data-compaction-icon="context">
            <IconApiOutline14 />
          </span>
          <span
            className={css.compactionDisclosureIcon}
            data-compaction-disclosure={open ? 'expanded' : 'collapsed'}
          >
            {open ? <IconChevronDownOutline14 /> : <IconChevronRightOutline14 />}
          </span>
        </span>
        <span className={css.compactionTitle}>{title ?? t('message.compaction')}</span>
        <span className={css.compactionSep} aria-hidden />
        <span className={css.compactionSummary}>{summary}</span>
      </button>
      {open && node.summary !== null
        && <div className={css.compactionBody}><MarkdownText text={node.summary} /></div>}
    </div>
  )
})
