// @vitest-environment jsdom
/** 图片 URL 属于正文实例；测试恢复所有全局替换，不依赖真实用户文件。 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { ImageBody } from '../src/client/image/index.tsx'
import type { ImageProps } from '../src/client/image/index.tsx'
import { en } from '../src/client/locales.ts'

const create = vi.fn<(blob: Blob) => string>(), revoke = vi.fn<(url: string) => void>()
let createDescriptor: PropertyDescriptor | undefined, revokeDescriptor: PropertyDescriptor | undefined
beforeEach(() => {
  createDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
  revokeDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
  create.mockReset().mockImplementation(() => `blob:test/${create.mock.calls.length}`)
  revoke.mockReset()
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke })
})
afterEach(() => {
  try { cleanup() } finally {
    if (createDescriptor === undefined) Reflect.deleteProperty(URL, 'createObjectURL')
    else Object.defineProperty(URL, 'createObjectURL', createDescriptor)
    if (revokeDescriptor === undefined) Reflect.deleteProperty(URL, 'revokeObjectURL')
    else Object.defineProperty(URL, 'revokeObjectURL', revokeDescriptor)
  }
})
function props(path = 'sample.png', data: Uint8Array<ArrayBuffer> = new Uint8Array([1, 2])): ImageProps {
  // 此正文只需要内容、地址和字典；不模拟无关标准座位成员。
  return { resourceAddress: `dsh-resource://file/session/image/${path}`, content: { kind: 'bytes', data }, t: makeTranslate(en) } as ImageProps
}
it.each([
  ['PNG', 'image/png'], ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'], ['gif', 'image/gif'],
  ['webp', 'image/webp'], ['bmp', 'image/bmp'], ['ico', 'image/x-icon'], ['svg', 'image/svg+xml'],
])('uses the official media type for %s and releases its URL', (extension, mediaType) => {
  const view = render(<ImageBody {...props(`sample.${extension}`)} />)
  expect(create.mock.calls[0]?.[0].type).toBe(mediaType)
  const img = screen.getByRole('img', { hidden: true })
  expect(img.getAttribute('src')).toBe('blob:test/1')
  expect(img.hasAttribute('hidden')).toBe(true)
  fireEvent.load(img)
  expect(img.hasAttribute('hidden')).toBe(false)
  expect(img.getAttribute('referrerpolicy')).toBe('no-referrer')
  expect(img.getAttribute('draggable')).toBe('false')
  view.unmount()
  expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:test/1')
})
it('releases replaced URLs and isolates old image events from the new document', () => {
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
  const view = render(<ImageBody {...props('unsafe.svg', svg)} />)
  expect(view.container.querySelector('svg,script,iframe,object')).toBeNull()
  const old = screen.getByRole('img', { hidden: true })
  fireEvent.error(old)
  expect(screen.getByRole('alert').textContent).toBe(en.imageFailed)
  view.rerender(<ImageBody {...props('new.png')} />)
  const current = screen.getByRole('img', { hidden: true })
  expect(current).not.toBe(old)
  expect(revoke).toHaveBeenCalledWith('blob:test/1')
  fireEvent.load(old)
  expect(current.hasAttribute('hidden')).toBe(true)
  fireEvent.load(current)
  expect(screen.queryByRole('alert')).toBeNull()
  view.unmount()
  expect(revoke.mock.calls).toEqual([['blob:test/1'], ['blob:test/2']])
})
it('shows creation failures and rejects unsupported content without allocating a URL', () => {
  create.mockImplementationOnce(() => { throw new Error('browser denied Blob') })
  const view = render(<ImageBody {...props()} />)
  expect(screen.getByRole('alert').textContent).toBe(en.imageFailed)
  view.rerender(<ImageBody {...props('file.custom')} />)
  expect(screen.getByRole('alert').textContent).toBe(en.imageUnsupported)
  view.rerender(<ImageBody {...props()} content={{ kind: 'text', text: 'not bytes', pages: [], eof: true }} />)
  expect(screen.getByRole('alert').textContent).toBe(en.imageUnsupported)
  expect(create).toHaveBeenCalledTimes(1)
  expect(revoke).not.toHaveBeenCalled()
  expect(() => ImageBody({ ...props(), resourceAddress: 'invalid' })).toThrow('file address')
})
