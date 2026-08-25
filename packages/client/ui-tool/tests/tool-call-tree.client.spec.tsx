// @vitest-environment jsdom
/*
 * 文件职责：验证工具调用的 tool-call-tree.client.spec.tsx 行为。
 * 技术维度：Vitest、React 渲染、插槽替身和类型化工具数据。
 * 产品维度：防止工具调用展示与展开交互回归。
 * 逻辑维度：构造工具调用或轨迹数据，渲染后断言 DOM 与状态。
 * 关键边界：测试只验证展示，不执行真实工具；DOM 和替身必须清理。
 * 新手阅读建议：先读数据夹具，再按工具类型和状态阅读。
 */
/** ToolCallTree-owned root/subcall markers and selection projection. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { HostDescription } from '@deepseek-ai/dsh-client-connection/client'
import type { ConversationSnapshot, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { ToolTreeProps } from '../src/client/contract/slots.ts'
import { ToolCallTree } from '../src/client/tool/ToolCallTree.tsx'
import { zh } from '@deepseek-ai/dsh-client-ui-conversation/src/client/locales.ts'

afterEach(cleanup)

/** 中文说明：测试局部值 t，由紧邻初始化决定。 */
const t: ToolTreeProps['t'] = makeTranslate(zh, commonZh)

/** 中文说明：测试局部值 root，由紧邻初始化决定。 */
const root = (callId: string, call: ToolResultNode['call']): ToolResultNode => ({
  kind: 'tool-result', seq: 3, time: 3_000, callId, call, callTime: 2_000,
  content: [], isError: false, callView: null, resultView: null, subCalls: [],
})

/** 中文说明：函数 props 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function props(
  block: ToolResultNode,
  selectedCallId?: string,
  description?: HostDescription,
): ToolTreeProps {
  /** 中文说明：测试局部值 snapshot，由紧邻初始化决定。 */
  const snapshot = {} as ConversationSnapshot
  /** 中文说明：测试局部值 useSession，由紧邻初始化决定。 */
  const useSession = ((selector: (value: ConversationSnapshot) => unknown) => selector(snapshot)) as ToolTreeProps['useSession']
  /** 中文说明：测试局部值 renderSlot，由紧邻初始化决定。 */
  const renderSlot = ((_key: string, _owner: object, options?: { fallback?: React.ReactNode }) =>
    options?.fallback ?? null) as unknown as ToolTreeProps['renderSlot']
  return {
    useSession,
    renderSlot,
    node: {
      key: `tool:${block.callId}`,
      kind: 'tool-call',
      id: block.callId,
      target: 'chat',
      anchorSeq: block.seq,
      location: { kind: 'session' },
      visibility: 'visible',
      data: { root: block },
    },
    selectedCallId,
    openFile: vi.fn(),
    inspectCall: vi.fn(),
    forkAt: vi.fn(),
    fileMentions: vi.fn(),
    useHostDescription: (selector => selector(description)) as ToolTreeProps['useHostDescription'],
    t,
  } as unknown as ToolTreeProps
}

describe('ToolCallTree', () => {
  it('owns the root marker, generic fallback, and selected state for a window-truncated call', () => {
    /** 中文说明：测试局部值 block，由紧邻初始化决定。 */
    const block = root('w1', null)
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<ToolCallTree {...props(block, 'w1')} />)
    /** 中文说明：测试局部值 row，由紧邻初始化决定。 */
    const row = view.container.querySelector('[data-chat-call-id="w1"]')
    expect(row?.getAttribute('data-chat-anchor-key')).toBe('call:w1')
    expect(row?.getAttribute('data-selected')).toBe('true')
    expect(view.container.querySelector('[data-variant="others"]')).not.toBeNull()
    expect(view.getByText('w1')).toBeTruthy()
  })

  it('recursively renders a selected leaf without selecting its ancestors', () => {
    /** 中文说明：测试局部值 leaf，由紧邻初始化决定。 */
    const leaf = root('parent:code:1:code:1', { name: 'read', argsRaw: '{"path":"a.ts"}' })
    /** 中文说明：测试局部值 child，由紧邻初始化决定。 */
    const child = {
      ...root('parent:code:1', { name: 'run_code', argsRaw: '{"code":"return 1"}' }),
      subCalls: [leaf],
    }
    /** 中文说明：测试局部值 block，由紧邻初始化决定。 */
    const block = {
      ...root('parent', { name: 'run_code', argsRaw: '{"code":"return 1"}' }),
      subCalls: [child],
    }
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<ToolCallTree {...props(block, leaf.callId)} />)
    /** 中文说明：测试局部值 nests，由紧邻初始化决定。 */
    const nests = view.container.querySelectorAll('[data-subcalls]')
    expect(nests[0]?.parentElement).toBe(view.container.querySelector('[data-chat-call-id="parent"]'))
    expect(nests[1]?.parentElement).toBe(view.container.querySelector('[data-chat-call-id="parent:code:1"]'))
    expect(view.container.querySelector('[data-chat-call-id="parent"]')?.hasAttribute('data-selected')).toBe(false)
    expect(view.container.querySelector('[data-chat-call-id="parent:code:1"]')?.hasAttribute('data-selected')).toBe(false)
    expect(view.container.querySelector('[data-chat-call-id="parent:code:1:code:1"]')?.getAttribute('data-selected')).toBe('true')
    expect(nests).toHaveLength(2)
  })

  it('abbreviates a POSIX home path in the generic tool summary', () => {
    /** 中文说明：测试局部值 block，由紧邻初始化决定。 */
    const block = root('w1', { name: 'read', argsRaw: '{"path":"/h/docs/a.ts"}' })
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<ToolCallTree {...props(block, 'w1', {
      version: '0', cwd: '/tmp', attachedSessions: 0, home: '/h', canOpenPath: false,
    })} />)
    expect(view.getByText('~/docs/a.ts')).toBeTruthy()
  })
})
