// AssistantMarkdown: renders assistant blocks in order — markdown text body,
// reasoning as the figma Think summary row (expand = indented gray text),
// other-block JSON fallback. Tool-call heads are NOT rendered here: the chat
// view groups them into tool rows through its keyed toolview slot (figma
// step-summary flow). Shared by finalized nodes and the streaming partial;
// the turn-level loading dots live in the chat view's tail, not here.
// Finalized content (text) nodes append IconActions once their turn ends
// (`time` is omitted for mid-turn narration and while the turn still runs);
// their branch action is enabled only when the node is also the completed
// turn's transcript tail. Think / tool-head-only nodes stay chrome-free.
/**
 * 文件职责：实现会话聊天界面的 AssistantMarkdown 组件。
 * 技术维度：React、TypeScript、Cordis 插槽和 CSS Modules。
 * 产品维度：向用户展示并操作会话聊天相关状态。
 * 逻辑维度：读取属性与状态，派生展示数据并响应交互。
 * 关键边界：异步状态、可访问性标签和空数据分支必须保持一致。
 * 新手阅读建议：先读 Props，再看局部状态、effect 和 JSX。
 */

import { Fragment, memo, useMemo } from 'react'
import type { ReactNode } from 'react'
import type { AssistantBlock } from '@deepseek-ai/dsh-client-runtime/client'
import { JsonBlock, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownFileMentions } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatNodeOwnerProps, ChatViewSlotProps } from '../contract/slots.ts'
import { ReasoningRow } from './ReasoningRow.tsx'
import css from './AssistantMarkdown.module.css'

/** 中文说明：类型或类 AssistantMarkdownProps 约束本文件的数据或组件职责。 */
export interface AssistantMarkdownProps {
  blocks: readonly AssistantBlock[]
  streaming: boolean
  /** Frozen partial of an aborted turn: rendered with a stopped marker. */
  interrupted?: boolean | undefined
  /** Render consecutive image blocks through the attachment slot. */
  renderMessageImages: ChatNodeOwnerProps['renderMessageImages']
  /** Resolved prose file mentions for this Assistant's closing turn. */
  mentions?: MarkdownFileMentions | undefined
  /** The owning view's locale seat, passed down as a plain prop. */
  t: ChatViewSlotProps['t']
}

/** Reasoning block as the Think variant summary row (figma 39:28304). */
/** 中文说明：当前组件的局部值 AssistantMarkdown，由紧邻初始化决定。 */
export const AssistantMarkdown = memo(function AssistantMarkdown({
  blocks, streaming, interrupted, renderMessageImages, mentions, t,
}: AssistantMarkdownProps) {
  // Stable per locale revision (t identity changes on switch): a fresh object
  // per render would rebuild MarkdownText's component table every chunk.
  /** 中文说明：当前组件的局部值 codeLabels，由紧邻初始化决定。 */
  const codeLabels = useMemo(() => ({ copyLabel: t('copy'), copiedLabel: t('copied') }), [t])
  /** 中文说明：当前组件的局部值 last，由紧邻初始化决定。 */
  const last = blocks.length - 1
  // Tool-call heads render as tool rows in the chat view's grouping pass, so
  // a node that is only those heads (or empty) would paint an empty root
  // between tool groups — skip the shell unless something visible remains.
  /** 中文说明：当前组件的局部值 hasVisible，由紧邻初始化决定。 */
  const hasVisible = streaming
    || interrupted === true
    || blocks.some(block => block.kind !== 'tool-call')
  if (!hasVisible) return null
  /** 中文说明：当前组件的局部值 rendered，由紧邻初始化决定。 */
  const rendered: ReactNode[] = []
  /** 中文说明：当前组件的局部值 i，由紧邻初始化决定。 */
  for (let i = 0; i < blocks.length; i++) {
    /** 中文说明：当前组件的局部值 block，由紧邻初始化决定。 */
    const block = blocks[i]
    if (block === undefined) continue
    switch (block.kind) {
      case 'text':
        rendered.push(
          <MarkdownText
            key={i}
            text={block.text}
            streaming={streaming}
            codeLabels={codeLabels}
            fileMentions={mentions}
          />,
        )
        break
      case 'reasoning':
        rendered.push(<ReasoningRow key={i} text={block.text} running={streaming && i === last} t={t} />)
        break
      case 'image': {
        // Consecutive image blocks share one gallery so several images tile
        // into rows instead of each opening a one-image group of its own.
        // Keyed by the group's FIRST block index: a streaming append that
        // extends the group then only grows `images` instead of remounting
        // the gallery under a shifted key.
        /** 中文说明：当前组件的局部值 start，由紧邻初始化决定。 */
        const start = i
        /** 中文说明：当前组件的局部值 group，由紧邻初始化决定。 */
        const group = [block]
        while (i + 1 < blocks.length) {
          /** 中文说明：当前组件的局部值 next，由紧邻初始化决定。 */
          const next = blocks[i + 1]
          if (next === undefined || next.kind !== 'image') break
          group.push(next)
          i += 1
        }
        rendered.push(
          <Fragment key={start}>
            {renderMessageImages({
              images: group.map(({ attachment }) => ({ attachment })),
              align: 'start',
            })}
          </Fragment>,
        )
        break
      }
      // Grouped into tool rows by ChatView; hasVisible above skips an empty shell.
      case 'tool-call':
        break
      default:
        rendered.push(
          <JsonBlock
            key={i}
            label={t('message.unknownBlock')}
            payload={block.block}
            truncatedLabel={total => t('json.truncated', { total })}
          />,
        )
    }
  }
  return (
    <div className={css.root} data-streaming={streaming || undefined}>
      <div className={css.body}>
        {rendered}
        {interrupted && <span className={css.stopped}>{t('message.stopped')}</span>}
      </div>
    </div>
  )
})
