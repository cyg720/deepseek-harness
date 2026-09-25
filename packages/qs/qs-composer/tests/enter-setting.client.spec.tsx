// @vitest-environment jsdom
/** 设置行透传共享状态与选择动作，不持有第二份偏好。 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { EnterBehaviorRow, type EnterBehaviorProps } from '../src/client/EnterBehaviorRow.tsx'
import { zh, en } from '../src/client/locales.ts'
afterEach(cleanup)
it.each([zh, en])('设置行读取外部偏好并提交两种选择 %#', (dictionary) => {
  let value: 'queue' | 'steer' = 'queue'
  const setBusyEnter = vi.fn()
  const props = {
    useBusyEnter: (select: (current: typeof value) => unknown) => select(value),
    setBusyEnter, t: (key: keyof typeof dictionary) => dictionary[key],
  } as EnterBehaviorProps
  const view = render(<EnterBehaviorRow {...props} />)
  const select = screen.getByRole<HTMLSelectElement>('combobox', { name: dictionary['settings.enter.title'] })
  expect(select.value).toBe('queue')
  fireEvent.change(select, { target: { value: 'steer' } })
  expect(setBusyEnter).toHaveBeenLastCalledWith('steer')
  // 共享状态改变后刷新；控件不会在外部确认之前私自保留选择。
  value = 'steer'
  view.rerender(<EnterBehaviorRow {...props} />)
  expect(select.value).toBe('steer')
  fireEvent.change(select, { target: { value: 'queue' } })
  expect(setBusyEnter.mock.calls).toEqual([['steer'], ['queue']])
})
