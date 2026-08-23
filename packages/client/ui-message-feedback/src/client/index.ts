/**
 * ================================ 文件注释 ================================
 * 【文件职责】消息反馈包的浏览器侧入口：把赞/踩条目注册进助手消息操作条，
 *             每个会话一个反馈控制器（一次列表读取种子化整段对话）。
 * 【技术维度】Cordis 浏览器插件：变更经生成的 messageFeedback Remote，
 *             宿主拥有按项比较并交换（CAS）；控制器按会话懒创建、随条目清理。
 * 【产品维度】用户可对每条助手消息点赞/踩、加备注或清除。
 * 【逻辑维度】1) 注册字典；2) 按会话懒建控制器；3) 重连时对已读会话 resync；
 *             4) 注册 assistant-actions 条目（按会话注入）。
 * 【关键边界】重连只失效已读过的数据；冷会话保持冷直到被请求。
 * 【新手阅读建议】先读 controller.ts 的 CAS 语义，再看本文件的接线。
 * ==========================================================================
 */
/**
 * Message feedback plugin, browser half: the Like/Dislike entry in the
 * conversation.chat.assistant-actions strip. One MessageFeedbackController per
 * Session backs every message control in that Session, so a single list read
 * seeds the whole transcript. Mutations go through the generated
 * messageFeedback Remote; the Host owns per-item compare-and-set.
 * @module @deepseek-ai/dsh-client-ui-message-feedback/client
 */

import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the generated Remote API and ctx.remote merge through the Client assembly boundary.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the ui-conversation SlotMap merge (the assistant-actions entry).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { MessageFeedbackController } from './controller.ts'
import { MessageFeedbackActions } from './MessageFeedbackActions.tsx'
import type { MessageFeedbackInjected } from './slots.ts'
import { en, zh } from './locales.ts'

export type {
  MessageFeedbackActionResult, MessageFeedbackStatus, MessageFeedbackView, MessageFeedbackRemote,
} from './controller.ts'
export type { MessageFeedbackActionProps, MessageFeedbackInjected } from './slots.ts'
export type { MessageFeedbackKey } from './locales.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'feedback'

/** Required services: the slot registry, the Remote namespace, and the copy. */
export const inject = ['slots', 'remote', 'remote.messageFeedback', 'locale']

/**
 * Client plugin body: the per-message feedback entry and its per-session
 * object layer.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-message-feedback: dictionaries')

  const controllers = new Map<SessionId, MessageFeedbackController>()
  const controllerFor = (sessionId: SessionId): MessageFeedbackController => {
    let controller = controllers.get(sessionId)
    if (controller === undefined) {
      controller = new MessageFeedbackController(ctx.remote.messageFeedback, sessionId)
      controllers.set(sessionId, controller)
    }
    return controller
  }

  // A reconnect can only invalidate what was already read; a cold Session
  // stays cold until something asks for it.
  ctx.on('connection/reset', () => {
    for (const controller of controllers.values()) {
      if (controller.getSnapshot().status !== 'cold') void controller.resync()
    }
  })

  ctx.slots.inject('conversation.chat.assistant-actions', () => {
    const dispose = ctx.slots.register({
      name: 'conversation.chat.assistant-actions',
      id: 'feedback',
      order: 10,
      locale: NS,
      inject: (sessionId): MessageFeedbackInjected => {
        const controller = controllerFor(sessionId)
        return {
          hooks: { feedback: controller },
          ensure: () => controller.ensure(),
          rate: (messageId, rating, note) => controller.rate(messageId, rating, note),
          toggle: (messageId, rating) => controller.toggle(messageId, rating),
          clearNote: messageId => controller.clearNote(messageId),
          clear: messageId => controller.clear(messageId),
        }
      },
    }, MessageFeedbackActions)
    return () => {
      dispose()
      for (const controller of controllers.values()) controller.dispose()
      controllers.clear()
    }
  })
}
