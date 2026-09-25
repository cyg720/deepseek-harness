// @vitest-environment jsdom
/** 评价读取和撤回使用屏障，确保切换对象后迟到结果不能打开新表单。 */
import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { MessageId } from '@deepseek-ai/dsh-api-remotes/client'
import type { MessageFeedbackView, MessageFeedbackActionResult } from '@deepseek-ai/dsh-client-ui-message-feedback/client'
import { Actions, type ActionsProps } from '../src/client/Actions.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
function deferred() {
  let resolve!: (value: MessageFeedbackActionResult) => void
  const promise = new Promise<MessageFeedbackActionResult>((yes) => { resolve = yes })
  return { promise, resolve }
}
const good = { ok: true } as const
const bad = (code: string) => ({ ok: false, error: { code, message: code } } as const)
function fixture() {
  const view = createSnapshotStore<MessageFeedbackView>({ status: 'cold', items: new Map(), error: null })
  const ensure = vi.fn(async (): Promise<MessageFeedbackActionResult> => good)
  const retract = vi.fn(async (): Promise<MessageFeedbackActionResult> => good), openDialog = vi.fn()
  const props = { messageId: 'm1' as MessageId, ensure, retract, openDialog,
    current: (id: MessageId) => view.getSnapshot().items.get(id),
    useFeedback: <T,>(select: (value: MessageFeedbackView) => T) =>
      select(useSyncExternalStore(callback => view.subscribe(callback), () => view.getSnapshot())),
    t: (key: keyof typeof zh) => zh[key],
  } as unknown as ActionsProps
  return { ...render(<Actions {...props} />), props, view, ensure, retract, openDialog }
}
it('只读取一次初始状态，双击只开一个目标表单，取消不自动记录', async () => {
  const f = fixture(), load = deferred()
  fireEvent.pointerEnter(f.getByRole('button', { name: '好的回答' }))
  fireEvent.focus(f.getByRole('button', { name: '有问题的回答' }))
  expect(f.ensure).toHaveBeenCalledOnce()
  f.ensure.mockReturnValue(load.promise)
  const button = f.getByRole('button', { name: '好的回答' })
  act(() => { button.click(); button.click() })
  expect(f.ensure).toHaveBeenCalledTimes(2)
  expect((button as HTMLButtonElement).disabled).toBe(true)
  await act(async () => { load.resolve(good); await load.promise })
  expect(f.openDialog).toHaveBeenCalledExactlyOnceWith('m1', 'positive')
  expect(f.retract).not.toHaveBeenCalled()
  await act(async () => { fireEvent.click(f.getByRole('button', { name: '有问题的回答' })) })
  expect(f.openDialog).toHaveBeenLastCalledWith('m1', 'negative')
})
it('加载失败可再次点击恢复，已有评价撤回冲突不改为新增评价', async () => {
  const f = fixture()
  act(() => { f.view.set({ status: 'error', items: new Map(), error: 'offline' }) })
  expect(f.getByRole('status').textContent).toBe(zh['error.load'])
  f.ensure.mockResolvedValueOnce(bad('offline'))
  await act(async () => { fireEvent.click(f.getByRole('button', { name: '好的回答' })) })
  expect(f.openDialog).not.toHaveBeenCalled()
  act(() => { f.view.set({ status: 'ready', error: null, items: new Map([['m1' as MessageId, { rating: 'positive' } as never]]) }) })
  f.retract.mockResolvedValueOnce(bad('version-conflict'))
  await act(async () => { fireEvent.click(f.getByRole('button', { name: '撤回赞' })) })
  expect(f.retract).toHaveBeenCalledExactlyOnceWith('m1', 'positive')
  expect(f.getByRole('status').textContent).toBe(zh['error.conflict'])
  expect(f.openDialog).not.toHaveBeenCalled()
  f.retract.mockResolvedValueOnce(bad('offline'))
  await act(async () => { fireEvent.click(f.getByRole('button', { name: '撤回赞' })) })
  expect(f.getByRole('status').textContent).toBe(zh['error.generic'])
  act(() => { f.view.set({ status: 'ready', error: null, items: new Map([['m1' as MessageId, { rating: 'negative' } as never]]) }) })
  await act(async () => { fireEvent.click(f.getByRole('button', { name: '撤回踩' })) })
  expect(f.retract).toHaveBeenLastCalledWith('m1', 'negative')
  expect(f.queryByRole('status')).toBeNull()
})
it('加载过程中切换消息或撤回过程中卸载，不更新新视图', async () => {
  const f = fixture(), loading = deferred(), retracting = deferred()
  f.ensure.mockReturnValueOnce(loading.promise)
  fireEvent.click(f.getByRole('button', { name: '好的回答' }))
  f.rerender(<Actions {...f.props} messageId={'m2' as MessageId} />)
  await act(async () => { loading.resolve(good); await loading.promise })
  expect(f.openDialog).not.toHaveBeenCalled()
  expect((f.getByRole('button', { name: '好的回答' }) as HTMLButtonElement).disabled).toBe(false)
  act(() => { f.view.set({ status: 'ready', error: null, items: new Map([['m2' as MessageId, { rating: 'positive' } as never]]) }) })
  f.retract.mockReturnValueOnce(retracting.promise)
  await act(async () => { fireEvent.click(f.getByRole('button', { name: '撤回赞' })) })
  f.unmount()
  await act(async () => { retracting.resolve(bad('offline')); await retracting.promise })
  expect(f.openDialog).not.toHaveBeenCalled()
})
