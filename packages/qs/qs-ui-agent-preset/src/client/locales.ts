/** 奇术预设目录文案，不把机器标识翻译为其他值。 */
export const zh = {
  title: '智能体预设', hint: '新会话使用所选预设；已有会话保留开始时的组成。',
  loading: '正在读取预设目录…', unavailable: '当前连接没有可用的预设目录。', failed: '预设目录读取失败，请重试。',
  reload: '刷新目录', system: '系统预设', user: '自建预设', default: '新会话默认', broken: '预设不可用',
  policyUnavailable: '预设设置暂不可用，请刷新重试。', readonly: '当前连接只允许查看设置。',
  picker: '允许新会话选择预设', savedDefault: '保存的默认预设', pickerOff: '选择器已关闭，新会话使用部署策略确定的预设。',
  saving: '正在保存…', written: '已保存。', conflict: '设置已变化，请刷新后重试。', refused: '保存未确认，请刷新后重试。', busy: '已有保存请求，请稍候。',
  sessionPreset: '会话预设', choosePreset: '请选择预设', applyingPreset: '正在应用预设…', presetFailed: '预设切换失败，请重试。', presetLocked: '已有会话保留开始时的预设。',
  presetInterrupted: '预设准备已中断，请重新启用预设插件并重试选择，或刷新页面后确认会话预设。',
  syncFailed: '设置已保存，但当前空白会话的预设未确认同步，请检查后再发送。',
} as const
/** 与中文词典逐键对应。 */
export const en = {
  title: 'Agent presets', hint: 'New sessions use the selected preset. Existing sessions retain their initial composition.',
  loading: 'Loading preset directory…', unavailable: 'This connection has no available preset directory.', failed: 'The preset directory could not be read. Retry to continue.',
  reload: 'Refresh directory', system: 'System preset', user: 'User preset', default: 'New-session default', broken: 'Preset unavailable',
  policyUnavailable: 'Preset settings are unavailable. Refresh to retry.', readonly: 'This connection allows viewing settings only.',
  picker: 'Allow preset selection for new sessions', savedDefault: 'Saved default preset', pickerOff: 'The picker is disabled. Deployment policy determines the preset for new sessions.',
  saving: 'Saving…', written: 'Saved.', conflict: 'Settings changed. Refresh and retry.', refused: 'Save was not confirmed. Refresh and retry.', busy: 'A save is in progress. Please wait.',
  sessionPreset: 'Session preset', choosePreset: 'Choose a preset', applyingPreset: 'Applying preset…', presetFailed: 'Preset selection failed. Retry to continue.', presetLocked: 'Existing sessions retain their initial preset.',
  presetInterrupted: 'Preset preparation was interrupted. Re-enable the preset plugin and retry selection, or reload the page and confirm the session preset.',
  syncFailed: 'Settings were saved, but the blank session preset could not be confirmed. Check it before sending.',
} satisfies Record<keyof typeof zh, string>
