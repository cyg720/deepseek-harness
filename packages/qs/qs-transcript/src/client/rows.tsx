import { CommandRow } from './command-row.tsx'
import { CompactionRow, ManualCompactionRow } from './compaction-rows.tsx'
/**
 * 转写行组件。
 *
 * 每个行组件只订阅自己那一行：数据来自宿主显式传入的 `useNode` 座席
 * （父 entry 的 keyedHooks 绑定结果），**不做手工 subscribe**，也不触发全量重转。
 * `node.kind` 上的判别式把这行的负载收窄到对应类型，不需要断言。
 */
import type { RowKey } from './adapter.ts'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { ChatConversationViewNode, ChatNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { FileTypeIcon, fileExtension, fileSizeText, MarkdownText, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { clsx } from 'clsx'
import type { ReactNode } from 'react'
import type { PropsLocale, PropsRuntime, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { assistantLines, assistantStatusKey, assistantStepData, contentText, messageContent, visibleNode } from './adapter.ts'
import { MaxTokensRow, RetryRow, TurnErrorRow } from './diagnostic-rows.tsx'
import { QsIcon } from './Icon.tsx'
import { hasNonTextContent, historyFile, historyImages, localImageUrl } from './media.ts'
import { ProcessRow, TailRow } from './process-row.tsx'
import styles from './transcript.module.css'

/** 转写行的完整 props：owner（含座席）+ locale 座席。 */
export type QsRowProps =
  PropsRuntime<'qs.stage.transcript.row'>
  & PropsLocale<'qs-transcript'>
  & PropsRenderSlots<'qs.chat.assistant-actions' | 'qs.chat.turn-tail'>

/** 行的渲染依赖。 */
type RowRender = (props: QsRowProps) => ReactNode

/** Copy a whole message using the shared clipboard capability. */
function CopyMessage({ text, t }: { text: string; t: QsRowProps['t'] }): ReactNode {
  const [state, setState] = useState<'idle' | 'pending' | 'copied' | 'failed'>('idle')
  const generation = useRef(0)
  useEffect(() => { generation.current++; setState('idle'); return () => { generation.current++ } }, [text])
  if (text === '') return null
  return <div><button type="button" className="qs-text-button" disabled={state === 'pending'} onClick={() => {
    const current = generation.current
    setState('pending')
    void writeClipboard(text).then((ok) => {
      if (current === generation.current) setState(ok ? 'copied' : 'failed')
    })
  }}>{t(state === 'copied' ? 'row.copied' : 'row.copy')}</button>
  {state === 'failed' ? <span role="alert">{t('row.copyFailed')}</span> : null}</div>
}

/** Selects message content without exposing hidden conversation nodes. */
function selectMessageContent(value: ChatConversationViewNode | undefined) {
  const node = visibleNode(value)
  return node === undefined ? undefined : messageContent(node)
}

/** 图片以外的未知块仍保留限制提示，不能被同一消息的可见图片掩盖。 */
function MessageMedia({ data, renderMessageImages, t }: Pick<QsRowProps, 'renderMessageImages' | 't'> & {
  data: readonly unknown[]
}): ReactNode {
  const parts = useMemo(() => data.map(block => ({ file: historyFile(block), images: historyImages([block]),
    unsupported: hasNonTextContent([block]),
  })), [data])
  const attachmentCount = parts.filter(part => part.file !== undefined || part.images.length > 0).length
  return <>
    <div className={styles.attachments} data-qs-message-attachments>
      {parts.map((part, index) => part.file !== undefined
        ? <span key={index} className={styles.fileCard} title={part.file.name} data-qs-file-card>
          <FileTypeIcon path={part.file.name} />
          <span><span className={styles.fileName}>{part.file.name}</span><small>
            {[fileExtension(part.file.name).toUpperCase().slice(0, 8), fileSizeText(part.file.bytes)].filter(Boolean).join(' ')}
          </small></span>
        </span>
        : part.images.length > 0
          ? <Fragment key={index}>{renderMessageImages({ images: part.images, align: 'end', compact: attachmentCount > 1 })}</Fragment>
          : null)}
    </div>
    {parts.some(part => part.unsupported && part.file === undefined && part.images.length === 0) ? <p>{t('row.nonText')}</p> : null}
  </>
}

/** 用户消息行。 */
function UserRow({ nodeKey, useNode, renderMessageImages, t }: QsRowProps): ReactNode {
  const data = useNode(nodeKey, selectMessageContent)
  if (data === undefined) return null
  return (
    <div className={clsx(styles.message, styles.userMessage)}>
      <div className={styles.userBubble}>
        {contentText(data)}<MessageMedia data={data} renderMessageImages={renderMessageImages} t={t} />
        <CopyMessage text={contentText(data)} t={t} />
      </div>
    </div>
  )
}

/** 推理保留自身折叠状态，由官方机制处理查找揭示和焦点保护。 */
function Reasoning({ text, hidden, reveal, t, useSearchableHidden }: {
  text: string
  hidden: boolean
  reveal: () => void
  t: QsRowProps['t']
  useSearchableHidden: QsRowProps['useSearchableHidden']
}): ReactNode {
  const ref = useSearchableHidden(hidden, reveal)
  return <div ref={ref} data-qs-inline-reasoning>
    <details className={styles.disclosure}><summary>{t('row.reasoning')}</summary><div className={styles.detailBody}>{text}</div></details>
  </div>
}

/** 助手回复行：文本与推理块同源，状态可辨（生成中 / 完成 / 中断）。 */
function AssistantRow({
  nodeKey, useNode, useTurnData, fileMentions, reasoningHidden, revealProcess, useSearchableHidden, t,
}: QsRowProps): ReactNode {
  const labels = useMemo(() => ({ code: { copyLabel: t('markdown.copy'), copiedLabel: t('markdown.copied') }, footnotes: t('markdown.footnotes') }), [t])
  const pathImages = useMemo(() => ({
    resolve: (path: string) => localImageUrl(window.location.protocol, window.location.origin, path),
  }), [])
  const data = useNode(nodeKey, (value) => {
    const node = visibleNode(value)
    return node === undefined ? undefined : assistantStepData(node)
  })
  const location = useNode(nodeKey, node => node?.location)
  const turn = location?.kind === 'turn' || location?.kind === 'step' ? location.turn : undefined
  const tail = useTurnData('turn-tail')
  // 与官方一致：仅已关闭轮次的最终回答可使用文件词表，中间消息保持普通文本。
  const mentions = useMemo(() => {
    if (turn?.status !== 'closed' || data?.finalNode === undefined || tail?.closing?.finalNode.seq !== data.finalNode.seq) return undefined
    return fileMentions({ turn, seq: data.finalNode.seq })
  }, [turn, data?.finalNode, tail, fileMentions])
  if (data === undefined) return null
  const lines = assistantLines(data)
  return (
    <article className={clsx(styles.message, styles.assistantMessage)}>
      <div className={styles.aiHeading}>
        <span className={styles.aiMark}><QsIcon name="spark" size="sm" /></span>
        {t('row.assistant')}
        <small>{t(assistantStatusKey(data))}</small>
      </div>
      <div className={styles.aiContent}>
        {lines.map((line, index) => (
          line.kind === 'text'
            ? <MarkdownText key={index} text={line.text} labels={labels} pathImages={pathImages} fileMentions={mentions} streaming={data.status === 'running'} />
            : <Reasoning key={index} hidden={reasoningHidden} reveal={revealProcess}
              text={line.text} t={t} useSearchableHidden={useSearchableHidden} />
        ))}
        {data.blocks.some(block => block.kind !== 'text' && block.kind !== 'reasoning' && block.kind !== 'tool-call') ? <p>{t('row.nonText')}</p> : null}
        <CopyMessage text={lines.filter(line => line.kind === 'text').map(line => line.text).join('\n\n')} t={t} />
      </div>
    </article>
  )
}

/** 追加说明行（生成中插入的人类消息）。 */
function SteeringRow({ nodeKey, useNode, renderMessageImages, t }: QsRowProps): ReactNode {
  const data = useNode(nodeKey, selectMessageContent)
  if (data === undefined) return null
  return (
    <div className={clsx(styles.message, styles.userMessage)}>
      <div className={styles.steeringBubble}>
        <span className={styles.steeringTag}>{t('row.steering')}</span>
        {contentText(data)}
        <MessageMedia data={data} renderMessageImages={renderMessageImages} t={t} />
      </div>
    </div>
  )
}

/** Context instructions remain inspectable without occupying the conversation body. */
function ContextRow({ nodeKey, useNode, renderMessageImages, t }: QsRowProps): ReactNode {
  const data = useNode(nodeKey, selectMessageContent)
  if (data === undefined) return null
  return (
    <details className={clsx(styles.message, styles.disclosure)} data-qs-context>
      <summary>{t('row.context')}</summary>
      <div className={styles.detailBody}>
        {contentText(data)}<MessageMedia data={data} renderMessageImages={renderMessageImages} t={t} />
      </div>
    </details>
  )
}

/** System prompts use the official projected text and start collapsed. */
function SystemPromptRow({ nodeKey, useNode, t }: QsRowProps): ReactNode {
  const node = useNode(nodeKey, visibleNode)
  if (node?.kind !== 'system-prompt') return null
  const data = node.data as ChatNode<'system-prompt'>['data']
  return (
    <details className={clsx(styles.message, styles.disclosure)} data-qs-system-prompt>
      <summary>{t('row.systemPrompt')}</summary>
      <div className={styles.detailBody}>{data.text}</div>
    </details>
  )
}

/** The Turn footer reads exact accounting without repeating the closing message. */
/** Unknown payloads are serialized while open; closing releases their rendered text. */
function FallbackRow({ nodeKey, useNode, t }: QsRowProps): ReactNode {
  const node = useNode(nodeKey, visibleNode)
  const [open, setOpen] = useState(false)
  if (node === undefined) return null
  return (
    <details className={clsx(styles.message, styles.disclosure)} data-qs-unknown
      onToggle={(event) => { setOpen(event.currentTarget.open) }}>
      <summary>{t('row.unknownKind')} <code>{node.kind}</code></summary>
      {open ? <pre className={styles.detailBody}>{JSON.stringify(node.data, null, 2)}</pre> : null}
    </details>
  )
}

/** 行注册表：本地行键必须全部提供组件，遗漏由 TypeScript 拒绝。 */
export const ROW_COMPONENTS: Readonly<Record<RowKey, RowRender>> = {
  'user': UserRow,
  'steering': SteeringRow,
  'context': ContextRow,
  'assistant-step': AssistantRow,
  'system-prompt': SystemPromptRow,
  'turn-process': ProcessRow,
  'turn-tail': TailRow,
  'model-retry': RetryRow,
  'turn-error': TurnErrorRow,
  'turn-max-tokens': MaxTokensRow,
  'command': CommandRow,
  'compaction': CompactionRow,
  'manual-compaction': ManualCompactionRow,
  'unknown': FallbackRow,
}
