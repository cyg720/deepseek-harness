/** 谱系及惰性后代目录；每个挂载分支对应官方的一次目录观察。 */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import { useDismissOnOutsidePointer } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CatalogProps } from './contract.ts'
import css from './Subagent.module.css'

type BranchProps = Pick<CatalogProps, 'setCatalogOpen' | 'refresh' | 'openChild' | 't'> & {
  readonly id: SessionId
  readonly state: SessionListState
  readonly ancestors: readonly SessionId[]
  readonly close: () => void
}

/** 只拦截子会话导航按钮的方向键，保留目录选择器和其他表单控件的原生操作。 */
function navigateCatalog(event: KeyboardEvent<HTMLElement>): void {
  const target = event.target
  if (!(target instanceof HTMLButtonElement) || !target.hasAttribute('data-qs-child')) return
  const items = event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-qs-child]')
  const index = [...items].indexOf(target)
  // 标记只放在下方 li 的直接导航按钮上，当前按钮保证列表非空。
  const row = target.parentElement as HTMLLIElement
  const expand = row.querySelector<HTMLButtonElement>(':scope > [data-qs-expand]')
  switch (event.key) {
    case 'Home': items.item(0).focus(); break
    case 'End': items.item(items.length - 1).focus(); break
    case 'ArrowDown': items.item((index + 1) % items.length).focus(); break
    case 'ArrowUp': items.item((index + items.length - 1) % items.length).focus(); break
    case 'ArrowRight':
      if (expand?.getAttribute('aria-expanded') === 'false') expand.click()
      else row.querySelector<HTMLButtonElement>(':scope > div [data-qs-child]')?.focus()
      break
    case 'ArrowLeft':
      if (expand?.getAttribute('aria-expanded') === 'true') expand.click()
      else row.parentElement?.closest('li')?.querySelector<HTMLButtonElement>(':scope > [data-qs-child]')?.focus()
      break
    default: return
  }
  event.preventDefault()
}

function Branch({ id, state, ancestors, setCatalogOpen, refresh, openChild, t, close }: BranchProps): ReactNode {
  const [expanded, setExpanded] = useState<ReadonlySet<SessionId>>(new Set())
  useEffect(() => {
    setCatalogOpen(id, true)
    return () => { setCatalogOpen(id, false) }
  }, [id, setCatalogOpen])
  const catalog = state.subagentsByParent[id]
  return <div>
    {catalog === undefined || catalog.state === 'loading' ? <p role="status">{t('loading')}</p> : null}
    {catalog?.state === 'error' ? <p role="alert">{t('error')}</p> : null}
    {catalog?.parentAvailable === false ? <p role="status">{t('parent-unavailable')}</p> : null}
    <button type="button" className={css.button} disabled={catalog?.state === 'loading'} onClick={() => { refresh(id) }}>{t('refresh')}</button>
    {catalog?.state === 'ready' && catalog.entries.length === 0 ? <p>{t('empty')}</p> : null}
    <ul className={css.list}>
      {catalog?.entries.map(entry => <li className={css.row} key={entry.id}>
        {entry.kind === 'diagnostic' ? <span>{entry.id}<small className={css.meta}>{t(entry.reason)}</small></span> : <>
          <button type="button" className={css.button} data-qs-child aria-current={state.current === entry.id ? 'page' : undefined} onClick={() => {
            openChild({ parentSessionId: id, childSessionId: entry.id, mode: entry.mode }); close()
          }}>{entry.label ?? state.byId[entry.id]?.displayTitle ?? t('unknown')}</button>
          <span className={css.meta}>{t(entry.mode === 'one-shot' ? 'oneShot' : 'continuable')} · {t(entry.activity)}</span>
          {entry.hasChildren ? <button type="button" className={css.button} data-qs-expand aria-expanded={expanded.has(entry.id)} onClick={() => {
            setExpanded((previous) => {
              const next = new Set(previous)
              if (next.has(entry.id)) next.delete(entry.id)
              else next.add(entry.id)
              return next
            })
          }}>{t(expanded.has(entry.id) ? 'collapse' : 'expand')}</button> : null}
          {entry.hasChildren && expanded.has(entry.id) ? ancestors.includes(entry.id) || entry.id === id
            ? <p role="alert">{t('cycle')}</p>
            : <Branch id={entry.id} state={state} ancestors={[...ancestors, id]} setCatalogOpen={setCatalogOpen}
              refresh={refresh} openChild={openChild} t={t} close={close} /> : null}
        </>}
      </li>)}
    </ul>
  </div>
}

function Panel({ sessionId, useSessions, openParent, ...actions }: CatalogProps): ReactNode {
  const state = useSessions(value => value)
  const { t } = actions
  const [open, setOpen] = useState(false)
  const [catalogRoot, setCatalogRoot] = useState(sessionId)
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null)
  useDismissOnOutsidePointer(root, open, setOpen)
  const close = (): void => { setOpen(false); trigger.current?.focus() }
  const ancestors: SessionId[] = []
  const seen = new Set<SessionId>([sessionId])
  let parent = state.currentAddress?.childSessionId === sessionId ? state.currentAddress.parentSessionId : state.byId[sessionId]?.parentId
  while (parent !== undefined && !seen.has(parent)) {
    seen.add(parent); ancestors.unshift(parent)
    const summary = state.byId[parent]
    parent = summary?.origin === 'subagent' ? summary.parentId : undefined
  }
  return <div ref={root} className={css.root} data-qs-subagent onKeyDown={(event) => {
    if (event.key === 'Escape' && open) { event.preventDefault(); close() }
  }}>
    <button ref={trigger} type="button" className={css.button} aria-expanded={open} onClick={() => { setOpen(value => !value) }}>{t('title')}</button>
    {open ? <section className={css.panel} aria-label={t('title')} onKeyDown={navigateCatalog}>
      <nav className={css.lineage} aria-label={t('lineage')}>{ancestors.map(id => <button key={id} type="button" className={css.button}
        onClick={() => { openParent(id); close() }}>{state.byId[id]?.displayTitle ?? t('parent')}</button>)}</nav>
      {/* 浏览祖先目录不改变当前会话，兄弟导航仍使用目录返回的完整地址。 */}
      <label className={css.scope}>{t('catalogScope')}
        <select value={catalogRoot} className={css.button} onChange={(event) => {
          const selected = [...ancestors, sessionId].find(id => id === event.currentTarget.value)
          if (selected !== undefined) setCatalogRoot(selected)
        }}>
          {ancestors.map(id => <option key={id} value={id}>{state.byId[id]?.displayTitle ?? t('parent')}</option>)}
          <option value={sessionId}>{t('currentChildren')}</option>
        </select>
      </label>
      <Branch key={catalogRoot} id={catalogRoot} state={state} ancestors={[]} close={close} {...actions} />
      <button type="button" className={css.button} onClick={close}>{t('close')}</button>
    </section> : null}
  </div>
}

/**
 * 按选中会话重建目录展开状态，旧会话订阅随组件卸载释放。
 * @param props - 官方会话数据、目录动作及独立语言字典。
 * @returns 子代理目录与谱系入口。
 */
export function Catalog(props: CatalogProps): ReactNode { return <Panel key={props.sessionId} {...props} /> }
