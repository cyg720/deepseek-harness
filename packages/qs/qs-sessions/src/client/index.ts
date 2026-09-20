/**
 * 会话导航的浏览器入口。
 *
 * 向 `qs.nav` 贡献会话列表（该槽由 qs-shell 声明，未声明时本贡献等待）。
 * 归档走 `ctx.workspaces.archiveSession`：官方公开面**没有** delete，本阶段文案与
 * 行为都是"归档"。本地置顶由 qs-sessions 自己持有，不冒充服务端状态。
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ISessions, SessionFace } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
// 仅类型：引入 SlotRegistry 的 ctx.slots 服务合并、会话座席与语言。
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { QsArchivedSessionsSource, QsSessionListInjected } from './contract.ts'
import { en, zh } from './locales.ts'
import { createQsPinsStore } from './pins-store.ts'
import { SessionList } from './SessionList.tsx'
import { createSessionActions } from './use-session-actions.ts'

/** 本包的本地化命名空间。 */
const NS = 'qs-sessions'

/** 必需服务：槽注册表、语言、会话面与工作区面（归档）。 */
export const inject = ['slots', 'locale', 'sessions', 'workspaces']

/** 契约再导出。 */
export type * from './contract.ts'
export type { SessionActions } from './use-session-actions.ts'

/**
 * 安装会话导航。
 * @param ctx - 浏览器根上下文。
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'qs-sessions: dictionaries')

  const sessions = ctx.get('sessions') as ISessions
  const workspaces = ctx.get('workspaces') as IWorkspaces
  const pins = createQsPinsStore()

  // 归档集合由工作区面持有；组件不能读 ctx，所以经本条目自己的 inject face 发布成座席。
  const archivedSource: QsArchivedSessionsSource = {
    getSnapshot: () => workspaces.list.getSnapshot().archivedSessionIds,
    subscribe: listener => workspaces.list.subscribe(listener),
  }

  const actions = createSessionActions({
    sessions,
    workspaces,
    faceOf: (id: SessionId): SessionFace | undefined => sessions.binding(id)?.session,
  })

  ctx.slots.inject('qs.nav', () => ctx.slots.register({
    name: 'qs.nav',
    locale: NS,
    store: pins,
    inject: (): QsSessionListInjected => ({
      hooks: { qsArchivedSessions: archivedSource },
      selectSession: (id: SessionId): void => { actions.open(id) },
      createSession: async (signal): Promise<boolean> => (await actions.create(signal)) !== undefined,
      renameSession: (id: SessionId, title: string): Promise<boolean> => actions.rename(id, title),
      archiveSession: (id: SessionId): Promise<boolean> => actions.archive(id),
      canArchive: (id: SessionId, pending: ReadonlySet<SessionId>): boolean => actions.canArchive(id, pending),
    }),
  }, SessionList))
}
