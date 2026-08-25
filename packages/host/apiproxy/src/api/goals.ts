/*
 * ================================ 文件注释 ================================
 * 【文件职责】goals 域契约：六个目标变更动词的签名（create/edit/pause/resume/
 * complete/clear）与目标 id/CAS 引用类型。方法签名是事实来源：一元方法接收
 * RpcRequest<P> 窄形式，实现回显 rpcId。
 * 【技术维度】纯类型契约；GoalId 是品牌化字符串；GoalRef 是"比较并交换"身份
 * （id + revision），每次变更都带新 revision 回执。
 * 【产品维度】目标管理界面：创建/编辑/暂停/恢复/完成/清除长期目标（如多轮
 * 研究任务），读取侧走 'goal' 会话投影，无需专门的 goal.get。
 * 【逻辑维度】GoalId → GoalRef → GoalsApi 六个动词。
 * 【关键边界】仅变更：没有 goal.get 与线上目标视图——响应只回执新 CAS 引用，
 * 绝不喂客户端状态（提交的 goal/change 事件经 mux 流把同一完整值送达每个客户端）；
 * 会话型子代理以 agent-busy 拒绝。
 * 【新手阅读建议】与 goals.schema.ts 及 api-proxy.ts 的 goals 域（mutateGoal、
 * goalServiceFor）对照阅读。
 * ==========================================================================
 */
/**
 * goals domain contract. Method signatures are the source of truth:
 * unary methods take the RpcRequest<P> narrow form and the impl echoes rpcId.
 *
 * Mutations only: the read side is the 'goal' session projection (history
 * tail-page projections block + session/projection frames), so there is no
 * goal.get and no wire goal view — responses acknowledge with the new CAS
 * ref and never feed client state (the committed goal/change event reaches
 * every client through the mux stream carrying the same whole value).
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RpcRequest, RpcResponse } from './rpc.ts'

/** Identifies one goal across its durable revisions. */
// 跨持久化修订唯一标识一个目标的品牌化 id。
export type GoalId = Branded<'GoalId'>

/** Compare-and-set identity for one exact goal revision. */
// 单个确切目标修订的"比较并交换"身份：id + revision。
export interface GoalRef {
  readonly id: GoalId
  readonly revision: number
}

/**
 * Goal-domain unary methods. Every mutation resolves an ordinary session's
 * Agent and applies one CAS-guarded verb; session-backed subagents reject with
 * `agent-busy`.
 */
// 目标域一元方法：每个变更解析普通会话的 Agent 并应用一个 CAS 保护的动词。
export interface GoalsApi {
  /** Create and arm a goal. */
  create(request: RpcRequest<{ sessionId: SessionId; objective: string; maxGoalRounds?: number }>):
  Promise<RpcResponse<{ ref: GoalRef }>>

  /** Edit objective and/or round cap without changing phase. */
  edit(request: RpcRequest<{ sessionId: SessionId; ref: GoalRef; objective?: string; maxGoalRounds?: number }>):
  Promise<RpcResponse<{ ref: GoalRef }>>

  /** Pause an active goal and disarm automatic continuation. */
  pause(request: RpcRequest<{ sessionId: SessionId; ref: GoalRef }>):
  Promise<RpcResponse<{ ref: GoalRef }>>

  /** Resume and arm a stopped goal. */
  resume(request: RpcRequest<{ sessionId: SessionId; ref: GoalRef }>):
  Promise<RpcResponse<{ ref: GoalRef }>>

  /** Mark a current non-complete goal complete and disarm it. */
  complete(request: RpcRequest<{ sessionId: SessionId; ref: GoalRef }>):
  Promise<RpcResponse<{ ref: GoalRef }>>

  /** Clear the current goal while retaining a durable tombstone and history. */
  clear(request: RpcRequest<{ sessionId: SessionId; ref: GoalRef }>):
  Promise<RpcResponse<{ cleared: true }>>
}
