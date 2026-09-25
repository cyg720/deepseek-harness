/** 原型通用设置行；使用原生选择控件保留键盘和窄屏能力。 */
import { useId } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { LanguageInjected } from './index.ts'
import css from './language.module.css'
/** 语言偏好行的官方事实与操作座位。 */
export type LanguageProps = PropsRuntime<'qs.settings.general.item'> & InjectFace<LanguageInjected> & PropsLocale<'qs-locale'>
/**
 * 仅显示已注册语言，Host 只读时禁用持久偏好操作。
 * @param props - 官方目录、配置事实和语言选择命令。
 * @returns 原型语言设置行。
 */
export function Language({ useLocale, useSettings, setLocale, t }: LanguageProps) {
  const id = useId()
  const locale = useLocale(value => value), settings = useSettings(value => value)
  const temporary = settings.status === 'unavailable'
  const disabled = !temporary && (settings.status !== 'ready' || settings.view?.writable !== true)
  return <div className={css.row}>
    <div><label htmlFor={id}>{t('language')}</label><p>{t(temporary ? 'memory' : 'hint')}</p></div>
    <select id={id} value={locale.active} disabled={disabled} onChange={(event) => { setLocale(event.currentTarget.value) }}>
      {locale.locales.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
    </select>
  </div>
}
