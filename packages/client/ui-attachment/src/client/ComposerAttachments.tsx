/**
 * 文件职责：实现附件界面的 ComposerAttachments 组件。
 * 技术维度：React、TypeScript、Cordis 插槽和 CSS Modules。
 * 产品维度：向用户展示并操作附件相关状态。
 * 逻辑维度：读取属性与状态，派生展示数据并响应交互。
 * 关键边界：异步状态、可访问性标签和空数据分支必须保持一致。
 * 新手阅读建议：先读 Props，再看局部状态、effect 和 JSX。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ComposerAttachment, ComposerAttachmentsProps,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { AttachmentRail } from '../AttachmentRail.tsx'
import type { AttachmentRailItem } from '../AttachmentRail.tsx'
import { DropOverlay } from '../DropOverlay.tsx'
import { ImageLightbox } from '../ImageLightbox.tsx'
import { attachmentRailLabels, dropOverlayLabels, lightboxLabels } from './labels.ts'
import css from './ComposerAttachments.module.css'

/** Rail item retaining its browser-owned attachment for callbacks. */
/** 中文说明：类型或类 ComposerRailItem 约束本文件的数据或组件职责。 */
interface ComposerRailItem extends AttachmentRailItem {
  attachment: ComposerAttachment
}

/** Draft-image rail, document drop target, and original-image preview slot entry. */
/** 中文说明：函数 ComposerAttachments 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
export function ComposerAttachments({
  attachments, canAcceptDrop, onAddImages, onRemoveImage, dropLimits, t,
}: ComposerAttachmentsProps) {
  /** 中文说明：当前组件的局部值 [preview, setPreview]，由紧邻初始化决定。 */
  const [preview, setPreview] = useState<ComposerAttachment | null>(null)
  /** 中文说明：当前组件的局部值 [dragActive, setDragActive]，由紧邻初始化决定。 */
  const [dragActive, setDragActive] = useState(false)
  /** 中文说明：当前组件的局部值 dragDepth，由紧邻初始化决定。 */
  const dragDepth = useRef(0)
  /** 中文说明：当前组件的局部值 closePreview，由紧邻初始化决定。 */
  const closePreview = useCallback(() => { setPreview(null) }, [])

  useEffect(() => {
    if (preview !== null && !attachments.some(attachment => attachment.id === preview.id)) setPreview(null)
  }, [attachments, preview])

  useEffect(() => {
    /** 中文说明：当前组件的局部值 fileTransfer，由紧邻初始化决定。 */
    const fileTransfer = (event: globalThis.DragEvent): DataTransfer | null => {
      /** 中文说明：当前组件的局部值 dataTransfer，由紧邻初始化决定。 */
      const dataTransfer = event.dataTransfer
      if (dataTransfer === null || !dataTransfer.types.includes('Files')) return null
      return dataTransfer
    }
    /** 中文说明：当前组件的局部值 reset，由紧邻初始化决定。 */
    const reset = (): void => {
      dragDepth.current = 0
      setDragActive(false)
    }
    /** 中文说明：当前组件的局部值 onDragEnter，由紧邻初始化决定。 */
    const onDragEnter = (event: globalThis.DragEvent): void => {
      if (fileTransfer(event) === null) return
      event.preventDefault()
      dragDepth.current += 1
      setDragActive(true)
    }
    /** 中文说明：当前组件的局部值 onDragOver，由紧邻初始化决定。 */
    const onDragOver = (event: globalThis.DragEvent): void => {
      /** 中文说明：当前组件的局部值 dataTransfer，由紧邻初始化决定。 */
      const dataTransfer = fileTransfer(event)
      if (dataTransfer === null) return
      event.preventDefault()
      dataTransfer.dropEffect = canAcceptDrop ? 'copy' : 'none'
    }
    /** 中文说明：当前组件的局部值 onDragLeave，由紧邻初始化决定。 */
    const onDragLeave = (event: globalThis.DragEvent): void => {
      if (fileTransfer(event) === null) return
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) setDragActive(false)
      /** 中文说明：当前组件的局部值 leftViewport，由紧邻初始化决定。 */
      const leftViewport = event.clientX <= 0 || event.clientY <= 0
        || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight
      if ((event.target === document.documentElement || event.target === document.body) && leftViewport) reset()
    }
    /** 中文说明：当前组件的局部值 onDrop，由紧邻初始化决定。 */
    const onDrop = (event: globalThis.DragEvent): void => {
      /** 中文说明：当前组件的局部值 dataTransfer，由紧邻初始化决定。 */
      const dataTransfer = fileTransfer(event)
      if (dataTransfer === null) return
      event.preventDefault()
      reset()
      if (canAcceptDrop) onAddImages([...dataTransfer.files])
    }
    document.addEventListener('dragenter', onDragEnter)
    document.addEventListener('dragover', onDragOver)
    document.addEventListener('dragleave', onDragLeave)
    document.addEventListener('drop', onDrop)
    window.addEventListener('dragend', reset)
    return () => {
      document.removeEventListener('dragenter', onDragEnter)
      document.removeEventListener('dragover', onDragOver)
      document.removeEventListener('dragleave', onDragLeave)
      document.removeEventListener('drop', onDrop)
      window.removeEventListener('dragend', reset)
    }
  }, [canAcceptDrop, onAddImages])

  /** 中文说明：当前组件的局部值 railItems，由紧邻初始化决定。 */
  const railItems = useMemo<ComposerRailItem[]>(() => attachments.map(attachment => ({
    id: attachment.id,
    previewUrl: attachment.previewUrl,
    alt: attachment.file.name || t('image.pending'),
    removeLabel: t('image.remove', { name: attachment.file.name }),
    attachment,
  })), [attachments, t])

  return (
    <>
      {dragActive && (
        <DropOverlay
          disabled={!canAcceptDrop}
          labels={dropOverlayLabels(t, canAcceptDrop, dropLimits)}
        />
      )}
      {railItems.length > 0 && (
        <div className={css.rail}>
          <AttachmentRail
            items={railItems}
            labels={attachmentRailLabels(t)}
            onOpen={(item) => { setPreview(item.attachment) }}
            onRemove={(item) => { onRemoveImage(item.attachment.id) }}
          />
        </div>
      )}
      {preview !== null && (
        <ImageLightbox
          src={preview.previewUrl}
          alt={preview.file.name || t('image.original')}
          labels={lightboxLabels(t)}
          onClose={closePreview}
        />
      )}
    </>
  )
}
