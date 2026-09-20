// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import { afterEach, expect, it, vi } from 'vitest'
import type { ChatConversationViewNode, ChatTurnProcessPresentation } from '@deepseek-ai/dsh-client-ui-chat/client'
import { ROW_COMPONENTS, type QsRowProps } from '../src/client/rows.tsx'
import { rowKeyOf } from '../src/client/adapter.ts'
import { zh } from '../src/client/locales.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('copies the complete answer without including its private reasoning', async () => {
  const clipboard = vi.spyOn(primitives, 'writeClipboard').mockResolvedValue(true)
  const view = row('assistant-step', { status: 'settled', blocks: [
    { kind: 'reasoning', text: 'reasoning' }, { kind: 'text', text: 'First' }, { kind: 'text', text: 'Second' },
  ] })
  fireEvent.click(view.getByRole('button', { name: zh['row.copy'] }))
  await waitFor(() => { expect(view.getByRole('button', { name: zh['row.copied'] })).toBeDefined() })
  expect(clipboard).toHaveBeenCalledExactlyOnceWith('First\n\nSecond')
})

/** Render one projected node with the same selector seats as the transcript. */
function row(kind: string, data: unknown, process?: ChatTurnProcessPresentation) {
  const node = { kind, data, visibility: 'visible' } as ChatConversationViewNode
  const props = {
    nodeKey: 'row',
    useNode: (_key, select) => select(node),
    useProcess: (_key, select) => select(process),
    t: (key: keyof typeof zh) => zh[key],
  } as QsRowProps
  const Row = ROW_COMPONENTS[rowKeyOf(kind)]!
  return render(<Row {...props} />)
}

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

it('renders durable process counts without exposing control sequence fields', () => {
  const data = { turn: 1, controlAnchorSeq: 17, toolCallCount: 2, messageCount: 1, subagentCount: 0 }
  const view = row('turn-process', data, { turnClosed: true, compactAnswer: true } as ChatTurnProcessPresentation)
  expect(view.container.textContent).toContain('工具调用: 2')
  expect(view.container.textContent).not.toContain('controlAnchorSeq')
  expect(view.container.querySelector('[data-qs-unknown]')).toBeNull()
})

it('keeps an unfinished process control out of the transcript', () => {
  const view = row('turn-process', {}, { turnClosed: false } as ChatTurnProcessPresentation)
  expect(view.container.textContent).toBe('')
})

it('renders the closing status and exact token total without duplicating the answer', () => {
  const view = row('turn-tail', {
    closing: { status: 'settled', blocks: [{ kind: 'text', text: 'answer already rendered' }] },
    tokenUsage: { totalTokens: 123 },
  })
  expect(view.container.textContent).toBe('生成完成Token 用量: 123')
  expect(view.container.textContent).not.toContain('answer already rendered')
  expect(view.container.querySelector('pre')).toBeNull()
})

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
