// @vitest-environment jsdom
// The Tool presentation package's acceptance chain on the REAL machinery stack:
// SlotTestRuntime (cordis Context + SlotRegistry ledger + the ui-renderer
// renderer) + ui-conversation and ui-tool apply — no outlet twins. Proves the
// keyed 'tool.call.toolview' hole end to end: registered rows dispatch by
// entryKey (the bash sample lands through its plugin), unregistered tools
// fall back to GenericToolCard at the render site, live registration/unload
// flips rows in place, duplicate keys fail loud, the inject channel feeds
// (sessionId) => I into row components, and a registrant can activate before
// the declaration then land through slots.inject when the chat entry appears.
/**
 * 文件职责：验证工具调用的 toolview-slot.client.spec.tsx 行为。
 * 技术维度：Vitest、React 渲染、插槽替身和类型化工具数据。
 * 产品维度：防止工具调用展示与展开交互回归。
 * 逻辑维度：构造工具调用或轨迹数据，渲染后断言 DOM 与状态。
 * 关键边界：测试只验证展示，不执行真实工具；DOM 和替身必须清理。
 * 新手阅读建议：先读数据夹具，再按工具类型和状态阅读。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import type { ISession, SessionId, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotTestRuntime, stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply as applyConversation, inject as injectConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { apply as applyTool, inject as injectTool } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { toolChatSnapshot } from './tool-details-render.client.tsx'

/** 中文说明：测试局部值 SID，由紧邻初始化决定。 */
const SID = 's1' as SessionId

/** jsdom has no ResizeObserver; the composer seat publishes its height through one. */
/** 中文说明：类型或类 ResizeObserverStub 约束工具或轨迹数据职责。 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
// The chat store persists under its declared key; clear between cases.
beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
})

/** 中文说明：测试局部值 toolResult，由紧邻初始化决定。 */
const toolResult = (seq: number, callId: string, name: string, args = '{"command":"make build","description":"Build"}'): ToolResultNode => ({
  kind: 'tool-result', seq, time: seq * 1_000, callId,
  call: { name, argsRaw: args },
  callTime: seq * 1_000 - 500,
  content: [], isError: false, callView: null, resultView: null, subCalls: [],
})

/** Test-owned AppFrame role: declares and renders the resident conversation area. */
/** 中文说明：类型或类 AppRootProps 约束工具或轨迹数据职责。 */
type AppRootProps = PropsRenderSlots<'conversation' | 'details'>
/** 中文说明：函数 AppRoot 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function AppRoot({ renderSlot }: AppRootProps) {
  return <>{renderSlot('conversation', {})}</>
}

/** 中文说明：测试局部值 LAYOUT_CHILDREN，由紧邻初始化决定。 */
const LAYOUT_CHILDREN = {
  'conversation': { kind: 'single', scope: 'session-maybe' },
  'details': { kind: 'single', scope: 'session' },
} as const

/**
 * Real-stack bench: SlotTestRuntime with the session/layout doubles at the
 * service boundaries only, the package apply on its own
 * fiber, and the test AppFrame occupying 'root'.
 */
/** 中文说明：函数 bench 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
async function bench(nodes: ToolResultNode[]) {
  /** 中文说明：测试局部值 runtime，由紧邻初始化决定。 */
  const runtime = await SlotTestRuntime.create()
  runtime.provide('connection', {
    api: { settings: {} },
    isLoopback: false,
    hostDescription: { getSnapshot: () => undefined, subscribe: () => () => {} },
  })
  // ui-theme's Appearance row binds a durable scope through these two.
  runtime.provide('remote', { $on: () => () => {} })
  runtime.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  /** 中文说明：测试局部值 layout，由紧邻初始化决定。 */
  const layout = { openDetails: vi.fn(), closeDetails: vi.fn() }
  runtime.provide('layout', layout)
  /** 中文说明：测试局部值 locale，由紧邻初始化决定。 */
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.provide('locale', locale)
  runtime.slots.installLocale(locale)
  await runtime.sessions.add({
    id: SID,
    summary: { title: 'S', displayTitle: 'S' },
    snapshot: { nodes, chat: toolChatSnapshot(nodes) },
    session: {
      loadOlder: vi.fn<ISession['loadOlder']>(),
      prompt: vi.fn<ISession['prompt']>(async () => ({ ok: true, value: { accepted: true } })),
    },
  })
  await runtime.root.declare(LAYOUT_CHILDREN, AppRoot)
  await runtime.mount({ inject: [...injectConversation], apply: applyConversation })
  await runtime.mount({ inject: [...injectTool], apply: applyTool })
  return { runtime, slots: runtime.slots, layout }
}

describe('keyed toolview hole through the real machinery', () => {
  it('dispatches registered rows by entryKey and unregistered tools to the GenericToolCard fallback', async () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench([
      toolResult(3, 'c1', 'bash'),
      toolResult(4, 'c2', 'mystery', '{"n":1}'),
    ])
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = b.runtime.renderRoot()
    // bash: the sample plugin's keyed registration took the row (root
    // session → global arm, decided inside the component off useSessions).
    expect(view.container.querySelector('[data-sample="bash"]')).not.toBeNull()
    expect(view.getByText('Bash')).toBeTruthy()
    expect(view.getByText('Build')).toBeTruthy()
    // mystery: no registration under that key → render-site fallback.
    expect(view.getByText('Tool call')).toBeTruthy()
    await b.runtime.dispose()
  })

  it('renders top-level Cordis calls with lifecycle titles over the generic variants', async () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench([
      toolResult(3, 'cordis-1', 'cordis_runtime_inspect', '{"what":"api","name":"tools"}'),
      toolResult(4, 'cordis-2', 'cordis_run', '{"id":"dyn-2"}'),
      toolResult(5, 'cordis-3', 'cordis_stop', '{"id":"dyn-2"}'),
      toolResult(6, 'cordis-4', 'cordis_undefine', '{"id":"dyn-2"}'),
    ])
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = b.runtime.renderRoot()

    // Every one of these rows is user-visible on each model define/run, so each
    // names its act and carries the package id rather than falling back to the
    // generic "Tool call · <name> · <id>" row.
    /** 中文说明：测试局部值 rowText，由紧邻初始化决定。 */
    const rowText = (name: string) => view.container.querySelector(`[data-tool="${name}"]`)?.textContent
    expect(rowText('cordis_runtime_inspect')).toContain('Inspect')
    expect(rowText('cordis_run')).toContain('Run Cordis Plugindyn-2')
    expect(rowText('cordis_stop')).toContain('Stop Cordis Plugindyn-2')
    expect(rowText('cordis_undefine')).toContain('Remove Cordis Plugindyn-2')
    // No run-control verb is a code row; the program is cordis_define's, and its
    // own keyed card owns that rendering.
    expect(view.container.querySelector('[data-variant="code"]')).toBeNull()
    await b.runtime.dispose()
  })

  it('file-path clicks travel owner openFile → chat inject → workspaces.openPath', async () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench([toolResult(3, 'c1', 'read', '{"path":"src/a.ts"}')])
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = b.runtime.renderRoot()
    view.getByText('src/a.ts').click()
    expect(b.layout.openDetails).not.toHaveBeenCalled()
    await vi.waitFor(() => {
      expect(b.runtime.workspaces.calls).toContainEqual({ method: 'openPath', args: ['src/a.ts'] })
    })
    await b.runtime.dispose()
  })

  it('bash summary clicks do not open details or host paths', async () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench([toolResult(3, 'c1', 'bash')])
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = b.runtime.renderRoot()
    view.getByText('Build').click()
    expect(b.layout.openDetails).not.toHaveBeenCalled()
    expect(b.runtime.workspaces.calls.some(c => c.method === 'openPath')).toBe(false)
    await b.runtime.dispose()
  })

  it('a live keyed registration takes over its tool row and unload reverts to the fallback', async () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench([toolResult(3, 'c2', 'mystery', '{"n":1}')])
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = b.runtime.renderRoot()
    expect(view.getByText('Tool call')).toBeTruthy()
    /** 中文说明：测试局部值 dispose，由紧邻初始化决定。 */
    let dispose = (): void => {}
    dispose = b.slots.register(
      { name: 'tool.call.toolview', key: 'mystery' },
      () => <div data-testid="mystery-row" />)
    await b.runtime.flush()
    // Per-key version tick: the row flipped without a remount of the view.
    expect(view.getByTestId('mystery-row')).toBeTruthy()
    expect(view.queryByText('Tool call')).toBeNull()
    dispose()
    await b.runtime.flush()
    expect(view.queryByTestId('mystery-row')).toBeNull()
    expect(view.getByText('Tool call')).toBeTruthy()
    await b.runtime.dispose()
  })

  it('a duplicate key registration fails loud at load', async () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench([])
    expect(() => b.slots.register(
      { name: 'tool.call.toolview', key: 'bash' },
      () => null,
    )).toThrow(/key "bash"/)
    await b.runtime.dispose()
  })

  it('the inject channel feeds (sessionId) => I into the row component', async () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench([toolResult(3, 'c3', 'probe', '{"x":1}')])
    /** 中文说明：测试局部值 poked，由紧邻初始化决定。 */
    const poked: string[] = []
    b.slots.register({
      name: 'tool.call.toolview',
      key: 'probe',
      // Two-way business face: data derived from the session id out, a
      // callback closing over it back in — the askuser-pattern inject shape.
      inject: (sessionId: SessionId) => ({
        mark: `for:${sessionId}`,
        poke: () => { poked.push(sessionId) },
      }),
    }, ({ mark, poke }: ToolCallViewProps & { mark: string; poke: () => void }) => (
      <button data-testid="probe-row" onClick={poke}>{mark}</button>
    ))
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = b.runtime.renderRoot()
    /** 中文说明：测试局部值 row，由紧邻初始化决定。 */
    const row = view.getByTestId('probe-row')
    expect(row.textContent).toBe(`for:${SID}`)
    row.click()
    expect(poked).toEqual([SID])
    await b.runtime.dispose()
  })
})

describe('registrant declaration injection', () => {
  it('runs a registrant before ui-tool and waits on the actual toolview declaration', async () => {
    /** 中文说明：测试局部值 runtime，由紧邻初始化决定。 */
    const runtime = await SlotTestRuntime.create()
    runtime.provide('connection', {
      api: { settings: {} },
      isLoopback: false,
      hostDescription: { getSnapshot: () => undefined, subscribe: () => () => {} },
    })
    // ui-theme's Appearance row binds a durable scope through these two.
    runtime.provide('remote', { $on: () => () => {} })
    runtime.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
    runtime.provide('layout', { openDetails: vi.fn(), closeDetails: vi.fn() })
    /** 中文说明：测试局部值 locale，由紧邻初始化决定。 */
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.provide('locale', locale)
    runtime.slots.installLocale(locale)
    await runtime.root.declare(LAYOUT_CHILDREN, AppRoot)

    // Third-party posture, mounted BEFORE ui-conversation. Plugin apply runs,
    // while slots.inject waits for the declaration itself.
    /** 中文说明：测试局部值 applyRuns，由紧邻初始化决定。 */
    let applyRuns = 0
    /** 中文说明：测试局部值 registrantApply，由紧邻初始化决定。 */
    const registrantApply = (registrantCtx: typeof runtime.ctx): void => {
      applyRuns += 1
      registrantCtx.slots.inject('tool.call.toolview', () => registrantCtx.slots.register(
        { name: 'tool.call.toolview', key: 'late' }, () => null))
    }
    /** 中文说明：测试局部值 late，由紧邻初始化决定。 */
    const late = runtime.ctx.plugin({
      name: 'late-registrant',
      inject: ['slots'],
      apply: registrantApply,
    })
    await Promise.resolve()
    await late.await()
    expect(applyRuns).toBe(1)
    expect(runtime.slots.entries('tool.call.toolview')).toHaveLength(0)

    // Mounting the package declares the slot and activates the waiting entry.
    await runtime.mount({ inject: [...injectConversation], apply: applyConversation })
    await runtime.mount({ inject: [...injectTool], apply: applyTool })
    expect(runtime.slots.entries('tool.call.toolview').map(e => e.options.key))
      .toEqual(expect.arrayContaining(['bash', 'late']))
    await runtime.dispose()
  })
})
