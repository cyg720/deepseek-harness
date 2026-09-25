// @vitest-environment jsdom
/** 新会话选择器和只读标识按实际投影展示，不将默认值混入历史会话。 */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PresetSeat, PresetLabel, type PresetSeatProps, type PresetLabelProps } from '../src/client/PresetSeat.tsx'
import type { QsPresetRosterState } from '../src/client/roster.ts'
import type { QsPresetSeatState } from '../src/client/seat.ts'
import { zh } from '../src/client/locales.ts'
afterEach(cleanup)
it('加载、不可用、错误、禁用策略均可辨识，只提交健康预设机器值', () => {
  let directory: QsPresetRosterState = { status: 'idle', roster: undefined, canOpenDirectory: false }
  let seat: QsPresetSeatState = { current: '', busy: false, failed: false }
  const load = vi.fn(async () => {}), select = vi.fn(async () => {})
  const props = { load, select, t: (key: keyof typeof zh) => zh[key],
    useRoster: (pick: (value: QsPresetRosterState) => unknown) => pick(directory),
    useSeat: (pick: (value: QsPresetSeatState) => unknown) => pick(seat),
  } as unknown as PresetSeatProps
  const mounted = render(<PresetSeat {...props} />)
  expect(load).toHaveBeenCalledOnce()
  for (const status of ['loading', 'error', 'unavailable'] as const) {
    directory = { ...directory, status }; mounted.rerender(<PresetSeat {...props} />)
    expect(screen.getByRole('status').textContent).toBe(zh[status === 'error' ? 'failed' : status])
  }
  directory = { ...directory, status: 'ready' }; mounted.rerender(<PresetSeat {...props} />)
  expect(screen.queryByRole('combobox')).toBeNull()
  directory = { ...directory, roster: { presets: [], modeSelectionEnabled: false, authorable: false } }
  mounted.rerender(<PresetSeat {...props} />); expect(screen.queryByRole('combobox')).toBeNull()
  directory = { ...directory, roster: { ...directory.roster!, modeSelectionEnabled: true } }
  mounted.rerender(<PresetSeat {...props} />)
  expect(screen.getByRole<HTMLSelectElement>('combobox').disabled).toBe(true)
  expect(screen.getByRole('option').textContent).toBe(zh.choosePreset)
  directory = { ...directory, roster: { ...directory.roster!, presets: [
    { id: 'standard', trust: 'system', isDefault: true }, { id: 'custom', name: '<img>', trust: 'user', isDefault: false },
    { id: 'broken', broken: 'private', trust: 'user', isDefault: false },
  ] } }
  seat = { ...seat, current: 'standard' }; mounted.rerender(<PresetSeat {...props} />)
  expect(screen.queryByRole('option', { name: 'broken' })).toBeNull()
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'custom' } }); expect(select).toHaveBeenCalledWith('custom')
  expect(mounted.container.querySelector('img')).toBeNull()
  seat = { current: 'missing', busy: true, failed: true }; mounted.rerender(<PresetSeat {...props} />)
  expect(screen.getByRole('status').textContent).toBe(zh.applyingPreset)
  expect(screen.getByRole('alert').textContent).toBe(zh.presetFailed)
  expect(screen.getByRole('option', { name: 'missing' })).toBeTruthy()
})
it('会话标签缺失时隐藏，未知预设显示机器值，目录读取后显示名称', () => {
  let preset: unknown = undefined
  let directory: QsPresetRosterState = { status: 'idle', roster: undefined, canOpenDirectory: false }
  const load = vi.fn(async () => {})
  const props = { sessionId: 'a', load, t: (key: keyof typeof zh) => zh[key],
    useSessions: (pick: (value: unknown) => unknown) => pick({ byId: { a: { projectionValues: { agentPreset: preset } } } }),
    useRoster: (pick: (value: QsPresetRosterState) => unknown) => pick(directory),
  } as unknown as PresetLabelProps
  const mounted = render(<PresetLabel {...props} />)
  expect(load).not.toHaveBeenCalled(); expect(mounted.container.textContent).toBe('')
  preset = 'custom'; mounted.rerender(<PresetLabel {...props} />)
  expect(load).toHaveBeenCalledOnce(); expect(screen.getByTitle(zh.presetLocked).textContent).toBe('custom')
  directory = { ...directory, roster: { presets: [{ id: 'custom', trust: 'user', isDefault: false, name: 'Custom' }], authorable: false, modeSelectionEnabled: true } }
  mounted.rerender(<PresetLabel {...props} />); expect(screen.getByTitle(zh.presetLocked).textContent).toBe('Custom')
  const missing = { ...props, useSessions: (pick: (value: unknown) => unknown) => pick({ byId: {} }) } as unknown as PresetLabelProps
  mounted.rerender(<PresetLabel {...missing} />); expect(mounted.container.textContent).toBe('')
  const noProjection = {
    ...props, useSessions: (pick: (value: unknown) => unknown) => pick({ byId: { a: {} } }),
  } as unknown as PresetLabelProps
  mounted.rerender(<PresetLabel {...noProjection} />); expect(mounted.container.textContent).toBe('')
})
