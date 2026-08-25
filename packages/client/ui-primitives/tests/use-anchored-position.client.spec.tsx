// @vitest-environment jsdom
/*
 * 文件职责：验证UI 基础组件的 use-anchored-position.client.spec.tsx 行为。
 * 技术维度：Vitest、React 测试渲染、DOM 事件和服务替身。
 * 产品维度：防止UI 基础组件的展示、作用域或交互回归。
 * 逻辑维度：构造上下文与属性，渲染后断言状态和清理。
 * 关键边界：Provider、订阅、全局 DOM 与异步任务必须释放。
 * 新手阅读建议：先读辅助夹具，再按场景顺序阅读。
 */
/**
 * `useAnchoredPosition` wiring: a floating panel is placed from its anchor and
 * keeps tracking it while open.
 *
 * The geometry itself needs real layout, which jsdom does not provide — the
 * browser layout scenario in `apps/web/tests/message-feedback-layout.e2e.ts`
 * owns that. What is asserted here is the wiring the clamp depends on: the
 * listeners and the panel-size observer are attached while open and released on
 * close, a size change replays the placement, and the hook still works where
 * `ResizeObserver` does not exist.
 */
import { useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { useAnchoredPosition } from '../src/useAnchoredPosition.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** One recorded `ResizeObserver` instance, so a test can drive its callback. */
/* 中文说明：类型或类 Recorded 约束模块数据或职责。 */
interface Recorded {
  callback: ResizeObserverCallback
  observed: Element[]
  disconnected: boolean
}

/**
 * Install a recording `ResizeObserver` double.
 * @returns the list every constructed observer registers itself in.
 */
/* 中文说明：函数 stubResizeObserver 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function stubResizeObserver(): Recorded[] {
  /** 中文说明：测试局部值 made，由紧邻初始化决定。 */
  const made: Recorded[] = []
  vi.stubGlobal('ResizeObserver', class {
    private readonly record: Recorded

    constructor(callback: ResizeObserverCallback) {
      this.record = { callback, observed: [], disconnected: false }
      made.push(this.record)
    }

    observe(element: Element) { this.record.observed.push(element) }
    disconnect() { this.record.disconnected = true }
  })
  return made
}

/**
 * Host component that anchors a panel and reports the computed position.
 * @param props - whether the panel is open.
 * @returns the anchor and, while open, the panel carrying the position.
 */
/* 中文说明：函数 Host 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function Host({ open }: { open: boolean }) {
  /** 中文说明：测试局部值 anchorRef，由紧邻初始化决定。 */
  const anchorRef = useRef<HTMLButtonElement>(null)
  /** 中文说明：测试局部值 panelRef，由紧邻初始化决定。 */
  const panelRef = useRef<HTMLDivElement>(null)
  /** 中文说明：测试局部值 position，由紧邻初始化决定。 */
  const position = useAnchoredPosition({ open, anchorRef, panelRef, gap: 4, margin: 12 })
  return (
    <>
      <button ref={anchorRef} type="button">anchor</button>
      {open && <div ref={panelRef} data-testid="panel" style={position ?? { visibility: 'hidden' }} />}
    </>
  )
}

describe('useAnchoredPosition', () => {
  it('observes the panel while open and disconnects when it closes', () => {
    /** 中文说明：测试局部值 made，由紧邻初始化决定。 */
    const made = stubResizeObserver()
    /** 中文说明：测试局部值 ui，由紧邻初始化决定。 */
    const ui = render(<Host open />)

    expect(made).toHaveLength(1)
    expect(made[0]?.observed).toEqual([ui.getByTestId('panel')])
    expect(made[0]?.disconnected).toBe(false)

    ui.rerender(<Host open={false} />)

    expect(made[0]?.disconnected).toBe(true)
  })

  it('replaces the panel when its own size changes', () => {
    /** 中文说明：测试局部值 made，由紧邻初始化决定。 */
    const made = stubResizeObserver()
    render(<Host open />)
    /** 中文说明：测试局部值 before，由紧邻初始化决定。 */
    const before = made[0]?.callback
    expect(before).toBeDefined()

    // A status line appearing inside the panel, or a dragged textarea, changes
    // the height without a scroll or resize event; the observer is the only
    // thing that notices, so driving its callback must not throw.
    expect(() => { before?.([], {} as ResizeObserver) }).not.toThrow()
  })

  it('still places the panel where ResizeObserver does not exist', () => {
    // jsdom's own condition, and any host without the API: the hook must fall
    // back to scroll and resize rather than fail at mount.
    vi.stubGlobal('ResizeObserver', undefined)

    expect(() => render(<Host open />)).not.toThrow()
  })

  it('attaches no listeners while the element is closed', () => {
    /** 中文说明：测试局部值 made，由紧邻初始化决定。 */
    const made = stubResizeObserver()
    /** 中文说明：测试局部值 add，由紧邻初始化决定。 */
    const add = vi.spyOn(window, 'addEventListener')

    render(<Host open={false} />)

    expect(made).toHaveLength(0)
    expect(add.mock.calls.filter(([type]) => type === 'scroll' || type === 'resize')).toEqual([])
    add.mockRestore()
  })
})
