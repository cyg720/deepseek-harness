// @vitest-environment jsdom
import { useSearchableHidden } from '@deepseek-ai/dsh-client-ui-chat/src/client/chat/searchable-hidden.ts'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import { afterEach, expect, it, vi } from 'vitest'
import type {
  ChatConversationViewNode, ChatSnapshot, ChatTurnProcessPresentation,
} from '@deepseek-ai/dsh-client-ui-chat/client'
import { ROW_COMPONENTS, type QsRowProps } from '../src/client/rows.tsx'
import { createProcessFold, type QsProcessFold } from '../src/client/process-fold.ts'
import { rowKeyOf } from '../src/client/adapter.ts'
import { zh } from '../src/client/locales.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

/** 行座席的默认输入：折叠状态与节点/轮次订阅都可替换。 */
interface RowOptions {
  readonly renderSlot?: QsRowProps['renderSlot']
  readonly renderSlotChain?: QsRowProps['renderSlotChain']
  readonly process?: ChatTurnProcessPresentation
  readonly fold?: QsProcessFold
  readonly nodes?: readonly ChatConversationViewNode[]
  readonly location?: unknown
  /** 被派发的行组件还是它声明的 kind；用别的 kind 验证“种类改变不残留”。 */
  readonly nodeKind?: string
}

/** 渲染一行，座席形状与转写宿主下发的一致。 */
function row(kind: string, data: unknown, options: RowOptions = {}) {
  const node = {
    kind: options.nodeKind ?? kind,
    data,
    visibility: 'visible',
    anchorSeq: 1,
    location: options.location ?? { kind: 'turn', turn: { turn: 1, status: 'closed', steps: [] } },
  } as unknown as ChatConversationViewNode
  const snapshot = { nodes: { values: () => options.nodes ?? [] } } as unknown as ChatSnapshot
  const props = {
    useSearchableHidden, reasoningHidden: false, revealProcess: () => {},
    nodeKey: 'row', useTurnData: () => undefined, fileMentions: () => undefined,
    useNode: (_key: string, select: (value: ChatConversationViewNode | undefined) => unknown) => select(node),
    useProcess: (_key: string, select: (value: ChatTurnProcessPresentation | undefined) => unknown) =>
      select(options.process),
    useChat: (select: (value: ChatSnapshot) => unknown) => select(snapshot),
    sessionId: 's1',
    renderSlot: options.renderSlot ?? (() => null),
    renderSlotChain: options.renderSlotChain ?? (() => null),
    fold: options.fold ?? createProcessFold(),
    loadImage: () => Promise.resolve('blob:image'),
    // 与运行时一致的占位符替换，断言直接写中文文案。
    t: (key: keyof typeof zh, params?: Record<string, unknown>) => {
      let text: string = zh[key]
      for (const [name, value] of Object.entries(params ?? {})) text = text.replace(`{${name}}`, String(value))
      return text
    },
  } as unknown as QsRowProps
  const Row = ROW_COMPONENTS[rowKeyOf(kind, Object.keys(ROW_COMPONENTS))] ?? ROW_COMPONENTS.unknown!
  return render(<Row {...props} />)
}

const PROCESS_SPEC = {
  turn: 1, controlAnchorSeq: 1, processStartSeq: 1, answerAnchorSeq: 5, answerStep: 3,
  inlineReasoning: false, messageCount: 0, toolCallCount: 0, subagentCount: 0,
}

it('只有带持久消息 ID 的收尾贡献评价动作，中断残片不伪造目标', () => {
  const renderSlot = vi.fn(() => <span>feedback</span>)
  const complete = row('turn-tail', { turn: 1, closing: { status: 'settled', finalNode: { messageId: 'persisted' } } }, { renderSlot })
  expect(renderSlot).toHaveBeenCalledExactlyOnceWith('qs.chat.assistant-actions', { messageId: 'persisted' })
  expect(complete.container.textContent).toContain('feedback')
  complete.unmount(); renderSlot.mockClear()
  row('turn-tail', { turn: 1, closing: { status: 'interrupted', finalNode: {} } }, { renderSlot })
  expect(renderSlot).not.toHaveBeenCalled()
})
const PROCESS_PRESENTATION = {
  turnClosed: true, compactAnswer: true, spec: PROCESS_SPEC,
} as unknown as ChatTurnProcessPresentation

it('copies the complete answer without including its private reasoning', async () => {
  const clipboard = vi.spyOn(primitives, 'writeClipboard').mockResolvedValue(true)
  const view = row('assistant-step', { status: 'settled', blocks: [
    { kind: 'reasoning', text: 'reasoning' }, { kind: 'text', text: 'First' }, { kind: 'text', text: 'Second' },
  ] })
  fireEvent.click(view.getByRole('button', { name: zh['row.copy'] }))
  await waitFor(() => { expect(view.getByRole('button', { name: zh['row.copied'] })).toBeDefined() })
  expect(clipboard).toHaveBeenCalledExactlyOnceWith('First\n\nSecond')
})

it('keeps the complete system prompt and context inside initially closed disclosures', () => {
  for (const kind of ['system-prompt', 'context']) {
    const text = 'long-instructions-'.repeat(1000)
    const view = row(kind, kind === 'context' ? { content: [{ type: 'text', text }] } : { text })
    const disclosure = view.container.querySelector('details')!
    expect(disclosure.open).toBe(false)
    expect(view.container.querySelector('[data-qs-unknown]')).toBeNull()
    expect(disclosure.lastElementChild?.textContent).toBe(text)
    fireEvent.click(disclosure.querySelector('summary')!)
    expect(disclosure.open).toBe(true)
    view.unmount()
  }
})

// ── 过程行（C2） ───────────────────────────────────────────────────────────

it('过程行给出轮次与步骤坐标，计数非零才列出活动', () => {
  const data = {
    turn: 2, controlAnchorSeq: 17, processStartSeq: 17, answerAnchorSeq: 30, answerStep: 3,
    toolCallCount: 2, messageCount: 1, subagentCount: 0,
  }
  const view = row('turn-process', data, { process: { ...PROCESS_PRESENTATION, spec: { ...PROCESS_PRESENTATION.spec, ...data } } })
  expect(view.container.textContent).toContain('第 2 轮')
  expect(view.container.textContent).toContain('步骤 3')
  expect(view.container.textContent).toContain('工具调用 2')
  expect(view.container.textContent).not.toContain(zh['row.agents'])
  expect(view.container.textContent).toContain(zh['row.settled'])
  // 收起时不展开明细，也不出现最终答案。
  expect(view.container.querySelector('ul')).toBeNull()
  expect(view.container.querySelector('[data-qs-unknown]')).toBeNull()
})

it('运行中的过程行按运行中呈现，且不猜步骤号', () => {
  const view = row('turn-process', { turn: 1, toolCallCount: 1, subagentCount: 2 }, {
    process: { turnClosed: false, spec: { ...PROCESS_PRESENTATION.spec, answerStep: null } } as ChatTurnProcessPresentation,
  })
  expect(view.container.textContent).toContain(zh['row.running'])
  expect(view.container.textContent).not.toContain('步骤')
  expect(view.container.textContent).toContain('工具调用 1')
  expect(view.container.textContent).toContain('子任务 2')
})

it('过程行可展开收起，展开状态按会话与轮次写入折叠存储', () => {
  const fold = createProcessFold()
  const view = row('turn-process', { turn: 4, toolCallCount: 2, messageCount: 1 }, { process: PROCESS_PRESENTATION, fold })
  const button = view.getByRole('button')
  expect(button.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(button)
  expect(fold.isOpen('s1|4|3')).toBe(true)
  expect(view.container.querySelector('ul')?.textContent).toContain(zh['row.processDetailHint'])
  fireEvent.click(button)
  expect(fold.isOpen('s1|4|3')).toBe(false)
})

it('运行中步骤取官方轮次位置，最终答案步骤未定也能显示当前步骤', () => {
  for (const step of [1, 2, 3]) {
    // 使用投影发布的步骤，不由工具数量或时间推算。
    const view = row('turn-process', { ...PROCESS_SPEC, answerStep: null }, {
      process: { ...PROCESS_PRESENTATION, turnClosed: false },
      location: { kind: 'turn', turn: { turn: 1, status: 'open', steps: [{ step }] } },
    })
    expect(view.container.textContent).toContain(`步骤 ${step}`)
    view.unmount()
  }
})

it('没有活动计数时过程行不可展开并给出说明', () => {
  const view = row('turn-process', { turn: 5, toolCallCount: 0, messageCount: 0, subagentCount: 0 }, { process: PROCESS_PRESENTATION })
  const button = view.getByRole('button')
  expect(button.hasAttribute('disabled')).toBe(true)
  expect(view.container.textContent).toContain(zh['row.noActivity'])
})

it('过程行在节点撤销或种类改变时不残留文本', () => {
  const view = row('turn-process', {}, { nodeKind: 'user' })
  expect(view.container.textContent).toBe('')
})

// ── 收尾行（C2/C3） ────────────────────────────────────────────────────────

it('收尾行按本轮诊断节点区分成功、失败与截断', () => {
  const tail = { turn: 1, seq: 9, time: 9, closing: { status: 'settled', finalNode: {} }, branchUnavailable: false }
  const ok = row('turn-tail', tail)
  expect(ok.container.querySelector('[data-qs-turn-tail]')?.getAttribute('data-state')).toBe('ok')
  expect(ok.container.textContent).toContain(zh['row.settled'])
  ok.unmount()
  const diagnostic = (kind: string) => ({
    kind, visibility: 'visible', data: {}, anchorSeq: 2,
    location: { kind: 'turn', turn: { turn: 1, status: 'closed', steps: [] } },
  }) as unknown as ChatConversationViewNode
  const failed = row('turn-tail', tail, { nodes: [diagnostic('turn-error')] })
  expect(failed.container.querySelector('[data-qs-turn-tail]')?.getAttribute('data-state')).toBe('failed')
  expect(failed.container.textContent).toContain(zh['row.turnFailed'])
  failed.unmount()
  const truncated = row('turn-tail', tail, { nodes: [diagnostic('turn-max-tokens')] })
  expect(truncated.container.querySelector('[data-qs-turn-tail]')?.getAttribute('data-state')).toBe('truncated')
  expect(truncated.container.textContent).toContain(zh['row.turnTruncated'])
  truncated.unmount()
  // 别的轮次的诊断不影响本行。
  const otherTurn = {
    kind: 'turn-error', visibility: 'visible', data: {}, anchorSeq: 2,
    location: { kind: 'turn', turn: { turn: 7, status: 'closed', steps: [] } },
  } as unknown as ChatConversationViewNode
  const unaffected = row('turn-tail', tail, { nodes: [otherTurn] })
  expect(unaffected.container.querySelector('[data-qs-turn-tail]')?.getAttribute('data-state')).toBe('ok')
})

it('收尾行区分被停止与没有最终回答，并保留未加载提示', () => {
  const stopped = row('turn-tail', { turn: 1, closing: { status: 'interrupted', finalNode: {} } })
  expect(stopped.container.querySelector('[data-qs-turn-tail]')?.getAttribute('data-state')).toBe('stopped')
  stopped.unmount()
  const empty = row('turn-tail', { turn: 1, closing: null })
  expect(empty.container.querySelector('[data-qs-turn-tail]')?.getAttribute('data-state')).toBe('empty')
  expect(empty.container.textContent).toContain(zh['row.turnNoAnswer'])
  empty.unmount()
  const running = row('turn-tail', { turn: 1, closing: { status: 'running', finalNode: {} } })
  expect(running.container.querySelector('[data-qs-turn-tail]')?.getAttribute('data-state')).toBe('running')
  running.unmount()
  const branch = row('turn-tail', { turn: 1, closing: { status: 'settled', finalNode: {} }, branchUnavailable: true })
  expect(branch.container.textContent).toContain(zh['row.branchUnavailable'])
})

it('收尾行只展示已有指标，缺值时不补 0', () => {
  const full = row('turn-tail', {
    turn: 1, closing: { status: 'settled', finalNode: {} },
    ttftMs: 1200.4, tokensPerSecond: 41.6, tokenUsage: { uncachedInputTokens: 100, outputTokens: 23, totalTokens: 123 },
  })
  expect(full.container.textContent).toContain('Token 用量: 123')
  expect(full.container.textContent).toContain('首字延迟: 1200 ms')
  expect(full.container.textContent).toContain('输出吞吐: 42')
  full.unmount()
  const missing = row('turn-tail', { turn: 1, closing: { status: 'settled', finalNode: {} } })
  expect(missing.container.textContent).toContain(zh['row.noMetrics'])
  expect(missing.container.textContent).not.toContain('Token 用量: 0')
  expect(missing.container.textContent).not.toContain('answer already rendered')
  missing.unmount()
  // 部分指标：只显示已有的那几项，其余不补。
  const partial = row('turn-tail', {
    turn: 1, closing: { status: 'settled', finalNode: {} }, tokenUsage: { uncachedInputTokens: 1, outputTokens: 4, totalTokens: 5 }, ttftMs: 10,
  })
  expect(partial.container.textContent).toContain('Token 用量: 5')
  expect(partial.container.textContent).toContain('首字延迟: 10 ms')
  expect(partial.container.textContent).not.toContain(zh['row.tps'])
  partial.unmount()
  const throughputOnly = row('turn-tail', { turn: 1, closing: { status: 'settled', finalNode: {} }, tokensPerSecond: 3 })
  expect(throughputOnly.container.textContent).toContain('输出吞吐: 3')
  expect(throughputOnly.container.textContent).not.toContain(zh['row.tokens'])
})

it('收尾行在节点撤销或种类改变时不残留文本', () => {
  const view = row('turn-tail', {}, { nodeKind: 'user' })
  expect(view.container.textContent).toBe('')
})

// ── 诊断行（C3） ───────────────────────────────────────────────────────────

it('重试行陈述阶段与尝试次数，原因折叠里给已有代码与消息', () => {
  const attempt = {
    retryId: 'r1', turn: 2, step: 1, provider: 'deepseek', mode: 'normal', policyKey: 'p',
    retry: 2, maxRetries: 5, delayMs: 1500, failure: { code: 'TIMEOUT', message: 'request timed out' },
    retryState: 'scheduled', kind: 'model-retry', seq: 4, time: 4,
  }
  const view = row('model-retry', { attempts: [attempt], current: attempt })
  expect(view.container.textContent).toContain(zh['diag.retryTitle'])
  expect(view.container.textContent).toContain('重试 2/5')
  expect(view.container.textContent).toContain('第 2 次重试已排期')
  expect(view.container.textContent).toContain('供应商：deepseek')
  // 排期与等待是官方记录的事实：界面不提供任何动作按钮，原因只在折叠里。
  expect(view.container.querySelectorAll('button')).toHaveLength(0)
  expect(view.container.querySelector('summary')?.textContent).toBe(zh['diag.reason'])
  expect(view.container.querySelector('pre')?.textContent).toBe('TIMEOUT: request timed out')
})

it('重试行覆盖已开始、已取消、无上限与缺失原因', () => {
  const base = {
    retryId: 'r1', turn: 2, step: 1, provider: 'deepseek', policyKey: 'p', delayMs: 1000,
    failure: { code: '', message: '' }, kind: 'model-retry', seq: 4, time: 4,
  }
  const started = row('model-retry', { attempts: [base], current: { ...base, mode: 'always', retry: 1, retryState: 'started' } })
  expect(started.container.textContent).toContain('第 1 次请求已开始')
  expect(started.container.textContent).toContain('第 1 次重试（不设上限）')
  started.unmount()
  const cancelled = row('model-retry', { attempts: [base, base], current: { ...base, mode: 'normal', retry: 3, maxRetries: 3, retryState: 'cancelled' } })
  expect(cancelled.container.textContent).toContain(zh['diag.retryCancelled'])
  expect(cancelled.container.textContent).toContain('共 2 条重试记录')
  expect(cancelled.container.querySelector('pre')?.textContent).toBe(zh['diag.noReason'])
  cancelled.unmount()
  // 有代码但消息被脱敏为空：只显示代码。
  const coded = row('model-retry', {
    attempts: [base],
    current: { ...base, mode: 'normal', retry: 1, maxRetries: 2, retryState: 'started', failure: { code: 'AUTH', message: '' } },
  })
  expect(coded.container.querySelector('pre')?.textContent).toBe('AUTH')
})

it('终态失败行给代码与消息，没有消息时只给代码与下一步提示', () => {
  const view = row('turn-error', { turn: 2, step: 1, message: 'provider returned 500', code: 'PROVIDER' })
  expect(view.container.querySelector('[role="alert"]')).not.toBeNull()
  expect(view.container.textContent).toContain('PROVIDER')
  expect(view.container.textContent).toContain('provider returned 500')
  expect(view.container.textContent).toContain(zh['diag.errorHint'])
  view.unmount()
  const silent = row('turn-error', { turn: 2, step: 1, message: '' })
  expect(silent.container.querySelector('code')).toBeNull()
  expect(silent.container.querySelectorAll('p')).toHaveLength(1)
})

it('输出上限行只给截断提示，不再给倒计时或重试入口', () => {
  const view = row('turn-max-tokens', { turn: 3, step: 2 })
  expect(view.container.textContent).toContain(zh['diag.maxTokensTitle'])
  expect(view.container.textContent).toContain(zh['diag.maxTokensHint'])
  expect(view.container.querySelector('button')).toBeNull()
})

it('诊断行在节点撤销或种类改变时不残留文本', () => {
  for (const kind of ['model-retry', 'turn-error', 'turn-max-tokens']) {
    const view = row(kind, {}, { nodeKind: 'user' })
    expect(view.container.textContent, kind).toBe('')
    view.unmount()
  }
})

// ── 其余行 ─────────────────────────────────────────────────────────────────

it('keeps reasoning collapsed beside the visible final answer', () => {
  const view = row('assistant-step', { status: 'settled', blocks: [
    { kind: 'reasoning', text: 'internal reasoning' }, { kind: 'text', text: 'final answer' },
  ] })
  expect(view.container.querySelector('details')?.open).toBe(false)
  expect(view.container.querySelector('details')?.textContent).toContain('internal reasoning')
  expect(view.container.textContent).toContain('final answer')
})

it('serializes the complete extension payload only while its disclosure is open', () => {
  const payload = { text: 'synthetic-result-'.repeat(10000) }
  const toJSON = vi.fn(() => payload)
  const view = row('future-extension', { toJSON })
  const details = view.container.querySelector('details')!
  expect(details.open).toBe(false)
  expect(toJSON).not.toHaveBeenCalled()
  expect(view.container.querySelector('pre')).toBeNull()
  details.open = true
  fireEvent(details, new Event('toggle'))
  expect(toJSON).toHaveBeenCalledTimes(1)
  expect(view.container.querySelector('pre')?.textContent).toBe(JSON.stringify(payload, null, 2))
  details.open = false
  fireEvent(details, new Event('toggle'))
  expect(view.container.querySelector('pre')).toBeNull()
  expect(toJSON).toHaveBeenCalledTimes(1)
  payload.text = 'updated result'
  details.open = true
  fireEvent(details, new Event('toggle'))
  expect(view.container.querySelector('pre')?.textContent).toBe(JSON.stringify(payload, null, 2))
  expect(toJSON).toHaveBeenCalledTimes(2)
})

/** 节点被隐藏、分页卸载或切换种类时，行组件必须撤销原内容。 */
it.each(Object.keys(ROW_COMPONENTS))('行 %s 在节点撤销或种类改变时不残留文本', (kind) => {
  const Row = ROW_COMPONENTS[rowKeyOf(kind, Object.keys(ROW_COMPONENTS))] ?? ROW_COMPONENTS.unknown!
  const location = { kind: 'turn', turn: { turn: 1, status: 'closed', steps: [] } }
  for (const node of [undefined, { visibility: 'hidden', kind: 'user', data: { content: [{ type: 'text', text: 'secret' }] }, location }, { visibility: 'visible', kind: 'unrelated', data: {}, location }]) {
    if (kind === 'unknown' && node?.visibility === 'visible') continue
    const view = render(<Row {...{
      useSearchableHidden, reasoningHidden: false, revealProcess: () => {},
      nodeKey: 'row', useTurnData: () => undefined, fileMentions: () => undefined,
      useNode: (_key: string, select: (value: unknown) => unknown) => select(node),
      useProcess: (_key: string, select: (value: unknown) => unknown) => select(undefined),
      useChat: (select: (value: ChatSnapshot) => unknown) => select({ nodes: { values: () => [] } } as unknown as ChatSnapshot),
      sessionId: 's1',
      renderSlot: () => null, fold: createProcessFold(), loadImage: () => Promise.resolve('blob:image'),
      t: (key: keyof typeof zh) => zh[key],
    } as unknown as QsRowProps} />)
    expect(view.container.textContent).toBe('')
    view.unmount()
  }
})
it.each(['user', 'context', 'steering'])('消息 %s 非文本历史明确提示支持范围', (kind) => {
  const view = row(kind, { content: [{ type: 'image_url', image_url: { url: 'https://example.invalid/a.png' } }] })
  expect(view.container.textContent).toContain(zh['row.nonText'])
  expect(view.queryByRole('button')).toBeNull()
  expect(view.container.querySelector('img')).toBeNull()
})
it('助手非文本块和无最终文本的推理均不提供空复制动作', () => {
  const view = row('assistant-step', { status: 'running', blocks: [{ kind: 'reasoning', text: 'thinking' }, { kind: 'unsupported' }, { kind: 'tool-call' }] })
  expect(view.container.textContent).toContain(zh['row.nonText'])
  expect(view.queryByRole('button')).toBeNull()
})
it('复制失败给出提示，文本变更后的旧复制结果不能覆盖新消息状态', async () => {
  const deferred = Promise.withResolvers<boolean>()
  const clipboard = vi.spyOn(primitives, 'writeClipboard').mockReturnValueOnce(deferred.promise).mockResolvedValue(false)
  const view = row('user', { content: [{ type: 'text', text: 'old' }] })
  fireEvent.click(view.getByRole('button'))
  view.unmount()
  const next = row('user', { content: [{ type: 'text', text: 'new' }] })
  deferred.resolve(true)
  fireEvent.click(next.getByRole('button'))
  await waitFor(() => { expect(next.getByRole('alert').textContent).toBe(zh['row.copyFailed']) })
  expect(clipboard.mock.calls.map(call => call[0])).toEqual(['old', 'new'])
})

/** 追加的文本说明保持独立人类消息，不误报媒体限制。 */
it('文本追加说明不显示非文本提示', () => {
  const view = row('steering', { content: [{ type: 'text', text: '追加要求' }] })
  expect(view.container.textContent).toContain('追加要求')
  expect(view.container.textContent).not.toContain(zh['row.nonText'])
})


it('压缩摘要默认不挂载，展开可读，缺窗不会伪造数量', () => {
  const data = { kind: 'compaction', seq: 10, time: 1, summary: '压缩后的摘要', summaryEventSeq: 9,
    shadowedItemCount: 3, shadowedTokenCount: 500 }
  const view = row('compaction', data)
  expect(view.container.querySelector('[data-qs-unknown]')).toBeNull()
  expect(view.getByText('已替换模型上下文中的 3 条记录（估算 500 tokens）')).toBeDefined()
  expect(view.queryByText('压缩后的摘要')).toBeNull()
  fireEvent.click(view.getByRole('button', { name: '查看压缩摘要' }))
  expect(view.getByText('压缩后的摘要')).toBeDefined()
  fireEvent.click(view.getByRole('button', { name: '查看压缩摘要' }))
  expect(view.queryByText('压缩后的摘要')).toBeNull()
  view.unmount()
  const missing = row('compaction', { ...data, summary: null, summaryEventSeq: null,
    shadowedItemCount: null, shadowedTokenCount: null })
  expect(missing.getByText('压缩摘要不在当前历史窗口中。')).toBeDefined()
  expect(missing.queryByRole('button')).toBeNull()
  expect(missing.container.textContent).not.toContain('0 tokens')
})

it('手动压缩保留执行状态、完整错误与无 checkpoint 的结算，不虚报落地', () => {
  const command = { kind: 'command', seq: 1, time: 0, commandId: 'compact-1', name: 'compact', args: null, outcome: null }
  const running = row('manual-compaction', { command, compaction: null })
  expect(running.getByText('正在压缩上下文…')).toBeDefined()
  running.unmount()
  for (const kind of ['success', 'error']) {
    const view = row('manual-compaction', { command: { ...command, outcome: { kind, text: 'Host 完整结算原因' } }, compaction: null })
    expect(view.getByText('Host 完整结算原因')).toBeDefined()
    expect(view.queryByText('上下文已压缩')).toBeNull()
    expect(view.getByText(kind === 'error' ? '压缩命令失败' : '压缩命令已结束；当前窗口未见压缩落地记录。')).toBeDefined()
    view.unmount()
  }
  const landed = row('manual-compaction', { command: { ...command, outcome: { kind: 'success' } },
    compaction: { kind: 'compaction', seq: 4, time: 1, summary: '唯一摘要', summaryEventSeq: 3,
      shadowedItemCount: 0, shadowedTokenCount: 0 } })
  expect(landed.container.querySelectorAll('[data-qs-compaction]')).toHaveLength(1)
  expect(landed.getByText('已替换模型上下文中的 0 条记录（估算 0 tokens）')).toBeDefined()
})


it('命令状态直接来自官方结算，完整结果可展开且不重复展示参数', () => {
  const command = { kind: 'command', seq: 1, time: 0, commandId: 'cmd', name: 'permission', args: ' secret-argument', outcome: null }
  const running = row('command', command)
  expect(running.getByText('命令执行中')).toBeDefined()
  expect(running.getByText('permission')).toBeDefined()
  expect(running.container.textContent).not.toContain('secret-argument')
  running.unmount()
  for (const kind of ['success', 'error']) {
    const text = '完整第一行\n完整第二行 <script>alert(1)</script>'
    const view = row('command', { ...command, name: null, outcome: { kind, text } })
    expect(view.getByText('命令')).toBeDefined()
    expect(view.getByText(kind === 'error' ? '命令失败' : '命令已完成')).toBeDefined()
    expect(view.container.querySelector('pre')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: '查看完整命令结果' }))
    expect(view.container.querySelector('pre')?.textContent).toBe(text)
    expect(view.container.querySelector('script')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: '查看完整命令结果' }))
    expect(view.container.querySelector('pre')).toBeNull()
    view.unmount()
  }
  const noText = row('command', { ...command, outcome: { kind: 'success' } })
  expect(noText.getByText('命令已完成')).toBeDefined()
  expect(noText.queryByRole('button')).toBeNull()
})


it('轮次附加呈现使用官方轮次位置及最终回答序号，缺少轮次不伪造交付', () => {
  const renderSlotChain = vi.fn(() => null)
  const location = { kind: 'step', turn: { turn: 3, data: new Map() }, step: 1 }
  const view = row('turn-tail', { seq: 40, closing: { finalNode: { seq: 38 } } }, { location, renderSlotChain })
  expect(renderSlotChain).toHaveBeenCalledExactlyOnceWith('qs.chat.turn-tail', { turn: location.turn, seq: 38 })
  view.unmount(); renderSlotChain.mockClear()
  const empty = row('turn-tail', { seq: 40, closing: null }, { location, renderSlotChain })
  expect(renderSlotChain).toHaveBeenCalledExactlyOnceWith('qs.chat.turn-tail', { turn: location.turn, seq: 40 })
  empty.unmount(); renderSlotChain.mockClear()
  row('turn-tail', { seq: 40, closing: null }, { location: { kind: 'session' }, renderSlotChain })
  expect(renderSlotChain).not.toHaveBeenCalled()
})
