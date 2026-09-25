/** 目录浏览仅显示本地化错误摘要，不回显服务端诊断。 */
export const zh = {
  title: '选择 Host 上的目录', path: 'Host 路径', go: '跳转', parent: '上级目录', home: '主目录',
  hidden: '显示隐藏目录', empty: '当前没有可显示的子目录。', truncated: '目录过多，仅显示开头部分；可输入完整路径跳转。',
  loading: '正在读取目录…', creating: '正在创建目录…', adopting: '正在打开工作区…',
  listError: '无法读取目录，请检查路径和访问权限后重试。', createError: '创建目录失败，请检查名称和写入权限后重试。',
  retry: '重试读取', folderName: '新目录名称', create: '新建目录', confirm: '确认选择', cancel: '取消',
  remote: '此处浏览的是服务端 Host 的目录，不一定是浏览器所在电脑的目录。',
  createNotice: '新建目录会立即写入 Host；取消选择不会删除已创建的目录。',
} as const
/** 两种语言保持相同键，文件名和完整路径保留原始数据。 */
export const en: Record<keyof typeof zh, string> = {
  title: 'Choose a directory on the Host', path: 'Host path', go: 'Go', parent: 'Parent directory', home: 'Home',
  hidden: 'Show hidden directories', empty: 'No visible subdirectories.', truncated: 'Only the beginning of this directory is shown; enter a full path to navigate.',
  loading: 'Reading directory…', creating: 'Creating directory…', adopting: 'Opening workspace…',
  listError: 'Unable to read this directory. Check the path and access permissions, then retry.', createError: 'Unable to create this directory. Check the name and write permissions, then retry.',
  retry: 'Retry reading', folderName: 'New directory name', create: 'Create directory', confirm: 'Confirm selection', cancel: 'Cancel',
  remote: 'These directories belong to the server Host, which may be a different computer from your browser.',
  createNotice: 'Creating a directory writes to the Host immediately. Cancelling selection does not delete it.',
}
