/** 对应官方 ui-jobs；共享同一 Session 控制流，不轮询或复制状态。 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import { Jobs } from './Jobs.tsx'
import { zh, en } from './locales.ts'
import type { JobsInjected } from './contract.ts'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { IQsAuth, IQsToast, IQsUiMode } from '@deepseek-ai/dsh-qs-shell/client'
import { watchJobNotifications } from './notification-owner.ts'
export type * from './contract.ts'
/** 注册、语言与官方会话服务。 */
export const inject = ['slots', 'locale', 'sessions']
/**
 * 注册独立会话标题动作，宿主卸载时自动撤销贡献。
 * @param ctx - 浏览器根上下文。
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('qs-ui-jobs', { zh, en }), 'qs-ui-jobs: dictionaries')
  ctx.inject(['qsToast', 'qsAuth', 'qsShell', 'connection'], (scope) => {
    const t = scope.locale.bind('qs-ui-jobs')
    scope.effect(() => watchJobNotifications({
      sessions: scope.sessions,
      connection: scope.get('connection') as ConnectionHandle,
      auth: scope.get('qsAuth') as IQsAuth,
      ui: scope.get('qsShell') as IQsUiMode,
      toast: scope.get('qsToast') as IQsToast,
      format: ({ sessionId, job }) => t(job.status === 'completed' ? 'notifyCompleted'
        : job.status === 'failed' ? 'notifyFailed' : 'notifyKilled', {
        session: scope.sessions.list.getSnapshot().byId[sessionId]?.displayTitle ?? sessionId,
      }),
    }), 'qs-ui-jobs: observed task notifications')
  })
  ctx.slots.inject('qs.stage.header.actions', () => ctx.slots.register({
    name: 'qs.stage.header.actions', id: 'qs-jobs', order: 20, locale: 'qs-ui-jobs',
    inject: (): JobsInjected => ({
      hooks: { qsJobsControl: ctx.sessions.control.state },
      retry: () => ctx.sessions.control.retry(),
    }),
  }, Jobs))
}
