// @vitest-environment jsdom
/**
 * 文件职责：验证 OnboardingSurface portal 结构、主应用 inert 生命周期和缺少 #root 的兼容路径。
 * 技术维度：使用 jsdom、Testing Library、Vitest 生命周期钩子和 CSS Module 类名子串查询。
 * 产品维度：确保首次引导覆盖整页、阻止背景操作，又能在非标准挂载组合中正常显示。
 * 逻辑维度：每例创建/移除 #root；三个用例分别检查 portal 层级、inert 设置恢复和无 root 渲染。
 * 关键边界：overlay 必须是 body 子节点；测试后必须 cleanup 并移除手工 appRoot。
 * 新手阅读建议：先看 beforeEach/afterEach，再按 portal、inert、无 root 三条场景阅读。
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OnboardingSurface } from '@deepseek-ai/dsh-client-ui-primitives'

// 每个测试创建的主应用根元素。
let appRoot: HTMLDivElement

// 测试前创建并挂载 #root。
beforeEach(() => {
  appRoot = document.createElement('div')
  appRoot.id = 'root'
  document.body.appendChild(appRoot)
})

// 测试后卸载 React 树并移除 #root。
afterEach(() => {
  cleanup()
  appRoot.remove()
})

// OnboardingSurface 行为测试套件。
describe('OnboardingSurface', () => {
  // 验证遮罩 portal 到 body 且 stage 包含步骤内容。
  it('portals the overlay chrome to document.body around its content', () => {
    // 已渲染组件查询器。
    const view = render(<OnboardingSurface><p>step content</p></OnboardingSurface>)
    // Portaled: the overlay is a body child, not inside the render container.
    // portal 后遮罩是 body 子节点，不在 Testing Library render container 内。
    expect(view.container.querySelector('[class*="onboardingOverlay"]')).toBeNull()
    // body 中的 onboardingOverlay 元素。
    const overlay = document.body.querySelector('[class*="onboardingOverlay"]')
    expect(overlay).not.toBeNull()
    // The onboarding e2e pins the mask by class substring; the stage carries
    // the content.
    // e2e 按类名子串固定 mask，步骤内容由 stage 承载。
    expect(overlay!.querySelector('[class*="onboardingMask"]')).not.toBeNull()
    // 遮罩内的内容舞台。
    const stage = overlay!.querySelector('[class*="onboardingStage"]')
    expect(stage).not.toBeNull()
    expect(stage!.textContent).toBe('step content')
  })

  // 验证组件自身挂载期间精确持有 #root inert。
  it('holds #root inert for exactly its own lifetime', () => {
    // 当前组件视图，用于显式卸载。
    const view = render(<OnboardingSurface>x</OnboardingSurface>)
    expect(appRoot.inert).toBe(true)
    view.unmount()
    expect(appRoot.inert).toBe(false)
  })

  // 验证组合应用没有 #root 时仍能渲染 portal。
  it('renders without an #root element (compositions that mount elsewhere)', () => {
    appRoot.remove()
    // 无 #root 环境下的组件视图。
    const view = render(<OnboardingSurface>x</OnboardingSurface>)
    expect(document.body.querySelector('[class*="onboardingStage"]')!.textContent).toBe('x')
    view.unmount()
  })
})
