// @vitest-environment jsdom
/** 删除载荷、显式密钥选择与两阶段失败均通过用户操作观察。 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ModelsOperations } from '@deepseek-ai/dsh-client-ui-settings-models/client'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import { ProviderRemoval, type ProviderRemovalProps } from '../src/client/ProviderRemoval.tsx'
import { Models } from '../src/client/Models.tsx'
import type { ModelsProps } from '../src/client/contract.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
function fixture() {
  const namespace: SettingsNamespaceView = { ns: 'llm-pi-ai', schema: {}, value: {}, user: {}, revision: 2, applies: 'live', secrets: [] }
  const writeSettings = vi.fn<ModelsOperations['writeSettings']>().mockResolvedValue({ kind: 'written', view: namespace })
  const removeCredential = vi.fn<ModelsOperations['removeCredential']>().mockResolvedValue(undefined)
  const operations: ModelsOperations = { writeSettings, removeCredential,
    describeCredential: vi.fn(), storeCredential: vi.fn(), discoverModels: vi.fn() }
  const row = { entry: { provider: 'fixture', displayName: 'Fixture', settingsNs: namespace.ns, settingsPath: ['providers', 'fixture'], active: true },
    configured: true, removable: true, apiKeyEnv: 'FIXTURE_API_KEY', credential: { configured: true, writable: true } }
  const onClose = vi.fn()
  const props: ProviderRemovalProps = { row, rows: [row], namespace, operations, onClose, readOnly: false, t: key => zh[key] }
  return { props, writeSettings, removeCredential, onClose }
}
function confirm() { fireEvent.click(screen.getByRole('button', { name: zh.confirmRemove })) }
function chooseKey() { fireEvent.click(screen.getByRole('checkbox')) }

it('默认保留密钥，确认才按版本移除指定用户配置路径', async () => {
  const f = fixture(); render(<ProviderRemoval {...f.props} />)
  expect(screen.getByText('Fixture')).toBeTruthy(); expect(f.writeSettings).not.toHaveBeenCalled()
  confirm(); await waitFor(() => { expect(f.onClose).toHaveBeenCalledWith(true) })
  expect(f.writeSettings).toHaveBeenCalledExactlyOnceWith('llm-pi-ai', [{ op: 'unset', path: ['providers', 'fixture'] }], 2)
  expect(f.removeCredential).not.toHaveBeenCalled()
})

it.each(['refused', 'transport'] as const)('密钥删除 %s 时不触发配置删除，重试可恢复', async (failure) => {
  const f = fixture()
  if (failure === 'refused') f.removeCredential.mockResolvedValueOnce('private error')
  else f.removeCredential.mockRejectedValueOnce(new Error('private error'))
  const node = render(<ProviderRemoval {...f.props} />); chooseKey(); confirm()
  await screen.findByText(zh.removeKeyFailed)
  expect(node.container.textContent).not.toContain('private error'); expect(f.writeSettings).not.toHaveBeenCalled()
  confirm(); await waitFor(() => { expect(f.onClose).toHaveBeenCalledWith(true) })
  expect(f.removeCredential).toHaveBeenLastCalledWith('FIXTURE_API_KEY')
  expect(f.removeCredential.mock.invocationCallOrder[1]).toBeLessThan(f.writeSettings.mock.invocationCallOrder[0]!)
})

it.each(['conflict', 'refused', 'transport'] as const)('密钥已移除但配置 %s 后，重试不能删除新写入的密钥', async (failure) => {
  const f = fixture()
  if (failure === 'transport') f.writeSettings.mockRejectedValueOnce(new Error('private error'))
  else f.writeSettings.mockResolvedValueOnce({ kind: failure, message: 'private error' })
  render(<ProviderRemoval {...f.props} />); chooseKey(); confirm()
  await screen.findByText(zh.removePartial)
  expect(screen.getByRole<HTMLInputElement>('checkbox').disabled).toBe(true)
  confirm(); await waitFor(() => { expect(f.onClose).toHaveBeenCalledWith(true) })
  expect(f.removeCredential).toHaveBeenCalledOnce(); expect(f.writeSettings).toHaveBeenCalledTimes(2)
})

it.each(['conflict', 'refused', 'transport'] as const)('仅配置删除 %s 保留确认区域', async (failure) => {
  const f = fixture()
  if (failure === 'transport') f.writeSettings.mockRejectedValueOnce(new Error('private error'))
  else f.writeSettings.mockResolvedValueOnce({ kind: failure, message: 'private error' })
  render(<ProviderRemoval {...f.props} />); confirm()
  await screen.findByText(failure === 'conflict' ? zh.conflict : zh.removeFailed)
  expect(f.onClose).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: zh.cancel })); expect(f.onClose).toHaveBeenCalledWith(false)
})

it('共享密钥不提供删除选项，非约定引用和只读凭据也不提供', () => {
  const f = fixture(), other = { ...f.props.row, entry: { ...f.props.row.entry, provider: 'other' } }
  const node = render(<ProviderRemoval {...f.props} rows={[f.props.row, other]} />)
  expect(screen.getByText(zh.sharedKey)).toBeTruthy(); expect(screen.queryByRole('checkbox')).toBeNull()
  node.rerender(<ProviderRemoval {...f.props} row={{ ...f.props.row, apiKeyEnv: 'SHARED_KEY' }} />)
  expect(screen.queryByRole('checkbox')).toBeNull()
  node.rerender(<ProviderRemoval {...f.props} row={{ ...f.props.row, credential: { configured: true, writable: false } }} />)
  expect(screen.queryByRole('checkbox')).toBeNull()
  node.rerender(<ProviderRemoval {...f.props} readOnly />)
  expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.confirmRemove }).disabled).toBe(true)
})

it.each([['credential', false], ['settings', false], ['credential', true], ['settings', true]] as const)(
  '在途 %s 卸载后，拒绝=%s 不继续副作用或关闭新视图', async (step, reject) => {
    const f = fixture(), keyGate = Promise.withResolvers<string | undefined>()
    const settingsGate = Promise.withResolvers<Awaited<ReturnType<ModelsOperations['writeSettings']>>>()
    if (step === 'credential') f.removeCredential.mockReturnValueOnce(keyGate.promise)
    else f.writeSettings.mockReturnValueOnce(settingsGate.promise)
    const node = render(<ProviderRemoval {...f.props} />)
    if (step === 'credential') chooseKey()
    confirm(); expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.removing }).disabled).toBe(true)
    fireEvent.submit(screen.getByRole('form', { name: zh.removeConfirm }))
    expect(step === 'credential' ? f.removeCredential : f.writeSettings).toHaveBeenCalledOnce()
    node.unmount()
    await act(async () => {
      if (reject && step === 'credential') keyGate.reject(new Error('private failure')); else keyGate.resolve(undefined)
      if (reject && step === 'settings') settingsGate.reject(new Error('private failure'))
      else settingsGate.resolve({ kind: 'written', view: f.props.namespace })
      await Promise.allSettled([keyGate.promise, settingsGate.promise])
    })
    expect(f.onClose).not.toHaveBeenCalled()
    if (step === 'credential') expect(f.writeSettings).not.toHaveBeenCalled()
  })

it('部分删除后关闭通知目录刷新，取消删除不发请求', async () => {
  const f = fixture(); f.writeSettings.mockResolvedValueOnce({ kind: 'refused', message: 'private error' })
  render(<ProviderRemoval {...f.props} />)
  fireEvent.click(screen.getByRole('button', { name: zh.cancel })); expect(f.onClose).toHaveBeenCalledWith(false)
  expect(f.removeCredential).not.toHaveBeenCalled(); expect(f.writeSettings).not.toHaveBeenCalled()
  chooseKey(); confirm(); await screen.findByText(zh.removePartial)
  fireEvent.click(screen.getByRole('button', { name: zh.cancel })); expect(f.onClose).toHaveBeenLastCalledWith(true)
})

it('目录删除入口先确认，完成后刷新共享目录', async () => {
  const f = fixture(), reload = vi.fn(async () => {})
  const state = { status: 'ready', error: null, credentialError: null, writable: true,
    rows: [f.props.row], namespaces: new Map([[f.props.namespace.ns, f.props.namespace]]) }
  const props = { useSnapshot: () => state, reload, operations: f.props.operations, schema: {},
    t: f.props.t, renderSlot: () => null } as unknown as ModelsProps
  render(<Models {...props} />)
  await waitFor(() => { expect(reload).toHaveBeenCalledOnce() })
  fireEvent.click(screen.getByRole('button', { name: zh.remove }))
  fireEvent.click(screen.getByRole('button', { name: zh.cancel }))
  expect(reload).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: zh.remove })); confirm()
  await waitFor(() => { expect(reload).toHaveBeenCalledTimes(2) })
  expect(screen.queryByRole('button', { name: zh.confirmRemove })).toBeNull()
})
