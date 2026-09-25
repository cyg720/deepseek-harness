// @vitest-environment jsdom
/** 存储为不可信输入；通过官方地址解析器和真实注册表验证恢复范围。 */
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { DockController } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import { panelLayoutPersistence, resolvePanelLayout } from '../src/client/layout-persistence.ts'
import type { SavedPanelLayout } from '../src/client/layout-record.ts'

const session = 's/编码' as SessionId
const address = 'dsh-resource://file/session/s%2F%E7%BC%96%E7%A0%81/a.md'
const key = `dsh.qs.panel-layout.${encodeURIComponent(session)}`
afterEach(() => { vi.restoreAllMocks(); localStorage.clear() })
function fixture() {
  const tabs = new SidebarRightTabRegistry(new Context())
  tabs.register({ id: 'guide', kind: 'guide', title: () => 'Current guide' })
  tabs.register({ id: 'file', kind: 'file', patterns: ['dsh-resource://file/**'],
    canOpen: value => !value.endsWith('blocked.md'), title: () => 'Current file' })
  const bodyKeys = new Set(['guide', 'file'])
  return { tabs, bodyKeys, persistence: panelLayoutPersistence(session, tabs, () => bodyKeys, () => true) }
}
function saved(): SavedPanelLayout {
  return { version: 1, docked: 1, active: 0, sizes: [1], expanded: true, mode: 'push',
    panes: [{ tabs: [{ kind: 'guide', address: 'sidebar://guide' }, { kind: 'file', address }], active: 1, rect: null }] }
}
it('restores current-session file addresses and resolves fresh titles without navigation parameters', () => {
  const f = fixture()
  localStorage.setItem(key, JSON.stringify(saved()))
  expect(f.persistence.read()).toEqual({ notice: undefined, layout: { docked: 1, active: 0, sizes: [1], expanded: true, mode: 'push',
    panes: [{ tabs: [{ kind: 'guide', contentId: 'sidebar://guide', title: 'Current guide' },
      { kind: 'file', contentId: address, title: 'Current file' }], active: 1, rect: null }] } })
})
it.each([
  { kind: 'missing', address: 'sidebar://missing' },
  { kind: 'file', address: 'dsh-resource://file/session/other/a.md' },
  { kind: 'file', address: 'dsh-resource://file/absolute/etc/passwd' },
  { kind: 'file', address: 'https://example.org/a.md' },
  { kind: 'file', address: 'dsh-resource://file/session/%xx/a.md' },
  { kind: 'file', address: address.replace('a.md', 'blocked.md') },
  { kind: 'guide', address: 'sidebar://someone-else' },
])('discards unavailable or unauthorized saved tab %# with a visible recovery result', (tab) => {
  const f = fixture(), input = saved()
  localStorage.setItem(key, JSON.stringify({ ...input, panes: [{ ...input.panes[0], tabs: [tab], active: 0 }] }))
  expect(f.persistence.read()).toMatchObject({ notice: 'recovered', layout: { panes: [{ tabs: [], active: null }] } })
})
it('rejects missing bodies and duplicate pages while preserving resource duplicates', () => {
  const f = fixture(), input = saved()
  f.bodyKeys.delete('file')
  const resolved = resolvePanelLayout({ ...input, panes: [{ ...input.panes[0]!, tabs: [
    { kind: 'guide', address: 'sidebar://guide' }, { kind: 'guide', address: 'sidebar://guide' }, { kind: 'file', address },
  ] }] }, session, f.tabs, f.bodyKeys, { width: 800, height: 600 })
  expect(resolved.adjusted).toBe(true)
  expect(resolved.layout.panes[0]?.tabs).toHaveLength(1)
  f.bodyKeys.add('file')
  expect(resolvePanelLayout({ ...input, panes: [{ tabs: [{ kind: 'file', address }, { kind: 'file', address }], active: 1, rect: null }] },
    session, f.tabs, f.bodyKeys, { width: 800, height: 600 }).layout.panes[0]?.tabs).toHaveLength(2)
})
it('drops empty floats, maps active panes and bounds visible float geometry and split sizes', () => {
  const f = fixture(), pane = saved().panes[0]!
  const input: SavedPanelLayout = { ...saved(), docked: 2, sizes: [0.01, 0.99], active: 3, panes: [pane, pane,
    { tabs: [{ kind: 'gone', address: 'sidebar://gone' }], active: 0, rect: { x: 0, y: 0, width: 100, height: 100 } },
    { tabs: [{ kind: 'file', address }], active: 0, rect: { x: -200, y: 900, width: 2000, height: 2000 } }] }
  const result = resolvePanelLayout(input, session, f.tabs, f.bodyKeys, { width: 360, height: 480 })
  expect(result).toMatchObject({ adjusted: true, layout: { active: 2, sizes: [0.2, 0.8] } })
  expect(result.layout.panes).toHaveLength(3)
  expect(result.layout.panes[2]?.rect).toEqual({ x: 0, y: 0, width: 360, height: 480 })
})
it('preserves an already visible floating rectangle', () => {
  const f = fixture(), rect = { x: 10, y: 20, width: 200, height: 300 }
  const result = resolvePanelLayout({ ...saved(), panes: [...saved().panes, { tabs: [{ kind: 'file', address }], active: 0, rect }] },
    session, f.tabs, f.bodyKeys, { width: 800, height: 600 })
  expect(result.adjusted).toBe(false); expect(result.layout.panes[1]?.rect).toEqual(rect)
})
it('handles absent, corrupt and unsupported records without exposing browser diagnostics', () => {
  const f = fixture()
  expect(f.persistence.read()).toEqual({ layout: undefined, notice: undefined })
  for (const value of ['{', '{"version":99}']) {
    localStorage.setItem(key, value)
    expect(f.persistence.read()).toEqual({ layout: undefined, notice: 'recovered' })
  }
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('private browser detail') })
  expect(f.persistence.read()).toEqual({ layout: undefined, notice: 'memory' })
})
it('saves only layout metadata and clears only its session key', () => {
  const f = fixture(), controller = new DockController()
  controller.openContent({ kind: 'file', contentId: address, title: 'private title' })
  expect(f.persistence.write(controller.getSnapshot().state)).toBeUndefined()
  expect(localStorage.getItem(key)).toContain(address)
  expect(localStorage.getItem(key)).not.toContain('private title')
  localStorage.setItem('unrelated', 'keep')
  expect(f.persistence.clear()).toBeUndefined()
  expect(localStorage.getItem(key)).toBeNull()
  expect(localStorage.getItem('unrelated')).toBe('keep')
})
it('reports save and clear refusal without breaking the active layout', () => {
  const f = fixture(), controller = new DockController(), state = controller.getSnapshot().state
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied') })
  expect(f.persistence.write(state)).toBe('memory')
  expect(f.persistence.clear()).toBe('memory')
  expect(controller.getSnapshot().state).toBe(state)
})
it('reports oversized layouts and leaves the previous saved record intact', () => {
  const f = fixture(), controller = new DockController()
  localStorage.setItem(key, 'prior')
  controller.openContent({ kind: 'file', contentId: 'x'.repeat(70_000), title: 'too big' })
  expect(f.persistence.write(controller.getSnapshot().state)).toBe('oversized')
  expect(localStorage.getItem(key)).toBe('prior')
})
