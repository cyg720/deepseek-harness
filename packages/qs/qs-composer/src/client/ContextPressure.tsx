/** 上下文估算展示复用官方投影，不参与发送或压缩决策。 */
import { useEffect, useState, type ReactNode } from 'react'
import type { UseProjection } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-token-meter/client'
import type { QsComposerProps } from './contract.ts'
import styles from './composer.module.css'

/**
 * 展示当前上下文压力与启发式组成，缺数据时明确显示不可用。
 * @param props - 当前会话投影座席和本地化函数。
 * @returns 可展开的估算面板。
 */
export function ContextPressure({ useProjection, t }: { useProjection: UseProjection; t: QsComposerProps['t'] }): ReactNode {
  const pressure = useProjection('contextPressure')
  const breakdown = useProjection('contextBreakdown')
  const [open, setOpen] = useState(false)
  const used = pressure?.projectedTokens ?? pressure?.pressureTokens
  const capacity = pressure?.contextWindow
  const available = used !== undefined && capacity !== undefined
  // 容量撤销后丢弃展开状态，避免模型切换恢复时自动展示旧面板。
  useEffect(() => { if (!available) setOpen(false) }, [available])
  if (!available) return <div className={styles.pressure} data-qs-context-pressure>{t('context.unavailable')}</div>
  const percent = Math.min(100, Math.round(used / capacity * 100))
  return <div className={styles.pressure} data-qs-context-pressure>
    <button type="button" className="qs-text-button" aria-expanded={open}
      onClick={() => { setOpen(value => !value) }}>{t('context.reading', { percent })}</button>
    {open ? <div className={styles.pressureBody}>
      <p>{t('context.used', { used, capacity })}</p>
      <p>{t('context.stale')}</p>
      {breakdown === undefined ? <p>{t('context.noBreakdown')}</p> : <>
        <p>{t('context.system', { value: breakdown.systemTokens })}</p>
        <p>{t('context.tools', { value: breakdown.toolsTokens })}</p>
        <p>{t('context.messages', { value: breakdown.messageTokens })}</p>
      </>}
      <p>{t('context.heuristic')}</p>
    </div> : null}
  </div>
}
