// @vitest-environment jsdom
/** Composer lifecycle regressions with a deferred Host creation response. */
import { useLayoutEffect, useSyncExternalStore, type ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { QsSendPreparation, type QsSendPreparationEntry } from '../src/client/preparation.ts'
import { Composer } from '../src/client/Composer.tsx'
import type { QsComposerProps, QsComposerSnapshot, QsCommandOverlayOwner, QsCommandInputBridge } from '../src/client/contract.ts'
import { zh } from '../src/client/locales.ts'
import { sessionSnapshot } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { ComposerHost, type QsComposerHostProps } from '../src/client/ComposerHost.tsx'
import type { ChainRenderOpts } from '@deepseek-ai/dsh-client-ui-slots'

afterEach(cleanup)

it('队列编辑在途时不接受移除或重复编辑', async () => {
  const f = fixture(), pending = Promise.withResolvers<boolean>()
  const edit = vi.fn(() => pending.promise), remove = vi.fn()
  const props = { ...f.props, sessionId: 'queue-session', editQueueItem: edit, removeQueueItem: remove,
    useQsQueue: () => [{ id: 'pending-item', text: 'original', editable: true }],
  } as unknown as QsComposerProps
  render(<Composer {...props} />)
  const row = screen.getByRole('textbox', { name: zh['input.queueEdit'] })
  try {
    fireEvent.change(row, { target: { value: 'changed' } }); fireEvent.blur(row)
    // 与官方队列一致，在途状态锁住同一轮操作，不发出互相竞争的写请求。
    const button = screen.getByRole('button', { name: zh['input.queueRemove'] }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(button); fireEvent.blur(row)
    expect(edit).toHaveBeenCalledOnce(); expect(remove).not.toHaveBeenCalled()
  } finally { await act(async () => { pending.resolve(true) }) }
})

it('旧队列实例的迟到失败不锁住或污染新实例', async () => {
  const pending = Promise.withResolvers<boolean>(), f = fixture()
  const queue = () => [{ id: 'same-item', text: 'original', editable: true }]
  const original = { ...f.props, sessionId: 'old-session', useQsQueue: queue, editQueueItem: () => pending.promise } as unknown as QsComposerProps
  const old = render(<Composer {...original} />)
  fireEvent.change(screen.getByRole('textbox', { name: zh['input.queueEdit'] }), { target: { value: 'old edit' } })
  fireEvent.blur(screen.getByRole('textbox', { name: zh['input.queueEdit'] }))
  // session-maybe 在不同会话间重建呈现实例；不以同实例改 props 模拟官方不存在的生命周期。
  old.unmount()
  const remove = vi.fn().mockResolvedValue(true)
  render(<Composer {...original} sessionId={'new-session' as SessionId} removeQueueItem={remove} />)
  await act(async () => { pending.resolve(false) })
  expect(screen.queryByRole('alert')).toBeNull()
  const button = screen.getByRole('button', { name: zh['input.queueRemove'] }) as HTMLButtonElement
  expect(button.disabled).toBe(false)
  fireEvent.click(button)
  await waitFor(() => { expect(remove).toHaveBeenCalledExactlyOnceWith('same-item') })
  expect(screen.queryByRole('alert')).toBeNull()
})

function fixture() {
  let state: QsComposerSnapshot = { frozen: false, unownedDraft: '' }
  const listeners = new Set<() => void>()
  const publish = (next: QsComposerSnapshot) => { state = next; for (const listener of listeners) listener() }
  const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
  let settle: (id: string | undefined) => void = () => {}
  const createSession = vi.fn((_id: string, _signal: AbortSignal) => new Promise<string | undefined>((resolve) => { settle = resolve }))
  const setFrozen = vi.fn((reason: 'sending' | undefined) => { publish({ ...state, frozen: reason !== undefined, freezeReason: reason }) })
  const rows: readonly never[] = []
  const props = {
    t: (key: keyof typeof zh) => zh[key],
    renderSlot: () => null,
    useQsComposer: (select: (value: QsComposerSnapshot) => unknown) => select(useSyncExternalStore(subscribe, () => state)),
    useQsQueue: (select: (value: readonly never[]) => unknown) => select(rows),
    useProjection: () => undefined, useQsSubmitMode: () => 'queue',
    useInput: () => undefined, useSession: () => undefined,
    useSessionPendingInteraction: () => undefined,
    useQsConnected: () => true, useQsBlocked: () => undefined, useQsPreparation: () => undefined,
    useQsNotice: () => undefined, useQsModel: () => undefined,
    loadModel: () => {}, stop: vi.fn(), submitGesture: vi.fn(),
    reserveSessionId: () => 'reserved-session', createSession,
    setUnownedDraft: (text: string) => { publish({ ...state, unownedDraft: text }) }, setFrozen,
    removeQueueItem: vi.fn(), steerQueueItem: vi.fn(), editQueueItem: vi.fn(),
  } as unknown as QsComposerProps // Renderer seats are absent in the no-session fixture.
  return { props, createSession, setFrozen, settle: (id: string | undefined) => { settle(id) } }
}

it('delegates current session facts and releases the editor lease during a business takeover', () => {
  const f = fixture()
  const sid = 'child-session' as SessionId
  const snapshot = sessionSnapshot(sid)
  const release = vi.fn()
  const acquire = vi.fn(() => release)
  let elected = false
  const renderSlotChain = vi.fn((_name: string, _owner: object, options?: ChainRenderOpts): ReactNode =>
    elected && options?.fallbackOnly !== true ? <p role="status">Read-only child history</p> : options?.fallback)
  const props: QsComposerHostProps = {
    ...f.props, __renders: undefined, sessionId: sid, acquireTriggerConsumer: acquire, renderSlotChain,
    useSession: select => select(snapshot), useSessionPendingInteraction: select => select(new Map()),
  }
  const view = render(<ComposerHost {...props} />)
  expect(screen.getByRole('textbox')).toBeTruthy()
  expect(renderSlotChain).toHaveBeenLastCalledWith('qs.composer.takeover', {
    sessionId: sid, session: snapshot, pendingInteraction: undefined,
  }, expect.objectContaining({ fallbackOnly: false }))
  expect(acquire).toHaveBeenCalledTimes(1)
  elected = true
  view.rerender(<ComposerHost {...props} />)
  expect(screen.queryByRole('textbox')).toBeNull()
  expect(screen.getByRole('status').textContent).toBe('Read-only child history')
  expect(release).toHaveBeenCalledTimes(1)
  elected = false
  view.rerender(<ComposerHost {...props} />)
  expect(acquire).toHaveBeenCalledTimes(2)
  view.unmount()
  expect(release).toHaveBeenCalledTimes(2)
})

it('keeps the unbound editor without dispatching a strict session takeover', () => {
  const f = fixture()
  const renderSlotChain = vi.fn((_name: string, _owner: object, options?: ChainRenderOpts): ReactNode => options?.fallback)
  render(<ComposerHost {...f.props} __renders={undefined} renderSlotChain={renderSlotChain}
    useSessionPendingInteraction={select => select(new Map())} />)
  expect(screen.getByRole('textbox')).toBeTruthy()
  expect(renderSlotChain).toHaveBeenLastCalledWith('qs.composer.takeover', {
    sessionId: undefined, session: undefined, pendingInteraction: undefined,
  }, expect.objectContaining({ fallbackOnly: true }))
})

it('keeps the draft and reserved identity after creation failure', async () => {
  const f = fixture()
  render(<Composer {...f.props} />)
  fireEvent.change(screen.getByRole<HTMLTextAreaElement>('textbox'), { target: { value: 'retained draft' } })
  fireEvent.click(screen.getByRole('button', { name: zh['input.send'] }))
  await act(async () => { f.settle(undefined) })
  expect(screen.getByRole('alert').textContent).toBe(zh['input.createFailed'])
  expect((screen.getByRole<HTMLTextAreaElement>('textbox')).value).toBe('retained draft')
  fireEvent.click(screen.getByRole('button', { name: zh['input.send'] }))
  expect(f.createSession.mock.calls.map(call => call[0])).toEqual(['reserved-session', 'reserved-session'])
})

it('aborts creation when cancelled and ignores its late response', async () => {
  const f = fixture()
  render(<Composer {...f.props} />)
  fireEvent.change(screen.getByRole<HTMLTextAreaElement>('textbox'), { target: { value: 'cancel me' } })
  fireEvent.click(screen.getByRole('button', { name: zh['input.send'] }))
  const signal = f.createSession.mock.calls[0]?.[1]
  fireEvent.click(screen.getByRole('button', { name: zh['input.cancel'] }))
  expect(signal?.aborted).toBe(true)
  await act(async () => { f.settle('reserved-session') })
  expect((screen.getByRole<HTMLTextAreaElement>('textbox')).readOnly).toBe(false)
  expect((screen.getByRole<HTMLTextAreaElement>('textbox')).value).toBe('cancel me')
})

it('unmount aborts creation and clears the shell freeze', async () => {
  const f = fixture()
  const view = render(<Composer {...f.props} />)
  fireEvent.change(screen.getByRole<HTMLTextAreaElement>('textbox'), { target: { value: 'keep on logout' } })
  fireEvent.click(screen.getByRole('button', { name: zh['input.send'] }))
  view.unmount()
  expect(f.createSession.mock.calls[0]?.[1].aborted).toBe(true)
  expect(f.setFrozen).toHaveBeenLastCalledWith(undefined)
  await act(async () => { f.settle(undefined) })
  render(<Composer {...f.props} />)
  await waitFor(() => { expect((screen.getByRole<HTMLTextAreaElement>('textbox')).readOnly).toBe(false) })
})

it('blocks disconnected submission without making the draft readonly', () => {
  const f = fixture()
  render(<Composer {...f.props} useQsConnected={() => false as never} />)
  fireEvent.change(screen.getByRole<HTMLTextAreaElement>('textbox'), { target: { value: 'offline draft' } })
  fireEvent.keyDown(screen.getByRole<HTMLTextAreaElement>('textbox'), { key: 'Enter' })
  expect(f.createSession).not.toHaveBeenCalled()
  expect((screen.getByRole<HTMLTextAreaElement>('textbox')).readOnly).toBe(false)
  expect(screen.getByRole('status').textContent).toBe(zh['input.disconnected'])
})

it('keeps the first draft editable and requires another click after a blocked handoff recovers', async () => {
  const f = fixture()
  const view = render(<Composer {...f.props} />)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'review before sending' } })
  fireEvent.click(screen.getByRole('button', { name: zh['input.send'] }))
  const setDraft = vi.fn()
  const submit = vi.fn()
  const inputActions = { setDraft, submit } as unknown as NonNullable<QsComposerProps['inputActions']>
  const bound: QsComposerProps = { ...f.props, sessionId: 'reserved-session' as QsComposerProps['sessionId'], inputActions }
  view.rerender(<Composer {...bound} useQsConnected={() => false as never} />)
  await act(async () => { f.settle('reserved-session') })
  view.rerender(<Composer {...bound} />)
  expect(submit).not.toHaveBeenCalled()
  expect(setDraft).toHaveBeenCalledWith('review before sending')
  expect(screen.getByRole<HTMLTextAreaElement>('textbox').readOnly).toBe(false)
})

it.each([true, false])('首次交接等待准备完成，成功自动提交，失败保留草稿：%s', async (succeeds) => {
  const f = fixture(), mounted = render(<Composer {...f.props} />)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'prepared first message' } })
  fireEvent.click(screen.getByRole('button', { name: zh['input.send'] }))
  const setDraft = vi.fn(), submit = vi.fn()
  const bound = { ...f.props, sessionId: 'reserved-session', inputActions: { setDraft, submit } } as unknown as QsComposerProps
  const preparing = { sessionId: bound.sessionId!, pending: true, reason: 'applying preset' }
  mounted.rerender(<Composer {...bound} useQsPreparation={select => select(preparing)} />)
  await act(async () => { f.settle('reserved-session') })
  expect(submit).not.toHaveBeenCalled()
  expect(screen.getByText('applying preset')).toBeTruthy()
  if (!succeeds) mounted.rerender(<Composer {...bound} useQsPreparation={select => select({ ...preparing, pending: false, reason: 'preset failed' })} />)
  mounted.rerender(<Composer {...bound} />)
  expect(setDraft).toHaveBeenCalledWith('prepared first message')
  expect(submit).toHaveBeenCalledTimes(succeeds ? 1 : 0)
})

/** 有会话时使用真实选择器形态，验证输入、队列和错误提示的业务优先级。 */
it('绑定会话可编辑草稿、回车发送、停止并处理队列失败', async () => {
  const f = fixture()
  const setDraft = vi.fn(), submit = vi.fn(), stop = vi.fn()
  const editQueueItem = vi.fn().mockResolvedValue(false)
  const removeQueueItem = vi.fn().mockRejectedValue(new Error('offline'))
  const steerQueueItem = vi.fn().mockResolvedValue(true)
  const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
  const props = {
    ...f.props, sessionId: 'session', stop, editQueueItem, removeQueueItem, steerQueueItem,
    submitGesture: submit, inputActions: { setDraft, submit },
    useInput: (select: (value: object) => unknown) => select({ occurrences: [], attachmentIds: [], draft: 'existing draft', phase: 'idle' }),
    useSession: (select: (value: object) => unknown) => select({ running: true }),
    useSessionPendingInteraction: (select: (value: Map<string, never>) => unknown) => select(new Map<string, never>()),
    useQsBlocked: (select: (value: undefined) => unknown) => select(undefined),
    useQsConnected: (select: (value: boolean) => unknown) => select(true),
    useQsNotice: (select: (value: undefined) => unknown) => select(undefined),
    useQsModel: (select: (value: string) => unknown) => select('deepseek-test'),
    useQsQueue: (select: (value: object[]) => unknown) => select([{ id: 'item', text: 'queued text', placement: 'queued', editable: true }]),
  } as unknown as QsComposerProps
  try {
    render(<Composer {...props} />)
    const input = screen.getByRole('textbox', { name: zh['input.placeholder'] })
    fireEvent.change(input, { target: { value: 'new draft' } })
    expect(setDraft).toHaveBeenLastCalledWith('new draft')
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(submit).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(submit).toHaveBeenCalledOnce()
    expect(setDraft).toHaveBeenLastCalledWith('existing draft')
    // 浏览器长按产生的重复按键不能把同一草稿连续加入队列。
    fireEvent.keyDown(input, { key: 'Enter', repeat: true })
    expect(submit).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: zh['input.suggestion1'] }))
    expect(setDraft).toHaveBeenLastCalledWith(zh['input.suggestion1'])
    fireEvent.click(screen.getByRole('button', { name: zh['input.stop'] }))
    expect(stop).toHaveBeenCalledOnce()
    const row = screen.getByRole('textbox', { name: zh['input.queueEdit'] })
    fireEvent.blur(row)
    fireEvent.change(row, { target: { value: ' ' } }); fireEvent.blur(row)
    expect(editQueueItem).not.toHaveBeenCalled()
    fireEvent.change(row, { target: { value: 'edited' } }); fireEvent.blur(row)
    await screen.findByRole('alert')
    expect(editQueueItem).toHaveBeenCalledWith('item', 'edited')
    expect(screen.getByRole('alert').textContent).toBe(zh['input.queueFailed'])
    fireEvent.click(screen.getByRole('button', { name: zh['input.queueSteer'] }))
    await waitFor(() => { expect(screen.queryByRole('alert')).toBeNull() })
    expect(steerQueueItem).toHaveBeenCalledWith('item')
    fireEvent.click(screen.getByRole('button', { name: zh['input.queueRemove'] }))
    await screen.findByRole('alert')
    expect(removeQueueItem).toHaveBeenCalledWith('item')
    expect(screen.getByRole('textbox', { name: zh['input.queueEdit'] })).toBe(row)
  } finally { errorLog.mockRestore() }
})
it.each(['notice', 'prompt', 'agent', 'pending', 'adjudicating', 'submitting'])('会话状态 %s 显示对应提示并控制发送', (mode) => {
  const f = fixture(), submit = vi.fn()
  const props = {
    ...f.props, sessionId: 'session', submitGesture: submit, inputActions: { setDraft: vi.fn(), submit },
    useInput: (select: (value: object) => unknown) => select({ occurrences: [], attachmentIds: [], draft: 'draft', phase: mode }),
    useSession: (select: (value: object) => unknown) => select({ running: false, ...(mode === 'prompt' ? { promptError: { error: { message: 'prompt error' } } } : {}), ...(mode === 'agent' ? { lastAgentError: 'agent error' } : {}) }),
    useSessionPendingInteraction: (select: (value: Map<string, object>) => unknown) => select(mode === 'pending' ? new Map<string, object>([['session', {}]]) : new Map<string, object>()),
    useQsNotice: (select: (value: string | undefined) => unknown) => select(mode === 'notice' ? 'notice error' : undefined),
  } as unknown as QsComposerProps
  render(<Composer {...props} />)
  if (['notice', 'prompt', 'agent'].includes(mode)) expect(screen.getByRole('alert').textContent).toBe(mode + ' error')
  else {
    expect(screen.getByRole<HTMLButtonElement>('button', { name: zh['input.send'] }).disabled).toBe(true)
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    expect(submit).not.toHaveBeenCalled()
  }
})
it('首次发送在目标输入机就绪后只交接一次并清空未归属草稿', async () => {
  const f = fixture(), setDraft = vi.fn(), submit = vi.fn()
  const view = render(<Composer {...f.props} />)
  fireEvent.click(screen.getByRole('button', { name: zh['input.suggestion1'] }))
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
  const bound = { ...f.props, sessionId: 'reserved-session', inputActions: { setDraft, submit } } as unknown as QsComposerProps
  view.rerender(<Composer {...bound} />)
  await act(async () => { f.settle('reserved-session') })
  expect(setDraft).toHaveBeenCalledExactlyOnceWith(zh['input.suggestion1'])
  expect(submit).toHaveBeenCalledOnce()
  expect(f.setFrozen).toHaveBeenLastCalledWith(undefined)
  view.rerender(<Composer {...bound} />)
  expect(submit).toHaveBeenCalledOnce()
})

/** 首次交接失败、输入机仲裁和断线分别保留正确的草稿归属。 */
it('创建请求拒绝时显示可重试错误', async () => {
  const f = fixture(); f.createSession.mockRejectedValueOnce(new Error('offline'))
  render(<Composer {...f.props} useSessionPendingInteraction={select => select(new Map())} />)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'keep' } })
  fireEvent.click(screen.getByRole('button', { name: zh['input.send'] }))
  await screen.findByRole('alert')
  expect(screen.getByRole<HTMLTextAreaElement>('textbox').value).toBe('keep')
})
it('首次交接等待输入机仲裁完成，不重复提交', async () => {
  const f = fixture(), setDraft = vi.fn(), submit = vi.fn()
  const view = render(<Composer {...f.props} />)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'wait' } })
  fireEvent.click(screen.getByRole('button', { name: zh['input.send'] }))
  const bound = { ...f.props, sessionId: 'reserved-session', inputActions: { setDraft, submit } } as unknown as QsComposerProps
  view.rerender(<Composer {...bound} useInput={select => select({ occurrences: [], attachmentIds: [], phase: 'adjudicating', draft: '' } as never)} />)
  expect(submit).not.toHaveBeenCalled()
  view.rerender(<Composer {...bound} />)
  await act(async () => { f.settle('reserved-session') })
  expect(submit).toHaveBeenCalledOnce()
})
it('绑定尚未就绪时断线保留未归属草稿并取消在途交接', async () => {
  const f = fixture()
  const view = render(<Composer {...f.props} />)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'unowned' } })
  fireEvent.click(screen.getByRole('button', { name: zh['input.send'] }))
  view.rerender(<Composer {...f.props} useQsConnected={() => false as never} />)
  expect(f.createSession.mock.calls[0]?.[1].aborted).toBe(true)
  await act(async () => { f.settle(undefined) })
  expect(screen.getByRole<HTMLTextAreaElement>('textbox').value).toBe('unowned')
  expect(screen.queryByRole('alert')).toBeNull()
})
it('创建交接冻结但无本地创建操作时取消按钮不触发提交', () => {
  const f = fixture()
  render(<Composer {...f.props} useQsComposer={select => select({ frozen: true, unownedDraft: 'draft', freezeReason: 'sending' })} />)
  fireEvent.click(screen.getByRole('button', { name: zh['input.cancel'] }))
  expect(f.createSession).not.toHaveBeenCalled()
})

/** 创建返回之前，当前会话和输入动作必须都属于预分配目标。 */
it('交接等待目标会话及动作就绪，不向其他会话发送', async () => {
  const f = fixture(), setDraft = vi.fn(), submit = vi.fn()
  const view = render(<Composer {...f.props} />)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'target only' } })
  fireEvent.click(screen.getByRole('button', { name: zh['input.send'] }))
  const bound = { ...f.props, sessionId: 'other-session', inputActions: { setDraft, submit } } as unknown as QsComposerProps
  view.rerender(<Composer {...bound} />)
  expect(submit).not.toHaveBeenCalled()
  view.rerender(<Composer {...f.props} sessionId={'reserved-session' as QsComposerProps['sessionId']} />)
  expect(submit).not.toHaveBeenCalled()
  view.rerender(<Composer {...bound} sessionId={'reserved-session' as QsComposerProps['sessionId']} />)
  await act(async () => { f.settle('reserved-session') })
  expect(setDraft).toHaveBeenCalledExactlyOnceWith('target only')
  expect(submit).toHaveBeenCalledOnce()
})

// 真实输入字段保留引用身份，QS 不能用 textarea 内容替换结构化草稿。
it('结构化草稿在 QS 可见只读，点击发送不会提交或改写引用', () => {
  const f = fixture()
  const submit = vi.fn(), setDraft = vi.fn()
  const state = { phase: 'idle', draft: '@document', occurrences: [{ id: 'ref-a' }], attachmentIds: [] }
  const props = { ...f.props, sessionId: 'session', submitGesture: submit, inputActions: { submit, setDraft },
    useInput: (select: (input: typeof state) => unknown) => select(state),
  } as unknown as QsComposerProps
  render(<Composer {...props} />)
  expect(screen.getByRole('textbox')).toHaveProperty('readOnly', true)
  expect(screen.getByText(zh['input.structuredDraft'])).toBeDefined()
  fireEvent.click(screen.getByRole('button', { name: zh['input.suggestion1'] }))
  fireEvent.click(screen.getByRole('button', { name: zh['input.send'] }))
  expect(submit).not.toHaveBeenCalled()
  expect(setDraft).not.toHaveBeenCalled()
  expect(state.occurrences).toEqual([{ id: 'ref-a' }])
})


it('已认领的纯文本命令可补参数，提交仍交给官方输入机且 IME 不触发', () => {
  const f = fixture()
  const submit = vi.fn(), setDraft = vi.fn(), commandSubmit = vi.fn()
  const claim = { name: 'goal', token: '/goal ', submit: commandSubmit }
  const state = { phase: 'claimed', draft: '/goal improve tests', occurrences: [], attachmentIds: [], claim }
  const props = { ...f.props, sessionId: 'session', submitGesture: submit, inputActions: { submit, setDraft },
    useInput: (select: (input: typeof state) => unknown) => select(state),
  } as unknown as QsComposerProps
  render(<Composer {...props} />)
  const input = screen.getByRole('textbox')
  expect(input).toHaveProperty('readOnly', false)
  fireEvent.change(input, { target: { value: '/goal improve coverage' } })
  expect(setDraft).toHaveBeenLastCalledWith('/goal improve coverage')
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
  expect(submit).not.toHaveBeenCalled()
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(submit).toHaveBeenCalledOnce()
  expect(commandSubmit).not.toHaveBeenCalled()
  expect(state.claim).toBe(claim)
})


it('命令弹层冻结不会显示创建会话的取消按钮或发送中标签', () => {
  const f = fixture()
  const props = { ...f.props,
    useQsComposer: (select: (value: QsComposerSnapshot) => unknown) => select({ frozen: true, unownedDraft: 'draft', freezeReason: 'command' }),
  } as unknown as QsComposerProps
  render(<Composer {...props} />)
  expect(screen.queryByRole('button', { name: zh['input.cancel'] })).toBeNull()
  expect(screen.queryByRole('button', { name: zh['input.sending'] })).toBeNull()
  expect(screen.getByRole('button', { name: zh['input.send'] })).toHaveProperty('disabled', true)
})


it('候选菜单消费按键时不发送，组合输入与光标同步到同一桥，卸载解除绑定', () => {
  const f = fixture()
  const submit = vi.fn(), setDraft = vi.fn()
  const arbitrate = vi.fn<QsCommandInputBridge['arbitrate']>().mockReturnValue('consumed')
  const track = vi.fn(), space = vi.fn(() => true)
  const bridge = { arbitrate, track, space }
  function Binding({ owner }: { owner: QsCommandOverlayOwner }) {
    useLayoutEffect(() => {
      const releaseOld = owner.bindCommandInput(bridge)
      const releaseCurrent = owner.bindCommandInput({ ...bridge })
      // 旧实例迟到卸载不能移除替代实例的按键仲裁。
      releaseOld()
      return releaseCurrent
    }, [owner.bindCommandInput])
    return null
  }
  const state = { draft: '/goa', phase: 'plain', occurrences: [], attachmentIds: [] }
  const props = { ...f.props, sessionId: 'session', submitGesture: submit, inputActions: { setDraft, submit },
    useInput: (select: (value: typeof state) => unknown) => select(state),
    renderSlot: (name: string, owner: QsCommandOverlayOwner) => name === 'qs.composer.overlay' ? <Binding owner={owner} /> : null,
  } as unknown as QsComposerProps
  const view = render(<Composer {...props} />)
  const input = screen.getByRole<HTMLTextAreaElement>('textbox')
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(arbitrate).toHaveBeenCalledExactlyOnceWith('enter', false)
  expect(submit).not.toHaveBeenCalled()
  fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
  fireEvent.keyDown(input, { key: 'Enter', metaKey: true })
  expect(arbitrate).toHaveBeenCalledTimes(3)
  expect(submit).not.toHaveBeenCalled()
  fireEvent.keyDown(input, { key: ' ' })
  expect(space).toHaveBeenCalledOnce()
  fireEvent.compositionStart(input)
  expect(track).toHaveBeenLastCalledWith(input.selectionEnd, true)
  arbitrate.mockReturnValue('pass')
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(submit).not.toHaveBeenCalled()
  fireEvent.compositionEnd(input)
  fireEvent.select(input, { target: { selectionStart: 2, selectionEnd: 2 } })
  expect(track).toHaveBeenLastCalledWith(2, false)
  fireEvent.change(input, { target: { value: '/goal' } })
  expect(setDraft).toHaveBeenLastCalledWith('/goal')
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(submit).toHaveBeenCalledOnce()
  view.unmount()
})

it('disables offline-parent child input while retaining Stop and the existing draft', () => {
  const f = fixture(), sid = 'live-child' as SessionId
  let available: boolean | undefined = true
  const stop = vi.fn()
  const props: QsComposerProps = { ...f.props, sessionId: sid, stop,
    useSession: select => select({ ...sessionSnapshot(sid), running: true, subagent: {
      address: { parentSessionId: 'parent' as SessionId, childSessionId: sid, mode: 'continuable' }, ...(available === undefined ? {} : { parentAvailable: available }),
    } }),
  }
  const view = render(<Composer {...props} />)
  const input = screen.getByRole<HTMLTextAreaElement>('textbox')
  fireEvent.change(input, { target: { value: 'preserved child draft' } })
  available = false; view.rerender(<Composer {...props} />)
  expect(input.disabled).toBe(true)
  expect(input.value).toBe('preserved child draft')
  expect(screen.getByRole<HTMLButtonElement>('button', { name: zh['input.sendQueue'] }).disabled).toBe(true)
  available = undefined; view.rerender(<Composer {...props} />)
  expect(input.disabled).toBe(true)
  expect(screen.getByRole('status').textContent).toBe(zh['input.childParentRequired'])
  fireEvent.click(screen.getByRole('button', { name: zh['input.stop'] }))
  expect(stop).toHaveBeenCalledOnce()
  available = true; view.rerender(<Composer {...props} />)
  expect(input.disabled).toBe(false)
  expect(input.value).toBe('preserved child draft')
})

// 使用真实准备注册表，证明贡献卸载会取消第一次交接而不是自动发送。
it('准备插件卸载取消首次自动发送，重试准备成功后仍需用户明确发送', async () => {
  const ctx = new Context(), preparation = new QsSendPreparation(ctx)
  const f = fixture(), submit = vi.fn(), setDraft = vi.fn()
  const sessionId = 'reserved-session' as SessionId
  let value: QsSendPreparationEntry | undefined
  const listeners = new Set<() => void>()
  const source = { getSnapshot: () => value, subscribe: (listener: () => void) => {
    listeners.add(listener); return () => { listeners.delete(listener) }
  } }
  const face = preparation.forSession(sessionId)
  const useQsPreparation: QsComposerProps['useQsPreparation'] = select => select(useSyncExternalStore(listener => face.subscribe(listener), () => face.getSnapshot()))
  const remove = preparation.register('preset', source, 'preparation interrupted')
  const view = render(<Composer {...f.props} useQsPreparation={useQsPreparation} />)
  try {
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'retained original draft' } })
    fireEvent.click(screen.getByRole('button', { name: zh['input.send'] }))
    const bound: QsComposerProps = { ...f.props, sessionId, useQsPreparation,
      submitGesture: submit,
      inputActions: { submit, setDraft, addAttachments: () => false, removeAttachment: () => {}, pruneAttachments: () => {} },
      useInput: select => select({ draft: 'retained original draft', draftRev: 0, queue: [], occurrences: [], attachmentIds: [], phase: 'plain' }),
    }
    act(() => {
      value = { sessionId, pending: true, reason: 'working' }
      for (const listener of listeners) listener()
    })
    view.rerender(<Composer {...bound} />)
    await act(async () => { f.settle(sessionId) })
    expect(submit).not.toHaveBeenCalled()
    act(remove)
    expect(screen.getByRole('status').textContent).toBe('preparation interrupted')
    expect(setDraft).toHaveBeenLastCalledWith('retained original draft')
    expect(submit).not.toHaveBeenCalled()
    let release!: () => void
    act(() => {
      release = preparation.register('preset', source, 'preparation interrupted')
      value = undefined
      for (const listener of listeners) listener()
    })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: zh['input.send'] }).disabled).toBe(false)
    expect(submit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: zh['input.send'] }))
    expect(submit).toHaveBeenCalledOnce()
    act(release)
  } finally { view.unmount(); await ctx.fiber.dispose() }
})

// 手势通过显式动作传递，固定排队的兼容动作不能吞掉 Ctrl/Cmd 的意图。
it.each([
  [{}, 'enter'], [{ ctrlKey: true }, 'accelerated'], [{ metaKey: true }, 'accelerated'],
] as const)('发送按键 %j 传递 %s 手势', (modifiers, gesture) => {
  const f = fixture(), submitGesture = vi.fn(), legacySubmit = vi.fn(), setDraft = vi.fn()
  const props = {
    ...f.props, sessionId: 'session', submitGesture,
    inputActions: { setDraft, submit: legacySubmit },
    useInput: (select: (state: object) => unknown) => select({ occurrences: [], attachmentIds: [], draft: 'queued work', phase: 'idle' }),
  } as unknown as QsComposerProps
  render(<Composer {...props} />)
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', ...modifiers })
  expect(setDraft).toHaveBeenCalledExactlyOnceWith('queued work')
  expect(submitGesture).toHaveBeenCalledExactlyOnceWith(gesture)
  expect(legacySubmit).not.toHaveBeenCalled()
})

// 当前共享投递模式必须体现在可访问名称与鼠标提示，空闲仍是普通发送。
it('发送按钮随运行状态与共享模式更新提示', () => {
  const f = fixture()
  let running = true, mode: 'queue' | 'steer' = 'queue'
  const props = {
    ...f.props, useSession: (select: (state: object) => unknown) => select({ running }),
    useQsSubmitMode: (select: (value: typeof mode) => unknown) => select(mode),
  } as unknown as QsComposerProps
  const view = render(<Composer {...props} />)
  expect(screen.getByRole('button', { name: zh['input.sendQueue'] }).title).toBe(zh['input.sendQueue'])
  mode = 'steer'; view.rerender(<Composer {...props} />)
  expect(screen.getByRole('button', { name: zh['input.sendSteer'] }).title).toBe(zh['input.sendSteer'])
  running = false; view.rerender(<Composer {...props} />)
  expect(screen.getByRole('button', { name: zh['input.send'] }).title).toBe(zh['input.send'])
})

// 空内容快捷键不能创建新会话或绕过阻塞；仅向已绑定的忙碌会话传递整队意图。
it.each(['Enter', 'Control', 'Meta', 'blocked', 'idle', 'unbound'] as const)('空草稿队列手势 %s', (scenario) => {
  const f = fixture(), submitGesture = vi.fn()
  const props = {
    ...f.props, submitGesture,
    inputActions: scenario === 'unbound' ? undefined : { setDraft: vi.fn(), submit: vi.fn() },
    useInput: (select: (state: object) => unknown) => select({ draft: '', occurrences: [], attachmentIds: [], phase: 'idle' }),
    useSession: (select: (state: object) => unknown) => select({ running: scenario !== 'idle' }),
    useQsBlocked: () => scenario === 'blocked' ? 'blocked' : undefined,
  } as unknown as QsComposerProps
  render(<Composer {...props} />)
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', ctrlKey: scenario !== 'Enter' && scenario !== 'Meta', metaKey: scenario === 'Meta' })
  if (scenario === 'Control' || scenario === 'Meta') expect(submitGesture).toHaveBeenCalledExactlyOnceWith('accelerated')
  else expect(submitGesture).not.toHaveBeenCalled()
  expect(f.createSession).not.toHaveBeenCalled()
})
