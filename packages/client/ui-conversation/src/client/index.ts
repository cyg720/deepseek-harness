/**
 * ================================ 文件注释 ================================
 * 【文件职责】浏览器会话插件的公共出口：类型化导入各 conversation-node 模块以装载其
 *             模块扩充（SlotMap / 会话事件映射等），再导出 apply / inject、服务面、
 *             各契约类型，并把 ctx.conversation 服务挂到 Cordis Context 上。
 * 【技术维度】纯 re-export + 模块扩充；'conversation' 服务通过 declare module 注入。
 * 【产品维度】其它插件能类型化使用 ctx.conversation 与各槽位 props 类型。
 * 【逻辑维度】1) type-only 导入装载扩充；2) 导出 apply / 服务 / 类型；3) Context 扩充。
 * 【关键边界】遵循 client 包导出纪律：只导出 Cordis 装载所需 + 共享类型。
 * 【新手阅读建议】把它当作"本包对外开放了什么"的清单。
 * ==========================================================================
 */
/**
 * Browser conversation plugin. `contract/` is the shared type boundary
 * between the independently implemented skeleton and chat domains; `apply.ts`
 * owns their slot assembly.
 */
export type {} from './conversation-nodes/assistant.ts'
export type {} from './conversation-nodes/command.ts'
export type {} from './conversation-nodes/compaction.ts'
export type {} from './conversation-nodes/fallback.ts'
export type {} from './conversation-nodes/message.ts'
export type {} from './conversation-nodes/retry.ts'
export type {} from './conversation-nodes/tool.ts'
export type {} from './conversation-nodes/turn-error.ts'
export type {} from './conversation-nodes/turn-max-tokens.ts'
export type {} from './conversation-nodes/turn-tail.ts'

export { apply, inject } from './apply.ts'
export { ConversationController } from './service.ts'
export type { IConversation } from './service.ts'
export type { DraftAttachmentId } from './input/contract.ts'

export type {
  CallId, ChatStoreState, SelectionTarget, ViewTab,
} from './contract/views.ts'
export type { ConversationKey } from './locales.ts'
export type {
  AssistantChatData, ChatNode, ChatNodeDataMap, ChatNodeKind, ManualCompactionChatData,
  RetryChatData, ToolChatData, TurnTailChatData,
} from './contract/chat-nodes.ts'
export type {
  ChatFileMentions, ChatNodeOwnerProps, ChatNodeViewProps,
  ChatStore, ChatViewInjected, ChatViewSlotProps, CommandRowOwnerProps, CommandRowProps, ComposerBarInjected,
  ComposerAttachment, ComposerAttachmentsOwnerProps, ComposerAttachmentsProps, ComposerChainProps, ConversationInjected,
  ConversationHeaderLineageOwnerProps, ConversationSessionHeaderInjected, ConversationSessionInjected,
  ConversationSlotProps, ConvViewOwnerProps,
  ConvViewProps, DetailsInjected, DetailsSlotProps, DetailsToolOwnerProps, EmptyWorkspaceOwnerProps, HeroBrandMarkOwnerProps,
  MessageImagesOwnerProps, MessageImagesProps, RenderMessageImages, TurnTailOwnerProps, UseChatNodeTurnData,
} from './contract/slots.ts'
// Export discipline: packages/client/AGENTS.md.

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The outward face only; the concrete service stays inside this plugin. */
    // 只暴露对外面（IConversation）；具体服务实现留在本插件内部。
    conversation: import('./service.ts').IConversation
  }
}
