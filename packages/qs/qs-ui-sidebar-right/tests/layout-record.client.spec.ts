/** 存储记录使用外部输入校验；布局来源由真实官方 docking 控制器构造。 */
import { expect, it } from 'vitest'
import { DockController, type SplitId } from '@deepseek-ai/dsh-client-ui-dockkit'
import { parsePanelLayout, serializePanelLayout } from '../src/client/layout-record.ts'

function valid() {
  return { version: 1, docked: 1, active: 0, sizes: [1], expanded: true, mode: 'push',
    panes: [{ tabs: [{ kind: 'guide', address: 'sidebar://guide' }], active: 0, rect: null }] }
}

it('round-trips an empty surface without runtime ids or operation history', () => {
  const layout = new DockController().getSnapshot().state
  const raw = serializePanelLayout(layout)
  expect(raw).toBeDefined()
  expect(parsePanelLayout(raw!)).toEqual({ version: 1, docked: 1, active: 0, sizes: [1], expanded: false, mode: 'push',
    panes: [{ tabs: [], active: null, rect: null }] })
  expect(raw).not.toContain(layout.rootId)
})

it('captures ordered split tabs, active tabs, float geometry and current mode without titles', () => {
  const controller = new DockController({ makePaneTab: id => ({ id, kind: 'guide', contentId: 'sidebar://guide', title: 'private guide title' }) })
  const first = controller.openContent({ kind: 'files', contentId: 'sidebar://files', title: 'private files title' })
  controller.splitPane()
  const resource = controller.openContent({ kind: 'file', contentId: 'dsh-resource://file/session/s1/a.txt', title: 'private document title' })
  const rect = { x: -10, y: 20, width: 320, height: 240 }
  controller.floatTab(resource, rect)
  controller.focusTab(first)
  const root = controller.getSnapshot().state.rootId as SplitId
  controller.resizeSplit(root, [0.3, 0.7])
  controller.setExpanded(true); controller.setMode('fullscreen')
  const raw = serializePanelLayout(controller.getSnapshot().state)!
  const saved = parsePanelLayout(raw)!
  expect(saved).toMatchObject({ docked: 2, active: 0, sizes: [0.3, 0.7], expanded: true, mode: 'fullscreen' })
  expect(saved.panes.map(pane => pane.tabs.map(tab => tab.kind))).toEqual([['files'], ['guide'], ['file']])
  expect(saved.panes[2]!.rect).toEqual(rect)
  expect(raw).not.toContain('private'); expect(raw).not.toContain('history'); expect(raw).not.toContain('tabId')
})

it('rebuilds only allowlisted fields and leaves address authorization to the restoring owner', () => {
  const input = valid()
  const raw = JSON.stringify({ ...input, token: 'secret', session: 'another',
    panes: [{ ...input.panes[0], body: 'private body', tabs: [{ kind: 'file', address: 'unclaimed-address', title: 'secret' }] }] })
  const result = parsePanelLayout(raw)
  expect(result?.panes[0]?.tabs).toEqual([{ kind: 'file', address: 'unclaimed-address' }])
  expect(JSON.stringify(result)).not.toContain('secret')
  expect(JSON.stringify(result)).not.toContain('body')
})

it.each([
  null, [], 1, { version: 2 },
  { ...valid(), panes: [] }, { ...valid(), panes: Array.from({ length: 33 }, () => valid().panes[0]) },
  { ...valid(), docked: 0 }, { ...valid(), docked: 2 }, { ...valid(), docked: 3 },
  { ...valid(), active: '0' }, { ...valid(), active: -1 }, { ...valid(), active: 0.5 }, { ...valid(), active: 1 },
  { ...valid(), expanded: 'true' }, { ...valid(), mode: 'overlay' }, { ...valid(), sizes: null },
  { ...valid(), sizes: [] }, { ...valid(), sizes: [0] }, { ...valid(), sizes: [2] }, { ...valid(), sizes: ['1'] },
  { ...valid(), sizes: [0.5] }, { ...valid(), sizes: [null] },
  { ...valid(), panes: [null] }, { ...valid(), panes: [{ tabs: 'bad' }] },
  { ...valid(), panes: [{ tabs: [], active: 0, rect: null }] },
  { ...valid(), panes: [{ tabs: valid().panes[0]!.tabs, active: null, rect: null }] },
  { ...valid(), panes: [{ ...valid().panes[0], rect: {} }] },
  { ...valid(), panes: [{ ...valid().panes[0], tabs: Array.from({ length: 129 }, () => valid().panes[0]!.tabs[0]) }] },
  ...[null, { kind: 1, address: 'a' }, { kind: '', address: 'a' }, { kind: 'x', address: 1 }, { kind: 'x', address: '' }]
    .map(tab => ({ ...valid(), panes: [{ ...valid().panes[0], tabs: [tab] }] })),
])('rejects malformed layout record %#', (input) => {
  expect(parsePanelLayout(JSON.stringify(input))).toBeUndefined()
})

it.each([null, {}, { x: 0, y: 0, width: 0, height: 20 }, { x: 0, y: 0, width: 20, height: 0 },
  { x: '0', y: 0, width: 20, height: 20 }, { x: 0, y: null, width: 20, height: 20 },
  { x: 0, y: 0, width: '20', height: 20 }, { x: 0, y: 0, width: 20, height: '20' },
])('rejects an invalid floating rectangle %#', (rect) => {
  expect(parsePanelLayout(JSON.stringify({ ...valid(), panes: [valid().panes[0], { ...valid().panes[0], rect }] }))).toBeUndefined()
})

it('rejects multi-tab floats, oversized records and broken JSON', () => {
  const pane = valid().panes[0]!
  const floating = { ...pane, tabs: [pane.tabs[0], pane.tabs[0]], rect: { x: 0, y: 0, width: 1, height: 1 } }
  expect(parsePanelLayout(JSON.stringify({ ...valid(), panes: [pane, floating] }))).toBeUndefined()
  expect(parsePanelLayout('{')).toBeUndefined()
  expect(parsePanelLayout(' '.repeat(65_537))).toBeUndefined()
  const controller = new DockController()
  controller.openContent({ kind: 'file', contentId: 'x'.repeat(65_537), title: 'not stored' })
  expect(serializePanelLayout(controller.getSnapshot().state)).toBeUndefined()
})
