/** 对应官方 ui-commands 的独立 QS 视图，官方 commandUi 服务保持唯一。 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-commands/client'
import type {} from '@deepseek-ai/dsh-qs-composer/client'
import { CommandPopup, type CommandPopupInjected } from './CommandPopup.tsx'
import { zh, en } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'qs-ui-commands': keyof typeof zh }
}
/** 选项视图依赖官方命令、会话和槽服务。 */
export const inject = ['slots', 'locale', 'sessions', 'commandUi']
/**
 * 注册会话级命令弹层；卸载自动移除贡献和字典。
 * @param ctx - 插件上下文。
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('qs-ui-commands', { zh, en }), 'qs-ui-commands: dictionaries')
  ctx.slots.inject('qs.composer.overlay', () => ctx.slots.register({
    name: 'qs.composer.overlay', id: 'qs-command-popup', locale: 'qs-ui-commands', order: 1,
    inject: (sessionId): CommandPopupInjected => {
      const scope = ctx.sessions.scope(sessionId)
      if (scope === undefined) throw new Error('qs-ui-commands: session scope unavailable')
      return { popup: ctx.commandUi.popupFor(scope), bindFocus: focus => ctx.commandUi.bindComposerFocus(sessionId, focus) }
    },
  }, CommandPopup))
}
