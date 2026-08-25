/**
 * ================================ 文件注释 ================================
 * 【文件职责】通过聊天节点索引读取工具调用生命周期：按根调用 id 读整棵工具树，或按任意
 *             根 / 嵌套调用 id 深度查找单个块。
 * 【技术维度】基于会话快照的 chat.nodes 索引；conversationContextKey 合成节点键；
 *             findToolCall 对每棵根做递归 DFS。
 * 【产品维度】工具行详情 / 导航需要按 callId 定位到生命周期块。
 * 【逻辑维度】1) toolNode 窄化类型；2) rootToolCall 取根；3) findToolCall 递归查找。
 * 【关键边界】生命周期必须已物化在当前加载窗口内，否则返回 undefined。
 * 【新手阅读建议】注意 conversationContextKey 是"会话节点索引 → 生命周期"的桥梁。
 * ==========================================================================
 */
import type {
  ConversationSnapshot, ToolCallBlock,
} from '@deepseek-ai/dsh-client-runtime/client'
import { conversationContextKey } from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatNode } from '../contract/chat-nodes.ts'

function toolNode(node: ReturnType<ConversationSnapshot['chat']['nodes']['get']>): ChatNode<'tool-call'> | undefined {
  return node?.kind === 'tool-call' ? node as ChatNode<'tool-call'> : undefined
}

/**
 * Read one root Tool lifecycle through the internal Chat Node index.
 * @param snapshot - current Conversation snapshot.
 * @param rootCallId - root call identity and Tool Context identity.
 * @returns root lifecycle when it is materialized in the current window.
 */
/*
 * 通过内部聊天节点索引读取一次根工具生命周期。
 * @param snapshot - 当前会话快照。
 * @param rootCallId - 根调用身份（同时是工具 Context 身份）。
 * @returns 当前窗口内已物化时的根生命周期；否则 undefined。
 */
export function rootToolCall(
  snapshot: ConversationSnapshot,
  rootCallId: string,
): ToolCallBlock | undefined {
  return toolNode(snapshot.chat.nodes.get(conversationContextKey('tool-call', rootCallId)))?.data.root
}

/**
 * Find any root or nested Tool lifecycle through the internal Node store.
 * @param snapshot - current Conversation snapshot.
 * @param callId - root or nested call identity.
 * @returns current Tool lifecycle when materialized in the loaded window.
 */
export function findToolCall(snapshot: ConversationSnapshot, callId: string): ToolCallBlock | undefined {
  const visit = (block: ToolCallBlock): ToolCallBlock | undefined => {
    if (block.callId === callId) return block
    for (const child of block.subCalls) {
      const found = visit(child)
      if (found !== undefined) return found
    }
    return undefined
  }
  for (const node of snapshot.chat.nodes.values()) {
    const root = toolNode(node)?.data.root
    if (root === undefined) continue
    const found = visit(root)
    if (found !== undefined) return found
  }
  return undefined
}
