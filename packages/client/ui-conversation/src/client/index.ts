/** Browser Conversation assemble core, React adapter, shell, and input plugin.
 * @remarks 文件说明：文件职责：实现 client/ui-conversation 中 index 模块的职责，并向相邻模块提供可复用能力。
 * ；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * client/ui-conversation 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */
export { apply, inject } from './apply.ts'
export { UiConversation } from './conversation/assembly.ts'
export type { ConversationBinding } from './conversation/assembly.ts'
export { ConversationController, UnsupportedImageMediaTypeError } from './service.ts'
export type { IConversation } from './service.ts'
export type {
  ConversationContextReader, ConversationLocation,
  ConversationLocationData, ConversationLocationDataScope, ConversationLocationDataStore,
  ConversationMatch, ConversationMatchResult, ConversationNodeContext,
  ConversationNodeDefinition, ConversationPreviousContext, ConversationPublication,
  ConversationStartMatch,
  ConversationStepDataMap, ConversationTimelineSnapshot, ConversationTurnDataMap,
  ConversationViewBuilder, ConversationViewDefinition, ConversationViewNode,
  ConversationViewSnapshotMap, ConversationViewSnapshotStore, StepLocation, TurnLocation,
} from './contract/conversation.ts'
export { EMPTY_CONVERSATION_SNAPSHOT, conversationPhase } from './contract/snapshot.ts'
export type {
  ConversationPhase, ConversationSnapshot,
} from './contract/snapshot.ts'
export type {
  AssistantBlock, AssistantMessageNode, AssistantProvenanceView, AssistantRequestConfig,
  AssistantTiming, CommandNode, CompactionSummaryNode, ContextMessageNode, ConversationNode,
  ModelRetryNode, PartialAssistant, RunningToolCall, SteeringMessageNode, TodoItem,
  ToolCallBlock, ToolResultNode, TurnErrorNode, TurnMaxTokensNode, UnknownSurfaceNode,
  UserMessageNode,
} from './contract/records.ts'
export type {
  ContextProvenanceView, ContextRole, KnownContextForm,
} from './contract/context-provenance.ts'
export type {
  ConversationPromptSnapshot, RequestInspectionSnapshot, RequestPromptChange, RequestPromptInspection, RequestPromptInspector, RequestView,
} from './contract/request-inspection.ts'
export { inspectRequestPrompt } from './contract/request-inspection.ts'
export type { ConversationStoreState, ConversationViewRequest, ViewTab } from './contract/views.ts'

export { ConversationNodeAssembler } from './conversation/assembler.ts'
export type {
  ConversationEventDefinitions, ConversationViewDefinitions,
} from './conversation/assembler.ts'
export { ConversationDefinitionRegistry } from './conversation/definition-registry.ts'
export { ConversationEventRegistry } from './conversation/event-registry.ts'
export { ConversationLocationIndex } from './conversation/location-index.ts'
export type { ConversationLocationDataChange } from './conversation/location-index.ts'
export { ConversationViewRegistry } from './conversation/view-registry.ts'

export type { ConversationKey } from './locales.ts'
export type {
  ComposerAttachment, ComposerAttachmentsOwnerProps, ComposerAttachmentsProps,
  ComposerBarInjected, ComposerBarOwnerProps, ComposerBarProps, ComposerChainProps,
  ConversationHeaderActionOwnerProps, ConversationHeaderLineageOwnerProps,
  ConversationInjected, ConversationSessionHeaderInjected, ConversationSessionHeaderSlotProps,
  ConversationSessionInjected, ConversationSessionSlotProps, ConversationSlotProps,
  ConversationStore, ConvViewOwnerProps, ConvViewProps, EmptyWorkspaceOwnerProps,
  HeroAgentPresetOwnerProps, HeroBrandMarkOwnerProps, InputControlOwnerProps, InputZone,
  MessageImageLoader, MessageImageSource, MessageImagesOwnerProps, RenderMessageImages, UseConversation,
  UseConversationViews,
} from './contract/slots.ts'
export type {
  ArbitrateKey, ArbitrateOutcome, BeginCommandRequest, CommandClaim, ConsumeTokenRequest,
  DraftAttachmentId, InputActions, InputState, InsertReferenceRequest, InsertTextRequest,
  PickOutcome, ReferenceInsert, SessionInput, SessionInputResolver, SubmitImageAttachment,
  SubmitOutcome, TokenSpan,
} from './contract/input.ts'
export type { ComposerBlock, ComposerBlocks } from './contract/composer-blocks.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Scope-addressed Conversation actions and per-Session input registry. */
    conversation: import('./service.ts').IConversation
    /** Target-neutral Conversation registries and per-Session assembly. */
    uiConversation: import('./conversation/assembly.ts').UiConversation
  }
}
