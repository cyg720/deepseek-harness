/** QS 文件树所有状态文案，不回显 Remote 原始错误。 */
export const zh = {
  title: '工作区文件', reload: '刷新目录', loading: '正在读取…', empty: '空目录',
  truncated: '目录条目超出上限，仅显示部分内容。', noWorkspace: '当前会话没有工作区目录。',
  unavailable: '目录读取失败，请刷新重试。', notFound: '目录已被移动或删除。',
  outside: '无权读取工作区外的目录。', notDirectory: '该位置不是目录。', other: '暂不支持打开此类条目。',
} satisfies Record<string, string>
/** 英文与中文使用相同键集合。 */
export const en = {
  title: 'Workspace files', reload: 'Reload directories', loading: 'Reading…', empty: 'Empty directory',
  truncated: 'Directory entry limit reached; only some entries are shown.', noWorkspace: 'This session has no workspace directory.',
  unavailable: 'Could not read this directory. Reload to retry.', notFound: 'This directory was moved or deleted.',
  outside: 'Directories outside this workspace cannot be read.', notDirectory: 'This location is not a directory.', other: 'This entry type cannot be opened.',
} satisfies Record<keyof typeof zh, string>
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'qs-ui-sidebar-files': keyof typeof zh }
}
