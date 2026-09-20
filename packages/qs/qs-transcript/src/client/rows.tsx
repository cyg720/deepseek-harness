/**
 * 转写行组件。
 *
 * 每个行组件只订阅自己那一行：数据来自宿主显式传入的 `useNode` 座席
 * （父 entry 的 keyedHooks 绑定结果），**不做手工 subscribe**，也不触发全量重转。
 * `node.kind` 上的判别式把这行的负载收窄到对应类型，不需要断言。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChatConversationViewNode, ChatNode, TurnProcessChatData, TurnTailChatData } from '@deepseek-ai/dsh-client-ui-chat/client'
import { MarkdownText, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { clsx } from 'clsx'
import type { ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { assistantLines, assistantStatusKey, assistantStepData, contentText, messageContent, visibleNode } from './adapter.ts'
import { QsIcon } from './Icon.tsx'
import { hasNonTextContent, localImageUrl } from './media.ts'
import styles from './transcript.module.css'

/** 转写行的完整 props：owner（含座席）+ locale 座席。 */
export type QsRowProps =
  PropsRuntime<'qs.stage.transcript.row'>
  & PropsLocale<'qs-transcript'>

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

/** 用户消息行。 */
function UserRow({ nodeKey, useNode, t }: QsRowProps): ReactNode {
  const data = useNode(nodeKey, selectMessageContent)
  if (data === undefined) return null
  return (
    <div className={clsx(styles.message, styles.userMessage)}>
      <div className={styles.userBubble}>{contentText(data)}{hasNonTextContent(data) ? <p>{t('row.nonText')}</p> : null}<CopyMessage text={contentText(data)} t={t} /></div>
    </div>
  )
}

/** 助手回复行：文本与推理块同源，状态可辨（生成中 / 完成 / 中断）。 */
function AssistantRow({ nodeKey, useNode, t }: QsRowProps): ReactNode {
  const labels = useMemo(() => ({ code: { copyLabel: t('markdown.copy'), copiedLabel: t('markdown.copied') }, footnotes: t('markdown.footnotes') }), [t])
  const pathImages = useMemo(() => ({
    resolve: (path: string) => localImageUrl(window.location.protocol, window.location.origin, path),
  }), [])
  const data = useNode(nodeKey, (value) => {
    const node = visibleNode(value)
    return node === undefined ? undefined : assistantStepData(node)
  })
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
            ? <MarkdownText key={index} text={line.text} labels={labels} pathImages={pathImages} streaming={data.status === 'running'} />
            : <details key={index} className={styles.disclosure}><summary>{t('row.reasoning')}</summary><div className={styles.detailBody}>{line.text}</div></details>
        ))}
        {data.blocks.some(block => block.kind !== 'text' && block.kind !== 'reasoning' && block.kind !== 'tool-call') ? <p>{t('row.nonText')}</p> : null}
        <CopyMessage text={lines.filter(line => line.kind === 'text').map(line => line.text).join('\n\n')} t={t} />
      </div>
    </article>
  )
}

/** 追加说明行（生成中插入的人类消息）。 */
function SteeringRow({ nodeKey, useNode, t }: QsRowProps): ReactNode {
  const data = useNode(nodeKey, selectMessageContent)
  if (data === undefined) return null
  return (
    <div className={clsx(styles.message, styles.userMessage)}>
      <div className={styles.steeringBubble}>
        <span className={styles.steeringTag}>{t('row.steering')}</span>
        {contentText(data)}
        {hasNonTextContent(data) ? <p>{t('row.nonText')}</p> : null}
      </div>
    </div>
  )
}

/** Context instructions remain inspectable without occupying the conversation body. */
function ContextRow({ nodeKey, useNode, t }: QsRowProps): ReactNode {
  const data = useNode(nodeKey, selectMessageContent)
  if (data === undefined) return null
  return (
    <details className={clsx(styles.message, styles.disclosure)} data-qs-context>
      <summary>{t('row.context')}</summary>
      <div className={styles.detailBody}>{contentText(data)}{hasNonTextContent(data) ? <p>{t('row.nonText')}</p> : null}</div>
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

/** A closed Turn exposes durable activity counts instead of projection metadata. */
function ProcessRow({ nodeKey, useNode, useProcess, t }: QsRowProps): ReactNode {
  const node = useNode(nodeKey, visibleNode)
  const process = useProcess(nodeKey, value => value)
  if (node?.kind !== 'turn-process' || !process?.turnClosed || !process.compactAnswer) return null
  const data = node.data as TurnProcessChatData
  return (
    <div className={clsx(styles.message, styles.processSummary)} data-qs-process>
      <span>{t('row.thought')}</span>
      {data.toolCallCount > 0 ? <span>{t('row.tools')}: {data.toolCallCount}</span> : null}
      {data.messageCount > 0 ? <span>{t('row.messages')}: {data.messageCount}</span> : null}
      {data.subagentCount > 0 ? <span>{t('row.agents')}: {data.subagentCount}</span> : null}
    </div>
  )
}

/** The Turn footer reads exact accounting without repeating the closing message. */
function TailRow({ nodeKey, useNode, t }: QsRowProps): ReactNode {
  const node = useNode(nodeKey, visibleNode)
  if (node?.kind !== 'turn-tail') return null
  const data = node.data as TurnTailChatData
  if (data.closing === null) return null
  return (
    <footer className={clsx(styles.message, styles.processSummary)} data-qs-turn-tail>
      <span>{t(assistantStatusKey(data.closing))}</span>
      {data.tokenUsage === undefined ? null : <span>{t('row.tokens')}: {data.tokenUsage.totalTokens}</span>}
    </footer>
  )
}

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

/** 行注册表：注册键 → 行组件。 */
export const ROW_COMPONENTS: Readonly<Record<string, RowRender>> = {
  'user': UserRow,
  'steering': SteeringRow,
  'context': ContextRow,
  'assistant-step': AssistantRow,
  'system-prompt': SystemPromptRow,
  'turn-process': ProcessRow,
  'turn-tail': TailRow,
  'unknown': FallbackRow,
}
