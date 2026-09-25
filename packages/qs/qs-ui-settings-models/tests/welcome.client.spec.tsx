// @vitest-environment jsdom
/** 欢迎确认必须使用共享回执，失败不完成，迟到响应不影响新引导。 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Welcome } from '../src/client/Welcome.tsx'
import type { WelcomeInjected, WelcomeProps } from '../src/client/contract.ts'
import { zh } from '../src/client/locales.ts'

const original = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal')
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value(this: HTMLDialogElement) { this.open = true } })
})
afterEach(() => {
  cleanup()
  if (original === undefined) Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
  else Object.defineProperty(HTMLDialogElement.prototype, 'showModal', original)
})
type WelcomeState = ReturnType<WelcomeInjected['hooks']['welcome']['getSnapshot']>
function fixture(state: WelcomeState = { status: 'ready', acknowledged: false, error: null }) {
  const load = vi.fn(async () => {}), acknowledge = vi.fn(async () => true), complete = vi.fn()
  const copy = { welcomeTitle: 'Versioned notice', welcomeBody: 'First paragraph\n\nSecond paragraph',
    welcomeError: 'Acknowledgement failed', welcomeContinue: 'Confirm notice' }
  const props = { load, acknowledge, complete, stepId: 'welcome-notice', openSection: vi.fn(),
    useWelcome: (select: (value: WelcomeState) => unknown) => select(state),
    copy: (key: keyof typeof copy) => copy[key], t: (key: keyof typeof zh) => zh[key] } as unknown as WelcomeProps
  return { props, load, acknowledge, complete, copy }
}
async function ready() { await waitFor(() => { expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Confirm notice' }).disabled).toBe(false) }) }

it('呈现传入的版本化文案，Escape 不伪造确认，成功回执只完成一次', async () => {
  const f = fixture(), node = render(<Welcome {...f.props} />); await ready()
  expect(screen.getByText('First paragraph')).toBeTruthy(); expect(screen.getByText('Second paragraph')).toBeTruthy()
  const event = new Event('cancel', { bubbles: true, cancelable: true })
  fireEvent(screen.getByRole('dialog'), event); expect(event.defaultPrevented).toBe(true)
  expect(f.complete).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Confirm notice' }))
  await waitFor(() => { expect(f.complete).toHaveBeenCalledOnce() })
  const acknowledged = fixture({ status: 'ready', acknowledged: true, error: null })
  node.rerender(<Welcome {...f.props} useWelcome={acknowledged.props.useWelcome} />)
  expect(f.complete).toHaveBeenCalledOnce()
})

it.each(['refused', 'transport'] as const)('确认 %s 不完成，不显示远端原文，允许重试', async (kind) => {
  const f = fixture()
  if (kind === 'refused') f.acknowledge.mockResolvedValueOnce(false)
  else f.acknowledge.mockRejectedValueOnce(new Error('private failure'))
  const node = render(<Welcome {...f.props} />); await ready()
  fireEvent.click(screen.getByRole('button', { name: 'Confirm notice' })); await screen.findByRole('alert')
  expect(node.container.textContent).not.toContain('private failure'); expect(f.complete).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Confirm notice' }))
  await waitFor(() => { expect(f.complete).toHaveBeenCalledOnce() })
})

it('读取失败可重新加载，已有官方错误仅显示通用文案', async () => {
  const f = fixture({ status: 'error', acknowledged: false, error: 'private failure' })
  f.load.mockRejectedValueOnce(new Error('private load error'))
  const node = render(<Welcome {...f.props} />)
  await screen.findByRole('button', { name: zh.retry })
  expect(node.container.textContent).not.toContain('private')
  fireEvent.click(screen.getByRole('button', { name: zh.retry }))
  await waitFor(() => { expect(f.load).toHaveBeenCalledTimes(2) })
  await ready()
})

it.each(['idle', 'loading', 'saving'] as const)('状态 %s 时不提前打开或重复确认', async (status) => {
  const f = fixture({ status, acknowledged: false, error: null }); render(<Welcome {...f.props} />)
  await act(async () => { await Promise.resolve() })
  if (status === 'saving') expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Confirm notice' }).disabled).toBe(true)
  else expect(screen.queryByRole('dialog')).toBeNull()
  expect(f.acknowledge).not.toHaveBeenCalled()
})

it.each([false, true])('确认在途卸载，拒绝=%s 不完成新引导', async (reject) => {
  const f = fixture(), gate = Promise.withResolvers<boolean>()
  f.acknowledge.mockReturnValueOnce(gate.promise)
  const node = render(<Welcome {...f.props} />); await ready()
  fireEvent.click(screen.getByRole('button', { name: 'Confirm notice' })); node.unmount()
  const fresh = fixture(); render(<Welcome {...fresh.props} />); await ready()
  await act(async () => {
    if (reject) gate.reject(new Error('private failure')); else gate.resolve(true)
    await Promise.allSettled([gate.promise])
  })
  expect(f.complete).not.toHaveBeenCalled(); expect(fresh.complete).not.toHaveBeenCalled()
  expect(screen.queryByRole('alert')).toBeNull()
})

it.each([false, true])('读取在途卸载，拒绝=%s 不影响后续实例', async (reject) => {
  const f = fixture(), gate = Promise.withResolvers<undefined>(); f.load.mockReturnValueOnce(gate.promise)
  const node = render(<Welcome {...f.props} />); node.unmount()
  const fresh = fixture(); render(<Welcome {...fresh.props} />); await ready()
  await act(async () => {
    if (reject) gate.reject(new Error('private failure')); else gate.resolve(undefined)
    await Promise.allSettled([gate.promise])
  })
  expect(screen.queryByRole('alert')).toBeNull(); expect(fresh.complete).not.toHaveBeenCalled()
})

it('加载结束后才打开欢迎模态框，查询中的已确认状态不抢焦点', async () => {
  const f = fixture({ status: 'loading', acknowledged: false, error: null })
  const node = render(<Welcome {...f.props} />)
  await act(async () => { await Promise.resolve() })
  expect(screen.queryByRole('dialog')).toBeNull()
  const next = fixture()
  node.rerender(<Welcome {...f.props} useWelcome={next.props.useWelcome} />)
  expect(screen.getByRole<HTMLDialogElement>('dialog').open).toBe(true)
})

it('首次查询拒绝后显示重试，不能永久静默等待', async () => {
  const f = fixture({ status: 'idle', acknowledged: false, error: null })
  f.load.mockRejectedValueOnce(new Error('private load failure'))
  render(<Welcome {...f.props} />)
  await screen.findByRole('alert')
  expect(screen.getByRole('button', { name: zh.retry })).toBeTruthy()
  expect(screen.getByRole('status').textContent).toBe(zh.welcomeLoading)
})
