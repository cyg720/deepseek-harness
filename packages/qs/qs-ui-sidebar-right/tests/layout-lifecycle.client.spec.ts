// @vitest-environment jsdom
/** 冷启动、真实退出和插件释放必须区分；退出后的旧读写能力不得重新保存。 */
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { DockController } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import { clearPanelLayouts, PANEL_LAYOUT_PREFIX, watchPanelLogout } from '../src/client/layout-lifecycle.ts'
import { panelLayoutPersistence } from '../src/client/layout-persistence.ts'

afterEach(() => { vi.restoreAllMocks(); localStorage.clear() })
function auth(initial: boolean) {
  let authenticated = initial
  const listeners = new Set<() => void>()
  return { getSnapshot: () => ({ authenticated }),
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    set: (next: boolean) => { authenticated = next; for (const listener of listeners) listener() },
    listeners,
  }
}
it('clears every QS panel key but preserves shell geometry and unrelated browser data', () => {
  localStorage.setItem(`${PANEL_LAYOUT_PREFIX}one`, 'a')
  localStorage.setItem('dsh.qs.layout', 'geometry')
  localStorage.setItem(`${PANEL_LAYOUT_PREFIX}two`, 'b')
  localStorage.setItem('unrelated', 'keep')
  expect(clearPanelLayouts()).toBe(true)
  expect(localStorage.length).toBe(2)
  expect(localStorage.getItem('dsh.qs.layout')).toBe('geometry')
  expect(localStorage.getItem('unrelated')).toBe('keep')
})
it('preserves cold-login records, clears only an authenticated-to-signed-out transition and disposes its listener', () => {
  const source = auth(false), key = `${PANEL_LAYOUT_PREFIX}one`
  localStorage.setItem(key, 'restore after login')
  const dispose = watchPanelLogout(source)
  source.set(false); source.set(true); source.set(true)
  expect(localStorage.getItem(key)).toBe('restore after login')
  source.set(false)
  expect(localStorage.getItem(key)).toBeNull()
  localStorage.setItem(key, 'not a logout')
  source.set(false)
  expect(localStorage.getItem(key)).toBe('not a logout')
  dispose()
  expect(source.listeners.size).toBe(0)
  source.set(true); source.set(false)
  expect(localStorage.getItem(key)).toBe('not a logout')
})
it('tolerates a key disappearing during browser storage enumeration', () => {
  localStorage.setItem(`${PANEL_LAYOUT_PREFIX}one`, 'a')
  vi.spyOn(Storage.prototype, 'key').mockReturnValue(null)
  expect(clearPanelLayouts()).toBe(true)
})
it('does not throw through logout when the browser refuses deletion', () => {
  localStorage.setItem(`${PANEL_LAYOUT_PREFIX}one`, 'a')
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied') })
  expect(clearPanelLayouts()).toBe(false)
  const source = auth(true), dispose = watchPanelLogout(source)
  expect(() => { source.set(false) }).not.toThrow()
  dispose()
})
it('blocks old persistence capabilities after logout and permits a later authenticated session', () => {
  const source = auth(true), dispose = watchPanelLogout(source), session = 's' as SessionId
  const persistence = panelLayoutPersistence(session, new SidebarRightTabRegistry(new Context()), () => new Set(),
    () => source.getSnapshot().authenticated)
  const layout = new DockController().getSnapshot().state
  persistence.write(layout)
  expect(localStorage.length).toBe(1)
  source.set(false)
  expect(persistence.write(layout)).toBeUndefined()
  expect(persistence.read()).toEqual({ layout: undefined, notice: undefined })
  expect(localStorage.length).toBe(0)
  source.set(true)
  persistence.write(layout)
  expect(localStorage.length).toBe(1)
  dispose()
})
