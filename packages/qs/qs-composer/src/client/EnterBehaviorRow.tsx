/** 忙碌 Enter 偏好使用原型设置行，状态与保存动作均由官方策略持有。 */
import { useId } from 'react'
import type { ConversationPresentation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-qs-ui-settings-general/client'
import css from './composer.module.css'
/** 官方发送偏好的共享设置座位。 */
export interface EnterBehaviorInjected {
  readonly hooks: { readonly busyEnter: HostObservable<ReturnType<ConversationPresentation['submission']['busyEnter']['getSnapshot']>> }
  /** @param behavior - 忙碌时普通发送的投递方式。 */
  setBusyEnter: ConversationPresentation['submission']['setBusyEnter']
}
/** 设置行的本地化与状态座位。 */
export type EnterBehaviorProps = PropsRuntime<'qs.settings.general.item'> & InjectFace<EnterBehaviorInjected> & PropsLocale<'qs-composer'>
/**
 * 呈现忙碌 Enter 偏好，不复制偏好状态。
 * @param props - 官方共享偏好与本地化座位。
 * @returns 原型设置行。
 */
export function EnterBehaviorRow({ useBusyEnter, setBusyEnter, t }: EnterBehaviorProps) {
  const id = useId(), behavior = useBusyEnter(value => value)
  return <div className={css.settingRow}>
    <div><label htmlFor={id}>{t('settings.enter.title')}</label><p>{t('settings.enter.description')}</p></div>
    <select id={id} value={behavior} onChange={(event) => { setBusyEnter(event.currentTarget.value === 'steer' ? 'steer' : 'queue') }}>
      <option value="queue">{t('settings.enter.queue')}</option>
      <option value="steer">{t('settings.enter.steer')}</option>
    </select>
  </div>
}
