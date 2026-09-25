/** 目录入口只控制请求身份和错误恢复；实际选择界面由独立流程插件贡献。 */
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { HostObservable, PropsHooks, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { DirectoryFlowOwnerProps } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { DirectoryFlow } from './directory-flow.ts'

/** 复用官方 owner 语义，并显式传递本次请求身份。 */
export interface QsDirectoryFlowOwner extends DirectoryFlowOwnerProps {
  readonly request: symbol
}

/** 注入共享控制器和本入口槽占用源。 */
export interface WorkspaceDirectoryInjected {
  readonly directory: DirectoryFlow
  readonly hooks: { readonly qsDirectoryAvailable: HostObservable<boolean> }
}

/** 两个入口共用的目录操作视图。 */
export type DirectoryEntryProps = PropsLocale<'qs-sessions'> & PropsHooks<WorkspaceDirectoryInjected['hooks']> & {
  readonly directory: DirectoryFlow
  readonly renderFlow: (owner: QsDirectoryFlowOwner) => ReactNode
}

/**
 * 只在流程插件就绪时提供添加入口，保留可取消和可重试状态。
 * @param props - 本入口占用信息、共享请求控制器及子槽渲染。
 * @returns 添加按钮与当前入口的目录流程。
 */
export function DirectoryEntry({ directory, useQsDirectoryAvailable, renderFlow, t }: DirectoryEntryProps): ReactNode {
  const [owner] = useState(() => Symbol('directory entry'))
  const snapshot = useSyncExternalStore(
    useCallback((listener: () => void) => directory.state.subscribe(listener), [directory]),
    () => directory.state.getSnapshot(),
  )
  const available = useQsDirectoryAvailable(value => value)
  useEffect(() => () => { directory.withdraw(owner) }, [directory, owner])
  useEffect(() => { if (!available) directory.withdraw(owner) }, [directory, owner, available])
  const own = snapshot.owner === owner
  const active = snapshot.phase === 'picking' || snapshot.phase === 'adopting'
  const request = snapshot.request
  return <>
    {available ? <button type="button" className="qs-text-button" disabled={active} onClick={() => { directory.begin(owner) }}>{t('directory.add')}</button> : null}
    {own && snapshot.phase === 'failed' ? <p role="alert">{t('directory.failed')}</p> : null}
    {own && active && available && request !== undefined ? <>
      <button type="button" className="qs-text-button" onClick={() => { directory.dismiss(request) }}>{t('directory.cancel')}</button>
      {snapshot.phase === 'adopting' ? <p role="status">{t('directory.adopting')}</p> : null}
      {renderFlow({ request, open: true, busy: snapshot.phase === 'adopting',
        onPicked: (path) => { void directory.picked(request, path) },
        onCancel: () => { directory.dismiss(request) },
        onError: () => { directory.failed(request) },
      })}
    </> : null}
  </>
}
