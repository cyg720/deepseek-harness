// @vitest-environment jsdom
/** 显式文件动作使用持久坐标，预览不触发本机打开。 */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { PresentedHost, PresentedOpenPhase } from '@deepseek-ai/dsh-client-ui-deliverables/client'
import { Deliverables, type DeliverablesProps } from '../src/client/Deliverables.tsx'
import { PresentRow, type PresentProps } from '../src/client/PresentRow.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)
function fixture() {
  let host: PresentedHost | 'error' | null = { name: 'remote Host', available: true, fileManager: 'directory' }
  let states: Record<string, PresentedOpenPhase | undefined> = {}
  const props: DeliverablesProps = {
    matched: { produced: ['src/a.ts'], presented: [{ path: 'report.pdf', description: '<script>not markup</script>', seq: 9, index: 2 }] },
    sessionId: SessionId('fork-session'), t: makeTranslate(en), fileKey: (session, seq, index) => `${session}:${seq}:${index}`,
    openFile: vi.fn(), openPresented: vi.fn(async () => {}), reloadPresentedHost: vi.fn(async () => {}),
    usePresentedHost: select => select(host), usePresentedOpen: select => select(states),
  }
  return { props, host: (next: typeof host) => { host = next }, states: (next: typeof states) => { states = next } }
}
it('previews exact paths and sends native actions with the viewed session and durable original index', () => {
  const h = fixture(), view = render(<Deliverables {...h.props} />)
  fireEvent.click(screen.getByRole('button', { name: 'Preview report.pdf' }))
  expect(h.props.openFile).toHaveBeenCalledExactlyOnceWith('report.pdf')
  expect(h.props.openPresented).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: en.open }))
  fireEvent.click(screen.getByRole('button', { name: en.directory }))
  expect(h.props.openPresented).toHaveBeenNthCalledWith(1, SessionId('fork-session'), 9, 2, 'open')
  expect(h.props.openPresented).toHaveBeenNthCalledWith(2, SessionId('fork-session'), 9, 2, 'reveal')
  expect(view.container.querySelector('script')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Preview src/a.ts' }))
  expect(h.props.openFile).toHaveBeenLastCalledWith('src/a.ts')
})
it('keeps preview available while capabilities or pending native actions disable desktop gestures', () => {
  const h = fixture(), view = render(<Deliverables {...h.props} />)
  for (const host of [null, 'error', { name: 'headless', available: false, fileManager: null }] as const) {
    h.host(host); view.rerender(<Deliverables {...h.props} />)
    expect(screen.getByRole('button', { name: en.open }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Preview report.pdf' }).hasAttribute('disabled')).toBe(false)
  }
  h.host('error'); view.rerender(<Deliverables {...h.props} />)
  fireEvent.click(screen.getByRole('button', { name: en.retry }))
  expect(h.props.reloadPresentedHost).toHaveBeenCalledTimes(2)
  h.host({ name: 'desktop', available: true, fileManager: 'explorer' })
  for (const phase of ['opening', 'revealing', 'error', 'revealError', 'nativeUnavailable', 'opened', 'revealed'] as const) {
    h.states({ 'fork-session:9:2': phase }); view.rerender(<Deliverables {...h.props} />)
    expect(screen.getByRole('status').textContent).toBe(en[phase])
    expect(screen.getByRole('button', { name: en.open }).hasAttribute('disabled')).toBe(phase === 'opening' || phase === 'revealing')
  }
})
it('expands all declared files and does not request desktop metadata for changed paths alone', () => {
  const h = fixture()
  h.host(null)
  const files = Array.from({ length: 5 }, (_, index) => ({ path: `file-${index}`, seq: 12, index }))
  const view = render(<Deliverables {...h.props} matched={{ produced: [], presented: files }} />)
  expect(screen.queryByRole('button', { name: 'Preview file-4' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Show all 5 items' }))
  expect(screen.getByRole('button', { name: 'Preview file-4' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: en.collapse }))
  expect(screen.queryByRole('button', { name: 'Preview file-4' })).toBeNull()
  view.rerender(<Deliverables {...h.props} matched={{ produced: ['only.txt'], presented: [] }} />)
  expect(h.props.reloadPresentedHost).toHaveBeenCalledTimes(1)
})
it.each([
  [{ argsRaw: '{"files":[]}' }, 'running'],
  [{ kind: 'tool-result', call: { argsRaw: '{}' }, content: [{ type: 'text', text: 'Saved' }], isError: false }, 'ok'],
  [{ kind: 'tool-result', content: [], isError: true, error: { name: 'Denied', code: 'permission-denied' } }, 'failed'],
  [{ kind: 'tool-result', content: [{ type: 'image', url: 'fixture' }], isError: true, error: { name: 'Abort', code: 'interrupted' } }, 'stopped'],
] as const)('renders recorded present call state %# without submitting an action', (block, state) => {
  // 卡片只读取本例列出的持久字段，不伪造工具执行器。
  const view = render(<PresentRow {...{ block, t: makeTranslate(en) } as unknown as PresentProps} />)
  expect(view.container.querySelector('[data-qs-present]')?.getAttribute('data-state')).toBe(state)
  expect(view.container.querySelector('summary')?.textContent).toBe(en.details)
  if (state === 'failed') expect(view.container.textContent).toContain('permission-denied')
})
