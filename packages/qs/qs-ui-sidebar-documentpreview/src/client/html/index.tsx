/** HTML 只在不透明 iframe 内运行，静态资源准备由官方共享能力完成。 */
import { useEffect, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { DocumentPreviewPresentation } from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import type { DocumentProps } from '../contract.ts'
import css from '../preview.module.css'

/** 仅暴露有限静态打包能力，不向 iframe 传递文件读取回调。 */
export type HtmlProps = DocumentProps & PropsLocale<'qs-ui-sidebar-documentpreview'> & Pick<DocumentPreviewPresentation, 'prepareHtml'>
type Frame = { data: Uint8Array<ArrayBuffer>; address: string; prepare: HtmlProps['prepareHtml']; url: string | undefined }
/**
 * 准备 HTML 后创建隔离浏览上下文；输入替换会取消旧准备并释放旧 URL。
 * @param props - 完整文档内容、标签生命周期及官方打包能力。
 * @returns 隔离 iframe、加载状态或明确失败说明。
 */
export function HtmlBody({ content, resourceAddress, useTabInfo, prepareHtml, t }: HtmlProps) {
  const { tab } = useTabInfo()
  const data = content.kind === 'bytes' ? content.data : undefined
  const [frame, setFrame] = useState<Frame>()
  useEffect(() => {
    if (data === undefined) return
    const controller = new AbortController(), signal = AbortSignal.any([controller.signal, tab.signal])
    let url: string | undefined
    void (async () => {
      try {
        const html = await prepareHtml(resourceAddress, data, tab.signal, signal)
        signal.throwIfAborted()
        url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
        setFrame({ data, address: resourceAddress, prepare: prepareHtml, url })
      } catch {
        // 打包、读取或 Blob 创建失败只发布通用文案；已取消的旧请求不发布状态。
        if (!signal.aborted) setFrame({ data, address: resourceAddress, prepare: prepareHtml, url: undefined })
      }
    })()
    return () => { controller.abort(); if (url !== undefined) URL.revokeObjectURL(url) }
  }, [data, resourceAddress, prepareHtml, tab.signal])
  if (data === undefined) return null
  if (frame?.data !== data || frame.address !== resourceAddress || frame.prepare !== prepareHtml) {
    return <p role="status" className={css.notice}>{t('loading')}</p>
  }
  if (frame.url === undefined) return <p role="alert" className={css.notice}>{t('htmlFailed')}</p>
  return <iframe key={frame.url} className={css.htmlFrame} src={frame.url} sandbox="allow-scripts" title={t('htmlFrame')} data-qs-document-html />
}
/**
 * 对应官方 HTML 子插件，独立贡献隔离正文。
 * @param ctx - 文档子槽及官方预览共享服务。
 */
export function apply(ctx: Context): void {
  ctx.slots.inject('qs.sidebar.document', () => ctx.slots.register({
    name: 'qs.sidebar.document', key: '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/html', locale: 'qs-ui-sidebar-documentpreview',
    inject: () => ({ prepareHtml: ctx.documentPreviewPresentation.prepareHtml }),
  }, HtmlBody))
}
