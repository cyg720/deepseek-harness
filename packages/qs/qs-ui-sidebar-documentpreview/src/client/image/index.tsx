/** 图片子插件只把完整字节交给 img；SVG 不进入应用 DOM 或同源 iframe。 */
import { useEffect, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { parseFileAddress, pathPartsOf } from '@deepseek-ai/dsh-util-workspace-path'
import type { DocumentProps } from '../contract.ts'
import css from '../preview.module.css'

const mediaTypes: Readonly<Record<string, string>> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  bmp: 'image/bmp', ico: 'image/x-icon', svg: 'image/svg+xml',
}
/** 图片正文使用文档宿主字节，不自行读取文件。 */
export type ImageProps = DocumentProps & PropsLocale<'qs-ui-sidebar-documentpreview'>
type Source = { data: Uint8Array<ArrayBuffer>; mediaType: string; url: string | undefined }
/**
 * 显示原始尺寸图片，替换和卸载均释放旧 Blob URL。
 * @param props - 完整图片字节、资源地址及状态文案。
 * @returns 图片、读取中或解码失败说明。
 */
export function ImageBody({ content, resourceAddress, t }: ImageProps) {
  const file = parseFileAddress(resourceAddress)
  if (file === undefined) throw new Error('Image preview requires a file address')
  const { name } = pathPartsOf(file.path)
  const mediaType = mediaTypes[name.slice(name.lastIndexOf('.') + 1).toLowerCase()]
  const data = content.kind === 'bytes' ? content.data : undefined
  const [source, setSource] = useState<Source>()
  useEffect(() => {
    if (data === undefined || mediaType === undefined) return
    let url: string
    try {
      // 浏览器可能拒绝创建对象 URL；失败仅影响本次图片呈现。
      url = URL.createObjectURL(new Blob([data], { type: mediaType }))
    } catch {
      setSource({ data, mediaType, url: undefined })
      return
    }
    setSource({ data, mediaType, url })
    return () => { URL.revokeObjectURL(url) }
  }, [data, mediaType])
  if (data === undefined || mediaType === undefined) return <p role="alert" className={css.notice}>{t('imageUnsupported')}</p>
  if (source?.data !== data || source.mediaType !== mediaType) return <p role="status" className={css.notice}>{t('loading')}</p>
  if (source.url === undefined) return <p role="alert" className={css.notice}>{t('imageFailed')}</p>
  return <DecodedImage key={source.url} url={source.url} name={name} t={t} />
}
/** 解码状态按 URL 隔离，旧图的 load/error 不改变替换后的新图。 */
function DecodedImage({ url, name, t }: { url: string; name: string; t: ImageProps['t'] }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading')
  return <div className={css.imageFrame} data-qs-document-image>
    {status !== 'ready' && <p role={status === 'failed' ? 'alert' : 'status'} className={css.notice}>{t(status === 'failed' ? 'imageFailed' : 'loading')}</p>}
    <img className={css.image} src={url} alt={t('imageAlt', { name })} hidden={status !== 'ready'}
      decoding="async" draggable={false} referrerPolicy="no-referrer"
      onLoad={() => { setStatus('ready') }} onError={() => { setStatus('failed') }} />
  </div>
}
/**
 * 对应官方 image 子插件，正文注册随插件释放。
 * @param ctx - QS 文档子槽上下文。
 */
export function apply(ctx: Context): void {
  ctx.slots.inject('qs.sidebar.document', () => ctx.slots.register({
    name: 'qs.sidebar.document', key: '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/image', locale: 'qs-ui-sidebar-documentpreview',
  }, ImageBody))
}
