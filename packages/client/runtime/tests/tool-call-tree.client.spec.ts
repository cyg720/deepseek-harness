/**
 * 文件职责：验证客户端会话运行时的 tool-call-tree 行为与边界。
 * 技术维度：Vitest、TypeScript、可控测试替身和真实模块组装。
 * 产品维度：防止用户可见行为在重构或扩展后发生回归。
 * 逻辑维度：构造场景输入，调用被测入口，记录状态并断言结果。
 * 关键边界：测试替身需在用例后清理；异步任务不能泄漏到后续场景。
 * 新手阅读建议：先读辅助函数和固定数据，再按 describe 场景顺序阅读。
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it } from 'vitest'
import type { RunningToolCall, ToolCallBlock } from '../src/client/sessions/conversation.ts'
import {
  MAX_TOOL_CALL_TREE_DEPTH, ToolCallTree,
} from '../src/client/sessions/tool-call-tree.ts'

/** 中文说明：测试场景的局部值 at，取值由紧邻初始化决定，仅在当前作用域使用。 */
const at = (seq: number, type: string, data: Record<string, unknown>): SessionEvent =>
  ({ seq, time: 1_700_000_000_000 + seq, type, data }) as unknown as SessionEvent

/** 中文说明：测试场景的局部值 start，取值由紧邻初始化决定，仅在当前作用域使用。 */
const start = (seq: number, parentCallId: string, subCallId: string): SessionEvent =>
  at(seq, 'tool/code-dispatch-start', {
    parentCallId, subCallId, name: 'run_code', arguments: {},
  })

/** 中文说明：测试场景的局部值 settle，取值由紧邻初始化决定，仅在当前作用域使用。 */
const settle = (seq: number, parentCallId: string, subCallId: string): SessionEvent =>
  at(seq, 'tool/code-dispatch', {
    parentCallId, subCallId, name: 'run_code', arguments: {},
    isError: false, content: [],
  })

/** 中文说明：测试场景的局部值 root，取值由紧邻初始化决定，仅在当前作用域使用。 */
const root = (callId: string): RunningToolCall => ({
  callId, name: 'run_code', argsRaw: '{}', turn: 1, step: 1,
  time: 1_700_000_000_000, callView: null, subCalls: [],
})

describe('ToolCallTree', () => {
  it('rejects a self-parenting dispatch edge', () => {
    /** 中文说明：测试场景的局部值 tree，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const tree = new ToolCallTree()
    /** 中文说明：测试场景的局部值 roots，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const roots = [root('root')]

    expect(tree.apply(start(0, 'root', 'root'))).toBe(true)
    expect(tree.projectRunningCalls(roots)).toBe(roots)
  })

  it('rejects a settling edge that would close a multi-call cycle', () => {
    /** 中文说明：测试场景的局部值 tree，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const tree = new ToolCallTree()
    tree.apply(start(0, 'a', 'b'))
    tree.apply(start(1, 'b', 'c'))

    expect(tree.apply(settle(2, 'c', 'a'))).toBe(true)
    expect(tree.projectRunningCalls([root('a')])).toMatchObject([{
      callId: 'a',
      subCalls: [{
        callId: 'b',
        subCalls: [{ callId: 'c', subCalls: [] }],
      }],
    }])
  })

  it('accepts an acyclic graph with a shared descendant', () => {
    /** 中文说明：测试场景的局部值 tree，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const tree = new ToolCallTree()
    tree.apply(start(0, 'a', 'b'))
    tree.apply(start(1, 'a', 'c'))
    tree.apply(start(2, 'b', 'd'))
    tree.apply(start(3, 'c', 'd'))

    expect(tree.apply(start(4, 'root', 'a'))).toBe(true)
    expect(tree.projectRunningCalls([root('root')])).toMatchObject([{
      callId: 'root',
      subCalls: [{
        callId: 'a',
        subCalls: [{ callId: 'b' }, { callId: 'c' }],
      }],
    }])
  })

  it('rejects an edge beyond the recursive depth safety limit', () => {
    /** 中文说明：测试场景的局部值 tree，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const tree = new ToolCallTree()
    /** 中文说明：测试场景的局部值 depth，取值由紧邻初始化决定，仅在当前作用域使用。 */
    for (let depth = 1; depth < MAX_TOOL_CALL_TREE_DEPTH; depth++) {
      tree.apply(start(depth, `call-${depth - 1}`, `call-${depth}`))
    }

    expect(tree.apply(start(
      MAX_TOOL_CALL_TREE_DEPTH,
      `call-${MAX_TOOL_CALL_TREE_DEPTH - 1}`,
      `call-${MAX_TOOL_CALL_TREE_DEPTH}`,
    ))).toBe(true)

    /** 中文说明：测试场景的局部值 current，取值由紧邻初始化决定，仅在当前作用域使用。 */
    let current: ToolCallBlock = tree.projectRunningCalls([root('call-0')])[0]!
    /** 中文说明：测试场景的局部值 depth，取值由紧邻初始化决定，仅在当前作用域使用。 */
    let depth = 1
    while (current.subCalls.length > 0) {
      current = current.subCalls[0]!
      depth++
    }
    expect(depth).toBe(MAX_TOOL_CALL_TREE_DEPTH)
    expect(current.callId).toBe(`call-${MAX_TOOL_CALL_TREE_DEPTH - 1}`)
  })
})
