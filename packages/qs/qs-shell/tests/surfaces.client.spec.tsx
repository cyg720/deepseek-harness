// @vitest-environment jsdom
/** 外壳表面通过可见状态和实际操作回调验证，不依赖样式类名。 */
import type { ComponentProps } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { QsStatusBar } from '../src/client/StatusBar.tsx'
import { QsOverlayHost } from '../src/client/OverlayHost.tsx'
import { QsOfficialReturn } from '../src/client/OfficialReturn.tsx'
import { QsTopBar } from '../src/client/TopBar.tsx'
import { AppShell, type AppShellProps } from '../src/client/AppShell.tsx'
import { QsFaultPage, QsRootErrorBoundary } from '../src/client/FaultPage.tsx'
import { zh } from '../src/client/locales.ts'
import { createQsLayoutStore } from '../src/client/layout-store.ts'
const t = (key: string): string => (zh as Readonly<Record<string, string>>)[key] ?? key
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear() })
it.each(['connected', 'disconnected', 'connecting', undefined] as const)('连接状态 %s 仅断开时允许重连', (state) => {
  const reconnect = vi.fn()
  render(<QsStatusBar t={t} reconnect={reconnect} useQsConnection={select => select({ state, loopback: state === 'connected' })} />)
  if (state === 'disconnected') { fireEvent.click(screen.getByRole('button')); expect(reconnect).toHaveBeenCalledOnce() }
  else expect(screen.queryByRole('button')).toBeNull()
})
it('toast 原样展示字符串且不解析注入 HTML', () => {
  const useQsToasts: ComponentProps<typeof QsOverlayHost>['useQsToasts'] = select => select([{ id: 1, message: '<img src=x>' }])
  const view = render(<QsOverlayHost t={t} useQsToasts={useQsToasts} />)
  expect(screen.getByRole('status').textContent).toBe('<img src=x>')
  expect(view.container.querySelector('img')).toBeNull()
})
it.each([true, false])('官方返回入口支持宽窄导航 %s', (wide) => {
  const backToWorkbench = vi.fn()
  render(<QsOfficialReturn {...{ t, wide, backToWorkbench } as ComponentProps<typeof QsOfficialReturn>} />)
  fireEvent.click(screen.getByRole('button', { name: zh['switch.toWorkbench'] }))
  expect(backToWorkbench).toHaveBeenCalledOnce()
})
it.each([{ show: true, frozen: false }, { show: true, frozen: true }, { show: false, frozen: false }])('顶栏切换、侧栏开关与退出 $show/$frozen', ({ show, frozen }) => {
  const store = createQsLayoutStore().create()
  const signOut = vi.fn(), switchToOfficial = vi.fn()
  const props = { t, renderSlot: () => null, useStore: select => select(store.getSnapshot()), actions: store.actions, useQsUiMode: select => select({ ui: 'workbench', showOfficialUiEntry: show, ...(frozen ? { freeze: 'sending' } : {}) }), signOut, switchToOfficial, ...(frozen ? { useQsAuth: select => select({ user: '测试用户', authenticated: true }) } : {}) } as ComponentProps<typeof QsTopBar>
  const view = render(<QsTopBar {...props} />)
  const button = view.container.querySelector<HTMLButtonElement>('[data-qs-switch-official]')
  expect(button !== null).toBe(show)
  if (button) { fireEvent.click(button); expect(switchToOfficial).toHaveBeenCalledTimes(frozen ? 0 : 1) }
  for (const element of view.container.querySelectorAll('button[aria-expanded]')) fireEvent.click(element)
  view.rerender(<QsTopBar {...props} />)
  fireEvent.click(screen.getByRole('button', { name: zh['user.signOut'] }))
  expect(signOut).toHaveBeenCalledOnce()
})
/** 故障文案来自外壳字典；错误对象由 React 边界捕获。 */
const copy = { title: '故障', lead: '可重试', retry: '重试', reload: '刷新', detail: '详情' }
it.each([new Error('broken'), '字符串异常', { reason: '结构异常' }])('根故障可重试并保留可读诊断', (error) => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const onError = (event: ErrorEvent): void => { if (event.error === error) event.preventDefault() }
  window.addEventListener('error', onError)
  let broken = true
  function Child() { if (broken) throw error; return <p>已恢复</p> }
  render(<QsRootErrorBoundary copy={copy}><Child /></QsRootErrorBoundary>)
  expect(screen.getByRole('alert').textContent).toContain(error instanceof Error ? 'broken' : typeof error === 'string' ? error : '结构异常')
  broken = false; fireEvent.click(screen.getByRole('button', { name: '重试' }))
  expect(screen.getByText('已恢复')).toBeDefined()
  window.removeEventListener('error', onError)
})
it('故障页无明细时仍可刷新', () => {
  const reload = vi.fn(); vi.stubGlobal('location', { reload })
  render(<QsFaultPage copy={copy} />)
  expect(screen.queryByText('详情')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '刷新' })); expect(reload).toHaveBeenCalledOnce()
})
it('缺登录座席时显示明确故障而不展示工作台', () => {
  render(<AppShell {...{ t } as AppShellProps} />)
  expect(screen.getByRole('alert')).toBeDefined()
})
it.each([false, true])('登录前后只渲染所属外壳分支 %s', (authenticated) => {
  const store = createQsLayoutStore().create()
  const props = { t, actions: store.actions, useStore: select => select(store.getSnapshot()), useQsAuth: select => select({ authenticated, user: 'admin' }), useQsTheme: select => select({ scheme: authenticated ? 'dark' : 'light' }), renderSlot: (name: string) => <span>{name}</span> } as AppShellProps
  const view = render(<AppShell {...props} />)
  expect(view.container.textContent).toContain(authenticated ? 'qs.stage' : 'qs.gate')
  if (authenticated) fireEvent.click(screen.getByRole('button', { name: zh['nav.collapse'] }))
})

it.each(['recovered', 'memory'] as const)('shows the localized layout notice %s and offers a reset', (storageNotice) => {
  const store = createQsLayoutStore().create(), reset = vi.fn()
  render(<AppShell {...{ t, actions: { ...store.actions, reset },
    useStore: select => select({ ...store.getSnapshot(), storageNotice }),
    useQsAuth: select => select({ authenticated: true, user: 'admin' }),
    useQsTheme: select => select({ scheme: 'light' }), renderSlot: () => null } as AppShellProps} />)
  expect(screen.getByRole('status').textContent).toContain(zh[storageNotice === 'recovered' ? 'layout.recovered' : 'layout.memory'])
  fireEvent.click(screen.getByRole('button', { name: zh['layout.reset'] }))
  expect(reset).toHaveBeenCalledOnce()
})
it('视口监听在卸载时解除，宽窄变化传入布局动作', () => {
  let listener!: () => void
  const removeEventListener = vi.fn()
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: (_: string, fn: () => void) => { listener = fn }, removeEventListener }))
  const store = createQsLayoutStore().create(), applyViewport = vi.fn()
  const view = render(<AppShell {...{ t, useQsAuth: select => select({ authenticated: true }), useQsTheme: select => select({ scheme: 'light' }), useStore: select => select({ ...store.getSnapshot(), compact: true, leftWidth: 240, rightWidth: 300 }), actions: { ...store.actions, applyViewport }, renderSlot: () => null } as AppShellProps} />)
  listener(); expect(applyViewport).toHaveBeenCalledWith({ narrow: true, wide: true })
  view.unmount(); expect(removeEventListener).toHaveBeenCalledTimes(2)
})

/** 宽屏左右栏展开时提供两个键盘可操作的调整手柄。 */
it('桌面展开左右栏时渲染各自调整手柄', () => {
  const store = createQsLayoutStore().create()
  const props = { t, useQsAuth: select => select({ authenticated: true }), useQsTheme: select => select({ scheme: 'light' }), useStore: select => select({ ...store.getSnapshot(), compact: false, leftOpen: true, rightOpen: true }), actions: store.actions, renderSlot: () => null } as AppShellProps
  render(<AppShell {...props} />)
  expect(screen.getAllByRole('separator')).toHaveLength(2)
})
