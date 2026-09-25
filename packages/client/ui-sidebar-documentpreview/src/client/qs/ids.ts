/** 官方元数据和二开正文共用的稳定身份；不重复注册元数据。 */
export const documentPreviewIds = Object.freeze({
  text: '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/text',
  markdown: '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/markdown',
  html: '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/html',
  image: '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/image',
  pdf: '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/pdf',
  code: '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/code',
} as const)
