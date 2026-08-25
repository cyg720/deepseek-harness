/*
 * ================================ 文件注释 ================================
 * 【文件职责】队列契约：从运行时会话面与快照推导出队列条目 id、操作与行类型。
 * 【技术维度】纯类型文件；用 Parameters / 索引访问从 SessionFace / ConversationSnapshot
 *             派生，保证与运行时签名零漂移。
 * 【产品维度】队列停靠面板的编辑 / 删除 / 插话操作类型与运行时一致。
 * 【逻辑维度】三个类型别名。
 * 【关键边界】契约从运行时类型派生，不自行定义，避免漂移。
 * 【新手阅读建议】理解 Parameters<...> 从运行时签名取类型的手法。
 * ==========================================================================
 */
/** Queue contracts derived from the runtime session face and snapshot. */
import type {
  ConversationSnapshot, SessionFace,
} from '@deepseek-ai/dsh-client-runtime/client'

/** One address accepted by the runtime session's queue mutation verb. */
// 运行时队列变更动词接受的一种地址（条目 id）。
export type QueueItemId = Parameters<SessionFace['updateQueue']>[0]

/** One mutation accepted by the runtime session's queue mutation verb. */
// 运行时队列变更动词接受的一种变更（编辑 / 删除 / 插话）。
export type QueueAction = Parameters<SessionFace['updateQueue']>[1]

/** One row projected by the runtime session's authoritative queue snapshot. */
// 运行时会话权威队列快照投影出的一行。
export type QueueRow = ConversationSnapshot['queue'][number]
