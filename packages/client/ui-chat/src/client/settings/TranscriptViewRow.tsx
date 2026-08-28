/** General Settings row for completed-Turn transcript presentation.
 * @remarks 文件说明：文件职责：实现 client/ui-chat 中 TranscriptViewRow 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript、React 与项目的插件化客户端组件体系，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的 client/ui-chat 能力，
 * 使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import { useState } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { IconChevronDownOutline14, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { TranscriptViewMode } from '../../chat-settings.ts'
import type { ChatKey } from '../locale.ts'
import css from './TranscriptViewRow.module.css'

/** Registration-side transcript preference face. */
export interface TranscriptViewRowInjected {
  hooks: {
    /** Persisted transcript preference bound as useTranscriptView. */
    transcriptView: SnapshotStore<TranscriptViewMode>
  }
  /** Change the completed-Turn transcript presentation. */
  setTranscriptView: (mode: TranscriptViewMode) => void
}

/** Full Settings-row props. */
export type TranscriptViewRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'chat'>
  & InjectFace<TranscriptViewRowInjected>

/**
 * 常量说明：OPTIONS 用于处理 OPTIONS 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const OPTIONS: readonly { id: TranscriptViewMode; label: ChatKey }[] = [
  { id: 'normal', label: 'settings.transcript.normal' },
  { id: 'compact', label: 'settings.transcript.compact' },
]

/**
 * Render the completed-Turn transcript mode selector.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 * @remarks 中文说明：功能说明：处理 TranscriptViewRow 相关流程；使用场景由所在模块及调用位置决定。；参数说明：{
 * useTranscriptView, setTranscriptView,…（TranscriptViewRowProps）：提供本次调用所需的
 * 数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * ；使用示例：典型用法：在完成前置校验后调用 TranscriptViewRow({ useTranscriptView…)，并按返回类型处理结果。
 */
export function TranscriptViewRow({ useTranscriptView, setTranscriptView, t }: TranscriptViewRowProps) {
  /**
   * 常量说明：mode 用于处理 mode 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(value)，并按返回类型处理结果。
   */
  const mode = useTranscriptView(value => value)
  /**
   * 常量说明：open、setOpen 用于处理 open、setOpen 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const [open, setOpen] = useState(false)
  /**
   * 常量说明：selectedLabel 用于处理 selectedLabel 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const selectedLabel = mode === 'normal'
    ? 'settings.transcript.normal'
    : 'settings.transcript.compact'
  /**
   * 常量说明：closeMenu 用于关闭 Menu 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：关闭 Menu 相关流程；使用场景由所在模块及调用位置决定。
   * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 closeMenu()，并按返回类型处理结果。
   */
  const closeMenu = () => { setOpen(false) }
  /**
   * 常量说明：selectMode 用于处理 selectMode 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 selectMode 相关流程；使用场景由所在模块及调用位置决定。
   * @param id （string）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。
   * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 selectMode(id)，并按返回类型处理结果。
   */
  const selectMode = (id: string) => {
    closeMenu()
    setTranscriptView(id as TranscriptViewMode)
  }
  /**
   * 常量说明：selector 用于处理 selector 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
  * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（由 TypeScript
  * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
  * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(value)，并按返回类型处理结果。
  */
  const selector = (
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
  )

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：option（由 TypeScript
   * 根据调用位置推断的类型）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(option)，并按返回类型处理结果。
   */
  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('settings.transcript.title')}</div>
        <div className={css.desc}>{t('settings.transcript.description')}</div>
      </div>
      <Menu
        open={open}
        onClose={closeMenu}
        items={OPTIONS.map(option => ({ id: option.id, label: t(option.label) }))}
        selectedId={mode}
        onSelect={selectMode}
        align="end"
        portal
        anchor={selector}
      />
    </div>
  )
}
