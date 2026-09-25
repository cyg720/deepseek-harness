// @vitest-environment jsdom
// Qishu workbench end-to-end over the BUILT client graph and the keyless fixture
// Connection RPC transport: the login gate authenticates, the shell swaps to the
// workbench, a seeded session opens, and a sent message reaches the transcript as
// the durable user node. The whole point of this file is that it drives the real
// built bundles through the real module loader — a slot-registration assertion or a
// component test cannot show that login, sending, and the transcript are wired to
// each other.
//
// Kept under apps/web/tests/qs/ per the Qishu isolation rule. It asserts on DOM
// contracts only and imports no Client package, which this lane forbids.
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { installAssembledBootEnv, mountAssembledApp } from '../assembled-boot.ts'

// 运行时错误必须使验收失败，不能仅凭最终节点存在判定成功。
const pageErrors: unknown[] = []
const captureError = (event: ErrorEvent): void => { pageErrors.push(event.error ?? event.message) }
const dialogDescriptors = new Map<string, PropertyDescriptor | undefined>()
beforeEach(() => {
  pageErrors.length = 0
  window.addEventListener('error', captureError)
  // jsdom 不实现顶层模态 API；仅补本场景读取的 open 与 close 事件，浏览器焦点由真实浏览器用例验收。
  for (const name of ['showModal', 'close']) {
    dialogDescriptors.set(name, Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name))
    Object.defineProperty(HTMLDialogElement.prototype, name, { configurable: true, value: function (this: HTMLDialogElement) {
      this.toggleAttribute('open', name === 'showModal')
      if (name === 'close') this.dispatchEvent(new Event('close'))
    } })
  }
})
afterEach(() => {
  try { expect(pageErrors).toEqual([]) } finally {
    window.removeEventListener('error', captureError)
    for (const [name, descriptor] of dialogDescriptors) {
      if (descriptor === undefined) Reflect.deleteProperty(HTMLDialogElement.prototype, name)
      else Object.defineProperty(HTMLDialogElement.prototype, name, descriptor)
    }
    dialogDescriptors.clear()
  }
})

installAssembledBootEnv()

/** Fill the sign-in form and submit it. */
function signIn(): void {
  const user = document.querySelector<HTMLInputElement>('#qs-login-user')
  const password = document.querySelector<HTMLInputElement>('#qs-login-password')
  if (user === null || password === null) throw new Error('sign-in fields missing')
  fireEvent.change(user, { target: { value: 'admin' } })
  fireEvent.change(password, { target: { value: 'Demo@2026' } })
  const form = user.closest('form')
  if (form === null) throw new Error('sign-in form missing')
  fireEvent.submit(form)
}

it('signs in, opens a session, and lands a sent message in the transcript', async () => {
  mountAssembledApp('?fixture', { defaultUi: 'workbench' })

  // The workbench owns the frame and shows the login gate first.
  await waitFor(() => {
    if (document.querySelector('[data-qs-root]') === null) throw new Error('workbench root missing')
  }, { timeout: 10_000 })
  expect(document.querySelector('[data-slot="qs.gate"]')).not.toBeNull()
  expect(document.querySelector('[data-qs-session-list]')).toBeNull()

  signIn()

  // Login succeeded: the workbench chrome and session navigation replace the gate.
  await waitFor(() => {
    if (document.querySelector('[data-qs-session-list]') === null) {
      throw new Error('session list missing after sign-in')
    }
  }, { timeout: 10_000 })
  expect(document.querySelector('[data-slot="qs.gate"]')).toBeNull()
  expect(document.querySelector('[data-slot="qs.chrome"]')).not.toBeNull()

  // Open the seeded fixture session from the qishu nav.
  const session = document.querySelector<HTMLButtonElement>('[data-qs-session]')
  if (session === null) throw new Error('no session row rendered')
  fireEvent.click(session)

  const composer = await waitFor(() => {
    const input = document.querySelector<HTMLTextAreaElement>('#qs-composer-input')
    if (input === null) throw new Error('composer input missing')
    return input
  }, { timeout: 10_000 })

  const sent = '奇术端到端：这条消息应当出现在转写里'
  fireEvent.change(composer, { target: { value: sent } })
  fireEvent.keyDown(composer, { key: 'Enter' })

  // The durable user node reaches the transcript: the send path really handed the
  // text to the official input machine and submitted it.
  await waitFor(() => {
    const transcript = document.querySelector('[data-qs-transcript]')
    if (transcript === null || !transcript.textContent?.includes(sent)) {
      throw new Error('sent text did not reach the transcript')
    }
  }, { timeout: 15_000 })
  expect(screen.getAllByText(sent).length).toBeGreaterThan(0)
})

it('creates a session from the no-session composer and sends exactly one draft', async () => {
  mountAssembledApp('?fixture=empty', { defaultUi: 'workbench' })
  await waitFor(() => { expect(document.querySelector('#qs-login-user')).not.toBeNull() }, { timeout: 10_000 })
  signIn()
  const input = await waitFor(() => {
    const node = document.querySelector<HTMLTextAreaElement>('#qs-composer-input')
    if (node === null) throw new Error('no-session composer missing')
    return node
  }, { timeout: 10_000 })
  expect(document.querySelector('[data-qs-transcript]')).toBeNull()
  const sent = 'First send creates one session'
  fireEvent.change(input, { target: { value: sent } })
  await waitFor(() => {
    const button = screen.getByRole('button', { name: /发送消息|Send the message/ }) as HTMLButtonElement
    expect(button.disabled).toBe(false)
  })
  fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() => {
    expect(document.querySelector('[data-qs-transcript]')?.textContent).toContain(sent)
  }, { timeout: 15_000 })
  expect(screen.getAllByText(sent)).toHaveLength(1)
  expect((document.querySelector('#qs-composer-input') as HTMLTextAreaElement).readOnly).toBe(false)
})


it('round-trips through the official interface without losing the selected session or draft', async () => {
  mountAssembledApp('?fixture', { defaultUi: 'workbench', showOfficialUiEntry: true })
  await waitFor(() => { expect(document.querySelector('#qs-login-user')).not.toBeNull() }, { timeout: 10_000 })
  signIn()
  const input = await waitFor(() => {
    const node = document.querySelector<HTMLTextAreaElement>('#qs-composer-input')
    if (node === null) throw new Error('composer missing')
    return node
  }, { timeout: 10_000 })
  const draft = 'Preserve this unsent draft'
  fireEvent.change(input, { target: { value: draft } })
  const selected = document.querySelector('[data-qs-session][aria-current="true"]')?.getAttribute('data-qs-session')
  const switchButton = document.querySelector<HTMLButtonElement>('[data-qs-switch-official]')
  if (switchButton === null) throw new Error('developer switch missing')
  fireEvent.click(switchButton)
  const back = await waitFor(() => {
    const button = document.querySelector<HTMLButtonElement>('[data-qs-official-return]')
    if (button === null) throw new Error('official return entry missing')
    return button
  }, { timeout: 10_000 })
  expect(document.querySelector('[data-qs-root]')).toBeNull()
  fireEvent.click(back)
  await waitFor(() => { expect(document.querySelector<HTMLTextAreaElement>('#qs-composer-input')?.value).toBe(draft) }, { timeout: 10_000 })
  expect(document.querySelector('[data-qs-session][aria-current="true"]')?.getAttribute('data-qs-session')).toBe(selected)
})
