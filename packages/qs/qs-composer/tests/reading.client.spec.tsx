// @vitest-environment jsdom
/** 使用官方真实 store 检查阅读切换、定位消费与卸载回退。 */
import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createConversationStore } from '@deepseek-ai/dsh-client-ui-conversation/src/client/stores.ts'
import type { ConversationStoreState, ViewTab, ConvViewOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { Reading, type ReadingProps } from '../src/client/Reading.tsx'
import { zh } from '../src/client/view-locales.ts'
afterEach(() => { cleanup(); localStorage.clear() })
it('切换、定位、卸载回退均保留共享草稿和偏好', () => {
  const store = createConversationStore().create('reading-test'), activate = vi.fn()
  let views: readonly ViewTab[] = []
  let owner: ConvViewOwnerProps | undefined
  const renderSlot = vi.fn((_name: string, props: ConvViewOwnerProps) => { owner = props; return <p>轨迹正文</p> })
  const props = {
    chat: <p>聊天正文</p>, actions: store.actions, activate, renderSlot,
    useStore: (select: (state: ConversationStoreState) => unknown) =>
      useSyncExternalStore(listener => store.subscribe(listener), () => select(store.getSnapshot())),
    useReadingViews: (select: (items: readonly ViewTab[]) => unknown) => select(views),
    t: (key: keyof typeof zh) => zh[key],
  } as unknown as ReadingProps
  const page = render(<Reading {...props} />)
  expect(screen.queryByRole('tablist')).toBeNull()
  expect(screen.getByText('聊天正文')).toBeTruthy()
  act(() => { store.actions.setDraft('保留的输入') })
  views = [{ id: 'trajectory', label: '请求轨迹' }]; page.rerender(<Reading {...props} />)
  const chatTab = screen.getByRole('tab', { name: '对话摘要' })
  const traceTab = screen.getByRole('tab', { name: '请求轨迹' })
  act(() => { chatTab.focus() })
  fireEvent.keyDown(chatTab, { key: 'ArrowLeft' })
  expect(document.activeElement).toBe(traceTab)
  expect(screen.getByText('聊天正文')).toBeTruthy()
  expect(traceTab.tabIndex).toBe(0)
  fireEvent.keyDown(traceTab, { key: 'ArrowRight' })
  expect(document.activeElement).toBe(chatTab)
  fireEvent.keyDown(chatTab, { key: 'End' })
  expect(document.activeElement).toBe(traceTab)
  fireEvent.keyDown(traceTab, { key: 'Home' })
  expect(document.activeElement).toBe(chatTab)
  fireEvent.keyDown(chatTab, { key: 'Escape' })
  expect(document.activeElement).toBe(chatTab)
  act(() => { traceTab.focus() })
  fireEvent.click(traceTab)
  expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(traceTab.id)
  expect(traceTab.getAttribute('aria-controls')).toBe(screen.getByRole('tabpanel').id)
  expect(screen.queryByText('聊天正文')).toBeNull()
  expect(screen.getByText('轨迹正文')).toBeTruthy()
  expect(store.getSnapshot().draft).toBe('保留的输入')
  act(() => { owner!.openView('trajectory', 'request-9') })
  expect(owner!.viewRequest).toEqual({ view: 'trajectory', focus: 'request-9' })
  act(() => { owner!.completeViewRequest() })
  expect(store.getSnapshot().viewRequest).toBeNull()
  views = []; page.rerender(<Reading {...props} />)
  expect(screen.getByText('聊天正文')).toBeTruthy()
  expect(store.getSnapshot().view).toBe('trajectory')
  expect(activate).toHaveBeenLastCalledWith('chat')
  views = [{ id: 'trajectory', label: '请求轨迹' }]; page.rerender(<Reading {...props} />)
  expect(screen.getByText('轨迹正文')).toBeTruthy()
  fireEvent.click(screen.getByRole('tab', { name: '对话摘要' }))
  expect(store.getSnapshot()).toMatchObject({ view: 'chat', draft: '保留的输入' })
})
