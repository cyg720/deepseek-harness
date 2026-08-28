// @vitest-environment jsdom
/*
 * 文件职责：验证工具调用的 assembly-surfaces.client.spec.tsx 行为。
 * 技术维度：Vitest、React 渲染、插槽替身和类型化工具数据。
 * 产品维度：防止工具调用展示与展开交互回归。
 * 逻辑维度：构造工具调用或轨迹数据，渲染后断言 DOM 与状态。
 * 关键边界：测试只验证展示，不执行真实工具；DOM 和替身必须清理。
 * 新手阅读建议：先读数据夹具，再按工具类型和状态阅读。
 */
/** Tool assembly acceptance through the real ui-conversation host. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, waitFor } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { ISession } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TodoItem } from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  apply as applyChat, inject as injectChat, type ToolResultNode,
} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotTestRuntime, TestRemote, usePinnedBrowserLanguages, stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as applyConversation, inject as injectConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { apply as applyTool, inject as injectTool } from '../src/client/apply.ts'
import { toolSessionEvents } from './tool-details-render.client.tsx'

// The service reads its initial locale from the browser; these specs assert
// the shipped Chinese copy, so they state the browser they assume.
usePinnedBrowserLanguages('zh-CN')

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
/** 中文说明：测试局部值 TODOS，由紧邻初始化决定。 */
const TODOS: TodoItem[] = [
  { content: '梳理需求', status: 'completed' },
  { content: '实现 fixture 样本', status: 'in_progress' },
  { content: '浏览器验收', status: 'pending' },
]

/** 中文说明：测试局部值 todoResult，由紧邻初始化决定。 */
const todoResult = (seq: number): ToolResultNode => ({
  kind: 'tool-result', seq, time: seq * 1_000, callId: `todo-${seq}`,
  call: { name: 'todo_write', argsRaw: JSON.stringify({ todos: TODOS }) },
  callTime: seq * 1_000 - 500,
  content: [], isError: false, subCalls: [],
})

/** 中文说明：测试局部值 bashResult，由紧邻初始化决定。 */
const bashResult = (seq: number, callId: string, over?: Partial<ToolResultNode>): ToolResultNode => ({
  kind: 'tool-result', seq, time: seq * 1_000, callId,
  call: { name: 'bash', argsRaw: '{"command":"ls -la","description":"List files"}' },
  callTime: seq * 1_000 - 500,
  content: [{ type: 'text', text: 'total 2\ndemo.txt\n' }], isError: false,
  subCalls: [],
  ...over,
})

/** Test-owned AppFrame role: declares and renders the resident conversation area. */
/* 中文说明：类型或类 AppRootProps 约束工具或轨迹数据职责。 */
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

/** 中文说明：函数 bench 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
async function bench(nodes: ToolResultNode[]) {
  /** 中文说明：测试局部值 runtime，由紧邻初始化决定。 */
  const runtime = await SlotTestRuntime.create()
  runtime.ctx.provide('connection', {
    isLoopback: false,
    generation: { getSnapshot: () => undefined, subscribe: () => () => {} },
  })
  new TestRemote(runtime.ctx, {
    session: {
      openWorkspacePath: vi.fn(async () => ({ ok: true, value: { opened: true } })),
    },
  })
  runtime.ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  runtime.ctx.provide('layout', { openDetails: vi.fn(), closeDetails: vi.fn() })
  runtime.ctx.provide('uiWorkspace', {
    connectWorkspace: vi.fn(async () => SID),
  } as never)
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  await runtime.sessions.add({
    id: SID,
    summary: { title: 'S', displayTitle: 'S', cwd: '/proj' },
    events: toolSessionEvents(nodes),
    session: {
      loadOlder: vi.fn<ISession['loadOlder']>(),
      prompt: vi.fn<ISession['prompt']>(async () => ({ ok: true, value: { accepted: true } })),
    },
  })
  await runtime.root.declare(LAYOUT_CHILDREN, AppRoot)
  await runtime.mount({ inject: [...injectConversation], apply: applyConversation })
  await runtime.mount({ inject: [...injectChat], apply: applyChat })
  await runtime.mount({ inject: [...injectTool], apply: applyTool })
  return runtime
}

describe('todo_write assembly (product registrations, no outlet twins)', () => {
  it('reaches the keyed toolview row and the dock plan strip, and the strip follows projection retirement', async () => {
    /** 中文说明：测试局部值 runtime，由紧邻初始化决定。 */
    const runtime = await bench([todoResult(3)])
    // The dock strip reads the host-computed 'todos' projection.
    runtime.sessions.behavior(SID).projections.set('todos', TODOS)
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = runtime.renderRoot()

    // Keyed toolview registration took the row (summary derived from args).
    /** 中文说明：测试局部值 row，由紧邻初始化决定。 */
    const row = view.container.querySelector('[data-tool="todo_write"]')
    expect(row).not.toBeNull()
    expect(row!.textContent).toContain('1/3 已完成 · 实现 fixture 样本')

    // The plan strip sits in the input dock, fed by the projection
    // (default-collapsed: the header summary shows; rows appear on expand).
    /** 中文说明：测试局部值 panel，由紧邻初始化决定。 */
    const panel = view.container.querySelector('[data-testid="todo-panel"]')
    expect(panel).not.toBeNull()
    expect(panel!.textContent).toContain('1 已完成\u2002·\u20021 进行中\u2002·\u20021 待处理')
    fireEvent.click(panel!.querySelector('button')!)
    expect([...panel!.querySelectorAll('li')].map(li => li.getAttribute('data-status')))
      .toEqual(['completed', 'in_progress', 'pending'])

    // Next turn retires the standing plan (host pushes null): the strip
    // clears while the historical row stays in the flow.
    await runtime.flush()
    runtime.sessions.behavior(SID).projections.set('todos', null)
    await waitFor(() => {
      expect(view.container.querySelector('[data-testid="todo-panel"]')).toBeNull()
    })
    expect(view.container.querySelector('[data-tool="todo_write"]')).not.toBeNull()
    await runtime.dispose()
  })
})

describe('terminal card assembly', () => {
  it('both the keyed bash row and the fallback row reach the terminal card through the whole-row expand', async () => {
    /** 中文说明：测试局部值 runtime，由紧邻初始化决定。 */
    const runtime = await bench([
      bashResult(3, 'c-keyed'),
      // pwsh has no package-local keyed row, so GenericToolCard owns its raw terminal card.
      bashResult(4, 'c-fallback', {
        call: { name: 'pwsh', argsRaw: '{"command":"ls -la","description":"List files"}' },
      }),
    ])
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = runtime.renderRoot()

    // Keyed BashRow: collapsed by default, the whole summary row is the toggle.
    /** 中文说明：测试局部值 keyedRow，由紧邻初始化决定。 */
    const keyedRow = view.container.querySelector('[data-sample="bash"]')
    /** 中文说明：测试局部值 keyed，由紧邻初始化决定。 */
    const keyed = keyedRow?.parentElement
    expect(keyed?.querySelector('[data-terminal]')).toBeNull()
    fireEvent.click(keyedRow!)
    await waitFor(() => {
      expect(keyed!.querySelector('[data-terminal]')).not.toBeNull()
    })

    // Fallback row: same unified expand interaction.
    const fallback = view.container.querySelector('[data-tool="pwsh"]')
    expect(fallback).not.toBeNull()
    expect(fallback!.querySelector('[data-terminal]')).toBeNull()
    fireEvent.click(fallback!.querySelector('[data-expandable]')!)
    await waitFor(() => {
      expect(fallback!.querySelector('[data-terminal]')).not.toBeNull()
    })
    await runtime.dispose()
  })
})
