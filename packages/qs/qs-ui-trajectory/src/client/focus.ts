/** 官方轨迹焦点采用工具调用 ID；返回的路径只包含真实已加载调用。 */
import type { ConversationNode, RunningToolCall, ToolCallBlock } from '@deepseek-ai/dsh-client-ui-conversation/client'
function path(calls: readonly ToolCallBlock[], id: string): readonly string[] | undefined {
  for (const call of calls) {
    if (call.callId === id) return [id]
    const child = path(call.subCalls, id)
    if (child !== undefined) return [call.callId, ...child]
  }
  return undefined
}
/**
 * 先定位持久化工具，再定位运行调用；仅有助手调用块时定位其所在记录。
 * @param nodes - 当前已加载历史。
 * @param calls - 当前根运行调用。
 * @param id - 官方跨视图工具 ID。
 * @returns 历史座位和祖先路径；缺窗时返回 undefined。
 */
export function findFocus(
  nodes: readonly ConversationNode[], calls: readonly RunningToolCall[], id: string,
): { seq: number | undefined; calls: ReadonlySet<string> } | undefined {
  for (const node of nodes) {
    if (node.kind !== 'tool-result') continue
    const found = path([node], id)
    if (found !== undefined) return { seq: node.seq, calls: new Set(found) }
  }
  const running = path(calls, id)
  if (running !== undefined) return { seq: undefined, calls: new Set(running) }
  const assistant = nodes.find(node => node.kind === 'assistant' && node.blocks.some(block => block.kind === 'tool-call' && block.callId === id))
  return assistant === undefined ? undefined : { seq: assistant.seq, calls: new Set<string>() }
}
