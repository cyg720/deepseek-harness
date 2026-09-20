/**
 * 审批详情：把 `callId` 解析回工具调用。
 *
 * 官方详情来自 `conversation.approval.detail` 子槽，而该槽由 ui-approval 自己声明
 * （它才是该槽的父），我们不是它的父，**无法渲染**。因此改从会话数据自解析：
 * 用审批请求带的 `callId` 去 Chat 快照的 `tool-call` 节点里找同名调用，取出工具名与
 * 原始参数——"命令 / 参数 / 目标"就是这里的 `argsRaw`。解析不到时给**安全文本兜底**：
 * 只显示工具名与原因，不猜测、不编造。
 */
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { PendingApproval } from '@deepseek-ai/dsh-client-ui-approval/client'

/** 一次工具调用的可展示信息。 */
export interface ToolCallInfo {
  /** 调用 id。 */
  readonly callId: string
  /** 工具名。 */
  readonly name: string
  /** 原始参数（由请求方原样写入日志的文本）。 */
  readonly argsRaw: string
}

/** 审批详情视图模型。 */
export interface ApprovalDetailView {
  /** 请求决策的工具名。 */
  readonly toolName: string
  /** 请求方给出的原因；无则为 undefined。 */
  readonly reason?: string
  /** 关联的工具调用 id；无则为 undefined。 */
  readonly callId?: string
  /** 解析到的原始调用参数；解析不到时为 undefined。 */
  readonly argsRaw?: string
  /** 是否只能走兜底文案（没有可展示的调用详情）。 */
  readonly fallback: boolean
}

/** 调用块的结构视图：两种形态的并集，只取本模块要用的字段。 */
interface ToolCallBlockLike {
  readonly callId?: unknown
  readonly name?: unknown
  readonly argsRaw?: unknown
  readonly call?: { readonly name: string; readonly argsRaw: string } | null
  readonly subCalls?: readonly ToolCallBlockLike[]
}

/**
 * 递归收集一段调用块及其子调用的 id。
 *
 * `tool-call` 节点的负载是 `{ root: ToolCallBlock }`，而 `ToolCallBlock` 有两种形态：
 * 未落定的 `RunningToolCall`（自带 name/argsRaw）与已落定的 `ToolResultNode`（把调用头
 * 回填在 `call` 里，窗口截断时可能为 null）。代码派发的子调用递归在 `subCalls` 里。
 * @param block - 一段调用块。
 * @param into - 收集目标。
 */
function collectBlock(block: ToolCallBlockLike, into: Map<string, ToolCallInfo>): void {
  const head = typeof block.name === 'string'
    ? { name: block.name, argsRaw: typeof block.argsRaw === 'string' ? block.argsRaw : '' }
    : block.call === null || block.call === undefined
      ? undefined
      : { name: block.call.name, argsRaw: block.call.argsRaw }
  if (head !== undefined && typeof block.callId === 'string' && !into.has(block.callId)) {
    into.set(block.callId, { callId: block.callId, name: head.name, argsRaw: head.argsRaw })
  }
  for (const child of block.subCalls ?? []) collectBlock(child, into)
}

/**
 * 从 Chat 节点里建立 `callId → 工具调用` 的索引。
 *
 * 只遍历 `tool-call` 节点的负载，不扫会话事件窗口，也不读 `legacy` 投影。
 * @param nodes - 已物化的 Chat 视图节点。
 * @returns 调用索引；同一 callId 以首次出现为准。
 */
export function collectToolCalls(
  nodes: readonly ChatConversationViewNode[],
): ReadonlyMap<string, ToolCallInfo> {
  const index = new Map<string, ToolCallInfo>()
  for (const node of nodes) {
    if (node.kind !== 'tool-call') continue
    const root = (node.data as { root?: ToolCallBlockLike }).root
    if (root === undefined) continue
    collectBlock(root, index)
  }
  return index
}

/**
 * 由审批请求与解析到的调用派生详情。
 * @param pending - 待答复的审批请求。
 * @param call - 由 callId 解析到的调用；解析不到时为 undefined。
 * @returns 详情视图模型；没有可展示参数时 `fallback` 为 true。
 */
export function deriveApprovalDetail(
  pending: PendingApproval,
  call: ToolCallInfo | undefined,
): ApprovalDetailView {
  const raw = call?.argsRaw ?? ''
  return {
    toolName: call?.name ?? pending.toolName,
    fallback: raw === '',
    ...(pending.reason === undefined ? {} : { reason: pending.reason }),
    ...(pending.callId === undefined ? {} : { callId: String(pending.callId) }),
    ...(raw === '' ? {} : { argsRaw: raw }),
  }
}
