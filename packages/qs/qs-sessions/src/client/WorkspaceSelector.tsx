/** 已登记工作区入口；创建/复用空白会话及导航竞态交给官方 uiWorkspace。 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import css from './sessions.module.css'

/** 工作区导航使用官方的可等待动作，保留业务失败供本入口提示。 */
export interface WorkspaceNavigationInjected {
  /**
   * 打开工作区，复用合适的空白会话或创建会话。
   * @param id - 官方列表中的工作区标识。
   * @returns 导航处理完成；被后续导航取代时不抢回选择。
   */
  readonly openWorkspace: (id: WorkspaceId) => Promise<void>
}

/** 选择器不持有第二份工作区列表。 */
export type WorkspaceSelectorProps = Pick<PropsRuntime<'qs.nav'>, 'useWorkspaces' | 'useSessions'>
  & WorkspaceNavigationInjected & PropsLocale<'qs-sessions'>

/**
 * 展示官方工作区和当前会话所属路径，异步失败仅更新仍挂载的入口。
 * @param props - 官方列表 hook、导航动作和语言。
 * @returns 已登记工作区选择表单。
 */
export function WorkspaceSelector({ useWorkspaces, useSessions, openWorkspace, t }: WorkspaceSelectorProps): ReactNode {
  const workspace = useWorkspaces(value => value)
  const cwd = useSessions(value => value.current === undefined ? undefined : value.byId[value.current]?.cwd)
  const current = workspace.items.find(item => item.path === cwd)
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false)
  const pending = useRef(false), alive = useRef(false)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const choose = async (id: WorkspaceId): Promise<void> => {
    if (pending.current) return
    pending.current = true; setBusy(true); setFailed(false)
    try { await openWorkspace(id) } catch {
      // 业务失败显示通用提示，不将远端路径诊断或堆栈作为页面正文。
      if (alive.current) setFailed(true)
    } finally {
      pending.current = false
      if (alive.current) setBusy(false)
    }
  }
  const ready = workspace.phase === 'ready' && workspace.state !== 'error'
  return <section className={css.workspace} aria-label={t('workspace.title')}>
    <label>{t('workspace.title')}
      <select className={css.workspaceSelect} value={current?.workspaceId ?? ''} disabled={!ready || busy || workspace.items.length === 0}
        onChange={(event) => {
          const next = workspace.items.find(item => item.workspaceId === event.currentTarget.value)
          if (next !== undefined) void choose(next.workspaceId)
        }}>
        <option value="" disabled>{t('workspace.choose')}</option>
        {workspace.items.map(item => <option key={item.workspaceId} value={item.workspaceId}>{item.title}</option>)}
      </select>
    </label>
    {current === undefined ? null : <small className={css.workspacePath} data-qs-workspace-path>{current.path}</small>}
    {workspace.state === 'error' || failed ? <p role="alert">{t(workspace.state === 'error' ? 'workspace.listFailed' : 'workspace.failed')}</p>
      : !ready ? <p role="status">{t('workspace.loading')}</p>
        : workspace.items.length === 0 ? <p>{t('workspace.empty')}</p> : null}
    {busy ? <p role="status">{t('workspace.opening')}</p> : null}
  </section>
}
