// @vitest-environment jsdom
/** 收尾发布后才启用官方文件词表，页面通过实际轮次数据源响应迟到更新。 */
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, renderHook } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { ChatConversationViewNode, TurnTailChatData } from '@deepseek-ai/dsh-client-ui-chat/client'
import { ROW_COMPONENTS, type QsRowProps } from '../src/client/rows.tsx'
import { turnDataFactory } from '../src/client/turn-data.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)
function fixture() {
  const source = createSnapshotStore<TurnTailChatData | undefined>(undefined)
  // 仅 turn-tail 键参与本例，仍使用可订阅的真实 snapshot store。
  const data = { source: () => source } as unknown as NonNullable<Parameters<typeof turnDataFactory>[1]>
  const useTurnData = turnDataFactory({} as Parameters<typeof turnDataFactory>[0], data)
  const turn = { status: 'closed', turn: 1, data }
  const node = { kind: 'assistant-step', visibility: 'visible', location: { kind: 'step', turn },
    data: { status: 'settled', finalNode: { seq: 10 }, blocks: [{ kind: 'text', text: '`report.txt` and `unknown.txt`' }] },
  } as unknown as ChatConversationViewNode
  const open = vi.fn(), fileMentions = vi.fn<QsRowProps['fileMentions']>(() => ({
    resolve: path => path === 'report.txt' ? { label: 'Preview report.txt', title: path, open } : undefined,
  }))
  const props = { nodeKey: 'answer', useNode: (_key, select) => select(node), useTurnData, fileMentions, t: makeTranslate(en) } as QsRowProps
  const publish = (seq: number) => { source.set({ closing: { finalNode: { seq } } } as TurnTailChatData) }
  return { props, source, turn, node, open, fileMentions, publish }
}
it('activates only the final answer after its closing record arrives and keeps unknown names inert', () => {
  const h = fixture(), Row = ROW_COMPONENTS['assistant-step']!, view = render(<Row {...h.props} />)
  expect(view.queryByRole('button', { name: 'Preview report.txt' })).toBeNull()
  expect(h.fileMentions).not.toHaveBeenCalled()
  act(() => { h.publish(10) })
  fireEvent.click(view.getByRole('button', { name: 'Preview report.txt' }))
  expect(h.open).toHaveBeenCalledOnce()
  expect(h.fileMentions).toHaveBeenCalledWith({ turn: h.turn, seq: 10 })
  expect(view.queryByRole('button', { name: /unknown/ })).toBeNull()
  act(() => { h.publish(11) })
  expect(view.queryByRole('button', { name: 'Preview report.txt' })).toBeNull()
  view.unmount()
  const calls = h.fileMentions.mock.calls.length
  act(() => { h.publish(10) })
  expect(h.fileMentions).toHaveBeenCalledTimes(calls)
})
it('does not activate a non-final or still-open turn even with a closing value present', () => {
  const h = fixture(), Row = ROW_COMPONENTS['assistant-step']!
  h.turn.status = 'open'; h.publish(10)
  const view = render(<Row {...h.props} />)
  expect(h.fileMentions).not.toHaveBeenCalled()
  h.turn.status = 'closed'
  const data = { status: 'running', blocks: [{ kind: 'text', text: '`report.txt`' }] }
  view.rerender(<Row {...h.props} useNode={(_key, select) => select({ ...h.node, data })} />)
  expect(h.fileMentions).not.toHaveBeenCalled()
})
it('supplies an empty observable for rows outside a turn and releases its subscription', () => {
  const useTurnData = turnDataFactory({} as Parameters<typeof turnDataFactory>[0], undefined)
  const hook = renderHook(() => useTurnData('turn-tail'))
  expect(hook.result.current).toBeUndefined()
  hook.unmount()
})
