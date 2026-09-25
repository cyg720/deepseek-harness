/** 转写设置遵循原型设置行，偏好与持久化由官方 Chat 持有。 */
import { useId } from 'react'
import type { ChatPresentation } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-qs-ui-settings-general/client'
import css from './transcript.module.css'
/** 官方转写偏好的设置座席。 */
export interface TranscriptViewInjected {
  readonly hooks: { readonly transcriptView: HostObservable<ReturnType<ChatPresentation['transcriptView']['getSnapshot']>> }
  /** @param mode - 已完成轮的普通或紧凑显示模式。 */
  setTranscriptView: ChatPresentation['setTranscriptView']
}
/** 转写设置行的本地化与共享偏好输入。 */
export type TranscriptViewProps = PropsRuntime<'qs.settings.general.item'> & InjectFace<TranscriptViewInjected> & PropsLocale<'qs-transcript'>
/**
 * 呈现共享转写设置，不创建本地偏好副本。
 * @param props - 官方偏好源、更新动作与本地化座席。
 * @returns 原型设置行。
 */
export function TranscriptViewRow({ useTranscriptView, setTranscriptView, t }: TranscriptViewProps) {
  const id = useId(), mode = useTranscriptView(value => value)
  return <div className={css.settingRow}>
    <div><label htmlFor={id}>{t('settings.transcript.title')}</label><p>{t('settings.transcript.description')}</p></div>
    <select id={id} value={mode} onChange={(event) => { setTranscriptView(event.currentTarget.value === 'normal' ? 'normal' : 'compact') }}>
      <option value="normal">{t('settings.transcript.normal')}</option>
      <option value="compact">{t('settings.transcript.compact')}</option>
    </select>
  </div>
}
