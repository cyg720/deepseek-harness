/** 轨迹中的已加载历史台账；不推断每次请求的有效上下文窗口。 */
import { useLayoutEffect, useState, type ReactNode } from 'react'
import type { ConversationNode, RenderMessageImages } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { AssistantContent, RecordedContent } from './Content.tsx'
import { ToolCall } from './ToolCall.tsx'
import css from './trajectory.module.css'

type Media = { renderImages: RenderMessageImages; focusPath?: ReadonlySet<string> | undefined }

type Translate = TranslateNS<'qs-ui-trajectory'>

function Body({ node, t, renderImages, focusPath }: { node: ConversationNode; t: Translate } & Media): ReactNode {
  switch (node.kind) {
    case 'user': case 'steering': case 'context': return <RecordedContent blocks={node.content} t={t} renderImages={renderImages} />
    case 'assistant': return <AssistantContent blocks={node.blocks} t={t} renderImages={renderImages} />
    case 'tool-result': return <><h4>{node.call?.name ?? node.callId}</h4><p>{t(node.isError ? 'record.error' : 'record.result')}</p>
      <RecordedContent blocks={node.content} t={t} renderImages={renderImages} />
      {node.subCalls.map(call => <ToolCall key={call.callId} call={call} t={t} renderImages={renderImages} focusPath={focusPath} />)}</>
    case 'compaction': return <pre>{node.summary ?? t('missing')}</pre>
    // 请求与终止状态在请求卡展示；其他投影类型暂不冒充可读消息。
    default: return <p>{t('record.unsupported')}</p>
  }
}

function Record({ node, t, renderImages, expandedRecords, focused, focusPath }: {
  node: ConversationNode
  focused: boolean
  t: Translate
  expandedRecords: Set<number>
} & Media): ReactNode {
  const [expanded, setExpanded] = useState(() => expandedRecords.has(node.seq))
  useLayoutEffect(() => {
    if (focused) { setExpanded(true); expandedRecords.add(node.seq) }
  }, [focused, expandedRecords, node.seq])
  const open = expanded || focused
  const kind = node.kind === 'user' || node.kind === 'assistant' || node.kind === 'context' || node.kind === 'steering'
    || node.kind === 'tool-result' || node.kind === 'compaction' ? node.kind : 'other'
  return <details open={open} className={css.card} data-qs-trajectory-record={node.seq} data-qs-tool-call={node.kind === 'tool-result' ? node.callId : undefined}
    onToggle={(event) => {
      const open = event.currentTarget.open
      setExpanded(open)
      if (open) expandedRecords.add(node.seq)
      else expandedRecords.delete(node.seq)
    }}>
    <summary>{t(`record.${kind}`)} · {node.seq}</summary>
    {open && <Body node={node} t={t} renderImages={renderImages} focusPath={focusPath} />}
  </details>
}

/**
 * 按官方投影顺序呈现已加载历史，正文在展开后挂载。
 * @param props - 已加载节点与当前本地化词典。
 * @returns 带明确历史范围说明的只读台账。
 */
export function History({ nodes, t, renderImages, expandedRecords, focusSeq, focusPath }: {
  nodes: readonly ConversationNode[]
  focusSeq?: number | undefined
  t: Translate
  expandedRecords: Set<number>
} & Media): ReactNode {
  if (nodes.length === 0) return null
  return <section aria-label={t('record.title')} data-qs-trajectory-history>
    <h3>{t('record.title')}</h3><p className={css.notice}>{t('record.scope')}</p>
    {nodes.map(node => <Record focused={node.seq === focusSeq} focusPath={focusPath} expandedRecords={expandedRecords}
      key={node.seq} node={node} t={t} renderImages={renderImages} />)}
  </section>
}
