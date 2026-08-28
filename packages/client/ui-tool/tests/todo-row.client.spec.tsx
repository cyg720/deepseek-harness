// @vitest-environment jsdom
/*
 * 文件职责：验证工具调用的 todo-row.client.spec.tsx 行为。
 * 技术维度：Vitest、React 渲染、插槽替身和类型化工具数据。
 * 产品维度：防止工具调用展示与展开交互回归。
 * 逻辑维度：构造工具调用或轨迹数据，渲染后断言 DOM 与状态。
 * 关键边界：测试只验证展示，不执行真实工具；DOM 和替身必须清理。
 * 新手阅读建议：先读数据夹具，再按工具类型和状态阅读。
 */
/** todo_write atomic Tool presentation and its plan-summary model. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TodoItem } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { TodoRow, todoToolview } from '../src/client/tool/toolviews/todo-row.tsx'
import { planSummary } from '../src/client/tool/toolviews/plan-summary.ts'
import { CONVERSATION_NS as NS } from '../src/client/locale.ts'
import { zh } from '@deepseek-ai/dsh-client-ui-conversation/src/client/locales.ts'

/** 中文说明：类型或类 TodoRowProps 约束工具或轨迹数据职责。 */
type TodoRowProps = Parameters<typeof TodoRow>[0]

/** 中文说明：测试局部值 t，由紧邻初始化决定。 */
const t: TodoRowProps['t'] = makeTranslate(zh, commonZh)

afterEach(cleanup)

/** 中文说明：测试局部值 LIST，由紧邻初始化决定。 */
const LIST: TodoItem[] = [
  { content: '搭骨架', status: 'completed' },
  { content: '写组件', status: 'in_progress' },
  { content: '补测试', status: 'pending' },
]

/** 中文说明：测试局部值 PARALLEL，由紧邻初始化决定。 */
const PARALLEL: TodoItem[] = [
  { content: '搭骨架', status: 'completed' },
  { content: '写组件', status: 'in_progress' },
  { content: '跑后台构建', status: 'in_progress' },
  { content: '读源码', status: 'in_progress' },
  { content: '补测试', status: 'pending' },
]

describe('planSummary', () => {
  it('counts done/total and names the single active item with no extra count', () => {
    expect(planSummary(LIST)).toEqual({ done: 1, total: 3, activeContent: '写组件', activeExtra: 0 })
  })

  it('reports the extra active count separately when several items are in progress', () => {
    expect(planSummary(PARALLEL)).toEqual({ done: 1, total: 5, activeContent: '写组件', activeExtra: 2 })
  })

  it('has no hint when nothing is in progress', () => {
    expect(planSummary([{ content: '都完了', status: 'completed' }]))
      .toEqual({ done: 1, total: 1, activeContent: null, activeExtra: 0 })
  })

  it('has no hint when the first active item carries no usable content', () => {
    expect(planSummary([{ status: 'in_progress' }, { content: 'x', status: 'in_progress' }]))
      .toMatchObject({ activeContent: null, activeExtra: 0 })
    expect(planSummary([{ content: 42, status: 'in_progress' }]).activeContent).toBeNull()
    expect(planSummary([{ content: '', status: 'in_progress' }]).activeContent).toBeNull()
    expect(planSummary([{ content: '   ', status: 'in_progress' }, { content: 'x', status: 'in_progress' }]))
      .toMatchObject({ activeContent: null, activeExtra: 0 })
  })

  it('is empty-safe', () => {
    expect(planSummary([])).toEqual({ done: 0, total: 0, activeContent: null, activeExtra: 0 })
  })
})

/** 中文说明：测试局部值 resultNode，由紧邻初始化决定。 */
const resultNode = (argsRaw: string, over?: Partial<ToolResultNode>): ToolResultNode => ({
  kind: 'tool-result', seq: 10, time: 2_000, callTime: 1_000, callId: 'c1',
  call: { name: 'todo_write', argsRaw },
  content: [], isError: false, subCalls: [], ...over,
})

/** 中文说明：函数 rowProps 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function rowProps(block: unknown): TodoRowProps {
  return {
    callId: 'c1', toolName: 'todo_write', block,
    openFile: vi.fn(),
    sessionId: 's1',
    useSessions: () => undefined,
    t,
  } as unknown as TodoRowProps
}

describe('TodoRow', () => {
  /** 中文说明：测试局部值 ARGS，由紧邻初始化决定。 */
  const ARGS = JSON.stringify({ todos: LIST })

  it('summarizes counts and the active item from the call args', () => {
    render(<TodoRow {...rowProps(resultNode(ARGS))} />)
    expect(screen.getByText('更新任务清单')).toBeTruthy()
    expect(screen.getByText('1/3 已完成 · 写组件')).toBeTruthy()
  })

  it('reports the extra active count outside the ellipsized summary text', () => {
    /** 中文说明：测试局部值 { container }，由紧邻初始化决定。 */
    const { container } = render(<TodoRow {...rowProps(resultNode(JSON.stringify({ todos: PARALLEL })))} />)
    /** 中文说明：测试局部值 text，由紧邻初始化决定。 */
    const text = screen.getByText('1/5 已完成 · 写组件')
    /** 中文说明：测试局部值 extra，由紧邻初始化决定。 */
    const extra = screen.getByText('+2')
    expect(text.contains(extra)).toBe(false)
    expect(container.textContent).toContain('1/5 已完成 · 写组件+2')
  })

  it('omits the active clause when no item is in progress and reads running-call args', () => {
    /** 中文说明：测试局部值 args，由紧邻初始化决定。 */
    const args = JSON.stringify({ todos: [{ content: 'x', status: 'completed' }] })
    render(<TodoRow {...rowProps({ callId: 'c1', name: 'todo_write', argsRaw: args, turn: 1, step: 1, time: 1_000, subCalls: [] })} />)
    expect(screen.getByText('1/1 已完成')).toBeTruthy()
  })

  it('keeps the counts when an active item has unusable content', () => {
    /** 中文说明：测试局部值 args，由紧邻初始化决定。 */
    const args = JSON.stringify({ todos: [{ content: 'done', status: 'completed' }, { content: 42, status: 'in_progress' }] })
    /** 中文说明：测试局部值 { container }，由紧邻初始化决定。 */
    const { container } = render(<TodoRow {...rowProps(resultNode(args))} />)
    expect(screen.getByText('1/2 已完成')).toBeTruthy()
    expect(container.textContent).not.toContain('+')
  })

  it('keeps non-ok execution states visible through the shared row states', () => {
    /** 中文说明：测试局部值 args，由紧邻初始化决定。 */
    const args = JSON.stringify({ todos: LIST })
    const running = render(<TodoRow {...rowProps({ callId: 'c1', name: 'todo_write', argsRaw: args, turn: 1, step: 1, time: 1_000, subCalls: [] })} />)
    expect(running.container.querySelector('[data-state="running"]')).not.toBeNull()
    expect(running.container.querySelector('[data-state="running"] svg')).not.toBeNull()
    running.unmount()
    /** 中文说明：测试局部值 stopped，由紧邻初始化决定。 */
    const stopped = render(<TodoRow {...rowProps(resultNode(args, { isError: true, error: { name: 'Interrupted', code: 'interrupted' } }))} />)
    expect(stopped.container.querySelector('[data-state="stopped"]')).not.toBeNull()
  })

  it('falls back to the generic summary on malformed args and marks the error state', () => {
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<TodoRow {...rowProps(resultNode('not json', { isError: true }))} />)
    expect(view.container.querySelector('[data-state="error"]')).not.toBeNull()
    expect(screen.getByText('todo_write · not json')).toBeTruthy()
  })

  it('falls back when parsed args carry no todos array', () => {
    render(<TodoRow {...rowProps(resultNode('{"other":1}'))} />)
    expect(screen.getByText('todo_write · {"other":1}')).toBeTruthy()
  })

  it('leading toggle expands the raw args body', () => {
    render(<TodoRow {...rowProps(resultNode(ARGS))} />)
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByRole('button', { expanded: true })).toBeTruthy()
    expect(screen.getByText(/搭骨架/)).toBeTruthy()
  })

  it.each([
    { label: 'null root', argsRaw: 'null' },
    { label: 'non-object root', argsRaw: '42' },
    { label: 'null items', argsRaw: '{"todos":[null]}' },
  ])('falls back to the generic summary on valid JSON with an invalid shape ($label)', ({ argsRaw }) => {
    render(<TodoRow {...rowProps(resultNode(argsRaw))} />)
    expect(screen.getByText(`todo_write · ${argsRaw}`)).toBeTruthy()
  })

  it('window-truncated result falls back to the callId summary', () => {
    render(<TodoRow {...rowProps(resultNode('', { call: null }))} />)
    expect(screen.getByText('todo_write · c1')).toBeTruthy()
  })

  it('injects the keyed toolview declaration directly', () => {
    expect(todoToolview.name).toBe('todo-toolview')
    expect(todoToolview.inject).toEqual(['slots'])
    /** 中文说明：测试局部值 register，由紧邻初始化决定。 */
    const register = vi.fn(() => () => undefined)
    /** 中文说明：测试局部值 inject，由紧邻初始化决定。 */
    const inject = vi.fn((_name: string, callback: () => () => void) => callback())
    todoToolview.apply({ slots: { inject, register } } as never)
    expect(inject).toHaveBeenCalledWith('tool.call.toolview', expect.any(Function))
    expect(register).toHaveBeenCalledWith({ name: 'tool.call.toolview', key: 'todo_write', locale: NS }, TodoRow)
  })
})
