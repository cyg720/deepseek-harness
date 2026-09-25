// @vitest-environment jsdom
/** 引导只写凭据，成功判定跟随目录，旧实例回执不能驱动新实例。 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ModelsSettingsState } from '@deepseek-ai/dsh-client-ui-settings-models/client'
import { CredentialOnboarding } from '../src/client/CredentialOnboarding.tsx'
import { credentialStep } from '../src/client/onboarding-state.ts'
import type { CredentialOnboardingProps } from '../src/client/contract.ts'
import { zh } from '../src/client/locales.ts'
const original = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal')
beforeEach(() => { Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
  configurable: true, value(this: HTMLDialogElement) { this.open = true },
}) })
afterEach(() => {
  cleanup()
  if (original === undefined) Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
  else Object.defineProperty(HTMLDialogElement.prototype, 'showModal', original)
})
function fixture() {
  const state: ModelsSettingsState = { status: 'ready', error: null, credentialError: null, writable: true,
    namespaces: new Map(), rows: [{ entry: { provider: 'deepseek-official', displayName: 'DeepSeek',
      settingsNs: 'llm-deepseek', settingsPath: [], active: true }, configured: true, removable: false,
    apiKeyEnv: 'CUSTOM_KEY', credential: { configured: false, writable: true } }] }
  const storeCredential = vi.fn<(ref: string, value: string) => Promise<string | undefined>>().mockResolvedValue(undefined)
  const reload = vi.fn(async () => {}), complete = vi.fn()
  const props = { useSnapshot: (select: (value: ModelsSettingsState) => unknown) => select(state),
    operations: { storeCredential }, reload, complete, t: (key: keyof typeof zh) => zh[key],
  } as unknown as CredentialOnboardingProps
  return { state, props, storeCredential, reload, complete }
}
function save() { fireEvent.click(screen.getByRole('button', { name: zh.onboardingSave })) }
it('保存准确引用和裁剪后密钥，目录确认之前不完成', async () => {
  const f = fixture(), node = render(<CredentialOnboarding {...f.props} />)
  expect(screen.queryByLabelText(zh.endpoint)).toBeNull()
  expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.onboardingSave }).disabled).toBe(true)
  fireEvent.change(screen.getByLabelText(zh.apiKey), { target: { value: '  fixture-key  ' } }); save()
  await waitFor(() => { expect(f.reload).toHaveBeenCalledOnce() })
  expect(f.storeCredential).toHaveBeenCalledExactlyOnceWith('CUSTOM_KEY', 'fixture-key')
  expect(f.complete).not.toHaveBeenCalled()
  f.state.rows[0]!.credential!.configured = true
  node.rerender(<CredentialOnboarding {...f.props} />)
  expect(f.complete).toHaveBeenCalledOnce(); expect(screen.queryByRole('dialog')).toBeNull()
  node.rerender(<CredentialOnboarding {...f.props} />); expect(f.complete).toHaveBeenCalledOnce()
})
it.each(['refused', 'transport'])('凭据 %s 保留草稿，隐藏原始错误并允许重试', async (kind) => {
  const f = fixture()
  if (kind === 'refused') f.storeCredential.mockResolvedValueOnce('private failure')
  else f.storeCredential.mockRejectedValueOnce(new Error('private failure'))
  render(<CredentialOnboarding {...f.props} />)
  fireEvent.change(screen.getByLabelText(zh.apiKey), { target: { value: 'fixture-key' } }); save()
  await screen.findByText(zh.credentialFailed)
  expect(screen.queryByText('private failure')).toBeNull(); expect(f.reload).not.toHaveBeenCalled()
  expect(screen.getByLabelText<HTMLInputElement>(zh.apiKey).value).toBe('fixture-key')
  save(); await waitFor(() => { expect(f.reload).toHaveBeenCalledOnce() })
})
it('卸载后凭据回执不能重载或完成新实例，重复提交只发一次', async () => {
  const f = fixture(), gate = Promise.withResolvers<string | undefined>()
  f.storeCredential.mockReturnValueOnce(gate.promise)
  const node = render(<CredentialOnboarding {...f.props} />)
  fireEvent.change(screen.getByLabelText(zh.apiKey), { target: { value: 'fixture-key' } })
  const form = screen.getByLabelText(zh.apiKey).closest('form')!
  fireEvent.submit(form); fireEvent.submit(form)
  expect(f.storeCredential).toHaveBeenCalledOnce(); node.unmount()
  await act(async () => { gate.resolve(undefined); await gate.promise })
  expect(f.reload).not.toHaveBeenCalled(); expect(f.complete).not.toHaveBeenCalled()
})
it('稍后配置明确完成当前步骤，非法密钥不写入', () => {
  const f = fixture(); render(<CredentialOnboarding {...f.props} />)
  fireEvent.change(screen.getByLabelText(zh.apiKey), { target: { value: 'KEY=secret' } })
  expect(screen.getByText(zh.invalidKey)).toBeTruthy()
  fireEvent.submit(screen.getByLabelText(zh.apiKey).closest('form')!)
  expect(f.storeCredential).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: zh.onboardingLater }))
  expect(f.complete).toHaveBeenCalledOnce()
})
it('加载拒绝可重试，迟到的加载拒绝不更新卸载后的视图', async () => {
  const f = fixture(); f.state.status = 'idle'; f.state.rows = []
  f.reload.mockRejectedValueOnce(new Error('private failure'))
  const node = render(<CredentialOnboarding {...f.props} />)
  await screen.findByText(zh.onboardingReloadFailed)
  const gate = Promise.withResolvers<undefined>(); f.reload.mockReturnValueOnce(gate.promise)
  fireEvent.click(screen.getByRole('button', { name: zh.retry })); node.unmount()
  await act(async () => { gate.reject(new Error('private late')); await Promise.allSettled([gate.promise]) })
  expect(f.complete).not.toHaveBeenCalled()
})
it('就绪判定匹配官方：任意可用路线跳过，不可写或不可用时不强迫输入', () => {
  const f = fixture(), row = f.state.rows[0]!
  expect(credentialStep(f.state)).toBe(row)
  for (const status of ['idle', 'loading'] as const) expect(credentialStep({ ...f.state, status, rows: [] })).toBe('loading')
  expect(credentialStep({ ...f.state, status: 'error' })).toBe('skip')
  expect(credentialStep({ ...f.state, rows: [] })).toBe('skip')
  expect(credentialStep({ ...f.state, writable: false })).toBe('skip')
  expect(credentialStep({ ...f.state, credentialError: 'failure' })).toBe('skip')
  expect(credentialStep({ ...f.state, rows: [{ ...row, credential: undefined }] })).toBe('skip')
  expect(credentialStep({ ...f.state, rows: [{ ...row, credential: { configured: false, writable: false } }] })).toBe('skip')
  expect(credentialStep({ ...f.state, rows: [{ ...row, entry: { ...row.entry, active: false } }] })).toBe('skip')
  expect(credentialStep({ ...f.state, rows: [{ ...row, apiKeyEnv: undefined }] })).toBe('skip')
  expect(credentialStep({ ...f.state, rows: [{ ...row, credential: { configured: true, writable: true } }] })).toBe('skip')
})

it('读取在途时忽略重复加载，Escape 等待请求结束后才允许稍后配置', async () => {
  const f = fixture(), gate = Promise.withResolvers<undefined>()
  f.state.status = 'idle'; f.reload.mockReturnValueOnce(gate.promise)
  const node = render(<CredentialOnboarding {...f.props} />)
  const duplicate = vi.fn(async () => {})
  node.rerender(<CredentialOnboarding {...f.props} reload={duplicate} />)
  expect(duplicate).not.toHaveBeenCalled()
  const event = new Event('cancel', { cancelable: true }); fireEvent(screen.getByRole('dialog'), event)
  expect(event.defaultPrevented).toBe(true); expect(f.complete).not.toHaveBeenCalled()
  await act(async () => { gate.resolve(undefined); await gate.promise })
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))
  expect(f.complete).toHaveBeenCalledOnce()
})
