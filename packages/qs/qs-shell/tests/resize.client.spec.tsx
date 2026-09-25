// @vitest-environment jsdom
/** 拖拽以可见面板宽度为起点，取消捕获后不得继续改变布局。 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { PanelResize } from '../src/client/PanelResize.tsx'
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
it.each(['left', 'right'] as const)('%s 面板支持双向拖动、键盘和取消', (side) => {
  // jsdom 不实现指针捕获；补齐浏览器事件字段，宽度仍从实际相邻 DOM 读取。
  class Pointer extends MouseEvent { pointerId = 7 }
  vi.stubGlobal('PointerEvent', Pointer)
  const onResize = vi.fn()
  const panel = <div><aside /></div>
  render(<div>{side === 'left' && panel}<PanelResize side={side} label="resize" onResize={onResize} />{side === 'right' && panel}</div>)
  const separator = screen.getByRole('separator')
  vi.spyOn(document.querySelector('aside')!, 'getBoundingClientRect').mockReturnValue({ width: 240 } as DOMRect)
  separator.setPointerCapture = vi.fn()
  separator.hasPointerCapture = vi.fn(() => true)
  const release = vi.fn()
  separator.releasePointerCapture = release
  fireEvent.pointerMove(separator, { clientX: 120 })
  fireEvent.pointerDown(separator, { button: 2, clientX: 100 })
  fireEvent.pointerMove(separator, { clientX: 120 })
  expect(onResize).not.toHaveBeenCalled()
  fireEvent.pointerDown(separator, { button: 0, clientX: 100 })
  fireEvent.pointerMove(separator, { clientX: 120 })
  expect(onResize).toHaveBeenLastCalledWith(side, side === 'left' ? 260 : 220)
  fireEvent.pointerUp(separator)
  expect(release).toHaveBeenCalledWith(7)
  onResize.mockClear()
  fireEvent.pointerMove(separator, { clientX: 140 })
  expect(onResize).not.toHaveBeenCalled()
  for (const cancel of [fireEvent.pointerCancel, fireEvent.lostPointerCapture]) {
    fireEvent.pointerDown(separator, { button: 0, clientX: 100 })
    cancel(separator)
    fireEvent.pointerMove(separator, { clientX: 140 })
    expect(onResize).not.toHaveBeenCalled()
  }
  separator.hasPointerCapture = vi.fn(() => false)
  fireEvent.pointerUp(separator)
  expect(release).toHaveBeenCalledOnce()
  fireEvent.keyDown(separator, { key: 'Enter' })
  expect(onResize).not.toHaveBeenCalled()
  for (const key of ['ArrowLeft', 'ArrowRight']) {
    fireEvent.keyDown(separator, { key })
    expect(onResize).toHaveBeenLastCalledWith(side, 240 + (key === 'ArrowRight' ? 10 : -10) * (side === 'left' ? 1 : -1))
  }
})
it.each(['aside', 'empty', 'missing'])('键盘调整容许 %s 相邻面板', (kind) => {
  const onResize = vi.fn()
  render(<div>{kind === 'aside' ? <aside /> : kind === 'empty' ? <div /> : null}<PanelResize side="left" label="resize" onResize={onResize} /></div>)
  if (kind === 'aside') vi.spyOn(document.querySelector('aside')!, 'getBoundingClientRect').mockReturnValue({ width: 240 } as DOMRect)
  fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowRight' })
  expect(onResize).toHaveBeenCalledWith('left', kind === 'aside' ? 250 : 10)
})
