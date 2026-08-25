/**
 * 文件职责：提供覆盖整个文档的原图预览弹层，并管理关闭动作与焦点恢复。
 * 技术维度：使用 React Hook、DOM Portal、键盘事件和可访问性属性实现模态预览。
 * 产品维度：用户点击缩略图后可专注查看原图，并能通过多种常见方式安全退出。
 * 逻辑维度：记录打开前的焦点，聚焦关闭按钮，监听 Escape，卸载时恢复原焦点。
 * 关键边界：组件只可在存在 document.body 的浏览器环境渲染，图片地址由调用方保证有效。
 * 新手阅读建议：先看 ImageLightbox 的参数和返回结构，再阅读 useEffect 中的焦点生命周期。
 */
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { IconCloseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './ImageLightbox.module.css'

/** Lightbox strings the owner resolves from its own locale namespace. */
/* 图片预览所需的文案由调用方从自身的本地化命名空间解析。 */
export interface ImageLightboxLabels {
  /** Accessible name of the preview dialog. */
  /* 预览对话框供辅助技术读取的名称。 */
  dialog: string
  /** Accessible label of the close control. */
  /* 关闭按钮供辅助技术读取的标签。 */
  close: string
}

/**
 * Document-level original-image preview opened by clicking a thumbnail.
 * Closes on Escape, backdrop press, or the close control, and restores focus
 * to the opener on unmount. Rendered through a body portal: an opener inside
 * a transformed or filtered ancestor would otherwise trap the fixed backdrop
 * in that ancestor's box instead of covering the viewport.
 *
 * @param props.src - the original image URL.
 * @param props.alt - the image's alt text.
 * @param props.labels - dialog and close-control strings.
 * @param props.onClose - dismiss callback owned by the opener.
 * @returns the modal preview dialog.
 */
/*
 * 在文档顶层显示原图预览，支持按 Escape、点击遮罩或关闭按钮退出，并在退出后恢复焦点。
 * @param props.src 原图地址。
 * @param props.alt 图片替代文本。
 * @param props.labels 对话框和关闭按钮的可访问文案。
 * @param props.onClose 由打开方提供的关闭回调。
 * @returns 通过 Portal 挂载到 document.body 的模态预览。
 * @example `<ImageLightbox src={url} alt="预览图" labels={labels} onClose={close} />`
 */
export function ImageLightbox({ src, alt, labels, onClose }: {
  src: string
  alt: string
  labels: ImageLightboxLabels
  onClose: () => void
}) {
  /** 关闭按钮引用，弹层打开后会立即获得焦点。 */
  const closeRef = useRef<HTMLButtonElement | null>(null)
  /** 打开弹层前获得焦点的元素，用于关闭后恢复键盘操作位置。 */
  const restoreRef = useRef<HTMLElement | null>(null)

  /** 在弹层生命周期内安装键盘监听并维护焦点进入与恢复。 */
  useEffect(() => {
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    /** 处理全局键盘事件；仅 Escape 会触发关闭。 */
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      restoreRef.current?.focus()
    }
  }, [onClose])

  /** 将预览节点挂载到 body，避免祖先元素的变换或滤镜限制固定定位范围。 */
  return createPortal(
    <div
      className={css.backdrop}
      role="dialog"
      aria-modal="true"
      aria-label={labels.dialog}
    >
      <div className={css.mask} aria-hidden="true" onMouseDown={onClose} />
      <img className={css.image} src={src} alt={alt} />
      <button ref={closeRef} type="button" className={css.close} aria-label={labels.close} onClick={onClose}>
        <IconCloseOutline16 size={16} />
      </button>
    </div>,
    document.body,
  )
}
