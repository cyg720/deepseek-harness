/** 持久消息反馈动作；读写均委托共享反馈 owner。 */
import { useEffect, useRef, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MessageFeedbackInjected } from '@deepseek-ai/dsh-client-ui-message-feedback/client'
import type { MessageFeedbackRating } from '@deepseek-ai/dsh-message-feedback/types'
import { IconLikeOutline16, IconDislikeOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './feedback.module.css'

/** 当前持久消息与官方反馈快照、操作。 */
export type ActionsProps = InjectFace<MessageFeedbackInjected> & PropsRuntime<'qs.chat.assistant-actions'> & PropsLocale<'qs-ui-message-feedback'>

/**
 * 延迟读取反馈，记录评价后再次点击撤回；卸载后不打开别的会话表单。
 * @param props - 消息身份、共享反馈操作与文案。
 * @returns 评价按钮及加载或撤回失败提示。
 */
export function Actions({ messageId, useFeedback, ensure, current, retract, openDialog, t }: ActionsProps) {
  const rating = useFeedback(view => view.items.get(messageId)?.rating)
  const loadFailed = useFeedback(view => view.status === 'error')
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const operation = useRef({ alive: true, pending: false, seeded: false })
  useEffect(() => {
    const owner = { alive: true, pending: false, seeded: false }
    operation.current = owner
    setPending(false); setFailure(null)
    return () => { owner.alive = false }
  }, [messageId, ensure, current, retract, openDialog])
  const seed = (): void => {
    if (operation.current.seeded) return
    operation.current.seeded = true
    void ensure()
  }
  const choose = async (next: MessageFeedbackRating): Promise<void> => {
    const owner = operation.current
    const isCurrent = (): boolean => owner.alive
    if (owner.pending) return
    owner.pending = true; setPending(true); setFailure(null)
    const loaded = await ensure()
    if (!isCurrent()) return
    if (!loaded.ok) {
      owner.pending = false; setPending(false); setFailure(t('error.load')); return
    }
    if (current(messageId)?.rating !== next) {
      owner.pending = false; setPending(false); openDialog(messageId, next); return
    }
    const result = await retract(messageId, next)
    if (!isCurrent()) return
    owner.pending = false; setPending(false)
    if (!result.ok) setFailure(t(result.error.code === 'version-conflict' ? 'error.conflict' : 'error.generic'))
  }
  return <div className={css.actions} data-qs-feedback-actions>
    <button type="button" aria-label={t(rating === 'positive' ? 'action.unlike' : 'action.like')}
      aria-pressed={rating === 'positive'} disabled={pending} onFocus={seed} onPointerEnter={seed}
      onClick={() => { void choose('positive') }}><IconLikeOutline16 /></button>
    <button type="button" aria-label={t(rating === 'negative' ? 'action.undislike' : 'action.dislike')}
      aria-pressed={rating === 'negative'} disabled={pending} onFocus={seed} onPointerEnter={seed}
      onClick={() => { void choose('negative') }}><IconDislikeOutline16 /></button>
    {failure !== null || loadFailed ? <span role="status">{failure ?? t('error.load')}</span> : null}
  </div>
}
