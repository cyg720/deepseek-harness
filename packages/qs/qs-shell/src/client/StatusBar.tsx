/**
 * 底部状态条。
 *
 * 只显示可验证的事实：连接状态与手动重连。断连时**不清空也不禁用草稿**——草稿始终
 * 保留（见 07-异常与恢复矩阵 第 18 条），投递由发送路径自行拦下。
 */
import type { ReactNode } from 'react'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { QsStatusInjected, QsShellLocaleKey } from './contract.ts'
import styles from './status.module.css'

/** 状态条条目的完整 props。 */
export type QsStatusBarProps = InjectFace<QsStatusInjected> & PropsLocale<'qs-shell'>

/**
 * 连接状态到文案键。
 * @param state - 连接状态；undefined 表示首次结果尚未产生。
 * @returns 状态文案键。
 */
function statusKey(state: 'connected' | 'disconnected' | 'connecting' | undefined): QsShellLocaleKey {
  if (state === 'connected') return 'status.connected'
  if (state === 'disconnected') return 'status.disconnected'
  return 'status.connecting'
}

/**
 * 渲染状态条。
 * @param props - 连接态座席、重连动作与语言座席。
 * @returns 状态条节点。
 */
export function QsStatusBar({ useQsConnection, reconnect, t }: QsStatusBarProps): ReactNode {
  const state = useQsConnection(s => s.state)
  const loopback = useQsConnection(s => s.loopback)
  return (
    <div className={styles.bar} data-qs-status={state ?? 'unknown'}>
      <span className={styles.state} data-connected={state === 'connected' ? 'true' : 'false'}>
        <i className={styles.dot} aria-hidden="true" />
        {t(statusKey(state))}
      </span>
      <span className={styles.meta}>
        {loopback ? <span>{t('status.loopback')}</span> : null}
        {state === 'disconnected' ? (
          <button type="button" className="qs-text-button" onClick={reconnect}>
            {t('status.reconnect')}
          </button>
        ) : null}
      </span>
    </div>
  )
}
