/**
 * ================================ 文件注释 ================================
 * 【文件职责】会话业务状态机与聊天目标构建器的统一注册入口：依次注册收件箱、消息、
 *             assistant、工具、命令、压缩、重试、回合错误、超 token、回合尾与未知兜底，
 *             最后注册 chat 目标构建器。
 * 【技术维度】纯装配函数；每个 register* 调用 conversationEvents.register 或 registerFallback。
 * 【产品维度】一次调用完成聊天业务的全部状态机装载。
 * 【逻辑维度】按注册顺序列出全部贡献。
 * 【关键边界】注册顺序无强依赖（状态机间靠 Definition 名互查）；兜底必须最后注册。
 * 【新手阅读建议】这是 conversation-nodes 目录的目录页。
 * ==========================================================================
 */
import type { Context } from '@deepseek-ai/cordis'
import { registerAssistantConversationNode } from './assistant.ts'
import { registerChatConversationView } from './chat-snapshot-builder.ts'
import { registerCommandConversationNode } from './command.ts'
import { registerCompactionConversationNode } from './compaction.ts'
import { registerUnknownConversationFallback } from './fallback.ts'
import { registerInboxConversationNodes } from './inbox.ts'
import { registerMessageConversationNode } from './message.ts'
import { registerRequestPromptConversationNode } from './request-prompt.ts'
import { registerRetryConversationNode } from './retry.ts'
import { registerToolConversationNode } from './tool.ts'
import { registerTurnErrorConversationNode } from './turn-error.ts'
import { registerTurnMaxTokensConversationNode } from './turn-max-tokens.ts'
import { registerTurnProcess } from './turn-process.ts'
import { registerTurnTailConversationNode } from './turn-tail.ts'

/**
 * Register the Chat business Definitions and target builder contributed by this package.
 * @param ctx - owning UI Conversation context.
 */
export function registerConversationNodes(ctx: Context): void {
  registerInboxConversationNodes(ctx)
  registerMessageConversationNode(ctx)
  registerRequestPromptConversationNode(ctx)
  registerAssistantConversationNode(ctx)
  registerTurnProcess(ctx)
  registerToolConversationNode(ctx)
  registerCommandConversationNode(ctx)
  registerCompactionConversationNode(ctx)
  registerRetryConversationNode(ctx)
  registerTurnErrorConversationNode(ctx)
  registerTurnMaxTokensConversationNode(ctx)
  registerTurnTailConversationNode(ctx)
  registerUnknownConversationFallback(ctx)
  registerChatConversationView(ctx)
}
