/** 独立对应 ui-trajectory；复用唯一官方 target 和会话分页。 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-trajectory/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { ConversationNode, RequestView, RunningToolCall } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import type { TrajectoryInjected, TrajectoryReading, InspectInjected } from './contract.ts'
import { Inspect } from './Inspect.tsx'
import { Trajectory } from './Trajectory.tsx'
import { zh, en } from './locales.ts'
export type * from './contract.ts'
/** 官方投影、会话及连接状态为唯一数据源。 */
export const inject = ['slots', 'locale', 'sessions', 'uiConversation', 'connection']
const EMPTY: readonly RequestView[] = []
const EMPTY_CALLS: readonly RunningToolCall[] = []
const EMPTY_NODES: readonly ConversationNode[] = []
/**
 * 只在官方 trajectory target 已注册时提供 QS 视图；移除后撤销呈现。
 * @param ctx - 浏览器插件上下文。
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('qs-ui-trajectory', { zh, en }), 'qs-ui-trajectory: dictionaries')
  const readings = new WeakMap<SessionBinding, TrajectoryReading>()
  ctx.inject(['conversationPresentation'], (scope) => {
    const shared = scope.conversationPresentation
    scope.slots.inject('qs.tool.call.actions', () => scope.slots.register({
      name: 'qs.tool.call.actions', id: 'trajectory', locale: 'qs-ui-trajectory', store: shared.store,
      inject: (sessionId): InspectInjected => ({
        hooks: { available: {
          getSnapshot: () => scope.slots.entries('qs.stage.view').some(entry => entry.options.id === 'trajectory'),
          subscribe: listener => scope.slots.subscribe('qs.stage.view', listener),
        } },
        activate: () => { shared.activate(sessionId, 'trajectory') },
      }),
    }, Inspect))
  })
  const t = ctx.locale.bind('qs-ui-trajectory')
  ctx.effect(() => {
    let release: (() => void) | undefined
    const refresh = (): void => {
      const available = ctx.uiConversation.views.entries().some(view => view.target === 'trajectory')
      if (!available) { release?.(); release = undefined; return }
      if (release !== undefined) return
      release = ctx.slots.inject('qs.stage.view', () => ctx.slots.register({
        name: 'qs.stage.view', id: 'trajectory', order: 10, label: () => t('title'), locale: 'qs-ui-trajectory',
        children: { 'qs.conversation.trajectory.images': { kind: 'single', scope: 'session' } },
        inject: (sessionId): TrajectoryInjected => {
          const binding = ctx.sessions.binding(sessionId)
          if (binding === undefined) throw new Error('QS trajectory requires a session binding')
          const session = binding.session
          let reading = readings.get(binding)
          if (reading === undefined) {
            reading = { scrollTop: 0, requests: new Set(), records: new Set() }
            readings.set(binding, reading)
          }
          const target = ctx.uiConversation.binding(sessionId).target('trajectory')
          const connection = ctx.get('connection') as ConnectionHandle
          return {
            reading,
            hooks: {
              requests: { getSnapshot: () => target.getSnapshot()?.requests ?? EMPTY, subscribe: listener => target.subscribe(listener) },
              nodes: {
                getSnapshot: () => target.getSnapshot()?.eventNodes ?? EMPTY_NODES, subscribe: listener => target.subscribe(listener),
              },
              partial: { getSnapshot: () => target.getSnapshot()?.partial ?? null, subscribe: listener => target.subscribe(listener) },
              runningCalls: {
                getSnapshot: () => target.getSnapshot()?.runningCalls ?? EMPTY_CALLS, subscribe: listener => target.subscribe(listener),
              },
              connected: { getSnapshot: () => connection.state.getSnapshot() === 'connected', subscribe: listener => connection.state.subscribe(listener) },
            },
            loadImage: Object.assign(
              (attachment: Parameters<TrajectoryInjected['loadImage']>[0]) => ctx.uiConversation.imageUrl(sessionId, attachment),
              { peek: (attachment: Parameters<TrajectoryInjected['loadImage']>[0]) => ctx.uiConversation.peekImageUrl(sessionId, attachment) },
            ),
            loadOlder: async () => { await session.loadOlder() },
          }
        },
      }, Trajectory))
    }
    const off = ctx.uiConversation.views.subscribe(refresh)
    refresh()
    return () => { off(); release?.() }
  }, 'qs-ui-trajectory: target availability')
}
