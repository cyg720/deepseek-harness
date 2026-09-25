// @vitest-environment jsdom
/** 切换保留页面草稿，移除贡献释放页面，迟到标签可进入。 */
import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Plugins } from '../src/client/Plugins.tsx'
import type { PluginsProps, PluginTab } from '../src/client/contract.ts'
import { zh } from '../src/client/locales.ts'
afterEach(cleanup)
it('按需挂载、键盘切换及卸载回退保持真实 DOM 状态', () => {
  let rows: readonly PluginTab[] = []
  const props = {
    t: (key: keyof typeof zh) => zh[key],
    useTabs: (select: (value: readonly PluginTab[]) => unknown) => select(rows),
    renderSlot: (_name: string, _owner: unknown, options: { only: string }) => <input aria-label={options.only} defaultValue="" />,
  } as unknown as PluginsProps
  const view = render(<Plugins {...props} />)
  expect(screen.getByRole('status').textContent).toBe(zh.empty)
  rows = [{ id: 'config', label: '配置' }, { id: 'all', label: '清单' }]
  view.rerender(<Plugins {...props} />)
  expect(screen.queryByRole('textbox', { name: 'all' })).toBeNull()
  fireEvent.change(screen.getByRole('textbox', { name: 'config' }), { target: { value: '保留草稿' } })
  const config = screen.getByRole('tab', { name: '配置' }), all = screen.getByRole('tab', { name: '清单' })
  fireEvent.keyDown(config, { key: 'ArrowRight' }); expect(document.activeElement).toBe(all)
  expect(screen.getByRole('textbox', { name: 'all' })).toBeTruthy()
  fireEvent.keyDown(all, { key: 'Home' }); expect(document.activeElement).toBe(config)
  expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'config' }).value).toBe('保留草稿')
  fireEvent.keyDown(config, { key: 'ArrowLeft' }); expect(document.activeElement).toBe(all)
  fireEvent.keyDown(all, { key: 'End' }); expect(document.activeElement).toBe(all)
  fireEvent.keyDown(all, { key: 'x' }); expect(all.getAttribute('aria-selected')).toBe('true')
  fireEvent.click(config); fireEvent.click(all)
  rows = [rows[0]!]; view.rerender(<Plugins {...props} />)
  expect(screen.queryByRole('textbox', { name: 'all', hidden: true })).toBeNull()
  expect(config.getAttribute('aria-selected')).toBe('true')
  rows = []; view.rerender(<Plugins {...props} />); expect(screen.getByRole('status')).toBeTruthy()
})
