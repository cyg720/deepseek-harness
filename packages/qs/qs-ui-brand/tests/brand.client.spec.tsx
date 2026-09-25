// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { BrandMark, BrandName } from '../src/client/Brand.tsx'
import { zh } from '../src/client/locales.ts'
afterEach(cleanup)
it('presents the brand without exposing decorative artwork to accessibility', () => {
  const { container } = render(<><BrandMark /><BrandName t={key => (zh as Readonly<Record<string, string>>)[key] ?? key} /></>)
  expect(screen.getByText(zh.name)).toBeTruthy()
  expect(screen.getByText(zh.tagline)).toBeTruthy()
  expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
})
