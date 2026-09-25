// @vitest-environment jsdom
import { useSearchableHidden } from '@deepseek-ai/dsh-client-ui-chat/src/client/chat/searchable-hidden.ts'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Transcript, type QsTranscriptProps } from '../src/client/Transcript.tsx'
import { zh } from '../src/client/locales.ts'
import { EMPTY_CHAT_SNAPSHOT, type ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('shows history failures without an empty-session message and retries through the owner', () => {
  const retryHistory = vi.fn()
  const state = { openState: 'error', openError: { message: 'history unavailable' }, queue: [], pendingSubmissions: [] }
  const props = {
    sessionId: 'failed', t: (key: keyof typeof zh) => zh[key], retryHistory,
    useChat: (select: (s: typeof EMPTY_CHAT_SNAPSHOT) => unknown) => select(EMPTY_CHAT_SNAPSHOT),
    useSession: (select: (s: typeof state) => unknown) => select(state),
    useSearchableHidden,
    useQsCompactTranscript: (select: (value: boolean) => unknown) => select(true),
    useQsRowKeys: (select: (keys: readonly string[]) => unknown) => select(['user', 'assistant-step', 'unknown']),
    fold: { isOpen: () => false, set: () => {}, subscribe: () => () => {} },
    loadImage: () => Promise.resolve('blob:image'),
    useQsHistoryConnected: (select: (value: boolean) => unknown) => select(true),
    useQsHistory: () => ({ hasMore: false, loadingOlder: false, historyLoad: { phase: 'idle' as const } }),
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
  let measured = false, actualTop = 0
  const saved = { top: 230, follow: false }
  const state = { queue: [], pendingSubmissions: [], openState: 'open' }
  const props = {
    sessionId: 'read', t: (key: keyof typeof zh) => zh[key],
    useChat: (select: (s: typeof EMPTY_CHAT_SNAPSHOT) => unknown) => select(EMPTY_CHAT_SNAPSHOT),
    useSession: (select: (s: typeof state) => unknown) => select(state),
    useSearchableHidden,
    useQsCompactTranscript: (select: (value: boolean) => unknown) => select(true),
    useQsRowKeys: (select: (keys: readonly string[]) => unknown) => select(['user', 'assistant-step', 'unknown']),
    fold: { isOpen: () => false, set: () => {}, subscribe: () => () => {} },
    loadImage: () => Promise.resolve('blob:image'),
    useQsHistoryConnected: (select: (value: boolean) => unknown) => select(true),
    useQsHistory: () => ({ hasMore: false, loadingOlder: false, historyLoad: { phase: 'idle' as const } }),
    useSessionPendingInteraction: () => undefined, readScroll: () => saved, saveScroll: vi.fn(),
    renderSlotChain: () => null,
  } as unknown as QsTranscriptProps
  const view = render(<div data-qs-scroll ref={(node) => {
    // 几何模拟仅归此测试节点所有，不改写 jsdom 全局原型。
    if (node !== null) Object.defineProperty(node, 'scrollTop', { configurable: true,
      get: () => actualTop, set: (value: number) => { actualTop = measured ? value : 0 },
    })
  }}><Transcript {...props} /></div>)
  const scroller = view.container.querySelector<HTMLElement>('[data-qs-scroll]')!
  expect(scroller.scrollTop).toBe(0)
  measured = true
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
    useSearchableHidden,
    useQsCompactTranscript: (select: (value: boolean) => unknown) => select(true),
    useQsRowKeys: (select: (keys: readonly string[]) => unknown) => select(['user', 'assistant-step', 'unknown']),
    fold: { isOpen: () => false, set: () => {}, subscribe: () => () => {} },
    loadImage: () => Promise.resolve('blob:image'),
    useQsHistoryConnected: (select: (value: boolean) => unknown) => select(true),
    useQsHistory: () => ({ hasMore: false, loadingOlder: false, historyLoad: { phase: 'idle' as const } }),
    useSessionPendingInteraction: () => undefined, readScroll: () => undefined, saveScroll: () => {},
    useNode: (_key: string, select: (value: unknown) => unknown) => select({ kind: 'user', anchorSeq: 1, data: {} }),
    useProcess: (_key: string, select: (value: unknown) => unknown) => select(undefined),
    renderSlot: () => null, renderSlotChain: () => null,
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

it('follows transcript growth but stops following after the user scrolls away', () => {
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
    useSearchableHidden,
    useQsCompactTranscript: (select: (value: boolean) => unknown) => select(true),
    useQsRowKeys: (select: (keys: readonly string[]) => unknown) => select(['user', 'assistant-step', 'unknown']),
    fold: { isOpen: () => false, set: () => {}, subscribe: () => () => {} },
    loadImage: () => Promise.resolve('blob:image'),
    useQsHistoryConnected: (select: (value: boolean) => unknown) => select(true),
    useQsHistory: () => ({ hasMore: false, loadingOlder: false, historyLoad: { phase: 'idle' as const } }),
    useSessionPendingInteraction: () => undefined, readScroll: () => undefined, saveScroll: () => {},
    renderSlotChain: () => <div data-test-interaction>Pending question</div>,
  } as unknown as QsTranscriptProps // The fixture has no row seats or active Session.
  const view = render(<div data-qs-scroll><Transcript {...props} /></div>)
  const scroller = view.container.querySelector<HTMLElement>('[data-qs-scroll]')!
  const content = view.container.querySelector<HTMLElement>('[data-qs-transcript-scroll]')!
  let height = 1000
  Object.defineProperties(scroller, { scrollHeight: { get: () => height }, clientHeight: { value: 300 } })
  expect(observe).toHaveBeenCalledWith(content)
  // 待回答区归固定 Stage 座位，转写不能重复挂载。
  expect(content.querySelector('[data-test-interaction]')).toBeNull()
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

/** 使用真正选择器座位覆盖加载状态、行分派与历史前插锚点。 */
function historyFixture() {
  let order = ['user', 'answer']
  const state = { queue: [{ id: 'queued', placement: 'queued' }], pendingSubmissions: [{ requestId: 'queued', placement: 'queued' }], running: false, openState: 'open', openError: undefined }
  const history: { hasMore: boolean; loadingOlder: boolean; historyLoad: import('../src/client/contract.ts').QsHistorySnapshot['historyLoad'] } = { hasMore: true, loadingOlder: false, historyLoad: { phase: 'idle' } }
  const nodes = { ...EMPTY_CHAT_SNAPSHOT.nodes, get: (key: string) => key === 'missing' ? undefined : { kind: key === 'user' ? 'user' : 'assistant-step' } }
  const props = {
    sessionId: 'session', t: (key: keyof typeof zh) => zh[key],
    useChat: (select: (snapshot: object) => unknown) => select({ order, nodes }),
    useSession: (select: (snapshot: typeof state) => unknown) => select(state),
    useSearchableHidden,
    useQsCompactTranscript: (select: (value: boolean) => unknown) => select(true),
    useQsRowKeys: (select: (keys: readonly string[]) => unknown) => select(['user', 'assistant-step', 'unknown']),
    fold: { isOpen: () => false, set: () => {}, subscribe: () => () => {} },
    loadImage: () => Promise.resolve('blob:image'),
    useQsHistoryConnected: (select: (value: boolean) => unknown) => select(true),
    useQsHistory: (select: (snapshot: typeof history) => unknown) => select(history),
    useSessionPendingInteraction: (select: (snapshot: Map<string, object>) => unknown) => select(new Map([['session', {}]])),
    useNode: (_key: string, select: (node: object | undefined) => unknown) => select(nodes.get(_key)),
    useProcess: () => undefined, renderSlot: vi.fn(() => null), renderSlotChain: vi.fn(() => null),
    loadOlder: vi.fn(), retryHistory: vi.fn(), readScroll: () => ({ top: 100, follow: false }), saveScroll: vi.fn(),
  } as unknown as QsTranscriptProps
  return { props, state, history, setOrder: (next: string[]) => { order = next } }
}
it('历史前插维持可见首行位置，并把节点类型交给对应槽', () => {
  const f = historyFixture()
  const tree = () => <div data-qs-scroll><Transcript {...f.props} /></div>
  const view = render(tree())
  const scroller = view.container.querySelector<HTMLElement>('[data-qs-scroll]')!
  const node = view.container.querySelector<HTMLElement>('[data-qs-node="user"]')!
  let nodeTop = 20
  vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue({ top: 10 } as DOMRect)
  vi.spyOn(node, 'getBoundingClientRect').mockImplementation(() => ({ top: nodeTop, bottom: nodeTop + 30 }) as DOMRect)
  fireEvent.click(view.getByRole('button', { name: zh['history.loadMore'] }))
  expect(f.props.loadOlder).toHaveBeenCalledOnce()
  nodeTop = 220; f.setOrder(['history', 'user', 'answer'])
  view.rerender(tree())
  expect(scroller.scrollTop).toBe(300)
  expect(f.props.saveScroll).toHaveBeenLastCalledWith({ top: 300, follow: false })
  expect(f.props.renderSlot).toHaveBeenCalledWith('qs.stage.transcript.row', expect.objectContaining({ nodeKey: 'user' }), { entryKey: 'user' })

})

it('分页后的二次尺寸变化仍保持锚点，用户滚动后解除，卸载恢复原生锚定', () => {
  let resize = () => {}
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback }
    observe() {}
    disconnect() {}
  })
  const f = historyFixture()
  const tree = () => <div data-qs-scroll style={{ overflowAnchor: 'auto' }}><Transcript {...f.props} /></div>
  const view = render(tree())
  const scroller = view.container.querySelector<HTMLElement>('[data-qs-scroll]')!
  const node = view.container.querySelector<HTMLElement>('[data-qs-node="user"]')!
  let contentTop = 120
  Object.defineProperties(scroller, { scrollHeight: { value: 2000 }, clientHeight: { value: 300 } })
  vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue({ top: 10 } as DOMRect)
  vi.spyOn(node, 'getBoundingClientRect').mockImplementation(() => ({
    top: contentTop - scroller.scrollTop, bottom: contentTop - scroller.scrollTop + 30,
  }) as DOMRect)
  fireEvent.click(view.getByRole('button', { name: zh['history.loadMore'] }))
  contentTop += 200
  f.setOrder(['history', 'user', 'answer'])
  view.rerender(tree())
  expect(node.getBoundingClientRect().top).toBe(20)
  // 折叠/图片等随后改变内容高度，不能只补偿前插的第一次布局。
  contentTop -= 80
  resize()
  expect(node.getBoundingClientRect().top).toBe(20)
  expect(scroller.style.overflowAnchor).toBe('none')
  scroller.scrollTop = 50
  fireEvent.scroll(scroller)
  contentTop += 100
  resize()
  expect(scroller.scrollTop).toBe(50)
  view.unmount()
  expect(scroller.style.overflowAnchor).toBe('auto')
})
it.each(['cold', 'loading', 'error', 'open'])('历史状态 %s 控制加载按钮且无滚动祖先也可显示', (status) => {
  const f = historyFixture(); f.state.openState = status; f.setOrder(['missing'])
  const view = render(<Transcript {...f.props} />)
  const more = view.getByRole('button', { name: zh['history.loadMore'] })
  expect(more).toHaveProperty('disabled', status !== 'open')
  if (status === 'open') { fireEvent.click(more); expect(f.props.loadOlder).toHaveBeenCalledOnce() }
  if (status === 'cold' || status === 'loading') expect(view.getByText(zh['history.opening'])).toBeDefined()
  if (status === 'error') expect(view.getByRole('alert').textContent).toContain(zh['history.failed'])
  expect(f.props.renderSlot).toHaveBeenCalledWith('qs.stage.transcript.row', expect.objectContaining({ nodeKey: 'missing' }), { entryKey: 'unknown' })
  f.history.loadingOlder = true; view.rerender(<Transcript {...f.props} />)
  expect(view.getByRole('button', { name: zh['history.loading'] })).toHaveProperty('disabled', true)
})
it('没有可见历史行时加载更多仍委派请求', () => {
  const f = historyFixture(); f.setOrder([])
  const view = render(<div data-qs-scroll><Transcript {...f.props} /></div>)
  fireEvent.click(view.getByRole('button', { name: zh['history.loadMore'] }))
  expect(f.props.loadOlder).toHaveBeenCalledOnce()
})

/** 转写可在无外部滚动宿主的嵌入视图中接收新提交。 */
it('缺少滚动宿主时新提交仍能更新转写', () => {
  const f = historyFixture()
  const view = render(<Transcript {...f.props} />)
  f.state.pendingSubmissions.push({ requestId: 'new', placement: 'immediate' })
  view.rerender(<Transcript {...f.props} />)
  expect(view.container.querySelector('[data-qs-transcript-scroll]')).not.toBeNull()
  expect(f.props.saveScroll).not.toHaveBeenCalled()
})

it('分页失败保留现有行，手动重试不重连会话', () => {
  const f = historyFixture()
  f.history.historyLoad = { phase: 'failed', requestId: 1, connectionEpoch: 1, kind: 'older' }
  const view = render(<Transcript {...f.props} />)
  expect(view.getByRole('alert').textContent).toBe(zh['history.failed'])
  expect(view.container.querySelectorAll('[data-qs-node]')).toHaveLength(2)
  fireEvent.click(view.getByRole('button', { name: zh['history.retry'] }))
  expect(f.props.loadOlder).toHaveBeenCalledOnce()
  expect(f.props.retryHistory).not.toHaveBeenCalled()
})

it('断线时保留手动分页入口但不发起请求', () => {
  const f = historyFixture()
  const view = render(<Transcript {...f.props} useQsHistoryConnected={select => select(false)} />)
  const button = view.getByRole('button', { name: zh['history.loadMore'] })
  expect(button).toHaveProperty('disabled', true)
  fireEvent.click(button)
  expect(f.props.loadOlder).not.toHaveBeenCalled()
})

it('delegates image rendering from a row to the single transcript-owned slot and retains its loader', () => {
  const state = { queue: [], pendingSubmissions: [], openState: 'open' }
  const snapshot = { ...EMPTY_CHAT_SNAPSHOT, order: ['image-row'] }
  const loadImage = vi.fn(() => Promise.resolve('blob:image'))
  const imageOwner = { images: [], align: 'start' as const }
  const delegated = vi.fn()
  const props = {
    sessionId: 'images', t: (key: keyof typeof zh) => zh[key], loadImage,
    useChat: (select: (s: typeof snapshot) => unknown) => select(snapshot),
    useSession: (select: (s: typeof state) => unknown) => select(state),
    useSearchableHidden,
    useQsCompactTranscript: (select: (value: boolean) => unknown) => select(true),
    useQsRowKeys: () => ['user'],
    useNode: (_key: string, select: (s: unknown) => unknown) => select({ kind: 'user' }),
    useProcess: () => undefined,
    fold: { isOpen: () => false, set: () => {}, subscribe: () => () => {} },
    useQsHistoryConnected: () => true,
    useQsHistory: () => ({ hasMore: false, loadingOlder: false, historyLoad: { phase: 'idle' } }),
    useSessionPendingInteraction: () => undefined, readScroll: () => undefined, saveScroll: () => {},
    renderSlot: (name: string, owner: { renderMessageImages?: (value: typeof imageOwner) => unknown }) => {
      if (name === 'qs.stage.transcript.row') return owner.renderMessageImages?.(imageOwner)
      delegated(name, owner)
      return null
    },
  } as unknown as QsTranscriptProps
  render(<Transcript {...props} />)
  expect(delegated).toHaveBeenCalledWith('qs.conversation.message.images', { ...imageOwner, loadImage })
})
