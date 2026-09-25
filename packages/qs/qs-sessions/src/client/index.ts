/** Workspace/session navigation corresponding to official ui-workspace. */
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
import { SessionNavigation } from './SessionNavigation.tsx'
import type { WorkspaceNavigationInjected } from './WorkspaceSelector.tsx'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { WorkspaceHero } from './WorkspaceHero.tsx'
import { createDirectoryFlow } from './directory-flow.ts'
import type { WorkspaceDirectoryInjected } from './DirectoryEntry.tsx'
import { createSessionActions } from './use-session-actions.ts'

/** 本包的本地化命名空间。 */
const NS = 'qs-sessions'

/** 必需服务：槽注册表、语言、会话面与工作区面（归档）。 */
export const inject = ['slots', 'locale', 'sessions', 'workspaces', 'uiWorkspace']

/** 契约再导出。 */
export type * from './contract.ts'
export type { QsDirectoryFlowOwner } from './DirectoryEntry.tsx'
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
  const directory = createDirectoryFlow({
    create: async path => (await workspaces.create({ path })).workspaceId,
    open: (id, isCurrent) => ctx.uiWorkspace.openWorkspace(id, () => {
      // 目录登记后的会话创建也可能被撤销；官方 beforeOpen 在真正选择前检查身份。
      if (!isCurrent()) throw new Error('Directory selection superseded')
    }),
  })
  // 会话切换撤销待采纳目录；插件释放后所有迟到回调失效。
  ctx.effect(() => {
    let current = sessions.list.getSnapshot().current
    const unsubscribe = sessions.list.subscribe(() => {
      const next = sessions.list.getSnapshot().current
      if (current !== next) { current = next; directory.cancel() }
    })
    return () => { unsubscribe(); directory.dispose() }
  }, 'qs-sessions: directory lifecycle')
  const directoryFace = (hole: 'qs.workspace.hero.directoryFlow' | 'qs.workspace.sidebar.directoryFlow'): WorkspaceDirectoryInjected => ({
    directory,
    hooks: { qsDirectoryAvailable: {
      getSnapshot: () => ctx.slots.entries(hole).length > 0,
      subscribe: listener => ctx.slots.subscribe(hole, listener),
    } },
  })
  const sidebarDirectory = directoryFace('qs.workspace.sidebar.directoryFlow')
  const heroDirectory = directoryFace('qs.workspace.hero.directoryFlow')
  const openWorkspace: WorkspaceNavigationInjected['openWorkspace'] = (id) => {
    directory.cancel()
    return ctx.uiWorkspace.openWorkspace(id)
  }

  // 归档集合由工作区面持有；组件不能读 ctx，所以经本条目自己的 inject face 发布成座席。
  const archivedSource: QsArchivedSessionsSource = {
    getSnapshot: () => workspaces.list.getSnapshot().archivedSessionIds,
    subscribe: listener => workspaces.list.subscribe(listener),
  }

  const actions = createSessionActions({
    sessions,
    workspaces,
    navigation: ctx.uiWorkspace,
    faceOf: (id: SessionId): SessionFace | undefined => sessions.binding(id)?.session,
  })

  ctx.slots.inject('qs.nav', () => ctx.slots.register({
    name: 'qs.nav',
    children: { 'qs.workspace.sidebar.directoryFlow': { kind: 'single', scope: 'root' } },
    locale: NS,
    store: pins,
    inject: (): QsSessionListInjected & WorkspaceNavigationInjected & WorkspaceDirectoryInjected => ({
      ...sidebarDirectory,
      openWorkspace,
      hooks: { ...sidebarDirectory.hooks, qsArchivedSessions: archivedSource },
      selectSession: (id: SessionId): void => { directory.cancel(); actions.open(id) },
      createSession: async (signal): Promise<boolean> => { directory.cancel(); return (await actions.create(signal)) !== undefined },
      renameSession: (id: SessionId, title: string): Promise<boolean> => actions.rename(id, title),
      archiveSession: (id: SessionId): Promise<boolean> => actions.archive(id),
      canArchive: (id: SessionId, pending: ReadonlySet<SessionId>): boolean => actions.canArchive(id, pending),
    }),
  }, SessionNavigation))
  // 与官方一致由工作区插件填充欢迎入口，输入插件只拥有槽位。
  ctx.slots.inject('qs.workspace.hero', () => ctx.slots.register({
    name: 'qs.workspace.hero', locale: NS,
    children: { 'qs.workspace.hero.directoryFlow': { kind: 'single', scope: 'root' } },
    inject: (): WorkspaceNavigationInjected & WorkspaceDirectoryInjected => ({ ...heroDirectory, openWorkspace }),
  }, WorkspaceHero))
}
