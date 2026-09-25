/** 根座位只判定当前会话；会话状态与标签资源均由子座位绑定。 */
import type { ReactNode } from 'react'
import type { PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import styles from './inspector.module.css'

/** 右栏根的几何意图与会话座位。 */
export type QsRightPanelProps = PropsRuntime<'qs.inspector'> & PropsLocale<'qs-ui-sidebar-right'>
  & PropsRenderSlots<'qs.sidebar.right.session'>
/**
 * 无会话时显示说明，有会话时挂载唯一 session 座位。
 * @param props - 外壳几何意图、当前会话与槽渲染器。
 * @returns 右栏或其会话子树。
 */
export function QsRightPanel({ t, useSessions, renderSlot, ...owner }: QsRightPanelProps): ReactNode {
  const hasSession = useSessions(state => state.current !== undefined)
  if (hasSession) return renderSlot('qs.sidebar.right.session', {
    hidden: owner.hidden, requestId: owner.requestId, reportOpen: owner.reportOpen,
  })
  return <aside className={`${styles.panel} ${owner.hidden ? styles.panelHidden : ''}`} aria-label={t('inspector.title')}
    {...(owner.hidden ? { inert: '' } : {})}><p className={styles.empty}>{t('inspector.noSession')}</p></aside>
}
