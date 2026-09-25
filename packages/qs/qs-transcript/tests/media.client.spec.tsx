// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { ROW_COMPONENTS, type QsRowProps } from '../src/client/rows.tsx'
// 媒体行使用与运行时一致的行键解析，未知类型走显式兜底。
import { rowKeyOf } from '../src/client/adapter.ts'
import { hasNonTextContent, historyFile, historyImages, localImageUrl } from '../src/client/media.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

it.each(['/tmp/image a.png', 'C:\\work\\image.png', 'D:/work/image.png'])('routes local image %s through the same-origin file policy', (path) => {
  expect(localImageUrl('http:', 'http://localhost', path)).toBe(`http://localhost/api/file?path=${encodeURIComponent(path)}`)
})

it.each(['//external.test/img', 'relative.png', 'javascript:alert(1)', 'https://external.test/img'])('does not rewrite unsupported destination %s', (path) => {
  expect(localImageUrl('https:', 'https://localhost', path)).toBeUndefined()
})

it('does not manufacture a Web file URL for desktop protocols', () => {
  expect(localImageUrl('dsh-app:', 'null', '/tmp/a.png')).toBeUndefined()
  expect(hasNonTextContent([{ type: 'text', text: 'visible' }])).toBe(false)
  expect(hasNonTextContent([null])).toBe(true)
  expect(hasNonTextContent([{ type: 'image', data: 'unrendered' }])).toBe(true)
})

function row(kind: string, data: unknown, renderSlot: (slot: string, owner: unknown) => ReactNode = vi.fn(() => null)) {
  const node = { kind, data, visibility: 'visible' } as ChatConversationViewNode
  const Row = ROW_COMPONENTS[rowKeyOf(kind, ['user', 'steering', 'context', 'assistant-step', 'system-prompt', 'turn-process', 'turn-tail'])] ?? ROW_COMPONENTS.unknown!
  const props = {
    renderMessageImages: owner => renderSlot('qs.conversation.message.images', owner), renderSlot, loadImage: () => Promise.resolve('blob:image'), nodeKey: 'test', useTurnData: () => undefined, fileMentions: () => undefined, useNode: (_key, select) => select(node),
    useProcess: (_key, select) => select(undefined), t: (key: keyof typeof zh) => zh[key],
  } as QsRowProps // Only the selector and locale seats used by these rows are supplied.
  return render(<Row {...props} />)
}

it.each(['user', 'steering', 'context'])('does not silently discard non-text %s history', (kind) => {
  const view = row(kind, { content: [{ type: 'text', text: 'retained text' }, { type: 'image', data: 'image' }] })
  expect(view.container.textContent).toContain('retained text')
  expect(view.container.textContent).toContain(zh['row.nonText'])
})

it('keeps unsupported assistant blocks visible and renders local Markdown media safely', () => {
  const view = row('assistant-step', { status: 'settled', blocks: [
    { kind: 'text', text: '![local](/tmp/image.png) [bad](javascript:alert(1))' },
    { kind: 'image', attachment: {} },
  ] })
  expect(view.container.textContent).toContain(zh['row.nonText'])
  expect(view.container.querySelector('img')?.getAttribute('src')).toBe(`${window.location.origin}/api/file?path=%2Ftmp%2Fimage.png`)
  expect(view.container.querySelector('a[href^="javascript:"]')).toBeNull()
})

it('forwards durable images but preserves notices for mixed unsupported content', () => {
  const attachment = { attachmentId: 'x', mediaType: 'image/png', bytes: 1, width: 1, height: 1 }
  const renderSlot: (slot: string, owner: unknown) => ReactNode = vi.fn(() => null)
  const view = row('user', { content: [{ type: 'image', attachment }, { type: 'audio', data: 'unsupported' }] }, renderSlot)
  expect(renderSlot).toHaveBeenCalledWith('qs.conversation.message.images', expect.objectContaining({
    images: [{ attachment }], align: 'end',
  }))
  expect(view.container.textContent).toContain(zh['row.nonText'])
  expect(historyImages([{ type: 'image', attachment: null }, { type: 'image', attachment: {} }])).toEqual([])
  expect(historyImages([{ type: 'image', attachment: { ...attachment, width: Infinity } }])).toEqual([])
  expect(historyImages([{ type: 'image', attachment: { ...attachment, name: {} } }])).toEqual([])
  expect(historyImages([{ type: 'image', attachment: { ...attachment, mediaType: 'text/html' } }])).toEqual([])
})

it('preserves the attachment order and renders ordinary file metadata as text without navigation', () => {
  const image = { attachmentId: 'i', mediaType: 'image/png', bytes: 1, width: 1, height: 1 }
  const file = { attachmentId: 'f', name: '<script>alert(1)</script>.pdf', bytes: 2048 }
  const slots = vi.fn((_name: string, _owner: unknown) => <span data-image-seat />)
  const view = row('user', { content: [{ type: 'file', attachment: file }, { type: 'image', attachment: image }] }, slots)
  const group = view.container.querySelector('[data-qs-message-attachments]')!
  expect(group.children[0]!.getAttribute('data-qs-file-card')).toBe('true')
  expect(group.children[1]!.hasAttribute('data-image-seat')).toBe(true)
  expect(group.textContent).toContain(file.name)
  expect(group.textContent).toContain('2.0KB')
  expect(group.querySelector('script,a,button')).toBeNull()
  expect(view.container.textContent).not.toContain(zh['row.nonText'])
  expect(historyFile({ type: 'file', attachment: null })).toBeUndefined()
  expect(historyFile({ type: 'file', attachment: {} })).toBeUndefined()
  expect(historyFile({ type: 'file', attachment: { ...file, bytes: -1 } })).toBeUndefined()
})
