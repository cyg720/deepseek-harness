/** 原型输入区模型下拉框消费唯一目录，推理强度按模型声明动态呈现。 */
import { useEffect } from 'react'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import type {} from '@deepseek-ai/dsh-qs-composer/client'
import { modelChoices } from './selection.ts'
import css from './model.module.css'
/** 会话目录由官方解析器拥有，本插件只读取与提交。 */
export interface ModelSeatInjected {
  readonly available: boolean
  readonly hooks: { readonly directory: HostObservable<ModelDirectoryState> }
  /** 重新读取目录，失败由快照呈现。 */
  readonly load: () => void
  /** @param selection - 完整路由及推理强度。 @returns Host 接受结果。 */
  readonly select: (selection: ModelSelection) => Promise<boolean>
}
/** 模型入口绑定严格会话座位。 */
export type ModelSeatProps = PropsRuntime<'qs.composer.model'> & InjectFace<ModelSeatInjected> & PropsLocale<'qs-ui-model-selection'>
/**
 * 渲染原型风格模型与推理强度选择器。
 * @param props - 目录、动作、输入锁定状态及本地化。
 * @returns 输入区选择器；子会话不提供 Agent 绑定操作。
 */
export function ModelSeat({ available, locked, useDirectory, load, select, t }: ModelSeatProps) {
  const state = useDirectory(value => value)
  useEffect(() => { if (available) load() }, [available, load])
  if (!available) return null
  const choices = modelChoices(state)
  const current = choices.find(row => row.selection.provider === state.current?.provider && row.selection.model === state.current.model)
  const model = state.groups.find(group => group.id === state.current?.provider)?.models.find(row => row.id === state.current?.model)
  const reasoning = model?.reasoning
  const disabled = locked || state.status === 'selecting' || state.status === 'loading'
  return <div className={css.model} data-qs-model-selection>
    <label><span className="qs-sr-only">{t('model')}</span><select aria-label={t('model')} value={current?.id ?? ''}
      disabled={disabled || choices.length === 0} onChange={(event) => {
        const choice = choices.find(row => row.id === event.target.value)
        if (choice !== undefined) void select(choice.selection)
      }}>
      {current === undefined && <option value="" disabled>{state.current?.model ?? t(state.status === 'loading' ? 'loading' : 'choose')}</option>}
      {choices.map(row => <option key={row.id} value={row.id}>{row.provider} · {row.label}</option>)}
    </select></label>
    {reasoning === undefined || state.current === null ? null : <label>{t('effort')}<select
      aria-label={t('effort')} value={state.current.reasoningEffort ?? reasoning.defaultEffort ?? ''} disabled={disabled}
      onChange={(event) => {
        const effort = event.target.value
        if (state.current === null || (effort !== '' && !reasoning.efforts.some(row => row.id === effort))) return
        void select({ provider: state.current.provider, model: state.current.model, ...(effort === '' ? {} : { reasoningEffort: effort }) })
      }}>
      {reasoning.defaultEffort === undefined && <option value="">{t('providerDefault')}</option>}
      {reasoning.efforts.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
    </select></label>}
    {state.status === 'error' ? <span role="alert">{t('failed')}<button type="button" onClick={load}>{t('retry')}</button></span> : null}
    {state.failures.length > 0 ? <span role="status">{t('partial')}</span> : null}
  </div>
}
