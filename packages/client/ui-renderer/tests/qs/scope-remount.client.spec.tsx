// @vitest-environment jsdom
/** 会话适配器暂时卸载时撤销旧绑定，重装后恢复；初始装配缺失仍应失败。 */
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { SlotRendererHost, ScopedStandardSourceBinding } from '@deepseek-ai/dsh-client-ui-slots'
import { HostContext, ScopeProvider, useScopeBinding } from '../../src/client/bindings.tsx'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function source<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    set(next: T) { value = next; for (const listener of [...listeners]) listener() },
    listeners,
  }
}

function binding(key: string): ScopedStandardSourceBinding {
  return { key, ctx: new Context(), hooks: {}, keyedHooks: {}, props: {} }
}

function Consumer() { return <span>{useScopeBinding().key}</span> }

it('detaches the removed adapter and recovers on a later installation', () => {
  const first = source(binding('first')), second = source(binding('second')), revision = source(0)
  let current: typeof first | undefined = first
  // 此夹具只执行 ScopeProvider 读取的两个宿主成员，不伪造完整槽注册表。
  const host = {
    scopeRevision: revision,
    scope: () => current === undefined ? undefined : { current, resolve: () => undefined },
  } as unknown as SlotRendererHost
  const view = render(<HostContext.Provider value={host}><ScopeProvider scope="session-maybe"><Consumer /></ScopeProvider></HostContext.Provider>)
  expect(view.container.textContent).toBe('first')
  expect(first.listeners.size).toBe(1)
  act(() => { current = undefined; revision.set(1) })
  expect(view.container.textContent).toBe('')
  expect(first.listeners.size).toBe(0)
  act(() => { first.set(binding('stale')); current = second; revision.set(2) })
  expect(view.container.textContent).toBe('second')
  expect(second.listeners.size).toBe(1)
  view.unmount()
  expect(second.listeners.size).toBe(0)
  expect(revision.listeners.size).toBe(0)
})

it('rejects an initially missing scope adapter', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  // 首次缺失场景同样只需要名单及适配器读取接口。
  const host = { scopeRevision: source(0), scope: () => undefined } as unknown as SlotRendererHost
  expect(() => render(<HostContext.Provider value={host}><ScopeProvider scope="session-maybe"><Consumer /></ScopeProvider></HostContext.Provider>))
    .toThrow("scope 'session-maybe' rendered without an installed adapter")
})
