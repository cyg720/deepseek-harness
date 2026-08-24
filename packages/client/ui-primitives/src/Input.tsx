// Input: single-line text input atom (search boxes, inline forms). Composer
// textareas are NOT this atom — they live with the conversation package.
// 文件职责：提供带可选前置图标的通用单行文本输入 React 原子组件。
// 技术维度：使用 React 原生 input 属性透传、TypeScript 交叉类型、clsx 和 CSS Modules。
// 产品维度：统一搜索框和行内表单的输入体验，同时允许调用方传递原生可访问性属性。
// 逻辑维度：拆出 icon 与 className，合并外壳类名，按需渲染图标并把其余属性传给 input。
// 关键边界：只用于单行输入；对话输入区的 textarea 由 conversation 包拥有。
// 新手阅读建议：先看 rest 如何透传到原生 input，再看 icon 的条件渲染和 className 合并。

import type { InputHTMLAttributes, ReactNode } from 'react'
import clsx from 'clsx'
import css from './Input.module.css'

/**
 * Render a text input with an optional leading icon.
 * @param props.icon - optional 16px leading icon node.
 * @returns wrapper span containing the native input; input attributes pass through.
 */
/**
 * 渲染一个可带 16 像素前置图标的单行文本输入框。
 * @param props - icon 是可选图标；className 扩展外壳样式；其余属性原样传给原生 input。
 * @returns 包含可选图标和原生输入控件的 span 外壳。
 * @example <Input aria-label="搜索" placeholder="输入关键词" />
 */
export function Input({ icon, className, ...rest }: {
  // icon：可选 React 节点；为 null 或 undefined 时不创建图标容器。
  icon?: ReactNode
  // className：附加到外层 span 的可选 CSS 类名。
  className?: string
} & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <span className={clsx(css.wrap, className)}>
      {icon != null && <span className={css.icon}>{icon}</span>}
      <input className={css.input} {...rest} />
    </span>
  )
}
