import { describe, expect, it } from 'vitest'
import type { PendingApproval } from '@deepseek-ai/dsh-client-ui-approval/client'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { collectToolCalls, deriveApprovalDetail } from '../src/client/approval-detail.ts'

const pending = (fields: { toolName: string; callId?: string; reason?: string }): PendingApproval =>
  fields as unknown as PendingApproval

/** 造一个 tool-call 节点：负载形态是 { root }。 */
const toolNode = (root: unknown): ChatConversationViewNode =>
  ({ kind: 'tool-call', data: { root } }) as unknown as ChatConversationViewNode

describe('审批详情派生', () => {
  it('解析到调用时给出工具名与原始参数，且不进入兜底', () => {
    const view = deriveApprovalDetail(
      pending({ toolName: 'bash', callId: 'call-1', reason: '需要写文件' }),
      { callId: 'call-1', name: 'bash', argsRaw: '{"command":"rm -rf build"}' },
    )
    expect(view).toEqual({
      toolName: 'bash',
      callId: 'call-1',
      reason: '需要写文件',
      argsRaw: '{"command":"rm -rf build"}',
      fallback: false,
    })
  })

  it('解析不到时进入安全兜底：保留工具名与原因，不编造参数', () => {
    const view = deriveApprovalDetail(pending({ toolName: 'bash' }), undefined)
    expect(view.fallback).toBe(true)
    expect(view.argsRaw).toBeUndefined()
    expect(view.callId).toBeUndefined()
    expect(view.toolName).toBe('bash')
  })

  it('解析到调用但没有参数时同样按兜底处理', () => {
    const view = deriveApprovalDetail(pending({ toolName: 'bash', callId: 'c' }), {
      callId: 'c', name: 'bash', argsRaw: '',
    })
    expect(view.fallback).toBe(true)
  })
})

describe('callId 索引', () => {
  it('未落定的调用（RunningToolCall 自带 name/argsRaw）能建索引', () => {
    const index = collectToolCalls([toolNode({ callId: 'c1', name: 'bash', argsRaw: '{"a":1}' })])
    expect(index.get('c1')).toEqual({ callId: 'c1', name: 'bash', argsRaw: '{"a":1}' })
  })

  it('已落定的调用（调用头回填在 call 里）能建索引', () => {
    const index = collectToolCalls([toolNode({ callId: 'c2', call: { name: 'pwsh', argsRaw: '{"b":2}' } })])
    expect(index.get('c2')?.name).toBe('pwsh')
  })

  it('窗口截断导致 call 为 null 时不建索引，不抛错', () => {
    const index = collectToolCalls([toolNode({ callId: 'c3', call: null })])
    expect(index.size).toBe(0)
  })

  it('代码派发的子调用递归进索引', () => {
    const index = collectToolCalls([toolNode({
      callId: 'root',
      name: 'dispatch',
      argsRaw: '{}',
      subCalls: [{ callId: 'child', name: 'bash', argsRaw: '{"c":3}' }],
    })])
    expect([...index.keys()].sort()).toEqual(['child', 'root'])
  })

  it('忽略非 tool-call 节点与缺少 root 的负载', () => {
    const nodes = [
      { kind: 'user', data: {} },
      { kind: 'tool-call', data: {} },
    ] as unknown as ChatConversationViewNode[]
    expect(collectToolCalls(nodes).size).toBe(0)
  })

  it('同一 callId 以首次出现为准', () => {
    const index = collectToolCalls([
      toolNode({ callId: 'c', name: 'first', argsRaw: '1' }),
      toolNode({ callId: 'c', name: 'second', argsRaw: '2' }),
    ])
    expect(index.get('c')?.name).toBe('first')
  })
})

/** 增量调用尚无参数字符串时，索引保留身份并使用空参数。 */
it('未完成调用缺少参数时仍可按身份查询', () => {
  expect(collectToolCalls([toolNode({ callId: 'partial', name: 'pwsh' })]).get('partial'))
    .toEqual({ callId: 'partial', name: 'pwsh', argsRaw: '' })
})
