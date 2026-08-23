/**
 * ================================ 文件注释 ================================
 * 【文件职责】为可续聊子代理生成"描述符事件"种子：在子代理首次请求前，把其声明的组成
 *   （composition）作为一条模型不可见的 subagent/descriptor 事件写入子代理日志，
 *   供后续冷恢复（cold resume）从日志中重建。
 * 【技术维度】借助 dsh-session 的 Session.create 先暂存再读出事件数组，
 *   从而复用会话日志的 seq 分配与无损 JSON 校验规则。
 * 【产品维度】续聊子代理冷恢复时无需重新询问父代理配置，因为创建时的组成已随日志持久化。
 * 【逻辑维度】seedDescriptorTurn：把继承的父历史前缀（seed）与一条描述符事件拼接成完整种子。
 * 【关键边界】返回的事件从 seq 0 开始连续；描述符是模型隐藏记录，不进模型历史。
 * 【新手阅读建议】理解"继承前缀 + 描述符事件 = 种子"即可；描述符结构看 descriptor.ts。
 * ==========================================================================
 */

/**
 * Seeding of a continuable child's durable descriptor event: the model-hidden
 * record of the child's declared composition before its first request, so a
 * later cold resume can reconstruct it from its own log.
 *
 * @module @deepseek-ai/dsh-subagent/descriptor-seed
 */

import { Session } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentDescriptorData } from './descriptor.ts'

/**
 * Build the child's creation seed: any inherited parent-history prefix followed
 * by one model-hidden, between-turn `descriptor` event. Staging through a
 * `Session` assigns the sequence number and enforces the same lossless-JSON
 * rules the durable log does.
 * @param childId - the reserved child session id the staged log belongs to.
 * @param seed - the inherited completed-turn prefix, or `undefined` for a fresh child.
 * @param descriptor - the snapshotted composition record to persist.
 * @returns the complete seed events, contiguous from sequence zero.
 */
/**
 * 中文：通过暂存 Session 把"继承的父历史前缀 + 一条 subagent/descriptor 事件"拼成完整种子；
 * 返回从 seq 0 连续的事件数组，供后续冷恢复（cold resume）从子代理自己的日志重建其组成。
 */
export function seedDescriptorTurn(
  childId: SessionId,
  seed: readonly SessionEvent[] | undefined,
  descriptor: SubagentDescriptorData,
): SessionEvent[] {
  const staged = Session.create(childId, seed)
  staged.append('subagent/descriptor', descriptor)
  return [...staged.events]
}
