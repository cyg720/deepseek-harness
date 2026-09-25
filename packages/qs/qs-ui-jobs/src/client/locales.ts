/** 后台作业及控制连接状态的中文文案。 */
export const zh = {
  notifyCompleted: '会话“{session}”中的后台作业已完成。',
  notifyFailed: '会话“{session}”中的后台作业失败，请在后台作业列表查看状态。',
  notifyKilled: '会话“{session}”中的后台作业已终止。',
  title: '后台作业', count: '后台作业（{count}）', empty: '当前会话没有作业记录。',
  loading: '正在加载作业状态…', reconnecting: '连接中断，正在重新连接；已有记录可能过期。',
  failed: '作业状态加载失败；已有记录可能过期。', disposed: '作业状态订阅已关闭。',
  retry: '重试加载作业', return: '返回所属会话',
  running: '运行中', stopping: '停止中', completed: '已完成', killed: '已终止', failedJob: '已失败',
  noDetail: '此作业未提供详情', noResult: '当前数据未提供结果正文；完成不代表存在文件或答案。',
  start: '开始时间', end: '结束时间', elapsed: '耗时', unfinished: '尚未结束', unavailable: '未提供', stale: '等待状态更新',
  seconds: '{seconds}秒', minutes: '{minutes}分{seconds}秒', hours: '{hours}小时{minutes}分',
} as const
/** 英文键与中文严格对应。 */
export const en: Record<keyof typeof zh, string> = {
  notifyCompleted: 'A background job in “{session}” completed.',
  notifyFailed: 'A background job in “{session}” failed. Check the job list for its status.',
  notifyKilled: 'A background job in “{session}” was terminated.',
  title: 'Background jobs', count: 'Background jobs ({count})', empty: 'No jobs in this session.',
  loading: 'Loading job status…', reconnecting: 'Reconnecting; existing records may be stale.',
  failed: 'Job status failed to load; existing records may be stale.', disposed: 'Job status subscription is closed.',
  retry: 'Retry loading jobs', return: 'Return to session',
  running: 'Running', stopping: 'Stopping', completed: 'Completed', killed: 'Terminated', failedJob: 'Failed',
  noDetail: 'This job provided no detail.', noResult: 'No result body is provided; completion does not guarantee a file or answer.',
  start: 'Started', end: 'Finished', elapsed: 'Duration', unfinished: 'Not finished', unavailable: 'Not provided', stale: 'Awaiting status update',
  seconds: '{seconds}s', minutes: '{minutes}m {seconds}s', hours: '{hours}h {minutes}m',
}
