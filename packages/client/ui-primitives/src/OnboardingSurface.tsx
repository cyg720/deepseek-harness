import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import css from './OnboardingSurface.module.css'

/**
 * Render a body-portaled onboarding stage and keep the application root inert
 * while mounted.
 * @param props.children - the step's page content, centered on the stage.
 * @returns the body-portaled overlay tree.
 */
/* 渲染引导接管界面。@param children 居中显示的步骤内容。@returns portal 到 body 的遮罩树。@example <OnboardingSurface>步骤</OnboardingSurface>。 */
export function OnboardingSurface({ children }: { children: ReactNode }) {
  // 挂载与卸载副作用；只控制当前文档的主应用根节点 inert 状态。
  useEffect(() => {
    // 主应用 #root 元素；缺失时无法禁用背景交互。
    const appRoot = document.getElementById('root')
    if (appRoot === null) return
    appRoot.inert = true
    return () => { appRoot.inert = false }
  }, [])

  return createPortal((
    <div className={css.onboardingOverlay} role="presentation">
      <div className={css.onboardingMask} aria-hidden="true" />
      <div className={css.onboardingStage}>{children}</div>
    </div>
  ), document.body)
}
