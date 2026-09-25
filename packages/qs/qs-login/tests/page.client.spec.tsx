// @vitest-environment jsdom
/** 登录交互通过实际表单验证凭据、重复提交、错误映射及存储降级。 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { LoginPage } from '../src/client/LoginPage.tsx'
import { QsSignInError, DEMO_USERNAME, DEMO_PASSWORD } from '../src/client/auth-gateway.ts'
import type { QsGateProps } from '../src/client/contract.ts'
import { zh } from '../src/client/locales.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear() })
/** 只提供登录页消费的座席；渲染框架的其他能力在此组件不使用。 */
function props(signIn: QsGateProps['signIn'], remembered = ''): QsGateProps {
  return {
    t: key => (zh as Readonly<Record<string, string>>)[key] ?? key,
    useAuth: select => select({ authenticated: false }), signIn, rememberedUser: () => remembered,
  } as QsGateProps
}
it('预填身份、切换密码并且只提交一次冻结中的凭据', async () => {
  let finish!: () => void
  const signIn = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
  const view = render(<LoginPage {...props(signIn, 'remembered')} />)
  expect(screen.getByLabelText(zh['form.username'])).toHaveProperty('value', 'remembered')
  fireEvent.change(screen.getByLabelText(zh['form.username']), { target: { value: 'admin' } })
  fireEvent.change(screen.getByLabelText(zh['form.password']), { target: { value: 'secret' } })
  fireEvent.click(screen.getByRole('button', { name: zh['form.showPassword'] }))
  expect(screen.getByLabelText(zh['form.password']).getAttribute('type')).toBe('text')
  fireEvent.click(screen.getByRole('button', { name: zh['form.hidePassword'] }))
  fireEvent.click(screen.getByLabelText(zh['form.remember']))
  fireEvent.submit(view.container.querySelector('form')!)
  fireEvent.submit(view.container.querySelector('form')!)
  expect(signIn).toHaveBeenCalledExactlyOnceWith({ username: 'admin', password: 'secret' }, false)
  expect(screen.getByLabelText(zh['form.username'])).toHaveProperty('disabled', true)
  await act(async () => { finish() })
  expect(screen.getByLabelText(zh['form.password'])).toHaveProperty('value', '')
  expect(screen.getByLabelText(zh['form.username'])).toHaveProperty('disabled', false)
})
it.each([new QsSignInError('rejected'), new Error('transport')])('失败保留用户名并显示对应错误', async (error) => {
  const signIn = vi.fn().mockRejectedValue(error)
  const view = render(<LoginPage {...props(signIn)} />)
  fireEvent.click(screen.getByRole('button', { name: zh['form.demoFill'] }))
  await act(async () => { fireEvent.submit(view.container.querySelector('form')!) })
  expect(signIn).toHaveBeenCalledWith({ username: DEMO_USERNAME, password: DEMO_PASSWORD }, false)
  expect(screen.getByRole('alert').textContent).toBe(zh[error instanceof QsSignInError ? 'error.rejected' : 'error.unknown'])
})
it('本地存储不可写时仍显示登录表单和降级提示', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('denied', 'SecurityError') })
  render(<LoginPage {...props(vi.fn())} />)
  expect(screen.getByText(zh['form.storageDegraded'])).toBeDefined()
  expect(screen.getByRole('button', { name: zh['form.submit'] })).toHaveProperty('disabled', false)
})
