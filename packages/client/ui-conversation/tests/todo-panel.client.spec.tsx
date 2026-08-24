// @vitest-environment jsdom
/**
 * 文件职责：验证会话输入的 todo-panel.client.spec.tsx 行为。
 * 技术维度：Vitest、React 渲染、事件模拟和服务替身。
 * 产品维度：防止会话输入用户流程回归。
 * 逻辑维度：构造状态，触发行为并断言结果和清理。
 * 关键边界：异步任务、全局替身和 DOM 必须在用例后恢复。
 * 新手阅读建议：先读辅助函数，再按场景顺序阅读。
 */
/**
 * Todo display acceptance: the TodoPanel plan strip (empty-hidden, status rows
 * including several `in_progress` at once, collapse), and its TodoDock
 * adapter (selects the plan off the session snapshot and follows changes).
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { TodoItem } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { TodoDockProps } from '../src/client/skeleton/TodoPanel.tsx'
import { TodoDock, TodoPanel, todoDockEntry } from '../src/client/skeleton/TodoPanel.tsx'
import { NS, zh } from '../src/client/locales.ts'

// Mirrors the real lookup chain (conversation namespace, then common).
/** 中文说明：测试局部值 t，由紧邻初始化决定。 */
const t: TodoDockProps['t'] = makeTranslate(zh, commonZh)

afterEach(cleanup)

/** 中文说明：测试局部值 LIST，由紧邻初始化决定。 */
const LIST: TodoItem[] = [
  { content: '搭骨架', status: 'completed' },
  { content: '写组件', status: 'in_progress' },
  { content: '补测试', status: 'pending' },
]

/** A parallel plan: three tasks running at once (concurrent subagents). */
/** 中文说明：测试局部值 PARALLEL，由紧邻初始化决定。 */
const PARALLEL: TodoItem[] = [
  { content: '搭骨架', status: 'completed' },
  { content: '写组件', status: 'in_progress' },
  { content: '跑后台构建', status: 'in_progress' },
  { content: '读源码', status: 'in_progress' },
  { content: '补测试', status: 'pending' },
]

describe('TodoPanel', () => {
  it('renders nothing while the list is empty', () => {
    /** 中文说明：测试局部值 { container }，由紧邻初始化决定。 */
    const { container } = render(<TodoPanel todos={[]} t={t} />)
    expect(container.innerHTML).toBe('')
  })

  it('starts collapsed with the per-status count summary visible', () => {
    render(<TodoPanel todos={LIST} t={t} />)
    expect(screen.getByTestId('todo-panel')).toBeTruthy()
    expect(screen.getByText('任务')).toBeTruthy()
    expect(screen.getByText('1 已完成 · 1 进行中 · 1 待处理')).toBeTruthy()
    expect(screen.getByRole('button', { expanded: false })).toBeTruthy()
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('omits the completed segment while nothing is done yet', () => {
    render(<TodoPanel todos={[
      { content: '写组件', status: 'in_progress' },
      { content: '补测试', status: 'pending' },
    ]} t={t} />)
    expect(screen.getByText('1 进行中 · 1 待处理')).toBeTruthy()
    expect(screen.queryByText(/已完成/)).toBeNull()
  })

  it('expands to show one row per item with its status glyph', () => {
    render(<TodoPanel todos={LIST} t={t} />)
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    /** 中文说明：测试局部值 items，由紧邻初始化决定。 */
    const items = screen.getAllByRole('listitem')
    expect(items.map(li => li.getAttribute('data-status'))).toEqual(['completed', 'in_progress', 'pending'])
    expect(screen.getByText('搭骨架')).toBeTruthy()
    expect(screen.getByText('写组件')).toBeTruthy()
    // Each status row carries an SVG glyph (not a text bullet).
    expect(items.every(li => li.querySelector('svg') !== null)).toBe(true)
  })

  it('collapse hides an expanded list; expand restores; header keeps the count summary', () => {
    render(<TodoPanel todos={LIST} t={t} />)
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    /** 中文说明：测试局部值 header，由紧邻初始化决定。 */
    const header = screen.getByRole('button', { expanded: true })
    fireEvent.click(header)
    expect(screen.queryByRole('list')).toBeNull()
    // Collapsed header is title + progress only (no in-progress content hint).
    expect(screen.getByText('1 已完成 · 1 进行中 · 1 待处理')).toBeTruthy()
    expect(screen.queryByText('写组件')).toBeNull()
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  it('marks every parallel active item, and counts them all in the header', () => {
    render(<TodoPanel todos={PARALLEL} t={t} />)
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    // An unconditional in-progress cap would make this list unreachable: three
    // items carry the in-progress glyph at once, and the header counts all three.
    /** 中文说明：测试局部值 statuses，由紧邻初始化决定。 */
    const statuses = screen.getAllByRole('listitem').map(li => li.getAttribute('data-status'))
    expect(statuses.filter(s => s === 'in_progress')).toHaveLength(3)
    expect(screen.getByText('跑后台构建')).toBeTruthy()
    expect(screen.getByText('读源码')).toBeTruthy()
    expect(screen.getByText('1 已完成 · 3 进行中 · 1 待处理')).toBeTruthy()
  })

  it('an all-completed list collapses the summary to the done count alone', () => {
    render(<TodoPanel todos={[{ content: '都完了', status: 'completed' }]} t={t} />)
    expect(screen.getByRole('button', { expanded: false })).toBeTruthy()
    expect(screen.queryByText('都完了')).toBeNull()
    expect(screen.getByText('1 已完成')).toBeTruthy()
    expect(screen.queryByText(/进行中|待处理/)).toBeNull()
  })
})

/** Dock props stub: the adapter reads the 'todos' projection only; the rest of the owner share is unused. */
/** 中文说明：函数 dockProps 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function dockProps(store: ReturnType<typeof createSnapshotStore<{ value: readonly TodoItem[] | null | undefined }>>): TodoDockProps {
  /** 中文说明：测试局部值 useProjection，由紧邻初始化决定。 */
  const useProjection = (_key: string, selector?: (v: unknown) => unknown) =>
    bindSnapshotSelector(store)(s => (selector ?? (v => v))(s.value))
  return { useProjection, t } as unknown as TodoDockProps
}

describe('TodoDock', () => {
  it('reads the host-computed todos projection and follows pushed updates', () => {
    /** 中文说明：测试局部值 store，由紧邻初始化决定。 */
    const store = createSnapshotStore<{ value: readonly TodoItem[] | null | undefined }>({ value: undefined })
    render(<TodoDock {...dockProps(store)} />)
    // Capability absent (no baseline/frame yet) renders nothing.
    expect(screen.queryByTestId('todo-panel')).toBeNull()
    act(() => { store.set({ value: LIST }) })
    expect(screen.getByText('1 已完成 · 1 进行中 · 1 待处理')).toBeTruthy()
    // The pre-first-write whole value (null) retires the strip (the panel owns no data).
    act(() => { store.set({ value: null }) })
    expect(screen.queryByTestId('todo-panel')).toBeNull()
  })

  it('registers before the goal and queue entries', () => {
    expect(todoDockEntry.name).toBe('conversation-todo-dock')
    expect(todoDockEntry.inject).toEqual(['slots'])
    /** 中文说明：测试局部值 register，由紧邻初始化决定。 */
    const register = vi.fn(() => () => undefined)
    /** 中文说明：测试局部值 inject，由紧邻初始化决定。 */
    const inject = vi.fn((_name: string, callback: () => () => void) => callback())
    todoDockEntry.apply({ slots: { inject, register } } as never)
    expect(inject).toHaveBeenCalledWith('conversation.input.dock', expect.any(Function))
    expect(register).toHaveBeenCalledWith({ name: 'conversation.input.dock', id: 'todo', order: 0, locale: NS }, TodoDock)
  })
})
