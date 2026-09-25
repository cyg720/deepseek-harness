// @vitest-environment jsdom
/** 默认权限的危险选择必须勾选后再提交，取消和版本变化不发送。 */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DefaultRow, type DefaultProps } from '../src/client/DefaultRow.tsx'
import type { DefaultState } from '../src/client/defaults.ts'
import { zh } from '../src/client/locales.ts'
afterEach(cleanup)
it('显示默认权限、明确确认、可取消，并在版本变化后撤销旧确认', () => {
  let state: DefaultState = { status: 'ready', writable: true, current: 'read-only', revision: 2, epoch: 0, saving: false, outcome: 'none', options: [
    { value: 'read-only', name: 'Read Only' }, { value: 'workspace-write', name: 'workspace-write' }, { value: 'danger-full-access', name: 'Full access' },
    { value: 'organization', name: '组织策略' }, { value: 'read-custom', name: 'read-custom' },
  ] }
  const actions = { load: vi.fn(async () => {}), select: vi.fn(async () => {}) }
  const props = {
    actions, t: (key: keyof typeof zh) => zh[key], useDefaults: (select: (value: DefaultState) => unknown) => select(state),
  } as unknown as DefaultProps
  const view = render(<DefaultRow {...props} />)
  const select = screen.getByRole<HTMLSelectElement>('combobox', { name: zh.defaults })
  expect(actions.load).toHaveBeenCalledOnce()
  expect(screen.getByRole('option', { name: '组织策略' })).toBeTruthy()
  fireEvent.change(select, { target: { value: 'workspace-write' } })
  expect(actions.select).toHaveBeenLastCalledWith('workspace-write', 2, false, 0)
  actions.select.mockClear()
  fireEvent.change(select, { target: { value: 'danger-full-access' } })
  expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.confirm }).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: zh.cancel }))
  expect(actions.select).not.toHaveBeenCalled()
  fireEvent.change(select, { target: { value: 'danger-full-access' } })
  fireEvent.click(screen.getByRole('checkbox', { name: zh.acknowledge }))
  fireEvent.click(screen.getByRole('button', { name: zh.confirm }))
  expect(actions.select).toHaveBeenLastCalledWith('danger-full-access', 2, true, 0)
  fireEvent.change(select, { target: { value: 'danger-full-access' } })
  state = { ...state, revision: 3 }; view.rerender(<DefaultRow {...props} />)
  expect(screen.queryByRole('group', { name: zh.riskTitle })).toBeNull()
  fireEvent.change(select, { target: { value: 'danger-full-access' } })
  state = { ...state, epoch: 1 }; view.rerender(<DefaultRow {...props} />)
  expect(screen.queryByRole('group')).toBeNull()
  fireEvent.change(select, { target: { value: 'danger-full-access' } })
  state = { ...state, writable: false }; view.rerender(<DefaultRow {...props} />)
  expect(select.disabled).toBe(true); expect(screen.getByText(zh.readOnlyHint)).toBeTruthy()
  expect(screen.queryByRole('group')).toBeNull()
  for (const outcome of ['written', 'conflict', 'refused'] as const) {
    state = { ...state, outcome, saving: true }; view.rerender(<DefaultRow {...props} />)
    expect(screen.getByText(zh.saving)).toBeTruthy()
    expect(screen.getByText(zh[outcome === 'written' ? 'saved' : outcome === 'conflict' ? 'conflict' : 'saveFailed'])).toBeTruthy()
  }
  for (const status of ['loading', 'unavailable', 'error'] as const) {
    state = { ...state, status, saving: false, outcome: 'none' }; view.rerender(<DefaultRow {...props} />)
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.getByRole('status').textContent).toBe(zh[status === 'loading' ? 'loading' : status === 'unavailable' ? 'defaultsUnavailable' : 'readError'])
  }
  fireEvent.click(screen.getByRole('button', { name: zh.retry })); expect(actions.load).toHaveBeenCalledTimes(2)
})
