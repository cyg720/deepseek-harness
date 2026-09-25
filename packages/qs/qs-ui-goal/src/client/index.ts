/** 对应官方 ui-goal 的两个呈现贡献；共享激活订阅和历史 Definition。 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-goal/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { GoalInjected } from './contract.ts'
import { GoalDock } from './GoalDock.tsx'
import { GoalCommandRow } from './GoalCommandRow.tsx'
import { zh, en } from './locales.ts'
export type * from './contract.ts'

/** 官方服务缺失时撤销呈现，不伪造目标状态。 */
export const inject = ['slots', 'locale', 'goalPresentation', 'connection', 'remote', 'remote.goals']

/**
 * 注册独立目标 dock 和命令输入历史行。
 * @param ctx - 浏览器根上下文。
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('qs-ui-goal', { zh, en }), 'qs-ui-goal: dictionaries')
  ctx.slots.inject('qs.composer.dock', () => ctx.slots.register({
    name: 'qs.composer.dock', id: 'qs-goal', order: 10, locale: 'qs-ui-goal',
    inject: (sessionId): GoalInjected => {
      const shared = ctx.goalPresentation.bind(sessionId)
      const connection = ctx.get('connection') as ConnectionHandle
      return {
        ...shared,
        hooks: { ...shared.hooks, goalConnected: {
          getSnapshot: () => connection.state.getSnapshot() === 'connected',
          subscribe: listener => connection.state.subscribe(listener),
        } },
        onCreate: objective => ctx.remote.goals.create(sessionId, { objective }),
        onRefresh: () => ctx.remote.goals.get(sessionId),
      }
    },
  }, GoalDock))
  ctx.slots.inject('qs.stage.transcript.row', () => ctx.slots.register({
    name: 'qs.stage.transcript.row', key: 'command-input', locale: 'qs-ui-goal',
  }, GoalCommandRow))
}
