/** 图片 URL 由官方会话缓存持有；本视图只管理异步结果和原图弹层。 */
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { MessageImageSource } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { OriginalImage } from './OriginalImage.tsx'
import type { GalleryProps } from './contract.ts'
import css from './gallery.module.css'

function ImageItem({ image, loadImage, t }: Pick<GalleryProps, 'loadImage' | 't'> & { image: MessageImageSource }): ReactNode {
  const [url, setUrl] = useState<string | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  const [open, setOpen] = useState(false)
  const close = useCallback(() => { setOpen(false) }, [])
  const fail = useCallback(() => { setFailed(true); setOpen(false) }, [])
  const attachment = 'attachment' in image ? image.attachment : undefined
  const previewUrl = 'preview' in image ? image.preview.url : undefined
  useEffect(() => {
    let current = true
    setFailed(false); setOpen(false); setUrl(undefined)
    if (attachment === undefined) { setUrl(previewUrl); return }
    // 迟到的授权读取不得写入已卸载或已换图的实例；缓存 URL 不由呈现撤销。
    void loadImage(attachment).then(
      (value) => { if (current) setUrl(value) },
      () => { if (current) setFailed(true) },
    )
    return () => { current = false }
  }, [attachment, previewUrl, loadImage, retry])
  const name = ('attachment' in image ? image.attachment.name : image.preview.name) ?? t('image')
  if (failed) return <button type="button" className={css.retry} onClick={() => { setRetry(value => value + 1) }}>{t('failed')}</button>
  if (url === undefined) return <span role="status">{t('loading')}</span>
  return <>
    <button type="button" className={css.thumbnail} aria-label={`${t('open')}: ${name}`} onClick={() => { setOpen(true) }}>
      <img src={url} alt={name} onError={fail} />
    </button>
    {open ? <OriginalImage url={url} name={name} t={t} onClose={close} onError={fail} /> : null}
  </>
}
/**
 * 呈现按来源顺序排列的已有图片，支持加载失败重试和原图查看。
 * @param props - 官方图片引用、授权加载器和本地化字典。
 * @returns 可独立卸载的图片组。
 */
export function Gallery({ images, loadImage, align, compact, t }: GalleryProps): ReactNode {
  return <div className={css.gallery} data-align={align} data-compact={compact || images.length > 1}>
    {images.map((image, index) => <ImageItem key={index} image={image} loadImage={loadImage} t={t} />)}
  </div>
}
