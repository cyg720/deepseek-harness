/** QS 目录弹层仅呈现 Host 返回的路径，窗口关闭立即撤销迟到操作的导航权。 */
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { QsDirectoryFlowOwner } from '@deepseek-ai/dsh-qs-sessions/client'
import { createBrowseController, type BrowseController, type BrowseOperations } from './browser-state.ts'
import css from './browser.module.css'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'qs-directory-browser': keyof typeof import('./locales.ts').zh }
}

/** 双入口提供请求身份，插件仅注入官方目录操作与本地化文案。 */
export type BrowseFlowProps = QsDirectoryFlowOwner & BrowseOperations & PropsLocale<'qs-directory-browser'>

function BrowserPanel({ controller, ...props }: BrowseFlowProps & { controller: BrowseController }): ReactNode {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const [path, setPath] = useState(''), [name, setName] = useState(''), [hidden, setHidden] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const { t } = props
  const locked = state.loading || state.creating || props.busy
  const listing = state.listing
  const parent = listing?.crumbs.at(-2)
  const close = (): void => { controller.dispose(); props.onCancel() }
  useEffect(() => { if (listing !== undefined) setPath(listing.path) }, [listing])
  useEffect(() => {
    const previous = document.activeElement
    input.current?.focus()
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [])
  const entries = listing?.entries.filter(entry => hidden || !entry.hidden) ?? []
  return <Modal open title={t('title')} closeLabel={t('cancel')} onClose={close} className={css.dialog}>
    <div className={css.content} data-qs-directory-browser onKeyDown={(event) => {
      if (event.key !== 'Tab') return
      const controls = event.currentTarget.querySelectorAll<HTMLElement>(':is(button, input):not(:disabled)')
      const first = controls.item(0), last = controls.item(controls.length - 1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }}>
      <p>{t('remote')}</p>
      <form className={css.row} onSubmit={(event) => {
        event.preventDefault(); if (!locked && path.trim() !== '') void controller.navigate(path)
      }}>
        <label>{t('path')}<input ref={input} value={path} disabled={state.creating || props.busy} onChange={(event) => { setPath(event.target.value) }} /></label>
        <button type="submit" disabled={locked || path.trim() === ''}>{t('go')}</button>
      </form>
      <nav className={css.row} aria-label={t('path')}>
        <button type="button" disabled={locked} onClick={() => { void controller.navigate() }}>{t('home')}</button>
        <button type="button" disabled={locked || parent === undefined} onClick={parent === undefined ? undefined : () => { void controller.navigate(parent.path) }}>{t('parent')}</button>
        {listing?.crumbs.map(crumb => <button key={crumb.path} type="button" disabled={locked} onClick={() => { void controller.navigate(crumb.path) }}>{crumb.name}</button>)}
      </nav>
      {state.error !== undefined ? <p role="alert">{t(state.error === 'list' ? 'listError' : 'createError')}</p> : null}
      {state.error === 'list' ? <button type="button" disabled={locked} onClick={() => { void controller.retry() }}>{t('retry')}</button> : null}
      {locked ? <p role="status">{t(props.busy ? 'adopting' : state.creating ? 'creating' : 'loading')}</p> : null}
      <ul className={css.list} aria-busy={state.loading}>
        {entries.map(entry => <li key={entry.path}><button type="button" disabled={locked} onClick={() => { void controller.navigate(entry.path) }}>{entry.name}</button></li>)}
      </ul>
      {!locked && state.error !== 'list' && entries.length === 0 ? <p>{t('empty')}</p> : null}
      {listing?.truncated ? <p role="status">{t('truncated')}</p> : null}
      <label><input type="checkbox" checked={hidden} onChange={(event) => { setHidden(event.target.checked) }} />{t('hidden')}</label>
      <form className={css.row} onSubmit={(event) => {
        event.preventDefault(); if (!locked && name.trim() !== '') void controller.create(name)
      }}>
        <label>{t('folderName')}<input value={name} disabled={locked} onChange={(event) => { setName(event.target.value) }} /></label>
        <button type="submit" disabled={locked || listing === undefined || state.error === 'list' || name.trim() === ''}>{t('create')}</button>
      </form>
      <p>{t('createNotice')}</p>
      <footer className={css.row}>
        <button type="button" onClick={close}>{t('cancel')}</button>
        <button type="button" disabled={locked || listing === undefined || state.error === 'list'} onClick={listing === undefined ? undefined : () => { props.onPicked(listing.path) }}>{t('confirm')}</button>
      </footer>
    </div>
  </Modal>
}

/**
 * 每次请求拥有单独的扫描控制器，StrictMode 重放也释放旧扫描。
 * @param props - QS 流程 owner、官方目录服务与语言。
 * @returns 当前请求的目录弹层；关闭时不保留操作实例。
 */
export function BrowseDirectoryFlow(props: BrowseFlowProps): ReactNode {
  const latest = useRef(props); latest.current = props
  const generation = useRef(0)
  const [active, setActive] = useState<{ request: symbol; controller: BrowseController; key: number }>()
  useEffect(() => {
    if (!props.open) return
    const controller = createBrowseController({
      listDirectory: (path, signal) => latest.current.listDirectory(path, signal),
      createDirectory: (path, name) => latest.current.createDirectory(path, name),
    })
    setActive({ request: props.request, controller, key: ++generation.current })
    void controller.navigate()
    return () => { controller.dispose() }
  }, [props.open, props.request])
  if (!props.open || active?.request !== props.request) return null
  return <BrowserPanel key={active.key} {...props} controller={active.controller} />
}
