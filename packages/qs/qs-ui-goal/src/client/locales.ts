/** 目标视图的中文源字典。 */
export const zh = {
  title: '会话目标', loading: '正在读取目标…', empty: '当前没有目标',
  active: '允许自动继续', reading: '正在读取激活状态…', disarmed: '当前未自动继续',
  paused: '目标已暂停', blocked: '目标受阻', complete: '目标已完成',
  rounds: '已启动 {started} 轮 / 上限 {limit} 轮',
  pause: '暂停自动继续', resume: '恢复自动继续', edit: '编辑目标', clear: '清除目标',
  clearHint: '确认清除当前目标？原会话内容将保留。', confirmClear: '确认清除',
  create: '创建目标', save: '保存目标', cancel: '取消', objective: '目标正文',
  pending: '正在提交…', readonly: '当前会话不可修改目标',
  exhausted: '已达轮数上限，当前不能恢复自动继续',
  conflict: '目标版本已变化。草稿已保留，请读取最新版本并确认后再保存。',
  refresh: '读取最新版本', refreshed: '已读取最新版本，请核对后保存；不会自动提交。',
  current: '最新目标正文', missing: '目标已清除或替换，当前草稿不能提交到另一个目标。',
  failed: '目标请求失败，请重试。', command: '目标指令', done: '操作已接收，等待状态同步。',
} as const

/** 英文字典与中文使用相同键。 */
export const en: Record<keyof typeof zh, string> = {
  title: 'Session goal', loading: 'Reading goal…', empty: 'No current goal',
  active: 'Automatic continuation enabled', reading: 'Reading activation…', disarmed: 'Automatic continuation inactive',
  paused: 'Goal paused', blocked: 'Goal blocked', complete: 'Goal complete',
  rounds: '{started} rounds started / limit {limit}',
  pause: 'Pause automatic continuation', resume: 'Resume automatic continuation', edit: 'Edit goal', clear: 'Clear goal',
  clearHint: 'Clear this goal? The conversation history will be preserved.', confirmClear: 'Confirm clear',
  create: 'Create goal', save: 'Save goal', cancel: 'Cancel', objective: 'Goal objective',
  pending: 'Submitting…', readonly: 'This session cannot modify goals',
  exhausted: 'Round limit reached; automatic continuation cannot resume',
  conflict: 'The goal version changed. Your draft is preserved; read the latest version and review before saving.',
  refresh: 'Read latest version', refreshed: 'Latest version loaded. Review before saving; nothing was submitted automatically.',
  current: 'Latest objective', missing: 'The goal was cleared or replaced. This draft cannot be submitted to another goal.',
  failed: 'Goal request failed. Please retry.', command: 'Goal command', done: 'Request accepted; waiting for state synchronization.',
}
