// @vitest-environment jsdom
/**
 * 文件职责：验证会话输入的 reasoning-row.client.spec.tsx 行为。
 * 技术维度：Vitest、React 渲染、事件模拟和服务替身。
 * 产品维度：防止会话输入用户流程回归。
 * 逻辑维度：构造状态，触发行为并断言结果和清理。
 * 关键边界：异步任务、全局替身和 DOM 必须在用例后恢复。
 * 新手阅读建议：先读辅助函数，再按场景顺序阅读。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { zh } from '../src/client/locale.ts'
import { AssistantMarkdown, type AssistantMarkdownProps } from '../src/client/chat/AssistantMarkdown.tsx'

/** 中文说明：测试局部值 nextAnimationFrameId，由紧邻初始化决定。 */
let nextAnimationFrameId = 1
/** 中文说明：测试局部值 animationFrames，由紧邻初始化决定。 */
let animationFrames = new Map<number, FrameRequestCallback>()

/** 中文说明：函数 flushAnimationFrames 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function flushAnimationFrames(count: number): void {
  /** 中文说明：测试局部值 index，由紧邻初始化决定。 */
  for (let index = 0; index < count; index += 1) {
    /** 中文说明：测试局部值 callbacks，由紧邻初始化决定。 */
    const callbacks = [...animationFrames.values()]
    animationFrames.clear()
    /** 中文说明：测试局部值 callback，由紧邻初始化决定。 */
    for (const callback of callbacks) callback(index)
  }
}

beforeEach(() => {
  nextAnimationFrameId = 1
  animationFrames = new Map()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    /** 中文说明：测试局部值 id，由紧邻初始化决定。 */
    const id = nextAnimationFrameId
    nextAnimationFrameId += 1
    animationFrames.set(id, callback)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    animationFrames.delete(id)
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** 中文说明：测试局部值 t，由紧邻初始化决定。 */
const t = makeTranslate(zh, commonZh)
/** 中文说明：测试局部值 renderMessageImages，由紧邻初始化决定。 */
const renderMessageImages: AssistantMarkdownProps['renderMessageImages'] = () => null

describe('ReasoningRow', () => {
  it('follows the latest streaming line, scrolls to its end, then restores the settled first line', () => {
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'reasoning', text: 'Inspect the session\nNewest reasoning tokens' }]}
        streaming
        renderMessageImages={renderMessageImages}
      />,
    )
    expect(view.getByText('运行中')).toBeTruthy()
    /** 中文说明：测试局部值 summary，由紧邻初始化决定。 */
    const summary = view.getByText('Newest reasoning tokens')
    Object.defineProperties(summary, {
      scrollWidth: { configurable: true, value: 300 },
      clientWidth: { configurable: true, value: 100 },
    })

    view.rerender(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'reasoning', text: 'Inspect the session\nNewest reasoning tokens keep arriving' }]}
        streaming
        renderMessageImages={renderMessageImages}
      />,
    )
    expect(summary.scrollLeft).toBe(0)
    flushAnimationFrames(2)
    expect(summary.scrollLeft).toBe(0)
    flushAnimationFrames(1)
    expect(summary.scrollLeft).toBe(200)
    expect(summary.getAttribute('data-follow-end')).toBe('true')

    view.rerender(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'reasoning', text: 'Inspect the session\nNewest reasoning tokens keep arriving\n' }]}
        streaming={false}
        renderMessageImages={renderMessageImages}
      />,
    )
    flushAnimationFrames(3)
    expect(view.getByText('Inspect the session')).toBeTruthy()
    expect(view.queryByText('运行中')).toBeNull()
    expect(summary.scrollLeft).toBe(0)
    expect(summary.hasAttribute('data-follow-end')).toBe(false)
  })

  it('expands from either Think or the reasoning summary', () => {
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'reasoning', text: 'Inspect the session\nCheck persistence' }]}
        streaming={false}
        renderMessageImages={renderMessageImages}
      />,
    )
    /** 中文说明：测试局部值 row，由紧邻初始化决定。 */
    const row = view.getByRole('button')

    fireEvent.click(view.getByText('Inspect the session'))
    expect(row.getAttribute('aria-expanded')).toBe('true')
    expect(view.getByText(/Check persistence/)).toBeTruthy()

    fireEvent.click(view.getByText('思考'))
    expect(row.getAttribute('aria-expanded')).toBe('false')
  })

  it('expanded Think drops the inline summary and renders plain prose, no IN card', () => {
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'reasoning', text: 'Inspect the session\nCheck persistence' }]}
        streaming={false}
        renderMessageImages={renderMessageImages}
      />,
    )
    fireEvent.click(view.getByText('思考'))
    expect(view.getAllByText(/Inspect the session/)).toHaveLength(1)
    expect(view.queryByText('IN')).toBeNull()
    expect(view.container.querySelector('[class*="ioCard"]')).toBeNull()
    expect(view.container.querySelector('[class*="thinkBody"]')).not.toBeNull()
  })
})
