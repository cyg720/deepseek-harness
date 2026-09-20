// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { ROW_COMPONENTS, type QsRowProps } from '../src/client/rows.tsx'
import { hasNonTextContent, localImageUrl } from '../src/client/media.ts'
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

function row(kind: string, data: unknown) {
  const node = { kind, data, visibility: 'visible' } as ChatConversationViewNode
  const Row = ROW_COMPONENTS[kind]!
  const props = {
    nodeKey: 'test', useNode: (_key, select) => select(node),
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
