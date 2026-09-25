/** 原型预设设置只编辑后续会话策略；保存值以共享设置镜像为准。 */
import { useEffect, useRef, useState } from 'react'
import type { SettingsMirrorSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { AgentPresetRoster } from '@deepseek-ai/dsh-agent-presets/types'
import type { QsPresetPolicy, QsPresetPolicyChange, QsPresetPolicyResult } from './policy.ts'
import type { zh } from './locales.ts'

/** 目录刷新会重新读取生效默认值，持久化策略不直接修改会话。 */
export interface PolicyControlsProps {
  readonly settings: SettingsMirrorSnapshot
  readonly roster: AgentPresetRoster
  readonly policy: QsPresetPolicy
  readonly refresh: () => Promise<void>
  readonly t: (key: keyof typeof zh) => string
}
/**
 * 呈现默认预设与模式开关；缺失描述保持不可写。
 * @param props - 官方镜像、目录和插件持有的写入器。
 * @returns 原型设置表单与保存反馈。
 */
export function PolicyControls({ settings, roster, policy, refresh, t }: PolicyControlsProps) {
  const live = useRef(true), pending = useRef(false)
  const [result, setResult] = useState<QsPresetPolicyResult | 'none' | 'saving'>('none')
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])
  const view = settings.view?.namespaces.find(entry => entry.ns === 'agent-presets')
  const value = view?.value as { default?: unknown; modeSelectionEnabled?: unknown } | null | undefined
  if (settings.status !== 'ready' || settings.error !== null || typeof value?.default !== 'string' || typeof value.modeSelectionEnabled !== 'boolean' || view === undefined) {
    return <p role="status">{t('policyUnavailable')}</p>
  }
  const revision = view.revision
  const writable = settings.view?.writable === true
  const busy = result === 'saving'
  const save = async (change: QsPresetPolicyChange): Promise<void> => {
    if (pending.current) return
    pending.current = true; setResult('saving')
    const outcome = await policy.save(change, revision)
    if (!live.current) return
    pending.current = false; setResult(outcome)
    // 默认值由 Host 根据部署策略解析；保存后刷新目录，不推测 isDefault。
    if (outcome === 'written') await refresh()
  }
  const known = roster.presets.some(row => row.id === value.default)
  return <div>
    {!writable && <p role="status">{t('readonly')}</p>}
    <label>{t('picker')}<input type="checkbox" checked={value.modeSelectionEnabled} disabled={!writable || busy}
      onChange={(event) => { void save({ field: 'modeSelectionEnabled', value: event.target.checked }) }} /></label>
    <label>{t('savedDefault')}<select value={value.default} disabled={!writable || busy || !value.modeSelectionEnabled}
      onChange={(event) => { void save({ field: 'default', value: event.target.value }) }}>
      {!known && <option value={value.default} disabled>{value.default}</option>}
      {roster.presets.map(row => <option key={row.id} value={row.id} disabled={row.broken !== undefined}>{row.name ?? row.id}</option>)}
    </select></label>
    {!value.modeSelectionEnabled && <p>{t('pickerOff')}</p>}
    {result !== 'none' && result !== 'inactive' && <p role="status">{t(result)}</p>}
  </div>
}
