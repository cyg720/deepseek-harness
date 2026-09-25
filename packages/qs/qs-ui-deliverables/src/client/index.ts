/** 对应官方 ui-deliverables 的轮次贡献和 present 工具贡献，保留独立生命周期。 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-deliverables/client'
import type {} from '@deepseek-ai/dsh-qs-transcript/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import { Deliverables, type DeliveredInjected } from './Deliverables.tsx'
import { PresentRow } from './PresentRow.tsx'
import { zh, en } from './locales.ts'
/** 只依赖官方能力，不创建第二个交付投影或原生请求控制器。 */
export const inject = ['slots', 'locale', 'sessions', 'sidebarRight', 'deliverablesPresentation']
/**
 * 将共享交付事实绑定到 QS 轮次链和工具子槽。
 * @param ctx - 官方交付、会话及导航服务。
 */
export function apply(ctx: Context): void {
  const shared = ctx.deliverablesPresentation
  ctx.effect(() => ctx.locale.register('qs-ui-deliverables', { zh, en }), 'qs-ui-deliverables: dictionaries')
  ctx.slots.inject('qs.chat.turn-tail', () => ctx.slots.register({
    name: 'qs.chat.turn-tail', select: shared.select, locale: 'qs-ui-deliverables',
    inject: (sessionId): DeliveredInjected => ({ ...shared.injected, fileKey: shared.key,
      openFile: (path) => {
        const cwd = ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd
        ctx.sidebarRight.openResource(fileAddressFor(sessionId, cwd, path))
      },
    }),
  }, Deliverables))
  ctx.slots.inject('qs.tool.call.toolview', () => ctx.slots.register({
    name: 'qs.tool.call.toolview', key: 'present', locale: 'qs-ui-deliverables',
  }, PresentRow))
}
