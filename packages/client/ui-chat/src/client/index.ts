/** Browser Chat target plugin.
 * @remarks 文件说明：文件职责：实现 client/ui-chat 中 index 模块的职责，并向相邻模块提供可复用能力。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的 client/ui-chat 能力，
 * 使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */
export { apply, inject } from './apply.ts'
export type {} from './conversation-nodes/assistant.ts'
export type {} from './conversation-nodes/command.ts'
export type {} from './conversation-nodes/compaction.ts'
export type {} from './conversation-nodes/fallback.ts'
export type {} from './conversation-nodes/message.ts'
export type {} from './conversation-nodes/request-prompt.ts'
export type {} from './conversation-nodes/retry.ts'
export type {} from './conversation-nodes/tool.ts'
export type {} from './conversation-nodes/turn-error.ts'
export type {} from './conversation-nodes/turn-max-tokens.ts'
export type {} from './conversation-nodes/turn-process.ts'
export type {} from './conversation-nodes/turn-tail.ts'

export type {
  AssistantBlock, AssistantMessageNode, AssistantProvenanceView, AssistantRequestConfig,
  AssistantTiming, ChatLocationNodeIndex, ChatNodeStore, ChatSnapshot, ChatTurnNavigationIndex,
  CommandNode, CompactionSummaryNode, ContextMessageNode, ConversationNode,
  LegacyConversationSlice, ModelRetryNode, PartialAssistant, RunningToolCall,
  SteeringMessageNode, ToolCallBlock, ToolResultNode, TurnErrorNode, TurnMaxTokensNode,
  TurnNavigationItem, UnknownSurfaceNode, UserMessageNode,
} from './contract/snapshot.ts'
export type {
  AssistantChatData, ChatConversationViewNode, ChatNode, ChatNodeKind,
  FinalAssistantChatData, ManualCompactionChatData, RetryChatData, ToolChatData,
  TurnProcessChatData, TurnTailChatData,
} from './contract/chat-nodes.ts'
export type { ChatStoreState, SelectionTarget, ToolCallId, TurnProcessViewEntry } from './contract/store.ts'
export type { TranscriptViewRowInjected, TranscriptViewRowProps } from './settings/TranscriptViewRow.tsx'
export type { TranscriptViewMode } from '../chat-settings.ts'
export type {
  AssistantActionOwnerProps, ChatFileMentions, ChatNodeOwnerProps, ChatNodeTurnDataInjected,
  ChatNodeViewProps, ChatScrollPosition, ChatStore, ChatViewInjected, ChatViewSlotProps,
  CommandRowOwnerProps, CommandRowProps, DetailsInjected, DetailsSlotProps,
  DetailsToolOwnerProps, MessageImagesProps,
  TurnProcessOwnerProps, TurnTailOwnerProps, UseChat, UseChatNodeTurnData,
} from './contract/slots.ts'
export type {
  TurnProcessGeneration, TurnProcessSignature, TurnProcessSpec,
} from './contract/turn-process.ts'
export type { ChatKey } from './locale.ts'
export type { ConversationContext, ConversationContextOriginKind } from './model/conversation-context.ts'
export type {
  ContextProvenanceView, ContextRole, KnownContextForm,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
export type {
  ConversationPromptSnapshot, RequestInspectionSnapshot, RequestPromptChange, RequestView,
} from '@deepseek-ai/dsh-client-ui-conversation/client'

export { isRunningTool, isSettledTool } from './contract/chat-nodes.ts'
export { EMPTY_CHAT_SNAPSHOT } from './contract/snapshot.ts'

/** Public merge surface for Chat renderer payloads contributed by other plugins. */
export interface ChatNodeDataMap {}

type PublicChatNodeDataMap = ChatNodeDataMap

declare module './contract/chat-nodes.ts' {
  interface ChatNodeDataMap extends PublicChatNodeDataMap {}
}
