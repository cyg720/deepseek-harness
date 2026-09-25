// @vitest-environment jsdom
/** 官方条件矩阵确保未知父级与运行中子会话不会被错误接管。 */
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { makeTranslate, sessionSnapshot } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ComposerChainProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ReadOnlyComposer, selectReadOnly } from '../src/client/ReadOnlyComposer.tsx'
import { zh, en } from '../src/client/locales.ts'

afterEach(cleanup)
const sid = 'child' as SessionId
function owner(mode: 'one-shot' | 'continuable', parentAvailable: boolean | undefined, running: boolean): ComposerChainProps {
  return { sessionId: sid, pendingInteraction: undefined, session: {
    ...sessionSnapshot(sid), running,
    subagent: { address: { parentSessionId: 'parent' as SessionId, childSessionId: sid, mode },
      ...(parentAvailable === undefined ? {} : { parentAvailable }) },
  } }
}
it('does not claim an ordinary or missing session', () => {
  expect(selectReadOnly({ sessionId: undefined, session: undefined, pendingInteraction: undefined })).toBeNull()
  expect(selectReadOnly({ sessionId: sid, session: sessionSnapshot(sid), pendingInteraction: undefined })).toBeNull()
})
it.each([true, false])('claims one-shot histories regardless of running=%s', (running) => {
  for (const availability of [true, false, undefined]) expect(selectReadOnly(owner('one-shot', availability, running)))
    .toEqual({ reason: 'one-shot' })
})
it.each([true, false, undefined])('preserves stop for a running continuable child with availability=%s', (availability) => {
  expect(selectReadOnly(owner('continuable', availability, true))).toBeNull()
})
it('claims only a stopped continuable child with an explicitly unavailable parent', () => {
  expect(selectReadOnly(owner('continuable', false, false))).toEqual({ reason: 'parent-unavailable' })
  expect(selectReadOnly(owner('continuable', undefined, false))).toBeNull()
  expect(selectReadOnly(owner('continuable', true, false))).toBeNull()
})
it('renders both readonly explanations with matching locale keys', () => {
  const view = render(<ReadOnlyComposer matched={{ reason: 'one-shot' }} t={makeTranslate(zh)} />)
  expect(screen.getByRole('status').textContent).toContain(zh['one-shot'])
  view.rerender(<ReadOnlyComposer matched={{ reason: 'parent-unavailable' }} t={makeTranslate(en)} />)
  expect(screen.getByRole('status').textContent).toContain(en['parent-unavailable'])
  expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
})
