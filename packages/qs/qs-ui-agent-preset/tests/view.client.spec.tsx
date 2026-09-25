// @vitest-environment jsdom
/** 预设条目按文本呈现，保留默认、来源及损坏状态。 */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Directory, type DirectoryProps } from '../src/client/Directory.tsx'
import type { QsPresetRosterState } from '../src/client/roster.ts'
import { zh } from '../src/client/locales.ts'
afterEach(cleanup)
it('读取状态可恢复，损坏条目不被过滤，Host 标题不能注入 HTML', () => {
  let state: QsPresetRosterState = { status: 'idle', roster: undefined, canOpenDirectory: false }
  const refresh = vi.fn(async () => {})
  const props = { refresh, t: (key: keyof typeof zh) => zh[key],
    useSettings: (select: (value: unknown) => unknown) => select({ status: 'unavailable', error: null, view: undefined }),
    useRoster: (select: (value: QsPresetRosterState) => unknown) => select(state),
  } as unknown as DirectoryProps
  const view = render(<Directory {...props} />)
  expect(refresh).toHaveBeenCalledOnce()
  for (const status of ['loading', 'unavailable', 'error'] as const) {
    state = { ...state, status }; view.rerender(<Directory {...props} />)
    expect(screen.getByRole('status').textContent).toBe(zh[status === 'loading' ? 'loading' : status === 'error' ? 'failed' : 'unavailable'])
  }
  fireEvent.click(screen.getByRole('button', { name: zh.reload })); expect(refresh).toHaveBeenCalledTimes(2)
  state = { ...state, status: 'ready' }; view.rerender(<Directory {...props} />)
  expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  state = { ...state, roster: { authorable: false, modeSelectionEnabled: true, presets: [
    { id: 'standard', trust: 'system', isDefault: true },
    { id: 'custom', trust: 'user', isDefault: false, name: '<script>private()</script>', description: '<img src=x>', broken: 'Host error' },
  ] } }; view.rerender(<Directory {...props} />)
  expect(screen.getAllByRole('listitem')).toHaveLength(2)
  expect(screen.getByText(zh.default)).toBeTruthy()
  expect(screen.getByText(zh.system)).toBeTruthy(); expect(screen.getByText(zh.user)).toBeTruthy()
  expect(screen.getByText(zh.broken)).toBeTruthy()
  expect(view.container.querySelector('script, img')).toBeNull()
})
