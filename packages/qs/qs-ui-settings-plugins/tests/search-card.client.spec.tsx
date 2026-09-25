// @vitest-environment jsdom
/** 搜索配置与凭据独立反馈；密码草稿不进入普通文本。 */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SearchCard, type SearchProps } from '../src/client/SearchCard.tsx'
import type { SearchEditorState } from '../src/client/search-editor.ts'
import { zh } from '../src/client/locales.ts'
afterEach(cleanup)
it('公开字段、密码输入、继承与保存分别委派，部分成功不显示全部成功', () => {
  let state: SearchEditorState = {
    available: false, writable: true, fields: { baseURL: { text: '', overridden: false, invalid: false },
      maxUses: { text: '4', overridden: true, invalid: false } }, secret: '',
    credential: { ref: 'KEY', status: 'idle', configured: false, writable: false, saving: false },
    referenceChanged: false, conflicted: false, dirty: false, invalid: false, saving: false, outcome: undefined,
  }
  const actions = { edit: vi.fn(), resetField: vi.fn(), editSecret: vi.fn(), clearSecret: vi.fn(), discard: vi.fn(),
    save: vi.fn().mockResolvedValue(undefined), refreshCredential: vi.fn() }
  const props = { actions, t: (key: keyof typeof zh) => zh[key],
    useEditor: (select: (value: SearchEditorState) => unknown) => select(state),
  } as unknown as SearchProps
  const view = render(<SearchCard {...props} />)
  expect(screen.queryByRole('region')).toBeNull()
  const update = (next: Partial<SearchEditorState>): void => { state = { ...state, ...next }; view.rerender(<SearchCard {...props} />) }
  update({ available: true })
  expect(screen.getByRole('status').textContent).toBe(zh.credentialLoading)
  update({ credential: { ...state.credential, status: 'ready', writable: true } })
  expect(screen.getByRole('status').textContent).toBe(zh.credentialMissing)
  fireEvent.change(screen.getByLabelText(zh.searchURL), { target: { value: 'https://test.invalid' } })
  expect(actions.edit).toHaveBeenCalledWith('baseURL', 'https://test.invalid')
  fireEvent.change(screen.getByLabelText(zh.searchMaxUses), { target: { value: '8' } })
  expect(actions.edit).toHaveBeenCalledWith('maxUses', '8')
  for (const button of screen.getAllByRole('button', { name: zh.resetField })) fireEvent.click(button)
  expect(actions.resetField.mock.calls).toEqual([['baseURL'], ['maxUses']])
  const secret = screen.getByLabelText<HTMLInputElement>(zh.searchCredential)
  expect(secret.type).toBe('password')
  fireEvent.change(secret, { target: { value: 'fixture-secret' } }); expect(actions.editSecret).toHaveBeenCalledWith('fixture-secret')
  update({ secret: 'fixture-secret', dirty: true })
  expect(view.container.textContent).not.toContain('fixture-secret')
  fireEvent.click(screen.getByRole('button', { name: zh.save })); expect(actions.save).toHaveBeenCalledOnce()
  update({ outcome: { configuration: 'written', credential: 'refused' } })
  expect(screen.getByText(zh.configurationSaved)).toBeTruthy(); expect(screen.getByText(zh.credentialWriteFailed)).toBeTruthy()
  expect(screen.queryByText(zh.credentialSaved)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: zh.discard })); expect(actions.discard).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: zh.retry })); expect(actions.refreshCredential).toHaveBeenCalledOnce()
  for (const kind of ['busy', 'inactive', 'refused'] as const) {
    update({ outcome: { configuration: kind, credential: kind } })
    expect(screen.getByText(zh.configurationFailed)).toBeTruthy(); expect(screen.getByText(zh.credentialWriteFailed)).toBeTruthy()
  }
  update({ outcome: { configuration: 'conflict', credential: 'not-attempted' } })
  expect(screen.getByText(zh.searchConflict)).toBeTruthy(); expect(screen.getByText(zh.credentialNotAttempted)).toBeTruthy()
  update({ outcome: { configuration: 'unchanged', credential: 'reference-changed' } })
  expect(screen.getByText(zh.credentialReferenceChanged)).toBeTruthy()
  update({ outcome: { configuration: 'unchanged', credential: 'written' } })
  expect(screen.getByText(zh.credentialSaved)).toBeTruthy()
  update({ outcome: undefined, conflicted: true, referenceChanged: true, invalid: true,
    fields: { ...state.fields, maxUses: { text: 'bad', overridden: true, invalid: true } } })
  expect(screen.getByText(zh.invalidSearchField)).toBeTruthy()
  expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.save }).disabled).toBe(true)
  update({ saving: true, credential: { ...state.credential, status: 'loading' } })
  expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.saving }).disabled).toBe(true)
  update({ saving: false, writable: false, credential: { ...state.credential, status: 'ready', configured: true, writable: false } })
  expect(screen.getByText(zh.credentialReadonly)).toBeTruthy(); expect(screen.getByText(zh.credentialConfigured)).toBeTruthy()
  expect(secret.disabled).toBe(true)
  update({ credential: { ...state.credential, status: 'error' } }); expect(screen.getByText(zh.credentialReadFailed)).toBeTruthy()
  view.unmount(); expect(actions.clearSecret).toHaveBeenCalledOnce()
})
