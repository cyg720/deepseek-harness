/**
 * Feedback surface plugin, browser half: the Like/Dislike entry in the
 * conversation.chat.assistant-actions strip, the feedback dialog and its
 * acknowledgement and failure toasts in conversation.input.overlay, and the `/feedback`
 * decoration that opens the dialog from the composer menu or a bare typed
 * command. One FeedbackSurface per Session backs every entry in that Session.
 * @module @deepseek-ai/dsh-client-ui-message-feedback/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the generated Remote API and ctx.remote merge through the Client assembly boundary.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the ui-conversation SlotMap merge (the assistant-actions and overlay entries).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the command UI's Context merge (ctx.commandUi).
import type {} from '@deepseek-ai/dsh-client-ui-commands/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { FeedbackDialog } from './FeedbackDialog.tsx'
import { MessageFeedbackActions } from './MessageFeedbackActions.tsx'
import type { FeedbackDialogInjected, MessageFeedbackInjected } from './slots.ts'
import { FeedbackSurface } from './surface.ts'
import { en, zh } from './locales.ts'

export type {
  MessageFeedbackActionFailure, MessageFeedbackActionResult, MessageFeedbackStatus,
  MessageFeedbackView,
} from './controller.ts'
export type { FeedbackDialogState, FeedbackDialogTarget, FeedbackSubmit } from './dialog.ts'
export type {
  FeedbackDialogInjected, FeedbackDialogProps, MessageFeedbackActionProps, MessageFeedbackInjected,
} from './slots.ts'
export type { MessageFeedbackKey } from './locales.ts'

/** 共享反馈呈现入口；两套界面复用同一会话草稿和提交状态。 */
export interface MessageFeedbackPresentation {
  /**
   * 读取共享消息反馈呈现。
   * @param sessionId - 会话标识。
   * @returns 消息反馈动作与订阅源。
   */
  actions(sessionId: SessionId): MessageFeedbackInjected
  /**
   * 读取共享会话反馈弹层。
   * @param sessionId - 会话标识。
   * @returns 会话反馈弹层动作与订阅源。
   */
  dialog(sessionId: SessionId): FeedbackDialogInjected
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** 官方与二开呈现共享的唯一反馈执行器。 */
    messageFeedbackPresentation: MessageFeedbackPresentation
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'feedback'

/** Required services: the slot registry, the two Remote namespaces, and the copy. */
export const inject = ['slots', 'remote', 'remote.messageFeedback', 'remote.sessionFeedback', 'locale']

/**
 * Client plugin body: the per-message feedback entry, the Session's dialog
 * entry, the `/feedback` decoration, and their per-session surfaces.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-message-feedback: dictionaries')

  const surfaces = new Map<SessionId, FeedbackSurface>()
  const surfaceFor = (sessionId: SessionId): FeedbackSurface => {
    let surface = surfaces.get(sessionId)
    if (surface === undefined) {
      surface = new FeedbackSurface(ctx, sessionId)
      surfaces.set(sessionId, surface)
    }
    return surface
  }
  ctx.effect(() => () => {
    for (const surface of surfaces.values()) surface.dispose()
    surfaces.clear()
  }, 'ui-message-feedback: per-session surfaces')

  // A reconnect can only invalidate what was already read; a cold Session
  // stays cold until something asks for it.
  ctx.on('connection/reset', () => {
    for (const { feedback } of surfaces.values()) {
      if (feedback.getSnapshot().status !== 'cold') void feedback.resync()
    }
  })

  // 二开只取得呈现动作，不复制 Surface 或重复注册 /feedback。
  const presentation: MessageFeedbackPresentation = {
    actions: (sessionId): MessageFeedbackInjected => {
      const { feedback, dialog } = surfaceFor(sessionId)
      return {
        hooks: { feedback },
        ensure: () => feedback.ensure(),
        current: messageId => feedback.getSnapshot().items.get(messageId),
        retract: (messageId, rating) => feedback.retract(messageId, rating),
        openDialog: (messageId, rating) => { dialog.open({ kind: 'message', messageId, rating }) },
      }
    },
    dialog: (sessionId): FeedbackDialogInjected => {
      const { dialog } = surfaceFor(sessionId)
      return {
        hooks: { dialog: dialog.state },
        edit: (draft) => { dialog.edit(draft) },
        submit: () => dialog.submitDraft(),
        dismiss: () => { dialog.dismiss() },
        dismissFailure: () => { dialog.dismissFailure() },
        dismissToast: (seq) => { dialog.dismissToast(seq) },
      }
    },
  }
  ctx.effect(() => ctx.reflect.provide('messageFeedbackPresentation', presentation), 'ui-message-feedback: shared presentation')

  ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
    name: 'conversation.chat.assistant-actions',
    id: 'feedback',
    order: 10,
    locale: NS,
    inject: sessionId => presentation.actions(sessionId),
  }, MessageFeedbackActions))

  ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({
    name: 'conversation.input.overlay',
    id: 'feedback-dialog',
    order: 2,
    locale: NS,
    inject: sessionId => presentation.dialog(sessionId),
  }, FeedbackDialog))

  // The Host keeps `/feedback <text>` for a typed remark; a bare invocation
  // from the menu or the composer opens the dialog instead.
  ctx.inject(['commandUi'], (scope: ClientContext) => {
    scope.effect(() => scope.commandUi.decorate({
      name: 'feedback',
      available: () => true,
      ui: { kind: 'action', run: (session) => { surfaceFor(session.sessionId).dialog.open({ kind: 'session' }) } },
    }), 'ui-message-feedback: /feedback decoration')
  })
}
