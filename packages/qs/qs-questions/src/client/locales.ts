/** qs-questions 的本地化字典。中文优先，英文同步维护。 */
import type { QsQuestionsLocaleKey } from './contract.ts'

/** 简体中文字典。 */
export const zh = {
  'markdown.copy': '复制代码',
  'markdown.copied': '已复制',
  'markdown.footnotes': '脚注',
  'card.eyebrow': '需要你的回答',
  'card.other': '其他（自行填写）',
  'card.otherPlaceholder': '填写你的回答…',
  'card.submit': '提交回答',
  'card.submitting': '正在提交…',
  'card.answerAll': '请先回答所有问题。',
  'card.error': '提交失败，请求仍然有效，可以重试。',
  'card.retry': '重试提交',
  'card.pendingNote': '在你答复前，这一步会一直等待。',
  'plan.eyebrow': '方案待确认',
  'plan.title': '请确认这份方案',
  'plan.approve': '批准并继续',
  'plan.decline': '不批准',
} satisfies Record<QsQuestionsLocaleKey, string>

/** 英文字典。 */
export const en = {
  'markdown.copy': 'Copy code',
  'markdown.copied': 'Copied',
  'markdown.footnotes': 'Footnotes',
  'card.eyebrow': 'Needs your answer',
  'card.other': 'Other (type your own)',
  'card.otherPlaceholder': 'Type your answer…',
  'card.submit': 'Submit answers',
  'card.submitting': 'Submitting…',
  'card.answerAll': 'Answer every question first.',
  'card.error': 'Submission failed; the request is still open, so you can retry.',
  'card.retry': 'Retry submission',
  'card.pendingNote': 'This step waits until you answer.',
  'plan.eyebrow': 'Plan for review',
  'plan.title': 'Confirm this plan',
  'plan.approve': 'Approve and continue',
  'plan.decline': 'Do not approve',
} satisfies Record<QsQuestionsLocaleKey, string>
