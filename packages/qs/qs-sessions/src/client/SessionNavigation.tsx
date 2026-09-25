/** 工作区选择与会话列表属于同一官方 ui-workspace 对应插件。 */
import type { InjectFace, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { DirectoryEntry, type WorkspaceDirectoryInjected } from './DirectoryEntry.tsx'
import type { ReactNode } from 'react'
import type { QsSessionListProps } from './contract.ts'
import { SessionList } from './SessionList.tsx'
import { WorkspaceSelector, type WorkspaceNavigationInjected } from './WorkspaceSelector.tsx'

/** 导航条目增加可等待的官方工作区动作。 */
export type SessionNavigationProps = QsSessionListProps & WorkspaceNavigationInjected & InjectFace<WorkspaceDirectoryInjected>
  & PropsRenderSlots<'qs.workspace.sidebar.directoryFlow'>

/**
 * 挂载工作区入口和原有会话列表，保持两者的业务状态由官方服务持有。
 * @param props - 会话座席、工作区座席与本地置顶。
 * @returns 完整侧栏导航区域。
 */
export function SessionNavigation(props: SessionNavigationProps): ReactNode {
  return <><div data-qs-workspace-entry="sidebar"><WorkspaceSelector {...props} /><DirectoryEntry {...props}
    renderFlow={owner => props.renderSlot('qs.workspace.sidebar.directoryFlow', owner)} /></div><SessionList {...props} /></>
}
