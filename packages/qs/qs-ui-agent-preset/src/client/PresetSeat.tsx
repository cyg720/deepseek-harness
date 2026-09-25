/** 新会话选择与历史预设标识共享目录；已有会话只显示官方投影。 */
import { useEffect } from 'react'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-qs-composer/client'
import type { QsPresetRosterState } from './roster.ts'
import type { QsPresetSeatState } from './seat.ts'
import css from './directory.module.css'

/** 根选择器和会话标识共享的目录读取。 */
export interface PresetSeatInjected {
  readonly hooks: { readonly roster: HostObservable<QsPresetRosterState>; readonly seat: HostObservable<QsPresetSeatState> }
  /** @returns 目录刷新结束。 */
  readonly load: () => Promise<void>
  /** @param id - 目录标识。 @returns 选择提交结束。 */
  readonly select: (id: string) => Promise<void>
}
/** 新会话选择器的官方根座位与 QS 注入参数。 */
export type PresetSeatProps = PropsRuntime<'qs.workspace.hero.agentPreset'> & InjectFace<PresetSeatInjected> & PropsLocale<'qs-ui-agent-preset'>
/**
 * 呈现可选择的健康预设，提交期间不允许第二次选择。
 * @param props - 插槽提供的目录和选择状态。
 * @returns 原型风格选择器。
 */
export function PresetSeat({ useRoster, useSeat, load, select, t }: PresetSeatProps) {
  const directory = useRoster(value => value), seat = useSeat(value => value)
  useEffect(() => { void load() }, [load])
  if (directory.status !== 'ready') return <p role="status">{t(directory.status === 'error' ? 'failed' : directory.status === 'unavailable' ? 'unavailable' : 'loading')}</p>
  if (!directory.roster?.modeSelectionEnabled) return null
  const options = directory.roster.presets.filter(row => row.broken === undefined)
  return <div className={css.directory} data-qs-preset-seat>
    <label>{t('sessionPreset')}<select value={seat.current} disabled={seat.busy || options.length === 0}
      onChange={(event) => { void select(event.target.value) }}>
      {!options.some(row => row.id === seat.current) && <option value={seat.current} disabled>{seat.current || t('choosePreset')}</option>}
      {options.map(row => <option key={row.id} value={row.id}>{row.name ?? row.id}</option>)}
    </select></label>
    {seat.busy && <p role="status">{t('applyingPreset')}</p>}
    {seat.failed && <p role="alert">{t('presetFailed')}</p>}
  </div>
}
/** 当前会话标识由严格会话座位提供 sessionId。 */
export type PresetLabelProps = PropsRuntime<'qs.stage.header.actions'> & InjectFace<PresetSeatInjected> & PropsLocale<'qs-ui-agent-preset'>
/**
 * 显示已记录的会话预设，不以全局默认值替代缺失投影。
 * @param props - 严格会话座位与目录。
 * @returns 只读名称，无预设时隐藏。
 */
export function PresetLabel({ sessionId, useSessions, useRoster, load, t }: PresetLabelProps) {
  const preset = useSessions(state => state.byId[sessionId]?.projectionValues?.agentPreset)
  const directory = useRoster(value => value)
  useEffect(() => { if (typeof preset === 'string') void load() }, [preset, load])
  if (typeof preset !== 'string') return null
  const row = directory.roster?.presets.find(entry => entry.id === preset)
  return <span data-qs-preset-label title={t('presetLocked')}>{row?.name ?? preset}</span>
}
