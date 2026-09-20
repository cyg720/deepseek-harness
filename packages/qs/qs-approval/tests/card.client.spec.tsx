// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
