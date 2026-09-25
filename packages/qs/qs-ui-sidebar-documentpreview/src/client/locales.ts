/** 预览状态与操作文案归属独立 QS 命名空间，文件原文不做转换。 */
export const zh = {
  title: '文档预览', loading: '正在读取…', unavailable: '资源暂不可用', reload: '重新读取', more: '加载更多',
  failed: '无法读取文件，请重试。', changed: '文件已有更新，重新读取后显示最新内容。',
  viewer: '打开方式', wrap: '自动换行', missing: '此预览方式尚未接入奇术工作台，可选择纯文本查看可读文件。',
  copy: '复制', copied: '已复制', footnotes: '脚注',
  imageAlt: '图片预览：{name}', imageFailed: '图片无法加载，请重新读取文件。', imageUnsupported: '此内容不是支持的图片格式。',
  htmlFrame: 'HTML 文档预览', htmlFailed: '无法准备 HTML 预览，关联资源读取失败或超出限制。请重新读取。',
  pdfPage: 'PDF 第 {page} 页', pdfRendering: '正在绘制页面…', pdfFailed: '无法显示 PDF，请重试。',
  pdfPassword: '此 PDF 需要密码，暂不支持预览。', pdfWorker: 'PDF 渲染进程无法继续，请重试。', pdfUnsupported: 'PDF 预览需要完整文件内容。', retry: '重试',
} as const
/** 英文文案与中文键保持一致。 */
export const en: Record<keyof typeof zh, string> = {
  title: 'Document preview', loading: 'Reading…', unavailable: 'Resource unavailable', reload: 'Reload file', more: 'Load more',
  failed: 'Could not read this file. Please retry.', changed: 'This file has changed. Reload to view the current content.',
  viewer: 'Open with', wrap: 'Wrap lines', missing: 'This preview is not installed in Qishu yet. Select plain text for readable files.',
  copy: 'Copy', copied: 'Copied', footnotes: 'Footnotes',
  imageAlt: 'Image preview: {name}', imageFailed: 'Could not load this image. Reload the file to retry.', imageUnsupported: 'This content is not a supported image format.',
  htmlFrame: 'HTML document preview', htmlFailed: 'Could not prepare HTML. A related resource failed or exceeded a limit. Reload to retry.',
  pdfPage: 'PDF page {page}', pdfRendering: 'Rendering page…', pdfFailed: 'Could not display PDF. Please retry.',
  pdfPassword: 'Password-protected PDF previews are not supported.', pdfWorker: 'The PDF rendering process failed. Please retry.', pdfUnsupported: 'PDF preview requires complete file contents.', retry: 'Retry',
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** QS 文档工具栏和状态说明。 */
    'qs-ui-sidebar-documentpreview': keyof typeof zh
  }
}
