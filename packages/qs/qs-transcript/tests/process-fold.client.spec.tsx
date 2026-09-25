// @vitest-environment jsdom
import { useSearchableHidden } from '@deepseek-ai/dsh-client-ui-chat/src/client/chat/searchable-hidden.ts'
/** 过程折叠：状态存储语义，以及在真实转写里隐藏/恢复过程成员。 */
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type {
  ChatConversationViewNode, ChatSnapshot, ChatTurnProcessPresentation,
} from '@deepseek-ai/dsh-client-ui-chat/client'
import {
  createProcessFold, isProcessMemberHidden, PROCESS_INDEPENDENT_KINDS, processFoldKey,
} from '../src/client/process-fold.ts'
import { Transcript, type QsTranscriptProps } from '../src/client/Transcript.tsx'
import { ProcessRow } from '../src/client/process-row.tsx'
import { zh } from '../src/client/locales.ts'
import { ROW_COMPONENTS } from '../src/client/rows.tsx'
import type { QsTranscriptRowOwnerProps } from '../src/client/contract.ts'

afterEach(cleanup)

const PRESENTATION = {
  turn: 1, turnClosed: true, hasExternalProcess: false, compactAnswer: true,
  spec: {
    turn: 1, controlAnchorSeq: 1, processStartSeq: 2, answerAnchorSeq: 8, answerStep: 3,
    inlineReasoning: false, messageCount: 1, toolCallCount: 2, subagentCount: 0,
  },
} as unknown as ChatTurnProcessPresentation

it('折叠键包含会话、轮次与答案步骤，答案未定时用占位', () => {
  expect(processFoldKey('s1', 2, 3)).toBe('s1|2|3')
  expect(processFoldKey('s1', 2, null)).toBe('s1|2|-')
})

it('折叠状态只在写入变化时通知，读写按会话隔离', () => {
  const fold = createProcessFold()
  const listener = vi.fn()
  const off = fold.subscribe(listener)
  expect(fold.isOpen('a')).toBe(false)
  fold.set('a', true)
  expect(fold.isOpen('a')).toBe(true)
  expect(fold.isOpen('b')).toBe(false)
  expect(listener).toHaveBeenCalledTimes(1)
  // 重复写入同一状态不通知。
  fold.set('a', true)
  expect(listener).toHaveBeenCalledTimes(1)
  fold.set('a', false)
  expect(fold.isOpen('a')).toBe(false)
  expect(listener).toHaveBeenCalledTimes(2)
  off()
  fold.set('a', true)
  expect(listener).toHaveBeenCalledTimes(2)
})

it('独立 kind 永远不是过程成员', () => {
  for (const kind of PROCESS_INDEPENDENT_KINDS) {
    expect(isProcessMemberHidden({
      kind, anchorSeq: 3, presentation: PRESENTATION, open: false, historyIncomplete: false,
    })).toBe(false)
  }
})

it('折叠只在已结束、答案已定的轮次里隐藏窗口内的成员', () => {
  const base = { kind: 'assistant-step', anchorSeq: 3, presentation: PRESENTATION, open: false, historyIncomplete: false }
  expect(isProcessMemberHidden(base)).toBe(true)
  expect(isProcessMemberHidden({ ...base, open: true })).toBe(false)
  expect(isProcessMemberHidden({ ...base, presentation: undefined })).toBe(false)
  expect(isProcessMemberHidden({
    ...base,
    presentation: { ...PRESENTATION, turnClosed: false },
  })).toBe(false)
  expect(isProcessMemberHidden({
    ...base,
    presentation: { ...PRESENTATION, spec: { ...PRESENTATION.spec, answerAnchorSeq: null } },
  })).toBe(false)
  // 窗口之外：过程开始之前与最终答案行本身都不隐藏。
  expect(isProcessMemberHidden({ ...base, anchorSeq: 1 })).toBe(false)
  expect(isProcessMemberHidden({ ...base, anchorSeq: 8 })).toBe(false)
  // 未对齐轮次或没有可展开内容时，不能把窗口内的记录藏起来。
  expect(isProcessMemberHidden({ ...base, presentation: { ...PRESENTATION, turn: 2 } })).toBe(false)
  expect(isProcessMemberHidden({ ...base, presentation: {
    ...PRESENTATION, spec: { ...PRESENTATION.spec, toolCallCount: 0, messageCount: 0 },
  } })).toBe(false)
})

/** 转写宿主：过程行、窗口内成员与最终答案行各一条，按节点键给不同数据。 */
function bench(fold = createProcessFold(), presentation = PRESENTATION, hasMore = false, realProcess = false, realAssistant = false) {
  const location = { kind: 'turn', turn: { turn: 1, status: 'closed', steps: [] } }
  const nodes: Record<string, ChatConversationViewNode> = {
    process: { kind: 'turn-process', data: presentation.spec, visibility: 'visible', anchorSeq: 1, location },
    member: { kind: 'assistant-step', data: { status: 'settled', blocks: [{ kind: 'text', text: '过程内容' }] }, visibility: 'visible', anchorSeq: 3, location },
    answer: { kind: 'assistant-step', data: { step: 3, status: 'settled', blocks: [{ kind: 'reasoning', text: '最终答案的思考过程' }, { kind: 'text', text: '最终答案' }] }, visibility: 'visible', anchorSeq: 8, location },
  } as unknown as Record<string, ChatConversationViewNode>
  const snapshot = {
    order: ['process', 'member', 'answer'],
    nodes: { get: (key: string) => nodes[key] },
  } as unknown as ChatSnapshot
  const state = { queue: [], pendingSubmissions: [], openState: 'open' }
  const Assistant = ROW_COMPONENTS['assistant-step']!
  const props = {
    sessionId: 's1',
    t: (key: keyof typeof zh, params?: Record<string, unknown>) => {
      let text: string = zh[key]
      for (const [name, value] of Object.entries(params ?? {})) text = text.replace(`{${name}}`, String(value))
      return text
    },
    useChat: (select: (value: ChatSnapshot) => unknown) => select(snapshot),
    useSession: (select: (value: typeof state) => unknown) => select(state),
    useSearchableHidden,
    useQsCompactTranscript: (select: (value: boolean) => unknown) => select(true),
    useQsRowKeys: (select: (keys: readonly string[]) => unknown) => select(Object.keys(nodes)),
    useQsHistoryConnected: (select: (value: boolean) => unknown) => select(true),
    useQsHistory: () => ({ hasMore, loadingOlder: false, historyLoad: { phase: 'idle' as const } }),
    useNode: (key: string, select: (value: ChatConversationViewNode | undefined) => unknown) => select(nodes[key]),
    useProcess: (_key: string, select: (value: ChatTurnProcessPresentation | undefined) => unknown) => select(presentation),
    useSessionPendingInteraction: () => undefined,
    fold,
    loadImage: () => Promise.resolve('blob:image'),
    readScroll: () => undefined,
    saveScroll: () => {},
    renderSlotChain: () => null,
    renderSlot: (_name: string, owner: QsTranscriptRowOwnerProps) => realAssistant && owner.nodeKey === 'answer'
      ? <Assistant {...props} {...owner} useTurnData={() => undefined} fileMentions={() => undefined}
        renderSlot={() => null} renderSlotChain={() => null} __renders={undefined} />
      : realProcess && owner.nodeKey === 'process'
        ? <ProcessRow
          {...props} {...owner} renderSlot={() => null} renderSlotChain={() => null}
          useTurnData={() => undefined} renderMessageImages={() => null} __renders={undefined}
        />
        : <span data-row={owner.nodeKey} />,
  } as unknown as QsTranscriptProps
  const view = render(<div data-qs-scroll><Transcript {...props} /></div>)
  return { fold, view, props, setCompact: (compact: boolean) => {
    view.rerender(<div data-qs-scroll><Transcript {...props} useQsCompactTranscript={select => select(compact)} /></div>)
  } }
}

it('已结束轮的过程成员默认隐藏，展开该轮后恢复，最终答案始终显示', () => {
  const { fold, view } = bench()
  const rendered = () => [...view.container.querySelectorAll('[data-row]')].filter(node => node.closest('[hidden]') === null).map(node => node.getAttribute('data-row'))
  expect(rendered()).toEqual(['process', 'answer'])
  // 存储通知是宿主外的事件：用 act 让 React 结算订阅回调带来的重渲。
  act(() => { fold.set(processFoldKey('s1', 1, 3), true) })
  expect(rendered()).toEqual(['process', 'member', 'answer'])
})

it('零计数的外部过程可通过真实过程按钮恢复，最终答案不重复', () => {
  const presentation = { ...PRESENTATION, hasExternalProcess: true,
    spec: { ...PRESENTATION.spec, toolCallCount: 0, messageCount: 0, subagentCount: 0 } }
  const { view } = bench(createProcessFold(), presentation, false, true)
  expect(view.container.querySelector('[data-row="member"]')!.closest('[hidden]')?.getAttribute('hidden')).toBe('until-found')
  const button = view.getByRole('button', { name: /第 1 轮/ })
  expect(button.hasAttribute('disabled')).toBe(false)
  fireEvent.click(button)
  expect(view.container.querySelector('[data-row="member"]')).not.toBeNull()
  expect(view.container.querySelectorAll('[data-row="answer"]')).toHaveLength(1)
  fireEvent.click(button)
  expect(view.container.querySelector('[data-row="member"]')!.closest('[hidden]')?.getAttribute('hidden')).toBe('until-found')
})

it('历史尚未加载完整时不隐藏过程成员', () => {
  // 过程控制行可能在未加载页内；保持已有内容可见，不能依赖不可达按钮。
  const { view } = bench(createProcessFold(), PRESENTATION, true)
  expect(view.container.querySelector('[data-row="member"]')).not.toBeNull()
})

it('普通模式展示过程成员，切回紧凑模式保留本轮手动展开状态', () => {
  const { fold, view, setCompact } = bench()
  const rendered = () => [...view.container.querySelectorAll('[data-row]')].filter(node => node.closest('[hidden]') === null).map(node => node.getAttribute('data-row'))
  setCompact(false)
  expect(rendered()).toEqual(['member', 'answer'])
  setCompact(true)
  expect(rendered()).toEqual(['process', 'answer'])
  act(() => { fold.set(processFoldKey('s1', 1, 3), true) })
  setCompact(false)
  expect(rendered()).toEqual(['member', 'answer'])
  setCompact(true)
  expect(rendered()).toEqual(['process', 'member', 'answer'])
})

it.each([
  ['历史尚未加载完整', PRESENTATION, true],
  ['轮次仍在运行', { ...PRESENTATION, turnClosed: false }, false],
  ['答案位置尚未确定', { ...PRESENTATION, spec: { ...PRESENTATION.spec, answerAnchorSeq: null } }, false],
  ['轮次位置尚未对齐', { ...PRESENTATION, turn: 2 }, false],
  ['没有可折叠过程', { ...PRESENTATION, spec: { ...PRESENTATION.spec, messageCount: 0, toolCallCount: 0 } }, false],
] as const)('%s时显示内容且不提供无效过程控制行', (_label, presentation, hasMore) => {
  const { view } = bench(createProcessFold(), presentation, hasMore)
  expect(view.container.querySelector('[data-row="member"]')).not.toBeNull()
  expect(view.container.querySelectorAll('[data-row="answer"]')).toHaveLength(1)
  expect(view.container.querySelector('[data-row="process"]')).toBeNull()
})

it('紧凑模式的最终答案推理随过程展开，普通模式和正文不被过程状态隐藏', () => {
  const presentation = { ...PRESENTATION, spec: { ...PRESENTATION.spec, inlineReasoning: true } }
  const { view, setCompact } = bench(createProcessFold(), presentation, false, true, true)
  const details = view.container.querySelector('details')!
  expect(details.parentElement?.getAttribute('hidden')).toBe('until-found')
  expect(view.getAllByText('最终答案')).toHaveLength(1)
  const process = view.getByRole('button', { name: /第 1 轮/ })
  fireEvent.click(process)
  expect(details.closest('[hidden]')).toBeNull()
  fireEvent.click(details.querySelector('summary')!)
  expect(details.open).toBe(true)
  fireEvent.click(process)
  expect(details.parentElement?.getAttribute('hidden')).toBe('until-found')
  expect(view.getAllByText('最终答案')).toHaveLength(1)
  setCompact(false)
  expect(details.closest('[hidden]')).toBeNull()
  setCompact(true)
  expect(details.parentElement?.getAttribute('hidden')).toBe('until-found')
})

it.each([
  ['非内联推理', PRESENTATION, false],
  ['运行中', { ...PRESENTATION, turnClosed: false, spec: { ...PRESENTATION.spec, inlineReasoning: true } }, false],
  ['历史不完整', { ...PRESENTATION, spec: { ...PRESENTATION.spec, inlineReasoning: true } }, true],
  ['不是最终答案步骤', { ...PRESENTATION, spec: { ...PRESENTATION.spec, inlineReasoning: true, answerStep: 4 } }, false],
] as const)('%s保留可展开的独立推理入口', (_label, presentation, hasMore) => {
  const { view } = bench(createProcessFold(), presentation, hasMore, false, true)
  expect(view.container.querySelector('details')!.closest('[hidden]')).toBeNull()
})

it('查找命中折叠成员时展开所属轮，保留原有 DOM', () => {
  const { view, fold } = bench()
  const member = view.container.querySelector('[data-row="member"]')!
  const wrapper = member.closest('[hidden]')!
  expect(wrapper.getAttribute('hidden')).toBe('until-found')
  fireEvent(wrapper, new Event('beforematch'))
  expect(fold.isOpen(processFoldKey('s1', 1, 3))).toBe(true)
  expect(member.closest('[hidden]')).toBeNull()
  expect(view.container.querySelector('[data-row="member"]')).toBe(member)
})

it('查找揭示内联推理，焦点留在推理内时拒绝将它隐藏', () => {
  const presentation = { ...PRESENTATION, spec: { ...PRESENTATION.spec, inlineReasoning: true } }
  const { view, fold } = bench(createProcessFold(), presentation, false, true, true)
  const reasoning = view.container.querySelector('[data-qs-inline-reasoning]')!
  fireEvent(reasoning, new Event('beforematch'))
  expect(reasoning.hasAttribute('hidden')).toBe(false)
  const summary = reasoning.querySelector('summary')!
  summary.focus()
  act(() => { fold.set(processFoldKey('s1', 1, 3), false) })
  expect(fold.isOpen(processFoldKey('s1', 1, 3))).toBe(true)
  expect(reasoning.hasAttribute('hidden')).toBe(false)
  expect(document.activeElement).toBe(summary)
})

// 无进展是可恢复的分页结果，不隐藏现有内容或冒充历史末尾。
it.each([[false, true], [true, true], [false, false]])('分页无进展提示按 progressed=%s hasMore=%s 展示', (progressed, hasMore) => {
  const { view, props } = bench()
  const loadOlder = vi.fn()
  view.rerender(<div data-qs-scroll><Transcript {...props} loadOlder={loadOlder}
    useQsHistory={select => select({ hasMore, loadingOlder: false, historyLoad: {
      phase: 'succeeded', requestId: 1, connectionEpoch: 1, kind: 'older', progressed, hasMore,
    } })} /></div>)
  expect(view.queryByText('本次未加载到更早的记录，请手动重试。') !== null).toBe(!progressed && hasMore)
  if (hasMore) {
    fireEvent.click(view.getByRole('button', { name: zh['history.loadMore'] }))
    expect(loadOlder).toHaveBeenCalledOnce()
  }
})
