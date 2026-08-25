/**
 * 文件职责：把历史消息中的图片数据接入通用图片画廊组件。
 * 技术维度：使用 React 函数组件、会话插槽 props 类型和本地化标签工厂。
 * 产品维度：用户可在聊天历史中查看消息携带的多张图片。
 * 逻辑维度：接收图片、加载器、对齐方式和翻译函数，再组装 ImageGallery 属性。
 * 关键边界：组件不自行读取图片；实际加载由上游传入的 `loadImage` 完成。
 * 新手阅读建议：先看 props 类型，再按标签生成与 ImageGallery 调用顺序阅读。
 */
import type { MessageImagesProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
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
