// @vitest-environment jsdom
/** tool-call 行：递归树、逐调用分派、孤儿结果与层级上限。 */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ChatConversationViewNode, ToolCallBlock } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { QsToolCallRowProps } from '../src/client/tool-tree.tsx'
import { ShellToolview } from '../src/client/toolviews/bash.tsx'
import type { QsToolviewProps } from '../src/client/contract.ts'
import { ToolCallRow } from '../src/client/tool-tree.tsx'
import { TOOL_TREE_MAX_DEPTH } from '../src/client/tool-view-model.ts'
import { zh } from '../src/client/locales.ts'
import { resultNode, runningCall } from './tool-fixtures.client.ts'

afterEach(cleanup)

/** 行座席：只提供被测行实际读取的输入。 */
function rowProps(root: ToolCallBlock, options: {
  readonly kind?: string
  readonly visibility?: 'visible' | 'hidden'
  readonly cwd?: string
  readonly loadImage?: QsToolCallRowProps['loadImage']
  readonly dispatch?: QsToolCallRowProps['renderSlot']
} = {}): QsToolCallRowProps {
  const node = {
    kind: options.kind ?? 'tool-call',
    data: { root },
    visibility: options.visibility ?? 'visible',
  } as ChatConversationViewNode
  return {
    nodeKey: 'row',
    useNode: (_key: string, select: (value: ChatConversationViewNode | undefined) => unknown) => select(node),
    useProcess: (_key: string, select: (value: undefined) => unknown) => select(undefined),
    sessionId: 's1',
    useSessions: (select: (list: { byId: Record<string, { cwd: string }> }) => unknown) =>
      select({ byId: options.cwd === undefined ? {} : { s1: { cwd: options.cwd } } }),
    loadImage: options.loadImage,
    fold: { isOpen: () => false, set: () => {}, subscribe: () => () => {} },
    renderSlot: options.dispatch ?? ((_name, owner, _opts) => {
      if (_name === 'qs.tool.call.actions') return null
      const record = owner as unknown as { toolName: string; block: ToolCallBlock }
      return <span data-testid="dispatch">{`${record.toolName}:${'kind' in record.block ? 'settled' : 'running'}`}</span>
    }),
    t: (key: keyof typeof zh, params?: Record<string, unknown>) =>
      `${zh[key]}${params === undefined ? '' : `|${Object.values(params).join(',')}`}`,
  } as unknown as QsToolCallRowProps
}

it('节点被隐藏或不是工具调用时不渲染', () => {
  for (const options of [{ visibility: 'hidden' as const }, { kind: 'user' }]) {
    const view = render(<ToolCallRow {...rowProps(runningCall(), options)} />)
    expect(view.container.textContent).toBe('')
    view.unmount()
  }
})

it('根调用按工具名分派，摘要与耗时来自持久字段', () => {
  const dispatch = vi.fn((_name, owner, _opts) => {
    if (_name === 'qs.tool.call.actions') return null
    const record = owner as unknown as { toolName: string; cwd: string | undefined }
    return <span data-testid="dispatch">{`${record.toolName}@${record.cwd ?? '-'}`}</span>
  })
  const view = render(<ToolCallRow {...rowProps(resultNode({ callTime: 1_000, time: 7_000 }), {
    cwd: '/root',
    dispatch: dispatch as unknown as QsToolCallRowProps['renderSlot'],
  })} />)
  expect(view.container.textContent).toContain('bash')
  expect(view.container.textContent).toContain(zh['state.ok'])
  expect(view.container.textContent).not.toContain('ls')
  expect(view.container.textContent).toContain(`${zh['row.duration']}|6`)
  expect(view.queryByTestId('dispatch')).toBeNull()
  fireEvent.click(view.container.querySelector('[data-disclosure-row]')!)
  expect(view.getByTestId('dispatch').textContent).toBe('bash@/root')
  expect(dispatch.mock.calls[0]?.[0]).toBe('qs.tool.call.toolview')
  expect((dispatch.mock.calls[0]?.[2] as unknown as { entryKey: string }).entryKey).toBe('bash')
})

it('孤儿结果显示调用标识与限制说明，不显示摘要与耗时', () => {
  const view = render(<ToolCallRow {...rowProps(resultNode({ call: null, callTime: null }))} />)
  expect(view.container.textContent).toContain(zh['row.unknownTool'])
  expect(view.container.textContent).toContain(zh['row.orphan'])
  expect(view.container.textContent).not.toContain(zh['row.duration'])
})

it('子调用递归渲染并保持身份，层级上限之内逐层展开', () => {
  const child = resultNode({ callId: 'child', call: { name: 'read', argsRaw: '{"file_path":"a.ts"}' } })
  const root = resultNode({ subCalls: [child] })
  const view = render(<ToolCallRow {...rowProps(root)} />)
  fireEvent.click(view.container.querySelector('[data-disclosure-row]')!)
  expect(view.container.querySelector('[data-qs-tool-subcalls]')).not.toBeNull()
  const rows = view.container.querySelectorAll('[data-qs-tool]')
  expect(rows).toHaveLength(2)
  expect(rows[1]?.className).toContain('nested')
  fireEvent.click(rows[1]!.querySelector('[data-disclosure-row]')!)
  expect(view.getAllByTestId('dispatch')[1]?.textContent).toBe('read:settled')
})

it('超过层级上限时折叠更深的内容并给出说明', () => {
  let block: ToolCallBlock = resultNode({ callId: 'leaf' })
  for (let depth = 0; depth <= TOOL_TREE_MAX_DEPTH; depth++) {
    block = resultNode({ callId: `call-${depth}`, subCalls: [block] })
  }
  const view = render(<ToolCallRow {...rowProps(block)} />)
  // 展开沿途每一层，直到出现深度限制说明。
  for (let depth = 0; depth <= TOOL_TREE_MAX_DEPTH; depth++) {
    for (const row of view.container.querySelectorAll('[data-disclosure-row][aria-expanded="false"]')) {
      fireEvent.click(row)
    }
  }
  expect(view.container.textContent).toContain(zh['row.depthLimit'])
})

it('运行中的调用不显示耗时，状态为运行中', () => {
  const view = render(<ToolCallRow {...rowProps(runningCall())} />)
  expect(view.container.textContent).toContain(zh['state.running'])
  expect(view.container.textContent).not.toContain(zh['row.duration'])
  fireEvent.click(view.container.querySelector('[data-disclosure-row]')!)
  expect(view.getByTestId('dispatch').textContent).toBe('bash:running')
})

it('命令凭据仅在用户显式展开后进入 DOM，原始命令不被改写', () => {
  const command = "curl -H 'Authorization: Bearer synthetic-secret' https://example.invalid"
  const block = runningCall({ argsRaw: JSON.stringify({ command }) })
  // 此测试只分派已知的工具子槽；泛型 renderSlot 的联合 owner 在测试适配处收窄。
  const props = rowProps(block, { dispatch: (_name, owner) => _name === 'qs.tool.call.actions' ? null : (
    <ShellToolview {...owner as unknown as QsToolviewProps} t={props.t} />
  ) })
  const view = render(<ToolCallRow {...props} />)
  expect(view.container.innerHTML).not.toContain('synthetic-secret')
  fireEvent.click(view.container.querySelector('[data-disclosure-row]')!)
  expect(view.container.textContent).toContain(command)
  expect(block.argsRaw).toBe(JSON.stringify({ command }))
  fireEvent.click(view.container.querySelector('[data-disclosure-row]')!)
  expect(view.container.innerHTML).not.toContain('synthetic-secret')
})
