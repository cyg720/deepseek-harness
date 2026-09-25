// @vitest-environment jsdom
/** 根座位在没有当前会话时不请求严格 session 槽。 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { QsRightPanel, type QsRightPanelProps } from '../src/client/RightPanel.tsx'
import type { ReactNode } from 'react'
import { QsGuide, type QsGuideProps } from '../src/client/Guide.tsx'
import { zh } from '../src/client/view-locales.ts'
afterEach(cleanup)
it('无会话时给出说明，隐藏时 inert；选中会话才渲染严格子座位', () => {
  let current: string | undefined = undefined
  const renderSlot = vi.fn(() => <span>session panel</span>)
  const props = { t: (key: keyof typeof zh) => zh[key], hidden: true, requestId: 2, reportOpen: vi.fn(), renderSlot,
    useSessions: (select: (state: { current: string | undefined }) => unknown) => select({ current }),
  } as QsRightPanelProps
  const view = render(<QsRightPanel {...props} />)
  expect(view.getByText(zh['inspector.noSession'])).toBeTruthy()
  expect(view.container.querySelector('aside')?.hasAttribute('inert')).toBe(true)
  expect(renderSlot).not.toHaveBeenCalled()
  view.rerender(<QsRightPanel {...props} hidden={false} />)
  expect(view.container.querySelector('aside')?.hasAttribute('inert')).toBe(false)
  current = 'test'
  view.rerender(<QsRightPanel {...props} />)
  expect(renderSlot).toHaveBeenLastCalledWith('qs.sidebar.right.session', { hidden: true, requestId: 2, reportOpen: props.reportOpen })
})

it('向导条目对应类型已消失时禁用打开，保留可见说明', () => {
  const props = { t: (key: keyof typeof zh) => zh[key],
    useTabInfo: () => ({ tab: { actions: { openTab: vi.fn() } } }),
    useGuideEntries: (select: (value: readonly { kind: string; title: () => string }[]) => unknown) => select([{ kind: 'removed', title: () => 'Removed panel' }]),
    useBodyKeys: (select: (value: readonly string[]) => unknown) => select(['old-definition']),
    definitionId: () => undefined,
    renderSlotChain: (_key: string, _owner: object, options: { fallback: ReactNode }) => options.fallback,
  } as unknown as QsGuideProps
  const view = render(<QsGuide {...props} />)
  expect(view.getByRole('button', { name: 'Removed panel' })).toHaveProperty('disabled', true)
  expect(view.getByText(zh['guide.unavailable'])).toBeTruthy()
})
