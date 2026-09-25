/** PDF 子插件只拥有挂载期间的文档和画布，运行时及页码状态来自官方服务。 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { PropsLocale, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { PdfBodyInjected, PdfDocument, PdfPresentation } from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import type { DocumentProps } from '../contract.ts'
import css from '../preview.module.css'

/** 正文持有会话，官方 store 保存标签阅读页码。 */
export type PdfProps = DocumentProps & PropsLocale<'qs-ui-sidebar-documentpreview'> & PropsStore<PdfPresentation['store']>
  & PdfBodyInjected & Pick<PdfPresentation, 'open' | 'render'>
type Loaded = { data: Uint8Array<ArrayBuffer>; document: PdfDocument } | { data: Uint8Array<ArrayBuffer>; error: unknown }
/** 已知 PDF 故障使用专用文案，未知异常不回显原始诊断。 */
function failure(error: unknown, t: PdfProps['t']) {
  if (error instanceof Error && error.name === 'PasswordException') return t('pdfPassword')
  if (error instanceof Error && error.name === 'PdfWorkerFailure') return t('pdfWorker')
  return t('pdfFailed')
}
/**
 * 打开完整 PDF 字节并按可见页绘制；替换内容或卸载取消并释放 worker。
 * @param props - 标准文档内容、共享页码和官方 PDF 运行时。
 * @returns PDF 页面或本地化失败及重试入口。
 */
export function PdfBody({ content, useTabInfo, useStore, actions, retainTab, open, render, t }: PdfProps) {
  const { tab } = useTabInfo(), savedPage = useStore(value => value.byTab[tab.id]?.page ?? 1)
  const data = content.kind === 'bytes' ? content.data : undefined
  const [loaded, setLoaded] = useState<Loaded>(), [attempt, setAttempt] = useState(0)
  const visible = useCallback((page: number) => { actions.page(tab.id, page) }, [actions, tab.id])
  useEffect(() => { retainTab(tab.id, tab.signal) }, [retainTab, tab.id, tab.signal])
  useEffect(() => {
    if (data === undefined || tab.signal.aborted) return
    const controller = new AbortController(), signal = AbortSignal.any([controller.signal, tab.signal])
    setLoaded(undefined)
    const session = open(data, signal, (error) => { if (!signal.aborted) setLoaded({ data, error }) })
    void session.document.then(
      (document) => { if (!signal.aborted) setLoaded({ data, document }) },
      (error: unknown) => { if (!signal.aborted) setLoaded({ data, error }) },
    )
    return () => { controller.abort(); void session.dispose() }
  }, [data, tab.signal, open, attempt])
  if (data === undefined) return <p role="alert" className={css.notice}>{t('pdfUnsupported')}</p>
  if (loaded?.data !== data) return <p role="status" className={css.notice}>{t('loading')}</p>
  if ('error' in loaded) return <p role="alert" className={css.notice}>{failure(loaded.error, t)}
    <button type="button" onClick={() => { setAttempt(value => value + 1) }}>{t('retry')}</button></p>
  return <section className={css.pdf} data-qs-document-pdf>
    {Array.from({ length: loaded.document.numPages }, (_, index) => <PdfPage key={index} document={loaded.document}
      page={index + 1} initial={index === 0 || savedPage === index + 1} visible={visible} signal={tab.signal} render={render} t={t} />)}
  </section>
}
/** 每页画布有独立取消信号，卸载和快速重试不得共享正在写入的渲染任务。 */
function PdfPage({ document, page, initial, visible, signal, render, t }: {
  document: PdfDocument
  page: number
  initial: boolean
  visible: (page: number) => void
  signal: AbortSignal
  render: PdfProps['render']
  t: PdfProps['t']
}) {
  const host = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null)
  const [requested, setRequested] = useState(initial), [ready, setReady] = useState(false)
  const [error, setError] = useState<{ value: unknown }>(), [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') { setRequested(true); return }
    let disposed = false
    const observer = new IntersectionObserver((entries) => {
      if (disposed || !entries.some(entry => entry.isIntersecting)) return
      setRequested(true); visible(page); observer.disconnect()
    }, { rootMargin: '100% 0px' })
    // 页面宿主无条件挂载，effect 在 ref 提交后运行；与官方页面观察生命周期一致。
    observer.observe(host.current as HTMLDivElement)
    return () => { disposed = true; observer.disconnect() }
  }, [page, visible])
  useEffect(() => {
    if (!requested || canvas.current === null) return
    const controller = new AbortController(), combined = AbortSignal.any([controller.signal, signal])
    setReady(false); setError(undefined)
    void render(document, page, canvas.current, combined, window.devicePixelRatio).then(
      () => { if (!combined.aborted) setReady(true) },
      (value: unknown) => { if (!combined.aborted) setError({ value }) },
    )
    return () => { controller.abort() }
  }, [requested, document, page, signal, render, attempt])
  return <div ref={host} className={css.pdfPage} data-qs-pdf-page={page}>
    {!ready && error === undefined && <div className={css.pdfPlaceholder}>{requested && <p role="status">{t('pdfRendering')}</p>}</div>}
    {error !== undefined && <p role="alert">{failure(error.value, t)}<button type="button" onClick={() => { setAttempt(value => value + 1) }}>{t('retry')}</button></p>}
    <canvas key={attempt} ref={canvas} className={css.pdfCanvas} role="img" aria-label={t('pdfPage', { page })} hidden={!ready || error !== undefined} />
  </div>
}
/**
 * 对应官方 PDF 子插件，绑定同一页码状态和运行时操作。
 * @param ctx - 文档槽位与官方 PDF 服务。
 */
export function apply(ctx: Context): void {
  const shared = ctx.documentPdfPresentation
  ctx.slots.inject('qs.sidebar.document', () => ctx.slots.register({
    name: 'qs.sidebar.document', key: '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/pdf', locale: 'qs-ui-sidebar-documentpreview',
    store: shared.store,
    inject: (sessionId, actions) => ({ ...shared.inject(sessionId, actions), open: shared.open, render: shared.render }),
  }, PdfBody))
}
