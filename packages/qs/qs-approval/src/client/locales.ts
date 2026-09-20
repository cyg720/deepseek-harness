/** qs-approval 的本地化字典。中文优先，英文同步维护。 */
import type { QsApprovalLocaleKey } from './contract.ts'

/** 简体中文字典。 */
export const zh = {
  'card.eyebrow': '需要你的确认',
  'card.title': '工具请求执行',
  'card.reason': '请求原因',
  'card.detail': '将要执行的内容',
  'card.detailTarget': '目标',
  'card.detailFallback': '这一条请求没有附带可展示的调用详情，请按工具名与原因判断。',
  'card.allow': '允许一次',
  'card.reject': '拒绝',
  'card.submitting': '正在提交…',
  'card.pendingNote': '在你答复前，这一步会一直等待。',
  'card.error': '答复提交失败，请求仍然有效，可以重试。',
  'card.retry': '重试答复',
  'card.args': '调用参数',
} satisfies Record<QsApprovalLocaleKey, string>

/** 英文字典。 */
export const en = {
  'card.eyebrow': 'Needs your confirmation',
  'card.title': 'A tool asks to run',
  'card.reason': 'Reason given',
  'card.detail': 'What will run',
  'card.detailTarget': 'Target',
  'card.detailFallback': 'This request carries no displayable call detail; judge by the tool name and reason.',
  'card.allow': 'Allow once',
  'card.reject': 'Reject',
  'card.submitting': 'Submitting…',
  'card.pendingNote': 'This step waits until you answer.',
  'card.error': 'Submitting the answer failed; the request is still open, so you can retry.',
  'card.retry': 'Retry the answer',
  'card.args': 'Call arguments',
} satisfies Record<QsApprovalLocaleKey, string>
