// @vitest-environment jsdom
/** 使用官方控制器与可控异步，验证确认门槛及卸载后的写入隔离。 */
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PopupSelectController, type SelectOption } from '@deepseek-ai/dsh-client-ui-commands/client'
import { CommandPopup, type CommandPopupProps } from '../src/client/CommandPopup.tsx'

const dialogMethods = new Map(['showModal', 'close'].map(name => [name, Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name)]))
const showModal = vi.fn(function (this: HTMLDialogElement) { this.open = true })
const closeModal = vi.fn(function (this: HTMLDialogElement) { this.open = false })
// jsdom 不实现原生模态；焦点约束和 top layer 由真实浏览器回归验证。
beforeEach(() => {
  showModal.mockClear(); closeModal.mockClear()
  HTMLDialogElement.prototype.showModal = showModal
  HTMLDialogElement.prototype.close = closeModal
})
afterEach(() => {
  cleanup(); vi.restoreAllMocks()
  for (const [name, descriptor] of dialogMethods) {
    if (descriptor === undefined) Reflect.deleteProperty(HTMLDialogElement.prototype, name)
    else Object.defineProperty(HTMLDialogElement.prototype, name, descriptor)
  }
})
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function fixture() {
  const consume = vi.fn(() => true), focus = vi.fn(), unbind = vi.fn(), release = vi.fn()
  const popup = new PopupSelectController({ consume, focusComposer: focus })
  const input = document.createElement('textarea')
  const bindFocus = vi.fn((_callback: () => void) => unbind)
  const acquireFreeze = vi.fn(() => release)
  const props = { popup, bindFocus, inputElement: { current: input }, acquireFreeze,
    frozen: false, composing: { current: false }, bindCommandInput: vi.fn(), t: (key: string) => key,
  } as CommandPopupProps
  const view = render(<CommandPopup {...props} />)
  return { ...view, props, popup, consume, focus, unbind, release, bindFocus, acquireFreeze }
}
const options: readonly SelectOption[] = [
  { id: 'read', label: 'Read only', detail: 'Read files', active: true },
  { id: 'write', label: 'Write', confirmation: { title: 'Risk', description: 'Can modify files',
    acknowledgeLabel: 'I acknowledge', cancelLabel: 'Cancel risk', confirmLabel: 'Confirm risk' } },
]
it('加载失败可重试，搜索不重载，输入法确认不执行，显式确认才应用', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const f = fixture(), loading = deferred<readonly SelectOption[]>(), settlement = deferred<undefined>()
  const load = vi.fn().mockImplementationOnce(() => loading.promise).mockResolvedValue(options)
  const select = vi.fn(() => settlement.promise)
  expect(f.queryByRole('region')).toBeNull()
  act(() => { f.popup.open('permission', { options: load, onSelect: select }, {}, { via: 'enter', token: '/permission' }) })
  expect(f.getByRole('status').textContent).toBe('loading')
  expect(f.acquireFreeze).toHaveBeenLastCalledWith('command')
  await act(async () => { loading.reject(new Error('Catalog offline')); await loading.promise.catch(() => {}) })
  expect(f.getByRole('alert').textContent).toContain('Catalog offline')
  await act(async () => { fireEvent.click(f.getByRole('button', { name: 'retry' })) })
  const search = f.getByRole('textbox')
  expect(document.activeElement).toBe(search)
  fireEvent.change(search, { target: { value: 'missing' } })
  expect(f.getByRole('status').textContent).toBe('empty')
  fireEvent.change(search, { target: { value: ' FILES ' } })
  expect(f.getAllByRole('option')).toHaveLength(1)
  expect(f.getByRole('option').textContent).toContain('Read only')
  fireEvent.change(search, { target: { value: 'WRITE' } })
  expect(f.getAllByRole('option')).toHaveLength(1)
  expect(f.getByRole('option').textContent).toBe('Write')
  fireEvent.change(search, { target: { value: '' } })
  expect(load).toHaveBeenCalledTimes(2)
  const buttonEnter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
  f.getByRole('button', { name: 'close' }).dispatchEvent(buttonEnter)
  expect(buttonEnter.defaultPrevented).toBe(false)
  expect(select).not.toHaveBeenCalled()
  fireEvent.compositionStart(search)
  fireEvent.keyDown(search, { key: 'Enter' })
  expect(select).not.toHaveBeenCalled()
  fireEvent.compositionEnd(search)
  fireEvent.keyDown(search, { key: 'ArrowDown' })
  fireEvent.keyDown(search, { key: 'ArrowUp' })
  fireEvent.keyDown(search, { key: 'ArrowRight' })
  fireEvent.mouseEnter(f.getByRole('option', { name: 'Write' }))
  fireEvent.keyDown(search, { key: 'Enter' })
  expect(f.acquireFreeze).toHaveBeenLastCalledWith('confirmation')
  const confirm = f.getByRole('button', { name: 'Confirm risk' })
  expect((confirm as HTMLButtonElement).disabled).toBe(true)
  expect(f.getByRole('dialog', { name: 'Risk' }).textContent).toContain('Can modify files')
  expect(showModal).toHaveBeenCalledOnce()
  fireEvent.click(confirm)
  expect(select).not.toHaveBeenCalled()
  fireEvent.click(f.getByRole('button', { name: 'Cancel risk' }))
  expect(document.activeElement).toBe(f.getByRole('textbox'))
  fireEvent.click(f.getByRole('option', { name: 'Write' }))
  fireEvent.click(f.getByRole('checkbox'))
  fireEvent.click(f.getByRole('button', { name: 'Confirm risk' }))
  expect(select).toHaveBeenCalledExactlyOnceWith(options[1], {})
  expect(f.getByRole('status').textContent).toBe('applying')
  expect((f.getByRole('textbox') as HTMLInputElement).readOnly).toBe(true)
  await act(async () => { settlement.resolve(undefined); await settlement.promise })
  expect(f.consume).toHaveBeenCalledExactlyOnceWith({ via: 'enter', token: '/permission' })
  expect(f.focus).toHaveBeenCalledOnce()
  expect(f.queryByRole('region')).toBeNull()
  f.unmount()
  expect(f.unbind).toHaveBeenCalledOnce()
})

it('关闭和卸载撤销迟到执行结果的草稿消费权，并释放输入冻结', async () => {
  const f = fixture(), settling = deferred<undefined>()
  await act(async () => { f.popup.open('permission', { options: async () => options, onSelect: () => settling.promise }, {}, { via: 'enter', token: '/permission' }) })
  fireEvent.pointerDown(f.getByRole('textbox'))
  expect(f.popup.state.getSnapshot().open).toBe(true)
  fireEvent.click(f.getByRole('option', { name: /Read only/ }))
  f.unmount()
  expect(f.release).toHaveBeenCalledOnce()
  await act(async () => { settling.resolve(undefined); await settling.promise })
  expect(f.consume).not.toHaveBeenCalled()
  expect(f.focus).not.toHaveBeenCalled()
  expect(f.popup.state.getSnapshot().open).toBe(false)
  fireEvent.pointerDown(document.body)
})

it('Escape 和关闭按钮请求焦点恢复，外部点击不抢焦点，加载卸载会中止请求', async () => {
  const f = fixture(), loading = deferred<readonly SelectOption[]>(); let signal!: AbortSignal
  const open = () => { f.popup.open('permission', { options: async (_ctx, suppliedSignal) => { signal = suppliedSignal; return loading.promise }, onSelect: vi.fn() }, {}, { via: 'enter', token: '/permission' }) }
  act(open)
  fireEvent.keyDown(f.getByRole('textbox'), { key: 'Escape' })
  expect(f.focus).toHaveBeenCalledTimes(1)
  expect(signal.aborted).toBe(true)
  act(open)
  fireEvent.click(f.getByRole('button', { name: 'close' }))
  expect(f.focus).toHaveBeenCalledTimes(2)
  act(open)
  fireEvent.pointerDown(document.body)
  expect(f.focus).toHaveBeenCalledTimes(2)
  act(open)
  const focusInput = vi.spyOn(f.props.inputElement.current!, 'focus')
  f.bindFocus.mock.calls[0]![0]()
  expect(focusInput).toHaveBeenCalledOnce()
  f.unmount()
  expect(signal.aborted).toBe(true)
  await act(async () => { loading.resolve(options); await loading.promise })
  expect(f.popup.state.getSnapshot().open).toBe(false)
})

it('键盘高亮只滚动选项列表，不改变聊天或输入区的滚动位置', async () => {
  const f = fixture()
  await act(async () => { f.popup.open('permission', { options: async () => options, onSelect: vi.fn() }, {}, { via: 'enter', token: '/permission' }) })
  const list = f.getByRole('listbox'), rows = f.getAllByRole('option'), region = f.getByRole('region')
  Object.defineProperty(list, 'clientHeight', { value: 50 })
  for (const [index, row] of rows.entries()) {
    Object.defineProperty(row, 'offsetTop', { value: index * 80 })
    Object.defineProperty(row, 'offsetHeight', { value: 30 })
  }
  region.scrollTop = 15
  fireEvent.keyDown(f.getByRole('textbox'), { key: 'ArrowDown' })
  expect(list.scrollTop).toBe(60)
  fireEvent.keyDown(f.getByRole('textbox'), { key: 'ArrowUp' })
  expect(list.scrollTop).toBe(0)
  expect(region.scrollTop).toBe(15)
})

it('风险弹层的 Escape 与关闭按钮只取消确认，卸载释放原生模态', async () => {
  const f = fixture(), select = vi.fn()
  await act(async () => { f.popup.open('permission', { options: async () => options, onSelect: select }, {}, { via: 'enter', token: '/permission' }) })
  fireEvent.click(f.getByRole('option', { name: 'Write' }))
  const modal = f.getByRole('dialog')
  const cancel = new Event('cancel', { cancelable: true })
  fireEvent(modal, cancel)
  expect(cancel.defaultPrevented).toBe(true)
  expect(f.queryByRole('dialog')).toBeNull()
  expect(closeModal).toHaveBeenCalledOnce()
  expect(f.popup.state.getSnapshot().open).toBe(true)
  fireEvent.click(f.getByRole('option', { name: 'Write' }))
  fireEvent.click(f.getByRole('button', { name: 'close' }))
  expect(f.queryByRole('dialog')).toBeNull()
  fireEvent.click(f.getByRole('option', { name: 'Write' }))
  f.unmount()
  expect(closeModal).toHaveBeenCalledTimes(3)
  expect(select).not.toHaveBeenCalled()
  expect(f.consume).not.toHaveBeenCalled()
})
