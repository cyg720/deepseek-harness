/**
 * The session header's agent-preset label.
 *
 * Read-only by construction: a session's composition is fixed once its
 * conversation starts, and a header is only worth reading after that. Offering
 * a control here would promise a switch the host refuses; naming what the
 * session runs is the honest affordance, and the choice itself lives on the
 * new-session screen ({@link AgentPresetSeat}).
 */
/*
 * 文件职责：实现预设界面的 AgentPresetLabel 组件及交互。
 * 技术维度：React、TypeScript、Cordis 插槽、响应式快照和 CSS Modules。
 * 产品维度：帮助用户查看、选择或管理会话使用的代理预设。
 * 逻辑维度：读取注入状态，派生展示数据，响应操作并渲染组件树。
 * 关键边界：运行中会话的组成不可切换；异步操作和弹层必须随状态关闭。
 * 新手阅读建议：先读 Props 与注入接口，再看派生变量、effect 和 JSX。
 */

import { useEffect } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconAgentPresetOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: pulls the ui-conversation SlotMap merge (the header actions).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-agent-presets/types'
import type { AgentPresetSettingsState } from './settings-store.ts'
import { presetDisplayText } from './locales.ts'
import css from './AgentPresetLabel.module.css'

/** Registration-side business face for the header label. */
/* 中文说明：类型 AgentPresetLabelInjected 约束本文件数据字段及允许取值。 */
export interface AgentPresetLabelInjected {
  /** 中文说明：成员 hooks 保存实例运行状态，取值由声明类型限定。 */
  hooks: {
    /** Roster snapshot bound by the renderer as useAgentPresets. */
    agentPresets: SnapshotStore<AgentPresetSettingsState>
  }
  /** Read the roster, so the label can show a name rather than an id. */
  /* 中文说明：成员 load 保存实例运行状态，取值由声明类型限定。 */
  load: () => Promise<void>
}

/** Full component props. */
/* 中文说明：类型 AgentPresetLabelProps 约束本文件数据字段及允许取值。 */
export type AgentPresetLabelProps =
  PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<'settings.agentPreset'>
  & InjectFace<AgentPresetLabelInjected>

/**
 * Render this session's agent-preset name beside its title.
 * @param props - composed slot props.
 * @returns the label, or null when the session records no preset.
 */
/* 中文说明：函数 AgentPresetLabel 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
export function AgentPresetLabel({
  sessionId, useSessions, useAgentPresets, load, t,
}: AgentPresetLabelProps) {
  const preset = useSessions((state) => {
    const value = state.byId[sessionId]?.projectionValues?.agentPreset
    return typeof value === 'string' ? value : undefined
  })
  const options = useAgentPresets(state => state.options)

  useEffect(() => {
    // Deployments that compose no presets never label anything, so the roster
    // is only worth a request once a session reports one.
    if (preset !== undefined) void load()
  }, [preset, load])

  if (preset === undefined) return null

  /** 中文说明：当前处理步骤的局部值 option，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const option = options.find(entry => entry.id === preset)
  /** 中文说明：当前处理步骤的局部值 text，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const text = option === undefined ? undefined : presetDisplayText(option, t)
  return (
    <span className={css.label} title={text?.description ?? t('headerHint')}>
      <IconAgentPresetOutline16 size={14} className={css.icon} />
      {text?.name ?? preset}
    </span>
  )
}
