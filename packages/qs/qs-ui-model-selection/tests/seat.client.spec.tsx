// @vitest-environment jsdom
/** 原型选择器提交精确模型与推理强度，不把供应商文本作为 HTML。 */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ModelSeat, type ModelSeatProps } from '../src/client/ModelSeat.tsx'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import { zh } from '../src/client/locales.ts'
afterEach(cleanup)
it('读取、提交、强度、错误与部分目录提示均来自当前状态，子会话不暴露操作', () => {
  let state: ModelDirectoryState = { current: null, routable: null, groups: [], failures: [], status: 'loading', error: null }
  const load = vi.fn(), select = vi.fn(async () => true)
  const props = { available: true, locked: false, load, select, t: (key: keyof typeof zh) => zh[key],
    useDirectory: (pick: (value: ModelDirectoryState) => unknown) => pick(state),
  } as unknown as ModelSeatProps
  const view = render(<ModelSeat {...props} />)
  expect(load).toHaveBeenCalledOnce()
  expect(screen.getByRole<HTMLSelectElement>('combobox').disabled).toBe(true)
  state = { ...state, status: 'ready' }; view.rerender(<ModelSeat {...props} />)
  expect(screen.getByRole('option').textContent).toBe(zh.choose)
  state = { ...state, current: { provider: 'p', model: 'one' }, status: 'ready', groups: [{ id: 'p', name: 'Provider', models: [
    { id: 'one', name: '<img>', reasoning: { efforts: [{ id: 'off', name: 'Off' }, { id: 'high', name: 'High' }] } },
    { id: 'two', name: 'Second' },
  ] }] }
  view.rerender(<ModelSeat {...props} />)
  expect(view.container.querySelector('img')).toBeNull()
  const invalid = document.createElement('option'); invalid.value = 'unsupported'
  screen.getByLabelText(zh.effort).append(invalid)
  fireEvent.change(screen.getByLabelText(zh.effort), { target: { value: 'unsupported' } })
  expect(select).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText(zh.model), { target: { value: 'missing' } })
  expect(select).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText(zh.effort), { target: { value: 'high' } })
  expect(select).toHaveBeenLastCalledWith({ provider: 'p', model: 'one', reasoningEffort: 'high' })
  fireEvent.change(screen.getByLabelText(zh.effort), { target: { value: '' } })
  expect(select).toHaveBeenLastCalledWith({ provider: 'p', model: 'one' })
  fireEvent.change(screen.getByLabelText(zh.model), { target: { value: JSON.stringify(['p', 'two']) } })
  expect(select).toHaveBeenLastCalledWith({ provider: 'p', model: 'two' })
  state = { ...state, status: 'error', error: 'private exception', failures: [{ provider: 'bad', error: 'private' }] as never }
  view.rerender(<ModelSeat {...props} />)
  expect(screen.getByRole('alert').textContent).toContain(zh.failed)
  expect(screen.getByRole('status').textContent).toBe(zh.partial)
  expect(view.container.textContent).not.toContain('private')
  fireEvent.click(screen.getByRole('button', { name: zh.retry })); expect(load).toHaveBeenCalledTimes(2)
  view.rerender(<ModelSeat {...props} locked />)
  expect(screen.getByLabelText<HTMLSelectElement>(zh.model).disabled).toBe(true)
  view.rerender(<ModelSeat {...props} available={false} />)
  expect(screen.queryByRole('combobox')).toBeNull()
})
