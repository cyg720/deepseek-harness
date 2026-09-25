// @vitest-environment jsdom
/** 保存必须携带最初编辑版本；冲突、重置和旧实例回执使用可控 Promise 验证。 */
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SettingsMirrorSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import { NumericCard, type NumericProps } from '../src/client/NumericCard.tsx'
import type { CardWriter, SaveOutcome } from '../src/client/save.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
function fixture() {
  let namespace: SettingsNamespaceView = { ns: 'shell', schema: {}, revision: 2, applies: 'live', secrets: [], value: { timeoutMs: 100 }, base: { timeoutMs: 50 }, user: { timeoutMs: 100 } }
  let state: SettingsMirrorSnapshot = { status: 'ready', error: null, view: { namespaces: [namespace], writable: true, hasDocument: true } }
  const save = vi.fn<CardWriter['save']>(), dispose = vi.fn()
  const props = { namespace: 'shell', title: 'shellTitle', fields: [{ name: 'timeoutMs', label: 'timeout' }],
    createWriter: () => ({ save, dispose }), valid: (_field: string, value: number) => value > 0,
    t: (key: keyof typeof zh) => zh[key], useSettings: (select: (value: SettingsMirrorSnapshot) => unknown) => select(state),
  } as unknown as NumericProps
  const mounted = render(<NumericCard {...props} />)
  return { save, dispose, props, mounted, replace: (next: SettingsMirrorSnapshot) => {
    state = next; mounted.rerender(<NumericCard {...props} />)
  }, update: (revision: number, writable = true, applies: 'live' | 'restart' = 'live') => {
    namespace = { ...namespace, revision, applies }
    state = { ...state, view: { namespaces: [namespace], writable, hasDocument: true } }
    mounted.rerender(<NumericCard {...props} />)
  }, namespace }
}
it('冲突保留草稿和旧版本，显式采用新版本后才能按新版本提交', async () => {
  const f = fixture()
  fireEvent.change(screen.getByLabelText(zh.timeout), { target: { value: '200' } })
  f.update(3); f.save.mockResolvedValueOnce({ kind: 'conflict' })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh.save })) })
  expect(f.save).toHaveBeenLastCalledWith([{ op: 'set', path: ['timeoutMs'], value: 200 }], 2)
  expect(screen.getByRole('alert').textContent).toBe(zh.conflict)
  expect(screen.getByLabelText<HTMLInputElement>(zh.timeout).value).toBe('200')
  fireEvent.click(screen.getByRole('button', { name: zh.adoptRevision }))
  f.save.mockResolvedValueOnce({ kind: 'written', view: f.namespace }); f.update(3, true, 'restart')
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh.save })) })
  expect(f.save).toHaveBeenLastCalledWith([{ op: 'set', path: ['timeoutMs'], value: 200 }], 3)
  expect(screen.getByRole('status').textContent).toBe(zh.savedRestart)
})
it('非法输入不发送，重置发送 unset，失败保留草稿，只读阻止写入', async () => {
  const f = fixture()
  for (const value of ['wrong', '-1']) {
    fireEvent.change(screen.getByLabelText(zh.timeout), { target: { value } })
    fireEvent.click(screen.getByRole('button', { name: zh.save }))
    expect(screen.getByRole('alert').textContent).toBe(zh.invalidNumber)
  }
  expect(f.save).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: zh.resetField }))
  expect(screen.getByLabelText<HTMLInputElement>(zh.timeout).value).toBe('50')
  f.save.mockResolvedValue({ kind: 'refused' })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh.save })) })
  expect(f.save).toHaveBeenLastCalledWith([{ op: 'unset', path: ['timeoutMs'] }], 2)
  expect(screen.getByRole('alert').textContent).toBe(zh.saveFailed)
  fireEvent.click(screen.getByRole('button', { name: zh.discard }))
  expect(screen.getByLabelText<HTMLInputElement>(zh.timeout).value).toBe('100')
  f.update(3, false); expect(screen.getByLabelText<HTMLInputElement>(zh.timeout).disabled).toBe(true)
})
it('提交期间禁止重复发送，卸载释放提交器并忽略迟到的回执', async () => {
  const f = fixture(); let resolve!: (value: SaveOutcome) => void
  f.save.mockImplementation(() => new Promise((done) => { resolve = done }))
  fireEvent.change(screen.getByLabelText(zh.timeout), { target: { value: ' ' } })
  fireEvent.click(screen.getByRole('button', { name: zh.save }))
  fireEvent.click(screen.getByRole('button', { name: zh.saving }))
  expect(f.save).toHaveBeenCalledExactlyOnceWith([{ op: 'unset', path: ['timeoutMs'] }], 2)
  f.mounted.unmount(); expect(f.dispose).toHaveBeenCalledOnce()
  render(<NumericCard {...f.props} />)
  await act(async () => { resolve({ kind: 'written', view: f.namespace }) })
  expect(screen.queryByRole('status')).toBeNull()
  expect(screen.getByLabelText<HTMLInputElement>(zh.timeout).value).toBe('100')
})
it('镜像暂不可用不伪造配置，缺少用户覆盖与基础值时允许空白重置', async () => {
  const f = fixture()
  f.replace({ status: 'loading', error: null, view: undefined })
  expect(screen.queryByRole('region')).toBeNull()
  f.replace({ status: 'ready', error: null, view: { writable: true, hasDocument: true, namespaces: [
    { ns: 'shell', schema: {}, revision: 2, applies: 'live', secrets: [], value: {} },
  ] } })
  expect(screen.getByLabelText<HTMLInputElement>(zh.timeout).value).toBe('')
  fireEvent.click(screen.getByRole('button', { name: zh.resetField }))
  f.save.mockResolvedValue({ kind: 'written', view: f.namespace })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh.save })) })
  expect(f.save).toHaveBeenCalledWith([{ op: 'unset', path: ['timeoutMs'] }], 2)
  expect(screen.getByRole('status').textContent).toBe(zh.saved)
})
it('同批 DOM 事件在禁用状态提交前也不能重复保存或覆盖正在提交的草稿', async () => {
  const f = fixture(); let resolve!: (value: SaveOutcome) => void
  f.save.mockImplementation(() => new Promise((done) => { resolve = done }))
  const input = screen.getByLabelText<HTMLInputElement>(zh.timeout)
  fireEvent.change(input, { target: { value: '200' } })
  const button = screen.getByRole('button', { name: zh.save })
  act(() => {
    fireEvent.click(button)
    fireEvent.click(button)
    fireEvent.change(input, { target: { value: '300' } })
  })
  expect(f.save).toHaveBeenCalledExactlyOnceWith([{ op: 'set', path: ['timeoutMs'], value: 200 }], 2)
  await act(async () => { resolve({ kind: 'refused' }) })
  expect(input.value).toBe('200')
})
