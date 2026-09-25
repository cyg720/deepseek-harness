import type {} from '@deepseek-ai/dsh-qs-composer/client'
/** 转写拥有行槽与分页订阅；交互槽归 qs-composer 固定会话座位。 */
import type { HostObservable, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { SlotHookFactory } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConversationLocationDataStore, ConversationTurnDataMap } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { MarkdownFileMentions } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TurnTailOwnerProps, UseChatNodeTurnData } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { MessageImageLoader } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { QsProcessFold } from './process-fold.ts'
import type {
  ChatNodeProcessSource, ChatNodeSource, ChatTurnProcessPresentation,
} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SessionPendingInteraction } from '@deepseek-ai/dsh-client-ui-session/client'
// 仅类型：引入 qs-shell 声明的顶层 qs.* 槽（本包向 qs.stage.transcript 贡献）。
import type {} from '@deepseek-ai/dsh-qs-shell/client'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** 已有附件由独立呈现插件消费，读取权限来自会话加载器。 */
    'qs.conversation.message.images': { kind: 'single'; scope: 'session'; owner: import('@deepseek-ai/dsh-client-ui-conversation/client').MessageImagesOwnerProps }
    /** 轮次附加呈现消费官方轮次投影，文件动作由对应插件注入。 */
    'qs.chat.turn-tail': {
      kind: 'chain'
      scope: 'session'
      owner: Pick<import('@deepseek-ai/dsh-client-ui-chat/client').TurnTailOwnerProps, 'turn' | 'seq'>
    }
    /** 持久助手消息的扩展动作；运行中及无 messageId 的残片不提供此入口。 */
    'qs.chat.assistant-actions': {
      kind: 'list'
      scope: 'session'
      owner: { readonly messageId: import('@deepseek-ai/dsh-api-remotes/client').MessageId }
    }
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
      hookContext: ConversationLocationDataStore<ConversationTurnDataMap> | undefined
      inject: { hooks: { turnData: SlotHookFactory<'qs.stage.transcript.row', UseChatNodeTurnData> } }
    }


  }

  interface LocaleNamespaceMap {
    'qs-transcript': QsTranscriptLocaleKey
  }
}

/** 转写行业主输入：行键、父 entry 绑定的订阅座席与会话能力。 */
export interface QsTranscriptRowOwnerProps {
  /** 最终答案的内联推理由已完成轮过程控制，正文始终保留。 */
  readonly reasoningHidden: boolean
  /** 官方共享查找 Hook，由转写宿主传递，行不跨插件导入运行时代码。 */
  readonly useSearchableHidden: import('@deepseek-ai/dsh-client-ui-chat/client').ChatPresentation['useSearchableHidden']
  /** 浏览器查找命中隐藏过程时展开该轮，保留其正文与焦点。 */
  readonly revealProcess: () => void
  /** 图片槽由转写宿主唯一声明，行通过宿主委托渲染。 */
  readonly renderMessageImages: import('@deepseek-ai/dsh-client-ui-conversation/client').RenderMessageImages
  /** 文件识别沿用官方交付词表；未装配提供者时保持普通文本。 */
  readonly fileMentions: (owner: Pick<TurnTailOwnerProps, 'turn' | 'seq'>) => MarkdownFileMentions | undefined
  /** 稳定的 Conversation Context 键（避开 React 保留的 key 属性名）。 */
  readonly nodeKey: string
  /** 父 entry 的 keyedHooks 绑出的单行订阅座席。 */
  readonly useNode: UseQsChatNode
  /** 同一行的 Turn-process 呈现订阅座席。 */
  readonly useProcess: UseQsChatNodeProcess
  /**
   * 按会话授权的图片装载（官方 uiConversation 的地址签发）。
   *
   * 行组件不持有 ctx，也不得自行拼装资源地址：需要渲染持久图片引用的行（如工具视图的
   * read_image）只能通过这里取得装载器。
   */
  readonly loadImage: MessageImageLoader
  /** 已完成轮的过程折叠状态（按会话创建，行只读写自己的折叠键）。 */
  readonly fold: QsProcessFold
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
  /** 官方执行器发布分页结算，失败不丢弃现有记录。 */
  readonly historyLoad: import('@deepseek-ai/dsh-api-session-controller/client').HistoryLoadState
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
  /** 官方共享 Hook，保留隐藏内容的查找揭示与焦点保护。 */
  readonly useSearchableHidden: import('@deepseek-ai/dsh-client-ui-chat/client').ChatPresentation['useSearchableHidden']
  /** 当前会话下的交付引用解析，打开仍走官方资源路由。 */
  readonly fileMentions: QsTranscriptRowOwnerProps['fileMentions']
  readonly keyedHooks: {
    /** 稳定身份的单行节点源。 */
    readonly node: (key: string) => ChatNodeSource
    /** 稳定身份的单行 Turn-process 源。 */
    readonly process: (key: string) => ChatNodeProcessSource
  }
  readonly hooks: {
    /** 官方共享偏好决定已完成轮的过程是否紧凑呈现。 */
    readonly qsCompactTranscript: HostObservable<boolean>
    /** 历史分页源，框架绑成 `useQsHistory`。 */
    readonly qsHistory: HostObservable<QsHistorySnapshot>
    /** 官方连接状态，断线或重连过程中暂停自动及手动分页。 */
    readonly qsHistoryConnected: HostObservable<boolean>
    /** 有效行键包括后装扩展，卸载后立即回到 unknown。 */
    readonly qsRowKeys: HostObservable<readonly string[]>
  }
  /** 历史分页：向上加载更早的一页。 */
  readonly loadOlder: () => void
  /** 按会话授权的图片装载，随行 owner 输入一起下发给行组件。 */
  readonly loadImage: MessageImageLoader
  /** 本会话的过程折叠状态，随行 owner 输入一起下发给行组件。 */
  readonly fold: QsProcessFold
  /** Reconnect the official transport to reopen a failed history stream. */
  readonly retryHistory: () => void
  /** Read this Session's last reading intent. */
  readonly readScroll: () => QsScrollPosition | undefined
  /** Save this Session's reading intent without persisting message content. */
  readonly saveScroll: (position: QsScrollPosition) => void
}

/** 固定待回答区归 Conversation 所有，保留类型导出兼容贡献者。 */
export type { QsInteractionOwnerProps } from '@deepseek-ai/dsh-qs-composer/client'

/** 宿主读到当前 pending 的座席类型（来自 root 标准座席）。 */
export type UseQsPendingInteraction = SnapshotSelectorHook<
  ReadonlyMap<string, SessionPendingInteraction>
>

/** 本包用到的 root 源类型别名。 */
export type QsHostObservable<T> = HostObservable<T>

/** qs-transcript 的本地化键。 */
export type QsTranscriptLocaleKey =
  | 'settings.transcript.title'
  | 'settings.transcript.description'
  | 'settings.transcript.normal'
  | 'settings.transcript.compact'
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
  | 'row.turn'
  | 'row.step'
  | 'row.noActivity'
  | 'row.processDetailHint'
  | 'row.turnFailed'
  | 'row.turnTruncated'
  | 'row.turnNoAnswer'
  | 'row.noMetrics'
  | 'command.title'
  | 'command.running'
  | 'command.failed'
  | 'command.done'
  | 'command.expand'
  | 'compact.landed'
  | 'compact.counts'
  | 'compact.noCounts'
  | 'compact.historyRetained'
  | 'compact.unavailable'
  | 'compact.expand'
  | 'compact.running'
  | 'compact.failed'
  | 'compact.noCheckpoint'
  | 'row.milliseconds'
  | 'row.ttft'
  | 'row.tps'
  | 'row.branchUnavailable'
  | 'diag.retryTitle'
  | 'diag.retryBudget'
  | 'diag.retryUnbounded'
  | 'diag.retryScheduled'
  | 'diag.retryStarted'
  | 'diag.retryCancelled'
  | 'diag.provider'
  | 'diag.delay'
  | 'diag.retryChain'
  | 'diag.reason'
  | 'diag.noReason'
  | 'diag.errorTitle'
  | 'diag.errorHint'
  | 'diag.maxTokensTitle'
  | 'diag.maxTokensHint'
  | 'pending.label'
  | 'error.title'
  | 'error.retry'
  | 'history.loading'
  | 'history.loadMore'
  | 'history.failed'
  | 'history.noProgress'
  | 'history.opening'
  | 'history.retry'
  | 'empty.title'
  | 'empty.lead'
