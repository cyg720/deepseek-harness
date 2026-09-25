/** 已有附件槽复用官方图片 owner，不提供上传动作。 */
import type { MessageImagesOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-qs-transcript/client'
import type {} from '@deepseek-ai/dsh-qs-ui-tool/client'
import type {} from '@deepseek-ai/dsh-qs-ui-trajectory/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'qs-ui-attachment': keyof typeof import('./locales.ts').zh }
}
/** 图片呈现只接收会话授权加载器及本地化文本。 */
export type GalleryProps = MessageImagesOwnerProps & PropsLocale<'qs-ui-attachment'>
