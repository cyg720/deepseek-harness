/**
 * Permission preference row: the default preset for subsequently created
 * sessions. Current-session switches remain on the composer `/permission`
 * control.
 */
/**
 * 文件职责：实现权限预设的 PermissionRow 组件。
 * 技术维度：React、TypeScript、Cordis 插槽和 CSS Modules。
 * 产品维度：支持用户查看或调整权限预设。
 * 逻辑维度：读取服务状态，派生展示值并处理交互。
 * 关键边界：加载、禁用、错误和可访问性状态必须一致。
 * 新手阅读建议：先读 Props，再看状态、effect 与 JSX。
 */

import { useEffect, useState } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  IconChevronDownOutline14, Menu, RiskConfirmation,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PermissionSettingsState } from './settings-store.ts'
import type { PermissionSettingsKey } from './locales.ts'
import { FULL_ACCESS_PRESET } from './presentation.ts'
import css from './PermissionRow.module.css'

/** Registration-side business face for the host-backed preference. */
/** 中文说明：类型或类 PermissionRowInjected 约束本文件数据或组件职责。 */
export interface PermissionRowInjected {
  hooks: {
    /** Permission settings snapshot bound by the renderer as usePermission. */
    permission: SnapshotStore<PermissionSettingsState>
  }
  /** Load the descriptor when the row first renders. */
  load: () => Promise<void>
  /** Persist one advertised preset. */
  select: (preset: string) => Promise<void>
}

/** Full component props. */
/** 中文说明：类型或类 PermissionRowProps 约束本文件数据或组件职责。 */
export type PermissionRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'settings.permission'>
  & InjectFace<PermissionRowInjected>

/**
 * Render the new-session Permission default selector.
 * @param props - composed slot props.
 * @returns the row, or null when the host does not expose permission settings.
 */
/** 中文说明：函数 PermissionRow 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function PermissionRow({ load, select, usePermission, t }: PermissionRowProps) {
  /** 中文说明：组件局部值 state，由紧邻初始化决定。 */
  const state = usePermission(snapshot => snapshot)
  /** 中文说明：组件局部值 [open, setOpen]，由紧邻初始化决定。 */
  const [open, setOpen] = useState(false)
  /** 中文说明：组件局部值 解构结果，由紧邻初始化决定。 */
  const [confirmingFullAccess, setConfirmingFullAccess] = useState(false)
  /** 中文说明：组件局部值 解构结果，由紧邻初始化决定。 */
  const [acknowledged, setAcknowledged] = useState(false)

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (state.writable && state.status !== 'unavailable') return
    setOpen(false)
    setAcknowledged(false)
    setConfirmingFullAccess(false)
  }, [state.status, state.writable])

  if (state.status === 'unavailable') return null
  /** 中文说明：组件局部值 selected，由紧邻初始化决定。 */
  const selected = state.options.find(option => option.id === state.currentValue)
  /** 中文说明：组件局部值 busy，由紧邻初始化决定。 */
  const busy = state.status === 'loading' || state.status === 'saving' || confirmingFullAccess
  /** 中文说明：组件局部值 label，由紧邻初始化决定。 */
  const label = selected?.label
    ?? (busy ? t('loading') : t('unavailable'))
  /** 中文说明：组件局部值 description，由紧邻初始化决定。 */
  const description: string = state.error ?? t('description')

  return (
    <>
      <div className={css.row}>
        <div className={css.rowText}>
          <div className={css.title}>{t('title')}</div>
          <div className={css.desc} role={state.error === null ? undefined : 'alert'}>{description}</div>
        </div>
        <Menu
          open={open}
          onClose={() => { setOpen(false) }}
          items={state.options.map(option => ({ id: option.id, label: option.label }))}
          selectedId={state.currentValue}
          onSelect={(id) => {
            setOpen(false)
            if (id === state.currentValue) return
            if (id === FULL_ACCESS_PRESET) {
              setAcknowledged(false)
              setConfirmingFullAccess(true)
              return
            }
            void select(id)
          }}
          align="end"
          portal
          anchor={(
            <button
              type="button"
              className={css.selector}
              aria-haspopup="menu"
              aria-expanded={open}
              disabled={busy || !state.writable || state.options.length === 0}
              onClick={() => { setOpen(value => !value) }}
            >
              {label}
              <IconChevronDownOutline14 className={css.chevron} />
            </button>
          )}
        />
      </div>
      <RiskConfirmation
        open={confirmingFullAccess}
        title={t('confirm.title')}
        description={t('confirm.description')}
        acknowledgeLabel={t('confirm.acknowledge')}
        cancelLabel={t('confirm.cancel')}
        confirmLabel={t('confirm.enable')}
        acknowledged={acknowledged}
        disabled={!state.writable || state.status === 'saving'}
        onAcknowledgedChange={setAcknowledged}
        onCancel={() => {
          setAcknowledged(false)
          setConfirmingFullAccess(false)
        }}
        onConfirm={() => {
          setAcknowledged(false)
          setConfirmingFullAccess(false)
          void select(FULL_ACCESS_PRESET)
        }}
      />
    </>
  )
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  /** 中文说明：类型或类 LocaleNamespaceMap 约束本文件数据或组件职责。 */
  interface LocaleNamespaceMap {
    /** Permission row copy. */
    'settings.permission': PermissionSettingsKey
  }
}
