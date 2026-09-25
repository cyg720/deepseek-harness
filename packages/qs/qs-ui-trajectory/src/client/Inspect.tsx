/** 工具卡通过官方共享 store 发出一次性调用定位请求。 */
import type { InspectProps } from './contract.ts'
/**
 * 只有 QS 轨迹实际存在时显示入口；目标激活不创建新的执行会话。
 * @param props - 工具调用、官方阅读动作与轨迹可用性。
 * @returns 轨迹定位按钮或空呈现。
 */
export function Inspect({ callId, actions, activate, useAvailable, t }: InspectProps) {
  const available = useAvailable(value => value)
  if (!available) return null
  return <button type="button" className="qs-text-button" data-qs-inspect-tool={callId} onClick={() => {
    activate()
    actions.openView('trajectory', callId)
  }}>{t('inspectTool')}</button>
}
