// @vitest-environment jsdom
/** 目标草稿的版本及异步结果归属必须跟随当前会话。 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { makeTranslate, RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type { GoalProjection, GoalView } from '@deepseek-ai/dsh-goal/client'
import type { GoalProps } from '../src/client/contract.ts'
import { GoalDock } from '../src/client/GoalDock.tsx'
import { en, zh } from '../src/client/locales.ts'

const dialogDescriptors = new Map<string, PropertyDescriptor | undefined>()
beforeEach(() => {
  // jsdom 不实现模态顶层；真实浏览器另验焦点及背景隔离。
  for (const name of ['showModal', 'close']) {
    dialogDescriptors.set(name, Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name))
    Object.defineProperty(HTMLDialogElement.prototype, name, { configurable: true, value(this: HTMLDialogElement) { this.open = name === 'showModal' } })
  }
})
afterEach(() => {
  cleanup()
  for (const [name, descriptor] of dialogDescriptors) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor)
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name)
  }
  dialogDescriptors.clear()
  vi.restoreAllMocks()
})
const success = { ok: true as const, value: undefined }
function fixture(projection: GoalProjection | null | undefined = goal()) {
  const actions = {
    onCreate: vi.fn(async () => success), onEdit: vi.fn(async () => success),
    onPause: vi.fn(async () => success), onResume: vi.fn(async () => success),
    onClear: vi.fn(async () => success),
    onRefresh: vi.fn(async () => ({ ok: true as const, value: undefined as GoalView | undefined })),
  }
  // 只提供该呈现消费的座席；正式装配由独立生命周期用例验证。
  const props = {
    ...actions, sessionId: 'session-a', t: makeTranslate(en),
    useProjection: () => projection,
    useGoalConnected: (select: (value: boolean) => unknown) => select(true),
    useGoalActivation: (select: (value: object) => unknown) => select({ ...projection?.goal, activation: 'armed' }),
    useSession: (select: (value: object) => unknown) => select({ openState: 'open', removed: false, subagent: null }),
  } as unknown as GoalProps
  return { props, actions }
}
function goal(): GoalProjection {
  return { goal: { id: 'goal-a' as GoalView['id'], revision: 1, objective: 'Initial objective', phase: 'active', maxGoalRounds: 4 }, roundsStarted: 1, createdAt: 10, updatedAt: 20 }
}
async function click(name: string) {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name })) })
}

it('distinguishes loading from absent and creates a literal control-word objective', async () => {
  const loading = fixture(); loading.props = { ...loading.props, useProjection: () => undefined }
  const view = render(<GoalDock {...loading.props} />)
  expect(screen.getByText(en.loading)).toBeTruthy()
  expect(screen.queryByRole('button')).toBeNull()
  const empty = fixture(null)
  view.rerender(<GoalDock {...empty.props} />)
  await click(en.create)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: ' clear ' } })
  await click(en.save)
  expect(empty.actions.onCreate).toHaveBeenCalledExactlyOnceWith('clear')
  expect(empty.actions.onClear).not.toHaveBeenCalled()
})

it('retains the draft and conflict lock across failed refresh, then submits the reviewed revision', async () => {
  const { props } = fixture()
  const onEdit = vi.fn<GoalProps['onEdit']>().mockResolvedValueOnce({ ok: false, error: new RemoteError('GOAL_STALE_REVISION', 'changed', {}) }).mockResolvedValue(success)
  const latest: GoalView = { ...goal().goal, revision: 2, objective: 'Other editor', roundsStarted: 1, createdAt: 10, updatedAt: 30, activation: 'armed' }
  const onRefresh = vi.fn<GoalProps['onRefresh']>().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ ok: true, value: latest })
  render(<GoalDock {...props} onEdit={onEdit} onRefresh={onRefresh} />)
  await click(en.edit)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'My draft' } })
  await click(en.save)
  expect(onEdit).toHaveBeenLastCalledWith('My draft', { id: 'goal-a', revision: 1 })
  await click(en.refresh)
  expect(screen.getByRole('button', { name: en.save })).toHaveProperty('disabled', true)
  expect(screen.getByRole('textbox')).toHaveProperty('value', 'My draft')
  await click(en.refresh)
  expect(onEdit).toHaveBeenCalledTimes(1)
  expect(screen.getByText('Latest objective: Other editor')).toBeTruthy()
  await click(en.save)
  expect(onEdit).toHaveBeenLastCalledWith('My draft', { id: 'goal-a', revision: 2 })
})

it('fences a pending result after switching sessions and prevents duplicate submissions', async () => {
  const first = fixture()
  let settle!: (result: Awaited<ReturnType<GoalProps['onClear']>>) => void
  const onClear = vi.fn<GoalProps['onClear']>(() => new Promise((resolve) => { settle = resolve }))
  const view = render(<GoalDock {...first.props} onClear={onClear} />)
  await click(en.clear)
  const button = screen.getByRole('button', { name: en.confirmClear })
  act(() => { button.click(); button.click() })
  expect(onClear).toHaveBeenCalledTimes(1)
  view.rerender(<GoalDock {...first.props} sessionId={'session-b' as GoalProps['sessionId']} />)
  await act(async () => { settle({ ok: false, error: new RemoteError('GOAL_STALE_REVISION', 'old request', {}) }) })
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getByRole('button', { name: en.clear })).toHaveProperty('disabled', false)
})

it('retains completed objectives and literal round counts without a progress percentage', () => {
  const value: GoalProjection = { ...goal(), goal: { ...goal().goal, phase: 'complete' } }
  render(<GoalDock {...fixture(value).props} />)
  expect(screen.getByText(en.complete)).toBeTruthy()
  expect(screen.getByText('1 rounds started / limit 4')).toBeTruthy()
  expect(screen.queryByRole('progressbar')).toBeNull()
  expect(screen.queryByRole('button', { name: en.resume })).toBeNull()
})

it('shows a blocked reason as text and refuses resume at the round limit', () => {
  const value: GoalProjection = { ...goal(), roundsStarted: 4, goal: { ...goal().goal, phase: 'blocked', blockedReason: { code: 'failed', message: '<img src=x onerror=alert(1)>' } } }
  const view = render(<GoalDock {...fixture(value).props} />)
  expect(screen.getByText(en.blocked)).toBeTruthy()
  expect(view.container.textContent).toContain('<img src=x onerror=alert(1)>')
  expect(view.container.querySelector('img')).toBeNull()
  expect(screen.getByText(en.exhausted)).toBeTruthy()
  expect(screen.queryByRole('button', { name: en.resume })).toBeNull()
})

it('does not retarget a stale draft when explicit refresh finds another goal', async () => {
  const { props } = fixture()
  const onEdit = vi.fn<GoalProps['onEdit']>().mockResolvedValue({ ok: false, error: new RemoteError('GOAL_STALE_REVISION', 'changed', {}) })
  const onRefresh = vi.fn<GoalProps['onRefresh']>().mockResolvedValue({ ok: true, value: undefined })
  render(<GoalDock {...props} onEdit={onEdit} onRefresh={onRefresh} />)
  await click(en.edit)
  await click(en.save)
  await click(en.refresh)
  expect(screen.getByText(en.missing)).toBeTruthy()
  expect(screen.getByRole('button', { name: en.save })).toHaveProperty('disabled', true)
  expect(onEdit).toHaveBeenCalledTimes(1)
})

it('shows reconnect activation separately and makes disconnected sessions read-only', () => {
  const { props } = fixture()
  render(<GoalDock {...props} useGoalConnected={select => select(false)} useGoalActivation={select => select({})} />)
  expect(screen.getByText(en.reading)).toBeTruthy()
  expect(screen.getByText(en.readonly)).toBeTruthy()
  expect(screen.queryByRole('button', { name: en.pause })).toBeNull()
  expect(screen.getByRole('button', { name: en.edit })).toHaveProperty('disabled', true)
})

it('pauses and resumes with the displayed revision, and restores focus when editing ends', async () => {
  const { props, actions } = fixture()
  const view = render(<GoalDock {...props} />)
  await click(en.pause)
  expect(actions.onPause).toHaveBeenCalledExactlyOnceWith({ id: 'goal-a', revision: 1 })
  const inactive = { ...props, useGoalActivation: (select => select({ ...goal().goal, activation: 'disarmed' })) as GoalProps['useGoalActivation'] }
  view.rerender(<GoalDock {...inactive} />)
  expect(screen.getByText(en.disarmed)).toBeTruthy()
  await click(en.resume)
  expect(actions.onResume).toHaveBeenCalledExactlyOnceWith({ id: 'goal-a', revision: 1 })
  await click(en.edit)
  const input = screen.getByRole('textbox')
  expect(document.activeElement).toBe(input)
  fireEvent.keyDown(input, { key: 'a' })
  expect(screen.getByRole('textbox')).toBe(input)
  fireEvent.keyDown(input, { key: 'Escape' })
  expect(document.activeElement).toBe(screen.getByRole('button', { name: en.edit }))
  await click(en.edit)
  await click(en.cancel)
  expect(document.activeElement).toBe(screen.getByRole('button', { name: en.edit }))
  expect(actions.onEdit).not.toHaveBeenCalled()
})

it('refuses blank and conflicting form submissions and retains domain errors without consuming drafts', async () => {
  const { props } = fixture()
  const onEdit = vi.fn<GoalProps['onEdit']>().mockResolvedValue({ ok: false, error: new RemoteError('GOAL_INVALID_OBJECTIVE', 'Invalid objective', {}) })
  const view = render(<GoalDock {...props} onEdit={onEdit} />)
  await click(en.edit)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } })
  await act(async () => { fireEvent.submit(view.container.querySelector('form')!) })
  expect(onEdit).not.toHaveBeenCalled()
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Draft' } })
  await click(en.save)
  expect(screen.getByRole('alert').textContent).toContain('Invalid objective (GOAL_INVALID_OBJECTIVE)')
  expect(screen.getByRole('textbox')).toHaveProperty('value', 'Draft')
  onEdit.mockResolvedValue({ ok: false, error: new RemoteError('GOAL_STALE_REVISION', 'Conflict', {}) })
  await click(en.save)
  await act(async () => { fireEvent.submit(view.container.querySelector('form')!) })
  expect(onEdit).toHaveBeenCalledTimes(2)
})

it('keeps a pending editor open on Escape and ignores rejection after unmount', async () => {
  const { props } = fixture()
  let reject!: (error: Error) => void
  const onEdit = vi.fn<GoalProps['onEdit']>(() => new Promise((_resolve, fail) => { reject = fail }))
  const view = render(<GoalDock {...props} onEdit={onEdit} />)
  await click(en.edit)
  await click(en.save)
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
  expect(screen.getByRole('textbox')).toBeTruthy()
  view.unmount()
  await act(async () => { reject(new Error('removed service')) })
})

it('uses an explicitly reviewed version for retrying a failed non-edit action', async () => {
  const { props } = fixture()
  const onClear = vi.fn<GoalProps['onClear']>().mockResolvedValueOnce({ ok: false, error: new RemoteError('GOAL_STALE_REVISION', 'Conflict', {}) }).mockResolvedValue(success)
  const latest: GoalView = { ...goal().goal, revision: 3, objective: 'Updated remotely', createdAt: 10, updatedAt: 30, roundsStarted: 1, activation: 'armed' }
  render(<GoalDock {...props} onClear={onClear} onRefresh={async () => ({ ok: true, value: latest })} />)
  await click(en.clear)
  await click(en.confirmClear)
  await click(en.refresh)
  expect(screen.getByText('Latest objective: Updated remotely')).toBeTruthy()
  expect(onClear).toHaveBeenCalledTimes(1)
  await click(en.clear)
  await click(en.confirmClear)
  expect(onClear).toHaveBeenLastCalledWith({ id: 'goal-a', revision: 3 })
})

it('discards an old goal draft and fences its request when another goal replaces it in the same session', async () => {
  const first = fixture()
  let settle!: (value: Awaited<ReturnType<GoalProps['onEdit']>>) => void
  const onEdit = vi.fn<GoalProps['onEdit']>(() => new Promise((resolve) => { settle = resolve }))
  const view = render(<GoalDock {...first.props} onEdit={onEdit} />)
  await click(en.edit)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Old goal draft' } })
  await click(en.save)
  const next = fixture({ ...goal(), goal: { ...goal().goal, id: 'goal-b' as GoalView['id'], objective: 'Replacement objective' } })
  view.rerender(<GoalDock {...next.props} />)
  await act(async () => { settle({ ok: false, error: new RemoteError('GOAL_STALE_REVISION', 'old request', {}) }) })
  expect(screen.queryByRole('textbox')).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
  await click(en.edit)
  expect(screen.getByRole('textbox')).toHaveProperty('value', 'Replacement objective')
})

it.each([
  { openState: 'loading', removed: false, subagent: null },
  { openState: 'open', removed: true, subagent: null },
  { openState: 'open', removed: false, subagent: { kind: 'one-shot' } },
])('does not expose writable goal controls for restricted sessions: %j', (snapshot) => {
  const { props } = fixture()
  // 子代理地址在本视图仅判定是否为空；完整地址协议由官方会话服务测试。
  const restricted = { ...props, useSession: (select: (value: object) => unknown) => select(snapshot) } as unknown as GoalProps
  render(<GoalDock {...restricted} />)
  for (const button of screen.getAllByRole('button')) expect(button).toHaveProperty('disabled', true)
})


it.each([en, zh])('requires confirmation and makes cancel and Escape side-effect free', async (locale) => {
  const { props, actions } = fixture()
  render(<GoalDock {...props} t={makeTranslate(locale)} />)
  await click(locale.clear)
  expect(actions.onClear).not.toHaveBeenCalled()
  const dialog = screen.getByRole('dialog', { name: locale.clear })
  expect(dialog.textContent).toContain('Initial objective')
  expect(dialog.textContent).toContain(locale.clearHint)
  await click(locale.cancel)
  expect(screen.queryByRole('dialog')).toBeNull()
  await click(locale.clear)
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(actions.onClear).not.toHaveBeenCalled()
})

it('confirms the captured version rather than silently clearing a newly revised objective', async () => {
  const { props, actions } = fixture()
  const view = render(<GoalDock {...props} />)
  await click(en.clear)
  const newer = { ...goal(), goal: { ...goal().goal, revision: 2, objective: 'Changed elsewhere' } }
  view.rerender(<GoalDock {...props} useProjection={() => newer} />)
  expect(screen.getByRole('dialog').textContent).toContain('Initial objective')
  await click(en.confirmClear)
  expect(actions.onClear).toHaveBeenCalledExactlyOnceWith({ id: 'goal-a', revision: 1 })
})

it('drops an unconfirmed clear on session or goal replacement and disables it offline', async () => {
  const { props, actions } = fixture()
  const view = render(<GoalDock {...props} />)
  await click(en.clear)
  view.rerender(<GoalDock {...props} useGoalConnected={select => select(false)} />)
  expect(screen.getByRole('button', { name: en.confirmClear })).toHaveProperty('disabled', true)
  await click(en.confirmClear)
  expect(actions.onClear).not.toHaveBeenCalled()
  view.rerender(<GoalDock {...props} sessionId={'session-b' as GoalProps['sessionId']} />)
  expect(screen.queryByRole('dialog')).toBeNull()
  await click(en.clear)
  const other = fixture({ ...goal(), goal: { ...goal().goal, id: 'goal-b' as GoalView['id'] } })
  view.rerender(<GoalDock {...other.props} sessionId={'session-b' as GoalProps['sessionId']} />)
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(actions.onClear).not.toHaveBeenCalled()
})


it('pauses only the explicitly refreshed revision after a non-edit conflict', async () => {
  const { props } = fixture()
  const onPause = vi.fn<GoalProps['onPause']>().mockResolvedValueOnce({ ok: false, error: new RemoteError('GOAL_STALE_REVISION', 'Conflict', {}) }).mockResolvedValue(success)
  const latest: GoalView = { ...goal().goal, revision: 3, objective: 'Updated remotely', createdAt: 10, updatedAt: 30, roundsStarted: 1, activation: 'armed' }
  render(<GoalDock {...props} onPause={onPause} onRefresh={async () => ({ ok: true, value: latest })} />)
  await click(en.pause)
  await click(en.refresh)
  expect(screen.getByText('Latest objective: Updated remotely')).toBeTruthy()
  expect(onPause).toHaveBeenCalledTimes(1)
  await click(en.pause)
  expect(onPause).toHaveBeenLastCalledWith({ id: 'goal-a', revision: 3 })
})
