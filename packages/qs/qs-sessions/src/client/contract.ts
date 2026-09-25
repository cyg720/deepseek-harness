import type {} from '@deepseek-ai/dsh-qs-composer/client'
import type {} from '@deepseek-ai/dsh-qs-ui-sidebar/client'
/** qs-sessions 的契约：会话导航的共享类型与本地化键。 */
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// 仅类型：引入 qs-shell 声明的 qs.nav 槽。
import type {} from '@deepseek-ai/dsh-qs-shell/client'
import type { createQsPinsStore } from './pins-store.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** 欢迎区目录选择子槽，与侧栏共用请求身份控制。 */
    'qs.workspace.hero.directoryFlow': { kind: 'single'; scope: 'root'; owner: import('./DirectoryEntry.tsx').QsDirectoryFlowOwner }
    /** 侧栏目录选择子槽，随导航呈现释放。 */
    'qs.workspace.sidebar.directoryFlow': { kind: 'single'; scope: 'root'; owner: import('./DirectoryEntry.tsx').QsDirectoryFlowOwner }
  }
  interface LocaleNamespaceMap {
    'qs-sessions': QsSessionsLocaleKey
  }

}

/** 归档集合源。 */
export type QsArchivedSessionsSource = HostObservable<readonly SessionId[]>

/** 一行会话的视图模型。 */
export interface SessionRowView {
  readonly id: SessionId
  readonly title: string
  readonly pinned: boolean
  readonly running: boolean
}

/** 会话列表的 inject face：列表本身不直连服务，动作与归档集合全部经这里。 */
export interface QsSessionListInjected {
  readonly hooks: {
    /**
     * 归档集合源，框架绑成 `useQsArchivedSessions`。
     *
     * 归档是**集合**而不是删除记录：列表必须一起消费它，否则归档后的会话仍然显示。
     */
    readonly qsArchivedSessions: QsArchivedSessionsSource
  }
  /** 打开会话。 */
  readonly selectSession: (id: SessionId) => void
  /** 新建会话；取消只撤销本地导航，失败返回 false。 */
  readonly createSession: (signal: AbortSignal) => Promise<boolean>
  /** 重命名。 */
  readonly renameSession: (id: SessionId, title: string) => Promise<boolean>
  /** 归档。 */
  readonly archiveSession: (id: SessionId) => Promise<boolean>
  /** 归档前检查：空闲、无待发任务、无待答复请求。 */
  readonly canArchive: (id: SessionId, pending: ReadonlySet<SessionId>) => boolean
}

/** 会话列表条目的完整 props。 */
export type QsSessionListProps =
  PropsRuntime<'qs.nav'>
  & PropsStore<ReturnType<typeof createQsPinsStore>>
  & InjectFace<QsSessionListInjected>
  & PropsLocale<'qs-sessions'>

/** qs-sessions 的本地化键。 */
export type QsSessionsLocaleKey =
  | 'directory.add' | 'directory.cancel' | 'directory.failed' | 'directory.adopting'
  | 'workspace.title' | 'workspace.choose' | 'workspace.failed' | 'workspace.listFailed' | 'workspace.loading' | 'workspace.empty' | 'workspace.opening'
  | 'group.pinned'
  | 'group.recent'
  | 'list.empty'
  | 'list.emptyLead'
  | 'list.new'
  | 'list.newShortcut'
  | 'row.manage'
  | 'menu.title'
  | 'menu.pin'
  | 'menu.unpin'
  | 'menu.rename'
  | 'menu.archive'
  | 'menu.close'
  | 'rename.title'
  | 'rename.label'
  | 'rename.save'
  | 'archive.title'
  | 'archive.confirm'
  | 'archive.cancel'
  | 'archive.busy'
  | 'error.generic'
