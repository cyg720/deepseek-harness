/** qs-composer 的本地化字典。中文优先，英文同步维护。 */
import type { QsComposerLocaleKey } from './contract.ts'

/** 简体中文字典。 */
export const zh = {
  'input.attachment': '暂不支持附件',
  'input.disconnected': '连接未就绪，草稿可继续编辑。',
  'input.placeholder': '描述你的任务，让奇术帮你一起完成…',
  'input.send': '发送消息',
  'input.stop': '停止生成',
  'input.sending': '正在发送…',
  'input.cancel': '取消本次发送',
  'input.stopNote': '停止只结束当前轮，已排队的任务仍按顺序继续。',
  'input.blocked': '请先完成对话中的确认，再发送新任务。',
  'input.suggestion1': '看看今天的设备状态',
  'input.suggestion2': '生成安全检查计划',
  'input.suggestion3': '整理本周安全报告',
  'input.model': '模型信息尚未就绪',
  'input.empty': '先说说你想完成什么。',
  'input.queued': '已加入队列',
  'input.queueEdit': '编辑队列文本，离开输入框保存',
  'input.queueTitle': '待发队列',
  'input.queueRemove': '移除这一项',
  'input.queueSteer': '引导当前轮',
  'input.queueFailed': '队列操作失败，任务仍保留。',
  'input.createFailed': '创建会话失败，草稿已保留。',
} satisfies Record<QsComposerLocaleKey, string>

/** 英文字典。 */
export const en = {
  'input.attachment': 'Attachments unavailable',
  'input.disconnected': 'Not connected; you can keep editing your draft.',
  'input.placeholder': 'Describe your task and let Qishu work on it with you…',
  'input.send': 'Send the message',
  'input.stop': 'Stop generating',
  'input.sending': 'Sending…',
  'input.cancel': 'Cancel this send',
  'input.stopNote': 'Stopping ends the current turn only; queued tasks keep their order.',
  'input.blocked': 'Finish the pending confirmation before sending a new task.',
  'input.suggestion1': 'Check today’s equipment status',
  'input.suggestion2': 'Draft a safety inspection plan',
  'input.suggestion3': 'Summarize this week’s safety report',
  'input.model': 'Model information is not ready',
  'input.empty': 'Start by describing what you want to finish.',
  'input.queued': 'Added to the queue',
  'input.queueEdit': 'Edit queued text; leave the field to save',
  'input.queueTitle': 'Queued messages',
  'input.queueRemove': 'Remove this item',
  'input.queueSteer': 'Steer the current turn',
  'input.queueFailed': 'The queue action failed; the item is kept.',
  'input.createFailed': 'Creating the session failed; your draft is kept.',
} satisfies Record<QsComposerLocaleKey, string>
