// @vitest-environment jsdom
/** 阅读区卸载不应销毁固定待回答座位的输入状态。 */
import { useState } from 'react'
import type { ComponentProps } from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { zh } from '../src/client/view-locales.ts'
import { PendingSeat } from '../src/client/PendingSeat.tsx'

afterEach(cleanup)
it('切换阅读内容保留答案，宿主按 Session 选择唯一请求', () => {
  function Answer() {
    const [value, setValue] = useState('')
    return <input aria-label="answer" value={value} onChange={(event) => { setValue(event.target.value) }} />
  }
  const pending = { requestId: 'request-a' }
  const renderSlotChain = vi.fn(() => <Answer />)
  const props = {
    sessionId: 'a', renderSlotChain, t: (key: keyof typeof zh) => zh[key],
    useSessionPendingInteraction: (select: (map: Map<string, object>) => unknown) => select(new Map([['a', pending], ['b', { requestId: 'request-b' }]])),
  } as unknown as ComponentProps<typeof PendingSeat>
  const tree = (chat: boolean) => <><div>{chat ? <article>chat</article> : <section>trajectory</section>}</div><PendingSeat {...props} /></>
  const view = render(tree(true))
  fireEvent.change(view.getByRole('textbox'), { target: { value: '保留的答案' } })
  view.rerender(tree(false))
  expect(view.getByRole('textbox')).toHaveProperty('value', '保留的答案')
  expect(renderSlotChain).toHaveBeenLastCalledWith('qs.stage.interaction', { sessionId: 'a', pendingInteraction: pending }, { fallback: null })
})

// 使用真实 DOM 焦点迁移，覆盖按钮卸载、禁用输入及用户主动离开待答区。
it.each(['origin', 'removed', 'disabled-input', 'no-fallback', 'svg-origin', 'blur', 'elsewhere', 'new-session'] as const)(
  '待回答消失的焦点恢复：%s', (mode) => {
    let pending = false, showOrigin = true, sessionId = 'a'
    const request = { requestId: 'request-a' }
    const props = {
      t: (key: keyof typeof zh) => zh[key],
      renderSlotChain: () => pending ? <><button>submit</button><button>secondary</button></> : null,
      useSessionPendingInteraction: (select: (map: Map<string, object>) => unknown) =>
        select(new Map(pending ? [[sessionId, request]] : [])),
    } as unknown as Omit<ComponentProps<typeof PendingSeat>, 'sessionId'>
    const tree = () => <main>
      {showOrigin && (mode === 'svg-origin' ? <svg tabIndex={0} aria-label="origin" /> : <button>origin</button>)}
      <button>elsewhere</button>
      {mode !== 'no-fallback' && <><span tabIndex={-1} data-qs-session-heading>heading</span>
        <textarea id="qs-composer-input" aria-label="composer" disabled={mode === 'disabled-input'} /></>}
      <PendingSeat {...props} sessionId={sessionId as ComponentProps<typeof PendingSeat>['sessionId']} />
    </main>
    const page = render(tree())
    const origin = mode === 'svg-origin' ? page.getByLabelText('origin') : page.getByRole('button', { name: 'origin' })
    act(() => { origin.focus() })
    pending = true; page.rerender(tree())
    const submit = page.getByRole('button', { name: 'submit' })
    act(() => { submit.focus(); page.getByRole('button', { name: 'secondary' }).focus(); submit.focus() })
    if (mode === 'blur') act(() => { submit.blur() })
    if (mode === 'elsewhere') act(() => { page.getByRole('button', { name: 'elsewhere' }).focus() })
    if (mode !== 'origin' && mode !== 'elsewhere') showOrigin = false
    if (mode === 'new-session') sessionId = 'b'
    // 焦点随按钮移除退回 body；不能通过模拟 focus() 返回值替代 DOM 行为。
    pending = false; page.rerender(tree())
    const target = mode === 'origin' ? origin
      : mode === 'elsewhere' ? page.getByRole('button', { name: 'elsewhere' })
        : mode === 'new-session' || mode === 'no-fallback' ? document.body
          : mode === 'disabled-input' ? page.getByText('heading') : page.getByLabelText('composer')
    expect(document.activeElement).toBe(target)
    expect(page.queryByRole('status')?.textContent).toBe(mode === 'new-session' ? undefined : zh['pending.updated'])
    pending = true; page.rerender(tree())
    expect(page.queryByRole('status')).toBeNull()
  },
)
