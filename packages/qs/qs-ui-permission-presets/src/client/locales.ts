/** QS 权限显示及风险确认词典。 */
export const zh = {
  readOnly: '只读', workspaceWrite: '工作区写入', fullAccess: '完全访问',
  riskTitle: '启用完全访问？', riskDescription: '此权限允许超出工作区限制的操作。请确认你了解并接受风险。',
  acknowledge: '我了解并接受此权限的风险', cancel: '取消', confirm: '启用完全访问',
  unavailable: '当前会话不提供权限预设。', failed: '权限切换未确认成功，请重试。',
  defaults: '默认权限', defaultsHint: '仅用于之后创建的新会话，不改变当前会话权限。',
  loading: '正在读取权限设置…', defaultsUnavailable: '当前连接未提供默认权限设置。',
  readError: '无法读取权限设置，请重试。', retry: '重新读取', readOnlyHint: '当前设置为只读。',
  saved: '新会话默认权限已保存。', saveFailed: '默认权限未确认保存，请重试。',
  conflict: '权限设置已更新，请重新选择并确认。', saving: '正在保存…',
  defaultsRisk: '之后创建的新会话将允许超出工作区限制的操作。现有会话权限不变。',
} as const
/** 英文文案与中文逐键对应。 */
export const en = {
  readOnly: 'Read Only', workspaceWrite: 'Workspace Write', fullAccess: 'Full access',
  riskTitle: 'Enable Full access?', riskDescription: 'Full access reduces confirmation steps and lets the agent perform more actions directly, including sensitive operations, file changes, or external commands. Only use it when you trust the current task.',
  acknowledge: 'I understand the risks and want to continue', cancel: 'Cancel', confirm: 'Enable Full access',
  unavailable: 'Permission presets are unavailable for this session.', failed: 'The permission change was not confirmed. Retry to continue.',
  defaults: 'Default permission', defaultsHint: 'Applies only to newly created sessions. Existing session permissions stay unchanged.',
  loading: 'Loading permission settings…', defaultsUnavailable: 'Default permission settings are unavailable on this connection.',
  readError: 'Permission settings could not be read. Retry to continue.', retry: 'Reload', readOnlyHint: 'These settings are read-only.',
  saved: 'Default permission for new sessions saved.', saveFailed: 'The default permission save was not confirmed. Retry to continue.',
  conflict: 'Permission settings changed. Select and confirm again.', saving: 'Saving…',
  defaultsRisk: 'New sessions will allow operations beyond workspace restrictions. Existing session permissions stay unchanged.',
} satisfies Record<keyof typeof zh, string>
