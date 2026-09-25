// @vitest-environment jsdom
/** 真实 slot runtime、官方 store 与 TabDomain 的交叉会话回归。 */
import { afterEach, expect, it, vi } from 'vitest'
import { act, fireEvent, screen } from '@testing-library/react'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { QsInspectorOwnerProps } from '@deepseek-ai/dsh-qs-shell/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SidebarRightPresentationService, SidebarRightTabInfo } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import * as official from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { dockPaneIds } from '@deepseek-ai/dsh-client-ui-dockkit'
import * as plugin from '../src/client/index.ts'
import { canClose, dockIntents } from '../src/client/dock.ts'
const S = 'qs-panel-A' as SessionId, B = 'qs-panel-B' as SessionId
const runtimes: SlotTestRuntime[] = []
afterEach(async () => { for (const runtime of runtimes.splice(0)) await runtime.dispose(); document.body.removeAttribute('data-qs-root'); vi.restoreAllMocks(); localStorage.clear() })
async function fixture() {
  const runtime = await SlotTestRuntime.create(); runtimes.push(runtime)
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.ctx.provide('locale', locale); runtime.slots.installLocale(locale)
  runtime.ctx.provide('layout', { openRightbar: vi.fn(), closeRightbar: vi.fn() } as never)
  const pin = vi.fn()
  runtime.ctx.provide('resources', { pin } as never)
  await runtime.declare({ 'qs.inspector': { kind: 'single', scope: 'root' }, 'rightbar': { kind: 'single', scope: 'root' } })
  await runtime.sessions.add({ id: S })
  await runtime.mount(official)
  const shared = runtime.ctx.sidebarRightPresentation.store
  const feature = await runtime.mount(plugin)
  // 仅为 unit 的 portal 寻址提供祖先；主题和真正页面位置由 Web 验证。
  document.body.setAttribute('data-qs-root', '')
  const reportOpen = vi.fn()
  const initial: QsInspectorOwnerProps = { hidden: false, requestId: 0, reportOpen }
  const view = runtime.renderSlot('qs.inspector', initial)
  const store = runtime.storeOf('qs.sidebar.right.session', S) as ReturnType<SidebarRightPresentationService['store']['create']>
  const layout = () => store.getSnapshot().bySession[S]!.layout
  const controller = runtime.ctx.sidebarRight
  const info = new Map<string, SidebarRightTabInfo>()
  function Body({ useTabInfo }: PropsRuntime<'qs.sidebar.right.tab'>) {
    const value = useTabInfo(); info.set(value.tab.contentId, value)
    return <p data-test-panel>{value.tab.contentId}:{value.tab.navigation.revision}</p>
  }
  function Title({ useTabInfo }: PropsRuntime<'qs.sidebar.right.tab.title'>) { return <span>{useTabInfo().tab.title}</span> }
  const register = async () => {
    let dispose!: () => void
    await act(async () => {
      const removeType = runtime.ctx.sidebarRightTabs.register({ id: 'qs-test/text', kind: 'text', patterns: ['dsh-resource://file/**'], title: address => address.split('/').at(-1)!, guide: [{ order: 1, title: () => 'Test files', description: () => 'Browse registered files' }] })
      const removeBody = runtime.slots.register({ name: 'qs.sidebar.right.tab', key: 'qs-test/text' }, Body)
      const removeTitle = runtime.slots.register({ name: 'qs.sidebar.right.tab.title', key: 'qs-test/text' }, Title)
      dispose = () => { removeTitle(); removeBody(); removeType() }
    })
    return dispose
  }
  const open = (name: string, sessionId = S) => {
    const address = `dsh-resource://file/session/${sessionId}/${name}`
    act(() => { controller.openResource(address) })
    return address
  }
  return { runtime, feature, shared, view, store, layout, controller, info, register, open, reportOpen, initial, pin }
}
it('外壳请求和实际状态回报方向分离，关闭最后内容后再次展开重新播种', async () => {
  const f = await fixture()
  expect(screen.getByText(/工作区面板|Workspace panels/)).toBeTruthy()
  await f.register()
  const address = f.open('one.txt'), tab = f.controller.active()!
  expect(f.view.container.textContent).toContain(address)
  expect(f.pin).toHaveBeenCalledWith(address, expect.any(AbortSignal))
  f.view.update({ ...f.initial, hidden: true, requestId: 1 })
  expect(f.layout().expanded).toBe(false)
  expect(f.view.container.querySelector('aside')?.hasAttribute('inert')).toBe(true)
  // 业务导航重新打开折叠面板；回报不能被旧 requestId 覆盖。
  act(() => { f.controller.openResource(address) })
  expect(f.reportOpen).toHaveBeenLastCalledWith(true)
  f.view.update({ ...f.initial, requestId: 1 })
  expect(f.layout().expanded).toBe(true)
  act(() => { f.controller.close(tab.id) })
  // 初始 guide 仍占一个标签，关闭它之后才检验最后内容关闭。
  const remaining = Object.values(f.layout().tabs)
  expect(remaining.every(item => item.kind === 'guide')).toBe(true)
  expect(canClose(f.store.getSnapshot().bySession[S]!, remaining[0]!.id)).toBe(false)
  expect(canClose(f.store.getSnapshot().bySession[S]!, tab.id)).toBe(false)
  act(() => { f.controller.openTab('text', { replaceTab: remaining[0]!.id }) })
  act(() => { f.controller.close(f.controller.active()!.id) })
  expect(f.layout().expanded).toBe(false)
  expect(f.reportOpen).toHaveBeenLastCalledWith(false)
  f.view.update({ ...f.initial, hidden: true, requestId: 1 })
  f.view.update({ ...f.initial, requestId: 2 })
  expect(f.layout().expanded).toBe(true)
  expect(Object.values(f.layout().tabs)[0]?.kind).toBe('text')
})
it('会话切换保留各自导航与 pin 生命周期，QS 卸载重装不复制官方 store', async () => {
  const f = await fixture(); await f.register()
  const a = f.open('a.txt'), infoA = f.info.get(a)!
  expect(infoA.tab.signal.aborted).toBe(false)
  await f.runtime.sessions.add({ id: B })
  const b = f.open('b.txt', B), infoB = f.info.get(b)!
  expect(infoA.tab.signal).not.toBe(infoB.tab.signal)
  act(() => { infoA.tab.actions.close() })
  expect(infoA.tab.signal.aborted).toBe(true)
  expect(infoB.tab.signal.aborted).toBe(false)
  await f.runtime.sessions.setCurrent(S)
  expect(f.view.container.textContent).not.toContain(b)
  await f.feature.dispose()
  expect(infoB.tab.signal.aborted).toBe(false)
  await f.runtime.mount(plugin)
  expect(f.runtime.ctx.sidebarRightPresentation.store).toBe(f.shared)
  expect(f.runtime.storeOf('qs.sidebar.right.session', S)).toBe(f.store)
})
it('缺失或卸载正文显示限制，向导按实际贡献禁用并可在后装配后打开', async () => {
  const f = await fixture()
  await act(async () => { f.runtime.ctx.sidebarRightTabs.register({ id: 'qs-test/missing', kind: 'missing', title: () => 'Unavailable', guide: [{ order: 3, title: () => 'Missing view' }] }) })
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Missing view' }).disabled).toBe(true)
  const unregister = await f.register()
  fireEvent.click(screen.getByRole('button', { name: 'Test files' }))
  expect(f.controller.active()?.kind).toBe('text')
  act(unregister)
  expect(f.view.container.querySelector('[data-qs-panel-unavailable]')).not.toBeNull()
})
it('全屏、分栏、浮窗与回收通过官方意图写入，菜单及拖拽的扩展槽可装配', async () => {
  const f = await fixture(); await f.register(); f.open('floating.txt')
  const tab = f.controller.active()!
  const intents = dockIntents(S, f.store.actions, (kind, options) => { f.controller.openTab(kind, options) })
  const pane = dockPaneIds(f.layout())[0]!
  fireEvent.click(screen.getByRole('button', { name: /^(全屏|Fullscreen)$/ }))
  expect(f.layout().mode).toBe('fullscreen')
  fireEvent.click(screen.getByRole('button', { name: /退出全屏|Exit fullscreen/ }))
  expect(f.layout().mode).toBe('push')
  act(() => { intents.floatTab(tab.id, { x: 30, y: 40, width: 350, height: 260 }) })
  const floating = f.layout().floats[0]!
  expect(document.querySelector('[data-qs-panel-floats]')?.textContent).toContain('floating.txt')
  act(() => {
    intents.moveFloat(floating, 70, 80)
    intents.resizeFloat(floating, { x: 70, y: 80, width: 400, height: 300 })
    intents.focusPane(floating)
  })
  act(() => { intents.unfloatPane(floating) })
  expect(f.layout().floats).toHaveLength(0)
  act(() => { f.controller.split(pane) })
  // 空间测量可能阻止公共导航分栏；直接意图仍由官方 store 执行。
  act(() => { intents.splitPane(pane) })
  expect(dockPaneIds(f.layout())).toHaveLength(2)
  const split = Object.values(f.layout().nodes).find(node => node.kind === 'split')!
  act(() => { intents.resizeSplit(split.id, [.4, .6]) })
  act(() => { intents.focusTab(tab.id); intents.duplicateTab(tab.id); intents.addTab(pane) })
  const other = dockPaneIds(f.layout()).find(id => id !== pane)!
  act(() => { intents.placeTab(tab.id, other, 0); intents.dropTab(tab.id, pane, 'center') })
  act(() => { intents.closeTab(tab.id) })
  expect(f.layout().tabs[tab.id]).toBeUndefined()
})

it('菜单贡献收到标签与 dismiss，guide chain 收到同一生命周期 hook', async () => {
  const f = await fixture()
  let seen: SidebarRightTabInfo | undefined
  await act(async () => {
    f.runtime.slots.register({ name: 'qs.sidebar.right.guide', select: () => true },
      function Replacement({ useTabInfo }: PropsRuntime<'qs.sidebar.right.guide'>) {
        seen = useTabInfo(); return <p>Custom guide</p>
      })
    f.runtime.slots.register({ name: 'qs.sidebar.right.menu', id: 'qs-test/menu' },
      function Item({ tab, dismiss }: PropsRuntime<'qs.sidebar.right.menu'>) {
        return <button type="button" role="menuitem" onClick={dismiss}>{tab.title}</button>
      })
  })
  expect(screen.getByText('Custom guide')).toBeTruthy()
  expect(seen?.tab.signal.aborted).toBe(false)
  fireEvent.contextMenu(screen.getByRole('tab'))
  fireEvent.click(screen.getByRole('menuitem'))
  expect(screen.queryByRole('menu')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /收起右侧面板|Collapse the right panel/ }))
  expect(f.reportOpen).toHaveBeenLastCalledWith(false)
})

it('刷新座位恢复分栏和浮窗；不发布中间 guide，也不覆盖已经存在的共享布局', async () => {
  const key = `dsh.qs.panel-layout.${S}`
  localStorage.setItem(key, JSON.stringify({ version: 1, docked: 2, active: 1, sizes: [0.3, 0.7], expanded: true, mode: 'push',
    panes: [
      { tabs: [{ kind: 'guide', address: 'sidebar://guide' }], active: 0, rect: null },
      { tabs: [{ kind: 'guide', address: 'sidebar://guide' }], active: 0, rect: null },
      { tabs: [{ kind: 'guide', address: 'sidebar://guide' }], active: 0, rect: { x: 10, y: 20, width: 300, height: 250 } },
    ] }))
  const f = await fixture()
  expect(dockPaneIds(f.layout())).toHaveLength(2)
  expect(f.layout().floats).toHaveLength(1)
  expect(f.layout().activePaneId).toBe(dockPaneIds(f.layout())[1])
  expect(f.store.getSnapshot().bySession[S]!.history.entries).toEqual([])
  expect(f.pin).toHaveBeenCalledTimes(3)
  const before = f.layout()
  localStorage.setItem(key, '{"version":99}')
  await f.feature.dispose()
  await f.runtime.mount(plugin)
  expect(f.layout()).toBe(before)
  expect(f.pin).toHaveBeenCalledTimes(3)
})
it('损坏存储可见恢复，清除按钮不关闭当前面板', async () => {
  const key = `dsh.qs.panel-layout.${S}`
  localStorage.setItem(key, '{')
  const f = await fixture()
  expect(f.view.container.querySelector('[data-qs-panel-storage-notice="recovered"]')).not.toBeNull()
  const before = f.layout()
  fireEvent.click(screen.getByRole('button', { name: /清除保存记录|Clear saved layout/ }))
  expect(f.layout()).toBe(before)
  expect(localStorage.getItem(key)).toBeNull()
  expect(f.view.container.querySelector('[data-qs-panel-storage-notice]')).toBeNull()
})
it('写入失败显示固定提示，后续成功保存清除提示', async () => {
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('private quota detail') })
  const f = await fixture()
  expect(f.view.container.querySelector('[data-qs-panel-storage-notice="memory"]')).not.toBeNull()
  expect(f.view.container.textContent).not.toContain('private quota detail')
  write.mockRestore()
  act(() => { f.store.actions.setMode(S, 'fullscreen') })
  expect(f.view.container.querySelector('[data-qs-panel-storage-notice]')).toBeNull()
})

it('窗口变化合并到一帧，卸载取消待执行调整且不抢占当前焦点', async () => {
  const frames = new Map<number, FrameRequestCallback>(); let counter = 0
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { frames.set(++counter, callback); return counter })
  const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => { frames.delete(id) })
  const f = await fixture(); await f.register(); f.open('viewport.txt')
  const tab = f.controller.active()!
  act(() => { f.controller.float(tab.id, { x: 9999, y: 9999, width: 300, height: 200 }) })
  const before = f.layout().activePaneId
  act(() => { window.dispatchEvent(new Event('resize')); window.dispatchEvent(new Event('resize')) })
  expect(frames.size).toBe(1)
  act(() => { const callback = frames.values().next().value!; frames.clear(); callback(0) })
  const node = f.layout().nodes[f.layout().floats[0]!]!
  expect(node.kind === 'pane' && node.rect).toEqual({ x: window.innerWidth - 300, y: window.innerHeight - 200, width: 300, height: 200 })
  expect(f.layout().activePaneId).toBe(before)
  act(() => { window.dispatchEvent(new Event('resize')) })
  await f.feature.dispose()
  expect(cancel).toHaveBeenCalled()
  expect(frames.size).toBe(0)
  window.dispatchEvent(new Event('resize'))
  expect(frames.size).toBe(0)
})

it('共享观察者不重复保存已挂载座位，额外保存责任的释放幂等', async () => {
  const f = await fixture()
  const inject = f.runtime.slots.entries('qs.sidebar.right.session')[0]!.inject as unknown as
    (id: SessionId) => { bindLayoutWriter: () => () => void }
  const release = inject(S).bindLayoutWriter()
  release(); release()
  const set = vi.spyOn(Storage.prototype, 'setItem')
  act(() => { f.store.actions.setMode(S, 'fullscreen') })
  expect(set.mock.calls.filter(([key]) => key.startsWith('dsh.qs.panel-layout.'))).toHaveLength(1)
})

it('原型向前移动入口调整活动标签顺序，首标签和浮窗不可重排', async () => {
  const f = await fixture(); await f.register()
  const move = () => screen.getByRole<HTMLButtonElement>('button', { name: /向前移动|Move earlier/ })
  expect(move().disabled).toBe(true)
  const address = f.open('move.txt'), tab = f.controller.active()!
  const paneId = f.layout().activePaneId
  const beforePins = f.pin.mock.calls.length
  expect(move().disabled).toBe(false)
  fireEvent.click(move())
  expect(f.layout().nodes[paneId]).toMatchObject({ tabs: [tab.id, expect.any(String)], activeTabId: tab.id })
  expect(move().disabled).toBe(true)
  expect(f.info.get(address)!.tab.signal.aborted).toBe(false)
  expect(f.pin.mock.calls.length).toBe(beforePins)
  act(() => { f.store.actions.floatTab(S, tab.id) })
  expect(move().disabled).toBe(true)
})
