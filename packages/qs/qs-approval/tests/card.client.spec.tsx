// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ApprovalCard } from '../src/client/ApprovalCard.tsx'
import type { QsApprovalCardProps } from '../src/client/contract.ts'
import { zh } from '../src/client/locales.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('keeps a failed approval answer retryable and isolates the next request', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const answer = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
  const props = {
    matched: { key: 'first', toolName: 'pwsh', reason: 'permission', answer },
    useApprovalDetail: () => undefined, t: (key: keyof typeof zh) => zh[key],
  } as unknown as QsApprovalCardProps // Only request members read by the card are supplied.
  const view = render(<ApprovalCard {...props} />)
  expect(screen.getByRole('region', { name: zh['card.args'] }).tabIndex).toBe(0)
  fireEvent.click(screen.getByRole('button', { name: zh['card.allow'] }))
  await screen.findByRole('alert')
  fireEvent.click(screen.getByRole('button', { name: zh['card.retry'] }))
  expect(answer).toHaveBeenCalledTimes(2)
  expect(answer).toHaveBeenLastCalledWith('allowed-once')
  const reject = vi.fn().mockResolvedValue(undefined)
  const next = { key: 'next', toolName: 'pwsh', reason: 'permission', answer: reject }
  view.rerender(<ApprovalCard {...props} matched={next as unknown as QsApprovalCardProps['matched']} />)
  expect(screen.queryByRole('alert')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: zh['card.reject'] }))
  expect(reject).toHaveBeenCalledExactlyOnceWith('rejected')
})

/** 审批使用 callId 对应参数，拒绝失败后重试必须仍然发送拒绝载荷。 */
it('索引解析真实参数并保留拒绝重试结果', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const answer = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
  const call = { callId: 'call', name: 'pwsh', argsRaw: '{"script":"echo ok"}' }
  const props = {
    matched: { key: 'request', callId: 'call', toolName: 'fallback', answer },
    useApprovalDetail: select => select(new Map([['call', call]])), t: (key: keyof typeof zh) => zh[key],
  } as QsApprovalCardProps
  render(<ApprovalCard {...props} />)
  expect(screen.getByText(call.argsRaw)).toBeDefined()
  expect(screen.getByText('—')).toBeDefined()
  fireEvent.click(screen.getByRole('button', { name: zh['card.reject'] }))
  await screen.findByRole('alert')
  fireEvent.click(screen.getByRole('button', { name: zh['card.retry'] }))
  expect(answer.mock.calls).toEqual([['rejected'], ['rejected']])
})

/** 同一批 DOM 事件在禁用状态提交前，也只能答复一次。 */
it('连续审批事件只发送一次真实答案', async () => {
  const pending = Promise.withResolvers<undefined>()
  const answer = vi.fn(() => pending.promise)
  const props = {
    matched: { key: 'batched', toolName: 'pwsh', answer },
    useApprovalDetail: select => select(new Map()), t: (key: keyof typeof zh) => zh[key],
  } as QsApprovalCardProps
  render(<ApprovalCard {...props} />)
  const button = screen.getByRole('button', { name: zh['card.allow'] })
  act(() => { button.click(); button.click() })
  expect(answer).toHaveBeenCalledExactlyOnceWith('allowed-once')
  await act(async () => { pending.resolve(undefined); await pending.promise })
})
