/** 已有附件的中英文状态和操作文本。 */
export const zh = {
  image: '图片附件', loading: '图片加载中', failed: '图片加载失败，点击重试',
  open: '查看原图', close: '关闭原图',
} as const
/** 英文键与中文完整对应。 */
export const en: Record<keyof typeof zh, string> = {
  image: 'Image attachment', loading: 'Loading image', failed: 'Image failed to load. Retry',
  open: 'View original image', close: 'Close original image',
}
