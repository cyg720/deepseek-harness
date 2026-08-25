// MessageItem: simple chat nodes — user and consumed-steering bubbles
// (right-aligned, with clock + copy IconActions; branch lives only under
// assistant answers), pending steering (copy only), context injection,
// compaction marker, retry disclosure, and unknown-surface JSON rows.
/**
 * 文件职责：实现会话聊天界面的 MessageItem 组件。
 * 技术维度：React、TypeScript、Cordis 插槽和 CSS Modules。
 * 产品维度：向用户展示并操作会话聊天相关状态。
 * 逻辑维度：读取属性与状态，派生展示数据并响应交互。
 * 关键边界：异步状态、可访问性标签和空数据分支必须保持一致。
 * 新手阅读建议：先读 Props，再看局部状态、effect 和 JSX。
 */

import { memo, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  ModelRetryNode, TurnErrorNode, UserMessageNode,
} from '@deepseek-ai/dsh-client-runtime/client'
import { JsonBlock, MessageText, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatNodeOwnerProps, ChatNodeViewProps, ChatViewSlotProps } from '../contract/slots.ts'
import { ReferenceIcon } from '../reference/ReferenceIcon.tsx'
import { CompactionItem } from './CompactionItem.tsx'
import { ContextInjectionRow } from './ContextInjectionRow.tsx'
import { MessageIconActions } from './MessageIconActions.tsx'
import css from './MessageItem.module.css'

/** 中文说明：类型或类 UserImage 约束本文件的数据或组件职责。 */
type UserImage = Extract<UserMessageNode['content'][number], { type: 'image' }>

/** 中文说明：函数 contentParts 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
function contentParts(content: readonly unknown[]): {
  text: string
  images: { attachment: UserImage['attachment'] }[]
  rest: unknown[]
} {
  /** 中文说明：当前组件的局部值 texts，由紧邻初始化决定。 */
  const texts: string[] = []
  /** 中文说明：当前组件的局部值 images，由紧邻初始化决定。 */
  const images: { attachment: UserImage['attachment'] }[] = []
  /** 中文说明：当前组件的局部值 rest，由紧邻初始化决定。 */
  const rest: unknown[] = []
  /** 中文说明：当前组件的局部值 block，由紧邻初始化决定。 */
  for (const block of content) {
    /** 中文说明：当前组件的局部值 b，由紧邻初始化决定。 */
    const b = block as { type?: string; text?: string; attachment?: unknown }
    if (b.type === 'text' && typeof b.text === 'string') texts.push(b.text)
    else if (b.type === 'image' && b.attachment !== undefined) {
      images.push({ attachment: (b as UserImage).attachment })
    }
    else rest.push(block)
  }
  return { text: texts.join(''), images, rest }
}

/** 中文说明：函数 retrySeconds 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
function retrySeconds(milliseconds: number): number {
  return Math.max(1, Math.ceil(milliseconds / 1_000))
}

/** 中文说明：类型或类 RetryCountdown 约束本文件的数据或组件职责。 */
interface RetryCountdown {
  deadline: number
  seconds: number
}

/** 中文说明：函数 ModelRetryItem 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
function ModelRetryItem({ node, active, t }: {
  node: ModelRetryNode
  active: boolean
  t: ChatViewSlotProps['t']
}) {
  // Anchor the host-scheduled delay to this browser's first render of the
  // retry node. Host event time and Date.now() may belong to different clocks.
  /** 中文说明：当前组件的局部值 deadline，由紧邻初始化决定。 */
  const deadline = useMemo(() => Date.now() + node.delayMs, [node.delayMs, node.seq])
  /** 中文说明：当前组件的局部值 scheduledSeconds，由紧邻初始化决定。 */
  const scheduledSeconds = retrySeconds(node.delayMs)
  /** 中文说明：当前组件的局部值 maximum，由紧邻初始化决定。 */
  const maximum = node.mode === 'normal' ? node.maxRetries : '∞'
  /** 中文说明：当前组件的局部值 [countdown, setCountdown]，由紧邻初始化决定。 */
  const [countdown, setCountdown] = useState<RetryCountdown>(() => ({
    deadline,
    seconds: retrySeconds(deadline - Date.now()),
  }))
  /** 中文说明：当前组件的局部值 remainingSeconds，由紧邻初始化决定。 */
  const remainingSeconds = countdown.deadline === deadline
    ? countdown.seconds
    : retrySeconds(deadline - Date.now())

  useEffect(() => {
    if (!active) return
    /** 中文说明：当前组件的局部值 updateCountdown，由紧邻初始化决定。 */
    const updateCountdown = (): number => {
      /** 中文说明：当前组件的局部值 next，由紧邻初始化决定。 */
      const next = retrySeconds(deadline - Date.now())
      setCountdown(current => (
        current.deadline === deadline && current.seconds === next
          ? current
          : { deadline, seconds: next }
      ))
      return next
    }
    if (updateCountdown() === 1) return
    /** 中文说明：当前组件的局部值 timer，由紧邻初始化决定。 */
    const timer = window.setInterval(() => {
      if (updateCountdown() === 1) window.clearInterval(timer)
    }, 250)
    return () => { window.clearInterval(timer) }
  }, [active, deadline])

  /** 中文说明：当前组件的局部值 label，由紧邻初始化决定。 */
  const label = active
    ? t('message.retry.active')
    : node.retryState === 'cancelled'
      ? t('message.retry.cancelled')
      : node.retryState === 'started'
        ? t('message.retry.started')
        : t('message.retry.scheduled')
  /** 中文说明：当前组件的局部值 seconds，由紧邻初始化决定。 */
  const seconds = active ? remainingSeconds : scheduledSeconds

  return (
    <details className={css.retryRow} data-active={active || undefined}>
      <summary className={css.retrySummary}>
        <span className={css.retryText} role="status">
          {t('message.retry.status', { label, retry: node.retry, maximum, seconds })}
        </span>
      </summary>
      <div className={css.retryDetails}>
        <div>
          <span className={css.retryDetailLabel}>{t('message.retry.delay')}</span>
          {Math.round(node.delayMs)}ms
        </div>
        <div>
          <span className={css.retryDetailLabel}>{t('message.retry.failure')}</span>
          {node.failure.message}
        </div>
      </div>
    </details>
  )
}

/** Persistent, turn-positioned feedback for a terminal failure. */
/* 中文说明：函数 TurnErrorItem 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
function TurnErrorItem({ node, t }: {
  node: TurnErrorNode
  t: ChatViewSlotProps['t']
}) {
  return (
    <div className={css.turnErrorRow} role="status">
      <StateDot state="error" className={css.turnErrorDot} />
      <div className={css.turnErrorCopy}>
        <span className={css.turnErrorTitle}>{t('message.turnError')}</span>
        <span className={css.turnErrorMessage}>{node.message}</span>
      </div>
      {node.code !== undefined && <code className={css.turnErrorCode}>{node.code}</code>}
    </div>
  )
}

/** Persistent, turn-positioned notice for a turn ended at the output-token cap. */
/* 中文说明：函数 TurnMaxTokensItem 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
function TurnMaxTokensItem({ t }: {
  t: ChatViewSlotProps['t']
}) {
  return (
    <div className={css.turnErrorRow} role="status">
      <StateDot state="warning" className={css.turnErrorDot} />
      <div className={css.turnErrorCopy}>
        <span className={css.maxTokensTitle}>{t('message.maxTokens')}</span>
        <span className={css.turnErrorMessage}>{t('message.maxTokens.hint')}</span>
      </div>
    </div>
  )
}

/**
 * Display projection of reference forms in a user bubble (free geometry — no
 * textarea alignment constraint here); everything else stays plain text. The
 * logged model text remains the single truth; this is presentation only.
 * Plain-text `/name` / `@name` word-boundary tokens decorate (the sent text
 * IS the reference — the bubble uses the same plainest token
 * scan as the composer, minus the lexicon: sent tokens were validated at
 * compose time, so shape alone decorates).
 */
/* 中文说明：函数 projectUserText 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
function projectUserText(text: string, sessionLabels: readonly string[]): ReactNode {
  /** 中文说明：当前组件的局部值 ranges，由紧邻初始化决定。 */
  const ranges: { start: number; end: number; label: string; kind: 'session' | 'plain' }[] = []
  /** 中文说明：当前组件的局部值 rawLabel，由紧邻初始化决定。 */
  for (const rawLabel of [...new Set(sessionLabels)].sort((a, b) => b.length - a.length)) {
    /** 中文说明：当前组件的局部值 label，由紧邻初始化决定。 */
    const label = `@${rawLabel}`
    /** 中文说明：当前组件的局部值 start，由紧邻初始化决定。 */
    let start = text.indexOf(label)
    while (start >= 0) {
      ranges.push({ start, end: start + label.length, label, kind: 'session' })
      start = text.indexOf(label, start + label.length)
    }
  }
  /** 中文说明：当前组件的局部值 re，由紧邻初始化决定。 */
  const re = /(^|\s)(\/[\w-]+|@"[^"\n]+"|@[^\s]+)/gu
  /** 中文说明：当前组件的局部值 m: RegExpExecArray | null，由紧邻初始化决定。 */
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    /** 中文说明：当前组件的局部值 tokenStart，由紧邻初始化决定。 */
    const tokenStart = m.index + (m[1]?.length ?? 0)
    /** 中文说明：当前组件的局部值 rawLabel，由紧邻初始化决定。 */
    const rawLabel = m[2] ?? ''
    /** 中文说明：当前组件的局部值 label，由紧邻初始化决定。 */
    const label = rawLabel.startsWith('@"')
      ? rawLabel
      : rawLabel.replace(/[.,;:!?，。；：！？]+$/gu, '')
    if (label.length <= 1) continue
    ranges.push({ start: tokenStart, end: tokenStart + label.length, label, kind: 'plain' })
  }
  ranges.sort((a, b) => a.start - b.start
    || (a.kind === b.kind ? b.end - a.end : a.kind === 'session' ? -1 : 1))
  /** 中文说明：当前组件的局部值 parts，由紧邻初始化决定。 */
  const parts: ReactNode[] = []
  /** 中文说明：当前组件的局部值 cursor，由紧邻初始化决定。 */
  let cursor = 0
  /** 中文说明：当前组件的局部值 range，由紧邻初始化决定。 */
  for (const range of ranges) {
    if (range.start < cursor) continue
    /** 中文说明：当前组件的局部值 { start，由紧邻初始化决定。 */
    const { start: tokenStart, end, label, kind } = range
    if (tokenStart > cursor) parts.push(<MessageText key={cursor} text={text.slice(cursor, tokenStart)} />)
    /** 中文说明：当前组件的局部值 referenceKind，由紧邻初始化决定。 */
    const referenceKind = kind === 'session'
      ? 'session'
      : label.startsWith('@')
        ? label.endsWith('/') ? 'folder' : 'file'
        : undefined
    /** 中文说明：当前组件的局部值 displayLabel，由紧邻初始化决定。 */
    const displayLabel = referenceKind === undefined
      ? label
      : referenceKind === 'session'
        ? label.slice(1)
        : label.slice(1).replace(/^"|"$/gu, '').split(/[\\/]/u).filter(Boolean).at(-1) ?? label.slice(1)
    parts.push(
      <span
        key={tokenStart}
        className={css.refChip}
        data-ref-chip={referenceKind ?? 'skill'}
        title={label}
      >
        {referenceKind !== undefined && (
          <ReferenceIcon kind={referenceKind} size={16} className={css.refIcon} />
        )}
        {displayLabel}
      </span>,
    )
    cursor = end
  }
  if (parts.length === 0) return <MessageText text={text} />
  if (cursor < text.length) parts.push(<MessageText key={cursor} text={text.slice(cursor)} />)
  return <>{parts}</>
}

/** Right-aligned bubble shared by user and steering rows. */
/* 中文说明：函数 UserStyleBubble 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
function UserStyleBubble({
  content, renderMessageImages, actions, pending = false, referenceLabels = [], t,
}: {
  content: readonly unknown[]
  renderMessageImages: ChatNodeOwnerProps['renderMessageImages']
  /** Optional IconActions (or similar) below the bubble; receives the joined text. */
  actions?: (text: string) => ReactNode
  /** Whether this is the Host-authoritative pre-admission steering projection. */
  pending?: boolean
  /** Exact session mention labels associated by the adjacent recall node. */
  referenceLabels?: readonly string[]
  t: ChatViewSlotProps['t']
}): ReactNode {
  /** 中文说明：当前组件的局部值 { text, images, rest }，由紧邻初始化决定。 */
  const { text, images, rest } = contentParts(content)
  /** 中文说明：当前组件的局部值 truncated，由紧邻初始化决定。 */
  const truncated = (total: number): string => t('json.truncated', { total })
  /** 中文说明：当前组件的局部值 showBubble，由紧邻初始化决定。 */
  const showBubble = text !== '' || rest.length > 0
  return (
    <div className={css.userRow} data-pending-steering={pending || undefined} data-time-hover-root>
      <div className={css.userStack}>
        {renderMessageImages({ images, align: 'end' })}
        {showBubble && <div className={css.bubble}>
          {projectUserText(text, referenceLabels)}
          {rest.map((block, i) => <JsonBlock key={i} label={t('message.extraBlock')} payload={block} truncatedLabel={truncated} />)}
        </div>}
        {referenceLabels.length > 0 && (
          <div className={css.referenceSummary}>
            {t('message.referenceSummary', { labels: referenceLabels.join(t('message.referenceSeparator')) })}
          </div>
        )}
      </div>
      {actions?.(text)}
    </div>
  )
}

/**
 * Render one Host-authoritative pending steering item with the same visual
 * language as its eventual durable transcript node.
 * @param props - Pending message content and conversation translator.
 * @returns the pending steering bubble.
 */
/* 中文说明：函数 PendingSteeringBubble 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
export function PendingSteeringBubble({ content, renderMessageImages, t }: {
  content: readonly unknown[]
  renderMessageImages: ChatNodeOwnerProps['renderMessageImages']
  t: ChatViewSlotProps['t']
}): ReactNode {
  return (
    <UserStyleBubble
      content={content}
      renderMessageImages={renderMessageImages}
      pending
      t={t}
      actions={text => (
        <MessageIconActions
          text={text}
          clock="start"
          className={css.actions}
          t={t}
        />
      )}
    />
  )
}

/** User and admitted-steering keyed Chat renderer. */
/* 中文说明：当前组件的局部值 UserMessageNodeView，由紧邻初始化决定。 */
export const UserMessageNodeView = memo(function UserMessageNodeView({
  node, renderMessageImages, t,
}: ChatNodeViewProps<'user' | 'steering'>) {
  /** 中文说明：当前组件的局部值 data，由紧邻初始化决定。 */
  const data = node.data
  return (
    <UserStyleBubble
      content={data.content}
      renderMessageImages={renderMessageImages}
      {...data.referenceLabels === undefined ? {} : { referenceLabels: data.referenceLabels }}
      t={t}
      actions={text => (
        <MessageIconActions
          text={text}
          time={data.time}
          clock="start"
          className={css.actions}
          t={t}
        />
      )}
    />
  )
})

/** Injected-context keyed Chat renderer. */
/* 中文说明：当前组件的局部值 ContextMessageNodeView，由紧邻初始化决定。 */
export const ContextMessageNodeView = memo(function ContextMessageNodeView({ node, t }: ChatNodeViewProps<'context'>) {
  /** 中文说明：当前组件的局部值 data，由紧邻初始化决定。 */
  const data = node.data
  return (
    <ContextInjectionRow
      content={data.content}
      source={data.source}
      provenance={data.provenance}
      form={data.form}
      t={t}
    />
  )
})

/** Automatic compaction keyed Chat renderer. */
/* 中文说明：当前组件的局部值 CompactionNodeView，由紧邻初始化决定。 */
export const CompactionNodeView = memo(function CompactionNodeView({ node, t }: ChatNodeViewProps<'compaction'>) {
  return <CompactionItem node={node.data} t={t} />
})

/** Correlated retry-chain keyed Chat renderer. */
/* 中文说明：当前组件的局部值 RetryNodeView，由紧邻初始化决定。 */
export const RetryNodeView = memo(function RetryNodeView({ node, t }: ChatNodeViewProps<'model-retry'>) {
  /** 中文说明：当前组件的局部值 data，由紧邻初始化决定。 */
  const data = node.data
  return <ModelRetryItem node={data.current} active={data.current.retryState === 'scheduled'} t={t} />
})

/** Terminal turn-error keyed Chat renderer. */
/* 中文说明：当前组件的局部值 TurnErrorNodeView，由紧邻初始化决定。 */
export const TurnErrorNodeView = memo(function TurnErrorNodeView({ node, t }: ChatNodeViewProps<'turn-error'>) {
  return <TurnErrorItem node={node.data} t={t} />
})

/** Max-tokens turn-end notice keyed Chat renderer. */
/* 中文说明：当前组件的局部值 TurnMaxTokensNodeView，由紧邻初始化决定。 */
export const TurnMaxTokensNodeView = memo(function TurnMaxTokensNodeView({ t }: ChatNodeViewProps<'turn-max-tokens'>) {
  return <TurnMaxTokensItem t={t} />
})

/** Explicit unknown-surface keyed Chat renderer. */
/* 中文说明：当前组件的局部值 UnknownNodeView，由紧邻初始化决定。 */
export const UnknownNodeView = memo(function UnknownNodeView({ node, t }: ChatNodeViewProps<'unknown'>) {
  /** 中文说明：当前组件的局部值 data，由紧邻初始化决定。 */
  const data = node.data
  return (
    <div className={css.contextRow}>
      <JsonBlock
        label={t('message.unknownSurface', { type: data.type })}
        payload={data.data}
        truncatedLabel={total => t('json.truncated', { total })}
      />
    </div>
  )
})
