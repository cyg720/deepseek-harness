/** 会话目录树仅消费官方读取状态；文件打开经标签资源导航，不直接读取磁盘。 */
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import type { PropsRuntime, PropsStore, PropsLocale, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { FilesInjected, FilesTabState, SidebarFilesPresentation } from '@deepseek-ai/dsh-client-ui-sidebar-files/client'
import type {} from '@deepseek-ai/dsh-qs-ui-sidebar-right/client'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import type {} from './locales.ts'
import css from './files.module.css'

/** 正文与官方文件树共享同一 store 和注入工厂。 */
export type FilesProps = PropsRuntime<'qs.sidebar.right.tab'> & PropsStore<SidebarFilesPresentation['store']>
  & FilesInjected & PropsLocale<'qs-ui-sidebar-files'>
const order = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
type Tree = {
  state: FilesTabState
  t: TranslateNS<'qs-ui-sidebar-files'>
  toggle: (path: string) => void
  open: (path: string) => void
}

/** 目录递归只展开用户选中的层级，并呈现 Host 截断与失败状态。 */
function Level({ path, tree }: { path: string; tree: Tree }): ReactNode {
  const level = tree.state.levels[path], { t } = tree
  if (level === undefined || level.kind === 'loading') return <li role="status">{t('loading')}</li>
  if (level.kind === 'failed') {
    const code = level.failure.code
    const key = code === 'workspace-file/not-found' ? 'notFound' : code === 'workspace-file/outside-workspace' ? 'outside'
      : code === 'workspace-file/not-directory' ? 'notDirectory' : 'unavailable'
    return <li role="status">{t(key)}</li>
  }
  const entries = [...level.level.entries].sort((a, b) => Number(b.type === 'directory') - Number(a.type === 'directory') || order.compare(a.name, b.name))
  return <>
    {entries.length === 0 && <li>{t('empty')}</li>}
    {entries.map((entry) => {
      const child = `${path.replace(/[/\\]+$/, '')}/${entry.name}`, expanded = tree.state.expanded.includes(child)
      return <li key={entry.name}>
        {entry.type === 'directory'
          ? <><button type="button" aria-expanded={expanded} onClick={() => { tree.toggle(child) }}><span aria-hidden="true">{expanded ? '▾' : '▸'}</span>{entry.name}</button>{expanded && <ul><Level path={child} tree={tree} /></ul>}</>
          : entry.type === 'file'
            ? <button type="button" onClick={() => { tree.open(child) }}>{entry.name}</button>
            : <span aria-disabled="true" title={t('other')}>{entry.name}</span>}
      </li>
    })}
    {level.level.truncated && <li role="status">{t('truncated')}</li>}
  </>
}
/**
 * 渲染当前会话与标签的共享文件树。
 * @param props - session 座位、标签生命周期和官方目录操作。
 * @returns 目录层级、刷新入口或无工作区说明。
 */
export function Files(props: FilesProps): ReactNode {
  const { useTabInfo, useSessions, useStore, sessionId, start, load, toggle, actions, t } = props
  const { tab } = useTabInfo(), { signal } = tab
  const cwd = useSessions(sessions => sessions.byId[sessionId]?.cwd)
  const state = useStore(value => value.byTab[tab.id])
  useEffect(() => {
    if (state === undefined && cwd !== undefined && !signal.aborted) start(tab.id, cwd, signal)
  }, [state, cwd, signal, start, tab.id])
  if (cwd === undefined) return <p className={css.note}>{t('noWorkspace')}</p>
  if (state === undefined) return <p role="status" className={css.note}>{t('loading')}</p>
  const tree: Tree = { state, t,
    toggle: (path) => { toggle(tab.id, path, state.levels[path] !== undefined, signal) },
    open: (path) => { tab.actions.openResource(fileAddressFor(sessionId, state.root, path)) },
  }
  return <section className={css.root} aria-label={t('title')} data-qs-files>
    <header><span title={state.root}>{state.root}</span><button type="button" onClick={() => {
      actions.reset(tab.id)
      for (const path of state.expanded) load(tab.id, path, signal)
    }}>{t('reload')}</button></header>
    <div className={css.scroll}><ul><Level path={state.root} tree={tree} /></ul></div>
  </section>
}
/**
 * 标题随 locale 更新，不复制导航时的旧文案。
 * @param props - 当前语言字典。
 * @returns 本地化文件树标题。
 */
export function FilesTitle({ t }: PropsLocale<'qs-ui-sidebar-files'>): ReactNode { return t('title') }
