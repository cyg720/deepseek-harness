// @vitest-environment jsdom
/** 主区必须在有会话时才请求严格 session 槽；欢迎文案允许单行。 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { QsStage, type QsStageProps } from '../src/client/Stage.tsx'
import { QsWelcomePane } from '../src/client/WelcomePane.tsx'
import { zh } from '../src/client/view-locales.ts'
afterEach(cleanup)
it.each([
  { current: undefined, blank: undefined },
  { current: 'session-a', blank: false },
  { current: 'session-a', blank: true },
  { current: 'session-a', blank: undefined },
])('按会话及空白摘要渲染欢迎与转写槽 %j', ({ current, blank }) => {
  const renderSlot = vi.fn((name: string) => <span>{name}</span>)
  const props = { t: (key: keyof typeof zh) => (zh as Readonly<Record<string, string>>)[key] ?? key, renderSlot, useSessions: (select: (s: unknown) => unknown) => select({ current, byId: { 'session-a': { displayTitle: '泵站检查', blank } } }) } as unknown as QsStageProps
  const view = render(<QsStage {...props} />)
  expect(renderSlot.mock.calls.flat().includes('qs.stage.body')).toBe(current === undefined || blank === true)
  expect(renderSlot.mock.calls.flat().includes('qs.stage.transcript')).toBe(current !== undefined)
  expect(renderSlot.mock.calls.flat().includes('qs.stage.header.actions')).toBe(current !== undefined)
  expect(renderSlot.mock.calls.flat().includes('qs.stage.pending')).toBe(current !== undefined)
  expect(renderSlot.mock.calls.flat().includes('qs.composer.dock')).toBe(current !== undefined)
  expect(view.container.querySelector('[data-qs-scroll]')?.textContent).not.toContain('qs.composer.dock')
  expect(view.container.querySelector('[data-qs-scroll]')?.textContent).not.toContain('qs.stage.pending')
  expect(view.container.textContent).toContain(current ? '泵站检查' : zh['stage.newSession'])
})
it.each(['第一行\n第二行', '只有一行'])('欢迎标题保持内容可读 %s', (title) => {
  const renderSlot = vi.fn((name: string) => <span>{name === 'qs.workspace.hero' ? 'workspace entry' : 'preset entry'}</span>)
  render(<QsWelcomePane renderSlot={renderSlot} t={key => key === 'welcome.title' ? title : (zh as Readonly<Record<string, string>>)[key] ?? key} />)
  expect(renderSlot).toHaveBeenCalledWith('qs.workspace.hero', {})
  expect(renderSlot).toHaveBeenCalledWith('qs.workspace.hero.agentPreset', {})
  expect(screen.getByText('preset entry')).toBeDefined()
  expect(screen.getByText('workspace entry')).toBeDefined()
  expect(screen.getByRole('heading').textContent).toBe(title.replace('\n', ''))
})

/** 选择尚未列出的会话时不把未知历史视作空白，避免欢迎区闪现。 */
it('does not show the welcome area for a selected session missing from the list', () => {
  const renderSlot = vi.fn(() => null)
  render(<QsStage {...{ t: () => '', renderSlot, useSessions: (select: (state: unknown) => unknown) =>
    select({ current: 'missing', byId: {} }) } as unknown as QsStageProps} />)
  expect(renderSlot.mock.calls.flat()).not.toContain('qs.stage.body')
})
