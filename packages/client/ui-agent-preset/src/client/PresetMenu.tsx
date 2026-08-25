/**
 * The preset picker both surfaces render: a menu of presets over a button
 * naming the current one.
 *
 * The settings row and the composer seat differ in where they sit, what they
 * call the current value, and when they refuse a pick — not in how the picker
 * itself behaves. Trust is the one thing the list always says: a locally
 * authored preset is exactly as privileged as the plugins it names, so the
 * label marks it rather than presenting every preset as shipped and vetted.
 */
/*
 * 文件职责：实现预设界面的 PresetMenu 组件及交互。
 * 技术维度：React、TypeScript、Cordis 插槽、响应式快照和 CSS Modules。
 * 产品维度：帮助用户查看、选择或管理会话使用的代理预设。
 * 逻辑维度：读取注入状态，派生展示数据，响应操作并渲染组件树。
 * 关键边界：运行中会话的组成不可切换；异步操作和弹层必须随状态关闭。
 * 新手阅读建议：先读 Props 与注入接口，再看派生变量、effect 和 JSX。
 */

import { IconChevronDownOutline14, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AgentPresetOption } from './settings-store.ts'
import { presetDisplayText, type AgentPresetSettingsKey } from './locales.ts'

/** What one surface passes to the shared picker. */
/* 中文说明：类型 PresetMenuProps 约束本文件数据字段及允许取值。 */
export interface PresetMenuProps {
  /** Presets to offer, in roster order. */
  /* 中文说明：成员 options 保存实例运行状态，取值由声明类型限定。 */
  options: readonly AgentPresetOption[]
  /** The preset the button names and the menu marks selected. */
  /* 中文说明：成员 selectedId 保存实例运行状态，取值由声明类型限定。 */
  selectedId: string
  /** Text on the button; the surfaces word a pending roster differently. */
  /* 中文说明：成员 label 保存实例运行状态，取值由声明类型限定。 */
  label: string
  /** Active Web locale lookup. */
  /* 中文说明：成员 t 保存实例运行状态，取值由声明类型限定。 */
  t: (key: AgentPresetSettingsKey) => string
  /** Class for the trigger button, owned by the calling surface. */
  /* 中文说明：成员 buttonClassName 保存实例运行状态，取值由声明类型限定。 */
  buttonClassName: string | undefined
  /** Class for the chevron, owned by the calling surface. */
  /* 中文说明：成员 chevronClassName 保存实例运行状态，取值由声明类型限定。 */
  chevronClassName: string | undefined
  /** Whether the trigger refuses interaction. */
  /* 中文说明：成员 disabled 保存实例运行状态，取值由声明类型限定。 */
  disabled: boolean
  /** Whether the menu is open — the surface owns this so it can force it shut. */
  /* 中文说明：成员 open 保存实例运行状态，取值由声明类型限定。 */
  open: boolean
  /** Report the menu's next open state. */
  /* 中文说明：成员 onOpenChange 保存实例运行状态，取值由声明类型限定。 */
  onOpenChange: (open: boolean) => void
  /** Called with the picked preset once the menu has closed. */
  /* 中文说明：成员 onSelect 保存实例运行状态，取值由声明类型限定。 */
  onSelect: (id: string) => void
}

/**
 * Render the preset picker.
 * @param props - the calling surface's copy, styling, and handlers.
 * @returns the menu and its trigger.
 */
/* 中文说明：函数 PresetMenu 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
export function PresetMenu({
  options, selectedId, label, t, buttonClassName, chevronClassName,
  disabled, open, onOpenChange, onSelect,
}: PresetMenuProps) {
  return (
    <Menu
      open={open}
      onClose={() => { onOpenChange(false) }}
      items={options.map((option) => {
        /** 中文说明：当前处理步骤的局部值 name，取值由紧邻初始化决定，仅在当前作用域使用。 */
        const name = presetDisplayText(option, t).name
        return {
          id: option.id,
          // All preset surfaces resolve copy the same way; the id is addressing,
          // not a label, except where no display name exists.
          label: option.trust === 'user' ? `${name} · ${t('userTrust')}` : name,
        }
      })}
      selectedId={selectedId}
      onSelect={(id) => {
        onOpenChange(false)
        onSelect(id)
      }}
      align="end"
      portal
      anchor={(
        <button
          type="button"
          className={buttonClassName}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={disabled}
          onClick={() => { onOpenChange(!open) }}
        >
          {label}
          <IconChevronDownOutline14 className={chevronClassName} />
        </button>
      )}
    />
  )
}
