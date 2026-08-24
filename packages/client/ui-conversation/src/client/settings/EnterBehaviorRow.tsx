/** General Settings row for the Composer's busy-state Enter preference. */
/**
 * 文件职责：实现输入设置中的 EnterBehaviorRow 组件。
 * 技术维度：React、TypeScript、Cordis 插槽、响应式状态和 CSS Modules。
 * 产品维度：支持用户查看和操作输入设置。
 * 逻辑维度：读取属性与服务，派生显示状态，处理事件并渲染界面。
 * 关键边界：空状态、禁用状态、异步取消和可访问性属性必须一致。
 * 新手阅读建议：先读 Props，再看局部状态、effect 和 JSX。
 */
import { useState } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconChevronDownOutline14, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { BusyEnterBehavior } from '../contract/composer-submission.ts'
import type { ConversationKey } from '../locales.ts'
import css from './EnterBehaviorRow.module.css'

/** Registration-side preference face. */
/** 中文说明：类型或类 EnterBehaviorRowInjected 约束本文件的数据或组件职责。 */
export interface EnterBehaviorRowInjected {
  hooks: {
    /** Persisted busy-state preference bound as useBusyEnter. */
    busyEnter: SnapshotStore<BusyEnterBehavior>
  }
  /** Change the busy-state plain-Enter behavior. */
  setBusyEnter: (behavior: BusyEnterBehavior) => void
}

/** Full Settings-row props. */
/** 中文说明：类型或类 EnterBehaviorRowProps 约束本文件的数据或组件职责。 */
export type EnterBehaviorRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'conversation'>
  & InjectFace<EnterBehaviorRowInjected>

/** 中文说明：组件局部值 OPTIONS: readonly {，取值由紧邻初始化决定。 */
const OPTIONS: readonly {
  id: BusyEnterBehavior
  label: ConversationKey
}[] = [
  { id: 'queue', label: 'settings.enter.queue' },
  { id: 'steer', label: 'settings.enter.steer' },
]

/**
 * Render the busy-state Enter behavior selector.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
/** 中文说明：函数 EnterBehaviorRow 的参数见签名，返回结果供相邻流程使用；示例见本文件调用处。 */
export function EnterBehaviorRow({ useBusyEnter, setBusyEnter, t }: EnterBehaviorRowProps) {
  /** 中文说明：组件局部值 behavior，取值由紧邻初始化决定。 */
  const behavior = useBusyEnter(value => value)
  /** 中文说明：组件局部值 [open, setOpen]，取值由紧邻初始化决定。 */
  const [open, setOpen] = useState(false)
  /** 中文说明：组件局部值 selectedLabel，取值由紧邻初始化决定。 */
  const selectedLabel = behavior === 'queue' ? 'settings.enter.queue' : 'settings.enter.steer'

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('settings.enter.title')}</div>
        <div className={css.desc}>{t('settings.enter.description')}</div>
      </div>
      <Menu
        open={open}
        onClose={() => { setOpen(false) }}
        items={OPTIONS.map(option => ({ id: option.id, label: t(option.label) }))}
        selectedId={behavior}
        onSelect={(id) => {
          setOpen(false)
          setBusyEnter(id as BusyEnterBehavior)
        }}
        align="end"
        portal
        anchor={(
          <button
            type="button"
            className={css.selector}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => { setOpen(value => !value) }}
          >
            {t(selectedLabel)}
            <IconChevronDownOutline14 className={css.chevron} />
          </button>
        )}
      />
    </div>
  )
}
