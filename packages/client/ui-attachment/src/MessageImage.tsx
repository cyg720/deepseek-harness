/**
 * 文件职责：实现附件界面的 MessageImage 组件。
 * 技术维度：React、TypeScript、Cordis 插槽和 CSS Modules。
 * 产品维度：向用户展示并操作附件相关状态。
 * 逻辑维度：读取属性与状态，派生展示数据并响应交互。
 * 关键边界：异步状态、可访问性标签和空数据分支必须保持一致。
 * 新手阅读建议：先读 Props，再看局部状态、effect 和 JSX。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { ImageLightbox } from './ImageLightbox.tsx'
import type { ImageLightboxLabels } from './ImageLightbox.tsx'
import css from './MessageImage.module.css'

/** Loads a session-authorized durable image URL. */
/* 中文说明：类型或类 ImageLoader 约束本文件的数据或组件职责。 */
export type ImageLoader = (attachment: ImageAttachmentRef) => Promise<string>

/** Message-image strings the owner resolves from its own locale namespace. */
/* 中文说明：类型或类 MessageImageLabels 约束本文件的数据或组件职责。 */
export interface MessageImageLabels {
  /** Fallback display name for an unnamed image. */
  image: string
  /** Thumbnail tooltip inviting the original-image preview. */
  open: string
  /** Accessible thumbnail label; receives the image's display name. */
  openNamed: (label: string) => string
  /** Loading placeholder shown until bytes resolve. */
  loading: string
  /** Retry-control label shown when the load fails. */
  loadFailed: string
  /** Lightbox strings forwarded to the opened preview. */
  lightbox: ImageLightboxLabels
}

/** Display box for a lone image (DeepSeek Chat rule): long edge 240px with
 * the rendered aspect ratio clamped to [0.25, 4] — the overflow is cropped by
 * `object-fit: cover` — and never upscaled past the image's natural size. The
 * crop anchor keeps the top of very tall images and the left of very wide
 * ones, where the informative content usually starts. */
/* 中文说明：函数 singleFit 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
function singleFit(attachment: ImageAttachmentRef): { width: number; height: number; objectPosition: string } {
  /** 中文说明：当前组件的局部值 natural，由紧邻初始化决定。 */
  const natural = attachment.width / attachment.height
  /** 中文说明：当前组件的局部值 ratio，由紧邻初始化决定。 */
  const ratio = Math.min(4, Math.max(0.25, natural))
  /** 中文说明：当前组件的局部值 box，由紧邻初始化决定。 */
  const box = ratio >= 1 ? { width: 240, height: 240 / ratio } : { width: 240 * ratio, height: 240 }
  /** 中文说明：当前组件的局部值 scale，由紧邻初始化决定。 */
  const scale = Math.min(1, attachment.width / box.width, attachment.height / box.height)
  return {
    width: Math.max(1, Math.round(box.width * scale)),
    height: Math.max(1, Math.round(box.height * scale)),
    objectPosition: natural < 0.25 ? 'center top' : natural > 4 ? 'left center' : 'center',
  }
}

/**
 * Compact history renderer with retryable loading and click-to-open original
 * preview. A lone image renders at its `singleFit` size; an image among
 * several renders as a fixed 64px square tile.
 *
 * @param props.attachment - the durable image reference to load and bound.
 * @param props.load - session-authorized URL loader.
 * @param props.variant - `single` for a message's lone image, `tile` otherwise.
 * @param props.labels - resolved strings (tooltip, loading, retry, lightbox).
 * @returns the bounded thumbnail button, or the retry control on failure.
 */
/* 中文说明：函数 MessageImage 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
export function MessageImage({ attachment, load, variant, labels }: {
  attachment: ImageAttachmentRef
  load: ImageLoader
  variant: 'single' | 'tile'
  labels: MessageImageLabels
}) {
  /** 中文说明：当前组件的局部值 [src, setSrc]，由紧邻初始化决定。 */
  const [src, setSrc] = useState<string | null>(null)
  /** 中文说明：当前组件的局部值 [error, setError]，由紧邻初始化决定。 */
  const [error, setError] = useState(false)
  /** 中文说明：当前组件的局部值 [open, setOpen]，由紧邻初始化决定。 */
  const [open, setOpen] = useState(false)
  // Retry re-arms the one load effect below, so every attempt — first load or
  // retry — runs under the same liveness guard and the same reset.
  /** 中文说明：当前组件的局部值 [attempt, setAttempt]，由紧邻初始化决定。 */
  const [attempt, setAttempt] = useState(0)
  /** 中文说明：当前组件的局部值 request，由紧邻初始化决定。 */
  const request = useCallback(() => { setAttempt(a => a + 1) }, [])
  /** 中文说明：当前组件的局部值 close，由紧邻初始化决定。 */
  const close = useCallback(() => { setOpen(false) }, [])
  /** 中文说明：当前组件的局部值 fit，由紧邻初始化决定。 */
  const fit = useMemo(
    () => (variant === 'single' ? singleFit(attachment) : undefined),
    [attachment, variant],
  )

  useEffect(() => {
    /** 中文说明：当前组件的局部值 live，由紧邻初始化决定。 */
    let live = true
    setError(false)
    setSrc(null)
    void load(attachment).then((url) => { if (live) setSrc(url) }).catch(() => { if (live) setError(true) })
    return () => { live = false }
  }, [attachment, load, attempt])

  /** 中文说明：当前组件的局部值 label，由紧邻初始化决定。 */
  const label = attachment.name ?? labels.image
  if (error) return <button type="button" className={css.error} data-variant={variant} onClick={request}>{labels.loadFailed}</button>
  return (
    <>
      <button
        type="button"
        className={css.frame}
        data-variant={variant}
        style={fit === undefined ? undefined : { width: fit.width, height: fit.height }}
        title={labels.open}
        aria-label={labels.openNamed(label)}
        onClick={() => { if (src !== null) setOpen(true) }}
      >
        {src === null
          ? <span className={css.loading}>{labels.loading}</span>
          : <img src={src} alt={label} style={fit === undefined ? undefined : { objectPosition: fit.objectPosition }} />}
      </button>
      {open && src !== null && <ImageLightbox src={src} alt={label} labels={labels.lightbox} onClose={close} />}
    </>
  )
}

/** Wrapping image group shared by user and assistant history: a lone image
 * renders large, several render as 64px square tiles (DeepSeek Chat rule). */
/* 中文说明：函数 ImageGallery 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
export function ImageGallery({ images, load, align, labels }: {
  images: readonly { attachment: ImageAttachmentRef }[]
  load: ImageLoader
  align: 'start' | 'end'
  labels: MessageImageLabels
}) {
  if (images.length === 0) return null
  /** 中文说明：当前组件的局部值 variant，由紧邻初始化决定。 */
  const variant = images.length === 1 ? 'single' : 'tile'
  return (
    <div className={css.gallery} data-align={align}>
      {images.map((image, index) => (
        <MessageImage key={`${image.attachment.attachmentId}:${index}`} {...image} load={load} variant={variant} labels={labels} />
      ))}
    </div>
  )
}
