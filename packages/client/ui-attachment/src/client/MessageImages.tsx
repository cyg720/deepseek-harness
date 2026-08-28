import type { MessageImagesProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import { ImageGallery } from '../MessageImage.tsx'
import { messageImageLabels } from './labels.ts'

/** Historical message-image slot entry. */
/*
 * 历史消息图片插槽入口。
 * @param images 要展示的图片描述列表；为空时画廊按自身规则渲染。
 * @param loadImage 根据图片描述异步取得可显示内容的加载函数。
 * @param align 画廊对齐方式，取值由 MessageImagesProps 约束。
 * @param t 翻译函数，用于生成画廊按钮和状态标签。
 * @returns 已绑定数据、加载器、布局和标签的 React 图片画廊。
 * @example `<MessageImages images={items} loadImage={load} align="left" t={t} />`
 */
export function MessageImages({ images, loadImage, align, t }: MessageImagesProps) {
  return <ImageGallery images={images} load={loadImage} align={align} labels={messageImageLabels(t)} />
}
