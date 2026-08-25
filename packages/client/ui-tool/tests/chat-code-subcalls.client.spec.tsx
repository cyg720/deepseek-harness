// @vitest-environment jsdom
// Code Mode sub-call acceptance on the REAL machinery stack (same bench as
// chat-toolview-slot.spec): a run_code result renders the 'code' variant row
// (description summary, program body), its logged sub-dispatches render as
// always-visible nested rows through the SAME keyed toolview hole — the bash
// sub-call lands in the bash sample plugin's registration exactly like a
// top-level bash row, unregistered sub-tools fall back to GenericToolCard —
// and a file sub-row click opens the host path. Running parents
// (runningCalls) nest their so-far dispatches the same way.
/**
 * 文件职责：验证工具调用的 chat-code-subcalls.client.spec.tsx 行为。
 * 技术维度：Vitest、React 渲染、插槽替身和类型化工具数据。
 * 产品维度：防止工具调用展示与展开交互回归。
 * 逻辑维度：构造工具调用或轨迹数据，渲染后断言 DOM 与状态。
 * 关键边界：测试只验证展示，不执行真实工具；DOM 和替身必须清理。
 * 新手阅读建议：先读数据夹具，再按工具类型和状态阅读。
 */

import { Context } from '@deepseek-ai/cordis'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import {
  ConversationEventRegistry, ConversationViewRegistry, createSnapshotStore,
  EMPTY_CONVERSATION_VIEWS, SlotRegistry,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ConversationSnapshot, RunningToolCall, SessionId, SessionListState,
  ToolCallBlock, ToolResultNode, WorkspaceListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import { createSlotRenderer } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { apply as applyConversation, inject as injectConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { apply as applyTool, inject as injectTool } from '../src/client/apply.ts'
import { toolChatSnapshot } from './tool-details-render.client.tsx'

/** 中文说明：测试局部值 SID，由紧邻初始化决定。 */
const SID = 's1' as SessionId

/** jsdom has no ResizeObserver; the composer seat publishes its height through one. */
/* 中文说明：类型或类 ResizeObserverStub 约束工具或轨迹数据职责。 */
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

/** 中文说明：测试局部值 PROGRAM，由紧邻初始化决定。 */
const PROGRAM = 'const listing = await tools.bash({ command: "ls notes", description: "List notes" })\nreturn listing'
/** 中文说明：测试局部值 RUN_CODE_ARGS，由紧邻初始化决定。 */
const RUN_CODE_ARGS = JSON.stringify({ code: PROGRAM, description: 'List the notes directory' })

/** 中文说明：测试局部值 codeResult，由紧邻初始化决定。 */
const codeResult = (seq: number, callId: string): ToolResultNode => ({
  kind: 'tool-result', seq, time: seq * 1_000, callId,
  call: { name: 'run_code', argsRaw: RUN_CODE_ARGS },
  callTime: seq * 1_000 - 500,
  content: [{ type: 'text', text: 'demo.txt' }], isError: false, callView: null, resultView: null,
  subCalls: [],
})

/** 中文说明：测试局部值 runningCode，由紧邻初始化决定。 */
const runningCode = (callId: string): RunningToolCall => ({
  callId, name: 'run_code', argsRaw: RUN_CODE_ARGS, turn: 9, step: 0, time: 9_000, callView: null,
  subCalls: [],
})

/** 中文说明：测试局部值 subCall，由紧邻初始化决定。 */
const subCall = (
  seq: number, parent: string, n: number, name: string, args: object, resultText: string, isError = false,
): ToolCallBlock => ({
  kind: 'tool-result', seq, time: seq * 1_000,
  callId: `${parent}:code:${n}`,
  call: { name, argsRaw: JSON.stringify(args) },
  callTime: seq * 1_000,
  content: [{ type: 'text', text: resultText }], isError, callView: null, resultView: null,
  subCalls: [],
})

/** 中文说明：函数 snapshotWith 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function snapshotWith(
  nodes: ToolResultNode[],
  subCalls: readonly ToolCallBlock[],
  runningCalls: RunningToolCall[] = [],
): ConversationSnapshot {
  /** 中文说明：测试局部值 nestedNodes，由紧邻初始化决定。 */
  const nestedNodes = nodes.map(node => ({ ...node, subCalls }))
  /** 中文说明：测试局部值 nestedRunningCalls，由紧邻初始化决定。 */
  const nestedRunningCalls = runningCalls.map(call => ({ ...call, subCalls }))
  return {
    sessionId: SID, views: EMPTY_CONVERSATION_VIEWS,
    chat: toolChatSnapshot(nestedNodes, nestedRunningCalls),
    nodes: nestedNodes, turnTimings: new Map(), turnEnds: new Map(), partial: null,
    runningCalls: nestedRunningCalls,
    pending: [], queue: [], running: runningCalls.length > 0, composerPhase: 'active', removed: false,
    openState: 'open', openError: null,
    hasMore: false, loadingOlder: false, promptError: null, blank: false, subagent: null, lastAgentError: null,
  }
}

/** Test-owned AppFrame role: declares and renders the resident conversation area. */
/* 中文说明：类型或类 AppRootProps 约束工具或轨迹数据职责。 */
type AppRootProps = PropsRenderSlots<'conversation' | 'details'>
/** 中文说明：函数 AppRoot 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function AppRoot({ renderSlot }: AppRootProps) {
  return <>{renderSlot('conversation', {})}</>
}

/**
 * Same real-stack bench as the toolview-slot spec: SlotRegistry + renderer +
 * both owning package applies; fakes only at service boundaries.
 */
/* 中文说明：函数 bench 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
async function bench(snapshot: ConversationSnapshot) {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  /** 中文说明：测试局部值 slotsFiber，由紧邻初始化决定。 */
  const slotsFiber = ctx.plugin(SlotRegistry)
  await slotsFiber.await()
  await ctx.plugin(ConversationEventRegistry).await()
  await ctx.plugin(ConversationViewRegistry).await()
  /** 中文说明：测试局部值 slots，由紧邻初始化决定。 */
  const slots = ctx.get('slots') as SlotRegistry

  /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
  const session = createSnapshotStore<ConversationSnapshot>(snapshot)
  /** 中文说明：测试局部值 list，由紧邻初始化决定。 */
  const list = createSnapshotStore<SessionListState>({
    ids: [SID],
    byId: { [SID]: { id: SID, title: 'S', displayTitle: 'S', running: false, blank: false, updatedAt: 1 } },
    current: SID,
    phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
  })
  /** 中文说明：测试局部值 scoped，由紧邻初始化决定。 */
  const scoped = { send: vi.fn(async () => {}), cancel: vi.fn(async () => {}) }
  /** 中文说明：测试局部值 layout，由紧邻初始化决定。 */
  const layout = { openDetails: vi.fn(), closeDetails: vi.fn() }
  // Provide-channel contributions land in this bundle the way the runtime
  // materializes them; the renderer host serves it through provideInfo.
  /** 中文说明：测试局部值 provided，由紧邻初始化决定。 */
  const provided: { hooks: Record<string, unknown>; props: Record<string, unknown> } = { hooks: {}, props: {} }
  // Identity-stable currentProvideInfo snapshot (uSES getSnapshot contract),
  // materialized on first render after the provide contributions landed.
  /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
  let infoCell: { sessionId: SessionId; hooks: Record<string, unknown>; props: Record<string, unknown> } | undefined
  /** 中文说明：测试局部值 sessionsFake，由紧邻初始化决定。 */
  const sessionsFake = {
    list,
    binding: (id: SessionId) => (id === SID
      ? { sessionId: SID, session, ctx: { effect: () => {}, on: () => () => {} } }
      : undefined),
    scope: () => ({ get: () => scoped }),
    scopeOf: () => SID,
    provide: (descriptor: { resolve: (binding: unknown) => { hooks?: Record<string, unknown>; props?: Record<string, unknown> } }) => {
      /** 中文说明：测试局部值 contribution，由紧邻初始化决定。 */
      const contribution = descriptor.resolve(sessionsFake.binding(SID))
      Object.assign(provided.hooks, contribution.hooks ?? {})
      Object.assign(provided.props, contribution.props ?? {})
      return () => {}
    },
    provideInfo: (id: string) => (id === SID
      ? { sessionId: SID, hooks: { session, ...provided.hooks }, props: provided.props }
      : undefined),
    currentProvideInfo: {
      getSnapshot: () => infoCell ??= { sessionId: SID, hooks: { session, ...provided.hooks }, props: provided.props },
      subscribe: () => () => {},
    },
    create: vi.fn(),
    open: vi.fn(),
  }
  ctx.provide('sessions', sessionsFake)
  /** 中文说明：测试局部值 workspaces，由紧邻初始化决定。 */
  const workspaces = {
    list: createSnapshotStore<WorkspaceListState>({
      items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
      baselinesReady: true, recentWorkspaceId: undefined,
    }),
    startSession: vi.fn(),
    sendSession: vi.fn(),
    openPath: vi.fn(async () => {}),
  }
  ctx.provide('workspaces', workspaces)
  ctx.provide('layout', layout)
  ctx.provide('connection', {
    api: { settings: {} },
    isLoopback: false,
    hostDescription: { getSnapshot: () => undefined, subscribe: () => () => {} },
  } as never)
  // ui-theme's Appearance row binds a durable scope through these two.
  ctx.provide('remote', { $on: () => () => {} } as never)
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  /** 中文说明：测试局部值 locale，由紧邻初始化决定。 */
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  slots.installLocale(locale)

  slots.install(createSlotRenderer())
  slots.register({
    name: 'root',
    children: {
      'conversation': { kind: 'single', scope: 'session-maybe' },
      'details': { kind: 'single', scope: 'session' },
    },
  }, AppRoot)

  /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
  const fiber = ctx.plugin({ inject: [...injectConversation], apply: applyConversation })
  await fiber.await()
  /** 中文说明：测试局部值 toolFiber，由紧邻初始化决定。 */
  const toolFiber = ctx.plugin({ inject: [...injectTool], apply: applyTool })
  await toolFiber.await()
  return { ctx, slots, fiber, toolFiber, session, layout, workspaces }
}

/** 中文说明：函数 mountApp 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function mountApp(slots: SlotRegistry) {
  return render(<>{slots.renderSlot('root', {})}</>)
}

describe('run_code sub-calls through the real chat machinery', () => {
  it('renders the code-variant parent row with the description summary and nested sub-rows', async () => {
    /** 中文说明：测试局部值 parent，由紧邻初始化决定。 */
    const parent = 'call-64'
    /** 中文说明：测试局部值 subCalls，由紧邻初始化决定。 */
    const subCalls = [
      subCall(11, parent, 1, 'bash', { command: 'ls notes', description: 'List notes' }, 'demo.txt'),
      subCall(12, parent, 2, 'mystery', { n: 1 }, 'ok'),
    ]
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench(snapshotWith([codeResult(10, parent)], subCalls))
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = mountApp(b.slots)

    // Parent row: the code variant with the model-authored description.
    /** 中文说明：测试局部值 codeRoot，由紧邻初始化决定。 */
    const codeRoot = view.container.querySelector('[data-variant="code"]')
    expect(codeRoot).not.toBeNull()
    expect(view.getByText('Code')).toBeTruthy()
    expect(view.getByText('List the notes directory')).toBeTruthy()

    // Nested rows are ALWAYS visible (no parent expand needed): the bash
    // sub-call landed in the bash sample plugin's keyed registration — Bash ·
    // description chrome, same as a top-level bash row — and the unregistered
    // sub-tool fell back to GenericToolCard at the same render site.
    /** 中文说明：测试局部值 nest，由紧邻初始化决定。 */
    const nest = view.container.querySelector('[data-subcalls]')
    expect(nest).not.toBeNull()
    expect(nest!.querySelector('[data-sample="bash"]')).not.toBeNull()
    expect(view.getByText('Bash')).toBeTruthy()
    expect(view.getByText('List notes')).toBeTruthy()
    expect(view.getByText('Tool call')).toBeTruthy()
  })

  it('renders Cordis sub-calls with lifecycle titles over the generic variants', async () => {
    /** 中文说明：测试局部值 parent，由紧邻初始化决定。 */
    const parent = 'call-cordis'
    /** 中文说明：测试局部值 subCalls，由紧邻初始化决定。 */
    const subCalls = [
      subCall(11, parent, 1, 'cordis_runtime_inspect', { what: 'temporary' }, '## Dynamic Packages'),
      subCall(12, parent, 2, 'cordis_run', { id: 'dyn-2' }, 'Dynamic package dyn-2 is running'),
      subCall(13, parent, 3, 'cordis_undefine', { id: 'dyn-2' }, 'Dynamic package dyn-2 was discarded.'),
    ]
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench(snapshotWith([codeResult(10, parent)], subCalls))
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = mountApp(b.slots)
    /** 中文说明：测试局部值 nest，由紧邻初始化决定。 */
    const nest = view.container.querySelector('[data-subcalls]')!

    // Each run-control verb names its act and shows the package id; without the
    // owned titles all three would read "Tool call · cordis_run · dyn-2".
    expect(nest.querySelector('[data-tool="cordis_runtime_inspect"]')?.textContent).toContain('Inspect')
    expect(nest.querySelector('[data-tool="cordis_run"]')?.textContent).toContain('Run Cordis Plugindyn-2')
    expect(nest.querySelector('[data-tool="cordis_undefine"]')?.textContent).toContain('Remove Cordis Plugindyn-2')
    // None of them is a code row: the program belongs to cordis_define, whose
    // own keyed card renders it (the next case covers the code row itself).
    expect(nest.querySelector('[data-variant="code"]')).toBeNull()
  })

  it('expanding the code row reveals the program body verbatim (shiki-tokenized)', async () => {
    /** 中文说明：测试局部值 parent，由紧邻初始化决定。 */
    const parent = 'call-64'
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench(snapshotWith([codeResult(10, parent)], []))
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = mountApp(b.slots)
    // The code row is expandable via the whole summary row (body = the program).
    /** 中文说明：测试局部值 toggle，由紧邻初始化决定。 */
    const toggle = view.container.querySelector('[data-variant="code"] [data-expandable]')
    expect(toggle).not.toBeNull()
    fireEvent.click(toggle!)
    // Shiki splits the program into token spans inside one <pre class="shiki">:
    // assert the whole text and the highlighted tree rather than one node.
    /** 中文说明：测试局部值 pre，由紧邻初始化决定。 */
    const pre = view.container.querySelector('pre.shiki')
    expect(pre).not.toBeNull()
    expect(pre!.textContent).toContain('const listing = await tools.bash')
    expect(pre!.querySelectorAll('span[style]').length).toBeGreaterThan(3)
  })

  it('an isError sub-call renders the error state dot exactly like a failed native row', async () => {
    /** 中文说明：测试局部值 parent，由紧邻初始化决定。 */
    const parent = 'call-64'
    /** 中文说明：测试局部值 subCalls，由紧邻初始化决定。 */
    const subCalls = [
      subCall(11, parent, 1, 'mystery', { n: 1 }, 'Error: boom', true),
    ]
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench(snapshotWith([codeResult(10, parent)], subCalls))
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = mountApp(b.slots)
    /** 中文说明：测试局部值 nested，由紧邻初始化决定。 */
    const nested = view.container.querySelector('[data-subcalls] [data-variant][data-state="error"]')
    expect(nested).not.toBeNull()
  })

  it('a file sub-row click opens the host path; bash sub-rows do not open details', async () => {
    /** 中文说明：测试局部值 parent，由紧邻初始化决定。 */
    const parent = 'call-64'
    /** 中文说明：测试局部值 subCalls，由紧邻初始化决定。 */
    const subCalls = [
      subCall(11, parent, 1, 'read', { path: 'notes/demo.txt' }, 'ok'),
      subCall(12, parent, 2, 'bash', { command: 'ls notes', description: 'List notes' }, 'demo.txt'),
    ]
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench(snapshotWith([codeResult(10, parent)], subCalls))
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = mountApp(b.slots)
    view.getByText('notes/demo.txt').click()
    expect(b.layout.openDetails).not.toHaveBeenCalled()
    await vi.waitFor(() => {
      expect(b.workspaces.openPath).toHaveBeenCalledWith('notes/demo.txt')
    })
    view.getByText('List notes').click()
    expect(b.layout.openDetails).not.toHaveBeenCalled()
  })

  it('a RUNNING run_code call nests its so-far dispatches under the spinner row', async () => {
    /** 中文说明：测试局部值 parent，由紧邻初始化决定。 */
    const parent = 'call-live'
    /** 中文说明：测试局部值 subCalls，由紧邻初始化决定。 */
    const subCalls = [
      subCall(21, parent, 1, 'bash', { command: 'ls notes', description: 'List notes' }, 'demo.txt'),
    ]
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench(snapshotWith([], subCalls, [runningCode(parent)]))
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = mountApp(b.slots)
    /** 中文说明：测试局部值 running，由紧邻初始化决定。 */
    const running = view.container.querySelector('[data-variant="code"][data-state="running"]')
    expect(running).not.toBeNull()
    /** 中文说明：测试局部值 nest，由紧邻初始化决定。 */
    const nest = view.container.querySelector('[data-subcalls]')
    expect(nest).not.toBeNull()
    expect(nest!.querySelector('[data-sample="bash"]')).not.toBeNull()
  })

  it('a started-but-unsettled sub-call renders the running state exactly like a native in-flight row', async () => {
    /** 中文说明：测试局部值 parent，由紧邻初始化决定。 */
    const parent = 'call-live'
    /** 中文说明：测试局部值 runningSub，由紧邻初始化决定。 */
    const runningSub: ToolCallBlock = {
      callId: `${parent}:code:1`, name: 'grep', argsRaw: '{"pattern":"todo"}',
      turn: 0, step: 0, time: 21_000, callView: null, subCalls: [],
    }
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench(snapshotWith([], [runningSub], [runningCode(parent)]))
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = mountApp(b.slots)
    // The nested row derives 'running' from the RunningToolCall shape — the
    // same data-state chrome (row sweep) a native in-flight row wears.
    /** 中文说明：测试局部值 nested，由紧邻初始化决定。 */
    const nested = view.container.querySelector('[data-subcalls] [data-variant][data-state="running"]')
    expect(nested).not.toBeNull()
  })

  it('an ordinary tool row renders no sub-call nest', async () => {
    /** 中文说明：测试局部值 parent，由紧邻初始化决定。 */
    const parent = 'call-64'
    /** 中文说明：测试局部值 plain，由紧邻初始化决定。 */
    const plain: ToolResultNode = {
      kind: 'tool-result', seq: 10, time: 10_000, callId: parent,
      call: { name: 'mystery', argsRaw: '{"n":1}' },
      callTime: 9_500,
      content: [], isError: false, callView: null, resultView: null, subCalls: [],
    }
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench(snapshotWith([plain], []))
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = mountApp(b.slots)
    expect(view.container.querySelector('[data-subcalls]')).toBeNull()
  })
})
