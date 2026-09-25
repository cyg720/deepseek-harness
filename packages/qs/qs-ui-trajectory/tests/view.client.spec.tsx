// @vitest-environment jsdom
/** 请求卡仅显示权威记录，展开前不挂载系统文本。 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { AssistantTiming, ConversationNode, RequestView, PartialAssistant, RunningToolCall } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import { Inspect } from '../src/client/Inspect.tsx'
import { createConversationStore } from '@deepseek-ai/dsh-client-ui-conversation/src/client/stores.ts'
import type { InspectProps } from '../src/client/contract.ts'
import { findFocus } from '../src/client/focus.ts'
import { Trajectory } from '../src/client/Trajectory.tsx'
import type { TrajectoryProps } from '../src/client/contract.ts'
import { zh } from '../src/client/locales.ts'
afterEach(cleanup)
const base = { startSeq: 10, startedAt: 100, completedAt: 200, status: 'complete' as const, turn: 1, step: 2 }
function fixture(requests: readonly RequestView[], connected = true, loading = false, failed = false) {
  const loadOlder = vi.fn(async () => {})
  const props = { reading: { scrollTop: 0, requests: new Set<number>(), records: new Set<number>() }, renderSlot: () => null, loadImage: async () => 'blob:test', sessionId: 'test', loadOlder, t: (key: keyof typeof zh) => zh[key],
    usePartial: (select: (value: null) => unknown) => select(null),
    useRunningCalls: (select: (value: readonly never[]) => unknown) => select([]),
    useNodes: (select: (value: readonly ConversationNode[]) => unknown) => select([]),
    useRequests: (select: (value: readonly RequestView[]) => unknown) => select(requests),
    useConnected: (select: (value: boolean) => unknown) => select(connected),
    useSession: (select: (value: SessionSnapshot) => unknown) => select({ hasMore: true, loadingOlder: loading,
      historyLoad: { phase: failed ? 'failed' : 'idle' } } as SessionSnapshot),
  } as unknown as TrajectoryProps
  return { props, loadOlder }
}
it('展开录入上下文按文本呈现，模型优先采用最终来源且不执行标记', async () => {
  const f = fixture([{ ...base, purpose: 'assistant', provenance: { model: 'actual', provider: 'deepseek' },
    prompt: { system: '<script>unsafe()</script>', tools: [], config: { model: 'configured', provider: 'deepseek' } } }])
  const view = render(<Trajectory {...f.props} />)
  expect(screen.getByText('actual')).toBeTruthy()
  expect(view.container.textContent).not.toContain('unsafe()')
  const details = view.container.querySelector('details')!
  details.open = true; fireEvent(details, new Event('toggle'))
  expect(screen.getByText('<script>unsafe()</script>')).toBeTruthy()
  expect(view.container.querySelector('script')).toBeNull()
  details.open = false; fireEvent(details, new Event('toggle'))
  expect(view.container.textContent).not.toContain('unsafe()')
  fireEvent.click(screen.getByRole('button', { name: zh.older }))
  await waitFor(() => { expect(f.loadOlder).toHaveBeenCalledOnce() })
})
it('缺窗、压缩及运行中不补造模型和耗时', () => {
  const f = fixture([
    { ...base, purpose: 'assistant', requestConfig: { model: 'configured', provider: 'd' }, status: 'running', completedAt: null },
    { ...base, startSeq: 11, purpose: 'compaction', turn: null, step: 0, status: 'error' },
    { ...base, startSeq: 12, purpose: 'assistant', prompt: { system: '', tools: [], config: { model: 'from-prompt', provider: 'd' } } },
  ])
  const view = render(<Trajectory {...f.props} />)
  expect(screen.getByText('configured')).toBeTruthy(); expect(screen.getByText('from-prompt')).toBeTruthy()
  const details = view.container.querySelectorAll('details')[1]!
  details.open = true; fireEvent(details, new Event('toggle'))
  expect(screen.getByText(zh.missing)).toBeTruthy()
  expect(screen.getByText(zh.running)).toBeTruthy(); expect(screen.getByText(zh.error)).toBeTruthy()
})
it('加载失败可重试，断线及加载中禁用请求', async () => {
  const f = fixture([]), view = render(<Trajectory {...f.props} />)
  f.loadOlder.mockRejectedValueOnce(new Error('private host path'))
  fireEvent.click(screen.getByRole('button', { name: zh.older }))
  await screen.findByRole('alert')
  expect(view.container.textContent).not.toContain('private host path')
  fireEvent.click(screen.getByRole('button', { name: zh.older }))
  await waitFor(() => { expect(screen.queryByRole('alert')).toBeNull() })
  view.rerender(<Trajectory {...fixture([], false, true, true).props} />)
  expect(screen.getByRole<HTMLButtonElement>('button').disabled).toBe(true)
  expect(screen.getByText(zh.offline)).toBeTruthy()
  view.rerender(<Trajectory {...f.props} useSession={select => select({ hasMore: false, loadingOlder: false, historyLoad: { phase: 'idle' } } as SessionSnapshot)} />)
  expect(screen.queryByRole('button')).toBeNull()
})

// 持久化 usage 字段不保证来自同一供应商，缺项和不可信值不可混同零用量。
it('展示供应商记录的 token，用量缺失或非法时不补造数值', () => {
  const values: unknown[] = [undefined, null, 'bad', [], { inputTokens: -1 },
    { inputTokens: Infinity }, { inputTokens: NaN }, { inputTokens: '12' },
    { inputTokens: 1200, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 400, reasoningTokens: 9 }]
  const f = fixture(values.map((usage, index) => ({ ...base, purpose: 'assistant', startSeq: index + 1, usage })))
  const page = render(<Trajectory {...f.props} />)
  const cards = page.container.querySelectorAll('article')
  const count = (card: Element, label: string): string | null =>
    [...card.querySelectorAll('dt')].find(node => node.textContent === label)!.nextElementSibling!.textContent
  for (const card of [...cards].slice(0, -1)) expect(count(card, zh.inputTokens)).toBe(zh.unknown)
  const last = cards[cards.length - 1]!
  expect(count(last, zh.inputTokens)).toBe('1200')
  expect(count(last, zh.outputTokens)).toBe('50')
  expect(count(last, zh.cacheReadTokens)).toBe('0')
  expect(count(last, zh.cacheWriteTokens)).toBe('400')
  expect(count(last, zh.reasoningTokens)).toBe('9')
})

it('首字时间只归属于同结果序号请求，缺窗与失败重试不能借用后续时间', () => {
  const timings: (AssistantTiming | undefined)[] = [undefined,
    { stepStartTime: null, firstTokenTime: 130, completedTime: 200 },
    { stepStartTime: 100, firstTokenTime: null, completedTime: 200 },
    { stepStartTime: 100, firstTokenTime: 130, completedTime: 200 },
    { stepStartTime: 100, firstTokenTime: 100, completedTime: 200 }]
  const nodes: ConversationNode[] = timings.map((timing, index) => ({
    kind: 'assistant', seq: index + 20, time: 200, turn: 1, step: 2, blocks: [], ...(timing === undefined ? {} : { timing }),
  }))
  nodes.push({ kind: 'user', seq: 1, time: 1, content: [], source: null })
  const requests: RequestView[] = timings.map((_, index) => ({ ...base, startSeq: index + 1, purpose: 'assistant', resultSeq: index + 20 }))
  requests.push({ ...base, startSeq: 9, purpose: 'assistant', status: 'error' })
  const page = render(<Trajectory {...fixture(requests).props} useNodes={select => select(nodes)} />)
  const values = [...page.container.querySelectorAll('dt')].filter(node => node.textContent === zh.firstToken)
    .map(node => node.nextElementSibling!.textContent)
  expect(values).toEqual([zh.unknown, zh.unknown, zh.unknown, '30', '0', zh.unknown])
})

// 附件插件必须获得当前视图的会话加载器，不能从全局另取会话身份。
it('展开历史图片时将授权加载器和图片引用传给子槽', () => {
  const f = fixture([]), renderSlot = vi.fn(() => <span>attachment presentation</span>)
  const image = { attachmentId: 'image' as never, mediaType: 'image/png' as const, bytes: 1, width: 1, height: 1 }
  const nodes: ConversationNode[] = [{ kind: 'user', seq: 1, time: 1, source: null, content: [{ type: 'image', attachment: image }] }]
  const page = render(<Trajectory {...f.props} renderSlot={renderSlot} useNodes={select => select(nodes)} />)
  expect(renderSlot).not.toHaveBeenCalled()
  const details = page.container.querySelector('details')!
  details.open = true; fireEvent(details, new Event('toggle'))
  expect(renderSlot).toHaveBeenCalledWith('qs.conversation.trajectory.images', {
    images: [{ attachment: image }], align: 'start', loadImage: f.props.loadImage,
  })
  expect(page.getByText('attachment presentation')).toBeTruthy()
})

// 重试不可借用同轮助手结果，压缩摘要按真实 summaryEventSeq 定位。
it('定位只展开匹配结果并聚焦，重复定位可重新展开，缺窗保持禁用', () => {
  const scroll = vi.fn()
  const prior = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scroll })
  try {
    const nodes: ConversationNode[] = [
      { kind: 'assistant', seq: 20, time: 1, turn: 1, step: 2, blocks: [{ kind: 'text', text: 'actual result' }] },
      { kind: 'compaction', seq: 30, time: 2, summary: 'summary result', summaryEventSeq: 29, shadowedItemCount: 1, shadowedTokenCount: 1 },
    ]
    const requests: RequestView[] = [
      { ...base, startSeq: 1, purpose: 'assistant', resultSeq: 20 },
      { ...base, startSeq: 2, purpose: 'assistant', status: 'error' },
      { ...base, startSeq: 3, purpose: 'assistant', resultSeq: 99 },
      { ...base, startSeq: 4, purpose: 'compaction', turn: null, step: 0, resultSeq: 29 },
    ]
    const page = render(<Trajectory {...fixture(requests).props} useNodes={select => select(nodes)} />)
    expect(page.getAllByRole('button', { name: zh.locateUnavailable }).every(button => button.hasAttribute('disabled'))).toBe(true)
    const buttons = page.getAllByRole('button', { name: zh.locateResult })
    const record = page.container.querySelector<HTMLDetailsElement>('[data-qs-trajectory-record="20"]')!
    fireEvent.click(buttons[0]!)
    expect(record.open).toBe(true)
    expect(document.activeElement).toBe(record.querySelector('summary'))
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' })
    record.open = false; fireEvent(record, new Event('toggle'))
    fireEvent.click(buttons[0]!)
    expect(record.open).toBe(true)
    fireEvent.click(buttons[1]!)
    const compact = page.container.querySelector<HTMLDetailsElement>('[data-qs-trajectory-record="30"]')!
    expect(compact.open).toBe(true)
    expect(document.activeElement).toBe(compact.querySelector('summary'))
    const chooser = page.getByRole('combobox', { name: zh.turnNavigation })
    expect([...chooser.querySelectorAll('option')].map(option => option.textContent)).toEqual([zh.chooseTurn, `${zh.turn} 1`])
    fireEvent.change(chooser, { target: { value: '1' } })
    expect(document.activeElement).toBe(page.container.querySelector('[data-qs-trajectory-request="1"]'))
    expect((chooser as HTMLSelectElement).value).toBe('')
    // 追加已加载请求后新增轮次入口；原轮重试不改变首个请求。
    page.rerender(<Trajectory {...fixture([...requests, { ...base, startSeq: 50, turn: 7, purpose: 'assistant' }]).props}
      useNodes={select => select(nodes)} />)
    fireEvent.change(chooser, { target: { value: '50' } })
    expect(document.activeElement).toBe(page.container.querySelector('[data-qs-trajectory-request="50"]'))

  } finally {
    if (prior === undefined) Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
    else Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', prior)
  }
})

// 切换阅读视图后保留高度相关的展开状态；卸载实例不再监听共用滚动容器。
it('恢复轨迹位置和展开状态，并在卸载后停止写回滚动位置', () => {
  const f = fixture([{ ...base, purpose: 'assistant', resultSeq: 20,
    prompt: { system: 'recorded system', tools: [], config: { model: 'test', provider: 'test' } } }])
  const nodes: ConversationNode[] = [{ kind: 'assistant', seq: 20, time: 1, turn: 1, step: 2,
    blocks: [{ kind: 'text', text: 'retained result' }] }]
  f.props.reading.scrollTop = 120
  f.props.reading.requests.add(10)
  f.props.reading.records.add(20)
  const content = <div data-qs-scroll><Trajectory {...f.props} useNodes={select => select(nodes)} /></div>
  const page = render(content)
  const scroll = page.container.querySelector<HTMLElement>('[data-qs-scroll]')!
  expect(scroll.scrollTop).toBe(120)
  expect(page.getByText('recorded system')).toBeTruthy()
  expect(page.getByText('retained result')).toBeTruthy()
  scroll.scrollTop = 310; fireEvent.scroll(scroll)
  expect(f.props.reading.scrollTop).toBe(310)
  const requestDetails = page.container.querySelector<HTMLDetailsElement>('article details')!
  requestDetails.open = false; fireEvent(requestDetails, new Event('toggle'))
  expect(f.props.reading.requests.has(10)).toBe(false)
  const recordDetails = page.container.querySelector<HTMLDetailsElement>('[data-qs-trajectory-record]')!
  recordDetails.open = false; fireEvent(recordDetails, new Event('toggle'))
  expect(f.props.reading.records.has(20)).toBe(false)
  page.unmount()
  scroll.scrollTop = 900; fireEvent.scroll(scroll)
  expect(f.props.reading.scrollTop).toBe(310)
  const reopened = render(content)
  expect(reopened.container.querySelector<HTMLElement>('[data-qs-scroll]')!.scrollTop).toBe(310)
  expect(reopened.queryByText('recorded system')).toBeNull()
  expect(reopened.queryByText('retained result')).toBeNull()
})

// 诊断只取官方请求字段，认证失败沿用官方本地化文案而不输出供应商原始认证响应。
it('请求详情折叠隐藏诊断，展开区分压缩摘要原始输出和认证失败', () => {
  const requests: RequestView[] = [
    { ...base, startSeq: 1, purpose: 'compaction', turn: null, step: 0,
      summary: [{ type: 'text', text: 'safe summary' }], rawOutput: [{ type: 'text', text: '<script>raw-output</script>' }] },
    { ...base, startSeq: 2, purpose: 'compaction', turn: null, step: 0, rawOutput: [{ type: 'text', text: 'raw only' }] },
    { ...base, startSeq: 3, purpose: 'assistant', status: 'error', error: '<img src=x>failed', errorCode: 'PROVIDER_ERROR' },
    { ...base, startSeq: 4, purpose: 'assistant', status: 'error', error: 'private-auth-response', errorCode: 'AUTH' },
    { ...base, startSeq: 5, purpose: 'assistant', status: 'error', errorCode: 'CODE_ONLY' },
    { ...base, startSeq: 6, purpose: 'compaction', turn: null, step: 0, summary: [{ type: 'text', text: 'summary only' }] },
  ]
  const page = render(<Trajectory {...fixture(requests).props} />)
  expect(page.container.textContent).not.toContain('safe summary')
  expect(page.container.textContent).not.toContain('PROVIDER_ERROR')
  for (const detail of page.container.querySelectorAll('details')) { detail.open = true; fireEvent(detail, new Event('toggle')) }
  for (const text of ['safe summary', '<script>raw-output</script>', 'raw only', 'summary only', '<img src=x>failed', 'PROVIDER_ERROR', 'CODE_ONLY']) {
    expect(page.getByText(text)).toBeTruthy()
  }
  expect(page.getByText(zh.authFailure)).toBeTruthy()
  expect(page.container.textContent).not.toContain('private-auth-response')
  expect(page.container.querySelector('script,img')).toBeNull()
})

// 瞬时内容随官方快照替换；完成后不保留重复的实时输出。
it('实时输出更新并清除，运行工具保留层级且参数只在展开后显示', () => {
  const f = fixture([])
  let partial: PartialAssistant | null = { turn: 1, step: 2, blocks: [{ kind: 'text', text: 'first chunk' }] }
  let calls: readonly RunningToolCall[] = [{ callId: 'root', name: '<script>tool</script>', argsRaw: 'private args', turn: 1, step: 2, time: 1,
    subCalls: [
      { kind: 'tool-result', seq: 2, time: 2, callId: 'child', call: { name: 'read_file', argsRaw: '{}' }, callTime: 1,
        content: [{ type: 'text', text: 'child success' }], isError: false, subCalls: [] },
      { kind: 'tool-result', seq: 3, time: 3, callId: 'missing-call', call: null, callTime: null,
        content: [{ type: 'text', text: 'child failed' }], isError: true, subCalls: [] },
    ] }]
  const component = () => <Trajectory {...f.props} usePartial={select => select(partial)} useRunningCalls={select => select(calls)} />
  const page = render(component())
  expect(page.getByText('first chunk')).toBeTruthy()
  expect(page.container.textContent).not.toContain('private args')
  const root = page.container.querySelector<HTMLDetailsElement>('[data-qs-trajectory-live] details')!
  root.open = true; fireEvent(root, new Event('toggle'))
  expect(page.getByText('private args')).toBeTruthy()
  for (const detail of root.querySelectorAll('details')) { detail.open = true; fireEvent(detail, new Event('toggle')) }
  expect(page.getByText('child success')).toBeTruthy()
  expect(page.getByText('child failed')).toBeTruthy()
  expect(page.container.textContent).toContain('missing-call')
  expect(page.container.querySelector('script')).toBeNull()
  partial = { ...partial, blocks: [{ kind: 'text', text: 'second chunk' }] }
  calls = []
  page.rerender(component())
  expect(page.queryByText('first chunk')).toBeNull()
  expect(page.getByText('second chunk')).toBeTruthy()
  expect(page.queryByText('private args')).toBeNull()
  partial = null
  page.rerender(component())
  expect(page.container.querySelector('[data-qs-trajectory-live]')).toBeNull()
})

// 跨视图焦点沿官方调用 ID 穿透子调用，缺窗保留请求而非误确认。
it('消费工具焦点并展开祖先，确认后保持展开，缺窗加载后再确认', () => {
  const prior = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  try {
    const id = 'child"[opaque]'
    const child: Extract<ConversationNode, { kind: 'tool-result' }> = { kind: 'tool-result', seq: 30, time: 3,
      callId: id, call: { name: 'read_file', argsRaw: '{}' }, callTime: 2, content: [{ type: 'text', text: 'focused result' }], isError: false, subCalls: [] }
    const root: typeof child = { ...child, seq: 40, callId: 'root', content: [], subCalls: [child] }
    const f = fixture([]), done = vi.fn()
    const viewRequest = { view: 'trajectory', focus: id }
    const page = render(<Trajectory {...f.props} viewRequest={viewRequest} completeViewRequest={done} />)
    expect(page.getByText(zh.focusMissing)).toBeTruthy()
    expect(done).not.toHaveBeenCalled()
    page.rerender(<Trajectory {...f.props} viewRequest={viewRequest} completeViewRequest={done} useNodes={select => select([root])} />)
    expect(page.getByText('focused result')).toBeTruthy()
    expect(document.activeElement?.parentElement?.getAttribute('data-qs-tool-call')).toBe(id)
    expect(done).toHaveBeenCalledOnce()
    page.rerender(<Trajectory {...f.props} viewRequest={null} completeViewRequest={done} useNodes={select => select([root])} />)
    expect(page.getByText('focused result')).toBeTruthy()
    const assistant: ConversationNode = { kind: 'assistant', seq: 55, time: 5, turn: 1, step: 1,
      blocks: [{ kind: 'text', text: 'intro' }, { kind: 'tool-call', callId: 'call-only', name: 'bash', argsRaw: '{}' }] }
    page.rerender(<Trajectory {...f.props} viewRequest={{ view: 'trajectory', focus: 'call-only' }} completeViewRequest={done}
      useNodes={select => select([assistant])} />)
    expect(document.activeElement?.parentElement?.getAttribute('data-qs-trajectory-record')).toBe('55')
    const running: RunningToolCall = { callId: 'running', name: 'bash', argsRaw: 'waiting', time: 1, turn: 1, step: 1, subCalls: [] }
    page.rerender(<Trajectory {...f.props} viewRequest={{ view: 'trajectory', focus: 'running' }} completeViewRequest={done}
      useRunningCalls={select => select([running])} />)
    expect(document.activeElement?.parentElement?.getAttribute('data-qs-tool-call')).toBe('running')
    expect(page.getByText('waiting')).toBeTruthy()
    expect(findFocus([root, assistant], [], 'missing')).toBeUndefined()
    expect(findFocus([root], [], 'root')?.seq).toBe(40)
    page.rerender(<Trajectory {...f.props} viewRequest={{ view: 'chat', focus: 'missing' }} completeViewRequest={done} />)
    expect(page.queryByText(zh.focusMissing)).toBeNull()
  } finally {
    if (prior === undefined) Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
    else Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', prior)
  }
})

// 入口使用与聊天共享的真实官方 store，不改草稿且不在目标缺席时显示。
it('工具入口激活官方 target 并写入一次性定位，轨迹卸载时隐藏入口', () => {
  const store = createConversationStore().create('inspect-test'), activate = vi.fn()
  store.actions.setDraft('keep this draft')
  let available = false
  const props = { callId: 'call-opaque', actions: store.actions, activate,
    useAvailable: (select: (value: boolean) => unknown) => select(available),
    t: (key: keyof typeof zh) => zh[key],
  } as unknown as InspectProps
  const page = render(<Inspect {...props} />)
  expect(page.queryByRole('button')).toBeNull()
  available = true; page.rerender(<Inspect {...props} />)
  fireEvent.click(page.getByRole('button', { name: zh.inspectTool }))
  expect(activate).toHaveBeenCalledOnce()
  expect(store.getSnapshot()).toMatchObject({ draft: 'keep this draft', view: 'trajectory', viewRequest: { view: 'trajectory', focus: 'call-opaque' } })
  available = false; page.rerender(<Inspect {...props} />)
  expect(page.queryByRole('button')).toBeNull()
})

// 轨迹与聊天订阅同一分页结果，手动重试不重新创建会话。
it.each([[false, true], [true, true], [false, false]])('分页无进展说明按 progressed=%s hasMore=%s 展示', (progressed, hasMore) => {
  const f = fixture([])
  const view = render(<Trajectory {...f.props} useSession={select => select({
    hasMore, loadingOlder: false, historyLoad: {
      phase: 'succeeded', requestId: 1, connectionEpoch: 1, kind: 'older', progressed, hasMore,
    },
  } as SessionSnapshot)} />)
  expect(view.queryByText('本次未加载到更早的记录，请手动重试。') !== null).toBe(!progressed && hasMore)
  if (hasMore) {
    fireEvent.click(view.getByRole('button', { name: zh.older }))
    expect(f.loadOlder).toHaveBeenCalledOnce()
  }
})
