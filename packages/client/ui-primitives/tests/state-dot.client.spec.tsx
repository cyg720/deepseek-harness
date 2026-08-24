// @vitest-environment jsdom
// 中文：使用 jsdom 提供 DOM 环境，以渲染并检查 React 状态点组件。
/**
 * 中文说明：
 * - 文件职责：验证 StateDot 的状态标记、无障碍属性、两种图形结构、动画相位和尺寸。
 * - 技术维度：使用 Vitest、Testing Library、React 重渲染和 jsdom DOM 查询。
 * - 产品维度：确保完成、警告、进行中和错误状态在界面中稳定展示且不干扰读屏。
 * - 逻辑维度：依次覆盖数据属性、实心与像素矩阵结构、尺寸参数及 TypeScript 非法状态。
 * - 关键边界：进行中状态固定包含八个动画单元；未知状态只在编译期拒绝。
 * - 新手阅读建议：先比较 span 与 svg 两条渲染路径，再看 rerender 如何复用同一容器检查变化。
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'

/** 中文：每个用例后清空挂载 DOM，防止组件状态串扰。 */
afterEach(cleanup)

/** 中文：StateDot 客户端渲染测试组。 */
describe('StateDot', () => {
  /** 中文：遍历四种合法 state，检查 data-state 和 aria-hidden；state 是当前枚举值，无返回值。 */
  it.each(['done', 'warning', 'ongoing', 'error'] as const)('renders state %s as data-state', (state) => {
    /** 当前状态点的渲染容器。 */
    const { container } = render(<StateDot state={state} />)
    /** 容器中的状态点根元素。 */
    const dot = container.firstElementChild as HTMLElement
    expect(dot.dataset['state']).toBe(state)
    expect(dot.getAttribute('aria-hidden')).toBe('true')
  })

  /** 中文：验证静态状态使用 span、进行中使用八格 SVG；无参数和返回值。 */
  it('solid states are spans; ongoing is an svg pixel matrix', () => {
    /** container 是挂载容器，rerender 用于切换同一组件状态。 */
    const { container, rerender } = render(<StateDot state="done" />)
    expect(container.firstElementChild?.tagName).toBe('SPAN')
    rerender(<StateDot state="ongoing" />)
    /** 进行中状态的 SVG 根节点。 */
    const matrix = container.firstElementChild as SVGSVGElement
    expect(matrix.tagName).toBe('svg')
    /** SVG 内的八个动画矩形单元。 */
    const cells = matrix.querySelectorAll('rect')
    expect(cells).toHaveLength(8)
    // Chase phase: every cell carries its own negative animation delay.
    // 中文：追逐动画让每个单元使用不同的负延迟，从而在初次显示时就处于不同相位。
    /** 八个单元各自的动画延迟字符串。 */
    const delays = [...cells].map(cell => (cell).style.animationDelay)
    expect(new Set(delays).size).toBe(8)
  })

  /** 中文：验证 size 同时控制实心点和 SVG 的宽高；无参数和返回值。 */
  it('sizes via the size prop in both shapes', () => {
    /** container 是挂载容器，rerender 用于从实心状态切换到进行中状态。 */
    const { container, rerender } = render(<StateDot state="done" size={12} />)
    /** 应具有 12px 行内宽高的实心状态点。 */
    const dot = container.firstElementChild as HTMLElement
    expect(dot.style.width).toBe('12px')
    expect(dot.style.height).toBe('12px')
    rerender(<StateDot state="ongoing" size={12} />)
    /** 应具有数值宽高属性 12 的 SVG 状态环。 */
    const ring = container.firstElementChild as SVGSVGElement
    expect(ring.getAttribute('width')).toBe('12')
    expect(ring.getAttribute('height')).toBe('12')
  })

  /** 中文：通过 ts-expect-error 证明 paused 不属于公开状态联合；运行时只保留输入用于断言。 */
  it('rejects unknown states at the type level', () => {
    /** 保持 StateDotState 类型约束的恒等函数。 */
    const bad = (state: StateDotState) => state
    // @ts-expect-error 'paused' is not one of the four states
    // 中文：paused 故意违反四种合法状态，用于验证编译器会报告错误。
    expect(bad('paused')).toBe('paused')
  })
})
