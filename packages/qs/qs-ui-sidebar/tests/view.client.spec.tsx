// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QsSideNav } from '../src/client/SideNav.tsx'
import { zh } from '../src/client/view-locales.ts'

const dialogMethods = ['showModal', 'close'] as const
const originals = dialogMethods.map(key => Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, key))
afterEach(() => {
  cleanup()
  for (const [index, key] of dialogMethods.entries()) {
    const descriptor = originals[index]
    if (descriptor === undefined) Reflect.deleteProperty(HTMLDialogElement.prototype, key)
    else Object.defineProperty(HTMLDialogElement.prototype, key, descriptor)
  }
  vi.restoreAllMocks()
})
it('keeps the workspace slot and profile visible and labels placeholder dialogs', () => {
  const show = vi.fn()
  const close = vi.fn()
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: show })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: close })
  const { rerender, container } = render(<QsSideNav t={key => (zh as Readonly<Record<string, string>>)[key] ?? key} hidden={false} user="admin" renderSlot={name => name === 'qs.nav' ? <span>Workspace sessions</span> : <span>Settings entry</span>} />)
  expect(screen.getByText('Workspace sessions')).toBeTruthy()
  expect(screen.getByText('admin')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: zh['nav.skills'] }))
  expect(show).toHaveBeenCalledOnce()
  expect(container.querySelector('dialog')?.getAttribute('aria-label')).toBe(zh['nav.skills'])
  fireEvent.click(screen.getByText(zh['nav.back']))
  expect(close).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: zh['nav.apps'] }))
  const explanation = container.querySelector('[data-qs-integrations-deferred]')!
  expect(explanation.textContent).toContain(zh['integrations.deferred'])
  expect(explanation.textContent).toContain(zh['integrations.scope'])
  expect(explanation.querySelectorAll('input, button, a')).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: zh['nav.skills'] }))
  expect(container.querySelector('[data-qs-integrations-deferred]')).toBeNull()
  rerender(<QsSideNav t={key => (zh as Readonly<Record<string, string>>)[key] ?? key} hidden user={undefined} renderSlot={() => null} />)
  expect(container.querySelector('aside')?.hasAttribute('inert')).toBe(true)
})
