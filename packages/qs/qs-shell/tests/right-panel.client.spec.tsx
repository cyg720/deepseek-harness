// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { createQsLayoutStore } from '../src/client/layout-store.ts'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { QsRightPanel, type QsRightPanelProps } from '../src/client/RightPanel.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

it('switches all three empty panels by keyboard', () => {
  const store = createQsLayoutStore().create()
  const subscribe = (listener: () => void) => store.subscribe(listener)
  const read = () => store.getSnapshot()
  const props = {
    t: (key: keyof typeof zh) => zh[key], actions: store.actions,
    useStore: (select: (s: ReturnType<typeof read>) => unknown) => select(useSyncExternalStore(subscribe, read)),
  } as unknown as QsRightPanelProps
  render(<QsRightPanel {...props} />)
  const tabs = screen.getAllByRole('tab')
  expect(tabs).toHaveLength(3)
  fireEvent.keyDown(tabs[0]!, { key: 'ArrowRight' })
  expect(tabs[1]?.getAttribute('aria-selected')).toBe('true')
  expect(document.activeElement).toBe(tabs[1])
  expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(tabs[1]?.id)
})
