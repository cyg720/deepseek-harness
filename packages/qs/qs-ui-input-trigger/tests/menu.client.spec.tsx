// @vitest-environment jsdom
/** 候选视图使用可控快照，卸载后不残留输入桥和点击监听。 */
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { MenuState } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { CommandMenu, type CommandMenuProps } from '../src/client/CommandMenu.tsx'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
it('候选选择交给官方控制器，关闭和卸载解除视图绑定', () => {
  const menu = createSnapshotStore<MenuState>({ open: false, hit: null, generation: 0, groups: [], highlight: null })
  const state = createSnapshotStore({ draft: '/', draftRev: 1, phase: 'plain' })
  const track = vi.fn(), pick = vi.fn(), hover = vi.fn(), dismiss = vi.fn(), release = vi.fn()
  const inputElement: { current: HTMLTextAreaElement | null } = { current: document.createElement('textarea') }
  const props = { controller: { menu, track, pick, hover, dismiss }, input: { state }, inputElement,
    composing: { current: false }, frozen: false, bindCommandInput: vi.fn(() => release), acquireFreeze: vi.fn(), t: (key: string) => key,
  } as unknown as CommandMenuProps
  const view = render(<CommandMenu {...props} />)
  expect(view.queryByRole('listbox')).toBeNull()
  expect(track).toHaveBeenCalledWith('/', 0, { tier: 'plain' }, 1)
  act(() => { menu.set({ ...menu.getSnapshot(), open: true, groups: [{ source: 'command', status: 'pending', items: [] }] }) })
  expect(view.getByRole('status').textContent).toBe('loading')
  act(() => { menu.set({ ...menu.getSnapshot(), groups: [{ source: 'command', status: 'ready',
    items: [{ name: 'goal', label: 'Set goal', description: 'Goal description' }, { name: 'help' }] }] }) })
  const scroll = vi.fn()
  view.container.append(inputElement.current!)
  const option = view.getByRole('option', { name: /Set goal/ })
  Object.defineProperty(option, 'scrollIntoView', { configurable: true, value: scroll })
  act(() => { menu.set({ ...menu.getSnapshot(), highlight: { source: 'command', index: 0 } }) })
  expect(scroll).toHaveBeenCalledWith({ block: 'nearest' })
  fireEvent.mouseMove(option)
  expect(hover).toHaveBeenCalledWith('command', 0)
  fireEvent.mouseDown(option)
  fireEvent.click(option)
  expect(pick).toHaveBeenCalledWith('command', 0)
  fireEvent.pointerDown(inputElement.current!)
  expect(dismiss).not.toHaveBeenCalled()
  fireEvent.pointerDown(document.body)
  expect(dismiss).toHaveBeenCalledOnce()
  fireEvent.click(view.getByRole('button', { name: 'close' }))
  expect(dismiss).toHaveBeenCalledTimes(2)
  inputElement.current = null
  view.rerender(<CommandMenu {...props} frozen />)
  expect(track).toHaveBeenLastCalledWith('/', 0, { tier: 'frozen' }, 1)
  view.unmount()
  expect(release).toHaveBeenCalledOnce()
  expect(dismiss).toHaveBeenCalledTimes(3)
  fireEvent.pointerDown(document.body)
  expect(dismiss).toHaveBeenCalledTimes(3)
})
