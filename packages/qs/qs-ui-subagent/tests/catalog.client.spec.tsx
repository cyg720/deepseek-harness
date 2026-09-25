// @vitest-environment jsdom
/** 目录只使用官方地址导航；每个已展开目录在切换及卸载时释放观察。 */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionListState, SubagentCatalogSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import { Catalog } from '../src/client/Catalog.tsx'
import type { CatalogProps } from '../src/client/contract.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
const parent = 'parent' as SessionId, child = 'child' as SessionId, grandchild = 'grandchild' as SessionId
function fixture(catalog?: SubagentCatalogSnapshot) {
  // 视图仅消费这三个列表字段，其余标准会话座席不参与此组件测试。
  const state = { byId: {}, current: parent, subagentsByParent: catalog ? { [parent]: catalog } : {} } as SessionListState
  const actions = { openChild: vi.fn(), openParent: vi.fn(), refresh: vi.fn(), setCatalogOpen: vi.fn() }
  const props = { ...actions, sessionId: parent, t: makeTranslate(zh),
    useSessions: <T,>(select: (value: SessionListState) => T) => select(state),
  } as unknown as CatalogProps
  return { state, actions, props }
}
const ready = (entries: SubagentCatalogSnapshot['entries'] = []): SubagentCatalogSnapshot =>
  ({ state: 'ready', error: null, parentAvailable: true, entries })
const open = () => { fireEvent.click(screen.getByRole('button', { name: zh.title })) }
it('distinguishes loading, failure, unavailable parent and empty ready catalogs', () => {
  const f = fixture(), view = render(<Catalog {...f.props} />)
  open(); expect(screen.getByText(zh.loading)).toBeTruthy(); expect(screen.queryByText(zh.empty)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: zh.refresh })); expect(f.actions.refresh).toHaveBeenCalledWith(parent)
  for (const state of ['loading', 'error', 'ready'] as const) {
    f.state.subagentsByParent = { [parent]: { ...ready(), state, parentAvailable: false } }
    view.rerender(<Catalog {...f.props} />)
    expect(screen.getByText(zh['parent-unavailable'])).toBeTruthy()
    if (state === 'error') expect(screen.getByRole('alert').textContent).toBe(zh.error)
    if (state === 'ready') expect(screen.getByText(zh.empty)).toBeTruthy()
  }
  fireEvent.keyDown(screen.getByRole('button', { name: zh.close }), { key: 'Escape' })
  expect(f.actions.setCatalogOpen.mock.calls).toEqual([[parent, true], [parent, false]])
  expect(document.activeElement).toBe(screen.getByRole('button', { name: zh.title }))
})
it('opens complete official addresses and lazily releases descendant catalogs', () => {
  const f = fixture(ready([{ kind: 'child', id: child, label: 'worker', mode: 'continuable', activity: 'running', hasChildren: true }]))
  f.state.subagentsByParent = { ...f.state.subagentsByParent, [child]: ready([
    { kind: 'child', id: grandchild, mode: 'one-shot', activity: 'inactive', hasChildren: false },
  ]) }
  const view = render(<Catalog {...f.props} />); open()
  expect(screen.getByText(zh.continuable + ' · ' + zh.running)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: zh.expand }))
  expect(f.actions.setCatalogOpen).toHaveBeenLastCalledWith(child, true)
  fireEvent.click(screen.getByRole('button', { name: zh.collapse }))
  expect(f.actions.setCatalogOpen).toHaveBeenLastCalledWith(child, false)
  fireEvent.click(screen.getByRole('button', { name: zh.expand }))
  fireEvent.click(screen.getByRole('button', { name: zh.unknown }))
  expect(f.actions.openChild).toHaveBeenCalledWith({ parentSessionId: child, childSessionId: grandchild, mode: 'one-shot' })
  expect(f.actions.setCatalogOpen).toHaveBeenCalledWith(parent, false)
  expect(f.actions.setCatalogOpen).toHaveBeenCalledWith(child, false)
  open(); view.unmount(); expect(f.actions.setCatalogOpen).toHaveBeenLastCalledWith(parent, false)
})
it('shows diagnostic records without navigation and prevents recursive cycles', () => {
  const f = fixture(ready([
    ...(['corrupt', 'unsupported', 'unavailable'] as const).map(reason => ({ kind: 'diagnostic' as const, id: reason as SessionId, reason })),
    { kind: 'child', id: parent, mode: 'one-shot', activity: 'inactive', hasChildren: true },
  ]))
  render(<Catalog {...f.props} />); open()
  for (const reason of ['corrupt', 'unsupported', 'unavailable'] as const) expect(screen.getByText(zh[reason])).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: zh.expand }))
  expect(screen.getByRole('alert').textContent).toBe(zh.cycle)
  expect(f.actions.setCatalogOpen).toHaveBeenCalledTimes(1)
})

it('returns through known ancestry and closes subscriptions on session changes and outside input', () => {
  const f = fixture(ready())
  f.state.currentAddress = { parentSessionId: child, childSessionId: parent, mode: 'continuable' }
  f.state.byId = { [child]: { id: child, displayTitle: 'parent title', origin: 'subagent', parentId: grandchild },
    [grandchild]: { id: grandchild, origin: 'user' } } as SessionListState['byId']
  const view = render(<Catalog {...f.props} />); open()
  fireEvent.keyDown(screen.getByRole('button', { name: zh.close }), { key: 'ArrowDown' })
  fireEvent.click(screen.getByRole('button', { name: 'parent title' }))
  expect(f.actions.openParent).toHaveBeenLastCalledWith(child)
  open(); fireEvent.click(screen.getByRole('button', { name: zh.parent }))
  expect(f.actions.openParent).toHaveBeenLastCalledWith(grandchild)
  open(); view.rerender(<Catalog {...f.props} sessionId={child} />)
  expect(screen.queryByRole('button', { name: zh.close })).toBeNull()
  expect(f.actions.setCatalogOpen).toHaveBeenLastCalledWith(parent, false)
  open(); fireEvent.pointerDown(document.body)
  expect(screen.queryByRole('button', { name: zh.close })).toBeNull()
})
it('uses a summary title when the child has no label and contains cyclic ancestry', () => {
  const f = fixture(ready([{ kind: 'child', id: child, mode: 'one-shot', activity: 'inactive', hasChildren: false }]))
  f.state.byId = { [child]: { id: child, displayTitle: 'summary child', origin: 'subagent', parentId: parent },
    [parent]: { id: parent, origin: 'subagent', parentId: child } } as SessionListState['byId']
  render(<Catalog {...f.props} />); open()
  expect(screen.getAllByRole('button', { name: 'summary child' })).toHaveLength(2)
  fireEvent.click(screen.getByRole('button', { name: zh.close }))
  expect(f.actions.setCatalogOpen).toHaveBeenLastCalledWith(parent, false)
})

it('browses the parent catalog without selecting it and navigates a sibling with its catalog address', () => {
  const f = fixture(ready())
  const sibling = 'sibling' as SessionId
  f.state.currentAddress = { parentSessionId: child, childSessionId: parent, mode: 'continuable' }
  f.state.subagentsByParent = { ...f.state.subagentsByParent, [child]: ready([
    { kind: 'child', id: sibling, label: 'sibling worker', mode: 'continuable', activity: 'inactive', hasChildren: false },
  ]) }
  render(<Catalog {...f.props} />); open()
  const scope = screen.getByRole('combobox', { name: zh.catalogScope })
  fireEvent.change(scope, { target: { value: child } })
  expect(f.actions.openParent).not.toHaveBeenCalled()
  expect(f.actions.openChild).not.toHaveBeenCalled()
  expect(f.state.current).toBe(parent)
  expect(f.actions.setCatalogOpen.mock.calls).toEqual([[parent, true], [parent, false], [child, true]])
  fireEvent.change(scope, { target: { value: 'not-an-ancestor' } })
  expect(f.actions.setCatalogOpen).toHaveBeenCalledTimes(3)
  fireEvent.click(screen.getByRole('button', { name: 'sibling worker' }))
  expect(f.actions.openChild).toHaveBeenCalledWith({ parentSessionId: child, childSessionId: sibling, mode: 'continuable' })
  expect(f.actions.setCatalogOpen).toHaveBeenLastCalledWith(child, false)
})

it('navigates healthy child buttons with arrows and Home/End without stealing form keys', () => {
  const f = fixture(ready([
    { kind: 'child', id: child, label: 'branch', mode: 'continuable', activity: 'inactive', hasChildren: true },
    { kind: 'diagnostic', id: 'broken' as SessionId, reason: 'corrupt' },
    { kind: 'child', id: grandchild, label: 'last', mode: 'one-shot', activity: 'inactive', hasChildren: false },
  ]))
  f.state.subagentsByParent = { ...f.state.subagentsByParent, [child]: ready([
    { kind: 'child', id: 'nested' as SessionId, label: 'nested', mode: 'one-shot', activity: 'inactive', hasChildren: false },
  ]) }
  render(<Catalog {...f.props} />); open()
  const branch = screen.getByRole('button', { name: 'branch' }), last = screen.getByRole('button', { name: 'last' })
  const press = (element: HTMLElement, key: string) => { element.focus(); fireEvent.keyDown(element, { key }) }
  press(branch, 'ArrowUp'); expect(document.activeElement).toBe(last)
  press(last, 'ArrowDown'); expect(document.activeElement).toBe(branch)
  press(branch, 'End'); expect(document.activeElement).toBe(last)
  press(last, 'Home'); expect(document.activeElement).toBe(branch)
  press(branch, 'ArrowLeft'); expect(document.activeElement).toBe(branch)
  press(last, 'ArrowRight'); expect(document.activeElement).toBe(last)
  press(branch, 'ArrowRight'); expect(screen.getByRole('button', { name: zh.collapse })).toBeTruthy()
  press(branch, 'ArrowRight')
  const nested = screen.getByRole('button', { name: 'nested' })
  expect(document.activeElement).toBe(nested)
  press(nested, 'ArrowLeft'); expect(document.activeElement).toBe(branch)
  press(branch, 'ArrowLeft'); expect(screen.queryByRole('button', { name: 'nested' })).toBeNull()
  press(branch, 'a'); expect(f.actions.openChild).not.toHaveBeenCalled()
  const scope = screen.getByRole('combobox', { name: zh.catalogScope })
  press(scope, 'ArrowDown'); expect(document.activeElement).toBe(scope)
})
