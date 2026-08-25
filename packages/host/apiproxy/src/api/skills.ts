/*
 * ================================ 文件注释 ================================
 * 【文件职责】skills 域契约：按会话寻址的只读技能目录查询。会话头的 cwd 在宿主
 * 侧解析为规范项目根——客户端从不提交裸路径，技能查找也绝不创建/续写 Agent。
 * 【技术维度】纯类型契约；SkillEntry 是宿主 SkillSummary 的线上投影（提供者/
 * 来源词汇留在宿主侧）。
 * 【产品维度】客户端 '/' 弹层展示会话可用技能：用户以 /name 在输入框调用技能。
 * 【逻辑维度】SkillEntry（技能目录行）→ SkillsApi.list（本域唯一 RPC）。
 * 【关键边界】调用本身不是独立 RPC——它就是一次以 /name 开头的 session.prompt，
 * 宿主在预步边界识别（dsh-tool-skill 注入渲染后的正文），所有客户端共用一条
 * 确定性路径；modelInvocable=false 标记用户专属技能（不出现在模型目录）。
 * 【新手阅读建议】与 api-proxy.ts 的 skills.list 实现对照，理解作用域解析与
 * isUserInvocable 过滤。
 * ==========================================================================
 */
/**
 * skills domain contract: read-only skill catalog lookup addressed by session.
 * The session's header cwd resolves to the canonical project root host-side —
 * the client never submits a raw path, and skill lookup never creates or
 * resumes an Agent.
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RpcRequest, RpcResponse } from './rpc.ts'

/** Skill catalog row (wire projection of the host SkillSummary; provider/source vocabulary stays host-side). */
// 技能目录行（宿主 SkillSummary 的线上投影）。
export interface SkillEntry {
  /** Kebab-case identifier the user references as `/name` in the composer. */
  // 用户以 /name 引用的短横线标识符。
  readonly name: string
  /** Short routing description. */
  // 简短路由描述。
  readonly description: string
  /** Optional extra routing guidance. */
  // 可选的路由补充指引。
  readonly whenToUse?: string
  /** False marks a user-only skill (`disable-model-invocation`): invocable here, absent from the model catalog. */
  // false 表示用户专属技能：此处可调用，但不出现在模型目录。
  readonly modelInvocable: boolean
}

/**
 * Skill-domain unary methods (the map key skill.* of RpcMethodMap). Listing
 * is the domain's only RPC: invocation itself is a plain `session.prompt`
 * whose leading `/name` token the host recognizes at the pre-step boundary
 * (`dsh-tool-skill` injects the rendered body there), so every client shares
 * one deterministic path with no dedicated invocation wire.
 */
// 技能域一元方法：目录查询是本域唯一 RPC，调用走普通 session.prompt。
export interface SkillsApi {
  /** Lists the user-invocable skill catalog for the session's project. */
  // 列出会话项目下可被用户调用的技能目录。
  list(request: RpcRequest<{ sessionId: SessionId }>): Promise<RpcResponse<{ skills: readonly SkillEntry[] }>>
}
