/** 欢迎区工作区入口保留自己的目录子槽和声明生命周期。 */
import type { ReactNode } from 'react'
import type { InjectFace, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { DirectoryEntry, type WorkspaceDirectoryInjected } from './DirectoryEntry.tsx'
import { WorkspaceSelector, type WorkspaceSelectorProps } from './WorkspaceSelector.tsx'

/** 欢迎区只持有呈现和目录流程动作。 */
export type WorkspaceHeroProps = WorkspaceSelectorProps & InjectFace<WorkspaceDirectoryInjected>
  & PropsRenderSlots<'qs.workspace.hero.directoryFlow'>

/**
 * 渲染欢迎区选择器和独立目录流程入口。
 * @param props - 官方工作区快照、导航及共享目录操作。
 * @returns 欢迎区工作区控件。
 */
export function WorkspaceHero(props: WorkspaceHeroProps): ReactNode {
  return <><WorkspaceSelector {...props} /><DirectoryEntry {...props}
    renderFlow={owner => props.renderSlot('qs.workspace.hero.directoryFlow', owner)} /></>
}
