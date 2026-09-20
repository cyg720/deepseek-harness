// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Transcript, type QsTranscriptProps } from '../src/client/Transcript.tsx'
import { zh } from '../src/client/locales.ts'
import { EMPTY_CHAT_SNAPSHOT, type ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('shows history failures without an empty-session message and retries through the owner', () => {
  const retryHistory = vi.fn()
  const state = { openState: 'error', openError: { message: 'history unavailable' }, queue: [], pendingSubmissions: [] }
  const props = {
    sessionId: 'failed', t: (key: keyof typeof zh) => zh[key], retryHistory,
    useChat: (select: (s: typeof EMPTY_CHAT_SNAPSHOT) => unknown) => select(EMPTY_CHAT_SNAPSHOT),
    useSession: (select: (s: typeof state) => unknown) => select(state),
    useQsHistory: () => ({ hasMore: false, loadingOlder: false }),
    useSessionPendingInteraction: () => undefined, readScroll: () => undefined, saveScroll: () => {},
    renderSlotChain: () => null,
  } as unknown as QsTranscriptProps
  const view = render(<div data-qs-scroll><Transcript {...props} /></div>)
  expect(view.getByRole('alert').textContent).toContain('history unavailable')
  expect(view.queryByText(zh['empty.title'])).toBeNull()
  fireEvent.click(view.getByRole('button', { name: zh['history.retry'] }))
  expect(retryHistory).toHaveBeenCalledTimes(1)
})

it('restores a saved reading position when content becomes measurable', () => {
  let resize = () => {}
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize = callback } observe() {} disconnect() {} })
  const saved = { top: 230, follow: false }
  const state = { queue: [], pendingSubmissions: [], openState: 'open' }
  const props = {
    sessionId: 'read', t: (key: keyof typeof zh) => zh[key],
    useChat: (select: (s: typeof EMPTY_CHAT_SNAPSHOT) => unknown) => select(EMPTY_CHAT_SNAPSHOT),
    useSession: (select: (s: typeof state) => unknown) => select(state),
    useQsHistory: () => ({ hasMore: false, loadingOlder: false }),
    useSessionPendingInteraction: () => undefined, readScroll: () => saved, saveScroll: vi.fn(),
    renderSlotChain: () => null,
  } as unknown as QsTranscriptProps
  const view = render(<div data-qs-scroll><Transcript {...props} /></div>)
  const scroller = view.container.querySelector<HTMLElement>('[data-qs-scroll]')!
  expect(scroller.scrollTop).toBe(230)
  resize()
  expect(scroller.scrollTop).toBe(230)
  scroller.scrollTop = 300
  Object.defineProperties(scroller, { scrollHeight: { value: 1500 }, clientHeight: { value: 500 } })
  fireEvent.scroll(scroller)
  expect(props.saveScroll).toHaveBeenLastCalledWith({ top: 300, follow: false })
})

it.each(['user', 'steering', 'submission'] as const)('resumes following an active %s submission but preserves historical prepends', (kind) => {
  let resize = () => {}
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback }
    observe() {}
    disconnect() {}
  })
  let order = ['old-user', 'answer']
  const state = {
    queue: [] as { id: string; placement: string }[],
    pendingSubmissions: [] as { requestId: string; placement: string }[], running: false,
  }
  const snapshot = () => ({ ...EMPTY_CHAT_SNAPSHOT, order, nodes: {
    ...EMPTY_CHAT_SNAPSHOT.nodes,
    get: (key: string) => ({ kind: key.endsWith('user') ? 'user' : 'assistant-step' }),
  } }) as unknown as ChatSnapshot
  const props = {
    t: (key: keyof typeof zh) => zh[key],
    useChat: (select: (s: ChatSnapshot) => unknown) => select(snapshot()),
    useSession: (select: (s: typeof state) => unknown) => select(state),
    useQsHistory: () => ({ hasMore: false, loadingOlder: false }),
    useSessionPendingInteraction: () => undefined, readScroll: () => undefined, saveScroll: () => {},
    useNode: () => 'user', renderSlot: () => null, renderSlotChain: () => null,
  } as unknown as QsTranscriptProps
  const tree = () => <div data-qs-scroll><Transcript {...props} /></div>
  const view = render(tree())
  const scroller = view.container.querySelector<HTMLElement>('[data-qs-scroll]')!
  let height = 1000
  Object.defineProperties(scroller, { scrollHeight: { get: () => height }, clientHeight: { value: 300 } })
  scroller.scrollTop = 100
  fireEvent.scroll(scroller)
  order = ['history-user', ...order]
  view.rerender(tree())
  resize()
  expect(scroller.scrollTop).toBe(100)
  height = 1400
  if (kind === 'user') order = [...order, 'new-user', 'new-answer']
  else if (kind === 'steering') state.queue = [{ id: 'steering-1', placement: 'steering' }]
  else state.pendingSubmissions = [{ requestId: 'submit-1', placement: 'immediate' }]
  view.rerender(tree())
  expect(scroller.scrollTop).toBe(1400)
  height = 1600
  resize()
  expect(scroller.scrollTop).toBe(1600)
})

it('follows interaction-card growth but stops following after the user scrolls away', () => {
  let resize = () => {}
  const observe = vi.fn()
  const disconnect = vi.fn()
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback }
    observe = observe
    disconnect = disconnect
  })
  const props = {
    t: (key: keyof typeof zh) => zh[key],
    useChat: () => [], useSession: () => false,
    useQsHistory: () => ({ hasMore: false, loadingOlder: false }),
    useSessionPendingInteraction: () => undefined, readScroll: () => undefined, saveScroll: () => {},
    renderSlotChain: () => <div data-test-interaction>Pending question</div>,
  } as unknown as QsTranscriptProps // The fixture has no row seats or active Session.
  const view = render(<div data-qs-scroll><Transcript {...props} /></div>)
  const scroller = view.container.querySelector<HTMLElement>('[data-qs-scroll]')!
  const content = view.container.querySelector<HTMLElement>('[data-qs-transcript-scroll]')!
  let height = 1000
  Object.defineProperties(scroller, { scrollHeight: { get: () => height }, clientHeight: { value: 300 } })
  expect(observe).toHaveBeenCalledWith(content)
  expect(content.querySelector('[data-test-interaction]')).not.toBeNull()
  resize()
  expect(scroller.scrollTop).toBe(1000)
  height = 1100
  fireEvent.scroll(scroller)
  resize()
  expect(scroller.scrollTop).toBe(1100)
  scroller.scrollTop = 100
  fireEvent.scroll(scroller)
  height = 1200
  resize()
  expect(scroller.scrollTop).toBe(100)
  scroller.scrollTop = 900
  fireEvent.scroll(scroller)
  height = 1400
  resize()
  expect(scroller.scrollTop).toBe(1400)
  view.unmount()
  expect(disconnect).toHaveBeenCalledOnce()
})
