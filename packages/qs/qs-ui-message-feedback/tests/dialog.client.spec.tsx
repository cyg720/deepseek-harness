// @vitest-environment jsdom
/** 表单测试直接使用官方控制器，载荷断言覆盖分类、修剪文本和消息身份。 */
import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { FeedbackDialogController } from '@deepseek-ai/dsh-client-ui-message-feedback/src/client/dialog.ts'
import type { FeedbackDialogState, MessageFeedbackActionResult } from '@deepseek-ai/dsh-client-ui-message-feedback/client'
import type { MessageId } from '@deepseek-ai/dsh-api-remotes/client'
import { Feedback, type FeedbackProps } from '../src/client/Feedback.tsx'
import { zh } from '../src/client/locales.ts'

const dialogMethods = new Map(['showModal', 'close'].map(name => [name, Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name)]))
beforeEach(() => {
  for (const name of dialogMethods.keys()) Object.defineProperty(HTMLDialogElement.prototype, name, {
    configurable: true, value: function (this: HTMLDialogElement) { this.toggleAttribute('open', name === 'showModal') },
  })
})
afterEach(() => {
  cleanup(); vi.restoreAllMocks()
  for (const [name, descriptor] of dialogMethods) {
    if (descriptor === undefined) Reflect.deleteProperty(HTMLDialogElement.prototype, name)
    else Object.defineProperty(HTMLDialogElement.prototype, name, descriptor)
  }
})
function fixture() {
  const send = vi.fn(async (): Promise<MessageFeedbackActionResult> => ({ ok: true }))
  const controller = new FeedbackDialogController(send), release = vi.fn()
  const props = { sessionId: 's1',
    useDialog: <T,>(select: (value: FeedbackDialogState) => T) =>
      select(useSyncExternalStore(callback => controller.state.subscribe(callback), () => controller.state.getSnapshot())),
    edit: controller.edit.bind(controller), submit: controller.submitDraft.bind(controller), dismiss: controller.dismiss.bind(controller),
    dismissFailure: controller.dismissFailure.bind(controller), dismissToast: controller.dismissToast.bind(controller),
    acquireFreeze: vi.fn(() => release), t: (key: keyof typeof zh) => zh[key],
  } as unknown as FeedbackProps
  return { ...render(<Feedback {...props} />), props, controller, send, release }
}
it('明确消息对象，分类可取消，真实载荷只提交当前对象与修剪文本', async () => {
  const f = fixture()
  act(() => { f.controller.open({ kind: 'message', messageId: 'm1' as MessageId, rating: 'negative' }) })
  expect(f.getByRole('dialog').textContent).toContain('反馈对象：助手消息 · s1m1')
  expect(f.props.acquireFreeze).toHaveBeenCalledWith('confirmation')
  const category = f.getByRole('button', { name: '任务结果' })
  fireEvent.click(category); fireEvent.click(category)
  expect(category.getAttribute('aria-pressed')).toBe('false')
  fireEvent.click(category)
  fireEvent.change(f.getByRole('textbox'), { target: { value: '  <script>plain text</script>  ' } })
  await act(async () => { fireEvent.click(f.getByRole('button', { name: '提交' })) })
  expect(f.send).toHaveBeenCalledExactlyOnceWith({ kind: 'message', messageId: 'm1', rating: 'negative' }, { category: 'task-result', text: '<script>plain text</script>' })
  expect(f.queryByRole('dialog')).toBeNull()
  expect(f.getByRole('status').textContent).toContain('反馈已记录')
  fireEvent.click(f.getByRole('button', { name: '关闭提示' }))
  expect(f.queryByRole('status')).toBeNull()
  expect(f.release).toHaveBeenCalledOnce()
})

it('原生 Escape 取消丢弃草稿且不写入反馈', () => {
  const f = fixture()
  act(() => { f.controller.open({ kind: 'session' }) })
  fireEvent.change(f.getByRole('textbox'), { target: { value: 'not submitted' } })
  fireEvent(f.getByRole('dialog'), new Event('cancel', { bubbles: true, cancelable: true }))
  expect(f.queryByRole('dialog')).toBeNull()
  expect(f.send).not.toHaveBeenCalled()
  expect(f.controller.state.getSnapshot().text).toBe('')
})
it.each(['version-conflict', 'note-too-large', 'target-not-found', 'session-not-found', 'offline'])('失败 %s 保留草稿并可重新提交', async (code) => {
  const f = fixture()
  act(() => { f.controller.open({ kind: 'session' }) })
  expect(f.getByRole('dialog').textContent).toContain('反馈对象：当前会话 · s1')
  fireEvent.change(f.getByRole('textbox'), { target: { value: 'saved draft' } })
  f.send.mockResolvedValueOnce({ ok: false, error: { code, message: code } })
  await act(async () => { fireEvent.click(f.getByRole('button', { name: '提交' })) })
  expect((f.getByRole('textbox') as HTMLTextAreaElement).value).toBe('saved draft')
  expect(f.getByRole('alert')).toBeDefined()
  fireEvent.click(f.getByRole('button', { name: '关闭提示' }))
  expect(f.queryByRole('alert')).toBeNull()
  await act(async () => { fireEvent.click(f.getByRole('button', { name: '提交' })) })
  expect(f.send).toHaveBeenLastCalledWith({ kind: 'session' }, { text: 'saved draft' })
})
it('提交中禁止重复，关闭不会宣称取消业务，迟到结果不覆盖重新打开的草稿', async () => {
  const f = fixture(); let resolve!: (value: MessageFeedbackActionResult) => void
  const sending = new Promise<MessageFeedbackActionResult>((yes) => { resolve = yes })
  f.send.mockReturnValueOnce(sending)
  act(() => { f.controller.open({ kind: 'session' }) })
  fireEvent.click(f.getByRole('button', { name: '提交' }))
  expect((f.getByRole('button', { name: '提交中…' }) as HTMLButtonElement).disabled).toBe(true)
  expect((f.getByRole('textbox') as HTMLTextAreaElement).readOnly).toBe(true)
  expect(f.getByRole('status').textContent).toBe(zh.closeInFlight)
  fireEvent.click(f.getAllByRole('button', { name: '取消' }).at(-1)!)
  act(() => { f.controller.open({ kind: 'message', messageId: 'new' as MessageId, rating: 'positive' }) })
  fireEvent.change(f.getByRole('textbox'), { target: { value: 'new draft' } })
  await act(async () => { resolve({ ok: true }); await sending })
  expect((f.getByRole('textbox') as HTMLTextAreaElement).value).toBe('new draft')
  expect(f.getByRole('dialog').textContent).toContain('new')
  expect(f.send).toHaveBeenCalledOnce()
  f.unmount()
  expect(f.controller.state.getSnapshot().toast).toBe(0)
  expect(f.controller.state.getSnapshot().text).toBe('new draft')
})
