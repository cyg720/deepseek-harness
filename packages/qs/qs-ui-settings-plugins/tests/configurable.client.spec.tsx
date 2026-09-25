// @vitest-environment jsdom
/** 只调度 Host 实际服务的卡，加载、失败、不可用和只读不可混淆。 */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SettingsMirrorSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ConfigurableProps } from '../src/client/contract.ts'
import { Configurable } from '../src/client/Configurable.tsx'
import { zh } from '../src/client/locales.ts'
afterEach(cleanup)
it('官方镜像与动态卡求交，缺失和失败不伪装成空目录', () => {
  let settings: SettingsMirrorSnapshot = { status: 'loading', view: undefined, error: null }
  let cards = ['absent', 'shell']
  const retry = vi.fn()
  const renderSlot = vi.fn((_slot: string, _owner: unknown, options: { entryKey: string }) => <span>{options.entryKey}</span>)
  const props = { retry, renderSlot, t: (key: keyof typeof zh) => zh[key],
    useSettings: (select: (value: SettingsMirrorSnapshot) => unknown) => select(settings),
    useCards: (select: (value: readonly string[]) => unknown) => select(cards),
  } as unknown as ConfigurableProps
  const view = render(<Configurable {...props} />)
  expect(screen.getByRole('status').textContent).toBe(zh.loading); expect(renderSlot).not.toHaveBeenCalled()
  settings = { status: 'idle', view: undefined, error: 'private-error' }; view.rerender(<Configurable {...props} />)
  expect(screen.getByRole('alert').textContent).not.toContain('private-error')
  fireEvent.click(screen.getByRole('button', { name: zh.retry })); expect(retry).toHaveBeenCalledOnce()
  settings = { status: 'unavailable', view: undefined, error: null }; view.rerender(<Configurable {...props} />)
  expect(screen.getByRole('status').textContent).toBe(zh.unavailable)
  settings = { status: 'ready', error: null, view: { namespaces: [{ ns: 'shell' } as never], writable: false, hasDocument: true } }
  view.rerender(<Configurable {...props} />)
  expect(renderSlot).toHaveBeenLastCalledWith('qs.settings.plugin.item', {}, { entryKey: 'shell' })
  expect(screen.queryByText('absent')).toBeNull(); expect(screen.getByRole('status').textContent).toBe(zh.readonly)
  settings = { ...settings, view: { ...settings.view!, writable: true } }; cards = []
  view.rerender(<Configurable {...props} />); expect(screen.getByText(zh.emptyConfig)).toBeTruthy()
  expect(screen.queryByRole('status')).toBeNull()
  settings = { status: 'idle', view: undefined, error: null }; view.rerender(<Configurable {...props} />)
  expect(screen.getByRole('status').textContent).toBe(zh.loading)
})
