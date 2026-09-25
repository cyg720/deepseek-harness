/** 工具行测试用的持久块构造器：只造官方字段，不注入任何呈现逻辑。 */
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { RunningToolCall, ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'

/**
 * 结果内容块样本。
 *
 * 视图必须对结构不符的内容块回落，因此测试要能构造「类型名不认识」或「字段残缺」的块；
 * 这里只把样本交给类型，不改变运行期数据。
 * @param items - 任意结构的内容块样本。
 * @returns 内容块数组。
 */
export function blocks(...items: unknown[]): ContentBlock[] {
  return items as ContentBlock[]
}

/**
 * 构造运行中的调用头。
 * @param overrides - 需要覆盖的字段。
 * @returns 运行头。
 */
export function runningCall(overrides: Partial<RunningToolCall> = {}): RunningToolCall {
  return {
    callId: 'call-1',
    name: 'bash',
    argsRaw: '{"command":"ls"}',
    turn: 1,
    step: 1,
    time: 1_000,
    subCalls: [],
    ...overrides,
  }
}

/**
 * 构造结算结果节点。
 * @param overrides - 需要覆盖的字段。
 * @returns 结算结果。
 */
export function resultNode(overrides: Partial<ToolResultNode> = {}): ToolResultNode {
  return {
    kind: 'tool-result',
    seq: 3,
    time: 2_000,
    callId: 'call-1',
    call: { name: 'bash', argsRaw: '{"command":"ls"}' },
    callTime: 1_000,
    content: [{ type: 'text', text: 'ok' }],
    isError: false,
    subCalls: [],
    ...overrides,
  }
}
