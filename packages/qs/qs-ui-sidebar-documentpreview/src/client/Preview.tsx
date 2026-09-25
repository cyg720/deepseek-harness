/** 文档宿主复用官方读取代次和视图状态，正文由独立子槽提供。 */
import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { DocumentContent, DocumentPreviewDefinition, TextPreviewInjected, TextStore } from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import type {} from '@deepseek-ai/dsh-qs-ui-sidebar-right/client'
import type {} from './contract.ts'
import type {} from './locales.ts'
import css from './preview.module.css'

/** 渲染类型排序继续使用官方注册表的优先级和后缀匹配。 */
export interface PreviewInjected extends TextPreviewInjected {
  /** @param path - 文件路径。 @returns 官方按优先级排列的匹配项。 */
  readonly candidates: (path: string) => readonly DocumentPreviewDefinition[]
}
/** QS 预览消费标准标签座位、共享内容和可卸载的文档子槽。 */
export type PreviewProps = PropsRuntime<'qs.sidebar.right.tab'> & PropsStore<TextStore> & InjectFace<PreviewInjected>
  & PropsRenderSlots<'qs.sidebar.document'> & PropsLocale<'qs-ui-sidebar-documentpreview'>
/**
 * 呈现资源元数据、读取状态和当前文档正文。
 * @param props - 官方状态与读取能力、QS 子槽及字典。
 * @returns 当前标签的文档工具栏和正文。
 */
export function Preview({ useTabInfo, useResource, useStore, useDocumentPreviews, actions, candidates,
  loadPage, loadAll, reloadPages, reloadAll, renderSlot, t }: PreviewProps) {
  const { tab } = useTabInfo(), { signal, navigation } = tab
  const file = useMemo(() => {
    const parsed = parseFileAddress(tab.contentId)
    if (parsed?.scope !== 'session') throw new Error('Document preview requires a session file address')
    return { sessionId: parsed.sessionId as SessionId, path: parsed.path }
  }, [tab.contentId])
  const meta = useResource<'file'>(tab.contentId), canRead = meta.status !== 'none'
  const state = useStore(value => value.byTab[tab.id])
  const definitions = useDocumentPreviews(value => value)
  const choices = useMemo(() => {
    const matches = candidates(file.path)
    const plain = definitions.find(value => value.id === '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/text')
    return plain === undefined ? matches : [...matches, plain]
  }, [definitions, candidates, file.path])
  const selected = choices.find(value => value.id === state?.rendererId) ?? choices[0], mode = selected?.loading
  const current = (state?.mode ?? 'text-pages') === mode ? state : undefined
  const pages = useMemo(() => Object.entries(current?.pages ?? {}).map(([offset, page]) => ({ offset: Number(offset), ...page }))
    .sort((a, b) => a.offset - b.offset), [current?.pages])
  const last = pages.at(-1), through = last === undefined ? 0 : last.offset + last.lines - 1
  const body = useRef<HTMLDivElement>(null), scrollport = useRef<HTMLElement | null>(null)
  const savedScroll = useRef(0)
  savedScroll.current = state?.scrollTop ?? 0
  const bindScrollport = useCallback((port: HTMLElement | null) => {
    scrollport.current = port
    if (port !== null) port.scrollTop = savedScroll.current
  }, [])
  const content: DocumentContent | undefined = mode === 'bytes-complete'
    ? current?.complete === undefined ? undefined : { kind: 'bytes', data: current.complete.data }
    : current === undefined || pages.length === 0 ? undefined
      : { kind: 'text', pages, text: pages.filter(page => page.lines > 0).map(page => page.text).join('\n'), eof: current.eof }
  useEffect(() => {
    if (current !== undefined || !canRead || mode === undefined || signal.aborted) return
    if (mode === 'text-pages') loadPage(tab.id, file, 1, signal, meta.value?.version)
    else loadAll(tab.id, file, signal, meta.value?.version)
  }, [current, canRead, mode, signal, file, tab.id, meta.value?.version, loadPage, loadAll])
  const hasContent = content !== undefined
  useEffect(() => {
    const port = scrollport.current ?? body.current
    if (hasContent && port !== null) port.scrollTop = savedScroll.current
  }, [hasContent, selected?.id])
  const line = navigation.params !== undefined && 'line' in navigation.params ? navigation.params.line : undefined
  useEffect(() => {
    const port = scrollport.current ?? body.current
    if (current === undefined || port === null || current.revision === navigation.revision) return
    if (line !== undefined && mode === 'text-pages') {
      if (line > through && !current.eof) {
        if (!current.loading && current.failure === undefined && canRead) loadPage(tab.id, file, through + 1, signal, meta.value?.version)
        return
      }
      const row = port.querySelector<HTMLElement>(`[data-document-line="${line}"]`)
        ?? (port.hasAttribute('data-code-block-content') ? port.querySelectorAll<HTMLElement>('pre .line').item(line - 1) : null)
      if (row === null && line <= through) return
      if (row !== null) port.scrollTop = Math.max(0, row.offsetTop)
    }
    actions.navigated(tab.id, navigation.revision)
    actions.scrolled(tab.id, port.scrollTop)
  }, [current, navigation.revision, line, mode, through, canRead, file, signal, tab.id, meta.value?.version, loadPage, actions])
  const reload = () => {
    if (!canRead) return
    if (mode === 'text-pages') reloadPages(tab.id, file, signal, meta.value?.version)
    else reloadAll(tab.id, file, signal, meta.value?.version)
  }
  const more = () => {
    if (canRead && mode === 'text-pages' && !current?.loading && !current?.eof && !signal.aborted) {
      loadPage(tab.id, file, through + 1, signal, meta.value?.version)
    }
  }
  const changed = current?.version !== undefined && meta.value?.version !== undefined
    && current.version !== meta.value.version && current.observedVersion !== meta.value.version
  return <section className={css.root} aria-label={t('title')} data-qs-document>
    <header className={css.toolbar}>
      <div className={css.path}>{meta.value?.absolutePath ?? file.path}</div>
      <select aria-label={t('viewer')} value={selected?.id ?? ''} onChange={(event) =>{  actions.selected(tab.id, event.target.value) }}>
        {choices.map(choice => <option key={choice.id} value={choice.id}>{choice.title()}</option>)}
      </select>
      {selected?.wrap === true && <button type="button" aria-pressed={state?.wrap ?? true} onClick={() =>{  actions.toggledWrap(tab.id) }}>{t('wrap')}</button>}
      <button type="button" disabled={!canRead} onClick={reload}>{t('reload')}</button>
    </header>
    {(meta.failure !== undefined || changed) && <p role="status" className={css.notice}>{t(meta.failure !== undefined ? 'failed' : 'changed')}</p>}
    {!canRead && <p role="status" className={css.notice}>{t('unavailable')}</p>}
    <div className={css.scroll} ref={body} onScrollCapture={(event) => {
      // CodeBlock 的滚动发生在内部容器；只采集当前正文声明的滚动口，忽略嵌套代码块。
      const port = scrollport.current ?? event.currentTarget
      if (event.target !== port) return
      actions.scrolled(tab.id, port.scrollTop)
      const remaining = port.scrollHeight - port.clientHeight - port.scrollTop
      if (current?.failure === undefined && remaining < 1) more()
    }}>
      {(current === undefined || current.loading) && canRead && <p role="status" className={css.notice}>{t('loading')}</p>}
      {/* content 来自当前标签状态；首次读取前没有正文，不在此重复兜底 wrap。 */}
      {content !== undefined && selected !== undefined && renderSlot('qs.sidebar.document', {
        resourceAddress: tab.contentId, content, wrap: (state as NonNullable<typeof state>).wrap,
        scrollportRef: bindScrollport,
      }, { entryKey: selected.id, hookContext: useTabInfo, fallback: <p className={css.notice}>{t('missing')}</p> })}
      {current?.failure !== undefined && <p role="alert" className={css.notice}>{t('failed')}<button type="button" onClick={hasContent && mode === 'text-pages' ? more : reload}>{t('reload')}</button></p>}
      {mode === 'text-pages' && pages.length > 0 && current?.eof === false && current.failure === undefined
        && <button type="button" className={css.more} disabled={current.loading} onClick={more}>{t('more')}</button>}
    </div>
  </section>
}
