/** Chat-owned Slot declarations and composed component props.
 * @remarks 文件说明：文件职责：实现 client/ui-chat 中 slots 模块的职责，并向相邻模块提供可复用能力。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的 client/ui-chat 能力，
 * 使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type {
  ConversationTurnDataMap, MessageImageLoader, MessageImagesOwnerProps, RenderMessageImages, TurnLocation,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore, SlotHookFactory,
  SnapshotSelectorHook,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { MarkdownFileMentions } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { createChatStore } from '../stores.ts'
import type { ToolCallId, SelectionTarget } from './store.ts'
import type { ChatNode, ChatNodeKind } from './chat-nodes.ts'
import type { ChatSnapshot, CommandNode, CompactionSummaryNode, ToolCallBlock } from './snapshot.ts'
import type { TurnProcessSpec } from './turn-process.ts'
import type { TranscriptViewMode } from '../../chat-settings.ts'

/** Selector hook over the current Conversation binding's Chat target. */
export type UseChat = SnapshotSelectorHook<ChatSnapshot>

/** Owner currency of the completed-Turn extension chain. */
export interface TurnTailOwnerProps {
  turn: TurnLocation
  seq: number
  openFile: (path: string) => void
}

/** Owner currency of finalized-assistant actions. */
export interface AssistantActionOwnerProps {
  messageId: MessageId
}

/** Optional prose file-mention provider consumed by Chat. */
export interface ChatFileMentions {
  /**
   * Resolve prose links for one closing Turn.
   * @param owner - closing-Turn identity and file opener.
   * @returns link resolver when available.
   * @remarks 中文说明：功能说明：处理 forClosing 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：owner（TurnTailOwnerProps）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：MarkdownFileMentions | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 forClosing(owner)，并按返回类型处理结果。
   */
  forClosing(owner: TurnTailOwnerProps): MarkdownFileMentions | undefined
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Optional prose file-mention provider. */
    chatFileMentions: ChatFileMentions
  }
}

/** Hook constrained to business data published on the current Chat Node's Turn. */
export type UseChatNodeTurnData = <Key extends Extract<keyof ConversationTurnDataMap, string>>(
  key: Key,
) => Readonly<ConversationTurnDataMap[Key]> | undefined

/** Slot-level Hook factory for keyed Chat renderers. */
export interface ChatNodeTurnDataInjected {
  hooks: { turnData: SlotHookFactory<'conversation.chat.node', UseChatNodeTurnData> }
}

/** Stable owner currency delivered to a keyed Chat renderer. */
export interface ChatNodeOwnerProps {
  selectedCallId?: ToolCallId | undefined
  cwd?: string | undefined
  openFile: (path: string) => void
  inspectCall: (callId: ToolCallId) => void
  forkAt: (seq: number) => void
  renderMessageImages: RenderMessageImages
  fileMentions: (owner: TurnTailOwnerProps) => MarkdownFileMentions | undefined
  /** Turn-process state when this Node belongs to a projected Turn. */
  turnProcess?: TurnProcessOwnerProps | undefined
}

/** Shared presentation state for one Turn-process answer generation. */
export interface TurnProcessOwnerProps {
  readonly spec: TurnProcessSpec
  readonly foldable: boolean
  readonly open: boolean
  /**
   * 功能说明：设置 Open 相关流程；使用场景由所在模块及调用位置决定。
   * @param open （boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 setOpen(open)，并按返回类型处理结果。
   */
  setOpen(open: boolean): void
}

/** Full props of one keyed Chat renderer. */
export type ChatNodeViewProps<Kind extends ChatNodeKind = ChatNodeKind> =
  PropsRuntime<'conversation.chat.node', Kind> & PropsLocale<'chat'>

/** Tool block rendered in the details panel. */
export interface DetailsToolOwnerProps {
  block: ToolCallBlock
  cwd?: string | undefined
}

/** Command-row owner share. */
export interface CommandRowOwnerProps {
  node: CommandNode
  compaction?: CompactionSummaryNode
}

/** Full props of a registered command row. */
export type CommandRowProps = PropsRuntime<'conversation.chat.commandview'>

/** Shared Chat store handle. */
export type ChatStore = ReturnType<typeof createChatStore>

/** In-memory reader position resilient to transcript reflow. */
export interface ChatScrollPosition {
  readonly anchorKey: string
  readonly anchorTop: number
  readonly scrollTop: number
}

/** Business callbacks injected into the Chat view. */
export interface ChatViewInjected {
  hooks: {
    /** Persisted completed-Turn transcript presentation. */
    transcriptView: SnapshotStore<TranscriptViewMode>
  }
  openDetails: (target: SelectionTarget) => void
  openFile: (path: string) => Promise<void>
  loadOlder: () => void
  loadImage: MessageImageLoader
  chatScroll: {
    save: (position: ChatScrollPosition | null) => void
    read: () => ChatScrollPosition | null
  }
  forkAt: (seq: number) => void
  fileMentions: (owner: TurnTailOwnerProps) => MarkdownFileMentions | undefined
}

/** Full Chat view props. */
export type ChatViewSlotProps =
  PropsRuntime<'conversation.view'>
  & PropsRenderSlots<'conversation.chat.node' | 'conversation.message.images'>
  & PropsStore<ChatStore>
  & InjectFace<ChatViewInjected>
  & PropsLocale<'chat'>

/** Full props of the durable-message image renderer. */
export type MessageImagesProps = PropsRuntime<'conversation.message.images'> & PropsLocale<'conversation'>

/** Details-panel callbacks. */
export interface DetailsInjected {
  closeDetails: () => void
}

/** Full details-panel props. */
export type DetailsSlotProps =
  PropsRuntime<'details'>
  & PropsRenderSlots<'conversation.details.tool'>
  & PropsStore<ChatStore>
  & InjectFace<DetailsInjected>
  & PropsLocale<'chat'>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SessionStandardProps {
    /** Selector hook over the current Conversation binding's Chat target. */
    useChat: UseChat
  }

  interface LocaleNamespaceMap {
    /** Chat target, transcript node, statistics, and details copy. */
    chat: import('../locale.ts').ChatKey
  }

  interface SlotMap {
    /**
     * Final Chat node renderer, keyed by `ChatNodeKind`. The component receives
     * the typed node, shared Chat actions, and Turn-data hook. Reusing a key
     * replaces that node renderer; a kind with no occupant renders no row.
     */
    'conversation.chat.node': {
      kind: 'keyed'
      scope: 'session'
      owner: ChatNodeOwnerProps
      keyProps: { [Kind in ChatNodeKind]: { node: ChatNode<Kind> } }
      hookContext: string
      inject: ChatNodeTurnDataInjected
    }
    /**
     * Renderer for one consecutive group of durable message images. The owner
     * supplies image references, an authorized loader, and alignment. A
     * registration replaces the shipped gallery; without one, images are omitted.
     */
    'conversation.message.images': { kind: 'single'; scope: 'session'; owner: MessageImagesOwnerProps }
    /**
     * Command row keyed by the command name. The component receives the folded
     * command lifecycle and linked compaction when present. Reusing a key
     * replaces that command renderer; an unoccupied key uses the generic card.
     */
    'conversation.chat.commandview': { kind: 'keyed'; scope: 'session'; owner: CommandRowOwnerProps }
    /**
     * Selector-routed extension before a completed Turn's action row. The
     * component receives the Turn, closing sequence, and file opener. The first
     * selector that accepts the owner renders; an all-declined chain is empty.
     */
    'conversation.chat.turnTail': { kind: 'chain'; scope: 'session'; owner: TurnTailOwnerProps }
    /**
     * Ordered actions for one finalized assistant message. Each entry receives
     * the durable message id; a fresh `id` adds an action and reusing one replaces
     * that entry. With no entries, the standard action row remains unchanged.
     */
    'conversation.chat.assistant-actions': { kind: 'list'; scope: 'session'; owner: AssistantActionOwnerProps }
    /**
     * Whole details-panel body for the selected Tool call. The component receives
     * the running or settled block and optional workspace root. A registration
     * replaces the shipped Tool details renderer; absence uses the raw fallback.
     */
    'conversation.details.tool': { kind: 'single'; scope: 'session'; owner: DetailsToolOwnerProps }
  }
}
