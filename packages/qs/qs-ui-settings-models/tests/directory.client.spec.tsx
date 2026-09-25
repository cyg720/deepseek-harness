// @vitest-environment jsdom
/** 目录状态不伪造凭据可用，失败可重试，卸载后的读取不能污染新视图。 */
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ModelsSettingsState, ProviderRow } from '@deepseek-ai/dsh-client-ui-settings-models/client'
import { Models } from '../src/client/Models.tsx'
import type { ModelsProps } from '../src/client/contract.ts'
import { zh } from '../src/client/locales.ts'
afterEach(cleanup)
const empty: ModelsSettingsState = { status: 'ready', error: null, credentialError: null, writable: true, rows: [], namespaces: new Map() }
const row: ProviderRow = { entry: { provider: 'fixture', displayName: '<img src=x>', settingsNs: 'fixture', settingsPath: [], active: true },
  configured: true, removable: false, apiKeyEnv: 'KEY', credential: undefined }
function props(state: ModelsSettingsState, reload: () => Promise<void>): ModelsProps {
  return { useSnapshot: (pick: (value: ModelsSettingsState) => unknown) => pick(state), reload,
    t: (key: keyof typeof zh) => zh[key], renderSlot: () => null } as unknown as ModelsProps
}
it('读取错误隐藏原文、允许重试且空态仅在成功后显示', async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error('private-key')).mockResolvedValue(undefined)
  const view = render(<Models {...props(empty, load)} />)
  expect(screen.queryByText(zh.empty)).toBeNull()
  await screen.findByRole('alert')
  expect(view.container.textContent).not.toContain('private-key')
  expect(screen.queryByText(zh.empty)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: zh.retry }))
  await screen.findByText(zh.empty)
  expect(screen.queryByRole('alert')).toBeNull()
  expect(load).toHaveBeenCalledTimes(2)
})
it('逐项区分凭据确认、缺失和未知，并按供应商 namespace 分派子槽', async () => {
  const load = vi.fn(async () => {})
  const slot = vi.fn(() => null)
  const state = { ...empty, rows: [row], writable: false, credentialError: 'private-credential-error' }
  const view = render(<Models {...props(state, load)} renderSlot={slot} />)
  await screen.findByText(zh.keyUnknown)
  expect(screen.getByText(zh.readonly)).toBeTruthy()
  expect(view.container.querySelector('img')).toBeNull()
  expect(view.container.textContent).not.toContain('private-credential-error')
  expect(slot).toHaveBeenCalledWith('qs.settings.models.provider-card', expect.objectContaining({ keyConfigured: false }), { entryKey: 'fixture' })
  const cases: Array<[Partial<ProviderRow>, string]> = [
    [{ credential: { configured: true, writable: false } }, zh.keyReady],
    [{ credential: { configured: false, writable: true } }, zh.keyMissing],
    [{ apiKeyEnv: undefined, derivedCredential: { configured: true, writable: true } }, zh.keyReady],
    [{ apiKeyEnv: undefined }, zh.nativeAuth],
    [{ apiKeyEnv: undefined, derivedCredential: { configured: false, writable: true } }, zh.nativeAuth],
    [{ apiKeyEnv: undefined, entry: { ...row.entry, active: false, error: 'private-provider-error' } }, zh.keyUnknown],
  ]
  for (const [change, label] of cases) {
    view.rerender(<Models {...props({ ...empty, rows: [{ ...row, ...change }] }, load)} />)
    expect(screen.getByText(label)).toBeTruthy()
    expect(view.container.textContent).not.toContain('private-provider-error')
  }
  view.rerender(<Models {...props({ ...empty, status: 'error', rows: [{ ...row, configured: false, entry: { ...row.entry, settingsNs: '' } }] }, load)} />)
  expect(screen.getByText(zh.inherited)).toBeTruthy()
  expect(screen.getByRole('alert')).toBeTruthy()
})
it.each([false, true])('卸载后迟到读取结果不进入新实例，拒绝=%s', async (reject) => {
  const late = Promise.withResolvers<undefined>()
  const first = render(<Models {...props(empty, () => late.promise)} />)
  first.unmount()
  render(<Models {...props(empty, async () => {})} />)
  await screen.findByText(zh.empty)
  await act(async () => { if (reject) late.reject(new Error('old-error')); else late.resolve(undefined); await Promise.resolve() })
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getByText(zh.empty)).toBeTruthy()
})
