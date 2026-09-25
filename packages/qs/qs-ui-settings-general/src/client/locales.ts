/** 设置壳文案由本插件维护，敏感服务错误不直接显示。 */
export const zh = {
  document: '打开本机配置文件', documentFailed: '配置文件打开失败，请重试。',
  title: '设置', close: '关闭设置', general: '通用设置', preferences: '偏好由对应功能插件管理。', empty: '当前没有可用的设置分区。',
  loading: '正在读取设置…', unavailable: '当前连接不提供持久设置；各功能的本地偏好不写入 Host。', readonly: '当前设置仅可查看。',
  failed: '设置同步失败；已显示的内容可能不是最新状态。', offline: '连接已断开，设置可能尚未同步。', connecting: '正在连接…', reconnect: '重新连接',
} as const
/** 英文与中文保持同键。 */
export const en = {
  document: 'Open local settings document', documentFailed: 'The settings document could not be opened. Try again.',
  title: 'Settings', close: 'Close settings', general: 'General', preferences: 'Preferences are managed by their feature plugins.', empty: 'No settings sections are available.',
  loading: 'Loading settings…', unavailable: 'Persistent settings are unavailable on this connection. Local feature preferences do not write to the Host.', readonly: 'These settings are read-only.',
  failed: 'Settings synchronization failed. Displayed values may be out of date.', offline: 'Disconnected. Settings may not be synchronized.', connecting: 'Connecting…', reconnect: 'Reconnect',
} satisfies Record<keyof typeof zh, string>
