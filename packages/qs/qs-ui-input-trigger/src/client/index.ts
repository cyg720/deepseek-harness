/** 对应官方 ui-input-trigger 的 QS 呈现，复用唯一 inputTriggers 服务。 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type {} from '@deepseek-ai/dsh-qs-composer/client'
import { CommandMenu, type CommandMenuInjected } from './CommandMenu.tsx'
import { zh, en } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'qs-ui-input-trigger': keyof typeof zh }
}
/** 注册及会话控制器解析需要的官方服务。 */
export const inject = ['slots', 'locale', 'sessions', 'conversation', 'inputTriggers']
/**
 * 注册独立菜单贡献，槽卸载自动移除视图和订阅。
 * @param ctx - 当前插件上下文。
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('qs-ui-input-trigger', { zh, en }), 'qs-ui-input-trigger: dictionaries')
  ctx.slots.inject('qs.composer.overlay', () => ctx.slots.register({
    name: 'qs.composer.overlay', id: 'qs-command-menu', locale: 'qs-ui-input-trigger', order: 0,
    inject: (sessionId): CommandMenuInjected => {
      const scope = ctx.sessions.scope(sessionId)
      if (scope === undefined) throw new Error('qs-ui-input-trigger: session scope unavailable')
      return { controller: ctx.inputTriggers.sessionOf(scope), input: ctx.conversation.input.for(scope) }
    },
  }, CommandMenu))
}
