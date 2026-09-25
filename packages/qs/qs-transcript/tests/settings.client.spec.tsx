// @vitest-environment jsdom
/** 设置选择与 Host 回传共用同一个响应式源。 */
import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { TranscriptViewRow } from '../src/client/TranscriptViewRow.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

it('转写设置读取共享模式，提交精确选择，并响应外部偏好更新', () => {
  const dictionary: Partial<Record<string, string>> = zh
  const mode = createSnapshotStore<'normal' | 'compact'>('compact')
  const set = vi.fn((value: 'normal' | 'compact') => { mode.set(value) })
  // 设置行只消费偏好；若误读其他全局座席，夹具应立即失败。
  const unused = (): never => { throw new Error('unexpected global seat access') }
  const view = render(<TranscriptViewRow
    useTranscriptView={select => select(useSyncExternalStore(listener => mode.subscribe(listener), () => mode.getSnapshot()))}
    setTranscriptView={set}
    usePanelInfo={unused} useSessions={unused} useSessionPendingInteraction={unused}
    useWorkspaces={unused} useResource={unused}
    t={key => dictionary[key] ?? key}
  />)
  const select = view.getByRole('combobox', { name: '转写视图' }) as HTMLSelectElement
  expect(select.value).toBe('compact')
  fireEvent.change(select, { target: { value: 'normal' } })
  expect(set.mock.calls).toEqual([['normal']])
  expect(select.value).toBe('normal')
  fireEvent.change(select, { target: { value: 'compact' } })
  expect(set.mock.calls).toEqual([['normal'], ['compact']])
  act(() => { mode.set('normal') })
  expect(select.value).toBe('normal')
  expect(set).toHaveBeenCalledTimes(2)
})
