// @vitest-environment jsdom
// ContextMeter (composer trailing control): occupancy ring gating, the
// click-open breakdown panel, and its close gestures.
/**
 * 文件职责：验证会话界面的 context-meter.client.spec.tsx 行为和边界。
 * 技术维度：Vitest、React 测试渲染、事件模拟与可控服务替身。
 * 产品维度：防止会话界面交互和展示在扩展后回归。
 * 逻辑维度：构造状态，触发渲染或交互，再断言输出和清理。
 * 关键边界：全局替身、计时器和异步任务必须在用例后恢复。
 * 新手阅读建议：先读辅助夹具，再按 describe 场景顺序阅读。
 */

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn, zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/index.ts'
import { ContextMeter, type ContextMeterProps } from '../src/client/skeleton/ContextMeter.tsx'
import css from '../src/client/skeleton/ContextMeter.module.css'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)

// Mirrors the real lookup chain (conversation namespace, then common).
/** 中文说明：测试局部值 t，取值由紧邻初始化决定。 */
const t = makeTranslate(zh, commonZh) as ContextMeterProps['t']
/** 中文说明：测试局部值 tEn，取值由紧邻初始化决定。 */
const tEn = makeTranslate(en, commonEn) as ContextMeterProps['t']

/** 中文说明：测试局部值 BREAKDOWN，取值由紧邻初始化决定。 */
const BREAKDOWN = { systemTokens: 120, toolsTokens: 21_500, messageTokens: 477_000 }

/** 中文说明：测试局部值 segmentClass，取值由紧邻初始化决定。 */
const segmentClass = css.segment
if (segmentClass === undefined) throw new Error('segment class missing from ContextMeter.module.css')

/** Stub the projection seat: a key-addressed table of whole values. */
/** 中文说明：函数 projections 的参数见签名，返回结果供相邻流程使用；示例见本文件调用处。 */
function projections(values: Record<string, unknown>): ContextMeterProps['useProjection'] {
  return (key: string) => values[key]
}

/** 中文说明：函数 meter 的参数见签名，返回结果供相邻流程使用；示例见本文件调用处。 */
function meter(values: Record<string, unknown>, translate: ContextMeterProps['t'] = t) {
  return render(<ContextMeter useProjection={projections(values)} t={translate} />)
}

describe('ContextMeter', () => {
  it('renders nothing until both pressure and capacity are known', () => {
    expect(meter({}).container.textContent).toBe('')
    expect(meter({ contextPressure: { pressureTokens: 32_000 } }).container.textContent).toBe('')
    expect(meter({ contextPressure: { contextWindow: 128_000 } }).container.textContent).toBe('')
  })

  it('shows the occupancy ring and opens the breakdown panel on click', () => {
    /** 中文说明：测试局部值 view，取值由紧邻初始化决定。 */
    const view = meter({
      contextPressure: { pressureTokens: 32_000, contextWindow: 128_000 },
      contextBreakdown: BREAKDOWN,
    })
    /** 中文说明：测试局部值 trigger，取值由紧邻初始化决定。 */
    const trigger = view.getByRole('button', { name: '上下文已用 25%' })
    expect(view.container.querySelector('[role="dialog"]')).toBeNull()
    fireEvent.click(trigger)
    /** 中文说明：测试局部值 panel，取值由紧邻初始化决定。 */
    const panel = view.container.querySelector('[role="dialog"]')!
    expect(panel.textContent).toContain('~32K / 128K')
    expect(panel.textContent).toContain('25%')
    expect(panel.textContent).toContain('上下文已用')
    expect(panel.textContent).toContain('系统提示词~120')
    expect(panel.textContent).toContain('工具~21.5K')
    expect(panel.textContent).toContain('对话消息~477K')
    // The occupancy bar splits into one colored segment per composition row.
    expect(panel.getElementsByClassName(segmentClass)).toHaveLength(3)
    // Clicking the trigger again toggles the panel shut.
    fireEvent.click(trigger)
    expect(view.container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('lets each locale own the headline word order around the reading', () => {
    /** 中文说明：测试局部值 values，取值由紧邻初始化决定。 */
    const values = {
      contextPressure: { pressureTokens: 32_000, contextWindow: 128_000 },
      contextBreakdown: BREAKDOWN,
    }
    /** 中文说明：测试局部值 zhView，取值由紧邻初始化决定。 */
    const zhView = meter(values)
    fireEvent.click(zhView.getByRole('button', { name: '上下文已用 25%' }))
    // The reading follows the label in Chinese and leads it in English; both
    // headers read as one sentence rather than a concatenated fragment.
    expect(zhView.container.querySelector('[role="dialog"]')!.textContent)
      .toMatch(/^上下文已用25%/)
    /** 中文说明：测试局部值 enView，取值由紧邻初始化决定。 */
    const enView = meter(values, tEn)
    fireEvent.click(enView.getByRole('button', { name: '25% of context used' }))
    expect(enView.container.querySelector('[role="dialog"]')!.textContent)
      .toMatch(/^25%of context used/)
  })

  it('draws no bar segment at zero occupancy', () => {
    /** 中文说明：测试局部值 view，取值由紧邻初始化决定。 */
    const view = meter({
      contextPressure: { pressureTokens: 0, contextWindow: 128_000 },
      contextBreakdown: BREAKDOWN,
    })
    fireEvent.click(view.getByRole('button', { name: '上下文已用 0%' }))
    /** 中文说明：测试局部值 panel，取值由紧邻初始化决定。 */
    const panel = view.container.querySelector('[role="dialog"]')!
    // `.segment` carries a min-width, so a zero-width part would still paint a
    // filled sliver over an empty context.
    expect(panel.getElementsByClassName(segmentClass)).toHaveLength(0)
    expect(panel.textContent).toContain('~0 / 128K')
  })

  it('reads the ring from the projected figure so a compaction shows at once', () => {
    // Same provider sample, a surface a compaction just shrank: the ring must
    // follow the projection rather than the sample it is anchored to.
    /** 中文说明：测试局部值 view，取值由紧邻初始化决定。 */
    const view = meter({
      contextPressure: { pressureTokens: 32_000, projectedTokens: 3_000, contextWindow: 128_000 },
      contextBreakdown: BREAKDOWN,
    })
    /** 中文说明：测试局部值 trigger，取值由紧邻初始化决定。 */
    const trigger = view.getByRole('button', { name: '上下文已用 2%' })
    fireEvent.click(trigger)
    expect(view.container.querySelector('[role="dialog"]')!.textContent).toContain('~3K / 128K')
  })

  it('omits the composition rows while the contextBreakdown projection is absent', () => {
    /** 中文说明：测试局部值 view，取值由紧邻初始化决定。 */
    const view = meter({ contextPressure: { pressureTokens: 32_000, contextWindow: 128_000 } })
    fireEvent.click(view.getByRole('button', { name: '上下文已用 25%' }))
    /** 中文说明：测试局部值 panel，取值由紧邻初始化决定。 */
    const panel = view.container.querySelector('[role="dialog"]')!
    expect(panel.textContent).toContain('~32K / 128K')
    expect(panel.textContent).not.toContain('系统提示词')
    expect(panel.textContent).not.toContain('对话消息')
    // Without composition shares, the bar falls back to one plain segment.
    expect(panel.getElementsByClassName(segmentClass)).toHaveLength(1)
  })

  it('closes when capacity disappears and stays closed when it returns', () => {
    /** 中文说明：测试局部值 values，取值由紧邻初始化决定。 */
    let values: Record<string, unknown> = {
      contextPressure: { pressureTokens: 32_000, contextWindow: 128_000 },
      contextBreakdown: BREAKDOWN,
    }
    /** 中文说明：测试局部值 view，取值由紧邻初始化决定。 */
    const view = render(<ContextMeter useProjection={(key: string) => values[key]} t={t} />)
    fireEvent.click(view.getByRole('button', { name: '上下文已用 25%' }))
    expect(view.container.querySelector('[role="dialog"]')).not.toBeNull()

    values = { contextPressure: { pressureTokens: 32_000 }, contextBreakdown: BREAKDOWN }
    view.rerender(<ContextMeter useProjection={(key: string) => values[key]} t={t} />)
    expect(view.container.textContent).toBe('')

    values = {
      contextPressure: { pressureTokens: 32_000, contextWindow: 128_000 },
      contextBreakdown: BREAKDOWN,
    }
    view.rerender(<ContextMeter useProjection={(key: string) => values[key]} t={t} />)
    expect(view.getByRole('button', { name: '上下文已用 25%' }).getAttribute('aria-expanded')).toBe('false')
    expect(view.container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('closes on outside pointerdown and Escape — but not inside clicks', () => {
    /** 中文说明：测试局部值 view，取值由紧邻初始化决定。 */
    const view = meter({
      contextPressure: { pressureTokens: 32_000, contextWindow: 128_000 },
      contextBreakdown: BREAKDOWN,
    })
    /** 中文说明：测试局部值 trigger，取值由紧邻初始化决定。 */
    const trigger = view.getByRole('button', { name: '上下文已用 25%' })
    /** 中文说明：测试局部值 openPanel，取值由紧邻初始化决定。 */
    const openPanel = () => {
      fireEvent.click(trigger)
      return view.container.querySelector('[role="dialog"]')!
    }
    // A pointerdown inside the panel keeps it open; outside closes it.
    /** 中文说明：测试局部值 again，取值由紧邻初始化决定。 */
    const again = openPanel()
    fireEvent.pointerDown(again)
    expect(view.container.querySelector('[role="dialog"]')).not.toBeNull()
    fireEvent.pointerDown(document.body)
    expect(view.container.querySelector('[role="dialog"]')).toBeNull()
    // Escape.
    openPanel()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(view.container.querySelector('[role="dialog"]')).toBeNull()
  })
})
