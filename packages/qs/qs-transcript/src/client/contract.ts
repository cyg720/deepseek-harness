/**
 * qs-transcript 的槽位契约。
 *
 * 本包是 `qs.stage.transcript.row`（keyed）与 `qs.stage.interaction`（chain）的声明方：
 * 框架里 inject face 归声明方所有，所以这两个槽连同它们的 inject 面都登记在这里，
 * 由 qs-transcript 自己声明并渲染（见 06-槽位与状态设计 第二节的声明权规则）。
 */
import type { HostObservable, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  ChatNodeProcessSource, ChatNodeSource, ChatTurnProcessPresentation,
} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SessionPendingInteraction } from '@deepseek-ai/dsh-client-ui-session/client'
// 仅类型：引入 qs-shell 声明的顶层 qs.* 槽（本包向 qs.stage.transcript 贡献）。
import type {} from '@deepseek-ai/dsh-qs-shell/client'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * 转写行分派：按 Chat 节点 kind 取行组件。
     *
     * 行组件不手工订阅：框架把父 entry 的 `inject.keyedHooks` 绑成 `useNode` 座席，
     * 宿主再把它显式传给行包装器（官方 ChatNodeSeat 同款，见 R29）。
     */
    'qs.stage.transcript.row': {
      kind: 'keyed'
      scope: 'session'
      owner: QsTranscriptRowOwnerProps
    }

    /**
     * 交互卡片位：审批与提问共用，位于消息流末尾（原型位置）。
     *
     * `select` 按当前会话的 pending 类型选举：qs-approval priority 1、
     * qs-questions priority 2，升序第一个非 null 当选。**chain 条目崩溃不退位**，
     * 因此卡片必须自带错误提示与重试。
     */
    'qs.stage.interaction': {
      kind: 'chain'
      scope: 'session'
      owner: QsInteractionOwnerProps
    }
  }

  interface LocaleNamespaceMap {
    'qs-transcript': QsTranscriptLocaleKey
  }
}

/** 转写行业主输入：行键与父 entry 绑定的订阅座席。 */
export interface QsTranscriptRowOwnerProps {
  /** 稳定的 Conversation Context 键（避开 React 保留的 key 属性名）。 */
  readonly nodeKey: string
  /** 父 entry 的 keyedHooks 绑出的单行订阅座席。 */
  readonly useNode: UseQsChatNode
  /** 同一行的 Turn-process 呈现订阅座席。 */
  readonly useProcess: UseQsChatNodeProcess
}

/** 单行节点选择器座席。 */
export type UseQsChatNode = <S>(
  key: string,
  selector: (node: import('@deepseek-ai/dsh-client-ui-chat/client').ChatConversationViewNode | undefined) => S,
  eq?: (a: S, b: S) => boolean,
) => S

/** 单行 Turn-process 选择器座席。 */
export type UseQsChatNodeProcess = <S>(
  key: string,
  selector: (value: ChatTurnProcessPresentation | undefined) => S,
  eq?: (a: S, b: S) => boolean,
) => S

/** 历史分页快照。 */
export interface QsHistorySnapshot {
  /** 是否还有更早的历史。 */
  readonly hasMore: boolean
  /** 是否正在加载更早的一页。 */
  readonly loadingOlder: boolean
}

/** Reading intent retained while a Session binding exists. */
export interface QsScrollPosition {
  readonly top: number
  readonly follow: boolean
}

/**
 * `qs.stage.transcript` 条目的 inject face：把官方 chat 目标的行订阅源交给框架绑成座席。
 *
 * 分页必须**订阅**而不是注入一次快照：`hasMore` / `loadingOlder` 会在加载开始、结束与
 * 历史耗尽时变化，注入时的值会一直停在首次读数上。
 */
export interface QsTranscriptInjected {
  readonly keyedHooks: {
    /** 稳定身份的单行节点源。 */
    readonly node: (key: string) => ChatNodeSource
    /** 稳定身份的单行 Turn-process 源。 */
    readonly process: (key: string) => ChatNodeProcessSource
  }
  readonly hooks: {
    /** 历史分页源，框架绑成 `useQsHistory`。 */
    readonly qsHistory: HostObservable<QsHistorySnapshot>
  }
  /** 历史分页：向上加载更早的一页。 */
  readonly loadOlder: () => void
  /** Reconnect the official transport to reopen a failed history stream. */
  readonly retryHistory: () => void
  /** Read this Session's last reading intent. */
  readonly readScroll: () => QsScrollPosition | undefined
  /** Save this Session's reading intent without persisting message content. */
  readonly saveScroll: (position: QsScrollPosition) => void
}

/** 交互卡片位的选举输入：宿主显式传入选择器需要的每个字段。 */
export interface QsInteractionOwnerProps {
  /** 当前会话身份；无绑定时为 undefined。 */
  readonly sessionId: string | undefined
  /** 当前会话待答复的交互；无则为 undefined。 */
  readonly pendingInteraction: SessionPendingInteraction | undefined
}

/** 宿主读到当前 pending 的座席类型（来自 root 标准座席）。 */
export type UseQsPendingInteraction = SnapshotSelectorHook<
  ReadonlyMap<string, SessionPendingInteraction>
>

/** 本包用到的 root 源类型别名。 */
export type QsHostObservable<T> = HostObservable<T>

/** qs-transcript 的本地化键。 */
export type QsTranscriptLocaleKey =
  | 'markdown.copy'
  | 'markdown.copied'
  | 'markdown.footnotes'
  | 'row.assistant'
  | 'row.model.unknown'
  | 'row.copy'
  | 'row.copied'
  | 'row.copyFailed'
  | 'row.running'
  | 'row.settled'
  | 'row.interrupted'
  | 'row.unknownKind'
  | 'row.nonText'
  | 'row.systemPrompt'
  | 'row.reasoning'
  | 'row.thought'
  | 'row.tools'
  | 'row.messages'
  | 'row.agents'
  | 'row.tokens'
  | 'row.context'
  | 'row.steering'
  | 'pending.label'
  | 'error.title'
  | 'error.retry'
  | 'history.loading'
  | 'history.loadMore'
  | 'history.failed'
  | 'history.opening'
  | 'history.retry'
  | 'empty.title'
  | 'empty.lead'
