/** 原型通用设置行使用标签及右侧原生选择控件。 */
import { useId } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ThemeInjected } from './index.ts'
import css from './rows.module.css'
/** 两行共享官方主题及 Host 可写状态。 */
export type ThemeProps = PropsRuntime<'qs.settings.general.item'> & InjectFace<ThemeInjected> & PropsLocale<'qs-ui-theme'>
// 官方服务接受的协议范围，不是部署参数；用例与官方常量逐项对照。
const SIZES = [12, 13, 14, 15, 16, 17] as const
/**
 * 外观选择保留 system 偏好，不能用解析后的明暗值替代。
 * @param props - 官方主题和操作座位。
 * @returns 原型外观行。
 */
export function Appearance({ useTheme, useSettings, setTheme, t }: ThemeProps) {
  const id = useId(), theme = useTheme(value => value), settings = useSettings(value => value)
  const temporary = settings.status === 'unavailable'
  const disabled = !temporary && (settings.status !== 'ready' || settings.view?.writable !== true)
  return <div className={css.row}>
    <div><label htmlFor={id}>{t('appearance')}</label><p>{t(temporary ? 'memory' : 'appearanceHint')}</p></div>
    <select id={id} value={theme.preference} disabled={disabled} onChange={(event) => { setTheme(event.currentTarget.value) }}>
      {(['light', 'dark', 'system'] as const).map(value => <option key={value} value={value}>{t(value)}</option>)}
    </select>
  </div>
}
/**
 * 字号选项限定为官方协议接受的整数值。
 * @param props - 官方字号和操作座位。
 * @returns 原型字号行。
 */
export function FontSize({ useTheme, useSettings, setFontSize, t }: ThemeProps) {
  const id = useId(), theme = useTheme(value => value), settings = useSettings(value => value)
  const temporary = settings.status === 'unavailable'
  const disabled = !temporary && (settings.status !== 'ready' || settings.view?.writable !== true)
  return <div className={css.row}>
    <div><label htmlFor={id}>{t('fontSize')}</label><p>{t(temporary ? 'memory' : 'fontHint')}</p></div>
    <select id={id} value={theme.fontSize} disabled={disabled} onChange={(event) => { setFontSize(Number(event.currentTarget.value)) }}>
      {SIZES.map(value => <option key={value} value={value}>{value}</option>)}
    </select>
  </div>
}
