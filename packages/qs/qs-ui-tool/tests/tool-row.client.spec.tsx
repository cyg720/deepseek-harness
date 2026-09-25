// @vitest-environment jsdom
/** 工具行外壳：状态点语义、可展开性与折叠交互。 */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { dotState, QsToolRowChrome } from '../src/client/tool-row.tsx'

afterEach(cleanup)

it('状态点到四种语义的映射', () => {
  expect(dotState('running')).toBe('ongoing')
  expect(dotState('error')).toBe('error')
  expect(dotState('stopped')).toBe('warning')
  expect(dotState('ok')).toBe('done')
})

it('无展开区时不可展开，点击行不会产生内容', () => {
  const view = render(<QsToolRowChrome state="ok" stateLabel="已完成" title="read" />)
  const row = view.container.querySelector('[data-disclosure-row]')!
  expect(row.getAttribute('data-expandable')).toBeNull()
  expect(row.getAttribute('role')).toBeNull()
  fireEvent.click(row)
  expect(view.container.textContent).toBe('read已完成')
})

it('有展开区时可展开收起，摘要与指标在展开后仍然可见', () => {
  const view = render(
    <QsToolRowChrome
      state="error"
      stateLabel="失败"
      title="bash"
      summary="ls -la"
      meta="耗时 1 秒"
      nested
      defaultOpen
      body={<span>body</span>}
    />,
  )
  const row = view.container.querySelector('[data-disclosure-row]')!
  expect(row.getAttribute('role')).toBe('button')
  expect(row.getAttribute('aria-expanded')).toBe('true')
  expect(view.container.textContent).toContain('body')
  expect(view.container.textContent).toContain('ls -la')
  expect(view.container.textContent).toContain('耗时 1 秒')
  expect(view.container.querySelector('[data-state="error"]')).not.toBeNull()
  fireEvent.click(row)
  expect(row.getAttribute('aria-expanded')).toBe('false')
  expect(view.container.textContent).not.toContain('body')
  fireEvent.keyDown(row, { key: 'Enter' })
  expect(row.getAttribute('aria-expanded')).toBe('true')
})
