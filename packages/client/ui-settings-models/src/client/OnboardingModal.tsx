/** Shared modal chrome for every step registered by this onboarding plugin. */
/*
 * 文件职责：为模型设置引导步骤提供共享的阻塞式模态框外壳。
 * 技术维度：使用 React useEffect/useRef、Modal 组件、HTML inert 和可编程标题焦点。
 * 产品维度：引导用户完成模型配置时阻止背景操作，并把焦点放到合适位置。
 * 逻辑维度：挂载时保存并启用 root.inert，卸载恢复；按 focusTitle 聚焦标题，渲染无头 Modal。
 * 关键边界：隐式关闭被故意忽略；必须恢复挂载前 inert 值而非一律设 false。
 * 新手阅读建议：先看 ignoreImplicitDismiss，再阅读两个 effect，最后看 Modal 的 open/headless 属性。
 */

import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './OnboardingModal.module.css'

// Modal 隐式关闭回调；引导流程不允许点击遮罩或 Escape 跳过。
const ignoreImplicitDismiss = (): void => {}

/**
 * Render a blocking onboarding dialog and keep the application root inert.
 * @param props.title - accessible and visible dialog title.
 * @param props.focusTitle - focus the title when the step has no form control.
 * @param props.children - step-owned body and actions.
 * @returns the body-portaled modal.
 */
/*
 * 渲染阻塞式引导对话框。
 * @param title 标题。
 * @param focusTitle 是否聚焦标题。
 * @param children 正文与操作。
 * @returns portal 模态框。
 * @example <OnboardingModal title="配置">内容</OnboardingModal>。
 */
export function OnboardingModal({
  title, focusTitle = false, children,
}: {
  // 可见且无障碍的对话框标题。
  title: string
  // 无表单控件步骤是否把焦点移到标题，默认 false。
  focusTitle?: boolean
  // 步骤拥有的正文与操作节点。
  children: ReactNode
}): ReactNode {
  // 标题元素引用；focusTitle 为 true 时用于编程聚焦。
  const titleRef = useRef<HTMLHeadingElement | null>(null)

  // 主应用 inert 生命周期副作用。
  useEffect(() => {
    // 当前文档应用根节点。
    const appRoot = document.getElementById('root')
    if (appRoot === null) return
    // 挂载前的 inert 值，卸载时精确恢复。
    const previous = appRoot.inert
    appRoot.inert = true
    return () => { appRoot.inert = previous }
  }, [])

  // 根据 focusTitle 变化聚焦标题。
  useEffect(() => {
    if (focusTitle) titleRef.current?.focus()
  }, [focusTitle])

  return (
    <Modal
      open
      title={title}
      onClose={ignoreImplicitDismiss}
      headless
      className={css.dialog as string}
    >
      <div className={css.content}>
        <h2 ref={titleRef} className={css.title} tabIndex={focusTitle ? -1 : undefined}>{title}</h2>
        <div className={css.body}>{children}</div>
      </div>
    </Modal>
  )
}
