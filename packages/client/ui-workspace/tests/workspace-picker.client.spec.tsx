// @vitest-environment jsdom
/**
 * 文件职责：验证工作区界面的 workspace-picker.client.spec.tsx 行为。
 * 技术维度：Vitest、协议夹具、Worker/子进程或组件替身。
 * 产品维度：防止工作区界面协议与生命周期回归。
 * 逻辑维度：构造输入，运行被测入口并断言输出与清理。
 * 关键边界：跨进程数据必须校验；Worker 和异步任务必须结束。
 * 新手阅读建议：先读协议夹具，再按成功、失败和清理场景阅读。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type {
  WorkspaceId, WorkspaceSnapshot, WorkspaceView,
} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { SessionPendingInteractionSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { DirectoryFlowOwnerProps, WorkspacePickerProps } from '../src/client/contract/slots.ts'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { WorkspacePicker } from '../src/client/WorkspacePicker.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

// The seat's key domain is workspace ∪ common; the stub mirrors the real
// lookup chain (namespace, then common vocabulary, then the key).
/** 中文说明：测试局部值 t，由紧邻初始化决定。 */
const t: WorkspacePickerProps['t'] = makeTranslate(zh, commonZh)

/** 中文说明：测试局部值 wid，由紧邻初始化决定。 */
const wid = (id: string) => id as WorkspaceId
/** 中文说明：函数 workspace 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function workspace(id: string, title = id): WorkspaceView {
  return {
    workspaceId: wid(id), path: `/projects/${id}`, title, sessionIds: [],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }
}
/** 中文说明：函数 hook 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function hook<T>(snapshot: T) {
  return function select<S>(selector: (state: T) => S): S { return selector(snapshot) }
}
/** 中文说明：测试局部值 sessions，由紧邻初始化决定。 */
const sessions: SessionListState = {
  ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
}
const noPendingInteraction: SessionPendingInteractionSnapshot = new Map()
const workspaceState = (items: readonly WorkspaceView[]): WorkspaceSnapshot => ({
  items, archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
})
/** 中文说明：函数 anchor 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function anchor(): { current: HTMLElement } {
  /** 中文说明：测试局部值 element，由紧邻初始化决定。 */
  const element = document.createElement('button')
  element.getBoundingClientRect = () => ({
    top: 10, left: 20, width: 30, height: 40, right: 50, bottom: 50,
    x: 20, y: 10, toJSON: () => ({}),
  })
  return { current: element }
}

/**
 * Probe occupant of the directory-flow hole: records the latest owner
 * conversation so tests drive onPicked/onCancel/onError like a composed flow
 * package would, and renders a marker element while the flow is open.
 */
/* 中文说明：函数 flowProbe 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function flowProbe() {
  /** 中文说明：测试局部值 probe，由紧邻初始化决定。 */
  const probe: { owner: DirectoryFlowOwnerProps | undefined } = { owner: undefined }
  /** 中文说明：测试局部值 renderSlot，由紧邻初始化决定。 */
  const renderSlot = ((_name: string, owner: DirectoryFlowOwnerProps) => {
    probe.owner = owner
    return owner.open ? <div data-testid="directory-flow" data-busy={owner.busy} /> : null
  }) as never
  return { probe, renderSlot }
}

/** Manual occupancy source bound like the renderer would: flip() drives the hook like a real registration change. */
/* 中文说明：函数 occupancySource 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function occupancySource(initial = true) {
  /** 中文说明：测试局部值 occupied，由紧邻初始化决定。 */
  let occupied = initial
  /** 中文说明：测试局部值 listeners，由紧邻初始化决定。 */
  const listeners = new Set<() => void>()
  /** 中文说明：测试局部值 useDirectoryFlow，由紧邻初始化决定。 */
  const useDirectoryFlow = bindSnapshotSelector({
    getSnapshot: () => occupied,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  })
  return {
    useDirectoryFlow,
    flip: (next: boolean) => {
      occupied = next
      /** 中文说明：测试局部值 listener，由紧邻初始化决定。 */
      for (const listener of [...listeners]) listener()
    },
  }
}

/** 中文说明：函数 mount 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function mount(
  items: readonly WorkspaceView[] = [workspace('alpha', 'Alpha')],
  createWorkspace = vi.fn(),
  occupancy = occupancySource(),
) {
  /** 中文说明：测试局部值 onPick，由紧邻初始化决定。 */
  const onPick = vi.fn()
  /** 中文说明：测试局部值 onClose，由紧邻初始化决定。 */
  const onClose = vi.fn()
  /** 中文说明：测试局部值 anchorRef，由紧邻初始化决定。 */
  const anchorRef = anchor()
  /** 中文说明：测试局部值 { probe, renderSlot }，由紧邻初始化决定。 */
  const { probe, renderSlot } = flowProbe()
  /** 中文说明：测试局部值 renderPicker，由紧邻初始化决定。 */
  const renderPicker = (nextItems: readonly WorkspaceView[]) => (
    <WorkspacePicker
      open
      anchorRef={anchorRef}
      useSessions={hook(sessions)}
      useSessionPendingInteraction={hook(noPendingInteraction)}
      useWorkspaces={hook(workspaceState(nextItems))}
      onPick={onPick}
      onClose={onClose}
      createWorkspace={createWorkspace}
      useDirectoryFlow={occupancy.useDirectoryFlow}
      renderSlot={renderSlot}
      t={t}
    />
  )
  /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
  const view = render(
    renderPicker(items),
  )
  return {
    view, onPick, onClose, createWorkspace, probe, occupancy,
    rerenderItems: (nextItems: readonly WorkspaceView[]) => { view.rerender(renderPicker(nextItems)) },
  }
}

/** 中文说明：函数 chooseAdd 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function chooseAdd(): void {
  fireEvent.click(screen.getByRole('menuitem', { name: '添加工作区…' }))
}

describe('WorkspacePicker', () => {
  it('lists same-title Workspaces separately and forwards the selected id', () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = mount([workspace('alpha', 'Shared'), workspace('beta', 'Shared')])
    /** 中文说明：测试局部值 entries，由紧邻初始化决定。 */
    const entries = screen.getAllByRole('menuitem', { name: 'Shared' })
    expect(entries).toHaveLength(2)
    fireEvent.click(entries[1]!)
    expect(b.onPick).toHaveBeenCalledWith(wid('beta'))
  })

  it('opens the composed directory flow, adopts its picked path, and selects the returned Workspace', async () => {
    /** 中文说明：测试局部值 created，由紧邻初始化决定。 */
    const created = { ...workspace('adopted'), path: '/tmp/project', title: 'project' }
    /** 中文说明：测试局部值 createWorkspace，由紧邻初始化决定。 */
    const createWorkspace = vi.fn(async () => created)
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = mount([workspace('alpha', 'Alpha')], createWorkspace)
    expect(screen.queryByTestId('directory-flow')).toBeNull()
    chooseAdd()
    expect(b.onClose).toHaveBeenCalled()
    expect(screen.getByTestId('directory-flow')).toBeTruthy()
    await act(async () => { b.probe.owner!.onPicked('/tmp/project') })
    expect(createWorkspace).toHaveBeenCalledWith({ path: '/tmp/project' })
    await waitFor(() => { expect(b.onPick).toHaveBeenCalledWith(created.workspaceId) })
    // Successful adoption withdraws the flow request.
    expect(screen.queryByTestId('directory-flow')).toBeNull()
  })

  it('raises the flow straight from the anchor gesture when adding is the only entry', () => {
    // Nothing to list and one action left: a one-row menu would offer no
    // choice, so the owner's open request lands in the flow itself.
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = mount([])
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.queryByRole('menuitem', { name: '添加工作区…' })).toBeNull()
    expect(b.onClose).toHaveBeenCalled()
    expect(screen.getByTestId('directory-flow')).toBeTruthy()
  })

  it('treats flow cancellation as a silent no-op', () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = mount([workspace('alpha', 'Alpha')])
    chooseAdd()
    act(() => { b.probe.owner!.onCancel() })
    expect(screen.queryByTestId('directory-flow')).toBeNull()
    expect(b.createWorkspace).not.toHaveBeenCalled()
    expect(b.onPick).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('reports a non-Error adoption failure in the folder-error surface', async () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = mount([workspace('alpha', 'Alpha')], vi.fn(async () => { throw 'permission denied' }))
    chooseAdd()
    await act(async () => { b.probe.owner!.onPicked('/one/project') })
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: '无法打开文件夹' })).toBeTruthy()
    })
    expect(screen.getByRole('alert').textContent).toBe('permission denied')
    expect(b.probe.owner!.open).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '重新选择' }))
    expect(b.probe.owner!.open).toBe(true)
    expect(b.onPick).not.toHaveBeenCalled()
  })

  it('disables every menu action from flow open through adoption, and reports busy to the flow', async () => {
    /** 中文说明：测试局部值 resolve，由紧邻初始化决定。 */
    let resolve!: (workspace: WorkspaceView) => void
    /** 中文说明：测试局部值 pending，由紧邻初始化决定。 */
    const pending = new Promise<WorkspaceView>((settle) => { resolve = settle })
    /** 中文说明：测试局部值 created，由紧邻初始化决定。 */
    const created = workspace('adopted')
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = mount([workspace('alpha', 'Alpha')], vi.fn(() => pending))
    chooseAdd()
    // The flow is open but nothing is picked yet: a chooser pending on the
    // host display must already block concurrent workspace actions.
    expect(screen.getByRole<HTMLButtonElement>('menuitem', { name: 'Alpha' }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('menuitem', { name: '添加工作区…' }).disabled).toBe(true)
    act(() => { b.probe.owner!.onPicked('/tmp/project') })
    expect(b.probe.owner!.busy).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('menuitem', { name: 'Alpha' }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('menuitem', { name: '添加工作区…' }).disabled).toBe(true)
    await act(async () => { resolve(created); await pending })
    expect(b.probe.owner!.busy).toBe(false)
  })

  it('shows the flow-reported failure in the folder-error surface', () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = mount([workspace('alpha', 'Alpha')])
    chooseAdd()
    act(() => { b.probe.owner!.onError('no chooser installed') })
    expect(screen.getByRole('alert').textContent).toBe('no chooser installed')
    expect(screen.queryByTestId('directory-flow')).toBeNull()
    expect(b.createWorkspace).not.toHaveBeenCalled()
  })

  it('closes the folder-error surface when the user cancels', () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = mount([workspace('alpha', 'Alpha')])
    chooseAdd()
    act(() => { b.probe.owner!.onError('no chooser installed') })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('waits to show its menu until an optional anchor is available', () => {
    /** 中文说明：测试局部值 { renderSlot }，由紧邻初始化决定。 */
    const { renderSlot } = flowProbe()
    render(
      <WorkspacePicker
        open useSessions={hook(sessions)} useWorkspaces={hook(workspaceState([workspace('alpha', 'Alpha')]))}
        useSessionPendingInteraction={hook(noPendingInteraction)}
        onPick={vi.fn()} onClose={vi.fn()} createWorkspace={vi.fn()}
        useDirectoryFlow={occupancySource().useDirectoryFlow} renderSlot={renderSlot} t={t}
      />,
    )
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('keeps the menu up while the list baseline is still in flight', () => {
    const state: WorkspaceSnapshot = {
      ...workspaceState([]), phase: 'pending', state: 'loading',
    }
    /** 中文说明：测试局部值 { renderSlot }，由紧邻初始化决定。 */
    const { renderSlot } = flowProbe()
    render(
      <WorkspacePicker
        open anchorRef={anchor()} useSessions={hook(sessions)} useWorkspaces={hook(state)}
        useSessionPendingInteraction={hook(noPendingInteraction)}
        onPick={vi.fn()} onClose={vi.fn()} createWorkspace={vi.fn()}
        useDirectoryFlow={occupancySource().useDirectoryFlow} renderSlot={renderSlot} t={t}
      />,
    )
    // An empty list is not final yet: jumping into the directory flow here
    // would pre-empt the workspaces about to arrive.
    expect(screen.getByRole('status').textContent).toBe('正在加载工作区…')
    expect(screen.queryByTestId('directory-flow')).toBeNull()
    expect(screen.getByRole('menuitem', { name: '添加工作区…' })).toBeTruthy()
  })

  it('shows no popover at all when nothing is listed and nothing can be added', () => {
    // A composition mounting this package without any directory-picker: the
    // hero anchor has neither a Workspace to pick nor a way to add one, so it
    // must not claim a choice with an empty menu.
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = mount([], vi.fn(), occupancySource(false))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.queryByTestId('directory-flow')).toBeNull()
    expect(b.createWorkspace).not.toHaveBeenCalled()
  })

  it('holds the anchor gesture while an adoption is still settling', async () => {
    // The auto-open path obeys the same busy rule as the disabled menu entry:
    // an occupant that re-registers mid-adoption must not raise a second flow.
    /** 中文说明：测试局部值 resolve，由紧邻初始化决定。 */
    let resolve!: (workspace: WorkspaceView) => void
    /** 中文说明：测试局部值 pending，由紧邻初始化决定。 */
    const pending = new Promise<WorkspaceView>((settle) => { resolve = settle })
    /** 中文说明：测试局部值 created，由紧邻初始化决定。 */
    const created = workspace('adopted')
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = mount([workspace('alpha', 'Alpha')], vi.fn(() => pending))
    chooseAdd()
    act(() => { b.probe.owner!.onPicked('/tmp/project') })
    expect(b.probe.owner!.busy).toBe(true)
    // The list empties under the still-settling adoption (the workspace was
    // deleted elsewhere), which would otherwise make add the only entry.
    act(() => { b.rerenderItems([]) })
    expect(b.createWorkspace).toHaveBeenCalledTimes(1)
    await act(async () => { resolve(created); await pending })
    expect(b.probe.owner!.busy).toBe(false)
  })

  it('hides the add entry while the directory-flow hole is empty', () => {
    mount([workspace('alpha', 'Alpha')], vi.fn(), occupancySource(false))
    expect(screen.getByRole('menuitem', { name: 'Alpha' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: '添加工作区…' })).toBeNull()
  })

  it('shows the add entry when a flow package activates after the first paint', () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = mount([workspace('alpha', 'Alpha')], vi.fn(), occupancySource(false))
    expect(screen.queryByRole('menuitem', { name: '添加工作区…' })).toBeNull()
    // Registration changes flow through the subscription, no re-render needed.
    act(() => { b.occupancy.flip(true) })
    expect(screen.getByRole('menuitem', { name: '添加工作区…' })).toBeTruthy()
  })

  it('keeps Choose again inert while the flow occupant is gone, and snaps back a flow opened over an empty hole', async () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = mount([workspace('alpha', 'Alpha')], vi.fn(async () => { throw new Error('adoption failed') }))
    chooseAdd()
    await act(async () => { b.probe.owner!.onPicked('/one/project') })
    await waitFor(() => { expect(screen.getByRole('dialog', { name: '无法打开文件夹' })).toBeTruthy() })
    // The occupant unloads while the error dialog is up: retrying would open
    // a flow nobody can serve or cancel, so the button goes inert.
    act(() => { b.occupancy.flip(false) })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '重新选择' }).disabled).toBe(true)
    // Cancel stays the way out, and the menu actions are usable again.
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.getByRole<HTMLButtonElement>('menuitem', { name: 'Alpha' }).disabled).toBe(false)
  })

  it('withdraws an open flow when its occupant unloads, re-enabling the menu actions', () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = mount([workspace('alpha', 'Alpha')])
    chooseAdd()
    expect(screen.getByTestId('directory-flow')).toBeTruthy()
    // The flow plugin unloads mid-interaction (HMR): nobody is left to
    // cancel, so the owner withdraws and the actions come back.
    act(() => { b.occupancy.flip(false) })
    expect(b.probe.owner!.open).toBe(false)
    expect(screen.getByRole<HTMLButtonElement>('menuitem', { name: 'Alpha' }).disabled).toBe(false)
    expect(screen.queryByRole('menuitem', { name: '添加工作区…' })).toBeNull()
  })
})
