// Button: token-styled button atom. Variants map to the --dsw-alias-button-*
// fill families; no framework imports, all behavior via props.
// 文件职责：提供使用统一主题令牌的基础按钮组件。
// 技术维度：使用 React TSX、原生按钮属性透传、clsx 类名合并和 CSS Module。
// 产品维度：为表单、工具栏和次级操作提供外观一致且可访问的按钮。
// 逻辑维度：解析外观、尺寸、图标和内容，组合样式后渲染原生 button。
// 关键边界：默认 type 固定为 button；调用方传入的其余原生属性会透传到元素。
// 新手阅读建议：先看 ButtonVariant 和属性默认值，再看 clsx 如何选择三个样式类。

import type { ButtonHTMLAttributes, ReactNode } from 'react'
import clsx from 'clsx'
import css from './Button.module.css'

/** Visual variant, each backed by its --dsw-alias-button-* token family. */
/* 按钮视觉变体；每个值都对应一组 --dsw-alias-button-* 主题令牌。 */
export type ButtonVariant = 'primary' | 'ghost' | 'outline' | 'toolbar'

/**
 * Render a button.
 * @param props.variant - visual family (default 'ghost').
 * @param props.size - 'md' 36px capsule (figma Button) or 'sm' 28px compact.
 * @param props.icon - optional leading 16px icon node.
 * @returns the button element; native button attributes pass through.
 */
/*
 * 渲染基础按钮。
 * @param variant 视觉变体，默认 ghost。
 * @param size 尺寸，md 为 36px，sm 为 28px。
 * @param icon 可选前置图标。
 * @param className 调用方附加类名。
 * @param children 按钮正文。
 * @returns 透传原生属性的 button 元素。
 * @example <Button variant="primary">保存</Button>。
 */
export function Button({ variant = 'ghost', size = 'md', icon, className, children, ...rest }: {
  // 可选视觉系列；未传时使用 ghost。
  variant?: ButtonVariant
  // 可选高度规格；只允许 md 或 sm。
  size?: 'md' | 'sm'
  // 可选前置 React 节点；非空时包裹在固定图标容器内。
  icon?: ReactNode
  // 可选附加类名；undefined 表示只使用组件内样式。
  className?: string | undefined
  // 可选按钮内容，可为文字或任意 React 节点。
  children?: ReactNode
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={clsx(css.button, css[variant], css[size], className)} {...rest}>
      {icon != null && <span className={css.icon}>{icon}</span>}
      {children}
    </button>
  )
}
