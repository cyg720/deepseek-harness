// @vitest-environment jsdom
/** 子代理卡显示真实编辑状态并委派动作，不复制授权或保存状态。 */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SubagentCard, type SubagentProps } from '../src/client/SubagentCard.tsx'
import type { SubagentEditorState } from '../src/client/subagent-editor.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
it('开关、路由、目录错误和冲突分别呈现，保存与放弃按快照禁用', () => {
  let state: SubagentEditorState = {
    available: false, writable: true, enabled: false, selected: new Set(), candidates: [],
    catalog: { status: 'idle', groups: [], partial: false }, dirty: false, invalid: false,
    saving: false, conflicted: false, outcome: undefined,
  }
  const actions = {
    toggleEnabled: vi.fn(), toggleModel: vi.fn(), save: vi.fn().mockResolvedValue(undefined), discard: vi.fn(), refresh: vi.fn(),
  }
  const props = { actions, t: (key: keyof typeof zh) => zh[key],
    useEditor: (select: (value: SubagentEditorState) => unknown) => select(state),
  } as unknown as SubagentProps
  const view = render(<SubagentCard {...props} />)
  expect(screen.queryByRole('region')).toBeNull()
  const update = (next: Partial<SubagentEditorState>): void => { state = { ...state, ...next }; view.rerender(<SubagentCard {...props} />) }
  update({ available: true })
  expect(screen.getByText(zh.subagentOff)).toBeTruthy()
  fireEvent.click(screen.getByRole('checkbox')); expect(actions.toggleEnabled).toHaveBeenCalledOnce()
  update({ enabled: true, dirty: true, invalid: true, catalog: { status: 'loading', groups: [], partial: false } })
  expect(screen.getByRole('status').textContent).toBe(zh.catalogLoading)
  expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.save }).disabled).toBe(true)
  update({ catalog: { status: 'error', groups: [], partial: true }, candidates: [
    { key: 'a', provider: 'alpha', model: 'fast', providerName: 'Alpha', modelName: 'Fast', available: true },
    { key: 'b', provider: 'gone', model: 'old', providerName: 'Gone', modelName: 'Old', available: false },
  ], selected: new Set(['b']) })
  expect(screen.getByText(zh.catalogFailed)).toBeTruthy(); expect(screen.getByText(zh.catalogPartial)).toBeTruthy()
  expect(screen.getByText(zh.unavailableRoute)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: zh.retry })); expect(actions.refresh).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('checkbox', { name: /Alpha/ })); expect(actions.toggleModel).toHaveBeenCalledWith('a')
  update({ invalid: false, catalog: { status: 'ready', groups: [], partial: false } })
  fireEvent.click(screen.getByRole('button', { name: zh.save })); expect(actions.save).toHaveBeenCalledOnce()
  update({ saving: true })
  expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.saving }).disabled).toBe(true)
  update({ saving: false, conflicted: true })
  expect(screen.getByText(zh.subagentConflict)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: zh.discard })); expect(actions.discard).toHaveBeenCalledOnce()
  update({ conflicted: false, outcome: 'conflict' }); expect(screen.getByText(zh.subagentConflict)).toBeTruthy()
  update({ outcome: 'refused' }); expect(screen.getByText(zh.saveFailed)).toBeTruthy()
  update({ outcome: 'written', writable: false }); expect(screen.getByRole('status').textContent).toBe(zh.saved)
  expect(screen.getByRole<HTMLInputElement>('checkbox', { name: zh.subagentEnabled }).disabled).toBe(true)
})
