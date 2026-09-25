/** read_image 视图：按会话授权的装载能力展示图片，缺能力时只给文字说明。 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ReactNode } from 'react'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { QsToolviewProps } from '../contract.ts'
import { blockType, callHead, contentSummary, isSettled, parseArgs, stringArg } from '../raw-tool-call.ts'
import { displayPath } from '../tool-view-model.ts'
import { registerToolview, type ToolviewComponent } from '../toolview-registration.ts'
import { GenericToolCard } from './generic.tsx'
import styles from '../tool.module.css'

/** `read_image` 的视图模型。 */
export interface ImageCardModel {
  /** 模型面对的文件路径。 */
  readonly path: string
  /** 结果里的图片引用，按出现顺序。 */
  readonly images: readonly ImageAttachmentRef[]
  /** 结果里的文字说明（路径信封），没有时为空串。 */
  readonly text: string
}

/**
 * 校验一个图片引用。
 *
 * 只接受带完整固有元数据的引用（存储标识、媒体类型、字节数、宽高），因为按会话
 * 授权的装载器需要它们；缺字段时整张卡回落兜底，而不是把残缺对象递给装载器。
 * @param value - 结果内容里的一个图片块。
 * @returns 图片引用；结构不符时为 undefined。
 */
function imageRef(value: unknown): ImageAttachmentRef | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const ref = value as {
    attachmentId?: unknown
    mediaType?: unknown
    bytes?: unknown
    width?: unknown
    height?: unknown
  }
  if (typeof ref.attachmentId !== 'string' || ref.attachmentId === '') return undefined
  if (typeof ref.mediaType !== 'string' || ref.mediaType === '') return undefined
  for (const size of [ref.bytes, ref.width, ref.height]) {
    if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) return undefined
  }
  return value as ImageAttachmentRef
}

/**
 * 构建 `read_image` 模型。
 *
 * 结果内容里出现既不是文本也不是图片的块时整张卡回落兜底：部分展示会把未知块藏起来。
 * @param block - 运行头或结算结果。
 * @returns 视图模型；无法按契约呈现时为 undefined。
 */
export function imageCardModel(block: ToolCallBlock): ImageCardModel | undefined {
  const head = callHead(block)
  if (head === undefined) return undefined
  const path = stringArg(parseArgs(head.argsRaw), 'file_path')
  if (path === undefined) return undefined
  if (!isSettled(block)) return { path, images: [], text: '' }
  const images: ImageAttachmentRef[] = []
  for (const content of block.content) {
    const type = blockType(content)
    if (type === 'text') continue
    if (type !== 'image') return undefined
    const ref = imageRef((content as { readonly attachment?: unknown }).attachment)
    if (ref === undefined) return undefined
    images.push(ref)
  }
  if (images.length === 0) return undefined
  const summary = contentSummary(block.content)
  return { path, images, text: summary.text }
}

/** `read_image` 视图组件：模型不成立时回落兜底卡。 */
export const ImageToolview: ToolviewComponent = ({ block, cwd, loadImage, renderSlot, t }: QsToolviewProps): ReactNode => {
  const model = imageCardModel(block)
  if (model === undefined) return <GenericToolCard block={block} t={t} />
  return (
    <div data-qs-tool-image-card>
      <p className={styles.label}>{displayPath(model.path, cwd)}</p>
      {loadImage === undefined
        ? <p className={styles.notice}>{t('image.unavailable')}</p>
        : renderSlot('qs.tool.call.images', { images: model.images.map(attachment => ({ attachment })), loadImage, align: 'start' })}
      {model.text === '' ? null : <pre className={styles.pre}>{model.text}</pre>}
    </div>
  )
}

/** read_image 视图插件。 */
export const readImageToolview = {
  name: 'qs-read-image-toolview',
  inject: ['slots'],
  /** 注册 read_image 键。 */
  apply(ctx: ClientContext): void {
    registerToolview(ctx, 'read_image', ImageToolview)
  },
}
