// @vitest-environment jsdom
/** qs-transcript 的装饰图标保持尺寸类、自定义类和不可聚焦语义。 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { QsIcon } from '../src/client/Icon.tsx'
afterEach(cleanup)
it('SVG 尺寸与自定义类不覆盖可访问性属性', () => {
  const view = render(<QsIcon name="spark" />)
  const svg = view.container.querySelector('svg')!
  expect(svg.getAttribute('aria-hidden')).toBe('true')
  expect(svg.getAttribute('focusable')).toBe('false')
  expect(svg.querySelector('path')?.getAttribute('d')).toBeTruthy()
  view.rerender(<QsIcon name="spark" size="xs" className="custom" />)
  expect(svg.classList.contains('custom')).toBe(true)
  expect(svg.classList.contains('qs-icon-xs')).toBe(true)
})
