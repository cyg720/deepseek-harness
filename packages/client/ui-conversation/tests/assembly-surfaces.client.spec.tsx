// @vitest-environment jsdom
/*
 * 文件职责：验证会话界面的 assembly-surfaces.client.spec.tsx 行为和边界。
 * 技术维度：Vitest、React 测试渲染、事件模拟与可控服务替身。
 * 产品维度：防止会话界面交互和展示在扩展后回归。
 * 逻辑维度：构造状态，触发渲染或交互，再断言输出和清理。
 * 关键边界：全局替身、计时器和异步任务必须在用例后恢复。
 * 新手阅读建议：先读辅助夹具，再按 describe 场景顺序阅读。
 */
/** Conversation assembly acceptance independent of Tool presentation. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { ISession, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotTestRuntime, usePinnedBrowserLanguages, stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject, type EmptyWorkspaceOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'

usePinnedBrowserLanguages('zh-CN')

/** 中文说明：测试局部值 SID，取值由紧邻初始化决定。 */
const SID = 's1' as SessionId

/** jsdom has no ResizeObserver; the composer seat publishes its height through one. */
/* 中文说明：类型或类 ResizeObserverStub 约束本文件的数据或组件职责。 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
})

/** 中文说明：类型或类 AppRootProps 约束本文件的数据或组件职责。 */
type AppRootProps = PropsRenderSlots<'conversation' | 'details'>
/** 中文说明：函数 AppRoot 的参数见签名，返回结果供相邻流程使用；示例见本文件调用处。 */
function AppRoot({ renderSlot }: AppRootProps) {
  return <>{renderSlot('conversation', {})}</>
}

/** 中文说明：测试局部值 LAYOUT_CHILDREN，取值由紧邻初始化决定。 */
const LAYOUT_CHILDREN = {
  'conversation': { kind: 'single', scope: 'session-maybe' },
  'details': { kind: 'single', scope: 'session' },
} as const

/** 中文说明：函数 WorkspaceProbe 的参数见签名，返回结果供相邻流程使用；示例见本文件调用处。 */
function WorkspaceProbe({ open }: EmptyWorkspaceOwnerProps) {
  /** 中文说明：测试局部值 [count, setCount]，取值由紧邻初始化决定。 */
  const [count, setCount] = useState(0)
  return (
    <button data-testid="workspace-probe" onClick={() => { setCount(value => value + 1) }}>
      {String(open)}:{count}
    </button>
  )
}

/** 中文说明：函数 bench 的参数见签名，返回结果供相邻流程使用；示例见本文件调用处。 */
async function bench(opts?: { blank?: boolean }) {
  /** 中文说明：测试局部值 runtime，取值由紧邻初始化决定。 */
  const runtime = await SlotTestRuntime.create()
  runtime.provide('connection', { api: { settings: {} }, isLoopback: false })
  // The plugin injects both; these specs exercise no settings path.
  runtime.provide('remote', { $on: () => () => {} })
  runtime.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  runtime.provide('layout', { openDetails: vi.fn(), closeDetails: vi.fn() })
  /** 中文说明：测试局部值 locale，取值由紧邻初始化决定。 */
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.provide('locale', locale)
  runtime.slots.installLocale(locale)
  await runtime.sessions.add({
    id: SID,
    summary: { title: 'S', displayTitle: 'S', cwd: '/proj' },
    snapshot: {
      nodes: [],
      ...(opts?.blank === true ? { blank: true, composerPhase: 'blank' as const } : {}),
    },
    session: {
      loadOlder: vi.fn<ISession['loadOlder']>(),
      prompt: vi.fn<ISession['prompt']>(async () => ({ ok: true, value: { accepted: true } })),
    },
  })
  await runtime.root.declare(LAYOUT_CHILDREN, AppRoot)
  await runtime.mount({ inject: [...inject], apply })
  return runtime
}

describe('resident composer', () => {
  it('renders the locked view state while no session exists at all', async () => {
    /** 中文说明：测试局部值 runtime，取值由紧邻初始化决定。 */
    const runtime = await SlotTestRuntime.create()
    runtime.provide('connection', { api: { settings: {} }, isLoopback: false })
    // The plugin injects both; these specs exercise no settings path.
    runtime.provide('remote', { $on: () => () => {} })
    runtime.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
    runtime.provide('layout', { openDetails: vi.fn(), closeDetails: vi.fn() })
    /** 中文说明：测试局部值 locale，取值由紧邻初始化决定。 */
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.provide('locale', locale)
    runtime.slots.installLocale(locale)
    await runtime.root.declare(LAYOUT_CHILDREN, AppRoot)
    await runtime.mount({ inject: [...inject], apply })
    runtime.slots.register({ name: 'conversation.hero.workspace' }, WorkspaceProbe)
    /** 中文说明：测试局部值 view，取值由紧邻初始化决定。 */
    const view = runtime.renderRoot()
    /** 中文说明：测试局部值 textarea，取值由紧邻初始化决定。 */
    const textarea = view.container.querySelector('textarea')
    expect(textarea).not.toBeNull()
    expect(textarea!.disabled).toBe(false)
    expect(textarea!.readOnly).toBe(true)
    expect(textarea!.getAttribute('aria-haspopup')).toBe('menu')
    expect(view.getByTestId('workspace-probe').textContent).toBe('false:0')
    fireEvent.click(textarea!)
    expect(view.getByTestId('workspace-probe').textContent).toBe('true:0')
    expect(textarea!.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(view.getByRole('button', { name: '选择工作区' }))
    fireEvent.keyDown(textarea!, { key: 'Enter' })
    expect(view.getByTestId('workspace-probe').textContent).toBe('true:0')
    expect(view.getByRole('button', { name: '选择工作区' })).toBeTruthy()
    await runtime.dispose()
  })

  it('keeps the complete Hero tree mounted when the first Workspace session appears', async () => {
    /** 中文说明：测试局部值 runtime，取值由紧邻初始化决定。 */
    const runtime = await SlotTestRuntime.create()
    runtime.provide('connection', { api: { settings: {} }, isLoopback: false })
    // The plugin injects both; these specs exercise no settings path.
    runtime.provide('remote', { $on: () => () => {} })
    runtime.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
    runtime.provide('layout', { openDetails: vi.fn(), closeDetails: vi.fn() })
    /** 中文说明：测试局部值 locale，取值由紧邻初始化决定。 */
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.provide('locale', locale)
    runtime.slots.installLocale(locale)
    await runtime.workspaces.update((draft) => {
      draft.items = [{ workspaceId: 'w1', title: 'Proj', path: '/proj', sessionIds: [SID] }] as never
    })
    await runtime.root.declare(LAYOUT_CHILDREN, AppRoot)
    await runtime.mount({ inject: [...inject], apply })
    runtime.slots.register({ name: 'conversation.hero.workspace' }, WorkspaceProbe)
    /** 中文说明：测试局部值 view，取值由紧邻初始化决定。 */
    const view = runtime.renderRoot()

    /** 中文说明：测试局部值 root，取值由紧邻初始化决定。 */
    const root = view.container.querySelector('[data-phase="hero"]')!
    /** 中文说明：测试局部值 scrollBody，取值由紧邻初始化决定。 */
    const scrollBody = view.container.querySelector('[data-conversation-scroll]')!
    /** 中文说明：测试局部值 composerSeat，取值由紧邻初始化决定。 */
    const composerSeat = view.container.querySelector('[data-composer-seat]')!
    /** 中文说明：测试局部值 textarea，取值由紧邻初始化决定。 */
    const textarea = view.container.querySelector('textarea')!
    /** 中文说明：测试局部值 workspaceChip，取值由紧邻初始化决定。 */
    const workspaceChip = view.getByRole('button', { name: '选择工作区' })
    /** 中文说明：测试局部值 workspaceProbe，取值由紧邻初始化决定。 */
    const workspaceProbe = view.getByTestId('workspace-probe')
    expect(textarea.disabled).toBe(false)
    expect(textarea.readOnly).toBe(true)

    fireEvent.click(workspaceChip)
    fireEvent.click(workspaceProbe)
    expect(workspaceProbe.textContent).toBe('true:1')

    await runtime.sessions.add({
      id: SID,
      summary: { title: 'S', displayTitle: 'S', cwd: '/proj', blank: true },
      snapshot: { blank: true, composerPhase: 'blank' },
    })

    expect(view.container.querySelector('[data-phase="hero"]')).toBe(root)
    expect(view.container.querySelector('[data-conversation-scroll]')).toBe(scrollBody)
    expect(view.container.querySelector('[data-composer-seat]')).toBe(composerSeat)
    expect(view.container.querySelector('textarea')).toBe(textarea)
    expect(view.getByRole('button', { name: '选择工作区' })).toBe(workspaceChip)
    expect(view.getByTestId('workspace-probe')).toBe(workspaceProbe)
    expect(workspaceProbe.textContent).toBe('true:1')
    expect(textarea.disabled).toBe(false)
    expect(textarea.readOnly).toBe(false)
    await runtime.dispose()
  })

  it('the textarea survives the blank→active conversion as the same DOM node', async () => {
    /** 中文说明：测试局部值 runtime，取值由紧邻初始化决定。 */
    const runtime = await bench({ blank: true })
    await runtime.workspaces.update((draft) => {
      draft.items = [{ workspaceId: 'w1', title: 'Proj', path: '/proj', sessionIds: [SID] }] as never
    })
    /** 中文说明：测试局部值 view，取值由紧邻初始化决定。 */
    const view = runtime.renderRoot()
    /** 中文说明：测试局部值 hero，取值由紧邻初始化决定。 */
    const hero = view.container.querySelector('textarea')
    expect(hero).not.toBeNull()
    expect(hero!.disabled).toBe(false)

    await runtime.sessions.updateSnapshot(SID, (draft) => {
      draft.blank = false
      draft.composerPhase = 'active'
    })
    expect(view.container.querySelector('textarea')).toBe(hero)
    await runtime.dispose()
  })
})

describe('prompt rejection through the assembled composer', () => {
  it('renders the promptError alert strip and keeps the draft in the machine', async () => {
    /** 中文说明：测试局部值 runtime，取值由紧邻初始化决定。 */
    const runtime = await SlotTestRuntime.create()
    runtime.provide('connection', { api: { settings: {} }, isLoopback: false })
    // The plugin injects both; these specs exercise no settings path.
    runtime.provide('remote', { $on: () => () => {} })
    runtime.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
    runtime.provide('layout', { openDetails: vi.fn(), closeDetails: vi.fn() })
    /** 中文说明：测试局部值 locale，取值由紧邻初始化决定。 */
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.provide('locale', locale)
    runtime.slots.installLocale(locale)
    /** 中文说明：测试局部值 prompt，取值由紧邻初始化决定。 */
    const prompt = vi.fn<ISession['prompt']>(async () => ({
      ok: false, error: { code: 'agent-busy', message: 'prompt rejected before acceptance', details: { reason: 'busy' } },
    }))
    await runtime.sessions.add({
      id: SID,
      summary: { title: 'S', displayTitle: 'S', cwd: '/proj' },
      session: { prompt, loadOlder: vi.fn<ISession['loadOlder']>() },
    })
    await runtime.root.declare(LAYOUT_CHILDREN, AppRoot)
    await runtime.mount({ inject: [...inject], apply })
    /** 中文说明：测试局部值 view，取值由紧邻初始化决定。 */
    const view = runtime.renderRoot()

    /** 中文说明：测试局部值 composer，取值由紧邻初始化决定。 */
    const composer = view.container.querySelector('textarea')!
    fireEvent.change(composer, { target: { value: 'do not lose this' } })
    fireEvent.keyDown(composer, { key: 'Enter' })
    await waitFor(() => { expect(prompt).toHaveBeenCalledOnce() })

    await runtime.sessions.updateSnapshot(SID, (draft) => {
      draft.promptError = {
        op: 'send',
        error: { code: 'agent-busy', message: 'prompt rejected before acceptance', details: { reason: 'busy' } },
      }
    })
    /** 中文说明：测试局部值 alert，取值由紧邻初始化决定。 */
    const alert = await view.findByRole('alert')
    expect(alert.textContent).toContain('prompt rejected before acceptance (agent-busy)')
    await waitFor(() => {
      expect((view.container.querySelector('textarea'))!.value).toBe('do not lose this')
    })
    await runtime.dispose()
  })
})

describe('title projection across assembled surfaces', () => {
  it('one summary update re-labels the current-session crumb', async () => {
    /** 中文说明：测试局部值 runtime，取值由紧邻初始化决定。 */
    const runtime = await bench()
    /** 中文说明：测试局部值 view，取值由紧邻初始化决定。 */
    const view = runtime.renderRoot()
    /** 中文说明：测试局部值 hierarchy，取值由紧邻初始化决定。 */
    const hierarchy = view.getByRole('navigation', { name: '会话层级' })
    expect(within(hierarchy).getByRole('button', { name: 'S' }).hasAttribute('disabled')).toBe(true)

    await runtime.sessions.updateSummary(SID, { displayTitle: '修订标题', title: '修订标题' })
    await waitFor(() => {
      expect(within(hierarchy).getByRole('button', { name: '修订标题' }).hasAttribute('disabled')).toBe(true)
    })
    expect(within(hierarchy).queryByRole('button', { name: 'S' })).toBeNull()
    await runtime.dispose()
  })
})
