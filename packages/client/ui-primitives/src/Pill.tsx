// Pill: small rounded label chip (view switcher tabs, filters, badges).
// 文件职责：提供可作为静态标签或交互按钮的通用小型圆角胶囊组件。
// 技术维度：使用 React 条件渲染、原生按钮属性透传、clsx 和 CSS Modules。
// 产品维度：为视图切换、筛选和状态徽章提供一致外观，同时保留正确 HTML 语义。
// 逻辑维度：没有 onClick 时渲染 span；有 onClick 时渲染 type=button 并透传其余按钮属性。
// 关键边界：是否交互完全由 onClick 是否存在决定；静态分支不会透传按钮专用属性。
// 新手阅读建议：先比较两个返回分支的元素类型，再看 active 和 className 如何合并样式。

import type { ButtonHTMLAttributes, ReactNode } from 'react'
import clsx from 'clsx'
import css from './Pill.module.css'

/**
 * Render a pill chip. Interactive when onClick is supplied (renders a button);
 * otherwise a static span.
 * @param props.active - selected/active visual state.
 * @returns pill element.
 */
/*
 * 渲染静态或可交互胶囊。
 * @param props - active 控制选中态；onClick 决定是否使用 button；其余为原生按钮属性。
 * @returns 无 onClick 时为 span，有 onClick 时为 button。
 * @example <Pill active>全部</Pill> 或 <Pill onClick={handler}>筛选</Pill>。
 */
export function Pill({ active = false, className, children, onClick, ...rest }: {
  // active：是否显示已选中视觉状态，默认 false。
  active?: boolean
  // `| undefined` so a caller can forward an optional class straight through
  // under exactOptionalPropertyTypes (a CSS-module lookup is string|undefined).
  // 显式允许 undefined，使 exactOptionalPropertyTypes 下可直接透传 CSS Module 查询结果。
  className?: string | undefined
  // children：胶囊内部显示的任意 React 内容。
  children?: ReactNode
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  if (!onClick) {
    return <span className={clsx(css.pill, active && css.active, className)}>{children}</span>
  }
  return (
    <button
      type="button"
      className={clsx(css.pill, css.interactive, active && css.active, className)}
      onClick={onClick}
      {...rest}
    >
      {children}
    </button>
  )
}
