/** qs-sessions 的本地化字典。中文优先，英文同步维护。 */
import type { QsSessionsLocaleKey } from './contract.ts'

/** 简体中文字典。 */
export const zh = {
  'group.pinned': '置顶',
  'group.recent': '最近',
  'list.empty': '还没有会话。',
  'list.emptyLead': '新建一个，从一句话开始。',
  'list.new': '新建会话',
  'list.newShortcut': 'Ctrl K',
  'row.manage': '管理会话',
  'menu.title': '管理会话',
  'menu.pin': '置顶会话',
  'menu.unpin': '取消置顶',
  'menu.rename': '重命名',
  'menu.archive': '归档会话',
  'menu.close': '取消',
  'rename.title': '重命名会话',
  'rename.label': '会话名称',
  'rename.save': '保存',
  'archive.title': '归档会话',
  'archive.confirm': '归档后该会话从列表中移除，历史仍然保留在服务端。',
  'archive.cancel': '取消',
  'archive.busy': '该会话正在运行或有待处理请求，请先处理后再归档。',
  'error.generic': '操作失败，请重试。',
} satisfies Record<QsSessionsLocaleKey, string>

/** 英文字典。 */
export const en = {
  'group.pinned': 'Pinned',
  'group.recent': 'Recent',
  'list.empty': 'No sessions yet.',
  'list.emptyLead': 'Create one and start with a sentence.',
  'list.new': 'New session',
  'list.newShortcut': 'Ctrl K',
  'row.manage': 'Manage the session',
  'menu.title': 'Manage the session',
  'menu.pin': 'Pin the session',
  'menu.unpin': 'Unpin the session',
  'menu.rename': 'Rename',
  'menu.archive': 'Archive the session',
  'menu.close': 'Cancel',
  'rename.title': 'Rename the session',
  'rename.label': 'Session name',
  'rename.save': 'Save',
  'archive.title': 'Archive the session',
  'archive.confirm': 'Archiving removes the session from the list; its history stays on the host.',
  'archive.cancel': 'Cancel',
  'archive.busy': 'This session is running or has pending requests; settle them before archiving.',
  'error.generic': 'The action failed. Try again.',
} satisfies Record<QsSessionsLocaleKey, string>
