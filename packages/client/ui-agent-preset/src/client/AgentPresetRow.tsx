/**
 * Agent-preset preference row: the preset new sessions are composed from.
 * A running session keeps the composition it began with, so this row never
 * disturbs work in progress.
 */
/**
 * 文件职责：实现预设界面的 AgentPresetRow 组件及交互。
 * 技术维度：React、TypeScript、Cordis 插槽、响应式快照和 CSS Modules。
 * 产品维度：帮助用户查看、选择或管理会话使用的代理预设。
 * 逻辑维度：读取注入状态，派生展示数据，响应操作并渲染组件树。
 * 关键边界：运行中会话的组成不可切换；异步操作和弹层必须随状态关闭。
 * 新手阅读建议：先读 Props 与注入接口，再看派生变量、effect 和 JSX。
 */

import { useEffect, useState } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AgentPresetSettingsState } from './settings-store.ts'
import { presetDisplayText, type AgentPresetSettingsKey } from './locales.ts'
import { PresetMenu } from './PresetMenu.tsx'
import css from './AgentPresetRow.module.css'

/** Registration-side business face for the host-backed preference. */
/** 中文说明：类型 AgentPresetRowInjected 约束本文件数据字段及允许取值。 */
export interface AgentPresetRowInjected {
  /** 中文说明：成员 hooks 保存实例运行状态，取值由声明类型限定。 */
  hooks: {
    /** Agent-preset settings snapshot bound by the renderer as useAgentPreset. */
    agentPreset: SnapshotStore<AgentPresetSettingsState>
  }
  /** Load the roster when the row first renders. */
  /** 中文说明：成员 load 保存实例运行状态，取值由声明类型限定。 */
  load: () => Promise<void>
  /** Persist one preset as the default for later sessions. */
  /** 中文说明：成员 select 保存实例运行状态，取值由声明类型限定。 */
  select: (id: string) => Promise<void>
}

/** Full component props. */
/** 中文说明：类型 AgentPresetRowProps 约束本文件数据字段及允许取值。 */
export type AgentPresetRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'settings.agentPreset'>
  & InjectFace<AgentPresetRowInjected>

/**
 * Render the new-session agent-preset selector.
 * @param props - composed slot props.
 * @returns the row, or null when the deployment composes no presets.
 */
/** 中文说明：函数 AgentPresetRow 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
export function AgentPresetRow({ load, select, useAgentPreset, t }: AgentPresetRowProps) {
  /** 中文说明：当前状态或快照 state，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const state = useAgentPreset(snapshot => snapshot)
  /** 中文说明：当前处理步骤的局部值 [open, setOpen]，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const [open, setOpen] = useState(false)

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (state.writable && state.status !== 'unavailable') return
    setOpen(false)
  }, [state.status, state.writable])

  // A deployment that composes no presets has nothing to choose between, and
  // every session shares the host composition — the row simply does not exist.
  if (state.status === 'unavailable') return null
  /** 中文说明：当前处理步骤的局部值 busy，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const busy = state.status === 'loading' || state.status === 'saving'
  // Every preset surface applies the same display-copy rule. The id remains
  // addressing rather than a label, except where no display name exists.
  /** 中文说明：当前处理步骤的局部值 chosen，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const chosen = state.options.find(option => option.id === state.currentValue)
  /** 中文说明：当前处理步骤的局部值 chosenText，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const chosenText = chosen === undefined ? undefined : presetDisplayText(chosen, t)
  /** 中文说明：当前处理步骤的局部值 label，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const label = state.currentValue === '' ? t('loading') : (chosenText?.name ?? state.currentValue)
  /** 中文说明：当前处理步骤的局部值 description，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const description: string = state.error ?? t('description')

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('title')}</div>
        <div className={css.desc} role={state.error === null ? undefined : 'alert'}>{description}</div>
      </div>
      <PresetMenu
        options={state.options}
        selectedId={state.currentValue}
        label={label}
        t={t}
        buttonClassName={css.selector}
        chevronClassName={css.chevron}
        disabled={busy || !state.writable || state.options.length === 0}
        open={open}
        onOpenChange={setOpen}
        onSelect={(id) => { void select(id) }}
      />
    </div>
  )
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  /** 中文说明：类型 LocaleNamespaceMap 约束本文件数据字段及允许取值。 */
  interface LocaleNamespaceMap {
    /** Agent-preset row copy. */
    'settings.agentPreset': AgentPresetSettingsKey
  }
}
