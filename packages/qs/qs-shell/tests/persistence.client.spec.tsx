// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createQsLayoutStore, LAYOUT_STORE_KEY } from '../src/client/layout-store.ts'
import { PanelResize } from '../src/client/PanelResize.tsx'

afterEach(() => { cleanup(); localStorage.removeItem(LAYOUT_STORE_KEY); vi.unstubAllGlobals() })

it('restores desktop panel preferences after reload and clears them on logout', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  const first = createQsLayoutStore().create()
  first.actions.setLeftOpen(false)
  first.actions.setWidth('right', 390)
  first.actions.setRightTab(2)
  const next = createQsLayoutStore().create()
  expect(next.getSnapshot()).toMatchObject({ leftOpen: false, rightWidth: 390, activeRightTab: 2 })
  next.actions.reset()
  expect(localStorage.getItem(LAYOUT_STORE_KEY)).toBeNull()
  expect(createQsLayoutStore().create().getSnapshot()).toMatchObject({ leftOpen: true, activeRightTab: 0 })
})

it('ignores corrupt persisted dimensions and clamps live resizing', () => {
  localStorage.setItem(LAYOUT_STORE_KEY, JSON.stringify({ leftWidth: 'wide', rightWidth: 1e9, activeRightTab: 99 }))
  const instance = createQsLayoutStore().create()
  expect(instance.getSnapshot()).toMatchObject({ leftWidth: undefined, rightWidth: undefined, activeRightTab: 0 })
  instance.actions.setWidth('left', 10000)
  expect(instance.getSnapshot().leftWidth).toBe(480)
})

it('resizes a rendered panel with arrow keys', () => {
  const resize = vi.fn()
  render(<><aside /><PanelResize side="left" label="Resize" onResize={resize} /></>)
  const handle = screen.getByRole('separator')
  vi.spyOn(handle.previousElementSibling!, 'getBoundingClientRect').mockReturnValue({ width: 240 } as DOMRect)
  fireEvent.keyDown(handle, { key: 'ArrowRight' })
  expect(resize).toHaveBeenCalledWith('left', 250)
})
