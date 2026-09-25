/** 待回答区独立于阅读视图，切换视图不会销毁未提交答案。 */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

import styles from './stage.module.css'

/** @param props - 当前会话和交互链渲染器。 @returns 唯一待回答卡片。 */
export function PendingSeat({ sessionId, useSessionPendingInteraction, renderSlotChain, t }: PropsRuntime<'qs.stage.pending'> & PropsRenderSlots<'qs.stage.interaction'> & PropsLocale<'qs-conversation'>): ReactNode {
  const pendingInteraction = useSessionPendingInteraction(map => map.get(sessionId))
  const container = useRef<HTMLDivElement>(null)
  const previous = useRef({ sessionId, pending: false, origin: null as HTMLElement | null })
  const ownedFocus = useRef(false)
  const [settledSession, setSettledSession] = useState<typeof sessionId>()
  useLayoutEffect(() => {
    const state = previous.current
    if (state.sessionId !== sessionId) {
      state.sessionId = sessionId
      state.pending = false
      state.origin = null
      ownedFocus.current = false
    }
    const pending = pendingInteraction !== undefined
    // 撤销通知不保证携带回答者身份，只说明权威待回答状态已变化。
    if (!pending && state.pending) setSettledSession(sessionId)
    if (pending && !state.pending) setSettledSession(undefined)
    if (pending && !state.pending) {
      state.origin = document.activeElement instanceof HTMLElement ? document.activeElement : null
    }
    // 只恢复被已移除待答卡丢失的焦点；新会话或用户主动聚焦其他控件时不抢焦点。
    if (!pending && state.pending && ownedFocus.current && document.activeElement === document.body) {
      state.origin?.focus({ preventScroll: true })
      if (document.activeElement === document.body) {
        const stage = container.current?.closest('main')
        const input = stage?.querySelector<HTMLElement>('#qs-composer-input:not(:disabled)')
        const target = input ?? stage?.querySelector<HTMLElement>('[data-qs-session-heading]')
        target?.focus({ preventScroll: true })
      }
    }
    state.pending = pending
    if (!pending) ownedFocus.current = false
  }, [pendingInteraction, sessionId])
  return <div ref={container} data-qs-pending onFocusCapture={() => { ownedFocus.current = true }}
    onBlurCapture={(event) => {
      // 元素卸载或禁用造成的空 relatedTarget 保留所有权；真实焦点迁移按目标更新。
      if (event.relatedTarget !== null) ownedFocus.current = event.currentTarget.contains(event.relatedTarget)
    }}>
    {pendingInteraction === undefined && settledSession === sessionId
      ? <p className={styles.pendingNotice} role="status" data-qs-interaction-updated>{t('pending.updated')}</p> : null}
    {renderSlotChain('qs.stage.interaction', { sessionId, pendingInteraction }, { fallback: null })}
  </div>
}
