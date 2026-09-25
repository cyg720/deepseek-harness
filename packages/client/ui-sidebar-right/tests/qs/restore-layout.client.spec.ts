/** 通过真实 store 验证恢复的提交次数、身份分配和活跃操作优先级。 */
import { expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { dockPaneIds, getPane, getSplit } from '@deepseek-ai/dsh-client-ui-dockkit'
import { createSidebarRightStore } from '../../src/client/stores.ts'
import { fitFloats } from '../../src/client/qs/fit-floats.ts'
import type { RestoredLayout } from '../../src/client/qs/restore-layout.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createSidebarRightController } from '../../src/client/service.ts'
import { SidebarRightTabRegistry } from '../../src/client/tab-registry.ts'

const guide = { kind: 'guide', contentId: 'sidebar://guide', title: 'Start' }
function saved(): RestoredLayout {
  return { docked: 2, active: 0, sizes: [0.3, 0.7], expanded: true, mode: 'fullscreen', panes: [
    { tabs: [guide, { kind: 'file', contentId: 'dsh-resource://file/session/s/a.md', title: 'a' }], active: 0, rect: null },
    { tabs: [{ kind: 'explorer', contentId: 'sidebar://explorer', title: 'Files' }], active: 0, rect: null },
    { tabs: [{ kind: 'file', contentId: 'dsh-resource://file/session/s/b.md', title: 'b' }], active: 0,
      rect: { x: 20, y: 30, width: 300, height: 250 } },
  ] }
}
const create = () => createSidebarRightStore(() => ({ kind: 'guide', title: 'Start' })).create()

it('publishes a complete split and float once, with fresh ids and empty undo history', () => {
  const store = create(), changed = vi.fn()
  const dispose = store.subscribe(changed)
  store.actions.restore('s', saved())
  expect(changed).toHaveBeenCalledTimes(1)
  const surface = store.getSnapshot().bySession.s!, { layout } = surface
  const panes = dockPaneIds(layout)
  expect(panes).toHaveLength(2)
  expect(panes.map(id => getPane(layout, id).tabs.map(tab => layout.tabs[tab]!.contentId)))
    .toEqual([['sidebar://guide', 'dsh-resource://file/session/s/a.md'], ['sidebar://explorer']])
  expect(layout.activePaneId).toBe(panes[0])
  expect(layout.tabs[getPane(layout, panes[0]!).activeTabId!]!.kind).toBe('guide')
  expect(getSplit(layout, layout.rootId).sizes).toEqual([0.3, 0.7])
  expect(getPane(layout, layout.floats[0]!).rect).toEqual(saved().panes[2]!.rect)
  expect(layout.mode).toBe('fullscreen')
  expect(surface.history.entries).toEqual([])
  const allocated = new Set([...Object.keys(layout.nodes), ...Object.keys(layout.tabs)])
  store.actions.openContent('s', { kind: 'file', contentId: 'new', title: 'new' }, (id) => { expect(allocated.has(id)).toBe(false) })
  expect(store.getSnapshot().bySession.s!.minted).toBeGreaterThan(surface.minted)
  store.actions.undo('s')
  expect(store.getSnapshot().bySession.s!.layout.tabs).toEqual(layout.tabs)
  dispose()
})

it('never replaces an existing session, including an explicitly opened empty surface', () => {
  const store = create()
  store.actions.open('s')
  const before = store.getSnapshot()
  store.actions.restore('s', saved())
  expect(store.getSnapshot()).toBe(before)
  store.actions.restore('other', saved())
  expect(store.getSnapshot().bySession.s).toBe(before.bySession.s)
})

it.each([false, true])('settles an empty single column with expanded=%s', (expanded) => {
  const store = create()
  store.actions.restore('s', { docked: 1, active: 0, sizes: [1], expanded, mode: 'push',
    panes: [{ tabs: [], active: null, rect: null }] })
  const layout = store.getSnapshot().bySession.s!.layout
  expect(layout.expanded).toBe(expanded)
  expect(Object.values(layout.tabs).map(tab => tab.kind)).toEqual(expanded ? ['guide'] : [])
})

it('retains floating focus and the saved stacking order', () => {
  const store = create(), record = saved()
  store.actions.restore('s', { ...record, active: 3, panes: [...record.panes,
    { tabs: [{ kind: 'file', contentId: 'c', title: 'c' }], active: 0, rect: { x: 50, y: 60, width: 200, height: 200 } }] })
  const layout = store.getSnapshot().bySession.s!.layout
  expect(layout.floats.map(id => layout.tabs[getPane(layout, id).tabs[0]!]!.contentId))
    .toEqual(['dsh-resource://file/session/s/b.md', 'c'])
  expect(layout.activePaneId).toBe(layout.floats[1])
})

it('adopts only the final restored records and releases their resource pins on close and teardown', () => {
  const store = create(), pin = vi.fn<(address: string, signal: AbortSignal) => void>()
  const { controller, adopt } = createSidebarRightController(new SidebarRightTabRegistry(new Context()), pin)
  const session = 's' as SessionId, release = adopt(session, store)
  store.actions.restore(session, saved())
  expect(pin.mock.calls.map(([address]) => address)).toEqual([
    'sidebar://guide', 'dsh-resource://file/session/s/a.md', 'sidebar://explorer', 'dsh-resource://file/session/s/b.md',
  ])
  const layout = store.getSnapshot().bySession.s!.layout
  const file = Object.values(layout.tabs).find(tab => tab.contentId.endsWith('/a.md'))!
  const occurrence = controller.tabDomain.occurrence(session, file)
  expect(occurrence.signal.aborted).toBe(false)
  store.actions.closeTab(session, file.id)
  expect(occurrence.signal.aborted).toBe(true)
  expect(pin).toHaveBeenCalledTimes(4)
  release()
  controller.tabDomain.dispose()
  expect(pin.mock.calls.every(([, signal]) => signal.aborted)).toBe(true)
})

it('rejects an out-of-range active pane before publishing any partial layout', () => {
  const store = create(), before = store.getSnapshot()
  expect(() => { store.actions.restore('s', { ...saved(), active: 50 }) }).toThrow('missing pane, tab or rectangle')
  expect(store.getSnapshot()).toBe(before)
})

it('fits floats atomically without stealing focus, reordering panes or changing tab identities', () => {
  const store = create(), record = saved()
  store.actions.restore('s', { ...record, panes: [...record.panes,
    { tabs: [{ kind: 'file', contentId: 'c', title: 'c' }], active: 0, rect: { x: 5000, y: -50, width: 600, height: 500 } }] })
  const before = store.getSnapshot().bySession.s!, changed = vi.fn(), dispose = store.subscribe(changed)
  store.actions.fitFloats('s', { width: 250, height: 200 })
  const fitted = store.getSnapshot().bySession.s!
  expect(changed).toHaveBeenCalledTimes(1)
  expect(fitted.layout.activePaneId).toBe(before.layout.activePaneId)
  expect(fitted.layout.floats).toEqual(before.layout.floats)
  expect(fitted.layout.tabs).toBe(before.layout.tabs)
  for (const pane of fitted.layout.floats) expect(getPane(fitted.layout, pane).rect).toEqual({ x: 0, y: 0, width: 250, height: 200 })
  store.actions.fitFloats('s', { width: 250, height: 200 })
  expect(changed).toHaveBeenCalledTimes(1)
  store.actions.undo('s')
  expect(store.getSnapshot().bySession.s!.layout).toEqual(before.layout)
  dispose()
})
it('does not materialize an absent session or resize floats in a zero-sized viewport', () => {
  const store = create(), empty = store.getSnapshot()
  store.actions.fitFloats('missing', { width: 100, height: 100 })
  expect(store.getSnapshot()).toBe(empty)
  store.actions.restore('s', saved())
  const before = store.getSnapshot()
  store.actions.fitFloats('s', { width: 0, height: 100 })
  store.actions.fitFloats('s', { width: 100, height: 0 })
  expect(store.getSnapshot()).toBe(before)
})

it('rejects a floating node whose owned rectangle is missing', () => {
  const store = create(); store.actions.restore('s', saved())
  const layout = store.getSnapshot().bySession.s!.layout, id = layout.floats[0]!
  const node = getPane(layout, id)
  expect(() => fitFloats({ ...layout, nodes: { ...layout.nodes, [id]: { ...node, rect: undefined } } }, { width: 800, height: 600 }))
    .toThrow('floating pane has no rectangle')
})
