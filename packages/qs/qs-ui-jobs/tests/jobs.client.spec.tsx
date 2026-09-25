// @vitest-environment jsdom
/** 作业显示依赖真实字段；局部快照只用于穷举显示分支。 */
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionJob } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionControlSnapshot, SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import { Jobs } from '../src/client/Jobs.tsx'
import type { JobsProps } from '../src/client/contract.ts'
import { zh, en } from '../src/client/locales.ts'

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })
const START = 1_700_000_000_000
function job(over: Partial<SessionJob> = {}): SessionJob {
  return { id: 'job-a' as SessionJob['id'], kind: 'shell', label: 'build', status: 'running', startedAt: START, ...over }
}
function props(jobs?: readonly SessionJob[], phase: SessionControlSnapshot['phase'] = 'ready'): JobsProps {
  const state = { jobsBySession: jobs === undefined ? {} : { a: jobs } } as SessionListState
  const control: SessionControlSnapshot = { phase, baseline: phase === 'loading' ? 0 : 1 }
  // 会话座席其余能力不被此视图消费，聚焦测试只提供实际读面。
  return {
    sessionId: 'a', t: makeTranslate(zh), retry: vi.fn().mockResolvedValue(undefined),
    useSessions: <T,>(select: (value: SessionListState) => T) => select(state),
    useQsJobsControl: <T,>(select: (value: SessionControlSnapshot) => T) => select(control),
  } as unknown as JobsProps
}
function open() { fireEvent.click(screen.getByRole('button', { name: /^后台作业/ })) }

it('separates an empty baseline from loading, disconnection and terminal failure', async () => {
  const first = props(undefined, 'loading'), view = render(<Jobs {...first} />)
  expect(screen.getByRole('button', { name: zh.title })).toBeDefined()
  open()
  expect(screen.getByRole('status').textContent).toBe(zh.loading)
  expect(screen.queryByText(zh.empty)).toBeNull()
  for (const phase of ['reconnecting', 'failed', 'disposed'] as const) {
    const next = props([], phase)
    view.rerender(<Jobs {...next} />)
    expect(screen.getByRole('status').textContent).toBe(zh[phase])
    if (phase === 'failed') {
      vi.mocked(next.retry).mockRejectedValueOnce(new Error('private diagnostic'))
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh.retry })) })
      expect(next.retry).toHaveBeenCalledOnce()
      expect(view.container.textContent).not.toContain('private diagnostic')
    }
  }
  view.rerender(<Jobs {...props()} />)
  expect(screen.getByText(zh.empty)).toBeDefined()
})

it('renders five distinct states, optional details and times without fabricated results', () => {
  const jobs = (['running', 'stopping', 'completed', 'killed', 'failed'] as const).map((state, n) => job({
    id: String(n) as SessionJob['id'], status: state, kind: 'unknown-provider', label: '<img src=x>',
    ...(n > 1 ? { finishedAt: START + 1_000 } : {}), ...(n === 1 ? { detail: 'producer detail' } : {}),
  }))
  const view = render(<Jobs {...props(jobs)} />)
  open()
  for (const label of [zh.running, zh.stopping, zh.completed, zh.killed, zh.failedJob]) expect(screen.getByText(label)).toBeDefined()
  expect(screen.getAllByText(zh.noDetail)).toHaveLength(4)
  expect(screen.getByText('producer detail')).toBeDefined()
  expect(screen.getByText(zh.noResult)).toBeDefined()
  expect(view.container.querySelector('img')).toBeNull()
  expect(view.container.querySelectorAll('time')).toHaveLength(8)
  expect(screen.getAllByText(zh.unfinished)).toHaveLength(2)
  expect(view.container.querySelectorAll('a')).toHaveLength(0)
})

it('orders live work first and handles clock skew, missing end times, hours and minutes', () => {
  vi.useFakeTimers(); vi.setSystemTime(START + 1_000)
  const rows = [
    job({ id: 'h' as SessionJob['id'], label: 'hours', status: 'completed', finishedAt: START + 7_380_000 }),
    job({ id: 'm' as SessionJob['id'], label: 'minutes', status: 'failed', finishedAt: START + 125_000 }),
    job({ id: 'x' as SessionJob['id'], label: 'missing', status: 'killed' }),
    job({ id: 'y' as SessionJob['id'], label: 'missing-later', status: 'killed', startedAt: START + 2 }),
    job({ id: 's' as SessionJob['id'], label: 'skew', status: 'completed', startedAt: START + 5_000, finishedAt: START }),
    job({ id: 'b' as SessionJob['id'], label: 'later', startedAt: START + 500 }), job(),
  ]
  const view = render(<Jobs {...props(rows)} />)
  open()
  expect([...view.container.querySelectorAll('li')].map(e => e.getAttribute('data-qs-job'))).toEqual(['job-a', 'b', 'h', 'm', 'y', 'x', 's'])
  expect(screen.getByText('2小时3分')).toBeDefined()
  expect(screen.getByText('2分5秒')).toBeDefined()
  expect(screen.getAllByText('0秒').length).toBeGreaterThan(0)
  expect(screen.getAllByText(zh.unavailable)).toHaveLength(4)
  act(() => { vi.advanceTimersByTime(2_000) })
  expect(screen.getByText('3秒')).toBeDefined()
  view.rerender(<Jobs {...props(rows, 'reconnecting')} />)
  expect(screen.getAllByText(zh.stale)).toHaveLength(2)
  expect(vi.getTimerCount()).toBe(0)
  view.rerender(<Jobs {...props([])} />)
  expect(screen.getByText(zh.empty)).toBeDefined()
})

it('closes on return, Escape and outside press; session switches reset the popover', () => {
  vi.useFakeTimers(); vi.setSystemTime(START)
  const intervals = vi.spyOn(globalThis, 'setInterval'), cleared = vi.spyOn(globalThis, 'clearInterval')
  const view = render(<Jobs {...props([job()])} />)
  const trigger = screen.getByRole('button')
  fireEvent.keyDown(trigger, { key: 'Escape' })
  expect(vi.getTimerCount()).toBe(0)
  open(); fireEvent.keyDown(trigger, { key: 'ArrowDown' })
  expect(trigger.getAttribute('aria-expanded')).toBe('true')
  expect(vi.getTimerCount()).toBe(1)
  fireEvent.pointerDown(screen.getByRole('region'))
  expect(trigger.getAttribute('aria-expanded')).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: zh.return }))
  expect(document.activeElement).toBe(trigger)
  open(); fireEvent.keyDown(trigger, { key: 'Escape' })
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
  open(); fireEvent.pointerDown(document.body)
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
  open(); open()
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
  open()
  view.rerender(<Jobs {...props([job()])} sessionId={'b' as JobsProps['sessionId']} />)
  expect(screen.queryByRole('region')).toBeNull()
  expect(cleared).toHaveBeenCalledWith(intervals.mock.results.at(-1)?.value)
  view.rerender(<Jobs {...props([job()])} />); open()
  view.unmount()
  expect(cleared).toHaveBeenCalledWith(intervals.mock.results.at(-1)?.value)
  expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
})
