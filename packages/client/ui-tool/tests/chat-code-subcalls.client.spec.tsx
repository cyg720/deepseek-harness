// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {
  ChatSnapshot, RunningToolCall, ToolCallBlock, ToolResultNode,
} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { SlotTestRuntime, TestRemote, stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import {
  ConversationEventRegistry, ConversationViewRegistry, type ConvViewOwnerProps,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { en as conversationEn, NS as CONVERSATION_NS, zh as conversationZh } from '@deepseek-ai/dsh-client-ui-conversation/src/client/locales.ts'
import { apply as applyChat, inject as injectChat } from '@deepseek-ai/dsh-client-ui-chat/client'
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

const runtimes: SlotTestRuntime[] = []

afterEach(async () => {
  cleanup()
  vi.unstubAllGlobals()
  for (const runtime of runtimes.splice(0)) await runtime.dispose()
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
  content: [{ type: 'text', text: 'demo.txt' }], isError: false,
  subCalls: [],
})

/** 中文说明：测试局部值 runningCode，由紧邻初始化决定。 */
const runningCode = (callId: string): RunningToolCall => ({
  callId, name: 'run_code', argsRaw: RUN_CODE_ARGS, turn: 9, step: 0, time: 9_000,
  subCalls: [],
})

/** 中文说明：测试局部值 subCall，由紧邻初始化决定。 */
const subCall = (
  seq: number, parent: string, n: number, name: string, args: object, resultText: string, isError = false,
): ToolCallBlock => ({
  kind: 'tool-result', seq, time: seq * 1_000,
  callId: `${parent}:code:${n}`,
  parentCallId: parent,
  call: { name, argsRaw: JSON.stringify(args) },
  callTime: seq * 1_000,
  content: [{ type: 'text', text: resultText }], isError,
  subCalls: [],
})

/** 中文说明：函数 snapshotWith 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function snapshotWith(
  nodes: ToolResultNode[],
  subCalls: readonly ToolCallBlock[],
  runningCalls: RunningToolCall[] = [],
): ChatSnapshot {
  const nestedNodes = nodes.map(node => ({ ...node, subCalls }))
  /** 中文说明：测试局部值 nestedRunningCalls，由紧邻初始化决定。 */
  const nestedRunningCalls = runningCalls.map(call => ({ ...call, subCalls }))
  return toolChatSnapshot(nestedNodes, nestedRunningCalls)
}

/** Test-owned AppFrame role: declares and renders the Chat view list. */
type AppRootProps = PropsRenderSlots<'conversation.view'>
const VIEW_OWNER: ConvViewOwnerProps = {
  viewRequest: null,
  openView: () => {},
  completeViewRequest: () => {},
}
function AppRoot({ renderSlot }: AppRootProps) {
  return <>{renderSlot('conversation.view', VIEW_OWNER, { only: 'chat' })}</>
}

const ROOT_CHILDREN = {
  'conversation.view': { kind: 'list', scope: 'session' },
} as const

/**
 * Same real-stack bench as the toolview-slot spec: renderer, Chat target, and
 * Tool registrations; fakes only at service boundaries.
 */
async function bench(snapshot: ChatSnapshot) {
  const runtime = await SlotTestRuntime.create()
  runtimes.push(runtime)
  const ctx = runtime.ctx
  const chat = createSnapshotStore(snapshot)
  const events = new ConversationEventRegistry(ctx)
  const views = new ConversationViewRegistry(ctx)
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  ctx.provide('uiConversation', {
    events,
    views,
    binding: () => ({ target: () => chat }),
  } as never)

  await runtime.sessions.add({
    id: SID,
    summary: { title: 'S', displayTitle: 'S' },
    snapshot: { running: snapshot.legacy.runningCalls.length > 0 },
  })
  const layout = { openDetails: vi.fn(), closeDetails: vi.fn() }
  const openWorkspacePath = vi.fn(async () => ({ ok: true, value: { opened: true } }))
  ctx.provide('layout', layout as never)
  ctx.provide('uiWorkspace', {} as never)
  new TestRemote(ctx, { session: { openWorkspacePath } })
  ctx.provide('connection', {
    isLoopback: false,
    generation: { getSnapshot: () => undefined, subscribe: () => () => {} },
  } as never)
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  locale.register(CONVERSATION_NS, { zh: conversationZh, en: conversationEn })
  runtime.slots.installLocale(locale)

  await runtime.root.declare(ROOT_CHILDREN, AppRoot)
  await runtime.mount({ inject: [...injectChat], apply: applyChat })
  await runtime.mount({ inject: [...injectTool], apply: applyTool })
  return { runtime, layout, openWorkspacePath }
}

function mountApp(runtime: SlotTestRuntime) {
  return runtime.renderRoot()
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
    const view = mountApp(b.runtime)

    // Parent row: the code variant with the model-authored description.
    /** 中文说明：测试局部值 codeRoot，由紧邻初始化决定。 */
    const codeRoot = view.container.querySelector('[data-variant="code"]')
    expect(codeRoot).not.toBeNull()
    expect(view.getByText('Code')).toBeTruthy()
    expect(view.getByText('List the notes directory')).toBeTruthy()

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
    const view = mountApp(b.runtime)
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
    const view = mountApp(b.runtime)
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
    const view = mountApp(b.runtime)
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
    const view = mountApp(b.runtime)
    view.getByText('notes/demo.txt').click()
    expect(b.layout.openDetails).not.toHaveBeenCalled()
    await vi.waitFor(() => {
      expect(b.openWorkspacePath).toHaveBeenCalledWith({ path: 'notes/demo.txt' })
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
    const view = mountApp(b.runtime)
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
      parentCallId: parent,
      turn: 0, step: 0, time: 21_000, subCalls: [],
    }
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench(snapshotWith([], [runningSub], [runningCode(parent)]))
    const view = mountApp(b.runtime)
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
      content: [], isError: false, subCalls: [],
    }
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench(snapshotWith([plain], []))
    const view = mountApp(b.runtime)
    expect(view.container.querySelector('[data-subcalls]')).toBeNull()
  })
})
