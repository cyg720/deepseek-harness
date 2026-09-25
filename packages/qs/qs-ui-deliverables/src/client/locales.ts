/** 交付状态与动作由 QS 字典提供，不回显本机请求错误。 */
export const zh = {
  produced: '本轮文件改动', presented: '交付文件', preview: '预览 {name}', open: '用默认应用打开',
  reveal: '在文件管理器中显示', directory: '打开所在文件夹', retry: '重试', hostError: '无法读取主机桌面信息',
  unavailable: '此主机没有可用桌面，仍可在工作台预览。', loading: '正在读取主机能力…', all: '展开全部 {count} 项', collapse: '收起',
  opening: '正在打开…', opened: '已请求用默认应用打开', revealing: '正在定位…', revealed: '已请求显示文件',
  error: '打开失败，请重试', revealError: '定位失败，请重试', nativeUnavailable: '没有可用本机路径，请使用预览',
  running: '正在交付', ok: '已交付', failed: '交付失败', stopped: '已中断', details: '调用参数与结果',
} satisfies Record<string, string>
/** 英文键与中文一致。 */
export const en = {
  produced: 'Files changed this turn', presented: 'Delivered files', preview: 'Preview {name}', open: 'Open in default app',
  reveal: 'Show in file manager', directory: 'Open containing folder', retry: 'Retry', hostError: 'Could not read Host desktop information',
  unavailable: 'This Host has no desktop. Preview remains available.', loading: 'Reading Host capabilities…', all: 'Show all {count} items', collapse: 'Collapse',
  opening: 'Opening…', opened: 'Requested opening in default app', revealing: 'Locating…', revealed: 'Requested file display',
  error: 'Could not open. Retry.', revealError: 'Could not locate. Retry.', nativeUnavailable: 'No native path is available. Use preview.',
  running: 'Delivering', ok: 'Delivered', failed: 'Delivery failed', stopped: 'Interrupted', details: 'Call arguments and result',
} satisfies Record<keyof typeof zh, string>
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'qs-ui-deliverables': keyof typeof zh }
}
