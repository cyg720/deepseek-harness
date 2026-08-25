// OnboardingSurface: the full-viewport first-run takeover an onboarding step
// wraps its visible content in. The overlay portals to this document's body
// (the Modal precedent: ancestor stacking contexts cannot leave sticky page
// controls above the mask), and the surface holds `#root` inert for exactly
// its own lifetime — a step that renders null paints nothing and blocks
// nothing, so "should onboarding show right now" stays a plain render
// decision inside the step component.
// 文件职责：为首次引导步骤提供全视口遮罩和不透明舞台，并临时禁用主应用交互。
// 技术维度：使用 React useEffect、React Portal、HTML inert 属性和 CSS Module。
// 产品维度：让新用户专注完成当前引导步骤，避免误操作背景页面。
// 逻辑维度：挂载时将 #root 设为 inert，卸载时恢复；可见内容通过 portal 渲染到 body。
// 关键边界：步骤返回 null 时本组件不挂载也不阻塞；找不到 #root 时只渲染遮罩而不设置 inert。
// 新手阅读建议：先看 useEffect 的设置/清理对称性，再看 portal 中 mask 与 stage 的层级。

import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import css from './OnboardingSurface.module.css'

/**
 * Render the onboarding takeover chrome (mask + opaque stage) around one
 * step's content and keep the application root inert while mounted.
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
