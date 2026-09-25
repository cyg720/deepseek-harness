// @vitest-environment jsdom
/** 使用可控 Promise 验证换图和卸载时序，不依赖真实网络或定时睡眠。 */
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { GalleryProps } from '../src/client/contract.ts'
import { Gallery } from '../src/client/Gallery.tsx'
import { zh } from '../src/client/locales.ts'
const t = ((key: keyof typeof zh) => zh[key]) as GalleryProps['t']
const images: GalleryProps['images'] = [{ attachment: { attachmentId: 'a' as never, mediaType: 'image/png', bytes: 1, width: 1, height: 1 } }]
afterEach(() => { cleanup(); vi.restoreAllMocks() })
it('loads the authorized image, opens its original and closes with Escape', async () => {
  const loadImage = vi.fn(() => Promise.resolve('blob:image'))
  const view = render(<Gallery images={images} loadImage={loadImage} align="end" t={t} />)
  expect(view.getByRole('status').textContent).toBe(zh.loading)
  await waitFor(() => { expect(view.getByRole('img').getAttribute('src')).toBe('blob:image') })
  expect(loadImage).toHaveBeenCalledWith(('attachment' in images[0]! ? images[0].attachment : undefined))
  const opener = view.getByRole('button')
  opener.focus()
  fireEvent.click(opener)
  expect(document.activeElement).toBe(view.getByRole('button', { name: zh.close }))
  fireEvent.keyDown(window, { key: 'Enter' })
  expect(view.getByRole('dialog')).toBeTruthy()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(view.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(opener)
  fireEvent.click(view.getByRole('button'))
  fireEvent.error(view.getByRole('dialog').querySelector('img')!)
  expect(view.queryByRole('dialog')).toBeNull()
  expect(view.getByText(zh.failed)).toBeTruthy()
})
it('retries load and decode failures, and displays local echo previews without loading', async () => {
  const loadImage = vi.fn().mockRejectedValueOnce(new Error('denied')).mockResolvedValue('blob:ok')
  const view = render(<Gallery images={images} loadImage={loadImage} align="start" compact t={t} />)
  fireEvent.click(await view.findByText(zh.failed))
  const img = await view.findByRole('img')
  expect(loadImage).toHaveBeenCalledTimes(2)
  fireEvent.error(img)
  expect(view.getByText(zh.failed)).toBeTruthy()
  view.rerender(<Gallery images={[{ preview: { url: 'blob:preview', name: 'draft' } }]} loadImage={loadImage} align="start" t={t} />)
  expect(view.getByRole('img').getAttribute('src')).toBe('blob:preview')
  expect(loadImage).toHaveBeenCalledTimes(2)
})
it('ignores a replaced image response and a rejection after unmount', async () => {
  const first = Promise.withResolvers<string>(), second = Promise.withResolvers<string>()
  const loadImage = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
  const view = render(<Gallery images={images} loadImage={loadImage} align="start" t={t} />)
  const next: GalleryProps['images'] = [{ attachment: {
    attachmentId: 'b' as never, mediaType: 'image/png', bytes: 1, width: 1, height: 1, name: 'next' } }]
  view.rerender(<Gallery images={next} loadImage={loadImage} align="start" t={t} />)
  await act(async () => { first.resolve('blob:stale'); await first.promise })
  expect(view.queryByRole('img')).toBeNull()
  view.unmount()
  await act(async () => { second.reject(new Error('late')); await Promise.resolve() })
})

it('closes from the full-screen mask and tolerates an absent original focus target', () => {
  const focus = vi.spyOn(document, 'activeElement', 'get').mockReturnValue(null)
  const view = render(<Gallery images={[{ preview: { url: 'blob:preview' } }]} loadImage={vi.fn(() => Promise.resolve('unused'))} align="start" t={t} />)
  fireEvent.click(view.getByRole('button'))
  const dialog = view.getByRole('dialog')
  expect(dialog.parentElement).toBe(document.body)
  fireEvent.mouseDown(dialog.querySelector('[aria-hidden="true"]')!)
  expect(view.queryByRole('dialog')).toBeNull()
  focus.mockRestore()
})
