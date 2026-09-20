import { afterEach, expect, it, vi } from 'vitest'
import { createQsLayoutStore } from '../src/client/layout-store.ts'

it('retains panel choices when the slot registry creates a replacement instance', () => {
  const handle = createQsLayoutStore()
  const first = handle.create()
  first.actions.setLeftOpen(true)
  first.actions.setRightOpen(false)
  const second = handle.create()
  expect(second.getSnapshot()).toMatchObject({ leftOpen: true, rightOpen: false })
  second.actions.applyViewport({ narrow: false, wide: true })
  expect(second.getSnapshot().rightOpen).toBe(true)
  second.actions.applyViewport({ narrow: false, wide: false })
  expect(second.getSnapshot().rightOpen).toBe(false)
})


afterEach(() => { vi.unstubAllGlobals() })

it('applies a viewport change that occurred while the workbench was unmounted', () => {
  let width = 1200
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: width >= (query.includes('961') ? 961 : 701) }))
  const handle = createQsLayoutStore()
  const first = handle.create()
  first.actions.setRightOpen(false)
  expect(handle.create().getSnapshot().rightOpen).toBe(false)
  width = 600
  expect(handle.create().getSnapshot()).toMatchObject({ compact: true, leftOpen: false, rightOpen: false })
  width = 1200
  expect(handle.create().getSnapshot()).toMatchObject({ compact: false, leftOpen: true, rightOpen: true })
})
