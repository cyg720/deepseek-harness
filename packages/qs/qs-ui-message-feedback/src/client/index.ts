/** 对应官方反馈呈现，共享唯一执行器，不重复注册 /feedback。 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-message-feedback/client'
import type {} from '@deepseek-ai/dsh-qs-composer/client'
import type {} from '@deepseek-ai/dsh-qs-transcript/client'
import { Actions } from './Actions.tsx'
import { Feedback } from './Feedback.tsx'
import { zh, en } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'qs-ui-message-feedback': keyof typeof zh }
}
/** 官方共享反馈执行器及呈现基础服务。 */
export const inject = ['slots', 'locale', 'messageFeedbackPresentation']
/**
 * 独立注册消息按钮和会话弹层；所有贡献随插件卸载释放。
 * @param ctx - 当前插件上下文。
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('qs-ui-message-feedback', { zh, en }), 'qs-ui-message-feedback: dictionaries')
  ctx.slots.inject('qs.chat.assistant-actions', () => ctx.slots.register({
    name: 'qs.chat.assistant-actions', id: 'qs-feedback', order: 10, locale: 'qs-ui-message-feedback',
    inject: sessionId => ctx.messageFeedbackPresentation.actions(sessionId),
  }, Actions))
  ctx.slots.inject('qs.composer.overlay', () => ctx.slots.register({
    name: 'qs.composer.overlay', id: 'qs-feedback-dialog', order: 2, locale: 'qs-ui-message-feedback',
    inject: sessionId => ctx.messageFeedbackPresentation.dialog(sessionId),
  }, Feedback))
}
