// @vitest-environment jsdom
/** 历史台账按原始节点顺序读取，折叠时不挂载正文或内部对象。 */
import type { ComponentProps } from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ConversationNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { History } from '../src/client/History.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
const t = ((key: keyof typeof zh) => zh[key]) as ComponentProps<typeof History>['t']
type Block = Extract<ConversationNode, { kind: 'user' }>['content'][number]
const image = { attachmentId: 'image-id' as never, mediaType: 'image/png' as const, bytes: 1, width: 1, height: 1 }

it('历史消息、嵌套结果及媒体限制按文本呈现，未知扩展不泄漏原始对象', () => {
  const content: Block[] = [
    { type: 'text', text: '<script>history-secret</script>' }, { type: 'reasoning', text: 'reasoned text' },
    { type: 'tool-call', id: 'call' as never, name: 'read_file', arguments: '{"path":"example.txt"}' },
    { type: 'tool-result', toolCallId: 'call' as never, content: [{ type: 'text', text: 'nested result' }] },
    { type: 'tool-result', toolCallId: 'bad' as never, isError: true, content: [] },
    { type: 'image', attachment: image },
    { type: 'file', attachment: { attachmentId: 'file-id' as never, name: 'example.txt', bytes: 12 } },
    // 旧 Client 可能遇到由另一插件写入的扩展块，这是持久化兼容输入。
    { type: 'extension-record', internal: 'never expose extension internals' } as unknown as Block,
  ]
  const nodes: ConversationNode[] = [
    { kind: 'user', seq: 1, time: 1, content, source: null },
    { kind: 'steering', seq: 2, time: 2, content: [{ type: 'text', text: 'follow-up' }], source: null, messageId: 'follow-up' as never },
    { kind: 'context', seq: 3, time: 3, content: [], source: null, provenance: { role: 'inject', label: null }, form: null },
    { kind: 'assistant', seq: 4, time: 4, turn: 1, step: 1, blocks: [
      { kind: 'text', text: 'assistant result' }, { kind: 'reasoning', text: 'assistant reasoning' },
      { kind: 'tool-call', callId: 'call', name: 'read_file', argsRaw: '{}' },
      { kind: 'image', attachment: image }, { kind: 'other', block: { secret: 'hidden assistant payload' } },
    ] },
    { kind: 'tool-result', seq: 5, time: 5, callId: 'call', call: { name: 'read_file', argsRaw: '{}' }, callTime: 4, content: [], isError: false, subCalls: [] },
    { kind: 'tool-result', seq: 6, time: 6, callId: 'out-of-window-call', call: null, callTime: null, content: [], isError: true, subCalls: [] },
    { kind: 'compaction', seq: 7, time: 7, summary: 'recorded summary', summaryEventSeq: 6, shadowedItemCount: 4, shadowedTokenCount: 8 },
    { kind: 'compaction', seq: 8, time: 8, summary: null, summaryEventSeq: null, shadowedItemCount: null, shadowedTokenCount: null },
    { kind: 'unknown', seq: 9, time: 9, type: 'future-event', data: { token: 'never expose unknown event' } },
  ]
  const page = render(<History expandedRecords={new Set()} nodes={nodes} t={t} renderImages={() => null} />)
  expect(page.container.textContent).not.toContain('history-secret')
  expect(page.getByText(zh['record.scope'])).toBeTruthy()
  const details = [...page.container.querySelectorAll('details')]
  expect(details.map(node => node.dataset.qsTrajectoryRecord)).toEqual(nodes.map(node => String(node.seq)))
  for (const detail of details) { detail.open = true; fireEvent(detail, new Event('toggle')) }
  expect(page.getByText('<script>history-secret</script>')).toBeTruthy()
  expect(page.getByText('nested result')).toBeTruthy()
  expect(page.getByText('assistant result')).toBeTruthy()
  expect(page.getByText('out-of-window-call')).toBeTruthy()
  expect(page.getByText('recorded summary')).toBeTruthy()
  expect(page.getByText(zh.missing)).toBeTruthy()
  expect(page.getAllByText(zh['record.image'])).toHaveLength(2)
  expect(page.getByText(zh['record.file'])).toBeTruthy()
  const file = page.container.querySelector('[data-qs-trajectory-file]')!
  expect(file.textContent).toContain('example.txt')
  expect(file.textContent).toContain('12')
  expect(file.querySelector('a,button')).toBeNull()
  expect(page.container.querySelector('script, img')).toBeNull()
  expect(page.container.textContent).not.toContain('never expose')
  expect(page.container.textContent).not.toContain('hidden assistant payload')
  details[0]!.open = false; fireEvent(details[0]!, new Event('toggle'))
  expect(page.container.textContent).not.toContain('history-secret')
  page.rerender(<History expandedRecords={new Set()} nodes={[]} t={t} renderImages={() => null} />)
  expect(page.container.textContent).toBe('')
})

// 宿主只在展开后调用附件呈现，收起后移除图片内容。
it('历史图片按来源交给附件插件且收起时不保留呈现', () => {
  const renderImages = vi.fn(() => <span data-testid="media">authorized image</span>)
  const nodes: ConversationNode[] = [{ kind: 'user', seq: 1, time: 1, source: null, content: [
    { type: 'tool-result', toolCallId: 'call' as never, content: [{ type: 'image', attachment: image }] },
  ] }, { kind: 'assistant', seq: 2, time: 2, turn: 1, step: 1, blocks: [{ kind: 'image', attachment: image }] }]
  const page = render(<History expandedRecords={new Set()} nodes={nodes} t={t} renderImages={renderImages} />)
  expect(renderImages).not.toHaveBeenCalled()
  const details = [...page.container.querySelectorAll('details')]
  for (const detail of details) { detail.open = true; fireEvent(detail, new Event('toggle')) }
  expect(page.getAllByTestId('media')).toHaveLength(2)
  expect(renderImages).toHaveBeenCalledWith({ images: [{ attachment: image }], align: 'start' })
  expect(page.queryByText(zh['record.image'])).toBeNull()
  for (const detail of details) { detail.open = false; fireEvent(detail, new Event('toggle')) }
  expect(page.queryByTestId('media')).toBeNull()
})
